const cloudSync = require('../../../utils/cloud-sync')

Page({
  data: {
    loading: false,
    progress: 0,
    statusText: '准备加载云端数据…',
    errorText: '',
    targetUrl: ''
  },

  onLoad: function (opts) {
    const targetUrl = opts && opts.targetUrl ? decodeURIComponent(String(opts.targetUrl)) : ''
    this.setData({ targetUrl })
  },

  onShow: function () {
    try { wx.hideHomeButton() } catch (_) { void 0 }
    if (!this.data.loading && !this._started) {
      this._started = true
      this.startLoad()
    }
  },

  setProgress: function (progress, statusText) {
    const p = Math.max(0, Math.min(100, Math.floor(Number(progress || 0))))
    const next = { progress: p }
    if (typeof statusText === 'string') next.statusText = statusText
    this.setData(next)
  },

  startLoad: async function () {
    this.setData({ loading: true, errorText: '' })
    this.setProgress(2, '检查网络…')

    try {
      const startTs = Date.now()
      const res = await cloudSync.pullAllCloudData({
        onProgress: (p) => {
          if (p && p.phase === 'merge') {
            const idx = Number(p.index || 0)
            const total = Math.max(1, Number(p.total || 1))
            const base = 15
            const span = 80
            const percent = base + Math.floor((idx / total) * span)
            this.setProgress(percent, `合并数据：${p.collection || ''}`)
          }
        }
      })
      this.setProgress(98, '完成校验…')
      const cost = Date.now() - startTs
      this.setProgress(100, cost < 600 ? '加载完成' : '加载完成，正在进入系统…')
      setTimeout(() => this.goNext(), 260)
      return res
    } catch (e) {
      const msg = (e && (e.message || e.errMsg)) ? String(e.message || e.errMsg) : '加载失败'
      this.setData({ errorText: msg })
      this.setProgress(Math.max(5, this.data.progress || 0), '加载失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  goNext: function () {
    const targetUrl = this.data.targetUrl || '/pages/workbench/workbench'
    const safe = typeof targetUrl === 'string' && targetUrl.startsWith('/') ? targetUrl : '/pages/workbench/workbench'
    const isTab = [
      '/pages/workbench/workbench',
      '/pages/order/order',
      '/pages/production/production',
      '/pages/profile/profile'
    ].includes(safe)
    if (isTab) {
      wx.switchTab({ url: safe })
      return
    }
    wx.redirectTo({ url: safe })
  },

  onRetry: function () {
    if (this.data.loading) return
    this.startLoad()
  },

  onSkip: function () {
    if (this.data.loading) return
    this.goNext()
  }
})

