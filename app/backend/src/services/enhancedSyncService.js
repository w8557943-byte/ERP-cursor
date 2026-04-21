import axios from 'axios'
import mongoose from 'mongoose'
import Order from '../models/Order.js'
import Customer from '../models/Customer.js'
import Product from '../models/Product.js'
import ProductionOrder from '../models/ProductionOrder.js'
import { logger } from '../utils/logger.js'
import dataMappingService from './dataMappingService.js'

/**
 * 增强版数据同步服务
 * 实现PC端MongoDB与小程序云开发数据库的双向同步
 * 支持增量同步、冲突解决、数据一致性检查
 */
class EnhancedSyncService {
  constructor() {
    this.baseUrl = process.env.WECHAT_CLOUDBASE_URL || 'https://your-cloudbase-url.com'
    this.apiKey = process.env.WECHAT_API_KEY || 'your-api-key'
    this.syncStatus = {
      lastSync: null,
      isSyncing: false,
      syncError: null,
      syncStats: {
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
        conflictResolutions: 0
      }
    }
    this.syncConfig = {
      batchSize: 100,
      retryAttempts: 3,
      retryDelay: 1000,
      conflictResolutionStrategy: 'timestamp', // timestamp, version, server_wins
      enableRealTimeSync: true,
      syncInterval: 5 * 60 * 1000 // 5分钟
    }
    this._periodicSyncTimer = null
  }

