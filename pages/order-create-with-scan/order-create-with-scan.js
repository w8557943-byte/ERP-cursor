// 带扫码功能的订单创建页面
Page({
  data: {
    orderInfo: {
      orderNo: '',
      customerInfo: {},
      productInfo: {},
      specifications: '',
      quantity: 0,
      unitPrice: 0,
      totalPrice: 0,
      notes: ''
    },
    scanResults: {
      customer: '',
      product: '',
      spec: '',
      material: ''
    },
    showCustomerSelector: false,
    showProductSelector: false
  },

  onLoad: function() {
    this.generateOrderNo();
  },

  generateOrderNo: function() {
    const now = new Date();
    const orderNo = 'ORD' + now.getFullYear() + 
                   String(now.getMonth() + 1).padStart(2, '0') + 
                   String(now.getDate()).padStart(2, '0') + 
                   Math.random().toString(36).substr(2, 6).toUpperCase();
    this.setData({
      'orderInfo.orderNo': orderNo
    });
  },

  // 扫码1：扫描客户二维码
  scanCustomerQR: function() {
    console.log('扫码：客户二维码');
    wx.scanCode({
      success: (res) => {
        console.log('客户二维码扫描结果:', res.result);
        this.setData({
          'scanResults.customer': res.result,
          showCustomerSelector: true
        });
        this.parseCustomerInfo(res.result);
      },
      fail: (err) => {
        console.error('扫描客户二维码失败:', err);
        wx.showToast({
          title: '扫描失败',
          icon: 'none'
        });
      }
    });
  },

  // 扫码2：扫描产品条码
  scanProductBarcode: function() {
    console.log('扫码：产品条码');
    wx.scanCode({
      success: (res) => {
        console.log('产品条码扫描结果:', res.result);
        this.setData({
          'scanResults.product': res.result,
          showProductSelector: true
        });
        this.parseProductInfo(res.result);
      },
      fail: (err) => {
        console.error('扫描产品条码失败:', err);
        wx.showToast({
          title: '扫描失败',
          icon: 'none'
        });
      }
    });
  },

  // 扫码3：扫描规格二维码
  scanSpecificationQR: function() {
    console.log('扫码：规格二维码');
    wx.scanCode({
      success: (res) => {
        console.log('规格二维码扫描结果:', res.result);
        this.setData({
          'scanResults.spec': res.result
        });
        this.parseSpecification(res.result);
      },
      fail: (err) => {
        console.error('扫描规格二维码失败:', err);
        wx.showToast({
          title: '扫描失败',
          icon: 'none'
        });
      }
    });
  },

  // 扫码4：扫描材料条码
  scanMaterialBarcode: function() {
    console.log('扫码：材料条码');
    wx.scanCode({
      success: (res) => {
        console.log('材料条码扫描结果:', res.result);
        this.setData({
          'scanResults.material': res.result
        });
        this.parseMaterial(res.result);
      },
      fail: (err) => {
        console.error('扫描材料条码失败:', err);
        wx.showToast({
          title: '扫描失败',
          icon: 'none'
        });
      }
    });
  },

  // 解析客户信息
  parseCustomerInfo: function(qrData) {
    try {
      // 假设二维码包含客户JSON数据
      const customerData = JSON.parse(qrData);
      this.setData({
        'orderInfo.customerInfo': {
          name: customerData.name || '未知客户',
          contact: customerData.contact || '',
          phone: customerData.phone || ''
        }
      });
    } catch (e) {
      // 如果不是JSON，可能是客户ID
      this.setData({
        'orderInfo.customerInfo': {
          name: qrData,
          contact: '',
          phone: ''
        }
      });
    }
  },

  // 解析产品信息
  parseProductInfo: function(barcodeData) {
    // 模拟解析产品条码
    const productInfo = {
      name: '五层瓦楞纸箱',
      code: barcodeData,
      unit: '个'
    };
    
    this.setData({
      'orderInfo.productInfo': productInfo
    });
  },

  // 解析规格信息
  parseSpecification: function(qrData) {
    // 模拟解析规格二维码
    const specs = '50×40×30cm | 单色印刷 | 钉箱';
    this.setData({
      'orderInfo.specifications': specs
    });
  },

  // 解析材料信息
  parseMaterial: function(barcodeData) {
    // 模拟解析材料条码
    const material = 'A=B | AB楞 | 120×100cm';
    // 这里可以根据需要设置价格
    this.setData({
      'orderInfo.notes': material
    });
  },

  // 计算总价
  calculateTotal: function() {
    const quantity = this.data.orderInfo.quantity || 0;
    const unitPrice = this.data.orderInfo.unitPrice || 0;
    const total = quantity * unitPrice;
    
    this.setData({
      'orderInfo.totalPrice': total
    });
  },

  // 输入变化
  onInputChange: function(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    
    this.setData({
      [`orderInfo.${field}`]: value
    });
    
    // 如果是数量或单价，重新计算总价
    if (field === 'quantity' || field === 'unitPrice') {
      this.calculateTotal();
    }
  },

  // 选择客户
  selectCustomer: function(e) {
    const customer = e.currentTarget.dataset.customer;
    this.setData({
      'orderInfo.customerInfo': customer,
      showCustomerSelector: false
    });
  },

  // 选择产品
  selectProduct: function(e) {
    const product = e.currentTarget.dataset.product;
    this.setData({
      'orderInfo.productInfo': product,
      showProductSelector: false
    });
  },

  // 保存订单
  saveOrder: function() {
    const orderInfo = this.data.orderInfo;
    
    if (!orderInfo.customerInfo.name) {
      wx.showToast({
        title: '请选择客户',
        icon: 'none'
      });
      return;
    }
    
    if (!orderInfo.productInfo.name) {
      wx.showToast({
        title: '请选择产品',
        icon: 'none'
      });
      return;
    }
    
    wx.showLoading({
      title: '保存中...'
    });
    
    // 模拟保存订单
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({
        title: '订单创建成功',
        icon: 'success'
      });
      
      setTimeout(() => {
        wx.navigateBack();
      }, 1500);
    }, 2000);
  },

  // 重置表单
  resetForm: function() {
    this.setData({
      orderInfo: {
        orderNo: '',
        customerInfo: {},
        productInfo: {},
        specifications: '',
        quantity: 0,
        unitPrice: 0,
        totalPrice: 0,
        notes: ''
      },
      scanResults: {
        customer: '',
        product: '',
        spec: '',
        material: ''
      }
    });
    this.generateOrderNo();
  },

  // 返回
  goBack: function() {
    wx.navigateBack();
  }
});