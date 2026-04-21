jest.mock(
  'wx-server-sdk',
  () => {
    const mockDb = { command: {} }
    return {
      init: jest.fn(),
      database: jest.fn(() => mockDb),
      DYNAMIC_CURRENT_ENV: 'test'
    }
  },
  { virtual: true }
)

describe('纸板采购明细归一化', () => {
  it('保留带纸板扩展字段的条目，即使没有 name', () => {
    const apiBridge = require('../../../cloudfunctions/api-bridge/index.js')
    const normalize = apiBridge?.__test?.normalizeOrderItemsForCreate
    expect(typeof normalize).toBe('function')

    const items = normalize({
      unitPrice: 0,
      items: [{
        goodsName: '纸板',
        materialCode: 'K5K5',
        flute: 'B',
        specWidth: '1000',
        specLength: '2000',
        quantity: 120,
        relatedOrderNo: 'QXDD20260118003',
        relatedOrderId: 'order_1'
      }]
    })

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({
      name: '纸板',
      materialCode: 'K5K5',
      flute: 'B',
      specWidth: '1000',
      specLength: '2000',
      quantity: 120,
      relatedOrderNo: 'QXDD20260118003',
      relatedOrderId: 'order_1'
    })
  })

  it('不合并多条采购明细，保留每条 quantity', () => {
    const apiBridge = require('../../../cloudfunctions/api-bridge/index.js')
    const normalize = apiBridge?.__test?.normalizeOrderItemsForCreate

    const items = normalize({
      items: [
        { goodsName: '纸板', materialCode: 'K5K5', flute: 'B', specWidth: '900', specLength: '1800', quantity: 100, relatedOrderNo: 'QXDD1' },
        { goodsName: '纸板', materialCode: 'K3K3', flute: 'E', specWidth: '1100', specLength: '2100', quantity: 300, relatedOrderNo: 'QXDD2' }
      ]
    })

    expect(items).toHaveLength(2)
    expect(items.map((x) => x.quantity)).toEqual([100, 300])
    expect(items.map((x) => x.relatedOrderNo)).toEqual(['QXDD1', 'QXDD2'])
  })

  it('过滤掉既无名称也无扩展字段的无效条目', () => {
    const apiBridge = require('../../../cloudfunctions/api-bridge/index.js')
    const normalize = apiBridge?.__test?.normalizeOrderItemsForCreate

    const items = normalize({
      items: [
        { quantity: 10 },
        { name: '-', quantity: 5 },
        { goodsName: '纸板', quantity: 0, materialCode: 'K5K5' }
      ]
    })

    expect(items).toHaveLength(0)
  })
})
