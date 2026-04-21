import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import { businessLogger } from './logger.js'

const resolveJwtSecret = () => {
  const secret = process.env.JWT_SECRET
  if (secret) return secret
  if ((process.env.NODE_ENV || 'development') === 'development') return 'dev-secret'
  return ''
}

const revokedJtis = new Map()

const normalizeRole = (role) => {
  if (role === 'administrator') return 'admin'
  return role || ''
}

const markRevoked = (jti, expSeconds) => {
  const id = String(jti || '').trim()
  if (!id) return
  const now = Date.now()
  const expMs = Number.isFinite(Number(expSeconds)) ? Number(expSeconds) * 1000 : 0
  const ttlMs = expMs > now ? (expMs - now) : 0
  revokedJtis.set(id, now + Math.max(5 * 60 * 1000, ttlMs || 0))
}

const isRevoked = (jti) => {
  const id = String(jti || '').trim()
  if (!id) return false
  const now = Date.now()
  const expireAt = revokedJtis.get(id)
  if (!expireAt) return false
  if (expireAt <= now) {
    revokedJtis.delete(id)
    return false
  }
  return true
}

const stableHash = (value) => {
  const normalize = (v) => {
    if (v === null || v === undefined) return v
    if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v
    if (v instanceof Date) return v.toISOString()
    if (Array.isArray(v)) return v.map(normalize)
    if (typeof v !== 'object') return String(v)
    const keys = Object.keys(v).sort()
    const out = {}
    for (const k of keys) out[k] = normalize(v[k])
    return out
  }
  try {
    const json = JSON.stringify(normalize(value))
    return crypto.createHash('sha256').update(json).digest('hex')
  } catch (_) {
    return ''
  }
}

const getDeviceId = (req) => {
  const h = req?.headers || {}
  const v =
    h['x-device-id'] ??
    h['X-Device-Id'] ??
    h['x-deviceid'] ??
    h['X-DeviceID'] ??
    h['x-client-id'] ??
    h['X-Client-Id']
  return v == null ? '' : String(v).trim()
}

const unauthStatsByKey = new Map()
const accountLockByUserId = new Map()

const isLocked = (userId) => {
  const id = String(userId || '').trim()
  if (!id) return false
  const now = Date.now()
  const lockedUntil = accountLockByUserId.get(id)
  if (!lockedUntil) return false
  if (lockedUntil <= now) {
    accountLockByUserId.delete(id)
    return false
  }
  return true
}

const noteUnauthorized = ({ deviceId, userId, reason, req }) => {
  const dev = String(deviceId || '').trim()
  const uid = String(userId || '').trim()
  const key = `${dev || 'no_device'}:${uid || 'no_user'}`
  const now = Date.now()
  const windowMs = 60 * 60 * 1000
  const threshold = 3
  const windowStart = now - windowMs
  const entry = unauthStatsByKey.get(key) || { hits: [], lastReason: '' }
  entry.hits = (entry.hits || []).filter((t) => Number(t) >= windowStart)
  entry.hits.push(now)
  entry.lastReason = String(reason || '')
  unauthStatsByKey.set(key, entry)
  if (uid && entry.hits.length >= threshold) {
    accountLockByUserId.set(uid, now + 15 * 60 * 1000)
    try {
      businessLogger.audit('account.lock', 'auth', uid, {
        deviceId: dev || null,
        reason: entry.lastReason || null,
        hitsLastHour: entry.hits.length,
        path: req?.originalUrl || req?.url || '',
        method: req?.method || ''
      })
    } catch (_) { void 0 }
  }
  return entry.hits.length
}

const permissionSnapshotsByUser = new Map()
const permissionDriftHitsByUser = new Map()

