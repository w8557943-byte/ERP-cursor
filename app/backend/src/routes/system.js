import express from 'express'
import os from 'os'
import fs from 'fs'
import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const pkg = require('../../package.json')
import syncConfig from '../config/syncConfig.js'
import { authenticateToken, requireUser } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import cloudbaseService from '../services/cloudbaseService.js'
import database from '../utils/database.js'
import mongoose from 'mongoose'
import { dbPath, settingsFilePath, saveLocalDbPath, syncDatabase } from '../utils/sqliteDatabase.js'
import { requireAdmin } from '../middleware/auth.js'
import Order from '../models/local/Order.js'
import Customer from '../models/local/Customer.js'
import Product from '../models/local/Product.js'
import syncService from '../services/syncService.js'

const router = express.Router()

/**
 * 注意：架构已修改
 * - PC端以本地 SQLite 为主数据源
 * - 云服务器仅作为备份和小程序同步使用
 * - 自动同步功能已移除，改为手动同步模式
 * - 使用 /api/manual-sync 端点进行手动同步
 */

const allowPublicEnv = String(process.env.ALLOW_PUBLIC_SYSTEM_ENDPOINTS || '').toLowerCase() === 'true'
const isDevEnv = String(process.env.NODE_ENV || 'development').toLowerCase() === 'development'
const isLocalRequest = (req) => {
  const h = req?.headers || {}
  const host = String(h.host || '').split(':')[0].toLowerCase()
  const xf = String(h['x-forwarded-for'] || '').split(',')[0].trim().toLowerCase()
  const ip = String((xf || req.ip || '')).replace('::ffff:', '').toLowerCase()
  // Add more robust check for local IP
  return host === 'localhost' || host === '127.0.0.1' || ip === 'localhost' || ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1'
}
const canBypass = (req) => {
  if (allowPublicEnv) return true
  // Check if it's a local request - if so, allow it
  if (isLocalRequest(req)) return true
  // Otherwise fall back to environment check
  return isDevEnv
}

const getCPUUsage = async () => {
  const startMeasure = os.cpus().map(cpu => cpu.times)
  await new Promise(resolve => setTimeout(resolve, 100))
  const endMeasure = os.cpus().map(cpu => cpu.times)
  let totalIdle = 0
  let totalTick = 0
  for (let i = 0; i < startMeasure.length; i += 1) {
    const idle = endMeasure[i].idle - startMeasure[i].idle
    const total = Object.values(endMeasure[i]).reduce((a, b) => a + b, 0) -
      Object.values(startMeasure[i]).reduce((a, b) => a + b, 0)
    totalIdle += idle
    totalTick += total
  }
  if (!totalTick) return 0
  return 100 - Math.floor(100 * totalIdle / totalTick)
}

const overviewHandler = asyncHandler(async (req, res) => {
  const clientIp = (req.headers['x-forwarded-for']?.toString().split(',')[0]?.trim()) || req.ip || ''
  const cpuUsage = await getCPUUsage().catch(() => 0)
  const mem = {
    total: os.totalmem(),
    free: os.freemem(),
    used: os.totalmem() - os.freemem()
  }
  let dbHealth = null
  try {
    if (process.env.MONGODB_URI) {
      await database.connect()
      const start = Date.now()
      await mongoose.connection.db.admin().ping()
      dbHealth = { state: mongoose.connection.readyState, pingMs: Date.now() - start }
    }
  } catch (_) {
    dbHealth = dbHealth || { state: mongoose.connection.readyState, pingMs: -1 }
  }
  const cloudReady = await cloudbaseService.initialize().catch(() => false)
  return res.json({
    success: true,
    data: {
      clientIp,
      nodeVersion: process.version,
      appVersion: pkg.version,
      cpuUsage,
      memory: { ...mem, percentage: mem.total ? mem.used / mem.total * 100 : 0 },
      cloudReady
    }
  })
})

