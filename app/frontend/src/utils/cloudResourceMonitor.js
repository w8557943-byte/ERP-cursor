/**
 * 云资源使用监控
 * 追踪云函数调用量、统计使用模式、提供告警
 */

const getNumberEnv = (key, fallback) => {
    const raw = import.meta?.env ? import.meta.env[key] : undefined
    const n = Number(raw)
    if (Number.isFinite(n) && n >= 0) return n
    return fallback
}

// 告警阈值配置
const ALERT_THRESHOLDS = {
    hourly: {
        warning: getNumberEnv('VITE_CLOUD_CALLS_HOURLY_WARN', 450),
        critical: getNumberEnv('VITE_CLOUD_CALLS_HOURLY_CRITICAL', 500),
    },
    daily: {
        warning: getNumberEnv('VITE_CLOUD_CALLS_DAILY_WARN', 9000),
        critical: getNumberEnv('VITE_CLOUD_CALLS_DAILY_CRITICAL', 10000),
    },
}

class CloudResourceMonitor {
    constructor() {
        this.callHistory = []
        this.dailyCallCount = 0
        this.hourlyCallCount = 0
        this.lastHourReset = Date.now()
        this.lastDayReset = Date.now()
        this.functionStats = new Map()
        this.listeners = []

        // 启动定时重置
        this._startResetTimers()

        // 从localStorage恢复数据
        this._loadFromStorage()
    }

    /**
     * 追踪云函数调用
     */
    trackCall(functionName, params = {}, metadata = {}) {
        const call = {
            function: functionName,
            params,
            metadata,
            timestamp: Date.now(),
        }

        // 更新计数
        this.dailyCallCount++
        this.hourlyCallCount++

        // 记录历史（保留最近10000条）
        this.callHistory.push(call)
        if (this.callHistory.length > 10000) {
            this.callHistory.shift()
        }

        // 更新函数统计
        if (!this.functionStats.has(functionName)) {
            this.functionStats.set(functionName, {
                count: 0,
                lastCall: null,
                avgDuration: 0,
                totalDuration: 0,
            })
        }

        const stats = this.functionStats.get(functionName)
        stats.count++
        stats.lastCall = Date.now()

        if (metadata.duration) {
            stats.totalDuration += metadata.duration
            stats.avgDuration = stats.totalDuration / stats.count
        }

        // 检查阈值并发送告警
        this._checkThresholds()

        // 持久化到localStorage
        this._saveToStorage()

        return call
    }

    /**
     * 获取统计信息
     */
    getStats() {
        return {
            daily: this.dailyCallCount,
            hourly: this.hourlyCallCount,
            total: this.callHistory.length,
            topFunctions: this.getTopCalledFunctions(10),
            recentCalls: this.getRecentCalls(20),
            callsByHour: this.getCallsByHour(),
        }
    }

    /**
     * 获取调用最多的函数
     */
    getTopCalledFunctions(limit = 10) {
        const functions = Array.from(this.functionStats.entries())
            .map(([name, stats]) => ({
                name,
                count: stats.count,
                avgDuration: stats.avgDuration,
                lastCall: stats.lastCall,
            }))
            .sort((a, b) => b.count - a.count)
            .slice(0, limit)

        return functions
    }

    /**
     * 获取最近的调用记录
     */
    getRecentCalls(limit = 20) {
        return this.callHistory.slice(-limit).reverse()
    }

    /**
     * 获取按小时分组的调用统计
     */
    getCallsByHour() {
        const now = Date.now()
        const hourMs = 60 * 60 * 1000
        const hours = []

        // 统计最近24小时
        for (let i = 0; i < 24; i++) {
            const hourStart = now - (i + 1) * hourMs
            const hourEnd = now - i * hourMs

            const count = this.callHistory.filter(
                call => call.timestamp >= hourStart && call.timestamp < hourEnd
            ).length

            hours.unshift({
                hour: new Date(hourStart).getHours(),
                count,
                timestamp: hourStart,
            })
        }

        return hours
    }

    /**
     * 获取函数调用详情
     */
    getFunctionDetails(functionName) {
        const stats = this.functionStats.get(functionName)
        if (!stats) return null

        const calls = this.callHistory.filter(call => call.function === functionName)

        return {
            name: functionName,
            totalCalls: stats.count,
            avgDuration: stats.avgDuration,
            lastCall: stats.lastCall,
            recentCalls: calls.slice(-50).reverse(),
        }
    }

