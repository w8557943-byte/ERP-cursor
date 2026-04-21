/**
 * 荣禾ERP数据同步状态检查脚本
 * 用于诊断PC端与小程序端的数据同步问题
 */

import axios from 'axios';
import chalk from 'chalk';

// 配置
const PC_BACKEND_URL = process.env.PC_BACKEND_URL || 'http://localhost:3000';
const WECHAT_CLOUD_URL = process.env.WECHAT_CLOUD_URL || 'https://your-cloudbase-url.com';

class SyncStatusChecker {
  constructor() {
    this.checkResults = {
      pcBackend: {},
      wechatCloud: {},
      syncStatus: {},
      issues: []
    };
  }

  /**
   * 执行完整的同步状态检查
   */
  async performFullCheck() {
    console.log(chalk.blue('🔍 开始执行数据同步状态检查...\n'));

    try {
      // 1. 检查PC端后端服务
      await this.checkPCBackend();
      
      // 2. 检查小程序云开发环境
      await this.checkWechatCloud();
      
      // 3. 检查同步服务状态
      await this.checkSyncServices();
      
      // 4. 检查数据一致性
      await this.checkDataConsistency();
      
      // 5. 生成检查报告
      this.generateReport();

    } catch (error) {
      console.error(chalk.red('❌ 检查过程出错:'), error.message);
      this.checkResults.issues.push({
        type: 'system',
        message: `检查过程出错: ${error.message}`
      });
    }
  }

  /**
   * 检查PC端后端服务
   */
  async checkPCBackend() {
    console.log(chalk.yellow('📊 检查PC端后端服务...'));
    
    try {
      // 检查基础服务状态
      const healthResponse = await axios.get(`${PC_BACKEND_URL}/health`, {
        timeout: 5000
      });
      
      this.checkResults.pcBackend.status = 'running';
      this.checkResults.pcBackend.health = healthResponse.data;
      
      console.log(chalk.green('✅ PC端后端服务运行正常'));
      
      // 检查同步服务
      try {
        const syncResponse = await axios.get(`${PC_BACKEND_URL}/api/sync/overview`, {
          timeout: 5000
        });
        
        this.checkResults.pcBackend.syncServices = syncResponse.data;
        console.log(chalk.green('✅ 同步服务API响应正常'));
        
      } catch (syncError) {
        console.log(chalk.red('❌ 同步服务API无响应:'), syncError.message);
        this.checkResults.issues.push({
          type: 'pc_backend',
          message: `同步服务API无响应: ${syncError.message}`
        });
      }
      
    } catch (error) {
      this.checkResults.pcBackend.status = 'offline';
      console.log(chalk.red('❌ PC端后端服务离线:'), error.message);
      this.checkResults.issues.push({
        type: 'pc_backend',
        message: `PC端后端服务离线: ${error.message}`
      });
    }
  }

  /**
   * 检查小程序云开发环境
   */
  async checkWechatCloud() {
    console.log(chalk.yellow('\n☁️ 检查小程序云开发环境...'));
    
    try {
      // 检查云函数状态
      const cloudResponse = await axios.get(`${WECHAT_CLOUD_URL}/api/cloud/health`, {
        timeout: 5000
      });
      
      this.checkResults.wechatCloud.status = 'running';
      this.checkResults.wechatCloud.cloud = cloudResponse.data;
      
      console.log(chalk.green('✅ 小程序云开发环境运行正常'));
      
    } catch (error) {
      this.checkResults.wechatCloud.status = 'offline';
      console.log(chalk.red('❌ 小程序云开发环境离线:'), error.message);
      this.checkResults.issues.push({
        type: 'wechat_cloud',
        message: `小程序云开发环境离线: ${error.message}`
      });
    }
  }

  /**
   * 检查同步服务状态
   */
  async checkSyncServices() {
    console.log(chalk.yellow('\n🔄 检查同步服务状态...'));
    
    try {
      // 检查PC端同步服务
      if (this.checkResults.pcBackend.status === 'running') {
        const syncStatusResponse = await axios.get(`${PC_BACKEND_URL}/api/sync/status`, {
          timeout: 5000
        });
        
        this.checkResults.syncStatus.pcServices = syncStatusResponse.data;
        
        // 检查各个服务状态
        const services = syncStatusResponse.data.services || {};
        Object.entries(services).forEach(([serviceName, serviceInfo]) => {
          if (serviceInfo.status === 'running') {
            console.log(chalk.green(`✅ ${serviceName}: 运行中`));
          } else {
            console.log(chalk.red(`❌ ${serviceName}: ${serviceInfo.status}`));
            this.checkResults.issues.push({
              type: 'sync_service',
              message: `${serviceName} 服务状态异常: ${serviceInfo.status}`
            });
          }
        });
      }
      
    } catch (error) {
      console.log(chalk.red('❌ 无法获取同步服务状态:'), error.message);
      this.checkResults.issues.push({
        type: 'sync_service',
        message: `无法获取同步服务状态: ${error.message}`
      });
    }
  }

