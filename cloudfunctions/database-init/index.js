const cloud = require('wx-server-sdk');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

/**
 * 数据库初始化云函数
 * 提供数据库集合创建、索引设置、种子数据等功能
 */
exports.main = async (event, context) => {
  const { action, data = {} } = event;
  const wxContext = cloud.getWXContext();

  console.log(`[数据库初始化] 操作: ${action}`);

  try {
    switch (action) {
      case 'init':
        return await initializeDatabase();
      case 'create_collections':
        return await createCollections();
      case 'setup_indexes':
        return await setupIndexes();
      case 'seed_basic_data':
        return await seedBasicData(data);
      case 'setup_permissions':
        return await setupPermissions();
      case 'validate_setup':
        return await validateSetup();
      case 'reset_database':
        return await resetDatabase(data);
      case 'reset_admin_password':
        return await resetAdminPassword(data, wxContext);
      default:
        throw new Error(`不支持的操作: ${action}`);
    }
  } catch (error) {
    console.error(`[数据库初始化] ${action} 失败:`, error);

    return {
      success: false,
      error: error.message,
      action,
      timestamp: Date.now()
    };
  }
};

async function resetAdminPassword(data = {}, wxContext) {
  const username = typeof data.username === 'string' ? data.username.trim() : String(data.username || '13817508995').trim();
  const inputPassword = (typeof data.newPassword === 'string' ? data.newPassword : String(data.newPassword || '')).trim();
  const isGenerated = !inputPassword;
  let newPassword = inputPassword;
  if (isGenerated) {
    for (let i = 0; i < 20; i += 1) {
      const candidate = crypto.randomBytes(18).toString('base64url');
      const ok = candidate.length >= 10 && /[a-zA-Z]/.test(candidate) && /\d/.test(candidate);
      if (ok) {
        newPassword = candidate;
        break;
      }
    }
    if (!newPassword) {
      newPassword = crypto.randomBytes(24).toString('base64url');
    }
  }
  const now = Date.now();
  const updatedBy = (wxContext && (wxContext.OPENID || wxContext.APPID)) ? String(wxContext.OPENID || wxContext.APPID) : 'system';

  if (!username) {
    return { success: false, error: '用户名不能为空' };
  }
  const looksStrong = newPassword.length >= 10 && /[a-zA-Z]/.test(newPassword) && /\d/.test(newPassword);
  if (!looksStrong) {
    return { success: false, error: '新密码至少10位，且包含字母与数字' };
  }

  // 并行查询 username 和 phone
  const queries = [
    db.collection('users').where({ username }).limit(20).get()
      .then(res => res.data || [])
      .catch(e => { console.error('[reset] username查询失败', e); return []; })
  ];

  if (/^1[3-9]\d{9}$/.test(username)) {
    queries.push(
      db.collection('users').where({ phone: username }).limit(20).get()
        .then(res => res.data || [])
        .catch(e => { console.error('[reset] phone查询失败', e); return []; })
    );
  }

  const results = await Promise.all(queries);

  // 合并结果并去重
  const userMap = new Map();
  results.flat().forEach(u => {
    if (u && u._id) {
      userMap.set(String(u._id), u);
    }
  });

  const list = Array.from(userMap.values());

  if (!list.length) {
    // 如果未找到用户，直接创建一个新的
    console.log('[reset] 未找到管理员账号，将创建新账号');
    const passwordHash = bcrypt.hashSync(newPassword, 10);
    const newAdmin = {
      _id: 'admin_' + Date.now(),
      username: username,
      phone: username, // 确保手机号也设置
      email: 'admin@rongjiahe.tech',
      realName: '系统管理员',
      role: 'admin',
      status: 'active',
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
      createdBy: 'system',
      updatedBy: updatedBy
    };
    await db.collection('users').add({ data: newAdmin });
    return {
      success: true,
      message: '管理员账号不存在，已自动创建',
      data: { username, action: 'created', newPassword }
    };
  }

  // 找到现有账号，执行"合并与重置"
  // 1. 保留第一个账号作为主账号
  // 2. 删除其余重复账号
  // 3. 更新主账号信息

  const survivor = list[0];
  const survivorId = survivor._id;
  const duplicates = list.slice(1);

  // 删除重复项
  if (duplicates.length > 0) {
    console.log(`[reset] 删除 ${duplicates.length} 个重复管理员账号`);
    const deletePromises = duplicates.map(u => db.collection('users').doc(u._id).remove());
    await Promise.all(deletePromises);
  }

  const passwordHash = bcrypt.hashSync(newPassword, 10);

  // 更新主账号
  await db.collection('users').doc(survivorId).update({
    data: {
      password: passwordHash,
      username: username, // 强制修正用户名
      phone: username,    // 强制修正手机号
      role: 'admin',      // 确保有管理员权限
      status: 'active',   // 确保账号未被禁用
      updatedAt: now,
      updatedBy: updatedBy
    }
  });

  return {
    success: true,
    message: '管理员密码已重置 (已清理重复账号)',
    data: {
      username,
      newPassword,
      updatedId: survivorId,
      deletedCount: duplicates.length,
      updatedAt: now
    }
  };
}