const readSettingsJson = () => {
  try {
    if (fs.existsSync(settingsFilePath)) {
      const raw = fs.readFileSync(settingsFilePath, 'utf8')
      const json = JSON.parse(raw || '{}')
      return json && typeof json === 'object' ? json : {}
    }
  } catch (_) { void 0 }
  return {}
}

const writeSettingsJson = (patch) => {
  try {
    const dir = require('path').dirname(settingsFilePath)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const current = readSettingsJson()
    const next = { ...current, ...patch }
    fs.writeFileSync(settingsFilePath, JSON.stringify(next, null, 2))
    return true
  } catch (_) {
    return false
  }
}

const getBackupConfigFromSettings = () => {
  const settings = readSettingsJson()
  const raw = settings && typeof settings.backupConfig === 'object' ? settings.backupConfig : {}
  return {
    enabled: Boolean(raw.enabled),
    intervalMinutes: Number(raw.intervalMinutes || 1440),
    localDir: String(raw.localDir || '').trim(),
    maxRecords: Number(raw.maxRecords || 20000),
    collections: Array.isArray(raw.collections) ? raw.collections.map((x) => String(x || '').trim()).filter(Boolean) : [],
    exitBackup: Boolean(raw.exitBackup)
  }
}

const saveBackupConfigToSettings = (input) => {
  const normalized = {
    enabled: Boolean(input?.enabled),
    intervalMinutes: Math.max(10, Number(input?.intervalMinutes || 1440)),
    localDir: String(input?.localDir || '').trim(),
    maxRecords: Math.max(1, Number(input?.maxRecords || 20000)),
    collections: Array.isArray(input?.collections) ? input.collections.map((x) => String(x || '').trim()).filter(Boolean) : [],
    exitBackup: Boolean(input?.exitBackup)
  }
  const ok = writeSettingsJson({ backupConfig: normalized })
  return ok ? normalized : null
}

const getCloudSyncConfigFromSettings = () => {
  const settings = readSettingsJson()
  const raw = settings && typeof settings.cloudSyncConfig === 'object'
    ? settings.cloudSyncConfig
    : (settings && typeof settings.backupConfig === 'object' ? settings.backupConfig : {})
  return {
    enabled: Boolean(raw.enabled),
    intervalMinutes: Number(raw.intervalMinutes || 1440),
    collections: Array.isArray(raw.collections) ? raw.collections.map((x) => String(x || '').trim()).filter(Boolean) : [],
    exitSync: Boolean(raw.exitSync ?? raw.exitBackup)
  }
}

const saveCloudSyncConfigToSettings = (input) => {
  const normalized = {
    enabled: Boolean(input?.enabled),
    intervalMinutes: Math.max(10, Number(input?.intervalMinutes || 1440)),
    collections: Array.isArray(input?.collections) ? input.collections.map((x) => String(x || '').trim()).filter(Boolean) : [],
    exitSync: Boolean(input?.exitSync)
  }
  const ok = writeSettingsJson({ cloudSyncConfig: normalized })
  return ok ? normalized : null
}

const backupConfigHandler = asyncHandler(async (_req, res) => {
  const cfg = getBackupConfigFromSettings()
  return res.json({ success: true, data: cfg })
})

router.get('/overview', (req, res, next) => {
  if (canBypass(req)) return overviewHandler(req, res, next)
  return authenticateToken(req, res, () => requireUser(req, res, () => overviewHandler(req, res, next)))
})

router.get('/backup/config', (req, res, next) => {
  if (canBypass(req)) return backupConfigHandler(req, res, next)
  return authenticateToken(req, res, () => requireUser(req, res, () => backupConfigHandler(req, res, next)))
})

const putBackupConfigHandler = asyncHandler(async (req, res) => {
  const saved = saveBackupConfigToSettings(req.body || {})
  if (!saved) return res.status(500).json({ success: false, message: '保存备份设置失败' })
  return res.json({ success: true, data: saved })
})

