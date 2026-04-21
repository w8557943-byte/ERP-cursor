/**
 * 荣禾ERP - 云开发API适配器
 * 集成云开发API到现有前端页面
 * 保持与现有API的向后兼容性
 */

// 检查是否使用云开发环境
function isUsingCloudDevelopment() {
  try {
    return wx.cloud !== undefined;
  } catch (e) {
    return false;
  }
}

const CLOUD_ENV_ID = 'erp-system-prod-1glmda1zf4f9c7a7';

function ensureCloudInit() {
  try {
    if (!wx.cloud || typeof wx.cloud.init !== 'function') return false;
    if (wx.cloud.__erpInited) return true;
    wx.cloud.init({ env: CLOUD_ENV_ID, traceUser: true });
    wx.cloud.__erpInited = true;
    return true;
  } catch (_) {
    return false;
  }
}

// 云开发数据库操作封装
class CloudDatabaseAdapter {
  constructor() {
    this.db = null;
  }

  async ensureDb() {
    if (this.db) return this.db;
    if (!ensureCloudInit()) {
      throw new Error('云开发环境未初始化');
    }
    try {
      this.db = wx.cloud.database();
      return this.db;
    } catch (_) {
      throw new Error('云开发环境未初始化');
    }
  }

  // 查询数据
  async query(collection, query = {}, options = {}) {
    const db = await this.ensureDb();
    let dbQuery = db.collection(collection);

    // 应用查询条件
    if (query.conditions) {
      Object.keys(query.conditions).forEach(key => {
        if (key === 'status') {
          dbQuery = dbQuery.where({ status: query.conditions[key] });
        } else if (key === 'customerId') {
          dbQuery = dbQuery.where({ customerId: query.conditions[key] });
        } else {
          dbQuery = dbQuery.where({ [key]: query.conditions[key] });
        }
      });
    }

    // 应用分页
    if (options.skip !== undefined) {
      dbQuery = dbQuery.skip(options.skip);
    }
    if (options.limit !== undefined) {
      dbQuery = dbQuery.limit(options.limit);
    }

    // 应用排序
    if (options.orderBy) {
      const [field, order] = options.orderBy.split('_');
      dbQuery = dbQuery.orderBy(field, order === 'desc' ? 'desc' : 'asc');
    }

    try {
      const result = await dbQuery.get();
      return {
        success: true,
        data: result.data,
        total: result.data.length
      };
    } catch (error) {
      console.error(`云数据库查询失败 - ${collection}:`, error);
      throw new Error(`查询失败: ${error.message}`);
    }
  }

  // 获取单条记录
  async getById(collection, id) {
    try {
      const db = await this.ensureDb();
      const result = await db.collection(collection).doc(id).get();
      return {
        success: true,
        data: result.data
      };
    } catch (error) {
      console.error(`云数据库获取失败 - ${collection}/${id}:`, error);
      throw new Error(`获取数据失败: ${error.message}`);
    }
  }

  // 创建记录
  async create(collection, data) {
    try {
      const db = await this.ensureDb();
      const result = await db.collection(collection).add({
        data: {
          ...data,
          createdAt: new Date(),
          updatedAt: new Date()
        }
      });

      return {
        success: true,
        data: {
          _id: result._id,
          ...data
        }
      };
    } catch (error) {
      console.error(`云数据库创建失败 - ${collection}:`, error);
      throw new Error(`创建失败: ${error.message}`);
    }
  }

  // 更新记录
  async update(collection, id, data) {
    try {
      const db = await this.ensureDb();
      const result = await db.collection(collection).doc(id).update({
        data: {
          ...data,
          updatedAt: new Date()
        }
      });

      return {
        success: true,
        data: {
          _id: id,
          ...data
        }
      };
    } catch (error) {
      console.error(`云数据库更新失败 - ${collection}/${id}:`, error);
      throw new Error(`更新失败: ${error.message}`);
    }
  }

  // 删除记录
  async delete(collection, id) {
    try {
      const db = await this.ensureDb();
      const result = await db.collection(collection).doc(id).remove();
      return {
        success: true,
        data: result.stats
      };
    } catch (error) {
      console.error(`云数据库删除失败 - ${collection}/${id}:`, error);
      throw new Error(`删除失败: ${error.message}`);
    }
  }
}

// 云开发API适配器
class CloudAPIAdapter {
  constructor() {
    this.database = new CloudDatabaseAdapter();
    this.isCloudEnabled = isUsingCloudDevelopment();
  }

  async callCloudFunction(name, data) {
    if (!ensureCloudInit()) {
      throw new Error('云开发环境未初始化');
    }
    return wx.cloud.callFunction({ name, data });
  }

  // 认证相关
  async authLogin(data) {
    try {
      // 调用云函数进行登录认证
      const result = await this.callCloudFunction('erp-api', {
        action: 'login',
        data: data
      });

      if (result.result && result.result.success) {
        // 保存token
        if (result.result.data && result.result.data.token) {
          wx.setStorageSync('userToken', result.result.data.token);
        }
        return result.result;
      } else {
        throw new Error(result.result.message || '登录失败');
      }
    } catch (error) {
      console.error('云登录失败:', error);
      throw new Error(`登录失败: ${error.message}`);
    }
  }

  async getUserInfo() {
    try {
      const result = await this.callCloudFunction('erp-api', {
        action: 'auth',
        method: 'getUser',
        data: {}
      });

      return result.result;
    } catch (error) {
      console.error('获取用户信息失败:', error);
      throw new Error(`获取用户信息失败: ${error.message}`);
    }
  }

