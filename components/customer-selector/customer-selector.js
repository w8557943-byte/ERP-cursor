// components/customer-selector/customer-selector.js
Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    },
    selectedId: {
      type: String,
      value: ''
    }
  },

  data: {
    customers: [],
    loading: false,
    searchText: '',
    filteredCustomers: []
  },

  lifetimes: {
    attached() {
      this.loadCustomers();
    }
  },

  observers: {
    'searchText': function(searchText) {
      this.filterCustomers(searchText);
    },
    'show': function(show) {
      if (show) {
        this.setData({ searchText: '' });
        this.loadCustomers();
      }
    }
  },

  methods: {
    /**
     * 加载客户列表
     */
    loadCustomers: function() {
      this.setData({ loading: true });
      
      // 调用云函数获取客户列表
      wx.cloud.callFunction({
        name: 'erp-api',
        data: {
          action: 'getCustomers',
          params: {
            page: 1,
            limit: 100
          }
        }
      }).then(res => {
        if (res.result && res.result.success) {
          this.setData({
            customers: res.result.data || [],
            filteredCustomers: res.result.data || []
          });
        }
      }).catch(err => {
        console.error('加载客户列表失败:', err);
        wx.showToast({
          title: '加载客户列表失败',
          icon: 'none'
        });
      }).finally(() => {
        this.setData({ loading: false });
      });
    },

    /**
     * 搜索客户
     */
    onSearch: function(e) {
      this.setData({
        searchText: e.detail.value
      });
    },

    /**
     * 过滤客户
     */
    filterCustomers: function(searchText) {
      const customers = this.data.customers;
      
      if (!searchText.trim()) {
        this.setData({ filteredCustomers: customers });
        return;
      }
      
      const filtered = customers.filter(customer => 
        customer.name.toLowerCase().includes(searchText.toLowerCase()) ||
        customer.phone.includes(searchText) ||
        (customer.contact && customer.contact.toLowerCase().includes(searchText.toLowerCase()))
      );
      
      this.setData({ filteredCustomers: filtered });
    },

    /**
     * 选择客户
     */
    selectCustomer: function(e) {
      const customer = e.currentTarget.dataset.customer;
      
      this.triggerEvent('select', customer);
      this.cancel();
    },

    /**
     * 取消选择
     */
    cancel: function() {
      this.triggerEvent('cancel');
    }
  }
});