router.put('/backup/config', (req, res, next) => {
  if (canBypass(req)) return putBackupConfigHandler(req, res, next)
  return authenticateToken(req, res, () => requireAdmin(req, res, () => putBackupConfigHandler(req, res, next)))
})

const runBackupHandler = asyncHandler(async (req, res) => {
  const { maxRecords = 20000, collections = [], inline = false } = req.body || {}
  const ok = await cloudbaseService.initialize().catch(() => false)
  if (!ok) {
    return res.status(503).json({ success: false, message: '云开发服务不可用' })
  }
  const cf = await cloudbaseService.callFunction('user-backup', {
    action: 'exportEncryptedBackup',
    maxRecordsPerCollection: Number(maxRecords) || 20000,
    collections: Array.isArray(collections) ? collections : [],
    inline: Boolean(inline)
  })
  const payload = cf && typeof cf === 'object' ? cf.result || cf : {}
  const url = String(payload?.url || '').trim()
  const cloudPath = String(payload?.cloudPath || '').trim()
  const snapshot = payload?.snapshot && typeof payload.snapshot === 'object' ? payload.snapshot : null
  return res.json({ success: true, data: { url, cloudPath, snapshot } })
})

router.post('/backup/run', (req, res, next) => {
  if (canBypass(req)) return runBackupHandler(req, res, next)
  return authenticateToken(req, res, () => requireAdmin(req, res, () => runBackupHandler(req, res, next)))
})

const importBackupHandler = asyncHandler(async (req, res) => {
  const { collection, rows, wipe, confirmText } = req.body || {}
  const name = String(collection || '').trim()
  const list = Array.isArray(rows) ? rows : []
  const doWipe = Boolean(wipe)
  const key = String(confirmText || '').trim().toUpperCase()
  const supported = new Set(['orders', 'customers', 'products'])
  if (!name || !supported.has(name)) {
    return res.status(400).json({ success: false, message: '不支持的集合' })
  }
  if (!Array.isArray(list) || list.length === 0) {
    return res.status(400).json({ success: false, message: '缺少导入数据' })
  }
  if (doWipe && key !== 'WIPE') {
    return res.status(400).json({ success: false, message: '缺少覆盖确认' })
  }
  const model = name === 'orders' ? Order : (name === 'customers' ? Customer : Product)
  if (doWipe) {
    await model.destroy({ where: {}, truncate: false })
  }
  let created = 0
  let updated = 0
  for (const row of list) {
    const r = row && typeof row === 'object' ? row : {}
    let where = {}
    if (name === 'orders') {
      const orderNo = String(r.orderNo || r.no || r.orderNumber || '').trim()
      if (!orderNo) continue
      where = { orderNo }
    } else if (name === 'customers') {
      const customerCode = String(r.customerCode || r.code || '').trim()
      if (!customerCode) continue
      where = { customerCode }
    } else if (name === 'products') {
      const productCode = String(r.productCode || r.code || '').trim()
      if (!productCode) continue
      where = { productCode }
    }
    const existing = await model.findOne({ where })
    if (!existing) {
      await model.create(r, { hooks: false })
      created += 1
    } else {
      await existing.update(r, { hooks: false })
      updated += 1
    }
  }
  return res.json({ success: true, data: { created, updated } })
})

router.post('/backup/import', (req, res, next) => {
  if (canBypass(req)) return importBackupHandler(req, res, next)
  return authenticateToken(req, res, () => requireAdmin(req, res, () => importBackupHandler(req, res, next)))
})

const cloudSyncConfigHandler = asyncHandler(async (_req, res) => {
  const cfg = getCloudSyncConfigFromSettings()
  return res.json({ success: true, data: cfg })
})

router.get('/cloud-sync/config', (req, res, next) => {
  if (canBypass(req)) return cloudSyncConfigHandler(req, res, next)
  return authenticateToken(req, res, () => requireUser(req, res, () => cloudSyncConfigHandler(req, res, next)))
})

