import express from 'express'
import { authenticateToken, requireUser } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import cloudbaseService from '../services/cloudbaseService.js'
import { getLocalDoc, listLocalDocs, removeLocalDoc, upsertLocalDoc } from '../utils/localDocStore.js'

const router = express.Router()

const CUSTOMER_SKU_COLLECTION = String(process.env.CLOUDBASE_CUSTOMER_SKU_COLLECTION || 'customer_skus').trim() || 'customer_skus'
const OUTSOURCED_MATERIAL_COLLECTION = String(process.env.CLOUDBASE_OUTSOURCED_MATERIAL_COLLECTION || 'outsourced_materials').trim() || 'outsourced_materials'

const isOfflineMode = () => String(process.env.OFFLINE_MODE || '').toLowerCase() === 'true'

const ensureCloud = async () => {
  const ok = await cloudbaseService.initialize().catch(() => false)
  return ok
}

const round4 = (n) => Math.round(Number(n) * 10000) / 10000

const normalizeNumber = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

const normalizeText = (v) => {
  const s = String(v == null ? '' : v).trim()
  return s || null
}

const normalizeFluteList = (v) => {
  const out = []
  const push = (x) => {
    const s = normalizeText(x)
    if (!s) return
    if (out.includes(s)) return
    out.push(s)
  }
  if (Array.isArray(v)) {
    v.forEach(push)
    return out
  }
  const s = normalizeText(v)
  if (!s) return out
  s
    .split(/[\/,，;；]+/)
    .map((x) => String(x || '').trim())
    .filter(Boolean)
    .forEach(push)
  return out
}

const normalizeGrammageG = (v) => {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) && v > 0 ? v : null
  const s = String(v).trim()
  if (!s) return null
  const m = s.match(/([0-9]+(?:\.[0-9]+)?)/)
  if (!m) return null
  const n = Number(m[1])
  return Number.isFinite(n) && n > 0 ? n : null
}

const normalizeRow = (doc) => {
  if (!doc || typeof doc !== 'object') return null
  const id = doc?._id != null ? String(doc._id) : (doc?.id != null ? String(doc.id) : '')
  const supplierId = doc?.supplierId != null ? String(doc.supplierId) : (doc?.supplier_id != null ? String(doc.supplier_id) : '')
  const materialCode = doc?.materialCode != null ? String(doc.materialCode) : (doc?.material_code != null ? String(doc.material_code) : '')
  const grammageG = normalizeGrammageG(doc?.grammageG ?? doc?.grammage ?? doc?.weightG ?? doc?.weight)
  const grammageText = normalizeText(doc?.grammageText ?? doc?.grammageLabel ?? doc?.grammageDisplay)
  const flutes = normalizeFluteList(doc?.flutes ?? doc?.fluteOptions ?? doc?.flute_options ?? doc?.fluteList ?? doc?.flute_list ?? doc?.flute)
  const flute = flutes.length ? flutes[0] : (doc?.flute != null ? String(doc.flute) : '')
  const pricePerSqm = normalizeNumber(doc?.pricePerSqm ?? doc?.sqmPrice ?? doc?.unitPrice)
  const createdAt = doc?.createdAt || doc?._createTime || null
  const updatedAt = doc?.updatedAt || doc?._updateTime || null
  return {
    _id: id,
    id,
    supplierId,
    materialCode,
    grammageG,
    grammageText,
    flute,
    flutes,
    pricePerSqm: pricePerSqm != null && pricePerSqm >= 0 ? pricePerSqm : null,
    createdAt,
    updatedAt
  }
}

const toTs = (v) => {
  if (v == null) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  const n = Number(v)
  if (Number.isFinite(n)) return n
  const d = new Date(String(v))
  const t = d.getTime()
  return Number.isFinite(t) ? t : 0
}

const mergeRowsByMaterialCode = (rows) => {
  const map = new Map()
  ;(rows || []).forEach((r) => {
    const code = String(r?.materialCode || '').trim()
    if (!code) return
    const prev = map.get(code)
    if (!prev) {
      map.set(code, { ...r, flutes: normalizeFluteList(r?.flutes ?? r?.flute) })
      return
    }
    const prevTs = Math.max(toTs(prev?.updatedAt), toTs(prev?._updateTime))
    const nextTs = Math.max(toTs(r?.updatedAt), toTs(r?._updateTime))
    const newer = nextTs >= prevTs ? r : prev
    const older = nextTs >= prevTs ? prev : r
    const flutes = normalizeFluteList([
      ...(normalizeFluteList(prev?.flutes ?? prev?.flute) || []),
      ...(normalizeFluteList(r?.flutes ?? r?.flute) || [])
    ])
    const grammageText = normalizeText(newer?.grammageText ?? older?.grammageText)
    const grammageG = newer?.grammageG != null ? newer.grammageG : (older?.grammageG ?? null)
    const pricePerSqm = newer?.pricePerSqm != null ? newer.pricePerSqm : (older?.pricePerSqm ?? null)
    const createdAt = newer?.createdAt ?? older?.createdAt ?? null
    const updatedAt = newer?.updatedAt ?? older?.updatedAt ?? null
    map.set(code, {
      ...(newer || {}),
      materialCode: code,
      grammageText,
      grammageG,
      pricePerSqm,
      createdAt,
      updatedAt,
      flutes,
      flute: flutes.length ? flutes[0] : (normalizeText(newer?.flute ?? older?.flute) || '')
    })
  })
  return Array.from(map.values())
}

