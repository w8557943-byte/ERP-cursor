Page({
  data: {
    viewType: 'production',
    searchQuery: '',
    timeSort: 'desc',
    qtySort: 'high',
    isRefreshing: false,
    displayList: [],
    customerList: [],
    selectedCustomerIndex: -1,
    selectedCustomerName: '',
    invCount: 0,
    staleCount: 0,
    inventoryTotalAmount: 0,
    inventoryHealthScore: 0,
    sortMode: 'time',
    sortDir: 'desc',
    sortModeOptions: ['入库时间', '订单数量', '订单金额'],
    sortModeText: '入库时间'
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
    this.customerMap = {};
    this.supplierMap = {};
    this.loadCustomersAndSuppliers().then(() => {
        if (this.rawList && this.rawList.length > 0) {
            this.reprocessList();
        }
    });
    this.loadInventory();
  },

  loadCustomersAndSuppliers: function() {
    const p1 = wx.cloud.callFunction({
      name: 'erp-api',
      data: { action: 'getCustomers' }
    }).then(res => {
        const list = (res.result && (res.result.data || res.result.customers)) ? (res.result.data || res.result.customers) : [];
        list.forEach(c => {
            const name = c.companyName || c.name;
            if (name) this.customerMap[name] = c.shortName || name;
        });
    }).catch(err => console.error('加载客户简称失败', err));

    const p2 = wx.cloud.callFunction({
      name: 'erp-api',
      data: { action: 'getSuppliers', params: { limit: 1000 } }
    }).then(res => {
        const list = (res.result && (res.result.data || res.result.suppliers)) ? (res.result.data || res.result.suppliers) : [];
        list.forEach(s => {
            const name = s.name;
            if (name) this.supplierMap[name] = s.shortName || name;
        });
    }).catch(err => console.error('加载供应商简称失败', err));

    return Promise.all([p1, p2]);
  },

  reprocessList: function() {
      // Re-map the raw list with new short names
      if (!this.rawList) return;
      const isPurchased = this.data.viewType === 'purchased';

      const nameMap = isPurchased ? (this.supplierMap || {}) : (this.customerMap || {});
      const newList = (Array.isArray(this.rawList) ? this.rawList : []).map(item => {
          const baseName = isPurchased ? (item.originalSupplierName || item.customerName) : item.customerName;
          const mappedName = baseName && nameMap[baseName] ? nameMap[baseName] : baseName;
          return { ...item, customerName: mappedName || '' };
      });

      this.rawList = newList;

      const customers = Array.from(new Set(newList.map(i => i && i.customerName).filter(Boolean)));
      const prevSelected = this.data.selectedCustomerName || '';
      let nextSelected = prevSelected;
      if (prevSelected && nameMap[prevSelected]) nextSelected = nameMap[prevSelected];

      if (nextSelected && customers.indexOf(nextSelected) < 0) {
        nextSelected = '';
      }

      const nextIndex = nextSelected ? customers.indexOf(nextSelected) : -1;
      this.setData({ customerList: customers, selectedCustomerName: nextSelected, selectedCustomerIndex: nextIndex });
      this.applyFilters();
  },

  onPullDownRefresh: function() {
    this.onRefresh();
  },

  onRefresh: function() {
    this.setData({ isRefreshing: true });
    this.loadInventory().finally(() => {
      this.setData({ isRefreshing: false });
      wx.stopPullDownRefresh();
    });
  },

  onSearchInput: function(e) {
    const q = (e.detail && e.detail.value) ? e.detail.value : '';
    this.setData({ searchQuery: q });
    this.applyFilters();
  },

  clearSearch: function() {
    this.setData({ searchQuery: '' });
    this.applyFilters();
  },

  toggleTimeSort: function() {
    const next = this.data.timeSort === 'desc' ? 'asc' : 'desc';
    this.setData({ timeSort: next });
    this.applyFilters();
  },

  toggleQtySort: function() {
    const next = this.data.qtySort === 'high' ? 'low' : 'high';
    this.setData({ qtySort: next });
    this.applyFilters();
  },

  switchView: function(e) {
    const type = e.currentTarget.dataset.type;
    if (type === this.data.viewType) return;
    this.setData({ viewType: type, displayList: [], isRefreshing: true });
    this.loadInventory().finally(() => {
      this.setData({ isRefreshing: false });
    });
  },

  loadInventory: function() {
    const isPurchased = this.data.viewType === 'purchased';
    const action = isPurchased ? 'getPurchaseOrders' : 'getOrders';

    const fetchAll = async () => {
      const pageSize = 200;
      const maxPages = 20;
      const all = [];
      for (let page = 1; page <= maxPages; page += 1) {
        const res = await wx.cloud.callFunction({
          name: 'erp-api',
          data: { action: action, params: { page, limit: pageSize } }
        });
        const rows = (res && res.result && res.result.data) ? res.result.data : [];
        if (Array.isArray(rows) && rows.length) {
          all.push(...rows);
        }
        if (!Array.isArray(rows) || rows.length < pageSize) break;
      }
      return all;
    };

    return fetchAll().then(orders => {
      let list = [];

      if (isPurchased) {
        list = orders.filter(o => {
          const cat = String(o.purchaseCategory || o.category || '').toLowerCase();
          const status = String(o.status || '').toLowerCase();
          const orderQty = Number(o.quantity || 0);
          const shippedQty = Number(o.shippedQty || o.deliveredQty || 0);
          const rawStockedQty = Number(o.stockedQty || 0);
          const stockedQty = rawStockedQty > 0
            ? rawStockedQty
            : (['stocked', 'completed', 'warehoused', 'done', '已入库'].includes(status) ? orderQty : 0);
          const inv = Math.max(0, stockedQty - shippedQty);
          return cat !== 'raw_materials' && cat !== 'boards' && inv > 0;
        }).map(o => {
          const createdAt = typeof o.createdAt === 'string' ? Date.parse(o.createdAt) : (typeof o.createdAt === 'number' ? o.createdAt : Date.now());
          
          // Stocked Time
          const stockedAtRaw = o.stockedAt || o.stockTime || o.updatedAt || Date.now();
          const stockedAtTs = typeof stockedAtRaw === 'string' ? Date.parse(stockedAtRaw) : (typeof stockedAtRaw === 'number' ? stockedAtRaw : Date.now());
          
          const status = String(o.status || '').toLowerCase();
          const unitPrice = Number((o.items && o.items[0] && o.items[0].unitPrice) || o.unitPrice || o.purchasePrice || o.salePrice || 0);
          const orderQty = Number(o.quantity || 0);
          const shippedQty = Number(o.shippedQty || o.deliveredQty || 0);
          const rawStockedQty = Number(o.stockedQty || 0);
          const stockedQty = rawStockedQty > 0
            ? rawStockedQty
            : (['stocked', 'completed', 'warehoused', 'done', '已入库'].includes(status) ? orderQty : 0);
          const inv = Math.max(0, stockedQty - shippedQty);

          return {
            id: o._id || o.id || '',
            orderNo: o.orderNo || o.orderNumber || '',
            originalSupplierName: o.supplierName, // Store original for remapping
            customerName: o.customerName || o.supplierName || '', // Use customer name instead of supplier
            productName: o.productTitle || o.goodsName || '未知商品',
            goodsName: o.productTitle || o.goodsName || '未知商品',
            spec: o.spec || o.materialNo || '',
            materialNo: o.materialNo || '无',
            unit: o.unit || '份',
            inventoryQty: inv,
            stockedAtTs: stockedAtTs,
            stockedAtText: this.formatTime(stockedAtTs),
            createdAtText: this.formatTime(createdAt),
            createdAtTs: createdAt,
            unitPrice: unitPrice,
            orderQty: orderQty,
            orderAmount: Number(o.amount || (orderQty * unitPrice) || 0),
            orderAmountFormatted: (Number(o.amount || (orderQty * unitPrice) || 0)).toFixed(2)
          };
        });
      } else {
        list = orders.filter(o => {
          const cat = String(o.purchaseCategory || o.category || '').toLowerCase();
          return cat !== 'raw_materials' && cat !== 'boards';
        }).map(o => {
          const status = String(o.status || '').toLowerCase();
          const unitPrice = Number((o.items && o.items[0] && o.items[0].unitPrice) || o.unitPrice || 0);
          const orderQty = Number(o.quantity || (Array.isArray(o.items) ? o.items.reduce((s, it) => s + (Number(it.quantity)||0), 0) : 0));
          const shippedQty = Number(o.shippedQty || o.deliveredQty || 0);
          const rawStockedQty = Number(o.stockedQty || 0);
          const stockedQty = rawStockedQty > 0
            ? rawStockedQty
            : (['stocked', 'completed', 'warehoused', 'done', '已入库'].includes(status) ? orderQty : 0);
          const inv = Math.max(0, stockedQty - shippedQty);
          const stockedAt = o.stockedAt || o.updatedAt || o.updateTime || o.createTime || Date.now();
          const t = typeof stockedAt === 'string' ? Date.parse(stockedAt) : (typeof stockedAt === 'number' ? stockedAt : Date.now());
          const orderAmount = Number(o.amount || o.totalAmount || (orderQty * unitPrice) || 0);
          const createdRaw = (typeof o.createdAt === 'number' ? o.createdAt : (typeof o.createTime === 'number' ? o.createTime : Date.parse(o.createdAt || o.createTime || '')));
          return {
            id: o._id || o.id || '',
            orderNo: o.orderNo || o.orderNumber || '',
            customerName: o.customerName || '',
            productName: o.productName || (o.product && o.product.name) || '无',
            goodsName: (o.goodsName || o.productTitle || (Array.isArray(o.items) && o.items[0] && (o.items[0].goodsName || o.items[0].title || o.items[0].productName)) || o.goods_name || o.title || ''),
            spec: o.spec || '',
            materialCode: o.materialCode || '',
            materialNo: o.materialNo || '无',
            unit: o.unit || (o.items && o.items[0] && o.items[0].unit) || '份',
            inventoryQty: inv,
            stockedAtTs: isNaN(t) ? Date.now() : t,
            stockedAtText: this.formatTime(isNaN(t) ? Date.now() : t),
            createdAtText: this.formatTime(typeof (o.createdAt || o.createTime || o.created_at) === 'number' ? (o.createdAt || o.createTime || o.created_at) : Date.parse(o.createdAt || o.createTime || o.created_at || Date.now())),
            createdAtTs: isNaN(createdRaw) ? 0 : createdRaw,
            unitPrice: unitPrice,
            orderQty: orderQty,
            orderAmount: orderAmount
          };
        }).filter(it => it.inventoryQty > 0);
      }
      this.rawList = list;
      const customers = Array.from(new Set(list.map(i => i.customerName).filter(Boolean)));
      this.setData({ customerList: customers });
      // 统计数据计算
      const now = Date.now();
      const twoWeeksMs = 14 * 24 * 60 * 60 * 1000;
      const invCount = list.length;
      const staleCount = list.filter(it => (it.stockedAtTs && (now - it.stockedAtTs) >= twoWeeksMs)).length;
      const inventoryTotalAmount = list.reduce((sum, it) => sum + Number(it.inventoryQty || 0) * Number(it.unitPrice || 0), 0);
      const unfinishedTotal = (orders || []).filter(o => {
        const cat = String(o.purchaseCategory || o.category || '').toLowerCase();
        if (cat === 'raw_materials') return false;
        if (cat === 'boards') return false;
        const s = String(o.status || '').toLowerCase();
        if (['cancelled', 'canceled', '已取消'].includes(s) || o.status === '已取消') return false;
        if (['completed', 'done', 'finished', '已完成'].includes(s) || o.status === '已完成') return false;
        return true;
      }).length;
      const inventoryHealthScore = unfinishedTotal > 0
        ? Math.max(0, Math.min(100, Math.round(100 - (staleCount / unfinishedTotal) * 100)))
        : 100;
      this.setData({ invCount, staleCount, inventoryTotalAmount: Number(inventoryTotalAmount.toFixed(2)), inventoryHealthScore });
      this.reprocessList();
    }).catch(() => {
      this.rawList = [];
      this.reprocessList();
    });
  },

  applyFilters: function() {
    const q = (this.data.searchQuery || '').trim().toLowerCase();
    const sortMode = this.data.sortMode;
    const sortDir = this.data.sortDir;
    let arr = (this.rawList || []).slice();
    if (q) {
      arr = arr.filter(it => [it.orderNo, it.customerName, it.goodsName, it.spec].some(s => String(s).toLowerCase().includes(q)));
    }
    if (this.data.selectedCustomerName) {
      arr = arr.filter(it => it.customerName === this.data.selectedCustomerName);
    }
    arr.sort((a, b) => {
      let av = 0; let bv = 0;
      if (sortMode === 'time') { av = Number(a.stockedAtTs||0); bv = Number(b.stockedAtTs||0); }
      else if (sortMode === 'qty') { av = Number(a.orderQty||0); bv = Number(b.orderQty||0); }
      else if (sortMode === 'amount') { av = Number(a.orderAmount||0); bv = Number(b.orderAmount||0); }
      return sortDir === 'desc' ? (bv - av) : (av - bv);
    });
    this.setData({ displayList: arr });
  },

  onSortModeChange: function(e) {
    const idx = Number(e.detail.value || 0);
    const map = ['time','qty','amount'];
    const text = (this.data.sortModeOptions || [])[idx] || '入库时间';
    this.setData({ sortMode: map[idx] || 'time', sortModeText: text });
    this.applyFilters();
  },

  toggleSortDir: function() {
    const next = this.data.sortDir === 'desc' ? 'asc' : 'desc';
    this.setData({ sortDir: next });
    this.applyFilters();
  },

  formatTime: function(ts) {
    try {
      const d = new Date(ts);
      const Y = d.getFullYear();
      const M = String(d.getMonth() + 1).padStart(2, '0');
      const D = String(d.getDate()).padStart(2, '0');
      const h = String(d.getHours()).padStart(2, '0');
      const m = String(d.getMinutes()).padStart(2, '0');
      return `${Y}-${M}-${D} ${h}:${m}`;
    } catch (_) { return ''; }
  }
  ,
  goToOrderDetail: function(e) {
    const id = e.currentTarget.dataset.orderId || '';
    const no = e.currentTarget.dataset.orderNo || '';
    if (!id && !no) { wx.showToast({ title: '订单信息缺失', icon: 'none' }); return; }

    if (this.data.viewType === 'purchased') {
      // 采购订单详情
      if (id) {
        wx.navigateTo({
          url: `/pages/purchase-sub/detail/detail?id=${id}`
        });
      } else {
        wx.showToast({ title: '缺少订单ID', icon: 'none' });
      }
    } else {
      // 生产订单详情
      const base = id ? `?orderId=${encodeURIComponent(id)}` : `?orderNo=${encodeURIComponent(no)}`;
      const qs = base ? `${base}&from=inventory` : `?from=inventory`;
      wx.navigateTo({ url: `/pages/production-sub/detail/detail${qs}` });
    }
  },

  onCustomerPickerChange: function(e) {
    const idx = Number(e.detail.value || -1);
    const name = (this.data.customerList || [])[idx] || '';
    this.setData({ selectedCustomerIndex: idx, selectedCustomerName: name });
    this.applyFilters();
  }
  ,
  clearCustomerFilter: function() {
    this.setData({ selectedCustomerIndex: -1, selectedCustomerName: '' });
    this.applyFilters();
  }
});
