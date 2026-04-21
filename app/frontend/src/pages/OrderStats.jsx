import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Card, ConfigProvider, Modal, Row, Select, Space, Table, Tag } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import { useNavigate } from 'react-router-dom'
import { orderAPI } from '../services/api'
import { formatAmount } from '../utils'

const toFiniteNumber = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : undefined
}

const pickFiniteNumber = (...vals) => {
  for (const v of vals) {
    const n = toFiniteNumber(v)
    if (n !== undefined) return n
  }
  return undefined
}

const pickText = (...vals) => {
  for (const v of vals) {
    const s = String(v ?? '').trim()
    if (s) return s
  }
  return ''
}

const statusMap = {
  ordered: { text: '已下单', color: 'purple' },
  pending: { text: '待生产', color: 'orange' },
  processing: { text: '生产中', color: 'blue' },
  producing: { text: '生产中', color: 'blue' },
  stocked: { text: '已入库', color: 'geekblue' },
  shipping: { text: '已发货', color: 'gold' },
  completed: { text: '已完成', color: 'green' },
  cancelled: { text: '已取消', color: 'red' }
}

const normalizeStatus = (v) => String(v ?? '').trim().toLowerCase()

const formatMoneyCell = (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return `¥${formatAmount(n, 2)}`
}

const formatMoneyCellWithDigits = (digits) => (v) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return '-'
  return `¥${formatAmount(n, digits)}`
}

const unwrapOrderDetailResponse = (res) => {
  const body = res?.data ?? res
  if (!body) return null
  if (body && typeof body === 'object') {
    if (body.success === false) return null
    if (body.order && typeof body.order === 'object') return body.order
    const data = body.data
    if (data && typeof data === 'object') {
      if (data.order && typeof data.order === 'object') return data.order
      if (data.data && typeof data.data === 'object') {
        if (data.data.order && typeof data.data.order === 'object') return data.data.order
        if (data.data.data && typeof data.data.data === 'object') {
          if (data.data.data.order && typeof data.data.data.order === 'object') return data.data.data.order
          return data.data.data
        }
        return data.data
      }
      return data
    }
  }
  return body
}

const readOrderItems = (order) => {
  const o = order && typeof order === 'object' ? order : {}
  const nestedOrder = o?.order && typeof o.order === 'object' ? o.order : {}
  const data = o?.data && typeof o.data === 'object' ? o.data : {}
  const meta = o?.meta && typeof o.meta === 'object' ? o.meta : {}
  const dataOrder = data?.order && typeof data.order === 'object' ? data.order : {}
  const dataData = data?.data && typeof data.data === 'object' ? data.data : {}
  const dataDataOrder = dataData?.order && typeof dataData.order === 'object' ? dataData.order : {}
  if (Array.isArray(o.items)) return o.items
  if (Array.isArray(nestedOrder.items)) return nestedOrder.items
  if (Array.isArray(data.items)) return data.items
  if (Array.isArray(dataOrder.items)) return dataOrder.items
  if (Array.isArray(dataData.items)) return dataData.items
  if (Array.isArray(dataDataOrder.items)) return dataDataOrder.items
  if (Array.isArray(meta.items)) return meta.items
  return []
}

const calcDetailLineMetrics = (line, orderFallback) => {
  const src = line && typeof line === 'object' ? line : {}
  const o = orderFallback && typeof orderFallback === 'object' ? orderFallback : {}
  const qty = pickFiniteNumber(src.quantity, src.qty, src.count, src.orderQty, src.orderQuantity, o.quantity, o.totalQty) ?? 0
  let amount = pickFiniteNumber(src.amount, src.totalAmount, src.total_amount, src.finalAmount, src.final_amount)
  if (!Number.isFinite(amount)) {
    const price = pickFiniteNumber(src.unitPrice, src.unit_price, src.salePrice, src.sale_price, src.price, o.unitPrice, o.salePrice, o.price) ?? 0
    if (qty > 0 && Number.isFinite(price)) amount = qty * price
  }
  const costPrice = pickFiniteNumber(
    src.rawUnitPrice,
    src.raw_unit_price,
    src.rawMaterialUnitPrice,
    src.raw_material_unit_price,
    src.costPrice,
    src.cost_price,
    src.purchasePrice,
    src.purchase_price,
    o.rawUnitPrice,
    o.raw_unit_price,
    o.rawMaterialUnitPrice,
    o.raw_material_unit_price,
    o.costPrice,
    o.cost_price
  ) ?? 0
  const totalSheets = pickFiniteNumber(src.sheetCount, src.orderedQuantity, src.sheetQty, src.sheet_count, src.sheet_qty, src.totalSheets, 0) ?? 0
  const baseCount = (Number.isFinite(totalSheets) && totalSheets > 0) ? totalSheets : qty
  const rawAmount = Number.isFinite(costPrice) && baseCount > 0 ? baseCount * costPrice : 0
  const profit = Number.isFinite(amount) ? (amount - rawAmount) : 0
  return { qty, amount: Number.isFinite(amount) ? amount : 0, profit }
}

const calcMetricsFromDetailOrder = (order) => {
  const o = order && typeof order === 'object' ? order : {}
  const items = readOrderItems(o)
  if (!items.length) return calcOrderMetrics(o)
  return items.reduce((acc, it) => {
    const m = calcDetailLineMetrics(it, o)
    acc.amount += Number(m.amount || 0)
    acc.profit += Number(m.profit || 0)
    return acc
  }, { amount: 0, profit: 0 })
}

