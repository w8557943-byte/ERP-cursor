// 客户详情页面
Page({
  data: {
    customer: null,
    customerData: null
  },

  onLoad: function(options) {
    const loadData = () => {
      if (options && options.key) {
        try {
          const raw = wx.getStorageSync(options.key);
          if (raw && typeof raw === 'object') {
            try { wx.removeStorageSync(options.key); } catch (_) {}
            return raw;
          }
        } catch (_) {}
      }
      if (options && options.customerData) {
        try { return JSON.parse(decodeURIComponent(options.customerData)); } catch (_) {}
      }
      return null;
    };
    const customerData = loadData();
    if (!customerData) return;
    const totalAmount = Number(customerData.totalAmount || 0);
    const totalAmountText = isFinite(totalAmount) ? totalAmount.toLocaleString() : '0';
    const nextCustomer = Object.assign({}, customerData, { totalAmountText });
    this.setData({ customer: nextCustomer, customerData: nextCustomer });
    wx.setNavigationBarTitle({ title: customerData.name || '客户详情' });
  },

  // 编辑客户
  editCustomer: function() {
    if (this.data.customer) {
      const key = `customer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        wx.setStorageSync(key, this.data.customer);
        wx.navigateTo({ url: `/pages/management-sub/customers/edit/edit?key=${encodeURIComponent(key)}` });
      } catch (_) {}
    }
  },

  // 创建订单
  createOrder: function() {
    if (this.data.customer) {
      const key = `customer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try { wx.setStorageSync(key, this.data.customer); } catch (_) {}
      wx.navigateTo({ url: `/pages/order-sub/create/create?customerKey=${encodeURIComponent(key)}` });
    }
  },

  // 查看历史订单
  viewOrderHistory: function() {
    if (this.data.customer) {
      wx.navigateTo({
        url: `/pages/order/order?customerId=${this.data.customer.id}`
      });
    }
  },

  // 拨打电话
  callCustomer: function() {
    if (this.data.customer && this.data.customer.phone) {
      wx.makePhoneCall({
        phoneNumber: this.data.customer.phone
      });
    }
  }
});