const putCloudSyncConfigHandler = asyncHandler(async (req, res) => {
  const saved = saveCloudSyncConfigToSettings(req.body || {})
  if (!saved) return res.status(500).json({ success: false, message: '保存云同步设置失败' })
  return res.json({ success: true, data: saved })
})

router.put('/cloud-sync/config', (req, res, next) => {
  if (canBypass(req)) return putCloudSyncConfigHandler(req, res, next)
  return authenticateToken(req, res, () => requireAdmin(req, res, () => putCloudSyncConfigHandler(req, res, next)))
})

const runCloudSyncHandler = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const mode = String(body.mode || 'incremental').trim().toLowerCase()
  const forceAll = mode === 'force' || mode === 'full' || mode === 'all'
  const collectionsRaw = Array.isArray(body.collections) ? body.collections : []
  const collections = collectionsRaw.map((x) => String(x || '').trim()).filter(Boolean)
  const allow = collections.length ? new Set(collections) : new Set(['orders', 'customers', 'products'])

  const ok = await cloudbaseService.initialize().catch(() => false)
  if (!ok) {
    return res.status(503).json({ success: false, message: cloudbaseService?.lastInitError || '云开发服务不可用' })
  }

  await syncDatabase(false)

  const syncModels = [
    { name: 'customers', model: Customer },
    { name: 'orders', model: Order },
    { name: 'products', model: Product }
  ].filter((x) => allow.has(x.name))

  const summary = {}
  for (const { name, model } of syncModels) {
    const where = forceAll ? {} : { syncStatus: 'pending' }
    const list = await model.findAll({ where, limit: 5000, order: [['updatedAt', 'ASC'], ['id', 'ASC']] })
    let success = 0
    let failed = 0
    for (const row of list || []) {
      const ok = await syncService.sync(row, name, { force: true })
      if (ok) success += 1
      else failed += 1
    }
    summary[name] = { total: (list || []).length, success, failed }
  }

  return res.json({
    success: true,
    data: {
      mode: forceAll ? 'force' : 'incremental',
      summary,
      finishedAt: Date.now()
    }
  })
})

router.post('/cloud-sync/run', (req, res, next) => {
  if (canBypass(req)) return runCloudSyncHandler(req, res, next)
  return authenticateToken(req, res, () => requireAdmin(req, res, () => runCloudSyncHandler(req, res, next)))
})