  /**
   * 初始化同步服务
   */
  async initialize() {
    try {
      logger.info('[增强同步] 初始化同步服务...')
      
      // 创建同步日志集合
      await this.createSyncLogCollection()
      
      // 启动定时同步
      if (this.syncConfig.enableRealTimeSync) {
        this.startPeriodicSync()
      }
      
      logger.info('[增强同步] 同步服务初始化完成')
      return { success: true, message: '同步服务初始化成功' }
    } catch (error) {
      logger.error('[增强同步] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 创建同步日志集合
   */
  async createSyncLogCollection() {
    const collections = ['sync_logs', 'sync_conflicts', 'sync_errors']
    
    for (const collectionName of collections) {
      try {
        const collections = await mongoose.connection.db.listCollections({ name: collectionName }).toArray()
        if (collections.length === 0) {
          await mongoose.connection.db.createCollection(collectionName)
          logger.info(`[增强同步] 创建集合: ${collectionName}`)
        }
      } catch (error) {
        logger.warn(`[增强同步] 创建集合 ${collectionName} 失败:`, error.message)
      }
    }
  }

  /**
   * 启动定时同步
   */
  startPeriodicSync() {
    if (process.env.NODE_ENV === 'test') {
      return
    }
    if (this._periodicSyncTimer) return
    this._periodicSyncTimer = setInterval(async () => {
      try {
        if (!this.syncStatus.isSyncing) {
          await this.performIncrementalSync()
        }
      } catch (error) {
        logger.error('[增强同步] 定时同步失败:', error)
      }
    }, this.syncConfig.syncInterval)
    
    logger.info('[增强同步] 定时同步已启动')
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
  async performIncrementalSync() {
    try {
      this.syncStatus.isSyncing = true
      this.syncStatus.syncError = null
      
      logger.info('[增强同步] 开始增量同步...')
      
      const lastSyncTime = this.syncStatus.lastSync || new Date(Date.now() - 24 * 60 * 60 * 1000)
      
      // 同步各个业务模块
      const syncResults = {}
      
      // 1. 同步订单数据
      syncResults.orders = await this.syncOrdersIncremental(lastSyncTime)
      
      // 2. 同步客户数据
      syncResults.customers = await this.syncCustomersIncremental(lastSyncTime)
      
      // 3. 同步产品数据
      syncResults.products = await this.syncProductsIncremental(lastSyncTime)
      
      // 4. 同步生产订单数据
      syncResults.productionOrders = await this.syncProductionOrdersIncremental(lastSyncTime)
      
      this.syncStatus.lastSync = new Date().toISOString()
      this.syncStatus.isSyncing = false
      
      logger.info('[增强同步] 增量同步完成:', syncResults)
      
      // 记录同步日志
      await this.logSyncOperation('incremental_sync', syncResults)
      
      return {
        success: true,
        message: '增量同步完成',
        data: syncResults,
        timestamp: this.syncStatus.lastSync
      }
      
    } catch (error) {
      this.syncStatus.isSyncing = false
      this.syncStatus.syncError = error.message
      
      logger.error('[增强同步] 增量同步失败:', error)
      
      // 记录错误日志
      await this.logSyncError('incremental_sync', error)
      
      throw error
    }
  }

  /**
   * 订单增量同步
   */
  async syncOrdersIncremental(sinceTimestamp) {
    try {
      // 获取小程序端的变更数据
      const wechatChanges = await this.getWechatChanges('orders', sinceTimestamp)
      
      // 获取PC端的变更数据
      const pcChanges = await this.getPCChanges('orders', sinceTimestamp)
      
      // 检测冲突
      const conflicts = await this.detectConflicts(wechatChanges, pcChanges)
      
      // 解决冲突
      const resolvedChanges = await this.resolveConflicts(conflicts)
      
      // 应用变更
      const applyResults = await this.applyChanges('orders', resolvedChanges)
      
      return {
        success: true,
        wechatChanges: wechatChanges.length,
        pcChanges: pcChanges.length,
        conflicts: conflicts.length,
        resolved: applyResults.resolved,
        applied: applyResults.applied
      }
      
    } catch (error) {
      logger.error('[增强同步] 订单增量同步失败:', error)
      throw error
    }
  }

  /**
   * 客户增量同步
   */
  async syncCustomersIncremental(sinceTimestamp) {
    try {
      const wechatChanges = await this.getWechatChanges('customers', sinceTimestamp)
      const pcChanges = await this.getPCChanges('customers', sinceTimestamp)
      const conflicts = await this.detectConflicts(wechatChanges, pcChanges)
      const resolvedChanges = await this.resolveConflicts(conflicts)
      const applyResults = await this.applyChanges('customers', resolvedChanges)
      
      return {
        success: true,
        wechatChanges: wechatChanges.length,
        pcChanges: pcChanges.length,
        conflicts: conflicts.length,
        resolved: applyResults.resolved,
        applied: applyResults.applied
      }
      
    } catch (error) {
      logger.error('[增强同步] 客户增量同步失败:', error)
      throw error
    }
  }

  /**
   * 产品增量同步
   */
  async syncProductsIncremental(sinceTimestamp) {
    try {
      const wechatChanges = await this.getWechatChanges('products', sinceTimestamp)
      const pcChanges = await this.getPCChanges('products', sinceTimestamp)
      const conflicts = await this.detectConflicts(wechatChanges, pcChanges)
      const resolvedChanges = await this.resolveConflicts(conflicts)
      const applyResults = await this.applyChanges('products', resolvedChanges)
      
      return {
        success: true,
        wechatChanges: wechatChanges.length,
        pcChanges: pcChanges.length,
        conflicts: conflicts.length,
        resolved: applyResults.resolved,
        applied: applyResults.applied
      }
      
    } catch (error) {
      logger.error('[增强同步] 产品增量同步失败:', error)
      throw error
    }
  }

  /**
   * 生产订单增量同步
   */
  async syncProductionOrdersIncremental(sinceTimestamp) {
    try {
      const wechatChanges = await this.getWechatChanges('production_orders', sinceTimestamp)
      const pcChanges = await this.getPCChanges('production_orders', sinceTimestamp)
      const conflicts = await this.detectConflicts(wechatChanges, pcChanges)
      const resolvedChanges = await this.resolveConflicts(conflicts)
      const applyResults = await this.applyChanges('production_orders', resolvedChanges)
      
      return {
        success: true,
        wechatChanges: wechatChanges.length,
        pcChanges: pcChanges.length,
        conflicts: conflicts.length,
        resolved: applyResults.resolved,
        applied: applyResults.applied
      }
      
    } catch (error) {
      logger.error('[增强同步] 生产订单增量同步失败:', error)
      throw error
    }
  }

  /**
   * 获取小程序端变更数据
   */
  async getWechatChanges(collection, sinceTimestamp) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/sync/query-changes`, {
        collection,
        sinceTimestamp,
        source: 'wechat'
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      })
      
      if (response.data.success) {
        const changes = response.data.data.changes || [];
        // 转换小程序端数据到PC端格式
        return changes.map(change => ({
          ...change,
          data: dataMappingService.convertWechatToPc(collection, change.data)
        }));
      } else {
        throw new Error(response.data.message || '获取小程序变更失败')
      }
      
    } catch (error) {
      logger.error(`[增强同步] 获取小程序${collection}变更失败:`, error)
      return []
    }
  }

  /**
   * 获取PC端变更数据
   */
  async getPCChanges(collection, sinceTimestamp) {
    try {
      let model
      switch (collection) {
        case 'orders':
          model = Order
          break
        case 'customers':
          model = Customer
          break
        case 'products':
          model = Product
          break
        case 'production_orders':
          model = ProductionOrder
          break
        default:
          return []
      }
      
      const changes = await model.find({
        updatedAt: { $gte: new Date(sinceTimestamp) }
      }).limit(1000).lean()
      
      return changes.map(doc => ({
        id: doc._id.toString(),
        operation: 'update',
        data: doc,
        timestamp: doc.updatedAt
      }))
      
    } catch (error) {
      logger.error(`[增强同步] 获取PC端${collection}变更失败:`, error)
      return []
    }
  }

  /**
   * 检测冲突
   */
  async detectConflicts(wechatChanges, pcChanges) {
    const conflicts = []
    const wechatMap = new Map(wechatChanges.map(change => [change.id, change]))
    const pcMap = new Map(pcChanges.map(change => [change.id, change]))
    
    // 检测相同记录的冲突
    for (const [id, wechatChange] of wechatMap) {
      if (pcMap.has(id)) {
        const pcChange = pcMap.get(id)
        conflicts.push({
          id,
          wechatChange,
          pcChange,
          conflictType: 'concurrent_modification'
        })
      }
    }
    
    return conflicts
  }

  /**
   * 解决冲突
   */
  async resolveConflicts(conflicts) {
    const resolved = []
    
    for (const conflict of conflicts) {
      try {
        const resolution = await this.resolveConflict(conflict)
        resolved.push(resolution)
      } catch (error) {
        logger.error('[增强同步] 解决冲突失败:', error)
        // 使用默认策略
        resolved.push({
          ...conflict,
          resolution: 'server_wins',
          resolvedData: conflict.pcChange.data
        })
      }
    }
    
    return resolved
  }

  /**
   * 解决单个冲突
   */
  async resolveConflict(conflict) {
    const { wechatChange, pcChange, conflictType } = conflict
    
    switch (this.syncConfig.conflictResolutionStrategy) {
      case 'timestamp':
        return this.resolveByTimestamp(conflict)
      case 'version':
        return this.resolveByVersion(conflict)
      case 'server_wins':
        return {
          ...conflict,
          resolution: 'server_wins',
          resolvedData: pcChange.data
        }
      case 'client_wins':
        return {
          ...conflict,
          resolution: 'client_wins',
          resolvedData: wechatChange.data
        }
      default:
        return this.resolveByTimestamp(conflict)
    }
  }

  /**
   * 按时间戳解决冲突
   */
  async resolveByTimestamp(conflict) {
    const { wechatChange, pcChange } = conflict
    const wechatTime = new Date(wechatChange.timestamp).getTime()
    const pcTime = new Date(pcChange.timestamp).getTime()
    
    const winner = wechatTime > pcTime ? 'wechat' : 'pc'
    const resolvedData = winner === 'wechat' ? wechatChange.data : pcChange.data
    
    return {
      ...conflict,
      resolution: `timestamp_${winner}`,
      resolvedData,
      reason: `${winner}端时间戳更新`
    }
  }

  /**
   * 按版本号解决冲突
   */
  async resolveByVersion(conflict) {
    const { wechatChange, pcChange } = conflict
    const wechatVersion = wechatChange.data._version || 1
    const pcVersion = pcChange.data._version || 1
    
    const winner = wechatVersion > pcVersion ? 'wechat' : 'pc'
    const resolvedData = winner === 'wechat' ? wechatChange.data : pcChange.data
    
    return {
      ...conflict,
      resolution: `version_${winner}`,
      resolvedData,
      reason: `${winner}端版本号更高`
    }
  }

  /**
   * 应用变更
   */
  async applyChanges(collection, changes) {
    let applied = 0
    let resolved = 0
    
    for (const change of changes) {
      try {
        if (change.resolution) {
          // 应用冲突解决结果
          await this.applyConflictResolution(collection, change)
          resolved++
        } else {
          // 应用普通变更
          await this.applySingleChange(collection, change)
        }
        applied++
        
      } catch (error) {
        logger.error(`[增强同步] 应用变更失败: ${collection}`, error)
        // 记录失败但继续处理其他变更
      }
    }
    
    return { applied, resolved }
  }

  /**
   * 应用冲突解决结果
   */
  async applyConflictResolution(collection, conflictResolution) {
    const { id, resolution, resolvedData } = conflictResolution
    
    // 更新两端的数据
    await Promise.all([
      this.updatePCRecord(collection, id, resolvedData),
      this.updateWechatRecord(collection, id, resolvedData)
    ])
    
    // 记录冲突解决日志
    await this.logConflictResolution(conflictResolution)
  }

  /**
   * 应用单个变更
   */
  async applySingleChange(collection, change) {
    const { id, operation, data, source } = change
    
    if (source === 'wechat') {
      // 从小程序端到PC端
      await this.updatePCRecord(collection, id, data)
    } else {
      // 从PC端到小程序端
      await this.updateWechatRecord(collection, id, data)
    }
  }

  /**
   * 更新PC端记录
   */
  async updatePCRecord(collection, id, data) {
    let model
    switch (collection) {
      case 'orders':
        model = Order
        break
      case 'customers':
        model = Customer
        break
      case 'products':
        model = Product
        break
      case 'production_orders':
        model = ProductionOrder
        break
      default:
        throw new Error(`未知的集合: ${collection}`)
    }
    
    await model.findByIdAndUpdate(id, data, { upsert: true })
  }

  /**
   * 更新小程序端记录
   */
  async updateWechatRecord(collection, id, data) {
    // 转换PC端数据到小程序端格式
    const wechatData = dataMappingService.convertPcToWechat(collection, data);
    
    // 调用小程序云函数更新数据
    await axios.post(`${this.baseUrl}/api/sync/update-record`, {
      collection,
      id,
      data: wechatData
    }, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    })
  }

  /**
   * 记录同步操作日志
   */
  async logSyncOperation(operationType, results) {
    try {
      const logEntry = {
        operationType,
        timestamp: new Date(),
        results,
        syncStats: { ...this.syncStatus.syncStats }
      }
      
      await mongoose.connection.db.collection('sync_logs').insertOne(logEntry)
    } catch (error) {
      logger.error('[增强同步] 记录同步日志失败:', error)
    }
  }

  /**
   * 记录同步错误
   */
  async logSyncError(operationType, error) {
    try {
      const errorEntry = {
        operationType,
        timestamp: new Date(),
        error: error.message,
        stack: error.stack,
        syncStats: { ...this.syncStatus.syncStats }
      }
      
      await mongoose.connection.db.collection('sync_errors').insertOne(errorEntry)
    } catch (logError) {
      logger.error('[增强同步] 记录错误日志失败:', logError)
    }
  }

  /**
   * 记录冲突解决
   */
  async logConflictResolution(conflictResolution) {
    try {
      const logEntry = {
        timestamp: new Date(),
        conflictId: conflictResolution.id,
        conflictType: conflictResolution.conflictType,
        resolution: conflictResolution.resolution,
        reason: conflictResolution.reason,
        resolvedData: conflictResolution.resolvedData
      }
      
      await mongoose.connection.db.collection('sync_conflicts').insertOne(logEntry)
      
      this.syncStatus.syncStats.conflictResolutions++
    } catch (error) {
      logger.error('[增强同步] 记录冲突解决日志失败:', error)
    }
  }

  /**
   * 获取同步状态
   */
  getSyncStatus() {
    return {
      ...this.syncStatus,
      canSync: !this.syncStatus.isSyncing,
      config: this.syncConfig
    }
  }

  /**
   * 执行完整数据一致性检查
   */
  async performConsistencyCheck() {
    try {
      logger.info('[增强同步] 开始数据一致性检查...')
      
      const results = {}
      
      // 检查各个集合的数据一致性
      results.orders = await this.checkCollectionConsistency('orders')
      results.customers = await this.checkCollectionConsistency('customers')
      results.products = await this.checkCollectionConsistency('products')
      results.productionOrders = await this.checkCollectionConsistency('production_orders')
      
      logger.info('[增强同步] 数据一致性检查完成:', results)
      
      return {
        success: true,
        message: '数据一致性检查完成',
        data: results
      }
      
    } catch (error) {
      logger.error('[增强同步] 数据一致性检查失败:', error)
      throw error
    }
  }

  /**
   * 检查集合数据一致性
   */
  async checkCollectionConsistency(collection) {
    try {
      // 获取PC端数据数量
      let pcCount = 0
      switch (collection) {
        case 'orders':
          pcCount = await Order.countDocuments()
          break
        case 'customers':
          pcCount = await Customer.countDocuments()
          break
        case 'products':
          pcCount = await Product.countDocuments()
          break
        case 'production_orders':
          pcCount = await ProductionOrder.countDocuments()
          break
      }
      
      // 获取小程序端数据数量
      const wechatCount = await this.getWechatCollectionCount(collection)
      
      return {
        collection,
        pcCount,
        wechatCount,
        difference: Math.abs(pcCount - wechatCount),
        consistent: pcCount === wechatCount
      }
      
    } catch (error) {
      logger.error(`[增强同步] 检查${collection}一致性失败:`, error)
      return {
        collection,
        error: error.message,
        consistent: false
      }
    }
  }

  /**
   * 同步所有数据（全量同步）
   */
  async syncAllData(options = {}) {
    try {
      logger.info('[增强同步] 开始全量数据同步...')
      
      this.syncStatus.isSyncing = true
      this.syncStatus.syncError = null
      
      const syncResults = {}
      
      // 1. 同步订单数据
      logger.info('[增强同步] 同步订单数据...')
      syncResults.orders = await this.syncCollectionFull('orders')
      
      // 2. 同步客户数据
      logger.info('[增强同步] 同步客户数据...')
      syncResults.customers = await this.syncCollectionFull('customers')
      
      // 3. 同步产品数据
      logger.info('[增强同步] 同步产品数据...')
      syncResults.products = await this.syncCollectionFull('products')
      
      // 4. 同步生产订单数据
      logger.info('[增强同步] 同步生产订单数据...')
      syncResults.productionOrders = await this.syncCollectionFull('production_orders')
      
      this.syncStatus.lastSync = new Date().toISOString()
      this.syncStatus.isSyncing = false
      
      // 记录同步日志
      await this.logSyncOperation('full_sync', syncResults)
      
      logger.info('[增强同步] 全量数据同步完成:', syncResults)
      
      return {
        success: true,
        message: '全量数据同步完成',
        data: syncResults,
        timestamp: this.syncStatus.lastSync
      }
      
    } catch (error) {
      this.syncStatus.isSyncing = false
      this.syncStatus.syncError = error.message
      
      logger.error('[增强同步] 全量数据同步失败:', error)
      
      // 记录错误日志
      await this.logSyncError('full_sync', error)
      
      throw error
    }
  }

  /**
   * 全量同步单个集合
   */
  async syncCollectionFull(collection) {
    try {
      let model
      switch (collection) {
        case 'orders':
          model = Order
          break
        case 'customers':
          model = Customer
          break
        case 'products':
          model = Product
          break
        case 'production_orders':
          model = ProductionOrder
          break
        default:
          throw new Error(`未知的集合: ${collection}`)
      }
      
      // 获取PC端所有数据
      const pcData = await model.find({}).lean()
      
      // 获取小程序端所有数据
      const wechatData = await this.getWechatCollectionData(collection)
      
      // 检测冲突
      const conflicts = await this.detectConflictsFull(pcData, wechatData)
      
      // 解决冲突
      const resolvedData = await this.resolveConflictsFull(conflicts)
      
      // 应用数据
      const applyResults = await this.applyFullSyncChanges(collection, resolvedData)
      
      return {
        success: true,
        pcCount: pcData.length,
        wechatCount: wechatData.length,
        conflicts: conflicts.length,
        resolved: resolvedData.length,
        applied: applyResults.applied
      }
      
    } catch (error) {
      logger.error(`[增强同步] 全量同步${collection}失败:`, error)
      throw error
    }
  }

  /**
   * 全量检测冲突
   */
  async detectConflictsFull(pcData, wechatData) {
    const conflicts = []
    const pcMap = new Map(pcData.map(item => [item._id.toString(), item]))
    const wechatMap = new Map(wechatData.map(item => [item._id.toString(), item]))
    
    // 检测相同ID的冲突
    for (const [id, pcItem] of pcMap) {
      if (wechatMap.has(id)) {
        const wechatItem = wechatMap.get(id)
        conflicts.push({
          id,
          pcData: pcItem,
          wechatData: wechatItem,
          conflictType: 'data_mismatch'
        })
      }
    }
    
    // 检测PC端有但小程序端没有的数据
    for (const [id, pcItem] of pcMap) {
      if (!wechatMap.has(id)) {
        conflicts.push({
          id,
          pcData: pcItem,
          wechatData: null,
          conflictType: 'missing_in_wechat'
        })
      }
    }
    
    // 检测小程序端有但PC端没有的数据
    for (const [id, wechatItem] of wechatMap) {
      if (!pcMap.has(id)) {
        conflicts.push({
          id,
          pcData: null,
          wechatData: wechatItem,
          conflictType: 'missing_in_pc'
        })
      }
    }
    
    return conflicts
  }

  /**
   * 全量解决冲突
   */
  async resolveConflictsFull(conflicts) {
    const resolved = []
    
    for (const conflict of conflicts) {
      try {
        const resolution = await this.resolveConflictFull(conflict)
        resolved.push(resolution)
      } catch (error) {
        logger.error('[增强同步] 解决全量冲突失败:', error)
        // 使用默认策略
        resolved.push({
          ...conflict,
          resolution: conflict.pcData ? 'server_wins' : 'client_wins',
          resolvedData: conflict.pcData || conflict.wechatData
        })
      }
    }
    
    return resolved
  }

  /**
   * 解决单个全量冲突
   */
  async resolveConflictFull(conflict) {
    const { pcData, wechatData, conflictType } = conflict
    
    switch (conflictType) {
      case 'missing_in_wechat':
        return {
          ...conflict,
          resolution: 'add_to_wechat',
          resolvedData: pcData
        }
      case 'missing_in_pc':
        return {
          ...conflict,
          resolution: 'add_to_pc',
          resolvedData: wechatData
        }
      case 'data_mismatch':
        return this.resolveByTimestamp(conflict)
      default:
        return {
          ...conflict,
          resolution: 'server_wins',
          resolvedData: pcData || wechatData
        }
    }
  }

  /**
   * 应用全量同步变更
   */
  async applyFullSyncChanges(collection, resolvedData) {
    let applied = 0
    
    for (const resolution of resolvedData) {
      try {
        await this.applyFullSyncResolution(collection, resolution)
        applied++
      } catch (error) {
        logger.error(`[增强同步] 应用全量同步变更失败: ${collection}`, error)
      }
    }
    
    return { applied }
  }

  /**
   * 应用全量同步解决结果
   */
  async applyFullSyncResolution(collection, resolution) {
    const { id, resolution: resolutionType, resolvedData } = resolution
    
    switch (resolutionType) {
      case 'add_to_wechat':
        await this.addToWechatCollection(collection, resolvedData)
        break
      case 'add_to_pc':
        await this.addToPCCollection(collection, resolvedData)
        break
      case 'timestamp_wechat':
      case 'timestamp_pc':
      case 'server_wins':
        await this.updatePCRecord(collection, id, resolvedData)
        await this.updateWechatRecord(collection, id, resolvedData)
        break
      default:
        await this.updatePCRecord(collection, id, resolvedData)
    }
  }

  /**
   * 添加到PC端集合
   */
  async addToPCCollection(collection, data) {
    let model
    switch (collection) {
      case 'orders':
        model = Order
        break
      case 'customers':
        model = Customer
        break
      case 'products':
        model = Product
        break
      case 'production_orders':
        model = ProductionOrder
        break
      default:
        throw new Error(`未知的集合: ${collection}`)
    }
    
    const newData = { ...data }
    delete newData._id // 移除原有的ID，让MongoDB生成新的
    
    await model.create(newData)
  }

  /**
   * 添加到小程序端集合
   */
  async addToWechatCollection(collection, data) {
    await axios.post(`${this.baseUrl}/api/sync/add-record`, {
      collection,
      data
    }, {
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      }
    })
  }

  /**
   * 获取小程序端集合数据
   */
  async getWechatCollectionData(collection) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/sync/collection-data`, {
        collection
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      })
      
      if (response.data.success) {
        return response.data.data || []
      }
      
      return []
    } catch (error) {
      logger.error(`[增强同步] 获取小程序${collection}数据失败:`, error)
      return []
    }
  }

  /**
   * 获取小程序端集合数量
   */
  async getWechatCollectionCount(collection) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/sync/collection-count`, {
        collection
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      })
      
      if (response.data.success) {
        return response.data.data.count || 0
      }
      
      return 0
    } catch (error) {
      logger.error(`[增强同步] 获取小程序${collection}数量失败:`, error)
      return 0
    }
  }
}

// 创建单例实例
const enhancedSyncService = new EnhancedSyncService()

export default enhancedSyncService
