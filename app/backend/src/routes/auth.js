import express from 'express'
import jwt from 'jsonwebtoken'
import bcrypt from 'bcryptjs'
import crypto from 'crypto'
import cloudbaseService from '../services/cloudbaseService.js'
import { revokeAuthToken } from '../middleware/auth.js'
import { getLocalDoc, listLocalDocs, upsertLocalDoc } from '../utils/localDocStore.js'

const router = express.Router()

const isOfflineMode = () => String(process.env.OFFLINE_MODE || '').toLowerCase() === 'true'
const allowLocalAuthFallback = () => String(process.env.AUTH_ALLOW_LOCAL_FALLBACK || '').toLowerCase() === 'true'

const resolveJwtSecret = () => {
  const secret = process.env.JWT_SECRET
  if (secret) return secret
  if ((process.env.NODE_ENV || 'development') === 'development') return 'dev-secret'
  return ''
}

const normalizeRole = (role) => {
  if (role === 'administrator') return 'admin'
  return role || 'user'
}

const extractAuthToken = (req) => {
  const readHeader = (k) => {
    const v = req?.headers?.[k]
    return v == null ? '' : String(v).trim()
  }
  const candidates = [
    readHeader('authorization'),
    readHeader('Authorization'),
    readHeader('x-authorization'),
    readHeader('X-Authorization'),
    readHeader('x-access-token'),
    readHeader('X-Access-Token')
  ].filter(Boolean)
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

const signAccessToken = (cloudUser) => {
  const jwtSecret = resolveJwtSecret()
  if (!jwtSecret) {
    const err = new Error('JWT_SECRET 未配置')
    err.code = 'JWT_SECRET_MISSING'
    throw err
  }
  const userId = cloudUser?._id
  const role = normalizeRole(cloudUser?.role)
  const jti = typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : crypto.randomBytes(16).toString('hex')
  return jwt.sign(
    { userId, username: cloudUser?.username, role, jti },
    jwtSecret,
    { expiresIn: '24h' }
  )
}

const ensureLocalAdmin = async () => {
  const existing = await listLocalDocs('users', { limit: 5 })
  if (existing.length) return null
  const passwordHash = await bcrypt.hash('admin123', 10)
  const nowIso = new Date().toISOString()
  const nowMs = Date.now()
  const doc = {
    username: 'admin',
    name: '管理员',
    role: 'admin',
    status: 'active',
    email: '',
    phone: '',
    department: '',
    password: passwordHash,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastLogin: null,
    _createTime: nowMs,
    _updateTime: nowMs
  }
  await upsertLocalDoc('users', doc, 'admin')
  return doc
}

// 登录接口
router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body

    // 参数验证
    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: '用户名和密码不能为空'
      })
    }

    const usernameStr = typeof username === 'string' ? username.trim() : String(username || '').trim()
    const phoneLooksValid = /^1[3-9]\d{9}$/.test(usernameStr)

    const loginWithLocal = async () => {
      await ensureLocalAdmin().catch(() => null)
      let localUser = await getLocalDoc('users', usernameStr).catch(() => null)
      if (!localUser && phoneLooksValid) {
        const all = await listLocalDocs('users', { limit: 2000 }).catch(() => [])
        localUser = (all || []).find((u) => String(u?.phone || '').trim() === usernameStr) || null
      }
      if (!localUser) return null
      const storedPassword = localUser.password || localUser.passwordHash || ''
      const passwordLooksHashed = typeof storedPassword === 'string' && storedPassword.startsWith('$2')
      const isValidPassword = passwordLooksHashed
        ? await bcrypt.compare(password, storedPassword)
        : String(storedPassword || '') === String(password || '')
      if (!isValidPassword) return null
      const token = signAccessToken({ ...localUser, _id: localUser._id || localUser.id })
      return {
        user: {
          id: localUser._id || localUser.id || usernameStr,
          username: localUser.username || usernameStr,
          email: localUser.email || '',
          role: normalizeRole(localUser.role),
          name: localUser.name || localUser.username || usernameStr
        },
        token
      }
    }

    if (isOfflineMode()) {
      const local = await loginWithLocal()
      if (!local) return res.status(401).json({ success: false, message: '用户名或密码错误' })
      return res.json({ success: true, message: '登录成功', data: local })
    }

    const cloudOk = await cloudbaseService.initialize().catch(() => false)
    if (!cloudOk) {
      if (allowLocalAuthFallback()) {
        const local = await loginWithLocal().catch(() => null)
        if (local) return res.json({ success: true, message: '登录成功', data: local })
      }
      return res.status(503).json({ success: false, message: cloudbaseService?.lastInitError || '认证服务不可用' })
    }

    let cloudUser = null
    try {
      const collection = cloudbaseService.getCollection('users')
      const queries = [
        collection.where({ username: usernameStr }).limit(1).get()
      ]
      if (phoneLooksValid) {
        queries.push(collection.where({ phone: usernameStr }).limit(1).get())
      }
      const results = await Promise.all(queries)
      cloudUser = results
        .map(r => (r && r.data && r.data.length ? r.data[0] : null))
        .find(Boolean) || null
    } catch (cloudError) {
      if (allowLocalAuthFallback()) {
        const local = await loginWithLocal().catch(() => null)
        if (local) return res.json({ success: true, message: '登录成功', data: local })
      }
      return res.status(503).json({ success: false, message: '云开发数据库服务不可用', error: (process.env.NODE_ENV || 'development') === 'development' ? cloudError.message : undefined })
    }

    if (!cloudUser) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      })
    }

    const storedPassword = cloudUser.password || cloudUser.passwordHash || ''
    const passwordLooksHashed = typeof storedPassword === 'string' && storedPassword.startsWith('$2')
    const isValidPassword = passwordLooksHashed
      ? await bcrypt.compare(password, storedPassword)
      : String(storedPassword || '') === String(password || '')

    if (!isValidPassword) {
      return res.status(401).json({
        success: false,
        message: '用户名或密码错误'
      })
    }

    const token = signAccessToken(cloudUser)

    // 返回用户信息和token
    res.json({
      success: true,
      message: '登录成功',
      data: {
        user: {
          id: cloudUser._id,
          username: cloudUser.username,
          email: cloudUser.email || '',
          role: normalizeRole(cloudUser.role),
          name: cloudUser.name || cloudUser.username
        },
        token
      }
    })

  } catch (error) {
    console.error('登录错误:', error)
    res.status(500).json({
      success: false,
      message: '服务器内部错误'
    })
  }
})

