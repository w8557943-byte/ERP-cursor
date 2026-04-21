# 统一API调用迁移指南

## 概述

为了解决项目中多种API调用方式混用的问题，我们创建了统一的API调用封装 `utils/unified-api.js`。

## 迁移前后对比

### 旧方式（不推荐）

```javascript
// 方式1：直接调用云函数
wx.cloud.callFunction({
  name: 'erp-api',
  data: {
    action: 'getOrders',
    params: { page: 1 }
  }
}).then(res => {
  if (res.result && res.result.success) {
    // 处理数据
  }
}).catch(err => {
  console.error('请求失败', err);
});

// 方式2：使用 cloud-api-adapter
const cloudApi = require('./utils/cloud-api-adapter');
cloudApi.call('getOrders', { page: 1 });

// 方式3：直接数据库操作
wx.cloud.database().collection('orders').get();
```

### 新方式（推荐）

```javascript
const { API } = require('./utils/unified-api');

// 简洁的调用方式
try {
  const response = await API.getOrders({ page: 1 });
  // response.data 包含订单数据
} catch (error) {
  // 统一的错误处理
  wx.showToast({ title: error.message, icon: 'none' });
}
```

## 核心特性

### 1. 自动重试

```javascript
// 失败时自动重试3次
const response = await API.getOrders({ page: 1 });

// 自定义重试次数
const { callAPI } = require('./utils/unified-api');
const response = await callAPI('getOrders', { page: 1 }, {
  retryTimes: 5,
  retryDelay: 2000
});
```

### 2. 智能缓存

```javascript
// 第一次调用，从服务器获取
const orders1 = await API.getOrders({ page: 1 });

// 30秒内再次调用，使用缓存
const orders2 = await API.getOrders({ page: 1 });

// 手动清除缓存
const { clearCache } = require('./utils/unified-api');
clearCache('getOrders');
```

### 3. 统一错误处理

```javascript
try {
  await API.login('username', 'wrong_password');
} catch (error) {
  if (error.isBusinessError) {
    // 业务错误（如密码错误）
    wx.showToast({ title: error.message, icon: 'none' });
  } else {
    // 网络错误或系统错误
    wx.showToast({ title: '网络错误，请重试', icon: 'none' });
  }
}
```

### 4. 批量调用

```javascript
const { batchCall } = require('./utils/unified-api');

const results = await batchCall([
  { action: 'getOrders', params: { page: 1 } },
  { action: 'getCustomers', params: { limit: 10 } },
  { action: 'getOrderStats', params: {} }
]);

const [orders, customers, stats] = results;
```

## 迁移步骤

### 步骤1：引入统一API

```javascript
// 在页面顶部引入
const { API } = require('../../utils/unified-api');
```

### 步骤2：替换API调用

**示例1：订单列表页面**

```javascript
// 旧代码
loadOrders() {
  wx.cloud.callFunction({
    name: 'erp-api',
    data: { action: 'getOrders', params: { page: 1 } }
  }).then(res => {
    if (res.result && res.result.data) {
      this.setData({ orders: res.result.data });
    }
  }).catch(err => {
    console.error('加载失败', err);
  });
}

// 新代码
async loadOrders() {
  try {
    const response = await API.getOrders({ page: 1 });
    this.setData({ orders: response.data || [] });
  } catch (error) {
    wx.showToast({ title: '加载失败', icon: 'none' });
  }
}
```

**示例2：创建订单**

```javascript
// 旧代码
createOrder(orderData) {
  wx.cloud.callFunction({
    name: 'erp-api',
    data: { action: 'createOrder', data: orderData }
  }).then(res => {
    if (res.result && res.result.success) {
      wx.showToast({ title: '创建成功', icon: 'success' });
      this.loadOrders(); // 重新加载列表
    }
  });
}

// 新代码
async createOrder(orderData) {
  try {
    await API.createOrder(orderData);
    wx.showToast({ title: '创建成功', icon: 'success' });
    // 缓存已自动清除，重新加载会获取最新数据
    await this.loadOrders();
  } catch (error) {
    wx.showToast({ title: error.message, icon: 'none' });
  }
}
```

### 步骤3：移除旧的API调用

```javascript
// 删除或注释掉旧的引入
// const cloudApi = require('./utils/cloud-api-adapter');

// 使用新的统一API
const { API } = require('./utils/unified-api');
```

## 常用API列表

### 用户相关
- `API.login(username, password)` - 用户登录
- `API.getUserInfo(userId)` - 获取用户信息
- `API.getUserSession(userId)` - 获取用户会话

### 订单相关
- `API.getOrders(params)` - 获取订单列表
- `API.getOrder(orderId)` - 获取订单详情
- `API.createOrder(orderData)` - 创建订单
- `API.updateOrder(orderId, updates)` - 更新订单

### 生产相关
- `API.getProductions(params)` - 获取生产列表
- `API.updateProduction(productionId, updates)` - 更新生产信息

### 客户相关
- `API.getCustomers(params)` - 获取客户列表
- `API.getCustomer(customerId)` - 获取客户详情
- `API.createCustomer(customerData)` - 创建客户

### 采购相关
- `API.getPurchaseOrders(params)` - 获取采购订单
- `API.stockInPurchaseOrder(data)` - 采购入库

### 供应商相关
- `API.getSuppliers(params)` - 获取供应商列表

### 库存相关
- `API.getInventory(params)` - 获取库存信息

### 统计相关
- `API.getOrderStats(params)` - 获取订单统计

## 高级用法

### 自定义API调用

```javascript
const { callAPI } = require('./utils/unified-api');

// 调用未封装的API
const response = await callAPI('customAction', {
  param1: 'value1',
  param2: 'value2'
}, {
  retryTimes: 5,
  cacheTTL: 60000,
  cacheEnabled: true
});
```

### 配置全局参数

```javascript
const { config } = require('./utils/unified-api');

// 修改全局配置
config.timeout = 60000;      // 超时时间改为60秒
config.retryTimes = 5;       // 重试次数改为5次
config.cacheTTL = 120000;    // 默认缓存2分钟
```

### 缓存管理

```javascript
const { clearCache } = require('./utils/unified-api');

// 清除特定API的缓存
clearCache('getOrders');

// 清除所有缓存
clearCache();
```

## 注意事项

1. **异步处理**：所有API调用都是异步的，使用 `async/await` 或 `Promise`
2. **错误处理**：始终使用 `try/catch` 捕获错误
3. **缓存策略**：写操作（create/update/delete）会自动清除相关缓存
4. **日志记录**：所有API调用都会自动记录日志，便于调试

## 迁移检查清单

- [ ] 引入 `unified-api.js`
- [ ] 替换所有 `wx.cloud.callFunction` 调用
- [ ] 替换所有 `cloud-api-adapter` 调用
- [ ] 添加适当的错误处理
- [ ] 测试所有API调用
- [ ] 移除旧的API工具引用

## 示例页面迁移

完整的页面迁移示例请参考：
- `pages/order/order.js` - 订单列表页面
- `pages/purchase-sub/purchase/purchase.js` - 采购页面
- `pages/production/production.js` - 生产页面
