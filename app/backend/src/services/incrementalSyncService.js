import mongoose from 'mongoose'
import { logger } from '../utils/logger.js'
import { v4 as uuidv4 } from 'uuid'

/**
 * 增量同步服务
 * 实现高效的增量数据同步，只同步变更的数据
 * 支持双向同步、时间戳追踪、变更检测等功能
 */
class IncrementalSyncService {
  constructor() {
    this.syncConfig = {
      enableIncrementalSync: true,
      syncInterval: 30000, // 30秒
      maxBatchSize: 1000,
      changeTracking: {
        enableTimestampTracking: true,
        enableVersionTracking: true,
        enableChangeDetection: true
      },
      conflictResolution: {
        strategy: 'timestamp_wins', // timestamp_wins, version_wins, server_wins, client_wins
        maxRetries: 3,
        retryDelay: 1000
      },
      performance: {
        enableBatchProcessing: true,
        enableCompression: true,
        enableParallelProcessing: true,
        maxParallelThreads: 5
      }
    }
    
    this.changeTrackers = new Map() // 变更追踪器
    this.syncQueue = [] // 同步队列
    this.processingChanges = new Set() // 正在处理的变更
    this.lastSyncTimes = new Map() // 最后同步时间
    this._periodicSyncTimer = null
  }

