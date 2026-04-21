/**
 * 统一API调用封装
 * 提供一致的接口调用方式，支持错误处理、重试、缓存等功能
 */

const { logger } = require('./logger');

// API 配置
const API_CONFIG = {
    timeout: 30000,           // 请求超时时间
    retryTimes: 3,            // 重试次数
    retryDelay: 1000,         // 重试延迟（毫秒）
    cacheEnabled: true,       // 是否启用缓存
    cacheTTL: 60000          // 缓存过期时间（毫秒）
};

// 简单的内存缓存
const cache = new Map();

/**
 * 清理过期缓存
 */
function cleanExpiredCache() {
    const now = Date.now();
    for (const [key, value] of cache.entries()) {
        if (value.expireAt < now) {
            cache.delete(key);
        }
    }
}

// 定期清理缓存
setInterval(cleanExpiredCache, 60000);

/**
 * 生成缓存键
 */
function getCacheKey(action, params) {
    try {
        return `${action}:${JSON.stringify(params || {})}`;
    } catch (e) {
        return `${action}:${Date.now()}`;
    }
}

/**
 * 延迟函数
 */
function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 统一的API调用函数
 * @param {string} action - 操作名称
 * @param {object} params - 请求参数
 * @param {object} options - 配置选项
 * @returns {Promise} API响应
 */
async function callAPI(action, params = {}, options = {}) {
    const config = { ...API_CONFIG, ...options };
    const cacheKey = getCacheKey(action, params);

    // 检查缓存
    if (config.cacheEnabled && cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        if (cached.expireAt > Date.now()) {
            logger.debug('API', `使用缓存: ${action}`);
            return cached.data;
        }
        cache.delete(cacheKey);
    }

    // 重试逻辑
    let lastError = null;
    for (let attempt = 0; attempt < config.retryTimes; attempt++) {
        try {
            if (attempt > 0) {
                logger.info('API', `重试请求 (${attempt}/${config.retryTimes}): ${action}`);
                await delay(config.retryDelay * attempt);
            }

            logger.debug('API', `调用: ${action}`, { params });

            // 调用云函数
            const result = await wx.cloud.callFunction({
                name: 'erp-api',
                data: {
                    action,
                    data: params
                }
            });

            // 检查响应
            if (!result || !result.result) {
                throw new Error('API响应格式错误');
            }

            const response = result.result;

            // 检查业务错误
            if (response.success === false) {
                const error = new Error(response.message || 'API调用失败');
                error.code = response.code;
                error.isBusinessError = true;
                throw error;
            }

            // 缓存成功的响应
            if (config.cacheEnabled && response.success !== false) {
                cache.set(cacheKey, {
                    data: response,
                    expireAt: Date.now() + config.cacheTTL
                });
            }

            logger.debug('API', `成功: ${action}`);
            return response;

        } catch (error) {
            lastError = error;

            // 业务错误不重试
            if (error.isBusinessError) {
                logger.warn('API', `业务错误: ${action}`, { message: error.message });
                throw error;
            }

            // 最后一次重试失败
            if (attempt === config.retryTimes - 1) {
                logger.error('API', `失败: ${action}`, error);
                throw error;
            }

            logger.warn('API', `请求失败，准备重试: ${action}`, {
                attempt: attempt + 1,
                error: error.message
            });
        }
    }

    throw lastError;
}

/**
 * 清除缓存
 * @param {string} action - 操作名称（可选，不传则清除所有）
 */
function clearCache(action) {
    if (action) {
        // 清除特定action的缓存
        for (const key of cache.keys()) {
            if (key.startsWith(action + ':')) {
                cache.delete(key);
            }
        }
    } else {
        // 清除所有缓存
        cache.clear();
    }
    logger.debug('API', `清除缓存: ${action || '全部'}`);
}

/**
 * 批量API调用
 * @param {Array} requests - 请求数组 [{action, params, options}]
 * @returns {Promise<Array>} 响应数组
 */
async function batchCall(requests) {
    logger.debug('API', `批量调用: ${requests.length} 个请求`);

    const promises = requests.map(req =>
        callAPI(req.action, req.params, req.options)
            .catch(error => ({ error: error.message }))
    );

    return Promise.all(promises);
}

