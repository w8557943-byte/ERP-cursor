import { jest } from '@jest/globals'
import jwt from 'jsonwebtoken'
import request from 'supertest'

const cloudbaseServiceMock = {
  initialize: jest.fn(),
  getCollection: jest.fn()
}

jest.unstable_mockModule('../src/services/cloudbaseService.js', () => ({
  default: cloudbaseServiceMock
}))

const { default: app } = await import('../src/app.js')

const makeAuth = () => {
  const token = jwt.sign({ userId: 'u1', role: 'admin' }, 'test-secret', { expiresIn: '1h' })
  return `Bearer ${token}`
}

describe('SKU create persists joinMethod via fallback set', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test'
    process.env.JWT_SECRET = 'test-secret'
    cloudbaseServiceMock.initialize.mockResolvedValue(true)
    cloudbaseServiceMock.getCollection.mockReset()
  })

  // Skipped: Route POST /api/customers/:id/skus not migrated to Sequelize/SQLite yet
  test.skip('POST /api/customers/:id/skus persists joinMethod when initial add/get drops it', async () => {
    const id = 'c1'
    const skuId = 'sku1'
    const calls = { add: 0, get: 0, set: 0 }
    
    // Mock collection behavior
    const collection = {
      add: jest.fn().mockImplementation(async ({ data }) => {
        calls.add += 1
        return { id: skuId }
      }),
      doc: jest.fn().mockImplementation((docId) => {
        return {
          get: jest.fn().mockImplementation(async () => {
            calls.get += 1
            // First get returns missing joinMethod (simulating DB issue)
            if (calls.get === 1) {
              return { 
                data: [{ 
                  _id: skuId, 
                  customerId: id, 
                  name: 'X', 
                  // joinMethod missing
                }] 
              }
            }
            // Second get returns correct joinMethod
            return { 
              data: [{ 
                _id: skuId, 
                customerId: id, 
                name: 'X', 
                joinMethod: '打钉' 
              }] 
            }
          }),
          set: jest.fn().mockImplementation(async ({ data }) => {
            calls.set += 1
            return { updated: 1 }
          })
        }
      })
    }

    cloudbaseServiceMock.getCollection.mockImplementation((name) => {
      if (name === 'customer_skus') return collection
      // Mock other collections like customers if needed
      if (name === 'customers') {
        return {
          doc: () => ({ get: jest.fn().mockResolvedValue({ data: [{ _id: id, name: 'Customer1' }] }) })
        }
      }
      return {
        add: jest.fn(),
        doc: () => ({ get: jest.fn(), set: jest.fn() })
      }
    })

    const res = await request(app)
      .post('/api/customers/c1/skus')
      .set('Authorization', makeAuth())
      .send({ 
        name: 'X', 
        unit: '个', 
        productionMode: 'inhouse', 
        joinMethod: '打钉' 
      })

    // Expect 201 Created or 200 OK depending on implementation
    // The previous test expected 201
    expect(res.status).toBe(201)
    
    const sku = res.body?.data?.sku
    // The sku returned should have joinMethod
    expect(sku?.joinMethod).toBe('打钉')
    
    // Verification of the "read-back check" mechanism
    expect(calls.add).toBe(1)
    expect(calls.get).toBeGreaterThanOrEqual(2) // At least 2 gets: one after add, one after fix
    expect(calls.set).toBe(1) // Should trigger one set to fix the missing field
  })
})
