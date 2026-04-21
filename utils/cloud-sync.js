const { DEFAULT_SYNC_COLLECTIONS } = require('./sync-collections')
const localStore = require('./local-store')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const isNetworkAvailable = async () => {
  try {
    const res = await wx.getNetworkType()
    const t = res && res.networkType ? String(res.networkType) : 'unknown'
    return t !== 'none'
  } catch (_) {
    return false
  }
}

const isWifi = async () => {
  try {
    const res = await wx.getNetworkType()
    const t = res && res.networkType ? String(res.networkType) : 'unknown'
    return t === 'wifi'
  } catch (_) {
    return false
  }
}

const withRetry = async (fn, options = {}) => {
  const retries = Number.isFinite(Number(options.retries)) ? Number(options.retries) : 3
  const baseDelayMs = Number.isFinite(Number(options.baseDelayMs)) ? Number(options.baseDelayMs) : 400
  let lastErr
  for (let i = 0; i < Math.max(1, retries); i += 1) {
    try {
      return await fn(i)
    } catch (e) {
      lastErr = e
      const delay = baseDelayMs * Math.pow(2, i)
      await sleep(delay)
    }
  }
  throw lastErr
}

const toTs = (v) => {
  if (!v) return 0
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0
  if (v instanceof Date) return v.getTime()
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isFinite(t) ? t : 0
  }
  return 0
}

const computeCloudModifyTime = (record) => {
  if (!record || typeof record !== 'object') return 0
  const v =
    record.cloudModifyTime ??
    record.cloud_modify_time ??
    record.updatedAt ??
    record.updateTime ??
    record.modifiedAt ??
    record._updateTime ??
    record._createTime ??
    record.createdAt
  return toTs(v)
}

const resolveConflictModal = async (collection, localRec, cloudRec) => {
  const title = '数据冲突'
  const content = `检测到${collection}存在双向修改，是否保留本地修改？`
  return new Promise((resolve) => {
    wx.showModal({
      title,
      content,
      confirmText: '保留本地',
      cancelText: '保留云端',
      success: (res) => resolve(Boolean(res && res.confirm)),
      fail: () => resolve(false)
    })
  })
}

const mergeCloudIntoLocal = async (collection, cloudItems, onProgress) => {
  const items = Array.isArray(cloudItems) ? cloudItems : []
  let merged = 0
  for (const item of items) {
    const id = localStore.normalizeId(item)
    if (!id) continue
    const cloudModifyTime = computeCloudModifyTime(item)
    const localRec = localStore.getLocalById(collection, id)
    if (localRec) {
      const localCloudTs = Number(localRec.cloudModifyTime || 0)
      const localLocalTs = Number(localRec.localModifyTime || 0)
      const localDirty = localLocalTs > localCloudTs
      const cloudNewerThanLocalCloud = cloudModifyTime > localCloudTs
      if (localDirty && cloudNewerThanLocalCloud) {
        const keepLocal = await resolveConflictModal(collection, localRec, item)
        if (!keepLocal) {
          localStore.upsertLocal(collection, item, { localModifyTime: Date.now(), cloudModifyTime })
          merged += 1
        }
      } else if (cloudNewerThanLocalCloud) {
        localStore.upsertLocal(collection, item, { localModifyTime: localLocalTs || Date.now(), cloudModifyTime })
        merged += 1
      }
    } else {
      localStore.upsertLocal(collection, item, { localModifyTime: Date.now(), cloudModifyTime })
      merged += 1
    }
    if (typeof onProgress === 'function' && merged % 50 === 0) {
      try { onProgress({ collection, merged }) } catch (_) { void 0 }
    }
  }
  return merged
}

