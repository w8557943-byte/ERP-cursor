const app = getApp();

Page({
  data: {
    result: '',
    loading: false
  },

  onLoad: function() {
    console.log('数据库初始化页面加载');
  },

  // 初始化数据库
  initDatabase: function() {
    console.log('[测试页面] 开始初始化数据库');
    
    this.setData({ 
      loading: true, 
      result: '正在初始化数据库...\n' 
    });

    wx.cloud.callFunction({
      name: 'database-init',
      data: {
        action: 'init'
      }
    }).then(res => {
      if (res.result && res.result.success) {
        const initPassword = res?.result?.results?.createCollections?.adminInitialPassword || '';
        const initUsername = res?.result?.results?.createCollections?.adminUsername || '13817508995';
        const adminText = initPassword
          ? `管理员账号：\n手机号：${initUsername}\n临时密码：${initPassword}\n\n请尽快登录后修改密码。\n`
          : '管理员账号已准备就绪，请使用“重置管理员密码”生成临时密码后登录。\n';
        this.setData({ 
          result: this.data.result + '\n✅ 数据库初始化成功！\n\n' + 
                 adminText +
                 '请返回登录页面重新登录。'
        });
      } else {
        this.setData({ 
          result: this.data.result + '\n❌ 数据库初始化失败！\n\n' + 
                 '错误：' + (res.result?.error || '未知错误') + '\n\n' +
                 '请检查 cloudfunctions/database-init 云函数是否已部署。'
        });
      }
    }).catch(err => {
      console.error('[测试页面] 初始化失败:', err);
      this.setData({ 
        result: this.data.result + '\n❌ 云函数调用失败！\n\n' + 
               '错误：' + err.message + '\n\n' +
               '请检查：\n' +
               '1. 是否已部署 database-init 云函数\n' +
               '2. 云开发环境是否正确配置\n' +
               '3. 是否有足够的权限'
      });
    }).finally(() => {
      this.setData({ loading: false });
    });
  },

  // 清空结果
  clearResult: function() {
    this.setData({ result: '' });
  },

  // 验证数据库设置
  validateSetup: function() {
    this.setData({ 
      loading: true, 
      result: '正在验证数据库设置...\n' 
    });

    wx.cloud.callFunction({
      name: 'database-init',
      data: {
        action: 'validate_setup'
      }
    }).then(res => {
      if (res.result && res.result.success) {
        this.setData({ 
          result: this.data.result + '\n✅ 数据库验证完成！\n\n' + 
                 JSON.stringify(res.result, null, 2)
        });
      } else {
        this.setData({ 
          result: this.data.result + '\n❌ 数据库验证失败！\n\n' + 
                 '错误：' + (res.result?.error || '未知错误')
        });
      }
    }).catch(err => {
      console.error('[测试页面] 验证失败:', err);
      this.setData({ 
        result: this.data.result + '\n❌ 验证过程失败！\n\n' + 
               '错误：' + err.message
      });
    }).finally(() => {
      this.setData({ loading: false });
    });
  },

  resetAdminPassword: function() {
    wx.showModal({
      title: '重置管理员密码',
      content: '将为管理员账号生成新的临时密码（加密存储）。是否继续？',
      success: (res) => {
        if (!res.confirm) return;

        this.setData({
          loading: true,
          result: '正在重置管理员密码...\n'
        });

        wx.cloud.callFunction({
          name: 'database-init',
          data: {
            action: 'reset_admin_password',
            data: {
              username: '13817508995'
            }
          }
        }).then((resp) => {
          const r = resp && resp.result ? resp.result : {};
          if (r.success) {
            const newPassword = (r && r.data && r.data.newPassword) ? String(r.data.newPassword) : '';
            let msg = '\n✅ 管理员密码已重置。\n\n' +
                '账号：13817508995\n' +
                (newPassword ? `临时密码：${newPassword}\n\n` : '');
            
            if (r.data && r.data.deletedCount > 0) {
              msg += `⚠️ 已自动清理 ${r.data.deletedCount} 个重复/异常账号。\n\n`;
            }
            
            if (r.data && r.data.action === 'created') {
              msg += 'ℹ️ 原账号不存在，已自动创建新账号。\n\n';
            }
            
            this.setData({
              result: this.data.result + msg + JSON.stringify({ ...r, data: { ...(r.data || {}), newPassword: newPassword ? '[redacted]' : '' } }, null, 2)
            });
            return;
          }
          this.setData({
            result: this.data.result + '\n❌ 重置失败：' + (r.error || r.message || '未知错误')
          });
        }).catch((err) => {
          this.setData({
            result: this.data.result + '\n❌ 云函数调用失败：' + ((err && err.message) ? err.message : '未知错误')
          });
        }).finally(() => {
          this.setData({ loading: false });
        });
      }
    });
  },

  // 返回登录页
  goBack: function() {
    wx.navigateBack();
  }
});
