const { API, clearCache } = require('../../../utils/unified-api');
const { logger } = require('../../../utils/logger');

Page({
  data: { loading: false, orders: [], selectedOrders: {} },

  onLoad() {
    this.loadOrders();
  },

  async loadOrders() {
    this.setData({ loading: true });

    try {
      const res = await API.getOrders({
        status: 'stocked',
        limit: 100
      });
      const orders = res.data || [];
      this.setData({ orders });
    } catch (err) {
      logger.error('Shipping', '加载订单失败', err);
      this.setData({ orders: [] });
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      this.setData({ loading: false });
    }
  },

  onSelect(e) {
    const val = e?.detail?.value || [];
    const map = {};
    val.forEach(id => { map[id] = true });
    this.setData({ selectedOrders: map });
  },

  async confirmShipping() {
    const ids = Object.keys(this.data.selectedOrders).filter(k => this.data.selectedOrders[k]);

    if (ids.length === 0) {
      wx.showToast({ title: '请选择订单', icon: 'none' });
      return;
    }

    wx.showLoading({ title: '处理中...' });

    try {
      await API.updateOrder(null, {
        orderIds: ids,
        status: 'shipped',
        batchUpdate: true
      });

      wx.hideLoading();
      wx.showToast({ title: '发货成功', icon: 'success' });

      this.setData({ selectedOrders: {} });
      // 清除缓存并重新加载
      clearCache('getOrders');
      await this.loadOrders();
    } catch (err) {
      wx.hideLoading();
      logger.error('Shipping', '发货失败', err);
      wx.showToast({ title: err.message || '发货失败', icon: 'none' });
    }
  }
})
