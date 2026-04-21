import express from 'express'
import { Op } from 'sequelize'
import { authenticateToken, requireUser } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import { syncDatabase } from '../utils/sqliteDatabase.js'
import Customer from '../models/local/Customer.js'
import cloudbaseService from '../services/cloudbaseService.js'

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

const CUSTOMER_SKU_COLLECTION = String(process.env.CLOUDBASE_CUSTOMER_SKU_COLLECTION || 'customer_skus').trim() || 'customer_skus'

const ensureCloud = async () => {
  return await cloudbaseService.initialize().catch(() => false)
}

const normalizeText = (v) => {
  const s = String(v == null ? '' : v).trim()
  return s
}

const normalizeSku = (doc) => {
  if (!doc || typeof doc !== 'object') return null
  const rawId = doc._id != null ? String(doc._id) : (doc.id != null ? String(doc.id) : '')
  const id = rawId.trim()
  if (!id) return null
  return { ...doc, _id: id, id }
}

const normalizeCustomer = (row) => {
  if (!row) return null
  const src = typeof row.toJSON === 'function' ? row.toJSON() : row
  const id = String(src.id ?? '').trim()
  const name = String(src.name ?? '').trim()
  const shortName = src.shortName != null ? String(src.shortName) : ''
  const contactPerson = src.contactPerson != null ? String(src.contactPerson) : ''
  const phone = src.phone != null ? String(src.phone) : ''
  const email = src.email != null ? String(src.email) : ''
  const status = String(src.status || 'active')

  return {
    ...src,
    id,
    _id: id,
    name,
    companyName: name,
    shortName,
    contactPerson,
    contactName: contactPerson,
    phone,
    email,
    status
  }
}

const resolveLocalCustomerByAnyId = async (idRaw) => {
  await ensureSqliteReady()
  const token = normalizeText(idRaw)
  if (!token) return null

  const maybeId = Number(token)
  if (Number.isFinite(maybeId) && Number.isInteger(maybeId)) {
    const byPk = await Customer.findByPk(maybeId).catch(() => null)
    if (byPk) return byPk
  }

  const byCloudId = await Customer.findOne({ where: { cloudId: token } }).catch(() => null)
  if (byCloudId) return byCloudId

  const byCustomerCode = await Customer.findOne({ where: { customerCode: token } }).catch(() => null)
  if (byCustomerCode) return byCustomerCode

  return null
}

const buildCustomerIdCandidates = (idRaw, customer) => {
  const src = customer && typeof customer.toJSON === 'function' ? customer.toJSON() : customer
  const values = [
    normalizeText(idRaw),
    normalizeText(src?.cloudId),
    normalizeText(src?.customerCode),
    normalizeText(src?.name),
    normalizeText(src?.shortName),
    normalizeText(src?.wechatCustomerId),
    normalizeText(src?.wechatOpenId)
  ].filter(Boolean)
  return Array.from(new Set(values))
}

router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const {
    page = 1,
    pageSize = 10,
    limit = '',
    keyword = '',
    search = '',
    q = '',
    status = ''
  } = req.query || {}

  const finalPage = Math.max(1, safeNumber(page, 1))
  const requestedSize = safeNumber(pageSize || limit, 10)
  const finalPageSize = Math.min(100, Math.max(1, requestedSize))
  const offset = (finalPage - 1) * finalPageSize

  const kw = String(keyword || search || q || '').trim()
  const statusFilter = String(status || '').trim()

  const where = {}
  if (statusFilter) where.status = statusFilter

  if (kw) {
    const like = `%${kw}%`
    where[Op.or] = [
      { customerCode: { [Op.like]: like } },
      { name: { [Op.like]: like } },
      { shortName: { [Op.like]: like } },
      { contactPerson: { [Op.like]: like } },
      { phone: { [Op.like]: like } },
      { email: { [Op.like]: like } }
    ]
    const maybeId = Number(kw)
    if (Number.isFinite(maybeId) && Number.isInteger(maybeId)) {
      where[Op.or].unshift({ id: maybeId })
    }
  }

  const { rows, count } = await Customer.findAndCountAll({
    where,
    order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    offset,
    limit: finalPageSize
  })

  const customers = (rows || []).map(normalizeCustomer).filter(Boolean)
  const total = Number(count || 0)

  return res.json({
    success: true,
    data: {
      customers,
      pagination: {
        page: finalPage,
        pageSize: finalPageSize,
        total,
        totalPages: total > 0 ? Math.ceil(total / finalPageSize) : 0
      },
      _meta: { source: 'local_sqlite' }
    }
  })
}))

