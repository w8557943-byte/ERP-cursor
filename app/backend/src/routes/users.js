import express from 'express'
import bcrypt from 'bcryptjs'
import { authenticateToken, requireUser, requireAdmin } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import cloudbaseService from '../services/cloudbaseService.js'
import { getLocalDoc, listLocalDocs, removeLocalDoc, upsertLocalDoc } from '../utils/localDocStore.js'

const router = express.Router()

const isOfflineMode = () => String(process.env.OFFLINE_MODE || '').toLowerCase() === 'true'

const ensureCloud = async () => {
  const ok = await cloudbaseService.initialize().catch(() => false)
  return ok
}

const normalizeUser = (doc) => {
  if (!doc) return null
  const id = doc?._id != null ? String(doc._id) : (doc?.id != null ? String(doc.id) : '')
  return {
    id,
    username: doc?.username || '',
    email: doc?.email || '',
    role: doc?.role || 'user',
    name: doc?.name || doc?.username || '',
    phone: doc?.phone || '',
    department: doc?.department || '',
    status: doc?.status || 'active',
    createdAt: doc?.createdAt || null,
    lastLogin: doc?.lastLogin || null
  }
}

// 获取用户列表（仅管理员）
router.get('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const { 
    page = 1, 
    pageSize = 10, 
    keyword = '', 
    role = '',
    status = '',
    department = ''
  } = req.query

  const finalPage = Number(page) > 0 ? Number(page) : 1
  const finalPageSize = Number(pageSize) > 0 ? Number(pageSize) : 10
  const kw = String(keyword || '').trim()
  const where = {
    role: role ? String(role) : '',
    status: status ? String(status) : '',
    department: department ? String(department) : ''
  }

  let all = []
  if (isOfflineMode()) {
    all = await listLocalDocs('users', { limit: 10000 }).catch(() => [])
  } else {
    const cloudOk = await ensureCloud()
    if (!cloudOk) {
      return res.status(503).json({ success: false, message: '云服务不可用' })
    }
    const collection = cloudbaseService.getCollection('users')
    const raw = await collection.where({}).orderBy('_updateTime', 'desc').limit(2000).get().catch(() => ({ data: [] }))
    all = raw?.data || []
  }

  let list = all.map(normalizeUser).filter(Boolean)
  if (where.role) list = list.filter((u) => String(u.role || '') === where.role)
  if (where.status) list = list.filter((u) => String(u.status || '') === where.status)
  if (where.department) list = list.filter((u) => String(u.department || '') === where.department)

  if (kw) {
    list = list.filter((u) => (
      String(u.username || '').includes(kw) ||
      String(u.name || '').includes(kw) ||
      String(u.email || '').includes(kw)
    ))
  }

  const total = list.length
  const start = (finalPage - 1) * finalPageSize
  const paged = list.slice(start, start + finalPageSize)

  return res.json({
    success: true,
    data: {
      users: paged,
      pagination: {
        page: finalPage,
        pageSize: finalPageSize,
        total,
        totalPages: total > 0 ? Math.ceil(total / finalPageSize) : 0
      }
    }
  })
}))

// 获取用户详情
router.get('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const userId = String(req.params.id || '').trim()
  if (!userId) {
    return res.status(400).json({ success: false, message: '用户ID不能为空' })
  }

  if (req.user.role !== 'admin' && String(req.user.userId || '') !== userId) {
    return res.status(403).json({
      success: false,
      message: '权限不足'
    })
  }
  let doc = null
  if (isOfflineMode()) {
    doc = await getLocalDoc('users', userId).catch(() => null)
  } else {
    const cloudOk = await ensureCloud()
    if (!cloudOk) {
      return res.status(503).json({ success: false, message: '云服务不可用' })
    }
    const collection = cloudbaseService.getCollection('users')
    const docRes = await collection.doc(userId).get()
    doc = docRes?.data && docRes.data.length ? docRes.data[0] : null
  }
  if (!doc) {
    return res.status(404).json({ success: false, message: '用户不存在' })
  }
  return res.json({
    success: true,
    data: { user: normalizeUser(doc) }
  })
}))

