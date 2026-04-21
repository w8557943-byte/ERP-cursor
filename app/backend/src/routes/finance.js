import express from 'express'
import { authenticateToken, requireUser } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import cloudbaseService from '../services/cloudbaseService.js'
import { getLocalDoc, listLocalDocs, removeLocalDoc, upsertLocalDoc } from '../utils/localDocStore.js'

const router = express.Router()

const isOfflineMode = () => String(process.env.OFFLINE_MODE || '').toLowerCase() === 'true'

const ensureCloud = async () => {
  const ok = await cloudbaseService.initialize().catch(() => false)
  return ok
}

const safeNumber = (v, fallback) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : fallback
}

const parseDateMs = (v) => {
  if (!v) return NaN
  const t = Date.parse(String(v))
  return Number.isFinite(t) ? t : NaN
}

const generateRecordNo = () => {
  const now = new Date()
  const y = String(now.getFullYear())
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  const dateKey = `${y}${m}${d}`
  const rnd = String(Math.floor(Math.random() * 1000)).padStart(3, '0')
  return `FIN${dateKey}${rnd}`
}

const normalizeRecord = (doc) => {
  const dateMs = Number.isFinite(Number(doc?.date)) ? Number(doc.date) : parseDateMs(doc?.date)
  const createdAt = doc?.createdAt || doc?.createdTime || doc?._createTime || null
  return {
    id: doc?._id != null ? String(doc._id) : (doc?.id != null ? String(doc.id) : ''),
    recordNo: doc?.recordNo || '',
    type: doc?.type || '',
    category: doc?.category || '',
    amount: Number(doc?.amount || 0),
    description: doc?.description || '',
    date: Number.isFinite(dateMs) ? new Date(dateMs).toISOString() : (typeof doc?.date === 'string' ? doc.date : null),
    status: doc?.status || '',
    createdBy: doc?.createdBy || '',
    createdAt: typeof createdAt === 'string' ? createdAt : null
  }
}

const buildReport = async ({ startDate, endDate }) => {
  const startMs = parseDateMs(startDate)
  const endMs = parseDateMs(endDate)
  let rows = []
  if (isOfflineMode()) {
    const all = await listLocalDocs('finance_records', { limit: 10000 }).catch(() => [])
    rows = (all || []).map(normalizeRecord).filter((r) => r.id)
    if (Number.isFinite(startMs) || Number.isFinite(endMs)) {
      rows = rows.filter((r) => {
        const t = parseDateMs(r?.date)
        if (!Number.isFinite(t)) return false
        if (Number.isFinite(startMs) && t < startMs) return false
        if (Number.isFinite(endMs) && t > endMs) return false
        return true
      })
    }
  } else {
    const collection = cloudbaseService.getCollection('finance_records')
    const _ = cloudbaseService.db.command
    const where = {}
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
      where.date = _.and(_.gte(startMs), _.lte(endMs))
    } else if (Number.isFinite(startMs)) {
      where.date = _.gte(startMs)
    } else if (Number.isFinite(endMs)) {
      where.date = _.lte(endMs)
    }
    const result = await collection.where(where).limit(5000).get().catch(() => ({ data: [] }))
    rows = (result?.data || []).map(normalizeRecord).filter((r) => r.id)
  }

  const totalIncome = rows.filter((r) => r.type === 'income').reduce((sum, r) => sum + Number(r.amount || 0), 0)
  const totalExpense = rows.filter((r) => r.type === 'expense').reduce((sum, r) => sum + Number(r.amount || 0), 0)
  const profit = totalIncome - totalExpense

  const incomeByCategory = {}
  const expenseByCategory = {}
  const monthlyData = {}

  rows.forEach((record) => {
    const month = record?.date ? String(record.date).slice(0, 7) : 'unknown'
    if (!monthlyData[month]) {
      monthlyData[month] = { income: 0, expense: 0, profit: 0 }
    }
    if (record.type === 'income') {
      incomeByCategory[record.category] = (incomeByCategory[record.category] || 0) + Number(record.amount || 0)
      monthlyData[month].income += Number(record.amount || 0)
    } else {
      expenseByCategory[record.category] = (expenseByCategory[record.category] || 0) + Number(record.amount || 0)
      monthlyData[month].expense += Number(record.amount || 0)
    }
    monthlyData[month].profit = monthlyData[month].income - monthlyData[month].expense
  })

  return {
    summary: {
      totalIncome,
      totalExpense,
      profit,
      profitMargin: totalIncome > 0 ? ((profit / totalIncome) * 100).toFixed(2) : 0
    },
    incomeByCategory,
    expenseByCategory,
    monthlyTrend: Object.entries(monthlyData).map(([month, data]) => ({
      month,
      ...data
    }))
  }
}