/**
 * 完整初始化数据库
 */
async function initializeDatabase() {
  console.log('[数据库初始化] 开始完整初始化...');

  const results = {
    createCollections: null,
    setupIndexes: null,
    setupPermissions: null,
    seedData: null
  };

  // 1. 创建集合
  console.log('[数据库初始化] 步骤1/4: 创建数据集合');
  results.createCollections = await createCollections();

  // 2. 设置索引
  console.log('[数据库初始化] 步骤2/4: 设置数据库索引');
  results.setupIndexes = await setupIndexes();

  // 3. 设置权限
  console.log('[数据库初始化] 步骤3/4: 设置集合权限');
  results.setupPermissions = await setupPermissions();

  // 4. 插入种子数据
  console.log('[数据库初始化] 步骤4/4: 插入基础数据');
  results.seedData = await seedBasicData();

  console.log('[数据库初始化] 数据库初始化完成');

  return {
    success: true,
    message: '荣禾ERP数据库初始化成功',
    results,
    timestamp: Date.now()
  };
}

/**
 * 创建数据集合
 */
async function createCollections() {
  const requiredCollections = [
    {
      name: 'users',
      description: '用户表',
      fields: {
        _id: 'String',
        username: 'String',
        email: 'String',
        role: 'String',
        status: 'String',
        createdAt: 'Number',
        updatedAt: 'Number',
        createdBy: 'String',
        updatedBy: 'String'
      }
    },
    {
      name: 'customers',
      description: '客户表',
      fields: {
        _id: 'String',
        companyName: 'String',
        contactName: 'String',
        phone: 'String',
        email: 'String',
        address: 'String',
        status: 'String',
        createdAt: 'Number',
        updatedAt: 'Number',
        createdBy: 'String',
        updatedBy: 'String'
      }
    },
    {
      name: 'products',
      description: '产品表',
      fields: {
        _id: 'String',
        sku: 'String',
        name: 'String',
        category: 'String',
        description: 'String',
        price: 'Number',
        unit: 'String',
        status: 'String',
        createdAt: 'Number',
        updatedAt: 'Number',
        createdBy: 'String',
        updatedBy: 'String'
      }
    },
    {
      name: 'orders',
      description: '订单表',
      fields: {
        _id: 'String',
        orderNumber: 'String',
        customerId: 'String',
        items: 'Array',
        totalAmount: 'Number',
        status: 'String',
        deliveryDate: 'Number',
        notes: 'String',
        createdAt: 'Number',
        updatedAt: 'Number',
        createdBy: 'String',
        updatedBy: 'String',
        _version: 'Number'
      }
    },
    {
      name: 'order_items',
      description: '订单明细表',
      fields: {
        _id: 'String',
        orderId: 'String',
        productId: 'String',
        quantity: 'Number',
        unitPrice: 'Number',
        totalPrice: 'Number',
        createdAt: 'Number',
        updatedAt: 'Number'
      }
    },
    {
      name: 'inventory',
      description: '库存表',
      fields: {
        _id: 'String',
        productId: 'String',
        warehouseId: 'String',
        quantity: 'Number',
        minStock: 'Number',
        location: 'String',
        createdAt: 'Number',
        updatedAt: 'Number',
        createdBy: 'String',
        updatedBy: 'String'
      }
    },
    {
      name: 'production',
      description: '生产计划表',
      fields: {
        _id: 'String',
        orderId: 'String',
        productId: 'String',
        plannedQuantity: 'Number',
        actualQuantity: 'Number',
        scheduledDate: 'Number',
        completedDate: 'Number',
        status: 'String',
        notes: 'String',
        createdAt: 'Number',
        updatedAt: 'Number',
        createdBy: 'String',
        updatedBy: 'String'
      }
    },
    {
      name: 'workorders',
      description: '工单表（兼容旧版本）',
      fields: {
        _id: 'String',
        orderId: 'String',
        productId: 'String',
        plannedQuantity: 'Number',
        actualQuantity: 'Number',
        scheduledDate: 'Number',
        completedDate: 'Number',
        status: 'String',
        notes: 'String',
        createdAt: 'Number',
        updatedAt: 'Number',
        createdBy: 'String',
        updatedBy: 'String'
      }
    },
    {
      name: 'workorders',
      description: '工单表（兼容旧版本）',
      fields: {
        _id: 'String',
        orderId: 'String',
        productId: 'String',
        plannedQuantity: 'Number',
        actualQuantity: 'Number',
        scheduledDate: 'Number',
        completedDate: 'Number',
        status: 'String',
        notes: 'String',
        createdAt: 'Number',
        updatedAt: 'Number',
        createdBy: 'String',
        updatedBy: 'String'
      }
    },
    {
      name: 'operation_logs',
      description: '操作日志表',
      fields: {
        _id: 'String',
        operation: 'String',
        collection: 'String',
        recordId: 'String',
        data: 'Object',
        userId: 'String',
        timestamp: 'Number'
      }
    },
    {
      name: 'sync_changes',
      description: '数据同步变更表',
      fields: {
        _id: 'String',
        table: 'String',
        operation: 'String',
        recordId: 'String',
        data: 'Object',
        timestamp: 'Number',
        clientId: 'String',
        processed: 'Boolean'
      }
    },
    {
      name: 'sync_errors',
      description: '数据同步错误表',
      fields: {
        _id: 'String',
        operation: 'String',
        table: 'String',
        clientId: 'String',
        error: 'String',
        timestamp: 'Number'
      }
    },
    {
      name: 'purchase_orders',
      description: '采购订单表',
      fields: {
        _id: 'String',
        orderNumber: 'String',
        supplierId: 'String',
        supplierName: 'String',
        items: 'Array',
        totalAmount: 'Number',
        status: 'String',
        deliveryDate: 'Number',
        notes: 'String',
        orderType: 'String',
        source: 'String',
        createdAt: 'Number',
        updatedAt: 'Number',
        createdBy: 'String',
        updatedBy: 'String'
      }
    },
    {
      name: 'purchase_orders',
      description: '采购订单表',
      fields: {
        _id: 'String',
        orderNumber: 'String',
        supplierId: 'String',
        supplierName: 'String',
        items: 'Array',
        totalAmount: 'Number',
        status: 'String',
        deliveryDate: 'Number',
        notes: 'String',
        orderType: 'String',
        source: 'String',
        createdAt: 'Number',
        updatedAt: 'Number',
        createdBy: 'String',
        updatedBy: 'String'
      }
    }
    ,
    {
      name: 'verify_codes',
      description: '短信验证码记录表',
      fields: {
        _id: 'String',
        phone: 'String',
        code: 'String',
        expiresAt: 'Number',
        status: 'String',
        attempts: 'Number',
        createdAt: 'Number',
        usedAt: 'Number'
      }
    }
  ];

  const results = [];
  let adminInitialPassword = '';
  let adminUsername = '13817508995';

  for (const collection of requiredCollections) {
    try {
      const collectionRef = db.collection(collection.name);

      // 尝试插入一条临时数据来创建集合
      try {
        const tempData = {
          _id: `temp_${Date.now()}`,
          _temp: true,
          _created: Date.now(),
          ...collection.fields
        };

        await collectionRef.add({ data: tempData });
        console.log(`[创建集合] ${collection.name}: 集合创建成功`);

        // 如果是 users 集合，立即插入默认数据
        if (collection.name === 'users') {
          // 删除临时数据
          await collectionRef.where({ _temp: true }).remove();

          // 插入默认管理员
          for (let i = 0; i < 20; i += 1) {
            const candidate = crypto.randomBytes(18).toString('base64url');
            const ok = candidate.length >= 10 && /[a-zA-Z]/.test(candidate) && /\d/.test(candidate);
            if (ok) {
              adminInitialPassword = candidate;
              break;
            }
          }
          if (!adminInitialPassword) {
            adminInitialPassword = crypto.randomBytes(24).toString('base64url');
          }
          adminUsername = '13817508995';
          const passwordHash = bcrypt.hashSync(adminInitialPassword, 10);
          const adminUser = {
            _id: 'admin_' + Date.now(),
            username: adminUsername,
            email: 'admin@rongjiahe.tech',
            realName: '系统管理员',
            phone: adminUsername,
            role: 'admin',
            status: 'active',
            password: passwordHash,
            createdAt: Date.now(),
            updatedAt: Date.now(),
            createdBy: 'system',
            updatedBy: 'system'
          };

          await collectionRef.add({ data: adminUser });
          console.log(`[创建集合] users: 插入默认管理员账号成功`);
        } else if (collection.name === 'customers') {
          // 删除临时数据并插入示例客户
          await collectionRef.where({ _temp: true }).remove();

          const sampleCustomer = {
            _id: 'customer_' + Date.now(),
            companyName: '示例客户公司',
            contactName: '张经理',
            phone: '0755-88888888',
            email: 'sample@example.com',
            address: '深圳市南山区',
            status: 'active',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            createdBy: 'system',
            updatedBy: 'system'
          };

          await collectionRef.add({ data: sampleCustomer });
          console.log(`[创建集合] customers: 插入示例客户成功`);
        } else if (collection.name === 'products') {
          // 删除临时数据并插入示例产品
          await collectionRef.where({ _temp: true }).remove();

          const sampleProduct = {
            _id: 'product_' + Date.now(),
            sku: 'RJ-001',
            name: '示例纸箱',
            category: '纸箱',
            description: '标准纸箱产品',
            price: 3.5,
            unit: '个',
            stockQuantity: 1000,
            minStock: 50,
            status: 'active',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            createdBy: 'system',
            updatedBy: 'system'
          };

          await collectionRef.add({ data: sampleProduct });
          console.log(`[创建集合] products: 插入示例产品成功`);
        } else {
          // 删除临时数据
          await collectionRef.where({ _temp: true }).remove();
        }

        results.push({
          name: collection.name,
          description: collection.description,
          exists: true,
          status: 'ready',
          fields: Object.keys(collection.fields).length
        });

        console.log(`[创建集合] ${collection.name}: 创建和初始化完成`);
      } catch (createError) {
        // 如果创建失败，尝试检查是否已存在
        const count = await collectionRef.count();
        if (count.total > 0) {
          console.log(`[创建集合] ${collection.name}: 集合已存在，跳过创建`);
          results.push({
            name: collection.name,
            description: collection.description,
            exists: true,
            status: 'ready',
            fields: Object.keys(collection.fields).length
          });
        } else {
          throw createError;
        }
      }
    } catch (error) {
      console.error(`[创建集合] ${collection.name} 创建失败:`, error.message);
      results.push({
        name: collection.name,
        description: collection.description,
        exists: false,
        error: error.message,
        status: 'failed'
      });
    }
  }

  return {
    success: true,
    collections: results,
    total: requiredCollections.length,
    ready: results.filter(r => r.status === 'ready').length,
    adminUsername,
    adminInitialPassword,
    timestamp: Date.now()
  };
}