const installLocalDbFromCloudHandler = asyncHandler(async (req, res) => {
  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const wipe = Boolean(body.wipe)
  const maxRecordsPerCollection = Math.max(1, Number(body.maxRecordsPerCollection || 20000))
  const collectionsRaw = Array.isArray(body.collections) ? body.collections : []
  const collections = collectionsRaw.map((x) => String(x || '').trim()).filter(Boolean)
  const allow = collections.length ? new Set(collections) : new Set(['orders', 'customers', 'products'])

  const ok = await cloudbaseService.initialize().catch(() => false)
  if (!ok) {
    return res.status(503).json({ success: false, message: cloudbaseService?.lastInitError || '云开发服务不可用' })
  }

  await syncDatabase(false)

  if (wipe) {
    if (allow.has('orders')) await Order.destroy({ where: {}, truncate: false })
    if (allow.has('customers')) await Customer.destroy({ where: {}, truncate: false })
    if (allow.has('products')) await Product.destroy({ where: {}, truncate: false })
  }

  const fetchAll = async (collectionName) => {
    const collection = cloudbaseService.getCollection(collectionName)
    const limit = 500
    const out = []
    let offset = 0
    while (out.length < maxRecordsPerCollection) {
      const res = await collection.limit(limit).skip(offset).get()
      const batch = Array.isArray(res?.data) ? res.data : []
      if (!batch.length) break
      out.push(...batch)
      offset += batch.length
      if (batch.length < limit) break
    }
    return out.slice(0, maxRecordsPerCollection)
  }

  const result = {}

  if (allow.has('orders')) {
    const docs = await fetchAll('orders')
    let created = 0
    let updated = 0
    for (const doc of docs) {
      const cloudId = doc?._id != null ? String(doc._id) : ''
      const orderNo = String((doc?.orderNumber ?? doc?.orderNo ?? cloudId) || '').trim() || `CLOUD-${cloudId || Date.now()}`
      const totalAmount = Number(doc?.totalAmount ?? doc?.amount ?? 0) || 0
      const discount = Number(doc?.discount ?? 0) || 0
      const finalAmount = Number(doc?.finalAmount ?? (totalAmount - discount)) || 0
      const payload = {
        orderNo,
        orderType: doc?.orderType != null ? String(doc.orderType) : undefined,
        purchaseCategory: doc?.purchaseCategory != null ? String(doc.purchaseCategory) : undefined,
        customerId: doc?.customerId != null ? String(doc.customerId) : '',
        customerName: doc?.customerName != null ? String(doc.customerName) : (doc?.supplierName != null ? String(doc.supplierName) : ''),
        supplierName: doc?.supplierName != null ? String(doc.supplierName) : undefined,
        items: Array.isArray(doc?.items) ? doc.items : [],
        products: Array.isArray(doc?.products) ? doc.products : [],
        meta: doc?.meta && typeof doc.meta === 'object' ? doc.meta : {},
        totalAmount,
        discount,
        finalAmount,
        sheetCount: doc?.sheetCount != null ? Number(doc.sheetCount) : undefined,
        status: doc?.status != null ? String(doc.status) : undefined,
        paymentStatus: doc?.paymentStatus != null ? String(doc.paymentStatus) : undefined,
        paymentMethod: doc?.paymentMethod != null ? String(doc.paymentMethod) : undefined,
        paidAmount: doc?.paidAmount != null ? Number(doc.paidAmount) : undefined,
        deliveryAddress: doc?.deliveryAddress != null ? String(doc.deliveryAddress) : undefined,
        notes: doc?.notes != null ? String(doc.notes) : undefined,
        priority: doc?.priority != null ? String(doc.priority) : undefined,
        source: doc?.source != null ? String(doc.source) : 'cloud',
        wechatOrderId: doc?.wechatOrderId != null ? String(doc.wechatOrderId) : undefined,
        createdBy: doc?.createdBy != null ? String(doc.createdBy) : undefined,
        cloudId: cloudId || undefined,
        lastSyncedAt: new Date(),
        syncStatus: 'synced'
      }

      const existing = cloudId
        ? await Order.findOne({ where: { cloudId } })
        : await Order.findOne({ where: { orderNo } })
      if (!existing) {
        await Order.create(payload, { hooks: false })
        created += 1
      } else {
        await existing.update(payload, { hooks: false })
        updated += 1
      }
    }
    result.orders = { total: docs.length, created, updated }
  }

  if (allow.has('customers')) {
    const docs = await fetchAll('customers')
    let created = 0
    let updated = 0
    for (const doc of docs) {
      const cloudId = doc?._id != null ? String(doc._id) : ''
      const customerCode = String(doc?.customerCode ?? doc?.code ?? '').trim() || `CUST-${(cloudId || Date.now()).toString().slice(-8)}`
      const name = String((doc?.name ?? doc?.company ?? customerCode) || '').trim() || customerCode
      const contactPerson = String(doc?.contactPerson ?? doc?.contact ?? doc?.name ?? '未知').trim() || '未知'
      const phone = String(doc?.phone ?? `cloud-${cloudId || customerCode}`).trim()
      const payload = {
        customerCode,
        name,
        shortName: doc?.shortName != null ? String(doc.shortName) : undefined,
        type: doc?.type != null ? String(doc.type) : undefined,
        contactPerson,
        phone,
        email: doc?.email != null ? String(doc.email) : undefined,
        address: doc?.address != null ? String(doc.address) : undefined,
        province: doc?.province != null ? String(doc.province) : undefined,
        city: doc?.city != null ? String(doc.city) : undefined,
        district: doc?.district != null ? String(doc.district) : undefined,
        industry: doc?.industry != null ? String(doc.industry) : undefined,
        creditRating: doc?.creditRating != null ? String(doc.creditRating) : undefined,
        creditLimit: doc?.creditLimit != null ? Number(doc.creditLimit) : undefined,
        currentBalance: doc?.currentBalance != null ? Number(doc.currentBalance) : undefined,
        totalOrders: doc?.totalOrders != null ? Number(doc.totalOrders) : undefined,
        totalAmount: doc?.totalAmount != null ? Number(doc.totalAmount) : undefined,
        avgOrderAmount: doc?.avgOrderAmount != null ? Number(doc.avgOrderAmount) : undefined,
        lastOrderDate: doc?.lastOrderDate ? new Date(doc.lastOrderDate) : undefined,
        status: doc?.status != null ? String(doc.status) : undefined,
        source: doc?.source != null ? String(doc.source) : 'cloud',
        wechatCustomerId: doc?.wechatCustomerId != null ? String(doc.wechatCustomerId) : undefined,
        wechatOpenId: doc?.wechatOpenId != null ? String(doc.wechatOpenId) : undefined,
        notes: doc?.notes != null ? String(doc.notes) : undefined,
        tags: Array.isArray(doc?.tags) ? doc.tags : [],
        createdBy: doc?.createdBy != null ? String(doc.createdBy) : undefined,
        cloudId: cloudId || undefined,
        lastSyncedAt: new Date(),
        syncStatus: 'synced'
      }
      const existing = cloudId
        ? await Customer.findOne({ where: { cloudId } })
        : await Customer.findOne({ where: { customerCode } })
      if (!existing) {
        await Customer.create(payload, { hooks: false })
        created += 1
      } else {
        await existing.update(payload, { hooks: false })
        updated += 1
      }
    }
    result.customers = { total: docs.length, created, updated }
  }

  if (allow.has('products')) {
    const docs = await fetchAll('products').catch(() => [])
    let created = 0
    let updated = 0
    for (const doc of docs) {
      const cloudId = doc?._id != null ? String(doc._id) : ''
      const productCode = String(doc?.productCode ?? doc?.code ?? '').trim() || `PROD-${(cloudId || Date.now()).toString().slice(-8)}`
      const name = String((doc?.name ?? doc?.title ?? productCode) || '').trim() || productCode
      const category = String(doc?.category ?? doc?.type ?? '未分类').trim() || '未分类'
      const price = Number(doc?.price ?? doc?.salePrice ?? 0) || 0
      const cost = Number(doc?.cost ?? 0) || 0
      const payload = {
        productCode,
        name,
        category,
        subcategory: doc?.subcategory != null ? String(doc.subcategory) : undefined,
        specification: doc?.specification != null ? String(doc.specification) : undefined,
        material: doc?.material != null ? String(doc.material) : undefined,
        size: doc?.size && typeof doc.size === 'object' ? doc.size : undefined,
        weight: doc?.weight && typeof doc.weight === 'object' ? doc.weight : undefined,
        color: doc?.color != null ? String(doc.color) : undefined,
        unit: doc?.unit != null ? String(doc.unit) : undefined,
        price,
        cost,
        profitMargin: doc?.profitMargin != null ? Number(doc.profitMargin) : undefined,
        stock: doc?.stock != null ? Number(doc.stock) : undefined,
        minStock: doc?.minStock != null ? Number(doc.minStock) : undefined,
        maxStock: doc?.maxStock != null ? Number(doc.maxStock) : undefined,
        safetyStock: doc?.safetyStock != null ? Number(doc.safetyStock) : undefined,
        status: doc?.status != null ? String(doc.status) : undefined,
        isCustomizable: doc?.isCustomizable != null ? Boolean(doc.isCustomizable) : undefined,
        leadTime: doc?.leadTime != null ? Number(doc.leadTime) : undefined,
        images: Array.isArray(doc?.images) ? doc.images : [],
        description: doc?.description != null ? String(doc.description) : '',
        features: Array.isArray(doc?.features) ? doc.features : [],
        tags: Array.isArray(doc?.tags) ? doc.tags : [],
        source: doc?.source != null ? String(doc.source) : 'cloud',
        wechatProductId: doc?.wechatProductId != null ? String(doc.wechatProductId) : undefined,
        createdBy: doc?.createdBy != null ? String(doc.createdBy) : '',
        cloudId: cloudId || undefined,
        lastSyncedAt: new Date(),
        syncStatus: 'synced'
      }
      const existing = cloudId
        ? await Product.findOne({ where: { cloudId } })
        : await Product.findOne({ where: { productCode } })
      if (!existing) {
        await Product.create(payload, { hooks: false })
        created += 1
      } else {
        await existing.update(payload, { hooks: false })
        updated += 1
      }
    }
    result.products = { total: docs.length, created, updated }
  }

  return res.json({
    success: true,
    data: {
      dbPath,
      wipe,
      maxRecordsPerCollection,
      result,
      finishedAt: Date.now()
    }
  })
})

