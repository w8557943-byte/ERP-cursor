import express from 'express'
import { Op } from 'sequelize'
import { authenticateToken, requireAdmin, requireUser } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { syncDatabase } from '../utils/sqliteDatabase.js'
import Order from '../models/local/Order.js'

const router = express.Router()

let sqliteReadyPromise = null
const ensureSqliteReady = async () => {
  if (!sqliteReadyPromise) {
    sqliteReadyPromise = syncDatabase(false)
  }
  await sqliteReadyPromise
}

const safeNumber = (v, fallback) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const parseBool = (v, fallback) => {
  if (v === undefined || v === null || v === '') return fallback
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (['1', 'true', 'yes', 'y', 'on'].includes(s)) return true
  if (['0', 'false', 'no', 'n', 'off'].includes(s)) return false
  return fallback
}

const toDateOrNull = (v) => {
  if (!v) return null
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v
  const d = new Date(String(v))
  if (Number.isNaN(d.getTime())) return null
  return d
}

const normalizeStatusFilter = (input) => {
  if (input === undefined || input === null || input === '') return null
  if (Array.isArray(input)) {
    const list = input
      .flatMap((v) => String(v ?? '').split(','))
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
    return list.length ? list : null
  }
  const raw = String(input ?? '').trim()
  if (!raw) return null
  const list = raw
    .split(',')
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
  return list.length ? list : null
}

const normalizeOrder = (row, options = {}) => {
  if (!row) return null
  const src = typeof row.toJSON === 'function' ? row.toJSON() : row
  const id = String(src.id ?? '').trim()
  const orderNo = String(src.orderNo ?? '').trim()
  const includeProducts = options.includeProducts !== false
  const includeItems = options.includeItems !== false

  const out = {
    ...src,
    id,
    _id: id,
    key: id,
    orderNo,
    orderNumber: orderNo
  }

  if (!includeProducts) out.products = []
  if (!includeItems) out.items = []

  return out
}

const buildOrderBy = (orderByRaw) => {
  const orderBy = String(orderByRaw || '').trim()
  const normalized = orderBy.toLowerCase()
  if (normalized === 'createdat_asc') return [['createdAt', 'ASC'], ['id', 'ASC']]
  if (normalized === 'createdat_desc') return [['createdAt', 'DESC'], ['id', 'DESC']]
  if (normalized === 'updatedat_asc') return [['updatedAt', 'ASC'], ['id', 'ASC']]
  if (normalized === 'updatedat_desc') return [['updatedAt', 'DESC'], ['id', 'DESC']]
  if (normalized === 'orderno_asc') return [['orderNo', 'ASC'], ['id', 'ASC']]
  if (normalized === 'orderno_desc') return [['orderNo', 'DESC'], ['id', 'DESC']]
  return [['createdAt', 'DESC'], ['id', 'DESC']]
}

const keywordMatchOrder = (order, keywordLower) => {
  if (!keywordLower) return true
  const o = order && typeof order === 'object' ? order : {}
  const fields = [
    o.orderNo,
    o.orderNumber,
    o.customerName,
    o.supplierName,
    o.status,
    o.orderType,
    o.purchaseCategory,
    o.notes,
    o.phone,
    o.contactPerson
  ]
  for (const f of fields) {
    if (f == null) continue
    const s = String(f).toLowerCase()
    if (s.includes(keywordLower)) return true
  }
  const arrays = []
  if (Array.isArray(o.items)) arrays.push(o.items)
  if (Array.isArray(o.products)) arrays.push(o.products)
  for (const arr of arrays) {
    for (const it of arr) {
      const item = it && typeof it === 'object' ? it : {}
      for (const v of Object.values(item)) {
        if (v == null) continue
        if (typeof v === 'object') continue
        const s = String(v).toLowerCase()
        if (s.includes(keywordLower)) return true
      }
      const sku = item?.sku && typeof item.sku === 'object' ? item.sku : null
      if (sku) {
        for (const v of Object.values(sku)) {
          if (v == null) continue
          if (typeof v === 'object') continue
          const s = String(v).toLowerCase()
          if (s.includes(keywordLower)) return true
        }
      }
    }
  }
  return false
}

