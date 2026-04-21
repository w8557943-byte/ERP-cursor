import express from 'express'
import { authenticateToken, requireUser, requireAdmin } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import cloudbaseService from '../services/cloudbaseService.js'
import { getLocalDoc, listLocalDocs, upsertLocalDoc } from '../utils/localDocStore.js'

const router = express.Router()

const isOfflineMode = () => String(process.env.OFFLINE_MODE || '').toLowerCase() === 'true'

const ensureCloud = async () => {
  const ok = await cloudbaseService.initialize().catch(() => false)
  return ok
}

const formatCloudCollectionError = (error, collectionName) => {
  const raw = String(error?.message || error || '')
  const lower = raw.toLowerCase()
  if (
    lower.includes('permission') ||
    lower.includes('unauthorized') ||
    lower.includes('not authorized') ||
    lower.includes('access denied') ||
    lower.includes('auth')
  ) {
    const env = cloudbaseService?.envId ? String(cloudbaseService.envId).trim() : ''
    return `云数据库权限不足：请在云开发控制台为集合「${collectionName}」配置可读写权限${env ? `（env=${env}）` : ''}`
  }
  if (
    lower.includes('collection') &&
    (lower.includes('not exist') || lower.includes('does not exist') || lower.includes('not found'))
  ) {
    const env = cloudbaseService?.envId ? String(cloudbaseService.envId).trim() : ''
    return `云数据库缺少集合「${collectionName}」：请先创建集合并配置权限${env ? `（env=${env}）` : ''}`
  }
  const env = cloudbaseService?.envId ? String(cloudbaseService.envId).trim() : ''
  return `云数据库操作失败：${raw || '未知错误'}${env ? `（env=${env}）` : ''}`
}

const normalizeIdSegment = (v) => {
  const s = String(v == null ? '' : v).trim()
  if (!s) return ''
  const parts = s.split(/[\\/]/).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : s
}

const buildSupplierIdCandidates = (supplierIdRaw) => {
  const raw = String(supplierIdRaw == null ? '' : supplierIdRaw).trim()
  const seg = normalizeIdSegment(raw)
  const out = new Set()
  if (raw) out.add(raw)
  if (seg) out.add(seg)
  if (seg) out.add(`suppliers/${seg}`)
  return Array.from(out).filter(Boolean)
}

const fetchAllDocs = async (collection, where = {}, options = {}) => {
  const pageSize = Number(options.pageSize || 100)
  const maxPages = Number(options.maxPages || 40)
  const orderByField = options.orderByField ? String(options.orderByField) : ''
  const orderByDirection = options.orderByDirection ? String(options.orderByDirection) : 'desc'

  const all = []
  for (let page = 1; page <= maxPages; page += 1) {
    const offset = (page - 1) * pageSize
    let q = collection.where(where)
    if (orderByField) {
      try {
        q = q.orderBy(orderByField, orderByDirection)
      } catch (_) { void 0 }
    }
    const raw = await q.skip(offset).limit(pageSize).get()
    const rows = (raw?.data || [])
    if (!rows.length) break
    all.push(...rows)
    if (rows.length < pageSize) break
  }
  return all
}

const normalizeSupplier = (doc) => {
  if (!doc) return null
  const id = doc?._id != null ? String(doc._id) : ''
  const name = doc?.name || doc?.companyName || doc?.title || ''
  const shortName = doc?.shortName || ''
  const contactName = doc?.contactName || doc?.contact || doc?.contactPerson || ''
  const createdAt = doc?.createdAt || doc?.createdTime || doc?._createTime || null
  const updatedAt = doc?.updatedAt || doc?.updateTime || doc?._updateTime || null
  const industry =
    doc?.industry ??
    doc?.industryName ??
    doc?.industry_name ??
    doc?.trade ??
    doc?.category ??
    doc?.type ??
    ''
  const address =
    doc?.address ??
    doc?.companyAddress ??
    doc?.company_address ??
    doc?.addr ??
    doc?.location ??
    doc?.addressText ??
    doc?.address_text ??
    ''
  return {
    _id: id,
    id,
    name,
    companyName: name,
    shortName,
    contactName,
    contact: contactName,
    phone: doc?.phone || '',
    email: doc?.email || '',
    industry: industry != null ? String(industry) : '',
    address: address != null ? String(address) : '',
    status: doc?.status || 'active',
    createdBy: doc?.createdBy || '',
    createdAt,
    updatedAt
  }
}

