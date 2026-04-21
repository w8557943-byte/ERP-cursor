import mongoose from 'mongoose'
import { logger } from '../utils/logger.js'
import { WebSocket } from 'ws'
import os from 'os'

/**
 * 同步监控服务
 * 实时监控PC端与小程序云开发数据同步状态
 * 提供性能监控、异常告警、状态展示等功能
 */
class SyncMonitorService {
  constructor() {
    this.monitorConfig = {
      enableRealTimeMonitoring: true,
      enablePerformanceMonitoring: true,
      enableAlertSystem: true,
      monitoringInterval: 30000, // 30秒
      performanceThresholds: {
        syncLatency: 5000, // 5秒
        syncSuccessRate: 95, // 95%
        conflictRate: 5, // 5%
        memoryUsage: 80, // 80%
        cpuUsage: 70 // 70%
      },
      alertConfig: {
        enableEmail: false,
        enableWebhook: true,
        enableDashboard: true,
        alertCooldown: 300000, // 5分钟
        severityLevels: ['info', 'warning', 'error', 'critical']
      }
    }
    
    this.monitorStatus = {
      isMonitoring: false,
      startTime: null,
      lastHealthCheck: null,
      systemStatus: 'healthy',
      activeAlerts: []
    }
    
    this.performanceMetrics = {
      syncOperations: {
        total: 0,
        successful: 0,
        failed: 0,
        conflicts: 0,
        averageLatency: 0,
        lastOperation: null
      },
      systemResources: {
        memoryUsage: 0,
        cpuUsage: 0,
        diskUsage: 0,
        networkLatency: 0
      },
      dataConsistency: {
        lastCheck: null,
        consistencyScore: 100,
        differences: 0,
        lastSyncTime: null
      }
    }
    
    this.websocketClients = new Set()
    this.alertHistory = []
    this.performanceHistory = []
    this._realTimeMonitoringTimer = null
    this._systemResourceMonitoringTimer = null
  }

  /**
   * 初始化监控服务
   */
  async initialize() {
    try {
      logger.info('[同步监控] 初始化监控服务...')
      
      // 创建监控数据集合
      await this.createMonitorCollections()
      
      // 启动系统资源监控
      if (this.monitorConfig.enablePerformanceMonitoring && process.env.NODE_ENV !== 'test') {
        this.startSystemResourceMonitoring()
      }
      
      // 启动实时数据监控
      if (this.monitorConfig.enableRealTimeMonitoring && process.env.NODE_ENV !== 'test') {
        this.startRealTimeMonitoring()
      }
      
      // 启动WebSocket服务器
      await this.startWebSocketServer()
      
      logger.info('[同步监控] 监控服务初始化完成')
      return { success: true, message: '监控服务初始化成功' }
      
    } catch (error) {
      logger.error('[同步监控] 初始化失败:', error)
      throw error
    }
  }

  /**
   * 创建监控数据集合
   */
  async createMonitorCollections() {
    const collections = [
      'sync_monitor_logs',
      'sync_performance_metrics',
      'sync_alerts',
      'sync_health_checks',
      'sync_statistics'
    ]
    
    for (const collectionName of collections) {
      try {
        const collections = await mongoose.connection.db.listCollections({ name: collectionName }).toArray()
        if (collections.length === 0) {
          await mongoose.connection.db.createCollection(collectionName)
          logger.info(`[同步监控] 创建集合: ${collectionName}`)
        }
      } catch (error) {
        logger.warn(`[同步监控] 创建集合 ${collectionName} 失败:`, error.message)
      }
    }
  }

  /**
   * 启动实时数据监控
   */
  startRealTimeMonitoring() {
    this.monitorStatus.isMonitoring = true
    this.monitorStatus.startTime = new Date()
    
    if (this._realTimeMonitoringTimer) return
    this._realTimeMonitoringTimer = setInterval(async () => {
      try {
        await this.performHealthCheck()
      } catch (error) {
        logger.error('[同步监控] 实时数据监控失败:', error)
      }
    }, this.monitorConfig.monitoringInterval)
    
    logger.info('[同步监控] 实时数据监控已启动')
  }

  /**
   * 启动系统资源监控
   */
  startSystemResourceMonitoring() {
    if (this._systemResourceMonitoringTimer) return
    this._systemResourceMonitoringTimer = setInterval(async () => {
      try {
        await this.collectSystemMetrics()
      } catch (error) {
        logger.error('[同步监控] 系统资源监控失败:', error)
      }
    }, 60000) // 1分钟
    
    logger.info('[同步监控] 系统资源监控已启动')
  }

