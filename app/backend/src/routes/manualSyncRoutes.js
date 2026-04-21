/**
 * 手动同步路由
 * 实现用户手动触发的本地到云端同步功能
 */

import express from 'express'
import { asyncHandler } from '../middleware/errorHandler.js'
import cloudSyncService from '../services/cloudSyncService.js'
import cloudbaseService from '../services/cloudbaseService.js'
import { logger } from '../utils/logger.js'

const router = express.Router()

/**
 * 执行手动同步到云服务器
 * 用户点击"同步数据"按钮时触发
 */
router.post('/sync-to-cloud', asyncHandler(async (req, res) => {
  try {
    logger.info('[手动同步] 用户触发手动同步到云端')

    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const syncType = String(body.mode || 'incremental').trim().toLowerCase()

    // 验证同步类型
    if (!['incremental', 'full', 'force'].includes(syncType)) {
      return res.status(400).json({
        success: false,
        message: '无效的同步类型，可选值：incremental, full, force'
      })
    }

    // 检查云同步服务是否可用
    const cloudAvailable = await cloudSyncService.healthCheck()
    if (!cloudAvailable.healthy) {
      return res.status(503).json({
        success: false,
        message: '云同步服务不可用，请检查配置'
      })
    }

    // 执行同步
    let result
    const startTime = Date.now()

    if (syncType === 'incremental') {
      result = await cloudSyncService.performIncrementalSyncToCloudbase()
    } else if (syncType === 'full') {
      result = await cloudSyncService.performFullSyncToCloudbase()
    } else {
      // 强制同步 = 全量同步
      result = await cloudSyncService.performFullSyncToCloudbase()
    }

    const duration = Date.now() - startTime

    logger.info(`[手动同步] 同步完成，耗时: ${duration}ms`)

    if (!result || result.success === false) {
      const msg = String(result?.message || '同步失败')
      return res.status(msg.includes('进行中') ? 409 : 500).json({
        success: false,
        message: msg,
        error: result?.error || msg
      })
    }

    return res.json({
      success: true,
      data: {
        type: syncType,
        duration,
        timestamp: new Date(),
        summary: result.summary,
        results: result.results
      }
    })
  } catch (error) {
    logger.error('[手动同步] 同步失败', error)
    return res.status(500).json({
      success: false,
      message: error.message || '同步失败',
      error: error.message
    })
  }
}))

/**
 * 从云端全量拉取到本地数据库
 * 支持 wipe 覆盖与按集合拉取
 */
router.post('/sync-from-cloud', asyncHandler(async (req, res) => {
  try {
    logger.info('[手动同步] 用户触发从云端下载到本地')

    const body = req.body && typeof req.body === 'object' ? req.body : {}
    const wipe = Boolean(body.wipe)
    const collections = Array.isArray(body.collections)
      ? body.collections.map((x) => String(x || '').trim()).filter(Boolean)
      : []
    const maxRecordsPerCollection = Math.max(1, Number(body.maxRecordsPerCollection || 20000))

    const cloudAvailable = await cloudSyncService.healthCheck()
    if (!cloudAvailable.healthy) {
      return res.status(503).json({
        success: false,
        message: '云同步服务不可用，请检查配置'
      })
    }

    const startedAt = Date.now()
    const result = await cloudSyncService.syncFromCloudbase({
      wipe,
      collections,
      maxRecordsPerCollection
    })
    const duration = Date.now() - startedAt

    if (!result || result.success === false) {
      const msg = String(result?.message || '云端下载失败')
      return res.status(msg.includes('进行中') ? 409 : 500).json({
        success: false,
        message: msg,
        error: result?.error || msg
      })
    }

    return res.json({
      success: true,
      data: {
        duration,
        wipe,
        collections,
        timestamp: new Date(),
        summary: result.summary,
        results: result.results
      }
    })
  } catch (error) {
    logger.error('[手动同步] 云端下载到本地失败', error)
    return res.status(500).json({
      success: false,
      message: error.message || '云端下载失败',
      error: error.message
    })
  }
}))

const buildStatusPayload = async () => {
  const health = await cloudSyncService.healthCheck()
  const cloudConfig = cloudbaseService.getCloudConfigStatus()
  return {
    cloud: {
      healthy: Boolean(health?.healthy),
      message: health?.healthy ? '云同步服务正常' : String(health?.message || health?.error || '云同步服务不可用')
    },
    cloudConfig,
    sync: {
      inProgress: Boolean(cloudSyncService.syncInProgress),
      lastSyncTime: cloudSyncService.lastSyncTime || null,
      lastPullTime: cloudSyncService.lastPullTime || null
    },
    timestamp: new Date()
  }
}

/**
 * 获取同步历史记录
 */
router.get('/sync-history', asyncHandler(async (_req, res) => {
  try {
    const status = await buildStatusPayload()

    return res.json({
      success: true,
      data: {
        lastSyncTime: status.sync.lastSyncTime,
        lastPullTime: status.sync.lastPullTime,
        syncInProgress: status.sync.inProgress,
        cloudAvailable: status.cloud.healthy
      }
    })
  } catch (error) {
    logger.error('[手动同步] 获取同步历史失败', error)
    return res.status(500).json({
      success: false,
      message: error.message || '获取失败'
    })
  }
}))

/**
 * 检查云同步服务状态
 */
router.get('/status', asyncHandler(async (_req, res) => {
  try {
    const data = await buildStatusPayload()

    return res.json({
      success: true,
      data
    })
  } catch (error) {
    logger.error('[手动同步] 获取状态失败', error)
    return res.status(500).json({
      success: false,
      message: error.message || '获取状态失败'
    })
  }
}))

export default router