// 恢复已删除供应商
router.post('/restore', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const { id } = req.body || {}
    const supplierId = String(id || '').trim()
    if (!supplierId) return res.status(400).json({ success: false, message: '供应商ID不能为空' })
    const candidates = buildSupplierIdCandidates(supplierId)
    let doc = null
    let usedId = ''
    for (const cid of candidates) {
      const found = await getLocalDoc('suppliers', cid).catch(() => null)
      if (found) {
        doc = found
        usedId = cid
        break
      }
    }
    if (!doc) return res.status(404).json({ success: false, message: '供应商不存在' })
    const nowTs = Date.now()
    const patched = { ...doc, isDeleted: false, deletedAt: null, status: 'active', updatedAt: nowTs, _updateTime: nowTs }
    await upsertLocalDoc('suppliers', patched, usedId)
    return res.json({ success: true, message: '供应商恢复成功', data: { supplier: normalizeSupplier({ ...patched, _id: usedId }) } })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const { id } = req.body || {}
  const supplierId = String(id || '').trim()
  if (!supplierId) return res.status(400).json({ success: false, message: '供应商ID不能为空' })

  const collection = cloudbaseService.getCollection('suppliers')
  
  // 检查是否存在（包括已删除的）
  const docRes = await collection.doc(supplierId).get().catch(() => null)
  const doc = docRes?.data && docRes.data.length ? docRes.data[0] : null
  
  if (!doc) {
    // 尝试通过 candidates 查找
    const candidates = buildSupplierIdCandidates(supplierId)
    let foundDoc = null
    for (const cid of candidates) {
      if (cid === supplierId) continue
      const r = await collection.doc(cid).get().catch(() => null)
      if (r?.data?.length) {
        foundDoc = r.data[0]
        break
      }
    }
    if (!foundDoc) {
      return res.status(404).json({ success: false, message: '供应商不存在' })
    }
    // 使用找到的ID
    await collection.doc(foundDoc._id).update({
      data: {
        isDeleted: false,
        deletedAt: null,
        status: 'active',
        _updateTime: Date.now()
      }
    })
    return res.json({ success: true, message: '供应商恢复成功', data: { supplier: normalizeSupplier({ ...foundDoc, status: 'active' }) } })
  }

  // 直接使用ID更新
  await collection.doc(supplierId).update({
    data: {
      isDeleted: false,
      deletedAt: null,
      status: 'active',
      _updateTime: Date.now()
    }
  })

  return res.json({ success: true, message: '供应商恢复成功', data: { supplier: normalizeSupplier({ ...doc, status: 'active' }) } })
}))

router.get('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const idRaw = String(req.params.id || '').trim()
    if (!idRaw) return res.status(400).json({ success: false, message: '供应商ID不能为空' })
    const candidates = buildSupplierIdCandidates(idRaw)
    let doc = null
    for (const cid of candidates) {
      const found = await getLocalDoc('suppliers', cid).catch(() => null)
      if (found) {
        doc = found
        break
      }
    }
    if (!doc) return res.status(404).json({ success: false, message: '供应商不存在' })
    return res.json({ success: true, data: { supplier: normalizeSupplier(doc) } })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const idRaw = String(req.params.id || '').trim()
  if (!idRaw) return res.status(400).json({ success: false, message: '供应商ID不能为空' })

  const candidates = buildSupplierIdCandidates(idRaw)
  const collection = cloudbaseService.getCollection('suppliers')

  let doc = null
  for (const cid of candidates) {
    const docRes = await collection.doc(cid).get().catch(() => null)
    doc = docRes?.data && docRes.data.length ? docRes.data[0] : null
    if (doc) break
  }

  if (!doc) return res.status(404).json({ success: false, message: '供应商不存在' })
  return res.json({ success: true, data: { supplier: normalizeSupplier(doc) } })
}))

