/**
 * Enhanced API Service with Caching
 * Wraps existing API calls with intelligent caching layer
 */

import { createCachedAPI, cachedParallelBatchFetch, invalidateCache } from '../utils/cachedAPI'
import { orderAPI as originalOrderAPI, purchaseAPI as originalPurchaseAPI, customerAPI as originalCustomerAPI, customerSkuAPI as originalCustomerSkuAPI, productAPI as originalProductAPI } from './api'
import { OPT_FLAGS } from '../utils/constants'

// Cache configuration
const GLOBAL_CACHE_ENABLED = OPT_FLAGS.ENABLE_CACHED_API
const DEFAULT_BATCH_WINDOW = (() => {
    const n = Number(import.meta.env.VITE_REQUEST_BATCH_WINDOW)
    return Number.isFinite(n) && n > 0 ? n : 50
})()

const CACHE_CONFIG = {
    orders: {
        namespace: 'orders',
        ttl: 5 * 60 * 1000, // 5 minutes
        enabled: GLOBAL_CACHE_ENABLED
    },
    purchases: {
        namespace: 'purchases',
        ttl: 5 * 60 * 1000,
        enabled: GLOBAL_CACHE_ENABLED
    },
    customers: {
        namespace: 'customers',
        ttl: 10 * 60 * 1000, // 10 minutes (changes less frequently)
        enabled: GLOBAL_CACHE_ENABLED
    },
    customerSkus: {
        namespace: 'customer_skus',
        ttl: 10 * 60 * 1000,
        enabled: GLOBAL_CACHE_ENABLED
    },
    products: {
        namespace: 'products',
        ttl: 10 * 60 * 1000,
        enabled: GLOBAL_CACHE_ENABLED
    }
}

/**
 * Enhanced Order API with caching
 */
export const cachedOrderAPI = {
    // Cached single order fetch
    getOrder: createCachedAPI(
        originalOrderAPI.getOrder,
        {
            ...CACHE_CONFIG.orders,
            trackPerformance: OPT_FLAGS.ENABLE_PERFORMANCE_MONITOR,
            trackCloudCalls: OPT_FLAGS.ENABLE_CLOUD_CALL_MONITOR,
            useBatcher: OPT_FLAGS.ENABLE_REQUEST_BATCHER,
            batchWindow: DEFAULT_BATCH_WINDOW,
            useRateLimiter: OPT_FLAGS.ENABLE_RATE_LIMITER,
            cacheKey: (id) => `order_${id}`
        }
    ),

    // Cached orders list
    getOrders: createCachedAPI(
        originalOrderAPI.getOrders,
        {
            ...CACHE_CONFIG.orders,
            trackPerformance: OPT_FLAGS.ENABLE_PERFORMANCE_MONITOR,
            trackCloudCalls: OPT_FLAGS.ENABLE_CLOUD_CALL_MONITOR,
            useBatcher: OPT_FLAGS.ENABLE_REQUEST_BATCHER,
            batchWindow: DEFAULT_BATCH_WINDOW,
            useRateLimiter: OPT_FLAGS.ENABLE_RATE_LIMITER,
            cacheKey: (params) => {
                const { page = 1, pageSize, limit, ...rest } = params || {}
                const effectiveLimit = Number.isFinite(Number(pageSize))
                    ? Number(pageSize)
                    : (Number.isFinite(Number(limit)) ? Number(limit) : 20)
                if (effectiveLimit >= 500) {
                    return 'orders_batch'
                }
                return JSON.stringify({ page, limit: effectiveLimit, ...rest })
            }
        }
    ),

    // Batch fetch all orders (cached)
    getAllOrders: async (options = {}) => {
        return cachedParallelBatchFetch(
            originalOrderAPI.getOrders,
            {
                ...CACHE_CONFIG.orders,
                cacheKey: 'orders_all',
                pageSize: 500,
                maxPages: 20,
                concurrentPages: 3,
                ...options
            }
        )
    },

    // Write operations - invalidate cache
    createOrder: async (data) => {
        const result = await originalOrderAPI.createOrder(data)
        invalidateCache('orders')
        return result
    },

    updateOrder: async (id, data) => {
        const result = await originalOrderAPI.updateOrder(id, data)
        invalidateCache('orders', `order_${id}`)
        invalidateCache('orders', 'orders_batch')
        invalidateCache('orders', 'orders_all')
        return result
    },

    deleteOrder: async (id) => {
        const result = await originalOrderAPI.deleteOrder(id)
        invalidateCache('orders')
        return result
    }
}

