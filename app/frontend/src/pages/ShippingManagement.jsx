import React, { useEffect, useMemo, useState } from 'react'
import { Card, Table, Space, Select, Input, Button, Tag, DatePicker, Modal, Form, AutoComplete, App, Row, Col, Statistic } from 'antd'
import { DollarOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import { orderAPI, shippingNumberAPI } from '../services/api'
import customerService from '../services/customerService'
import { useLocalStorage } from '../hooks/useLocalStorage'

const ShippingManagement = () => {
  const { message } = App.useApp()
  const [loading, setLoading] = useState(false)
  const [orders, setOrders] = useState([])
  const [allCustomers, setAllCustomers] = useState([])
  const [customerFilter, setCustomerFilter] = useState(undefined)
  const [keyword, setKeyword] = useState('')
  const [dateRange, setDateRange] = useState()
  const [printOpen, setPrintOpen] = useState(false)
  const [printOrder, setPrintOrder] = useState(null)
  const [form] = Form.useForm()
  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedKeys, setSelectedKeys] = useLocalStorage('erp_shipping_management_selected_keys', [])
  const [selectedRows, setSelectedRows] = useState([])
  const navigate = useNavigate()

  const loadData = async () => {
    setLoading(true)
    try {
      const [orderResp, customerResp] = await Promise.all([
        orderAPI.getOrders({ page: 1, pageSize: 500 }),
        customerService.getCustomers({})
      ])
      const data = Array.isArray(orderResp?.data?.orders)
        ? orderResp.data.orders
        : Array.isArray(orderResp?.data)
          ? orderResp.data
          : Array.isArray(orderResp?.orders)
            ? orderResp.orders
            : (Array.isArray(orderResp?.list) ? orderResp.list : (Array.isArray(orderResp) ? orderResp : []))

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
        const normalizeText = (v) => String(v ?? '').trim()
        const isBadNameText = (v) => {
          const s = normalizeText(v)
          if (!s || s === '-' || s === '—') return true
          return s === '真实订单信息' || s === 'SKU订单信息' || s === '多SKU'
        }
        const pickNameText = (...candidates) => {
          for (const c of candidates) {
            if (!isBadNameText(c)) return normalizeText(c)
          }
          return '-'
        }
        const pickFromItems = (getter) => {
          for (const it of items) {
            if (!it || typeof it !== 'object') continue
            const v = getter(it)
            if (!isBadNameText(v)) return normalizeText(v)
          }
          return ''
        }
        const quantity = Number(o.quantity || o.totalQty || items.reduce((s, it) => s + (Number(it.quantity) || 0), 0))
        const rawAmount = Number(o.amount || o.totalAmount || o.finalAmount || 0)
        let unitPrice = Number(o.unitPrice || first.unitPrice || 0)
        if (!unitPrice && quantity > 0 && rawAmount) {
          unitPrice = rawAmount / quantity
        }
        const stockedQty = Number(o.stockedQty || o.quantity || o.totalQty || quantity || 0)
        const inventoryQty = Number(o.inventoryQty || 0)
        const baseName = o.customerName || o.customer?.name || o.customer || ''
        const baseAddress = o.customerAddress || o.customerInfo?.address || o.customer?.address || ''
        let resolvedAddress = baseAddress
        if (!resolvedAddress) {
          if (o.customerId && addressById.size) {
            resolvedAddress = addressById.get(String(o.customerId)) || resolvedAddress
          }
          if (!resolvedAddress && baseName && addressByName.size) {
            resolvedAddress = addressByName.get(String(baseName)) || resolvedAddress
          }
        }
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
        const toNum = (v) => {
          const n = Number(v)
          return Number.isFinite(n) ? n : NaN
        }
        const boardW = toNum(o.boardWidth ?? o.board_width ?? first.boardWidth ?? first.board_width)
        const boardH = toNum(o.boardHeight ?? o.board_height ?? first.boardHeight ?? first.board_height)
        const boardSizeA = Number.isFinite(boardW) && Number.isFinite(boardH) ? normalizeSizeToken(`${boardW}×${boardH}`) : ''
        const boardSizeB = Number.isFinite(boardW) && Number.isFinite(boardH) ? normalizeSizeToken(`${boardH}×${boardW}`) : ''
        const isBoardSizeText = (text) => {
          const s = normalizeSizeToken(text)
          if (!s) return false
          if (!boardSizeA || !boardSizeB) return false
          return s === boardSizeA || s === boardSizeB
        }
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
          productName: pickNameText(
            o.productName,
            o.product?.name,
            o.product,
            pickFromItems((it) => it.productName || it.product?.name || it.category || it.productCategory || it.productType || it.type),
            first.productName,
            first.product?.name,
            first.category,
            first.productCategory,
            first.productType,
            first.type
          ),
          goodsName: pickNameText(
            o.goodsName,
            o.productTitle,
            o.goods_name,
            o.title,
            pickFromItems((it) => it.goodsName || it.name || it.title || it.productName),
            first.goodsName,
            first.name,
            first.title,
            first.productName
          ),
          rawGoodsName,
          boardWidth: Number.isFinite(boardW) ? boardW : undefined,
          boardHeight: Number.isFinite(boardH) ? boardH : undefined,
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
            const itemProductName = pickNameText(
              it.productName,
              it.product_name,
              it.product?.name,
              it.category,
              it.productCategory,
              it.productType,
              it.type,
              baseRow.productName
            )
            const itemSpec = pickOrderSpecText(it)
            const itemMaterialNo = it.materialNo || it.material_no || baseRow.materialNo
            const itemUnit = it.unit || baseRow.unit
            const itemUnitPriceRaw = Number(it.unitPrice ?? it.price ?? 0)
            const itemUnitPrice = Number.isFinite(itemUnitPriceRaw) && itemUnitPriceRaw > 0
              ? itemUnitPriceRaw
              : baseRow.unitPrice
            return {
              ...baseRow,
              productName: itemProductName,
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
      setAllCustomers(customerList)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const customers = useMemo(() => {
    const set = new Set((orders || []).map(o => o.customerName).filter(Boolean))
    return Array.from(set).map(c => ({ label: c, value: c }))
  }, [orders])

  const stats = useMemo(() => {
    const base = (orders || []).filter(o => ['shipping', 'shipped', 'completed'].includes(o.status) && Number(o.shippedAtTs || 0) > 0)
    const now = dayjs()
    const monthStart = now.startOf('month').valueOf()
    const monthEnd = now.endOf('month').valueOf()
    const dayStart = now.startOf('day').valueOf()
    const dayEnd = now.endOf('day').valueOf()

    const getShippingNoteNo = (row) => {
      const note = row && row.shippingNote && typeof row.shippingNote === 'object'
        ? row.shippingNote
        : null
      return String(row?.shippingNoteNo || note?.shippingNoteNo || '').trim()
    }

    const getShipAmount = (row) => {
      const qty = Number(row?.shipQty ?? row?.shippedQty ?? 0)
      const unitPrice = Number(row?.unitPrice ?? 0)
      if (Number.isFinite(qty) && qty > 0 && Number.isFinite(unitPrice) && unitPrice > 0) {
        return qty * unitPrice
      }
      return Number(row?.amount || 0)
    }

    const monthRows = base.filter(o => o.shippedAtTs >= monthStart && o.shippedAtTs <= monthEnd)
    const todayRows = base.filter(o => o.shippedAtTs >= dayStart && o.shippedAtTs <= dayEnd)

    const monthShippingNoteSet = new Set()
    monthRows.forEach((r) => {
      const no = getShippingNoteNo(r)
      if (no) {
        monthShippingNoteSet.add(no)
        return
      }
      const fallbackKey = r?.orderNo ? `order_${String(r.orderNo)}` : `key_${String(r?.key || '')}`
      if (fallbackKey) monthShippingNoteSet.add(fallbackKey)
    })

    const monthShippingAmount = monthRows.reduce((sum, r) => sum + (getShipAmount(r) || 0), 0)
    const todayShippingAmount = todayRows.reduce((sum, r) => sum + (getShipAmount(r) || 0), 0)

    return {
      monthShippingNoteCount: monthShippingNoteSet.size,
      monthShippingAmount,
      todayShippingAmount
    }
  }, [orders])

  const filtered = useMemo(() => {
    let list = orders.filter(o => ['shipping', 'shipped', 'completed'].includes(o.status))
    if (dateRange && Array.isArray(dateRange) && dateRange.length === 2) {
      const [start, end] = dateRange
      const s = start ? dayjs(start).startOf('day').valueOf() : 0
      const e = end ? dayjs(end).endOf('day').valueOf() : Number.MAX_SAFE_INTEGER
      list = list.filter(o => o.shippedAtTs && o.shippedAtTs >= s && o.shippedAtTs <= e)
    }
    if (customerFilter) {
      list = list.filter(o => o.customerName === customerFilter)
    }
    if (keyword) {
      const k = keyword.trim().toLowerCase()
      list = list.filter(o => (
        String(o.orderNo||'').toLowerCase().includes(k) ||
        String(o.customerName||'').toLowerCase().includes(k) ||
        String(o.productName||'').toLowerCase().includes(k) ||
        String(o.goodsName||'').toLowerCase().includes(k)
      ))
    }
    return list.slice().sort((a,b) => (b.shippedAtTs||0) - (a.shippedAtTs||0))
  }, [orders, customerFilter, keyword, dateRange])

  useEffect(() => {
    if (!Array.isArray(selectedKeys)) {
      setSelectedKeys([])
      setSelectedRows([])
      return
    }
    const keySet = new Set(selectedKeys.map(k => String(k)).filter(Boolean))
    const byKey = new Map((orders || []).map(o => [String(o?.key || ''), o]).filter(([k]) => !!k))
    const rows = Array.from(keySet).map(k => byKey.get(k)).filter(Boolean)
    if (rows.length > 9) {
      const trimmed = rows.slice(0, 9)
      setSelectedKeys(trimmed.map(r => r.key))
      setSelectedRows(trimmed)
      return
    }
    if (rows.length > 1) {
      const firstCustomer = rows[0]?.customerName
      const sameCustomer = rows.filter(r => r.customerName === firstCustomer)
      if (sameCustomer.length !== rows.length) {
        setSelectedKeys(sameCustomer.map(r => r.key))
        setSelectedRows(sameCustomer)
        return
      }
    }
    setSelectedRows(rows)
  }, [orders, selectedKeys, setSelectedKeys])

  const handleConfirmSigned = async (record) => {
    if (!record.orderId) return
    setLoading(true)
    const signedAt = new Date().toISOString()
    try {
      const groupOrders = []
      const resolveShippingNoteNo = (row) => {
        const note = row && row.shippingNote && typeof row.shippingNote === 'object'
          ? row.shippingNote
          : null
        return String(row?.shippingNoteNo || note?.shippingNoteNo || '').trim()
      }
      const targetNo = resolveShippingNoteNo(record)
      if (targetNo) {
        orders.forEach(o => {
          if (!o.orderId) return
          if (resolveShippingNoteNo(o) !== targetNo) return
          groupOrders.push(o)
        })
      }

      if (!groupOrders.length) {
        groupOrders.push(record)
      }

      const statusById = new Map()
      groupOrders.forEach(o => {
        if (!o.orderId) return
        statusById.set(String(o.orderId), 'completed')
      })

      await Promise.all(
        Array.from(statusById.entries()).map(([id, status]) =>
          orderAPI.updateOrder(id, { status, signedAt })
        )
      )

      const matchKeysSet = new Set()
      groupOrders.forEach(o => {
        [o.key, o.orderId, o.orderNo].filter(Boolean).forEach(k => {
          matchKeysSet.add(String(k))
        })
      })

      const signedAtText = dayjs(signedAt).format('YYYY-MM-DD HH:mm')

      setOrders(prev => prev.map(order => {
        const orderKeys = [order.key, order.orderId, order.orderNo].filter(Boolean).map(String)
        const same = orderKeys.some(key => matchKeysSet.has(key))
        if (!same) {
          return order
        }
        const idKey = order.orderId ? String(order.orderId) : null
        const nextStatus = idKey && statusById.has(idKey) ? statusById.get(idKey) : order.status
        return {
          ...order,
          status: nextStatus,
          signedAt,
          signedAtText
        }
      }))

      setSelectedRows(prev => prev.filter(row => {
        const rowKeys = [row.key, row.orderId, row.orderNo].filter(Boolean).map(String)
        return !rowKeys.some(k => matchKeysSet.has(k))
      }))

      setSelectedKeys(prev => prev.filter(key => !matchKeysSet.has(String(key))))

      message.success(groupOrders.length > 1 ? '送货单内所有订单已回签' : '订单已回签')
      loadData()
    } catch (e) {
      message.error('更新失败')
    } finally {
      setLoading(false)
    }
  }

  const openPrint = (record) => {
    setPrintOrder(record)
    const currentTotalShipped = Number(record.shipQty || 0)
    const note = record.shippingNote && typeof record.shippingNote === 'object'
      ? record.shippingNote
      : null
    let prevNoteTotal = 0
    if (note && Array.isArray(note.items)) {
      prevNoteTotal = note.items.reduce((sum, it) => {
        if (!it) return sum
        const v = Number(it.qty || 0)
        if (!Number.isFinite(v) || v <= 0) return sum
        return sum + v
      }, 0)
    }
    let defaultQty = currentTotalShipped
    if (Number.isFinite(currentTotalShipped) && currentTotalShipped > 0) {
      const delta = currentTotalShipped - prevNoteTotal
      if (Number.isFinite(delta) && delta > 0) {
        defaultQty = delta
      }
    } else {
      defaultQty = 0
    }
    const init = {
      consignee: record.customerName || '',
      address: '',
      contact: '',
      phone: '',
      notes: '',
      items: [
        { name: record.goodsName, spec: record.orderSpecText || record.spec, qty: defaultQty, unit: record.unit }
      ]
    }
    form.setFieldsValue(init)
    setPrintOpen(true)
  }

  const handlePrint = async () => {
    try {
      const values = await form.validateFields()
      const focusOrderNo = printOrder && printOrder.orderNo ? printOrder.orderNo : ''
      let shipMoment = (() => {
        const raw = printOrder?.shippedAt || printOrder?.shippedAtText || ''
        if (raw) {
          const d = dayjs(raw)
          if (d.isValid()) return d
        }
        const ts = Number(printOrder?.shippedAtTs || 0)
        if (ts) {
          const d = dayjs(ts)
          if (d.isValid()) return d
        }
        return null
      })()
      if (!shipMoment) {
        shipMoment = dayjs()
      }
      const existingNo = String(printOrder?.shippingNote?.shippingNoteNo || printOrder?.shippingNoteNo || '').trim()
      let shippingNoteNo = existingNo
      if (!shippingNoteNo) {
        const gen = await shippingNumberAPI.generateShippingNoteNumber({ shipDate: shipMoment.format('YYYY-MM-DD') })
        shippingNoteNo = String(gen?.data?.shippingNoteNo || '').trim()
      }
      if (!shippingNoteNo) {
        message.error('生成发货单号失败')
        return
      }
      if (printOrder && printOrder.orderId) {
        const hasShipTime =
          Boolean(printOrder?.shippedAt) ||
          Boolean(printOrder?.shippedAtText) ||
          Number(printOrder?.shippedAtTs || 0) > 0
        const updatePayload = { shippingNote: { ...values, shippingNoteNo } }
        if (!hasShipTime) {
          updatePayload.shippedAt = shipMoment.toISOString()
        }
        await orderAPI.updateOrder(printOrder.orderId, updatePayload)
      }
      const w = window.open('', '_blank')
      if (w) {
        const html = `
          <html>
            <head>
              <title>发货单</title>
              <style>
                @page { size: 215mm 140mm; margin: 0; }
                html, body {
                  margin: 0;
                  padding: 0;
                  height: 100%;
                }
                body {
                  font-family: Arial, sans-serif;
                  background: #f0f0f0;
                  display: flex;
                  justify-content: center;
                  align-items: center;
                }
                .page {
                  width: 215mm;
                  height: 140mm;
                  box-sizing: border-box;
                  background: #ffffff;
                  padding: 12mm 10mm 10mm;
                  box-shadow: 0 0 4mm rgba(0, 0, 0, 0.15);
                }
                h2 { text-align: center; margin: 0 0 10px; }
                .meta { margin-bottom: 8px; }
                .meta div { margin: 2px 0; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #ccc; padding: 4px 6px; text-align: left; font-size: 15px; }
                th { background: #f5f5f5; }
                .remark { margin-top: 8px; font-size: 14px; }
                @media print {
                  body {
                    background: #ffffff;
                    display: block;
                  }
                  .page {
                    margin-top: 3mm;
                    margin-left: 5mm;
                    box-shadow: none;
                    transform: scale(0.95);
                    transform-origin: top left;
                  }
                }
              </style>
            </head>
            <body>
              <div class="page">
                <h2>发货单</h2>
                <div class="meta">
                  <div>订单号：${printOrder.orderNo}</div>
                  <div>收货方：${values.consignee || ''}</div>
                  <div>地址：${values.address || ''}</div>
                  <div>联系人：${values.contact || ''}</div>
                  <div>电话：${values.phone || ''}</div>
                  <div>发货时间：${shipMoment.format('YYYY-MM-DD HH:mm')}</div>
                  <div>发货单号：${shippingNoteNo}</div>
                </div>
                <table>
                  <thead>
                    <tr><th>名称</th><th>规格</th><th>数量</th><th>单位</th></tr>
                  </thead>
                  <tbody>
                    ${(Array.isArray(values.items)?values.items:[]).map(it => `<tr><td>${it.name||''}</td><td>${it.spec||''}</td><td>${it.qty||''}</td><td>${it.unit||''}</td></tr>`).join('')}
                  </tbody>
                </table>
                <div class="remark">备注：${values.notes || ''}</div>
              </div>
              <script>window.onload = () => { window.print(); }</script>
            </body>
          </html>
        `
        w.document.write(html)
        w.document.close()
      }
      setPrintOpen(false)
      setPrintOrder(null)
      form.resetFields()
      message.success('发货单已生成')
      loadData()
      if (focusOrderNo) {
        navigate('/financial', { state: { activeTab: 'statements', focusOrderNo } })
      } else {
        navigate('/financial', { state: { activeTab: 'statements' } })
      }
    } catch (e) {
      message.error(e?.message || '打印失败')
    }
  }

  const toggleSelectionMode = () => {
    const next = !selectionMode
    setSelectionMode(next)
    if (!next) {
      setSelectedKeys([])
      setSelectedRows([])
    }
  }

  const openBatchPrint = () => {
    if (!selectedRows.length) {
      message.warning('请先勾选要打印的订单')
      return
    }
    navigate('/shipping/print-preview', { state: { rows: selectedRows } })
  }

  

  const columns = useMemo(() => ([
    { title: '订单编号', dataIndex: 'orderNo', key: 'orderNo' },
    { title: '客户名称', dataIndex: 'customerName', key: 'customerName', render: (text, record) => {
      const customerId = record.customerId
      const customerName = text
      const customer = allCustomers.find(c => 
        (customerId && (c._id === customerId || c.id === customerId)) || 
        (c.name === customerName || c.companyName === customerName)
      )
      return customer?.shortName || customer?.name || text || '-'
    } },
    { title: '商品', key: 'goods', render: (_, r) => {
      const rawName = String(r.rawGoodsName || '').trim()
      const productName = String(r.productName || '').trim()
      const goodsDisplay = rawName || r.goodsName || '-'
      const productDisplay = productName || '-'
      return (
        <div>
          <div>商品名称：{goodsDisplay}</div>
          <div style={{ color: '#6b7280' }}>产品类别：{productDisplay}</div>
          <div style={{ color: '#6b7280' }}>规格：{r.spec}</div>
          {r.materialNo ? (
            <div style={{ color: '#6b7280' }}>物料号：{r.materialNo}</div>
          ) : null}
        </div>
      )
    } },
    { title: '发货数量', key: 'shipQty', render: (_, r) => (
      <Space>
        <Tag color={r.shipQty > 0 ? 'gold' : 'default'}>{r.shipQty}</Tag>
        <span>{r.unit}</span>
      </Space>
    ) },
    { title: '发货时间', dataIndex: 'shippedAtText', key: 'shippedAtText' },
    { title: '状态', key: 'status', render: (_, r) => {
      const normalized = String(r.status || '').toLowerCase()
      const isCompleted = normalized === 'completed'
      const label = isCompleted ? '已完成' : '已发货'
      const color = isCompleted ? 'green' : 'gold'
      return (
        <Tag color={color}>{label}</Tag>
      )
    } },
    { title: '回签', key: 'signed', align: 'center', render: (_, r) => {
      const normalized = String(r.status || '').toLowerCase()
      const isCompleted = normalized === 'completed'
      if (isCompleted) {
        return (
          <span style={{ color: '#52c41a', fontSize: 18 }}>✔</span>
        )
      }
      return (
        <Button
          type="primary"
          size="small"
          style={{ backgroundColor: '#52c41a', borderColor: '#52c41a' }}
          onClick={() => {
            Modal.confirm({
              title: '确认回签',
              content: '确认将该送货单内相关订单全部标记为已回签？',
              okText: '确认回签',
              cancelText: '取消',
              onOk: () => handleConfirmSigned(r)
            })
          }}
        >
          回签
        </Button>
      )
    } },
    { title: '单号', dataIndex: 'shippingNoteNo', key: 'shippingNoteNo', render: (_, r) => {
      const no = r.shippingNoteNo || (r.shippingNote && r.shippingNote.shippingNoteNo) || ''
      if (!no) return '-'
      return (
        <a onClick={(e) => {
          e.preventDefault()
          const relatedRows = orders.filter(o => {
            const oNo = o.shippingNoteNo || (o.shippingNote && o.shippingNote.shippingNoteNo)
            return oNo === no
          })
          navigate('/shipping/print-preview', { state: { rows: relatedRows.length ? relatedRows : [r] } })
        }}>
          {no}
        </a>
      )
    } }
  ]), [allCustomers, orders])

  return (
    <div>
      <h2 className="page-title">发货管理</h2>
      <Row gutter={[16, 16]} style={{ marginBottom: 24 }} wrap={false}>
        <Col flex="1">
          <Card
            variant="borderless"
            hoverable
            styles={{
              body: {
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                borderRadius: '12px',
                background: '#fff',
                height: 130,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }
            }}
          >
            <Statistic
              title={
                <span
                  style={{
                    color: '#8c8c8c',
                    fontSize: 11,
                    display: 'block',
                    marginBottom: 4
                  }}
                >
                  本月发货单
                </span>
              }
              value={stats.monthShippingNoteCount}
              suffix="张"
              valueStyle={{ color: '#1890ff', fontWeight: 'bold', fontSize: 20 }}
            />
          </Card>
        </Col>
        <Col flex="1">
          <Card
            variant="borderless"
            hoverable
            styles={{
              body: {
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                borderRadius: '12px',
                background: '#fff',
                height: 130,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }
            }}
          >
            <Statistic
              title={
                <span
                  style={{
                    color: '#8c8c8c',
                    fontSize: 11,
                    display: 'block',
                    marginBottom: 4
                  }}
                >
                  本月发货金额
                </span>
              }
              value={stats.monthShippingAmount}
              prefix={<DollarOutlined />}
              suffix="元"
              precision={2}
              valueStyle={{ color: '#1890ff', fontWeight: 'bold', fontSize: 20 }}
            />
          </Card>
        </Col>
        <Col flex="1">
          <Card
            variant="borderless"
            hoverable
            styles={{
              body: {
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                borderRadius: '12px',
                background: '#fff',
                height: 130,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }
            }}
          >
            <Statistic
              title={
                <span
                  style={{
                    color: '#8c8c8c',
                    fontSize: 11,
                    display: 'block',
                    marginBottom: 4
                  }}
                >
                  今日发货金额
                </span>
              }
              value={stats.todayShippingAmount}
              prefix={<DollarOutlined />}
              suffix="元"
              precision={2}
              valueStyle={{ color: '#1890ff', fontWeight: 'bold', fontSize: 20 }}
            />
          </Card>
        </Col>
      </Row>
      <Card style={{ marginBottom: 12 }}>
        <Space wrap size={20}>
          <Select
            allowClear
            placeholder={'筛选客户'}
            options={customers}
            value={customerFilter}
            onChange={setCustomerFilter}
            style={{ width: 180 }}
          />
          <DatePicker.RangePicker
            onChange={(dates) => setDateRange(dates)}
            placeholder={["开始日期", "结束日期"]}
          />
          <Space.Compact>
            <Input
              placeholder={'搜索订单/客户/商品'}
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              allowClear
              style={{ width: 220 }}
            />
            <Button onClick={() => setKeyword(String(keyword || '').trim())}>搜索</Button>
          </Space.Compact>
          <Button type="primary" onClick={toggleSelectionMode}>{selectionMode ? '退出选择' : '打印发货单'}</Button>
          <Button onClick={() => navigate('/shipping/stats')}>发货单统计</Button>
          {selectionMode && (
            <Button type="default" onClick={openBatchPrint} disabled={!selectedRows.length}>合并打印</Button>
          )}
          {selectionMode && Array.isArray(selectedKeys) && selectedKeys.length ? (
            <Tag color="blue">已选 {selectedKeys.length} 条</Tag>
          ) : null}
          {selectionMode && Array.isArray(selectedKeys) && selectedKeys.length ? (
            <Button onClick={() => { setSelectedKeys([]); setSelectedRows([]) }}>清空勾选</Button>
          ) : null}
          <Button onClick={loadData} loading={loading}>刷新</Button>
        </Space>
      </Card>
      <Card>
        <Table
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={filtered}
          pagination={false}
          scroll={{ y: 520 }}
          sticky
          rowSelection={selectionMode ? {
            preserveSelectedRowKeys: true,
            selectedRowKeys: selectedKeys,
            onChange: (keys) => {
              if (!Array.isArray(keys)) return
              if (keys.length > 9) {
                message.warning('一次最多只能打印9个订单')
                return
              }
              const currentSelectedRows = orders.filter(o => keys.includes(o.key))
              if (currentSelectedRows.length > 1) {
                const first = currentSelectedRows[0].customerName
                const same = currentSelectedRows.every(r => r.customerName === first)
                if (!same) {
                  message.warning('不同客户订单不能同时勾选')
                  return
                }
              }
              setSelectedKeys(keys)
            }
          } : undefined}
        />
      </Card>

      <Modal
        title="打印发货单"
        open={printOpen}
        onOk={handlePrint}
        onCancel={() => { setPrintOpen(false); setPrintOrder(null); form.resetFields() }}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="consignee" label="收货方" rules={[{ required: true, message: '请输入收货方' }]}> 
            <AutoComplete style={{ width: 280 }} placeholder="输入或选择收货方" options={customers} />
          </Form.Item>
          <Form.Item name="address" label="收货地址"> 
            <Input placeholder="请输入地址" />
          </Form.Item>
          <Form.Item name="contact" label="联系人"> 
            <Input placeholder="请输入联系人" />
          </Form.Item>
          <Form.Item name="phone" label="联系电话"> 
            <Input placeholder="请输入联系电话" />
          </Form.Item>
          <Form.List name="items">
            {(fields, { add, remove }) => (
              <div>
                {fields.map(({ key, name }) => (
                  <Space.Compact key={key} style={{ width: '100%', marginBottom: 8 }}>
                    <Form.Item name={[name, 'name']} style={{ width: '40%' }}>
                      <Input placeholder="名称" />
                    </Form.Item>
                    <Form.Item name={[name, 'spec']} style={{ width: '30%' }}>
                      <Input placeholder="规格" />
                    </Form.Item>
                    <Form.Item name={[name, 'qty']} style={{ width: '15%' }}>
                      <Input type="number" placeholder="数量" />
                    </Form.Item>
                    <Form.Item name={[name, 'unit']} style={{ width: '15%' }}>
                      <Input placeholder="单位" />
                    </Form.Item>
                    <Button danger onClick={() => remove(name)}>删除</Button>
                  </Space.Compact>
                ))}
                <Button type="dashed" onClick={() => add({})} style={{ width: '100%' }}>添加明细项</Button>
              </div>
            )}
          </Form.List>
          <Form.Item name="notes" label="备注"> 
            <Input.TextArea rows={3} placeholder="备注" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default ShippingManagement