/**
 * 设置数据库索引
 */
async function setupIndexes() {
  const indexConfigs = {
    users: [
      { key: { username: 1 }, unique: true, name: 'username_unique' },
      { key: { email: 1 }, unique: true, name: 'email_unique' },
      { key: { phone: 1 }, name: 'phone_index' },
      { key: { role: 1 }, name: 'role_index' },
      { key: { status: 1 }, name: 'status_index' },
      { key: { createdAt: -1 }, name: 'createdAt_index' }
    ],
    customers: [
      { key: { companyName: 1 }, name: 'companyName_index' },
      { key: { contactName: 1 }, name: 'contactName_index' },
      { key: { phone: 1 }, name: 'phone_index' },
      { key: { status: 1 }, name: 'status_index' },
      { key: { createdAt: -1 }, name: 'createdAt_index' },
      // 组合索引提升删除/查询性能
      { key: { _id: 1, _openid: 1 }, name: '_id_openid_index' },
      { key: { id: 1, _openid: 1 }, name: 'id_openid_index' }
    ],
    products: [
      { key: { sku: 1 }, unique: true, name: 'sku_unique' },
      { key: { name: 1 }, name: 'name_index' },
      { key: { category: 1 }, name: 'category_index' },
      { key: { status: 1 }, name: 'status_index' },
      { key: { price: 1 }, name: 'price_index' },
      { key: { createdAt: -1 }, name: 'createdAt_index' }
    ],
    orders: [
      { key: { orderNumber: 1 }, unique: true, name: 'orderNumber_unique' },
      { key: { customerId: 1 }, name: 'customerId_index' },
      { key: { status: 1 }, name: 'status_index' },
      { key: { deliveryDate: 1 }, name: 'deliveryDate_index' },
      { key: { createdAt: -1 }, name: 'createdAt_index' },
      { key: { totalAmount: 1 }, name: 'totalAmount_index' }
    ],
    order_items: [
      { key: { orderId: 1 }, name: 'orderId_index' },
      { key: { productId: 1 }, name: 'productId_index' }
    ],
    inventory: [
      { key: { productId: 1 }, name: 'productId_index' },
      { key: { warehouseId: 1 }, name: 'warehouseId_index' },
      { key: { quantity: 1 }, name: 'quantity_index' }
    ],
    production: [
      { key: { orderId: 1 }, name: 'orderId_index' },
      { key: { productId: 1 }, name: 'productId_index' },
      { key: { status: 1 }, name: 'status_index' },
      { key: { scheduledDate: 1 }, name: 'scheduledDate_index' },
      { key: { createdAt: -1 }, name: 'createdAt_index' }
    ],
    operation_logs: [
      { key: { operation: 1 }, name: 'operation_index' },
      { key: { collection: 1, timestamp: -1 }, name: 'collection_timestamp_index' },
      { key: { userId: 1 }, name: 'userId_index' },
      { key: { timestamp: -1 }, name: 'timestamp_index' }
    ],
    sync_changes: [
      { key: { table: 1, timestamp: -1 }, name: 'table_timestamp_index' },
      { key: { clientId: 1, timestamp: -1 }, name: 'clientId_timestamp_index' },
      { key: { processed: 1 }, name: 'processed_index' }
    ],
    sync_errors: [
      { key: { createdAt: -1 }, name: 'createdAt_index' },
      { key: { clientId: 1 }, name: 'clientId_index' },
      { key: { table: 1 }, name: 'table_index' }
    ],
    verify_codes: [
      { key: { phone: 1 }, name: 'phone_index' },
      { key: { createdAt: -1 }, name: 'createdAt_index' },
      { key: { expiresAt: 1 }, name: 'expiresAt_ttl', ttl: true, note: '请在云开发控制台为 expiresAt 创建 TTL 索引(5分钟)' }
    ]
  };

  const results = [];

  for (const [collectionName, indexes] of Object.entries(indexConfigs)) {
    try {
      // 在微信云开发中，索引需要在控制台手动创建
      // 这里提供索引配置信息，实际创建需要通过控制台操作

      results.push({
        collection: collectionName,
        indexes: indexes.map(index => ({
          ...index,
          status: 'configured',
          note: '需要在云开发控制台手动创建索引'
        })),
        totalIndexes: indexes.length,
        status: 'configured'
      });

      console.log(`[索引配置] ${collectionName}: ${indexes.length} 个索引已配置`);
    } catch (error) {
      results.push({
        collection: collectionName,
        error: error.message,
        status: 'failed'
      });
    }
  }

  return {
    success: true,
    results,
    totalCollections: Object.keys(indexConfigs).length,
    message: '索引配置已准备，请到云开发控制台创建索引',
    timestamp: Date.now()
  };
}

