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

const unwrapApiBridgeResult = (cf) => {
  const raw = (cf && typeof cf === 'object' && 'result' in cf) ? cf.result : cf
  const statusCodeRaw = Number(raw?.statusCode)
  const statusCode = Number.isFinite(statusCodeRaw) ? statusCodeRaw : 200
  const bodyText = raw?.body
  if (typeof bodyText === 'string' && bodyText) {
    try {
      return { statusCode, payload: JSON.parse(bodyText) }
    } catch (_) {
      return { statusCode: 502, payload: { success: false, message: '云端返回解析失败' } }
    }
  }
  if (raw && typeof raw === 'object') return { statusCode, payload: raw }
  return { statusCode: 502, payload: { success: false, message: '云端无有效返回' } }
}

const normalizeErrorStatus = (statusCode, payload) => {
  const sc = Number(statusCode)
  const base = Number.isFinite(sc) ? sc : 200
  if (base >= 400) return base
  if (payload && typeof payload === 'object' && payload.success === false) {
    return 400
  }
  return base
}

const buildApiBridgeEvent = (req, { path, httpMethod, query, body }) => {
  const auth = String(req.headers?.authorization || req.headers?.Authorization || '').trim()
  const headers = auth ? { Authorization: auth, authorization: auth } : {}
  const event = {
    httpMethod,
    path,
    headers
  }
  if (query && typeof query === 'object' && Object.keys(query).length) {
    event.queryStringParameters = query
  }
  if (body !== undefined) {
    event.body = JSON.stringify(body || {})
  }
  return event
}

router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const key = String(req.query?.key || req.query?.statementNo || '').trim()
    if (key) {
      const doc = await getLocalDoc('statements', key).catch(() => null)
      if (!doc) return res.json({ success: true, data: { statements: [] } })
      return res.json({ success: true, data: { statement: { data: doc }, statements: [{ data: doc }] } })
    }
    const all = await listLocalDocs('statements', { limit: 5000 }).catch(() => [])
    const list = (all || []).map((d) => ({ data: d }))
    return res.json({ success: true, data: { statements: list } })
  }

  const ok = await ensureCloud()
  if (!ok) {
    return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  }

  const cf = await cloudbaseService.callFunction('api-bridge', buildApiBridgeEvent(req, {
    httpMethod: 'GET',
    path: '/statements',
    query: req.query || {}
  }))
  const { statusCode, payload } = unwrapApiBridgeResult(cf)
  return res.status(normalizeErrorStatus(statusCode, payload)).json(payload)
}))

router.post('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const body = req.body || {}
    const statementNo = String(body.statementNo || body.key || '').trim()
    if (!statementNo) return res.status(400).json({ success: false, message: '缺少对账单号' })
    const now = Date.now()
    const merged = {
      ...(body && typeof body === 'object' ? body : {}),
      statementNo,
      updatedAt: now,
      meta: body?.meta && typeof body.meta === 'object' ? { ...body.meta, updatedAt: now } : { updatedAt: now }
    }
    await upsertLocalDoc('statements', merged, statementNo)
    return res.json({ success: true, data: { statement: { data: merged } } })
  }

  const ok = await ensureCloud()
  if (!ok) {
    return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  }

  const cf = await cloudbaseService.callFunction('api-bridge', buildApiBridgeEvent(req, {
    httpMethod: 'POST',
    path: '/statements',
    body: req.body || {}
  }))
  const { statusCode, payload } = unwrapApiBridgeResult(cf)
  return res.status(normalizeErrorStatus(statusCode, payload)).json(payload)
}))

router.post('/rollback', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  if (isOfflineMode()) {
    const backupId = String(req.body?.backupId || '').trim()
    if (!backupId) return res.status(400).json({ success: false, message: '缺少backupId' })
    const all = await listLocalDocs('statements', { limit: 10000 }).catch(() => [])
    const matched = (all || []).filter((d) => String(d?.meta?.backupId || '') === backupId)
    await Promise.all(matched.map((d) => removeLocalDoc('statements', String(d?._id || d?.id || '')).catch(() => null)))
    return res.json({ success: true, data: { removed: matched.length } })
  }

  const ok = await ensureCloud()
  if (!ok) {
    return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
  }

  const cf = await cloudbaseService.callFunction('api-bridge', buildApiBridgeEvent(req, {
    httpMethod: 'POST',
    path: '/statements/rollback',
    body: req.body || {}
  }))
  const { statusCode, payload } = unwrapApiBridgeResult(cf)
  return res.status(normalizeErrorStatus(statusCode, payload)).json(payload)
}))

export default router
