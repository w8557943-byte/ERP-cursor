/**
 * 微信小程序云开发数据库连接服务
 * 实现PC端与小程序云开发数据库的互通
 */

import cloudbase from '@cloudbase/node-sdk'
import { logger } from '../utils/logger.js'
import fs from 'fs/promises'

const isPemPrivateKey = (value) => {
  if (typeof value !== 'string') return false
  const v = value.trim()
  return v.includes('BEGIN') && v.includes('PRIVATE KEY')
}

const isAuthError = (error) => {
  const msg = String(error?.message || error || '').toLowerCase()
  if (!msg) return false
  return (
    msg.includes('permission') ||
    msg.includes('unauthorized') ||
    msg.includes('not authorized') ||
    msg.includes('access denied') ||
    msg.includes('auth') ||
    msg.includes('signature') ||
    msg.includes('secret') ||
    msg.includes('private key') ||
    msg.includes('credential') ||
    msg.includes('invalid key') ||
    msg.includes('鉴权') ||
    msg.includes('权限') ||
    msg.includes('签名') ||
    msg.includes('密钥')
  )
}

const isMissingCollectionError = (error) => {
  const msg = String(error?.message || error || '').toLowerCase()
  if (!msg) return false
  if (!msg.includes('collection')) return false
  return (
    msg.includes('not exist') ||
    msg.includes('does not exist') ||
    msg.includes('not found')
  )
}

const stripUndefinedDeep = (input) => {
  const seen = new WeakSet()
  const walk = (value) => {
    if (value === null || value === undefined) return value
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map(walk)
    if (typeof value !== 'object') return value
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue
      out[k] = walk(v)
    }
    return out
  }
  return walk(input)
}

class CloudbaseService {
  constructor() {
    this.app = null
    this.db = null
    this.initialized = false
    this.envId = ''
    this.credentialMode = ''
    this.lastInitError = ''
    this._syncStatusCache = null
    this._functionCache = new Map()
  }

  getCloudConfigStatus() {
    const envId = String(process.env.WECHAT_CLOUD_ENV_ID || process.env.WX_CLOUD_ENV || '').trim()
    const secretId = String(process.env.TCB_SECRET_ID || '').trim()
    const secretKey = String(process.env.TCB_SECRET_KEY || '').trim()
    const privateKeyId = String(process.env.WECHAT_API_KEY_ID || process.env.WECHAT_CLI_SECRET || '').trim()
    const privateKey = String(process.env.WECHAT_API_KEY || '').trim()

    const hasTcbSecret = Boolean(secretId && secretKey)
    const hasPem = Boolean(privateKeyId && privateKey && isPemPrivateKey(privateKey))

    const missing = []
    if (!envId) missing.push('WECHAT_CLOUD_ENV_ID/WX_CLOUD_ENV')
    if (!hasTcbSecret && !hasPem) {
      missing.push('TCB_SECRET_ID+TCB_SECRET_KEY 或 WECHAT_API_KEY_ID+WECHAT_API_KEY(PEM)')
    }

    return {
      ready: missing.length === 0,
      envIdConfigured: Boolean(envId),
      credentialMode: hasTcbSecret ? 'tcb_secret' : (hasPem ? 'wechat_pem' : 'none'),
      hasTcbSecret,
      hasPem,
      missing
    }
  }

  clearFunctionCache() {
    this._functionCache.clear()
  }

