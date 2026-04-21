// 简单的登录调试页面
Page({
  data: {
    logs: []
  },

  onLoad: function() {
    console.log('[test-debug] 调试页面加载');
    this.addLog('页面加载完成');
  },

  // 添加日志
  addLog: function(message) {
    const timestamp = new Date().toLocaleTimeString();
    const logs = this.data.logs;
    logs.push(`[${timestamp}] ${message}`);
    
    // 只保留最近20条日志
    if (logs.length > 20) {
      logs.shift();
    }
    
    this.setData({ logs });
    console.log(message);
  },

  // 测试云环境
  testCloud: function() {
    this.addLog('开始测试云环境...');
    
    try {
      // 测试云环境初始化
      if (wx.cloud) {
        this.addLog('✓ wx.cloud 对象存在');
        
        // 测试获取上下文
        wx.cloud.callFunction({
          name: 'test-login',
          data: { action: 'simple_login' }
        }).then(res => {
          this.addLog('✓ 云函数调用成功');
          this.addLog(`返回数据: ${JSON.stringify(res.result)}`);
        }).catch(err => {
          this.addLog(`✗ 云函数调用失败: ${err.message}`);
          this.addLog(`错误代码: ${err.errCode}`);
        });
        
      } else {
        this.addLog('✗ wx.cloud 对象不存在');
      }
    } catch (e) {
      this.addLog(`✗ 测试异常: ${e.message}`);
    }
  },

  // 测试数据库
  testDatabase: function() {
    this.addLog('开始测试数据库...');
    
    try {
      const db = wx.cloud.database();
      this.addLog('✓ 数据库对象创建成功');
      
      db.collection('users').limit(1).get().then(res => {
        this.addLog(`✓ 数据库查询成功，用户数: ${res.data.length}`);
      }).catch(err => {
        this.addLog(`✗ 数据库查询失败: ${err.message}`);
      });
      
    } catch (e) {
      this.addLog(`✗ 数据库测试异常: ${e.message}`);
    }
  },

  // 测试登录云函数
  testLoginFunction: function() {
    this.addLog('开始测试登录云函数...');
    
    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'login',
        username: 'admin',
        password: 'admin123'
      }
    }).then(res => {
      this.addLog('✓ 登录云函数调用成功');
      this.addLog(`响应结构: ${JSON.stringify(Object.keys(res))}`);
      this.addLog(`有result字段: ${!!res.result}`);
      
      if (res.result) {
        this.addLog(`result.success: ${res.result.success}`);
        this.addLog(`result.message: ${res.result.message}`);
      }
    }).catch(err => {
      this.addLog(`✗ 登录云函数调用失败: ${err.message}`);
      this.addLog(`错误详情: ${JSON.stringify(err)}`);
    });
  },

  // 清除日志
  clearLogs: function() {
    this.setData({ logs: [] });
  },

  // 复制日志
  copyLogs: function() {
    const logs = this.data.logs.join('\n');
    wx.setClipboardData({
      data: logs,
      success: () => {
        wx.showToast({
          title: '日志已复制',
          icon: 'success'
        });
      }
    });
  }
});