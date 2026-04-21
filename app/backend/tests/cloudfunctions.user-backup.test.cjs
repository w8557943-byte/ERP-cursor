describe('cloudfunctions/user-backup', () => {
  const makeDb = () => {
    const store = new Map()
    const backups = []

    const getCollKey = (name) => String(name)
    const ensureColl = (name) => {
      const key = getCollKey(name)
      if (!store.has(key)) store.set(key, new Map())
      return store.get(key)
    }

    const collection = (name) => {
      const collName = String(name)
      const coll = ensureColl(collName)
      let whereQuery = null
      let skipN = 0
      let limitN = 100

      const query = {
        where: (q) => {
          whereQuery = q && typeof q === 'object' ? q : null
          return query
        },
        skip: (n) => {
          skipN = Number(n || 0)
          return query
        },
        limit: (n) => {
          limitN = Number(n || 0)
          return query
        },
        get: async () => {
          const all = Array.from(coll.values())
          const filtered = whereQuery && whereQuery._openid
            ? all.filter((x) => x && x._openid === whereQuery._openid)
            : all
          const page = filtered.slice(skipN, skipN + limitN)
          return { data: page }
        },
        doc: (id) => ({
          get: async () => {
            const rid = String(id)
            if (!coll.has(rid)) throw new Error('not found')
            return { data: coll.get(rid) }
          },
          set: async ({ data }) => {
            const d = data && typeof data === 'object' ? data : {}
            coll.set(String(id), d)
            return { stats: { updated: 1 } }
          },
          remove: async () => {
            coll.delete(String(id))
            return { stats: { removed: 1 } }
          }
        }),
        add: async ({ data }) => {
          if (collName === 'userBackup') {
            backups.push(data)
          }
          const newId = `id_${Math.random().toString(16).slice(2)}`
          coll.set(newId, { ...data, _id: newId })
          return { _id: newId }
        }
      }

      query._raw = { store, backups }
      return query
    }

    const serverDate = () => new Date()
    return { collection, serverDate, _raw: { store, backups } }
  }

  const makeCloudMock = (db) => {
    const wxContext = { OPENID: 'o_test_openid' }
    const uploads = []
    const cloud = {
      DYNAMIC_CURRENT_ENV: 'test',
      init: jest.fn(),
      database: () => db,
      getWXContext: () => wxContext,
      uploadFile: jest.fn(async ({ cloudPath, fileContent }) => {
        uploads.push({ cloudPath, fileContent })
        return { fileID: `cloud://file/${cloudPath}` }
      })
    }
    cloud._raw = { wxContext, uploads }
    return cloud
  }

  beforeEach(() => {
    jest.resetModules()
    jest.clearAllMocks()
    process.env.BACKUP_AES_KEY = 'test-key'
  })

  test('pullAll 拉取当前用户数据并带 cloudModifyTime', async () => {
    const db = makeDb()
    const cloud = makeCloudMock(db)

    jest.doMock('wx-server-sdk', () => cloud, { virtual: true })

    const fn = require('../../../cloudfunctions/user-backup/index.js')

    await db.collection('orders').doc('o1').set({
      data: { _id: 'o1', _openid: 'o_test_openid', updatedAt: '2026-01-01T00:00:00.000Z' }
    })
    await db.collection('orders').doc('o2').set({
      data: { _id: 'o2', _openid: 'o_other', updatedAt: '2026-01-02T00:00:00.000Z' }
    })

    const res = await fn.main({ action: 'pullAll', collections: ['orders'] }, {})
    expect(res.success).toBe(true)
    expect(res.data.collections.length).toBe(1)
    const items = res.data.collections[0].items
    expect(items.length).toBe(1)
    expect(items[0]._id).toBe('o1')
    expect(typeof items[0].cloudModifyTime).toBe('number')
    expect(items[0].cloudModifyTime).toBeGreaterThan(0)
  })

  test('pushChanges upsert 写入并返回 applied', async () => {
    const db = makeDb()
    const cloud = makeCloudMock(db)
    jest.doMock('wx-server-sdk', () => cloud, { virtual: true })
    const fn = require('../../../cloudfunctions/user-backup/index.js')

    const res = await fn.main({
      action: 'pushChanges',
      changes: [
        {
          op: 'upsert',
          collection: 'orders',
          id: 'o100',
          data: { _id: 'o100', foo: 1 },
          localModifyTime: Date.now(),
          cloudModifyTime: 0
        }
      ]
    }, {})

    expect(res.success).toBe(true)
    expect(res.data.applied.length).toBe(1)
    const stored = await db.collection('orders').doc('o100').get()
    expect(stored.data._openid).toBe('o_test_openid')
    expect(typeof stored.data.cloudModifyTime).toBe('number')
  })

  test('pushChanges delete 删除远端记录并返回 applied', async () => {
    const db = makeDb()
    const cloud = makeCloudMock(db)
    jest.doMock('wx-server-sdk', () => cloud, { virtual: true })
    const fn = require('../../../cloudfunctions/user-backup/index.js')

    await db.collection('orders').doc('o_del').set({
      data: { _id: 'o_del', _openid: 'o_test_openid', cloudModifyTime: 1 }
    })

    const res = await fn.main({
      action: 'pushChanges',
      changes: [{ op: 'delete', collection: 'orders', id: 'o_del' }]
    }, {})

    expect(res.success).toBe(true)
    expect(res.data.applied.length).toBe(1)
  })

  test('pushChanges 无权限操作返回 PERMISSION_DENIED', async () => {
    const db = makeDb()
    const cloud = makeCloudMock(db)
    jest.doMock('wx-server-sdk', () => cloud, { virtual: true })
    const fn = require('../../../cloudfunctions/user-backup/index.js')

    await db.collection('orders').doc('o_forbid').set({
      data: { _id: 'o_forbid', _openid: 'o_other', cloudModifyTime: 1 }
    })

    const res = await fn.main({
      action: 'pushChanges',
      changes: [{ op: 'delete', collection: 'orders', id: 'o_forbid' }]
    }, {})

    expect(res.success).toBe(false)
    expect(res.errorCode).toBe('PERMISSION_DENIED')
  })

  test('pushChanges 检测冲突并返回 conflicts', async () => {
    const db = makeDb()
    const cloud = makeCloudMock(db)
    jest.doMock('wx-server-sdk', () => cloud, { virtual: true })
    const fn = require('../../../cloudfunctions/user-backup/index.js')

    await db.collection('orders').doc('o200').set({
      data: { _id: 'o200', _openid: 'o_test_openid', cloudModifyTime: Date.now() + 5000, value: 'server' }
    })

    const res = await fn.main({
      action: 'pushChanges',
      changes: [
        {
          op: 'upsert',
          collection: 'orders',
          id: 'o200',
          data: { _id: 'o200', value: 'local' },
          localModifyTime: Date.now() + 4000,
          cloudModifyTime: 1
        }
      ]
    }, {})

    expect(res.success).toBe(true)
    expect(res.data.conflicts.length).toBe(1)
    expect(res.data.applied.length).toBe(0)
  })

  test('exportEncryptedBackup 写入 userBackup 记录并上传文件', async () => {
    const db = makeDb()
    const cloud = makeCloudMock(db)
    jest.doMock('wx-server-sdk', () => cloud, { virtual: true })
    const fn = require('../../../cloudfunctions/user-backup/index.js')

    const res = await fn.main({
      action: 'exportEncryptedBackup',
      snapshot: { timestamp: 123, collections: { orders: [{ _id: 'x' }] } }
    }, {})

    expect(res.success).toBe(true)
    expect(res.data.fileID).toContain('cloud://file/userBackup/')
    expect(cloud.uploadFile).toHaveBeenCalled()
    expect(db._raw.backups.length).toBe(1)
  })

  test('exportEncryptedBackup snapshot 为空返回 INVALID_SNAPSHOT', async () => {
    const db = makeDb()
    const cloud = makeCloudMock(db)
    jest.doMock('wx-server-sdk', () => cloud, { virtual: true })
    const fn = require('../../../cloudfunctions/user-backup/index.js')

    const res = await fn.main({ action: 'exportEncryptedBackup' }, {})
    expect(res.success).toBe(false)
    expect(res.errorCode).toBe('INVALID_SNAPSHOT')
  })

  test('exportEncryptedBackup 上传失败返回 UPLOAD_FAILED', async () => {
    const db = makeDb()
    const cloud = makeCloudMock(db)
    cloud.uploadFile = jest.fn(async () => ({ fileID: '' }))
    jest.doMock('wx-server-sdk', () => cloud, { virtual: true })
    const fn = require('../../../cloudfunctions/user-backup/index.js')

    const res = await fn.main({
      action: 'exportEncryptedBackup',
      snapshot: { timestamp: 1, collections: {} }
    }, {})

    expect(res.success).toBe(false)
    expect(res.errorCode).toBe('UPLOAD_FAILED')
  })

  test('collection 不允许返回 COLLECTION_NOT_ALLOWED', async () => {
    const db = makeDb()
    const cloud = makeCloudMock(db)
    jest.doMock('wx-server-sdk', () => cloud, { virtual: true })
    const fn = require('../../../cloudfunctions/user-backup/index.js')

    const res = await fn.main({ action: 'pullAll', collections: ['not_allowed'] }, {})
    expect(res.success).toBe(false)
    expect(res.errorCode).toBe('COLLECTION_NOT_ALLOWED')
  })

  test('缺少 openid 返回 MISSING_OPENID', async () => {
    const db = makeDb()
    const cloud = makeCloudMock(db)
    cloud.getWXContext = () => ({ OPENID: '' })
    jest.doMock('wx-server-sdk', () => cloud, { virtual: true })
    const fn = require('../../../cloudfunctions/user-backup/index.js')

    const res = await fn.main({ action: 'pullAll', collections: ['orders'] }, {})
    expect(res.success).toBe(false)
    expect(res.errorCode).toBe('MISSING_OPENID')
  })

  test('未知 action 返回 success=false', async () => {
    const db = makeDb()
    const cloud = makeCloudMock(db)
    jest.doMock('wx-server-sdk', () => cloud, { virtual: true })
    const fn = require('../../../cloudfunctions/user-backup/index.js')

    const res = await fn.main({ action: 'nope' }, {})
    expect(res.success).toBe(false)
    expect(res.message).toContain('未知 action')
  })
})