/**
 * 设置集合权限
 */
async function setupPermissions() {
  const permissionRules = {
    users: {
      read: 'auth != null',
      write: 'auth != null'
    },
    customers: {
      read: 'auth != null',
      write: 'auth != null'
    },
    products: {
      read: 'auth != null',
      write: 'auth != null'
    },
    orders: {
      read: 'auth != null',
      write: 'auth != null'
    },
    order_items: {
      read: 'auth != null',
      write: 'auth != null'
    },
    inventory: {
      read: 'auth != null',
      write: 'auth != null'
    },
    production: {
      read: 'auth != null',
      write: 'auth != null'
    },
    operation_logs: {
      read: 'auth != null',
      write: 'auth != null'
    },
    sync_changes: {
      read: 'auth != null',
      write: 'auth != null'
    },
    sync_errors: {
      read: 'auth != null',
      write: 'auth != null'
    }
  };

  const results = [];

  for (const [collectionName, rules] of Object.entries(permissionRules)) {
    try {
      // 在微信云开发中，权限设置需要在控制台手动配置
      // 这里提供权限配置信息

      results.push({
        collection: collectionName,
        rules,
        status: 'configured',
        note: '需要在云开发控制台设置集合权限'
      });

      console.log(`[权限配置] ${collectionName}: 权限规则已配置`);
    } catch (error) {
      results.push({
        collection: collectionName,
        error: error.message,
        status: 'failed'
      });
    }
  }

  return {
    success: true,
    results,
    totalCollections: Object.keys(permissionRules).length,
    message: '权限配置已准备，请到云开发控制台设置集合权限',
    timestamp: Date.now()
  };
}

