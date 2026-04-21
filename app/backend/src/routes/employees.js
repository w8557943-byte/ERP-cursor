import express from 'express'
import { authenticateToken, requireUser } from '../middleware/auth.js'
import { asyncHandler } from '../middleware/errorHandler.js'
import cloudbaseService from '../services/cloudbaseService.js'
import { getLocalDoc, listLocalDocs, removeLocalDoc, upsertLocalDoc } from '../utils/localDocStore.js'

const router = express.Router()

const isOfflineMode = () => String(process.env.OFFLINE_MODE || '').toLowerCase() === 'true'

// 获取员工列表
router.get('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
    if (isOfflineMode()) {
        const items = await listLocalDocs('employees', { limit: 5000 }).catch(() => [])
        const normalized = (items || []).map((doc) => ({
            id: doc?._id != null ? String(doc._id) : '',
            name: doc?.name || '',
            position: doc?.position || '',
            department: doc?.department || '',
            phone: doc?.phone || '',
            email: doc?.email || '',
            status: doc?.status || 'active',
            hireDate: doc?.hireDate || null,
            createdAt: doc?.createdAt || doc?._createTime || null
        })).filter((it) => it.id)
        return res.json({ success: true, data: { items: normalized, total: normalized.length } })
    }

    const ok = await cloudbaseService.initialize().catch(() => false)
    if (!ok) {
        return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
    }

    const collection = cloudbaseService.getCollection('employees')

    const result = await collection
        .orderBy('_createTime', 'desc')
        .limit(1000)
        .get()

    const items = (result?.data || []).map((doc) => ({
        id: doc?._id != null ? String(doc._id) : '',
        name: doc?.name || '',
        position: doc?.position || '',
        department: doc?.department || '',
        phone: doc?.phone || '',
        email: doc?.email || '',
        status: doc?.status || 'active',
        hireDate: doc?.hireDate || null,
        createdAt: doc?.createdAt || doc?._createTime || null
    })).filter((it) => it.id)

    res.json({
        success: true,
        data: {
            items,
            total: items.length
        }
    })
}))

// 获取单个员工
router.get('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
    const id = req.params.id
    if (!id) {
        return res.status(400).json({
            success: false,
            message: '缺少员工ID'
        })
    }

    if (isOfflineMode()) {
        const doc = await getLocalDoc('employees', String(id)).catch(() => null)
        if (!doc) return res.status(404).json({ success: false, message: '员工不存在' })
        return res.json({
            success: true,
            data: {
                id: doc?._id != null ? String(doc._id) : String(id),
                name: doc?.name || '',
                position: doc?.position || '',
                department: doc?.department || '',
                phone: doc?.phone || '',
                email: doc?.email || '',
                status: doc?.status || 'active',
                hireDate: doc?.hireDate || null,
                createdAt: doc?.createdAt || doc?._createTime || null
            }
        })
    }

    const ok = await cloudbaseService.initialize().catch(() => false)
    if (!ok) {
        return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
    }

    const collection = cloudbaseService.getCollection('employees')
    const existing = await collection.doc(String(id)).get().catch(() => null)
    const doc = existing?.data

    if (!doc) {
        return res.status(404).json({ success: false, message: '员工不存在' })
    }

    res.json({
        success: true,
        data: {
            id: doc?._id != null ? String(doc._id) : '',
            name: doc?.name || '',
            position: doc?.position || '',
            department: doc?.department || '',
            phone: doc?.phone || '',
            email: doc?.email || '',
            status: doc?.status || 'active',
            hireDate: doc?.hireDate || null,
            createdAt: doc?.createdAt || doc?._createTime || null
        }
    })
}))

