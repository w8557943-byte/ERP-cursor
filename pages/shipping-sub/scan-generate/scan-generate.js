const api = require('../../../utils/api.js')

Page({
  data: { result: '' },
  async onScan() {
    try {
      const r = await wx.scanCode({ scanType: ['qrCode', 'barCode'] })
      const raw = (r?.result || r?.code || '').toString().trim()
      if (!raw) { wx.showToast({ title: '无效数据', icon: 'none' }); return }

      let orderId = ''
      let orderNo = ''
      if (/^https?:\/\//.test(raw)) {
        const mId = raw.match(/[?&]orderId=([^&]+)/)
        const mNo = raw.match(/[?&]orderNo=([^&]+)/)
        if (mId) orderId = decodeURIComponent(mId[1])
        if (mNo) orderNo = decodeURIComponent(mNo[1])
      } else {
        try {
          const obj = JSON.parse(raw)
          orderId = obj.orderId || obj.id || obj._id || ''
          orderNo = obj.orderNo || obj.orderNumber || ''
        } catch (_) { }
        if (!orderId && !orderNo) {
          // 支持 24位 Mongo ID 和 36位 UUID
          if (/^[a-fA-F0-9]{24}$/.test(raw) || /^[0-9a-fA-F-]{36}$/.test(raw)) orderId = raw
          else orderNo = raw
        }
      }

      if (!orderId && !orderNo) { wx.showToast({ title: '无法识别二维码', icon: 'none' }); return }

      const res = await api.createShippingFromOrder({ orderId, orderNo })
      this.setData({ result: JSON.stringify(res?.data || {}) })
      wx.showToast({ title: '已生成待发货', icon: 'success' })
    } catch (_) {
      wx.showToast({ title: '扫码或生成失败', icon: 'none' })
    }
  }
})
