/**
 * 云开发数据同步服务
 * 架构目标：本地 SQLite 为主，云端仅作为备份存储。
 */

import { Op } from 'sequelize'
import cloudbaseService from './cloudbaseService.js'
import syncService from './syncService.js'
import { logger } from '../utils/logger.js'
import { syncDatabase } from '../utils/sqliteDatabase.js'
import Customer from '../models/local/Customer.js'
import Order from '../models/local/Order.js'
import Product from '../models/local/Product.js'

class CloudSyncService {
  constructor() {
    this.syncInProgress = false
    this.lastSyncTime = null
    this.lastPullTime = null
  }

  getSyncModels() {
    return [
      { name: 'customers', model: Customer },
      { name: 'orders', model: Order },
      { name: 'products', model: Product }
    ]
  }

  async initialize() {
    try {
      await syncDatabase(false)
      const ok = await cloudbaseService.initialize()
      if (!ok) {
        logger.warn('[云同步] 云开发未配置，跳过初始化')
        return false
      }
      logger.info('[云同步] 云开发同步服务初始化成功（本地SQLite主模式）')
      return true
    } catch (error) {
      logger.error('[云同步] 初始化失败', error)
      return false
    }
  }

  async performFullSyncToCloudbase() {
    return this._syncLocalToCloud({ mode: 'full' })
  }

  async performIncrementalSyncToCloudbase(options = {}) {
    return this._syncLocalToCloud({ mode: 'incremental', lastSyncTime: options?.lastSyncTime })
  }

  async _syncLocalToCloud({ mode = 'incremental', lastSyncTime } = {}) {
    if (this.syncInProgress) {
      logger.warn('[云同步] 同步正在进行中，跳过本次请求')
      return { success: false, message: '同步正在进行中' }
    }

    this.syncInProgress = true
    const startedAt = Date.now()
    const isFull = String(mode).toLowerCase() === 'full'
    const since = lastSyncTime ? new Date(lastSyncTime) : this.lastSyncTime

    try {
      await syncDatabase(false)
      const ok = await cloudbaseService.initialize().catch(() => false)
      if (!ok) {
        return { success: false, message: cloudbaseService?.lastInitError || '云开发服务不可用' }
      }

      const results = {}
      let totalSuccess = 0
      let totalFailed = 0

      for (const { name, model } of this.getSyncModels()) {
        const where = isFull
          ? {}
          : (since
            ? {
                [Op.or]: [
                  { syncStatus: 'pending' },
                  { updatedAt: { [Op.gte]: since } }
                ]
              }
            : { syncStatus: 'pending' })

        const rows = await model.findAll({
          where,
          order: [['updatedAt', 'ASC'], ['id', 'ASC']],
          limit: 5000
        })

        let success = 0
        let failed = 0
        for (const row of rows || []) {
          const ok = await syncService.sync(row, name, { force: true })
          if (ok) success += 1
          else failed += 1
        }

        totalSuccess += success
        totalFailed += failed
        results[name] = { total: (rows || []).length, success, failed }
      }

      this.lastSyncTime = new Date()
      const duration = Date.now() - startedAt
      logger.info('[云同步] 本地到云端同步完成', { mode: isFull ? 'full' : 'incremental', duration, results })

      return {
        success: true,
        timestamp: this.lastSyncTime,
        results,
        summary: {
          mode: isFull ? 'full' : 'incremental',
          totalSuccess,
          totalFailed,
          duration
        }
      }
    } catch (error) {
      logger.error('[云同步] 本地到云端同步失败', error)
      throw error
    } finally {
      this.syncInProgress = false
    }
  }

  async syncFromCloudbase(options = {}) {
    if (this.syncInProgress) {
      return { success: false, message: '同步正在进行中' }
    }
    this.syncInProgress = true
    const startedAt = Date.now()
    try {
      const wipe = Boolean(options?.wipe)
      const maxRecordsPerCollection = Math.max(1, Number(options?.maxRecordsPerCollection || 20000))
      const allowInput = Array.isArray(options?.collections) ? options.collections : []
      const allow = new Set(
        (allowInput.length ? allowInput : ['customers', 'orders', 'products'])
          .map((x) => String(x || '').trim())
          .filter(Boolean)
      )

      await syncDatabase(false)
      const ok = await cloudbaseService.initialize().catch(() => false)
      if (!ok) {
        return { success: false, message: cloudbaseService?.lastInitError || '云开发服务不可用' }
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

      if (wipe) {
        if (allow.has('orders')) await Order.destroy({ where: {}, truncate: false })
        if (allow.has('customers')) await Customer.destroy({ where: {}, truncate: false })
        if (allow.has('products')) await Product.destroy({ where: {}, truncate: false })
      }

      const results = {}

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
            source: 'cloud',
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
        results.orders = { total: docs.length, created, updated }
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
            source: 'cloud',
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
        results.customers = { total: docs.length, created, updated }
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
            source: 'cloud',
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
        results.products = { total: docs.length, created, updated }
      }

      this.lastPullTime = new Date()
      const duration = Date.now() - startedAt
      logger.info('[云同步] 云端到本地拉取完成', { wipe, duration, results })

      return {
        success: true,
        timestamp: this.lastPullTime,
        results,
        summary: { wipe, duration }
      }
    } catch (error) {
      logger.error('[云同步] 云端到本地拉取失败', error)
      return { success: false, message: error.message || '拉取失败', error: error.message }
    } finally {
      this.syncInProgress = false
    }
  }

  /**
   * 检查云同步服务健康状态
   */
  async healthCheck() {
    try {
      const ok = await cloudbaseService.initialize().catch(() => false)
      if (!ok) {
        return { healthy: false, message: cloudbaseService?.lastInitError || '云开发未连接' }
      }
      return { healthy: true, message: '云开发已连接' }
    } catch (e) {
      return { healthy: false, message: e.message }
    }
  }
}

const cloudSyncService = new CloudSyncService()

export default cloudSyncService
