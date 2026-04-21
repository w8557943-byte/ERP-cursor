Page({
  data: {
    testMessage: '点击按钮测试'
  },

  testClick: function() {
    console.log('按钮被点击了！');
    this.setData({
      testMessage: '按钮成功响应！时间：' + new Date().toLocaleTimeString()
    });
    
    wx.showToast({
      title: '按钮响应成功',
      icon: 'success'
    });
  },

  testWithAlert: function() {
    wx.showModal({
      title: '测试',
      content: '这个方法能正常执行吗？',
      success: (res) => {
        if (res.confirm) {
          console.log('用户点击了确认');
        }
      }
    });
  },

  directLogin: function() {
    console.log('直接测试登录');
    
    // 直接调用 simpleLogin 测试
    const simpleLogin = require('../../utils/simple-login');
    
    simpleLogin.simpleLogin('admin', 'admin123')
      .then(res => {
        console.log('登录成功:', res);
        wx.showToast({
          title: '登录测试成功',
          icon: 'success'
        });
      })
      .catch(err => {
        console.error('登录失败:', err);
        wx.showToast({
          title: '登录测试失败: ' + err.message,
          icon: 'none',
          duration: 3000
        });
      });
  }
});