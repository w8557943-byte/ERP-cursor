Page({
  data: {
    orderInfo: {
      orderNo: '',
      productName: '',
      spec: '',
      totalQty: 0,
      producedQty: 0,
      status: '待质检',
      customer: ''
    },
    // 印刷质检项目
    printQcItems: [
      { name: '套印精度', status: '待检', canPass: true, canFail: true },
      { name: '颜色偏差', status: '待检', canPass: true, canFail: true },
      { name: '图文完整', status: '待检', canPass: true, canFail: true },
      { name: '表面质量', status: '待检', canPass: true, canFail: true }
    ],
    // 质检结果
    qcResult: '待检',
    qcRecords: [],
    showFailReason: false,
    failReason: '',
    // 操作记录
    operationLogs: []
  },

  onLoad: function(options) {
    // 获取从上一页传递的订单信息，优先通过本地缓存key，兼容旧URL参数
    let payload = null;
    if (options && options.key) {
      try {
        const raw = wx.getStorageSync(options.key);
        if (raw && typeof raw === 'object') {
          payload = raw;
        }
        try { wx.removeStorageSync(options.key); } catch (_) {}
      } catch (_) {}
    }
    if (!payload && options && options.orderData) {
      try { payload = JSON.parse(decodeURIComponent(options.orderData)); } catch (_) {}
    }
    if (payload) {
      this.setData({ orderInfo: payload });
      this.addOperationLog(`进入印刷质检页面，订单号：${payload.orderNo || ''}`);
    }
  },

  // 质检项目合格
  onQcItemPass(e) {
    const index = e.currentTarget.dataset.index;
    const updateKey = `printQcItems[${index}]`;
    
    this.setData({
      [`${updateKey}.status`]: '合格'
    });
    
    this.addOperationLog(`【${this.data.printQcItems[index].name}】质检合格`);
    this.checkQcResult();
  },

  // 质检项目不合格
  onQcItemFail(e) {
    const index = e.currentTarget.dataset.index;
    const updateKey = `printQcItems[${index}]`;
    
    this.setData({
      [`${updateKey}.status`]: '不合格'
    });
    
    this.addOperationLog(`【${this.data.printQcItems[index].name}】质检不合格`);
    this.checkQcResult();
  },

  // 检查整体质检结果
  checkQcResult() {
    const allPassed = this.data.printQcItems.every(item => item.status === '合格');
    const hasFailed = this.data.printQcItems.some(item => item.status === '不合格');
    
    if (allPassed) {
      this.setData({ qcResult: '合格' });
    } else if (hasFailed) {
      this.setData({ qcResult: '不合格' });
    }
  },

  // 提交质检结果
  onSubmitQc() {
    if (this.data.qcResult === '待检') {
      wx.showToast({ title: '请完成所有质检项目', icon: 'none' });
      return;
    }
    
    wx.showModal({
      title: '确认提交',
      content: `质检结果：${this.data.qcResult}\n是否确认提交？`,
      success: (res) => {
        if (res.confirm) {
          this.submitQcResult();
        }
      }
    });
  },

  // 执行质检结果提交
  submitQcResult() {
    const app = getApp();
    const time = new Date().toLocaleTimeString('zh-CN', {hour12: false}).slice(0,5);
    const qcRecord = {
      result: this.data.qcResult,
      time: time,
      items: [...this.data.printQcItems]
    };
    
    this.setData({
      qcRecords: [qcRecord, ...this.data.qcRecords]
    });
    
    this.addOperationLog(`印刷质检完成，结果：${this.data.qcResult}`);
    
    // 提交质检结果到服务器
    const qcData = {
      orderNo: this.data.orderInfo.orderNo,
      result: this.data.qcResult,
      items: this.data.printQcItems,
      timestamp: new Date().toISOString()
    };
    
    app.globalData.api.post('/api/qc/print', qcData)
      .then(response => {
        console.log('质检结果提交成功', response);
      })
      .catch(error => {
        console.error('质检结果提交失败', error);
        // 即使提交失败也继续执行后续操作
      });
    
    wx.showToast({ title: '质检结果已提交', icon: 'success' });
    
    // 如果质检合格，生成完工日志
    if (this.data.qcResult === '合格') {
      const finishTime = new Date().toLocaleTimeString('zh-CN', {hour12: false}).slice(0,5);
      const finishLog = {
        time: finishTime,
        content: `印刷工序完成，质检合格，印刷数量：${this.data.orderInfo.producedQty}，操作员：当前操作员`
      };
      
      // 将完工日志保存到全局数据或本地存储中
      const app = getApp();
      if (!app.globalData.finishLogs) {
        app.globalData.finishLogs = [];
      }
      app.globalData.finishLogs.push(finishLog);
    }
    
    // 返回生产详情页并更新状态
    setTimeout(() => {
      const pages = getCurrentPages();
      const prevPage = pages[pages.length - 2]; // 获取上一个页面
      
      if (prevPage) {
        // 更新生产详情页的工序状态
        const processList = prevPage.data.processList || [];
        const printProcessIndex = processList.findIndex(p => p.name === '印刷');
        
        if (printProcessIndex !== -1) {
          // 更新印刷工序状态
          prevPage.setData({
            [`processList[${printProcessIndex}].status`]: 'completed',
            [`processList[${printProcessIndex}].statusText`]: this.data.qcResult === '合格' ? '质检合格' : '质检不合格',
            [`processList[${printProcessIndex}].canQc`]: false
          });
          
          // 添加操作日志
          prevPage.addOperationLog(`印刷工序质检${this.data.qcResult}，完成印刷工序`);
          
          // 更新进度
          prevPage.updateProgress();
        }
      }
      
      wx.navigateBack();
    }, 1500);
  },

  // 添加操作日志
  addOperationLog(content) {
    const time = new Date().toLocaleTimeString('zh-CN', {hour12: false}).slice(0,5);
    const newLog = { time, content };
    this.setData({
      operationLogs: [newLog, ...this.data.operationLogs]
    });
  },

  // 切换操作记录显示
  onToggleLog() {
    this.setData({
      showLog: !this.data.showLog
    });
  }
})
