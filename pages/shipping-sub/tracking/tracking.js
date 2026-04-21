const api = require('../../../utils/api.js')

Page({
  data: { id: '', trackingNo: '', carrier: '', note: '' },
  onLoad(query) { this.setData({ id: query?.id || '' }) },
  onSubmit(e) {
    const v = e?.detail?.value || {}
    this.setData({ trackingNo: v.trackingNo || '', carrier: v.carrier || '', note: v.note || '' })
    this.submit()
  },
  async submit() {
    const id = this.data.id
    if (!id) { wx.showToast({ title: '缺少编号', icon: 'none' }); return }
    try {
      const payload = { trackingNo: this.data.trackingNo, carrier: this.data.carrier, note: this.data.note }
      await api.addShippingTracking(id, payload)
      wx.showToast({ title: '提交成功', icon: 'success' })
      wx.navigateBack()
    } catch (_) {
      wx.showToast({ title: '提交失败', icon: 'none' })
    }
  }
})