const normalizeOutsourcedMaterialRow = (doc) => {
  if (!doc || typeof doc !== 'object') return null
  const id = doc?._id != null ? String(doc._id) : (doc?.id != null ? String(doc.id) : '')
  const supplierId = doc?.supplierId != null ? String(doc.supplierId) : (doc?.supplier_id != null ? String(doc.supplier_id) : '')
  const name = normalizeText(doc?.name ?? doc?.rawMaterialName ?? doc?.materialName ?? doc?.title)
  if (!supplierId || !name) return null
  const specification = normalizeText(doc?.specification ?? doc?.spec ?? doc?.size)
  const unit = normalizeText(doc?.unit ?? doc?.uom)
  const unitPrice = normalizeNumber(doc?.unitPrice ?? doc?.price ?? doc?.unit_price)
  const createdAt = doc?.createdAt || doc?._createTime || null
  const updatedAt = doc?.updatedAt || doc?._updateTime || null
  return {
    _id: id,
    id,
    supplierId,
    name,
    specification,
    unit,
    unitPrice: unitPrice != null && unitPrice >= 0 ? unitPrice : null,
    createdAt,
    updatedAt
  }
}

const resolveSupplierNameById = async (supplierId) => {
  const sid = String(supplierId || '').trim()
  if (!sid) return ''
  const suppliers = cloudbaseService.getCollection('suppliers')
  try {
    const r = await suppliers.doc(sid).get()
    const doc = r?.data && r.data.length ? r.data[0] : null
    return String(doc?.name || doc?.companyName || doc?.title || '').trim()
  } catch (_) {
    return ''
  }
}

const querySupplierMaterialsBySupplier = async (collection, supplierId, supplierName) => {
  const sid = String(supplierId || '').trim()
  const sname = String(supplierName || '').trim()
  const tryWhere = async (where) => {
    const raw = await collection.where(where).limit(2000).get().catch(() => null)
    const list = Array.isArray(raw?.data) ? raw.data : []
    return list
  }

  if (sid) {
    const a = await tryWhere({ supplierId: sid })
    if (a.length) return a
    const b = await tryWhere({ supplier_id: sid })
    if (b.length) return b
  }

  if (sname) {
    const c = await tryWhere({ supplierName: sname })
    if (c.length) return c
    const d = await tryWhere({ supplier_name: sname })
    if (d.length) return d
    if (sid) {
      const e = await tryWhere({ supplierId: sname })
      if (e.length) return e
      const f = await tryWhere({ supplier_id: sname })
      if (f.length) return f
    }
  }

  return []
}

const updateCustomerSkusForMaterialPrice = async ({ supplierId, materialCode, pricePerSqm }) => {
  const sid = String(supplierId || '').trim()
  const code = String(materialCode || '').trim()
  const price = Number(pricePerSqm)
  if (!sid || !code || !Number.isFinite(price) || price < 0) return { updated: 0, scanned: 0 }

  const collection = cloudbaseService.getCollection(CUSTOMER_SKU_COLLECTION)
  const pageSize = 500
  const maxPages = 50
  let scanned = 0
  let updated = 0

  const nowIso = new Date().toISOString()
  const nowTs = Date.now()

  for (let page = 1; page <= maxPages; page += 1) {
    const offset = (page - 1) * pageSize
    const raw = await collection.where({ supplierId: sid, materialCode: code }).skip(offset).limit(pageSize).get().catch(() => null)
    const docs = Array.isArray(raw?.data) ? raw.data : []
    if (!docs.length) break
    scanned += docs.length

    const tasks = docs
      .map((doc) => {
        const mode = String(doc?.productionMode || '').trim()
        if (mode === 'outsourced') return null
        const id = String(doc?._id || '').trim()
        if (!id) return null
        const bw = Number(doc?.boardWidth)
        const bh = Number(doc?.boardHeight)
        if (!Number.isFinite(bw) || !Number.isFinite(bh)) return null
        const sqm = ((bw + 20) * bh) / 1000000
        if (!Number.isFinite(sqm) || sqm <= 0) return null
        const nextCost = round4(sqm * price)
        const unitPrice = Number(doc?.unitPrice)
        const nextProfit = Number.isFinite(unitPrice) ? round4(unitPrice - nextCost) : null

        const curPrice = doc?.materialPricePerSqm != null && doc?.materialPricePerSqm !== '' ? Number(doc.materialPricePerSqm) : NaN
        const curCost = doc?.rawMaterialCost != null && doc?.rawMaterialCost !== '' ? Number(doc.rawMaterialCost) : NaN
        const curProfit = doc?.profit != null && doc?.profit !== '' ? Number(doc.profit) : NaN

        const priceChanged = !Number.isFinite(curPrice) || Math.abs(curPrice - price) > 1e-9
        const costChanged = !Number.isFinite(curCost) || Math.abs(curCost - nextCost) > 1e-6
        const profitChanged = nextProfit != null && (!Number.isFinite(curProfit) || Math.abs(curProfit - nextProfit) > 1e-6)
        if (!priceChanged && !costChanged && !profitChanged) return null

        const patch = {
          materialPricePerSqm: price,
          rawMaterialCost: nextCost,
          updatedAt: nowIso,
          _updateTime: nowTs
        }
        if (nextProfit != null) patch.profit = nextProfit

        return { id, patch }
      })
      .filter(Boolean)

    if (tasks.length) {
      const batchSize = 20
      for (let i = 0; i < tasks.length; i += batchSize) {
        const batch = tasks.slice(i, i + batchSize)
        const settled = await Promise.allSettled(batch.map((t) => collection.doc(t.id).update({ data: t.patch })))
        updated += settled.filter((r) => r.status === 'fulfilled').length
      }
    }

    if (docs.length < pageSize) break
  }

  return { updated, scanned }
}