const calcOrderMetrics = (order) => {
  const o = order && typeof order === 'object' ? order : {}
  const items = Array.isArray(o.items) ? o.items : []
  const lines = items.length ? items : [o]

  let amountFromLines = 0
  let profitFromLines = 0
  let hasAnyLine = false

  lines.forEach((it) => {
    const src = it && typeof it === 'object' ? it : {}
    const qty = pickFiniteNumber(src.orderQty, src.quantity, src.qty, src.orderQuantity, o.quantity, o.totalQty) ?? 0
    const unitPrice = pickFiniteNumber(src.unitPrice, src.salePrice, src.sale_price, src.price, o.unitPrice, o.salePrice, o.price) ?? 0
    const rawUnitPrice = pickFiniteNumber(
      src.rawUnitPrice,
      src.raw_unit_price,
      src.rawMaterialUnitPrice,
      src.raw_material_unit_price,
      src.rawMaterialCost,
      src.raw_material_cost,
      o.rawUnitPrice,
      o.raw_unit_price,
      o.rawMaterialUnitPrice,
      o.raw_material_unit_price,
      o.rawMaterialCost,
      o.raw_material_cost
    ) ?? 0
    const perSheet = pickFiniteNumber(src.skuSheetCount, src.sheetCount, src.sheetQty, src.sheet_count, src.sheet_qty, o.sheetCount, o.sheetQty, o.sheet_count, o.sheet_qty)
    const sheetCount = (Number.isFinite(perSheet) && perSheet > 0) ? perSheet : 1

    if (qty || unitPrice || rawUnitPrice) hasAnyLine = true

    amountFromLines += qty * unitPrice
    profitFromLines += qty * (unitPrice - rawUnitPrice * sheetCount)
  })

  const fallbackAmount = pickFiniteNumber(o.amount, o.totalAmount, o.total_amount, o.finalAmount, o.final_amount, o.orderAmount, o.order_amount)
  const amount = amountFromLines > 0 ? amountFromLines : (fallbackAmount ?? 0)

  const metaProfit = pickFiniteNumber(
    o?.profit,
    o?.orderProfit,
    o?.order_profit,
    o?.totalProfit,
    o?.total_profit,
    o?.meta?.profit,
    o?.meta?.orderProfit,
    o?.meta?.order_profit,
    o?.meta?.totalProfit,
    o?.meta?.total_profit,
    o?.meta?.totalGrossProfit,
    o?.meta?.grossProfit,
    o?.totalGrossProfit,
    o?.grossProfit,
    o?.gross_profit
  )
  const profit = metaProfit !== undefined ? metaProfit : (hasAnyLine ? profitFromLines : 0)

  return { amount, profit }
}

const calcOrderQty = (order) => {
  const o = order && typeof order === 'object' ? order : {}
  const items = Array.isArray(o.items) ? o.items : []
  const qtyFromOrder = pickFiniteNumber(o.quantity, o.totalQty, o.qty, o.count, o.sheetCount, o.sheetQty, o.sheet_count, o.sheet_qty)
  if (qtyFromOrder !== undefined) return qtyFromOrder
  if (!items.length) return 0
  return items.reduce((sum, it) => {
    const src = it && typeof it === 'object' ? it : {}
    const q = pickFiniteNumber(src.orderQty, src.quantity, src.qty, src.orderQuantity) ?? 0
    return sum + q
  }, 0)
}

const isBoardPurchaseOrder = (order) => {
  const o = order && typeof order === 'object' ? order : {}
  const orderType = String(o?.orderType || '').trim().toLowerCase()
  const source = String(o?.source || '').trim().toLowerCase()
  return orderType === 'purchase' || source === 'purchased'
}

const orderCreatedAtTs = (order) => {
  const o = order && typeof order === 'object' ? order : {}
  const raw =
    o?.createTime ??
    o?.createdAt ??
    o?.created_at ??
    o?.create_time ??
    o?._createTime ??
    o?.orderTime ??
    o?.order_time ??
    o?.orderDate ??
    o?.order_date ??
    o?.date ??
    o?.time ??
    o?.updatedAt ??
    o?.updateTime ??
    o?.update_time ??
    undefined

  const toTs = (v) => {
    if (v === null || v === undefined) return undefined
    if (typeof v === 'number') {
      const d = dayjs(v)
      return d.isValid() ? d.valueOf() : undefined
    }
    if (v instanceof Date) {
      const d = dayjs(v)
      return d.isValid() ? d.valueOf() : undefined
    }
    const s = String(v).trim()
    if (!s) return undefined

    if (/^\d+$/.test(s)) {
      const n = Number(s)
      if (!Number.isFinite(n)) return undefined
      const ms = s.length <= 10 ? n * 1000 : n
      const d = dayjs(ms)
      return d.isValid() ? d.valueOf() : undefined
    }

    const normalized = s.includes('T') ? s : s.replace(' ', 'T')
    const d = dayjs(normalized)
    return d.isValid() ? d.valueOf() : undefined
  }

  const fromRaw = toTs(raw)
  if (fromRaw) return fromRaw

  const no = pickText(o.orderNo, o.orderNumber, o.order_number, o.no, o.number).trim()
  if (!no) return undefined
  const m = no.match(/(\d{4})(\d{2})(\d{2})/)
  if (!m) return undefined
  const iso = `${m[1]}-${m[2]}-${m[3]}`
  const d = dayjs(iso)
  return d.isValid() ? d.valueOf() : undefined
}

const orderDateFromOrderNoTs = (order) => {
  const o = order && typeof order === 'object' ? order : {}
  const no = pickText(o.orderNo, o.orderNumber, o.order_number, o.no, o.number).trim()
  if (!no) return undefined
  const m = no.match(/(\d{4})(\d{2})(\d{2})/)
  if (!m) return undefined
  const iso = `${m[1]}-${m[2]}-${m[3]}`
  const d = dayjs(iso)
  return d.isValid() ? d.startOf('day').valueOf() : undefined
}

const formatOrderCreatedAt = (order) => {
  const ts = orderCreatedAtTs(order)
  if (!ts) return '-'
  const d = dayjs(ts)
  if (!d.isValid()) return '-'
  return d.format('YYYY-MM-DD HH:mm')
}