router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const {
    page = 1,
    pageSize = 10,
    limit = '',
    keyword = '',
    search = '',
    q = '',
    status = '',
    withTotal = undefined
  } = req.query

  if (isOfflineMode()) {
    const finalPage = Number(page) > 0 ? Number(page) : 1
    const requestedPageSize = Number(pageSize || limit) > 0 ? Number(pageSize || limit) : 10
    const finalPageSize = Math.min(100, requestedPageSize)
    const finalKeyword = String((keyword || search || q || '')).trim()
    const statusFilter = String(status || '').trim()
    const withTotalNormalized = withTotal === undefined ? true : (String(withTotal) !== 'false')

    let list = (await listLocalDocs('suppliers', { limit: 10000 }).catch(() => []))
      .map(normalizeSupplier)
      .filter(Boolean)
      .filter((s) => {
        const deleted = Boolean(s?.isDeleted)
        if (deleted) return false
        if (statusFilter && String(s.status || 'active') !== statusFilter) return false
        if (!finalKeyword) return true
        const kw = finalKeyword
        return (
          String(s._id || '').includes(kw) ||
          String(normalizeIdSegment(s._id) || '').includes(kw) ||
          String(s.name || '').includes(kw) ||
          String(s.shortName || '').includes(kw) ||
          String(s.contactName || '').includes(kw) ||
          String(s.phone || '').includes(kw) ||
          String(s.industry || '').includes(kw) ||
          String(s.address || '').includes(kw)
        )
      })

    const total = withTotalNormalized ? list.length : 0
    const offset = (finalPage - 1) * finalPageSize
    const data = list.slice(offset, offset + finalPageSize)
    return res.json({
      success: true,
      data,
      pagination: {
        page: finalPage,
        pageSize: finalPageSize,
        total,
        totalPages: withTotalNormalized && total > 0 ? Math.ceil(total / finalPageSize) : 0
      }
    })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const finalPage = Number(page) > 0 ? Number(page) : 1
  const requestedPageSize = Number(pageSize || limit) > 0 ? Number(pageSize || limit) : 10
  const finalPageSize = Math.min(100, requestedPageSize)
  const finalKeyword = String((keyword || search || q || '')).trim()
  const statusFilter = String(status || '').trim()

  const where = {}

  const collection = cloudbaseService.getCollection('suppliers')

  const offset = (finalPage - 1) * finalPageSize

  if (finalKeyword || statusFilter) {
    const allDocs = await fetchAllDocs(collection, where, { pageSize: 100, maxPages: 80, orderByField: '_id', orderByDirection: 'desc' })
    const kw = finalKeyword
    const filtered = allDocs
      .map(normalizeSupplier)
      .filter(Boolean)
      .filter((s) => {
        if (statusFilter && String(s.status || 'active') !== statusFilter) return false
        if (!kw) return true
        return (
          String(s._id || '').includes(kw) ||
          String(normalizeIdSegment(s._id) || '').includes(kw) ||
          String(s.name || '').includes(kw) ||
          String(s.shortName || '').includes(kw) ||
          String(s.contactName || '').includes(kw) ||
          String(s.phone || '').includes(kw) ||
          String(s.email || '').includes(kw) ||
          String(s.industry || '').includes(kw) ||
          String(s.address || '').includes(kw)
        )
      })

    const pageList = filtered.slice(offset, offset + finalPageSize)
    const nextTotal = filtered.length

    return res.json({
      success: true,
      data: pageList,
      pagination: {
        page: finalPage,
        pageSize: finalPageSize,
        total: nextTotal,
        totalPages: nextTotal > 0 ? Math.ceil(nextTotal / finalPageSize) : 0
      }
    })
  }

  const withTotalNormalized = (() => {
    if (withTotal === undefined || withTotal === null || withTotal === '') {
      return finalPageSize < 200
    }
    const v = String(withTotal).trim()
    return !(v === '0' || v.toLowerCase() === 'false' || v.toLowerCase() === 'no')
  })()

  let total = 0
  if (withTotalNormalized) {
    try {
      const countRes = await collection.where(where).count()
      total = Number(countRes?.total || 0)
    } catch (_) {
      total = 0
    }
  }

  let raw = null
  try {
    raw = await collection.where(where).orderBy('_id', 'desc').skip(offset).limit(finalPageSize).get()
  } catch (e) {
    try {
      raw = await collection.where(where).skip(offset).limit(finalPageSize).get()
    } catch (_) {
      return res.status(500).json({ success: false, message: formatCloudCollectionError(e, 'suppliers') })
    }
  }
  let list = (raw?.data || []).map(normalizeSupplier).filter(Boolean)

  return res.json({
    success: true,
    data: list,
    pagination: {
      page: finalPage,
      pageSize: finalPageSize,
      total,
      totalPages: withTotalNormalized && total > 0 ? Math.ceil(total / finalPageSize) : 0
    }
  })
}))

