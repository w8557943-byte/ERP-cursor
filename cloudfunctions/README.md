# 荣禾ERP小程序云开发后端配置

## 📋 项目概述

本项目是荣禾ERP系统的微信小程序云开发后端实现，采用微信小程序直连云开发的架构模式，提供完整的数据同步、WebSocket通信、数据库操作和监控功能。

## 🏗️ 架构设计

### 核心架构
- **前端**: 微信小程序直连云开发
- **后端**: 微信云开发云函数
- **数据库**: 微信云开发云数据库
- **通信**: WebSocket + HTTP云函数调用
- **监控**: 云函数性能监控 + 自定义监控

### 设计原则
1. **无服务器架构**: 充分利用微信云开发的serverless能力
2. **实时数据同步**: 基于云数据库的变更监听实现实时同步
3. **离线支持**: 客户端本地缓存 + 网络恢复自动同步
4. **高可用性**: 云函数自动扩缩容、数据库自动备份
5. **安全可靠**: 微信云开发内置安全防护

## 📁 项目结构

```
ERP-cursor/
├── app.json                          # 小程序配置（已启用云开发）
├── app.js                           # 小程序入口（不修改前端逻辑）
├── cloudfunctions/                  # 云函数目录
│   ├── data-sync/                   # 数据同步云函数
│   │   ├── index.js                 # 核心同步逻辑
│   │   └── package.json
│   ├── websocket-manager/           # WebSocket管理器
│   │   ├── index.js                 # 连接管理、消息处理
│   │   └── package.json
│   ├── database-ops/                # 数据库操作云函数
│   │   ├── index.js                 # 数据库初始化、备份恢复
│   │   └── package.json
│   ├── sync-monitor/                # 同步监控云函数
│   │   ├── index.js                 # 性能监控、数据一致性检查
│   │   └── package.json
│   └── utils/                       # 小程序端工具库
│       ├── miniprogram-tools.js     # 云函数调用封装、数据库操作
│       └── package.json
```

## 🚀 已完成功能

### 1. 数据同步云函数 (data-sync)
**功能特性:**
- 实时数据创建、更新、删除操作
- 批量数据同步处理
- 增量数据变更查询
- 冲突检测与解决策略
- 数据版本控制
- 操作日志记录

**核心方法:**
- `create`: 创建数据记录
- `update`: 更新数据记录
- `delete`: 删除数据记录
- `batchSync`: 批量同步操作
- `queryChanges`: 查询增量变更
- `resolveConflict`: 解决数据冲突

### 2. WebSocket管理器 (websocket-manager)
**功能特性:**
- WebSocket连接建立与管理
- 设备状态实时监控
- 消息广播与推送
- 连接故障自动重连
- 频道管理（按业务模块分组）

**核心方法:**
- `handleConnection`: 处理新连接
- `handleDisconnection`: 处理连接断开
- `handleMessage`: 处理消息收发
- `broadcastChange`: 广播数据变更
- `manageDeviceStatus`: 管理设备状态

### 3. 数据库操作云函数 (database-ops)
**功能特性:**
- 数据库集合初始化
- 多集合索引创建
- 示例数据生成
- 数据备份与恢复
- 数据模式验证
- 数据库性能优化

**核心方法:**
- `init_collections`: 初始化业务集合
- `create_indexes`: 创建性能索引
- `seedData`: 生成测试数据
- `backupData`: 数据备份
- `restoreData`: 数据恢复
- `validateSchema`: 数据验证

### 4. 同步监控云函数 (sync-monitor)
**功能特性:**
- 同步状态实时监控
- 性能指标分析
- 数据一致性检查
- 告警与通知
- 性能报告生成

**核心方法:**
- `monitorSync`: 同步监控
- `analyzePerformance`: 性能分析
- `checkDataConsistency`: 一致性检查
- `generateReport`: 生成监控报告

### 5. 小程序端工具库 (utils/miniprogram-tools.js)
**功能特性:**
- 云函数调用封装
- 数据库操作封装
- 错误处理与重试机制
- 性能监控工具
- 离线支持与缓存
- 同步状态管理

**核心类:**
- `CloudFunctionManager`: 云函数调用管理
- `DatabaseManager`: 数据库操作管理
- `SyncStateManager`: 同步状态管理
- `ErrorHandler`: 错误处理与重试
- `PerformanceMonitor`: 性能监控
- `OfflineSupport`: 离线支持
- `utils`: 工具函数集合

