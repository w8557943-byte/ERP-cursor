/**
 * 数据库初始化脚本
 * 用于创建集合、索引和基础数据
 */

console.log('🗄️ 开始数据库初始化...\n');

// 数据库集合定义
const collections = [
  {
    name: 'users',
    description: '用户管理',
    indexes: [
      { field: 'openid', unique: true },
      { field: 'role' },
      { field: 'status' },
      { field: 'createTime' }
    ]
  },
  {
    name: 'customers',
    description: '客户管理',
    indexes: [
      { field: 'customerCode', unique: true },
      { field: 'name' },
      { field: 'phone' },
      { field: 'status' }
    ]
  },
  {
    name: 'products',
    description: '产品管理',
    indexes: [
      { field: 'productCode', unique: true },
      { field: 'category' },
      { field: 'sku' },
      { field: 'status' }
    ]
  },
  {
    name: 'orders',
    description: '订单管理',
    indexes: [
      { field: 'orderNo', unique: true },
      { field: 'customerId' },
      { field: 'status' },
      { field: 'createTime' },
      { field: 'deliveryDate' }
    ]
  },
  {
    name: 'order_items',
    description: '订单明细',
    indexes: [
      { field: 'orderId' },
      { field: 'productId' },
      { field: 'sku' }
    ]
  },
  {
    name: 'purchase_orders',
    description: '采购订单',
    indexes: [
      { field: 'orderNo', unique: true },
      { field: 'status' },
      { field: 'createTime' },
      { field: 'createdAt' },
      { field: 'supplierName' }
    ]
  },
  {
    name: 'inventory',
    description: '库存管理',
    indexes: [
      { field: 'productId' },
      { field: 'sku' },
      { field: 'warehouse' }
    ]
  },
  {
    name: 'production',
    description: '生产管理',
    indexes: [
      { field: 'productionNo', unique: true },
      { field: 'orderId' },
      { field: 'productId' },
      { field: 'status' },
      { field: 'createTime' }
    ]
  },
  {
    name: 'operation_logs',
    description: '操作日志',
    indexes: [
      { field: 'userId' },
      { field: 'action' },
      { field: 'module' },
      { field: 'createTime' }
    ]
  },
  {
    name: 'sync_changes',
    description: '同步变更记录',
    indexes: [
      { field: 'collection' },
      { field: 'docId' },
      { field: 'syncTime' },
      { field: 'status' }
    ]
  },
  {
    name: 'sync_errors',
    description: '同步错误记录',
    indexes: [
      { field: 'collection' },
      { field: 'docId' },
      { field: 'errorTime' },
      { field: 'errorType' }
    ]
  }
];

// 基础数据定义
// ⚠️ 注意: 不再包含默认密码,需要通过云函数创建管理员账户
const basicData = {
  users: [
    // 用户数据将通过 database-init 云函数的 create_admin 操作创建
    // 管理员账户需要在首次部署时通过环境变量 INITIAL_ADMIN_PASSWORD 设置
  ],

  customers: [
    {
      _id: 'customer_001',
      customerCode: 'C0001',
      name: '荣禾客户A',
      contact: '张经理',
      phone: '13900139001',
      address: '广东省深圳市南山区',
      status: 'active',
      createTime: new Date(),
      updateTime: new Date()
    },
    {
      _id: 'customer_002',
      customerCode: 'C0002',
      name: '荣禾客户B',
      contact: '李总',
      phone: '13900139002',
      address: '广东省深圳市福田区',
      status: 'active',
      createTime: new Date(),
      updateTime: new Date()
    }
  ],

  products: [
    {
      _id: 'product_001',
      productCode: 'P0001',
      name: '标准包装盒',
      category: '包装材料',
      sku: 'BOX-001',
      unit: '个',
      price: 2.50,
      status: 'active',
      description: '标准尺寸包装盒',
      createTime: new Date(),
      updateTime: new Date()
    },
    {
      _id: 'product_002',
      productCode: 'P0002',
      name: '定制标签贴纸',
      category: '标签印刷',
      sku: 'LABEL-001',
      unit: '张',
      price: 0.50,
      status: 'active',
      description: '定制化产品标签',
      createTime: new Date(),
      updateTime: new Date()
    }
  ]
};

