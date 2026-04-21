/**
 * 云函数调试工具
 * 用于调试云函数调用问题
 */

/**
 * 带详细日志的云函数调用
 * @param {string} name - 云函数名称
 * @param {object} data - 传递给云函数的数据
 * @param {boolean} showLoading - 是否显示加载提示
 * @returns {Promise} - 云函数调用结果
 */
function callFunctionWithDebug(name, data, showLoading = true) {
  console.log(`[云函数调试] 准备调用云函数: ${name}`);
  console.log('[云函数调试] 传递的数据:', JSON.stringify(data, null, 2));
  
  return new Promise((resolve, reject) => {
    if (showLoading) {
      wx.showLoading({
        title: '请求中...',
        mask: true
      });
    }

    wx.cloud.callFunction({
      name,
      data
    }).then(res => {
      console.log(`[云函数调试] 云函数${name}调用成功`);
      console.log('[云函数调试] 完整响应:', JSON.stringify(res, null, 2));
      
      if (!res.result) {
        console.error('[云函数调试] 没有返回result字段');
        reject(new Error('云函数返回数据格式错误'));
        return;
      }
      
      // 检查业务逻辑返回
      if (res.result.success === false) {
        console.error('[云函数调试] 业务逻辑错误:', res.result.message);
        reject(new Error(res.result.message || '操作失败'));
        return;
      }
      
      resolve(res.result);
    }).catch(err => {
      console.error(`[云函数调试] 云函数${name}调用失败`);
      console.error('[云函数调试] 错误详情:', err);
      
      // 根据错误类型提供更友好的错误信息
      let errorMessage = '请求失败';
      
      if (err.errCode === -1) {
        errorMessage = '网络连接异常，请检查网络后重试';
      } else if (err.errCode === 60004) {
        errorMessage = '云函数不存在，请确保已正确部署';
      } else if (err.errCode === 60008) {
        errorMessage = '云函数调用超时，请稍后重试';
      } else if (err.errCode === 50001) {
        errorMessage = '云函数执行错误';
      } else if (err.errMsg) {
        errorMessage = err.errMsg;
      }
      
      reject(new Error(errorMessage));
    }).finally(() => {
      if (showLoading) {
        wx.hideLoading();
      }
    });
  });
}

/**
 * 调试登录功能
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @returns {Promise} - 登录结果
 */
function debugLogin(username, password) {
  console.log('[登录调试] 开始登录调试');
  console.log('[登录调试] 用户名:', username);
  console.log('[登录调试] 密码:', password.replace(/./g, '*'));
  
  return callFunctionWithDebug('erp-api', {
    action: 'login',
    username: username,
    password: password
  });
}

/**
 * 检查云函数部署状态
 * @param {string} name - 云函数名称
 * @returns {Promise} - 检查结果
 */
function checkCloudFunction(name) {
  console.log('[云函数调试] 检查云函数部署状态:', name);
  
  return callFunctionWithDebug(name, {
    action: 'health_check'
  }).then(result => {
    console.log(`[云函数调试] 云函数${name}运行正常`);
    return result;
  }).catch(err => {
    console.error(`[云函数调试] 云函数${name}可能未正确部署或运行异常`);
    throw err;
  });
}

/**
 * 显示调试信息弹窗
 * @param {string} title - 标题
 * @param {object} data - 调试数据
 */
function showDebugInfo(title, data) {
  const dataStr = JSON.stringify(data, null, 2);
  console.log(`[调试信息] ${title}:`, dataStr);
  
  wx.showModal({
    title: `调试信息: ${title}`,
    content: dataStr.length > 500 ? dataStr.substring(0, 500) + '...' : dataStr,
    showCancel: false,
    confirmText: '确定'
  });
}

module.exports = {
  callFunctionWithDebug,
  debugLogin,
  checkCloudFunction,
  showDebugInfo
};