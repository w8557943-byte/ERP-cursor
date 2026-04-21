import axios from 'axios';
import chalk from 'chalk';

// 配置
const PC_BACKEND_URL = 'http://localhost:3003';
const CLOUD_ENV_ID = 'erp-system-prod-1glmda1zf4f9c7a7';
const CLOUD_API_BASE = `https://${CLOUD_ENV_ID}.service.tcloudbase.com`;

class PCToMiniprogramSyncTester {
  constructor() {
    this.testResults = {
      pcConnection: false,
      cloudConnection: false,
      dataCreation: false,
      syncProcess: false,
      finalVerification: false,
      errors: []
    };
  }

  async runFullSyncTest() {
    console.log(chalk.blue.bold('\n🔄 PC端到小程序数据同步测试'));
    console.log(chalk.blue('='.repeat(60)));

    try {
      // 1. 测试PC端连接
      await this.testPCConnection();
      
      // 2. 测试云开发环境连接
      await this.testCloudConnection();
      
      // 3. 在PC端创建测试数据
      await this.createTestData();
      
      // 4. 触发同步过程
      await this.triggerSync();
      
      // 5. 验证小程序端数据
      await this.verifyMiniprogramData();
      
      // 6. 生成测试报告
      this.generateTestReport();

    } catch (error) {
      console.error(chalk.red('测试过程中出现错误:'), error.message);
      this.testResults.errors.push(error.message);
    }
  }

  async testPCConnection() {
    console.log(chalk.yellow('\n📡 1. 测试PC端后端服务连接...'));
    
    try {
      const response = await axios.get(`${PC_BACKEND_URL}/api/health`, {
        timeout: 5000
      });
      
      if (response.status === 200) {
        console.log(chalk.green('✅ PC端后端服务连接成功'));
        this.testResults.pcConnection = true;
      } else {
        throw new Error(`HTTP状态码: ${response.status}`);
      }
    } catch (error) {
      console.log(chalk.red('❌ PC端后端服务连接失败:'), error.message);
      this.testResults.errors.push(`PC连接失败: ${error.message}`);
    }
  }

  async testCloudConnection() {
    console.log(chalk.yellow('\n☁️  2. 测试云开发环境连接...'));
    
    try {
      // 测试云函数是否可访问
      const response = await axios.get(`${CLOUD_API_BASE}/erp-api`, {
        timeout: 5000
      });
      
      console.log(chalk.green('✅ 云开发环境连接成功'));
      this.testResults.cloudConnection = true;
    } catch (error) {
      console.log(chalk.red('❌ 云开发环境连接失败:'), error.message);
      console.log(chalk.gray('提示: 请确保云函数已正确部署'));
      this.testResults.errors.push(`云连接失败: ${error.message}`);
    }
  }

  async createTestData() {
    console.log(chalk.yellow('\n📝 3. 在PC端创建测试数据...'));
    
    if (!this.testResults.pcConnection) {
      console.log(chalk.gray('⚠️  PC端未连接，跳过数据创建'));
      return;
    }

    try {
      // 创建测试订单数据
      const testOrder = {
        orderNumber: `TEST-${Date.now()}`,
        customerName: '同步测试客户',
        productName: '同步测试产品',
        quantity: 10,
        price: 100,
        totalAmount: 1000,
        status: 'pending',
        syncTest: true,
        createdAt: new Date().toISOString()
      };

      const response = await axios.post(`${PC_BACKEND_URL}/api/orders`, testOrder);
      
      if (response.status === 201) {
        console.log(chalk.green('✅ 测试订单创建成功'));
        console.log(chalk.gray(`订单号: ${testOrder.orderNumber}`));
        this.testData = response.data;
        this.testResults.dataCreation = true;
      } else {
        throw new Error(`HTTP状态码: ${response.status}`);
      }
    } catch (error) {
      console.log(chalk.red('❌ 测试数据创建失败:'), error.message);
      this.testResults.errors.push(`数据创建失败: ${error.message}`);
    }
  }

  async triggerSync() {
    console.log(chalk.yellow('\n🔄 4. 触发数据同步...'));
    
    if (!this.testResults.pcConnection || !this.testResults.dataCreation) {
      console.log(chalk.gray('⚠️  前置条件未满足，跳过同步触发'));
      return;
    }

    try {
      // 调用同步API
      const response = await axios.post(`${PC_BACKEND_URL}/api/sync/trigger`, {
        type: 'order',
        id: this.testData.id,
        target: 'miniprogram'
      });
      
      if (response.status === 200) {
        console.log(chalk.green('✅ 同步触发成功'));
        console.log(chalk.gray(`同步任务ID: ${response.data.syncId}`));
        this.syncId = response.data.syncId;
        this.testResults.syncProcess = true;
        
        // 等待同步完成
        await this.waitForSyncCompletion();
      } else {
        throw new Error(`HTTP状态码: ${response.status}`);
      }
    } catch (error) {
      console.log(chalk.red('❌ 同步触发失败:'), error.message);
      this.testResults.errors.push(`同步失败: ${error.message}`);
    }
  }

