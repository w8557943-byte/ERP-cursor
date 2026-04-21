import express from 'express'
import { Op } from 'sequelize'
import { authenticateToken, requireUser } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import cloudbaseService from '../services/cloudbaseService.js'
import os from 'os'
import mongoose from 'mongoose'
import database from '../utils/database.js'
import { syncDatabase } from '../utils/sqliteDatabase.js'
import Order from '../models/local/Order.js'
import Product from '../models/local/Product.js'
import Customer from '../models/local/Customer.js'

const router = express.Router()

const isOfflineMode = () => String(process.env.OFFLINE_MODE || '').toLowerCase() === 'true'

const ensureCloud = async () => {
  const ok = await cloudbaseService.initialize().catch(() => false)
  return ok
}

let sqliteReadyPromise = null
const ensureSqliteReady = async () => {
  if (!sqliteReadyPromise) {
    sqliteReadyPromise = syncDatabase(false)
  }
  await sqliteReadyPromise
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

const getMemoryUsage = () => {
  const total = os.totalmem()
  const free = os.freemem()
  const used = total - free
  const percentage = total ? (used / total) * 100 : 0
  return { total, used, free, percentage }
}

const normalizeOrder = (doc) => {
  const createTime = doc?.createTime || doc?.createdAt || doc?.createAt || doc?.createdTime
  const t = createTime ? Date.parse(String(createTime)) : NaN
  const iso = Number.isFinite(t) ? new Date(t).toISOString() : (typeof createTime === 'string' ? createTime : new Date().toISOString())
  return {
    id: doc?._id != null ? String(doc._id) : '',
    orderNo: doc?.orderNo || doc?.orderNumber || '',
    customerName: doc?.customerName || doc?.customer?.name || doc?.customer || '',
    productName: doc?.productName || '',
    quantity: Number(doc?.quantity || 0),
    amount: Number(doc?.amount || doc?.totalAmount || 0),
    status: doc?.status || 'pending',
    createTime: iso
  }
}

const normalizeSqliteOrder = (row) => {
  if (!row) return null
  const src = typeof row.toJSON === 'function' ? row.toJSON() : row
  const createdAt = src?.createdAt instanceof Date ? src.createdAt : (src?.createdAt ? new Date(src.createdAt) : null)
  const createTime = createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toISOString() : new Date().toISOString()
  return {
    id: src?.cloudId != null ? String(src.cloudId) : (src?.id != null ? String(src.id) : ''),
    orderNo: src?.orderNo || '',
    customerName: src?.customerName || '',
    productName: '',
    quantity: Array.isArray(src?.items) ? src.items.reduce((sum, it) => sum + Number(it?.quantity || 0), 0) : 0,
    amount: Number(src?.finalAmount ?? src?.totalAmount ?? 0),
    status: src?.status || 'pending',
    createTime
  }
}

const buildLocalStats = async () => {
  await ensureSqliteReady()

  const now = new Date()
  const nowMs = now.getTime()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrowStart = new Date(todayStart.getTime() + 24 * 60 * 60 * 1000)

  const todayOrders = await Order.count({
    where: { createdAt: { [Op.gte]: todayStart, [Op.lt]: tomorrowStart } }
  }).catch(() => 0)

  const todayRevenueRaw = await Order.sum('finalAmount', {
    where: { createdAt: { [Op.gte]: todayStart, [Op.lt]: tomorrowStart } }
  }).catch(() => 0)
  const todayRevenue = Number(todayRevenueRaw || 0)

  const activeCustomers = await Customer.count().catch(() => 0)

  const recentOrdersRows = await Order.findAll({
    order: [['createdAt', 'DESC'], ['id', 'DESC']],
    limit: 10
  }).catch(() => [])
  const recentOrders = (recentOrdersRows || []).map(normalizeSqliteOrder).filter(Boolean)

  const last7Start = new Date(todayStart.getTime() - 6 * 24 * 60 * 60 * 1000)
  const last7Rows = await Order.findAll({
    attributes: ['createdAt'],
    where: { createdAt: { [Op.gte]: last7Start, [Op.lt]: tomorrowStart } },
    order: [['createdAt', 'ASC']]
  }).catch(() => [])

  const bucket = new Map()
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(todayStart.getTime() - (6 - i) * 24 * 60 * 60 * 1000)
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    bucket.set(key, 0)
  }
  for (const r of last7Rows || []) {
    const src = typeof r.toJSON === 'function' ? r.toJSON() : r
    const t = src?.createdAt instanceof Date ? src.createdAt.getTime() : Date.parse(String(src?.createdAt || ''))
    if (!Number.isFinite(t)) continue
    const day = new Date(t)
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    if (bucket.has(key)) bucket.set(key, bucket.get(key) + 1)
  }
  const orderTrends = Array.from(bucket.entries()).map(([date, orders]) => ({ date, orders }))

  const last30Start = new Date(todayStart.getTime() - 29 * 24 * 60 * 60 * 1000)
  const last30Rows = await Order.findAll({
    attributes: ['status'],
    where: { createdAt: { [Op.gte]: last30Start, [Op.lt]: tomorrowStart } }
  }).catch(() => [])
  const statusCounts = new Map()
  for (const r of last30Rows || []) {
    const src = typeof r.toJSON === 'function' ? r.toJSON() : r
    const s = String(src?.status || 'pending')
    statusCounts.set(s, (statusCounts.get(s) || 0) + 1)
  }
  const orderStatusDistribution = Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count, name: status }))

  const productSample = await Product.findAll({ limit: 2000 }).catch(() => [])
  const stockAlerts = (productSample || [])
    .map((r) => (typeof r.toJSON === 'function' ? r.toJSON() : r))
    .filter((p) => Number(p?.stock || 0) <= Number(p?.minStock || 0))
    .slice(0, 10)
    .map((p) => ({
      id: p?.id != null ? String(p.id) : (p?.cloudId != null ? String(p.cloudId) : ''),
      productName: p?.name || '',
      stock: Number(p?.stock || 0),
      minStock: Number(p?.minStock || 0)
    }))
    .filter((it) => it.id)

  return {
    todayOrders: Number(todayOrders || 0),
    activeProductions: 0,
    activeCustomers: Number(activeCustomers || 0),
    todayRevenue,
    orderTrends,
    recentOrders,
    orderStatusDistribution,
    stockAlerts,
    productionStatus: { pending: 0, inProgress: 0, completed: 0, cancelled: 0 },
    financialSummary: { totalIncome: 0, totalExpense: 0, profit: 0, profitMargin: 0 },
    generatedAt: new Date(nowMs).toISOString(),
    _meta: { source: 'local_sqlite' }
  }
}

