// 🔧 小程序登入功能修复脚本
// 在微信开发者工具控制台中执行此脚本

console.log('🚀 开始执行登入功能修复流程...');

// 1. 立即测试登录功能
function immediateLoginTest() {
    console.log('🔑 立即测试登录功能...');
    
    // 测试默认管理员账号
    const testCredentials = {
        username: 'admin',
        password: 'admin123'
    };
    
    console.log('📡 发送登录请求:', testCredentials);
    
    wx.cloud.callFunction({
        name: 'erp-api',
        data: {
            action: 'login',
            data: {
                data: {
                    username: testCredentials.username,
                    password: testCredentials.password
                }
            }
        }
    }).then(res => {
        console.log('✅ 登录测试返回:', res);
        
        if (res.result && res.result.success) {
            console.log('🎉 登录功能正常！');
            console.log('👤 用户信息:', res.result.data.user);
            console.log('🎫 Token:', res.result.data.token);
            
            // 保存登录信息
            wx.setStorageSync('userInfo', res.result.data.user);
            wx.setStorageSync('isLoggedIn', true);
            wx.setStorageSync('userToken', res.result.data.token);
            
            wx.showModal({
                title: '登录成功',
                content: '✅ 登录功能修复成功！\n\n用户: ' + res.result.data.user.username + '\n角色: ' + res.result.data.user.role,
                showCancel: false
            });
            
        } else if (res.success) {
            // 处理直接返回的情况
            console.log('✅ 登录成功（直接返回格式）:', res.data);
            
            wx.setStorageSync('userInfo', res.data.user);
            wx.setStorageSync('isLoggedIn', true);
            wx.setStorageSync('userToken', res.data.token);
            
            wx.showModal({
                title: '登录成功',
                content: '✅ 登录功能修复成功！\n\n用户: ' + res.data.user.username + '\n角色: ' + res.data.user.role,
                showCancel: false
            });
        } else {
            console.error('❌ 登录失败:', res.result?.message || res.message || '未知错误');
            handleLoginError(res);
        }
        
    }).catch(err => {
        console.error('❌ 登录测试异常:', err);
        handleLoginError(err);
    });
}

// 2. 处理登录错误
function handleLoginError(error) {
    console.log('🔍 分析登录错误...');
    
    if (error.errMsg && error.errMsg.includes('collection not exists')) {
        console.log('⚠️ 检测到数据库集合不存在');
        
        wx.showModal({
            title: '数据库未初始化',
            content: '检测到数据库集合不存在，是否立即初始化？\n\n初始化将创建：\n• 用户集合\n• 角色集合\n• 权限集合\n\n并创建默认管理员账号：\n账号：admin\n密码：admin123',
            success: (res) => {
                if (res.confirm) {
                    initializeDatabase();
                }
            }
        });
        
    } else if (error.errMsg && error.errMsg.includes('Cloud API isn\'t enabled')) {
        console.log('⚠️ 云开发环境未初始化');
        
        wx.showModal({
            title: '云开发环境未初始化',
            content: '云开发环境未初始化，请先初始化云开发环境',
            showCancel: false
        });
        
    } else if (error.errCode === -1) {
        console.log('⚠️ 网络连接异常');
        
        wx.showModal({
            title: '网络错误',
            content: '网络连接异常，请检查网络连接后重试',
            showCancel: false
        });
        
    } else {
        console.error('💥 其他错误:', error);
        
        wx.showModal({
            title: '登录失败',
            content: '登录失败: ' + (error.message || error.errMsg || '未知错误'),
            showCancel: false
        });
    }
}

// 3. 初始化数据库
function initializeDatabase() {
    console.log('🗄️ 开始初始化数据库...');
    
    wx.showLoading({
        title: '正在初始化数据库...',
        mask: true
    });
    
    wx.cloud.callFunction({
        name: 'database-init',
        data: {
            action: 'init'
        }
    }).then(res => {
        console.log('✅ 数据库初始化结果:', res);
        wx.hideLoading();
        
        if (res.result && res.result.success) {
            wx.showModal({
                title: '初始化成功',
                content: '✅ 数据库初始化成功！\n\n默认管理员账号：\n账号：admin\n密码：admin123\n\n请重新登录。',
                showCancel: false,
                success: () => {
                    // 重新测试登录
                    setTimeout(immediateLoginTest, 1000);
                }
            });
        } else {
            wx.showModal({
                title: '初始化失败',
                content: '数据库初始化失败：' + (res.result?.error || '未知错误'),
                showCancel: false
            });
        }
        
    }).catch(err => {
        console.error('❌ 数据库初始化失败:', err);
        wx.hideLoading();
        
        wx.showModal({
            title: '初始化失败',
            content: '数据库初始化失败：' + err.message + '\n\n请确保已部署 database-init 云函数',
            showCancel: false
        });
    });
}

// 4. 检查云函数状态
function checkCloudFunctions() {
    console.log('📡 检查云函数状态...');
    
    const functions = ['erp-api', 'database-init'];
    let checked = 0;
    let allGood = true;
    
    functions.forEach(funcName => {
        wx.cloud.callFunction({
            name: funcName,
            data: { action: 'ping' }
        }).then(res => {
            console.log(`✅ ${funcName} 云函数正常`);
            checked++;
            
            if (checked === functions.length && allGood) {
                console.log('🎉 所有云函数状态正常');
                immediateLoginTest();
            }
        }).catch(err => {
            console.error(`❌ ${funcName} 云函数异常:`, err);
            allGood = false;
            checked++;
            
            if (checked === functions.length) {
                wx.showModal({
                    title: '云函数异常',
                    content: '部分云函数未正确部署，请检查云函数状态',
                    showCancel: false
                });
            }
        });
    });
}

// 5. 完整的修复流程
function completeFixProcess() {
    console.log('🔧 开始完整的登入功能修复流程...');
    
    // 步骤1: 检查云函数状态
    checkCloudFunctions();
}

// 6. 快速修复（直接测试登录）
function quickFix() {
    console.log('⚡ 快速修复 - 直接测试登录');
    immediateLoginTest();
}

// 脚本加载完成提示
console.log('✅ 登入功能修复脚本已加载完成');
console.log('');
console.log('🔧 使用方法:');
console.log('   quickFix()        - 快速修复（推荐）');
console.log('   completeFixProcess() - 完整修复流程');
console.log('   immediateLoginTest() - 立即测试登录');
console.log('');
console.log('📝 测试账号:');
console.log('   默认管理员: admin / admin123');
console.log('');
console.log('🚀 建议操作:');
console.log('   1. 先执行: quickFix()');
console.log('   2. 如失败，执行: completeFixProcess()');
console.log('   3. 根据提示进行数据库初始化');

// 自动执行快速修复
console.log('');
console.log('⚡ 正在自动执行快速修复...');
setTimeout(quickFix, 1000);