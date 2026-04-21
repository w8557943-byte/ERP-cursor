#!/usr/bin/env node

/**
 * 数据同步性能测试脚本
 * 测试PC端与小程序云开发数据同步的性能指标
 */

import axios from 'axios'
import { performance } from 'perf_hooks'
import chalk from 'chalk'
import { WebSocket } from 'ws'

// API配置
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3003/api'
const WS_URL = process.env.WS_URL || 'ws://localhost:8081/sync'

// 颜色输出
const success = chalk.green
const warning = chalk.yellow
const error = chalk.red
const info = chalk.blue
const bold = chalk.bold

class PerformanceTest {
  constructor() {
    this.results = []
    this.ws = null
    this.authToken = process.env.AUTH_TOKEN || 'demo_token'
  }

  /**
   * 运行性能测试
   */
  async run() {
    console.log(bold.cyan('⚡ 荣禾ERP数据同步性能测试'))
    console.log('=' .repeat(50))

    try {
      // 1. 连接测试
      await this.testConnection()

      // 2. API响应时间测试
      await this.testAPIResponseTime()

      // 3. 同步吞吐量测试
      await this.testSyncThroughput()

      // 4. WebSocket性能测试
      await this.testWebSocketPerformance()

      // 5. 并发性能测试
      await this.testConcurrentPerformance()

      // 6. 大数据量测试
      await this.testLargeDataSync()

      // 7. 内存使用测试
      await this.testMemoryUsage()

      // 8. 生成测试报告
      await this.generateReport()

      console.log('\n' + bold.green('✅ 性能测试完成！'))
      
    } catch (err) {
      console.error(error('\n❌ 性能测试过程中出现错误:'), err.message)
      process.exit(1)
    }
  }

  /**
   * 连接测试
   */
  async testConnection() {
    console.log(info('\n🔗 连接测试...'))
    
    const startTime = performance.now()
    
    try {
      const response = await axios.get(`${API_BASE_URL}/sync/status`, {
        headers: { Authorization: `Bearer ${this.authToken}` },
        timeout: 5000
      })
      
      const endTime = performance.now()
      const responseTime = endTime - startTime
      
      if (response.data.code === 200) {
        console.log(success(`✅ 连接测试通过 (${responseTime.toFixed(2)}ms)`))
        this.results.push({
          test: 'connection',
          responseTime,
          status: 'pass'
        })
      } else {
        throw new Error('连接失败')
      }
      
    } catch (err) {
      console.log(error('❌ 连接测试失败'))
      this.results.push({
        test: 'connection',
        responseTime: -1,
        status: 'fail',
        error: err.message
      })
    }
  }

  /**
   * API响应时间测试
   */
  async testAPIResponseTime() {
    console.log(info('\n⏱️  API响应时间测试...'))
    
    const endpoints = [
      { path: '/sync/status', method: 'GET' },
      { path: '/sync/overview', method: 'GET' },
      { path: '/sync/history', method: 'GET' },
      { path: '/sync/sync/health-check', method: 'POST' },
      { path: '/sync/sync/incremental', method: 'POST' },
      { path: '/sync/sync/consistency-check', method: 'POST' }
    ]

    const responseTimes = []

    for (const endpoint of endpoints) {
      const startTime = performance.now()
      
      try {
        let response
        if (endpoint.method === 'GET') {
          response = await axios.get(`${API_BASE_URL}${endpoint.path}`, {
            headers: { Authorization: `Bearer ${this.authToken}` }
          })
        } else {
          response = await axios.post(`${API_BASE_URL}${endpoint.path}`, {}, {
            headers: { Authorization: `Bearer ${this.authToken}` }
          })
        }
        
        const endTime = performance.now()
        const responseTime = endTime - startTime
        
        responseTimes.push(responseTime)
        console.log(info(`   ${endpoint.path}: ${responseTime.toFixed(2)}ms`))
        
      } catch (err) {
        console.log(warning(`   ${endpoint.path}: 失败`))
        responseTimes.push(-1)
      }
    }

    // 计算统计信息
    const validTimes = responseTimes.filter(time => time > 0)
    if (validTimes.length > 0) {
      const avgResponseTime = validTimes.reduce((a, b) => a + b, 0) / validTimes.length
      const maxResponseTime = Math.max(...validTimes)
      const minResponseTime = Math.min(...validTimes)
      
      console.log(success(`✅ API响应时间测试完成`))
      console.log(info(`   平均响应时间: ${avgResponseTime.toFixed(2)}ms`))
      console.log(info(`   最大响应时间: ${maxResponseTime.toFixed(2)}ms`))
      console.log(info(`   最小响应时间: ${minResponseTime.toFixed(2)}ms`))
      
      this.results.push({
        test: 'api_response_time',
        avgResponseTime,
        maxResponseTime,
        minResponseTime,
        status: 'pass'
      })
    }
  }