router.get('/system-metrics', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const minutes = Number(req.query?.minutes ?? 60)
  const windowMinutes = Number.isFinite(minutes) ? Math.max(1, Math.min(24 * 60, minutes)) : 60

  const cpuUsage = await getCPUUsage().catch(() => 0)
  const memory = getMemoryUsage()
  const processMemory = process.memoryUsage()

  let dbHealth = null
  try {
    if (process.env.MONGODB_URI) {
      await database.connect()
      const start = Date.now()
      await mongoose.connection.db.admin().ping()
      dbHealth = {
        state: mongoose.connection.readyState,
        pingMs: Date.now() - start
      }
    }
  } catch (_) {
    dbHealth = dbHealth || { state: mongoose.connection.readyState, pingMs: -1 }
  }

  let history = []
  try {
    if (process.env.MONGODB_URI) {
      await database.connect()
      const cutoff = new Date(Date.now() - windowMinutes * 60 * 1000)
      history = await mongoose.connection.db.collection('sync_performance_metrics')
        .find({ timestamp: { $gte: cutoff }, type: 'system_resources' })
        .sort({ timestamp: -1 })
        .limit(500)
        .toArray()
    }
  } catch (_) {
    history = []
  }

  return res.json({
    success: true,
    data: {
      current: {
        timestamp: new Date().toISOString(),
        cpuUsage,
        memory,
        processMemory,
        dbHealth
      },
      historyWindowMinutes: windowMinutes,
      history: history.map((row) => ({
        timestamp: row?.timestamp,
        data: row?.data || {}
      }))
    }
  })
}))

