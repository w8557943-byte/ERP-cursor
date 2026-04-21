# 荣禾ERP数据同步演示与测试脚本

## 📋 概述

本目录包含荣禾ERP系统的数据同步演示和性能测试脚本，用于展示和验证PC端与小程序云开发数据同步功能。

## 🚀 快速开始

### 安装依赖

```bash
cd scripts
npm install
```

### 运行演示

```bash
# 基础演示
npm run demo

# 模拟模式（不连接真实API）
npm run demo:mock

# 调试模式
npm run demo:debug

# 生产环境
npm run demo:prod
```

### 性能测试

```bash
# 完整性能测试
npm run demo:performance
```

## 📊 功能特性

### 数据同步演示
- ✅ 系统连接测试
- ✅ 同步状态监控
- ✅ 增量同步演示
- ✅ 一致性检查
- ✅ 冲突解决
- ✅ WebSocket实时通信
- ✅ 系统概览展示
- ✅ 同步历史查询
- ✅ 健康检查

### 性能测试
- ✅ API响应时间测试
- ✅ 同步吞吐量测试
- ✅ WebSocket性能测试
- ✅ 并发性能测试
- ✅ 大数据量测试
- ✅ 内存使用监控
- ✅ 测试报告生成

## 🔧 配置选项

### 环境变量

```bash
# API配置
API_BASE_URL=http://localhost:3003/api
AUTH_TOKEN=your_auth_token

# WebSocket配置
WS_URL=ws://localhost:8081/sync

# 演示配置
ENABLE_REAL_API=true
LOG_LEVEL=info
```

### 配置文件

主要配置位于 `syncDemo.config.js`：

```javascript
export default {
  api: {
    baseUrl: 'http://localhost:3003/api',
    timeout: 30000,
    retries: 3
  },
  websocket: {
    url: 'ws://localhost:8081/sync',
    reconnectInterval: 5000
  },
  demo: {
    simulation: {
      enableRealAPI: true,
      mockDataOnFailure: true
    }
  }
}
```

## 📈 性能指标

### 基准指标

| 指标 | 目标值 | 说明 |
|------|--------|------|
| API响应时间 | < 200ms | 95%请求 |
| 同步吞吐量 | > 100 记录/秒 | 批量同步 |
| WebSocket延迟 | < 100ms | 消息往返 |
| 并发处理能力 | > 5 并发 | 同时同步 |
| 内存增长 | < 50MB | 10次同步后 |

### 测试结果

测试完成后会生成详细的性能报告，包含：
- 响应时间统计
- 吞吐量分析
- 并发性能评估
- 内存使用监控
- 优化建议

## 🎭 演示场景

### 场景1: 正常数据同步
模拟标准的数据同步流程，展示完整的同步过程。

### 场景2: 冲突检测与解决
模拟数据冲突场景，演示自动冲突解决机制。

### 场景3: 一致性检查
展示数据一致性检查功能，确保数据完整性。

### 场景4: 性能测试
模拟高负载场景，测试系统性能表现。

## 🔍 调试与故障排除

### 日志级别

```bash
# 调试模式
DEBUG=sync:* node syncDemo.js

# 详细日志
LOG_LEVEL=debug npm run demo
```

### 常见问题

1. **连接失败**
   - 检查API服务器是否运行
   - 验证网络连接
   - 确认认证令牌

2. **WebSocket连接问题**
   - 检查WebSocket服务器配置
   - 验证端口是否开放
   - 查看防火墙设置

3. **性能测试失败**
   - 确保服务器资源充足
   - 检查数据库连接
   - 验证测试数据

## 📚 相关文档

- [数据同步使用指南](../docs/数据同步使用指南.md)
- [PC端技术架构设计文档](../PC端技术架构设计文档.md)
- [项目README](../README.md)

## 🤝 贡献指南

1. Fork 项目
2. 创建特性分支
3. 提交代码更改
4. 推送到分支
5. 创建Pull Request

## 📄 许可证

MIT License - 详见项目根目录LICENSE文件

## 📞 支持

如有问题，请联系开发团队或提交Issue。

---

**版本**: 1.0.0  
**最后更新**: 2024-01-01  
**维护团队**: 荣禾ERP开发团队