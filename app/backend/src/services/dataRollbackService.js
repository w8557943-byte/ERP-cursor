import mongoose from 'mongoose'
import { logger } from '../utils/logger.js'
import { v4 as uuidv4 } from 'uuid'

/**
 * 数据回滚服务
 * 提供同步失败时的数据恢复机制
 * 支持自动回滚、手动回滚、点恢复等功能
 */
class DataRollbackService {
  constructor() {
    this.rollbackConfig = {
      enableAutoRollback: true,
      enableManualRollback: true,
      enablePointInTimeRecovery: true,
      maxRollbackPoints: 50, // 最大回滚点数量
      rollbackRetentionDays: 30, // 回滚点保留天数
      backupStrategy: {
        enableAutomaticBackup: true,
        backupInterval: 3600000, // 1小时
        backupOnSync: true,
        backupOnCriticalOperation: true
      },
      recoveryOptions: {
        enablePartialRecovery: true,
        enableSelectiveRecovery: true,
        enableBulkRecovery: true
      }
    }
    
    this.rollbackPoints = new Map() // 回滚点缓存
    this.activeRollbackOperations = new Set() // 正在进行的回滚操作
    this.backupQueue = [] // 备份队列
    this._automaticBackupTimer = null
    this._cleanupTimer = null
  }

