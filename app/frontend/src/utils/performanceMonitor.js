/**
 * 性能监控工具
 * 用于追踪查询性能、API调用、缓存命中率等关键指标
 */

const getNumberEnv = (key, fallback) => {
    const raw = import.meta?.env ? import.meta.env[key] : undefined
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0) return n
    return fallback
}

const getBoolEnv = (key, fallback) => {
    const raw = import.meta?.env ? import.meta.env[key] : undefined
    if (raw === undefined || raw === null || raw === '') return fallback
    const v = String(raw).trim().toLowerCase()
    if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true
    if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false
    return fallback
}

const PERFORMANCE_MONITOR_ENABLED = getBoolEnv('VITE_ENABLE_PERFORMANCE_MONITOR', false)

// 性能阈值配置
const THRESHOLDS = {
    // 响应时间阈值（毫秒）
    responseTime: {
        warning: getNumberEnv('VITE_PERF_RESPONSE_WARN_MS', 300),
        critical: getNumberEnv('VITE_PERF_RESPONSE_CRITICAL_MS', 500),
    },

    // 云函数调用量阈值
    cloudCalls: {
        hourly: {
            warning: getNumberEnv('VITE_CLOUD_CALLS_HOURLY_WARN', 450),
            critical: getNumberEnv('VITE_CLOUD_CALLS_HOURLY_CRITICAL', 500),
        },
        daily: {
            warning: getNumberEnv('VITE_CLOUD_CALLS_DAILY_WARN', 9000),
            critical: getNumberEnv('VITE_CLOUD_CALLS_DAILY_CRITICAL', 10000),
        },
    },

    // 缓存命中率阈值
    cacheHitRate: {
        warning: 0.6,   // 60%
        critical: 0.4,  // 40%
    },

    // 错误率阈值
    errorRate: {
        warning: 0.01,  // 1%
        critical: 0.05, // 5%
    },
}

const ALERT_DEDUP_MS = getNumberEnv('VITE_PERF_ALERT_DEDUP_MS', 15000)

class PerformanceMonitor {
    constructor() {
        this.metrics = {
            queries: [],
            apiCalls: [],
            cacheHits: 0,
            cacheMisses: 0,
            errors: 0,
            totalRequests: 0,
        }

        this.cloudCallCount = {
            hourly: 0,
            daily: 0,
            lastHourReset: Date.now(),
            lastDayReset: Date.now(),
        }

        this.alertHistory = new Map()

        this.listeners = []

        // 定时重置计数器
        this._startResetTimers()
    }

    /**
     * 追踪数据库查询性能
     */
    trackQuery(queryName, duration, params = {}) {
        const metric = {
            type: 'query',
            name: queryName,
            duration,
            params,
            timestamp: Date.now(),
        }

        this.metrics.queries.push(metric)

        // 保持最近1000条记录
        if (this.metrics.queries.length > 1000) {
            this.metrics.queries.shift()
        }

        // 检查阈值
        if (duration > THRESHOLDS.responseTime.critical) {
            this._alert('critical', `查询 ${queryName} 响应时间过长: ${duration}ms`)
        } else if (duration > THRESHOLDS.responseTime.warning) {
            this._alert('warning', `查询 ${queryName} 响应时间较慢: ${duration}ms`)
        }

        return metric
    }

    /**
     * 追踪API调用性能
     */
    trackAPICall(endpoint, duration, options = {}) {
        const { cacheHit = false, error = false, skipAlert = false, params = {} } = options

        const metric = {
            type: 'api',
            endpoint,
            duration,
            cacheHit,
            error,
            params,
            timestamp: Date.now(),
        }

        this.metrics.apiCalls.push(metric)
        this.metrics.totalRequests++

        if (cacheHit) {
            this.metrics.cacheHits++
        } else {
            this.metrics.cacheMisses++
        }

        if (error) {
            this.metrics.errors++
        }

        // 保持最近1000条记录
        if (this.metrics.apiCalls.length > 1000) {
            this.metrics.apiCalls.shift()
        }

        // 检查响应时间
        if (!skipAlert) {
            if (!cacheHit && duration > THRESHOLDS.responseTime.critical) {
                this._alert('critical', `API ${endpoint} 响应时间过长: ${duration}ms`)
            } else if (!cacheHit && duration > THRESHOLDS.responseTime.warning) {
                this._alert('warning', `API ${endpoint} 响应时间较慢: ${duration}ms`)
            }
        }

        // 检查错误率
        const errorRate = this.getErrorRate()
        if (errorRate > THRESHOLDS.errorRate.critical) {
            this._alert('critical', `错误率过高: ${(errorRate * 100).toFixed(2)}%`)
        } else if (errorRate > THRESHOLDS.errorRate.warning) {
            this._alert('warning', `错误率较高: ${(errorRate * 100).toFixed(2)}%`)
        }

        return metric
    }

