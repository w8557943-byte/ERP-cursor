// 将以下完整代码替换整个create.js文件内容

// 通用订单创建页面
Page({
  data: {
    isEdit: false,
    orderId: null,
    orderNumber: '',
    submitting: false,
    isNoCreasing: false,

    // 表单数据
    formData: {
      customer: {
        name: '',
        contact: ''
      },
      supplier: {
        name: '',
        contact: ''
      },
      product: {
        name: '',
        title: '',
        spec: '',
        sheetCount: '',
        quantity: 0,
        unit: '份',
        unitPrice: 0,
        flute: '',
        materialCode: '',
        materialNo: '',
        boardWidth: '',
        boardHeight: '',
        creasing: '',
        creasingSize1: '',
        creasingSize2: '',
        creasingSize3: ''
      },
      joinMethod: '',
      amount: {
        total: 0,
        deposit: 0,
        balance: 0
      },
      deliveryDate: '',
      priority: 'normal',
      notes: '',
      attachments: []
    },

    // 计算结果
    calculatedAmount: '0.00',
    calculatedBalance: '0.00',

    // 加载状态
    submitting: false,
    uploadLoading: false,
    qrCodeUrl: '',
    reservationId: '',

    // 选择器数据
    units: ['个', '只', '片', '箱'],
    unitIndex: 0,
    priorities: ['urgent', 'high', 'normal', 'low'],
    prioritiesText: ['紧急', '高优先级', '普通', '低优先级'],
    priorityIndex: 2,

    // 新增选择器数据（集成新增功能）
    customers: [],
    customerNames: [],
    selectedCustomerId: null,
    customerHistory: [
      { name: '客户A公司', contact: '张经理' },
      { name: '客户B公司', contact: '李总' },
      { name: '客户C公司', contact: '王主管' }
    ],
    customerIndex: 0,
    productHistory: [
      { name: '瓦楞纸箱', spec: '300*200*150mm' },
      { name: '彩盒', spec: '250*180*80mm' },
      { name: '礼品盒', spec: '200*150*100mm' }
    ],
    productIndex: 0,
    specHistory: ['300*200*150', '250*180*80', '200*150*100', '400*300*200'],
    specIndex: 0,
    supplierHistory: [
      { name: '供应商A公司', contact: '赵经理' },
      { name: '供应商B公司', contact: '钱总' },
      { name: '供应商C公司', contact: '孙主管' }
    ],
    supplierIndex: 0,
    fluteHistory: ['A楞', 'B楞', 'C楞', 'E楞', 'AB楞', 'BC楞'],
    flutePresets: ['AB楞', 'A楞', 'B楞', 'EB楞', 'E楞', '新增楞型'],
    fluteIndex: 0,
    materialHistory: ['K=K', 'A=A', 'B=B', 'C=C', 'K3K', 'A3A'],
    materialIndex: 0,
    creasingHistory: ['凹凸压线', '平压线', '无压线'],
    creasingIndex: 0,
    joinMethodPresets: ['打钉', '粘胶', '新增拼接方式'],
    showFlutePicker: false,
    showCreasingPicker: false,
    showJoinPicker: false,
    creatingNewFlute: false,
    creatingNewCreasing: false,
    creatingNewJoin: false,
    flutePickerIndex: 0,
    creasingPickerIndex: 0,
    joinPickerIndex: 0,
    simplePriorities: ['急', '正常'],
    simplePriorityIndex: 1,
    productPresets: ['纸箱', '隔板', '天地盒', '飞机盒', '异性纸盒', '新增品类'],
    creatingNewProduct: false,
    suppliers: [],
    supplierNames: [],

    // 自动补全显示状态
    showCustomerAutocomplete: false,
    showProductAutocomplete: false,
    showSupplierAutocomplete: false,
    showPriorityAutocomplete: false,

    // 错误提示状态
    customerError: '',
    productError: '',
    supplierError: ''
  },

  onLoad: function (options) {
    // 检查是否为编辑模式
    if (options.orderId) {
      this.setData({ isEdit: true, orderId: options.orderId });
      this.loadOrderData(options.orderId);
    }
    this.loadCustomers();
    this.loadSuppliers();
    this.loadProductCategories();
    // 检查是否有订单数据传入（从详情页编辑）
    const loadEditData = () => {
      if (options.orderKey) {
        try {
          const raw = wx.getStorageSync(options.orderKey);
          if (raw && typeof raw === 'object') {
            try { wx.removeStorageSync(options.orderKey); } catch (_) {}
            return raw;
          }
        } catch (_) {}
      }
      if (options.orderData) {
        try {
          return JSON.parse(decodeURIComponent(options.orderData));
        } catch (_) {}
      }
      return null;
    };
    const editData = loadEditData();
    if (editData) {
      this.setData({
        isEdit: true,
        orderId: editData.orderNo,
        formData: {
          customer: editData.customer,
          product: editData.product,
          amount: editData.amount,
          deliveryDate: editData.deadline,
          priority: editData.priority,
          notes: editData.notes,
          attachments: editData.attachments || []
        }
      });
      this.setData({
        unitIndex: this.data.units.indexOf(editData.product?.unit) || 0,
        priorityIndex: this.data.priorities.indexOf(editData.priority) || 2
      });
      this.calculateAmount();
      this.calculateBalance();
    }

    // 从本地存储加载历史数据
    this.loadHistoryData();

    // 设置默认交货日期为3天后
    const defaultDeadline = this.getDefaultDeliveryDate();

    // 初始化数据
    this.setData({
      unitIndex: 0,
      'formData.deliveryDate': defaultDeadline,
      'formData.product.unit': this.data.units[0],
      'formData.product.creasing': '无压线',
      isNoCreasing: true
    });

    // 打开新建页面预约订单号（服务端保留，可取消释放）
    if (!this.data.isEdit) {
      this.reserveOrderNumber();
    }
  },

  onShow: function () {
    if (!this.data.isEdit && !this.data.orderNumber) {
      this.reserveOrderNumber();
    }
  },

  // 提取预约订单号逻辑
  reserveOrderNumber: function () {
    if (this.data.generating) return;
    this.setData({ generating: true });

    wx.cloud.callFunction({ name: 'erp-api', data: { action: 'reserveOrderNumber' } })
      .then(res => {
        console.log('[create] reserveOrderNumber result:', res);
        const payload = (res && res.result && res.result.data) ? res.result.data : (res && res.result ? res.result : {});
        const no = payload?.orderNumber || payload?.orderNo || '';
        const rid = payload?.reservationId || '';
        if (no) {
          this.setData({ orderNumber: no, qrCodeUrl: '', reservationId: rid, generating: false });
          return;
        }
        // 如果reserveOrderNumber没有返回号码，尝试直接生成
        throw new Error('No order number returned. Result: ' + JSON.stringify(res.result));
      })
      .catch(err => {
        console.error('预约订单号失败，尝试直接生成:', err);
        wx.cloud.callFunction({ name: 'erp-api', data: { action: 'generateOrderNumber' } })
          .then(r => {
            console.log('[create] generateOrderNumber fallback result:', r);
            const p2 = (r && r.result && r.result.data) ? r.result.data : (r && r.result ? r.result : {});
            const n2 = p2?.orderNumber || p2?.orderNo || '';
            if (n2) {
              this.setData({ orderNumber: n2, qrCodeUrl: '', generating: false });
            } else {
              this.setData({ generating: false });
              wx.showToast({ title: '无法生成订单号，请重试', icon: 'none' });
            }
          })
          .catch(e => {
            console.error('生成订单号失败:', e);
            this.setData({ generating: false });
            wx.showToast({ title: '生成订单号失败', icon: 'none' });
          });
      });
  },

  onFlutePresetChange: function (e) {
    const index = Number(e.detail.value);
    const val = this.data.flutePresets[index];
    if (val === '新增楞型') {
      this.setData({ creatingNewFlute: true, 'formData.product.flute': '' });
      return;
    }
    this.setData({ creatingNewFlute: false, 'formData.product.flute': val });
  },

  onCreasingPresetChange: function (e) {
    const index = Number(e.detail.value);
    const val = this.data.creasingHistory[index];
    if (val === '新增压线方式') {
      this.setData({ creatingNewCreasing: true, 'formData.product.creasing': '' });
      return;
    }
    const no = val === '无压线';
    const next = { 'formData.product.creasing': val };
    if (no) {
      next['formData.product.creasingSize1'] = '';
      next['formData.product.creasingSize2'] = '';
      next['formData.product.creasingSize3'] = '';
    }
    this.setData({ ...next, creatingNewCreasing: false, isNoCreasing: no });
  },

  onJoinMethodPresetChange: function (e) {
    const index = Number(e.detail.value);
    const val = this.data.joinMethodPresets[index];
    if (val === '新增拼接方式') {
      this.setData({ creatingNewJoin: true, 'formData.joinMethod': '' });
      return;
    }
    this.setData({ creatingNewJoin: false, 'formData.joinMethod': val });
  },

  // 工具函数：获取选择器显示文本
  getPickerText: function (array, index, placeholder = '请选择...', fieldValue = null) {
    if (fieldValue !== null && fieldValue !== undefined && fieldValue !== '') {
      return fieldValue;
    }

    if (!array || index === undefined || index === null || index < 0 || index >= array.length) {
      return placeholder;
    }

    const item = array[index];
    if (!item) return placeholder;

    if (item === '新增' || (typeof item === 'object' && item.name === '新增')) {
      return placeholder;
    }

    if (typeof item === 'object') {
      return item.name || placeholder;
    }
    return item || placeholder;
  },

  // 获取默认交货时间（下单后第三天）
  getDefaultDeliveryDate: function () {
    const date = new Date();
    date.setDate(date.getDate() + 3);
    return date.toISOString().split('T')[0];
  },

  loadOrderData: async function (orderId) {
    const cloud = require('../../../utils/cloud.js');
    let docId = orderId;
    try {
      let res = await cloud.callERPAPI('getOrderDetail', { id: docId });
      let data = res && res.data ? res.data : null;
      if (!data && /^ORD/.test(orderId)) {
        const db = wx.cloud.database();
        const cmd = db.command;
        const q = await db.collection('orders').where({ orderNo: orderId }).limit(1).get();
        if (q.data && q.data.length) {
          docId = q.data[0]._id;
          const r2 = await cloud.callERPAPI('getOrderDetail', { id: docId });
          data = r2 && r2.data ? r2.data : null;
        }
      }
      if (!data) return;
      const item = Array.isArray(data.items) && data.items.length ? data.items[0] : {};
      const sheetCountVal = item.sheetCount !== undefined ? item.sheetCount : data.sheetCount;
      const fd = {
        customer: { name: data.customerName || '', contact: data.contactName || '' },
        supplier: { name: data.supplierName || (data.supplier && data.supplier.name) || '', contact: (data.supplier && data.supplier.contact) || '' },
        product: {
          name: item.name || data.productName || '',
          spec: item.spec || '',
          sheetCount: sheetCountVal !== undefined && sheetCountVal !== null ? sheetCountVal : '',
          quantity: (item.quantity || data.quantity || 0),
          unit: item.unit || '份',
          unitPrice: item.unitPrice || 0,
          flute: data.flute || '',
          materialCode: data.materialCode || '',
          boardWidth: data.boardWidth || '',
          boardHeight: data.boardHeight || '',
          creasing: data.creasingType || '',
          creasingSize1: data.creasingSize1 || '',
          creasingSize2: data.creasingSize2 || '',
          creasingSize3: data.creasingSize3 || ''
        },
        joinMethod: data.joinMethod || '',
        amount: {
          total: Number(data.totalAmount) || Number(data.amount) || 0,
          deposit: Number(data.deposit) || 0,
          balance: (Number(data.totalAmount) || Number(data.amount) || 0) - (Number(data.deposit) || 0)
        },
        deliveryDate: data.deliveryDate ? new Date(data.deliveryDate).toISOString().split('T')[0] : '',
        priority: data.priority || 'normal',
        notes: data.notes || '',
        attachments: data.attachments || []
      };
      const presets = this.data.creasingHistory || ['凹凸压线', '平压线', '无压线'];
      const cr = String(fd.product.creasing || '');
      const valid = presets.indexOf(cr) !== -1;
      fd.product.creasing = valid ? cr : '';
      const isNo = fd.product.creasing === '无压线';
      this.setData({
        formData: fd,
        unitIndex: this.data.units.indexOf(fd.product.unit),
        priorityIndex: this.data.priorities.indexOf(fd.priority),
        orderNumber: data.orderNumber || data.orderNo || orderId,
        qrCodeUrl: data.qrCodeUrl || '',
        selectedCustomerId: data.customerId || null,
        isNoCreasing: isNo
      });
    } catch (e) {
    }
  },

  onFluteChange: function (e) {
    const index = Number(e.detail.value);
    const val = this.data.flutePresets[index];
    this.setData({ 'formData.product.flute': val });
  },

  // 输入框变化处理
  onInputChange: function (e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;

    this.setData({
      [`formData.${field}`]: value
    });

    // 保存到历史记录
    this.saveToHistory(field, value);

    if (field === 'product.quantity' || field === 'product.unitPrice') {
      this.calculateAmount();
      this.calculateBalance(); // 重新计算尾款
    }

    if (field === 'amount.deposit') {
      this.calculateBalance();
    }
  },

  // 选择器变化处理
  onPickerChange: function (e) {
    const field = e.currentTarget.dataset.field;
    const index = e.detail.value;

    if (field === 'product.unit') {
      this.setData({
        unitIndex: index,
        'formData.product.unit': this.data.units[index]
      });
    } else if (field === 'priority') {
      this.setData({
        priorityIndex: index,
        'formData.priority': this.data.priorities[index]
      });
    }
  },

  // 客户名称输入处理
  onCustomerInput: function (e) {
    const value = e.detail.value;

    // 清除之前的错误提示
    this.setData({
      'formData.customer.name': value,
      customerError: ''
    });

    const matchedCustomer = this.data.customerHistory.find(customer => customer.name === value);
    if (matchedCustomer) {
      this.setData({
        'formData.customer.contact': matchedCustomer.contact
      });
    }

    if (value.length > 0) {
      this.setData({
        showCustomerAutocomplete: true
      });
    } else {
      this.setData({
        showCustomerAutocomplete: false
      });
    }
  },

  // 客户名称获得焦点
  onCustomerFocus: function (e) {
    this.setData({
      showCustomerAutocomplete: true
    });
  },

  // 客户名称失去焦点
  onCustomerBlur: function (e) {
    const value = e.detail.value;

    // 验证客户名称
    if (value && value.trim() !== '') {
      // 检查是否为有效的客户名称
      const isValidCustomer = this.data.customerHistory.some(customer =>
        customer.name.toLowerCase().includes(value.toLowerCase())
      );

      if (!isValidCustomer && value.length < 2) {
        this.setData({
          customerError: '客户名称至少需要2个字符'
        });
      }
    }

    setTimeout(() => {
      this.setData({
        showCustomerAutocomplete: false
      });
    }, 200);
  },

  // 选择客户
  onCustomerSelect: function (e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    const contact = e.currentTarget.dataset.contact;
    if (!name || name.trim() === '') {
      this.setData({ customerError: '客户信息无效，请重新选择' });
      return;
    }
    this.setData({
      selectedCustomerId: id || null,
      'formData.customer.name': name,
      'formData.customer.contact': contact || '',
      showCustomerAutocomplete: false,
      customerError: ''
    });
  },

  // 产品名称输入处理
  onProductInput: function (e) {
    const value = e.detail.value;

    this.setData({
      'formData.product.name': value
    });

    const matchedProduct = this.data.productHistory.find(product => product.name === value);
    if (matchedProduct) {
      this.setData({
        'formData.product.spec': matchedProduct.spec
      });
    }

    if (value.length > 0) {
      this.setData({
        showProductAutocomplete: true
      });
    } else {
      this.setData({
        showProductAutocomplete: false
      });
    }
  },

  // 产品类别选择
  onProductPresetChange: function (e) {
    const index = Number(e.detail.value);
    const value = this.data.productPresets[index];
    if (value === '新增品类') {
      this.setData({ creatingNewProduct: true, 'formData.product.name': '' });
      return;
    }
    this.setData({ creatingNewProduct: false, 'formData.product.name': value });
  },

  // 产品名称获得焦点
  onProductFocus: function (e) {
    const value = this.data.formData.product.name;
    if (value.length > 0) {
      this.setData({
        showProductAutocomplete: true
      });
    }
  },

  // 产品名称失去焦点
  onProductBlur: function (e) {
    const name = this.data.formData.product.name;
    if (this.data.creatingNewProduct && name && name.trim()) {
      const cloud = require('../../../utils/cloud.js');
      cloud.callERPAPI('createProductCategory', { data: { name } }).then(() => {
        this.loadProductCategories();
        this.setData({ creatingNewProduct: false });
      }).catch(() => {
        this.setData({ creatingNewProduct: false });
      });
    }
    setTimeout(() => {
      this.setData({
        showProductAutocomplete: false
      });
    }, 200);
  },

  // 选择产品
  onProductSelect: function (e) {
    const name = e.currentTarget.dataset.name;
    const spec = e.currentTarget.dataset.spec;

    this.setData({
      'formData.product.name': name,
      'formData.product.spec': spec,
      showProductAutocomplete: false
    });
  },

  // 优先级输入处理
  onPriorityInput: function (e) {
    const value = e.detail.value;

    if (value.length > 0) {
      this.setData({
        showPriorityAutocomplete: true
      });
    } else {
      this.setData({
        showPriorityAutocomplete: false
      });
    }
  },

  // 优先级获得焦点
  onPriorityFocus: function (e) {
    this.setData({
      showPriorityAutocomplete: true
    });
  },

  // 优先级失去焦点
  onPriorityBlur: function (e) {
    setTimeout(() => {
      this.setData({
        showPriorityAutocomplete: false
      });
    }, 200);
  },

  // 选择优先级
  onPrioritySelect: function (e) {
    const priorityText = e.currentTarget.dataset.priority;
    const priority = priorityText === '急' ? 'urgent' : 'normal';

    this.setData({
      'formData.priority': priority,
      showPriorityAutocomplete: false
    });
  },

  // 供应商名称输入处理
  onSupplierInput: function (e) {
    const value = e.detail.value;

    this.setData({
      'formData.supplier.name': value
    });

    const matchedSupplier = this.data.supplierHistory.find(supplier => supplier.name === value);
    if (matchedSupplier) {
      this.setData({
        'formData.supplier.contact': matchedSupplier.contact
      });
    }

    if (value.length > 0) {
      this.setData({
        showSupplierAutocomplete: true
      });
      const history = Array.isArray(this.data.supplierHistory) ? this.data.supplierHistory.map(n => ({ name: n.name || n })) : [];
      const server = Array.isArray(this.data.suppliers) ? this.data.suppliers : [];
      const kw = String(value || '').toLowerCase();
      const seen = new Set();
      const list = [...history, ...server].filter(s => {
        const name = String(s.name || '').trim();
        if (!name) return false;
        const m = name.toLowerCase().includes(kw) || String(s.code || '').toLowerCase().includes(kw);
        if (m && !seen.has(name)) { seen.add(name); return true; }
        return false;
      });
      this.setData({ supplierAutocomplete: list });
    } else {
      this.setData({
        showSupplierAutocomplete: false
      });
    }
  },

  // 供应商名称获得焦点
  onSupplierFocus: function (e) {
    this.setData({ showSupplierAutocomplete: true });
  },

  // 供应商名称失去焦点
  onSupplierBlur: function (e) {
    setTimeout(() => {
      this.setData({
        showSupplierAutocomplete: false
      });
    }, 200);
  },

  // 选择供应商
  onSupplierSelect: function (e) {
    const id = e.currentTarget.dataset.id;
    const name = e.currentTarget.dataset.name;
    const contact = e.currentTarget.dataset.contact;
    this.setData({
      'formData.supplier.name': name,
      'formData.supplier.contact': contact || '',
      showSupplierAutocomplete: false,
      selectedSupplierId: id || null
    });
  },

  // 保存到历史记录
  saveToHistory: function (field, value) {
    if (!value || value.trim() === '') return;

    let historyKey = '';
    let historyData = [];

    switch (field) {
      case 'customer.name':
        historyKey = 'customerHistory';
        break;
      case 'product.name':
        historyKey = 'productHistory';
        break;
      case 'product.spec':
        historyKey = 'specHistory';
        break;
      case 'supplier.name':
        historyKey = 'supplierHistory';
        break;
      case 'product.flute':
        historyKey = 'fluteHistory';
        break;
      case 'product.materialCode':
        historyKey = 'materialHistory';
        break;
      case 'product.creasing':
        historyKey = 'creasingHistory';
        break;
      default:
        return;
    }

    try {
      const existing = wx.getStorageSync(historyKey) || [];

      // 处理不同类型的数据
      if (field === 'customer.name' || field === 'supplier.name') {
        const contactField = field === 'customer.name' ? 'customer.contact' : 'supplier.contact';
        const contact = this.data.formData[field.split('.')[0]]?.contact || '';
        const item = { name: value, contact: contact };

        // 去重
        const exists = existing.find(item => item.name === value);
        if (!exists) {
          existing.unshift(item);
          if (existing.length > 10) existing.pop(); // 限制历史记录数量
          wx.setStorageSync(historyKey, existing);
        }
      } else {
        // 处理字符串数组
        if (existing.indexOf(value) === -1) {
          existing.unshift(value);
          if (existing.length > 10) existing.pop();
          wx.setStorageSync(historyKey, existing);
        }
      }

      // 更新页面数据
      this.setData({
        [historyKey]: existing
      });
    } catch (e) {
      console.error('保存历史记录失败:', e);
    }
  },

  // 加载历史数据
  loadHistoryData: function () {
    try {
      const customerHistory = wx.getStorageSync('customerHistory') || this.data.customerHistory;
      const productHistory = wx.getStorageSync('productHistory') || this.data.productHistory;
      const specHistory = wx.getStorageSync('specHistory') || this.data.specHistory;
      const supplierHistory = wx.getStorageSync('supplierHistory') || this.data.supplierHistory;
      const fluteHistory = wx.getStorageSync('fluteHistory') || this.data.fluteHistory;
      const materialHistory = wx.getStorageSync('materialHistory') || this.data.materialHistory;
      const creasingStored = wx.getStorageSync('creasingHistory') || [];
      const baseCreasing = ['凹凸压线', '平压线', '无压线', '新增压线方式'];
      const creasingHistory = Array.from(new Set([...baseCreasing, ...creasingStored]));

      this.setData({
        customerHistory,
        productHistory,
        specHistory,
        supplierHistory,
        fluteHistory,
        materialHistory,
        creasingHistory
      });
    } catch (e) {
      console.error('加载历史数据失败:', e);
    }
  },

  // 日期选择器变化
  onDateChange: function (e) {
    this.setData({
      'formData.deliveryDate': e.detail.value
    });
  },

  loadCustomers: async function () {
    try {
      const cloud = require('../../../utils/cloud.js');
      const res = await cloud.callERPAPI('getCustomers', { params: { page: 1, limit: 200 } });
      const raw = (res && res.data) ? res.data : [];
      const list = Array.isArray(raw) ? raw : [];
      const names = list
        .map(c => c.companyName || c.name || c.company || '')
        .filter(n => n && String(n).trim());
      this.setData({ customers: list, customerNames: names });
    } catch (e) {
      this.setData({ customers: [], customerNames: [] });
    }
  },

  // 加载供应商
  loadSuppliers: async function () {
    try {
      const cloud = require('../../../utils/cloud.js');
      const res = await cloud.callERPAPI('getSuppliers', { params: { page: 1, limit: 200 } });
      const raw = (res && res.data) ? res.data : [];
      const list = Array.isArray(raw) ? raw : [];
      const names = list
        .map(s => s.name || s.companyName || s.title || s.company || '')
        .filter(n => n && String(n).trim());
      this.setData({ suppliers: list, supplierNames: names });
    } catch (e) {
      this.setData({ suppliers: [], supplierNames: [] });
    }
  },

  // 加载产品类别
  loadProductCategories: async function () {
    try {
      const cloud = require('../../../utils/cloud.js');
      const res = await cloud.callERPAPI('getProductCategories', { params: { page: 1, limit: 200 } });
      const list = (res && res.data) ? res.data.map(i => i.name) : [];
      const base = ['纸箱', '隔板', '天地盒', '飞机盒', '异性纸盒'];
      const merged = Array.from(new Set([...base, ...list, '新增品类']));
      this.setData({ productPresets: merged });
    } catch (e) {
    }
  },

  // 压线方式选择
  onCreasingTypeChange: function (e) {
    const index = Number(e.detail.value);
    const val = this.data.creasingHistory[index];
    const no = val === '无压线';
    const next = { 'formData.product.creasing': val };
    if (no) {
      next['formData.product.creasingSize1'] = '';
      next['formData.product.creasingSize2'] = '';
      next['formData.product.creasingSize3'] = '';
    }
    this.setData({ ...next, isNoCreasing: no });
  },

  onJoinMethodChange: function (e) {
    const index = Number(e.detail.value);
    const val = this.data.joinMethodPresets[index];
    this.setData({ 'formData.joinMethod': val });
  },

  openFlutePicker: function () {
    const idx = Math.max(0, this.data.flutePresets.indexOf(this.data.formData.product.flute || ''))
    this.setData({ showFlutePicker: true, flutePickerIndex: idx })
  },
  closeFlutePicker: function () { this.setData({ showFlutePicker: false }) },
  onFlutePickerChange: function (e) {
    const idx = e.detail.value[0] || 0
    const val = this.data.flutePresets[idx] || ''
    this.setData({ flutePickerIndex: idx, 'formData.product.flute': val })
  },
  confirmFlutePicker: function () {
    const val = this.data.flutePresets[this.data.flutePickerIndex] || ''
    this.setData({ 'formData.product.flute': val, showFlutePicker: false })
  },

  noop: function () { },
  chooseFluteItem: function (e) {
    const idx = e.currentTarget.dataset.index
    const val = this.data.flutePresets[idx] || ''
    this.setData({ 'formData.product.flute': val, showFlutePicker: false })
  },

  openCreasingPicker: function () {
    const currentCreasing = this.data.formData.product.creasing || '';
    const idx = currentCreasing ? this.data.creasingHistory.indexOf(currentCreasing) : -1;
    this.setData({ showCreasingPicker: true, creasingPickerIndex: idx })
  },
  closeCreasingPicker: function () { this.setData({ showCreasingPicker: false }) },
  onCreasingPickerChange: function (e) {
    const idx = e.detail.value[0] || 0
    const val = this.data.creasingHistory[idx] || ''
    const no = val === '无压线'
    const next = { creasingPickerIndex: idx, 'formData.product.creasing': val }
    if (no) {
      next['formData.product.creasingSize1'] = ''
      next['formData.product.creasingSize2'] = ''
      next['formData.product.creasingSize3'] = ''
    }
    this.setData({ ...next, isNoCreasing: no })
  },
  confirmCreasingPicker: function () {
    const pickerIndex = this.data.creasingPickerIndex;
    if (pickerIndex < 0 || pickerIndex >= this.data.creasingHistory.length) {
      this.setData({ showCreasingPicker: false });
      return;
    }
    const val = this.data.creasingHistory[pickerIndex] || ''
    const no = val === '无压线'
    const next = { 'formData.product.creasing': val }
    if (no) {
      next['formData.product.creasingSize1'] = ''
      next['formData.product.creasingSize2'] = ''
      next['formData.product.creasingSize3'] = ''
    }
    this.setData({ ...next, showCreasingPicker: false, isNoCreasing: no })
  },

  chooseCreasingItem: function (e) {
    const idx = e.currentTarget.dataset.index
    const val = this.data.creasingHistory[idx] || ''
    const no = val === '无压线'
    const next = { 'formData.product.creasing': val }
    if (no) {
      next['formData.product.creasingSize1'] = ''
      next['formData.product.creasingSize2'] = ''
      next['formData.product.creasingSize3'] = ''
    }
    this.setData({ ...next, showCreasingPicker: false, isNoCreasing: no })
  },

  openJoinPicker: function () {
    const idx = Math.max(0, this.data.joinMethodPresets.indexOf(this.data.formData.joinMethod || ''))
    this.setData({ showJoinPicker: true, joinPickerIndex: idx })
  },
  closeJoinPicker: function () { this.setData({ showJoinPicker: false }) },
  onJoinPickerChange: function (e) {
    const idx = e.detail.value[0] || 0
    const val = this.data.joinMethodPresets[idx] || ''
    this.setData({ joinPickerIndex: idx, 'formData.joinMethod': val })
  },
  confirmJoinPicker: function () {
    const val = this.data.joinMethodPresets[this.data.joinPickerIndex] || ''
    this.setData({ 'formData.joinMethod': val, showJoinPicker: false })
  },

  chooseJoinItem: function (e) {
    const idx = e.currentTarget.dataset.index
    const val = this.data.joinMethodPresets[idx] || ''
    this.setData({ 'formData.joinMethod': val, showJoinPicker: false })
  },

  // 压线尺寸输入联动计算
  onCreasingSizeInput: function (e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    // 无压线时仍需允许更新纸板门幅，以便校验通过
    this.setData({ [`formData.${field}`]: value });
    // 仅在有压线时联动计算尺寸3
    if (!this.data.isNoCreasing) {
      const w = Number(this.data.formData.product.boardWidth) || 0;
      const s1 = Number(this.data.formData.product.creasingSize1) || 0;
      const s2 = Number(this.data.formData.product.creasingSize2) || 0;
      const s3 = Math.max(0, w - s1 - s2);
      this.setData({ 'formData.product.creasingSize3': String(s3) });
    }
  },

  onCustomerPickerChange: function (e) {
    const index = Number(e.detail.value);
    const selected = this.data.customers[index];
    if (!selected) return;
    this.setData({
      selectedCustomerId: selected._id || selected.id || null,
      'formData.customer.name': selected.companyName || selected.name || selected.company || '',
      'formData.customer.contact': selected.contactName || selected.contact || '',
      customerError: ''
    });
  },

  onSupplierPickerChange: function (e) {
    const index = Number(e.detail.value);
    const selected = this.data.suppliers[index];
    if (!selected) return;
    this.setData({
      selectedSupplierId: selected._id || selected.id || null,
      'formData.supplier.name': selected.name || selected.companyName || selected.title || selected.company || '',
      'formData.supplier.contact': selected.contactName || selected.contact || ''
    });
  },

  // 计算总金额
  calculateAmount: function () {
    const quantity = Number(this.data.formData.product.quantity) || 0;
    const unitPrice = Number(this.data.formData.product.unitPrice) || 0;
    const amount = (quantity * unitPrice).toFixed(2);
    this.setData({
      calculatedAmount: amount
    });
    return amount;
  },

  // 计算尾款
  calculateBalance: function () {
    const total = Number(this.data.calculatedAmount) || 0;
    const deposit = Number(this.data.formData.amount.deposit) || 0;
    const balance = (total - deposit).toFixed(2);
    this.setData({
      calculatedBalance: balance
    });
    return balance;
  },

  // 获取优先级文本
  getPriorityText: function (priority) {
    const index = this.data.priorities.indexOf(priority);
    return this.data.prioritiesText[index] || '普通';
  },

  // 上传附件
  uploadAttachment: function () {
    wx.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        try {
          const tempFilePath = res.tempFilePaths[0];
          const fname = `order_drawing_${Date.now()}_${Math.random().toString(36).slice(2)}.jpg`;
          const uploadRes = await wx.cloud.uploadFile({
            cloudPath: `attachments/${fname}`,
            filePath: tempFilePath
          });
          const fileID = uploadRes.fileID;
          let url = '';
          try {
            const t = await wx.cloud.getTempFileURL({ fileList: [fileID] });
            url = t && t.fileList && t.fileList[0] && t.fileList[0].tempFileURL || '';
          } catch (_) { }
          const newAttachment = {
            type: 'drawing',
            fileID,
            name: fname,
            size: res.tempFiles[0].size,
            url
          };
          this.setData({
            'formData.attachments': [...this.data.formData.attachments, newAttachment]
          });
          wx.showToast({ title: '图纸已上传', icon: 'success' });
        } catch (e) {
          wx.showToast({ title: '上传失败', icon: 'none' });
        }
      }
    });
  },

  // 移除附件
  removeAttachment: function (e) {
    const index = e.currentTarget.dataset.index;
    const attachments = [...this.data.formData.attachments];
    attachments.splice(index, 1);

    this.setData({
      'formData.attachments': attachments
    });
  },

  // 上传订单
  uploadOrder: function () {
    this.setData({
      uploadLoading: true
    });

    setTimeout(() => {
      wx.showToast({
        title: '订单已上传',
        icon: 'success'
      });
      this.setData({
        uploadLoading: false
      });
    }, 1500);
  },

  // 取消订单并释放预约号段
  cancelOrder: function () {
    wx.showModal({
      title: '确认取消',
      content: '确定要取消创建订单吗？',
      success: (res) => {
        if (res.confirm) {
          const rid = this.data.reservationId;
          if (rid) {
            wx.cloud.callFunction({ name: 'erp-api', data: { action: 'releaseOrderNumber', data: { reservationId: rid } } })
              .finally(() => {
                this.setData({ reservationId: '', orderNumber: '', qrCodeUrl: '' });
                wx.navigateBack();
              });
          } else {
            wx.navigateBack();
          }
        }
      }
    });
  },

  // 表单提交
  submitOrder: async function (e) {
    const raw = this.data.formData || {};
    const formData = {
      customer: raw.customer || { name: '', contact: '' },
      supplier: raw.supplier || { name: '', contact: '' },
      product: raw.product || { name: '', spec: '', quantity: 0, unit: this.data.units[0], unitPrice: 0 },
      amount: raw.amount || { total: 0, deposit: 0, balance: 0 },
      deliveryDate: raw.deliveryDate || '',
      priority: raw.priority || 'normal',
      notes: raw.notes || '',
      attachments: raw.attachments || [],
      joinMethod: raw.joinMethod || ''
    };
    if (!this.validateForm(formData)) {
      return;
    }
    this.setData({ submitting: true });
    this.saveAllFormData();

    const total = Number(this.calculateAmount());
    const balance = Number(this.calculateBalance());
    const sheetCountRaw = String(formData.product.sheetCount || '').trim();
    const sheetCountVal = sheetCountRaw ? Number(sheetCountRaw) : undefined;

    const cloud = require('../../../utils/cloud.js');
    const nameToMatch = String(formData.customer.name || '').trim();
    const customers = Array.isArray(this.data.customers) ? this.data.customers : [];
    const matchedCustomer = customers.find(c => {
      const n = c.companyName || c.name || c.company;
      return n && String(n).trim() === nameToMatch;
    });
    if (!matchedCustomer || !(matchedCustomer._id || matchedCustomer.id)) {
      this.setData({ submitting: false });
      wx.showToast({ title: '请从客户名录中选择客户', icon: 'none' });
      return;
    }
    const customerId = matchedCustomer._id || matchedCustomer.id;

    const item = {
      name: formData.product.name || '',
      spec: formData.product.spec || '',
      quantity: Number(formData.product.quantity) || 0,
      unit: formData.product.unit || this.data.units[0],
      unitPrice: Number(formData.product.unitPrice) || 0,
      sheetCount: Number.isFinite(sheetCountVal) ? sheetCountVal : undefined,
      subtotal: total
    };

    const orderPayload = {
      customerId,
      customerName: formData.customer.name,
      supplierName: formData.supplier.name || '',
      productName: formData.product.name,
      productTitle: formData.product.title,
      quantity: Number(formData.product.quantity) || 0,
      sheetCount: Number.isFinite(sheetCountVal) ? sheetCountVal : undefined,
      items: [item],
      orderNumber: this.data.orderNumber || '',
      totalAmount: total,
      amount: total,
      deposit: Number(formData.amount.deposit) || 0,
      balance,
      priority: formData.priority,
      deliveryDate: formData.deliveryDate,
      source: 'wechat',
      notes: formData.notes,
      attachments: formData.attachments || [],
      boardWidth: formData.product.boardWidth,
      boardHeight: formData.product.boardHeight,
      creasingType: formData.product.creasing,
      creasingSize1: formData.product.creasingSize1,
      creasingSize2: formData.product.creasingSize2,
      creasingSize3: formData.product.creasingSize3,
      materialCode: formData.product.materialCode,
      materialNo: formData.product.materialNo,
      joinMethod: formData.joinMethod,
      spec: formData.product.spec || '',
      flute: formData.product.flute || ''
      , status: 'ordered'
    };

    const compact = (obj) => {
      if (!obj || typeof obj !== 'object') return obj;
      const out = Array.isArray(obj) ? [] : {};
      if (Array.isArray(obj)) {
        obj.forEach((v) => {
          const nv = compact(v);
          if (nv !== undefined && nv !== null && nv !== '') out.push(nv);
        });
        return out;
      }
      Object.keys(obj).forEach((k) => {
        const v = obj[k];
        if (v === undefined || v === null) return;
        if (typeof v === 'string' && v.trim() === '') return;
        if (Array.isArray(v)) {
          const nv = compact(v);
          if (nv.length) out[k] = nv;
          return;
        }
        if (typeof v === 'object') {
          const nv = compact(v);
          if (nv && Object.keys(nv).length) out[k] = nv;
          return;
        }
        out[k] = v;
      });
      return out;
    };
    const safePayload = compact({ ...orderPayload, reservationId: this.data.reservationId });

    if (!this.data.isEdit) {
      try {
        const res = await cloud.callERPAPI('createOrder', { data: safePayload });
        const createdNo = res && res.data && (res.data.orderNumber || res.data.orderNo);
        const createdQr = res && res.data && res.data.qrCodeUrl;
        if (createdNo) {
          this.setData({ orderNumber: createdNo, qrCodeUrl: createdQr || '' });
        }
        this.setData({ submitting: false, reservationId: '' });
        wx.showToast({ title: '创建成功', icon: 'success', duration: 2000 });
        try { wx.setStorageSync('orders_force_refresh', Date.now()); } catch (_) { }
        setTimeout(() => { wx.switchTab({ url: '/pages/order/order' }); }, 800);
      } catch (err) {
        this.setData({ submitting: false });
        cloud.showCloudError(err, '创建订单失败');
      }
    } else {
      let id = this.data.orderId;
      try {
        const db = wx.cloud.database();
        const cmd = db.command;
        // 优先尝试按文档ID获取
        let needQuery = false;
        try {
          const doc = await db.collection('orders').doc(id).get();
          if (!doc || !doc.data) needQuery = true;
        } catch (err) {
          needQuery = true;
        }
        if (needQuery) {
          // 回退按订单号或兼容字段查询
          const q = await db.collection('orders')
            .where(cmd.or([
              { orderNo: id },
              { orderNumber: id }
            ]))
            .limit(1)
            .get();
          id = q.data && q.data.length ? q.data[0]._id : id;
        }
        await cloud.callERPAPI('updateOrder', { data: { id, ...safePayload } });
        this.setData({ submitting: false });
        wx.showToast({ title: '更新成功', icon: 'success', duration: 2000 });
        try { wx.setStorageSync('orders_force_refresh', Date.now()); } catch (_) { }
        setTimeout(() => { wx.navigateBack(); }, 1200);
      } catch (err) {
        this.setData({ submitting: false });
        cloud.showCloudError(err, '更新订单失败');
      }
    }
  },

  // 保存所有表单数据到历史记录
  saveAllFormData: function () {
    const formData = this.data.formData;

    // 使用安全访问方式，防止undefined错误
    this.saveToHistory('customer.name', formData.customer?.name || '');
    this.saveToHistory('product.name', formData.product?.name || '');
    this.saveToHistory('product.spec', formData.product?.spec || '');
    this.saveToHistory('supplier.name', formData.supplier?.name || '');
    this.saveToHistory('product.flute', formData.product?.flute || '');
    this.saveToHistory('product.materialCode', formData.product?.materialCode || '');
    this.saveToHistory('product.creasing', formData.product?.creasing || '');
  },

  // 表单验证
  validateForm: function (formData) {
    if (!formData || !formData.customer || !formData.product) {
      wx.showToast({ title: '表单数据不完整', icon: 'none' });
      return false;
    }
    const customerName = String(formData.customer.name || '').trim();
    if (!customerName) {
      wx.showToast({
        title: '请输入客户名称',
        icon: 'none'
      });
      return false;
    }
    const customers = Array.isArray(this.data.customers) ? this.data.customers : [];
    const hasCustomer = customers.some(c => {
      const name = c.companyName || c.name || c.company;
      return name && String(name).trim() === customerName;
    });
    if (!hasCustomer) {
      wx.showToast({ title: '请从客户名录中选择客户', icon: 'none' });
      return false;
    }

    const supplierName = String(formData.supplier.name || '').trim();
    if (!supplierName) {
      wx.showToast({
        title: '请输入供应商名称',
        icon: 'none'
      });
      return false;
    }
    const suppliers = Array.isArray(this.data.suppliers) ? this.data.suppliers : [];
    const hasSupplier = suppliers.some(s => {
      const name = s.name || s.companyName || s.title || s.company;
      return name && String(name).trim() === supplierName;
    });
    if (!hasSupplier) {
      wx.showToast({ title: '请从供应商名录中选择供应商', icon: 'none' });
      return false;
    }

    if (!formData.product.name || !String(formData.product.name).trim()) {
      wx.showToast({
        title: '请输入产品类别',
        icon: 'none'
      });
      return false;
    }

    if (!formData.product.spec || !String(formData.product.spec).trim()) {
      wx.showToast({ title: '请输入产品规格', icon: 'none' });
      return false;
    }

    if (!formData.product.materialCode || !String(formData.product.materialCode).trim()) {
      wx.showToast({ title: '请输入材质编码', icon: 'none' });
      return false;
    }

    if (!formData.product.flute || !String(formData.product.flute).trim()) {
      wx.showToast({ title: '请选择楞型', icon: 'none' });
      return false;
    }

    if (!formData.product.boardWidth || !formData.product.boardHeight) {
      wx.showToast({ title: '请输入纸板尺寸', icon: 'none' });
      return false;
    }

    if (!formData.product.unitPrice || Number(formData.product.unitPrice) <= 0) {
      wx.showToast({ title: '请输入有效单价', icon: 'none' });
      return false;
    }

    // 拼接方式不再必填

    if (!formData.product.quantity || formData.product.quantity <= 0) {
      wx.showToast({
        title: '请输入有效数量',
        icon: 'none'
      });
      return false;
    }

    const sheetCountRaw = String(formData.product.sheetCount || '').trim();
    if (sheetCountRaw) {
      const sheetCountNum = Number(sheetCountRaw);
      if (!Number.isFinite(sheetCountNum) || sheetCountNum <= 0) {
        wx.showToast({ title: '请输入正确的下单片数', icon: 'none' });
        return false;
      }
    }

    return true;
  },

  // 生成订单号
  generateOrderNo: function () {
    const timestamp = Date.now();
    const random = Math.floor(Math.random() * 1000);
    return `ORD${timestamp}${random}`;
  },

  makeQrUrl: function (orderId) {
    const text = String(orderId || '').trim();
    if (!text) return '';
    return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(text)}`;
  },

  // 格式化日期
  formatDate: function (date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
  },

  formatPcOrderNumber: function (raw) {
    const pattern = /^(QXDD|QXBZ)\d{7,12}$/;
    if (typeof raw === 'string' && pattern.test(raw)) return raw;
    return '';
  },

  // 取消按钮
  onCancel: function () {
    wx.showModal({
      title: '确认取消',
      content: '确定要取消吗？已填写的信息将不会保存',
      success: (res) => {
        if (res.confirm) {
          try {
            const cloud = require('../../../utils/cloud.js');
            const rid = this.data.reservationId;
            const ono = this.data.orderNumber;
            if (rid || ono) {
              cloud.callERPAPI('releaseOrderNumber', { reservationId: rid, orderNumber: ono }).catch(() => { });
              this.setData({ reservationId: '', orderNumber: '' });
            }
          } catch (_) { }
          wx.navigateBack();
        }
      }
    });
  },

  onUnload: function () {
    try {
      const cloud = require('../../../utils/cloud.js');
      const rid = this.data.reservationId;
      const ono = this.data.orderNumber;
      if (rid || ono) {
        cloud.callERPAPI('releaseOrderNumber', { reservationId: rid, orderNumber: ono }).catch(() => { });
        this.setData({ reservationId: '', orderNumber: '' });
      }
    } catch (_) { }
  }
});
