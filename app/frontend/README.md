# ERP PC端管理后台

基于React + Ant Design构建的PC端ERP管理系统。

## 技术栈

- **前端框架**: React 18.2
- **UI组件库**: Ant Design 5.x
- **构建工具**: Vite
- **路由管理**: React Router 6
- **状态管理**: React Query
- **HTTP客户端**: Axios
- **数据可视化**: Ant Design Charts

## 项目结构

```
src/
├── components/          # 公共组件
│   ├── Layout/         # 布局组件
│   ├── Dashboard/      # 仪表盘组件
│   └── Loading/        # 加载组件
├── pages/              # 页面组件
│   ├── Dashboard.jsx   # 仪表盘
│   ├── Login.jsx       # 登录页
│   ├── OrderManagement.jsx     # 订单管理
│   ├── ProductionManagement.jsx # 生产管理
│   ├── CustomerManagement.jsx  # 客户管理
│   ├── FinancialManagement.jsx # 财务管理
│   └── SystemSettings.jsx      # 系统设置
├── services/           # API服务
├── stores/             # 状态管理
├── router/             # 路由配置
├── utils/              # 工具函数
└── hooks/              # 自定义Hooks
```

## 功能模块

### 1. 仪表盘
- 业务数据概览
- 订单趋势图表
- 生产状态分布
- 最新订单列表

### 2. 订单管理
- 订单列表展示
- 订单状态管理
- 订单搜索筛选
- 订单增删改查

### 3. 生产管理
- 生产进度监控
- 生产状态管理
- 生产数据统计
- 生产任务操作

### 4. 客户管理
- 客户信息管理
- 客户等级管理
- 客户订单历史
- 客户数据分析

### 5. 财务管理
- 收入支出统计
- 财务报表生成
- 财务数据导出
- 利润分析

### 6. 系统设置
- 基础信息配置
- 数据备份恢复
- 安全设置
- 权限管理

## 开发环境

### 环境要求
- Node.js >= 16.0.0
- npm >= 7.0.0

### 安装依赖
\`\`\`bash
npm install
\`\`\`

### 启动开发服务器
\`\`\`bash
npm run dev
\`\`\`

### 构建生产版本
\`\`\`bash
npm run build
\`\`\`

## 打包为Windows EXE

本项目PC端使用 Electron + electron-builder 打包。

### 环境要求
- Windows 10/11（打包 Windows 安装包建议在 Windows 上执行）
- Node.js 与 npm（版本以 package.json 声明为准）

### 打包命令
在 `app/frontend` 目录执行：

\`\`\`bash
npm run build:win
\`\`\`

### 产物位置
- 目录：`app/frontend/dist-electron-win-*/`
- 解压版可执行文件：`app/frontend/dist-electron-win-*/win-unpacked/荣禾ERP.exe`
- 安装包（NSIS）：`app/frontend/dist-electron-win-*/rongjiahe-erp-*-setup.exe`

说明：后端会作为资源被一起打入安装包（见 `package.json -> build.extraResources`），不需要手工把“PC端文件”单独整理成一个目录再打包。

### 卡住/卡死排查（打包阶段）
如果输出停在 `packaging ... appOutDir=...win-unpacked` 很久不动，通常不是配置缺失，而是环境问题（文件被占用/杀软扫描/权限/网络）。

最有效的定位方式：
- 使用带日志脚本：`npm run build:win:debug`，会在 `app/frontend/` 下生成 `dist-electron-win-*.log`
- 如果卡住，把这个 `.log` 最后 80 行发出来即可定位

常见根因与处理：
- 杀毒/Defender 实时防护扫描导致长时间无输出：将 `app/frontend/dist-electron-win-*` 与 `%LOCALAPPDATA%\\electron-builder\\Cache` 加入排除
- 旧产物/缓存文件被占用（例如 `app.asar`）：确保没有运行 `win-unpacked\\*.exe`，并关闭资源管理器预览窗格后再打包
- 网络超时（下载 NSIS/相关工具）：已在脚本内使用镜像源；如仍失败，检查公司网络代理/HTTPS 拦截

### 预览构建结果
\`\`\`bash
npm run preview
\`\`\`

## 部署说明

### 开发环境
- 端口: 3001
- 后端API: http://localhost:3000

### 生产环境
- 使用Nginx进行静态资源部署
- 配置反向代理到后端API

## 数据同步机制

PC端与小程序端通过以下方式实现数据同步：

1. **实时同步**: WebSocket连接保持数据实时更新
2. **定时同步**: 定时任务定期同步关键数据
3. **手动同步**: 提供手动同步按钮用于即时更新

## 安全特性

- JWT Token认证
- 路由权限控制
- 数据加密传输
- 会话超时管理

## 浏览器支持

- Chrome >= 88
- Firefox >= 78
- Safari >= 14
- Edge >= 88

## 开发计划

### 已完成
- ✅ 项目基础架构搭建
- ✅ 登录认证系统
- ✅ 核心页面框架
- ✅ 基础数据展示

### 进行中
- 🔄 后端API集成
- 🔄 数据可视化优化
- 🔄 移动端适配

### 计划中
- 📋 高级权限管理
- 📋 报表导出功能
- 📋 消息推送系统
- 📋 性能优化

## 贡献指南

1. Fork 项目
2. 创建功能分支
3. 提交代码变更
4. 发起 Pull Request

## 许可证

MIT License
