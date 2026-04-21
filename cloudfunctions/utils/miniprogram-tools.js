/**
 * 小程序端云开发工具库
 * 提供小程序与云函数交互的统一接口
 * 不涉及前端UI，专注于数据交互
 */

// 云函数调用封装
class CloudFunctionManager {
  constructor(envId) {
    this.envId = envId;
    this.callFunction = wx.cloud.callFunction;
  }

  /**
   * 统一调用云函数
   */
  async call(name, data = {}) {
    try {
      const result = await this.callFunction({
        name,
        data
      });
      
      return {
        success: true,
        data: result.result,
        timestamp: Date.now()
      };
    } catch (error) {
      console.error(`[云函数调用] ${name} 失败:`, error);
      return {
        success: false,
        error: error.message,
        timestamp: Date.now()
      };
    }
  }

  /**
   * 调用数据同步云函数
   */
  async syncData(action, syncData) {
    return await this.call('data-sync', { action, ...syncData });
  }

  /**
   * 调用WebSocket管理器
   */
  async manageWebSocket(action, wsData) {
    return await this.call('websocket-manager', { action, ...wsData });
  }

  /**
   * 调用数据库操作云函数
   */
  async operateDatabase(action, dbData) {
    return await this.call('database-ops', { action, ...dbData });
  }

  /**
   * 调用同步监控云函数
   */
  async monitorSync(monitorData) {
    return await this.call('sync-monitor', monitorData);
  }
}

// 数据库操作封装
class DatabaseManager {
  constructor(envId) {
    this.envId = envId;
    this.db = wx.cloud.database();
    this.collections = {
      orders: 'orders',
      customers: 'customers', 
      products: 'products',
      inventory: 'inventory',
      users: 'users',
      manufacturing_orders: 'manufacturing_orders',
      shipping_orders: 'shipping_orders'
    };
  }

  /**
   * 通用数据库操作
   */
  async operate(collection, operation, data) {
    const coll = this.db.collection(collection);
    
    try {
      let result;
      
      switch (operation) {
        case 'add':
          result = await coll.add({ data });
          break;
        case 'get':
          result = await coll.doc(data.id).get();
          break;
        case 'update':
          result = await coll.doc(data.id).update({ data });
          break;
        case 'remove':
          result = await coll.doc(data.id).remove();
          break;
        case 'where':
          result = await coll.where(data.condition).get();
          break;
        case 'aggregate':
          result = await coll.aggregate().end();
          break;
        default:
          throw new Error(`不支持的操作: ${operation}`);
      }
      
      return {
        success: true,
        data: result.data || result.result,
        _id: result._id
      };
    } catch (error) {
      console.error(`[数据库操作] ${collection}.${operation} 失败:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 批量操作
   */
  async batchOperate(collection, operations) {
    try {
      const results = [];
      
      for (const op of operations) {
        const result = await this.operate(collection, op.operation, op.data);
        results.push(result);
      }
      
      return {
        success: true,
        results,
        total: operations.length
      };
    } catch (error) {
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 获取集合的访问器
   */
  getCollection(name) {
    return this.db.collection(this.collections[name] || name);
  }
}

// 同步状态管理器
class SyncStateManager {
  constructor() {
    this.syncQueue = [];
    this.isSyncing = false;
    this.lastSyncTime = null;
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  /**
   * 添加同步任务到队列
   */
  addToQueue(syncTask) {
    this.syncQueue.push({
      ...syncTask,
      id: `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      retryCount: 0,
      status: 'pending'
    });
    
    // 保存到本地存储
    this.saveQueueToStorage();
  }

  /**
   * 处理同步队列
   */
  async processQueue() {
    if (this.isSyncing || this.syncQueue.length === 0) {
      return;
    }
    
    this.isSyncing = true;
    
    try {
      while (this.syncQueue.length > 0) {
        const task = this.syncQueue.shift();
        await this.processSyncTask(task);
      }
    } finally {
      this.isSyncing = false;
      this.lastSyncTime = Date.now();
      this.saveQueueToStorage();
    }
  }

