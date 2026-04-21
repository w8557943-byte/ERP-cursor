Page({
  data: {
    entityType: 'customer',
    pageTitle: '新增客户',
    pageSubTitle: '创建客户档案与结款方式',
    submitText: '创建',
    saving: false,
    paymentOptions: ['现结', '月结30天', '月结60天', '月结90天', '月结105天'],
    form: {
      name: '',
      shortName: '',
      paymentTerms: '现结',
      contactName: '',
      phone: '',
      email: '',
      address: '',
      industry: '',
      status: 'active'
    }
  },

  onLoad: function(options) {
    const type = options && options.type ? String(options.type) : 'customer';
    const entityType = type === 'supplier' ? 'supplier' : 'customer';
    const title = entityType === 'supplier' ? '新增供应商' : '新增客户';
    const sub = entityType === 'supplier' ? '创建供应商档案与联系人信息' : '创建客户档案与结款方式';
    this.setData({
      entityType,
      pageTitle: title,
      pageSubTitle: sub
    });
    wx.setNavigationBarTitle({ title });
  },

  onFormInput: function(e) {
    const field = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.field : '';
    const value = e && e.detail ? e.detail.value : '';
    if (!field) return;
    this.setData({ [`form.${field}`]: value });
  },

  onPaymentChange: function(e) {
    const idx = e && e.detail ? Number(e.detail.value) : NaN;
    const options = this.data.paymentOptions || [];
    const value = Number.isFinite(idx) && options[idx] ? options[idx] : '';
    this.setData({ ['form.paymentTerms']: value });
  },

  onStatusSwitch: function(e) {
    const checked = e && e.detail ? !!e.detail.value : false;
    this.setData({ ['form.status']: checked ? 'active' : 'inactive' });
  },

  onCancel: function() {
    wx.navigateBack({ delta: 1 });
  },

  onSubmit: function() {
    if (this.data.saving) return;

    const entityType = this.data.entityType;
    const form = this.data.form || {};

    const name = String(form.name || '').trim();
    if (!name) {
      wx.showToast({ title: entityType === 'supplier' ? '请输入供应商名称' : '请输入客户名称', icon: 'none' });
      return;
    }

    const contactName = String(form.contactName || '').trim();
    if (entityType === 'customer' && !contactName) {
      wx.showToast({ title: '请输入联系人', icon: 'none' });
      return;
    }

    const action = entityType === 'supplier' ? 'createSupplier' : 'createCustomer';
    const payload =
      entityType === 'supplier'
        ? {
            name,
            shortName: String(form.shortName || '').trim(),
            contactName,
            phone: String(form.phone || '').trim(),
            industry: String(form.industry || '').trim(),
            status: form.status || 'active'
          }
        : {
            name,
            shortName: String(form.shortName || '').trim(),
            paymentTerms: form.paymentTerms || '现结',
            contactName,
            phone: String(form.phone || '').trim(),
            email: String(form.email || '').trim(),
            address: String(form.address || '').trim(),
            status: form.status || 'active'
          };

    this.setData({ saving: true, submitText: '提交中...' });
    wx.cloud
      .callFunction({
        name: 'erp-api',
        data: { action, data: payload }
      })
      .then((res) => {
        const result = res && res.result ? res.result : {};
        if (result.success) {
          wx.showToast({ title: entityType === 'supplier' ? '供应商创建成功' : '客户创建成功', icon: 'success' });
          setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
          return;
        }
        wx.showToast({ title: result.message || '保存失败', icon: 'none' });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ saving: false, submitText: '创建' });
      });
  }
});
