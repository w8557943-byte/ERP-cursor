/**
 * 荣禾ERP数据同步工具库
 * 确保订单数据在不同页面间的一致性
 */

const app = getApp();
const dataConsistencyMonitor = require('./data-consistency-monitor.js');

class DataSyncManager {
  constructor() {
    this.subscribers = new Map(); // 订阅者列表
    this.cache = new Map(); // 数据缓存
    this.lastSyncTime = {}; // 最后同步时间
    this.inFlight = new Map();
    this.watchTimers = new Map();
    
    // 注册到数据一致性监控器
    this.registerWithMonitor();
  }
  
  // 注册到数据一致性监控器
  registerWithMonitor() {
    // 当数据更新时，通知监控器
    this.subscribe('orders', (data, source) => {
      dataConsistencyMonitor.updateData('orders', data, source);
    }, this);
    
    // 注册错误处理
    dataConsistencyMonitor.addErrorHandler((error, dataType, source) => {
      console.error(`[数据同步] 一致性监控报告错误:`, error);
      // 这里可以添加错误恢复逻辑
    });
  }

  /**
   * 订阅数据变更
   */
  subscribe(dataType, callback, context) {
    if (!this.subscribers.has(dataType)) {
      this.subscribers.set(dataType, []);
    }
    
    const subscriber = { callback, context };
    this.subscribers.get(dataType).push(subscriber);
    
    // 返回取消订阅函数
    return () => {
      const subscribers = this.subscribers.get(dataType) || [];
      const index = subscribers.findIndex(s => s.callback === callback);
      if (index !== -1) {
        subscribers.splice(index, 1);
      }
    };
  }

  /**
   * 发布数据变更
   */
  publish(dataType, data, source) {
    console.log(`[数据同步] 发布 ${dataType} 变更，来源: ${source}`);
    
    // 更新缓存
    this.cache.set(dataType, data);
    this.lastSyncTime[dataType] = Date.now();
    
    // 通知订阅者
    const subscribers = this.subscribers.get(dataType) || [];
    subscribers.forEach(subscriber => {
      try {
        subscriber.callback.call(subscriber.context, data, source);
      } catch (error) {
        console.error(`[数据同步] 通知订阅者失败:`, error);
      }
    });
  }

  /**
   * 获取数据（优先从缓存获取）
   */
  async getData(dataType, forceRefresh = false) {
    // 如果有缓存且不需要强制刷新，直接返回缓存
    if (!forceRefresh && this.cache.has(dataType)) {
      const cachedData = this.cache.get(dataType);
      const cacheAge = Date.now() - (this.lastSyncTime[dataType] || 0);
      
      // 缓存有效期为30秒
      if (cacheAge < 30 * 1000) {
        console.log(`[数据同步] 使用缓存数据: ${dataType}`);
        return cachedData;
      }
    }

    // 从云函数获取数据
    const data = await this.fetchFromCloud(dataType);
    
    // 通知监控器数据已更新
    dataConsistencyMonitor.updateData(dataType, data, 'data-sync');
    
    return data;
  }

