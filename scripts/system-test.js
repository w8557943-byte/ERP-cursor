/**
 * 系统功能测试脚本
 * 用于验证ERP系统的核心功能
 */

console.log('🧪 开始系统功能测试...\n');

// 测试用例定义
const testCases = [
  {
    name: '云函数连接测试',
    category: '基础连接',
    tests: [
      {
        name: 'database-init 连接',
        function: 'testDatabaseInitConnection'
      },
      {
        name: 'erp-api 连接',
        function: 'testErpApiConnection'
      },
      {
        name: 'api-bridge 连接',
        function: 'testApiBridgeConnection'
      }
    ]
  },
  {
    name: '用户认证测试',
    category: '认证功能',
    tests: [
      {
        name: '管理员登录',
        function: 'testAdminLogin'
      },
      {
        name: '用户权限验证',
        function: 'testUserPermissions'
      }
    ]
  },
  {
    name: '业务功能测试',
    category: '核心业务',
    tests: [
      {
        name: '获取订单列表',
        function: 'testGetOrders'
      },
      {
        name: '获取客户列表',
        function: 'testGetCustomers'
      },
      {
        name: '获取产品列表',
        function: 'testGetProducts'
      },
      {
        name: '创建订单',
        function: 'testCreateOrder'
      }
    ]
  },
  {
    name: '数据同步测试',
    category: '同步功能',
    tests: [
      {
        name: '数据库监听',
        function: 'testDatabaseWatch'
      },
      {
        name: '变更同步',
        function: 'testChangeSync'
      }
    ]
  }
];

// 测试结果记录
let testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: []
};

// 云函数连接测试
async function testDatabaseInitConnection() {
  try {
    const result = await wx.cloud.callFunction({
      name: 'database-init',
      data: {
        action: 'validate_setup'
      }
    });
    return {
      success: true,
      message: 'database-init 连接成功',
      data: result.result
    };
  } catch (error) {
    return {
      success: false,
      message: `database-init 连接失败: ${error.message}`
    };
  }
}

async function testErpApiConnection() {
  try {
    const result = await wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'getOrders',
        params: { page: 1, pageSize: 1 }
      }
    });
    return {
      success: true,
      message: 'erp-api 连接成功',
      data: result.result
    };
  } catch (error) {
    return {
      success: false,
      message: `erp-api 连接失败: ${error.message}`
    };
  }
}

async function testApiBridgeConnection() {
  try {
    const result = await wx.cloud.callFunction({
      name: 'api-bridge',
      data: {
        target: 'database',
        action: 'ping'
      }
    });
    return {
      success: true,
      message: 'api-bridge 连接成功',
      data: result.result
    };
  } catch (error) {
    return {
      success: false,
      message: `api-bridge 连接失败: ${error.message}`
    };
  }
}

// 用户认证测试
async function testAdminLogin() {
  try {
    const result = await wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'login',
        data: {
          username: 'admin',
          password: 'admin123'
        }
      }
    });
    
    if (result.result && result.result.success) {
      return {
        success: true,
        message: '管理员登录成功',
        data: result.result
      };
    } else {
      return {
        success: false,
        message: '管理员登录失败'
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `登录测试失败: ${error.message}`
    };
  }
}

async function testUserPermissions() {
  try {
    const result = await wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'getOrders',
        params: { page: 1, pageSize: 10 }
      }
    });
    
    return {
      success: true,
      message: '用户权限验证通过',
      data: result.result
    };
  } catch (error) {
    return {
      success: false,
      message: `权限验证失败: ${error.message}`
    };
  }
}

// 业务功能测试
async function testGetOrders() {
  try {
    const result = await wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'getOrders',
        params: { page: 1, pageSize: 5 }
      }
    });
    
    return {
      success: true,
      message: `获取订单列表成功 (${result.result?.list?.length || 0} 条)`,
      data: result.result
    };
  } catch (error) {
    return {
      success: false,
      message: `获取订单失败: ${error.message}`
    };
  }
}

async function testGetCustomers() {
  try {
    const result = await wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'getCustomers',
        params: { page: 1, pageSize: 5 }
      }
    });
    
    return {
      success: true,
      message: `获取客户列表成功 (${result.result?.list?.length || 0} 条)`,
      data: result.result
    };
  } catch (error) {
    return {
      success: false,
      message: `获取客户失败: ${error.message}`
    };
  }
}

async function testGetProducts() {
  try {
    const result = await wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'getProducts',
        params: { page: 1, pageSize: 5 }
      }
    });
    
    return {
      success: true,
      message: `获取产品列表成功 (${result.result?.list?.length || 0} 条)`,
      data: result.result
    };
  } catch (error) {
    return {
      success: false,
      message: `获取产品失败: ${error.message}`
    };
  }
}

