import express from 'express'
import { authenticateToken, requireUser } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import cloudbaseService from '../services/cloudbaseService.js'
import { listLocalDocs, removeLocalDoc, upsertLocalDoc } from '../utils/localDocStore.js'

const router = express.Router()

const isOfflineMode = () => String(process.env.OFFLINE_MODE || '').toLowerCase() === 'true'

const ensureCloud = async () => {
  const ok = await cloudbaseService.initialize().catch(() => false)
  return ok
}

const normalizeText = (v) => String(v == null ? '' : v).trim()

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
  const id = doc?._id != null ? String(doc._id) : String(doc?.id || '')
  if (!id) return null
  return {
    id,
    _id: id,
    materialCode: normalizeText(doc.materialCode ?? doc.code),
    paperName: normalizeText(doc.paperName ?? doc.paper ?? doc.name),
    grammageG: normalizeGrammageG(doc.grammageG ?? doc.grammage ?? doc.weightG ?? doc.weight),
    createdAt: doc.createdAt || doc._createTime || null,
    updatedAt: doc.updatedAt || doc._updateTime || null
  }
}

router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const keyword = normalizeText(req.query?.keyword || req.query?.q || req.query?.search)
    let list = (await listLocalDocs('material_codes', { limit: 10000 }).catch(() => []))
      .map(normalizeRow)
      .filter(Boolean)
    if (keyword) {
      list = list.filter((r) => (
        String(r.materialCode || '').includes(keyword) ||
        String(r.paperName || '').includes(keyword)
      ))
    }
    list.sort((a, b) => String(a.materialCode || '').localeCompare(String(b.materialCode || ''), 'zh-CN'))
    return res.json({ success: true, data: list })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const keyword = normalizeText(req.query?.keyword || req.query?.q || req.query?.search)
  const collection = cloudbaseService.getCollection('material_codes')

  const raw = await collection.limit(2000).get().catch(() => null)
  let list = (raw?.data || []).map(normalizeRow).filter(Boolean)

  if (keyword) {
    list = list.filter((r) => (
      String(r.materialCode || '').includes(keyword) ||
      String(r.paperName || '').includes(keyword)
    ))
  }

  list.sort((a, b) => String(a.materialCode || '').localeCompare(String(b.materialCode || ''), 'zh-CN'))
  return res.json({ success: true, data: list })
}))

router.post('/upsert', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const body = req.body || {}
    const materialCode = normalizeText(body.materialCode ?? body.code)
    const paperName = normalizeText(body.paperName ?? body.paper ?? body.name)
    const grammageG = normalizeGrammageG(body.grammageG ?? body.grammage ?? body.weightG ?? body.weight)

    if (!paperName) return res.status(400).json({ success: false, message: 'paperName不能为空' })
    if (!materialCode) return res.status(400).json({ success: false, message: 'materialCode不能为空' })
    if (grammageG == null) return res.status(400).json({ success: false, message: 'grammageG不能为空' })

    const nowTs = Date.now()
    const patch = {
      paperName,
      materialCode,
      grammageG,
      updatedAt: nowTs,
      _updateTime: nowTs,
      createdAt: nowTs,
      _createTime: nowTs
    }
    await upsertLocalDoc('material_codes', patch, materialCode)
    return res.status(201).json({ success: true, message: '创建成功', data: { item: normalizeRow({ ...patch, _id: materialCode }) } })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const body = req.body || {}
  const materialCode = normalizeText(body.materialCode ?? body.code)
  const paperName = normalizeText(body.paperName ?? body.paper ?? body.name)
  const grammageG = normalizeGrammageG(body.grammageG ?? body.grammage ?? body.weightG ?? body.weight)

  if (!paperName) return res.status(400).json({ success: false, message: 'paperName不能为空' })
  if (!materialCode) return res.status(400).json({ success: false, message: 'materialCode不能为空' })
  if (grammageG == null) return res.status(400).json({ success: false, message: 'grammageG不能为空' })

  const nowTs = Date.now()
  const patch = {
    paperName,
    materialCode,
    grammageG,
    updatedAt: nowTs,
    _updateTime: nowTs
  }

  const collection = cloudbaseService.getCollection('material_codes')
  const existed = await collection.where({ materialCode }).limit(1).get().catch(() => null)
  const first = existed?.data && existed.data.length ? existed.data[0] : null
  const existingId = first?._id != null ? String(first._id) : ''

  if (existingId) {
    await collection.doc(existingId).update({ data: patch }).catch(() => null)
    const got = await collection.doc(existingId).get().catch(() => null)
    const doc = got?.data && got.data.length ? got.data[0] : null
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
  return res.status(201).json({ success: true, message: '创建成功', data: { item: normalizeRow({ ...patch, _id: id, createdAt: nowTs, _createTime: nowTs }) } })
}))

router.delete('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const id = normalizeText(req.params.id)
    if (!id) return res.status(400).json({ success: false, message: 'ID不能为空' })
    await removeLocalDoc('material_codes', id)
    return res.json({ success: true, message: '删除成功', data: { item: normalizeRow({ _id: id, materialCode: id }) } })
  }

  const cloudOk = await ensureCloud()
  if (!cloudOk) {
    return res.status(503).json({ success: false, message: '云服务不可用' })
  }

  const id = normalizeText(req.params.id)
  if (!id) return res.status(400).json({ success: false, message: 'ID不能为空' })

  const collection = cloudbaseService.getCollection('material_codes')
  const docRes = await collection.doc(id).get().catch(() => null)
  const doc = docRes?.data && docRes.data.length ? docRes.data[0] : null
  await collection.doc(id).remove().catch(() => null)
  return res.json({ success: true, message: '删除成功', data: { item: normalizeRow(doc || { _id: id }) } })
}))

export default router
