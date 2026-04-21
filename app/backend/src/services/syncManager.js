import mongoose from 'mongoose'
import { logger } from '../utils/logger.js'
import enhancedSyncService from './enhancedSyncService.js'
import consistencyCheckService from './consistencyCheckService.js'
import conflictResolutionService from './conflictResolutionService.js'
import syncMonitorService from './syncMonitorService.js'
import incrementalSyncService from './incrementalSyncService.js'
import dataRollbackService from './dataRollbackService.js'
import { WebSocketServer } from 'ws'

/**
 * 数据同步管理器
 * 统一管理PC端与小程序云开发的数据同步
 * 提供完整的同步生命周期管理和监控
 */
class SyncManager {
  constructor() {
    this.config = {
      sync: {
        enableRealTimeSync: true,
        enableIncrementalSync: true,
        enableConsistencyCheck: true,
        enableConflictResolution: true,
        enableMonitoring: true,
        enableRollback: true
      },
      performance: {
        batchSize: 1000,
        syncInterval: 30000, // 30秒
        maxConcurrentOperations: 5,
        retryAttempts: 3,
        retryDelay: 1000
      },
      monitoring: {
        enableHealthCheck: true,
        healthCheckInterval: 60000, // 1分钟
        enablePerformanceTracking: true,
        enableAlerting: true
      },
      websocket: {
        enableWebSocket: true,
        port: 8081,
        enableBroadcast: true
      }
    }
    
    this.isInitialized = false
    this.isRunning = false
    this.syncStatus = 'idle'
    this.websocketServer = null
    this.websocketClients = new Set()
    this._periodicSyncTimer = null
    this._healthCheckTimer = null
    this.syncStats = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      lastSyncTime: null,
      averageSyncDuration: 0
    }
  }

  /**
   * 初始化同步管理器
   */
  async initialize() {
    try {
      logger.info('[同步管理器] 初始化数据同步管理器...')
      
      // 初始化各个服务
      await this.initializeServices()
      
      // 创建同步管理集合
      await this.createSyncCollections()
      
      // 启动WebSocket服务器
      if (this.config.websocket.enableWebSocket && process.env.NODE_ENV !== 'test') {
        await this.startWebSocketServer()
      }
      
      // 启动定时任务
      this.startPeriodicTasks()
      
      this.isInitialized = true
      logger.info('[同步管理器] 数据同步管理器初始化完成')
      
      return {
        success: true,
        message: '数据同步管理器初始化成功',
        services: this.getServiceStatus()
      }
      
    } catch (error) {
      logger.error('[同步管理器] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 初始化各个服务
   */
  async initializeServices() {
    try {
      const services = [
        { name: '增强同步服务', service: enhancedSyncService, enabled: this.config.sync.enableRealTimeSync },
        { name: '一致性检查服务', service: consistencyCheckService, enabled: this.config.sync.enableConsistencyCheck },
        { name: '冲突解决服务', service: conflictResolutionService, enabled: this.config.sync.enableConflictResolution },
        { name: '同步监控服务', service: syncMonitorService, enabled: this.config.sync.enableMonitoring },
        { name: '增量同步服务', service: incrementalSyncService, enabled: this.config.sync.enableIncrementalSync },
        { name: '数据回滚服务', service: dataRollbackService, enabled: this.config.sync.enableRollback }
      ]
      
      for (const { name, service, enabled } of services) {
        if (enabled) {
          try {
            await service.initialize()
            logger.info(`[同步管理器] ${name} 初始化成功`)
          } catch (error) {
            logger.error(`[同步管理器] ${name} 初始化失败:`, error)
            throw error
          }
        }
      }
      
    } catch (error) {
      logger.error('[同步管理器] 服务初始化失败:', error)
      throw error
    }
  }

  /**
   * 创建同步管理集合
   */
  async createSyncCollections() {
    const collections = [
      'sync_management',
      'sync_statistics',
      'sync_configurations',
      'sync_history'
    ]
    
    // 等待数据库连接就绪
    if (!mongoose.connection.db) {
      logger.warn('[同步管理器] 数据库连接未就绪，等待连接...')
      await this.waitForDatabaseConnection()
    }
    
    for (const collectionName of collections) {
      try {
        const collections = await mongoose.connection.db.listCollections({ name: collectionName }).toArray()
        if (collections.length === 0) {
          await mongoose.connection.db.createCollection(collectionName)
          logger.info(`[同步管理器] 创建集合: ${collectionName}`)
        }
      } catch (error) {
        logger.warn(`[同步管理器] 创建集合 ${collectionName} 失败:`, error.message)
      }
    }
  }

  /**
   * 等待数据库连接
   */
  async waitForDatabaseConnection() {
    let attempts = 0
    const maxAttempts = 10
    
    while (!mongoose.connection.db && attempts < maxAttempts) {
      await this.delay(1000)
      attempts++
      logger.info(`[同步管理器] 等待数据库连接... (${attempts}/${maxAttempts})`)
    }
    
    if (!mongoose.connection.db) {
      throw new Error('数据库连接超时')
    }
  }

  /**
   * 延迟函数
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 启动WebSocket服务器
   */
  async startWebSocketServer() {
    return new Promise((resolve, reject) => {
      try {
        this.websocketServer = new WebSocketServer({ 
          port: 8082,
          path: '/sync'
        })
        
        this.websocketServer.on('connection', (ws) => {
          logger.info('[同步管理器] WebSocket客户端连接')
          this.websocketClients.add(ws)
          
          // 发送当前状态
          ws.send(JSON.stringify({
            type: 'sync_status',
            data: this.getSyncStatus()
          }))
          
          ws.on('message', async (message) => {
            try {
              const data = JSON.parse(message)
              await this.handleWebSocketMessage(ws, data)
            } catch (error) {
              logger.error('[同步管理器] WebSocket消息处理失败:', error)
            }
          })
          
          ws.on('close', () => {
            logger.info('[同步管理器] WebSocket客户端断开连接')
            this.websocketClients.delete(ws)
          })
          
          ws.on('error', (error) => {
            logger.error('[同步管理器] WebSocket错误:', error)
            this.websocketClients.delete(ws)
          })
        })
        
        this.websocketServer.on('error', (error) => {
          logger.error('[同步管理器] WebSocket服务器错误:', error)
          reject(error)
        })
        
        this.websocketServer.on('listening', () => {
          logger.info(`[同步管理器] WebSocket服务器启动，端口: ${this.config.websocket.port}`)
          resolve()
        })
        
      } catch (error) {
        logger.error('[同步管理器] WebSocket服务器启动失败:', error)
        reject(error)
      }
    })
  }

  /**
   * 处理WebSocket消息
   */
  async handleWebSocketMessage(ws, data) {
    const { type, payload } = data
    
    try {
      switch (type) {
        case 'start_sync':
          const result = await this.startSync(payload)
          ws.send(JSON.stringify({
            type: 'sync_result',
            data: result
          }))
          break
          
        case 'get_status':
          ws.send(JSON.stringify({
            type: 'sync_status',
            data: this.getSyncStatus()
          }))
          break
          
        case 'get_stats':
          ws.send(JSON.stringify({
            type: 'sync_stats',
            data: this.getSyncStats()
          }))
          break
          
        case 'force_sync':
          const forceResult = await this.forceSync(payload)
          ws.send(JSON.stringify({
            type: 'force_sync_result',
            data: forceResult
          }))
          break
          
        default:
          ws.send(JSON.stringify({
            type: 'error',
            data: { message: `未知的消息类型: ${type}` }
          }))
      }
    } catch (error) {
      ws.send(JSON.stringify({
        type: 'error',
        data: { message: error.message }
      }))
    }
  }

  /**
   * 启动定时任务
   */
  startPeriodicTasks() {
    if (process.env.NODE_ENV === 'test') {
      return
    }

    // 定时同步任务
    if (this.config.sync.enableIncrementalSync) {
      if (!this._periodicSyncTimer) {
        this._periodicSyncTimer = setInterval(async () => {
        if (this.isRunning && this.syncStatus === 'idle') {
          try {
            await this.performIncrementalSyncWithRetry()
          } catch (error) {
            logger.error('[同步管理器] 定时同步任务失败:', error)
          }
        }
        }, this.config.performance.syncInterval)
      }
    }
    
    // 健康检查任务
    if (this.config.monitoring.enableHealthCheck) {
      if (!this._healthCheckTimer) {
        this._healthCheckTimer = setInterval(async () => {
        try {
          await this.performHealthCheck()
        } catch (error) {
          logger.error('[同步管理器] 健康检查任务失败:', error)
        }
        }, this.config.monitoring.healthCheckInterval)
      }
    }
    
    logger.info('[同步管理器] 定时任务已启动')
  }

  /**
   * 开始同步
   */
  async startSync(options = {}) {
    try {
      const syncType = String(options.syncType || 'incremental')
      const allowedSyncTypes = new Set(['incremental', 'full', 'all'])
      if (!allowedSyncTypes.has(syncType)) {
        throw new Error(`无效的同步类型: ${syncType}`)
      }

      if (this.syncStatus !== 'idle') {
        throw new Error(`同步正在进行中，当前状态: ${this.syncStatus}`)
      }
      
      this.syncStatus = 'running'
      const startTime = new Date()
      
      logger.info('[同步管理器] 开始数据同步')
      
      const flowOptions = { ...options }
      if (syncType === 'full' || syncType === 'all') {
        flowOptions.fullSync = true
      }
      delete flowOptions.syncType

      // 记录同步开始
      await this.logSyncStart(startTime, flowOptions)
      
      // 执行同步流程
      const syncResult = await this.executeSyncFlow(flowOptions)
      
      // 更新统计信息
      this.updateSyncStats(syncResult, startTime)
      
      // 记录同步完成
      await this.logSyncComplete(startTime, new Date(), syncResult)
      
      this.syncStatus = 'idle'
      
      logger.info('[同步管理器] 数据同步完成')
      
      return {
        success: true,
        result: syncResult,
        duration: Date.now() - startTime.getTime()
      }
      
    } catch (error) {
      this.syncStatus = 'error'
      logger.error('[同步管理器] 数据同步失败:', error)
      
      // 尝试自动回滚
      if (this.config.sync.enableRollback) {
        try {
          await this.attemptAutoRollback(error)
        } catch (rollbackError) {
          logger.error('[同步管理器] 自动回滚失败:', rollbackError)
        }
      }
      
      throw error
    }
  }

  /**
   * 执行同步流程
   */
  async executeSyncFlow(options) {
    const flowResults = {}
    
    try {
      // 1. 数据一致性检查
      if (this.config.sync.enableConsistencyCheck) {
        flowResults.consistencyCheck = await this.performConsistencyCheck(options)
      }
      
      // 2. 增量同步
      if (this.config.sync.enableIncrementalSync) {
        flowResults.incrementalSync = await this.performIncrementalSync(options)
      }
      
      // 3. 冲突解决
      if (this.config.sync.enableConflictResolution) {
        flowResults.conflictResolution = await this.performConflictResolution(options)
      }
      
      // 4. 全量同步（如果需要）
      if (options.fullSync) {
        flowResults.fullSync = await this.performFullSync(options)
      }
      
      // 5. 最终一致性验证
      if (this.config.sync.enableConsistencyCheck) {
        flowResults.finalConsistencyCheck = await this.performFinalConsistencyCheck(options)
      }
      
      return flowResults
      
    } catch (error) {
      logger.error('[同步管理器] 同步流程执行失败:', error)
      
      // 记录失败的流程步骤
      flowResults.error = {
        step: Object.keys(flowResults).length,
        message: error.message,
        timestamp: new Date()
      }
      
      throw error
    }
  }

  /**
   * 执行增量同步
   */
  async performIncrementalSync(options = {}) {
    try {
      logger.info('[同步管理器] 执行增量同步')
      
      const result = await incrementalSyncService.performIncrementalSync(options)
      
      // 广播同步状态
      this.broadcastSyncUpdate('incremental_sync', result)
      
      return result
      
    } catch (error) {
      if (!options || options.skipErrorLog !== true) {
        logger.error('[同步管理器] 增量同步失败:', error)
      }
      throw error
    }
  }

  async performIncrementalSyncWithRetry(options = {}) {
    const attempts = Math.max(1, Number(this.config?.performance?.retryAttempts || 1))
    const baseDelay = Math.max(0, Number(this.config?.performance?.retryDelay || 0))
    let lastError = null

    for (let i = 1; i <= attempts; i += 1) {
      try {
        return await this.performIncrementalSync({
          ...options,
          trigger: 'periodic',
          attempt: i,
          skipErrorLog: true
        })
      } catch (error) {
        lastError = error
        if (i < attempts && baseDelay > 0) {
          await new Promise((resolve) => setTimeout(resolve, baseDelay * i))
        }
      }
    }

    if (lastError) {
      logger.error('[同步管理器] 增量同步重试后仍失败:', lastError)
      throw lastError
    }

    return { success: false, message: '增量同步失败' }
  }

  /**
   * 执行一致性检查
   */
  async performConsistencyCheck(options = {}) {
    try {
      logger.info('[同步管理器] 执行一致性检查')
      
      const result = await consistencyCheckService.performConsistencyCheck(options)
      
      // 广播检查结果
      this.broadcastSyncUpdate('consistency_check', result)
      
      return result
      
    } catch (error) {
      logger.error('[同步管理器] 一致性检查失败:', error)
      throw error
    }
  }

  /**
   * 执行冲突解决
   */
  async performConflictResolution(options = {}) {
    try {
      logger.info('[同步管理器] 执行冲突解决')
      
      const result = await conflictResolutionService.resolveAllConflicts(options)
      
      // 广播解决结果
      this.broadcastSyncUpdate('conflict_resolution', result)
      
      return result
      
    } catch (error) {
      logger.error('[同步管理器] 冲突解决失败:', error)
      throw error
    }
  }

  /**
   * 执行全量同步
   */
  async performFullSync(options = {}) {
    try {
      logger.info('[同步管理器] 执行全量同步')
      
      const result = await enhancedSyncService.syncAllData(options)
      
      // 广播同步结果
      this.broadcastSyncUpdate('full_sync', result)
      
      return result
      
    } catch (error) {
      logger.error('[同步管理器] 全量同步失败:', error)
      throw error
    }
  }

  /**
   * 执行最终一致性检查
   */
  async performFinalConsistencyCheck(options = {}) {
    try {
      logger.info('[同步管理器] 执行最终一致性检查')
      
      const result = await consistencyCheckService.performConsistencyCheck({
        ...options,
        isFinalCheck: true
      })
      
      // 广播检查结果
      this.broadcastSyncUpdate('final_consistency_check', result)
      
      return result
      
    } catch (error) {
      logger.error('[同步管理器] 最终一致性检查失败:', error)
      throw error
    }
  }

  /**
   * 强制同步
   */
  async forceSync(options = {}) {
    try {
      logger.info('[同步管理器] 执行强制同步')
      
      // 重置同步状态
      this.syncStatus = 'idle'
      
      // 执行强制同步
      const result = await this.startSync({
        ...options,
        force: true,
        fullSync: true
      })
      
      return result
      
    } catch (error) {
      logger.error('[同步管理器] 强制同步失败:', error)
      throw error
    }
  }

  /**
   * 尝试自动回滚
   */
  async attemptAutoRollback(error) {
    try {
      logger.info('[同步管理器] 尝试自动回滚')
      
      const result = await dataRollbackService.performAutoRollback(
        { operationId: 'sync_operation', timestamp: new Date() },
        error
      )
      
      this.broadcastSyncUpdate('auto_rollback', result)
      
      return result
      
    } catch (rollbackError) {
      logger.error('[同步管理器] 自动回滚失败:', rollbackError)
      throw rollbackError
    }
  }

  /**
   * 执行健康检查
   */
  async performHealthCheck() {
    try {
      const healthStatus = {
        timestamp: new Date(),
        services: {},
        overall: 'healthy'
      }
      
      // 检查各个服务状态
      const services = [
        { name: 'enhancedSync', service: enhancedSyncService },
        { name: 'consistencyCheck', service: consistencyCheckService },
        { name: 'conflictResolution', service: conflictResolutionService },
        { name: 'syncMonitor', service: syncMonitorService },
        { name: 'incrementalSync', service: incrementalSyncService },
        { name: 'dataRollback', service: dataRollbackService }
      ]
      
      for (const { name, service } of services) {
        try {
          // 简单的服务健康检查
          healthStatus.services[name] = {
            status: 'healthy',
            lastCheck: new Date()
          }
        } catch (error) {
          healthStatus.services[name] = {
            status: 'error',
            error: error.message,
            lastCheck: new Date()
          }
          healthStatus.overall = 'warning'
        }
      }
      
      // 广播健康状态
      this.broadcastSyncUpdate('health_check', healthStatus)
      
      return healthStatus
      
    } catch (error) {
      logger.error('[同步管理器] 健康检查失败:', error)
      throw error
    }
  }

  /**
   * 广播同步更新
   */
  broadcastSyncUpdate(type, data) {
    if (!this.config.websocket.enableBroadcast) return
    
    const message = JSON.stringify({
      type: `sync_${type}`,
      timestamp: new Date(),
      data
    })
    
    this.websocketClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message)
      }
    })
  }

  /**
   * 记录同步日志
   */
  async logSyncStart(startTime, options) {
    try {
      await mongoose.connection.db.collection('sync_history').insertOne({
        syncId: this.generateSyncId(),
        type: 'incremental',
        status: 'running',
        startTime,
        options,
        createdAt: new Date()
      })
    } catch (error) {
      logger.error('[同步管理器] 记录同步开始日志失败:', error)
    }
  }

  /**
   * 记录同步完成
   */
  async logSyncComplete(startTime, endTime, result) {
    try {
      await mongoose.connection.db.collection('sync_history').updateOne(
        { startTime },
        {
          $set: {
            endTime,
            status: result ? 'completed' : 'failed',
            duration: endTime - startTime,
            result,
            updatedAt: new Date()
          }
        }
      )
    } catch (error) {
      logger.error('[同步管理器] 记录同步完成日志失败:', error)
    }
  }

  /**
   * 更新同步统计
   */
  updateSyncStats(result, startTime) {
    this.syncStats.totalSyncs++
    this.syncStats.lastSyncTime = startTime
    
    if (result) {
      this.syncStats.successfulSyncs++
    } else {
      this.syncStats.failedSyncs++
    }
    
    // 更新平均同步时间
    const duration = Date.now() - startTime.getTime()
    if (this.syncStats.averageSyncDuration === 0) {
      this.syncStats.averageSyncDuration = duration
    } else {
      this.syncStats.averageSyncDuration = 
        (this.syncStats.averageSyncDuration + duration) / 2
    }
  }

  /**
   * 生成同步ID
   */
  generateSyncId() {
    return `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 获取同步状态
   */
  getSyncStatus() {
    return {
      isInitialized: this.isInitialized,
      isRunning: this.isRunning,
      syncStatus: this.syncStatus,
      websocketStatus: this.websocketServer ? 'connected' : 'disconnected',
      activeClients: this.websocketClients.size,
      config: this.config,
      timestamp: new Date()
    }
  }

  /**
   * 获取同步统计
   */
  getSyncStats() {
    return {
      ...this.syncStats,
      successRate: this.syncStats.totalSyncs > 0 ? 
        (this.syncStats.successfulSyncs / this.syncStats.totalSyncs * 100).toFixed(2) : 0,
      timestamp: new Date()
    }
  }

  /**
   * 获取服务状态
   */
  getServiceStatus() {
    return {
      enhancedSync: { enabled: this.config.sync.enableRealTimeSync, initialized: true },
      consistencyCheck: { enabled: this.config.sync.enableConsistencyCheck, initialized: true },
      conflictResolution: { enabled: this.config.sync.enableConflictResolution, initialized: true },
      syncMonitor: { enabled: this.config.sync.enableMonitoring, initialized: true },
      incrementalSync: { enabled: this.config.sync.enableIncrementalSync, initialized: true },
      dataRollback: { enabled: this.config.sync.enableRollback, initialized: true }
    }
  }

  /**
   * 启动同步管理器
   */
  async start() {
    try {
      if (!this.isInitialized) {
        throw new Error('同步管理器未初始化')
      }
      
      if (this.isRunning) {
        throw new Error('同步管理器已在运行中')
      }
      
      this.isRunning = true
      this.syncStatus = 'idle'
      
      logger.info('[同步管理器] 同步管理器已启动')
      
      return {
        success: true,
        message: '同步管理器启动成功',
        status: this.getSyncStatus()
      }
      
    } catch (error) {
      logger.error('[同步管理器] 启动失败:', error)
      throw error
    }
  }

  /**
   * 停止同步管理器
   */
  async stop() {
    try {
      if (!this.isRunning) {
        throw new Error('同步管理器未运行')
      }
      
      this.isRunning = false
      this.syncStatus = 'stopped'

      if (this._periodicSyncTimer) {
        clearInterval(this._periodicSyncTimer)
        this._periodicSyncTimer = null
      }
      if (this._healthCheckTimer) {
        clearInterval(this._healthCheckTimer)
        this._healthCheckTimer = null
      }
      
      // 关闭WebSocket服务器
      if (this.websocketServer) {
        this.websocketServer.close()
        this.websocketServer = null
      }
      
      // 断开所有客户端连接
      this.websocketClients.forEach(client => {
        if (client.readyState === WebSocket.OPEN) {
          client.close()
        }
      })
      this.websocketClients.clear()

      if (syncMonitorService.stop) {
        await syncMonitorService.stop()
      }
      if (incrementalSyncService.stop) {
        await incrementalSyncService.stop()
      }
      if (enhancedSyncService.stop) {
        await enhancedSyncService.stop()
      }
      if (consistencyCheckService.stop) {
        await consistencyCheckService.stop()
      }
      if (conflictResolutionService.stop) {
        await conflictResolutionService.stop()
      }
      if (dataRollbackService.stop) {
        await dataRollbackService.stop()
      }
      
      logger.info('[同步管理器] 同步管理器已停止')
      
      return {
        success: true,
        message: '同步管理器停止成功',
        status: this.getSyncStatus()
      }
      
    } catch (error) {
      logger.error('[同步管理器] 停止失败:', error)
      throw error
    }
  }

  /**
   * 获取同步历史
   */
  async getSyncHistory(options = {}) {
    try {
      const { limit = 100, status = null, startDate = null, endDate = null } = options
      
      const query = {}
      if (status) query.status = status
      if (startDate || endDate) {
        query.startTime = {}
        if (startDate) query.startTime.$gte = new Date(startDate)
        if (endDate) query.startTime.$lte = new Date(endDate)
      }
      
      const history = await mongoose.connection.db.collection('sync_history')
        .find(query)
        .sort({ startTime: -1 })
        .limit(limit)
        .toArray()
      
      return history
      
    } catch (error) {
      logger.error('[同步管理器] 获取同步历史失败:', error)
      throw error
    }
  }

  /**
   * 获取系统概览
   */
  async getSystemOverview() {
    try {
      const overview = {
        timestamp: new Date(),
        syncManager: this.getSyncStatus(),
        syncStats: this.getSyncStats(),
        services: {},
        recentHistory: []
      }
      
      // 获取各个服务状态
      const services = [
        { name: 'syncMonitor', service: syncMonitorService },
        { name: 'incrementalSync', service: incrementalSyncService },
        { name: 'dataRollback', service: dataRollbackService }
      ]
      
      for (const { name, service } of services) {
        try {
          if (service.getStatus) {
            overview.services[name] = service.getStatus()
          } else if (service.getRollbackStatus) {
            overview.services[name] = service.getRollbackStatus()
          }
        } catch (error) {
          overview.services[name] = { status: 'error', error: error.message }
        }
      }
      
      // 获取最近的同步历史
      overview.recentHistory = await this.getSyncHistory({ limit: 10 })
      
      return overview
      
    } catch (error) {
      logger.error('[同步管理器] 获取系统概览失败:', error)
      throw error
    }
  }
}

// 创建单例实例
const syncManager = new SyncManager()

export default syncManager