// 恢复已删除供应商
router.post('/restore', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const { id } = req.body || {}
    const supplierId = String(id || '').trim()
    if (!supplierId) return res.status(400).json({ success: false, message: '供应商ID不能为空' })
    const candidates = buildSupplierIdCandidates(supplierId)
    let doc = null
    let usedId = ''
    for (const cid of candidates) {
      const found = await getLocalDoc('suppliers', cid).catch(() => null)
      if (found) {
        doc = found
        usedId = cid
        break
      }
    }
    if (!doc) return res.status(404).json({ success: false, message: '供应商不存在' })
    const nowTs = Date.now()
    const patched = { ...doc, isDeleted: false, deletedAt: null, status: 'active', updatedAt: nowTs, _updateTime: nowTs }
    await upsertLocalDoc('suppliers', patched, usedId)
    return res.json({ success: true, message: '供应商恢复成功', data: { supplier: normalizeSupplier({ ...patched, _id: usedId }) } })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const { id } = req.body || {}
  const supplierId = String(id || '').trim()
  if (!supplierId) return res.status(400).json({ success: false, message: '供应商ID不能为空' })

  const collection = cloudbaseService.getCollection('suppliers')
  
  // 检查是否存在（包括已删除的）
  const docRes = await collection.doc(supplierId).get().catch(() => null)
  const doc = docRes?.data && docRes.data.length ? docRes.data[0] : null
  
  if (!doc) {
    // 尝试通过 candidates 查找
    const candidates = buildSupplierIdCandidates(supplierId)
    let foundDoc = null
    for (const cid of candidates) {
      if (cid === supplierId) continue
      const r = await collection.doc(cid).get().catch(() => null)
      if (r?.data?.length) {
        foundDoc = r.data[0]
        break
      }
    }
    if (!foundDoc) {
      return res.status(404).json({ success: false, message: '供应商不存在' })
    }
    // 使用找到的ID
    await collection.doc(foundDoc._id).update({
      data: {
        isDeleted: false,
        deletedAt: null,
        status: 'active',
        _updateTime: Date.now()
      }
    })
    return res.json({ success: true, message: '供应商恢复成功', data: { supplier: normalizeSupplier({ ...foundDoc, status: 'active' }) } })
  }

  // 直接使用ID更新
  await collection.doc(supplierId).update({
    data: {
      isDeleted: false,
      deletedAt: null,
      status: 'active',
      _updateTime: Date.now()
    }
  })

  return res.json({ success: true, message: '供应商恢复成功', data: { supplier: normalizeSupplier({ ...doc, status: 'active' }) } })
}))