router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const q = req.query || {}
  const page = Math.max(1, safeNumber(q.page, 1))
  const limit = Math.min(1000, Math.max(1, safeNumber(q.limit ?? q.pageSize, 20)))
  const offset = (page - 1) * limit

  const keyword = String(q.keyword ?? q.search ?? q.q ?? '').trim()
  const keywordLower = keyword ? keyword.toLowerCase() : ''
  const withTotal = parseBool(q.withTotal, false)
  const withProducts = parseBool(q.withProducts, true)
  const orderType = String(q.orderType || '').trim()
  const excludeOrderType = String(q.excludeOrderType || '').trim()
  const purchaseCategory = String(q.purchaseCategory ?? q.category ?? q.purchase_category ?? '').trim()
  const customerId = String(q.customerId || '').trim()
  const supplierId = String(q.supplierId || '').trim()
  const start = toDateOrNull(q.startDate)
  const end = toDateOrNull(q.endDate)
  const statusList = normalizeStatusFilter(q.status)

  const where = {}
  if (statusList) where.status = statusList.length === 1 ? statusList[0] : { [Op.in]: statusList }
  if (customerId) where.customerId = customerId
  if (supplierId) where.supplierId = supplierId

  if (orderType) where.orderType = orderType
  if (excludeOrderType) where.orderType = { [Op.ne]: excludeOrderType }
  if (purchaseCategory) where.purchaseCategory = purchaseCategory

  if (start || end) {
    where.createdAt = {}
    if (start) where.createdAt[Op.gte] = start
    if (end) where.createdAt[Op.lte] = end
  }

  if (keyword) {
    const like = `%${keyword}%`
    where[Op.or] = [
      { orderNo: { [Op.like]: like } },
      { customerName: { [Op.like]: like } },
      { supplierName: { [Op.like]: like } },
      { status: { [Op.like]: like } },
      { notes: { [Op.like]: like } }
    ]
  }

  const order = buildOrderBy(q.orderBy)

  const baseQuery = {
    where,
    order,
    offset,
    limit
  }

  const rows = await Order.findAll(baseQuery)
  let orders = (rows || [])
    .map((r) => normalizeOrder(r, { includeProducts: withProducts, includeItems: withProducts }))
    .filter(Boolean)

  if (keyword && orders.length) {
    orders = orders.filter((o) => keywordMatchOrder(o, keywordLower))
  } else if (keyword && !orders.length) {
    const scanRows = await Order.findAll({
      where: {
        ...where,
        [Op.or]: undefined
      },
      order,
      limit: Math.min(5000, Math.max(200, limit * 10))
    })
    const scanned = (scanRows || [])
      .map((r) => normalizeOrder(r, { includeProducts: true, includeItems: true }))
      .filter(Boolean)
      .filter((o) => keywordMatchOrder(o, keywordLower))
    orders = scanned.slice(offset, offset + limit).map((o) => normalizeOrder(o, { includeProducts: withProducts, includeItems: withProducts }))
  }

  let total = 0
  if (withTotal) {
    total = await Order.count({ where })
  }
  const hasMore = withTotal ? (offset + orders.length < total) : (orders.length === limit)

  return res.json({
    success: true,
    data: {
      orders,
      pagination: {
        page,
        pageSize: limit,
        limit,
        total: withTotal ? total : undefined,
        totalPages: withTotal ? (total > 0 ? Math.ceil(total / limit) : 0) : undefined,
        hasMore
      },
      _meta: { source: 'local_sqlite' }
    }
  })
}))

router.get('/stats', authenticateToken, requireUser, asyncHandler(async (_req, res) => {
  await ensureSqliteReady()

  const total = await Order.count({ where: { orderType: { [Op.ne]: 'purchase' } } })
  const statuses = ['ordered', 'pending', 'processing', 'stocked', 'shipping', 'completed', 'cancelled']
  const byStatus = await Promise.all(statuses.map(async (s) => ({
    status: s,
    count: await Order.count({ where: { status: s, orderType: { [Op.ne]: 'purchase' } } })
  })))

  return res.json({
    success: true,
    data: {
      summary: {
        totalOrders: Number(total || 0)
      },
      byStatus
    }
  })
}))

