/**
 * Cache-Aware API Wrapper
 * Wraps API calls with intelligent caching, deduplication, and concurrency control
 */

import { dataCache } from './dataCache'
import { performanceMonitor } from './performanceMonitor.js'
import { cloudResourceMonitor } from './cloudResourceMonitor.js'
import { getBatcher } from './requestBatcher.js'
import { throttleAPI } from './rateLimiter.js'
import { getTTL } from '../config/cacheConfig.js'

// Track in-flight requests to prevent duplicates
const inflightRequests = new Map()

// Concurrency control (increased from 3 to 5 for better throughput)
let activeRequests = 0
const MAX_CONCURRENT = 5
const requestQueue = []

/**
 * Execute request with concurrency control
 */
async function executeWithConcurrency(fn) {
    if (activeRequests >= MAX_CONCURRENT) {
        // Queue the request
        return new Promise((resolve, reject) => {
            requestQueue.push({ fn, resolve, reject })
        })
    }

    activeRequests++
    try {
        const result = await fn()
        return result
    } finally {
        activeRequests--
        // Process next queued request
        if (requestQueue.length > 0) {
            const next = requestQueue.shift()
            executeWithConcurrency(next.fn).then(next.resolve).catch(next.reject)
        }
    }
}

/**
 * Create cache-aware API wrapper
 * @param {Function} apiFn - Original API function
 * @param {Object} options - Cache options
 * @returns {Function} Wrapped API function
 */
export function createCachedAPI(apiFn, options = {}) {
    const {
        namespace = 'default',
        ttl = getTTL(namespace), // Use namespace-specific TTL
        cacheKey = (params) => JSON.stringify(params || {}),
        enabled = true,
        memoryOnly = false,
        trackPerformance = true,
        trackCloudCalls = false,
        useBatcher = false,
        batchWindow = 50,
        useRateLimiter = false
    } = options

    return async function cachedAPICall(params) {
        const startTime = Date.now()
        let cacheHit = false
        let error = null

        try {
            if (!enabled) {
                const result = await executeWithConcurrency(() => apiFn(params))
                if (trackPerformance) {
                    performanceMonitor.trackAPICall(namespace, Date.now() - startTime, { cacheHit: false, params })
                }
                return result
            }

            const key = cacheKey(params)
            const requestKey = `${namespace}:${key}`

            // Check cache first
            const cached = dataCache.get(namespace, key, { memoryOnly })
            if (cached !== null) {
                cacheHit = true
                if (trackPerformance) {
                    performanceMonitor.trackAPICall(namespace, Date.now() - startTime, { cacheHit: true, params })
                }
                return cached
            }

            // Check if request is already in-flight
            if (inflightRequests.has(requestKey)) {
                const result = await inflightRequests.get(requestKey)
                if (trackPerformance) {
                    performanceMonitor.trackAPICall(namespace, Date.now() - startTime, { cacheHit: false, deduped: true, skipAlert: true, params })
                }
                return result
            }

            // Use request batcher if enabled
            if (useBatcher) {
                const batcher = getBatcher(batchWindow)
                const result = await batcher.batch(requestKey, async () => {
                    if (trackCloudCalls) {
                        cloudResourceMonitor.trackCall(namespace, params)
                    }
                    const data = await executeWithConcurrency(() => {
                        if (useRateLimiter) {
                            return throttleAPI(() => apiFn(params))
                        }
                        return apiFn(params)
                    })
                    dataCache.set(namespace, key, data, { ttl, memoryOnly })
                    return data
                })

                if (trackPerformance) {
                    performanceMonitor.trackAPICall(namespace, Date.now() - startTime, { cacheHit: false, batched: true, params })
                }
                return result
            }

            // Execute request
            const promise = executeWithConcurrency(async () => {
                try {
                    if (trackCloudCalls) {
                        cloudResourceMonitor.trackCall(namespace, params, { duration: Date.now() - startTime })
                    }
                    const result = await (useRateLimiter ? throttleAPI(() => apiFn(params)) : apiFn(params))
                    // Cache the result
                    dataCache.set(namespace, key, result, { ttl, memoryOnly })
                    return result
                } finally {
                    inflightRequests.delete(requestKey)
                }
            })

            inflightRequests.set(requestKey, promise)
            const result = await promise

            if (trackPerformance) {
                performanceMonitor.trackAPICall(namespace, Date.now() - startTime, { cacheHit: false, params })
            }

            return result
        } catch (err) {
            error = err
            if (trackPerformance) {
                performanceMonitor.trackAPICall(namespace, Date.now() - startTime, { cacheHit, error: true, params })
            }
            throw err
        }
    }
}

/**
 * Batch fetch with caching
 * Useful for fetching multiple pages of data
 */
