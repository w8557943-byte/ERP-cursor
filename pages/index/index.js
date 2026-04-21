// pages/index/index.js
const dataSync = require('../../utils/data-sync-utils.js');

Page({

  /**
   * 页面的初始数据
   */
  data: {
    // 统计数据
    dashboardStats: {
      totalOrders: 0,
      totalRevenue: 0,
      pendingOrders: 0,
      inProduction: 0,
      completedOrders: 0,
      overdueOrders: 0
    },
    
    // 今日数据
    todayStats: {
      newOrders: 0,
      revenueToday: 0,
      completedToday: 0,
      revenueTodayText: '0'
    },
    
    // 最近订单
    recentOrders: [],
    
    // 生产状态
    productionStatus: [],
    
    // 财务概览
    financialOverview: {
      totalRevenue: 0,
      accountsReceivable: 0,
      accountsPayable: 0,
      profit: 0,
      totalRevenueText: '0',
      accountsReceivableText: '0',
      accountsPayableText: '0',
      profitText: '0'
    },
    
    // 加载状态
    loading: true,
    refreshLoading: false
  },

  formatNumber(num) {
    const n = Number(num);
    const safe = Number.isFinite(n) ? Math.trunc(n) : 0;
    const sign = safe < 0 ? '-' : '';
    const s = String(Math.abs(safe));
    return sign + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  },

  /**
   * 生命周期函数--监听页面加载
   */
  onLoad(options) {
    console.log('[首页] 页面加载');
    this.loadDashboardData();
    
    // 监听数据变化
    dataSync.subscribe('orders', this.handleOrdersUpdate.bind(this));
    dataSync.subscribe('production', this.handleProductionUpdate.bind(this));
  },

  /**
   * 生命周期函数--监听页面显示
   */
  onShow() {
    console.log('[首页] 页面显示，检查数据更新');
    this.checkForUpdates();
  },

  /**
   * 加载仪表板数据
   */
  async loadDashboardData() {
    try {
      this.setData({ loading: true });
      
      console.log('[首页] 开始加载仪表板数据');
      
      // 获取订单数据
      const orders = await dataSync.getData('orders');
      console.log('[首页] 获取到订单数据:', orders.length);
      
      // 获取生产数据
      const productionData = await this.getProductionData();
      console.log('[首页] 获取到生产数据');
      
      // 计算统计数据
      this.calculateDashboardStats(orders, productionData);
      
      // 获取最近订单
      this.getRecentOrders(orders);
      
      // 获取财务概览
      await this.getFinancialOverview(orders);
      
      this.setData({ loading: false });
      console.log('[首页] 仪表板数据加载完成');
      
    } catch (error) {
      console.error('[首页] 加载数据失败:', error);
      this.setData({ 
        loading: false,
        refreshLoading: false 
      });
      
      wx.showToast({
        title: '数据加载失败',
        icon: 'none'
      });
    }
  },

  /**
   * 获取生产数据
   */
  async getProductionData() {
    try {
      // 尝试从云函数获取生产数据
      const result = await wx.cloud.callFunction({
        name: 'erp-api',
        data: {
          action: 'getProductionPlans',
          params: { limit: 100 }
        }
      });
      
      if (result.result.success) {
        return result.result.data || [];
      }
    } catch (error) {
      console.warn('[首页] 获取生产数据失败，使用本地数据:', error);
    }
    
    // 降级到本地数据
    return [];
  },

  /**
   * 计算仪表板统计数据
   */
  calculateDashboardStats(orders, productionData) {
    const now = Date.now();
    const todayStart = new Date().setHours(0, 0, 0, 0);
    
    // 订单统计
    const totalOrders = orders.length;
    const pendingOrders = orders.filter(order => order.status === 'pending').length;
    const completedOrders = orders.filter(order => order.status === 'completed').length;
    const overdueOrders = orders.filter(order => 
      order.dueDate && order.dueDate < now && order.status !== 'completed'
    ).length;
    
    // 今日数据
    const todayOrders = orders.filter(order => order.createdAt >= todayStart);
    const newOrders = todayOrders.length;
    const revenueToday = todayOrders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const completedToday = orders.filter(order => 
      order.status === 'completed' && order.updatedAt >= todayStart
    ).length;
    
    // 生产统计
    const inProduction = productionData.filter(plan => 
      plan.status === 'in_production'
    ).length;
    
    // 财务统计
    const totalRevenue = orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    
    this.setData({
      dashboardStats: {
        totalOrders,
        totalRevenue,
        pendingOrders,
        inProduction,
        completedOrders,
        overdueOrders
      },
      todayStats: {
        newOrders,
        revenueToday,
        completedToday,
        revenueTodayText: this.formatNumber(revenueToday)
      }
    });
  },

  /**
   * 获取最近订单
   */
  getRecentOrders(orders) {
    const recentOrders = orders
      .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .slice(0, 5);

    const mapped = recentOrders.map(o => {
      const amount = Number(o.totalAmount || 0) || 0;
      return Object.assign({}, o, {
        statusText: this.getStatusText(o.status),
        totalAmountText: this.formatNumber(amount)
      });
    });
    
    this.setData({ recentOrders: mapped });
  },

  /**
   * 获取财务概览
   */
  async getFinancialOverview(orders) {
    try {
      // 尝试从云函数获取财务数据
      const result = await wx.cloud.callFunction({
        name: 'erp-api',
        data: {
          action: 'getDashboardStats',
          params: { period: '30d' }
        }
      });
      
      if (result.result.success) {
        const statistics = result.result.data.statistics || {};
        this.setData({ 
          financialOverview: Object.assign({}, statistics, {
            totalRevenueText: this.formatNumber(statistics.totalRevenue),
            accountsReceivableText: this.formatNumber(statistics.accountsReceivable),
            accountsPayableText: this.formatNumber(statistics.accountsPayable),
            profitText: this.formatNumber(statistics.profit)
          })
        });
        return;
      }
    } catch (error) {
      console.warn('[首页] 获取财务数据失败，使用本地计算:', error);
    }
    
    // 降级到本地计算
    const totalRevenue = orders.reduce((sum, order) => sum + (order.totalAmount || 0), 0);
    const accountsReceivable = orders
      .filter(order => order.status !== 'completed' && order.status !== 'cancelled')
      .reduce((sum, order) => sum + (order.totalAmount || 0), 0);

    const accountsPayable = 0;
    const profit = totalRevenue * 0.3;

    this.setData({
      financialOverview: {
        totalRevenue,
        accountsReceivable,
        accountsPayable,
        profit,
        totalRevenueText: this.formatNumber(totalRevenue),
        accountsReceivableText: this.formatNumber(accountsReceivable),
        accountsPayableText: this.formatNumber(accountsPayable),
        profitText: this.formatNumber(profit)
      }
    });
  },

  /**
   * 检查数据更新
   */
  async checkForUpdates() {
    try {
      console.log('[首页] 检查数据更新');
      await dataSync.checkForUpdates('orders');
      await dataSync.checkForUpdates('production');
    } catch (error) {
      console.warn('[首页] 检查更新失败:', error);
    }
  },

  /**
   * 处理订单数据更新
   */
  handleOrdersUpdate(orders, source) {
    console.log('[首页] 收到订单更新，来源:', source);
    
    // 重新计算统计数据
    this.getProductionData().then(productionData => {
      this.calculateDashboardStats(orders, productionData);
      this.getRecentOrders(orders);
      this.getFinancialOverview(orders);
    });
  },

  /**
   * 处理生产数据更新
   */
  handleProductionUpdate(productionData, source) {
    console.log('[首页] 收到生产数据更新，来源:', source);
    
    // 重新获取订单数据并计算统计
    dataSync.getData('orders').then(orders => {
      this.calculateDashboardStats(orders, productionData);
    });
  },

  /**
   * 刷新数据
   */
  async onRefresh() {
    console.log('[首页] 手动刷新数据');
    this.setData({ refreshLoading: true });
    
    await this.loadDashboardData();
    
    this.setData({ refreshLoading: false });
    wx.showToast({
      title: '刷新成功',
      icon: 'success'
    });
  },

  /**
   * 跳转到订单页面
   */
  navigateToOrders() {
    wx.navigateTo({
      url: '/pages/order/order'
    });
  },

  /**
   * 跳转到生产页面
   */
  navigateToProduction() {
    wx.navigateTo({
      url: '/pages/production/production'
    });
  },

  /**
   * 跳转到财务页面
   */
  navigateToFinance() {
    wx.navigateTo({
      url: '/pages/finance/finance'
    });
  },

  /**
   * 获取状态文本
   */
  getStatusText(status) {
    const statusMap = {
      'pending': '待处理',
      'in_production': '生产中',
      'completed': '已完成',
      'cancelled': '已取消'
    };
    return statusMap[status] || status;
  },

  /**
   * 查看订单详情
   */
  viewOrderDetail(e) {
    const orderId = e.currentTarget.dataset.id;
    if (orderId) {
      wx.navigateTo({
        url: `/pages/order-sub/detail/detail?id=${orderId}`
      });
    }
  },

  /**
   * 页面相关事件处理函数--监听用户下拉动作
   */
  onPullDownRefresh() {
    console.log('[首页] 下拉刷新');
    this.onRefresh().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  /**
   * 生命周期函数--监听页面卸载
   */
  onUnload() {
    // 取消订阅
    dataSync.unsubscribe('orders', this.handleOrdersUpdate);
    dataSync.unsubscribe('production', this.handleProductionUpdate);
  }
})
