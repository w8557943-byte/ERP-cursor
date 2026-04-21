// API请求封装模块 - 强制使用远程服务器 (更新版)
// 荣禾ERP - 增强API模块
// 支持云开发和传统HTTP API的智能切换

// 导入云API适配器和实时同步
const { cloudAPI, isUsingCloudDevelopment } = require('./cloud-api-adapter.js');
const { realtimeSync } = require('./realtime-sync.js');

// 传统API配置（备用方案）
const API_BASE_URL = 'http://rongjiahe.tech:3001';
const STORAGE_KEY_API_BASE = 'API_BASE_URL_OVERRIDE';

function getDefaultApiBase() {
  return API_BASE_URL;
}

function resolveApiBase() {
  return API_BASE_URL;
}

function setApiBaseUrlOverride(url) {
  console.log('API地址覆盖:', url);
  wx.setStorageSync(STORAGE_KEY_API_BASE, url);
  try {
    wx.showToast({ title: 'API地址已更新', icon: 'success', duration: 1500 });
  } catch (e) {
    console.error('显示提示失败:', e);
  }
}

function clearApiBaseUrlOverride() {
  wx.removeStorageSync(STORAGE_KEY_API_BASE);
  try {
    wx.showToast({ title: 'API地址已重置', icon: 'success', duration: 1500 });
  } catch (e) {
    console.error('显示提示失败:', e);
  }
}

// 检测运行环境
function isCloudEnvironment() {
  return isUsingCloudDevelopment();
}

// 获取当前使用的API类型
function getCurrentAPIMode() {
  return isCloudEnvironment() ? 'cloud' : 'http';
}

const DEFAULT_TIMEOUT = 15000; // 增加超时时间到15秒

// 请求头配置
const DEFAULT_HEADERS = {
  'Content-Type': 'application/json',
  'x-client-platform': 'wechat'
};

// 获取用户token
function getToken() {
  try {
    // 优先使用userToken，如果没有则尝试使用token（向后兼容）
    let token = wx.getStorageSync('userToken') || '';
    if (!token) {
      token = wx.getStorageSync('token') || '';
      if (token) {
        console.log('检测到旧版token，迁移到userToken');
        wx.setStorageSync('userToken', token);
        wx.removeStorageSync('token');
      }
    }
    return token;
  } catch (e) {
    console.error('获取token失败:', e);
    return '';
  }
}

// 更新请求头
function updateHeaders(customHeaders = {}) {
  const token = getToken();
  return {
    ...DEFAULT_HEADERS,
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...customHeaders
  };
}

// 统一的请求方法
function request(options) {
  const { url, method = 'GET', data = {}, headers = {}, loadingText = '加载中...', timeout = DEFAULT_TIMEOUT } = options;

  // 显示加载提示
  if (loadingText) {
    wx.showLoading({
      title: loadingText,
      mask: true
    });
  }

  // 完整URL - 强制使用远程服务器
  const base = resolveApiBase();
  const fullUrl = url.startsWith('http') ? url : `${base}${url}`;

  // 调试信息
  console.log('API请求信息:');
  console.log('完整URL:', fullUrl);
  console.log('请求方法:', method);
  console.log('请求数据:', data);

  return new Promise((resolve, reject) => {
    wx.request({
      url: fullUrl,
      method,
      data,
      header: {
        ...updateHeaders(),
        ...headers
      },
      timeout,
      success: (res) => {
        wx.hideLoading();

        console.log('API响应:', res);

        // 处理响应
        if (res.statusCode >= 200 && res.statusCode < 300) {
          // 成功响应
          if (res.data && res.data.success === false) {
            // 业务逻辑错误
            console.error('业务错误:', res.data.message || '未知错误');
            wx.showToast({
              title: res.data.message || '操作失败',
              icon: 'none',
              duration: 2000
            });
            reject(new Error(res.data.message || '操作失败'));
          } else {
            // 成功
            resolve(res.data);
          }
        } else {
          console.error('HTTP错误:', res.statusCode, res.data);
          let errorMsg = '网络请求失败';
          if (res.statusCode === 401) {
            errorMsg = '未授权，请重新登录';
            wx.removeStorageSync('userToken');
            wx.reLaunch({ url: '/pages/login/login' });
          } else if (res.statusCode === 403) {
            errorMsg = '权限不足';
          } else if (res.statusCode === 404) {
            errorMsg = '接口不存在';
          } else if (res.statusCode === 500) {
            errorMsg = '服务器内部错误';
          } else if (res.statusCode === 503) {
            errorMsg = '服务不可用';
          }
          wx.showToast({ title: errorMsg, icon: 'none', duration: 2000 });
          reject(new Error(errorMsg));
        }
      },
      fail: (err) => {
        wx.hideLoading();

        console.error('请求失败:', err);

        let errorMsg = '网络请求失败';
        if (err.errMsg.includes('timeout')) {
          errorMsg = '请求超时，请检查网络';
        } else if (err.errMsg.includes('fail')) {
          errorMsg = '网络连接失败，请检查网络设置';
        }

        wx.showToast({
          title: errorMsg,
          icon: 'none',
          duration: 2000
        });

        reject(new Error(errorMsg));
      }
    });
  });
}