router.get('/stats', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const totalCustomers = await Customer.count()
  const activeCustomers = await Customer.count({ where: { status: 'active' } })

  return res.json({
    success: true,
    data: {
      summary: {
        totalCustomers: Number(totalCustomers || 0),
        activeCustomers: Number(activeCustomers || 0)
      }
    }
  })
}))

router.get('/sku-stats', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    await ensureSqliteReady()
    return res.json({
      success: true,
      data: {
        stats: [],
        totalSkus: 0,
        _meta: { source: 'local_sqlite' }
      }
    })
  }

  const collection = cloudbaseService.getCollection(CUSTOMER_SKU_COLLECTION)
  const command = cloudbaseService.db.command
  const pageSize = 500
  let lastId = ''
  let prevLastId = ''
  const countByCloudCustomerId = new Map()
  let scannedTotal = 0

  try {
    for (;;) {
      const where = lastId ? { _id: command.lt(lastId) } : {}
      const raw = await collection.where(where).orderBy('_id', 'desc').limit(pageSize).get()
      const rows = Array.isArray(raw?.data) ? raw.data : []
      if (!rows.length) break

      for (const doc of rows) {
        const rawCustomerId = doc?.customerId ?? doc?.customer_id ?? doc?.customer?.id
        const cloudCustomerId = normalizeText(rawCustomerId)
        if (!cloudCustomerId) continue
        countByCloudCustomerId.set(cloudCustomerId, (countByCloudCustomerId.get(cloudCustomerId) || 0) + 1)
      }

      scannedTotal += rows.length
      prevLastId = lastId
      lastId = rows[rows.length - 1]?._id != null ? String(rows[rows.length - 1]._id) : ''
      if (!lastId || lastId === prevLastId) break
      if (rows.length < pageSize) break
    }
  } catch (_) {
    return res.status(500).json({ success: false, message: `获取SKU统计失败：云端集合 ${CUSTOMER_SKU_COLLECTION} 查询异常` })
  }

  await ensureSqliteReady()
  const localCustomers = await Customer.findAll({
    attributes: ['id', 'cloudId', 'customerCode', 'name', 'shortName', 'wechatCustomerId', 'wechatOpenId']
  }).catch(() => [])

  const stats = (localCustomers || [])
    .map((c) => {
      const localId = normalizeText(c?.id)
      if (!localId) return null
      const candidates = buildCustomerIdCandidates(localId, c)
      let skuCount = 0
      for (const key of candidates) {
        const n = countByCloudCustomerId.get(key)
        if (Number.isFinite(Number(n)) && Number(n) > 0) {
          skuCount = Number(n)
          break
        }
      }
      if (!skuCount) return null
      return { customerId: localId, skuCount }
    })
    .filter(Boolean)

  const totalSkus = stats.reduce((sum, r) => sum + Number(r?.skuCount || 0), 0)

  return res.json({
    success: true,
    data: {
      stats,
      totalSkus,
      _meta: { source: 'cloudbase', collection: CUSTOMER_SKU_COLLECTION, scannedTotal }
    }
  })
}))