const orderSummary = (order) => {
  const o = order && typeof order === 'object' ? order : {}
  const items = Array.isArray(o.items) ? o.items : []
  const first = items[0] && typeof items[0] === 'object' ? items[0] : {}
  const statusKey = normalizeStatus(o.status)
  const statusCfg = statusMap[statusKey] || { text: statusKey || '-', color: undefined }
  const { amount, profit } = calcOrderMetrics(o)
  const goodsName = pickText(
    o.goodsName,
    o.productTitle,
    o.title,
    o.productName,
    first.goodsName,
    first.title,
    first.productName
  ) || '-'
  const spec = pickText(first.specification, first.spec, first.productSpec, o.specification, o.spec, o.productSpec) || '-'
  const materialNo = pickText(first.materialNo, first.material_no, o.materialNo, o.material_no) || ''
  const quantity = calcOrderQty(o)
  return {
    createdAtText: formatOrderCreatedAt(o),
    orderNo: pickText(o.orderNo, o.orderNumber, o.order_number, o.no, o.number),
    goodsName,
    spec,
    materialNo,
    quantity,
    amount,
    profit,
    statusText: statusCfg.text || '-',
    statusColor: statusCfg.color
  }
}

const skuRowsForOrder = (order, keyPrefix) => {
  const o = order && typeof order === 'object' ? order : {}
  const items = readOrderItems(o)
  if (items.length <= 1) return []
  const statusKey = normalizeStatus(o.status)
  const statusCfg = statusMap[statusKey] || { text: statusKey || '-', color: undefined }
  const baseOrderNo = pickText(o.orderNo, o.orderNumber, o.order_number, o.no, o.number) || '-'
  return items.map((it, idx) => {
    const src = it && typeof it === 'object' ? it : {}
    const m = calcDetailLineMetrics(src, o)

    const goodsName = pickText(
      src.goodsName,
      src.productTitle,
      src.title,
      src.productName,
      o.goodsName,
      o.productTitle,
      o.title,
      o.productName
    ) || '-'
    const spec = pickText(src.specification, src.spec, src.productSpec, o.specification, o.spec, o.productSpec) || '-'
    const materialNo = pickText(src.materialNo, src.material_no, o.materialNo, o.material_no) || ''
    return {
      key: `${keyPrefix}:sku:${normalizeOrderNo(o) || 'order'}:${idx}`,
      createdAtText: formatOrderCreatedAt(o),
      orderNo: `${baseOrderNo}-${idx + 1}`,
      goodsName,
      spec,
      materialNo,
      quantity: m.qty,
      amount: m.amount,
      profit: m.profit,
      statusText: statusCfg.text || '-',
      statusColor: statusCfg.color,
      __isParent: false,
      __isChild: true
    }
  })
}

const skuRowsForOrderWithBaseNo = (order, keyPrefix, baseNoOverride) => {
  const o = order && typeof order === 'object' ? order : {}
  const items = readOrderItems(o)
  if (items.length <= 1) return []
  const statusKey = normalizeStatus(o.status)
  const statusCfg = statusMap[statusKey] || { text: statusKey || '-', color: undefined }
  const baseOrderNo = String(baseNoOverride || '').trim() || (pickText(o.orderNo, o.orderNumber, o.order_number, o.no, o.number) || '-')
  return items.map((it, idx) => {
    const src = it && typeof it === 'object' ? it : {}
    const m = calcDetailLineMetrics(src, o)

    const goodsName = pickText(
      src.goodsName,
      src.productTitle,
      src.title,
      src.productName,
      o.goodsName,
      o.productTitle,
      o.title,
      o.productName
    ) || '-'
    const spec = pickText(src.specification, src.spec, src.productSpec, o.specification, o.spec, o.productSpec) || '-'
    const materialNo = pickText(src.materialNo, src.material_no, o.materialNo, o.material_no) || ''
    return {
      key: `${keyPrefix}:sku:${normalizeOrderNo(o) || 'order'}:${idx}`,
      createdAtText: formatOrderCreatedAt(o),
      orderNo: `${baseOrderNo}-${idx + 1}`,
      goodsName,
      spec,
      materialNo,
      quantity: m.qty,
      amount: m.amount,
      profit: m.profit,
      statusText: statusCfg.text || '-',
      statusColor: statusCfg.color,
      __isParent: false,
      __isChild: true
    }
  })
}

const normalizeOrderNo = (order) => {
  const o = order && typeof order === 'object' ? order : {}
  return pickText(o.orderNo, o.orderNumber, o.order_number, o.no, o.number).trim()
}

const parseGroupedOrderNo = (raw) => {
  const s = String(raw || '').trim()
  if (!s) return { orderNo: '', parentNo: '', isChild: false, childSuffix: '' }
  const lastDash = s.lastIndexOf('-')
  if (lastDash <= 0 || lastDash === s.length - 1) return { orderNo: s, parentNo: s, isChild: false, childSuffix: '' }
  const parentNo = String(s.slice(0, lastDash)).trim()
  const childSuffix = String(s.slice(lastDash + 1)).trim()
  const parentLooksLikeOrderNo = /(\d{8})(\d{3,})$/.test(parentNo)
  if (!parentLooksLikeOrderNo) return { orderNo: s, parentNo: s, isChild: false, childSuffix: '' }
  return { orderNo: s, parentNo: parentNo || s, isChild: Boolean(childSuffix), childSuffix }
}

const isChildOrderNo = (no) => parseGroupedOrderNo(no).isChild

const parentNoOfOrderNo = (no) => {
  return parseGroupedOrderNo(no).parentNo
}

const deriveParentStatus = (parentOrder, childOrders) => {
  const parentKey = normalizeStatus(parentOrder?.status)
  if (parentKey) return parentKey
  const keys = Array.from(new Set((childOrders || []).map((o) => normalizeStatus(o?.status)).filter(Boolean)))
  if (keys.length === 1) return keys[0]
  if (!keys.length) return ''
  return 'mixed'
}

