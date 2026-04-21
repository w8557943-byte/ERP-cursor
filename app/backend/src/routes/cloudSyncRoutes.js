import express from 'express'
import cloudSyncService from '../services/cloudSyncService.js'
import { logger } from '../utils/logger.js'

const router = express.Router()

/**
 * 云同步API路由
 * 处理PC端与小程序云开发数据库的同步操作
 */

/**
 * 执行全量同步到云开发
 * POST /api/cloud/sync/full
 */
router.post('/sync/full', async (req, res) => {
  try {
    logger.info('[云同步API] 收到全量同步请求', { user: req.user?.id })
    
    const result = await cloudSyncService.performFullSyncToCloudbase(req.body)
    
    if (result.success) {
      logger.info('[云同步API] 全量同步成功', { 
        summary: result.summary,
        timestamp: result.timestamp 
      })
      
      res.json({
        code: 200,
        message: '全量同步成功',
        data: result
      })
    } else {
      logger.warn('[云同步API] 全量同步失败', { message: result.message })
      res.json({
        code: 400,
        message: result.message || '全量同步失败',
        data: result
      })
    }
  } catch (error) {
    logger.error('[云同步API] 全量同步异常', error)
    res.status(500).json({
      code: 500,
      message: '全量同步失败',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

/**
 * 执行增量同步到云开发
 * POST /api/cloud/sync/incremental
 */
router.post('/sync/incremental', async (req, res) => {
  try {
    logger.info('[云同步API] 收到增量同步请求', { user: req.user?.id })
    
    const result = await cloudSyncService.performIncrementalSyncToCloudbase(req.body)
    
    if (result.success) {
      logger.info('[云同步API] 增量同步成功', { 
        summary: result.summary,
        timestamp: result.timestamp 
      })
      
      res.json({
        code: 200,
        message: '增量同步成功',
        data: result
      })
    } else {
      logger.warn('[云同步API] 增量同步失败', { message: result.message })
      res.json({
        code: 400,
        message: result.message || '增量同步失败',
        data: result
      })
    }
  } catch (error) {
    logger.error('[云同步API] 增量同步异常', error)
    res.status(500).json({
      code: 500,
      message: '增量同步失败',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

/**
 * 从云开发同步到PC端
 * POST /api/cloud/sync/from-cloudbase
 */
router.post('/sync/from-cloudbase', async (req, res) => {
  try {
    logger.info('[云同步API] 收到从云开发同步请求', { user: req.user?.id })
    
    const result = await cloudSyncService.syncFromCloudbase(req.body)
    
    if (result.success) {
      logger.info('[云同步API] 从云开发同步成功', { 
        results: result.results,
        timestamp: result.timestamp 
      })
      
      res.json({
        code: 200,
        message: '从云开发同步成功',
        data: result
      })
    } else {
      logger.warn('[云同步API] 从云开发同步失败', { message: result.message })
      res.json({
        code: 400,
        message: result.message || '从云开发同步失败',
        data: result
      })
    }
  } catch (error) {
    logger.error('[云同步API] 从云开发同步异常', error)
    res.status(500).json({
      code: 500,
      message: '从云开发同步失败',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

/**
 * 获取同步状态
 * GET /api/cloud/sync/status
 */
router.get('/sync/status', async (req, res) => {
  try {
    const status = await cloudSyncService.getSyncStatus()
    
    res.json({
      code: 200,
      message: '获取同步状态成功',
      data: status
    })
  } catch (error) {
    logger.error('[云同步API] 获取同步状态失败', error)
    res.status(500).json({
      code: 500,
      message: '获取同步状态失败',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

/**
 * 健康检查
 * GET /api/cloud/health
 */
router.get('/health', async (req, res) => {
  try {
    const health = await cloudSyncService.healthCheck()
    
    res.json({
      code: 200,
      message: '云同步服务健康',
      data: health
    })
  } catch (error) {
    logger.error('[云同步API] 健康检查失败', error)
    res.status(500).json({
      code: 500,
      message: '云同步服务异常',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

/**
 * 同步配置管理
 * GET /api/cloud/config
 */
router.get('/config', async (req, res) => {
  try {
    const config = {
      cloudEnvId: process.env.WECHAT_CLOUD_ENV_ID,
      appId: process.env.MINIPROGRAM_APP_ID,
      enableSync: process.env.ENABLE_SYNC === 'true',
      syncInterval: parseInt(process.env.SYNC_INTERVAL) || 30000,
      lastSyncTime: await cloudSyncService.getSyncStatus().then(status => status.lastSyncTime)
    }
    
    res.json({
      code: 200,
      message: '获取同步配置成功',
      data: config
    })
  } catch (error) {
    logger.error('[云同步API] 获取同步配置失败', error)
    res.status(500).json({
      code: 500,
      message: '获取同步配置失败',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    })
  }
})

export default router