// 订单创建页 - 修复版
Page({
  data: {
    // 基础信息
    orderNumber: '',
    reservationId: '',
    generating: false,
    created: false,
    customerId: '',
    customerName: '',
    orderDate: '',
    deliveryDate: '',
    priority: 'normal',
    currentPriorityLabel: '普通',
    currentPriorityColor: '#4CAF50',
    priorityOptions: [
      { value: 'urgent', label: '紧急', color: '#ff4444' },
      { value: 'high', label: '高', color: '#ff8800' },
      { value: 'normal', label: '普通', color: '#4CAF50' },
      { value: 'low', label: '低', color: '#9E9E9E' }
    ],
    joinMethodOptions: ['打钉', '粘胶'],
    joinMethod: '打钉',
    
    // 产品信息
    products: [
      {
        id: Date.now(),
        productId: '',
        productName: '',
        materialNo: '',
        quantity: 1,
        unit: '个',
        price: 0,
        total: 0,
        specifications: ''
      }
    ],
    
    // 价格信息
    subtotal: 0,
    discount: 0,
    total: 0,
    deposit: 0,
    balance: 0,
    
    // 客户列表
    customerList: [],
    
    // 产品列表
    productList: [],
    
    // 页面状态
    loading: false,
    showCustomerSelector: false,
    showProductSelector: false
  },

  onLoad: function() {
    console.log('订单创建页面加载');
    
    // 生成订单号
    this.generateOrderNumber();
    
    // 设置默认日期
    this.setDefaultDates();
    
    // 初始化优先级显示
    this.initPriorityDisplay();
    
    // 加载基础数据
    this.loadBasicData();
  },

  // 初始化优先级显示
  initPriorityDisplay: function() {
    const currentPriority = this.data.priority;
    const priorityData = this.data.priorityOptions.find(p => p.value === currentPriority);
    if (priorityData) {
      this.setData({
        currentPriorityLabel: priorityData.label,
        currentPriorityColor: priorityData.color
      });
    }
  },

  // 生成订单号
  generateOrderNumber: function() {
    if (this.data.generating) return
    this.setData({ generating: true })

    wx.cloud.callFunction({ name: 'erp-api', data: { action: 'reserveOrderNumber' } })
      .then((res) => {
        const payload = (res && res.result && res.result.data) ? res.result.data : (res && res.result ? res.result : {})
        const no = payload && (payload.orderNumber || payload.orderNo) ? (payload.orderNumber || payload.orderNo) : ''
        const rid = payload && payload.reservationId ? payload.reservationId : ''
        if (!no) throw new Error('No order number returned')
        this.setData({ orderNumber: no, reservationId: rid, generating: false })
      })
      .catch(() => {
        wx.cloud.callFunction({ name: 'erp-api', data: { action: 'generateOrderNumber' } })
          .then((res2) => {
            const payload2 = (res2 && res2.result && res2.result.data) ? res2.result.data : (res2 && res2.result ? res2.result : {})
            const no2 = payload2 && (payload2.orderNumber || payload2.orderNo) ? (payload2.orderNumber || payload2.orderNo) : ''
            if (!no2) throw new Error('No order number returned')
            this.setData({ orderNumber: no2, reservationId: '', generating: false })
          })
          .catch(() => {
            this.setData({ orderNumber: '', reservationId: '', generating: false })
            wx.showToast({ title: '无法生成订单号，请重试', icon: 'none' })
          })
      })
  },

  // 设置默认日期
  setDefaultDates: function() {
    const today = new Date();
    const deliveryDate = new Date(today.getTime() + 3 * 24 * 60 * 60 * 1000); // 3天后
    
    this.setData({
      orderDate: this.formatDate(today),
      deliveryDate: this.formatDate(deliveryDate)
    });
  },

  // 格式化日期
  formatDate: function(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 加载基础数据
  loadBasicData: function() {
    // 模拟客户数据
    const customers = [
      { id: 'C001', name: '华润包装科技有限公司', contact: '张经理' },
      { id: 'C002', name: '京东物流包装', contact: '李主管' },
      { id: 'C003', name: '阿里包装材料', contact: '王总' }
    ];
    
    // 模拟产品数据
    const products = [
      { id: 'P001', name: '五层瓦楞纸箱', price: 3.50, unit: '个' },
      { id: 'P002', name: '三层瓦楞纸箱', price: 2.80, unit: '个' },
      { id: 'P003', name: '特制纸盒', price: 8.50, unit: '个' }
    ];
    
    this.setData({
      customerList: customers,
      productList: products
    });
  },

  // 选择客户
  onCustomerTap: function() {
    this.setData({ showCustomerSelector: true });
  },

  // 选择客户
  selectCustomer: function(e) {
    const customer = e.currentTarget.dataset.customer;
    this.setData({
      customerId: customer.id,
      customerName: customer.name,
      showCustomerSelector: false
    });
  },

  // 选择产品
  onProductTap: function(e) {
    const index = e.currentTarget.dataset.index;
    this.setData({ 
      showProductSelector: true,
      currentProductIndex: index
    });
  },

  // 选择产品
  selectProduct: function(e) {
    const product = e.currentTarget.dataset.product;
    const index = this.data.currentProductIndex;
    
    const products = [...this.data.products];
    products[index].productId = product.id;
    products[index].productName = product.name;
    products[index].price = product.price;
    products[index].unit = product.unit;
    
    this.calculateProductTotal(index, products);
    
    this.setData({
      products: products,
      showProductSelector: false
    });
  },

  onUnload: function() {
    const reservationId = String(this.data.reservationId || '').trim()
    const orderNumber = String(this.data.orderNumber || '').trim()
    if (this.data.created) return
    if (!reservationId && !orderNumber) return
    wx.cloud.callFunction({
      name: 'erp-api',
      data: { action: 'releaseOrderNumber', data: { reservationId, orderNumber } }
    }).catch(() => {})
  },

  // 拼接方式选择
  onJoinMethodChange: function(e) {
    const index = e.detail.value
    const val = this.data.joinMethodOptions[index]
    this.setData({ joinMethod: val })
  },

  // 输入框变化
  onInputChange: function(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    
    if (field.includes('.')) {
      const [parent, child] = field.split('.');
      this.setData({
        [`${parent}.${child}`]: value
      });
    } else {
      this.setData({ [field]: value });
    }
  },

  // 产品输入变化
  onProductChange: function(e) {
    const index = e.currentTarget.dataset.index;
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    
    const products = [...this.data.products];
    products[index][field] = value;
    
    if (field === 'quantity' || field === 'price') {
      this.calculateProductTotal(index, products);
    }
    
    this.setData({ products });
  },

  // 计算产品总价
  calculateProductTotal: function(index, products) {
    const quantity = parseFloat(products[index].quantity) || 0;
    const price = parseFloat(products[index].price) || 0;
    products[index].total = quantity * price;
    
    this.calculateOrderTotal(products);
  },

  // 计算订单总价
  calculateOrderTotal: function(products) {
    const subtotal = products.reduce((sum, item) => sum + (item.total || 0), 0);
    const discount = parseFloat(this.data.discount) || 0;
    const total = subtotal - discount;
    const deposit = total * 0.5; // 50%定金
    const balance = total - deposit;
    
    this.setData({
      subtotal: subtotal.toFixed(2),
      total: total.toFixed(2),
      deposit: deposit.toFixed(2),
      balance: balance.toFixed(2)
    });
  },

  // 添加产品
  addProduct: function() {
    const products = [...this.data.products];
    products.push({
      id: Date.now(),
      productId: '',
      productName: '',
      quantity: 1,
      unit: '个',
      price: 0,
      total: 0,
      specifications: ''
    });
    
    this.setData({ products });
  },

  // 删除产品
  removeProduct: function(e) {
    const index = e.currentTarget.dataset.index;
    const products = [...this.data.products];
    
    if (products.length > 1) {
      products.splice(index, 1);
      this.calculateOrderTotal(products);
      this.setData({ products });
    } else {
      wx.showToast({
        title: '至少保留一个产品',
        icon: 'none'
      });
    }
  },

  // 选择优先级
  onPriorityChange: function(e) {
    const index = e.detail.value;
    const priorityData = this.data.priorityOptions[index];
    this.setData({ 
      priority: priorityData.value,
      currentPriorityLabel: priorityData.label,
      currentPriorityColor: priorityData.color
    });
  },

  // 保存订单
  saveOrder: function() {
    // 验证必填字段
    if (!this.data.customerName) {
      wx.showToast({
        title: '请选择客户',
        icon: 'none'
      });
      return;
    }
    
    const hasValidProduct = this.data.products.some(p => p.productName && p.quantity > 0);
    if (!hasValidProduct) {
      wx.showToast({
        title: '请添加有效产品',
        icon: 'none'
      });
      return;
    }
    
    // 构建订单数据
    const orderNumber = String(this.data.orderNumber || '').trim()
    const reservationId = String(this.data.reservationId || '').trim()
    if (!orderNumber) {
      wx.showToast({ title: '订单号生成失败，请重试', icon: 'none' })
      return
    }

    const items = (this.data.products || [])
      .filter(p => p && p.productName && Number(p.quantity || 0) > 0)
      .map(p => ({
        productName: p.productName,
        goodsName: p.productName,
        materialNo: p.materialNo || '',
        spec: p.specifications || '',
        quantity: Number(p.quantity || 0),
        unit: p.unit || '个',
        unitPrice: Number(p.price || 0)
      }))

    const first = items[0] || {}
    const quantity = items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)
    const amount = Number(this.data.total || 0)

    const orderData = {
      reservationId,
      orderNo: orderNumber,
      orderNumber,
      customerId: this.data.customerId,
      customerName: this.data.customerName,
      productName: first.productName || '',
      goodsName: first.goodsName || '',
      quantity,
      unit: first.unit || '个',
      unitPrice: Number(first.unitPrice || 0),
      amount,
      totalAmount: amount,
      deposit: Number(this.data.deposit || 0),
      balance: Number(this.data.balance || 0),
      deliveryDate: this.data.deliveryDate,
      priority: this.data.priority,
      joinMethod: this.data.joinMethod,
      items,
      source: 'wechat'
    }
    
    // 显示保存进度
    this.setData({ loading: true });

    wx.cloud.callFunction({ name: 'erp-api', data: { action: 'createOrder', data: orderData } })
      .then((res) => {
        const payload = res && res.result ? res.result : {}
        if (!payload.success) throw new Error(payload.message || '订单创建失败')
        const created = payload.data || {}
        const id = created._id || created.id || ''

        this.setData({ loading: false, created: true, reservationId: '' })
        wx.showToast({ title: '订单创建成功', icon: 'success' })

        if (id) {
          wx.redirectTo({ url: `/pages/order-sub/detail/detail?orderId=${id}&orderNo=${encodeURIComponent(orderNumber)}` })
        } else {
          wx.navigateBack()
        }
      })
      .catch((err) => {
        const msg = (err && err.message) ? err.message : '订单创建失败'
        this.setData({ loading: false })
        wx.showToast({ title: msg, icon: 'none' })
      })
  },

  // 关闭选择器
  closeSelector: function() {
    this.setData({
      showCustomerSelector: false,
      showProductSelector: false
    });
  },

  // 返回
  goBack: function() {
    wx.navigateBack();
  }
});