router.get('/month-count', authenticateToken, requireUser, asyncHandler(async (_req, res) => {
  await ensureSqliteReady()

  const now = new Date()
  const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0)
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

  const monthCount = await Order.count({
    where: {
      orderType: { [Op.ne]: 'purchase' },
      createdAt: { [Op.gte]: start, [Op.lte]: end }
    }
  })

  return res.json({ success: true, data: { monthOrderCount: Number(monthCount || 0) } })
}))

router.get('/production-efficiency-stats', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const q = req.query || {}
  const period = String(q.period || '90d').trim().toLowerCase()
  const days = (() => {
    const m = period.match(/^(\d+)\s*d$/)
    if (!m) return 90
    const n = Number(m[1])
    return Number.isFinite(n) && n > 0 ? Math.min(3650, n) : 90
  })()
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)

  const baseWhere = {
    orderType: { [Op.ne]: 'purchase' },
    createdAt: { [Op.gte]: since }
  }

  const total = await Order.count({ where: baseWhere })
  const pending = await Order.count({ where: { ...baseWhere, status: 'pending' } })
  const processing = await Order.count({ where: { ...baseWhere, status: { [Op.in]: ['processing', 'producing'] } } })
  const completed = await Order.count({ where: { ...baseWhere, status: 'completed' } })

  const completedRate = total > 0 ? (completed / total) * 100 : 0

  return res.json({
    success: true,
    data: {
      summary: {
        total,
        pending,
        processing,
        completedRate,
        scrapRate: 0,
        avgDeliveryDays: 0,
        onTimeRate: 0
      }
    }
  })
}))

router.post('/boards/relink', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const purchaseOrderId = body.purchaseOrderId ?? body.purchaseId ?? body.id
  const purchaseOrderNo = String(body.purchaseOrderNo ?? body.orderNo ?? '').trim()
  const sourceOrderIds = Array.isArray(body.sourceOrderIds) ? body.sourceOrderIds : []
  const sourceOrders = Array.isArray(body.sourceOrders) ? body.sourceOrders : (Array.isArray(body.sources) ? body.sources : [])

  let purchaseOrder = null
  const maybeId = Number(purchaseOrderId)
  if (Number.isFinite(maybeId) && Number.isInteger(maybeId)) {
    purchaseOrder = await Order.findByPk(maybeId)
  }
  if (!purchaseOrder && purchaseOrderNo) {
    purchaseOrder = await Order.findOne({ where: { orderNo: purchaseOrderNo } })
  }

  if (purchaseOrder) {
    const existing = purchaseOrder.meta && typeof purchaseOrder.meta === 'object' ? purchaseOrder.meta : {}
    await purchaseOrder.update({
      meta: {
        ...existing,
        sourceOrders: sourceOrders.length ? sourceOrders : (existing.sourceOrders || []),
        sourceOrderIds: sourceOrderIds.length ? sourceOrderIds : (existing.sourceOrderIds || []),
        relinkedAt: new Date().toISOString()
      }
    })
  }

  const updates = []
  if (sourceOrderIds.length && (purchaseOrderNo || purchaseOrder)) {
    const poNo = purchaseOrderNo || purchaseOrder?.orderNo || ''
    const poId = purchaseOrder?.id != null ? String(purchaseOrder.id) : ''
    for (const id of sourceOrderIds) {
      const token = String(id || '').trim()
      if (!token) continue
      updates.push((async () => {
        const maybe = Number(token)
        let o = null
        if (Number.isFinite(maybe) && Number.isInteger(maybe)) o = await Order.findByPk(maybe)
        if (!o) o = await Order.findOne({ where: { cloudId: token } })
        if (!o) return
        const existing = o.meta && typeof o.meta === 'object' ? o.meta : {}
        await o.update({
          meta: {
            ...existing,
            purchaseOrderNo: poNo,
            purchaseOrderId: poId,
            purchaseOrderCreatedAt: existing.purchaseOrderCreatedAt || new Date().toISOString()
          }
        })
      })())
    }
  }

  await Promise.allSettled(updates)

  return res.json({ success: true, message: '关联更新成功', data: { updated: updates.length } })
}))

