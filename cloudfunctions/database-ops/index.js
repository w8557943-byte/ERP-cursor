const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

// 数据库操作云函数
exports.main = async (event, context) => {
  const { action, data } = event;

  try {
    console.log(`[数据库操作] 操作: ${action}`);

    switch (action) {
      case 'init_collections':
        return await initCollections();
      case 'create_indexes':
        return await createIndexes();
      case 'seed_data':
        return await seedData(data);
      case 'backup_data':
        return await backupData(data);
      case 'restore_data':
        return await restoreData(data);
      case 'validate_schema':
        return await validateSchema(data);
      default:
        throw new Error(`不支持的操作: ${action}`);
    }
  } catch (error) {
    console.error('[数据库操作] 错误:', error);
    throw error;
  }
};

/**
 * 初始化数据集合
 */
async function initCollections() {
  const collections = [
    'orders', 'customers', 'products', 'users', 
    'inventory', 'production', 'sync_changes', 'sync_errors'
  ];

  const results = [];

  for (const collectionName of collections) {
    try {
      // 检查集合是否存在
      const collection = db.collection(collectionName);
      const count = await collection.count();

      results.push({
        collection: collectionName,
        exists: true,
        documentCount: count.total
      });

      console.log(`[初始化集合] ${collectionName}: ${count.total} 条记录`);
    } catch (error) {
      results.push({
        collection: collectionName,
        exists: false,
        error: error.message
      });
    }
  }

  return {
    success: true,
    collections: results,
    timestamp: Date.now()
  };
}

/**
 * 创建数据库索引
 */
async function createIndexes() {
  const indexConfigs = {
    orders: [
      { key: { orderNumber: 1 }, unique: true },
      { key: { createdAt: -1 } },
      { key: { status: 1 } },
      { key: { customerId: 1 } },
      { key: { 'items.productId': 1 } }
    ],
    products: [
      { key: { sku: 1 }, unique: true },
      { key: { categoryId: 1 } },
      { key: { updatedAt: -1 } },
      { key: { status: 1 } }
    ],
    customers: [
      { key: { companyName: 1 } },
      { key: { contactName: 1 } },
      { key: { createdAt: -1 } },
      { key: { status: 1 } }
    ],
    users: [
      { key: { username: 1 }, unique: true },
      { key: { email: 1 }, unique: true },
      { key: { role: 1 } },
      { key: { createdAt: -1 } }
    ],
    inventory: [
      { key: { productId: 1 }, unique: true },
      { key: { warehouseId: 1 } },
      { key: { updatedAt: -1 } }
    ],
    production: [
      { key: { orderId: 1 } },
      { key: { status: 1 } },
      { key: { scheduledDate: 1 } },
      { key: { createdAt: -1 } }
    ],
    sync_changes: [
      { key: { table: 1, timestamp: -1 } },
      { key: { clientId: 1, timestamp: -1 } },
      { key: { processed: 1 } }
    ],
    sync_errors: [
      { key: { createdAt: -1 } },
      { key: { clientId: 1 } },
      { key: { table: 1 } }
    ]
  };

  const results = [];

  for (const [collectionName, indexes] of Object.entries(indexConfigs)) {
    try {
      // 注意: 微信云开发的索引需要在控制台手动创建
      // 这里只是配置信息，实际索引创建需要通过控制台操作
      
      results.push({
        collection: collectionName,
        indexes: indexes,
        message: '索引配置已准备，请到云开发控制台创建索引'
      });

      console.log(`[索引配置] ${collectionName}: ${indexes.length} 个索引`);
    } catch (error) {
      results.push({
        collection: collectionName,
        error: error.message
      });
    }
  }

  return {
    success: true,
    results,
    timestamp: Date.now()
  };
}

/**
 * 种子数据
 */
async function seedData(options = {}) {
  const { collection, count = 10 } = options;
  
  const seedData = {
    products: generateSampleProducts(count),
    customers: generateSampleCustomers(count),
    users: generateSampleUsers(5)
  };

  const results = [];

  for (const [collectionName, data] of Object.entries(seedData)) {
    if (collection && collection !== collectionName) continue;

    try {
      const batch = db.collection(collectionName);
      const insertPromises = data.map(item => batch.add({ data: item }));
      
      const result = await Promise.all(insertPromises);
      
      results.push({
        collection: collectionName,
        inserted: result.length,
        success: true
      });

      console.log(`[种子数据] ${collectionName}: 插入了 ${result.length} 条记录`);
    } catch (error) {
      results.push({
        collection: collectionName,
        error: error.message,
        success: false
      });
    }
  }

  return {
    success: true,
    results,
    timestamp: Date.now()
  };
}

/**
 * 生成示例产品数据
 */
function generateSampleProducts(count) {
  const categories = ['纸箱', '包装材料', '印刷品', '标签'];
  const products = [];

  for (let i = 0; i < count; i++) {
    products.push({
      sku: `SKU${String(i + 1).padStart(4, '0')}`,
      name: `示例产品 ${i + 1}`,
      categoryId: categories[Math.floor(Math.random() * categories.length)],
      price: Math.round(Math.random() * 1000 * 100) / 100,
      cost: Math.round(Math.random() * 800 * 100) / 100,
      unit: '个',
      description: `这是产品 ${i + 1} 的描述`,
      status: 'active',
      createdAt: Date.now() - Math.random() * 86400000 * 30,
      updatedAt: Date.now(),
      _version: 1,
      _clientId: 'system'
    });
  }

  return products;
}

/**
 * 生成示例客户数据
 */
