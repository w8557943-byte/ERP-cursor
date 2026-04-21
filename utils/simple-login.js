/**
 * 简化的登录工具
 * 用于调试和测试登录功能
 */

let sessionListener = null;
let sessionPollTimer = null;
let sessionMonitorStarted = false;
let sessionKickedAt = 0;
const SESSION_CHECK_THROTTLE_MS = 5 * 60 * 1000;
const SESSION_FALLBACK_POLL_MS = 30 * 60 * 1000;
const SESSION_CHECK_AT_STORAGE_KEY = '__erp_session_check_at__';

const { cloudAPI } = require('./cloud-api-adapter');
const { logger } = require('./logger');
const cloudSync = require('./cloud-sync')

/**
 * 简化的登录系统
 */
const simpleLogin = {
  /**
   * 登录
   */
  async login(username, password) {
    logger.info('SimpleLogin', '开始登录流程');
    // 不记录用户名，避免敏感信息泄露

    wx.showLoading({
      title: '登录中...',
      mask: true
    });

    try {
      const res = await cloudAPI.authLogin({
        username,
        password
      });

      if (res && res.success && res.data) {
        logger.info('SimpleLogin', '登录成功');
        // 不记录用户数据，避免敏感信息泄露

        // 保存登录信息
        saveLoginInfo(res.data, res.data.token, res.data.sessionId);

        wx.hideLoading();
        return {
          success: true,
          data: res.data
        };
      } else {
        logger.warn('SimpleLogin', '登录失败', { message: res.message });
        wx.hideLoading();
        return {
          success: false,
          message: res.message || '用户名或密码错误'
        };
      }
    } catch (err) {
      logger.error('SimpleLogin', '登录异常', err);
      wx.hideLoading();
      return {
        success: false,
        message: '登录失败：' + (err.message || '网络错误')
      };
    }
  }
};

/**
 * 保存登录信息
 * @param {object} userData - 用户数据
 * @param {string} token - 登录令牌
 * @param {string} sessionId - 会话标识
 */
function saveLoginInfo(userData, token, sessionId) {
  logger.info('SimpleLogin', '保存登录信息');
  try {
    wx.setStorageSync('userInfo', userData);
    wx.setStorageSync('isLoggedIn', true);
    wx.setStorageSync('loginTime', Date.now());
    if (token) {
      wx.setStorageSync('userToken', token);
    }
    if (sessionId) {
      wx.setStorageSync('sessionId', String(sessionId));
    }
  } catch (e) {
    logger.error('SimpleLogin', '保存登录信息失败', e);
  }
  startSessionMonitor();
}

function stopSessionMonitor() {
  sessionMonitorStarted = false;
  if (sessionPollTimer) {
    clearInterval(sessionPollTimer);
    sessionPollTimer = null;
  }
  if (sessionListener) {
    try {
      sessionListener.close();
    } catch (_) { }
    sessionListener = null;
  }
}

function kickout(reason) {
  const now = Date.now();
  if (sessionKickedAt && (now - sessionKickedAt < 3000)) {
    return;
  }
  sessionKickedAt = now;
  stopSessionMonitor();
  try {
    wx.removeStorageSync('userInfo');
    wx.removeStorageSync('isLoggedIn');
    wx.removeStorageSync('loginTime');
    wx.removeStorageSync('userToken');
    wx.removeStorageSync('sessionId');
  } catch (_) { }
  wx.showModal({
    title: '登录失效',
    content: reason || '您的登录已失效，请重新登录',
    showCancel: false,
    success: () => {
      wx.reLaunch({ url: '/pages/login/login' });
    }
  });
}

function ensureFallbackPoll() {
  if (sessionPollTimer) return;
  sessionPollTimer = setInterval(() => {
    safeCheckOnce();
  }, SESSION_FALLBACK_POLL_MS);
}

function safeCheckOnce() {
  try {
    const lastCheckAt = wx.getStorageSync(SESSION_CHECK_AT_STORAGE_KEY) || 0;
    const now = Date.now();
    if (now - lastCheckAt < SESSION_CHECK_THROTTLE_MS) {
      return;
    }
    wx.setStorageSync(SESSION_CHECK_AT_STORAGE_KEY, now);
  } catch (_) {
    return;
  }

  const userInfo = wx.getStorageSync('userInfo');
  if (!userInfo || !userInfo._id) {
    return;
  }

  wx.cloud.database().collection('users').doc(userInfo._id).get().then((res) => {
    const doc = res && res.data ? res.data : null;
    const remoteSessionId = doc && doc.currentSessionId ? String(doc.currentSessionId) : '';
    const status = doc && doc.status ? String(doc.status) : 'active';
    if (status !== 'active') {
      kickout('账号已停用');
      return;
    }
    const currentLocal = wx.getStorageSync('sessionId') || '';
    if (remoteSessionId && currentLocal && remoteSessionId !== currentLocal) {
      kickout('账号已在其他设备登录');
    }
  }).catch(() => { });
}

