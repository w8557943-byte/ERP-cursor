import mongoose from 'mongoose'
import { logger } from '../utils/logger.js'
import Order from '../models/Order.js'
import Customer from '../models/Customer.js'
import Product from '../models/Product.js'
import ProductionOrder from '../models/ProductionOrder.js'
import dataMappingService from './dataMappingService.js'
import axios from 'axios'

/**
 * 数据一致性检查服务
 * 定期检查PC端MongoDB与小程序云开发数据库的数据一致性
 * 支持自动修复数据差异
 */
class ConsistencyCheckService {
  constructor() {
    this.baseUrl = process.env.WECHAT_CLOUDBASE_URL || 'https://your-cloudbase-url.com'
    this.apiKey = process.env.WECHAT_API_KEY || 'your-api-key'
    this.checkConfig = {
      enableAutoCheck: true,
      checkInterval: 60 * 60 * 1000, // 1小时
      batchSize: 1000,
      maxRetries: 3,
      retryDelay: 5000,
      enableAutoFix: true, // 是否自动修复差异
      fixThreshold: 10, // 差异数量阈值，超过此数量不自动修复
      checkTypes: ['count', 'content', 'structure', 'timestamp'] // 检查类型
    }
    this.checkStatus = {
      isChecking: false,
      lastCheck: null,
      lastCheckResults: null,
      checkErrors: []
    }
    this._periodicCheckTimer = null
  }

