const { formatDate: fmtDate } = require('../../../utils/app.js')

const normalizeText = (v) => String(v ?? '').trim()
const toNum = (v) => {
  const n = Number(v)
  if (Number.isFinite(n)) return n
  const m = String(v ?? '').match(/-?\d+(\.\d+)?/)
  return m ? Number(m[0]) : 0
}
const parseChildOrderNo = (orderNo) => {
  const no = normalizeText(orderNo)
  const m = no.match(/^(.*)-(\d+)$/)
  if (!m) return null
  const parentNo = normalizeText(m[1])
  const idx = Number(m[2] || 0) - 1
  if (!parentNo || !(Number.isFinite(idx) && idx >= 0)) return null
  return { parentNo, idx, childNo: no }
}
const buildChildFromParentOrder = (parentOrder, childNo) => {
  const meta = parseChildOrderNo(childNo)
  if (!meta) return null
  const parent = parentOrder && typeof parentOrder === 'object' ? parentOrder : null
  if (!parent) return null
  const items = Array.isArray(parent.items) ? parent.items : []
  if (!(meta.idx >= 0 && meta.idx < items.length)) return null
  const it = items[meta.idx] && typeof items[meta.idx] === 'object' ? items[meta.idx] : {}
  const qty = it.quantity ?? it.orderQty ?? it.orderQuantity ?? it.qty ?? parent.quantity ?? parent.totalQty
  const unitPrice = toNum(it.unitPrice ?? it.price ?? parent.unitPrice)
  const amount = it.amount !== undefined ? toNum(it.amount) : (toNum(qty) * unitPrice)
  const spec = it.spec ?? it.specification ?? parent.spec ?? parent.specification
  const goodsName = it.goodsName ?? it.productTitle ?? it.title ?? it.productName ?? parent.goodsName ?? parent.productTitle ?? parent.title
  const materialNo = it.materialNo ?? it.material_no ?? parent.materialNo ?? parent.material_no
  const materialCode = it.materialCode ?? it.material_code ?? parent.materialCode ?? parent.material_code
  const flute = it.flute ?? it.fluteType ?? it.flute_type ?? parent.flute ?? parent.fluteType ?? parent.flute_type
  const creasingType = it.creasingType ?? it.creaseType ?? it.creasing_type ?? parent.creasingType ?? parent.creaseType ?? parent.creasing_type
  const creasingSize1 = it.creasingSize1 ?? it.creaseSize1 ?? it.creasing_size1 ?? parent.creasingSize1 ?? parent.creaseSize1 ?? parent.creasing_size1
  const creasingSize2 = it.creasingSize2 ?? it.creaseSize2 ?? it.creasing_size2 ?? parent.creasingSize2 ?? parent.creaseSize2 ?? parent.creasing_size2
  const creasingSize3 = it.creasingSize3 ?? it.creaseSize3 ?? it.creasing_size3 ?? parent.creasingSize3 ?? parent.creaseSize3 ?? parent.creasing_size3
  const boardWidth = it.boardWidth ?? it.board_width ?? parent.boardWidth ?? parent.board_width ?? parent.paperWidth ?? parent.boardW
  const boardHeight = it.boardHeight ?? it.board_height ?? parent.boardHeight ?? parent.board_height ?? parent.paperLength ?? parent.boardH
  return Object.assign({}, parent, it, {
    orderNo: meta.childNo,
    orderNumber: meta.childNo,
    quantity: qty,
    totalQty: qty,
    unitPrice,
    amount,
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
    items: [it]
  })
}