  // 订单相关
  async getOrders(params = {}) {
    try {
      const result = await this.callCloudFunction('erp-api', {
        action: 'orders',
        method: 'getList',
        data: params
      });

      return result.result;
    } catch (error) {
      console.error('获取订单列表失败:', error);
      // 如果云函数调用失败，回退到直接数据库查询
      try {
        const query = this.buildQueryFromParams(params);
        const result = await this.database.query('orders', query, {
          skip: (params.page - 1) * params.limit,
          limit: params.limit,
          orderBy: 'createdAt_desc'
        });

        return {
          success: true,
          data: result.data,
          pagination: {
            page: params.page,
            limit: params.limit,
            total: result.total
          }
        };
      } catch (fallbackError) {
        console.error('数据库查询回退失败:', fallbackError);
        throw new Error(`获取订单列表失败: ${error.message}`);
      }
    }
  }

  async getOrderDetail(id) {
    try {
      const result = await this.callCloudFunction('erp-api', {
        action: 'orders',
        method: 'getDetail',
        data: { id: id }
      });

      return result.result;
    } catch (error) {
      console.error('获取订单详情失败:', error);
      // 回退到直接数据库查询
      try {
        const result = await this.database.getById('orders', id);
        return {
          success: true,
          data: result.data
        };
      } catch (fallbackError) {
        console.error('数据库查询回退失败:', fallbackError);
        throw new Error(`获取订单详情失败: ${error.message}`);
      }
    }
  }

  // 工单相关
  async getWorkOrders(params = {}) {
    try {
      const result = await this.callCloudFunction('erp-api', {
        action: 'workOrders',
        method: 'getList',
        data: params
      });

      return result.result;
    } catch (error) {
      console.error('获取工单列表失败:', error);
      // 回退到直接数据库查询
      try {
        const query = this.buildQueryFromParams(params);
        const result = await this.database.query('workorders', query, {
          skip: (params.page - 1) * params.limit,
          limit: params.limit,
          orderBy: 'createdAt_desc'
        });

        return {
          success: true,
          data: result.data,
          pagination: {
            page: params.page,
            limit: params.limit,
            total: result.total
          }
        };
      } catch (fallbackError) {
        console.error('数据库查询回退失败:', fallbackError);
        throw new Error(`获取工单列表失败: ${error.message}`);
      }
    }
  }

  async getWorkOrderDetail(id) {
    try {
      const result = await this.callCloudFunction('erp-api', {
        action: 'workOrders',
        method: 'getDetail',
        data: { id: id }
      });

      return result.result;
    } catch (error) {
      console.error('获取工单详情失败:', error);
      // 回退到直接数据库查询
      try {
        const result = await this.database.getById('workorders', id);
        return {
          success: true,
          data: result.data
        };
      } catch (fallbackError) {
        console.error('数据库查询回退失败:', fallbackError);
        throw new Error(`获取工单详情失败: ${error.message}`);
      }
    }
  }

  // 仪表板统计数据
  async getDashboardStats() {
    try {
      const result = await this.callCloudFunction('erp-api', {
        action: 'dashboard',
        method: 'getStats',
        data: {}
      });

      return result.result;
    } catch (error) {
      console.error('获取仪表板统计失败:', error);
      // 手动计算统计数据
      try {
        const [ordersCount, workOrdersCount, customersCount] = await Promise.all([
          this.database.query('orders').then(r => r.data.length),
          this.database.query('workorders').then(r => r.data.length),
          this.database.query('customers').then(r => r.data.length)
        ]);

        return {
          success: true,
          data: {
            totalOrders: ordersCount,
            totalWorkOrders: workOrdersCount,
            totalCustomers: customersCount,
            // 其他统计数据...
          }
        };
      } catch (fallbackError) {
        console.error('数据库统计回退失败:', fallbackError);
        throw new Error(`获取统计失败: ${error.message}`);
      }
    }
  }

  // 最近活动
  async getDashboardRecent() {
    try {
      const result = await this.callCloudFunction('erp-api', {
        action: 'dashboard',
        method: 'getRecent',
        data: {}
      });

      return result.result;
    } catch (error) {
      console.error('获取最近活动失败:', error);
      // 回退到数据库查询
      try {
        const orders = await this.database.query('orders', {}, {
          orderBy: 'createdAt_desc',
          limit: 10
        });

        return {
          success: true,
          data: orders.data
        };
      } catch (fallbackError) {
        console.error('数据库查询回退失败:', fallbackError);
        throw new Error(`获取最近活动失败: ${error.message}`);
      }
    }
  }

  // 工具方法：从参数构建查询条件
  buildQueryFromParams(params) {
    const query = { conditions: {} };

    if (params.status) {
      query.conditions.status = params.status;
    }
    if (params.customerId) {
      query.conditions.customerId = params.customerId;
    }
    if (params.search) {
      // 简单的搜索逻辑，实际应该使用正则表达式
      query.conditions.$or = [
        { orderNumber: { $regex: params.search } },
        { customerName: { $regex: params.search } }
      ];
    }

    return query;
  }
}

// 创建全局云API实例
const cloudAPI = new CloudAPIAdapter();

// 导出云API适配器
module.exports = {
  cloudAPI,
  isUsingCloudDevelopment,
  CloudDatabaseAdapter,
  ensureCloudInit
};