  /**
   * 初始化云开发环境
   */
  async initialize() {
    try {
      if (this.initialized) {
        return true
      }
      let envId = process.env.WECHAT_CLOUD_ENV_ID || process.env.WX_CLOUD_ENV
      if (!envId) {
        try {
          const url = new URL('../../../../cloudbaserc.json', import.meta.url)
          const raw = await fs.readFile(url, 'utf8')
          const json = JSON.parse(raw)
          if (json && json.envId) envId = String(json.envId)
        } catch (_) {}
      }
      const secretId = process.env.TCB_SECRET_ID
      const secretKey = process.env.TCB_SECRET_KEY
      const privateKeyId = process.env.WECHAT_API_KEY_ID
      const privateKey = process.env.WECHAT_API_KEY

      this.envId = envId ? String(envId) : ''
      this.lastInitError = ''

      // 调试信息
      console.log('[云开发调试] 环境变量检查:')
      console.log(`  - envId: ${envId ? String(envId) : '未配置'}`)
      console.log(`  - secretId: ${secretId ? '已配置 (长度:' + secretId.length + ')' : '未配置'}`)
      console.log(`  - secretKey: ${secretKey ? '已配置 (长度:' + secretKey.length + ')' : '未配置'}`)
      console.log(`  - privateKeyId: ${privateKeyId ? '已配置' : '未配置'}`)
      console.log(`  - privateKey: ${privateKey ? '已配置' : '未配置'}`)

      if (!envId) {
        console.log('[云开发调试] 失败原因: 缺少 envId')
        this.initialized = false
        this.lastInitError = '缺少云环境ID'
        return false
      }

      const config = { env: envId }
      if (secretId && secretKey) {
        console.log('[云开发调试] 使用 TCB_SECRET_ID 和 TCB_SECRET_KEY')
        this.credentialMode = 'tcb_secret'
        Object.assign(config, { secretId, secretKey })
      } else if (privateKeyId && privateKey && isPemPrivateKey(privateKey)) {
        console.log('[云开发调试] 使用 WECHAT_API_KEY_ID 和 WECHAT_API_KEY (PEM)')
        this.credentialMode = 'wechat_pem'
        Object.assign(config, { credentials: { private_key_id: privateKeyId, private_key: privateKey } })
      } else if (
        process.env.WECHAT_CLI_SECRET &&
        process.env.WECHAT_API_KEY &&
        isPemPrivateKey(process.env.WECHAT_API_KEY)
      ) {
        console.log('[云开发调试] 使用 WECHAT_CLI_SECRET 和 WECHAT_API_KEY (PEM)')
        this.credentialMode = 'wechat_cli_pem'
        Object.assign(config, { credentials: { private_key_id: process.env.WECHAT_CLI_SECRET, private_key: process.env.WECHAT_API_KEY } })
      } else {
        console.log('[云开发调试] 使用默认凭据')
        this.credentialMode = 'default'
      }

      console.log('[云开发调试] 正在初始化 cloudbase SDK...')
      this.app = cloudbase.init(config)
      this.db = this.app.database()

      console.log('[云开发调试] 正在测试数据库连接...')
      const testCollections = ['orders', 'customers']
      let testedOk = false
      let lastNonAuthError = ''
      for (const name of testCollections) {
        try {
          await this.db.collection(name).limit(1).get()
          console.log(`[云开发调试] 数据库连接测试成功 (使用 ${name} 集合)`)
          testedOk = true
          break
        } catch (e) {
          console.log(`[云开发调试] 数据库连接测试失败 (${name}):`, e?.message)
          if (isAuthError(e)) {
            console.log('[云开发调试] 失败原因: 凭据/权限校验失败')
            this.app = null
            this.db = null
            this.initialized = false
            this.lastInitError = `云数据库鉴权失败（env=${String(envId)}）`
            return false
          }
          if (isMissingCollectionError(e)) {
            console.log('[云开发调试] 集合不存在但连接可达，继续初始化')
            testedOk = true
            break
          }
          lastNonAuthError = String(e?.message || e || '').trim()
        }
      }
      if (!testedOk) {
        console.log('[云开发调试] 失败原因: 数据库连接测试未通过')
        this.app = null
        this.db = null
        this.initialized = false
        this.lastInitError = lastNonAuthError
          ? `云数据库连接测试失败：${lastNonAuthError}`
          : `云数据库连接测试失败（env=${String(envId)}）`
        return false
      }

      this.initialized = true
      logger.info('[云开发] 云开发环境初始化成功', { env: envId })
      return true
    } catch (error) {
      console.log('[云开发调试] 初始化异常:', error.message)
      logger.error('[云开发] 初始化失败', error)
      this.app = null
      this.db = null
      this.initialized = false
      this.lastInitError = error?.message ? String(error.message) : '初始化失败'
      return false
    }
  }