/**
 * 插入基础种子数据
 */
async function seedBasicData(options = {}) {
  const {
    createSampleUsers = false,
    createSampleCustomers = true,
    createSampleProducts = true,
    clearExisting = false
  } = options;

  const results = [];

  // 清理现有数据（如果需要）
  if (clearExisting) {
    console.log('[种子数据] 清空现有数据...');
    const collections = ['users', 'customers', 'products', 'orders', 'inventory', 'production'];

    for (const collection of collections) {
      try {
        await db.collection(collection).where({}).remove();
        console.log(`[种子数据] 清空集合: ${collection}`);
      } catch (error) {
        console.error(`[种子数据] 清空集合失败: ${collection}`, error);
      }
    }
  }

  // 创建示例用户
  if (createSampleUsers) {
    try {
      const users = generateSampleUsers();
      const userPromises = users.map(user =>
        db.collection('users').add({ data: user })
      );

      const userResults = await Promise.all(userPromises);

      results.push({
        collection: 'users',
        inserted: userResults.length,
        success: true
      });

      console.log(`[种子数据] 创建用户: ${userResults.length} 个`);
    } catch (error) {
      results.push({
        collection: 'users',
        error: error.message,
        success: false
      });
    }
  }

  // 创建示例客户
  if (createSampleCustomers) {
    try {
      const customers = generateSampleCustomers();
      const customerPromises = customers.map(customer =>
        db.collection('customers').add({ data: customer })
      );

      const customerResults = await Promise.all(customerPromises);

      results.push({
        collection: 'customers',
        inserted: customerResults.length,
        success: true
      });

      console.log(`[种子数据] 创建客户: ${customerResults.length} 个`);
    } catch (error) {
      results.push({
        collection: 'customers',
        error: error.message,
        success: false
      });
    }
  }

  // 创建示例产品
  if (createSampleProducts) {
    try {
      const products = generateSampleProducts();
      const productPromises = products.map(product =>
        db.collection('products').add({ data: product })
      );

      const productResults = await Promise.all(productPromises);

      results.push({
        collection: 'products',
        inserted: productResults.length,
        success: true
      });

      console.log(`[种子数据] 创建产品: ${productResults.length} 个`);
    } catch (error) {
      results.push({
        collection: 'products',
        error: error.message,
        success: false
      });
    }
  }

  // 创建示例订单
  if (true) { // 默认创建订单
    try {
      const orders = generateSampleOrders();
      const orderPromises = orders.map(order =>
        db.collection('orders').add({ data: order })
      );

      const orderResults = await Promise.all(orderPromises);

      results.push({
        collection: 'orders',
        inserted: orderResults.length,
        success: true
      });

      console.log(`[种子数据] 创建订单: ${orderResults.length} 个`);

      // 基于订单创建生产计划
      const plans = generateSampleProductionPlans(orders);
      const planPromises = plans.map(plan =>
        db.collection('production').add({ data: plan })
      );

      const planResults = await Promise.all(planPromises);

      results.push({
        collection: 'production',
        inserted: planResults.length,
        success: true
      });

      console.log(`[种子数据] 创建生产计划: ${planResults.length} 个`);

    } catch (error) {
      results.push({
        collection: 'orders_production',
        error: error.message,
        success: false
      });
    }
  }

  const totalInserted = results.reduce((sum, r) => sum + (r.inserted || 0), 0);
  const successCount = results.filter(r => r.success).length;

  return {
    success: true,
    results,
    summary: {
      totalCollections: results.length,
      successCollections: successCount,
      totalInserted,
      message: `成功插入 ${totalInserted} 条基础数据`
    },
    timestamp: Date.now()
  };
}

