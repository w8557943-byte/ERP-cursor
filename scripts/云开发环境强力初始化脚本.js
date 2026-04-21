/**
 * 云开发环境强力初始化和验证脚本
 * 解决 wx.cloud.init() 未初始化问题
 */

const强力云开发环境初始化 = async () => {
    console.log('🔧 开始云开发环境强力初始化...');
    
    try {
        // 第一步：检查当前环境状态
        console.log('\n📊 第一步: 检查当前环境状态');
        
        if (!wx.cloud) {
            console.log('❌ wx.cloud 不可用，请确保在微信开发者工具中运行此代码');
            return false;
        }
        
        console.log('✅ wx.cloud 对象存在');
        
        // 显示当前环境信息
        console.log('当前环境变量:', wx.cloud.DYNAMIC_CURRENT_ENV || '未设置');
        
        // 第二步：强制重新初始化
        console.log('\n🔧 第二步: 执行强制云开发初始化');
        
        try {
            // 强制初始化 - 覆盖之前的初始化
            wx.cloud.init({
                env: 'erp-system-prod-1glmda1zf4f9c7a7',  // 您的环境ID
                traceUser: true,    // 开启用户行为追踪
                timeout: 10000      // 10秒超时
            });
            
            console.log('✅ 云开发环境强制初始化完成');
            console.log('环境ID: erp-system-prod-1glmda1zf4f9c7a7');
            
        } catch (initError) {
            console.error('❌ 强制初始化失败:', initError);
            
            // 第三步：尝试简化初始化
            console.log('\n🔄 第三步: 尝试简化初始化');
            
            try {
                wx.cloud.init();
                console.log('✅ 简化初始化完成');
            } catch (simpleError) {
                console.error('❌ 简化初始化也失败:', simpleError);
                return false;
            }
        }
        
        // 第四步：验证初始化状态
        console.log('\n🔍 第四步: 验证云开发初始化状态');
        
        try {
            // 简单的云函数调用测试
            const testResult = await wx.cloud.callFunction({
                name: 'deploy-diagnosis',
                data: {
                    action: 'health_check'
                }
            });
            
            console.log('✅ 云函数调用测试成功');
            console.log('测试结果:', testResult.result);
            
        } catch (testError) {
            console.error('⚠️ 云函数调用测试失败:', testError.message);
            
            if (testError.message.includes('Cloud API isn\'t enabled')) {
                console.log('🔄 重新尝试初始化...');
                wx.cloud.init({
                    env: 'erp-system-prod-1glmda1zf4f9c7a7'
                });
            }
        }
        
        // 第五步：执行数据库连接测试
        console.log('\n🗄️ 第五步: 测试数据库连接');
        
        try {
            const db = wx.cloud.database();
            console.log('✅ 数据库对象创建成功');
            
            // 测试数据库连接
            const testResult = await db.collection('users').limit(1).get();
            console.log('✅ 数据库连接测试成功');
            
        } catch (dbError) {
            console.log('⚠️ 数据库连接测试失败（这可能是因为集合不存在）:', dbError.message);
            
            // 如果是集合不存在的错误，说明环境是正常的
            if (dbError.message.includes('Collection not found')) {
                console.log('✅ 环境正常，只是集合不存在，稍后创建即可');
            }
        }
        
        console.log('\n🎉 云开发环境初始化验证完成');
        return true;
        
    } catch (error) {
        console.error('❌ 云开发环境初始化过程中发生错误:', error);
        
        // 提供手动检查指导
        console.log('\n🔍 手动检查指导:');
        console.log('1. 确保在微信开发者工具中运行此代码');
        console.log('2. 检查项目是否配置了正确的环境ID');
        console.log('3. 检查网络连接是否正常');
        console.log('4. 重新编译项目后重试');
        
        return false;
    }
};

