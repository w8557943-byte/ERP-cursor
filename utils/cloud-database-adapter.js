/**
 * 荣禾ERP - 云数据库适配器
 * 支持电脑端API与云开发数据库的数据交互
 * 实现传统HTTP API与云开发的无缝对接
 */

const cloud = require('wx-server-sdk');

// 初始化云开发
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

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

  /**
   * 构建云数据库查询
   * @param {Object} params - API参数
   * @param {Object} options - 查询选项
   */
  buildCloudQuery(params = {}, options = {}) {
    let query = db.collection(options.collection);
    const conditions = {};

    // 处理状态筛选
    if (params.status) {
      conditions.status = params.status;
    }

    // 处理客户筛选
    if (params.customerId) {
      conditions.customerId = params.customerId;
    }

    // 处理搜索关键词
    if (params.search) {
      // 使用正则表达式进行模糊搜索
      query = query.where(db.RegExp({
        regexp: params.search,
        options: 'i'
      }));
    }

    // 处理ID筛选
    if (params.id) {
      conditions._id = params.id;
    }

    // 应用查询条件
    if (Object.keys(conditions).length > 0) {
      query = query.where(conditions);
    }

    // 处理排序
    if (params.orderBy) {
      const [field, order] = params.orderBy.split('_');
      query = query.orderBy(field, order === 'desc' ? 'desc' : 'asc');
    } else {
      // 默认按创建时间降序
      query = query.orderBy('createdAt', 'desc');
    }

    // 处理分页
    const page = parseInt(params.page) || 1;
    const limit = parseInt(params.limit) || 10;
    const skip = (page - 1) * limit;

    if (skip > 0) {
      query = query.skip(skip);
    }
    if (limit > 0) {
      query = query.limit(limit);
    }

    return {
      query,
      pagination: {
        page,
        limit,
        skip
      }
    };
  }

  /**
   * 执行云数据库查询
   * @param {string} collection - 集合名
   * @param {Object} params - 查询参数
   */
  async executeQuery(collection, params = {}) {
    try {
      const { query, pagination } = this.buildCloudQuery(params, { collection });
      const result = await query.get();

      // 获取总数（用于分页）
      const countResult = await db.collection(collection).count();
      const total = countResult.total;

      return {
        success: true,
        data: result.data,
        pagination: {
          page: pagination.page,
          limit: pagination.limit,
          total: total,
          pages: Math.ceil(total / pagination.limit)
        },
        message: '查询成功'
      };
    } catch (error) {
      console.error(`查询失败 [${collection}]:`, error);
      throw new Error(`数据库查询失败: ${error.message}`);
    }
  }

  /**
   * 获取单条记录
   * @param {string} collection - 集合名
   * @param {string} id - 记录ID
   */
  async getById(collection, id) {
    try {
      const result = await db.collection(collection).doc(id).get();
      
      return {
        success: true,
        data: result.data,
        message: '获取成功'
      };
    } catch (error) {
      console.error(`获取记录失败 [${collection}/${id}]:`, error);
      throw new Error(`获取记录失败: ${error.message}`);
    }
  }

  /**
   * 创建记录
   * @param {string} collection - 集合名
   * @param {Object} data - 记录数据
   */
  async create(collection, data) {
    try {
      // 添加系统字段
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
        },
        message: '创建成功'
      };
    } catch (error) {
      console.error(`创建记录失败 [${collection}]:`, error);
      throw new Error(`创建记录失败: ${error.message}`);
    }
  }

  /**
   * 更新记录
   * @param {string} collection - 集合名
   * @param {string} id - 记录ID
   * @param {Object} data - 更新数据
   */
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
        },
        message: '更新成功'
      };
    } catch (error) {
      console.error(`更新记录失败 [${collection}/${id}]:`, error);
      throw new Error(`更新记录失败: ${error.message}`);
    }
  }

  /**
   * 删除记录
   * @param {string} collection - 集合名
   * @param {string} id - 记录ID
   */
  async delete(collection, id) {
    try {
      const result = await db.collection(collection).doc(id).remove();

      return {
        success: true,
        data: result.stats,
        message: '删除成功'
      };
    } catch (error) {
      console.error(`删除记录失败 [${collection}/${id}]:`, error);
      throw new Error(`删除记录失败: ${error.message}`);
    }
  }

  /**
   * 批量创建记录
   * @param {string} collection - 集合名
   * @param {Array} dataArray - 记录数据数组
   */
  async batchCreate(collection, dataArray) {
    try {
      if (!Array.isArray(dataArray)) {
        throw new Error('数据必须是数组格式');
      }

      // 为每条记录添加系统字段
      const recordsWithSystemFields = dataArray.map(data => ({
        ...data,
        createdAt: new Date(),
        updatedAt: new Date()
      }));

      // 批量添加记录（微信云开发限制单次最多20条）
      const batchSize = 20;
      const results = [];

      for (let i = 0; i < recordsWithSystemFields.length; i += batchSize) {
        const batch = recordsWithSystemFields.slice(i, i + batchSize);
        const promises = batch.map(record => 
          db.collection(collection).add({ data: record })
        );
        
        const batchResults = await Promise.all(promises);
        results.push(...batchResults);
      }

      return {
        success: true,
        data: results.map(result => ({
          _id: result._id,
          success: true
        })),
        message: `成功创建${results.length}条记录`
      };
    } catch (error) {
      console.error(`批量创建失败 [${collection}]:`, error);
      throw new Error(`批量创建失败: ${error.message}`);
    }
  }

  /**
   * 批量操作
   * @param {string} collection - 集合名
   * @param {Array} operations - 操作数组
   */
  async batchOperation(collection, operations) {
    try {
      const transaction = await db.startTransaction();
      
      try {
        const results = [];
        
        for (const operation of operations) {
          const { action, data, id } = operation;
          
          switch (action) {
            case 'create':
              const createResult = await transaction.collection(collection).add({
                data: {
                  ...data,
                  createdAt: new Date(),
                  updatedAt: new Date()
                }
              });
              results.push({ action, id: createResult._id, success: true });
              break;
              
            case 'update':
              await transaction.collection(collection).doc(id).update({
                data: {
                  ...data,
                  updatedAt: new Date()
                }
              });
              results.push({ action, id, success: true });
              break;
              
            case 'delete':
              await transaction.collection(collection).doc(id).remove();
              results.push({ action, id, success: true });
              break;
              
            default:
              throw new Error(`不支持的操作类型: ${action}`);
          }
        }
        
        await transaction.commit();
        
        return {
          success: true,
          data: results,
          message: '批量操作成功'
        };
      } catch (error) {
        await transaction.rollback();
        throw error;
      }
    } catch (error) {
      console.error(`批量操作失败 [${collection}]:`, error);
      throw new Error(`批量操作失败: ${error.message}`);
    }
  }

  /**
   * 统计查询
   * @param {string} collection - 集合名
   * @param {Object} conditions - 统计条件
   */
  async getStats(collection, conditions = {}) {
    try {
      let query = db.collection(collection);
      
      // 应用统计条件
      if (conditions.status) {
        query = query.where({ status: conditions.status });
      }
      if (conditions.dateRange) {
        query = query.where({
          createdAt: db.Gte(new Date(conditions.dateRange.start))
            .and(db.Lte(new Date(conditions.dateRange.end)))
        });
      }
      
      const countResult = await query.count();
      
      return {
        success: true,
        data: {
          total: countResult.total,
          collection: collection
        },
        message: '统计查询成功'
      };
    } catch (error) {
      console.error(`统计查询失败 [${collection}]:`, error);
      throw new Error(`统计查询失败: ${error.message}`);
    }
  }
}

// 创建适配器实例
const cloudAdapter = new CloudDatabaseAdapter();

// 导出适配器
module.exports = {
  cloudAdapter,
  CloudDatabaseAdapter
};