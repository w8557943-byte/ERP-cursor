import 'dotenv/config'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// 强制加载 .env 文件，如果 dotenv/config 失败
// 或者 process.env.PORT 还是默认值 3003 (假设.env里配置了其他值)
// 这里我们简单粗暴地尝试加载
try {
  const envPath = path.resolve(__dirname, '../.env')
  if (fs.existsSync(envPath)) {
    console.log('Trying to load .env from:', envPath)
    const envConfig = fs.readFileSync(envPath, 'utf8')
    const lines = envConfig.split(/\r?\n/)
    lines.forEach(line => {
      if (!line || line.trim().startsWith('#')) return
      const parts = line.split('=')
      if (parts.length >= 2) {
        const key = parts[0].trim()
        const value = parts.slice(1).join('=').trim()
        
        // 简单处理：如果当前环境变量没设置，就用 .env 的
        // 或者强制覆盖 PORT 和 SQLITE_DB_PATH
        if (key && value) {
             if (!process.env[key] || key === 'PORT' || key === 'SQLITE_DB_PATH') {
                 process.env[key] = value
             }
        }
      }
    })
  }
} catch (e) {
  console.error('Error loading .env manually:', e)
}

import express from 'express'
import cors from 'cors'
// import helmet from 'helmet'  // 临时禁用以修复前端空白页面问题
import compression from 'compression'
import morgan from 'morgan'

// 导入路由
import authRoutes from './routes/auth.js'
import userRoutes from './routes/users.js'
import orderRoutes from './routes/orders.js'
import orderNumberRoutes from './routes/orderNumberRoutes.js'
import shippingNumberRoutes from './routes/shippingNumberRoutes.js'
import dataManagementRoutes from './routes/dataManagement.js'
import statementRoutes from './routes/statements.js'

import customerRoutes from './routes/customers.js'
import supplierRoutes from './routes/suppliers.js'
import supplierMaterialRoutes from './routes/supplierMaterials.js'
import materialCodeRoutes from './routes/materialCodes.js'
import productRoutes from './routes/products.js'
import productionRoutes from './routes/production.js'
import financeRoutes from './routes/finance.js'
import dashboardRoutes from './routes/dashboard.js'
import fixedCostRoutes from './routes/fixedCosts.js'
import employeeRoutes from './routes/employees.js'
import userConfigRoutes from './routes/userConfig.js'
import payableRoutes from './routes/payables.js'
import customerAliasRoutes from './routes/customerAliases.js'
import syncRoutes from './routes/syncRoutes.js'
import systemRoutes from './routes/system.js'
import cloudSyncRoutes from './routes/cloudSyncRoutes.js'
import manualSyncRoutes from './routes/manualSyncRoutes.js'
import testRoutes from './routes/test.js'

// 导入数据同步管理器
import syncManager from './services/syncManager.js'
// 导入云同步服务
import cloudSyncService from './services/cloudSyncService.js'
import orderNumberService from './services/orderNumberService.js'
import cloudbaseService from './services/cloudbaseService.js'
import realTimeSyncService from './services/realTimeSyncService.js'
import localCloudSyncScheduler from './services/localCloudSyncScheduler.js'

import './models/local/LocalDocument.js'

// 导入数据库连接
import { database } from './utils/database.js'
import { syncDatabase } from './utils/sqliteDatabase.js'

// 导入中间件
import { errorHandler } from './middleware/errorHandler.js'
import loggerMiddleware from './middleware/logger.js'

// 加载环境变量
// dotenv.config() - Loaded at top

const app = express()
const PORT = process.env.PORT || 3003
const CLI_PORT = (() => {
  const argv = Array.isArray(process.argv) ? process.argv : []
  const idx = argv.findIndex((v) => v === '--port' || v === '-p')
  if (idx < 0) return null
  const next = argv[idx + 1]
  const n = Number(next)
  if (!Number.isFinite(n) || n <= 0) return null
  return n
})()

// 安全中间件
// app.use(helmet())  // 临时禁用以修复前端空白页面问题

// CORS配置
const isDesktopApp = String(process.env.DESKTOP_APP || '').toLowerCase() === 'true'
const allowedOrigins = [
  'http://localhost:3001',
  'http://localhost:3002',
  'http://localhost:3003',
  'http://localhost:3004',
  'http://localhost:3005',
  'http://localhost:5173',
  'http://localhost:5174',
  process.env.FRONTEND_URL
].filter(Boolean);

