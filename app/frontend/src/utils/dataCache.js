/**
 * Global Data Cache Utility
 * Provides intelligent caching with TTL, versioning, and invalidation
 */

import { getTTL, getTemperatureConfig } from '../config/cacheConfig.js'

const CACHE_VERSION = '1.1.0' // Updated version for new features
const DEFAULT_TTL = 5 * 60 * 1000 // 5 minutes (fallback)

class DataCache {
    constructor() {
        this.memoryCache = new Map()
        this.storagePrefix = 'erp_cache_'
        this.stats = {
            hits: 0,
            misses: 0,
            byNamespace: new Map()
        }
    }

    /**
     * Track cache hit
     */
    _trackHit(namespace) {
        this.stats.hits++
        if (!this.stats.byNamespace.has(namespace)) {
            this.stats.byNamespace.set(namespace, { hits: 0, misses: 0 })
        }
        this.stats.byNamespace.get(namespace).hits++
    }

    /**
     * Track cache miss
     */
    _trackMiss(namespace) {
        this.stats.misses++
        if (!this.stats.byNamespace.has(namespace)) {
            this.stats.byNamespace.set(namespace, { hits: 0, misses: 0 })
        }
        this.stats.byNamespace.get(namespace).misses++
    }

    /**
     * Generate cache key
     */
    _getCacheKey(namespace, key) {
        return `${this.storagePrefix}${namespace}_${key}`
    }

    /**
     * Get cached data
     * @param {string} namespace - Cache namespace (e.g., 'orders', 'customers')
     * @param {string} key - Cache key
     * @param {Object} options - Options
     * @returns {Object|null} Cached data or null if expired/missing
     */
    get(namespace, key, options = {}) {
        const { memoryOnly = false } = options
        const cacheKey = this._getCacheKey(namespace, key)

        // Try memory cache first
        if (this.memoryCache.has(cacheKey)) {
            const cached = this.memoryCache.get(cacheKey)
            if (this._isValid(cached)) {
                // Cache hit - track statistics
                this._trackHit(namespace)
                return cached.data
            }
            this.memoryCache.delete(cacheKey)
        }

        // Try localStorage if not memory-only
        if (!memoryOnly) {
            try {
                const stored = localStorage.getItem(cacheKey)
                if (stored) {
                    const cached = JSON.parse(stored)
                    if (this._isValid(cached)) {
                        // Restore to memory cache
                        this.memoryCache.set(cacheKey, cached)
                        // Cache hit - track statistics
                        this._trackHit(namespace)
                        return cached.data
                    }
                    localStorage.removeItem(cacheKey)
                }
            } catch (e) {
                console.warn('Cache read error:', e)
            }
        }

        // Cache miss - track statistics
        this._trackMiss(namespace)
        return null
    }

    /**
     * Set cached data
     * @param {string} namespace - Cache namespace
     * @param {string} key - Cache key
     * @param {*} data - Data to cache
     * @param {Object} options - Options
     */
    set(namespace, key, data, options = {}) {
        // Get namespace-specific configuration
        const tempConfig = getTemperatureConfig(namespace)
        const defaultTTL = getTTL(namespace)

        const {
            ttl = defaultTTL,
            memoryOnly = !tempConfig.persist,
            persist = tempConfig.persist
        } = options

        const cacheKey = this._getCacheKey(namespace, key)

        const cached = {
            version: CACHE_VERSION,
            namespace,
            timestamp: Date.now(),
            ttl,
            data
        }

        // Always set in memory
        this.memoryCache.set(cacheKey, cached)

        // Persist to localStorage if requested and allowed by temperature config
        if (!memoryOnly && persist && tempConfig.memoryCache) {
            try {
                localStorage.setItem(cacheKey, JSON.stringify(cached))
            } catch (e) {
                console.warn('Cache write error (quota exceeded?):', e)
                // If quota exceeded, try to clear old entries
                this._clearOldEntries()
            }
        }
    }

