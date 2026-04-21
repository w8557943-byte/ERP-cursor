const cloud = require('wx-server-sdk');
// 初始化云开发
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();

/**
 * 荣禾ERP - 工具云函数
 * 提供通用的工具函数和辅助功能
 */

// 工具函数集合
const tools = {
  /**
   * 格式化日期时间
   */
  formatDateTime(date, format = 'YYYY-MM-DD HH:mm:ss') {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hours = String(d.getHours()).padStart(2, '0');
    const minutes = String(d.getMinutes()).padStart(2, '0');
    const seconds = String(d.getSeconds()).padStart(2, '0');
    
    return format
      .replace('YYYY', year)
      .replace('MM', month)
      .replace('DD', day)
      .replace('HH', hours)
      .replace('mm', minutes)
      .replace('ss', seconds);
  },

  /**
   * 生成唯一ID
   */
  generateId(prefix = '') {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substr(2, 9);
    return `${prefix}${timestamp}_${random}`;
  },

  /**
   * 数据验证
   */
  validateData(data, schema) {
    const errors = [];
    
    for (const field in schema) {
      const rule = schema[field];
      const value = data[field];
      
      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push(`${field}是必填字段`);
        continue;
      }
      
      if (value !== undefined && value !== null) {
        if (rule.type && typeof value !== rule.type) {
          errors.push(`${field}应该是${rule.type}类型`);
        }
        
        if (rule.minLength && value.length < rule.minLength) {
          errors.push(`${field}长度不能少于${rule.minLength}个字符`);
        }
        
        if (rule.maxLength && value.length > rule.maxLength) {
          errors.push(`${field}长度不能超过${rule.maxLength}个字符`);
        }
        
        if (rule.pattern && !rule.pattern.test(value)) {
          errors.push(`${field}格式不正确`);
        }
      }
    }
    
    return {
      valid: errors.length === 0,
      errors
    };
  },

  /**
   * 分页计算
   */
  calculatePagination(page, limit, total) {
    const currentPage = parseInt(page) || 1;
    const pageSize = parseInt(limit) || 10;
    const totalItems = total;
    const totalPages = Math.ceil(totalItems / pageSize);
    
    return {
      currentPage,
      pageSize,
      totalItems,
      totalPages,
      hasNext: currentPage < totalPages,
      hasPrev: currentPage > 1,
      skip: (currentPage - 1) * pageSize
    };
  },

  /**
   * 数组分页
   */
  paginateArray(array, page, limit) {
    const pagination = this.calculatePagination(page, limit, array.length);
    const start = pagination.skip;
    const end = start + pagination.pageSize;
    
    return {
      data: array.slice(start, end),
      pagination
    };
  },

  /**
   * 深拷贝
   */
  deepClone(obj) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (obj instanceof Date) return new Date(obj.getTime());
    if (obj instanceof Array) return obj.map(item => this.deepClone(item));
    if (typeof obj === 'object') {
      const clonedObj = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          clonedObj[key] = this.deepClone(obj[key]);
        }
      }
      return clonedObj;
    }
  },

  /**
   * 防抖函数
   */
  debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  },

  /**
   * 节流函数
   */
  throttle(func, limit) {
    let inThrottle;
    return function executedFunction(...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  },

  /**
   * 字符串脱敏
   */
  maskString(str, start = 3, end = 4, maskChar = '*') {
    if (!str || str.length <= start + end) return str;
    
    const startPart = str.substring(0, start);
    const endPart = str.substring(str.length - end);
    const maskLength = str.length - start - end;
    const mask = maskChar.repeat(maskLength);
    
    return startPart + mask + endPart;
  },

  /**
   * 文件大小格式化
   */
  formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  },

  /**
   * 颜色工具
   */
  generateColor(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = str.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const hue = hash % 360;
    return `hsl(${hue}, 65%, 50%)`;
  }
};

/**
 * 处理各种工具操作
 */