router.post('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const body = req.body || {}
    const name = String(body.name || body.companyName || body.title || '').trim()
    const shortName = String(body.shortName || '').trim()
    const contactName = String(body.contactName || body.contact || body.contactPerson || '').trim()
    const phone = body.phone != null ? String(body.phone) : ''
    const industry = body.industry != null ? String(body.industry) : ''
    const address =
      body.address != null ? String(body.address)
        : (body.companyAddress != null ? String(body.companyAddress)
          : (body.company_address != null ? String(body.company_address)
            : (body.addr != null ? String(body.addr)
              : (body.location != null ? String(body.location) : ''))))
    const statusVal = body.status != null ? String(body.status) : 'active'

    if (!name) {
      return res.status(400).json({ success: false, message: '供应商名称不能为空' })
    }

    const actorId = req.user?.userId ?? req.user?.id
    const nowIso = new Date().toISOString()
    const nowTs = Date.now()
    const doc = {
      name,
      shortName,
      contactName,
      phone,
      industry,
      address,
      status: statusVal || 'active',
      isDeleted: false,
      deletedAt: null,
      createdBy: actorId != null ? String(actorId) : '',
      createdAt: nowTs,
      updatedAt: nowTs,
      _createTime: nowTs,
      _updateTime: nowTs,
      createdAtText: nowIso,
      updatedAtText: nowIso,
      source: 'pc'
    }

    const created = await upsertLocalDoc('suppliers', doc)
    const id = String(created?.id || '')
    return res.status(201).json({
      success: true,
      message: '供应商创建成功',
      data: { supplier: normalizeSupplier({ ...doc, _id: id }) }
    })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const body = req.body || {}
  const name = String(body.name || body.companyName || body.title || '').trim()
  const shortName = String(body.shortName || '').trim()
  const contactName = String(body.contactName || body.contact || body.contactPerson || '').trim()
  const phone = body.phone != null ? String(body.phone) : ''
  const industry = body.industry != null ? String(body.industry) : ''
  const address =
    body.address != null ? String(body.address)
      : (body.companyAddress != null ? String(body.companyAddress)
        : (body.company_address != null ? String(body.company_address)
          : (body.addr != null ? String(body.addr)
            : (body.location != null ? String(body.location) : ''))))
  const statusVal = body.status != null ? String(body.status) : 'active'

  if (!name) {
    return res.status(400).json({ success: false, message: '供应商名称不能为空' })
  }

  const actorId = req.user?.userId ?? req.user?.id
  const nowIso = new Date().toISOString()
  const nowTs = Date.now()
  const doc = {
    name,
    shortName,
    contactName,
    phone,
    industry,
    address,
    status: statusVal || 'active',
    createdBy: actorId != null ? String(actorId) : '',
    createdAt: nowTs,
    updatedAt: nowTs,
    _createTime: nowTs,
    _updateTime: nowTs,
    createdAtText: nowIso,
    updatedAtText: nowIso,
    source: 'pc'
  }

  const collection = cloudbaseService.getCollection('suppliers')
  const created = await collection.add({ data: doc })
  const id = created?.id != null ? String(created.id) : ''

  return res.status(201).json({
    success: true,
    message: '供应商创建成功',
    data: { supplier: normalizeSupplier({ ...doc, _id: id }) }
  })
}))