router.get('/group/:orderNo', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const raw = String(req.params.orderNo || '').trim()
  let token = raw
  try { token = decodeURIComponent(raw) } catch (_) { void 0 }
  token = String(token || '').trim()
  if (!token) return res.status(400).json({ success: false, message: '缺少订单号' })

  const parentNo = token.replace(/-\d+$/, '')
  const children = await Order.findAll({
    where: {
      orderNo: { [Op.like]: `${parentNo}-%` }
    },
    order: [['orderNo', 'ASC'], ['createdAt', 'ASC'], ['id', 'ASC']]
  })
  const parent = await Order.findOne({ where: { orderNo: parentNo } })

  return res.json({
    success: true,
    data: {
      parent: parent ? normalizeOrder(parent, { includeProducts: true, includeItems: true }) : null,
      children: (children || []).map((r) => normalizeOrder(r, { includeProducts: true, includeItems: true })).filter(Boolean)
    }
  })
}))

router.get('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const idRaw = String(req.params.id || '').trim()
  if (!idRaw) return res.status(400).json({ success: false, message: '缺少订单ID' })

  let order = null
  const maybeId = Number(idRaw)
  if (Number.isFinite(maybeId) && Number.isInteger(maybeId)) {
    order = await Order.findByPk(maybeId)
  }
  if (!order) {
    order = await Order.findOne({ where: { cloudId: idRaw } })
  }
  if (!order) {
    order = await Order.findOne({ where: { orderNo: idRaw } })
  }

  if (!order) return res.status(404).json({ success: false, message: '订单不存在' })
  return res.json({ success: true, data: { order: normalizeOrder(order, { includeProducts: true, includeItems: true }) } })
}))

router.post('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const orderNo = String(body.orderNo ?? body.orderNumber ?? body.no ?? '').trim()
  if (!orderNo) return res.status(400).json({ success: false, message: '缺少订单号' })

  const existingByOrderNo = await Order.findOne({ where: { orderNo } })
  if (existingByOrderNo) {
    return res.status(409).json({ success: false, message: '订单号已存在' })
  }

  const orderType = String(body.orderType || '').trim() || undefined
  const isPurchase = String(orderType || '').toLowerCase() === 'purchase' || String(body.source || '').toLowerCase() === 'purchased' || Boolean(body.supplierName)

  const customerId = String(body.customerId || '').trim()
  const customerName = String(body.customerName || '').trim()
  const supplierName = String(body.supplierName || '').trim()

  if (!isPurchase && (!customerId || !customerName)) {
    return res.status(400).json({ success: false, message: '缺少客户信息' })
  }
  if (isPurchase && !supplierName) {
    return res.status(400).json({ success: false, message: '缺少供应商信息' })
  }

  const items = Array.isArray(body.items) ? body.items : []
  const products = Array.isArray(body.products) ? body.products : []

  const totalsFromItems = items.reduce((acc, it) => {
    const src = it && typeof it === 'object' ? it : {}
    const qty = safeNumber(src.quantity ?? src.orderQty ?? src.orderQuantity ?? src.qty, 0)
    const up = safeNumber(src.unitPrice ?? src.salePrice ?? src.price, 0)
    const amount = safeNumber(src.amount, qty * up)
    acc.amount += Number.isFinite(amount) ? amount : 0
    return acc
  }, { amount: 0 })

  const totalAmount = safeNumber(body.totalAmount ?? body.amount, totalsFromItems.amount)
  const discount = safeNumber(body.discount, 0)
  const finalAmount = safeNumber(body.finalAmount ?? body.final_amount, Math.max(0, totalAmount - discount))

  const created = await Order.create({
    orderNo,
    orderType: isPurchase ? (orderType || 'purchase') : (orderType || 'sales'),
    purchaseCategory: body.purchaseCategory != null ? String(body.purchaseCategory) : (body.category != null ? String(body.category) : undefined),
    customerId: isPurchase ? (customerId || '') : customerId,
    customerName: isPurchase ? (customerName || '') : customerName,
    supplierId: body.supplierId != null ? String(body.supplierId) : undefined,
    supplierName: supplierName || undefined,
    contactPerson: body.contactPerson != null ? String(body.contactPerson) : undefined,
    phone: body.phone != null ? String(body.phone) : undefined,
    items,
    products,
    meta: body.meta && typeof body.meta === 'object' ? body.meta : {},
    totalAmount,
    discount,
    finalAmount,
    sheetCount: body.sheetCount != null ? parseInt(body.sheetCount) : undefined,
    status: body.status != null ? String(body.status) : undefined,
    paymentStatus: body.paymentStatus != null ? String(body.paymentStatus) : undefined,
    paymentMethod: body.paymentMethod != null ? String(body.paymentMethod) : undefined,
    paidAmount: body.paidAmount != null ? safeNumber(body.paidAmount, 0) : undefined,
    deliveryAddress: body.deliveryAddress != null ? String(body.deliveryAddress) : undefined,
    deliveryDate: body.deliveryDate ? toDateOrNull(body.deliveryDate) : undefined,
    actualDeliveryDate: body.actualDeliveryDate ? toDateOrNull(body.actualDeliveryDate) : undefined,
    notes: body.notes != null ? String(body.notes) : undefined,
    priority: body.priority != null ? String(body.priority) : undefined,
    source: body.source != null ? String(body.source) : undefined,
    wechatOrderId: body.wechatOrderId != null ? String(body.wechatOrderId) : undefined,
    createdBy: body.createdBy != null ? String(body.createdBy) : undefined
  })

  return res.status(201).json({ success: true, message: '订单创建成功', data: { order: normalizeOrder(created, { includeProducts: true, includeItems: true }) } })
}))

