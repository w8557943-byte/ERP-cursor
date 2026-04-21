/**
 * 小程序工具模块
 * 包含通用功能：日期格式化、数据格式化等
 */

/**
 * 格式化日期
 * @param {Date|number|string} date - 日期对象或时间戳
 * @param {string} format - 格式模板，默认 'YYYY-MM-DD'
 * @returns {string} - 格式化后的日期字符串
 */
function formatDate(date, format = 'YYYY-MM-DD') {
  if (!date) return '';
  
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hours = String(d.getHours()).padStart(2, '0');
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const seconds = String(d.getSeconds()).padStart(2, '0');
  
  return format
    .replace('YYYY', year)
    .replace('MM', month)
    .replace('DD', day)
    .replace('HH', hours)
    .replace('mm', minutes)
    .replace('ss', seconds);
}

/**
 * 格式化金额
 * @param {number} amount - 金额
 * @param {number} decimals - 小数位数，默认2
 * @returns {string} - 格式化后的金额字符串
 */
function formatAmount(amount, decimals = 2) {
  if (amount === null || amount === undefined || isNaN(amount)) return '0.00';
  
  return Number(amount).toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * 格式化订单状态
 * @param {string} status - 状态代码
 * @returns {string} - 格式化后的状态文本
 */
function formatOrderStatus(status) {
  const statusMap = {
    'pending': '待确认',
    'confirmed': '已确认',
    'in_production': '生产中',
    'produced': '已生产',
    'delivering': '配送中',
    'delivered': '已送达',
    'cancelled': '已取消'
  };
  
  return statusMap[status] || status;
}

/**
 * 格式化生产进度
 * @param {number} progress - 进度值 (0-100)
 * @returns {string} - 格式化后的进度文本
 */
function formatProgress(progress) {
  if (progress === null || progress === undefined || isNaN(progress)) return '0%';
  return `${Math.min(100, Math.max(0, progress))}%`;
}

/**
 * 获取状态对应的颜色
 * @param {string} status - 状态
 * @returns {string} - 颜色值
 */
function getStatusColor(status) {
  const colorMap = {
    'pending': '#ff9500',      // 橙色 - 待处理
    'confirmed': '#09bb07',    // 绿色 - 已确认
    'in_production': '#007aff', // 蓝色 - 进行中
    'produced': '#4cd964',      // 浅绿色 - 已完成
    'delivering': '#5ac8fa',   // 天蓝色 - 配送中
    'delivered': '#3498db',    // 深蓝色 - 已送达
    'cancelled': '#ff3b30'     // 红色 - 已取消
  };
  
  return colorMap[status] || '#8e8e93';
}

/**
 * 显示加载提示
 * @param {string} title - 提示文字，默认'加载中'
 * @param {boolean} mask - 是否显示透明蒙层，默认true
 */
function showLoading(title = '加载中', mask = true) {
  wx.showLoading({
    title,
    mask
  });
}

/**
 * 隐藏加载提示
 */
function hideLoading() {
  wx.hideLoading();
}

/**
 * 显示成功提示
 * @param {string} title - 提示文字，默认'操作成功'
 * @param {number} duration - 持续时间，默认1500毫秒
 */
function showSuccess(title = '操作成功', duration = 1500) {
  wx.showToast({
    title,
    icon: 'success',
    duration
  });
}

/**
 * 显示错误提示
 * @param {string} title - 提示文字，默认'操作失败'
 */
function showError(title = '操作失败') {
  wx.showToast({
    title,
    icon: 'none'
  });
}

/**
 * 确认对话框
 * @param {string} content - 确认内容
 * @param {function} confirm - 确认回调
 * @param {function} cancel - 取消回调
 * @param {string} title - 对话框标题，默认'提示'
 */
function confirm(content, confirm, cancel, title = '提示') {
  wx.showModal({
    title,
    content,
    success: (res) => {
      if (res.confirm) {
        typeof confirm === 'function' && confirm();
      } else {
        typeof cancel === 'function' && cancel();
      }
    }
  });
}

/**
 * 节流函数
 * @param {function} fn - 要执行的函数
 * @param {number} delay - 延迟时间，默认300毫秒
 * @returns {function} - 节流后的函数
 */
function throttle(fn, delay = 300) {
  let timer = null;
  return function(...args) {
    if (!timer) {
      timer = setTimeout(() => {
        fn.apply(this, args);
        timer = null;
      }, delay);
    }
  };
}

/**
 * 防抖函数
 * @param {function} fn - 要执行的函数
 * @param {number} delay - 延迟时间，默认300毫秒
 * @returns {function} - 防抖后的函数
 */
function debounce(fn, delay = 300) {
  let timer = null;
  return function(...args) {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      fn.apply(this, args);
    }, delay);
  };
}

module.exports = {
  formatDate,
  formatAmount,
  formatOrderStatus,
  formatProgress,
  getStatusColor,
  showLoading,
  hideLoading,
  showSuccess,
  showError,
  confirm,
  throttle,
  debounce
};