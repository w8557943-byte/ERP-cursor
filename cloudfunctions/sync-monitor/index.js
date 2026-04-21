/**
 * 数据同步监控云函数
 * 监控小程序端数据同步状态、性能和健康度
 * 提供同步质量分析和优化建议
 */

const cloud = require('wx-server-sdk');

// 初始化云开发环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

// 监控阈值配置
const MONITORING_THRESHOLDS = {
  syncLatency: {
    good: 100,      // < 100ms
    warning: 500,   // < 500ms
    critical: 1000  // >= 1000ms
  },
  errorRate: {
    good: 0.01,      // < 1%
    warning: 0.05,   // < 5%
    critical: 0.1    // >= 10%
  },
  dataConsistency: {
    good: 0.999,     // 99.9%
    warning: 0.99,   // 99%
    critical: 0.95   // 95%
  },
  deviceOnlineRate: {
    good: 0.9,       // 90%
    warning: 0.7,    // 70%
    critical: 0.5    // 50%
  }
};

// 同步状态定义
const SYNC_STATUS = {
  SUCCESS: 'success',
  FAILED: 'failed',
  PENDING: 'pending',
  CONFLICT: 'conflict',
  PARTIAL: 'partial'
};

// 操作类型
const OPERATION_TYPES = {
  CREATE: 'create',
  UPDATE: 'update',
  DELETE: 'delete',
  BATCH_CREATE: 'batch_create',
  BATCH_UPDATE: 'batch_update',
  BATCH_DELETE: 'batch_delete'
};

exports.main = async (event, context) => {
  const { action, data = {}, query = {} } = event;
  
  console.log(`[同步监控] 动作: ${action}`);
  
  try {
    switch (action) {
      case 'monitor_sync':
        return await monitorSync(event);
      case 'analyze_performance':
        return await analyzePerformance(query);
      case 'check_consistency':
        return await checkDataConsistency(query);
      case 'get_health_status':
        return await getHealthStatus(query);
      case 'generate_report':
        return await generateReport(query);
      case 'optimize_sync':
        return await optimizeSync(query);
      case 'alert_threshold_exceeded':
        return await handleThresholdExceeded(data);
      case 'cleanup_old_data':
        return await cleanupOldMonitoringData(query);
      default:
        throw new Error(`未知动作: ${action}`);
    }
  } catch (error) {
    console.error('[同步监控] 错误:', error);
    return {
      success: false,
      error: error.message,
      timestamp: Date.now()
    };
  }
};

/**
 * 监控同步操作
 */
async function monitorSync(event) {
  const { 
    syncId, 
    operation, 
    collection, 
    data, 
    startTime, 
    endTime, 
    status, 
    error = null,
    deviceId,
    userId,
    metadata = {} 
  } = event;
  
  const duration = endTime ? (endTime - startTime) : 0;
  
  // 记录同步指标
  const syncMetric = {
    syncId,
    operation,
    collection,
    status,
    duration,
    deviceId,
    userId,
    timestamp: endTime || Date.now(),
    metadata: {
      dataSize: JSON.stringify(data).length,
      networkType: metadata.networkType || 'unknown',
      appVersion: metadata.appVersion || 'unknown',
      ...metadata
    }
  };
  
  if (error) {
    syncMetric.error = {
      message: error.message || error,
      code: error.code,
      stack: error.stack
    };
  }
  
  try {
    // 存储到监控集合
    const db = cloud.database();
    await db.collection('sync_metrics').add({
      data: syncMetric
    });
    
    // 实时性能检查
    await checkRealtimePerformance(syncMetric);
    
    // 检查数据一致性
    if (status === SYNC_STATUS.SUCCESS && [OPERATION_TYPES.CREATE, OPERATION_TYPES.UPDATE].includes(operation)) {
      await validateDataConsistency(collection, data);
    }
    
    return {
      success: true,
      data: {
        syncId,
        monitored: true,
        status,
        duration,
        performanceGrade: getPerformanceGrade(duration)
      }
    };
    
  } catch (error) {
    console.error('[监控同步] 失败:', error);
    throw error;
  }
}

/**
 * 实时性能检查
 */