    /**
     * 追踪云函数调用
     */
    trackCloudCall(functionName, params = {}) {
        this.cloudCallCount.hourly++
        this.cloudCallCount.daily++

        // 检查调用量阈值
        if (this.cloudCallCount.hourly > THRESHOLDS.cloudCalls.hourly.critical) {
            this._alert('critical', `每小时云函数调用量超过临界值: ${this.cloudCallCount.hourly}`)
        } else if (this.cloudCallCount.hourly > THRESHOLDS.cloudCalls.hourly.warning) {
            this._alert('warning', `每小时云函数调用量接近上限: ${this.cloudCallCount.hourly}`)
        }

        if (this.cloudCallCount.daily > THRESHOLDS.cloudCalls.daily.critical) {
            this._alert('critical', `每日云函数调用量超过临界值: ${this.cloudCallCount.daily}`)
        } else if (this.cloudCallCount.daily > THRESHOLDS.cloudCalls.daily.warning) {
            this._alert('warning', `每日云函数调用量接近上限: ${this.cloudCallCount.daily}`)
        }
    }

    /**
     * 获取缓存命中率
     */
    getCacheHitRate() {
        const total = this.metrics.cacheHits + this.metrics.cacheMisses
        if (total === 0) return 0
        return this.metrics.cacheHits / total
    }

    /**
     * 获取错误率
     */
    getErrorRate() {
        if (this.metrics.totalRequests === 0) return 0
        return this.metrics.errors / this.metrics.totalRequests
    }

    /**
     * 获取平均响应时间
     */
    getAverageResponseTime(type = 'all', minutes = 5) {
        const now = Date.now()
        const cutoff = now - minutes * 60 * 1000

        let metrics = []
        if (type === 'query') {
            metrics = this.metrics.queries.filter(m => m.timestamp > cutoff)
        } else if (type === 'api') {
            metrics = this.metrics.apiCalls.filter(m => m.timestamp > cutoff && !m.cacheHit)
        } else {
            metrics = [
                ...this.metrics.queries.filter(m => m.timestamp > cutoff),
                ...this.metrics.apiCalls.filter(m => m.timestamp > cutoff && !m.cacheHit),
            ]
        }

        if (metrics.length === 0) return 0

        const sum = metrics.reduce((acc, m) => acc + m.duration, 0)
        return sum / metrics.length
    }

    /**
     * 获取慢查询列表
     */
    getSlowQueries(threshold = 500, limit = 10) {
        const slowQueries = this.metrics.queries
            .filter(q => q.duration > threshold)
            .sort((a, b) => b.duration - a.duration)
            .slice(0, limit)

        return slowQueries
    }

    /**
     * 获取统计信息
     */
    getStats() {
        const cacheHitRate = this.getCacheHitRate()
        const errorRate = this.getErrorRate()
        const avgResponseTime = this.getAverageResponseTime()

        // 检查缓存命中率
        if (cacheHitRate < THRESHOLDS.cacheHitRate.critical) {
            this._alert('critical', `缓存命中率过低: ${(cacheHitRate * 100).toFixed(2)}%`)
        } else if (cacheHitRate < THRESHOLDS.cacheHitRate.warning) {
            this._alert('warning', `缓存命中率较低: ${(cacheHitRate * 100).toFixed(2)}%`)
        }

        return {
            cacheHitRate,
            errorRate,
            avgResponseTime,
            totalRequests: this.metrics.totalRequests,
            cacheHits: this.metrics.cacheHits,
            cacheMisses: this.metrics.cacheMisses,
            errors: this.metrics.errors,
            cloudCalls: {
                hourly: this.cloudCallCount.hourly,
                daily: this.cloudCallCount.daily,
            },
            slowQueries: this.getSlowQueries(),
        }
    }