const checkPermissionDrift = (user, req) => {
  const userId = String(user?.userId ?? user?.id ?? '').trim()
  if (!userId) return { ok: true }
  const now = Date.now()
  const windowMs = 5 * 60 * 1000
  const perm = {
    role: user?.role || '',
    permissions: Array.isArray(user?.permissions) ? [...user.permissions].sort() : undefined
  }
  const hash = stableHash(perm)
  const prev = permissionSnapshotsByUser.get(userId)
  if (!prev || !prev.hash) {
    permissionSnapshotsByUser.set(userId, { hash, at: now })
    return { ok: true }
  }
  if (prev.hash === hash) return { ok: true }

  permissionSnapshotsByUser.set(userId, { hash, at: now })

  const hits = permissionDriftHitsByUser.get(userId) || []
  const nextHits = hits.filter((t) => Number(t) >= now - windowMs)
  nextHits.push(now)
  permissionDriftHitsByUser.set(userId, nextHits)

  if (nextHits.length >= 2) {
    try {
      businessLogger.audit('permission.drift', 'auth', userId, {
        deviceId: getDeviceId(req) || null,
        prev: prev.hash,
        next: hash,
        path: req?.originalUrl || req?.url || '',
        method: req?.method || ''
      })
    } catch (_) { void 0 }
    return { ok: false, code: 'PERMISSION_DRIFT' }
  }
  return { ok: true }
}

const extractAuthToken = (req) => {
  const h = req?.headers || {}
  const candidates = [
    h.authorization,
    h.Authorization,
    h['x-authorization'],
    h['X-Authorization'],
    h['x-access-token'],
    h['X-Access-Token'],
    h['x-access_token'],
    h['X-Access_Token']
  ]
    .map((v) => (v == null ? '' : String(v)).trim())
    .filter(Boolean)

  for (const raw of candidates) {
    const m = raw.match(/^bearer\s+(.+)$/i)
    if (m && m[1]) return String(m[1]).trim()
    if (raw.includes(' ')) {
      const parts = raw.split(/\s+/).filter(Boolean)
      if (parts.length >= 2) return String(parts[1]).trim()
    }
    return raw
  }
  return ''
}

// 认证中间件 - 验证JWT token
export const authenticateToken = (req, res, next) => {
  try {
    const env = (process.env.NODE_ENV || 'development')
    const isDesktopApp = String(process.env.DESKTOP_APP || '').toLowerCase() === 'true'
    const baseUrl = String(req.baseUrl || '')
    const path = String(req.path || '')
    const allowDevBypass = env === 'development' && !isDesktopApp && (
      req.method === 'GET' ||
      baseUrl === '/api/order-numbers' ||
      (req.method === 'POST' && baseUrl === '/api/orders' && (path === '/fix-duplicate-order-nos' || path === '/fix-missing-qrcodes'))
    )
    if (allowDevBypass) {
      req.user = { userId: '1', id: '1', role: 'admin' }
      return next()
    }
    const token = extractAuthToken(req)

    if (!token) {
      noteUnauthorized({ deviceId: getDeviceId(req), userId: '', reason: 'missing_token', req })
      return res.status(401).json({
        success: false,
        message: '访问令牌不存在'
      })
    }

    // 验证token
    const jwtSecret = resolveJwtSecret()
    if (!jwtSecret) {
      return res.status(500).json({ success: false, message: 'JWT_SECRET 未配置' })
    }
    const decoded = jwt.verify(token, jwtSecret)
    if (decoded && typeof decoded === 'object' && decoded.jti && isRevoked(decoded.jti)) {
      noteUnauthorized({ deviceId: getDeviceId(req), userId: decoded.userId ?? decoded.id ?? '', reason: 'token_revoked', req })
      return res.status(401).json({ success: false, message: '无效的访问令牌', code: 'TOKEN_REVOKED' })
    }
    const userId = decoded && typeof decoded === 'object'
      ? (decoded.userId ?? decoded.id ?? decoded._id)
      : undefined
    req.user = {
      ...(decoded && typeof decoded === 'object' ? decoded : {}),
      ...(decoded && typeof decoded === 'object' ? { role: normalizeRole(decoded.role) } : {}),
      ...(userId !== undefined ? { userId, id: userId } : {})
    }

    const drift = checkPermissionDrift(req.user, req)
    if (!drift.ok) {
      noteUnauthorized({ deviceId: getDeviceId(req), userId: req.user?.userId ?? req.user?.id ?? '', reason: drift.code, req })
      const enforce = String(process.env.ENFORCE_PERMISSION_DRIFT || '').toLowerCase() === 'true'
      if (enforce) {
        return res.status(401).json({ success: false, message: '权限漂移检测触发，请重新登录', code: drift.code })
      }
    }
    if (isLocked(req.user?.userId ?? req.user?.id)) {
      return res.status(423).json({ success: false, message: '账号已被临时锁定，请稍后重试', code: 'ACCOUNT_LOCKED' })
    }
    next()
  } catch (error) {
    const deviceId = getDeviceId(req)
    const jwtSecret = resolveJwtSecret()
    let maybeUserId = ''
    try {
      if (jwtSecret) {
        const decoded = jwt.verify(extractAuthToken(req), jwtSecret, { ignoreExpiration: true })
        if (decoded && typeof decoded === 'object') {
          maybeUserId = String(decoded.userId ?? decoded.id ?? decoded._id ?? '')
        }
      }
    } catch (_) { void 0 }

    if (error.name === 'JsonWebTokenError') {
      noteUnauthorized({ deviceId, userId: maybeUserId, reason: 'token_invalid', req })
      if (maybeUserId && isLocked(maybeUserId)) {
        return res.status(423).json({ success: false, message: '账号已被临时锁定，请稍后重试', code: 'ACCOUNT_LOCKED' })
      }
      return res.status(401).json({
        success: false,
        message: '无效的访问令牌'
      })
    }
    
    if (error.name === 'TokenExpiredError') {
      noteUnauthorized({ deviceId, userId: maybeUserId, reason: 'token_expired', req })
      if (maybeUserId && isLocked(maybeUserId)) {
        return res.status(423).json({ success: false, message: '账号已被临时锁定，请稍后重试', code: 'ACCOUNT_LOCKED' })
      }
      return res.status(401).json({
        success: false,
        message: '访问令牌已过期'
      })
    }

    console.error('Token验证错误:', error)
    return res.status(500).json({
      success: false,
      message: '服务器内部错误'
    })
  }
}

