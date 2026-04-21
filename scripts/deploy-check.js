/**
 * 部署检查和指导脚本
 * 用于检查云函数部署状态并提供部署指导
 */

console.log('=== 荣禾ERP系统部署检查 ===');
console.log('');

// 检查必需的文件
import fs from 'node:fs';
import path from 'node:path';

const requiredFiles = [
  'cloudfunctions/erp-api/index.js',
  'cloudfunctions/erp-api/package.json',
  'cloudfunctions/database-init/index.js', 
  'cloudfunctions/database-init/package.json'
];

console.log('1. 检查云函数文件...');
let allFilesExist = true;

requiredFiles.forEach(file => {
  if (fs.existsSync(file)) {
    console.log('✅', file);
  } else {
    console.log('❌', file, '- 文件不存在');
    allFilesExist = false;
  }
});

if (!allFilesExist) {
  console.log('\n❌ 缺少必需的云函数文件，请检查文件完整性');
  process.exit(1);
}

console.log('\n2. 部署指导');
console.log('请在微信开发者工具中按以下步骤操作：');
console.log('');

console.log('=== 云函数部署步骤 ===');
console.log('A. 部署 erp-api 云函数：');
console.log('   1. 右键点击 cloudfunctions/erp-api 文件夹');
console.log('   2. 选择 "上传并部署：云端安装依赖"');
console.log('   3. 等待部署完成');
console.log('   4. 查看控制台确认部署成功');
console.log('');

console.log('B. 部署 database-init 云函数：');
console.log('   1. 右键点击 cloudfunctions/database-init 文件夹');
console.log('   2. 选择 "上传并部署：云端安装依赖"');
console.log('   3. 等待部署完成');
console.log('   4. 查看控制台确认部署成功');
console.log('');

console.log('=== 数据库初始化步骤 ===');
console.log('C. 初始化数据库：');
console.log('   1. 在小程序中访问页面: pages/db-init/db-init');
console.log('   2. 点击 "初始化数据库" 按钮');
console.log('   3. 等待初始化完成');
console.log('   4. 使用默认账号登录：admin / admin123');
console.log('');

console.log('=== 验证部署 ===');
console.log('D. 验证部署成功：');
console.log('   1. 在登录页面输入: admin / admin123');
console.log('   2. 点击登录按钮');
console.log('   3. 如果成功跳转到工作台，说明部署完成');
console.log('   4. 如果报错，查看控制台日志进一步调试');
console.log('');

console.log('=== 常见问题解决 ===');
console.log('1. 如果云函数部署失败：');
console.log('   - 检查网络连接');
console.log('   - 重新选择 "上传并部署：云端安装依赖"');
console.log('   - 查看云开发控制台的云函数列表');
console.log('');

console.log('2. 如果登录按钮无响应：');
console.log('   - 确认云函数部署成功');
console.log('   - 检查小程序基础库版本 >= 2.2.3');
console.log('   - 重新编译小程序');
console.log('');

console.log('3. 如果数据库初始化失败：');
console.log('   - 检查云开发环境权限');
console.log('   - 查看云开发控制台的数据库设置');
console.log('   - 确认云函数依赖安装成功');
console.log('');

console.log('部署完成后，系统将包含：');
console.log('- ✅ 用户管理系统');
console.log('- ✅ 客户信息管理'); 
console.log('- ✅ 产品库存管理');
console.log('- ✅ 订单创建跟踪');
console.log('- ✅ 生产进度管理');
console.log('- ✅ 数据同步功能');
console.log('');
console.log('=== 部署检查完成 ===');