router.post('/local-db/install-from-cloud', (req, res, next) => {
  if (canBypass(req)) return installLocalDbFromCloudHandler(req, res, next)
  return authenticateToken(req, res, () => requireAdmin(req, res, () => installLocalDbFromCloudHandler(req, res, next)))
})
const storageInfoHandler = asyncHandler(async (_req, res) => {
  let source = 'default'
  if (process.env.SQLITE_DB_PATH) {
    source = 'env'
  } else {
    try {
      if (fs.existsSync(settingsFilePath)) {
        source = 'settings'
      }
    } catch (_) { void 0 }
  }
  return res.json({
    success: true,
    data: {
      path: dbPath,
      source,
      settingsFile: settingsFilePath
    }
  })
})

const setStorageHandler = asyncHandler(async (req, res) => {
  const newPath = String(req.body?.path || '').trim()
  if (!newPath) {
    return res.status(400).json({ success: false, message: '缺少路径参数' })
  }
  const storedPath = saveLocalDbPath(newPath)
  if (!storedPath) {
    return res.status(500).json({ success: false, message: '保存路径失败' })
  }
  return res.json({
    success: true,
    message: '已保存到设置文件，重启服务后生效',
    data: { settingsFile: settingsFilePath, path: storedPath }
  })
})

router.get('/storage-path', (req, res, next) => {
  if (canBypass(req)) return storageInfoHandler(req, res, next)
  return authenticateToken(req, res, () => requireUser(req, res, () => storageInfoHandler(req, res, next)))
})

router.put('/storage-path', (req, res, next) => {
  if (canBypass(req)) return setStorageHandler(req, res, next)
  return authenticateToken(req, res, () => requireAdmin(req, res, () => setStorageHandler(req, res, next)))
})

const getSettingsHandler = asyncHandler(async (_req, res) => {
  return res.json({
    success: true,
    data: {
      settings: {}
    }
  })
})

const saveSettingsHandler = asyncHandler(async (req, res) => {
  return res.json({
    success: true,
    data: {
      settings: req.body
    }
  })
})

router.get('/settings', (req, res, next) => {
  if (canBypass(req)) return getSettingsHandler(req, res, next)
  return authenticateToken(req, res, () => requireUser(req, res, () => getSettingsHandler(req, res, next)))
})

router.put('/settings', (req, res, next) => {
  if (canBypass(req)) return saveSettingsHandler(req, res, next)
  return authenticateToken(req, res, () => requireAdmin(req, res, () => saveSettingsHandler(req, res, next)))
})

export default router