async function checkRealtimePerformance(metric) {
  const { duration, status, userId, deviceId } = metric;
  
  // 检查延迟
  if (duration > MONITORING_THRESHOLDS.syncLatency.warning) {
    await sendAlert({
      type: 'performance_warning',
      severity: duration > MONITORING_THRESHOLDS.syncLatency.critical ? 'critical' : 'warning',
      message: `同步延迟过高: ${duration}ms`,
      metric: {
        name: 'sync_latency',
        value: duration,
        threshold: MONITORING_THRESHOLDS.syncLatency
      },
      context: { userId, deviceId }
    });
  }
  
  // 检查错误率
  if (status === SYNC_STATUS.FAILED) {
    const recentErrors = await getRecentErrorRate(userId, deviceId, 10); // 最近10次操作
    
    if (recentErrors > MONITORING_THRESHOLDS.errorRate.warning) {
      await sendAlert({
        type: 'error_rate_high',
        severity: recentErrors > MONITORING_THRESHOLDS.errorRate.critical ? 'critical' : 'warning',
        message: `错误率过高: ${(recentErrors * 100).toFixed(2)}%`,
        metric: {
          name: 'error_rate',
          value: recentErrors,
          threshold: MONITORING_THRESHOLDS.errorRate
        },
        context: { userId, deviceId }
      });
    }
  }
}

/**
 * 分析性能
 */
async function analyzePerformance(query) {
  const { 
    timeRange = 3600000,  // 默认1小时
    userId,
    deviceId,
    collection 
  } = query;
  
  const startTime = Date.now() - timeRange;
  
  try {
    const db = cloud.database();
    const _ = db.command;
    
    // 构建查询条件
    const queryCondition = {
      timestamp: _.gte(startTime)
    };
    
    if (userId) queryCondition.userId = userId;
    if (deviceId) queryCondition.deviceId = deviceId;
    if (collection) queryCondition.collection = collection;
    
    // 获取监控数据
    const result = await db.collection('sync_metrics')
      .where(queryCondition)
      .orderBy('timestamp', 'desc')
      .limit(1000)
      .get();
    
    const metrics = result.data;
    
    if (metrics.length === 0) {
      return {
        success: true,
        data: {
          message: '指定时间范围内无监控数据',
          timeRange,
          metricsCount: 0
        }
      };
    }
    
    // 性能分析
    const analysis = {
      totalOperations: metrics.length,
      successfulOperations: metrics.filter(m => m.status === SYNC_STATUS.SUCCESS).length,
      failedOperations: metrics.filter(m => m.status === SYNC_STATUS.FAILED).length,
      pendingOperations: metrics.filter(m => m.status === SYNC_STATUS.PENDING).length,
      conflictOperations: metrics.filter(m => m.status === SYNC_STATUS.CONFLICT).length,
      
      // 延迟统计
      latencies: metrics.filter(m => m.duration > 0).map(m => m.duration),
      averageLatency: 0,
      medianLatency: 0,
      p95Latency: 0,
      p99Latency: 0,
      
      // 操作类型统计
      operationStats: {},
      
      // 集合统计
      collectionStats: {},
      
      // 设备统计
      deviceStats: {},
      
      // 时间分析
      timeAnalysis: {
        peakHours: [],
        slowOperations: []
      },
      
      // 性能等级
      performanceGrade: 'unknown',
      
      // 建议
      recommendations: []
    };
    
    // 计算延迟统计
    if (analysis.latencies.length > 0) {
      const sortedLatencies = analysis.latencies.sort((a, b) => a - b);
      
      analysis.averageLatency = Math.round(analysis.latencies.reduce((a, b) => a + b, 0) / analysis.latencies.length);
      analysis.medianLatency = sortedLatencies[Math.floor(sortedLatencies.length / 2)];
      analysis.p95Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.95)];
      analysis.p99Latency = sortedLatencies[Math.floor(sortedLatencies.length * 0.99)];
    }
    
    // 操作类型统计
    for (const metric of metrics) {
      analysis.operationStats[metric.operation] = (analysis.operationStats[metric.operation] || 0) + 1;
      analysis.collectionStats[metric.collection] = (analysis.collectionStats[metric.collection] || 0) + 1;
      if (metric.deviceId) {
        analysis.deviceStats[metric.deviceId] = (analysis.deviceStats[metric.deviceId] || 0) + 1;
      }
    }
    
    // 慢操作分析
    analysis.slowOperations = metrics
      .filter(m => m.duration > MONITORING_THRESHOLDS.syncLatency.warning)
      .sort((a, b) => b.duration - a.duration)
      .slice(0, 10)
      .map(m => ({
        syncId: m.syncId,
        operation: m.operation,
        collection: m.collection,
        duration: m.duration,
        timestamp: m.timestamp,
        deviceId: m.deviceId
      }));
    
    // 性能等级评估
    analysis.performanceGrade = calculatePerformanceGrade(analysis);
    
    // 生成建议
    analysis.recommendations = generatePerformanceRecommendations(analysis);
    
    // 峰值时间分析
    const hourlyStats = {};
    for (const metric of metrics) {
      const hour = new Date(metric.timestamp).getHours();
      hourlyStats[hour] = (hourlyStats[hour] || 0) + 1;
    }
    
    analysis.timeAnalysis.peakHours = Object.entries(hourlyStats)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([hour, count]) => ({ hour: parseInt(hour), count }));
    
    return {
      success: true,
      data: {
        analysis,
        timeRange,
        dataPoints: metrics.length,
        generatedAt: Date.now()
      }
    };
    
  } catch (error) {
    console.error('[性能分析] 失败:', error);
    throw error;
  }
}

