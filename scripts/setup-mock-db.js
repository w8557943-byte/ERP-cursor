import { MongoMemoryServer } from 'mongodb-memory-server';
import mongoose from 'mongoose';

async function setupMockDatabase() {
  try {
    console.log('🔄 正在启动内存MongoDB服务器...');
    
    const mongod = await MongoMemoryServer.create({
      instance: {
        port: 27017,
        dbName: 'ronghe-erp'
      }
    });
    
    const uri = mongod.getUri();
    console.log(`✅ 内存MongoDB服务器启动成功`);
    console.log(`📍 连接URI: ${uri}`);
    
    // 连接到内存数据库
    await mongoose.connect(uri);
    console.log('✅ 数据库连接成功');
    
    // 创建客户数据集合
    const Customer = mongoose.model('Customer', new mongoose.Schema({
      name: String,
      phone: String,
      email: String,
      address: String,
      customerType: String,
      status: String,
      totalPurchaseAmount: Number,
      orderCount: Number,
      lastOrderDate: Date,
      registrationDate: Date,
      wechatCustomerId: String,
      wechatOpenId: String,
      avatarUrl: String
    }));
    
    // 插入测试数据
    const mockCustomers = [
      {
        name: '张三',
        phone: '13800138000',
        email: 'zhangsan@example.com',
        address: '北京市朝阳区',
        customerType: 'individual',
        status: 'active',
        totalPurchaseAmount: 1500.00,
        orderCount: 3,
        lastOrderDate: new Date('2024-01-15T10:30:00Z'),
        registrationDate: new Date('2024-01-01T08:00:00Z'),
        wechatCustomerId: 'wx_001',
        wechatOpenId: 'openid_001',
        avatarUrl: 'https://example.com/avatar1.jpg'
      },
      {
        name: '李四',
        phone: '13900139000',
        email: 'lisi@example.com',
        address: '上海市浦东新区',
        customerType: 'company',
        status: 'active',
        totalPurchaseAmount: 3200.00,
        orderCount: 8,
        lastOrderDate: new Date('2024-01-20T14:45:00Z'),
        registrationDate: new Date('2023-12-15T09:30:00Z'),
        wechatCustomerId: 'wx_002',
        wechatOpenId: 'openid_002',
        avatarUrl: 'https://example.com/avatar2.jpg'
      }
    ];
    
    await Customer.insertMany(mockCustomers);
    console.log('✅ 测试客户数据插入成功');
    
    // 保持服务器运行
    console.log('🔄 内存MongoDB服务器正在运行，按 Ctrl+C 停止...');
    
    process.on('SIGINT', async () => {
      console.log('🔄 正在关闭服务器...');
      await mongoose.disconnect();
      await mongod.stop();
      console.log('✅ 服务器已关闭');
      process.exit(0);
    });
    
  } catch (error) {
    console.error('❌ 启动内存MongoDB服务器失败:', error);
    process.exit(1);
  }
}

setupMockDatabase();