router.get('/stats', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const local = await buildLocalStats()
    return res.json({ success: true, data: local })
  }

  const ok = await ensureCloud()
  if (!ok) {
    const local = await buildLocalStats().catch(() => null)
    if (local) return res.json({ success: true, data: local })
    return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  }

  const ordersCol = cloudbaseService.getCollection('orders')
  const productsCol = cloudbaseService.getCollection('products')
  const customersCol = cloudbaseService.getCollection('customers')
  const _ = cloudbaseService.db.command

  const now = new Date()
  const nowMs = now.getTime()
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const tomorrowStart = todayStart + 24 * 60 * 60 * 1000

  const todayOrdersRes = await ordersCol.where({ _createTime: _.and(_.gte(todayStart), _.lt(tomorrowStart)) }).count().catch(() => ({ total: 0 }))
  const todayOrders = Number(todayOrdersRes?.total || 0)

  const todayOrdersList = await ordersCol
    .where({ _createTime: _.and(_.gte(todayStart), _.lt(tomorrowStart)) })
    .limit(500)
    .get()
    .catch(() => ({ data: [] }))
  const todayRevenue = (todayOrdersList?.data || []).reduce((sum, o) => sum + Number(o?.amount || o?.totalAmount || 0), 0)

  const customerCountRes = await customersCol.count().catch(() => ({ total: 0 }))
  const activeCustomers = Number(customerCountRes?.total || 0)

  const recentOrdersRes = await ordersCol.orderBy('_createTime', 'desc').limit(10).get().catch(() => ({ data: [] }))
  const recentOrders = (recentOrdersRes?.data || []).map(normalizeOrder)

  const last7Start = todayStart - 6 * 24 * 60 * 60 * 1000
  const last7OrdersRes = await ordersCol
    .where({ _createTime: _.and(_.gte(last7Start), _.lt(tomorrowStart)) })
    .limit(2000)
    .get()
    .catch(() => ({ data: [] }))
  const bucket = new Map()
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(todayStart - (6 - i) * 24 * 60 * 60 * 1000)
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    bucket.set(key, 0)
  }
  for (const o of last7OrdersRes?.data || []) {
    const t = Number(o?._createTime)
    if (!Number.isFinite(t)) continue
    const day = new Date(t)
    const key = `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
    if (bucket.has(key)) bucket.set(key, bucket.get(key) + 1)
  }
  const orderTrends = Array.from(bucket.entries()).map(([date, orders]) => ({ date, orders }))

  const statusCounts = new Map()
  const last30Start = todayStart - 29 * 24 * 60 * 60 * 1000
  const last30OrdersRes = await ordersCol
    .where({ _createTime: _.and(_.gte(last30Start), _.lt(tomorrowStart)) })
    .limit(5000)
    .get()
    .catch(() => ({ data: [] }))
  for (const o of last30OrdersRes?.data || []) {
    const s = String(o?.status || 'pending')
    statusCounts.set(s, (statusCounts.get(s) || 0) + 1)
  }
  const orderStatusDistribution = Array.from(statusCounts.entries()).map(([status, count]) => ({ status, count, name: status }))

  const productSampleRes = await productsCol
    .limit(2000)
    .get()
    .catch(() => ({ data: [] }))
  const stockAlerts = (productSampleRes?.data || [])
    .filter((p) => Number(p?.stock || 0) <= Number(p?.minStock || 0))
    .slice(0, 10)
    .map((p) => ({
    id: p?._id != null ? String(p._id) : '',
    productName: p?.name || p?.productName || '',
    stock: Number(p?.stock || 0),
    minStock: Number(p?.minStock || 0)
  })).filter((it) => it.id)

  return res.json({
    success: true,
    data: {
      todayOrders,
      activeProductions: 0,
      activeCustomers,
      todayRevenue,
      orderTrends,
      recentOrders,
      orderStatusDistribution,
      stockAlerts,
      productionStatus: { pending: 0, inProgress: 0, completed: 0, cancelled: 0 },
      financialSummary: { totalIncome: 0, totalExpense: 0, profit: 0, profitMargin: 0 },
      generatedAt: new Date(nowMs).toISOString()
    }
  })
}))

router.get('/recent', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    await ensureSqliteReady()
    const rows = await Order.findAll({ order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 10 }).catch(() => [])
    const recentOrders = (rows || []).map(normalizeSqliteOrder).filter(Boolean)
    return res.json({ success: true, data: { recentOrders, timestamp: new Date().toISOString(), _meta: { source: 'local_sqlite' } } })
  }

  const ok = await ensureCloud()
  if (!ok) {
    await ensureSqliteReady().catch(() => null)
    const rows = await Order.findAll({ order: [['createdAt', 'DESC'], ['id', 'DESC']], limit: 10 }).catch(() => [])
    const recentOrders = (rows || []).map(normalizeSqliteOrder).filter(Boolean)
    if (recentOrders.length) {
      return res.json({ success: true, data: { recentOrders, timestamp: new Date().toISOString(), _meta: { source: 'local_sqlite' } } })
    }
    return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  }

  const ordersCol = cloudbaseService.getCollection('orders')
  const recentOrdersRes = await ordersCol.orderBy('_createTime', 'desc').limit(10).get().catch(() => ({ data: [] }))
  const recentOrders = (recentOrdersRes?.data || []).map(normalizeOrder)

  return res.json({ success: true, data: { recentOrders, timestamp: new Date().toISOString() } })
}))

router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const local = await buildLocalStats()
    return res.json({ success: true, data: local })
  }

  const ok = await ensureCloud()
  if (!ok) {
    const local = await buildLocalStats().catch(() => null)
    if (local) return res.json({ success: true, data: local })
    return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  }
  return res.redirect(302, '/api/dashboard/stats')
}))

export default router