  /**
   * 处理单个同步任务
   */
  async processSyncTask(task) {
    try {
      task.status = 'processing';
      
      // 调用数据同步云函数
      const result = await this.executeSyncTask(task);
      
      if (result.success) {
        task.status = 'completed';
        this.retryCount = 0;
        console.log(`[同步任务] ${task.id} 完成`);
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      task.status = 'failed';
      task.error = error.message;
      task.retryCount++;
      
      console.error(`[同步任务] ${task.id} 失败:`, error.message);
      
      // 重试逻辑
      if (task.retryCount < this.maxRetries) {
        task.status = 'pending';
        this.syncQueue.unshift(task); // 放回队列前面
      }
    }
    
    this.saveQueueToStorage();
  }

  /**
   * 执行同步任务
   */
  async executeSyncTask(task) {
    // 根据任务类型调用不同的云函数
    switch (task.type) {
      case 'data_create':
        return await this.cloudFunctionManager.syncData('create', {
          collection: task.collection,
          data: task.data
        });
      case 'data_update':
        return await this.cloudFunctionManager.syncData('update', {
          collection: task.collection,
          data: task.data,
          filter: task.filter
        });
      case 'data_delete':
        return await this.cloudFunctionManager.syncData('delete', {
          collection: task.collection,
          filter: task.filter
        });
      case 'batch_sync':
        return await this.cloudFunctionManager.syncData('batchSync', {
          changes: task.changes
        });
      default:
        throw new Error(`未知的同步任务类型: ${task.type}`);
    }
  }

  /**
   * 保存队列到本地存储
   */
  saveQueueToStorage() {
    try {
      wx.setStorageSync('sync_queue', {
        queue: this.syncQueue,
        isSyncing: this.isSyncing,
        lastSyncTime: this.lastSyncTime,
        retryCount: this.retryCount
      });
    } catch (error) {
      console.warn('[同步队列] 保存失败:', error);
    }
  }

  /**
   * 从本地存储加载队列
   */
  loadQueueFromStorage() {
    try {
      const data = wx.getStorageSync('sync_queue');
      if (data) {
        this.syncQueue = data.queue || [];
        this.isSyncing = data.isSyncing || false;
        this.lastSyncTime = data.lastSyncTime || null;
        this.retryCount = data.retryCount || 0;
      }
    } catch (error) {
      console.warn('[同步队列] 加载失败:', error);
    }
  }

  /**
   * 清空同步队列
   */
  clearQueue() {
    this.syncQueue = [];
    this.retryCount = 0;
    this.saveQueueToStorage();
  }

  /**
   * 获取队列状态
   */
  getQueueStatus() {
    return {
      queueLength: this.syncQueue.length,
      isSyncing: this.isSyncing,
      lastSyncTime: this.lastSyncTime,
      retryCount: this.retryCount,
      pendingTasks: this.syncQueue.filter(task => task.status === 'pending').length,
      failedTasks: this.syncQueue.filter(task => task.status === 'failed').length,
      completedTasks: this.syncQueue.filter(task => task.status === 'completed').length
    };
  }

  /**
   * 设置云函数管理器
   */
  setCloudFunctionManager(manager) {
    this.cloudFunctionManager = manager;
  }
}

// 错误处理和重试机制
class ErrorHandler {
  /**
   * 统一错误处理
   */
  static handle(error, context) {
    const errorInfo = {
      message: error.message || error,
      stack: error.stack,
      context,
      timestamp: Date.now(),
      userAgent: 'miniprogram'
    };
    
    // 记录到本地存储
    this.logError(errorInfo);
    
    // 决定是否需要重试
    if (this.shouldRetry(error)) {
      return {
        shouldRetry: true,
        retryAfter: this.getRetryDelay(error)
      };
    }
    
    return {
      shouldRetry: false,
      userMessage: this.getUserFriendlyMessage(error)
    };
  }

  /**
   * 记录错误
   */
  static logError(errorInfo) {
    try {
      const errors = wx.getStorageSync('error_logs') || [];
      errors.push(errorInfo);
      
      // 限制错误日志数量
      if (errors.length > 100) {
        errors.splice(0, errors.length - 100);
      }
      
      wx.setStorageSync('error_logs', errors);
    } catch (storageError) {
      console.error('[错误记录] 存储失败:', storageError);
    }
  }

  /**
   * 判断是否应该重试
   */
  static shouldRetry(error) {
    const retryableErrors = [
      'NETWORK_ERROR',
      'TIMEOUT',
      'SERVER_ERROR',
      'CONNECTION_REFUSED'
    ];
    
    return retryableErrors.includes(error.code) || 
           error.message.includes('网络') ||
           error.message.includes('超时');
  }

