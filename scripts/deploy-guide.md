# 荣禾ERP系统部署指南

## 🚀 快速部署步骤

### 第一步：云函数部署

#### 1. 部署 erp-api 云函数
在微信开发者工具中：
1. 右键点击 `cloudfunctions/erp-api` 文件夹
2. 选择 **"上传并部署：云端安装依赖"**
3. 等待部署完成（通常需要1-3分钟）
4. 控制台显示 "部署成功" 即完成

#### 2. 部署 database-init 云函数
1. 右键点击 `cloudfunctions/database-init` 文件夹  
2. 选择 **"上传并部署：云端安装依赖"**
3. 等待部署完成
4. 确认控制台显示成功

### 第二步：数据库初始化

#### 方式A：使用初始化工具页面
1. 在小程序地址栏输入：`pages/db-init/db-init`
2. 点击 **"初始化数据库"** 按钮
3. 等待初始化完成（约30-60秒）
4. 看到 "数据库初始化成功" 提示

#### 方式B：通过登录页面触发
1. 打开登录页面
2. 输入任意账号密码点击登录
3. 系统会提示数据库未初始化
4. 点击 **"快速初始化"** 进行初始化

### 第三步：登录系统

使用默认管理员账号：
- **账号**：`admin`
- **密码**：`admin123`

登录成功后系统将自动跳转到工作台页面。

## 🔍 部署验证

### 检查云函数部署状态
在微信开发者工具的 **云开发控制台** 中：
1. 点击 **"云函数"** 标签
2. 确认以下云函数已部署：
   - ✅ `erp-api`
   - ✅ `database-init`

### 检查数据库状态
1. 点击 **"数据库"** 标签
2. 确认以下集合已创建：
   - ✅ `users` (用户表)
   - ✅ `customers` (客户表)
   - ✅ `products` (产品表)
   - ✅ `orders` (订单表)
   - ✅ `inventory` (库存表)
   - ✅ `production` (生产表)

## 🛠️ 常见问题解决

### 问题1：云函数部署失败
**现象**：部署时提示错误或超时
**解决方案**：
1. 检查网络连接
2. 重新右键选择部署选项
3. 确认云开发环境ID正确：`erp-system-prod-1glmda1zf4f9c7a7`

### 问题2：登录按钮无响应
**现象**：点击登录按钮没有任何反应
**解决方案**：
1. 确认云函数已成功部署
2. 重新编译小程序（Ctrl+B）
3. 检查控制台是否有错误信息

### 问题3：数据库初始化失败
**现象**：初始化时提示错误
**解决方案**：
1. 检查 `database-init` 云函数是否部署成功
2. 确认云开发环境权限
3. 重新尝试初始化

### 问题4：登录失败
**现象**：输入正确账号密码仍提示登录失败
**解决方案**：
1. 确认数据库已正确初始化
2. 检查控制台日志
3. 重新部署 `erp-api` 云函数

## 外部访问配置

### 方案一：使用API桥接云函数（推荐）

荣禾ERP系统已内置API桥接云函数，支持外部HTTP访问：

#### 1. 云函数配置
- **云函数名称**: `api-bridge`
- **访问地址**: `https://[环境ID].service.tcloudbase.com/api-bridge`
- **支持方法**: GET, POST, PUT, DELETE, OPTIONS
- **跨域支持**: 已配置CORS，允许所有来源访问

#### 2. 可用API端点

```bash
# 健康检查
curl -X GET "https://your-env-id.service.tcloudbase.com/api-bridge/health"

# 订单列表
curl -X GET "https://your-env-id.service.tcloudbase.com/api-bridge/orders/list?page=1&limit=10"

# 订单统计
curl -X GET "https://your-env-id.service.tcloudbase.com/api-bridge/orders/stats"

# 工单列表
curl -X GET "https://your-env-id.service.tcloudbase.com/api-bridge/workorders/list"

# 客户列表
curl -X GET "https://your-env-id.service.tcloudbase.com/api-bridge/customers/list"

# 库存列表
curl -X GET "https://your-env-id.service.tcloudbase.com/api-bridge/inventory/list"

# 仪表板统计
curl -X GET "https://your-env-id.service.tcloudbase.com/api-bridge/dashboard/stats"

# 最近活动
curl -X GET "https://your-env-id.service.tcloudbase.com/api-bridge/dashboard/recent"
```

#### 3. 请求示例

```javascript
// 获取订单列表
fetch('https://your-env-id.service.tcloudbase.com/api-bridge/orders/list?page=1&limit=10')
  .then(response => response.json())
  .then(data => {
    if (data.success) {
      console.log('订单数据:', data.data);
    }
  });

// 创建订单
fetch('https://your-env-id.service.tcloudbase.com/api-bridge/orders', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer your-token'
  },
  body: JSON.stringify({
    customerId: 'customer123',
    items: [
      { productId: 'product1', quantity: 2, price: 100 }
    ],
    totalAmount: 200
  })
})
.then(response => response.json())
.then(data => {
  if (data.success) {
    console.log('订单创建成功:', data.data);
  }
});
```

#### 4. 响应格式

所有API响应都遵循统一格式：

```json
{
  "success": true,
  "message": "操作成功",
  "data": {
    // 业务数据
  },
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 100,
    "pages": 10
  }
}
```

#### 5. 错误处理

```json
{
  "success": false,
  "message": "操作失败",
  "error": "具体错误信息"
}
```

#### 6. 认证机制

- 公开接口：`/health`, `/public` 等无需认证
- 需要认证的接口：在请求头中添加 `Authorization: Bearer your-token`
- 当前为简化版本，实际项目中应使用完整的JWT认证

#### 7. 注意事项

1. **环境ID替换**：将 `your-env-id` 替换为您的实际云开发环境ID
2. **权限控制**：根据业务需求调整访问权限
3. **频率限制**：注意云函数的调用频率限制
4. **数据安全**：敏感操作需要适当的权限验证
5. **错误重试**：建议实现错误重试机制

### 方案二：腾讯云SCF迁移（高级方案）

如需更完整的外部访问支持，可考虑将云函数迁移到腾讯云SCF：

1. 在腾讯云控制台创建SCF函数
2. 配置API网关触发器
3. 绑定自定义域名
4. 配置访问权限和限流

> **注意**：此方案需要额外的腾讯云资源配置和费用

## 📞 技术支持

如果按照上述步骤仍有问题，请：
1. 提供具体的错误信息
2. 提供控制台日志截图
3. 说明当前操作步骤

## ✅ 部署完成后功能

系统部署完成后，将包含以下核心功能：

- **用户管理**：多角色权限控制
- **客户管理**：客户信息维护
- **产品管理**：产品规格库存
- **订单管理**：订单创建跟踪  
- **生产管理**：生产进度监控
- **数据同步**：实时数据同步
- **权限控制**：细粒度权限管理

---

**部署完成后，您的荣禾ERP系统即可正式投入使用！** 🎉