router.get('/:id/skus', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const idRaw = normalizeText(req.params.id)
  if (!idRaw) return res.status(400).json({ success: false, message: '客户ID不能为空' })

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  }

  const localCustomer = await resolveLocalCustomerByAnyId(idRaw)
  const candidates = buildCustomerIdCandidates(idRaw, localCustomer)

  const {
    page = 1,
    pageSize = 10,
    limit = '',
    keyword = '',
    search = '',
    q = ''
  } = req.query || {}

  const kw = normalizeText(keyword || search || q)
  const finalPage = Math.max(1, safeNumber(page, 1))
  const requestedSize = safeNumber(pageSize || limit, 10)
  const finalPageSize = Math.min(200, Math.max(1, requestedSize))
  const offset = (finalPage - 1) * finalPageSize

  const collection = cloudbaseService.getCollection(CUSTOMER_SKU_COLLECTION)
  const command = cloudbaseService.db.command

  if (kw) {
    const scanMax = 2000
    const batchSize = 500
    const all = []
    let skip = 0
    while (all.length < scanMax) {
      const take = Math.min(batchSize, scanMax - all.length)
      let raw = null
      try {
        raw = await collection.where({ customerId: command.in(candidates) }).orderBy('_updateTime', 'desc').skip(skip).limit(take).get()
      } catch (_) {
        try {
          raw = await collection.where({ customerId: command.in(candidates) }).orderBy('updatedAt', 'desc').skip(skip).limit(take).get()
        } catch (_) {
          try {
            raw = await collection.where({ customer_id: command.in(candidates) }).orderBy('_updateTime', 'desc').skip(skip).limit(take).get()
          } catch (_) {
            raw = await collection.where({ customer_id: command.in(candidates) }).skip(skip).limit(take).get()
          }
        }
      }
      const batch = Array.isArray(raw?.data) ? raw.data : []
      if (!batch.length) break
      all.push(...batch)
      if (batch.length < take) break
      skip += take
    }

    const filtered = all
      .map(normalizeSku)
      .filter(Boolean)
      .filter((it) => {
        const text = JSON.stringify({
          category: it.category,
          materialNo: it.materialNo,
          name: it.name,
          specification: it.specification,
          materialCode: it.materialCode,
          flute: it.flute,
          supplierName: it.supplierName,
          unit: it.unit,
          productionMode: it.productionMode,
          joinMethod: it.joinMethod || it.join_method
        })
        return text.includes(kw)
      })

    const total = filtered.length
    const pageList = filtered.slice(offset, offset + finalPageSize)
    return res.json({
      success: true,
      data: {
        skus: pageList,
        pagination: {
          page: finalPage,
          pageSize: finalPageSize,
          total,
          totalPages: total > 0 ? Math.ceil(total / finalPageSize) : 0
        }
      }
    })
  }

  let total = 0
  try {
    const counted = await collection.where({ customerId: command.in(candidates) }).count()
    total = Number(counted?.total || 0)
  } catch (_) {
    try {
      const counted = await collection.where({ customer_id: command.in(candidates) }).count()
      total = Number(counted?.total || 0)
    } catch (_) {
      total = 0
    }
  }

  let listRes = null
  try {
    listRes = await collection.where({ customerId: command.in(candidates) }).orderBy('_updateTime', 'desc').skip(offset).limit(finalPageSize).get()
  } catch (_) {
    try {
      listRes = await collection.where({ customerId: command.in(candidates) }).orderBy('updatedAt', 'desc').skip(offset).limit(finalPageSize).get()
    } catch (_) {
      try {
        listRes = await collection.where({ customer_id: command.in(candidates) }).orderBy('_updateTime', 'desc').skip(offset).limit(finalPageSize).get()
      } catch (_) {
        listRes = await collection.where({ customer_id: command.in(candidates) }).skip(offset).limit(finalPageSize).get()
      }
    }
  }

  const list = (listRes?.data || []).map(normalizeSku).filter(Boolean)
  return res.json({
    success: true,
    data: {
      skus: list,
      pagination: {
        page: finalPage,
        pageSize: finalPageSize,
        total,
        totalPages: total > 0 ? Math.ceil(total / finalPageSize) : 0
      }
    }
  })
}))

router.get('/:id/skus/:skuId', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const customerId = normalizeText(req.params.id)
  const skuId = normalizeText(req.params.skuId)
  if (!customerId) return res.status(400).json({ success: false, message: '客户ID不能为空' })
  if (!skuId) return res.status(400).json({ success: false, message: 'SKU ID不能为空' })

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  }

  const collection = cloudbaseService.getCollection(CUSTOMER_SKU_COLLECTION)
  const got = await collection.doc(String(skuId)).get().catch(() => null)
  const row = got?.data ? (Array.isArray(got.data) ? got.data[0] : got.data) : null
  if (!row) return res.status(404).json({ success: false, message: 'SKU不存在' })

  const actualCustomerId = normalizeText(row?.customerId ?? row?.customer_id ?? row?.customer?.id)
  if (actualCustomerId && actualCustomerId !== customerId) {
    return res.status(409).json({ success: false, message: 'SKU不属于该客户', data: { actualCustomerId } })
  }

  return res.json({ success: true, data: { sku: normalizeSku(row) } })
}))

router.get('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const idRaw = String(req.params.id || '').trim()
  if (!idRaw) return res.status(400).json({ success: false, message: '客户ID不能为空' })

  let customer = null
  const maybeId = Number(idRaw)
  if (Number.isFinite(maybeId) && Number.isInteger(maybeId)) {
    customer = await Customer.findByPk(maybeId)
  }
  if (!customer) {
    customer = await Customer.findOne({ where: { cloudId: idRaw } })
  }
  if (!customer) {
    customer = await Customer.findOne({ where: { customerCode: idRaw } })
  }

  if (!customer) return res.status(404).json({ success: false, message: '客户不存在' })
  return res.json({ success: true, data: { customer: normalizeCustomer(customer) } })
}))

