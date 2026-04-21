// 数据一致性测试页面
const { getData, getConsistencyStatus, forceSyncAll } = require('../../utils/data-sync-utils.js');
const dataConsistencyMonitor = require('../../utils/data-consistency-monitor.js');

Page({
  data: {
    testResults: [],
    dataStatus: {},
    consistencyIssues: [],
    isTesting: false,
    lastTestTime: null,
    
    // 测试配置
    testConfig: {
      checkOrderProductionSync: true,
      checkStatusConsistency: true,
      checkDataTimeliness: true,
      performDataSync: true
    }
  },

  onLoad: function() {
    console.log('数据一致性测试页面加载');
    this.loadDataStatus();
  },

  // 加载数据状态
  loadDataStatus: function() {
    const status = dataConsistencyMonitor.getDataStatus();
    this.setData({
      dataStatus: status
    });
  },

  // 运行一致性测试
  runConsistencyTests: function() {
    this.setData({
      isTesting: true,
      testResults: []
    });

    console.log('[一致性测试] 开始运行测试');
    
    const tests = [];
    
    // 添加测试用例
    if (this.data.testConfig.checkOrderProductionSync) {
      tests.push(this.testOrderProductionSync.bind(this));
    }
    
    if (this.data.testConfig.checkStatusConsistency) {
      tests.push(this.testStatusConsistency.bind(this));
    }
    
    if (this.data.testConfig.checkDataTimeliness) {
      tests.push(this.testDataTimeliness.bind(this));
    }
    
    if (this.data.testConfig.performDataSync) {
      tests.push(this.testDataSync.bind(this));
    }

    // 按顺序执行测试
    this.executeTestsSequentially(tests, 0)
      .then(() => {
        console.log('[一致性测试] 所有测试完成');
        this.setData({
          isTesting: false,
          lastTestTime: new Date().toLocaleString()
        });
        
        wx.showToast({
          title: '测试完成',
          icon: 'success',
          duration: 2000
        });
      })
      .catch(error => {
        console.error('[一致性测试] 测试执行失败:', error);
        this.setData({
          isTesting: false
        });
        
        wx.showToast({
          title: '测试失败',
          icon: 'none',
          duration: 2000
        });
      });
  },

  // 顺序执行测试
  executeTestsSequentially: function(tests, index) {
    if (index >= tests.length) {
      return Promise.resolve();
    }

    return tests[index]()
      .then(() => this.executeTestsSequentially(tests, index + 1))
      .catch(error => {
        console.error(`[一致性测试] 测试 ${index} 失败:`, error);
        throw error;
      });
  },

  // 测试订单-生产同步
  testOrderProductionSync: function() {
    return new Promise((resolve, reject) => {
      console.log('[一致性测试] 开始测试订单-生产同步');
      
      Promise.all([
        getData('orders', false),
        getData('production_orders', false)
      ])
      .then(([orders, productionOrders]) => {
        const orderIds = orders.map(order => order.orderNo);
        const productionOrderIds = productionOrders.map(prod => prod.orderNo);
        
        // 检查一致性
        const missingInOrders = productionOrderIds.filter(prodId => 
          !orderIds.includes(prodId)
        );
        
        const producingOrders = orders.filter(order => order.status === 'producing');
        const missingInProduction = producingOrders.filter(order => 
          !productionOrderIds.includes(order.orderNo)
        );
        
        const result = {
          name: '订单-生产同步测试',
          passed: missingInOrders.length === 0 && missingInProduction.length === 0,
          details: {
            totalOrders: orders.length,
            totalProductionOrders: productionOrders.length,
            missingInOrders: missingInOrders,
            missingInProduction: missingInProduction.map(order => order.orderNo),
            issues: [
              ...missingInOrders.map(id => `生产订单 ${id} 在订单列表中不存在`),
              ...missingInProduction.map(id => `订单 ${id} 应该在生产中但未找到`)
            ]
          }
        };
        
        this.addTestResult(result);
        resolve(result);
      })
      .catch(error => {
        console.error('[一致性测试] 订单-生产同步测试失败:', error);
        reject(error);
      });
    });
  },

  // 测试状态一致性
  testStatusConsistency: function() {
    return new Promise((resolve, reject) => {
      console.log('[一致性测试] 开始测试状态一致性');
      
      getData('orders', false)
        .then(orders => {
          const issues = [];
          
          orders.forEach(order => {
            // 检查状态转换是否合理
            if (order.status === 'completed' && order.progress < 100) {
              issues.push(`订单 ${order.orderNo} 状态为已完成但进度为 ${order.progress}%`);
            }
            
            if (order.status === 'producing' && order.progress === 0) {
              issues.push(`订单 ${order.orderNo} 状态为生产中但进度为 0%`);
            }
          });
          
          const result = {
            name: '状态一致性测试',
            passed: issues.length === 0,
            details: {
              totalOrders: orders.length,
              issues: issues
            }
          };
          
          this.addTestResult(result);
          resolve(result);
        })
        .catch(error => {
          console.error('[一致性测试] 状态一致性测试失败:', error);
          reject(error);
        });
    });
  },

  // 测试数据时效性
  testDataTimeliness: function() {
    return new Promise((resolve, reject) => {
      console.log('[一致性测试] 开始测试数据时效性');
      
      const status = dataConsistencyMonitor.getDataStatus();
      const now = Date.now();
      const staleThreshold = 5 * 60 * 1000; // 5分钟
      
      const staleData = [];
      
      Object.keys(status).forEach(dataType => {
        if (status[dataType].isStale) {
          staleData.push(dataType);
        }
      });
      
      const result = {
        name: '数据时效性测试',
        passed: staleData.length === 0,
        details: {
          staleDataTypes: staleData,
          dataStatus: status
        }
      };
      
      this.addTestResult(result);
      resolve(result);
    });
  },

  // 测试数据同步
  testDataSync: function() {
    return new Promise((resolve, reject) => {
      console.log('[一致性测试] 开始测试数据同步');
      
      forceSyncAll()
        .then(() => {
          // 重新加载数据状态
          this.loadDataStatus();
          
          const result = {
            name: '数据同步测试',
            passed: true,
            details: {
              message: '数据同步成功完成'
            }
          };
          
          this.addTestResult(result);
          resolve(result);
        })
        .catch(error => {
          console.error('[一致性测试] 数据同步测试失败:', error);
          
          const result = {
            name: '数据同步测试',
            passed: false,
            details: {
              error: error.message
            }
          };
          
          this.addTestResult(result);
          reject(error);
        });
    });
  },

  // 添加测试结果
  addTestResult: function(result) {
    const testResults = this.data.testResults;
    testResults.push({
      ...result,
      timestamp: new Date().toLocaleString()
    });
    
    this.setData({
      testResults: testResults
    });
  },

  // 查看详细结果
  viewDetailedResult: function(e) {
    const index = e.currentTarget.dataset.index;
    const result = this.data.testResults[index];
    
    wx.showModal({
      title: result.name,
      content: JSON.stringify(result.details, null, 2),
      showCancel: false,
      confirmText: '关闭'
    });
  },

  // 导出测试报告
  exportTestReport: function() {
    const report = {
      timestamp: new Date().toISOString(),
      testResults: this.data.testResults,
      dataStatus: this.data.dataStatus
    };
    
    wx.showModal({
      title: '测试报告',
      content: JSON.stringify(report, null, 2),
      showCancel: false,
      confirmText: '关闭'
    });
  },

  // 清除测试结果
  clearTestResults: function() {
    this.setData({
      testResults: [],
      lastTestTime: null
    });
  },

  // 切换测试配置
  toggleTestConfig: function(e) {
    const configKey = e.currentTarget.dataset.key;
    const testConfig = { ...this.data.testConfig };
    testConfig[configKey] = !testConfig[configKey];
    
    this.setData({
      testConfig: testConfig
    });
  }
});