export async function cachedBatchFetch(apiFn, options = {}) {
    const {
        namespace = 'default',
        pageSize = 500,
        maxPages = 10,
        ttl = 5 * 60 * 1000,
        cacheKey = 'batch'
    } = options

    // Check if we have cached batch data
    const cached = dataCache.get(namespace, cacheKey)
    if (cached !== null) {
        return cached
    }

    // Fetch all pages
    const allData = []
    let page = 1
    let hasMore = true

    while (hasMore && page <= maxPages) {
        try {
            const response = await apiFn({ page, limit: pageSize })
            const data = response?.data || []

            if (data.length > 0) {
                allData.push(...data)
            }

            hasMore = data.length >= pageSize
            page++
        } catch (error) {
            console.error(`Batch fetch error on page ${page}:`, error)
            hasMore = false
        }
    }

    // Cache the complete dataset
    dataCache.set(namespace, cacheKey, allData, { ttl })
    return allData
}

/**
 * Parallel batch fetch (faster but more concurrent requests)
 */
export async function cachedParallelBatchFetch(apiFn, options = {}) {
    const {
        namespace = 'default',
        pageSize = 500,
        maxPages = 10,
        concurrentPages = 3,
        ttl = 5 * 60 * 1000,
        cacheKey = 'batch'
    } = options

    const requestKey = `${namespace}:batch:${cacheKey}`

    // Check cache
    const cached = dataCache.get(namespace, cacheKey)
    if (cached !== null) {
        console.log(`[Cache Hit] ${namespace}:${cacheKey} - ${cached.length} items from cache`)
        return cached
    }

    if (inflightRequests.has(requestKey)) {
        return inflightRequests.get(requestKey)
    }

    console.log(`[Cache Miss] ${namespace}:${cacheKey} - Fetching from API...`)
    const promise = executeWithConcurrency(async () => {
        const allData = []
        let currentPage = 1

        while (currentPage <= maxPages) {
            const pagesToFetch = []
            for (let i = 0; i < concurrentPages && currentPage <= maxPages; i++) {
                pagesToFetch.push(currentPage++)
            }

            try {
                const results = await Promise.all(
                    pagesToFetch.map(page => apiFn({ page, limit: pageSize }))
                )

                let hasData = false
                results.forEach((response) => {
                    let data = []
                    if (Array.isArray(response)) {
                        data = response
                    } else if (Array.isArray(response?.data)) {
                        data = response.data
                        } else if (Array.isArray(response?.data?.data?.customers)) {
                            data = response.data.data.customers
                        } else if (Array.isArray(response?.data?.customers)) {
                            data = response.data.customers
                    } else if (Array.isArray(response?.data?.orders)) {
                        data = response.data.orders
                    } else if (Array.isArray(response?.data?.list)) {
                        data = response.data.list
                    } else if (Array.isArray(response?.orders)) {
                        data = response.orders
                    } else if (Array.isArray(response?.list)) {
                        data = response.list
                    }

                    if (data.length > 0) {
                        allData.push(...data)
                        hasData = true
                    }
                })

                console.log(`[Batch Fetch] ${namespace} pages ${pagesToFetch.join(',')}: ${hasData ? 'has data' : 'no data'}`)

                if (!hasData) {
                    break
                }
            } catch (error) {
                console.error(`[Batch Fetch Error] ${namespace}:`, error)
                break
            }
        }

        console.log(`[Batch Complete] ${namespace}:${cacheKey} - Total ${allData.length} items`)
        dataCache.set(namespace, cacheKey, allData, { ttl })
        return allData
    })

    inflightRequests.set(requestKey, promise)
    try {
        return await promise
    } finally {
        inflightRequests.delete(requestKey)
    }
}

/**
 * Invalidate cache for specific namespace
 */
export function invalidateCache(namespace, key = null) {
    if (key) {
        dataCache.invalidate(namespace, key)
    } else {
        dataCache.invalidateNamespace(namespace)
    }
}

/**
 * Prefetch data in background
 */
export async function prefetchData(apiFn, params, options = {}) {
    const {
        namespace = 'default',
        ttl = 5 * 60 * 1000,
        cacheKey = (p) => JSON.stringify(p || {})
    } = options

    const key = cacheKey(params)

    // Check if already cached
    const cached = dataCache.get(namespace, key)
    if (cached !== null) {
        return // Already cached
    }

    // Fetch in background (don't await)
    apiFn(params)
        .then(result => {
            dataCache.set(namespace, key, result, { ttl })
        })
        .catch(error => {
            console.warn('Prefetch error:', error)
        })
}

/**
 * Get cache statistics
 */
export function getCacheStats() {
    return dataCache.getStats()
}

/**
 * Clear all cache
 */
export function clearAllCache() {
    dataCache.clear()
    inflightRequests.clear()
}