router.post('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const body = req.body || {}
  const customerCode = String(body.customerCode || body.code || '').trim()
  const name = String(body.name || body.companyName || '').trim()
  const contactPerson = String(body.contactPerson || body.contactName || body.contact || '').trim()
  const phone = body.phone != null ? String(body.phone) : ''

  if (!customerCode || !name || !contactPerson || !String(phone || '').trim()) {
    return res.status(400).json({ success: false, message: '客户编码、名称、联系人、电话不能为空' })
  }

  const created = await Customer.create({
    customerCode,
    name,
    shortName: body.shortName != null ? String(body.shortName) : undefined,
    type: body.type != null ? String(body.type) : undefined,
    contactPerson,
    phone: String(phone),
    email: body.email != null ? String(body.email) : undefined,
    address: body.address != null ? String(body.address) : undefined,
    province: body.province != null ? String(body.province) : undefined,
    city: body.city != null ? String(body.city) : undefined,
    district: body.district != null ? String(body.district) : undefined,
    industry: body.industry != null ? String(body.industry) : undefined,
    creditRating: body.creditRating != null ? String(body.creditRating) : undefined,
    creditLimit: body.creditLimit != null ? Number(body.creditLimit) : undefined,
    status: body.status != null ? String(body.status) : undefined,
    source: body.source != null ? String(body.source) : undefined,
    wechatCustomerId: body.wechatCustomerId != null ? String(body.wechatCustomerId) : undefined,
    wechatOpenId: body.wechatOpenId != null ? String(body.wechatOpenId) : undefined,
    notes: body.notes != null ? String(body.notes) : undefined,
    tags: Array.isArray(body.tags) ? body.tags : undefined,
    createdBy: body.createdBy != null ? String(body.createdBy) : undefined
  })

  return res.status(201).json({ success: true, message: '客户创建成功', data: { customer: normalizeCustomer(created) } })
}))

router.put('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const idRaw = String(req.params.id || '').trim()
  if (!idRaw) return res.status(400).json({ success: false, message: '客户ID不能为空' })

  let customer = null
  const maybeId = Number(idRaw)
  if (Number.isFinite(maybeId) && Number.isInteger(maybeId)) {
    customer = await Customer.findByPk(maybeId)
  }
  if (!customer) {
    customer = await Customer.findOne({ where: { cloudId: idRaw } })
  }
  if (!customer) return res.status(404).json({ success: false, message: '客户不存在' })

  const body = req.body || {}
  const patch = {}
  const pick = (key, v) => {
    if (v === undefined) return
    patch[key] = v
  }

  pick('customerCode', body.customerCode != null ? String(body.customerCode) : undefined)
  pick('name', body.name != null ? String(body.name) : (body.companyName != null ? String(body.companyName) : undefined))
  pick('shortName', body.shortName != null ? String(body.shortName) : undefined)
  pick('type', body.type != null ? String(body.type) : undefined)
  pick('contactPerson', body.contactPerson != null ? String(body.contactPerson) : (body.contactName != null ? String(body.contactName) : (body.contact != null ? String(body.contact) : undefined)))
  pick('phone', body.phone != null ? String(body.phone) : undefined)
  pick('email', body.email != null ? String(body.email) : undefined)
  pick('address', body.address != null ? String(body.address) : undefined)
  pick('province', body.province != null ? String(body.province) : undefined)
  pick('city', body.city != null ? String(body.city) : undefined)
  pick('district', body.district != null ? String(body.district) : undefined)
  pick('industry', body.industry != null ? String(body.industry) : undefined)
  pick('creditRating', body.creditRating != null ? String(body.creditRating) : undefined)
  pick('creditLimit', body.creditLimit != null ? Number(body.creditLimit) : undefined)
  pick('currentBalance', body.currentBalance != null ? Number(body.currentBalance) : undefined)
  pick('status', body.status != null ? String(body.status) : undefined)
  pick('source', body.source != null ? String(body.source) : undefined)
  pick('wechatCustomerId', body.wechatCustomerId != null ? String(body.wechatCustomerId) : undefined)
  pick('wechatOpenId', body.wechatOpenId != null ? String(body.wechatOpenId) : undefined)
  pick('notes', body.notes != null ? String(body.notes) : undefined)
  pick('tags', Array.isArray(body.tags) ? body.tags : undefined)

  await customer.update(patch)
  return res.json({ success: true, message: '客户更新成功', data: { customer: normalizeCustomer(customer) } })
}))

router.delete('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  await ensureSqliteReady()

  const idRaw = String(req.params.id || '').trim()
  if (!idRaw) return res.status(400).json({ success: false, message: '客户ID不能为空' })

  let customer = null
  const maybeId = Number(idRaw)
  if (Number.isFinite(maybeId) && Number.isInteger(maybeId)) {
    customer = await Customer.findByPk(maybeId)
  }
  if (!customer) {
    customer = await Customer.findOne({ where: { cloudId: idRaw } })
  }
  if (!customer) return res.status(404).json({ success: false, message: '客户不存在' })

  await customer.destroy()
  return res.json({ success: true, message: '客户删除成功' })
}))

export default router