  /**
   * 初始化增量同步服务
   */
  async initialize() {
    try {
      logger.info('[增量同步] 初始化增量同步服务...')
      
      // 创建变更追踪集合
      await this.createChangeTrackingCollections()
      
      // 初始化变更追踪器
      await this.initializeChangeTrackers()
      
      // 启动定时同步任务
      this.startPeriodicSync()
      
      logger.info('[增量同步] 增量同步服务初始化完成')
      return { success: true, message: '增量同步服务初始化成功' }
      
    } catch (error) {
      logger.error('[增量同步] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 创建变更追踪集合
   */
  async createChangeTrackingCollections() {
    const collections = [
      'change_tracking',
      'sync_watermarks',
      'incremental_sync_logs',
      'sync_conflicts',
      'change_history'
    ]
    
    for (const collectionName of collections) {
      try {
        const collections = await mongoose.connection.db.listCollections({ name: collectionName }).toArray()
        if (collections.length === 0) {
          await mongoose.connection.db.createCollection(collectionName)
          
          // 创建索引
          const collection = mongoose.connection.db.collection(collectionName)
          await this.createIndexes(collection, collectionName)
          
          logger.info(`[增量同步] 创建集合并建立索引: ${collectionName}`)
        }
      } catch (error) {
        logger.warn(`[增量同步] 创建集合 ${collectionName} 失败:`, error.message)
      }
    }
  }

  /**
   * 创建索引
   */
  async createIndexes(collection, collectionName) {
    const indexes = {
      change_tracking: [
        { key: { entityId: 1, entityType: 1 } },
        { key: { timestamp: -1 } },
        { key: { operation: 1 } },
        { key: { syncStatus: 1 } }
      ],
      sync_watermarks: [
        { key: { entityType: 1, syncDirection: 1 }, unique: true },
        { key: { lastSyncTime: -1 } }
      ],
      incremental_sync_logs: [
        { key: { syncId: 1 } },
        { key: { startTime: -1 } },
        { key: { status: 1 } }
      ],
      sync_conflicts: [
        { key: { entityId: 1, entityType: 1 } },
        { key: { timestamp: -1 } },
        { key: { status: 1 } }
      ],
      change_history: [
        { key: { entityId: 1, entityType: 1 } },
        { key: { timestamp: -1 } },
        { key: { version: -1 } }
      ]
    }
    
    const collectionIndexes = indexes[collectionName] || []
    for (const index of collectionIndexes) {
      try {
        await collection.createIndex(index.key, index)
      } catch (error) {
        logger.warn(`[增量同步] 创建索引失败:`, error.message)
      }
    }
  }

  /**
   * 初始化变更追踪器
   */
  async initializeChangeTrackers() {
    try {
      // 等待数据库连接就绪
      if (!mongoose.connection.db) {
        logger.warn('[增量同步] 数据库连接未就绪，等待连接...')
        await this.waitForDatabaseConnection()
      }
      
      // 为每个主要实体类型初始化变更追踪器
      const entityTypes = ['Order', 'Customer', 'Product', 'Inventory', 'User']
      
      for (const entityType of entityTypes) {
        const tracker = new ChangeTracker(entityType, this.syncConfig)
        await tracker.initialize()
        this.changeTrackers.set(entityType, tracker)
      }
      
      logger.info(`[增量同步] 初始化 ${entityTypes.length} 个变更追踪器`)
      
    } catch (error) {
      logger.error('[增量同步] 初始化变更追踪器失败:', error)
      throw error
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
      logger.info(`[增量同步] 等待数据库连接... (${attempts}/${maxAttempts})`)
    }
    
    if (!mongoose.connection.db) {
      throw new Error('数据库连接超时')
    }
  }

  /**
   * 启动定时同步任务
   */
  startPeriodicSync() {
    if (process.env.NODE_ENV === 'test') {
      return
    }
    if (this.syncConfig.enableIncrementalSync) {
      if (this._periodicSyncTimer) return
      this._periodicSyncTimer = setInterval(async () => {
        try {
          await this.performIncrementalSync()
        } catch (error) {
          logger.error('[增量同步] 定时同步任务失败:', error)
        }
      }, this.syncConfig.syncInterval)
      
      logger.info('[增量同步] 定时同步任务已启动')
    }
  }

  async stop() {
    if (this._periodicSyncTimer) {
      clearInterval(this._periodicSyncTimer)
      this._periodicSyncTimer = null
    }
    return { success: true }
  }

  /**
   * 执行增量同步
   */
  async performIncrementalSync(options = {}) {
    const syncId = uuidv4()
    const startTime = new Date()
    
    try {
      logger.info(`[增量同步] 开始执行增量同步: ${syncId}`)
      
      // 记录同步开始
      await this.logSyncStart(syncId, startTime, options)
      
      // 获取需要同步的实体类型
      const entityTypes = options.entityTypes || Array.from(this.changeTrackers.keys())
      
      // 并行处理不同实体类型的同步
      const syncResults = await Promise.allSettled(
        entityTypes.map(entityType => this.syncEntityType(entityType, syncId))
      )
      
      // 统计同步结果
      const syncStats = this.calculateSyncStats(syncResults)
      
      // 处理同步冲突
      if (syncStats.conflicts > 0) {
        await this.resolveSyncConflicts(syncId)
      }
      
      // 记录同步完成
      const endTime = new Date()
      await this.logSyncComplete(syncId, startTime, endTime, syncStats)
      
      const duration = endTime - startTime
      const result = {
        success: true,
        syncId,
        stats: syncStats,
        duration
      }
      
      // 避免在测试环境中输出日志
      if (process.env.NODE_ENV !== 'test') {
        logger.info(`[增量同步] 增量同步完成: ${syncId}, 成功: ${syncStats.successful}, 失败: ${syncStats.failed}, 冲突: ${syncStats.conflicts}`)
      }
      
      return result
      
    } catch (error) {
      if (process.env.NODE_ENV !== 'test') {
        logger.error(`[增量同步] 增量同步失败: ${syncId}`, error)
      }
      
      await this.logSyncError(syncId, startTime, error)
      
      return {
        success: false,
        syncId,
        error: error.message,
        duration: Date.now() - startTime.getTime()
      }
    }
  }

  /**
   * 同步特定实体类型
   */
  async syncEntityType(entityType, syncId) {
    const tracker = this.changeTrackers.get(entityType)
    if (!tracker) {
      throw new Error(`未找到实体类型 ${entityType} 的变更追踪器`)
    }
    
    try {
      // 获取变更
      const changes = await tracker.getChanges()
      
      if (changes.length === 0) {
        return {
          entityType,
          changes: 0,
          status: 'no_changes'
        }
      }
      
      logger.info(`[增量同步] 同步 ${entityType}: 发现 ${changes.length} 个变更`)
      
      // 批量处理变更
      const processedChanges = await this.processChanges(changes, entityType, syncId)
      
      // 标记变更已处理
      await tracker.markChangesProcessed(processedChanges)
      
      return {
        entityType,
        changes: changes.length,
        processed: processedChanges.length,
        status: 'success'
      }
      
    } catch (error) {
      logger.error(`[增量同步] 同步 ${entityType} 失败:`, error)
      
      return {
        entityType,
        changes: 0,
        status: 'failed',
        error: error.message
      }
    }
  }

  /**
   * 处理变更
   */
  async processChanges(changes, entityType, syncId) {
    const processedChanges = []
    
    // 按批次处理
    const batches = this.createBatches(changes, this.syncConfig.maxBatchSize)
    
    for (const batch of batches) {
      try {
        // 处理批次
        const batchResults = await this.processBatch(batch, entityType, syncId)
        processedChanges.push(...batchResults)
        
        // 记录批次处理结果
        await this.logBatchProcessing(syncId, entityType, batch.length, batchResults.length)
        
      } catch (error) {
        logger.error(`[增量同步] 处理批次失败:`, error)
        
        // 重试机制
        if (this.shouldRetry(error)) {
          await this.delay(this.syncConfig.conflictResolution.retryDelay)
          continue
        }
        
        throw error
      }
    }
    
    return processedChanges
  }

  /**
   * 创建批次
   */
  createBatches(items, batchSize) {
    const batches = []
    for (let i = 0; i < items.length; i += batchSize) {
      batches.push(items.slice(i, i + batchSize))
    }
    return batches
  }

  /**
   * 处理批次
   */
  async processBatch(batch, entityType, syncId) {
    const results = []
    
    for (const change of batch) {
      try {
        // 处理单个变更
        const result = await this.processSingleChange(change, entityType, syncId)
        results.push(result)
        
      } catch (error) {
        logger.error(`[增量同步] 处理变更失败:`, error)
        
        // 记录冲突
        if (this.isConflictError(error)) {
          await this.recordConflict(change, error, syncId)
        }
        
        // 根据错误类型决定是否继续
        if (this.shouldStopProcessing(error)) {
          throw error
        }
      }
    }
    
    return results
  }

  /**
   * 处理单个变更
   */
  async processSingleChange(change, entityType, syncId) {
    const { operation, entityId, data, timestamp, version } = change
    
    try {
      switch (operation) {
        case 'create':
          return await this.processCreate(entityId, data, entityType, timestamp, version, syncId)
          
        case 'update':
          return await this.processUpdate(entityId, data, entityType, timestamp, version, syncId)
          
        case 'delete':
          return await this.processDelete(entityId, entityType, timestamp, version, syncId)
          
        default:
          throw new Error(`不支持的操作类型: ${operation}`)
      }
      
    } catch (error) {
      logger.error(`[增量同步] 处理变更失败: ${operation} ${entityType} ${entityId}`, error)
      throw error
    }
  }

  /**
   * 处理创建操作
   */
  async processCreate(entityId, data, entityType, timestamp, version, syncId) {
    try {
      // 检查是否已存在
      const existing = await this.getEntityById(entityId, entityType)
      if (existing) {
        // 已存在，转换为更新操作
        return await this.processUpdate(entityId, data, entityType, timestamp, version, syncId)
      }
      
      // 创建实体
      const created = await this.createEntity(entityId, data, entityType, timestamp, version)
      
      // 记录变更历史
      await this.recordChangeHistory('create', entityId, data, entityType, timestamp, version, syncId)
      
      return {
        operation: 'create',
        entityId,
        entityType,
        status: 'success',
        timestamp
      }
      
    } catch (error) {
      logger.error(`[增量同步] 创建实体失败: ${entityType} ${entityId}`, error)
      throw error
    }
  }

  /**
   * 处理更新操作
   */
  async processUpdate(entityId, data, entityType, timestamp, version, syncId) {
    try {
      // 获取当前实体
      const current = await this.getEntityById(entityId, entityType)
      if (!current) {
        // 不存在，转换为创建操作
        return await this.processCreate(entityId, data, entityType, timestamp, version, syncId)
      }
      
      // 检查冲突
      const conflict = await this.detectConflict(current, data, timestamp, version)
      if (conflict) {
        // 解决冲突
        const resolvedData = await this.resolveConflict(current, data, conflict, entityType)
        data = resolvedData
      }
      
      // 更新实体
      const updated = await this.updateEntity(entityId, data, entityType, timestamp, version)
      
      // 记录变更历史
      await this.recordChangeHistory('update', entityId, data, entityType, timestamp, version, syncId)
      
      return {
        operation: 'update',
        entityId,
        entityType,
        status: 'success',
        timestamp,
        conflict: conflict ? 'resolved' : 'none'
      }
      
    } catch (error) {
      logger.error(`[增量同步] 更新实体失败: ${entityType} ${entityId}`, error)
      throw error
    }
  }

  /**
   * 处理删除操作
   */
  async processDelete(entityId, entityType, timestamp, version, syncId) {
    try {
      // 检查是否存在
      const existing = await this.getEntityById(entityId, entityType)
      if (!existing) {
        // 不存在，跳过
        return {
          operation: 'delete',
          entityId,
          entityType,
          status: 'skipped',
          reason: 'entity_not_found',
          timestamp
        }
      }
      
      // 删除实体
      await this.deleteEntity(entityId, entityType, timestamp, version)
      
      // 记录变更历史
      await this.recordChangeHistory('delete', entityId, null, entityType, timestamp, version, syncId)
      
      return {
        operation: 'delete',
        entityId,
        entityType,
        status: 'success',
        timestamp
      }
      
    } catch (error) {
      logger.error(`[增量同步] 删除实体失败: ${entityType} ${entityId}`, error)
      throw error
    }
  }

  /**
   * 冲突检测
   */
  async detectConflict(current, newData, timestamp, version) {
    try {
      // 基于时间戳的冲突检测
      if (current.updatedAt && timestamp < current.updatedAt) {
        return {
          type: 'timestamp_conflict',
          currentTimestamp: current.updatedAt,
          newTimestamp: timestamp,
          currentVersion: current.version,
          newVersion: version
        }
      }
      
      // 基于版本的冲突检测
      if (current.version && version && version <= current.version) {
        return {
          type: 'version_conflict',
          currentVersion: current.version,
          newVersion: version,
          currentTimestamp: current.updatedAt,
          newTimestamp: timestamp
        }
      }
      
      return null // 无冲突
      
    } catch (error) {
      logger.error('[增量同步] 冲突检测失败:', error)
      return null
    }
  }

  /**
   * 冲突解决
   */
  async resolveConflict(current, newData, conflict, entityType) {
    try {
      const strategy = this.syncConfig.conflictResolution.strategy
      
      switch (strategy) {
        case 'timestamp_wins':
          // 时间戳最新的获胜
          return conflict.newTimestamp > conflict.currentTimestamp ? newData : current
          
        case 'version_wins':
          // 版本号最新的获胜
          return conflict.newVersion > conflict.currentVersion ? newData : current
          
        case 'server_wins':
          // 服务器端获胜
          return current
          
        case 'client_wins':
          // 客户端获胜
          return newData
          
        case 'merge':
          // 合并数据
          return this.mergeData(current, newData, entityType)
          
        default:
          // 默认策略：时间戳获胜
          return conflict.newTimestamp > conflict.currentTimestamp ? newData : current
      }
      
    } catch (error) {
      logger.error('[增量同步] 冲突解决失败:', error)
      throw error
    }
  }

  /**
   * 合并数据
   */
  mergeData(current, newData, entityType) {
    try {
      // 简单的合并策略：新数据覆盖旧数据
      // 实际实现中可以更复杂的合并逻辑
      return { ...current, ...newData }
      
    } catch (error) {
      logger.error('[增量同步] 数据合并失败:', error)
      throw error
    }
  }

  /**
   * 记录同步开始
   */
  async logSyncStart(syncId, startTime, options) {
    try {
      await mongoose.connection.db.collection('incremental_sync_logs').insertOne({
        syncId,
        startTime,
        status: 'running',
        options,
        createdAt: new Date()
      })
    } catch (error) {
      logger.error('[增量同步] 记录同步开始失败:', error)
    }
  }

  /**
   * 记录同步完成
   */
  async logSyncComplete(syncId, startTime, endTime, stats) {
    try {
      await mongoose.connection.db.collection('incremental_sync_logs').updateOne(
        { syncId },
        {
          $set: {
            endTime,
            status: 'completed',
            duration: endTime - startTime,
            stats,
            updatedAt: new Date()
          }
        }
      )
    } catch (error) {
      logger.error('[增量同步] 记录同步完成失败:', error)
    }
  }

  /**
   * 记录同步错误
   */
  async logSyncError(syncId, startTime, error) {
    try {
      await mongoose.connection.db.collection('incremental_sync_logs').updateOne(
        { syncId },
        {
          $set: {
            endTime: new Date(),
            status: 'failed',
            duration: Date.now() - startTime.getTime(),
            error: {
              message: error.message,
              stack: error.stack
            },
            updatedAt: new Date()
          }
        }
      )
    } catch (logError) {
      logger.error('[增量同步] 记录同步错误失败:', logError)
    }
  }

  /**
   * 记录批次处理
   */
  async logBatchProcessing(syncId, entityType, batchSize, processedCount) {
    try {
      await mongoose.connection.db.collection('incremental_sync_logs').updateOne(
        { syncId },
        {
          $push: {
            batchLogs: {
              entityType,
              batchSize,
              processedCount,
              timestamp: new Date()
            }
          }
        }
      )
    } catch (error) {
      logger.error('[增量同步] 记录批次处理失败:', error)
    }
  }

  /**
   * 记录变更历史
   */
  async recordChangeHistory(operation, entityId, data, entityType, timestamp, version, syncId) {
    try {
      await mongoose.connection.db.collection('change_history').insertOne({
        operation,
        entityId,
        entityType,
        data,
        timestamp,
        version,
        syncId,
        createdAt: new Date()
      })
    } catch (error) {
      logger.error('[增量同步] 记录变更历史失败:', error)
    }
  }

  /**
   * 记录冲突
   */
  async recordConflict(change, error, syncId) {
    try {
      await mongoose.connection.db.collection('sync_conflicts').insertOne({
        change,
        error: error.message,
        syncId,
        timestamp: new Date(),
        status: 'unresolved'
      })
    } catch (error) {
      logger.error('[增量同步] 记录冲突失败:', error)
    }
  }

  /**
   * 计算同步统计
   */
  calculateSyncStats(syncResults) {
    const stats = {
      total: 0,
      successful: 0,
      failed: 0,
      conflicts: 0,
      noChanges: 0
    }
    
    for (const result of syncResults) {
      if (result.status === 'fulfilled') {
        const data = result.value
        stats.total += data.changes || 0
        
        if (data.status === 'success') {
          stats.successful++
        } else if (data.status === 'failed') {
          stats.failed++
        } else if (data.status === 'no_changes') {
          stats.noChanges++
        }
        
        if (data.conflict === 'resolved') {
          stats.conflicts++
        }
      } else {
        stats.failed++
      }
    }
    
    return stats
  }

  /**
   * 解决同步冲突
   */
  async resolveSyncConflicts(syncId) {
    try {
      const conflicts = await mongoose.connection.db.collection('sync_conflicts')
        .find({ syncId, status: 'unresolved' })
        .toArray()
      
      for (const conflict of conflicts) {
        try {
          // 解决冲突
          await this.resolveIndividualConflict(conflict)
          
          // 标记冲突已解决
          await mongoose.connection.db.collection('sync_conflicts').updateOne(
            { _id: conflict._id },
            { $set: { status: 'resolved', resolvedAt: new Date() } }
          )
          
        } catch (error) {
          logger.error('[增量同步] 解决冲突失败:', error)
        }
      }
      
    } catch (error) {
      logger.error('[增量同步] 解决同步冲突失败:', error)
    }
  }

  /**
   * 解决单个冲突
   */
  async resolveIndividualConflict(conflict) {
    // 实际冲突解决逻辑
    logger.info(`[增量同步] 解决冲突: ${conflict._id}`)
  }

  /**
   * 辅助方法
   */
  shouldRetry(error) {
    return this.syncConfig.conflictResolution.maxRetries > 0
  }

  shouldStopProcessing(error) {
    // 致命错误停止处理
    return error.message.includes('致命错误')
  }

  isConflictError(error) {
    return error.message.includes('冲突')
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  /**
   * 获取实体
   */
  async getEntityById(entityId, entityType) {
    // 这里需要根据实际的实体类型调用相应的模型
    // 简化实现，实际需要根据entityType选择正确的模型
    return null
  }

  /**
   * 创建实体
   */
  async createEntity(entityId, data, entityType, timestamp, version) {
    // 这里需要根据实际的实体类型调用相应的模型
    // 简化实现，实际需要根据entityType选择正确的模型
    return data
  }

  /**
   * 更新实体
   */
  async updateEntity(entityId, data, entityType, timestamp, version) {
    // 这里需要根据实际的实体类型调用相应的模型
    // 简化实现，实际需要根据entityType选择正确的模型
    return data
  }

  /**
   * 删除实体
   */
  async deleteEntity(entityId, entityType, timestamp, version) {
    // 这里需要根据实际的实体类型调用相应的模型
    // 简化实现，实际需要根据entityType选择正确的模型
    return true
  }
}

/**
 * 变更追踪器
 */
class ChangeTracker {
  constructor(entityType, config) {
    this.entityType = entityType
    this.config = config
    this.lastSyncTime = null
  }

  /**
   * 初始化变更追踪器
   */
  async initialize() {
    try {
      // 获取最后同步时间
      const watermark = await mongoose.connection.db.collection('sync_watermarks').findOne({
        entityType: this.entityType,
        syncDirection: 'bidirectional'
      })
      
      this.lastSyncTime = watermark ? watermark.lastSyncTime : new Date(0)
      
      logger.info(`[增量同步] 初始化变更追踪器: ${this.entityType}, 最后同步时间: ${this.lastSyncTime}`)
      
    } catch (error) {
      logger.error(`[增量同步] 初始化变更追踪器失败: ${this.entityType}`, error)
      throw error
    }
  }

  /**
   * 获取变更
   */
  async getChanges() {
    try {
      const changes = await mongoose.connection.db.collection('change_tracking').find({
        entityType: this.entityType,
        timestamp: { $gt: this.lastSyncTime },
        syncStatus: 'pending'
      }).sort({ timestamp: 1 }).limit(this.config.maxBatchSize).toArray()
      
      return changes
      
    } catch (error) {
      logger.error(`[增量同步] 获取变更失败: ${this.entityType}`, error)
      throw error
    }
  }

  /**
   * 标记变更已处理
   */
  async markChangesProcessed(changes) {
    try {
      const changeIds = changes.map(change => change._id)
      
      await mongoose.connection.db.collection('change_tracking').updateMany(
        { _id: { $in: changeIds } },
        { $set: { syncStatus: 'processed', processedAt: new Date() } }
      )
      
      // 更新最后同步时间
      if (changes.length > 0) {
        const latestTimestamp = Math.max(...changes.map(c => c.timestamp.getTime()))
        this.lastSyncTime = new Date(latestTimestamp)
        
        await mongoose.connection.db.collection('sync_watermarks').updateOne(
          { entityType: this.entityType, syncDirection: 'bidirectional' },
          { 
            $set: { 
              lastSyncTime: this.lastSyncTime,
              updatedAt: new Date()
            }
          },
          { upsert: true }
        )
      }
      
    } catch (error) {
      logger.error(`[增量同步] 标记变更已处理失败: ${this.entityType}`, error)
      throw error
    }
  }
}

// 创建单例实例
const incrementalSyncService = new IncrementalSyncService()

export default incrementalSyncService