router.put('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const supplierId = String(req.params.id || '').trim()
    if (!supplierId) return res.status(400).json({ success: false, message: '供应商ID不能为空' })
    const existing = await getLocalDoc('suppliers', supplierId).catch(() => null)
    if (!existing) return res.status(404).json({ success: false, message: '供应商不存在' })

    const body = req.body || {}
    const patch = { updatedAt: Date.now(), _updateTime: Date.now(), updatedAtText: new Date().toISOString() }

    if (body.name !== undefined || body.companyName !== undefined || body.title !== undefined) {
      patch.name = String(body.name || body.companyName || body.title || '')
    }
    if (body.shortName !== undefined) patch.shortName = String(body.shortName || '')
    if (body.contactName !== undefined || body.contact !== undefined || body.contactPerson !== undefined) {
      patch.contactName = String(body.contactName || body.contact || body.contactPerson || '')
    }
    if (body.phone !== undefined) patch.phone = body.phone != null ? String(body.phone) : ''
    if (body.industry !== undefined) patch.industry = body.industry != null ? String(body.industry) : ''
    if (
      body.address !== undefined ||
      body.companyAddress !== undefined ||
      body.company_address !== undefined ||
      body.addr !== undefined ||
      body.location !== undefined
    ) {
      patch.address =
        body.address != null ? String(body.address)
          : (body.companyAddress != null ? String(body.companyAddress)
            : (body.company_address != null ? String(body.company_address)
              : (body.addr != null ? String(body.addr)
                : (body.location != null ? String(body.location) : ''))))
    }
    if (body.status !== undefined) patch.status = body.status != null ? String(body.status) : ''

    const merged = { ...existing, ...patch }
    await upsertLocalDoc('suppliers', merged, supplierId)
    return res.json({ success: true, message: '供应商更新成功', data: { supplier: normalizeSupplier({ ...merged, _id: supplierId }) } })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const supplierId = String(req.params.id || '').trim()
  if (!supplierId) return res.status(400).json({ success: false, message: '供应商ID不能为空' })

  const body = req.body || {}
  const patch = { updatedAt: Date.now(), _updateTime: Date.now(), updatedAtText: new Date().toISOString() }

  if (body.name !== undefined || body.companyName !== undefined || body.title !== undefined) {
    patch.name = String(body.name || body.companyName || body.title || '')
  }
  if (body.shortName !== undefined) patch.shortName = String(body.shortName || '')
  if (body.contactName !== undefined || body.contact !== undefined || body.contactPerson !== undefined) {
    patch.contactName = String(body.contactName || body.contact || body.contactPerson || '')
  }
  if (body.phone !== undefined) patch.phone = body.phone != null ? String(body.phone) : ''
  if (body.industry !== undefined) patch.industry = body.industry != null ? String(body.industry) : ''
  if (
    body.address !== undefined ||
    body.companyAddress !== undefined ||
    body.company_address !== undefined ||
    body.addr !== undefined ||
    body.location !== undefined
  ) {
    patch.address =
      body.address != null ? String(body.address)
        : (body.companyAddress != null ? String(body.companyAddress)
          : (body.company_address != null ? String(body.company_address)
            : (body.addr != null ? String(body.addr)
              : (body.location != null ? String(body.location) : ''))))
  }
  if (body.status !== undefined) patch.status = body.status != null ? String(body.status) : ''

  const collection = cloudbaseService.getCollection('suppliers')
  await collection.doc(supplierId).update({ data: patch }).catch(() => null)
  const docRes = await collection.doc(supplierId).get()
  const doc = docRes?.data && docRes.data.length ? docRes.data[0] : null
  if (!doc) return res.status(404).json({ success: false, message: '供应商不存在' })

  return res.json({ success: true, message: '供应商更新成功', data: { supplier: normalizeSupplier(doc) } })
}))

router.delete('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const supplierId = String(req.params.id || '').trim()
    if (!supplierId) return res.status(400).json({ success: false, message: '供应商ID不能为空' })
    const existing = await getLocalDoc('suppliers', supplierId).catch(() => null)
    if (!existing) return res.status(404).json({ success: false, message: '供应商不存在' })
    const nowTs = Date.now()
    const patched = { ...existing, isDeleted: true, deletedAt: nowTs, status: 'deleted', updatedAt: nowTs, _updateTime: nowTs }
    await upsertLocalDoc('suppliers', patched, supplierId)
    return res.json({ success: true, message: '供应商删除成功', data: { supplier: normalizeSupplier({ ...patched, _id: supplierId }) } })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const supplierId = String(req.params.id || '').trim()
  if (!supplierId) return res.status(400).json({ success: false, message: '供应商ID不能为空' })

  const collection = cloudbaseService.getCollection('suppliers')
  const docRes = await collection.doc(supplierId).get()
  const doc = docRes?.data && docRes.data.length ? docRes.data[0] : null
  if (!doc) return res.status(404).json({ success: false, message: '供应商不存在' })

  await collection.doc(supplierId).remove()
  return res.json({ success: true, message: '供应商删除成功', data: { supplier: normalizeSupplier(doc) } })
}))

export default router
