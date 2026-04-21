const cloud = require('wx-server-sdk');

// 初始化云开发
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * 数据库集合创建和初始化执行脚本
 * 用于荣禾ERP系统数据库的完整设置
 */
class DatabaseInitializer {
  
  /**
   * 执行完整的数据库初始化
   */
  static async initializeComplete() {
    console.log('🚀 开始荣禾ERP数据库完整初始化...');
    
    try {
      // 第一步：验证数据库连接
      console.log('步骤1: 验证数据库连接');
      const connectionTest = await this.testDatabaseConnection();
      if (!connectionTest.success) {
        throw new Error('数据库连接失败：' + connectionTest.error);
      }
      console.log('✅ 数据库连接成功');
      
      // 第二步：创建数据集合
      console.log('步骤2: 创建数据集合');
      const createResult = await this.createCollections();
      console.log('✅ 集合创建结果:', createResult);
      
      // 第三步：设置数据库索引
      console.log('步骤3: 设置数据库索引');
      const indexResult = await this.setupIndexes();
      console.log('✅ 索引设置结果:', indexResult);
      
      // 第四步：配置集合权限
      console.log('步骤4: 配置集合权限');
      const permissionResult = await this.setupPermissions();
      console.log('✅ 权限配置结果:', permissionResult);
      
      // 第五步：插入基础数据
      console.log('步骤5: 插入基础数据');
      const seedResult = await this.seedBasicData();
      console.log('✅ 基础数据插入结果:', seedResult);
      
      // 第六步：验证初始化结果
      console.log('步骤6: 验证初始化结果');
      const validationResult = await this.validateSetup();
      console.log('✅ 验证结果:', validationResult);
      
      // 返回完整的初始化结果
      return {
        success: true,
        message: '荣禾ERP数据库初始化成功！',
        details: {
          connection: connectionTest,
          collections: createResult,
          indexes: indexResult,
          permissions: permissionResult,
          seedData: seedResult,
          validation: validationResult
        },
        timestamp: new Date().toISOString()
      };
      
    } catch (error) {
      console.error('❌ 数据库初始化失败:', error);
      return {
        success: false,
        error: error.message,
        timestamp: new Date().toISOString()
      };
    }
  }
  
  /**
   * 测试数据库连接
   */
  static async testDatabaseConnection() {
    try {
      const db = cloud.database();
      const test = await db.collection('users').where({}).limit(1).get();
      return { success: true, message: '数据库连接正常' };
    } catch (error) {
      return { success: false, error: error.message };
    }
  }
  
  /**
   * 创建所有必要的数据集合
   */
  static async createCollections() {
    const db = cloud.database();
    const collections = [
      'users', 'customers', 'products', 'orders', 'order_items',
      'inventory', 'production', 'operation_logs', 'sync_changes', 'sync_errors'
    ];
    
    const results = [];
    
    for (const collectionName of collections) {
      try {
        const collectionRef = db.collection(collectionName);
        const count = await collectionRef.count();
        
        results.push({
          name: collectionName,
          exists: true,
          documentCount: count.total,
          status: 'ready'
        });
        
        console.log(`✅ 集合 ${collectionName} 验证成功 (${count.total} 条记录)`);
      } catch (error) {
        console.log(`⚠️ 集合 ${collectionName} 需要手动创建:`, error.message);
        results.push({
          name: collectionName,
          exists: false,
          error: error.message,
          status: 'needs_manual_creation'
        });
      }
    }
    
    const readyCount = results.filter(r => r.status === 'ready').length;
    const totalCount = results.length;
    
    return {
      success: readyCount === totalCount,
      results,
      summary: {
        total: totalCount,
        ready: readyCount,
        needsManual: totalCount - readyCount
      }
    };
  }
  
  /**
   * 设置数据库索引
   */
  static async setupIndexes() {
    // 索引设置需要在控制台手动完成，这里提供配置信息
    const indexConfigs = {
      users: [
        { key: { username: 1 }, unique: true, name: 'username_unique' },
        { key: { email: 1 }, unique: true, name: 'email_unique' },
        { key: { role: 1 }, name: 'role_index' },
        { key: { status: 1 }, name: 'status_index' }
      ],
      products: [
        { key: { sku: 1 }, unique: true, name: 'sku_unique' },
        { key: { category: 1 }, name: 'category_index' },
        { key: { status: 1 }, name: 'status_index' }
      ],
      orders: [
        { key: { orderNumber: 1 }, unique: true, name: 'orderNumber_unique' },
        { key: { customerId: 1 }, name: 'customerId_index' },
        { key: { status: 1 }, name: 'status_index' }
      ]
    };
    
    console.log('📋 索引配置信息:');
    for (const [collection, indexes] of Object.entries(indexConfigs)) {
      console.log(`集合 ${collection}:`, indexes.map(idx => idx.name).join(', '));
    }
    
    return {
      success: true,
      message: '索引配置信息已输出，请手动在云开发控制台创建索引',
      configs: indexConfigs
    };
  }
  
