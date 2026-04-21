const { getData, updateData } = require('../../../utils/data-sync-utils.js');

const formatTime = (value) => {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  const Y = d.getFullYear();
  const M = String(d.getMonth() + 1).padStart(2, '0');
  const D = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${Y}-${M}-${D} ${h}:${m}`;
};

Page({
  data: {
    loading: false,
    loadError: '',
    orderId: '',
    orderStatusKey: 'unknown',
    orderInfo: {
      orderNo: '',
      customerName: '',
      productName: '',
      spec: '',
      goodsName: '',
      materialNo: '',
      materialCode: '',
      flute: '',
      paperSize: '',
      creaseText: '',
      joinMethod: '',
      totalQty: 0,
      producedQty: 0,
      status: '',
      createTime: '',
      notes: ''
    },
    stockedQty: 0,
    shippedQty: 0,
    processList: [],
    progressPercent: 0,
    segments: [0, 0, 0, 0],
    drawingUrl: '',
    drawingDocUrl: '',
    attachments: [],
    qcInfo: { history: [] },
    showStartBtn: false,
    showShipBtn: false,
    showPrintBtn: false,
    showShipmentDialog: false,
    shipmentDialog: { orderNo: '', customer: '', spec: '', productName: '', materialNo: '', inventoryQty: 0, remainingQty: 0, inputQty: '' },
    remainingQty: 0
  },

  onLoad: function(options) {
    const optOrderId = options && (options.orderId || options.id) ? decodeURIComponent(options.orderId || options.id) : '';
    const optOrderNo = options && (options.orderNo || options.no) ? decodeURIComponent(options.orderNo || options.no) : '';
    const from = options && options.from ? String(options.from) : '';
    this.setData({ showStartBtn: from === 'startScan', showShipBtn: true, showPrintBtn: from === 'scan' });

    const tryLoad = (orderId, orderNo) => {
      this.loadByRoute(orderId || '', orderNo || '');
    };

    try {
      const ec = this.getOpenerEventChannel && this.getOpenerEventChannel();
      if (ec && typeof ec.on === 'function') {
        ec.on('orderRoute', (data) => {
          const d = data || {};
          tryLoad(d.orderId || optOrderId, d.orderNo || optOrderNo);
        });
      }
    } catch (_) {}

    tryLoad(optOrderId, optOrderNo);
  },

  onShow: function() {
    this.refreshOrderState();
  },

  onPullDownRefresh: function() {
    Promise.resolve(this.refreshOrderState())
      .finally(() => {
        try {
          wx.stopPullDownRefresh();
        } catch (_) {}
      });
  },

  mapStatus: function(status) {
    const s = String(status || '').toLowerCase();
    const map = {
      ordered: '已下单',
      pending: '待生产',
      processing: '生产中',
      in_production: '生产中',
      stocked: '已入库',
      shipping: '已发货',
      shipped: '已发货',
      delivered: '已发货',
      completed: '已完成'
    };
    return map[s] || (status ? String(status) : '');
  },

  computeSegments: function(progressPercent) {
    const p = Math.max(0, Math.min(100, Number(progressPercent) || 0));
    const fill = (i) => {
      const start = i * 25;
      const v = Math.max(0, Math.min(25, p - start));
      return Math.round((v / 25) * 100);
    };
    return [fill(0), fill(1), fill(2), fill(3)];
  },

  loadByRoute: function(orderId, orderNo) {
    if (orderId) this.setData({ orderId });
    this._orderNoParam = orderNo || this._orderNoParam || '';

    this.setData({ loading: true, loadError: '' });

    return this.fetchOrder(orderId, this._orderNoParam)
      .then((order) => {
        if (!order) {
          this.setData({ loadError: '未找到订单数据' });
          return null;
        }
        this.applyOrder(order);
        return order;
      })
      .catch(() => {
        this.setData({ loadError: '加载失败，请下拉刷新重试' });
        return null;
      })
      .finally(() => {
        this.setData({ loading: false });
      });
  },

  fetchOrder: function(orderId, orderNo) {
    return getData('orders', false)
      .then((orders) => {
        const list = Array.isArray(orders) ? orders : [];
        let order = null;
        if (orderId) order = list.find((o) => o && (o._id === orderId || o.id === orderId)) || null;
        if (!order && orderNo) order = list.find((o) => o && (o.orderNo === orderNo || o.orderNumber === orderNo)) || null;
        if (order) return order;

        if (!orderId && !orderNo) return null;
        return wx.cloud
          .callFunction({
            name: 'erp-api',
            data: { action: 'getOrderDetail', params: orderId ? { id: orderId } : { orderNo } }
          })
          .then((res) => (res && res.result && res.result.data ? res.result.data : null))
          .catch(() => null);
      })
      .catch(() => null);
  },

  applyOrder: function(order) {
    this._orderRaw = order;
    const id = order._id || order.id || this.data.orderId || '';
    const rawStatus = String(order.status || '').toLowerCase();
    const statusKey = (() => {
      const allow = ['ordered', 'pending', 'processing', 'in_production', 'stocked', 'shipping', 'shipped', 'delivered', 'completed'];
      return allow.includes(rawStatus) ? rawStatus : 'unknown';
    })();
    const statusText = this.mapStatus(rawStatus);
    const totalQty = Number(order.quantity || order.totalQty || 0);
    const producedQty = Number(order.producedQty || 0);
    const stockedQty = Number(order.stockedQty || 0);
    const shippedQty = Number(order.shippedQty || order.deliveredQty || 0);
    const remainingQty = Math.max(0, stockedQty - shippedQty);

    const printStartTime = formatTime(order.printStartAt || order.startedAt || order.startTime);
    const printFinishTime = formatTime(order.printFinishAt || order.printedAt || order.completedAt);
    const stockTime = formatTime(order.stockedAt || order.stockTime || (String(order.status || '').toLowerCase() === 'stocked' ? (order.updatedAt || order.updateTime) : ''));
    const deliveryTime = formatTime(order.deliveredAt || order.shippedAt || (['shipped', 'delivered'].includes(String(order.status || '').toLowerCase()) ? (order.updatedAt || order.updateTime) : ''));

    let progress = 0;
    if (printStartTime) progress = 25;
    if (printFinishTime || producedQty > 0) progress = Math.max(progress, 50);
    if (stockTime || stockedQty > 0) progress = Math.max(progress, 75);
    if (deliveryTime || shippedQty > 0) progress = 100;

    const shipmentsRaw = Array.isArray(order.shipments) ? order.shipments : (Array.isArray(order.deliveryLogs) ? order.deliveryLogs : []);
    const shipments = shipmentsRaw
      .map((it) => ({ qty: Number(it && (it.qty || it.quantity || it.count) || 0), time: formatTime(it && (it.time || it.at || it.date || it.createdAt || it.ts) || '') }))
      .filter((s) => s.qty || s.time);

    const orderNo = order.orderNo || order.orderNumber || '';
    const createTime = formatTime(order.createdAt || order.createTime || order.created_at || '');
    const customerName = order.customerName || (order.customer && order.customer.name) || '';
    const productName = order.productName || (order.product && order.product.name) || '';
    const spec = order.spec || (order.items && order.items[0] && order.items[0].spec) || '';
    const goodsName = order.goodsName || order.productTitle || (order.items && order.items[0] && (order.items[0].title || order.items[0].goodsName || order.items[0].productName)) || '';
    const materialNo = order.materialNo || (order.items && order.items[0] && order.items[0].materialNo) || '';
    const materialCode =
      order.materialCode ||
      (order.items && order.items[0] && (order.items[0].materialCode || order.items[0].material_code)) ||
      materialNo ||
      '';
    const flute = order.flute || order.fluteType || '';
    const bw = order.boardWidth || (order.items && order.items[0] && order.items[0].boardWidth) || order.paperWidth || order.boardW || '';
    const bh = order.boardHeight || (order.items && order.items[0] && order.items[0].boardHeight) || order.paperLength || order.boardH || '';
    const paperSizeText = order.paperSize || ((bw || bh) ? `${bw}×${bh}` : '');
    const normalizePaperSize = (v) => {
      const s = String(v || '').trim();
      if (!s) return '';
      if (/mm$/i.test(s)) return s;
      if (/^\d+(\.\d+)?[x×]\d+(\.\d+)?$/i.test(s)) return `${s.replace(/x/i, '×')}mm`;
      return s;
    };
    const paperSizeDisplay = normalizePaperSize(paperSizeText) || '-';
    const materialFluteDisplay = (() => {
      const a = String(materialCode || '').trim();
      const b = String(flute || '').trim();
      if (!a && !b) return '-';
      return `${a || '-'} / ${b || '-'}`;
    })();
    const c1 = Number(order.creasingSize1 || 0);
    const c2 = Number(order.creasingSize2 || 0);
    const c3 = Number(order.creasingSize3 || 0);
    const creaseText = (c1 || c2 || c3) ? `${c1}-${c2}-${c3}` : (order.creasingType || '');
    const joinMethod = order.joinMethod || order.bondingMethod || order.joiningMethod || '';
    const notes = order.notes || order.remark || '';

    const processList = [
      { name: '开始生产', status: printStartTime ? '已完成' : '待处理', time: printStartTime, showTime: !!printStartTime, showQty: false },
      { name: '印刷完成', status: producedQty > 0 ? '已完成' : '待处理', time: printFinishTime, qty: producedQty, qtyLabel: '印刷完成数量', showTime: !!printFinishTime, showQty: true },
      { name: '入库', status: stockedQty > 0 ? '已完成' : '待处理', time: stockTime, qty: stockedQty, qtyLabel: '入库数量', showTime: !!stockTime, showQty: true },
      { name: '发货', status: (shippedQty > 0 || shipments.length) ? '已完成' : '待处理', time: deliveryTime, qty: shippedQty, qtyLabel: '出货数量', showTime: !!deliveryTime, showQty: true, shipments }
    ];

    const getUrl = (att) => {
      if (!att) return '';
      if (typeof att === 'string') return att;
      if (typeof att === 'object') return att.tempFileURL || att.fileID || att.fileId || att.url || att.path || '';
      return '';
    };
    const isPdf = (u) => String(u || '').toLowerCase().endsWith('.pdf');
    const isImage = (u) => {
      const s = String(u || '').toLowerCase();
      return ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].some((ext) => s.endsWith(ext));
    };

    const attachmentsRaw = []
      .concat(order.printDrawing ? [order.printDrawing] : [])
      .concat(Array.isArray(order.attachments) ? order.attachments : [])
      .concat(Array.isArray(order.files) ? order.files : []);

    const attachments = attachmentsRaw
      .map((a, idx) => {
        const url = getUrl(a);
        if (!url) return null;
        const name =
          (a && typeof a === 'object' && (a.name || a.fileName || a.filename)) ||
          (isPdf(url) ? '图纸(PDF)' : (isImage(url) ? '图纸' : '附件')) + (idx ? `-${idx + 1}` : '');
        const kind = isPdf(url) ? 'doc' : (isImage(url) ? 'image' : 'file');
        const kindText = kind === 'image' ? '图片' : (kind === 'doc' ? '文档' : '文件');
        return { name, url, kind, kindText };
      })
      .filter(Boolean);

    const firstImage = attachments.find((a) => a.kind === 'image') || null;
    const firstDoc = attachments.find((a) => a.kind === 'doc') || null;
    const drawingUrl = firstImage ? firstImage.url : '';
    const drawingDocUrl = !drawingUrl && firstDoc ? firstDoc.url : (firstDoc ? firstDoc.url : '');

    this.setData({
      orderId: id,
      orderStatusKey: statusKey,
      orderInfo: {
        orderNo,
        customerName,
        productName,
        spec,
        goodsName,
        materialNo,
        materialCode,
        flute,
        paperSize: paperSizeText,
        paperSizeDisplay,
        materialFluteDisplay,
        creaseText,
        joinMethod,
        totalQty,
        producedQty,
        status: statusText,
        createTime,
        notes
      },
      stockedQty,
      shippedQty,
      remainingQty,
      processList,
      progressPercent: progress,
      segments: this.computeSegments(progress),
      drawingUrl,
      drawingDocUrl,
      attachments,
      qcInfo: { history: printFinishTime ? [{ time: printFinishTime }] : [] }
    });

    const needResolve = (u) => typeof u === 'string' && /^cloud:\/\//.test(u);
    const files = [];
    if (needResolve(drawingUrl)) files.push(drawingUrl);
    if (needResolve(drawingDocUrl)) files.push(drawingDocUrl);
    (attachments || []).forEach((a) => {
      if (a && a.url && needResolve(a.url)) files.push(a.url);
    });
    if (files.length) {
      try {
        const uniq = Array.from(new Set(files));
        wx.cloud.getTempFileURL({ fileList: uniq.map((fileID) => ({ fileID, maxAge: 3600 })) }).then((r) => {
          const list = (r && r.fileList) ? r.fileList : [];
          const map = {};
          list.forEach((it) => {
            if (it && it.fileID) map[it.fileID] = it.tempFileURL || '';
          });
          list.forEach((it) => {
            if (it.fileID === drawingUrl) this.setData({ drawingUrl: it.tempFileURL || '' });
            if (it.fileID === drawingDocUrl) this.setData({ drawingDocUrl: it.tempFileURL || '' });
          });
          const nextAttachments = (this.data.attachments || []).map((a) => {
            if (!a || !a.url) return a;
            const temp = map[a.url];
            return temp ? Object.assign({}, a, { url: temp }) : a;
          });
          this.setData({ attachments: nextAttachments });
        }).catch(() => {});
      } catch (_) {}
    }
  },

  refreshOrderState: function() {
    const id = this.data.orderId || '';
    const no = this._orderNoParam || (this.data.orderInfo && this.data.orderInfo.orderNo) || '';
    return this.loadByRoute(id, no);
  },

  refreshOrderStateFromLocal: function(order) {
    if (!order) return;
    const normalized = Object.assign({}, order, {
      orderNo: order.orderNo || order.orderNumber || (this.data.orderInfo && this.data.orderInfo.orderNo) || ''
    });
    this.applyOrder(normalized);
  },

  onCopyOrderNo: function() {
    const no = this.data.orderInfo && this.data.orderInfo.orderNo ? String(this.data.orderInfo.orderNo) : '';
    if (!no) return;
    wx.setClipboardData({ data: no });
  },

  previewImage: function() {
    const u = this.data.drawingUrl;
    if (!u) return;
    wx.previewImage({ urls: [u] });
  },

  previewDocument: function() {
    const url = this.data.drawingDocUrl;
    if (!url) return;
    wx.showLoading({ title: '打开中...' });
    wx.downloadFile({
      url,
      success: (res) => {
        const filePath = res && res.tempFilePath ? res.tempFilePath : '';
        if (!filePath) {
          wx.hideLoading();
          wx.showToast({ title: '打开失败', icon: 'none' });
          return;
        }
        wx.openDocument({
          filePath,
          success: () => wx.hideLoading(),
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '打开失败', icon: 'none' });
          }
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '下载失败', icon: 'none' });
      }
    });
  },

  onOpenAttachment: function(e) {
    const idx = e && e.currentTarget && e.currentTarget.dataset ? Number(e.currentTarget.dataset.index) : -1;
    const list = this.data.attachments || [];
    const it = idx >= 0 ? list[idx] : null;
    if (!it || !it.url) return;
    if (it.kind === 'image') {
      const urls = list.filter((a) => a && a.kind === 'image' && a.url).map((a) => a.url);
      wx.previewImage({ current: it.url, urls: urls.length ? urls : [it.url] });
      return;
    }
    wx.showLoading({ title: '打开中...' });
    wx.downloadFile({
      url: it.url,
      success: (res) => {
        const filePath = res && res.tempFilePath ? res.tempFilePath : '';
        if (!filePath) {
          wx.hideLoading();
          wx.showToast({ title: '打开失败', icon: 'none' });
          return;
        }
        wx.openDocument({
          filePath,
          showMenu: true,
          success: () => wx.hideLoading(),
          fail: () => {
            wx.hideLoading();
            wx.showToast({ title: '打开失败', icon: 'none' });
          }
        });
      },
      fail: () => {
        wx.hideLoading();
        wx.showToast({ title: '下载失败', icon: 'none' });
      }
    });
  },

  onBack: function() {
    wx.navigateBack();
  },

  onPrintWorkorder: function() {
    const raw = this._orderRaw || {};
    const info = this.data.orderInfo || {};
    const orderNo = info.orderNo || raw.orderNo || raw.orderNumber || '';
    if (!orderNo) {
      wx.showToast({ title: '订单信息缺失', icon: 'none' });
      return;
    }

    const merged = Object.assign({}, raw, {
      orderNo,
      customerName: info.customerName || raw.customerName || '',
      productName: info.productName || raw.productName || '',
      spec: info.spec || raw.spec || '',
      goodsName: info.goodsName || raw.goodsName || raw.productTitle || '',
      materialNo: info.materialNo || raw.materialNo || '',
      materialCode: info.materialCode || raw.materialCode || '',
      flute: info.flute || raw.flute || raw.fluteType || '',
      joinMethod: info.joinMethod || raw.joinMethod || raw.bondingMethod || '',
      notes: info.notes || raw.notes || raw.remark || '',
      quantity: Number(raw.quantity || raw.totalQty || info.totalQty || 0)
    });

    const sizeSource = String(merged.paperSize || raw.paperSize || info.paperSize || '').replace(/mm$/i, '');
    const sizeMatch = sizeSource.match(/(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/);
    if (sizeMatch) {
      if (!merged.boardWidth) merged.boardWidth = Number(sizeMatch[1]);
      if (!merged.boardHeight) merged.boardHeight = Number(sizeMatch[2]);
    }

    const creaseSource = String(raw.creaseText || raw.creasingText || info.creaseText || '').trim();
    const creaseMatch = creaseSource.match(/^\s*(\d+)\s*-\s*(\d+)\s*-\s*(\d+)\s*$/);
    if (creaseMatch) {
      if (!merged.creasingSize1) merged.creasingSize1 = Number(creaseMatch[1]);
      if (!merged.creasingSize2) merged.creasingSize2 = Number(creaseMatch[2]);
      if (!merged.creasingSize3) merged.creasingSize3 = Number(creaseMatch[3]);
    } else if (creaseSource && !merged.creasingType) {
      merged.creasingType = creaseSource;
    }

    const key = `print_orders_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      wx.setStorageSync(key, [merged]);
    } catch (_) {
      wx.showToast({ title: '缓存失败，无法打印', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/production-sub/workorder-print/workorder-print?key=${encodeURIComponent(key)}` });
  },

  onStartProduction: function() {
    const id = this.data.orderId || '';
    const orderNo = this.data.orderInfo && this.data.orderInfo.orderNo;
    if (!id && !orderNo) {
      wx.showToast({ title: '订单信息缺失', icon: 'none' });
      return;
    }
    wx.showLoading({ title: '处理中...' });
    const payload = { id, orderNo, orderNumber: orderNo, status: 'processing', printStartAt: new Date() };
    if (!payload.id) delete payload.id;
    updateData('orders', payload)
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已开始生产', icon: 'success' });
        this.refreshOrderState();
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '操作失败', icon: 'none' });
      });
  },

  openShipmentDialog: function() {
    const info = this.data.orderInfo || {};
    const stockedQty = Number(this.data.stockedQty || 0);
    const shippedQty = Number(this.data.shippedQty || 0);
    const remainingQty = Math.max(0, stockedQty - shippedQty);
    this.setData({
      showShipmentDialog: true,
      shipmentDialog: {
        orderNo: info.orderNo || '',
        customer: info.customerName || '',
        spec: info.spec || '',
        productName: info.goodsName || info.productName || '',
        materialNo: info.materialNo || '',
        inventoryQty: remainingQty,
        remainingQty,
        inputQty: ''
      }
    });
  },

  onShipQtyInput: function(e) {
    const v = e && e.detail ? String(e.detail.value || '') : '';
    this.setData({ 'shipmentDialog.inputQty': v });
  },

  cancelShipment: function() {
    this.setData({ showShipmentDialog: false });
  },

  confirmShipment: function() {
    const dialog = this.data.shipmentDialog || {};
    const qty = Number(dialog.inputQty || 0);
    const remaining = Number(dialog.remainingQty || 0);
    if (!qty || qty <= 0) {
      wx.showToast({ title: '请输入发货数量', icon: 'none' });
      return;
    }
    if (qty > remaining) {
      wx.showToast({ title: '发货数量超出库存', icon: 'none' });
      return;
    }

    const id = this.data.orderId || '';
    const orderNo = dialog.orderNo || (this.data.orderInfo && this.data.orderInfo.orderNo) || '';
    wx.showLoading({ title: '发货中...' });
    const newShip = { qty, time: new Date() };

    const persist = () =>
      getData('orders', false)
        .then((orders) => {
          const arr = Array.isArray(orders) ? orders : [];
          const origin = arr.find((o) => o && (o._id === id || o.id === id || o.orderNo === orderNo || o.orderNumber === orderNo)) || {};
          const prevShipments = Array.isArray(origin.shipments) ? origin.shipments : [];
          const prev = Number(origin.shippedQty || origin.deliveredQty || 0);
          const nextQty = prev + qty;
          const payloadShip = { id, orderNo, orderNumber: orderNo, status: 'shipped', shippedQty: nextQty, shippedAt: new Date(), shipments: prevShipments.concat([newShip]) };
          if (!payloadShip.id) delete payloadShip.id;
          return updateData('orders', payloadShip);
        })
        .catch(() => {
          const payloadShip = { id, orderNo, orderNumber: orderNo, status: 'shipped', shippedQty: qty, shippedAt: new Date(), shipments: [newShip] };
          if (!payloadShip.id) delete payloadShip.id;
          return updateData('orders', payloadShip);
        });

    persist()
      .then(() => {
        wx.hideLoading();
        wx.showToast({ title: '已发货', icon: 'success' });
        this.setData({ showShipmentDialog: false });
        this.refreshOrderState();
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '发货失败', icon: 'none' });
      });
  }
});
