import { jest } from '@jest/globals'
import express from 'express'
import request from 'supertest'
import path from 'path'
import fs from 'fs'

const targetSupplierId = 'a21bec52-61ac-4216-ade2-d01b76cd563c'
const targetCustomerIds = [
  '75c1c10a-9557-43cc-8d9b-ba379a93e025',
  '4a28cab5-51e7-47aa-ac9d-6533e8f5e7c5'
]

const DB_PATH = path.join(process.cwd(), `restore_visibility_test_${Date.now()}.sqlite`)

const makeCloudCollection = (docs) => {
  const query = {
    orderBy: jest.fn(() => query),
    skip: jest.fn(() => query),
    limit: jest.fn(() => query),
    where: jest.fn(() => query),
    count: jest.fn(async () => ({ total: docs.length })),
    get: jest.fn(async () => ({ data: docs }))
  }

  const collection = {
    where: jest.fn(() => query),
    doc: jest.fn((id) => ({
      get: jest.fn(async () => ({ data: docs.filter(d => d._id === id) }))
    })),
    add: jest.fn(async () => ({ id: 'mock-id' }))
  }

  return collection
}

const buildTestApp = async () => {
  jest.resetModules()
  process.env.NODE_ENV = 'test'
  process.env.SQLITE_DB_PATH = DB_PATH

  const suppliersDocs = [
    { 
      _id: targetSupplierId, 
      name: '昆山美泰纸业有限公司', 
      status: 'active',
      isDeleted: false 
    },
    { _id: 's2', name: 'Other Supplier' }
  ]

  // Mock data for Cloudbase (Suppliers only, as Customers are now in SQLite)
  const suppliersCol = makeCloudCollection(suppliersDocs)
  const customersCol = makeCloudCollection([]) // Customers handled by SQLite

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
        if (name === 'suppliers') return suppliersCol
        if (name === 'customers') return customersCol
        throw new Error(`unexpected collection: ${name}`)
      }
    }
  }))

  // Import Customer model to seed data
  const { sequelize } = await import('../src/utils/sqliteDatabase.js')
  const { default: Customer } = await import('../src/models/local/Customer.js')
  
  // Sync DB
  await sequelize.sync({ force: true })
  
  // Seed Customers
  await Customer.bulkCreate([
    { 
      // Sequelize uses id (integer) as PK, but we might have cloudId or just ignore PK for list tests
      // The current Customer model has id (autoIncrement) and cloudId
      // Let's use name to match
      name: 'Target Customer 1', 
      status: 'active',
      contactPerson: 'Contact 1',
      phone: '12345678901',
      customerCode: 'C001'
    },
    { 
      name: 'Target Customer 2', 
      status: 'active',
      contactPerson: 'Contact 2',
      phone: '12345678902',
      customerCode: 'C002'
    },
    { 
      name: 'Other Customer',
      status: 'active',
      contactPerson: 'Contact 3',
      phone: '12345678903',
      customerCode: 'C003'
    }
  ])

  const suppliersRoutes = (await import('../src/routes/suppliers.js')).default
  const customersRoutes = (await import('../src/routes/customers.js')).default

  const app = express()
  app.use(express.json())
  app.use('/api/suppliers', suppliersRoutes)
  app.use('/api/customers', customersRoutes)

  return { app, sequelize }
}

describe('Visibility of restored records', () => {
  let app
  let sequelizeInstance

  beforeEach(async () => {
    const built = await buildTestApp()
    app = built.app
    sequelizeInstance = built.sequelize
  })

  afterEach(async () => {
    if (sequelizeInstance) {
      await sequelizeInstance.close()
    }
  })

  afterAll(async () => {
    if (fs.existsSync(DB_PATH)) {
      try {
        // Wait a bit for file handles to close
        await new Promise(resolve => setTimeout(resolve, 500))
        fs.unlinkSync(DB_PATH)
      } catch (e) {
        console.warn('Failed to cleanup test DB:', e.message)
      }
    }
  })

  test('GET /api/suppliers returns the target supplier', async () => {
    const res = await request(app).get('/api/suppliers')
    expect(res.status).toBe(200)
    const names = res.body.data.map(d => d.name)
    expect(names).toContain('昆山美泰纸业有限公司')
  })

  test('GET /api/customers returns the target customers', async () => {
    const res = await request(app).get('/api/customers')
    expect(res.status).toBe(200)
    // Customers route returns { data: { customers: [...] } }
    const customers = res.body.data.customers || res.body.data
    const names = customers.map(d => d.name)
    expect(names).toContain('Target Customer 1')
    expect(names).toContain('Target Customer 2')
  })
})