  /**
   * 启动WebSocket服务器
   */
  async startWebSocketServer() {
    // WebSocket服务器将在需要时创建
    logger.info('[同步监控] WebSocket服务器准备就绪')
  }

  async stop() {
    this.monitorStatus.isMonitoring = false
    if (this._realTimeMonitoringTimer) {
      clearInterval(this._realTimeMonitoringTimer)
      this._realTimeMonitoringTimer = null
    }
    if (this._systemResourceMonitoringTimer) {
      clearInterval(this._systemResourceMonitoringTimer)
      this._systemResourceMonitoringTimer = null
    }
    return { success: true }
  }

  /**
   * 执行健康检查
   */
  async performHealthCheck() {
    try {
      const startTime = Date.now()
      
      // 检查数据库连接
      const dbHealth = await this.checkDatabaseHealth()
      
      // 检查同步服务状态
      const syncHealth = await this.checkSyncServiceHealth()
      
      // 检查系统资源
      const systemHealth = await this.checkSystemHealth()
      
      // 综合健康状态
      const overallHealth = this.calculateOverallHealth(dbHealth, syncHealth, systemHealth)
      
      // 更新监控状态
      this.monitorStatus.lastHealthCheck = new Date()
      this.monitorStatus.systemStatus = overallHealth.status
      
      // 记录健康检查日志
      await this.logHealthCheck({
        timestamp: new Date(),
        duration: Date.now() - startTime,
        status: overallHealth.status,
        details: {
          database: dbHealth,
          syncService: syncHealth,
          system: systemHealth
        }
      })
      
      // 检查是否需要告警
      if (this.monitorConfig.enableAlertSystem) {
        await this.checkAndTriggerAlerts(overallHealth)
      }
      
      // 广播状态更新
      this.broadcastStatusUpdate({
        type: 'health_check',
        data: {
          status: overallHealth.status,
          timestamp: new Date(),
          details: overallHealth
        }
      })
      
    } catch (error) {
      logger.error('[同步监控] 健康检查失败:', error)
      
      // 记录异常状态
      this.monitorStatus.systemStatus = 'error'
      
      // 触发告警
      await this.triggerAlert('error', '健康检查失败', error.message)
    }
  }

  /**
   * 检查数据库健康状态
   */
  async checkDatabaseHealth() {
    try {
      // 检查MongoDB连接状态
      const dbState = mongoose.connection.readyState
      
      // 检查数据库响应时间
      const startTime = Date.now()
      await mongoose.connection.db.admin().ping()
      const responseTime = Date.now() - startTime
      
      // 检查集合状态
      const collections = await mongoose.connection.db.listCollections().toArray()
      
      const status = dbState === 1 && responseTime < 1000 ? 'healthy' : 'warning'
      
      return {
        status,
        dbState,
        responseTime,
        collectionCount: collections.length,
        message: status === 'healthy' ? '数据库状态正常' : '数据库响应较慢'
      }
      
    } catch (error) {
      return {
        status: 'error',
        dbState: mongoose.connection.readyState,
        responseTime: -1,
        collectionCount: 0,
        message: `数据库连接异常: ${error.message}`
      }
    }
  }

  /**
   * 检查同步服务健康状态
   */
  async checkSyncServiceHealth() {
    try {
      // 获取同步服务状态
      const syncStats = await this.getSyncServiceStats()
      
      // 计算成功率
      const successRate = syncStats.totalOperations > 0 ? 
        (syncStats.successfulOperations / syncStats.totalOperations) * 100 : 100
      
      // 检查延迟
      const latencyStatus = syncStats.averageLatency < this.monitorConfig.performanceThresholds.syncLatency ? 'good' : 'high'
      
      // 确定状态
      let status = 'healthy'
      if (successRate < 90) status = 'error'
      else if (successRate < 95) status = 'warning'
      else if (latencyStatus === 'high') status = 'warning'
      
      return {
        status,
        successRate,
        averageLatency: syncStats.averageLatency,
        totalOperations: syncStats.totalOperations,
        failedOperations: syncStats.failedOperations,
        message: `同步成功率: ${successRate.toFixed(1)}%, 平均延迟: ${syncStats.averageLatency}ms`
      }
      
    } catch (error) {
      return {
        status: 'error',
        successRate: 0,
        averageLatency: -1,
        totalOperations: 0,
        failedOperations: 0,
        message: `同步服务检查失败: ${error.message}`
      }
    }
  }