  /**
   * 从云函数获取数据
   */
  async fetchFromCloud(dataType) {
    if (this.inFlight.has(dataType)) {
      console.log(`[数据同步] 正在同步 ${dataType}，复用请求`);
      return this.inFlight.get(dataType);
    }

    const promise = (async () => {
      console.log(`[数据同步] 从云端获取数据: ${dataType}`);
      
      let data = [];
      let ok = false;

      // 尝试旧版动作: getOrders
      try {
        const pageLimit = 100;
        const maxItems = 500;
        let page = 1;
        let hasMore = true;
        const all = [];

        while (hasMore && all.length < maxItems) {
          const result = await wx.cloud.callFunction({
            name: 'erp-api',
            data: {
              action: 'getOrders',
              params: { page, limit: pageLimit }
            }
          });
          if (result && result.result) {
            if (result.result.success) {
              const pageData = Array.isArray(result.result.data) ? result.result.data : [];
              all.push(...pageData);
              hasMore = result.result.pagination ? !!result.result.pagination.hasMore : pageData.length >= pageLimit;
              if (!pageData.length) hasMore = false;
              page += 1;
              ok = true;
              continue;
            } else if (Array.isArray(result.result)) {
              data = result.result;
              ok = true;
              hasMore = false;
              break;
            }
          }
          throw new Error('getOrders 返回格式不正确');
        }

        if (ok && !data.length) {
          data = all;
        }
      } catch (e) {
        console.warn('[数据同步] getOrders 调用失败，尝试兼容接口', e);
      }

      // 兼容新版动作: orders/getList
      if (!ok) {
        try {
          const alt = await wx.cloud.callFunction({
            name: 'erp-api',
            data: {
              action: 'orders',
              method: 'getList',
              data: { page: 1, limit: 100 }
            }
          });
          if (alt && alt.result) {
            if (alt.result.success) {
              data = alt.result.data || [];
              ok = true;
            } else if (Array.isArray(alt.result)) {
              data = alt.result;
              ok = true;
            }
          }
        } catch (e) {
          void e;
        }
      }

      if (!ok) {
        throw new Error('获取订单数据失败');
      }
      
      // 对订单数据进行排序，确保新订单在前
      if (dataType === 'orders' && Array.isArray(data)) {
        data.sort((a, b) => {
          const getTime = (item) => {
            // 优先使用 createdAt 时间戳
            if (item.createdAt) return new Date(item.createdAt).getTime();
            // 其次使用 createTime
            if (item.createTime) return new Date(item.createTime).getTime();
            // 最后使用订单号中的时间信息或当前时间
            const orderNo = item.orderNo || item.orderNumber || '';
            const dateMatch = orderNo.match(/(20\d{2})(\d{2})(\d{2})/);
            if (dateMatch) {
              const [, year, month, day] = dateMatch;
              return new Date(`${year}-${month}-${day}`).getTime();
            }
            return Date.now(); // 默认返回当前时间，确保新数据在前面
          };
          
          const timeA = getTime(a);
          const timeB = getTime(b);
          return timeB - timeA; // 降序排列，新订单在前
        });
      }
      
      this.publish(dataType, data, 'cloud');
      return data;
      
    })().catch((error) => {
      console.error(`[数据同步] 获取 ${dataType} 失败:`, error);
      
      // 如果缓存中有数据，返回缓存数据
      if (this.cache.has(dataType)) {
        console.log(`[数据同步] 使用缓存数据作为降级方案`);
        return this.cache.get(dataType);
      }
      
      throw error;
    }).finally(() => {
      const current = this.inFlight.get(dataType);
      if (current === promise) {
        this.inFlight.delete(dataType);
      }
    });

    this.inFlight.set(dataType, promise);
    return promise;
  }

  /**
   * 更新数据
   */
  async updateData(dataType, updates) {
    console.log(`[数据同步] 更新 ${dataType} 数据`);
    
    try {
      const payload = Object.assign({}, updates);
      if (payload && payload._id !== undefined) delete payload._id;
      if (payload && payload.id === '') delete payload.id;
      if (payload && payload.orderNo === '') delete payload.orderNo;
      if (payload && payload.orderNumber === '') delete payload.orderNumber;
      const result = await wx.cloud.callFunction({
        name: 'erp-api',
        data: {
          action: 'updateOrder',
          data: payload
        }
      });

      let ok = !!(result && result.result && result.result.success);
      if (!ok) {
        try {
          const alt = await wx.cloud.callFunction({
            name: 'erp-api',
            data: {
              action: 'orders',
              method: 'update',
              data: payload
            }
          });
          ok = !!(alt && alt.result && alt.result.success);
        } catch (e2) {}
      }

      if (ok) {
        const freshData = await this.fetchFromCloud(dataType);
        this.publish(dataType, freshData, 'update');
        return freshData;
      } else {
        throw new Error((result && result.result && result.result.error) || '更新数据失败');
      }
      
    } catch (error) {
      console.error(`[数据同步] 更新 ${dataType} 失败:`, error);
      throw error;
    }
  }