  /**
   * 获取重试延迟
   */
  static getRetryDelay(error) {
    // 指数退避策略
    const baseDelay = 1000; // 1秒
    const maxDelay = 30000; // 30秒
    
    const delay = Math.min(baseDelay * Math.pow(2, error.retryCount || 0), maxDelay);
    return delay;
  }

  /**
   * 获取用户友好的错误信息
   */
  static getUserFriendlyMessage(error) {
    const messageMap = {
      'NETWORK_ERROR': '网络连接异常，请检查网络设置',
      'TIMEOUT': '请求超时，请稍后重试',
      'PERMISSION_DENIED': '权限不足，无法执行此操作',
      'RESOURCE_NOT_FOUND': '请求的资源不存在',
      'SERVER_ERROR': '服务器异常，请稍后重试'
    };
    
    return messageMap[error.code] || '操作失败，请重试';
  }

  /**
   * 清理旧错误日志
   */
  static cleanupOldErrors(retentionDays = 7) {
    try {
      const errors = wx.getStorageSync('error_logs') || [];
      const cutoffTime = Date.now() - (retentionDays * 24 * 60 * 60 * 1000);
      
      const filteredErrors = errors.filter(error => error.timestamp > cutoffTime);
      wx.setStorageSync('error_logs', filteredErrors);
      
      return {
        cleaned: errors.length - filteredErrors.length,
        remaining: filteredErrors.length
      };
    } catch (error) {
      console.error('[错误清理] 失败:', error);
      return { cleaned: 0, remaining: 0 };
    }
  }
}

// 性能监控
class PerformanceMonitor {
  constructor() {
    this.metrics = {
      apiCalls: [],
      memoryUsage: [],
      networkRequests: []
    };
    this.thresholds = {
      apiResponseTime: 5000, // 5秒
      memoryUsage: 50 * 1024 * 1024, // 50MB
      networkLatency: 3000 // 3秒
    };
  }

  /**
   * 记录API调用性能
   */
  recordApiCall(url, startTime, endTime, success = true) {
    const duration = endTime - startTime;
    
    this.metrics.apiCalls.push({
      url,
      duration,
      success,
      timestamp: endTime
    });
    
    // 检查是否超过阈值
    if (duration > this.thresholds.apiResponseTime) {
      this.triggerAlert('slow_api_call', {
        url,
        duration,
        threshold: this.thresholds.apiResponseTime
      });
    }
    
    // 限制数据量
    if (this.metrics.apiCalls.length > 100) {
      this.metrics.apiCalls.splice(0, this.metrics.apiCalls.length - 100);
    }
  }

  /**
   * 记录内存使用情况
   */
  recordMemoryUsage() {
    if (wx.getSystemInfo) {
      wx.getSystemInfo({
        success: (res) => {
          const memoryUsage = res.memory || 0;
          
          this.metrics.memoryUsage.push({
            usage: memoryUsage,
            timestamp: Date.now()
          });
          
          // 检查内存使用阈值
          if (memoryUsage > this.thresholds.memoryUsage) {
            this.triggerAlert('high_memory_usage', {
              usage: memoryUsage,
              threshold: this.thresholds.memoryUsage
            });
          }
          
          // 限制数据量
          if (this.metrics.memoryUsage.length > 50) {
            this.metrics.memoryUsage.splice(0, this.metrics.memoryUsage.length - 50);
          }
        }
      });
    }
  }

  /**
   * 记录网络请求
   */
  recordNetworkRequest(method, url, startTime, endTime, status) {
    const latency = endTime - startTime;
    
    this.metrics.networkRequests.push({
      method,
      url,
      latency,
      status,
      timestamp: endTime
    });
    
    // 检查网络延迟阈值
    if (latency > this.thresholds.networkLatency) {
      this.triggerAlert('high_network_latency', {
        method,
        url,
        latency,
        threshold: this.thresholds.networkLatency
      });
    }
    
    // 限制数据量
    if (this.metrics.networkRequests.length > 100) {
      this.metrics.networkRequests.splice(0, this.metrics.networkRequests.length - 100);
    }
  }