/**
 * Enhanced Purchase API with caching
 */
export const cachedPurchaseAPI = {
    getPurchaseOrder: createCachedAPI(
        originalPurchaseAPI.getPurchaseOrder,
        {
            ...CACHE_CONFIG.purchases,
            trackPerformance: OPT_FLAGS.ENABLE_PERFORMANCE_MONITOR,
            trackCloudCalls: OPT_FLAGS.ENABLE_CLOUD_CALL_MONITOR,
            useBatcher: OPT_FLAGS.ENABLE_REQUEST_BATCHER,
            batchWindow: DEFAULT_BATCH_WINDOW,
            useRateLimiter: OPT_FLAGS.ENABLE_RATE_LIMITER,
            cacheKey: (id) => `purchase_${id}`
        }
    ),

    getPurchaseOrders: createCachedAPI(
        originalPurchaseAPI.getPurchaseOrders,
        {
            ...CACHE_CONFIG.purchases,
            trackPerformance: OPT_FLAGS.ENABLE_PERFORMANCE_MONITOR,
            trackCloudCalls: OPT_FLAGS.ENABLE_CLOUD_CALL_MONITOR,
            useBatcher: OPT_FLAGS.ENABLE_REQUEST_BATCHER,
            batchWindow: DEFAULT_BATCH_WINDOW,
            useRateLimiter: OPT_FLAGS.ENABLE_RATE_LIMITER,
            cacheKey: (params) => {
                const { page = 1, pageSize, limit, ...rest } = params || {}
                const effectiveLimit = Number.isFinite(Number(pageSize))
                    ? Number(pageSize)
                    : (Number.isFinite(Number(limit)) ? Number(limit) : 20)
                return JSON.stringify({ page, limit: effectiveLimit, ...rest })
            }
        }
    ),

    getAllPurchaseOrders: async (options = {}) => {
        return cachedParallelBatchFetch(
            originalPurchaseAPI.getPurchaseOrders,
            {
                ...CACHE_CONFIG.purchases,
                cacheKey: 'purchases_all',
                pageSize: 500,
                maxPages: 20,
                concurrentPages: 3,
                ...options
            }
        )
    },

    createPurchaseOrder: async (data) => {
        const result = await originalPurchaseAPI.createPurchaseOrder(data)
        invalidateCache('purchases')
        return result
    },

    updatePurchaseOrder: async (id, data) => {
        const result = await originalPurchaseAPI.updatePurchaseOrder(id, data)
        invalidateCache('purchases', `purchase_${id}`)
        invalidateCache('purchases', 'purchases_batch')
        invalidateCache('purchases', 'purchases_all')
        return result
    },

    deletePurchaseOrder: async (id) => {
        const result = await originalPurchaseAPI.deletePurchaseOrder(id)
        invalidateCache('purchases')
        return result
    }
}

/**
 * Enhanced Customer API with caching
 */