if (isDesktopApp || (process.env.NODE_ENV || 'development') === 'development') {
  app.use(cors({ origin: true, credentials: true }))
} else {
  app.use(cors({
    origin: function (origin, callback) {
      if (!origin) return callback(null, true);
      try {
        const o = String(origin || '').toLowerCase()
        if (o.includes('tcloudbase.com')) return callback(null, true)
      } catch (_) { void 0 }
      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true
  }))
}

// 压缩中间件
app.use(compression())

// 日志中间件
if ((process.env.NODE_ENV || 'development') !== 'test') {
  app.use(morgan('combined'))
  app.use(loggerMiddleware)
}

// 解析请求体
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true }))

// 健康检查路由
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    version: process.env.npm_package_version || '1.0.0'
  })
})

// API路由
app.use('/api/auth', authRoutes)
app.use('/api/users', userRoutes)
app.use('/api/orders', orderRoutes)
app.use('/api/order-numbers', orderNumberRoutes)
app.use('/api/shipping-numbers', shippingNumberRoutes)
app.use('/api/data-management', dataManagementRoutes)
app.use('/api/statements', statementRoutes)

app.use('/api/customers', customerRoutes)
app.use('/api/suppliers', supplierRoutes)
app.use('/api/supplier-materials', supplierMaterialRoutes)
app.use('/api/material-codes', materialCodeRoutes)
app.use('/api/products', productRoutes)
app.use('/api/production', productionRoutes)
app.use('/api/finance', financeRoutes)
app.use('/api/dashboard', dashboardRoutes)
app.use('/api/system', systemRoutes)
app.use('/api/fixed-costs', fixedCostRoutes)
app.use('/api/employees', employeeRoutes)
app.use('/api/user-config', userConfigRoutes)
app.use('/api/payables', payableRoutes)
app.use('/api/customer-aliases', customerAliasRoutes)
app.use('/api/sync', syncRoutes)
app.use('/api/cloud', cloudSyncRoutes)
app.use('/api/manual-sync', manualSyncRoutes)
app.use('/api/test', testRoutes)

// 静态资源托管 (前端构建产物)
const frontendPath = path.resolve(__dirname, '../../frontend/web-dist')
if (fs.existsSync(frontendPath)) {
  console.log(`Serving frontend from: ${frontendPath}`)
  app.use(express.static(frontendPath))
  // SPA 路由回退 - 非 API 请求返回 index.html
  app.get('*', (req, res, next) => {
    if (req.originalUrl.startsWith('/api')) {
      return next()
    }
    res.sendFile(path.join(frontendPath, 'index.html'))
  })
}