  /**
   * 检查系统健康状态
   */
  async checkSystemHealth() {
    try {
      // 获取系统资源使用情况
      const memoryUsage = this.getMemoryUsage()
      const cpuUsage = await this.getCPUUsage()
      const diskUsage = await this.getDiskUsage()
      
      // 确定状态
      let status = 'healthy'
      if (memoryUsage.percentage > 90 || cpuUsage > 80 || diskUsage.percentage > 90) {
        status = 'critical'
      } else if (memoryUsage.percentage > 80 || cpuUsage > 70 || diskUsage.percentage > 80) {
        status = 'warning'
      }
      
      return {
        status,
        memoryUsage: memoryUsage.percentage,
        cpuUsage,
        diskUsage: diskUsage.percentage,
        message: `内存: ${memoryUsage.percentage.toFixed(1)}%, CPU: ${cpuUsage.toFixed(1)}%, 磁盘: ${diskUsage.percentage.toFixed(1)}%`
      }
      
    } catch (error) {
      return {
        status: 'error',
        memoryUsage: -1,
        cpuUsage: -1,
        diskUsage: -1,
        message: `系统资源检查失败: ${error.message}`
      }
    }
  }

  /**
   * 计算综合健康状态
   */
  calculateOverallHealth(dbHealth, syncHealth, systemHealth) {
    const statuses = [dbHealth.status, syncHealth.status, systemHealth.status]
    
    if (statuses.includes('error')) return { status: 'error', score: 0 }
    if (statuses.includes('critical')) return { status: 'critical', score: 20 }
    if (statuses.includes('warning')) return { status: 'warning', score: 60 }
    
    return { status: 'healthy', score: 100 }
  }

  /**
   * 收集系统指标
   */
  async collectSystemMetrics() {
    try {
      // 内存使用
      const memoryUsage = this.getMemoryUsage()
      
      // CPU使用
      const cpuUsage = await this.getCPUUsage()
      
      // 磁盘使用
      const diskUsage = await this.getDiskUsage()
      
      // 更新性能指标
      this.performanceMetrics.systemResources = {
        memoryUsage: memoryUsage.percentage,
        cpuUsage,
        diskUsage: diskUsage.percentage,
        networkLatency: 0 // 可以添加网络延迟检测
      }
      
      // 记录性能指标
      await this.logPerformanceMetrics({
        timestamp: new Date(),
        type: 'system_resources',
        data: this.performanceMetrics.systemResources
      })
      
    } catch (error) {
      logger.error('[同步监控] 收集系统指标失败:', error)
    }
  }

  /**
   * 获取内存使用情况
   */
  getMemoryUsage() {
    const totalMemory = os.totalmem()
    const freeMemory = os.freemem()
    const usedMemory = totalMemory - freeMemory
    const percentage = (usedMemory / totalMemory) * 100
    
    return {
      total: totalMemory,
      used: usedMemory,
      free: freeMemory,
      percentage
    }
  }

  /**
   * 获取CPU使用情况
   */
  async getCPUUsage() {
    return new Promise((resolve) => {
      const startMeasure = os.cpus().map(cpu => cpu.times)
      
      setTimeout(() => {
        const endMeasure = os.cpus().map(cpu => cpu.times)
        
        let totalIdle = 0
        let totalTick = 0
        
        for (let i = 0; i < startMeasure.length; i++) {
          const idle = endMeasure[i].idle - startMeasure[i].idle
          const total = Object.values(endMeasure[i]).reduce((a, b) => a + b) - 
                       Object.values(startMeasure[i]).reduce((a, b) => a + b)
          
          totalIdle += idle
          totalTick += total
        }
        
        const percentage = 100 - Math.floor(100 * totalIdle / totalTick)
        resolve(percentage)
      }, 100)
    })
  }

  /**
   * 获取磁盘使用情况
   */
  async getDiskUsage() {
    try {
      // 简化的磁盘使用情况（实际实现可能需要系统命令）
      return {
        total: 100,
        used: 60,
        free: 40,
        percentage: 60
      }
    } catch (error) {
      return {
        total: 0,
        used: 0,
        free: 0,
        percentage: 0
      }
    }
  }

