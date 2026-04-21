// 登录测试页面 - 用于调试登录功能
Page({
  data: {
    username: '',
    password: '',
    result: '',
    error: '',
    loading: false
  },

  onLoad: function() {
    // 开启调试模式
    wx.setStorageSync('DEBUG_MODE', true);
    console.log('[test-login] 开启调试模式');
  },

  // 输入处理
  bindUsernameInput: function(e) {
    this.setData({ username: e.detail.value });
  },

  bindPasswordInput: function(e) {
    this.setData({ password: e.detail.value });
  },

  // 测试基础连接
  testBasicConnection: function() {
    this.setData({ loading: true, result: '', error: '' });
    
    console.log('[test-login] 测试基础连接');
    
    wx.cloud.callFunction({
      name: 'test-login',
      data: {
        action: 'simple_login'
      }
    }).then(res => {
      console.log('[test-login] 基础连接成功:', res);
      
      const resultData = {
        success: true,
        result: res.result,
        rawResponse: res
      };
      
      this.setData({
        loading: false,
        result: JSON.stringify(resultData, null, 2)
      });
    }).catch(err => {
      console.error('[test-login] 基础连接错误:', err);
      
      this.setData({
        loading: false,
        error: JSON.stringify({
          message: err.message,
          errCode: err.errCode,
          errMsg: err.errMsg,
          stack: err.stack
        }, null, 2)
      });
    });
  },

  // 创建测试用户
  createTestUser: function() {
    this.setData({ loading: true, result: '', error: '' });
    
    wx.cloud.callFunction({
      name: 'test-login',
      data: {
        action: 'create_user'
      }
    }).then(res => {
      console.log('[test-login] 创建用户成功:', res);
      
      const resultData = {
        success: true,
        result: res.result,
        rawResponse: res
      };
      
      this.setData({
        loading: false,
        result: JSON.stringify(resultData, null, 2)
      });
    }).catch(err => {
      console.error('[test-login] 创建用户错误:', err);
      
      this.setData({
        loading: false,
        error: JSON.stringify({
          message: err.message,
          errCode: err.errCode,
          errMsg: err.errMsg,
          stack: err.stack
        }, null, 2)
      });
    });
  },

  // 测试登录
  testLogin: function() {
    this.setData({ loading: true, result: '', error: '' });
    
    console.log('[test-login] 开始测试登录');
    console.log('[test-login] 用户名:', this.data.username);
    
    // 直接调用云函数测试
    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'login',
        username: this.data.username,
        password: this.data.password
      }
    }).then(res => {
      console.log('[test-login] 登录成功响应:', res);
      
      const resultData = {
        success: true,
        result: res.result,
        rawResponse: res,
        // 添加更多调试信息
        debug: {
          hasResult: !!res.result,
          resultSuccess: res.result && res.result.success,
          resultData: res.result && res.result.data,
          hasData: res.result && res.result.data && !!res.result.data.user
        }
      };
      
      this.setData({
        loading: false,
        result: JSON.stringify(resultData, null, 2)
      });
    }).catch(err => {
      console.error('[test-login] 登录错误:', err);
      
      this.setData({
        loading: false,
        error: JSON.stringify({
          message: err.message,
          errCode: err.errCode,
          errMsg: err.errMsg,
          stack: err.stack,
          // 添加更多调试信息
          debug: {
            hasErrCode: !!err.errCode,
            hasErrMsg: !!err.errMsg,
            hasMessage: !!err.message,
            errorType: typeof err
          }
        }, null, 2)
      });
    });
  },

  // 测试数据库查询
  testDatabase: function() {
    this.setData({ loading: true, result: '', error: '' });
    
    const db = wx.cloud.database();
    
    db.collection('users').get().then(res => {
      console.log('[test-login] 数据库查询成功:', res);
      
      this.setData({
        loading: false,
        result: JSON.stringify({
          success: true,
          data: res.data,
          count: res.data.length
        }, null, 2)
      });
    }).catch(err => {
      console.error('[test-login] 数据库查询错误:', err);
      
      this.setData({
        loading: false,
        error: JSON.stringify({
          message: err.message,
          errCode: err.errCode,
          errMsg: err.errMsg,
          stack: err.stack
        }, null, 2)
      });
    });
  },

  // 清除结果
  clearResults: function() {
    this.setData({ result: '', error: '' });
  },

  // 复制结果
  copyResult: function() {
    const content = this.data.result || this.data.error;
    
    wx.setClipboardData({
      data: content,
      success: () => {
        wx.showToast({
          title: '已复制到剪贴板',
          icon: 'success'
        });
      }
    });
  }
});