router.get('/outsourced', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const supplierId = String(req.query?.supplierId || '').trim()
    if (!supplierId) {
      return res.status(400).json({ success: false, message: 'supplierId不能为空' })
    }
    const keyword = String(req.query?.keyword || req.query?.q || req.query?.search || '').trim()
    const all = await listLocalDocs(OUTSOURCED_MATERIAL_COLLECTION, { limit: 10000 }).catch(() => [])
    let list = (all || [])
      .map(normalizeOutsourcedMaterialRow)
      .filter(Boolean)
      .filter((r) => String(r.supplierId || '').trim() === supplierId)
    if (keyword) {
      list = list.filter((r) => String(r.name || '').includes(keyword))
    }
    list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'))
    return res.json({ success: true, data: list })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const supplierId = String(req.query?.supplierId || '').trim()
  if (!supplierId) {
    return res.status(400).json({ success: false, message: 'supplierId不能为空' })
  }

  const keyword = String(req.query?.keyword || req.query?.q || req.query?.search || '').trim()
  const collection = cloudbaseService.getCollection(OUTSOURCED_MATERIAL_COLLECTION)

  const pageSize = 500
  const maxPages = 20
  const all = []

  for (let page = 1; page <= maxPages; page += 1) {
    const offset = (page - 1) * pageSize
    const raw = await collection.where({ supplierId }).orderBy('_updateTime', 'desc').skip(offset).limit(pageSize).get().catch(() => null)
    const docs = Array.isArray(raw?.data) ? raw.data : []
    if (!docs.length) break
    all.push(...docs)
    if (docs.length < pageSize) break
  }

  let list = all.map(normalizeOutsourcedMaterialRow).filter(Boolean)
  if (keyword) {
    list = list.filter((r) => String(r.name || '').includes(keyword))
  }
  list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'))

  return res.json({ success: true, data: list })
}))

