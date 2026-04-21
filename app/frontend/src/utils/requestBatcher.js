/**
 * 请求批处理器
 * 在时间窗口内合并相同的请求，减少重复调用
 */

class RequestBatcher {
    constructor(batchWindow = 50) {
        this.batchWindow = batchWindow // 批处理时间窗口（毫秒）
        this.pending = new Map() // 待处理的请求
        this.timers = new Map() // 定时器
    }

    /**
     * 批处理请求
     * @param {string} key - 请求唯一标识
     * @param {Function} fetchFn - 获取数据的函数
     * @returns {Promise} 数据结果
     */
    async batch(key, fetchFn) {
        // 检查是否已有相同请求在等待
        if (this.pending.has(key)) {
            const existing = this.pending.get(key)
            return new Promise((resolve, reject) => {
                existing.callbacks.push({ resolve, reject })
            })
        }

        // 创建新的批处理请求
        const batchRequest = {
            key,
            fetchFn,
            callbacks: [],
            timestamp: Date.now(),
        }

        this.pending.set(key, batchRequest)

        // 设置定时器，在时间窗口结束时执行请求
        const timer = setTimeout(() => {
            this._executeBatch(key)
        }, this.batchWindow)

        this.timers.set(key, timer)

        // 返回Promise
        return new Promise((resolve, reject) => {
            batchRequest.callbacks.push({ resolve, reject })
        })
    }

    /**
     * 执行批处理请求
     */
    async _executeBatch(key) {
        const batchRequest = this.pending.get(key)
        if (!batchRequest) return

        // 清理
        this.pending.delete(key)
        this.timers.delete(key)

        try {
            // 执行请求
            const result = await batchRequest.fetchFn()

            // 通知所有等待的回调
            batchRequest.callbacks.forEach(({ resolve }) => {
                resolve(result)
            })
        } catch (error) {
            // 通知所有等待的回调
            batchRequest.callbacks.forEach(({ reject }) => {
                reject(error)
            })
        }
    }

    /**
     * 立即执行指定的批处理请求
     */
    async flush(key) {
        const timer = this.timers.get(key)
        if (timer) {
            clearTimeout(timer)
            await this._executeBatch(key)
        }
    }

    /**
     * 立即执行所有批处理请求
     */
    async flushAll() {
        const keys = Array.from(this.pending.keys())
        await Promise.all(keys.map(key => this.flush(key)))
    }

    /**
     * 取消指定的批处理请求
     */
    cancel(key) {
        const timer = this.timers.get(key)
        if (timer) {
            clearTimeout(timer)
        }

        const batchRequest = this.pending.get(key)
        if (batchRequest) {
            // 通知所有等待的回调请求已取消
            const error = new Error('Request cancelled')
            batchRequest.callbacks.forEach(({ reject }) => {
                reject(error)
            })
        }

        this.pending.delete(key)
        this.timers.delete(key)
    }

    /**
     * 取消所有批处理请求
     */
    cancelAll() {
        const keys = Array.from(this.pending.keys())
        keys.forEach(key => this.cancel(key))
    }

    /**
     * 获取当前状态
     */
    getStatus() {
        return {
            pendingCount: this.pending.size,
            pendingKeys: Array.from(this.pending.keys()),
            oldestRequest: this._getOldestRequest(),
        }
    }

    /**
     * 获取最早的请求
     */
    _getOldestRequest() {
        let oldest = null
        let oldestTime = Infinity

        for (const [key, request] of this.pending.entries()) {
            if (request.timestamp < oldestTime) {
                oldestTime = request.timestamp
                oldest = { key, age: Date.now() - request.timestamp }
            }
        }

        return oldest
    }
}

// 默认批处理器实例
export const defaultBatcher = new RequestBatcher(50)
const batcherPool = new Map([[50, defaultBatcher]])

// 导出类供自定义使用
export { RequestBatcher }

export function getBatcher(batchWindow = 50) {
    const w = Number(batchWindow)
    const windowMs = Number.isFinite(w) && w > 0 ? w : 50
    if (batcherPool.has(windowMs)) return batcherPool.get(windowMs)
    const created = new RequestBatcher(windowMs)
    batcherPool.set(windowMs, created)
    return created
}

// 便捷函数
export async function batchRequest(key, fetchFn) {
    return defaultBatcher.batch(key, fetchFn)
}

export function getBatcherStatus() {
    return defaultBatcher.getStatus()
}
