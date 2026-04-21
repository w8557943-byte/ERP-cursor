describe('utils/cloud-sync enqueue helpers', () => {
  const makeWx = () => {
    const store = new Map()
    return {
      getStorageSync: (k) => store.get(String(k)),
      setStorageSync: (k, v) => store.set(String(k), v),
      removeStorageSync: (k) => store.delete(String(k)),
      getNetworkType: async () => ({ networkType: 'wifi' }),
      showModal: ({ success }) => success && success({ confirm: true }),
      showToast: () => {},
      cloud: { callFunction: async () => ({ result: { success: true, data: {} } }) }
    }
  }

  beforeEach(() => {
    jest.resetModules()
    global.wx = makeWx()
  })

  test('enqueueUpsert/enqueueDelete 参数不合法返回 null', () => {
    const cloudSync = require('../../../../utils/cloud-sync')
    expect(cloudSync.enqueueUpsert('', { _id: 'x' })).toBe(null)
    expect(cloudSync.enqueueUpsert('orders', null)).toBe(null)
    expect(cloudSync.enqueueDelete('', 'x')).toBe(null)
    expect(cloudSync.enqueueDelete('orders', '')).toBe(null)
  })

  test('enqueueUpsert/enqueueDelete 写入本地与队列', () => {
    const localStore = require('../../../../utils/local-store')
    const cloudSync = require('../../../../utils/cloud-sync')

    const id = cloudSync.enqueueUpsert('orders', { _id: 'o1', value: 1, updatedAt: '2026-01-01T00:00:00.000Z' })
    expect(id).toBe('o1')
    expect(localStore.getLocalById('orders', 'o1').value).toBe(1)
    expect(localStore.readQueue().length).toBe(1)

    const rid = cloudSync.enqueueDelete('orders', 'o1')
    expect(rid).toBe('o1')
    expect(localStore.getLocalById('orders', 'o1')).toBe(null)
    expect(localStore.readQueue().length).toBe(2)
  })

  test('isNetworkAvailable/isWifi getNetworkType 异常时返回 false', async () => {
    const cloudSync = require('../../../../utils/cloud-sync')
    global.wx.getNetworkType = async () => {
      throw new Error('boom')
    }
    await expect(cloudSync.isNetworkAvailable()).resolves.toBe(false)
    await expect(cloudSync.isWifi()).resolves.toBe(false)
  })
})
