/**
 * 荣禾ERP云函数部署验证脚本
 * 用于验证所有云函数是否已成功上传部署
 */

// 云函数列表
const CLOUD_FUNCTIONS = [
  'database-init',
  'erp-api', 
  'api-bridge',
  'data-sync',
  'database-ops',
  'sync-monitor',
  'utils',
  'websocket-manager'
];

// 验证配置
const VERIFICATION_CONFIG = {
  timeout: 10000, // 10秒超时
  retryCount: 3,  // 重试次数
  testActions: {
    'database-init': 'test_connection',
    'erp-api': 'health_check',
    'api-bridge': 'test_bridge',
    'data-sync': 'test_sync',
    'database-ops': 'test_ops',
    'sync-monitor': 'test_monitor',
    'utils': 'test_utils',
    'websocket-manager': 'test_ws'
  }
};

/**
 * 主验证函数
 */
async function verifyAllCloudFunctions() {
  console.log('🔍 开始验证云函数部署状态...\n');
  
  const results = {
    total: CLOUD_FUNCTIONS.length,
    deployed: 0,
    failed: 0,
    skipped: 0,
    details: []
  };

  for (const functionName of CLOUD_FUNCTIONS) {
    const result = await verifySingleFunction(functionName);
    results.details.push(result);
    
    if (result.status === 'success') {
      results.deployed++;
    } else if (result.status === 'failed') {
      results.failed++;
    } else {
      results.skipped++;
    }
  }

  // 显示验证结果
  displayVerificationResults(results);
  
  return results;
}

/**
 * 验证单个云函数
 */
async function verifySingleFunction(functionName) {
  console.log(`📡 验证云函数: ${functionName}`);
  
  const testAction = VERIFICATION_CONFIG.testActions[functionName];
  
  try {
    // 调用云函数进行测试
    const response = await callCloudFunction(functionName, {
      action: testAction,
      verify: true
    });

    if (response.errMsg === 'cloud.callFunction:ok') {
      console.log(`✅ ${functionName}: 部署成功`);
      return {
        name: functionName,
        status: 'success',
        message: '云函数部署成功，功能正常',
        responseTime: response.responseTime,
        timestamp: new Date().toISOString()
      };
    } else {
      throw new Error(`调用失败: ${response.errMsg}`);
    }
    
  } catch (error) {
    console.log(`❌ ${functionName}: 验证失败 - ${error.message}`);
    return {
      name: functionName,
      status: 'failed',
      message: error.message,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * 调用云函数
 */
function callCloudFunction(functionName, data) {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    
    wx.cloud.callFunction({
      name: functionName,
      data: data
    }).then(response => {
      const responseTime = Date.now() - startTime;
      resolve({
        ...response,
        responseTime: `${responseTime}ms`
      });
    }).catch(error => {
      reject(error);
    });
  });
}

/**
 * 显示验证结果
 */
function displayVerificationResults(results) {
  console.log('\n📊 云函数部署验证结果汇总');
  console.log('='.repeat(50));
  console.log(`总计云函数: ${results.total}`);
  console.log(`✅ 部署成功: ${results.deployed}`);
  console.log(`❌ 部署失败: ${results.failed}`);
  console.log(`⏭️  跳过验证: ${results.skipped}`);
  console.log(`📈 成功率: ${((results.deployed / results.total) * 100).toFixed(1)}%`);
  console.log('='.repeat(50));

  // 详细结果
  console.log('\n📋 详细验证结果:');
  results.details.forEach(detail => {
    const status = detail.status === 'success' ? '✅' : 
                  detail.status === 'failed' ? '❌' : '⏭️';
    console.log(`${status} ${detail.name}: ${detail.message}`);
    if (detail.responseTime) {
      console.log(`   ⏱️  响应时间: ${detail.responseTime}`);
    }
  });

  // 部署建议
  if (results.failed > 0) {
    console.log('\n💡 部署失败处理建议:');
    const failedFunctions = results.details.filter(d => d.status === 'failed');
    failedFunctions.forEach(func => {
      console.log(`🔧 ${func.name}: ${func.message}`);
    });
  }

  // 下一步行动
  if (results.deployed === results.total) {
    console.log('\n🎉 所有云函数部署成功！');
    console.log('✅ 可以进行下一阶段: 数据库初始化和功能测试');
  } else {
    console.log('\n📝 下一步行动:');
    console.log('1. 修复失败的云函数部署');
    console.log('2. 检查云函数代码和依赖');
    console.log('3. 重新部署失败的函数');
    console.log('4. 再次运行验证脚本');
  }
}

/**
 * 验证数据库连接
 */
async function verifyDatabaseConnection() {
  console.log('\n🗄️ 验证数据库连接...\n');
  
  try {
    const result = await callCloudFunction('database-init', {
      action: 'verify_database'
    });
    
    if (result.errMsg === 'cloud.callFunction:ok') {
      console.log('✅ 数据库连接验证成功');
      return true;
    } else {
      throw new Error(result.errMsg);
    }
  } catch (error) {
    console.log(`❌ 数据库连接验证失败: ${error.message}`);
    return false;
  }
}

/**
 * 导出验证功能
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    verifyAllCloudFunctions,
    verifySingleFunction,
    verifyDatabaseConnection,
    CLOUD_FUNCTIONS,
    VERIFICATION_CONFIG
  };
}

// 如果在微信小程序环境中运行
if (typeof wx !== 'undefined') {
  // 全局可用的验证函数
  window.verifyCloudFunctions = verifyAllCloudFunctions;
  window.verifyDatabaseConnection = verifyDatabaseConnection;
  
  console.log('📱 云函数验证脚本已加载');
  console.log('💡 使用方法:');
  console.log('   verifyAllCloudFunctions() - 验证所有云函数');
  console.log('   verifyDatabaseConnection() - 验证数据库连接');
}

/* 使用说明：
 * 
 * 在微信开发者工具控制台中运行:
 * 
 * 1. 验证所有云函数:
 *    verifyAllCloudFunctions()
 * 
 * 2. 验证数据库连接:
 *    verifyDatabaseConnection()
 * 
 * 3. 验证单个云函数:
 *    verifySingleFunction('database-init')
 */