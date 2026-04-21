// 导入数据同步工具
const { subscribe, getData, updateData } = require('../../utils/data-sync-utils.js');

const normalizeText = (v) => String(v ?? '').trim();
const toNum = (v) => {
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const m = String(v ?? '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
};
const toMaybeNum = (v) => {
  if (v === undefined || v === null || v === '') return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const m = String(v).match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : undefined;
};
const pickMaybeNum = (...candidates) => {
  for (const c of candidates) {
    const n = toMaybeNum(c);
    if (n !== undefined) return n;
  }
  return undefined;
};
const formatCurrency = (v, digits = 2) => {
  const n = toMaybeNum(v);
  if (n === undefined) return '—';
  return `¥${n.toFixed(digits)}`;
};
const formatNumberText = (v, digits = 0) => {
  const n = toMaybeNum(v);
  if (n === undefined) return '—';
  return digits > 0 ? n.toFixed(digits) : String(Math.trunc(n));
};
const parseChildOrderNo = (orderNo) => {
  const no = normalizeText(orderNo);
  const m = no.match(/^(.*)-(\d+)$/);
  if (!m) return null;
  const parentNo = normalizeText(m[1]);
  const idx = Number(m[2] || 0) - 1;
  if (!parentNo || !(Number.isFinite(idx) && idx >= 0)) return null;
  return { parentNo, idx, childNo: no };
};
const splitOrderByItems = (order) => {
  const o = order && typeof order === 'object' ? order : null;
  if (!o) return [];
  const baseNo = normalizeText(o.orderNo || o.orderNumber);
  const items = Array.isArray(o.items) ? o.items : [];
  if (!baseNo || items.length <= 1) return [o];
  if (parseChildOrderNo(baseNo)) return [o];

  const qtyList = items.map((it) => toNum(it && (it.quantity ?? it.orderQty ?? it.orderQuantity ?? it.qty)));
  const qtySum = qtyList.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0) || toNum(o.quantity ?? o.orderQty ?? o.orderQuantity ?? o.qty) || 0;
  const allocSeries = (total) => {
    const t = toNum(total);
    if (t <= 0 || qtySum <= 0) return qtyList.map((_, i) => (i === qtyList.length - 1 ? t : 0));
    let acc = 0;
    return qtyList.map((q, i) => {
      if (i === qtyList.length - 1) return Math.max(0, t - acc);
      const part = Math.floor((t * (toNum(q) || 0)) / qtySum);
      acc += part;
      return part;
    });
  };
  const producedSeries = allocSeries(o.producedQty);
  const stockedSeries = allocSeries(o.stockedQty);
  const shippedSeries = allocSeries(o.shippedQty || o.deliveredQty);
  const amountSeries = allocSeries(o.totalAmount ?? (o.amount && typeof o.amount === 'number' ? o.amount : (o.amount && typeof o.amount === 'object' ? o.amount.total : o.amount)));

  const parentId = normalizeText(o._id || o.id);
  const customerName = normalizeText(o.customerName || o.originalCustomerName);
  const contactName = normalizeText(o.contactName || o.contact);
  const createTimeStamp = toNum(o.createTimeStamp || o.createdAtTs);
  const createTime = normalizeText(o.createTime);

  const children = items.map((it, idx) => {
    const item = it && typeof it === 'object' ? it : {};
    const childNo = `${baseNo}-${idx + 1}`;
    const qty = qtyList[idx] || 0;
    const unitPrice = toNum(item.unitPrice ?? item.price ?? o.unitPrice);
    const rawUnitPrice = pickMaybeNum(
      item.rawUnitPrice,
      item.raw_unit_price,
      item.rawMaterialUnitPrice,
      item.raw_material_unit_price,
      item.costPrice,
      item.cost_price,
      item.purchasePrice,
      item.purchase_price,
      o.rawUnitPrice,
      o.raw_unit_price,
      o.rawMaterialUnitPrice,
      o.raw_material_unit_price
    );
    const amountFromItem = item.amount !== undefined ? toNum(item.amount) : 0;
    const amount = amountFromItem > 0 ? amountFromItem : (amountSeries[idx] || (qty * unitPrice) || 0);
    const rawSheetCount = pickMaybeNum(
      item.sheetCount,
      item.sheet_count,
      item.sheetQty,
      item.sheet_qty,
      item.orderedQuantity,
      item.ordered_quantity,
      item.totalQty,
      item.total_qty,
      o.sheetCount,
      o.sheet_count,
      o.sheetQty,
      o.sheet_qty
    );
    const sheetCount = (Number.isFinite(rawSheetCount) && rawSheetCount > 0) ? rawSheetCount : Number(qty || 0);
    const costBase = sheetCount > 0 ? sheetCount : Number(qty || 0);
    const grossProfit = (Number.isFinite(rawUnitPrice) && costBase > 0)
      ? (Number(amount || 0) - (Number(rawUnitPrice || 0) * costBase))
      : undefined;
    const bw = item.boardWidth ?? item.boardW ?? o.boardWidth ?? (o.product && o.product.boardWidth);
    const bh = item.boardHeight ?? item.boardH ?? o.boardHeight ?? (o.product && o.product.boardHeight);
    const creasingType = item.creasingType ?? item.creaseType ?? o.creasingType ?? (o.product && o.product.creasingType) ?? '';
    const c1 = item.creasingSize1 ?? item.creaseSize1 ?? o.creasingSize1 ?? (o.product && o.product.creasingSize1) ?? '';
    const c2 = item.creasingSize2 ?? item.creaseSize2 ?? o.creasingSize2 ?? (o.product && o.product.creasingSize2) ?? '';
    const c3 = item.creasingSize3 ?? item.creaseSize3 ?? o.creasingSize3 ?? (o.product && o.product.creasingSize3) ?? '';
    const hasCrease = creasingType || c1 || c2 || c3;
    const n1 = toNum(c1);
    const n2 = toNum(c2);
    const n3 = toNum(c3);
    const creaseText =
      normalizeText(item.creaseText || (o.product && o.product.creaseText) || o.creaseText) ||
      (hasCrease ? ((n1 || n2 || n3) ? `${n1}-${n2}-${n3}${creasingType ? ` (${creasingType})` : ''}` : creasingType) : '');

    return {
      ...o,
      ...item,
      _id: '',
      id: '',
      docId: parentId,
      parentOrderNo: baseNo,
      orderNo: childNo,
      orderNumber: childNo,
      customerName,
      contactName,
      quantity: qty,
      unit: item.unit ?? o.unit ?? '件',
      unitPrice,
      amount,
      sheetCount,
      rawUnitPrice,
      grossProfit,
      quantityDisplay: `${qty} ${item.unit ?? o.unit ?? '件'}`,
      sheetCountDisplay: `${sheetCount} 片`,
      unitPriceDisplay: formatCurrency(unitPrice, 2),
      rawUnitPriceDisplay: rawUnitPrice === undefined ? '—' : formatCurrency(rawUnitPrice, 3),
      grossProfitDisplay: grossProfit === undefined ? '—' : formatCurrency(grossProfit, 2),
      orderAmountDisplay: formatCurrency(amount, 2),
      producedQty: producedSeries[idx] || 0,
      stockedQty: stockedSeries[idx] || 0,
      shippedQty: shippedSeries[idx] || 0,
      items: [item],
      boardWidth: bw ?? '',
      boardHeight: bh ?? '',
      creasingType,
      creasingSize1: c1,
      creasingSize2: c2,
      creasingSize3: c3,
      creaseText,
      createTimeStamp,
      createTime
    };
  });
  return children;
};

