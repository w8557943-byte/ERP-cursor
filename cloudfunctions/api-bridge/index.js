const cloud = require('wx-server-sdk');
// 初始化云开发
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

// 云数据库适配器（内联实现）
class CloudDatabaseAdapter {
  constructor() {
    this.collections = {
      orders: 'orders',
      workorders: 'workorders',
      customers: 'customers',
      inventory: 'inventory',
      products: 'products',
      shipping: 'shipping',
      users: 'users',
      departments: 'departments',
      tasks: 'tasks',
      settings: 'settings'
    };
  }

  async executeQuery(collection, params = {}) {
    try {
      let query = db.collection(collection);
      
      // 处理状态筛选
      if (params.status) {
        query = query.where({ status: params.status });
      }

      // 处理客户筛选
      if (params.customerId) {
        query = query.where({ customerId: params.customerId });
      }

      // 处理搜索
      if (params.search) {
        query = query.where(db.RegExp({
          regexp: params.search,
          options: 'i'
        }));
      }

      // 处理排序和分页
      const page = parseInt(params.page) || 1;
      const limit = parseInt(params.limit) || 10;
      const skip = (page - 1) * limit;

      query = query.orderBy('createdAt', 'desc')
                   .skip(skip)
                   .limit(limit);

      const result = await query.get();
      const countResult = await db.collection(collection).count();

      return {
        success: true,
        data: result.data,
        pagination: {
          page: page,
          limit: limit,
          total: countResult.total,
          pages: Math.ceil(countResult.total / limit)
        }
      };
    } catch (error) {
      console.error(`查询失败 [${collection}]:`, error);
      throw new Error(`数据库查询失败: ${error.message}`);
    }
  }

  async create(collection, data) {
    try {
      const recordData = {
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const result = await db.collection(collection).add({
        data: recordData
      });

      return {
        success: true,
        data: {
          _id: result._id,
          ...recordData
        }
      };
    } catch (error) {
      console.error(`创建记录失败 [${collection}]:`, error);
      throw new Error(`创建记录失败: ${error.message}`);
    }
  }

  async update(collection, id, data) {
    try {
      const updateData = {
        ...data,
        updatedAt: new Date()
      };

      const result = await db.collection(collection).doc(id).update({
        data: updateData
      });

      return {
        success: true,
        data: {
          _id: id,
          ...updateData
        }
      };
    } catch (error) {
      console.error(`更新记录失败 [${collection}]:`, error);
      throw new Error(`更新记录失败: ${error.message}`);
    }
  }

  async delete(collection, id) {
    try {
      await db.collection(collection).doc(id).remove();
      return {
        success: true,
        data: { _id: id, deleted: true }
      };
    } catch (error) {
      console.error(`删除记录失败 [${collection}]:`, error);
      throw new Error(`删除记录失败: ${error.message}`);
    }
  }

  async getStats(collection, params = {}) {
    try {
      // 简单的统计数据
      const totalResult = await db.collection(collection).count();
      const statusResult = await db.collection(collection).aggregate()
        .group({
          _id: '$status',
          count: _.sum(1)
        }).end();

      return {
        success: true,
        data: {
          total: totalResult.total,
          byStatus: statusResult.list || []
        }
      };
    } catch (error) {
      console.error(`获取统计失败 [${collection}]:`, error);
      throw new Error(`获取统计失败: ${error.message}`);
    }
  }
}

// 创建全局适配器实例
const cloudAdapter = new CloudDatabaseAdapter();

/**
 * 荣禾ERP - API桥接云函数
 * 接收传统HTTP API请求，转换为云开发操作
 * 支持电脑端API与云开发的无缝对接
 */

// CORS处理
function handleCors(event) {
  const response = {
    statusCode: 200,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-client-platform',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS'
    }
  };

  // 处理预检请求
  if (event.httpMethod === 'OPTIONS') {
    return response;
  }

  return response;
}

// 错误处理
function handleError(error, message = '操作失败') {
  console.error('API错误:', error);
  
  return {
    success: false,
    message: message,
    error: error.message || error.toString()
  };
}