const handleUpsertOutsourcedMaterial = async (req, res) => {
  if (isOfflineMode()) {
    const body = req.body || {}
    const supplierId = String(body.supplierId || body.supplier_id || '').trim()
    const name = normalizeText(body.name ?? body.rawMaterialName ?? body.materialName ?? body.title)
    if (!supplierId) return res.status(400).json({ success: false, message: 'supplierId不能为空' })
    if (!name) return res.status(400).json({ success: false, message: '原材料名称不能为空' })

    const specification = normalizeText(body.specification ?? body.spec ?? body.size)
    const unit = normalizeText(body.unit ?? body.uom)
    const unitPrice = normalizeNumber(body.unitPrice ?? body.price ?? body.unit_price)

    const nowTs = Date.now()
    const patch = {
      supplierId,
      name,
      specification,
      unit,
      unitPrice: unitPrice != null && unitPrice >= 0 ? unitPrice : null,
      updatedAt: nowTs,
      _updateTime: nowTs,
      createdAt: nowTs,
      _createTime: nowTs
    }

    const explicitId = String(body.id || body._id || '').trim()
    let usedId = explicitId
    if (!usedId) {
      const all = await listLocalDocs(OUTSOURCED_MATERIAL_COLLECTION, { limit: 10000 }).catch(() => [])
      const existed = (all || []).find((d) => {
        if (String(d?.supplierId || '').trim() !== supplierId) return false
        if (String(d?.name || '').trim() !== String(name || '').trim()) return false
        const a = String(d?.specification || '').trim()
        const b = String(specification || '').trim()
        return a === b
      })
      usedId = String(existed?._id || existed?.id || '').trim()
    }

    const created = await upsertLocalDoc(OUTSOURCED_MATERIAL_COLLECTION, patch, usedId || undefined)
    const id = String(created?.id || usedId || '')
    const item = normalizeOutsourcedMaterialRow({ ...patch, _id: id })
    return res.status(explicitId || usedId ? 200 : 201).json({ success: true, message: explicitId || usedId ? '更新成功' : '创建成功', data: { item } })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const body = req.body || {}
  const supplierId = String(body.supplierId || body.supplier_id || '').trim()
  const name = normalizeText(body.name ?? body.rawMaterialName ?? body.materialName ?? body.title)
  if (!supplierId) return res.status(400).json({ success: false, message: 'supplierId不能为空' })
  if (!name) return res.status(400).json({ success: false, message: '原材料名称不能为空' })

  const specification = normalizeText(body.specification ?? body.spec ?? body.size)
  const unit = normalizeText(body.unit ?? body.uom)
  const unitPrice = normalizeNumber(body.unitPrice ?? body.price ?? body.unit_price)

  const nowTs = Date.now()
  const patch = {
    supplierId,
    name,
    specification,
    unit,
    unitPrice: unitPrice != null && unitPrice >= 0 ? unitPrice : null,
    updatedAt: nowTs,
    _updateTime: nowTs
  }

  const collection = cloudbaseService.getCollection(OUTSOURCED_MATERIAL_COLLECTION)
  const explicitId = String(body.id || body._id || '').trim()
  if (explicitId) {
    await collection.doc(explicitId).update({ data: patch }).catch(() => null)
    const got = await collection.doc(explicitId).get().catch(() => null)
    const doc = got?.data && got.data.length ? got.data[0] : null
    if (!doc) return res.status(404).json({ success: false, message: '记录不存在' })
    return res.json({ success: true, message: '更新成功', data: { item: normalizeOutsourcedMaterialRow(doc) } })
  }

  const existed = await collection.where({ supplierId, name, ...(specification ? { specification } : {}) }).limit(1).get().catch(() => null)
  const first = existed?.data && existed.data.length ? existed.data[0] : null
  const existingId = first?._id != null ? String(first._id) : ''
  if (existingId) {
    await collection.doc(existingId).update({ data: patch }).catch(() => null)
    const got = await collection.doc(existingId).get().catch(() => null)
    const doc = got?.data && got.data.length ? got.data[0] : null
    return res.json({ success: true, message: '更新成功', data: { item: normalizeOutsourcedMaterialRow(doc || { ...patch, _id: existingId }) } })
  }

  const actorId = req.user?.userId ?? req.user?.id
  const created = await collection.add({
    data: {
      ...patch,
      supplier_id: supplierId,
      createdBy: actorId != null ? String(actorId) : '',
      createdAt: nowTs,
      _createTime: nowTs
    }
  })
  const id = created?.id != null ? String(created.id) : ''
  return res.status(201).json({ success: true, message: '创建成功', data: { item: normalizeOutsourcedMaterialRow({ ...patch, _id: id, createdAt: nowTs, _createTime: nowTs }) } })
}

router.post('/outsourced', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  return await handleUpsertOutsourcedMaterial(req, res)
}))

router.post('/outsourced/upsert', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  return await handleUpsertOutsourcedMaterial(req, res)
}))

router.put('/outsourced/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ success: false, message: 'ID不能为空' })
    const existing = await getLocalDoc(OUTSOURCED_MATERIAL_COLLECTION, id).catch(() => null)
    if (!existing) return res.status(404).json({ success: false, message: '记录不存在' })

    const body = req.body || {}
    const patch = { updatedAt: Date.now(), _updateTime: Date.now() }
    if (body.supplierId !== undefined || body.supplier_id !== undefined) patch.supplierId = String(body.supplierId || body.supplier_id || '').trim()
    if (body.name !== undefined || body.rawMaterialName !== undefined || body.materialName !== undefined || body.title !== undefined) {
      patch.name = normalizeText(body.name ?? body.rawMaterialName ?? body.materialName ?? body.title)
    }
    if (body.specification !== undefined || body.spec !== undefined || body.size !== undefined) {
      patch.specification = normalizeText(body.specification ?? body.spec ?? body.size)
    }
    if (body.unit !== undefined || body.uom !== undefined) patch.unit = normalizeText(body.unit ?? body.uom)
    if (body.unitPrice !== undefined || body.price !== undefined || body.unit_price !== undefined) {
      const n = normalizeNumber(body.unitPrice ?? body.price ?? body.unit_price)
      patch.unitPrice = n != null && n >= 0 ? n : null
    }

    const merged = { ...existing, ...patch }
    await upsertLocalDoc(OUTSOURCED_MATERIAL_COLLECTION, merged, id)
    return res.json({ success: true, message: '更新成功', data: { item: normalizeOutsourcedMaterialRow({ ...merged, _id: id }) } })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const id = String(req.params.id || '').trim()
  if (!id) return res.status(400).json({ success: false, message: 'ID不能为空' })

  const body = req.body || {}
  const patch = { updatedAt: Date.now(), _updateTime: Date.now() }
  if (body.supplierId !== undefined || body.supplier_id !== undefined) patch.supplierId = String(body.supplierId || body.supplier_id || '').trim()
  if (body.name !== undefined || body.rawMaterialName !== undefined || body.materialName !== undefined || body.title !== undefined) {
    patch.name = normalizeText(body.name ?? body.rawMaterialName ?? body.materialName ?? body.title)
  }
  if (body.specification !== undefined || body.spec !== undefined || body.size !== undefined) {
    patch.specification = normalizeText(body.specification ?? body.spec ?? body.size)
  }
  if (body.unit !== undefined || body.uom !== undefined) patch.unit = normalizeText(body.unit ?? body.uom)
  if (body.unitPrice !== undefined || body.price !== undefined || body.unit_price !== undefined) {
    const n = normalizeNumber(body.unitPrice ?? body.price ?? body.unit_price)
    patch.unitPrice = n != null && n >= 0 ? n : null
  }

  const collection = cloudbaseService.getCollection(OUTSOURCED_MATERIAL_COLLECTION)
  try {
    await collection.doc(id).update({ data: patch })
  } catch (e) {
    const msg = String(e?.message || '').trim()
    return res.status(500).json({ success: false, message: msg ? `更新失败：${msg}` : '更新失败' })
  }
  const got = await collection.doc(id).get().catch(() => null)
  const doc = got?.data && got.data.length ? got.data[0] : null
  if (!doc) return res.status(404).json({ success: false, message: '记录不存在' })
  return res.json({ success: true, message: '更新成功', data: { item: normalizeOutsourcedMaterialRow(doc) } })
}))

