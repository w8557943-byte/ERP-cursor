import { readFileSync } from 'fs';
import { join } from 'path';

console.log('🔧 荣禾ERP数据同步快速检查');
console.log('='.repeat(50));

// 检查环境配置
function checkEnvironmentConfig() {
  console.log('\n📋 1. 检查环境配置...');
  
  try {
    const envPath = join(process.cwd(), '..', '.env');
    const envContent = readFileSync(envPath, 'utf8');
    
    const hasCloudEnv = envContent.includes('CLOUD_ENV_ID=erp-system-prod-1glmda1zf4f9c7a7');
    const hasAppId = envContent.includes('WECHAT_APPID=wxd2e50f945421bab6');
    const hasApiUrl = envContent.includes('ERP_API_URL');
    
    console.log(`云环境ID: ${hasCloudEnv ? '✅' : '❌'}`);
    console.log(`小程序AppID: ${hasAppId ? '✅' : '❌'}`);
    console.log(`API地址: ${hasApiUrl ? '✅' : '❌'}`);
    
    return hasCloudEnv && hasAppId && hasApiUrl;
  } catch (error) {
    console.log('❌ 无法读取环境配置文件');
    return false;
  }
}

// 检查云函数
function checkCloudFunctions() {
  console.log('\n☁️  2. 检查云函数状态...');
  
  const requiredFunctions = [
    'data-sync',
    'erp-api',
    'database-init',
    'websocket-manager'
  ];
  
  let allExist = true;
  
  requiredFunctions.forEach(func => {
    try {
      const packagePath = join(process.cwd(), '..', 'cloudfunctions', func, 'package.json');
      readFileSync(packagePath, 'utf8');
      console.log(`${func}: ✅`);
    } catch (error) {
      console.log(`${func}: ❌`);
      allExist = false;
    }
  });
  
  return allExist;
}

// 检查同步配置
function checkSyncConfig() {
  console.log('\n🔄 3. 检查同步配置...');
  
  try {
    const configPath = join(process.cwd(), '..', 'app', 'backend', 'src', 'config', 'syncConfig.js');
    const configContent = readFileSync(configPath, 'utf8');
    
    const hasWechatConfig = configContent.includes('wechat');
    const hasSyncStrategy = configContent.includes('syncStrategy');
    const hasConflictResolution = configContent.includes('conflictResolution');
    
    console.log(`微信配置: ${hasWechatConfig ? '✅' : '❌'}`);
    console.log(`同步策略: ${hasSyncStrategy ? '✅' : '❌'}`);
    console.log(`冲突解决: ${hasConflictResolution ? '✅' : '❌'}`);
    
    return hasWechatConfig && hasSyncStrategy && hasConflictResolution;
  } catch (error) {
    console.log('❌ 无法读取同步配置文件');
    return false;
  }
}

// 检查小程序端配置
function checkMiniprogramConfig() {
  console.log('\n📱 4. 检查小程序端配置...');
  
  try {
    const appPath = join(process.cwd(), '..', 'app.js');
    const appContent = readFileSync(appPath, 'utf8');
    
    const hasCloudInit = appContent.includes('wx.cloud.init');
    const hasCorrectEnv = appContent.includes('erp-system-prod-1glmda1zf4f9c7a7');
    
    console.log(`云开发初始化: ${hasCloudInit ? '✅' : '❌'}`);
    console.log(`环境ID配置: ${hasCorrectEnv ? '✅' : '❌'}`);
    
    return hasCloudInit && hasCorrectEnv;
  } catch (error) {
    console.log('❌ 无法读取小程序配置文件');
    return false;
  }
}

// 生成检查报告
function generateReport(results) {
  console.log('\n📊 检查结果汇总:');
  console.log('='.repeat(50));
  
  const passed = Object.values(results).filter(r => r).length;
  const total = Object.keys(results).length;
  const successRate = Math.round((passed / total) * 100);
  
  console.log(`总检查项: ${total}`);
  console.log(`通过项: ${passed} ✅`);
  console.log(`失败项: ${total - passed} ❌`);
  console.log(`成功率: ${successRate}%`);
  
  console.log('\n🔍 详细结果:');
  console.log(`环境配置: ${results.envConfig ? '✅ 正常' : '❌ 异常'}`);
  console.log(`云函数: ${results.cloudFunctions ? '✅ 正常' : '❌ 异常'}`);
  console.log(`同步配置: ${results.syncConfig ? '✅ 正常' : '❌ 异常'}`);
  console.log(`小程序配置: ${results.miniprogramConfig ? '✅ 正常' : '❌ 异常'}`);
  
  return { passed, total, successRate };
}

// 主函数
function main() {
  console.log(`检查时间: ${new Date().toLocaleString()}`);
  
  const results = {
    envConfig: checkEnvironmentConfig(),
    cloudFunctions: checkCloudFunctions(),
    syncConfig: checkSyncConfig(),
    miniprogramConfig: checkMiniprogramConfig()
  };
  
  const summary = generateReport(results);
  
  console.log('\n💡 建议措施:');
  
  if (summary.successRate === 100) {
    console.log('🎉 所有配置检查通过！');
    console.log('下一步: 启动后端服务并测试实际数据同步');
  } else if (summary.successRate >= 75) {
    console.log('⚠️  部分配置需要调整');
    console.log('建议: 修复标记为❌的配置项');
  } else {
    console.log('❌ 配置存在较多问题');
    console.log('建议:');
    console.log('1. 检查环境变量配置');
    console.log('2. 确保云函数正确安装依赖');
    console.log('3. 验证小程序云开发环境');
    console.log('4. 检查网络连接和权限设置');
  }
  
  console.log('\n' + '='.repeat(50));
  console.log('检查完成！');
}

// 运行检查
main();