## 📊 数据库设计

### 核心业务集合
1. **orders** - 订单管理
2. **customers** - 客户信息
3. **products** - 产品信息
4. **inventory** - 库存管理
5. **users** - 用户管理
6. **manufacturing_orders** - 生产订单
7. **shipping_orders** - 物流订单

### 数据结构示例
```javascript
// 订单数据结构
const orderSchema = {
  _id: ObjectId,
  orderNumber: String,        // 订单号
  customerId: ObjectId,       // 客户ID
  items: [{                   // 订单项
    productId: ObjectId,
    quantity: Number,
    price: Number,
    subtotal: Number
  }],
  status: String,             // 订单状态
  totalAmount: Number,        // 总金额
  createdAt: Date,           // 创建时间
  updatedAt: Date,           // 更新时间
  createdBy: ObjectId,       // 创建人
  metadata: {                // 元数据
    source: String,
    tags: [String],
    notes: String
  }
};
```

## 🔧 使用指南

### 1. 云函数部署
```bash
# 部署单个云函数
wx cloud deploy --function data-sync

# 部署所有云函数
wx cloud deploy
```

### 2. 小程序端集成
```javascript
// 导入工具库
const { CloudFunctionManager, DatabaseManager } = require('./cloudfunctions/utils/miniprogram-tools.js');

// 初始化
const cloudManager = new CloudFunctionManager('your-env-id');
const dbManager = new DatabaseManager('your-env-id');

// 调用云函数
const result = await cloudManager.syncData('create', {
  collection: 'orders',
  data: orderData
});
```

### 3. 数据库操作
```javascript
// 添加数据
const addResult = await dbManager.operate('orders', 'add', orderData);

// 查询数据
const queryResult = await dbManager.operate('orders', 'where', {
  condition: { status: 'pending' }
});
```

## 📈 性能优化

### 1. 数据库优化
- 合理的索引设计
- 分页查询策略
- 读写分离
- 数据压缩

### 2. 云函数优化
- 冷启动优化
- 内存管理
- 并发控制
- 超时处理

### 3. 网络优化
- 请求压缩
- CDN加速
- 缓存策略
- 连接池

## 🔒 安全特性

### 1. 身份认证
- 微信登录
- JWT Token
- 权限验证

### 2. 数据安全
- 数据加密
- 敏感信息脱敏
- 操作审计
- 访问控制

### 3. 传输安全
- HTTPS加密
- 签名验证
- 防重放攻击
- 限流控制

## 📊 监控告警

### 1. 性能监控
- 响应时间监控
- 错误率统计
- 资源使用率
- 并发数监控

### 2. 业务监控
- 数据同步状态
- WebSocket连接状态
- 数据库性能
- 用户操作日志

### 3. 告警机制
- 阈值告警
- 异常告警
- 邮件通知
- 短信提醒

## 🔄 离线支持

### 1. 本地缓存
- 数据缓存
- 操作队列
- 状态持久化

### 2. 网络恢复
- 离线队列处理
- 数据冲突解决
- 增量同步

## 📝 开发规范

### 1. 代码规范
- 遵循微信云开发规范
- 统一的命名约定
- 完整的错误处理
- 详细的文档注释

### 2. 测试策略
- 单元测试覆盖
- 集成测试
- 性能测试
- 安全测试

### 3. 部署流程
- 开发环境部署
- 测试环境验证
- 生产环境发布
- 回滚机制

## 🚀 下一步计划

1. **性能优化**: 进一步优化云函数响应时间和数据库查询性能
2. **功能扩展**: 添加更多业务模块的云函数支持
3. **监控完善**: 建立完整的监控告警体系
4. **安全加固**: 加强安全防护和审计功能
5. **文档完善**: 持续更新开发文档和使用指南

## 📞 技术支持

如有技术问题，请参考：
- [微信云开发官方文档](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/basis/getting-started.html)
- [云函数开发指南](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/guide/functions.html)
- [云数据库开发指南](https://developers.weixin.qq.com/miniprogram/dev/wxcloud/guide/database.html)

---

**版本**: v1.0.0  
**最后更新**: 2024-01-01  
**维护团队**: 荣禾ERP开发团队