const pullAllCloudData = async (options = {}) => {
  const collections = Array.isArray(options.collections) && options.collections.length ? options.collections : DEFAULT_SYNC_COLLECTIONS
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null

  const okNetwork = await isNetworkAvailable()
  if (!okNetwork) {
    const err = new Error('网络不可用')
    err.code = 'NETWORK_OFFLINE'
    throw err
  }

  const result = await withRetry(async () => {
    const res = await wx.cloud.callFunction({
      name: 'user-backup',
      data: { action: 'pullAll', collections }
    })
    const payload = res && res.result ? res.result : res
    if (!payload || payload.success !== true) {
      const msg = payload && payload.message ? String(payload.message) : '云端数据拉取失败'
      const err = new Error(msg)
      err.payload = payload
      throw err
    }
    return payload
  })

  const data = result.data && typeof result.data === 'object' ? result.data : {}
  const list = Array.isArray(data.collections) ? data.collections : []
  let totalMerged = 0
  for (let i = 0; i < list.length; i += 1) {
    const entry = list[i] && typeof list[i] === 'object' ? list[i] : {}
    const name = String(entry.name || '').trim()
    if (!name) continue
    if (onProgress) {
      try { onProgress({ phase: 'merge', collection: name, index: i + 1, total: list.length }) } catch (_) { void 0 }
    }
    const merged = await mergeCloudIntoLocal(name, entry.items, onProgress)
    totalMerged += merged
    localStore.setCollectionSyncTime(name, Date.now())
  }
  return { success: true, merged: totalMerged, serverTime: Number(data.serverTime || 0) }
}

const buildChangesFromLocal = (collections) => {
  const out = []
  const list = Array.isArray(collections) && collections.length ? collections : DEFAULT_SYNC_COLLECTIONS
  for (const c of list) {
    const name = String(c || '').trim()
    if (!name) continue
    const items = localStore.listLocal(name)
    for (const item of items) {
      const localTs = Number(item.localModifyTime || 0)
      const cloudTs = Number(item.cloudModifyTime || 0)
      if (localTs > cloudTs) {
        out.push({
          op: 'upsert',
          collection: name,
          id: localStore.normalizeId(item),
          data: item,
          localModifyTime: localTs,
          cloudModifyTime: cloudTs
        })
      }
    }
  }
  return out
}

const syncNow = async (options = {}) => {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null
  const collections = Array.isArray(options.collections) && options.collections.length ? options.collections : DEFAULT_SYNC_COLLECTIONS

  const okNetwork = await isNetworkAvailable()
  if (!okNetwork) {
    const queue = localStore.readQueue()
    const fromQueue = queue.filter((x) => x && typeof x === 'object' && x.collection && x.op)
    const inferred = buildChangesFromLocal(collections)
    if (inferred.length) {
      const mergedByKey = new Map()
      for (const item of [...fromQueue, ...inferred]) {
        const key = `${String(item.collection)}:${String(item.op)}:${String(item.id || '')}`
        mergedByKey.set(key, item)
      }
      localStore.writeQueue(Array.from(mergedByKey.values()))
    }
    return { success: false, message: '网络不可用', skipped: true }
  }

  const queue = localStore.readQueue()
  const fromQueue = queue.filter((x) => x && typeof x === 'object' && x.collection && x.op)
  const inferred = buildChangesFromLocal(collections)
  const mergedByKey = new Map()
  for (const item of [...fromQueue, ...inferred]) {
    const key = `${String(item.collection)}:${String(item.op)}:${String(item.id || '')}`
    mergedByKey.set(key, item)
  }
  const changes = Array.from(mergedByKey.values())

  if (!changes.length) {
    return { success: true, uploaded: 0 }
  }

  if (onProgress) {
    try { onProgress({ phase: 'upload', total: changes.length, done: 0 }) } catch (_) { void 0 }
  }

  const payload = await withRetry(async () => {
    const res = await wx.cloud.callFunction({
      name: 'user-backup',
      data: { action: 'pushChanges', changes }
    })
    const p = res && res.result ? res.result : res
    if (!p || p.success !== true) {
      const msg = p && p.message ? String(p.message) : '同步失败'
      const err = new Error(msg)
      err.payload = p
      throw err
    }
    return p
  }, { retries: 3, baseDelayMs: 600 })

  const data = payload.data && typeof payload.data === 'object' ? payload.data : {}
  const applied = Array.isArray(data.applied) ? data.applied : []
  const conflicts = Array.isArray(data.conflicts) ? data.conflicts : []

  for (const a of applied) {
    const c = String(a.collection || '').trim()
    const id = a.id == null ? '' : String(a.id)
    if (!c || !id) continue
    const serverTs = Number(a.cloudModifyTime || 0)
    const local = localStore.getLocalById(c, id)
    if (local) {
      localStore.upsertLocal(c, { ...local, cloudModifyTime: serverTs }, { localModifyTime: Number(local.localModifyTime || Date.now()), cloudModifyTime: serverTs })
    }
    localStore.setCollectionSyncTime(c, Date.now())
  }

  if (conflicts.length) {
    for (const cf of conflicts) {
      const c = String(cf.collection || '').trim()
      const id = cf.id == null ? '' : String(cf.id)
      if (!c || !id) continue
      const localRec = cf.local && typeof cf.local === 'object' ? cf.local : localStore.getLocalById(c, id)
      const cloudRec = cf.cloud && typeof cf.cloud === 'object' ? cf.cloud : null
      const keepLocal = await resolveConflictModal(c, localRec, cloudRec)
      if (!keepLocal && cloudRec) {
        const cloudTs = computeCloudModifyTime(cloudRec)
        localStore.upsertLocal(c, cloudRec, { localModifyTime: Date.now(), cloudModifyTime: cloudTs })
      }
    }
  }

  localStore.clearQueue()
  return { success: true, uploaded: applied.length, conflicts: conflicts.length }
}