  /**
   * 获取数据库集合
   */
  getCollection(collectionName) {
    if (!this.initialized) {
      throw new Error('云开发服务未初始化')
    }
    return this.db.collection(collectionName)
  }

  /**
   * 同步客户数据到云开发数据库
   */
  async syncCustomersToCloudbase(customers) {
    try {
      const collection = this.getCollection('customers')
      const results = []
      const skipUnchanged = String(process.env.CLOUDBASE_SYNC_SKIP_UNCHANGED ?? 'true').toLowerCase() !== 'false'
      const chunkSize = Math.max(1, Number(process.env.CLOUDBASE_SYNC_CHUNK_SIZE || 100))
      const _ = this.db.command

      const items = (Array.isArray(customers) ? customers : []).map(customer => {
        const cloudbaseCustomer = this.transformCustomerToCloudbase(customer)
        const id = customer?._id ? String(customer._id) : cloudbaseCustomer?._id ? String(cloudbaseCustomer._id) : ''
        const { _id: __, ...data } = cloudbaseCustomer || {}
        const localUpdateTime = Number.isFinite(Number(cloudbaseCustomer?._updateTime)) ? Number(cloudbaseCustomer._updateTime) : 0
        return { id, data, localUpdateTime, rawId: customer?._id }
      })

      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize)
        const ids = chunk.map(it => it.id).filter(Boolean)
        const existingUpdateTimeById = new Map()

        if (skipUnchanged && ids.length > 0) {
          try {
            const existing = await collection.where({ _id: _.in(ids) }).limit(ids.length).get()
            for (const doc of existing?.data || []) {
              const id = doc?._id ? String(doc._id) : ''
              const t = Number.isFinite(Number(doc?._updateTime)) ? Number(doc._updateTime) : 0
              if (id) existingUpdateTimeById.set(id, t)
            }
          } catch (error) {
            logger.warn('[云开发] 批量获取客户用于跳过未变化数据失败，将继续写入', { error: error?.message })
          }
        }

        for (const item of chunk) {
          const id = item.id
          if (!id) {
            results.push({ id: item.rawId, action: 'error', success: false, error: 'missing_customer_id' })
            continue
          }
          try {
            const remoteUpdateTime = existingUpdateTimeById.get(id)
            if (skipUnchanged && existingUpdateTimeById.has(id) && item.localUpdateTime && remoteUpdateTime >= item.localUpdateTime) {
              results.push({ id, action: 'skip', success: true })
              continue
            }
            const safeData = stripUndefinedDeep(item.data)
            try {
              await collection.doc(id).update({ data: safeData })
              results.push({ id, action: 'update', success: true })
            } catch (error) {
              const docRes = await collection.doc(id).get().catch(() => null)
              const exists = Boolean(docRes && Array.isArray(docRes.data) && docRes.data.length > 0)
              if (!exists) {
                await collection.doc(id).set({ data: safeData })
                results.push({ id, action: 'create', success: true })
              } else {
                throw error
              }
            }
          } catch (error) {
            logger.error(`[云开发] 同步客户失败: ${id}`, error)
            results.push({ id, action: 'error', success: false, error: error.message })
          }
        }
      }

