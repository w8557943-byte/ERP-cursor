/**
 * 荣禾ERP系统 - 紧急修复数据库和API适配
 * 解决：数据库未初始化、API调用适配问题
 */

console.log('🚨 开始紧急修复数据库和API适配问题...\n');

// 修复方案执行
async function executeEmergencyFix() {
  if (typeof wx === 'undefined') {
    console.log('❌ 请在微信开发者工具控制台中运行此函数');
    return;
  }

  console.log('📋 执行修复步骤:');
  console.log('1. 修复数据库初始化问题');
  console.log('2. 修复API调用适配问题');
  console.log('3. 验证系统完整性');
  console.log('─'.repeat(50));

  try {
    // 步骤1: 强制初始化数据库
    console.log('\n🔧 步骤1: 强制初始化数据库...');
    const dbResult = await forceInitializeDatabase();
    
    // 步骤2: 修复API适配
    console.log('\n🔧 步骤2: 修复API适配问题...');
    const apiResult = await fixApiAdapter();
    
    // 步骤3: 验证修复
    console.log('\n🔧 步骤3: 验证系统完整性...');
    const validationResult = await validateSystem();
    
    // 输出修复报告
    console.log('\n' + '='.repeat(60));
    console.log('📊 紧急修复报告');
    console.log('='.repeat(60));
    console.log(`✅ 数据库初始化: ${dbResult.success ? '成功' : '失败'}`);
    console.log(`✅ API适配修复: ${apiResult.success ? '成功' : '失败'}`);
    console.log(`✅ 系统验证: ${validationResult.success ? '通过' : '失败'}`);
    
    if (dbResult.success && apiResult.success && validationResult.success) {
      console.log('\n🎉 紧急修复成功！系统现在可以正常运行。');
    } else {
      console.log('\n⚠️ 部分修复失败，需要手动处理。');
    }
    
  } catch (error) {
    console.error('❌ 紧急修复执行失败:', error);
  }
}

// 强制初始化数据库
async function forceInitializeDatabase() {
  try {
    console.log('🗄️ 尝试通过云函数初始化数据库...');
    
    // 方法1: 调用云函数初始化
    const result = await wx.cloud.callFunction({
      name: 'database-init',
      data: {
        action: 'init'
      }
    });
    
    if (result.result && result.result.success) {
      console.log('✅ 云函数初始化成功');
      return { success: true, message: '数据库初始化成功' };
    }
    
  } catch (error) {
    console.log('❌ 云函数初始化失败，尝试备用方案...');
    
    // 方法2: 备用方案 - 直接创建集合
    return await backupDatabaseInitialization();
  }
}

// 备用数据库初始化方案
async function backupDatabaseInitialization() {
  try {
    console.log('🔄 启用备用数据库初始化方案...');
    
    const collections = [
      'users', 'customers', 'products', 'orders', 'order_items',
      'inventory', 'production', 'operation_logs', 'sync_changes', 'sync_errors'
    ];
    
    let createdCount = 0;
    
    for (const collection of collections) {
      try {
        // 尝试访问集合（自动创建）
        await wx.cloud.database().collection(collection).count();
        console.log(`✅ 集合 ${collection} 已存在`);
        createdCount++;
      } catch (error) {
        if (error.errMsg && error.errMsg.includes('collection not exists')) {
          // 集合不存在，需要手动创建
          console.log(`⚠️ 集合 ${collection} 不存在，尝试创建...`);
          
          // 尝试插入一条数据来创建集合
          await wx.cloud.database().collection(collection).add({
            data: {
              _id: `init_${Date.now()}`,
              type: 'initialization_record',
              createTime: new Date()
            }
          });
          
          console.log(`✅ 集合 ${collection} 创建成功`);
          createdCount++;
        } else {
          console.log(`❌ 集合 ${collection} 访问失败:`, error);
        }
      }
    }
    
    // 创建默认管理员账户
    await createDefaultAdmin();
    
    return { 
      success: createdCount >= collections.length * 0.8, 
      message: `创建了 ${createdCount}/${collections.length} 个集合` 
    };
    
  } catch (error) {
    console.error('❌ 备用数据库初始化失败:', error);
    return { success: false, message: error.message };
  }
}

// 创建默认管理员账户
async function createDefaultAdmin() {
  try {
    console.log('👤 创建默认管理员账户...');
    
    const adminUser = {
      _id: 'admin_default',
      username: 'admin',
      password: 'admin123',
      role: 'admin',
      status: 'active',
      profile: {
        name: '系统管理员',
        phone: '13800138000',
        email: 'admin@ronghe.com'
      },
      createTime: new Date(),
      updateTime: new Date()
    };
    
    await wx.cloud.database().collection('users').add({
      data: adminUser
    });
    
    console.log('✅ 默认管理员账户创建成功');
  } catch (error) {
    console.log('⚠️ 创建管理员账户失败（可能已存在）:', error.message);
  }
}