  /**
   * 配置集合权限
   */
  static async setupPermissions() {
    // 权限配置需要在控制台手动完成
    const permissionRules = {
      read: 'auth != null',
      write: 'auth != null'
    };
    
    console.log('🔐 建议的权限配置:');
    console.log('所有集合:');
    console.log('  读权限:', permissionRules.read);
    console.log('  写权限:', permissionRules.write);
    
    return {
      success: true,
      message: '权限配置信息已输出，请手动在云开发控制台设置',
      rules: permissionRules
    };
  }
  
  /**
   * 插入基础种子数据
   */
  static async seedBasicData() {
    const db = cloud.database();
    const _ = db.command;
    const results = [];
    
    // 示例用户数据
    const sampleUsers = [
      {
        username: 'admin',
        email: 'admin@rongjiahe.tech',
        realName: '系统管理员',
        role: 'admin',
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        username: 'manager',
        email: 'manager@rongjiahe.tech',
        realName: '业务经理',
        role: 'manager',
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ];
    
    // 插入用户数据
    try {
      for (const user of sampleUsers) {
        await db.collection('users').add({ data: user });
      }
      results.push({ collection: 'users', inserted: sampleUsers.length, success: true });
      console.log(`✅ 成功插入 ${sampleUsers.length} 个用户`);
    } catch (error) {
      results.push({ collection: 'users', error: error.message, success: false });
      console.log('❌ 用户数据插入失败:', error.message);
    }
    
    // 示例产品数据
    const sampleProducts = [
      {
        sku: 'RJ-001',
        name: '快递纸箱A3',
        category: '纸箱',
        price: 3.5,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now()
      },
      {
        sku: 'RJ-002',
        name: '食品包装盒B2',
        category: '包装盒',
        price: 1.8,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now()
      }
    ];
    
    // 插入产品数据
    try {
      for (const product of sampleProducts) {
        await db.collection('products').add({ data: product });
      }
      results.push({ collection: 'products', inserted: sampleProducts.length, success: true });
      console.log(`✅ 成功插入 ${sampleProducts.length} 个产品`);
    } catch (error) {
      results.push({ collection: 'products', error: error.message, success: false });
      console.log('❌ 产品数据插入失败:', error.message);
    }
    
    const totalInserted = results.reduce((sum, r) => sum + (r.inserted || 0), 0);
    
    return {
      success: totalInserted > 0,
      results,
      summary: {
        totalInserted,
        successCount: results.filter(r => r.success).length
      }
    };
  }
  
  /**
   * 验证数据库设置
   */
  static async validateSetup() {
    const db = cloud.database();
    const expectedCollections = [
      'users', 'customers', 'products', 'orders', 'order_items',
      'inventory', 'production', 'operation_logs', 'sync_changes', 'sync_errors'
    ];
    
    const results = [];
    
    for (const collectionName of expectedCollections) {
      try {
        const collectionRef = db.collection(collectionName);
        const count = await collectionRef.count();
        
        results.push({
          collection: collectionName,
          exists: true,
          documentCount: count.total,
          status: 'ready'
        });
      } catch (error) {
        results.push({
          collection: collectionName,
          exists: false,
          error: error.message,
          status: 'missing'
        });
      }
    }
    
    const readyCollections = results.filter(r => r.status === 'ready').length;
    const totalCollections = results.length;
    
    console.log('📊 验证结果摘要:');
    console.log(`✅ 已就绪集合: ${readyCollections}/${totalCollections}`);
    console.log(`📝 就绪率: ${Math.round((readyCollections/totalCollections)*100)}%`);
    
    return {
      success: readyCollections === totalCollections,
      results,
      summary: {
        total: totalCollections,
        ready: readyCollections,
        readyPercentage: Math.round((readyCollections/totalCollections)*100)
      }
    };
  }
}

// 导出类供外部调用
module.exports = DatabaseInitializer;

/**
 * 直接执行初始化 (当作为独立脚本运行时)
 */
if (require.main === module) {
  DatabaseInitializer.initializeComplete().then(result => {
    console.log('\n🎉 初始化完成!');
    console.log(JSON.stringify(result, null, 2));
  }).catch(error => {
    console.error('初始化过程中发生错误:', error);
  });
}