/**
 * 验证数据库设置
 */
async function validateSetup() {
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

      console.log(`[验证设置] ${collectionName}: ${count.total} 条记录`);
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
  const missingCollections = results.filter(r => r.status === 'missing').length;

  return {
    success: true,
    results,
    summary: {
      total: expectedCollections.length,
      ready: readyCollections,
      missing: missingCollections,
      readyPercentage: Math.round((readyCollections / expectedCollections.length) * 100)
    },
    message: readyCollections === expectedCollections.length
      ? '所有数据集合已准备就绪'
      : `还有 ${missingCollections} 个数据集合需要创建`,
    timestamp: Date.now()
  };
}

/**
 * 重置数据库
 */
async function resetDatabase(options = {}) {
  const { confirm = false } = options;

  if (!confirm) {
    throw new Error('重置数据库需要确认，请在data中设置confirm: true');
  }

  const collections = [
    'users', 'customers', 'products', 'orders', 'order_items',
    'inventory', 'production', 'operation_logs', 'sync_changes', 'sync_errors'
  ];

  const results = [];

  for (const collectionName of collections) {
    try {
      const result = await db.collection(collectionName).where({}).remove();

      results.push({
        collection: collectionName,
        removed: result.stats.removed,
        success: true
      });

      console.log(`[重置数据库] ${collectionName}: 删除了 ${result.stats.removed} 条记录`);
    } catch (error) {
      results.push({
        collection: collectionName,
        error: error.message,
        success: false
      });
    }
  }

  const totalRemoved = results.reduce((sum, r) => sum + (r.removed || 0), 0);
  const successCount = results.filter(r => r.success).length;

  return {
    success: true,
    results,
    summary: {
      totalCollections: collections.length,
      successCollections: successCount,
      totalRemoved,
      message: `重置完成，删除了 ${totalRemoved} 条记录`
    },
    timestamp: Date.now()
  };
}

