import { jest } from '@jest/globals'
import path from 'path'
import fs from 'fs'
import express from 'express'
import request from 'supertest'

jest.setTimeout(30000)

const DB_PATH = path.join(process.cwd(), `orders_detail_test_${Date.now()}.sqlite`)

const buildTestApp = async () => {
  jest.resetModules()
  process.env.NODE_ENV = 'test'
  process.env.JWT_SECRET = 'test-secret'
  process.env.SQLITE_DB_PATH = DB_PATH

  await jest.unstable_mockModule('../src/middleware/auth.js', () => ({
    authenticateToken: (req, _res, next) => {
      req.user = { id: 'test-user', role: 'admin' }
      next()
    },
    requireUser: (_req, _res, next) => next(),
    requireAdmin: (_req, _res, next) => next()
  }))

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

describe('GET /api/orders/:id (SQLite/Sequelize)', () => {
  test('returns order when found by orderNo', async () => {
    const { app, Order, sequelize } = await buildTestApp()
    sequelizeInstance = sequelize
    const orderNo = 'QXDD20260130030'
    const created = await Order.create({
      orderNo,
      customerId: 'c1',
      customerName: '测试客户',
      totalAmount: 100,
      finalAmount: 100,
      status: 'pending',
      items: [{ productName: '测试商品', quantity: 1, price: 100 }]
    })

    const res = await request(app).get(`/api/orders/${encodeURIComponent(orderNo)}`).expect(200)
    expect(res.body?.success).toBe(true)
    expect(res.body?.data?.order?.orderNo).toBe(orderNo)
    expect(res.body?.data?.order?._id).toBe(String(created.id))
    expect(res.body?.data?.order?.orderNumber).toBe(orderNo)
  })

  test('returns order when found by cloudId', async () => {
    const { app, Order } = await buildTestApp()
    const cloudId = '507f1f77bcf86cd799439011'
    const created = await Order.create({
      orderNo: 'QXDD20260130029',
      cloudId,
      customerId: 'c2',
      customerName: '测试客户2',
      totalAmount: 80,
      finalAmount: 80,
      status: 'pending',
      items: [{ productName: '测试商品2', quantity: 1, price: 80 }]
    })

    const res = await request(app).get(`/api/orders/${cloudId}`).expect(200)
    expect(res.body?.success).toBe(true)
    expect(res.body?.data?.order?.cloudId).toBe(cloudId)
    expect(res.body?.data?.order?.orderNo).toBe('QXDD20260130029')
    expect(res.body?.data?.order?._id).toBe(String(created.id))
  })

  test('benchmark local detail latency', async () => {
    const { app, Order } = await buildTestApp()
    const orderNo = 'QXDD20260130031'
    await Order.create({
      orderNo,
      customerId: 'c3',
      customerName: '测试客户3',
      totalAmount: 50,
      finalAmount: 50,
      status: 'pending',
      items: [{ productName: '测试商品3', quantity: 1, price: 50 }]
    })

    const n = 50
    const durationsMs = []
    const t0 = process.hrtime.bigint()
    for (let i = 0; i < n; i += 1) {
      const s = process.hrtime.bigint()
      await request(app).get(`/api/orders/${encodeURIComponent(orderNo)}`).expect(200)
      const e = process.hrtime.bigint()
      durationsMs.push(Number(e - s) / 1e6)
    }
    const t1 = process.hrtime.bigint()
    const totalMs = Number(t1 - t0) / 1e6
    durationsMs.sort((a, b) => a - b)
    const avg = durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length
    const p95 = durationsMs[Math.floor(durationsMs.length * 0.95)]
    const qps = (n / (totalMs / 1000))

    console.log(`[bench][orders.detail.sqlite] n=${n} avg=${avg.toFixed(2)}ms p95=${p95.toFixed(2)}ms qps=${qps.toFixed(1)}`)
    expect(avg).toBeLessThan(200)
    expect(p95).toBeLessThan(500)
  })
})

describe('POST /api/orders (SQLite/Sequelize)', () => {
  test('creates order locally and triggers sync hook', async () => {
    const { app, syncCalls } = await buildTestApp()

    const payload = {
      orderNo: 'QXDD20260130032',
      customerId: 'c4',
      customerName: '测试客户4',
      items: [{ productName: '测试产品', quantity: 2, unitPrice: 60 }],
      totalAmount: 120,
      finalAmount: 120
    }

    const res = await request(app).post('/api/orders').send(payload).expect(201)
    expect(res.body?.success).toBe(true)
    expect(res.body?.data?.order?.orderNo).toBe('QXDD20260130032')
    expect(Array.isArray(syncCalls)).toBe(true)
    expect(syncCalls.some((c) => c && c.collection === 'orders')).toBe(true)
  })
})
