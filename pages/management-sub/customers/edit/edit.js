Page({
  data: {
    entityType: 'customer',
    entityId: '',
    pageTitle: '编辑客户',
    pageSubTitle: '修改客户档案信息',
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
    const title = entityType === 'supplier' ? '编辑供应商' : '编辑客户';
    const sub = entityType === 'supplier' ? '修改供应商档案信息' : '修改客户档案信息';

    const loadData = () => {
      if (options && options.key) {
        try {
          const v = wx.getStorageSync(options.key);
          if (v && typeof v === 'object') {
            try { wx.removeStorageSync(options.key); } catch (_) {}
            return v;
          }
        } catch (_) {}
      }
      try {
        if (entityType === 'supplier' && options && options.supplierData) {
          return JSON.parse(decodeURIComponent(options.supplierData));
        }
        if (entityType === 'customer' && options && options.customerData) {
          return JSON.parse(decodeURIComponent(options.customerData));
        }
      } catch (_) {}
      return null;
    };
    const raw = loadData();

    const entityId =
      (raw && (raw.docId || raw._id || raw.id)) ||
      (options && (options.docId || options._id || options.id)) ||
      '';

    const mapped =
      entityType === 'supplier'
        ? {
            name: (raw && raw.name) || '',
            shortName: (raw && raw.shortName) || '',
            contactName: (raw && (raw.contactName || raw.contact)) || '',
            phone: (raw && raw.phone) || '',
            industry: (raw && raw.industry) || '',
            status: (raw && raw.status) || 'active'
          }
        : {
            name: (raw && (raw.name || raw.companyName)) || '',
            shortName: (raw && raw.shortName) || '',
            paymentTerms: (raw && raw.paymentTerms) || '现结',
            contactName: (raw && (raw.contactName || raw.contact)) || '',
            phone: (raw && raw.phone) || '',
            email: (raw && raw.email) || '',
            address: (raw && raw.address) || '',
            status: (raw && raw.status) || 'active'
          };

    this.setData({
      entityType,
      entityId: String(entityId || ''),
      pageTitle: title,
      pageSubTitle: sub,
      form: Object.assign({}, this.data.form, mapped)
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
    const entityId = String(this.data.entityId || '').trim();
    if (!entityId) {
      wx.showToast({ title: '缺少ID，无法保存', icon: 'none' });
      return;
    }

    const form = this.data.form || {};
    const name = String(form.name || '').trim();
    if (!name) {
      wx.showToast({ title: entityType === 'supplier' ? '请输入供应商名称' : '请输入客户名称', icon: 'none' });
      return;
    }

    const action = entityType === 'supplier' ? 'updateSupplier' : 'updateCustomer';
    const payload =
      entityType === 'supplier'
        ? {
            _id: entityId,
            name,
            shortName: String(form.shortName || '').trim(),
            contactName: String(form.contactName || '').trim(),
            phone: String(form.phone || '').trim(),
            industry: String(form.industry || '').trim(),
            status: form.status || 'active'
          }
        : {
            docId: entityId,
            name,
            shortName: String(form.shortName || '').trim(),
            paymentTerms: form.paymentTerms || '现结',
            contactName: String(form.contactName || '').trim(),
            phone: String(form.phone || '').trim(),
            email: String(form.email || '').trim(),
            address: String(form.address || '').trim(),
            status: form.status || 'active'
          };

    this.setData({ saving: true });
    wx.cloud
      .callFunction({
        name: 'erp-api',
        data: { action, data: payload }
      })
      .then((res) => {
        const result = res && res.result ? res.result : {};
        if (result.success) {
          wx.showToast({ title: '保存成功', icon: 'success' });
          setTimeout(() => wx.navigateBack({ delta: 1 }), 500);
          return;
        }
        wx.showToast({ title: result.message || '保存失败', icon: 'none' });
      })
      .catch((err) => {
        wx.showToast({ title: err.message || '保存失败', icon: 'none' });
      })
      .finally(() => {
        this.setData({ saving: false });
      });
  }
});
