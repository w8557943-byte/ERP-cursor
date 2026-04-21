// 导入数据同步工具
const { subscribe, getData, updateData } = require('../../utils/data-sync-utils.js');
const { API, clearCache } = require('../../utils/unified-api');
const { logger } = require('../../utils/logger');

const normalizeText = (v) => String(v ?? '').trim();
const toNum = (v) => {
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const m = String(v ?? '').match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : 0;
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
  const qtySum = qtyList.reduce((s, n) => s + (Number.isFinite(n) ? n : 0), 0) || toNum(o.quantity ?? o.totalQty ?? o.orderQty ?? o.orderQuantity ?? o.qty) || 0;
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
  const perItemShipped = items.map((it) => toNum(it && (it.shippedQty ?? it.deliveredQty ?? it.shipped_qty ?? it.delivered_qty)));
  const shippedSeries = items.some((it) => {
    const src = it && typeof it === 'object' ? it : {};
    return src.shippedQty !== undefined || src.deliveredQty !== undefined || Array.isArray(src.shipments);
  })
    ? perItemShipped
    : allocSeries(o.shippedQty || o.deliveredQty);

  return items.map((it, idx) => {
    const item = it && typeof it === 'object' ? it : {};
    const childNo = `${baseNo}-${idx + 1}`;
    const qty = qtyList[idx] || 0;
    const bw = item.boardWidth ?? item.boardW ?? o.boardWidth ?? o.paperWidth ?? o.boardW ?? '';
    const bh = item.boardHeight ?? item.boardH ?? o.boardHeight ?? o.paperLength ?? o.boardH ?? '';
    return {
      ...o,
      ...item,
      orderNo: childNo,
      orderNumber: childNo,
      parentOrderNo: baseNo,
      quantity: qty,
      totalQty: qty,
      producedQty: producedSeries[idx] || 0,
      stockedQty: stockedSeries[idx] || 0,
      shippedQty: shippedSeries[idx] || 0,
      boardWidth: bw,
      boardHeight: bh,
      shipments: Array.isArray(item.shipments) ? item.shipments : (Array.isArray(o.shipments) ? o.shipments : []),
      items: [item]
    };
  });
};

