const KEY_PREFIX = 'erp_local:'
const META_KEY = 'erp_local_meta'
const QUEUE_KEY = 'erp_sync_queue'

const safeNow = () => Date.now()

const safeGetStorage = (key) => {
  try {
    return wx.getStorageSync(key)
  } catch (_) {
    return undefined
  }
}

const safeSetStorage = (key, value) => {
  try {
    wx.setStorageSync(key, value)
    return true
  } catch (_) {
    return false
  }
}

const safeRemoveStorage = (key) => {
  try {
    wx.removeStorageSync(key)
    return true
  } catch (_) {
    return false
  }
}

const normalizeId = (record) => {
  if (!record || typeof record !== 'object') return ''
  const id = record._id ?? record.id ?? record.docId ?? record.recordId
  return id == null ? '' : String(id)
}

const ensureMeta = () => {
  const meta = safeGetStorage(META_KEY)
  if (meta && typeof meta === 'object') return meta
  const next = { collections: {}, lastSyncTime: 0 }
  safeSetStorage(META_KEY, next)
  return next
}

const readCollection = (collection) => {
  const key = `${KEY_PREFIX}${String(collection || '').trim()}`
  const raw = safeGetStorage(key)
  if (!raw || typeof raw !== 'object') {
    return { key, state: { itemsById: {}, updatedAt: 0 } }
  }
  const itemsById = raw.itemsById && typeof raw.itemsById === 'object' ? raw.itemsById : {}
  const updatedAt = Number(raw.updatedAt || 0)
  return { key, state: { itemsById, updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0 } }
}

const writeCollection = (collection, nextState) => {
  const key = `${KEY_PREFIX}${String(collection || '').trim()}`
  const payload = {
    itemsById: (nextState && nextState.itemsById && typeof nextState.itemsById === 'object') ? nextState.itemsById : {},
    updatedAt: safeNow()
  }
  return safeSetStorage(key, payload)
}

const markDirty = (collection, dirty = true) => {
  const meta = ensureMeta()
  const c = String(collection || '').trim()
  const prev = meta.collections && typeof meta.collections === 'object' ? meta.collections : {}
  const entry = prev[c] && typeof prev[c] === 'object' ? prev[c] : {}
  const nextEntry = {
    ...entry,
    dirtyFlag: Boolean(dirty),
    dirtyAt: Boolean(dirty) ? safeNow() : (entry.dirtyAt || 0)
  }
  const next = { ...meta, collections: { ...prev, [c]: nextEntry } }
  safeSetStorage(META_KEY, next)
  return next
}

const setCollectionSyncTime = (collection, lastSyncTime) => {
  const meta = ensureMeta()
  const c = String(collection || '').trim()
  const prev = meta.collections && typeof meta.collections === 'object' ? meta.collections : {}
  const entry = prev[c] && typeof prev[c] === 'object' ? prev[c] : {}
  const nextEntry = {
    ...entry,
    lastSyncTime: Number(lastSyncTime || 0),
    dirtyFlag: false
  }
  const next = { ...meta, lastSyncTime: Math.max(Number(meta.lastSyncTime || 0), Number(lastSyncTime || 0)), collections: { ...prev, [c]: nextEntry } }
  safeSetStorage(META_KEY, next)
  return next
}

const getMeta = () => ensureMeta()

const getCollectionMeta = (collection) => {
  const meta = ensureMeta()
  const c = String(collection || '').trim()
  const entry = meta.collections && typeof meta.collections === 'object' ? meta.collections[c] : null
  return entry && typeof entry === 'object' ? entry : { dirtyFlag: false, lastSyncTime: 0 }
}

const upsertLocal = (collection, record, options = {}) => {
  const c = String(collection || '').trim()
  if (!c) return { ok: false }
  const id = normalizeId(record)
  if (!id) return { ok: false }
  const localModifyTime = Number(options.localModifyTime || safeNow())
  const cloudModifyTime = Number(options.cloudModifyTime || (record && typeof record === 'object' ? (record.cloudModifyTime || record.cloud_modify_time || record.updatedAt || record._updateTime) : 0) || 0)

  const { state } = readCollection(c)
  const prev = state.itemsById && typeof state.itemsById === 'object' ? state.itemsById : {}
  const prevRec = prev[id] && typeof prev[id] === 'object' ? prev[id] : null
  const nextRec = {
    ...(prevRec || {}),
    ...(record && typeof record === 'object' ? record : {}),
    _id: id,
    localModifyTime,
    cloudModifyTime: Number.isFinite(cloudModifyTime) ? cloudModifyTime : 0
  }
  const nextItemsById = { ...prev, [id]: nextRec }
  const ok = writeCollection(c, { ...state, itemsById: nextItemsById })
  if (ok) markDirty(c, true)
  return { ok, record: nextRec }
}

const removeLocal = (collection, id, options = {}) => {
  const c = String(collection || '').trim()
  const rid = id == null ? '' : String(id)
  if (!c || !rid) return { ok: false }
  const { state } = readCollection(c)
  const prev = state.itemsById && typeof state.itemsById === 'object' ? state.itemsById : {}
  if (!Object.prototype.hasOwnProperty.call(prev, rid)) {
    return { ok: true, removed: false }
  }
  const next = { ...prev }
  delete next[rid]
  const ok = writeCollection(c, { ...state, itemsById: next })
  if (ok) markDirty(c, true)
  const tombstone = {
    _id: rid,
    deleted: true,
    localModifyTime: Number(options.localModifyTime || safeNow()),
    cloudModifyTime: Number(options.cloudModifyTime || 0)
  }
  return { ok, removed: true, tombstone }
}

const getLocalById = (collection, id) => {
  const c = String(collection || '').trim()
  const rid = id == null ? '' : String(id)
  if (!c || !rid) return null
  const { state } = readCollection(c)
  const items = state.itemsById && typeof state.itemsById === 'object' ? state.itemsById : {}
  const item = items[rid]
  return item && typeof item === 'object' ? item : null
}

const listLocal = (collection) => {
  const c = String(collection || '').trim()
  if (!c) return []
  const { state } = readCollection(c)
  const items = state.itemsById && typeof state.itemsById === 'object' ? state.itemsById : {}
  return Object.values(items).filter((x) => x && typeof x === 'object' && !x.deleted)
}

const readQueue = () => {
  const q = safeGetStorage(QUEUE_KEY)
  if (!Array.isArray(q)) return []
  return q.filter((x) => x && typeof x === 'object')
}

const writeQueue = (queue) => {
  const q = Array.isArray(queue) ? queue.filter((x) => x && typeof x === 'object') : []
  return safeSetStorage(QUEUE_KEY, q)
}

const enqueue = (entry) => {
  const next = readQueue()
  next.push({ ...entry, queuedAt: safeNow() })
  writeQueue(next)
  return next
}

const clearQueue = () => safeRemoveStorage(QUEUE_KEY)

module.exports = {
  normalizeId,
  getMeta,
  getCollectionMeta,
  markDirty,
  setCollectionSyncTime,
  upsertLocal,
  removeLocal,
  getLocalById,
  listLocal,
  readQueue,
  writeQueue,
  enqueue,
  clearQueue
}