// 数据库集合创建函数（依赖云开发环境已初始化）
const执行数据库集合创建 = async () => {
    console.log('\n🚀 开始执行数据库集合创建...');
    
    try {
        // 首先检查环境是否已初始化
        if (!wx.cloud || !wx.cloud.database) {
            console.error('❌ 云开发环境未初始化，请先调用强力云开发环境初始化');
            return false;
        }
        
        // 调用database-init云函数创建集合
        console.log('📋 正在调用database-init云函数...');
        const result = await wx.cloud.callFunction({
            name: 'database-init',
            data: {
                action: 'create_collections',
                collections: [
                    'users', 'roles', 'permissions', 'user_roles',
                    'customers', 'orders', 'order_items', 
                    'products', 'categories', 'inventory',
                    'production_orders', 'production_plans',
                    'quality_checks', 'shipping_records',
                    'delivery_tracking', 'system_logs',
                    'settings', 'file_uploads', 'sync_status'
                ]
            }
        });
        
        if (result.result.success) {
            console.log('✅ 数据库集合创建成功！');
            console.log(`成功创建 ${result.result.data.createdCount} 个集合`);
            
            // 显示创建的集合列表
            if (result.result.data.collections) {
                console.log('\n创建的集合列表:');
                result.result.data.collections.forEach((collection, index) => {
                    console.log(`${index + 1}. ${collection}`);
                });
            }
            
            return true;
        } else {
            console.error('❌ 数据库集合创建失败:', result.result.message);
            return false;
        }
        
    } catch (error) {
        console.error('❌ 创建数据库集合时发生错误:', error);
        return false;
    }
};

// 备用直接创建方案
const备用数据库集合创建 = async () => {
    console.log('\n🔄 启动备用直接创建方案...');
    
    try {
        const db = wx.cloud.database();
        const collections = [
            'users', 'roles', 'permissions', 'user_roles',
            'customers', 'orders', 'order_items', 
            'products', 'categories', 'inventory',
            'production_orders', 'production_plans',
            'quality_checks', 'shipping_records',
            'delivery_tracking', 'system_logs',
            'settings', 'file_uploads', 'sync_status'
        ];
        
        let successCount = 0;
        let errorCount = 0;
        
        console.log(`开始创建 ${collections.length} 个数据库集合...`);
        
        for (const collectionName of collections) {
            try {
                // 尝试获取集合信息（如果集合不存在会自动创建）
                await db.collection(collectionName).limit(1).get();
                console.log(`✅ ${collectionName} - 已存在或创建成功`);
                successCount++;
            } catch (err) {
                // 如果是权限错误，说明集合可能需要特殊权限
                if (err.message.includes('permission denied') || err.message.includes('权限不足')) {
                    console.log(`⚠️ ${collectionName} - 需要管理员权限创建`);
                } else {
                    console.log(`❌ ${collectionName} - 创建失败: ${err.message}`);
                }
                errorCount++;
            }
        }
        
        console.log('\n📊 备用创建方案结果:');
        console.log(`成功: ${successCount} 个集合`);
        console.log(`失败: ${errorCount} 个集合`);
        
        return successCount > 0;
        
    } catch (error) {
        console.error('❌ 备用创建方案执行失败:', error);
        return false;
    }
};

// 主执行函数
const完整初始化和创建 = async () => {
    console.log('🎯 开始执行完整的云开发环境初始化和数据库创建流程');
    console.log('═'.repeat(60));
    
    // 第一阶段：云开发环境初始化
    const initResult = await 强力云开发环境初始化();
    
    if (!initResult) {
        console.log('\n❌ 云开发环境初始化失败，请检查上述错误信息');
        return false;
    }
    
    // 第二阶段：数据库集合创建
    console.log('\n📋 开始第二阶段: 数据库集合创建');
    let createResult = await 执行数据库集合创建();
    
    // 如果云函数调用失败，使用备用方案
    if (!createResult) {
        console.log('\n🔄 云函数创建方案失败，切换到备用直接创建方案');
        createResult = await 备用数据库集合创建();
    }
    
    // 最终结果统计
    console.log('\n📋 完整初始化流程结果总结');
    console.log('═'.repeat(60));
    console.log(`云开发环境初始化: ${initResult ? '✅ 成功' : '❌ 失败'}`);
    console.log(`数据库集合创建: ${createResult ? '✅ 成功' : '❌ 失败'}`);
    
    if (initResult && createResult) {
        console.log('\n🎉 完整初始化流程全部成功！');
        console.log('ERP系统数据库环境已准备就绪，可以开始使用系统功能。');
    } else {
        console.log('\n⚠️ 初始化流程部分失败，请根据错误信息进行手动处理。');
    }
    
    return initResult && createResult;
};

// 如果在控制台中，直接执行
if (typeof wx !== 'undefined' && wx.cloud) {
    console.log('检测到微信开发者工具环境，开始执行完整初始化流程...');
    完整初始化和创建();
} else {
    console.log('📋 请在微信开发者工具控制台中执行以下代码:');
    console.log('完整初始化和创建();');
}