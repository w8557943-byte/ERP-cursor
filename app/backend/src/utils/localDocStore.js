import crypto from 'crypto'
import LocalDocument from '../models/local/LocalDocument.js'

const makeDocId = () => {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  return crypto.randomBytes(16).toString('hex')
}

const normalizeDoc = (collection, doc) => {
  if (!doc) return null
  const docId = String(doc.docId || '').trim()
  if (!docId) return null
  const payload = doc.data && typeof doc.data === 'object' ? doc.data : {}
  return {
    ...payload,
    _id: payload?._id != null ? String(payload._id) : docId,
    id: payload?.id != null ? String(payload.id) : docId,
    _collection: collection
  }
}

export async function listLocalDocs(collection, opts = {}) {
  const col = String(collection || '').trim()
  if (!col) return []
  const limit = Number(opts.limit || 5000)
  const rows = await LocalDocument.findAll({
    where: { collection: col },
    order: [['updatedAt', 'DESC'], ['id', 'DESC']],
    limit: Number.isFinite(limit) && limit > 0 ? Math.min(10000, limit) : 5000
  })
  return (rows || []).map((r) => normalizeDoc(col, r)).filter(Boolean)
}

export async function getLocalDoc(collection, docId) {
  const col = String(collection || '').trim()
  const id = String(docId || '').trim()
  if (!col || !id) return null
  const row = await LocalDocument.findOne({ where: { collection: col, docId: id } })
  return row ? normalizeDoc(col, row) : null
}

export async function upsertLocalDoc(collection, data, idCandidate) {
  const col = String(collection || '').trim()
  if (!col) throw new Error('缺少collection')
  const payload = data && typeof data === 'object' ? data : {}
  const usedIdRaw = idCandidate != null ? String(idCandidate) : String(payload._id || payload.id || '')
  const usedId = usedIdRaw && usedIdRaw.trim() ? usedIdRaw.trim() : makeDocId()
  const normalized = { ...payload, _id: usedId, id: usedId }
  const existing = await LocalDocument.findOne({ where: { collection: col, docId: usedId } })
  if (existing) {
    await existing.update({ data: normalized })
  } else {
    await LocalDocument.create({ collection: col, docId: usedId, data: normalized })
  }
  return { id: usedId, doc: normalized }
}

export async function removeLocalDoc(collection, docId) {
  const col = String(collection || '').trim()
  const id = String(docId || '').trim()
  if (!col || !id) return false
  await LocalDocument.destroy({ where: { collection: col, docId: id } })
  return true
}