// 获取财务记录列表
router.get('/records', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    pageSize = 10, 
    keyword = '',
    type = '', 
    category = '',
    status = '',
    startDate = '',
    endDate = ''
  } = req.query

  const finalPage = safeNumber(page, 1)
  const finalPageSize = safeNumber(pageSize, 10)

  let rows = []
  if (isOfflineMode()) {
    const all = await listLocalDocs('finance_records', { limit: 10000 }).catch(() => [])
    rows = (all || []).map(normalizeRecord).filter((r) => r.id)
    if (type) rows = rows.filter((r) => String(r.type || '') === String(type))
    if (category) rows = rows.filter((r) => String(r.category || '') === String(category))
    if (status) rows = rows.filter((r) => String(r.status || '') === String(status))
    const startMs = parseDateMs(startDate)
    const endMs = parseDateMs(endDate)
    if (Number.isFinite(startMs) || Number.isFinite(endMs)) {
      rows = rows.filter((r) => {
        const t = parseDateMs(r?.date)
        if (!Number.isFinite(t)) return false
        if (Number.isFinite(startMs) && t < startMs) return false
        if (Number.isFinite(endMs) && t > endMs) return false
        return true
      })
    }
    rows.sort((a, b) => parseDateMs(b.date) - parseDateMs(a.date))
  } else {
    const ok = await ensureCloud()
    if (!ok) {
      return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
    }
    const collection = cloudbaseService.getCollection('finance_records')
    const _ = cloudbaseService.db.command
    const where = {}
    if (type) where.type = String(type)
    if (category) where.category = String(category)
    if (status) where.status = String(status)
    const startMs = parseDateMs(startDate)
    const endMs = parseDateMs(endDate)
    if (Number.isFinite(startMs) && Number.isFinite(endMs)) {
      where.date = _.and(_.gte(startMs), _.lte(endMs))
    } else if (Number.isFinite(startMs)) {
      where.date = _.gte(startMs)
    } else if (Number.isFinite(endMs)) {
      where.date = _.lte(endMs)
    }
    const baseRes = await collection.where(where).orderBy('date', 'desc').orderBy('_createTime', 'desc').limit(2000).get()
    rows = (baseRes?.data || []).map(normalizeRecord).filter((r) => r.id)
  }

  if (keyword) {
    const kw = String(keyword).trim().toLowerCase()
    rows = rows.filter((r) => {
      const hay = `${r.recordNo || ''} ${r.category || ''} ${r.description || ''} ${r.type || ''}`.toLowerCase()
      return hay.includes(kw)
    })
  }

  const total = rows.length
  const startIndex = (finalPage - 1) * finalPageSize
  const paginatedRecords = rows.slice(startIndex, startIndex + finalPageSize)

  res.json({
    success: true,
    data: {
      records: paginatedRecords,
      pagination: {
        page: finalPage,
        pageSize: finalPageSize,
        total,
        totalPages: Math.ceil(total / finalPageSize)
      }
    }
  })
}))

// 获取财务记录详情
router.get('/records/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const id = String(req.params.id || '')
  let doc = null
  if (isOfflineMode()) {
    doc = await getLocalDoc('finance_records', id).catch(() => null)
  } else {
    const ok = await ensureCloud()
    if (!ok) return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
    const collection = cloudbaseService.getCollection('finance_records')
    const existing = await collection.doc(id).get().catch(() => null)
    doc = existing?.data && Array.isArray(existing.data) ? existing.data[0] : existing?.data
  }
  if (!doc) return res.status(404).json({ success: false, message: '财务记录不存在' })

  res.json({
    success: true,
    data: { record: normalizeRecord(doc) }
  })
}))

// 创建财务记录
router.post('/records', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const {
    type,
    category,
    amount,
    description,
    date
  } = req.body

  // 参数验证
  if (!type || !category || !amount || !description) {
    return res.status(400).json({
      success: false,
      message: '类型、分类、金额和描述不能为空'
    })
  }

  const validTypes = ['income', 'expense']
  if (!validTypes.includes(type)) {
    return res.status(400).json({
      success: false,
      message: '无效的类型值'
    })
  }

  const recordNo = generateRecordNo()
  const now = new Date()
  const nowIso = now.toISOString()
  const nowMs = now.getTime()
  const dateMs = Number.isFinite(parseDateMs(date)) ? parseDateMs(date) : nowMs

  const payload = {
    recordNo,
    type,
    category,
    amount: parseFloat(amount),
    description,
    date: dateMs,
    status: 'completed',
    createdBy: req.user?.id ? String(req.user.id) : '',
    createdAt: nowIso,
    updatedAt: nowIso,
    _createTime: nowMs,
    _updateTime: nowMs
  }

  if (isOfflineMode()) {
    const created = await upsertLocalDoc('finance_records', payload)
    return res.status(201).json({
      success: true,
      message: '财务记录创建成功',
      data: { record: normalizeRecord({ ...payload, _id: created?.id }) }
    })
  }

  const ok = await ensureCloud()
  if (!ok) return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  const collection = cloudbaseService.getCollection('finance_records')
  const addRes = await collection.add({ data: payload })

  res.status(201).json({
    success: true,
    message: '财务记录创建成功',
    data: { record: normalizeRecord({ ...payload, _id: addRes?.id }) }
  })
}))

