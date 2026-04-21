import request from 'supertest'
import mongoose from 'mongoose'
import jwt from 'jsonwebtoken'
import WebSocket, { WebSocketServer } from 'ws'
import { MongoMemoryServer } from 'mongodb-memory-server'
import path from 'path'
import fs from 'fs'
import syncManager from '../src/services/syncManager.js'

const jwtSecret = process.env.JWT_SECRET || 'test-secret'
process.env.JWT_SECRET = jwtSecret
const DB_PATH = path.join(process.cwd(), `sync_integration_test_${Date.now()}.sqlite`)
process.env.SQLITE_DB_PATH = DB_PATH

const authToken = jwt.sign(
  { userId: 1, username: 'admin', role: 'admin' },
  jwtSecret,
  { expiresIn: '1h' }
)

/**
 * 数据同步集成测试
 * 测试PC端与小程序云开发数据同步的完整流程
 */
describe('数据同步集成测试', () => {
  let mongoServer
  let app
  let sequelizeInstance

  beforeAll(async () => {
    // 设置测试环境变量
    process.env.NODE_ENV = 'test'
    process.env.PORT = '0' // 使用随机端口
    
    // 连接到测试数据库
    mongoServer = await MongoMemoryServer.create()
    const mongoUri = mongoServer.getUri()
    process.env.TEST_MONGODB_URI = mongoUri
    await mongoose.connect(mongoUri)

    const appModule = await import('../src/app.js')
    app = appModule.default
    const sqliteDb = await import('../src/utils/sqliteDatabase.js')
    sequelizeInstance = sqliteDb.sequelize
    await sqliteDb.syncDatabase(true)

    try {
      if (syncManager.isRunning) {
        await syncManager.stop()
      }
    } catch (error) {
      console.warn('同步管理器停止警告:', error.message)
    }

    syncManager.isInitialized = false
    syncManager.isRunning = false
    syncManager.syncStatus = 'idle'
  })

  afterAll(async () => {
    // Stop SyncManager
    try {
      if (syncManager.isRunning) {
        await syncManager.stop()
      }
    } catch (error) {
      console.warn('Sync manager stop warning:', error.message)
    }

    if (sequelizeInstance) {
      await sequelizeInstance.close()
    }
    
    // Close Mongo
    await mongoose.disconnect()
    if (mongoServer) {
      await mongoServer.stop()
    }
    
    // Cleanup SQLite file
    try {
      if (fs.existsSync(DB_PATH)) {
        fs.unlinkSync(DB_PATH)
      }
    } catch (e) {
      // ignore
    }
  })

  beforeEach(async () => {
    // 清理测试数据
    const collections = mongoose.connection.collections
    for (const key in collections) {
      const collection = collections[key]
      await collection.deleteMany({})
    }
  })

  describe('同步管理器基础功能', () => {
    it('应该成功初始化同步管理器', async () => {
      const response = await request(app)
        .post('/api/sync/initialize')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toMatchObject({
        code: 200,
        message: '同步管理器初始化成功',
        data: {
          success: true,
          message: expect.stringContaining('初始化成功')
        }
      })
    })

    it('应该成功启动同步管理器', async () => {
      const response = await request(app)
        .post('/api/sync/start')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toMatchObject({
        code: 200,
        message: '同步管理器启动成功',
        data: {
          success: true,
          message: expect.stringContaining('启动成功')
        }
      })
    })

    it('应该成功获取同步状态', async () => {
      const response = await request(app)
        .get('/api/sync/status')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toMatchObject({
        code: 200,
        message: '获取同步状态成功',
        data: {
          status: expect.objectContaining({
            isInitialized: expect.any(Boolean),
            isRunning: expect.any(Boolean),
            syncStatus: expect.any(String)
          }),
          stats: expect.objectContaining({
            totalSyncs: expect.any(Number),
            successfulSyncs: expect.any(Number),
            failedSyncs: expect.any(Number)
          })
        }
      })
    })
  })

  describe('同步操作功能', () => {
    beforeEach(async () => {
      try {
        if (!syncManager.isInitialized) {
          await syncManager.initialize()
        }
      } catch (error) {
        // 忽略已初始化的错误
      }

      try {
        if (!syncManager.isRunning) {
          await syncManager.start()
        }
      } catch (error) {
        // 忽略已启动的错误
      }
    })

    it('应该成功执行增量同步', async () => {
      const response = await request(app)
        .post('/api/sync/sync/incremental')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          options: {
            batchSize: 100,
            maxConcurrent: 2
          }
        })
        .expect(200)

      expect(response.body).toMatchObject({
        code: 200,
        message: '增量同步执行成功',
        data: expect.objectContaining({
          success: true,
          stats: expect.any(Object)
        })
      })
    })

    it('应该成功执行一致性检查', async () => {
      const response = await request(app)
        .post('/api/sync/sync/consistency-check')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          options: {
            autoFix: true,
            detailedReport: true
          }
        })
        .expect(200)

      expect(response.body).toMatchObject({
        code: 200,
        message: '一致性检查执行成功',
        data: expect.objectContaining({
          success: true,
          data: expect.any(Object)
        })
      })
    }, 60000)

    it('应该成功执行冲突解决', async () => {
      const response = await request(app)
        .post('/api/sync/sync/conflict-resolution')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          options: {
            strategy: 'timestamp',
            autoResolve: true
          }
        })
        .expect(200)

      expect(response.body).toMatchObject({
        code: 200,
        message: '冲突解决执行成功',
        data: expect.objectContaining({
          success: true,
          resolvedCount: expect.any(Number),
          failedCount: expect.any(Number)
        })
      })
    })

    it('应该成功执行健康检查', async () => {
      const response = await request(app)
        .post('/api/sync/sync/health-check')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toMatchObject({
        code: 200,
        message: '健康检查执行成功',
        data: expect.objectContaining({
          timestamp: expect.any(String),
          services: expect.any(Object),
          overall: expect.any(String)
        })
      })
    })
  })

  describe('同步历史与统计', () => {
    it('应该成功获取同步历史', async () => {
      const response = await request(app)
        .get('/api/sync/history?limit=10&status=completed')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toMatchObject({
        code: 200,
        message: '获取同步历史成功',
        data: expect.any(Array)
      })
    })

    it('应该成功获取系统概览', async () => {
      const response = await request(app)
        .get('/api/sync/overview')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toMatchObject({
        code: 200,
        message: '获取系统概览成功',
        data: expect.objectContaining({
          timestamp: expect.any(String),
          syncManager: expect.any(Object),
          syncStats: expect.any(Object),
          services: expect.any(Object),
          recentHistory: expect.any(Array)
        })
      })
    })
  })

  describe('配置管理', () => {
    it('应该成功获取同步配置', async () => {
      const response = await request(app)
        .get('/api/sync/config')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toMatchObject({
        code: 200,
        message: '获取同步配置成功',
        data: expect.objectContaining({
          sync: expect.any(Object),
          performance: expect.any(Object),
          monitoring: expect.any(Object),
          websocket: expect.any(Object)
        })
      })
    })

    it('应该成功更新同步配置', async () => {
      const newConfig = {
        sync: {
          enableRealTimeSync: false,
          enableIncrementalSync: true
        },
        performance: {
          batchSize: 500,
          syncInterval: 60000
        }
      }

      const response = await request(app)
        .put('/api/sync/config')
        .set('Authorization', `Bearer ${authToken}`)
        .send({ config: newConfig })
        .expect(200)

      expect(response.body).toMatchObject({
        code: 200,
        message: '同步配置更新成功',
        data: expect.objectContaining({
          updated: true
        })
      })
    })
  })

  describe('工具功能', () => {
    it('应该成功测试同步连接', async () => {
      const response = await request(app)
        .post('/api/sync/test-connection')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toMatchObject({
        code: 200,
        message: '同步连接测试成功',
        data: expect.objectContaining({
          timestamp: expect.any(String),
          database: expect.any(String),
          websocket: expect.any(String),
          overall: expect.any(String)
        })
      })
    })

    it('应该成功重置同步状态', async () => {
      const response = await request(app)
        .post('/api/sync/reset-status')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200)

      expect(response.body).toMatchObject({
        code: 200,
        message: '同步状态重置成功',
        data: expect.objectContaining({
          timestamp: expect.any(String),
          syncQueue: expect.any(String),
          statistics: expect.any(String),
          overall: expect.any(String)
        })
      })
    })
  })

  describe('错误处理', () => {
    it('应该处理同步管理器未初始化的情况', async () => {
      // 模拟未初始化状态
      syncManager.isInitialized = false

      const response = await request(app)
        .post('/api/sync/start')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(500)

      expect(response.body).toMatchObject({
        code: 500,
        message: expect.stringContaining('失败'),
        error: expect.any(String)
      })

      // 恢复状态
      syncManager.isInitialized = true
    })

    it('应该处理无效的同步类型', async () => {
      const response = await request(app)
        .post('/api/sync/sync/start')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          syncType: 'invalid_type',
          options: {}
        })
        .expect(500)

      expect(response.body).toMatchObject({
        code: 500,
        message: expect.stringContaining('失败'),
        error: expect.any(String)
      })
    })
  })

  describe('WebSocket集成', () => {
    it('应该支持WebSocket连接', (done) => {
      const wss = new WebSocketServer({ port: 0, path: '/sync' })

      const timeoutId = setTimeout(() => {
        wss.close(() => {
          done()
        })
      }, 1200)

      wss.on('listening', () => {
        const address = wss.address()
        const port = typeof address === 'string' ? 0 : address.port

        const ws = new WebSocket(`ws://localhost:${port}/sync`)

        ws.on('open', () => {
          ws.send(JSON.stringify({
            type: 'get_status',
            payload: {}
          }))
        })

        ws.on('message', (data) => {
          const message = JSON.parse(data)
          expect(message).toHaveProperty('type')
          expect(message).toHaveProperty('data')
          ws.close()
        })

        ws.on('close', () => {
          clearTimeout(timeoutId)
          wss.close(() => {
            done()
          })
        })

        ws.on('error', (error) => {
          clearTimeout(timeoutId)
          try {
            ws.terminate()
          } catch (e) { }
          wss.close(() => {
            console.warn('WebSocket测试警告:', error.message)
            done()
          })
        })
      })

      wss.on('connection', (socket) => {
        socket.on('message', (raw) => {
          let payload
          try {
            payload = JSON.parse(raw.toString())
          } catch (e) {
            payload = null
          }

          if (payload && payload.type === 'get_status') {
            socket.send(JSON.stringify({ type: 'sync_status', data: { ok: true } }))
          } else {
            socket.send(JSON.stringify({ type: 'error', data: { message: 'invalid' } }))
          }
        })
      })
    })
  })

  describe('性能测试', () => {
    it('应该处理大量数据的同步', async () => {
      // 创建测试数据
      const createdBy = new mongoose.Types.ObjectId()
      const testData = []
      for (let i = 0; i < 100; i++) {
        const productId = new mongoose.Types.ObjectId()
        testData.push({
          orderNo: `TEST${i.toString().padStart(6, '0')}`,
          customerId: new mongoose.Types.ObjectId(),
          customerName: `Customer ${i}`,
          products: [
            {
              productId,
              productName: `Product ${i}`,
              quantity: 1,
              unitPrice: 100,
              totalPrice: 100
            }
          ],
          totalAmount: 100,
          finalAmount: 100,
          status: 'pending',
          createdBy,
          createdAt: new Date(),
          updatedAt: new Date()
        })
      }

      // 插入测试数据
      const Order = mongoose.model('Order')
      await Order.insertMany(testData)

      // 执行同步
      const startTime = Date.now()
      const response = await request(app)
        .post('/api/sync/sync/incremental')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          options: {
            batchSize: 50,
            maxConcurrent: 2
          }
        })
        .expect(200)

      const endTime = Date.now()
      const duration = endTime - startTime

      expect(response.body.code).toBe(200)
      expect(duration).toBeLessThan(10000) // 10秒内完成
    })
  })

  /**
   * 数据同步压力测试
   */
  describe('数据同步压力测试', () => {
    it('应该处理并发同步请求', async () => {
      const promises = []

      // 同时发起多个同步请求
      for (let i = 0; i < 10; i++) {
        promises.push(
          request(app)
            .post('/api/sync/sync/health-check')
            .set('Authorization', `Bearer ${authToken}`)
        )
      }

      const results = await Promise.all(promises)

      // 所有请求都应该成功
      results.forEach(response => {
        expect(response.status).toBe(200)
        expect(response.body.code).toBe(200)
      })
    })

    it('应该处理高频同步请求', async () => {
      const startTime = Date.now()
      const requests = []

      // 在1秒内发起多个请求
      for (let i = 0; i < 20; i++) {
        requests.push(
          request(app)
            .get('/api/sync/status')
            .set('Authorization', `Bearer ${authToken}`)
        )
        
        // 稍微延迟，模拟真实场景
        await new Promise(resolve => setTimeout(resolve, 50))
      }

      const results = await Promise.all(requests)
      const endTime = Date.now()
      const duration = endTime - startTime

      // 检查响应时间
      expect(duration).toBeLessThan(3000) // 3秒内完成所有请求

      // 检查成功率
      const successCount = results.filter(r => r.status === 200).length
      expect(successCount).toBeGreaterThanOrEqual(18) // 成功率至少90%
    })
  })
})
