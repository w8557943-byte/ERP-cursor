// 执行数据库集合创建脚本
// 在微信开发者工具控制台中运行

/**
 * 荣禾ERP系统 - 数据库集合创建执行器
 * 任务 2.1: 创建数据库集合
 */
class DatabaseCollectionCreator {
  
  /**
   * 执行数据库集合创建
   */
  static async execute() {
    console.log('🚀 开始执行任务 2.1: 创建数据库集合');
    console.log('='.repeat(50));
    
    try {
      // 第一步：调用database-init云函数初始化数据库
      console.log('📋 步骤 1: 调用 database-init 云函数');
      const initResult = await this.callDatabaseInitFunction();
      
      // 第二步：验证集合创建结果
      console.log('🔍 步骤 2: 验证集合创建结果');
      const validationResult = await this.validateCollections();
      
      // 第三步：生成执行报告
      console.log('📊 步骤 3: 生成执行报告');
      const report = this.generateReport(initResult, validationResult);
      
      console.log('='.repeat(50));
      console.log('✅ 任务 2.1 执行完成！');
      console.log(report);
      
      return report;
      
    } catch (error) {
      console.error('❌ 任务执行失败:', error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * 调用 database-init 云函数
   */
  static async callDatabaseInitFunction() {
    console.log('调用云函数: database-init');
    
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: 'database-init',
        data: {
          action: 'init'
        }
      }).then(res => {
        console.log('✅ 云函数调用成功');
        console.log('📊 返回结果:', res.result);
        resolve(res.result);
      }).catch(err => {
        console.error('❌ 云函数调用失败:', err);
        reject(err);
      });
    });
  }
  
  /**
   * 验证集合创建结果
   */
  static async validateCollections() {
    console.log('验证集合创建状态');
    
    const requiredCollections = [
      'users', 'customers', 'products', 'orders', 'order_items', 'purchase_orders',
      'inventory', 'production', 'operation_logs', 'sync_changes', 'sync_errors'
    ];
    
    const validationResults = [];
    
    for (const collectionName of requiredCollections) {
      try {
        const db = wx.cloud.database();
        const collection = db.collection(collectionName);
        const countResult = await collection.count();
        
        validationResults.push({
          name: collectionName,
          exists: true,
          documentCount: countResult.total,
          status: 'ready'
        });
        
        console.log(`✅ ${collectionName}: ${countResult.total} 条记录`);
      } catch (error) {
        validationResults.push({
          name: collectionName,
          exists: false,
          error: error.message,
          status: 'needs_creation'
        });
        
        console.log(`⚠️ ${collectionName}: 需要手动创建`);
      }
    }
    
    const readyCount = validationResults.filter(r => r.status === 'ready').length;
    const totalCount = validationResults.length;
    
    return {
      success: readyCount === totalCount,
      results: validationResults,
      summary: {
        total: totalCount,
        ready: readyCount,
        needsCreation: totalCount - readyCount,
        completionRate: Math.round((readyCount / totalCount) * 100)
      }
    };
  }
  
  /**
   * 生成执行报告
   */
  static generateReport(initResult, validationResult) {
    const report = {
      timestamp: new Date().toISOString(),
      task: '任务 2.1: 创建数据库集合',
      initResult,
      validationResult,
      nextSteps: []
    };
    
    if (validationResult.summary.completionRate === 100) {
      report.message = '🎉 所有数据库集合创建成功！';
      report.nextSteps = [
        '继续执行任务 2.2: 初始化基础数据',
        '执行任务 2.3: 设置数据库权限',
        '进行阶段三: 系统集成测试'
      ];
    } else if (validationResult.summary.completionRate >= 80) {
      report.message = '⚠️ 大部分集合创建成功，少数需要手动创建';
      report.nextSteps = [
        '在云开发控制台手动创建缺失的集合',
        '重新运行验证',
        '完成后继续初始化基础数据'
      ];
    } else {
      report.message = '❌ 集合创建失败较多，需要检查云函数部署状态';
      report.nextSteps = [
        '确认 database-init 云函数已正确部署',
        '检查云开发环境状态',
        '重新运行云函数初始化'
      ];
    }
    
    return report;
  }
}

// 自动执行（如果在微信开发者工具环境中）
if (typeof wx !== 'undefined' && wx.cloud) {
  console.log('🔄 检测到微信小程序环境，开始自动执行...');
  
  DatabaseCollectionCreator.execute().then(result => {
    console.log('📋 执行结果:', result);
  }).catch(error => {
    console.error('❌ 执行出错:', error);
  });
}

// 导出函数供外部调用
if (typeof module !== 'undefined' && module.exports) {
  module.exports = DatabaseCollectionCreator;
}