// 成功响应
function handleSuccess(data, message = '操作成功') {
  return {
    success: true,
    message: message,
    data: data
  };
}

// 解析请求参数
function parseRequestBody(event) {
  try {
    if (event.body) {
      return JSON.parse(event.body);
    }
  } catch (error) {
    console.error('解析请求体失败:', error);
  }
  return {};
}

function parseQueryParams(event) {
  const params = {};
  
  if (event.queryStringParameters) {
    Object.keys(event.queryStringParameters).forEach(key => {
      params[key] = event.queryStringParameters[key];
    });
  }
  
  return params;
}

// 身份验证（简化版本）
async function authenticateRequest(event) {
  const headers = event.headers || {};
  const authorization = headers.Authorization || headers.authorization;
  
  if (authorization && authorization.startsWith('Bearer ')) {
    // 验证token，这里简化为直接返回用户ID
    // 实际项目中应该调用专门的认证服务
    return {
      userId: 'user_' + Date.now(),
      valid: true
    };
  }
  
  // 对于某些公开接口，允许匿名访问
  const publicEndpoints = ['/health', '/public'];
  const path = event.path || '';
  
  if (publicEndpoints.some(endpoint => path.includes(endpoint))) {
    return {
      userId: 'anonymous',
      valid: true
    };
  }
  
  throw new Error('未授权访问');
}

// 路由分发
async function routeRequest(path, method, params, user) {
  const routes = {
    // 订单相关
    '/orders': () => handleOrders(method, params),
    '/orders/list': () => handleOrdersList(method, params),
    '/orders/stats': () => handleOrdersStats(method, params),
    
    // 工单相关
    '/workorders': () => handleWorkOrders(method, params),
    '/workorders/list': () => handleWorkOrdersList(method, params),
    '/workorders/stats': () => handleWorkOrdersStats(method, params),
    
    // 客户相关
    '/customers': () => handleCustomers(method, params),
    '/customers/list': () => handleCustomersList(method, params),
    
    // 库存相关
    '/inventory': () => handleInventory(method, params),
    '/inventory/list': () => handleInventoryList(method, params),
    
    // 仪表板相关
    '/dashboard/stats': () => handleDashboardStats(method, params),
    '/dashboard/recent': () => handleDashboardRecent(method, params),
    
    // 系统相关
    '/health': () => handleHealthCheck(),
    '/system/status': () => handleSystemStatus(),
  };

  // 匹配路由
  for (const [route, handler] of Object.entries(routes)) {
    if (path.includes(route)) {
      return await handler();
    }
  }

  throw new Error(`未找到匹配的路由: ${path}`);
}

// 订单处理
async function handleOrders(method, params) {
  if (method === 'GET') {
    return await handleOrdersList(method, params);
  } else if (method === 'POST') {
    // 创建订单
    const result = await cloudAdapter.create('orders', params);
    return handleSuccess(result.data, '订单创建成功');
  } else if (method === 'PUT') {
    // 更新订单
    const result = await cloudAdapter.update('orders', params.id, params);
    return handleSuccess(result.data, '订单更新成功');
  } else if (method === 'DELETE') {
    // 删除订单
    const result = await cloudAdapter.delete('orders', params.id);
    return handleSuccess(result.data, '订单删除成功');
  }
  
  throw new Error('不支持的HTTP方法');
}

// 订单列表
async function handleOrdersList(method, params) {
  const result = await cloudAdapter.executeQuery('orders', params);
  return handleSuccess(result.data, '获取订单列表成功');
}

// 订单统计
async function handleOrdersStats(method, params) {
  const result = await cloudAdapter.getStats('orders', params);
  return handleSuccess(result.data, '获取订单统计成功');
}

// 工单处理
async function handleWorkOrders(method, params) {
  if (method === 'GET') {
    return await handleWorkOrdersList(method, params);
  } else if (method === 'POST') {
    const result = await cloudAdapter.create('workorders', params);
    return handleSuccess(result.data, '工单创建成功');
  }
  
  throw new Error('不支持的HTTP方法');
}