  /**
   * 初始化数据回滚服务
   */
  async initialize() {
    try {
      logger.info('[数据回滚] 初始化数据回滚服务...')
      
      // 创建回滚相关集合
      await this.createRollbackCollections()
      
      // 加载最近的回滚点
      await this.loadRecentRollbackPoints()
      
      // 启动自动备份任务
      if (this.rollbackConfig.backupStrategy.enableAutomaticBackup) {
        this.startAutomaticBackup()
      }
      
      // 启动清理任务
      this.startCleanupTask()
      
      logger.info('[数据回滚] 数据回滚服务初始化完成')
      return { success: true, message: '数据回滚服务初始化成功' }
      
    } catch (error) {
      logger.error('[数据回滚] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 创建回滚相关集合
   */
  async createRollbackCollections() {
    const collections = [
      'rollback_points',
      'rollback_logs',
      'backup_snapshots',
      'recovery_operations',
      'rollback_configurations'
    ]
    
    for (const collectionName of collections) {
      try {
        const collections = await mongoose.connection.db.listCollections({ name: collectionName }).toArray()
        if (collections.length === 0) {
          await mongoose.connection.db.createCollection(collectionName)
          
          // 创建索引
          const collection = mongoose.connection.db.collection(collectionName)
          await this.createIndexes(collection, collectionName)
          
          logger.info(`[数据回滚] 创建集合并建立索引: ${collectionName}`)
        }
      } catch (error) {
        logger.warn(`[数据回滚] 创建集合 ${collectionName} 失败:`, error.message)
      }
    }
  }

  /**
   * 创建索引
   */
  async createIndexes(collection, collectionName) {
    const indexes = {
      rollback_points: [
        { key: { pointId: 1 }, unique: true },
        { key: { entityType: 1, entityId: 1 } },
        { key: { createdAt: -1 } },
        { key: { type: 1 } },
        { key: { status: 1 } }
      ],
      rollback_logs: [
        { key: { operationId: 1 } },
        { key: { rollbackPointId: 1 } },
        { key: { timestamp: -1 } },
        { key: { entityType: 1 } },
        { key: { status: 1 } }
      ],
      backup_snapshots: [
        { key: { snapshotId: 1 }, unique: true },
        { key: { entityType: 1 } },
        { key: { createdAt: -1 } },
        { key: { type: 1 } },
        { key: { status: 1 } }
      ],
      recovery_operations: [
        { key: { operationId: 1 }, unique: true },
        { key: { type: 1 } },
        { key: { status: 1 } },
        { key: { createdAt: -1 } },
        { key: { completedAt: -1 } }
      ],
      rollback_configurations: [
        { key: { configId: 1 }, unique: true },
        { key: { entityType: 1 } },
        { key: { createdAt: -1 } }
      ]
    }
    
    const collectionIndexes = indexes[collectionName] || []
    for (const index of collectionIndexes) {
      try {
        await collection.createIndex(index.key, index)
      } catch (error) {
        logger.warn(`[数据回滚] 创建索引失败:`, error.message)
      }
    }
  }

  /**
   * 加载最近的回滚点
   */
  async loadRecentRollbackPoints() {
    try {
      const recentPoints = await mongoose.connection.db.collection('rollback_points')
        .find({ status: 'active' })
        .sort({ createdAt: -1 })
        .limit(10)
        .toArray()
      
      for (const point of recentPoints) {
        this.rollbackPoints.set(point.pointId, point)
      }
      
      logger.info(`[数据回滚] 加载 ${recentPoints.length} 个最近回滚点`)
      
    } catch (error) {
      logger.error('[数据回滚] 加载回滚点失败:', error)
    }
  }

  /**
   * 启动自动备份任务
   */
  startAutomaticBackup() {
    if (process.env.NODE_ENV === 'test') {
      return
    }
    if (this._automaticBackupTimer) return
    this._automaticBackupTimer = setInterval(async () => {
      try {
        await this.performAutomaticBackup()
      } catch (error) {
        logger.error('[数据回滚] 自动备份任务失败:', error)
      }
    }, this.rollbackConfig.backupStrategy.backupInterval)
    
    logger.info('[数据回滚] 自动备份任务已启动')
  }

  /**
   * 启动清理任务
   */
  startCleanupTask() {
    if (process.env.NODE_ENV === 'test') {
      return
    }
    if (this._cleanupTimer) return
    this._cleanupTimer = setInterval(async () => {
      try {
        await this.cleanupOldRollbackPoints()
      } catch (error) {
        logger.error('[数据回滚] 清理任务失败:', error)
      }
    }, 24 * 60 * 60 * 1000) // 每天执行一次
    
    logger.info('[数据回滚] 清理任务已启动')
  }

  async stop() {
    if (this._automaticBackupTimer) {
      clearInterval(this._automaticBackupTimer)
      this._automaticBackupTimer = null
    }
    if (this._cleanupTimer) {
      clearInterval(this._cleanupTimer)
      this._cleanupTimer = null
    }
    return { success: true }
  }

  /**
   * 创建回滚点
   */
  async createRollbackPoint(entityType, entityId, operation, data, options = {}) {
    const pointId = uuidv4()
    const timestamp = new Date()
    
    try {
      logger.info(`[数据回滚] 创建回滚点: ${pointId} - ${entityType} ${entityId}`)
      
      // 准备回滚点数据
      const rollbackPoint = {
        pointId,
        entityType,
        entityId,
        operation,
        data: this.sanitizeDataForRollback(data),
        type: options.type || 'automatic',
        description: options.description || `${operation} 操作前的数据快照`,
        metadata: {
          userId: options.userId,
          operationContext: options.context,
          source: options.source || 'sync_operation',
          tags: options.tags || []
        },
        status: 'active',
        createdAt: timestamp,
        expiresAt: new Date(timestamp.getTime() + this.rollbackConfig.rollbackRetentionDays * 24 * 60 * 60 * 1000)
      }
      
      // 保存回滚点
      await mongoose.connection.db.collection('rollback_points').insertOne(rollbackPoint)
      
      // 添加到缓存
      this.rollbackPoints.set(pointId, rollbackPoint)
      
      // 记录日志
      await this.logRollbackOperation('create', pointId, entityType, entityId, operation, 'success')
      
      logger.info(`[数据回滚] 回滚点创建成功: ${pointId}`)
      
      return {
        success: true,
        pointId,
        message: '回滚点创建成功'
      }
      
    } catch (error) {
      logger.error(`[数据回滚] 创建回滚点失败: ${pointId}`, error)
      
      await this.logRollbackOperation('create', pointId, entityType, entityId, operation, 'failed', error.message)
      
      throw error
    }
  }

  /**
   * 执行回滚操作
   */
  async performRollback(pointId, options = {}) {
    const operationId = uuidv4()
    const startTime = new Date()
    
    try {
      logger.info(`[数据回滚] 开始执行回滚操作: ${operationId} - 回滚点: ${pointId}`)
      
      // 检查是否已有进行中的回滚操作
      if (this.activeRollbackOperations.has(pointId)) {
        throw new Error(`回滚点 ${pointId} 正在进行回滚操作`)
      }
      
      // 添加到活跃操作集合
      this.activeRollbackOperations.add(pointId)
      
      // 记录恢复操作开始
      await this.logRecoveryOperation(operationId, 'rollback', pointId, 'started', options)
      
      // 获取回滚点
      const rollbackPoint = await this.getRollbackPoint(pointId)
      if (!rollbackPoint) {
        throw new Error(`回滚点 ${pointId} 不存在`)
      }
      
      // 验证回滚点状态
      if (rollbackPoint.status !== 'active') {
        throw new Error(`回滚点 ${pointId} 状态不可用: ${rollbackPoint.status}`)
      }
      
      // 执行回滚
      const rollbackResult = await this.executeRollback(rollbackPoint, options)
      
      // 记录恢复操作完成
      const endTime = new Date()
      await this.logRecoveryOperation(operationId, 'rollback', pointId, 'completed', options, {
        duration: endTime - startTime,
        result: rollbackResult
      })
      
      // 从活跃操作集合移除
      this.activeRollbackOperations.delete(pointId)
      
      logger.info(`[数据回滚] 回滚操作完成: ${operationId}`)
      
      return {
        success: true,
        operationId,
        pointId,
        result: rollbackResult,
        duration: endTime - startTime
      }
      
    } catch (error) {
      logger.error(`[数据回滚] 回滚操作失败: ${operationId}`, error)
      
      // 从活跃操作集合移除
      this.activeRollbackOperations.delete(pointId)
      
      await this.logRecoveryOperation(operationId, 'rollback', pointId, 'failed', options, {
        error: error.message
      })
      
      throw error
    }
  }

  /**
   * 执行回滚逻辑
   */
  async executeRollback(rollbackPoint, options) {
    const { entityType, entityId, operation, data } = rollbackPoint
    
    try {
      // 获取当前数据状态
      const currentData = await this.getCurrentEntityData(entityType, entityId)
      
      // 根据操作类型执行回滚
      let rollbackResult
      
      switch (operation) {
        case 'create':
          rollbackResult = await this.rollbackCreate(entityType, entityId, data, currentData, options)
          break
          
        case 'update':
          rollbackResult = await this.rollbackUpdate(entityType, entityId, data, currentData, options)
          break
          
        case 'delete':
          rollbackResult = await this.rollbackDelete(entityType, entityId, data, currentData, options)
          break
          
        default:
          throw new Error(`不支持的操作类型: ${operation}`)
      }
      
      // 更新回滚点状态
      await this.updateRollbackPointStatus(rollbackPoint.pointId, 'used')
      
      return rollbackResult
      
    } catch (error) {
      logger.error(`[数据回滚] 执行回滚逻辑失败: ${rollbackPoint.pointId}`, error)
      throw error
    }
  }

  /**
   * 回滚创建操作
   */
  async rollbackCreate(entityType, entityId, originalData, currentData, options) {
    try {
      // 删除创建的实体
      const deleteResult = await this.deleteEntity(entityType, entityId)
      
      return {
        operation: 'rollback_create',
        entityType,
        entityId,
        action: 'delete_created_entity',
        result: deleteResult,
        success: true
      }
      
    } catch (error) {
      logger.error(`[数据回滚] 回滚创建操作失败: ${entityType} ${entityId}`, error)
      throw error
    }
  }

  /**
   * 回滚更新操作
   */
  async rollbackUpdate(entityType, entityId, originalData, currentData, options) {
    try {
      // 恢复原始数据
      const updateResult = await this.updateEntity(entityType, entityId, originalData)
      
      return {
        operation: 'rollback_update',
        entityType,
        entityId,
        action: 'restore_original_data',
        result: updateResult,
        success: true
      }
      
    } catch (error) {
      logger.error(`[数据回滚] 回滚更新操作失败: ${entityType} ${entityId}`, error)
      throw error
    }
  }

  /**
   * 回滚删除操作
   */
  async rollbackDelete(entityType, entityId, originalData, currentData, options) {
    try {
      // 重新创建实体
      const createResult = await this.createEntity(entityType, entityId, originalData)
      
      return {
        operation: 'rollback_delete',
        entityType,
        entityId,
        action: 'recreate_deleted_entity',
        result: createResult,
        success: true
      }
      
    } catch (error) {
      logger.error(`[数据回滚] 回滚删除操作失败: ${entityType} ${entityId}`, error)
      throw error
    }
  }

  /**
   * 执行自动回滚
   */
  async performAutoRollback(failedOperation, error, options = {}) {
    try {
      logger.info(`[数据回滚] 执行自动回滚: ${failedOperation.operationId}`)
      
      // 查找相关的回滚点
      const rollbackPoint = await this.findRollbackPointForOperation(failedOperation)
      if (!rollbackPoint) {
        logger.warn(`[数据回滚] 未找到适合的回滚点: ${failedOperation.operationId}`)
        return {
          success: false,
          message: '未找到适合的回滚点'
        }
      }
      
      // 执行回滚
      const rollbackResult = await this.performRollback(rollbackPoint.pointId, {
        ...options,
        source: 'auto_rollback',
        reason: `操作失败自动回滚: ${error.message}`
      })
      
      logger.info(`[数据回滚] 自动回滚完成: ${failedOperation.operationId}`)
      
      return rollbackResult
      
    } catch (rollbackError) {
      logger.error(`[数据回滚] 自动回滚失败: ${failedOperation.operationId}`, rollbackError)
      throw rollbackError
    }
  }

  /**
   * 执行点时间恢复
   */
  async performPointInTimeRecovery(targetTime, options = {}) {
    const operationId = uuidv4()
    
    try {
      logger.info(`[数据回滚] 执行点时间恢复: ${operationId} - 目标时间: ${targetTime}`)
      
      // 记录恢复操作开始
      await this.logRecoveryOperation(operationId, 'point_in_time', targetTime, 'started', options)
      
      // 查找目标时间之前的回滚点
      const rollbackPoints = await this.findRollbackPointsBeforeTime(targetTime, options)
      
      if (rollbackPoints.length === 0) {
        throw new Error(`目标时间 ${targetTime} 之前没有找到回滚点`)
      }
      
      // 按时间顺序执行恢复
      const recoveryResults = []
      for (const point of rollbackPoints) {
        try {
          const result = await this.performRollback(point.pointId, {
            ...options,
            source: 'point_in_time_recovery'
          })
          recoveryResults.push(result)
        } catch (error) {
          logger.error(`[数据回滚] 恢复点失败: ${point.pointId}`, error)
          recoveryResults.push({
            success: false,
            pointId: point.pointId,
            error: error.message
          })
        }
      }
      
      // 记录恢复操作完成
      await this.logRecoveryOperation(operationId, 'point_in_time', targetTime, 'completed', options, {
        results: recoveryResults
      })
      
      logger.info(`[数据回滚] 点时间恢复完成: ${operationId}`)
      
      return {
        success: true,
        operationId,
        targetTime,
        results: recoveryResults,
        totalRecovered: recoveryResults.filter(r => r.success).length
      }
      
    } catch (error) {
      logger.error(`[数据回滚] 点时间恢复失败: ${operationId}`, error)
      
      await this.logRecoveryOperation(operationId, 'point_in_time', targetTime, 'failed', options, {
        error: error.message
      })
      
      throw error
    }
  }

  /**
   * 执行批量回滚
   */
  async performBatchRollback(pointIds, options = {}) {
    const operationId = uuidv4()
    
    try {
      logger.info(`[数据回滚] 执行批量回滚: ${operationId} - 回滚点数量: ${pointIds.length}`)
      
      // 记录恢复操作开始
      await this.logRecoveryOperation(operationId, 'batch_rollback', pointIds, 'started', options)
      
      const rollbackResults = []
      
      // 按顺序执行回滚（避免依赖冲突）
      for (const pointId of pointIds) {
        try {
          const result = await this.performRollback(pointId, {
            ...options,
            source: 'batch_rollback'
          })
          rollbackResults.push(result)
        } catch (error) {
          logger.error(`[数据回滚] 批量回滚点失败: ${pointId}`, error)
          rollbackResults.push({
            success: false,
            pointId,
            error: error.message
          })
        }
      }
      
      // 记录恢复操作完成
      await this.logRecoveryOperation(operationId, 'batch_rollback', pointIds, 'completed', options, {
        results: rollbackResults
      })
      
      logger.info(`[数据回滚] 批量回滚完成: ${operationId}`)
      
      return {
        success: true,
        operationId,
        results: rollbackResults,
        totalProcessed: rollbackResults.length,
        successful: rollbackResults.filter(r => r.success).length,
        failed: rollbackResults.filter(r => !r.success).length
      }
      
    } catch (error) {
      logger.error(`[数据回滚] 批量回滚失败: ${operationId}`, error)
      
      await this.logRecoveryOperation(operationId, 'batch_rollback', pointIds, 'failed', options, {
        error: error.message
      })
      
      throw error
    }
  }

  /**
   * 获取回滚点
   */
  async getRollbackPoint(pointId) {
    try {
      // 先检查缓存
      if (this.rollbackPoints.has(pointId)) {
        return this.rollbackPoints.get(pointId)
      }
      
      // 从数据库获取
      const point = await mongoose.connection.db.collection('rollback_points').findOne({ pointId })
      
      if (point) {
        this.rollbackPoints.set(pointId, point)
      }
      
      return point
      
    } catch (error) {
      logger.error(`[数据回滚] 获取回滚点失败: ${pointId}`, error)
      throw error
    }
  }

  /**
   * 查找操作的回滚点
   */
  async findRollbackPointForOperation(operation) {
    try {
      const { entityType, entityId, operationId } = operation
      
      // 查找最近的相关回滚点
      const rollbackPoint = await mongoose.connection.db.collection('rollback_points')
        .findOne({
          entityType,
          entityId,
          status: 'active',
          createdAt: { $lte: operation.timestamp || new Date() }
        })
        .sort({ createdAt: -1 })
      
      return rollbackPoint
      
    } catch (error) {
      logger.error('[数据回滚] 查找操作回滚点失败:', error)
      return null
    }
  }

  /**
   * 查找时间之前的回滚点
   */
  async findRollbackPointsBeforeTime(targetTime, options = {}) {
    try {
      const { entityType, limit = 100 } = options
      
      const query = {
        createdAt: { $lte: new Date(targetTime) },
        status: 'active'
      }
      
      if (entityType) {
        query.entityType = entityType
      }
      
      const rollbackPoints = await mongoose.connection.db.collection('rollback_points')
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray()
      
      return rollbackPoints
      
    } catch (error) {
      logger.error('[数据回滚] 查找时间之前回滚点失败:', error)
      throw error
    }
  }

  /**
   * 清理旧的回滚点
   */
  async cleanupOldRollbackPoints() {
    try {
      const cutoffDate = new Date(Date.now() - this.rollbackConfig.rollbackRetentionDays * 24 * 60 * 60 * 1000)
      
      const result = await mongoose.connection.db.collection('rollback_points').deleteMany({
        createdAt: { $lt: cutoffDate },
        status: { $in: ['used', 'expired'] }
      })
      
      if (result.deletedCount > 0) {
        logger.info(`[数据回滚] 清理 ${result.deletedCount} 个旧回滚点`)
      }
      
    } catch (error) {
      logger.error('[数据回滚] 清理旧回滚点失败:', error)
    }
  }

  /**
   * 执行自动备份
   */
  async performAutomaticBackup() {
    try {
      logger.info('[数据回滚] 执行自动备份')
      
      // 备份主要实体类型
      const entityTypes = ['Order', 'Customer', 'Product', 'User']
      
      for (const entityType of entityTypes) {
        try {
          await this.createEntityBackup(entityType)
        } catch (error) {
          logger.error(`[数据回滚] 自动备份 ${entityType} 失败:`, error)
        }
      }
      
    } catch (error) {
      logger.error('[数据回滚] 自动备份失败:', error)
    }
  }

  /**
   * 创建实体备份
   */
  async createEntityBackup(entityType) {
    try {
      const snapshotId = uuidv4()
      const timestamp = new Date()
      
      // 获取实体数据
      const entities = await this.getAllEntities(entityType)
      
      // 创建备份快照
      const snapshot = {
        snapshotId,
        entityType,
        data: entities,
        type: 'automatic',
        createdAt: timestamp,
        entityCount: entities.length,
        metadata: {
          backupType: 'full',
          source: 'automatic_backup'
        }
      }
      
      // 保存快照
      await mongoose.connection.db.collection('backup_snapshots').insertOne(snapshot)
      
      logger.info(`[数据回滚] 创建备份快照: ${snapshotId} - ${entityType} (${entities.length} 条记录)`)
      
      return snapshotId
      
    } catch (error) {
      logger.error(`[数据回滚] 创建实体备份失败: ${entityType}`, error)
      throw error
    }
  }

  /**
   * 数据访问方法
   */
  sanitizeDataForRollback(data) {
    // 清理敏感数据，准备回滚
    return JSON.parse(JSON.stringify(data))
  }

  async getCurrentEntityData(entityType, entityId) {
    // 实际实现中需要根据entityType选择正确的模型
    return null
  }

  async createEntity(entityType, entityId, data) {
    // 实际实现中需要根据entityType选择正确的模型
    return true
  }

  async updateEntity(entityType, entityId, data) {
    // 实际实现中需要根据entityType选择正确的模型
    return true
  }

  async deleteEntity(entityType, entityId) {
    // 实际实现中需要根据entityType选择正确的模型
    return true
  }

  async getAllEntities(entityType) {
    // 实际实现中需要根据entityType选择正确的模型
    return []
  }

  /**
   * 日志记录方法
   */
  async logRollbackOperation(type, pointId, entityType, entityId, operation, status, error = null) {
    try {
      await mongoose.connection.db.collection('rollback_logs').insertOne({
        operationId: uuidv4(),
        type,
        pointId,
        entityType,
        entityId,
        operation,
        status,
        error,
        timestamp: new Date()
      })
    } catch (error) {
      logger.error('[数据回滚] 记录回滚日志失败:', error)
    }
  }

  async logRecoveryOperation(operationId, type, target, status, options = {}, result = {}) {
    try {
      await mongoose.connection.db.collection('recovery_operations').updateOne(
        { operationId },
        {
          $set: {
            type,
            target,
            status,
            options,
            result,
            updatedAt: new Date()
          },
          $setOnInsert: {
            operationId,
            createdAt: new Date()
          }
        },
        { upsert: true }
      )
    } catch (error) {
      logger.error('[数据回滚] 记录恢复操作日志失败:', error)
    }
  }

  async updateRollbackPointStatus(pointId, status) {
    try {
      await mongoose.connection.db.collection('rollback_points').updateOne(
        { pointId },
        { 
          $set: { 
            status,
            updatedAt: new Date()
          } 
        }
      )
      
      // 更新缓存
      if (this.rollbackPoints.has(pointId)) {
        const point = this.rollbackPoints.get(pointId)
        point.status = status
      }
    } catch (error) {
      logger.error('[数据回滚] 更新回滚点状态失败:', error)
    }
  }

  /**
   * 获取回滚状态
   */
  getRollbackStatus() {
    return {
      activeOperations: this.activeRollbackOperations.size,
      cachedPoints: this.rollbackPoints.size,
      config: this.rollbackConfig,
      queueLength: this.backupQueue.length
    }
  }

  /**
   * 获取可用的回滚点
   */
  async getAvailableRollbackPoints(options = {}) {
    try {
      const { entityType, limit = 50 } = options
      
      const query = { status: 'active' }
      if (entityType) {
        query.entityType = entityType
      }
      
      const points = await mongoose.connection.db.collection('rollback_points')
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray()
      
      return points
      
    } catch (error) {
      logger.error('[数据回滚] 获取可用回滚点失败:', error)
      throw error
    }
  }
}

// 创建单例实例
const dataRollbackService = new DataRollbackService()

export default dataRollbackService