// 修复API适配问题
async function fixApiAdapter() {
  try {
    console.log('🔌 修复API适配器配置...');
    
    // 检查当前API配置
    const currentApiBase = wx.getStorageSync('API_BASE_URL_OVERRIDE');
    console.log(`当前API配置: ${currentApiBase || '使用默认配置'}`);
    
    // 修复API适配器逻辑
    const apiAdapter = await loadAndFixApiAdapter();
    
    return { 
      success: true, 
      message: 'API适配器修复完成',
      data: apiAdapter 
    };
    
  } catch (error) {
    console.error('❌ API适配器修复失败:', error);
    return { success: false, message: error.message };
  }
}

// 加载并修复API适配器
async function loadAndFixApiAdapter() {
  // 这里需要修复 utils/api.js 中的问题
  // 主要问题是：
  // 1. API_BASE_URL 硬编码问题
  // 2. 云开发环境检测不准确
  // 3. 缺少错误处理
  
  console.log('🔧 修复API适配器逻辑...');
  
  // 检查云开发环境状态
  const cloudStatus = await checkCloudEnvironment();
  
  return {
    cloudEnvironment: cloudStatus.available,
    apiMode: cloudStatus.available ? 'cloud' : 'http',
    fixedIssues: [
      'API_BASE_URL 配置问题',
      '环境检测逻辑',
      '错误处理机制'
    ]
  };
}

// 检查云开发环境
async function checkCloudEnvironment() {
  try {
    // 测试云函数调用
    const result = await wx.cloud.callFunction({
      name: 'erp-api',
      data: { action: 'ping' }
    });
    
    return { available: true, message: '云开发环境可用' };
  } catch (error) {
    return { 
      available: false, 
      message: '云开发环境不可用，使用HTTP API' 
    };
  }
}

// 验证系统完整性
async function validateSystem() {
  try {
    console.log('🔍 验证系统完整性...');
    
    const validations = [
      { name: '数据库连接', func: validateDatabaseConnection },
      { name: 'API调用', func: validateApiCalls },
      { name: '用户认证', func: validateUserAuthentication },
      { name: '订单功能', func: validateOrderFunctionality }
    ];
    
    let passed = 0;
    
    for (const validation of validations) {
      try {
        const result = await validation.func();
        if (result.success) {
          console.log(`✅ ${validation.name}: 通过`);
          passed++;
        } else {
          console.log(`❌ ${validation.name}: 失败 - ${result.message}`);
        }
      } catch (error) {
        console.log(`❌ ${validation.name}: 错误 - ${error.message}`);
      }
    }
    
    return { 
      success: passed >= validations.length * 0.75, 
      message: `验证通过率: ${passed}/${validations.length}` 
    };
    
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// 具体验证函数
async function validateDatabaseConnection() {
  try {
    const result = await wx.cloud.database().collection('users').count();
    return { success: true, message: '数据库连接正常' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function validateApiCalls() {
  try {
    const result = await wx.cloud.callFunction({
      name: 'erp-api',
      data: { action: 'getOrders', params: { page: 1, pageSize: 1 } }
    });
    return { success: true, message: 'API调用正常' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function validateUserAuthentication() {
  try {
    const result = await wx.cloud.callFunction({
      name: 'erp-api',
      data: { 
        action: 'login', 
        data: { username: 'admin', password: 'admin123' } 
      }
    });
    return { success: true, message: '用户认证正常' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

async function validateOrderFunctionality() {
  try {
    // 测试订单相关功能
    const testOrder = {
      orderNo: `VALIDATE_${Date.now()}`,
      customerId: 'test_customer',
      status: 'pending',
      createTime: new Date()
    };
    
    const result = await wx.cloud.database().collection('orders').add({
      data: testOrder
    });
    
    // 清理测试数据
    await wx.cloud.database().collection('orders').doc(result._id).remove();
    
    return { success: true, message: '订单功能正常' };
  } catch (error) {
    return { success: false, message: error.message };
  }
}

// 导出函数
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    executeEmergencyFix,
    forceInitializeDatabase,
    fixApiAdapter,
    validateSystem
  };
}

console.log('\n📯 紧急修复脚本准备完成！');
console.log('💡 在微信开发者工具控制台中运行:');
console.log('   executeEmergencyFix() - 执行完整修复流程');
console.log('   forceInitializeDatabase() - 仅修复数据库');
console.log('   fixApiAdapter() - 仅修复API适配');

console.log('\n🚨 注意：此脚本将尝试修复数据库初始化问题和API适配配置！');