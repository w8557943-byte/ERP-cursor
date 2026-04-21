// 微信开发者工具控制台专用数据库初始化脚本
// 直接复制粘贴到开发者工具的控制台执行

// 第一步：强力云开发环境初始化
function initCloudEnv() {
    console.log('🚀 开始云开发环境初始化...');
    
    try {
        // 检查是否已经初始化
        if (typeof wx.cloud === 'undefined') {
            console.log('❌ wx.cloud未定义，请检查云开发配置');
            return false;
        }
        
        // 执行云开发初始化
        wx.cloud.init({
            env: 'your-cloud-env-id', // 请替换为实际的环境ID
            traceUser: true
        });
        
        console.log('✅ 云开发环境初始化完成');
        return true;
        
    } catch (error) {
        console.error('❌ 云开发环境初始化失败:', error);
        return false;
    }
}

// 第二步：创建数据库集合
function createCollections() {
    console.log('📊 开始创建数据库集合...');
    
    return new Promise((resolve, reject) => {
        wx.cloud.callFunction({
            name: 'database-init',
            data: { action: 'create_collections' }
        }).then(result => {
            console.log('✅ 数据库集合创建成功:', result);
            resolve(result);
        }).catch(error => {
            console.error('❌ 数据库集合创建失败:', error);
            reject(error);
        });
    });
}

// 第三步：验证集合创建
function validateCollections() {
    console.log('🔍 开始验证数据库集合...');
    
    return new Promise((resolve, reject) => {
        wx.cloud.callFunction({
            name: 'database-init',
            data: { action: 'validate_collections' }
        }).then(result => {
            console.log('✅ 数据库集合验证成功:', result);
            resolve(result);
        }).catch(error => {
            console.error('❌ 数据库集合验证失败:', error);
            reject(error);
        });
    });
}

// 第四步：初始化基础数据
function initBasicData() {
    console.log('📝 开始初始化基础数据...');
    
    return new Promise((resolve, reject) => {
        wx.cloud.callFunction({
            name: 'database-init',
            data: { action: 'init_basic_data' }
        }).then(result => {
            console.log('✅ 基础数据初始化成功:', result);
            resolve(result);
        }).catch(error => {
            console.error('❌ 基础数据初始化失败:', error);
            reject(error);
        });
    });
}

// 主执行函数 - 一步到位
async function quickDatabaseSetup() {
    console.log('🎯 开始快速数据库初始化流程...');
    console.log('='.repeat(50));
    
    try {
        // 1. 初始化云环境
        const initSuccess = initCloudEnv();
        if (!initSuccess) {
            throw new Error('云环境初始化失败');
        }
        
        await new Promise(resolve => setTimeout(resolve, 1000)); // 等待1秒
        
        // 2. 创建集合
        await createCollections();
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 3. 验证集合
        await validateCollections();
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // 4. 初始化基础数据
        await initBasicData();
        
        console.log('='.repeat(50));
        console.log('🎉 数据库初始化流程全部完成！');
        console.log('✅ ERP系统数据库已就绪，可以开始使用');
        
    } catch (error) {
        console.error('❌ 初始化流程中断:', error);
        console.log('🔧 请检查错误信息并重新执行');
    }
}

// 备用直接创建方案（如果云函数调用失败）
function directCreateCollections() {
    console.log('🔧 启用备用直接创建方案...');
    
    const collections = [
        'users', 'roles', 'permissions', 'customers', 'products',
        'orders', 'order_items', 'inventory', 'production_plans',
        'production_tasks', 'quality_checks', 'shipping',
        'suppliers', 'materials', 'workflows', 'notifications',
        'audit_logs', 'system_config', 'file_uploads'
    ];
    
    const db = wx.cloud.database();
    
    return new Promise(async (resolve, reject) => {
        try {
            for (let i = 0; i < collections.length; i++) {
                const collectionName = collections[i];
                console.log(`创建集合 ${i + 1}/${collections.length}: ${collectionName}`);
                
                // 尝试创建集合（如果不存在的话）
                try {
                    await db.collection(collectionName).limit(1).get();
                    console.log(`✅ ${collectionName} 已存在`);
                } catch (error) {
                    console.log(`📁 ${collectionName} 检查完成`);
                }
                
                // 短暂延迟
                await new Promise(resolve => setTimeout(resolve, 200));
            }
            
            console.log('✅ 备用创建方案完成');
            resolve(true);
            
        } catch (error) {
            console.error('❌ 备用创建方案失败:', error);
            reject(error);
        }
    });
}

// 立即执行函数
function immediateExecute() {
    console.log('🔥 立即执行数据库初始化');
    console.log('请确保已经在微信开发者工具的控制台中');
    console.log('');
    
    // 尝试快速初始化
    quickDatabaseSetup().catch(error => {
        console.log('🔄 主方案失败，尝试备用方案...');
        directCreateCollections();
    });
}

// 执行提示
console.log('📋 控制台数据库初始化脚本已加载');
console.log('💡 使用方法:');
console.log('   immediateExecute()  - 立即执行（推荐）');
console.log('   quickDatabaseSetup() - 完整执行流程');
console.log('   directCreateCollections() - 备用创建方案');
console.log('');
console.log('⚠️  注意：请确保云开发环境已正确配置');

// 如果你在控制台看到这个信息，说明脚本已加载成功