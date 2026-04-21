import { jest } from '@jest/globals'
import jwt from 'jsonwebtoken'
import request from 'supertest'

const databaseMock = {
  syncDatabase: jest.fn().mockResolvedValue(true),
  sequelize: {
    transaction: jest.fn(),
    authenticate: jest.fn().mockResolvedValue(true),
    define: jest.fn().mockReturnValue({
      afterCreate: jest.fn(),
      afterUpdate: jest.fn(),
      hasMany: jest.fn(),
      belongsTo: jest.fn()
    })
  }
}

const OrderMock = {
  findAll: jest.fn(),
  count: jest.fn(),
  findByPk: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  destroy: jest.fn()
}

// Mock auth middleware to bypass real JWT verification if needed, 
// but since we import app.js which imports auth.js, we might need to mock auth or provide valid token.
// The original test used a real JWT sign with process.env.JWT_SECRET.

jest.unstable_mockModule('../utils/sqliteDatabase.js', () => ({
  __esModule: true,
  ...databaseMock
}))

jest.unstable_mockModule('../models/local/Order.js', () => ({
  __esModule: true,
  default: OrderMock
}))

// We need to mock middleware/auth.js if we want to avoid real JWT checks or just set env vars.
// Setting env vars is easier.

const { default: app } = await import('../app.js')

const makeAuth = () => {
  const token = jwt.sign({ userId: 'u1', role: 'admin' }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' })
  return `Bearer ${token}`
}

describe('GET /api/orders pagination and filtering', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    databaseMock.syncDatabase.mockClear()
    OrderMock.findAll.mockReset()
    OrderMock.count.mockReset()
  })

  test('returns empty list when no orders found', async () => {
    OrderMock.findAll.mockResolvedValue([])
    OrderMock.count.mockResolvedValue(0)

    const res = await request(app)
      .get('/api/orders?page=1&limit=10')
      .set('Authorization', makeAuth())
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.data.orders).toEqual([])
    expect(res.body.data.pagination.total).toBeUndefined() // withTotal default false
    expect(OrderMock.findAll).toHaveBeenCalledTimes(1)
  })

  test('returns orders with default pagination', async () => {
    const mockOrders = [
      { id: 1, orderNo: 'ORD-001', toJSON: () => ({ id: 1, orderNo: 'ORD-001' }) },
      { id: 2, orderNo: 'ORD-002', toJSON: () => ({ id: 2, orderNo: 'ORD-002' }) }
    ]
    OrderMock.findAll.mockResolvedValue(mockOrders)

    const res = await request(app)
      .get('/api/orders')
      .set('Authorization', makeAuth())
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.data.orders.length).toBe(2)
    expect(res.body.data.orders[0].orderNo).toBe('ORD-001')
    expect(OrderMock.findAll).toHaveBeenCalledWith(expect.objectContaining({
      limit: 20, // default
      offset: 0
    }))
  })

  test('handles withTotal=true', async () => {
    const mockOrders = [
      { id: 1, orderNo: 'ORD-001', toJSON: () => ({ id: 1, orderNo: 'ORD-001' }) }
    ]
    OrderMock.findAll.mockResolvedValue(mockOrders)
    OrderMock.count.mockResolvedValue(55)

    const res = await request(app)
      .get('/api/orders?page=1&limit=10&withTotal=true')
      .set('Authorization', makeAuth())
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.data.pagination.total).toBe(55)
    expect(res.body.data.pagination.totalPages).toBe(6) // ceil(55/10)
    expect(OrderMock.count).toHaveBeenCalledTimes(1)
  })

  test('applies filters correctly', async () => {
    OrderMock.findAll.mockResolvedValue([])
    
    await request(app)
      .get('/api/orders?status=pending&customerId=123')
      .set('Authorization', makeAuth())
      .expect(200)

    expect(OrderMock.findAll).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        status: 'pending',
        customerId: '123'
      })
    }))
  })

  test('applies keyword search', async () => {
    OrderMock.findAll.mockResolvedValue([])

    await request(app)
      .get('/api/orders?keyword=test')
      .set('Authorization', makeAuth())
      .expect(200)

    // The implementation uses Op.or for keyword search
    // We can verify that findAll was called with specific structure
    const callArgs = OrderMock.findAll.mock.calls[0][0]
    const symbols = Object.getOwnPropertySymbols(callArgs.where)
    expect(symbols.length).toBeGreaterThan(0)
    expect(callArgs.where[symbols[0]]).toBeDefined()
  })
})
