/**
 * 快速部署检查脚本
 * 用于检查云函数部署状态和数据库连接
 */

console.log('🚀 开始快速部署检查...\n');

async function runNodeChecks() {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);

  const cloudfunctionsPath = path.join(__dirname, '../cloudfunctions');
  const requiredFunctions = [
    'database-init',
    'erp-api',
    'api-bridge',
    'data-sync',
    'database-ops',
    'sync-monitor',
    'utils',
    'websocket-manager',
    'deploy-diagnosis'
  ];

  console.log('📋 检查云函数文件结构:');
  let allFunctionsExist = true;

  requiredFunctions.forEach(funcName => {
    const funcPath = path.join(cloudfunctionsPath, funcName);
    const indexJsPath = path.join(funcPath, 'index.js');
    const packageJsonPath = path.join(funcPath, 'package.json');

    const exists =
      fs.existsSync(funcPath) && fs.existsSync(indexJsPath) && fs.existsSync(packageJsonPath);

    console.log(`  ${exists ? '✅' : '❌'} ${funcName}`);
    if (!exists) allFunctionsExist = false;
  });

  console.log(
    `\n${allFunctionsExist ? '✅' : '❌'} 云函数文件结构检查: ${allFunctionsExist ? '通过' : '失败'}`
  );

  console.log('\n📦 检查关键依赖:');
  const criticalFunctions = ['database-init', 'erp-api', 'api-bridge'];

  criticalFunctions.forEach(funcName => {
    try {
      const packagePath = path.join(cloudfunctionsPath, funcName, 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8'));
      const hasWxSdk = packageJson.dependencies && packageJson.dependencies['wx-server-sdk'];
      console.log(`  ${hasWxSdk ? '✅' : '❌'} ${funcName}: wx-server-sdk依赖`);
    } catch (error) {
      console.log(`  ❌ ${funcName}: 读取package.json失败`);
    }
  });
}

// 微信小程序环境下的检查函数
function quickDeploymentCheck() {
  if (typeof wx !== 'undefined') {
    console.log('📱 检测到微信小程序环境，开始云函数测试...');
    
    // 测试云函数连接
    wx.cloud.callFunction({
      name: 'database-init',
      data: {
        action: 'validate_setup'
      },
      success: res => {
        console.log('✅ database-init 云函数连接成功:', res);
      },
      fail: err => {
        console.log('❌ database-init 云函数连接失败:', err);
      }
    });
    
    // 测试ERP API
    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'getOrders',
        params: { page: 1, pageSize: 1 }
      },
      success: res => {
        console.log('✅ erp-api 云函数连接成功:', res);
      },
      fail: err => {
        console.log('❌ erp-api 云函数连接失败:', err);
      }
    });
    
  } else {
    console.log('⚠️  请在微信开发者工具控制台中运行此函数');
    console.log('   将此脚本内容复制到控制台，然后调用 quickDeploymentCheck()');
  }
}

// 数据库集合检查函数
function checkDatabaseCollections() {
  if (typeof wx !== 'undefined') {
    const collections = [
      'users', 'orders', 'products', 'customers', 
      'production_plans', 'shipping_records', 'system_logs',
      'inventory', 'operation_logs', 'sync_changes'
    ];
    
    console.log('🗄️  检查数据库集合:');
    
    collections.forEach(collection => {
      wx.cloud.database().collection(collection).count({
        success: res => {
          console.log(`  ✅ ${collection}: 存在 (${res.total} 条记录)`);
        },
        fail: err => {
          console.log(`  ❌ ${collection}: 不存在或无权限`);
        }
      });
    });
  } else {
    console.log('⚠️  请在微信开发者工具控制台中运行此函数');
  }
}

// 导出函数供控制台调用
if (typeof wx === 'undefined') {
  runNodeChecks().catch(error => {
    console.log('❌ Node 检查执行失败:', error?.message || error);
  });
}

console.log('\n📯 检查脚本准备完成！');
console.log('💡 在微信开发者工具控制台中运行:');
console.log('   quickDeploymentCheck() - 检查云函数状态');
console.log('   checkDatabaseCollections() - 检查数据库集合');
console.log('\n🎯 下一步: 打开微信开发者工具，导入项目并部署云函数');
