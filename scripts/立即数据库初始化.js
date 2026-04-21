// 🚀 立即数据库初始化脚本
// 在微信开发者工具控制台中执行此脚本

console.log('🚀 开始执行立即数据库初始化...');

// 立即执行函数
(function() {
    
    // 1. 检查当前环境
    console.log('📡 检查云开发环境...');
    
    if (!wx.cloud) {
        console.error('❌ 云开发环境未初始化');
        wx.showModal({
            title: '错误',
            content: '云开发环境未初始化，请先初始化云开发环境',
            showCancel: false
        });
        return;
    }
    
    // 2. 立即调用数据库初始化云函数
    console.log('🗄️ 调用 database-init 云函数...');
    
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
            console.log('🎉 数据库初始化成功！');
            console.log('📊 创建的集合:', res.result.collections);
            console.log('👤 默认管理员账号:', res.result.defaultUser);
            
            wx.showModal({
                title: '初始化成功',
                content: '✅ 数据库初始化成功！\n\n' + 
                        '已创建集合：' + (res.result.collections || []).join(', ') + '\n\n' +
                        '默认管理员账号：\n' +
                        '账号：admin\n' +
                        '密码：admin123\n\n' +
                        '现在可以使用管理员账号登录了！',
                showCancel: false,
                success: () => {
                    // 3秒后自动跳转到登录页面
                    setTimeout(() => {
                        console.log('🔄 准备跳转到登录页面...');
                        wx.redirectTo({
                            url: '/pages/login/login'
                        });
                    }, 3000);
                }
            });
            
        } else {
            console.error('❌ 数据库初始化失败:', res.result?.error || '未知错误');
            
            wx.showModal({
                title: '初始化失败',
                content: '数据库初始化失败：' + (res.result?.error || '未知错误') + '\n\n请检查云函数日志',
                showCancel: false
            });
        }
        
    }).catch(err => {
        console.error('❌ 数据库初始化异常:', err);
        wx.hideLoading();
        
        let errorMsg = err.errMsg || err.message || '未知错误';
        
        if (errorMsg.includes('cloud function service error')) {
            errorMsg = '云函数调用失败，请确保已部署 database-init 云函数';
        } else if (errorMsg.includes('function not found')) {
            errorMsg = 'database-init 云函数不存在，请先部署该云函数';
        } else if (errorMsg.includes('timeout')) {
            errorMsg = '云函数调用超时，请检查网络连接';
        }
        
        wx.showModal({
            title: '初始化失败',
            content: '数据库初始化失败：' + errorMsg,
            showCancel: false
        });
    });
    
})();

// 备用函数：如果云函数方式失败，可以直接创建集合
function createCollectionsDirectly() {
    console.log('🔄 尝试直接创建数据库集合...');
    
    const db = wx.cloud.database();
    const collections = ['users', 'roles', 'permissions', 'orders', 'customers', 'products'];
    
    wx.showLoading({
        title: '正在创建集合...',
        mask: true
    });
    
    let successCount = 0;
    let failedCount = 0;
    
    collections.forEach((collectionName, index) => {
        setTimeout(() => {
            db.collection(collectionName).limit(1).get().then(res => {
                console.log(`✅ 集合 ${collectionName} 已存在`);
                successCount++;
                
                if (successCount + failedCount === collections.length) {
                    wx.hideLoading();
                    showDirectCreateResult(successCount, failedCount);
                }
            }).catch(err => {
                console.log(`⚠️ 集合 ${collectionName} 不存在，需要创建`);
                
                // 尝试通过添加文档来创建集合
                db.collection(collectionName).add({
                    data: {
                        _init: true,
                        createTime: new Date()
                    }
                }).then(() => {
                    console.log(`✅ 集合 ${collectionName} 创建成功`);
                    successCount++;
                }).catch(createErr => {
                    console.error(`❌ 集合 ${collectionName} 创建失败:`, createErr);
                    failedCount++;
                }).finally(() => {
                    if (successCount + failedCount === collections.length) {
                        wx.hideLoading();
                        showDirectCreateResult(successCount, failedCount);
                    }
                });
            });
        }, index * 500); // 每500ms创建一个集合，避免并发问题
    });
}

function showDirectCreateResult(successCount, failedCount) {
    const total = successCount + failedCount;
    
    if (failedCount === 0) {
        wx.showModal({
            title: '创建成功',
            content: `✅ 成功创建 ${successCount}/${total} 个集合！\n\n现在可以重新尝试登录了。`,
            showCancel: false,
            success: () => {
                setTimeout(() => {
                    wx.redirectTo({
                        url: '/pages/login/login'
                    });
                }, 2000);
            }
        });
    } else {
        wx.showModal({
            title: '部分成功',
            content: `⚠️ 创建结果：${successCount} 个成功，${failedCount} 个失败\n\n请检查错误日志后重试。`,
            showCancel: false
        });
    }
}

console.log('📋 使用方法：');
console.log('1. 直接执行：立即数据库初始化');
console.log('2. 备用方案：createCollectionsDirectly()');
console.log('3. 检查状态：在云开发控制台查看集合是否创建成功');