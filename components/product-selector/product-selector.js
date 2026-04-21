// components/product-selector/product-selector.js
Component({
  properties: {
    show: {
      type: Boolean,
      value: false
    },
    selectedIds: {
      type: Array,
      value: []
    }
  },

  data: {
    products: [],
    loading: false,
    searchText: '',
    filteredProducts: [],
    categories: [],
    selectedCategory: '',
    sortBy: 'name' // name, price, created
  },

  lifetimes: {
    attached() {
      this.loadProducts();
    }
  },

  observers: {
    'searchText': function(searchText) {
      this.filterProducts(searchText);
    },
    'selectedCategory': function(category) {
      this.filterProducts(this.data.searchText);
    },
    'sortBy': function(sortBy) {
      this.sortProducts(sortBy);
    }
  },

  methods: {
    /**
     * 加载产品列表
     */
    loadProducts: function() {
      this.setData({ loading: true });
      
      // 调用云函数获取产品列表
      wx.cloud.callFunction({
        name: 'erp-api',
        data: {
          action: 'getProducts',
          params: {
            page: 1,
            limit: 100
          }
        }
      }).then(res => {
        if (res.result && res.result.success) {
          const products = res.result.data || [];
          const categories = this.extractCategories(products);
          
          this.setData({
            products,
            filteredProducts: products,
            categories
          });
        }
      }).catch(err => {
        console.error('加载产品列表失败:', err);
        wx.showToast({
          title: '加载产品列表失败',
          icon: 'none'
        });
      }).finally(() => {
        this.setData({ loading: false });
      });
    },

    /**
     * 提取产品分类
     */
    extractCategories: function(products) {
      const categorySet = new Set();
      
      products.forEach(product => {
        if (product.category) {
          categorySet.add(product.category);
        }
      });
      
      return Array.from(categorySet).sort();
    },

    /**
     * 搜索产品
     */
    onSearch: function(e) {
      this.setData({
        searchText: e.detail.value
      });
    },

    /**
     * 分类选择
     */
    onCategoryChange: function(e) {
      this.setData({
        selectedCategory: e.detail.value
      });
    },

    /**
     * 排序方式选择
     */
    onSortChange: function(e) {
      this.setData({
        sortBy: e.detail.value
      });
    },

    /**
     * 过滤产品
     */
    filterProducts: function(searchText) {
      let products = this.data.products;
      
      // 按分类过滤
      if (this.data.selectedCategory) {
        products = products.filter(product => 
          product.category === this.data.selectedCategory
        );
      }
      
      // 按搜索文本过滤
      if (searchText.trim()) {
        products = products.filter(product => 
          product.name.toLowerCase().includes(searchText.toLowerCase()) ||
          product.code.toLowerCase().includes(searchText.toLowerCase()) ||
          (product.description && product.description.toLowerCase().includes(searchText.toLowerCase()))
        );
      }
      
      // 排序
      this.sortProducts(this.data.sortBy, products);
    },

    /**
     * 排序产品
     */
    sortProducts: function(sortBy, products = null) {
      const productList = products || this.data.filteredProducts;
      
      switch (sortBy) {
        case 'name':
          productList.sort((a, b) => a.name.localeCompare(b.name));
          break;
        case 'price':
          productList.sort((a, b) => (a.price || 0) - (b.price || 0));
          break;
        case 'created':
          productList.sort((a, b) => b.createdAt - a.createdAt);
          break;
        default:
          productList.sort((a, b) => a.name.localeCompare(b.name));
      }
      
      this.setData({ filteredProducts: productList });
    },

    /**
     * 选择产品
     */
    selectProduct: function(e) {
      const product = e.currentTarget.dataset.product;
      
      this.triggerEvent('select', product);
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