// 订单管理页面逻辑
Page({
  data: {
    orders: [],
    filteredOrders: [],
    statusTabs: [
      { id: 'all', name: '全部', count: 0 },
      { id: 'ordered', name: '已下单', count: 0 },
      { id: 'pending', name: '待生产', count: 0 },
      { id: 'processing', name: '生产中', count: 0 },
      { id: 'stocked', name: '已入库', count: 0 },
      { id: 'shipping', name: '已发货', count: 0 },
      { id: 'completed', name: '已完成', count: 0 }
    ],
    currentTab: 'all',
    currentTabName: '全部',
    searchKeyword: '', // 搜索关键词
    sortIndex: 0, // 排序索引
    sortOptions: ['入库时间', '订单数量', '订单金额'],
    sortDir: 'desc',
    isLoading: false,
    isRefreshing: false,
    isLoadingMore: false,
    hasMore: true,
    page: 1,
    pageSize: 30,
    
    // 统计数据
    totalOrders: 0,
    pageOrders: 0,
    monthOrders: 0,
    orderedOrders: 0,
    stockedOrders: 0,
    pendingOrders: 0,
    processingOrders: 0,
    shippingOrders: 0,
    completedOrders: 0,
    todayNew: 0,
    urgentOrders: 0,
    monthOnly: false,
    
    // 数据同步状态
    syncStatus: 'idle', // idle, syncing, success, error
    lastSyncTime: null,
    stockedOrderNos: [],
    selectionMode: false,
    selectedMap: {},
    selectedCount: 0,
    customerMap: {}
  },

  _minAutoRefreshIntervalMs: 5 * 60 * 1000,

  getStatusClass: function(status) {
    const map = { ordered: 'status-ordered', pending: 'status-pending', processing: 'status-processing', stocked: 'status-stocked', shipping: 'status-shipping', completed: 'status-completed' };
    return map[status] || 'status-pending';
  },

  getStatusText: function(status) {
    const map = { ordered: '已下单', pending: '待生产', processing: '生产中', stocked: '已入库', shipping: '已发货', completed: '已完成' };
    return map[status] || '已下单';
  },

  onLoad: function(options) {
    // 订阅订单数据变更
    this.unsubscribeOrders = subscribe('orders', this.handleOrdersUpdate.bind(this), this);
    
    this.loadStockedOrderNos();
    this.loadCustomers();
    this.loadOrders();
  },

  loadCustomers: function() {
    wx.cloud.callFunction({
      name: 'erp-api',
      data: { action: 'getCustomers' }
    }).then(res => {
      const list = (res.result && (res.result.data || res.result.customers)) ? (res.result.data || res.result.customers) : [];
      const map = {};
      list.forEach(c => {
        const name = c.companyName || c.name;
        if (name) map[name] = c.shortName || name;
      });
      this.setData({ customerMap: map });
      // Refresh list if already loaded
      if (this.data.orders.length > 0) {
         this.processOrders(this.data.orders);
      }
    }).catch(err => console.error('加载客户简称失败', err));
  },

  onUnload: function() {
    // 取消订阅
    if (this.unsubscribeOrders) {
      this.unsubscribeOrders();
    }
  },

  onShow: function() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().init();
    }
    const now = Date.now();
    if (this._lastAutoRefreshAt && now - this._lastAutoRefreshAt < 1500) return;
    this._lastAutoRefreshAt = now;
    let forceRefresh = false;
    try {
      const flag = wx.getStorageSync('orders_force_refresh');
      forceRefresh = !!flag;
      if (flag) wx.removeStorageSync('orders_force_refresh');
    } catch (_) {}
    const hasData = Array.isArray(this.data.orders) && this.data.orders.length > 0;
    if (!forceRefresh && hasData && this._lastOrdersRefreshAt && (now - this._lastOrdersRefreshAt) < (this._minAutoRefreshIntervalMs || 0)) {
      return;
    }
    this.refreshOrdersSilent(forceRefresh);
  },

  refreshOrdersSilent: function(forceRefresh) {
    if (this._refreshingOnShow) return;
    this._refreshingOnShow = true;
    getData('orders', !!forceRefresh)
      .then((orders) => {
        this.processOrders(orders);
        this._lastOrdersRefreshAt = Date.now();
        this.setData({
          syncStatus: 'success',
          lastSyncTime: new Date().toLocaleString()
        });
      })
      .catch(() => {
        this.setData({ syncStatus: 'error' });
      })
      .finally(() => {
        this._refreshingOnShow = false;
      });
  },

  // 处理订单数据更新
  handleOrdersUpdate: function(orders, source) {
    console.log(`[订单页面] 收到订单数据更新，来源: ${source}`);
    
    // 保存当前的排序和筛选状态
    const currentSortIndex = this.data.sortIndex;
    const currentTab = this.data.currentTab;
    const currentSearchKeyword = this.data.searchKeyword;
    
    // 更新页面数据
    this.processOrders(orders);
    
    // 恢复排序和筛选状态
    this.setData({
      sortIndex: currentSortIndex,
      currentTab: currentTab,
      searchKeyword: currentSearchKeyword
    });
    
    // 重新应用排序和筛选
    this.filterOrders();
    
    // 更新同步状态
    this.setData({
      syncStatus: 'success',
      lastSyncTime: new Date().toLocaleString()
    });
  },

  // 加载订单数据
  loadOrders: function() {
    wx.showLoading({ title: '加载中...' });
    this.setData({ isLoading: true, syncStatus: 'syncing' });

    const pageSize = this.data.pageSize || 10;
    wx.cloud.callFunction({
      name: 'erp-api',
      data: { action: 'getOrders', params: { page: 1, limit: pageSize } }
    }).then(res => {
      const raw = res && res.result && res.result.data ? res.result.data : [];
      const mapped = raw.map(o => {
        const qty = Array.isArray(o.items) ? o.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0) : (o.quantity || 0);
        const firstItem = Array.isArray(o.items) && o.items.length ? o.items[0] : {};
        const s = String(o.status || '').toLowerCase();
        let status = 'ordered';
        if (['ordered'].includes(s) || o.status === '已下单') status = 'ordered';
        else if (['pending','waiting','planned'].includes(s) || o.status === '待生产') status = 'pending';
        else if (['processing','in_progress','producing'].includes(s) || o.status === '生产中') status = 'processing';
        else if (['stocked','warehoused','warehouse'].includes(s) || o.status === '已入库') status = 'stocked';
        else if (['shipped','shipping','delivered'].includes(s) || o.status === '已发货') status = 'shipping';
        else if (['completed','done'].includes(s) || o.status === '已完成') status = 'completed';
        const createdRaw = o.createdAt || o.createAt || o.createTime || o.created_at || o.create_at || '';
        const createdTs = createdRaw ? (typeof createdRaw === 'number' ? createdRaw : Date.parse(createdRaw)) : 0;
        const bw = o.boardWidth || (o.product && o.product.boardWidth) || firstItem.boardWidth || '';
        const bh = o.boardHeight || (o.product && o.product.boardHeight) || firstItem.boardHeight || '';
        const creasingType = o.creasingType || (o.product && o.product.creasingType) || '';
        const creasingSize1 = o.creasingSize1 || (o.product && o.product.creasingSize1) || '';
        const creasingSize2 = o.creasingSize2 || (o.product && o.product.creasingSize2) || '';
        const creasingSize3 = o.creasingSize3 || (o.product && o.product.creasingSize3) || '';
        const hasCrease = creasingType || creasingSize1 || creasingSize2 || creasingSize3;
        const c1 = Number(creasingSize1 || 0);
        const c2 = Number(creasingSize2 || 0);
        const c3 = Number(creasingSize3 || 0);
        const creaseText = (o.creaseText || (o.product && o.product.creaseText)) || (hasCrease ? ((c1 || c2 || c3) ? `${c1}-${c2}-${c3}${creasingType ? ` (${creasingType})` : ''}` : creasingType) : '');
        const rawSheetCount = pickMaybeNum(
          o.sheetCount,
          o.sheet_count,
          o.sheetQty,
          o.sheet_qty,
          o.orderedQuantity,
          o.ordered_quantity,
          firstItem.sheetCount,
          firstItem.sheet_count,
          firstItem.sheetQty,
          firstItem.sheet_qty,
          (o.product && o.product.sheetCount),
          (o.product && o.product.sheet_count)
        );
        const sheetCount = (Number.isFinite(rawSheetCount) && rawSheetCount > 0) ? rawSheetCount : Number(qty || 0);
        const rawUnitPrice = pickMaybeNum(
          o.rawUnitPrice,
          o.raw_unit_price,
          o.rawMaterialUnitPrice,
          o.raw_material_unit_price,
          firstItem.rawUnitPrice,
          firstItem.raw_unit_price,
          firstItem.rawMaterialUnitPrice,
          firstItem.raw_material_unit_price,
          firstItem.costPrice,
          firstItem.cost_price,
          firstItem.purchasePrice,
          firstItem.purchase_price
        );
        return {
          id: o._id || o.id || '',
          orderNo: o.orderNo || o.orderNumber || '',
          customerName: o.customerName || '',
          customerContact: o.contactName || '',
          productName: o.productName || (o.product && o.product.name) || '',
          productTitle: firstItem.title || o.productTitle || '',
          goodsName: o.goodsName || o.productTitle || firstItem.goodsName || firstItem.title || firstItem.productName || o.goods_name || o.title || '',
          spec: firstItem.spec || o.spec || '',
          quantity: qty,
          sheetCount,
          unit: firstItem.unit || o.unit || '件',
          stockedQty: Number(o.stockedQty || 0),
          shippedQty: Number(o.shippedQty || 0),
          unitPrice: Number(firstItem.unitPrice || o.unitPrice || 0),
          rawUnitPrice,
          amount: Number(o.totalAmount ?? o.amount ?? o.finalAmount) || 0,
          deposit: Number(o.deposit) || 0,
          status: status,
          priority: o.priority || 'normal',
          priorityText: this.getPriorityText(o.priority || 'normal'),
          deliveryDate: o.deliveryDate ? new Date(o.deliveryDate).toISOString().split('T')[0] : this.formatDate(new Date()),
          createTime: createdTs ? this.formatDateTime(new Date(createdTs)) : '',
          createTimeStamp: createdTs || 0,
          stockedAtTs: (() => {
            const t = o.stockedAt || o.warehouseAt || o.updatedAt || '';
            if (!t) return 0;
            const v = typeof t === 'number' ? t : Date.parse(t);
            return isNaN(v) ? 0 : v;
          })(),
          attachments: o.attachments || [],
          items: Array.isArray(o.items) ? o.items : [],
          materialArrived: !!(o.materialArrived || o.material_status === 'arrived'),
          materialCode: o.materialCode || (firstItem && firstItem.materialCode) || '',
          materialNo: o.materialNo || (firstItem && firstItem.materialNo) || '',
          flute: o.flute || (firstItem && firstItem.flute) || '',
          joinMethod: o.joinMethod || (firstItem && firstItem.joinMethod) || '',
          notes: o.notes || '',
          qrCodeUrl: o.qrCodeUrl || '',
          boardWidth: bw,
          boardHeight: bh,
          creasingType: creasingType,
          creasingSize1: creasingSize1,
          creasingSize2: creasingSize2,
          creasingSize3: creasingSize3,
          creaseText: creaseText,
          purchaseCategory: o.purchaseCategory || o.category || ''
        };
      });
      this.processOrders(mapped);
      this.setData({ isLoading: false, syncStatus: 'success', lastSyncTime: new Date().toLocaleString(), page: 1, hasMore: (res && res.result && res.result.pagination && res.result.pagination.hasMore) || false });
      wx.hideLoading();
    }).catch(error => {
      console.error('[订单页面] 获取订单数据失败:', error);
      this.setData({ isLoading: false, syncStatus: 'error' });
      wx.hideLoading();
      wx.showToast({ title: '数据加载失败', icon: 'none', duration: 2000 });
    });
  },

  

  // 处理订单数据
  processOrders: function(orders) {
    const expanded = (() => {
      const src = Array.isArray(orders) ? orders : [];
      const out = [];
      src.forEach((o) => {
        const parts = splitOrderByItems(o);
        if (parts && parts.length) out.push(...parts);
      });
      return out;
    })();

    const normalized = (expanded || []).map(o => {
      const firstItem = Array.isArray(o.items) && o.items.length ? o.items[0] : {};
      const qty = Array.isArray(o.items) ? o.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0) : (o.quantity || 0);
      const unitPrice = Number(firstItem.unitPrice || o.unitPrice || 0);
      const totalAmount = Number(o.totalAmount || o.amount || (qty * unitPrice) || 0);
      const rawSheetCount = pickMaybeNum(
        o.sheetCount,
        o.sheet_count,
        o.sheetQty,
        o.sheet_qty,
        o.orderedQuantity,
        o.ordered_quantity,
        firstItem.sheetCount,
        firstItem.sheet_count,
        firstItem.sheetQty,
        firstItem.sheet_qty,
        (o.product && o.product.sheetCount),
        (o.product && o.product.sheet_count)
      );
      const sheetCount = (Number.isFinite(rawSheetCount) && rawSheetCount > 0) ? rawSheetCount : Number(qty || 0);
      const rawUnitPrice = pickMaybeNum(
        o.rawUnitPrice,
        o.raw_unit_price,
        o.rawMaterialUnitPrice,
        o.raw_material_unit_price,
        firstItem.rawUnitPrice,
        firstItem.raw_unit_price,
        firstItem.rawMaterialUnitPrice,
        firstItem.raw_material_unit_price,
        firstItem.costPrice,
        firstItem.cost_price,
        firstItem.purchasePrice,
        firstItem.purchase_price
      );
      const costBase = sheetCount > 0 ? sheetCount : Number(qty || 0);
      const grossProfit = (Number.isFinite(rawUnitPrice) && costBase > 0)
        ? (Number(totalAmount || 0) - (Number(rawUnitPrice || 0) * costBase))
        : undefined;
      const s = String(o.status || '').toLowerCase();
      let status = 'ordered';
      if (['ordered'].includes(s) || o.status === '已下单') status = 'ordered';
      else if (['pending','waiting','planned'].includes(s) || o.status === '待生产') status = 'pending';
      else if (['processing','in_progress','producing'].includes(s) || o.status === '生产中') status = 'processing';
      else if (['stocked','warehoused','warehouse'].includes(s) || o.status === '已入库') status = 'stocked';
      else if (['shipped','shipping','delivered'].includes(s) || o.status === '已发货') status = 'shipping';
      else if (['completed','done'].includes(s) || o.status === '已完成') status = 'completed';

      const hasArrived = !!(o.materialArrived || o.material_status === 'arrived');
      const statusText = (status === 'ordered' && hasArrived) ? '已来料' : this.getStatusText(status);
      const statusClass = this.getStatusClass(status);
      
      const originalName = o.originalCustomerName || o.customerName || '';
      const shortName = this.data.customerMap[originalName] || '';
      const displayCustomerName = originalName || shortName;
      const bw = o.boardWidth || (o.product && o.product.boardWidth) || firstItem.boardWidth || '';
      const bh = o.boardHeight || (o.product && o.product.boardHeight) || firstItem.boardHeight || '';
      const creasingType = o.creasingType || (o.product && o.product.creasingType) || '';
      const creasingSize1 = o.creasingSize1 || (o.product && o.product.creasingSize1) || '';
      const creasingSize2 = o.creasingSize2 || (o.product && o.product.creasingSize2) || '';
      const creasingSize3 = o.creasingSize3 || (o.product && o.product.creasingSize3) || '';
      const hasCrease = creasingType || creasingSize1 || creasingSize2 || creasingSize3;
      const c1 = Number(creasingSize1 || 0);
      const c2 = Number(creasingSize2 || 0);
      const c3 = Number(creasingSize3 || 0);
      const creaseText = (o.creaseText || (o.product && o.product.creaseText)) || (hasCrease ? ((c1 || c2 || c3) ? `${c1}-${c2}-${c3}${creasingType ? ` (${creasingType})` : ''}` : creasingType) : '');
      const toTs = (v) => {
        if (!v) return 0;
        if (typeof v === 'number') return isNaN(v) ? 0 : v;
        if (v instanceof Date) return v.getTime();
        const str = String(v);
        let t = Date.parse(str);
        if (isNaN(t) && str.includes(' ') && !str.includes('T')) t = Date.parse(str.replace(' ', 'T'));
        return isNaN(t) ? 0 : t;
      };
      const createdAtTs = toTs(o.createTimeStamp || o.createdAtTs || o.createdAt || o.createAt || o.createTime || o.created_at || o.create_at || o.create_time);
      const createdAtText = createdAtTs ? this.formatDateTime(new Date(createdAtTs)) : '';

      return {
        ...o,
        id: o._id || o.id || String(o._id || o.id || ''),
        orderNo: o.orderNo || o.orderNumber || '',
        customerName: displayCustomerName,
        shortName: shortName,
        originalCustomerName: originalName || displayCustomerName,
        productName: o.productName || (o.product && o.product.name) || '',
        goodsName: o.goodsName || o.productTitle || firstItem.goodsName || firstItem.title || firstItem.productName || o.goods_name || o.title || '',
        spec: firstItem.spec || o.spec || '',
        unit: firstItem.unit || o.unit || '件',
        unitPrice: unitPrice,
        amount: totalAmount,
        quantity: qty,
        sheetCount,
        rawUnitPrice,
        grossProfit,
        quantityDisplay: `${qty} ${firstItem.unit || o.unit || '件'}`,
        sheetCountDisplay: `${sheetCount} 片`,
        unitPriceDisplay: formatCurrency(unitPrice, 2),
        rawUnitPriceDisplay: rawUnitPrice === undefined ? '—' : formatCurrency(rawUnitPrice, 3),
        grossProfitDisplay: grossProfit === undefined ? '—' : formatCurrency(grossProfit, 2),
        orderAmountDisplay: formatCurrency(totalAmount, 2),
        boardWidth: bw,
        boardHeight: bh,
        creasingType: creasingType,
        creasingSize1: creasingSize1,
        creasingSize2: creasingSize2,
        creasingSize3: creasingSize3,
        creaseText: creaseText,
        createTime: createdAtText,
        createTimeStamp: createdAtTs,
        stockedAtTs: (() => {
          const t = o.stockedAt || o.warehouseAt || o.updatedAt || '';
          if (!t) return 0;
          const v = typeof t === 'number' ? t : Date.parse(t);
          return isNaN(v) ? 0 : v;
        })(),
        status,
        statusText,
        statusClass
      };
    }).filter(o => {
      const cat = String(o.purchaseCategory || o.category || '').toLowerCase();
      const name = String(o.goodsName || '').toLowerCase();
      const isBoard = cat === 'boards' || cat === 'board' || cat.includes('board') || name.includes('纸板') || name.includes('ab楞') || name.includes('eb楞') || name.includes('b楞') || name.includes('e楞');
      return !isBoard;
    });
    const stats = this.calculateOrderStats(normalized);
    const today = new Date().toDateString();
    const now = new Date();
    const monthStartTs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const nextMonthStartTs = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
    const monthOrders = normalized.filter((o) => o.createTimeStamp >= monthStartTs && o.createTimeStamp < nextMonthStartTs).length;
    
    // 计算今日新增
    const todayNew = normalized.filter(order => 
      order.createTimeStamp && new Date(order.createTimeStamp).toDateString() === today
    ).length;
    
    // 计算紧急订单
    const urgentOrders = normalized.filter(order => order.priority === 'urgent').length;
    
    // 更新标签计数
    const statusTabs = this.data.statusTabs.map(tab => ({
      ...tab,
      count: tab.id === 'all' ? normalized.length : (stats.counts[tab.id] || 0)
    }));

    this.setData({
      orders: normalized,
      statusTabs: statusTabs,
      totalOrders: normalized.length,
      monthOrders: monthOrders,
      orderedOrders: stats.counts.ordered || 0,
      stockedOrders: stats.counts.stocked || 0,
      pendingOrders: stats.counts.pending || 0,
      processingOrders: stats.counts.processing || 0,
      shippingOrders: stats.counts.shipping || 0,
      completedOrders: stats.counts.completed || 0,
      todayNew: todayNew,
      urgentOrders: urgentOrders
    });

    // 不要在这里直接设置filteredOrders，让filterOrders来处理
    this.filterOrders();
    this.fetchMonthOrdersTotal();
  },

  fetchMonthOrdersTotal: function() {
    const now = new Date();
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    monthStart.setHours(0, 0, 0, 0);
    const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    nextMonthStart.setHours(0, 0, 0, 0);

    const key = `${monthStart.getTime()}-${nextMonthStart.getTime()}`;
    const ts = Date.now();
    if (this._monthOrdersKey === key && this._monthOrdersFetchedAt && ts - this._monthOrdersFetchedAt < 30000) return;
    this._monthOrdersKey = key;
    this._monthOrdersFetchedAt = ts;

    wx.cloud
      .callFunction({
        name: 'erp-api',
        data: {
          action: 'getOrders',
          params: {
            page: 1,
            limit: 1,
            dateRange: {
              start: monthStart.getTime(),
              end: nextMonthStart.getTime() - 1
            }
          }
        }
      })
      .then((res) => {
        const total = res && res.result && res.result.pagination ? Number(res.result.pagination.total || 0) : 0;
        if (!Number.isFinite(total)) return;
        this.setData({ monthOrders: total });
      })
      .catch(() => {});
  },

  // 计算订单统计
  calculateOrderStats: function(orders) {
    const counts = { ordered: 0, pending: 0, processing: 0, stocked: 0, shipping: 0, completed: 0 };
    const stockedSet = new Set(this.data.stockedOrderNos || []);

    orders.forEach(order => {
      const s = String(order.status || '').toLowerCase();
      const mapped = ['ordered','pending','processing','stocked','shipping','completed'].includes(s) ? s : 'ordered';

      if (mapped !== 'stocked') {
        counts[mapped] = (counts[mapped] || 0) + 1;
      }

      const stockedQty = Number(order.stockedQty || 0);
      const shippedQty = Number(order.shippedQty || 0);
      const inv = stockedQty - shippedQty;

      const isStocked = (mapped === 'stocked' && shippedQty === 0) || (inv > 0) || (stockedSet.has(order.orderNo) && inv > 0);
      if (isStocked) {
        counts.stocked = (counts.stocked || 0) + 1;
      }
    });

    return { counts };
  },

  // 筛选订单
  filterOrders: function() {
    const { orders, currentTab, searchKeyword, monthOnly } = this.data;
    let filtered = [...orders];
    if (monthOnly) {
      const now = new Date();
      const monthStartTs = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
      const nextMonthStartTs = new Date(now.getFullYear(), now.getMonth() + 1, 1).getTime();
      filtered = filtered.filter((o) => o.createTimeStamp >= monthStartTs && o.createTimeStamp < nextMonthStartTs);
    }

    // 按状态筛选
    if (currentTab !== 'all') {
      if (currentTab === 'stocked') {
        const stockedSet = new Set(this.data.stockedOrderNos || []);
        filtered = filtered.filter(order => {
          const stockedQty = Number(order.stockedQty || 0);
          const shippedQty = Number(order.shippedQty || 0);
          const inv = stockedQty - shippedQty;
          const s = String(order.status || '').toLowerCase();
          const mapped = ['ordered','pending','processing','stocked','shipping','completed'].includes(s) ? s : 'ordered';
          const matches = (mapped === 'stocked' && shippedQty === 0) || (inv > 0) || (stockedSet.has(order.orderNo) && inv > 0);
          return matches;
        });
      } else if (currentTab === 'pending') {
        filtered = filtered.filter(order => order.status === 'pending');
      } else if (currentTab === 'processing') {
        filtered = filtered.filter(order => order.status === 'processing');
      } else if (currentTab === 'shipping') {
        filtered = filtered.filter(order => order.status === 'shipping');
      } else if (currentTab === 'completed') {
        filtered = filtered.filter(order => order.status === 'completed');
      } else {
        filtered = filtered.filter(order => order.status === currentTab);
      }
    }

    // 按关键词搜索
    if (searchKeyword) {
      const kw = String(searchKeyword).toLowerCase();
      filtered = filtered.filter(order => {
        const f = [
          order.orderNo,
          order.customerName,
          order.productName,
          order.goodsName,
          order.materialNo,
          order.spec,
          order.unit,
          order.quantity,
          order.amount,
          order.boardWidth,
          order.boardHeight,
          order.materialCode,
          order.creasingType,
          order.creasingSize1,
          order.creasingSize2,
          order.creasingSize3
        ];
        return f.some(v => v && String(v).toLowerCase().indexOf(kw) !== -1);
      });
    }

    // 排序
    filtered = this.sortOrders(filtered);

    this.setData({
      filteredOrders: filtered,
      pageOrders: filtered.length
    });
  },

  // 排序订单
  sortOrders: function(orders) {
    const { sortIndex, sortDir } = this.data;
    
    switch (sortIndex) {
      case 0:
        return orders.sort((a, b) => sortDir === 'desc' ? (Number(b.stockedAtTs||0) - Number(a.stockedAtTs||0)) : (Number(a.stockedAtTs||0) - Number(b.stockedAtTs||0)));
      case 1:
        return orders.sort((a, b) => sortDir === 'desc' ? (Number(b.quantity||0) - Number(a.quantity||0)) : (Number(a.quantity||0) - Number(b.quantity||0)));
      case 2:
        return orders.sort((a, b) => sortDir === 'desc' ? (Number(b.amount||0) - Number(a.amount||0)) : (Number(a.amount||0) - Number(b.amount||0)));
      default:
        return orders;
    }
  },

  toggleSortDir: function() {
    const next = this.data.sortDir === 'desc' ? 'asc' : 'desc';
    this.setData({ sortDir: next });
    this.filterOrders();
  },

  // 切换标签
  switchTab: function(e) {
    const tab = e.currentTarget.dataset.tab;
    const tabName = this.data.statusTabs.find(t => t.id === tab)?.name || '全部';
    this.setData({
      currentTab: tab,
      currentTabName: tabName,
      monthOnly: false,
      page: 1,
      hasMore: true
    });
    this.filterOrders();
  },

  // 点击统计卡片
  onStatCardTap: function(e) {
    const type = e.currentTarget.dataset.type;
    let targetTab = 'all';
    
    switch(type) {
      case 'month':
        this.setData({
          currentTab: 'all',
          currentTabName: '本月订单',
          monthOnly: true
        });
        this.filterOrders();
        wx.pageScrollTo({
          scrollTop: 0,
          duration: 300
        });
        return;
      case 'all':
        targetTab = 'all';
        break;
      case 'ordered':
        targetTab = 'ordered';
        break;
      case 'pending':
        targetTab = 'pending';
        break;
      case 'processing':
        targetTab = 'processing';
        break;
      case 'stocked':
        targetTab = 'stocked';
        break;
      case 'shipping':
        targetTab = 'shipping';
        break;
      case 'completed':
        targetTab = 'completed';
        break;
      case 'urgent':
        // 紧急订单，直接筛选紧急订单
        const { orders } = this.data;
        const urgentOrders = orders.filter(order => order.priority === 'urgent');
        this.setData({
          filteredOrders: urgentOrders,
          pageOrders: urgentOrders.length,
          currentTab: 'all',
          currentTabName: '紧急订单'
        });
        wx.pageScrollTo({
          scrollTop: 0,
          duration: 300
        });
        return;
    }
    
    const tabName = this.data.statusTabs.find(t => t.id === targetTab)?.name || '全部';
    this.setData({
      currentTab: targetTab,
      currentTabName: tabName,
      monthOnly: false
    });
    this.filterOrders();
    
    // 滚动到列表顶部
    wx.pageScrollTo({
      scrollTop: 0,
      duration: 300
    });
  },

  loadStockedOrderNos: function() {
    wx.cloud.callFunction({
      name: 'erp-api',
      data: { action: 'getProductionPlans', params: { limit: 200 } }
    }).then(res => {
      const list = (res && res.result && res.result.data) ? res.result.data : [];
      const nos = list.filter(item => {
        const s = item.status || '';
        return s === 'warehouse' || s === '已入库';
      }).map(item => item.orderNo).filter(Boolean);
      this.setData({ stockedOrderNos: nos });
      if (this.data.orders && this.data.orders.length) {
        this.processOrders(this.data.orders);
      }
    }).catch(() => {
      this.setData({ stockedOrderNos: [] });
    });
  },

  // 快捷功能 - 扫码处理
  onScanProcess: function() {
    wx.scanCode({
      success: (res) => {
        wx.showToast({
          title: '扫描成功',
          icon: 'success'
        });
        console.log('扫描结果:', res.result);
      },
      fail: () => {
        wx.showToast({
          title: '扫码失败',
          icon: 'none'
        });
      }
    });
  },

  onScanQuery: function() {
    wx.scanCode({
      success: (res) => {
        const raw = (res && res.result) ? String(res.result).trim() : '';
        let orderId = '';
        let orderNo = '';
        if (/^https?:\/\//.test(raw)) {
          const mId = raw.match(/[?&]orderId=([^&]+)/);
          const mNo = raw.match(/[?&]orderNo=([^&]+)/);
          if (mId) orderId = decodeURIComponent(mId[1]);
          if (mNo) orderNo = decodeURIComponent(mNo[1]);
        } else {
          try {
            const obj = JSON.parse(raw);
            orderId = obj.subOrderId || obj.childOrderId || obj.orderId || obj.id || obj._id || '';
            orderNo = obj.subOrderNo || obj.childOrderNo || obj.orderNo || obj.orderNumber || '';
          } catch (_) {}
          if (!orderId && !orderNo) { if (/^[a-fA-F0-9]{24}$/.test(raw)) orderId = raw; else orderNo = raw; }
        }
        let id = orderId; let no = orderNo;
        const list = this.data.orders || [];
        if (!id || !no) {
          const found = list.find(o => (no && ((o.orderNo === no) || (o.orderNumber === no))))
            || list.find(o => (id && ((o._id === id) || (o.id === id))))
            || list.find(o => ((o._id === raw) || (o.id === raw) || (o.orderNo === raw) || (o.orderNumber === raw)));
          if (found) { id = found._id || found.id || id; no = found.orderNo || found.orderNumber || no; }
        }
        if (id || no) {
          const qs = id
            ? (no ? `orderId=${encodeURIComponent(id)}&orderNo=${encodeURIComponent(no)}` : `orderId=${encodeURIComponent(id)}`)
            : `orderNo=${encodeURIComponent(no)}`;
          wx.navigateTo({ url: `/pages/order-sub/detail/detail?${qs}` });
        }
        else { this.setData({ searchKeyword: raw }); this.filterOrders(); wx.showToast({ title: '未找到匹配订单', icon: 'none' }); }
      },
      fail: () => { wx.showToast({ title: '扫码失败', icon: 'none' }); }
    });
  },

  // 快捷功能 - 智能筛选
  onQuickFilter: function() {
    wx.showActionSheet({
      itemList: ['今日订单', '近7天订单', '近15天订单', '近30天订单'],
      success: (res) => {
        const filters = ['today', '7d', '15d', '30d'];
        const selectedFilter = filters[res.tapIndex];
        
        this.applySmartFilter(selectedFilter);
      }
    });
  },

  // 应用智能筛选
  applySmartFilter: function(filterType) {
    const { orders } = this.data;
    let filtered = [...orders];
    
    switch(filterType) {
      case 'today':
        {
          const today = new Date().toDateString();
          filtered = filtered.filter(order => {
            const dt = new Date(order.createTime || order.createdAt).toDateString();
            return dt === today;
          });
        }
        break;
      case '7d':
      case '15d':
      case '30d':
        {
          const days = filterType === '7d' ? 7 : (filterType === '15d' ? 15 : 30);
          const now = Date.now();
          const start = now - days * 24 * 60 * 60 * 1000;
          filtered = filtered.filter(order => {
            const t = new Date(order.createTime || order.createdAt).getTime();
            return t >= start && t <= now;
          });
        }
        break;
    }
    
    this.setData({
      filteredOrders: filtered,
      currentTab: 'all' // 重置为全部标签
    });
    
    wx.showToast({
      title: `已筛选: ${filtered.length}条`,
      icon: 'none'
    });
  },

  // 搜索输入
  onSearchInput: function(e) {
    this.setData({
      searchKeyword: e.detail.value
    });
  },

  // 搜索确认
  onSearchConfirm: function(e) {
    this.filterOrders();
  },

  // 搜索按钮
  onSearch: function() {
    this.filterOrders();
  },

  // 清除搜索
  clearSearch: function() {
    this.setData({
      searchKeyword: '',
      page: 1,
      hasMore: true
    });
    this.filterOrders();
  },

  // 排序变更
  onSortChange: function(e) {
    this.setData({
      sortIndex: parseInt(e.detail.value),
      page: 1,
      hasMore: true
    });
    this.filterOrders();
  },

  // 下拉刷新
  onRefresh: function() {
    this.setData({ isRefreshing: true });
    
    setTimeout(() => {
      this.refreshOrders();
      this.setData({ isRefreshing: false });
    }, 1000);
  },

  // 加载更多
  onLoadMore: function() {
    if (!this.data.hasMore || this.data.isLoadingMore) return;

    this.setData({ isLoadingMore: true });
    const nextPage = this.data.page + 1;
    const pageSize = this.data.pageSize;
    wx.cloud.callFunction({
      name: 'erp-api',
      data: { action: 'getOrders', params: { page: nextPage, limit: pageSize } }
    }).then(res => {
      const raw = res && res.result && res.result.data ? res.result.data : [];
      const mapped = raw.map(o => {
        const qty = Array.isArray(o.items) ? o.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0) : (o.quantity || 0);
        const firstItem = Array.isArray(o.items) && o.items.length ? o.items[0] : {};
        const s = String(o.status || '').toLowerCase();
        let status = 'ordered';
        if (['ordered'].includes(s) || o.status === '已下单') status = 'ordered';
        else if (['pending','waiting','planned'].includes(s) || o.status === '待生产') status = 'pending';
        else if (['processing','in_progress','producing'].includes(s) || o.status === '生产中') status = 'processing';
        else if (['stocked','warehoused','warehouse'].includes(s) || o.status === '已入库') status = 'stocked';
        else if (['shipped','shipping','delivered'].includes(s) || o.status === '已发货') status = 'shipping';
        else if (['completed','done'].includes(s) || o.status === '已完成') status = 'completed';
        const rawSheetCount = pickMaybeNum(
          o.sheetCount,
          o.sheet_count,
          o.sheetQty,
          o.sheet_qty,
          o.orderedQuantity,
          o.ordered_quantity,
          firstItem.sheetCount,
          firstItem.sheet_count,
          firstItem.sheetQty,
          firstItem.sheet_qty,
          (o.product && o.product.sheetCount),
          (o.product && o.product.sheet_count)
        );
        const sheetCount = (Number.isFinite(rawSheetCount) && rawSheetCount > 0) ? rawSheetCount : Number(qty || 0);
        const rawUnitPrice = pickMaybeNum(
          o.rawUnitPrice,
          o.raw_unit_price,
          o.rawMaterialUnitPrice,
          o.raw_material_unit_price,
          firstItem.rawUnitPrice,
          firstItem.raw_unit_price,
          firstItem.rawMaterialUnitPrice,
          firstItem.raw_material_unit_price,
          firstItem.costPrice,
          firstItem.cost_price,
          firstItem.purchasePrice,
          firstItem.purchase_price
        );
        return {
          id: o._id || o.id || String(o._id || o.id || '') + '_' + String(Date.now()),
          orderNo: o.orderNo || o.orderNumber || '',
          customerName: o.customerName || '',
          customerContact: o.contactName || '',
          productName: firstItem.name || o.productName || '',
        goodsName: o.goodsName || o.productTitle || firstItem.goodsName || firstItem.title || firstItem.productName || o.goods_name || o.title || '无',
          spec: firstItem.spec || o.spec || '',
          quantity: qty,
          sheetCount,
          unit: firstItem.unit || o.unit || '件',
          stockedQty: Number(o.stockedQty || 0),
          shippedQty: Number(o.shippedQty || 0),
          unitPrice: Number(firstItem.unitPrice || o.unitPrice || 0),
          rawUnitPrice,
          amount: Number(o.totalAmount ?? o.amount ?? o.finalAmount) || 0,
          deposit: Number(o.deposit) || 0,
          status: status,
          priority: o.priority || 'normal',
          priorityText: this.getPriorityText(o.priority || 'normal'),
          deliveryDate: o.deliveryDate ? new Date(o.deliveryDate).toISOString().split('T')[0] : this.formatDate(new Date()),
          createTime: this.formatDateTime(new Date(o.createdAt || o.createAt || o.createTime || o.created_at || o.create_at || Date.now())),
          createTimeStamp: new Date(o.createdAt || o.createAt || o.createTime || o.created_at || o.create_at || Date.now()).getTime(),
          attachments: o.attachments || [],
          items: Array.isArray(o.items) ? o.items : [],
          boardWidth: o.boardWidth || '',
          boardHeight: o.boardHeight || '',
          materialCode: o.materialCode || '',
          flute: o.flute || (firstItem && firstItem.flute) || '',
          joinMethod: o.joinMethod || (firstItem && firstItem.joinMethod) || '',
          notes: o.notes || '',
          qrCodeUrl: o.qrCodeUrl || '',
          creasingType: o.creasingType || '',
          creasingSize1: o.creasingSize1 || '',
          creasingSize2: o.creasingSize2 || '',
          creasingSize3: o.creasingSize3 || '',
          materialArrived: !!(o.materialArrived || o.material_status === 'arrived'),
          purchaseCategory: o.purchaseCategory || o.category || ''
        };
      });
      const allOrders = [...this.data.orders, ...mapped];
      this.processOrders(allOrders);
      this.setData({
        isLoadingMore: false,
        page: nextPage,
        hasMore: raw.length === pageSize
      });
    }).catch(error => {
      console.error('[订单页面] 加载更多失败:', error);
      this.setData({
        isLoadingMore: false,
        hasMore: false
      });
    });
  },

  // 检查数据更新
  checkForUpdates: function() {
    console.log('[订单页面] 检查数据更新');
    
    // 如果上次同步是30秒前，就检查更新
    const lastSync = this.data.lastSyncTime ? new Date(this.data.lastSyncTime).getTime() : 0;
    const now = Date.now();
    
    if (now - lastSync > 30000) { // 30秒
      this.loadOrders();
    }
  },

  // 刷新订单
  refreshOrders: function() {
    this.setData({
      page: 1,
      hasMore: true,
      isRefreshing: true
    });
    
    // 使用数据同步工具刷新数据
    getData('orders', true) // 强制刷新
      .then(orders => {
        console.log('[订单页面] 刷新订单数据成功:', orders.length);
        
        this.processOrders(orders);
        this.setData({ 
          isRefreshing: false,
          syncStatus: 'success',
          lastSyncTime: new Date().toLocaleString()
        });
        
        wx.showToast({
          title: '数据已更新',
          icon: 'success',
          duration: 1000
        });
      })
      .catch(error => {
        console.error('[订单页面] 刷新订单数据失败:', error);
        
        this.setData({ 
          isRefreshing: false,
          syncStatus: 'error'
        });
        
        wx.showToast({
          title: '刷新失败',
          icon: 'none',
          duration: 1500
        });
      });
  },

  // 跳转到订单详情
  goToDetail: function(e) {
    const ds = e.currentTarget.dataset;
    const key = ds.id || ds.orderno;
    const list = this.data.filteredOrders.length ? this.data.filteredOrders : this.data.orders;
    let order = null;
    if (key) {
      order = list.find(item => item.id === key);
      if (!order) order = list.find(item => item._id === key);
      if (!order) order = list.find(item => (item.orderNo === key || item.orderNumber === key));
    }
    if (!order && ds.index !== undefined) {
      const idx = Number(ds.index);
      if (!Number.isNaN(idx) && idx >= 0 && idx < list.length) {
        order = list[idx];
      }
    }
    if (order) {
      const id = order._id || order.id || order.orderNo || order.orderNumber;
      wx.navigateTo({ url: `/pages/order-sub/detail/detail?orderId=${id}&orderNo=${order.orderNo || ''}` });
    } else {
      wx.navigateTo({ url: `/pages/order-sub/detail/detail?id=${key}` });
    }
  },

  // 前往创建订单
  goToCreate: function() {
    wx.navigateTo({
      url: '/pages/order-sub/create/create'
    });
  },

  // 扫码功能
  scanBarcode: function() {
    wx.scanCode({
      success: (res) => {
        const result = res.result;
        this.setData({
          searchKeyword: result
        });
        this.filterOrders();
        wx.showToast({
          title: '扫码成功',
          icon: 'success'
        });
      },
      fail: () => {
        wx.showToast({
          title: '扫码失败',
          icon: 'none'
        });
      }
    });
  },

  // 切换筛选面板
  toggleFilter: function() {
    wx.showActionSheet({
      itemList: ['按日期筛选', '按金额筛选', '按客户筛选', '按优先级筛选'],
      success: (res) => {
        const actions = ['date', 'amount', 'customer', 'priority'];
        this.handleFilter(actions[res.tapIndex]);
      }
    });
  },

  // 处理筛选
  handleFilter: function(type) {
    wx.showToast({
      title: `${type}筛选功能开发中`,
      icon: 'none'
    });
  },

  // 导出订单
  exportOrders: function() {
    wx.showLoading({
      title: '导出中...'
    });
    setTimeout(() => {
      wx.hideLoading();
      wx.showToast({
        title: '导出成功',
        icon: 'success'
      });
    }, 1500);
  },

  enterSelectionMode: function() {
    this.enterPrintSelection()
  },

  exitSelectionMode: function() {
    this.setData({ selectionMode: false, selectedMap: {}, selectedCount: 0 });
  },

  enterPrintSelection: function() {
    this.setData({
      selectionMode: true,
      selectedMap: {},
      selectedCount: 0
    });
    try {
      wx.showToast({ title: '已进入打印勾选', icon: 'none' });
    } catch (_) {}
  },

  toggleSelectOrder: function(e) {
    const orderNo = e.currentTarget.dataset.orderno;
    if (!orderNo) return;
    const map = Object.assign({}, this.data.selectedMap);
    if (map[orderNo]) {
      delete map[orderNo];
    } else {
      map[orderNo] = true;
    }
    const selectedCount = Object.keys(map).length;
    this.setData({ selectedMap: map, selectedCount });
  },

  goToPrintPreview: function() {
    const map = this.data.selectedMap || {};
    const orders = this.data.orders || [];
    const selectedNos = Object.keys(map);
    if (!selectedNos.length) {
      wx.showToast({
        title: '请勾选要打印的订单',
        icon: 'none'
      });
      return;
    }
    const selectedOrders = orders.filter(o => selectedNos.includes(o.orderNo));
    if (!selectedOrders.length) {
      wx.showToast({
        title: '未找到选中的订单',
        icon: 'none'
      });
      return;
    }
    const key = `print_orders_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      wx.setStorageSync(key, selectedOrders);
    } catch (_) {
      wx.showToast({ title: '缓存失败，无法打印', icon: 'none' });
      return;
    }
    this.setData({ selectionMode: false, selectedMap: {}, selectedCount: 0 });
    wx.navigateTo({
      url: `/pages/production-sub/workorder-print/workorder-print?key=${encodeURIComponent(key)}`
    });
  },

  stopPropagation: function() {},

  // 同步数据
  syncData: function() {
    wx.showLoading({
      title: '同步中...'
    });
    
    this.setData({ syncStatus: 'syncing' });
    
    // 使用数据同步工具强制同步
    getData('orders', true)
      .then(orders => {
        console.log('[订单页面] 数据同步成功:', orders.length);
        
        this.processOrders(orders);
        
        wx.hideLoading();
        this.setData({
          syncStatus: 'success',
          lastSyncTime: new Date().toLocaleString()
        });
        
        wx.showToast({
          title: '同步完成',
          icon: 'success',
          duration: 1500
        });
      })
      .catch(error => {
        console.error('[订单页面] 数据同步失败:', error);
        
        wx.hideLoading();
        this.setData({ syncStatus: 'error' });
        
        wx.showToast({
          title: '同步失败',
          icon: 'none',
          duration: 1500
        });
      });
  },



  getStatusText: function(status) {
    const statusMap = { ordered: '已下单', pending: '待生产', processing: '生产中', stocked: '已入库', shipping: '已发货', completed: '已完成' };
    return statusMap[status] || '已下单';
  },

  // 获取当月订单
  getCurrentMonthOrders: function(orders) {
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    
    return orders.filter(order => {
      const orderDate = new Date(order.createTime);
      return orderDate.getFullYear() === currentYear && 
             orderDate.getMonth() === currentMonth;
    });
  },

  // 获取优先级文本
  getPriorityText: function(priority) {
    const priorityMap = {
      urgent: '紧急',
      high: '高',
      normal: '普通',
      low: '低'
    };
    return priorityMap[priority] || priority;
  },

  // 格式化日期
  formatDate: function(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  },

  // 格式化日期时间
  formatDateTime: function(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hour = String(date.getHours()).padStart(2, '0');
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}`;
  }
});