  /**
   * 同步吞吐量测试
   */
  async testSyncThroughput() {
    console.log(info('\n📊 同步吞吐量测试...'))
    
    const batchSizes = [10, 50, 100, 200, 500]
    const throughputResults = []

    for (const batchSize of batchSizes) {
      console.log(info(`   测试批量大小: ${batchSize}`))
      
      const startTime = performance.now()
      
      try {
        const response = await axios.post(`${API_BASE_URL}/sync/sync/incremental`, {
          options: {
            batchSize,
            maxConcurrent: 1,
            testMode: true
          }
        }, {
          headers: { Authorization: `Bearer ${this.authToken}` }
        })
        
        const endTime = performance.now()
        const duration = endTime - startTime
        const throughput = (batchSize / duration) * 1000 // 每秒处理记录数
        
        console.log(info(`     耗时: ${duration.toFixed(2)}ms`))
        console.log(info(`     吞吐量: ${throughput.toFixed(2)} 记录/秒`))
        
        throughputResults.push({
          batchSize,
          duration,
          throughput
        })
        
      } catch (err) {
        console.log(warning(`     测试失败`))
        throughputResults.push({
          batchSize,
          duration: -1,
          throughput: -1
        })
      }
    }

    // 找出最佳批量大小
    const validResults = throughputResults.filter(r => r.throughput > 0)
    if (validResults.length > 0) {
      const bestResult = validResults.reduce((best, current) => 
        current.throughput > best.throughput ? current : best
      )
      
      console.log(success(`✅ 同步吞吐量测试完成`))
      console.log(info(`   最佳批量大小: ${bestResult.batchSize}`))
      console.log(info(`   最高吞吐量: ${bestResult.throughput.toFixed(2)} 记录/秒`))
      
      this.results.push({
        test: 'sync_throughput',
        bestBatchSize: bestResult.batchSize,
        maxThroughput: bestResult.throughput,
        throughputResults,
        status: 'pass'
      })
    }
  }

