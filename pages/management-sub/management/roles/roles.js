// pages/management/roles/roles.js
Page({
  data: {
    roles: [
      { id: 1, name: '管理员', description: '拥有系统全部权限' },
      { id: 2, name: '操作员', description: '可以操作系统核心功能' },
      { id: 3, name: '普通用户', description: '只能查看基础信息' }
    ]
  },

  onLoad: function (options) {
    // 页面加载时检查权限
    const app = getApp();
    if (!app.globalData.checkPermission('admin')) {
      wx.showToast({
        title: '无权限访问',
        icon: 'none',
        duration: 2000
      });
      setTimeout(() => {
        wx.navigateBack();
      }, 2000);
      return;
    }
  },

  editRole: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.showToast({
      title: '编辑角色权限 ID: ' + id,
      icon: 'none'
    });
  }
});