router.delete('/outsourced/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ success: false, message: 'ID不能为空' })
    const existing = await getLocalDoc(OUTSOURCED_MATERIAL_COLLECTION, id).catch(() => null)
    if (!existing) return res.status(404).json({ success: false, message: '记录不存在' })
    await removeLocalDoc(OUTSOURCED_MATERIAL_COLLECTION, id)
    return res.json({ success: true, message: '删除成功', data: { item: normalizeOutsourcedMaterialRow({ ...existing, _id: id }) } })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const id = String(req.params.id || '').trim()
  if (!id) return res.status(400).json({ success: false, message: 'ID不能为空' })

  const collection = cloudbaseService.getCollection(OUTSOURCED_MATERIAL_COLLECTION)
  const docRes = await collection.doc(id).get().catch(() => null)
  const doc = docRes?.data && docRes.data.length ? docRes.data[0] : null
  if (!doc) return res.status(404).json({ success: false, message: '记录不存在' })
  let removeRes = null
  try {
    removeRes = await collection.doc(id).remove()
  } catch (e) {
    const msg = String(e?.message || '').trim()
    return res.status(500).json({ success: false, message: msg ? `删除失败：${msg}` : '删除失败' })
  }
  const removed = Number(removeRes?.stats?.removed ?? removeRes?.deleted ?? removeRes?.deletedCount ?? 0)
  if (Number.isFinite(removed) && removed <= 0) {
    const after = await collection.doc(id).get().catch(() => null)
    const still = after?.data && after.data.length ? after.data[0] : null
    if (still) return res.status(500).json({ success: false, message: '删除失败' })
  }
  return res.json({ success: true, message: '删除成功', data: { item: normalizeOutsourcedMaterialRow(doc || { _id: id }) } })
}))

router.post('/outsourced/delete', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const body = req.body || {}
    const id = String(body.id || body._id || '').trim()
    if (!id) return res.status(400).json({ success: false, message: 'ID不能为空' })
    const existing = await getLocalDoc(OUTSOURCED_MATERIAL_COLLECTION, id).catch(() => null)
    if (!existing) return res.status(404).json({ success: false, message: '记录不存在' })
    await removeLocalDoc(OUTSOURCED_MATERIAL_COLLECTION, id)
    return res.json({ success: true, message: '删除成功', data: { item: normalizeOutsourcedMaterialRow({ ...existing, _id: id }) } })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const body = req.body || {}
  const id = String(body.id || body._id || '').trim()
  if (!id) return res.status(400).json({ success: false, message: 'ID不能为空' })

  const collection = cloudbaseService.getCollection(OUTSOURCED_MATERIAL_COLLECTION)
  const docRes = await collection.doc(id).get().catch(() => null)
  const doc = docRes?.data && docRes.data.length ? docRes.data[0] : null
  if (!doc) return res.status(404).json({ success: false, message: '记录不存在' })
  let removeRes = null
  try {
    removeRes = await collection.doc(id).remove()
  } catch (e) {
    const msg = String(e?.message || '').trim()
    return res.status(500).json({ success: false, message: msg ? `删除失败：${msg}` : '删除失败' })
  }
  const removed = Number(removeRes?.stats?.removed ?? removeRes?.deleted ?? removeRes?.deletedCount ?? 0)
  if (Number.isFinite(removed) && removed <= 0) {
    const after = await collection.doc(id).get().catch(() => null)
    const still = after?.data && after.data.length ? after.data[0] : null
    if (still) return res.status(500).json({ success: false, message: '删除失败' })
  }
  return res.json({ success: true, message: '删除成功', data: { item: normalizeOutsourcedMaterialRow(doc || { _id: id }) } })
}))