// 404处理
app.use('*', (req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.originalUrl} not found`,
    timestamp: new Date().toISOString()
  })
})

// 错误处理中间件
app.use(errorHandler)

export async function startServer(port = PORT) {
  const server = app.listen(port, async () => {
    console.log(`🚀 荣禾ERP后端服务启动成功`)
    console.log(`📍 服务地址: http://localhost:${port}`)
    console.log(`📊 环境: ${process.env.NODE_ENV || 'development'}`)
    console.log(`⏰ 启动时间: ${new Date().toLocaleString()}`)

    try {
      console.log(`🔄 正在初始化本地SQLite数据库...`)
      await syncDatabase(false)
      console.log(`✅ 本地SQLite数据库初始化成功`)

      // 修改：移除 MongoDB 自动同步，改为手动同步模式
      // 云服务器现在仅作为备份和小程序同步使用
      console.log(`📊 架构模式：本地 SQLite 为主，云服务器为辅（手动同步）`)

      // 初始化云同步服务（用于手动同步，不启动自动同步）
      console.log(`🔄 正在初始化云同步服务...`)
      const enableCloudSync = String(process.env.ENABLE_CLOUD_SYNC || '').toLowerCase() === 'true'
      const hasCloudCreds = (
        process.env.WECHAT_CLOUD_ENV_ID && (
          (process.env.TCB_SECRET_ID && process.env.TCB_SECRET_KEY) ||
          process.env.WECHAT_API_KEY
        )
      )
      if (enableCloudSync && hasCloudCreds) {
        const ok = await cloudSyncService.initialize()
        if (ok) {
          console.log(`✅ 云同步服务初始化成功（手动模式）`)
        } else {
          console.log(`⚠️ 云同步服务未启用（初始化失败或未配置）`)
        }
      } else {
        console.log(`⚠️ 跳过云同步服务初始化（未启用或未配置凭据）`)
        if (!enableCloudSync) {
          console.log(`   提示: ENABLE_CLOUD_SYNC=${process.env.ENABLE_CLOUD_SYNC}`)
        }
        if (!hasCloudCreds) {
          console.log(`   提示: 缺少云开发凭据配置`)
          console.log(`   - WECHAT_CLOUD_ENV_ID: ${process.env.WECHAT_CLOUD_ENV_ID ? '已配置' : '未配置'}`)
          console.log(`   - TCB_SECRET_ID: ${process.env.TCB_SECRET_ID ? '已配置' : '未配置'}`)
          console.log(`   - TCB_SECRET_KEY: ${process.env.TCB_SECRET_KEY ? '已配置' : '未配置'}`)
        }
      }

      console.log(`🎉 数据同步系统已就绪`)
      await realTimeSyncService.initialize()

      // 修改：移除自动启动的订单号清理任务
      // 订单号清理改为手动触发或禁用

      const prewarmCloud = String(process.env.CLOUDBASE_PREWARM ?? 'true').toLowerCase() !== 'false'
      if (prewarmCloud) {
        const ok = await cloudbaseService.initialize().catch(() => false)
        if (ok) {
          const startedAt = Date.now()
          try {
            await cloudbaseService.callFunction('erp-api', {
              action: 'getOrders',
              params: { page: 1, limit: 1, withTotal: false, excludeOrderType: 'purchase' }
            })
          } catch (_) { void 0 }
          try {
            await cloudbaseService.callFunction('erp-api', {
              action: 'getPurchaseOrders',
              params: { page: 1, limit: 1, withTotal: false, withProducts: false, category: 'boards' }
            })
          } catch (_) { void 0 }
          console.log(`🔥 云函数预热完成，耗时: ${Date.now() - startedAt}ms`)
        }
      }

    } catch (error) {
      console.error(`❌ 数据同步系统初始化失败:`, error.message)
      console.error(`📋 错误堆栈:`, error.stack)

      // 提供详细的错误诊断信息
      if (error.name === 'MongooseServerSelectionError') {
        console.error(`🔍 MongoDB连接失败诊断:`)
        console.error(`   - 请确保MongoDB服务已启动`)
        console.error(`   - 请检查MongoDB连接字符串配置`)
        console.error(`   - 默认连接地址: mongodb://localhost:27017/ronghe-erp`)
        console.error(`   - 环境变量MONGODB_URI: ${process.env.MONGODB_URI || '未设置'}`)
      }

      // 不中断主服务，只记录错误
      console.log(`⚠️  主服务继续运行，但数据同步功能不可用`)
    }
  })

  return server
}

const errorLogFile = path.join(__dirname, '../error.log')

const logErrorToFile = (error, type = 'Error') => {
  const errorDetails = {
    type,
    message: error?.message || String(error),
    stack: error?.stack,
    timestamp: new Date().toISOString()
  }
  try {
    fs.appendFileSync(errorLogFile, JSON.stringify(errorDetails, null, 2) + '\n---\n')
  } catch (e) {
    console.error('Failed to write to error log:', e)
  }
}

process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  logErrorToFile(error, 'UncaughtException')
  process.exit(1)
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  logErrorToFile(reason, 'UnhandledRejection')
})

// Force start for debugging
// const isEntry = process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === String(__filename).toLowerCase()
const isEntry = true

console.log('App Startup Check:', {
  filename: __filename,
  argv1: process.argv[1],
  resolvedArgv1: process.argv[1] ? path.resolve(process.argv[1]) : null,
  isEntry,
  env: process.env.NODE_ENV
})

if ((process.env.NODE_ENV || 'development') !== 'test') {
  startServer(CLI_PORT || PORT).catch((error) => {
    console.error('启动服务失败:', error)
    process.exit(1)
  })
}

export default app
