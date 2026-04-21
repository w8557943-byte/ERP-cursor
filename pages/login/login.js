const simpleLogin = require('../../utils/simple-login.js');

Page({
  data: {
    activeTab: 'code',
    phone: '',
    password: '',
    showPassword: false,
    rememberPassword: true, // 默认记住密码
    errorMsg: '',
    showDatabaseInit: false,
    loading: false
  },

  setErrorMsg: function(msg) {
    const text = String(msg || '');
    this.setData({
      errorMsg: text,
      showDatabaseInit: !!(text && text.indexOf('数据库') !== -1)
    });
  },

  onLoad: function() {
    console.log('登录页面加载成功');
    console.log('初始activeTab:', this.data.activeTab);
    
    // 读取本地存储的账号
    const remembered = wx.getStorageSync('remembered_account');
    if (remembered) {
      if (remembered && typeof remembered === 'object' && remembered.password) {
        try {
          wx.setStorageSync('remembered_account', { phone: remembered.phone || '' });
        } catch (_) {}
      }
      this.setData({
        phone: remembered.phone || '',
        rememberPassword: true
      });
    }
    
    // 检查是否已登录
    if (simpleLogin.isLoggedIn()) {
      console.log('用户已登录，跳转到相应页面');
      const userInfo = wx.getStorageSync('userInfo');
      const role = userInfo && userInfo.role ? String(userInfo.role).toLowerCase() : '';
      const targetUrl = role === 'operator' ? '/pages/production/production' : '/pages/workbench/workbench';
      wx.switchTab({
        url: targetUrl
      });
    }
  },

  onShow: function() {
    console.log('登录页面显示');
    console.log('当前activeTab:', this.data.activeTab);
    console.log('当前showPassword:', this.data.showPassword);
  },

  // 初始化数据库
  initDatabase: function() {
    console.log('[login] 开始初始化数据库');
    
    wx.showLoading({
      title: '正在初始化数据库...',
      mask: true
    });
    
    wx.cloud.callFunction({
      name: 'database-init',
      data: {
        action: 'init'
      }
    }).then(res => {
      if (res.result && res.result.success) {
        wx.hideLoading();
        const initPassword = res?.result?.results?.createCollections?.adminInitialPassword || '';
        const initUsername = res?.result?.results?.createCollections?.adminUsername || '13817508995';
        const content = initPassword
          ? `数据库初始化成功！请使用下面的临时管理员密码登录，并尽快修改密码。\n\n管理员账号：\n手机号：${initUsername}\n临时密码：${initPassword}`
          : '数据库初始化成功！请前往“数据库初始化工具”生成/重置管理员密码后再登录。';
        wx.showModal({
          title: '初始化成功',
          content,
          showCancel: false,
          success: () => {
            this.setData({ 
              errorMsg: '',
              showDatabaseInit: false,
              phone: initUsername,
              password: '',
              activeTab: 'password'
            });
          }
        });
      } else {
        wx.hideLoading();
        wx.showModal({
          title: '初始化失败',
          content: res.result?.error || '数据库初始化失败，请检查云函数部署状态',
          showCancel: false
        });
      }
    }).catch(err => {
      console.error('[login] 数据库初始化失败:', err);
      wx.hideLoading();
      wx.showModal({
        title: '初始化失败',
        content: '数据库初始化失败：' + err.message + '\n\n请确保已部署 database-init 云函数',
        showCancel: false
      });
    });
  },

  // 跳转到数据库初始化工具页面
  goToDbInit: function() {
    wx.navigateTo({
      url: '/pages/db-init/db-init'
    });
  },

  // 切换登录方式
  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
  },

  // 手机号输入处理
  handlePhoneInput: function(e) {
    this.setData({ phone: e.detail.value });
  },

  // 密码输入处理
  handlePasswordInput: function(e) {
    this.setData({ password: e.detail.value });
  },

  // 切换密码显示状态
  togglePassword: function() {
    this.setData({ showPassword: !this.data.showPassword });
  },

  // 切换记住密码状态
  toggleRemember: function() {
    this.setData({ rememberPassword: !this.data.rememberPassword });
  },

  handleGetPhoneNumber: function(e) {
    const detail = (e && e.detail) ? e.detail : {};
    const code = detail.code;
    const errMsg = String(detail.errMsg || '');

    try {
      const info = wx.getSystemInfoSync ? wx.getSystemInfoSync() : null;
      const platform = info && info.platform ? String(info.platform).toLowerCase() : '';
      if (platform === 'devtools') {
        wx.showModal({
          title: '提示',
          content: '微信开发者工具可能无法正常返回真实手机号。\n\n建议使用真机点击“一键登录”。',
          showCancel: false
        });
        return;
      }
    } catch (_) {}

    if (!code) {
      const lower = errMsg.toLowerCase();
      if (lower.includes('deny') || lower.includes('denied') || lower.includes('user deny')) {
        wx.showToast({ title: '已取消授权', icon: 'none' });
        return;
      }
      wx.showModal({
        title: '一键登录失败',
        content: '未获取到手机号授权结果，请用真机重试。\n\n也可以先用“密码登录”进入系统。',
        confirmText: '去密码登录',
        cancelText: '取消',
        success: (modalRes) => {
          if (modalRes && modalRes.confirm) {
            this.setData({ activeTab: 'password' });
          }
        }
      });
      return;
    }

    this.setData({ loading: true, errorMsg: '', showDatabaseInit: false });
    wx.showLoading({ title: '登录中...', mask: true });
    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'loginWithPhoneNumber',
        data: { code }
      }
    }).then(res => {
      wx.hideLoading();
      this.setData({ loading: false });
      const result = res && res.result ? res.result : null;
      const ok = result && result.success;
      if (!ok) {
        const msg = result && result.message ? String(result.message) : '登录失败';
        const errorCode = result && result.errorCode ? String(result.errorCode) : '';
        const lower = msg.toLowerCase();
        const needVerify =
          msg.includes('需要进行验证') ||
          msg.includes('完成该验证') ||
          lower.includes('need') && lower.includes('verify');
        const isDevtools =
          msg.includes('开发者工具') ||
          lower.includes('devtools') ||
          lower.includes('developer tool');

        if (errorCode === 'INVALID_CODE') {
          wx.showToast({ title: '请重新点击“一键登录”', icon: 'none' });
        } else if (errorCode === 'USER_INACTIVE') {
          wx.showModal({
            title: '账号已停用',
            content: '当前账号已停用，请联系管理员启用后再登录。',
            showCancel: false
          });
        } else if (errorCode === 'USER_NOT_FOUND') {
          wx.showModal({
            title: '手机号未开通',
            content: `${msg}\n\n也可以先用“密码登录”进入系统（管理员）。`,
            confirmText: '去密码登录',
            cancelText: '取消',
            success: (modalRes) => {
              if (modalRes && modalRes.confirm) {
                this.setData({ activeTab: 'password' });
              }
            }
          });
        } else if (errorCode === 'WECHAT_NEED_VERIFY' || needVerify) {
          wx.showModal({
            title: '手机号需要验证',
            content: '当前微信账号绑定的手机号需要先完成验证，才能一键获取。\n\n请在微信客户端完成手机号验证后重试：\n我 → 设置 → 账号与安全 → 手机号。\n\n也可以先用“密码登录”进入系统。',
            confirmText: '去密码登录',
            cancelText: '取消',
            success: (modalRes) => {
              if (modalRes && modalRes.confirm) {
                this.setData({ activeTab: 'password' });
              }
            }
          });
        } else if (errorCode === 'NO_PHONE_INFO' || msg.includes('获取手机号失败')) {
          const debug = result && result.debug ? result.debug : null;
          const debugId = debug && debug.requestId ? String(debug.requestId) : '';
          wx.showModal({
            title: '获取手机号失败',
            content: `${msg}${debugId ? `\n\n调试编号：${debugId}` : ''}\n\n排查建议：\n1）确认微信号已完成手机号验证/绑定\n2）确认小程序后台已开通“获取手机号”能力\n3）确认当前云环境与云函数已部署到同一个环境\n\n你也可以先用“密码登录”。`,
            confirmText: '知道了',
            cancelText: '取消',
            success: (modalRes) => {
              if (modalRes && modalRes.confirm) {
                this.setData({ activeTab: 'code' });
              }
            }
          });
        } else if (isDevtools) {
          wx.showModal({
            title: '一键登录失败',
            content: '微信开发者工具可能无法正常返回真实手机号，请用真机测试后重试。',
            showCancel: false
          });
        } else {
          wx.showToast({ title: msg, icon: 'none' });
        }
        return;
      }

      const payload = result && result.data ? result.data : {};
      const user = payload && payload.user ? payload.user : null;
      const token = payload && payload.token ? payload.token : '';
      const sessionId = payload && payload.sessionId ? String(payload.sessionId) : '';
      if (!user || !token) {
        wx.showToast({ title: '登录失败', icon: 'none' });
        return;
      }
      const phone = user && user.phone ? String(user.phone) : '';
      this.setData({ phone });
      simpleLogin.saveLoginInfo(user, token, sessionId);
      this.loginSuccess(user);
    }).catch(err => {
      wx.hideLoading();
      this.setData({ loading: false });
      const msg = (err && err.message) ? String(err.message) : '获取手机号失败';
      const lower = msg.toLowerCase();
      const needVerify =
        msg.includes('需要进行验证') ||
        msg.includes('完成该验证') ||
        lower.includes('need') && lower.includes('verify');
      if (needVerify) {
        wx.showModal({
          title: '手机号需要验证',
          content: '当前微信账号绑定的手机号需要先完成验证，才能一键获取。\n\n请在微信客户端完成手机号验证后重试：\n我 → 设置 → 账号与安全 → 手机号。\n\n也可以先用“密码登录”进入系统。',
          confirmText: '去密码登录',
          cancelText: '取消',
          success: (modalRes) => {
            if (modalRes && modalRes.confirm) {
              this.setData({ activeTab: 'password' });
            }
          }
        });
        return;
      }
      wx.showModal({
        title: '一键登录失败',
        content: `${msg}\n\n你可以重试，或先使用“密码登录”。`,
        confirmText: '去密码登录',
        cancelText: '取消',
        success: (modalRes) => {
          if (modalRes && modalRes.confirm) {
            this.setData({ activeTab: 'password' });
          }
        }
      });
    });
  },

  // 处理登录
  handleLogin: function() {
    console.log('开始登录处理');
    
    // 设置加载状态
    this.setData({ loading: true, errorMsg: '', showDatabaseInit: false });
    
    // 表单验证
    if (!this.data.phone) {
      this.setData({ loading: false });
      wx.showToast({ title: '请输入账号', icon: 'none' });
      return;
    }

    if (!this.data.password) {
      this.setData({ loading: false });
      wx.showToast({ title: '请输入密码', icon: 'none' });
      return;
    }

    // 密码登录 - 调用云函数验证
    this.loginWithPassword();
  },

  // 使用密码登录
  loginWithPassword: function() {
    console.log('[login] 开始密码登录');
    
    // 使用简化登录，减少中间环节
    simpleLogin.simpleLogin(this.data.phone, this.data.password)
      .then(userData => {
        // 保存登录信息
        simpleLogin.saveLoginInfo(userData.user, userData.token, userData.sessionId);
        
        // 处理记住账号
        if (this.data.rememberPassword) {
          wx.setStorageSync('remembered_account', {
            phone: this.data.phone
          });
        } else {
          wx.removeStorageSync('remembered_account');
        }

        // 处理登录成功
        this.loginSuccess(userData.user);
      })
      .catch(err => {
        console.error('[login] 登录失败:', err);
        const msg = err.message || '登录失败，请检查账号密码';
        this.setData({ 
          loading: false, 
          errorMsg: msg,
          showDatabaseInit: !!(msg && String(msg).indexOf('数据库') !== -1)
        });
        
        wx.showToast({ 
          title: err.message || '登录失败', 
          icon: 'none' 
        });
      });
  },

  // 登录成功处理
  loginSuccess: function(userInfo) {
    // 使用简化登录模块保存用户信息
    simpleLogin.saveLoginInfo(userInfo);
    
    wx.showToast({ 
      title: '登录成功',
      icon: 'success',
      duration: 1500
    });
    
    this.setData({ loading: false });
    
    const role = userInfo && userInfo.role ? String(userInfo.role).toLowerCase() : '';
    const targetUrl = role === 'operator' ? '/pages/production/production' : '/pages/workbench/workbench';

    setTimeout(() => {
      const next = `/pages/system-sub/sync-loading/sync-loading?targetUrl=${encodeURIComponent(targetUrl)}`;
      wx.redirectTo({
        url: next,
        fail: () => {
          wx.reLaunch({ url: next });
        }
      })
    }, 1500);
  },
  onUnload: function() {}
});
