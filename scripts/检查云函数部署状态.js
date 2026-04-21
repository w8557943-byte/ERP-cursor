/**
 * 荣禾ERP云函数部署状态检查脚本
 * 检查所有云函数的部署状态和可用性
 */

// 云函数列表
const CLOUD_FUNCTIONS = [
  { name: 'database-init', priority: 'high', description: '数据库初始化' },
  { name: 'erp-api', priority: 'high', description: 'ERP核心API' },
  { name: 'api-bridge', priority: 'high', description: 'API桥接服务' },
  { name: 'data-sync', priority: 'medium', description: '数据同步服务' },
  { name: 'database-ops', priority: 'medium', description: '数据库操作' },
  { name: 'sync-monitor', priority: 'low', description: '同步监控' },
  { name: 'utils', priority: 'medium', description: '工具函数' },
  { name: 'websocket-manager', priority: 'low', description: 'WebSocket管理' }
];

/**
 * 检查云函数部署状态
 */
async function checkCloudFunctionStatus() {
  console.log('🔍 开始检查云函数部署状态...\n');
  
  const status = {
    total: CLOUD_FUNCTIONS.length,
    deployed: 0,
    notDeployed: 0,
    failed: 0,
    details: []
  };

  for (const func of CLOUD_FUNCTIONS) {
    const result = await checkSingleFunction(func);
    status.details.push(result);
    
    if (result.status === 'deployed') {
      status.deployed++;
    } else if (result.status === 'not_deployed') {
      status.notDeployed++;
    } else {
      status.failed++;
    }
  }

  displayStatusSummary(status);
  return status;
}

/**
 * 检查单个云函数状态
 */
async function checkSingleFunction(funcInfo) {
  console.log(`📡 检查云函数: ${funcInfo.name} (${funcInfo.description})`);
  
  try {
    // 尝试调用云函数进行健康检查
    const response = await callCloudFunctionWithTimeout(funcInfo.name, {
      action: 'health_check',
      verify: true
    }, 5000); // 5秒超时

    if (response && response.errMsg === 'cloud.callFunction:ok') {
      console.log(`✅ ${funcInfo.name}: 已部署且可用`);
      return {
        name: funcInfo.name,
        priority: funcInfo.priority,
        description: funcInfo.description,
        status: 'deployed',
        message: '云函数已部署且可用',
        response: response.result || {},
        timestamp: new Date().toISOString()
      };
    } else {
      throw new Error(`调用返回异常: ${response?.errMsg || '未知错误'}`);
    }
    
  } catch (error) {
    console.log(`❌ ${funcInfo.name}: 未部署或不可用 - ${error.message}`);
    return {
      name: funcInfo.name,
      priority: funcInfo.priority,
      description: funcInfo.description,
      status: 'not_deployed',
      message: error.message.includes('Function not found') ? 
               '云函数未部署' : 
               `调用失败: ${error.message}`,
      timestamp: new Date().toISOString()
    };
  }
}

/**
 * 带超时的云函数调用
 */
function callCloudFunctionWithTimeout(functionName, data, timeout) {
  return Promise.race([
    callCloudFunction(functionName, data),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('调用超时')), timeout)
    )
  ]);
}

/**
 * 调用云函数
 */
function callCloudFunction(functionName, data) {
  return new Promise((resolve, reject) => {
    wx.cloud.callFunction({
      name: functionName,
      data: data
    }).then(response => {
      resolve(response);
    }).catch(error => {
      reject(error);
    });
  });
}

/**
 * 显示状态汇总
 */
