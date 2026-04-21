/**
 * ERP系统数据库集合创建脚本
 * 在微信云开发环境中创建完整的数据库集合结构
 */

const createDatabaseCollections = async () => {
    console.log('=== 开始创建ERP系统数据库集合 ===');
    
    try {
        // 调用database-init云函数的create_collections action
        const result = await wx.cloud.callFunction({
            name: 'database-init',
            data: {
                action: 'create_collections',
                collections: [
                    // 用户管理集合
                    'users',           // 用户信息
                    'roles',           // 角色定义
                    'permissions',     // 权限定义
                    'user_roles',      // 用户角色关联
                    
                    // 客户管理集合  
                    'customers',       // 客户信息
                    
                    // 订单管理集合
                    'orders',          // 订单信息
                    'order_items',     // 订单明细
                    
                    // 产品管理集合
                    'products',        // 产品信息
                    'categories',      // 产品分类
                    'inventory',       // 库存信息
                    
                    // 生产管理集合
                    'production_orders', // 生产订单
                    'production_plans',  // 生产计划
                    
                    // 质量控制集合
                    'quality_checks',   // 质量检查记录
                    
                    // 物流管理集合
                    'shipping_records', // 发货记录
                    'delivery_tracking', // 配送追踪
                    
                    // 系统管理集合
                    'system_logs',      // 系统日志
                    'settings',         // 系统设置
                    'file_uploads',     // 文件上传记录
                    
                    // 同步状态集合
                    'sync_status'       // 数据同步状态
                ]
            }
        });
        
        console.log('数据库集合创建结果:', result.result);
        
        if (result.result.success) {
            console.log('✅ 数据库集合创建成功！');
            console.log(`成功创建 ${result.result.data.createdCount} 个集合`);
            
            // 显示创建的集合列表
            if (result.result.data.collections && result.result.data.collections.length > 0) {
                console.log('创建的集合列表:');
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
        console.error('创建数据库集合时发生错误:', error);
        
        // 提供备用创建方案
        console.log('\n=== 备用创建方案 ===');
        console.log('如果云函数调用失败，可以尝试以下备用方案:');
        
        const backupScript = `
            // 备用方案：直接在云开发控制台创建集合
            const createCollectionsDirect = async () => {
                try {
                    const collections = [
                        'users', 'roles', 'permissions', 'user_roles',
                        'customers', 'orders', 'order_items', 
                        'products', 'categories', 'inventory',
                        'production_orders', 'production_plans',
                        'quality_checks', 'shipping_records',
                        'delivery_tracking', 'system_logs',
                        'settings', 'file_uploads', 'sync_status'
                    ];
                    
                    console.log('开始创建数据库集合...');
                    
                    for (const collectionName of collections) {
                        try {
                            // 尝试创建集合（如果不存在会自动创建）
                            await wx.cloud.database().collection(collectionName).get();
                            console.log('✅ 集合 ' + collectionName + ' 已存在或创建成功');
                        } catch (err) {
                            console.log('⚠️  集合 ' + collectionName + ' 需要手动创建');
                        }
                    }
                    
                    console.log('集合创建检查完成');
                    
                } catch (error) {
                    console.error('备用创建方案失败:', error);
                }
            };
            
            createCollectionsDirect();
        `;
        
        console.log('备用方案代码:');
        console.log(backupScript);
        
        return false;
    }
};

// 创建基础数据的函数
const initializeBasicData = async () => {
    console.log('\n=== 开始初始化基础数据 ===');
    
    try {
        const result = await wx.cloud.callFunction({
            name: 'database-init',
            data: {
                action: 'initialize_basic_data'
            }
        });
        
        if (result.result.success) {
            console.log('✅ 基础数据初始化成功！');
            console.log('初始化内容包括:');
            if (result.result.data && result.result.data.initialized) {
                Object.keys(result.result.data.initialized).forEach(table => {
                    console.log(`  - ${table}: ${result.result.data.initialized[table]} 条记录`);
                });
            }
            return true;
        } else {
            console.error('❌ 基础数据初始化失败:', result.result.message);
            return false;
        }
        
    } catch (error) {
        console.error('初始化基础数据时发生错误:', error);
        return false;
    }
};

// 验证数据库集合的函数
const validateDatabaseCollections = async () => {
    console.log('\n=== 开始验证数据库集合 ===');
    
    try {
        const result = await wx.cloud.callFunction({
            name: 'database-init',
            data: {
                action: 'validate_collections'
            }
        });
        
        if (result.result.success) {
            console.log('✅ 数据库集合验证成功！');
            console.log('验证结果:');
            console.log(`  - 总集合数: ${result.result.data.totalCollections}`);
            console.log(`  - 有效集合数: ${result.result.data.validCollections}`);
            console.log(`  - 无效集合数: ${result.result.data.invalidCollections}`);
            
            if (result.result.data.collections && result.result.data.collections.length > 0) {
                console.log('\n集合详情:');
                result.result.data.collections.forEach(col => {
                    const status = col.isValid ? '✅' : '❌';
                    const docCount = col.documentCount !== undefined ? `(${col.documentCount} 文档)` : '';
                    console.log(`  ${status} ${col.name} ${docCount}`);
                });
            }
            
            return true;
        } else {
            console.error('❌ 数据库集合验证失败:', result.result.message);
            return false;
        }
        
    } catch (error) {
        console.error('验证数据库集合时发生错误:', error);
        return false;
    }
};

// 主执行函数
const executeDatabaseSetup = async () => {
    console.log('🚀 开始执行ERP系统数据库初始化');
    console.log('环境ID:', wx.cloud.DYNAMIC_CURRENT_ENV);
    
    let collectionResult = false;
    let dataResult = false;
    let validationResult = false;
    
    // 1. 创建数据库集合
    console.log('\n📋 第一步: 创建数据库集合');
    collectionResult = await createDatabaseCollections();
    
    // 2. 初始化基础数据
    if (collectionResult) {
        console.log('\n📊 第二步: 初始化基础数据');
        dataResult = await initializeBasicData();
    }
    
    // 3. 验证数据库集合
    if (collectionResult) {
        console.log('\n🔍 第三步: 验证数据库集合');
        validationResult = await validateDatabaseCollections();
    }
    
    // 总结报告
    console.log('\n📋 数据库初始化执行总结');
    console.log('═'.repeat(50));
    console.log(`数据库集合创建: ${collectionResult ? '✅ 成功' : '❌ 失败'}`);
    console.log(`基础数据初始化: ${dataResult ? '✅ 成功' : '❌ 失败'}`);
    console.log(`数据库验证: ${validationResult ? '✅ 成功' : '❌ 失败'}`);
    
    if (collectionResult && dataResult && validationResult) {
        console.log('\n🎉 ERP系统数据库初始化完全成功！');
        console.log('所有云函数和数据库集合都已就绪，可以开始使用系统了。');
    } else {
        console.log('\n⚠️  数据库初始化部分失败，请检查上述错误信息并重新执行。');
    }
    
    return {
        collections: collectionResult,
        data: dataResult,
        validation: validationResult,
        overall: collectionResult && dataResult && validationResult
    };
};

// 在控制台中直接调用执行
console.log('请在微信开发者工具控制台中执行以下代码:');
console.log('executeDatabaseSetup();');

// 如果自动执行
if (typeof wx !== 'undefined' && wx.cloud) {
    executeDatabaseSetup();
}