/**
 * 常用API封装
 */
const API = {
    // 用户相关
    login: (username, password) =>
        callAPI('login', { username, password }, { cacheEnabled: false }),

    getUserInfo: (userId) =>
        callAPI('getUserInfo', { userId }),

    getUserSession: (userId) =>
        callAPI('getUserSession', { id: userId, platform: 'mp' }, { cacheEnabled: false }),

    // 订单相关
    getOrders: (params = {}) => {
        const input = params && typeof params === 'object' ? params : {};
        const normalized = { ...input };
        const rawLimit = normalized.limit ?? normalized.pageSize;
        const limit = Math.max(1, Math.floor(Number(rawLimit || 20) || 20));
        normalized.limit = limit;
        if (!Object.prototype.hasOwnProperty.call(normalized, 'page')) normalized.page = 1;
        if (!Object.prototype.hasOwnProperty.call(normalized, 'compact') && limit >= 100) normalized.compact = true;
        if (!Object.prototype.hasOwnProperty.call(normalized, 'withTotal') && limit >= 100) normalized.withTotal = false;
        return callAPI('getOrders', normalized, { cacheTTL: 30000 });
    },

    getOrderDetail: (orderId) =>
        callAPI('getOrderDetail', { id: orderId }),

    getOrder: (orderId) =>
        callAPI('getOrderDetail', { orderId }),

    createOrder: (orderData) => {
        clearCache('getOrders'); // 创建后清除列表缓存
        return callAPI('createOrder', orderData, { cacheEnabled: false });
    },

    updateOrder: (orderId, updates) => {
        clearCache('getOrders');
        clearCache('getOrderDetail');
        return callAPI('updateOrder', { orderId, ...updates }, { cacheEnabled: false });
    },

    // 生产相关
    getProductions: (params) =>
        callAPI('getProductions', params, { cacheTTL: 30000 }),

    getProductionPlans: (params) =>
        callAPI('getProductionPlans', params, { cacheTTL: 30000 }),

    getProductionPlanDetail: (planId) =>
        callAPI('getProductionPlanDetail', { id: planId }),

    updateProduction: (productionId, updates) => {
        clearCache('getProductions');
        clearCache('getProductionPlans');
        return callAPI('updateProduction', { productionId, ...updates }, { cacheEnabled: false });
    },

    updateProductionPlan: (planId, updates) => {
        clearCache('getProductionPlans');
        return callAPI('updateProductionPlan', { id: planId, data: updates }, { cacheEnabled: false });
    },

    // 客户相关
    getCustomers: (params) =>
        callAPI('getCustomers', params, { cacheTTL: 300000 }), // 客户数据缓存5分钟

    getCustomer: (customerId) =>
        callAPI('getCustomer', { customerId }),

    createCustomer: (customerData) => {
        clearCache('getCustomers');
        return callAPI('createCustomer', customerData, { cacheEnabled: false });
    },

    // 采购相关
    getPurchaseOrders: (params) =>
        callAPI('getPurchaseOrders', params, { cacheTTL: 30000 }),

    stockInPurchaseOrder: (data) => {
        clearCache('getPurchaseOrders');
        return callAPI('stockInPurchaseOrder', data, { cacheEnabled: false });
    },

    syncBoardUsageOnStart: (data) => {
        clearCache('getPurchaseOrders');
        return callAPI('syncBoardUsageOnStart', data, { cacheEnabled: false });
    },

    // 供应商相关
    getSuppliers: (params) =>
        callAPI('getSuppliers', params, { cacheTTL: 300000 }),

    // 库存相关
    getInventory: (params) =>
        callAPI('getInventory', params, { cacheTTL: 60000 }),

    // 统计相关
    getOrderStats: (params) =>
        callAPI('getOrderStats', params, { cacheTTL: 120000 }), // 统计数据缓存2分钟

    // 工作台相关
    getWorkbenchOverviewStats: (params) =>
        callAPI('getWorkbenchOverviewStats', params, { cacheTTL: 60000 }),
};

module.exports = {
    callAPI,
    clearCache,
    batchCall,
    API,
    // 导出配置供外部修改
    config: API_CONFIG
};
