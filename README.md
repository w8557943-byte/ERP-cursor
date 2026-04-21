# 荣禾ERP系统

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](https://github.com/your-repo/rongjiahe-erp)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.0.0-green.svg)](https://nodejs.org/)
[![React](https://img.shields.io/badge/react-18.2.0-blue.svg)](https://reactjs.org/)
[![MongoDB](https://img.shields.io/badge/mongodb-%3E%3D6.0-green.svg)](https://www.mongodb.com/)
[![License](https://img.shields.io/badge/license-MIT-yellow.svg)](LICENSE)

> 🏢 现代化企业资源规划管理系统，基于 React + Node.js + MongoDB 构建

## 📋 目录

- [项目简介](#项目简介)
- [功能特性](#功能特性)
- [技术栈](#技术栈)
- [系统架构](#系统架构)
- [快速开始](#快速开始)
- [开发指南](#开发指南)
- [代码规范](#代码规范)
- [部署说明](#部署说明)
- [API文档](#api文档)
- [常见问题](#常见问题)
- [贡献指南](#贡献指南)
- [许可证](#许可证)

## 🚀 项目简介

荣禾ERP系统是一个现代化的企业资源规划管理系统，旨在帮助企业提高运营效率，优化资源配置。系统采用前后端分离架构，提供完整的业务流程管理解决方案。

### 核心优势

- 🎯 **模块化设计** - 清晰的业务模块划分，易于维护和扩展
- 🔒 **安全可靠** - 完善的权限控制和数据安全保障
- 📱 **响应式界面** - 支持多设备访问，用户体验优秀
- ⚡ **高性能** - 优化的数据库设计和缓存策略
- 🔧 **易于部署** - 支持Docker容器化部署

## ✨ 功能特性

### 核心业务模块

- **👥 用户管理** - 用户注册、登录、权限管理
- **📦 产品管理** - 产品信息、分类、库存管理
- **📋 订单管理** - 订单创建、跟踪、状态管理
- **🏢 客户管理** - 客户信息、关系维护
- **📊 库存管理** - 实时库存、出入库记录
- **🏭 生产管理** - 生产计划、进度跟踪
- **🛒 采购管理** - 采购订单、供应商管理
- **🚚 物流管理** - 发货、配送、物流跟踪
- **💰 财务管理** - 应付账款、财务报表

### 系统功能

- **🔐 身份认证** - JWT Token认证机制
- **🛡️ 权限控制** - 基于角色的访问控制(RBAC)
- **📈 数据分析** - 业务数据统计和可视化
- **🔔 实时通知** - WebSocket实时消息推送
- **📱 响应式设计** - 支持PC、平板、手机访问
- **🌐 国际化** - 多语言支持
- **📊 报表系统** - 丰富的业务报表

## 🛠️ 技术栈

### 前端技术

- **React 18.2** - 用户界面构建
- **Ant Design 5.x** - UI组件库
- **React Router 6** - 路由管理
- **Axios** - HTTP客户端
- **Recharts** - 数据可视化
- **Moment.js** - 日期处理

### 后端技术

- **Node.js 18+** - 服务器运行环境
- **Express.js** - Web应用框架
- **MongoDB 6.0+** - 数据库
- **Mongoose** - MongoDB对象建模
- **JWT** - 身份认证
- **bcrypt** - 密码加密
- **Winston** - 日志管理
- **WebSocket** - 实时通信

### 开发工具

- **ESLint** - 代码质量检查
- **Prettier** - 代码格式化
- **Nodemon** - 开发环境热重载
- **Jest** - 单元测试
- **Docker** - 容器化部署

## 🏗️ 系统架构

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   前端应用      │    │   后端API       │    │   数据库        │
│   (React)       │◄──►│   (Node.js)     │◄──►│   (MongoDB)     │
│   Port: 3001    │    │   Port: 3000    │    │   Port: 27017   │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Nginx         │    │   Redis缓存     │    │   文件存储      │
│   (反向代理)    │    │   (可选)        │    │   (本地/云)     │
└─────────────────┘    └─────────────────┘    └─────────────────┘
```

### 项目结构

```
ERP-cursor/
├── app/
│   ├── frontend/           # React前端应用
│   │   ├── src/
│   │   │   ├── components/ # 可复用组件
│   │   │   ├── pages/      # 页面组件
│   │   │   ├── services/   # API服务
│   │   │   ├── utils/      # 工具函数
│   │   │   └── config/     # 配置文件
│   │   └── package.json
│   ├── backend/            # Node.js后端API
│   │   ├── controllers/    # 控制器
│   │   ├── models/         # 数据模型
│   │   ├── routes/         # 路由定义
│   │   ├── middleware/     # 中间件
│   │   ├── services/       # 业务服务
│   │   ├── utils/          # 工具函数
│   │   └── package.json
│   └── config/             # 环境配置
│       ├── .env.development
│       ├── .env.production
│       └── config-manager.js
├── docs/                   # 项目文档
├── scripts/                # 部署脚本
├── mongodb/                # 数据库文件
├── nginx/                  # Nginx配置
├── .eslintrc.js           # ESLint配置
├── .prettierrc.js         # Prettier配置
└── package.json           # 项目依赖
```

## 🚀 快速开始

### 环境要求

- Node.js >= 18.0.0
- MongoDB >= 6.0
- npm >= 8.0.0

### 安装步骤

1. **克隆项目**
   ```bash
   git clone https://github.com/your-repo/rongjiahe-erp.git
   cd rongjiahe-erp
   ```

2. **安装依赖**
   ```bash
   # 安装所有依赖
   npm run install:all
   
   # 或者分别安装
   npm install                    # 根目录依赖
   cd app/frontend && npm install # 前端依赖
   cd ../backend && npm install   # 后端依赖
   ```

3. **配置环境变量**
   ```bash
   # 复制环境配置文件
   cp app/config/.env.example app/config/.env.development
   
   # 编辑配置文件
   nano app/config/.env.development
   ```

4. **启动数据库**
   ```bash
   # 启动MongoDB服务
   mongod --dbpath ./mongodb
   ```

5. **启动应用**
   ```bash
   # 开发模式 - 同时启动前后端
   npm run dev:all
   
   # 或者分别启动
   npm run backend:dev    # 后端开发服务器
   npm run frontend:start # 前端开发服务器
   ```

6. **访问应用**
   - 前端应用: http://localhost:3001
   - 后端API: http://localhost:3000
   - API文档: http://localhost:3000/api-docs

## 💻 开发指南

### 开发环境配置

1. **IDE推荐设置**
   - 使用 VSCode
   - 安装推荐插件：ESLint, Prettier, MongoDB for VS Code
   - 配置自动格式化和代码检查

2. **Git钩子配置**
   ```bash
   # 安装husky（可选）
   npm install --save-dev husky
   npx husky install
   ```

### 开发流程

1. **创建功能分支**
   ```bash
   git checkout -b feature/新功能名称
   ```

2. **开发和测试**
   ```bash
   # 代码检查
   npm run code-check
   
   # 自动修复
   npm run code-fix
   
   # 运行测试
   npm run frontend:test
   npm run backend:test
   ```

3. **提交代码**
   ```bash
   git add .
   git commit -m "feat: 添加新功能描述"
   git push origin feature/新功能名称
   ```

### 常用命令

```bash
# 代码质量
npm run code-check          # 检查代码质量
npm run code-fix            # 自动修复代码问题
npm run frontend:lint       # 前端代码检查
npm run backend:lint        # 后端代码检查

# 开发服务
npm run dev:all             # 启动完整开发环境
npm run frontend:start      # 启动前端开发服务器
npm run backend:dev         # 启动后端开发服务器

# 构建部署
npm run build:all           # 构建生产版本
npm run start:all           # 启动生产服务器
```

## 📏 代码规范

### ESLint规则

- 使用2空格缩进
- 使用单引号
- 行末必须有分号
- 最大行长度80字符
- 禁用console.log（警告）
- 禁用debugger（错误）

### 命名规范

- **变量/函数**: camelCase (如: `userName`, `getUserInfo`)
- **常量**: UPPER_SNAKE_CASE (如: `API_BASE_URL`)
- **类**: PascalCase (如: `UserService`)
- **文件**: kebab-case (如: `user-service.js`)
- **组件**: PascalCase (如: `UserProfile.jsx`)

### 提交信息规范

```
<type>(<scope>): <subject>

<body>

<footer>
```

**Type类型:**
- `feat`: 新功能
- `fix`: 修复bug
- `docs`: 文档更新
- `style`: 代码格式化
- `refactor`: 代码重构
- `test`: 测试相关
- `chore`: 构建过程或辅助工具的变动

## 🚀 部署说明

### 生产环境部署

1. **环境准备**
   ```bash
   # 安装Node.js和MongoDB
   # 配置Nginx反向代理
   # 设置SSL证书
   ```

2. **构建应用**
   ```bash
   # 构建前端
   npm run build:all
   ```

3. **配置环境变量**
   ```bash
   # 复制生产环境配置
   cp app/config/.env.example app/config/.env.production
   
   # 编辑生产配置
   nano app/config/.env.production
   ```

4. **启动服务**
   ```bash
   # 使用PM2管理进程
   pm2 start ecosystem.config.js
   
   # 或直接启动
   npm run start:all
   ```

### Docker部署

```bash
# 构建镜像
docker build -t rongjiahe-erp .

# 运行容器
docker run -d -p 8080:8080 --name erp-app rongjiahe-erp

# 使用docker-compose
docker-compose up -d
```

## 📚 API文档

### 认证接口

```http
POST /api/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "password"
}
```

### 用户管理

```http
GET /api/users              # 获取用户列表
GET /api/users/:id          # 获取用户详情
POST /api/users             # 创建用户
PUT /api/users/:id          # 更新用户
DELETE /api/users/:id       # 删除用户
```

### 产品管理

```http
GET /api/products           # 获取产品列表
GET /api/products/:id       # 获取产品详情
POST /api/products          # 创建产品
PUT /api/products/:id       # 更新产品
DELETE /api/products/:id    # 删除产品
```

> 📖 完整API文档请访问: http://localhost:3000/api-docs

## ❓ 常见问题

### Q: 如何重置管理员密码？

A: 运行重置脚本：
```bash
node scripts/reset-admin-password.js
```

### Q: 数据库连接失败怎么办？

A: 检查以下几点：
1. MongoDB服务是否启动
2. 连接字符串是否正确
3. 数据库权限是否配置正确

### Q: 前端页面空白怎么办？

A: 检查以下几点：
1. 后端API是否正常运行
2. 浏览器控制台是否有错误
3. 网络请求是否被拦截

### Q: 如何添加新的业务模块？

A: 参考现有模块结构：
1. 创建数据模型 (`models/`)
2. 添加路由定义 (`routes/`)
3. 实现控制器逻辑 (`controllers/`)
4. 创建前端页面 (`frontend/src/pages/`)

## 🤝 贡献指南

我们欢迎所有形式的贡献！

### 贡献方式

1. **报告问题** - 在Issues中报告bug或提出改进建议
2. **提交代码** - Fork项目并提交Pull Request
3. **完善文档** - 改进文档和示例
4. **分享经验** - 在Discussions中分享使用经验

### 开发贡献流程

1. Fork本仓库
2. 创建特性分支 (`git checkout -b feature/AmazingFeature`)
3. 提交更改 (`git commit -m 'Add some AmazingFeature'`)
4. 推送到分支 (`git push origin feature/AmazingFeature`)
5. 创建Pull Request

### 代码审查标准

- 代码符合ESLint规范
- 包含必要的测试用例
- 更新相关文档
- 提交信息清晰明确

## 📄 许可证

本项目采用 MIT 许可证 - 查看 [LICENSE](LICENSE) 文件了解详情。

## 📞 联系我们

- **项目主页**: https://github.com/your-repo/rongjiahe-erp
- **问题反馈**: https://github.com/your-repo/rongjiahe-erp/issues
- **邮箱**: support@rongjiahe.com
- **QQ群**: 123456789

---

<div align="center">
  <p>如果这个项目对你有帮助，请给我们一个 ⭐️</p>
  <p>Made with ❤️ by 荣禾团队</p>
</div>