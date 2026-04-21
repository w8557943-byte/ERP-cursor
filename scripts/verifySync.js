#!/usr/bin/env node

/**
 * 数据同步功能快速验证脚本
 * 快速验证数据同步功能是否正常工作
 */

import axios from 'axios'
import chalk from 'chalk'

// API配置
const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:3003/api'
const AUTH_TOKEN = process.env.AUTH_TOKEN || 'demo_token'

// 颜色输出
const success = chalk.green
const error = chalk.red
const info = chalk.blue
const bold = chalk.bold

class SyncVerifier {
  constructor() {
    this.results = []
  }

  /**
   * 运行验证
   */
  async verify() {
    console.log(bold.cyan('🔍 荣禾ERP数据同步功能验证'))
    console.log('=' .repeat(40))

    const tests = [
      { name: 'API连接测试', test: this.testAPIConnection.bind(this) },
      { name: '同步状态检查', test: this.checkSyncStatus.bind(this) },
      { name: '同步服务验证', test: this.verifySyncServices.bind(this) },
      { name: '基础功能测试', test: this.testBasicFunctions.bind(this) }
    ]

    for (const { name, test } of tests) {
      console.log(info(`\n📋 ${name}`))
      try {
        await test()
        console.log(success(`✅ ${name} - 通过`))
        this.results.push({ name, status: 'pass' })
      } catch (err) {
        console.log(error(`❌ ${name} - 失败: ${err.message}`))
        this.results.push({ name, status: 'fail', error: err.message })
      }
    }

    this.printSummary()
  }

  /**
   * API连接测试
   */
  async testAPIConnection() {
    const response = await axios.get(`${API_BASE_URL}/sync/status`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` },
      timeout: 5000
    })

    if (response.data.code !== 200) {
      throw new Error('API返回错误状态')
    }

    console.log(info('   API连接正常'))
  }

  /**
   * 检查同步状态
   */
  async checkSyncStatus() {
    const response = await axios.get(`${API_BASE_URL}/sync/status`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` }
    })

    const { status, stats } = response.data.data

    if (!status.isInitialized) {
      throw new Error('同步系统未初始化')
    }

    console.log(info(`   同步管理器: ${status.syncStatus}`))
    console.log(info(`   WebSocket: ${status.websocketStatus}`))
    console.log(info(`   成功率: ${stats.successRate}%`))

    if (stats.successRate < 90) {
      throw new Error('同步成功率过低')
    }
  }

  /**
   * 验证同步服务
   */
  async verifySyncServices() {
    const response = await axios.get(`${API_BASE_URL}/sync/overview`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` }
    })

    const { services } = response.data.data

    const requiredServices = [
      'enhancedSyncService',
      'consistencyCheckService',
      'conflictResolutionService',
      'syncMonitorService',
      'incrementalSyncService',
      'dataRollbackService'
    ]

    for (const service of requiredServices) {
      if (!services[service]) {
        throw new Error(`服务 ${service} 未启动`)
      }
      if (services[service].status !== 'running') {
        throw new Error(`服务 ${service} 状态异常`)
      }
      console.log(info(`   ${service}: 运行中`))
    }
  }

  /**
   * 测试基础功能
   */
  async testBasicFunctions() {
    // 测试健康检查
    const healthResponse = await axios.post(`${API_BASE_URL}/sync/sync/health-check`, {}, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` }
    })

    if (healthResponse.data.data.overall !== 'healthy') {
      throw new Error('系统健康检查失败')
    }

    console.log(info('   健康检查: 正常'))

    // 测试获取历史记录
    const historyResponse = await axios.get(`${API_BASE_URL}/sync/history?limit=1`, {
      headers: { Authorization: `Bearer ${AUTH_TOKEN}` }
    })

    if (!historyResponse.data.data || historyResponse.data.data.length === 0) {
      console.log(warning('   警告: 无同步历史记录'))
    } else {
      console.log(info('   历史记录: 正常'))
    }
  }

  /**
   * 打印验证摘要
   */
  printSummary() {
    console.log(bold.cyan('\n📊 验证摘要'))
    console.log('=' .repeat(40))

    const passed = this.results.filter(r => r.status === 'pass').length
    const failed = this.results.filter(r => r.status === 'fail').length
    const total = this.results.length

    console.log(info(`总测试数: ${total}`))
    console.log(success(`通过: ${passed}`))
    console.log(error(`失败: ${failed}`))

    if (failed > 0) {
      console.log(error('\n❌ 失败详情:'))
      this.results.filter(r => r.status === 'fail').forEach(result => {
        console.log(error(`  - ${result.name}: ${result.error}`))
      })
    }

    if (failed === 0) {
      console.log(success('\n🎉 所有验证通过！数据同步功能正常工作'))
    } else {
      console.log(error('\n⚠️  发现一些问题，请检查相关服务配置'))
      process.exit(1)
    }
  }
}

// 快速验证函数
export async function quickVerify() {
  const verifier = new SyncVerifier()
  await verifier.verify()
  return verifier.results
}

// 主函数
async function main() {
  const verifier = new SyncVerifier()
  await verifier.verify()
}

// 运行验证
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(err => {
    console.error(error('验证过程出错:'), err.message)
    process.exit(1)
  })
}

export default SyncVerifier