  /**
   * 获取同步服务统计
   */
  async getSyncServiceStats() {
    try {
      // 从数据库获取同步统计
      const syncLogs = await mongoose.connection.db.collection('sync_logs')
        .find({ 
          timestamp: { 
            $gte: new Date(Date.now() - 24 * 60 * 60 * 1000) 
          } 
        })
        .toArray()
      
      const totalOperations = syncLogs.length
      const successfulOperations = syncLogs.filter(log => log.status === 'success').length
      const failedOperations = syncLogs.filter(log => log.status === 'failed').length
      const conflicts = syncLogs.filter(log => log.conflicts && log.conflicts.length > 0).length
      
      // 计算平均延迟
      const latencies = syncLogs.map(log => log.duration || 0).filter(d => d > 0)
      const averageLatency = latencies.length > 0 ? 
        latencies.reduce((a, b) => a + b, 0) / latencies.length : 0
      
      return {
        totalOperations,
        successfulOperations,
        failedOperations,
        conflicts,
        averageLatency: Math.round(averageLatency)
      }
      
    } catch (error) {
      logger.error('[同步监控] 获取同步服务统计失败:', error)
      return {
        totalOperations: 0,
        successfulOperations: 0,
        failedOperations: 0,
        conflicts: 0,
        averageLatency: 0
      }
    }
  }

  /**
   * 检查并触发告警
   */
  async checkAndTriggerAlerts(healthData) {
    try {
      const alerts = []
      
      // 检查同步成功率
      if (healthData.syncService && healthData.syncService.successRate < 95) {
        alerts.push({
          severity: healthData.syncService.successRate < 90 ? 'critical' : 'warning',
          type: 'sync_success_rate',
          message: `同步成功率过低: ${healthData.syncService.successRate.toFixed(1)}%`,
          value: healthData.syncService.successRate,
          threshold: 95
        })
      }
      
      // 检查同步延迟
      if (healthData.syncService && healthData.syncService.averageLatency > 5000) {
        alerts.push({
          severity: 'warning',
          type: 'sync_latency',
          message: `同步延迟过高: ${healthData.syncService.averageLatency}ms`,
          value: healthData.syncService.averageLatency,
          threshold: 5000
        })
      }
      
      // 检查系统资源
      if (healthData.system) {
        if (healthData.system.memoryUsage > 80) {
          alerts.push({
            severity: healthData.system.memoryUsage > 90 ? 'critical' : 'warning',
            type: 'memory_usage',
            message: `内存使用率过高: ${healthData.system.memoryUsage.toFixed(1)}%`,
            value: healthData.system.memoryUsage,
            threshold: 80
          })
        }
        
        if (healthData.system.cpuUsage > 70) {
          alerts.push({
            severity: healthData.system.cpuUsage > 80 ? 'critical' : 'warning',
            type: 'cpu_usage',
            message: `CPU使用率过高: ${healthData.system.cpuUsage.toFixed(1)}%`,
            value: healthData.system.cpuUsage,
            threshold: 70
          })
        }
      }
      
      // 触发告警
      for (const alert of alerts) {
        await this.triggerAlert(alert.severity, alert.type, alert.message, alert)
      }
      
    } catch (error) {
      logger.error('[同步监控] 检查告警失败:', error)
    }
  }

  /**
   * 触发告警
   */
  async triggerAlert(severity, type, message, data = {}) {
    try {
      const alert = {
        id: this.generateAlertId(),
        severity,
        type,
        message,
        data,
        timestamp: new Date(),
        status: 'active',
        acknowledged: false
      }
      
      // 检查是否需要发送告警（避免重复）
      if (await this.shouldSendAlert(alert)) {
        // 添加到活动告警列表
        this.monitorStatus.activeAlerts.push(alert)
        
        // 记录告警历史
        this.alertHistory.push(alert)
        
        // 记录告警日志
        await this.logAlert(alert)
        
        // 发送告警通知
        await this.sendAlertNotification(alert)
        
        // 广播告警更新
        this.broadcastStatusUpdate({
          type: 'alert',
          data: alert
        })
        
        logger.warn(`[同步监控] 触发告警 [${severity}] ${type}: ${message}`)
      }
      
    } catch (error) {
      logger.error('[同步监控] 触发告警失败:', error)
    }
  }

  /**
   * 检查是否应该发送告警
   */
  async shouldSendAlert(alert) {
    // 检查是否有相同类型的活动告警
    const existingAlert = this.monitorStatus.activeAlerts.find(a => 
      a.type === alert.type && a.severity === alert.severity
    )
    
    if (existingAlert) {
      // 检查冷却时间
      const timeSinceLastAlert = Date.now() - new Date(existingAlert.timestamp).getTime()
      if (timeSinceLastAlert < this.monitorConfig.alertConfig.alertCooldown) {
        return false
      }
      
      // 更新现有告警时间戳
      existingAlert.timestamp = alert.timestamp
      return false
    }
    
    return true
  }

