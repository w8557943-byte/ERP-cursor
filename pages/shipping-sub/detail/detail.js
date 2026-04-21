const api = require('../../../utils/api.js')

Page({
  data: { loading: false, id: '', item: {} },
  onLoad(query) { this.setData({ id: query?.id || '' }); this.loadData() },
  async loadData() {
    const id = this.data.id
    if (!id) return
    this.setData({ loading: true })
    try {
      const res = await api.getShippingDetail(id)
      const item = res?.data || {}
      this.setData({ item })
    } catch (_) {
      this.setData({ item: {} })
    } finally {
      this.setData({ loading: false })
    }
  },
  async onDeliver() {
    const id = this.data.id
    if (!id) return
    try {
      await api.confirmDelivery(id)
      wx.showToast({ title: '已确认送达', icon: 'success' })
      this.loadData()
    } catch (_) {
      wx.showToast({ title: '操作失败', icon: 'none' })
    }
  },
  onGoTracking() {
    const id = this.data.id
    wx.navigateTo({ url: `/pages/shipping-sub/tracking/tracking?id=${id}` })
  }
})
