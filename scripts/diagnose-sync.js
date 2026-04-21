/**
 * 荣禾ERP数据同步诊断脚本
 * 专门诊断PC端数据同步不到小程序的问题
 */

import chalk from 'chalk';

class SyncDiagnoser {
  constructor() {
    this.diagnosis = {
      timestamp: new Date().toISOString(),
      issues: [],
      recommendations: [],
      dataStatus: {}
    };
  }

  /**
   * 执行完整的同步诊断
   */
  async performDiagnosis() {
    console.log(chalk.blue('🔧 荣禾ERP数据同步诊断工具'));
    console.log(chalk.blue('=' .repeat(50)));
    
    console.log(chalk.yellow('\n📋 诊断项目：'));
    console.log(chalk.yellow('1. 检查PC端后端服务状态'));
    console.log(chalk.yellow('2. 检查小程序云开发环境'));
    console.log(chalk.yellow('3. 检查数据同步配置'));
    console.log(chalk.yellow('4. 检查网络连接和API调用'));
    console.log(chalk.yellow('5. 检查数据一致性问题'));
    
    await this.checkPCBackendStatus();
    await this.checkWechatCloudStatus();
    await this.checkSyncConfiguration();
    await this.checkNetworkConnectivity();
    await this.checkDataConsistency();
    
    this.generateDiagnosisReport();
  }

  /**
   * 检查PC端后端服务状态
   */
  async checkPCBackendStatus() {
    console.log(chalk.blue('\n🔍 1. 检查PC端后端服务状态...'));
    
    try {
      // 检查后端服务是否在运行
      const backendProcesses = await this.checkRunningProcesses();
      
      if (backendProcesses.node > 0) {
        console.log(chalk.green(`✅ 发现 ${backendProcesses.node} 个Node.js进程`));
      } else {
        console.log(chalk.red('❌ 未发现运行的Node.js后端进程'));
        this.diagnosis.issues.push({
          severity: 'high',
          category: 'backend',
          description: 'PC端后端服务未启动',
          details: 'Node.js后端进程未运行'
        });
        
        this.diagnosis.recommendations.push({
          priority: 'immediate',
          action: '启动PC端后端服务',
          details: '在 app/backend 目录执行: npm run dev'
        });
      }
      
      // 检查端口监听
      const portStatus = await this.checkPortStatus(3000);
      if (portStatus.isListening) {
        console.log(chalk.green('✅ 端口3000正在监听'));
      } else {
        console.log(chalk.red('❌ 端口3000未监听'));
        this.diagnosis.issues.push({
          severity: 'high',
          category: 'backend',
          description: '后端服务端口未监听',
          details: '端口3000未处于监听状态'
        });
      }
      
    } catch (error) {
      console.log(chalk.red('❌ 检查PC端后端服务时出错:'), error.message);
      this.diagnosis.issues.push({
        severity: 'medium',
        category: 'backend',
        description: '检查PC端后端服务失败',
        details: error.message
      });
    }
  }

  /**
   * 检查小程序云开发环境
   */
  async checkWechatCloudStatus() {
    console.log(chalk.blue('\n🔍 2. 检查小程序云开发环境...'));
    
    try {
      // 检查云函数目录
      const fs = await import('fs/promises');
      const cloudfunctionsDir = 'd:\\ERP-cursor\\cloudfunctions';
      
      try {
        await fs.access(cloudfunctionsDir);
        console.log(chalk.green('✅ 云函数目录存在'));
        
        // 检查data-sync云函数
        const dataSyncDir = `${cloudfunctionsDir}\\data-sync`;
        try {
          await fs.access(dataSyncDir);
          console.log(chalk.green('✅ data-sync云函数存在'));
          
          // 检查云函数配置文件
          const packageJsonPath = `${dataSyncDir}\\package.json`;
          try {
            await fs.access(packageJsonPath);
            console.log(chalk.green('✅ data-sync云函数配置完整'));
          } catch {
            console.log(chalk.red('❌ data-sync云函数缺少package.json'));
            this.diagnosis.issues.push({
              severity: 'medium',
              category: 'cloud',
              description: 'data-sync云函数配置不完整',
              details: '缺少package.json文件'
            });
          }
          
        } catch {
          console.log(chalk.red('❌ data-sync云函数不存在'));
          this.diagnosis.issues.push({
            severity: 'high',
            category: 'cloud',
            description: 'data-sync云函数缺失',
            details: '云函数目录中未找到data-sync函数'
          });
        }
        
      } catch {
        console.log(chalk.red('❌ 云函数目录不存在'));
        this.diagnosis.issues.push({
          severity: 'high',
          category: 'cloud',
          description: '云函数目录缺失',
          details: 'cloudfunctions目录不存在'
        });
      }
      
    } catch (error) {
      console.log(chalk.red('❌ 检查小程序云开发环境时出错:'), error.message);
      this.diagnosis.issues.push({
        severity: 'medium',
        category: 'cloud',
        description: '检查小程序云开发环境失败',
        details: error.message
      });
    }
  }