  /**
   * 监听云数据库变更（实时同步）
   */
  startRealtimeSync(dataTypes = ['orders', 'production_orders']) {
    dataTypes.forEach(dataType => {
      // 启动WebSocket监听或定时轮询
      this.startDatabaseWatch(dataType);
    });
    
    console.log(`[数据同步] 启动实时同步: ${dataTypes.join(', ')}`);
  }

  /**
   * 启动数据库监听
   */
  startDatabaseWatch(dataType) {
    // 这里可以集成云数据库的实时监听功能
    // 目前使用定时轮询作为替代方案

    if (this.watchTimers.has(dataType)) {
      return;
    }

    const scheduleNext = () => {
      const timerId = setTimeout(async () => {
        try {
          await this.checkForUpdates(dataType);
        } catch (error) {
          console.error(`[数据同步] 检查 ${dataType} 更新失败:`, error);
        } finally {
          if (this.watchTimers.has(dataType)) {
            scheduleNext();
          }
        }
      }, 30000);
      this.watchTimers.set(dataType, timerId);
    };

    scheduleNext();
  }

  stopDatabaseWatch(dataType) {
    const timerId = this.watchTimers.get(dataType);
    if (timerId) {
      clearTimeout(timerId);
    }
    this.watchTimers.delete(dataType);
  }

  stopRealtimeSync(dataTypes = ['orders', 'production_orders']) {
    dataTypes.forEach((dataType) => this.stopDatabaseWatch(dataType));
  }

  /**
   * 检查数据更新
   */
  async checkForUpdates(dataType) {
    const lastUpdateTime = this.lastSyncTime[dataType] || 0;
    
    try {
      const result = await wx.cloud.callFunction({
        name: 'erp-api',
        data: {
          action: 'getOrders',
          params: { 
            page: 1, 
            limit: 10,
            dateRange: {
              start: lastUpdateTime,
              end: Date.now()
            }
          }
        }
      });

      if (result.result.success && result.result.data && result.result.data.length > 0) {
        console.log(`[数据同步] 检测到 ${dataType} 有 ${result.result.data.length} 条更新`);
        
        // 有更新，重新获取数据
        await this.fetchFromCloud(dataType);
      }
      
    } catch (error) {
      console.error(`[数据同步] 检查 ${dataType} 更新失败:`, error);
    }
  }

  /**
   * 获取数据一致性状态
   */
  async getConsistencyStatus() {
    try {
      // 暂时返回基本状态，后续可以集成到云函数
      return {
        success: true,
        status: 'healthy',
        lastCheck: new Date().toISOString(),
        dataTypes: ['orders']
      };

      return result.result;
    } catch (error) {
      console.error(`[数据同步] 获取一致性状态失败:`, error);
      return { success: false, error: error.message };
    }
  }

  /**
   * 强制同步所有数据
   */
  async forceSyncAll() {
    console.log(`[数据同步] 强制同步所有数据`);
    
    const dataTypes = ['orders', 'production_orders', 'customers', 'products'];
    
    for (const dataType of dataTypes) {
      try {
        await this.fetchFromCloud(dataType);
      } catch (error) {
        console.error(`[数据同步] 强制同步 ${dataType} 失败:`, error);
      }
    }
    
    console.log(`[数据同步] 强制同步完成`);
  }
}

// 创建全局数据同步管理器实例
const dataSyncManager = new DataSyncManager();

// 导出工具函数
module.exports = {
  DataSyncManager,
  dataSyncManager,
  
  // 快捷方法
  subscribe: (dataType, callback, context) => 
    dataSyncManager.subscribe(dataType, callback, context),
  
  getData: (dataType, forceRefresh) => 
    dataSyncManager.getData(dataType, forceRefresh),
  
  updateData: (dataType, updates) => 
    dataSyncManager.updateData(dataType, updates),
  
  startRealtimeSync: (dataTypes) => 
    dataSyncManager.startRealtimeSync(dataTypes),

  stopRealtimeSync: (dataTypes) =>
    dataSyncManager.stopRealtimeSync(dataTypes),
  
  getConsistencyStatus: () => 
    dataSyncManager.getConsistencyStatus(),
  
  forceSyncAll: () => 
    dataSyncManager.forceSyncAll()
};
