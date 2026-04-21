import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const logFile = path.join(__dirname, '../../error.log')

// 异步错误处理包装器
export const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next)
}

// 全局错误处理中间件
export const errorHandler = (err, req, res, next) => {
  const errorDetails = {
    message: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  }
  
  console.error('错误详情:', errorDetails)

  try {
    fs.appendFileSync(logFile, JSON.stringify(errorDetails, null, 2) + '\n---\n')
  } catch (e) {
    console.error('Failed to write to error log:', e)
  }

  // 处理已知错误类型
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      message: '数据验证失败',
      errors: err.details?.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }))
    })
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      success: false,
      message: '认证失败'
    })
  }

  if (err.name === 'ForbiddenError') {
    return res.status(403).json({
      success: false,
      message: '权限不足'
    })
  }

  if (err.name === 'NotFoundError') {
    return res.status(404).json({
      success: false,
      message: '资源不存在'
    })
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      message: '文件大小超出限制'
    })
  }

  // 数据库错误
  if (err.name === 'MongoError' || err.name === 'MongooseError') {
    return res.status(500).json({
      success: false,
      message: '数据库操作失败',
      ...(process.env.NODE_ENV === 'development' && { detail: err.message })
    })
  }

  // 默认服务器错误
  const statusCode = err.statusCode || err.status || 500
  
  res.status(statusCode).json({
    success: false,
    message: process.env.NODE_ENV === 'production' 
      ? '服务器内部错误' 
      : err.message,
    ...(process.env.NODE_ENV === 'development' && {
      stack: err.stack,
      error: err
    })
  })
}

// 自定义错误类
export class AppError extends Error {
  constructor(message, statusCode = 500) {
    super(message)
    this.statusCode = statusCode
    this.isOperational = true
    Error.captureStackTrace(this, this.constructor)
  }
}

export class ValidationError extends AppError {
  constructor(message = '数据验证失败', details = []) {
    super(message, 400)
    this.name = 'ValidationError'
    this.details = details
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = '认证失败') {
    super(message, 401)
    this.name = 'UnauthorizedError'
  }
}

export class ForbiddenError extends AppError {
  constructor(message = '权限不足') {
    super(message, 403)
    this.name = 'ForbiddenError'
  }
}

export class NotFoundError extends AppError {
  constructor(message = '资源不存在') {
    super(message, 404)
    this.name = 'NotFoundError'
  }
}