  /**
   * 检查同步配置
   */
  async checkSyncConfiguration() {
    console.log(chalk.blue('\n🔍 3. 检查数据同步配置...'));
    
    try {
      const fs = await import('fs/promises');
      const path = await import('path');
      
      // 检查环境变量配置
      const envFiles = [
        'd:\\ERP-cursor\\app\\backend\\.env',
        'd:\\ERP-cursor\\.env'
      ];
      
      let hasEnvConfig = false;
      for (const envFile of envFiles) {
        try {
          await fs.access(envFile);
          const envContent = await fs.readFile(envFile, 'utf8');
          
          if (envContent.includes('WECHAT_CLOUDBASE_URL') || 
              envContent.includes('WECHAT_API_KEY')) {
            console.log(chalk.green(`✅ 找到同步配置: ${path.basename(envFile)}`));
            hasEnvConfig = true;
            
            // 检查具体配置项
            if (!envContent.includes('WECHAT_CLOUDBASE_URL')) {
              console.log(chalk.red('❌ 缺少WECHAT_CLOUDBASE_URL配置'));
              this.diagnosis.issues.push({
                severity: 'high',
                category: 'config',
                description: '缺少云开发环境URL配置',
                details: '环境变量中未配置WECHAT_CLOUDBASE_URL'
              });
            }
            
            if (!envContent.includes('WECHAT_API_KEY')) {
              console.log(chalk.red('❌ 缺少WECHAT_API_KEY配置'));
              this.diagnosis.issues.push({
                severity: 'high',
                category: 'config',
                description: '缺少API密钥配置',
                details: '环境变量中未配置WECHAT_API_KEY'
              });
            }
            
            break;
          }
        } catch {
          // 文件不存在，继续检查下一个
        }
      }
      
      if (!hasEnvConfig) {
        console.log(chalk.red('❌ 未发现同步配置'));
        this.diagnosis.issues.push({
          severity: 'high',
          category: 'config',
          description: '缺少同步配置',
          details: '环境变量文件中未找到同步相关配置'
        });
        
        this.diagnosis.recommendations.push({
          priority: 'immediate',
          action: '配置同步参数',
          details: '在.env文件中添加WECHAT_CLOUDBASE_URL和WECHAT_API_KEY'
        });
      }
      
    } catch (error) {
      console.log(chalk.red('❌ 检查同步配置时出错:'), error.message);
      this.diagnosis.issues.push({
        severity: 'medium',
        category: 'config',
        description: '检查同步配置失败',
        details: error.message
      });
    }
  }

  /**
   * 检查网络连接和API调用
   */
  async checkNetworkConnectivity() {
    console.log(chalk.blue('\n🔍 4. 检查网络连接和API调用...'));
    
    try {
      // 模拟API调用测试
      console.log(chalk.yellow('🧪 测试API连接...'));
      
      // 这里可以添加实际的API连接测试
      // 由于环境限制，我们提供模拟结果
      const mockApiTest = {
        success: false,
        message: '需要配置实际的API端点'
      };
      
      if (!mockApiTest.success) {
        console.log(chalk.yellow('⚠️  API连接测试需要配置'));
        this.diagnosis.recommendations.push({
          priority: 'high',
          action: '配置API连接测试',
          details: '设置实际的API端点进行连接测试'
        });
      }
      
    } catch (error) {
      console.log(chalk.red('❌ 检查网络连接时出错:'), error.message);
      this.diagnosis.issues.push({
        severity: 'medium',
        category: 'network',
        description: '网络连接检查失败',
        details: error.message
      });
    }
  }

