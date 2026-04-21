import { jest } from '@jest/globals'
import jwt from 'jsonwebtoken'
import request from 'supertest'

const cloudbaseServiceMock = {
  initialize: jest.fn(),
  getCollection: jest.fn(),
  db: {
    command: {
      sum: jest.fn((n) => ({ $sum: n })),
      lt: jest.fn((v) => ({ $lt: v }))
    }
  }
}

jest.unstable_mockModule('../services/cloudbaseService.js', () => ({
  __esModule: true,
  default: cloudbaseServiceMock
}))

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

jest.unstable_mockModule('../utils/sqliteDatabase.js', () => ({
  __esModule: true,
  ...databaseMock
}))

// We mock Customer just to be safe, though the endpoint might not even query it
const CustomerMock = {
  count: jest.fn().mockResolvedValue(0),
  findAll: jest.fn().mockResolvedValue([])
}

jest.unstable_mockModule('../models/local/Customer.js', () => ({
  __esModule: true,
  default: CustomerMock
}))

const { default: app } = await import('../app.js')

const makeAuth = () => {
  const token = jwt.sign({ userId: 'u1', role: 'admin' }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' })
  return `Bearer ${token}`
}

describe('GET /api/customers/sku-stats', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    databaseMock.syncDatabase.mockClear()
    cloudbaseServiceMock.initialize.mockReset()
    cloudbaseServiceMock.getCollection.mockReset()
  })

  test('returns sqlite fallback when cloud is unavailable', async () => {
    cloudbaseServiceMock.initialize.mockResolvedValue(false)
    const res = await request(app)
      .get('/api/customers/sku-stats')
      .set('Authorization', makeAuth())
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.data).toEqual({
      stats: [],
      totalSkus: 0,
      _meta: { source: 'local_sqlite' }
    })
  })

  test('returns sku stats from cloudbase when available', async () => {
    cloudbaseServiceMock.initialize.mockResolvedValue(true)
    CustomerMock.findAll.mockResolvedValue([{ id: 1, cloudId: 'c1' }])

    let calls = 0
    const collection = {
      where: () => ({
        orderBy: () => ({
          limit: () => ({
            get: async () => {
              calls += 1
              if (calls === 1) return { data: [{ _id: 's1', customerId: 'c1' }, { _id: 's2', customerId: 'c1' }, { _id: 's3', customerId: 'c1' }] }
              return { data: [] }
            }
          })
        })
      })
    }
    cloudbaseServiceMock.getCollection.mockReturnValue(collection)

    const res = await request(app)
      .get('/api/customers/sku-stats')
      .set('Authorization', makeAuth())
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.data).toEqual({
      stats: [{ customerId: '1', skuCount: 3 }],
      totalSkus: 3,
      _meta: { source: 'cloudbase', collection: 'customer_skus', scannedTotal: 3 }
    })
  })
})
