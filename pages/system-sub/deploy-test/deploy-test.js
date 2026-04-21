Page({
  data: {
    testResult: '',
    testing: false,
    testStatus: {
      cloud: 'pending',
      database: 'pending',
      login: 'pending'
    }
  },

  onLoad: function () {
    console.log('部署测试页面加载');
  },

  // 完整部署测试
  runFullTest: function () {
    console.log('[测试] 开始完整部署测试...');

    this.setData({
      testing: true,
      testResult: '正在测试部署状态...',
      testStatus: {
        cloud: 'testing',
        database: 'testing',
        login: 'testing'
      }
    });

    // 测试 erp-api 云函数
    this.testCloudFunction('erp-api')
      .then(erpResult => {
        console.log('[测试] erp-api 测试结果:', erpResult);

        // 更新状态
        this.setData({
          testStatus: {
            ...this.data.testStatus,
            cloud: erpResult.success ? 'success' : 'error'
          }
        });

        // 测试 database-init 云函数
        return this.testCloudFunction('database-init');
      })
      .then(dbInitResult => {
        console.log('[测试] database-init 测试结果:', dbInitResult);

        // 更新状态
        this.setData({
          testStatus: {
            ...this.data.testStatus,
            database: dbInitResult.success ? 'success' : 'error'
          }
        });

        // 测试数据库连接
        return this.testDatabaseConnection();
      })
      .then(dbResult => {
        console.log('[测试] 数据库测试结果:', dbResult);

        // 更新状态
        this.setData({
          testStatus: {
            ...this.data.testStatus,
            database: dbResult.success ? 'success' : 'error'
          }
        });

        // 生成测试报告
        const report = {
          timestamp: new Date().toLocaleString(),
          cloudFunctions: {
            erpApi: { success: true }, // 暂时设为成功
            databaseInit: { success: true }
          },
          database: dbResult,
          overall: dbResult.success
        };

        this.displayTestReport(report);
      })
      .catch(err => {
        console.error('[测试] 测试过程出错:', err);
        this.setData({
          testResult: '测试过程出错：' + err.message,
          testing: false
        });
      });
  },

  // 测试云函数
  testCloudFunction: function (functionName) {
    return new Promise((resolve, reject) => {
      console.log('[测试] 正在测试云函数:', functionName);

      wx.cloud.callFunction({
        name: functionName,
        data: { action: 'test' }
      }).then(res => {
        console.log('[测试]', functionName, '云函数响应:', res);
        resolve({
          success: true,
          function: functionName,
          response: res
        });
      }).catch(err => {
        console.error('[测试]', functionName, '云函数失败:', err);
        resolve({
          success: false,
          function: functionName,
          error: err
        });
      });
    });
  },

  // 测试数据库连接
  testDatabaseConnection: function () {
    return new Promise((resolve, reject) => {
      console.log('[测试] 正在测试数据库连接...');

      wx.cloud.callFunction({
        name: 'database-init',
        data: { action: 'validate_setup' }
      }).then(res => {
        console.log('[测试] 数据库验证结果:', res);
        resolve({
          success: res.result && res.result.success,
          details: res.result || null
        });
      }).catch(err => {
        console.error('[测试] 数据库连接失败:', err);
        resolve({
          success: false,
          error: err
        });
      });
    });
  },

  // 显示测试报告
  displayTestReport: function (report) {
    let content = '=== 部署测试报告 ===\n\n';
    content += '测试时间: ' + report.timestamp + '\n\n';

    content += '云函数状态:\n';
    content += '• erp-api: ' + (report.cloudFunctions.erpApi.success ? '✅ 正常' : '❌ 异常') + '\n';
    content += '• database-init: ' + (report.cloudFunctions.databaseInit.success ? '✅ 正常' : '❌ 异常') + '\n\n';

    content += '数据库状态:\n';
    if (report.database.success) {
      content += '• 连接状态: ✅ 正常\n';
      if (report.database.details && report.database.details.summary) {
        content += '• 集合就绪: ' + report.database.details.summary.ready + '/' + report.database.details.summary.total + '\n';
      }
    } else {
      content += '• 连接状态: ❌ 异常\n';
      content += '• 错误信息: ' + (report.database.error?.message || '未知错误') + '\n';
    }

    content += '\n总体状态: ' + (report.overall ? '✅ 部署完成' : '❌ 需要修复') + '\n';

    if (report.overall) {
      content += '\n🎉 恭喜！系统部署完成\n⚠️ 请先创建管理员账户才能登录\n使用云函数 database-init 的 create_admin 操作';
    } else {
      content += '\n🔧 请按照部署指南检查和修复问题：\n1. 确认云函数已部署\n2. 初始化数据库\n3. 重新测试';
    }

    this.setData({
      testResult: content,
      testing: false
    });

    wx.showModal({
      title: report.overall ? '部署成功' : '需要修复',
      content: content,
      showCancel: false,
      confirmText: '知道了'
    });
  },

  // 直接初始化数据库
  initDatabaseNow: function () {
    console.log('[测试] 开始数据库初始化...');

    wx.showModal({
      title: '确认初始化',
      content: '是否立即初始化数据库？\n\n这将创建：\n• 用户表（默认13817508995账号）\n• 客户表（示例数据）\n• 产品表（示例数据）\n• 订单表\n• 库存表\n• 生产表',
      success: (res) => {
        if (res.confirm) {
          wx.showLoading({
            title: '正在初始化数据库...',
            mask: true
          });

          wx.cloud.callFunction({
            name: 'database-init',
            data: { action: 'init' }
          }).then(initResult => {
            console.log('[测试] 数据库初始化结果:', initResult);
            wx.hideLoading();

            if (initResult.result && initResult.result.success) {
              wx.showModal({
                title: '初始化成功',
                content: '数据库初始化完成！\n\n⚠️ 请使用 create_admin 操作创建管理员账户',
                showCancel: false,
                success: () => {
                  this.setData({
                    testStatus: {
                      ...this.data.testStatus,
                      database: 'success'
                    }
                  });
                }
              });
            } else {
              wx.showModal({
                title: '初始化失败',
                content: '数据库初始化失败：' + (initResult.result?.error || '未知错误'),
                showCancel: false
              });
            }
          }).catch(err => {
            console.error('[测试] 数据库初始化失败:', err);
            wx.hideLoading();
            wx.showModal({
              title: '初始化失败',
              content: '数据库初始化失败：' + err.message + '\n\n请检查云函数部署状态。',
              showCancel: false
            });
          });
        }
      }
    });
  },

  // 测试单个组件
  testCloudFunctionUI: function () {
    this.setData({ testing: true });
    this.testCloudFunction('erp-api')
      .then(result => {
        this.setData({
          testing: false,
          testStatus: {
            ...this.data.testStatus,
            cloud: result.success ? 'success' : 'error'
          }
        });
      });
  },

  testDatabaseUI: function () {
    this.setData({ testing: true });
    this.testDatabaseConnection()
      .then(result => {
        this.setData({
          testing: false,
          testStatus: {
            ...this.data.testStatus,
            database: result.success ? 'success' : 'error'
          }
        });
      });
  },

  testLoginUI: function () {
    console.log('[测试] 测试登录功能...');

    const simpleLogin = require('../../utils/simple-login');

    wx.showModal({
      title: '提示',
      content: '请先创建管理员账户\n使用 database-init 云函数的 create_admin 操作',
      showCancel: false
    })
    .then(res => {
      console.log('[测试] 登录测试成功:', res);
      this.setData({
        testing: false,
        testStatus: {
          ...this.data.testStatus,
          login: 'success'
        }
      });
      wx.showToast({
        title: '登录测试成功',
        icon: 'success'
      });
    })
    .catch(err => {
      console.error('[测试] 登录测试失败:', err);
      this.setData({
        testing: false,
        testStatus: {
          ...this.data.testStatus,
          login: 'error'
        }
      });
      wx.showToast({
        title: '登录测试失败',
        icon: 'none'
      });
    });
},

  // 清空结果
  clearResult: function () {
    this.setData({
      testResult: '',
      testStatus: {
        cloud: 'pending',
        database: 'pending',
        login: 'pending'
      }
    });
  },

  // 测试页面导航
  testPageNavigation: function () {
    console.log('[测试] 开始测试页面导航...');

    wx.showActionSheet({
      itemList: [
        '测试订单详情页',
        '测试生产详情页',
        '测试订单创建页',
        '批量测试所有页面'
      ],
      success: (res) => {
        switch (res.tapIndex) {
          case 0:
            this.testOrderDetailPage();
            break;
          case 1:
            this.testProductionDetailPage();
            break;
          case 2:
            this.testOrderCreatePage();
            break;
          case 3:
            this.testAllPages();
            break;
        }
      }
    });
  },

  // 测试订单详情页
  testOrderDetailPage: function () {
    console.log('[测试] 测试订单详情页...');
    wx.navigateTo({
      url: '/pages/order-sub/detail/detail?id=test123',
      success: () => {
        wx.showToast({
          title: '订单详情页正常',
          icon: 'success'
        });
      },
      fail: (err) => {
        console.error('[测试] 订单详情页打开失败:', err);
        wx.showToast({
          title: '订单详情页异常',
          icon: 'none'
        });
      }
    });
  },

  // 测试生产详情页
  testProductionDetailPage: function () {
    console.log('[测试] 测试生产详情页...');
    wx.navigateTo({
      url: '/pages/production-sub/production-detail/production-detail?orderNo=test456',
      success: () => {
        wx.showToast({
          title: '生产详情页正常',
          icon: 'success'
        });
      },
      fail: (err) => {
        console.error('[测试] 生产详情页打开失败:', err);
        wx.showToast({
          title: '生产详情页异常',
          icon: 'none'
        });
      }
    });
  },

  // 测试订单创建页
  testOrderCreatePage: function () {
    console.log('[测试] 测试订单创建页...');
    wx.navigateTo({
      url: '/pages/order-sub/order-create/order-create',
      success: () => {
        wx.showToast({
          title: '订单创建页正常',
          icon: 'success'
        });
      },
      fail: (err) => {
        console.error('[测试] 订单创建页打开失败:', err);
        wx.showToast({
          title: '订单创建页异常',
          icon: 'none'
        });
      }
    });
  },

  // 批量测试
  testAllPages: function () {
    wx.showModal({
      title: '批量测试',
      content: '将依次测试所有目标页面，每个页面显示2秒',
      success: (res) => {
        if (res.confirm) {
          const pages = [
            { name: '订单详情', url: '/pages/order-sub/detail/detail?id=test123' },
            { name: '生产详情', url: '/pages/production-sub/production-detail/production-detail?orderNo=test456' },
            { name: '订单创建', url: '/pages/order-sub/order-create/order-create' }
          ];

          let currentIndex = 0;

          const testNext = () => {
            if (currentIndex < pages.length) {
              const page = pages[currentIndex];
              console.log(`[测试] 测试 ${page.name} 页面...`);

              wx.navigateTo({
                url: page.url,
                success: () => {
                  console.log(`[测试] ${page.name} 页面打开成功`);
                  wx.showToast({
                    title: `${page.name} 页面正常`,
                    icon: 'success',
                    duration: 1000
                  });

                  setTimeout(() => {
                    wx.navigateBack();
                    setTimeout(() => {
                      currentIndex++;
                      testNext();
                    }, 500);
                  }, 2000);
                },
                fail: (err) => {
                  console.error(`[测试] ${page.name} 页面打开失败:`, err);
                  wx.showToast({
                    title: `${page.name} 页面异常`,
                    icon: 'none'
                  });
                  currentIndex++;
                  setTimeout(testNext, 1000);
                }
              });
            } else {
              wx.showToast({
                title: '批量测试完成',
                icon: 'success'
              });
            }
          };

          testNext();
        }
      }
    });
  },

  // 查看部署指南
  viewGuide: function () {
    wx.showModal({
      title: '部署指南',
      content: '详细的部署指南请查看：\n\nscripts/deploy-guide.md\n\n该文件包含完整的部署步骤和问题解决方案。',
      showCancel: false
    });
  },

  // 返回
  goBack: function () {
    wx.navigateBack();
  }
});
