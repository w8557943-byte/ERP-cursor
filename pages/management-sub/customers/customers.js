// 客户管理页面
Page({
  data: {
    activeTab: 'customers',
    customers: [],
    loading: true,
    searchKeyword: '',
    filteredCustomers: null,
    filterStatus: 'all',
    customerTotal: 0,
    supplierTotal: 0,
    customerShown: 0,
    supplierShown: 0,
    showAddModal: false,
    newCustomer: {
      name: '',
      shortName: '',
      paymentTerms: '现结',
      contact: '',
      phone: '',
      email: '',
      address: '',
      status: 'active'
    },
    paymentOptions: ['现结', '月结30天', '月结60天', '月结90天', '月结105天'],
    suppliers: [],
    supplierLoading: false,
    supplierSearchKeyword: '',
    filteredSuppliers: null,
    showAddSupplierModal: false,
    newSupplier: {
      name: '',
      shortName: '',
      contactName: '',
      phone: '',
      industry: ''
    }
  },

  stop: function() {},

  updateStats: function(nextData) {
    const current = this.data || {};
    const merged = Object.assign({}, current, nextData || {});

    const customers = Array.isArray(merged.customers) ? merged.customers : [];
    const suppliers = Array.isArray(merged.suppliers) ? merged.suppliers : [];

    const displayedCustomers = Array.isArray(merged.filteredCustomers) ? merged.filteredCustomers : customers;
    const displayedSuppliers = Array.isArray(merged.filteredSuppliers) ? merged.filteredSuppliers : suppliers;

    return {
      customerTotal: customers.length,
      supplierTotal: suppliers.length,
      customerShown: displayedCustomers.length,
      supplierShown: displayedSuppliers.length
    };
  },

  ensureAllowed: function() {
    let userInfo = null;
    try {
      userInfo = wx.getStorageSync('userInfo') || null;
    } catch (e) {}
    const role = userInfo && userInfo.role ? String(userInfo.role).toLowerCase() : '';
    if (role === 'operator') {
      wx.showToast({ title: '无权限访问', icon: 'none' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/production/production' });
      }, 600);
      return false;
    }
    return true;
  },

  onLoad: function() {
    if (!this.ensureAllowed()) return;
    console.log('客户管理页面加载');
    this.loadCustomers();
  },

  onShow: function() {
    if (!this.ensureAllowed()) return;
    console.log('客户列表页面显示，强制刷新数据');

    const activeTab = this.data.activeTab || 'customers';
    if (activeTab === 'suppliers') {
      this.setData(
        {
          suppliers: [],
          supplierLoading: true,
          filteredSuppliers: null
        },
        () => {
          this.loadSuppliers();
        }
      );
      return;
    }

    this.setData(
      {
        customers: [],
        loading: true,
        filteredCustomers: null
      },
      () => {
        this.loadCustomers();
      }
    );
  },

  switchTab: function(e) {
    const type = e.currentTarget.dataset.type || 'customers';
    if (type === this.data.activeTab) return;
    this.setData({ activeTab: type });
    if (type === 'suppliers' && (!this.data.suppliers || this.data.suppliers.length === 0)) {
      this.loadSuppliers();
    }
  },

  // 加载客户数据
  loadCustomers: function() {
    this.setData({ loading: true });
    
    console.log('开始加载客户数据，优先使用云函数');
    
    // 调用云函数获取客户数据
    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'getCustomers',
        params: { page: 1, limit: 500 }
      }
    }).then(res => {
      console.log('云函数返回结果:', res);

      const result = res && res.result ? res.result : {};

      const rawList = Array.isArray(result.data)
        ? result.data
        : Array.isArray(result.data && result.data.customers)
          ? result.data.customers
          : Array.isArray(result.customers)
            ? result.customers
            : [];

      const realCustomers = rawList.map(customer => {
        const mappedCustomer = {
          id: customer.id || customer._id,
          docId: customer._id,
          _id: customer._id,
          name: customer.companyName || customer.name,
          shortName: customer.shortName || '',
          paymentTerms: customer.paymentTerms || '',
          contact: customer.contactName || customer.contact,
          phone: customer.phone,
          email: customer.email,
          address: customer.address,
          status: customer.status || 'active',
          orderCount: customer.orderCount || 0,
          totalAmount: customer.totalAmount || 0,
          lastOrderDate: customer.lastOrderDate,
          frequency: customer.frequency || 1
        };

        console.log('映射客户记录:', {
          original: customer,
          mapped: mappedCustomer
        });

        return mappedCustomer;
      });

      if (realCustomers.length > 0) {
        const next = { customers: realCustomers, loading: false, filteredCustomers: null };
        this.setData(Object.assign({}, next, this.updateStats(next)));
        console.log('成功从云函数加载客户数据:', realCustomers.length, '条');
        return;
      }

      console.warn('云函数未返回有效客户数据，尝试直接从云数据库加载:', result);
      this.loadCustomersFromCloudDB();
    }).catch(err => {
      console.error('调用云函数失败:', err);
      // 如果云函数调用失败，尝试直接调用云数据库
      this.loadCustomersFromCloudDB();
    });
  },

  loadSuppliers: function() {
    this.setData({ supplierLoading: true });
    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'getSuppliers',
        params: { page: 1, limit: 200 }
      }
    }).then(res => {
      const result = res && res.result ? res.result : {};
      const rawList = Array.isArray(result.data)
        ? result.data
        : Array.isArray(result.suppliers)
          ? result.suppliers
          : [];
      const suppliers = rawList.map(s => {
        return {
          id: s._id || s.id,
          docId: s._id,
          _id: s._id,
          name: s.name,
          shortName: s.shortName || '',
          contact: s.contactName || '',
          phone: s.phone || '',
          industry: s.industry || '',
          status: s.status || 'active'
        };
      });
      const next = { suppliers, filteredSuppliers: null, supplierLoading: false };
      this.setData(Object.assign({}, next, this.updateStats(next)));
    }).catch(err => {
      console.error('加载供应商失败:', err);
      const next = { suppliers: [], filteredSuppliers: null, supplierLoading: false };
      this.setData(Object.assign({}, next, this.updateStats(next)));
    });
  },

  // 直接从云数据库加载客户数据
  loadCustomersFromCloudDB: function() {
    console.log('尝试直接从云数据库加载客户数据');
    
    const db = wx.cloud.database();
    db.collection('customers')
      .orderBy('createdAt', 'desc')
      .get()
      .then(res => {
        console.log('云数据库返回结果:', res);
        
        const realCustomers = (res.data || []).map(customer => {
          return {
            id: customer.id || customer._id, // 保留原始业务ID用于显示和传递
            docId: customer._id, // 明确存储文档ID用于删除操作
            _id: customer._id, // 保留原始文档ID
            name: customer.companyName || customer.name,
            shortName: customer.shortName || '',
            paymentTerms: customer.paymentTerms || '',
            contact: customer.contactName || customer.contact,
            phone: customer.phone,
            email: customer.email,
            address: customer.address,
            status: customer.status || 'active',
            orderCount: customer.orderCount || 0,
            totalAmount: customer.totalAmount || 0,
            lastOrderDate: customer.lastOrderDate,
            frequency: customer.frequency || 1
          };
        });
        
        const next = { customers: realCustomers, loading: false, filteredCustomers: null };
        this.setData(Object.assign({}, next, this.updateStats(next)));
        
        console.log('成功从云数据库加载客户数据:', realCustomers.length, '条');
      })
      .catch(err => {
        console.error('从云数据库加载客户数据失败:', err);
        // 如果所有方法都失败，使用模拟数据并提示用户
        wx.showToast({
          title: '网络连接失败，使用模拟数据',
          icon: 'none'
        });
        this.loadMockCustomers();
      });
  },

  onSupplierSearchInput: function(e) {
    const keyword = e.detail && e.detail.value ? e.detail.value : '';
    this.setData({
      supplierSearchKeyword: keyword
    });
    this.filterSuppliers();
  },

  filterSuppliers: function() {
    const { supplierSearchKeyword, suppliers } = this.data;
    const kw = (supplierSearchKeyword || '').trim().toLowerCase();
    if (!kw) {
      const next = { filteredSuppliers: null };
      this.setData(Object.assign({}, next, this.updateStats(next)));
      return;
    }
    const list = (suppliers || []).filter(s => {
      const name = String(s.name || '').toLowerCase();
      const contact = String(s.contact || '').toLowerCase();
      const phone = String(s.phone || '').toLowerCase();
      return name.includes(kw) || contact.includes(kw) || phone.includes(kw);
    });
    const next = { filteredSuppliers: list };
    this.setData(Object.assign({}, next, this.updateStats(next)));
  },

  // 加载模拟数据
  loadMockCustomers: function() {
    const mockCustomers = [
      {
        id: 'C001',
        name: '华润包装科技有限公司',
        contact: '张经理',
        phone: '13800138001',
        email: 'zhang@hrpack.com',
        address: '北京市朝阳区建国路100号',
        status: 'active',
        orderCount: 156,
        totalAmount: 1285000,
        lastOrderDate: '2025-11-20'
      },
      {
        id: 'C002', 
        name: '京东物流包装',
        contact: '李主管',
        phone: '13800138002',
        email: 'li@jdlogistics.com',
        address: '上海市浦东新区张江高科技园区',
        status: 'active',
        orderCount: 89,
        totalAmount: 867000,
        lastOrderDate: '2025-11-22'
      },
      {
        id: 'C003',
        name: '阿里包装材料',
        contact: '王总',
        phone: '13800138003',
        email: 'wang@alibz.com',
        address: '杭州市西湖区文三路',
        status: 'active',
        orderCount: 67,
        totalAmount: 542000,
        lastOrderDate: '2025-11-18'
      },
      {
        id: 'C004',
        name: '顺丰速运包装部',
        contact: '陈经理',
        phone: '13800138004',
        email: 'chen@sf-express.com',
        address: '深圳市南山区科技园',
        status: 'active',
        orderCount: 45,
        totalAmount: 389000,
        lastOrderDate: '2025-11-15'
      },
      {
        id: 'C005',
        name: '拼多多包装采购',
        contact: '刘采购',
        phone: '13800138005',
        email: 'liu@pdd.com',
        address: '广州市天河区珠江新城',
        status: 'inactive',
        orderCount: 23,
        totalAmount: 187000,
        lastOrderDate: '2025-10-25'
      },
      {
        id: 'C006',
        name: '美团外卖包装',
        contact: '赵总',
        phone: '13800138006',
        email: 'zhao@meituan.com',
        address: '北京市海淀区上地信息产业基地',
        status: 'active',
        orderCount: 12,
        totalAmount: 98000,
        lastOrderDate: '2025-11-10'
      },
      {
        id: 'C007',
        name: '字节跳动包装部',
        contact: '钱经理',
        phone: '13800138007',
        email: 'qian@bytedance.com',
        address: '北京市海淀区中关村',
        status: 'active',
        orderCount: 8,
        totalAmount: 65000,
        lastOrderDate: '2025-11-05'
      }
    ];
    
    // 为每个客户计算频繁率（基于当月订单次数对比）
    mockCustomers.forEach(customer => {
      customer.frequency = 3; 
    });
    
    const next = { customers: mockCustomers, loading: false, filteredCustomers: null };
    this.setData(Object.assign({}, next, this.updateStats(next)));
  },

  // 搜索客户
  onSearchInput: function(e) {
    this.setData({
      searchKeyword: e.detail.value
    });
    this.filterCustomers();
  },

  // 筛选客户
  onFilterChange: function(e) {
    this.setData({
      filterStatus: e.detail.value
    });
    this.filterCustomers();
  },

  // 过滤客户数据
  filterCustomers: function() {
    const { searchKeyword, filterStatus, customers } = this.data;
    
    let filtered = customers.filter(customer => {
      // 状态筛选
      if (filterStatus !== 'all' && customer.status !== filterStatus) {
        return false;
      }
      
      // 搜索关键词筛选
      if (searchKeyword) {
        const keyword = searchKeyword.toLowerCase();
        return customer.name.toLowerCase().includes(keyword) ||
               (customer.shortName && customer.shortName.toLowerCase().includes(keyword)) ||
               customer.contact.toLowerCase().includes(keyword) ||
               customer.phone.includes(keyword);
      }
      
      return true;
    });
    
    this.setData({
      filteredCustomers: filtered,
      customerShown: filtered.length,
      customerTotal: (customers || []).length
    });
  },

  onNewCustomerPaymentTermChange: function(e) {
    const idx = e && e.detail ? Number(e.detail.value) : NaN;
    const options = this.data.paymentOptions || [];
    const value = Number.isFinite(idx) && options[idx] ? options[idx] : '';
    this.setData({
      ['newCustomer.paymentTerms']: value
    });
  },

  // 查看客户详情
  viewCustomerDetail: function(e) {
    const customerId = e.currentTarget.dataset.id;
    const customer = this.data.customers.find(c => c.id === customerId);
    
    if (customer) {
      const key = `customer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        wx.setStorageSync(key, customer);
        wx.navigateTo({
          url: `/pages/management-sub/customers/detail/detail?key=${encodeURIComponent(key)}`,
          fail: () => { this.showCustomerInfo(customer); }
        });
      } catch (_) {
        this.showCustomerInfo(customer);
      }
    }
  },

  // 显示客户信息
  showCustomerInfo: function(customer) {
    wx.showModal({
      title: customer.name,
      content: `联系人：${customer.contact}\n电话：${customer.phone}\n邮箱：${customer.email}\n地址：${customer.address}`,
      showCancel: false,
      confirmText: '确定'
    });
  },

  // 编辑客户
  editCustomer: function(e) {
    const customerId = e.currentTarget.dataset.id;
    const customer = this.data.customers.find(c => c.id === customerId);
    
    if (customer) {
      const key = `customer_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        wx.setStorageSync(key, customer);
      } catch (_) {}
      wx.navigateTo({
        url: `/pages/management-sub/customers/edit/edit?type=customer&key=${encodeURIComponent(key)}`
      });
    }
  },

  editSupplier: function(e) {
    const supplierId = e.currentTarget.dataset.id;
    const supplier = (this.data.suppliers || []).find(s => s.id === supplierId);
    if (!supplier) return;
    const key = `supplier_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try { wx.setStorageSync(key, supplier); } catch (_) {}
    wx.navigateTo({ url: `/pages/management-sub/customers/edit/edit?type=supplier&key=${encodeURIComponent(key)}` });
  },

  deleteSupplier: function(e) {
    const supplierId = e.currentTarget.dataset.id;
    const supplier = (this.data.suppliers || []).find(s => s.id === supplierId);
    if (!supplier) {
      wx.showToast({ title: '找不到要删除的供应商', icon: 'none' });
      return;
    }
    wx.showModal({
      title: '确认删除',
      content: `确定要删除供应商"${supplier.name}"吗？`,
      success: (res) => {
        if (!res.confirm) return;
        wx.showLoading({ title: '删除中...', mask: true });
        wx.cloud.callFunction({
          name: 'erp-api',
          data: {
            action: 'deleteSupplier',
            id: supplier._id || supplier.id,
            _id: supplier._id,
            supplierId: supplier.id
          }
        }).then((resp) => {
          wx.hideLoading();
          const result = resp && resp.result ? resp.result : {};
          if (result.success) {
            const suppliers = (this.data.suppliers || []).filter(s => s.id !== supplierId);
            const next = { suppliers, filteredSuppliers: null };
            this.setData(Object.assign({}, next, this.updateStats(next)));
            wx.showToast({ title: '删除成功', icon: 'success' });
            return;
          }
          wx.showToast({ title: result.message || '删除失败', icon: 'none' });
        }).catch((err) => {
          wx.hideLoading();
          wx.showToast({ title: err.message || '删除失败', icon: 'none' });
        });
      }
    });
  },

  showAddCustomerPage: function() {
    wx.navigateTo({
      url: '/pages/management-sub/customers/add-customer/add-customer?type=customer'
    });
  },

  showAddSupplierPage: function() {
    wx.navigateTo({
      url: '/pages/management-sub/customers/add-customer/add-customer?type=supplier'
    });
  },

  // 添加客户
  addCustomer: function() {
    this.setData({
      showAddModal: true
    });
  },

  // 关闭添加模态框
  closeAddModal: function() {
    this.setData({
      showAddModal: false,
      newCustomer: {
        name: '',
        shortName: '',
        paymentTerms: '现结',
        contact: '',
        phone: '',
        email: '',
        address: '',
        status: 'active'
      }
    });
  },

  // 输入新客户信息
  onNewCustomerInput: function(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail.value;
    
    this.setData({
      [`newCustomer.${field}`]: value
    });
  },

  // 保存新客户
  saveNewCustomer: function() {
    const newCustomer = this.data.newCustomer;
    
    if (!newCustomer.name.trim()) {
      wx.showToast({
        title: '请输入客户名称',
        icon: 'none'
      });
      return;
    }
    
    if (!newCustomer.contact.trim()) {
      wx.showToast({
        title: '请输入联系人',
        icon: 'none'
      });
      return;
    }
    
    wx.showLoading({ title: '保存中...', mask: true });
    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'createCustomer',
        data: newCustomer
      }
    }).then(res => {
      wx.hideLoading();
      if (res.result && res.result.success) {
        const c = res.result.data;
        const mapped = {
          id: c._id, // 用文档ID作为业务ID
          docId: c._id,
          _id: c._id,
          name: c.companyName || newCustomer.name,
          shortName: c.shortName || newCustomer.shortName,
          paymentTerms: c.paymentTerms || newCustomer.paymentTerms,
          contact: c.contactName || newCustomer.contact,
          phone: c.phone,
          email: c.email,
          address: c.address,
          status: c.status || 'active',
          orderCount: 0,
          totalAmount: 0,
          lastOrderDate: '',
          frequency: 1
        };
        this.setData({
          customers: [mapped, ...this.data.customers],
          showAddModal: false,
          filteredCustomers: null
        });
        this.setData(this.updateStats({}));
        wx.showToast({ title: '客户添加成功', icon: 'success' });
      } else {
        const msg = res.result?.error || res.result?.message || '保存失败';
        wx.showToast({ title: msg, icon: 'none' });
      }
    }).catch(err => {
      wx.hideLoading();
      wx.showToast({ title: err.message || '保存失败', icon: 'none' });
    });
  },

  // 添加新客户（供编辑页面调用）
  addNewCustomer: function(formData) {
    const customers = [...this.data.customers];
    const newId = 'C' + String(customers.length + 1).padStart(3, '0');
    
    customers.unshift({
      id: newId,
      ...formData,
      orderCount: 0,
      totalAmount: 0,
      lastOrderDate: '',
      frequency: 1
    });
    
    this.setData({
      customers: customers
    });
  },

  // 更新客户信息（供编辑页面调用）
  updateCustomer: function(customerId, formData) {
    const customers = this.data.customers.map(customer => {
      if (customer.id === customerId) {
        return {
          ...customer,
          ...formData
        };
      }
      return customer;
    });
    
    this.setData({
      customers: customers
    });
  },

  // 删除客户（供编辑页面调用）
  deleteCustomerByPage: function(customerId) {
    const customers = this.data.customers.filter(customer => customer.id !== customerId);
    this.setData({ customers });
  },

  // 删除客户
  deleteCustomer: function(e) {
    const customerId = e.currentTarget.dataset.id;
    console.log('删除客户，传入的ID:', customerId);
    
    const customer = this.data.customers.find(c => c.id === customerId);
    
    if (!customer) {
      wx.showToast({
        title: '找不到要删除的客户',
        icon: 'none'
      });
      return;
    }
    
    wx.showModal({
      title: '确认删除',
      content: `确定要删除客户"${customer.name}"吗？`,
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({
            title: '删除中...',
            mask: true
          });
          
          // 直接使用云数据库删除
          const db = wx.cloud.database();
          console.log('准备删除客户，ID:', customerId);
          console.log('客户记录详情:', customer);
          
          // 优先尝试使用云函数删除，它已经有openid检查
          console.log('尝试使用云函数删除客户:', customerId);
          wx.cloud.callFunction({
            name: 'erp-api',
            data: {
              action: 'deleteCustomer',
              // 同时传递多种可能的标识，提升云端匹配成功率
              id: customerId,
              customerId: customerId,
              docId: customer.docId,
              _id: customer._id
            }
          }).then(res => {
            if (res.result && res.result.success) {
              this.handleDeleteSuccess(customerId);
            } else {
              const msg = res.result?.error || res.result?.message || '删除失败';
              console.error('云函数删除失败:', msg);
              this.tryDirectDeleteWithOpenid(customerId);
            }
          }).catch(err => {
            console.error('云函数调用失败:', err);
            // 降级为直接删除
            this.tryDirectDeleteWithOpenid(customerId);
          });
        }
      }
    });
  },

  // 处理删除成功后的操作
  handleDeleteSuccess: function(customerId) {
    wx.hideLoading();
    
    // 删除成功，更新本地数据
    const customers = this.data.customers.filter(c => c.id !== customerId);
    this.setData({ customers });
    wx.showToast({
      title: '删除成功',
      icon: 'success'
    });
    console.log('客户删除成功，已从本地列表移除');
  },

  // 尝试直接删除，包含openid检查
  tryDirectDeleteWithOpenid: function(customerId) {
    console.log('尝试直接删除，不直接使用openid');
    
    const db = wx.cloud.database();
    
    // 优先使用文档ID
    const customer = this.data.customers.find(c => c.id === customerId);
    if (customer && customer.docId) {
      console.log('使用客户的文档ID删除:', customer.docId);
      db.collection('customers').doc(customer.docId).remove({
        success: (res) => {
          console.log('使用文档ID删除成功');
          this.handleDeleteSuccess(customerId);
        },
        fail: (err) => {
          console.error('使用文档ID删除失败:', err);
          this.tryDeleteWithQuery(customerId);
        }
      });
    } else {
      this.tryDeleteWithQuery(customerId);
    }
  },

  // 使用查询删除，不直接使用openid（由云数据库自动处理）
  tryDeleteWithQuery: function(customerId) {
    const db = wx.cloud.database();
    
    // 方法1: 查询_id字段匹配的记录
    db.collection('customers').where({
      _id: customerId
    }).get({
      success: (queryRes) => {
        if (queryRes.data.length > 0) {
          const docId = queryRes.data[0]._id;
          console.log('通过_id查询找到客户记录，ID:', docId);
          this.deleteByDocId(docId, customerId);
        } else {
          // 方法2: 查询id字段匹配的记录
          db.collection('customers').where({
            id: customerId
          }).get({
            success: (queryRes2) => {
              if (queryRes2.data.length > 0) {
                const docId = queryRes2.data[0]._id;
                console.log('通过id查询找到客户记录，ID:', docId);
                this.deleteByDocId(docId, customerId);
              } else {
                // 方法3: 获取所有客户进行比对
                db.collection('customers').get({
                  success: (allRes) => {
                    const matchedCustomer = allRes.data.find(c => 
                      c.id === customerId || c._id === customerId
                    );
                    if (matchedCustomer) {
                      console.log('通过全量搜索找到客户记录，ID:', matchedCustomer._id);
                      this.deleteByDocId(matchedCustomer._id, customerId);
                    } else {
                      wx.hideLoading();
                      wx.showToast({
                        title: '找不到要删除的客户',
                        icon: 'none'
                      });
                    }
                  },
                  fail: (err) => {
                    console.error('获取所有客户失败:', err);
                    this.handleDeleteFailed();
                  }
                });
              }
            },
            fail: (err) => {
              console.error('id字段查询失败:', err);
              this.handleDeleteFailed();
            }
          });
        }
      },
      fail: (err) => {
        console.error('_id字段查询失败:', err);
        this.handleDeleteFailed();
      }
    });
  },

  // 使用文档ID删除记录
  deleteByDocId: function(docId, originalId) {
    const db = wx.cloud.database();
    db.collection('customers').doc(docId).remove({
      success: (res) => {
        console.log('查询后删除成功，文档ID:', docId);
        this.handleDeleteSuccess(originalId);
      },
      fail: (err) => {
        console.error('查询后删除失败:', err);
        this.handleDeleteFailed();
      }
    });
  },

  // 尝试使用云函数删除
  tryCloudFunctionDelete: function(customerId) {
    console.log('尝试使用云函数删除客户:', customerId);
    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'deleteCustomer',
        id: customerId
      }
    }).then(res => {
      console.log('云函数删除结果:', res);
      if (res.result && res.result.success) {
        this.handleDeleteSuccess(customerId);
      } else {
        this.handleDeleteFailed();
      }
    }).catch(err => {
      console.error('云函数删除失败:', err);
      this.handleDeleteFailed();
    });
  },

  // 处理删除失败
  handleDeleteFailed: function() {
    wx.hideLoading();
    wx.showToast({
      title: '删除失败',
      icon: 'none'
    });
  },

  // 刷新数据
  onPullDownRefresh: function() {
    this.loadCustomers();
    wx.stopPullDownRefresh();
  }
});
