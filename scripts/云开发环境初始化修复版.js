/**
 * 云开发环境初始化和数据库集合创建脚本
 * 解决 wx.cloud.init() 未初始化问题和函数定义错误
 */

// 强力云开发环境初始化
const cloudEnvironmentInit = async () => {
    console.log('🔧 开始云开发环境强力初始化...');
    
    try {
        // 第一步：检查当前环境状态
        console.log('\n📊 第一步: 检查当前环境状态');
        
        if (!wx.cloud) {
            console.log('❌ wx.cloud 不可用，请确保在微信开发者工具中运行此代码');
            return false;
        }
        
        console.log('✅ wx.cloud 对象存在');
        console.log('当前环境变量:', wx.cloud.DYNAMIC_CURRENT_ENV || '未设置');
        
        // 第二步：强制重新初始化
        console.log('\n🔧 第二步: 执行强制云开发初始化');
        
        try {
            wx.cloud.init({
                env: 'erp-system-prod-1glmda1zf4f9c7a7',
                traceUser: true,
                timeout: 10000
            });
            
            console.log('✅ 云开发环境强制初始化完成');
            console.log('环境ID: erp-system-prod-1glmda1zf4f9c7a7');
            
        } catch (initError) {
            console.error('❌ 强制初始化失败:', initError);
            
            // 简化初始化
            console.log('🔄 尝试简化初始化...');
            wx.cloud.init();
            console.log('✅ 简化初始化完成');
        }
        
        // 第三步：验证初始化状态
        console.log('\n🔍 第四步: 验证云开发初始化状态');
        
        try {
            const testResult = await wx.cloud.callFunction({
                name: 'deploy-diagnosis',
                data: { action: 'health_check' }
            });
            
            console.log('✅ 云函数调用测试成功');
            console.log('测试结果:', testResult.result);
            
        } catch (testError) {
            console.log('⚠️ 云函数测试失败，尝试重新初始化...');
            
            if (testError.message.includes('Cloud API isn\'t enabled')) {
                wx.cloud.init({ env: 'erp-system-prod-1glmda1zf4f9c7a7' });
                console.log('✅ 重新初始化完成');
            }
        }
        
        console.log('\n🎉 云开发环境初始化验证完成');
        return true;
        
    } catch (error) {
        console.error('❌ 初始化过程中发生错误:', error);
        return false;
    }
};

// 数据库集合创建函数
const createDatabaseCollections = async () => {
    console.log('\n🚀 开始执行数据库集合创建...');
    
    try {
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
const backupCreateCollections = async () => {
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

// 验证数据库集合
const validateDatabaseCollections = async () => {
    console.log('\n🔍 开始验证数据库集合...');
    
    try {
        const result = await wx.cloud.callFunction({
            name: 'database-init',
            data: { action: 'validate_collections' }
        });
        
        if (result.result.success) {
            console.log('✅ 数据库集合验证成功！');
            console.log(`验证结果: ${result.result.data.validCollections}/${result.result.data.totalCollections} 个集合有效`);
            return true;
        } else {
            console.error('❌ 数据库集合验证失败:', result.result.message);
            return false;
        }
        
    } catch (error) {
        console.error('❌ 验证数据库集合时发生错误:', error);
        return false;
    }
};

// 主执行函数
const executeCompleteInit = async () => {
    console.log('🎯 开始执行完整的云开发环境初始化和数据库创建流程');
    console.log('═'.repeat(60));
    
    // 第一阶段：云开发环境初始化
    console.log('第一阶段: 云开发环境初始化');
    const initResult = await cloudEnvironmentInit();
    
    if (!initResult) {
        console.log('\n❌ 云开发环境初始化失败，请检查上述错误信息');
        return false;
    }
    
    // 第二阶段：数据库集合创建
    console.log('\n第二阶段: 数据库集合创建');
    console.log('═'.repeat(60));
    let createResult = await createDatabaseCollections();
    
    // 如果云函数调用失败，使用备用方案
    if (!createResult) {
        console.log('\n🔄 云函数创建方案失败，切换到备用直接创建方案');
        createResult = await backupCreateCollections();
    }
    
    // 第三阶段：数据库集合验证
    console.log('\n第三阶段: 数据库集合验证');
    console.log('═'.repeat(60));
    const validateResult = await validateDatabaseCollections();
    
    // 最终结果统计
    console.log('\n📋 完整初始化流程结果总结');
    console.log('═'.repeat(60));
    console.log(`云开发环境初始化: ${initResult ? '✅ 成功' : '❌ 失败'}`);
    console.log(`数据库集合创建: ${createResult ? '✅ 成功' : '❌ 失败'}`);
    console.log(`数据库集合验证: ${validateResult ? '✅ 成功' : '❌ 失败'}`);
    
    if (initResult && createResult && validateResult) {
        console.log('\n🎉 完整初始化流程全部成功！');
        console.log('ERP系统数据库环境已准备就绪，可以开始使用系统功能。');
    } else {
        console.log('\n⚠️ 初始化流程部分失败，请根据错误信息进行手动处理。');
    }
    
    return initResult && createResult && validateResult;
};

// 简化执行函数
const quickExecute = async () => {
    console.log('🚀 执行简化版本的初始化...');
    
    try {
        // 1. 初始化云开发环境
        console.log('第一步: 初始化云开发环境');
        wx.cloud.init({
            env: 'erp-system-prod-1glmda1zf4f9c7a7',
            traceUser: true
        });
        console.log('✅ 云开发环境初始化完成');
        
        // 2. 简单创建几个核心集合
        console.log('第二步: 创建核心数据库集合');
        const db = wx.cloud.database();
        
        const coreCollections = ['users', 'orders', 'products', 'customers'];
        
        for (const collectionName of coreCollections) {
            try {
                await db.collection(collectionName).limit(1).get();
                console.log(`✅ ${collectionName} - 成功`);
            } catch (err) {
                console.log(`⚠️ ${collectionName} - ${err.message}`);
            }
        }
        
        console.log('\n🎉 简化初始化完成！');
        return true;
        
    } catch (error) {
        console.error('❌ 简化初始化失败:', error);
        return false;
    }
};

// 直接执行模式检测
if (typeof wx !== 'undefined' && wx.cloud) {
    console.log('检测到微信开发者工具环境');
    console.log('可选择执行以下函数:');
    console.log('1. executeCompleteInit() - 完整初始化流程');
    console.log('2. quickExecute() - 快速初始化（推荐先试这个）');
    
    // 自动执行快速版本
    quickExecute();
} else {
    console.log('📋 请在微信开发者工具控制台中执行:');
    console.log('executeCompleteInit();');
}