// 工单列表
async function handleWorkOrdersList(method, params) {
  const result = await cloudAdapter.executeQuery('workorders', params);
  return handleSuccess(result.data, '获取工单列表成功');
}

// 工单统计
async function handleWorkOrdersStats(method, params) {
  const result = await cloudAdapter.getStats('workorders', params);
  return handleSuccess(result.data, '获取工单统计成功');
}

// 客户处理
async function handleCustomers(method, params) {
  if (method === 'GET') {
    return await handleCustomersList(method, params);
  }
  
  throw new Error('不支持的HTTP方法');
}

// 客户列表
async function handleCustomersList(method, params) {
  const result = await cloudAdapter.executeQuery('customers', params);
  return handleSuccess(result.data, '获取客户列表成功');
}

// 库存处理
async function handleInventory(method, params) {
  if (method === 'GET') {
    return await handleInventoryList(method, params);
  }
  
  throw new Error('不支持的HTTP方法');
}

// 库存列表
async function handleInventoryList(method, params) {
  const result = await cloudAdapter.executeQuery('inventory', params);
  return handleSuccess(result.data, '获取库存列表成功');
}

// 仪表板统计
async function handleDashboardStats(method, params) {
  try {
    // 并行获取多个集合的统计
    const [orders, workOrders, customers] = await Promise.all([
      cloudAdapter.getStats('orders', { dateRange: params.dateRange }),
      cloudAdapter.getStats('workorders', { dateRange: params.dateRange }),
      cloudAdapter.getStats('customers', {})
    ]);

    const stats = {
      orders: orders.data.total,
      workOrders: workOrders.data.total,
      customers: customers.data.total,
      // 可以添加更多统计字段
      updatedAt: new Date()
    };

    return handleSuccess(stats, '获取仪表板统计成功');
  } catch (error) {
    throw handleError(error, '获取仪表板统计失败');
  }
}

// 最近活动
async function handleDashboardRecent(method, params) {
  try {
    // 获取最近的订单和工单
    const [recentOrders, recentWorkOrders] = await Promise.all([
      cloudAdapter.executeQuery('orders', { limit: 5 }),
      cloudAdapter.executeQuery('workorders', { limit: 5 })
    ]);

    const recent = {
      orders: recentOrders.data,
      workOrders: recentWorkOrders.data,
      timestamp: new Date()
    };

    return handleSuccess(recent, '获取最近活动成功');
  } catch (error) {
    throw handleError(error, '获取最近活动失败');
  }
}

// 健康检查
async function handleHealthCheck() {
  return handleSuccess({
    status: 'healthy',
    timestamp: new Date(),
    service: 'ERP Cloud API Bridge'
  }, '系统运行正常');
}

// 系统状态
async function handleSystemStatus() {
  try {
    // 简单检查数据库连接
    const testResult = await cloudAdapter.getStats('users', { limit: 1 });
    
    return handleSuccess({
      status: 'operational',
      database: 'connected',
      timestamp: new Date(),
      version: '1.0.0'
    }, '系统状态正常');
  } catch (error) {
    return {
      success: false,
      status: 'degraded',
      database: 'disconnected',
      timestamp: new Date(),
      error: error.message
    };
  }
}

// 主入口函数
exports.main = async (event, context) => {
  console.log('API桥接请求:', event);
  
  try {
    // 处理CORS
    const corsResponse = handleCors(event);
    if (event.httpMethod === 'OPTIONS') {
      return corsResponse;
    }

    // 身份验证
    const user = await authenticateRequest(event);

    // 解析请求参数
    const body = parseRequestBody(event);
    const queryParams = parseQueryParams(event);
    const params = { ...queryParams, ...body };

    // 路由分发
    const result = await routeRequest(event.path, event.httpMethod, params, user);

    return {
      ...corsResponse,
      body: JSON.stringify(result)
    };
  } catch (error) {
    console.error('API桥接处理错误:', error);
    
    const errorResponse = handleError(error);
    
    return {
      statusCode: 500,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(errorResponse)
    };
  }
};