    /**
     * Invalidate cache entry
     */
    invalidate(namespace, key) {
        const cacheKey = this._getCacheKey(namespace, key)
        this.memoryCache.delete(cacheKey)
        try {
            localStorage.removeItem(cacheKey)
        } catch (e) {
            console.warn('Cache invalidation error:', e)
        }
    }

    /**
     * Invalidate all entries in namespace
     */
    invalidateNamespace(namespace) {
        const prefix = `${this.storagePrefix}${namespace}_`

        // Clear memory cache
        for (const key of this.memoryCache.keys()) {
            if (key.startsWith(prefix)) {
                this.memoryCache.delete(key)
            }
        }

        // Clear localStorage
        try {
            const keysToRemove = []
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i)
                if (key && key.startsWith(prefix)) {
                    keysToRemove.push(key)
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key))
        } catch (e) {
            console.warn('Namespace invalidation error:', e)
        }
    }

    /**
     * Clear all cache
     */
    clear() {
        this.memoryCache.clear()
        try {
            const keysToRemove = []
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i)
                if (key && key.startsWith(this.storagePrefix)) {
                    keysToRemove.push(key)
                }
            }
            keysToRemove.forEach(key => localStorage.removeItem(key))
        } catch (e) {
            console.warn('Cache clear error:', e)
        }
    }

    /**
     * Check if cached data is valid
     */
    _isValid(cached) {
        if (!cached || cached.version !== CACHE_VERSION) {
            return false
        }
        const age = Date.now() - cached.timestamp
        return age < cached.ttl
    }

    /**
     * Clear old entries when quota exceeded
     */
    _clearOldEntries() {
        try {
            const entries = []
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i)
                if (key && key.startsWith(this.storagePrefix)) {
                    const stored = localStorage.getItem(key)
                    if (stored) {
                        try {
                            const cached = JSON.parse(stored)
                            entries.push({ key, timestamp: cached.timestamp || 0 })
                        } catch (e) {
                            // Invalid entry, remove it
                            localStorage.removeItem(key)
                        }
                    }
                }
            }

            // Sort by timestamp and remove oldest 30%
            entries.sort((a, b) => a.timestamp - b.timestamp)
            const toRemove = Math.ceil(entries.length * 0.3)
            for (let i = 0; i < toRemove; i++) {
                localStorage.removeItem(entries[i].key)
            }
        } catch (e) {
            console.warn('Clear old entries error:', e)
        }
    }

    /**
     * Get cache statistics
     */
    getStats() {
        const memorySize = this.memoryCache.size
        let storageSize = 0
        let storageBytes = 0

        try {
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i)
                if (key && key.startsWith(this.storagePrefix)) {
                    storageSize++
                    const value = localStorage.getItem(key)
                    if (value) {
                        storageBytes += value.length * 2 // Rough estimate (UTF-16)
                    }
                }
            }
        } catch (e) {
            console.warn('Stats error:', e)
        }

        // Calculate hit rate
        const total = this.stats.hits + this.stats.misses
        const hitRate = total > 0 ? this.stats.hits / total : 0

        // Calculate namespace-specific hit rates
        const namespaceStats = {}
        for (const [namespace, stats] of this.stats.byNamespace.entries()) {
            const nsTotal = stats.hits + stats.misses
            namespaceStats[namespace] = {
                hits: stats.hits,
                misses: stats.misses,
                total: nsTotal,
                hitRate: nsTotal > 0 ? stats.hits / nsTotal : 0
            }
        }

        return {
            memoryEntries: memorySize,
            storageEntries: storageSize,
            storageBytes,
            storageMB: (storageBytes / (1024 * 1024)).toFixed(2),
            hits: this.stats.hits,
            misses: this.stats.misses,
            total,
            hitRate,
            hitRatePercent: (hitRate * 100).toFixed(2) + '%',
            byNamespace: namespaceStats
        }
    }
}

// Singleton instance
export const dataCache = new DataCache()

// Export class for testing
export { DataCache }