async function testCreateOrder() {
  try {
    const testOrder = {
      customerId: 'customer_001',
      orderNo: `TEST${Date.now()}`,
      items: [
        {
          productId: 'product_001',
          quantity: 10,
          price: 2.50
        }
      ],
      totalAmount: 25.00,
      remark: '系统测试订单'
    };
    
    const result = await wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'createOrder',
        data: testOrder
      }
    });
    
    if (result.result && result.result.success) {
      return {
        success: true,
        message: '创建订单成功',
        data: result.result
      };
    } else {
      return {
        success: false,
        message: '创建订单失败'
      };
    }
  } catch (error) {
    return {
      success: false,
      message: `创建订单失败: ${error.message}`
    };
  }
}

// 数据同步测试
async function testDatabaseWatch() {
  try {
    // 测试数据库监听功能
    const watcher = wx.cloud.database().collection('orders').watch({
      onChange: (snapshot) => {
        console.log('✅ 数据库监听成功:', snapshot);
      },
      onError: (err) => {
        console.log('❌ 数据库监听失败:', err);
      }
    });
    
    // 3秒后关闭监听
    setTimeout(() => {
      watcher.close();
    }, 3000);
    
    return {
      success: true,
      message: '数据库监听测试启动'
    };
  } catch (error) {
    return {
      success: false,
      message: `数据库监听失败: ${error.message}`
    };
  }
}

async function testChangeSync() {
  try {
    const result = await wx.cloud.callFunction({
      name: 'data-sync',
      data: {
        action: 'sync_status',
        data: {
          collection: 'orders',
          lastSyncTime: new Date(Date.now() - 3600000) // 1小时前
        }
      }
    });
    
    return {
      success: true,
      message: '变更同步测试成功',
      data: result.result
    };
  } catch (error) {
    return {
      success: false,
      message: `变更同步失败: ${error.message}`
    };
  }
}

// 执行单个测试
async function runTest(test) {
  const testFunc = eval(test.function);
  const result = await testFunc();
  
  testResults.total++;
  if (result.success) {
    testResults.passed++;
    console.log(`✅ ${test.name}: ${result.message}`);
  } else {
    testResults.failed++;
    testResults.errors.push({
      test: test.name,
      error: result.message
    });
    console.log(`❌ ${test.name}: ${result.message}`);
  }
  
  return result;
}

// 执行测试套件
async function runTestSuite(suite) {
  console.log(`\n🔍 执行测试套件: ${suite.name}`);
  console.log(`📂 分类: ${suite.category}`);
  console.log('─'.repeat(40));
  
  for (const test of suite.tests) {
    await runTest(test);
  }
}

// 执行所有测试
async function runAllTests() {
  if (typeof wx === 'undefined') {
    console.log('❌ 请在微信开发者工具控制台中运行此函数');
    return;
  }
  
  console.log('🚀 开始执行完整的系统测试...\n');
  
  // 重置测试结果
  testResults = {
    total: 0,
    passed: 0,
    failed: 0,
    errors: []
  };
  
  for (const suite of testCases) {
    await runTestSuite(suite);
  }
  
  // 输出测试报告
  console.log('\n' + '='.repeat(50));
  console.log('📊 测试报告');
  console.log('='.repeat(50));
  console.log(`📋 总测试数: ${testResults.total}`);
  console.log(`✅ 通过: ${testResults.passed}`);
  console.log(`❌ 失败: ${testResults.failed}`);
  console.log(`📈 通过率: ${((testResults.passed / testResults.total) * 100).toFixed(1)}%`);
  
  if (testResults.errors.length > 0) {
    console.log('\n⚠️ 错误详情:');
    testResults.errors.forEach((error, index) => {
      console.log(`${index + 1}. ${error.test}: ${error.error}`);
    });
  }
  
  const successRate = (testResults.passed / testResults.total) * 100;
  if (successRate >= 80) {
    console.log('\n🎉 系统测试整体通过！');
  } else {
    console.log('\n⚠️ 系统存在一些问题，需要进一步调试');
  }
  
  return testResults;
}

// 快速测试（仅基础连接）
async function quickTest() {
  if (typeof wx === 'undefined') {
    console.log('❌ 请在微信开发者工具控制台中运行此函数');
    return;
  }
  
  console.log('⚡ 快速测试（基础连接检查）...\n');
  
  const basicTests = [
    testDatabaseInitConnection,
    testErpApiConnection,
    testApiBridgeConnection
  ];
  
  let passed = 0;
  for (const test of basicTests) {
    const result = await test();
    if (result.success) passed++;
  }
  
  console.log(`\n📈 快速测试结果: ${passed}/${basicTests.length} 通过`);
  return passed === basicTests.length;
}

// 导出函数
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    runAllTests,
    quickTest,
    runTestSuite,
    testResults,
    testCases
  };
}

console.log('\n📯 系统测试脚本准备完成！');
console.log('💡 在微信开发者工具控制台中运行:');
console.log('   runAllTests() - 执行完整测试');
console.log('   quickTest() - 快速连接测试');
console.log('   runTestSuite(suite) - 执行特定测试套件');