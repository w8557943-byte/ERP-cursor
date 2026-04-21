Page({
  data: {
    orderInfo: null,
    canvasWidth: 0,
    canvasHeight: 0
  },

  onLoad: function(options) {
    if (options && options.key) {
      try {
        const v = wx.getStorageSync(options.key);
        if (v && typeof v === 'object') {
          this.setData({ orderInfo: v });
        }
        try { wx.removeStorageSync(options.key); } catch (_) {}
      } catch (e) {
        console.error('读取缓存失败', e);
      }
    } else if (options && options.orderInfo) {
      try {
        const orderInfo = JSON.parse(decodeURIComponent(options.orderInfo));
        this.setData({ orderInfo });
      } catch (e) {
        console.error('解析订单数据失败', e);
        wx.showToast({ title: '数据解析失败', icon: 'none' });
      }
    } else if (options && options.orderId) {
       this.loadOrder(options.orderId);
    }
  },

  loadOrder: async function(id) {
    wx.showLoading({ title: '加载中...' });
    try {
       const res = await wx.cloud.callFunction({ name: 'erp-api', data: { action: 'getOrderDetail', data: { id } } });
       if (res && res.result && res.result.data) {
         this.setData({ orderInfo: res.result.data });
       }
    } catch(e) {
       console.error(e);
       wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  onPrint: function() {
    wx.showToast({
      title: '正在发送打印指令...',
      icon: 'loading',
      duration: 2000
    });
    // 这里可以接入蓝牙打印机或生成图片保存
    setTimeout(() => {
        wx.showToast({ title: '打印指令已发送', icon: 'success' });
    }, 2000);
  }
});