  async waitForSyncCompletion() {
    console.log(chalk.gray('\n⏳ 等待同步完成...'));
    
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
      try {
        const response = await axios.get(`${PC_BACKEND_URL}/api/sync/status/${this.syncId}`);
        
        if (response.data.status === 'completed') {
          console.log(chalk.green('✅ 同步完成'));
          return;
        } else if (response.data.status === 'failed') {
          throw new Error('同步失败');
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒
        attempts++;
      } catch (error) {
        console.log(chalk.gray(`等待同步状态检查失败: ${error.message}`));
        attempts++;
      }
    }
    
    console.log(chalk.yellow('⚠️  同步超时，请手动检查'));
  }

  async verifyMiniprogramData() {
    console.log(chalk.yellow('\n🔍 5. 验证小程序端数据...'));
    
    if (!this.testResults.syncProcess) {
      console.log(chalk.gray('⚠️  同步未成功，跳过数据验证'));
      return;
    }

    try {
      // 通过云函数查询数据
      const response = await axios.post(`${CLOUD_API_BASE}/erp-api`, {
        action: 'getOrder',
        data: { orderNumber: this.testData.orderNumber }
      });
      
      if (response.data && response.data.order) {
        const order = response.data.order;
        
        if (order.orderNumber === this.testData.orderNumber) {
          console.log(chalk.green('✅ 小程序端数据验证成功'));
          console.log(chalk.gray(`找到订单: ${order.orderNumber}`));
          console.log(chalk.gray(`客户: ${order.customerName}`));
          console.log(chalk.gray(`金额: ${order.totalAmount}`));
          this.testResults.finalVerification = true;
        } else {
          throw new Error('订单号不匹配');
        }
      } else {
        throw new Error('未找到对应的订单数据');
      }
    } catch (error) {
      console.log(chalk.red('❌ 小程序端数据验证失败:'), error.message);
      this.testResults.errors.push(`数据验证失败: ${error.message}`);
    }
  }

  generateTestReport() {
    console.log(chalk.blue.bold('\n📋 同步测试报告'));
    console.log(chalk.blue('='.repeat(60)));
    
    const totalTests = 5;
    const passedTests = Object.values(this.testResults).filter(result => result === true).length;
    const successRate = Math.round((passedTests / totalTests) * 100);
    
    console.log(chalk.white(`总测试项: ${totalTests}`));
    console.log(chalk.green(`通过项: ${passedTests}`));
    console.log(chalk.red(`失败项: ${totalTests - passedTests}`));
    console.log(chalk.yellow(`成功率: ${successRate}%`));
    
    console.log(chalk.yellow('\n详细结果:'));
    console.log(`PC端连接: ${this.testResults.pcConnection ? chalk.green('✅') : chalk.red('❌')}`);
    console.log(`云环境连接: ${this.testResults.cloudConnection ? chalk.green('✅') : chalk.red('❌')}`);
    console.log(`数据创建: ${this.testResults.dataCreation ? chalk.green('✅') : chalk.red('❌')}`);
    console.log(`同步过程: ${this.testResults.syncProcess ? chalk.green('✅') : chalk.red('❌')}`);
    console.log(`最终验证: ${this.testResults.finalVerification ? chalk.green('✅') : chalk.red('❌')}`);
    
    if (this.testResults.errors.length > 0) {
      console.log(chalk.red('\n错误信息:'));
      this.testResults.errors.forEach((error, index) => {
        console.log(chalk.red(`${index + 1}. ${error}`));
      });
    }
    
    console.log(chalk.blue('\n' + '='.repeat(60)));
    
    if (successRate === 100) {
      console.log(chalk.green.bold('🎉 所有测试通过！PC端到小程序数据同步正常。'));
    } else if (successRate >= 60) {
      console.log(chalk.yellow.bold('⚠️  部分测试失败，请检查错误信息并修复。'));
    } else {
      console.log(chalk.red.bold('❌ 测试失败较多，需要全面检查系统配置。'));
    }
  }
}

// 如果直接运行此脚本
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new PCToMiniprogramSyncTester();
  tester.runFullSyncTest().catch(console.error);
}

export default PCToMiniprogramSyncTester;