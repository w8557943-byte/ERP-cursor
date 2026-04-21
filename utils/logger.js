/**
 * 统一日志工具
 * 提供分级日志功能，生产环境自动禁用调试日志
 */

const LOG_LEVELS = {
    DEBUG: 0,
    INFO: 1,
    WARN: 2,
    ERROR: 3,
    NONE: 4
};

class Logger {
    constructor() {
        this.currentLevel = this.getLogLevel();
        this.isDev = this.isDevEnvironment();
    }

    /**
     * 判断是否为开发环境
     */
    isDevEnvironment() {
        try {
            const systemInfo = wx.getSystemInfoSync();
            return systemInfo.platform === 'devtools';
        } catch (e) {
            return false;
        }
    }

    /**
     * 获取当前日志级别
     */
    getLogLevel() {
        try {
            // 生产环境只记录 WARN 和 ERROR
            if (!this.isDevEnvironment()) {
                return LOG_LEVELS.WARN;
            }

            // 开发环境可以通过 storage 配置日志级别
            const level = wx.getStorageSync('log_level');
            return LOG_LEVELS[level] !== undefined ? LOG_LEVELS[level] : LOG_LEVELS.DEBUG;
        } catch (e) {
            return LOG_LEVELS.INFO;
        }
    }

    /**
     * 格式化日志消息
     */
    formatMessage(level, tag, message, data) {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${level}] [${tag}]`;

        if (data !== undefined) {
            return `${prefix} ${message}`;
        }
        return `${prefix} ${message}`;
    }

    /**
     * 脱敏处理
     */
    sanitize(data) {
        if (!data || typeof data !== 'object') {
            return data;
        }

        const sensitiveKeys = ['password', 'token', 'secret', 'sessionId', 'openid'];
        const sanitized = Array.isArray(data) ? [...data] : { ...data };

        for (const key in sanitized) {
            if (sensitiveKeys.some(k => key.toLowerCase().includes(k))) {
                sanitized[key] = '***';
            } else if (typeof sanitized[key] === 'object') {
                sanitized[key] = this.sanitize(sanitized[key]);
            }
        }

        return sanitized;
    }

    /**
     * DEBUG 级别日志
     */
    debug(tag, message, data) {
        if (this.currentLevel <= LOG_LEVELS.DEBUG) {
            console.log(this.formatMessage('DEBUG', tag, message), data !== undefined ? this.sanitize(data) : '');
        }
    }

    /**
     * INFO 级别日志
     */
    info(tag, message, data) {
        if (this.currentLevel <= LOG_LEVELS.INFO) {
            console.log(this.formatMessage('INFO', tag, message), data !== undefined ? this.sanitize(data) : '');
        }
    }

    /**
     * WARN 级别日志
     */
    warn(tag, message, data) {
        if (this.currentLevel <= LOG_LEVELS.WARN) {
            console.warn(this.formatMessage('WARN', tag, message), data !== undefined ? this.sanitize(data) : '');
        }
    }

    /**
     * ERROR 级别日志
     */
    error(tag, message, error) {
        if (this.currentLevel <= LOG_LEVELS.ERROR) {
            const errorData = error instanceof Error ? {
                message: error.message,
                stack: this.isDev ? error.stack : undefined
            } : error;

            console.error(this.formatMessage('ERROR', tag, message), errorData);

            // 生产环境可以在这里上报错误到监控平台
            if (!this.isDev) {
                this.reportError(tag, message, errorData);
            }
        }
    }

    /**
     * 上报错误（预留接口）
     */
    reportError(tag, message, error) {
        // TODO: 集成错误监控平台（如腾讯云监控、Sentry等）
        try {
            // wx.cloud.callFunction({
            //   name: 'error-reporter',
            //   data: { tag, message, error, timestamp: new Date().toISOString() }
            // });
        } catch (e) {
            // 静默失败，避免影响主流程
        }
    }

    /**
     * 设置日志级别
     */
    setLevel(level) {
        if (LOG_LEVELS[level] !== undefined) {
            this.currentLevel = LOG_LEVELS[level];
            try {
                wx.setStorageSync('log_level', level);
            } catch (e) {
                // 忽略存储失败
            }
        }
    }
}

// 导出单例
const logger = new Logger();

module.exports = {
    logger,
    LOG_LEVELS
};