router.get('/stats', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const supplierId = String(req.query?.supplierId || '').trim()
    const all = await listLocalDocs('supplier_materials', { limit: 20000 }).catch(() => [])
    const materialCodesBySupplier = new Map()
    const ensureSet = (sid) => {
      if (!materialCodesBySupplier.has(sid)) materialCodesBySupplier.set(sid, new Set())
      return materialCodesBySupplier.get(sid)
    }
    ;(all || []).forEach((doc) => {
      const sid = String(doc?.supplierId || doc?.supplier_id || '').trim()
      if (!sid) return
      if (supplierId && sid !== supplierId) return
      const code = String(doc?.materialCode || '').trim()
      if (!code) return
      ensureSet(sid).add(code)
    })
    const data = Array.from(materialCodesBySupplier.entries())
      .map(([sid, set]) => ({ supplierId: sid, materialCount: set ? set.size : 0 }))
      .sort((a, b) => (b.materialCount || 0) - (a.materialCount || 0))
    return res.json({ success: true, data })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const supplierId = String(req.query?.supplierId || '').trim()
  const collection = cloudbaseService.getCollection('supplier_materials')

  const pageSize = 1000
  const maxPages = 80
  const materialCodesBySupplier = new Map()

  const ensureSet = (sid) => {
    if (!materialCodesBySupplier.has(sid)) materialCodesBySupplier.set(sid, new Set())
    return materialCodesBySupplier.get(sid)
  }

  for (let page = 1; page <= maxPages; page += 1) {
    const offset = (page - 1) * pageSize
    const query = supplierId ? collection.where({ supplierId }) : collection
    const raw = await query.skip(offset).limit(pageSize).get().catch(() => null)
    const docs = Array.isArray(raw?.data) ? raw.data : []
    if (!docs.length) break

    docs.forEach((doc) => {
      const sid = String(doc?.supplierId || doc?.supplier_id || '').trim()
      if (!sid) return
      if (supplierId && sid !== supplierId) return
      const code = String(doc?.materialCode || '').trim()
      if (!code) return
      ensureSet(sid).add(code)
    })

    if (docs.length < pageSize) break
  }

  const data = Array.from(materialCodesBySupplier.entries())
    .map(([sid, set]) => ({ supplierId: sid, materialCount: set ? set.size : 0 }))
    .sort((a, b) => (b.materialCount || 0) - (a.materialCount || 0))

  return res.json({ success: true, data })
}))

router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const supplierId = String(req.query?.supplierId || '').trim()
    if (!supplierId) {
      return res.status(400).json({ success: false, message: 'supplierId不能为空' })
    }
    const keyword = String(req.query?.keyword || req.query?.q || req.query?.search || '').trim()
    const all = await listLocalDocs('supplier_materials', { limit: 20000 }).catch(() => [])
    let list = mergeRowsByMaterialCode((all || [])
      .filter((d) => String(d?.supplierId || '').trim() === supplierId)
      .map(normalizeRow)
      .filter(Boolean))
    if (keyword) {
      list = list.filter((r) => String(r.materialCode || '').includes(keyword))
    }
    list.sort((a, b) => String(a.materialCode || '').localeCompare(String(b.materialCode || ''), 'zh-CN'))
    return res.json({ success: true, data: list })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const supplierId = String(req.query?.supplierId || '').trim()
  if (!supplierId) {
    return res.status(400).json({ success: false, message: 'supplierId不能为空' })
  }

  const keyword = String(req.query?.keyword || req.query?.q || req.query?.search || '').trim()
  const collection = cloudbaseService.getCollection('supplier_materials')

  const supplierName = await resolveSupplierNameById(supplierId)
  const docs = await querySupplierMaterialsBySupplier(collection, supplierId, supplierName)
  let list = mergeRowsByMaterialCode((docs || []).map(normalizeRow).filter(Boolean))

  if (keyword) {
    list = list.filter((r) => String(r.materialCode || '').includes(keyword))
  }

  list.sort((a, b) => String(a.materialCode || '').localeCompare(String(b.materialCode || ''), 'zh-CN'))

  return res.json({ success: true, data: list })
}))

