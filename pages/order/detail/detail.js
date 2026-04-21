const { formatDate: fmtDate } = require('../../../utils/app.js')
const { getData } = require('../../../utils/data-sync-utils.js')

Page({
  data: {
    loading: false,
    loadError: '',
    orderId: '',
    orderNo: '',
    fromScan: false,
    orderStatusKey: 'pending',
    orderInfo: {
      orderNo: '',
      customer: { name: '', contact: '', phone: '' },
      product: { name: '', title: '', spec: '', flute: '', materialCode: '', materialNo: '', boardWidth: '', boardHeight: '', creasing: '', creasingSize1: '', creasingSize2: '', creasingSize3: '', quantity: 0, unit: '件', unitPrice: 0 },
      amount: { total: 0, deposit: 0, balance: 0 },
      createdAt: '',
      deadline: '',
      status: 'ordered',
      statusText: '已下单',
      notes: '',
      attachments: [],
      joinMethod: ''
    },
    shippingInfo: { stockedQty: 0, shippedQty: 0, inventoryQty: 0, stockedAtText: '', shippedAtText: '' },
    showShippingInfo: false
  },

  onLoad: function(options) {
    const optOrderId = options && (options.orderId || options.id) ? decodeURIComponent(options.orderId || options.id) : ''
    const optOrderNo = options && (options.orderNo || options.no) ? decodeURIComponent(options.orderNo || options.no) : ''
    const fromScan = !!(options && String(options.from || '').toLowerCase() === 'scan')
    this.setData({ orderId: optOrderId, orderNo: optOrderNo, fromScan })
    this.loadByRoute(optOrderId, optOrderNo)
  },

  onShow: function() {
    const now = Date.now()
    if (this._lastAutoRefreshAt && now - this._lastAutoRefreshAt < 1500) return
    this._lastAutoRefreshAt = now
    this.loadByRoute(this.data.orderId, this.data.orderNo)
  },

  onPullDownRefresh: function() {
    this.loadByRoute(this.data.orderId, this.data.orderNo).finally(() => wx.stopPullDownRefresh())
  },

  formatDate: function(ts) {
    return fmtDate(ts, 'YYYY-MM-DD HH:mm')
  },

  loadByRoute: function(orderId, orderNo) {
    if (this.data.loading) return Promise.resolve(null)
    this.setData({ loading: true, loadError: '' })
    return this.fetchOrder(orderId, orderNo)
      .then((order) => {
        if (!order) {
          this.setData({ loadError: '未找到订单数据' })
          return null
        }
        const fixedId = order && (order._id || order.id) ? (order._id || order.id) : orderId
        const fixedNo = order && (order.orderNo || order.orderNumber) ? (order.orderNo || order.orderNumber) : orderNo
        this.setData({ orderId: fixedId || this.data.orderId, orderNo: fixedNo || this.data.orderNo })
        this.applyOrder(order)
        return order
      })
      .catch(() => {
        this.setData({ loadError: '加载失败，请下拉刷新重试' })
        return null
      })
      .finally(() => {
        this.setData({ loading: false })
      })
  },

  fetchOrder: function(orderId, orderNo) {
    return getData('orders', false)
      .then((orders) => {
        const list = Array.isArray(orders) ? orders : []
        let order = null
        if (orderId) order = list.find((o) => o && (o._id === orderId || o.id === orderId)) || null
        if (!order && orderNo) order = list.find((o) => o && (o.orderNo === orderNo || o.orderNumber === orderNo)) || null
        return order
      })
      .then((order) => {
        if (order) return order
        return this.fetchOrderRemote(orderId, orderNo)
      })
  },

  fetchOrderRemote: async function(orderId, orderNo) {
    if (orderId) {
      try {
        const res = await wx.cloud.callFunction({ name: 'erp-api', data: { action: 'getOrderDetail', data: { id: orderId } } })
        const data = res && res.result && res.result.data ? res.result.data : null
        if (data) return data
      } catch (_) {}
    }

    const no = String(orderNo || '').trim()
    if (!no) return null

    try {
      const db = wx.cloud.database()
      const _ = db.command
      const q = await db.collection('orders').where(_.or([{ orderNo: no }, { orderNumber: no }])).limit(1).get()
      const hit = q && q.data && q.data.length ? q.data[0] : null
      if (!hit) return null
      const id = hit._id || hit.id || ''
      if (id) {
        try {
          const res2 = await wx.cloud.callFunction({ name: 'erp-api', data: { action: 'getOrderDetail', data: { id } } })
          const data2 = res2 && res2.result && res2.result.data ? res2.result.data : null
          if (data2) return data2
        } catch (_) {}
      }
      return hit
    } catch (_) {
      return null
    }
  },

  applyOrder: function(o) {
    const firstItem = Array.isArray(o.items) && o.items.length ? o.items[0] : {}
    const qty = Array.isArray(o.items) ? o.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0) : (Number(o.quantity) || 0)
    const unitPrice = Number(firstItem.unitPrice || o.unitPrice || 0)
    const total = Number(o.totalAmount || o.amount || o.finalAmount || (qty * unitPrice) || 0)
    const deposit = Number(o.deposit || 0)
    const statusRaw = String(o.status || 'ordered').toLowerCase()
    const statusKeyMap = { ordered: 'pending', producing: 'processing', in_production: 'processing', shipping: 'shipped' }
    const orderStatusKey = statusKeyMap[statusRaw] || statusRaw
    const statusTextMap = { ordered: '已下单', pending: '待生产', processing: '生产中', producing: '生产中', stocked: '已入库', shipping: '已发货', shipped: '已发货', completed: '已完成', cancelled: '已取消' }
    const createdAtRaw = o.createdAt || o.createTime || o.created_at || ''
    const createdAtTs = createdAtRaw ? (typeof createdAtRaw === 'number' ? createdAtRaw : (Date.parse(createdAtRaw) || 0)) : 0
    const deadlineRaw = o.deliveryDate || o.deadline || ''
    const deadlineText = deadlineRaw ? (typeof deadlineRaw === 'number' ? fmtDate(deadlineRaw, 'YYYY-MM-DD') : String(deadlineRaw)) : ''

    const stockedQty = Number(o.stockedQty || 0)
    const shippedQty = Number(o.shippedQty || 0)
    const inventoryQty = Math.max(0, stockedQty - shippedQty)
    const stockedAtRaw = o.stockedAt || o.warehouseAt || o.stockTime || ''
    const shippedAtRaw = o.shippedAt || o.deliveredAt || ''
    const toText = (v) => {
      if (!v) return ''
      const ts = typeof v === 'number' ? v : (Date.parse(v) || 0)
      return ts ? this.formatDate(ts) : String(v)
    }
    const showShippingInfo = ['stocked', 'warehouse', 'warehoused', 'shipping', 'shipped'].includes(statusRaw) || stockedQty > 0 || shippedQty > 0

    const attachmentsRaw = Array.isArray(o.attachments) ? o.attachments : []
    const attachments = attachmentsRaw
      .map((a, idx) => {
        if (!a) return null
        if (typeof a === 'string') return { id: `${idx}-${a}`, name: `附件${idx + 1}`, fileID: a, url: '' }
        return {
          id: a.id || a.fileID || a.fileId || a.url || a.name || String(idx),
          name: a.name || a.filename || a.fileName || '附件',
          fileID: a.fileID || a.fileId || a.cloudId || '',
          url: a.url || a.tempFileURL || a.tempFileUrl || ''
        }
      })
      .filter(Boolean)

    const pick = (...args) => {
      for (let i = 0; i < args.length; i++) {
        const v = args[i]
        if (v !== undefined && v !== null && v !== '') return v
      }
      return ''
    }
    const bw = pick(
      o.boardWidth, o.board_width, o.paperWidth,
      (o.product && (o.product.boardWidth || o.product.board_width || o.product.paperWidth)),
      (o.sku && (o.sku.boardWidth || o.sku.board_width || o.sku.paperWidth)),
      (o.product && o.product.sku && (o.product.sku.boardWidth || o.product.sku.board_width || o.product.sku.paperWidth)),
      firstItem.boardWidth, firstItem.board_width,
      (firstItem.sku && (firstItem.sku.boardWidth || firstItem.sku.board_width || firstItem.sku.paperWidth))
    )
    const bh = pick(
      o.boardHeight, o.board_height, o.paperLength,
      (o.product && (o.product.boardHeight || o.product.board_height || o.product.paperLength)),
      (o.sku && (o.sku.boardHeight || o.sku.board_height || o.sku.paperLength)),
      (o.product && o.product.sku && (o.product.sku.boardHeight || o.product.sku.board_height || o.product.sku.paperLength)),
      firstItem.boardHeight, firstItem.board_height,
      (firstItem.sku && (firstItem.sku.boardHeight || firstItem.sku.board_height || firstItem.sku.paperLength))
    )
    const boardSizeText = (bw && bh) ? (String(bw) + ' × ' + String(bh) + ' mm') : ''
    const c1 = pick(
      o.creasingSize1, o.creaseSize1, o.creasing_size1,
      (o.sku && (o.sku.creasingSize1 || o.sku.creaseSize1 || o.sku.creasing_size1)),
      (o.product && o.product.sku && (o.product.sku.creasingSize1 || o.product.sku.creaseSize1 || o.product.sku.creasing_size1)),
      (o.product && (o.product.creasingSize1 || o.product.creaseSize1 || o.product.creasing_size1)),
      firstItem.creasingSize1, firstItem.creaseSize1, firstItem.creasing_size1
    )
    const c2 = pick(
      o.creasingSize2, o.creaseSize2, o.creasing_size2,
      (o.sku && (o.sku.creasingSize2 || o.sku.creaseSize2 || o.sku.creasing_size2)),
      (o.product && o.product.sku && (o.product.sku.creasingSize2 || o.product.sku.creaseSize2 || o.product.sku.creasing_size2)),
      (o.product && (o.product.creasingSize2 || o.product.creaseSize2 || o.product.creasing_size2)),
      firstItem.creasingSize2, firstItem.creaseSize2, firstItem.creasing_size2
    )
    const c3 = pick(
      o.creasingSize3, o.creaseSize3, o.creasing_size3,
      (o.sku && (o.sku.creasingSize3 || o.sku.creaseSize3 || o.sku.creasing_size3)),
      (o.product && o.product.sku && (o.product.sku.creasingSize3 || o.product.sku.creaseSize3 || o.product.sku.creasing_size3)),
      (o.product && (o.product.creasingSize3 || o.product.creaseSize3 || o.product.creasing_size3)),
      firstItem.creasingSize3, firstItem.creaseSize3, firstItem.creasing_size3
    )
    const creaseType = pick(
      o.creasingType, o.creaseType, o.creasing_type,
      (o.sku && (o.sku.creasingType || o.sku.creaseType || o.sku.creasing_type)),
      (o.product && (o.product.creasingType || o.product.creaseType || o.product.creasing_type)),
      (o.product && o.product.sku && (o.product.sku.creasingType || o.product.sku.creaseType || o.product.sku.creasing_type)),
      firstItem.creasingType, firstItem.creaseType, firstItem.creasing_type,
      (firstItem.sku && (firstItem.sku.creasingType || firstItem.sku.creaseType || firstItem.sku.creasing_type))
    )
    const creaseText = (() => {
      const t = pick(
        o.creaseText, o.creaseSize, o.crease_size, o.crease,
        o.pressLine, o.press_line, o.pressLineSize, o.press_line_size,
        (o.sku && (o.sku.creaseText || o.sku.creaseSize || o.sku.crease || o.sku.pressLine || o.sku.press_line || o.sku.pressLineSize || o.sku.press_line_size)),
        firstItem.creaseText, firstItem.creaseSize, firstItem.crease_size, firstItem.crease,
        firstItem.pressLine, firstItem.press_line, firstItem.pressLineSize, firstItem.press_line_size,
        (firstItem.sku && (firstItem.sku.creaseText || firstItem.sku.creaseSize || firstItem.sku.crease || firstItem.sku.pressLine || firstItem.sku.press_line || firstItem.sku.pressLineSize || firstItem.sku.press_line_size)),
        (o.product && (o.product.creaseText || o.product.creaseSize || o.product.crease || o.product.pressLine || o.product.press_line || o.product.pressLineSize || o.product.press_line_size))
      )
      if (t) return String(t).trim()
      const scan = (src) => {
        if (!src || typeof src !== 'object') return ''
        const keys = Object.keys(src)
        for (let i = 0; i < keys.length; i++) {
          const k = keys[i]
          const v = src[k]
          if (typeof v === 'string' && /(crease|press|score|scor|压线)/i.test(k) && /\d+/.test(v) && /[-x*×X]/.test(v)) return String(v).trim()
          if (Array.isArray(v) && v.length >= 3) {
            const n1 = Number(v[0]); const n2 = Number(v[1]); const n3 = Number(v[2])
            if ((Number.isFinite(n1) && n1) || (Number.isFinite(n2) && n2) || (Number.isFinite(n3) && n3)) return `${Number.isFinite(n1) ? n1 : 0}-${Number.isFinite(n2) ? n2 : 0}-${Number.isFinite(n3) ? n3 : 0}`
          }
          if (v && typeof v === 'object') {
            const inner = scan(v)
            if (inner) return inner
          }
        }
        const readNum = (obj, suffix) => {
          const cands = [`creasingSize${suffix}`, `creaseSize${suffix}`, `pressLine${suffix}`, `pressLineSize${suffix}`, `score${suffix}`, `scoring${suffix}`, `creasing_size${suffix}`, `crease_size${suffix}`, `press_line${suffix}`]
          for (let i = 0; i < cands.length; i++) {
            const val = obj[cands[i]]
            if (val !== undefined && val !== null && val !== '') return Number(val)
          }
          return NaN
        }
        const n1 = readNum(src, 1)
        const n2 = readNum(src, 2)
        const n3 = readNum(src, 3)
        if ((Number.isFinite(n1) && n1) || (Number.isFinite(n2) && n2) || (Number.isFinite(n3) && n3)) {
          const ty = src.creasingType || src.creaseType || src.creasing_type || src.pressType || src.lineType || src.压线类型 || ''
          const txt = `${Number.isFinite(n1) ? n1 : 0}-${Number.isFinite(n2) ? n2 : 0}-${Number.isFinite(n3) ? n3 : 0}${ty ? ` (${ty})` : ''}`
          return txt
        }
        return ''
      }
      const g = scan(o) || scan(o && o.sku) || scan(o && o.product) || scan(o && o.product && o.product.sku) || scan(firstItem) || scan(firstItem && firstItem.sku)
      if (g) return g
      if (c1 || c2 || c3) return `${c1 || 0}-${c2 || 0}-${c3 || 0}${creaseType ? ` (${creaseType})` : ''}`
      return ''
    })()
    const info = {
      orderNo: o.orderNo || o.orderNumber || '',
      customer: {
        name: o.customerName || (o.customer && (o.customer.name || o.customer.companyName)) || '',
        contact: o.contactName || o.customerContact || (o.customer && (o.customer.contact || o.customer.contactName)) || o.contact || '',
        phone: o.phone || (o.customer && o.customer.phone) || ''
      },
      product: {
        name: o.productName || (o.product && o.product.name) || '',
        title: o.goodsName || o.productTitle || firstItem.goodsName || firstItem.title || firstItem.productName || '',
        spec: firstItem.spec || o.spec || '',
        flute: o.flute || firstItem.flute || '',
        materialCode: o.materialCode || firstItem.materialCode || '',
        materialNo: o.materialNo || firstItem.materialNo || '',
        boardWidth: bw || '',
        boardHeight: bh || '',
        boardSizeText: boardSizeText || '',
        creasing: creaseType || '',
        creasingSize1: c1 || '',
        creasingSize2: c2 || '',
        creasingSize3: c3 || '',
        creaseText: creaseText || '',
        quantity: qty,
        unit: firstItem.unit || o.unit || '件',
        unitPrice
      },
      amount: { total, deposit, balance: Math.max(0, total - deposit) },
      createdAt: createdAtTs ? this.formatDate(createdAtTs) : (createdAtRaw ? String(createdAtRaw) : ''),
      deadline: deadlineText,
      status: statusRaw,
      statusText: statusTextMap[statusRaw] || statusRaw,
      notes: o.notes || '',
      attachments,
      joinMethod: o.joinMethod || firstItem.joinMethod || ''
    }

    this.setData({
      orderInfo: info,
      orderStatusKey,
      shippingInfo: {
        stockedQty,
        shippedQty,
        inventoryQty,
        stockedAtText: toText(stockedAtRaw),
        shippedAtText: toText(shippedAtRaw)
      },
      showShippingInfo
    })
    const tryFetchSkuCrease = async (raw) => {
      const customerId = (raw && (raw.customerId || (raw.customer && (raw.customer._id || raw.customer.id)))) || ''
      const goodsName = (firstItem.goodsName || firstItem.title || firstItem.productName || raw.goodsName || raw.productTitle || raw.title || '') || ''
      if (!customerId || (!goodsName && !(raw && raw.materialNo))) return
      try {
        const r = await wx.cloud.callFunction({
          name: 'api-bridge',
          data: {
            httpMethod: 'GET',
            path: `/customers/${customerId}/skus`,
            queryStringParameters: { keyword: goodsName || '', pageSize: 50 }
          }
        })
        const payload = r && r.result ? (r.result.data || r.result) : null
        const skus = (payload && Array.isArray(payload.skus)) ? payload.skus : (Array.isArray(payload) ? payload : [])
        if (!skus || !skus.length) return
        const match = skus.find(it => {
          const name = String(it && (it.name || it.goodsName || it.productName) || '').trim()
          return name && goodsName && name === goodsName
        }) || skus[0]
        if (!match) return
        const v1 = Number(match.creasingSize1 || match.creaseSize1 || match.creasing_size1 || 0)
        const v2 = Number(match.creasingSize2 || match.creaseSize2 || match.creasing_size2 || 0)
        const v3 = Number(match.creasingSize3 || match.creaseSize3 || match.creasing_size3 || 0)
        const ty = match.creasingType || match.creaseType || match.creasing_type || ''
        const txt = (v1 || v2 || v3) ? `${v1 || 0}-${v2 || 0}-${v3 || 0}${ty ? ` (${ty})` : ''}` : String(match.creaseText || match.crease || '').trim()
        if (txt) {
          this.setData({ 'orderInfo.product.creaseText': txt })
        }
      } catch (_) {}
    }
    if (!info.product.creaseText) tryFetchSkuCrease(o)
  },

  onCopyOrderNo: function() {
    const orderNo = (this.data.orderInfo && this.data.orderInfo.orderNo) || this.data.orderNo || ''
    if (!orderNo) return
    wx.setClipboardData({ data: orderNo })
  },

  onDownloadAttachment: async function(e) {
    const ds = e.currentTarget.dataset || {}
    const fileID = ds.fileid || ''
    const url = ds.url || ''
    const name = ds.name || '附件'

    const getExt = (n, u) => {
      const s = String(n || u || '').toLowerCase()
      const q = s.split('?')[0]
      const parts = q.split('.')
      return parts.length > 1 ? parts.pop() : ''
    }

    const openDoc = async (link, fileType) => {
      return new Promise((resolve) => {
        wx.downloadFile({
          url: link,
          success: (res) => {
            const fp = res.tempFilePath
            wx.openDocument({ filePath: fp, showMenu: true, fileType, success: () => resolve(true), fail: () => resolve(false) })
          },
          fail: () => resolve(false)
        })
      })
    }

    try {
      let link = ''
      if (fileID) {
        const r = await wx.cloud.getTempFileURL({ fileList: [fileID] })
        link = r && r.fileList && r.fileList[0] && r.fileList[0].tempFileURL ? r.fileList[0].tempFileURL : ''
      }
      if (!link && url) link = url
      if (!link) {
        wx.showToast({ title: '无法预览附件', icon: 'none' })
        return
      }
      const ext = getExt(name, link)
      if (ext === 'pdf') {
        const ok = await openDoc(link, 'pdf')
        if (!ok) wx.showToast({ title: 'PDF预览失败', icon: 'none' })
        return
      }
      if (['doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx'].includes(ext)) {
        const ok = await openDoc(link, ext)
        if (!ok) wx.showToast({ title: '文件预览失败', icon: 'none' })
        return
      }
      wx.previewImage({ urls: [link] })
    } catch (_) {
      wx.showToast({ title: '预览失败', icon: 'none' })
    }
  },

  onDeleteOrder: function() {
    const id = this.data.orderId || ''
    const orderNo = this.data.orderNo || (this.data.orderInfo && this.data.orderInfo.orderNo) || ''
    if (!id && !orderNo) return

    wx.showModal({
      title: '确认删除',
      content: '确定要删除这个订单吗？删除后无法恢复。',
      confirmText: '删除',
      confirmColor: '#dc2626',
      success: async (res) => {
        if (!res.confirm) return
        wx.showLoading({ title: '删除中...', mask: true })
        try {
          let finalId = id
          if (!finalId && orderNo) {
            const db = wx.cloud.database()
            const _ = db.command
            const q = await db.collection('orders').where(_.or([{ orderNo }, { orderNumber: orderNo }])).limit(1).get()
            const hit = q && q.data && q.data.length ? q.data[0] : null
            finalId = hit && hit._id ? hit._id : ''
          }
          if (!finalId) throw new Error('未找到订单ID')
          const r = await wx.cloud.callFunction({ name: 'erp-api', data: { action: 'deleteOrder', data: { id: finalId } } })
          if (!(r && r.result && r.result.success)) throw new Error((r && r.result && r.result.message) || '删除失败')
          try { wx.setStorageSync('orders_force_refresh', Date.now()) } catch (_) {}
          wx.hideLoading()
          wx.showToast({ title: '删除成功', icon: 'success' })
          setTimeout(() => { wx.navigateBack() }, 800)
        } catch (e) {
          wx.hideLoading()
          wx.showToast({ title: e && e.message ? e.message : '删除失败', icon: 'none' })
        }
      }
    })
  },

  onEditOrder: function() {
    wx.showToast({ title: '编辑功能开发中', icon: 'none' })
  },

  onReorder: function() {
    wx.showToast({ title: '再次下单功能开发中', icon: 'none' })
  },

  onPrintWorkOrder: function() {
    if (this.data.loading) {
      wx.showToast({ title: '订单加载中', icon: 'none' })
      return
    }
    const info = this.data.orderInfo || {}
    const orderNo = info.orderNo || this.data.orderNo || ''
    if (!orderNo) {
      wx.showToast({ title: '缺少订单号，无法打印', icon: 'none' })
      return
    }
    const customer = info.customer || {}
    const product = info.product || {}
    const order = {
      _id: this.data.orderId || '',
      id: this.data.orderId || '',
      orderNo,
      customerName: customer.name || '',
      productName: product.name || '',
      spec: product.spec || '',
      boardWidth: product.boardWidth || '',
      boardHeight: product.boardHeight || '',
      creasingSize1: product.creasingSize1 || '',
      creasingSize2: product.creasingSize2 || '',
      creasingSize3: product.creasingSize3 || '',
      creasingType: product.creasing || '',
      quantity: Number(product.quantity || 0),
      materialCode: product.materialCode || '',
      flute: product.flute || '',
      materialNo: product.materialNo || '',
      goodsName: product.title || '',
      joinMethod: info.joinMethod || '',
      notes: info.notes || ''
    }
    const key = `print_orders_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    try {
      wx.setStorageSync(key, [order])
    } catch (_) {
      wx.showToast({ title: '缓存失败，无法打印', icon: 'none' })
      return
    }
    wx.navigateTo({ url: `/pages/production-sub/workorder-print/workorder-print?key=${encodeURIComponent(key)}` })
  },

  goBack: function() {
    wx.navigateBack()
  }
})