// 演示数据功能已移除

// 简化的请求方法
const get = (url, data, headers, loadingText) => request({ url, method: 'GET', data, headers, loadingText });
const post = (url, data, headers, loadingText) => request({ url, method: 'POST', data, headers, loadingText });
const put = (url, data, headers, loadingText) => request({ url, method: 'PUT', data, headers, loadingText });
const del = (url, data, headers, loadingText) => request({ url, method: 'DELETE', data, headers, loadingText });

// API接口定义 - 智能切换云开发与传统API
const API = {
  // 认证相关
  auth: {
    login: async (data) => {
      try {
        if (isCloudEnvironment()) {
          console.log('使用云开发登录API');
          return await cloudAPI.authLogin(data);
        } else {
          console.log('使用传统HTTP登录API');
          return await post('/api/miniprogram/login', data, {}, '登录中...');
        }
      } catch (error) {
        console.error('登录失败:', error);
        throw error;
      }
    },

    getUser: async () => {
      try {
        if (isCloudEnvironment()) {
          console.log('使用云开发获取用户信息');
          return await cloudAPI.getUserInfo();
        } else {
          console.log('使用传统HTTP获取用户信息');
          return await new Promise((resolve, reject) => {
            get('/api/miniprogram/userinfo', {}, {}, '获取用户信息...')
              .then(resolve)
              .catch(() => {
                get('/api/miniprogram/user', {}, {}, '获取用户信息...')
                  .then(resolve)
                  .catch(reject);
              });
          });
        }
      } catch (error) {
        console.error('获取用户信息失败:', error);
        throw error;
      }
    }
  },

  // 订单相关
  orders: {
    getList: async (params) => {
      try {
        if (isCloudEnvironment()) {
          console.log('使用云开发获取订单列表');
          return await cloudAPI.getOrders(params);
        } else {
          console.log('使用传统HTTP获取订单列表');
          return await get('/api/miniprogram/orders', params, {}, '获取订单列表...');
        }
      } catch (error) {
        console.error('获取订单列表失败:', error);
        throw error;
      }
    },

    getDetail: async (id) => {
      try {
        if (isCloudEnvironment()) {
          console.log('使用云开发获取订单详情');
          return await cloudAPI.getOrderDetail(id);
        } else {
          console.log('使用传统HTTP获取订单详情');
          return await get(`/api/miniprogram/orders/${id}`, {}, {}, '获取订单详情...');
        }
      } catch (error) {
        console.error('获取订单详情失败:', error);
        throw error;
      }
    }
  },

  // 生产工单相关
  workOrders: {
    getList: async (params) => {
      try {
        if (isCloudEnvironment()) {
          console.log('使用云开发获取工单列表');
          return await cloudAPI.getWorkOrders(params);
        } else {
          console.log('使用传统HTTP获取工单列表');
          return await get('/api/miniprogram/work-orders', params, {}, '获取工单列表...');
        }
      } catch (error) {
        console.error('获取工单列表失败:', error);
        throw error;
      }
    },

    getDetail: async (id) => {
      try {
        if (isCloudEnvironment()) {
          console.log('使用云开发获取工单详情');
          return await cloudAPI.getWorkOrderDetail(id);
        } else {
          console.log('使用传统HTTP获取工单详情');
          return await get(`/api/miniprogram/work-orders/${id}`, {}, {}, '获取工单详情...');
        }
      } catch (error) {
        console.error('获取工单详情失败:', error);
        throw error;
      }
    }
  },

  // 仪表板相关
  dashboard: {
    getStats: async () => {
      try {
        if (isCloudEnvironment()) {
          console.log('使用云开发获取仪表板统计');
          return await cloudAPI.getDashboardStats();
        } else {
          console.log('使用传统HTTP获取仪表板统计');
          return await get('/api/v1/dashboard/stats', {}, {}, '获取仪表板统计...');
        }
      } catch (error) {
        console.error('获取仪表板统计失败:', error);
        throw error;
      }
    },

    getRecent: async () => {
      try {
        if (isCloudEnvironment()) {
          console.log('使用云开发获取最近活动');
          return await cloudAPI.getDashboardRecent();
        } else {
          console.log('使用传统HTTP获取最近活动');
          return await get('/api/v1/dashboard/recent', {}, {}, '获取最近活动...');
        }
      } catch (error) {
        console.error('获取最近活动失败:', error);
        throw error;
      }
    }
  },

  shipping: {
    createFromOrder: async (payload) => {
      try {
        const orderId = payload.orderId || payload.id || payload._id;
        const orderNo = payload.orderNo || payload.orderNumber;

        if (!orderId && !orderNo) throw new Error('缺少订单ID或单号');

        if (isCloudEnvironment()) {
          const res = await wx.cloud.callFunction({
            name: 'erp-api',
            data: {
              action: 'createShippingOrder',
              data: { orderId, orderNo }
            }
          });
          if (res.result && res.result.success) {
            return res.result;
          }
          throw new Error(res.result?.message || '生成发货单失败');
        } else {
          throw new Error('当前环境不支持发货操作，请在云环境使用');
        }
      } catch (error) {
        console.error('创建待发货失败:', error);
        throw error;
      }
    },

    getPending: async () => {
      try {
        if (!isCloudEnvironment()) {
          throw new Error('当前环境不支持发货查询');
        }
        const r = await cloudAPI.database.query('orders', { conditions: { shippingStatus: 'pending' } }, { limit: 100, orderBy: 'updatedAt_desc' });
        const list = Array.isArray(r && r.data) ? r.data : [];
        return {
          success: true,
          data: list.map(o => ({
            id: o._id || o.id,
            status: o.shippingStatus || 'pending',
            orderNo: o.orderNo || o.orderNumber || o.shippingOrderNo || '',
            customer: o.customer || o.customerName || ''
          }))
        };
      } catch (error) {
        console.error('获取待发货列表失败:', error);
        throw error;
      }
    },

    getDetail: async (id) => {
      try {
        if (!isCloudEnvironment()) {
          throw new Error('当前环境不支持发货详情');
        }
        const r = await cloudAPI.database.getById('orders', id);
        return { success: true, data: r && r.data ? r.data : {} };
      } catch (error) {
        console.error('获取发货详情失败:', error);
        throw error;
      }
    },

    batchUpdateStatus: async (payload) => {
      try {
        const ids = payload && Array.isArray(payload.ids) ? payload.ids : [];
        const status = payload && payload.status ? String(payload.status) : '';
        if (!ids.length) throw new Error('缺少编号');
        if (!status) throw new Error('缺少状态');
        if (!isCloudEnvironment()) {
          throw new Error('当前环境不支持发货更新');
        }
        const now = new Date();
        await Promise.all(ids.map(async (id) => {
          const next = { shippingStatus: status, updatedAt: now };
          if (status === 'shipped') {
            next.status = 'shipped';
            next.shippedAt = now;
          }
          if (status === 'delivered') {
            next.status = 'delivered';
            next.deliveredAt = now;
          }
          await cloudAPI.database.update('orders', id, next);
        }));
        return { success: true, data: { ids, status } };
      } catch (error) {
        console.error('批量更新发货状态失败:', error);
        throw error;
      }
    },

    confirmDelivery: async (id) => {
      try {
        if (!isCloudEnvironment()) {
          throw new Error('当前环境不支持确认送达');
        }
        const now = new Date();
        await cloudAPI.database.update('orders', id, { shippingStatus: 'delivered', status: 'delivered', deliveredAt: now, updatedAt: now });
        return { success: true, data: { id } };
      } catch (error) {
        console.error('确认送达失败:', error);
        throw error;
      }
    },

    addTracking: async (id, payload) => {
      try {
        if (!isCloudEnvironment()) {
          throw new Error('当前环境不支持物流录入');
        }
        const r = await cloudAPI.database.getById('orders', id);
        const origin = r && r.data ? r.data : {};
        const list = Array.isArray(origin.shippingTrackings) ? origin.shippingTrackings : [];
        const now = new Date();
        const item = {
          trackingNo: payload && payload.trackingNo ? String(payload.trackingNo) : '',
          carrier: payload && payload.carrier ? String(payload.carrier) : '',
          note: payload && payload.note ? String(payload.note) : '',
          createdAt: now
        };
        await cloudAPI.database.update('orders', id, { shippingTrackings: list.concat([item]), updatedAt: now });
        return { success: true, data: { id } };
      } catch (error) {
        console.error('录入物流失败:', error);
        throw error;
      }
    }
  },

  // 系统健康检查
  health: {
    check: async () => {
      try {
        if (isCloudEnvironment()) {
          console.log('云开发环境健康检查');
          // 云开发环境直接返回成功
          return { success: true, message: '云开发环境正常' };
        } else {
          console.log('传统HTTP环境健康检查');
          return await get('/api/miniprogram/health', {}, {}, null);
        }
      } catch (error) {
        console.error('健康检查失败:', error);
        throw error;
      }
    }
  },

  // 兼容性函数 - 为了兼容旧的调用方式
  getWorkOrderList: (params) => API.workOrders.getList(params),
  getOrderList: (params) => API.orders.getList(params),
  getDashboardStats: () => API.dashboard.getStats(),
  getDashboardRecent: () => API.dashboard.getRecent(),
  createShippingFromOrder: (payload) => API.shipping.createFromOrder(payload),
  getShippingPending: () => API.shipping.getPending(),
  getShippingDetail: (id) => API.shipping.getDetail(id),
  batchUpdateShippingStatus: (payload) => API.shipping.batchUpdateStatus(payload),
  confirmDelivery: (id) => API.shipping.confirmDelivery(id),
  addShippingTracking: (id, payload) => API.shipping.addTracking(id, payload)
};

