/**
 * 云函数调用工具模块
 * 封装常用的云函数调用方法
 */

/**
 * 通用云函数调用方法
 * @param {string} name - 云函数名称
 * @param {object} data - 传递给云函数的数据
 * @param {boolean} showLoading - 是否显示加载提示，默认true
 * @returns {Promise} - 云函数调用结果
 */
const { ensureCloudInit } = require('./cloud-api-adapter.js');

function callFunction(name, data, showLoading = true) {
  return new Promise((resolve, reject) => {
    if (showLoading) {
      wx.showLoading({ title: '请求中...', mask: true });
    }

    if (!ensureCloudInit()) {
      if (showLoading) wx.hideLoading();
      reject(new Error('云开发环境未初始化'));
      return;
    }

    const exec = () => wx.cloud.callFunction({ name, data });
    exec()
      .then((res) => {
        console.log(`云函数${name}调用成功:`, res);
        if (res && res.result && res.result.success === false) {
          const msg = res.result.message || res.result.error || '操作失败';
          reject(new Error(msg));
          return;
        }
        resolve(res && res.result ? res.result : res);
      })
      .catch((err) => {
        const msg = (err && (err.message || err.errMsg || '')) || '';
        const shouldRetry = /41001|ITicketService|formatTicketRequestQuery|清除登录状态失败/.test(msg);
        if (shouldRetry) {
          try { ensureCloudInit(); } catch (_) {}
          exec()
            .then((res2) => {
              resolve(res2 && res2.result ? res2.result : res2);
            })
            .catch((err2) => {
              console.error(`云函数${name}调用失败:`, err2);
              reject(err2);
            })
            .finally(() => {
              if (showLoading) wx.hideLoading();
            });
          return;
        }
        console.error(`云函数${name}调用失败:`, err);
        reject(err);
      })
      .finally(() => {
        if (showLoading) wx.hideLoading();
      });
  });
}

/**
 * ERP系统API调用
 * @param {string} action - 操作类型
 * @param {object} data - 传递的数据
 * @param {boolean} showLoading - 是否显示加载提示
 * @returns {Promise} - API调用结果
 */
function callERPAPI(action, data, showLoading = true) {
  return callFunction('erp-api', {
    action,
    ...data
  }, showLoading);
}

/**
 * 数据同步API调用
 * @param {string} action - 操作类型
 * @param {object} data - 传递的数据
 * @param {boolean} showLoading - 是否显示加载提示
 * @returns {Promise} - API调用结果
 */
function callSyncAPI(action, data, showLoading = true) {
  return callFunction('data-sync', {
    action,
    ...data
  }, showLoading);
}

/**
 * 数据库初始化API调用
 * @param {string} action - 操作类型
 * @param {object} data - 传递的数据
 * @param {boolean} showLoading - 是否显示加载提示
 * @returns {Promise} - API调用结果
 */
function callDatabaseAPI(action, data, showLoading = true) {
  return callFunction('database-init', {
    action,
    ...data
  }, showLoading);
}

/**
 * WebSocket管理API调用
 * @param {string} action - 操作类型
 * @param {object} data - 传递的数据
 * @param {boolean} showLoading - 是否显示加载提示
 * @returns {Promise} - API调用结果
 */
function callWebSocketAPI(action, data, showLoading = true) {
  return callFunction('websocket-manager', {
    action,
    ...data
  }, showLoading);
}

/**
 * 文件上传API调用
 * @param {string} action - 操作类型
 * @param {object} data - 传递的数据
 * @param {boolean} showLoading - 是否显示加载提示
 * @returns {Promise} - API调用结果
 */
function callFileAPI(action, data, showLoading = true) {
  return callFunction('file-manager', {
    action,
    ...data
  }, showLoading);
}

/**
 * 通知API调用
 * @param {string} action - 操作类型
 * @param {object} data - 传递的数据
 * @param {boolean} showLoading - 是否显示加载提示
 * @returns {Promise} - API调用结果
 */
function callNotificationAPI(action, data, showLoading = true) {
  return callFunction('notification-service', {
    action,
    ...data
  }, showLoading);
}

/**
 * 处理云函数调用错误
 * @param {Error} error - 错误对象
 * @param {string} defaultMessage - 默认错误消息
 * @returns {string} - 用户友好的错误消息
 */
function handleCloudError(error, defaultMessage = '操作失败') {
  console.error('云函数调用错误:', error);
  
  const rawMsg = (error && (error.message || error.errMsg || '')) || '';
  if (/41001|ITicketService|formatTicketRequestQuery|清除登录状态失败/.test(rawMsg)) {
    return '开发者工具登录状态已失效，请在工具内重新登录后重试';
  }
  if (error.message) return error.message;
  
  if (typeof error === 'string') {
    return error;
  }
  
  // 根据错误类型返回不同的用户友好消息
  if (error.errCode) {
    switch (error.errCode) {
      case -1:
        return '网络连接异常，请检查网络后重试';
      case -2:
        return '请求超时，请稍后重试';
      case 60004:
        return '云函数不存在，请联系管理员';
      case 60008:
        return '云函数调用超时，请稍后重试';
      case 90002:
        return '请求参数错误';
      default:
        return `请求失败(${error.errCode})`;
    }
  }
  
  return defaultMessage;
}

/**
 * 显示云函数调用错误
 * @param {Error} error - 错误对象
 * @param {string} defaultMessage - 默认错误消息
 */
function showCloudError(error, defaultMessage = '操作失败') {
  const message = handleCloudError(error, defaultMessage);
  if (/开发者工具登录状态已失效/.test(message)) {
    wx.showModal({
      title: '登录状态失效',
      content: '请在微信开发者工具内重新登录后重试',
      showCancel: false
    });
    return;
  }
  wx.showToast({ title: message, icon: 'none', duration: 2000 });
}

module.exports = {
  callFunction,
  callERPAPI,
  callSyncAPI,
  callDatabaseAPI,
  callWebSocketAPI,
  callFileAPI,
  callNotificationAPI,
  handleCloudError,
  showCloudError
};