// 创建新用户（仅管理员）
router.post('/', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const {
    username,
    password,
    email,
    name,
    role = 'user',
    phone,
    department
  } = req.body

  // 参数验证
  if (!username || !password || !email || !name) {
    return res.status(400).json({
      success: false,
      message: '用户名、密码、邮箱和姓名不能为空'
    })
  }

  const usernameStr = String(username || '').trim()
  const emailStr = String(email || '').trim()

  const now = new Date().toISOString()
  const passwordHash = await bcrypt.hash(String(password), 10)
  const doc = {
    username: usernameStr,
    password: passwordHash,
    email: emailStr,
    name: String(name || '').trim(),
    role: String(role || 'user'),
    phone: phone ? String(phone) : '',
    department: department ? String(department) : '',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    lastLogin: null,
    _createTime: Date.now(),
    _updateTime: Date.now()
  }
  let id = ''
  if (isOfflineMode()) {
    const all = await listLocalDocs('users', { limit: 10000 }).catch(() => [])
    const hasUsername = (all || []).some((u) => String(u?.username || '') === usernameStr)
    if (hasUsername) return res.status(400).json({ success: false, message: '用户名已存在' })
    const hasEmail = emailStr ? (all || []).some((u) => String(u?.email || '') === emailStr) : false
    if (hasEmail) return res.status(400).json({ success: false, message: '邮箱已存在' })
    const upserted = await upsertLocalDoc('users', doc, usernameStr)
    id = upserted?.id ? String(upserted.id) : usernameStr
  } else {
    const cloudOk = await ensureCloud()
    if (!cloudOk) {
      return res.status(503).json({ success: false, message: '云服务不可用' })
    }
    const collection = cloudbaseService.getCollection('users')
    const existingUser = await collection.where({ username: usernameStr }).limit(1).get()
    if (existingUser?.data && existingUser.data.length) {
      return res.status(400).json({ success: false, message: '用户名已存在' })
    }
    const existingEmail = await collection.where({ email: emailStr }).limit(1).get()
    if (existingEmail?.data && existingEmail.data.length) {
      return res.status(400).json({ success: false, message: '邮箱已存在' })
    }
    const created = await collection.add({ data: doc })
    id = created?.id ? String(created.id) : ''
  }

  return res.status(201).json({
    success: true,
    message: '用户创建成功',
    data: { user: normalizeUser({ ...doc, _id: id }) }
  })
}))

// 更新用户信息（管理员可更新所有用户，普通用户只能更新自己）
router.put('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const userId = String(req.params.id || '').trim()
  if (!userId) {
    return res.status(400).json({ success: false, message: '用户ID不能为空' })
  }

  if (req.user.role !== 'admin' && String(req.user.userId || '') !== userId) {
    return res.status(403).json({
      success: false,
      message: '权限不足'
    })
  }

  const {
    email,
    name,
    phone,
    department,
    status
  } = req.body
  const patch = { updatedAt: new Date().toISOString(), _updateTime: Date.now() }
  if (email !== undefined) patch.email = String(email || '')
  if (name !== undefined) patch.name = String(name || '')
  if (phone !== undefined) patch.phone = String(phone || '')
  if (department !== undefined) patch.department = String(department || '')
  if (status !== undefined && req.user.role === 'admin') patch.status = String(status || '')
  let doc = null
  if (isOfflineMode()) {
    const existing = await getLocalDoc('users', userId).catch(() => null)
    if (!existing) return res.status(404).json({ success: false, message: '用户不存在' })
    const merged = { ...existing, ...patch }
    await upsertLocalDoc('users', merged, userId)
    doc = merged
  } else {
    const cloudOk = await ensureCloud()
    if (!cloudOk) {
      return res.status(503).json({ success: false, message: '云服务不可用' })
    }
    const collection = cloudbaseService.getCollection('users')
    await collection.doc(userId).update({ data: patch }).catch(() => null)
    const docRes = await collection.doc(userId).get()
    doc = docRes?.data && docRes.data.length ? docRes.data[0] : null
  }
  if (!doc) {
    return res.status(404).json({ success: false, message: '用户不存在' })
  }
  return res.json({
    success: true,
    message: '用户信息更新成功',
    data: { user: normalizeUser(doc) }
  })
}))

