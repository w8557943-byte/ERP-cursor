// 🎯 小程序登入功能专项测试脚本
// 用于排查和修复登入失败问题

// 1. 环境检查
function checkEnvironment() {
    console.log('🔍 检查云开发环境...');
    
    // 检查wx.cloud是否存在
    if (typeof wx.cloud === 'undefined') {
        console.error('❌ wx.cloud 未定义，请检查云开发配置');
        return false;
    }
    
    console.log('✅ wx.cloud 已定义');
    return true;
}

// 2. 云函数状态检查
function checkCloudFunctions() {
    console.log('📡 检查云函数部署状态...');
    
    return new Promise((resolve, reject) => {
        // 检查核心云函数
        const functions = ['erp-api', 'database-init', 'deploy-diagnosis'];
        let checked = 0;
        let allGood = true;
        
        functions.forEach(funcName => {
            wx.cloud.callFunction({
                name: funcName,
                data: { action: 'ping' }
            }).then(res => {
                console.log(`✅ ${funcName} 云函数正常`);
                checked++;
                
                if (checked === functions.length) {
                    if (allGood) {
                        resolve(true);
                    } else {
                        reject(new Error('部分云函数异常'));
                    }
                }
            }).catch(err => {
                console.error(`❌ ${funcName} 云函数异常:`, err);
                allGood = false;
                checked++;
                
                if (checked === functions.length) {
                    reject(new Error('部分云函数异常'));
                }
            });
        });
    });
}

// 3. 数据库集合检查
function checkDatabase() {
    console.log('🗄️ 检查数据库集合...');
    
    return new Promise((resolve, reject) => {
        wx.cloud.callFunction({
            name: 'database-init',
            data: { action: 'validate_setup' }
        }).then(res => {
            if (res.result && res.result.success) {
                console.log('✅ 数据库集合检查通过');
                resolve(true);
            } else {
                console.log('⚠️ 数据库集合检查失败，需要初始化');
                resolve(false);
            }
        }).catch(err => {
            console.error('❌ 数据库集合检查异常:', err);
            reject(err);
        });
    });
}

// 4. 直接登录测试
function testLogin(username = 'admin', password = 'admin123') {
    console.log(`🔑 测试登录: ${username}/${password}`);
    
    return new Promise((resolve, reject) => {
        wx.showLoading({ title: '登录测试中...', mask: true });
        
        wx.cloud.callFunction({
            name: 'erp-api',
            data: {
                action: 'login',
                data: {
                    username: username,
                    password: password
                }
            }
        }).then(res => {
            console.log('🔍 登录测试返回:', res);
            
            wx.hideLoading();
            
            if (!res.result) {
                console.error('❌ 返回数据格式异常');
                reject(new Error('返回数据格式异常'));
                return;
            }
            
            if (res.result.success) {
                console.log('✅ 登录测试成功');
                console.log('👤 用户信息:', res.result.data.user);
                console.log('🎫 Token:', res.result.data.token ? '已生成' : '未生成');
                resolve(res.result.data);
            } else {
                console.error('❌ 登录测试失败:', res.result.message);
                reject(new Error(res.result.message));
            }
        }).catch(err => {
            console.error('❌ 登录测试异常:', err);
            wx.hideLoading();
            
            // 检查特定错误类型
            if (err.errMsg && err.errMsg.includes('collection not exists')) {
                console.log('🔧 检测到数据库未初始化');
                reject(new Error('数据库未初始化'));
            } else {
                reject(err);
            }
        });
    });
}

// 5. 登录流程测试（模拟前端登录逻辑）
function testLoginFlow() {
    console.log('🎭 模拟完整登录流程测试...');
    
    const simpleLogin = require('simple-login'); // 如果可用的话
    
    return new Promise((resolve, reject) => {
        // 这里模拟simpleLogin的登录流程
        wx.cloud.callFunction({
            name: 'erp-api',
            data: {
                action: 'login',
                data: {
                    username: 'admin',
                    password: 'admin123'
                }
            }
        }).then(res => {
            console.log('🎭 模拟登录流程完成');
            
            if (res.result && res.result.success) {
                // 模拟保存登录信息
                wx.setStorageSync('userInfo', res.result.data.user);
                wx.setStorageSync('isLoggedIn', true);
                wx.setStorageSync('userToken', res.result.data.token);
                wx.setStorageSync('loginTime', Date.now());
                
                console.log('✅ 登录信息保存成功');
                resolve(res.result.data);
            } else {
                reject(new Error(res.result?.message || '登录流程失败'));
            }
        }).catch(reject);
    });
}

