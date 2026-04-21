describe('utils/cloud-sync', () => {
  const makeWxStorage = () => {
    const store = new Map()
    return {
      store,
      getStorageSync: (key) => store.get(String(key)),
      setStorageSync: (key, value) => store.set(String(key), value),
      removeStorageSync: (key) => store.delete(String(key))
    }
  }

  const makeWx = (opts = {}) => {
    const storage = makeWxStorage()
    const state = {
      networkType: opts.networkType || 'wifi',
      modalConfirm: opts.modalConfirm !== undefined ? Boolean(opts.modalConfirm) : true,
      callFunction: opts.callFunction || (async () => ({ result: { success: true, data: {} } })),
      throwOnSetStorage: Boolean(opts.throwOnSetStorage)
    }

    return {
      ...storage,
      getNetworkType: async () => ({ networkType: state.networkType }),
      setStorageSync: (key, value) => {
        if (state.throwOnSetStorage) {
          throw new Error('setStorageSync failed')
        }
        storage.setStorageSync(key, value)
      },
      showModal: ({ success, fail }) => {
        try {
          success && success({ confirm: state.modalConfirm })
        } catch (e) {
          fail && fail(e)
        }
      },
      showToast: () => {},
      cloud: {
        callFunction: async (params) => state.callFunction(params)
      }
    }
  }

  beforeEach(() => {
    jest.resetModules()
    global.wx = makeWx()
  })

  test('syncNow 离线时写入队列并返回 skipped', async () => {
    global.wx = makeWx({ networkType: 'none' })
    const localStore = require('../../../../utils/local-store')
    const cloudSync = require('../../../../utils/cloud-sync')

    localStore.upsertLocal('orders', { _id: 'o1', value: 1 }, { localModifyTime: 200, cloudModifyTime: 10 })
    const res = await cloudSync.syncNow({ collections: ['orders'] })

    expect(res.success).toBe(false)
    expect(res.skipped).toBe(true)
    const q = localStore.readQueue()
    expect(q.length).toBeGreaterThan(0)
    expect(q[0].collection).toBe('orders')
  })

  test('syncNow 在线且无变更返回 uploaded=0', async () => {
    const callFunction = async () => {
      throw new Error('should not be called')
    }
    global.wx = makeWx({ networkType: 'wifi', callFunction })
    const cloudSync = require('../../../../utils/cloud-sync')

    const res = await cloudSync.syncNow({ collections: ['orders'] })
    expect(res.success).toBe(true)
    expect(res.uploaded).toBe(0)
  })

  test('pullAllCloudData 合并云端数据到本地', async () => {
    const callFunction = async ({ name, data }) => {
      if (name !== 'user-backup') throw new Error('unexpected function')
      if (data.action !== 'pullAll') throw new Error('unexpected action')
      return {
        result: {
          success: true,
          data: {
            serverTime: 999,
            collections: [
              {
                name: 'orders',
                items: [{ _id: 'o10', updatedAt: '2026-01-01T00:00:00.000Z', value: 10 }]
              }
            ]
          }
        }
      }
    }
    global.wx = makeWx({ networkType: 'wifi', callFunction })
    const localStore = require('../../../../utils/local-store')
    const cloudSync = require('../../../../utils/cloud-sync')

    const res = await cloudSync.pullAllCloudData({ collections: ['orders'] })
    expect(res.success).toBe(true)
    expect(localStore.listLocal('orders').length).toBe(1)
    expect(localStore.getLocalById('orders', 'o10').value).toBe(10)
  })

  test('pullAllCloudData 离线抛出 NETWORK_OFFLINE', async () => {
    global.wx = makeWx({ networkType: 'none' })
    const cloudSync = require('../../../../utils/cloud-sync')
    await expect(cloudSync.pullAllCloudData({ collections: ['orders'] })).rejects.toMatchObject({ code: 'NETWORK_OFFLINE' })
  })

  test('pullAllCloudData 云端返回失败触发重试并最终抛错', async () => {
    jest.useFakeTimers()
    let n = 0
    const callFunction = async () => {
      n += 1
      return { result: { success: false, message: `fail_${n}` } }
    }
    global.wx = makeWx({ networkType: 'wifi', callFunction })
    const cloudSync = require('../../../../utils/cloud-sync')

    const p = cloudSync.pullAllCloudData({ collections: ['orders'], onProgress: () => { throw new Error('ignore') } })
    const assertion = expect(p).rejects.toThrow('fail_3')
    await jest.runAllTimersAsync()
    await assertion
    jest.useRealTimers()
  })

  test('pullAllCloudData 本地不脏且云端更新时覆盖本地', async () => {
    const callFunction = async () => ({
      result: {
        success: true,
        data: {
          collections: [
            {
              name: 'orders',
              items: [{ _id: 'o1', updatedAt: '2026-02-01T00:00:00.000Z', value: 'cloud' }]
            }
          ]
        }
      }
    })
    global.wx = makeWx({ networkType: 'wifi', callFunction })
    const localStore = require('../../../../utils/local-store')
    const cloudSync = require('../../../../utils/cloud-sync')

    localStore.upsertLocal('orders', { _id: 'o1', value: 'local' }, { localModifyTime: 10, cloudModifyTime: 20 })
    await cloudSync.pullAllCloudData({ collections: ['orders'] })
    expect(localStore.getLocalById('orders', 'o1').value).toBe('cloud')
  })

  test('pullAllCloudData 本地脏且云端更新时可选择保留本地', async () => {
    const callFunction = async () => ({
      result: {
        success: true,
        data: {
          collections: [
            {
              name: 'orders',
              items: [{ _id: 'o1', updatedAt: '2026-02-01T00:00:00.000Z', value: 'cloud' }]
            }
          ]
        }
      }
    })
    global.wx = makeWx({ networkType: 'wifi', callFunction, modalConfirm: true })
    const localStore = require('../../../../utils/local-store')
    const cloudSync = require('../../../../utils/cloud-sync')

    localStore.upsertLocal('orders', { _id: 'o1', value: 'local' }, { localModifyTime: 30, cloudModifyTime: 10 })
    await cloudSync.pullAllCloudData({ collections: ['orders'] })
    expect(localStore.getLocalById('orders', 'o1').value).toBe('local')
  })

  test('syncNow 在线上传 applied 后更新 cloudModifyTime 并清空队列', async () => {
    const now = Date.now()
    const callFunction = async ({ data }) => {
      if (data.action !== 'pushChanges') throw new Error('unexpected action')
      return {
        result: {
          success: true,
          data: {
            applied: [{ collection: 'orders', id: 'o1', cloudModifyTime: now + 1000 }],
            conflicts: []
          }
        }
      }
    }
    global.wx = makeWx({ networkType: 'wifi', callFunction })
    const localStore = require('../../../../utils/local-store')
    const cloudSync = require('../../../../utils/cloud-sync')

    localStore.upsertLocal('orders', { _id: 'o1', value: 1 }, { localModifyTime: now + 10, cloudModifyTime: now })
    localStore.enqueue({ op: 'upsert', collection: 'orders', id: 'o1', localModifyTime: now + 10, cloudModifyTime: now })

    const res = await cloudSync.syncNow({ collections: ['orders'] })
    expect(res.success).toBe(true)
    expect(res.uploaded).toBe(1)

    const item = localStore.getLocalById('orders', 'o1')
    expect(item.cloudModifyTime).toBe(now + 1000)
    expect(localStore.readQueue().length).toBe(0)
  })

  test('syncNow 兼容 cloudFunction 不包 result 字段', async () => {
    const now = Date.now()
    const callFunction = async () => ({
      success: true,
      data: {
        applied: [{ collection: 'orders', id: 'o1', cloudModifyTime: now + 1000 }],
        conflicts: []
      }
    })
    global.wx = makeWx({ networkType: 'wifi', callFunction })
    const localStore = require('../../../../utils/local-store')
    const cloudSync = require('../../../../utils/cloud-sync')

    localStore.upsertLocal('orders', { _id: 'o1', value: 1 }, { localModifyTime: now + 10, cloudModifyTime: now })
    const res = await cloudSync.syncNow({ collections: ['orders'] })
    expect(res.success).toBe(true)
    expect(localStore.getLocalById('orders', 'o1').cloudModifyTime).toBe(now + 1000)
  })

  test('syncNow 冲突时选择云端覆盖本地', async () => {
    const callFunction = async () => ({
      result: {
        success: true,
        data: {
          applied: [],
          conflicts: [
            {
              collection: 'orders',
              id: 'o2',
              local: { _id: 'o2', value: 'local', localModifyTime: 200, cloudModifyTime: 10 },
              cloud: { _id: 'o2', value: 'cloud', updatedAt: '2026-01-03T00:00:00.000Z' }
            }
          ]
        }
      }
    })
    global.wx = makeWx({ networkType: 'wifi', callFunction, modalConfirm: false })
    const localStore = require('../../../../utils/local-store')
    const cloudSync = require('../../../../utils/cloud-sync')

    localStore.upsertLocal('orders', { _id: 'o2', value: 'local' }, { localModifyTime: 200, cloudModifyTime: 10 })
    const res = await cloudSync.syncNow({ collections: ['orders'] })
    expect(res.success).toBe(true)
    expect(res.conflicts).toBe(1)
    expect(localStore.getLocalById('orders', 'o2').value).toBe('cloud')
  })

  test('syncNow 冲突时选择保留本地不覆盖', async () => {
    const callFunction = async () => ({
      result: {
        success: true,
        data: {
          applied: [],
          conflicts: [
            {
              collection: 'orders',
              id: 'o3',
              local: { _id: 'o3', value: 'local', localModifyTime: 200, cloudModifyTime: 10 },
              cloud: { _id: 'o3', value: 'cloud', updatedAt: '2026-01-03T00:00:00.000Z' }
            }
          ]
        }
      }
    })
    global.wx = makeWx({ networkType: 'wifi', callFunction, modalConfirm: true })
    const localStore = require('../../../../utils/local-store')
    const cloudSync = require('../../../../utils/cloud-sync')

    localStore.upsertLocal('orders', { _id: 'o3', value: 'local' }, { localModifyTime: 200, cloudModifyTime: 10 })
    const res = await cloudSync.syncNow({ collections: ['orders'] })
    expect(res.success).toBe(true)
    expect(res.conflicts).toBe(1)
    expect(localStore.getLocalById('orders', 'o3').value).toBe('local')
  })

  test('exportEncryptedBackup 定时模式非 Wi-Fi 直接跳过', async () => {
    global.wx = makeWx({ networkType: '4g' })
    const cloudSync = require('../../../../utils/cloud-sync')

    const res = await cloudSync.exportEncryptedBackup({ backupConfig: { mode: 'schedule' }, collections: ['orders'] })
    expect(res.success).toBe(false)
    expect(res.skipped).toBe(true)
  })

  test('exportEncryptedBackup 成功时写入 lastBackupMeta', async () => {
    const callFunction = async ({ data }) => {
      if (data.action !== 'exportEncryptedBackup') throw new Error('unexpected action')
      return { result: { success: true, data: { timestamp: 123, size: 456, fileID: 'cloud://file/x' } } }
    }
    global.wx = makeWx({ networkType: 'wifi', callFunction })
    const cloudSync = require('../../../../utils/cloud-sync')

    const res = await cloudSync.exportEncryptedBackup({ backupConfig: { mode: 'manual' }, collections: [] })
    expect(res.success).toBe(true)
    expect(global.wx.getStorageSync('lastBackupMeta').fileID).toBe('cloud://file/x')
  })

  test('exportEncryptedBackup 网络类型获取失败仍可继续', async () => {
    const callFunction = async () => ({ result: { success: true, data: { fileID: 'cloud://file/y' } } })
    global.wx = makeWx({ networkType: 'wifi', callFunction })
    global.wx.getNetworkType = async () => {
      throw new Error('network failed')
    }
    const cloudSync = require('../../../../utils/cloud-sync')

    const res = await cloudSync.exportEncryptedBackup({ backupConfig: { mode: 'manual' }, collections: [] })
    expect(res.success).toBe(true)
  })

  test('exportEncryptedBackup 云端失败时抛错（触发重试分支）', async () => {
    jest.useFakeTimers()
    const callFunction = async () => ({ result: { success: false, message: 'fail' } })
    global.wx = makeWx({ networkType: 'wifi', callFunction })
    const cloudSync = require('../../../../utils/cloud-sync')

    const p = cloudSync.exportEncryptedBackup({ backupConfig: { mode: 'manual' }, collections: [] })
    const assertion = expect(p).rejects.toThrow('fail')
    await jest.runAllTimersAsync()
    await assertion
    jest.useRealTimers()
  })

  test('exportEncryptedBackup 写 storage 失败仍返回成功', async () => {
    const callFunction = async () => ({ result: { success: true, data: { fileID: 'cloud://file/x' } } })
    global.wx = makeWx({ networkType: 'wifi', callFunction, throwOnSetStorage: true })
    const cloudSync = require('../../../../utils/cloud-sync')

    const res = await cloudSync.exportEncryptedBackup({ backupConfig: { mode: 'manual' }, collections: [] })
    expect(res.success).toBe(true)
  })
})
