const cloud = require('wx-server-sdk')
const crypto = require('crypto')

cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })

const db = cloud.database()

const ALLOWED_COLLECTIONS = [
  'users',
  'userConfig',
  'orders',
  'purchase_orders',
  'customers',
  'customerAliases',
  'imageIndex',
  'products',
  'production',
  'inventory',
  'finance',
  'fixed_costs',
  'employees',
  'payables',
  'supplierMaterials',
  'materialCodes',
  'suppliers'
]

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

const sanitizeRecord = (record) => {
  if (!record || typeof record !== 'object') return {}
  const next = { ...record }
  delete next._openid
  delete next.openid
  delete next.OPENID
  return next
}

const paginateAll = async (collectionName, openid, options = {}) => {
  const limit = Number.isFinite(Number(options.limit)) ? Number(options.limit) : 100
  const max = Number.isFinite(Number(options.max)) ? Number(options.max) : 5000
  const out = []
  for (let skip = 0; skip < max; skip += limit) {
    const res = await db.collection(collectionName).where({ _openid: openid }).skip(skip).limit(limit).get()
    const rows = Array.isArray(res && res.data) ? res.data : []
    if (rows.length) out.push(...rows)
    if (rows.length < limit) break
  }
  return out
}

const requireAllowedCollection = (name) => {
  const c = String(name || '').trim()
  if (!c) {
    const err = new Error('collection 不能为空')
    err.code = 'INVALID_COLLECTION'
    throw err
  }
  if (!ALLOWED_COLLECTIONS.includes(c)) {
    const err = new Error(`collection 不允许: ${c}`)
    err.code = 'COLLECTION_NOT_ALLOWED'
    throw err
  }
  return c
}

const getAesKey = () => {
  const raw = String(process.env.BACKUP_AES_KEY || '').trim()
  if (!raw) {
    const err = new Error('缺少 BACKUP_AES_KEY 环境变量')
    err.code = 'MISSING_AES_KEY'
    throw err
  }
  try {
    const buf = Buffer.from(raw, 'base64')
    if (buf.length === 32) return buf
  } catch (_) { void 0 }
  try {
    const buf = Buffer.from(raw, 'hex')
    if (buf.length === 32) return buf
  } catch (_) { void 0 }
  return crypto.createHash('sha256').update(raw).digest()
}

const encryptSnapshot = (snapshot) => {
  const key = getAesKey()
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(snapshot), 'utf8')
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    algo: 'AES-256-GCM',
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: ciphertext.toString('base64')
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const openid = wxContext && wxContext.OPENID ? String(wxContext.OPENID) : ''

  const action = event && event.action ? String(event.action) : ''

  try {
    if (!openid) {
      const err = new Error('缺少 openid')
      err.code = 'MISSING_OPENID'
      throw err
    }

    if (action === 'pullAll') {
      const collections = Array.isArray(event.collections) ? event.collections : []
      const list = collections.length ? collections : ALLOWED_COLLECTIONS
      const out = []
      for (const name of list) {
        const c = requireAllowedCollection(name)
        const items = await paginateAll(c, openid)
        const normalized = items.map((x) => {
          const cloudModifyTime = computeCloudModifyTime(x)
          return { ...x, cloudModifyTime }
        })
        out.push({ name: c, items: normalized })
      }
      return { success: true, data: { collections: out, serverTime: Date.now() } }
    }

    if (action === 'pushChanges') {
      const changes = Array.isArray(event.changes) ? event.changes : []
      const applied = []
      const conflicts = []

      for (const ch of changes) {
        const op = ch && ch.op ? String(ch.op) : ''
        const collection = requireAllowedCollection(ch && ch.collection)
        const id = ch && (ch.id != null) ? String(ch.id) : ''
        if (!id) continue

        let remote = null
        try {
          const got = await db.collection(collection).doc(id).get()
          remote = got && got.data ? got.data : null
        } catch (_) {
          remote = null
        }

        if (remote && remote._openid && String(remote._openid) !== openid) {
          const err = new Error('无权限操作该记录')
          err.code = 'PERMISSION_DENIED'
          throw err
        }

        if (op === 'delete') {
          if (remote) {
            await db.collection(collection).doc(id).remove()
          }
          applied.push({ op, collection, id, cloudModifyTime: Date.now() })
          continue
        }

        if (op !== 'upsert') continue

        const clientKnownCloudTs = Number(ch && ch.cloudModifyTime ? ch.cloudModifyTime : 0) || 0
        const clientLocalTs = Number(ch && ch.localModifyTime ? ch.localModifyTime : 0) || 0
        const serverTs = remote ? computeCloudModifyTime(remote) : 0

        if (remote && serverTs > clientKnownCloudTs && clientLocalTs > clientKnownCloudTs) {
          conflicts.push({ collection, id, local: ch.data || null, cloud: remote })
          continue
        }

        const nowTs = Date.now()
        const data = { ...sanitizeRecord(ch && ch.data), _id: id, _openid: openid, cloudModifyTime: nowTs }
        await db.collection(collection).doc(id).set({ data })
        applied.push({ op, collection, id, cloudModifyTime: nowTs })
      }

      return { success: true, data: { applied, conflicts } }
    }

    if (action === 'exportEncryptedBackup') {
      const snapshot = event && typeof event.snapshot === 'object' ? event.snapshot : null
      if (!snapshot) {
        const err = new Error('snapshot 不能为空')
        err.code = 'INVALID_SNAPSHOT'
        throw err
      }
      const ts = Number(snapshot.timestamp || Date.now())
      const filename = `backup_${openid}_${ts}.json`
      const cloudPath = `userBackup/${filename}`

      const envelope = encryptSnapshot(snapshot)
      const fileContent = Buffer.from(JSON.stringify(envelope), 'utf8')

      const upload = await cloud.uploadFile({
        cloudPath,
        fileContent
      })

      const fileID = upload && upload.fileID ? String(upload.fileID) : ''
      if (!fileID) {
        const err = new Error('上传失败')
        err.code = 'UPLOAD_FAILED'
        throw err
      }

      const record = {
        _openid: openid,
        filename,
        cloudPath,
        fileID,
        size: fileContent.length,
        timestamp: ts,
        cloudModifyTime: Date.now(),
        createdAt: db.serverDate()
      }
      await db.collection('userBackup').add({ data: record })

      return {
        success: true,
        data: {
          openid,
          filename,
          cloudPath,
          fileID,
          size: record.size,
          timestamp: ts
        }
      }
    }

    return { success: false, message: '未知 action' }
  } catch (e) {
    return {
      success: false,
      message: e && e.message ? String(e.message) : '云函数异常',
      errorCode: e && e.code ? String(e.code) : 'UNKNOWN_ERROR'
    }
  }
}