function generateSampleCustomers(count) {
  const customers = [];

  for (let i = 0; i < count; i++) {
    customers.push({
      companyName: `示例公司 ${i + 1}`,
      contactName: `联系人 ${i + 1}`,
      phone: `138${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
      email: `contact${i + 1}@example.com`,
      address: `示例地址 ${i + 1}号`,
      city: '示例城市',
      province: '示例省份',
      status: 'active',
      createdAt: Date.now() - Math.random() * 86400000 * 30,
      updatedAt: Date.now(),
      _version: 1,
      _clientId: 'system'
    });
  }

  return customers;
}

/**
 * 生成示例用户数据
 */
function generateSampleUsers(count) {
  const roles = ['admin', 'manager', 'user'];
  const users = [];

  for (let i = 0; i < count; i++) {
    users.push({
      username: `user${i + 1}`,
      email: `user${i + 1}@example.com`,
      role: roles[i % roles.length],
      status: 'active',
      createdAt: Date.now() - Math.random() * 86400000 * 30,
      updatedAt: Date.now(),
      _version: 1,
      _clientId: 'system'
    });
  }

  return users;
}

/**
 * 备份数据
 */
async function backupData(options = {}) {
  const { collections = [] } = options;
  
  const collectionsToBackup = collections.length > 0 ? collections : 
    ['orders', 'customers', 'products', 'users', 'inventory'];

  const backup = {
    timestamp: Date.now(),
    version: '1.0.0',
    collections: {}
  };

  for (const collectionName of collectionsToBackup) {
    try {
      const collection = db.collection(collectionName);
      const count = await collection.count();
      
      if (count.total > 0) {
        const data = await collection.limit(1000).get();
        backup.collections[collectionName] = {
          count: count.total,
          data: data.data
        };
      } else {
        backup.collections[collectionName] = {
          count: 0,
          data: []
        };
      }

      console.log(`[数据备份] ${collectionName}: ${count.total} 条记录`);
    } catch (error) {
      console.error(`[数据备份] ${collectionName} 失败:`, error);
      backup.collections[collectionName] = {
        error: error.message
      };
    }
  }

  return {
    success: true,
    backup,
    timestamp: Date.now()
  };
}

/**
 * 恢复数据
 */
async function restoreData(options = {}) {
  const { backup, clearFirst = false } = options;
  
  if (!backup || !backup.collections) {
    throw new Error('无效的备份数据');
  }

  const results = [];

  for (const [collectionName, collectionData] of Object.entries(backup.collections)) {
    try {
      if (clearFirst) {
        // 清空集合
        await db.collection(collectionName).where({}).remove();
      }

      if (collectionData.data && collectionData.data.length > 0) {
        // 批量插入数据
        const batch = db.collection(collectionName);
        const insertPromises = collectionData.data.map(item => 
          batch.add({ data: item })
        );
        
        const result = await Promise.all(insertPromises);
        
        results.push({
          collection: collectionName,
          restored: result.length,
          success: true
        });

        console.log(`[数据恢复] ${collectionName}: 恢复了 ${result.length} 条记录`);
      }
    } catch (error) {
      results.push({
        collection: collectionName,
        error: error.message,
        success: false
      });
    }
  }

  return {
    success: true,
    results,
    timestamp: Date.now()
  };
}

/**
 * 验证数据模式
 */
async function validateSchema(options = {}) {
  const { collection } = options;
  
  const schemaRules = {
    orders: {
      required: ['orderNumber', 'customerId', 'items', 'totalAmount'],
      types: {
        orderNumber: 'string',
        customerId: 'string',
        items: 'array',
        totalAmount: 'number'
      }
    },
    products: {
      required: ['sku', 'name', 'price'],
      types: {
        sku: 'string',
        name: 'string',
        price: 'number'
      }
    },
    customers: {
      required: ['companyName', 'contactName'],
      types: {
        companyName: 'string',
        contactName: 'string'
      }
    }
  };

  const results = [];

  for (const [collectionName, rules] of Object.entries(schemaRules)) {
    if (collection && collection !== collectionName) continue;

    try {
      const collectionRef = db.collection(collectionName);
      const count = await collectionRef.count();
      
      if (count.total > 0) {
        const sampleData = await collectionRef.limit(10).get();
        const validation = validateCollectionData(sampleData.data, rules);
        
        results.push({
          collection: collectionName,
          totalRecords: count.total,
          sampledRecords: sampleData.data.length,
          validation,
          success: true
        });
      } else {
        results.push({
          collection: collectionName,
          totalRecords: 0,
          message: '集合为空',
          success: true
        });
      }
    } catch (error) {
      results.push({
        collection: collectionName,
        error: error.message,
        success: false
      });
    }
  }

  return {
    success: true,
    results,
    timestamp: Date.now()
  };
}

/**
 * 验证集合数据
 */
function validateCollectionData(data, rules) {
  const { required, types } = rules;
  const issues = [];

  data.forEach((record, index) => {
    // 检查必需字段
    required.forEach(field => {
      if (!(field in record)) {
        issues.push(`记录 ${index}: 缺少必需字段 '${field}'`);
      }
    });

    // 检查字段类型
    Object.entries(types).forEach(([field, expectedType]) => {
      if (field in record && typeof record[field] !== expectedType) {
        issues.push(`记录 ${index}: 字段 '${field}' 类型错误，期望 ${expectedType}，实际 ${typeof record[field]}`);
      }
    });
  });

  return {
    issues,
    validRecords: data.length - issues.length,
    totalIssues: issues.length
  };
}