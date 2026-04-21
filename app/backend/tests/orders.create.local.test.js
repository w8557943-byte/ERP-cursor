import { jest } from '@jest/globals'
import path from 'path'
import fs from 'fs'
import express from 'express'
import request from 'supertest'

jest.setTimeout(30000)

const DB_PATH = path.join(process.cwd(), `orders_create_test_${Date.now()}.sqlite`)

const setupTestApp = async () => {
  jest.resetModules()
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'test-secret'
  process.env.SQLITE_DB_PATH = DB_PATH

  // Mock auth middleware
  await jest.unstable_mockModule('../src/middleware/auth.js', () => ({
    authenticateToken: (req, _res, next) => {
      req.user = { id: 'test-user', role: 'admin' }
      next()
    },
    requireUser: (_req, _res, next) => next(),
    requireAdmin: (_req, _res, next) => next()
  }))

  // Mock SyncService to track calls
  const syncCalls = []
  await jest.unstable_mockModule('../src/services/syncService.js', () => ({
    default: {
      sync: jest.fn(async (entity, collection) => {
        syncCalls.push({ entity, collection })
        return true
      }),
      syncProduct: jest.fn(async () => true)
    }
  }))

  const { syncDatabase, sequelize } = await import('../src/utils/sqliteDatabase.js')
  const Order = (await import('../src/models/local/Order.js')).default
  
  // Ensure DB is ready
  await syncDatabase(true)

  const orderRoutes = (await import('../src/routes/orders.js')).default
  const app = express()
  app.use(express.json())
  app.use('/api/orders', orderRoutes)
  
  return { app, Order, syncCalls, sequelize }
}

let sequelizeInstance

afterEach(async () => {
  if (sequelizeInstance) {
    await sequelizeInstance.close()
    sequelizeInstance = null
  }
})

afterAll(async () => {
  if (fs.existsSync(DB_PATH)) {
    try {
      // Wait a bit for file handle release
      await new Promise(resolve => setTimeout(resolve, 500))
      fs.unlinkSync(DB_PATH)
    } catch (e) {
      console.warn('Failed to cleanup test DB:', e.message)
    }
  }
})

describe('POST /api/orders (Local Creation)', () => {
  test('creates order successfully and triggers sync', async () => {
    const { app, syncCalls, sequelize } = await setupTestApp()
    sequelizeInstance = sequelize

    const payload = {
      orderNo: 'QXDD20260201001',
      customerId: 'c1',
      customerName: 'Test Customer',
      items: [{ productName: 'Test Product', quantity: 1, unitPrice: 100 }],
      totalAmount: 100,
      finalAmount: 100
    }

    const res = await request(app).post('/api/orders').send(payload).expect(201)
    
    expect(res.body.success).toBe(true)
    expect(res.body.data.order.orderNo).toBe(payload.orderNo)
    expect(res.body.data.order._id).toBeDefined()
    
    // Verify sync hook was triggered
    expect(syncCalls.length).toBeGreaterThan(0)
    expect(syncCalls[0].collection).toBe('orders')
    expect(syncCalls[0].entity.orderNo).toBe(payload.orderNo)
  })

  test('returns 409 when orderNo already exists', async () => {
    const { app, Order, sequelize } = await setupTestApp()
    sequelizeInstance = sequelize

    const orderNo = 'QXDD20260201002'
    await Order.create({
      orderNo,
      customerId: 'c1',
      customerName: 'Test Customer',
      items: [],
      totalAmount: 100,
      finalAmount: 100
    })

    const payload = {
      orderNo,
      customerId: 'c1',
      customerName: 'Test Customer',
      items: [{ productName: 'Test Product', quantity: 1, unitPrice: 100 }],
      totalAmount: 100,
      finalAmount: 100
    }

    const res = await request(app).post('/api/orders').send(payload).expect(409)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/订单号已存在/)
  })

  test('returns 400 when orderNo is missing', async () => {
    const { app, sequelize } = await setupTestApp()
    sequelizeInstance = sequelize

    const payload = {
      customerId: 'c1',
      customerName: 'Test Customer'
    }

    const res = await request(app).post('/api/orders').send(payload).expect(400)
    expect(res.body.success).toBe(false)
    expect(res.body.message).toMatch(/缺少订单号/)
  })
})