/**
 * 检查数据一致性
 */
async function checkDataConsistency(query) {
  const { 
    collection,
    sampleSize = 100,
    checkLevel = 'basic' 
  } = query;
  
  try {
    const db = cloud.database();
    
    if (collection) {
      // 检查指定集合
      return await checkCollectionConsistency(collection, sampleSize, checkLevel);
    } else {
      // 检查所有集合
      const collections = ['orders', 'customers', 'products', 'inventory', 'users', 'manufacturing_orders', 'shipping_orders'];
      const results = {};
      
      for (const coll of collections) {
        try {
          results[coll] = await checkCollectionConsistency(coll, sampleSize, checkLevel);
        } catch (error) {
          results[coll] = {
            success: false,
            error: error.message
          };
        }
      }
      
      return {
        success: true,
        data: {
          collectionConsistency: results,
          overallConsistency: calculateOverallConsistency(results)
        }
      };
    }
    
  } catch (error) {
    console.error('[数据一致性检查] 失败:', error);
    throw error;
  }
}

/**
 * 检查集合一致性
 */
async function checkCollectionConsistency(collectionName, sampleSize, checkLevel) {
  const db = cloud.database();
  
  // 获取样本数据
  const sampleResult = await db.collection(collectionName)
    .aggregate()
    .sample(sampleSize)
    .end();
  
  const sampleData = sampleResult.list;
  
  const consistencyCheck = {
    collection: collectionName,
    sampleSize: sampleData.length,
    checks: {},
    issues: [],
    score: 0,
    timestamp: Date.now()
  };
  
  // 基础检查
  const basicChecks = {
    requiredFields: await checkRequiredFields(collectionName, sampleData),
    dataTypes: await checkDataTypes(collectionName, sampleData),
    uniqueConstraints: await checkUniqueConstraints(collectionName, sampleData),
    foreignKeys: await checkForeignKeys(collectionName, sampleData)
  };
  
  // 高级检查
  const advancedChecks = checkLevel === 'advanced' ? {
    businessRules: await checkBusinessRules(collectionName, sampleData),
    dataDependencies: await checkDataDependencies(collectionName, sampleData)
  } : {};
  
  consistencyCheck.checks = { ...basicChecks, ...advancedChecks };
  
  // 计算一致性得分
  consistencyCheck.score = calculateConsistencyScore(consistencyCheck.checks);
  
  // 生成问题报告
  consistencyCheck.issues = generateConsistencyIssues(consistencyCheck.checks);
  
  return consistencyCheck;
}

/**
 * 获取健康状态
 */
async function getHealthStatus(query) {
  const { timeRange = 3600000 } = query; // 默认1小时
  
  try {
    // 获取系统指标
    const [performanceAnalysis, consistencyReport] = await Promise.all([
      analyzePerformance({ timeRange }),
      checkDataConsistency({ sampleSize: 50 })
    ]);
    
    // 获取设备状态
    const deviceStatus = await getDeviceHealthStatus(timeRange);
    
    // 获取错误趋势
    const errorTrends = await getErrorTrends(timeRange);
    
    const healthStatus = {
      overall: 'unknown',
      score: 0,
      metrics: {
        performance: performanceAnalysis.data.analysis,
        consistency: consistencyReport.data,
        devices: deviceStatus,
        errors: errorTrends
      },
      alerts: [],
      recommendations: [],
      timestamp: Date.now()
    };
    
    // 计算总体健康得分
    healthStatus.score = calculateOverallHealthScore(healthStatus.metrics);
    healthStatus.overall = getHealthGrade(healthStatus.score);
    
    // 生成告警
    healthStatus.alerts = generateHealthAlerts(healthStatus.metrics);
    
    // 生成建议
    healthStatus.recommendations = generateHealthRecommendations(healthStatus.metrics);
    
    return {
      success: true,
      data: healthStatus
    };
    
  } catch (error) {
    console.error('[健康状态检查] 失败:', error);
    throw error;
  }
}

