import React, { useEffect, useState, useRef } from 'react'
import { App, Row, Col, Card, Statistic, Tabs, Table, Radio, Button, Form, Input, DatePicker, Modal, Select, ConfigProvider, Space, Grid } from 'antd'
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'
import { Column, Pie, Mix } from '@ant-design/charts'
import dayjs from 'dayjs'
import { employeeAPI, fixedCostAPI, payableAPI } from '../services/api'
import { cachedOrderAPI, cachedCustomerAPI, cachedPurchaseAPI } from '../services/cachedAPI'
import { useAuthStore } from '@/stores/authStore'
import zhCN from 'antd/locale/zh_CN'
import 'dayjs/locale/zh-cn'

dayjs.locale('zh-cn')

const boardCostEffectiveFromTs = dayjs('2026-01-11').startOf('day').valueOf()

function DataManagement() {
  const { message } = App.useApp()
  const { user, isAuthenticated } = useAuthStore()
  const screens = Grid.useBreakpoint()
  const [activeKey, setActiveKey] = useState('business')
  const [orders, setOrders] = useState([])
  const [customers, setCustomers] = useState([])
  const [rawMaterialPurchaseOrders, setRawMaterialPurchaseOrders] = useState([])
  const [salesTrendRange, setSalesTrendRange] = useState('month')
  const [customerRankMode, setCustomerRankMode] = useState('month')
  const [businessLoading, setBusinessLoading] = useState(false)
  const [businessCloudLoading, setBusinessCloudLoading] = useState(false)
  const businessDataLoadedRef = useRef(false)
  const businessDataLoadingRef = useRef(false)
  const trendClickHandlerRef = useRef(null)
  const [trendDetailOpen, setTrendDetailOpen] = useState(false)
  const [trendDetailMeta, setTrendDetailMeta] = useState({ rawKey: '', label: '', mode: 'month' })
  const [trendDetailRows, setTrendDetailRows] = useState([])
  const [costRangeMode, setCostRangeMode] = useState('lastMonth')
  const [costYear, setCostYear] = useState(() => dayjs().year())
  const [fixedCostRangeMode, setFixedCostRangeMode] = useState('lastMonth')
  const [fixedCostYear, setFixedCostYear] = useState(() => dayjs().year())
  const [overallRangeMode, setOverallRangeMode] = useState('lastMonth')
  const [overallYear, setOverallYear] = useState(() => dayjs().year() - 1)
  const [businessStats, setBusinessStats] = useState({
    currentSales: 0,
    lastSales: 0,
    yearSales: 0,
    salesYoY: 0,
    currentGrossProfit: 0,
    currentGrossMargin: 0,
    trend: [],
    quarterlyData: [],
    topCustomers: [],
    lastMonthProductionCost: 0,
    lastMonthPurchaseCost: 0,
    lastMonthScrapCost: 0,
    lastMonthRawMaterialPurchaseCost: 0
  })
  const [materialPriceMap, setMaterialPriceMap] = useState({})
  const [manualMaterialPriceMap, setManualMaterialPriceMap] = useState({})
  const manualMaterialPriceRef = useRef({})
  const [manualOrderMaterialPriceMap, setManualOrderMaterialPriceMap] = useState({})
  const manualOrderMaterialPriceRef = useRef({})
  const [employeeStats, setEmployeeStats] = useState({
    employeeCount: 0,
    lastMonthSalaryTotal: 0,
    lastMonthFixedCost: 0,
    salaryMonthly: {},
    fixedCostMonthly: {}
  })
  const [costMonthlyStats, setCostMonthlyStats] = useState({})
  const [fixedCostItems, setFixedCostItems] = useState([])
  const [fixedCostModalOpen, setFixedCostModalOpen] = useState(false)
  const [fixedCostForm] = Form.useForm()
  const [receivablePaymentMap, setReceivablePaymentMap] = useState({})
  const [manualPayables, setManualPayables] = useState([])
  const [businessCloud, setBusinessCloud] = useState({
    orderAmountTotal: 0,
    rawMaterialCostTotal: 0,
    grossProfit: 0,
    grossMargin: 0,
    trend: []
  })
  const [efficiencyMonthStats, setEfficiencyMonthStats] = useState({
    rawMaterialCostTotal: null
  })

  const userId = String(user?.id || '').trim()
  const getScopedStorageKey = (baseKey) => (userId ? `${baseKey}__${userId}` : baseKey)
  const receivablePaymentMapStorageKey = getScopedStorageKey('erp_receivablePaymentMap')

  const normalizeTimeForBusiness = (value) => {
    if (!value) return 0
    if (typeof value === 'number') return value
    const d = dayjs(value)
    if (!d.isValid()) return 0
    return d.valueOf()
  }

  const getOrderAmountForBusiness = (order) => {
    if (order == null) return 0
    const directCandidates = [
      order.totalAmount,
      order.amount,
      order.finalAmount,
      order.orderAmount
    ]
    for (let i = 0; i < directCandidates.length; i += 1) {
      const n = Number(directCandidates[i])
      if (Number.isFinite(n) && n !== 0) return n
    }
    if (Array.isArray(order.items)) {
      const sum = order.items.reduce((acc, item) => {
        if (!item) return acc
        const itemCandidates = [
          item.totalPrice,
          item.totalAmount,
          item.amount,
          item.finalAmount,
          item.price
        ]
        for (let j = 0; j < itemCandidates.length; j += 1) {
          const v = Number(itemCandidates[j])
          if (Number.isFinite(v) && v !== 0) return acc + v
        }
        const qty = Number(item.quantity || 0)
        const unitPrice = Number(item.salePrice ?? item.unitPrice ?? item.price ?? 0)
        if (Number.isFinite(qty) && Number.isFinite(unitPrice) && qty > 0 && unitPrice > 0) {
          return acc + qty * unitPrice
        }
        return acc
      }, 0)
      if (Number.isFinite(sum) && sum !== 0) return sum
    }
    const quantity =
      order.quantity ??
      order.totalQty ??
      (Array.isArray(order.items)
        ? order.items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
        : 0)
    const unitPrice = Number(order.salePrice ?? order.unitPrice ?? 0)
    if (Number.isFinite(quantity) && Number.isFinite(unitPrice) && quantity > 0 && unitPrice > 0) {
      return quantity * unitPrice
    }
    return 0
  }

  const getTrendBucketKeyForBusiness = (ts, mode) => {
    const d = dayjs(ts)
    if (!d.isValid()) return ''
    if (mode === 'month') return d.format('YYYY-MM-DD')
    if (mode === 'quarter') return d.format('YYYY-MM')
    return d.format('YYYY')
  }

  const openTrendDetail = (rawKey, label, mode) => {
    if (!rawKey) return
    if (mode !== 'month') return
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(rawKey))) return
    const base = Array.isArray(orders) ? orders : []
    const rows = base
      .map((order, idx) => {
        const ts = normalizeTimeForBusiness(
          order?.createdAt ||
          order?.createTime ||
          order?._createTime ||
          order?.orderTime ||
          order?.updatedAt ||
          order?.updateTime
        )
        if (!ts) return null
        const bucketKey = getTrendBucketKeyForBusiness(ts, mode)
        if (bucketKey !== rawKey) return null
        const amount = getOrderAmountForBusiness(order)
        const sourceVal = String(order?.source || '').toLowerCase()
        const orderTypeVal = String(order?.orderType || '').toLowerCase()
        const categoryVal = String(order?.purchaseCategory || order?.category || '').toLowerCase()
        const isPurchaseExact = sourceVal === 'purchased' || orderTypeVal === 'purchase'
        const isGoodsPurchase = isPurchaseExact && categoryVal === 'goods'
        if (isPurchaseExact && !isGoodsPurchase) return null
        const items = Array.isArray(order?.items) ? order.items : []
        const first = items[0] || {}
        const qty =
          order?.quantity ??
          order?.totalQty ??
          (Array.isArray(order?.items)
            ? order.items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
            : 0)
        const salesUnitPrice = Number(order?.unitPrice ?? order?.salePrice ?? first?.unitPrice ?? 0)
        const purchaseUnitPrice = Number(order?.salePrice ?? first?.unitPrice ?? order?.unitPrice ?? 0)
        const createdAtRaw = order?.createdAt || order?.createTime || order?.orderTime || order?._createTime || null
        const createdAtText = createdAtRaw && dayjs(createdAtRaw).isValid() ? dayjs(createdAtRaw).format('YYYY-MM-DD HH:mm') : ''
        return {
          key: order?._id ?? order?.id ?? order?.orderNo ?? order?.orderNumber ?? `trend_${rawKey}_${idx}`,
          kind: isPurchaseExact ? '商品采购' : '销售订单',
          orderNo: order?.orderNo ?? order?.orderNumber ?? '',
          customerName: order?.customerName ?? '',
          supplierName: order?.supplierName ?? '',
          goodsName: order?.goodsName || order?.productTitle || order?.productName || first?.goodsName || first?.title || first?.productName || '',
          materialNo: order?.materialNo ?? first?.materialNo ?? '',
          quantity: Number(qty || 0),
          salesUnitPrice,
          purchaseUnitPrice,
          amount: Number(amount || 0),
          createdAtText,
          isPurchase: isPurchaseExact
        }
      })
      .filter(Boolean)
      .sort((a, b) => String(b.createdAtText || '').localeCompare(String(a.createdAtText || '')))
    setTrendDetailMeta({ rawKey, label, mode })
    setTrendDetailRows(rows)
    setTrendDetailOpen(true)
  }

  const businessTrendOnReady = (plot) => {
    if (!plot) return
    if (trendClickHandlerRef.current) {
      try { plot.off('element:click', trendClickHandlerRef.current) } catch { void 0 }
    }
    const handler = (evt) => {
      const datum = evt?.data?.data ?? evt?.data?.datum ?? null
      const rawKey = datum?.rawKey || ''
      const label = datum?.date || ''
      openTrendDetail(rawKey, label, salesTrendRange)
    }
    trendClickHandlerRef.current = handler
    plot.on('element:click', handler)
  }

  const normalizeFixedCostItems = (items) => {
    if (!Array.isArray(items)) return []
    return items
      .map((item) => {
        if (!item) return null
        const id = item.id || item._id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
        const category = String(item.category || '').trim() || '未分类'
        const amount = Number(item.amount || 0)
        const rawDate = item.date || item.createdAt
        let date = null
        if (typeof rawDate === 'number') {
          date = rawDate
        } else if (rawDate) {
          const d = dayjs(rawDate)
          if (d.isValid()) {
            date = d.valueOf()
          }
        }
        const remark = item.remark ? String(item.remark) : ''
        if (!Number.isFinite(amount) || amount <= 0) return null
        if (!Number.isFinite(date) || date <= 0) return null
        return { id, category, amount, date, remark }
      })
      .filter(Boolean)
  }

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('erp_manualMaterialPriceMap')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          setManualMaterialPriceMap(parsed)
          manualMaterialPriceRef.current = parsed
        }
      }
    } catch (e) {
      void e
    }
  }, [])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem('erp_manualOrderMaterialPriceMap')
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          setManualOrderMaterialPriceMap(parsed)
          manualOrderMaterialPriceRef.current = parsed
        }
      }
    } catch (e) {
      void e
    }
  }, [])

  const getOrderOverridePrice = (orderNo) => {
    const key = String(orderNo || '').trim()
    if (!key) return 0
    const map = manualOrderMaterialPriceRef.current || manualOrderMaterialPriceMap || {}
    const cfg = map[key]
    if (cfg == null) return 0
    if (typeof cfg === 'number') return Number(cfg || 0)
    if (cfg && typeof cfg === 'object') return Number(cfg.price || 0)
    return 0
  }

  useEffect(() => {
    if (activeKey !== 'finance') return
    try {
      const rawPrimary = window.localStorage.getItem(receivablePaymentMapStorageKey)
      const rawFallback = userId ? window.localStorage.getItem('erp_receivablePaymentMap') : null
      const raw = rawPrimary || rawFallback
      const parsed = raw ? JSON.parse(raw) : null
      setReceivablePaymentMap(parsed && typeof parsed === 'object' ? parsed : {})
    } catch (e) {
      setReceivablePaymentMap({})
    }
    const loadPayables = async () => {
      try {
        const items = await payableAPI.list({ page: 1, limit: 500, orderBy: 'updatedAt_desc' })
        if (Array.isArray(items)) {
          setManualPayables(items)
          return
        }
      } catch (e) {
        void e
      }

      setManualPayables([])
    }

    loadPayables()
  }, [activeKey, userId, receivablePaymentMapStorageKey])

  useEffect(() => {
    const loadFixedCosts = async () => {
      try {
        const items = await fixedCostAPI.list()
        if (Array.isArray(items)) {
          setFixedCostItems(normalizeFixedCostItems(items))
        } else {
          setFixedCostItems([])
        }
      } catch (e) {
        setFixedCostItems([])
        message.error('加载固定成本数据失败')
      }
    }
    loadFixedCosts()
  }, [message])

  useEffect(() => {
    const baseDay = dayjs()
    const lastMonthMoment = baseDay.subtract(1, 'month')
    const lastYear = lastMonthMoment.year()
    const lastMonth = lastMonthMoment.month() + 1

    const loadEmployees = async () => {
      try {
        const res = await employeeAPI.getEmployees({})
        let list = []
        const payload = res && typeof res === 'object' && 'data' in res ? res.data : res
        if (Array.isArray(payload)) {
          list = payload
        } else if (Array.isArray(payload?.data)) {
          list = payload.data
        } else if (Array.isArray(payload?.employees)) {
          list = payload.employees
        } else if (Array.isArray(payload?.data?.employees)) {
          list = payload.data.employees
        }
        let employeeCount = 0
        let lastMonthSalaryTotal = 0
        const fixedCostPerEmployee = 0
        const salaryMonthlyMap = new Map()
        const fixedCostMonthlyMap = new Map()
        const toNumber = (v) => {
          if (v === null || v === undefined || v === '') return undefined
          const n = Number(v)
          return Number.isFinite(n) ? n : undefined
        }
        const computeRowSalary = (row) => {
          if (!row) return 0
          const rowDailySalary = toNumber(row.dailySalary)
          const rowHourlySalary = toNumber(row.hourlySalary)
          const rowAttendanceDays = toNumber(row.attendanceDays)
          const rowSubsidyPerDay = toNumber(row.subsidyPerDay)
          const rowOvertimeHours = toNumber(row.overtimeHours)
          const rowBonus = toNumber(row.bonus)
          const hasNormal = rowAttendanceDays !== undefined && rowDailySalary !== undefined
          const hasOvertime = rowOvertimeHours !== undefined && rowHourlySalary !== undefined
          const hasSubsidy = rowAttendanceDays !== undefined && rowSubsidyPerDay !== undefined
          const normalSalary = hasNormal ? rowAttendanceDays * rowDailySalary : undefined
          const overtimeSalary = hasOvertime ? rowOvertimeHours * rowHourlySalary : undefined
          const subsidyTotal = hasSubsidy ? rowAttendanceDays * rowSubsidyPerDay : undefined
          const parts = [normalSalary, overtimeSalary, subsidyTotal, rowBonus].filter(
            (v) => v !== undefined && !Number.isNaN(Number(v))
          )
          const totalRow = parts.length > 0
            ? parts.reduce((sum, v) => sum + Number(v), 0)
            : undefined
          if (!Number.isFinite(totalRow) || totalRow <= 0) {
            return 0
          }
          return totalRow
        }
        list.forEach((item) => {
          const status = String(item.status || '').toLowerCase()
          if (status === 'left') {
            return
          }
          employeeCount += 1
          const details = Array.isArray(item.salaryDetails) ? item.salaryDetails : []
          details.forEach((detail) => {
            if (!detail) return
            const month = Number(detail.month)
            const year = Number(detail.year)
            if (!Number.isFinite(month) || month < 1 || month > 12) {
              return
            }
            if (!Number.isFinite(year)) {
              return
            }
            const ymKey = `${year}-${String(month).padStart(2, '0')}`
            const totalRow = computeRowSalary(detail)
            if (totalRow > 0) {
              const prevSalary = salaryMonthlyMap.get(ymKey) || 0
              salaryMonthlyMap.set(ymKey, prevSalary + totalRow)
              if (year === lastYear && month === lastMonth) {
                lastMonthSalaryTotal += totalRow
              }
            }
          })
        })
        const lastMonthFixedCost = employeeCount * fixedCostPerEmployee
        const salaryMonthly = {}
        salaryMonthlyMap.forEach((val, key) => {
          salaryMonthly[key] = Number(val.toFixed(2))
        })
        const fixedCostMonthly = {}
        fixedCostMonthlyMap.forEach((val, key) => {
          fixedCostMonthly[key] = Number(val.toFixed(2))
        })
        setEmployeeStats({
          employeeCount,
          lastMonthSalaryTotal,
          lastMonthFixedCost,
          salaryMonthly,
          fixedCostMonthly
        })
      } catch (e) {
        setEmployeeStats({
          employeeCount: 0,
          lastMonthSalaryTotal: 0,
          lastMonthFixedCost: 0,
          salaryMonthly: {},
          fixedCostMonthly: {}
        })
      }
    }
    loadEmployees()
  }, [])

  const getOverridePrice = (materialKey, date) => {
    if (!materialKey) return 0
    const map = manualMaterialPriceRef.current || manualMaterialPriceMap || {}
    const cfg = map[materialKey]
    if (cfg == null) return 0
    if (typeof cfg === 'number') {
      return Number(cfg || 0)
    }
    const hasRanges = Array.isArray(cfg.ranges) && cfg.ranges.length > 0
    if (date && hasRanges) {
      const ts = dayjs(date).valueOf()
      if (Number.isFinite(ts)) {
        for (let i = cfg.ranges.length - 1; i >= 0; i -= 1) {
          const item = cfg.ranges[i]
          if (!item) continue
          const s = Number(item.startTs)
          const e = Number(item.endTs)
          if (!Number.isFinite(s) || !Number.isFinite(e)) continue
          if (ts >= s && ts <= e) {
            return Number(item.price || 0)
          }
        }
      }
    }
    if (cfg.globalPrice != null) {
      return Number(cfg.globalPrice || 0)
    }
    return 0
  }

  const getEffectiveSheetCount = (order, firstItem) => {
    if (!order) return 0
    const first = firstItem || {}
    const sheetCountRaw =
      order.sheetCount ??
      order.sheet_count ??
      order.sheetQty ??
      order.sheet_qty ??
      first.sheetCount ??
      first.sheet_count ??
      first.sheetQty ??
      first.sheet_qty ??
      undefined
    const n = Number(sheetCountRaw)
    return Number.isFinite(n) && n > 0 ? n : 0
  }

  const computeEfficiencyStatsForRange = (salesOrdersInput, purchaseOrdersInput, boardPurchaseOrderMapInput, rangeStartTs, rangeEndTs) => {
    const startTs = Number(rangeStartTs)
    const endTs = Number(rangeEndTs)
    if (!(startTs > 0) || !(endTs > 0) || startTs > endTs) {
      return { orderAmountTotal: 0, grossProfit: 0, grossMargin: 0, rawMaterialCostTotal: 0 }
    }

    const salesOrders = Array.isArray(salesOrdersInput) ? salesOrdersInput : []
    const purchaseOrders = Array.isArray(purchaseOrdersInput) ? purchaseOrdersInput : []
    const boardPurchaseOrderMap = boardPurchaseOrderMapInput instanceof Map ? boardPurchaseOrderMapInput : new Map()

    const getPurchaseCategoryKey = (order) => {
      const raw = order?.purchaseCategory ?? order?.category ?? ''
      return String(raw).trim().toLowerCase()
    }

    const isRawMaterialPurchase = (order) => {
      const category = getPurchaseCategoryKey(order)
      if (category) {
        return (
          category === 'raw_materials' ||
          category === 'raw-materials' ||
          category === 'rawmaterials' ||
          category.includes('raw') ||
          category.includes('material') ||
          category.includes('原材料')
        )
      }
      const items = Array.isArray(order?.items) ? order.items : []
      const first = items[0] || {}
      const title =
        order?.goodsName ||
        order?.productTitle ||
        first?.goodsName ||
        first?.title ||
        first?.productName ||
        order?.title ||
        ''
      const material =
        order?.materialCode ??
        first?.materialCode ??
        order?.materialNo ??
        first?.materialNo ??
        ''
      const text = `${title} ${material}`.toLowerCase()
      return text.includes('原材料') || text.includes('纸') || text.includes('瓦楞')
    }

    const shouldIncludeGoodsPurchaseInGrossProfit = (order) => {
      const category = getPurchaseCategoryKey(order)
      if (category) return category === 'goods'
      const items = Array.isArray(order?.items) ? order.items : []
      const first = items[0] || {}
      const title =
        order?.goodsName ||
        order?.productTitle ||
        first?.goodsName ||
        first?.title ||
        first?.productName ||
        order?.title ||
        ''
      const material =
        order?.materialCode ??
        first?.materialCode ??
        order?.materialNo ??
        first?.materialNo ??
        ''
      const text = `${title} ${material}`.toLowerCase()
      if (!text.trim()) return true
      return !text.includes('纸板') && !text.includes('原材料') && !text.includes('瓦楞')
    }

    const materialPriceMapLocal = new Map()
    const purchasePriceByOrderNo = new Map()

    purchaseOrders.forEach((o) => {
      if (!o) return
      if (!isRawMaterialPurchase(o)) return
      const items = Array.isArray(o.items) ? o.items : []
      const first = items[0] || {}
      const materialNo =
        o.materialNo ??
        (first && first.materialNo) ??
        ''
      const quantity = Number(
        o.quantity ??
        o.totalQty ??
        (Array.isArray(o.items)
          ? o.items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
          : 0)
      )
      const rawUnitPrice = Number(
        o.salePrice ??
        (first && first.unitPrice) ??
        o.unitPrice ??
        0
      )
      const orderNo = String(o.orderNo ?? o.orderNumber ?? '').trim()

      const qty = Number(quantity || 0)
      const price = Number(rawUnitPrice || 0)
      if (materialNo && qty > 0 && price > 0) {
        const prev = materialPriceMapLocal.get(materialNo) || { qty: 0, amount: 0 }
        materialPriceMapLocal.set(materialNo, {
          qty: prev.qty + qty,
          amount: prev.amount + price * qty
        })
      }
      if (orderNo && price > 0) {
        purchasePriceByOrderNo.set(orderNo, price)
      }
    })

    const getTs = (rawDate) => {
      if (!rawDate) return 0
      const d = dayjs(rawDate)
      if (!d.isValid()) return 0
      const ts = d.valueOf()
      return Number.isFinite(ts) ? ts : 0
    }

    let totalOrderAmount = 0
    let totalGrossProfit = 0
    let totalRawMaterialCost = 0

    salesOrders.forEach((o) => {
      if (!o) return
      const items = Array.isArray(o.items) ? o.items : []
      const first = items[0] || {}
      const quantity =
        o.quantity ??
        o.totalQty ??
        (Array.isArray(o.items)
          ? o.items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
          : 0)
      const unitPrice = Number(o.unitPrice ?? first.unitPrice ?? 0)
      const materialCode = o.materialCode ?? (first && first.materialCode) ?? ''
      const materialNo = o.materialNo ?? (first && first.materialNo) ?? ''
      const boardWidth = o.boardWidth ?? (first && first.boardWidth) ?? undefined
      const boardHeight = o.boardHeight ?? (first && first.boardHeight) ?? undefined
      const orderAmount = Number(
        o.amount ??
        o.totalAmount ??
        o.finalAmount ??
        Number(quantity || 0) * Number(unitPrice || 0)
      )
      const rawDate = o.createTime ?? o.createdAt ?? null
      const ts = getTs(rawDate)
      if (!ts || ts < startTs || ts > endTs) return

      const materialKey = materialCode || materialNo || ''
      const entry = materialNo ? materialPriceMapLocal.get(materialNo) : undefined
      const mapPrice = entry && entry.qty > 0 ? entry.amount / entry.qty : 0
      const orderNo = String(o.orderNo ?? o.orderNumber ?? '').trim()
      const directOrderPrice = orderNo ? (purchasePriceByOrderNo.get(orderNo) || 0) : 0
      const orderOverridePrice = getOrderOverridePrice(orderNo)
      const materialSqmPrice = getOverridePrice(materialKey, rawDate)

      const width = Number(boardWidth || 0)
      const height = Number(boardHeight || 0)
      const effectiveWidth = width > 0 ? width + 30 : 0
      const area =
        effectiveWidth > 0 && height > 0
          ? (effectiveWidth * height) / 1000000
          : 0

      const effectiveSheetCount = getEffectiveSheetCount(o, first)
      const purchaseOrderId = String(o?.purchaseOrderId || '').trim()
      const boardPurchaseAmount = purchaseOrderId ? (Number(boardPurchaseOrderMap.get(purchaseOrderId) || 0)) : 0
      const useBoardPurchaseAmount =
        Number.isFinite(ts) &&
        ts >= boardCostEffectiveFromTs &&
        boardPurchaseAmount > 0
      let rawMaterialCost = 0
      if (useBoardPurchaseAmount) {
        rawMaterialCost = boardPurchaseAmount
      } else if (orderOverridePrice > 0 && area > 0 && effectiveSheetCount > 0) {
        rawMaterialCost = effectiveSheetCount * (area * orderOverridePrice)
      } else if ((directOrderPrice > 0 || mapPrice > 0) && effectiveSheetCount > 0) {
        const perSheetPurchasePrice = directOrderPrice || mapPrice
        rawMaterialCost = effectiveSheetCount * perSheetPurchasePrice
      } else if (materialSqmPrice > 0 && area > 0 && effectiveSheetCount > 0) {
        rawMaterialCost = effectiveSheetCount * (area * materialSqmPrice)
      }

      const usedOrderAmount = Number.isFinite(orderAmount) ? orderAmount : 0
      const usedRawMaterialCost = Number.isFinite(rawMaterialCost) ? rawMaterialCost : 0
      totalOrderAmount += usedOrderAmount
      totalRawMaterialCost += usedRawMaterialCost
      totalGrossProfit += usedOrderAmount - usedRawMaterialCost
    })

    purchaseOrders
      .filter((o) => shouldIncludeGoodsPurchaseInGrossProfit(o))
      .forEach((o) => {
        if (!o) return
        const items = Array.isArray(o.items) ? o.items : []
        const first = items[0] || {}
        const quantity =
          o.quantity ??
          o.totalQty ??
          (Array.isArray(o.items)
            ? o.items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
            : 0)
        const purchaseUnitPrice = Number(
          o.salePrice ??
          (first && first.unitPrice) ??
          o.unitPrice ??
          0
        )
        const saleUnitPrice = Number(
          o.unitPrice ??
          o.salePrice ??
          (first && first.unitPrice) ??
          0
        )
        const orderAmount = Number(Number(quantity || 0) * saleUnitPrice)
        const rawDate = o.createdAt || o.createTime || null
        const ts = getTs(rawDate)
        if (!ts || ts < startTs || ts > endTs) return

        const materialCode =
          o.materialCode ??
          (first && first.materialCode) ??
          ''
        const materialKey = materialCode || o.materialNo || ''
        const overridePrice = getOverridePrice(materialKey, rawDate)
        const materialPrice = overridePrice || purchaseUnitPrice
        const rawMaterialCost = Number(quantity || 0) * Number(materialPrice || 0)
        const usedOrderAmount = Number.isFinite(orderAmount) ? orderAmount : 0
        const usedRawMaterialCost = Number.isFinite(rawMaterialCost) ? rawMaterialCost : 0
        totalOrderAmount += usedOrderAmount
        totalRawMaterialCost += usedRawMaterialCost
        totalGrossProfit += usedOrderAmount - usedRawMaterialCost
      })

    const grossProfitFixed = Number.isFinite(totalGrossProfit)
      ? Number(totalGrossProfit.toFixed(2))
      : 0
    const orderAmountFixed = Number.isFinite(totalOrderAmount)
      ? Number(totalOrderAmount.toFixed(2))
      : 0
    const grossMarginFixed =
      orderAmountFixed > 0
        ? Number(((grossProfitFixed / orderAmountFixed) * 100).toFixed(1))
        : 0

    return {
      orderAmountTotal: orderAmountFixed,
      grossProfit: grossProfitFixed,
      grossMargin: Number.isFinite(grossMarginFixed) ? grossMarginFixed : 0,
      rawMaterialCostTotal: Number.isFinite(totalRawMaterialCost)
        ? Number(totalRawMaterialCost.toFixed(2))
        : 0
    }
  }

  const computeEfficiencyMonthStats = (salesOrdersInput, purchaseOrdersInput, boardPurchaseOrderMapInput) => {
    const monthStartTs = dayjs().startOf('month').startOf('day').valueOf()
    const monthEndTs = dayjs().endOf('month').endOf('day').valueOf()
    return computeEfficiencyStatsForRange(
      salesOrdersInput,
      purchaseOrdersInput,
      boardPurchaseOrderMapInput,
      monthStartTs,
      monthEndTs
    )
  }

  const handleTabChange = (key) => {
    setActiveKey(key)
  }

  const businessCards = [
    { title: '全年订单总金额', value: businessCloud.orderAmountTotal, prefix: '¥', precision: 2 },
    { title: '全年原材料总成本', value: businessCloud.rawMaterialCostTotal, prefix: '¥', precision: 2 },
    { title: '全年生产毛利', value: businessCloud.grossProfit, prefix: '¥', precision: 2 },
    { title: '全年生产毛利率', value: businessCloud.grossMargin, suffix: '%', precision: 1 },
  ]

  const businessTrendConfig = {
    data: businessCloud.trend || [],
    height: 380,
    onReady: businessTrendOnReady,
    children: [
      {
        type: 'area',
        xField: 'date',
        yField: 'value',
        smooth: true,
        style: {
          fill: 'rgba(79,70,229,0.15)',
          fillOpacity: 1
        },
        axis: false,
        tooltip: false,
      },
      {
        type: 'line',
        xField: 'date',
        yField: 'value',
        smooth: true,
        shape: 'smooth',
        style: {
          stroke: '#4f46e5',
          lineWidth: 3,
        },
        point: false,
        axis: false,
        tooltip: {
          items: [
            (d) => ({
              name: '销售额',
              value: `¥${Number(d?.value || 0).toLocaleString()} 元`,
            }),
          ],
        },
      },
    ],
    axis: {
      x: {
        labelAutoRotate: true,
        labelFontSize: 10,
        title: false,
      },
      y: {
        title: false,
        labelFormatter: (v) => `${Number(v).toLocaleString()}`,
      },
    },
    scale: {
      x: { paddingInner: 0.1, paddingOuter: 0.1, sync: true },
      y: { sync: true },
    },
    tooltip: {
      shared: true,
      showMarkers: false,
    },
    interactions: [{ type: 'element-active' }],
  }

  const customerRankConfig = {
    data: businessStats.topCustomers || [],
    xField: 'customer',
    yField: 'amount',
    height: 380,
    style: {
      fill: 'l(270) 0:#e6f7ff 1:#1890ff',
      radiusTopLeft: 4,
      radiusTopRight: 4,
    },
    scale: {
      y: { nice: true },
    },
    axis: {
      y: {
        labelFormatter: (v) => `¥${Number(v) / 10000}万`,
        gridStroke: '#f0f0f0',
        title: false,
      },
      x: {
        labelFontSize: 11,
        labelAutoRotate: true,
        title: false,
      },
    },
    label: {
      text: (d) => d ? `${(Number(d.amount || 0) / 10000).toFixed(1)}万` : '',
      position: 'top',
      dy: -18,
      style: {
        fill: '#262626',
        fontWeight: 600,
        fontSize: 11,
      },
    },
    tooltip: {
      showTitle: false,
    },
    interaction: {
      tooltip: {
        render: (_, { items }) => {
          if (!items || !Array.isArray(items) || items.length === 0) return ''
          const first = items[0]
          if (!first) return ''
          const customerName =
            typeof first.name === 'string' ? first.name : ''
          const topList = Array.isArray(businessStats.topCustomers)
            ? businessStats.topCustomers
            : []
          const index = topList.findIndex(
            (item) => item.customer === customerName
          )
          const matched = index >= 0 ? topList[index] : null
          const amount = matched ? Number(matched.amount || 0) : 0
          const amountText = Number.isFinite(amount)
            ? amount.toLocaleString()
            : '0'
          const rankText = index >= 0 ? `TOP${index + 1}` : ''
          return `
            <div style="padding:8px;font-size:12px;text-align:left;">
              <div style="margin-bottom:4px;">排名：${rankText}</div>
              <div style="margin-bottom:4px;">客户名：${customerName || '-'}</div>
              <div>订单金额：¥${amountText} 元</div>
            </div>
          `
        },
      },
    },
    interactions: [{ type: 'element-active' }],
  }

  useEffect(() => {
    if (activeKey !== 'business' && activeKey !== 'finance') return
    if (businessDataLoadedRef.current) return
    if (businessDataLoadingRef.current) return
    if (orders.length && customers.length && Object.keys(materialPriceMap).length && rawMaterialPurchaseOrders.length) {
      businessDataLoadedRef.current = true
      return
    }
    const load = async () => {
      businessDataLoadingRef.current = true
      setBusinessLoading(true)
      try {
        const extractRows = (res) => {
          if (Array.isArray(res)) return res
          if (Array.isArray(res?.data)) return res.data
          if (Array.isArray(res?.orders)) return res.orders
          if (Array.isArray(res?.data?.orders)) return res.data.orders
          if (Array.isArray(res?.data?.data?.orders)) return res.data.data.orders
          if (Array.isArray(res?.list)) return res.list
          if (Array.isArray(res?.data?.list)) return res.data.list
          if (Array.isArray(res?.customers)) return res.customers
          if (Array.isArray(res?.data?.customers)) return res.data.customers
          if (Array.isArray(res?.data?.data?.customers)) return res.data.data.customers
          return []
        }
        const extractPagination = (res) => {
          return res?.pagination || res?.data?.pagination || res?.data?.data?.pagination || {}
        }
        const fetchAllPages = async (fn, baseParams, options = {}) => {
          const pageKey = options.pageKey || 'page'
          const sizeKey = options.sizeKey || 'pageSize'
          const pageSize = Number(options.pageSize || 200)
          const maxPages = Number(options.maxPages || 50)
          const all = []
          for (let page = 1; page <= maxPages; page += 1) {
            const resp = await fn({ ...(baseParams || {}), [pageKey]: page, [sizeKey]: pageSize })
            const rows = extractRows(resp)
            if (rows.length) all.push(...rows)
            const pagination = extractPagination(resp)
            const totalPages = Number(pagination?.totalPages || pagination?.pages || 0)
            const hasMore = pagination?.hasMore
            if (totalPages > 0 && page >= totalPages) break
            if (hasMore === false) break
            if (!rows.length || rows.length < pageSize) break
          }
          return all
        }

        const rangeStart = dayjs().startOf('year').subtract(1, 'month').startOf('month')
        const rangeEnd = dayjs().endOf('month')
        const rangeParams = { startDate: rangeStart.toISOString(), endDate: rangeEnd.toISOString() }

        const [ordersData, customersData, rawMatRaw, purchaseAllRows] = await Promise.all([
          fetchAllPages(
            cachedOrderAPI.getOrders,
            { orderBy: 'createdAt_desc', excludeOrderType: 'purchase', ...rangeParams },
            { pageSize: 200, maxPages: 200 }
          ),
          fetchAllPages(cachedCustomerAPI.getCustomers, {}, { sizeKey: 'pageSize', pageSize: 200, maxPages: 20 }),
          fetchAllPages(cachedPurchaseAPI.getPurchaseOrders, { category: 'raw_materials', ...rangeParams }, { pageSize: 200, maxPages: 200 }),
          fetchAllPages(cachedPurchaseAPI.getPurchaseOrders, { ...rangeParams }, { pageSize: 200, maxPages: 200 })
        ])
        const boardPurchaseIds = Array.from(
          new Set(
            (ordersData || [])
              .map((o) => String(o?.purchaseOrderId || '').trim())
              .filter(Boolean)
          )
        )
        const boardPurchaseOrderMap = new Map()
        if (boardPurchaseIds.length) {
          const results = await Promise.allSettled(boardPurchaseIds.map((id) => cachedOrderAPI.getOrder(id)))
          results.forEach((r, idx) => {
            if (!r || r.status !== 'fulfilled') return
            const resp = r.value
            const raw = resp?.data || resp?.order || resp?.data?.order || resp
            const po = raw && typeof raw === 'object' ? raw : {}
            const category = String(po.purchaseCategory || po.category || '').toLowerCase()
            if (category !== 'boards') return
            const rawAmt = Number(po.amount ?? po.totalAmount ?? po.finalAmount ?? 0)
            const items = Array.isArray(po.items) ? po.items : []
            const itemsTotal = items.reduce((s, it) => s + (Number(it?.amount) || 0), 0)
            const usedAmt =
              rawAmt > 0
                ? rawAmt
                : (Number.isFinite(itemsTotal) && itemsTotal > 0 ? itemsTotal : 0)
            if (!(usedAmt > 0)) return
            const key = boardPurchaseIds[idx]
            boardPurchaseOrderMap.set(String(key), Number(usedAmt))
          })
        }
        const computedEfficiencyMonth = computeEfficiencyMonthStats(ordersData, purchaseAllRows, boardPurchaseOrderMap)
        setEfficiencyMonthStats(computedEfficiencyMonth)
        const priceMap = {}
          ; (rawMatRaw || []).forEach((o) => {
            const items = Array.isArray(o.items) ? o.items : []
            const first = items[0] || {}
            const materialNo =
              o.materialNo ??
              (first && first.materialNo) ??
              ''
            const quantity = Number(
              o.quantity ??
              o.totalQty ??
              (Array.isArray(o.items)
                ? o.items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)
                : 0)
            )
            const rawUnitPrice = Number(
              o.salePrice ??
              (first && first.unitPrice) ??
              o.unitPrice ??
              0
            )
            if (!materialNo) return
            const qty = Number(quantity || 0)
            const price = Number(rawUnitPrice || 0)
            if (!qty || !price) return
            const prev = priceMap[materialNo] || { qty: 0, amount: 0 }
            priceMap[materialNo] = {
              qty: prev.qty + qty,
              amount: prev.amount + price * qty
            }
          })
        const mergedOrders = [...ordersData]

        setOrders(mergedOrders)
        setCustomers(customersData)
        setMaterialPriceMap(priceMap)
        setRawMaterialPurchaseOrders(purchaseAllRows)
        businessDataLoadedRef.current = true
      } catch (e) {
        message.error('加载经营数据失败')
      } finally {
        setBusinessLoading(false)
        businessDataLoadingRef.current = false
      }
    }
    load()
  }, [activeKey])

  useEffect(() => {
    if (activeKey !== 'business') return
    if (!isAuthenticated) {
      setBusinessCloud({
        orderAmountTotal: 0,
        rawMaterialCostTotal: 0,
        grossProfit: 0,
        grossMargin: 0,
        trend: []
      })
      return
    }
    const run = async () => {
      setBusinessCloudLoading(true)
      try {
        // --- PURE FRONTEND STATISTICS (No Backend API Dependency) ---
        // Load all raw data from cache
        let orders = [], purchases = [], customers = []

        try {
          [orders, purchases, customers] = await Promise.all([
            cachedOrderAPI.getAllOrders(),
            cachedPurchaseAPI.getAllPurchaseOrders(),
            cachedCustomerAPI.getAllCustomers()
          ])
        } catch (error) {
          console.error('Failed to load cached data:', error)
          message.error('数据加载失败，请检查网络连接')
          throw error
        }

        setOrders(orders); setRawMaterialPurchaseOrders(purchases); setCustomers(customers);

        const now = dayjs()
        const currentYear = now.year()
        const currentMonth = now.month() + 1

        const isPurchaseOrder = (o) => {
          if (!o) return false
          const orderType = String(o.orderType || o.type || '').toLowerCase()
          if (orderType === 'purchase') return true
          const source = String(o.source || '').toLowerCase()
          if (source === 'purchased') return true
          const purchaseCategory = String(o.purchaseCategory || '').trim()
          if (purchaseCategory) return true
          const orderNoUpper = String(o.orderNo || o.orderNumber || '').toUpperCase()
          if (orderNoUpper.startsWith('PUR')) return true
          const supplierName = o.supplierName || o.supplier?.name || o.supplier || ''
          const customerId = o.customerId || o.customer?._id || o.customer?.id
          const customerName = o.customerName || o.customer?.name || o.customer || ''
          const hasCustomer = Boolean(customerId || customerName)
          const hasSupplier = Boolean(String(supplierName || '').trim())
          if (
            hasSupplier &&
            !hasCustomer &&
            !orderNoUpper.startsWith('QXDD') &&
            !orderNoUpper.startsWith('QXBZ')
          ) {
            return true
          }
          return false
        }

        const getCreatedAtTs = (o) => {
          const rawTs = Number(o?.createdAtTs ?? o?.createTimeTs ?? o?.createdAtTime ?? o?.timestamp ?? 0)
          if (Number.isFinite(rawTs) && rawTs > 0) {
            return rawTs < 1000000000000 ? rawTs * 1000 : rawTs
          }
          const rawDate = o?.createdAt || o?.createTime || o?.date || o?.orderDate || o?.updatedAt || null
          if (!rawDate) return 0
          const t = dayjs(rawDate).valueOf()
          return Number.isFinite(t) ? t : 0
        }

        const boardPurchaseOrderMap = new Map()
        const getBoardPurchaseAmount = (po) => {
          if (!po) return 0
          const rawAmt = Number(po.amount ?? po.totalAmount ?? po.finalAmount ?? 0)
          if (Number.isFinite(rawAmt) && rawAmt > 0) return rawAmt
          const items = Array.isArray(po.items) ? po.items : []
          const itemsTotal = items.reduce((s, it) => s + (Number(it?.amount) || 0), 0)
          return Number.isFinite(itemsTotal) && itemsTotal > 0 ? itemsTotal : 0
        }
        const maybeSetBoardAmount = (key, amount) => {
          const k = String(key || '').trim()
          const amt = Number(amount || 0)
          if (!k) return
          if (!(Number.isFinite(amt) && amt > 0)) return
          if (!boardPurchaseOrderMap.has(k)) boardPurchaseOrderMap.set(k, amt)
        }
        ;(purchases || []).forEach((po) => {
          if (!po) return
          const cat = String(po.purchaseCategory || po.category || '').trim().toLowerCase()
          if (cat !== 'boards' && !cat.includes('board')) return
          const amount = getBoardPurchaseAmount(po)
          const id = po._id || po.id
          maybeSetBoardAmount(id, amount)
          maybeSetBoardAmount(po.orderNo, amount)
        })
        ;(orders || []).forEach((o) => {
          if (!o) return
          const cat = String(o.purchaseCategory || o.category || '').trim().toLowerCase()
          if (cat !== 'boards' && !cat.includes('board')) return
          const amount = getBoardPurchaseAmount(o)
          maybeSetBoardAmount(o._id || o.id, amount)
          maybeSetBoardAmount(o.orderNo, amount)
        })

        const getPurchaseCategoryKey = (order) => {
          const raw = order?.purchaseCategory ?? order?.category ?? ''
          return String(raw).trim().toLowerCase()
        }

        const isRawMaterialPurchase = (order) => {
          const category = getPurchaseCategoryKey(order)
          if (category) {
            return (
              category === 'raw_materials' ||
              category === 'raw-materials' ||
              category === 'rawmaterials' ||
              category.includes('raw') ||
              category.includes('material') ||
              category.includes('原材料')
            )
          }
          const items = Array.isArray(order?.items) ? order.items : []
          const first = items[0] || {}
          const title =
            order?.goodsName ||
            order?.productTitle ||
            first?.goodsName ||
            first?.title ||
            first?.productName ||
            order?.title ||
            ''
          const material =
            order?.materialCode ??
            first?.materialCode ??
            order?.materialNo ??
            first?.materialNo ??
            ''
          const text = `${title} ${material}`.toLowerCase()
          return text.includes('原材料') || text.includes('纸') || text.includes('瓦楞')
        }

        const materialPriceMapLocal = new Map()
        const purchasePriceByOrderNo = new Map()

        ;(purchases || []).forEach((po) => {
          if (!po) return
          if (!isRawMaterialPurchase(po)) return
          const items = Array.isArray(po.items) ? po.items : []
          const first = items[0] || {}
          const materialNo =
            po.materialNo ??
            (first && first.materialNo) ??
            ''
          const quantity = Number(
            po.quantity ??
            po.totalQty ??
            (Array.isArray(po.items)
              ? po.items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
              : 0)
          )
          const rawUnitPrice = Number(
            po.salePrice ??
            (first && first.unitPrice) ??
            po.unitPrice ??
            0
          )
          const orderNo = String(po.orderNo ?? po.orderNumber ?? '').trim()

          const qty = Number(quantity || 0)
          const price = Number(rawUnitPrice || 0)
          if (materialNo && qty > 0 && price > 0) {
            const prev = materialPriceMapLocal.get(materialNo) || { qty: 0, amount: 0 }
            materialPriceMapLocal.set(materialNo, {
              qty: prev.qty + qty,
              amount: prev.amount + price * qty
            })
          }
          if (orderNo && price > 0) {
            purchasePriceByOrderNo.set(orderNo, price)
          }
        })

        let ySales = 0
        let yGrossProfit = 0
        const monthSalesMap = new Map()
        const dayTrendMap = new Map()
        const trendMonthsBack = salesTrendRange === '3m' ? 3 : salesTrendRange === '6m' ? 6 : 0
        const trendStartTs =
          trendMonthsBack > 0
            ? now.subtract(trendMonthsBack - 1, 'month').startOf('month').startOf('day').valueOf()
            : 0
        const trendEndTs =
          trendMonthsBack > 0
            ? now.endOf('month').endOf('day').valueOf()
            : 0

        const salesOrders = (orders || []).filter((o) => !isPurchaseOrder(o))

        const boardPurchaseIds = Array.from(
          new Set(
            salesOrders
              .map((o) => String(o?.purchaseOrderId || '').trim())
              .filter(Boolean)
          )
        )
        if (boardPurchaseIds.length) {
          const missingIds = boardPurchaseIds.filter((id) => !boardPurchaseOrderMap.has(id))
          if (missingIds.length) {
            missingIds.forEach((id) => {
              const byCache =
                (purchases || []).find((p) => String(p?._id || p?.id || p?.orderNo || '').trim() === id) ||
                (orders || []).find((p) => String(p?._id || p?.id || p?.orderNo || '').trim() === id) ||
                null
              if (!byCache) return
              const cat = String(byCache.purchaseCategory || byCache.category || '').trim().toLowerCase()
              if (cat !== 'boards' && !cat.includes('board')) return
              const amount = getBoardPurchaseAmount(byCache)
              maybeSetBoardAmount(id, amount)
            })

            const fetchIds = missingIds.filter((id) => !boardPurchaseOrderMap.has(id)).slice(0, 40)
            if (fetchIds.length) {
              const results = await Promise.allSettled(fetchIds.map((id) => cachedOrderAPI.getOrder(id)))
              results.forEach((r, idx) => {
                if (!r || r.status !== 'fulfilled') return
                const resp = r.value
                const raw = resp?.data || resp?.order || resp?.data?.order || resp
                const po = raw && typeof raw === 'object' ? raw : null
                if (!po) return
                const cat = String(po.purchaseCategory || po.category || '').trim().toLowerCase()
                if (cat !== 'boards' && !cat.includes('board')) return
                const amount = getBoardPurchaseAmount(po)
                maybeSetBoardAmount(fetchIds[idx], amount)
              })
            }
          }
        }

        const yearStartTs = now.startOf('year').startOf('day').valueOf()
        const yearEndTs = now.endOf('year').endOf('day').valueOf()
        const yearStats = computeEfficiencyStatsForRange(
          salesOrders,
          purchases,
          boardPurchaseOrderMap,
          yearStartTs,
          yearEndTs
        )
        salesOrders.forEach((o) => {
          if (!o) return
          const items = Array.isArray(o?.items) ? o.items : []
          const first = items[0] || {}
          const ts = getCreatedAtTs(o)
          if (!ts) return
          const d = dayjs(ts)
          if (!d.isValid()) return

          const quantity = Number(
            o.quantity ??
            o.totalQty ??
            (Array.isArray(items)
              ? items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
              : 0)
          )
          let unitPrice = Number(o.unitPrice ?? first.unitPrice ?? 0)
          if (!(unitPrice > 0) && quantity > 0) {
            const rawAmt = Number(o.amount ?? o.totalAmount ?? o.finalAmount ?? o.orderAmount ?? 0)
            if (Number.isFinite(rawAmt) && rawAmt > 0) unitPrice = rawAmt / quantity
          }
          const orderAmount = Number(
            o.amount ?? o.totalAmount ?? o.finalAmount ?? o.orderAmount ?? (Number(quantity || 0) * Number(unitPrice || 0))
          )

          const materialCode = o.materialCode ?? (first && first.materialCode) ?? ''
          const materialNo = o.materialNo ?? (first && first.materialNo) ?? ''
          const materialKey = materialCode || materialNo || ''
          const entry = materialNo ? materialPriceMapLocal.get(materialNo) : undefined
          const mapPrice = entry && entry.qty > 0 ? entry.amount / entry.qty : 0
          const orderNo = String(o.orderNo ?? o.orderNumber ?? '').trim()
          const directOrderPrice = orderNo ? (purchasePriceByOrderNo.get(orderNo) || 0) : 0
          const orderOverridePrice = getOrderOverridePrice(orderNo)
          const materialSqmPrice = getOverridePrice(materialKey, ts)

          const width = Number(o.boardWidth || 0)
          const height = Number(o.boardHeight || 0)
          const effectiveWidth = width > 0 ? width + 30 : 0
          const area =
            effectiveWidth > 0 && height > 0
              ? (effectiveWidth * height) / 1000000
              : 0

          const effectiveSheetCount = getEffectiveSheetCount(o, first)
          const boardPurchaseId = String(o.purchaseOrderId || '').trim()
          const boardPurchaseAmount = boardPurchaseId ? (boardPurchaseOrderMap.get(boardPurchaseId) || 0) : 0
          const useBoardPurchaseAmount =
            Number.isFinite(ts) &&
            ts >= boardCostEffectiveFromTs &&
            boardPurchaseAmount > 0

          let rawMaterialCost = 0
          if (useBoardPurchaseAmount) {
            rawMaterialCost = boardPurchaseAmount
          } else if (orderOverridePrice > 0 && area > 0 && effectiveSheetCount > 0) {
            rawMaterialCost = effectiveSheetCount * (area * orderOverridePrice)
          } else if ((directOrderPrice > 0 || mapPrice > 0) && effectiveSheetCount > 0) {
            const perSheetPurchasePrice = directOrderPrice || mapPrice
            rawMaterialCost = effectiveSheetCount * perSheetPurchasePrice
          } else if (materialSqmPrice > 0 && area > 0 && effectiveSheetCount > 0) {
            rawMaterialCost = effectiveSheetCount * (area * materialSqmPrice)
          }

          const grossProfit = Number(orderAmount || 0) - Number(rawMaterialCost || 0)
          if (d.year() === currentYear) {
            ySales += Number.isFinite(orderAmount) ? orderAmount : 0
            yGrossProfit += Number.isFinite(grossProfit) ? grossProfit : 0
          }

          const orderMonth = d.month() + 1
          const shouldAccumulateTrend =
            (salesTrendRange === 'month' && d.year() === currentYear && orderMonth === currentMonth) ||
            (salesTrendRange === 'year' && d.year() === currentYear) ||
            (trendMonthsBack > 0 && ts >= trendStartTs && ts <= trendEndTs)

          if (!shouldAccumulateTrend) return
          if (salesTrendRange === 'month') {
            const dayKey = d.format('MM-DD')
            dayTrendMap.set(dayKey, (dayTrendMap.get(dayKey) || 0) + orderAmount)
          } else if (salesTrendRange === 'year') {
            const monthKey = d.format('MM')
            monthSalesMap.set(monthKey, (monthSalesMap.get(monthKey) || 0) + orderAmount)
          } else if (trendMonthsBack > 0) {
            const monthKey = d.format('YYYY-MM')
            monthSalesMap.set(monthKey, (monthSalesMap.get(monthKey) || 0) + orderAmount)
          }
        })

        ;(purchases || [])
          .filter((o) => {
            const rawCategory = o?.purchaseCategory ?? o?.category ?? ''
            const category = String(rawCategory).trim().toLowerCase()
            if (category) return category === 'goods'

            const items = Array.isArray(o?.items) ? o.items : []
            const first = items[0] || {}
            const title =
              o?.goodsName ||
              o?.productTitle ||
              (first && (first.goodsName || first.title || first.productName)) ||
              o?.title ||
              ''
            const material =
              o?.materialCode ??
              (first && first.materialCode) ??
              o?.materialNo ??
              (first && first.materialNo) ??
              ''
            const text = `${title} ${material}`.toLowerCase()
            if (!text.trim()) return true
            return !text.includes('纸板') && !text.includes('原材料') && !text.includes('瓦楞')
          })
          .forEach((o) => {
            if (!o) return
            const items = Array.isArray(o?.items) ? o.items : []
            const first = items[0] || {}
            const rawDate = o.createdAt || o.createTime || o.date || o.orderDate || o.updatedAt || null
            const ts = rawDate ? dayjs(rawDate).valueOf() : 0
            if (!ts) return
            const d = dayjs(ts)
            if (!d.isValid()) return

            const quantity = Number(
              o.quantity ??
              o.totalQty ??
              (Array.isArray(items)
                ? items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
                : 0)
            )
            const purchaseUnitPrice = Number(
              o.salePrice ??
              (first && first.unitPrice) ??
              o.unitPrice ??
              0
            )
            const saleUnitPrice = Number(
              o.unitPrice ??
              o.salePrice ??
              (first && first.unitPrice) ??
              0
            )
            const orderAmount = Number(quantity || 0) * Number(saleUnitPrice || 0)

            const materialCode = o.materialCode ?? (first && first.materialCode) ?? ''
            const materialKey = materialCode || o.materialNo || ''
            const overridePrice = getOverridePrice(materialKey, ts)
            const materialPrice = overridePrice || purchaseUnitPrice
            const rawMaterialCost = Number(quantity || 0) * Number(materialPrice || 0)
            const grossProfit = Number(orderAmount || 0) - Number(rawMaterialCost || 0)
            if (d.year() === currentYear) {
              ySales += Number.isFinite(orderAmount) ? orderAmount : 0
              yGrossProfit += Number.isFinite(grossProfit) ? grossProfit : 0
            }

            const orderMonth = d.month() + 1
            const shouldAccumulateTrend =
              (salesTrendRange === 'month' && d.year() === currentYear && orderMonth === currentMonth) ||
              (salesTrendRange === 'year' && d.year() === currentYear) ||
              (trendMonthsBack > 0 && ts >= trendStartTs && ts <= trendEndTs)

            if (!shouldAccumulateTrend) return
            if (salesTrendRange === 'month') {
              const dayKey = d.format('MM-DD')
              dayTrendMap.set(dayKey, (dayTrendMap.get(dayKey) || 0) + orderAmount)
            } else if (salesTrendRange === 'year') {
              const monthKey = d.format('MM')
              monthSalesMap.set(monthKey, (monthSalesMap.get(monthKey) || 0) + orderAmount)
            } else if (trendMonthsBack > 0) {
              const monthKey = d.format('YYYY-MM')
              monthSalesMap.set(monthKey, (monthSalesMap.get(monthKey) || 0) + orderAmount)
            }
          })

        // Build trend array
        let normalizedTrend = []
        if (salesTrendRange === 'month') {
          // Daily trend for current month
          const daysInMonth = now.daysInMonth()
          for (let day = 1; day <= daysInMonth; day++) {
            const dayKey = String(day).padStart(2, '0')
            const label = `${String(currentMonth).padStart(2, '0')}-${dayKey}`
            const value = dayTrendMap.get(label) || 0
            normalizedTrend.push({
              date: label,
              value,
              rawKey: `${currentYear}-${label}`
            })
          }
        } else if (trendMonthsBack > 0) {
          const startMonth = now.subtract(trendMonthsBack - 1, 'month').startOf('month')
          for (let i = 0; i < trendMonthsBack; i++) {
            const monthKey = startMonth.add(i, 'month').format('YYYY-MM')
            const value = monthSalesMap.get(monthKey) || 0
            normalizedTrend.push({
              date: monthKey,
              value,
              rawKey: monthKey
            })
          }
        } else if (salesTrendRange === 'year') {
          // Monthly trend for current year
          for (let month = 1; month <= 12; month++) {
            const monthKey = String(month).padStart(2, '0')
            const value = monthSalesMap.get(monthKey) || 0
            normalizedTrend.push({
              date: monthKey,
              value,
              rawKey: `${currentYear}-${monthKey}`
            })
          }
        }

        const localYM = ySales > 0 ? (yGrossProfit / ySales) * 100 : 0
        setBusinessCloud({
          orderAmountTotal: Number(yearStats?.orderAmountTotal || 0),
          rawMaterialCostTotal: Number(yearStats?.rawMaterialCostTotal || 0),
          grossProfit: Number(yearStats?.grossProfit || 0),
          grossMargin: Number(yearStats?.grossMargin || 0),
          yearSales: Number(ySales.toFixed(2)),
          yearGrossProfit: Number(yGrossProfit.toFixed(2)),
          yearGrossMargin: Number(localYM.toFixed(1)),
          trend: normalizedTrend
        })
      } catch (e) {
        console.error('Statistics calculation error:', e)
        message.error('统计数据计算失败')
        setBusinessCloud({
          orderAmountTotal: 0,
          rawMaterialCostTotal: 0,
          grossProfit: 0,
          grossMargin: 0,
          trend: []
        })
      } finally {
        setBusinessCloudLoading(false)
      }
    }
    run()
  }, [activeKey, salesTrendRange, message, isAuthenticated])

  // Removed duplicate sync - year sales now calculated once in main effect above

  useEffect(() => {
    const baseDay = dayjs()
    const start = baseDay.startOf('month')
    const end = baseDay.endOf('month')
    const currentStartTs = start.valueOf()
    const currentEndTs = end.valueOf()
    const lastMonthStart = start.subtract(1, 'month').startOf('month')
    const lastMonthEnd = start.subtract(1, 'month').endOf('month')
    const lastStartTs = lastMonthStart.valueOf()
    const lastEndTs = lastMonthEnd.valueOf()
    if (!orders.length && !customers.length && !rawMaterialPurchaseOrders.length) {
      setBusinessStats({
        currentSales: 0,
        lastSales: 0,
        yearSales: 0,
        salesYoY: 0,
        currentGrossProfit: 0,
        currentGrossMargin: 0,
        trend: [],
        quarterlyData: [],
        topCustomers: [],
        lastMonthProductionCost: 0,
        lastMonthPurchaseCost: 0,
        lastMonthScrapCost: 0,
        lastMonthRawMaterialPurchaseCost: 0
      })
      return
    }
    const trendMap = new Map()
    const monthCustomerAmountMap = new Map()
    const quarterCustomerAmountMap = new Map()
    const yearCustomerAmountMap = new Map()
    const customerShortNameMap = new Map()
    if (Array.isArray(customers)) {
      customers.forEach(c => {
        if (c.name) customerShortNameMap.set(c.name, c.shortName || c.name)
        if (c.companyName) customerShortNameMap.set(c.companyName, c.shortName || c.companyName)
      })
    }

    let currentSales = 0
    let lastSales = 0
    let yearSales = 0
    let yearGrossProfit = 0
    let currentGrossProfit = 0
    let lastMonthProductionCost = 0
    let lastMonthPurchaseCost = 0
    let lastMonthScrapCost = 0
    let lastMonthRawMaterialPurchaseCost = 0
    const costMonthlyMap = new Map()
    const normalizeTime = (value) => {
      if (!value) return 0
      if (typeof value === 'number') return value
      const d = dayjs(value)
      if (!d.isValid()) return 0
      return d.valueOf()
    }
    const getScrapEventTs = (order) => {
      if (!order) return 0
      const raw =
        order.scrappedAt ??
        order.scrapAt ??
        order.scrapTime ??
        order.scrapDate ??
        order.statusUpdatedAt ??
        order.updatedAt ??
        order.updateTime ??
        order.updatedTime ??
        null
      return normalizeTime(raw)
    }
    const normalizeCreatedTsForRevenue = (order) => {
      const v = order?.createTime || order?.createdAt
      if (!v) return 0
      const d = dayjs(v)
      if (!d.isValid()) return 0
      return d.valueOf()
    }
    const getProductionOrderAmount = (order) => {
      const raw = Number(order?.amount ?? order?.totalAmount ?? order?.finalAmount ?? 0)
      return Number.isFinite(raw) ? raw : 0
    }
    const getGoodsPurchaseOrderAmount = (order) => {
      if (!order) return 0
      const items = Array.isArray(order?.items) ? order.items : []
      const first = items[0] || {}
      const quantity =
        order.quantity ??
        order.totalQty ??
        (Array.isArray(items)
          ? items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
          : 0)
      const qty = Number(quantity || 0)
      let saleUnitPrice = Number(order.unitPrice ?? order.salePrice ?? first.unitPrice ?? 0)
      if (!(saleUnitPrice > 0) && qty > 0) {
        const rawAmt = Number(order.amount ?? order.totalAmount ?? order.finalAmount ?? order.orderAmount ?? 0)
        if (Number.isFinite(rawAmt) && rawAmt > 0) {
          saleUnitPrice = rawAmt / qty
        }
      }
      if (qty > 0 && saleUnitPrice > 0) {
        return qty * saleUnitPrice
      }
      const fallback = Number(order.amount ?? order.totalAmount ?? order.finalAmount ?? order.orderAmount ?? 0)
      return Number.isFinite(fallback) ? fallback : 0
    }
    const getAmount = (order) => {
      if (order == null) return 0
      const directCandidates = [
        order.totalAmount,
        order.amount,
        order.finalAmount,
        order.orderAmount
      ]
      for (let i = 0; i < directCandidates.length; i += 1) {
        const n = Number(directCandidates[i])
        if (Number.isFinite(n) && n !== 0) return n
      }
      if (Array.isArray(order.items)) {
        const sum = order.items.reduce((acc, item) => {
          if (!item) return acc
          const itemCandidates = [
            item.totalPrice,
            item.totalAmount,
            item.amount,
            item.finalAmount,
            item.price
          ]
          for (let j = 0; j < itemCandidates.length; j += 1) {
            const v = Number(itemCandidates[j])
            if (Number.isFinite(v) && v !== 0) return acc + v
          }
          const qty = Number(item.quantity || 0)
          const unitPrice = Number(
            item.salePrice ?? item.unitPrice ?? item.price ?? 0
          )
          if (Number.isFinite(qty) && Number.isFinite(unitPrice) && qty > 0 && unitPrice > 0) {
            return acc + qty * unitPrice
          }
          return acc
        }, 0)
        if (Number.isFinite(sum) && sum !== 0) return sum
      }
      const quantity =
        order.quantity ??
        order.totalQty ??
        (Array.isArray(order.items)
          ? order.items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
          : 0)
      const unitPrice = Number(order.salePrice ?? order.unitPrice ?? 0)
      if (Number.isFinite(quantity) && Number.isFinite(unitPrice) && quantity > 0 && unitPrice > 0) {
        return quantity * unitPrice
      }
      return 0
    }
    const getBucketKey = (ts) => {
      const d = dayjs(ts)
      if (!d.isValid()) return ''
      if (salesTrendRange === 'month') {
        return d.format('YYYY-MM-DD')
      }
      return d.format('YYYY')
    }
    const yearStart = baseDay.startOf('year').valueOf()
    const yearEnd = baseDay.endOf('year').valueOf()
    const currentMonthIndex = baseDay.month()
    const currentQuarter = Math.floor(currentMonthIndex / 3)
    const quarterStart = baseDay.month(currentQuarter * 3).startOf('month')
    const quarterEnd = quarterStart.add(2, 'month').endOf('month')
    const quarterStartTs = quarterStart.valueOf()
    const quarterEndTs = quarterEnd.valueOf()

    const addCostToMonth = (ts, delta) => {
      const d = dayjs(ts)
      if (!d.isValid()) return
      const key = d.format('YYYY-MM')
      const prev = costMonthlyMap.get(key) || {
        productionCost: 0,
        purchaseCost: 0,
        scrapCost: 0,
        rawMaterialPurchaseCost: 0
      }
      costMonthlyMap.set(key, {
        productionCost: prev.productionCost + (delta.productionCost || 0),
        purchaseCost: prev.purchaseCost + (delta.purchaseCost || 0),
        scrapCost: prev.scrapCost + (delta.scrapCost || 0),
        rawMaterialPurchaseCost: prev.rawMaterialPurchaseCost + (delta.rawMaterialPurchaseCost || 0)
      })
    }

    const businessOrders = Array.isArray(orders) ? orders : []
    const purchaseOrders = Array.isArray(rawMaterialPurchaseOrders) ? rawMaterialPurchaseOrders : []

    const getPurchaseCategoryKey = (order) => {
      const raw = order?.purchaseCategory ?? order?.category ?? ''
      return String(raw).trim().toLowerCase()
    }

    const isRawMaterialPurchase = (order) => {
      if (!order) return false
      const category = getPurchaseCategoryKey(order)
      if (category) {
        return (
          category === 'raw_materials' ||
          category === 'raw-materials' ||
          category === 'rawmaterials' ||
          category.includes('raw') ||
          category.includes('material') ||
          category.includes('原材料')
        )
      }
      const items = Array.isArray(order?.items) ? order.items : []
      const first = items[0] || {}
      const title =
        order?.goodsName ||
        order?.productTitle ||
        first?.goodsName ||
        first?.title ||
        first?.productName ||
        order?.title ||
        ''
      const material =
        order?.materialCode ??
        first?.materialCode ??
        order?.materialNo ??
        first?.materialNo ??
        ''
      const text = `${title} ${material}`.toLowerCase()
      return text.includes('原材料') || text.includes('纸') || text.includes('瓦楞')
    }

    const isGoodsPurchase = (order) => {
      const category = getPurchaseCategoryKey(order)
      if (category) return category === 'goods'
      return false
    }

    const boardPurchaseOrderMap = new Map()
    purchaseOrders.forEach((po) => {
      if (!po) return
      const cat = getPurchaseCategoryKey(po)
      if (cat !== 'boards' && !cat.includes('board')) return
      let amount = Number(po.amount ?? po.totalAmount ?? po.finalAmount ?? 0)
      if (!(Number.isFinite(amount) && amount > 0)) {
        const items = Array.isArray(po.items) ? po.items : []
        const itemsTotal = items.reduce((s, it) => s + (Number(it?.amount) || 0), 0)
        amount = Number.isFinite(itemsTotal) ? itemsTotal : 0
      }
      if (!(Number.isFinite(amount) && amount > 0)) return
      const id = String(po._id ?? po.id ?? '').trim()
      if (!id) return
      boardPurchaseOrderMap.set(id, amount)
      if (po.orderNo) boardPurchaseOrderMap.set(String(po.orderNo).trim(), amount)
    })

    const materialPriceMapLocal = new Map()
    const purchasePriceByOrderNo = new Map()
    purchaseOrders.forEach((p) => {
      if (!isRawMaterialPurchase(p)) return
      const items = Array.isArray(p.items) ? p.items : []
      const first = items[0] || {}
      const materialNo =
        p.materialNo ??
        (first && first.materialNo) ??
        ''
      const quantity = Number(
        p.quantity ??
        p.totalQty ??
        (Array.isArray(p.items)
          ? p.items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
          : 0)
      )
      const rawUnitPrice = Number(
        p.salePrice ??
        (first && first.unitPrice) ??
        p.unitPrice ??
        0
      )
      const orderNo = String(p.orderNo ?? p.orderNumber ?? '').trim()
      const qty = Number(quantity || 0)
      const price = Number(rawUnitPrice || 0)
      if (materialNo && qty > 0 && price > 0) {
        const prev = materialPriceMapLocal.get(materialNo) || { qty: 0, amount: 0 }
        materialPriceMapLocal.set(materialNo, {
          qty: prev.qty + qty,
          amount: prev.amount + price * qty
        })
      }
      if (orderNo && price > 0) {
        purchasePriceByOrderNo.set(orderNo, price)
      }
    })

    businessOrders.forEach((order) => {
      const ts = normalizeCreatedTsForRevenue(order) || normalizeTime(
        order.createdAt ||
        order.createTime ||
        order._createTime ||
        order.orderTime ||
        order.updatedAt ||
        order.updateTime
      )
      if (!ts) return
      const sourceVal = String(order.source || '').toLowerCase()
      const orderTypeVal = String(order.orderType || '').toLowerCase()
      const categoryVal = String(order.purchaseCategory || order.category || '').toLowerCase()
      const isPurchaseExact = sourceVal === 'purchased' || orderTypeVal === 'purchase'
      const isMergedPurchase = order?._businessMergedFrom === 'purchase'

      // REVERT: User confirmed sales should include ALL production orders + goods purchase orders
      // No shipping status filter required
      const isProductionRevenue = !isPurchaseExact && !isMergedPurchase

      const isGoodsPurchaseRevenue = isPurchaseExact && categoryVal === 'goods'
      const isSalesRevenueOrder = isProductionRevenue || isGoodsPurchaseRevenue
      const isCostRelevant = !isPurchaseExact || isGoodsPurchaseRevenue
      const statusVal = String(order.status || '').toLowerCase()
      const rawCustomerName = order.customerName || order.customer?.name || ''
      const customerName = customerShortNameMap.get(rawCustomerName) || rawCustomerName
      const quantity =
        order.quantity ??
        order.totalQty ??
        (Array.isArray(order.items)
          ? order.items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)
          : 0)
      const stockedQty = Number(order.stockedQty || 0)
      let rawMaterialCost = 0
      let scrapCost = 0
      const inCurrentMonth = ts >= currentStartTs && ts <= currentEndTs
      const inLastMonth = ts >= lastStartTs && ts <= lastEndTs
      if (isCostRelevant) {
        const items = Array.isArray(order.items) ? order.items : []
        const first = items[0] || {}
        const materialNo =
          order.materialNo ??
          (first && first.materialNo) ??
          ''
        const materialCode =
          order.materialCode ??
          (first && first.materialCode) ??
          ''
        const materialKey = materialCode || materialNo || ''
        const dateForPrice =
          order.createdAt || order.createTime || order._createTime || order.orderTime
        const overridePrice = getOverridePrice(materialKey, dateForPrice)
        if (isPurchaseExact) {
          const purchaseUnitPrice = Number(
            order.salePrice ??
            (first && first.unitPrice) ??
            order.unitPrice ??
            0
          )
          const materialPrice = overridePrice || purchaseUnitPrice
          const rawMaterialUnitPrice = materialPrice
          rawMaterialCost = Number(quantity || 0) * rawMaterialUnitPrice
        } else {
          const purchaseOrderId = String(order.purchaseOrderId || '').trim()
          const boardPurchaseAmount = purchaseOrderId ? (Number(boardPurchaseOrderMap.get(purchaseOrderId) || 0)) : 0
          const useBoardPurchaseAmount =
            Number.isFinite(ts) &&
            ts >= boardCostEffectiveFromTs &&
            boardPurchaseAmount > 0

          if (useBoardPurchaseAmount) {
            rawMaterialCost = boardPurchaseAmount
          } else {
            const orderNo = String(order.orderNo ?? order.orderNumber ?? '').trim()
            const directOrderPrice = orderNo ? (purchasePriceByOrderNo.get(orderNo) || 0) : 0
            const orderOverridePrice = getOrderOverridePrice(orderNo)
            const entry = materialNo ? materialPriceMapLocal.get(materialNo) : undefined
            const mapPrice = entry && entry.qty > 0 ? entry.amount / entry.qty : 0
            const perSheetPurchasePrice = directOrderPrice || mapPrice
            const materialSqmPrice = getOverridePrice(materialKey, dateForPrice)

            const width = Number(order.boardWidth ?? (first && first.boardWidth) ?? 0)
            const height = Number(order.boardHeight ?? (first && first.boardHeight) ?? 0)
            const effectiveWidth = width > 0 ? width + 30 : 0
            const area =
              effectiveWidth > 0 && height > 0
                ? (effectiveWidth * height) / 1000000
                : 0
            const effectiveSheetCount = getEffectiveSheetCount(order, first)

            if (orderOverridePrice > 0 && area > 0 && effectiveSheetCount > 0) {
              rawMaterialCost = effectiveSheetCount * (area * orderOverridePrice)
            } else if (perSheetPurchasePrice > 0 && effectiveSheetCount > 0) {
              rawMaterialCost = effectiveSheetCount * perSheetPurchasePrice
            } else if (materialSqmPrice > 0 && area > 0 && effectiveSheetCount > 0) {
              rawMaterialCost = effectiveSheetCount * (area * materialSqmPrice)
            } else {
              rawMaterialCost = 0
            }
          }
        }
      }

      const scrapEventTs = (!isPurchaseExact && statusVal === 'scrapped')
        ? getScrapEventTs(order)
        : 0
      if (!isPurchaseExact && statusVal === 'scrapped') {
        scrapCost = getProductionOrderAmount(order)
      }

      const getSalesOrderAmount = () => {
        const items = Array.isArray(order?.items) ? order.items : []
        const first = items[0] || {}
        const qty = Number(
          order.quantity ??
          order.totalQty ??
          (Array.isArray(items)
            ? items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
            : 0)
        )
        let unitPrice = Number(order.unitPrice ?? first.unitPrice ?? 0)
        if (!(unitPrice > 0) && qty > 0) {
          const rawAmt = Number(order.amount ?? order.totalAmount ?? order.finalAmount ?? order.orderAmount ?? 0)
          if (Number.isFinite(rawAmt) && rawAmt > 0) unitPrice = rawAmt / qty
        }
        const orderAmount = Number(
          order.amount ?? order.totalAmount ?? order.finalAmount ?? order.orderAmount ?? (Number(qty || 0) * Number(unitPrice || 0))
        )
        return Number.isFinite(orderAmount) ? orderAmount : 0
      }

      const usedRevenueAmount = isGoodsPurchaseRevenue ? getGoodsPurchaseOrderAmount(order) : getSalesOrderAmount()

      if (inCurrentMonth && isSalesRevenueOrder) {
        const amount = usedRevenueAmount
        currentSales += amount
        currentGrossProfit += amount - rawMaterialCost
        if (customerName) {
          monthCustomerAmountMap.set(
            customerName,
            (monthCustomerAmountMap.get(customerName) || 0) + amount
          )
        }
      }

      if (isSalesRevenueOrder) {
        const amount = usedRevenueAmount
        if (customerName) {
          if (ts >= quarterStartTs && ts <= quarterEndTs) {
            quarterCustomerAmountMap.set(
              customerName,
              (quarterCustomerAmountMap.get(customerName) || 0) + amount
            )
          }
          if (ts >= yearStart && ts <= yearEnd) {
            yearCustomerAmountMap.set(
              customerName,
              (yearCustomerAmountMap.get(customerName) || 0) + amount
            )
          }
        }
        if (ts >= yearStart && ts <= yearEnd) {
          yearSales += amount
          yearGrossProfit += amount - rawMaterialCost
        }
        const bucketKey = getBucketKey(ts)
        if (bucketKey) {
          trendMap.set(bucketKey, (trendMap.get(bucketKey) || 0) + amount)
        }
      }

      if (isCostRelevant) {
        const delta = {
          productionCost: !isPurchaseExact ? rawMaterialCost : 0,
          purchaseCost: isGoodsPurchaseRevenue ? rawMaterialCost : 0,
          scrapCost: 0,
          rawMaterialPurchaseCost: 0
        }
        addCostToMonth(ts, delta)
        if (scrapCost > 0) {
          const usedScrapTs = scrapEventTs || ts
          addCostToMonth(usedScrapTs, {
            productionCost: 0,
            purchaseCost: 0,
            scrapCost,
            rawMaterialPurchaseCost: 0
          })
        }
      }

      if (inLastMonth && isSalesRevenueOrder) {
        const amount = usedRevenueAmount
        lastSales += amount
        if (!isPurchaseExact) {
          lastMonthProductionCost += rawMaterialCost
        }
      }
      if (!isPurchaseExact && scrapCost > 0) {
        const usedScrapTs = scrapEventTs || ts
        if (usedScrapTs >= lastStartTs && usedScrapTs <= lastEndTs) {
          lastMonthScrapCost += scrapCost
        }
      }
      if (inLastMonth && isGoodsPurchaseRevenue) {
        lastMonthPurchaseCost += rawMaterialCost
      }
    })

    const existingOrderIds = new Set(
      businessOrders
        .map(o => String(o?._id ?? o?.id ?? '').trim())
        .filter(Boolean)
    )

    purchaseOrders
      .filter(isGoodsPurchase)
      .forEach((o) => {
        if (!o) return
        const id = String(o?._id ?? o?.id ?? '').trim()
        if (id && existingOrderIds.has(id)) return

        const rawDate = o.createdAt || o.createTime || o.date || o.orderDate || o.updatedAt || null
        const ts = normalizeTime(rawDate)
        if (!ts) return

        const items = Array.isArray(o.items) ? o.items : []
        const first = items[0] || {}
        const quantity =
          o.quantity ??
          o.totalQty ??
          (Array.isArray(o.items)
            ? o.items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0)
            : 0)
        const qty = Number(quantity || 0)
        if (!(qty > 0)) return

        const purchaseUnitPrice = Number(
          o.salePrice ??
          (first && first.unitPrice) ??
          o.unitPrice ??
          0
        )
        const saleUnitPrice = Number(
          o.unitPrice ??
          o.salePrice ??
          (first && first.unitPrice) ??
          0
        )
        const orderAmount = Number(qty * saleUnitPrice)
        const materialCode =
          o.materialCode ??
          (first && first.materialCode) ??
          ''
        const materialNo =
          o.materialNo ??
          (first && first.materialNo) ??
          ''
        const materialKey = materialCode || materialNo || ''
        const overridePrice = getOverridePrice(materialKey, rawDate)
        const materialPrice = overridePrice || purchaseUnitPrice
        const rawMaterialCost = Number(qty * Number(materialPrice || 0))

        const nameRaw =
          o.customerName ??
          o.customer?.name ??
          o.customer ??
          o.supplierName ??
          o.supplier?.name ??
          o.supplier ??
          ''
        const customerName = customerShortNameMap.get(nameRaw) || nameRaw

        const inCurrentMonth = ts >= currentStartTs && ts <= currentEndTs
        const inLastMonth = ts >= lastStartTs && ts <= lastEndTs

        if (inCurrentMonth) {
          currentSales += orderAmount
          currentGrossProfit += orderAmount - rawMaterialCost
          if (customerName) {
            monthCustomerAmountMap.set(
              customerName,
              (monthCustomerAmountMap.get(customerName) || 0) + orderAmount
            )
          }
        }

        if (ts >= yearStart && ts <= yearEnd) {
          yearSales += orderAmount
          yearGrossProfit += orderAmount - rawMaterialCost
          if (customerName) {
            yearCustomerAmountMap.set(
              customerName,
              (yearCustomerAmountMap.get(customerName) || 0) + orderAmount
            )
          }
        }

        if (customerName && ts >= quarterStartTs && ts <= quarterEndTs) {
          quarterCustomerAmountMap.set(
            customerName,
            (quarterCustomerAmountMap.get(customerName) || 0) + orderAmount
          )
        }

        const bucketKey = getBucketKey(ts)
        if (bucketKey) {
          trendMap.set(bucketKey, (trendMap.get(bucketKey) || 0) + orderAmount)
        }

        addCostToMonth(ts, {
          productionCost: 0,
          purchaseCost: rawMaterialCost,
          scrapCost: 0,
          rawMaterialPurchaseCost: 0
        })

        if (inLastMonth) {
          lastSales += orderAmount
          lastMonthPurchaseCost += rawMaterialCost
        }
      })

    if (Array.isArray(rawMaterialPurchaseOrders) && rawMaterialPurchaseOrders.length) {
      rawMaterialPurchaseOrders.forEach((o) => {
        if (!o) return
        if (!isRawMaterialPurchase(o)) return
        const createdAt =
          o.createdAt || o.createTime || o.orderTime || o._createTime || o.updatedAt || o.updateTime || null
        const ts = normalizeTime(createdAt)
        if (!ts) return
        const items = Array.isArray(o.items) ? o.items : []
        const first = items[0] || {}
        const qty = Number(
          o.quantity ??
          o.totalQty ??
          (Array.isArray(items) ? items.reduce((sum, it) => sum + (Number(it?.quantity) || 0), 0) : 0)
        )
        const price = Number(o.unitPrice ?? o.salePrice ?? first.unitPrice ?? 0)
        if (!(qty > 0) || !(price > 0)) return
        const amount = qty * price
        if (ts >= lastStartTs && ts <= lastEndTs) {
          lastMonthRawMaterialPurchaseCost += amount
        }
        addCostToMonth(ts, {
          productionCost: 0,
          purchaseCost: 0,
          scrapCost: 0,
          rawMaterialPurchaseCost: amount
        })
      })
    }

    const trend = []
    const buildTopCustomers = (map) =>
      Array.from(map.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .map(([customer, amount]) => ({ customer, amount: Number(amount.toFixed(2)) }))

    const topCustomers = buildTopCustomers(
      customerRankMode === 'quarter'
        ? quarterCustomerAmountMap
        : customerRankMode === 'year'
          ? yearCustomerAmountMap
          : monthCustomerAmountMap
    )
    let salesYoY = 0
    if (lastSales > 0) {
      salesYoY = ((currentSales - lastSales) / lastSales) * 100
    }
    const normalizedYoY = Number.isFinite(salesYoY) ? Number(salesYoY.toFixed(1)) : 0
    const yearGrossMargin = yearSales > 0
      ? Number(((yearGrossProfit / yearSales) * 100).toFixed(1))
      : 0
    setBusinessStats({
      currentSales: Number(currentSales.toFixed(2)),
      lastSales: Number(lastSales.toFixed(2)),
      yearSales: Number(yearSales.toFixed(2)),
      yearGrossProfit: Number(yearGrossProfit.toFixed(2)),
      yearGrossMargin,
      salesYoY: normalizedYoY,
      currentGrossProfit: Number(currentGrossProfit.toFixed(2)),
      currentGrossMargin:
        currentSales > 0
          ? Number(((currentGrossProfit / currentSales) * 100).toFixed(1))
          : 0,
      lastMonthProductionCost: Number(lastMonthProductionCost.toFixed(2)),
      lastMonthPurchaseCost: Number(lastMonthPurchaseCost.toFixed(2)),
      lastMonthScrapCost: Number(lastMonthScrapCost.toFixed(2)),
      lastMonthRawMaterialPurchaseCost: Number(lastMonthRawMaterialPurchaseCost.toFixed(2)),
      trend,
      topCustomers
    })
    const normalizedCostMonthly = {}
    costMonthlyMap.forEach((value, key) => {
      normalizedCostMonthly[key] = {
        productionCost: Number(value.productionCost.toFixed(2)),
        purchaseCost: Number(value.purchaseCost.toFixed(2)),
        scrapCost: Number(value.scrapCost.toFixed(2)),
        rawMaterialPurchaseCost: Number(value.rawMaterialPurchaseCost.toFixed(2))
      }
    })
    setCostMonthlyStats(normalizedCostMonthly)
  }, [orders, customers, salesTrendRange, customerRankMode, materialPriceMap, rawMaterialPurchaseOrders])

  const buildCostRangeLabel = () => {
    if (costRangeMode === 'lastMonth') {
      return '上月'
    }
    if (costRangeMode === 'last3Months') {
      return '近3月'
    }
    if (costRangeMode === 'last6Months') {
      return '近6月'
    }
    return `${costYear}年`
  }

  const buildRangeMonthKeys = () => {
    const keys = []
    if (costRangeMode === 'lastMonth') {
      const d = dayjs().subtract(1, 'month')
      keys.push(d.format('YYYY-MM'))
      return keys
    }
    if (costRangeMode === 'last3Months') {
      let d = dayjs()
      for (let i = 0; i < 3; i += 1) {
        keys.push(d.format('YYYY-MM'))
        d = d.subtract(1, 'month')
      }
      return keys
    }
    if (costRangeMode === 'last6Months') {
      let d = dayjs()
      for (let i = 0; i < 6; i += 1) {
        keys.push(d.format('YYYY-MM'))
        d = d.subtract(1, 'month')
      }
      return keys
    }
    for (let m = 1; m <= 12; m += 1) {
      keys.push(`${costYear}-${String(m).padStart(2, '0')}`)
    }
    return keys
  }

  const costRangeLabel = buildCostRangeLabel()
  const rangeMonthKeys = buildRangeMonthKeys()

  const aggregatedCostStats = (() => {
    let production = 0
    let purchase = 0
    let scrap = 0
    let rawMatPurchase = 0
    rangeMonthKeys.forEach((key) => {
      const row = costMonthlyStats[key]
      if (!row) return
      production += row.productionCost || 0
      purchase += row.purchaseCost || 0
      scrap += row.scrapCost || 0
      rawMatPurchase += row.rawMaterialPurchaseCost || 0
    })
    return {
      production: Number(production.toFixed(2)),
      purchase: Number(purchase.toFixed(2)),
      scrap: Number(scrap.toFixed(2)),
      rawMatPurchase: Number(rawMatPurchase.toFixed(2))
    }
  })()

  const aggregatedSalaryStats = (() => {
    let salary = 0
    rangeMonthKeys.forEach((key) => {
      const s = employeeStats.salaryMonthly?.[key]
      if (s) salary += s
    })
    return {
      salary: Number(salary.toFixed(2))
    }
  })()

  const buildAggregatedFixedCostByMonths = (monthKeys) => {
    if (!Array.isArray(fixedCostItems) || fixedCostItems.length === 0 || !Array.isArray(monthKeys) || !monthKeys.length) {
      return { total: 0 }
    }
    const keySet = new Set(monthKeys)
    let total = 0
    fixedCostItems.forEach((item) => {
      if (!item) return
      const amount = Number(item.amount || 0)
      const ts = Number(item.date || item.createdAt || 0)
      if (!Number.isFinite(amount) || amount <= 0) return
      if (!Number.isFinite(ts) || ts <= 0) return
      const d = dayjs(ts)
      if (!d.isValid()) return
      const key = d.format('YYYY-MM')
      if (!keySet.has(key)) return
      total += amount
    })
    return {
      total: Number(total.toFixed(2))
    }
  }

  const aggregatedFixedCostStats = buildAggregatedFixedCostByMonths(rangeMonthKeys)

  const costCards = [
    { title: `${costRangeLabel}生产成本`, value: aggregatedCostStats.production, prefix: '¥', precision: 2 },
    { title: `${costRangeLabel}采购成本`, value: aggregatedCostStats.purchase, prefix: '¥', precision: 2 },
    { title: `${costRangeLabel}报废成本`, value: aggregatedCostStats.scrap, prefix: '¥', precision: 2 },
    { title: `${costRangeLabel}辅材采购成本`, value: aggregatedCostStats.rawMatPurchase, prefix: '¥', precision: 2 }
  ]

  const costStructureData = [
    { type: '生产成本', value: aggregatedCostStats.production },
    { type: '采购成本', value: aggregatedCostStats.purchase },
    { type: '辅材成本', value: aggregatedCostStats.rawMatPurchase },
    { type: '人工', value: aggregatedSalaryStats.salary },
    { type: '固定成本', value: aggregatedFixedCostStats.total },
    { type: '报废损失', value: aggregatedCostStats.scrap }
  ]

  const costColorMap = {
    生产成本: '#1890ff',
    采购成本: '#13c2c2',
    辅材成本: '#faad14',
    人工: '#52c41a',
    固定成本: '#722ed1',
    报废损失: '#f5222d'
  }

  let costPieTotal = 0

  const costPieData = (() => {
    const positiveItems = costStructureData.filter((item) => {
      const val = Number(item.value || 0)
      return Number.isFinite(val) && val > 0
    })
    const total = positiveItems.reduce((sum, item) => {
      const val = Number(item.value || 0)
      return sum + (Number.isFinite(val) ? val : 0)
    }, 0)
    costPieTotal = total
    if (!total) {
      return []
    }
    return positiveItems.map((item) => {
      const val = Number(item.value || 0)
      const ratio = Number.isFinite(val) && total > 0 ? (val / total) * 100 : 0
      return {
        ...item,
        percent: Number(ratio.toFixed(2))
      }
    })
  })()

  const costStructureConfig = {
    data: costPieData,
    angleField: 'value',
    colorField: 'type',
    color: (d) => costColorMap[d.type] || '#888888',
    radius: 0.85,
    label: {
      text: (d) => {
        if (!d) {
          return ''
        }
        const rawName = typeof d.type === 'string' ? d.type : ''
        const name = rawName.trim()
        const val = Number(d.value || 0)
        if (!Number.isFinite(val) || val <= 0 || !Number.isFinite(costPieTotal) || costPieTotal <= 0) {
          return ''
        }
        const p = (val / costPieTotal) * 100
        const percentText = `${p.toFixed(2)}%`
        if (!name) {
          return percentText
        }
        return `${name} ${percentText}`
      },
      position: 'outside',
      offset: 18,
      style: {
        fontSize: 12,
        fill: '#000000'
      },
      layout: [
        // 优先在圆周方向上“均匀分布”标签，尽量上下错开
        { type: 'distribute' },
        // 如果仍有重叠，再做局部位置调整
        { type: 'overlap' },
        // 实在放不下时，隐藏少数超出范围的标签，保持整体清晰
        { type: 'limit-in-plot', cfg: { action: 'hide' } }
      ]
    },
    height: 260,
    tooltip: {
      items: [
        (d) => ({
          name: typeof d.type === 'string' && d.type ? d.type : '其他',
          value: `¥${Number(d.value).toLocaleString()}`
        })
      ]
    },
    legend: false
  }

  const costShareData = (() => {
    const total = costStructureData.reduce((sum, item) => {
      const val = Number(item.value || 0)
      return sum + (Number.isFinite(val) ? val : 0)
    }, 0)
    if (!total) {
      return costStructureData.map((item) => ({
        type: item.type,
        value: 0
      }))
    }
    const data = costStructureData.map((item) => {
      const val = Number(item.value || 0)
      const ratio = Number.isFinite(val) && total > 0 ? (val / total) * 100 : 0
      return {
        type: item.type,
        value: Number(ratio.toFixed(2))
      }
    })
    data.sort((a, b) => b.value - a.value)
    return data
  })()

  const costShareConfig = {
    data: costShareData,
    xField: 'type',
    yField: 'value',
    colorField: 'type',
    color: (d) => costColorMap[d.type] || '#888888',
    height: 260,
    axis: {
      y: {
        labelFormatter: (v) => `${Number(v).toFixed(0)}%`,
        title: false
      },
      x: { title: false }
    },
    tooltip: {
      items: [
        (d) => ({
          name: d.type,
          value: `${Number(d.value).toFixed(2)}%`
        })
      ]
    }
  }

  const financeNow = dayjs()
  const financeMonthStart = financeNow.startOf('month')
  const financeMonthEnd = financeNow.endOf('month')
  const financeYear = financeNow.year()
  const financeMonth = financeNow.month() + 1

  const financeCustomerMap = (() => {
    const map = new Map()
      ; (Array.isArray(customers) ? customers : []).forEach((c) => {
        if (!c) return
        if (c._id) map.set(String(c._id), c)
        if (c.id) map.set(String(c.id), c)
        if (c.name) map.set(String(c.name), c)
        if (c.companyName) map.set(String(c.companyName), c)
      })
    return map
  })()

  const getOrderAmountForFinance = (order) => {
    if (!order) return 0
    const base =
      order.amount ??
      order.totalAmount ??
      order.totalPrice ??
      0
    const n = Number(base || 0)
    if (Number.isFinite(n) && n > 0) return n
    const qty = Number(order.quantity || 0)
    const unit = Number(order.unitPrice || order.price || 0)
    if (Number.isFinite(qty) && Number.isFinite(unit) && qty > 0 && unit > 0) {
      return qty * unit
    }
    if (Array.isArray(order.items) && order.items.length > 0) {
      return order.items.reduce((sum, it) => {
        if (!it) return sum
        const v = Number(it.totalPrice ?? it.amount ?? it.price ?? 0)
        return sum + (Number.isFinite(v) ? v : 0)
      }, 0)
    }
    return 0
  }

  const financeSalesOrders = (Array.isArray(orders) ? orders : []).filter((o) => {
    const t = String(o?.orderType || '').toLowerCase()
    if (t === 'purchase') return false
    if (o?._businessMergedFrom === 'purchase') return false
    return true
  })

  const financeInvoicedAmountThisMonth = (() => {
    const startTs = financeMonthStart.valueOf()
    const endTs = financeMonthEnd.valueOf()
    return financeSalesOrders.reduce((sum, o) => {
      const note = o?.shippingNote && typeof o.shippingNote === 'object' ? o.shippingNote : null
      const invoicedRaw = (note && note.invoicedAt) || o?.invoicedAt || null
      if (!invoicedRaw) return sum
      const d = dayjs(invoicedRaw)
      if (!d.isValid()) return sum
      const ts = d.valueOf()
      if (ts < startTs || ts > endTs) return sum
      return sum + getOrderAmountForFinance(o)
    }, 0)
  })()

  const financeInvoicedAmountThisYear = (() => {
    return financeSalesOrders.reduce((sum, o) => {
      const note = o?.shippingNote && typeof o.shippingNote === 'object' ? o.shippingNote : null
      const invoicedRaw = (note && note.invoicedAt) || o?.invoicedAt || null
      if (!invoicedRaw) return sum
      const d = dayjs(invoicedRaw)
      if (!d.isValid()) return sum
      if (d.year() !== financeYear) return sum
      return sum + getOrderAmountForFinance(o)
    }, 0)
  })()

  const financeReceivableSummary = (() => {
    const map = receivablePaymentMap && typeof receivablePaymentMap === 'object' ? receivablePaymentMap : {}
    const receivableMap = new Map()
    financeSalesOrders.forEach((o) => {
      const note = o?.shippingNote && typeof o.shippingNote === 'object' ? o.shippingNote : null
      const reconciledRaw = (note && note.reconciledAt) || o?.reconciledAt || null
      const statementNo = o?.statementNo || (note && note.statementNo) || ''
      if (!reconciledRaw || !statementNo) return

      const customerId =
        o?.customerId ||
        o?.customer?._id ||
        o?.customer?.id ||
        ''
      const customerObj =
        (customerId && financeCustomerMap.get(String(customerId))) ||
        (o?.customerName && financeCustomerMap.get(String(o.customerName))) ||
        (o?.customer?.name && financeCustomerMap.get(String(o.customer.name))) ||
        {}

      const paymentTerm =
        customerObj.paymentTerms ||
        o?.paymentTerm ||
        o?.paymentTerms ||
        o?.term ||
        ''

      const fullCustomerName =
        customerObj.companyName ||
        customerObj.name ||
        o?.customerName ||
        o?.customer?.name ||
        o?.customer ||
        ''

      const amountVal = getOrderAmountForFinance(o)

      const invoicedRaw = (note && note.invoicedAt) || o?.invoicedAt || null
      const paidRaw = (note && note.paidAt) || o?.paidAt || null
      const invoiceDate = invoicedRaw ? dayjs(invoicedRaw).format('YYYY-MM-DD') : ''
      const paymentDate = paidRaw ? dayjs(paidRaw).format('YYYY-MM-DD') : ''
      const reconcileDate = dayjs(reconciledRaw).isValid()
        ? dayjs(reconciledRaw).format('YYYY-MM-DD')
        : ''

      const prev = receivableMap.get(statementNo) || {
        statementNo,
        customerName: fullCustomerName,
        customerId,
        amountReceivable: 0,
        amountReceived: 0,
        invoiceDate: '',
        paymentDate: '',
        reconcileDate: '',
        dueDate: '',
        paymentTerm
      }

      prev.amountReceivable += Number(amountVal || 0)
      if (invoiceDate && (!prev.invoiceDate || invoiceDate > prev.invoiceDate)) {
        prev.invoiceDate = invoiceDate
      }
      if (reconcileDate && !prev.reconcileDate) {
        prev.reconcileDate = reconcileDate
      }

      if (!map[statementNo]) {
        if (paymentDate) {
          prev.amountReceived += Number(amountVal || 0)
          if (!prev.paymentDate || paymentDate > prev.paymentDate) {
            prev.paymentDate = paymentDate
          }
        }
      }

      receivableMap.set(statementNo, prev)
    })

    Array.from(receivableMap.values()).forEach((r) => {
      const local = map[r.statementNo]
      if (local) {
        r.amountReceived = Number(local.received || 0)
        if (local.lastPaymentDate) {
          r.paymentDate = String(local.lastPaymentDate || '')
        }
      }
      if (!r.dueDate && r.reconcileDate) {
        const reconcileMoment = dayjs(r.reconcileDate)
        if (reconcileMoment.isValid()) {
          const paymentTermStr = String(r.paymentTerm || '')
          let calculatedDate = reconcileMoment
          if (paymentTermStr.includes('月结')) {
            const match = paymentTermStr.match(/(\d+)天/)
            const daysToAdd = match ? parseInt(match[1], 10) : 0
            const baseDate = reconcileMoment.add(1, 'month').startOf('month')
            calculatedDate = baseDate.add(daysToAdd, 'day')
          } else if (paymentTermStr.includes('现结') || paymentTermStr.includes('现付')) {
            calculatedDate = reconcileMoment
          }
          r.dueDate = calculatedDate.format('YYYY-MM-DD')
        }
      }
    })

    const dueStartTs = financeMonthStart.valueOf()
    const dueEndTs = financeMonthEnd.valueOf()
    let monthReceivableDue = 0
    Array.from(receivableMap.values()).forEach((r) => {
      const total = Number(r.amountReceivable || 0)
      const received = Number(r.amountReceived || 0)
      const usedReceived = Math.min(Math.max(received, 0), total)
      const remaining = total - usedReceived
      if (!Number.isFinite(remaining) || remaining <= 0) return
      if (!r.invoiceDate) return
      if (!r.dueDate) return
      const due = dayjs(r.dueDate)
      if (!due.isValid()) return
      const dueTs = due.valueOf()
      if (dueTs < dueStartTs || dueTs > dueEndTs) return
      monthReceivableDue += remaining
    })

    return {
      monthReceivableDue
    }
  })()

  const financePayableSummary = (() => {
    const list = Array.isArray(manualPayables) ? manualPayables : []
    const monthStartTs = financeMonthStart.valueOf()
    const monthEndTs = financeMonthEnd.valueOf()
    const dueEndTs = financeMonthEnd.valueOf()

    let monthInputTotal = 0
    let monthInputUnpaid = 0
    let totalUnpaid = 0
    let yearInputTotal = 0
    let overdueUnpaidByMonthEnd = 0
    let monthPayableDueUnpaid = 0

    list.forEach((it) => {
      if (!it) return
      const amountPayable = Number(it.amountPayable || 0)
      const amountPaid = Number(it.amountPaid || 0)
      if (!Number.isFinite(amountPayable) || amountPayable <= 0) return
      const unpaid = Math.max(amountPayable - (Number.isFinite(amountPaid) ? amountPaid : 0), 0)
      totalUnpaid += unpaid

      const invoiceRaw = it.invoiceDate || it.date || null
      const invoiceMoment = invoiceRaw ? dayjs(invoiceRaw) : null
      if (invoiceMoment && invoiceMoment.isValid()) {
        if (invoiceMoment.year() === financeYear) {
          yearInputTotal += amountPayable
        }
        const ts = invoiceMoment.valueOf()
        if (ts >= monthStartTs && ts <= monthEndTs) {
          monthInputTotal += amountPayable
          monthInputUnpaid += unpaid
        }
      }

      const dueRaw = it.dueDate || null
      const dueMoment = dueRaw ? dayjs(dueRaw) : null
      if (dueMoment && dueMoment.isValid()) {
        const dueTs = dueMoment.valueOf()
        if (dueTs >= monthStartTs && dueTs <= monthEndTs) {
          monthPayableDueUnpaid += unpaid
        }
        if (dueTs <= dueEndTs) {
          overdueUnpaidByMonthEnd += unpaid
        }
      }
    })

    return {
      monthInputTotal,
      monthInputUnpaid,
      totalUnpaid,
      yearInputTotal,
      overdueUnpaidByMonthEnd,
      monthPayableDueUnpaid
    }
  })()

  const financeMonthTaxAmount = (() => {
    const invoiced = Number(financeInvoicedAmountThisMonth || 0)
    const input = Number(financePayableSummary.monthInputTotal || 0)
    const val = invoiced * 0.13 - input * 0.13
    if (!Number.isFinite(val)) return 0
    return Number(val.toFixed(2))
  })()

  const financeMonthGrossProfitAmount = (() => {
    const invoiced = Number(financeInvoicedAmountThisMonth || 0)
    const input = Number(financePayableSummary.monthInputTotal || 0)
    const tax = Number(financeMonthTaxAmount || 0)
    const val = invoiced - input - tax
    if (!Number.isFinite(val)) return 0
    return Number(val.toFixed(2))
  })()

  const financeCards = [
    { title: '本月开票金额', value: financeInvoicedAmountThisMonth, prefix: '¥', precision: 2 },
    { title: '本月进项金额', value: financePayableSummary.monthInputTotal, prefix: '¥', precision: 2, color: '#52c41a' },
    { title: '本月应收款金额', value: financeReceivableSummary.monthReceivableDue, prefix: '¥', precision: 2, color: '#faad14' },
    { title: '本月逾期未付金额', value: financePayableSummary.overdueUnpaidByMonthEnd, prefix: '¥', precision: 2, color: '#f5222d' },
    { title: '本月应付货款金额', value: financePayableSummary.monthPayableDueUnpaid, prefix: '¥', precision: 2 },
    { title: '本月税额', value: financeMonthTaxAmount, prefix: '¥', precision: 2, color: '#f5222d' },
    { title: '今年开票金额合计', value: financeInvoicedAmountThisYear, prefix: '¥', precision: 2 },
    { title: '今年进项金额合计', value: financePayableSummary.yearInputTotal, prefix: '¥', precision: 2, color: '#52c41a' }
  ]

  const receivableAgingData = [
    { type: '0-30天', value: 210000 },
    { type: '31-60天', value: 120000 },
    { type: '61-90天', value: 70000 },
    { type: '90天以上', value: 30000 }
  ]

  const receivableAgingConfig = {
    data: receivableAgingData,
    xField: 'type',
    yField: 'value',
    height: 260,
    axis: {
      y: { labelFormatter: (v) => `${Number(v) / 10000} 万`, title: false },
      x: { title: false }
    },
    tooltip: {
      items: [
        (d) => ({
          name: '应收余额',
          value: `¥${Number(d.value).toLocaleString()}`
        })
      ]
    }
  }

  const financeIncomeExpenseStructureData = (() => {
    const round2 = (v) => {
      const n = Number(v || 0)
      if (!Number.isFinite(n)) return 0
      return Number(n.toFixed(2))
    }
    const clamp = (v, min, max) => Math.min(Math.max(v, min), max)

    const total = round2(Math.max(Number(financeInvoicedAmountThisMonth || 0), 0))
    const rawInput = Math.max(Number(financePayableSummary.monthInputTotal || 0), 0)
    const input = round2(clamp(rawInput, 0, total))
    const tax = round2(clamp((total - input) * 0.13, 0, total))
    let profit = round2(clamp(total - input - tax, 0, total))

    const sum = round2(profit + tax + input)
    const diff = round2(total - sum)
    if (diff !== 0) {
      const nextProfit = round2(profit + diff)
      if (nextProfit >= 0) {
        profit = nextProfit
      }
    }

    return [
      { type: '毛利润', value: profit },
      { type: '税额', value: tax },
      { type: '进项金额', value: input }
    ]
  })()

  const financeIncomeExpenseStructureConfig = {
    data: financeIncomeExpenseStructureData,
    angleField: 'value',
    colorField: 'type',
    height: 260,
    radius: 0.95,
    innerRadius: 0.6,
    color: (d) => {
      if (!d) return '#1890ff'
      if (d.type === '进项金额') return '#52c41a'
      if (d.type === '税额') return '#faad14'
      if (d.type === '毛利润') return '#1890ff'
      return '#1890ff'
    },
    label: {
      text: (d) => {
        const val = Number(d?.value || 0)
        if (!Number.isFinite(val) || val <= 0) return ''
        const total = Number(financeInvoicedAmountThisMonth || 0)
        const pct = Number.isFinite(total) && total > 0 ? ((val / total) * 100).toFixed(1) : '0.0'
        return `${d.type} ${pct}%`
      },
      position: 'outside'
    },
    tooltip: {
      items: [
        (d) => {
          const val = Number(d?.value || 0)
          const total = Number(financeInvoicedAmountThisMonth || 0)
          const pct = Number.isFinite(total) && total > 0 ? ((val / total) * 100).toFixed(2) : '0.00'
          return {
            name: d.type,
            value: `¥${Number(val || 0).toLocaleString()}（${pct}%）`
          }
        }
      ]
    },
    legend: {
      position: 'bottom'
    }
  }

  const lastMonthTotalCost =
    aggregatedCostStats.production +
    aggregatedCostStats.purchase +
    aggregatedCostStats.scrap +
    aggregatedCostStats.rawMatPurchase +
    aggregatedSalaryStats.salary +
    aggregatedFixedCostStats.total

  const hrCards = [
    { title: '在职员工数', value: employeeStats.employeeCount },
    { title: `${costRangeLabel}员工工资额`, value: aggregatedSalaryStats.salary, prefix: '¥', precision: 2 },
    { title: `${costRangeLabel}固定成本`, value: aggregatedFixedCostStats.total, prefix: '¥', precision: 2 },
    { title: `${costRangeLabel}总成本`, value: lastMonthTotalCost, prefix: '¥', precision: 2 }
  ]

  const filteredFixedCostItems = (() => {
    if (!Array.isArray(fixedCostItems) || fixedCostItems.length === 0) {
      return []
    }
    let start = null
    let end = null
    if (fixedCostRangeMode === 'lastMonth') {
      const d = dayjs().subtract(1, 'month')
      start = d.startOf('month')
      end = d.endOf('month')
    } else if (fixedCostRangeMode === 'last3Months') {
      end = dayjs().endOf('day')
      start = end.subtract(3, 'month').startOf('month')
    } else if (fixedCostRangeMode === 'last6Months') {
      end = dayjs().endOf('day')
      start = end.subtract(6, 'month').startOf('month')
    } else if (fixedCostRangeMode === 'year') {
      const y = Number(fixedCostYear) || dayjs().year()
      const d = dayjs(`${y}-01-01`)
      start = d.startOf('year')
      end = d.endOf('year')
    }
    if (!start || !end) {
      return fixedCostItems.slice()
    }
    return fixedCostItems.filter((item) => {
      if (!item) return false
      const ts = Number(item.date || item.createdAt || 0)
      if (!Number.isFinite(ts) || ts <= 0) return false
      const d = dayjs(ts)
      if (!d.isValid()) return false
      if (d.isBefore(start) || d.isAfter(end)) return false
      return true
    })
  })()

  const fixedCostStats = (() => {
    const now = dayjs()
    const currentYear = now.year()
    const currentMonth = now.month() + 1
    let monthTotal = 0
    let yearTotal = 0
    let maxSingle = 0
    fixedCostItems.forEach((item) => {
      if (!item) return
      const amount = Number(item.amount || 0)
      const ts = Number(item.date || item.createdAt || 0)
      if (!Number.isFinite(amount) || amount <= 0) return
      if (!Number.isFinite(ts) || ts <= 0) return
      const d = dayjs(ts)
      if (!d.isValid()) return
      if (d.year() !== currentYear) return
      yearTotal += amount
      if (d.month() + 1 === currentMonth) {
        monthTotal += amount
      }
      if (amount > maxSingle) {
        maxSingle = amount
      }
    })
    return {
      monthTotal: Number(monthTotal.toFixed(2)),
      yearTotal: Number(yearTotal.toFixed(2)),
      maxSingle: Number(maxSingle.toFixed(2)),
      itemCount: fixedCostItems.length
    }
  })()

  const majorExpenseCards = [
    { title: '本月固定成本', value: fixedCostStats.monthTotal, prefix: '¥', precision: 2 },
    { title: '本年累计固定成本', value: fixedCostStats.yearTotal, prefix: '¥', precision: 2 },
    { title: '固定成本项目数', value: fixedCostStats.itemCount, precision: 0 },
    { title: '最高单项固定成本', value: fixedCostStats.maxSingle, prefix: '¥', precision: 2 }
  ]

  const majorExpenseData = (() => {
    const presetCategories = ['房租', '购买设备', '水电费', '设备维修', '加油费', '加工费', '宴请费用', '杂费']
    const byCategory = new Map()
    presetCategories.forEach((name) => {
      byCategory.set(name, 0)
    })
    filteredFixedCostItems.forEach((item) => {
      if (!item) return
      const amount = Number(item.amount || 0)
      if (!Number.isFinite(amount) || amount <= 0) return
      const raw = String(item.category || '').trim() || '未分类'
      const category = presetCategories.includes(raw) ? raw : '杂费'
      byCategory.set(category, (byCategory.get(category) || 0) + amount)
    })
    const data = presetCategories.map((category) => {
      const value = byCategory.get(category) || 0
      return {
        category,
        value: Number(Number(value || 0).toFixed(2))
      }
    })
    return data
  })()

  const majorExpenseColors = ['#5B8FF9', '#61DDAA', '#F6BD16', '#E8684A', '#5AD8A6', '#5D7092', '#6DC8EC', '#9270CA']
  const majorExpenseCategoryOrder = majorExpenseData.map((item) => item.category)
  let majorExpensePieTotal = 0
  const majorExpensePieData = (() => {
    const positiveItems = majorExpenseData.filter((item) => {
      const val = Number(item.value || 0)
      return Number.isFinite(val) && val > 0
    })
    const total = positiveItems.reduce((sum, item) => {
      const val = Number(item.value || 0)
      return sum + (Number.isFinite(val) ? val : 0)
    }, 0)
    majorExpensePieTotal = total
    if (!total) {
      return []
    }
    return positiveItems
  })()

  const majorExpenseConfig = {
    data: majorExpensePieData,
    angleField: 'value',
    colorField: 'category',
    color: (d) => {
      const name = d && typeof d.category === 'string' ? d.category : ''
      const idx = majorExpenseCategoryOrder.indexOf(name)
      if (idx >= 0) {
        return majorExpenseColors[idx % majorExpenseColors.length]
      }
      return '#888888'
    },
    radius: 0.85,
    label: {
      text: (d) => {
        if (!d) {
          return ''
        }
        const rawName = typeof d.category === 'string' ? d.category : ''
        const name = rawName.trim()
        const val = Number(d.value || 0)
        if (!Number.isFinite(val) || val <= 0 || !Number.isFinite(majorExpensePieTotal) || majorExpensePieTotal <= 0) {
          return ''
        }
        const p = (val / majorExpensePieTotal) * 100
        const percentText = `${p.toFixed(2)}%`
        if (!name) {
          return percentText
        }
        return `${name} ${percentText}`
      },
      position: 'outside',
      offset: 18,
      style: {
        fontSize: 12,
        fill: '#000000'
      },
      layout: [
        { type: 'distribute' },
        { type: 'overlap' },
        { type: 'limit-in-plot', cfg: { action: 'hide' } }
      ]
    },
    height: 260,
    tooltip: {
      items: [
        (d) => ({
          name: typeof d.category === 'string' && d.category ? d.category : '其他',
          value: `¥${Number(d.value).toLocaleString()}`
        })
      ]
    },
    legend: {
      position: 'top',
      layout: 'horizontal'
    }
  }

  const hasFixedCostChartData = majorExpenseData.some((item) => Number(item.value || 0) > 0)

  const buildOverallRangeLabel = () => {
    if (overallRangeMode === 'lastMonth') {
      return '上月'
    }
    if (overallRangeMode === 'last3Months') {
      return '近3月'
    }
    if (overallRangeMode === 'last6Months') {
      return '近6月'
    }
    if (overallRangeMode === 'year') {
      return '全年'
    }
    if (overallRangeMode === 'rollingYear') {
      return `${overallYear}年`
    }
    return ''
  }

  const buildOverallRangeMonthKeys = () => {
    const keys = []
    if (overallRangeMode === 'lastMonth') {
      const d = dayjs().subtract(1, 'month')
      keys.push(d.format('YYYY-MM'))
      return keys
    }
    if (overallRangeMode === 'last3Months') {
      let d = dayjs()
      for (let i = 0; i < 3; i += 1) {
        keys.push(d.format('YYYY-MM'))
        d = d.subtract(1, 'month')
      }
      return keys
    }
    if (overallRangeMode === 'last6Months') {
      let d = dayjs()
      for (let i = 0; i < 6; i += 1) {
        keys.push(d.format('YYYY-MM'))
        d = d.subtract(1, 'month')
      }
      return keys
    }
    if (overallRangeMode === 'year') {
      const y = dayjs().year()
      for (let m = 1; m <= 12; m += 1) {
        keys.push(`${y}-${String(m).padStart(2, '0')}`)
      }
      return keys
    }
    if (overallRangeMode === 'rollingYear') {
      const y = Number(overallYear) || dayjs().year()
      for (let m = 1; m <= 12; m += 1) {
        keys.push(`${y}-${String(m).padStart(2, '0')}`)
      }
      return keys
    }
    let d = dayjs()
    for (let i = 0; i < 12; i += 1) {
      keys.push(d.format('YYYY-MM'))
      d = d.subtract(1, 'month')
    }
    return keys
  }

  const overallRangeLabel = buildOverallRangeLabel()
  const overallRangeMonthKeys = buildOverallRangeMonthKeys()

  const overallStats = (() => {
    if (!overallRangeMonthKeys.length) {
      return {
        revenue: 0,
        productionCost: 0,
        salaryCost: 0,
        fixedCost: 0,
        totalCost: 0,
        profit: 0
      }
    }
    const monthKeySet = new Set(overallRangeMonthKeys)
    const normalizeTime = (value) => {
      if (!value) return 0
      if (typeof value === 'number') return value
      const d = dayjs(value)
      if (!d.isValid()) return 0
      return d.valueOf()
    }
    const getAmount = (order) => {
      if (order == null) return 0
      const base = order.totalAmount ?? order.amount ?? 0
      if (base) return Number(base) || 0
      if (Array.isArray(order.items)) {
        return order.items.reduce((sum, item) => {
          const val = item.totalPrice ?? item.amount ?? item.price ?? 0
          return sum + (Number(val) || 0)
        }, 0)
      }
      return 0
    }
    const getMonthKeyFromTs = (ts) => {
      const d = dayjs(ts)
      if (!d.isValid()) return ''
      return d.format('YYYY-MM')
    }
    let revenue = 0
    orders.forEach((order) => {
      const ts = normalizeTime(
        order.createdAt || order.createTime || order._createTime || order.orderTime
      )
      if (!ts) return
      const key = getMonthKeyFromTs(ts)
      if (!monthKeySet.has(key)) return
      const amount = getAmount(order)
      const sourceVal = String(order.source || '').toLowerCase()
      const orderTypeVal = String(order.orderType || '').toLowerCase()
      const categoryVal = String(order.purchaseCategory || order.category || '').toLowerCase()
      const isPurchaseExact = sourceVal === 'purchased' || orderTypeVal === 'purchase'
      const isGoodsPurchase = isPurchaseExact && categoryVal === 'goods'
      if (isPurchaseExact && !isGoodsPurchase) return
      revenue += amount
    })
    let productionCost = 0
    let purchaseCost = 0
    let scrapCost = 0
    let rawMatPurchaseCost = 0
    overallRangeMonthKeys.forEach((key) => {
      const row = costMonthlyStats[key]
      if (!row) return
      productionCost += row.productionCost || 0
      purchaseCost += row.purchaseCost || 0
      scrapCost += row.scrapCost || 0
      rawMatPurchaseCost += row.rawMaterialPurchaseCost || 0
    })
    let salaryCost = 0
    overallRangeMonthKeys.forEach((key) => {
      const s = employeeStats.salaryMonthly?.[key]
      if (s) salaryCost += s
    })
    const fixedCostInfo = buildAggregatedFixedCostByMonths(overallRangeMonthKeys)
    const fixedCost = fixedCostInfo.total || 0
    const totalCost =
      productionCost +
      purchaseCost +
      scrapCost +
      rawMatPurchaseCost +
      salaryCost +
      fixedCost
    const profit = revenue - totalCost
    return {
      revenue: Number(revenue.toFixed(2)),
      productionCost: Number(productionCost.toFixed(2)),
      purchaseCost: Number(purchaseCost.toFixed(2)),
      scrapCost: Number(scrapCost.toFixed(2)),
      rawMatPurchaseCost: Number(rawMatPurchaseCost.toFixed(2)),
      salaryCost: Number(salaryCost.toFixed(2)),
      fixedCost: Number(fixedCost.toFixed(2)),
      totalCost: Number(totalCost.toFixed(2)),
      profit: Number(profit.toFixed(2))
    }
  })()

  const overallCards = [
    { title: `${overallRangeLabel}总销售额`, value: overallStats.revenue, prefix: '¥', precision: 2 },
    { title: `${overallRangeLabel}生产总成本`, value: overallStats.productionCost, prefix: '¥', precision: 2 },
    { title: `${overallRangeLabel}人力成本`, value: overallStats.salaryCost, prefix: '¥', precision: 2 },
    { title: `${overallRangeLabel}固定成本`, value: overallStats.fixedCost, prefix: '¥', precision: 2 },
    { title: `${overallRangeLabel}总利润`, value: overallStats.profit, prefix: '¥', precision: 2 }
  ]

  const overallProfitData = [
    { type: '销售收入', value: overallStats.revenue },
    { type: '生产成本', value: -overallStats.productionCost },
    { type: '采购成本', value: -overallStats.purchaseCost },
    { type: '报废成本', value: -overallStats.scrapCost },
    { type: '辅材采购成本', value: -overallStats.rawMatPurchaseCost },
    { type: '人力成本', value: -overallStats.salaryCost },
    { type: '固定成本', value: -overallStats.fixedCost },
    { type: '利润', value: overallStats.profit }
  ]

  const overallColumns = [
    { title: '项目', dataIndex: 'type', key: 'type' },
    {
      title: '金额',
      dataIndex: 'value',
      key: 'value',
      render: (v) => `¥${Number(v).toLocaleString()}`
    }
  ]

  const overallProfitConfig = {
    data: overallProfitData,
    xField: 'type',
    yField: 'value',
    height: 260,
    style: {
      fill: (d) => d.value > 0 ? '#52c41a' : '#f5222d',
    },
    label: {
      text: (d) => d ? `${(Number(d.value) / 10000).toFixed(1)}万` : '',
      position: 'top',
    },
    tooltip: {
      items: [
        (d) => ({
          name: d.type,
          value: `¥${Number(d.value).toLocaleString()}`
        })
      ]
    },
    axis: {
      x: { title: false },
      y: { title: false, labelFormatter: (v) => `${Number(v) / 10000}万` }
    }
  }

  const renderStatCardsOneRow = (cards) => {
    const columns =
      screens.lg ? 5
        : screens.md ? 3
          : screens.sm ? 2
            : 1

    const cardHeight = screens.lg ? 120 : 110
    const titleFontSize = screens.lg ? 11 : 10
    const valueFontSize = screens.lg ? 18 : 16
    const gap = screens.lg ? 16 : 12

    return (
      <div
        style={{
          marginBottom: 24,
          display: 'grid',
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gap
        }}
      >
        {cards.map((card) => {
          let prefix = card.prefix
          let color = card.color || '#1890ff'
          if (card.trend === 'up') {
            prefix = <ArrowUpOutlined style={{ color: '#f5222d', marginRight: 4 }} />
            color = '#f5222d'
          } else if (card.trend === 'down') {
            prefix = <ArrowDownOutlined style={{ color: '#52c41a', marginRight: 4 }} />
            color = '#52c41a'
          }
          return (
            <Card
              key={card.title}
              variant="borderless"
              hoverable
              styles={{
                body: {
                  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                  borderRadius: '12px',
                  background: '#fff',
                  height: cardHeight,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: screens.lg ? '0 8px' : '0 6px'
                }
              }}
            >
              <Statistic
                title={
                  <span
                    style={{
                      color: '#8c8c8c',
                      fontSize: titleFontSize,
                      display: 'block',
                      marginBottom: 4
                    }}
                  >
                    {card.title}
                  </span>
                }
                value={card.value}
                prefix={prefix}
                suffix={card.suffix}
                precision={card.precision}
                valueStyle={{ color, fontWeight: 'bold', fontSize: valueFontSize }}
              />
            </Card>
          )
        })}
      </div>
    )
  }

  const renderStatCards = (cards) => (
    <Row gutter={[16, 16]} style={{ marginBottom: 24 }} wrap>
      {cards.map((card) => {
        let prefix = card.prefix
        let color = card.color || '#1890ff'
        if (card.trend === 'up') {
          prefix = <ArrowUpOutlined style={{ color: '#f5222d', marginRight: 4 }} />
          color = '#f5222d'
        } else if (card.trend === 'down') {
          prefix = <ArrowDownOutlined style={{ color: '#52c41a', marginRight: 4 }} />
          color = '#52c41a'
        }
        return (
          <Col key={card.title} xs={24} sm={12} md={12} lg={6} xl={6}>
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
                    {card.title}
                  </span>
                }
                value={card.value}
                prefix={prefix}
                suffix={card.suffix}
                precision={card.precision}
                valueStyle={{ color, fontWeight: 'bold', fontSize: 20 }}
              />
            </Card>
          </Col>
        )
      })}
    </Row>
  )

  const businessTab = (
    <div style={{ padding: '16px 0' }}>
      {renderStatCardsOneRow(businessCards)}

      <Row gutter={[24, 24]}>
        <Col span={24}>
          <Card
            title={<span style={{ fontSize: 16, fontWeight: 600 }}>销售额趋势图</span>}
            extra={
              <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                <Radio.Group
                  value={salesTrendRange}
                  onChange={(e) => setSalesTrendRange(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                  size="small"
                >
                  <Radio.Button value="month">本月</Radio.Button>
                  <Radio.Button value="3m">近3月</Radio.Button>
                  <Radio.Button value="6m">近半年</Radio.Button>
                  <Radio.Button value="year">全年</Radio.Button>
                </Radio.Group>
              </div>
            }
            variant="borderless"
            styles={{
              body: {
                borderRadius: '12px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
              }
            }}
          >
            <Mix {...businessTrendConfig} />
            <Modal
              open={trendDetailOpen}
              onCancel={() => setTrendDetailOpen(false)}
              footer={null}
              width={screens.md ? 980 : '92vw'}
              title={() => {
                const rows = Array.isArray(trendDetailRows) ? trendDetailRows : []
                const salesSum = rows.filter(r => !r.isPurchase).reduce((s, r) => s + Number(r.amount || 0), 0)
                const goodsPurchaseSum = rows.filter(r => r.isPurchase).reduce((s, r) => s + Number(r.amount || 0), 0)
                const total = salesSum + goodsPurchaseSum
                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>
                      {trendDetailMeta.label || trendDetailMeta.rawKey || '销售额明细'}
                    </div>
                    <div style={{ fontSize: 12, color: '#595959' }}>
                      销售单：¥{Number(salesSum || 0).toLocaleString()} 元，
                      商品采购：¥{Number(goodsPurchaseSum || 0).toLocaleString()} 元，
                      合计：¥{Number(total || 0).toLocaleString()} 元
                    </div>
                  </div>
                )
              }}
            >
              <Table
                size="small"
                rowKey="key"
                dataSource={trendDetailRows}
                pagination={{ pageSize: 20, showSizeChanger: true }}
                columns={[
                  { title: '来源', dataIndex: 'kind', width: 110 },
                  { title: '单号', dataIndex: 'orderNo', width: 160 },
                  {
                    title: '客户/供应商',
                    key: 'party',
                    width: 180,
                    render: (_, r) => r.isPurchase ? (r.supplierName || '-') : (r.customerName || '-')
                  },
                  { title: '品名', dataIndex: 'goodsName', ellipsis: true },
                  { title: '型号', dataIndex: 'materialNo', width: 140, ellipsis: true },
                  { title: '数量', dataIndex: 'quantity', width: 90 },
                  {
                    title: '售价',
                    dataIndex: 'salesUnitPrice',
                    width: 100,
                    render: (v) => Number(v || 0) ? Number(v || 0).toFixed(2) : '0.00'
                  },
                  {
                    title: '进价',
                    dataIndex: 'purchaseUnitPrice',
                    width: 100,
                    render: (v) => Number(v || 0) ? Number(v || 0).toFixed(2) : '0.00'
                  },
                  {
                    title: '金额',
                    dataIndex: 'amount',
                    width: 130,
                    render: (v) => `¥${Number(v || 0).toLocaleString()}`
                  },
                  { title: '时间', dataIndex: 'createdAtText', width: 160 },
                ]}
              />
            </Modal>
          </Card>
        </Col>
        <Col span={24}>
          <Card
            title={<span style={{ fontSize: 16, fontWeight: 600 }}>客户销售排行 (TOP 10)</span>}
            extra={
              <Radio.Group
                value={customerRankMode}
                onChange={(e) => setCustomerRankMode(e.target.value)}
                optionType="button"
                buttonStyle="solid"
                size="small"
              >
                <Radio.Button value="month">按月</Radio.Button>
                <Radio.Button value="quarter">按季度</Radio.Button>
                <Radio.Button value="year">按年</Radio.Button>
              </Radio.Group>
            }
            variant="borderless"
            styles={{
              body: {
                borderRadius: '12px',
                boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              },
            }}
          >
            <Column {...customerRankConfig} />
          </Card>
        </Col>
      </Row>
    </div>
  )

  const costTab = (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Radio.Group
            value={costRangeMode}
            onChange={(e) => setCostRangeMode(e.target.value)}
            optionType="button"
            buttonStyle="solid"
            size="small"
          >
            <Radio.Button value="lastMonth">上月数据</Radio.Button>
            <Radio.Button value="last3Months">近3月数据</Radio.Button>
            <Radio.Button value="last6Months">近6月数据</Radio.Button>
            <Radio.Button value="year">全年数据</Radio.Button>
          </Radio.Group>
          {costRangeMode === 'year' && (
            <Radio.Group
              value={costYear}
              onChange={(e) => setCostYear(e.target.value)}
              size="small"
            >
              {Array.from({ length: 5 }).map((_, idx) => {
                const y = dayjs().year() - idx
                return (
                  <Radio.Button key={y} value={y}>
                    {y}年
                  </Radio.Button>
                )
              })}
            </Radio.Group>
          )}
        </div>
      </div>
      {renderStatCards(costCards)}
      {renderStatCards(hrCards)}
      <Row gutter={16}>
        <Col span={12}>
          <Card title="成本结构">
            <Pie {...costStructureConfig} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="成本占比">
            <Column {...costShareConfig} />
          </Card>
        </Col>
      </Row>
    </div>
  )

  const financeTab = (
    <div>
      {renderStatCards(financeCards)}
      <Row gutter={16}>
        <Col span={12}>
          <Card title="收支结构">
            <Pie {...financeIncomeExpenseStructureConfig} />
          </Card>
        </Col>
        <Col span={12}>
          <Card title="说明">
            <div>本月：按{financeYear}年{financeMonth}月统计</div>
            <div>税额：本月开票金额×13% - 本月进项金额×13%</div>
            <div>毛利润：本月开票金额 - 本月进项金额 - 税额</div>
          </Card>
        </Col>
      </Row>
    </div>
  )

  const fixedCostColumns = [
    { title: '类别', dataIndex: 'category', key: 'category' },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      render: (v) => `¥${Number(v || 0).toLocaleString()}`
    },
    {
      title: '发生日期',
      dataIndex: 'date',
      key: 'date',
      render: (v) => (v ? dayjs(v).format('YYYY-MM-DD') : '-')
    },
    { title: '备注', dataIndex: 'remark', key: 'remark' },
    {
      title: '操作',
      key: 'actions',
      render: (_, record) => (
        <Button
          type="link"
          danger
          onClick={async () => {
            const id = record && (record.id || record._id)
            if (!id) {
              return
            }
            try {
              await fixedCostAPI.remove(id)
              setFixedCostItems((prev) => prev.filter((item) => item.id !== id && item._id !== id))
              message.success('删除固定成本成功')
            } catch (e) {
              message.error('删除固定成本失败')
            }
          }}
        >
          删除
        </Button>
      )
    }
  ]

  const majorExpenseTab = (
    <div>
      {renderStatCards(majorExpenseCards)}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Radio.Group
            value={fixedCostRangeMode}
            onChange={(e) => setFixedCostRangeMode(e.target.value)}
            optionType="button"
            buttonStyle="solid"
            size="small"
          >
            <Radio.Button value="lastMonth">上月数据</Radio.Button>
            <Radio.Button value="last3Months">近3月数据</Radio.Button>
            <Radio.Button value="last6Months">近6月数据</Radio.Button>
            <Radio.Button value="year">全年数据</Radio.Button>
          </Radio.Group>
          {fixedCostRangeMode === 'year' && (
            <Radio.Group
              value={fixedCostYear}
              onChange={(e) => setFixedCostYear(e.target.value)}
              size="small"
            >
              {Array.from({ length: 5 }).map((_, idx) => {
                const y = dayjs().year() - idx
                return (
                  <Radio.Button key={y} value={y}>
                    {y}年
                  </Radio.Button>
                )
              })}
            </Radio.Group>
          )}
        </div>
      </div>
      <Row gutter={16}>
        <Col span={24}>
          <Card title="固定成本构成">
            {hasFixedCostChartData ? (
              <Pie {...majorExpenseConfig} />
            ) : (
              <div
                style={{
                  height: 220,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#bfbfbf',
                  fontSize: 13
                }}
              >
                暂无固定成本数据
              </div>
            )}
          </Card>
        </Col>
      </Row>
      <Card
        title="固定成本明细"
        style={{ marginTop: 16 }}
        extra={
          <Space>
            <Button
              onClick={async () => {
                try {
                  const raw = window.localStorage.getItem('erp_fixedCostItems')
                  if (!raw) {
                    message.info('没有本地固定成本数据可导入')
                    return
                  }
                  let parsed = null
                  try {
                    parsed = JSON.parse(raw)
                  } catch (e) {
                    message.error('本地固定成本数据格式不正确')
                    return
                  }
                  const localItems = normalizeFixedCostItems(parsed)
                  if (!localItems.length) {
                    message.info('本地固定成本数据为空')
                    return
                  }
                  const existingKeys = new Set(
                    (fixedCostItems || []).map((item) => `${item.category}|${item.amount}|${item.date}`)
                  )
                  const toImport = localItems.filter(
                    (item) => !existingKeys.has(`${item.category}|${item.amount}|${item.date}`)
                  )
                  if (!toImport.length) {
                    message.info('本地固定成本数据已全部导入')
                    return
                  }
                  await Promise.all(
                    toImport.map((item) =>
                      fixedCostAPI.create({
                        category: item.category,
                        amount: item.amount,
                        date: item.date,
                        remark: item.remark
                      }).catch(() => null)
                    )
                  )
                  try {
                    const serverItems = await fixedCostAPI.list()
                    if (Array.isArray(serverItems)) {
                      setFixedCostItems(normalizeFixedCostItems(serverItems))
                    }
                  } catch (e) {
                    void e
                  }
                  message.success('本地固定成本数据导入完成')
                } catch (e) {
                  message.error('导入本地固定成本数据失败')
                }
              }}
            >
              导入本地固定成本
            </Button>
            <Button
              type="primary"
              onClick={() => {
                fixedCostForm.resetFields()
                setFixedCostModalOpen(true)
              }}
            >
              新增固定成本
            </Button>
          </Space>
        }
      >
        <Table
          size="small"
          rowKey="id"
          pagination={false}
          dataSource={filteredFixedCostItems}
          columns={fixedCostColumns}
        />
      </Card>
      <Modal
        title="新增固定成本"
        open={fixedCostModalOpen}
        onCancel={() => {
          setFixedCostModalOpen(false)
        }}
        onOk={() => {
          fixedCostForm
            .validateFields()
            .then(async (values) => {
              const amount = Number(values.amount || 0)
              if (!Number.isFinite(amount) || amount <= 0) {
                message.error('金额必须大于0')
                return
              }
              const category = String(values.category || '').trim() || '未分类'
              const ts = values.date ? values.date.valueOf() : Date.now()
              const payload = {
                category,
                amount,
                date: ts,
                remark: values.remark ? String(values.remark) : ''
              }
              try {
                const created = await fixedCostAPI.create(payload)
                const normalized = (() => {
                  if (!created) return null
                  const id = created.id || created._id || `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
                  const normCategory = String(created.category || category || '').trim() || '未分类'
                  const normAmount = Number(created.amount != null ? created.amount : amount)
                  const rawDate = created.date || created.createdAt || ts
                  let date = null
                  if (typeof rawDate === 'number') {
                    date = rawDate
                  } else if (rawDate) {
                    const d = dayjs(rawDate)
                    if (d.isValid()) {
                      date = d.valueOf()
                    }
                  }
                  const remark = created.remark != null ? String(created.remark) : (payload.remark || '')
                  if (!Number.isFinite(normAmount) || normAmount <= 0) return null
                  if (!Number.isFinite(date) || date <= 0) return null
                  return { id, category: normCategory, amount: normAmount, date, remark }
                })()
                if (normalized) {
                  setFixedCostItems((prev) => [...prev, normalized])
                }
                setFixedCostModalOpen(false)
                message.success('新增固定成本成功')
              } catch (e) {
                message.error('新增固定成本失败')
              }
            })
        }}
      >
        <Form form={fixedCostForm} layout="vertical">
          <Form.Item
            label="类别"
            name="category"
            rules={[{ required: true, message: '请输入类别' }]}
          >
            <Select
              placeholder="请选择固定成本类别"
              options={[
                { label: '房租', value: '房租' },
                { label: '购买设备', value: '购买设备' },
                { label: '水电费', value: '水电费' },
                { label: '设备维修', value: '设备维修' },
                { label: '加油费', value: '加油费' },
                { label: '加工费', value: '加工费' },
                { label: '宴请费用', value: '宴请费用' },
                { label: '杂费', value: '杂费' }
              ]}
              showSearch
              optionFilterProp="label"
              allowClear
            />
          </Form.Item>
          <Form.Item
            label="金额"
            name="amount"
            rules={[{ required: true, message: '请输入金额' }]}
          >
            <Input type="number" placeholder="单位：元" />
          </Form.Item>
          <Form.Item
            label="发生日期"
            name="date"
            rules={[{ required: true, message: '请选择日期' }]}
          >
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item label="备注" name="remark">
            <Input.TextArea rows={3} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )

  const overallTab = (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Radio.Group
            value={overallRangeMode}
            onChange={(e) => setOverallRangeMode(e.target.value)}
            optionType="button"
            buttonStyle="solid"
            size="small"
          >
            <Radio.Button value="lastMonth">上月数据</Radio.Button>
            <Radio.Button value="last3Months">近3月数据</Radio.Button>
            <Radio.Button value="last6Months">近6月数据</Radio.Button>
            <Radio.Button value="year">全年数据</Radio.Button>
            <Radio.Button value="rollingYear">年度数据</Radio.Button>
          </Radio.Group>
          {overallRangeMode === 'rollingYear' && (
            <Radio.Group
              value={overallYear}
              onChange={(e) => setOverallYear(e.target.value)}
              size="small"
            >
              {Array.from({ length: 5 }).map((_, idx) => {
                const y = dayjs().year() - idx
                return (
                  <Radio.Button key={y} value={y}>
                    {y}年
                  </Radio.Button>
                )
              })}
            </Radio.Group>
          )}
        </div>
      </div>
      {renderStatCardsOneRow(overallCards)}
      <Row gutter={16}>
        <Col span={14}>
          <Card title="利润构成">
            <Column {...overallProfitConfig} />
          </Card>
        </Col>
        <Col span={10}>
          <Card title="关键数据明细">
            <Table
              size="small"
              pagination={false}
              dataSource={overallProfitData.map((x, idx) => ({
                key: idx,
                ...x
              }))}
              columns={overallColumns}
            />
          </Card>
        </Col>
      </Row>
    </div>
  )

  const items = [
    { key: 'business', label: '经营数据', children: businessTab },
    { key: 'cost', label: '成本数据', children: costTab },
    { key: 'finance', label: '财务数据', children: financeTab },
    { key: 'majorExpense', label: '固定成本', children: majorExpenseTab },
    { key: 'overall', label: '经营总体数据', children: overallTab }
  ]

  return (
    <ConfigProvider locale={zhCN}>
      <div style={{ background: '#f5f7fa', minHeight: '100vh', padding: '24px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <h2 style={{ margin: 0, fontSize: 24, fontWeight: 600, color: '#262626' }}>业务分析中心</h2>
        </div>
        <Card variant="borderless" styles={{ body: { padding: '0 24px 24px 24px' } }} style={{ borderRadius: '12px', boxShadow: '0 1px 2px 0 rgba(0, 0, 0, 0.03)' }}>
          <Tabs
            activeKey={activeKey}
            onChange={handleTabChange}
            items={items}
            size="large"
            tabBarStyle={{ marginBottom: 24 }}
          />
        </Card>
      </div>
    </ConfigProvider>
  )
}

export default DataManagement