// 权限验证中间件 - 验证用户是否登录
export const requireUser = (req, res, next) => {
  if (!req.user) {
    const env = (process.env.NODE_ENV || 'development')
    const isDesktopApp = String(process.env.DESKTOP_APP || '').toLowerCase() === 'true'
    const baseUrl = String(req.baseUrl || '')
    const path = String(req.path || '')
    const allowDevBypass = env === 'development' && !isDesktopApp && (
      req.method === 'GET' ||
      baseUrl === '/api/order-numbers' ||
      (req.method === 'POST' && baseUrl === '/api/orders' && (path === '/fix-duplicate-order-nos' || path === '/fix-missing-qrcodes'))
    )
    if (allowDevBypass) {
      req.user = { userId: '1', id: '1', role: 'admin' }
      return next()
    }
    noteUnauthorized({ deviceId: getDeviceId(req), userId: '', reason: 'require_user_missing', req })
    return res.status(401).json({
      success: false,
      message: '用户未登录'
    })
  }
  next()
}

// 角色验证中间件 - 验证用户角色
export const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      noteUnauthorized({ deviceId: getDeviceId(req), userId: '', reason: 'require_role_missing', req })
      return res.status(401).json({
        success: false,
        message: '用户未登录'
      })
    }

    const role = normalizeRole(req.user.role)
    if (!roles.includes(role)) {
      return res.status(403).json({
        success: false,
        message: '权限不足，无法访问此资源'
      })
    }

    next()
  }
}

// 管理员权限验证
export const requireAdmin = requireRole(['admin'])

// 数据所有者验证中间件
export const requireOwner = (resourceOwnerField = 'createdBy') => {
  return (req, res, next) => {
    if (!req.user) {
      noteUnauthorized({ deviceId: getDeviceId(req), userId: '', reason: 'require_owner_missing', req })
      return res.status(401).json({
        success: false,
        message: '用户未登录'
      })
    }

    // 如果是管理员，允许访问所有资源
    if (req.user.role === 'admin') {
      return next()
    }

    // 检查资源是否属于当前用户
    const resourceId = req.params.id
    
    // 这里需要根据具体业务逻辑实现资源所有权的验证
    // 例如：从数据库查询资源并检查 createdBy 字段
    
    // 暂时返回成功，实际项目中需要实现具体的资源验证逻辑
    next()
  }
}

export const revokeAuthToken = (req) => {
  try {
    const jwtSecret = resolveJwtSecret()
    if (!jwtSecret) return false
    const token = extractAuthToken(req)
    if (!token) return false
    const decoded = jwt.verify(token, jwtSecret, { ignoreExpiration: true })
    if (!decoded || typeof decoded !== 'object') return false
    const jti = decoded.jti
    const exp = decoded.exp
    if (!jti) return false
    markRevoked(jti, exp)
    return true
  } catch (_) {
    return false
  }
}