router.put('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const idRaw = String(req.params.id || '').trim()
  if (!idRaw) return res.status(400).json({ success: false, message: '缺少订单ID' })

  let order = null
  const maybeId = Number(idRaw)
  if (Number.isFinite(maybeId) && Number.isInteger(maybeId)) {
    order = await Order.findByPk(maybeId)
  }
  if (!order) {
    order = await Order.findOne({ where: { cloudId: idRaw } })
  }
  if (!order) return res.status(404).json({ success: false, message: '订单不存在' })

  const body = req.body && typeof req.body === 'object' ? req.body : {}
  const patch = {}
  const pick = (key, v) => {
    if (v === undefined) return
    patch[key] = v
  }

  pick('orderNo', body.orderNo != null ? String(body.orderNo) : (body.orderNumber != null ? String(body.orderNumber) : undefined))
  pick('orderType', body.orderType != null ? String(body.orderType) : undefined)
  pick('purchaseCategory', body.purchaseCategory != null ? String(body.purchaseCategory) : (body.category != null ? String(body.category) : undefined))
  pick('customerId', body.customerId != null ? String(body.customerId) : undefined)
  pick('customerName', body.customerName != null ? String(body.customerName) : undefined)
  pick('supplierId', body.supplierId != null ? String(body.supplierId) : undefined)
  pick('supplierName', body.supplierName != null ? String(body.supplierName) : undefined)
  pick('contactPerson', body.contactPerson != null ? String(body.contactPerson) : undefined)
  pick('phone', body.phone != null ? String(body.phone) : undefined)
  pick('items', Array.isArray(body.items) ? body.items : undefined)
  pick('products', Array.isArray(body.products) ? body.products : undefined)
  pick('meta', body.meta && typeof body.meta === 'object' ? body.meta : undefined)
  pick('totalAmount', body.totalAmount != null ? safeNumber(body.totalAmount, 0) : (body.amount != null ? safeNumber(body.amount, 0) : undefined))
  pick('discount', body.discount != null ? safeNumber(body.discount, 0) : undefined)
  pick('finalAmount', body.finalAmount != null ? safeNumber(body.finalAmount, 0) : undefined)
  pick('sheetCount', body.sheetCount != null ? parseInt(body.sheetCount) : undefined)
  pick('status', body.status != null ? String(body.status) : undefined)
  pick('paymentStatus', body.paymentStatus != null ? String(body.paymentStatus) : undefined)
  pick('paymentMethod', body.paymentMethod != null ? String(body.paymentMethod) : undefined)
  pick('paidAmount', body.paidAmount != null ? safeNumber(body.paidAmount, 0) : undefined)
  pick('deliveryAddress', body.deliveryAddress != null ? String(body.deliveryAddress) : undefined)
  pick('deliveryDate', body.deliveryDate ? toDateOrNull(body.deliveryDate) : undefined)
  pick('actualDeliveryDate', body.actualDeliveryDate ? toDateOrNull(body.actualDeliveryDate) : undefined)
  pick('notes', body.notes != null ? String(body.notes) : undefined)
  pick('priority', body.priority != null ? String(body.priority) : undefined)
  pick('source', body.source != null ? String(body.source) : undefined)
  pick('wechatOrderId', body.wechatOrderId != null ? String(body.wechatOrderId) : undefined)
  pick('assignedTo', body.assignedTo != null ? String(body.assignedTo) : undefined)
  pick('productionOrderId', body.productionOrderId != null ? String(body.productionOrderId) : undefined)

  await order.update(patch)
  return res.json({ success: true, message: '订单更新成功', data: { order: normalizeOrder(order, { includeProducts: true, includeItems: true }) } })
}))

