/**
 * 部署测试工具
 * 用于验证云函数部署状态和数据库连接
 */

const deployTest = {
  
  // 测试云函数连接
  testCloudFunction: function(functionName) {
    return new Promise((resolve, reject) => {
      console.log(`[测试] 正在测试云函数: ${functionName}`);
      
      wx.cloud.callFunction({
        name: functionName,
        data: { action: 'test' }
      }).then(res => {
        console.log(`[测试] ${functionName} 云函数响应:`, res);
        resolve({ 
          success: true, 
          function: functionName, 
          response: res 
        });
      }).catch(err => {
        console.error(`[测试] ${functionName} 云函数失败:`, err);
        resolve({ 
          success: false, 
          function: functionName, 
          error: err 
        });
      });
    });
  },

  // 测试数据库连接
  testDatabaseConnection: function() {
    return new Promise((resolve, reject) => {
      console.log('[测试] 正在测试数据库连接...');
      
      wx.cloud.callFunction({
        name: 'database-init',
        data: { action: 'validate_setup' }
      }).then(res => {
        console.log('[测试] 数据库验证结果:', res);
        resolve({
          success: res.result && res.result.success,
          details: res.result || null
        });
      }).catch(err => {
        console.error('[测试] 数据库连接失败:', err);
        resolve({
          success: false,
          error: err
        });
      });
    });
  },

  // 完整部署测试
  runFullTest: async function() {
    console.log('[测试] 开始完整部署测试...');
    wx.showLoading({ title: '正在测试部署...', mask: true });

    try {
      // 测试1：检查 erp-api 云函数
      const erpTest = await this.testCloudFunction('erp-api');
      
      // 测试2：检查 database-init 云函数  
      const dbInitTest = await this.testCloudFunction('database-init');
      
      // 测试3：检查数据库状态
      const dbTest = await this.testDatabaseConnection();
      
      wx.hideLoading();
      
      // 生成测试报告
      const report = {
        timestamp: new Date().toLocaleString(),
        cloudFunctions: {
          erpApi: erpTest,
          databaseInit: dbInitTest
        },
        database: dbTest,
        overall: erpTest.success && dbInitTest.success && dbTest.success
      };

      console.log('[测试] 完整测试报告:', report);
      this.displayTestReport(report);
      
      return report;
      
    } catch (error) {
      wx.hideLoading();
      console.error('[测试] 测试过程出错:', error);
      wx.showModal({
        title: '测试失败',
        content: '部署测试过程中出现错误：' + error.message,
        showCancel: false
      });
    }
  },

  // 显示测试报告
  displayTestReport: function(report) {
    let content = `=== 部署测试报告 ===\\n\\n`;
    content += `测试时间: ${report.timestamp}\\n\\n`;
    
    // 云函数测试结果
    content += `云函数状态:\\n`;
    content += `• erp-api: ${report.cloudFunctions.erpApi.success ? '✅ 正常' : '❌ 异常'}\\n`;
    content += `• database-init: ${report.cloudFunctions.databaseInit.success ? '✅ 正常' : '❌ 异常'}\\n\\n`;
    
    // 数据库测试结果
    content += `数据库状态:\\n`;
    if (report.database.success) {
      content += `• 连接状态: ✅ 正常\\n`;
      if (report.database.details && report.database.details.summary) {
        content += `• 集合就绪: ${report.database.details.summary.ready}/${report.database.details.summary.total}\\n`;
      }
    } else {
      content += `• 连接状态: ❌ 异常\\n`;
      content += `• 错误信息: ${report.database.error?.message || '未知错误'}\\n`;
    }
    
    content += `\\n总体状态: ${report.overall ? '✅ 部署完成' : '❌ 需要修复'}\\n`;
    
    // 根据测试结果显示不同提示
    if (report.overall) {
      content += `\\n🎉 恭喜！系统部署完成，可以使用以下账号登录：\\n账号：13817508995\\n密码：admin123`;
    } else {
      content += `\\n🔧 请按照部署指南检查和修复问题：\\n1. 确认云函数已部署\\n2. 初始化数据库\\n3. 重新测试`;
    }

    wx.showModal({
      title: report.overall ? '部署成功' : '需要修复',
      content: content,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  // 快速测试单个组件
  quickTest: async function(component) {
    switch(component) {
      case 'cloud':
        await this.runFullTest();
        break;
      case 'login':
        this.testLogin();
        break;
      case 'database':
        await this.testDatabaseConnection();
        break;
      default:
        console.error('[测试] 未知的测试组件:', component);
    }
  },

  // 测试登录功能
  testLogin: function() {
    console.log('[测试] 测试登录功能...');
    
    const simpleLogin = require('./simple-login');
    
    simpleLogin.simpleLogin('13817508995', 'admin123')
      .then(res => {
        console.log('[测试] 登录测试成功:', res);
        wx.showToast({
          title: '登录测试成功',
          icon: 'success'
        });
      })
      .catch(err => {
        console.error('[测试] 登录测试失败:', err);
        wx.showToast({
          title: '登录测试失败',
          icon: 'none'
        });
      });
  }
};

module.exports = deployTest;