  /**
   * 发送告警通知
   */
  async sendAlertNotification(alert) {
    try {
      // WebHook通知
      if (this.monitorConfig.alertConfig.enableWebhook) {
        await this.sendWebhookNotification(alert)
      }
      
      // 控制台输出
      console.log(`[${alert.severity.toUpperCase()}] ${alert.type}: ${alert.message}`)
      
    } catch (error) {
      logger.error('[同步监控] 发送告警通知失败:', error)
    }
  }

  /**
   * 发送WebHook通知
   */
  async sendWebhookNotification(alert) {
    try {
      // 这里可以实现具体的WebHook发送逻辑
      // 例如发送到钉钉、企业微信、Slack等
      logger.info(`[同步监控] 发送WebHook通知: ${alert.type}`)
      
    } catch (error) {
      logger.error('[同步监控] 发送WebHook通知失败:', error)
    }
  }

  /**
   * 生成告警ID
   */
  generateAlertId() {
    return `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  /**
   * 记录健康检查日志
   */
  async logHealthCheck(healthData) {
    try {
      await mongoose.connection.db.collection('sync_health_checks').insertOne(healthData)
    } catch (error) {
      logger.error('[同步监控] 记录健康检查日志失败:', error)
    }
  }

  /**
   * 记录性能指标
   */
  async logPerformanceMetrics(metrics) {
    try {
      await mongoose.connection.db.collection('sync_performance_metrics').insertOne(metrics)
      
      // 添加到性能历史
      this.performanceHistory.push(metrics)
      
      // 保持历史记录在合理范围内
      if (this.performanceHistory.length > 1000) {
        this.performanceHistory = this.performanceHistory.slice(-500)
      }
      
    } catch (error) {
      logger.error('[同步监控] 记录性能指标失败:', error)
    }
  }

  /**
   * 记录告警
   */
  async logAlert(alert) {
    try {
      await mongoose.connection.db.collection('sync_alerts').insertOne(alert)
    } catch (error) {
      logger.error('[同步监控] 记录告警失败:', error)
    }
  }

  /**
   * 广播状态更新
   */
  broadcastStatusUpdate(update) {
    this.websocketClients.forEach(client => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(update))
      }
    })
  }

  /**
   * 添加WebSocket客户端
   */
  addWebSocketClient(client) {
    this.websocketClients.add(client)
    
    // 发送当前状态
    client.send(JSON.stringify({
      type: 'initial_status',
      data: {
        systemStatus: this.monitorStatus.systemStatus,
        performanceMetrics: this.performanceMetrics,
        activeAlerts: this.monitorStatus.activeAlerts
      }
    }))
    
    client.on('close', () => {
      this.websocketClients.delete(client)
    })
  }

  /**
   * 获取监控状态
   */
  getMonitorStatus() {
    return {
      ...this.monitorStatus,
      config: this.monitorConfig,
      performanceMetrics: this.performanceMetrics
    }
  }

  /**
   * 获取性能指标
   */
  getPerformanceMetrics() {
    return {
      current: this.performanceMetrics,
      history: this.performanceHistory.slice(-100) // 最近100条记录
    }
  }

  /**
   * 获取告警历史
   */
  getAlertHistory(options = {}) {
    const { limit = 100, severity = null, type = null } = options
    
    let alerts = [...this.alertHistory]
    
    if (severity) {
      alerts = alerts.filter(alert => alert.severity === severity)
    }
    
    if (type) {
      alerts = alerts.filter(alert => alert.type === type)
    }
    
    return alerts.slice(-limit)
  }

  /**
   * 确认告警
   */
  acknowledgeAlert(alertId) {
    const alert = this.monitorStatus.activeAlerts.find(a => a.id === alertId)
    if (alert) {
      alert.acknowledged = true
      alert.acknowledgedAt = new Date()
      return true
    }
    return false
  }

  /**
   * 获取系统状态概览
   */
  getSystemOverview() {
    return {
      status: this.monitorStatus.systemStatus,
      uptime: this.monitorStatus.startTime ? 
        Date.now() - this.monitorStatus.startTime.getTime() : 0,
      lastHealthCheck: this.monitorStatus.lastHealthCheck,
      activeAlerts: this.monitorStatus.activeAlerts.length,
      performance: this.performanceMetrics,
      config: this.monitorConfig
    }
  }
}

// 创建单例实例
const syncMonitorService = new SyncMonitorService()

export default syncMonitorService