  /**
   * 初始化一致性检查服务
   */
  async initialize() {
    try {
      logger.info('[一致性检查] 初始化服务...')
      
      // 创建一致性检查日志集合
      await this.createConsistencyCheckCollections()
      
      // 启动定时检查
      if (this.checkConfig.enableAutoCheck) {
        this.startPeriodicChecks()
      }
      
      logger.info('[一致性检查] 服务初始化完成')
      return { success: true, message: '一致性检查服务初始化成功' }
      
    } catch (error) {
      logger.error('[一致性检查] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 创建一致性检查日志集合
   */
  async createConsistencyCheckCollections() {
    const collections = ['consistency_check_logs', 'consistency_differences', 'consistency_fix_logs']
    
    for (const collectionName of collections) {
      try {
        const collections = await mongoose.connection.db.listCollections({ name: collectionName }).toArray()
        if (collections.length === 0) {
          await mongoose.connection.db.createCollection(collectionName)
          logger.info(`[一致性检查] 创建集合: ${collectionName}`)
        }
      } catch (error) {
        logger.warn(`[一致性检查] 创建集合 ${collectionName} 失败:`, error.message)
      }
    }
  }

  /**
   * 启动定时检查
   */
  startPeriodicChecks() {
    if (process.env.NODE_ENV === 'test') {
      return
    }
    if (this._periodicCheckTimer) return
    this._periodicCheckTimer = setInterval(async () => {
      try {
        if (!this.checkStatus.isChecking) {
          await this.performConsistencyCheck()
        }
      } catch (error) {
        logger.error('[一致性检查] 定时检查失败:', error)
      }
    }, this.checkConfig.checkInterval)
    
    logger.info('[一致性检查] 定时检查已启动')
  }

  async stop() {
    if (this._periodicCheckTimer) {
      clearInterval(this._periodicCheckTimer)
      this._periodicCheckTimer = null
    }
    return { success: true }
  }

  /**
   * 执行完整的一致性检查
   */
  async performConsistencyCheck() {
    try {
      this.checkStatus.isChecking = true
      this.checkStatus.checkErrors = []
      
      logger.info('[一致性检查] 开始执行一致性检查...')
      
      const startTime = Date.now()
      const results = {
        overall: {
          status: 'checking',
          startTime: new Date().toISOString(),
          endTime: null,
          duration: null,
          totalDifferences: 0,
          autoFixed: 0
        },
        collections: {}
      }
      
      // 检查各个集合
      const collections = ['orders', 'customers', 'products', 'production_orders']
      
      for (const collection of collections) {
        try {
          const collectionResult = await this.checkCollectionConsistency(collection)
          results.collections[collection] = collectionResult
          results.overall.totalDifferences += collectionResult.differences.length
          
        } catch (error) {
          logger.error(`[一致性检查] 检查${collection}失败:`, error)
          results.collections[collection] = {
            status: 'error',
            error: error.message
          }
          this.checkStatus.checkErrors.push({ collection, error: error.message })
        }
      }

      // 5. 检查订单-生产数据一致性 (新增)
      try {
        const opResult = await this.checkOrderProductionConsistency()
        results.collections['order_production'] = {
          status: 'success',
          ...opResult
        }
        if (opResult.hasDifference) {
          results.overall.totalDifferences += opResult.differences.length
          // 将差异添加到 checkErrors 中以便状态显示为 partial_success (可选，视严重程度而定)
          // this.checkStatus.checkErrors.push({ collection: 'order_production', error: 'Found inconsistencies' }) 
        }
      } catch (error) {
        logger.error('[一致性检查] 订单-生产一致性检查失败:', error)
        results.collections['order_production'] = {
          status: 'error',
          error: error.message
        }
        this.checkStatus.checkErrors.push({ collection: 'order_production', error: error.message })
      }
      
      // 自动修复差异（如果启用）
      if (this.checkConfig.enableAutoFix && results.overall.totalDifferences > 0) {
        const fixResults = await this.autoFixDifferences(results)
        results.overall.autoFixed = fixResults.fixed
      }
      
      // 完成检查
      const endTime = Date.now()
      results.overall.endTime = new Date().toISOString()
      results.overall.duration = endTime - startTime
      results.overall.status = this.checkStatus.checkErrors.length > 0 ? 'partial_success' : 'success'
      
      this.checkStatus.lastCheck = new Date().toISOString()
      this.checkStatus.lastCheckResults = results
      this.checkStatus.isChecking = false
      
      // 记录检查日志
      await this.logConsistencyCheck(results)
      
      logger.info('[一致性检查] 检查完成:', results)
      
      return {
        success: true,
        message: '一致性检查完成',
        data: results
      }
      
    } catch (error) {
      this.checkStatus.isChecking = false
      logger.error('[一致性检查] 检查失败:', error)
      throw error
    }
  }

  /**
   * 检查订单-生产数据一致性
   * 每日扫描近7日订单，比对材质编码、物料号、纸板尺寸三核心字段
   */
  async checkOrderProductionConsistency() {
    try {
      logger.info('[一致性检查] 开始检查订单-生产数据一致性...')
      const days = 7
      const startDate = new Date()
      startDate.setDate(startDate.getDate() - days)

      // 查找近7日未删除的订单
      const orders = await Order.find({
        createdAt: { $gte: startDate },
        isDeleted: { $ne: true }
      }).lean()

      const differences = []
      let checkedCount = 0

      for (const order of orders) {
        // 查找对应的生产工单
        const prodOrder = await ProductionOrder.findOne({ orderId: order._id }).lean()
        
        if (!prodOrder) continue // 无生产单跳过
        checkedCount++

        // 比对字段
        const fields = [
          { key: 'materialCode', label: '材质编码' },
          { key: 'materialNo', label: '物料号' },
          { key: 'boardSize', label: '纸板尺寸' }
        ]

        for (const field of fields) {
           const orderVal = String(order[field.key] || '').trim()
           const prodVal = String(prodOrder[field.key] || '').trim()
           
           if (orderVal !== prodVal) {
             differences.push({
               type: 'order_production_mismatch',
               severity: 'high',
               description: `订单与生产单${field.label}不一致`,
               recordId: order._id,
               orderNo: order.orderNo,
               productionOrderNo: prodOrder.productionNo,
               field: field.key,
               orderValue: orderVal,
               productionValue: prodVal
             })
           }
        }
      }

      logger.info(`[一致性检查] 订单-生产检查完成，扫描订单${orders.length}个，关联检查${checkedCount}个，发现差异${differences.length}处`)

      return {
        type: 'order_production',
        hasDifference: differences.length > 0,
        differences,
        checkedOrders: checkedCount
      }

    } catch (error) {
      logger.error('[一致性检查] 订单-生产一致性检查失败:', error)
      return {
        type: 'order_production',
        hasDifference: false,
        differences: [],
        error: error.message
      }
    }
  }

  /**
   * 检查单个集合的数据一致性
   */
  async checkCollectionConsistency(collection) {
    try {
      logger.info(`[一致性检查] 开始检查${collection}集合...`)
      
      const result = {
        collection,
        status: 'checking',
        startTime: new Date().toISOString(),
        endTime: null,
        duration: null,
        checks: {},
        differences: []
      }
      
      // 1. 数量一致性检查
      if (this.checkConfig.checkTypes.includes('count')) {
        result.checks.count = await this.checkCountConsistency(collection)
        if (result.checks.count.hasDifference) {
          result.differences.push(...result.checks.count.differences)
        }
      }
      
      // 2. 内容一致性检查
      if (this.checkConfig.checkTypes.includes('content')) {
        result.checks.content = await this.checkContentConsistency(collection)
        if (result.checks.content.hasDifference) {
          result.differences.push(...result.checks.content.differences)
        }
      }
      
      // 3. 结构一致性检查
      if (this.checkConfig.checkTypes.includes('structure')) {
        result.checks.structure = await this.checkStructureConsistency(collection)
        if (result.checks.structure.hasDifference) {
          result.differences.push(...result.checks.structure.differences)
        }
      }
      
      // 4. 时间戳一致性检查
      if (this.checkConfig.checkTypes.includes('timestamp')) {
        result.checks.timestamp = await this.checkTimestampConsistency(collection)
        if (result.checks.timestamp.hasDifference) {
          result.differences.push(...result.checks.timestamp.differences)
        }
      }
      
      result.endTime = new Date().toISOString()
      result.duration = Date.now() - new Date(result.startTime).getTime()
      result.status = 'success'
      
      return result
      
    } catch (error) {
      logger.error(`[一致性检查] 检查${collection}失败:`, error)
      return {
        collection,
        status: 'error',
        error: error.message
      }
    }
  }

  /**
   * 检查数量一致性
   */
  async checkCountConsistency(collection) {
    try {
      // 获取PC端数量
      const pcCount = await this.getPCCollectionCount(collection)
      
      // 获取小程序端数量
      const wechatCount = await this.getWechatCollectionCount(collection)
      
      const hasDifference = pcCount !== wechatCount
      const differences = []
      
      if (hasDifference) {
        const difference = Math.abs(pcCount - wechatCount)
        const missingSide = pcCount > wechatCount ? 'wechat' : 'pc'
        
        differences.push({
          type: 'count_difference',
          severity: 'medium',
          description: `数量不一致: PC端${pcCount}条，小程序端${wechatCount}条，相差${difference}条`,
          details: {
            pcCount,
            wechatCount,
            difference,
            missingSide
          }
        })
      }
      
      return {
        type: 'count',
        hasDifference,
        differences,
        pcCount,
        wechatCount
      }
      
    } catch (error) {
      logger.error(`[一致性检查] 检查${collection}数量一致性失败:`, error)
      return {
        type: 'count',
        hasDifference: false,
        differences: [],
        error: error.message
      }
    }
  }

  /**
   * 检查内容一致性
   */
  async checkContentConsistency(collection) {
    try {
      const differences = []
      
      // 获取PC端数据
      const pcData = await this.getPCCollectionData(collection)
      
      // 获取小程序端数据
      const wechatData = await this.getWechatCollectionData(collection)
      
      // 创建数据映射
      const pcMap = new Map(pcData.map(item => [item.id, item]))
      const wechatMap = new Map(wechatData.map(item => [item.id, item]))
      
      // 检查PC端存在但小程序端不存在的记录
      for (const [id, pcItem] of pcMap) {
        if (!wechatMap.has(id)) {
          differences.push({
            type: 'missing_in_wechat',
            severity: 'high',
            description: `PC端存在但小程序端缺失的记录`,
            recordId: id,
            data: pcItem
          })
        }
      }
      
      // 检查小程序端存在但PC端不存在的记录
      for (const [id, wechatItem] of wechatMap) {
        if (!pcMap.has(id)) {
          differences.push({
            type: 'missing_in_pc',
            severity: 'high',
            description: `小程序端存在但PC端缺失的记录`,
            recordId: id,
            data: wechatItem
          })
        }
      }
      
      // 检查内容不同的记录
      for (const [id, pcItem] of pcMap) {
        if (wechatMap.has(id)) {
          const wechatItem = wechatMap.get(id)
          // 使用数据映射服务检测差异
          const dataDiff = dataMappingService.detectDataDifferences(collection, pcItem, wechatItem)
          if (dataDiff.hasDifferences) {
            differences.push({
              type: 'content_difference',
              severity: 'medium',
              description: `记录内容不一致`,
              recordId: id,
              pcData: pcItem,
              wechatData: wechatItem,
              differences: dataDiff.differences
            })
          }
        }
      }
      
      return {
        type: 'content',
        hasDifference: differences.length > 0,
        differences,
        checkedRecords: Math.max(pcData.length, wechatData.length)
      }
      
    } catch (error) {
      logger.error(`[一致性检查] 检查${collection}内容一致性失败:`, error)
      return {
        type: 'content',
        hasDifference: false,
        differences: [],
        error: error.message
      }
    }
  }

  /**
   * 检查结构一致性
   */
  async checkStructureConsistency(collection) {
    try {
      const differences = []
      
      // 获取PC端数据结构
      const pcStructure = await this.getPCCollectionStructure(collection)
      
      // 获取小程序端数据结构
      const wechatStructure = await this.getWechatCollectionStructure(collection)
      
      // 比较字段定义
      const pcFields = new Set(Object.keys(pcStructure))
      const wechatFields = new Set(Object.keys(wechatStructure))
      
      // 检查PC端存在但小程序端不存在的字段
      for (const field of pcFields) {
        if (!wechatFields.has(field)) {
          differences.push({
            type: 'missing_field_in_wechat',
            severity: 'low',
            description: `PC端存在但小程序端缺失的字段`,
            field: field,
            pcType: pcStructure[field],
            wechatType: null
          })
        }
      }
      
      // 检查小程序端存在但PC端不存在的字段
      for (const field of wechatFields) {
        if (!pcFields.has(field)) {
          differences.push({
            type: 'missing_field_in_pc',
            severity: 'low',
            description: `小程序端存在但PC端缺失的字段`,
            field: field,
            pcType: null,
            wechatType: wechatStructure[field]
          })
        }
      }
      
      // 检查字段类型不一致
      for (const field of pcFields) {
        if (wechatFields.has(field)) {
          if (pcStructure[field] !== wechatStructure[field]) {
            differences.push({
              type: 'field_type_difference',
              severity: 'medium',
              description: `字段类型不一致`,
              field: field,
              pcType: pcStructure[field],
              wechatType: wechatStructure[field]
            })
          }
        }
      }
      
      return {
        type: 'structure',
        hasDifference: differences.length > 0,
        differences,
        pcFields: pcFields.size,
        wechatFields: wechatFields.size
      }
      
    } catch (error) {
      logger.error(`[一致性检查] 检查${collection}结构一致性失败:`, error)
      return {
        type: 'structure',
        hasDifference: false,
        differences: [],
        error: error.message
      }
    }
  }

  /**
   * 检查时间戳一致性
   */
  async checkTimestampConsistency(collection) {
    try {
      const differences = []
      
      // 获取PC端最新时间戳
      const pcLatestTimestamp = await this.getPCLatestTimestamp(collection)
      
      // 获取小程序端最新时间戳
      const wechatLatestTimestamp = await this.getWechatLatestTimestamp(collection)
      
      // 检查时间戳差异
      const timeDifference = Math.abs(pcLatestTimestamp.getTime() - wechatLatestTimestamp.getTime())
      const maxAllowedDifference = 5 * 60 * 1000 // 5分钟
      
      if (timeDifference > maxAllowedDifference) {
        differences.push({
          type: 'timestamp_difference',
          severity: 'low',
          description: `最新记录时间戳差异过大`,
          pcLatestTimestamp,
          wechatLatestTimestamp,
          timeDifference,
          maxAllowedDifference
        })
      }
      
      return {
        type: 'timestamp',
        hasDifference: differences.length > 0,
        differences,
        pcLatestTimestamp,
        wechatLatestTimestamp
      }
      
    } catch (error) {
      logger.error(`[一致性检查] 检查${collection}时间戳一致性失败:`, error)
      return {
        type: 'timestamp',
        hasDifference: false,
        differences: [],
        error: error.message
      }
    }
  }

  /**
   * 获取PC端集合数量
   */
  async getPCCollectionCount(collection) {
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
        return 0
    }
    
    return await model.countDocuments()
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
      logger.error(`[一致性检查] 获取小程序${collection}数量失败:`, error)
      return 0
    }
  }

  /**
   * 获取PC端集合数据
   */
  async getPCCollectionData(collection) {
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
    
    const data = await model.find().limit(this.checkConfig.batchSize).lean()
    return data.map(item => ({
      id: item._id.toString(),
      ...item,
      _id: item._id.toString()
    }))
  }

  /**
   * 获取小程序端集合数据
   */
  async getWechatCollectionData(collection) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/sync/collection-data`, {
        collection,
        limit: this.checkConfig.batchSize
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      })
      
      if (response.data.success) {
        const data = response.data.data || [];
        // 转换小程序端数据到PC端格式进行比较
        return data.map(item => ({
          ...dataMappingService.convertWechatToPc(collection, item),
          id: item.id || item._id
        }));
      }
      
      return []
    } catch (error) {
      logger.error(`[一致性检查] 获取小程序${collection}数据失败:`, error)
      return []
    }
  }

  /**
   * 获取PC端集合结构
   */
  async getPCCollectionStructure(collection) {
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
        return {}
    }
    
    const schema = model.schema
    const structure = {}
    
    for (const [path, schemaType] of Object.entries(schema.paths)) {
      if (path !== '_id' && path !== '__v') {
        structure[path] = schemaType.instance || 'Mixed'
      }
    }
    
    return structure
  }

  /**
   * 获取小程序端集合结构
   */
  async getWechatCollectionStructure(collection) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/sync/collection-structure`, {
        collection
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      })
      