// 创建员工
router.post('/', authenticateToken, requireUser, asyncHandler(async (req, res) => {
    const { name, position, department, phone, email, hireDate } = req.body || {}

    const rawName = String(name || '').trim()
    if (!rawName) {
        return res.status(400).json({
            success: false,
            message: '员工姓名不能为空'
        })
    }

    if (isOfflineMode()) {
        const now = new Date()
        const nowIso = now.toISOString()
        const nowMs = now.getTime()
        const doc = {
            name: rawName,
            position: position ? String(position) : '',
            department: department ? String(department) : '',
            phone: phone ? String(phone) : '',
            email: email ? String(email) : '',
            status: 'active',
            hireDate: hireDate || nowIso,
            createdBy: req.user && (req.user.id || req.user.userId) ? String(req.user.id || req.user.userId) : '',
            createdAt: nowIso,
            updatedAt: nowIso,
            _createTime: nowMs,
            _updateTime: nowMs
        }
        const created = await upsertLocalDoc('employees', doc)
        return res.status(201).json({
            success: true,
            data: {
                id: String(created?.id || ''),
                name: rawName,
                position: position ? String(position) : '',
                department: department ? String(department) : '',
                phone: phone ? String(phone) : '',
                email: email ? String(email) : '',
                status: 'active',
                hireDate: hireDate || nowIso
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

    const collection = cloudbaseService.getCollection('employees')
    const addRes = await collection.add({
        data: {
            name: rawName,
            position: position ? String(position) : '',
            department: department ? String(department) : '',
            phone: phone ? String(phone) : '',
            email: email ? String(email) : '',
            status: 'active',
            hireDate: hireDate || nowIso,
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
            id: addRes?.id != null ? String(addRes.id) : '',
            name: rawName,
            position: position ? String(position) : '',
            department: department ? String(department) : '',
            phone: phone ? String(phone) : '',
            email: email ? String(email) : '',
            status: 'active',
            hireDate: hireDate || nowIso
        }
    })
}))

// 更新员工
router.put('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
    const id = req.params.id
    if (!id) {
        return res.status(400).json({
            success: false,
            message: '缺少员工ID'
        })
    }

    if (isOfflineMode()) {
        const existing = await getLocalDoc('employees', String(id)).catch(() => null)
        if (!existing) return res.status(404).json({ success: false, message: '员工不存在' })
        const { name, position, department, phone, email, status, hireDate } = req.body || {}
        const now = new Date()
        const nowIso = now.toISOString()
        const nowMs = now.getTime()
        const updateData = { ...existing, updatedAt: nowIso, _updateTime: nowMs }
        if (name !== undefined) updateData.name = String(name || '').trim()
        if (position !== undefined) updateData.position = String(position || '')
        if (department !== undefined) updateData.department = String(department || '')
        if (phone !== undefined) updateData.phone = String(phone || '')
        if (email !== undefined) updateData.email = String(email || '')
        if (status !== undefined) updateData.status = String(status || 'active')
        if (hireDate !== undefined) updateData.hireDate = hireDate
        await upsertLocalDoc('employees', updateData, String(id))
        return res.json({
            success: true,
            data: {
                id: String(id),
                name: updateData?.name || '',
                position: updateData?.position || '',
                department: updateData?.department || '',
                phone: updateData?.phone || '',
                email: updateData?.email || '',
                status: updateData?.status || 'active',
                hireDate: updateData?.hireDate || null
            }
        })
    }

    const ok = await cloudbaseService.initialize().catch(() => false)
    if (!ok) {
        return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
    }

    const collection = cloudbaseService.getCollection('employees')
    const existing = await collection.doc(String(id)).get().catch(() => null)
    if (!existing?.data) {
        return res.status(404).json({ success: false, message: '员工不存在' })
    }

    const { name, position, department, phone, email, status, hireDate } = req.body || {}
    const now = new Date()
    const nowIso = now.toISOString()
    const nowMs = now.getTime()

    const updateData = {
        updatedAt: nowIso,
        _updateTime: nowMs
    }

    if (name !== undefined) updateData.name = String(name || '').trim()
    if (position !== undefined) updateData.position = String(position || '')
    if (department !== undefined) updateData.department = String(department || '')
    if (phone !== undefined) updateData.phone = String(phone || '')
    if (email !== undefined) updateData.email = String(email || '')
    if (status !== undefined) updateData.status = String(status || 'active')
    if (hireDate !== undefined) updateData.hireDate = hireDate

    await collection.doc(String(id)).update({ data: updateData })

    const updated = await collection.doc(String(id)).get()
    const doc = updated?.data || {}

    res.json({
        success: true,
        data: {
            id: doc?._id != null ? String(doc._id) : String(id),
            name: doc?.name || '',
            position: doc?.position || '',
            department: doc?.department || '',
            phone: doc?.phone || '',
            email: doc?.email || '',
            status: doc?.status || 'active',
            hireDate: doc?.hireDate || null
        }
    })
}))

// 删除员工
router.delete('/:id', authenticateToken, requireUser, asyncHandler(async (req, res) => {
    const id = req.params.id
    if (!id) {
        return res.status(400).json({
            success: false,
            message: '缺少员工ID'
        })
    }

    if (isOfflineMode()) {
        const doc = await getLocalDoc('employees', String(id)).catch(() => null)
        if (!doc) return res.status(404).json({ success: false, message: '员工不存在' })
        await removeLocalDoc('employees', String(id))
        return res.json({
            success: true,
            data: {
                id: doc?._id != null ? String(doc._id) : String(id),
                name: doc?.name || '',
                position: doc?.position || '',
                department: doc?.department || '',
                phone: doc?.phone || '',
                email: doc?.email || '',
                status: doc?.status || 'active'
            }
        })
    }

    const ok = await cloudbaseService.initialize().catch(() => false)
    if (!ok) {
        return res.status(503).json({ success: false, message: '云开发服务不可用，请检查网络或云端配置' })
    }

    const collection = cloudbaseService.getCollection('employees')
    const existing = await collection.doc(String(id)).get().catch(() => null)
    const doc = existing?.data

    if (!doc) {
        return res.status(404).json({ success: false, message: '员工不存在' })
    }

    await collection.doc(String(id)).remove()

    res.json({
        success: true,
        data: {
            id: doc?._id != null ? String(doc._id) : String(id),
            name: doc?.name || '',
            position: doc?.position || '',
            department: doc?.department || '',
            phone: doc?.phone || '',
            email: doc?.email || '',
            status: doc?.status || 'active'
        }
    })
}))

export default router
