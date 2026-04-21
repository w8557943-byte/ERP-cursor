const app = getApp();

const UNIT_OPTIONS = ['个', '件', '套', '箱', 'kg', 'm', 'm²', 'm³', '吨', '升', '包', '卷', '张', '双', '台'];

Page({
  data: {
    form: {
      supplierName: '',
      goodsName: '',
      materialNo: '', // 规格型号
      quantity: '',
      unit: '',
      salePrice: '', // 进货单价
      notes: ''
    },
    amount: '0.00', // Purchase Amount
    unitOptions: UNIT_OPTIONS,
    unitIndex: -1,
    suppliers: [],
    supplierNames: [],
    supplierAutocomplete: [],
    showSupplierAutocomplete: false
  },

  onLoad: function(options) {
    this.loadSuppliers();
  },

  onInput: function(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    
    this.setData({
      [`form.${field}`]: value
    });

    if (field === 'quantity' || field === 'salePrice') {
      this.calculateAmount();
    }
  },

  onUnitChange: function(e) {
    const index = e.detail.value;
    this.setData({
      unitIndex: index,
      'form.unit': this.data.unitOptions[index]
    });
  },

  calculateAmount: function() {
    const { quantity, salePrice } = this.data.form;
    const qty = parseFloat(quantity) || 0;
    const price = parseFloat(salePrice) || 0;
    const amount = (qty * price).toFixed(2);
    this.setData({ amount });
  },

  validate: function() {
    const { supplierName, goodsName, quantity, salePrice } = this.data.form;
    const sName = (supplierName || '').trim();
    if (!sName) return '请选择供应商名称';
    const suppliers = Array.isArray(this.data.suppliers) ? this.data.suppliers : [];
    const hasSupplier = suppliers.some(s => {
      const name = s.name;
      return name && String(name).trim() === sName;
    });
    if (!hasSupplier) return '请从供应商名录中选择供应商';
    if (!goodsName) return '请输入商品名称';
    if (!quantity || parseFloat(quantity) <= 0) return '请输入有效的采购数量';
    if (!salePrice || parseFloat(salePrice) < 0) return '请输入有效的进货单价';
    return null;
  },

  loadSuppliers: function() {
    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'getSuppliers',
        params: { page: 1, limit: 200 }
      }
    }).then(res => {
      const result = res && res.result ? res.result : {};
      const raw = Array.isArray(result.data)
        ? result.data
        : Array.isArray(result.suppliers)
          ? result.suppliers
          : [];
      const suppliers = raw.map(s => ({
        id: s._id || s.id,
        name: s.name,
        contactName: s.contactName || '',
        phone: s.phone || ''
      }));
      const supplierNames = suppliers
        .map(s => s.name || '')
        .filter(n => n && String(n).trim());
      this.setData({ suppliers, supplierNames });
    }).catch(() => {
      this.setData({ suppliers: [], supplierNames: [] });
    });
  },

  onSupplierPickerChange: function(e) {
    const index = Number(e.detail.value);
    const selected = this.data.suppliers[index];
    if (!selected) return;
    this.setData({
      'form.supplierName': selected.name || ''
    });
  },

  updateSupplierAutocomplete: function(value) {
    const kw = (value || '').trim().toLowerCase();
    if (!kw) {
      this.setData({
        showSupplierAutocomplete: false,
        supplierAutocomplete: []
      });
      return;
    }
    const seen = new Set();
    const list = (this.data.suppliers || []).filter(s => {
      const name = String(s.name || '').toLowerCase();
      const contact = String(s.contactName || '').toLowerCase();
      const phone = String(s.phone || '').toLowerCase();
      const match = name.includes(kw) || contact.includes(kw) || phone.includes(kw);
      if (!match) return false;
      if (seen.has(s.id || s.name)) return false;
      seen.add(s.id || s.name);
      return true;
    });
    this.setData({
      supplierAutocomplete: list,
      showSupplierAutocomplete: list.length > 0
    });
  },

  onSupplierFocus: function() {
    if ((this.data.supplierAutocomplete || []).length > 0) {
      this.setData({ showSupplierAutocomplete: true });
    }
  },

  onSupplierBlur: function() {
    setTimeout(() => {
      this.setData({ showSupplierAutocomplete: false });
    }, 150);
  },

  onSupplierSelect: function(e) {
    const name = e.currentTarget.dataset.name;
    this.setData({
      'form.supplierName': name,
      showSupplierAutocomplete: false
    });
  },

  goBack: function() {
    wx.navigateBack();
  },

  submitForm: function() {
    const error = this.validate();
    if (error) {
      wx.showToast({ title: error, icon: 'none' });
      return;
    }

    wx.showLoading({ title: '提交中...', mask: true });

    const { form, amount } = this.data;
    const payload = {
      supplierName: form.supplierName,
      productTitle: form.goodsName,
      materialNo: form.materialNo,
      quantity: Number(form.quantity),
      unit: form.unit,
      salePrice: Number(form.salePrice),
      unitPrice: Number(form.salePrice), // For raw materials, unitPrice is often same as cost or N/A
      amount: Number(amount),
      source: 'purchased',
      purchaseCategory: 'raw_materials',
      orderType: 'purchase',
      status: 'ordered',
      createdAt: new Date().toISOString(),
      notes: form.notes
    };

    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'createPurchaseOrder',
        data: payload
      }
    }).then(res => {
      wx.hideLoading();
      if (res.result && (res.result.orderNo || res.result.success || res.result._id)) {
        wx.showToast({ title: '创建成功', icon: 'success' });
        setTimeout(() => {
          wx.navigateBack();
        }, 1500);
      } else {
        wx.showToast({ title: (res.result && res.result.message) || '创建失败', icon: 'none' });
      }
    }).catch(err => {
      wx.hideLoading();
      console.error(err);
      wx.showToast({ title: '提交出错', icon: 'none' });
    });
  }
});