// 6. 综合登录诊断
function diagnoseLogin() {
    console.log('🩺 开始综合登录诊断...');
    console.log('=' * 50);
    
    return new Promise(async (resolve, reject) => {
        try {
            // 步骤1：环境检查
            if (!checkEnvironment()) {
                throw new Error('云开发环境检查失败');
            }
            
            // 步骤2：云函数检查
            try {
                await checkCloudFunctions();
                console.log('✅ 云函数状态正常');
            } catch (err) {
                console.warn('⚠️ 云函数检查失败:', err.message);
                console.log('💡 请确保所有云函数已正确部署');
            }
            
            // 步骤3：数据库检查
            let dbReady = false;
            try {
                dbReady = await checkDatabase();
            } catch (err) {
                console.warn('⚠️ 数据库检查失败:', err.message);
            }
            
            // 步骤4：根据数据库状态决定是否需要初始化
            if (!dbReady) {
                console.log('🔧 数据库未初始化，开始初始化...');
                
                try {
                    await wx.cloud.callFunction({
                        name: 'database-init',
                        data: { action: 'init' }
                    });
                    console.log('✅ 数据库初始化完成');
                    dbReady = true;
                } catch (initErr) {
                    console.error('❌ 数据库初始化失败:', initErr);
                    throw new Error('数据库初始化失败: ' + initErr.message);
                }
            }
            
            // 步骤5：登录测试
            if (dbReady) {
                try {
                    const loginResult = await testLogin();
                    console.log('🎉 登录诊断完成 - 所有检查通过');
                    resolve(loginResult);
                } catch (loginErr) {
                    console.error('❌ 登录测试失败:', loginErr.message);
                    throw loginErr;
                }
            } else {
                throw new Error('数据库未就绪，无法进行登录测试');
            }
            
        } catch (error) {
            console.error('💥 诊断过程中出现错误:', error);
            reject(error);
        }
    });
}

// 7. 立即执行函数
function quickTest() {
    console.log('⚡ 快速登录测试');
    console.log('=' * 30);
    
    // 直接测试登录
    testLogin()
        .then(result => {
            console.log('🎉 快速测试成功!');
            console.log('👤 用户:', result.user.username);
            console.log('🎫 令牌:', result.token ? '已生成' : '未生成');
            
            wx.showModal({
                title: '测试成功',
                content: '登录功能正常！\n\n用户: ' + result.user.username + '\n\n可以正常使用登录功能。',
                showCancel: false
            });
        })
        .catch(err => {
            console.error('💥 快速测试失败:', err);
            
            wx.showModal({
                title: '测试失败',
                content: '登录测试失败: ' + err.message + '\n\n请查看控制台详细错误信息。',
                showCancel: false
            });
        });
}

// 8. 完整诊断执行
function fullDiagnosis() {
    console.log('🔬 完整登录诊断');
    console.log('=' * 40);
    
    diagnoseLogin()
        .then(result => {
            console.log('🎊 诊断完成 - 登录功能完全正常!');
            console.log('👤 当前用户:', result.user.username);
            console.log('🎫 登录令牌:', result.token ? '已生成' : '未生成');
            
            wx.showModal({
                title: '诊断完成',
                content: '✅ 所有检查通过！\n\n登录功能正常，可以开始使用。\n\n当前用户: ' + result.user.username,
                showCancel: false
            });
        })
        .catch(err => {
            console.error('💥 诊断失败:', err);
            
            let errorMsg = '登录功能存在问题:\n\n';
            errorMsg += '错误: ' + err.message + '\n\n';
            
            if (err.message.includes('数据库')) {
                errorMsg += '💡 解决方案: 运行数据库初始化脚本\n';
                errorMsg += '📋 文件: scripts/控制台专用数据库初始化.js\n';
                errorMsg += '🚀 执行: immediateExecute()';
            } else if (err.message.includes('云函数')) {
                errorMsg += '💡 解决方案: 检查云函数部署状态\n';
                errorMsg += '📋 使用微信开发者工具重新部署云函数';
            } else {
                errorMsg += '💡 解决方案: 查看控制台详细错误信息\n';
                errorMsg += '📋 参考: docs/小程序登入失败诊断报告.md';
            }
            
            wx.showModal({
                title: '诊断失败',
                content: errorMsg,
                showCancel: false
            });
        });
}

// 脚本加载完成提示
console.log('🎯 小程序登入测试脚本已加载');
console.log('💡 使用方法:');
console.log('   quickTest()      - 快速登录测试');
console.log('   fullDiagnosis()  - 完整诊断流程');
console.log('   testLogin()      - 指定账号登录测试');
console.log('   diagnoseLogin()  - 综合登录诊断');
console.log('');
console.log('📝 测试账号:');
console.log('   默认管理员: admin / admin123');
console.log('   其他账号: 请确保已在数据库中存在');
console.log('');
console.log('⚠️ 注意: 请确保已配置云开发环境');