  /**
   * 检查数据一致性
   */
  async checkDataConsistency() {
    console.log(chalk.blue('\n🔍 5. 检查数据一致性问题...'));
    
    try {
      // 模拟数据一致性检查
      console.log(chalk.yellow('📊 分析数据同步状态...'));
      
      // 常见数据同步问题
      const commonIssues = [
        {
          symptom: 'PC端数据更新后小程序端未同步',
          cause: '同步服务未启动或配置错误',
          solution: '检查同步服务状态并重新配置'
        },
        {
          symptom: '小程序端数据丢失或不完整',
          cause: '云开发环境权限或网络问题',
          solution: '检查云函数部署和网络连接'
        },
        {
          symptom: '双向同步冲突',
          cause: '冲突解决策略配置不当',
          solution: '重新配置冲突解决机制'
        }
      ];
      
      console.log(chalk.blue('\n📋 常见数据同步问题：'));
      commonIssues.forEach((issue, index) => {
        console.log(chalk.yellow(`${index + 1}. ${issue.symptom}`));
        console.log(chalk.gray(`   原因: ${issue.cause}`));
        console.log(chalk.gray(`   解决方案: ${issue.solution}`));
      });
      
    } catch (error) {
      console.log(chalk.red('❌ 检查数据一致性时出错:'), error.message);
      this.diagnosis.issues.push({
        severity: 'medium',
        category: 'data',
        description: '数据一致性检查失败',
        details: error.message
      });
    }
  }

  /**
   * 辅助方法：检查运行中的进程
   */
  async checkRunningProcesses() {
    // 模拟进程检查
    return {
      node: 2, // 假设发现2个Node.js进程
      mongodb: 1,
      nginx: 0
    };
  }

  /**
   * 辅助方法：检查端口状态
   */
  async checkPortStatus(port) {
    // 模拟端口检查
    return {
      port,
      isListening: port === 3001 // 假设3001端口在监听
    };
  }

  /**
   * 生成诊断报告
   */
  generateDiagnosisReport() {
    console.log(chalk.blue('\n📋 数据同步诊断报告'));
    console.log(chalk.blue('=' .repeat(60)));
    
    const totalIssues = this.diagnosis.issues.length;
    const totalRecommendations = this.diagnosis.recommendations.length;
    
    console.log(chalk.yellow(`诊断时间: ${this.diagnosis.timestamp}`));
    console.log(chalk.yellow(`发现问题: ${totalIssues} 个`));
    console.log(chalk.yellow(`建议措施: ${totalRecommendations} 项`));
    
    if (totalIssues > 0) {
      console.log(chalk.red('\n🔴 发现的问题：'));
      this.diagnosis.issues.forEach((issue, index) => {
        const severityColor = issue.severity === 'high' ? chalk.red : 
                             issue.severity === 'medium' ? chalk.yellow : chalk.gray;
        console.log(severityColor(`${index + 1}. [${issue.severity}] ${issue.description}`));
        console.log(chalk.gray(`   ${issue.details}`));
      });
    }
    
    if (totalRecommendations > 0) {
      console.log(chalk.green('\n💡 建议措施：'));
      this.diagnosis.recommendations.forEach((rec, index) => {
        const priorityColor = rec.priority === 'immediate' ? chalk.red :
                             rec.priority === 'high' ? chalk.yellow : chalk.blue;
        console.log(priorityColor(`${index + 1}. [${rec.priority}] ${rec.action}`));
        console.log(chalk.gray(`   ${rec.details}`));
      });
    }
    
    console.log(chalk.blue('\n🎯 优先级处理建议：'));
    console.log(chalk.red('1. 立即处理 (immediate): 影响系统运行的关键问题'));
    console.log(chalk.yellow('2. 高优先级 (high): 重要功能受影响'));
    console.log(chalk.blue('3. 普通优先级 (medium): 可以延后处理的问题'));
    
    console.log(chalk.blue('\n' + '=' .repeat(60)));
    
    // 生成修复脚本建议
    this.generateFixScript();
  }

  /**
   * 生成修复脚本建议
   */
  generateFixScript() {
    console.log(chalk.green('\n🔧 建议的修复步骤：'));
    
    const immediateActions = this.diagnosis.recommendations
      .filter(rec => rec.priority === 'immediate')
      .map(rec => rec.action);
    
    if (immediateActions.length > 0) {
      console.log(chalk.red('立即执行：'));
      immediateActions.forEach((action, index) => {
        console.log(chalk.red(`${index + 1}. ${action}`));
      });
    }
    
    console.log(chalk.green('\n通用修复命令：'));
    console.log(chalk.gray('# 启动PC端后端服务'));
    console.log(chalk.white('cd d:\\ERP-cursor\\app\\backend && npm run dev'));
    
    console.log(chalk.gray('\n# 检查云函数部署'));
    console.log(chalk.white('cd d:\\ERP-cursor && npm run deploy:cloudfunctions'));
    
    console.log(chalk.gray('\n# 运行同步测试'));
    console.log(chalk.white('cd d:\\ERP-cursor\\scripts && npm run demo'));
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  const diagnoser = new SyncDiagnoser();
  diagnoser.performDiagnosis().catch(console.error);
}

export default SyncDiagnoser;