const statusDisplay = (statusKey) => {
  if (!statusKey) return { text: '-', color: undefined }
  if (statusKey === 'mixed') return { text: '混合', color: 'default' }
  return statusMap[statusKey] || { text: statusKey, color: undefined }
}

const normalizeCustomerNameKey = (name) => {
  return String(name ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[，,。．.、·•]/g, '')
    .replace(/[（）()[\]【】{}]/g, '')
}

const customerNameQualityScore = (name) => {
  const s = String(name ?? '').trim()
  if (!s) return 0
  let score = s.length
  if (/有限责任公司$/.test(s)) score += 80
  if (/有限公司$/.test(s)) score += 60
  if (/公司/.test(s)) score += 30
  if (/集团/.test(s)) score += 15
  if (/工厂|厂|中心|门店|店/.test(s)) score += 8
  return score
}

const customerNameCandidates = (order) => {
  const o = order && typeof order === 'object' ? order : {}
  const candidates = [
    o.customerName,
    o.customer_name,
    o.companyName,
    o.company,
    o.customerCompanyName,
    o.customerCompany,
    o.customer?.companyName,
    o.customer?.company,
    o.customer?.name,
    o.customer?.shortName,
    o.data?.customerName,
    o.data?.customer_name,
    o.meta?.customerName,
    o.meta?.customer_name
  ]
  const seen = new Set()
  const out = []
  candidates.forEach((v) => {
    const s = String(v ?? '').trim()
    if (!s) return
    const k = normalizeCustomerNameKey(s)
    if (!k || seen.has(k)) return
    seen.add(k)
    out.push(s)
  })
  return out
}

const resolveCustomerNameFromOrder = (order) => {
  const candidates = customerNameCandidates(order)
  if (!candidates.length) return ''
  let best = candidates[0]
  let bestScore = customerNameQualityScore(best)
  for (let i = 1; i < candidates.length; i += 1) {
    const c = candidates[i]
    const score = customerNameQualityScore(c)
    if (score > bestScore) {
      best = c
      bestScore = score
    }
  }
  return best
}

const aggregateOrdersForStats = (orders) => {
  const singles = new Map()
  const groups = new Map()

  ;(orders || []).forEach((order, idx) => {
    const o = order && typeof order === 'object' ? order : {}
    const rawNo = normalizeOrderNo(o)
    if (!rawNo) return
    if (isChildOrderNo(rawNo)) {
      const parentNo = parentNoOfOrderNo(rawNo)
      if (!groups.has(parentNo)) groups.set(parentNo, [])
      groups.get(parentNo).push(o)
      return
    }
    const key = rawNo || String(idx)
    if (!singles.has(key)) singles.set(key, [])
    singles.get(key).push(o)
  })

  let orderCount = 0
  let totalAmount = 0
  let totalProfit = 0

  Array.from(groups.entries()).forEach(([parentNo, childrenOrders]) => {
    if (singles.has(parentNo)) singles.delete(parentNo)
    orderCount += 1
    ;(childrenOrders || []).forEach((o) => {
      const m = calcOrderMetrics(o)
      totalAmount += Number(m.amount || 0)
      totalProfit += Number(m.profit || 0)
    })
  })

  Array.from(singles.values()).forEach((ordersInSameNo) => {
    orderCount += 1
    ;(ordersInSameNo || []).forEach((o) => {
      const m = calcOrderMetrics(o)
      totalAmount += Number(m.amount || 0)
      totalProfit += Number(m.profit || 0)
    })
  })

  return { orderCount, totalAmount, totalProfit }
}

