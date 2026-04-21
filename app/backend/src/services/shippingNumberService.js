import cloudbaseService from './cloudbaseService.js'

const PREFIX = 'QXFH'

const safeInt = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.trunc(n) : 0
}

const extractSeq = (shippingNoteNo, dateKey) => {
  const s = String(shippingNoteNo || '').trim()
  const prefix = `${PREFIX}${dateKey}`
  if (!s.startsWith(prefix)) return 0
  const tail = s.slice(prefix.length)
  const m = tail.match(/^\d+/)
  if (!m) return 0
  return safeInt(m[0])
}

class ShippingNumberService {
  async _ensureCloud() {
    const ok = await cloudbaseService.initialize().catch(() => false)
    if (!ok) {
      throw new Error('cloudbase_unavailable')
    }
  }

  async _getMaxExistingSeqFromOrders(dateKey) {
    await this._ensureCloud()
    const db = cloudbaseService.db
    const orders = db.collection('orders')
    const prefix = `${PREFIX}${dateKey}`
    const regex = db.RegExp({ regexp: `^${prefix}`, options: '' })

    const limit = 100
    let maxSeq = 0

    const scan = async (where) => {
      let offset = 0
      while (true) {
        const res = await orders.where(where).limit(limit).skip(offset).get()
        const rows = Array.isArray(res?.data) ? res.data : []
        for (const row of rows) {
          const no = row?.shippingNote?.shippingNoteNo || row?.shippingNoteNo
          const seq = extractSeq(no, dateKey)
          if (seq > maxSeq) maxSeq = seq
        }
        if (rows.length < limit) break
        offset += limit
        if (offset >= 2000) break
      }
    }

    await scan({ 'shippingNote.shippingNoteNo': regex })
    await scan({ shippingNoteNo: regex })

    return maxSeq
  }

  async generateShippingNoteNumber(payload = {}) {
    // Extract shipDate from payload
    const shipDate = payload?.shipDate || payload?.data?.shipDate

    let dateObj
    if (shipDate) {
      // Use provided shipDate
      dateObj = new Date(shipDate)
      // Validate date
      if (isNaN(dateObj.getTime())) {
        dateObj = new Date()
      }
    } else {
      // Fallback to current date
      dateObj = new Date()
    }

    const pad = n => n.toString().padStart(2, '0')
    const timestamp = `${dateObj.getFullYear()}${pad(dateObj.getMonth() + 1)}${pad(dateObj.getDate())}${pad(dateObj.getHours())}${pad(dateObj.getMinutes())}${pad(dateObj.getSeconds())}`
    const randomPart = Math.floor(Math.random() * 9000 + 1000) // 4位随机数

    // 格式：SH + YYYYMMDDHHmmss + 4位随机数
    // 示例：SH202310271030001234
    const shippingNoteNo = `SH${timestamp}${randomPart}`

    // 为了保持接口返回结构一致，返回 seq: 0
    return {
      shippingNoteNo,
      dateKey: timestamp.slice(0, 8),
      seq: 0
    }
  }
}

export default new ShippingNumberService()