router.post('/upsert', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const body = req.body || {}
    const supplierId = String(body.supplierId || '').trim()
    const materialCode = String(body.materialCode || body.code || '').trim()
    if (!supplierId) return res.status(400).json({ success: false, message: 'supplierId不能为空' })
    if (!materialCode) return res.status(400).json({ success: false, message: 'materialCode不能为空' })

    const grammageG = normalizeGrammageG(body.grammageG ?? body.grammage ?? body.weightG ?? body.weight)
    const grammageText = normalizeText(body.grammageText ?? body.grammageLabel ?? body.grammageDisplay ?? body.grammageG ?? body.grammage)
    const flutesFromBody = normalizeFluteList(body.flutes ?? body.fluteOptions ?? body.flute_options ?? body.fluteList ?? body.flute_list)
    const fluteFromBody = body.flute != null ? String(body.flute).trim() : ''
    const flutes = flutesFromBody.length ? flutesFromBody : normalizeFluteList(fluteFromBody)
    const flute = flutes.length ? flutes[0] : fluteFromBody
    const pricePerSqm = normalizeNumber(body.pricePerSqm ?? body.sqmPrice ?? body.unitPrice)

    const nowTs = Date.now()
    const patch = {
      supplierId,
      materialCode,
      grammageG: grammageG != null ? grammageG : null,
      grammageText,
      flute,
      flutes,
      pricePerSqm: pricePerSqm != null && pricePerSqm >= 0 ? pricePerSqm : null,
      updatedAt: nowTs,
      _updateTime: nowTs,
      createdAt: nowTs,
      _createTime: nowTs
    }

    const id = `${supplierId}__${materialCode}`
    await upsertLocalDoc('supplier_materials', patch, id)
    return res.status(201).json({ success: true, message: '创建成功', data: { item: normalizeRow({ ...patch, _id: id }) } })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const body = req.body || {}
  const supplierId = String(body.supplierId || '').trim()
  const materialCode = String(body.materialCode || body.code || '').trim()
  if (!supplierId) return res.status(400).json({ success: false, message: 'supplierId不能为空' })
  if (!materialCode) return res.status(400).json({ success: false, message: 'materialCode不能为空' })

  const grammageG = normalizeGrammageG(body.grammageG ?? body.grammage ?? body.weightG ?? body.weight)
  const grammageText = normalizeText(body.grammageText ?? body.grammageLabel ?? body.grammageDisplay ?? body.grammageG ?? body.grammage)
  const flutesFromBody = normalizeFluteList(body.flutes ?? body.fluteOptions ?? body.flute_options ?? body.fluteList ?? body.flute_list)
  const fluteFromBody = body.flute != null ? String(body.flute).trim() : ''
  const flutes = flutesFromBody.length ? flutesFromBody : normalizeFluteList(fluteFromBody)
  const flute = flutes.length ? flutes[0] : fluteFromBody
  const pricePerSqm = normalizeNumber(body.pricePerSqm ?? body.sqmPrice ?? body.unitPrice)

  const nowTs = Date.now()
  const patch = {
    supplierId,
    materialCode,
    grammageG: grammageG != null ? grammageG : null,
    grammageText,
    flute,
    flutes,
    pricePerSqm: pricePerSqm != null && pricePerSqm >= 0 ? pricePerSqm : null,
    updatedAt: nowTs,
    _updateTime: nowTs
  }

  const collection = cloudbaseService.getCollection('supplier_materials')
  const findExisting = async () => {
    const queries = [
      { supplierId, materialCode },
      { supplier_id: supplierId, materialCode },
      { supplierId, material_code: materialCode },
      { supplier_id: supplierId, material_code: materialCode }
    ]
    for (const where of queries) {
      const raw = await collection.where(where).limit(20).get().catch(() => null)
      const docs = Array.isArray(raw?.data) ? raw.data : []
      if (docs.length) return docs
    }
    return []
  }
  const existedDocs = await findExisting()
  const existingDoc = (existedDocs || []).sort((a, b) => Math.max(toTs(b?.updatedAt), toTs(b?._updateTime)) - Math.max(toTs(a?.updatedAt), toTs(a?._updateTime)))[0] || null
  const existingId = existingDoc?._id != null ? String(existingDoc._id) : ''

  if (existingId) {
    await collection.doc(existingId).update({ data: patch }).catch(() => null)
    const got = await collection.doc(existingId).get().catch(() => null)
    const doc = got?.data && got.data.length ? got.data[0] : null
    await updateCustomerSkusForMaterialPrice({ supplierId, materialCode, pricePerSqm: patch.pricePerSqm }).catch(() => null)
    return res.json({ success: true, message: '更新成功', data: { item: normalizeRow(doc || { ...patch, _id: existingId }) } })
  }

  const actorId = req.user?.userId ?? req.user?.id
  const created = await collection.add({
    data: {
      ...patch,
      createdBy: actorId != null ? String(actorId) : '',
      createdAt: nowTs,
      _createTime: nowTs
    }
  })
  const id = created?.id != null ? String(created.id) : ''
  await updateCustomerSkusForMaterialPrice({ supplierId, materialCode, pricePerSqm: patch.pricePerSqm }).catch(() => null)
  return res.status(201).json({ success: true, message: '创建成功', data: { item: normalizeRow({ ...patch, _id: id, createdAt: nowTs, _createTime: nowTs }) } })
}))