  /**
   * 检查数据一致性
   */
  async checkDataConsistency() {
    console.log(chalk.yellow('\n📈 检查数据一致性...'));
    
    try {
      // 检查订单数据
      if (this.checkResults.pcBackend.status === 'running') {
        const consistencyResponse = await axios.post(`${PC_BACKEND_URL}/api/sync/sync/consistency-check`, {
          options: { quickCheck: true }
        }, {
          timeout: 10000
        });
        
        this.checkResults.syncStatus.consistency = consistencyResponse.data;
        
        const { data } = consistencyResponse.data;
        let hasIssues = false;
        
        Object.entries(data).forEach(([collection, result]) => {
          if (result.issues && result.issues.length > 0) {
            console.log(chalk.red(`❌ ${collection}: 发现 ${result.issues.length} 个问题`));
            hasIssues = true;
          } else {
            console.log(chalk.green(`✅ ${collection}: 数据一致`));
          }
        });
        
        if (hasIssues) {
          this.checkResults.issues.push({
            type: 'data_consistency',
            message: '数据一致性检查发现异常'
          });
        }
      }
      
    } catch (error) {
      console.log(chalk.red('❌ 数据一致性检查失败:'), error.message);
      this.checkResults.issues.push({
        type: 'data_consistency',
        message: `数据一致性检查失败: ${error.message}`
      });
    }
  }

  /**
   * 生成检查报告
   */
  generateReport() {
    console.log(chalk.blue('\n📋 数据同步状态检查报告'));
    console.log(chalk.blue('='.repeat(50)));
    
    const totalIssues = this.checkResults.issues.length;
    
    if (totalIssues === 0) {
      console.log(chalk.green('✅ 所有检查项目均正常，数据同步系统运行良好！'));
    } else {
      console.log(chalk.red(`❌ 发现 ${totalIssues} 个问题需要处理：`));
      
      this.checkResults.issues.forEach((issue, index) => {
        console.log(chalk.red(`  ${index + 1}. [${issue.type}] ${issue.message}`));
      });
    }
    
    console.log(chalk.blue('\n📊 详细状态：'));
    console.log(`PC端后端: ${this.checkResults.pcBackend.status === 'running' ? chalk.green('运行中') : chalk.red('离线')}`);
    console.log(`小程序云开发: ${this.checkResults.wechatCloud.status === 'running' ? chalk.green('运行中') : chalk.red('离线')}`);
    
    // 输出建议
    if (totalIssues > 0) {
      console.log(chalk.yellow('\n💡 建议：'));
      
      const pcBackendIssues = this.checkResults.issues.filter(i => i.type === 'pc_backend');
      const wechatCloudIssues = this.checkResults.issues.filter(i => i.type === 'wechat_cloud');
      const syncServiceIssues = this.checkResults.issues.filter(i => i.type === 'sync_service');
      const dataIssues = this.checkResults.issues.filter(i => i.type === 'data_consistency');
      
      if (pcBackendIssues.length > 0) {
        console.log(chalk.yellow('1. 检查PC端后端服务是否启动：'));
        console.log(chalk.yellow('   - 确保后端服务端口正确（默认3000）'));
        console.log(chalk.yellow('   - 检查环境变量配置'));
        console.log(chalk.yellow('   - 查看后端服务日志'));
      }
      
      if (wechatCloudIssues.length > 0) {
        console.log(chalk.yellow('2. 检查小程序云开发环境：'));
        console.log(chalk.yellow('   - 确认云开发环境ID配置正确'));
        console.log(chalk.yellow('   - 检查云函数部署状态'));
        console.log(chalk.yellow('   - 验证云数据库访问权限'));
      }
      
      if (syncServiceIssues.length > 0) {
        console.log(chalk.yellow('3. 检查同步服务配置：'));
        console.log(chalk.yellow('   - 确保同步服务已启动'));
        console.log(chalk.yellow('   - 检查同步服务配置参数'));
        console.log(chalk.yellow('   - 验证数据库连接'));
      }
      
      if (dataIssues.length > 0) {
        console.log(chalk.yellow('4. 处理数据一致性问题：'));
        console.log(chalk.yellow('   - 执行数据一致性修复'));
        console.log(chalk.yellow('   - 检查冲突解决策略'));
        console.log(chalk.yellow('   - 手动处理数据冲突'));
      }
    }
    
    console.log(chalk.blue('\n' + '='.repeat(50)));
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  const checker = new SyncStatusChecker();
  checker.performFullCheck().catch(console.error);
}

export default SyncStatusChecker;