// 登出接口
router.post('/logout', (req, res) => {
  try { revokeAuthToken(req) } catch (_) { void 0 }
  res.json({
    success: true,
    message: '登出成功'
  })
})

// 获取当前用户信息
router.get('/me', async (req, res) => {
  try {
    const token = extractAuthToken(req)
    
    if (!token) {
      return res.status(401).json({
        success: false,
        message: '未提供认证令牌'
      })
    }

    // 验证token
    const jwtSecret = resolveJwtSecret()
    if (!jwtSecret) {
      return res.status(500).json({ success: false, message: 'JWT_SECRET 未配置' })
    }
    const decoded = jwt.verify(token, jwtSecret)
    const userId = decoded && typeof decoded === 'object' ? (decoded.userId ?? decoded.id ?? decoded._id) : undefined
    const username = decoded && typeof decoded === 'object' ? decoded.username : undefined

    const readLocal = async () => {
      const byId = userId ? await getLocalDoc('users', String(userId)).catch(() => null) : null
      if (byId) return byId
      if (username) return await getLocalDoc('users', String(username)).catch(() => null)
      return null
    }

    const readCloud = async () => {
      const cloudOk = await cloudbaseService.initialize().catch(() => false)
      if (!cloudOk) return null
      if (!userId) return null
      const collection = cloudbaseService.getCollection('users')
      const result = await collection.where({ _id: String(userId) }).limit(1).get().catch(() => ({ data: [] }))
      return result && result.data && result.data.length ? result.data[0] : null
    }

    const primary = isOfflineMode() ? readLocal : readCloud
    const secondary = isOfflineMode() ? readCloud : readLocal
    let found = await primary()
    if (!found) found = await secondary()

    if (!found) {
      return res.status(401).json({ success: false, message: '用户不存在' })
    }

    const role = normalizeRole(found.role)
    return res.json({
      success: true,
      data: {
        user: {
          id: found._id || found.id || (userId != null ? String(userId) : ''),
          username: found.username || (username != null ? String(username) : ''),
          email: found.email || '',
          role,
          name: found.name || found.username || (username != null ? String(username) : '')
        }
      }
    })

  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({
        success: false,
        message: '无效的认证令牌'
      })
    }
    
    console.error('获取用户信息错误:', error)
    res.status(500).json({
      success: false,
      message: '服务器内部错误'
    })
  }
})

// 刷新token
router.post('/refresh', async (req, res) => {
  try {
    const token = extractAuthToken(req)
    if (!token) {
      return res.status(401).json({ success: false, message: '未提供认证令牌' })
    }
    const jwtSecret = resolveJwtSecret()
    if (!jwtSecret) {
      return res.status(500).json({ success: false, message: 'JWT_SECRET 未配置' })
    }
    const decoded = jwt.verify(token, jwtSecret, { ignoreExpiration: true })
    const userId = decoded && typeof decoded === 'object'
      ? (decoded.userId ?? decoded.id ?? decoded._id)
      : undefined
    if (!userId) {
      return res.status(401).json({ success: false, message: '无效的认证令牌' })
    }
    let cloudUser = null
    if (isOfflineMode()) {
      cloudUser = await getLocalDoc('users', String(userId)).catch(() => null)
      if (!cloudUser) {
        const username = decoded && typeof decoded === 'object' ? decoded.username : undefined
        if (username) cloudUser = await getLocalDoc('users', String(username)).catch(() => null)
      }
    } else {
      const cloudOk = await cloudbaseService.initialize().catch(() => false)
      if (!cloudOk) {
        cloudUser = await getLocalDoc('users', String(userId)).catch(() => null)
        if (!cloudUser) {
          const username = decoded && typeof decoded === 'object' ? decoded.username : undefined
          if (username) cloudUser = await getLocalDoc('users', String(username)).catch(() => null)
        }
      }
      if (!cloudUser) {
        const collection = cloudbaseService.getCollection('users')
        const result = await collection.where({ _id: userId }).limit(1).get().catch(() => ({ data: [] }))
        cloudUser = result && result.data && result.data.length ? result.data[0] : null
      }
    }
    if (!cloudUser) {
      return res.status(401).json({ success: false, message: '用户不存在' })
    }
    const nextToken = signAccessToken(cloudUser)
    return res.json({
      success: true,
      message: 'Token刷新成功',
      data: {
        user: {
          id: cloudUser._id || cloudUser.id || String(userId),
          username: cloudUser.username || (decoded && typeof decoded === 'object' ? String(decoded.username || '') : ''),
          email: cloudUser.email || '',
          role: normalizeRole(cloudUser.role),
          name: cloudUser.name || cloudUser.username || (decoded && typeof decoded === 'object' ? String(decoded.username || '') : '')
        },
        token: nextToken
      }
    })
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ success: false, message: '无效的认证令牌' })
    }
    return res.status(500).json({ success: false, message: '服务器内部错误' })
  }
})

export default router