// 生产管理页面逻辑
Page({
  data: {
    workOrderList: [],
    warehouseList: [],
    displayOrderList: [],
    statistics: {
      total: 0,
      pending: 0,
      processing: 0,
      completed: 0
    },
    filterStatus: 'all',
    searchQuery: '',

    // 数据同步状态
    syncStatus: 'idle', // idle, syncing, success, error
    lastSyncTime: null,
    isLoading: false,
    isRefreshing: false,
    isLoadingMore: false,
    hasMore: true,
    isUsingOrderData: false, // 是否正在使用订单数据（生产数据为空时）
    page: 1,
    pageSize: 30,
    warehouseCount: 0,
    completionRate: 0,
    avgDeliveryDays: 0,
    shipmentDurationsDays: [],
    stockedOrderNos: [],
    isNavFixed: false,
    navStickyThreshold: 0,
    navStickyEngaged: false,
    showCompleteDialog: false,
    completeDialog: { orderNo: '', productName: '', spec: '', totalQty: 0, currentProduced: 0, inputQty: '' },
    showStockDialog: false,
    stockDialog: { orderNo: '', customer: '', spec: '', productName: '', materialNo: '', orderQty: 0, stockedQty: 0, inputQty: '' },
    showShipmentDialog: false,
    shipmentDialog: { orderNo: '', customer: '', spec: '', productName: '', materialNo: '', orderQty: 0, stockedQty: 0 },
    customerMap: {}
  },

  _minAutoRefreshIntervalMs: 5 * 60 * 1000,

  onScanButtonClick: function () {
    wx.scanCode({
      success: (res) => {
        const raw = (res && res.result) ? String(res.result).trim() : '';
        if (!raw) return;

        let orderId = '';
        let orderNo = '';
        let orderIdIsChildScoped = false;
        if (/^https?:\/\//.test(raw)) {
          const mId = raw.match(/[?&]orderId=([^&]+)/);
          const mNo = raw.match(/[?&]orderNo=([^&]+)/);
          if (mId) orderId = decodeURIComponent(mId[1]).trim();
          if (mNo) orderNo = decodeURIComponent(mNo[1]).trim();
        } else {
          try {
            const obj = JSON.parse(raw);
            const subId = obj.subOrderId || obj.childOrderId || '';
            orderId = subId || obj.orderId || obj.id || obj._id || '';
            orderNo = obj.subOrderNo || obj.childOrderNo || obj.orderNo || obj.orderNumber || '';
            orderIdIsChildScoped = Boolean(subId);
          } catch (_) { }
          if (!orderId && !orderNo) {
            if (/^[a-fA-F0-9]{24}$/.test(raw)) orderId = raw;
            else orderNo = raw;
          }
        }
        orderId = String(orderId || '').trim();
        orderNo = String(orderNo || '').trim();

        const all = []
          .concat(this.data.workOrderList || [])
          .concat(this.data.warehouseList || [])
          .concat(this.data.shippingList || [])
          .concat(this.data.displayOrderList || []);

        let item = null;
        if (orderNo) {
          item = all.find(i => i && (i.orderNo === orderNo || i.orderNumber === orderNo)) || null;
        }
        if (!item && orderId) {
          item = all.find(i => i && (i.id === orderId || i.docId === orderId || i._id === orderId)) || null;
        }

        const id = item && (item.id || item.docId || item._id) ? (item.id || item.docId || item._id) : orderId;
        const no = item && (item.orderNo || item.orderNumber) ? (item.orderNo || item.orderNumber) : orderNo;
        const childMeta = no ? parseChildOrderNo(no) : null;
        const usedId = (childMeta && !orderIdIsChildScoped) ? '' : id;
        const qs = no
          ? `?orderNo=${encodeURIComponent(no)}${usedId ? `&orderId=${encodeURIComponent(usedId)}` : ''}&from=scan`
          : (usedId ? `?orderId=${encodeURIComponent(usedId)}&from=scan` : '');
        if (!qs) {
          wx.showToast({ title: '无法识别二维码', icon: 'none' });
          return;
        }

        wx.navigateTo({
          url: `/pages/production-sub/detail/detail${qs}`,
          success: (r) => {
            try {
              r.eventChannel && r.eventChannel.emit('orderRoute', { orderId: usedId, orderNo: no });
            } catch (_) { }
          }
        });
      },
      fail: (err) => {
        if (err.errMsg && err.errMsg.indexOf('cancel') === -1) {
          wx.showToast({ title: '扫码失败', icon: 'none' });
        }
      }
    });
  },

  onLoad: function () {
    console.log('生产管理页面加载');

    // 加载客户简称映射
    this.loadCustomers();

    // 订阅订单数据变更
    this.unsubscribeOrders = subscribe('orders', this.handleOrdersUpdate.bind(this), this);

    // 加载已入库订单集合（来自生产计划）
    this.loadStockedOrderNos();

    this.loadProductionData();
  },

  // 加载客户简称
  async loadCustomers() {
    try {
      const res = await API.getCustomers();
      const list = res.data || res.customers || [];
      const map = {};
      list.forEach(c => {
        const name = c.companyName || c.name;
        if (name) map[name] = c.shortName || name;
      });
      this.setData({ customerMap: map });

      // Update existing lists with new map
      const updateList = (list) => {
        if (!Array.isArray(list)) return [];
        return list.map(item => ({
          ...item,
          customer: map[item.customer] || item.customer
        }));
      };

      if (this.data.workOrderList.length > 0) {
        const newList = updateList(this.data.workOrderList);
        const newWarehouse = updateList(this.data.warehouseList);
        const newShipping = updateList(this.data.shippingList);

        this.setData({
          workOrderList: newList,
          warehouseList: newWarehouse,
          shippingList: newShipping
        });
        this.updateDisplayList();
      }
    } catch (err) {
      logger.error('Production', '加载客户简称失败', err);
    }
  },

  onReady: function () {
    try {
      const q = wx.createSelectorQuery();
      q.select('.fixed-nav-bar').boundingClientRect();
      q.selectViewport().scrollOffset();
      q.exec(res => {
        const rect = res && res[0];
        const offset = (res && res[1] && typeof res[1].scrollTop === 'number') ? res[1].scrollTop : 0;
        const threshold = rect ? (rect.top + offset) : 0;
        this.setData({ navStickyThreshold: threshold });
      });
    } catch (_) { }
  },

  onUnload: function () {
    // 取消订阅
    if (this.unsubscribeOrders) {
      this.unsubscribeOrders();
    }
  },

  onShow: function () {
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
    } catch (_) { }

    const hasData =
      (Array.isArray(this.data.workOrderList) && this.data.workOrderList.length > 0) ||
      (Array.isArray(this.data.warehouseList) && this.data.warehouseList.length > 0) ||
      (Array.isArray(this.data.displayOrderList) && this.data.displayOrderList.length > 0);
    if (!forceRefresh && hasData && this._lastProductionRefreshAt && (now - this._lastProductionRefreshAt) < (this._minAutoRefreshIntervalMs || 0)) {
      return;
    }

    this.loadProductionData(forceRefresh);
  },

  // 处理订单数据更新
  handleOrdersUpdate: function (orders, source) {
    console.log(`[生产管理页面] 收到订单数据更新，来源: ${source}`);

    // 将订单数据转换为生产工单数据
    this.convertOrdersToWorkOrders(orders);
    this._lastProductionRefreshAt = Date.now();

    // 更新同步状态
    this.setData({
      syncStatus: 'success',
      lastSyncTime: new Date().toLocaleString()
    });

    const nos = new Set(this.data.stockedOrderNos || []);
    const useCompletedAsStocked = nos.size === 0;
    const warehouseCount = Array.isArray(orders)
      ? orders.filter(o => o && (o.status === 'stocked' || nos.has(o.orderNo) || (useCompletedAsStocked && o.status === 'completed'))).length
      : 0;
    this.setData({ warehouseCount });
    this.updateDerivedStats();
  },

  // 加载生产数据
  loadProductionData: function (forceRefresh) {
    wx.showLoading({ title: '加载中...' });

    this.setData({
      isLoading: true,
      syncStatus: 'syncing'
    });

    // 优先尝试从生产API获取数据
    this.loadProductionDataFromAPI(!!forceRefresh)
      .then(() => {
        wx.hideLoading();
      })
      .catch(error => {
        if (error.message === 'NO_PRODUCTION_DATA') {
          console.log('[生产管理页面] 生产数据库为空，使用订单数据作为回退方案');
        } else {
          console.error('[生产管理页面] 从生产API获取数据失败，回退到订单数据:', error);
        }

        // 回退到使用订单数据
        this.loadProductionDataFromOrders(!!forceRefresh);
      });
  },

  // 从生产API加载数据
  async loadProductionDataFromAPI(forceRefresh) {
    try {
      const res = await API.getProductionPlans({
        page: 1,
        limit: this.data.pageSize,
        status: this.data.filterStatus === 'all' ? '' : this.data.filterStatus
      });
      if (res && res.success) {
        const productionOrders = res.data || [];

        if (productionOrders.length > 0) {
          // 将生产订单数据转换为工单格式
          const convertedOrders = this.convertProductionOrdersToWorkOrders(productionOrders);

          // 同时获取订单数据用于补充信息
          let orders = [];
          try {
            orders = await getData('orders', !!forceRefresh);
          } catch (_) {
            orders = [];
          }

          if (Array.isArray(orders) && orders.length > 0) {
            this.mergeProductionAndOrderData(convertedOrders, orders);
          } else {
            this.processWorkOrders(convertedOrders);
          }

          this._lastProductionRefreshAt = Date.now();
          this.setData({
            isUsingOrderData: false,
            isLoading: false,
            syncStatus: 'success',
            lastSyncTime: new Date().toLocaleString(),
            hasMore: res.pagination && res.pagination.hasMore !== undefined ? res.pagination.hasMore : (productionOrders.length >= this.data.pageSize)
          });
          return;
        } else {
          // 没有生产订单数据，回退到订单数据
          logger.info('Production', '生产数据库为空，使用订单数据作为回退');
          throw new Error('NO_PRODUCTION_DATA');
        }
      } else {
        throw new Error('生产API返回数据格式错误');
      }
    } catch (err) {
      // 如果是NO_PRODUCTION_DATA，这是预期的回退，使用info级别
      if (err.message === 'NO_PRODUCTION_DATA') {
        logger.info('Production', '生产数据为空，将回退到订单数据');
      } else {
        logger.error('Production', '调用生产API失败', err);
      }
      throw err;
    }
  },

  // 从订单数据加载生产数据（回退方案）
  loadProductionDataFromOrders: function (forceRefresh) {
    // 使用数据同步工具获取订单数据
    getData('orders', !!forceRefresh)
      .then(orders => {
        console.log('[生产管理页面] 成功获取订单数据:', orders.length);

        // 标记正在使用订单数据
        this.setData({ isUsingOrderData: true });

        // 将订单数据转换为生产工单数据
        if (!Array.isArray(orders) || orders.length === 0) {
          console.log('[生产管理页面] 订单为空，使用演示数据');
          this.initData();
        } else {
          this.convertOrdersToWorkOrders(orders);
        }

        this._lastProductionRefreshAt = Date.now();
        this.setData({
          isLoading: false,
          syncStatus: 'success',
          lastSyncTime: new Date().toLocaleString()
        });

        wx.hideLoading();
      })
      .catch(error => {
        console.error('[生产管理页面] 获取订单数据失败:', error);

        // 使用模拟数据作为降级方案
        console.log('[生产管理页面] 使用模拟数据作为降级方案');
        this.initData();

        this.setData({
          isLoading: false,
          syncStatus: 'error'
        });

        wx.hideLoading();

        wx.showToast({
          title: '数据加载失败，使用演示数据',
          icon: 'none',
          duration: 2000
        });
      });
  },

  // 检查数据更新
  checkForUpdates: function () {
    console.log('[生产管理页面] 检查数据更新');

    // 如果上次同步是30秒前，就检查更新
    const lastSync = this.data.lastSyncTime ? new Date(this.data.lastSyncTime).getTime() : 0;
    const now = Date.now();

    if (now - lastSync > 30000) { // 30秒
      this.loadProductionData();
    }
  },

  // 下拉刷新
  onRefresh: function () {
    this.setData({
      isRefreshing: true,
      page: 1,
      hasMore: true
    });

    // 重新加载数据
    this.loadProductionData(true);

    // 1秒后关闭刷新状态
    setTimeout(() => {
      this.setData({ isRefreshing: false });
    }, 1000);
  },

  // 加载更多
  async onLoadMore() {
    if (!this.data.hasMore || this.data.isLoadingMore) return;

    this.setData({ isLoadingMore: true });
    const nextPage = this.data.page + 1;

    try {
      const res = await API.getProductionPlans({
        page: nextPage,
        limit: this.data.pageSize,
        status: this.data.filterStatus === 'all' ? '' : this.data.filterStatus
      });
      if (res && res.success) {
        const newProductionOrders = res.data || [];

        if (newProductionOrders.length > 0) {
          // 将生产订单数据转换为工单格式
          const convertedOrders = this.convertProductionOrdersToWorkOrders(newProductionOrders);
          const currentOrders = this.data.displayOrderList || [];

          this.setData({
            displayOrderList: [...currentOrders, ...convertedOrders],
            page: nextPage,
            isLoadingMore: false,
            hasMore: res.pagination && res.pagination.hasMore !== undefined ? res.pagination.hasMore : (newProductionOrders.length >= this.data.pageSize)
          });
        } else {
          this.setData({
            isLoadingMore: false,
            hasMore: false
          });
        }
      } else {
        logger.error('Production', '获取生产订单失败', res);
        this.setData({
          isLoadingMore: false,
          hasMore: false
        });
      }
    } catch (err) {
      logger.error('Production', '调用生产API失败', err);
      this.setData({
        isLoadingMore: false
      });
      wx.showToast({
        title: '加载失败',
        icon: 'error'
      });
    }
  },



  // 将订单数据转换为生产工单数据
  convertOrdersToWorkOrders: function (orders) {
    if (!Array.isArray(orders)) {
      this.initData();
      return;
    }

    const expanded = (() => {
      const out = [];
      (orders || []).forEach((o) => {
        const parts = splitOrderByItems(o);
        if (parts && parts.length) out.push(...parts);
      });
      return out;
    })();
    const isBoard = (o) => {
      const cat = String(o && (o.purchaseCategory || o.category) || '').toLowerCase();
      const name = String(o && (o.productName || o.product || o.goodsName || o.title) || '').toLowerCase();
      const hitCat = ['纸板', 'corrugat', 'corrugate', 'board'].some(k => cat.includes(k));
      const hitName = ['纸板', '瓦楞', '坑纸', '面纸', '原纸', 'corrugat', 'corrugate', 'board'].some(k => name.includes(k));
      return hitCat || hitName;
    };

    const workOrders = expanded.map(order => {
      // 事件驱动进度
      let productionStatus = 'ordered';
      let progress = 0;
      const totalQty = Number(order.quantity || 0);
      const localItem = (this.data.workOrderList || []).find(w => (w.orderNo === (order.orderNo || order.orderNumber)));
      const producedQtyCloud = Number(order.producedQty || 0);
      const stockedQtyCloud = Number(order.stockedQty || 0);
      const shippedQtyCloud = Number(order.shippedQty || 0);
      const producedQty = Math.max(producedQtyCloud, Number(localItem && localItem.producedQty || 0));
      const printStart = order.printStartAt || order.startedAt || order.startTime || '';
      const printFinish = order.printFinishAt || order.printedAt || order.completedAt || '';
      const stockedAt = order.stockedAt || order.stockTime || (order.status === 'stocked' ? (order.updatedAt || order.updateTime) : '');
      const shippedAt = order.shippedAt || order.deliveredAt || (order.status === 'shipped' ? (order.updatedAt || order.updateTime) : '');
      const s = String(order.status || '').toLowerCase();
      if (s === 'completed' || s === '已完成' || s === 'done' || s === '完成') {
        productionStatus = 'completed';
        progress = 100;
      } else if (shippedAt || s === 'shipped' || s === 'shipping' || s === 'delivered' || s === '正在发货' || s === '已发货' || s === '已送货') {
        productionStatus = 'shipping';
        progress = 100;
      } else if (stockedAt || s === 'stocked' || s === '已入库' || s === 'warehoused') {
        productionStatus = 'stocked';
        progress = 100;
      } else if (printFinish) {
        productionStatus = 'processing';
        progress = 50;
      } else if (printStart || s === 'processing' || s === 'in_progress' || s === 'producing' || s === '生产中') {
        productionStatus = 'processing';
        progress = 25;
      } else if (s === 'pending' || s === 'waiting' || s === 'planned' || s === '待生产') {
        productionStatus = 'pending';
        progress = 0;
      } else if (s === 'ordered' || s === '已下单') {
        productionStatus = 'ordered';
        progress = 0;
      } else {
        productionStatus = 'ordered';
        progress = 0;
      }

      const bw = (order.items && order.items[0] && order.items[0].boardWidth) || order.boardWidth || order.paperWidth || order.boardW || '';
      const bh = (order.items && order.items[0] && order.items[0].boardHeight) || order.boardHeight || order.paperLength || order.boardH || '';
      const paperSize = order.paperSize || ((bw || bh) ? `${bw}×${bh}` : '');
      const c1 = order.creasingSize1 || (order.items && order.items[0] && order.items[0].creasingSize1) || 0;
      const c2 = order.creasingSize2 || (order.items && order.items[0] && order.items[0].creasingSize2) || 0;
      const c3 = order.creasingSize3 || (order.items && order.items[0] && order.items[0].creasingSize3) || 0;
      const creaseText = (c1 || c2 || c3) ? `${c1}-${c2}-${c3}` : (order.creasingType || '');
      const first = Array.isArray(order.items) && order.items.length ? order.items[0] : {};
      const gname = order.goodsName || order.productTitle || first.goodsName || first.title || first.productName || order.goods_name || order.title || '';
      const rawCustomerName =
        order.shortName ||
        order.customerShortName ||
        order.customerName ||
        order.originalCustomerName ||
        (order.customer && (order.customer.shortName || order.customer.companyName || order.customer.name)) ||
        '';
      const stockedAtValue = order.stockedAt || order.stockTime || (order.status === 'stocked' ? (order.updatedAt || order.updateTime) : '');
      return {
        id: order._id || order.id || order.orderNumber || order.orderNo || '',
        docId: order._id || order.id || '',
        orderNo: order.orderNo || order.orderNumber || '',
        productName: order.productName,
        goodsName: gname,
        spec: (order.spec ||
          order.specification ||
          order.productSpec ||
          first.spec ||
          first.specification ||
          first.productSpec ||
          ''),
        totalQty: totalQty,
        producedQty: producedQty,
        stockedQty: Math.max(stockedQtyCloud, Number(localItem && localItem.stockedQty || 0)),
        shippedQty: Math.max(shippedQtyCloud, Number(localItem && localItem.shippedQty || 0)),
        status: productionStatus,
        progress: progress,
        customer: this.data.customerMap[rawCustomerName] || rawCustomerName,
        stockedAt: stockedAtValue || '',
        materialCode: order.materialCode || order.materialNo || (order.product && order.product.materialCode) || '',
        materialNo: order.materialNo || (first && first.materialNo) || '',
        fluteType: order.fluteType || order.flute || (order.product && order.product.flute) || '',
        attachments: Array.isArray(order.attachments) ? order.attachments : [],
        paperSize,
        creaseText,
        urgent: order.priority === 'urgent',
        purchaseCategory: order.purchaseCategory || order.category || '',
        startTime: this.formatDate(new Date(order.createTime || order.createdAt)),
        createAt: new Date(order.createTime || order.createdAt).getTime(),
        expectedTime: order.deliveryDate
      };
    }).filter(order => {
      if (!order) return false;
      const orderType = String(order.orderType || order.type || '').toLowerCase();
      const source = String(order.source || '').toLowerCase();
      if (orderType === 'purchase' || source === 'purchased') return false;
      if (isBoard(order)) return false;
      return ['pending', 'processing', 'completed', 'ordered'].includes(order.status);
    });

    const nos = new Set(this.data.stockedOrderNos || []);
    const useCompletedAsStocked = nos.size === 0;
    const warehouseOrders = (expanded || [])
      .filter(o => {
        if (!o) return false;
        const orderType = String(o.orderType || o.type || '').toLowerCase();
        const source = String(o.source || '').toLowerCase();
        if (orderType === 'purchase' || source === 'purchased') return false;
        if (isBoard(o)) return false;
        return (o.status === 'stocked' || o.status === 'warehoused' || o.status === '已入库' || nos.has(o.orderNo));
      })
      .map(order => ({
        id: order._id || order.id || order.orderNumber || order.orderNo || '',
        docId: order._id || order.id || '',
        orderNo: order.orderNo || order.orderNumber || '',
        productName: order.productName,
        goodsName: (order.goodsName || order.productTitle || (Array.isArray(order.items) && order.items[0] && (order.items[0].goodsName || order.items[0].title || order.items[0].productName)) || order.goods_name || order.title || ''),
        spec: (order.spec ||
          order.specification ||
          order.productSpec ||
          (Array.isArray(order.items) && order.items[0] && (order.items[0].spec || order.items[0].specification || order.items[0].productSpec)) ||
          ''),
        totalQty: order.quantity,
        producedQty: Math.max(Number(order.producedQty || 0), Number((this.data.workOrderList || []).find(w => w.orderNo === (order.orderNo || order.orderNumber))?.producedQty || 0)),
        stockedQty: Math.max(Number(order.stockedQty || order.quantity || 0), Number((this.data.workOrderList || []).find(w => w.orderNo === (order.orderNo || order.orderNumber))?.stockedQty || 0)),
        shippedQty: Math.max(Number(order.shippedQty || 0), Number((this.data.workOrderList || []).find(w => w.orderNo === (order.orderNo || order.orderNumber))?.shippedQty || 0)),
        status: 'stocked',
        progress: 100,
        customer: this.data.customerMap[
          order.shortName ||
          order.customerShortName ||
          order.customerName ||
          order.originalCustomerName ||
          (order.customer && (order.customer.shortName || order.customer.companyName || order.customer.name)) ||
          ''
        ] || (order.shortName || order.customerShortName || order.customerName || order.originalCustomerName || (order.customer && (order.customer.shortName || order.customer.companyName || order.customer.name)) || ''),
        urgent: false,
        createAt: new Date(order.createTime || order.createdAt).getTime(),
        stockedAt: order.stockedAt || order.stockTime || (order.status === 'stocked' ? (order.updatedAt || order.updateTime) : ''),
        materialNo: order.materialNo || (Array.isArray(order.items) && order.items[0] && order.items[0].materialNo) || '',
        materialCode: order.materialCode || order.materialNo || (Array.isArray(order.items) && order.items[0] && (order.items[0].materialCode || order.items[0].materialNo)) || '',
        startTime: this.formatDate(new Date(order.createTime || order.createdAt)),
        expectedTime: order.deliveryDate
      }));

    const shippingOrders = (expanded || [])
      .filter(o => {
        if (!o) return false;
        const orderType = String(o.orderType || o.type || '').toLowerCase();
        const source = String(o.source || '').toLowerCase();
        if (orderType === 'purchase' || source === 'purchased') return false;
        if (isBoard(o)) return false;
        return (['shipped', 'delivered', 'shipping', '正在发货', '已发货'].includes(o.status));
      })
      .map(order => ({
        id: order._id || order.id || order.orderNumber || order.orderNo || '',
        docId: order._id || order.id || '',
        orderNo: order.orderNo || order.orderNumber || '',
        productName: order.productName,
        goodsName: (order.goodsName || order.productTitle || (Array.isArray(order.items) && order.items[0] && (order.items[0].goodsName || order.items[0].title || order.items[0].productName)) || order.goods_name || order.title || ''),
        spec: (order.spec ||
          order.specification ||
          order.productSpec ||
          (Array.isArray(order.items) && order.items[0] && (order.items[0].spec || order.items[0].specification || order.items[0].productSpec)) ||
          ''),
        totalQty: order.quantity,
        producedQty: Math.max(Number(order.producedQty || 0), Number((this.data.workOrderList || []).find(w => w.orderNo === (order.orderNo || order.orderNumber))?.producedQty || 0)),
        stockedQty: Math.max(Number(order.stockedQty || order.quantity || 0), Number((this.data.workOrderList || []).find(w => w.orderNo === (order.orderNo || order.orderNumber))?.stockedQty || 0)),
        shippedQty: Math.max(Number(order.shippedQty || 0), Number((this.data.workOrderList || []).find(w => w.orderNo === (order.orderNo || order.orderNumber))?.shippedQty || 0)),
        status: 'shipping', // Using 'shipping' for display logic
        progress: 100,
        customer: this.data.customerMap[
          order.shortName ||
          order.customerShortName ||
          order.customerName ||
          order.originalCustomerName ||
          (order.customer && (order.customer.shortName || order.customer.companyName || order.customer.name)) ||
          ''
        ] || (order.shortName || order.customerShortName || order.customerName || order.originalCustomerName || (order.customer && (order.customer.shortName || order.customer.companyName || order.customer.name)) || ''),
        urgent: false,
        createAt: new Date(order.createTime || order.createdAt).getTime(),
        stockedAt: order.stockedAt || order.stockTime || '',
        materialNo: order.materialNo || (Array.isArray(order.items) && order.items[0] && order.items[0].materialNo) || '',
        materialCode: order.materialCode || order.materialNo || (Array.isArray(order.items) && order.items[0] && (order.items[0].materialCode || order.items[0].materialNo)) || '',
        startTime: this.formatDate(new Date(order.createTime || order.createdAt)),
        expectedTime: order.deliveryDate
      }));

    // 计算统计数据
    const statistics = {
      total: workOrders.length,
      pending: workOrders.filter(item => item.status === 'pending').length,
      processing: workOrders.filter(item => item.status === 'processing').length,
      completed: workOrders.filter(item => item.status === 'completed').length
    };

    const warehouseCount = warehouseOrders.length;

    this.setData({
      workOrderList: workOrders,
      warehouseList: warehouseOrders,
      shippingList: shippingOrders,
      statistics: statistics,
      warehouseCount
    });
    this.updateDisplayList();
  },

  // 将生产订单数据转换为工单格式
  convertProductionOrdersToWorkOrders: function (productionOrders) {
    if (!Array.isArray(productionOrders)) {
      return [];
    }
    const out = [];
    const isPurchase = (o) => {
      const t = String(o && (o.orderType || o.type) || '').toLowerCase();
      const src = String(o && o.source || '').toLowerCase();
      const cat = String(o && (o.purchaseCategory || o.category) || '').toLowerCase();
      const name = String(o && (o.productName || o.product) || '').toLowerCase();
      if (t === 'purchase' || src === 'purchased') return true;
      if (cat.includes('纸板') || cat.includes('paper')) return true;
      if (name.includes('纸板') || name.includes('corrugat') || name.includes('board')) return true;
      return false;
    };
    const mapCustomer = (o) => {
      return this.data.customerMap[
        o.shortName ||
        o.customerShortName ||
        o.customerName ||
        o.originalCustomerName ||
        (o.customer && (o.customer.shortName || o.customer.companyName || o.customer.name)) ||
        ''
      ] || (o.shortName || o.customerShortName || o.customerName || o.originalCustomerName || (o.customer && (o.customer.shortName || o.customer.companyName || o.customer.name)) || o.customer || '未知客户');
    };
    const buildStatus = (o) => {
      let status = 'pending';
      let progress = 0;
      let produced = 0;
      switch (o.status) {
        case 'planned':
        case 'pending':
          status = 'pending';
          progress = 0;
          produced = 0;
          break;
        case 'in_progress':
          status = 'processing';
          progress = o.progress || Math.floor(Math.random() * 70) + 10;
          produced = Math.floor((o.plannedQuantity || o.quantity || 0) * progress / 100);
          break;
        case 'completed':
          status = 'completed';
          progress = 100;
          produced = o.plannedQuantity || o.quantity || 0;
          break;
        default:
          status = 'pending';
          progress = 0;
          produced = 0;
      }
      return { status, progress, produced };
    };
    productionOrders.forEach((order) => {
      if (isPurchase(order)) return;
      const items = Array.isArray(order.items) ? order.items : [];
      const baseNo = String(order.orderNo || order.orderNumber || '').trim();
      const customer = mapCustomer(order);
      const statusMeta = buildStatus(order);
      const pushItem = (item, idx) => {
        if (isPurchase(item || {})) return;
        const no = baseNo ? `${baseNo}-${idx + 1}` : (order.orderNo || order.orderNumber || '');
        out.push({
          id: order._id || order.id || order.productionId || '',
          docId: order._id || order.id || '',
          orderNo: no,
          orderId: order.orderId || '',
          productName: order.productName || order.product || '未知产品',
          goodsName: item && (item.goodsName || item.title || item.productName) || order.goodsName || order.productTitle || order.title || '',
          spec: (item && (item.spec || item.specification || item.productSpec)) || order.specification || order.spec || order.productSpec || '未知规格',
          totalQty: (item && (item.quantity || item.orderQty || item.qty)) || order.plannedQuantity || order.quantity || 0,
          producedQty: statusMeta.produced,
          status: statusMeta.status,
          progress: statusMeta.progress,
          customer: customer,
          createAt: new Date(order.createTime || order.createdAt || order.createdTime || order.createAt || Date.now()).getTime(),
          stockedAt: order.stockedAt || order.stockTime || order.warehousedAt || '',
          materialNo: (item && (item.materialNo || item.material_no)) || order.materialNo || order.material_no || '',
          materialNo: (item && (item.materialNo || item.material_no)) || order.materialNo || order.material_no || '',
          materialCode: order.materialCode || (item && item.materialCode) || '',
          fluteType: order.fluteType || order.flute || (item && item.flute) || '',
          attachments: order.attachments || [],
          urgent: order.priority === 'high' || order.isUrgent === true,
          startTime: this.formatDate(new Date(order.scheduledDate || order.plannedStartDate || order.createdAt || order.createTime)),
          expectedTime: order.expectedCompletionDate || order.plannedEndDate || order.deliveryDate
        });
      };
      if (baseNo && items.length > 1) {
        items.forEach((it, idx) => pushItem(it, idx));
      } else {
        pushItem(items[0] || null, 0);
      }
    });
    return out;
  },

  // 合并生产订单和订单数据
  mergeProductionAndOrderData: function (productionOrders, orders) {
    this.convertOrdersToWorkOrders(orders || []);

    const prodMap = new Map();
    (productionOrders || []).forEach((p) => {
      const no = p && p.orderNo ? String(p.orderNo) : '';
      if (no) prodMap.set(no, p);
    });

    const mergeItem = (item) => {
      if (!item) return item;
      const no = String(item.orderNo || '');
      let p = prodMap.get(no);
      if (!p && /-\d+$/.test(no)) {
        const meta = parseChildOrderNo(no);
        if (meta && meta.parentNo) {
          p = prodMap.get(String(meta.parentNo)) || null;
        }
      }
      if (!p) return item;

      const isFinal = item.status === 'stocked' || item.status === 'shipping';
      const nextProduced = Math.max(Number(item.producedQty || 0), Number(p.producedQty || 0));
      const nextCustomer = item.customer || p.customer;
      const nextSpec = item.spec || p.spec;
      const nextExpected = item.expectedTime || p.expectedTime;

      if (isFinal) {
        return { ...item, producedQty: nextProduced, customer: nextCustomer, spec: nextSpec, expectedTime: nextExpected };
      }

      const nextStatus = p.status || item.status;
      const nextProgress = typeof p.progress === 'number' ? p.progress : item.progress;
      return { ...item, status: nextStatus, progress: nextProgress, producedQty: nextProduced, customer: nextCustomer, spec: nextSpec, expectedTime: nextExpected };
    };

    const nextWorkOrderList = (this.data.workOrderList || []).map(mergeItem);
    const nextWarehouseList = (this.data.warehouseList || []).map(mergeItem);
    const nextShippingList = (this.data.shippingList || []).map(mergeItem);

    const all = nextWorkOrderList;
    const statistics = {
      total: all.length,
      pending: all.filter(i => i.status === 'pending').length,
      processing: all.filter(i => i.status === 'processing').length,
      completed: all.filter(i => i.status === 'completed').length
    };
    const warehouseCount = (nextWarehouseList || []).length;

    this.setData({ workOrderList: nextWorkOrderList, warehouseList: nextWarehouseList, shippingList: nextShippingList, statistics, warehouseCount });
    this.updateDisplayList();
    this.updateDerivedStats();
  },

  // 处理工单数据
  processWorkOrders: function (workOrders) {
    if (!Array.isArray(workOrders) || workOrders.length === 0) {
      this.setData({
        workOrderList: [],
        warehouseList: [],
        shippingList: [],
        displayOrderList: [],
        statistics: {
          total: 0,
          pending: 0,
          processing: 0,
          completed: 0
        }
      });
      return;
    }

    // 分类工单
    const pendingOrders = workOrders.filter(order => order.status === 'pending');
    const processingOrders = workOrders.filter(order => order.status === 'processing');
    const completedOrders = workOrders.filter(order => order.status === 'completed');

    // 计算统计数据
    const statistics = {
      total: workOrders.length,
      pending: pendingOrders.length,
      processing: processingOrders.length,
      completed: completedOrders.length
    };

    // 设置数据
    this.setData({
      workOrderList: workOrders,
      warehouseList: completedOrders, // 已完成的作为已入库
      shippingList: [], // 生产API不直接提供发货数据
      statistics: statistics,
      warehouseCount: completedOrders.length
    });

    // 更新显示列表
    this.updateDisplayList();

    // 更新派生统计数据
    this.updateDerivedStats();
  },

  async loadStockedOrderNos() {
    try {
      const res = await API.getProductionPlans({ limit: 200 });
      const list = res.data || [];
      const nos = list.filter(item => {
        const s = item.status || '';
        return s === 'warehouse' || s === '已入库';
      }).map(item => item.orderNo).filter(Boolean);
      this.setData({ stockedOrderNos: nos });
    } catch (err) {
      logger.error('Production', '加载已入库订单号失败', err);
      this.setData({ stockedOrderNos: [] });
    }
  },

  // 初始化数据（降级方案）
  initData: function () {
    // 空状态，不注入模拟数据
    this.setData({
      workOrderList: [],
      warehouseList: [],
      shippingList: [],
      statistics: { total: 0, pending: 0, processing: 0, completed: 0 }
    });
    this.updateDisplayList();
  },

  // 刷新数据
  refreshData: function () {
    this.setData({ syncStatus: 'syncing' });

    // 强制刷新数据
    getData('orders', true)
      .then(orders => {
        console.log('[生产管理页面] 刷新数据成功:', orders.length);

        this.convertOrdersToWorkOrders(orders);
        this.setData({
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
        console.error('[生产管理页面] 刷新数据失败:', error);

        this.setData({ syncStatus: 'error' });

        wx.showToast({
          title: '刷新失败',
          icon: 'none',
          duration: 1500
        });
      });
  },

  // 格式化日期
  formatDate: function (date) {
    // 处理无效日期
    if (!date || isNaN(date.getTime())) {
      return '';
    }

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');

    return `${year}-${month}-${day} ${hours}:${minutes}`;
  },

  // 筛选工单
  filterOrders: function (e) {
    const status = e.currentTarget.dataset.status;
    this.setData({ filterStatus: status });
    this.updateDisplayList();
  },

  // 获取状态显示
  getStatusText: function (status) {
    const statusMap = {
      'pending': '待生产',
      'processing': '生产中',
      'completed': '已完成',
      'stocked': '已入库',
      'shipping': '已发货',
      'shipped': '已发货',
      'delivered': '已送货',
      'overtime': '已超期'
    };
    return statusMap[status] || '未知';
  },

  // 获取状态样式
  getStatusClass: function (status) {
    return `status-${status}`;
  },

  onSearchInput: function (e) {
    const q = (e.detail && e.detail.value) ? e.detail.value : '';
    this.setData({ searchQuery: q });
    this.updateDisplayList();
  },

  updateDisplayList: function () {
    const status = this.data.filterStatus;
    const q = (this.data.searchQuery || '').trim().toLowerCase();
    let base = [];
    if (status === 'warehouse') {
      base = (this.data.warehouseList || []).slice();
    } else if (status === 'shipping') {
      base = (this.data.shippingList || []).slice();
    } else if (status === 'pending' || status === 'processing' || status === 'ordered') {
      base = (this.data.workOrderList || []).filter(i => i.status === status);
    } else {
      // “全部”视图：不再隐藏 ordered 状态，确保多 SKU 子单（可能还未开始生产）也能显示
      base = (this.data.workOrderList || []).slice();
    }

    const display = base.filter(item => {
      if (!q) return true;
      const fields = [
        item.orderNo || '',
        item.customer || '',
        item.spec || '',
        item.productName || '',
        item.goodsName || '',
        item.materialNo || '',
        item.materialCode || ''
      ].map(s => String(s).toLowerCase());
      return fields.some(s => s.includes(q));
    }).sort((a, b) => {
      // 按下单时间降序排列，新订单排在最上面
      const getTime = (item) => {
        // 优先使用 createAt 时间戳
        if (item.createAt && !isNaN(item.createAt)) return item.createAt;
        // 其次使用 startTime 字符串解析
        if (item.startTime) {
          const parsed = Date.parse(item.startTime);
          if (!isNaN(parsed)) return parsed;
        }
        // 最后使用订单号中的时间信息或当前时间
        const orderNo = item.orderNo || '';
        const dateMatch = orderNo.match(/(20\d{2})(\d{2})(\d{2})/);
        if (dateMatch) {
          const [, year, month, day] = dateMatch;
          return new Date(`${year}-${month}-${day}`).getTime();
        }
        return Date.now(); // 默认返回当前时间，确保新数据在前面
      };

      const timeA = getTime(a);
      const timeB = getTime(b);
      return timeB - timeA; // 降序排列，新订单在前
    });
    this.setData({ displayOrderList: display });
  },

  // 查看详情
  viewDetail: function (e) {
    const orderNo = e.currentTarget.dataset.orderno;
    const all = (this.data.workOrderList || []).concat(this.data.warehouseList || []).concat(this.data.shippingList || []);
    const item = all.find(i => i.orderNo === orderNo) || null;
    const id = item && (item.id || item.docId) ? (item.id || item.docId) : '';
    const qs = orderNo ? `?orderNo=${encodeURIComponent(orderNo)}` : (id ? `?orderId=${encodeURIComponent(id)}` : '');
    wx.navigateTo({
      url: `/pages/production-sub/detail/detail${qs}`,
      success: (res) => {
        try {
          res.eventChannel && res.eventChannel.emit('orderRoute', { orderId: id, orderNo });
        } catch (_) { }
      },
      fail: () => {
        const altQs = orderNo ? `?orderNo=${encodeURIComponent(orderNo)}` : (id ? `?orderId=${encodeURIComponent(id)}` : '');
        wx.navigateTo({ url: `/pages/order-sub/detail/detail${altQs}` });
      }
    });
  },

  updateDerivedStats: function () {
    const isProducedCompleted = (it) => {
      const s = String(it && it.status || '').toLowerCase();
      return s === 'completed' || s === 'stocked' || s === 'shipping' || s === 'shipped';
    };
    const toTs = (value) => {
      if (!value) return 0;
      if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
      if (value instanceof Date) return value.getTime();
      const t = Date.parse(value);
      return Number.isFinite(t) ? t : 0;
    };
    const toCreateTs = (item) => {
      const direct = toTs(item && (item.createAt || item.createdAt || item.createTime || item.createdTime));
      if (direct) return direct;
      const fromStart = toTs(item && item.startTime);
      if (fromStart) return fromStart;
      const orderNo = String(item && item.orderNo || '');
      const dateMatch = orderNo.match(/(20\d{2})(\d{2})(\d{2})/);
      if (dateMatch) {
        const [, year, month, day] = dateMatch;
        return new Date(`${year}-${month}-${day}`).getTime();
      }
      return 0;
    };
    const toStockTs = (item) => {
      return toTs(item && (item.stockedAt || item.stockTime || item.warehousedAt));
    };
    const all = []
      .concat(this.data.workOrderList || [])
      .concat(this.data.warehouseList || [])
      .concat(this.data.shippingList || []);
    const unique = new Map();
    all.forEach((it) => {
      const key = it && it.orderNo ? String(it.orderNo) : '';
      if (!key) return;
      if (!unique.has(key)) unique.set(key, it);
      else {
        const prev = unique.get(key);
        const prevStock = toStockTs(prev);
        const nextStock = toStockTs(it);
        if (nextStock && (!prevStock || nextStock > prevStock)) unique.set(key, it);
      }
    });
    const total = unique.size;
    let producedCompletedCount = 0;
    unique.forEach((it) => {
      if (isProducedCompleted(it)) producedCompletedCount += 1;
    });
    const completionRate = total ? Math.round((producedCompletedCount / total) * 100) : 0;
    const durations = [];
    unique.forEach((it) => {
      const createTs = toCreateTs(it);
      const stockTs = toStockTs(it);
      if (!createTs || !stockTs || stockTs < createTs) return;
      durations.push((stockTs - createTs) / 86400000);
    });
    const avgDeliveryDays = durations.length ? Math.round((durations.reduce((a, b) => a + b, 0) / durations.length) * 10) / 10 : 0;
    this.setData({ completionRate, avgDeliveryDays });
  },

  _parseScanOrderRef: function (rawInput) {
    const raw = rawInput ? String(rawInput).trim() : '';
    let orderId = '';
    let orderNo = '';
    if (!raw) return { orderId, orderNo };

    if (/^https?:\/\//.test(raw)) {
      const mId = raw.match(/[?&]orderId=([^&]+)/);
      const mNo = raw.match(/[?&]orderNo=([^&]+)/);
      if (mId) orderId = decodeURIComponent(mId[1]);
      if (mNo) orderNo = decodeURIComponent(mNo[1]);
      return { orderId: String(orderId || '').trim(), orderNo: String(orderNo || '').trim() };
    }

    try {
      const obj = JSON.parse(raw);
      orderId = obj.subOrderId || obj.childOrderId || obj.orderId || obj.id || obj._id || '';
      orderNo = obj.subOrderNo || obj.childOrderNo || obj.orderNo || obj.orderNumber || '';
    } catch (_) { }

    if (!orderId && !orderNo) {
      if (/^[a-fA-F0-9]{24}$/.test(raw)) orderId = raw;
      else orderNo = raw;
    }

    return { orderId: String(orderId || '').trim(), orderNo: String(orderNo || '').trim() };
  },

  _parseChildOrderNo: function (orderNo) {
    const no = String(orderNo || '').trim();
    if (!no) return null;
    const m = no.match(/^(.*)-(\d+)$/);
    if (!m) return null;
    const parentNo = String(m[1] || '').trim();
    const idx = Number(m[2] || 0) - 1;
    if (!parentNo || !(Number.isFinite(idx) && idx >= 0)) return null;
    return { parentNo, idx, childNo: no };
  },

  _resolveScanOrderNo: function (orderNo) {
    const displayNo = String(orderNo || '').trim();
    const meta = this._parseChildOrderNo(displayNo);
    if (meta && meta.parentNo) return { displayNo, fetchNo: meta.parentNo, meta };
    return { displayNo, fetchNo: displayNo, meta: null };
  },

  _fetchOrderByScanRef: function (ref) {
    const orderId = ref && ref.orderId ? String(ref.orderId).trim() : '';
    const orderNo = ref && ref.orderNo ? String(ref.orderNo).trim() : '';
    const meta = this._parseChildOrderNo(orderNo);
    const parentNo = meta && meta.parentNo ? String(meta.parentNo).trim() : '';
    const planMatchNo = parentNo || orderNo;

    const pick = (arr) => {
      const list = Array.isArray(arr) ? arr : [];
      if (orderId) {
        const found = list.find(o => o && (o._id === orderId || o.id === orderId));
        if (found) return found;
      }
      if (orderNo) {
        const found = list.find(o => o && (o.orderNo === orderNo || o.orderNumber === orderNo));
        if (found) return found;
      }
      return null;
    };

    return new Promise((resolve) => {
      const fallbackToCloud = async () => {
        if (orderId) {
          try {
            const planRes = await API.getProductionPlanDetail(orderId);
            const plan = planRes && planRes.data ? planRes.data : null;
            if (plan) { resolve(plan); return; }
          } catch (_) { }
        }

        if (orderId) {
          try {
            const plansRes = await API.getProductionPlans({ page: 1, limit: 10, orderId });
            const plans = plansRes && Array.isArray(plansRes.data) ? plansRes.data : [];
            if (plans.length) { resolve(plans[0]); return; }
          } catch (_) { }

          try {
            const data = await API.getOrderDetail(orderId);
            if (data) {
              try {
                const plansRes = await API.getProductionPlans({ page: 1, limit: 10, orderId: data._id || data.id || orderId });
                const plans = plansRes && Array.isArray(plansRes.data) ? plansRes.data : [];
                if (plans.length) { resolve(plans[0]); return; }
              } catch (_) { }
              resolve(data);
              return;
            }
            if (!orderNo) { resolve(null); return; }

            const r2 = await API.getOrders({ page: 1, limit: 10, keyword: orderNo });
            const rows = r2.data || [];
            resolve(pick(rows) || null);
          } catch (err) {
            if (!orderNo) { resolve(null); return; }
            try {
              const r2 = await API.getOrders({ page: 1, limit: 10, keyword: orderNo });
              const rows = r2.data || [];
              resolve(pick(rows) || null);
            } catch (err2) {
              resolve(null);
            }
          }
          return;
        }

        if (orderNo) {
          try {
            const r2 = await API.getOrders({ page: 1, limit: 10, keyword: orderNo });
            const rows = r2.data || [];
            let hit = pick(rows) || null;
            if (!hit && parentNo) {
              try {
                const r3 = await API.getOrders({ page: 1, limit: 10, keyword: parentNo });
                const rows2 = r3.data || [];
                hit = pick(rows2) || null;
              } catch (_) { }
            }
            if (hit && hit._id) {
              try {
                const plansRes = await API.getProductionPlans({ page: 1, limit: 10, orderId: hit._id });
                const plans = plansRes && Array.isArray(plansRes.data) ? plansRes.data : [];
                const plan =
                  plans.find(p => p && (p.orderNo === planMatchNo || p.orderNumber === planMatchNo)) ||
                  plans[0] ||
                  null;
                if (plan) { resolve(plan); return; }
              } catch (_) { }
            }
            resolve(hit);
          } catch (err) {
            resolve(null);
          }
          return;
        }

        resolve(null);
      };

      try {
        getData('orders', false)
          .then((orders) => {
            const found = pick(orders);
            if (found) { resolve(found); return; }
            fallbackToCloud();
          })
          .catch(() => fallbackToCloud());
      } catch (_) {
        fallbackToCloud();
      }
    });
  },

  async startProductionScan() {
    wx.scanCode({
      success: (res) => {
        const raw = (res && res.result) ? String(res.result).trim() : '';
        const ref = this._parseScanOrderRef(raw);
        const scannedNo = ref.orderNo || '';
        const orderId = ref.orderId || '';
        const resolved = this._resolveScanOrderNo(scannedNo);
        const fetchNo = resolved.fetchNo || '';
        const displayNo = resolved.displayNo || '';

        const startLocal = async (idx, list) => {
          list[idx].status = 'processing';
          list[idx].startAt = Date.now();
          const statistics = {
            total: list.length,
            pending: list.filter(i => i.status === 'pending').length,
            processing: list.filter(i => i.status === 'processing').length,
            completed: list.filter(i => i.status === 'completed').length
          };
          this.setData({ workOrderList: list, statistics });
          this.updateDerivedStats();
          this.updateDisplayList();
          const id = list[idx].id || list[idx].docId || '';
          try {
            const updateRes = await API.updateProductionPlan(list[idx].id, {
              status: 'processing',
              startAt: Date.now()
            });
            try {
              await API.syncBoardUsageOnStart({
                orderId: id,
                orderNo: list[idx].orderNo || list[idx].orderNumber || ''
              });
            } catch (_) { }
            wx.showToast({ title: '已开始', icon: 'success' });
            // 清除缓存并刷新
            clearCache('getProductionPlans');
            this.loadProductionData(true);
          } catch (err) {
            logger.error('Production', '开始生产失败', err);
            wx.showToast({ title: '开始生产失败', icon: 'none' });
          }
          const baseQs = list[idx].orderNo ? `?orderNo=${encodeURIComponent(list[idx].orderNo)}` : (id ? `?orderId=${encodeURIComponent(id)}` : '');
          const qs = baseQs ? `${baseQs}&from=startScan` : `?from=startScan`;
          wx.navigateTo({
            url: `/pages/production-sub/detail/detail${qs}`,
            success: (res) => {
              try {
                res.eventChannel && res.eventChannel.emit('orderRoute', { orderId: id, orderNo: list[idx].orderNo });
              } catch (_) { }
            },
            fail: () => {
              const itm = list[idx] || {};
              const id2 = itm.id || itm.docId || '';
              const baseQs2 = itm.orderNo ? `?orderNo=${encodeURIComponent(itm.orderNo)}` : (id2 ? `?orderId=${encodeURIComponent(id2)}` : '');
              const qs2 = baseQs2 ? `${baseQs2}&from=startScan` : `?from=startScan`;
              wx.navigateTo({ url: `/pages/order-sub/detail/detail${qs2}` });
            }
          });
        };

        const list = (this.data.workOrderList || []).slice();
        const idxByNo = (no) => (no
          ? list.findIndex(item => item && (item.orderNo === no || item.orderNumber === no))
          : -1);
        let idx = idxByNo(displayNo);
        if (idx === -1 && fetchNo && fetchNo !== displayNo) idx = idxByNo(fetchNo);
        if (idx === -1 && orderId) idx = list.findIndex(item => item && (item.id === orderId || item.docId === orderId || item._id === orderId));

        if (idx !== -1) {
          startLocal(idx, list);
          return;
        }

        const all = []
          .concat(this.data.workOrderList || [])
          .concat(this.data.warehouseList || [])
          .concat(this.data.shippingList || [])
          .concat(this.data.displayOrderList || []);

        let item = null;
        if (displayNo) item = all.find(i => i && (i.orderNo === displayNo || i.orderNumber === displayNo)) || null;
        if (!item && fetchNo && fetchNo !== displayNo) item = all.find(i => i && (i.orderNo === fetchNo || i.orderNumber === fetchNo)) || null;
        if (!item && orderId) item = all.find(i => i && (i.id === orderId || i.docId === orderId || i._id === orderId)) || null;

        const buildDetailQs = (noForNav, idForNav, fromTag) => {
          const n = String(noForNav || '').trim();
          const i = String(idForNav || '').trim();
          const parts = [];
          if (n) parts.push(`orderNo=${encodeURIComponent(n)}`);
          if (i) parts.push(`orderId=${encodeURIComponent(i)}`);
          if (fromTag) parts.push(`from=${encodeURIComponent(fromTag)}`);
          return parts.length ? `?${parts.join('&')}` : '';
        };

        const navigateOnly = async (opNo, opId) => {
          const navNo = displayNo || opNo || '';
          try {
            await API.updateProductionPlan(opId, { status: 'processing', startAt: Date.now() });
            try {
              await API.syncBoardUsageOnStart({
                orderId: opId,
                orderNo: opNo
              });
            } catch (_) { }
            wx.showToast({ title: '已开始', icon: 'success' });
            clearCache('getProductionPlans');
            this.loadProductionData(true);
          } catch (err) {
            logger.error('Production', '开始生产失败', err);
            wx.showToast({ title: '开始生产失败', icon: 'none' });
          }
          const qs = buildDetailQs(navNo, opId, 'startScan');
          wx.navigateTo({
            url: `/pages/production-sub/detail/detail${qs}`,
            success: (res) => {
              try {
                res.eventChannel && res.eventChannel.emit('orderRoute', { orderId: opId, orderNo: navNo });
              } catch (_) { }
            },
            fail: () => {
              wx.navigateTo({ url: `/pages/order-sub/detail/detail${qs}` });
            }
          });
        };

        if (item) {
          const opNo = item.orderNo || item.orderNumber || fetchNo || displayNo || '';
          const opId = item.id || item.docId || item._id || orderId || '';
          navigateOnly(opNo, opId);
          return;
        }

        if (!displayNo && !fetchNo && !orderId) {
          wx.showToast({ title: '无法识别二维码', icon: 'none' });
          return;
        }

        this._fetchOrderByScanRef({ orderNo: fetchNo || displayNo, orderId })
          .then((found) => {
            if (!found) { wx.showToast({ title: '工单不存在', icon: 'error' }); return; }
            const opNo = found.orderNo || found.orderNumber || fetchNo || displayNo || '';
            const opId = found._id || found.id || orderId || '';
            if (!opNo && !opId) { wx.showToast({ title: '工单不存在', icon: 'error' }); return; }
            navigateOnly(opNo, opId);
          })
          .catch(() => wx.showToast({ title: '工单不存在', icon: 'error' }));
      },
      fail: () => {
        wx.showToast({ title: '扫码失败', icon: 'error' });
      }
    });
  },

  printCompleteScan: function () {
    wx.scanCode({
      success: (res) => {
        const raw = (res && res.result) ? String(res.result).trim() : '';
        const ref = this._parseScanOrderRef(raw);
        const scannedNo = ref.orderNo || '';
        const orderId = ref.orderId || '';
        const resolved = this._resolveScanOrderNo(scannedNo);
        const fetchNo = resolved.fetchNo || '';
        const displayNo = resolved.displayNo || '';

        const list = (this.data.workOrderList || []).slice();
        const idxByNo = (no) => (no
          ? list.findIndex(item => item && (item.orderNo === no || item.orderNumber === no))
          : -1);
        let idx = idxByNo(displayNo);
        if (idx === -1 && fetchNo && fetchNo !== displayNo) idx = idxByNo(fetchNo);
        if (idx === -1 && orderId) idx = list.findIndex(item => item && (item.id === orderId || item.docId === orderId || item._id === orderId));

        const openDialogFromItem = (item, resolvedNo, resolvedId) => {
          const dlg = {
            orderNo: resolvedNo || item.orderNo || item.orderNumber || '',
            id: resolvedId || item.id || item.docId || item._id || '',
            customer: item.customer || '-',
            productName: item.productName,
            spec: item.spec,
            materialCode: item.materialCode || '',
            fluteType: item.fluteType || item.flute || '',
            totalQty: item.totalQty,
            currentProduced: item.producedQty || 0,
            drawings: Array.isArray(item.attachments) ? item.attachments : [],
            paperSize: item.paperSize || '',
            creaseText: item.creaseText || '',
            inputQty: ''
          };
          this.setData({ showCompleteDialog: true, completeDialog: dlg });
        };

        if (idx !== -1) {
          const it = list[idx] || {};
          const resolvedId = it.id || it.docId || it._id || orderId || '';
          openDialogFromItem(it, it.orderNo || it.orderNumber || '', resolvedId);
          return;
        }

        const all = []
          .concat(this.data.workOrderList || [])
          .concat(this.data.warehouseList || [])
          .concat(this.data.shippingList || [])
          .concat(this.data.displayOrderList || []);
        let item = null;
        if (displayNo) item = all.find(i => i && (i.orderNo === displayNo || i.orderNumber === displayNo)) || null;
        if (!item && fetchNo && fetchNo !== displayNo) item = all.find(i => i && (i.orderNo === fetchNo || i.orderNumber === fetchNo)) || null;
        if (!item && orderId) item = all.find(i => i && (i.id === orderId || i.docId === orderId || i._id === orderId)) || null;
        if (item) {
          const resolvedId = item.id || item.docId || item._id || orderId || '';
          openDialogFromItem(item, item.orderNo || item.orderNumber || '', resolvedId);
          return;
        }

        if (!displayNo && !fetchNo && !orderId) { wx.showToast({ title: '无法识别二维码', icon: 'none' }); return; }

        this._fetchOrderByScanRef({ orderNo: fetchNo || displayNo, orderId })
          .then((found) => {
            if (!found) { wx.showToast({ title: '工单不存在', icon: 'error' }); return; }
            const items = Array.isArray(found.items) ? found.items : [];
            const first = items[0] || {};
            const qty = Number(found.quantity || found.plannedQuantity || found.totalQty || items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)) || 0;
            const bw = first.boardWidth || found.boardWidth || found.paperWidth || '';
            const bh = first.boardHeight || found.boardHeight || found.paperLength || '';
            const paperSize = found.paperSize || ((bw || bh) ? `${bw}×${bh}` : '');
            const c1 = found.creasingSize1 || first.creasingSize1 || 0;
            const c2 = found.creasingSize2 || first.creasingSize2 || 0;
            const c3 = found.creasingSize3 || first.creasingSize3 || 0;
            const creaseText = found.creaseText || ((c1 || c2 || c3) ? `${c1}-${c2}-${c3}` : (found.creasingType || ''));
            const dlg = {
              orderNo: found.orderNo || found.orderNumber || '',
              id: found._id || found.id || orderId || '',
              customer: found.shortName || found.customerShortName || found.customerName || (found.customer && (found.customer.shortName || found.customer.companyName || found.customer.name)) || '-',
              productName: found.productName || found.goodsName || found.productTitle || first.goodsName || first.title || first.productName || '',
              spec: found.spec || first.spec || '',
              materialCode: found.materialCode || found.materialNo || first.materialCode || first.materialNo || '',
              fluteType: found.fluteType || found.flute || first.flute || '',
              totalQty: qty,
              currentProduced: Number(found.producedQty || 0),
              drawings: Array.isArray(found.attachments) ? found.attachments : [],
              paperSize,
              creaseText,
              inputQty: ''
            };
            this.setData({ showCompleteDialog: true, completeDialog: dlg });
          })
          .catch(() => wx.showToast({ title: '工单不存在', icon: 'error' }));
      },
      fail: () => {
        wx.showToast({ title: '扫码失败', icon: 'error' });
      }
    });
  },

  previewDrawing: function () {
    const dlg = this.data.completeDialog || {};
    const id = dlg.id || '';
    const localAtt = Array.isArray(dlg.drawings) ? dlg.drawings : [];
    const httpImages = localAtt
      .map(a => (a && (a.url || a.tempFileURL)) || '')
      .filter(u => typeof u === 'string' && /^https?:\/\//.test(u) && /(\.png|\.jpg|\.jpeg|\.gif)$/i.test(u));
    if (httpImages.length) { wx.previewImage({ urls: httpImages }); return; }
    const fileIDs = localAtt
      .map(a => (a && (a.fileID || a.fileId)) || '')
      .filter(fid => typeof fid === 'string' && fid);
    if (fileIDs.length) {
      try {
        wx.cloud.getTempFileURL({ fileList: fileIDs.map(fid => ({ fileID: fid, maxAge: 3600 })) })
          .then(r => {
            const urls = ((r && r.fileList) ? r.fileList : [])
              .map(it => it.tempFileURL)
              .filter(u => typeof u === 'string' && /(\.png|\.jpg|\.jpeg|\.gif)$/i.test(u));
            if (urls.length) { wx.previewImage({ urls }); return; }
            wx.showToast({ title: '无可预览图片', icon: 'none' });
          })
          .catch(() => wx.showToast({ title: '预览失败', icon: 'none' }));
      } catch (_) { wx.showToast({ title: '预览失败', icon: 'none' }); }
      return;
    }
    if (!id) {
      wx.showToast({ title: '无图纸', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '加载图纸...' });
    API.getOrderDetail(id).then(data => {
      const att = Array.isArray(data && data.attachments) ? data.attachments : [];
      const httpUrls = att
        .map(a => a && (a.url || a.tempFileURL))
        .filter(u => typeof u === 'string' && /^https?:\/\//.test(u) && /(\.png|\.jpg|\.jpeg|\.gif)$/i.test(u));
      if (httpUrls.length) { wx.previewImage({ urls: httpUrls }); return; }
      const ids = att.map(a => a && (a.fileID || a.fileId)).filter(fid => typeof fid === 'string' && fid);
      if (ids.length) {
        try {
          wx.cloud.getTempFileURL({ fileList: ids.map(fid => ({ fileID: fid, maxAge: 3600 })) })
            .then(r => {
              const urls = ((r && r.fileList) ? r.fileList : []).map(it => it.tempFileURL).filter(Boolean);
              if (urls.length) { wx.previewImage({ urls }); return; }
              wx.showToast({ title: '无可预览图片', icon: 'none' });
            })
            .catch(() => wx.showToast({ title: '预览失败', icon: 'none' }));
        } catch (_) { wx.showToast({ title: '预览失败', icon: 'none' }); }
        return;
      }
      wx.showToast({ title: '无可预览图片', icon: 'none' });
    }).catch(() => {
      wx.showToast({ title: '加载失败', icon: 'none' });
    }).finally(() => {
      wx.hideLoading();
    });
  },

  scanStockIn: function () {
    wx.scanCode({
      success: (res) => {
        const raw = (res && res.result) ? String(res.result).trim() : '';
        const ref = this._parseScanOrderRef(raw);
        const scannedNo = ref.orderNo || '';
        const orderId = ref.orderId || '';
        const resolved = this._resolveScanOrderNo(scannedNo);
        const fetchNo = resolved.fetchNo || '';
        const displayNo = resolved.displayNo || '';
        const list = (this.data.workOrderList || []).slice();
        const idxByNo = (no) => (no
          ? list.findIndex(item => item && (item.orderNo === no || item.orderNumber === no))
          : -1);
        let idx = idxByNo(displayNo);
        if (idx === -1 && fetchNo && fetchNo !== displayNo) idx = idxByNo(fetchNo);
        if (idx === -1 && orderId) idx = list.findIndex(item => item && (item.id === orderId || item.docId === orderId || item._id === orderId));
        let item = null;
        if (idx !== -1) item = list[idx];
        if (!item) {
          const whIdxByNo = (no) => (no
            ? (this.data.warehouseList || []).findIndex(i => i && (i.orderNo === no || i.orderNumber === no))
            : -1);
          let whIdx = whIdxByNo(displayNo);
          if (whIdx === -1 && fetchNo && fetchNo !== displayNo) whIdx = whIdxByNo(fetchNo);
          if (whIdx === -1 && orderId) whIdx = (this.data.warehouseList || []).findIndex(i => i && (i.id === orderId || i.docId === orderId || i._id === orderId));
          if (whIdx !== -1) item = (this.data.warehouseList || [])[whIdx];
        }
        if (!item && (displayNo || fetchNo || orderId)) {
          this._fetchOrderByScanRef({ orderNo: fetchNo || displayNo, orderId })
            .then((found) => {
              if (!found) { wx.showToast({ title: '工单不存在', icon: 'error' }); return; }
              const items = Array.isArray(found.items) ? found.items : [];
              const first = items[0] || {};
              const qty = Number(found.quantity || found.totalQty || items.reduce((s, it) => s + (Number(it.quantity) || 0), 0)) || 0;
              const dlg = {
                orderNo: found.orderNo || found.orderNumber || fetchNo || displayNo || '',
                id: found._id || found.id || orderId || '',
                customer: found.shortName || found.customerShortName || found.customerName || (found.customer && (found.customer.shortName || found.customer.companyName || found.customer.name)) || '-',
                spec: found.spec || first.spec || '-',
                productName: found.goodsName || found.productTitle || found.title || (found.product && (found.product.title || found.product.name)) || first.goodsName || first.title || first.productName || '无',
                materialNo: found.materialNo || (found.product && (found.product.materialNo || found.product.materialCode)) || first.materialNo || first.materialCode || '无',
                orderQty: qty,
                stockedQty: Number(found.stockedQty || 0),
                completedQty: Number(found.producedQty || 0),
                inputQty: found.stockedQty ? String(found.stockedQty) : ''
              };
              this.setData({ showStockDialog: true, stockDialog: dlg });
            })
            .catch(() => wx.showToast({ title: '工单不存在', icon: 'error' }));
          return;
        }
        if (!item) { wx.showToast({ title: '工单不存在', icon: 'error' }); return; }
        const dlg = {
          orderNo: item.orderNo || item.orderNumber || fetchNo || displayNo || '',
          id: item.id || item.docId || item._id || orderId || '',
          customer: item.customer || '-',
          spec: item.spec || '-',
          productName: item.goodsName || item.productName || '无',
          materialNo: item.materialNo || '无',
          orderQty: item.totalQty || item.quantity || 0,
          stockedQty: item.stockedQty || 0,
          completedQty: item.producedQty || 0,
          inputQty: item.stockedQty ? String(item.stockedQty) : ''
        };
        this.setData({ showStockDialog: true, stockDialog: dlg });
        try {
          getData('orders', false).then(orders => {
            const arr = Array.isArray(orders) ? orders : [];
            const found = arr.find(o => (o.orderNo === dlg.orderNo || o.orderNumber === dlg.orderNo || o._id === dlg.id || o.id === dlg.id));
            if (!found) return;
            const items = Array.isArray(found.items) ? found.items : [];
            const first = items[0] || {};
            const productName =
              found.goodsName ||
              found.productTitle ||
              found.title ||
              (found.product && (found.product.title || found.product.name)) ||
              first.goodsName ||
              first.title ||
              first.productName ||
              this.data.stockDialog.productName ||
              '无';
            const materialNo =
              found.materialNo ||
              (found.product && (found.product.materialNo || found.product.materialCode)) ||
              first.materialNo ||
              first.materialCode ||
              '无';
            this.setData({ stockDialog: Object.assign({}, this.data.stockDialog, { productName, materialNo }) });
          }).catch(() => { });
        } catch (_) { }
      },
      fail: () => {
        wx.showToast({ title: '扫码失败', icon: 'error' });
      }
    });
  },

  scanShipment: function () {
    wx.scanCode({
      success: (res) => {
        const raw = (res && res.result) ? String(res.result).trim() : '';
        if (!raw) { wx.showToast({ title: '无法识别二维码', icon: 'none' }); return; }

        let orderId = '';
        let orderNo = '';
        // 增强的ID/No识别逻辑
        if (/^https?:\/\//.test(raw)) {
          const mId = raw.match(/[?&]orderId=([^&]+)/);
          const mNo = raw.match(/[?&]orderNo=([^&]+)/);
          if (mId) orderId = decodeURIComponent(mId[1]);
          if (mNo) orderNo = decodeURIComponent(mNo[1]);
        } else {
          try {
            const obj = JSON.parse(raw);
            orderId = obj.orderId || obj.id || obj._id || '';
            orderNo = obj.orderNo || obj.orderNumber || '';
          } catch (_) { }
          if (!orderId && !orderNo) {
            // 支持 24位 Mongo ID 和 36位 UUID
            if (/^[a-fA-F0-9]{24}$/.test(raw) || /^[0-9a-fA-F-]{36}$/.test(raw)) orderId = raw;
            else orderNo = raw;
          }
        }

        // 无论本地是否找到，都将进入对话框并在对话框逻辑中加载最新数据
        // 这里仅做初步匹配用于快速响应，最终数据以 _openShipmentDialogFromItem 加载为准
        const all = []
          .concat(this.data.workOrderList || [])
          .concat(this.data.warehouseList || [])
          .concat(this.data.shippingList || [])
          .concat(this.data.displayOrderList || []);

        let item = null;
        if (orderNo) {
          item = all.find(i => i && (i.orderNo === orderNo || i.orderNumber === orderNo));
        }
        if (!item && orderId) {
          item = all.find(i => i && (i.id === orderId || i.docId === orderId || i._id === orderId));
        }

        // 传递识别到的 ID 和 No，确保即使 item 为空也能尝试加载
        this._openShipmentDialogFromItem(item || {}, orderNo, orderId);
      },
      fail: () => {
        wx.showToast({ title: '扫码失败', icon: 'error' });
      }
    });
  },

  _openShipmentDialogFromItem: function (item, orderNo, orderId) {
    const safeItem = item || {};
    const effectiveOrderNo = orderNo || safeItem.orderNo || safeItem.orderNumber || '';
    const effectiveId = orderId || safeItem.id || safeItem.docId || safeItem._id || '';

    // 初始化对话框数据（展示加载中或旧数据）
    const dlg = {
      orderNo: effectiveOrderNo,
      id: effectiveId,
      customer: safeItem.customer || '-',
      spec: safeItem.spec || '-',
      productName: safeItem.goodsName || safeItem.productName || '加载中...',
      materialNo: safeItem.materialNo || '-',
      orderQty: safeItem.totalQty || safeItem.quantity || 0,
      stockedQty: Number(safeItem.stockedQty || 0),
      shippedQty: Number(safeItem.shippedQty || 0),
      remainingQty: 0,
      inputQty: '',
      inputDisabled: true, // 加载完成前禁用输入
      inputPlaceholder: '正在同步最新数据...',
      overwriteMode: false
    };
    this.setData({ showShipmentDialog: true, shipmentDialog: dlg });

    if (!effectiveId && !effectiveOrderNo) {
      wx.showToast({ title: '无法识别订单信息', icon: 'none' });
      return;
    }

    // 强制从服务器获取最新数据
    const cloud = require('../../utils/cloud.js');
    const { API } = require('../../utils/unified-api.js');

    // 优先使用 API.getOrderDetail (如果可用且支持ID), 或者使用通用查询
    const fetchPromise = effectiveId
      ? API.getOrderDetail(effectiveId)
      : cloud.callERPAPI('getOrders', { params: { orderNo: effectiveOrderNo, limit: 1 } });

    fetchPromise.then(res => {
      let found = null;
      if (res && res.data && !Array.isArray(res.data)) {
        found = res.data; // getOrderDetail 返回单个对象
      } else if (res && res.data && Array.isArray(res.data) && res.data.length > 0) {
        found = res.data[0]; // getOrders 返回数组
      } else if (res && res.result && res.result.data) {
        found = Array.isArray(res.result.data) ? res.result.data[0] : res.result.data;
      }

      if (!found) {
        wx.showToast({ title: '未找到订单信息', icon: 'none' });
        this.setData({ 'shipmentDialog.productName': '未找到订单' });
        return;
      }

      // 计算最新数据
      const stockedQty = Number(found.stockedQty || 0);
      const shippedQty = Number(found.shippedQty || 0);
      const totalQty = Number(found.quantity || found.totalQty || 0); // 优先使用 quantity
      const baseQty = stockedQty > 0 ? stockedQty : totalQty;
      const remainingQty = baseQty > 0 ? Math.max(0, baseQty - shippedQty) : 0;
      const shippedCompleted = baseQty > 0 && remainingQty <= 0 && shippedQty > 0;

      // 提取商品信息
      const items = Array.isArray(found.items) ? found.items : [];
      const first = items[0] || {};
      const productName = found.goodsName || found.productTitle || found.title || (found.product && (found.product.title || found.product.name)) || first.goodsName || first.title || first.productName || '';
      const materialNo = found.materialNo || (found.product && (found.product.materialNo || found.product.materialCode)) || first.materialNo || first.materialCode || '无';

      const nextDlg = {
        orderNo: found.orderNo || found.orderNumber,
        id: found._id || found.id,
        customer: found.customerName || (found.customer && found.customer.name) || '-',
        spec: found.spec || (found.product && found.product.spec) || '-',
        productName: productName,
        materialNo: materialNo,
        orderQty: totalQty,
        stockedQty,
        shippedQty,
        remainingQty,
        inputQty: '',
        inputDisabled: false,
        inputPlaceholder: shippedCompleted ? '请输入修正后的累计发货数量' : '请输入本次发货数量',
        overwriteMode: shippedCompleted
      };

      this.setData({ shipmentDialog: nextDlg });

    }).catch(err => {
      console.error('扫码获取详情失败', err);
      wx.showToast({ title: '同步数据失败', icon: 'none' });
      this.setData({ 'shipmentDialog.inputDisabled': false, 'shipmentDialog.inputPlaceholder': '网络异常，正如显示本地缓存' });
    });
  },

  onCompleteQtyInput: function (e) {
    const val = e.detail && e.detail.value ? e.detail.value : '';
    this.setData({ completeDialog: Object.assign({}, this.data.completeDialog, { inputQty: val }) });
  },
  cancelComplete: function () { this.setData({ showCompleteDialog: false }); },
  confirmComplete: function () {
    const d = this.data.completeDialog || {};
    const qty = Math.max(0, parseInt(d.inputQty || '0', 10));
    if (!qty) { wx.showToast({ title: '请输入数量', icon: 'none' }); return; }
    const inputNo = String(d.orderNo || '').trim();
    const inputId = String(d.id || '').trim();
    const matchByNo = (i) => {
      if (!i || !inputNo) return false;
      return i.orderNo === inputNo || i.orderNumber === inputNo;
    };
    const matchById = (i) => {
      if (!i || !inputId) return false;
      return i.id === inputId || i.docId === inputId || i._id === inputId;
    };

    const workOrderList = (this.data.workOrderList || []).slice();
    const warehouseList = (this.data.warehouseList || []).slice();
    const shippingList = (this.data.shippingList || []).slice();

    const findIndexIn = (arr) => {
      let idx = arr.findIndex(matchByNo);
      if (idx === -1) idx = arr.findIndex(matchById);
      return idx;
    };

    const idx = findIndexIn(workOrderList);
    const whIdx = idx === -1 ? findIndexIn(warehouseList) : -1;
    const shIdx = (idx === -1 && whIdx === -1) ? findIndexIn(shippingList) : -1;

    const resolveNextStatus = (current) => {
      const s = String(current || '').toLowerCase();
      if (['stocked', 'shipping', 'shipped', 'delivered', 'completed'].includes(s)) return s;
      return 'processing';
    };

    const applyUpdate = (item) => {
      const nextStatus = resolveNextStatus(item && item.status);
      const nextProgress = typeof item.progress === 'number' ? item.progress : (nextStatus === 'processing' ? 50 : item.progress);
      return Object.assign({}, item, { producedQty: qty, status: nextStatus, progress: nextProgress });
    };

    let updatedItem = null;
    if (idx !== -1) {
      updatedItem = applyUpdate(workOrderList[idx]);
      workOrderList[idx] = updatedItem;
    } else if (whIdx !== -1) {
      updatedItem = applyUpdate(warehouseList[whIdx]);
      warehouseList[whIdx] = updatedItem;
    } else if (shIdx !== -1) {
      updatedItem = applyUpdate(shippingList[shIdx]);
      shippingList[shIdx] = updatedItem;
    }

    if (!updatedItem) {
      this.setData({ showCompleteDialog: false });
      const persistId = inputId || '';
      const persistNo = inputNo || '';
      const payloadComplete = { id: persistId, orderNo: persistNo, orderNumber: persistNo, status: 'processing', producedQty: qty, printFinishAt: new Date() };
      if (!payloadComplete.id) delete payloadComplete.id;
      updateData('orders', payloadComplete).catch(() => { });
      wx.showToast({ title: '已登记', icon: 'success' });
      return;
    }

    const statistics = {
      total: workOrderList.length,
      pending: workOrderList.filter(i => i.status === 'pending').length,
      processing: workOrderList.filter(i => i.status === 'processing').length,
      completed: workOrderList.filter(i => i.status === 'completed').length
    };
    this.setData({ workOrderList, warehouseList, shippingList, statistics, showCompleteDialog: false });
    this.updateDerivedStats();
    this.updateDisplayList();
    const persistId = inputId || updatedItem.id || updatedItem.docId || updatedItem._id || '';
    const persistNo = inputNo || updatedItem.orderNo || updatedItem.orderNumber || '';
    const payloadComplete = { id: persistId, orderNo: persistNo, orderNumber: persistNo, status: updatedItem.status || 'processing', producedQty: qty, printFinishAt: new Date() };
    if (!payloadComplete.id) delete payloadComplete.id;
    updateData('orders', payloadComplete).catch(() => { });
    try {
      const pages = getCurrentPages();
      const detailPage = pages.find(p => p && p.route && /pages\/production\/detail\/detail$/.test(p.route));
      if (detailPage && typeof detailPage.refreshOrderStateFromLocal === 'function') {
        detailPage.refreshOrderStateFromLocal(updatedItem);
      } else if (detailPage && typeof detailPage.refreshOrderState === 'function') {
        detailPage.refreshOrderState();
      }
    } catch (_) { }
    wx.showToast({ title: '已登记', icon: 'success' });
  },

  onStockQtyInput: function (e) {
    const val = e.detail && e.detail.value ? e.detail.value : '';
    this.setData({ stockDialog: Object.assign({}, this.data.stockDialog, { inputQty: val }) });
  },
  cancelStock: function () { this.setData({ showStockDialog: false }); },
  confirmStockIn: function () {
    const d = this.data.stockDialog || {};
    const qty = Math.max(0, parseInt(d.inputQty || '0', 10));
    if (!qty) { wx.showToast({ title: '请输入入库数量', icon: 'none' }); return; }
    let list = (this.data.workOrderList || []).slice();
    const idx = list.findIndex(i => i.orderNo === d.orderNo);
    let warehouseList = (this.data.warehouseList || []).slice();
    const whIdx = warehouseList.findIndex(i => i.orderNo === d.orderNo);
    let firstStock = false;
    const nowAt = new Date();
    if (idx !== -1) {
      const item = list[idx];
      const newStockedQty = qty;
      const stockedItem = Object.assign({}, item, { status: 'stocked', progress: 75, stockedQty: newStockedQty, stockedAt: nowAt });
      list[idx] = stockedItem;
      // 可选：移入入库列表
      warehouseList = whIdx === -1 ? warehouseList.concat([stockedItem]) : warehouseList;
      firstStock = true;
    } else if (whIdx !== -1) {
      const existing = warehouseList[whIdx];
      const newStockedQty = qty;
      warehouseList[whIdx] = Object.assign({}, existing, { stockedQty: newStockedQty, progress: 75, status: 'stocked', stockedAt: nowAt });
    }
    const statistics = {
      total: list.length,
      pending: list.filter(i => i.status === 'pending').length,
      processing: list.filter(i => i.status === 'processing').length,
      completed: list.filter(i => i.status === 'completed').length
    };
    const warehouseCount = (this.data.warehouseCount || 0) + (firstStock ? 1 : 0);
    this.setData({ workOrderList: list, warehouseList, statistics, warehouseCount, showStockDialog: false });
    this.updateDerivedStats();
    this.updateDisplayList();
    const persistedStockQty = (idx !== -1 ? list[idx].stockedQty : (whIdx !== -1 ? warehouseList[whIdx].stockedQty : qty)) || qty;
    const persistId2 = d.id || (idx !== -1 ? list[idx].id || list[idx].docId : (whIdx !== -1 ? warehouseList[whIdx].id || warehouseList[whIdx].docId : '')) || '';
    const persistNo2 = d.orderNo || (idx !== -1 ? list[idx].orderNo : (whIdx !== -1 ? warehouseList[whIdx].orderNo : '')) || '';
    const payloadStock = { id: persistId2, orderNo: persistNo2, orderNumber: persistNo2, status: 'stocked', stockedQty: persistedStockQty, stockedAt: nowAt };
    if (!payloadStock.id) delete payloadStock.id;
    updateData('orders', payloadStock).catch(() => { });
    try {
      const pages = getCurrentPages();
      const detailPage = pages.find(p => p && p.route && /pages\/production\/detail\/detail$/.test(p.route));
      const localItem = (idx !== -1 ? list[idx] : (whIdx !== -1 ? warehouseList[whIdx] : null));
      if (detailPage && typeof detailPage.refreshOrderStateFromLocal === 'function' && localItem) {
        detailPage.refreshOrderStateFromLocal(localItem);
      } else if (detailPage && typeof detailPage.refreshOrderState === 'function') {
        detailPage.refreshOrderState();
      }
    } catch (_) { }
    wx.showToast({ title: '已入库', icon: 'success' });
  },

  onShipQtyInput: function (e) {
    const raw = e.detail && typeof e.detail.value !== 'undefined' ? String(e.detail.value) : '';
    const cleaned = raw.replace(/[^\d]/g, '');
    const d = this.data.shipmentDialog || {};
    if (d.inputDisabled) return;
    const max = Number(d.remainingQty || d.stockedQty || 0) || 0;
    if (!cleaned) {
      this.setData({ shipmentDialog: Object.assign({}, d, { inputQty: '' }) });
      return;
    }
    let num = parseInt(cleaned, 10);
    if (!Number.isFinite(num) || num < 0) {
      num = 0;
    }
    if (max && num > max) {
      num = max;
      wx.showToast({ title: '发货数不能大于入库数', icon: 'none' });
    }
    const val = num ? String(num) : '';
    this.setData({ shipmentDialog: Object.assign({}, d, { inputQty: val }) });
  },
  cancelShipment: function () { this.setData({ showShipmentDialog: false }); },
  confirmShipment: function () {
    const d = this.data.shipmentDialog || {};
    const qty = Math.max(0, parseInt(d.inputQty || '0', 10));
    if (!qty) { wx.showToast({ title: '请输入发货数量', icon: 'none' }); return; }
    const max = Number(d.remainingQty || d.stockedQty || 0) || 0;
    if (!d.overwriteMode && max && qty > max) {
      wx.showToast({ title: '发货数不能大于入库数', icon: 'none' });
      return;
    }
    const all = (this.data.workOrderList || []).concat(this.data.warehouseList || []);
    const item = all.find(i => i.orderNo === d.orderNo);
    const shipItem = item || (this.data.shippingList || []).find(i => i.orderNo === d.orderNo) || (this.data.displayOrderList || []).find(i => i.orderNo === d.orderNo) || null;
    if (!shipItem) { wx.showToast({ title: '工单不存在', icon: 'error' }); return; }
    const startTsRaw = shipItem.startAt || shipItem.printStartAt || shipItem.startedAt || (shipItem.startTime ? Date.parse(shipItem.startTime) : null) || shipItem.createAt || Date.now();
    const startTs = (typeof startTsRaw === 'number' && !isNaN(startTsRaw)) ? startTsRaw : Date.now();
    const shipTs = Date.now();
    const days = Math.max(0, (shipTs - startTs) / 86400000);
    const days1dp = Math.round(days * 10) / 10;
    const shipmentDurationsDays = (this.data.shipmentDurationsDays || []).concat([days1dp]);
    const newShip = { qty, time: new Date() };
    let list = (this.data.workOrderList || []).slice();
    let warehouseList = (this.data.warehouseList || []).slice();
    let shippingList = (this.data.shippingList || []).slice();
    const wIdx = warehouseList.findIndex(i => i.orderNo === d.orderNo);
    if (wIdx !== -1) {
      const prev = Number(warehouseList[wIdx].shippedQty || 0);
      const prevShipments = Array.isArray(warehouseList[wIdx].shipments) ? warehouseList[wIdx].shipments : [];
      const nextShippedQty = d.overwriteMode ? qty : (prev + qty);
      const nextShipments = d.overwriteMode ? [newShip] : prevShipments.concat([newShip]);
      warehouseList[wIdx] = Object.assign({}, warehouseList[wIdx], { shippedQty: nextShippedQty, status: 'shipped', progress: 100, shippedAt: new Date(), shipments: nextShipments });
    }
    const lIdx = list.findIndex(i => i.orderNo === d.orderNo);
    if (lIdx !== -1) {
      const prev = Number(list[lIdx].shippedQty || 0);
      const prevShipments2 = Array.isArray(list[lIdx].shipments) ? list[lIdx].shipments : [];
      const nextShippedQty = d.overwriteMode ? qty : (prev + qty);
      const nextShipments = d.overwriteMode ? [newShip] : prevShipments2.concat([newShip]);
      list[lIdx] = Object.assign({}, list[lIdx], { shippedQty: nextShippedQty, status: 'shipped', progress: 100, shippedAt: new Date(), shipments: nextShipments });
    }
    const sIdx = shippingList.findIndex(i => i.orderNo === d.orderNo);
    const baseItem = shipItem || (lIdx !== -1 ? list[lIdx] : (wIdx !== -1 ? warehouseList[wIdx] : null));
    const prevBaseQty = Number(baseItem && baseItem.shippedQty || 0);
    const nextBaseQty = d.overwriteMode ? qty : (prevBaseQty + qty);
    const prevBaseShipments = Array.isArray(baseItem && baseItem.shipments) ? baseItem.shipments : [];
    const nextBaseShipments = d.overwriteMode ? [newShip] : prevBaseShipments.concat([newShip]);
    const shipEntry = Object.assign({}, baseItem, { shippedQty: nextBaseQty, status: 'shipped', progress: 100, shippedAt: new Date(), shipments: nextBaseShipments });
    if (sIdx === -1) shippingList.push(shipEntry); else shippingList[sIdx] = shipEntry;
    const statistics = {
      total: list.length,
      pending: list.filter(i => i.status === 'pending').length,
      processing: list.filter(i => i.status === 'processing').length,
      completed: list.filter(i => i.status === 'completed').length
    };
    this.setData({ workOrderList: list, warehouseList, shippingList, shipmentDurationsDays, statistics, showShipmentDialog: false, filterStatus: 'shipping' });
    this.updateDerivedStats();
    this.updateDisplayList();
    const persistedShippedQty = Number((list.find(i => i.orderNo === d.orderNo) || {}).shippedQty || (warehouseList.find(i => i.orderNo === d.orderNo) || {}).shippedQty || shipEntry.shippedQty || qty);
    const persistId3 = shipItem.id || shipItem.docId || shipItem._id || d.id || '';
    const persistNo3 = d.orderNo || shipItem.orderNo || shipItem.orderNumber || '';
    const tryPersistShip = () => {
      try {
        getData('orders', false)
          .then(orders => {
            const arr = Array.isArray(orders) ? orders : [];
            const childInfo = parseChildOrderNo(persistNo3);
            const origin = arr.find(o => (String(o?._id || o?.id || '') === String(persistId3 || '')) || (o.orderNo === (childInfo ? childInfo.parentNo : persistNo3)) || (o.orderNumber === (childInfo ? childInfo.parentNo : persistNo3))) || {};
            if (childInfo && origin && typeof origin === 'object' && Array.isArray(origin.items) && origin.items.length > 1) {
              const idx = childInfo.idx;
              if (!(Number.isFinite(idx) && idx >= 0 && idx < origin.items.length)) return;
              const prevItem = origin.items[idx] && typeof origin.items[idx] === 'object' ? origin.items[idx] : {};
              const prevItemQty = toNum(prevItem.shippedQty ?? prevItem.deliveredQty ?? 0);
              const prevItemShipments = Array.isArray(prevItem.shipments) ? prevItem.shipments : [];
              const nextItemQty = d.overwriteMode ? qty : (prevItemQty + qty);
              const nextItemShipments = d.overwriteMode ? [newShip] : prevItemShipments.concat([newShip]);
              const nextItems = origin.items.slice();
              nextItems[idx] = Object.assign({}, prevItem, { shippedQty: nextItemQty, shippedAt: new Date().toISOString(), shipments: nextItemShipments });
              const allShipped = nextItems.every((it) => {
                const item = it && typeof it === 'object' ? it : {};
                const itemQty = toNum(item.quantity ?? item.orderQty ?? item.orderQuantity ?? item.qty);
                const shipped = toNum(item.shippedQty ?? item.deliveredQty ?? 0);
                return itemQty > 0 ? shipped >= itemQty : shipped > 0;
              });
              const payloadShip = { id: origin._id || origin.id || persistId3, items: nextItems };
              if (allShipped) {
                payloadShip.status = 'shipped';
              }
              updateData('orders', payloadShip).catch(() => { });
              return;
            }

            const prevShipments3 = Array.isArray(origin.shipments) ? origin.shipments : [];
            const nextShipments3 = d.overwriteMode ? [newShip] : prevShipments3.concat([newShip]);
            const payloadShip = { id: persistId3, orderNo: persistNo3, orderNumber: persistNo3, status: 'shipped', shippedQty: persistedShippedQty, shippedAt: new Date(), shipments: nextShipments3 };
            if (!payloadShip.id) delete payloadShip.id;
            updateData('orders', payloadShip).catch(() => { });
          })
          .catch(() => {
            const payloadShip = { id: persistId3, orderNo: persistNo3, orderNumber: persistNo3, status: 'shipped', shippedQty: persistedShippedQty, shippedAt: new Date(), shipments: [newShip] };
            if (!payloadShip.id) delete payloadShip.id;
            updateData('orders', payloadShip).catch(() => { });
          });
      } catch (_) {
        const payloadShip = { id: persistId3, orderNo: persistNo3, orderNumber: persistNo3, status: 'shipped', shippedQty: persistedShippedQty, shippedAt: new Date(), shipments: [newShip] };
        if (!payloadShip.id) delete payloadShip.id;
        updateData('orders', payloadShip).catch(() => { });
      }
    };
    tryPersistShip();
    try { clearCache('getOrders'); } catch (_) { }
    try { wx.setStorageSync('orders_force_refresh', Date.now()); } catch (_) { }
    try {
      const pages = getCurrentPages();
      const detailPage = pages.find(p => p && p.route && /pages\/production\/detail\/detail$/.test(p.route));
      const localItem = (lIdx !== -1 ? list[lIdx] : (wIdx !== -1 ? warehouseList[wIdx] : shipEntry));
      if (detailPage && typeof detailPage.refreshOrderStateFromLocal === 'function' && localItem) {
        detailPage.refreshOrderStateFromLocal(localItem);
      } else if (detailPage && typeof detailPage.refreshOrderState === 'function') {
        detailPage.refreshOrderState();
      }
    } catch (_) { }
    wx.showToast({ title: '已发货', icon: 'success' });
  },


  onPageScroll: function (e) {
    const top = (e && typeof e.scrollTop === 'number') ? e.scrollTop : 0;
    const th = this.data.navStickyThreshold || 0;
    const reachTop = top >= Math.max(0, th - 4);
    if (reachTop && !this.data.navStickyEngaged) {
      this.setData({ navStickyEngaged: true });
    }
    const fixed = this.data.navStickyEngaged ? true : reachTop;
    if (fixed !== this.data.isNavFixed) {
      this.setData({ isNavFixed: fixed });
    }
  },

  // 返回
  goBack: function () {
    wx.navigateBack();
  }
});
