const { getData, updateData } = require('../../../utils/data-sync-utils.js');

const normalizePaperSize = (value) => {
  const s = String(value || '').trim();
  if (!s) return '';
  if (/mm$/i.test(s)) return s;
  if (/^\d+(\.\d+)?[x×]\d+(\.\d+)?$/i.test(s)) return `${s.replace(/x/i, '×')}mm`;
  return s;
};

const buildMaterialFluteDisplay = (materialCode, flute) => {
  const a = String(materialCode || '').trim();
  const b = String(flute || '').trim();
  if (a && b) return `${a}/${b}`;
  if (a) return a;
  if (b) return b;
  return '-';
};

const formatTime = (d) => {
  if (!d) return '';
  const date = typeof d === 'string' || typeof d === 'number' ? new Date(d) : d;
  if (isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hour = String(date.getHours()).padStart(2, '0');
  const minute = String(date.getMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hour}:${minute}`;
};

const normalizeOrderToken = (value) => {
  const s = String(value || '').trim();
  if (!s) return '';
  const decoded = decodeURIComponent(s);
  const head = decoded.includes(':') ? decoded.split(':')[0] : decoded;
  return String(head || '').trim();
};

const parseChildOrderNo = (orderNo) => {
  const no = String(orderNo || '').trim();
  const m = no.match(/^(.*)-(\d+)$/);
  if (!m) return null;
  const parentNo = String(m[1] || '').trim();
  const idx = Number(m[2] || 0) - 1;
  if (!parentNo || !(Number.isFinite(idx) && idx >= 0)) return null;
  return { parentNo, idx, childNo: no };
};

const buildChildFromParentOrder = (parentOrder, childNo) => {
  const meta = parseChildOrderNo(childNo);
  if (!meta) return null;
  const parent = parentOrder && typeof parentOrder === 'object' ? parentOrder : null;
  if (!parent) return null;
  const items = Array.isArray(parent.items) ? parent.items : [];
  if (!(meta.idx >= 0 && meta.idx < items.length)) return null;
  const it = items[meta.idx] && typeof items[meta.idx] === 'object' ? items[meta.idx] : {};
  const pid = parent._id || parent.id || '';
  const qty = it.quantity ?? it.orderQty ?? it.orderQuantity ?? it.qty ?? parent.quantity ?? parent.totalQty;
  const spec = it.spec ?? it.specification ?? parent.spec ?? parent.specification;
  const goodsName = it.goodsName ?? it.productTitle ?? it.title ?? it.productName ?? parent.goodsName ?? parent.productTitle ?? parent.title;
  const materialNo = it.materialNo ?? it.material_no ?? parent.materialNo ?? parent.material_no;
  const materialCode = it.materialCode ?? it.material_code ?? parent.materialCode ?? parent.material_code;
  const flute = it.flute ?? it.fluteType ?? it.flute_type ?? parent.flute ?? parent.fluteType ?? parent.flute_type;
  const creasingType = it.creasingType ?? it.creaseType ?? it.creasing_type ?? parent.creasingType ?? parent.creaseType ?? parent.creasing_type;
  const creasingSize1 = it.creasingSize1 ?? it.creaseSize1 ?? it.creasing_size1 ?? parent.creasingSize1 ?? parent.creaseSize1 ?? parent.creasing_size1;
  const creasingSize2 = it.creasingSize2 ?? it.creaseSize2 ?? it.creasing_size2 ?? parent.creasingSize2 ?? parent.creaseSize2 ?? parent.creasing_size2;
  const creasingSize3 = it.creasingSize3 ?? it.creaseSize3 ?? it.creasing_size3 ?? parent.creasingSize3 ?? parent.creaseSize3 ?? parent.creasing_size3;
  const boardWidth = it.boardWidth ?? it.board_width ?? parent.boardWidth ?? parent.board_width ?? parent.paperWidth ?? parent.boardW;
  const boardHeight = it.boardHeight ?? it.board_height ?? parent.boardHeight ?? parent.board_height ?? parent.paperLength ?? parent.boardH;
  const paperSize = it.paperSize ?? parent.paperSize ?? ((boardWidth || boardHeight) ? `${boardWidth || ''}×${boardHeight || ''}` : '');
  const next = Object.assign({}, parent, it, {
    _id: pid || parent._id,
    id: pid || parent.id,
    orderNo: meta.childNo,
    orderNumber: meta.childNo,
    quantity: qty,
    totalQty: qty,
    spec,
    goodsName,
    materialNo,
    materialCode,
    flute,
    creasingType,
    creasingSize1,
    creasingSize2,
    creasingSize3,
    boardWidth,
    boardHeight,
    paperSize,
    items: [it]
  });
  return next;
};

Page({
  data: {
    orderInfo: {
      orderNo: '',
      productName: '',
      spec: '',
      totalQty: 0,
      sheetCount: 0,
      producedQty: 0,
      status: '',
      progress: 0,
      customerName: '',
      materialCode: '',
      flute: '',
      creaseText: '',
      notes: ''
    },
    stockedQty: 0,
    metrics: { totalQty: 0, producedQty: 0, stockedQty: 0 },
    processList: [],
    segments: [0, 0, 0],
    drawingUrl: '',
    qcInfo: {
      current: null,
      history: [
        { process: '印刷', result: '合格', time: '08:40' }
      ]
    },
    operationLogs: [
      { time: '08:30', content: '李师傅开始印刷' },
      { time: '09:15', content: '王师傅开始模切' }
    ],
    finishLogs: [], // 完工日志
      progressPercent: 60,
      showStartBtn: false,
      showShipBtn: false,
      showPrintBtn: false,
      showShipmentDialog: false,
      shipmentDialog: { orderNo: '', customer: '', spec: '', productName: '', materialNo: '', orderQty: 0, stockedQty: 0, inputQty: '' }
  },
  ensureCustomerNameMap: function() {
    if (this._customerShortToFullPromise) return this._customerShortToFullPromise;
    this._customerShortToFullPromise = wx.cloud
      .callFunction({ name: 'erp-api', data: { action: 'getCustomers' } })
      .then((res) => {
        const list = (res && res.result && (res.result.data || res.result.customers)) ? (res.result.data || res.result.customers) : [];
        const map = {};
        (Array.isArray(list) ? list : []).forEach((c) => {
          const full = (c && (c.companyName || c.name)) ? (c.companyName || c.name) : '';
          const short = c && c.shortName ? String(c.shortName) : '';
          if (full) map[full] = short || full;
          if (short) map[short] = short;
        });
        this._customerShortToFull = map;
        return map;
      })
      .catch(() => {
        this._customerShortToFull = {};
        return {};
      });
    return this._customerShortToFullPromise;
  },
  mapCustomerFullName: function(name) {
    const n = String(name || '').trim();
    if (!n) return '';
    const m = this._customerShortToFull || {};
    return m[n] || n;
  },
  formatTime: function(d) {
    return formatTime(d);
  },
  refreshOrderState: function() {
    const optOrderId = this.data.orderId || '';
    const optOrderNo = (this.data.orderInfo && this.data.orderInfo.orderNo) || '';
    getData('orders', true)
      .then(orders => {
        const list = Array.isArray(orders) ? orders : [];
        let order = null;
        if (optOrderNo) order = list.find(o => (o.orderNo === optOrderNo || o.orderNumber === optOrderNo));
        if (!order && optOrderId) order = list.find(o => (o._id === optOrderId || o.id === optOrderId));
        if (!order && optOrderNo) {
          const meta = parseChildOrderNo(optOrderNo);
          if (meta && meta.parentNo) {
            const parent = list.find(o => (o.orderNo === meta.parentNo || o.orderNumber === meta.parentNo)) || null;
            order = buildChildFromParentOrder(parent, optOrderNo);
          }
        }
        if (!order) return;
        const statusText = this.mapStatus(order.status);
        const totalQty = Number(order.quantity || order.totalQty || 0);
        const rawSheetCount = Number(
          order.sheetCount ??
            order.sheet_count ??
            order.sheetQty ??
            order.sheet_qty ??
            (order.product && order.product.sheetCount) ??
            (order.items && order.items[0] && order.items[0].sheetCount) ??
            (order.products && order.products[0] && order.products[0].sheetCount)
        );
        const sheetCount = (Number.isFinite(rawSheetCount) && rawSheetCount > 0) ? rawSheetCount : totalQty;
        const producedQty = Number(order.producedQty || 0);
        const stockedQty = Number(order.stockedQty || 0);
        const deliveredQty = Number(order.deliveredQty || order.shippedQty || 0);
        const stockTime = this.formatTime(order.stockedAt || order.stockTime || (order.status === 'stocked' ? (order.updatedAt || order.updateTime) : ''));
        const printStartTime = this.formatTime(order.printStartAt || order.startedAt || order.startTime);
        const printFinishTime = this.formatTime(order.printFinishAt || order.printedAt || order.completedAt);
        let progress = 0;
        if (printStartTime) progress = 25;
        if (printFinishTime) progress = 50;
        if (stockTime) progress = 75;
        const deliveryTime = this.formatTime(order.deliveredAt || order.shippedAt || (order.status === 'shipped' || order.status === 'delivered' ? (order.updatedAt || order.updateTime) : ''));
        if (deliveryTime) progress = 100;
        const shipmentsRaw1 = Array.isArray(order.shipments) ? order.shipments : (Array.isArray(order.deliveryLogs) ? order.deliveryLogs : []);
        const shipments1 = shipmentsRaw1.map(it => ({ qty: Number(it.qty || it.quantity || it.count || 0), time: this.formatTime(it.time || it.at || it.date || it.createdAt || it.ts || '') })).filter(s => (s.qty || s.time));
        const processList = [
          { name: '开始生产', status: printStartTime ? '已完成' : '待处理', time: printStartTime, showTime: !!printStartTime, showQty: false },
          { name: '印刷完成', status: producedQty > 0 ? '已完成' : '待处理', time: printFinishTime, qty: producedQty, qtyLabel: '印刷完成数量', showTime: !!printFinishTime, showQty: true },
          { name: '入库', status: stockedQty > 0 ? '已完成' : '待处理', time: stockTime, qty: stockedQty, qtyLabel: '入库数量', showTime: !!stockTime, showQty: true },
          { name: '发货', status: (deliveredQty > 0 || shipments1.length) ? '已完成' : '待处理', time: deliveryTime, qty: deliveredQty, qtyLabel: '出货数量', showTime: !!deliveryTime, showQty: true, shipments: shipments1 }
        ];
        const items = Array.isArray(order.items) ? order.items : [];
        const firstItem = items[0] || {};
        const prod = (order.product && typeof order.product === 'object') ? order.product : {};
        const bw =
          order.boardWidth ||
          firstItem.boardWidth ||
          prod.boardWidth ||
          prod.board_width ||
          order.paperWidth ||
          order.boardW ||
          prod.paperWidth ||
          '';
        const bh =
          order.boardHeight ||
          firstItem.boardHeight ||
          prod.boardHeight ||
          prod.board_height ||
          order.paperLength ||
          order.boardH ||
          prod.paperLength ||
          '';
        const paperSizeText = order.paperSize || prod.paperSize || ((bw || bh) ? `${bw}×${bh}` : '');
        const paperSizeDisplay = normalizePaperSize(paperSizeText) || '-';
        const flute = order.flute || order.fluteType || prod.flute || prod.fluteType || firstItem.flute || '';
        const materialCode = order.materialCode || prod.materialCode || prod.material_code || firstItem.materialCode || firstItem.material_code || '';
        const materialFluteDisplay = buildMaterialFluteDisplay(materialCode, flute);
        const creasingType = order.creasingType || order.creaseType || prod.creasingType || prod.creaseType || prod.creasing_type || firstItem.creasingType || firstItem.creaseType || '';
        const c1 = order.creasingSize1 || order.creaseSize1 || prod.creasingSize1 || prod.creaseSize1 || prod.creasing_size1 || firstItem.creasingSize1 || firstItem.creaseSize1 || 0;
        const c2 = order.creasingSize2 || order.creaseSize2 || prod.creasingSize2 || prod.creaseSize2 || prod.creasing_size2 || firstItem.creasingSize2 || firstItem.creaseSize2 || 0;
        const c3 = order.creasingSize3 || order.creaseSize3 || prod.creasingSize3 || prod.creaseSize3 || prod.creasing_size3 || firstItem.creasingSize3 || firstItem.creaseSize3 || 0;
        const hasCrease = creasingType || c1 || c2 || c3;
        const creaseText = (order.creaseText || prod.creaseText || firstItem.creaseText) || (hasCrease ? `${Number(c1 || 0)}-${Number(c2 || 0)}-${Number(c3 || 0)}${creasingType ? ` (${creasingType})` : ''}` : '');
        const joinMethod = order.joinMethod || order.join_method || prod.joinMethod || prod.join_method || firstItem.joinMethod || firstItem.join_method || '';
        const notes = order.notes || order.remark || order.note || prod.notes || prod.remark || prod.note || '';

        this.setData({
          'orderInfo.status': statusText,
          'orderInfo.totalQty': totalQty,
          'orderInfo.sheetCount': sheetCount,
          'orderInfo.producedQty': producedQty,
          'orderInfo.paperSize': paperSizeText,
          'orderInfo.paperSizeDisplay': paperSizeDisplay,
          'orderInfo.materialCode': materialCode,
          'orderInfo.flute': flute,
          'orderInfo.materialFluteDisplay': materialFluteDisplay,
          'orderInfo.creaseText': creaseText,
          'orderInfo.joinMethod': joinMethod,
          'orderInfo.notes': notes,
          stockedQty,
          metrics: { totalQty, producedQty, stockedQty },
          processList,
          progressPercent: progress,
          segments: this.computeSegments(progress)
        });
      })
      .catch(() => {});
  },

  refreshOrderStateFromLocal: function(order) {
    if (!order) return;
    const statusText = this.mapStatus(order.status);
    const totalQty = Number(order.quantity || order.totalQty || 0);
    const rawSheetCount = Number(
      order.sheetCount ??
        order.sheet_count ??
        order.sheetQty ??
        order.sheet_qty ??
        (order.product && order.product.sheetCount) ??
        (order.items && order.items[0] && order.items[0].sheetCount) ??
        (order.products && order.products[0] && order.products[0].sheetCount)
    );
    const sheetCount = (Number.isFinite(rawSheetCount) && rawSheetCount > 0) ? rawSheetCount : totalQty;
    const producedQty = Number(order.producedQty || 0);
    const stockedQty = Number(order.stockedQty || 0);
    const deliveredQty = Number(order.deliveredQty || order.shippedQty || 0);
    const stockTime = this.formatTime(order.stockedAt || order.stockTime || (order.status === 'stocked' ? (order.updatedAt || order.updateTime) : ''));
    const printStartTime = this.formatTime(order.printStartAt || order.startedAt || order.startTime);
    const printFinishTime = this.formatTime(order.printFinishAt || order.printedAt || order.completedAt);
    let progress = 0;
    if (printStartTime) progress = 25;
    if (printFinishTime) progress = 50;
    if (stockTime) progress = 75;
    const deliveryTime = this.formatTime(order.deliveredAt || order.shippedAt || (order.status === 'shipped' || order.status === 'delivered' ? (order.updatedAt || order.updateTime) : ''));
    if (deliveryTime) progress = 100;
    const shipmentsRaw2 = Array.isArray(order.shipments) ? order.shipments : (Array.isArray(order.deliveryLogs) ? order.deliveryLogs : []);
    const shipments2 = shipmentsRaw2.map(it => ({ qty: Number(it.qty || it.quantity || it.count || 0), time: this.formatTime(it.time || it.at || it.date || it.createdAt || it.ts || '') })).filter(s => (s.qty || s.time));
    const processList = [
      { name: '开始生产', status: printStartTime ? '已完成' : '待处理', time: printStartTime, showTime: !!printStartTime, showQty: false },
      { name: '印刷完成', status: producedQty > 0 ? '已完成' : '待处理', time: printFinishTime, qty: producedQty, qtyLabel: '印刷完成数量', showTime: !!printFinishTime, showQty: true },
      { name: '入库', status: stockedQty > 0 ? '已完成' : '待处理', time: stockTime, qty: stockedQty, qtyLabel: '入库数量', showTime: !!stockTime, showQty: true },
      { name: '发货', status: (deliveredQty > 0 || shipments2.length) ? '已完成' : '待处理', time: deliveryTime, qty: deliveredQty, qtyLabel: '出货数量', showTime: !!deliveryTime, showQty: true, shipments: shipments2 }
    ];
    const items = Array.isArray(order.items) ? order.items : [];
    const firstItem = items[0] || {};
    const prod = (order.product && typeof order.product === 'object') ? order.product : {};
    const bw =
      order.boardWidth ||
      firstItem.boardWidth ||
      prod.boardWidth ||
      prod.board_width ||
      order.paperWidth ||
      order.boardW ||
      prod.paperWidth ||
      '';
    const bh =
      order.boardHeight ||
      firstItem.boardHeight ||
      prod.boardHeight ||
      prod.board_height ||
      order.paperLength ||
      order.boardH ||
      prod.paperLength ||
      '';
    const paperSizeText = order.paperSize || prod.paperSize || ((bw || bh) ? `${bw}×${bh}` : '');
    const paperSizeDisplay = normalizePaperSize(paperSizeText) || '-';
    const flute = order.flute || order.fluteType || prod.flute || prod.fluteType || firstItem.flute || '';
    const materialCode = order.materialCode || prod.materialCode || prod.material_code || firstItem.materialCode || firstItem.material_code || '';
    const materialFluteDisplay = buildMaterialFluteDisplay(materialCode, flute);
    const creasingType = order.creasingType || order.creaseType || prod.creasingType || prod.creaseType || prod.creasing_type || firstItem.creasingType || firstItem.creaseType || '';
    const c1 = order.creasingSize1 || order.creaseSize1 || prod.creasingSize1 || prod.creaseSize1 || prod.creasing_size1 || firstItem.creasingSize1 || firstItem.creaseSize1 || 0;
    const c2 = order.creasingSize2 || order.creaseSize2 || prod.creasingSize2 || prod.creaseSize2 || prod.creasing_size2 || firstItem.creasingSize2 || firstItem.creaseSize2 || 0;
    const c3 = order.creasingSize3 || order.creaseSize3 || prod.creasingSize3 || prod.creaseSize3 || prod.creasing_size3 || firstItem.creasingSize3 || firstItem.creaseSize3 || 0;
    const hasCrease = creasingType || c1 || c2 || c3;
    const creaseText = (order.creaseText || prod.creaseText || firstItem.creaseText) || (hasCrease ? `${Number(c1 || 0)}-${Number(c2 || 0)}-${Number(c3 || 0)}${creasingType ? ` (${creasingType})` : ''}` : '');
    const joinMethod = order.joinMethod || order.join_method || prod.joinMethod || prod.join_method || firstItem.joinMethod || firstItem.join_method || '';
    const notes = order.notes || order.remark || order.note || prod.notes || prod.remark || prod.note || '';

    this.setData({
      'orderInfo.status': statusText,
      'orderInfo.totalQty': totalQty,
      'orderInfo.sheetCount': sheetCount,
      'orderInfo.producedQty': producedQty,
      'orderInfo.paperSize': paperSizeText,
      'orderInfo.paperSizeDisplay': paperSizeDisplay,
      'orderInfo.materialCode': materialCode,
      'orderInfo.flute': flute,
      'orderInfo.materialFluteDisplay': materialFluteDisplay,
      'orderInfo.creaseText': creaseText,
      'orderInfo.joinMethod': joinMethod,
      'orderInfo.notes': notes,
      stockedQty,
      metrics: { totalQty, producedQty, stockedQty },
      processList,
      progressPercent: progress,
      segments: this.computeSegments(progress)
    });
  },

  onLoad: function(options) {
    const app = getApp();
    const finishLogs = app.globalData.finishLogs || [];
    const optOrderId = options && (options.orderId || options.id) ? normalizeOrderToken(options.orderId || options.id) : '';
    const optOrderNo = options && (options.orderNo || options.no) ? normalizeOrderToken(options.orderNo || options.no) : '';
    const tryLoad = (orderId, orderNo) => {
      const oid = normalizeOrderToken(orderId);
      const ono = normalizeOrderToken(orderNo);
      let enrichStarted = false;
      const isEnrichNeeded = (order) => {
        const o = order && typeof order === 'object' ? order : {};
        const prod = (o.product && typeof o.product === 'object') ? o.product : {};
        const items = Array.isArray(o.items) ? o.items : [];
        const firstItem = items[0] || {};
        const customerName = o.customerName || (o.customer && (o.customer.companyName || o.customer.name)) || '';
        const goodsName = o.goodsName || o.productTitle || o.title || prod.title || prod.productTitle || firstItem.goodsName || firstItem.title || firstItem.productName || '';
        const materialNo = o.materialNo || prod.materialNo || prod.material_no || firstItem.materialNo || firstItem.material_no || '';
        const spec = o.spec || o.specification || prod.spec || prod.specification || firstItem.spec || firstItem.specification || '';
        const paperSize = o.paperSize || prod.paperSize || '';
        const materialCode = o.materialCode || prod.materialCode || prod.material_code || firstItem.materialCode || firstItem.material_code || '';
        const flute = o.flute || o.fluteType || prod.flute || prod.fluteType || firstItem.flute || '';
        const createTime = o.createdAt || o.createTime || o.created_at || '';
        const notes = o.notes || o.remark || o.note || prod.notes || prod.remark || prod.note || '';
        return !(customerName && goodsName && materialNo && spec && (paperSize || (o.boardWidth || firstItem.boardWidth || prod.boardWidth) || (o.boardHeight || firstItem.boardHeight || prod.boardHeight)) && (materialCode || flute) && createTime) || (!notes && notes !== '');
      };
      const startEnrich = (idForFetch, noForFetch) => {
        if (enrichStarted) return;
        enrichStarted = true;
        const fetchNo = String(noForFetch || '').trim();
        const fetchId = String(idForFetch || '').trim();
        const applyOrder = (od) => {
          if (!od) return;
          const built = buildChildFromParentOrder(od, fetchNo);
          setFromOrder(built || od);
        };
        if (fetchId) {
          try {
            wx.cloud.callFunction({
              name: 'erp-api',
              data: { action: 'getOrderDetail', data: { id: fetchId } }
            }).then((r) => {
              const od = r && r.result && r.result.data ? r.result.data : null;
              if (od) applyOrder(od);
            }).catch(() => {});
          } catch (_) {}
          return;
        }
        if (!fetchNo) return;
        try {
          wx.cloud.callFunction({
            name: 'erp-api',
            data: { action: 'getOrders', params: { page: 1, limit: 30, keyword: fetchNo, orderNo: fetchNo, compact: false } }
          }).then((rs) => {
            const arr = (rs && rs.result && rs.result.data) ? rs.result.data : [];
            const hit = arr.find(o => (o && (o.orderNo === fetchNo || o.orderNumber === fetchNo))) || null;
            if (hit) {
              applyOrder(hit);
              return;
            }
            const meta = parseChildOrderNo(fetchNo);
            if (!meta || !meta.parentNo) return;
            const parent = arr.find(o => (o && (o.orderNo === meta.parentNo || o.orderNumber === meta.parentNo))) || null;
            if (parent) {
              applyOrder(parent);
              return;
            }
            wx.cloud.callFunction({
              name: 'erp-api',
              data: { action: 'getOrders', params: { page: 1, limit: 30, keyword: meta.parentNo, orderNo: meta.parentNo, compact: false } }
            }).then((r2) => {
              const arr2 = (r2 && r2.result && r2.result.data) ? r2.result.data : [];
              const p2 = arr2.find(o => (o && (o.orderNo === meta.parentNo || o.orderNumber === meta.parentNo))) || null;
              if (p2) applyOrder(p2);
            }).catch(() => {});
          }).catch(() => {});
        } catch (_) {}
      };
      const setFromOrder = (order) => {
        if (!order) return;
        const id = order._id || order.id || '';
        const statusText = this.mapStatus(order.status);
        const totalQty = Number(order.quantity || order.totalQty || 0);
        const rawSheetCount = Number(
          order.sheetCount ??
            order.sheet_count ??
            order.sheetQty ??
            order.sheet_qty ??
            (order.product && order.product.sheetCount) ??
            (order.items && order.items[0] && order.items[0].sheetCount) ??
            (order.products && order.products[0] && order.products[0].sheetCount)
        );
        const sheetCount = (Number.isFinite(rawSheetCount) && rawSheetCount > 0) ? rawSheetCount : totalQty;
        const producedQty = Number(order.producedQty || 0);
        const stockedQty = Number(order.stockedQty || 0);
        const printStartTime = formatTime(order.printStartAt || order.startedAt || order.startTime);
        const finishScanLog = (finishLogs || []).find(l => /印刷/.test(l.content || '') && /(完成|扫码)/.test(l.content || ''));
        const printFinishTime = formatTime(finishScanLog ? finishScanLog.time : (order.printFinishAt || order.printedAt || order.completedAt));
        const stockTime = formatTime(order.stockedAt || order.stockTime || (order.status === 'stocked' ? (order.updatedAt || order.updateTime) : ''));
        const deliveredQty = Number(order.deliveredQty || order.shippedQty || 0);
        const deliveryTime = formatTime(order.deliveredAt || order.shippedAt || (order.status === 'shipped' || order.status === 'delivered' ? (order.updatedAt || order.updateTime) : ''));
        const shipmentsRaw3 = Array.isArray(order.shipments) ? order.shipments : (Array.isArray(order.deliveryLogs) ? order.deliveryLogs : []);
        const shipments3 = shipmentsRaw3.map(it => ({ qty: Number(it.qty || it.quantity || it.count || 0), time: formatTime(it.time || it.at || it.date || it.createdAt || it.ts || '') })).filter(s => (s.qty || s.time));
        let progress = 0;
        if (printStartTime) progress = 25;
        if (printFinishTime || producedQty > 0) progress = Math.max(progress, 50);
        if (stockTime || stockedQty > 0) progress = Math.max(progress, 75);
        if (deliveryTime || deliveredQty > 0) progress = 100;
        const createTime = formatTime(order.createdAt || order.createTime || order.created_at || '');
        const customerName = order.customerName || (order.customer && (order.customer.companyName || order.customer.name)) || '';
        const prod = (order.product && typeof order.product === 'object') ? order.product : {};
        const productName = order.productName || prod.name || '';
        const items = Array.isArray(order.items) ? order.items : [];
        const firstItem = items[0] || {};
        const spec = order.spec || order.specification || prod.spec || prod.specification || firstItem.spec || firstItem.specification || '';
        const bw =
          order.boardWidth ||
          firstItem.boardWidth ||
          prod.boardWidth ||
          prod.board_width ||
          order.paperWidth ||
          order.boardW ||
          prod.paperWidth ||
          '';
        const bh =
          order.boardHeight ||
          firstItem.boardHeight ||
          prod.boardHeight ||
          prod.board_height ||
          order.paperLength ||
          order.boardH ||
          prod.paperLength ||
          '';
        const paperSizeText = order.paperSize || prod.paperSize || ((bw || bh) ? `${bw}×${bh}` : '');
        const paperSizeDisplay = normalizePaperSize(paperSizeText) || '-';
        const materialCode = order.materialCode || prod.materialCode || prod.material_code || firstItem.materialCode || firstItem.material_code || '';
        const flute = order.flute || order.fluteType || prod.flute || prod.fluteType || firstItem.flute || '';
        const materialFluteDisplay = buildMaterialFluteDisplay(materialCode, flute);
        const creasingType = order.creasingType || order.creaseType || prod.creasingType || prod.creaseType || prod.creasing_type || firstItem.creasingType || firstItem.creaseType || '';
        const c1 = order.creasingSize1 || order.creaseSize1 || prod.creasingSize1 || prod.creaseSize1 || prod.creasing_size1 || firstItem.creasingSize1 || firstItem.creaseSize1 || 0;
        const c2 = order.creasingSize2 || order.creaseSize2 || prod.creasingSize2 || prod.creaseSize2 || prod.creasing_size2 || firstItem.creasingSize2 || firstItem.creaseSize2 || 0;
        const c3 = order.creasingSize3 || order.creaseSize3 || prod.creasingSize3 || prod.creaseSize3 || prod.creasing_size3 || firstItem.creasingSize3 || firstItem.creaseSize3 || 0;
        const hasCrease = creasingType || c1 || c2 || c3;
        const creaseText = (order.creaseText || prod.creaseText || firstItem.creaseText) || (hasCrease ? `${Number(c1 || 0)}-${Number(c2 || 0)}-${Number(c3 || 0)}${creasingType ? ` (${creasingType})` : ''}` : '');
        const joinMethod = order.joinMethod || order.join_method || prod.joinMethod || prod.join_method || firstItem.joinMethod || firstItem.join_method || '';
        const notes = order.notes || order.remark || order.note || prod.notes || prod.remark || prod.note || '';
        const attachments = Array.isArray(order.attachments) ? order.attachments : [];
        const pd = order.printDrawing || '';
        
        const getUrl = (att) => {
            if (!att) return '';
            if (typeof att === 'string') return att;
            if (typeof att === 'object') {
                return att.tempFileURL || att.fileID || att.fileId || att.url || att.path || '';
            }
            return '';
        };

        const pdUrl = getUrl(pd);
        const firstAttUrl = getUrl(attachments.length ? attachments[0] : '');

        const isPdf = (u) => String(u || '').toLowerCase().endsWith('.pdf');
        
        let drawingUrl = '';
        let drawingDocUrl = '';
        
        if (pdUrl && typeof pdUrl === 'string') {
          if (isPdf(pdUrl)) {
            drawingDocUrl = pdUrl;
          } else {
            drawingUrl = pdUrl;
          }
        } else if (firstAttUrl && typeof firstAttUrl === 'string') {
          if (isPdf(firstAttUrl)) {
            drawingDocUrl = firstAttUrl;
          } else {
            drawingUrl = firstAttUrl;
          }
        }

        // deliveredQty 与 deliveryTime 已计算

        const processList = [
          {
            name: '开始生产',
            status: printStartTime ? '已完成' : '待处理',
            time: printStartTime,
            showTime: !!printStartTime,
            showQty: false
          },
          {
            name: '印刷完成',
            status: producedQty > 0 ? '已完成' : '待处理',
            time: printFinishTime,
            qty: producedQty,
            qtyLabel: '印刷完成数量',
            showTime: !!printFinishTime,
            showQty: true
          },
          {
            name: '入库',
            status: stockedQty > 0 ? '已完成' : '待处理',
            time: stockTime,
            qty: stockedQty,
            qtyLabel: '入库数量',
            showTime: !!stockTime,
            showQty: true
          },
          {
            name: '发货',
            status: (deliveredQty > 0 || shipments3.length) ? '已完成' : '待处理',
            time: deliveryTime,
            qty: deliveredQty,
            qtyLabel: '出货数量',
            showTime: !!deliveryTime,
            showQty: true,
            shipments: shipments3
          }
        ];

        this.setData({
          orderInfo: {
            orderNo: order.orderNo || order.orderNumber || '',
            productName: productName,
            spec: spec,
            totalQty,
            sheetCount,
            producedQty,
            status: statusText,
            progress: progress / 100,
            customerName: customerName,
            stockedAt: stockTime || '',
            createTime: createTime || '',
            cuttingSize: order.cuttingSize || '',
            paperSize: paperSizeText,
            paperSizeDisplay,
            materialCode,
            flute,
            materialFluteDisplay
          },
          stockedQty,
          metrics: { totalQty, producedQty, stockedQty },
          progressPercent: progress,
          processList: processList,
          segments: this.computeSegments(progress),
          drawingUrl,
          drawingDocUrl,
          showLog: false,
          finishLogs,
          orderId: id,
          showPrintBtn: !!(order.orderNo || order.orderNumber || id)
        });

        this.setData({
          'orderInfo.creaseText': creaseText,
          'orderInfo.joinMethod': joinMethod,
          'orderInfo.notes': notes,
          'orderInfo.goodsName': order.goodsName || order.productTitle || order.title || prod.title || prod.productTitle || prod.name || firstItem.goodsName || firstItem.title || firstItem.productName || '无',
          'orderInfo.materialNo': order.materialNo || prod.materialNo || prod.material_no || firstItem.materialNo || firstItem.material_no || ''
        });
        this.ensureCustomerNameMap().then(() => {
          const full = this.mapCustomerFullName(customerName);
          if (full && full !== customerName) {
            this.setData({ 'orderInfo.customerName': full });
          }
        });

        try {
          const finishPrintLog = (finishLogs || []).find(l => /印刷/.test(l.content || '') && /(完成|扫码)/.test(l.content || ''));
          const printFinishTime = finishPrintLog ? finishPrintLog.time : (processList[0] && processList[0].endTime) || '';
          this.setData({ 'qcInfo.history': printFinishTime ? [{ process: '印刷完成', time: printFinishTime }] : [] });
        } catch (_) {}

        const needResolve = (u) => typeof u === 'string' && /^cloud:\/\//.test(u);
        const docId = this.data.drawingDocUrl;
        const imgId = this.data.drawingUrl;
        if (needResolve(docId) || needResolve(imgId)) {
          const fileIDs = [];
          if (needResolve(docId)) fileIDs.push(docId);
          if (needResolve(imgId)) fileIDs.push(imgId);
          try {
            wx.cloud.getTempFileURL({
              fileList: fileIDs.map(fid => ({ fileID: fid, maxAge: 3600 }))
            }).then(r => {
              const list = (r && r.fileList) ? r.fileList : [];
              list.forEach(it => {
                if (it.fileID === docId) this.setData({ drawingDocUrl: it.tempFileURL || '' });
                if (it.fileID === imgId) this.setData({ drawingUrl: it.tempFileURL || '' });
              });
            }).catch(() => {});
          } catch (_) {}
        }

        if (!this.data.drawingUrl && !this.data.drawingDocUrl && id) {
          try {
            wx.cloud.callFunction({
              name: 'erp-api',
              data: { action: 'getOrderDetail', data: { id } }
            }).then(rs => {
              const od = rs && rs.result && rs.result.data ? rs.result.data : null;
              if (!od) return;
              const u1 = getUrl(od.printDrawing);
              const u2 = getUrl(Array.isArray(od.attachments) && od.attachments.length ? od.attachments[0] : '');
              const isPdf2 = (u) => String(u || '').toLowerCase().endsWith('.pdf');
              let img = '';
              let doc = '';
              if (u1) { if (isPdf2(u1)) { doc = u1; } else { img = u1; } }
              else if (u2) { if (isPdf2(u2)) { doc = u2; } else { img = u2; } }
              this.setData({ drawingUrl: img, drawingDocUrl: doc });
              const need = (u) => typeof u === 'string' && /^cloud:\/\//.test(u);
              const files = [];
              if (need(doc)) files.push(doc);
              if (need(img)) files.push(img);
              if (files.length) {
                try {
                  wx.cloud.getTempFileURL({ fileList: files.map(fid => ({ fileID: fid, maxAge: 3600 })) }).then(rr => {
                    const lst = (rr && rr.fileList) ? rr.fileList : [];
                    lst.forEach(it => {
                      if (it.fileID === doc) this.setData({ drawingDocUrl: it.tempFileURL || '' });
                      if (it.fileID === img) this.setData({ drawingUrl: it.tempFileURL || '' });
                    });
                  }).catch(() => {});
                } catch (_) {}
              }
            }).catch(() => {});
          } catch (_) {}
        }
      };
      getData('orders', false)
        .then(orders => {
          const list = Array.isArray(orders) ? orders : [];
          let order = null;
          if (ono) order = list.find(o => (o.orderNo === ono || o.orderNumber === ono));
          if (!order && oid) order = list.find(o => (o._id === oid || o.id === oid));
          if (!order && ono) {
            const meta = parseChildOrderNo(ono);
            if (meta && meta.parentNo) {
              const parent = list.find(o => (o.orderNo === meta.parentNo || o.orderNumber === meta.parentNo)) || null;
              order = buildChildFromParentOrder(parent, ono);
            }
          }
          if (order) {
            setFromOrder(order);
            const id2 = order._id || order.id || oid || '';
            const no2 = ono || order.orderNo || order.orderNumber || '';
            if (isEnrichNeeded(order)) {
              startEnrich(id2, no2);
            }
            return;
          }
          // fallback: prefer precise fetch by id; if absent, then list scan
          const tryFetchDetail = (oid, ono) => {
            if (oid) {
              try {
                wx.cloud.callFunction({
                  name: 'erp-api',
                  data: { action: 'getOrderDetail', data: { id: oid } }
                }).then(r => {
                  const od = r && r.result && r.result.data ? r.result.data : null;
                  if (od) {
                    const built = buildChildFromParentOrder(od, ono);
                    setFromOrder(built || od);
                    return;
                  }
                  tryFetchList(oid, ono);
                }).catch(() => tryFetchList(oid, ono));
              } catch (_) {
                tryFetchList(oid, ono);
              }
            } else {
              tryFetchList(oid, ono);
            }
          };
          const tryFetchList = (oid, ono) => {
            try {
              const keyword = String(ono || '').trim();
              const params = keyword ? { page: 1, limit: 50, keyword, orderNo: keyword } : { page: 1, limit: 500 };
              wx.cloud.callFunction({ name: 'erp-api', data: { action: 'getOrders', params } })
                .then(rs => {
                  const arr = (rs && rs.result && rs.result.data) ? rs.result.data : [];
                  const found = arr.find(o => (o.orderNo === ono || o.orderNumber === ono || o._id === oid || o.id === oid)) || null;
                  if (found) {
                    setFromOrder(found);
                    return;
                  }
                  const builtFromHitParent = (() => {
                    const meta = parseChildOrderNo(ono);
                    if (!meta || !meta.parentNo) return null;
                    const parent = arr.find(o => (o.orderNo === meta.parentNo || o.orderNumber === meta.parentNo)) || null;
                    return buildChildFromParentOrder(parent, ono);
                  })();
                  if (builtFromHitParent) {
                    setFromOrder(builtFromHitParent);
                    return;
                  }
                  const meta = parseChildOrderNo(ono);
                  if (!meta || !meta.parentNo) {
                    setFromOrder(null);
                    return;
                  }
                  const parentKw = meta.parentNo;
                  wx.cloud.callFunction({
                    name: 'erp-api',
                    data: { action: 'getOrders', params: { page: 1, limit: 50, keyword: parentKw, orderNo: parentKw } }
                  }).then(r2 => {
                    const arr2 = (r2 && r2.result && r2.result.data) ? r2.result.data : [];
                    const parent = arr2.find(o => (o.orderNo === parentKw || o.orderNumber === parentKw)) || null;
                    setFromOrder(buildChildFromParentOrder(parent, ono) || null);
                  }).catch(() => setFromOrder(null));
                })
                .catch(() => setFromOrder(null));
            } catch (_) {
              setFromOrder(null);
            }
          };
          tryFetchDetail(oid, ono);
        })
        .catch(() => {
          this.setData({
            progressPercent: Math.round(this.data.orderInfo.progress * 100),
            showLog: false,
            finishLogs
          });
        });
    };
    try {
      const ec = this.getOpenerEventChannel && this.getOpenerEventChannel();
      if (ec && typeof ec.on === 'function') {
        ec.on('orderRoute', (data) => {
          const d = data || {};
          tryLoad(d.orderId || optOrderId, d.orderNo || optOrderNo);
        });
      }
      tryLoad(optOrderId, optOrderNo);
    } catch (_) {
      tryLoad(optOrderId, optOrderNo);
    }

    const from = options && options.from ? String(options.from) : '';
    this.setData({ showStartBtn: from === 'startScan', showShipBtn: true });
  },

  onStartProduction: function() {
    const id = this.data.orderId || '';
    const orderNo = this.data.orderInfo && this.data.orderInfo.orderNo;
    if (!id && !orderNo) { wx.showToast({ title: '订单信息缺失', icon: 'none' }); return; }
    wx.showLoading({ title: '处理中...' });
    const payload = { id, status: 'processing', startedAt: new Date(), printStartAt: new Date() };
    if (!id) delete payload.id;
    updateData('orders', payload)
      .then(() => {
        wx.hideLoading();
        this.setData({ 'orderInfo.status': '生产中' });
        wx.showToast({ title: '已开始生产', icon: 'success' });
      })
      .catch(() => {
        wx.hideLoading();
        wx.showToast({ title: '操作失败', icon: 'none' });
      });
  },

  onPrintWorkorder: function() {
    const oi = this.data.orderInfo || {};
    const orderNo = oi.orderNo || '';
    const orderId = this.data.orderId || '';
    if (!orderNo && !orderId) {
      wx.showToast({ title: '订单信息缺失', icon: 'none' });
      return;
    }
    const fallback = Object.assign({}, oi, {
      _id: orderId,
      id: orderId,
      orderNo: orderNo,
      orderNumber: orderNo,
      quantity: oi.totalQty || 0
    });
    const normalize = (src) => {
      const o = src || {};
      const items = Array.isArray(o.items) ? o.items : [];
      const firstItem = items[0] || {};
      const no = String(o.orderNo || o.orderNumber || orderNo || '');
      const goodsName =
        o.goodsName ||
        o.productTitle ||
        o.title ||
        (o.product && (o.product.title || o.product.name)) ||
        firstItem.goodsName ||
        firstItem.title ||
        firstItem.productName ||
        oi.goodsName ||
        '';
      const materialNo =
        o.materialNo ||
        (o.product && o.product.materialNo) ||
        firstItem.materialNo ||
        oi.materialNo ||
        '';
      const rawCustomer = o.customerName || (o.customer && (o.customer.companyName || o.customer.name)) || oi.customerName || '';
      const customerName = this.mapCustomerFullName(rawCustomer);
      const qty = (o.quantity != null && o.quantity !== '') ? o.quantity : ((o.totalQty != null && o.totalQty !== '') ? o.totalQty : (oi.totalQty || 0));
      return Object.assign({}, o, {
        _id: o._id || o.id || orderId,
        id: o.id || o._id || orderId,
        orderNo: no,
        orderNumber: no,
        customerName,
        goodsName,
        materialNo,
        quantity: qty
      });
    };
    try {
      getData('orders', false)
        .then((orders) => {
          const arr = Array.isArray(orders) ? orders : [];
          const found = arr.find(o => (orderId && (o._id === orderId || o.id === orderId)) || (orderNo && (o.orderNo === orderNo || o.orderNumber === orderNo))) || null;
          const list = [normalize(found || fallback)];
          const key = `print_orders_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          try {
            wx.setStorageSync(key, list);
          } catch (_) {
            wx.showToast({ title: '缓存失败，无法打印', icon: 'none' });
            return;
          }
          wx.navigateTo({ url: `/pages/production-sub/workorder-print/workorder-print?key=${encodeURIComponent(key)}` });
        })
        .catch(() => {
          const list = [normalize(fallback)];
          const key = `print_orders_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          try {
            wx.setStorageSync(key, list);
          } catch (_) {
            wx.showToast({ title: '缓存失败，无法打印', icon: 'none' });
            return;
          }
          wx.navigateTo({ url: `/pages/production-sub/workorder-print/workorder-print?key=${encodeURIComponent(key)}` });
        });
    } catch (_) {
      const list = [normalize(fallback)];
      const key = `print_orders_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      try {
        wx.setStorageSync(key, list);
      } catch (_) {
        wx.showToast({ title: '缓存失败，无法打印', icon: 'none' });
        return;
      }
      wx.navigateTo({ url: `/pages/production-sub/workorder-print/workorder-print?key=${encodeURIComponent(key)}` });
    }
  },

  previewImage() {
    const url = this.data.drawingUrl;
    if (url) {
      wx.previewImage({ urls: [url] });
    } else {
      wx.showToast({ title: '暂无图纸', icon: 'none' });
    }
  },

  previewDocument() {
    const url = this.data.drawingDocUrl;
    if (!url) {
      wx.showToast({ title: '暂无图纸', icon: 'none' });
      return;
    }
    wx.downloadFile({
      url,
      success: (res) => {
        const filePath = res.tempFilePath;
        wx.openDocument({ filePath });
      },
      fail: () => wx.showToast({ title: '图纸打开失败', icon: 'none' })
    });
  },

  openShipmentDialog: function() {
    const oi = this.data.orderInfo || {};
    const proc = this.data.processList || [];
    const shipItem = proc.find(i => i && i.name === '发货') || null;
    const shippedQty = shipItem ? (Number(shipItem.qty || 0) || (Array.isArray(shipItem.shipments) ? shipItem.shipments.reduce((s, it) => s + Number(it.qty || 0), 0) : 0)) : 0;
    const inventoryQty = Math.max(0, Number(this.data.stockedQty || 0) - shippedQty);
    const orderRemain = Math.max(0, Number(oi.totalQty || 0) - shippedQty);
    const remainingQty = Math.min(inventoryQty, orderRemain);
    const overwriteMode = remainingQty <= 0 && shippedQty > 0;
    const dlg = {
      orderNo: oi.orderNo || '',
      customer: oi.customerName || '-',
      spec: oi.spec || '-',
      productName: oi.goodsName || '无',
      materialNo: oi.materialNo || '无',
      orderQty: Number(oi.totalQty || 0),
      inventoryQty,
      remainingQty,
      inputQty: '',
      overwriteMode,
      inputPlaceholder: overwriteMode ? '请输入修正后的累计发货数量' : '请输入本次发货数量'
    };
    this.setData({ showShipmentDialog: true, shipmentDialog: dlg });
    // 尝试从订单缓存补全商品与物料
    const persistId = this.data.orderId || '';
    const persistNo = oi.orderNo || '';
        try {
          getData('orders', false).then(orders => {
            const arr = Array.isArray(orders) ? orders : [];
            const found = arr.find(o => (o.orderNo === persistNo || o.orderNumber === persistNo || o._id === persistId || o.id === persistId));
            if (!found) return;
            const productName = found.goodsName || found.productTitle || (found.items && found.items[0] && found.items[0].title) || '无';
            const materialNo = found.materialNo || (found.items && found.items[0] && (found.items[0].materialNo || found.items[0].materialCode)) || dlg.materialNo || '无';
            this.setData({ shipmentDialog: Object.assign({}, this.data.shipmentDialog, { productName, materialNo }) });
          }).catch(() => {});
        } catch (_) {}
  },
  onShipQtyInput: function(e) {
    const val = e.detail && e.detail.value ? e.detail.value : '';
    this.setData({ shipmentDialog: Object.assign({}, this.data.shipmentDialog, { inputQty: val }) });
  },
  cancelShipment: function() { this.setData({ showShipmentDialog: false }); },
  confirmShipment: function() {
    const d = this.data.shipmentDialog || {};
    const remain = Math.max(0, Number(d.remainingQty || 0));
    const qty = Math.max(0, parseInt(d.inputQty || '0', 10));
    if (!qty) { wx.showToast({ title: '请输入发货数量', icon: 'none' }); return; }
    if (!d.overwriteMode && qty > remain) { wx.showToast({ title: '超过可发货数量', icon: 'none' }); return; }
    const nowText = formatTime(new Date());
    let list = (this.data.processList || []).slice();
    const idx = list.findIndex(i => i && i.name === '发货');
    let shipments = idx !== -1 && Array.isArray(list[idx].shipments) ? list[idx].shipments.slice() : [];
    shipments = d.overwriteMode ? [{ qty, time: nowText }] : shipments.concat([{ qty, time: nowText }]);
    const sumQty = shipments.reduce((s, it) => s + (Number(it.qty || 0)), 0);
    if (idx !== -1) {
      list[idx] = Object.assign({}, list[idx], { shipments, qty: sumQty, status: '已完成', time: nowText, showQty: true, showTime: true });
    } else {
      list.push({ name: '发货', status: '已完成', time: nowText, qty: sumQty, qtyLabel: '出货数量', showTime: true, showQty: true, shipments });
    }
    const newRemain = d.overwriteMode ? 0 : Math.max(0, remain - qty);
    this.setData({ processList: list, progressPercent: 100, 'orderInfo.status': '正在发货', showShipmentDialog: false, shipmentDialog: Object.assign({}, d, { remainingQty: newRemain }) });
    const persistId = this.data.orderId || '';
    const persistNo = this.data.orderInfo && this.data.orderInfo.orderNo || '';
    const newShip = { qty, time: new Date() };
    const doPersist = () => {
      try {
        getData('orders', false).then(orders => {
          const arr = Array.isArray(orders) ? orders : [];
          const origin = arr.find(o => (o.orderNo === persistNo || o.orderNumber === persistNo || o._id === persistId || o.id === persistId)) || {};
          const prevShipments = Array.isArray(origin.shipments) ? origin.shipments : [];
          const prevQty = Number(origin.shippedQty || 0);
          const payloadShip = d.overwriteMode
            ? { id: persistId, orderNo: persistNo, orderNumber: persistNo, status: 'shipped', shippedQty: qty, shippedAt: new Date(), shipments: [newShip] }
            : { id: persistId, orderNo: persistNo, orderNumber: persistNo, status: 'shipped', shippedQty: prevQty + qty, shippedAt: new Date(), shipments: prevShipments.concat([newShip]) };
          if (!payloadShip.id) delete payloadShip.id;
          updateData('orders', payloadShip).catch(() => {});
        }).catch(() => {
          const payloadShip = { id: persistId, orderNo: persistNo, orderNumber: persistNo, status: 'shipped', shippedQty: qty, shippedAt: new Date(), shipments: [newShip] };
          if (!payloadShip.id) delete payloadShip.id;
          updateData('orders', payloadShip).catch(() => {});
        });
      } catch (_) {
        const payloadShip = { id: persistId, orderNo: persistNo, orderNumber: persistNo, status: 'shipped', shippedQty: qty, shippedAt: new Date(), shipments: [newShip] };
        if (!payloadShip.id) delete payloadShip.id;
        updateData('orders', payloadShip).catch(() => {});
      }
    };
    doPersist();
  },

  computeSegments(percent) {
    const p = Math.max(0, Math.min(100, Number(percent) || 0));
    // 4 segments: 0-25, 25-50, 50-75, 75-100
    const seg1 = Math.min(100, Math.max(0, (p <= 25 ? (p / 25) * 100 : 100)));
    const seg2 = Math.min(100, Math.max(0, (p <= 25 ? 0 : (p <= 50 ? ((p - 25) / 25) * 100 : 100))));
    const seg3 = Math.min(100, Math.max(0, (p <= 50 ? 0 : (p <= 75 ? ((p - 50) / 25) * 100 : 100))));
    const seg4 = Math.min(100, Math.max(0, (p <= 75 ? 0 : ((p - 75) / 25) * 100)));
    return [Math.round(seg1), Math.round(seg2), Math.round(seg3), Math.round(seg4)];
  },

  formatTime(d) {
    return formatTime(d);
  },

  mapStatus(status) {
    const s = String(status || '').toLowerCase();
    if (['pending', 'ordered', 'waiting'].includes(s)) return '待生产';
    if (['processing', 'in_progress', 'producing'].includes(s)) return '生产中';
    if (['stocked', 'warehoused'].includes(s)) return '已入库';
    if (['delivered', 'shipped', 'shipping'].includes(s)) return '已发货';
    if (['completed', 'done'].includes(s)) return '已完成';
    return '生产中';
  },

  onCopyOrderNo() {
    wx.setClipboardData({
      data: this.data.orderInfo.orderNo,
      success: () => {
        wx.showToast({ title: '已复制', icon: 'success' });
      }
    });
  },

  // 开始工序
  onStartProcess(e) {
    const index = e.currentTarget.dataset.index;
    const process = this.data.processList[index];
    
    wx.showModal({
      title: '确认开始',
      content: `是否开始${process.name}工序？`,
      success: (res) => {
        if (res.confirm) {
          const updateKey = `processList[${index}]`;
          const currentTime = formatTime(new Date());
          
          this.setData({
            [`${updateKey}.status`]: '处理中',
            [`${updateKey}.startTime`]: currentTime,
            [`${updateKey}.operator`]: '当前操作员',
            [`${updateKey}.canStart`]: false,
            [`${updateKey}.canFinish`]: true
          });
          
          this.addOperationLog(`开始${process.name}工序`);
          wx.showToast({ title: '工序已开始', icon: 'success' });
        }
      }
    });
  },

  // 完成工序
  onFinishProcess(e) {
    const index = e.currentTarget.dataset.index;
    const process = this.data.processList[index];
    
    wx.showModal({
      title: '完成工序',
      content: '请输入实际产量',
      editable: true,
      placeholderText: this.data.orderInfo.totalQty.toString(),
      success: (res) => {
        if (res.confirm) {
          const actualQty = parseInt(res.content) || this.data.orderInfo.totalQty;
          const updateKey = `processList[${index}]`;
          const currentTime = formatTime(new Date());
          
          this.setData({
            [`${updateKey}.status`]: '已完成',
            [`${updateKey}.endTime`]: currentTime,
            [`${updateKey}.canFinish`]: false,
            [`${updateKey}.canQc`]: true,
            'orderInfo.producedQty': actualQty
          });

          if (process.name === '印刷') {
            this.setData({ 'qcInfo.history': [{ process: '印刷完成', time: currentTime }] });
          }
          try {
            const persistId = this.data.orderId || '';
            const persistNo = (this.data.orderInfo && this.data.orderInfo.orderNo) || '';
            const payload = { id: persistId, orderNo: persistNo, orderNumber: persistNo, producedQty: actualQty, printFinishAt: new Date(), status: 'processing' };
            if (!payload.id) delete payload.id;
            updateData('orders', payload).catch(() => {});
          } catch (_) {}
          
          // 设置下一工序可开始
          if (index + 1 < this.data.processList.length) {
            const nextUpdateKey = `processList[${index + 1}]`;
            this.setData({
              [`${nextUpdateKey}.canStart`]: true
            });
          }
          
          this.updateProgress();
          this.addOperationLog(`完成${process.name}工序，产量${actualQty}`);
          wx.showToast({ title: '工序已完成', icon: 'success' });
        }
      }
    });
  },

  // 快速质检
  onQcProcess(e) {
    const index = e.currentTarget.dataset.index;
    const process = this.data.processList[index];
    
    wx.showActionSheet({
      itemList: ['合格', '不合格'],
      success: (res) => {
        if (res.tapIndex === 0) {
          this.handleQcPass(process.name);
        } else if (res.tapIndex === 1) {
          this.handleQcFail(process.name);
        }
      }
    });
  },

  // 质检合格
  onQcPass() {
    const currentProcess = this.data.qcInfo.current.process;
    this.handleQcPass(currentProcess);
  },

  // 质检不合格
  onQcFail() {
    const currentProcess = this.data.qcInfo.current.process;
    this.handleQcFail(currentProcess);
  },

  // 处理质检合格
  handleQcPass(processName) {
    const time = new Date().toLocaleTimeString('zh-CN', {hour12: false}).slice(0,5);
    const newQcRecord = { process: processName, result: '合格', time };
    
    this.setData({
      'qcInfo.history': [newQcRecord, ...this.data.qcInfo.history],
      'qcInfo.current': null
    });
    
    this.addOperationLog(`${processName}工序质检合格`);
    wx.showToast({ title: '质检通过', icon: 'success' });
  },

  // 处理质检不合格
  handleQcFail(processName) {
    wx.showModal({
      title: '质检不合格',
      content: '请输入不合格原因',
      editable: true,
      placeholderText: '如：套印歪、尺寸偏差等',
      success: (res) => {
        if (res.confirm) {
          const reason = res.content || '未填写原因';
          const time = new Date().toLocaleTimeString('zh-CN', {hour12: false}).slice(0,5);
          const newQcRecord = { process: processName, result: '不合格', reason, time };
          
          this.setData({
            'qcInfo.history': [newQcRecord, ...this.data.qcInfo.history],
            'qcInfo.current': null
          });
          
          this.addOperationLog(`${processName}工序质检不合格：${reason}`);
          wx.showToast({ title: '已记录不合格原因', icon: 'none' });
        }
      }
    });
  },

  // 返回列表
  onBack() {
    wx.navigateBack();
  },

  // 切换操作记录显示
  onToggleLog() {
    this.setData({
      showLog: !this.data.showLog
    });
  },

  // 更新进度
  updateProgress() {
    const completedCount = this.data.processList.filter(p => p.status === '已完成').length;
    const totalCount = this.data.processList.length;
    const progressByProcess = completedCount / totalCount;
    const progressByQty = this.data.orderInfo.producedQty / this.data.orderInfo.totalQty;
    
    const newProgress = Math.max(progressByProcess, progressByQty);
    
    this.setData({
      'orderInfo.progress': newProgress,
      progressPercent: Math.round(newProgress * 100),
      segments: this.computeSegments(Math.round(newProgress * 100))
    });
    const currentStatusText = this.data.orderInfo && this.data.orderInfo.status || '';
    const isShippingPhase = (currentStatusText === '正在发货' || currentStatusText === '已发货');
    if (!isShippingPhase) {
      if (newProgress >= 1.0) {
        this.setData({ 'orderInfo.status': '已完成' });
      } else if (newProgress > 0) {
        this.setData({ 'orderInfo.status': '生产中' });
      }
    }
  },

  // 添加操作日志
  addOperationLog(content) {
    const time = new Date().toLocaleTimeString('zh-CN', {hour12: false}).slice(0,5);
    const newLog = { time, content };
    this.setData({
      operationLogs: [newLog, ...this.data.operationLogs]
    });
  }
});