function displayStatusSummary(status) {
  console.log('\n📊 云函数部署状态汇总');
  console.log('='.repeat(60));
  console.log(`总计云函数: ${status.total}`);
  console.log(`✅ 已部署: ${status.deployed}`);
  console.log(`❌ 未部署: ${status.notDeployed}`);
  console.log(`⚠️  调用失败: ${status.failed}`);
  console.log(`📈 部署率: ${((status.deployed / status.total) * 100).toFixed(1)}%`);
  console.log('='.repeat(60));

  // 按优先级分组显示
  const priorities = ['high', 'medium', 'low'];
  priorities.forEach(priority => {
    const funcs = status.details.filter(d => d.priority === priority);
    if (funcs.length > 0) {
      console.log(`\n🔸 ${priority.toUpperCase()} 优先级云函数:`);
      funcs.forEach(func => {
        const statusIcon = func.status === 'deployed' ? '✅' : 
                          func.status === 'not_deployed' ? '❌' : '⚠️';
        console.log(`${statusIcon} ${func.name}: ${func.message}`);
      });
    }
  });

  // 部署建议
  console.log('\n💡 部署建议:');
  if (status.deployed === status.total) {
    console.log('🎉 所有云函数都已部署！可以进行下一步：数据库初始化');
  } else {
    const highPriority = status.details.filter(d => 
      d.priority === 'high' && d.status !== 'deployed'
    );
    
    if (highPriority.length > 0) {
      console.log('⚠️  高优先级云函数未完全部署，请优先处理:');
      highPriority.forEach(func => {
        console.log(`   🔧 ${func.name}: ${func.message}`);
      });
    }
    
    const mediumPriority = status.details.filter(d => 
      d.priority === 'medium' && d.status !== 'deployed'
    );
    
    if (mediumPriority.length > 0) {
      console.log('📝 中优先级云函数待部署:');
      mediumPriority.forEach(func => {
        console.log(`   📋 ${func.name}: ${func.description}`);
      });
    }
  }

  // 下一步操作建议
  console.log('\n📋 下一步操作建议:');
  if (status.deployed === 0) {
    console.log('1. 🚀 立即开始云函数部署');
    console.log('   - 按照部署指引依次部署8个云函数');
    console.log('   - 优先部署: database-init, erp-api, api-bridge');
    console.log('2. 🔍 部署完成后重新检查状态');
  } else if (status.deployed < status.total) {
    console.log('1. 🔧 补齐未部署的云函数');
    console.log('2. 🧪 测试已部署云函数的功能');
    console.log('3. 🗄️  进行数据库初始化');
  } else {
    console.log('1. ✅ 云函数部署完成');
    console.log('2. 🗄️  进行数据库集合创建和初始化');
    console.log('3. 🧪 系统集成测试');
  }
}

/**
 * 快速部署检查 - 只检查关键云函数
 */
async function quickDeploymentCheck() {
  console.log('⚡ 快速部署检查 - 只检查关键云函数\n');
  
  const criticalFunctions = CLOUD_FUNCTIONS.filter(f => f.priority === 'high');
  let deployedCount = 0;
  
  for (const func of criticalFunctions) {
    try {
      await callCloudFunctionWithTimeout(func.name, {action: 'ping'}, 3000);
      console.log(`✅ ${func.name}: 已部署`);
      deployedCount++;
    } catch (error) {
      console.log(`❌ ${func.name}: 未部署`);
    }
  }
  
  console.log(`\n📊 关键云函数部署状态: ${deployedCount}/${criticalFunctions.length}`);
  
  if (deployedCount === criticalFunctions.length) {
    console.log('🎉 所有关键云函数都已部署！');
    return true;
  } else {
    console.log('⚠️  还有关键云函数未部署，需要完成部署');
    return false;
  }
}

/**
 * 获取部署指令
 */
function getDeploymentInstructions(status) {
  const notDeployedFunctions = status.details
    .filter(d => d.status !== 'deployed')
    .map(d => d.name);
  
  if (notDeployedFunctions.length === 0) {
    return '🎉 所有云函数都已部署！';
  }
  
  return `
📋 云函数部署指令：

在微信开发者工具中，按顺序部署以下云函数：

${notDeployedFunctions.map((name, index) => 
  `${index + 1}. 右键 ${name} 文件夹 → "上传并部署：云端安装依赖"`
).join('\n')}

⏰ 预计部署时间：${Math.ceil(notDeployedFunctions.length * 2)}分钟
`;
}

/**
 * 导出功能
 */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    checkCloudFunctionStatus,
    quickDeploymentCheck,
    getDeploymentInstructions,
    CLOUD_FUNCTIONS
  };
}

// 全局可用函数（微信小程序环境）
if (typeof wx !== 'undefined') {
  window.checkCloudFunctionStatus = checkCloudFunctionStatus;
  window.quickDeploymentCheck = quickDeploymentCheck;
  window.getDeploymentInstructions = getDeploymentInstructions;
  
  console.log('📱 云函数状态检查脚本已加载');
  console.log('💡 使用方法:');
  console.log('   checkCloudFunctionStatus() - 完整状态检查');
  console.log('   quickDeploymentCheck() - 快速部署检查');
  console.log('   getDeploymentInstructions() - 获取部署指令');
}

/* 使用说明：
 * 
 * 在微信开发者工具控制台中运行:
 * 
 * 1. 完整检查所有云函数:
 *    checkCloudFunctionStatus()
 * 
 * 2. 快速检查关键云函数:
 *    quickDeploymentCheck()
 * 
 * 3. 获取部署指令:
 *    console.log(getDeploymentInstructions(await checkCloudFunctionStatus()))
 */