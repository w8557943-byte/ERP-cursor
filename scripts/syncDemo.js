#!/usr/bin/env node

/**
 * 数据同步演示脚本
 * 演示PC端与小程序云开发数据同步的完整流程
 */

import axios from 'axios'
import { WebSocket } from 'ws'
import chalk from 'chalk'

// API配置
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3003/api'
const WS_URL = process.env.WS_URL || 'ws://localhost:8081/sync'

// 颜色输出
const success = chalk.green
const warning = chalk.yellow
const error = chalk.red
const info = chalk.blue
const bold = chalk.bold

class SyncDemo {
  constructor() {
    this.ws = null
    this.authToken = process.env.AUTH_TOKEN || 'demo_token'
  }

  /**
   * 运行演示
   */
  async run() {
    console.log(bold.cyan('🚀 荣禾ERP数据同步演示开始'))
    console.log('=' .repeat(50))

    try {
      // 1. 测试API连接
      await this.testAPIConnection()

      // 2. 初始化同步系统
      await this.initializeSyncSystem()

      // 3. 连接WebSocket
      await this.connectWebSocket()

      // 4. 获取同步状态
      await this.getSyncStatus()

      // 5. 执行增量同步
      await this.performIncrementalSync()

      // 6. 执行一致性检查
      await this.performConsistencyCheck()

      // 7. 执行冲突解决
      await this.performConflictResolution()

      // 8. 获取系统概览
      await this.getSystemOverview()

      // 9. 获取同步历史
      await this.getSyncHistory()

      // 10. 测试健康检查
      await this.performHealthCheck()

      // 11. 断开WebSocket连接
      await this.disconnectWebSocket()

      console.log('\n' + bold.green('✅ 数据同步演示完成！'))
      
    } catch (err) {
      console.error(error('\n❌ 演示过程中出现错误:'), err.message)
      process.exit(1)
    }
  }

  /**
   * 测试API连接
   */
  async testAPIConnection() {
    console.log(info('\n📡 测试API连接...'))
    
    try {
      const response = await axios.get(`${API_BASE_URL}/sync/status`, {
        headers: { Authorization: `Bearer ${this.authToken}` }
      })
      
      if (response.data.code === 200) {
        console.log(success('✅ API连接成功'))
        console.log(info(`   同步管理器状态: ${response.data.data.status.syncStatus}`))
        console.log(info(`   WebSocket状态: ${response.data.data.status.websocketStatus}`))
      } else {
        throw new Error('API连接失败')
      }
      
    } catch (err) {
      console.log(warning('⚠️  API连接失败，使用模拟数据'))
      // 继续演示，不中断
    }
  }

  /**
   * 初始化同步系统
   */
  async initializeSyncSystem() {
    console.log(info('\n🔧 初始化同步系统...'))
    
    try {
      const response = await axios.post(`${API_BASE_URL}/sync/initialize`, {}, {
        headers: { Authorization: `Bearer ${this.authToken}` }
      })
      
      if (response.data.code === 200) {
        console.log(success('✅ 同步系统初始化成功'))
        console.log(info('   服务状态:'), response.data.data.services)
      } else {
        throw new Error('初始化失败')
      }
      
    } catch (err) {
      console.log(warning('⚠️  同步系统初始化失败，跳过此步骤'))
    }
  }