/**
 * 生成示例用户数据
 */
function generateSampleUsers() {
  const roles = ['admin', 'manager', 'user', 'operator'];
  const users = [];

  const sampleUsers = [
    {
      username: '13817508995',
      email: 'admin@rongjiahe.tech',
      realName: '系统管理员',
      phone: '13817508995'
    },
    {
      username: 'manager',
      email: 'manager@rongjiahe.tech',
      realName: '业务经理',
      phone: '13800138001'
    },
    {
      username: 'user001',
      email: 'user001@rongjiahe.tech',
      realName: '张三',
      phone: '13800138002'
    },
    {
      username: 'user002',
      email: 'user002@rongjiahe.tech',
      realName: '李四',
      phone: '13800138003'
    },
    {
      username: 'operator001',
      email: 'operator@rongjiahe.tech',
      realName: '操作员',
      phone: '13800138004'
    }
  ];

  sampleUsers.forEach((user, index) => {
    const tmpPassword = crypto.randomBytes(18).toString('base64url');
    const passwordHash = bcrypt.hashSync(tmpPassword, 10);
    users.push({
      _id: uuidv4(),
      ...user,
      role: roles[index % roles.length],
      status: 'active', // 确保示例用户是激活状态
      password: passwordHash,
      createdAt: Date.now() - Math.random() * 86400000 * 30,
      updatedAt: Date.now(),
      createdBy: 'system',
      updatedBy: 'system'
    });
  });

  return users;
}

/**
 * 生成示例客户数据
 */
function generateSampleCustomers() {
  const customers = [];

  const sampleCustomers = [
    {
      companyName: '深圳科技有限公司',
      contactName: '王经理',
      phone: '0755-88888888',
      email: 'wang@sztech.com',
      address: '深圳市南山区科技园'
    },
    {
      companyName: '广州贸易公司',
      contactName: '李总',
      phone: '020-66666666',
      email: 'li@gztrade.com',
      address: '广州市天河区珠江新城'
    },
    {
      companyName: '东莞制造厂',
      contactName: '陈厂长',
      phone: '0769-99999999',
      email: 'chen@dgmanu.com',
      address: '东莞市松山湖高新区'
    },
    {
      companyName: '佛山包装公司',
      contactName: '张主管',
      phone: '0757-77777777',
      email: 'zhang@fspackage.com',
      address: '佛山市禅城区'
    },
    {
      companyName: '中山纸业公司',
      contactName: '刘经理',
      phone: '0760-55555555',
      email: 'liu@zspaper.com',
      address: '中山市东区'
    }
  ];

  sampleCustomers.forEach((customer) => {
    customers.push({
      _id: uuidv4(),
      ...customer,
      status: 'active',
      creditLimit: Math.floor(Math.random() * 100000) + 50000,
      createdAt: Date.now() - Math.random() * 86400000 * 30,
      updatedAt: Date.now(),
      createdBy: 'system',
      updatedBy: 'system'
    });
  });

  return customers;
}

