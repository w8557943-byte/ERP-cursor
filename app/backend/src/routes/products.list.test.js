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

const ProductMock = {
  findAndCountAll: jest.fn(),
  findOne: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  destroy: jest.fn()
}

jest.unstable_mockModule('../utils/sqliteDatabase.js', () => ({
  __esModule: true,
  ...databaseMock
}))

jest.unstable_mockModule('../models/local/Product.js', () => ({
  __esModule: true,
  default: ProductMock
}))

const { default: app } = await import('../app.js')

const makeAuth = () => {
  const token = jwt.sign({ userId: 'u1', role: 'admin' }, process.env.JWT_SECRET || 'test-secret', { expiresIn: '1h' })
  return `Bearer ${token}`
}

describe('GET /api/products', () => {
  beforeEach(() => {
    process.env.JWT_SECRET = 'test-secret'
    databaseMock.syncDatabase.mockClear()
    ProductMock.findAndCountAll.mockReset()
  })

  test('returns products and total', async () => {
    const mockProducts = [
      { 
        id: 1, 
        productCode: 'P001', 
        name: 'Product A', 
        category: 'Electronics', 
        toJSON: () => ({ id: 1, productCode: 'P001', name: 'Product A', category: 'Electronics' }) 
      },
      { 
        id: 2, 
        productCode: 'P002', 
        name: 'Product B', 
        category: 'Books', 
        toJSON: () => ({ id: 2, productCode: 'P002', name: 'Product B', category: 'Books' }) 
      }
    ]
    
    ProductMock.findAndCountAll.mockResolvedValue({
      rows: mockProducts,
      count: 2
    })

    const res = await request(app)
      .get('/api/products?page=1&pageSize=10')
      .set('Authorization', makeAuth())
      .expect(200)

    expect(res.body.success).toBe(true)
    expect(res.body.data.products).toHaveLength(2)
    expect(res.body.data.pagination.total).toBe(2)
    expect(ProductMock.findAndCountAll).toHaveBeenCalledTimes(1)
  })

  test('handles filtering', async () => {
    ProductMock.findAndCountAll.mockResolvedValue({ rows: [], count: 0 })

    await request(app)
      .get('/api/products?category=Electronics&keyword=test')
      .set('Authorization', makeAuth())
      .expect(200)

    const callArgs = ProductMock.findAndCountAll.mock.calls[0][0]
    expect(callArgs.where).toHaveProperty('category', 'Electronics')
    // Keyword search uses Op.or
    const symbols = Object.getOwnPropertySymbols(callArgs.where)
    expect(symbols.length).toBeGreaterThan(0)
    expect(callArgs.where[symbols[0]]).toBeDefined()
  })
})