const enqueueUpsert = (collection, record) => {
  const c = String(collection || '').trim()
  if (!c) return null
  const id = localStore.normalizeId(record)
  if (!id) return null
  const now = Date.now()
  const localRec = localStore.getLocalById(c, id)
  const cloudTs = Number(localRec?.cloudModifyTime || computeCloudModifyTime(record) || 0)
  localStore.upsertLocal(c, { ...(record && typeof record === 'object' ? record : {}), _id: id }, { localModifyTime: now, cloudModifyTime: cloudTs })
  localStore.enqueue({ op: 'upsert', collection: c, id, localModifyTime: now, cloudModifyTime: cloudTs })
  return id
}

const enqueueDelete = (collection, id) => {
  const c = String(collection || '').trim()
  const rid = id == null ? '' : String(id)
  if (!c || !rid) return null
  const localRec = localStore.getLocalById(c, rid)
  const cloudTs = Number(localRec?.cloudModifyTime || 0)
  const now = Date.now()
  localStore.removeLocal(c, rid, { localModifyTime: now, cloudModifyTime: cloudTs })
  localStore.enqueue({ op: 'delete', collection: c, id: rid, localModifyTime: now, cloudModifyTime: cloudTs })
  return rid
}

const exportEncryptedBackup = async (options = {}) => {
  const cfg = options.backupConfig && typeof options.backupConfig === 'object' ? options.backupConfig : {}
  const collections = Array.isArray(options.collections) && options.collections.length ? options.collections : DEFAULT_SYNC_COLLECTIONS
  const mustWifi = Boolean(cfg.mode === 'schedule' || cfg.mode === 'scheduled')
  if (mustWifi) {
    const wifi = await isWifi()
    if (!wifi) {
      return { success: false, message: '仅在 Wi-Fi 下执行定时备份', skipped: true }
    }
  }
  const snapshot = {
    version: '1.0.0',
    timestamp: Date.now(),
    backupConfig: cfg,
    meta: localStore.getMeta(),
    collections: {}
  }
  for (const c of collections) {
    const name = String(c || '').trim()
    if (!name) continue
    snapshot.collections[name] = localStore.listLocal(name)
  }

  const res = await withRetry(async () => {
    const r = await wx.cloud.callFunction({
      name: 'user-backup',
      data: { action: 'exportEncryptedBackup', snapshot }
    })
    const p = r && r.result ? r.result : r
    if (!p || p.success !== true) {
      const msg = p && p.message ? String(p.message) : '备份失败'
      const err = new Error(msg)
      err.payload = p
      throw err
    }
    return p
  }, { retries: 3, baseDelayMs: 700 })

  try {
    const meta = res.data && typeof res.data === 'object' ? res.data : {}
    wx.setStorageSync('lastBackupMeta', meta)
  } catch (_) { void 0 }
  return res
}

module.exports = {
  isNetworkAvailable,
  isWifi,
  pullAllCloudData,
  syncNow,
  enqueueUpsert,
  enqueueDelete,
  exportEncryptedBackup
}
