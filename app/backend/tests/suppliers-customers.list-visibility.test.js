import { jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'
import path from 'path'
import fs from 'fs'

const DB_PATH = path.join(process.cwd(), `list_visibility_test_${Date.now()}.sqlite`)

const makeCloudCollection = (docs) => {
  const orderByCalls = []

  const makeQuery = () => {
    let orderByField = ''
    let orderByDirection = 'desc'
    let skipN = 0
    let limitN = 10

    const query = {
      orderBy: jest.fn((field, direction) => {
        orderByField = String(field || '')
        orderByDirection = String(direction || 'desc')
        orderByCalls.push([orderByField, orderByDirection])
        return query
      }),
      skip: jest.fn((n) => {
        skipN = Number(n || 0)
        return query
      }),
      limit: jest.fn((n) => {
        limitN = Number(n || 0)
        return query
      }),
      get: jest.fn(async () => {
        let rows = Array.isArray(docs) ? [...docs] : []

        if (orderByField === '_updateTime') {
          rows = rows.filter((d) => d && d._updateTime != null)
        }

        if (orderByField === '_id') {
          rows.sort((a, b) => {
            const sa = String(a?._id ?? '')
            const sb = String(b?._id ?? '')
            return orderByDirection === 'asc' ? sa.localeCompare(sb) : sb.localeCompare(sa)
          })
        }

        const out = rows.slice(skipN, skipN + limitN)
        return { data: out }
      }),
      count: jest.fn(async () => ({ total: Array.isArray(docs) ? docs.length : 0 }))
    }

    return query
  }

  const collection = {
    where: jest.fn(() => makeQuery()),
    doc: jest.fn((id) => ({
      get: jest.fn(async () => ({ data: (Array.isArray(docs) ? docs : []).filter((d) => String(d?._id) === String(id)) }))
    }))
  }

  return { collection, orderByCalls }
}

const buildTestApp = async ({ suppliersDocs, customersDocs }) => {
  jest.resetModules()
  process.env.NODE_ENV = 'test'
  process.env.SQLITE_DB_PATH = DB_PATH

  const suppliers = makeCloudCollection(suppliersDocs)
  const customers = makeCloudCollection(customersDocs) // Kept for structure but unused by Customers route

  await jest.unstable_mockModule('../src/middleware/auth.js', () => ({
    authenticateToken: (req, _res, next) => {
      req.user = { id: 'test-user' }
      next()
    },
    requireUser: (_req, _res, next) => next(),
    requireAdmin: (_req, _res, next) => next()
  }))

  await jest.unstable_mockModule('../src/services/cloudbaseService.js', () => ({
    default: {
      initialized: true,
      initialize: jest.fn().mockResolvedValue(true),
      getCollection: (name) => {
        if (name === 'suppliers') return suppliers.collection
        if (name === 'customers') return customers.collection
        throw new Error(`unexpected collection: ${String(name)}`)
      }
    }
  }))

  // Import Customer model and Sequelize
  const { sequelize } = await import('../src/utils/sqliteDatabase.js')
  const { default: Customer } = await import('../src/models/local/Customer.js')
  
  await sequelize.sync({ force: true })
  
  // Seed Customers if provided
  if (customersDocs && customersDocs.length > 0) {
    const records = customersDocs.map((d, i) => ({
      name: d.name || `Customer ${i}`,
      contactPerson: 'Contact',
      phone: '12345678900',
      customerCode: `CUST${i}`,
      updatedAt: d._updateTime ? new Date(d._updateTime) : new Date()
    }))
    await Customer.bulkCreate(records)
  }

  const suppliersRoutes = (await import('../src/routes/suppliers.js')).default
  const customersRoutes = (await import('../src/routes/customers.js')).default

  const app = express()
  app.use(express.json())
  app.use('/api/suppliers', suppliersRoutes)
  app.use('/api/customers', customersRoutes)

  return { app, suppliers, customers, sequelize }
}

describe('Suppliers/customers list visibility', () => {
  let app
  let sequelizeInstance
  let suppliersMock

  afterEach(async () => {
    if (sequelizeInstance) {
      await sequelizeInstance.close()
    }
  })

  afterAll(async () => {
    if (fs.existsSync(DB_PATH)) {
      try {
        await new Promise(resolve => setTimeout(resolve, 500))
        fs.unlinkSync(DB_PATH)
      } catch (e) { console.warn(e) }
    }
  })

  test('GET /api/suppliers uses _id ordering so docs without _updateTime stay visible', async () => {
    const docs = [
      { _id: 'a1', name: 'A', _updateTime: 1710000000000 },
      { _id: 'b2', name: 'B' }
    ]

    const built = await buildTestApp({ suppliersDocs: docs, customersDocs: [] })
    app = built.app
    suppliersMock = built.suppliers
    sequelizeInstance = built.sequelize

    const res = await request(app).get('/api/suppliers?page=1&pageSize=10').expect(200)
    expect(res.body?.success).toBe(true)
    expect(Array.isArray(res.body?.data)).toBe(true)
    const ids = res.body.data.map((r) => r && r._id).filter(Boolean)
    expect(ids).toEqual(expect.arrayContaining(['a1', 'b2']))
    
    // Verify cloudbase mock was called with _id sort
    expect(suppliersMock.orderByCalls.some(([f]) => f === '_id')).toBe(true)
    expect(suppliersMock.orderByCalls.some(([f]) => f === '_updateTime')).toBe(false)
  })

  test('GET /api/suppliers keyword search still finds doc without _updateTime', async () => {
    const missingUpdateTimeId = '97abb941-0b1b-485a-bbd6-b008b557bf25'
    const docs = [
      { _id: missingUpdateTimeId, name: '缺失供应商' },
      { _id: 'x1', name: '其他供应商', _updateTime: 1710000000000 }
    ]

    const built = await buildTestApp({ suppliersDocs: docs, customersDocs: [] })
    app = built.app
    sequelizeInstance = built.sequelize

    const res = await request(app).get(`/api/suppliers?keyword=${encodeURIComponent('缺失')}`).expect(200)
    expect(res.body?.success).toBe(true)
    const data = res.body?.data || []
    expect(data.some(d => d._id === missingUpdateTimeId)).toBe(true)
  })

  test('GET /api/customers returns all customers from SQLite (handling missing updateTime equivalent)', async () => {
    const docs = [
      { _id: 'c1', name: 'C1', _updateTime: Date.now() },
      { _id: 'c2', name: 'C2' } // missing _updateTime
    ]

    const built = await buildTestApp({ suppliersDocs: [], customersDocs: docs })
    app = built.app
    sequelizeInstance = built.sequelize

    const res = await request(app).get('/api/customers?page=1&pageSize=10').expect(200)
    expect(res.body?.success).toBe(true)
    
    // Customers route returns { data: { customers: [...] } }
    const customers = res.body.data.customers || res.body.data
    expect(Array.isArray(customers)).toBe(true)
    
    // Verify we get 2 customers
    expect(customers).toHaveLength(2)
    const names = customers.map(d => d.name).sort()
    expect(names).toEqual(['C1', 'C2'])
  })
})