  /**
   * 连接WebSocket
   */
  async connectWebSocket() {
    console.log(info('\n🔗 连接WebSocket...'))
    
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(WS_URL)
      
      this.ws.on('open', () => {
        console.log(success('✅ WebSocket连接成功'))
        
        // 监听消息
        this.ws.on('message', (data) => {
          try {
            const message = JSON.parse(data)
            this.handleWebSocketMessage(message)
          } catch (err) {
            console.log(warning('WebSocket消息解析失败:'), err.message)
          }
        })
        
        resolve()
      })
      
      this.ws.on('error', (err) => {
        console.log(warning('⚠️  WebSocket连接失败:'), err.message)
        resolve() // 不中断演示
      })
      
      this.ws.on('close', () => {
        console.log(info('WebSocket连接已关闭'))
      })
    })
  }

  /**
   * 处理WebSocket消息
   */
  handleWebSocketMessage(message) {
    const { type, data } = message
    
    switch (type) {
      case 'sync_status':
        console.log(info('📊 WebSocket - 同步状态:'), data.syncStatus)
        break
      case 'sync_incremental_sync':
        console.log(success('📈 WebSocket - 增量同步完成:'), data.success)
        break
      case 'sync_consistency_check':
        console.log(info('🔍 WebSocket - 一致性检查完成:'), data.success)
        break
      case 'sync_conflict_resolution':
        console.log(info('⚔️  WebSocket - 冲突解决完成:'), data.success)
        break
      case 'health_check':
        console.log(info('💓 WebSocket - 健康检查:'), data.overall)
        break
      default:
        console.log(info('📨 WebSocket消息:'), type, data)
    }
  }

  /**
   * 获取同步状态
   */
  async getSyncStatus() {
    console.log(info('\n📊 获取同步状态...'))
    
    try {
      const response = await axios.get(`${API_BASE_URL}/sync/status`, {
        headers: { Authorization: `Bearer ${this.authToken}` }
      })
      
      if (response.data.code === 200) {
        const { status, stats } = response.data.data
        console.log(success('✅ 同步状态获取成功'))
        console.log(info(`   初始化状态: ${status.isInitialized}`))
        console.log(info(`   运行状态: ${status.isRunning}`))
        console.log(info(`   同步状态: ${status.syncStatus}`))
        console.log(info(`   WebSocket客户端: ${status.activeClients}`))
        console.log(info(`   总同步次数: ${stats.totalSyncs}`))
        console.log(info(`   成功次数: ${stats.successfulSyncs}`))
        console.log(info(`   失败次数: ${stats.failedSyncs}`))
        console.log(info(`   成功率: ${stats.successRate}%`))
      }
      
    } catch (err) {
      console.log(warning('⚠️  获取同步状态失败'))
    }
  }

  /**
   * 执行增量同步
   */
  async performIncrementalSync() {
    console.log(info('\n📈 执行增量同步...'))
    
    try {
      const response = await axios.post(`${API_BASE_URL}/sync/sync/incremental`, {
        options: {
          batchSize: 100,
          maxConcurrent: 2
        }
      }, {
        headers: { Authorization: `Bearer ${this.authToken}` }
      })
      
      if (response.data.code === 200) {
        console.log(success('✅ 增量同步执行成功'))
        console.log(info(`   耗时: ${response.data.data.duration}ms`))
        console.log(info(`   结果: ${JSON.stringify(response.data.data.result, null, 2)}`))
      }
      
    } catch (err) {
      console.log(warning('⚠️  增量同步执行失败'))
    }
  }

  /**
   * 执行一致性检查
   */
  async performConsistencyCheck() {
    console.log(info('\n🔍 执行一致性检查...'))
    
    try {
      const response = await axios.post(`${API_BASE_URL}/sync/sync/consistency-check`, {
        options: {
          autoFix: true,
          detailedReport: true
        }
      }, {
        headers: { Authorization: `Bearer ${this.authToken}` }
      })
      
      if (response.data.code === 200) {
        console.log(success('✅ 一致性检查执行成功'))
        const result = response.data.data.result
        console.log(info(`   检查状态: ${result.overallStatus}`))
        console.log(info(`   检查集合: ${Object.keys(result.collectionResults).join(', ')}`))
        if (result.inconsistencies && result.inconsistencies.length > 0) {
          console.log(warning(`   发现不一致: ${result.inconsistencies.length}处`))
        } else {
          console.log(success('   数据一致性良好'))
        }
      }
      
    } catch (err) {
      console.log(warning('⚠️  一致性检查执行失败'))
    }
  }

  /**
   * 执行冲突解决
   */
  async performConflictResolution() {
    console.log(info('\n⚔️  执行冲突解决...'))
    
    try {
      const response = await axios.post(`${API_BASE_URL}/sync/sync/conflict-resolution`, {
        options: {
          strategy: 'timestamp',
          autoResolve: true
        }
      }, {
        headers: { Authorization: `Bearer ${this.authToken}` }
      })
      
      if (response.data.code === 200) {
        console.log(success('✅ 冲突解决执行成功'))
        const result = response.data.data.result
        console.log(info(`   解决状态: ${result.overallStatus}`))
        console.log(info(`   解决冲突: ${result.resolvedConflicts}个`))
        console.log(info(`   剩余冲突: ${result.remainingConflicts}个`))
      }
      
    } catch (err) {
      console.log(warning('⚠️  冲突解决执行失败'))
    }
  }

  /**
   * 获取系统概览
   */
  async getSystemOverview() {
    console.log(info('\n🏗️  获取系统概览...'))
    
    try {
      const response = await axios.get(`${API_BASE_URL}/sync/overview`, {
        headers: { Authorization: `Bearer ${this.authToken}` }
      })
      
      if (response.data.code === 200) {
        console.log(success('✅ 系统概览获取成功'))
        const overview = response.data.data
        console.log(info(`   时间戳: ${overview.timestamp}`))
        console.log(info(`   同步管理器: ${JSON.stringify(overview.syncManager, null, 2)}`))
        console.log(info(`   同步统计: ${JSON.stringify(overview.syncStats, null, 2)}`))
        console.log(info(`   服务状态: ${Object.keys(overview.services).length}个服务`))
        console.log(info(`   最近历史: ${overview.recentHistory.length}条记录`))
      }
      
    } catch (err) {
      console.log(warning('⚠️  获取系统概览失败'))
    }
  }

  /**
   * 获取同步历史
   */
  async getSyncHistory() {
    console.log(info('\n📜 获取同步历史...'))
    
    try {
      const response = await axios.get(`${API_BASE_URL}/sync/history?limit=5`, {
        headers: { Authorization: `Bearer ${this.authToken}` }
      })
      
      if (response.data.code === 200) {
        console.log(success('✅ 同步历史获取成功'))
        const history = response.data.data
        console.log(info(`   获取记录数: ${history.length}`))
        
        history.forEach((record, index) => {
          console.log(info(`   记录 ${index + 1}:`))
          console.log(info(`     类型: ${record.type}`))
          console.log(info(`     状态: ${record.status}`))
          console.log(info(`     开始时间: ${record.startTime}`))
          console.log(info(`     持续时间: ${record.duration}ms`))
        })
      }
      
    } catch (err) {
      console.log(warning('⚠️  获取同步历史失败'))
    }
  }

  /**
   * 执行健康检查
   */
  async performHealthCheck() {
    console.log(info('\n💓 执行健康检查...'))
    
    try {
      const response = await axios.post(`${API_BASE_URL}/sync/sync/health-check`, {}, {
        headers: { Authorization: `Bearer ${this.authToken}` }
      })
      
      if (response.data.code === 200) {
        console.log(success('✅ 健康检查执行成功'))
        const health = response.data.data
        console.log(info(`   时间戳: ${health.timestamp}`))
        console.log(info(`   整体状态: ${health.overall}`))
        console.log(info(`   服务状态: ${Object.keys(health.services).length}个服务`))
        
        Object.entries(health.services).forEach(([name, status]) => {
          console.log(info(`     ${name}: ${status.status}`))
        })
      }
      
    } catch (err) {
      console.log(warning('⚠️  健康检查执行失败'))
    }
  }

  /**
   * 断开WebSocket连接
   */
  async disconnectWebSocket() {
    console.log(info('\n🔌 断开WebSocket连接...'))
    
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close()
      console.log(success('✅ WebSocket连接已断开'))
    } else {
      console.log(warning('⚠️  WebSocket未连接'))
    }
  }

  /**
   * 模拟数据同步场景
   */
  async simulateSyncScenario() {
    console.log(bold.cyan('\n🎭 模拟数据同步场景'))
    console.log('=' .repeat(30))

    // 场景1: 正常同步
    console.log(info('\n📋 场景1: 正常数据同步'))
    await this.simulateNormalSync()

    // 场景2: 冲突检测与解决
    console.log(info('\n⚔️  场景2: 冲突检测与解决'))
    await this.simulateConflictResolution()

    // 场景3: 一致性检查
    console.log(info('\n🔍 场景3: 数据一致性检查'))
    await this.simulateConsistencyCheck()

    // 场景4: 性能测试
    console.log(info('\n⚡ 场景4: 性能测试'))
    await this.simulatePerformanceTest()
  }

  /**
   * 模拟正常同步
   */
  async simulateNormalSync() {
    console.log(info('正在模拟正常数据同步...'))
    
    // 模拟同步过程
    const steps = [
      '检测数据变更',
      '获取增量数据',
      '执行批量同步',
      '验证同步结果',
      '更新同步状态'
    ]

    for (const step of steps) {
      await new Promise(resolve => setTimeout(resolve, 500))
      console.log(success(`   ✅ ${step}`))
    }

    console.log(success('   🎉 正常同步完成'))
  }

  /**
   * 模拟冲突解决
   */
  async simulateConflictResolution() {
    console.log(info('正在模拟冲突检测与解决...'))
    
    // 模拟冲突检测
    console.log(info('   检测到数据冲突:'))
    console.log(warning('   ⚠️  订单 #ORD001 价格不一致'))
    console.log(warning('   ⚠️  客户 #CUST001 联系方式冲突'))
    console.log(warning('   ⚠️  产品 #PROD001 库存差异'))

    // 模拟冲突解决
    await new Promise(resolve => setTimeout(resolve, 1000))
    console.log(info('   应用时间戳策略解决冲突...'))
    
    const resolutions = [
      '订单价格采用最新版本',
      '客户联系方式合并处理',
      '产品库存以服务器为准'
    ]

    for (const resolution of resolutions) {
      await new Promise(resolve => setTimeout(resolve, 300))
      console.log(success(`   ✅ ${resolution}`))
    }

    console.log(success('   🎉 冲突解决完成'))
  }

  /**
   * 模拟一致性检查
   */
  async simulateConsistencyCheck() {
    console.log(info('正在模拟数据一致性检查...'))
    
    const collections = ['orders', 'customers', 'products', 'inventory']
    
    for (const collection of collections) {
      await new Promise(resolve => setTimeout(resolve, 400))
      console.log(info(`   检查集合: ${collection}`))
      console.log(success(`   ✅ ${collection} 一致性检查通过`))
    }

    console.log(success('   🎉 一致性检查完成'))
  }

  /**
   * 模拟性能测试
   */
  async simulatePerformanceTest() {
    console.log(info('正在模拟性能测试...'))
    
    const metrics = [
      { name: '同步1000条订单数据', duration: 1200 },
      { name: '同步500条客户数据', duration: 800 },
      { name: '同步2000条产品数据', duration: 1500 },
      { name: '执行一致性检查', duration: 600 },
      { name: '解决数据冲突', duration: 300 }
    ]

    for (const metric of metrics) {
      await new Promise(resolve => setTimeout(resolve, metric.duration))
      console.log(success(`   ✅ ${metric.name} - ${metric.duration}ms`))
    }

    console.log(success('   🎉 性能测试完成'))
  }
}

// 主函数
async function main() {
  const demo = new SyncDemo()
  
  // 运行基础演示
  await demo.run()
  
  // 运行场景模拟
  await demo.simulateSyncScenario()
  
  console.log('\n' + bold.green('🎊 所有演示完成！'))
  console.log(bold.cyan('感谢使用荣禾ERP数据同步系统'))
}

// 错误处理
process.on('unhandledRejection', (err) => {
  console.error(error('\n未处理的Promise拒绝:'), err)
  process.exit(1)
})

// 运行演示
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(error('\n演示执行失败:'), err)
    process.exit(1)
  })
}

export default SyncDemo