// 删除用户（仅管理员）
router.delete('/:id', authenticateToken, requireAdmin, asyncHandler(async (req, res) => {
  const userId = String(req.params.id || '').trim()
  if (!userId) {
    return res.status(400).json({ success: false, message: '用户ID不能为空' })
  }

  if (String(req.user.userId || '') === userId) {
    return res.status(400).json({
      success: false,
      message: '不能删除自己的账户'
    })
  }
  let doc = null
  if (isOfflineMode()) {
    doc = await getLocalDoc('users', userId).catch(() => null)
    if (!doc) return res.status(404).json({ success: false, message: '用户不存在' })
    await removeLocalDoc('users', userId)
  } else {
    const cloudOk = await ensureCloud()
    if (!cloudOk) {
      return res.status(503).json({ success: false, message: '云服务不可用' })
    }
    const collection = cloudbaseService.getCollection('users')
    const docRes = await collection.doc(userId).get()
    doc = docRes?.data && docRes.data.length ? docRes.data[0] : null
    if (!doc) {
      return res.status(404).json({ success: false, message: '用户不存在' })
    }
    await collection.doc(userId).remove()
  }
  if (!doc) {
    return res.status(404).json({ success: false, message: '用户不存在' })
  }
  return res.json({
    success: true,
    message: '用户删除成功',
    data: { user: normalizeUser(doc) }
  })
}))

// 修改用户密码
router.patch('/:id/password', authenticateToken, requireUser, asyncHandler(async (req, res) => {
  const userId = String(req.params.id || '').trim()
  const { oldPassword, newPassword } = req.body || {}
  if (!userId) {
    return res.status(400).json({ success: false, message: '用户ID不能为空' })
  }

  if (req.user.role !== 'admin' && String(req.user.userId || '') !== userId) {
    return res.status(403).json({
      success: false,
      message: '权限不足'
    })
  }
  let doc = null
  if (isOfflineMode()) {
    doc = await getLocalDoc('users', userId).catch(() => null)
  } else {
    const cloudOk = await ensureCloud()
    if (!cloudOk) {
      return res.status(503).json({ success: false, message: '云服务不可用' })
    }
    const collection = cloudbaseService.getCollection('users')
    const docRes = await collection.doc(userId).get()
    doc = docRes?.data && docRes.data.length ? docRes.data[0] : null
  }
  if (!doc) {
    return res.status(404).json({ success: false, message: '用户不存在' })
  }
  if (req.user.role !== 'admin') {
    const storedPassword = doc.password || doc.passwordHash || ''
    const passwordLooksHashed = typeof storedPassword === 'string' && storedPassword.startsWith('$2')
    if (!oldPassword) {
      return res.status(400).json({ success: false, message: '旧密码不能为空' })
    }
    const ok = passwordLooksHashed
      ? await bcrypt.compare(String(oldPassword), storedPassword)
      : String(storedPassword || '') === String(oldPassword || '')
    if (!ok) {
      return res.status(400).json({ success: false, message: '旧密码错误' })
    }
  }
  if (!newPassword) {
    return res.status(400).json({ success: false, message: '新密码不能为空' })
  }
  const passwordHash = await bcrypt.hash(String(newPassword), 10)
  if (isOfflineMode()) {
    const merged = { ...doc, password: passwordHash, updatedAt: new Date().toISOString(), _updateTime: Date.now() }
    await upsertLocalDoc('users', merged, userId)
  } else {
    const collection = cloudbaseService.getCollection('users')
    await collection.doc(userId).update({ data: { password: passwordHash, updatedAt: new Date().toISOString(), _updateTime: Date.now() } })
  }
  return res.json({ success: true, message: '密码修改成功' })
}))

export default router