export const cachedCustomerAPI = {
    getCustomer: createCachedAPI(
        originalCustomerAPI.getCustomer,
        {
            ...CACHE_CONFIG.customers,
            trackPerformance: OPT_FLAGS.ENABLE_PERFORMANCE_MONITOR,
            trackCloudCalls: OPT_FLAGS.ENABLE_CLOUD_CALL_MONITOR,
            useBatcher: OPT_FLAGS.ENABLE_REQUEST_BATCHER,
            batchWindow: DEFAULT_BATCH_WINDOW,
            useRateLimiter: OPT_FLAGS.ENABLE_RATE_LIMITER,
            cacheKey: (id) => `customer_${id}`
        }
    ),

    getCustomers: createCachedAPI(
        originalCustomerAPI.getCustomers,
        {
            ...CACHE_CONFIG.customers,
            trackPerformance: OPT_FLAGS.ENABLE_PERFORMANCE_MONITOR,
            trackCloudCalls: OPT_FLAGS.ENABLE_CLOUD_CALL_MONITOR,
            useBatcher: OPT_FLAGS.ENABLE_REQUEST_BATCHER,
            batchWindow: DEFAULT_BATCH_WINDOW,
            useRateLimiter: OPT_FLAGS.ENABLE_RATE_LIMITER,
            cacheKey: (params) => {
                const { page = 1, pageSize, limit, keyword, status, search, q, ...rest } = params || {}
                const effectiveLimit = Number.isFinite(Number(pageSize))
                    ? Number(pageSize)
                    : (Number.isFinite(Number(limit)) ? Number(limit) : 100)
                if (effectiveLimit >= 1000) {
                    const kw = String(keyword || search || q || '').trim()
                    const st = String(status || '').trim()
                    return kw || st ? `customers_all:${JSON.stringify({ kw, st, ...rest })}` : 'customers_all'
                }
                const kw = String(keyword || search || q || '').trim()
                const st = String(status || '').trim()
                return JSON.stringify({ page, limit: effectiveLimit, kw, st, ...rest })
            }
        }
    ),

    getAllCustomers: async (options = {}) => {
        return cachedParallelBatchFetch(
            originalCustomerAPI.getCustomers,
            {
                ...CACHE_CONFIG.customers,
                cacheKey: 'customers_all',
                pageSize: 1000,
                maxPages: 10,
                concurrentPages: 2,
                ...options
            }
        )
    },

    createCustomer: async (data) => {
        const result = await originalCustomerAPI.createCustomer(data)
        invalidateCache('customers')
        return result
    },

    updateCustomer: async (id, data) => {
        const result = await originalCustomerAPI.updateCustomer(id, data)
        invalidateCache('customers', `customer_${id}`)
        invalidateCache('customers', 'customers_all')
        return result
    },

    deleteCustomer: async (id) => {
        const result = await originalCustomerAPI.deleteCustomer(id)
        invalidateCache('customers')
        return result
    }
}

export const cachedCustomerSkuAPI = {
    getCustomerSkus: createCachedAPI(
        ({ customerId, params }) => originalCustomerSkuAPI.getCustomerSkus(customerId, params),
        {
            ...CACHE_CONFIG.customerSkus,
            trackPerformance: OPT_FLAGS.ENABLE_PERFORMANCE_MONITOR,
            trackCloudCalls: OPT_FLAGS.ENABLE_CLOUD_CALL_MONITOR,
            useBatcher: OPT_FLAGS.ENABLE_REQUEST_BATCHER,
            batchWindow: DEFAULT_BATCH_WINDOW,
            useRateLimiter: OPT_FLAGS.ENABLE_RATE_LIMITER,
            cacheKey: ({ customerId, params }) => `customer_skus:${customerId}:${JSON.stringify(params || {})}`
        }
    ),
    batchSetMaterial: async (customerId, data) => {
        const result = await originalCustomerSkuAPI.batchSetMaterial(customerId, data)
        invalidateCache('customer_skus')
        return result
    },
    createCustomerSku: async (customerId, data) => {
        const result = await originalCustomerSkuAPI.createCustomerSku(customerId, data)
        invalidateCache('customer_skus')
        return result
    },
    updateCustomerSku: async (customerId, skuId, data) => {
        const result = await originalCustomerSkuAPI.updateCustomerSku(customerId, skuId, data)
        invalidateCache('customer_skus')
        return result
    },
    deleteCustomerSku: async (customerId, skuId) => {
        const result = await originalCustomerSkuAPI.deleteCustomerSku(customerId, skuId)
        invalidateCache('customer_skus')
        return result
    },
    importCustomerSkus: async (customerId, rows, options = {}) => {
        const result = await originalCustomerSkuAPI.importCustomerSkus(customerId, rows, options)
        invalidateCache('customer_skus')
        return result
    }
}