function startSessionMonitor() {
  if (sessionMonitorStarted) {
    return;
  }
  sessionMonitorStarted = true;

  const userInfo = wx.getStorageSync('userInfo');
  if (!userInfo || !userInfo._id) {
    sessionMonitorStarted = false;
    return;
  }

  if (typeof wx.cloud === 'undefined' || typeof wx.cloud.database !== 'function') {
    sessionMonitorStarted = false;
    return;
  }

  try {
    const db = wx.cloud.database();
    if (typeof db.collection !== 'function') {
      sessionMonitorStarted = false;
      return;
    }

    if (sessionListener) {
      try {
        sessionListener.close();
      } catch (_) { }
      sessionListener = null;
    }

    try {
      sessionListener = db.collection('users').where({ _id: userInfo._id }).watch({
        onChange: (snapshot) => {
          const docs = snapshot && snapshot.docs ? snapshot.docs : [];
          const doc = docs && docs.length ? docs[0] : null;
          const remoteSessionId = doc && doc.currentSessionId ? String(doc.currentSessionId) : '';
          const status = doc && doc.status ? String(doc.status) : 'active';
          if (status !== 'active') {
            kickout('账号已停用');
            return;
          }
          const currentLocal = wx.getStorageSync('sessionId') || '';
          if (remoteSessionId && currentLocal && remoteSessionId !== currentLocal) {
            kickout('账号已在其他设备登录');
          }
        },
        onError: () => {
          try {
            sessionListener && sessionListener.close && sessionListener.close();
          } catch (_) { }
          sessionListener = null;
          sessionMonitorStarted = false;
          setTimeout(() => startSessionMonitor(), 30000);
        }
      });
    } catch (_) {
      sessionListener = null;
      sessionMonitorStarted = false;
    }
  } catch (_) {
    sessionListener = null;
    sessionMonitorStarted = false;
  }

  safeCheckOnce();
  if (!sessionListener) {
    ensureFallbackPoll();
  }
}

/**
 * 检查登录状态
 * @returns {boolean} - 是否已登录
 */
function isLoggedIn() {
  try {
    const isLoggedIn = wx.getStorageSync('isLoggedIn');
    const loginTime = wx.getStorageSync('loginTime');

    if (!isLoggedIn || !loginTime) {
      return false;
    }

    // 检查登录时间是否超过7天
    const now = Date.now();
    const sevenDays = 7 * 24 * 60 * 60 * 1000;

    if (now - loginTime > sevenDays) {
      logout();
      return false;
    }

    return true;
  } catch (error) {
    logger.error('SimpleLogin', '检查登录状态失败', error);
    return false;
  }
}

/**
 * 获取用户信息
 * @returns {object|null} - 用户信息
 */
function getUserInfo() {
  try {
    return wx.getStorageSync('userInfo') || null;
  } catch (e) {
    return null;
  }
}

/**
 * 退出登录
 */
function logout(reason) {
  stopSessionMonitor();
  const doKickout = Boolean(reason)
  ;(async () => {
    try {
      try { wx.showLoading({ title: '正在同步...', mask: true }) } catch (_) { void 0 }
      await autoSyncOnExit({ silent: true })
    } catch (_) { void 0 }
    try { wx.hideLoading() } catch (_) { void 0 }
    try {
      wx.removeStorageSync('userInfo');
      wx.removeStorageSync('isLoggedIn');
      wx.removeStorageSync('loginTime');
      wx.removeStorageSync('userToken');
      wx.removeStorageSync('sessionId');
    } catch (_) { void 0 }

    if (doKickout) {
      kickout(reason);
      return;
    }
    wx.reLaunch({ url: '/pages/login/login' });
  })().catch((e) => {
    logger.error('SimpleLogin', '退出登录失败', e);
    try { wx.reLaunch({ url: '/pages/login/login' }) } catch (_) { void 0 }
  })
}

let exitSyncPromise = null

async function autoSyncOnExit(options = {}) {
  if (!isLoggedIn()) {
    return { success: false, skipped: true, message: '未登录' }
  }
  if (exitSyncPromise) return exitSyncPromise
  const silent = Boolean(options.silent)
  exitSyncPromise = (async () => {
    try {
      const res = await cloudSync.syncNow()
      if (!silent) {
        if (res && res.success) {
          try { wx.showToast({ title: '同步完成', icon: 'success' }) } catch (_) { void 0 }
        } else if (res && res.skipped) {
          try { wx.showToast({ title: '离线，已加入待同步队列', icon: 'none' }) } catch (_) { void 0 }
        } else {
          try { wx.showToast({ title: '同步失败，稍后自动重试', icon: 'none' }) } catch (_) { void 0 }
        }
      }
      return res
    } catch (e) {
      if (!silent) {
        try { wx.showToast({ title: '同步失败，稍后自动重试', icon: 'none' }) } catch (_) { void 0 }
      }
      return { success: false, message: e && e.message ? String(e.message) : '同步失败' }
    } finally {
      exitSyncPromise = null
    }
  })()
  return exitSyncPromise
}

module.exports = {
  simpleLogin: simpleLogin.login.bind(simpleLogin),
  login: simpleLogin.login.bind(simpleLogin),
  saveLoginInfo: saveLoginInfo,
  isLoggedIn: isLoggedIn,
  getUserInfo: getUserInfo,
  logout: logout,
  autoSyncOnExit: autoSyncOnExit,
  startSessionMonitor: startSessionMonitor,
  stopSessionMonitor: stopSessionMonitor
};