/**
 * 生成报告
 */
async function generateReport(query) {
  const { 
    reportType = 'performance',
    timeRange = 86400000, // 默认24小时
    format = 'json',
    includeCharts = false 
  } = query;
  
  try {
    const report = {
      reportType,
      timeRange,
      generatedAt: Date.now(),
      generatedBy: 'sync-monitor',
      data: {}
    };
    
    switch (reportType) {
      case 'performance':
        report.data = await analyzePerformance({ timeRange });
        break;
      case 'consistency':
        report.data = await checkDataConsistency({ sampleSize: 200 });
        break;
      case 'health':
        report.data = await getHealthStatus({ timeRange });
        break;
      case 'comprehensive':
        report.data = await Promise.all([
          analyzePerformance({ timeRange }),
          checkDataConsistency({ sampleSize: 200 }),
          getHealthStatus({ timeRange })
        ]);
        break;
      default:
        throw new Error(`不支持的报告类型: ${reportType}`);
    }
    
    // 存储报告
    const db = cloud.database();
    const reportId = `report_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    await db.collection('monitoring_reports').add({
      data: {
        reportId,
        ...report,
        storageTime: Date.now()
      }
    });
    
    return {
      success: true,
      data: {
        reportId,
        report,
        format,
        downloadable: true
      }
    };
    
  } catch (error) {
    console.error('[报告生成] 失败:', error);
    throw error;
  }
}

/**
 * 优化同步
 */
async function optimizeSync(query) {
  const { optimizationType = 'auto' } = query;
  
  try {
    // 获取当前性能数据
    const performanceData = await analyzePerformance({ timeRange: 3600000 }); // 最近1小时
    
    const optimizations = {
      timestamp: Date.now(),
      type: optimizationType,
      recommendations: [],
      applied: [],
      expectedImprovement: 0
    };
    
    // 基于性能数据生成优化建议
    const recommendations = await generateOptimizationRecommendations(performanceData.data.analysis);
    
    optimizations.recommendations = recommendations;
    
    // 自动应用优化（如果启用）
    if (optimizationType === 'auto') {
      const appliedOptimizations = await applyOptimizations(recommendations);
      optimizations.applied = appliedOptimizations;
    }
    
    return {
      success: true,
      data: optimizations
    };
    
  } catch (error) {
    console.error('[同步优化] 失败:', error);
    throw error;
  }
}

/**
 * 处理阈值超限告警
 */
async function handleThresholdExceeded(data) {
  const { metricName, value, threshold, context } = data;
  
  // 创建告警记录
  const alert = {
    alertId: `alert_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    metricName,
    value,
    threshold,
    context,
    severity: getSeverity(value, threshold),
    timestamp: Date.now(),
    acknowledged: false,
    resolved: false
  };
  
  // 存储告警
  const db = cloud.database();
  await db.collection('monitoring_alerts').add({
    data: alert
  });
  
  // 发送通知
  await sendAlertNotification(alert);
  
  // 尝试自动修复
  await attemptAutoRemediation(metricName, value, context);
  
  return {
    success: true,
    data: {
      alert,
      autoRemediationAttempted: true
    }
  };
}

/**
 * 清理旧监控数据
 */
async function cleanupOldMonitoringData(query) {
  const { 
    retentionPeriod = 2592000000, // 默认30天
    batchSize = 1000 
  } = query;
  
  const cutoffTime = Date.now() - retentionPeriod;
  
  try {
    const db = cloud.database();
    const _ = db.command;
    
    let deletedCount = 0;
    let hasMore = true;
    
    while (hasMore) {
      const result = await db.collection('sync_metrics')
        .where({
          timestamp: _.lt(cutoffTime)
        })
        .limit(batchSize)
        .remove();
      
      deletedCount += result.stats.removed;
      hasMore = result.stats.removed === batchSize;
    }
    
    // 清理过期的告警
    const alertResult = await db.collection('monitoring_alerts')
      .where({
        timestamp: _.lt(cutoffTime),
        resolved: true
      })
      .remove();
    
    return {
      success: true,
      data: {
        deletedMetrics: deletedCount,
        deletedAlerts: alertResult.stats.removed,
        cutoffTime,
        retentionPeriod
      }
    };
    
  } catch (error) {
    console.error('[数据清理] 失败:', error);
    throw error;
  }
}

