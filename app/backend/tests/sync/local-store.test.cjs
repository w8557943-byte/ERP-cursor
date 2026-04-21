describe('utils/local-store', () => {
  const makeWxStorage = () => {
    const store = new Map()
    return {
      store,
      getStorageSync: (key) => store.get(String(key)),
      setStorageSync: (key, value) => store.set(String(key), value),
      removeStorageSync: (key) => store.delete(String(key))
    }
  }

  beforeEach(() => {
    jest.resetModules()
    const wxStorage = makeWxStorage()
    global.wx = wxStorage
  })

  test('upsertLocal 写入记录并标记 dirty', () => {
    const localStore = require('../../../../utils/local-store')

    const res = localStore.upsertLocal('orders', { _id: 'o1', value: 1 }, { localModifyTime: 100, cloudModifyTime: 10 })
    expect(res.ok).toBe(true)

    const item = localStore.getLocalById('orders', 'o1')
    expect(item._id).toBe('o1')
    expect(item.value).toBe(1)
    expect(item.localModifyTime).toBe(100)
    expect(item.cloudModifyTime).toBe(10)

    const meta = localStore.getCollectionMeta('orders')
    expect(meta.dirtyFlag).toBe(true)
  })

  test('setCollectionSyncTime 清除 dirty 并更新 lastSyncTime', () => {
    const localStore = require('../../../../utils/local-store')

    localStore.upsertLocal('orders', { _id: 'o1', value: 1 }, { localModifyTime: 100, cloudModifyTime: 10 })
    localStore.setCollectionSyncTime('orders', 1234)

    const meta = localStore.getCollectionMeta('orders')
    expect(meta.dirtyFlag).toBe(false)
    expect(meta.lastSyncTime).toBe(1234)
  })

  test('removeLocal 删除并返回 tombstone', () => {
    const localStore = require('../../../../utils/local-store')

    localStore.upsertLocal('orders', { _id: 'o1', value: 1 }, { localModifyTime: 100, cloudModifyTime: 10 })
    const res = localStore.removeLocal('orders', 'o1', { localModifyTime: 200, cloudModifyTime: 10 })
    expect(res.ok).toBe(true)
    expect(res.removed).toBe(true)
    expect(res.tombstone.deleted).toBe(true)

    const item = localStore.getLocalById('orders', 'o1')
    expect(item).toBe(null)
  })

  test('removeLocal 删除不存在记录返回 removed=false', () => {
    const localStore = require('../../../../utils/local-store')

    const res = localStore.removeLocal('orders', 'missing', { localModifyTime: 1, cloudModifyTime: 0 })
    expect(res.ok).toBe(true)
    expect(res.removed).toBe(false)
  })

  test('queue 支持 enqueue/read/clear', () => {
    const localStore = require('../../../../utils/local-store')

    localStore.enqueue({ op: 'upsert', collection: 'orders', id: 'o1' })
    localStore.enqueue({ op: 'delete', collection: 'orders', id: 'o2' })
    const q = localStore.readQueue()
    expect(q.length).toBe(2)

    localStore.clearQueue()
    expect(localStore.readQueue().length).toBe(0)
  })

  test('storage 异常时安全降级', () => {
    const localStore = require('../../../../utils/local-store')

    global.wx.getStorageSync = () => {
      throw new Error('boom')
    }
    global.wx.setStorageSync = () => {
      throw new Error('boom')
    }
    global.wx.removeStorageSync = () => {
      throw new Error('boom')
    }

    const meta = localStore.getMeta()
    expect(meta && typeof meta === 'object').toBe(true)

    const res = localStore.upsertLocal('orders', { _id: 'o1', value: 1 })
    expect(res.ok).toBe(false)
  })
})
