import React, { useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Modal, Select, Space, Table } from 'antd'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { orderAPI } from '../services/api'
import customerService from '../services/customerService'

const ShippingNoteStats = () => {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [orders, setOrders] = useState([])

  const [detailOpen, setDetailOpen] = useState(false)
  const [detailCustomerName, setDetailCustomerName] = useState('')
  const [selectedYear, setSelectedYear] = useState(() => dayjs().year())
  const [selectedMonth, setSelectedMonth] = useState(() => dayjs().month() + 1)

  const loadData = async () => {
    setLoading(true)
    try {
      const fetchAllOrders = async () => {
        const pageSize = 500
        const maxPages = 20
        const out = []
        for (let page = 1; page <= maxPages; page += 1) {
          const orderResp = await orderAPI.getOrders({ page, pageSize, withTotal: false })
          const pageData = Array.isArray(orderResp?.data?.orders)
            ? orderResp.data.orders
            : Array.isArray(orderResp?.data)
              ? orderResp.data
              : Array.isArray(orderResp?.orders)
                ? orderResp.orders
                : (Array.isArray(orderResp?.list) ? orderResp.list : (Array.isArray(orderResp) ? orderResp : []))
          if (Array.isArray(pageData) && pageData.length) {
            out.push(...pageData)
          }
          if (!Array.isArray(pageData) || pageData.length < pageSize) {
            break
          }
        }
        return out
      }

      const [data, customerResp] = await Promise.all([
        fetchAllOrders(),
        customerService.getCustomers({})
      ])

      let customersData = []
      if (customerResp && Array.isArray(customerResp.customers)) {
        customersData = customerResp.customers
      } else if (Array.isArray(customerResp)) {
        customersData = customerResp
      } else if (customerResp && Array.isArray(customerResp.data)) {
        customersData = customerResp.data
      }
      const customerList = customersData.map((customer, index) => ({
        ...customer,
        name: customer.name ?? customer.companyName ?? customer.company,
        key: customer._id ?? customer.id ?? `customer_${index}`,
        address: customer.address ?? customer.customerAddress ?? ''
      }))

      const addressById = new Map()
      const addressByName = new Map()
      customerList.forEach(c => {
        if (c.address) {
          const idKey = c._id || c.id || c.customerId || c.customerCode
          const nameKey = c.name || c.companyName || c.company
          if (idKey && !addressById.has(String(idKey))) {
            addressById.set(String(idKey), c.address)
          }
          if (nameKey && !addressByName.has(String(nameKey))) {
            addressByName.set(String(nameKey), c.address)
          }
        }
      })

      const list = (data || []).flatMap((o, i) => {
        const items = Array.isArray(o.items) ? o.items : []
        const first = items[0] || {}
        const quantity = Number(o.quantity || o.totalQty || items.reduce((s, it) => s + (Number(it.quantity) || 0), 0))
        const rawAmount = Number(o.amount || o.totalAmount || o.finalAmount || 0)
        let unitPrice = Number(o.unitPrice || first.unitPrice || 0)
        if (!unitPrice && quantity > 0 && rawAmount) {
          unitPrice = rawAmount / quantity
        }
        const stockedQty = Number(o.stockedQty || o.quantity || o.totalQty || quantity || 0)
        const inventoryQty = Number(o.inventoryQty || 0)

        const shippingNote = o.shippingNote && typeof o.shippingNote === 'object'
          ? o.shippingNote
          : {}
        const shippingNoteNo =
          shippingNote.shippingNoteNo ||
          o.shippingNoteNo ||
          ''
        const rawGoodsName = o.goodsName || o.goods_name || ''

        const normalizeSizeToken = (v) => String(v ?? '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, '')
          .replace(/[x*]/g, '×')
          .replace(/mm$/i, '')

        const isBoardSizeText = (s) => {
          const t = normalizeSizeToken(s)
          if (!t) return false
          if (!t.includes('×')) return false
          const parts = t.split('×').filter(Boolean)
          if (parts.length < 2 || parts.length > 3) return false
          const nums = parts.map(p => Number(p))
          if (nums.some(n => !Number.isFinite(n) || n <= 0)) return false
          if (nums.some(n => n > 5000)) return false
          return true
        }

        const toNum = (v) => {
          const n = Number(v)
          return Number.isFinite(n) ? n : NaN
        }

        const bw = toNum(o.boardWidth ?? o.board_width ?? first.boardWidth ?? first.board_width)
        const bh = toNum(o.boardHeight ?? o.board_height ?? first.boardHeight ?? first.board_height)

        const baseName = String(o.customerName || o.customer || o.customer_name || '').trim()
        const resolvedAddress = (() => {
          const cid = o.customerId || o.customer?._id || o.customer?.id
          if (cid && addressById.has(String(cid))) return addressById.get(String(cid))
          if (baseName && addressByName.has(baseName)) return addressByName.get(baseName)
          return String(o.customerAddress || shippingNote.address || '')
        })()

        const pickOrderSpecText = (item = null) => {
          const it = item && typeof item === 'object' ? item : {}
          const candidates = [
            it.specification,
            it.productSpec,
            it.product_spec,
            it.spec,
            o.specification,
            o.productSpec,
            o.product_spec,
            first.specification,
            first.productSpec,
            first.product_spec,
            o.spec,
            first.spec
          ]
          for (const c of candidates) {
            const s = String(c ?? '').trim()
            if (!s || s === '-' || s === '—') continue
            if (isBoardSizeText(s)) continue
            return s
          }
          const fallback = String(it.spec ?? o.spec ?? first.spec ?? '').trim()
          return fallback && fallback !== '-' && fallback !== '—' ? fallback : '-'
        }

        const normalizeShipQty = (v) => {
          const n = Number(v ?? 0)
          if (!Number.isFinite(n) || n < 0) return 0
          return n
        }

        const normalizeShipTime = (raw) => {
          if (!raw) return ''
          if (typeof raw === 'number') return raw
          return String(raw)
        }

        const baseRow = {
          orderId: o._id || o.id,
          orderNo: o.orderNo || o.orderNumber || '',
          customerName: baseName || '-',
          customerId: o.customerId,
          customerAddress: resolvedAddress,
          productName: o.productName || o.product?.name || '-',
          goodsName: o.goodsName || o.productTitle || first.goodsName || first.title || first.productName || o.goods_name || o.title || '-',
          rawGoodsName,
          boardWidth: Number.isFinite(bw) ? bw : undefined,
          boardHeight: Number.isFinite(bh) ? bh : undefined,
          spec: pickOrderSpecText(first),
          orderSpecText: pickOrderSpecText(first),
          materialNo: o.materialNo || first.materialNo || '',
          unit: o.unit || first.unit || '片',
          quantity,
          stockedQty,
          inventoryQty,
          unitPrice,
          amount: Number(rawAmount || (quantity * unitPrice) || 0),
          status: String(o.status || '').toLowerCase(),
          shippingNote,
          shippingNoteNo
        }

        const normalizeKey = (s) => String(s ?? '').trim().toLowerCase().replace(/\s+/g, '')

        const distributeQty = (totalQty, weights) => {
          const total = Math.round(Number(totalQty) || 0)
          if (total <= 0) return weights.map(() => 0)
          if (weights.length <= 1) return [total]
          const w = weights.map((v) => {
            const n = Number(v)
            return Number.isFinite(n) && n > 0 ? n : 0
          })
          const sum = w.reduce((s, x) => s + x, 0)
          if (sum <= 0) {
            const out = weights.map(() => 0)
            out[0] = total
            return out
          }
          const raw = w.map((x) => (total * x) / sum)
          const base = raw.map((x) => Math.floor(x))
          let remain = total - base.reduce((s, x) => s + x, 0)
          const remainders = raw.map((x, idx) => ({ idx, r: x - base[idx] }))
          remainders.sort((a, b) => b.r - a.r)
          let ptr = 0
          while (remain > 0) {
            const idx = remainders[ptr]?.idx ?? 0
            base[idx] += 1
            remain -= 1
            ptr = (ptr + 1) % remainders.length
          }
          return base
        }

        const buildItemRows = () => {
          const list2 = items.length ? items : [null]
          return list2.map((item, itemIndex) => {
            const it = item && typeof item === 'object' ? item : {}
            const itemQtyRaw = Number(it.quantity ?? it.qty ?? it.count ?? 0)
            const itemQty = Number.isFinite(itemQtyRaw) && itemQtyRaw > 0
              ? itemQtyRaw
              : (items.length <= 1 ? quantity : 0)
            const itemGoodsName =
              it.goodsName || it.goods_name || it.productTitle || it.product_title || it.title ||
              it.productName || it.product_name || baseRow.goodsName
            const itemSpec = pickOrderSpecText(it)
            const itemMaterialNo = it.materialNo || it.material_no || baseRow.materialNo
            const itemUnit = it.unit || baseRow.unit
            const itemUnitPriceRaw = Number(it.unitPrice ?? it.price ?? 0)
            const itemUnitPrice = Number.isFinite(itemUnitPriceRaw) && itemUnitPriceRaw > 0
              ? itemUnitPriceRaw
              : baseRow.unitPrice
            return {
              ...baseRow,
              rawGoodsName: String(itemGoodsName || '').trim() || baseRow.rawGoodsName,
              goodsName: itemGoodsName || '-',
              spec: itemSpec || '-',
              materialNo: itemMaterialNo || '',
              unit: itemUnit || '片',
              unitPrice: itemUnitPrice,
              quantity: itemQty,
              orderSpecText: pickOrderSpecText(it),
              __itemIndex: itemIndex
            }
          })
        }

        const itemRows = buildItemRows()

        const calcShipQtyByItem = (totalShipQty, shipRecord = null) => {
          const shipItems = Array.isArray(shipRecord?.items) ? shipRecord.items : []
          if (shipItems.length) {
            const idxByKey = new Map()
            itemRows.forEach((r, idx) => {
              const k1 = `${normalizeKey(r.materialNo)}|${normalizeKey(r.goodsName)}|${normalizeKey(r.spec)}`
              const k2 = `|${normalizeKey(r.goodsName)}|${normalizeKey(r.spec)}`
              if (k1) idxByKey.set(k1, idx)
              if (k2) idxByKey.set(k2, idx)
            })
            const out = itemRows.map(() => 0)
            let matched = 0
            shipItems.forEach((it) => {
              if (!it) return
              const qty = normalizeShipQty(it.qty ?? it.quantity ?? it.shipQty)
              if (qty <= 0) return
              const idx = Number(it.itemIndex)
              if (Number.isFinite(idx) && idx >= 0 && idx < out.length) {
                out[idx] += qty
                matched += 1
                return
              }
              const name = it.name || it.goodsName || it.goods_name || ''
              const spec = it.spec || ''
              const materialNo = it.materialNo || it.material_no || ''
              const k1 = `${normalizeKey(materialNo)}|${normalizeKey(name)}|${normalizeKey(spec)}`
              const k2 = `|${normalizeKey(name)}|${normalizeKey(spec)}`
              const hit = idxByKey.get(k1) ?? idxByKey.get(k2)
              if (hit !== undefined) {
                out[hit] += qty
                matched += 1
              }
            })
            if (matched > 0) return out
          }

          const noteItems = Array.isArray(shippingNote?.items) ? shippingNote.items : []
          const noteQtyByKey = new Map()
          noteItems.forEach((it) => {
            if (!it) return
            const qty = normalizeShipQty(it.qty ?? it.quantity)
            if (qty <= 0) return
            const name = it.name || it.goodsName || it.goods_name || ''
            const spec = it.spec || ''
            const materialNo = it.materialNo || it.material_no || ''
            const k1 = `${normalizeKey(materialNo)}|${normalizeKey(name)}|${normalizeKey(spec)}`
            const k2 = `|${normalizeKey(name)}|${normalizeKey(spec)}`
            ;[k1, k2].filter(Boolean).forEach((k) => {
              noteQtyByKey.set(k, (noteQtyByKey.get(k) || 0) + qty)
            })
          })

          let matched = 0
          const out = itemRows.map((r) => {
            const k1 = `${normalizeKey(r.materialNo)}|${normalizeKey(r.goodsName)}|${normalizeKey(r.spec)}`
            const k2 = `|${normalizeKey(r.goodsName)}|${normalizeKey(r.spec)}`
            const v = noteQtyByKey.get(k1) ?? noteQtyByKey.get(k2) ?? 0
            if (v > 0) matched += 1
            return v
          })

          if (matched > 0) return out

          if (itemRows.length <= 1) return [normalizeShipQty(totalShipQty)]
          const weights = itemRows.map((r) => Number(r.quantity || 0))
          return distributeQty(totalShipQty, weights)
        }

        const buildRowsForShip = ({ shipQty, shippedAtRaw, shippedAtText, shippedAtTs, keyBase, shipRecord }) => {
          const shipQtyByItem = calcShipQtyByItem(shipQty, shipRecord)
          return itemRows.map((r, itemIdx) => ({
            ...r,
            key: `${keyBase}::item_${itemIdx}`,
            shipQty: shipQtyByItem[itemIdx] ?? 0,
            shippedQty: shipQtyByItem[itemIdx] ?? 0,
            shippedAt: shippedAtRaw || '',
            shippedAtText,
            shippedAtTs
          }))
        }

        const shipments = Array.isArray(o.shipments) ? o.shipments : []
        if (shipments.length > 0) {
          return shipments.flatMap((s, idx) => {
            const shipQty = normalizeShipQty(s?.qty ?? s?.quantity ?? s?.shipQty)
            const shippedAtRaw = normalizeShipTime(s?.time ?? s?.shippedAt ?? s?.createdAt) || (o.shippedAt || o.deliveryTime || (String(o.status || '').toLowerCase() === 'shipping' ? (o.updatedAt || o.updateTime) : ''))
            const shippedAtText = shippedAtRaw ? dayjs(shippedAtRaw).format('YYYY-MM-DD HH:mm') : ''
            const shippedAtTs = shippedAtRaw && dayjs(shippedAtRaw).isValid() ? dayjs(shippedAtRaw).valueOf() : 0
            const keyBase = `${String(o._id || o.id || o.orderNo || `ship_${i}`)}_${idx}_${String(shippedAtTs || shippedAtRaw || '')}`
            return buildRowsForShip({ shipQty, shippedAtRaw, shippedAtText, shippedAtTs, keyBase, shipRecord: s })
          })
        }

        const shippedAtRaw = o.shippedAt || o.deliveryTime || (String(o.status || '').toLowerCase() === 'shipping' ? (o.updatedAt || o.updateTime) : '')
        const shippedAtText = shippedAtRaw ? dayjs(shippedAtRaw).format('YYYY-MM-DD HH:mm') : ''
        const shippedAtTs = shippedAtRaw && dayjs(shippedAtRaw).isValid() ? dayjs(shippedAtRaw).valueOf() : 0
        let shipQty = normalizeShipQty(o.shippedQty ?? o.deliveredQty)
        if (shipQty <= 0) {
          const note = o.shippingNote && typeof o.shippingNote === 'object'
            ? o.shippingNote
            : null
          if (note && Array.isArray(note.items)) {
            const sum = note.items.reduce((sum2, it) => {
              const v = normalizeShipQty(it && it.qty)
              return sum2 + v
            }, 0)
            if (sum > 0) shipQty = sum
          }
        }
        return buildRowsForShip({
          shipQty,
          shippedAtRaw,
          shippedAtText,
          shippedAtTs,
          keyBase: o._id || o.id || o.orderNo || `ship_${i}`,
          shipRecord: null
        })
      })

      const uniq = new Map()
      for (const r of list) {
        if (!uniq.has(r.key)) uniq.set(r.key, r)
      }

      setOrders(Array.from(uniq.values()))
    } catch (e) {
      message.error(e?.message || '加载失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const yearOptions = useMemo(() => {
    const y = dayjs().year()
    const out = []
    for (let i = y - 5; i <= y + 1; i += 1) {
      out.push({ label: `${i}年`, value: i })
    }
    return out
  }, [])

  const monthOptions = useMemo(() => {
    const out = []
    for (let i = 1; i <= 12; i += 1) {
      out.push({ label: `${i}月`, value: i })
    }
    return out
  }, [])

  const selectedMonthDate = useMemo(() => {
    const y = Number(selectedYear)
    const m = Number(selectedMonth)
    const safeY = Number.isFinite(y) ? y : dayjs().year()
    const safeM = Number.isFinite(m) && m >= 1 && m <= 12 ? m : (dayjs().month() + 1)
    return dayjs().year(safeY).month(safeM - 1)
  }, [selectedYear, selectedMonth])

  const monthStart = useMemo(() => selectedMonthDate.startOf('month').valueOf(), [selectedMonthDate])
  const monthEnd = useMemo(() => selectedMonthDate.endOf('month').valueOf(), [selectedMonthDate])

  const getShippingNoteNo = (row) => {
    const note = row && row.shippingNote && typeof row.shippingNote === 'object'
      ? row.shippingNote
      : null
    return String(row?.shippingNoteNo || note?.shippingNoteNo || '').trim()
  }

  const monthRows = useMemo(() => {
    return (orders || [])
      .filter(o => ['shipping', 'shipped', 'completed'].includes(o.status) && Number(o.shippedAtTs || 0) > 0)
      .filter(o => o.shippedAtTs >= monthStart && o.shippedAtTs <= monthEnd)
  }, [orders, monthStart, monthEnd])

  const stats = useMemo(() => {
    const byCustomer = new Map()
    monthRows.forEach((r) => {
      const customerName = String(r.customerName || '-').trim() || '-'
      const noteNo = getShippingNoteNo(r)
      if (!noteNo) return
      const noteKey = noteNo
      const current = byCustomer.get(customerName) || new Map()
      const prev = current.get(noteKey)
      const shippedAtTs = Number(r.shippedAtTs || 0)
      const next = prev
        ? { ...prev, shippedAtTs: Math.max(Number(prev.shippedAtTs || 0), shippedAtTs) }
        : { noteKey, shippingNoteNo: noteNo, shippedAtTs, orderId: r.orderId, orderNo: r.orderNo }
      current.set(noteKey, next)
      byCustomer.set(customerName, current)
    })
    return Array.from(byCustomer.entries())
      .map(([customerName, notes]) => ({
        key: customerName,
        customerName,
        monthShippingNoteCount: notes.size
      }))
      .sort((a, b) => (b.monthShippingNoteCount || 0) - (a.monthShippingNoteCount || 0))
  }, [monthRows])

  const detailNotes = useMemo(() => {
    const target = String(detailCustomerName || '').trim()
    if (!target) return []

    const map = new Map()
    monthRows.filter(r => String(r.customerName || '').trim() === target).forEach((r) => {
      const no = getShippingNoteNo(r)
      if (!no) return
      const noteKey = no
      const shippedAtTs = Number(r.shippedAtTs || 0)
      const existing = map.get(noteKey)
      const next = existing
        ? { ...existing, shippedAtTs: Math.max(Number(existing.shippedAtTs || 0), shippedAtTs) }
        : { key: noteKey, noteKey, shippingNoteNo: no, shippedAtTs, orderId: r.orderId, orderNo: r.orderNo }
      map.set(noteKey, next)
    })

    return Array.from(map.values())
      .sort((a, b) => (b.shippedAtTs || 0) - (a.shippedAtTs || 0))
      .map((it) => ({
        ...it,
        shippedAtText: it.shippedAtTs ? dayjs(it.shippedAtTs).format('YYYY-MM-DD HH:mm') : '-'
      }))
  }, [detailCustomerName, monthRows])

  const openDetail = (customerName) => {
    setDetailCustomerName(String(customerName || '').trim())
    setDetailOpen(true)
  }

  const openShippingNote = (note) => {
    const no = String(note?.shippingNoteNo || '').trim()
    let relatedRows = []
    if (no) {
      relatedRows = orders.filter(o => getShippingNoteNo(o) === no)
    } else {
      const orderId = String(note?.orderId || '').trim()
      const orderNo = String(note?.orderNo || '').trim()
      relatedRows = orders.filter(o => {
        if (orderId && String(o?.orderId || '').trim() === orderId) return true
        if (orderNo && String(o?.orderNo || '').trim() === orderNo) return true
        return false
      })
    }
    if (!relatedRows.length) {
      message.warning('未找到对应发货单数据')
      return
    }
    setDetailOpen(false)
    navigate('/shipping/print-preview', { state: { rows: relatedRows } })
  }

  const columns = useMemo(() => ([
    { title: '客户名', dataIndex: 'customerName', key: 'customerName', align: 'center', width: '33.33%' },
    { title: '本月发货单数量', dataIndex: 'monthShippingNoteCount', key: 'monthShippingNoteCount', align: 'center', width: '33.33%' },
    { title: '操作', key: 'action', align: 'center', width: '33.33%', render: (_, r) => (
      <Button type="link" onClick={() => openDetail(r.customerName)}>查看</Button>
    ) }
  ]), [])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'nowrap' }}>
        <Space size={8}>
          <h2 className="page-title" style={{ margin: 0 }}>发货单统计表</h2>
          <Select
            value={selectedYear}
            onChange={setSelectedYear}
            options={yearOptions}
            style={{ width: 120 }}
          />
          <Select
            value={selectedMonth}
            onChange={setSelectedMonth}
            options={monthOptions}
            style={{ width: 110 }}
          />
        </Space>
        <Button onClick={() => navigate('/shipping')}>返回</Button>
      </div>
      <Card>
        <Table
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={stats}
          pagination={false}
          tableLayout="fixed"
        />
      </Card>

      <Modal
        title={`${detailCustomerName || ''} - ${selectedYear}年${selectedMonth}月发货单`}
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        width={720}
        destroyOnHidden
      >
        <div style={{ marginBottom: 12 }}>
          <Space size={6}>
            <span>客户名：</span>
            <strong>{detailCustomerName || '-'}</strong>
          </Space>
        </div>
        <Table
          rowKey="key"
          size="small"
          dataSource={detailNotes}
          pagination={false}
          columns={[
            { title: '发货时间', dataIndex: 'shippedAtText', key: 'shippedAtText', width: 180 },
            {
              title: '发货单号',
              dataIndex: 'shippingNoteNo',
              key: 'shippingNoteNo',
              render: (t, r) => {
                const no = String(t || '').trim()
                if (!no) return '-'
                return (
                  <a onClick={(e) => { e.preventDefault(); openShippingNote(r) }}>
                    {no}
                  </a>
                )
              }
            },
            {
              title: '操作',
              key: 'action',
              width: 100,
              render: (_, r) => (
                <Space size={8}>
                  <Button size="small" onClick={() => openShippingNote(r)}>打开</Button>
                </Space>
              )
            }
          ]}
        />
      </Modal>
    </div>
  )
}

export default ShippingNoteStats
