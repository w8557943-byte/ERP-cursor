/**
 * 数据同步演示配置
 * 演示脚本使用的配置参数
 */

export default {
  // API配置
  api: {
    baseUrl: process.env.API_BASE_URL || 'http://localhost:3003/api',
    timeout: 30000,
    retries: 3,
    retryDelay: 1000
  },

  // WebSocket配置
  websocket: {
    url: process.env.WS_URL || 'ws://localhost:8081/sync',
    reconnectInterval: 5000,
    maxReconnectAttempts: 5,
    heartbeatInterval: 30000
  },

  // 认证配置
  auth: {
    token: process.env.AUTH_TOKEN || 'demo_token',
    tokenType: 'Bearer'
  },

  // 演示配置
  demo: {
    // 演示延迟时间 (毫秒)
    delays: {
      apiCall: 500,
      websocketMessage: 200,
      simulationStep: 300,
      scenarioTransition: 1000
    },

    // 演示重试配置
    retries: {
      maxAttempts: 3,
      baseDelay: 1000,
      maxDelay: 5000
    },

    // 模拟数据配置
    simulation: {
      enableRealAPI: process.env.ENABLE_REAL_API !== 'false',
      mockDataOnFailure: true,
      showDetailedLogs: true,
      colorOutput: true
    }
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    colors: {
      success: '#00ff00',
      warning: '#ffff00',
      error: '#ff0000',
      info: '#00ffff',
      bold: '#ffffff'
    }
  },

  // 性能测试配置
  performance: {
    batchSizes: [10, 50, 100, 500],
    concurrentLevels: [1, 2, 5, 10],
    testDuration: 30000,
    warmupTime: 5000
  },

  // 数据同步配置
  sync: {
    entities: ['orders', 'customers', 'products', 'inventory'],
    strategies: ['timestamp', 'merge', 'server_wins', 'client_wins'],
    batchSizes: [50, 100, 200, 500],
    maxConcurrent: 5,
    retryAttempts: 3
  },

  // 监控配置
  monitoring: {
    metrics: ['sync_rate', 'success_rate', 'response_time', 'error_rate'],
    alertThresholds: {
      successRate: 0.95,
      responseTime: 2000,
      errorRate: 0.05
    }
  }
}