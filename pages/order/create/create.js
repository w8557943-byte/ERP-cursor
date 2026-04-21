Page({
  data: {
    generating: false,
    submitting: false,
    orderNumber: '',
    reservationId: '',
    today: '',
    customers: [],
    customerNames: [],
    customerIndex: -1,
    suppliers: [],
    supplierNames: [],
    supplierIndex: -1,
    productCategoryOptions: ['纸箱', '隔板', '天地盒', '飞机盒', '异性纸盒', '新增品类'],
    productCategoryIndex: -1,
    creatingProductCategory: false,
    fluteOptions: ['AB楞', 'EB楞', 'A楞', 'B楞', 'E楞'],
    fluteIndex: -1,
    creasingTypeOptions: ['凹凸压线', '平压线', '无压线'],
    creasingTypeIndex: -1,
    joinMethodOptions: ['打钉', '粘胶'],
    joinMethodIndex: -1,
    unitOptions: ['件', '个', '只', '片', '箱'],
    unitIndex: 0,
    priorityOptions: ['normal', 'urgent'],
    priorityText: ['普通', '加急'],
    priorityIndex: 0,
    form: {
      customer: { id: '', name: '', contact: '', phone: '' },
      supplier: { id: '', name: '', contact: '', phone: '' },
      product: {
        name: '',
        title: '',
        spec: '',
        flute: '',
        materialCode: '',
        materialNo: '',
        boardWidth: '',
        boardHeight: '',
        creasing: '',
        creasingSize1: '',
        creasingSize2: '',
        creasingSize3: '',
        sheetCount: '',
        quantity: '',
        unit: '件',
        unitPrice: ''
      },
      joinMethod: '',
      amount: { deposit: '' },
      deliveryDate: '',
      priority: 'normal',
      notes: '',
      attachments: []
    },
    amountText: '0.00',
    balanceText: '0.00'
  },

  onLoad: function() {
    const today = this.formatDate(Date.now())
    const defaultDelivery = this.formatDate(Date.now() + 3 * 24 * 60 * 60 * 1000)
    this.setData({ today, 'form.deliveryDate': defaultDelivery })
    this.reserveOrderNumber()
    this.loadCustomers()
    this.loadSuppliers()
  },

  onUnload: function() {
    if (this._created) return
    this.releaseReservation()
  },

  formatDate: function(ts) {
    const d = new Date(ts)
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${y}-${m}-${day}`
  },

  reserveOrderNumber: function() {
    if (this.data.generating) return
    this.setData({ generating: true })

    wx.cloud
      .callFunction({ name: 'erp-api', data: { action: 'reserveOrderNumber' } })
      .then((res) => {
        const payload = res && res.result && res.result.data ? res.result.data : (res && res.result ? res.result : {})
        const no = payload && (payload.orderNumber || payload.orderNo) ? (payload.orderNumber || payload.orderNo) : ''
        const rid = payload && payload.reservationId ? payload.reservationId : ''
        if (!no) throw new Error('No order number returned')
        this.setData({ orderNumber: no, reservationId: rid })
      })
      .catch(() => {
        return wx.cloud
          .callFunction({ name: 'erp-api', data: { action: 'generateOrderNumber' } })
          .then((res2) => {
            const payload2 = res2 && res2.result && res2.result.data ? res2.result.data : (res2 && res2.result ? res2.result : {})
            const no2 = payload2 && (payload2.orderNumber || payload2.orderNo) ? (payload2.orderNumber || payload2.orderNo) : ''
            if (!no2) throw new Error('No order number returned')
            this.setData({ orderNumber: no2, reservationId: '' })
          })
      })
      .finally(() => {
        this.setData({ generating: false })
      })
  },

  releaseReservation: function() {
    const reservationId = this.data.reservationId || ''
    const orderNumber = this.data.orderNumber || ''
    if (!reservationId && !orderNumber) return Promise.resolve(false)
    return wx.cloud
      .callFunction({ name: 'erp-api', data: { action: 'releaseOrderNumber', data: { reservationId, orderNumber } } })
      .then(() => true)
      .catch(() => false)
  },

  onCopyOrderNo: function() {
    const no = this.data.orderNumber || ''
    if (!no) return
    wx.setClipboardData({ data: no })
  },

  onDateChange: function(e) {
    const val = e && e.detail ? e.detail.value : ''
    this.setData({ 'form.deliveryDate': val })
  },

  onProductCategoryPickerChange: function(e) {
    const idx = e && e.detail ? Number(e.detail.value) : -1
    const selected = idx >= 0 && this.data.productCategoryOptions[idx] ? this.data.productCategoryOptions[idx] : ''
    if (selected === '新增品类') {
      this.setData({ productCategoryIndex: idx, creatingProductCategory: true, 'form.product.name': '' })
      return
    }
    this.setData({ productCategoryIndex: idx, creatingProductCategory: false, 'form.product.name': selected })
  },

  onFlutePickerChange: function(e) {
    const idx = e && e.detail ? Number(e.detail.value) : -1
    const selected = idx >= 0 && this.data.fluteOptions[idx] ? this.data.fluteOptions[idx] : ''
    this.setData({ fluteIndex: idx, 'form.product.flute': selected })
  },

  onCreasingTypePickerChange: function(e) {
    const idx = e && e.detail ? Number(e.detail.value) : -1
    const selected = idx >= 0 && this.data.creasingTypeOptions[idx] ? this.data.creasingTypeOptions[idx] : ''
    const patch = { creasingTypeIndex: idx, 'form.product.creasing': selected }
    if (selected === '无压线') {
      patch['form.product.creasingSize1'] = ''
      patch['form.product.creasingSize2'] = ''
      patch['form.product.creasingSize3'] = ''
    }
    this.setData(patch)
  },

  onJoinMethodPickerChange: function(e) {
    const idx = e && e.detail ? Number(e.detail.value) : -1
    const selected = idx >= 0 && this.data.joinMethodOptions[idx] ? this.data.joinMethodOptions[idx] : ''
    this.setData({ joinMethodIndex: idx, 'form.joinMethod': selected })
  },

  onUnitPickerChange: function(e) {
    const idx = e && e.detail ? Number(e.detail.value) : -1
    const selected = idx >= 0 && this.data.unitOptions[idx] ? this.data.unitOptions[idx] : '件'
    this.setData({ unitIndex: idx, 'form.product.unit': selected })
  },

  onPriorityPickerChange: function(e) {
    const idx = e && e.detail ? Number(e.detail.value) : -1
    const selected = idx >= 0 && this.data.priorityOptions[idx] ? this.data.priorityOptions[idx] : 'normal'
    this.setData({ priorityIndex: idx, 'form.priority': selected })
  },

  loadCustomers: function() {
    return wx.cloud
      .callFunction({
        name: 'erp-api',
        data: { action: 'getCustomers', params: { page: 1, limit: 1000 } }
      })
      .then((res) => {
        const list = res && res.result && (res.result.data || res.result.customers) ? (res.result.data || res.result.customers) : []
        const customers = Array.isArray(list) ? list : []
        const names = customers.map((c) => {
          const full = c.companyName || c.name || c.company || ''
          const shortName = c.shortName || ''
          if (shortName && full && shortName !== full) return `${shortName} (${full})`
          return full || shortName || '-'
        })
        this.setData({ customers, customerNames: names })
      })
      .catch(() => {
        this.setData({ customers: [], customerNames: [], customerIndex: -1 })
      })
  },

  loadSuppliers: function() {
    return wx.cloud
      .callFunction({
        name: 'erp-api',
        data: { action: 'getSuppliers', params: { page: 1, limit: 1000 } }
      })
      .then((res) => {
        const list = res && res.result && (res.result.data || res.result.suppliers) ? (res.result.data || res.result.suppliers) : []
        const suppliers = Array.isArray(list) ? list : []
        const names = suppliers.map((s) => {
          const full = s.name || ''
          const shortName = s.shortName || ''
          if (shortName && full && shortName !== full) return `${shortName} (${full})`
          return full || shortName || '-'
        })
        this.setData({ suppliers, supplierNames: names })
      })
      .catch(() => {
        this.setData({ suppliers: [], supplierNames: [], supplierIndex: -1 })
      })
  },

  onCustomerPickerChange: function(e) {
    const idx = e && e.detail ? Number(e.detail.value) : -1
    const picked = idx >= 0 && this.data.customers && this.data.customers[idx] ? this.data.customers[idx] : null
    if (!picked) return
    const name = picked.companyName || picked.name || picked.company || ''
    const contact = picked.contactName || picked.contact || ''
    const phone = picked.phone || ''
    const id = picked._id || picked.id || ''
    this.setData({
      customerIndex: idx,
      'form.customer.id': id,
      'form.customer.name': name,
      'form.customer.contact': this.data.form.customer.contact ? this.data.form.customer.contact : contact,
      'form.customer.phone': this.data.form.customer.phone ? this.data.form.customer.phone : phone
    })
  },

  onSupplierPickerChange: function(e) {
    const idx = e && e.detail ? Number(e.detail.value) : -1
    const picked = idx >= 0 && this.data.suppliers && this.data.suppliers[idx] ? this.data.suppliers[idx] : null
    if (!picked) return
    const name = picked.name || ''
    const contact = picked.contactName || picked.contact || ''
    const phone = picked.phone || ''
    const id = picked._id || picked.id || ''
    this.setData({
      supplierIndex: idx,
      'form.supplier.id': id,
      'form.supplier.name': name,
      'form.supplier.contact': this.data.form.supplier.contact ? this.data.form.supplier.contact : contact,
      'form.supplier.phone': this.data.form.supplier.phone ? this.data.form.supplier.phone : phone
    })
  },

  onInput: function(e) {
    const field = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.field : ''
    const value = e && e.detail ? e.detail.value : ''
    if (!field) return
    this.setData({ [`form.${field}`]: value }, () => {
      if (field === 'product.quantity' || field === 'product.unitPrice' || field === 'amount.deposit') this.recalcAmount()
    })
  },

  onPickAttachment: function() {
    if (this.data.submitting) return
    const remain = Math.max(0, 9 - ((this.data.form && this.data.form.attachments && this.data.form.attachments.length) ? this.data.form.attachments.length : 0))
    if (remain <= 0) {
      wx.showToast({ title: '最多上传9个', icon: 'none' })
      return
    }

    wx.showActionSheet({
      itemList: ['上传图片', '上传文件'],
      success: (r) => {
        const tapIndex = r && typeof r.tapIndex === 'number' ? r.tapIndex : -1
        if (tapIndex === 0) this.pickImageAttachment(remain)
        if (tapIndex === 1) this.pickFileAttachment(remain)
      }
    })
  },

  pickImageAttachment: function(remain) {
    wx.chooseMedia({
      count: Math.min(9, remain),
      mediaType: ['image'],
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: async (res) => {
        const files = res && res.tempFiles ? res.tempFiles : []
        for (let i = 0; i < files.length; i++) {
          const f = files[i]
          const path = f && f.tempFilePath ? f.tempFilePath : ''
          if (!path) continue
          await this.uploadAttachmentFromPath(path, 'image')
        }
      }
    })
  },

  pickFileAttachment: function(remain) {
    wx.chooseMessageFile({
      count: Math.min(9, remain),
      type: 'file',
      success: async (res) => {
        const files = res && res.tempFiles ? res.tempFiles : []
        for (let i = 0; i < files.length; i++) {
          const f = files[i]
          const path = f && f.path ? f.path : ''
          if (!path) continue
          await this.uploadAttachmentFromPath(path, 'file', f && f.name ? f.name : '')
        }
      }
    })
  },

  uploadAttachmentFromPath: async function(filePath, kind, nameHint) {
    try {
      const rawName = String(nameHint || '').trim()
      const ext = (() => {
        const m = String(rawName || filePath).toLowerCase().match(/\.([a-z0-9]{1,6})$/)
        return m ? m[1] : (kind === 'image' ? 'jpg' : 'dat')
      })()
      const no = String(this.data.orderNumber || '').trim()
      const cloudPath = `attachments/orders/${no || 'draft'}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`
      const uploadRes = await wx.cloud.uploadFile({ cloudPath, filePath })
      const fileID = uploadRes && uploadRes.fileID ? uploadRes.fileID : ''
      if (!fileID) throw new Error('upload failed')

      let url = ''
      try {
        const t = await wx.cloud.getTempFileURL({ fileList: [fileID] })
        url = t && t.fileList && t.fileList[0] && t.fileList[0].tempFileURL ? t.fileList[0].tempFileURL : ''
      } catch (_) {}

      const name = rawName || `${kind === 'image' ? '图纸' : '附件'}.${ext}`
      const next = (this.data.form && Array.isArray(this.data.form.attachments)) ? this.data.form.attachments.slice() : []
      next.push({ name, fileID, url, kind })
      this.setData({ 'form.attachments': next })
      wx.showToast({ title: '已上传', icon: 'success' })
    } catch (e) {
      wx.showToast({ title: '上传失败', icon: 'none' })
    }
  },

  onRemoveAttachment: function(e) {
    const idx = e && e.currentTarget && e.currentTarget.dataset ? Number(e.currentTarget.dataset.index) : -1
    const list = (this.data.form && Array.isArray(this.data.form.attachments)) ? this.data.form.attachments.slice() : []
    if (idx < 0 || idx >= list.length) return
    list.splice(idx, 1)
    this.setData({ 'form.attachments': list })
  },

  onPreviewAttachment: function(e) {
    const idx = e && e.currentTarget && e.currentTarget.dataset ? Number(e.currentTarget.dataset.index) : -1
    const list = (this.data.form && Array.isArray(this.data.form.attachments)) ? this.data.form.attachments : []
    const item = idx >= 0 && list[idx] ? list[idx] : null
    if (!item) return
    const url = item.url || ''
    if (item.kind === 'image' && url) {
      const urls = list.filter((x) => x && x.kind === 'image' && x.url).map((x) => x.url)
      wx.previewImage({ urls, current: url })
      return
    }
    const openByUrl = (u) => {
      wx.showLoading({ title: '打开中', mask: true })
      wx.downloadFile({
        url: u,
        success: (r) => {
          const filePath = r && r.tempFilePath ? r.tempFilePath : ''
          if (!filePath) {
            wx.hideLoading()
            wx.showToast({ title: '打开失败', icon: 'none' })
            return
          }
          wx.openDocument({
            filePath,
            showMenu: true,
            complete: () => wx.hideLoading()
          })
        },
        fail: () => {
          wx.hideLoading()
          wx.showToast({ title: '打开失败', icon: 'none' })
        }
      })
    }
    if (url) {
      openByUrl(url)
      return
    }
    const fileID = item.fileID || ''
    if (!fileID) return
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success: (r) => {
        const u = r && r.fileList && r.fileList[0] && r.fileList[0].tempFileURL ? r.fileList[0].tempFileURL : ''
        if (!u) return
        openByUrl(u)
      }
    })
  },

  recalcAmount: function() {
    const qty = Number(this.data.form.product.quantity || 0)
    const unitPrice = Number(this.data.form.product.unitPrice || 0)
    const deposit = Number(this.data.form.amount.deposit || 0)
    const total = qty * unitPrice
    const balance = Math.max(0, total - deposit)
    this.setData({ amountText: total.toFixed(2), balanceText: balance.toFixed(2) })
  },

  validate: function() {
    const no = String(this.data.orderNumber || '').trim()
    if (!no) return '订单号生成失败，请返回重试'
    const customerName = String(this.data.form.customer.name || '').trim()
    if (!customerName) return '请输入客户名称'
    const productName = String(this.data.form.product.name || '').trim()
    if (!productName) return '请输入产品类别'
    const spec = String(this.data.form.product.spec || '').trim()
    if (!spec) return '请输入规格'
    const qty = Number(this.data.form.product.quantity || 0)
    if (!qty || qty <= 0) return '请输入正确的数量'
    const unitPrice = Number(this.data.form.product.unitPrice || 0)
    if (!unitPrice || unitPrice <= 0) return '请输入正确的单价'
    const sheetCountRaw = String(this.data.form.product.sheetCount || '').trim()
    if (sheetCountRaw) {
      const sheetCountNum = Number(sheetCountRaw)
      if (!Number.isFinite(sheetCountNum) || sheetCountNum <= 0) return '请输入正确的下单片数'
    }
    return ''
  },

  onCancel: function() {
    if (this.data.submitting) return
    wx.showModal({
      title: '确认取消',
      content: '取消后将释放当前预约的订单号',
      confirmText: '取消订单',
      confirmColor: '#dc2626',
      success: (res) => {
        if (!res.confirm) return
        this.releaseReservation().finally(() => {
          wx.navigateBack()
        })
      }
    })
  },

  onSubmit: function() {
    if (this.data.submitting) return
    const err = this.validate()
    if (err) {
      wx.showToast({ title: err, icon: 'none' })
      return
    }
    this.setData({ submitting: true })

    const qty = Number(this.data.form.product.quantity || 0)
    const unitPrice = Number(this.data.form.product.unitPrice || 0)
    const deposit = Number(this.data.form.amount.deposit || 0)
    const total = qty * unitPrice
    const sheetCountRaw = String(this.data.form.product.sheetCount || '').trim()
    const sheetCountVal = sheetCountRaw ? Number(sheetCountRaw) : undefined

    const payload = {
      orderNumber: this.data.orderNumber,
      orderNo: this.data.orderNumber,
      reservationId: this.data.reservationId || '',
      customerName: this.data.form.customer.name,
      contactName: this.data.form.customer.contact,
      phone: this.data.form.customer.phone,
      customer: {
        id: this.data.form.customer.id,
        name: this.data.form.customer.name,
        contact: this.data.form.customer.contact,
        phone: this.data.form.customer.phone
      },
      supplierId: this.data.form.supplier.id,
      supplierName: this.data.form.supplier.name,
      supplier: {
        id: this.data.form.supplier.id,
        name: this.data.form.supplier.name,
        contact: this.data.form.supplier.contact,
        phone: this.data.form.supplier.phone
      },
      priority: this.data.form.priority,
      productName: this.data.form.product.name,
      goodsName: this.data.form.product.title,
      productTitle: this.data.form.product.title,
      spec: this.data.form.product.spec,
      flute: this.data.form.product.flute,
      materialCode: this.data.form.product.materialCode,
      materialNo: this.data.form.product.materialNo,
      boardWidth: this.data.form.product.boardWidth,
      boardHeight: this.data.form.product.boardHeight,
      creasingType: this.data.form.product.creasing,
      creasingSize1: this.data.form.product.creasingSize1,
      creasingSize2: this.data.form.product.creasingSize2,
      creasingSize3: this.data.form.product.creasingSize3,
      sheetCount: Number.isFinite(sheetCountVal) ? sheetCountVal : undefined,
      joinMethod: this.data.form.joinMethod,
      quantity: qty,
      unit: this.data.form.product.unit,
      unitPrice,
      totalAmount: total,
      deposit,
      deliveryDate: this.data.form.deliveryDate,
      notes: this.data.form.notes,
      attachments: this.data.form.attachments,
      items: [
        {
          productName: this.data.form.product.name,
          title: this.data.form.product.title,
          goodsName: this.data.form.product.title,
          spec: this.data.form.product.spec,
          quantity: qty,
          unit: this.data.form.product.unit,
          unitPrice,
          flute: this.data.form.product.flute,
          materialCode: this.data.form.product.materialCode,
          materialNo: this.data.form.product.materialNo,
          joinMethod: this.data.form.joinMethod,
          sheetCount: Number.isFinite(sheetCountVal) ? sheetCountVal : undefined
        }
      ]
    }

    wx.cloud
      .callFunction({ name: 'erp-api', data: { action: 'createOrder', data: payload } })
      .then((res) => {
        if (!(res && res.result && res.result.success)) throw new Error((res && res.result && res.result.message) || '创建失败')
        const created = res && res.result && res.result.data ? res.result.data : null
        this._created = true
        try { wx.setStorageSync('orders_force_refresh', Date.now()) } catch (_) {}
        wx.showToast({ title: '创建成功', icon: 'success' })
        const id = created && (created._id || created.id) ? (created._id || created.id) : ''
        const no = created && (created.orderNo || created.orderNumber) ? (created.orderNo || created.orderNumber) : this.data.orderNumber
        if (id) {
          setTimeout(() => {
            wx.redirectTo({ url: `/pages/order-sub/detail/detail?orderId=${encodeURIComponent(id)}&orderNo=${encodeURIComponent(no)}` })
          }, 300)
          return
        }
        setTimeout(() => wx.navigateBack(), 600)
      })
      .catch((e) => {
        wx.showToast({ title: e && e.message ? e.message : '创建失败', icon: 'none' })
      })
      .finally(() => {
        this.setData({ submitting: false })
      })
  }
})