    /**
     * 重置统计数据
     */
    reset() {
        this.callHistory = []
        this.dailyCallCount = 0
        this.hourlyCallCount = 0
        this.functionStats.clear()
        this._saveToStorage()
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
     * 检查阈值并发送告警
     */
    _checkThresholds() {
        // 检查小时调用量
        if (this.hourlyCallCount >= ALERT_THRESHOLDS.hourly.critical) {
            this._sendAlert('critical', `每小时云函数调用量已达临界值: ${this.hourlyCallCount}/${ALERT_THRESHOLDS.hourly.critical}`)
        } else if (this.hourlyCallCount >= ALERT_THRESHOLDS.hourly.warning) {
            this._sendAlert('warning', `每小时云函数调用量接近上限: ${this.hourlyCallCount}/${ALERT_THRESHOLDS.hourly.warning}`)
        }

        // 检查日调用量
        if (this.dailyCallCount >= ALERT_THRESHOLDS.daily.critical) {
            this._sendAlert('critical', `每日云函数调用量已达临界值: ${this.dailyCallCount}/${ALERT_THRESHOLDS.daily.critical}`)
        } else if (this.dailyCallCount >= ALERT_THRESHOLDS.daily.warning) {
            this._sendAlert('warning', `每日云函数调用量接近上限: ${this.dailyCallCount}/${ALERT_THRESHOLDS.daily.warning}`)
        }
    }

    /**
     * 发送告警
     */
    _sendAlert(level, message) {
        const alert = {
            level,
            message,
            timestamp: Date.now(),
            stats: {
                hourly: this.hourlyCallCount,
                daily: this.dailyCallCount,
            },
        }

        console[level === 'critical' ? 'error' : 'warn'](`[云资源告警] ${message}`)

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
            this.hourlyCallCount = 0
            this.lastHourReset = Date.now()
            this._saveToStorage()
        }, 60 * 60 * 1000)

        // 每天重置日计数器
        setInterval(() => {
            this.dailyCallCount = 0
            this.lastDayReset = Date.now()
            this._saveToStorage()
        }, 24 * 60 * 60 * 1000)
    }

    /**
     * 保存到localStorage
     */
    _saveToStorage() {
        try {
            const data = {
                dailyCallCount: this.dailyCallCount,
                hourlyCallCount: this.hourlyCallCount,
                lastHourReset: this.lastHourReset,
                lastDayReset: this.lastDayReset,
                // 只保存最近1000条历史记录
                callHistory: this.callHistory.slice(-1000),
                functionStats: Array.from(this.functionStats.entries()),
            }

            localStorage.setItem('erp_cloud_resource_monitor', JSON.stringify(data))
        } catch (e) {
            console.warn('保存云资源监控数据失败:', e)
        }
    }

    /**
     * 从localStorage加载
     */
    _loadFromStorage() {
        try {
            const stored = localStorage.getItem('erp_cloud_resource_monitor')
            if (!stored) return

            const data = JSON.parse(stored)
            const now = Date.now()

            // 检查是否需要重置
            const hoursSinceHourReset = (now - data.lastHourReset) / (60 * 60 * 1000)
            const daysSinceDayReset = (now - data.lastDayReset) / (24 * 60 * 60 * 1000)

            this.hourlyCallCount = hoursSinceHourReset < 1 ? data.hourlyCallCount : 0
            this.dailyCallCount = daysSinceDayReset < 1 ? data.dailyCallCount : 0
            this.lastHourReset = data.lastHourReset
            this.lastDayReset = data.lastDayReset
            this.callHistory = data.callHistory || []

            if (Array.isArray(data.functionStats)) {
                this.functionStats = new Map(data.functionStats)
            }
        } catch (e) {
            console.warn('加载云资源监控数据失败:', e)
        }
    }
}

// 单例实例
export const cloudResourceMonitor = new CloudResourceMonitor()

// 导出类供测试使用
export { CloudResourceMonitor, ALERT_THRESHOLDS }

// 便捷函数
export function trackCloudCall(functionName, params, metadata) {
    return cloudResourceMonitor.trackCall(functionName, params, metadata)
}

export function getCloudResourceStats() {
    return cloudResourceMonitor.getStats()
}

export function getTopCloudFunctions(limit) {
    return cloudResourceMonitor.getTopCalledFunctions(limit)
}
