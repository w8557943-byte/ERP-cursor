import winston from 'winston'
import fs from 'fs'
import path from 'path'

const nodeEnv = process.env.NODE_ENV || 'development'
const isTest = nodeEnv === 'test'
const logDir = String(process.env.LOG_DIR || 'logs').trim() || 'logs'
if (!isTest) {
  try { fs.mkdirSync(logDir, { recursive: true }) } catch (_) { void 0 }
}

// 创建logger实例
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: { service: 'ronghe-erp-api' },
  silent: isTest,
  transports: isTest ? [] : [
    new winston.transports.File({ 
      filename: path.join(logDir, 'error.log'), 
      level: 'error',
      maxsize: 5242880,
      maxFiles: 5
    }),
    new winston.transports.File({ 
      filename: path.join(logDir, 'combined.log'),
      maxsize: 5242880,
      maxFiles: 5
    })
  ]
})

// 开发环境时添加控制台输出
if (!isTest && nodeEnv !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }))
}

// 请求日志中间件
export const loggerMiddleware = (req, res, next) => {
  const start = Date.now()
  
  res.on('finish', () => {
    const duration = Date.now() - start
    
    const logData = {
      method: req.method,
      url: req.url,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id || 'anonymous'
    }

    if (res.statusCode >= 400) {
      logger.error('请求错误', logData)
    } else {
      logger.info('请求完成', logData)
    }
  })

  next()
}

// 业务日志记录器
export const businessLogger = {
  info: (message, meta = {}) => {
    logger.info(message, { ...meta, type: 'business' })
  },
  
  warn: (message, meta = {}) => {
    logger.warn(message, { ...meta, type: 'business' })
  },
  
  error: (message, meta = {}) => {
    logger.error(message, { ...meta, type: 'business' })
  },
  
  audit: (action, resource, userId, details = {}) => {
    logger.info('审计日志', {
      type: 'audit',
      action,
      resource,
      userId,
      timestamp: new Date().toISOString(),
      ...details
    })
  }
}

export { logger }
export default loggerMiddleware
