// utils/permission.js

/**
 * 检查用户是否具有指定角色权限
 * @param {string} requiredRole - 所需的最低角色权限
 * @returns {boolean} - 是否具有权限
 */
function checkPermission(requiredRole) {
  const userInfo = wx.getStorageSync('userInfo');
  if (!userInfo) return false;
  
  // 角色权限等级定义
  const roleLevel = {
    'user': 1,
    'worker': 2,
    'admin': 3
  };
  
  // 检查用户角色权限是否满足要求
  return roleLevel[userInfo.role] >= roleLevel[requiredRole];
}

/**
 * 获取用户角色名称
 * @returns {string} - 用户角色名称
 */
function getUserRoleName() {
  const userInfo = wx.getStorageSync('userInfo');
  if (!userInfo) return '';
  
  const roleNames = {
    'user': '普通用户',
    'worker': '操作员',
    'admin': '管理员'
  };
  
  return roleNames[userInfo.role] || userInfo.role;
}

module.exports = {
  checkPermission,
  getUserRoleName
};