      return results
    } catch (error) {
      logger.error('[云开发] 同步客户数据失败', error)
      throw error
    }
  }

  /**
   * 从云开发数据库获取客户数据
   */
  async getCustomersFromCloudbase(options = {}) {
    try {
      const collection = this.getCollection('customers')
      const { limit = 100, offset = 0, where = {} } = options

      let total = 0
      let hasTotal = false
      try {
        const countRes = await collection.where(where).count()
        total = Number(countRes?.total || 0)
        hasTotal = true
      } catch (_) {
        total = 0
        hasTotal = false
      }

      const result = await collection
        .where(where)
        .limit(limit)
        .skip(offset)
        .get()

      // 转换数据格式以匹配PC端
      const customers = result.data.map(item => this.transformCustomerFromCloudbase(item))
      
      return {
        data: customers,
        total: hasTotal ? total : undefined,
        hasMore: hasTotal ? (offset + customers.length < total) : (customers.length === limit)
      }
    } catch (error) {
      logger.error('[云开发] 获取客户数据失败', error)
      throw error
    }
  }

  /**
   * 同步订单数据到云开发数据库
   */
  async syncOrdersToCloudbase(orders) {
    try {
      const collection = this.getCollection('orders')
      const results = []
      const skipUnchanged = String(process.env.CLOUDBASE_SYNC_SKIP_UNCHANGED ?? 'true').toLowerCase() !== 'false'
      const chunkSize = Math.max(1, Number(process.env.CLOUDBASE_SYNC_CHUNK_SIZE || 100))
      const _ = this.db.command
      const allowMergeByOrderNumber = String(process.env.CLOUDBASE_SYNC_MERGE_BY_ORDER_NUMBER ?? 'true').toLowerCase() !== 'false'

      const findExistingIdByOrderNumber = async (orderNumber) => {
        const no = String(orderNumber || '').trim()
        if (!no) return ''
        try {
          const hit = await collection.where({ orderNumber: no }).limit(1).get()
          const id = hit?.data?.[0]?._id ? String(hit.data[0]._id) : ''
          if (id) return id
        } catch (_) { void 0 }
        try {
          const hit = await collection.where({ orderNo: no }).limit(1).get()
          const id = hit?.data?.[0]?._id ? String(hit.data[0]._id) : ''
          if (id) return id
        } catch (_) { void 0 }
        return ''
      }

      const items = (Array.isArray(orders) ? orders : []).map(order => {
        const cloudbaseOrder = this.transformOrderToCloudbase(order)
        const id = order?._id ? String(order._id) : cloudbaseOrder?._id ? String(cloudbaseOrder._id) : ''
        const { _id: __, ...data } = cloudbaseOrder || {}
        const localUpdateTime = Number.isFinite(Number(cloudbaseOrder?._updateTime)) ? Number(cloudbaseOrder._updateTime) : 0
        return { id, data, localUpdateTime, rawId: order?._id }
      })

      for (let i = 0; i < items.length; i += chunkSize) {
        const chunk = items.slice(i, i + chunkSize)
        const ids = chunk.map(it => it.id).filter(Boolean)
        const existingUpdateTimeById = new Map()

        if (skipUnchanged && ids.length > 0) {
          try {
            const existing = await collection.where({ _id: _.in(ids) }).limit(ids.length).get()
            for (const doc of existing?.data || []) {
              const id = doc?._id ? String(doc._id) : ''
              const t = Number.isFinite(Number(doc?._updateTime)) ? Number(doc._updateTime) : 0
              if (id) existingUpdateTimeById.set(id, t)
            }
          } catch (error) {
            logger.warn('[云开发] 批量获取订单用于跳过未变化数据失败，将继续写入', { error: error?.message })
          }
        }

        for (const item of chunk) {
          const orderNumber = String(item?.data?.orderNumber || item?.data?.orderNo || '').trim()
          let id = item.id
          if (!id && allowMergeByOrderNumber && orderNumber) {
            const remoteId = await findExistingIdByOrderNumber(orderNumber)
            if (remoteId) id = remoteId
          }
          try {
            const remoteUpdateTime = existingUpdateTimeById.get(id)
            if (skipUnchanged && existingUpdateTimeById.has(id) && item.localUpdateTime && remoteUpdateTime >= item.localUpdateTime) {
              results.push({ id, action: 'skip', success: true })
              continue
            }
            const safeData = stripUndefinedDeep(item.data)
            try {
              if (id) {
                await collection.doc(id).update({ data: safeData })
                results.push({ id, action: 'update', success: true })
              } else {
                const addRes = await collection.add({ data: safeData })
                const newId = addRes?.id || addRes?._id || ''
                results.push({ id: newId || item.rawId, action: 'create', success: true })
              }
            } catch (error) {
              if (id) {
                const docRes = await collection.doc(id).get().catch(() => null)
                const exists = Boolean(docRes && Array.isArray(docRes.data) && docRes.data.length > 0)
                if (!exists) {
                  if (allowMergeByOrderNumber && orderNumber) {
                    const remoteId = await findExistingIdByOrderNumber(orderNumber)
                    if (remoteId && remoteId !== id) {
                      await collection.doc(remoteId).update({ data: safeData })
                      results.push({ id: remoteId, action: 'merge', success: true, fromId: id })
                      continue
                    }
                  }
                  await collection.doc(id).set({ data: safeData })
                  results.push({ id, action: 'create', success: true })
                } else {
                  throw error
                }
              } else {
                throw error
              }
            }
          } catch (error) {
            logger.error(`[云开发] 同步订单失败: ${id}`, error)
            results.push({ id, action: 'error', success: false, error: error.message })
          }
        }
      }

      return results
    } catch (error) {
      logger.error('[云开发] 同步订单数据失败', error)
      throw error
    }
  }

  /**
   * 转换客户数据格式 - PC端到云开发
   */
  transformCustomerToCloudbase(customer) {
    const createdAt = customer?.createdAt ? new Date(customer.createdAt).getTime() : Date.now()
    const updatedAt = customer?.updatedAt ? new Date(customer.updatedAt).getTime() : createdAt
    const name = customer?.name || customer?.companyName || customer?.company || ''
    const contact = customer?.contactPerson || customer?.contactName || customer?.contact || ''
    return {
      _id: customer._id.toString(),
      companyName: name,
      name,
      shortName: customer?.shortName || '',
      contactName: contact,
      contactPerson: contact,
      phone: customer?.phone,
      email: customer?.email || '',
      address: customer?.address || '',
      company: customer?.company || '',
      level: customer?.level || 'normal',
      status: customer?.status || 'active',
      notes: customer?.notes || '',
      tags: customer?.tags || [],
      createdAt,
      updatedAt,
      createdBy: customer.createdBy?.toString() || '',
      // 云开发专用字段
      _createTime: createdAt,
      _updateTime: updatedAt,
      source: 'pc_sync'
    }
  }

  /**
   * 转换客户数据格式 - 云开发到PC端
   */
  transformCustomerFromCloudbase(cloudbaseCustomer) {
    return {
      _id: cloudbaseCustomer._id,
      name: cloudbaseCustomer.name,
      phone: cloudbaseCustomer.phone,
      email: cloudbaseCustomer.email,
      address: cloudbaseCustomer.address,
      company: cloudbaseCustomer.company,
      level: cloudbaseCustomer.level,
      status: cloudbaseCustomer.status,
      notes: cloudbaseCustomer.notes,
      tags: cloudbaseCustomer.tags,
      createdAt: cloudbaseCustomer.createdAt,
      updatedAt: cloudbaseCustomer.updatedAt,
      createdBy: cloudbaseCustomer.createdBy,
      // 同步信息
      syncSource: 'cloudbase',
      syncTime: new Date()
    }
  }

  /**
   * 转换订单数据格式 - PC端到云开发
   */
  transformOrderToCloudbase(order) {
    const idStr = (order && (order._id || order.id)) ? String(order._id || order.id) : undefined
    const createdAt = order.createdAt || order.createTime || new Date().toISOString()
    const updatedAt = order.updatedAt || createdAt
    const orderNumber = order.orderNumber || order.orderNo || ''
    const rawItems = Array.isArray(order.items) ? order.items : []
    const summaryMode = String(process.env.CLOUDBASE_SYNC_ORDER_SUMMARY || 'false').toLowerCase() === 'true'
    const itemsLimit = Math.max(0, Number(process.env.CLOUDBASE_SYNC_ORDER_ITEMS_LIMIT || 5))
    const itemsPreview = summaryMode
      ? rawItems.slice(0, itemsLimit).map((it) => ({
          title: it?.title || it?.productName || it?.goodsName || it?.name || '',
          goodsName: it?.goodsName || it?.title || it?.productName || it?.name || '',
          quantity: Number(it?.quantity || 0),
          unit: it?.unit || undefined,
          unitPrice: it?.unitPrice != null ? Number(it.unitPrice) : undefined,
          salePrice: it?.salePrice != null ? Number(it.salePrice) : undefined,
          materialNo: it?.materialNo || undefined,
          spec: it?.spec || undefined
        }))
      : rawItems
    const totalQtyFromItems = summaryMode
      ? rawItems.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
      : undefined
    const doc = {
      orderNumber,
      orderNo: orderNumber,
      customerId: order.customerId ? String(order.customerId) : '',
      customerName: order.customerName || order.supplierName || '',
      items: itemsPreview,
      totalAmount: (order.totalAmount !== undefined ? order.totalAmount : (order.amount !== undefined ? Number(order.amount) : 0)) || 0,
      status: order.status || 'pending',
      paymentStatus: order.paymentStatus || 'unpaid',
      deliveryStatus: order.deliveryStatus || 'pending',
      notes: order.notes || '',
      createdAt,
      updatedAt,
      createdBy: order.createdBy ? String(order.createdBy) : '',
      _createTime: new Date(createdAt).getTime(),
      _updateTime: new Date(updatedAt).getTime(),
      source: order.source || 'pc_sync',
      orderType: order.orderType || undefined,
      supplierName: order.supplierName || undefined,
      goodsName: order.goodsName || order.productName || undefined,
      unit: order.unit || undefined,
      unitPrice: order.unitPrice !== undefined ? Number(order.unitPrice) : undefined,
      salePrice: order.salePrice !== undefined ? Number(order.salePrice) : undefined,
      purchaseCategory: order.purchaseCategory || undefined,
      materialNo: order.materialNo || undefined,
      sheetCount: order.sheetCount !== undefined ? Number(order.sheetCount) : undefined,
      itemsCount: summaryMode ? rawItems.length : undefined,
      itemsTruncated: summaryMode ? rawItems.length > itemsLimit : undefined,
      itemsTotalQty: summaryMode ? totalQtyFromItems : undefined
    }
    if (idStr) doc._id = idStr
    return doc
  }

  transformOrderFromCloudbase(cloudbaseOrder) {
    const cloudId = cloudbaseOrder?._id != null ? String(cloudbaseOrder._id) : ''
    const orderNo = String((cloudbaseOrder?.orderNumber ?? cloudbaseOrder?.orderNo ?? cloudId) || '').trim() || `CLOUD-${cloudId || Date.now()}`
    const totalAmount = Number(cloudbaseOrder?.totalAmount ?? cloudbaseOrder?.amount ?? 0) || 0
    const discount = Number(cloudbaseOrder?.discount ?? 0) || 0
    const finalAmount = Number(cloudbaseOrder?.finalAmount ?? (totalAmount - discount)) || 0
    const createdAt = cloudbaseOrder?.createdAt != null ? cloudbaseOrder.createdAt : (cloudbaseOrder?._createTime != null ? new Date(Number(cloudbaseOrder._createTime)).toISOString() : undefined)
    const updatedAt = cloudbaseOrder?.updatedAt != null ? cloudbaseOrder.updatedAt : (cloudbaseOrder?._updateTime != null ? new Date(Number(cloudbaseOrder._updateTime)).toISOString() : undefined)
    return {
      orderNo,
      orderType: cloudbaseOrder?.orderType != null ? String(cloudbaseOrder.orderType) : undefined,
      purchaseCategory: cloudbaseOrder?.purchaseCategory != null ? String(cloudbaseOrder.purchaseCategory) : undefined,
      customerId: cloudbaseOrder?.customerId != null ? String(cloudbaseOrder.customerId) : '',
      customerName: cloudbaseOrder?.customerName != null ? String(cloudbaseOrder.customerName) : (cloudbaseOrder?.supplierName != null ? String(cloudbaseOrder.supplierName) : ''),
      supplierName: cloudbaseOrder?.supplierName != null ? String(cloudbaseOrder.supplierName) : undefined,
      items: Array.isArray(cloudbaseOrder?.items) ? cloudbaseOrder.items : [],
      products: Array.isArray(cloudbaseOrder?.products) ? cloudbaseOrder.products : [],
      meta: cloudbaseOrder?.meta && typeof cloudbaseOrder.meta === 'object' ? cloudbaseOrder.meta : {},
      totalAmount,
      discount,
      finalAmount,
      sheetCount: cloudbaseOrder?.sheetCount != null ? Number(cloudbaseOrder.sheetCount) : undefined,
      status: cloudbaseOrder?.status != null ? String(cloudbaseOrder.status) : undefined,
      paymentStatus: cloudbaseOrder?.paymentStatus != null ? String(cloudbaseOrder.paymentStatus) : undefined,
      paymentMethod: cloudbaseOrder?.paymentMethod != null ? String(cloudbaseOrder.paymentMethod) : undefined,
      paidAmount: cloudbaseOrder?.paidAmount != null ? Number(cloudbaseOrder.paidAmount) : undefined,
      deliveryAddress: cloudbaseOrder?.deliveryAddress != null ? String(cloudbaseOrder.deliveryAddress) : undefined,
      notes: cloudbaseOrder?.notes != null ? String(cloudbaseOrder.notes) : undefined,
      priority: cloudbaseOrder?.priority != null ? String(cloudbaseOrder.priority) : undefined,
      source: cloudbaseOrder?.source != null ? String(cloudbaseOrder.source) : 'cloud',
      wechatOrderId: cloudbaseOrder?.wechatOrderId != null ? String(cloudbaseOrder.wechatOrderId) : undefined,
      createdBy: cloudbaseOrder?.createdBy != null ? String(cloudbaseOrder.createdBy) : undefined,
      cloudId: cloudId || undefined,
      createdAt,
      updatedAt,
      syncSource: 'cloudbase',
      syncTime: new Date()
    }
  }

  async createOrderInCloudbase(order) {
    const collection = this.getCollection('orders')
    const data = this.transformOrderToCloudbase(order)
    const result = await collection.add({ data })
    return result
  }

  /**
   * 调用云函数
   */
  async callFunction(name, params = {}) {
    if (!this.initialized) {
      throw new Error('云开发服务未初始化')
    }
    try {
      const action = params && typeof params === 'object' ? params.action : undefined
      const isReadAction = typeof action === 'string' && action.startsWith('get')
      const profile = String(process.env.CLOUDBASE_FUNCTION_PROFILE || '').toLowerCase() === 'true'
      const now = Date.now()
      if (name === 'erp-api' && action && !isReadAction) {
        this.clearFunctionCache()
      }
      if (name === 'erp-api' && isReadAction) {
        const ttlByAction = {
          getOrderStats: Number(process.env.CLOUDBASE_FUNCTION_CACHE_STATS_MS || 5000),
          getProductionEfficiencyStats: Number(process.env.CLOUDBASE_FUNCTION_CACHE_STATS_MS || 5000),
          getOrders: Number(process.env.CLOUDBASE_FUNCTION_CACHE_LIST_MS || 2000),
          getPurchaseOrders: Number(process.env.CLOUDBASE_FUNCTION_CACHE_LIST_MS || 2000),
          getOrderDetail: Number(process.env.CLOUDBASE_FUNCTION_CACHE_DETAIL_MS || 2000)
        }
        const ttlMs = Math.max(0, ttlByAction[action] ?? Number(process.env.CLOUDBASE_FUNCTION_CACHE_MS || 0))
        if (ttlMs > 0) {
          const key = `${name}:${action}:${JSON.stringify(params)}`
          const cached = this._functionCache.get(key)
          if (cached && cached.expireAt > now) {
            if (profile) {
              logger.info('[云开发] 调用云函数命中缓存', { name, action, cacheTtlMs: ttlMs })
            }
            return cached.value
          }
          const startedAt = profile ? Date.now() : 0
          const value = await this.app.callFunction({ name, data: params })
          if (profile) {
            logger.info('[云开发] 调用云函数完成', { name, action, cacheTtlMs: ttlMs, durationMs: Date.now() - startedAt })
          }
          this._functionCache.set(key, { expireAt: now + ttlMs, value })
          if (this._functionCache.size > 200) {
            const firstKey = this._functionCache.keys().next().value
            if (firstKey) this._functionCache.delete(firstKey)
          }
          return value
        }
      }
      const startedAt = profile ? Date.now() : 0
      const result = await this.app.callFunction({
        name,
        data: params
      })
      if (profile) {
        logger.info('[云开发] 调用云函数完成', { name, action, durationMs: Date.now() - startedAt })
      }
      return result
    } catch (error) {
      logger.error(`[云开发] 调用云函数 ${name} 失败`, { error, params })
      throw error
    }
  }

  /**
   * 获取同步状态
   */
  async getSyncStatus() {
    try {
      if (!this.initialized) {
        return { status: 'not_initialized' }
      }

      const ttlMs = Number(process.env.CLOUDBASE_SYNC_STATUS_CACHE_MS || 5000)
      const env = process.env.WECHAT_CLOUD_ENV_ID
      const now = Date.now()
      if (
        this._syncStatusCache &&
        this._syncStatusCache.env === env &&
        now - this._syncStatusCache.ts <= ttlMs
      ) {
        return this._syncStatusCache.value
      }

      // 获取最后同步时间
      const customerCollection = this.getCollection('customers')
      const lastCustomer = await customerCollection
        .orderBy('_updateTime', 'desc')
        .limit(1)
        .get()

      const orderCollection = this.getCollection('orders')
      const lastOrder = await orderCollection
        .orderBy('_updateTime', 'desc')
        .limit(1)
        .get()

      const value = {
        status: 'connected',
        environment: process.env.WECHAT_CLOUD_ENV_ID,
        lastCustomerSync: lastCustomer.data[0]?._updateTime || null,
        lastOrderSync: lastOrder.data[0]?._updateTime || null,
        collections: {
          customers: await this.getCollectionStats('customers'),
          orders: await this.getCollectionStats('orders')
        }
      }
      this._syncStatusCache = { ts: now, env, value }
      return value
    } catch (error) {
      logger.error('[云开发] 获取同步状态失败', error)
      return { status: 'error', error: error.message }
    }
  }

  /**
   * 获取集合统计信息
   */
  async getCollectionStats(collectionName) {
    try {
      const collection = this.getCollection(collectionName)
      const result = await collection.count()
      return {
        name: collectionName,
        count: result.total || 0
      }
    } catch (error) {
      logger.error(`[云开发] 获取${collectionName}统计失败`, error)
      return { name: collectionName, count: 0, error: error.message }
    }
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    try {
      if (!this.initialized) {
        return { healthy: false, message: '服务未初始化' }
      }

      // 测试数据库连接
      const stats = await this.getSyncStatus()
      return {
        healthy: true,
        status: stats.status,
        environment: stats.environment,
        timestamp: new Date().toISOString()
      }
    } catch (error) {
      return { healthy: false, error: error.message }
    }
  }
}

// 创建单例实例
const cloudbaseService = new CloudbaseService()

export default cloudbaseService