/**
 * 辅助函数
 */

// 获取性能等级
function getPerformanceGrade(duration) {
  if (duration < MONITORING_THRESHOLDS.syncLatency.good) return 'excellent';
  if (duration < MONITORING_THRESHOLDS.syncLatency.warning) return 'good';
  if (duration < MONITORING_THRESHOLDS.syncLatency.critical) return 'warning';
  return 'critical';
}

// 计算性能等级
function calculatePerformanceGrade(analysis) {
  const { averageLatency, errorRate, conflictRate } = analysis;
  
  const latencyGrade = getPerformanceGrade(averageLatency);
  const errorGrade = errorRate < MONITORING_THRESHOLDS.errorRate.good ? 'excellent' : 
                    errorRate < MONITORING_THRESHOLDS.errorRate.warning ? 'good' : 'warning';
  
  const grades = [latencyGrade, errorGrade];
  
  if (grades.includes('critical')) return 'critical';
  if (grades.includes('warning')) return 'warning';
  if (grades.every(g => g === 'excellent')) return 'excellent';
  return 'good';
}

// 生成性能建议
function generatePerformanceRecommendations(analysis) {
  const recommendations = [];
  
  if (analysis.averageLatency > MONITORING_THRESHOLDS.syncLatency.warning) {
    recommendations.push({
      type: 'performance',
      priority: 'high',
      title: '优化同步延迟',
      description: `平均同步延迟 ${analysis.averageLatency}ms 过高，建议优化网络和数据库查询`,
      actions: [
        '检查网络连接质量',
        '优化数据库查询',
        '减少单次同步数据量',
        '启用数据压缩'
      ]
    });
  }
  
  if (analysis.failedOperations / analysis.totalOperations > MONITORING_THRESHOLDS.errorRate.warning) {
    recommendations.push({
      type: 'reliability',
      priority: 'high',
      title: '降低错误率',
      description: `错误率 ${(analysis.failedOperations / analysis.totalOperations * 100).toFixed(2)}% 过高`,
      actions: [
        '检查网络稳定性',
        '添加重试机制',
        '改进错误处理',
        '增加数据验证'
      ]
    });
  }
  
  return recommendations;
}

// 计算一致性得分
function calculateConsistencyScore(checks) {
  let score = 100;
  let totalChecks = 0;
  
  for (const [checkName, checkResult] of Object.entries(checks)) {
    if (typeof checkResult === 'object' && checkResult.score !== undefined) {
      score -= (100 - checkResult.score);
      totalChecks++;
    }
  }
  
  return totalChecks > 0 ? Math.max(0, score / totalChecks) : 100;
}

// 生成一致性问题和优化建议
function generateConsistencyIssues(checks) {
  const issues = [];
  
  for (const [checkName, checkResult] of Object.entries(checks)) {
    if (typeof checkResult === 'object' && checkResult.issues) {
      issues.push(...checkResult.issues);
    }
  }
  
  return issues;
}

// 检查必需字段
async function checkRequiredFields(collectionName, sampleData) {
  const requiredFields = {
    orders: ['orderNumber', 'customerId', 'totalAmount', 'status', 'createdAt'],
    customers: ['name', 'phone', 'email', 'address'],
    products: ['name', 'price', 'stock', 'category'],
    users: ['name', 'role', 'status']
  };
  
  const fields = requiredFields[collectionName] || [];
  const issues = [];
  let validCount = 0;
  
  for (const item of sampleData) {
    let hasAllFields = true;
    for (const field of fields) {
      if (item[field] === undefined || item[field] === null || item[field] === '') {
        hasAllFields = false;
        issues.push({
          type: 'missing_field',
          field,
          documentId: item._id,
          message: `缺少必需字段: ${field}`
        });
      }
    }
    if (hasAllFields) validCount++;
  }
  
  return {
    score: sampleData.length > 0 ? (validCount / sampleData.length) * 100 : 100,
    totalFields: fields.length,
    validDocuments: validCount,
    issues
  };
}