/**
 * Enhanced Product API with caching
 */
export const cachedProductAPI = {
    getProduct: createCachedAPI(
        originalProductAPI.getProduct,
        {
            ...CACHE_CONFIG.products,
            trackPerformance: OPT_FLAGS.ENABLE_PERFORMANCE_MONITOR,
            trackCloudCalls: OPT_FLAGS.ENABLE_CLOUD_CALL_MONITOR,
            useBatcher: OPT_FLAGS.ENABLE_REQUEST_BATCHER,
            batchWindow: DEFAULT_BATCH_WINDOW,
            useRateLimiter: OPT_FLAGS.ENABLE_RATE_LIMITER,
            cacheKey: (id) => `product_${id}`
        }
    ),

    getProducts: createCachedAPI(
        originalProductAPI.getProducts,
        {
            ...CACHE_CONFIG.products,
            trackPerformance: OPT_FLAGS.ENABLE_PERFORMANCE_MONITOR,
            trackCloudCalls: OPT_FLAGS.ENABLE_CLOUD_CALL_MONITOR,
            useBatcher: OPT_FLAGS.ENABLE_REQUEST_BATCHER,
            batchWindow: DEFAULT_BATCH_WINDOW,
            useRateLimiter: OPT_FLAGS.ENABLE_RATE_LIMITER,
            cacheKey: (params) => {
                const { page = 1, pageSize, limit, ...rest } = params || {}
                const effectiveLimit = Number.isFinite(Number(pageSize))
                    ? Number(pageSize)
                    : (Number.isFinite(Number(limit)) ? Number(limit) : 50)
                if (effectiveLimit >= 500) {
                    return 'products_batch'
                }
                return JSON.stringify({ page, limit: effectiveLimit, ...rest })
            }
        }
    ),

    getAllProducts: async (options = {}) => {
        return cachedParallelBatchFetch(
            originalProductAPI.getProducts,
            {
                ...CACHE_CONFIG.products,
                cacheKey: 'products_all',
                pageSize: 500,
                maxPages: 20,
                concurrentPages: 3,
                ...options
            }
        )
    },

    createProduct: async (data) => {
        const result = await originalProductAPI.createProduct(data)
        invalidateCache('products')
        return result
    },

    updateProduct: async (id, data) => {
        const result = await originalProductAPI.updateProduct(id, data)
        invalidateCache('products', `product_${id}`)
        invalidateCache('products', 'products_batch')
        invalidateCache('products', 'products_all')
        return result
    },

    updateProductStock: async (id, data) => {
        const result = await originalProductAPI.updateProductStock(id, data)
        invalidateCache('products', `product_${id}`)
        invalidateCache('products', 'products_batch')
        invalidateCache('products', 'products_all')
        return result
    },

    deleteProduct: async (id) => {
        const result = await originalProductAPI.deleteProduct(id)
        invalidateCache('products')
        return result
    }
}

/**
 * Utility: Invalidate all caches
 */
export function invalidateAllCaches() {
    invalidateCache('orders')
    invalidateCache('purchases')
    invalidateCache('customers')
    invalidateCache('customer_skus')
    invalidateCache('products')
}

/**
 * Utility: Prefetch common data
 */
export async function prefetchCommonData() {
    // Prefetch in background (don't await)
    cachedOrderAPI.getAllOrders().catch(() => { })
    cachedPurchaseAPI.getAllPurchaseOrders().catch(() => { })
    cachedCustomerAPI.getAllCustomers().catch(() => { })
    cachedProductAPI.getAllProducts().catch(() => { })
}

export async function prefetchHotData() {
    cachedCustomerAPI.getCustomers({ page: 1, limit: 1000 }).catch(() => { })
    cachedOrderAPI.getOrders({ page: 1, limit: 50, withTotal: false, orderBy: 'createdAt_desc' }).catch(() => { })
    cachedPurchaseAPI.getPurchaseOrders({ page: 1, pageSize: 50, category: 'boards', withTotal: false, withProducts: false }).catch(() => { })
}