router.delete('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const idRaw = String(req.params.id || '').trim()
  if (!idRaw) return res.status(400).json({ success: false, message: '缺少订单ID' })

  const resolveOrder = async (token) => {
    const t = String(token || '').trim()
    if (!t) return null
    const n = Number(t)
    if (Number.isFinite(n) && Number.isInteger(n)) {
      const byPk = await Order.findByPk(n)
      if (byPk) return byPk
    }
    const byCloud = await Order.findOne({ where: { cloudId: t } })
    if (byCloud) return byCloud
    return await Order.findOne({ where: { orderNo: t } })
  }

  const order = await resolveOrder(idRaw)
  if (!order) return res.status(404).json({ success: false, message: '订单不存在' })

  await order.destroy()
  return res.json({ success: true, message: '订单删除成功' })
}))

router.post('/:id/delete', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  await ensureSqliteReady()
  const idRaw = String(req.params.id || (req.body && req.body.id) || '').trim()
  if (!idRaw) return res.status(400).json({ success: false, message: '缺少订单ID' })

  const n = Number(idRaw)
  let order = null
  if (Number.isFinite(n) && Number.isInteger(n)) order = await Order.findByPk(n)
  if (!order) order = await Order.findOne({ where: { cloudId: idRaw } })
  if (!order) order = await Order.findOne({ where: { orderNo: idRaw } })
  if (!order) return res.status(404).json({ success: false, message: '订单不存在' })

  await order.destroy()
  return res.json({ success: true, message: '订单删除成功' })
}))

router.post('/delete', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  await ensureSqliteReady()
  const idRaw = String((req.body && req.body.id) || '').trim()
  if (!idRaw) return res.status(400).json({ success: false, message: '缺少订单ID' })

  const n = Number(idRaw)
  let order = null
  if (Number.isFinite(n) && Number.isInteger(n)) order = await Order.findByPk(n)
  if (!order) order = await Order.findOne({ where: { cloudId: idRaw } })
  if (!order) order = await Order.findOne({ where: { orderNo: idRaw } })
  if (!order) return res.status(404).json({ success: false, message: '订单不存在' })

  await order.destroy()
  return res.json({ success: true, message: '订单删除成功' })
}))

router.post('/fix-duplicate-order-nos', authenticateToken, requireAdmin, asyncHandler(async (_req, res) => {
  await ensureSqliteReady()
  return res.json({ success: true, message: '无需修复（本地订单号唯一）', data: { fixed: 0 } })
}))

router.get('/next-no', authenticateToken, requireUser, asyncHandler(async (_req, res) => {
  return res.status(404).json({ success: false, message: '请使用 /api/order-numbers/generate 生成订单号' })
}))

router.post('/next-no', authenticateToken, requireUser, asyncHandler(async (_req, res) => {
  return res.status(404).json({ success: false, message: '请使用 /api/order-numbers/generate 生成订单号' })
}))

router.post('/release-no', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { reservationId, orderNumber, orderNo, no } = req.body || {}
  const token = String(orderNumber ?? orderNo ?? no ?? '').trim()
  const rid = String(reservationId ?? '').trim()
  return res.json({ success: true, data: { orderNumber: token || rid, reservationId: rid || token } })
}))

export default router
