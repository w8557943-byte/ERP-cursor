/**
 * 请求限流器
 * 使用滑动窗口算法控制请求频率
 */

class RateLimiter {
    constructor(maxRequests, timeWindow) {
        this.maxRequests = maxRequests
        this.timeWindow = timeWindow
        this.requests = []
        this.queue = []
        this.processing = false
    }

    /**
     * 限流执行函数
     * @param {Function} fn - 要执行的函数
     * @returns {Promise} 函数执行结果
     */
    async throttle(fn) {
        return new Promise((resolve, reject) => {
            this.queue.push({ fn, resolve, reject })
            this._processQueue()
        })
    }

    /**
     * 处理队列
     */
    async _processQueue() {
        if (this.processing || this.queue.length === 0) {
            return
        }

        this.processing = true

        while (this.queue.length > 0) {
            // 清理过期的请求记录
            const now = Date.now()
            this.requests = this.requests.filter(t => now - t < this.timeWindow)

            // 检查是否超过限制
            if (this.requests.length >= this.maxRequests) {
                // 计算需要等待的时间
                const oldestRequest = this.requests[0]
                const waitTime = this.timeWindow - (now - oldestRequest)

                if (waitTime > 0) {
                    await new Promise(resolve => setTimeout(resolve, waitTime))
                    continue
                }
            }

            // 执行下一个请求
            const { fn, resolve, reject } = this.queue.shift()
            this.requests.push(Date.now())

            try {
                const result = await fn()
                resolve(result)
            } catch (error) {
                reject(error)
            }
        }

        this.processing = false
    }

    /**
     * 获取当前状态
     */
    getStatus() {
        const now = Date.now()
        const activeRequests = this.requests.filter(t => now - t < this.timeWindow).length

        return {
            activeRequests,
            maxRequests: this.maxRequests,
            queueLength: this.queue.length,
            utilizationRate: activeRequests / this.maxRequests,
        }
    }

    /**
     * 重置限流器
     */
    reset() {
        this.requests = []
        this.queue = []
        this.processing = false
    }
}

// 预定义的限流器实例

// 云函数调用限流器 - 每分钟最多100次
export const cloudFunctionLimiter = new RateLimiter(100, 60 * 1000)

// API调用限流器 - 每秒最多10次
export const apiLimiter = new RateLimiter(10, 1000)

// 数据库查询限流器 - 每秒最多20次
export const queryLimiter = new RateLimiter(20, 1000)

// 导出类供自定义使用
export { RateLimiter }

// 便捷函数
export async function throttleCloudFunction(fn) {
    return cloudFunctionLimiter.throttle(fn)
}

export async function throttleAPI(fn) {
    return apiLimiter.throttle(fn)
}

export async function throttleQuery(fn) {
    return queryLimiter.throttle(fn)
}

// 获取所有限流器状态
export function getAllLimiterStatus() {
    return {
        cloudFunction: cloudFunctionLimiter.getStatus(),
        api: apiLimiter.getStatus(),
        query: queryLimiter.getStatus(),
    }
}
