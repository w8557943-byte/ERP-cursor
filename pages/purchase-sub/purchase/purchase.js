const app = getApp();
const { API, clearCache } = require('../../../utils/unified-api');
const { logger } = require('../../../utils/logger');

Page({
  data: {
    viewType: 'goods', // 'goods' | 'raw_materials'
    searchKeyword: '',
    isRefreshing: false,
    displayList: [],
    rawList: [], // Store raw processed list for filtering

    // 统计数据
    totalOrders: 0,
    stockedOrders: 0,
    purchaseTotalAmount: '0.00',
    staleOrdersCount: 0,

    // 筛选状态
    isStaleFilter: false,

    // 筛选
    sortMode: 'time',
    sortDir: 'desc',

    // 入库弹窗
    showStockInModal: false,
    currentOrder: null,
    stockInQty: '',
    supplierMap: {},
    customerMap: {}
  },

  ensureAllowed: function () {
    let userInfo = null;
    try {
      userInfo = wx.getStorageSync('userInfo') || null;
    } catch (e) { }
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

  onLoad: function (options) {
    if (!this.ensureAllowed()) return;
    this.loadSuppliers();
    this.loadCustomers();
    this.loadData();
  },

  async loadCustomers() {
    try {
      const response = await API.getCustomers();
      const list = response.data || response.customers || [];
      const map = {};
      list.forEach(c => {
        const name = c.companyName || c.name;
        if (name) map[name] = c.shortName || name;
      });
      this.setData({ customerMap: map });

      // Update existing list if data already loaded
      if (this.data.rawList && this.data.rawList.length > 0) {
        const updatedList = this.data.rawList.map(o => ({
          ...o,
          customerName: map[o.originalCustomerName || o.customerName] || o.originalCustomerName || o.customerName || ''
        }));
        this.setData({
          rawList: updatedList,
          displayList: this.data.isStaleFilter ? this.filterStale(updatedList) : updatedList
        });
      }
    } catch (err) {
      logger.error('Purchase', '加载客户简称失败', err);
    }
  },

  async loadSuppliers() {
    try {
      const response = await API.getSuppliers({ limit: 1000 });
      const list = response.data || response.suppliers || [];
      const map = {};
      list.forEach(s => {
        const name = s.name;
        if (name) map[name] = s.shortName || name;
      });
      this.setData({ supplierMap: map });

      // Update existing list if data already loaded
      if (this.data.rawList && this.data.rawList.length > 0) {
        const updatedList = this.data.rawList.map(o => ({
          ...o,
          supplierName: map[o.originalSupplierName || o.supplierName] || o.originalSupplierName || o.supplierName || '未知供应商'
        }));
        this.setData({
          rawList: updatedList,
          displayList: this.data.isStaleFilter ? this.filterStale(updatedList) : updatedList // Assuming filterStale exists or I just use same logic
        });
        // Since filterStale is not a separate function in my snippet (it was inline in toggleStaleFilter),
        // I should probably just re-apply the current filter logic.
        // Or simpler: just update rawList and call toggleStaleFilter(current_status)?
        // toggleStaleFilter toggles. I want to APPLY current.
        // Let's just update displayList directly if not filtered, or re-filter.

        if (this.data.isStaleFilter) {
          // Re-apply stale filter
          const now = Date.now();
          const thirtyDays = 30 * 24 * 60 * 60 * 1000;
          const staleList = updatedList.filter(o => {
            if (o.status !== 'stocked' && o.status !== 'completed') return false;
            const stockTime = o.stockedAtTs || o.updatedAtTs || o.createdAtTs;
            return (now - stockTime) > thirtyDays;
          });
          this.setData({ displayList: staleList });
        } else {
          this.setData({ displayList: updatedList });
        }
      }
    } catch (err) {
      logger.error('Purchase', '加载供应商简称失败', err);
    }
  },

  onShow: function () {
    if (!this.ensureAllowed()) return;
    // 每次显示页面时刷新数据，确保数据最新
    this.loadData();
  },

  onPullDownRefresh: function () {
    this.loadData().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  // 切换视图：商品采购 / 辅材采购
  switchView: function (e) {
    const type = e.currentTarget.dataset.type;
    if (type === this.data.viewType) return;

    this.setData({
      viewType: type,
      displayList: [], // 清空列表，显示加载状态
      isStaleFilter: false // 切换视图时重置筛选
    });

    this.loadData();
  },

  // 重置筛选（点击全部采购）
  resetFilter: function () {
    if (!this.data.isStaleFilter) return;
    this.setData({
      isStaleFilter: false,
      displayList: this.data.rawList
    });
  },

  // 切换呆滞订单筛选
  toggleStaleFilter: function () {
    const nextState = !this.data.isStaleFilter;
    this.setData({ isStaleFilter: nextState });

    if (nextState) {
      this.setData({ displayList: this.filterStale(this.data.rawList) });
    } else {
      // 恢复显示全部
      this.setData({ displayList: this.data.rawList });
    }
  },

  filterStale: function (list) {
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    return list.filter(o => {
      if (o.status !== 'stocked' && o.status !== 'completed') return false;
      const stockTime = o.stockedAtTs || o.updatedAtTs || o.createdAtTs;
      return (now - stockTime) > thirtyDays;
    });
  },

  // 加载数据
  async loadData() {
    this.setData({ isRefreshing: true });

    try {
      const res = await API.getPurchaseOrders({ limit: 500 });
      const allOrders = res.data || [];

      // 根据视图类型筛选
      const filteredOrders = allOrders.filter(o => {
        const cat = String(o.purchaseCategory || o.category || '').toLowerCase();
        const firstItem = (o.items && o.items[0]) || {};
        const name = String(o.goodsName || o.productTitle || o.product?.name || firstItem.goodsName || firstItem.name || firstItem.productTitle || '').toLowerCase();

        const isRaw = cat === 'raw_materials';
        const isBoard = cat === 'boards' || cat === 'board' || cat.includes('board') || name.includes('纸板') || name.includes('ab楞') || name.includes('eb楞') || name.includes('b楞') || name.includes('e楞');

        // User requested to hide boards from BOTH lists (Updated)
        if (isBoard) return false;

        if (this.data.viewType === 'raw_materials') {
          return isRaw;
        } else {
          return !isRaw; // Goods purchase (exclude raw materials AND boards)
        }
      });

      // 格式化数据
      const processedList = filteredOrders.map(o => {
        const createdTs = typeof o.createdAt === 'string' ? Date.parse(o.createdAt) : (typeof o.createdAt === 'number' ? o.createdAt : Date.now());
        const updatedTs = typeof o.updatedAt === 'string' ? Date.parse(o.updatedAt) : (typeof o.updatedAt === 'number' ? o.updatedAt : Date.now());
        // 尝试获取入库时间，如果没有则用updatedAt（如果状态是stocked），否则undefined
        let stockedTs = o.stockedAt ? (typeof o.stockedAt === 'string' ? Date.parse(o.stockedAt) : o.stockedAt) : undefined;
        if (!stockedTs && (o.status === 'stocked' || o.status === 'completed')) {
          stockedTs = updatedTs;
        }

        // 状态归一化处理
        let normalizedStatus = o.status || 'ordered';
        const statusMap = {
          '已下单': 'ordered',
          '采购中': 'processing',
          '已入库': 'stocked',
          '已完成': 'completed',
          '已取消': 'cancelled',
          'ordered': 'ordered',
          'processing': 'processing',
          'stocked': 'stocked',
          'completed': 'completed',
          'cancelled': 'cancelled'
        };
        // 尝试匹配中文状态
        if (statusMap[normalizedStatus]) {
          normalizedStatus = statusMap[normalizedStatus];
        }

        const qty = Number(o.quantity || 0);
        const isRawMaterial = String(o.purchaseCategory || '').toLowerCase() === 'raw_materials';

        const hasPcFields = o.salePrice !== undefined && o.salePrice !== null;
        const purchaseUnitPrice = hasPcFields ? Number(o.salePrice || 0) : Number(o.unitPrice || 0);
        const sellingUnitPrice = hasPcFields
          ? (isRawMaterial ? 0 : Number(o.unitPrice || 0))
          : Number(o.sellingPrice || o.productSellingPrice || 0);

        const costAmount = Number(o.amount || (qty * purchaseUnitPrice) || 0);
        const revenueAmount = sellingUnitPrice > 0 ? qty * sellingUnitPrice : 0;
        const displayAmount = revenueAmount > 0 ? revenueAmount : costAmount;

        const profit = revenueAmount > 0 ? (revenueAmount - costAmount).toFixed(2) : null;

        return {
          id: o._id || o.id,
          productId: o.productId,
          orderNo: o.orderNo || o.orderNumber || '',
          originalSupplierName: o.supplierName, // 保存原始名称用于重映射
          supplierName: this.data.supplierMap[o.supplierName] || o.supplierName || '未知供应商',
          originalCustomerName: o.customerName,
          customerName: this.data.customerMap[o.customerName] || o.customerName || '',
          goodsName: o.productTitle || o.goodsName || '未知商品',
          spec: o.spec || o.materialNo || '', // 规格型号 fallback 物料号
          quantity: qty,
          unit: o.unit || '份',
          amount: Number(displayAmount || 0).toFixed(2),
          profit: profit,
          status: normalizedStatus,
          statusText: this.getStatusText(normalizedStatus),
          createdAtText: this.formatTime(createdTs),
          createdAtTs: createdTs,
          updatedAtTs: updatedTs,
          stockedAtTs: stockedTs
        };
      });

      // 排序（使用原始时间戳，避免字符串解析误差）
      processedList.sort((a, b) => b.createdAtTs - a.createdAtTs);

      // 计算统计数据
      const now = Date.now();
      const twoWeeks = 14 * 24 * 60 * 60 * 1000;

      // 1. 全部采购
      const totalOrders = processedList.length;

      // 2. 已入库
      const stockedOrders = processedList.filter(o => o.status === 'stocked' || o.status === 'completed').length;

      // 3. 采购金额 (所有显示订单的总金额)
      const totalAmountVal = processedList.reduce((sum, o) => sum + parseFloat(o.amount), 0);
      const purchaseTotalAmount = totalAmountVal.toFixed(2);

      // 4. 呆滞订单 (已入库且超过2周)
      const staleOrdersCount = processedList.filter(o => {
        if (o.status !== 'stocked' && o.status !== 'completed') return false;
        const stockTime = o.stockedAtTs || o.updatedAtTs || o.createdAtTs;
        return (now - stockTime) > twoWeeks;
      }).length;

      // 如果当前正在筛选呆滞订单，则应用筛选
      let displayList = processedList;
      if (this.data.isStaleFilter) {
        displayList = processedList.filter(o => {
          if (o.status !== 'stocked' && o.status !== 'completed') return false;
          const stockTime = o.stockedAtTs || o.updatedAtTs || o.createdAtTs;
          return (now - stockTime) > twoWeeks;
        });
      }

      this.setData({
        rawList: processedList,
        displayList,
        totalOrders,
        stockedOrders,
        purchaseTotalAmount,
        staleOrdersCount,
        isRefreshing: false
      });
    } catch (err) {
      logger.error('Purchase', '加载采购订单失败', err);
      wx.showToast({
        title: '加载失败',
        icon: 'none'
      });
      this.setData({ isRefreshing: false });
    }
  },

  // 状态文本转换
  getStatusText: function (status) {
    const statusMap = {
      'ordered': '已下单',
      'processing': '采购中',
      'stocked': '已入库',
      'completed': '已完成',
      'cancelled': '已取消'
    };
    return statusMap[status] || status;
  },

  // 格式化时间
  formatTime: function (timestamp) {
    if (!timestamp) return '';
    const date = new Date(timestamp);
    const y = date.getFullYear();
    const m = (date.getMonth() + 1).toString().padStart(2, '0');
    const d = date.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  },

  // 搜索过滤
  onSearch(e) {
    const keyword = e.detail.value || '';
    this.setData({ searchKeyword: keyword });
    this.loadPurchaseOrders();
  },

  // 重置搜索
  onSearchClear() {
    this.setData({ searchKeyword: '' });
    this.loadPurchaseOrders();
  },

  // 点击订单详情
  goToOrderDetail: function (e) {
    const id = e.currentTarget.dataset.id;
    if (id) {
      wx.navigateTo({
        url: `/pages/purchase-sub/detail/detail?id=${id}`
      });
    }
  },

  // 打开入库弹窗
  openStockInModal: function (e) {
    const item = e.currentTarget.dataset.item;
    this.setData({
      showStockInModal: true,
      currentOrder: item,
      stockInQty: item.quantity // 默认填入采购数量
    });
  },

  // 关闭入库弹窗
  closeStockInModal: function () {
    this.setData({
      showStockInModal: false,
      currentOrder: null,
      stockInQty: ''
    });
  },

  // 监听入库数量输入
  onStockInQtyInput: function (e) {
    this.setData({
      stockInQty: e.detail.value
    });
  },

  // 确认入库
  async confirmStockIn() {
    const { currentOrder, stockInQty } = this.data;
    if (!currentOrder) return;

    const qty = Number(stockInQty);
    if (isNaN(qty) || qty < 0) {
      wx.showToast({
        title: '请输入有效的入库数量',
        icon: 'none'
      });
      return;
    }

    wx.showLoading({
      title: '正在入库...',
      mask: true
    });

    try {
      const res = await API.stockInPurchaseOrder({
        orderId: currentOrder.id,
        quantity: qty,
        productId: currentOrder.productId,
        goodsName: currentOrder.goodsName,
        spec: currentOrder.spec,
        unit: currentOrder.unit
      });

      wx.hideLoading();
      wx.showToast({
        title: res.message || '入库成功',
        icon: 'success'
      });
      this.closeStockInModal();
      // 清除缓存并刷新列表
      clearCache('getPurchaseOrders');
      await this.loadData();
    } catch (err) {
      wx.hideLoading();
      logger.error('Purchase', '入库失败', err);
      wx.showToast({
        title: err.message || '入库失败',
        icon: 'none'
      });
    }
  },

  // 新建采购单
  createPurchase: function () {
    const { viewType } = this.data;
    if (viewType === 'raw_materials') {
      wx.navigateTo({
        url: '/pages/purchase-sub/raw-material-purchase/raw-material-purchase'
      });
    } else {
      wx.navigateTo({
        url: '/pages/purchase-sub/goods-purchase/goods-purchase'
      });
    }
  }
});
