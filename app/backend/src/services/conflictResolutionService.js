import mongoose from 'mongoose'
import { logger } from '../utils/logger.js'
import crypto from 'crypto'

/**
 * 同步冲突解决服务
 * 处理PC端MongoDB与小程序云开发数据库之间的数据冲突
 * 支持多种冲突解决策略
 */
class ConflictResolutionService {
  constructor() {
    this.strategies = {
      timestamp: new TimestampStrategy(),
      version: new VersionStrategy(),
      server_wins: new ServerWinsStrategy(),
      client_wins: new ClientWinsStrategy(),
      merge: new MergeStrategy(),
      manual: new ManualStrategy()
    }
    
    this.config = {
      defaultStrategy: 'timestamp',
      enableConflictLogging: true,
      enableConflictNotification: true,
      conflictRetentionDays: 30,
      maxConflictRetries: 3,
      conflictRetryDelay: 5000
    }
    
    this.conflictStats = {
      totalConflicts: 0,
      resolvedConflicts: 0,
      failedResolutions: 0,
      pendingConflicts: 0,
      strategyUsage: {}
    }
  }

  /**
   * 初始化冲突解决服务
   */
  async initialize() {
    try {
      logger.info('[冲突解决] 初始化服务...')
      
      // 创建冲突记录集合
      await this.createConflictCollections()
      
      // 初始化策略使用统计
      for (const strategyName of Object.keys(this.strategies)) {
        this.conflictStats.strategyUsage[strategyName] = 0
      }
      
      logger.info('[冲突解决] 服务初始化完成')
      return { success: true, message: '冲突解决服务初始化成功' }
      
    } catch (error) {
      logger.error('[冲突解决] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 创建冲突记录集合
   */
  async createConflictCollections() {
    const collections = ['conflict_records', 'conflict_resolutions', 'conflict_statistics']
    
    for (const collectionName of collections) {
      try {
        const collections = await mongoose.connection.db.listCollections({ name: collectionName }).toArray()
        if (collections.length === 0) {
          await mongoose.connection.db.createCollection(collectionName)
          logger.info(`[冲突解决] 创建集合: ${collectionName}`)
        }
      } catch (error) {
        logger.warn(`[冲突解决] 创建集合 ${collectionName} 失败:`, error.message)
      }
    }
  }

  /**
   * 检测冲突
   */
  async detectConflicts(pcData, wechatData, collection, options = {}) {
    try {
      logger.info(`[冲突解决] 开始检测${collection}集合的冲突...`)
      
      const conflicts = []
      
      // 创建数据映射
      const pcMap = new Map(pcData.map(item => [item.id, item]))
      const wechatMap = new Map(wechatData.map(item => [item.id, item]))
      
      // 检测相同ID但内容不同的记录
      for (const [id, pcItem] of pcMap) {
        if (wechatMap.has(id)) {
          const wechatItem = wechatMap.get(id)
          const conflict = await this.analyzeConflict(pcItem, wechatItem, collection, options)
          
          if (conflict.hasConflict) {
            conflicts.push(conflict)
          }
        }
      }
      
      logger.info(`[冲突解决] 检测到 ${conflicts.length} 个冲突`)
      
      // 记录冲突统计
      this.updateConflictStats('detected', conflicts.length)
      
      return {
        success: true,
        conflicts,
        totalConflicts: conflicts.length,
        collection
      }
      
    } catch (error) {
      logger.error(`[冲突解决] 检测${collection}冲突失败:`, error)
      throw error
    }
  }

  /**
   * 分析冲突
   */
  async analyzeConflict(pcItem, wechatItem, collection, options) {
    try {
      const conflict = {
        id: pcItem.id,
        collection,
        pcData: pcItem,
        wechatData: wechatItem,
        conflictType: 'unknown',
        conflictFields: [],
        severity: 'medium',
        hasConflict: false,
        detectedAt: new Date(),
        hash: this.generateConflictHash(pcItem, wechatItem)
      }
      
      // 分析冲突类型
      conflict.conflictType = this.determineConflictType(pcItem, wechatItem)
      
      // 分析冲突字段
      conflict.conflictFields = this.analyzeConflictFields(pcItem, wechatItem)
      
      // 确定冲突严重性
      conflict.severity = this.determineConflictSeverity(conflict.conflictType, conflict.conflictFields)
      
      // 检查是否有冲突
      conflict.hasConflict = conflict.conflictFields.length > 0
      
      return conflict
      
    } catch (error) {
      logger.error('[冲突解决] 分析冲突失败:', error)
      return {
        id: pcItem.id,
        collection,
        pcData: pcItem,
        wechatData: wechatItem,
        conflictType: 'analysis_error',
        conflictFields: [],
        severity: 'high',
        hasConflict: true,
        detectedAt: new Date(),
        error: error.message
      }
    }
  }

  /**
   * 确定冲突类型
   */
  determineConflictType(pcItem, wechatItem) {
    const pcTimestamp = new Date(pcItem.updatedAt || pcItem.createdAt).getTime()
    const wechatTimestamp = new Date(wechatItem.updatedAt || wechatItem.createdAt).getTime()
    
    // 时间戳冲突
    if (Math.abs(pcTimestamp - wechatTimestamp) < 1000) {
      return 'concurrent_modification'
    }
    
    // 版本冲突
    if (pcItem._version && wechatItem._version && pcItem._version !== wechatItem._version) {
      return 'version_mismatch'
    }
    
    // 业务逻辑冲突
    if (this.hasBusinessLogicConflict(pcItem, wechatItem)) {
      return 'business_logic_conflict'
    }
    
    // 数据完整性冲突
    if (this.hasDataIntegrityConflict(pcItem, wechatItem)) {
      return 'data_integrity_conflict'
    }
    
    return 'content_difference'
  }

  /**
   * 分析冲突字段
   */
  analyzeConflictFields(pcItem, wechatItem) {
    const conflictFields = []
    const allFields = new Set([...Object.keys(pcItem), ...Object.keys(wechatItem)])
    
    for (const field of allFields) {
      if (this.shouldIgnoreField(field)) {
        continue
      }
      
      const pcValue = pcItem[field]
      const wechatValue = wechatItem[field]
      
      if (!this.isFieldEqual(pcValue, wechatValue)) {
        conflictFields.push({
          field,
          pcValue,
          wechatValue,
          fieldType: this.getFieldType(field),
          changeType: this.getChangeType(pcValue, wechatValue),
          businessImpact: this.getBusinessImpact(field, pcValue, wechatValue)
        })
      }
    }
    
    return conflictFields
  }

  /**
   * 确定冲突严重性
   */
  determineConflictSeverity(conflictType, conflictFields) {
    // 高严重性冲突
    const highSeverityTypes = ['business_logic_conflict', 'data_integrity_conflict']
    if (highSeverityTypes.includes(conflictType)) {
      return 'high'
    }
    
    // 检查关键字段
    const criticalFields = ['orderNo', 'customerId', 'totalAmount', 'status']
    const hasCriticalField = conflictFields.some(field => criticalFields.includes(field.field))
    
    if (hasCriticalField) {
      return 'high'
    }
    
    // 检查业务影响
    const hasHighImpact = conflictFields.some(field => field.businessImpact === 'high')
    if (hasHighImpact) {
      return 'high'
    }
    
    // 中等严重性
    if (conflictFields.length > 3) {
      return 'medium'
    }
    
    return 'low'
  }

  /**
   * 解决冲突
   */
  async resolveConflicts(conflicts, strategy = null, options = {}) {
    try {
      const resolved = []
      const failed = []
      
      logger.info(`[冲突解决] 开始解决 ${conflicts.length} 个冲突...`)
      
      for (const conflict of conflicts) {
        try {
          const resolution = await this.resolveConflict(conflict, strategy, options)
          resolved.push(resolution)
          
          // 记录冲突解决统计
          this.updateConflictStats('resolved', 1, resolution.strategy)
          
        } catch (error) {
          logger.error(`[冲突解决] 解决冲突失败:`, error)
          failed.push({
            conflict,
            error: error.message
          })
          
          this.updateConflictStats('failed', 1)
        }
      }
      
      logger.info(`[冲突解决] 解决完成: 成功${resolved.length}, 失败${failed.length}`)
      
      return {
        success: true,
        resolved,
        failed,
        total: conflicts.length,
        successRate: (resolved.length / conflicts.length) * 100
      }
      
    } catch (error) {
      logger.error('[冲突解决] 批量解决冲突失败:', error)
      throw error
    }
  }

  /**
   * 解决单个冲突
   */
  async resolveConflict(conflict, strategy = null, options = {}) {
    try {
      const effectiveStrategy = strategy || this.config.defaultStrategy
      const strategyInstance = this.strategies[effectiveStrategy]
      
      if (!strategyInstance) {
        throw new Error(`未知的冲突解决策略: ${effectiveStrategy}`)
      }
      
      logger.info(`[冲突解决] 使用策略 ${effectiveStrategy} 解决冲突 ${conflict.id}`)
      
      // 执行冲突解决策略
      const resolution = await strategyInstance.resolve(conflict, options)
      
      // 验证解决结果
      const validatedResolution = await this.validateResolution(resolution)
      
      // 记录冲突解决
      if (this.config.enableConflictLogging) {
        await this.recordConflictResolution(conflict, validatedResolution)
      }
      
      return validatedResolution
      
    } catch (error) {
      logger.error(`[冲突解决] 解决冲突 ${conflict.id} 失败:`, error)
      
      // 尝试使用备用策略
      if (options.retryWithFallback !== false) {
        return await this.resolveWithFallback(conflict, strategy, options)
      }
      
      throw error
    }
  }

  /**
   * 使用备用策略解决冲突
   */
  async resolveWithFallback(conflict, originalStrategy, options) {
    const fallbackStrategies = ['timestamp', 'server_wins', 'manual']
    
    for (const fallbackStrategy of fallbackStrategies) {
      if (fallbackStrategy === originalStrategy) {
        continue
      }
      
      try {
        logger.info(`[冲突解决] 尝试使用备用策略 ${fallbackStrategy} 解决冲突 ${conflict.id}`)
        
        const resolution = await this.resolveConflict(conflict, fallbackStrategy, {
          ...options,
          retryWithFallback: false
        })
        
        resolution.wasFallback = true
        resolution.fallbackStrategy = fallbackStrategy
        
        return resolution
        
      } catch (fallbackError) {
        logger.warn(`[冲突解决] 备用策略 ${fallbackStrategy} 也失败:`, fallbackError)
        continue
      }
    }
    
    throw new Error('所有冲突解决策略都失败')
  }

  /**
   * 验证解决结果
   */
  async validateResolution(resolution) {
    // 基本验证
    if (!resolution.resolvedData) {
      throw new Error('解决结果缺少resolvedData')
    }
    
    if (!resolution.strategy) {
      throw new Error('解决结果缺少strategy')
    }
    
    // 业务逻辑验证
    if (resolution.resolvedData.totalAmount !== undefined) {
      if (resolution.resolvedData.totalAmount < 0) {
        throw new Error('解决结果中的总金额不能为负数')
      }
    }
    
    return resolution
  }

  /**
   * 记录冲突解决
   */
  async recordConflictResolution(conflict, resolution) {
    try {
      const record = {
        conflictId: conflict.id,
        collection: conflict.collection,
        conflictType: conflict.conflictType,
        severity: conflict.severity,
        strategy: resolution.strategy,
        resolution: resolution,
        timestamp: new Date(),
        hash: conflict.hash
      }
      
      await mongoose.connection.db.collection('conflict_resolutions').insertOne(record)
      
      logger.info(`[冲突解决] 记录冲突解决: ${conflict.id}`)
      
    } catch (error) {
      logger.error('[冲突解决] 记录冲突解决失败:', error)
    }
  }

  /**
   * 生成冲突哈希
   */
  generateConflictHash(pcItem, wechatItem) {
    const combinedData = JSON.stringify({ pc: pcItem, wechat: wechatItem })
    return crypto.createHash('md5').update(combinedData).digest('hex')
  }

  /**
   * 检查是否有业务逻辑冲突
   */
  hasBusinessLogicConflict(pcItem, wechatItem) {
    // 订单状态冲突
    if (pcItem.status && wechatItem.status && pcItem.status !== wechatItem.status) {
      const statusPriority = { 'pending': 1, 'processing': 2, 'completed': 3, 'cancelled': 4 }
      const pcPriority = statusPriority[pcItem.status] || 0
      const wechatPriority = statusPriority[wechatItem.status] || 0
      
      // 如果状态优先级差异过大，认为是业务逻辑冲突
      if (Math.abs(pcPriority - wechatPriority) > 1) {
        return true
      }
    }
    
    // 金额冲突
    if (pcItem.totalAmount && wechatItem.totalAmount) {
      const amountDiff = Math.abs(pcItem.totalAmount - wechatItem.totalAmount)
      if (amountDiff > 0.01) { // 差异超过1分钱
        return true
      }
    }
    
    return false
  }

  /**
   * 检查是否有数据完整性冲突
   */
  hasDataIntegrityConflict(pcItem, wechatItem) {
    // 检查必填字段
    const requiredFields = ['orderNo', 'customerId']
    
    for (const field of requiredFields) {
      const pcHasField = pcItem[field] !== undefined && pcItem[field] !== null && pcItem[field] !== ''
      const wechatHasField = wechatItem[field] !== undefined && wechatItem[field] !== null && wechatItem[field] !== ''
      
      if (pcHasField !== wechatHasField) {
        return true
      }
    }
    
    return false
  }

  /**
   * 是否应该忽略字段
   */
  shouldIgnoreField(field) {
    const ignoreFields = ['_id', '__v', '_version', 'createdAt', 'updatedAt', 'syncStatus']
    return ignoreFields.includes(field)
  }

  /**
   * 检查字段是否相等
   */
  isFieldEqual(value1, value2) {
    if (value1 === value2) {
      return true
    }
    
    // 处理null和undefined
    if ((value1 === null || value1 === undefined) && (value2 === null || value2 === undefined)) {
      return true
    }
    
    // 处理日期
    if (this.isDate(value1) && this.isDate(value2)) {
      return new Date(value1).getTime() === new Date(value2).getTime()
    }
    
    // 处理数字
    if (typeof value1 === 'number' && typeof value2 === 'number') {
      return Math.abs(value1 - value2) < 0.0001 // 浮点数比较
    }
    
    // 处理对象和数组
    if (typeof value1 === 'object' && typeof value2 === 'object') {
      return JSON.stringify(value1) === JSON.stringify(value2)
    }
    
    return false
  }

  /**
   * 获取字段类型
   */
  getFieldType(field) {
    const fieldTypes = {
      'orderNo': 'string',
      'customerId': 'reference',
      'totalAmount': 'number',
      'status': 'enum',
      'createdAt': 'datetime',
      'updatedAt': 'datetime'
    }
    
    return fieldTypes[field] || 'unknown'
  }

  /**
   * 获取变更类型
   */
  getChangeType(oldValue, newValue) {
    if (oldValue === undefined || oldValue === null) {
      return 'add'
    }
    
    if (newValue === undefined || newValue === null) {
      return 'delete'
    }
    
    return 'modify'
  }

  /**
   * 获取业务影响
   */
  getBusinessImpact(field, pcValue, wechatValue) {
    const highImpactFields = ['totalAmount', 'status', 'customerId']
    const mediumImpactFields = ['orderNo', 'createdAt']
    
    if (highImpactFields.includes(field)) {
      return 'high'
    }
    
    if (mediumImpactFields.includes(field)) {
      return 'medium'
    }
    
    return 'low'
  }

  /**
   * 检查是否为日期
   */
  isDate(value) {
    return value instanceof Date || !isNaN(Date.parse(value))
  }

  /**
   * 更新冲突统计
   */
  updateConflictStats(type, count, strategy = null) {
    switch (type) {
      case 'detected':
        this.conflictStats.totalConflicts += count
        this.conflictStats.pendingConflicts += count
        break
      case 'resolved':
        this.conflictStats.resolvedConflicts += count
        this.conflictStats.pendingConflicts -= count
        if (strategy) {
          this.conflictStats.strategyUsage[strategy] = (this.conflictStats.strategyUsage[strategy] || 0) + count
        }
        break
      case 'failed':
        this.conflictStats.failedResolutions += count
        break
    }
  }

  /**
   * 获取冲突统计
   */
  getConflictStats() {
    return {
      ...this.conflictStats,
      resolutionRate: this.conflictStats.totalConflicts > 0 ? 
        (this.conflictStats.resolvedConflicts / this.conflictStats.totalConflicts) * 100 : 0
    }
  }

  /**
   * 解决所有冲突
   */
  async resolveAllConflicts(options = {}) {
    try {
      logger.info('[冲突解决] 开始解决所有冲突...')
      
      // 获取所有待解决的冲突
      const pendingConflicts = await mongoose.connection.db.collection('conflict_records').find({
        status: 'pending'
      }).toArray()
      
      if (pendingConflicts.length === 0) {
        logger.info('[冲突解决] 没有待解决的冲突')
        return {
          success: true,
          message: '没有待解决的冲突',
          resolvedCount: 0,
          failedCount: 0
        }
      }
      
      logger.info(`[冲突解决] 发现 ${pendingConflicts.length} 个待解决的冲突`)
      
      let resolvedCount = 0
      let failedCount = 0
      const results = []
      
      // 逐个解决冲突
      for (const conflictRecord of pendingConflicts) {
        try {
          const result = await this.resolveConflict(conflictRecord, options)
          if (result.success) {
            resolvedCount++
            results.push({
              conflictId: conflictRecord._id,
              status: 'resolved',
              strategy: result.strategy
            })
          } else {
            failedCount++
            results.push({
              conflictId: conflictRecord._id,
              status: 'failed',
              error: result.error
            })
          }
        } catch (error) {
          logger.error(`[冲突解决] 解决冲突 ${conflictRecord._id} 失败:`, error)
          failedCount++
          results.push({
            conflictId: conflictRecord._id,
            status: 'failed',
            error: error.message
          })
        }
      }
      
      logger.info(`[冲突解决] 冲突解决完成: 成功 ${resolvedCount}, 失败 ${failedCount}`)
      
      return {
        success: true,
        message: '冲突解决完成',
        resolvedCount,
        failedCount,
        results
      }
      
    } catch (error) {
      logger.error('[冲突解决] 解决所有冲突失败:', error)
      throw error
    }
  }

  /**
   * 清理过期冲突记录
   */
  async cleanupExpiredConflicts() {
    try {
      const cutoffDate = new Date(Date.now() - this.config.conflictRetentionDays * 24 * 60 * 60 * 1000)
      
      const result = await mongoose.connection.db.collection('conflict_records').deleteMany({
        timestamp: { $lt: cutoffDate }
      })
      
      logger.info(`[冲突解决] 清理了 ${result.deletedCount} 条过期冲突记录`)
      
      return result.deletedCount
      
    } catch (error) {
      logger.error('[冲突解决] 清理过期冲突记录失败:', error)
      return 0
    }
  }
}

/**
 * 时间戳策略 - 使用时间戳决定哪个版本优先
 */
class TimestampStrategy {
  async resolve(conflict, options = {}) {
    const pcTimestamp = new Date(conflict.pcData.updatedAt || conflict.pcData.createdAt).getTime()
    const wechatTimestamp = new Date(conflict.wechatData.updatedAt || conflict.wechatData.createdAt).getTime()
    
    const winner = pcTimestamp > wechatTimestamp ? 'pc' : 'wechat'
    const resolvedData = winner === 'pc' ? conflict.pcData : conflict.wechatData
    
    return {
      strategy: 'timestamp',
      winner,
      resolvedData,
      reason: `${winner}端时间戳更新`,
      details: {
        pcTimestamp: new Date(pcTimestamp).toISOString(),
        wechatTimestamp: new Date(wechatTimestamp).toISOString(),
        timeDifference: Math.abs(pcTimestamp - wechatTimestamp)
      }
    }
  }
}

/**
 * 版本号策略 - 使用版本号决定哪个版本优先
 */
class VersionStrategy {
  async resolve(conflict, options = {}) {
    const pcVersion = conflict.pcData._version || 1
    const wechatVersion = conflict.wechatData._version || 1
    
    const winner = pcVersion > wechatVersion ? 'pc' : 'wechat'
    const resolvedData = winner === 'pc' ? conflict.pcData : conflict.wechatData
    
    return {
      strategy: 'version',
      winner,
      resolvedData,
      reason: `${winner}端版本号更高`,
      details: {
        pcVersion,
        wechatVersion,
        versionDifference: Math.abs(pcVersion - wechatVersion)
      }
    }
  }
}

/**
 * 服务器优先策略 - 总是选择服务器(PC端)数据
 */
class ServerWinsStrategy {
  async resolve(conflict, options = {}) {
    return {
      strategy: 'server_wins',
      winner: 'pc',
      resolvedData: conflict.pcData,
      reason: '服务器端数据优先',
      details: {
        originalSource: 'pc'
      }
    }
  }
}

/**
 * 客户端优先策略 - 总是选择客户端(小程序)数据
 */
class ClientWinsStrategy {
  async resolve(conflict, options = {}) {
    return {
      strategy: 'client_wins',
      winner: 'wechat',
      resolvedData: conflict.wechatData,
      reason: '客户端数据优先',
      details: {
        originalSource: 'wechat'
      }
    }
  }
}

/**
 * 合并策略 - 尝试合并两个版本的数据
 */
class MergeStrategy {
  async resolve(conflict, options = {}) {
    try {
      const mergedData = await this.mergeData(conflict.pcData, conflict.wechatData, conflict.conflictFields)
      
      return {
        strategy: 'merge',
        winner: 'merged',
        resolvedData: mergedData,
        reason: '数据合并成功',
        details: {
          mergedFields: Object.keys(mergedData),
          conflictFields: conflict.conflictFields.map(f => f.field)
        }
      }
      
    } catch (error) {
      // 合并失败，回退到时间戳策略
      const timestampStrategy = new TimestampStrategy()
      const fallbackResolution = await timestampStrategy.resolve(conflict, options)
      
      return {
        ...fallbackResolution,
        strategy: 'merge_fallback_timestamp',
        reason: '数据合并失败，回退到时间戳策略',
        mergeError: error.message
      }
    }
  }

  /**
   * 合并数据
   */
  async mergeData(pcData, wechatData, conflictFields) {
    const mergedData = { ...pcData }
    
    for (const conflictField of conflictFields) {
      const { field, pcValue, wechatValue } = conflictField
      
      // 根据字段类型决定如何合并
      switch (conflictField.fieldType) {
        case 'number':
          mergedData[field] = this.mergeNumbers(pcValue, wechatValue)
          break
        case 'string':
          mergedData[field] = this.mergeStrings(pcValue, wechatValue)
          break
        case 'array':
          mergedData[field] = this.mergeArrays(pcValue, wechatValue)
          break
        case 'datetime':
          mergedData[field] = this.mergeDates(pcValue, wechatValue)
          break
        default:
          // 默认使用较新的值
          mergedData[field] = this.getNewerValue(pcValue, wechatValue, pcData, wechatData)
      }
    }
    
    return mergedData
  }

  /**
   * 合并数字
   */
  mergeNumbers(pcValue, wechatValue) {
    return Math.max(pcValue, wechatValue) // 取最大值
  }

  /**
   * 合并字符串
   */
  mergeStrings(pcValue, wechatValue) {
    if (pcValue.length > wechatValue.length) {
      return pcValue
    }
    return wechatValue // 取较长的字符串
  }

  /**
   * 合并数组
   */
  mergeArrays(pcValue, wechatValue) {
    const merged = [...new Set([...pcValue, ...wechatValue])]
    return merged
  }

  /**
   * 合并日期
   */
  mergeDates(pcValue, wechatValue) {
    return this.getNewerValue(pcValue, wechatValue, { updatedAt: pcValue }, { updatedAt: wechatValue })
  }

  /**
   * 获取较新的值
   */
  getNewerValue(pcValue, wechatValue, pcData, wechatData) {
    const pcTimestamp = new Date(pcData.updatedAt || pcData.createdAt).getTime()
    const wechatTimestamp = new Date(wechatData.updatedAt || wechatData.createdAt).getTime()
    
    return pcTimestamp > wechatTimestamp ? pcValue : wechatValue
  }
}

/**
 * 手动策略 - 需要人工干预
 */
class ManualStrategy {
  async resolve(conflict, options = {}) {
    // 标记为需要手动解决
    return {
      strategy: 'manual',
      winner: 'pending',
      resolvedData: null,
      reason: '需要人工干预解决',
      details: {
        conflictFields: conflict.conflictFields,
        requiresManualReview: true,
        suggestedAction: '请联系管理员手动解决此冲突'
      }
    }
  }
}

// 创建单例实例
const conflictResolutionService = new ConflictResolutionService()

export default conflictResolutionService