router.put('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ success: false, message: 'ID不能为空' })
    const existing = await getLocalDoc('supplier_materials', id).catch(() => null)
    if (!existing) return res.status(404).json({ success: false, message: '记录不存在' })

    const body = req.body || {}
    const patch = { updatedAt: Date.now(), _updateTime: Date.now() }
    if (body.supplierId !== undefined) patch.supplierId = String(body.supplierId || '').trim()
    if (body.materialCode !== undefined || body.code !== undefined) patch.materialCode = String(body.materialCode || body.code || '').trim()
    if (body.grammageG !== undefined || body.grammage !== undefined || body.weightG !== undefined || body.weight !== undefined) {
      patch.grammageG = normalizeGrammageG(body.grammageG ?? body.grammage ?? body.weightG ?? body.weight)
    }
    if (body.grammageText !== undefined || body.grammageLabel !== undefined || body.grammageDisplay !== undefined) {
      patch.grammageText = normalizeText(body.grammageText ?? body.grammageLabel ?? body.grammageDisplay)
    }
    if (body.flutes !== undefined || body.fluteOptions !== undefined || body.flute_options !== undefined || body.fluteList !== undefined || body.flute_list !== undefined) {
      const nextFlutes = normalizeFluteList(body.flutes ?? body.fluteOptions ?? body.flute_options ?? body.fluteList ?? body.flute_list)
      patch.flutes = nextFlutes
      patch.flute = nextFlutes.length ? nextFlutes[0] : ''
    } else if (body.flute !== undefined) {
      const s = body.flute != null ? String(body.flute).trim() : ''
      patch.flutes = normalizeFluteList(s)
      patch.flute = s
    }
    if (body.pricePerSqm !== undefined || body.sqmPrice !== undefined || body.unitPrice !== undefined) {
      const n = normalizeNumber(body.pricePerSqm ?? body.sqmPrice ?? body.unitPrice)
      patch.pricePerSqm = n != null && n >= 0 ? n : null
    }

    const merged = { ...existing, ...patch }
    await upsertLocalDoc('supplier_materials', merged, id)
    return res.json({ success: true, message: '更新成功', data: { item: normalizeRow({ ...merged, _id: id }) } })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const id = String(req.params.id || '').trim()
  if (!id) return res.status(400).json({ success: false, message: 'ID不能为空' })

  const body = req.body || {}
  const patch = { updatedAt: Date.now(), _updateTime: Date.now() }
  if (body.supplierId !== undefined) patch.supplierId = String(body.supplierId || '').trim()
  if (body.materialCode !== undefined || body.code !== undefined) patch.materialCode = String(body.materialCode || body.code || '').trim()
  if (body.grammageG !== undefined || body.grammage !== undefined || body.weightG !== undefined || body.weight !== undefined) {
    patch.grammageG = normalizeGrammageG(body.grammageG ?? body.grammage ?? body.weightG ?? body.weight)
  }
  if (body.grammageText !== undefined || body.grammageLabel !== undefined || body.grammageDisplay !== undefined) {
    patch.grammageText = normalizeText(body.grammageText ?? body.grammageLabel ?? body.grammageDisplay)
  }
  if (body.flutes !== undefined || body.fluteOptions !== undefined || body.flute_options !== undefined || body.fluteList !== undefined || body.flute_list !== undefined) {
    const nextFlutes = normalizeFluteList(body.flutes ?? body.fluteOptions ?? body.flute_options ?? body.fluteList ?? body.flute_list)
    patch.flutes = nextFlutes
    patch.flute = nextFlutes.length ? nextFlutes[0] : ''
  } else if (body.flute !== undefined) {
    const s = body.flute != null ? String(body.flute).trim() : ''
    patch.flutes = normalizeFluteList(s)
    patch.flute = s
  }
  if (body.pricePerSqm !== undefined || body.sqmPrice !== undefined || body.unitPrice !== undefined) {
    const n = normalizeNumber(body.pricePerSqm ?? body.sqmPrice ?? body.unitPrice)
    patch.pricePerSqm = n != null && n >= 0 ? n : null
  }

  const collection = cloudbaseService.getCollection('supplier_materials')
  await collection.doc(id).update({ data: patch }).catch(() => null)
  const got = await collection.doc(id).get().catch(() => null)
  const doc = got?.data && got.data.length ? got.data[0] : null
  if (!doc) return res.status(404).json({ success: false, message: '记录不存在' })
  const nextSupplierId = String(patch?.supplierId ?? doc?.supplierId ?? '').trim()
  const nextCode = String(patch?.materialCode ?? doc?.materialCode ?? '').trim()
  const nextPrice = (patch?.pricePerSqm !== undefined) ? patch.pricePerSqm : doc?.pricePerSqm
  await updateCustomerSkusForMaterialPrice({ supplierId: nextSupplierId, materialCode: nextCode, pricePerSqm: nextPrice }).catch(() => null)
  return res.json({ success: true, message: '更新成功', data: { item: normalizeRow(doc) } })
}))

router.delete('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const id = String(req.params.id || '').trim()
    if (!id) return res.status(400).json({ success: false, message: 'ID不能为空' })
    const existing = await getLocalDoc('supplier_materials', id).catch(() => null)
    await removeLocalDoc('supplier_materials', id)
    return res.json({ success: true, message: '删除成功', data: { item: normalizeRow(existing || { _id: id }) } })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const id = String(req.params.id || '').trim()
  if (!id) return res.status(400).json({ success: false, message: 'ID不能为空' })

  const collection = cloudbaseService.getCollection('supplier_materials')
  const docRes = await collection.doc(id).get().catch(() => null)
  const doc = docRes?.data && docRes.data.length ? docRes.data[0] : null
  await collection.doc(id).remove().catch(() => null)
  return res.json({ success: true, message: '删除成功', data: { item: normalizeRow(doc || { _id: id }) } })
}))

export default router
