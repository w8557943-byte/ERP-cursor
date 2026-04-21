const { updateData } = require('../../../utils/data-sync-utils.js');

Page({
  data: {
    orders: []
  },

  ensureCustomerShortNameMap: function () {
    if (this._customerFullToShortPromise) return this._customerFullToShortPromise;

    const callGetCustomers = () =>
      new Promise((resolve, reject) => {
        try {
          if (!wx.cloud || typeof wx.cloud.callFunction !== 'function') {
            resolve(null);
            return;
          }
          wx.cloud.callFunction({
            name: 'erp-api',
            data: { action: 'getCustomers' },
            success: resolve,
            fail: reject
          });
        } catch (e) {
          reject(e);
        }
      });

    this._customerFullToShortPromise = callGetCustomers()
      .then((res) => {
        const list = (res && res.result && (res.result.data || res.result.customers)) ? (res.result.data || res.result.customers) : [];
        const map = {};
        (Array.isArray(list) ? list : []).forEach((c) => {
          const full = (c && (c.companyName || c.name)) ? String(c.companyName || c.name) : '';
          const short = c && c.shortName ? String(c.shortName) : '';
          if (full) map[full] = short || full;
          if (short) map[short] = short;
        });
        this._customerFullToShort = map;
        return map;
      })
      .catch(() => {
        this._customerFullToShort = {};
        return {};
      });
    return this._customerFullToShortPromise;
  },

  mapCustomerShortName: function (name) {
    const n = String(name || '').trim();
    if (!n) return '';
    const m = this._customerFullToShort || {};
    return m[n] || n;
  },

  refreshOrdersCustomerName: function () {
    const current = this.data.orders || [];
    if (!current.length) return;
    this.ensureCustomerShortNameMap().then(() => {
      const next = current.map((o) => Object.assign({}, o, { customerName: this.mapCustomerShortName(o.customerName) }));
      this.setData({ orders: next });
    });
  },

  onLoad: function (options) {
    const key = options && options.key ? options.key : '';
    const raw = options && options.orders ? options.orders : '';
    const tryLoadFromKey = () => {
      if (!key) return null;
      try {
        const data = wx.getStorageSync(key);
        if (Array.isArray(data)) {
          try { wx.removeStorageSync(key); } catch (_) {}
          return data;
        }
      } catch (_) {}
      return null;
    };
    try {
      const maybe = tryLoadFromKey();
      const list = maybe || (raw ? JSON.parse(decodeURIComponent(raw)) : null);
      if (Array.isArray(list)) {
        const formatSpecMm = (spec) => {
          const s = String(spec == null ? '' : spec).trim();
          if (!s) return '-';
          if (/mm\b/i.test(s) || /cm\b/i.test(s) || /m\b/i.test(s)) return s;
          return s + 'mm';
        };
        const getQty = (o) => {
          if (o && o.quantity != null && o.quantity !== '') return o.quantity;
          if (o && o.product && o.product.quantity != null && o.product.quantity !== '') return o.product.quantity;
          return 0;
        };
        const getUnit = (o) => {
          return (o && (o.unit || (o.product && o.product.unit))) || '件';
        };
        const getSheetCount = (o) => {
          const firstItem = (o && Array.isArray(o.items) && o.items.length) ? o.items[0] : {};
          const raw = Number(
            (o && (o.sheetCount ?? o.sheet_count ?? o.sheetQty ?? o.sheet_qty)) ??
            (o && o.product && o.product.sheetCount) ??
            (firstItem && firstItem.sheetCount)
          );
          const qty = Number(getQty(o) || 0);
          return (Number.isFinite(raw) && raw > 0) ? raw : qty;
        };
        const mapped = list.map(o => {
          const items = Array.isArray(o && o.items) ? o.items : [];
          const firstItem = items[0] || {};
          const pick = (...args) => {
            for (let i = 0; i < args.length; i++) {
              const v = args[i];
              if (v != null && v !== '') return v;
            }
            return '';
          };
          const bw = pick(
            o.boardWidth, o.board_width,
            (o.product && (o.product.boardWidth || o.product.board_width)),
            firstItem.boardWidth, firstItem.board_width,
            o.paperWidth, o.boardW
          );
          const bh = pick(
            o.boardHeight, o.board_height,
            (o.product && (o.product.boardHeight || o.product.board_height)),
            firstItem.boardHeight, firstItem.board_height,
            o.paperLength, o.boardH
          );
          const sizeFromPair = (bw && bh) ? (bw + '×' + bh) : '';
          const paperSizeRaw = pick(o.paperSize, o.boardSize, o.sizeText, (o.product && o.product.paperSize));
          const sizeText = formatSpecMm(paperSizeRaw || sizeFromPair || '-');
          const c1 = Number(pick(o.creasingSize1, o.creaseSize1, o.creasing_size1, firstItem.creasingSize1, firstItem.creaseSize1, firstItem.creasing_size1, 0));
          const c2 = Number(pick(o.creasingSize2, o.creaseSize2, o.creasing_size2, firstItem.creasingSize2, firstItem.creaseSize2, firstItem.creasing_size2, 0));
          const c3 = Number(pick(o.creasingSize3, o.creaseSize3, o.creasing_size3, firstItem.creasingSize3, firstItem.creaseSize3, firstItem.creasing_size3, 0));
          const creaseProvided = pick(
            o.creaseText, o.creaseSize, o.crease_size, o.crease, o.pressLine, o.press_line, o.pressLineSize, o.press_line_size,
            firstItem.creaseText, firstItem.creaseSize, firstItem.crease_size, firstItem.crease, firstItem.pressLine, firstItem.press_line, firstItem.pressLineSize, firstItem.press_line_size,
            (o.product && (o.product.creaseText || o.product.creaseSize || o.product.crease || o.product.pressLine || o.product.press_line || o.product.pressLineSize || o.product.press_line_size))
          );
          const creaseCalc = ((c1 || c2 || c3) ? (c1 + '-' + c2 + '-' + c3) : pick(o.creasingType, o.creaseType, firstItem.creasingType, firstItem.creaseType, ''));
          const creaseText = String(creaseProvided || creaseCalc || '').trim() || '-';

          // 强制使用动态生成，确保二维码与订单信息一致
          const qrUrl = this.makeQrUrl(
            o.subOrderId || o.childOrderId || o._id || o.id,
            o.subOrderNo || o.childOrderNo || o.orderNo || o.orderNumber
          );

          const qty = getQty(o);
          const unit = getUnit(o);
          const quantityText = String(qty) + (unit ? (' ' + unit) : '');
          const sheetCount = getSheetCount(o);
          const sheetCountText = String(sheetCount) + ' 片';
          const goodsName =
            pick(
              o.goodsName, o.goods_name, o.productTitle, o.product_title, o.title, o.productName, o.product_name,
              (o.product && (o.product.title || o.product.name)),
              firstItem.goodsName, firstItem.title, firstItem.productName
            );
          const materialCode =
            pick(
              o.materialCode, o.material_code,
              (o.product && (o.product.materialCode || o.product.material_code)),
              firstItem.materialCode, firstItem.material_code
            );
          const flute =
            pick(
              o.flute, o.fluteType, o.flute_type,
              (o.product && (o.product.flute || o.product.fluteType || o.product.flute_type)),
              firstItem.flute, firstItem.fluteType, firstItem.flute_type
            );
          const materialNo =
            pick(
              o.materialNo, o.material_no,
              (o.product && (o.product.materialNo || o.product.material_no)),
              firstItem.materialNo, firstItem.material_no
            );
          const joinMethod =
            pick(
              o.joinMethod, o.bondingMethod,
              (o.product && (o.product.joinMethod || o.product.bondingMethod)),
              firstItem.joinMethod, firstItem.bondingMethod
            );
          const materialText = (function() {
            const a = String(materialCode || '').trim();
            const b = String(flute || '').trim();
            if (!a && !b) return '';
            if (a && b) return `${a} / ${b}`;
            return a || b;
          })();
          const customerName =
            o.shortName ||
            o.customerShortName ||
            o.customerName ||
            (o.customer && (o.customer.companyName || o.customer.name)) ||
            '';
          return Object.assign({}, o, {
            sizeText: sizeText,
            creaseText: creaseText,
            qrUrl: qrUrl,
            specText: formatSpecMm(pick(o.spec, o.specification, (o.product && o.product.spec), firstItem.spec, firstItem.specification)),
            quantityText: quantityText,
            sheetCount,
            sheetCountText,
            goodsName,
            customerName,
            materialCode,
            flute,
            materialNo,
            joinMethod,
            materialText
          });
        });
        this.setData({
          orders: mapped
        });
        this.refreshOrdersCustomerName();
      }
    } catch (e) { }
  },

  makeQrUrl: function (orderId, orderNo) {
    const id = String(orderId || '').trim();
    const no = String(orderNo || '').trim();
    if (!id && !no) return '';
    const payload = JSON.stringify({ v: 1, orderId: id, orderNo: no, subOrderId: id, subOrderNo: no });
    // 使用 qrserver 生成二维码图片
    return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}`;
  },

  onPrint: async function () {
    const app = getApp();
    const device = app && app.globalData ? app.globalData.printerDevice : null;
    if (!device) {
      wx.showModal({
        title: '未连接打印机',
        content: '请先在系统管理页面连接蓝牙打印机',
        showCancel: false
      });
      return;
    }
    if (!this.data.orders || !this.data.orders.length) {
      wx.showToast({
        title: '没有要打印的施工单',
        icon: 'none'
      });
      return;
    }
    const that = this;
    wx.showModal({
      title: '确认打印',
      content: '确定打印选中的施工单吗？',
      success: async (res) => {
        if (!res.confirm) return;

        wx.showLoading({ title: '正在打印...' });
        try {
          // 尝试更新订单状态，即使失败也不影响打印
          await that.updateOrderStatus().catch((err) => {
            console.error('更新订单状态失败:', err);
          });

          await that.printToBle(device.deviceId, that.data.orders);
          wx.showToast({
            title: '已发送到打印机',
            icon: 'success'
          });
        } catch (err) {
          console.error('打印过程出错:', err);
          const msg = that.getPrintErrorMessage(err);
          // 尝试提取更多错误详情
          const detail = err && err.message ? err.message : String(err);
          wx.showModal({ title: '打印失败', content: msg === detail ? msg : `${msg}\n(${detail})`, showCancel: false });
        } finally {
          wx.hideLoading();
        }
      }
    });
  },

  updateOrderStatus: function () {
    const orders = this.data.orders || [];
    if (!orders.length) return Promise.resolve();

    const isOrdered = (status) => {
      const s = String(status || '').toLowerCase();
      return s === 'ordered' || status === '已下单';
    };

    const targets = orders.filter(o => isOrdered(o && o.status));
    if (!targets.length) return Promise.resolve();

    // 使用 Promise.all + map catch 替代 Promise.allSettled 以提高兼容性
    const tasks = targets.map((o) => {
      const id = o && (o._id || o.id) ? (o._id || o.id) : '';
      const orderNo = o && (o.orderNo || o.orderNumber) ? (o.orderNo || o.orderNumber) : '';
      const payload = { id, orderNo, orderNumber: orderNo, status: 'pending' };
      if (!payload.id) delete payload.id;
      if (!payload.orderNo) delete payload.orderNo;
      if (!payload.orderNumber) delete payload.orderNumber;
      // 捕获单个更新失败，模拟 allSettled
      return updateData('orders', payload).catch(e => {
        console.warn('单个订单状态更新失败:', orderNo, e);
        return null;
      });
    });

    return Promise.all(tasks).then(() => { });
  },

  printToBle: async function (deviceId, orders) {
    await this.ensureAdapter();
    await this.ensureConnection(deviceId);
    const st = await this.getBleConnectionState(deviceId);
    if (st && st.connected === false) {
      await this.ensureConnection(deviceId);
    }
    const serviceId = await this.getWritableService(deviceId);
    const characteristicId = await this.getWritableCharacteristic(deviceId, serviceId);
    for (let i = 0; i < orders.length; i++) {
      const o = orders[i];
      const text = this.buildOrderText(o);
      const bufferText = await this.encodeGb18030FromCloud(text);
      await this.writeInChunks(deviceId, serviceId, characteristicId, bufferText);
      const qrBuffer = this.buildQrBuffer(o);
      if (qrBuffer) {
        await this.writeInChunks(deviceId, serviceId, characteristicId, qrBuffer);
      }
    }
    const cutBuffer = this.buildCutBuffer();
    if (cutBuffer) {
      await this.writeInChunks(deviceId, serviceId, characteristicId, cutBuffer);
    }
  },

  ensureAdapter: function () {
    const getSetting = () =>
      new Promise((resolve) => {
        try {
          wx.getSetting({ success: (res) => resolve(res || {}), fail: () => resolve({}) });
        } catch (_) {
          resolve({});
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

    const ensureScopeBluetooth = () =>
      ensurePrivacyAuthorized()
        .then(() => getSetting())
        .then((setting) => {
          const auth = setting && setting.authSetting ? setting.authSetting : {};
          if (auth && auth['scope.bluetooth'] === true) return;
          if (typeof wx.authorize === 'function') {
            return new Promise((resolve, reject) => {
              wx.authorize({ scope: 'scope.bluetooth', success: resolve, fail: reject });
            }).catch(() => { });
          }
        });

    const showHelp = (title, content) => {
      wx.showModal({
        title: title || '蓝牙不可用',
        content: content || '请在"系统管理"里先连接蓝牙打印机，并确认手机蓝牙已打开。',
        confirmText: '去设置',
        cancelText: '知道了',
        success: (res) => {
          if (!res.confirm) return;
          try {
            if (typeof wx.openSystemBluetoothSetting === 'function' && String(title || '').includes('蓝牙')) {
              wx.openSystemBluetoothSetting({});
              return;
            }
          } catch (_) { }
          try {
            if (typeof wx.openAppAuthorizeSetting === 'function') {
              wx.openAppAuthorizeSetting({});
              return;
            }
          } catch (_) { }
          try { wx.openSetting({}); } catch (_) { }
        }
      });
    };

    const openOnce = () =>
      new Promise((resolve, reject) => {
        wx.openBluetoothAdapter({
          success: resolve,
          fail: (err) => {
            const code = err && typeof err.errCode === 'number' ? err.errCode : null;
            if (code === -1) return resolve(err);
            reject(err);
          }
        });
      });

    const openWithRetry = () =>
      Promise.resolve()
        .then(() => closeAdapter())
        .then(() => wait(150))
        .then(() => openOnce())
        .catch((err) => {
          const code = err && typeof err.errCode === 'number' ? err.errCode : null;
          const state = err && typeof err.state === 'number' ? err.state : null;
          const shouldRetry = code === 10001 || state === 1;
          if (!shouldRetry) return Promise.reject(err);
          return Promise.resolve()
            .then(() => closeAdapter())
            .then(() => wait(350))
            .then(() => openOnce());
        });

    return ensureScopeBluetooth()
      .then(() => openWithRetry())
      .catch((err) => {
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
        if (code === 10001 || state === 4) {
          showHelp('请打开蓝牙', '检测到手机蓝牙未开启，请开启蓝牙后重试。');
        } else if (state === 3) {
          showHelp('需要蓝牙权限', '请允许微信访问手机蓝牙权限后重试。');
        } else if (looksPrivacyAgreement) {
          showHelp('需要补齐隐私声明', msg ? `蓝牙初始化失败：${msg}\n\n如提示"未在隐私保护指引声明/未在隐私协议声明"，请到小程序后台：设置 → 基本设置 → 服务内容声明 → 用户隐私保护指引，勾选蓝牙并发布。` : '请到小程序后台补齐隐私保护指引中的蓝牙声明后重试。');
        } else {
          showHelp('蓝牙不可用', msg ? `蓝牙初始化失败：${msg}` : '蓝牙初始化失败');
        }
        throw err;
      });
  },

  ensureConnection: function (deviceId) {
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const closeConn = () =>
      new Promise((resolve) => {
        try {
          wx.closeBLEConnection({ deviceId, complete: () => resolve() });
        } catch (_) {
          resolve();
        }
      });
    const connectOnce = () =>
      new Promise((resolve, reject) => {
        wx.createBLEConnection({ deviceId, success: resolve, fail: reject });
      });
    const isAlready = (err) => {
      const code = err && typeof err.errCode === 'number' ? err.errCode : null;
      const msg = err && err.errMsg ? String(err.errMsg) : '';
      const lower = msg.toLowerCase();
      return (
        code === -1 ||
        lower.includes('already') ||
        lower.includes('connected') ||
        msg.includes('已连接') ||
        msg.includes('已经连接')
      );
    };
    const wrap = (err) => {
      const msg = err && (err.errMsg || err.message) ? String(err.errMsg || err.message) : '';
      const code = err && typeof err.errCode === 'number' ? err.errCode : null;
      const suffix = code == null ? '' : `（${code}）`;
      return new Error(msg ? `连接打印机失败：${msg}${suffix}` : `连接打印机失败${suffix}`);
    };
    return connectOnce().catch(async (err) => {
      if (isAlready(err)) return;
      const code = err && typeof err.errCode === 'number' ? err.errCode : null;
      const msg = err && err.errMsg ? String(err.errMsg) : '';
      const lower = msg.toLowerCase();
      const shouldRetry =
        code === 10003 ||
        code === 10006 ||
        lower.includes('fail to connect') ||
        lower.includes('disconnected') ||
        lower.includes('not connected') ||
        msg.includes('断开');
      if (!shouldRetry) throw wrap(err);
      await closeConn();
      await wait(220);
      try {
        await connectOnce();
      } catch (err2) {
        if (isAlready(err2)) return;
        throw wrap(err2);
      }
    });
  },

  getBleConnectionState: function (deviceId) {
    return new Promise((resolve) => {
      try {
        if (typeof wx.getBLEConnectionState !== 'function') {
          resolve({ connected: true });
          return;
        }
        wx.getBLEConnectionState({
          deviceId,
          success: (res) => resolve(res || {}),
          fail: () => resolve({ connected: false })
        });
      } catch (_) {
        resolve({ connected: true });
      }
    });
  },

  getPrintErrorMessage: function (err) {
    const code = err && typeof err.errCode === 'number' ? err.errCode : null;
    const msg = err && (err.errMsg || err.message) ? String(err.errMsg || err.message) : '';
    if (code === 10001) return '蓝牙未初始化或未开启，请打开手机蓝牙后重试';
    if (code === 10002) return '当前设备不支持蓝牙或蓝牙不可用';
    if (code === 10003) return '连接打印机失败，请确认打印机已开机并处于可被发现状态';
    if (code === 10004) return '未找到打印机服务，请重新连接打印机后再试';
    if (code === 10005) return '未找到可写特征值，请重新连接打印机后再试';
    if (code === 10006) return '蓝牙连接已断开，请靠近打印机并重新连接';
    if (code === 10007) return '打印机不支持写入，请更换打印机或重新连接';
    if (code === 10008) return '系统不支持蓝牙或未开启相关能力';
    if (msg) return msg;
    return '请检查打印机是否开机、蓝牙是否连接';
  },

  getWritableService: async function (deviceId) {
    const getServices = () =>
      new Promise((resolve, reject) => {
        wx.getBLEDeviceServices({
          deviceId,
          success: resolve,
          fail: reject
        });
      });

    const getCharacteristics = (serviceId) =>
      new Promise((resolve, reject) => {
        wx.getBLEDeviceCharacteristics({
          deviceId,
          serviceId,
          success: resolve,
          fail: reject
        });
      });

    const isWritable = (c) => c && c.properties && (c.properties.writeNoResponse || c.properties.write);

    try {
      const res = await getServices();
      const list = Array.isArray(res && res.services) ? res.services : [];
      const services = list
        .slice()
        .sort((a, b) => (b && b.isPrimary ? 1 : 0) - (a && a.isPrimary ? 1 : 0));

      for (let i = 0; i < services.length; i++) {
        const s = services[i];
        const serviceId = s && s.uuid ? s.uuid : '';
        if (!serviceId) continue;
        try {
          const chRes = await getCharacteristics(serviceId);
          const chList = Array.isArray(chRes && chRes.characteristics) ? chRes.characteristics : [];
          const ch = chList.find(isWritable);
          if (ch) return serviceId;
        } catch (_) { }
      }
      throw new Error('未找到可写服务，请重新连接打印机');
    } catch (e) {
      throw e;
    }
  },

  getWritableCharacteristic: function (deviceId, serviceId) {
    return new Promise((resolve, reject) => {
      wx.getBLEDeviceCharacteristics({
        deviceId,
        serviceId,
        success: (res) => {
          const list = res.characteristics || [];
          const ch = list.find(c => c.properties && (c.properties.writeNoResponse || c.properties.write));
          if (!ch) {
            reject(new Error('未找到可写特征值，请重新连接打印机'));
            return;
          }
          resolve(ch.uuid);
        },
        fail: (err) => {
          reject(err);
        }
      });
    });
  },

  buildOrderText: function (o) {
    const size = o.sizeText || '';
    const crease = o.creaseText || '';
    const materialCode = o.materialCode || (o.product && o.product.materialCode) || '-';
    const flute = o.flute || (o.product && o.product.flute) || '';
    const joinMethod = o.joinMethod || '-';
    const notes = o.notes || '';
    const s = [];
    const init = '\x1B\x40'
    const lineHeight = '\x1B\x33\x30'
    const alignCenter = '\x1B\x61\x01'
    const alignLeft = '\x1B\x61\x00'
    const titleSize = '\x1D\x21\x11'
    const bodySize = '\x1D\x21\x01'
    const boldOn = '\x1B\x45\x01'
    const fontStandard = '\x1B\x4D\x00'
    const leftMargin = '\x1D\x4C\x00\x00'
    const printAreaWidth = '\x1D\x57\x40\x02'

    const textWidth = (text) => {
      const str = String(text || '')
      let w = 0
      for (let i = 0; i < str.length; i++) {
        const code = str.charCodeAt(i)
        w += code <= 0x7f ? 1 : 2
      }
      return w
    }

    const spaces = (n) => (n > 0 ? new Array(n + 1).join(' ') : '')

    const wrapByWidth = (text, maxWidth) => {
      const str = String(text == null ? '' : text)
      const lines = []
      let cur = ''
      let curW = 0
      for (let i = 0; i < str.length; i++) {
        const ch = str[i]
        const chW = ch.charCodeAt(0) <= 0x7f ? 1 : 2
        if (maxWidth > 0 && curW + chW > maxWidth) {
          if (cur) lines.push(cur)
          cur = ch
          curW = chW
        } else {
          cur += ch
          curW += chW
        }
      }
      if (cur) lines.push(cur)
      return lines.length ? lines : ['']
    }

    const makeRowLines = (label, value, opt) => {
      const totalWidth = 24
      const labelText = label ? String(label) : ''
      const prefixRaw = labelText ? `${labelText}：` : ''
      const prefixW = textWidth(prefixRaw)
      const rawValue = value == null ? '' : String(value)

      if (labelText && opt && opt.noWrap) {
        const one = rawValue.replace(/\r?\n/g, ' ')
        return [prefixRaw + ' ' + one]
      }

      if (!labelText) {
        const segs = String(rawValue).split(/\r?\n/)
        const out = []
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i]
          const lines = wrapByWidth(seg, totalWidth)
          for (let j = 0; j < lines.length; j++) out.push(lines[j])
        }
        return out.length ? out : ['']
      }

      const minValueWidth = 4
      const firstMax = totalWidth - prefixW - 1
      if (firstMax < minValueWidth) {
        const out = []
        const prefixLines = wrapByWidth(prefixRaw, totalWidth)
        for (let i = 0; i < prefixLines.length; i++) out.push(prefixLines[i])
        const segs = String(rawValue).split(/\r?\n/)
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i]
          const lines = wrapByWidth(seg, totalWidth)
          for (let j = 0; j < lines.length; j++) out.push(lines[j])
        }
        return out.length ? out : [prefixRaw]
      }

      const indent = '  '
      const indentW = textWidth(indent)
      const nextMax = Math.max(1, totalWidth - indentW)
      const segs = String(rawValue).split(/\r?\n/)
      const out = []

      const firstSeg = segs.length ? segs[0] : ''
      const firstParts = wrapByWidth(firstSeg, firstMax)
      out.push(prefixRaw + ' ' + (firstParts[0] || ''))

      const pushIndentedLines = (text) => {
        const parts = wrapByWidth(text, nextMax)
        for (let i = 0; i < parts.length; i++) out.push(indent + parts[i])
      }

      if (firstParts.length > 1) {
        const rest = firstParts.slice(1).join('')
        if (rest) pushIndentedLines(rest)
      }

      for (let i = 1; i < segs.length; i++) {
        pushIndentedLines(segs[i])
      }

      return out.length ? out : [prefixRaw]
    }

    const pushRow = (label, value, opt) => {
      const lines = makeRowLines(label, value, opt)
      for (let i = 0; i < lines.length; i++) s.push(lines[i])
    }

    const formatSpecMm = (spec) => {
      const str = String(spec == null ? '' : spec).trim()
      if (!str) return '-'
      if (/mm\b/i.test(str) || /cm\b/i.test(str) || /m\b/i.test(str)) return str
      return str + 'mm'
    }

    const qty = (o && o.quantity != null && o.quantity !== '') ? o.quantity : ((o && o.product && o.product.quantity != null && o.product.quantity !== '') ? o.product.quantity : 0)
    const unit = (o && (o.unit || (o.product && o.product.unit))) || '件'
    const qtyText = String(qty) + (unit ? (' ' + unit) : '')
    const sheetCount = (o && o.sheetCount != null && o.sheetCount !== '') ? o.sheetCount : ((o && o.product && o.product.sheetCount != null && o.product.sheetCount !== '') ? o.product.sheetCount : ((o && o.totalQty != null && o.totalQty !== '') ? o.totalQty : ((o && o.plannedQuantity != null && o.plannedQuantity !== '') ? o.plannedQuantity : qty)))
    const sheetCountText = String(sheetCount) + ' 片'
    const specText = formatSpecMm((o && (o.spec || (o.product && o.product.spec))) || '')

    s.push(init + fontStandard + leftMargin + printAreaWidth + lineHeight + alignCenter + boldOn + titleSize + '施工单' + bodySize)
    s.push(alignLeft + boldOn)

    pushRow('订单号', o.orderNo || '-')
    pushRow('客户名称', o.customerName || '-')
    pushRow('产品类别', o.productName || '-')
    pushRow('规格', specText)
    pushRow('纸板尺寸', size || '-')
    pushRow('压线尺寸', crease || '-', { noWrap: true })
    pushRow('数量', qtyText)
    pushRow('下单数量', sheetCountText)
    pushRow('材质编码/楞别', materialCode + (flute ? (' / ' + flute) : ''), { noWrap: true })
    pushRow('物料号', o.materialNo || '-')
    pushRow('商品名称', o.goodsName || '-')
    pushRow('拼接方式', joinMethod || '-')
    pushRow('备注', notes || '-')
    s.push(alignCenter + boldOn + '订单二维码：')
    s.push('\x1B\x64\x01')
    return s.join('\r\n')
  },

  encodeGb18030FromCloud: function (text) {
    return new Promise((resolve, reject) => {
      if (!wx.cloud || !wx.cloud.callFunction) {
        const fallback = this.encodeUtf8(text);
        resolve(fallback);
        return;
      }
      wx.cloud.callFunction({
        name: 'erp-api',
        data: {
          action: 'encodeGb18030',
          data: { text }
        },
        success: (res) => {
          const result = res && res.result ? res.result : null;
          if (!result || !result.success || !result.data || !result.data.base64) {
            const fallback = this.encodeUtf8(text);
            resolve(fallback);
            return;
          }
          const base64 = result.data.base64;
          if (wx.base64ToArrayBuffer) {
            const buffer = wx.base64ToArrayBuffer(base64);
            resolve(buffer);
          } else {
            const buffer = this.base64ToArrayBufferFallback(base64);
            resolve(buffer);
          }
        },
        fail: () => {
          const fallback = this.encodeUtf8(text);
          resolve(fallback);
        }
      });
    });
  },

  base64ToArrayBufferFallback: function (base64) {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
    let str = String(base64 || '').replace(/=+$/, '');
    const len = str.length;
    const bytes = [];
    let i = 0;
    while (i < len) {
      const enc1 = chars.indexOf(str.charAt(i++));
      const enc2 = chars.indexOf(str.charAt(i++));
      const enc3 = chars.indexOf(str.charAt(i++));
      const enc4 = chars.indexOf(str.charAt(i++));
      const c1 = (enc1 << 2) | (enc2 >> 4);
      const c2 = ((enc2 & 15) << 4) | (enc3 >> 2);
      const c3 = ((enc3 & 3) << 6) | enc4;
      bytes.push(c1);
      if (enc3 !== 64 && enc3 !== -1) {
        bytes.push(c2);
      }
      if (enc4 !== 64 && enc4 !== -1) {
        bytes.push(c3);
      }
    }
    const buffer = new ArrayBuffer(bytes.length);
    const view = new Uint8Array(buffer);
    for (let j = 0; j < bytes.length; j++) {
      view[j] = bytes[j];
    }
    return buffer;
  },

  buildQrBuffer: function (o) {
    const code = o && (o.orderNo || o.orderNumber || '');
    if (!code) {
      return null;
    }
    const data = String(code);
    const bytes = [];
    for (let i = 0; i < data.length; i++) {
      const c = data.charCodeAt(i);
      bytes.push(c & 0xff);
    }
    const storeLen = bytes.length + 3;
    const pL = storeLen & 0xff;
    const pH = (storeLen >> 8) & 0xff;
    const list = [];
    list.push(0x1B, 0x61, 0x01);
    list.push(0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
    list.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x09);
    list.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31);
    list.push(0x1D, 0x28, 0x6B, pL, pH, 0x31, 0x50, 0x30);
    for (let i = 0; i < bytes.length; i++) {
      list.push(bytes[i]);
    }
    list.push(0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30);
    list.push(0x1B, 0x61, 0x00);
    list.push(0x1B, 0x64, 0x01);
    const buffer = new ArrayBuffer(list.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < list.length; i++) {
      view[i] = list[i];
    }
    return buffer;
  },

  buildCutBuffer: function () {
    const list = [];
    list.push(0x1B, 0x64, 0x03);
    list.push(0x1D, 0x56, 0x01);
    const buffer = new ArrayBuffer(list.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < list.length; i++) {
      view[i] = list[i];
    }
    return buffer;
  },

  encodeUtf8: function (str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      if (code < 0x80) {
        bytes.push(code);
      } else if (code < 0x800) {
        bytes.push(0xc0 | (code >> 6));
        bytes.push(0x80 | (code & 0x3f));
      } else if (code < 0x10000) {
        bytes.push(0xe0 | (code >> 12));
        bytes.push(0x80 | ((code >> 6) & 0x3f));
        bytes.push(0x80 | (code & 0x3f));
      } else {
        bytes.push(0xf0 | (code >> 18));
        bytes.push(0x80 | ((code >> 12) & 0x3f));
        bytes.push(0x80 | ((code >> 6) & 0x3f));
        bytes.push(0x80 | (code & 0x3f));
      }
    }
    const buffer = new ArrayBuffer(bytes.length);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) {
      view[i] = bytes[i];
    }
    return buffer;
  },

  writeInChunks: async function (deviceId, serviceId, characteristicId, buffer) {
    const max = 20;
    const delayMs = 20;
    const total = buffer.byteLength;
    const view = new Uint8Array(buffer);
    const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    const shouldRetryWrite = (err) => {
      const code = err && typeof err.errCode === 'number' ? err.errCode : null;
      const msg = err && (err.errMsg || err.message) ? String(err.errMsg || err.message) : '';
      const lower = msg.toLowerCase();
      return (
        code === 10006 ||
        code === 10003 ||
        lower.includes('disconnected') ||
        lower.includes('not connected') ||
        lower.includes('timeout') ||
        msg.includes('断开')
      );
    };
    const writeOnce = (value) =>
      new Promise((resolve, reject) => {
        wx.writeBLECharacteristicValue({
          deviceId,
          serviceId,
          characteristicId,
          value,
          success: () => resolve(),
          fail: (err) => reject(err)
        });
      });

    let offset = 0;
    while (offset < total) {
      const len = Math.min(max, total - offset);
      const chunk = new ArrayBuffer(len);
      const chunkView = new Uint8Array(chunk);
      for (let i = 0; i < len; i++) chunkView[i] = view[offset + i];
      offset += len;
      try {
        await writeOnce(chunk);
      } catch (err) {
        if (!shouldRetryWrite(err)) throw err;
        await this.ensureConnection(deviceId).catch(() => { });
        await wait(160);
        await writeOnce(chunk);
      }
      if (delayMs > 0) await wait(delayMs);
    }
  }
});
