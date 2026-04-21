const BASE_MENU_ITEMS = [
  {
    icon: '👤',
    title: '个人信息',
    description: '查看和编辑个人资料',
    action: 'editProfile'
  },
  {
    icon: '🔐',
    title: '修改密码',
    description: '更新登录密码',
    action: 'changePassword'
  },
  {
    icon: '☁️',
    title: '数据备份',
    description: '云端备份与定时策略',
    action: 'dataBackup'
  },
  {
    icon: '🔔',
    title: '系统通知',
    description: '系统通知和提醒',
    action: 'notifications'
  },
  {
    icon: '👥',
    title: '用户管理',
    description: '管理系统用户',
    action: 'userManagement',
    adminOnly: true
  }
];

const cloudSync = require('../../utils/cloud-sync')

const DEFAULT_BACKUP_CONFIG = { enabled: true, mode: 'manual', interval: 0 }

const pad2 = (n) => String(n).padStart(2, '0')

const formatTime = (ts) => {
  const t = Number(ts || 0)
  if (!t) return '—'
  const d = new Date(t)
  if (String(d) === 'Invalid Date') return '—'
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

const formatBytes = (n) => {
  const b = Number(n || 0)
  if (!Number.isFinite(b) || b <= 0) return '—'
  if (b < 1024) return `${b} B`
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`
  return `${(b / (1024 * 1024)).toFixed(2)} MB`
}

const calcCountdownText = (nextAt) => {
  const now = Date.now()
  const t = Number(nextAt || 0)
  if (!t || t <= now) return '—'
  const s = Math.floor((t - now) / 1000)
  const hh = Math.floor(s / 3600)
  const mm = Math.floor((s % 3600) / 60)
  const ss = s % 60
  return `${pad2(hh)}:${pad2(mm)}:${pad2(ss)}`
}

Page({
  data: {
    userInfo: {
      name: '',
      role: '',
      email: '',
      phone: '',
      avatar: '',
      joinDate: '2025-01-20',
      companyName: '',
      introduction: ''
    },
    monthOrderCount: 0,
    usageDays: 0,
    isAdmin: false,
    avatarError: false,
    notificationsExpanded: false,
    notificationLoading: false,
    notificationReminders: [],
    notificationCount: 0,
    menuItems: BASE_MENU_ITEMS,
    bluetoothAvailable: false,
    bluetoothInitializing: false,
    connectedPrinterId: '',
    connectedPrinterName: '',
    profileEditVisible: false,
    profileSaving: false,
    profileForm: {
      name: '',
      companyName: '',
      introduction: ''
    },
    passwordEditVisible: false,
    passwordSaving: false,
    passwordForm: {
      username: '',
      oldPassword: '',
      newPassword: '',
      confirmPassword: ''
    },
    backupVisible: false,
    backupInProgress: false,
    backupProgress: 0,
    backupConfig: DEFAULT_BACKUP_CONFIG,
    backupMeta: null,
    backupLastTimeText: '—',
    backupSizeText: '—',
    backupCountdownText: '—',
    scrollTop: 0,
    appVersion: ''
  },

  onLoad: function() {
    console.log('个人中心页面加载');
    this.initUserInfo();
    this.refreshHeaderStats();
    this.loadNotificationReminders();
    this.syncPrinterDevice();
    this.updateAppVersion();
    this.initBackupConfig();
    this.refreshBackupStats();
  },

  onShow: function() {
    if (typeof this.getTabBar === 'function' && this.getTabBar()) {
      this.getTabBar().init();
    }
    this.initUserInfo();
    this.refreshHeaderStats();
    this.loadNotificationReminders();
    this.syncPrinterDevice();
    this.updateAppVersion();
    this.initBackupConfig();
    this.refreshBackupStats();
    this.startBackupCountdown();
  },

  onHide: function() {
    this.stopBackupCountdown();
  },

  updateAppVersion: function() {
    let version = '';
    try {
      const info = wx.getAccountInfoSync && wx.getAccountInfoSync();
      version = info && info.miniProgram && info.miniProgram.version ? String(info.miniProgram.version) : '';
      if (!version && info && info.miniProgram && info.miniProgram.envVersion) {
        const env = String(info.miniProgram.envVersion);
        if (env === 'develop') version = '开发版';
        else if (env === 'trial') version = '体验版';
        else if (env === 'release') version = '';
      }
    } catch (e) {
      version = '';
    }
    if (version !== this.data.appVersion) {
      this.setData({ appVersion: version });
    }
  },

  onPageScroll: function(e) {
    this._scrollTop = e && typeof e.scrollTop === 'number' ? e.scrollTop : 0;
  },

  syncPrinterDevice: function() {
    let device = null;
    try {
      const app = getApp();
      device = app && app.globalData ? app.globalData.printerDevice : null;
    } catch (e) {}
    if (!device) {
      try {
        const saved = wx.getStorageSync('printerDevice');
        if (saved && saved.deviceId) device = saved;
      } catch (e) {}
    }
    if (device && device.deviceId) {
      try {
        const app = getApp();
        if (app && app.globalData) app.globalData.printerDevice = device;
      } catch (e) {}
      const name = String(device.name || device.localName || '').trim();
      this.setData({
        bluetoothAvailable: true,
        connectedPrinterId: String(device.deviceId),
        connectedPrinterName: name
      });
      return;
    }
    this.setData({
      bluetoothAvailable: false,
      connectedPrinterId: '',
      connectedPrinterName: ''
    });
  },

  initUserInfo: function() {
    // 从存储中获取用户信息
    try {
      const storedUserInfo = wx.getStorageSync('userInfo');
      if (storedUserInfo) {
        const role = storedUserInfo.role;
        const isAdmin = role === 'admin' || role === 'administrator';
        this.setData({
          userInfo: {
            ...this.data.userInfo,
            ...storedUserInfo
          },
          isAdmin,
          menuItems: BASE_MENU_ITEMS.filter((item) => isAdmin || !item.adminOnly),
          avatarError: false
        });
        return;
      }
    } catch (error) {
      console.error('获取用户信息失败:', error);
    }
    this.setData({ isAdmin: false, menuItems: BASE_MENU_ITEMS.filter((item) => !item.adminOnly) });
  },

  refreshHeaderStats: function() {
    this.updateUsageDays();
    this.fetchMonthOrderCount();
  },

  updateUsageDays: function() {
    const KEY = 'appBirthTs';
    const now = Date.now();
    let birthTs = 0;
    try {
      birthTs = Number(wx.getStorageSync(KEY) || 0);
    } catch (e) {}
    if (!(birthTs > 0)) {
      birthTs = now;
      try {
        wx.setStorageSync(KEY, birthTs);
      } catch (e) {}
    }
    const dayMs = 24 * 60 * 60 * 1000;
    const days = Math.max(1, Math.floor((now - birthTs) / dayMs) + 1);
    this.setData({ usageDays: days });
  },

  fetchMonthOrderCount: function() {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1, 0, 0, 0, 0).getTime();
    const end = Date.now();

    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'getOrders',
        params: {
          dateRange: { start, end }
        }
      }
    }).then((res) => {
      const result = res && res.result ? res.result : {};
      if (!result.success) return;
      const total = result.pagination && typeof result.pagination.total === 'number' ? result.pagination.total : 0;
      this.setData({ monthOrderCount: total });
    }).catch(() => {});
  },

  toTs: function(value) {
    if (!value) return 0;
    if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'string') {
      const t = Date.parse(value);
      return Number.isFinite(t) ? t : 0;
    }
    return 0;
  },

  onAvatarError: function() {
    this.setData({ avatarError: true });
  },

  toggleNotifications: function() {
    const next = !this.data.notificationsExpanded;
    this.setData({ notificationsExpanded: next });
    if (!next) return;
    this.loadNotificationReminders();
  },

  loadNotificationReminders: function() {
    if (this.data.notificationLoading) return;
    this.setData({ notificationLoading: true });

    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const weekMs = 7 * dayMs;

    const fetchPaged = async (action, baseParams, maxItems = 500) => {
      const limit = 50;
      const out = [];
      for (let page = 1; page <= 10 && out.length < maxItems; page += 1) {
        const res = await wx.cloud.callFunction({
          name: 'erp-api',
          data: { action, params: { ...(baseParams || {}), page, limit } }
        }).catch(() => null);
        const list = res && res.result && res.result.success && Array.isArray(res.result.data) ? res.result.data : [];
        if (list.length) out.push(...list);
        if (list.length < limit) break;
      }
      return out.slice(0, maxItems);
    };

    const ordersPromise = fetchPaged('getOrders', { compact: true, withTotal: false }, 200).catch(() => []);
    const purchasePromise = fetchPaged('getPurchaseOrders', { withTotal: false }, 200).catch(() => []);
    const productionPromise = fetchPaged('getProductionPlans', { withTotal: false }, 200).catch(() => []);

    Promise.all([ordersPromise, purchasePromise, productionPromise]).then(([orders, purchaseOrders, plans]) => {
      const reminders = [];

      const normalizeStatus = (s) => String(s || '').trim().toLowerCase();
      const isCompleted = (s) => {
        const st = normalizeStatus(s);
        return st === 'completed' || st === 'done' || st === 'finished' || st === 'cancelled' || st === 'refunded';
      };

      const overdueOrders = (Array.isArray(orders) ? orders : []).filter((o) => {
        if (!o) return false;
        if (isCompleted(o.status)) return false;
        const deliveryTs = this.toTs(o.deliveryDate || o.delivery_time || o.expectedDeliveryDate);
        if (!deliveryTs) return false;
        return deliveryTs < now;
      });

      if (overdueOrders.length) {
        reminders.push({ title: '订单逾期', count: overdueOrders.length });
      }

      const timeoutPlans = (Array.isArray(plans) ? plans : []).filter((p) => {
        if (!p) return false;
        if (isCompleted(p.status)) return false;
        const scheduledTs = this.toTs(p.scheduledDate || p.planDate || p.deadline || p.endDate);
        if (!scheduledTs) return false;
        return scheduledTs < now;
      });
      if (timeoutPlans.length) {
        reminders.push({ title: '生产超时', count: timeoutPlans.length });
      }

      const inventoryOverWeekSales = (Array.isArray(orders) ? orders : []).filter((o) => {
        if (!o) return false;
        const stockedQty = Number(o.stockedQty || 0);
        const shippedQty = Number(o.shippedQty || 0);
        const invQty = Math.max(0, stockedQty - shippedQty);
        if (!(invQty > 0)) return false;
        const stockedAtTs = this.toTs(o.stockedAt || o.stockTime || o.updatedAt);
        if (!stockedAtTs) return false;
        return now - stockedAtTs >= weekMs;
      });

      const inventoryOverWeekPurchase = (Array.isArray(purchaseOrders) ? purchaseOrders : []).filter((o) => {
        if (!o) return false;
        const stockedQty = Number(o.stockedQty || 0);
        if (!(stockedQty > 0)) return false;
        const stockedAtTs = this.toTs(o.stockedAt || o.stockTime || o.updatedAt);
        if (!stockedAtTs) return false;
        return now - stockedAtTs >= weekMs;
      });

      const inventoryOverWeek = inventoryOverWeekSales.length + inventoryOverWeekPurchase.length;
      if (inventoryOverWeek) {
        reminders.push({ title: '库存超过1周', count: inventoryOverWeek });
      }

      const overduePayments = (Array.isArray(orders) ? orders : []).filter((o) => {
        if (!o) return false;
        const total = Number(o.finalAmount || o.totalAmount || o.amount || 0);
        const paid = Number(o.paidAmount || o.paid || 0);
        const unpaid = Math.max(0, total - paid);
        if (!(unpaid > 0)) return false;
        const dueTs = this.toTs(o.dueDate || o.paymentDueDate);
        if (!dueTs) return false;
        return dueTs < now;
      });

      if (overduePayments.length) {
        reminders.push({ title: '待付款逾期', count: overduePayments.length });
      }

      const notificationCount = reminders.reduce((sum, r) => sum + Number(r.count || 0), 0);
      this.setData({ notificationReminders: reminders, notificationCount });
    }).finally(() => {
      this.setData({ notificationLoading: false });
    });
  },

  // 菜单项点击
  onMenuItemTap: function(e) {
    const action = e.currentTarget.dataset.action;
    const item = this.data.menuItems.find(m => m.action === action);
    
    if (item && item.adminOnly && !this.data.isAdmin) {
      wx.showToast({
        title: '权限不足',
        icon: 'none'
      });
      return;
    }

    console.log('点击菜单项:', action);
    
    switch (action) {
      case 'editProfile':
        this.editProfile();
        break;
      case 'changePassword':
        this.changePassword();
        break;
      case 'dataBackup':
        this.toggleBackupPanel();
        break;
      case 'notifications':
        this.toggleNotifications();
        break;
      case 'userManagement':
        this.viewUserManagement();
        break;
      default:
        wx.showToast({
          title: '功能开发中',
          icon: 'none'
        });
    }
  },

  initBackupConfig: function() {
    let cfg = null
    try {
      cfg = wx.getStorageSync('backupConfig')
    } catch (_) { cfg = null }
    const ok = cfg && typeof cfg === 'object' && typeof cfg.enabled === 'boolean' && typeof cfg.mode === 'string'
    if (!ok) {
      cfg = { ...DEFAULT_BACKUP_CONFIG }
      try { wx.setStorageSync('backupConfig', cfg) } catch (_) { void 0 }
    }
    const next = {
      enabled: Boolean(cfg.enabled),
      mode: String(cfg.mode || 'manual'),
      interval: Number(cfg.interval || 0),
      nextRunAt: Number(cfg.nextRunAt || 0)
    }
    this.setData({ backupConfig: next })
  },

  refreshBackupStats: function() {
    let meta = null
    try { meta = wx.getStorageSync('lastBackupMeta') } catch (_) { meta = null }
    const ts = meta && meta.timestamp ? Number(meta.timestamp) : 0
    const size = meta && meta.size ? Number(meta.size) : 0
    const cfg = this.data.backupConfig || DEFAULT_BACKUP_CONFIG
    const nextAt = cfg && cfg.mode === 'schedule' && Number(cfg.interval || 0) > 0
      ? (Number(cfg.nextRunAt || 0) || (ts ? ts + Number(cfg.interval) * 3600 * 1000 : 0))
      : 0
    this.setData({
      backupMeta: meta,
      backupLastTimeText: formatTime(ts),
      backupSizeText: formatBytes(size),
      backupCountdownText: calcCountdownText(nextAt)
    })
  },

  startBackupCountdown: function() {
    this.stopBackupCountdown()
    const tick = () => {
      this.refreshBackupStats()
      this.maybeRunScheduledBackup()
    }
    this._backupCountdownTimer = setInterval(tick, 1000)
  },

  stopBackupCountdown: function() {
    if (this._backupCountdownTimer) {
      clearInterval(this._backupCountdownTimer)
      this._backupCountdownTimer = null
    }
  },

  maybeRunScheduledBackup: function() {
    const cfg = this.data.backupConfig || DEFAULT_BACKUP_CONFIG
    if (!cfg.enabled) return
    if (cfg.mode !== 'schedule') return
    const interval = Number(cfg.interval || 0)
    if (!(interval > 0)) return
    const nextAt = Number(cfg.nextRunAt || 0)
    if (!nextAt) return
    if (this.data.backupInProgress) return
    if (this._scheduledBackupRunning) return
    const now = Date.now()
    if (now < nextAt) return

    this._scheduledBackupRunning = true
    setTimeout(async () => {
      try {
        try { wx.showToast({ title: '定时备份执行中（仅 Wi-Fi）', icon: 'none' }) } catch (_) { void 0 }
        const res = await cloudSync.exportEncryptedBackup({ backupConfig: cfg })
        if (res && res.success) {
          const nextRunAt = Date.now() + interval * 3600 * 1000
          this.persistBackupConfig({ ...cfg, nextRunAt })
          this.refreshBackupStats()
          try { wx.showToast({ title: '定时备份完成', icon: 'success' }) } catch (_) { void 0 }
        } else if (res && res.skipped) {
          const retryAt = Date.now() + 15 * 60 * 1000
          this.persistBackupConfig({ ...cfg, nextRunAt: retryAt })
          this.refreshBackupStats()
        } else {
          const retryAt = Date.now() + 10 * 60 * 1000
          this.persistBackupConfig({ ...cfg, nextRunAt: retryAt })
          this.refreshBackupStats()
        }
      } catch (_) {
        const retryAt = Date.now() + 10 * 60 * 1000
        this.persistBackupConfig({ ...cfg, nextRunAt: retryAt })
        this.refreshBackupStats()
      } finally {
        this._scheduledBackupRunning = false
      }
    }, 0)
  },

  toggleBackupPanel: function() {
    const nextVisible = !this.data.backupVisible
    this.setData({
      backupVisible: nextVisible,
      profileEditVisible: false,
      passwordEditVisible: false,
      notificationsExpanded: false
    })
    if (nextVisible) {
      this.refreshBackupStats()
      setTimeout(() => {
        try {
          const query = wx.createSelectorQuery()
          query.select('#backupInlineForm').boundingClientRect()
          query.exec((res) => {
            const rect = res && res[0] ? res[0] : null
            if (!rect) return
            const top = Number(rect.top)
            const current = Number(this._scrollTop || 0)
            if (!Number.isFinite(top) || !Number.isFinite(current)) return
            wx.pageScrollTo({
              scrollTop: Math.max(0, current + top - 20),
              duration: 250
            })
          })
        } catch (_) { void 0 }
      }, 50)
    }
  },

  onBackupEnabledChange: function(e) {
    const enabled = Boolean(e && e.detail ? e.detail.value : false)
    const cfg = { ...(this.data.backupConfig || DEFAULT_BACKUP_CONFIG), enabled }
    this.persistBackupConfig(cfg)
  },

  onBackupModeChange: function(e) {
    const mode = e && e.detail ? String(e.detail.value || '') : ''
    const cfg = { ...(this.data.backupConfig || DEFAULT_BACKUP_CONFIG), mode: mode || 'manual' }
    if (cfg.mode !== 'schedule') {
      cfg.interval = 0
      cfg.nextRunAt = 0
    }
    this.persistBackupConfig(cfg)
  },

  onBackupIntervalChange: function(e) {
    const idx = Number(e && e.detail ? e.detail.value : 0)
    const options = [1, 6, 24]
    const interval = options[idx] || 0
    const meta = this.data.backupMeta && typeof this.data.backupMeta === 'object' ? this.data.backupMeta : null
    const ts = meta && meta.timestamp ? Number(meta.timestamp) : 0
    const nextRunAt = ts ? ts + interval * 3600 * 1000 : (Date.now() + interval * 3600 * 1000)
    const cfg = { ...(this.data.backupConfig || DEFAULT_BACKUP_CONFIG), interval, nextRunAt }
    this.persistBackupConfig(cfg)
  },

  persistBackupConfig: function(cfg) {
    const next = {
      enabled: Boolean(cfg.enabled),
      mode: String(cfg.mode || 'manual'),
      interval: Number(cfg.interval || 0),
      nextRunAt: Number(cfg.nextRunAt || 0)
    }
    try { wx.setStorageSync('backupConfig', next) } catch (_) { void 0 }
    this.setData({ backupConfig: next })
    this.refreshBackupStats()
  },

  runBackupNow: async function() {
    if (this.data.backupInProgress) return
    const cfg = this.data.backupConfig || DEFAULT_BACKUP_CONFIG
    if (!cfg.enabled) {
      wx.showToast({ title: '请先开启备份', icon: 'none' })
      return
    }

    this.setData({ backupInProgress: true, backupProgress: 8 })
    try { wx.showToast({ title: '备份开始', icon: 'none' }) } catch (_) { void 0 }
    const start = Date.now()
    let tick = null
    try {
      tick = setInterval(() => {
        const p = Number(this.data.backupProgress || 0)
        if (p >= 90) return
        this.setData({ backupProgress: Math.min(90, p + 4) })
      }, 260)
    } catch (_) { tick = null }

    try {
      const res = await cloudSync.exportEncryptedBackup({ backupConfig: cfg })
      if (res && res.success) {
        this.setData({ backupProgress: 100 })
        const interval = Number(cfg.interval || 0)
        if (cfg.mode === 'schedule' && interval > 0) {
          const nextRunAt = Date.now() + interval * 3600 * 1000
          this.persistBackupConfig({ ...cfg, nextRunAt })
        }
        this.refreshBackupStats()
        const cost = Date.now() - start
        try { wx.showToast({ title: cost < 2500 ? '备份完成' : '备份完成（后台同步中）', icon: 'success' }) } catch (_) { void 0 }
      } else {
        const msg = res && res.message ? String(res.message) : '备份失败'
        wx.showToast({ title: msg, icon: 'none' })
      }
    } catch (e) {
      const msg = e && (e.message || e.errMsg) ? String(e.message || e.errMsg) : '备份失败'
      wx.showToast({ title: msg, icon: 'none' })
    } finally {
      if (tick) clearInterval(tick)
      this.setData({ backupInProgress: false })
    }
  },

  // 编辑个人资料
  editProfile: function() {
    const userInfo = this.data.userInfo || {};
    const nextVisible = !this.data.profileEditVisible;
    this.setData({
      profileEditVisible: nextVisible,
      passwordEditVisible: false,
      profileForm: nextVisible ? {
        name: userInfo.name || '',
        companyName: userInfo.companyName || '',
        introduction: userInfo.introduction || ''
      } : this.data.profileForm
    });

    if (!nextVisible) return;
    setTimeout(() => {
      try {
        const query = wx.createSelectorQuery();
        query.select('#profileInlineForm').boundingClientRect();
        query.exec((res) => {
          const rect = res && res[0] ? res[0] : null;
          if (!rect) return;
          const top = Number(rect.top);
          const current = Number(this._scrollTop || 0);
          if (!Number.isFinite(top) || !Number.isFinite(current)) return;
          wx.pageScrollTo({
            scrollTop: Math.max(0, current + top - 20),
            duration: 250
          });
        });
      } catch (e) {}
    }, 50);
  },

  cancelEditProfile: function() {
    this.setData({ profileEditVisible: false });
  },

  onProfileInput: function(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail && typeof e.detail.value !== 'undefined' ? e.detail.value : '';
    if (!field) return;
    this.setData({
      [`profileForm.${field}`]: value
    });
  },

  saveProfile: function() {
    if (this.data.profileSaving) return;

    const form = this.data.profileForm || {};
    const name = (form.name || '').trim();
    const companyName = (form.companyName || '').trim();
    const introduction = (form.introduction || '').trim();

    if (!name) {
      wx.showToast({ title: '请输入名称', icon: 'none' });
      return;
    }

    const userId = this.data.userInfo && (this.data.userInfo.id || this.data.userInfo._id || this.data.userInfo.userId);
    if (!userId) {
      wx.showToast({ title: '缺少用户ID，请重新登录', icon: 'none' });
      return;
    }

    this.setData({ profileSaving: true });
    wx.showLoading({ title: '保存中...', mask: true });

    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'updateUserProfile',
        data: {
          id: userId,
          name,
          companyName,
          introduction
        }
      }
    }).then((res) => {
      const result = res && res.result ? res.result : {};
      if (!result.success) {
        const msg = result.message || result.error || '保存失败';
        wx.showToast({ title: msg, icon: 'none' });
        return;
      }

      const nextUserInfo = {
        ...this.data.userInfo,
        name,
        companyName,
        introduction
      };

      this.setData({
        userInfo: nextUserInfo,
        profileEditVisible: false
      });

      try {
        wx.setStorageSync('userInfo', nextUserInfo);
      } catch (e) {}

      wx.showToast({ title: '保存成功', icon: 'success' });
    }).catch((err) => {
      wx.showToast({ title: (err && err.message) ? err.message : '保存失败', icon: 'none' });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ profileSaving: false });
    });
  },

  // 修改密码
  changePassword: function() {
    const nextVisible = !this.data.passwordEditVisible;
    const userInfo = this.data.userInfo || {};
    this.setData({
      passwordEditVisible: nextVisible,
      profileEditVisible: false,
      passwordForm: nextVisible ? {
        username: userInfo.username || '',
        oldPassword: '',
        newPassword: '',
        confirmPassword: ''
      } : this.data.passwordForm
    });

    if (!nextVisible) return;
    setTimeout(() => {
      try {
        const query = wx.createSelectorQuery();
        query.select('#passwordInlineForm').boundingClientRect();
        query.exec((res) => {
          const rect = res && res[0] ? res[0] : null;
          if (!rect) return;
          const top = Number(rect.top);
          const current = Number(this._scrollTop || 0);
          if (!Number.isFinite(top) || !Number.isFinite(current)) return;
          wx.pageScrollTo({
            scrollTop: Math.max(0, current + top - 20),
            duration: 250
          });
        });
      } catch (e) {}
    }, 50);
  },

  cancelChangePassword: function() {
    this.setData({ passwordEditVisible: false });
  },

  onPasswordInput: function(e) {
    const field = e.currentTarget.dataset.field;
    const value = e.detail && typeof e.detail.value !== 'undefined' ? e.detail.value : '';
    if (!field) return;
    this.setData({
      [`passwordForm.${field}`]: value
    });
  },

  savePassword: function() {
    if (this.data.passwordSaving) return;

    const form = this.data.passwordForm || {};
    const oldPassword = String(form.oldPassword || '');
    const newPassword = String(form.newPassword || '');
    const confirmPassword = String(form.confirmPassword || '');

    if (!oldPassword) {
      wx.showToast({ title: '请输入原密码', icon: 'none' });
      return;
    }
    if (!newPassword || newPassword.length < 6) {
      wx.showToast({ title: '新密码至少6位', icon: 'none' });
      return;
    }
    if (newPassword !== confirmPassword) {
      wx.showToast({ title: '两次输入不一致', icon: 'none' });
      return;
    }

    const userId = this.data.userInfo && (this.data.userInfo.id || this.data.userInfo._id || this.data.userInfo.userId);
    if (!userId) {
      wx.showToast({ title: '缺少用户ID，请重新登录', icon: 'none' });
      return;
    }

    this.setData({ passwordSaving: true });
    wx.showLoading({ title: '保存中...', mask: true });

    wx.cloud.callFunction({
      name: 'erp-api',
      data: {
        action: 'changePassword',
        data: {
          id: userId,
          oldPassword,
          newPassword
        }
      }
    }).then((res) => {
      const result = res && res.result ? res.result : {};
      if (!result.success) {
        const msg = result.message || result.error || '保存失败';
        wx.showToast({ title: msg, icon: 'none' });
        return;
      }
      this.setData({
        passwordEditVisible: false,
        passwordForm: { username: '', oldPassword: '', newPassword: '', confirmPassword: '' }
      });
      wx.showToast({ title: '密码修改成功', icon: 'success' });
    }).catch((err) => {
      wx.showToast({ title: (err && err.message) ? err.message : '保存失败', icon: 'none' });
    }).finally(() => {
      wx.hideLoading();
      this.setData({ passwordSaving: false });
    });
  },

  // 用户管理
  viewUserManagement: function() {
    wx.navigateTo({
      url: '/pages/management-sub/management/users/users',
      fail: () => {
        wx.showToast({
          title: '页面开发中',
          icon: 'none'
        });
      }
    });
  },

  connectPrinter: function() {
    if (this.data.bluetoothInitializing) {
      return;
    }
    this.setData({ bluetoothInitializing: true });

    const stopDiscovery = () =>
      new Promise((resolve) => {
        try {
          wx.stopBluetoothDevicesDiscovery({ complete: () => resolve() });
        } catch (_) {
          resolve();
        }
      });

    const closeAdapter = () =>
      new Promise((resolve) => {
        try {
          wx.closeBluetoothAdapter({ complete: () => resolve() });
        } catch (_) {
          resolve();
        }
      });

    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const withTimeout = (promise, ms) =>
      new Promise((resolve, reject) => {
        let done = false;
        const t = setTimeout(() => {
          if (done) return;
          done = true;
          reject(Object.assign(new Error('蓝牙操作超时'), { code: 'BT_TIMEOUT' }));
        }, ms);
        promise
          .then((res) => {
            if (done) return;
            done = true;
            clearTimeout(t);
            resolve(res);
          })
          .catch((err) => {
            if (done) return;
            done = true;
            clearTimeout(t);
            reject(err);
          });
      });

    const getSetting = () =>
      new Promise((resolve) => {
        try {
          wx.getSetting({ success: (res) => resolve(res || {}), fail: () => resolve({}) });
        } catch (_) {
          resolve({});
        }
      });

    const ensurePrivacyAuthorized = () =>
      new Promise((resolve) => {
        try {
          if (typeof wx.getPrivacySetting !== 'function') return resolve();
          wx.getPrivacySetting({
            success: (res) => {
              const need = res && res.needAuthorization === true;
              if (!need || typeof wx.requirePrivacyAuthorize !== 'function') return resolve();
              wx.requirePrivacyAuthorize({ complete: () => resolve() });
            },
            fail: () => resolve()
          });
        } catch (_) {
          resolve();
        }
      });

    const ensureScope = async (scope) => {
      const usedScope = String(scope || '').trim();
      if (!usedScope) return;
      await ensurePrivacyAuthorized();
      let setting = await getSetting();
      const auth = setting && setting.authSetting ? setting.authSetting : {};
      if (auth && auth[usedScope] === true) return;
      if (typeof wx.authorize === 'function') {
        try {
          await new Promise((resolve, reject) => {
            wx.authorize({ scope: usedScope, success: resolve, fail: reject });
          });
        } catch (_) {}
      }
      setting = await getSetting();
      const auth2 = setting && setting.authSetting ? setting.authSetting : {};
      if (auth2 && auth2[usedScope] === true) return;
      const err = new Error(`permission:${usedScope}:denied`);
      err.scope = usedScope;
      throw err;
    };

    const openAdapter = async () => {
      await ensureScope('scope.bluetooth').catch(() => {});
      const openOnce = () =>
        new Promise((resolve, reject) => {
          wx.openBluetoothAdapter({
            success: resolve,
            fail: (err) => {
              const code = err && typeof err.errCode === 'number' ? err.errCode : null;
              if (code === -1) {
                resolve(err);
                return;
              }
              reject(err);
            }
          });
        });

      const openWithRetry = async () => {
        try {
          return await withTimeout(openOnce(), 6000);
        } catch (err) {
          const code = err && typeof err.errCode === 'number' ? err.errCode : null;
          const state = err && typeof err.state === 'number' ? err.state : null;
          const shouldRetry = code === 10001 || state === 1;
          if (!shouldRetry) throw err;
          await closeAdapter().catch(() => {});
          await wait(350);
          return await withTimeout(openOnce(), 6000);
        }
      };

      return openWithRetry();
    };

    const startDiscovery = () =>
      new Promise((resolve, reject) => {
        wx.startBluetoothDevicesDiscovery({ allowDuplicatesKey: false, success: resolve, fail: reject });
      });

    const getDevices = () =>
      new Promise((resolve) => {
        wx.getBluetoothDevices({
          success: (res) => resolve((res && Array.isArray(res.devices)) ? res.devices : []),
          fail: () => resolve([])
        });
      });

    const tryConnect = (deviceId) =>
      new Promise((resolve, reject) => {
        wx.createBLEConnection({ deviceId, success: resolve, fail: reject });
      });

    const closeConn = (deviceId) =>
      new Promise((resolve) => {
        try {
          wx.closeBLEConnection({ deviceId, complete: () => resolve() });
        } catch (_) {
          resolve();
        }
      });

    const ensureServices = (deviceId) =>
      new Promise((resolve, reject) => {
        wx.getBLEDeviceServices({
          deviceId,
          success: (res) => {
            const list = res && Array.isArray(res.services) ? res.services : [];
            if (!list.length) {
              reject(new Error('no services'));
              return;
            }
            resolve(list);
          },
          fail: reject
        });
      });

    const showBluetoothHelp = (title, detail) => {
      const content = detail || '请确认：1) 手机蓝牙已打开；2) 打印机已开机并处于可被发现状态；3) 安卓手机需开启定位服务并授予微信定位权限。';
      wx.showModal({
        title: title || '蓝牙不可用',
        content,
        confirmText: '去设置',
        cancelText: '知道了',
        success: (res) => {
          if (!res.confirm) return;
          try {
            if (typeof wx.openSystemBluetoothSetting === 'function' && String(title || '').includes('蓝牙')) {
              wx.openSystemBluetoothSetting({});
              return;
            }
          } catch (_) {}
          try {
            if (typeof wx.openAppAuthorizeSetting === 'function') {
              wx.openAppAuthorizeSetting({});
              return;
            }
          } catch (_) {}
          try { wx.openSetting({}); } catch (_) {}
        }
      });
    };

    if (!this._btListenersInited) {
      this._btListenersInited = true;
      this._foundDevices = {};
      try {
        wx.onBluetoothAdapterStateChange((st) => {
          if (!st) return;
          if (st.available === false) {
            this.setData({ bluetoothAvailable: false, connectedPrinterId: '', connectedPrinterName: '' });
            try {
              const app = getApp();
              if (app && app.globalData) app.globalData.printerDevice = null;
            } catch (_) {}
          }
        });
      } catch (_) {}
      try {
        wx.onBluetoothDeviceFound((res) => {
          const list = res && Array.isArray(res.devices) ? res.devices : [];
          list.forEach((d) => {
            const id = d && d.deviceId ? String(d.deviceId) : '';
            if (!id) return;
            const name = (d.name || d.localName || '').trim();
            this._foundDevices[id] = Object.assign({}, this._foundDevices[id] || {}, d, { deviceId: id, name: d.name, localName: d.localName, _displayName: name });
          });
        });
      } catch (_) {}
    }

    const finalize = () => {
      this.setData({ bluetoothInitializing: false });
    };

    Promise.resolve()
      .then(() => stopDiscovery())
      .then(() => closeAdapter())
      .then(() => wait(150))
      .then(() => openAdapter())
      .catch((err) => {
        finalize();
        const msg = (err && err.errMsg) ? String(err.errMsg) : '';
        const code = err && typeof err.errCode === 'number' ? err.errCode : null;
        const state = err && typeof err.state === 'number' ? err.state : null;
        const lowerMsg = msg.toLowerCase();
        const looksPrivacyAgreement =
          lowerMsg.includes('privacy agreement') ||
          lowerMsg.includes('privacy') ||
          msg.includes('隐私') ||
          msg.includes('协议') ||
          msg.includes('指引');
        if (code === 10001) {
          showBluetoothHelp('请打开蓝牙', '');
          return Promise.reject(err);
        }
        if (state === 3) {
          showBluetoothHelp('需要蓝牙权限', '请允许微信访问手机蓝牙权限，然后重试。');
          return Promise.reject(err);
        }
        if (state === 4) {
          showBluetoothHelp('请打开蓝牙', '检测到手机蓝牙未开启，请在系统设置中打开蓝牙后重试。');
          return Promise.reject(err);
        }
        if (code === 10008) {
          showBluetoothHelp('系统不支持蓝牙', msg ? `蓝牙初始化失败：${msg}` : '');
          return Promise.reject(err);
        }
        if (looksPrivacyAgreement) {
          showBluetoothHelp('需要补齐隐私声明', msg ? `蓝牙初始化失败：${msg}\n\n如提示“未在隐私保护指引声明/未在隐私协议声明”，请到小程序后台：设置 → 基本设置 → 服务内容声明 → 用户隐私保护指引，勾选蓝牙并发布。` : '请到小程序后台补齐隐私保护指引中的蓝牙声明后重试。');
          return Promise.reject(err);
        }
        showBluetoothHelp('蓝牙不可用', msg ? `蓝牙初始化失败：${msg}` : '蓝牙初始化失败，请检查蓝牙/定位权限。');
        return Promise.reject(err);
      })
      .then(() => stopDiscovery())
      .then(() => ensureScope('scope.userLocation').catch(() => {}))
      .then(() =>
        startDiscovery().catch((err) => {
          const msg = (err && err.errMsg) ? String(err.errMsg) : '';
          const lower = msg.toLowerCase();
          const looksLocation =
            lower.includes('location') ||
            lower.includes('gps') ||
            lower.includes('定位') ||
            lower.includes('permission') ||
            lower.includes('auth') ||
            lower.includes('denied');
          if (looksLocation) {
            showBluetoothHelp('需要定位权限', msg ? `开始搜索失败：${msg}\n\n安卓搜索蓝牙需要开启定位服务并授权微信定位。` : '安卓搜索蓝牙需要开启定位服务并授权微信定位。');
          } else {
            showBluetoothHelp('搜索失败', msg ? `开始搜索失败：${msg}` : '开始搜索失败');
          }
          return Promise.reject(err);
        })
      )
      .then(() => wait(6500))
      .then(() => stopDiscovery())
      .then(() => getDevices())
      .then((devicesRaw) => {
        const map = Object.assign({}, this._foundDevices || {});
        devicesRaw.forEach((d) => {
          const id = d && d.deviceId ? String(d.deviceId) : '';
          if (!id) return;
          const name = (d.name || d.localName || '').trim();
          map[id] = Object.assign({}, map[id] || {}, d, { deviceId: id, name: d.name, localName: d.localName, _displayName: name });
        });
        let devices = Object.keys(map)
          .map((k) => map[k])
          .filter((d) => d && d.deviceId);

        devices = devices
          .map((d) => {
            const n = (d._displayName || d.name || d.localName || '').trim();
            const showName = n || `设备 ${String(d.deviceId).slice(-6)}`;
            const rssi = typeof d.RSSI === 'number' ? d.RSSI : (typeof d.rssi === 'number' ? d.rssi : null);
            const hint = rssi == null ? '' : ` ${rssi}`;
            const display = `${showName}${hint}`;
            return Object.assign({}, d, { _displayName: showName, _displayLine: display });
          })
          .filter((d) => d._displayName);

        if (!devices.length) {
          finalize();
          showBluetoothHelp('未发现设备', '');
          return null;
        }

        const prefer = (name) => {
          const s = String(name || '').toLowerCase();
          return s.includes('print') || s.includes('printer') || s.includes('pos') || s.includes('xp') || s.includes('gp') || s.includes('bt') || s.includes('打印');
        };

        devices.sort((a, b) => {
          const pa = prefer(a._displayName) ? 1 : 0;
          const pb = prefer(b._displayName) ? 1 : 0;
          if (pa !== pb) return pb - pa;
          const ra = typeof a.RSSI === 'number' ? a.RSSI : (typeof a.rssi === 'number' ? a.rssi : -999);
          const rb = typeof b.RSSI === 'number' ? b.RSSI : (typeof b.rssi === 'number' ? b.rssi : -999);
          return rb - ra;
        });

        const maxShow = 5;
        const showList = devices.slice(0, maxShow);
        const itemList = showList.map((d) => d._displayLine);
        if (devices.length > maxShow) itemList.push('重新搜索');

        return new Promise((resolve) => {
          wx.showActionSheet({
            itemList,
            success: (sel) => {
              const index = sel && typeof sel.tapIndex === 'number' ? sel.tapIndex : -1;
              if (index === -1) {
                resolve(null);
                return;
              }
              if (devices.length > maxShow && index === itemList.length - 1) {
                resolve({ retry: true });
                return;
              }
              const device = showList[index];
              resolve({ device });
            },
            fail: () => resolve(null)
          });
        });
      })
      .then((picked) => {
        if (!picked) return null;
        if (picked.retry) {
          finalize();
          setTimeout(() => this.connectPrinter(), 0);
          return null;
        }
        const device = picked.device;
        if (!device || !device.deviceId) return null;
        const deviceId = String(device.deviceId);
        const name = (device._displayName || device.name || device.localName || deviceId).trim();

        return closeConn(deviceId)
          .then(() => wait(200))
          .then(() => withTimeout(tryConnect(deviceId), 8000))
          .catch(() => withTimeout(tryConnect(deviceId), 8000))
          .then(() => withTimeout(ensureServices(deviceId), 5000))
          .then(() => {
            const saved = { deviceId, name: device.name || device.localName || name, localName: device.localName || device.name || name };
            this.setData({
              bluetoothAvailable: true,
              connectedPrinterId: deviceId,
              connectedPrinterName: name
            });
            try {
              wx.setStorageSync('printerDevice', saved);
            } catch (_) {}
            try {
              const app = getApp();
              if (app && app.globalData) app.globalData.printerDevice = saved;
            } catch (_) {}
            wx.showToast({ title: '打印机已连接', icon: 'success' });
          })
          .catch((err) => {
            const msg = (err && err.errMsg) ? String(err.errMsg) : (err && err.message ? String(err.message) : '');
            wx.showToast({ title: msg ? `连接失败：${msg}` : '连接失败', icon: 'none' });
            return closeConn(deviceId);
          })
          .finally(() => finalize());
      })
      .catch(() => finalize());
  },

  // 退出登录
  logout: function() {
    const simpleLogin = require('../../utils/simple-login');
    
    wx.showModal({
      title: '确认退出',
      content: '确定要退出登录吗？',
      success: (res) => {
        if (res.confirm) {
          simpleLogin.logout();
          wx.reLaunch({
            url: '/pages/login/login'
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
