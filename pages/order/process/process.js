Page({
  data: {
    orderId: ''
  },
  onLoad: function (options) {
    this.setData({
      orderId: options.orderId
    });
    console.log('订单处理页面加载，订单ID:', options.orderId);
  }
});