const OrderStats = () => {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [allOrders, setAllOrders] = useState([])
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailCustomerKey, setDetailCustomerKey] = useState('')
  const [detailCustomerName, setDetailCustomerName] = useState('')
  const [detailExpandedKeys, setDetailExpandedKeys] = useState([])
  const [detailOrderByNo, setDetailOrderByNo] = useState({})
  const inflightDetailNoRef = useRef(new Set())
  const loadReqIdRef = useRef(0)
  const monthOrdersCacheRef = useRef(new Map())
  const [selectedYear, setSelectedYear] = useState(() => dayjs().year())
  const [selectedMonth, setSelectedMonth] = useState(() => dayjs().month() + 1)

  const monthKeyOf = useCallback((y, m) => {
    return `${String(y || '').trim()}-${String(m).padStart(2, '0')}`
  }, [])

  const loadData = useCallback(async ({ force } = {}) => {
    const monthKey = monthKeyOf(selectedYear, selectedMonth)
    if (!force && monthOrdersCacheRef.current.has(monthKey)) {
      const cached = monthOrdersCacheRef.current.get(monthKey)
      setAllOrders(Array.isArray(cached) ? cached : [])
      setLoading(false)
      return
    }

    const reqId = ++loadReqIdRef.current
    setLoading(true)
    if (force) monthOrdersCacheRef.current.delete(monthKey)
    try {
      const pageSize = 500
      const maxPages = 200

      const monthStart = dayjs(`${selectedYear}-${String(selectedMonth).padStart(2, '0')}-01`).startOf('month')
      const monthEnd = monthStart.endOf('month')
      const startIso = monthStart.toISOString()
      const endIso = monthEnd.toISOString()
      const monthToken = `${selectedYear}${String(selectedMonth).padStart(2, '0')}`

      const extractList = (orderResp) => {
        return Array.isArray(orderResp?.data?.orders)
          ? orderResp.data.orders
          : Array.isArray(orderResp?.data)
            ? orderResp.data
            : Array.isArray(orderResp?.orders)
              ? orderResp.orders
              : (Array.isArray(orderResp?.list) ? orderResp.list : (Array.isArray(orderResp) ? orderResp : []))
      }

      const fetchAllPages = async (baseParams) => {
        const out = []
        for (let page = 1; page <= maxPages; page += 1) {
          const orderResp = await orderAPI.getOrders({
            page,
            pageSize,
            withTotal: false,
            orderBy: 'createdAt_desc',
            excludeOrderType: 'purchase',
            ...baseParams
          })
          const pageData = extractList(orderResp)
          if (Array.isArray(pageData) && pageData.length) out.push(...pageData)
          if (!Array.isArray(pageData) || pageData.length < pageSize) break
        }
        return out
      }

      const [rangeOrders, keywordOrders] = await Promise.all([
        fetchAllPages({ startDate: startIso, endDate: endIso }),
        fetchAllPages({ keyword: monthToken })
      ])

      if (reqId !== loadReqIdRef.current) return

      const merged = [...(rangeOrders || []), ...(keywordOrders || [])]
      const seen = new Set()
      const unique = []
      merged.forEach((o) => {
        const key = pickText(o?._id, o?.id, normalizeOrderNo(o))
        if (!key) return
        if (seen.has(key)) return
        seen.add(key)
        unique.push(o)
      })
      monthOrdersCacheRef.current.set(monthKey, unique)
      setAllOrders(unique)
    } catch (e) {
      if (reqId !== loadReqIdRef.current) return
      message.error('加载订单统计失败')
      setAllOrders([])
    } finally {
      if (reqId === loadReqIdRef.current) setLoading(false)
    }
  }, [message, monthKeyOf, selectedMonth, selectedYear])

  useEffect(() => {
    void loadData({ force: false })
  }, [loadData])

  const { rows, customerOrders } = useMemo(() => {
    const filtered = (allOrders || []).filter((order) => {
      const o = order && typeof order === 'object' ? order : {}
      const ts = orderDateFromOrderNoTs(o) ?? orderCreatedAtTs(o)
      if (!ts) return false
      const d = dayjs(ts)
      if (!(d.year() === Number(selectedYear) && (d.month() + 1) === Number(selectedMonth))) return false
      if (isBoardPurchaseOrder(o)) return false
      return true
    })

    const byCustomer = new Map()
    filtered.forEach((order) => {
      const o = order && typeof order === 'object' ? order : {}
      const customerName = resolveCustomerNameFromOrder(o)
      if (!customerName) return
      const customerKey = normalizeCustomerNameKey(customerName) || customerName

      if (!byCustomer.has(customerKey)) {
        byCustomer.set(customerKey, {
          key: customerKey,
          customerName,
          __nameScore: customerNameQualityScore(customerName),
          orderCount: 0,
          totalAmount: 0,
          totalProfit: 0,
          orders: []
        })
      }
      const row = byCustomer.get(customerKey)
      const currScore = customerNameQualityScore(customerName)
      if (currScore > Number(row.__nameScore || 0)) {
        row.customerName = customerName
        row.__nameScore = currScore
      }
      row.orders.push(o)
    })

    const nextCustomerOrders = {}
    const nextRows = Array.from(byCustomer.values()).map((r) => {
      const agg = aggregateOrdersForStats(r.orders)
      nextCustomerOrders[r.key] = r.orders
      return {
        key: r.key,
        customerName: r.customerName,
        orderCount: agg.orderCount,
        totalAmount: agg.totalAmount,
        totalProfit: agg.totalProfit
      }
    }).sort((a, b) => {
      const diff = Number(b.orderCount || 0) - Number(a.orderCount || 0)
      if (diff) return diff
      return Number(b.totalAmount || 0) - Number(a.totalAmount || 0)
    })

    return { rows: nextRows, customerOrders: nextCustomerOrders }
  }, [allOrders, selectedYear, selectedMonth])

  const columns = useMemo(() => ([
    {
      title: '客户名称',
      dataIndex: 'customerName',
      key: 'customerName',
      width: '20%',
      align: 'center'
    },
    {
      title: '订单数量',
      dataIndex: 'orderCount',
      key: 'orderCount',
      width: '20%',
      align: 'center'
    },
    {
      title: '订单总金额',
      dataIndex: 'totalAmount',
      key: 'totalAmount',
      width: '20%',
      align: 'center',
      render: formatMoneyCell
    },
    {
      title: '订单利润',
      dataIndex: 'totalProfit',
      key: 'totalProfit',
      width: '20%',
      align: 'center',
      render: formatMoneyCell
    },
    {
      title: '操作',
      key: 'actions',
      width: '20%',
      align: 'center',
      render: (_, record) => (
        <Button
          type="link"
          onClick={() => {
            setDetailCustomerKey(record.key)
            setDetailCustomerName(record.customerName)
            setDetailOpen(true)
          }}
        >
          查看详情
        </Button>
      )
    }
  ]), [])

  const detailOrders = customerOrders[detailCustomerKey] || []

  useEffect(() => {
    if (!detailOpen) return
    const list = Array.isArray(detailOrders) ? detailOrders : []
    if (!list.length) return

    const baseNos = list
      .map((o) => normalizeOrderNo(o))
      .filter(Boolean)
    const parentNos = baseNos
      .filter((no) => isChildOrderNo(no))
      .map((no) => parentNoOfOrderNo(no))
      .filter(Boolean)
    const wanted = Array.from(new Set([...baseNos, ...parentNos]))
      .filter((no) => {
        if (Object.prototype.hasOwnProperty.call(detailOrderByNo || {}, no)) return false
        if (inflightDetailNoRef.current.has(no)) return false
        return true
      })

    if (!wanted.length) return
    let cancelled = false

    const queue = wanted.slice(0, 20)
    const limit = 4

    const worker = async () => {
      while (queue.length) {
        const no = queue.shift()
        if (!no) continue
        if (cancelled) return
        if (Object.prototype.hasOwnProperty.call(detailOrderByNo || {}, no)) continue
        if (inflightDetailNoRef.current.has(no)) continue
        inflightDetailNoRef.current.add(no)
        try {
          const fetched = unwrapOrderDetailResponse(await orderAPI.getOrderAny(no))
          if (cancelled) return
          setDetailOrderByNo((prev) => ({ ...(prev || {}), [no]: fetched || null }))
        } catch (_) {
          if (!cancelled) setDetailOrderByNo((prev) => ({ ...(prev || {}), [no]: null }))
        } finally {
          inflightDetailNoRef.current.delete(no)
        }
      }
    }

    Promise.allSettled(Array.from({ length: Math.min(limit, queue.length || 1) }, () => worker()))
    return () => { cancelled = true }
  }, [detailOpen, detailOrders, detailOrderByNo])

  const calcMetricsPreferDetail = (order) => {
    const no = normalizeOrderNo(order)
    if (no && Object.prototype.hasOwnProperty.call(detailOrderByNo || {}, no)) {
      const fetched = detailOrderByNo?.[no]
      const fetchedItems = readOrderItems(fetched)
      if (fetched && typeof fetched === 'object' && fetchedItems.length) {
        return calcMetricsFromDetailOrder(fetched)
      }
    }
    return calcOrderMetrics(order)
  }

  const detailTotals = useMemo(() => {
    const singles = new Map()
    const groups = new Map()

    ;(detailOrders || []).forEach((order, idx) => {
      const o = order && typeof order === 'object' ? order : {}
      const rawNo = normalizeOrderNo(o)
      if (!rawNo) return
      if (isChildOrderNo(rawNo)) {
        const parentNo = parentNoOfOrderNo(rawNo)
        if (!groups.has(parentNo)) groups.set(parentNo, [])
        groups.get(parentNo).push(o)
        return
      }
      const key = rawNo || String(idx)
      if (!singles.has(key)) singles.set(key, [])
      singles.get(key).push(o)
    })

    let totalAmount = 0
    let totalProfit = 0

    Array.from(groups.entries()).forEach(([parentNo, childrenOrders]) => {
      if (singles.has(parentNo)) singles.delete(parentNo)
      ;(childrenOrders || []).forEach((o) => {
        const m = calcMetricsPreferDetail(o)
        totalAmount += Number(m.amount || 0)
        totalProfit += Number(m.profit || 0)
      })
    })

    Array.from(singles.values()).forEach((ordersInSameNo) => {
      (ordersInSameNo || []).forEach((o) => {
        const m = calcMetricsPreferDetail(o)
        totalAmount += Number(m.amount || 0)
        totalProfit += Number(m.profit || 0)
      })
    })

    return { totalAmount, totalProfit }
  }, [detailOrders, detailOrderByNo])

  const yearOptions = useMemo(() => {
    const curr = dayjs().year()
    const out = []
    for (let y = curr; y >= 2023; y -= 1) {
      out.push({ label: `${y}年`, value: y })
    }
    return out
  }, [])

  const monthOptions = useMemo(() => (
    Array.from({ length: 12 }, (_, i) => ({ label: `${i + 1}月`, value: i + 1 }))
  ), [])

  const detailModalRows = useMemo(() => {
    const singles = new Map()
    const groups = new Map()

    ;(detailOrders || []).forEach((order, idx) => {
      const o = order && typeof order === 'object' ? order : {}
      const rawNo = normalizeOrderNo(o)
      if (!rawNo) return
      if (isChildOrderNo(rawNo)) {
        const parentNo = parentNoOfOrderNo(rawNo)
        if (!groups.has(parentNo)) groups.set(parentNo, [])
        groups.get(parentNo).push(o)
        return
      }
      const key = rawNo || String(idx)
      if (!singles.has(key)) singles.set(key, [])
      singles.get(key).push(o)
    })

    const output = []
    Array.from(groups.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'zh-CN'))
      .forEach(([parentNo, childrenOrders]) => {
        const parentArr = singles.get(parentNo)
        const parentOrder = Array.isArray(parentArr) && parentArr.length ? parentArr[0] : null
        if (singles.has(parentNo)) singles.delete(parentNo)

        const sortedChildren = [...childrenOrders].sort((a, b) => {
          const na = normalizeOrderNo(a)
          const nb = normalizeOrderNo(b)
          const pa = parseGroupedOrderNo(na)
          const pb = parseGroupedOrderNo(nb)
          const ia = pa.childSuffix && /^\d+$/.test(pa.childSuffix) ? Number(pa.childSuffix) : NaN
          const ib = pb.childSuffix && /^\d+$/.test(pb.childSuffix) ? Number(pb.childSuffix) : NaN
          if (Number.isFinite(ia) && Number.isFinite(ib)) return ia - ib
          if (pa.childSuffix && pb.childSuffix) {
            const diff = pa.childSuffix.localeCompare(pb.childSuffix, 'zh-CN')
            if (diff) return diff
          }
          return na.localeCompare(nb, 'zh-CN')
        })

        const parentDetail = Object.prototype.hasOwnProperty.call(detailOrderByNo || {}, parentNo) ? detailOrderByNo?.[parentNo] : null
        const parentDetailObj = (parentDetail && typeof parentDetail === 'object') ? parentDetail : null
        const parentSource = parentDetailObj || parentOrder
        const parentHasMultiSku = Boolean(parentDetailObj && readOrderItems(parentDetailObj).length > 1)

        let parentQty = sortedChildren.reduce((sum, o) => sum + (calcOrderQty(o) || 0), 0)
        let parentAmount = 0
        let parentProfit = 0

        if (parentHasMultiSku) {
          const m = calcMetricsFromDetailOrder(parentDetailObj)
          parentQty = calcOrderQty(parentDetailObj) || 0
          parentAmount = Number(m.amount || 0)
          parentProfit = Number(m.profit || 0)
        } else {
          const childrenMetrics = sortedChildren.reduce((acc, o) => {
            const m = calcMetricsPreferDetail(o)
            acc.amount += Number(m.amount || 0)
            acc.profit += Number(m.profit || 0)
            return acc
          }, { amount: 0, profit: 0 })
          const parentMetricsFallback = parentOrder ? calcMetricsPreferDetail(parentOrder) : { amount: 0, profit: 0 }
          parentAmount = (childrenMetrics.amount || childrenMetrics.profit)
            ? childrenMetrics.amount
            : Number(parentMetricsFallback.amount || 0)
          parentProfit = (childrenMetrics.amount || childrenMetrics.profit)
            ? childrenMetrics.profit
            : Number(parentMetricsFallback.profit || 0)
        }

        const parentStatusKey = normalizeStatus(parentSource?.status) || deriveParentStatus(parentOrder, sortedChildren)
        const parentStatusCfg = statusDisplay(parentStatusKey)
        const childCreatedTs = sortedChildren.map(o => orderCreatedAtTs(o)).filter((v) => Number.isFinite(Number(v)))
        const minChildCreatedTs = childCreatedTs.length ? Math.min(...childCreatedTs) : undefined
        const parentCreatedTs = orderCreatedAtTs(parentSource) ?? minChildCreatedTs
        const parentCreatedAtText = parentCreatedTs ? dayjs(parentCreatedTs).format('YYYY-MM-DD HH:mm') : '-'

        const singleChildFlattenSource = (() => {
          if (parentHasMultiSku) return null
          if (sortedChildren.length !== 1) return null
          const only = sortedChildren[0]
          const onlyNo = normalizeOrderNo(only)
          if (!onlyNo) return null
          const parsed = parseGroupedOrderNo(onlyNo)
          const isChildOfParent = parsed.isChild && parsed.parentNo === parentNo
          const isFirstNumericChild = isChildOfParent && String(parsed.childSuffix || '') === '1'
          if (!isFirstNumericChild) return null
          const fetched = onlyNo ? detailOrderByNo?.[onlyNo] : null
          const fetchedObj = (fetched && typeof fetched === 'object') ? fetched : null
          const source = (fetchedObj && readOrderItems(fetchedObj).length) ? fetchedObj : only
          return readOrderItems(source).length > 1 ? source : null
        })()

        const childrenRows = parentHasMultiSku
          ? skuRowsForOrder(parentDetailObj, `parent:${parentNo}`)
          : singleChildFlattenSource
            ? skuRowsForOrderWithBaseNo(singleChildFlattenSource, `parent:${parentNo}`, parentNo)
            : sortedChildren.map((o, i) => {
            const no = normalizeOrderNo(o)
            const fetched = no ? detailOrderByNo?.[no] : null
            const fetchedObj = (fetched && typeof fetched === 'object') ? fetched : null
            const source = (fetchedObj && readOrderItems(fetchedObj).length) ? fetchedObj : o
            const s = orderSummary(o)
            const m = calcMetricsPreferDetail(o)
            const childKey = `child:${no || parentNo}:${i}`
            return {
              key: childKey,
              createdAtText: s.createdAtText,
              orderNo: s.orderNo || '-',
              goodsName: s.goodsName,
              spec: s.spec,
              materialNo: s.materialNo,
              quantity: s.quantity,
              amount: Number(m.amount || 0),
              profit: Number(m.profit || 0),
              statusText: s.statusText,
              statusColor: s.statusColor,
              __isChild: true,
              __isParent: false
            }
          })

        output.push({
          key: `parent:${parentNo}`,
          createdAtText: parentCreatedAtText,
          orderNo: parentNo,
          goodsName: '',
          spec: '',
          materialNo: '',
          quantity: parentQty,
          amount: parentAmount,
          profit: parentProfit,
          statusText: parentStatusCfg.text || '-',
          statusColor: parentStatusCfg.color,
          __isParent: true,
          children: childrenRows
        })
      })

    Array.from(singles.entries())
      .sort((a, b) => String(a[0]).localeCompare(String(b[0]), 'zh-CN'))
      .forEach(([rawNo, ordersInSameNo]) => {
        (ordersInSameNo || []).forEach((o, i) => {
          const no = normalizeOrderNo(o)
          const fetched = no ? detailOrderByNo?.[no] : null
          const fetchedObj = (fetched && typeof fetched === 'object') ? fetched : null
          const source = (fetchedObj && readOrderItems(fetchedObj).length) ? fetchedObj : o
          const items = readOrderItems(source)
          if (items.length > 1) {
            const s = orderSummary(o)
            const m = calcMetricsPreferDetail(o)
            const parentKey = `single:${rawNo}:${i}`
            output.push({
              key: parentKey,
              createdAtText: s.createdAtText,
              orderNo: s.orderNo || rawNo || '-',
              goodsName: '',
              spec: '',
              materialNo: '',
              quantity: s.quantity,
              amount: Number(m.amount || 0),
              profit: Number(m.profit || 0),
              statusText: s.statusText,
              statusColor: s.statusColor,
              __isParent: true,
              children: skuRowsForOrder(source, parentKey)
            })
            return
          }
          const s = orderSummary(o)
          const m = calcMetricsPreferDetail(o)
          const key = `single:${rawNo}:${i}`
          output.push({
            key,
            createdAtText: s.createdAtText,
            orderNo: s.orderNo || rawNo || '-',
            goodsName: s.goodsName,
            spec: s.spec,
            materialNo: s.materialNo,
            quantity: s.quantity,
            amount: Number(m.amount || 0),
            profit: Number(m.profit || 0),
            statusText: s.statusText,
            statusColor: s.statusColor,
            __isParent: false
          })
        })
      })

    return output
  }, [detailOrders, detailOrderByNo])

  const detailColumns = useMemo(() => ([
    { title: '下单时间', dataIndex: 'createdAtText', key: 'createdAtText', width: '14%', align: 'center' },
    { title: '订单号', dataIndex: 'orderNo', key: 'orderNo', width: '16%', align: 'center' },
    {
      title: '商品名称',
      dataIndex: 'goodsName',
      key: 'goodsName',
      width: '14%',
      align: 'center',
      render: (v, r) => (r.__isParent ? null : (v || '-'))
    },
    {
      title: '规格',
      dataIndex: 'spec',
      key: 'spec',
      width: '12%',
      align: 'center',
      render: (v, r) => (r.__isParent ? null : (v || '-'))
    },
    {
      title: '物料号',
      dataIndex: 'materialNo',
      key: 'materialNo',
      width: '10%',
      align: 'center',
      render: (v, r) => (r.__isParent ? null : (v || '-'))
    },
    { title: '订单数量', dataIndex: 'quantity', key: 'quantity', width: '8%', align: 'center' },
    { title: '订单金额', dataIndex: 'amount', key: 'amount', width: '10%', align: 'center', render: formatMoneyCellWithDigits(3) },
    { title: '订单利润', dataIndex: 'profit', key: 'profit', width: '10%', align: 'center', render: formatMoneyCellWithDigits(3) },
    {
      title: '订单状态',
      dataIndex: 'statusText',
      key: 'statusText',
      width: '6%',
      align: 'center',
      render: (_, r) => <Tag color={r.statusColor}>{r.statusText}</Tag>
    }
  ]), [])

  useEffect(() => {
    if (!detailOpen) return
    setDetailExpandedKeys([])
  }, [detailCustomerKey, detailOpen])

  const detailExpandableKeySet = useMemo(() => {
    const set = new Set()
    const walk = (list) => {
      (Array.isArray(list) ? list : []).forEach((r) => {
        const children = Array.isArray(r?.children) ? r.children : []
        if (children.length) {
          set.add(String(r?.key ?? ''))
          walk(children)
        }
      })
    }
    walk(detailModalRows)
    return set
  }, [detailModalRows])

  const visibleDetailExpandedKeys = useMemo(() => {
    const keys = Array.isArray(detailExpandedKeys) ? detailExpandedKeys.map(String) : []
    return keys.filter((k) => detailExpandableKeySet.has(k))
  }, [detailExpandedKeys, detailExpandableKeySet])

  const toggleDetailExpand = useCallback((record) => {
    const k = String(record?.key ?? '').trim()
    if (!k) return
    setDetailExpandedKeys((prev) => {
      const current = Array.isArray(prev) ? prev.map(String) : []
      const exists = current.includes(k)
      return exists ? current.filter((x) => x !== k) : [...current, k]
    })
  }, [])

  const setDetailExpandedForRecord = useCallback((record, expanded) => {
    const k = String(record?.key ?? '').trim()
    if (!k) return
    setDetailExpandedKeys((prev) => {
      const current = Array.isArray(prev) ? prev.map(String) : []
      return expanded ? (current.includes(k) ? current : [...current, k]) : current.filter((x) => x !== k)
    })
  }, [])

  const detailExpandable = useMemo(() => ({
    rowExpandable: (record) => Array.isArray(record?.children) && record.children.length > 0,
    expandedRowKeys: visibleDetailExpandedKeys,
    onExpand: (expanded, record) => setDetailExpandedForRecord(record, expanded),
    indentSize: 18,
    childrenColumnName: 'children'
  }), [setDetailExpandedForRecord, visibleDetailExpandedKeys])

  return (
    <ConfigProvider locale={zhCN}>
      <div>
        <Row justify="space-between" align="middle" style={{ marginBottom: 16 }}>
          <Space align="center">
            <h2 className="page-title" style={{ marginBottom: 0 }}>订单统计表</h2>
            <Select
              value={selectedYear}
              onChange={setSelectedYear}
              style={{ width: 120 }}
              options={yearOptions}
            />
            <Select
              value={selectedMonth}
              onChange={setSelectedMonth}
              style={{ width: 120 }}
              options={monthOptions}
            />
            <Button onClick={() => loadData({ force: true })} loading={loading}>刷新</Button>
          </Space>
          <Button onClick={() => navigate('/orders')}>返回</Button>
        </Row>
        <Card>
          <Table
            loading={loading}
            rowKey="key"
            dataSource={rows}
            columns={columns}
            pagination={{ pageSize: 20 }}
            tableLayout="fixed"
          />
        </Card>

        <Modal
          title={detailCustomerName ? `订单详情：${detailCustomerName}` : '订单详情'}
          open={detailOpen}
          onCancel={() => setDetailOpen(false)}
          footer={null}
          width={1100}
          destroyOnClose
        >
          <Table
            size="small"
            pagination={false}
            rowKey="key"
            tableLayout="fixed"
            dataSource={detailModalRows}
            columns={detailColumns}
            expandable={detailExpandable}
            onRow={(record) => {
              const canExpand = Array.isArray(record?.children) && record.children.length > 0
              const isChildRow = Boolean(record?.__isChild)
              return {
                style: {
                  background: isChildRow ? '#fafafa' : undefined
                },
                onClick: (ev) => {
                  const target = ev?.target
                  if (target && typeof target.closest === 'function') {
                    const hit = target.closest('a,button,input,textarea,select,.ant-checkbox-wrapper,.ant-checkbox,.ant-btn')
                    if (hit) return
                  }
                  if (canExpand) toggleDetailExpand(record)
                }
              }
            }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 24, marginTop: 12 }}>
            <div>下单总金额：{formatMoneyCellWithDigits(3)(detailTotals.totalAmount)}</div>
            <div>利润金额：{formatMoneyCellWithDigits(3)(detailTotals.totalProfit)}</div>
          </div>
        </Modal>
      </div>
    </ConfigProvider>
  )
}

export default OrderStats
