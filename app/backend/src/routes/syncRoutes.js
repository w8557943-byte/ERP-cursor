import express from 'express'
import syncController from '../controllers/syncController.js'
import { authMiddleware } from '../middleware/authMiddleware.js'
import { validateMiddleware } from '../middleware/validateMiddleware.js'

const router = express.Router()

/**
 * 数据同步相关路由
 * 提供PC端与小程序云开发数据同步的API接口
 */

// 基础同步管理
router.post('/initialize', authMiddleware, syncController.initializeSyncManager)
router.post('/start', authMiddleware, syncController.startSyncManager)
router.post('/stop', authMiddleware, syncController.stopSyncManager)
router.get('/status', authMiddleware, syncController.getSyncStatus)

// 同步操作
router.post('/sync/trigger', authMiddleware, syncController.triggerFullSync.bind(syncController))
router.post('/sync/start', authMiddleware, syncController.startSync)
router.post('/sync/force', authMiddleware, syncController.forceSync)
router.post('/sync/incremental', authMiddleware, syncController.performIncrementalSync)
router.post('/sync/consistency-check', authMiddleware, syncController.performConsistencyCheck)
router.post('/sync/conflict-resolution', authMiddleware, syncController.performConflictResolution)
router.post('/sync/health-check', authMiddleware, syncController.performHealthCheck)

// 同步历史与统计
router.get('/history', authMiddleware, syncController.getSyncHistory)
router.get('/overview', authMiddleware, syncController.getSystemOverview)

// 配置管理
router.get('/config', authMiddleware, syncController.getSyncConfig)
router.put('/config', authMiddleware, syncController.updateSyncConfig)
router.get('/field-mapping/:dataType', authMiddleware, syncController.getFieldMappingInfo)

// 工具与测试
router.post('/test-connection', authMiddleware, syncController.testSyncConnection)
router.post('/reset-status', authMiddleware, syncController.resetSyncStatus)

export default router