// 工具函数
const utils = {
  // 设置token
  setToken: (token) => {
    wx.setStorageSync('userToken', token);
  },

  // 清除token
  clearToken: () => {
    wx.removeStorageSync('userToken');
  },

  // 获取token
  getToken: getToken,

  // 检查是否已登录
  isLoggedIn: () => {
    return !!getToken();
  }
};

// 导出
module.exports = {
  API,
  createShippingFromOrder: (payload) => API.createShippingFromOrder(payload),
  getShippingPending: () => API.getShippingPending(),
  getShippingDetail: (id) => API.getShippingDetail(id),
  batchUpdateShippingStatus: (payload) => API.batchUpdateShippingStatus(payload),
  confirmDelivery: (id) => API.confirmDelivery(id),
  addShippingTracking: (id, payload) => API.addShippingTracking(id, payload),
  utils: {
    ...utils,
    // 添加云开发相关工具函数
    isCloudEnvironment,
    getCurrentAPIMode,
    cloudAPI,
    // 添加实时同步工具函数
    realtimeSync,

    // 便捷的实时监听方法
    watchOrders: (options, callback) => {
      if (isCloudEnvironment()) {
        return realtimeSync.watchOrders(options, callback);
      } else {
        console.warn('实时监听仅在云开发环境可用');
        return null;
      }
    },

    watchWorkOrders: (options, callback) => {
      if (isCloudEnvironment()) {
        return realtimeSync.watchWorkOrders(options, callback);
      } else {
        console.warn('实时监听仅在云开发环境可用');
        return null;
      }
    },

    watchInventory: (callback) => {
      if (isCloudEnvironment()) {
        return realtimeSync.watchInventory(callback);
      } else {
        console.warn('实时监听仅在云开发环境可用');
        return null;
      }
    },

    getRealtimeStatus: () => {
      return realtimeSync.getWatchStatus();
    },

    stopRealtimeWatch: (watchKey) => {
      if (isCloudEnvironment()) {
        realtimeSync.stopWatching(watchKey);
      }
    },

    stopAllRealtimeWatches: () => {
      if (isCloudEnvironment()) {
        realtimeSync.stopAllWatching();
      }
    }
  },
  setApiBaseUrlOverride,
  clearApiBaseUrlOverride,
  request,
  get,
  post,
  put,
  del
};
