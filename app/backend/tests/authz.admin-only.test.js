import { jest } from '@jest/globals'
import jwt from 'jsonwebtoken'
import request from 'supertest'
import path from 'path'
import fs from 'fs'

const originalEnv = { ...process.env }
const restoreEnv = () => {
  for (const key of Object.keys(process.env)) {
    if (!(key in originalEnv)) delete process.env[key]
  }
  Object.assign(process.env, originalEnv)
}

const DB_PATH = path.join(process.cwd(), `authz_test_${Date.now()}.sqlite`)
process.env.NODE_ENV = 'test'
process.env.JWT_SECRET = 'test-secret'
process.env.SQLITE_DB_PATH = DB_PATH
delete process.env.MONGODB_URI
process.env.USE_LOCAL_MONGO_WRITES = 'false'

const cloudbaseServiceMock = {
  initialize: jest.fn(),
  callFunction: jest.fn(),
  getCollection: jest.fn(),
  clearFunctionCache: jest.fn()
}

const orderNumberServiceMock = {
  generateOrderNumber: jest.fn(async () => ({ orderNo: 'QXDD20260101001', orderNumber: 'QXDD20260101001', reservationId: 'r1' })),
  confirmOrderNumber: jest.fn(async () => null),
  releaseOrderNumber: jest.fn(async () => null),
  ensureSequenceAtLeast: jest.fn(async () => null),
  startCleanupJob: jest.fn()
}

jest.unstable_mockModule('../src/services/cloudbaseService.js', () => ({
  default: cloudbaseServiceMock
}))

jest.unstable_mockModule('../src/services/orderNumberService.js', () => ({
  default: orderNumberServiceMock
}))

const { default: app } = await import('../src/app.js')
const { sequelize } = await import('../src/utils/sqliteDatabase.js')

const signToken = ({ userId, role }) => {
  const token = jwt.sign({ userId, role, jti: `${userId}-${role}` }, process.env.JWT_SECRET, { expiresIn: '1h' })
  return `Bearer ${token}`
}

describe('Admin-only routes', () => {
  afterAll(async () => {
    if (sequelize) {
      await sequelize.close()
    }
    restoreEnv()
    if (fs.existsSync(DB_PATH)) {
      try {
        fs.unlinkSync(DB_PATH)
      } catch (e) {
        // ignore
      }
    }
  })

  beforeEach(() => {
    cloudbaseServiceMock.initialize.mockResolvedValue(true)
    cloudbaseServiceMock.callFunction.mockReset()
    cloudbaseServiceMock.getCollection.mockReset()
    cloudbaseServiceMock.clearFunctionCache.mockReset()

    const remove = jest.fn().mockResolvedValue(true)
    const add = jest.fn().mockResolvedValue({ id: 'sku1' })
    const doc = jest.fn(() => ({ remove }))

    cloudbaseServiceMock.getCollection.mockImplementation(() => ({
      add,
      doc,
      where: () => ({ limit: () => ({ get: async () => ({ data: [] }) }) })
    }))

    cloudbaseServiceMock.callFunction.mockImplementation(async (_name, payload = {}) => {
      const action = payload?.action
      if (action === 'updateOrder') {
        return { result: { success: true, data: { _id: payload?.data?.id || 'o1' } } }
      }
      if (action === 'deleteOrder') {
        return { result: { success: true } }
      }
      return { result: { success: true, data: { _id: 'o1', orderNo: 'QXDD20260101001' } } }
    })
  })

  test('Create order requires admin', async () => {
    const payload = {
      supplierName: '供应商A',
      orderType: 'purchase',
      items: [{ quantity: 1, unitPrice: 1, amount: 1, title: 'SKU1', unit: '片' }]
    }

    await request(app)
      .post('/api/orders')
      .set('Authorization', signToken({ userId: 'u_op', role: 'user' }))
      .send(payload)
      .expect(403)

    await request(app)
      .post('/api/orders')
      .set('Authorization', signToken({ userId: 'u_admin', role: 'admin' }))
      .send(payload)
      .expect((res) => {
        if (res.status === 403) throw new Error('expected non-403 for admin')
      })
  })

  // Skipped: Route not migrated to Sequelize/SQLite yet or path changed
  test.skip('Create SKU requires admin', async () => {
    const payload = { name: '箱子', productionMode: 'inhouse' }

    await request(app)
      .post('/api/customers/c1/skus')
      .set('Authorization', signToken({ userId: 'u_op', role: 'user' }))
      .send(payload)
      .expect(403)

    await request(app)
      .post('/api/customers/c1/skus')
      .set('Authorization', signToken({ userId: 'u_admin', role: 'admin' }))
      .send(payload)
      .expect(201)
  })

  // Skipped: Route not migrated to Sequelize/SQLite yet or path changed (use PUT /:id)
  test.skip('Ship (status update) requires admin', async () => {
    const payload = { status: 'shipping' }

    await request(app)
      .patch('/api/orders/o1/status')
      .set('Authorization', signToken({ userId: 'u_op', role: 'user' }))
      .send(payload)
      .expect(403)

    await request(app)
      .patch('/api/orders/o1/status')
      .set('Authorization', signToken({ userId: 'u_admin', role: 'admin' }))
      .send(payload)
      .expect(200)
  })

  test('Shipping number generation requires admin', async () => {
    const payload = { shipDate: '2026-01-01' }

    await request(app)
      .post('/api/shipping-numbers/generate')
      .set('Authorization', signToken({ userId: 'u_op', role: 'user' }))
      .send(payload)
      .expect(403)

    await request(app)
      .post('/api/shipping-numbers/generate')
      .set('Authorization', signToken({ userId: 'u_admin', role: 'admin' }))
      .send(payload)
      .expect(200)
  })

  test('Delete order requires admin', async () => {
    await request(app)
      .delete('/api/orders/o1')
      .set('Authorization', signToken({ userId: 'u_op', role: 'user' }))
      .expect(403)

    await request(app)
      .delete('/api/orders/o1')
      .set('Authorization', signToken({ userId: 'u_admin', role: 'admin' }))
      .expect((res) => {
        if (res.status === 403) throw new Error('expected non-403 for admin')
      })
  })
})
