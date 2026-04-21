// 数据一致性监控系统
class DataConsistencyMonitor {
  constructor() {
    this.subscribers = new Map(); // 存储订阅者
    this.dataCache = new Map(); // 数据缓存
    this.syncTimestamps = new Map(); // 同步时间戳
    this.consistencyChecks = []; // 一致性检查规则
    this.errorHandlers = []; // 错误处理函数
    
    // 注册默认的一致性检查规则
    this.registerDefaultChecks();
  }
  
  // 注册默认的一致性检查规则
  registerDefaultChecks() {
    // 订单-生产一致性检查
    this.addConsistencyCheck('订单-生产一致性', (orders, productionOrders) => {
      const orderIds = orders.map(order => order.orderNo);
      const productionOrderIds = productionOrders.map(prod => prod.orderNo);
      
      // 检查生产中的订单是否在订单列表中存在
      const missingInOrders = productionOrderIds.filter(prodId => 
        !orderIds.includes(prodId)
      );
      
      // 检查应该在生产中的订单是否在生产列表中
      const producingOrders = orders.filter(order => order.status === 'producing');
      const missingInProduction = producingOrders.filter(order => 
        !productionOrderIds.includes(order.orderNo)
      );
      
      return {
        isValid: missingInOrders.length === 0 && missingInProduction.length === 0,
        issues: [
          ...missingInOrders.map(id => `生产订单 ${id} 在订单列表中不存在`),
          ...missingInProduction.map(order => `订单 ${order.orderNo} 应该在生产中但未找到`)
        ]
      };
    });
    
    // 状态一致性检查
    this.addConsistencyCheck('状态一致性', (orders) => {
      const issues = [];
      
      orders.forEach(order => {
        // 检查状态转换是否合理
        if (order.status === 'completed' && order.progress < 100) {
          issues.push(`订单 ${order.orderNo} 状态为已完成但进度为 ${order.progress}%`);
        }
        
        if (order.status === 'producing' && order.progress === 0) {
          issues.push(`订单 ${order.orderNo} 状态为生产中但进度为 0%`);
        }
      });
      
      return {
        isValid: issues.length === 0,
        issues: issues
      };
    });
  }
  
  // 添加一致性检查规则
  addConsistencyCheck(name, checkFunction) {
    this.consistencyChecks.push({
      name: name,
      check: checkFunction
    });
  }
  
  // 添加错误处理函数
  addErrorHandler(handler) {
    this.errorHandlers.push(handler);
  }
  
  // 订阅数据变更
  subscribe(dataType, callback, context) {
    if (!this.subscribers.has(dataType)) {
      this.subscribers.set(dataType, []);
    }
    
    const subscription = {
      callback: callback,
      context: context
    };
    
    this.subscribers.get(dataType).push(subscription);
    
    // 返回取消订阅函数
    return () => {
      const subscribers = this.subscribers.get(dataType) || [];
      const index = subscribers.findIndex(sub => sub === subscription);
      if (index !== -1) {
        subscribers.splice(index, 1);
      }
    };
  }
  
  // 更新数据并通知订阅者
  updateData(dataType, data, source = 'manual') {
    console.log(`[数据监控] 更新 ${dataType} 数据，来源: ${source}`);
    
    // 缓存数据
    this.dataCache.set(dataType, data);
    this.syncTimestamps.set(dataType, Date.now());
    
    // 执行一致性检查
    this.performConsistencyChecks();
    
    // 通知订阅者
    this.notifySubscribers(dataType, data, source);
  }
  
  // 通知订阅者
  notifySubscribers(dataType, data, source) {
    const subscribers = this.subscribers.get(dataType) || [];
    
    subscribers.forEach(subscription => {
      try {
        if (subscription.context) {
          subscription.callback.call(subscription.context, data, source);
        } else {
          subscription.callback(data, source);
        }
      } catch (error) {
        console.error(`[数据监控] 通知订阅者失败:`, error);
        this.handleError(error, dataType, source);
      }
    });
  }
  
  // 执行一致性检查
  performConsistencyChecks() {
    const orders = this.dataCache.get('orders') || [];
    const productionOrders = this.dataCache.get('productionOrders') || [];
    
    const allIssues = [];
    
    this.consistencyChecks.forEach(check => {
      try {
        const result = check.check(orders, productionOrders);
        
        if (!result.isValid && result.issues.length > 0) {
          console.warn(`[数据监控] ${check.name} 检查失败:`, result.issues);
          allIssues.push({
            checkName: check.name,
            issues: result.issues,
            timestamp: new Date().toISOString()
          });
        }
      } catch (error) {
        console.error(`[数据监控] 执行检查 ${check.name} 失败:`, error);
        this.handleError(error, 'consistency-check', check.name);
      }
    });
    
    // 如果有问题，记录到日志
    if (allIssues.length > 0) {
      this.logConsistencyIssues(allIssues);
    }
  }
  
  // 记录一致性问题
  logConsistencyIssues(issues) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      issues: issues,
      dataSnapshot: {
        ordersCount: this.dataCache.get('orders')?.length || 0,
        productionOrdersCount: this.dataCache.get('productionOrders')?.length || 0
      }
    };
    
    // 这里可以发送到服务器或本地存储
    console.warn('[数据监控] 一致性问题日志:', logEntry);
    
    // 触发错误处理
    this.errorHandlers.forEach(handler => {
      try {
        handler(logEntry);
      } catch (error) {
        console.error('[数据监控] 错误处理函数执行失败:', error);
      }
    });
  }
  
  // 错误处理
  handleError(error, dataType, source) {
    console.error(`[数据监控] 错误处理 - 类型: ${dataType}, 来源: ${source}`, error);
    
    // 这里可以添加错误上报逻辑
    this.errorHandlers.forEach(handler => {
      try {
        handler(error, dataType, source);
      } catch (handlerError) {
        console.error('[数据监控] 错误处理函数执行失败:', handlerError);
      }
    });
  }
  
  // 获取数据状态
  getDataStatus() {
    const status = {};
    
    for (const [dataType, timestamp] of this.syncTimestamps) {
      status[dataType] = {
        lastSync: new Date(timestamp).toLocaleString(),
        dataCount: this.dataCache.get(dataType)?.length || 0,
        isStale: Date.now() - timestamp > 300000 // 5分钟未更新视为陈旧
      };
    }
    
    return status;
  }
  
  // 强制同步所有数据
  forceSyncAll() {
    console.log('[数据监控] 强制同步所有数据');
    
    // 这里可以触发所有数据源的同步
    const event = new CustomEvent('data-sync-request', {
      detail: { type: 'force-sync-all' }
    });
    
    if (typeof window !== 'undefined') {
      window.dispatchEvent(event);
    }
    
    // 通知所有订阅者需要刷新数据
    this.subscribers.forEach((subscribers, dataType) => {
      subscribers.forEach(subscription => {
        try {
          if (subscription.context && typeof subscription.context.loadData === 'function') {
            subscription.context.loadData();
          }
        } catch (error) {
          console.error(`[数据监控] 强制同步 ${dataType} 失败:`, error);
        }
      });
    });
  }
}

// 创建全局实例
const dataConsistencyMonitor = new DataConsistencyMonitor();

// 导出单例
module.exports = dataConsistencyMonitor;