Page({
  data: {
    orderId: '',
    isLoading: false,
    orderInfo: {
      orderNo: '',
      customer: { name: '', contact: '', phone: '' },
      product: { name: '', title: '', spec: '', flute: '', materialCode: '', materialNo: '', boardWidth: '', boardHeight: '', creasing: '', creasingType: '', creaseText: '', creasingSize1: '', creasingSize2: '', creasingSize3: '', quantity: 0, sheetCount: 0, unit: '件', unitPrice: 0, rawUnitPrice: '—' },
      amount: { total: 0, deposit: 0, balance: 0, grossProfit: '—' },
      createdAt: '',
      deadline: '',
      priority: 'normal',
      priorityText: '普通',
      status: 'ordered',
      statusText: '已下单',
      notes: '',
      attachments: [],
      joinMethod: '',
      items: []
    },
    qrCodeUrl: ''
  },

  onLoad: function (options) {
    wx.setNavigationBarTitle({ title: '订单详情' });
    const safeDecode = (v) => {
      try {
        return decodeURIComponent(v);
      } catch (_) {
        return v;
      }
    };
    const orderNo = safeDecode((options && (options.orderNo || options.no)) || '') || '';
    const id =
      safeDecode(
        (options &&
          (options.subOrderId ||
            options.childOrderId ||
            options.suborderId ||
            options.childId ||
            options.orderId ||
            options.id)) ||
          ''
      ) || '';

    if (orderNo) {
      this.setData({ 'orderInfo.orderNo': orderNo });
    }
    if (id) {
      this.setData({ orderId: id });
    }

    if (id || orderNo) {
      this.loadOrderDetail({ orderId: id, orderNo });
    }
  },

  formatDate: function (date) {
    return fmtDate(date, 'YYYY-MM-DD HH:mm')
  },

  onShow: function () {
    // 页面显示时，如果已有ID或No但尚未加载完整数据（简单判断items为空），则尝试加载
    // 这里主要防止从列表页返回时重复加载，但支持扫码进入时的首次加载
    const currentId = this.data.orderId;
    const currentNo = this.data.orderInfo?.orderNo;
    const queryKey = currentId || currentNo;

    // 如果没有数据项，说明可能只设置了ID/No但没加载数据
    if (queryKey && (!this.data.orderInfo.items || this.data.orderInfo.items.length === 0)) {
      this.loadOrderDetail({ orderId: currentId, orderNo: currentNo });
    }
  },

  onPrintOrder: function () {
    const info = this.data.orderInfo;
    if (!info || !info.orderNo) {
      wx.showToast({ title: '订单信息不完整', icon: 'none' });
      return;
    }

    const p = info.product || {};
    const creasingType = p.creasingType || p.creasing || '';
    let creasingSize1 = p.creasingSize1;
    let creasingSize2 = p.creasingSize2;
    let creasingSize3 = p.creasingSize3;

    if ((!creasingSize1 && !creasingSize2 && !creasingSize3) && p.creaseText) {
      const m = String(p.creaseText).match(/(\d+(?:\.\d+)?)\s*[-x*]\s*(\d+(?:\.\d+)?)\s*[-x*]\s*(\d+(?:\.\d+)?)/);
      if (m) {
        creasingSize1 = m[1];
        creasingSize2 = m[2];
        creasingSize3 = m[3];
      }
    }

    // 构造打印页面所需的数据格式
    const orderData = {
      _id: this.data.orderId || '',
      id: this.data.orderId || '',
      orderNo: info.orderNo,
      customerName: info.customer.name,
      productName: p.name, // 产品类别
      goodsName: info.goodsName || p.title, // 产品名称/商品名称
      spec: p.spec,
      quantity: p.quantity,
      unit: p.unit || '件',
      unitPrice: p.unitPrice,
      sheetCount: p.sheetCount,
      materialCode: p.materialCode,
      flute: p.flute,
      materialNo: p.materialNo,
      joinMethod: info.joinMethod,
      notes: info.notes,
      boardWidth: p.boardWidth,
      boardHeight: p.boardHeight,
      creasingSize1,
      creasingSize2,
      creasingSize3,
      creasingType,
      qrCodeUrl: info.qrCodeUrl || ''
    };

    const orders = [orderData];
    const key = `print_orders_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      wx.setStorageSync(key, orders);
    } catch (_) {
      wx.showToast({ title: '缓存失败，无法打印', icon: 'none' });
      return;
    }
    wx.navigateTo({ url: `/pages/production-sub/workorder-print/workorder-print?key=${encodeURIComponent(key)}` });
  },

  loadOrderDetail: async function (refOrId) {
    if (this.data.isLoading) return;
    this.setData({ isLoading: true });
    wx.showLoading({ title: '加载中...' });
    try {
      const ref =
        refOrId && typeof refOrId === 'object'
          ? refOrId
          : {
              orderId: refOrId,
              orderNo: ''
            };
      const orderId = String((ref && ref.orderId) || '').trim();
      const orderNo = String((ref && ref.orderNo) || '').trim();
      const key = orderId || orderNo;

      const fetchByKey = async (k) => {
        if (!k) return null;
        try {
          const r = await wx.cloud.callFunction({
            name: 'erp-api',
            data: { action: 'getOrderDetail', data: { id: k } }
          });
          return r && r.result && r.result.data ? r.result.data : null;
        } catch (_) {
          return null;
        }
      };

      console.log('开始加载订单详情，订单ID/No:', key);
      let o = null;
      if (orderId) o = await fetchByKey(orderId);
      if (!o && orderNo) o = await fetchByKey(orderNo);

      if (!o && key) {
        const db = wx.cloud.database();
        try {
          const doc = await db.collection('orders').doc(key).get();
          o = (doc && doc.data) || null;
        } catch (_) {
          try {
            const cmd = db.command;
            const q = await db
              .collection('orders')
              .where(
                cmd.or([
                  { orderNo: key },
                  { orderNumber: key }
                ])
              )
              .limit(1)
              .get();
            o = q && q.data && q.data.length ? q.data[0] : null;
          } catch (_) {
            o = null;
          }
        }
      }

      if (o && orderNo) {
        const loadedNo = String(o.orderNo || o.orderNumber || '').trim();
        if (loadedNo && loadedNo !== orderNo) {
          const retry = await fetchByKey(orderNo);
          if (retry) o = retry;
          else {
            const built = buildChildFromParentOrder(o, orderNo);
            if (built) o = built;
          }
        }
      }

      if (!o && orderNo) {
        const meta = parseChildOrderNo(orderNo);
        if (meta && meta.parentNo) {
          const parent = await fetchByKey(meta.parentNo);
          const built = buildChildFromParentOrder(parent, orderNo);
          if (built) o = built;
        }
      }

      if (o) {
        console.log('成功获取订单数据:', o);
        if (!o.orderNo && !o.orderNumber && !o._id) {
          console.warn('订单数据缺少关键字段:', o);
          wx.showToast({ title: '订单数据不完整', icon: 'none' });
        }
        const orderNo = o.orderNo || o.orderNumber || o._id || '';
        const customerName = o.customerName || (o.customer && o.customer.name) || '';
        const contact = o.contactName || o.contact || '';
        const productName = o.productName || (o.product && o.product.name) || '';
        const firstItem = Array.isArray(o.items) && o.items.length ? o.items[0] : {};
        const qty = Number(
          o.quantity ??
          (Array.isArray(o.items) ? o.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0) : 0)
        );
        const rawSheetCount = Number(
          o.sheetCount ??
          o.sheet_count ??
          o.sheetQty ??
          o.sheet_qty ??
          firstItem.sheetCount ??
          (o.product && o.product.sheetCount) ??
          (o.products && o.products[0] && o.products[0].sheetCount)
        );
        const sheetCount = (Number.isFinite(rawSheetCount) && rawSheetCount > 0) ? rawSheetCount : Number(qty || 0);
        const total = (() => {
          if (typeof o.amount === 'number') return Number(o.amount);
          if (o.amount && typeof o.amount === 'object') return Number(o.amount.total ?? o.amount.amount ?? 0);
          return Number(o.totalAmount ?? o.finalAmount ?? 0);
        })();
        const deposit = Number(o.deposit ?? (o.amount && typeof o.amount === 'object' ? o.amount.deposit : 0) ?? 0) || 0;
        const statusRaw = o.status || 'ordered';
        const status = statusRaw === 'processing' ? 'producing' : statusRaw;
        const createdAt = o.createdAt || o.createTime || Date.now();
        const deadline = o.deliveryDate || null;
        const customerContact = o.contactName || o.customerContact || o.contact || '';
        const unitPrice = Number(
          o.unitPrice ??
          firstItem.unitPrice ??
          (o.product && (o.product.unitPrice ?? o.product.price)) ??
          0
        ) || 0;
        const rawUnitPriceRaw =
          o.rawUnitPrice ??
          o.raw_unit_price ??
          o.rawMaterialUnitPrice ??
          o.raw_material_unit_price ??
          (o.product && (o.product.rawUnitPrice ?? o.product.raw_unit_price ?? o.product.rawMaterialUnitPrice ?? o.product.raw_material_unit_price ?? o.product.costPrice ?? o.product.cost_price ?? o.product.purchasePrice ?? o.product.purchase_price)) ??
          firstItem.rawUnitPrice ??
          firstItem.raw_unit_price ??
          firstItem.rawMaterialUnitPrice ??
          firstItem.raw_material_unit_price ??
          firstItem.costPrice ??
          firstItem.cost_price ??
          firstItem.purchasePrice ??
          firstItem.purchase_price;
        const rawUnitPriceNum = rawUnitPriceRaw === undefined || rawUnitPriceRaw === null || rawUnitPriceRaw === '' ? undefined : toNum(rawUnitPriceRaw);
        const hasRawUnitPrice = rawUnitPriceNum !== undefined && Number.isFinite(rawUnitPriceNum) && rawUnitPriceNum > 0;
        const rawPerUnit = toNum(
          firstItem.skuSheetCount ??
          firstItem.sheetPerUnit ??
          firstItem.sheet_per_unit ??
          firstItem.perSheet ??
          firstItem.per_sheet ??
          o.skuSheetCount ??
          o.sheetPerUnit ??
          o.sheet_per_unit ??
          0
        );
        const jmText = String(
          firstItem.joinMethod ??
          firstItem.join_method ??
          o.joinMethod ??
          o.join_method ??
          ''
        ).trim();
        const joinFactor = jmText.includes('四拼') ? 4 : (jmText.includes('双拼') ? 2 : (jmText.includes('单拼') ? 1 : 0));
        const ratio = (Number(qty || 0) > 0 && Number(sheetCount || 0) > 0) ? (Number(sheetCount || 0) / Number(qty || 0)) : 0;
        const ratioRounded = Number.isFinite(ratio) && ratio > 0 ? Math.round(ratio) : 0;
        const ratioFactor = ratioRounded > 0 && Math.abs(ratio - ratioRounded) <= 0.01 ? ratioRounded : 0;
        const skuFactor = Number.isFinite(rawPerUnit) && rawPerUnit > 0 ? rawPerUnit : 0;
        const factor = Math.max(skuFactor, joinFactor, ratioFactor);
        const totalAmount = Number.isFinite(total) ? total : Number(qty || 0) * Number(unitPrice || 0);
        const grossProfitNum = hasRawUnitPrice ? (totalAmount - rawUnitPriceNum * Number(sheetCount || 0)) : undefined;
        const creasingType = String(
          o.creasingType ??
          o.creaseType ??
          (o.sku && (o.sku.creasingType ?? o.sku.creaseType ?? o.sku.creasing_type)) ??
          (o.product && (o.product.creasingType ?? o.product.creaseType ?? o.product.creasing_type)) ??
          (o.product && o.product.sku && (o.product.sku.creasingType ?? o.product.sku.creaseType ?? o.product.sku.creasing_type)) ??
          (firstItem.sku && (firstItem.sku.creasingType ?? firstItem.sku.creaseType ?? firstItem.sku.creasing_type)) ??
          firstItem.creasingType ??
          ''
        );
        const creasingSize1 = String(
          o.creasingSize1 ??
          o.creaseSize1 ??
          (o.sku && (o.sku.creasingSize1 ?? o.sku.creaseSize1 ?? o.sku.creasing_size1)) ??
          (o.product && (o.product.creasingSize1 ?? o.product.creaseSize1 ?? o.product.creasing_size1)) ??
          (o.product && o.product.sku && (o.product.sku.creasingSize1 ?? o.product.sku.creaseSize1 ?? o.product.sku.creasing_size1)) ??
          (firstItem.sku && (firstItem.sku.creasingSize1 ?? firstItem.sku.creaseSize1 ?? firstItem.sku.creasing_size1)) ??
          firstItem.creasingSize1 ??
          ''
        );
        const creasingSize2 = String(
          o.creasingSize2 ??
          o.creaseSize2 ??
          (o.sku && (o.sku.creasingSize2 ?? o.sku.creaseSize2 ?? o.sku.creasing_size2)) ??
          (o.product && (o.product.creasingSize2 ?? o.product.creaseSize2 ?? o.product.creasing_size2)) ??
          (o.product && o.product.sku && (o.product.sku.creasingSize2 ?? o.product.sku.creaseSize2 ?? o.product.sku.creasing_size2)) ??
          (firstItem.sku && (firstItem.sku.creasingSize2 ?? firstItem.sku.creaseSize2 ?? firstItem.sku.creasing_size2)) ??
          firstItem.creasingSize2 ??
          ''
        );
        const creasingSize3 = String(
          o.creasingSize3 ??
          o.creaseSize3 ??
          (o.sku && (o.sku.creasingSize3 ?? o.sku.creaseSize3 ?? o.sku.creasing_size3)) ??
          (o.product && (o.product.creasingSize3 ?? o.product.creaseSize3 ?? o.product.creasing_size3)) ??
          (o.product && o.product.sku && (o.product.sku.creasingSize3 ?? o.product.sku.creaseSize3 ?? o.product.sku.creasing_size3)) ??
          (firstItem.sku && (firstItem.sku.creasingSize3 ?? firstItem.sku.creaseSize3 ?? firstItem.sku.creasing_size3)) ??
          firstItem.creasingSize3 ??
          ''
        );
        const pick = (...args) => {
          for (let i = 0; i < args.length; i++) {
            const v = args[i];
            if (v !== undefined && v !== null && v !== '') return v;
          }
          return '';
        };
        const creaseText = (() => {
          const c1 = Number(creasingSize1 || 0);
          const c2 = Number(creasingSize2 || 0);
          const c3 = Number(creasingSize3 || 0);
          if (c1 || c2 || c3 || creasingType) return `${c1}-${c2}-${c3}${creasingType ? ` (${creasingType})` : ''}`;
          const t = pick(
            o.creaseText, o.creaseSize, o.crease_size, o.crease,
            o.pressLine, o.press_line, o.pressLineSize, o.press_line_size,
            (o.sku && (o.sku.creaseText || o.sku.creaseSize || o.sku.crease || o.sku.pressLine || o.sku.press_line || o.sku.pressLineSize || o.sku.press_line_size)),
            (o.product && (o.product.creaseText || o.product.creaseSize || o.product.crease || o.product.pressLine || o.product.press_line || o.product.pressLineSize || o.product.press_line_size)),
            firstItem.creaseText, firstItem.creaseSize, firstItem.crease_size, firstItem.crease,
            firstItem.pressLine, firstItem.press_line, firstItem.pressLineSize, firstItem.press_line_size,
            (firstItem.sku && (firstItem.sku.creaseText || firstItem.sku.creaseSize || firstItem.sku.crease || firstItem.sku.pressLine || firstItem.sku.press_line || firstItem.sku.pressLineSize || firstItem.sku.press_line_size))
          );
          if (t) return String(t || '').trim();
          const scan = (src) => {
            if (!src || typeof src !== 'object') return '';
            const keys = Object.keys(src);
            for (let i = 0; i < keys.length; i++) {
              const k = keys[i];
              const v = src[k];
              if (typeof v === 'string' && /(crease|press|score|scor|压线)/i.test(k) && /\d+/.test(v) && /[-x*×X]/.test(v)) {
                return String(v).trim();
              }
              if (Array.isArray(v) && v.length >= 3) {
                const a1 = Number(v[0]); const a2 = Number(v[1]); const a3 = Number(v[2]);
                if ((Number.isFinite(a1) && a1) || (Number.isFinite(a2) && a2) || (Number.isFinite(a3) && a3)) {
                  return `${Number.isFinite(a1) ? a1 : 0}-${Number.isFinite(a2) ? a2 : 0}-${Number.isFinite(a3) ? a3 : 0}`;
                }
              }
              if (v && typeof v === 'object') {
                const inner = scan(v);
                if (inner) return inner;
              }
            }
            const readNum = (obj, suffix) => {
              const cands = [
                `creasingSize${suffix}`, `creaseSize${suffix}`, `pressLine${suffix}`, `pressLineSize${suffix}`, `press_line${suffix}`, `score${suffix}`, `scoring${suffix}`,
                `creasing_size${suffix}`, `crease_size${suffix}`
              ];
              for (let i = 0; i < cands.length; i++) {
                const val = obj[cands[i]];
                if (val !== undefined && val !== null && val !== '') return Number(val);
              }
              return NaN;
            };
            const n1 = readNum(src, 1);
            const n2 = readNum(src, 2);
            const n3 = readNum(src, 3);
            if ((Number.isFinite(n1) && n1) || (Number.isFinite(n2) && n2) || (Number.isFinite(n3) && n3)) {
              const ty = src.creasingType || src.creaseType || src.creasing_type || src.pressType || src.lineType || src.压线类型 || '';
              return `${Number.isFinite(n1) ? n1 : 0}-${Number.isFinite(n2) ? n2 : 0}-${Number.isFinite(n3) ? n3 : 0}${ty ? ` (${ty})` : ''}`;
            }
            return '';
          };
          return scan(o) || scan(o && o.sku) || scan(o && o.product) || scan(o && o.product && o.product.sku) || scan(firstItem) || scan(firstItem && firstItem.sku) || '';
        })();
        const statusTextMap = { ordered: '已下单', pending: '待生产', producing: '生产中', stocked: '已入库', shipping: '已发货', shipped: '已发货', completed: '已完成', cancelled: '已取消' };
        const materialArrived = !!(o.materialArrived || o.material_status === 'arrived');
        const stockedQty = Number(o.stockedQty || 0);
        const shippedQty = Number(o.shippedQty || 0);
        const inventoryQty = Math.max(0, stockedQty - shippedQty);
        const stockedAtRaw = o.stockedAt || o.stockTime || (o.status === 'stocked' ? (o.updatedAt || o.updateTime) : '');
        const shippedAtRaw = o.shippedAt || o.deliveredAt || (o.status === 'shipped' || o.status === 'shipping' ? (o.updatedAt || o.updateTime) : '');
        const stockedAtText = stockedAtRaw ? (typeof stockedAtRaw === 'number' ? this.formatDate(stockedAtRaw) : (this.formatDate(new Date(stockedAtRaw).getTime()))) : '';
        const shippedAtText = shippedAtRaw ? (typeof shippedAtRaw === 'number' ? this.formatDate(shippedAtRaw) : (this.formatDate(new Date(shippedAtRaw).getTime()))) : '';
        const showShippingInfo = ['stocked', 'warehoused', 'shipping', 'shipped'].includes(String(statusRaw).toLowerCase()) || stockedQty > 0 || shippedQty > 0;
        const statusTextBase = statusTextMap[status] || status;
        const statusText = (status === 'ordered' && materialArrived) ? '已来料' : statusTextBase;
        const bw = pick(
          o.boardWidth, o.board_width, o.paperWidth,
          (o.sku && (o.sku.boardWidth || o.sku.board_width || o.sku.paperWidth)),
          (o.product && (o.product.boardWidth || o.product.board_width || o.product.paperWidth)),
          (o.product && o.product.sku && (o.product.sku.boardWidth || o.product.sku.board_width || o.product.sku.paperWidth)),
          firstItem.boardWidth, firstItem.board_width,
          (firstItem.sku && (firstItem.sku.boardWidth || firstItem.sku.board_width || firstItem.sku.paperWidth))
        )
        const bh = pick(
          o.boardHeight, o.board_height, o.paperLength,
          (o.sku && (o.sku.boardHeight || o.sku.board_height || o.sku.paperLength)),
          (o.product && (o.product.boardHeight || o.product.board_height || o.product.paperLength)),
          (o.product && o.product.sku && (o.product.sku.boardHeight || o.product.sku.board_height || o.product.sku.paperLength)),
          firstItem.boardHeight, firstItem.board_height,
          (firstItem.sku && (firstItem.sku.boardHeight || firstItem.sku.board_height || firstItem.sku.paperLength))
        )
        const boardSizeText = (bw && bh) ? (String(bw) + ' × ' + String(bh) + ' mm') : ''
        const specText =
          o.spec ??
          o.specification ??
          (o.product && o.product.spec) ??
          (firstItem && (firstItem.spec ?? firstItem.specification)) ??
          '';
        const fluteText =
          o.flute ??
          o.fluteType ??
          (o.product && (o.product.flute ?? o.product.fluteType)) ??
          (firstItem && (firstItem.flute ?? firstItem.fluteType)) ??
          '';
        const materialCodeText =
          o.materialCode ??
          o.material_code ??
          (o.product && (o.product.materialCode ?? o.product.material_code)) ??
          (firstItem && (firstItem.materialCode ?? firstItem.material_code)) ??
          '';
        const info = {
          orderNo,
          customer: { name: customerName, contact: customerContact, phone: '' },
          goodsName: (() => {
            return o.goodsName || o.productTitle || firstItem.goodsName || firstItem.title || firstItem.productName || o.goods_name || o.title || ''
          })(),
          product: {
            name: productName,
            title: o.productTitle || (o.product && o.product.title) || '',
            spec: specText || '',
            flute: fluteText || '',
            materialCode: materialCodeText || '',
            materialNo: o.materialNo || (o.product && o.product.materialNo) || firstItem.materialNo || '',
            boardWidth: bw || '',
            boardHeight: bh || '',
            boardSizeText: boardSizeText || '',
            creasing: creasingType,
            creasingType,
            creaseText,
            creasingSize1,
            creasingSize2,
            creasingSize3,
            quantity: qty,
            sheetCount,
            unit: o.unit || firstItem.unit || (o.product && o.product.unit) || '件',
            unitPrice,
            rawUnitPrice: hasRawUnitPrice ? (rawUnitPriceNum * (factor > 0 ? factor : 1)).toFixed(4) : '—'
          },
          amount: { total: totalAmount, deposit: deposit, balance: totalAmount - deposit, grossProfit: grossProfitNum !== undefined && Number.isFinite(grossProfitNum) ? grossProfitNum.toFixed(2) : '—' },
          createdAt: typeof createdAt === 'number' ? this.formatDate(createdAt) : createdAt,
          deadline: deadline || '',
          priority: 'normal',
          priorityText: '普通',
          status: status,
          statusText,
          notes: o.notes || '',
          attachments: Array.isArray(o.attachments) ? o.attachments.map(a => ({
            id: a.id || a.fileID || a.name || `${Date.now()}`,
            name: a.name || '图纸',
            type: a.type || 'drawing',
            fileID: a.fileID,
            url: a.url
          })) : [],
          joinMethod: o.joinMethod || '',
          items: Array.isArray(o.items) ? o.items : [],
          qrCodeUrl: o.qrCodeUrl || this.makeQrUrl(o._id || this.data.orderId || orderId, o.orderNo || o.orderNumber || orderNo)
        };
        this.setData({
          orderInfo: info,
          orderId: o._id || o.id || this.data.orderId || orderId || '',
          qrCodeUrl: info.qrCodeUrl || '',
          isLoading: false,
          shippingInfo: {
            stockedQty,
            shippedQty,
            inventoryQty,
            stockedAtText,
            shippedAtText
          },
          showShippingInfo
        });
        const tryFetchSkuCrease = async (raw) => {
          const cid = (raw && (raw.customerId || (raw.customer && (raw.customer._id || raw.customer.id)))) || '';
          const gname = info.goodsName || '';
          if (!cid || !gname) return;
          try {
            const r = await wx.cloud.callFunction({
              name: 'api-bridge',
              data: {
                httpMethod: 'GET',
                path: `/customers/${cid}/skus`,
                queryStringParameters: { keyword: gname, pageSize: 50 }
              }
            });
            const payload = r && r.result ? (r.result.data || r.result) : null;
            const skus = (payload && Array.isArray(payload.skus)) ? payload.skus : (Array.isArray(payload) ? payload : []);
            if (!skus || !skus.length) return;
            const hit = skus.find(it => String(it && (it.name || it.goodsName || it.productName) || '').trim() === gname) || skus[0];
            if (!hit) return;
            const v1 = Number(hit.creasingSize1 || hit.creaseSize1 || hit.creasing_size1 || 0);
            const v2 = Number(hit.creasingSize2 || hit.creaseSize2 || hit.creasing_size2 || 0);
            const v3 = Number(hit.creasingSize3 || hit.creaseSize3 || hit.creasing_size3 || 0);
            const ty = hit.creasingType || hit.creaseType || hit.creasing_type || '';
            const txt = (v1 || v2 || v3) ? `${v1 || 0}-${v2 || 0}-${v3 || 0}${ty ? ` (${ty})` : ''}` : String(hit.creaseText || hit.crease || '').trim();
            if (txt && !info.product.creaseText) {
              this.setData({ 'orderInfo.product.creaseText': txt });
            }
          } catch (_) {}
        };
        if (!info.product.creaseText) await tryFetchSkuCrease(o);
      }
    } catch (err) {
      console.error('订单详情加载失败:', err);
      wx.showToast({ title: '订单加载失败：' + (err.message || '未知错误'), icon: 'none' });
      this.setData({
        isLoading: false,
        'orderInfo.notes': '加载失败：' + (err.message || '未知错误')
      });
    } finally {
      wx.hideLoading();
    }
  },

  makeQrUrl: function (orderId, orderNo) {
    const id = String(orderId || '').trim();
    const no = String(orderNo || '').trim();
    if (!id && !no) return '';
    const payload = JSON.stringify({ v: 1, orderId: id, orderNo: no, subOrderId: id, subOrderNo: no });
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}`;
  },

  onDownloadAttachment: async function (e) {
    const fileID = e.currentTarget.dataset.fileid;
    const url = e.currentTarget.dataset.url;
    const name = e.currentTarget.dataset.name || '附件';
    const getExt = (n, u) => {
      const s = String(n || u || '').toLowerCase();
      const q = s.split('?')[0];
      const parts = q.split('.');
      return parts.length > 1 ? parts.pop() : '';
    };
    const openPdf = async (link) => {
      return new Promise((resolve) => {
        wx.downloadFile({
          url: link, success: (res) => {
            const fp = res.tempFilePath;
            wx.openDocument({ filePath: fp, showMenu: true, fileType: 'pdf', success: () => resolve(true), fail: () => resolve(false) });
          }, fail: () => resolve(false)
        });
      });
    };
    try {
      if (fileID) {
        const r = await wx.cloud.getTempFileURL({ fileList: [fileID] });
        const tempUrl = r && r.fileList && r.fileList[0] && r.fileList[0].tempFileURL;
        if (tempUrl) {
          const ext = getExt(name, tempUrl);
          if (ext === 'pdf') {
            const ok = await openPdf(tempUrl);
            if (!ok) wx.showToast({ title: 'PDF预览失败', icon: 'none' });
          } else {
            wx.previewImage({ urls: [tempUrl] });
          }
          return;
        }
      }
      if (url) {
        const ext = getExt(name, url);
        if (ext === 'pdf') {
          const ok = await openPdf(url);
          if (!ok) wx.showToast({ title: 'PDF预览失败', icon: 'none' });
        } else {
          wx.previewImage({ urls: [url] });
        }
        return;
      }
      wx.showToast({ title: '无法预览附件', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: '预览失败', icon: 'none' });
    }
  },

  // 状态样式
  getStatusClass: function (status) {
    const statusMap = {
      'pending': 'status-pending',
      'processing': 'status-processing',
      'completed': 'status-completed',
      'cancelled': 'status-cancelled'
    };
    return statusMap[status] || 'status-pending';
  },

  // 优先级样式
  getPriorityClass: function (priority) {
    const priorityMap = {
      'urgent': 'priority-urgent',
      'normal': 'priority-normal',
      'low': 'priority-low'
    };
    return priorityMap[priority] || 'priority-normal';
  },

  // 查看附件
  viewAttachment: function (e) {
    const attachment = e.currentTarget.dataset.attachment;
    console.log('查看附件:', attachment);

    wx.showModal({
      title: attachment.name,
      content: '文件查看功能正在开发中',
      showCancel: false
    });
  },

  // 联系客户
  contactCustomer: function () {
    const customer = this.data.orderInfo.customer;
    wx.showModal({
      title: '联系客户',
      content: `${customer.name}\n联系人：${customer.contact}\n电话：${customer.phone}`,
      confirmText: '拨打电话',
      success: (res) => {
        if (res.confirm) {
          wx.makePhoneCall({
            phoneNumber: customer.phone,
            fail: () => {
              wx.showToast({
                title: '拨打电话失败',
                icon: 'none'
              });
            }
          });
        }
      }
    });
  },

  // 修改订单
  onEditOrder: function () {
    const id = this.data.orderId || this.data.orderInfo.orderNo;
    if (!id) {
      wx.showToast({ title: '无法获取订单ID', icon: 'none' });
      return;
    }
    const key = `edit_order_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      wx.setStorageSync(key, this.data.orderInfo);
      wx.navigateTo({ url: `/pages/order-sub/create/create?orderId=${id}&orderKey=${encodeURIComponent(key)}` });
    } catch (_) {
      wx.navigateTo({ url: `/pages/order-sub/create/create?orderId=${id}` });
    }
  },

  onDeleteOrder: function () { this.deleteOrder(); },

  // 删除订单
  deleteOrder: function () {
    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个订单吗？删除后无法恢复。',
      success: async (res) => {
        if (res.confirm) {
          try {
            wx.showLoading({ title: '删除中...' });
            const id = this.data.orderId || this.data.orderInfo.orderNo;
            const r = await wx.cloud.callFunction({ name: 'erp-api', data: { action: 'deleteOrder', data: { id } } });
            if (!(r && r.result && r.result.success)) {
              const db = wx.cloud.database();
              let docId = id;
              // 先尝试按文档ID删除
              let removed = false;
              try {
                await db.collection('orders').doc(docId).remove();
                removed = true;
              } catch (_) { }
              if (!removed) {
                // 按订单号或兼容字段查询删除
                const q = await db.collection('orders')
                  .where(db.command.or([
                    { orderNo: id },
                    { orderNumber: id }
                  ]))
                  .limit(1)
                  .get();
                docId = q.data && q.data.length ? q.data[0]._id : docId;
                await db.collection('orders').doc(docId).remove();
              }
            }
            try { wx.setStorageSync('orders_force_refresh', Date.now()); } catch (_) { }
            wx.hideLoading();
            wx.showToast({ title: '删除成功', icon: 'success' });
            setTimeout(() => { wx.navigateBack(); }, 1000);
          } catch (e) {
            wx.hideLoading();
            wx.showToast({ title: '删除失败', icon: 'none' });
          }
        }
      }
    });
  },

  // 返回
  goBack: function () {
    wx.navigateBack();
  }
});