  /**
   * 触发告警
   */
  triggerAlert(type, data) {
    const alert = {
      type,
      data,
      timestamp: Date.now()
    };
    
    // 发送到监控云函数
    this.sendAlert(alert);
  }

  /**
   * 发送告警到云函数
   */
  async sendAlert(alert) {
    try {
      await wx.cloud.callFunction({
        name: 'sync-monitor',
        data: {
          action: 'alert_threshold_exceeded',
          data: alert
        }
      });
    } catch (error) {
      console.error('[性能告警] 发送失败:', error);
    }
  }

  /**
   * 获取性能统计
   */
  getPerformanceStats(timeRange = 3600000) { // 默认1小时
    const cutoff = Date.now() - timeRange;
    
    return {
      apiCalls: {
        total: this.metrics.apiCalls.filter(call => call.timestamp > cutoff).length,
        averageDuration: this.calculateAverageDuration(this.metrics.apiCalls, cutoff),
        slowCalls: this.metrics.apiCalls.filter(call => 
          call.timestamp > cutoff && call.duration > this.thresholds.apiResponseTime
        ).length
      },
      memoryUsage: {
        current: this.metrics.memoryUsage.length > 0 ? 
          this.metrics.memoryUsage[this.metrics.memoryUsage.length - 1].usage : 0,
        average: this.calculateAverageMemory(this.metrics.memoryUsage, cutoff)
      },
      networkRequests: {
        total: this.metrics.networkRequests.filter(req => req.timestamp > cutoff).length,
        averageLatency: this.calculateAverageLatency(this.metrics.networkRequests, cutoff)
      }
    };
  }

  /**
   * 计算平均响应时间
   */
  calculateAverageDuration(calls, cutoff) {
    const filteredCalls = calls.filter(call => call.timestamp > cutoff);
    if (filteredCalls.length === 0) return 0;
    
    const total = filteredCalls.reduce((sum, call) => sum + call.duration, 0);
    return Math.round(total / filteredCalls.length);
  }

  /**
   * 计算平均内存使用
   */
  calculateAverageMemory(usage, cutoff) {
    const filteredUsage = usage.filter(u => u.timestamp > cutoff);
    if (filteredUsage.length === 0) return 0;
    
    const total = filteredUsage.reduce((sum, u) => sum + u.usage, 0);
    return Math.round(total / filteredUsage.length);
  }

  /**
   * 计算平均网络延迟
   */
  calculateAverageLatency(requests, cutoff) {
    const filteredRequests = requests.filter(req => req.timestamp > cutoff);
    if (filteredRequests.length === 0) return 0;
    
    const total = filteredRequests.reduce((sum, req) => sum + req.latency, 0);
    return Math.round(total / filteredRequests.length);
  }
}

// 离线支持
class OfflineSupport {
  constructor() {
    this.cache = new Map();
    this.syncQueue = [];
    this.isOnline = true;
  }

  /**
   * 检查网络状态
   */
  checkNetworkStatus() {
    wx.getNetworkType({
      success: (res) => {
        const wasOnline = this.isOnline;
        this.isOnline = res.networkType !== 'none';
        
        // 网络状态变化
        if (wasOnline !== this.isOnline) {
          this.onNetworkChange(this.isOnline);
        }
      },
      fail: () => {
        this.isOnline = false;
        this.onNetworkChange(false);
      }
    });
  }

  /**
   * 网络状态变化处理
   */
  onNetworkChange(isOnline) {
    if (isOnline) {
      // 恢复在线，处理离线队列
      this.processOfflineQueue();
    } else {
      // 进入离线模式
      console.log('[离线支持] 进入离线模式');
    }
  }

  /**
   * 缓存数据
   */
  cacheData(key, data, ttl = 3600000) { // 默认1小时
    const item = {
      data,
      timestamp: Date.now(),
      ttl
    };
    
    this.cache.set(key, item);
  }

  /**
   * 获取缓存数据
   */
  getCachedData(key) {
    const item = this.cache.get(key);
    if (!item) return null;
    
    const now = Date.now();
    if (now - item.timestamp > item.ttl) {
      this.cache.delete(key);
      return null;
    }
    
    return item.data;
  }

