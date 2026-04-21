// MongoDB初始化脚本
// 在容器启动时自动执行

db = db.getSiblingDB('ronghe-erp');

// 创建管理员用户
if (!db.getUser('erpAdmin')) {
  db.createUser({
    user: 'erpAdmin',
    pwd: 'erpAdmin123',
    roles: [
      {
        role: 'readWrite',
        db: 'ronghe-erp'
      },
      {
        role: 'dbAdmin',
        db: 'ronghe-erp'
      }
    ]
  });
  print('ERP管理员用户创建成功');
}

// 创建初始索引
print('开始创建数据库索引...');

// 用户集合索引
db.users.createIndex({ username: 1 }, { unique: true });
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ wechatUserId: 1 }, { sparse: true });
db.users.createIndex({ wechatOpenId: 1 }, { sparse: true });

// 订单集合索引
db.orders.createIndex({ orderNo: 1 }, { unique: true });
db.orders.createIndex({ customerId: 1 });
db.orders.createIndex({ status: 1 });
db.orders.createIndex({ createdAt: -1 });

// 客户集合索引
db.customers.createIndex({ customerCode: 1 }, { unique: true });
db.customers.createIndex({ name: 1 });
db.customers.createIndex({ phone: 1 });
db.customers.createIndex({ status: 1 });

// 产品集合索引
db.products.createIndex({ productCode: 1 }, { unique: true });
db.products.createIndex({ name: 1 });
db.products.createIndex({ category: 1 });
db.products.createIndex({ status: 1 });

// 生产订单集合索引
db.productionorders.createIndex({ productionNo: 1 }, { unique: true });
db.productionorders.createIndex({ orderId: 1 });
db.productionorders.createIndex({ status: 1 });
db.productionorders.createIndex({ plannedStartDate: 1 });

print('数据库索引创建完成');

// 创建默认管理员用户
if (db.users.countDocuments({ username: 'admin' }) === 0) {
  db.users.insertOne({
    username: 'admin',
    password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password
    email: 'admin@ronghetech.com',
    name: '系统管理员',
    role: 'admin',
    phone: '13800138000',
    department: '管理部',
    status: 'active',
    createdAt: new Date(),
    updatedAt: new Date()
  });
  print('默认管理员用户创建成功');
}

print('MongoDB初始化完成');