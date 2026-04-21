const TAB_LIST = [
  {
    pagePath: "pages/workbench/workbench",
    text: "工作台",
    iconPath: "/images/home.png",
    selectedIconPath: "/images/home-active.png"
  },
  {
    pagePath: "pages/order/order",
    text: "订单",
    iconPath: "/images/order.png",
    selectedIconPath: "/images/order-active.png"
  },
  {
    pagePath: "pages/production/production",
    text: "生产",
    iconPath: "/images/production.png",
    selectedIconPath: "/images/production-active.png"
  },
  {
    pagePath: "pages/profile/profile",
    text: "系统管理",
    iconPath: "/images/profile.png",
    selectedIconPath: "/images/profile-active.png"
  }
];

Component({
  data: {
    selected: 0,
    color: "#999999",
    selectedColor: "#1976d2",
    list: TAB_LIST
  },
  attached() {
    this._alive = true;
  },
  detached() {
    this._alive = false;
  },
  methods: {
    safeSetData(nextData) {
      if (!this._alive) return;
      this.setData(nextData);
    },
    switchTab(e) {
      const data = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset : {};
      const list = Array.isArray(this.data.list) ? this.data.list : [];
      const rawIndex = data.index;
      const index = Number(rawIndex);
      const item = Number.isFinite(index) && index >= 0 && index < list.length ? list[index] : null;
      const disabled = !!(item && item.disabled);
      const rawPath = String((item && item.pagePath) || data.path || '').trim();

      const cleanPath = rawPath.replace(/^\/+/, '').split('?')[0].split('#')[0].trim();
      const isTabBarPage = cleanPath && list.some((t) => t && t.pagePath === cleanPath);
      const finalPath = isTabBarPage ? cleanPath : String((item && item.pagePath) || '').trim().replace(/^\/+/, '').split('?')[0].split('#')[0].trim();
      const finalIsTabBarPage = finalPath && list.some((t) => t && t.pagePath === finalPath);
      const url = finalPath ? `/${finalPath}` : '';

      console.log('[TabBar] switchTab clicked. Path:', rawPath, 'Clean:', cleanPath, 'Final:', finalPath, 'Disabled:', disabled);

      if (disabled || !finalPath) return;

      if (Number.isFinite(index) && index >= 0) this.safeSetData({ selected: index });

      const page = getCurrentPages().pop();
      const route = page ? page.route : '';
      if (route && finalPath === route) return;

      wx.reLaunch({
        url,
        success: () => console.log('[TabBar] reLaunch success. IsTabBar:', !!finalIsTabBarPage),
        fail: (err) => console.error('[TabBar] reLaunch failed:', err)
      });
    },
    init() {
        if (!this._alive) return;

        const page = getCurrentPages().pop();
        const route = page ? page.route : '';

        let userInfo = null;
        try {
          userInfo = wx.getStorageSync('userInfo');
          if (!userInfo) {
            const app = getApp();
            userInfo = app.globalData.userInfo;
          }
        } catch (e) {}

        const role = userInfo && userInfo.role ? String(userInfo.role).toLowerCase() : '';
        console.log('[TabBar] init check. Role:', role);

        const list = TAB_LIST.map((item, index) => {
          let disabled = false;
          if (role === 'operator') {
            if (index === 0 || index === 1) {
              disabled = true;
            }
          }
          return { ...item, disabled };
        });

        const selected = list.findIndex((tab) => tab.pagePath === route || tab.pagePath === `/${route}`);
        this.safeSetData({ list, selected });
    }
  }
})