  /**
   * 添加到离线队列
   */
  addToOfflineQueue(operation) {
    this.syncQueue.push({
      ...operation,
      id: `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      timestamp: Date.now(),
      offline: true
    });
    
    // 保存到本地存储
    this.saveOfflineQueue();
  }

  /**
   * 处理离线队列
   */
  async processOfflineQueue() {
    if (this.syncQueue.length === 0) return;
    
    console.log(`[离线队列] 处理 ${this.syncQueue.length} 个离线操作`);
    
    const queue = [...this.syncQueue];
    this.syncQueue = [];
    
    for (const operation of queue) {
      try {
        // 这里调用相应的API或云函数
        await this.executeOperation(operation);
        console.log(`[离线队列] 成功: ${operation.id}`);
      } catch (error) {
        console.error(`[离线队列] 失败: ${operation.id}`, error);
        // 失败的操作重新加入队列
        this.syncQueue.push(operation);
      }
    }
    
    this.saveOfflineQueue();
  }

  /**
   * 执行操作
   */
  async executeOperation(operation) {
    // 根据操作类型执行相应逻辑
    switch (operation.type) {
      case 'data_create':
        // 创建数据
        break;
      case 'data_update':
        // 更新数据
        break;
      case 'data_delete':
        // 删除数据
        break;
      default:
        throw new Error(`未知的操作类型: ${operation.type}`);
    }
  }

  /**
   * 保存离线队列到本地
   */
  saveOfflineQueue() {
    try {
      wx.setStorageSync('offline_queue', this.syncQueue);
    } catch (error) {
      console.error('[离线队列] 保存失败:', error);
    }
  }

  /**
   * 从本地加载离线队列
   */
  loadOfflineQueue() {
    try {
      this.syncQueue = wx.getStorageSync('offline_queue') || [];
    } catch (error) {
      console.error('[离线队列] 加载失败:', error);
      this.syncQueue = [];
    }
  }

  /**
   * 清空离线队列
   */
  clearOfflineQueue() {
    this.syncQueue = [];
    this.saveOfflineQueue();
  }

  /**
   * 获取离线队列状态
   */
  getOfflineQueueStatus() {
    return {
      queueLength: this.syncQueue.length,
      isOnline: this.isOnline,
      oldestOperation: this.syncQueue.length > 0 ? 
        Math.min(...this.syncQueue.map(op => op.timestamp)) : null
    };
  }
}

// 工具函数
const utils = {
  /**
   * 格式化时间戳
   */
  formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}:${String(date.getSeconds()).padStart(2, '0')}`;
  },

  /**
   * 生成唯一ID
   */
  generateId(prefix = 'id') {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  },

  /**
   * 深拷贝
   */
  deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => this.deepClone(item));
    
    const cloned = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        cloned[key] = this.deepClone(obj[key]);
      }
    }
    return cloned;
  },

  /**
   * 防抖函数
   */
  debounce(func, delay) {
    let timeoutId;
    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => func.apply(this, args), delay);
    };
  },

  /**
   * 节流函数
   */
  throttle(func, delay) {
    let lastExecTime = 0;
    return function (...args) {
      const currentTime = Date.now();
      if (currentTime - lastExecTime > delay) {
        func.apply(this, args);
        lastExecTime = currentTime;
      }
    };
  },

  /**
   * 验证数据格式
   */
  validateData(data, schema) {
    const errors = [];
    
    for (const [field, rules] of Object.entries(schema)) {
      const value = data[field];
      
      if (rules.required && (value === undefined || value === null)) {
        errors.push(`${field} 是必填字段`);
        continue;
      }
      
      if (value !== undefined && value !== null) {
        if (rules.type && typeof value !== rules.type) {
          errors.push(`${field} 应该是 ${rules.type} 类型`);
        }
        
        if (rules.minLength && value.length < rules.minLength) {
          errors.push(`${field} 长度不能少于 ${rules.minLength} 个字符`);
        }
        
        if (rules.maxLength && value.length > rules.maxLength) {
          errors.push(`${field} 长度不能超过 ${rules.maxLength} 个字符`);
        }
        
        if (rules.pattern && !rules.pattern.test(value)) {
          errors.push(`${field} 格式不正确`);
        }
      }
    }
    
    return {
      isValid: errors.length === 0,
      errors
    };
  }
};

// 导出管理器类
module.exports = {
  CloudFunctionManager,
  DatabaseManager,
  SyncStateManager,
  ErrorHandler,
  PerformanceMonitor,
  OfflineSupport,
  utils
};