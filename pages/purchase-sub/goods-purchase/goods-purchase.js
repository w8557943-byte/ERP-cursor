const app = getApp();

const UNIT_OPTIONS = ['个', '件', '套', '箱', 'kg', 'm', 'm²', 'm³', '吨', '升', '包', '卷', '张', '双', '台'];

Page({
  data: {
    form: {
      orderNo: '', // Auto-generated or placeholder
      customerName: '',
      supplierName: '',
      goodsName: '',
      materialNo: '', // 规格型号
      quantity: '',
      unit: '', // Selected unit
      salePrice: '', // 进货单价 (Purchase Price)
      unitPrice: '', // 销售单价 (Selling Price)
      notes: ''
    },
    amount: '0.00', // Purchase Amount (quantity * salePrice)
    unitOptions: UNIT_OPTIONS,
    unitIndex: -1,
    generating: false,
    reservationId: '',
    customers: [],
    customerNames: [],
    suppliers: [],
    supplierNames: [],
    supplierAutocomplete: [],
    showSupplierAutocomplete: false
  },

  onLoad: function(options) {
    this.reserveOrderNumber();
    this.loadSuppliers();
    this.loadCustomers();
  },

  reserveOrderNumber: function() {
    if (this.data.generating) return;
    this.setData({ generating: true });
    wx.cloud.callFunction({
      name: 'erp-api',
      data: { action: 'reserveOrderNumber' }
    }).then(res => {
      const payload = (res && res.result && res.result.data) ? res.result.data : (res && res.result ? res.result : {});
      const no = payload && (payload.orderNumber || payload.orderNo || '');
      const rid = payload && (payload.reservationId || '');
      if (no) {
        this.setData({
          'form.orderNo': no,
          reservationId: rid,
          generating: false
        });
        return;
      }
      this.setData({ generating: false });
      wx.showToast({ title: '生成订单号失败', icon: 'none' });
    }).catch(() => {
      this.setData({ generating: false });
      wx.showToast({ title: '生成订单号失败', icon: 'none' });
    });
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
    const { customerName, supplierName, goodsName, quantity, salePrice } = this.data.form;
    const cName = (customerName || '').trim();
    const sName = (supplierName || '').trim();
    if (!cName) return '请输入客户名称';
    if (!sName) return '请输入供应商名称';
    const customers = Array.isArray(this.data.customers) ? this.data.customers : [];
    const suppliers = Array.isArray(this.data.suppliers) ? this.data.suppliers : [];
    const hasCustomer = customers.some(c => {
      const name = c.companyName || c.name || c.company;
      return name && String(name).trim() === cName;
    });
    if (!hasCustomer) return '请从客户名录中选择客户';
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

  loadCustomers: function() {
    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'getCustomers',
        params: { page: 1, limit: 200 }
      }
    }).then(res => {
      const result = res && res.result ? res.result : {};
      const raw = Array.isArray(result.data)
        ? result.data
        : Array.isArray(result.customers)
          ? result.customers
          : [];
      const customers = raw.map(c => ({
        id: c._id || c.id,
        name: c.companyName || c.name || c.company || '',
        contactName: c.contactName || c.contact || '',
        phone: c.phone || ''
      }));
      const customerNames = customers
        .map(c => c.name || '')
        .filter(n => n && String(n).trim());
      this.setData({ customers, customerNames });
    }).catch(() => {
      this.setData({ customers: [], customerNames: [] });
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

  onCustomerPickerChange: function(e) {
    const index = Number(e.detail.value);
    const selected = this.data.customers[index];
    if (!selected) return;
    this.setData({
      'form.customerName': selected.name || ''
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
      orderNo: form.orderNo, // Ideally backend handles this if empty
      customerName: form.customerName,
      supplierName: form.supplierName,
      productTitle: form.goodsName,
      materialNo: form.materialNo,
      quantity: Number(form.quantity),
      unit: form.unit,
      salePrice: Number(form.salePrice), // 进价
      unitPrice: Number(form.unitPrice), // 售价
      amount: Number(amount),
      items: [{
        goodsName: form.goodsName,
        materialNo: form.materialNo,
        quantity: Number(form.quantity),
        unit: form.unit,
        unitPrice: Number(form.salePrice)
      }],
      source: 'purchased',
      purchaseCategory: 'goods',
      orderType: 'purchase',
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