async function handleToolOperation(action, params) {
  switch (action) {
    case 'format_datetime':
      return {
        success: true,
        data: tools.formatDateTime(params.date, params.format)
      };
    
    case 'generate_id':
      return {
        success: true,
        data: tools.generateId(params.prefix)
      };
    
    case 'validate_data':
      return {
        success: true,
        data: tools.validateData(params.data, params.schema)
      };
    
    case 'calculate_pagination':
      return {
        success: true,
        data: tools.calculatePagination(params.page, params.limit, params.total)
      };
    
    case 'paginate_array':
      return {
        success: true,
        data: tools.paginateArray(params.array, params.page, params.limit)
      };
    
    case 'deep_clone':
      return {
        success: true,
        data: tools.deepClone(params.data)
      };
    
    case 'mask_string':
      return {
        success: true,
        data: tools.maskString(params.str, params.start, params.end, params.maskChar)
      };
    
    case 'format_file_size':
      return {
        success: true,
        data: tools.formatFileSize(params.bytes)
      };
    
    case 'generate_color':
      return {
        success: true,
        data: tools.generateColor(params.str)
      };
    
    case 'health_check':
      return {
        success: true,
        data: {
          status: 'healthy',
          timestamp: new Date(),
          tools: Object.keys(tools).length
        }
      };
    
    default:
      throw new Error(`未知的工具操作: ${action}`);
  }
}

/**
 * 数据库工具操作
 */
async function handleDbOperation(action, params) {
  switch (action) {
    case 'collection_stats':
      try {
        const count = await db.collection(params.collection).count();
        return {
          success: true,
          data: {
            collection: params.collection,
            count: count.total,
            timestamp: new Date()
          }
        };
      } catch (error) {
        throw new Error(`获取集合统计失败: ${error.message}`);
      }
    
    case 'batch_insert':
      try {
        const collection = db.collection(params.collection);
        const data = Array.isArray(params.data) ? params.data : [params.data];
        
        const promises = data.map(item => collection.add({
          data: {
            ...item,
            createdAt: new Date(),
            updatedAt: new Date()
          }
        }));
        
        const results = await Promise.all(promises);
        
        return {
          success: true,
          data: {
            inserted: results.length,
            ids: results.map(r => r._id),
            timestamp: new Date()
          }
        };
      } catch (error) {
        throw new Error(`批量插入失败: ${error.message}`);
      }
    
    case 'cleanup_old_records':
      try {
        const cutoff = new Date(Date.now() - (params.days * 24 * 60 * 60 * 1000));
        
        const result = await db.collection(params.collection)
          .where({
            createdAt: db.lt(cutoff)
          })
          .remove();
        
        return {
          success: true,
          data: {
            deleted: result.stats.removed,
            cutoff: cutoff,
            timestamp: new Date()
          }
        };
      } catch (error) {
        throw new Error(`清理旧记录失败: ${error.message}`);
      }
    
    case 'health_check':
      try {
        await db.collection('users').limit(1).get();
        return {
          success: true,
          data: {
            status: 'healthy',
            database: 'connected',
            timestamp: new Date()
          }
        };
      } catch (error) {
        return {
          success: false,
          data: {
            status: 'unhealthy',
            database: 'disconnected',
            error: error.message,
            timestamp: new Date()
          }
        };
      }
    
    default:
      throw new Error(`未知的数据库操作: ${action}`);
  }
}

/**
 * 主入口函数
 */
exports.main = async (event, context) => {
  console.log('工具云函数请求:', event);
  
  try {
    const { action, params = {}, operation_type = 'tools' } = event;
    
    if (!action) {
      throw new Error('缺少action参数');
    }
    
    let result;
    
    if (operation_type === 'database') {
      result = await handleDbOperation(action, params);
    } else {
      result = await handleToolOperation(action, params);
    }
    
    return {
      success: true,
      message: `${action}操作执行成功`,
      data: result.data,
      timestamp: new Date()
    };
  } catch (error) {
    console.error('工具云函数错误:', error);
    
    return {
      success: false,
      message: error.message,
      timestamp: new Date()
    };
  }
};