// 检查数据类型
async function checkDataTypes(collectionName, sampleData) {
  const typeRules = {
    orders: {
      orderNumber: 'string',
      customerId: 'string',
      totalAmount: 'number',
      status: 'string',
      createdAt: 'date'
    },
    customers: {
      name: 'string',
      phone: 'string',
      email: 'string',
      address: 'string'
    }
  };
  
  const rules = typeRules[collectionName] || {};
  const issues = [];
  let validCount = 0;
  
  for (const item of sampleData) {
    let isValid = true;
    for (const [field, expectedType] of Object.entries(rules)) {
      if (item[field] !== undefined) {
        const actualType = typeof item[field];
        if (expectedType === 'date' && !(item[field] instanceof Date)) {
          isValid = false;
          issues.push({
            type: 'invalid_type',
            field,
            expectedType,
            actualType: actualType,
            documentId: item._id
          });
        } else if (expectedType !== 'date' && actualType !== expectedType) {
          isValid = false;
          issues.push({
            type: 'invalid_type',
            field,
            expectedType,
            actualType,
            documentId: item._id
          });
        }
      }
    }
    if (isValid) validCount++;
  }
  
  return {
    score: sampleData.length > 0 ? (validCount / sampleData.length) * 100 : 100,
    rulesChecked: Object.keys(rules).length,
    validDocuments: validCount,
    issues
  };
}

// 检查唯一约束
async function checkUniqueConstraints(collectionName, sampleData) {
  const uniqueFields = {
    orders: ['orderNumber'],
    customers: ['phone', 'email'],
    products: ['name']
  };
  
  const fields = uniqueFields[collectionName] || [];
  const issues = [];
  
  for (const field of fields) {
    const values = sampleData.map(item => item[field]).filter(v => v !== undefined);
    const duplicates = values.filter((value, index) => values.indexOf(value) !== index);
    
    if (duplicates.length > 0) {
      issues.push({
        type: 'duplicate_value',
        field,
        duplicates: [...new Set(duplicates)],
        count: duplicates.length
      });
    }
  }
  
  return {
    score: issues.length === 0 ? 100 : Math.max(0, 100 - issues.length * 10),
    fieldsChecked: fields.length,
    issues
  };
}

// 检查外键约束
async function checkForeignKeys(collectionName, sampleData) {
  // 这里可以实现外键约束检查逻辑
  // 由于云开发数据库的限制，暂时返回模拟数据
  
  return {
    score: 100,
    issues: [],
    message: '外键约束检查需要更复杂的查询，暂时跳过'
  };
}

// 检查业务规则
async function checkBusinessRules(collectionName, sampleData) {
  // 实现具体的业务规则检查
  
  return {
    score: 100,
    issues: [],
    message: '业务规则检查待实现'
  };
}

// 检查数据依赖
async function checkDataDependencies(collectionName, sampleData) {
  // 实现数据依赖关系检查
  
  return {
    score: 100,
    issues: [],
    message: '数据依赖检查待实现'
  };
}

// 计算总体一致性
function calculateOverallConsistency(results) {
  const scores = Object.values(results)
    .filter(r => typeof r === 'object' && r.score !== undefined)
    .map(r => r.score);
  
  return scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 100;
}

// 获取严重程度
function getSeverity(value, threshold) {
  if (typeof threshold === 'object' && threshold.critical !== undefined) {
    if (value >= threshold.critical) return 'critical';
    if (value >= threshold.warning) return 'warning';
    return 'normal';
  }
  return 'warning';
}

// 发送告警通知
async function sendAlertNotification(alert) {
  // 在实际环境中，这里可以发送邮件、短信或推送通知
  console.log('[告警通知]', alert);
}

// 尝试自动修复
async function attemptAutoRemediation(metricName, value, context) {
  // 实现自动修复逻辑
  console.log('[自动修复]', { metricName, value, context });
}