// 更新财务记录
router.put('/records/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const id = String(req.params.id || '')
  const {
    type,
    category,
    amount,
    description,
    date,
    status
  } = req.body

  let doc = null
  if (isOfflineMode()) {
    doc = await getLocalDoc('finance_records', id).catch(() => null)
  } else {
    const ok = await ensureCloud()
    if (!ok) return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
    const collection = cloudbaseService.getCollection('finance_records')
    const existing = await collection.doc(id).get().catch(() => null)
    doc = existing?.data && Array.isArray(existing.data) ? existing.data[0] : existing?.data
  }
  if (!doc) return res.status(404).json({ success: false, message: '财务记录不存在' })

  const update = {}
  if (type) update.type = String(type)
  if (category) update.category = String(category)
  if (amount !== undefined && amount !== null && amount !== '') update.amount = parseFloat(amount)
  if (description) update.description = String(description)
  if (date) {
    const dateMs = parseDateMs(date)
    if (Number.isFinite(dateMs)) update.date = dateMs
  }
  if (status) update.status = String(status)
  update.updatedAt = new Date().toISOString()
  update._updateTime = Date.now()

  if (isOfflineMode()) {
    const merged = { ...doc, ...update }
    await upsertLocalDoc('finance_records', merged, id)
    return res.json({
      success: true,
      message: '财务记录更新成功',
      data: { record: normalizeRecord({ ...merged, _id: id }) }
    })
  }
  const ok = await ensureCloud()
  if (!ok) return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  const collection = cloudbaseService.getCollection('finance_records')
  await collection.doc(id).update({ data: { ...update } })

  res.json({
    success: true,
    message: '财务记录更新成功',
    data: { record: normalizeRecord({ ...doc, ...update, _id: id }) }
  })
}))

// 删除财务记录
router.delete('/records/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const id = String(req.params.id || '')
  let doc = null
  if (isOfflineMode()) {
    doc = await getLocalDoc('finance_records', id).catch(() => null)
    if (!doc) return res.status(404).json({ success: false, message: '财务记录不存在' })
    await removeLocalDoc('finance_records', id)
    return res.json({
      success: true,
      message: '财务记录删除成功',
      data: { record: normalizeRecord({ ...doc, _id: id }) }
    })
  }
  const ok = await ensureCloud()
  if (!ok) return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  const collection = cloudbaseService.getCollection('finance_records')
  const existing = await collection.doc(id).get().catch(() => null)
  doc = existing?.data && Array.isArray(existing.data) ? existing.data[0] : existing?.data
  if (!doc) return res.status(404).json({ success: false, message: '财务记录不存在' })

  await collection.doc(id).remove()

  res.json({
    success: true,
    message: '财务记录删除成功',
    data: { record: normalizeRecord({ ...doc, _id: id }) }
  })
}))

// 获取财务报表统计
router.get('/reports', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { 
    startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
    endDate = new Date().toISOString()
  } = req.query

  if (!isOfflineMode()) {
    const ok = await ensureCloud()
    if (!ok) return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  }
  const report = await buildReport({ startDate, endDate })

  res.json({
    success: true,
    data: {
      ...report
    }
  })
}))

// 导出财务报表
router.get('/reports/export', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { format = 'json' } = req.query
  let rows = []
  if (isOfflineMode()) {
    rows = (await listLocalDocs('finance_records', { limit: 10000 }).catch(() => [])).map(normalizeRecord).filter((r) => r.id)
  } else {
    const ok = await ensureCloud()
    if (!ok) return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
    const collection = cloudbaseService.getCollection('finance_records')
    const result = await collection.limit(5000).get().catch(() => ({ data: [] }))
    rows = (result?.data || []).map(normalizeRecord).filter((r) => r.id)
  }

  if (format === 'csv') {
    const csvData = rows.map(record => 
      `${record.recordNo},${record.type},${record.category},${record.amount},${record.description},${record.date}`
    ).join('\n')
    
    const csvHeaders = '记录编号,类型,分类,金额,描述,日期\n'
    const csvContent = csvHeaders + csvData
    
    res.setHeader('Content-Type', 'text/csv')
    res.setHeader('Content-Disposition', 'attachment; filename=financial_report.csv')
    res.send(csvContent)
  } else {
    // 默认返回JSON格式
    res.json({
      success: true,
      data: {
        records: rows,
        exportTime: new Date().toISOString()
      }
    })
  }
}))

// 获取财务统计信息
router.get('/stats', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const { 
    startDate = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString(),
    endDate = new Date().toISOString()
  } = req.query

  if (!isOfflineMode()) {
    const ok = await ensureCloud()
    if (!ok) return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  }

  const report = await buildReport({ startDate, endDate })
  return res.json({ success: true, data: report })
}))

export default router
