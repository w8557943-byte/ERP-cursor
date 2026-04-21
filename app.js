const CLOUD_ENV_ID = 'erp-system-prod-1glmda1zf4f9c7a7';

function ensureCloudInit() {
  try {
    if (!wx.cloud || typeof wx.cloud.init !== 'function') return false;
    if (wx.cloud.__erpInited) return true;
    wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true });
    wx.cloud.__erpInited = true;
    return true;
  } catch (_) {
    return false;
  }
}

ensureCloudInit();

function patchCloudApis() {
  try {
    if (!wx.cloud) return;
    if (wx.cloud.__erpPatched) return;
    const originalCallFunction = typeof wx.cloud.callFunction === 'function' ? wx.cloud.callFunction.bind(wx.cloud) : null;
    if (originalCallFunction) {
      const cache = new Map();
      const maxCacheSize = 200;
      const getTtlMs = (key, fallback) => {
        try {
          const val = wx.getStorageSync(key);
          const n = Number(val);
          if (Number.isFinite(n) && n >= 0) return n;
        } catch (_) { }
        return fallback;
      };
      const ttlByAction = () => ({
        getOrders: getTtlMs('erp_cache_ttl_getOrders', 2000),
        getPurchaseOrders: getTtlMs('erp_cache_ttl_getPurchaseOrders', 2000),
        getCustomers: getTtlMs('erp_cache_ttl_getCustomers', 5000),
        getOrderDetail: getTtlMs('erp_cache_ttl_getOrderDetail', 2000),
        getOrderStats: getTtlMs('erp_cache_ttl_getOrderStats', 5000)
      });
      const normalize = (v) => {
        if (v == null) return v;
        if (Array.isArray(v)) return v.map(normalize);
        if (typeof v === 'object') {
          const out = {};
          Object.keys(v).sort().forEach((k) => { out[k] = normalize(v[k]); });
          return out;
        }
        return v;
      };
      const stableStringify = (v) => {
        try {
          return JSON.stringify(normalize(v));
        } catch (_) {
          return '';
        }
      };
      const wrapWithCallbacks = (promise, options) => {
        const hasCallbacks = options && (typeof options.success === 'function' || typeof options.fail === 'function' || typeof options.complete === 'function');
        if (!hasCallbacks) return promise;
        return promise
          .then((res) => {
            if (typeof options.success === 'function') {
              try { options.success(res); } catch (_) { }
            }
            return res;
          })
          .catch((err) => {
            if (typeof options.fail === 'function') {
              try { options.fail(err); } catch (_) { }
            }
            throw err;
          })
          .finally(() => {
            if (typeof options.complete === 'function') {
              try { options.complete(); } catch (_) { }
            }
          });
      };
      const trimCache = () => {
        while (cache.size > maxCacheSize) {
          const firstKey = cache.keys().next().value;
          if (!firstKey) break;
          cache.delete(firstKey);
        }
      };
      const getReadTtl = (name, data) => {
        if (name !== 'erp-api') return 0;
        const action = data && typeof data === 'object' ? data.action : undefined;
        if (typeof action === 'string' && action.startsWith('get')) {
          const map = ttlByAction();
          if (Object.prototype.hasOwnProperty.call(map, action)) {
            return Math.max(0, Number(map[action] || 0));
          }
          return Math.max(0, Number(getTtlMs('erp_cache_ttl_default_get', 2000)));
        }
        const method = data && typeof data === 'object' ? data.method : undefined;
        if (typeof method === 'string' && method.startsWith('get')) {
          return Math.max(0, Number(getTtlMs('erp_cache_ttl_default_get', 2000)));
        }
        return 0;
      };
      const shouldInvalidate = (name, data) => {
        if (name !== 'erp-api') return false;
        const action = data && typeof data === 'object' ? data.action : undefined;
        if (typeof action === 'string' && action.startsWith('get')) return false;
        const method = data && typeof data === 'object' ? data.method : undefined;
        if (typeof method === 'string' && method.startsWith('get')) return false;
        return true;
      };

      wx.cloud.callFunction = (options) => {
        ensureCloudInit();
        const name = options && typeof options === 'object' ? options.name : '';
        const data = options && typeof options === 'object' ? options.data : undefined;
        const ttlMs = getReadTtl(name, data);
        const now = Date.now();
        const key = `cf:${String(name || '')}:${stableStringify(data)}`;

        if (ttlMs <= 0) {
          return originalCallFunction(options).then((res) => {
            if (shouldInvalidate(name, data)) {
              cache.clear();
            }
            return res;
          });
        }

        const hit = cache.get(key);
        if (hit && hit.expireAt > now) {
          if (hit.value !== undefined) {
            return wrapWithCallbacks(Promise.resolve(hit.value), options);
          }
          if (hit.promise) {
            return wrapWithCallbacks(hit.promise, options);
          }
        }

        if (hit && hit.promise) {
          return wrapWithCallbacks(hit.promise, options);
        }

        const p = originalCallFunction(options).then((res) => {
          cache.set(key, { expireAt: Date.now() + ttlMs, value: res });
          trimCache();
          return res;
        }).catch((err) => {
          cache.delete(key);
          throw err;
        });

        cache.set(key, { expireAt: now + ttlMs, promise: p });
        trimCache();
        return wrapWithCallbacks(p, options);
      };
    }
    const originalDatabase = typeof wx.cloud.database === 'function' ? wx.cloud.database.bind(wx.cloud) : null;
    if (originalDatabase) {
      wx.cloud.database = (options) => {
        ensureCloudInit();
        return originalDatabase(options);
      };
    }
    const originalUploadFile = typeof wx.cloud.uploadFile === 'function' ? wx.cloud.uploadFile.bind(wx.cloud) : null;
    if (originalUploadFile) {
      wx.cloud.uploadFile = (options) => {
        ensureCloudInit();
        return originalUploadFile(options);
      };
    }
    const originalDownloadFile = typeof wx.cloud.downloadFile === 'function' ? wx.cloud.downloadFile.bind(wx.cloud) : null;
    if (originalDownloadFile) {
      wx.cloud.downloadFile = (options) => {
        ensureCloudInit();
        return originalDownloadFile(options);
      };
    }
    wx.cloud.__erpPatched = true;
  } catch (_) { }
}