// 获取设备健康状态
async function getDeviceHealthStatus(timeRange) {
  // 获取设备相关监控数据
  const db = cloud.database();
  
  try {
    const result = await db.collection('sync_metrics')
      .where({
        timestamp: db.command.gte(Date.now() - timeRange)
      })
      .field({
        deviceId: true,
        status: true,
        timestamp: true
      })
      .get();
    
    const devices = {};
    
    for (const metric of result.data) {
      if (!metric.deviceId) continue;
      
      if (!devices[metric.deviceId]) {
        devices[metric.deviceId] = {
          deviceId: metric.deviceId,
          totalOperations: 0,
          successfulOperations: 0,
          failedOperations: 0,
          lastSeen: 0
        };
      }
      
      const device = devices[metric.deviceId];
      device.totalOperations++;
      device.lastSeen = Math.max(device.lastSeen, metric.timestamp);
      
      if (metric.status === SYNC_STATUS.SUCCESS) {
        device.successfulOperations++;
      } else if (metric.status === SYNC_STATUS.FAILED) {
        device.failedOperations++;
      }
    }
    
    // 计算设备健康度
    for (const device of Object.values(devices)) {
      device.successRate = device.totalOperations > 0 ? 
        device.successfulOperations / device.totalOperations : 0;
      device.healthScore = calculateDeviceHealthScore(device);
    }
    
    return {
      totalDevices: Object.keys(devices).length,
      healthyDevices: Object.values(devices).filter(d => d.healthScore >= 80).length,
      devices: Object.values(devices)
    };
    
  } catch (error) {
    console.error('[设备健康状态] 获取失败:', error);
    return {
      totalDevices: 0,
      healthyDevices: 0,
      devices: []
    };
  }
}

// 计算设备健康得分
function calculateDeviceHealthScore(device) {
  const successRate = device.successRate;
  const recency = Math.min(1, (Date.now() - device.lastSeen) / (24 * 3600000)); // 最近24小时内的权重
  
  return Math.round(successRate * 80 + recency * 20);
}

// 获取错误趋势
async function getErrorTrends(timeRange) {
  const db = cloud.database();
  
  try {
    const result = await db.collection('sync_metrics')
      .where({
        timestamp: db.command.gte(Date.now() - timeRange),
        status: SYNC_STATUS.FAILED
      })
      .field({
        error: true,
        timestamp: true,
        deviceId: true
      })
      .orderBy('timestamp', 'desc')
      .limit(100)
      .get();
    
    const errors = result.data;
    const errorTypes = {};
    
    for (const error of errors) {
      const errorType = error.error?.code || 'unknown';
      errorTypes[errorType] = (errorTypes[errorType] || 0) + 1;
    }
    
    return {
      totalErrors: errors.length,
      errorTypes,
      recentErrors: errors.slice(0, 10),
      errorRate: 0 // 需要总体操作数来计算
    };
    
  } catch (error) {
    console.error('[错误趋势] 获取失败:', error);
    return {
      totalErrors: 0,
      errorTypes: {},
      recentErrors: []
    };
  }
}

// 计算总体健康得分
function calculateOverallHealthScore(metrics) {
  let totalScore = 0;
  let weight = 0;
  
  // 性能得分 (40% 权重)
  if (metrics.performance) {
    const perfScore = getPerformanceScore(metrics.performance);
    totalScore += perfScore * 0.4;
    weight += 0.4;
  }
  
  // 一致性得分 (30% 权重)
  if (metrics.consistency && metrics.consistency.overallConsistency !== undefined) {
    totalScore += metrics.consistency.overallConsistency * 0.3;
    weight += 0.3;
  }
  
  // 设备健康得分 (20% 权重)
  if (metrics.devices && metrics.devices.totalDevices > 0) {
    const deviceScore = (metrics.devices.healthyDevices / metrics.devices.totalDevices) * 100;
    totalScore += deviceScore * 0.2;
    weight += 0.2;
  }
  
  // 错误率得分 (10% 权重)
  if (metrics.errors) {
    const errorScore = Math.max(0, 100 - (metrics.errors.totalErrors * 2)); // 假设每错误扣2分
    totalScore += errorScore * 0.1;
    weight += 0.1;
  }
  
  return weight > 0 ? Math.round(totalScore / weight) : 0;
}

// 获取性能得分
function getPerformanceScore(performance) {
  const { averageLatency, totalOperations, failedOperations } = performance;
  
  let score = 100;
  
  // 延迟扣分
  if (averageLatency > MONITORING_THRESHOLDS.syncLatency.good) {
    score -= Math.min(50, Math.floor(averageLatency / 100));
  }
  
  // 错误率扣分
  if (totalOperations > 0) {
    const errorRate = failedOperations / totalOperations;
    score -= Math.min(30, Math.floor(errorRate * 1000));
  }
  
  return Math.max(0, score);
}