/**
 * 生成示例产品数据
 */
function generateSampleProducts() {
  const products = [];

  const categories = ['纸箱', '包装盒', '标签', '说明书', '其他包装'];
  const units = ['个', '套', 'PCS', '平方米'];

  const sampleProducts = [
    {
      sku: 'RJ-001',
      name: '快递纸箱A3',
      category: '纸箱',
      description: '适用于小件物品包装的快递纸箱',
      price: 3.5
    },
    {
      sku: 'RJ-002',
      name: '食品包装盒B2',
      category: '包装盒',
      description: '食品级包装盒，符合食品安全标准',
      price: 1.8
    },
    {
      sku: 'RJ-003',
      name: '产品说明书',
      category: '说明书',
      description: '彩色印刷产品说明书',
      price: 0.8
    },
    {
      sku: 'RJ-004',
      name: '防静电包装袋',
      category: '其他包装',
      description: '电子元件防静电包装袋',
      price: 2.2
    }
  ];

  sampleProducts.forEach((product, index) => {
    products.push({
      _id: uuidv4(),
      ...product,
      unit: units[index % units.length],
      category: categories[index % categories.length],
      stockQuantity: Math.floor(Math.random() * 1000) + 100,
      minStock: 50,
      status: 'active',
      createdAt: Date.now() - Math.random() * 86400000 * 30,
      updatedAt: Date.now(),
      createdBy: 'system',
      updatedBy: 'system'
    });
  });

  return products;
}

/**
 * 生成示例订单数据
 */
function generateSampleOrders() {
  const orders = [];
  const count = 10;

  for (let i = 0; i < count; i++) {
    const isCompleted = Math.random() > 0.7;
    const randomDay = Math.floor(Math.random() * 30);
    const createdAt = Date.now() - randomDay * 86400000;

    orders.push({
      _id: uuidv4(),
      orderNumber: `ORD-${20230000 + i}`,
      customerId: `customer_${Date.now()}_${i}`, // 模拟关联ID
      customerName: `示例客户 ${i + 1}`,
      totalAmount: Math.floor(Math.random() * 5000) + 1000,
      status: isCompleted ? 'completed' : 'pending',
      deliveryDate: createdAt + 86400000 * 7,
      notes: '自动生成的测试订单',
      createdAt: createdAt,
      updatedAt: createdAt,
      createdBy: 'system',
      updatedBy: 'system',
      _version: 1
    });
  }

  return orders;
}

/**
 * 生成示例生产计划数据
 */
function generateSampleProductionPlans(orders = []) {
  const plans = [];

  orders.forEach((order, index) => {
    // 只有部分订单生成生产计划
    if (Math.random() > 0.3) {
      const isCompleted = order.status === 'completed';
      const plannedQty = Math.floor(Math.random() * 500) + 100;

      const statuses = ['pending', 'processing', 'completed', 'stocked'];
      const status = isCompleted ? 'stocked' : statuses[Math.floor(Math.random() * (statuses.length - 1))];

      plans.push({
        _id: uuidv4(),
        orderId: order._id,
        orderNo: order.orderNumber,
        productId: `product_${Date.now()}_${index}`,
        productName: `示例产品 ${index + 1}`,
        customerName: order.customerName,
        plannedQuantity: plannedQty,
        actualQuantity: isCompleted ? plannedQty : Math.floor(plannedQty * Math.random()),
        scheduledDate: order.deliveryDate - 86400000 * 3, // 交货前3天
        completedDate: isCompleted ? (order.deliveryDate - 86400000) : null,
        status: status,
        notes: '自动生成的生产计划',
        priority: Math.random() > 0.8 ? 'high' : 'normal',
        createdAt: order.createdAt + 3600000,
        updatedAt: order.createdAt + 3600000,
        createdBy: 'system',
        updatedBy: 'system'
      });
    }
  });

  return plans;
}
