const { getData, updateData, getConsistencyStatus } = require('../../utils/data-sync-utils.js');

Page({
  data: {
    orders: [],
    syncStatus: 'idle',
    lastSyncTime: null,
    errorMessage: '',
    consistencyStatus: {}
  },

  onLoad() {
    console.log('数据同步测试页面加载');
    this.testDataSync();
  },

  async testDataSync() {
    wx.showLoading({ title: '测试中...' });
    
    try {
      this.setData({ syncStatus: 'syncing' });
      
      // 测试获取数据
      const orders = await getData('orders', true);
      console.log('获取到的订单数据:', orders);
      
      // 测试一致性状态
      const consistencyStatus = await getConsistencyStatus();
      
      this.setData({
        orders: orders || [],
        syncStatus: 'success',
        lastSyncTime: new Date().toLocaleString(),
        consistencyStatus: consistencyStatus
      });
      
      wx.showToast({
        title: '测试成功',
        icon: 'success'
      });
      
    } catch (error) {
      console.error('数据同步测试失败:', error);
      
      this.setData({
        syncStatus: 'error',
        errorMessage: error.message || '未知错误'
      });
      
      wx.showToast({
        title: '测试失败',
        icon: 'none'
      });
    } finally {
      wx.hideLoading();
    }
  },

  refreshData() {
    this.testDataSync();
  },

  createTestOrder() {
    wx.showModal({
      title: '创建测试订单',
      content: '是否创建测试订单？',
      success: async (res) => {
        if (res.confirm) {
          try {
            wx.showLoading({ title: '创建中...' });
            
            const testOrder = {
              orderNumber: 'TEST-' + Date.now(),
              customerName: '测试客户',
              productName: '测试产品',
              quantity: 100,
              amount: 1000,
              status: 'ordered'
            };
            
            const result = await updateData('orders', testOrder);
            
            wx.showToast({
              title: '创建成功',
              icon: 'success'
            });
            
            // 刷新数据
            this.refreshData();
            
          } catch (error) {
            console.error('创建测试订单失败:', error);
            wx.showToast({
              title: '创建失败',
              icon: 'none'
            });
          } finally {
            wx.hideLoading();
          }
        }
      }
    });
  }
});