patchCloudApis();

const simpleLogin = require('./utils/simple-login.js');
const api = require('./utils/api.js');
const appUtils = require('./utils/app.js');
const cloudUtils = require('./utils/cloud.js');

App({
  onLaunch() {
    // 仅在开发环境输出日志
    if (wx.getSystemInfoSync().platform === 'devtools') {
      console.log('小程序启动');
    }

    this.initCloud();

    this.checkLoginStatus();

    this.getSystemInfo();

    this.initPrinterDevice();

    this.initAutoSync();
  },

  onShow() {
    try {
      if (simpleLogin.isLoggedIn()) {
        simpleLogin.startSessionMonitor();
      }
    } catch (_) { }
  },

  onHide() {
    try {
      simpleLogin.autoSyncOnExit({ silent: true });
    } catch (_) { }
  },

  initCloud() {
    if (!wx.cloud) return;
    ensureCloudInit();
  },

  checkLoginStatus() {
    const isLoggedIn = simpleLogin.isLoggedIn();

    // 仅在开发环境输出登录状态
    if (wx.getSystemInfoSync().platform === 'devtools') {
      console.log('用户登录状态:', isLoggedIn);
    }

    const userInfo = simpleLogin.getUserInfo();
    if (userInfo) {
      this.globalData.userInfo = userInfo;
      // 移除敏感信息日志输出
    }

    if (!isLoggedIn) {
      wx.reLaunch({ url: '/pages/login/login' });
      return;
    }

    try {
      const sessionId = wx.getStorageSync('sessionId') || '';
      if (!sessionId) {
        simpleLogin.logout('登录信息需更新，请重新登录');
        return;
      }
      simpleLogin.startSessionMonitor();
    } catch (error) {
      // 记录错误但不输出敏感信息
      if (wx.getSystemInfoSync().platform === 'devtools') {
        console.error('会话检查失败:', error.message);
      }
    }
  },

  getSystemInfo() {
    const systemInfo = wx.getSystemInfoSync();
    this.globalData.systemInfo = systemInfo;

    const totalTopHeight = systemInfo.statusBarHeight + 44;
    this.globalData.navHeight = totalTopHeight;
  },

  initPrinterDevice() {
    try {
      const saved = wx.getStorageSync('printerDevice');
      if (saved && saved.deviceId) {
        this.globalData.printerDevice = saved;
        return;
      }
    } catch (e) { }
    this.globalData.printerDevice = null;
  },

  initAutoSync() {
    if (typeof wx.onNetworkStatusChange !== 'function') return;
    try {
      wx.onNetworkStatusChange((res) => {
        const connected = Boolean(res && res.isConnected);
        if (!connected) return;
        try {
          if (simpleLogin.isLoggedIn()) {
            simpleLogin.autoSyncOnExit({ silent: true });
          }
        } catch (_) { }
      });
    } catch (_) { }
  },

  globalData: {
    userInfo: null,
    systemInfo: null,
    navHeight: 0,
    printerDevice: null,
    api,
    appUtils,
    cloudUtils,
    checkPermission: (requiredRole) => {
      if (!requiredRole) return true;
      const userInfo = simpleLogin.getUserInfo() || {};
      const role = userInfo.role;
      if (requiredRole === 'admin') {
        return role === 'admin' || role === 'administrator';
      }
      return role === requiredRole;
    }
  }
});
