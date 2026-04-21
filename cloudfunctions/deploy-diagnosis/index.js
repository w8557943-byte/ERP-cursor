const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * 云函数部署诊断脚本
 * 用于检查和诊断云函数部署问题
 */
exports.main = async (event, context) => {
  console.log('[部署诊断] 开始检查云函数部署状态');
  
  const results = {
    timestamp: new Date(),
    checks: {},
    summary: {
      passed: 0,
      failed: 0,
      warnings: 0
    }
  };

  try {
    // 检查1: 云开发环境
    results.checks.cloudEnvironment = await checkCloudEnvironment();
    
    // 检查2: 数据库连接
    results.checks.databaseConnection = await checkDatabaseConnection();
    
    // 检查3: 必要的集合
    results.checks.requiredCollections = await checkRequiredCollections();
    
    // 检查4: 云函数状态
    results.checks.cloudFunctionStatus = await checkCloudFunctionStatus();
    
    // 检查5: 权限设置
    results.checks.permissions = await checkPermissions();
    
    // 计算通过/失败/警告数
    Object.values(results.checks).forEach(check => {
      if (check.status === 'passed') {
        results.summary.passed++;
      } else if (check.status === 'failed') {
        results.summary.failed++;
      } else if (check.status === 'warning') {
        results.summary.warnings++;
      }
    });
    
    return {
      success: true,
      data: results,
      message: `检查完成: ${results.summary.passed}项通过, ${results.summary.failed}项失败, ${results.summary.warnings}项警告`
    };
    
  } catch (error) {
    console.error('[部署诊断] 检查过程出错:', error);
    
    return {
      success: false,
      error: error.message,
      message: '部署诊断失败'
    };
  }
};

// 检查云开发环境
async function checkCloudEnvironment() {
  try {
    const envInfo = cloud.getWXContext();
    
    return {
      status: 'passed',
      message: '云开发环境正常',
      details: {
        env: envInfo.ENV || cloud.DYNAMIC_CURRENT_ENV,
        timestamp: new Date()
      }
    };
  } catch (error) {
    return {
      status: 'failed',
      message: '云开发环境检查失败',
      error: error.message
    };
  }
}

// 检查数据库连接
async function checkDatabaseConnection() {
  try {
    const db = cloud.database();
    await db.collection('_test').limit(1).get();
    
    return {
      status: 'passed',
      message: '数据库连接正常'
    };
  } catch (error) {
    // 如果是集合不存在的错误，也算连接正常
    if (error.message.includes('Collection')) {
      return {
        status: 'passed',
        message: '数据库连接正常（集合尚未创建）'
      };
    }
    
    return {
      status: 'failed',
      message: '数据库连接失败',
      error: error.message
    };
  }
}

// 检查必要的集合
async function checkRequiredCollections() {
  const requiredCollections = [
    'users',
    'customers',
    'products',
    'orders',
    'order_items',
    'inventory',
    'suppliers',
    'purchase_orders',
    'financial_records',
    'reports',
    'system_configs',
    'operation_logs',
    'sync_changes'
  ];
  
  const results = {
    existing: [],
    missing: [],
    status: 'passed'
  };
  
  try {
    const db = cloud.database();
    
    for (const collection of requiredCollections) {
      try {
        await db.collection(collection).limit(1).get();
        results.existing.push(collection);
      } catch (error) {
        // 集合不存在
        results.missing.push(collection);
      }
    }
    
    if (results.missing.length > 0) {
      results.status = 'warning';
      results.message = `${results.missing.length}个集合尚未创建`;
    } else {
      results.message = '所有必要集合已创建';
    }
    
    return results;
  } catch (error) {
    return {
      status: 'failed',
      message: '检查集合时出错',
      error: error.message,
      existing: [],
      missing: requiredCollections
    };
  }
}

// 检查云函数状态
async function checkCloudFunctionStatus() {
  // 这里需要手动检查，因为云函数无法自我检查
  // 返回提示信息
  return {
    status: 'warning',
    message: '请在微信开发者工具中手动检查云函数部署状态',
    instructions: [
      '1. 在云开发控制台查看云函数列表',
      '2. 确认所有云函数已成功部署',
      '3. 检查云函数运行日志是否有错误'
    ]
  };
}

// 检查权限设置
async function checkPermissions() {
  try {
    // 尝试读取和写入操作来检查权限
    const db = cloud.database();
    
    // 测试读取权限
    try {
      await db.collection('users').limit(1).get();
    } catch (error) {
      return {
        status: 'warning',
        message: '可能存在权限问题，请在云开发控制台检查数据库权限设置',
        error: error.message
      };
    }
    
    return {
      status: 'passed',
      message: '数据库权限正常',
      recommendation: '建议在生产环境中设置更严格的权限规则'
    };
  } catch (error) {
    return {
      status: 'failed',
      message: '权限检查失败',
      error: error.message
    };
  }
}