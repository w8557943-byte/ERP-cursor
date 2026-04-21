import { jest } from '@jest/globals'
import path from 'path'
import os from 'os'

const DB_PATH = path.join(os.tmpdir(), `order_number_test_${Date.now()}.sqlite`)

jest.setTimeout(60000)

describe('Order Number Service (SQLite)', () => {
  let orderNumberService
  let OrderSequence
  let OrderReservation
  let sequelize
  
  beforeEach(async () => {
    jest.resetModules()
    process.env.NODE_ENV = 'test'
    process.env.USE_SQLITE = 'true'
    process.env.SQLITE_DB_PATH = DB_PATH
    delete process.env.MONGODB_URI
    delete process.env.ORDER_NO_ALGO
    delete process.env.SNOWFLAKE_MACHINE_ID

    const dbModule = await import('../src/utils/sqliteDatabase.js')
    sequelize = dbModule.sequelize
    await dbModule.syncDatabase(true)

    orderNumberService = (await import('../src/services/orderNumberService.js')).default
    OrderSequence = (await import('../src/models/local/OrderSequence.js')).default
    OrderReservation = (await import('../src/models/local/OrderReservation.js')).default
  })

  afterAll(async () => {
    if (sequelize) {
      try {
        await sequelize.close()
      } catch (_) { void 0 }
    }
  })

  it('Concurrent generation of order numbers should be unique', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => orderNumberService.generateOrderNumber())
    )

    const orderNos = results.map(r => r.orderNo)
    expect(orderNos).toHaveLength(10)
    expect(new Set(orderNos).size).toBe(10)

    const reserved = await OrderReservation.findAll({ where: { status: 'RESERVED' } })
    expect(reserved).toHaveLength(10)
  })

  it('Snowflake mode should generate unique and valid IDs', async () => {
    process.env.ORDER_NO_ALGO = 'snowflake'
    process.env.SNOWFLAKE_MACHINE_ID = '1'

    const batch = 10
    const results = await Promise.all(
      Array.from({ length: batch }, () => orderNumberService.generateOrderNumber())
    )

    const orderNos = results.map(r => r.orderNo)
    expect(orderNos).toHaveLength(batch)
    expect(new Set(orderNos).size).toBe(batch)
    expect(orderNos.every(no => String(no).startsWith('QXDD'))).toBe(true)

    const reserved = await OrderReservation.findAll({ where: { status: 'RESERVED' } })
    expect(reserved).toHaveLength(batch)
  })

  it('Confirm and Release should update reservation status correctly', async () => {
    const a = await orderNumberService.generateOrderNumber()
    await orderNumberService.confirmOrderNumber(a.orderNo)
    
    const used = await OrderReservation.findOne({ where: { orderNo: a.orderNo } })
    expect(used?.status).toBe('USED')

    const b = await orderNumberService.generateOrderNumber()
    await orderNumberService.releaseOrderNumber({ orderNo: b.orderNo })
    
    const released = await OrderReservation.findOne({ where: { orderNo: b.orderNo } })
    expect(released?.status).toBe('RELEASED')
  })

  it('ensureSequenceAtLeast should advance sequence but not rollback', async () => {
    const first = await orderNumberService.generateOrderNumber()
    const dateKeyMatch = String(first.orderNo).match(/^QXDD(\d{8})/)
    const dateKey = dateKeyMatch ? dateKeyMatch[1] : ''
    expect(dateKey).toMatch(/^\d{8}$/)

    const [seqDoc] = await OrderSequence.findOrCreate({ where: { date: dateKey } })
    seqDoc.seq = 5
    await seqDoc.save()

    await orderNumberService.ensureSequenceAtLeast(dateKey, 3)
    const afterNoRollback = await OrderSequence.findOne({ where: { date: dateKey } })
    expect(afterNoRollback?.seq).toBe(5)

    await orderNumberService.ensureSequenceAtLeast(dateKey, 12)
    const afterBump = await OrderSequence.findOne({ where: { date: dateKey } })
    expect(afterBump?.seq).toBe(12)
  })
})
