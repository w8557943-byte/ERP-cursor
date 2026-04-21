const { API, clearCache } = require('../../utils/unified-api');
const { logger } = require('../../utils/logger');

Page({
  data: {
    userInfo: {},
    displayName: '',
    greetingText: '',
    currentDate: '',
    currentWeekday: '',
    lunarDate: '',
    stats: {
      todayOrders: 0,
      inProduction: 0,
      completedToday: 0,
      totalRevenue: 0
    },
    loading: true,
    formatRevenue: '0',
    overviewLoading: true,
    overview: {
      monthSalesText: '0.00',
      inventoryAmountText: '0.00',
      monthShippedAmountText: '0.00',
      monthPayableText: '0.00',
      monthRawMaterialCostText: '0.00',
      monthGrossProfitText: '0.00',
      monthGrossProfitRateText: '0.0%'
    },
    reminderCount: 0,
    reminders: []
  },

  onLoad: function () {
    console.log('工作台页面加载成功');
    this.initUserInfo();
    this.startClock();
    this.loadStats();
  },

  onShow: function () {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().init();
    }
    console.log('工作台页面显示');
    this.initUserInfo();
    this.startClock();
    this.loadStats();
  },

  onHide: function () {
    this.stopClock();
  },

  onUnload: function () {
    this.stopClock();
  },

  initUserInfo: function () {
    let userInfo = null;
    try {
      userInfo = wx.getStorageSync('userInfo') || null;
    } catch (e) { }
    if (!userInfo) {
      try {
        const app = getApp();
        userInfo = (app && app.globalData && app.globalData.userInfo) ? app.globalData.userInfo : null;
      } catch (e) { }
    }
    const displayName = (userInfo && (userInfo.name || userInfo.username || userInfo.nickname)) ? (userInfo.name || userInfo.username || userInfo.nickname) : '用户';
    this.setData({ userInfo: userInfo || {}, displayName });
  },

  getGreetingText: function (dateObj) {
    const d = dateObj instanceof Date ? dateObj : new Date();
    const hour = d.getHours();
    if (hour >= 5 && hour < 11) return '早上好';
    if (hour >= 11 && hour < 13) return '中午好';
    if (hour >= 13 && hour < 18) return '下午好';
    return '晚上好';
  },

  getLunarText: function (dateObj) {
    const lunarInfo = [
      0x04bd8, 0x04ae0, 0x0a570, 0x054d5, 0x0d260, 0x0d950, 0x16554, 0x056a0, 0x09ad0, 0x055d2,
      0x04ae0, 0x0a5b6, 0x0a4d0, 0x0d250, 0x1d255, 0x0b540, 0x0d6a0, 0x0ada2, 0x095b0, 0x14977,
      0x04970, 0x0a4b0, 0x0b4b5, 0x06a50, 0x06d40, 0x1ab54, 0x02b60, 0x09570, 0x052f2, 0x04970,
      0x06566, 0x0d4a0, 0x0ea50, 0x06e95, 0x05ad0, 0x02b60, 0x186e3, 0x092e0, 0x1c8d7, 0x0c950,
      0x0d4a0, 0x1d8a6, 0x0b550, 0x056a0, 0x1a5b4, 0x025d0, 0x092d0, 0x0d2b2, 0x0a950, 0x0b557,
      0x06ca0, 0x0b550, 0x15355, 0x04da0, 0x0a5d0, 0x14573, 0x052d0, 0x0a9a8, 0x0e950, 0x06aa0,
      0x0aea6, 0x0ab50, 0x04b60, 0x0aae4, 0x0a570, 0x05260, 0x0f263, 0x0d950, 0x05b57, 0x056a0,
      0x096d0, 0x04dd5, 0x04ad0, 0x0a4d0, 0x0d4d4, 0x0d250, 0x0d558, 0x0b540, 0x0b5a0, 0x195a6,
      0x095b0, 0x049b0, 0x0a974, 0x0a4b0, 0x0b27a, 0x06a50, 0x06d40, 0x0af46, 0x0ab60, 0x09570,
      0x04af5, 0x04970, 0x064b0, 0x074a3, 0x0ea50, 0x06b58, 0x055c0, 0x0ab60, 0x096d5, 0x092e0,
      0x0c960, 0x0d954, 0x0d4a0, 0x0da50, 0x07552, 0x056a0, 0x0abb7, 0x025d0, 0x092d0, 0x0cab5,
      0x0a950, 0x0b4a0, 0x0baa4, 0x0ad50, 0x055d9, 0x04ba0, 0x0a5b0, 0x15176, 0x052b0, 0x0a930,
      0x07954, 0x06aa0, 0x0ad50, 0x05b52, 0x04b60, 0x0a6e6, 0x0a4e0, 0x0d260, 0x0ea65, 0x0d530,
      0x05aa0, 0x076a3, 0x096d0, 0x04bd7, 0x04ad0, 0x0a4d0, 0x1d0b6, 0x0d250, 0x0d520, 0x0dd45,
      0x0b5a0, 0x056d0, 0x055b2, 0x049b0, 0x0a577, 0x0a4b0, 0x0aa50, 0x1b255, 0x06d20, 0x0ada0,
      0x14b63, 0x09370, 0x049f8, 0x04970, 0x064b0, 0x168a6, 0x0ea50, 0x06b20, 0x1a6c4, 0x0aae0,
      0x0a2e0, 0x0d2e3, 0x0c960, 0x0d557, 0x0d4a0, 0x0da50, 0x05d55, 0x056a0, 0x0a6d0, 0x055d4,
      0x052d0, 0x0a9b8, 0x0a950, 0x0b4a0, 0x0b6a6, 0x0ad50, 0x055a0, 0x0aba4, 0x0a5b0, 0x052b0,
      0x0b273, 0x06930, 0x07337, 0x06aa0, 0x0ad50, 0x14b55, 0x04b60, 0x0a570, 0x054e4, 0x0d160,
      0x0e968, 0x0d520, 0x0daa0, 0x16aa6, 0x056d0, 0x04ae0, 0x0a9d4, 0x0a2d0, 0x0d150, 0x0f252,
      0x0d520
    ];
    const date = dateObj instanceof Date ? dateObj : new Date(dateObj);
    if (isNaN(date.getTime())) return '';

    const year = date.getFullYear();
    if (year < 1900 || year > 2100) return '';

    const baseUtc = Date.UTC(1900, 0, 31);
    const targetUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    let offset = Math.floor((targetUtc - baseUtc) / 86400000);

    const leapMonth = (y) => lunarInfo[y - 1900] & 0xf;
    const leapDays = (y) => (leapMonth(y) ? ((lunarInfo[y - 1900] & 0x10000) ? 30 : 29) : 0);
    const monthDays = (y, m) => ((lunarInfo[y - 1900] & (0x10000 >> m)) ? 30 : 29);
    const yearDays = (y) => {
      let sum = 348;
      for (let i = 0x8000; i > 0x8; i >>= 1) sum += (lunarInfo[y - 1900] & i) ? 1 : 0;
      return sum + leapDays(y);
    };

    let lunarYear = 1900;
    let yearSpan = 0;
    let loopCount1 = 0;
    while (lunarYear <= 2100 && offset > 0) {
      if (++loopCount1 > 200) break; // 防止死循环保护
      yearSpan = yearDays(lunarYear);
      offset -= yearSpan;
      lunarYear += 1;
    }
    if (offset < 0) {
      offset += yearSpan;
      lunarYear -= 1;
    }

    const leap = leapMonth(lunarYear);
    let lunarMonth = 1;
    let isLeap = false;
    let monthSpan = 0;
    let loopCount2 = 0;
    while (lunarMonth <= 12) {
      if (++loopCount2 > 30) break; // 防止死循环保护
      monthSpan = isLeap ? leapDays(lunarYear) : monthDays(lunarYear, lunarMonth);
      if (offset < monthSpan) break;
      offset -= monthSpan;
      if (leap > 0 && lunarMonth === leap && !isLeap) {
        isLeap = true;
      } else {
        if (isLeap) isLeap = false;
        lunarMonth += 1;
      }
    }

    const lunarDay = offset + 1;
    const monthCn = { 1: '正', 2: '二', 3: '三', 4: '四', 5: '五', 6: '六', 7: '七', 8: '八', 9: '九', 10: '十', 11: '十一', 12: '腊' };
    const n1 = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
    const n2 = ['初', '十', '廿', '三'];
    const dayCn = (d) => {
      if (d === 10) return '初十';
      if (d === 20) return '二十';
      if (d === 30) return '三十';
      return n2[Math.floor(d / 10)] + n1[d % 10];
    };
    const mText = (isLeap ? '闰' : '') + (monthCn[lunarMonth] || String(lunarMonth)) + '月';
    return '农历' + mText + dayCn(lunarDay);
  },

  startClock: function () {
    this.updateDateTime();
    if (this._clockTimer) return;
    this._clockTimer = setInterval(() => {
      this.updateDateTime();
    }, 60 * 1000);
  },

  stopClock: function () {
    if (!this._clockTimer) return;
    clearInterval(this._clockTimer);
    this._clockTimer = null;
  },

  updateDateTime: function () {
    const now = new Date();
    const date = `${now.getFullYear()}年${now.getMonth() + 1}月${now.getDate()}日`;
    const weekdays = ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'];
    const weekday = weekdays[now.getDay()];

    this.setData({
      greetingText: this.getGreetingText(now),
      currentDate: date,
      currentWeekday: weekday,
      lunarDate: this.getLunarText(now)
    });
  },

  loadStats: function () {
    this.setData({ loading: true });

    // 获取今日订单统计
    this.getTodayOrders();
    // 获取生产中订单统计
    this.getInProductionOrders();
    // 获取已完成订单统计
    this.getCompletedOrders();
    // 获取今日营收统计
    this.getTodayRevenue();
    this.loadReminders();
    this.loadOverview();
  },

  // 获取今日订单数量
  async getTodayOrders() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);

    try {
      const res = await API.getOrders({
        dateRange: {
          start: monthStart.getTime(),
          end: Date.now()
        }
      });

      if (res.success) {
        const todayOrders = res.pagination?.total || 0;
        this.setData({
          'stats.todayOrders': todayOrders,
          loading: false
        });
      } else {
        logger.error('Workbench', '获取今日订单失败', res.error);
        this.setData({ loading: false });
      }
    } catch (err) {
      logger.error('Workbench', '调用云函数失败', err);
      this.setData({ loading: false });
    }
  },

  // 获取生产中订单数量（状态为 processing 或 producing 的订单）
  async getInProductionOrders() {
    try {
      const res = await API.getOrders({
        status: ['processing', 'producing', 'in_production'], // 涵盖所有生产中状态
        limit: 1 // 我们只需要 total
      });

      if (res.success) {
        const inProduction = res.pagination?.total || 0;
        this.setData({
          'stats.inProduction': inProduction
        });
      } else {
        logger.error('Workbench', '获取生产中订单失败', res.error);
      }
    } catch (err) {
      logger.error('Workbench', '调用云函数失败', err);
    }
  },

  // 获取已完成订单数量（今日）
  async getCompletedOrders() {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    todayStart.setHours(0, 0, 0, 0);

    try {
      const res = await API.getOrders({
        status: ['completed', 'stocked'], // 已完成或已入库
        dateRange: {
          start: todayStart.getTime(),
          end: Date.now()
        },
        limit: 1 // 我们只需要 total
      });

      if (res.success) {
        const completedTotal = res.pagination?.total || 0;
        this.setData({
          'stats.completedToday': completedTotal
        });
      } else {
        logger.error('Workbench', '获取已完成订单失败', res.error);
      }
    } catch (err) {
      logger.error('Workbench', '调用云函数失败', err);
    }
  },

  // 获取今日营收
  async getTodayRevenue() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    try {
      const res = await API.getOrders({
        dateRange: {
          start: today.getTime(),
          end: Date.now()
        }
      });

      if (res.success) {
        // 计算今日订单总金额
        const orders = res.data || [];
        const totalRevenue = orders.reduce((sum, order) => {
          return sum + (parseFloat(order.totalAmount) || 0);
        }, 0);

        const roundedRevenue = Math.round(totalRevenue * 100) / 100; // 保留两位小数

        this.setData({
          'stats.totalRevenue': roundedRevenue
        });

        // 格式化营收金额
        this.formatRevenueAmount(roundedRevenue);
      } else {
        logger.error('Workbench', '获取今日营收失败', res.error);
      }
    } catch (err) {
      logger.error('Workbench', '调用云函数失败', err);
    }
  },

  // 格式化营收金额
  formatRevenueAmount: function (revenue) {
    // 简单的千分位格式化
    const formatted = revenue.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    this.setData({
      formatRevenue: formatted
    });
  },

  formatMoneyText: function (value) {
    const n = Number(value || 0);
    const safe = Number.isFinite(n) ? n : 0;
    return safe.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  },

  async loadOverview() {
    this.setData({ overviewLoading: true });

    let userId = ''
    try {
      const userInfo = wx.getStorageSync('userInfo') || {}
      userId = String(userInfo.id || userInfo._id || userInfo.userId || '').trim()
    } catch (e) {
      userId = ''
    }

    try {
      const res = await API.getWorkbenchOverviewStats(userId ? { userId } : {});

      if (!res.success) {
        this.setData({
          overviewLoading: false,
          overview: {
            monthSalesText: '--',
            inventoryAmountText: '--',
            monthShippedAmountText: '--',
            monthPayableText: '--',
            monthRawMaterialCostText: '--',
            monthGrossProfitText: '--',
            monthGrossProfitRateText: '--'
          }
        });
        return;
      }

      const data = res.data || {};
      const monthSales = Number(data.monthSales || 0);
      const inventoryAmount = Number(data.inventoryAmount || 0);
      const monthShippedAmount = Number(data.monthShippedAmount || 0);
      const monthPayable = Number(data.monthPayable || 0);
      const monthRawMaterialCost = Number(data.monthRawMaterialCost || 0);
      const monthGrossProfit = Number(data.monthGrossProfit || 0);
      const monthGrossProfitRate = Number(data.monthGrossProfitRate || 0);

      this.setData({
        overviewLoading: false,
        overview: {
          monthSalesText: this.formatMoneyText(monthSales),
          inventoryAmountText: this.formatMoneyText(inventoryAmount),
          monthShippedAmountText: this.formatMoneyText(monthShippedAmount),
          monthPayableText: this.formatMoneyText(monthPayable),
          monthRawMaterialCostText: this.formatMoneyText(monthRawMaterialCost),
          monthGrossProfitText: this.formatMoneyText(monthGrossProfit),
          monthGrossProfitRateText: monthGrossProfitRate.toFixed(1) + '%'
        }
      });
    } catch (err) {
      logger.error('Workbench', '加载概览数据失败', err);
      this.setData({
        overviewLoading: false,
        overview: {
          monthSalesText: '--',
          inventoryAmountText: '--',
          monthShippedAmountText: '--',
          monthPayableText: '--',
          monthRawMaterialCostText: '--',
          monthGrossProfitText: '--',
          monthGrossProfitRateText: '--'
        }
      });
    }
  },

  toTs: function (value) {
    if (!value) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') {
      const t = Date.parse(value);
      return Number.isFinite(t) ? t : 0;
    }
    return 0;
  },

  async loadReminders() {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const weekMs = 7 * dayMs;

    try {
      const fetchPaged = async (fetchFn, baseParams, maxItems = 500) => {
        const limit = 50;
        const out = [];
        for (let page = 1; page <= 10 && out.length < maxItems; page += 1) {
          const res = await fetchFn({ ...(baseParams || {}), page, limit });
          const list = res && Array.isArray(res.data) ? res.data : [];
          if (list.length) out.push(...list);
          if (list.length < limit) break;
        }
        return out.slice(0, maxItems);
      };

      const [orders, purchaseOrders, plans] = await Promise.all([
        fetchPaged((p) => API.getOrders(p), { compact: true, withTotal: false }, 200).catch(() => []),
        fetchPaged((p) => API.getPurchaseOrders(p), { withTotal: false }, 200).catch(() => []),
        fetchPaged((p) => API.getProductionPlans(p), { withTotal: false }, 200).catch(() => [])
      ]);
      const reminders = [];

      const normalizeStatus = (s) => String(s || '').trim().toLowerCase();
      const isCompleted = (s) => {
        const st = normalizeStatus(s);
        return st === 'completed' || st === 'done' || st === 'finished' || st === 'cancelled' || st === 'refunded';
      };

      const overdueOrders = (Array.isArray(orders) ? orders : []).filter((o) => {
        if (!o) return false;
        if (isCompleted(o.status)) return false;
        const deliveryTs = this.toTs(o.deliveryDate || o.delivery_time || o.expectedDeliveryDate);
        if (!deliveryTs) return false;
        return deliveryTs < now;
      });

      if (overdueOrders.length) {
        reminders.push({ title: '订单逾期', count: overdueOrders.length });
      }

      const timeoutPlans = (Array.isArray(plans) ? plans : []).filter((p) => {
        if (!p) return false;
        if (isCompleted(p.status)) return false;
        const scheduledTs = this.toTs(p.scheduledDate || p.planDate || p.deadline || p.endDate);
        if (!scheduledTs) return false;
        return scheduledTs < now;
      });
      if (timeoutPlans.length) {
        reminders.push({ title: '生产超时', count: timeoutPlans.length });
      }

      const inventoryOverWeekSales = (Array.isArray(orders) ? orders : []).filter((o) => {
        if (!o) return false;
        const stockedQty = Number(o.stockedQty || 0);
        const shippedQty = Number(o.shippedQty || 0);
        const invQty = Math.max(0, stockedQty - shippedQty);
        if (!(invQty > 0)) return false;
        const stockedAtTs = this.toTs(o.stockedAt || o.stockTime || o.updatedAt);
        if (!stockedAtTs) return false;
        return now - stockedAtTs >= weekMs;
      });

      const inventoryOverWeekPurchase = (Array.isArray(purchaseOrders) ? purchaseOrders : []).filter((o) => {
        if (!o) return false;
        const stockedQty = Number(o.stockedQty || 0);
        if (!(stockedQty > 0)) return false;
        const stockedAtTs = this.toTs(o.stockedAt || o.stockTime || o.updatedAt);
        if (!stockedAtTs) return false;
        return now - stockedAtTs >= weekMs;
      });

      const inventoryOverWeek = inventoryOverWeekSales.length + inventoryOverWeekPurchase.length;
      if (inventoryOverWeek) {
        reminders.push({ title: '库存超过1周', count: inventoryOverWeek });
      }

      const overduePayments = (Array.isArray(orders) ? orders : []).filter((o) => {
        if (!o) return false;
        const total = Number(o.finalAmount || o.totalAmount || o.amount || 0);
        const paid = Number(o.paidAmount || o.paid || 0);
        const unpaid = Math.max(0, total - paid);
        if (!(unpaid > 0)) return false;
        const dueTs = this.toTs(o.dueDate || o.paymentDueDate);
        if (!dueTs) return false;
        return dueTs < now;
      });

      if (overduePayments.length) {
        reminders.push({ title: '待付款逾期', count: overduePayments.length });
      }

      const reminderCount = reminders.reduce((sum, r) => sum + Number(r.count || 0), 0);
      this.setData({ reminders, reminderCount });
    } catch (err) {
      logger.error('Workbench', '加载提醒失败', err);
    }
  },

  openReminders: function () {
    const count = Number(this.data.reminderCount || 0);
    const reminders = Array.isArray(this.data.reminders) ? this.data.reminders : [];
    if (!(count > 0) || reminders.length === 0) {
      wx.showToast({ title: '暂无消息提醒', icon: 'none' });
      return;
    }
    const content = reminders
      .filter((r) => r && Number(r.count || 0) > 0)
      .map((r) => `${r.title}：${r.count}`)
      .join('\n');
    wx.showModal({
      title: '消息提醒',
      content: content || '暂无消息提醒',
      showCancel: false,
      confirmText: '知道了'
    });
  },

  ensureAllowed: function () {
    let userInfo = this.data.userInfo;
    if (!userInfo || !userInfo.role) {
      // 如果 data 中没有，尝试从 Storage 获取
      try {
        userInfo = wx.getStorageSync('userInfo');
      } catch (e) { }
    }

    const role = userInfo && userInfo.role ? String(userInfo.role).toLowerCase() : '';
    console.log('[Workbench] ensureAllowed check. Role:', role);

    if (role === 'operator') {
      wx.showToast({
        title: '无权访问此功能',
        icon: 'none'
      });
      return false;
    }
    return true;
  },

  // 导航功能
  navigateTo: function (url) {
    console.log('导航到:', url);
    wx.navigateTo({
      url: url,
      fail: (err) => {
        console.error('导航失败:', err);
        wx.showToast({
          title: '页面跳转失败',
          icon: 'none'
        });
      }
    });
  },

  // 快捷功能
  openDataManagement: function () {
    if (!this.ensureAllowed()) return;
    this.navigateTo('/pages/management-sub/data-management/data-management');
  },

  viewPurchases: function () {
    if (!this.ensureAllowed()) return;
    this.navigateTo('/pages/purchase-sub/purchase/purchase');
  },

  viewOrders: function () {
    if (!this.ensureAllowed()) return;
    wx.switchTab({
      url: '/pages/order/order'
    });
  },

  viewInventory: function () {
    if (!this.ensureAllowed()) return;
    this.navigateTo('/pages/inventory-sub/inventory/inventory');
  },

  viewProduction: function () {
    wx.switchTab({
      url: '/pages/production/production'
    });
  },

  // 改为客户管理
  viewCustomers: function () {
    if (!this.ensureAllowed()) return;
    this.navigateTo('/pages/management-sub/customers/customers');
  }
});
