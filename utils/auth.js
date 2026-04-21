/**
 * 认证工具模块
 * 处理用户登录、token管理、权限验证等功能
 */

const app = getApp();

// 认证配置
const AUTH_CONFIG = {
  TOKEN_KEY: 'user_token',
  USER_INFO_KEY: 'user_info',
  TOKEN_EXPIRE_TIME: 7 * 24 * 60 * 60 * 1000, // 7天
  CLOUD_FUNCTION: 'erp-api'
};

/**
 * 调用云函数进行用户登录
 * @param {string} username - 用户名
 * @param {string} password - 密码
 * @returns {Promise} - 登录结果
 */
function loginWithCloud(username, password) {
  console.log('[认证工具] 开始云函数登录');
  console.log('[认证工具] 用户名:', username);
  
  return new Promise((resolve, reject) => {
    // 直接调用云函数 - 修复参数格式
    wx.cloud.callFunction({
      name: AUTH_CONFIG.CLOUD_FUNCTION,
      data: {
        action: 'login',
        data: {
          data: {
            username: username,
            password: password
          }
        }
      }
    }).then(res => {
      console.log('[认证工具] 云函数登录响应:', res);
      
      if (!res.result) {
        console.error('[认证工具] 没有返回result字段');
        reject(new Error('登录接口返回数据格式错误'));
        return;
      }
      
      if (res.result && res.result.success) {
        // 保存登录信息
        saveAuthData(res.result.data.token, res.result.data.user);
        resolve(res.result.data);
      } else {
        console.error('[认证工具] 登录业务逻辑失败:', res.result.message);
        reject(new Error(res.result.message || '登录失败'));
      }
    }).catch(err => {
      console.error('[认证工具] 云函数调用失败:', err);
      
      // 检查是否是数据库集合不存在的错误
      if (err.errMsg && err.errMsg.includes('collection not exists')) {
        console.log('[认证工具] 检测到数据库集合不存在，建议初始化数据库');
        reject(new Error('数据库未初始化，请先初始化数据库'));
        return;
      }
      
      // 根据错误类型提供更友好的错误信息
      let errorMessage = '网络错误，请稍后重试';
      
      if (err.errCode === -1) {
        errorMessage = '网络连接异常，请检查网络后重试';
      } else if (err.errCode === 60004) {
        errorMessage = '登录服务不可用，请稍后重试';
      } else if (err.errCode === 60008) {
        errorMessage = '登录请求超时，请稍后重试';
      } else if (err.errMsg) {
        errorMessage = err.errMsg;
      }
      
      reject(new Error(errorMessage));
    });
  });
}

/**
 * 保存用户认证信息到本地
 * @param {string} token - 用户token
 * @param {object} userInfo - 用户信息
 */
function saveAuthData(token, userInfo) {
  const loginTime = Date.now();
  const expireTime = loginTime + AUTH_CONFIG.TOKEN_EXPIRE_TIME;
  
  console.log('[认证工具] 保存登录信息');
  
  wx.setStorageSync(AUTH_CONFIG.TOKEN_KEY, {
    token: token,
    loginTime: loginTime,
    expireTime: expireTime
  });
  
  wx.setStorageSync(AUTH_CONFIG.USER_INFO_KEY, userInfo);
  wx.setStorageSync('isLoggedIn', true);
  
  console.log('[认证工具] 登录信息保存成功');
}

/**
 * 检查用户是否已登录
 * @returns {boolean} - 是否已登录
 */
function isLoggedIn() {
  try {
    const tokenData = getTokenData();
    if (!tokenData) return false;
    
    // 检查token是否过期
    if (Date.now() > tokenData.expireTime) {
      console.log('[认证工具] Token已过期');
      clearAuthData();
      return false;
    }
    
    return true;
  } catch (e) {
    console.error('[认证工具] 检查登录状态出错:', e);
    return false;
  }
}

/**
 * 获取当前用户token
 * @returns {string|null} - 用户token
 */
function getToken() {
  const tokenData = getTokenData();
  return tokenData ? tokenData.token : null;
}

/**
 * 获取token数据
 * @returns {object|null} - token数据
 */
function getTokenData() {
  try {
    return wx.getStorageSync(AUTH_CONFIG.TOKEN_KEY) || null;
  } catch (e) {
    console.error('[认证工具] 获取token数据出错:', e);
    return null;
  }
}

/**
 * 获取当前用户信息
 * @returns {object|null} - 用户信息
 */
function getUserInfo() {
  try {
    return wx.getStorageSync(AUTH_CONFIG.USER_INFO_KEY) || null;
  } catch (e) {
    console.error('[认证工具] 获取用户信息出错:', e);
    return null;
  }
}

/**
 * 清除本地认证信息
 */
function clearAuthData() {
  wx.removeStorageSync(AUTH_CONFIG.TOKEN_KEY);
  wx.removeStorageSync(AUTH_CONFIG.USER_INFO_KEY);
  wx.removeStorageSync('isLoggedIn');
  
  console.log('[认证工具] 清除登录信息');
}

/**
 * 退出登录
 * @returns {Promise} - 退出结果
 */
function logout() {
  return new Promise((resolve, reject) => {
    try {
      // 调用云函数注销（可选）
      const token = getToken();
      if (token) {
        wx.cloud.callFunction({
          name: AUTH_CONFIG.CLOUD_FUNCTION,
          data: {
            action: 'logout',
            token: token
          }
        }).catch(err => {
          console.error('[认证工具] 云函数注销失败:', err);
          // 即使云函数调用失败，也继续本地清除
        });
      }
      
      // 清除本地认证数据
      clearAuthData();
      
      wx.showToast({
        title: '已退出登录',
        icon: 'success'
      });
      
      // 跳转到登录页
      setTimeout(() => {
        wx.reLaunch({
          url: '/pages/login/login'
        });
        resolve();
      }, 1500);
    } catch (e) {
      console.error('[认证工具] 退出登录出错:', e);
      reject(e);
    }
  });
}

/**
 * 检查用户权限
 * @param {string} role - 需要的角色
 * @returns {boolean} - 是否有权限
 */
function hasPermission(role) {
  const userInfo = getUserInfo();
  if (!userInfo) return false;
  
  // 管理员拥有所有权限
  if (userInfo.role === 'administrator' || userInfo.role === 'admin') return true;
  
  // 检查具体角色权限
  return userInfo.role === role;
}

/**
 * 获取登录时间
 * @returns {number} - 登录时间戳
 */
function getLoginTime() {
  const tokenData = getTokenData();
  return tokenData ? tokenData.loginTime : 0;
}

module.exports = {
  loginWithCloud,
  isLoggedIn,
  getToken,
  getUserInfo,
  clearAuthData,
  logout,
  hasPermission,
  getLoginTime,
  AUTH_CONFIG
};