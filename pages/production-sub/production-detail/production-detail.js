// 生产详情页 - 修复版
Page({
  data: {
    orderInfo: {
      orderNo: '',
      productName: '',
      spec: '',
      totalQty: 0,
      producedQty: 0,
      status: '',
      statusText: '',
      customer: '',
      boxType: '',
      cuttingSize: '',
      paperSupplier: '',
      materialCode: '',
      fluteType: '',
      paperSize: '',
      creaseSize: '',
      printDrawing: '',
      bondingMethod: '',
      orderNote: '',
      urgent: false,
      startTime: '',
      expectedTime: ''
    },
    processList: [],
    progress: 0,
    operationRecords: [],
    showQcModal: false,
    currentQcProcess: '',
    qcProducedQty: ''
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
          if (short && full) map[short] = full;
          if (full) map[full] = full;
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

  refreshCustomerName: function() {
    const current = this.data.orderInfo && this.data.orderInfo.customer ? String(this.data.orderInfo.customer) : '';
    if (!current) return;
    this.ensureCustomerNameMap().then(() => {
      const full = this.mapCustomerFullName(current);
      if (full && full !== current) this.setData({ 'orderInfo.customer': full });
    });
  },

  onLoad: function(options) {
    wx.setNavigationBarTitle({ title: '生产详情' });
    const workOrderDataStr = options.workOrderData || '';
    if (workOrderDataStr) {
      try {
        const workOrder = JSON.parse(decodeURIComponent(workOrderDataStr));
        const info = {
          ...this.data.orderInfo,
          orderNo: workOrder.orderNo || this.data.orderInfo.orderNo,
          productName: workOrder.productName || this.data.orderInfo.productName,
          spec: workOrder.spec || this.data.orderInfo.spec,
          totalQty: workOrder.totalQty || workOrder.quantity || this.data.orderInfo.totalQty,
          producedQty: workOrder.producedQty || this.data.orderInfo.producedQty,
          status: workOrder.status || this.data.orderInfo.status,
          statusText: this.getStatusText(workOrder.status || this.data.orderInfo.status),
          customer: workOrder.customer || this.data.orderInfo.customer,
          materialCode: workOrder.materialCode || this.data.orderInfo.materialCode,
          fluteType: workOrder.fluteType || this.data.orderInfo.fluteType,
          paperSize: workOrder.paperSize || this.data.orderInfo.paperSize,
          creaseText: workOrder.creaseText || workOrder.creaseSize || this.data.orderInfo.creaseText,
          creaseSize: workOrder.creaseText || workOrder.creaseSize || this.data.orderInfo.creaseSize,
          bondingMethod: workOrder.bondingMethod || workOrder.joinMethod || this.data.orderInfo.bondingMethod,
          orderNote: workOrder.orderNote || workOrder.notes || this.data.orderInfo.orderNote,
          printDrawing: (Array.isArray(workOrder.attachments) && workOrder.attachments.length && (workOrder.attachments[0].url || workOrder.attachments[0].fileID)) ? (workOrder.attachments[0].url || workOrder.attachments[0].fileID) : this.data.orderInfo.printDrawing,
          attachments: Array.isArray(workOrder.attachments) ? workOrder.attachments : []
        };
        this.setData({ orderInfo: info });
        this.refreshCustomerName();
        return;
      } catch (_) {}
    }
    const id = options.orderId || options.id || '';
    const orderNo = options.orderNo || '';
    if (id) {
      this.loadOrderDetail(id);
    } else if (orderNo) {
      this.loadOrderDetailByOrderNo(orderNo);
    }
  },

  loadOrderDetail: async function(orderId) {
    wx.showLoading({ title: '加载中...' });
    try {
      const res = await wx.cloud.callFunction({ name: 'erp-api', data: { action: 'getOrderDetail', data: { id: orderId } } });
      const o = res && res.result && res.result.data ? res.result.data : null;
      if (o) {
        const orderNo = o.orderNo || o.orderNumber || orderId;
        const totalQty = Number(o.totalQty || o.quantity || (Array.isArray(o.items) ? o.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0) : 0)) || 0;
        const items = Array.isArray(o.items) ? o.items : [];
        const first = items[0] || {};
        const bw = first.boardWidth || o.boardWidth || o.paperWidth || o.boardW || '';
        const bh = first.boardHeight || o.boardHeight || o.paperLength || o.boardH || '';
        const paperSize = o.paperSize || ((bw || bh) ? `${bw}×${bh}` : '');
        const c1 = o.creasingSize1 || first.creasingSize1 || 0;
        const c2 = o.creasingSize2 || first.creasingSize2 || 0;
        const c3 = o.creasingSize3 || first.creasingSize3 || 0;
        const crease = o.creaseText || o.creaseSize || ((c1 || c2 || c3) ? `${c1}-${c2}-${c3}` : (o.creasingType || ''));
        const info = {
          ...this.data.orderInfo,
          orderNo,
          totalQty,
          status: o.status || this.data.orderInfo.status,
          statusText: this.getStatusText(o.status || this.data.orderInfo.status),
          customer: o.customerName || o.customer || (o.customer && o.customer.name) || this.data.orderInfo.customer,
          productName: o.productName || (o.product && o.product.name) || this.data.orderInfo.productName,
          spec: o.spec || first.spec || o.specification || first.specification || o.productSpec || first.productSpec || this.data.orderInfo.spec,
          paperSupplier: o.supplierName || this.data.orderInfo.paperSupplier,
          materialCode: o.materialCode || this.data.orderInfo.materialCode,
          fluteType: o.fluteType || (o.product && o.product.flute) || this.data.orderInfo.fluteType,
          paperSize: paperSize || this.data.orderInfo.paperSize,
          creaseText: crease || this.data.orderInfo.creaseText,
          creaseSize: crease || this.data.orderInfo.creaseSize,
          bondingMethod: o.bondingMethod || o.joinMethod || this.data.orderInfo.bondingMethod,
          orderNote: o.orderNote || o.notes || o.remark || this.data.orderInfo.orderNote,
          printDrawing: (Array.isArray(o.attachments) && o.attachments.length && (o.attachments[0].url || o.attachments[0].fileID)) ? (o.attachments[0].url || o.attachments[0].fileID) : this.data.orderInfo.printDrawing,
          attachments: Array.isArray(o.attachments) ? o.attachments.map(a => ({
            id: a.id || a.fileID || a.name || `${Date.now()}`,
            name: a.name || '图纸',
            type: a.type || 'drawing',
            fileID: a.fileID,
            url: a.url
          })) : []
        };
        this.setData({ orderInfo: info });
        this.refreshCustomerName();
      }
    } catch (err) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  loadOrderDetailByOrderNo: async function(orderNo) {
    wx.showLoading({ title: '加载中...' });
    try {
      const r = await wx.cloud.callFunction({ name: 'erp-api', data: { action: 'getOrders', params: { page: 1, limit: 200, compact: true, withTotal: false } } });
      const list = r && r.result && r.result.data ? r.result.data : [];
      const found = list.find(o => (o.orderNo === orderNo) || (o.orderNumber === orderNo) || (orderNo && (orderNo.startsWith(String(o.orderNo || o.orderNumber) + '-') )));
      if (found && found._id) {
        await this.loadOrderDetail(found._id);
        return;
      }
      if (found) {
        let useIndex = -1;
        const m = String(orderNo || '').match(/^(.*)-(\d+)$/);
        if (m) {
          const parentNo = m[1];
          const idx = parseInt(m[2], 10) - 1;
          if (String(found.orderNo || found.orderNumber) === parentNo && Number.isFinite(idx) && idx >= 0) {
            useIndex = idx;
          }
        }
        const items = Array.isArray(found.items) ? found.items : [];
        const picked = (useIndex >= 0 && items[useIndex]) ? items[useIndex] : (items[0] || {});
        const qty = (useIndex >= 0) ? Number(picked.quantity || picked.orderQty || picked.qty || 0) : (Array.isArray(items) ? items.reduce((s, it) => s + (Number(it.quantity) || 0), 0) : (found.quantity || 0));
        const bw = picked.boardWidth || found.boardWidth || found.paperWidth || '';
        const bh = picked.boardHeight || found.boardHeight || found.paperLength || '';
        const paperSize = found.paperSize || ((bw || bh) ? `${bw}×${bh}` : '');
        const c1 = found.creasingSize1 || picked.creasingSize1 || 0;
        const c2 = found.creasingSize2 || picked.creasingSize2 || 0;
        const c3 = found.creasingSize3 || picked.creasingSize3 || 0;
        const crease = found.creaseText || found.creaseSize || ((c1 || c2 || c3) ? `${c1}-${c2}-${c3}` : (found.creasingType || ''));
        const info = {
          ...this.data.orderInfo,
          orderNo: found.orderNo || found.orderNumber || orderNo,
          productName: found.productName || (found.product && found.product.name) || this.data.orderInfo.productName,
          spec: found.spec || picked.spec || found.specification || picked.specification || found.productSpec || picked.productSpec || this.data.orderInfo.spec,
          totalQty: qty || this.data.orderInfo.totalQty,
          status: found.status || this.data.orderInfo.status,
          statusText: this.getStatusText(found.status || this.data.orderInfo.status),
          customer: found.customerName || this.data.orderInfo.customer,
          materialCode: found.materialCode || picked.materialCode || picked.materialNo || this.data.orderInfo.materialCode,
          fluteType: found.fluteType || picked.flute || this.data.orderInfo.fluteType,
          paperSize: paperSize || this.data.orderInfo.paperSize,
          creaseText: crease || this.data.orderInfo.creaseText,
          creaseSize: crease || this.data.orderInfo.creaseSize,
          attachments: Array.isArray(found.attachments) ? found.attachments : []
        };
        this.setData({ orderInfo: info });
        this.refreshCustomerName();
        return;
      }
      wx.showToast({ title: '未找到订单', icon: 'none' });
    } catch (_) {
      wx.showToast({ title: '加载失败', icon: 'none' });
    } finally {
      wx.hideLoading();
    }
  },

  // 状态样式
  getStatusClass: function(status) {
    const statusMap = {
      'ordered': 'status-ordered',
      'processing': 'status-processing',
      'pending': 'status-pending',
      'stocked': 'status-stocked',
      'shipping': 'status-shipping',
      'shipped': 'status-shipping',
      'completed': 'status-completed',
      'error': 'status-error'
    };
    return statusMap[status] || 'status-ordered';
  },

  // 获取状态文本
  getStatusText: function(status) {
    const statusMap = {
      'ordered': '已下单',
      'processing': '生产中',
      'pending': '待生产',
      'stocked': '已入库',
      'shipping': '已发货',
      'shipped': '已发货',
      'completed': '已完成',
      'error': '异常'
    };
    return statusMap[status] || '已下单';
  },

  // 查看图纸
  viewDrawing: async function() {
    const src = this.data.orderInfo.printDrawing;
    if (!src) { wx.showToast({ title: '无图纸', icon: 'none' }); return; }
    try {
      if (/^cloud:|^\w{24,}/.test(src)) {
        const r = await wx.cloud.getTempFileURL({ fileList: [src] });
        const tempUrl = r && r.fileList && r.fileList[0] && r.fileList[0].tempFileURL;
        if (tempUrl) { wx.previewImage({ urls: [tempUrl] }); return; }
      }
      wx.previewImage({ urls: [src] });
    } catch (e) {
      wx.showToast({ title: '预览失败', icon: 'none' });
    }
  },

  previewImage: function() {
    this.viewDrawing();
  },

  onCopyOrderNo: function() {
    const val = this.data.orderInfo && this.data.orderInfo.orderNo ? String(this.data.orderInfo.orderNo) : '';
    if (!val) { wx.showToast({ title: '无订单号', icon: 'none' }); return; }
    wx.setClipboardData({ data: val });
  },

  onBack: function() { wx.navigateBack(); },
  onPrintWorkorder: function() {
    const info = this.data.orderInfo || {};
    const orderNo = info.orderNo ? String(info.orderNo) : '';
    if (!orderNo) {
      wx.showToast({ title: '订单号缺失', icon: 'none' });
      return;
    }

    const goodsName = info.goodsName || info.productTitle || info.title || (info.product && (info.product.title || info.product.name)) || '';
    const customerFullName = this.mapCustomerFullName(info.customer || info.customerName || '');
    const payload = Object.assign({}, info, {
      orderNo,
      orderNumber: orderNo,
      customerName: customerFullName,
      customer: customerFullName,
      goodsName,
      quantity: Number(info.totalQty || info.quantity || 0) || 0,
      unit: info.unit || '片',
      flute: info.flute || info.fluteType || '',
      joinMethod: info.joinMethod || info.bondingMethod || '',
      notes: info.notes || info.orderNote || '',
      creaseText: info.creaseText || info.creaseSize || ''
    });

    const key = `print_orders_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      wx.setStorageSync(key, [payload]);
      wx.navigateTo({ url: `/pages/production-sub/workorder-print/workorder-print?key=${encodeURIComponent(key)}` });
    } catch (_) {
      wx.showToast({ title: '缓存失败，无法打印', icon: 'none' });
    }
  },
  onStartProcess: function() { wx.showToast({ title: '操作未开放', icon: 'none' }); },
  onFinishAll: function() { wx.showToast({ title: '操作未开放', icon: 'none' }); },
  closeQcModal: function() { this.setData({ showQcModal: false }); },
  stopPropagation: function() {},
  onQcQtyInput: function(e) { const v = e.detail && e.detail.value ? e.detail.value : ''; this.setData({ qcProducedQty: v }); },
  handleQcResult: function(e) { const r = e.currentTarget.dataset.result || '合格'; wx.showToast({ title: `已标记${r}`, icon: 'success' }); this.setData({ showQcModal: false }); },
  onQcFailDetail: function() { wx.showToast({ title: '请在质检页填写详情', icon: 'none' }); },

  onDownloadAttachment: async function(e) {
    const fileID = e.currentTarget.dataset.fileid;
    const url = e.currentTarget.dataset.url;
    try {
      if (fileID) {
        const r = await wx.cloud.getTempFileURL({ fileList: [fileID] });
        const tempUrl = r && r.fileList && r.fileList[0] && r.fileList[0].tempFileURL;
        if (tempUrl) { wx.previewImage({ urls: [tempUrl] }); return; }
      }
      if (url) { wx.previewImage({ urls: [url] }); return; }
      wx.showToast({ title: '无法预览附件', icon: 'none' });
    } catch (err) {
      wx.showToast({ title: '预览失败', icon: 'none' });
    }
  },

  // 更新进度
  updateProgress: function() {
    wx.showModal({
      title: '更新进度',
      content: `当前进度：${this.data.progress}%\n\n请输入新的进度：`,
      editable: true,
      success: (res) => {
        if (res.confirm && res.content) {
          const newProgress = parseInt(res.content);
          if (newProgress >= 0 && newProgress <= 100) {
            this.setData({
              progress: newProgress,
              'orderInfo.producedQty': Math.floor(this.data.orderInfo.totalQty * newProgress / 100)
            });
            
            wx.showToast({
              title: '进度更新成功',
              icon: 'success'
            });
          } else {
            wx.showToast({
              title: '进度必须在0-100之间',
              icon: 'none'
            });
          }
        }
      }
    });
  },

  // 添加工艺备注
  addProcessNote: function() {
    wx.showModal({
      title: '添加备注',
      content: '请输入工艺备注：',
      editable: true,
      success: (res) => {
        if (res.confirm && res.content) {
          wx.showToast({
            title: '备注添加成功',
            icon: 'success'
          });
        }
      }
    });
  },

  // 完成生产
  completeProduction: function() {
    wx.showModal({
      title: '完成生产',
      content: '确定要将此工单标记为完成吗？',
      success: (res) => {
        if (res.confirm) {
          this.setData({
            'orderInfo.status': 'completed',
            'orderInfo.statusText': '已完成',
            progress: 100,
            'orderInfo.producedQty': this.data.orderInfo.totalQty
          });
          
          wx.showToast({
            title: '生产完成',
            icon: 'success'
          });
        }
      }
    });
  },

  // 返回
  goBack: function() {
    wx.navigateBack();
  }
});
