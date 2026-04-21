# 荣禾ERP系统 - PC端后端API服务

## 项目概述

荣禾ERP系统PC端后端API服务是基于Node.js + Express构建的RESTful API服务，为前端管理后台提供数据接口支持。

## 技术栈

- **运行时**: Node.js >= 16.0.0
- **框架**: Express 4.x
- **认证**: JWT (jsonwebtoken)
- **数据库**: MongoDB (mongoose)
- **安全**: Helmet, CORS, bcryptjs
- **日志**: Winston
- **开发工具**: Nodemon, ESLint

## 功能模块

### 1. 认证模块 (Auth)
- 用户登录/登出
- JWT token管理
- 权限验证

### 2. 用户管理 (Users)
- 用户信息管理
- 角色权限控制
- 用户状态管理

### 3. 订单管理 (Orders)
- 订单CRUD操作
- 订单状态管理
- 订单搜索和筛选

### 4. 客户管理 (Customers)
- 客户信息管理
- 客户等级划分
- 客户关系维护

### 5. 产品管理 (Products)
- 产品信息管理
- 库存管理
- 价格管理

### 6. 生产管理 (Production)
- 生产任务管理
- 生产进度跟踪
- 生产统计报表

### 7. 财务管理 (Finance)
- 财务记录管理
- 收支统计分析
- 财务报表生成

## 安装和运行

### 1. 安装依赖

```bash
cd app/backend
npm install
```

### 2. 环境配置

复制环境变量配置文件：

```bash
cp .env.example .env
```

编辑 `.env` 文件，配置相关参数。

### 3. 开发环境运行

```bash
npm run dev
```

服务将运行在 http://localhost:3000

### 4. 生产环境运行

```bash
npm start
```

## API文档

### 认证接口

**登录**
```
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "password"
}
```

**获取当前用户信息**
```
GET /api/auth/me
Authorization: Bearer <token>
```

### 订单接口

**获取订单列表**
```
GET /api/orders?page=1&pageSize=10&status=processing
Authorization: Bearer <token>
```

**创建订单**
```
POST /api/orders
Authorization: Bearer <token>
Content-Type: application/json

{
  "customerId": 1,
  "productName": "智能家居套装",
  "quantity": 100,
  "amount": 50000
}
```

### 客户接口

**获取客户列表**
```
GET /api/customers?page=1&pageSize=10&level=VIP
Authorization: Bearer <token>
```

### 产品接口

**获取产品列表**
```
GET /api/products?page=1&pageSize=10&category=智能家居
Authorization: Bearer <token>
```

### 生产接口

**获取生产任务列表**
```
GET /api/production/tasks?page=1&pageSize=10&status=processing
Authorization: Bearer <token>
```

**获取生产统计**
```
GET /api/production/stats
Authorization: Bearer <token>
```

### 财务接口

**获取财务记录**
```
GET /api/finance/records?page=1&pageSize=10&type=income
Authorization: Bearer <token>
```

**获取财务报表**
```
GET /api/finance/reports?startDate=2024-01-01&endDate=2024-01-31
Authorization: Bearer <token>
```

## 数据库设计

### 用户表 (users)
- id: 用户ID
- username: 用户名
- password: 密码（加密）
- email: 邮箱
- role: 角色 (admin/manager/user)
- status: 状态 (active/inactive)

### 订单表 (orders)
- id: 订单ID
- orderNo: 订单编号
- customerId: 客户ID
- productName: 产品名称
- quantity: 数量
- amount: 金额
- status: 状态 (pending/processing/completed/cancelled)

### 客户表 (customers)
- id: 客户ID
- name: 客户名称
- contactPerson: 联系人
- phone: 电话
- level: 等级 (VIP/重要/普通)

### 产品表 (products)
- id: 产品ID
- name: 产品名称
- sku: SKU编码
- price: 售价
- cost: 成本
- stock: 库存

## 安全特性

1. **JWT认证**: 所有API请求需要有效的JWT token
2. **角色权限**: 基于角色的访问控制
3. **输入验证**: 请求参数验证和清理
4. **CORS配置**: 跨域请求控制
5. **安全头**: Helmet安全头设置
6. **密码加密**: bcrypt密码加密存储

## 错误处理

API返回统一的错误格式：

```json
{
  "success": false,
  "message": "错误描述",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

常见HTTP状态码：
- 200: 成功
- 201: 创建成功
- 400: 请求参数错误
- 401: 未授权
- 403: 禁止访问
- 404: 资源不存在
- 500: 服务器内部错误

## 日志系统

使用Winston记录日志：
- 错误日志: `logs/error.log`
- 综合日志: `logs/combined.log`
- 开发环境: 控制台输出

## 部署说明

### Docker部署

```dockerfile
FROM node:16-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
EXPOSE 3000
CMD ["npm", "start"]
```

### PM2部署

```bash
npm install -g pm2
pm2 start src/app.js --name "rongjiahe-erp-backend"
```

## 开发指南

### 添加新API

1. 在 `src/routes/` 目录下创建新的路由文件
2. 导入必要的中间件
3. 使用 `asyncHandler` 包装异步函数
4. 在 `src/app.js` 中注册路由

### 中间件使用

- `authenticateToken`: JWT认证
- `requireRole`: 角色权限检查
- `asyncHandler`: 异步错误处理
- `loggerMiddleware`: 请求日志记录

## 监控和健康检查

健康检查端点：
```
GET /health
```

返回服务器状态信息：
```json
{
  "status": "OK",
  "timestamp": "2024-01-15T10:30:00Z",
  "uptime": 3600,
  "memory": {...},
  "version": "1.0.0"
}
```

---

**开发团队**: 荣禾科技技术部  
**联系方式**: tech@ronghetech.com  
**版本**: v1.0.0