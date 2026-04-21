/**
 * 数据同步配置
 * PC端与小程序云开发数据同步的配置文件
 */

const syncConfig = {
  // 基础配置
  base: {
    appId: process.env.MINIPROGRAM_APP_ID || 'your_miniprogram_app_id',
    appSecret: process.env.MINIPROGRAM_APP_SECRET || 'your_miniprogram_app_secret',
    env: process.env.MINIPROGRAM_ENV || 'your_cloud_environment_id',
    databaseName: process.env.DATABASE_NAME || 'erp_system',
    syncPrefix: 'sync_',
    enableSync: process.env.ENABLE_SYNC === 'true'
  },

  // 同步策略配置
  syncStrategy: {
    // 同步模式
    mode: {
      realTime: true,        // 实时同步
      incremental: true,     // 增量同步
      fullSync: false,       // 全量同步（仅在需要时触发）
      scheduled: true        // 定时同步
    },

    // 冲突解决策略
    conflictResolution: {
      strategy: 'timestamp', // timestamp, version, server_wins, client_wins, merge, manual
      priority: 'server',    // server, client
      autoResolve: true,     // 自动解决冲突
      notification: true      // 通知用户冲突解决结果
    },

    // 数据一致性检查
    consistencyCheck: {
      enabled: true,
      interval: 300000,      // 5分钟检查一次
      autoFix: true,        // 自动修复不一致
      detailedReport: true  // 生成详细报告
    },

    // 回滚配置
    rollback: {
      enabled: true,
      maxRollbackPoints: 50, // 最大回滚点数量
      retentionDays: 30,     // 回滚点保留天数
      autoBackup: true,    // 自动备份
      backupInterval: 3600000 // 1小时备份一次
    }
  },

  // 性能配置
  performance: {
    batchSize: 1000,         // 批量处理大小
    maxConcurrentOperations: 5, // 最大并发操作数
    syncInterval: 30000,     // 同步间隔（30秒）
    retryAttempts: 3,       // 重试次数
    retryDelay: 1000,       // 重试延迟（1秒）
    timeout: 30000,         // 超时时间（30秒）
    queueSize: 10000        // 同步队列大小
  },

  // 监控配置
  monitoring: {
    enabled: true,
    healthCheck: {
      enabled: true,
      interval: 60000,     // 健康检查间隔（1分钟）
      timeout: 5000        // 健康检查超时（5秒）
    },
    performance: {
      enabled: true,
      trackMetrics: true,  // 跟踪性能指标
      slowQueryThreshold: 1000, // 慢查询阈值（1秒）
      memoryThreshold: 0.8    // 内存使用阈值（80%）
    },
    alerting: {
      enabled: true,
      email: {
        enabled: true,
        recipients: ['admin@example.com'],
        threshold: 3         // 连续失败3次发送邮件
      },
      webhook: {
        enabled: false,
        url: '',
        secret: ''
      }
    }
  },

  // WebSocket配置
  websocket: {
    enabled: true,
    port: 8081,
    path: '/sync',
    heartbeat: {
      enabled: true,
      interval: 30000,     // 心跳间隔（30秒）
      timeout: 60000       // 心跳超时（60秒）
    },
    broadcast: {
      enabled: true,
      maxClients: 100,     // 最大客户端数
      messageLimit: 1000   // 消息限制
    }
  },

  // 数据库配置
  database: {
    // MongoDB连接配置
    mongodb: {
      uri: process.env.MONGODB_URI || '',
      options: {
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000,
        family: 4
      }
    },

    // 集合映射配置
    collections: {
      // 订单相关
      orders: {
        local: 'orders',
        cloud: 'orders',
        fields: ['orderNumber', 'customerId', 'items', 'totalAmount', 'status', 'createdAt', 'updatedAt'],
        syncFields: ['status', 'items', 'totalAmount', 'updatedAt'],
        conflictFields: ['status', 'totalAmount']
      },

      // 客户相关
      customers: {
        local: 'customers',
        cloud: 'customers',
        fields: ['name', 'phone', 'email', 'address', 'createdAt', 'updatedAt'],
        syncFields: ['name', 'phone', 'email', 'address', 'updatedAt'],
        conflictFields: ['phone', 'email', 'address']
      },

      // 产品相关
      products: {
        local: 'products',
        cloud: 'products',
        fields: ['name', 'code', 'price', 'stock', 'category', 'createdAt', 'updatedAt'],
        syncFields: ['price', 'stock', 'updatedAt'],
        conflictFields: ['price', 'stock']
      },

      // 库存相关
      inventory: {
        local: 'inventory',
        cloud: 'inventory',
        fields: ['productId', 'quantity', 'warehouse', 'updatedAt'],
        syncFields: ['quantity', 'warehouse', 'updatedAt'],
        conflictFields: ['quantity']
      }
    }
  },

  // 云开发配置
  cloud: {
    // 微信小程序云开发
    wechat: {
      env: process.env.WECHAT_CLOUD_ENV || 'your_wechat_cloud_env_id',
      timeout: 30000,
      retry: {
        enabled: true,
        attempts: 3,
        delay: 1000
      }
    },

    // 云函数配置
    functions: {
      dataSync: {
        name: 'data-sync',
        timeout: 30000,
        memory: 512
      },
      batchSync: {
        name: 'batch-sync',
        timeout: 60000,
        memory: 1024
      }
    }
  },

  // 日志配置
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: 'json',
    output: {
      console: true,
      file: true,
      database: false
    },
    rotation: {
      enabled: true,
      maxSize: '10m',       // 最大文件大小
      maxFiles: 10,         // 最大文件数量
      compress: true        // 压缩旧日志
    }
  },

  // 安全配置
  security: {
    encryption: {
      enabled: true,
      algorithm: 'aes-256-gcm',
      key: process.env.ENCRYPTION_KEY || 'your_32_character_encryption_key_here'
    },
    authentication: {
      enabled: true,
      tokenExpiry: 3600,    // Token过期时间（1小时）
      refreshTokenExpiry: 86400 // 刷新Token过期时间（24小时）
    },
    rateLimit: {
      enabled: true,
      windowMs: 60000,      // 时间窗口（1分钟）
      max: 100,            // 最大请求数
      message: '请求过于频繁，请稍后再试'
    }
  },

  // 测试配置
  testing: {
    enabled: process.env.NODE_ENV === 'development',
    mockData: {
      enabled: true,
      dataSize: 1000       // 测试数据大小
    },
    performance: {
      benchmark: true,     // 性能基准测试
      loadTest: false,     // 负载测试
      stressTest: false    // 压力测试
    }
  }
}

export default syncConfig
