import express from 'express'
import { authenticateToken, requireUser } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import cloudbaseService from '../services/cloudbaseService.js'
import { getLocalDoc, listLocalDocs, removeLocalDoc, upsertLocalDoc } from '../utils/localDocStore.js'

const router = express.Router()

const isOfflineMode = () => String(process.env.OFFLINE_MODE || '').toLowerCase() === 'true'

router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query
  if (isOfflineMode()) {
    const startMs = startDate ? new Date(String(startDate)).getTime() : NaN
    const endMs = endDate ? new Date(String(endDate)).getTime() : NaN
    const all = await listLocalDocs('fixed_costs', { limit: 10000 }).catch(() => [])
    let items = (all || []).map((doc) => ({
      id: doc?._id != null ? String(doc._id) : '',
      category: doc?.category || '',
      amount: Number(doc?.amount || 0),
      date: Number.isFinite(Number(doc?.date)) ? Number(doc.date) : null,
      remark: doc?.remark || ''
    })).filter((it) => it.id)
    if (Number.isFinite(startMs) || Number.isFinite(endMs)) {
      items = items.filter((it) => {
        const t = Number(it?.date)
        if (!Number.isFinite(t)) return false
        if (Number.isFinite(startMs) && t < startMs) return false
        if (Number.isFinite(endMs) && t > endMs) return false
        return true
      })
    }
    items.sort((a, b) => Number(b.date || 0) - Number(a.date || 0))
    return res.json({ success: true, data: { items } })
  }

  const ok = await cloudbaseService.initialize().catch(() => false)
  if (!ok) {
    return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  }

  const collection = cloudbaseService.getCollection('fixed_costs')
  const _ = cloudbaseService.db.command

  const startMs = startDate ? new Date(String(startDate)).getTime() : NaN
  const endMs = endDate ? new Date(String(endDate)).getTime() : NaN

  const where = {}
  if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
    where.date = _.and(_.gte(startMs), _.lte(endMs))
  } else if (Number.isFinite(startMs)) {
    where.date = _.gte(startMs)
  } else if (Number.isFinite(endMs)) {
    where.date = _.lte(endMs)
  }

  const result = await collection
    .where(where)
    .orderBy('date', 'desc')
    .orderBy('_createTime', 'desc')
    .limit(2000)
    .get()

  const items = (result?.data || []).map((doc) => ({
    id: doc?._id != null ? String(doc._id) : '',
    category: doc?.category || '',
    amount: Number(doc?.amount || 0),
    date: Number.isFinite(Number(doc?.date)) ? Number(doc.date) : null,
    remark: doc?.remark || ''
  })).filter((it) => it.id)

  res.json({
    success: true,
    data: {
      items
    }
  })
}))

router.post('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { category, amount, date, remark } = req.body || {}
  const rawCategory = String(category || '').trim()
  const parsedAmount = Number(amount)
  const dateValue = date != null ? new Date(date) : null
  if (!rawCategory) {
    return res.status(400).json({
      success: false,
      message: '类别不能为空'
    })
  }
  if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
    return res.status(400).json({
      success: false,
      message: '金额必须为大于0的数字'
    })
  }
  if (!dateValue || Number.isNaN(dateValue.getTime())) {
    return res.status(400).json({
      success: false,
      message: '日期不合法'
    })
  }

  if (isOfflineMode()) {
    const now = new Date()
    const nowIso = now.toISOString()
    const nowMs = now.getTime()
    const dateMs = dateValue.getTime()
    const doc = {
      category: rawCategory,
      amount: parsedAmount,
      date: dateMs,
      remark: remark ? String(remark) : '',
      createdBy: req.user && (req.user.id || req.user.userId) ? String(req.user.id || req.user.userId) : '',
      createdAt: nowIso,
      updatedAt: nowIso,
      _createTime: nowMs,
      _updateTime: nowMs
    }
    const created = await upsertLocalDoc('fixed_costs', doc)
    return res.status(201).json({
      success: true,
      data: {
        item: {
          id: String(created?.id || ''),
          category: rawCategory,
          amount: parsedAmount,
          date: dateMs,
          remark: remark ? String(remark) : ''
        }
      }
    })
  }

  const ok = await cloudbaseService.initialize().catch(() => false)
  if (!ok) {
    return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  }

  const now = new Date()
  const nowIso = now.toISOString()
  const nowMs = now.getTime()
  const dateMs = dateValue.getTime()

  const collection = cloudbaseService.getCollection('fixed_costs')
  const addRes = await collection.add({
    data: {
      category: rawCategory,
      amount: parsedAmount,
      date: dateMs,
      remark: remark ? String(remark) : '',
      createdBy: req.user && req.user.id ? String(req.user.id) : '',
      createdAt: nowIso,
      updatedAt: nowIso,
      _createTime: nowMs,
      _updateTime: nowMs
    }
  })

  res.status(201).json({
    success: true,
    data: {
      item: {
        id: addRes?.id != null ? String(addRes.id) : '',
        category: rawCategory,
        amount: parsedAmount,
        date: dateMs,
        remark: remark ? String(remark) : ''
      }
    }
  })
}))

router.delete('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const id = req.params.id
  if (!id) {
    return res.status(400).json({
      success: false,
      message: '缺少ID'
    })
  }

  if (isOfflineMode()) {
    const doc = await getLocalDoc('fixed_costs', String(id)).catch(() => null)
    if (!doc) return res.status(404).json({ success: false, message: '记录不存在' })
    await removeLocalDoc('fixed_costs', String(id))
    return res.json({
      success: true,
      data: {
        item: {
          id: doc?._id != null ? String(doc._id) : String(id),
          category: doc?.category || '',
          amount: Number(doc?.amount || 0),
          date: Number.isFinite(Number(doc?.date)) ? Number(doc.date) : null,
          remark: doc?.remark || ''
        }
      }
    })
  }

  const ok = await cloudbaseService.initialize().catch(() => false)
  if (!ok) {
    return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  }

  const collection = cloudbaseService.getCollection('fixed_costs')
  const existing = await collection.doc(String(id)).get().catch(() => null)
  const doc = existing?.data
  if (!doc) return res.status(404).json({ success: false, message: '记录不存在' })

  await collection.doc(String(id)).remove()

  res.json({
    success: true,
    data: {
      item: {
        id: doc?._id != null ? String(doc._id) : String(id),
        category: doc?.category || '',
        amount: Number(doc?.amount || 0),
        date: Number.isFinite(Number(doc?.date)) ? Number(doc.date) : null,
        remark: doc?.remark || ''
      }
    }
  })
}))

export default router