  /**
   * WebSocket性能测试
   */
  async testWebSocketPerformance() {
    console.log(info('\n🔌 WebSocket性能测试...'))
    
    return new Promise((resolve) => {
      const messageCount = 100
      const messages = []
      let connected = false
      
      this.ws = new WebSocket(WS_URL)
      
      this.ws.on('open', () => {
        connected = true
        console.log(info(`   连接成功，发送${messageCount}条消息`))
        
        // 发送消息
        const startTime = performance.now()
        for (let i = 0; i < messageCount; i++) {
          const message = {
            type: 'test',
            data: { index: i, timestamp: Date.now() }
          }
          this.ws.send(JSON.stringify(message))
        }
      })
      
      this.ws.on('message', (data) => {
        try {
          const message = JSON.parse(data)
          messages.push(message)
          
          if (messages.length >= messageCount) {
            const endTime = performance.now()
            const totalTime = endTime - startTime
            const avgLatency = totalTime / messageCount
            
            console.log(success(`✅ WebSocket性能测试完成`))
            console.log(info(`   消息数量: ${messages.length}`))
            console.log(info(`   总耗时: ${totalTime.toFixed(2)}ms`))
            console.log(info(`   平均延迟: ${avgLatency.toFixed(2)}ms`))
            
            this.results.push({
              test: 'websocket_performance',
              messageCount,
              totalTime,
              avgLatency,
              status: 'pass'
            })
            
            this.ws.close()
            resolve()
          }
        } catch (err) {
          console.log(warning('   消息解析失败'))
        }
      })
      
      this.ws.on('error', (err) => {
        console.log(warning('   WebSocket连接失败'))
        this.results.push({
          test: 'websocket_performance',
          messageCount: 0,
          totalTime: -1,
          avgLatency: -1,
          status: 'fail',
          error: err.message
        })
        resolve()
      })
      
      // 超时处理
      setTimeout(() => {
        if (connected && messages.length < messageCount) {
          console.log(warning('   WebSocket测试超时'))
          this.results.push({
            test: 'websocket_performance',
            messageCount: messages.length,
            totalTime: -1,
            avgLatency: -1,
            status: 'timeout'
          })
        }
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.close()
        }
        resolve()
      }, 30000)
    })
  }

  /**
   * 并发性能测试
   */
  async testConcurrentPerformance() {
    console.log(info('\n⚡ 并发性能测试...'))
    
    const concurrentLevels = [1, 2, 5, 10]
    const concurrentResults = []

    for (const concurrent of concurrentLevels) {
      console.log(info(`   测试并发数: ${concurrent}`))
      
      const promises = []
      const startTime = performance.now()
      
      for (let i = 0; i < concurrent; i++) {
        const promise = axios.post(`${API_BASE_URL}/sync/sync/incremental`, {
          options: {
            batchSize: 50,
            maxConcurrent: 1,
            testMode: true
          }
        }, {
          headers: { Authorization: `Bearer ${this.authToken}` }
        }).catch(() => null)
        
        promises.push(promise)
      }
      
      const results = await Promise.all(promises)
      const endTime = performance.now()
      const totalTime = endTime - startTime
      const successCount = results.filter(r => r && r.data && r.data.code === 200).length
      const successRate = (successCount / concurrent) * 100
      
      console.log(info(`     总耗时: ${totalTime.toFixed(2)}ms`))
      console.log(info(`     成功数: ${successCount}/${concurrent}`))
      console.log(info(`     成功率: ${successRate.toFixed(2)}%`))
      
      concurrentResults.push({
        concurrent,
        totalTime,
        successCount,
        successRate
      })
    }

    // 找出最佳并发数
    const validResults = concurrentResults.filter(r => r.successRate >= 95)
    if (validResults.length > 0) {
      const bestResult = validResults.reduce((best, current) => 
        current.concurrent > best.concurrent ? current : best
      )
      
      console.log(success(`✅ 并发性能测试完成`))
      console.log(info(`   最佳并发数: ${bestResult.concurrent}`))
      console.log(info(`   最高成功率: ${bestResult.successRate.toFixed(2)}%`))
      
      this.results.push({
        test: 'concurrent_performance',
        bestConcurrent: bestResult.concurrent,
        concurrentResults,
        status: 'pass'
      })
    }
  }

  /**
   * 大数据量测试
   */
  async testLargeDataSync() {
    console.log(info('\n📦 大数据量测试...'))
    
    const dataSizes = [100, 500, 1000, 2000]
    const largeDataResults = []

    for (const dataSize of dataSizes) {
      console.log(info(`   测试数据量: ${dataSize}条记录`))
      
      const startTime = performance.now()
      
      try {
        const response = await axios.post(`${API_BASE_URL}/sync/sync/incremental`, {
          options: {
            batchSize: dataSize,
            maxConcurrent: 1,
            testMode: true,
            largeDataTest: true
          }
        }, {
          headers: { Authorization: `Bearer ${this.authToken}` }
        })
        
        const endTime = performance.now()
        const duration = endTime - startTime
        const throughput = (dataSize / duration) * 1000
        
        console.log(info(`     耗时: ${duration.toFixed(2)}ms`))
        console.log(info(`     吞吐量: ${throughput.toFixed(2)} 记录/秒`))
        
        largeDataResults.push({
          dataSize,
          duration,
          throughput
        })
        
      } catch (err) {
        console.log(warning(`     测试失败`))
        largeDataResults.push({
          dataSize,
          duration: -1,
          throughput: -1
        })
      }
    }

    // 分析结果
    const validResults = largeDataResults.filter(r => r.throughput > 0)
    if (validResults.length > 0) {
      const avgThroughput = validResults.reduce((sum, r) => sum + r.throughput, 0) / validResults.length
      
      console.log(success(`✅ 大数据量测试完成`))
      console.log(info(`   平均吞吐量: ${avgThroughput.toFixed(2)} 记录/秒`))
      
      this.results.push({
        test: 'large_data_sync',
        avgThroughput,
        largeDataResults,
        status: 'pass'
      })
    }
  }

  /**
   * 内存使用测试
   */
  async testMemoryUsage() {
    console.log(info('\n💾 内存使用测试...'))
    
    const initialMemory = process.memoryUsage()
    
    // 执行多次同步操作
    for (let i = 0; i < 10; i++) {
      try {
        await axios.post(`${API_BASE_URL}/sync/sync/incremental`, {
          options: {
            batchSize: 100,
            testMode: true
          }
        }, {
          headers: { Authorization: `Bearer ${this.authToken}` }
        })
      } catch (err) {
        // 忽略错误
      }
    }
    
    // 等待垃圾回收
    await new Promise(resolve => setTimeout(resolve, 2000))
    
    const finalMemory = process.memoryUsage()
    const memoryIncrease = {
      rss: finalMemory.rss - initialMemory.rss,
      heapUsed: finalMemory.heapUsed - initialMemory.heapUsed,
      external: finalMemory.external - initialMemory.external
    }
    
    console.log(info(`   初始内存使用:`))
    console.log(info(`     RSS: ${(initialMemory.rss / 1024 / 1024).toFixed(2)}MB`))
    console.log(info(`     堆内存: ${(initialMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`))
    
    console.log(info(`   最终内存使用:`))
    console.log(info(`     RSS: ${(finalMemory.rss / 1024 / 1024).toFixed(2)}MB`))
    console.log(info(`     堆内存: ${(finalMemory.heapUsed / 1024 / 1024).toFixed(2)}MB`))
    
    console.log(info(`   内存增长:`))
    console.log(info(`     RSS: ${(memoryIncrease.rss / 1024 / 1024).toFixed(2)}MB`))
    console.log(info(`     堆内存: ${(memoryIncrease.heapUsed / 1024 / 1024).toFixed(2)}MB`))
    
    this.results.push({
      test: 'memory_usage',
      initialMemory,
      finalMemory,
      memoryIncrease,
      status: 'pass'
    })
  }

  /**
   * 生成测试报告
   */
  async generateReport() {
    console.log(info('\n📋 生成测试报告...'))
    
    const report = {
      timestamp: new Date().toISOString(),
      summary: {
        totalTests: this.results.length,
        passedTests: this.results.filter(r => r.status === 'pass').length,
        failedTests: this.results.filter(r => r.status === 'fail').length,
        timeoutTests: this.results.filter(r => r.status === 'timeout').length
      },
      results: this.results,
      recommendations: this.generateRecommendations()
    }
    
    // 输出报告摘要
    console.log(bold.cyan('\n📊 测试报告摘要'))
    console.log('=' .repeat(40))
    console.log(info(`测试时间: ${report.timestamp}`))
    console.log(info(`总测试数: ${report.summary.totalTests}`))
    console.log(success(`通过测试: ${report.summary.passedTests}`))
    console.log(error(`失败测试: ${report.summary.failedTests}`))
    console.log(warning(`超时测试: ${report.summary.timeoutTests}`))
    
    // 输出性能指标
    const apiResponseTest = this.results.find(r => r.test === 'api_response_time')
    if (apiResponseTest && apiResponseTest.status === 'pass') {
      console.log(info(`\nAPI性能:`))
      console.log(info(`  平均响应时间: ${apiResponseTest.avgResponseTime.toFixed(2)}ms`))
      console.log(info(`  最大响应时间: ${apiResponseTest.maxResponseTime.toFixed(2)}ms`))
    }
    
    const throughputTest = this.results.find(r => r.test === 'sync_throughput')
    if (throughputTest && throughputTest.status === 'pass') {
      console.log(info(`\n同步性能:`))
      console.log(info(`  最高吞吐量: ${throughputTest.maxThroughput.toFixed(2)} 记录/秒`))
      console.log(info(`  最佳批量大小: ${throughputTest.bestBatchSize}`))
    }
    
    const concurrentTest = this.results.find(r => r.test === 'concurrent_performance')
    if (concurrentTest && concurrentTest.status === 'pass') {
      console.log(info(`\n并发性能:`))
      console.log(info(`  最佳并发数: ${concurrentTest.bestConcurrent}`))
    }
    
    // 输出建议
    if (report.recommendations.length > 0) {
      console.log(bold.cyan('\n💡 优化建议'))
      console.log('=' .repeat(40))
      report.recommendations.forEach((rec, index) => {
        console.log(info(`${index + 1}. ${rec}`))
      })
    }
    
    this.results.push({
      test: 'report_generation',
      report,
      status: 'pass'
    })
    
    console.log(success('\n✅ 测试报告生成完成'))
  }

  /**
   * 生成优化建议
   */
  generateRecommendations() {
    const recommendations = []
    
    // API响应时间建议
    const apiResponseTest = this.results.find(r => r.test === 'api_response_time')
    if (apiResponseTest && apiResponseTest.avgResponseTime > 1000) {
      recommendations.push('API响应时间较长，建议优化数据库查询或增加缓存机制')
    }
    
    // 吞吐量建议
    const throughputTest = this.results.find(r => r.test === 'sync_throughput')
    if (throughputTest && throughputTest.maxThroughput < 100) {
      recommendations.push('同步吞吐量较低，建议优化批量处理逻辑或增加并发数')
    }
    
    // 并发性能建议
    const concurrentTest = this.results.find(r => r.test === 'concurrent_performance')
    if (concurrentTest && concurrentTest.bestConcurrent < 5) {
      recommendations.push('并发处理能力不足，建议优化服务器配置或增加负载均衡')
    }
    
    // WebSocket性能建议
    const websocketTest = this.results.find(r => r.test === 'websocket_performance')
    if (websocketTest && websocketTest.avgLatency > 100) {
      recommendations.push('WebSocket延迟较高，建议优化网络配置或增加服务器资源')
    }
    
    // 内存使用建议
    const memoryTest = this.results.find(r => r.test === 'memory_usage')
    if (memoryTest && memoryTest.memoryIncrease.heapUsed > 50 * 1024 * 1024) {
      recommendations.push('内存使用增长较大，建议检查内存泄漏或优化数据处理逻辑')
    }
    
    return recommendations
  }
}

// 主函数
async function main() {
  const test = new PerformanceTest()
  await test.run()
  
  console.log('\n' + bold.green('🎊 性能测试完成！'))
  console.log(bold.cyan('感谢使用荣禾ERP数据同步系统'))
}

// 错误处理
process.on('unhandledRejection', (err) => {
  console.error(error('\n未处理的Promise拒绝:'), err.message)
  process.exit(1)
})

// 运行测试
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(error('\n测试执行失败:'), err.message)
    process.exit(1)
  })
}

export default PerformanceTest