    getAPICallSummary(options = {}) {
        const now = Date.now()
        const minutes = Number(options.minutes ?? 60)
        const cutoff = now - (Number.isFinite(minutes) ? minutes : 60) * 60 * 1000
        const slowThreshold = Number(options.slowThreshold ?? 1000)
        const rows = this.metrics.apiCalls.filter((m) => m && m.timestamp > cutoff && !m.cacheHit)

        const byEndpoint = new Map()
        for (const m of rows) {
            const key = String(m.endpoint || '')
            const group = byEndpoint.get(key) || { endpoint: key, count: 0, sum: 0, max: 0, samples: [], slow: [] }
            group.count += 1
            group.sum += Number(m.duration || 0)
            group.max = Math.max(group.max, Number(m.duration || 0))
            group.samples.push(Number(m.duration || 0))
            if (Number(m.duration || 0) > slowThreshold) {
                group.slow.push({ timestamp: m.timestamp, duration: m.duration, params: m.params || {} })
            }
            byEndpoint.set(key, group)
        }

        const percentile = (arr, p) => {
            if (!arr.length) return 0
            const sorted = arr.slice().sort((a, b) => a - b)
            const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))
            return sorted[idx]
        }

        const endpoints = Array.from(byEndpoint.values()).map((g) => {
            const avg = g.count ? g.sum / g.count : 0
            const p95 = percentile(g.samples, 0.95)
            return {
                endpoint: g.endpoint,
                count: g.count,
                avg: Math.round(avg),
                max: Math.round(g.max),
                p95: Math.round(p95),
                slow: g.slow.sort((a, b) => (b.duration || 0) - (a.duration || 0))
            }
        }).sort((a, b) => (b.max || 0) - (a.max || 0))

        return {
            windowMinutes: Number.isFinite(minutes) ? minutes : 60,
            slowThreshold,
            total: rows.length,
            endpoints
        }
    }

    /**
     * 重置统计数据
     */
    reset() {
        this.metrics = {
            queries: [],
            apiCalls: [],
            cacheHits: 0,
            cacheMisses: 0,
            errors: 0,
            totalRequests: 0,
        }
    }

    /**
     * 添加监听器
     */
    addListener(callback) {
        this.listeners.push(callback)
        return () => {
            this.listeners = this.listeners.filter(cb => cb !== callback)
        }
    }

    /**
     * 发送告警
     */
    _alert(level, message) {
        const now = Date.now()
        const key = `${level}:${message}`
        const lastAt = this.alertHistory.get(key) || 0
        if (now - lastAt < ALERT_DEDUP_MS) return
        this.alertHistory.set(key, now)

        const alert = {
            level,
            message,
            timestamp: now,
        }

        console[level === 'critical' ? 'error' : 'warn'](`[性能告警] ${message}`)

        // 通知监听器
        this.listeners.forEach(callback => {
            try {
                callback(alert)
            } catch (e) {
                console.error('监听器执行失败:', e)
            }
        })
    }

    /**
     * 启动定时重置计数器
     */
    _startResetTimers() {
        // 每小时重置小时计数器
        setInterval(() => {
            this.cloudCallCount.hourly = 0
            this.cloudCallCount.lastHourReset = Date.now()
        }, 60 * 60 * 1000)

        // 每天重置日计数器
        setInterval(() => {
            this.cloudCallCount.daily = 0
            this.cloudCallCount.lastDayReset = Date.now()
        }, 24 * 60 * 60 * 1000)
    }
}

// 单例实例
const createNoopMonitor = () => {
    const getStats = () => ({
        cacheHitRate: 1,
        errorRate: 0,
        avgResponseTime: 0,
        totalRequests: 0,
        cacheHits: 0,
        cacheMisses: 0,
        errors: 0,
        cloudCalls: { hourly: 0, daily: 0 },
        slowQueries: []
    })
    const getAPICallSummary = (options = {}) => {
        const minutes = Number(options.minutes ?? 60)
        const slowThreshold = Number(options.slowThreshold ?? 1000)
        return {
            windowMinutes: Number.isFinite(minutes) ? minutes : 60,
            slowThreshold: Number.isFinite(slowThreshold) ? slowThreshold : 1000,
            total: 0,
            endpoints: []
        }
    }
    return {
        trackQuery: () => null,
        trackAPICall: () => null,
        trackCloudCall: () => null,
        getStats,
        getAPICallSummary,
        reset: () => { },
        addListener: () => () => { }
    }
}

export const performanceMonitor = PERFORMANCE_MONITOR_ENABLED ? new PerformanceMonitor() : createNoopMonitor()

// 导出类供测试使用
export { PerformanceMonitor, THRESHOLDS }

// 便捷函数
export function trackQuery(queryName, duration, params) {
    return performanceMonitor.trackQuery(queryName, duration, params)
}

export function trackAPICall(endpoint, duration, options) {
    return performanceMonitor.trackAPICall(endpoint, duration, options)
}

export function trackCloudCall(functionName, params) {
    return performanceMonitor.trackCloudCall(functionName, params)
}

export function getPerformanceStats() {
    return performanceMonitor.getStats()
}

export function getAPICallSummary(options) {
    return performanceMonitor.getAPICallSummary(options)
}
