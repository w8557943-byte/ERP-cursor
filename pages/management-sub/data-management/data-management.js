const echarts = require('../components/ec-canvas/echarts');
const { callERPAPI, showCloudError } = require('../../../utils/cloud');

function toNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function startOfMonthTs(ts) {
  const d = new Date(ts);
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfMonthTs(ts) {
  const d = new Date(ts);
  d.setMonth(d.getMonth() + 1, 1);
  d.setHours(0, 0, 0, 0);
  return d.getTime() - 1;
}

function formatMoney(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '0.00';
  return n.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function formatPercent(v) {
  const n = Number(v || 0);
  if (!Number.isFinite(n)) return '0.0';
  return n.toFixed(1);
}

function formatDate(ts) {
  const d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '-';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function buildWaterfallSeries(labels, values) {
  const assist = [];
  const real = [];
  let acc = 0;
  for (let i = 0; i < values.length; i += 1) {
    const v = toNumber(values[i]);
    if (i === 0) {
      assist.push(0);
      real.push(v);
      acc = v;
      continue;
    }
    if (i === values.length - 1) {
      assist.push(0);
      real.push(v);
      continue;
    }
    assist.push(acc);
    real.push(v);
    acc = acc + v;
  }
  return {
    labels,
    assist,
    real
  };
}

Page({
  data: {
    activeTab: 'business',
    rangeText: '',
    loading: false,
    salesTrendRange: 'month',
    businessStats: {
      monthSalesText: '0.00',
      todaySalesText: '0.00',
      monthGrossProfitText: '0.00',
      monthGrossMarginText: '0.0',
      monthYoYText: '0.0'
    },
    costStats: {
      lastMonthProductionCostText: '0.00',
      lastMonthPurchaseCostText: '0.00',
      lastMonthScrapCostText: '0.00',
      lastMonthRawMaterialPurchaseCostText: '0.00',
      lastMonthSalaryCostText: '0.00',
      lastMonthFixedCostText: '0.00'
    },
    financeStats: {
      monthInvoicedText: '0.00',
      monthInputText: '0.00',
      monthOverdueUnpaidText: '0.00',
      monthTaxText: '0.00'
    },
    overallStats: {
      lastMonthSalesText: '0.00',
      lastMonthProductionCostText: '0.00',
      lastMonthSalaryCostText: '0.00',
      lastMonthFixedCostText: '0.00',
      lastMonthProfitText: '0.00'
    },
    salesTrendEc: { lazyLoad: true },
    costStructureEc: { lazyLoad: true },
    incomeExpenseEc: { lazyLoad: true },
    profitCompositionEc: { lazyLoad: true }
  },

  ensureAllowed: function() {
    let userInfo = null;
    try {
      userInfo = wx.getStorageSync('userInfo') || null;
    } catch (e) {}
    const role = userInfo && userInfo.role ? String(userInfo.role).toLowerCase() : '';
    if (role === 'operator') {
      wx.showToast({ title: '无权限访问', icon: 'none' });
      setTimeout(() => {
        wx.switchTab({ url: '/pages/production/production' });
      }, 600);
      return false;
    }
    return true;
  },

  onLoad() {
    if (!this.ensureAllowed()) return;
    const now = Date.now();
    const s = startOfMonthTs(now);
    const e = endOfMonthTs(now);
    this.setData({ rangeText: `${formatDate(s)} 至 ${formatDate(e)}` });
    this.loadAll();
  },

  onShow() {
    if (!this.ensureAllowed()) return;
    if (this.data.loading) return;
    this.loadAll();
  },

  onHide() {
    this.stopRealtimeSync();
  },

  onUnload() {
    this.stopRealtimeSync();
    this.disposeTabCharts(this.data.activeTab);
  },

  onPullDownRefresh() {
    this.loadAll().finally(() => wx.stopPullDownRefresh());
  },

  onReady() {
    this.tryInitCharts();
  },

  switchTab(e) {
    const tab = e?.currentTarget?.dataset?.tab;
    if (!tab || tab === this.data.activeTab) return;
    const prevTab = this.data.activeTab;
    this.disposeTabCharts(prevTab);
    this.setData({ activeTab: tab }, () => {
      this.tryInitCharts();
    });
  },

  switchSalesTrendRange(e) {
    const range = e?.currentTarget?.dataset?.range;
    if (!range || range === this.data.salesTrendRange) return;
    this.setData({ salesTrendRange: range }, () => {
      this.loadAll();
    });
  },

  async loadAll() {
    if (this.data.loading) return;
    this.setData({ loading: true });
    try {
      let userId = ''
      try {
        const userInfo = wx.getStorageSync('userInfo') || {}
        userId = String(userInfo.id || userInfo._id || userInfo.userId || '').trim()
      } catch (e) {
        userId = ''
      }
      const res = await callERPAPI(
        'getDataManagementStats',
        { params: userId ? { salesTrendRange: this.data.salesTrendRange, userId } : { salesTrendRange: this.data.salesTrendRange } },
        false
      );
      const stats = res?.data || {};
      const business = stats.business || {};
      const cost = stats.cost || {};
      const finance = stats.finance || {};
      const overall = stats.overall || {};

      this.setData({
        businessStats: {
          monthSalesText: formatMoney(business.monthSales),
          todaySalesText: formatMoney(business.todaySales),
          monthYoYText: formatPercent(business.monthYoY),
          monthGrossMarginText: formatPercent(business.monthGrossMargin),
          monthGrossProfitText: formatMoney(business.monthGrossProfit)
        },
        costStats: {
          lastMonthProductionCostText: formatMoney(cost.lastMonthProductionCost),
          lastMonthPurchaseCostText: formatMoney(cost.lastMonthPurchaseCost),
          lastMonthScrapCostText: formatMoney(cost.lastMonthScrapCost),
          lastMonthRawMaterialPurchaseCostText: formatMoney(cost.lastMonthRawMaterialPurchaseCost),
          lastMonthSalaryCostText: formatMoney(cost.lastMonthSalaryCost),
          lastMonthFixedCostText: formatMoney(cost.lastMonthFixedCost)
        },
        financeStats: {
          monthInvoicedText: formatMoney(finance.monthInvoiced),
          monthInputText: formatMoney(finance.monthInput),
          monthOverdueUnpaidText: formatMoney(finance.monthOverdueUnpaid),
          monthTaxText: formatMoney(finance.monthTax)
        },
        overallStats: {
          lastMonthSalesText: formatMoney(overall.lastMonthSales),
          lastMonthProductionCostText: formatMoney(overall.lastMonthProductionCost),
          lastMonthSalaryCostText: formatMoney(overall.lastMonthSalaryCost),
          lastMonthFixedCostText: formatMoney(overall.lastMonthFixedCost),
          lastMonthProfitText: formatMoney(overall.lastMonthProfit)
        }
      });

      this._chartData = stats.chartData || {};

      this.tryInitCharts(true);
    } catch (e) {
      showCloudError(e, '加载数据失败');
    } finally {
      this.setData({ loading: false });
    }
  },

  startRealtimeSync() {
    if (this._realtimeSyncStarted) return;
    this._realtimeSyncStarted = true;

    if (!this._realtimeWatchRetryDelay) this._realtimeWatchRetryDelay = 1000;
    this.startRealtimeWatchers();
  },

  startRealtimeWatchers() {
    const db = wx.cloud?.database?.();
    if (!db || !db.collection) {
      this.startRealtimeFallbackPolling();
      return;
    }

    this.stopRealtimeWatchers();

    const startWatch = (collectionName) => {
      try {
        const listener = db.collection(collectionName).watch({
          onChange: (snapshot) => {
            const t = snapshot?.type;
            if (t === 'init') {
              this._realtimeWatchRetryDelay = 1000;
              this.stopRealtimeFallbackPolling();
              return;
            }
            this.scheduleRealtimeReload();
          },
          onError: () => {
            try {
              listener?.close?.();
            } catch (_) {}
            this.startRealtimeFallbackPolling();
            this.scheduleRealtimeWatchRetry();
          }
        });
        this._realtimeListeners = this._realtimeListeners || [];
        this._realtimeListeners.push(listener);
        return true;
      } catch (_) {
        return false;
      }
    };

    const ok = [
      startWatch('orders'),
      startWatch('purchase_orders'),
      startWatch('employees'),
      startWatch('fixed_costs'),
      startWatch('payables')
    ].some(Boolean);
    if (!ok) {
      this.startRealtimeFallbackPolling();
      this.scheduleRealtimeWatchRetry();
    }
  },

  startRealtimeFallbackPolling() {
    if (this._realtimePollTimer) return;
    this._realtimePollTimer = setInterval(() => {
      this.scheduleRealtimeReload();
    }, 15000);
  },

  stopRealtimeFallbackPolling() {
    if (!this._realtimePollTimer) return;
    clearInterval(this._realtimePollTimer);
    this._realtimePollTimer = null;
  },

  scheduleRealtimeWatchRetry() {
    if (this._realtimeWatchRetryTimer) return;
    const delay = Math.min(Math.max(1000, Number(this._realtimeWatchRetryDelay || 1000)), 60000);
    this._realtimeWatchRetryTimer = setTimeout(() => {
      this._realtimeWatchRetryTimer = null;
      this._realtimeWatchRetryDelay = Math.min(delay * 2, 60000);
      if (!this._realtimeSyncStarted) return;
      this.startRealtimeWatchers();
    }, delay);
  },

  stopRealtimeWatchers() {
    const list = Array.isArray(this._realtimeListeners) ? this._realtimeListeners : [];
    list.forEach((listener) => {
      try {
        listener?.close?.();
      } catch (_) {}
    });
    this._realtimeListeners = [];
  },

  stopRealtimeSync() {
    this._realtimeSyncStarted = false;

    if (this._realtimeReloadTimer) {
      clearTimeout(this._realtimeReloadTimer);
      this._realtimeReloadTimer = null;
    }

    if (this._realtimePollTimer) {
      clearInterval(this._realtimePollTimer);
      this._realtimePollTimer = null;
    }

    if (this._realtimeWatchRetryTimer) {
      clearTimeout(this._realtimeWatchRetryTimer);
      this._realtimeWatchRetryTimer = null;
    }

    this.stopRealtimeWatchers();
  },

  scheduleRealtimeReload() {
    if (this._realtimeReloadTimer) return;
    this._realtimeReloadTimer = setTimeout(() => {
      this._realtimeReloadTimer = null;
      this.loadAll();
    }, 600);
  },

  disposeTabCharts(tabKey) {
    const map = {
      business: ['salesTrendChart'],
      finance: ['incomeExpenseChart']
    };
    const ids = map[tabKey] || [];
    if (!this._charts) this._charts = {};
    if (!this._chartInited) this._chartInited = {};
    ids.forEach((id) => {
      const chart = this._charts[id];
      try {
        chart?.dispose?.();
      } catch (_) {}
      delete this._charts[id];
      delete this._chartInited[id];
    });
  },

  tryInitCharts(force = false) {
    const active = this.data.activeTab;
    if (!this._chartData) return;
    if (!this._chartInited) this._chartInited = {};
    if (!this._charts) this._charts = {};

    const initOne = (id, getter) => {
      const chart = this._charts[id];
      if (this._chartInited[id] && chart && typeof chart.setOption === 'function') {
        if (force) {
          try {
            chart.setOption(getter());
          } catch (_) {}
        }
        return;
      }
      const comp = this.selectComponent(`#${id}`);
      if (!comp || !comp.init) return;
      comp.init((canvas, width, height, dpr) => {
        const created = echarts.init(canvas, null, { width, height, devicePixelRatio: dpr });
        canvas.setChart(created);
        created.setOption(getter());
        if (id === 'salesTrendChart') {
          this.bindSalesTrendClick(created);
        }
        this._chartInited[id] = true;
        this._charts[id] = created;
        return created;
      });
    };

    if (active === 'business') {
      initOne('salesTrendChart', () => this.getSalesTrendOption());
    }
    if (active === 'finance') {
      initOne('incomeExpenseChart', () => this.getIncomeExpenseOption());
    }
  },

  getSalesTrendOption() {
    const data = Array.isArray(this._chartData?.trendByDay) ? this._chartData.trendByDay : [];
    const labels = data.map((d) => d.label || d.date || '');
    const values = data.map((d) => toNumber(d.value));
    return {
      grid: { left: 40, right: 20, top: 30, bottom: 40 },
      tooltip: { trigger: 'axis' },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: '#6b7280', fontSize: 10, interval: Math.max(0, Math.floor(labels.length / 6)) }
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#6b7280', fontSize: 10 },
        splitLine: { lineStyle: { color: '#eef2f7' } }
      },
      series: [
        {
          name: '销售额',
          type: 'line',
          data: values,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          lineStyle: { color: '#4f46e5', width: 3 },
          itemStyle: { color: '#4f46e5' },
          areaStyle: { color: 'rgba(79,70,229,0.15)' }
        }
      ]
    };
  },

  bindSalesTrendClick(chart) {
    if (!chart || chart.__trendClickBound) return;
    chart.__trendClickBound = true;
    chart.on('click', (p) => {
      const label = p?.name || '';
      if (!label) return;
      if (this.data.salesTrendRange !== 'month') return;
      if (!/^\d{2}-\d{2}$/.test(label)) return;
      this.showTrendKeyDetail(label);
    });
  },

  async showTrendKeyDetail(label) {
    try {
      wx.showLoading({ title: '加载明细...' });
      const res = await callERPAPI(
        'getDataManagementStats',
        { params: { salesTrendRange: this.data.salesTrendRange, debugTrendKey: label } },
        false
      );
      const debug = res?.data?.debug || {};
      const list = Array.isArray(debug.trendKeyOrders) ? debug.trendKeyOrders : [];
      const sum = list.reduce((acc, it) => acc + toNumber(it?.amount), 0);
      const sorted = [...list].sort((a, b) => toNumber(b?.amount) - toNumber(a?.amount));
      const top = sorted.slice(0, 10);
      const lines = [
        `共${list.length}笔，合计¥${formatMoney(sum)}`,
        ...top.map((it, idx) => {
          const no = it?.orderNo || '-';
          const amountText = formatMoney(it?.amount);
          const type = it?.orderType || it?.sourceCollection || '';
          return `${idx + 1}) ${no} ¥${amountText}${type ? ` (${type})` : ''}`;
        })
      ];
      const content = lines.join('\n').slice(0, 800);
      wx.showModal({
        title: `${label} 明细`,
        content: content || '暂无明细',
        showCancel: false
      });
    } catch (e) {
      showCloudError(e, '加载明细失败');
    } finally {
      wx.hideLoading();
    }
  },

  async showMonthSalesDetail() {
    try {
      wx.showLoading({ title: '加载明细...' });
      const now = Date.now();
      const d = new Date(now);
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const monthKey = `${year}-${month}`;
      const res = await callERPAPI(
        'getDataManagementStats',
        { params: { salesTrendRange: this.data.salesTrendRange, debugMonthKey: monthKey } },
        false
      );
      const debug = res?.data?.debug || {};
      const list = Array.isArray(debug.monthKeyOrders) ? debug.monthKeyOrders : [];
      const sum = list.reduce((acc, it) => acc + toNumber(it?.amount), 0);
      const sorted = [...list].sort((a, b) => toNumber(b?.amount) - toNumber(a?.amount));
      const top = sorted.slice(0, 10);
      const lines = [
        `共${list.length}笔，合计¥${formatMoney(sum)}`,
        ...top.map((it, idx) => {
          const no = it?.orderNo || '-';
          const amountText = formatMoney(it?.amount);
          const type = it?.orderType || it?.sourceCollection || '';
          return `${idx + 1}) ${no} ¥${amountText}${type ? ` (${type})` : ''}`;
        })
      ];
      const content = lines.join('\n').slice(0, 800);
      wx.showModal({
        title: `${monthKey} 明细`,
        content: content || '暂无明细',
        showCancel: false
      });
    } catch (e) {
      showCloudError(e, '加载明细失败');
    } finally {
      wx.hideLoading();
    }
  },

  getCostStructureOption() {
    const data = (this._chartData?.costPie || []).filter((x) => toNumber(x.value) > 0);
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, textStyle: { fontSize: 10 } },
      series: [
        {
          type: 'pie',
          radius: ['45%', '70%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
          label: { show: true, formatter: '{b}\n{d}%', fontSize: 10 },
          data
        }
      ]
    };
  },

  getIncomeExpenseOption() {
    const data = (this._chartData?.incomeExpensePie || []).filter((x) => toNumber(x.value) > 0);
    return {
      tooltip: { trigger: 'item' },
      legend: { bottom: 0, textStyle: { fontSize: 10 } },
      series: [
        {
          type: 'pie',
          radius: ['45%', '70%'],
          avoidLabelOverlap: true,
          itemStyle: { borderRadius: 6, borderColor: '#fff', borderWidth: 2 },
          label: { show: true, formatter: '{b}\n{d}%', fontSize: 10 },
          data
        }
      ]
    };
  },

  getProfitCompositionOption() {
    const w = this._chartData?.profitWaterfall || {};
    const revenue = toNumber(w.revenue);
    const items = [
      { name: '营收', value: revenue },
      { name: '生产成本', value: toNumber(w.productionCost) },
      { name: '采购成本', value: toNumber(w.goodsPurchaseCost) },
      { name: '辅材成本', value: toNumber(w.rawMaterialPurchaseCost) },
      { name: '报废成本', value: toNumber(w.scrapCost) },
      { name: '人力成本', value: toNumber(w.salaryCost) },
      { name: '固定成本', value: toNumber(w.fixedCost) },
      { name: '利润', value: toNumber(w.profit) }
    ];

    const labels = items.map((x) => x.name);
    const deltas = items.map((x) => x.value);
    const waterfall = buildWaterfallSeries(labels, deltas);

    return {
      grid: { left: 40, right: 20, top: 20, bottom: 50 },
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params) => {
          const p = Array.isArray(params) ? params : [];
          const real = p.find((x) => x.seriesName === '金额');
          if (!real) return '';
          const idx = real.dataIndex;
          const name = labels[idx] || '';
          const val = deltas[idx];
          return `${name}：¥${formatMoney(val)}`;
        }
      },
      xAxis: { type: 'category', data: labels, axisLabel: { color: '#6b7280', fontSize: 10, interval: 0 } },
      yAxis: { type: 'value', axisLabel: { color: '#6b7280', fontSize: 10 }, splitLine: { lineStyle: { color: '#eef2f7' } } },
      series: [
        {
          name: '辅助',
          type: 'bar',
          stack: 'total',
          itemStyle: { color: 'rgba(0,0,0,0)' },
          emphasis: { itemStyle: { color: 'rgba(0,0,0,0)' } },
          data: waterfall.assist
        },
        {
          name: '金额',
          type: 'bar',
          stack: 'total',
          data: waterfall.real,
          itemStyle: {
            color: (p) => {
              const name = labels[p.dataIndex] || '';
              if (name === '营收') return '#4f46e5';
              if (name === '利润') return '#10b981';
              return '#ef4444';
            },
            borderRadius: [6, 6, 0, 0]
          },
          label: {
            show: false
          }
        }
      ]
    };
  }
});