      if (response.data.success) {
        return response.data.data || {}
      }
      
      return {}
    } catch (error) {
      logger.error(`[一致性检查] 获取小程序${collection}结构失败:`, error)
      return {}
    }
  }

  /**
   * 获取PC端最新时间戳
   */
  async getPCLatestTimestamp(collection) {
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
        return new Date(0)
    }
    
    const latest = await model.findOne().sort({ updatedAt: -1 }).select('updatedAt')
    return latest ? latest.updatedAt : new Date(0)
  }

  /**
   * 获取小程序端最新时间戳
   */
  async getWechatLatestTimestamp(collection) {
    try {
      const response = await axios.post(`${this.baseUrl}/api/sync/latest-timestamp`, {
        collection
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      })
      
      if (response.data.success) {
        const timestamp = new Date(response.data.data.timestamp)
        return Number.isNaN(timestamp.getTime()) ? new Date(0) : timestamp
      }
      
      return new Date(0)
    } catch (error) {
      logger.error(`[一致性检查] 获取小程序${collection}最新时间戳失败:`, error)
      return new Date(0)
    }
  }

  /**
   * 比较数据是否相等
   */
  isDataEqual(data1, data2) {
    // 简单的深度比较实现
    const str1 = JSON.stringify(data1)
    const str2 = JSON.stringify(data2)
    return str1 === str2
  }

  /**
   * 查找数据差异
   */
  findDataDifferences(data1, data2) {
    const differences = []
    const allKeys = new Set([...Object.keys(data1), ...Object.keys(data2)])
    
    for (const key of allKeys) {
      if (data1[key] !== data2[key]) {
        differences.push({
          field: key,
          pcValue: data1[key],
          wechatValue: data2[key]
        })
      }
    }
    
    return differences
  }

  /**
   * 自动修复差异
   */
  async autoFixDifferences(checkResults) {
    try {
      logger.info('[一致性检查] 开始自动修复差异...')
      
      const fixResults = {
        fixed: 0,
        failed: 0,
        skipped: 0,
        details: []
      }
      
      // 检查总差异数量是否超过阈值
      if (checkResults.overall.totalDifferences > this.checkConfig.fixThreshold) {
        logger.warn(`[一致性检查] 差异数量${checkResults.overall.totalDifferences}超过阈值${this.checkConfig.fixThreshold}，跳过自动修复`)
        return {
          fixed: 0,
          failed: 0,
          skipped: checkResults.overall.totalDifferences,
          reason: '差异数量超过阈值'
        }
      }
      
      // 修复各个集合的差异
      for (const [collection, collectionResult] of Object.entries(checkResults.collections)) {
        if (collectionResult.status === 'success' && collectionResult.differences.length > 0) {
          try {
            const collectionFixResults = await this.fixCollectionDifferences(collection, collectionResult.differences)
            fixResults.fixed += collectionFixResults.fixed
            fixResults.failed += collectionFixResults.failed
            fixResults.details.push({
              collection,
              ...collectionFixResults
            })
          } catch (error) {
            logger.error(`[一致性检查] 修复${collection}失败:`, error)
            fixResults.failed += collectionResult.differences.length
          }
        }
      }
      
      // 记录修复日志
      await this.logConsistencyFix(fixResults)
      
      logger.info('[一致性检查] 自动修复完成:', fixResults)
      return fixResults
      
    } catch (error) {
      logger.error('[一致性检查] 自动修复失败:', error)
      return {
        fixed: 0,
        failed: checkResults.overall.totalDifferences,
        skipped: 0,
        error: error.message
      }
    }
  }

  /**
   * 修复集合差异
   */
  async fixCollectionDifferences(collection, differences) {
    const fixResults = {
      fixed: 0,
      failed: 0,
      details: []
    }
    
    for (const difference of differences) {
      try {
        await this.fixSingleDifference(collection, difference)
        fixResults.fixed++
        fixResults.details.push({
          difference,
          status: 'fixed'
        })
      } catch (error) {
        logger.error(`[一致性检查] 修复差异失败:`, error)
        fixResults.failed++
        fixResults.details.push({
          difference,
          status: 'failed',
          error: error.message
        })
      }
    }
    
    return fixResults
  }

  /**
   * 修复单个差异
   */
  async fixSingleDifference(collection, difference) {
    switch (difference.type) {
      case 'missing_in_wechat':
        // 将PC端数据同步到小程序端
        await this.syncRecordToWechat(collection, difference.recordId, difference.data)
        break
      case 'missing_in_pc':
        // 将小程序端数据同步到PC端
        await this.syncRecordToPC(collection, difference.recordId, difference.data)
        break
      case 'content_difference':
        // 根据时间戳决定使用哪边的数据
        const winner = difference.pcData.updatedAt > difference.wechatData.updatedAt ? 'pc' : 'wechat'
        const winningData = winner === 'pc' ? difference.pcData : difference.wechatData
        
        // 同步到另一端
        if (winner === 'pc') {
          await this.syncRecordToWechat(collection, difference.recordId, winningData)
        } else {
          await this.syncRecordToPC(collection, difference.recordId, winningData)
        }
        break
      default:
        logger.warn(`[一致性检查] 未知的差异类型: ${difference.type}`)
    }
  }

  /**
   * 同步记录到小程序端
   */
  async syncRecordToWechat(collection, recordId, data) {
    try {
      await axios.post(`${this.baseUrl}/api/sync/create-or-update`, {
        collection,
        id: recordId,
        data
      }, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json'
        }
      })
    } catch (error) {
      logger.error(`[一致性检查] 同步到小程序端失败:`, error)
      throw error
    }
  }

  /**
   * 同步记录到PC端
   */
  async syncRecordToPC(collection, recordId, data) {
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
    
    await model.findByIdAndUpdate(recordId, data, { upsert: true })
  }

  /**
   * 记录一致性检查日志
   */
  async logConsistencyCheck(results) {
    try {
      const logEntry = {
        timestamp: new Date(),
        results,
        config: this.checkConfig,
        status: results.overall.status
      }
      
      await mongoose.connection.db.collection('consistency_check_logs').insertOne(logEntry)
    } catch (error) {
      logger.error('[一致性检查] 记录检查日志失败:', error)
    }
  }

  /**
   * 记录一致性修复日志
   */
  async logConsistencyFix(fixResults) {
    try {
      const logEntry = {
        timestamp: new Date(),
        fixResults,
        config: this.checkConfig
      }
      
      await mongoose.connection.db.collection('consistency_fix_logs').insertOne(logEntry)
    } catch (error) {
      logger.error('[一致性检查] 记录修复日志失败:', error)
    }
  }

  /**
   * 获取检查状态
   */
  getCheckStatus() {
    return {
      ...this.checkStatus,
      canCheck: !this.checkStatus.isChecking,
      config: this.checkConfig
    }
  }
}

// 创建单例实例
const consistencyCheckService = new ConsistencyCheckService()

export default consistencyCheckService
