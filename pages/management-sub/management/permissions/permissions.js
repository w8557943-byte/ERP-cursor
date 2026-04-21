// pages/management/permissions/permissions.js
Page({
  data: {
    employees: [
      { id: 1, name: '张三', role: '管理员' },
      { id: 2, name: '李四', role: '操作员' },
      { id: 3, name: '王五', role: '普通用户' }
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

  addEmployee: function() {
    wx.showToast({
      title: '新增员工功能',
      icon: 'none'
    });
  },

  editEmployee: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.showToast({
      title: '编辑员工功能 ID: ' + id,
      icon: 'none'
    });
  },

  deleteEmployee: function(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '确认删除',
      content: '确定要删除该员工吗？',
      success: (res) => {
        if (res.confirm) {
          // 这里应该调用API删除员工
          wx.showToast({
            title: '删除成功',
            icon: 'success'
          });
          
          // 更新本地数据
          const employees = this.data.employees.filter(emp => emp.id != id);
          this.setData({
            employees: employees
          });
        }
      }
    });
  }
});