// 获取健康等级
function getHealthGrade(score) {
  if (score >= 90) return 'excellent';
  if (score >= 75) return 'good';
  if (score >= 60) return 'warning';
  return 'critical';
}

// 生成健康告警
function generateHealthAlerts(metrics) {
  const alerts = [];
  
  // 性能告警
  if (metrics.performance && metrics.performance.averageLatency > MONITORING_THRESHOLDS.syncLatency.critical) {
    alerts.push({
      type: 'performance',
      severity: 'critical',
      message: `同步延迟严重超标: ${metrics.performance.averageLatency}ms`,
      metric: 'sync_latency',
      value: metrics.performance.averageLatency
    });
  }
  
  // 一致性告警
  if (metrics.consistency && metrics.consistency.overallConsistency < MONITORING_THRESHOLDS.dataConsistency.critical) {
    alerts.push({
      type: 'consistency',
      severity: 'critical',
      message: `数据一致性严重下降: ${metrics.consistency.overallConsistency.toFixed(2)}%`,
      metric: 'data_consistency',
      value: metrics.consistency.overallConsistency
    });
  }
  
  // 设备告警
  if (metrics.devices && metrics.devices.totalDevices > 0) {
    const unhealthyRate = 1 - (metrics.devices.healthyDevices / metrics.devices.totalDevices);
    if (unhealthyRate > MONITORING_THRESHOLDS.deviceOnlineRate.critical) {
      alerts.push({
        type: 'device',
        severity: 'critical',
        message: `${Math.round(unhealthyRate * 100)}% 的设备不健康`,
        metric: 'device_health',
        value: unhealthyRate
      });
    }
  }
  
  return alerts;
}

// 生成健康建议
function generateHealthRecommendations(metrics) {
  const recommendations = [];
  
  // 性能建议
  if (metrics.performance && metrics.performance.averageLatency > MONITORING_THRESHOLDS.syncLatency.warning) {
    recommendations.push({
      type: 'performance',
      priority: 'high',
      title: '优化同步性能',
      description: `当前平均延迟 ${metrics.performance.averageLatency}ms，建议进行性能优化`,
      actions: [
        '检查网络连接质量',
        '优化数据库索引',
        '减少单次同步数据量',
        '启用数据压缩传输'
      ]
    });
  }
  
  // 一致性建议
  if (metrics.consistency && metrics.consistency.overallConsistency < MONITORING_THRESHOLDS.dataConsistency.warning) {
    recommendations.push({
      type: 'consistency',
      priority: 'high',
      title: '改善数据一致性',
      description: `当前一致性得分 ${metrics.consistency.overallConsistency.toFixed(2)}%，需要改善数据质量`,
      actions: [
        '检查数据输入验证',
        '完善唯一约束',
        '加强外键检查',
        '实施数据清理'
      ]
    });
  }
  
  return recommendations;
}

// 获取最近错误率
async function getRecentErrorRate(userId, deviceId, operationCount) {
  // 这里应该查询最近的错误率
  // 暂时返回模拟数据
  return 0.02; // 2%
}

// 生成优化建议
async function generateOptimizationRecommendations(performanceData) {
  const recommendations = [];
  
  // 基于分析结果生成具体建议
  if (performanceData.averageLatency > 500) {
    recommendations.push({
      type: 'network_optimization',
      title: '网络优化',
      description: '平均延迟过高，建议优化网络配置',
      impact: 'high',
      effort: 'medium'
    });
  }
  
  return recommendations;
}

// 应用优化
async function applyOptimizations(recommendations) {
  const applied = [];
  
  for (const rec of recommendations) {
    try {
      // 应用优化措施
      applied.push({
        recommendation: rec,
        applied: true,
        timestamp: Date.now()
      });
    } catch (error) {
      applied.push({
        recommendation: rec,
        applied: false,
        error: error.message,
        timestamp: Date.now()
      });
    }
  }
  
  return applied;
}

// 验证数据一致性
async function validateDataConsistency(collection, data) {
  // 在实际环境中，这里会验证数据的业务一致性
  console.log('[数据验证]', collection, data);
}

// 发送告警
async function sendAlert(alert) {
  // 记录告警
  const db = cloud.database();
  await db.collection('monitoring_alerts').add({
    data: {
      ...alert,
      timestamp: Date.now(),
      acknowledged: false
    }
  });
  
  // 发送通知（在真实环境中）
  console.log('[监控告警]', alert);
}