// 微信小程序环境下的初始化函数
async function initializeDatabase() {
  if (typeof wx === 'undefined') {
    console.log('❌ 请在微信开发者工具控制台中运行此函数');
    return;
  }

  console.log('🚀 开始初始化数据库...');

  try {
    // 第一步：创建集合
    console.log('\n📁 创建数据库集合...');
    await wx.cloud.callFunction({
      name: 'database-init',
      data: {
        action: 'create_collections',
        collections: collections.map(c => c.name)
      }
    });
    console.log('✅ 集合创建完成');

    // 第二步：插入基础数据
    console.log('\n📊 插入基础数据...');

    // 插入用户数据
    await wx.cloud.callFunction({
      name: 'database-init',
      data: {
        action: 'seed_basic_data',
        data: {
          collection: 'users',
          documents: basicData.users
        }
      }
    });
    console.log('✅ 用户数据插入完成');

    // 插入客户数据
    await wx.cloud.callFunction({
      name: 'database-init',
      data: {
        action: 'seed_basic_data',
        data: {
          collection: 'customers',
          documents: basicData.customers
        }
      }
    });
    console.log('✅ 客户数据插入完成');

    // 插入产品数据
    await wx.cloud.callFunction({
      name: 'database-init',
      data: {
        action: 'seed_basic_data',
        data: {
          collection: 'products',
          documents: basicData.products
        }
      }
    });
    console.log('✅ 产品数据插入完成');

    // 第三步：验证初始化
    console.log('\n🔍 验证数据库初始化...');
    await wx.cloud.callFunction({
      name: 'database-init',
      data: {
        action: 'validate_setup'
      }
    });

    console.log('\n🎉 数据库初始化完成！');
    console.log('⚠️  请通过 database-init 云函数创建管理员账户');
    console.log('📝 使用 action: create_admin 并提供强密码');

  } catch (error) {
    console.error('❌ 数据库初始化失败:', error);
    throw error;
  }
}

// 快速初始化函数（仅插入必要数据）
async function quickInitialize() {
  if (typeof wx === 'undefined') {
    console.log('❌ 请在微信开发者工具控制台中运行此函数');
    return;
  }

  console.log('⚡ 快速初始化（仅创建集合和管理员账号）...');

  try {
    // 创建集合
    await wx.cloud.callFunction({
      name: 'database-init',
      data: {
        action: 'create_collections',
        collections: ['users', 'orders', 'products', 'customers']
      }
    });

    // 仅插入管理员账号
    await wx.cloud.callFunction({
      name: 'database-init',
      data: {
        action: 'seed_basic_data',
        data: {
          collection: 'users',
          documents: [basicData.users[0]] // 仅管理员
        }
      }
    });

    console.log('✅ 快速初始化完成！');
    console.log('⚠️  请创建管理员账户后才能登录');

  } catch (error) {
    console.error('❌ 快速初始化失败:', error);
  }
}

// 检查数据库状态
async function checkDatabaseStatus() {
  if (typeof wx === 'undefined') {
    console.log('❌ 请在微信开发者工具控制台中运行此函数');
    return;
  }

  console.log('📊 检查数据库状态...');

  const collectionNames = ['users', 'customers', 'products', 'orders'];

  for (const name of collectionNames) {
    try {
      const result = await wx.cloud.database().collection(name).count();
      console.log(`✅ ${name}: ${result.total} 条记录`);
    } catch (error) {
      console.log(`❌ ${name}: 不存在或无权限`);
    }
  }
}

// 导出函数
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    initializeDatabase,
    quickInitialize,
    checkDatabaseStatus,
    collections,
    basicData
  };
}

console.log('\n📯 数据库初始化脚本准备完成！');
console.log('💡 在微信开发者工具控制台中运行:');
console.log('   initializeDatabase() - 完整初始化');
console.log('   quickInitialize() - 快速初始化');
console.log('   checkDatabaseStatus() - 检查状态');