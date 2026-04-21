import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Table, Card, Statistic, Row, Col, DatePicker, Button, Space, Tabs, Input, Select, Tag, ConfigProvider, Modal, App, InputNumber, Upload, Image, Tooltip } from 'antd'
import { useLocation } from 'react-router-dom'
import { DollarOutlined, ArrowUpOutlined, ArrowDownOutlined, UploadOutlined, LockOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import isSameOrAfter from 'dayjs/plugin/isSameOrAfter'
import isSameOrBefore from 'dayjs/plugin/isSameOrBefore'
import * as XLSX from 'xlsx'
import { orderAPI, purchaseAPI, customerAPI, supplierAPI, payableAPI, userConfigAPI, statementAPI, customerAliasAPI } from '../services/api'
import { cachedOrderAPI, cachedPurchaseAPI, cachedCustomerAPI } from '../services/cachedAPI'
import { useAuthStore } from '@/stores/authStore'
import { buildStatementParentChildKeyMap, expandStatementKeys } from '@/utils'
import { useLocalStorage } from '../hooks/useLocalStorage'
import zhCN from 'antd/locale/zh_CN'
import 'dayjs/locale/zh-cn'

dayjs.extend(isSameOrAfter)
dayjs.extend(isSameOrBefore)
dayjs.locale('zh-cn')

const { RangePicker } = DatePicker
const { Option } = Select

const boardCostEffectiveFromTs = dayjs('2026-01-11').startOf('day').valueOf()

const productionEfficiencyData = [
  {
    key: 'P202401',
    orderNo: 'P202401',
    customerName: '华润包装科技有限公司',
    productName: '三层瓦楞纸箱',
    quantity: 10000,
    stockedQty: 9500,
    orderAmount: 58000,
    productionCost: 42000,
    date: '2024-01-15'
  },
  {
    key: 'P202402',
    orderNo: 'P202402',
    customerName: '京东物流包装',
    productName: '加固快递盒',
    quantity: 8000,
    stockedQty: 7800,
    orderAmount: 46000,
    productionCost: 33500,
    date: '2024-01-20'
  },
  {
    key: 'P202403',
    orderNo: 'P202403',
    customerName: '字节跳动包装部',
    productName: '彩印展示盒',
    quantity: 5000,
    stockedQty: 4850,
    orderAmount: 52000,
    productionCost: 37800,
    date: '2024-01-25'
  }
]

const statementData = [
  {
    key: 'S202401',
    statementNo: 'S202401',
    type: 'customer',
    name: '华润包装科技有限公司',
    period: '2024-01-01 ~ 2024-01-31',
    receivable: 125000,
    received: 98000,
    difference: 27000,
    status: 'pending',
    date: '2024-02-01'
  },
  {
    key: 'S202402',
    statementNo: 'S202402',
    type: 'customer',
    name: '京东物流包装',
    period: '2024-01-01 ~ 2024-01-31',
    receivable: 86000,
    received: 86000,
    difference: 0,
    status: 'confirmed',
    date: '2024-02-03'
  },
  {
    key: 'S202403',
    statementNo: 'S202403',
    type: 'supplier',
    name: '玖龙纸业',
    period: '2024-01-01 ~ 2024-01-31',
    receivable: -54000,
    received: -36000,
    difference: -18000,
    status: 'pending',
    date: '2024-02-05'
  }
]

const receivableStatusMap = {
  pending: { text: '待收款', color: 'orange' },
  due: { text: '已到期', color: 'volcano' },
  paid: { text: '已付款', color: 'green' },
  partial: { text: '部分付款', color: 'blue' },
  overdue: { text: '已逾期', color: 'red' }
}

const payableStatusMap = {
  pending: { text: '待付款', color: 'orange' },
  partial: { text: '部分付款', color: 'blue' },
  paid: { text: '已付清', color: 'green' }
}

const statementStatusMap = {
  pending: { text: '待确认', color: 'orange' },
  confirmed: { text: '已确认', color: 'blue' },
  closed: { text: '已结清', color: 'green' }
}

function FinancialManagement() {
  const { message, modal } = App.useApp()
  const { isAuthenticated, user } = useAuthStore()
  const [activeTab, setActiveTab] = useState('production')
  const [dateRange, setDateRange] = useState()
  const [productionDateRange, setProductionDateRange] = useState()
  const [statementKeyword, setStatementKeyword] = useState('')
  const [receivableKeyword, setReceivableKeyword] = useState('')
  const [payableKeyword, setPayableKeyword] = useState('')
  const [receivableStatus, setReceivableStatus] = useState()
  const [payableStatus, setPayableStatus] = useState()
  const [productionData, setProductionData] = useState([])
  const [productionLoading, setProductionLoading] = useState(false)
  const [productionKeyword, setProductionKeyword] = useState('')
  const [productionRangePreset, setProductionRangePreset] = useState()
  const productionTableWrapRef = useRef(null)
  const [productionVisibleCount, setProductionVisibleCount] = useState(40)
  const [receivableData, setReceivableData] = useState([])
  const [payableData, setPayableData] = useState([])
  const [statementOrders, setStatementOrders] = useState([])
  const [statementLoading, setStatementLoading] = useState(false)
  const [statementPageSize, setStatementPageSize] = useState(20)
  const [statementCustomer, setStatementCustomer] = useState()
  const [statementReconcileMode, setStatementReconcileMode] = useState(false)
  const [statementSelectedRowKeys, setStatementSelectedRowKeys] = useLocalStorage('erp_financial_statement_selected_row_keys', [])
  const [statementReconcileLoading, setStatementReconcileLoading] = useState(false)
  const [statementPreviewVisible, setStatementPreviewVisible] = useState(false)
  const [statementPreviewRows, setStatementPreviewRows] = useState([])
  const [statementPreviewTemplate, setStatementPreviewTemplate] = useState('standard')
  const [savedStatements, setSavedStatements] = useState([])
  const [customerAliases, setCustomerAliases] = useState([])
  const [customerAliasModalOpen, setCustomerAliasModalOpen] = useState(false)
  const [customerAliasDraftAlias, setCustomerAliasDraftAlias] = useState('')
  const [customerAliasDraftCanonical, setCustomerAliasDraftCanonical] = useState('')
  const [customerAliasSuggestions, setCustomerAliasSuggestions] = useState([])
  const [statementEditRows, setStatementEditRows] = useState([])
  const [statementEditSelectedKeys, setStatementEditSelectedKeys] = useState([])
  const [statementEditDraftKey, setStatementEditDraftKey] = useState('')
  const [statementEditSaving, setStatementEditSaving] = useState(false)
  const [statementEditLocked, setStatementEditLocked] = useState(false)
  const [statementEditLockedByFinal, setStatementEditLockedByFinal] = useState(false)
  const [statementImportModalOpen, setStatementImportModalOpen] = useState(false)
  const [statementImportPreview, setStatementImportPreview] = useState(null)
  const [statementImportLoading, setStatementImportLoading] = useState(false)
  const [statementImportOverwriteExisting, setStatementImportOverwriteExisting] = useState(true)
  const [statementImportOverwriteStatementNo, setStatementImportOverwriteStatementNo] = useState('')
  const [receivableStatementDetailOpen, setReceivableStatementDetailOpen] = useState(false)
  const [receivableStatementDetailTitle, setReceivableStatementDetailTitle] = useState('')
  const [receivableStatementDetailRows, setReceivableStatementDetailRows] = useState([])
  const [receivableStatementDetailColumns, setReceivableStatementDetailColumns] = useState([])
  const [receivableStatementDetailTemplate, setReceivableStatementDetailTemplate] = useState('standard')
  const [receivableStatementDetailTotalAmount, setReceivableStatementDetailTotalAmount] = useState(0)
  const [receivableStatementDetailLayout, setReceivableStatementDetailLayout] = useState(null)
  const [allCustomers, setAllCustomers] = useState([])
  const [allSuppliers, setAllSuppliers] = useState([])
  const [materialPriceModalOpen, setMaterialPriceModalOpen] = useState(false)
  const [materialModalMaterialKey, setMaterialModalMaterialKey] = useState()
  const [materialModalPrice, setMaterialModalPrice] = useState('')
  const [manualMaterialPriceMap, setManualMaterialPriceMap] = useState({})
  const manualMaterialPriceRef = useRef({})
  const [productionMaterialPriceMode, setProductionMaterialPriceMode] = useState(false)
  const [productionSelectedRowKeys, setProductionSelectedRowKeys] = useLocalStorage('erp_financial_production_selected_row_keys', [])
  const [manualOrderMaterialPriceMap, setManualOrderMaterialPriceMap] = useState({})
  const manualOrderMaterialPriceRef = useRef({})
  const [receivableYear, setReceivableYear] = useState(dayjs().year())
  const [receivableMonth, setReceivableMonth] = useState(dayjs().month() + 1)
  const [payableYear, setPayableYear] = useState(dayjs().year())
  const [payableMonth, setPayableMonth] = useState(dayjs().month() + 1)
  const [receivablePaymentModalVisible, setReceivablePaymentModalVisible] = useState(false)
  const [receivablePaymentRecord, setReceivablePaymentRecord] = useState(null)
  const [receivablePaymentAmount, setReceivablePaymentAmount] = useState(null)
  const [receivablePaymentMode, setReceivablePaymentMode] = useState(false)
  const [receivableInvoiceMode, setReceivableInvoiceMode] = useState(false)
  const [receivableSelectedRowKeys, setReceivableSelectedRowKeys] = useLocalStorage('erp_financial_receivable_selected_row_keys', [])
  const [receivableVoidLoading, setReceivableVoidLoading] = useState(false)
  const [receivableRemarkModalOpen, setReceivableRemarkModalOpen] = useState(false)
  const [receivableRemarkRecord, setReceivableRemarkRecord] = useState(null)
  const [receivableRemarkText, setReceivableRemarkText] = useState('')
  const [receivableStatementOverrideMap, setReceivableStatementOverrideMap] = useState({})
  const [receivableEditModalOpen, setReceivableEditModalOpen] = useState(false)
  const [receivableEditRecord, setReceivableEditRecord] = useState(null)
  const [receivableEditDueDate, setReceivableEditDueDate] = useState(null)
  const [receivableEditInvoiceDate, setReceivableEditInvoiceDate] = useState(null)
  const [receivableEditPaymentDate, setReceivableEditPaymentDate] = useState(null)
  const [receivableEditAmountReceived, setReceivableEditAmountReceived] = useState(null)
  const [receivableEditRemark, setReceivableEditRemark] = useState('')

  const statementScrollRef = useRef(null)
  const statementSelectedRowsRef = useRef([])
  const location = useLocation()
  const allCustomersList = Array.isArray(allCustomers) ? allCustomers : []

  const userId = String(user?.id || '').trim()
  const getScopedStorageKey = (baseKey) => (userId ? `${baseKey}__${userId}` : baseKey)
  const receivablePaymentMapStorageKey = getScopedStorageKey('erp_receivablePaymentMap')
  const receivableStatementOverrideMapStorageKey = getScopedStorageKey('erp_receivableStatementOverrideMap')
  const statementPreviewTemplateStorageKey = getScopedStorageKey('erp_statementPreviewTemplate')

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(statementPreviewTemplateStorageKey)
      const v = String(raw || '').trim()
      if (v === 'standard' || v === 'deliveryDetail') {
        setStatementPreviewTemplate(v)
      }
    } catch (e) {
      void e
    }
  }, [statementPreviewTemplateStorageKey])

  useEffect(() => {
    try {
      window.localStorage.setItem(statementPreviewTemplateStorageKey, String(statementPreviewTemplate || 'standard'))
    } catch (e) {
      void e
    }
  }, [statementPreviewTemplate, statementPreviewTemplateStorageKey])

  const hashString = (input) => {
    const s = String(input || '')
    let h = 2166136261
    for (let i = 0; i < s.length; i += 1) {
      h ^= s.charCodeAt(i)
      h = Math.imul(h, 16777619)
    }
    return (h >>> 0).toString(36)
  }

  const normalizeStatementDoc = (input) => {
    const raw = Array.isArray(input) ? (input[0] || null) : input
    if (!raw || typeof raw !== 'object') return null
    if (raw.data && typeof raw.data === 'object') return raw.data
    return raw
  }

  const requireStatementApiSuccess = (resp, fallbackMessage) => {
    const payload = resp?.data ?? resp
    if (payload && typeof payload === 'object') {
      if (payload.success === false) {
        const serverMessage = typeof payload.message === 'string' ? String(payload.message || '').trim() : ''
        const serverError = typeof payload.error === 'string' ? String(payload.error || '').trim() : ''
        const base = serverMessage || String(fallbackMessage || '操作失败')
        const msg = serverError && serverError !== base ? `${base}：${serverError}` : base
        throw new Error(msg)
      }
    }
    return payload
  }

  const pickLatestStatementByNo = (list, statementNo) => {
    const sn = String(statementNo || '').trim()
    if (!sn) return null
    const src = Array.isArray(list) ? list : []
    let best = null
    let bestTs = -1
    for (let i = 0; i < src.length; i += 1) {
      const s = normalizeStatementDoc(src[i])
      if (!s) continue
      if (String(s?.statementNo || '').trim() !== sn) continue
      const ts = Number(s?.updatedAt ?? s?.meta?.updatedAt ?? 0)
      const used = Number.isFinite(ts) ? ts : 0
      if (!best || used >= bestTs) {
        best = s
        bestTs = used
      }
    }
    return best
  }

  const normalizeStatementRow = (r) => {
    const row = r && typeof r === 'object' ? r : {}
    const key = String(row.key || row._key || '').trim() || `line_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const shipDate = String(row.shipDate || row.ship_date || '').trim()
    const productName = String(row.productName || row.product_name || '').trim()
    const spec = String(row.spec || row.specText || '').trim()
    const quantityRaw = row.quantity ?? row.qty ?? row.deliveryQty ?? ''
    const unitPriceRaw = row.unitPrice ?? row.price ?? ''
    const quantity = quantityRaw === '' ? '' : Number(quantityRaw)
    const unitPrice = unitPriceRaw === '' ? '' : Number(unitPriceRaw)
    const unit = String(row.unit || row.unitText || '').trim()
    const remark = String(row.remark || row.note || '').trim()
    const amountRaw = row.amount ?? ''
    const amount = amountRaw === '' ? '' : Number(amountRaw)
    return {
      ...row,
      key,
      shipDate,
      productName,
      spec,
      quantity: Number.isFinite(quantity) ? quantity : (quantityRaw === '' ? '' : 0),
      unit: unit || '只',
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : (unitPriceRaw === '' ? '' : 0),
      amount: Number.isFinite(amount) ? amount : '',
      remark
    }
  }

  const calcRowAmount = (row) => {
    const qty = Number(row?.quantity || 0)
    const price = Number(row?.unitPrice || 0)
    if (!Number.isFinite(qty) || !Number.isFinite(price)) return 0
    return Number((qty * price).toFixed(2))
  }

  const withCalculatedStatementAmounts = (rows) => {
    const list = Array.isArray(rows) ? rows : []
    return list.map((r) => {
      const row = r && typeof r === 'object' ? r : {}
      const existingAmount = Number(row?.amount)
      const hasExistingAmount = row?.amount !== '' && row?.amount != null && Number.isFinite(existingAmount)
      const amount = hasExistingAmount ? existingAmount : calcRowAmount(row)
      return { ...row, amount }
    })
  }

  const renderSheetLayoutTable = (layout) => {
    const aoa = Array.isArray(layout?.aoa) ? layout.aoa : []
    if (!aoa.length) return null
    const rowCount = aoa.length
    const colCount = Math.max(1, ...aoa.map((r) => (Array.isArray(r) ? r.length : 0)))
    const merges = Array.isArray(layout?.merges) ? layout.merges : []

    const spanMap = new Map()
    const hidden = new Set()

    const keyOf = (r, c) => `${r},${c}`
    merges.forEach((m) => {
      const s = m?.s
      const e = m?.e
      const r0 = Number(s?.r)
      const c0 = Number(s?.c)
      const r1 = Number(e?.r)
      const c1 = Number(e?.c)
      if (![r0, c0, r1, c1].every(Number.isFinite)) return
      if (r0 < 0 || c0 < 0 || r1 < r0 || c1 < c0) return
      if (r0 >= rowCount || c0 >= colCount) return
      const rs = Math.min(r1, rowCount - 1)
      const cs = Math.min(c1, colCount - 1)
      spanMap.set(keyOf(r0, c0), { rowSpan: rs - r0 + 1, colSpan: cs - c0 + 1 })
      for (let rr = r0; rr <= rs; rr += 1) {
        for (let cc = c0; cc <= cs; cc += 1) {
          if (rr === r0 && cc === c0) continue
          hidden.add(keyOf(rr, cc))
        }
      }
    })

    const formatCell = (v) => {
      if (v == null) return ''
      if (typeof v === 'string') return v
      if (typeof v === 'number' && Number.isFinite(v)) return String(v)
      if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
      return String(v)
    }

    return (
      <div style={{ overflow: 'auto', maxHeight: 520, border: '1px solid #e5e7eb', borderRadius: 6 }}>
        <table style={{ borderCollapse: 'collapse', width: '100%', background: '#fff' }}>
          <tbody>
            {Array.from({ length: rowCount }).map((_, r) => (
              <tr key={`r_${r}`}>
                {Array.from({ length: colCount }).map((__, c) => {
                  const k = keyOf(r, c)
                  if (hidden.has(k)) return null
                  const span = spanMap.get(k) || null
                  const row = Array.isArray(aoa[r]) ? aoa[r] : []
                  const value = c < row.length ? row[c] : ''
                  return (
                    <td
                      key={`c_${r}_${c}`}
                      rowSpan={span ? span.rowSpan : 1}
                      colSpan={span ? span.colSpan : 1}
                      style={{
                        border: '1px solid #d1d5db',
                        padding: '4px 6px',
                        fontSize: 12,
                        color: '#111827',
                        whiteSpace: 'pre-wrap',
                        verticalAlign: 'middle'
                      }}
                    >
                      {formatCell(value)}
                    </td>
                  )
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  const extractDeliveryDetailRowsFromRawSheet = (rawSheet) => {
    const lines = Array.isArray(rawSheet?.aoa) ? rawSheet.aoa : []
    const normalizeHeader = (v) => String(v ?? '')
      .replace(/\s+/g, '')
      .replace(/[()（）]/g, (m) => (m === '(' || m === ')' ? m : (m === '（' ? '(' : ')')))
      .trim()
    const flat = (r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : [])
    const headerRowIndex = lines.findIndex((r) => {
      const row = flat(r).map(normalizeHeader)
      const hasNameSpec = row.some((c) => c.includes('品名') && c.includes('规格')) || row.includes('品名规格') || row.includes('品名/规格')
      const hasAmountIncl = row.some((c) => c.includes('金额') && c.includes('含税'))
      return hasNameSpec && hasAmountIncl
    })
    if (headerRowIndex < 0) return []
    const header = flat(lines[headerRowIndex] || []).map(normalizeHeader)
    const nameSpecIdx = (() => {
      const idx = header.findIndex((h) => h === '品名规格' || h === '品名/规格' || (h.includes('品名') && h.includes('规格')))
      return idx >= 0 ? idx : 1
    })()
    const amountInclIdx = header.findIndex((h) => String(h || '').includes('金额') && String(h || '').includes('含税'))
    if (amountInclIdx < 0) return []

    const out = []
    for (let i = headerRowIndex + 1; i < lines.length; i += 1) {
      const row = Array.isArray(lines[i]) ? lines[i] : []
      const rowCells = flat(row)
      const isAllEmpty = rowCells.every((v) => !String(v ?? '').trim())
      if (isAllEmpty) break
      const seq = rowCells[0]
      const maybeSummary = String(seq || '').includes('合计') || rowCells.some((c) => String(c || '').includes('合计'))
      if (maybeSummary) continue
      const nameSpec = rowCells[nameSpecIdx] || ''
      const n = Number(row[amountInclIdx])
      out.push({
        key: `dd_${i}`,
        seq,
        nameSpec,
        amountIncl: Number.isFinite(n) ? Number(n) : ''
      })
    }
    return out
  }

  const fetchLatestStatementDocByStatementNo = async (statementNo) => {
    const sn = String(statementNo || '').trim()
    if (!sn) return null
    try {
      const resp = await statementAPI.getStatements({ key: sn })
      const payload = resp?.data ?? resp
      if (!payload || typeof payload !== 'object') return null
      if (payload.success === false) return null
      const doc =
        payload?.data?.statement ??
        payload?.statement ??
        payload?.data?.data?.statement ??
        null
      const normalized = normalizeStatementDoc(doc)
      if (!normalized || typeof normalized !== 'object') return null
      return normalized
    } catch (_) {
      return null
    }
  }

  const validateStatementEditRows = (rows) => {
    const list = Array.isArray(rows) ? rows : []
    if (!list.length) return { ok: false, message: '对账单明细不能为空' }
    for (let i = 0; i < list.length; i += 1) {
      const r = list[i]
      const idx = i + 1
      const ship = String(r?.shipDate || '').trim()
      if (!ship || !dayjs(ship).isValid()) return { ok: false, message: `第${idx}行送货日期不合法` }
      const name = String(r?.productName || '').trim()
      if (!name) return { ok: false, message: `第${idx}行商品名称不能为空` }
      const spec = String(r?.spec || '').trim()
      if (!spec || !/\d/.test(spec)) return { ok: false, message: `第${idx}行尺寸规格不合法` }
      const amountVal = Number(r?.amount)
      const hasAmount = r?.amount !== '' && r?.amount != null
      if (hasAmount) {
        if (!Number.isFinite(amountVal) || amountVal < 0) return { ok: false, message: `第${idx}行金额不合法` }
        const qtyMaybe = r?.quantity
        if (qtyMaybe !== '' && qtyMaybe != null) {
          const qty = Number(qtyMaybe)
          if (!Number.isFinite(qty) || qty <= 0) return { ok: false, message: `第${idx}行送货数量不合法` }
          const unit = String(r?.unit || '').trim()
          if (!unit) return { ok: false, message: `第${idx}行单位不能为空` }
        }
        const priceMaybe = r?.unitPrice
        if (priceMaybe !== '' && priceMaybe != null) {
          const price = Number(priceMaybe)
          if (!Number.isFinite(price) || price < 0) return { ok: false, message: `第${idx}行单价不合法` }
        }
        continue
      }

      const qty = Number(r?.quantity)
      if (!Number.isFinite(qty) || qty <= 0) return { ok: false, message: `第${idx}行送货数量不合法` }
      const unit = String(r?.unit || '').trim()
      if (!unit) return { ok: false, message: `第${idx}行单位不能为空` }
      const price = Number(r?.unitPrice)
      if (!Number.isFinite(price) || price < 0) return { ok: false, message: `第${idx}行单价不合法` }
    }
    return { ok: true, message: '' }
  }

  const statementDraftPrefix = getScopedStorageKey('erp_statementDraft')

  const getDraftStorageKey = (draftKey) => `${statementDraftPrefix}__${String(draftKey || '').trim()}`

  const saveStatementDraft = (draftKey, rows, extra = {}) => {
    const key = getDraftStorageKey(draftKey)
    const payload = {
      key: draftKey,
      updatedAt: Date.now(),
      rows: Array.isArray(rows) ? rows : [],
      extra: extra && typeof extra === 'object' ? extra : {}
    }
    try {
      window.localStorage.setItem(key, JSON.stringify(payload))
    } catch (_) { void 0 }
  }

  const loadStatementDraft = (draftKey) => {
    const key = getDraftStorageKey(draftKey)
    try {
      const raw = window.localStorage.getItem(key)
      if (!raw) return null
      const parsed = JSON.parse(raw)
      if (!parsed || typeof parsed !== 'object') return null
      return parsed
    } catch (_) {
      return null
    }
  }

  useEffect(() => {
    if (!statementPreviewVisible) return
    if (statementPreviewTemplate !== 'standard') return
    const baseRows = Array.isArray(statementPreviewRows) ? statementPreviewRows : []
    const existingStatementNo = String(baseRows[0]?.statementNo || '').trim()
    const orderIds = baseRows.map((r) => String(r?.orderId || '').trim()).filter(Boolean)
    const draftKey = existingStatementNo ? `statementNo:${existingStatementNo}` : `orders:${hashString(orderIds.join('|'))}`
    setStatementEditDraftKey(draftKey)
    setStatementEditSelectedKeys([])

    const storedDoc =
      existingStatementNo
        ? pickLatestStatementByNo(savedStatements, existingStatementNo)
        : null
    const storedRows = storedDoc && Array.isArray(storedDoc?.rows) ? storedDoc.rows : null
    const lockedByFinal = Boolean(storedDoc?.final)
    const locked = Boolean(existingStatementNo) || lockedByFinal
    setStatementEditLocked(locked)
    setStatementEditLockedByFinal(lockedByFinal)

    const draft = loadStatementDraft(draftKey)
    const draftRows = draft && Array.isArray(draft?.rows) ? draft.rows : null
    const used =
      locked
        ? (storedRows && storedRows.length ? storedRows : baseRows)
        : (draftRows && draftRows.length ? draftRows : (storedRows && storedRows.length ? storedRows : baseRows))
    const normalized = Array.isArray(used) ? used.map((r) => normalizeStatementRow(r)) : []
    setStatementEditRows(normalized)
  }, [statementPreviewVisible, statementPreviewTemplate, statementPreviewRows, savedStatements])

  useEffect(() => {
    if (!statementPreviewVisible) return
    if (statementPreviewTemplate !== 'standard') return
    if (!statementEditDraftKey) return
    if (statementEditLocked) return
    const t = setTimeout(() => {
      const baseRows = Array.isArray(statementPreviewRows) ? statementPreviewRows : []
      const customerName =
        (baseRows.length ? String(baseRows[0]?.customerName || '').trim() : '') ||
        ''
      saveStatementDraft(statementEditDraftKey, statementEditRows, {
        customerName,
        statementNo: String(baseRows?.[0]?.statementNo || '').trim() || '',
        orderIds: baseRows.map((r) => r?.orderId).filter(Boolean)
      })
    }, 800)
    return () => clearTimeout(t)
  }, [statementEditRows, statementEditDraftKey, statementPreviewVisible, statementPreviewTemplate, statementPreviewRows, statementEditLocked])

  const readFileAsArrayBuffer = (file) => new Promise((resolve, reject) => {
    try {
      const reader = new FileReader()
      reader.onload = () => resolve(reader.result)
      reader.onerror = () => reject(reader.error || new Error('读取文件失败'))
      reader.readAsArrayBuffer(file)
    } catch (e) {
      reject(e)
    }
  })

  const excelSerialToDateString = (n) => {
    const num = Number(n)
    if (!Number.isFinite(num) || num <= 0) return ''
    const utcDays = Math.floor(num - 25569)
    const utcValue = utcDays * 86400
    const dateInfo = new Date(utcValue * 1000)
    if (!dateInfo || Number.isNaN(dateInfo.getTime())) return ''
    const y = dateInfo.getUTCFullYear()
    const m = String(dateInfo.getUTCMonth() + 1).padStart(2, '0')
    const d = String(dateInfo.getUTCDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }

  const parseImportedStatement = async (file) => {
    const stripExt = (name) => String(name || '').replace(/\.[^.]+$/, '')
    const parseStatementFilename = (name) => {
      const base = stripExt(name).trim()
      const m1 = base.match(/^(.+?)\s*对账单(?:[（(]\d+[）)])?$/)
      if (m1 && String(m1[1] || '').trim()) {
        return { ok: true, format: 'customerStatement', source: 'filename', customer: String(m1[1]).trim(), period: '' }
      }
      const m1b = base.match(/^(.+?)-(\d{4})年(\d{1,2})月份对账单$/)
      if (m1b) {
        const customer = String(m1b[1] || '').trim()
        const year = Number(m1b[2])
        const month = Number(m1b[3])
        if (customer && year >= 2000 && month >= 1 && month <= 12) {
          return {
            ok: true,
            format: 'customerStatement',
            source: 'filename',
            customer,
            period: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
          }
        }
      }
      const m2 = base.match(/^(\d{4})年(\d{1,2})月送货明细[（(](.+?)[）)](?:[（(]\d+[）)])?$/)
      if (m2) {
        const year = Number(m2[1])
        const month = Number(m2[2])
        const customer = String(m2[3] || '').trim()
        if (year >= 2000 && month >= 1 && month <= 12 && customer) {
          return {
            ok: true,
            format: 'deliveryDetail',
            source: 'filename',
            customer,
            period: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
          }
        }
      }
      const m2b = base.match(/^(.+?)-(\d{6})-送货明细$/)
      if (m2b) {
        const customer = String(m2b[1] || '').trim()
        const ym = String(m2b[2] || '').trim()
        const year = Number(ym.slice(0, 4))
        const month = Number(ym.slice(4, 6))
        if (customer && year >= 2000 && month >= 1 && month <= 12) {
          return {
            ok: true,
            format: 'deliveryDetail',
            source: 'filename',
            customer,
            period: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
          }
        }
      }
      const m3 = base.match(/^纸板订购单(\d{4})-(.+?)-(\d{8,14})$/)
      if (m3) {
        const year = Number(m3[1])
        const customer = String(m3[2] || '').trim()
        const ts = String(m3[3] || '').trim()
        const ym = ts.length >= 6 ? ts.slice(0, 6) : ''
        const month = Number(ym.slice(4, 6))
        if (customer && year >= 2000 && month >= 1 && month <= 12) {
          return {
            ok: true,
            format: 'unknown',
            source: 'filename',
            customer,
            period: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
          }
        }
      }
      return {
        ok: false,
        message: `文件名不符合规范：需为“[客户全称]对账单”或“[年份][月份]送货明细（[客户全称]）”。当前文件名：${base}`
      }
    }

    const defaultPeriod = `${String(receivableYear).padStart(4, '0')}-${String(receivableMonth).padStart(2, '0')}`
    const buffer = await readFileAsArrayBuffer(file)
    const wb = XLSX.read(buffer, { type: 'array', cellDates: false })
    const ws = wb.Sheets[wb.SheetNames[0]]
    const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: '' })
    const lines = Array.isArray(aoa) ? aoa : []
    const flat = (r) => (Array.isArray(r) ? r.map((c) => String(c ?? '').trim()) : [])
    const sheetName = String(wb.SheetNames[0] || '').trim() || 'Sheet1'
    const merges = Array.isArray(ws?.['!merges']) ? ws['!merges'] : []

    const isEmptyCell = (v) => v == null || v === '' || (typeof v === 'string' && v.trim() === '')
    const trimAoa = (data) => {
      const src = Array.isArray(data) ? data : []
      let lastRow = -1
      let lastCol = -1
      for (let r = 0; r < src.length; r += 1) {
        const row = Array.isArray(src[r]) ? src[r] : []
        let rowHas = false
        for (let c = 0; c < row.length; c += 1) {
          if (!isEmptyCell(row[c])) {
            rowHas = true
            if (c > lastCol) lastCol = c
          }
        }
        if (rowHas) lastRow = r
      }
      if (lastRow < 0 || lastCol < 0) return []
      const trimmed = src.slice(0, lastRow + 1).map((r) => {
        const row = Array.isArray(r) ? r : []
        return row.slice(0, lastCol + 1)
      })
      return trimmed
    }

    const rawAoa = trimAoa(lines)
    const maxCells = 60000
    const rawRows = rawAoa.length
    const rawCols = rawRows ? Math.max(...rawAoa.map((r) => (Array.isArray(r) ? r.length : 0))) : 0
    const rawCellCount = rawRows * rawCols
    const rawTruncated = rawCellCount > maxCells
    const raw = {
      sheetName,
      aoa: rawTruncated ? rawAoa.slice(0, Math.max(1, Math.floor(maxCells / Math.max(1, rawCols)))) : rawAoa,
      merges
    }

    const titleRow = flat(lines[0] || [])
    const title = titleRow[0] || ''
    const parseStatementTitle = (inputTitle) => {
      const t = String(inputTitle || '').trim()
      const m1t = t.match(/^(.+?)对账单$/)
      if (m1t && String(m1t[1] || '').trim()) {
        return { ok: true, format: 'customerStatement', source: 'title', customer: String(m1t[1]).trim(), period: '' }
      }
      const m2t = t.match(/^(\d{4})年(\d{1,2})月送货明细[（(](.+?)[）)]$/)
      if (m2t) {
        const year = Number(m2t[1])
        const month = Number(m2t[2])
        const customer = String(m2t[3] || '').trim()
        if (year >= 2000 && month >= 1 && month <= 12 && customer) {
          return {
            ok: true,
            format: 'deliveryDetail',
            source: 'title',
            customer,
            period: `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}`
          }
        }
      }
      return { ok: false }
    }

    const filenameInfo = parseStatementFilename(file?.name || '')
    const titleInfo = parseStatementTitle(title)
    const preferTitle = Boolean(titleInfo?.ok) && String(filenameInfo?.format || '') === 'unknown'
    const nameInfo = titleInfo.ok
      ? (preferTitle ? titleInfo : (String(filenameInfo?.format || '') === 'customerStatement' || String(filenameInfo?.format || '') === 'deliveryDetail') ? filenameInfo : titleInfo)
      : (filenameInfo.ok ? filenameInfo : null)
    if (!nameInfo) {
      const usedTitle = String(title || '').trim()
      const hint = usedTitle ? `表格标题：${usedTitle}` : '表格标题为空'
      throw new Error(`${filenameInfo.message || '文件名不符合规范'}；${hint}`)
    }
    const titleMatch = String(title || '').match(/(\d{4})年(\d{1,2})月/)
    const titleYear = titleMatch ? Number(titleMatch[1]) : NaN
    const titleMonth = titleMatch ? Number(titleMatch[2]) : NaN
    const titlePeriod = Number.isFinite(titleYear) && Number.isFinite(titleMonth)
      ? `${String(titleYear).padStart(4, '0')}-${String(titleMonth).padStart(2, '0')}`
      : ''

    let customer = String(nameInfo.customer || '').trim()
    if (!customer) throw new Error('未识别到客户全称')
    try {
      const cm = {}
      ;(allCustomersList || []).forEach((c) => {
        if (c?._id) cm[c._id] = c
        const nameKey = String(c?.companyName || c?.name || '').trim()
        if (nameKey) cm[nameKey] = c
        if (c?.name) cm[String(c.name).trim()] = c
        if (c?.shortName) cm[String(c.shortName).trim()] = c
      })
      const resolved = resolveCanonicalCustomerName(customer, allCustomersList, cm, customerAliases)
      if (resolved?.canonical) customer = resolved.canonical
    } catch (_) { void 0 }

    const findExistingStatementNo = (usedCustomer, usedPeriod) => {
      try {
        const c = String(usedCustomer || '').trim()
        const p = String(usedPeriod || '').trim()
        if (!c || !/^\d{4}-\d{2}$/.test(p)) return ''
        const ym = p.replace('-', '')
        const prefix = `QXDZD${ym}`
        const list = Array.isArray(receivableData) ? receivableData : []
        const hits = list.filter((r) => {
          const sn = String(r?.statementNo || '').trim()
          if (!sn) return false
          const cust = String(r?.customerName || '').trim()
          if (scoreNameMatch(cust, c) < 0.85) return false
          const docPeriod = String(r?._statementDoc?.period || '').trim()
          if (docPeriod && /^\d{4}-\d{2}$/.test(docPeriod)) return docPeriod === p
          if (sn.startsWith(prefix)) return true
          const m = sn.match(/^QXDZD(\d{4})(\d{2})/)
          if (m) return `${m[1]}-${m[2]}` === p
          return false
        })
        if (!hits.length) return ''
        hits.sort((a, b) => {
          const ta = a?.date ? dayjs(a.date).valueOf() : 0
          const tb = b?.date ? dayjs(b.date).valueOf() : 0
          return tb - ta
        })
        return String(hits[0]?.statementNo || '').trim()
      } catch (_) {
        return ''
      }
    }

    const inferredPeriodFromExisting = (() => {
      try {
        const list = Array.isArray(receivableData) ? receivableData : []
        const hits = list
          .filter((r) => scoreNameMatch(String(r?.customerName || ''), customer) >= 0.92)
          .sort((a, b) => {
            const ta = a?.date ? dayjs(a.date).valueOf() : 0
            const tb = b?.date ? dayjs(b.date).valueOf() : 0
            return tb - ta
          })
        const best = hits[0]
        if (!best) return ''
        const docPeriod = String(best?._statementDoc?.period || '').trim()
        if (/^\d{4}-\d{2}$/.test(docPeriod)) return docPeriod
        const sn = String(best?.statementNo || '').trim()
        const m = sn.match(/^QXDZD(\d{4})(\d{2})/)
        if (m) return `${m[1]}-${m[2]}`
        return ''
      } catch (_) { return '' }
    })()

    const hasExplicitPeriod = Boolean(String(nameInfo.period || '').trim() || titlePeriod)
    let period = String(nameInfo.period || titlePeriod || inferredPeriodFromExisting || defaultPeriod || '').trim()
    if (!/^\d{4}-\d{2}$/.test(period)) throw new Error('未识别到对账期间（请检查文件名或对账单标题）')

    const normalizeHeader = (v) => String(v ?? '')
      .replace(/\s+/g, '')
      .replace(/[()（）]/g, (m) => (m === '(' || m === ')' ? m : (m === '（' ? '(' : ')')))
      .trim()

    const findDeliveryHeaderRowIndex = () => lines.findIndex((r) => {
      const row = flat(r).map(normalizeHeader)
      const hasNameSpec = row.some((c) => c.includes('品名') && c.includes('规格')) || row.includes('品名规格') || row.includes('品名/规格')
      const hasAmountIncl = row.some((c) => {
        const s = String(c || '')
        return s.includes('价税合计') || (s.includes('金额') && s.includes('含税') && !s.includes('不含税') && !s.includes('未税'))
      })
      return hasNameSpec && hasAmountIncl
    })

    const deliveryHeaderRowIndex = findDeliveryHeaderRowIndex()
    const contentTemplate = deliveryHeaderRowIndex >= 0 ? 'deliveryDetail' : 'standard'

    if (contentTemplate === 'deliveryDetail') {
      const headerRowIndex = lines.findIndex((r) => {
        const row = flat(r).map(normalizeHeader)
        const hasNameSpec = row.some((c) => c.includes('品名') && c.includes('规格')) || row.includes('品名规格') || row.includes('品名/规格')
        const hasAmountIncl = row.some((c) => {
          const s = String(c || '')
          return s.includes('价税合计') || (s.includes('金额') && s.includes('含税') && !s.includes('不含税') && !s.includes('未税'))
        })
        return hasNameSpec && hasAmountIncl
      })
      if (headerRowIndex < 0) throw new Error('未识别到送货明细表头（请确认导出格式一致）')

      const header = flat(lines[headerRowIndex] || []).map(normalizeHeader)
      const nameSpecIdx = (() => {
        const idx = header.findIndex((h) => h === '品名规格' || h === '品名/规格' || (String(h || '').includes('品名') && String(h || '').includes('规格')))
        return idx >= 0 ? idx : 1
      })()
      const parseCellNumber = (v) => {
        if (v == null) return NaN
        if (typeof v === 'number') return v
        const rawText = String(v ?? '').trim()
        if (!rawText) return NaN
        const cleaned = rawText
          .replace(/[￥¥]/g, '')
          .replace(/,/g, '')
          .replace(/\s+/g, '')
        const m = cleaned.match(/-?\d+(?:\.\d+)?/)
        if (!m) return NaN
        return Number(m[0])
      }
      const amountInclIdx = header.findIndex((h) => {
        const s = String(h || '')
        return s.includes('价税合计') || (s.includes('金额') && s.includes('含税') && !s.includes('不含税') && !s.includes('未税'))
      })
      const amountExclIdx = header.findIndex((h) => {
        const s = String(h || '')
        return s.includes('金额') && (s.includes('不含税') || s.includes('未税'))
      })
      const taxIdx = header.findIndex((h) => {
        const s = String(h || '')
        return s.includes('增值税') || s.includes('税额')
      })
      if (amountInclIdx < 0 && !(amountExclIdx >= 0 && taxIdx >= 0)) throw new Error('未识别到“金额（含税）”列')

      let amountIncl = 0
      const detailRows = []
      const importErrors = rawTruncated ? [{ row: 0, message: '原始表格过大，已截断存储（不影响应收金额与视图展示的基础数据）' }] : []
      if (titleInfo.ok && filenameInfo.ok && String(titleInfo.customer || '').trim() && String(filenameInfo.customer || '').trim() && String(titleInfo.customer || '').trim() !== String(filenameInfo.customer || '').trim()) {
        importErrors.push({ row: 0, message: `检测到文件名客户与表格标题客户不一致，已以表格标题为准：${String(titleInfo.customer || '').trim()}` })
      }
      for (let i = headerRowIndex + 1; i < lines.length; i += 1) {
        const row = Array.isArray(lines[i]) ? lines[i] : []
        const first = String(row[0] ?? '').trim()
        if (!first && row.every((v) => String(v ?? '').trim() === '')) break
        const maybeSummary = String(first || '').includes('合计') || row.some((c) => String(c || '').includes('合计'))
        const nIncl = amountInclIdx >= 0 ? parseCellNumber(row[amountInclIdx]) : NaN
        const nExcl = amountExclIdx >= 0 ? parseCellNumber(row[amountExclIdx]) : NaN
        const nTax = taxIdx >= 0 ? parseCellNumber(row[taxIdx]) : NaN
        const used = Number.isFinite(nIncl) ? nIncl : (Number.isFinite(nExcl) && Number.isFinite(nTax)) ? (nExcl + nTax) : NaN
        if (Number.isFinite(used)) {
          if (maybeSummary) amountIncl = used
          else amountIncl += used
        }
        if (!maybeSummary) {
          detailRows.push({
            key: `dd_${i}`,
            seq: row[0],
            nameSpec: row[nameSpecIdx] || '',
            amountIncl: Number.isFinite(used) ? used : ''
          })
        }
      }

      const previewRows = detailRows.slice(0, 50)
      const totalAmount = Number(amountIncl.toFixed(2))
      if (!(totalAmount > 0)) throw new Error('未识别到送货明细合计金额（含税）')

      const mappedCustomer = (() => {
        const c = String(customer || '').trim()
        if (!c) return c
        if (c === '太仓诚亮包装有限公司' || c.includes('太仓诚亮')) return '昆山广振汽车部件有限公司'
        return c
      })()
      if (mappedCustomer && mappedCustomer !== customer) {
        customer = mappedCustomer
        importErrors.push({ row: 0, message: `送货明细模板客户已映射为：${mappedCustomer}` })
      }

      const hash = hashString(`${customer}|${period}`).slice(0, 6).toUpperCase()
      const ym = period.replace('-', '')
      const existingStatementNo = findExistingStatementNo(customer, period)
      const computedStatementNo = `QXDZD${ym}${hash}`
      if (existingStatementNo) {
        importErrors.push({ row: 0, message: `检测到该客户该期间已有对账单号：${existingStatementNo}，可选择覆盖该对账单号以替换原明细` })
      }
      return {
        template: 'deliveryDetail',
        format: nameInfo.format || '',
        nameSource: nameInfo.source || '',
        customer,
        period,
        statementNo: computedStatementNo,
        existingStatementNo: existingStatementNo || '',
        paymentTerm: '',
        rows: detailRows,
        previewRows,
        totalAmount,
        title: String(title || '').trim(),
        filename: String(file?.name || ''),
        raw,
        rawTruncated,
        importErrors
      }
    }

    let customerFromSheet = ''
    let paymentTerm = ''
    const sheetWarnings = []
    for (let i = 0; i < Math.min(lines.length, 12); i += 1) {
      const row = flat(lines[i])
      const first = row[0] || ''
      if (!customerFromSheet && first.includes('采购单位')) {
        customerFromSheet = first.split('采购单位：')[1] || first.split('采购单位:')[1] || ''
        customerFromSheet = String(customerFromSheet || '').trim()
      }
      if (!paymentTerm && first.includes('结款方式')) {
        paymentTerm = first.split('结款方式：')[1] || first.split('结款方式:')[1] || ''
        paymentTerm = String(paymentTerm || '').trim()
      }
    }
    if (!customerFromSheet) {
      sheetWarnings.push({ row: 0, message: '未识别到采购单位（客户信息），已以文件名客户为准继续导入' })
    }

    const headerSynonyms = {
      shipDate: ['送货日期', '交货日期', '发货日期', '日期'],
      productName: ['商品名称', '品名', '品名规格', '产品名称'],
      spec: ['尺寸规格/MM', '尺寸规格', '规格', '规格/MM'],
      quantity: ['送货数量', '数量', '送货数', '数量(PCS)', '数量（PCS）'],
      unit: ['单位', '计量单位'],
      unitPrice: ['单价', '含税单价', '单价(含税)', '单价（含税）', '不含税单价', '单价（不含税）'],
      amountIncl: ['价税合计', '含税金额', '金额(含税)', '金额（含税）', '价税合计金额'],
      amountExcl: ['不含税金额', '未税金额', '金额(不含税)', '金额（不含税）'],
      taxAmount: ['税额', '税金'],
      amount: ['金额', '金额(含税)', '金额（含税）', '金额(不含税)', '金额（不含税）'],
      remark: ['备注', '说明']
    }
    const findBestHeaderRow = () => {
      let best = { idx: -1, score: 0, row: [] }
      for (let i = 0; i < Math.min(lines.length, 40); i += 1) {
        const row = flat(lines[i]).map(normalizeHeader)
        if (!row.length) continue
        const has = (keys) => keys.some((k) => row.some((c) => c.includes(normalizeHeader(k))))
        const score =
          (has(headerSynonyms.shipDate) ? 1 : 0) +
          (has(headerSynonyms.productName) ? 1 : 0) +
          (has(headerSynonyms.quantity) ? 1 : 0) +
          (has(headerSynonyms.unitPrice) ? 1 : 0)
        if (score > best.score) best = { idx: i, score, row }
      }
      return best
    }
    const headerBest = findBestHeaderRow()
    const headerIndex = headerBest.idx
    if (headerIndex < 0 || headerBest.score < 3) {
      const preview = headerBest.row.filter(Boolean).slice(0, 12).join(' | ')
      throw new Error(`未识别到明细表头（请确认导出格式一致）。期望包含“送货日期/商品名称/送货数量/单价”。候选表头：${preview || '（空）'}`)
    }

    const headerCells = flat(lines[headerIndex] || []).map(normalizeHeader)
    const findCol = (keys) => {
      const normalizedKeys = keys.map((k) => normalizeHeader(k))
      return headerCells.findIndex((h) => normalizedKeys.some((k) => h.includes(k)))
    }
    const findAllCols = (keys) => {
      const normalizedKeys = keys.map((k) => normalizeHeader(k))
      const out = []
      headerCells.forEach((h, idx) => {
        if (normalizedKeys.some((k) => h.includes(k))) out.push(idx)
      })
      return out
    }
    const normalizedAmountInclKeys = headerSynonyms.amountIncl.map((k) => normalizeHeader(k))
    const amountInclCol = headerCells.findIndex((h) => normalizedAmountInclKeys.some((k) => h.includes(k)) && !h.includes('不含税') && !h.includes('未税'))
    const pickPreferredAmountCol = () => {
      if (Number.isFinite(amountInclCol) && amountInclCol >= 0) return amountInclCol
      const generic = findAllCols(headerSynonyms.amount)[0]
      if (Number.isFinite(generic) && generic >= 0) return generic
      return -1
    }
    const col = {
      shipDate: findCol(headerSynonyms.shipDate),
      productName: findCol(headerSynonyms.productName),
      spec: findCol(headerSynonyms.spec),
      quantity: findCol(headerSynonyms.quantity),
      unit: findCol(headerSynonyms.unit),
      unitPrice: findCol(headerSynonyms.unitPrice),
      amountIncl: amountInclCol,
      amountExcl: findCol(headerSynonyms.amountExcl),
      taxAmount: findCol(headerSynonyms.taxAmount),
      amount: pickPreferredAmountCol(),
      remark: findCol(headerSynonyms.remark)
    }
    if (col.shipDate < 0 || col.productName < 0 || col.quantity < 0 || col.unitPrice < 0) {
      throw new Error('明细表头缺少关键列（送货日期/商品名称/送货数量/单价），请确认导出格式一致')
    }

    const parseCellNumber = (v) => {
      if (v == null) return NaN
      if (typeof v === 'number') return v
      const rawText = String(v ?? '').trim()
      if (!rawText) return NaN
      const cleaned = rawText
        .replace(/[￥¥]/g, '')
        .replace(/,/g, '')
        .replace(/\s+/g, '')
      const m = cleaned.match(/-?\d+(?:\.\d+)?/)
      if (!m) return NaN
      return Number(m[0])
    }

    const validateRow = (row, displayIndex) => {
      const ship = String(row?.shipDate || '').trim()
      if (!ship || !dayjs(ship).isValid()) return `第${displayIndex}行送货日期不合法（${ship || '空'}）`
      const name = String(row?.productName || '').trim()
      if (!name) return `第${displayIndex}行商品名称不能为空`
      const spec = String(row?.spec || '').trim()
      if (!spec || !/\d/.test(spec)) return `第${displayIndex}行尺寸规格不合法（${spec || '空'}）`
      const qty = Number(row?.quantity)
      if (!Number.isFinite(qty) || qty <= 0) return `第${displayIndex}行送货数量不合法（${String(row?.quantity ?? '') || '空'}）`
      const unit = String(row?.unit || '').trim()
      if (!unit) return `第${displayIndex}行单位不能为空`
      const price = Number(row?.unitPrice)
      if (!Number.isFinite(price) || price < 0) return `第${displayIndex}行单价不合法（${String(row?.unitPrice ?? '') || '空'}）`
      return ''
    }

    const rows = []
    const importErrors = (rawTruncated ? [{ row: 0, message: '原始表格过大，已截断存储（不影响导入明细与应收金额计算）' }] : []).concat(sheetWarnings)
    let explicitSummaryAmount = 0
    for (let i = headerIndex + 1; i < lines.length; i += 1) {
      const r = lines[i]
      const cells = Array.isArray(r) ? r : []
      const pick = (idx) => (idx >= 0 ? cells[idx] : '')
      const a = pick(col.shipDate)
      const b = pick(col.productName)
      const c = pick(col.spec)
      const d = pick(col.quantity)
      const e = pick(col.unit)
      const f = pick(col.unitPrice)
      const h = pick(col.remark)
      const allEmpty = [a, b, c, d, e, f, h].every((v) => String(v ?? '').trim() === '')
      if (allEmpty) break

      const isSummaryRow = (() => {
        const texts = cells.map((v) => String(v ?? '').trim()).filter(Boolean)
        if (!texts.length) return false
        return texts.some((t) => t.includes('合计'))
      })()
      if (isSummaryRow) {
        const amountFromIncl = col.amountIncl >= 0 ? parseCellNumber(pick(col.amountIncl)) : NaN
        const amountFromExcl = col.amountExcl >= 0 ? parseCellNumber(pick(col.amountExcl)) : NaN
        const taxFromCell = col.taxAmount >= 0 ? parseCellNumber(pick(col.taxAmount)) : NaN
        const amountFromGeneric = col.amount >= 0 ? parseCellNumber(pick(col.amount)) : NaN
        const summaryCandidate = Number.isFinite(amountFromIncl)
          ? amountFromIncl
          : (Number.isFinite(amountFromExcl) && Number.isFinite(taxFromCell))
            ? (amountFromExcl + taxFromCell)
            : amountFromGeneric
        if (Number.isFinite(summaryCandidate) && summaryCandidate > 0) {
          explicitSummaryAmount = summaryCandidate
        }
        break
      }

      const shipDate = typeof a === 'number' ? excelSerialToDateString(a) : dayjs(String(a || '').trim()).isValid() ? dayjs(String(a || '').trim()).format('YYYY-MM-DD') : ''
      const productName = String(b || '').trim()
      const spec = String(c || '').trim()
      const quantity = String(d || '').trim() === '' ? '' : parseCellNumber(d)
      const unit = String(e || '').trim()
      const unitPrice = String(f || '').trim() === '' ? '' : parseCellNumber(f)
      const remark = String(h || '').trim()
      const amountIncl = col.amountIncl >= 0 ? parseCellNumber(pick(col.amountIncl)) : NaN
      const amountExcl = col.amountExcl >= 0 ? parseCellNumber(pick(col.amountExcl)) : NaN
      const taxAmt = col.taxAmount >= 0 ? parseCellNumber(pick(col.taxAmount)) : NaN
      const amountGeneric = col.amount >= 0 ? parseCellNumber(pick(col.amount)) : NaN
      const amountCandidate = Number.isFinite(amountIncl)
        ? amountIncl
        : (Number.isFinite(amountExcl) && Number.isFinite(taxAmt))
          ? (amountExcl + taxAmt)
          : amountGeneric
      const built = normalizeStatementRow({
        key: `import_${i}`,
        shipDate,
        productName,
        spec,
        quantity,
        unit,
        unitPrice,
        amount: Number.isFinite(amountCandidate) ? amountCandidate : undefined,
        remark
      })
      const msg = validateRow(built, i + 1)
      if (msg) {
        importErrors.push({ row: i + 1, message: msg })
      } else {
        rows.push(built)
      }
    }

    if (!rows.length) {
      const firstErr = importErrors.length ? importErrors[0].message : '未识别到有效明细行'
      throw new Error(firstErr)
    }

    if (!hasExplicitPeriod) {
      try {
        const monthCount = new Map()
        rows.forEach((r) => {
          const d = r && r.shipDate ? dayjs(String(r.shipDate)) : null
          if (!d || !d.isValid()) return
          const k = d.format('YYYY-MM')
          monthCount.set(k, (monthCount.get(k) || 0) + 1)
        })
        const top = Array.from(monthCount.entries()).sort((a, b) => b[1] - a[1])[0]
        if (top && top[0] && top[1]) {
          const threshold = rows.length <= 3 ? rows.length : Math.max(3, Math.ceil(rows.length * 0.6))
          if (top[1] >= threshold && /^\d{4}-\d{2}$/.test(top[0])) {
            period = top[0]
          }
        }
      } catch (_) { void 0 }
    }

    const mappedCustomer = (() => {
      const c = String(customer || '').trim()
      if (!c) return c
      if (c === '太仓诚亮包装有限公司' || c.includes('太仓诚亮')) return '昆山广振汽车部件有限公司'
      return c
    })()
    if (mappedCustomer && mappedCustomer !== customer) {
      customer = mappedCustomer
      importErrors.push({ row: 0, message: `对账单模板客户已映射为：${mappedCustomer}` })
    }

    const hash = hashString(`${customer}|${period}`).slice(0, 6).toUpperCase()
    const ym = period.replace('-', '')
    const existingStatementNo = findExistingStatementNo(customer, period)
    const computedStatementNo = `QXDZD${ym}${hash}`
    if (existingStatementNo) {
      importErrors.push({ row: 0, message: `检测到该客户该期间已有对账单号：${existingStatementNo}，可选择覆盖该对账单号以替换原明细` })
    }
    const computed = rows.reduce((sum, r) => {
      const v = Number.isFinite(Number(r?.amount)) ? Number(r.amount) : calcRowAmount(r)
      return sum + (Number.isFinite(v) ? v : 0)
    }, 0)
    const totalAmount = explicitSummaryAmount > 0 ? explicitSummaryAmount : computed

    return {
      template: 'standard',
      format: nameInfo.format || '',
      nameSource: nameInfo.source || '',
      customer,
      period,
      statementNo: computedStatementNo,
      existingStatementNo: existingStatementNo || '',
      paymentTerm,
      rows,
      totalAmount: Number(totalAmount.toFixed(2)),
      title: String(title || '').trim(),
      filename: String(file?.name || ''),
      raw,
      rawTruncated,
      importErrors
    }
  }

  const normalizeNameKey = (name) => String(name || '').trim()

  const compactCustomerNameForCompare = (name) => {
    const s = normalizeNameKey(name)
      .replace(/[\s()（）[\]【】{}<>《》.,，。;；:：'"“”‘’/\\|`~!@#$%^&*+=?·_-]/g, '')
      .toLowerCase()
    const stripped = s
      .replace(/有限责任公司/g, '')
      .replace(/有限公司/g, '')
      .replace(/有限/g, '')
      .replace(/责任/g, '')
      .replace(/公司/g, '')
      .replace(/集团/g, '')
      .replace(/科技/g, '')
      .replace(/包装/g, '')
      .replace(/贸易/g, '')
      .replace(/实业/g, '')
      .replace(/股份/g, '')
    return stripped
  }

  const extractNameTokens = (name) => {
    const s = compactCustomerNameForCompare(name)
    const m = s.match(/[a-z0-9]+|[\u4e00-\u9fa5]{2,}/g)
    return (m || []).filter(Boolean)
  }

  const scoreNameMatch = (a, b) => {
    const A = compactCustomerNameForCompare(a)
    const B = compactCustomerNameForCompare(b)
    if (!A || !B) return 0
    if (A === B) return 1
    if (A.includes(B) || B.includes(A)) {
      const shorter = Math.min(A.length, B.length)
      const longer = Math.max(A.length, B.length)
      const ratio = longer ? shorter / longer : 0
      return 0.92 + ratio * 0.08
    }
    const tA = extractNameTokens(A)
    const tB = extractNameTokens(B)
    if (!tA.length || !tB.length) return 0
    const setA = new Set(tA)
    const setB = new Set(tB)
    let inter = 0
    setA.forEach((t) => { if (setB.has(t)) inter += 1 })
    const union = setA.size + setB.size - inter
    if (!union) return 0
    const j = inter / union
    return j
  }

  const buildAliasLookup = (aliases) => {
    const list = Array.isArray(aliases) ? aliases : []
    const m = new Map()
    list.forEach((a) => {
      const alias = normalizeNameKey(a?.alias)
      const canonical = normalizeNameKey(a?.canonical)
      if (alias && canonical) m.set(alias, canonical)
    })
    return m
  }

  const resolveCanonicalCustomerName = (rawName, customers, customerMap, aliases) => {
    const input = normalizeNameKey(rawName)
    if (!input) return { canonical: '', matchedBy: 'empty', suggestion: null }
    const aliasLookup = buildAliasLookup(aliases)
    const mapped = aliasLookup.get(input)
    if (mapped) return { canonical: mapped, matchedBy: 'alias', suggestion: null }

    const direct = customerMap && customerMap[input]
    if (direct && typeof direct === 'object') {
      const canonical = normalizeNameKey(direct.companyName || direct.name || input)
      return { canonical, matchedBy: 'customer', suggestion: null }
    }

    const list = Array.isArray(customers) ? customers : []
    let best = { score: 0, canonical: '' }
    list.forEach((c) => {
      const canonical = normalizeNameKey(c?.companyName || c?.name || '')
      if (!canonical) return
      const candidates = [canonical, normalizeNameKey(c?.shortName || '')].filter(Boolean)
      let s = 0
      candidates.forEach((cand) => { s = Math.max(s, scoreNameMatch(input, cand)) })
      if (s > best.score) best = { score: s, canonical }
    })
    if (best.score >= 0.92 && best.canonical) {
      return {
        canonical: best.canonical,
        matchedBy: 'heuristic',
        suggestion: input !== best.canonical ? { alias: input, canonical: best.canonical, score: best.score } : null
      }
    }
    return { canonical: input, matchedBy: 'raw', suggestion: null }
  }

  

  const [receivablePaymentMap, setReceivablePaymentMap] = useState({})
  const [payableCreateModalOpen, setPayableCreateModalOpen] = useState(false)
  const [payableFormSupplierName, setPayableFormSupplierName] = useState('')
  const [payableFormInvoiceYear, setPayableFormInvoiceYear] = useState(dayjs().year())
  const [payableFormInvoiceMonth, setPayableFormInvoiceMonth] = useState(dayjs().month() + 1)
  const [payableFormAmountPayable, setPayableFormAmountPayable] = useState(null)
  const [payableFormPaymentTerm, setPayableFormPaymentTerm] = useState('现付')
  const [payableFormInvoiceImageUrlText, setPayableFormInvoiceImageUrlText] = useState('')
  const [payableFormInvoiceImageDataUrl, setPayableFormInvoiceImageDataUrl] = useState('')
  const [payableFormInvoiceImageFileId, setPayableFormInvoiceImageFileId] = useState('')
  const [payableFormInvoiceImageName, setPayableFormInvoiceImageName] = useState('')
  const [payablePaymentMode, setPayablePaymentMode] = useState(false)
  const [payablePaySelectedKeys, setPayablePaySelectedKeys] = useState([])
  const [payablePayRecord, setPayablePayRecord] = useState(null)
  const [payablePayModalOpen, setPayablePayModalOpen] = useState(false)
  const [payablePayAmount, setPayablePayAmount] = useState(null)
  const [payablePayRemark, setPayablePayRemark] = useState('')
  const [payableEditModalOpen, setPayableEditModalOpen] = useState(false)
  const [payableEditRecord, setPayableEditRecord] = useState(null)
  const [payableEditSupplierName, setPayableEditSupplierName] = useState('')
  const [payableEditInvoiceDate, setPayableEditInvoiceDate] = useState(null)
  const [payableEditDueDate, setPayableEditDueDate] = useState(null)
  const [payableEditAmountPayable, setPayableEditAmountPayable] = useState(null)
  const [payableEditAmountPaid, setPayableEditAmountPaid] = useState(null)
  const [payableEditPaymentDate, setPayableEditPaymentDate] = useState(null)
  const [payableEditPaymentTerm, setPayableEditPaymentTerm] = useState('现付')

  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = (e) => reject(e)
    reader.readAsDataURL(file)
  })

  const uploadPayableInvoiceImageDataUrl = async (fileName, dataUrl) => {
    const src = String(dataUrl || '').trim()
    const m = src.match(/^data:(.*?);base64,(.*)$/)
    if (!m) {
      throw new Error('不支持的图片格式')
    }
    const mime = m[1]
    const base64 = m[2] || ''
    if (!base64) {
      throw new Error('图片内容为空')
    }

    const chunkChars = 48 * 1024
    const totalChunks = Math.ceil(base64.length / chunkChars)
    const init = await payableAPI.invoiceUploadInit({
      fileName: String(fileName || ''),
      mime,
      totalChunks
    })
    const uploadId = init.uploadId

    for (let i = 0; i < totalChunks; i += 1) {
      const chunk = base64.slice(i * chunkChars, (i + 1) * chunkChars)
      await payableAPI.invoiceUploadChunk({ uploadId, index: i, chunk })
    }
    return await payableAPI.invoiceUploadComplete({ uploadId })
  }

  const uploadPayableInvoiceImageFile = async (file) => {
    const dataUrl = await readFileAsDataUrl(file)
    return await uploadPayableInvoiceImageDataUrl(file?.name || 'invoice.jpg', dataUrl)
  }

  const buildReceivableMapUpdatedAt = (mapValue) => {
    if (!mapValue || typeof mapValue !== 'object') return 0
    const parseDate = (v) => {
      if (!v) return 0
      const d = dayjs(v)
      const ts = d.isValid() ? d.valueOf() : 0
      return Number.isFinite(ts) ? ts : 0
    }
    return Object.values(mapValue).reduce((maxTs, row) => {
      if (!row || typeof row !== 'object') return maxTs
      const fromUpdatedAt = Number(row.updatedAt || 0)
      const fromLast = parseDate(row.lastPaymentDate)
      const fromHistory = Array.isArray(row.history)
        ? row.history.reduce((m, h) => {
          if (!h || typeof h !== 'object') return m
          const ts = parseDate(h.date)
          return ts > m ? ts : m
        }, 0)
        : 0
      const next = Math.max(
        maxTs,
        Number.isFinite(fromUpdatedAt) ? fromUpdatedAt : 0,
        fromLast,
        fromHistory
      )
      return next
    }, 0)
  }

  const unwrapUserConfig = (value) => {
    if (!value) return { data: undefined, updatedAt: 0 }
    if (value && typeof value === 'object' && 'data' in value) {
      const updatedAt = Number(value.updatedAt || 0)
      return {
        data: value.data,
        updatedAt: Number.isFinite(updatedAt) ? updatedAt : 0
      }
    }
    return { data: value, updatedAt: 0 }
  }

  const mergeReceivablePaymentMap = (localValue, cloudValue) => {
    const localMap = localValue && typeof localValue === 'object' ? localValue : {}
    const cloudMap = cloudValue && typeof cloudValue === 'object' ? cloudValue : {}
    const parseTs = (v) => {
      if (!v) return 0
      const d = dayjs(v)
      const ts = d.isValid() ? d.valueOf() : 0
      return Number.isFinite(ts) ? ts : 0
    }
    const merged = {}
    const keys = new Set([...Object.keys(cloudMap), ...Object.keys(localMap)])
    keys.forEach((key) => {
      const l = localMap[key] && typeof localMap[key] === 'object' ? localMap[key] : undefined
      const c = cloudMap[key] && typeof cloudMap[key] === 'object' ? cloudMap[key] : undefined
      if (!l && !c) return
      const received = Math.max(Number(l?.received || 0), Number(c?.received || 0))
      const lLast = String(l?.lastPaymentDate || '')
      const cLast = String(c?.lastPaymentDate || '')
      const lastPaymentDate = (parseTs(lLast) >= parseTs(cLast) ? lLast : cLast) || ''
      const remark = String(l?.remark || '').trim() || String(c?.remark || '').trim() || ''
      const historyBase = []
      const pushHistory = (arr) => {
        (Array.isArray(arr) ? arr : []).forEach((row) => {
          if (!row || typeof row !== 'object') return
          const date = String(row.date || '').trim()
          const amount = Number(row.amount || 0)
          if (!date) return
          if (!Number.isFinite(amount) || amount === 0) return
          historyBase.push({ date, amount })
        })
      }
      pushHistory(c?.history)
      pushHistory(l?.history)
      const historySeen = new Set()
      const history = historyBase
        .filter((h) => {
          const k = `${h.date}|${h.amount}`
          if (historySeen.has(k)) return false
          historySeen.add(k)
          return true
        })
        .sort((a, b) => parseTs(a.date) - parseTs(b.date))
      merged[key] = { received, lastPaymentDate, remark, history }
    })
    return merged
  }

  const mergeReceivableStatementOverrideMap = (localValue, cloudValue) => {
    const localMap = localValue && typeof localValue === 'object' ? localValue : {}
    const cloudMap = cloudValue && typeof cloudValue === 'object' ? cloudValue : {}
    const merged = {}
    const keys = new Set([...Object.keys(cloudMap), ...Object.keys(localMap)])
    keys.forEach((key) => {
      const l = localMap[key] && typeof localMap[key] === 'object' ? localMap[key] : undefined
      const c = cloudMap[key] && typeof cloudMap[key] === 'object' ? cloudMap[key] : undefined
      if (!l && !c) return
      const dueDate = String(l?.dueDate || '').trim() || String(c?.dueDate || '').trim()
      const invoiceDate = String(l?.invoiceDate || '').trim() || String(c?.invoiceDate || '').trim()
      const next = {}
      if (dueDate) next.dueDate = dueDate
      if (invoiceDate) next.invoiceDate = invoiceDate
      if (Object.keys(next).length) merged[key] = next
    })
    return merged
  }

  const userConfigSyncTimersRef = useRef({})

  const scheduleUserConfigSave = (key, data, computeUpdatedAt) => {
    if (!isAuthenticated || !userId) return
    const safeKey = String(key || '').trim()
    if (!safeKey) return
    const timers = userConfigSyncTimersRef.current || {}
    if (timers[safeKey]) {
      clearTimeout(timers[safeKey])
    }
    timers[safeKey] = setTimeout(() => {
      const updatedAt = computeUpdatedAt ? Number(computeUpdatedAt(data)) : 0
      const payload = { data, updatedAt: Number.isFinite(updatedAt) ? updatedAt : Date.now() }
      userConfigAPI.set(safeKey, payload).catch(() => { })
      delete timers[safeKey]
    }, 600)
    userConfigSyncTimersRef.current = timers
  }

  useEffect(() => {
    if (!isAuthenticated || !userId) return
    const run = async () => {
      try {
        const keys = [
          'erp_receivablePaymentMap',
          'erp_receivableStatementOverrideMap'
        ]
        const configs = await userConfigAPI.getMany(keys)

        const readStorageObject = (primaryKey, fallbackKey) => {
          try {
            const rawPrimary = window.localStorage.getItem(primaryKey)
            if (rawPrimary) {
              const parsed = JSON.parse(rawPrimary)
              if (parsed && typeof parsed === 'object') return { data: parsed, usedFallback: false }
            }
          } catch (_) {
            void 0
          }
          try {
            const rawFallback = fallbackKey ? window.localStorage.getItem(fallbackKey) : null
            if (rawFallback) {
              const parsed = JSON.parse(rawFallback)
              if (parsed && typeof parsed === 'object') return { data: parsed, usedFallback: true }
            }
          } catch (_) {
            void 0
          }
          return { data: {}, usedFallback: false }
        }

        const localReceivableResult = readStorageObject(receivablePaymentMapStorageKey, 'erp_receivablePaymentMap')
        const localOverrideResult = readStorageObject(
          receivableStatementOverrideMapStorageKey,
          'erp_receivableStatementOverrideMap'
        )

        const localReceivable = localReceivableResult.data
        const localOverride = localOverrideResult.data

        const cloudReceivable = unwrapUserConfig(configs.erp_receivablePaymentMap).data
        const cloudOverride = unwrapUserConfig(configs.erp_receivableStatementOverrideMap).data

        const mergedReceivable = mergeReceivablePaymentMap(localReceivable, cloudReceivable)
        const mergedOverride = mergeReceivableStatementOverrideMap(localOverride, cloudOverride)

        const recChanged = JSON.stringify(localReceivable || {}) !== JSON.stringify(mergedReceivable || {})
        const ovChanged = JSON.stringify(localOverride || {}) !== JSON.stringify(mergedOverride || {})

        if (recChanged) {
          setReceivablePaymentMap(mergedReceivable)
          try {
            window.localStorage.setItem(receivablePaymentMapStorageKey, JSON.stringify(mergedReceivable))
          } catch (_) {
            void 0
          }
        }
        if (ovChanged) {
          setReceivableStatementOverrideMap(mergedOverride)
          try {
            window.localStorage.setItem(receivableStatementOverrideMapStorageKey, JSON.stringify(mergedOverride))
          } catch (_) {
            void 0
          }
        }

        if (localReceivableResult.usedFallback && !recChanged) {
          try {
            window.localStorage.setItem(receivablePaymentMapStorageKey, JSON.stringify(mergedReceivable))
          } catch (_) {
            void 0
          }
        }
        if (localOverrideResult.usedFallback && !ovChanged) {
          try {
            window.localStorage.setItem(receivableStatementOverrideMapStorageKey, JSON.stringify(mergedOverride))
          } catch (_) {
            void 0
          }
        }

        if (!Object.keys(configs || {}).length || recChanged) {
          scheduleUserConfigSave('erp_receivablePaymentMap', mergedReceivable, buildReceivableMapUpdatedAt)
        }
        if (!Object.keys(configs || {}).length || ovChanged) {
          scheduleUserConfigSave('erp_receivableStatementOverrideMap', mergedOverride, () => Date.now())
        }
      } catch (_) {
        void 0
      }
    }
    run()
  }, [isAuthenticated, userId, receivablePaymentMapStorageKey, receivableStatementOverrideMapStorageKey])

  useEffect(() => {
    scheduleUserConfigSave('erp_receivablePaymentMap', receivablePaymentMap, buildReceivableMapUpdatedAt)
  }, [isAuthenticated, receivablePaymentMap])

  useEffect(() => {
    scheduleUserConfigSave('erp_receivableStatementOverrideMap', receivableStatementOverrideMap, () => Date.now())
  }, [isAuthenticated, receivableStatementOverrideMap])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(receivablePaymentMapStorageKey)
      if (raw) {
        setReceivablePaymentMap(JSON.parse(raw))
      } else {
        setReceivablePaymentMap({})
      }
    } catch (e) {
      console.error(e)
      setReceivablePaymentMap({})
    }
  }, [receivablePaymentMapStorageKey])

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(receivableStatementOverrideMapStorageKey)
      if (raw) {
        const parsed = JSON.parse(raw)
        if (parsed && typeof parsed === 'object') {
          setReceivableStatementOverrideMap(parsed)
        } else {
          setReceivableStatementOverrideMap({})
        }
      } else {
        setReceivableStatementOverrideMap({})
      }
    } catch (e) {
      console.error(e)
      setReceivableStatementOverrideMap({})
    }
  }, [receivableStatementOverrideMapStorageKey])

  useEffect(() => {
    const loadPayables = async () => {
      try {
        const items = await payableAPI.list({ page: 1, limit: 500, orderBy: 'updatedAt_desc' })
        if (Array.isArray(items)) {
          setPayableData(items)
          return
        }
      } catch (e) {
        setPayableData([])
        return
      }
      setPayableData([])
    }
    if (!isAuthenticated) return
    loadPayables()
  }, [isAuthenticated])

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

  useEffect(() => {
    const loadSuppliers = async () => {
      try {
        const res = await supplierAPI.getSuppliers({ page: 1, limit: 1000 })
        const list = Array.isArray(res)
          ? res
          : Array.isArray(res?.data)
            ? res.data
            : Array.isArray(res?.suppliers)
              ? res.suppliers
              : Array.isArray(res?.data?.suppliers)
                ? res.data.suppliers
                : Array.isArray(res?.data?.items)
                  ? res.data.items
                  : []
        setAllSuppliers(Array.isArray(list) ? list : [])
      } catch (_) {
        setAllSuppliers([])
      }
    }
    loadSuppliers()
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

  const filterByDateRange = (list, range) => {
    if (!Array.isArray(list)) return []
    const usedRange = range
    if (
      !Array.isArray(usedRange) ||
      usedRange.length !== 2 ||
      !usedRange[0] ||
      !usedRange[1]
    ) {
      return list
    }
    const [start, end] = usedRange
    if (!start || !end) return list
    const startTs = dayjs(start).startOf('day').valueOf()
    const endTs = dayjs(end).endOf('day').valueOf()
    return list.filter((item) => {
      const srcTs = (() => {
        if (item && Number.isFinite(item.createdAtTs)) {
          return item.createdAtTs
        }
        const src = item && item.date
        if (!src) return Number.NaN
        const ts = dayjs(src).valueOf()
        if (!Number.isFinite(ts)) return Number.NaN
        return ts
      })()
      if (!Number.isFinite(srcTs)) return false
      return srcTs >= startTs && srcTs <= endTs
    })
  }

  const loadProductionData = async () => {
    setProductionLoading(true)
    setStatementLoading(true)
    try {
      // Use cached APIs to avoid timeout
      const [allOrders, customersRaw, statementsResp, aliasesResp] = await Promise.all([
        cachedOrderAPI.getAllOrders(),
        cachedCustomerAPI.getAllCustomers().catch(() => []),
        statementAPI.getStatements().catch(() => null),
        customerAliasAPI.getAliases().catch(() => null)
      ])

      const customers = Array.isArray(customersRaw)
        ? customersRaw
        : Array.isArray(customersRaw?.data)
          ? customersRaw.data
          : Array.isArray(customersRaw?.data?.data)
            ? customersRaw.data.data
            : Array.isArray(customersRaw?.data?.items)
              ? customersRaw.data.items
              : Array.isArray(customersRaw?.data?.customers)
                ? customersRaw.data.customers
                : Array.isArray(customersRaw?.customers)
                  ? customersRaw.customers
                  : []

      const isPurchaseOrder = (o) => {
        if (!o) return false
        const orderType = String(o.orderType || o.type || '').toLowerCase()
        if (orderType === 'purchase') return true
        const source = String(o.source || '').toLowerCase()
        if (source === 'purchased') return true
        const purchaseCategory = String(o.purchaseCategory || '').trim()
        if (purchaseCategory) return true
        const orderNoUpper = String(o.orderNo || o.orderNumber || '').toUpperCase()
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

      const orders = allOrders.filter((o) => !isPurchaseOrder(o))

      setAllCustomers(Array.isArray(customers) ? customers : [])
      const customerMap = {}
      customers.forEach(c => {
        if (c._id) customerMap[c._id] = c
        const nameKey = c.companyName || c.name
        if (nameKey) customerMap[nameKey] = c
        if (c.name) customerMap[c.name] = c
        if (c.shortName) customerMap[c.shortName] = c
      })

      const purchaseRaw = await cachedPurchaseAPI.getAllPurchaseOrders()
      let aliasListLocal = []
      let savedStatementsLocal = []

      try {
        const payload = statementsResp?.data ?? statementsResp
        const list =
          Array.isArray(payload?.statements) ? payload.statements
            : Array.isArray(payload?.data?.statements) ? payload.data.statements
              : Array.isArray(payload?.statements?.data) ? payload.statements.data
                : []
        const src = Array.isArray(list) ? list : []
        savedStatementsLocal = src
          .map((s) => normalizeStatementDoc(s))
          .filter(Boolean)
          .slice()
          .sort((a, b) => {
            const ta = Number(a?.updatedAt ?? a?.meta?.updatedAt ?? 0)
            const tb = Number(b?.updatedAt ?? b?.meta?.updatedAt ?? 0)
            const ua = Number.isFinite(ta) ? ta : 0
            const ub = Number.isFinite(tb) ? tb : 0
            return ua - ub
          })
        setSavedStatements(savedStatementsLocal)
      } catch (_) {
        savedStatementsLocal = []
        setSavedStatements([])
      }

      try {
        const payload = aliasesResp?.data ?? aliasesResp
        const list =
          Array.isArray(payload?.aliases) ? payload.aliases
            : Array.isArray(payload?.data?.aliases) ? payload.data.aliases
              : Array.isArray(payload?.aliases?.data) ? payload.aliases.data
                : []
        aliasListLocal = Array.isArray(list) ? list.filter(a => a && a.active !== false) : []
        setCustomerAliases(aliasListLocal)
      } catch (_) {
        aliasListLocal = []
        setCustomerAliases([])
      }


      // Build board purchase order map (moved outside of map)
      const boardPurchaseIds = Array.from(
        new Set(
          (orders || [])
            .map((o) => String(o?.purchaseOrderId || '').trim())
            .filter(Boolean)
        )
      )
      const boardPurchaseOrderMap = new Map()
      if (boardPurchaseIds.length) {
        // Fetch board purchase orders
        const results = await Promise.allSettled(boardPurchaseIds.map((id) => orderAPI.getOrder(id)))
        results.forEach((r, idx) => {
          if (!r || r.status !== 'fulfilled') return
          const resp = r.value
          const raw = resp?.data || resp?.order || resp?.data?.order || resp
          const po = raw && typeof raw === 'object' ? raw : {}
          const category = String(po.purchaseCategory || po.category || '').toLowerCase()
          if (category !== 'boards') return

          // Get amount from purchase order
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

        // Fallback: check purchase orders list for any missing IDs
        boardPurchaseIds.forEach((id) => {
          if (boardPurchaseOrderMap.has(String(id))) return
          const found = purchaseRaw.find(p => (p._id === id || p.id === id))
          if (!found) return
          const category = String(found.purchaseCategory || found.category || '').toLowerCase()
          if (category !== 'boards') return
          const amt = Number(found.amount ?? found.totalAmount ?? found.finalAmount ?? 0)
          const items = Array.isArray(found.items) ? found.items : []
          const itemsTotal = items.reduce((s, it) => s + (Number(it?.amount) || 0), 0)
          const usedAmt = amt > 0 ? amt : (Number.isFinite(itemsTotal) && itemsTotal > 0 ? itemsTotal : 0)
          if (usedAmt > 0) {
            boardPurchaseOrderMap.set(String(id), Number(usedAmt))
          }
        })
      }

      // Process statement list (moved from incorrect nesting)
      const statementList = (orders || [])
        .filter((o) => {
          const orderNoUpper = String(o.orderNo || '').toUpperCase()
          const isPurchase =
            String(o.orderType || '').toLowerCase() === 'purchase' ||
            String(o.source || '').toLowerCase() === 'purchased' ||
            (!!o.supplierName &&
              !o.customerId &&
              !orderNoUpper.startsWith('QXDD') &&
              !orderNoUpper.startsWith('QXBZ')
            )
          if (isPurchase) return false
          const note =
            o.shippingNote && typeof o.shippingNote === 'object'
              ? o.shippingNote
              : null
          const shippingNoteNo =
            (note && note.shippingNoteNo) || o.shippingNoteNo || ''
          const hasShippingDoc =
            !!shippingNoteNo ||
            !!(note && Array.isArray(note.items) && note.items.length > 0)
          return hasShippingDoc
        })
        .map((o, idx) => {
          const items = Array.isArray(o.items) ? o.items : []
          const first = items[0] || {}
          const quantity =
            o.quantity ??
            o.totalQty ??
            (Array.isArray(o.items)
              ? o.items.reduce(
                (sum, it) => sum + (Number(it.quantity) || 0),
                0
              )
              : 0)
          const rawAmount = Number(
            o.amount ?? o.totalAmount ?? o.finalAmount ?? 0
          )
          let unitPrice = Number(
            o.unitPrice ?? first.unitPrice ?? 0
          )
          if (!unitPrice && Number.isFinite(quantity) && quantity > 0 && rawAmount) {
            unitPrice = rawAmount / quantity
          }
          const goodsName =
            o.goodsName ||
            o.productTitle ||
            (first &&
              (first.goodsName || first.title || first.productName)) ||
            o.goods_name ||
            o.title ||
            ''
          const unit = o.unit || first.unit || '只'
          const materialNo =
            o.materialNo ??
            (first && first.materialNo) ??
            ''
          const boardWidth =
            o.boardWidth ??
            (first && first.boardWidth) ??
            undefined
          const boardHeight =
            o.boardHeight ??
            (first && first.boardHeight) ??
            undefined
          const specText =
            o.spec ||
            first.spec ||
            (boardWidth && boardHeight
              ? `${Number(boardWidth)}×${Number(boardHeight)}mm`
              : '')
          const note =
            o.shippingNote && typeof o.shippingNote === 'object'
              ? o.shippingNote
              : null
          const shippedAtRaw =
            o.shippedAt ||
            o.deliveryTime ||
            o.shipDate ||
            (note && (note.shippedAt || note.shipDate))
          const shippedAtTs = shippedAtRaw ? dayjs(shippedAtRaw).valueOf() : undefined
          const shipDate = shippedAtRaw ? dayjs(shippedAtRaw).format('YYYY-MM-DD') : ''
          const reconciledRaw =
            (note && note.reconciledAt) || o.reconciledAt || null
          const invoicedRaw =
            (note && note.invoicedAt) || o.invoicedAt || null
          const paidRaw =
            (note && note.paidAt) || o.paidAt || null
          const reconciledTs = reconciledRaw
            ? dayjs(reconciledRaw).valueOf()
            : undefined
          const reconcileDate = reconciledRaw
            ? dayjs(reconciledRaw).format('YYYY-MM-DD')
            : ''
          let statusLabel = ''
          if (paidRaw) {
            statusLabel = '已回款'
          } else if (invoicedRaw) {
            statusLabel = '已开票'
          } else if (reconciledRaw) {
            statusLabel = '已对账'
          } else {
            statusLabel = '待对账'
          }
          const customerObj = (o.customerId && customerMap[o.customerId]) || customerMap[o.customerName] || customerMap[o.customer?.name] || {}
          // Payment Term Priority: Customer Settings > Order Settings
          const paymentTerm =
            customerObj.paymentTerms ||
            o.paymentTerm ||
            o.paymentTerms ||
            o.term ||
            ''

          // Full Name Priority: Company Name > Name > Order Customer Name
          const rawCustomerName = customerObj.companyName || customerObj.name || o.customerName || o.customer?.name || o.customer || ''
          const resolvedCustomer = resolveCanonicalCustomerName(rawCustomerName, customers, customerMap, aliasListLocal)
          const fullCustomerName = resolvedCustomer.canonical || rawCustomerName || ''
          const amountVal =
            rawAmount ||
            Number(quantity || 0) * Number(unitPrice || 0)
          const shippingNoteNo =
            (note && note.shippingNoteNo) || o.shippingNoteNo || ''
          const statementNo = o.statementNo || (note && note.statementNo) || ''
          const invoiceDate = invoicedRaw ? dayjs(invoicedRaw).format('YYYY-MM-DD') : ''
          const paymentDate = paidRaw ? dayjs(paidRaw).format('YYYY-MM-DD') : ''

          return {
            key: o._id ?? o.id ?? `statement_${idx}`,
            customerId: o.customerId || customerObj._id || customerObj.id,
            orderId: o._id ?? o.id ?? undefined,
            orderNo: o.orderNo ?? o.orderNumber ?? '',
            statementNo,
            customerName: fullCustomerName,
            originalCustomerName: rawCustomerName,
            customerNameMatchedBy: resolvedCustomer.matchedBy,
            productName: goodsName,
            materialNo,
            spec: specText,
            quantity: Number(quantity || 0),
            unit,
            unitPrice,
            amount: amountVal,
            shipDate,
            reconcileDate,
            invoiceDate,
            paymentDate,
            paymentTerm,
            statusLabel,
            status: o.status, // Pass original status
            signedAt: o.signedAt, // Pass signedAt
            updatedAt: o.updatedAt || o.updateTime, // Pass updatedAt
            hasShipped: !!shippingNoteNo || !!(note && Array.isArray(note.items) && note.items.length > 0),
            isReconciled: !!reconciledRaw,
            reconciledAtTs: reconciledTs,
            shippedAtTs,
            shippingNoteNo: shippingNoteNo || undefined,
            date: shippedAtRaw || reconciledRaw || o.createTime || o.createdAt || null,
            createdAtTs: shippedAtTs || (o.createdAt ? dayjs(o.createdAt).valueOf() : undefined)
          }
        })

      try {
        const aliasLookup = buildAliasLookup(aliasListLocal)
        const variantMap = new Map()
        statementList.forEach((r) => {
          const canonical = normalizeNameKey(r?.customerName)
          const raw = normalizeNameKey(r?.originalCustomerName || r?.customerName)
          if (!canonical || !raw) return
          const set = variantMap.get(canonical) || new Set()
          set.add(raw)
          variantMap.set(canonical, set)
        })
        const suggestions = []
        variantMap.forEach((variants, canonical) => {
          if (!variants || variants.size < 2) return
          if (!variants.has(canonical)) return
          variants.forEach((v) => {
            if (!v || v === canonical) return
            if (aliasLookup.get(v)) return
            suggestions.push({ alias: v, canonical })
          })
        })
        const uniq = Array.from(new Map(suggestions.map((s) => [`${s.alias}=>${s.canonical}`, s])).values())
        setCustomerAliasSuggestions(uniq)
      } catch (_) {
        setCustomerAliasSuggestions([])
      }

      setStatementOrders(statementList)

      const receivableMap = new Map()
      statementList.forEach((item) => {
        if (item.isReconciled && item.statementNo) {
          const key = item.statementNo
          const customerObj = allCustomersList.find(c =>
            (item.customerId && (c._id === item.customerId || c.id === item.customerId)) ||
            (c.name === item.customerName || c.companyName === item.customerName)
          ) || {}

          const prev = receivableMap.get(key) || {
            key,
            statementNo: key,
            customerName: item.customerName,
            customerId: item.customerId,
            amountReceivable: 0,
            amountReceived: 0,
            invoiceDate: item.invoiceDate,
            paymentDate: '', // Actual payment date (latest)
            date: item.reconcileDate,
            dueDate: '', // Calculated settlement date
            orderNo: item.orderNo
          }

          prev.amountReceivable += Number(item.amount || 0)

          // Payment Logic: Prioritize local payment map, fallback to order-level
          const localPayment = receivablePaymentMap[key]
          if (localPayment) {
            prev.amountReceived = Number(localPayment.received || 0)
            if (localPayment.lastPaymentDate) {
              prev.paymentDate = localPayment.lastPaymentDate
            }
          } else {
            if (item.paymentDate) {
              prev.amountReceived += Number(item.amount || 0)
              if (!prev.paymentDate || item.paymentDate > prev.paymentDate) {
                prev.paymentDate = item.paymentDate
              }
            }
          }

          if (item.invoiceDate && (!prev.invoiceDate || item.invoiceDate > prev.invoiceDate)) {
            prev.invoiceDate = item.invoiceDate
          }

          // Calculate payment date (settlement date) -> dueDate
          if (!prev.dueDate) {
            const reconcileDate = item.reconcileDate ? dayjs(item.reconcileDate) : null
            if (reconcileDate && reconcileDate.isValid()) {
              const paymentTermStr = item.paymentTerm || customerObj.paymentTerms || ''
              let calculatedDate = reconcileDate

              if (paymentTermStr.includes('月结')) {
                const match = paymentTermStr.match(/(\d+)天/)
                let daysToAdd = 0
                if (match) {
                  daysToAdd = parseInt(match[1], 10)
                }
                // Base: Next Month 1st
                const baseDate = reconcileDate.add(1, 'month').startOf('month')
                calculatedDate = baseDate.add(daysToAdd, 'day')
              } else if (paymentTermStr.includes('现结')) {
                calculatedDate = reconcileDate
              }

              prev.dueDate = calculatedDate.format('YYYY-MM-DD')
            }
          }

          receivableMap.set(key, prev)
        }
      })

      const storedStatements = Array.isArray(savedStatementsLocal) ? savedStatementsLocal : (Array.isArray(savedStatements) ? savedStatements : [])
      const storedLatestByNo = new Map()
      storedStatements.forEach((s) => {
        const statementNo = String(s?.statementNo || '').trim()
        if (!statementNo) return
        const prev = storedLatestByNo.get(statementNo) || null
        const ta = Number(s?.updatedAt ?? s?.meta?.updatedAt ?? 0)
        const tb = Number(prev?.updatedAt ?? prev?.meta?.updatedAt ?? 0)
        const ua = Number.isFinite(ta) ? ta : 0
        const ub = Number.isFinite(tb) ? tb : 0
        if (!prev || ua >= ub) storedLatestByNo.set(statementNo, s)
      })
      Array.from(storedLatestByNo.values()).forEach((s) => {
        const statementNo = String(s?.statementNo || '').trim()
        if (!statementNo) return
        const rawCustomerName = String(s?.customer || s?.customerName || '').trim()
        const resolvedCustomer = resolveCanonicalCustomerName(rawCustomerName, customers, customerMap, aliasListLocal)
        const customerName = resolvedCustomer.canonical || rawCustomerName || ''
        const period = String(s?.period || '').trim()
        const rows = Array.isArray(s?.rows) ? s.rows : []
        const meta = (s?.meta && typeof s.meta === 'object') ? s.meta : {}
        const template = String(meta?.template || 'standard')
        const totalAmount = template === 'deliveryDetail'
          ? Number(meta?.summaryAmount ?? meta?.summary?.amountIncl ?? meta?.amountIncl ?? meta?.totalAmount ?? 0)
          : rows.reduce((sum, r) => {
            const qty = Number(r?.quantity || 0)
            const price = Number(r?.unitPrice || 0)
            const amount = Number.isFinite(Number(r?.amount)) ? Number(r.amount) : qty * price
            return sum + (Number.isFinite(amount) ? amount : 0)
          }, 0)

        const base = receivableMap.get(statementNo) || {
          key: statementNo,
          statementNo,
          customerName: customerName || '',
          customerId: '',
          amountReceivable: 0,
          amountReceived: 0,
          invoiceDate: '',
          paymentDate: '',
          date: '',
          dueDate: '',
          orderNo: ''
        }
        base.amountReceivable = Number(totalAmount.toFixed(2))
        if (!base.customerName && customerName) base.customerName = customerName
        if (!base.date) {
          const d = String(meta?.reconcileDate || meta?.date || '').trim()
          base.date = d || (period ? `${period}-01` : dayjs(meta?.updatedAt || s?.updatedAt || Date.now()).format('YYYY-MM-DD'))
        }
        if (!base.dueDate) {
          const reconcileDate = base.date ? dayjs(base.date) : null
          if (reconcileDate && reconcileDate.isValid()) {
            const paymentTermStr = String(meta?.paymentTerm || meta?.paymentTerms || '').trim()
            let calculatedDate = reconcileDate
            if (paymentTermStr.includes('月结')) {
              const match = paymentTermStr.match(/(\d+)天/)
              let daysToAdd = 0
              if (match) {
                daysToAdd = parseInt(match[1], 10)
              }
              const baseDate = reconcileDate.add(1, 'month').startOf('month')
              calculatedDate = baseDate.add(daysToAdd, 'day')
            } else if (paymentTermStr.includes('现结')) {
              calculatedDate = reconcileDate
            }
            base.dueDate = calculatedDate.format('YYYY-MM-DD')
          }
        }
        base._statementDoc = s
        receivableMap.set(statementNo, base)
      })

      const receivableList = Array.from(receivableMap.values()).map((r) => {
        // Allow manual override of amountReceived if we have a local store or separate API
        // For now, just use what we aggregated

        const total = Number(r.amountReceivable || 0)
        const received = Number(r.amountReceived || 0)

        let status = 'pending'
        const now = dayjs()
        const due = r.dueDate ? dayjs(r.dueDate) : null

        if (received >= total && total > 0) {
          status = 'paid'
        } else if (received > 0) {
          status = 'partial'
        } else if (due && due.isValid()) {
          if (now.isAfter(due, 'day')) {
            status = 'overdue'
          } else if (now.isSame(due, 'day')) {
            status = 'due'
          }
        }

        const override = receivableStatementOverrideMap && r?.statementNo
          ? receivableStatementOverrideMap[String(r.statementNo)]
          : undefined
        const next = { ...r, status }
        if (override && typeof override === 'object') {
          if (override.dueDate) next.dueDate = String(override.dueDate || '')
          if (override.invoiceDate) next.invoiceDate = String(override.invoiceDate || '')
        }
        return next
      })
      setReceivableData(receivableList)

      const receivablePurchaseResp = await purchaseAPI.getPurchaseOrders({
        page: 1,
        pageSize: 500
      })
      const receivablePurchaseRaw = Array.isArray(receivablePurchaseResp)
        ? receivablePurchaseResp
        : Array.isArray(receivablePurchaseResp?.data)
          ? receivablePurchaseResp.data
          : Array.isArray(receivablePurchaseResp?.orders)
            ? receivablePurchaseResp.orders
            : Array.isArray(receivablePurchaseResp?.data?.orders)
              ? receivablePurchaseResp.data.orders
              : Array.isArray(receivablePurchaseResp?.list)
                ? receivablePurchaseResp.list
                : Array.isArray(receivablePurchaseResp?.data?.list)
                  ? receivablePurchaseResp.data.list
                  : []

      const purchaseList = (receivablePurchaseRaw || []).map((o) => {
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
        return {
          orderNo: o.orderNo ?? o.orderNumber ?? '',
          materialNo,
          quantity,
          rawUnitPrice
        }
      })
      const materialPriceMap = new Map()
      const purchasePriceByOrderNo = new Map()
      purchaseList.forEach((p) => {
        const qty = Number(p.quantity || 0)
        const price = Number(p.rawUnitPrice || 0)
        if (p.materialNo && qty && price) {
          const prev = materialPriceMap.get(p.materialNo) || { qty: 0, amount: 0 }
          materialPriceMap.set(p.materialNo, {
            qty: prev.qty + qty,
            amount: prev.amount + price * qty
          })
        }
        if (p.orderNo && price) {
          purchasePriceByOrderNo.set(p.orderNo, price)
        }
      })

      const mergedOrders = orders.map((o) => {
        // 辅助函数
        const normalizeText = (v) => String(v ?? '').trim()
        const normalizeKey = (v) => normalizeText(v).toLowerCase()
        const isNumeric = (str) => /^\d+$/.test(str)
        const looksLikeMaterialNo = (str) => {
            if (!str) return false
            if (str.length > 6 && (isNumeric(str) || (str.includes('-') && /\d/.test(str)))) return true
            return false
        }
        const looksLikeMaterialCode = (str) => !looksLikeMaterialNo(str) && str.length < 15

        const items = Array.isArray(o?.items) ? o.items : []
        const first = items[0] || {}
        
        // 获取订单详情的完整材质编码信息
        const data = o?.data && typeof o.data === 'object' ? o.data : null
        const meta = o?.meta && typeof o.meta === 'object' ? o.meta : null
        const brief = meta?.brief && typeof meta.brief === 'object' ? meta.brief : null
        const product = o?.product && typeof o.product === 'object' ? o.product : null
        const sku = o?.sku && typeof o.sku === 'object' ? o.sku : null
        
        // 完整的材质编码解析逻辑
        let materialCode = normalizeText(o.materialCode ?? o.material_code ?? data?.materialCode ?? data?.material_code ?? meta?.materialCode ?? meta?.material_code ?? brief?.materialCode ?? brief?.material_code ?? product?.materialCode ?? product?.material_code ?? first.materialCode ?? first.material_code ?? sku?.materialCode ?? sku?.material_code)
        let materialNo = normalizeText(o.materialNo ?? o.material_no ?? data?.materialNo ?? data?.material_no ?? meta?.materialNo ?? meta?.material_no ?? brief?.materialNo ?? brief?.material_no ?? product?.materialNo ?? product?.material_no ?? first.materialNo ?? first.material_no ?? sku?.materialNo ?? sku?.material_no)

        // 修复：如果材质编码看起来像物料号（纯数字且较长），而物料号看起来像材质编码（短且含字母），则交换
        if (looksLikeMaterialNo(materialCode) && looksLikeMaterialCode(materialNo)) {
            const temp = materialCode
            materialCode = materialNo
            materialNo = temp
        } else if (looksLikeMaterialNo(materialCode) && !materialNo) {
            // 如果材质编码像物料号，且物料号为空，则移动过去
            materialNo = materialCode
            materialCode = ''
        }
        
        // 如果材质编码和物料号完全相同，说明数据重复，清空材质编码
        if (materialCode && materialNo && normalizeKey(materialCode) === normalizeKey(materialNo)) {
            materialCode = ''
        }
        
        // 再次确认：如果经过上述逻辑后，MaterialCode 仍然像物料号，则强制置空
        if (looksLikeMaterialNo(materialCode)) {
          materialCode = ''
        }

        // 优先从 SKU 获取材质编码，确保准确性
        const skuCode = normalizeText(sku?.materialCode ?? sku?.material_code)
        if (skuCode) {
            materialCode = skuCode
        }
        const skuNo = normalizeText(sku?.materialNo ?? sku?.material_no)
        if (skuNo && !materialNo) {
            materialNo = skuNo
        }

        const materialKey = materialCode || materialNo || ''
        const entry = o.materialNo ? materialPriceMap.get(o.materialNo) : undefined
        const mapPrice =
          entry && entry.qty > 0 ? entry.amount / entry.qty : 0
        const directOrderPrice = o.orderNo ? purchasePriceByOrderNo.get(o.orderNo) || 0 : 0
        const orderOverridePrice = getOrderOverridePrice(o.orderNo)
        const overridePrice = orderOverridePrice || getOverridePrice(materialKey, o.date)
        const basePrice = directOrderPrice || mapPrice
        const materialPrice = overridePrice || basePrice
        const createdAtTs = (() => {
          const rawTs = Number(o?.createdAtTs ?? o?.createTimeTs ?? o?.createdAtTime ?? o?.timestamp ?? 0)
          if (Number.isFinite(rawTs) && rawTs > 0) {
            return rawTs < 1000000000000 ? rawTs * 1000 : rawTs
          }
          const rawDate = o?.createdAt || o?.createTime || o?.date || o?.orderDate || o?.updatedAt || null
          if (!rawDate) return undefined
          const t = dayjs(rawDate).valueOf()
          return Number.isFinite(t) ? t : undefined
        })()
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
        const width = Number(o.boardWidth || 0)
        const height = Number(o.boardHeight || 0)
        const effectiveWidth = width > 0 ? width + 30 : 0
        const area =
          effectiveWidth > 0 && height > 0
            ? (effectiveWidth * height) / 1000000
            : 0

        const effectiveSheetCount = getEffectiveSheetCount(o, first)
        
        // Use order raw material cost directly, but prioritize explicit unit price if available
        let rawMaterialCost = Number(o.rawMaterialCost || o.raw_material_cost || 0)
        let rawMaterialUnitPrice = 0
        const explicitRawUnitPrice = Number(
          o.rawUnitPrice ?? o.rawMaterialUnitPrice ??
          first.rawUnitPrice ?? first.raw_unit_price ?? 
          first.costPrice ?? first.cost_price ?? 
          first.purchasePrice ?? first.purchase_price
        )
        
        if (Number.isFinite(explicitRawUnitPrice) && explicitRawUnitPrice > 0) {
          rawMaterialUnitPrice = explicitRawUnitPrice
          // Recalculate cost if unit price is available and we have sheets
          if (effectiveSheetCount > 0) {
            rawMaterialCost = rawMaterialUnitPrice * effectiveSheetCount
          }
        } else {
          // Fallback: calc from cost
          rawMaterialUnitPrice = effectiveSheetCount > 0 ? rawMaterialCost / effectiveSheetCount : 0
        }
        
        const costSource = 'order_direct'

        const grossProfit = Number(orderAmount || 0) - rawMaterialCost
        const grossMargin =
          Number(orderAmount || 0) > 0
            ? (grossProfit / Number(orderAmount || 0)) * 100
            : 0
        return {
          ...o,
          key: o._id ?? o.id ?? o.key ?? `sales_${o.orderNo}_${createdAtTs}`,
          createdAtTs,
          sourceType: 'sales',
          quantity,
          unitPrice,
          orderAmount,
          materialCode, // 添加正确的材质编码
          materialNo,   // 添加正确的物料号
          materialPrice,
          rawMaterialUnitPrice,
          rawMaterialCost,
          grossProfit,
          grossMargin,
          costSource
        }
      })

      const purchaseRows = (purchaseRaw || [])
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
        .map((o, idx) => {
          const items = Array.isArray(o.items) ? o.items : []
          const first = items[0] || {}
          const quantity =
            o.quantity ??
            o.totalQty ??
            (Array.isArray(o.items)
              ? o.items.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)
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
          const goodsName =
            o.goodsName ||
            o.productTitle ||
            (first && (first.goodsName || first.title || first.productName)) ||
            o.title ||
            ''
          
          // 为采购订单也应用材质编码解析逻辑
          const normalizeText = (v) => String(v ?? '').trim()
          const data = o?.data && typeof o.data === 'object' ? o.data : null
          const meta = o?.meta && typeof o.meta === 'object' ? o.meta : null
          const brief = meta?.brief && typeof meta.brief === 'object' ? meta.brief : null
          const product = o?.product && typeof o.product === 'object' ? o.product : null
          const sku = o?.sku && typeof o.sku === 'object' ? o.sku : null
          
          let materialCode = normalizeText(o.materialCode ?? o.material_code ?? data?.materialCode ?? data?.material_code ?? meta?.materialCode ?? meta?.material_code ?? brief?.materialCode ?? brief?.material_code ?? product?.materialCode ?? product?.material_code ?? first.materialCode ?? first.material_code ?? sku?.materialCode ?? sku?.material_code)
          let materialNo = normalizeText(o.materialNo ?? o.material_no ?? data?.materialNo ?? data?.material_no ?? meta?.materialNo ?? meta?.material_no ?? brief?.materialNo ?? brief?.material_no ?? product?.materialNo ?? product?.material_no ?? first.materialNo ?? first.material_no ?? sku?.materialNo ?? sku?.material_no)
          const orderAmount = Number(Number(quantity || 0) * saleUnitPrice)
          const rawDate = o.createdAt || o.createTime || o.date || o.orderDate || o.updatedAt || null
          const createdAtTs = (() => {
            const rawTs = Number(o?.createdAtTs ?? o?.createTimeTs ?? o?.createdAtTime ?? o?.timestamp ?? 0)
            if (Number.isFinite(rawTs) && rawTs > 0) {
              return rawTs < 1000000000000 ? rawTs * 1000 : rawTs
            }
            if (!rawDate) return undefined
            const t = dayjs(rawDate).valueOf()
            return Number.isFinite(t) ? t : undefined
          })()
          const materialKey = materialCode || materialNo || ''
          const overridePrice = getOverridePrice(materialKey, rawDate)
          const materialPrice = overridePrice || purchaseUnitPrice
          const rawMaterialUnitPrice = materialPrice
          const rawMaterialCost = Number(quantity || 0) * rawMaterialUnitPrice
          const grossProfit = orderAmount - rawMaterialCost
          const grossMargin =
            orderAmount > 0 ? (grossProfit / orderAmount) * 100 : 0
          return {
            key: o._id ?? o.id ?? `purchase_${idx}`,
            orderNo: o.orderNo ?? o.orderNumber ?? '',
            customerName:
              o.customerName ??
              o.customer?.name ??
              o.customer ??
              o.supplierName ??
              o.supplier?.name ??
              o.supplier ??
              '',
            productName: goodsName,
            materialCode,
            materialNo: materialNo ?? '',
            quantity: Number(quantity || 0),
            unitPrice: saleUnitPrice,
            orderAmount,
            rawMaterialUnitPrice,
            rawMaterialCost,
            grossProfit,
            grossMargin,
            date: rawDate,
            createdAtTs,
            sourceType: 'purchase'
          }
        })

      const combined = [...mergedOrders, ...purchaseRows].slice()
      combined.sort((a, b) => {
        const ta = Number.isFinite(a.createdAtTs) ? a.createdAtTs : (a.date ? dayjs(a.date).valueOf() : 0)
        const tb = Number.isFinite(b.createdAtTs) ? b.createdAtTs : (b.date ? dayjs(b.date).valueOf() : 0)
        return tb - ta
      })
      setProductionData(combined)
    } catch (e) {
      setProductionData([])
      setAllCustomers([])
    } finally {
      setProductionLoading(false)
      setStatementLoading(false)
    }
  }

  useEffect(() => {
    loadProductionData()
  }, [])

  useEffect(() => {
    if (activeTab !== 'receivable') return
    const t = setInterval(() => {
      loadProductionData()
    }, 120000)
    return () => clearInterval(t)
  }, [activeTab])

  useEffect(() => {
    const state = location && location.state
    if (state && state.activeTab === 'statements') {
      setActiveTab('statements')
      if (state.focusOrderNo) {
        setStatementKeyword(state.focusOrderNo)
      }
    }
  }, [location])

  const productionColumns = [
    {
      title: '订单号',
      dataIndex: 'orderNo',
      key: 'orderNo',
      width: 160,
      render: (text, record) => {
        const main = text || '-'
        const src = record?.date
        if (!src) {
          return main
        }
        const d = dayjs(src)
        const display = d.isValid() ? d.format('YYYY-MM-DD HH:mm') : src
        return (
          <div>
            <div>{main}</div>
            <div style={{ color: '#6b7280', fontSize: 12 }}>{display}</div>
          </div>
        )
      }
    },
    {
      title: '客户名称',
      dataIndex: 'customerName',
      key: 'customerName',
      width: 160,
      render: (text, record) => {
        const customerId = record.customerId || record.customer?._id || record.customer?.id
        const customerName = text
        const customer = allCustomersList.find(c =>
          (customerId && (c._id === customerId || c.id === customerId)) ||
          (c.name === customerName || c.companyName === customerName)
        )
        return customer?.shortName || text || '-'
      }
    },
    {
      title: '商品名称',
      dataIndex: 'productName',
      key: 'productName',
      width: 180,
      render: (text, record) => {
        if (record?.__groupParent) return ''
        return text || '-'
      }
    },
    {
      title: '订单数量',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 140,
      render: (v, record) => {
        if (record?.__groupParent) return ''
        const qty = Number(v || 0)
        const sheetCount =
          record?.sourceType === 'sales' ? Number(record?.sheetCount || 0) : 0
        if (!sheetCount) return qty
        return (
          <div>
            <div>{qty}</div>
            <div style={{ color: '#6b7280', fontSize: 12 }}>{`（下单数量）${sheetCount} 片`}</div>
          </div>
        )
      }
    },
    {
      title: '单价',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: 120,
      render: (v, record) => {
        if (record?.__groupParent) return ''
        return `¥${Number(v || 0).toFixed(2)}`
      }
    },
    {
      title: '原材料单价',
      dataIndex: 'rawMaterialUnitPrice',
      key: 'rawMaterialUnitPrice',
      width: 140,
      render: (v, record) => {
        if (record?.__groupParent) return ''
        return `¥${Number(v || 0).toFixed(2)}`
      }
    },
    {
      title: '订单金额(元)',
      dataIndex: 'orderAmount',
      key: 'orderAmount',
      width: 140,
      render: (v, record) => {
        if (record?.__groupParent) return ''
        return `¥${Number(v || 0).toLocaleString()}`
      }
    },
    {
      title: '原材料成本(元)',
      dataIndex: 'rawMaterialCost',
      key: 'rawMaterialCost',
      width: 150,
      render: (v, record) => {
        if (record?.__groupParent) return ''
        return `¥${Number(v || 0).toLocaleString()}`
      }
    },
    {
      title: '毛利(元)',
      dataIndex: 'grossProfit',
      key: 'grossProfit',
      width: 130,
      render: (v, record) => {
        if (record?.__groupParent) return ''
        const val = Number(v || 0)
        const isLoss = Number(record?.grossProfit || 0) < 0
        return (
          <span style={{ color: isLoss ? '#16a34a' : undefined }}>
            ¥{Number(val || 0).toLocaleString()}
          </span>
        )
      }
    },
    {
      title: '毛利率',
      dataIndex: 'grossMargin',
      key: 'grossMargin',
      width: 110,
      render: (v, record) => {
        if (record?.__groupParent) return ''
        const val = Number(v || 0)
        const isLoss = Number(record?.grossProfit || 0) < 0
        return (
          <span style={{ color: isLoss ? '#16a34a' : undefined }}>
            {`${val.toFixed(1)}%`}
          </span>
        )
      }
    }
  ]

  const renderStatCards = (cards) => (
    <Row gutter={[16, 16]} style={{ marginBottom: 24 }} wrap={false}>
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
          <Col flex="1" key={card.title}>
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

  const statementColumns = [
    {
      title: '订单号',
      dataIndex: 'orderNo',
      key: 'orderNo',
      width: 140
    },
    {
      title: '客户名称',
      dataIndex: 'customerName',
      key: 'customerName',
      width: 160,
      render: (text, record) => {
        const customerId = record.customerId || record.customer?._id || record.customer?.id
        const customerName = text
        const customer = allCustomersList.find(c =>
          (customerId && (c._id === customerId || c.id === customerId)) ||
          (c.name === customerName || c.companyName === customerName)
        )
        return customer?.shortName || text || '-'
      }
    },
    {
      title: '商品名称',
      dataIndex: 'productName',
      key: 'productName',
      width: 220,
      render: (_, record) => {
        const name = record.productName || '-'
        const material = record.materialNo || ''
        return (
          <div>
            <div>{name}</div>
            {material ? (
              <div style={{ color: '#6b7280', fontSize: 12 }}>{material}</div>
            ) : null}
          </div>
        )
      }
    },
    {
      title: '规格尺寸',
      dataIndex: 'spec',
      key: 'spec',
      width: 160
    },
    {
      title: '订单数量',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 110
    },
    {
      title: '单价',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: 120,
      render: (v) => `¥${Number(v || 0).toFixed(2)}`
    },
    {
      title: '送货日期',
      dataIndex: 'shipDate',
      key: 'shipDate',
      width: 140
    },
    {
      title: '对账日期',
      dataIndex: 'reconcileDate',
      key: 'reconcileDate',
      width: 140
    },
    {
      title: '账期',
      dataIndex: 'paymentTerm',
      key: 'paymentTerm',
      width: 120
    },
    {
      title: '状态',
      dataIndex: 'statusLabel',
      key: 'statusLabel',
      width: 110,
      render: (text) => {
        let color = 'default'
        if (text === '已对账') color = 'blue'
        if (text === '已开票') color = 'gold'
        if (text === '已回款') color = 'green'
        return <Tag color={color}>{text || '-'}</Tag>
      }
    }
  ]

  const receivableColumns = [
    {
      title: '对账单号',
      dataIndex: 'statementNo',
      key: 'statementNo',
      width: 160,
      render: (text, record) => (
        <a
          href="#"
          style={{ cursor: 'pointer' }}
          onClick={async (e) => {
            if (e && typeof e.preventDefault === 'function') e.preventDefault()
            if (e && typeof e.stopPropagation === 'function') e.stopPropagation()
            const sn = String(text || '').trim()
            if (!sn) return
            let doc = record?._statementDoc
            const latest = await fetchLatestStatementDocByStatementNo(sn)
            if (latest) doc = latest
            const meta = doc?.meta || {}
            const template = String(meta?.template || '')
            if (template === 'standard' && Array.isArray(doc?.rows) && doc.rows.length) {
              const rows = doc.rows.map((r, idx) => ({
                ...r,
                key: r?.key || `row_${idx}`,
                customerName: record?.customerName || '',
                statementNo: sn,
                paymentTerm: String(meta?.paymentTerm || '')
              }))
              setReceivableStatementDetailTemplate('standard')
              setReceivableStatementDetailColumns(statementPreviewColumnsStandardReadonly)
              setReceivableStatementDetailTotalAmount(0)
              setReceivableStatementDetailTitle(`${sn} 对账单明细`)
              setReceivableStatementDetailRows(rows)
              setReceivableStatementDetailOpen(true)
              return
            }
            if (template === 'deliveryDetail') {
              const rawSheet = meta?.rawSheet || meta?.raw || null
              const docRows = Array.isArray(doc?.rows) ? doc.rows : []
              const layout = meta?.layout || rawSheet || null
              const rows = docRows.length
                ? docRows.map((r, idx) => ({
                  ...r,
                  key: r?.key || `dd_${idx}`
                }))
                : extractDeliveryDetailRowsFromRawSheet(rawSheet)
              const columns = [
                { title: '序号', dataIndex: 'seq', key: 'seq', width: 80 },
                { title: '品名规格', dataIndex: 'nameSpec', key: 'nameSpec', width: 520, ellipsis: true },
                { title: '金额（含税）', dataIndex: 'amountIncl', key: 'amountIncl', width: 140, render: (v) => (v === '' ? '' : `￥${Number(v || 0).toFixed(2)}`) }
              ]
              const summaryAmountRaw = Number(meta?.summaryAmount ?? meta?.summary?.amountIncl ?? meta?.amountIncl ?? meta?.totalAmount ?? 0)
              const computed = rows.reduce((sum, r) => sum + (Number.isFinite(Number(r?.amountIncl)) ? Number(r.amountIncl) : 0), 0)
              const totalAmount = summaryAmountRaw > 0 ? summaryAmountRaw : computed
              setReceivableStatementDetailTemplate('deliveryDetail')
              setReceivableStatementDetailColumns(columns)
              setReceivableStatementDetailTotalAmount(Number(totalAmount || 0))
              setReceivableStatementDetailTitle(`${sn} 对账单明细`)
              setReceivableStatementDetailRows(rows)
              setReceivableStatementDetailLayout(layout)
              setReceivableStatementDetailOpen(true)
              return
            }
            const rows = statementOrders.filter(o => o.statementNo === sn)
            if (!rows.length) {
                              message.warning('该对账单暂无可展示的明细（可能为导入的送货明细模板）')
              return
            }
            setReceivableStatementDetailTemplate('standard')
            setReceivableStatementDetailColumns(statementPreviewColumnsStandardReadonly)
            setReceivableStatementDetailTotalAmount(0)
            setReceivableStatementDetailTitle(`${sn} 对账单明细`)
            setReceivableStatementDetailRows(rows)
            setReceivableStatementDetailOpen(true)
          }}
        >
          {text}
        </a>
      )
    },
    {
      title: '客户名称',
      dataIndex: 'customerName',
      key: 'customerName',
      width: 180,
      render: (text, record) => {
        const customerId = record.customerId || record.customer?._id || record.customer?.id
        const customerName = text
        const customer = allCustomersList.find(c =>
          (customerId && (c._id === customerId || c.id === customerId)) ||
          (c.name === customerName || c.companyName === customerName)
        )
        return customer?.shortName || text || '-'
      }
    },
    {
      title: '应收款(元)',
      dataIndex: 'amountReceivable',
      key: 'amountReceivable',
      width: 140,
      render: (v) => `¥${Number(v || 0).toLocaleString()}`
    },
    {
      title: '已收金额(元)',
      dataIndex: 'amountReceived',
      key: 'amountReceived',
      width: 140,
      render: (v) => `¥${Number(v || 0).toLocaleString()}`
    },
    {
      title: '未收金额(元)',
      key: 'amountUnreceived',
      width: 140,
      render: (_, record) => {
        const total = Number(record.amountReceivable || 0)
        const received = Number(record.amountReceived || 0)
        const un = Math.min(Math.max(total - received, 0), total)
        return `¥${Number(un || 0).toLocaleString()}`
      }
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => {
        const cfg = receivableStatusMap[status] || {}
        return <Tag color={cfg.color}>{cfg.text || status}</Tag>
      }
    },
    {
      title: '开票日期',
      dataIndex: 'invoiceDate',
      key: 'invoiceDate',
      width: 120
    },
    {
      title: '付款日期',
      dataIndex: 'paymentDate',
      key: 'paymentDate',
      width: 120
    },
    {
      title: '备注',
      key: 'paymentRemark',
      width: 80,
      render: (_, record) => {
        const key = record?.statementNo
        const remark = key && receivablePaymentMap && receivablePaymentMap[key]
          ? String(receivablePaymentMap[key]?.remark || '')
          : ''
        const hasRemark = remark.trim() !== ''
        const color = hasRemark ? 'red' : '#ccc'
        const flag = (
          <Button
            type="text"
            size="small"
            style={{ padding: 0, color, filter: hasRemark ? 'none' : 'grayscale(1)' }}
            onClick={() => {
              const usedKey = record?.statementNo
              const existing = usedKey && receivablePaymentMap ? receivablePaymentMap[usedKey] : undefined
              const nextText = existing && typeof existing === 'object' ? String(existing.remark || '') : ''
              setReceivableRemarkRecord(record || null)
              setReceivableRemarkText(nextText)
              setReceivableRemarkModalOpen(true)
            }}
          >
            🚩
          </Button>
        )
        if (!hasRemark) return flag
        return (
          <Tooltip title={remark}>
            {flag}
          </Tooltip>
        )
      }
    }
    ,
    {
      title: '编辑',
      key: 'actions',
      width: 80,
      render: (_, record) => (
        <Button
          type="link"
          onClick={() => openReceivableEditModal(record)}
          disabled={receivablePaymentMode || receivableInvoiceMode}
        >
          编辑
        </Button>
      )
    }
  ]

  const payableColumns = [
    {
      title: '供应商名称',
      dataIndex: 'supplierName',
      key: 'supplierName',
      width: 180
    },
    {
      title: '发票图片',
      key: 'invoiceImage',
      width: 200,
      render: (_, record) => {
        const url = record && record.invoiceImageUrl ? String(record.invoiceImageUrl) : ''
        return (
          <Space>
            {url ? (
              <Image
                src={url}
                width={48}
                height={48}
                style={{ objectFit: 'cover', borderRadius: 6 }}
              />
            ) : (
              <span style={{ color: '#9ca3af' }}>未上传</span>
            )}
            <Upload
              accept="image/*"
              showUploadList={false}
              beforeUpload={(file) => {
                void (async () => {
                  try {
                    message.open({ type: 'loading', content: '正在上传发票图片...', key: `payable_invoice_${record.key}`, duration: 0 })
                    const uploaded = await uploadPayableInvoiceImageFile(file)
                    const invoiceImageName = file?.name || ''
                    const invoiceImageFileId = uploaded?.fileID || ''
                    setPayableData((prev) => {
                      const list = Array.isArray(prev) ? prev : []
                      return list.map((it) => {
                        if (!it || it.key !== record.key) return it
                        return { ...it, invoiceImageUrl: uploaded?.url || '', invoiceImageFileId, invoiceImageName }
                      })
                    })
                    try {
                      if (!record?.key) return
                      await payableAPI.update(record.key, { invoiceImageFileId, invoiceImageName })
                      message.open({ type: 'success', content: '发票图片已保存到云端', key: `payable_invoice_${record.key}` })
                    } catch (e) {
                      const status = Number(e?.response?.status || 0)
                      if (status === 413) {
                        message.open({ type: 'error', content: '图片仍过大（413），请换更小图片或粘贴图片链接', key: `payable_invoice_${record.key}` })
                        return
                      }
                      message.open({ type: 'error', content: '发票图片保存失败', key: `payable_invoice_${record.key}` })
                    }
                  } catch (_) {
                    message.open({ type: 'error', content: '上传图片失败，请重试或改用粘贴图片链接', key: `payable_invoice_${record.key}` })
                  }
                })()
                return false
              }}
            >
              <Button size="small" icon={<UploadOutlined />}>
                上传
              </Button>
            </Upload>
          </Space>
        )
      }
    },
    {
      title: '应付金额(元)',
      dataIndex: 'amountPayable',
      key: 'amountPayable',
      width: 140,
      render: (v) => `¥${Number(v || 0).toLocaleString()}`
    },
    {
      title: '已付金额(元)',
      dataIndex: 'amountPaid',
      key: 'amountPaid',
      width: 140,
      render: (v) => `¥${Number(v || 0).toLocaleString()}`
    },
    {
      title: '未付金额(元)',
      key: 'amountUnpaid',
      width: 140,
      render: (_, record) => {
        const total = Number(record.amountPayable || 0)
        const paid = Number(record.amountPaid || 0)
        const un = total - paid
        return `¥${Number(un || 0).toLocaleString()}`
      }
    },
    {
      title: '到期时间',
      dataIndex: 'dueDate',
      key: 'dueDate',
      width: 120
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (status) => {
        const cfg = payableStatusMap[status] || {}
        return <Tag color={cfg.color}>{cfg.text || status}</Tag>
      }
    },
    {
      title: '付款时间',
      dataIndex: 'paymentDate',
      key: 'paymentDate',
      width: 120
    }
    ,
    {
      title: '编辑',
      key: 'actions',
      width: 80,
      render: (_, record) => (
        <Button
          type="link"
          onClick={() => openPayableEditModal(record)}
          disabled={payablePaymentMode}
        >
          编辑
        </Button>
      )
    }
  ]

  const dateFilteredProduction = filterByDateRange(productionData, productionDateRange)
  const filteredProduction = dateFilteredProduction.filter((item) => {
    const keyword = String(productionKeyword || '').trim().toLowerCase()
    if (!keyword) return true
    const source = `${item.orderNo || ''}${item.customerName || ''}${item.materialCode || ''}${item.productName || ''
      }${item.materialNo || ''}`.toLowerCase()
    return source.includes(keyword)
  })

  useEffect(() => {
    setProductionVisibleCount(40)
  }, [productionKeyword, productionDateRange, productionData.length])

  useEffect(() => {
    const wrap = productionTableWrapRef.current
    if (!wrap) return
    const body = wrap.querySelector('.ant-table-body')
    if (!body) return

    const onScroll = () => {
      const nearBottom = body.scrollTop + body.clientHeight >= body.scrollHeight - 48
      if (!nearBottom) return
      setProductionVisibleCount((prev) => Math.min(prev + 40, filteredProduction.length))
    }

    body.addEventListener('scroll', onScroll)
    return () => body.removeEventListener('scroll', onScroll)
  }, [filteredProduction.length])

  const visibleProduction = (filteredProduction || []).slice(0, productionVisibleCount)

  const productionRowSelection = undefined


  const groupedProduction = useMemo(() => {
    const list = Array.isArray(visibleProduction) ? visibleProduction : []
    const out = []
    const toNum = (v) => {
      const n = Number(v)
      if (Number.isFinite(n)) return n
      const m = String(v ?? '').match(/-?\\d+(\\.\\d+)?/)
      return m ? Number(m[0]) : 0
    }
    list.forEach((r) => {
      const items = Array.isArray(r?.items) ? r.items : []
      if (r?.sourceType === 'sales' && items.length > 1) {
        const totalQty = items.reduce((s, it) => s + Math.max(0, toNum(it?.quantity)), 0)
        const safeTotal = totalQty > 0 ? totalQty : items.length
        const orderAmount = toNum(r?.orderAmount)
        const orderRawCost = toNum(r?.rawMaterialCost)
        const children = items.map((it, idx) => {
          const qty = Math.max(0, toNum(it?.quantity))
          const weight = qty > 0 ? qty : 1
          const unitPrice = toNum(it?.unitPrice || r?.unitPrice)
          const amount = unitPrice > 0 && qty > 0
            ? unitPrice * qty
            : (orderAmount > 0 ? (orderAmount * weight) / safeTotal : 0)
          const rawUnit = toNum(it?.rawUnitPrice || it?.costPrice || it?.purchasePrice || r?.rawMaterialUnitPrice)
          const rawCost = rawUnit > 0 && qty > 0
            ? rawUnit * qty
            : (orderRawCost > 0 ? (orderRawCost * weight) / safeTotal : 0)
          const profit = amount - rawCost
          const margin = amount > 0 ? (profit / amount) * 100 : 0
          const name = it?.goodsName || it?.title || it?.productName || r?.productName || ''
          const child = {
            ...r,
            key: `${String(r?.key || r?.orderId || r?.orderNo || 'order')}_it_${idx + 1}`,
            __groupChild: true,
            __itemIndex: idx,
            orderNo: (r?.orderNo ? `${r.orderNo}-${idx + 1}` : r?.orderNo) || '',
            productName: name,
            quantity: qty,
            unitPrice: unitPrice,
            orderAmount: amount,
            rawMaterialUnitPrice: rawUnit,
            rawMaterialCost: rawCost,
            grossProfit: profit,
            grossMargin: margin
          }
          return child
        }).sort((a, b) => Number(a.__itemIndex) - Number(b.__itemIndex))
        const sumAmount = children.reduce((s, c) => s + toNum(c.orderAmount), 0)
        const sumCost = children.reduce((s, c) => s + toNum(c.rawMaterialCost), 0)
        const sumQty = children.reduce((s, c) => s + toNum(c.quantity), 0)
        const parent = {
          ...r,
          __groupParent: true,
          quantity: sumQty || r.quantity,
          orderAmount: sumAmount || r.orderAmount,
          rawMaterialCost: sumCost || r.rawMaterialCost,
          grossProfit: (sumAmount || r.orderAmount) - (sumCost || r.rawMaterialCost),
          grossMargin: (() => {
            const amt = sumAmount || toNum(r.orderAmount)
            const cost = sumCost || toNum(r.rawMaterialCost)
            if (amt > 0) return ((amt - cost) / amt) * 100
            return r.grossMargin
          })(),
          children
        }
        out.push(parent)
      } else {
        out.push(r)
      }
    })
    return out
  }, [visibleProduction])

  const dateFilteredStatements = filterByDateRange(statementOrders, dateRange)
  const filteredStatements = dateFilteredStatements.filter((item) => {
    // Auto-archive logic: Reconciled orders disappear on the 1st of the next month
    if (item.isReconciled) {
      const rDate = item.reconcileDate ? dayjs(item.reconcileDate) : null
      if (rDate && rDate.isValid()) {
        const cutoff = rDate.add(1, 'month').startOf('month')
        // If now >= cutoff, hide it
        if (dayjs().isSame(cutoff, 'day') || dayjs().isAfter(cutoff)) {
          return false
        }
      }
    }

    const keyword = String(statementKeyword || '').trim().toLowerCase()
    const customerFilter = statementCustomer
      ? String(statementCustomer).trim()
      : ''
    const keywordOk = (() => {
      if (!keyword) return true
      const source = `${item.orderNo || ''}${item.customerName || ''}${item.productName || ''}${item.materialNo || ''
        }`.toLowerCase()
      return source.includes(keyword)
    })()
    const customerOk = customerFilter
      ? String(item.customerName || '').trim() === customerFilter
      : true
    return keywordOk && customerOk
  })
  const filteredReceivables = filterByDateRange(receivableData, dateRange).filter((item) => {
    const keyword = String(receivableKeyword || '').trim().toLowerCase()
    const statusOk = receivableStatus ? item.status === receivableStatus : true
    if (!keyword) return statusOk
    const source = `${item.customerName || ''}${item.orderNo || ''}`.toLowerCase()
    return statusOk && source.includes(keyword)
  })

  // Data Cards Logic based on Year/Month Selectors
  const selectedYear = receivableYear
  const selectedMonth = receivableMonth // 1-12
  const selectedStart = dayjs(`${selectedYear}-${selectedMonth}-01`).startOf('month')
  const selectedEnd = selectedStart.endOf('month')

  const payableSelectedYear = payableYear
  const payableSelectedMonth = payableMonth
  const payableSelectedStart = dayjs(`${payableSelectedYear}-${payableSelectedMonth}-01`).startOf('month')
  const payableSelectedEnd = payableSelectedStart.endOf('month')

  const receivableStatBase = Array.isArray(receivableData) ? receivableData : []

  const receivableTotalDueThisMonth = receivableStatBase
    .filter((item) => {
      if (!item || !item.dueDate) return false
      const due = dayjs(item.dueDate)
      if (!due.isValid()) return false
      return due.year() === selectedYear && due.month() + 1 === selectedMonth
    })
    .reduce((sum, item) => {
      const total = Number(item.amountReceivable || 0)
      const received = Number(item.amountReceived || 0)
      const usedReceived = Math.min(Math.max(received, 0), total)
      const remaining = total - usedReceived
      return sum + remaining
    }, 0)

  const receivableTotalReceivedThisMonth = (() => {
    let sum = 0
    const map = receivablePaymentMap && typeof receivablePaymentMap === 'object' ? receivablePaymentMap : {}
    const keys = new Set(Object.keys(map || {}))

    Object.values(map || {}).forEach((rec) => {
      const history = Array.isArray(rec?.history) ? rec.history : []
      if (history.length > 0) {
        history.forEach((h) => {
          const d = dayjs(h?.date)
          if (!d.isValid()) return
          if (d.year() !== selectedYear || d.month() + 1 !== selectedMonth) return
          const amt = Number(h?.amount || 0)
          if (!Number.isFinite(amt) || amt <= 0) return
          sum += amt
        })
        return
      }

      const d = dayjs(rec?.lastPaymentDate)
      if (!d.isValid()) return
      if (d.year() !== selectedYear || d.month() + 1 !== selectedMonth) return
      const amt = Number(rec?.received || 0)
      if (!Number.isFinite(amt) || amt <= 0) return
      sum += amt
    })

    receivableStatBase.forEach((item) => {
      const key = String(item?.statementNo || item?.key || '')
      if (key && keys.has(key)) return
      const d = dayjs(item?.paymentDate)
      if (!d.isValid()) return
      if (d.year() !== selectedYear || d.month() + 1 !== selectedMonth) return
      const amt = Number(item?.amountReceived || 0)
      if (!Number.isFinite(amt) || amt <= 0) return
      sum += amt
    })

    return sum
  })()

  const receivableTotalOverdue = receivableStatBase
    .filter((item) => {
      if (!item || !item.dueDate) return false
      const due = dayjs(item.dueDate)
      if (!due.isValid()) return false
      return due.isBefore(selectedStart, 'day')
    })
    .reduce((sum, item) => {
      const total = Number(item.amountReceivable || 0)
      const received = Number(item.amountReceived || 0)
      const usedReceived = Math.min(Math.max(received, 0), total)
      const remaining = total - usedReceived
      return sum + remaining
    }, 0)

  const receivableTotalPending = receivableStatBase.reduce((sum, item) => {
    const total = Number(item?.amountReceivable || 0)
    const received = Number(item?.amountReceived || 0)
    const usedReceived = Math.min(Math.max(received, 0), total)
    const remaining = total - usedReceived
    return sum + remaining
  }, 0)

  const filteredPayables = payableData
    .filter((item) => {
      const keyword = String(payableKeyword || '').trim().toLowerCase()
      const statusOk = payableStatus ? item.status === payableStatus : true
      if (!keyword) return statusOk
      const source = `${item.supplierName || ''}`.toLowerCase()
      return statusOk && source.includes(keyword)
    })
    .filter((item) => {
      if (!item) return true
      const raw = item.invoiceDate || item.date
      if (!raw) return true
      const d = dayjs(raw)
      if (!d.isValid()) return true
      return d.isSameOrAfter(payableSelectedStart, 'day') && d.isSameOrBefore(payableSelectedEnd, 'day')
    })

  // 本月统计数据(不受日期筛选器影响)
  const now = dayjs()
  const monthStart = now.startOf('month')
  const monthEnd = now.endOf('month')

  const monthProduction = productionData.filter((item) => {
    if (!item) return false
    const ts = (() => {
      if (Number.isFinite(item.createdAtTs) && item.createdAtTs > 0) return item.createdAtTs
      if (item.date) {
        const t = dayjs(item.date).valueOf()
        return Number.isFinite(t) ? t : 0
      }
      return 0
    })()
    return ts >= monthStart.valueOf() && ts <= monthEnd.valueOf()
  })

  const monthTotalOrderAmount = monthProduction.reduce(
    (sum, item) => sum + Number(item.orderAmount || 0),
    0
  )
  const monthSalesOrderAmount = monthProduction.reduce(
    (sum, item) => sum + (String(item?.sourceType || '') === 'sales' ? Number(item.orderAmount || 0) : 0),
    0
  )
  const monthPurchaseGoodsOrderAmount = monthProduction.reduce(
    (sum, item) => sum + (String(item?.sourceType || '') === 'purchase' ? Number(item.orderAmount || 0) : 0),
    0
  )
  const monthTotalRawMaterialCost = monthProduction.reduce(
    (sum, item) => sum + Number(item?.rawMaterialCost || 0),
    0
  )

  const monthGrossProfit = monthTotalOrderAmount - monthTotalRawMaterialCost
  const monthGrossProfitRate =
    monthTotalOrderAmount > 0
      ? (monthGrossProfit / monthTotalOrderAmount) * 100
      : 0


  // 筛选结果统计数据(受日期筛选器影响)
  const productionTotalOrderAmount = filteredProduction.reduce(
    (sum, item) => sum + Number(item.orderAmount || 0),
    0
  )
  const productionTotalRawMaterialCost = filteredProduction.reduce(
    (sum, item) => sum + Number(item?.rawMaterialCost || 0),
    0
  )

  const productionGrossProfit = productionTotalOrderAmount - productionTotalRawMaterialCost
  const productionGrossMargin =
    productionTotalOrderAmount > 0
      ? (productionGrossProfit / productionTotalOrderAmount) * 100
      : 0

  // 动态选择显示数据:无筛选时显示本月,有筛选时显示筛选结果
  const hasDateFilter = productionDateRange && Array.isArray(productionDateRange) && productionDateRange.length === 2
  const displayOrderAmount = hasDateFilter ? productionTotalOrderAmount : monthTotalOrderAmount
  const displayRawMaterialCost = hasDateFilter ? productionTotalRawMaterialCost : monthTotalRawMaterialCost
  const displayGrossProfit = hasDateFilter ? productionGrossProfit : monthGrossProfit
  const displayGrossProfitRate = hasDateFilter ? productionGrossMargin : monthGrossProfitRate

  const statementRows = Array.isArray(statementOrders) ? statementOrders : []
  const statementNow = dayjs()
  const statementThisMonthPrefix = `QXDZD${statementNow.format('YYYYMM')}`

  const getStatementShipTs = (row) => {
    if (!row) return 0
    if (Number.isFinite(row.shippedAtTs) && row.shippedAtTs > 0) return row.shippedAtTs
    if (row.shipDate) {
      const t = dayjs(row.shipDate).valueOf()
      return Number.isFinite(t) ? t : 0
    }
    return 0
  }

  const shippedRowsThisMonth = statementRows.filter((row) => {
    if (!row || !row.hasShipped) return false
    const shipTs = getStatementShipTs(row)
    if (!shipTs) return false
    return dayjs(shipTs).isSame(statementNow, 'month')
  })

  const statementTotalShippedThisMonth = shippedRowsThisMonth.reduce(
    (sum, row) => sum + Number(row.amount || 0),
    0
  )

  const statementTotalMonthReconciled = statementRows
    .filter((row) => {
      const sn = String(row?.statementNo || '').trim()
      return sn && sn.startsWith(statementThisMonthPrefix)
    })
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)

  const statementTotalUnreconciled = shippedRowsThisMonth
    .filter((row) => !String(row?.statementNo || '').trim())
    .reduce((sum, row) => sum + Number(row.amount || 0), 0)

  const statementCountThisMonth = (() => {
    const uniqueStatements = new Set()
    statementRows.forEach((row) => {
      const sn = String(row?.statementNo || '').trim()
      if (sn && sn.startsWith(statementThisMonthPrefix)) uniqueStatements.add(sn)
    })
    return uniqueStatements.size
  })()


  const visibleStatements = filteredStatements.slice(0, statementPageSize)

  useEffect(() => {
    const base = filteredStatements.length || 0
    const initSize = base > 0 ? Math.min(20, base) : 0
    setStatementPageSize(initSize)
  }, [filteredStatements.length])

  const statementCustomerOptions = Array.from(
    new Set(
      (statementOrders || [])
        .map((item) => item.customerName)
        .filter((name) => !!name)
    )
  )

  const statementParentChildIndex = useMemo(
    () => buildStatementParentChildKeyMap(statementOrders),
    [statementOrders]
  )
  const statementParentChildKeys = statementParentChildIndex.parentChildKeyMap
  const statementOrderKeyByNo = statementParentChildIndex.orderKeyByNo
  const statementParentKeyByNo = statementParentChildIndex.parentKeyByNo

  const statementRowSelection = statementReconcileMode
    ? {
      selectedRowKeys: statementSelectedRowKeys,
      onChange: (keys, selectedRows) => {
        setStatementSelectedRowKeys((prev) => {
          const prevSet = new Set((prev || []).map(String).filter(Boolean))
          const nextSet = new Set(
            (keys || [])
              .map((k) => String(k ?? '').trim())
              .filter(Boolean)
          )

          const selected = Array.isArray(selectedRows) ? selectedRows : []
          if (!nextSet.size && selected.length) {
            selected.forEach((r) => {
              const rowKey = String(r?.key ?? '').trim()
              if (rowKey) nextSet.add(rowKey)
              const orderNo = String(r?.orderNo || '').trim()
              if (!orderNo) return
              const mapped = String(statementOrderKeyByNo?.get(orderNo) || '').trim()
              if (mapped) nextSet.add(mapped)
              const parentMapped = String(statementParentKeyByNo?.get(orderNo) || '').trim()
              if (parentMapped) nextSet.add(parentMapped)
              nextSet.add(orderNo)
              nextSet.add(`group:${orderNo}`)
            })
          }

          const removed = []
          prevSet.forEach((k) => {
            if (!nextSet.has(k)) removed.push(k)
          })

          const added = []
          nextSet.forEach((k) => {
            if (!prevSet.has(k)) added.push(k)
          })

          removed.forEach((k) => {
            const childKeys = statementParentChildKeys.get(k)
            if (childKeys && childKeys.length) childKeys.forEach((ck) => nextSet.delete(String(ck)))
          })

          added.forEach((k) => {
            const childKeys = statementParentChildKeys.get(k)
            if (childKeys && childKeys.length) childKeys.forEach((ck) => nextSet.add(String(ck)))
          })

          const expandedKeys = Array.from(nextSet)
          const normalizedKeys = []
          expandedKeys.forEach((k) => {
            const s = String(k ?? '').trim()
            if (!s) return
            if (s.startsWith('group:')) return
            const mapped = String(statementOrderKeyByNo?.get(s) || '').trim()
            normalizedKeys.push(mapped || s)
          })

          const normalizedSet = new Set(normalizedKeys)
          const rows = (statementOrders || []).filter((r) =>
            normalizedSet.has(String(r?.key ?? '').trim())
          )
          statementSelectedRowsRef.current = rows
          const customers = Array.from(new Set(rows.map((r) => r.customerName).filter((v) => !!v)))
          if (customers.length > 1) {
            const keptCustomer = customers[0]
            const keptKeys = rows
              .filter((r) => r.customerName === keptCustomer)
              .map((r) => String(r?.key ?? '').trim())
              .filter(Boolean)
            message.warning('对账单一次仅支持同一客户，请先筛选客户后勾选')
            return keptKeys
          }

          return normalizedKeys
        })
      }
    }
    : undefined

  const statementPreviewCustomerName =
    Array.isArray(statementPreviewRows) && statementPreviewRows.length
      ? statementPreviewRows[0].customerName || ''
      : ''
  const statementPreviewBaseRowsForCalc = statementEditRows.length ? statementEditRows : statementPreviewRows
  const statementPreviewDates = Array.isArray(statementPreviewBaseRowsForCalc)
    ? statementPreviewBaseRowsForCalc
      .map((r) => r.shipDate)
      .filter((d) => d)
      .map((d) => dayjs(d))
      .filter((d) => d.isValid())
    : []
  let statementPreviewPeriodText = ''
  if (statementPreviewDates.length) {
    const sorted = [...statementPreviewDates].sort((a, b) => a.valueOf() - b.valueOf())
    const start = sorted[0].format('YYYY-MM-DD')
    const end = sorted[sorted.length - 1].format('YYYY-MM-DD')
    statementPreviewPeriodText = `${start} 至 ${end}`
  }
  const statementPreviewToday = dayjs().format('YYYY-MM-DD')
  const statementPreviewStandardTotalAmount = Array.isArray(statementPreviewBaseRowsForCalc)
    ? statementPreviewBaseRowsForCalc.reduce((sum, item) => sum + calcRowAmount(item), 0)
    : 0

  const buildStatementDeliveryDetail = (rows) => {
    const vatRate = 0.13
    const list = Array.isArray(rows) ? rows : []
    const dateMap = new Map()
    list.forEach((r) => {
      const d = r && r.shipDate ? dayjs(r.shipDate) : null
      if (!d || !d.isValid()) return
      const key = d.format('YYYY-MM-DD')
      if (!dateMap.has(key)) {
        dateMap.set(key, { key, ts: d.startOf('day').valueOf(), title: d.format('M/D') })
      }
    })
    const dateCols = Array.from(dateMap.values()).sort((a, b) => a.ts - b.ts)

    const groups = new Map()
    list.forEach((r) => {
      const productName = String(r?.productName || '').trim()
      const spec = String(r?.spec || '').trim()
      const nameSpec = `${productName}${spec ? ` ${spec}` : ''}`.trim()
      if (!nameSpec) return
      const d = r && r.shipDate ? dayjs(r.shipDate) : null
      if (!d || !d.isValid()) return
      const dateKey = d.format('YYYY-MM-DD')
      const qty = Number(r?.quantity || 0)
      const unitPriceRaw = Number(r?.unitPrice || 0)

      const prev = groups.get(nameSpec) || {
        nameSpec,
        unitPrice: Number.isFinite(unitPriceRaw) && unitPriceRaw > 0 ? unitPriceRaw : 0,
        dateQty: {},
        totalQty: 0,
        amountExcl: 0
      }

      const nextQty = Number.isFinite(qty) ? qty : 0
      prev.totalQty += nextQty
      prev.dateQty[dateKey] = (prev.dateQty[dateKey] || 0) + nextQty

      const addAmount =
        Number.isFinite(unitPriceRaw) && unitPriceRaw > 0
          ? nextQty * unitPriceRaw
          : 0
      prev.amountExcl += Number.isFinite(addAmount) ? addAmount : 0

      if (!prev.unitPrice && Number.isFinite(unitPriceRaw) && unitPriceRaw > 0) {
        prev.unitPrice = unitPriceRaw
      }
      groups.set(nameSpec, prev)
    })

    const detailRows = Array.from(groups.values())
      .filter((g) => g.totalQty > 0 || g.amountExcl > 0)
      .sort((a, b) => a.nameSpec.localeCompare(b.nameSpec, 'zh-Hans-CN'))
      .map((g, idx) => {
        const amountExcl = Number((Number(g.amountExcl || 0)).toFixed(2))
        const vat = Number((amountExcl * vatRate).toFixed(2))
        const amountIncl = Number((amountExcl + vat).toFixed(2))
        const row = {
          key: `detail_${idx}`,
          seq: idx + 1,
          nameSpec: g.nameSpec,
          totalQty: Number(g.totalQty || 0),
          unitPrice: g.unitPrice ? Number(g.unitPrice) : '',
          amountExcl,
          vat,
          amountIncl
        }
        dateCols.forEach((c) => {
          const v = g.dateQty[c.key] || 0
          row[`d_${c.key}`] = v ? v : ''
        })
        return row
      })

    const summary = {
      key: 'summary',
      seq: '合计：',
      nameSpec: '',
      totalQty: detailRows.reduce((s, r) => s + Number(r.totalQty || 0), 0),
      unitPrice: '',
      amountExcl: Number(detailRows.reduce((s, r) => s + Number(r.amountExcl || 0), 0).toFixed(2)),
      vat: Number(detailRows.reduce((s, r) => s + Number(r.vat || 0), 0).toFixed(2)),
      amountIncl: Number(detailRows.reduce((s, r) => s + Number(r.amountIncl || 0), 0).toFixed(2)),
      isSummary: true
    }
    dateCols.forEach((c) => {
      const sum = detailRows.reduce((s, r) => s + Number(r[`d_${c.key}`] || 0), 0)
      summary[`d_${c.key}`] = sum ? sum : ''
    })

    const columns = [
      { title: '序号', dataIndex: 'seq', key: 'seq', width: 70 },
      { title: '品名规格', dataIndex: 'nameSpec', key: 'nameSpec', width: 260, ellipsis: true }
    ]
      .concat(dateCols.map((c) => ({
        title: c.title,
        dataIndex: `d_${c.key}`,
        key: `d_${c.key}`,
        width: 74
      })))
      .concat([
        { title: '数量', dataIndex: 'totalQty', key: 'totalQty', width: 90 },
        { title: '单价（不含税）', dataIndex: 'unitPrice', key: 'unitPrice', width: 130, render: (v) => (v === '' ? '' : Number(v || 0).toFixed(3)) },
        { title: '金额（不含税）', dataIndex: 'amountExcl', key: 'amountExcl', width: 140, render: (v) => (v ? `￥${Number(v || 0).toFixed(2)}` : '') },
        { title: '增值税', dataIndex: 'vat', key: 'vat', width: 120, render: (v) => (v ? `￥${Number(v || 0).toFixed(2)}` : '') },
        { title: '金额（含税）', dataIndex: 'amountIncl', key: 'amountIncl', width: 140, render: (v) => (v ? `￥${Number(v || 0).toFixed(2)}` : '') }
      ])

    const withSummary = detailRows.length ? detailRows.concat([summary]) : []
    return { dateCols, columns, dataSource: withSummary, summary }
  }

  const warnStatementLocked = () => {
    message.warning('当前对账单已锁定，不可修改')
  }

  const updateStatementEditRow = (rowKey, patch) => {
    if (statementEditLocked) {
      warnStatementLocked()
      return
    }
    const key = String(rowKey || '').trim()
    if (!key) return
    setStatementEditRows((prev) => {
      const base = Array.isArray(prev) ? prev : []
      return base.map((r) => (String(r?.key || '') === key ? { ...r, ...(patch || {}) } : r))
    })
  }

  const statementUnitOptions = (() => {
    const base = ['只', '张', '件', '箱', '套', '卷', 'kg', 'm', '㎡']
    const fromRows = (Array.isArray(statementEditRows) ? statementEditRows : [])
      .map((r) => String(r?.unit || '').trim())
      .filter(Boolean)
    const merged = Array.from(new Set(base.concat(fromRows)))
    return merged.map((v) => ({ value: v, label: v }))
  })()

  const statementPreviewColumnsStandard = [
    {
      title: '送货日期',
      dataIndex: 'shipDate',
      key: 'shipDate',
      width: 120,
      render: (_, record) => (
        <DatePicker
          value={record?.shipDate ? dayjs(record.shipDate) : null}
          onChange={(v) => updateStatementEditRow(record?.key, { shipDate: v && v.isValid() ? v.format('YYYY-MM-DD') : '' })}
          format="YYYY-MM-DD"
          allowClear
          disabled={statementEditLocked}
          style={{ width: '100%' }}
        />
      )
    },
    {
      title: '商品名称',
      dataIndex: 'productName',
      key: 'productName',
      width: 180,
      render: (_, record) => (
        <Input
          value={record?.productName || ''}
          onChange={(e) => updateStatementEditRow(record?.key, { productName: e.target.value })}
          placeholder="商品名称"
          disabled={statementEditLocked}
        />
      )
    },
    {
      title: '尺寸规格/MM',
      dataIndex: 'spec',
      key: 'spec',
      width: 160,
      render: (_, record) => (
        <Input
          value={record?.spec || ''}
          onChange={(e) => updateStatementEditRow(record?.key, { spec: e.target.value })}
          placeholder="例如 555×290×320"
          disabled={statementEditLocked}
        />
      )
    },
    {
      title: '送货数量',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 110,
      render: (_, record) => (
        <InputNumber
          value={record?.quantity === '' ? null : Number(record?.quantity || 0)}
          min={0}
          precision={0}
          onChange={(v) => updateStatementEditRow(record?.key, { quantity: v == null ? '' : Number(v) })}
          disabled={statementEditLocked}
          style={{ width: '100%' }}
        />
      )
    },
    {
      title: '单位',
      dataIndex: 'unit',
      key: 'unit',
      width: 90,
      render: (_, record) => (
        <Select
          value={record?.unit || '只'}
          options={statementUnitOptions}
          onChange={(v) => updateStatementEditRow(record?.key, { unit: v })}
          disabled={statementEditLocked}
          style={{ width: '100%' }}
        />
      )
    },
    {
      title: '单价',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: 110,
      render: (_, record) => (
        <InputNumber
          value={record?.unitPrice === '' ? null : Number(record?.unitPrice || 0)}
          min={0}
          precision={2}
          onChange={(v) => updateStatementEditRow(record?.key, { unitPrice: v == null ? '' : Number(v) })}
          disabled={statementEditLocked}
          style={{ width: '100%' }}
        />
      )
    },
    {
      title: '金额',
      key: 'amount',
      width: 120,
      render: (_, record) => {
        const val = calcRowAmount(record)
        return val ? val.toFixed(2) : ''
      }
    },
    {
      title: '备注',
      key: 'remark',
      width: 160,
      render: (_, record) => (
        <Input
          value={record?.remark || ''}
          onChange={(e) => updateStatementEditRow(record?.key, { remark: e.target.value })}
          placeholder="备注"
          disabled={statementEditLocked}
        />
      )
    }
  ]

  const statementPreviewColumnsStandardReadonly = [
    { title: '送货日期', dataIndex: 'shipDate', key: 'shipDate', width: 120 },
    { title: '商品名称', dataIndex: 'productName', key: 'productName', width: 180, ellipsis: true },
    { title: '尺寸规格/MM', dataIndex: 'spec', key: 'spec', width: 160, ellipsis: true },
    { title: '送货数量', dataIndex: 'quantity', key: 'quantity', width: 110 },
    { title: '单位', dataIndex: 'unit', key: 'unit', width: 90 },
    { title: '单价', dataIndex: 'unitPrice', key: 'unitPrice', width: 110, render: (v) => (v ? Number(v || 0).toFixed(2) : '') },
    { title: '金额', key: 'amount', width: 120, render: (_, record) => {
      const val = calcRowAmount(record)
      return val ? val.toFixed(2) : ''
    } },
    { title: '备注', key: 'remark', width: 160, render: (_, record) => record.remark || '' }
  ]

  const exportReconciliationExcelStandard = (rows) => {
    try {
      if (!Array.isArray(rows) || !rows.length) return
      const customerName = rows[0]?.customerName || '恒振朗环保净化科技（昆山）有限公司'
      const supplierName = '昆山群鑫包装科技有限公司'
      const supplierContact = '祝启鑫'
      const supplierPhone = '13817508995'
      const maker = '林群'
      const taxText = '含13%税'
      const today = dayjs().format('YYYY-MM-DD')

      const dates = rows
        .map((r) => r.shipDate)
        .filter((d) => d)
        .map((d) => dayjs(d))
        .filter((d) => d.isValid())

      let title = '对账单'
      let periodText = ''
      if (dates.length) {
        dates.sort((a, b) => a.valueOf() - b.valueOf())
        const start = dates[0]
        const end = dates[dates.length - 1]
        periodText = `${start.format('YYYY-MM-DD')} 至 ${end.format('YYYY-MM-DD')}`
      }
      title = `${dayjs().format('YYYY')}年${dayjs().format('MM')}月份对账单`

      const paymentTermRaw = rows.find((r) => r.paymentTerm)?.paymentTerm
      const paymentTermText = paymentTermRaw ? String(paymentTermRaw) : ''

      const headers = [
        '送货日期',
        '商品名称',
        '尺寸规格/MM',
        '送货数量',
        '单位',
        '单价',
        '金额',
        '备注'
      ]

      const dataRowsCount = rows.length
      const summaryRowNumber = 7 + dataRowsCount + 3

      const sheetData = []
      sheetData.push([title])
      sheetData.push([`采购单位：${customerName}`, '', '', '', `供货单位：${supplierName}`, '', '', ''])
      sheetData.push([`联系人：`, '', '', '', `联系人：${supplierContact}`, '', '', ''])
      sheetData.push([`电话：`, '', '', '', `电话：${supplierPhone}`, '', '', ''])
      sheetData.push([`结款方式：${paymentTermText}`, '', '', '', `税率：${taxText}`, '', '', ''])
      sheetData.push(headers)

      const dateToExcelSerial = (d) => {
        const base = Date.UTC(1899, 11, 30)
        const ts = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
        return (ts - base) / 86400000
      }

      const getShipDateSerial = (shipDate) => {
        const raw = String(shipDate || '').trim()
        if (!raw) return ''
        const parsed = dayjs(raw)
        if (!parsed.isValid()) return ''
        return dateToExcelSerial(parsed.toDate())
      }

      for (let i = 0; i < dataRowsCount; i += 1) {
        const item = rows[i]
        if (!item) {
          sheetData.push(['', '', '', '', '', '', '', ''])
          continue
        }
        const qtyRaw = item.quantity
        const unitPriceRaw = item.unitPrice
        const qtyNum =
          qtyRaw == null || qtyRaw === ''
            ? NaN
            : Number(qtyRaw)
        const unitPriceNum =
          unitPriceRaw == null || unitPriceRaw === ''
            ? NaN
            : Number(unitPriceRaw)
        const qtyCellVal = Number.isFinite(qtyNum) ? qtyNum : ''
        const unitPriceCellVal = Number.isFinite(unitPriceNum) ? unitPriceNum : ''
        sheetData.push([
          getShipDateSerial(item.shipDate),
          item.productName || '',
          item.spec || '',
          qtyCellVal,
          item.unit || '',
          unitPriceCellVal,
          '',
          item.remark || ''
        ])
      }

      // Add 3 blank rows
      for (let i = 0; i < 3; i++) {
        sheetData.push(['', '', '', '', '', '', '', ''])
      }

      sheetData.push([`制单人：${maker}`, '', `制表日期：${today}`, '', '合计金额：', '', '', ''])

      const ws = XLSX.utils.aoa_to_sheet(sheetData)

      const merges = [
        'A1:H1',
        'A2:D2',
        'E2:H2',
        'A3:D3',
        'E3:H3',
        'A4:D4',
        'E4:H4',
        'A5:D5',
        'E5:H5',
        `E${summaryRowNumber}:F${summaryRowNumber}`
      ]
      ws['!merges'] = merges.map((ref) => XLSX.utils.decode_range(ref))

      ws['!cols'] = [
        { wch: 16.25 },
        { wch: 23 },
        { wch: 19.25 },
        { wch: 9 },
        { wch: 9 },
        { wch: 9 },
        { wch: 10.125 },
        { wch: 9 }
      ]
      ws['!rows'] = ws['!rows'] || []
      ws['!rows'][0] = { hpt: 30 }
      for (let i = 1; i < summaryRowNumber - 1; i += 1) {
        ws['!rows'][i] = { hpt: 16.8 }
      }

      ws['!margins'] = {
        left: 0.75,
        right: 0.75,
        top: 1,
        bottom: 1,
        header: 0.5,
        footer: 0.5
      }

      for (let i = 0; i < dataRowsCount; i += 1) {
        const r = 7 + i
        const a = ws[`A${r}`]
        if (a && a.v !== '') {
          a.t = 'n'
          a.z = 'yyyy-mm-dd'
        }
        const f = ws[`F${r}`]
        if (f && f.v !== '') {
          f.t = 'n'
          f.z = '0.00'
        }
        const d = ws[`D${r}`]
        if (d && d.v !== '') {
          d.t = 'n'
        }
        const amountCell = `G${r}`
        const qtyVal = d && d.v !== '' ? Number(d.v) : NaN
        const unitPriceVal = f && f.v !== '' ? Number(f.v) : NaN
        const hasQty = d && d.v !== ''
        const hasUnitPrice = f && f.v !== ''
        if (hasQty && hasUnitPrice) {
          const v =
            Number.isFinite(qtyVal) && Number.isFinite(unitPriceVal)
              ? Number((qtyVal * unitPriceVal).toFixed(2))
              : 0
          ws[amountCell] = {
            t: 'n',
            f: `D${r}*F${r}`,
            v,
            z: '0.00'
          }
        }
      }

      const sumEnd = 7 + dataRowsCount - 1
      ws[`G${summaryRowNumber}`] = {
        t: 'n',
        f: `SUM(G7:G${sumEnd})`,
        z: '"¥"#,##0.00',
        s: {
          font: { bold: true },
          alignment: { horizontal: 'right', vertical: 'center' }
        }
      }

      const footerRowIndex = summaryRowNumber
      if (ws[`A${footerRowIndex}`]) {
        ws[`A${footerRowIndex}`].s = { alignment: { horizontal: 'left', vertical: 'center' } }
      }
      if (ws[`C${footerRowIndex}`]) {
        ws[`C${footerRowIndex}`].s = { alignment: { horizontal: 'center', vertical: 'center' } }
      }
      if (ws[`E${footerRowIndex}`]) {
        ws[`E${footerRowIndex}`].s = {
          font: { bold: true },
          alignment: { horizontal: 'right', vertical: 'center' }
        }
      }

      const titleCell = ws['A1']
      if (titleCell) {
        titleCell.s = {
          font: { sz: 16, bold: true, underline: true },
          alignment: { horizontal: 'center', vertical: 'center' }
        }
      }

      const infoRows = [2, 3, 4, 5]
      infoRows.forEach((rowNo) => {
        const leftCell = ws[`A${rowNo}`]
        if (leftCell) {
          leftCell.s = {
            alignment: { horizontal: 'left', vertical: 'center' }
          }
        }
        const rightCell = ws[`E${rowNo}`]
        if (rightCell) {
          rightCell.s = {
            alignment: { horizontal: 'left', vertical: 'center' }
          }
        }
      })

      for (let c = 0; c < headers.length; c += 1) {
        const cellRef = XLSX.utils.encode_cell({ r: 5, c })
        const cell = ws[cellRef]
        if (cell) {
          cell.s = {
            font: { bold: true },
            alignment: { horizontal: 'center', vertical: 'center' },
            border: {
              top: { style: 'thin', color: { rgb: '000000' } },
              bottom: { style: 'thin', color: { rgb: '000000' } },
              left: { style: 'thin', color: { rgb: '000000' } },
              right: { style: 'thin', color: { rgb: '000000' } }
            }
          }
        }
      }

      const wb = XLSX.utils.book_new()
      const sheetName = dates.length && dates[0].isValid() ? `${dates[0].format('M')}月份` : '对账单'
      XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31))
      const safeCustomer = String(customerName || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 32)
      const fileName = `${safeCustomer}-${title}.xlsx`
      XLSX.writeFile(wb, fileName)
    } catch (e) {
      message.error('导出对账单失败')
    }
  }

  const exportReconciliationExcelDeliveryDetail = (rows) => {
    try {
      if (!Array.isArray(rows) || !rows.length) return
      const { dateCols, dataSource, summary } = buildStatementDeliveryDetail(rows)
      const firstDate = dateCols.length ? dayjs(dateCols[0].key) : null
      const baseDate = firstDate && firstDate.isValid() ? firstDate : dayjs()
      const title = `${baseDate.format('YYYY')}年${baseDate.format('M')}月送货明细（太仓诚亮包装有限公司）`

      const headers = ['序号', '品名规格']
        .concat(dateCols.map((c) => c.title))
        .concat(['数量', '单价（不含税）', '金额（不含税）', '增值税', '金额（含税）'])

      const sheetData = []
      sheetData.push([title])
      sheetData.push(headers)

      const toNumber = (v) => {
        const n = Number(v)
        return Number.isFinite(n) ? n : 0
      }

        ; (dataSource || []).forEach((r) => {
          const row = []
          row.push(r.seq)
          row.push(r.nameSpec || '')
          dateCols.forEach((c) => {
            const v = r[`d_${c.key}`]
            const n = v === '' || v == null ? '' : toNumber(v)
            row.push(n === 0 ? '' : n)
          })
          row.push(r.totalQty === '' || r.totalQty == null ? '' : toNumber(r.totalQty))
          row.push(r.unitPrice === '' || r.unitPrice == null ? '' : toNumber(r.unitPrice))
          row.push(r.amountExcl === '' || r.amountExcl == null ? '' : toNumber(r.amountExcl))
          row.push(r.vat === '' || r.vat == null ? '' : toNumber(r.vat))
          row.push(r.amountIncl === '' || r.amountIncl == null ? '' : toNumber(r.amountIncl))
          sheetData.push(row)
        })

      if (!dataSource || !dataSource.length) {
        sheetData.push(['合计：', '', '', '', '', '', '', '', '', ''])
      } else if (!dataSource.some((r) => r && r.isSummary)) {
        const summaryRow = ['合计：', '']
        dateCols.forEach((c) => {
          const v = summary && summary[`d_${c.key}`]
          summaryRow.push(v === '' || v == null ? '' : toNumber(v))
        })
        summaryRow.push(toNumber(summary?.totalQty))
        summaryRow.push('')
        summaryRow.push(toNumber(summary?.amountExcl))
        summaryRow.push(toNumber(summary?.vat))
        summaryRow.push(toNumber(summary?.amountIncl))
        sheetData.push(summaryRow)
      }

      const ws = XLSX.utils.aoa_to_sheet(sheetData)
      const endCol = XLSX.utils.encode_col(headers.length - 1)
      ws['!merges'] = [XLSX.utils.decode_range(`A1:${endCol}1`)]
      ws['!cols'] = headers.map((h, idx) => {
        if (idx === 1) return { wch: 36 }
        if (idx === 0) return { wch: 8 }
        if (idx >= 2 && idx < 2 + dateCols.length) return { wch: 10 }
        if (h.includes('单价')) return { wch: 16 }
        return { wch: 16 }
      })

      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, '送货明细'.slice(0, 31))
      const safeCustomer = String(rows[0]?.customerName || '').replace(/[\\/:*?"<>|]/g, '').slice(0, 32)
      const fileName = `${safeCustomer}-${baseDate.format('YYYYMM')}-送货明细.xlsx`
      XLSX.writeFile(wb, fileName)
    } catch (e) {
      message.error('导出对账单失败')
    }
  }

  const statementPreviewDeliveryDetailModel =
    statementPreviewTemplate === 'deliveryDetail'
      ? buildStatementDeliveryDetail(statementPreviewRows)
      : null

  const statementPreviewLocked = statementPreviewTemplate === 'standard' && statementEditLocked

  const statementPreviewColumns =
    statementPreviewTemplate === 'deliveryDetail'
      ? (statementPreviewDeliveryDetailModel?.columns || [])
      : (statementPreviewLocked ? statementPreviewColumnsStandardReadonly : statementPreviewColumnsStandard)

  const statementPreviewDataSource =
    statementPreviewTemplate === 'deliveryDetail'
      ? (statementPreviewDeliveryDetailModel?.dataSource || [])
      : (statementEditRows.length ? statementEditRows : statementPreviewRows)

  const statementPreviewTotalAmount =
    statementPreviewTemplate === 'deliveryDetail'
      ? Number(statementPreviewDeliveryDetailModel?.summary?.amountIncl || 0)
      : statementPreviewStandardTotalAmount

  const exportReconciliationExcel = (rows) => {
    if (statementPreviewTemplate === 'deliveryDetail') {
      exportReconciliationExcelDeliveryDetail(rows)
      return
    }
    exportReconciliationExcelStandard(rows)
  }

  const handleStatementGenerate = () => {
    if (!statementReconcileMode) {
      setStatementReconcileMode(true)
      setStatementSelectedRowKeys([])
      return
    }
    const fallbackSelectedRows = Array.isArray(statementSelectedRowsRef.current)
      ? statementSelectedRowsRef.current
      : []
    const baseKeys = (statementSelectedRowKeys && statementSelectedRowKeys.length)
      ? statementSelectedRowKeys
      : fallbackSelectedRows.map((r) => String(r?.key ?? '').trim()).filter(Boolean)

    if (!baseKeys.length) {
      modal.warning({
        title: '提示',
        content: '请先勾选要生成对账单的订单'
      })
      return
    }
    const expandedKeys = expandStatementKeys(baseKeys, statementParentChildKeys, statementOrderKeyByNo)
    const expandedSet = new Set((expandedKeys || []).map((k) => String(k ?? '').trim()).filter(Boolean))
    const selected = (statementOrders || []).filter((item) =>
      expandedSet.has(String(item?.key ?? '').trim())
    )
    if (!selected.length) {
      modal.warning({
        title: '提示',
        content: '勾选的订单未能解析，请刷新列表后重试'
      })
      return
    }
    setStatementPreviewRows(selected)
    setStatementPreviewVisible(true)
  }

  const executeReconciliation = (rows) => {
    const validated = validateStatementEditRows(rows)
    if (!validated.ok) {
      message.warning(validated.message)
      return
    }
    const rowsForSave = withCalculatedStatementAmounts(rows)
    modal.confirm({
      title: '确认对账',
      content: `确认将选中的 ${rows.length} 条订单标记为已对账？`,
      okText: '确认',
      cancelText: '取消',
      onOk: async () => {
        setStatementReconcileLoading(true)
        try {
          const now = new Date()
          const dateStr = dayjs(now).format('YYYYMMDD')
          const prefix = `QXDZD${dateStr}`

          const existing = statementOrders
            .map(o => o.statementNo)
            .filter(n => n && n.startsWith(prefix))

          let maxSeq = 0
          existing.forEach(n => {
            const seqStr = n.slice(prefix.length)
            const seq = parseInt(seqStr, 10)
            if (!isNaN(seq) && seq > maxSeq) maxSeq = seq
          })

          const newSeq = maxSeq + 1
          const statementNo = `${prefix}${String(newSeq).padStart(3, '0')}`

          const customer = String(rowsForSave?.[0]?.customerName || '').trim() || statementPreviewCustomerName || ''
          const paymentTerm = String(statementPreviewRows.find(r => r.paymentTerm)?.paymentTerm || '').trim()
          const period = dayjs(now).format('YYYY-MM')

          const tasks = rowsForSave
            .map((item) => item.orderId)
            .filter((id) => id != null)
            .map((id) => cachedOrderAPI.updateOrder(id, {
              reconciledAt: now.toISOString(),
              statementNo
            }))
          try {
            if (tasks.length) await Promise.all(tasks)
            const saved = await statementAPI.upsertStatement({
              customer,
              period,
              statementNo,
              rows: rowsForSave,
              final: true,
              meta: { template: statementPreviewTemplate, paymentTerm, reconcileDate: dayjs(now).format('YYYY-MM-DD'), source: 'reconcile' }
            })
            requireStatementApiSuccess(saved, '对账失败')
          } catch (e) {
            const serverMsg = e?.response?.data?.message || e?.response?.data?.error
            message.error(serverMsg || e?.message || '对账失败')
            return
          }
          setStatementPreviewRows(rowsForSave)
          setStatementPreviewVisible(false)
          setStatementReconcileMode(false)
          setStatementSelectedRowKeys([])
          await loadProductionData()
          message.success(`对账成功，生成的对账单号：${statementNo}`)
        } finally {
          setStatementReconcileLoading(false)
        }
      }
    })
  }

  const handleStatementReconcile = () => {
    if (!statementReconcileMode) {
      setStatementReconcileMode(true)
      setStatementSelectedRowKeys([])
      return
    }
    // Only used to enter mode now
  }

  const receivableTotalReceivable = filteredReceivables.reduce(
    (sum, item) => sum + Number(item.amountReceivable || 0),
    0
  )
  const receivableTotalReceived = filteredReceivables.reduce(
    (sum, item) => sum + Number(item.amountReceived || 0),
    0
  )
  const receivableTotalUnreceived = receivableTotalReceivable - receivableTotalReceived

  const payableTotalPayable = filteredPayables
    .filter(item => item.status !== 'paid')
    .reduce((sum, item) => sum + Number(item.amountPayable || 0), 0)

  const payableTotalPaid = filteredPayables.reduce(
    (sum, item) => sum + Number(item.amountPaid || 0),
    0
  )

  const payableTotalDueToPay = filteredPayables
    .filter((item) => {
      if (item.status === 'paid') return false
      if (!item.dueDate) return false
      const d = dayjs(item.dueDate)
      if (!d.isValid()) return false
      return d.year() === payableSelectedYear && (d.month() + 1) === payableSelectedMonth
    })
    .reduce((sum, item) => {
      const total = Number(item.amountPayable || 0)
      const paid = Number(item.amountPaid || 0)
      const diff = total - paid
      return sum + (diff > 0 ? diff : 0)
    }, 0)

  const payableTotalUnpaid = filteredPayables
    .filter(item => item.status !== 'paid')
    .reduce((sum, item) => {
      const total = Number(item.amountPayable || 0)
      const paid = Number(item.amountPaid || 0)
      const diff = total - paid
      return sum + (diff > 0 ? diff : 0)
    }, 0)

  const materialOptions = Array.from(
    new Map(
      dateFilteredProduction
        .map((item) => item.materialCode || item.materialNo || '')
        .map((raw) => String(raw || '').trim())
        .filter((code) => {
          if (!code) return false
          const isSizePattern = /^[0-9.\s]+[×x*][0-9.\s]+(mm)?$/i.test(code)
          return !isSizePattern
        })
        .map((code) => {
          const referenceDate =
            Array.isArray(productionDateRange) && productionDateRange[0]
              ? productionDateRange[0]
              : undefined
          const price = getOverridePrice(code, referenceDate)
          const val = Number(price || 0)
          const hasPrice = Number.isFinite(val) && val > 0
          const label = hasPrice
            ? `${code}（已设置:${val.toFixed(2)}）`
            : code
          return [code, { value: code, label }]
        })
    ).values()
  )

  // Payment Handling
  const handleInvoice = async () => {
    if (receivableSelectedRowKeys.length < 1) {
      message.warning('请选择对账单进行开票')
      return
    }
    const statementNos = receivableSelectedRowKeys

    try {
      setStatementLoading(true)
      const invoicedAt = new Date().toISOString()
      const updates = statementNos.flatMap((statementNo) => {
        const targetOrders = statementOrders.filter(o => o.statementNo === statementNo)
        return targetOrders.map((o) => {
          if (!o.orderId) return Promise.resolve()
          return cachedOrderAPI.updateOrder(o.orderId, { invoicedAt })
        })
      })

      await Promise.all(updates)
      message.success('开票操作完成，开票时间已更新')
      setReceivableInvoiceMode(false)
      setReceivableSelectedRowKeys([])
      await loadProductionData()
    } catch (error) {
      console.error(error)
      message.error('开票操作失败')
    } finally {
      setStatementLoading(false)
    }
  }

  const openPayableCreateModal = () => {
    setPayableFormSupplierName('')
    setPayableFormInvoiceYear(payableYear)
    setPayableFormInvoiceMonth(payableMonth)
    setPayableFormAmountPayable(null)
    setPayableFormPaymentTerm('现付')
    setPayableFormInvoiceImageUrlText('')
    setPayableFormInvoiceImageDataUrl('')
    setPayableFormInvoiceImageFileId('')
    setPayableFormInvoiceImageName('')
    setPayableCreateModalOpen(true)
  }

  const handlePayableFormImagePaste = (e) => {
    const items = e?.clipboardData?.items
    if (!items || !items.length) return
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i]
      const type = String(item?.type || '')
      if (!type.startsWith('image/')) continue
      const file = item.getAsFile ? item.getAsFile() : null
      if (!file) continue
      void (async () => {
        try {
          message.open({ type: 'loading', content: '正在上传发票图片...', key: 'payable_invoice_upload', duration: 0 })
          const uploaded = await uploadPayableInvoiceImageFile(file)
          setPayableFormInvoiceImageDataUrl(uploaded?.url || '')
          setPayableFormInvoiceImageUrlText('')
          setPayableFormInvoiceImageFileId(uploaded?.fileID || '')
          setPayableFormInvoiceImageName(file?.name || 'clipboard.png')
          message.open({ type: 'success', content: '发票图片已上传', key: 'payable_invoice_upload' })
        } catch (_) {
          setPayableFormInvoiceImageDataUrl('')
          setPayableFormInvoiceImageFileId('')
          setPayableFormInvoiceImageName('')
          message.open({ type: 'error', content: '上传剪贴板图片失败', key: 'payable_invoice_upload' })
        }
      })()
      e.preventDefault()
      return
    }
  }

  const handleCreatePayable = () => {
    if (!isAuthenticated) {
      message.warning('请先登录再新建应付款')
      return
    }
    const supplierName = String(payableFormSupplierName || '').trim()
    if (!supplierName) {
      message.warning('请输入供应商名称')
      return
    }
    const year = Number(payableFormInvoiceYear)
    const month = Number(payableFormInvoiceMonth)
    if (!Number.isFinite(year) || !Number.isFinite(month) || month < 1 || month > 12) {
      message.warning('请选择收票时间')
      return
    }
    const amountPayable = Number(payableFormAmountPayable)
    if (!Number.isFinite(amountPayable) || amountPayable <= 0) {
      message.warning('请输入应付金额')
      return
    }
    const paymentTerm = String(payableFormPaymentTerm || '').trim()
    if (!paymentTerm) {
      message.warning('请选择付款账期')
      return
    }

    const invoiceDate = dayjs(`${year}-${String(month).padStart(2, '0')}-01`).startOf('month')
    const dueDate = (() => {
      if (!invoiceDate.isValid()) return ''
      if (paymentTerm === '现付') return invoiceDate.format('YYYY-MM-DD')
      const match = paymentTerm.match(/月结(\d+)天/)
      const days = match ? Number(match[1]) : 0
      if (!Number.isFinite(days) || days <= 0) return invoiceDate.format('YYYY-MM-DD')
      return invoiceDate.add(1, 'month').startOf('month').add(days, 'day').format('YYYY-MM-DD')
    })()

    const createdKey = `payable_${Date.now()}_${Math.random().toString(16).slice(2)}`
    const invoiceImageFileId = String(payableFormInvoiceImageFileId || '').trim()
    const invoiceImageUrlText = String(payableFormInvoiceImageUrlText || '').trim()
    const invoiceImageUrl = invoiceImageFileId ? '' : invoiceImageUrlText
    const invoiceImageName = String(payableFormInvoiceImageName || '').trim()

    const record = {
      key: createdKey,
      supplierName,
      invoiceDate: invoiceDate.isValid() ? invoiceDate.format('YYYY-MM-DD') : '',
      amountPayable,
      amountPaid: 0,
      dueDate,
      status: 'pending',
      paymentDate: '',
      paymentTerm,
      invoiceImageUrl,
      invoiceImageFileId,
      invoiceImageName
    }

    message.open({ type: 'loading', content: '正在保存应付款...', key: 'payable_create', duration: 0 })
    void (async () => {
      try {
        const created = await payableAPI.create(record)
        if (!created || !created.key) {
          throw new Error('应付款创建失败')
        }
        setPayableData((prev) => {
          const list = Array.isArray(prev) ? prev : []
          return [{ ...record, ...created }, ...list]
        })
        setPayableCreateModalOpen(false)
        message.open({ type: 'success', content: '已添加应付款', key: 'payable_create' })
      } catch (e) {
        const status = Number(e?.response?.status || 0)
        if (status === 413) {
          message.open({ type: 'error', content: '请求数据过大（413），请删除/压缩发票图片或改用粘贴图片链接', key: 'payable_create' })
          return
        }
        if (status === 401) {
          message.open({ type: 'error', content: '登录已失效或无权限，请重新登录后再试', key: 'payable_create' })
          return
        }
        const resp = e?.response?.data
        const serverMessage = typeof resp?.message === 'string' ? resp.message : ''
        const serverError = typeof resp?.error === 'string' ? resp.error : ''
        const msg = serverError || serverMessage || (e?.message ? String(e.message) : '') || '新增应付款失败'
        message.open({ type: 'error', content: msg, key: 'payable_create' })
      }
    })()
  }

  const startPayablePaymentMode = () => {
    setPayablePaymentMode(true)
    setPayablePaySelectedKeys([])
  }

  const cancelPayablePaymentMode = () => {
    setPayablePaymentMode(false)
    setPayablePaySelectedKeys([])
  }

  const openPayablePayModal = (record) => {
    setPayablePayRecord(record || null)
    setPayablePayAmount(null)
    setPayablePayRemark('')
    setPayablePayModalOpen(true)
  }

  const confirmPayablePaymentFromList = () => {
    if (payablePaySelectedKeys.length !== 1) {
      message.warning('请选择一条待付款项进行付款')
      return
    }
    const picked = filteredPayables.find((r) => r && r.key === payablePaySelectedKeys[0])
    if (!picked) {
      message.warning('未找到待付款项')
      return
    }
    if (picked.status === 'paid') {
      message.warning('该记录已付清')
      return
    }
    openPayablePayModal(picked)
  }

  const handlePayablePayConfirm = () => {
    if (!payablePayRecord) return
    const amount = Number(payablePayAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      message.warning('请输入有效付款金额')
      return
    }
    const total = Number(payablePayRecord.amountPayable || 0)
    const prevPaid = Number(payablePayRecord.amountPaid || 0)
    const remaining = total - prevPaid
    if (remaining <= 0) {
      message.warning('该记录已付清')
      return
    }
    if (amount > remaining) {
      message.warning('付款金额不能超过未付金额')
      return
    }

    const nextPaid = prevPaid + amount
    const nextStatus = nextPaid >= total ? 'paid' : 'partial'
    const nowDate = dayjs().format('YYYY-MM-DD')
    const nowTs = dayjs().format('YYYY-MM-DD HH:mm:ss')
    const remark = String(payablePayRemark || '').trim()
    const prevHistory = Array.isArray(payablePayRecord.paymentHistory) ? payablePayRecord.paymentHistory : []
    const nextHistory = [
      ...prevHistory,
      { date: nowTs, amount, remark }
    ]

    setPayableData((prev) => {
      const list = Array.isArray(prev) ? prev : []
      const next = list.map((it) => {
        if (!it || it.key !== payablePayRecord.key) return it
        const history = Array.isArray(it.paymentHistory) ? it.paymentHistory : []
        const mergedHistory = [
          ...history,
          { date: nowTs, amount, remark }
        ]
        return {
          ...it,
          amountPaid: nextPaid,
          status: nextStatus,
          paymentDate: nowDate,
          paymentRemark: remark,
          paymentHistory: mergedHistory
        }
      })
      return next
    })

    void (async () => {
      try {
        if (!payablePayRecord.key) return
        await payableAPI.update(payablePayRecord.key, {
          amountPaid: nextPaid,
          status: nextStatus,
          paymentDate: nowDate,
          paymentRemark: remark,
          paymentHistory: nextHistory
        })
      } catch (e) {
        console.error(e)
      }
    })()

    setPayablePayModalOpen(false)
    setPayablePayRecord(null)
    setPayablePayAmount(null)
    setPayablePayRemark('')
    setPayablePaySelectedKeys([])
    message.success(nextStatus === 'paid' ? '付款完成（已付清）' : '付款完成（部分付款）')
  }

  const handlePayment = () => {
    if (!receivablePaymentRecord) return

    const amount = Number(receivablePaymentAmount)
    if (!amount || amount <= 0) {
      message.error('请输入有效金额')
      return
    }

    const key = receivablePaymentRecord.statementNo
    const prev = receivablePaymentMap[key] || { received: 0, history: [] }
    const newReceived = (prev.received || 0) + amount

    const newRecord = {
      received: newReceived,
      lastPaymentDate: dayjs().format('YYYY-MM-DD'),
      remark: prev && typeof prev === 'object' ? String(prev.remark || '') : '',
      history: [
        ...(prev.history || []),
        { date: dayjs().format('YYYY-MM-DD HH:mm:ss'), amount }
      ]
    }

    const newMap = { ...receivablePaymentMap, [key]: newRecord }
    setReceivablePaymentMap(newMap)
    window.localStorage.setItem(receivablePaymentMapStorageKey, JSON.stringify(newMap))

    const totalReceivable = Number(receivablePaymentRecord.amountReceivable || 0)
    const newStatus = newReceived >= totalReceivable ? 'paid' : 'partial'
    const statusText = newStatus === 'paid' ? '已回款' : '部分回款'

    message.success(`回款记录已更新，当前状态：${statusText}`)
    setReceivablePaymentModalVisible(false)
    setReceivablePaymentRecord(null)
    setReceivablePaymentAmount(null)
  }

  const handleReceivableRemarkSubmit = () => {
    if (!receivableRemarkRecord) {
      setReceivableRemarkModalOpen(false)
      setReceivableRemarkText('')
      return
    }
    const key = String(receivableRemarkRecord.statementNo || '')
    if (!key) {
      message.warning('缺少对账单号')
      return
    }
    const remark = String(receivableRemarkText || '').trim()
    const prev = receivablePaymentMap && receivablePaymentMap[key] && typeof receivablePaymentMap[key] === 'object'
      ? receivablePaymentMap[key]
      : undefined
    const seed = prev
      ? prev
      : {
        received: Number(receivableRemarkRecord.amountReceived || 0),
        lastPaymentDate: String(receivableRemarkRecord.paymentDate || ''),
        history: []
      }
    const nextRecord = {
      ...seed,
      remark
    }
    const nextMap = { ...(receivablePaymentMap || {}), [key]: nextRecord }
    setReceivablePaymentMap(nextMap)
    try {
      window.localStorage.setItem(receivablePaymentMapStorageKey, JSON.stringify(nextMap))
    } catch (e) {
      console.error(e)
    }
    setReceivableRemarkModalOpen(false)
    setReceivableRemarkRecord(null)
    setReceivableRemarkText('')
    message.success('备注已保存')
  }

  const openReceivableEditModal = (record) => {
    const used = record || null
    if (!used) return
    setReceivableEditRecord(used)

    const sn = String(used.statementNo || '')
    const override = sn && receivableStatementOverrideMap && typeof receivableStatementOverrideMap === 'object'
      ? receivableStatementOverrideMap[sn]
      : undefined

    const dueRaw = (override && override.dueDate) ? String(override.dueDate || '') : String(used.dueDate || '')
    const invoiceRaw = (override && override.invoiceDate) ? String(override.invoiceDate || '') : String(used.invoiceDate || '')

    setReceivableEditDueDate(dueRaw && dayjs(dueRaw).isValid() ? dayjs(dueRaw) : null)
    setReceivableEditInvoiceDate(invoiceRaw && dayjs(invoiceRaw).isValid() ? dayjs(invoiceRaw) : null)

    const local = sn && receivablePaymentMap && typeof receivablePaymentMap === 'object'
      ? receivablePaymentMap[sn]
      : undefined
    const received = local && typeof local === 'object'
      ? Number(local.received || 0)
      : Number(used.amountReceived || 0)
    setReceivableEditAmountReceived(Number.isFinite(received) ? received : 0)

    const payDateRaw = local && typeof local === 'object' && local.lastPaymentDate
      ? String(local.lastPaymentDate || '')
      : String(used.paymentDate || '')
    setReceivableEditPaymentDate(payDateRaw && dayjs(payDateRaw).isValid() ? dayjs(payDateRaw) : null)

    const remark = local && typeof local === 'object' ? String(local.remark || '') : ''
    setReceivableEditRemark(remark)

    setReceivableEditModalOpen(true)
  }

  const closeReceivableEditModal = () => {
    setReceivableEditModalOpen(false)
    setReceivableEditRecord(null)
    setReceivableEditDueDate(null)
    setReceivableEditInvoiceDate(null)
    setReceivableEditPaymentDate(null)
    setReceivableEditAmountReceived(null)
    setReceivableEditRemark('')
  }

  const handleReceivableEditSubmit = () => {
    if (!receivableEditRecord) {
      setReceivableEditModalOpen(false)
      return
    }
    const key = String(receivableEditRecord.statementNo || '')
    if (!key) {
      message.warning('缺少对账单号')
      return
    }

    const nextOverride = { ...(receivableStatementOverrideMap || {}) }
    const existing = nextOverride[key] && typeof nextOverride[key] === 'object' ? nextOverride[key] : {}
    const due = receivableEditDueDate && dayjs(receivableEditDueDate).isValid()
      ? dayjs(receivableEditDueDate).format('YYYY-MM-DD')
      : ''
    const invoice = receivableEditInvoiceDate && dayjs(receivableEditInvoiceDate).isValid()
      ? dayjs(receivableEditInvoiceDate).format('YYYY-MM-DD')
      : ''
    const merged = { ...existing }
    if (due) merged.dueDate = due
    else delete merged.dueDate
    if (invoice) merged.invoiceDate = invoice
    else delete merged.invoiceDate

    const hasAny = Object.keys(merged).length > 0
    if (hasAny) nextOverride[key] = merged
    else delete nextOverride[key]

    setReceivableStatementOverrideMap(nextOverride)
    try {
      window.localStorage.setItem(receivableStatementOverrideMapStorageKey, JSON.stringify(nextOverride))
    } catch (e) {
      console.error(e)
    }

    const amountReceived = Number(receivableEditAmountReceived)
    if (!Number.isFinite(amountReceived) || amountReceived < 0) {
      message.warning('已收金额不合法')
      return
    }
    const payDate = receivableEditPaymentDate && dayjs(receivableEditPaymentDate).isValid()
      ? dayjs(receivableEditPaymentDate).format('YYYY-MM-DD')
      : ''
    const remark = String(receivableEditRemark || '').trim()

    setReceivablePaymentMap((prev) => {
      const base = prev && typeof prev === 'object' ? prev : {}
      const next = { ...base }
      next[key] = {
        received: amountReceived,
        lastPaymentDate: payDate,
        remark,
        history: []
      }
      try {
        window.localStorage.setItem(receivablePaymentMapStorageKey, JSON.stringify(next))
      } catch (e) {
        console.error(e)
      }
      return next
    })

    closeReceivableEditModal()
    message.success('已更新应收记录')
  }

  const doVoidStatements = async (statementNos) => {
    const eligible = Array.isArray(statementNos)
      ? statementNos.map((sn) => String(sn || '')).filter(Boolean)
      : []
    if (!eligible.length) return
    setReceivableVoidLoading(true)
    try {
      const updates = eligible.flatMap((statementNo) => {
        const rows = statementOrders.filter((o) => String(o?.statementNo || '') === statementNo)
        return rows.map((o) => {
          if (!o?.orderId) return Promise.resolve()
          return cachedOrderAPI.updateOrder(o.orderId, {
            reconciledAt: null,
            statementNo: null,
            invoicedAt: null
          })
        })
      })
      await Promise.all(updates)

      setReceivablePaymentMap((prev) => {
        const base = prev && typeof prev === 'object' ? prev : {}
        const next = { ...base }
        eligible.forEach((sn) => {
          delete next[sn]
        })
        try {
          window.localStorage.setItem(receivablePaymentMapStorageKey, JSON.stringify(next))
        } catch (e) {
          console.error(e)
        }
        return next
      })

      setReceivableStatementOverrideMap((prev) => {
        const base = prev && typeof prev === 'object' ? prev : {}
        const next = { ...base }
        eligible.forEach((sn) => {
          delete next[sn]
        })
        try {
          window.localStorage.setItem(receivableStatementOverrideMapStorageKey, JSON.stringify(next))
        } catch (e) {
          console.error(e)
        }
        return next
      })

      message.success('对账单已作废')
      setReceivableInvoiceMode(false)
      setReceivableSelectedRowKeys([])
      await loadProductionData()
    } catch (e) {
      console.error(e)
      message.error('作废失败')
    } finally {
      setReceivableVoidLoading(false)
    }
  }

  const handleVoidStatementFromEdit = () => {
    const sn = String(receivableEditRecord?.statementNo || '')
    if (!sn) {
      message.warning('缺少对账单号')
      return
    }
    const receivedRaw = Number.isFinite(Number(receivableEditAmountReceived))
      ? Number(receivableEditAmountReceived)
      : Number(receivableEditRecord?.amountReceived || 0)
    const received = Number.isFinite(receivedRaw) ? receivedRaw : 0
    if (received > 0) {
      modal.warning({
        title: '无法作废',
        content: '该对账单已存在回款记录'
      })
      return
    }
    modal.confirm({
      title: '确认作废对账单',
      okText: '确认作废',
      cancelText: '取消',
      okButtonProps: { danger: true },
      content: (
        <div>
          <div>将作废对账单：</div>
          <div style={{ marginTop: 8, color: '#111827' }}>{sn}</div>
          <div style={{ marginTop: 8, color: '#6b7280' }}>
            作废后，对应订单将回到“待对账”，对账单号与开票时间将被清除。
          </div>
        </div>
      ),
      onOk: async () => {
        await doVoidStatements([sn])
        closeReceivableEditModal()
      }
    })
  }

  const doVoidInvoiceByStatementNo = async (statementNo) => {
    const sn = String(statementNo || '').trim()
    if (!sn) return
    setReceivableVoidLoading(true)
    try {
      const rows = statementOrders.filter((o) => String(o?.statementNo || '') === sn)
      const updates = rows.map((o) => {
        if (!o?.orderId) return Promise.resolve()
        return cachedOrderAPI.updateOrder(o.orderId, { invoicedAt: null })
      })
      await Promise.all(updates)

      setReceivableStatementOverrideMap((prev) => {
        const base = prev && typeof prev === 'object' ? prev : {}
        const next = { ...base }
        const existing = next[sn] && typeof next[sn] === 'object' ? next[sn] : null
        if (existing) {
          const merged = { ...existing }
          delete merged.invoiceDate
          if (Object.keys(merged).length) next[sn] = merged
          else delete next[sn]
        }
        try {
          window.localStorage.setItem(receivableStatementOverrideMapStorageKey, JSON.stringify(next))
        } catch (e) {
          console.error(e)
        }
        return next
      })

      message.success('发票已作废')
      await loadProductionData()
    } catch (e) {
      console.error(e)
      message.error('发票作废失败')
    } finally {
      setReceivableVoidLoading(false)
    }
  }

  const handleVoidInvoiceFromEdit = () => {
    const sn = String(receivableEditRecord?.statementNo || '')
    if (!sn) {
      message.warning('缺少对账单号')
      return
    }
    const hasInvoice = statementOrders.some((o) => String(o?.statementNo || '') === sn && String(o?.invoiceDate || '').trim())
    if (!hasInvoice) {
      message.warning('该对账单暂无开票记录')
      return
    }
    modal.confirm({
      title: '确认作废发票',
      okText: '确认作废',
      cancelText: '取消',
      okButtonProps: { danger: true },
      content: (
        <div>
          <div>将作废对账单的开票记录：</div>
          <div style={{ marginTop: 8, color: '#111827' }}>{sn}</div>
          <div style={{ marginTop: 8, color: '#6b7280' }}>
            作废后，订单的开票时间将被清除，本月开票金额将同步减少。
          </div>
        </div>
      ),
      onOk: async () => {
        await doVoidInvoiceByStatementNo(sn)
        closeReceivableEditModal()
      }
    })
  }

  const handleInvalidateStatements = () => {
    if (!receivableSelectedRowKeys.length) {
      message.warning('请先勾选要作废的对账单')
      return
    }
    const picked = receivableSelectedRowKeys.map((k) => String(k || '')).filter(Boolean)
    const reasons = []
    const eligible = []
    picked.forEach((sn) => {
      const record = filteredReceivables.find((r) => String(r?.statementNo || r?.key || '') === sn) ||
        receivableData.find((r) => String(r?.statementNo || r?.key || '') === sn)
      const received = record ? Number(record.amountReceived || 0) : 0
      if (Number.isFinite(received) && received > 0) {
        reasons.push(`${sn}：已存在回款记录`)
        return
      }
      eligible.push(sn)
    })
    if (!eligible.length) {
      modal.warning({
        title: '无法作废',
        content: (
          <div>
            <div>以下对账单无法作废：</div>
            <div style={{ marginTop: 8, color: '#6b7280' }}>{reasons.join('；')}</div>
          </div>
        )
      })
      return
    }

    modal.confirm({
      title: '确认作废对账单',
      okText: '确认作废',
      cancelText: '取消',
      okButtonProps: { danger: true },
      content: (
        <div>
          <div>将作废以下对账单：</div>
          <div style={{ marginTop: 8, color: '#111827' }}>{eligible.join('，')}</div>
          <div style={{ marginTop: 8, color: '#6b7280' }}>
            作废后，对应订单将回到“待对账”，对账单号与开票时间将被清除。
          </div>
        </div>
      ),
      onOk: async () => {
        await doVoidStatements(eligible)
      }
    })
  }

  const openPayableEditModal = (record) => {
    const used = record || null
    if (!used) return
    setPayableEditRecord(used)
    setPayableEditSupplierName(String(used.supplierName || ''))
    setPayableEditInvoiceDate(used.invoiceDate && dayjs(used.invoiceDate).isValid() ? dayjs(used.invoiceDate) : null)
    setPayableEditDueDate(used.dueDate && dayjs(used.dueDate).isValid() ? dayjs(used.dueDate) : null)
    setPayableEditAmountPayable(Number.isFinite(Number(used.amountPayable)) ? Number(used.amountPayable) : 0)
    setPayableEditAmountPaid(Number.isFinite(Number(used.amountPaid)) ? Number(used.amountPaid) : 0)
    setPayableEditPaymentDate(used.paymentDate && dayjs(used.paymentDate).isValid() ? dayjs(used.paymentDate) : null)
    setPayableEditPaymentTerm(String(used.paymentTerm || '现付'))
    setPayableEditModalOpen(true)
  }

  const resetPayableEditState = () => {
    setPayableEditModalOpen(false)
    setPayableEditRecord(null)
    setPayableEditSupplierName('')
    setPayableEditInvoiceDate(null)
    setPayableEditDueDate(null)
    setPayableEditAmountPayable(null)
    setPayableEditAmountPaid(null)
    setPayableEditPaymentDate(null)
    setPayableEditPaymentTerm('现付')
  }

  const handlePayableDelete = () => {
    if (!payableEditRecord) return
    const key = payableEditRecord.key
    if (!key) {
      message.warning('缺少记录ID')
      return
    }
    modal.confirm({
      title: '确认删除应付记录？',
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      content: `供应商：${payableEditRecord.supplierName || ''}`,
      onOk: async () => {
        message.open({ type: 'loading', content: '正在删除...', key: `payable_delete_${key}`, duration: 0 })
        try {
          await payableAPI.remove(key)
          setPayableData((prev) => (Array.isArray(prev) ? prev.filter((it) => it && it.key !== key) : []))
          resetPayableEditState()
          message.open({ type: 'success', content: '已删除应付记录', key: `payable_delete_${key}` })
        } catch (e) {
          const msg = e?.message ? String(e.message) : '删除失败'
          message.open({ type: 'error', content: msg, key: `payable_delete_${key}` })
          throw e
        }
      }
    })
  }

  const handlePayableEditSubmit = () => {
    if (!payableEditRecord) {
      resetPayableEditState()
      return
    }
    const key = payableEditRecord.key
    if (!key) {
      message.warning('缺少记录ID')
      return
    }
    const supplierName = String(payableEditSupplierName || '').trim()
    if (!supplierName) {
      message.warning('请输入供应商名称')
      return
    }
    const amountPayable = Number(payableEditAmountPayable)
    const amountPaid = Number(payableEditAmountPaid)
    if (!Number.isFinite(amountPayable) || amountPayable <= 0) {
      message.warning('应付金额不合法')
      return
    }
    if (!Number.isFinite(amountPaid) || amountPaid < 0) {
      message.warning('已付金额不合法')
      return
    }
    if (amountPaid > amountPayable) {
      message.warning('已付金额不能超过应付金额')
      return
    }
    const invoiceDate = payableEditInvoiceDate && dayjs(payableEditInvoiceDate).isValid()
      ? dayjs(payableEditInvoiceDate).format('YYYY-MM-DD')
      : ''
    const dueDate = payableEditDueDate && dayjs(payableEditDueDate).isValid()
      ? dayjs(payableEditDueDate).format('YYYY-MM-DD')
      : ''
    const paymentDate = payableEditPaymentDate && dayjs(payableEditPaymentDate).isValid()
      ? dayjs(payableEditPaymentDate).format('YYYY-MM-DD')
      : ''
    const paymentTerm = String(payableEditPaymentTerm || '').trim() || '现付'
    const nextStatus = amountPaid >= amountPayable ? 'paid' : (amountPaid > 0 ? 'partial' : 'pending')

    setPayableData((prev) => {
      const list = Array.isArray(prev) ? prev : []
      const next = list.map((it) => {
        if (!it || it.key !== key) return it
        return {
          ...it,
          supplierName,
          invoiceDate,
          dueDate,
          amountPayable,
          amountPaid,
          status: nextStatus,
          paymentDate,
          paymentTerm
        }
      })
      return next
    })

    void (async () => {
      try {
        await payableAPI.update(key, {
          supplierName,
          invoiceDate,
          dueDate,
          amountPayable,
          amountPaid,
          status: nextStatus,
          paymentDate,
          paymentTerm
        })
      } catch (e) {
        console.error(e)
      }
    })()

    resetPayableEditState()
    message.success('已更新应付记录')
  }

  // Recalculate Receivable Data when dependencies change
  useEffect(() => {
    if (!statementOrders.length && !Object.keys(receivablePaymentMap).length && !savedStatements.length) return

    const receivableMap = new Map()
    statementOrders.forEach((item) => {
      if (item.isReconciled && item.statementNo) {
        const key = item.statementNo
        const customerObj = allCustomersList.find(c =>
          (item.customerId && (c._id === item.customerId || c.id === item.customerId)) ||
          (c.name === item.customerName || c.companyName === item.customerName)
        ) || {}

        const prev = receivableMap.get(key) || {
          key,
          statementNo: key,
          customerName: item.customerName,
          customerId: item.customerId,
          amountReceivable: 0,
          amountReceived: 0,
          invoiceDate: item.invoiceDate,
          paymentDate: '',
          date: item.reconcileDate,
          dueDate: '',
          orderNo: item.orderNo
        }

        prev.amountReceivable += Number(item.amount || 0)

        // Payment Logic
        const localPayment = receivablePaymentMap[key]
        if (localPayment) {
          prev.amountReceived = Number(localPayment.received || 0)
          if (localPayment.lastPaymentDate) {
            prev.paymentDate = localPayment.lastPaymentDate
          }
        } else {
          if (item.paymentDate) {
            prev.amountReceived += Number(item.amount || 0)
            if (!prev.paymentDate || item.paymentDate > prev.paymentDate) {
              prev.paymentDate = item.paymentDate
            }
          }
        }

        if (item.invoiceDate && (!prev.invoiceDate || item.invoiceDate > prev.invoiceDate)) {
          prev.invoiceDate = item.invoiceDate
        }

        // Calculate payment date (settlement date) -> dueDate
        if (!prev.dueDate) {
          const reconcileDate = item.reconcileDate ? dayjs(item.reconcileDate) : null
          if (reconcileDate && reconcileDate.isValid()) {
            const paymentTermStr = item.paymentTerm || customerObj.paymentTerms || ''
            let calculatedDate = reconcileDate

            if (paymentTermStr.includes('月结')) {
              const match = paymentTermStr.match(/(\d+)天/)
              let daysToAdd = 0
              if (match) {
                daysToAdd = parseInt(match[1], 10)
              }
              const baseDate = reconcileDate.add(1, 'month').startOf('month')
              calculatedDate = baseDate.add(daysToAdd, 'day')
            } else if (paymentTermStr.includes('现结')) {
              calculatedDate = reconcileDate
            }

            prev.dueDate = calculatedDate.format('YYYY-MM-DD')
          }
        }

        receivableMap.set(key, prev)
      }
    })

    const storedStatements = Array.isArray(savedStatements) ? savedStatements : []
    const storedLatestByNo = new Map()
    storedStatements.forEach((s) => {
      const statementNo = String(s?.statementNo || '').trim()
      if (!statementNo) return
      const prev = storedLatestByNo.get(statementNo) || null
      const ta = Number(s?.updatedAt ?? s?.meta?.updatedAt ?? 0)
      const tb = Number(prev?.updatedAt ?? prev?.meta?.updatedAt ?? 0)
      const ua = Number.isFinite(ta) ? ta : 0
      const ub = Number.isFinite(tb) ? tb : 0
      if (!prev || ua >= ub) storedLatestByNo.set(statementNo, s)
    })

    Array.from(storedLatestByNo.values()).forEach((s) => {
      const statementNo = String(s?.statementNo || '').trim()
      if (!statementNo) return
      const rawCustomerName = String(s?.customer || s?.customerName || '').trim()
      const period = String(s?.period || '').trim()
      const rows = Array.isArray(s?.rows) ? s.rows : []
      const meta = (s?.meta && typeof s.meta === 'object') ? s.meta : {}
      const template = String(meta?.template || 'standard')
      const summaryAmountRaw = Number(meta?.summaryAmount ?? meta?.summary?.amountIncl ?? meta?.amountIncl ?? meta?.totalAmount ?? 0)
      const totalAmount = summaryAmountRaw > 0
        ? summaryAmountRaw
        : rows.reduce((sum, r) => {
          const qty = Number(r?.quantity || 0)
          const price = Number(r?.unitPrice || 0)
          const amount = Number.isFinite(Number(r?.amount)) ? Number(r.amount) : qty * price
          return sum + (Number.isFinite(amount) ? amount : 0)
        }, 0)

      const base = receivableMap.get(statementNo) || {
        key: statementNo,
        statementNo,
        customerName: rawCustomerName || '',
        customerId: '',
        amountReceivable: 0,
        amountReceived: 0,
        invoiceDate: '',
        paymentDate: '',
        date: '',
        dueDate: '',
        orderNo: ''
      }

      const localPayment = receivablePaymentMap[statementNo]
      if (localPayment) {
        base.amountReceived = Number(localPayment.received || 0)
        if (localPayment.lastPaymentDate) {
          base.paymentDate = localPayment.lastPaymentDate
        }
      }

      base.amountReceivable = Number(totalAmount.toFixed(2))
      if (!base.customerName && rawCustomerName) base.customerName = rawCustomerName

      if (!base.date) {
        const d = String(meta?.reconcileDate || meta?.date || '').trim()
        base.date = d || (period ? `${period}-01` : dayjs(meta?.updatedAt || s?.updatedAt || Date.now()).format('YYYY-MM-DD'))
      }

      if (!base.dueDate) {
        const reconcileDate = base.date ? dayjs(base.date) : null
        if (reconcileDate && reconcileDate.isValid()) {
          const paymentTermStr = String(meta?.paymentTerm || meta?.paymentTerms || '').trim()
          let calculatedDate = reconcileDate
          if (paymentTermStr.includes('月结')) {
            const match = paymentTermStr.match(/(\d+)天/)
            let daysToAdd = 0
            if (match) {
              daysToAdd = parseInt(match[1], 10)
            }
            const baseDate = reconcileDate.add(1, 'month').startOf('month')
            calculatedDate = baseDate.add(daysToAdd, 'day')
          } else if (paymentTermStr.includes('现结')) {
            calculatedDate = reconcileDate
          }
          base.dueDate = calculatedDate.format('YYYY-MM-DD')
        }
      }

      base._statementDoc = s
      receivableMap.set(statementNo, base)
    })

    const receivableList = Array.from(receivableMap.values()).map((r) => {
      const total = Number(r.amountReceivable || 0)
      const received = Number(r.amountReceived || 0)

      let status = 'pending'
      const now = dayjs()
      const due = r.dueDate ? dayjs(r.dueDate) : null

      if (received >= total && total > 0) {
        status = 'paid'
      } else if (received > 0) {
        status = 'partial'
      } else if (due && due.isValid()) {
        if (now.isAfter(due, 'day')) {
          status = 'overdue'
        } else if (now.isSame(due, 'day')) {
          status = 'due'
        }
      }

      const override = receivableStatementOverrideMap && r?.statementNo
        ? receivableStatementOverrideMap[String(r.statementNo)]
        : undefined
      const next = { ...r, status }
      if (override && typeof override === 'object') {
        if (override.dueDate) next.dueDate = String(override.dueDate || '')
        if (override.invoiceDate) next.invoiceDate = String(override.invoiceDate || '')
      }
      return next
    })
    setReceivableData(receivableList)
  }, [statementOrders, receivablePaymentMap, receivableStatementOverrideMap, savedStatements])

  return (
    <ConfigProvider locale={zhCN}>
      <div>
        <h2 className="page-title">财务管理</h2>

        <Tabs
          activeKey={activeTab}
          onChange={setActiveTab}
          items={[
            {
              key: 'production',
              label: '生产效益管理',
              children: (
                <>
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
                              本月订单总金额
                            </span>
                          }
                          tooltip={
                            <div>
                              <div>{`生产订单：¥${Number(monthSalesOrderAmount || 0).toLocaleString()}`}</div>
                              <div>{`采购商品：¥${Number(monthPurchaseGoodsOrderAmount || 0).toLocaleString()}`}</div>
                            </div>
                          }
                          value={displayOrderAmount}
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
                              本月原材料总成本
                            </span>
                          }
                          value={displayRawMaterialCost}
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
                              本月生产毛利合计
                            </span>
                          }
                          value={displayGrossProfit}
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
                              本月平均生产毛利率
                            </span>
                          }
                          value={Number(displayGrossProfitRate.toFixed(1))}
                          suffix="%"
                          precision={1}
                          valueStyle={{ color: '#1890ff', fontWeight: 'bold', fontSize: 20 }}
                        />
                      </Card>
                    </Col>
                  </Row>

                  <Card style={{ marginBottom: 16 }}>
                    <Space style={{ width: '100%', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                      <Space wrap>
                        <Input
                          style={{ width: 260 }}
                          placeholder="搜索客户名、订单号、材质编码、商品名称"
                          allowClear
                          value={productionKeyword}
                          onChange={(e) => setProductionKeyword(e.target.value)}
                        />
                        <RangePicker
                          value={productionDateRange}
                          onChange={(value) => {
                            setProductionDateRange(value || undefined)
                            setProductionRangePreset(undefined)
                          }}
                        />
                        <Select
                          allowClear
                          placeholder="选择时间范围"
                          style={{ width: 200 }}
                          value={productionRangePreset}
                          onChange={(value) => {
                            if (!value) {
                              setProductionRangePreset(undefined)
                              setProductionDateRange(undefined)
                              return
                            }
                            setProductionRangePreset(value)
                            const now = dayjs()
                            let start
                            let end
                            if (value === '2024') {
                              start = dayjs().year(2024).startOf('year')
                              end = dayjs().year(2024).endOf('year')
                            } else if (value === '2025') {
                              start = dayjs().year(2025).startOf('year')
                              end = dayjs().year(2025).endOf('year')
                            } else if (value === '6m') {
                              end = now
                              start = now.subtract(6, 'month')
                            } else if (value === '3m') {
                              end = now
                              start = now.subtract(3, 'month')
                            } else if (value === '1m') {
                              end = now.endOf('day')
                              start = now.subtract(30, 'day').startOf('day')
                            }
                            if (start && end) {
                              setProductionDateRange([start, end])
                            }
                          }}
                          options={[
                            { value: '2024', label: '2024年' },
                            { value: '2025', label: '2025年' },
                            { value: '6m', label: '近半年' },
                            { value: '3m', label: '近3个月' },
                            { value: '1m', label: '近1个月' }
                          ]}
                        />
                      </Space>
                      <Space wrap>
                        <Button type="primary" onClick={loadProductionData}>
                          刷新数据
                        </Button>
                      </Space>
                    </Space>
                  </Card>

                  <Card>
                    <div ref={productionTableWrapRef}>
                      <Table
                        key={`production_${Object.keys(manualOrderMaterialPriceMap || {}).length}`}
                        rowKey="key"
                        columns={productionColumns}
                        dataSource={groupedProduction}
                        loading={productionLoading}
                        rowSelection={productionRowSelection}
                        pagination={{ pageSize: 30 }}
                        sticky
                        scroll={{ x: 1400, y: 680 }}
                      />
                    </div>
                  </Card>

                </>
              )
            },
            {
              key: 'statements',
              label: '对账单管理',
              forceRender: true,
              children: (
                <>
                  {renderStatCards([
                    {
                      title: '本月已发货金额',
                      value: statementTotalShippedThisMonth,
                      precision: 2,
                      prefix: <DollarOutlined />,
                      suffix: '元',
                      color: '#1890ff'
                    },
                    {
                      title: '本月已对账金额',
                      value: statementTotalMonthReconciled,
                      precision: 2,
                      prefix: <DollarOutlined />,
                      suffix: '元',
                      color: '#1890ff'
                    },
                    {
                      title: '未对账金额',
                      value: statementTotalUnreconciled,
                      precision: 2,
                      prefix: <DollarOutlined />,
                      suffix: '元',
                      color: '#cf1322'
                    },
                    {
                      title: '本月对账单数量',
                      value: statementCountThisMonth,
                      precision: 0,
                      color: '#111827'
                    }
                  ])}

                  <Card>
                    <Space style={{ marginBottom: 16 }} wrap>
                      <Input
                        placeholder="搜索对账单号、往来单位"
                        value={statementKeyword}
                        onChange={(e) => setStatementKeyword(e.target.value)}
                        allowClear
                        style={{ width: 200 }}
                      />
                      <RangePicker
                        onChange={(value) => {
                          setDateRange(value || undefined)
                        }}
                      />
                      <Select
                        allowClear
                        placeholder="客户筛选"
                        value={statementCustomer}
                        onChange={setStatementCustomer}
                        style={{ width: 200 }}
                        options={statementCustomerOptions.map((name) => ({
                          value: name,
                          label: name
                        }))}
                      />
                      <Button onClick={() => setCustomerAliasModalOpen(true)}>
                        客户合并管理
                      </Button>
                      {customerAliasSuggestions.length ? (
                        <Tag
                          color="orange"
                          style={{ cursor: 'pointer' }}
                          onClick={() => setCustomerAliasModalOpen(true)}
                        >
                          检测到{customerAliasSuggestions.length}条可能重复客户
                        </Tag>
                      ) : null}
                      {!statementReconcileMode ? (
                        <Button
                          type="primary"
                          onClick={handleStatementReconcile}
                          disabled={statementLoading || !filteredStatements.length}
                        >
                          开始对账
                        </Button>
                      ) : (
                        <>
                          <Button
                            type="primary"
                            onClick={handleStatementGenerate}
                            disabled={statementLoading || !filteredStatements.length}
                          >
                            预览对账单
                          </Button>
                          {Array.isArray(statementSelectedRowKeys) && statementSelectedRowKeys.length ? (
                            <Tag color="blue">已选 {statementSelectedRowKeys.length} 条</Tag>
                          ) : null}
                          {Array.isArray(statementSelectedRowKeys) && statementSelectedRowKeys.length ? (
                            <Button onClick={() => setStatementSelectedRowKeys([])}>清空勾选</Button>
                          ) : null}
                          <Button
                            onClick={() => {
                              setStatementReconcileMode(false)
                              setStatementSelectedRowKeys([])
                            }}
                            disabled={statementLoading}
                          >
                            取消
                          </Button>
                        </>
                      )}
                    </Space>
                    <div
                      ref={statementScrollRef}
                      style={{ maxHeight: 520, overflow: 'auto' }}
                      onScroll={(e) => {
                        const el = e.currentTarget
                        if (!el) return
                        const reachedBottom =
                          el.scrollTop + el.clientHeight >= el.scrollHeight - 80
                        if (reachedBottom && visibleStatements.length < filteredStatements.length) {
                          setStatementPageSize((prev) =>
                            Math.min(prev + 20, filteredStatements.length)
                          )
                        }
                      }}
                    >
                      <Table
                        rowKey="key"
                        columns={statementColumns}
                        dataSource={visibleStatements}
                        loading={statementLoading || statementReconcileLoading}
                        rowSelection={statementRowSelection}
                        pagination={false}
                      />
                      <Modal
                        open={statementPreviewVisible}
                        title={
                          statementPreviewCustomerName
                            ? `${statementPreviewCustomerName} 对账单预览`
                            : '对账单预览'
                        }
                        width={960}
                        onCancel={() => setStatementPreviewVisible(false)}
                        footer={(() => {
                          const existingNo = String(statementPreviewRows?.[0]?.statementNo || '').trim()
                          const rows = statementPreviewTemplate === 'standard'
                            ? (statementEditRows.length ? statementEditRows : statementPreviewRows)
                            : statementPreviewRows
                          const canSave = statementPreviewTemplate === 'standard' && rows.length > 0
                          const actions = [
                            <Button key="cancel" onClick={() => setStatementPreviewVisible(false)}>
                              关闭
                            </Button>,
                            <Button
                              key="export"
                              onClick={() => {
                                if (!rows.length) return
                                exportReconciliationExcel(rows)
                              }}
                              disabled={!rows.length}
                            >
                              导出对账单
                            </Button>
                          ]

                          if (existingNo) {
                            actions.push(
                              <Button
                                key="save"
                                type="primary"
                                loading={statementEditSaving}
                                disabled={!canSave || statementEditLockedByFinal}
                                onClick={() => {
                                  if (statementEditLockedByFinal) {
                                    warnStatementLocked()
                                    return
                                  }
                                  const validated = validateStatementEditRows(rows)
                                  if (!validated.ok) {
                                    message.warning(validated.message)
                                    return
                                  }
                                  modal.confirm({
                                    title: '确认保存',
                                    content: '确认将当前对账单明细保存到数据库？',
                                    okText: '保存',
                                    cancelText: '取消',
                                    onOk: async () => {
                                      setStatementEditSaving(true)
                                      try {
                                        const storedDoc = pickLatestStatementByNo(savedStatements, existingNo)
                                        const period =
                                          (storedDoc && String(storedDoc?.period || '').trim()) ||
                                          (() => {
                                            const m = String(existingNo || '').match(/^QXDZD(\d{4})(\d{2})/)
                                            if (m) return `${m[1]}-${m[2]}`
                                            return dayjs().format('YYYY-MM')
                                          })()
                                        const paymentTerm = String(statementPreviewRows.find(r => r.paymentTerm)?.paymentTerm || '').trim()
                                        const rowsForSave = withCalculatedStatementAmounts(rows)
                                        try {
                                          const saved = await statementAPI.upsertStatement({
                                            customer: statementPreviewCustomerName || '',
                                            period,
                                            statementNo: existingNo,
                                            rows: rowsForSave,
                                            final: true,
                                            meta: { template: statementPreviewTemplate, paymentTerm, source: 'reconcile' }
                                          })
                                          requireStatementApiSuccess(saved, '保存失败')
                                        } catch (e) {
                                          const serverMsg = e?.response?.data?.message || e?.response?.data?.error
                                          const rawMsg = String(serverMsg || e?.message || '')
                                          if (rawMsg.includes('ERR_BILL_LOCKED')) {
                                            modal.confirm({
                                              title: '对账单已锁定',
                                              content: '该对账单已锁定。确认强制覆盖并继续保存？',
                                              okText: '强制保存',
                                              okType: 'danger',
                                              cancelText: '取消',
                                              onOk: async () => {
                                                try {
                                                  const forced = await statementAPI.upsertStatement({
                                                    customer: statementPreviewCustomerName || '',
                                                    period,
                                                    statementNo: existingNo,
                                                    rows: rowsForSave,
                                                    final: true,
                                                    meta: { template: statementPreviewTemplate, paymentTerm, source: 'reconcile', forceUnlock: true }
                                                  })
                                                  requireStatementApiSuccess(forced, '保存失败')
                                                  message.success('已保存到数据库')
                                                  await loadProductionData()
                                                } catch (e2) {
                                                  const serverMsg2 = e2?.response?.data?.message || e2?.response?.data?.error
                                                  message.error(serverMsg2 || e2?.message || '保存失败')
                                                }
                                              }
                                            })
                                            return
                                          }
                                          message.error(rawMsg || '保存失败')
                                          return
                                        }
                                        message.success('已保存到数据库')
                                        await loadProductionData()
                                      } finally {
                                        setStatementEditSaving(false)
                                      }
                                    }
                                  })
                                }}
                              >
                                保存到数据库
                              </Button>
                            )
                          } else {
                            actions.push(
                              <Button
                                key="confirm"
                                type="primary"
                                onClick={() => executeReconciliation(rows)}
                                disabled={!rows.length || rows.every(r => r.isReconciled)}
                              >
                                确认对账
                              </Button>
                            )
                          }
                          return actions
                        })()}
                      >
                        <Space style={{ marginBottom: 12 }} wrap>
                          <span style={{ color: '#6b7280' }}>模板：</span>
                          <Select
                            value={statementPreviewTemplate}
                            onChange={setStatementPreviewTemplate}
                            style={{ width: 220 }}
                            disabled={statementPreviewLocked}
                            options={[
                              { value: 'standard', label: '标准对账单' },
                              { value: 'deliveryDetail', label: '送货明细（太仓诚亮包装有限公司）' }
                            ]}
                          />
                          {statementPreviewLocked ? (
                            <Tag icon={<LockOutlined />} color="default">
                              已锁定
                            </Tag>
                          ) : null}
                          {statementPreviewTemplate === 'standard' ? (
                            <>
                              <Button
                                disabled={statementPreviewLocked}
                                onClick={() => {
                                  if (statementPreviewLocked) {
                                    warnStatementLocked()
                                    return
                                  }
                                  const next = normalizeStatementRow({ shipDate: statementPreviewToday })
                                  setStatementEditRows((prev) => (Array.isArray(prev) ? prev : []).concat([next]))
                                }}
                              >
                                增行
                              </Button>
                              <Button
                                danger
                                disabled={statementPreviewLocked || !statementEditSelectedKeys.length}
                                onClick={() => {
                                  if (statementPreviewLocked) {
                                    warnStatementLocked()
                                    return
                                  }
                                  const keys = new Set(statementEditSelectedKeys.map((k) => String(k || '')))
                                  setStatementEditRows((prev) => (Array.isArray(prev) ? prev : []).filter((r) => !keys.has(String(r?.key || ''))))
                                  setStatementEditSelectedKeys([])
                                }}
                              >
                                减行
                              </Button>
                            </>
                          ) : null}
                        </Space>
                        {statementPreviewTemplate === 'standard' ? (
                          <div style={{ marginBottom: 24, padding: '16px 24px', background: '#fff', border: '1px solid #f0f0f0', borderRadius: 4 }}>
                            <div style={{ textAlign: 'center', fontSize: 20, fontWeight: 'bold', marginBottom: 24 }}>
                              {(() => {
                                const existingNo = statementPreviewRows[0]?.statementNo
                                if (existingNo) return `对账单 (${existingNo})`
                                return `${dayjs().format('YYYY')}年${dayjs().format('MM')}月份对账单`
                              })()}
                            </div>
                            <Row gutter={24} style={{ marginBottom: 12 }}>
                              <Col span={12}>
                                <span style={{ fontWeight: 'bold' }}>采购单位：</span>
                                {statementPreviewCustomerName || ''}
                              </Col>
                              <Col span={12}>
                                <span style={{ fontWeight: 'bold' }}>供货单位：</span>
                                昆山群鑫包装科技有限公司
                              </Col>
                            </Row>
                            <Row gutter={24} style={{ marginBottom: 12 }}>
                              <Col span={12}>
                                <span style={{ fontWeight: 'bold' }}>联系人：</span>
                              </Col>
                              <Col span={12}>
                                <span style={{ fontWeight: 'bold' }}>联系人：</span>
                                祝启鑫
                              </Col>
                            </Row>
                            <Row gutter={24} style={{ marginBottom: 12 }}>
                              <Col span={12}>
                                <span style={{ fontWeight: 'bold' }}>电话：</span>
                              </Col>
                              <Col span={12}>
                                <span style={{ fontWeight: 'bold' }}>电话：</span>
                                13817508995
                              </Col>
                            </Row>
                            <Row gutter={24}>
                              <Col span={12}>
                                <span style={{ fontWeight: 'bold' }}>结款方式：</span>
                                {statementPreviewRows.find(r => r.paymentTerm)?.paymentTerm || ''}
                              </Col>
                              <Col span={12}>
                                <span style={{ fontWeight: 'bold' }}>税率：</span>
                                含13%税
                              </Col>
                            </Row>
                          </div>
                        ) : (
                          <div style={{ marginBottom: 24, padding: '16px 24px', background: '#fff', border: '1px solid #f0f0f0', borderRadius: 4 }}>
                            <div style={{ textAlign: 'center', fontSize: 20, fontWeight: 'bold', marginBottom: 8 }}>
                              {(() => {
                                const base = statementPreviewDates.length ? statementPreviewDates[0] : dayjs()
                                return `${base.format('YYYY')}年${base.format('M')}月送货明细（太仓诚亮包装有限公司）`
                              })()}
                            </div>
                            <div style={{ textAlign: 'center', color: '#6b7280' }}>
                              {statementPreviewPeriodText ? `期间：${statementPreviewPeriodText}` : ''}
                            </div>
                          </div>
                        )}
                        <Table
                          rowKey="key"
                          columns={statementPreviewColumns}
                          dataSource={statementPreviewDataSource}
                          pagination={false}
                          size="small"
                          scroll={{ y: 360 }}
                          rowSelection={statementPreviewTemplate === 'standard' && !statementPreviewLocked ? {
                            type: 'checkbox',
                            selectedRowKeys: statementEditSelectedKeys,
                            onChange: (keys) => setStatementEditSelectedKeys(keys)
                          } : undefined}
                          onRow={statementPreviewLocked ? () => ({ onDoubleClick: warnStatementLocked }) : undefined}
                          summary={statementPreviewTemplate === 'standard' ? () => {
                            const rows = Array.isArray(statementPreviewDataSource) ? statementPreviewDataSource : []
                            const total = rows.reduce((sum, r) => sum + calcRowAmount(r), 0)
                            return (
                              <Table.Summary.Row>
                                <Table.Summary.Cell index={0} colSpan={6} align="right">
                                  合计
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={6}>
                                  {total ? total.toFixed(2) : ''}
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={7} />
                              </Table.Summary.Row>
                            )
                          } : undefined}
                        />
                        <div style={{ marginTop: 16, display: 'flex', justifyContent: 'space-between', padding: '0 12px' }}>
                          <div>制单人：林群</div>
                          <div>制表日期：{statementPreviewToday}</div>
                          <div style={{ fontWeight: 'bold' }}>
                            合计金额：¥{Number(statementPreviewTotalAmount || 0).toFixed(2)}
                          </div>
                        </div>
                      </Modal>
                      <Modal
                        title="客户名称合并管理"
                        open={customerAliasModalOpen}
                        onCancel={() => {
                          setCustomerAliasModalOpen(false)
                          setCustomerAliasDraftAlias('')
                          setCustomerAliasDraftCanonical('')
                        }}
                        destroyOnHidden
                        width={920}
                        footer={null}
                      >
                        <Space direction="vertical" style={{ width: '100%' }} size={16}>
                          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                            <Input
                              placeholder="简称/别名（如：诚亮包装）"
                              style={{ width: 260 }}
                              value={customerAliasDraftAlias}
                              onChange={(e) => setCustomerAliasDraftAlias(e.target.value)}
                            />
                            <Select
                              showSearch
                              placeholder="全称（合并后统一显示）"
                              style={{ width: 420 }}
                              value={customerAliasDraftCanonical || undefined}
                              onChange={(v) => setCustomerAliasDraftCanonical(v)}
                              options={Array.from(new Set(allCustomersList.map((c) => String(c?.companyName || c?.name || '').trim()).filter(Boolean))).map((v) => ({ label: v, value: v }))}
                              optionFilterProp="label"
                            />
                            <Button
                              type="primary"
                              onClick={() => {
                                const alias = String(customerAliasDraftAlias || '').trim()
                                const canonical = String(customerAliasDraftCanonical || '').trim()
                                if (!alias || !canonical) {
                                  message.warning('请填写简称和全称')
                                  return
                                }
                                modal.confirm({
                                  title: '确认合并',
                                  content: `确认将“${alias}”合并到“${canonical}”？列表展示与汇总会统一为全称。`,
                                  okText: '确认',
                                  cancelText: '取消',
                                  onOk: async () => {
                                    await customerAliasAPI.upsertAlias({ alias, canonical })
                                    message.success('已保存映射')
                                    setCustomerAliasDraftAlias('')
                                    setCustomerAliasDraftCanonical('')
                                    await loadProductionData()
                                  }
                                })
                              }}
                            >
                              保存映射
                            </Button>
                          </div>

                          {customerAliasSuggestions.length ? (
                            <Card size="small" title="检测到可能重复客户（点击可一键合并）">
                              <Table
                                rowKey={(r) => `${r.alias}=>${r.canonical}`}
                                size="small"
                                pagination={false}
                                dataSource={customerAliasSuggestions}
                                columns={[
                                  { title: '简称/别名', dataIndex: 'alias', key: 'alias' },
                                  { title: '建议全称', dataIndex: 'canonical', key: 'canonical' },
                                  {
                                    title: '操作',
                                    key: 'action',
                                    width: 140,
                                    render: (_, r) => (
                                      <Button
                                        type="primary"
                                        size="small"
                                        onClick={() => {
                                          modal.confirm({
                                            title: '确认合并',
                                            content: `确认将“${r.alias}”合并到“${r.canonical}”？`,
                                            okText: '确认',
                                            cancelText: '取消',
                                            onOk: async () => {
                                              await customerAliasAPI.upsertAlias({ alias: r.alias, canonical: r.canonical })
                                              message.success('合并成功')
                                              await loadProductionData()
                                            }
                                          })
                                        }}
                                      >
                                        一键合并
                                      </Button>
                                    )
                                  }
                                ]}
                              />
                            </Card>
                          ) : null}

                          <Card size="small" title="已维护的简称↔全称对照表">
                            <Table
                              rowKey={(r) => String(r?._id || r?.alias || '')}
                              size="small"
                              pagination={{ pageSize: 10, showSizeChanger: true }}
                              dataSource={customerAliases}
                              columns={[
                                { title: '简称/别名', dataIndex: 'alias', key: 'alias', width: 260 },
                                { title: '全称（统一显示）', dataIndex: 'canonical', key: 'canonical' },
                                {
                                  title: '操作',
                                  key: 'action',
                                  width: 120,
                                  render: (_, r) => (
                                    <Button
                                      danger
                                      size="small"
                                      onClick={() => {
                                        const alias = String(r?.alias || '').trim()
                                        if (!alias) return
                                        modal.confirm({
                                          title: '确认拆分',
                                          content: `确认删除“${alias}”的合并映射？删除后将不再自动合并。`,
                                          okText: '确认删除',
                                          okType: 'danger',
                                          cancelText: '取消',
                                          onOk: async () => {
                                            await customerAliasAPI.deleteAlias({ alias })
                                            message.success('已删除映射')
                                            await loadProductionData()
                                          }
                                        })
                                      }}
                                    >
                                      拆分
                                    </Button>
                                  )
                                }
                              ]}
                            />
                          </Card>
                        </Space>
                      </Modal>
                    </div>
                  </Card>
                </>
              )
            },
            {
              key: 'receivable',
              label: '应收款管理',
              children: (
                <>
                  {renderStatCards([
                    {
                      title: '应收合计(本月到期)',
                      value: receivableTotalDueThisMonth,
                      precision: 2,
                      prefix: <DollarOutlined />,
                      suffix: '元',
                      color: '#1890ff'
                    },
                    {
                      title: '已收合计(本月收款)',
                      value: receivableTotalReceivedThisMonth,
                      precision: 2,
                      prefix: <DollarOutlined />,
                      suffix: '元',
                      color: '#1890ff'
                    },
                    {
                      title: '逾期金额(上月底止)',
                      value: receivableTotalOverdue,
                      precision: 2,
                      prefix: <DollarOutlined />,
                      suffix: '元',
                      color: '#cf1322'
                    },
                    {
                      title: '待回款合计(未付总额)',
                      value: receivableTotalPending,
                      precision: 2,
                      prefix: <DollarOutlined />,
                      suffix: '元',
                      color: '#faad14'
                    }
                  ])}

                  <Card>
                    <Space style={{ marginBottom: 16 }} wrap>
                      <Input
                        placeholder="搜索客户名称、订单号"
                        value={receivableKeyword}
                        onChange={(e) => setReceivableKeyword(e.target.value)}
                        allowClear
                        style={{ width: 200 }}
                      />
                      <Select
                        allowClear
                        placeholder="应收状态"
                        value={receivableStatus}
                        onChange={setReceivableStatus}
                        style={{ width: 160 }}
                      >
                        <Option value="pending">待收款</Option>
                        <Option value="due">已到期</Option>
                        <Option value="overdue">已逾期</Option>
                        <Option value="partial">部分付款</Option>
                        <Option value="paid">已付款</Option>
                      </Select>
                      <Select
                        value={receivableYear}
                        onChange={setReceivableYear}
                        style={{ width: 100 }}
                        options={(() => {
                          const curr = dayjs().year()
                          const opts = []
                          for (let y = curr; y >= 2023; y--) {
                            opts.push({ label: `${y}年`, value: y })
                          }
                          return opts
                        })()}
                      />
                      <Select
                        value={receivableMonth}
                        onChange={setReceivableMonth}
                        style={{ width: 100 }}
                        options={Array.from({ length: 12 }, (_, i) => ({
                          label: `${i + 1}月`,
                          value: i + 1
                        }))}
                      />
                      {!receivablePaymentMode && !receivableInvoiceMode ? (
                        <Space>
                          <Button onClick={() => {
                            setStatementImportPreview(null)
                            setStatementImportModalOpen(true)
                          }}>
                            导入对账单
                          </Button>
                          <Button type="primary" onClick={() => {
                            setReceivablePaymentMode(true)
                            setReceivableSelectedRowKeys([])
                          }}>
                            回款操作
                          </Button>
                          <Button type="primary" onClick={() => {
                            setReceivableInvoiceMode(true)
                            setReceivableSelectedRowKeys([])
                          }}>
                            开票操作
                          </Button>
                        </Space>
                      ) : receivablePaymentMode ? (
                        <Space>
                          <Button
                            type="primary"
                            onClick={() => {
                              if (receivableSelectedRowKeys.length !== 1) {
                                message.warning('请选择一个对账单进行回款')
                                return
                              }
                              const record = filteredReceivables.find(r => r.key === receivableSelectedRowKeys[0])
                              if (!record) return
                              setReceivablePaymentRecord(record)
                              setReceivablePaymentModalVisible(true)
                            }}
                            disabled={receivableSelectedRowKeys.length !== 1}
                          >
                            确认回款
                          </Button>
                          <Button onClick={() => {
                            setReceivablePaymentMode(false)
                            setReceivableSelectedRowKeys([])
                          }}>
                            取消
                          </Button>
                        </Space>
                      ) : (
                        <Space>
                          <Button
                            type="primary"
                            onClick={handleInvoice}
                            disabled={receivableSelectedRowKeys.length < 1 || receivableVoidLoading}
                          >
                            确认开票
                          </Button>
                          <Button
                            danger
                            onClick={handleInvalidateStatements}
                            disabled={receivableSelectedRowKeys.length < 1 || receivableVoidLoading}
                          >
                            作废对账单
                          </Button>
                          <Button onClick={() => {
                            setReceivableInvoiceMode(false)
                            setReceivableSelectedRowKeys([])
                          }}>
                            取消
                          </Button>
                        </Space>
                      )}
                    </Space>
                    <Table
                      rowKey="key"
                      columns={receivableColumns}
                      dataSource={filteredReceivables}
                      pagination={{
                        pageSize: 10,
                        showSizeChanger: true
                      }}
                      rowSelection={(receivablePaymentMode || receivableInvoiceMode) ? {
                        type: 'checkbox',
                        selectedRowKeys: receivableSelectedRowKeys,
                        onChange: (keys) => setReceivableSelectedRowKeys(keys)
                      } : undefined}
                    />
                    <Modal
                      title="导入对账单"
                      open={statementImportModalOpen}
                      onCancel={() => {
                        setStatementImportModalOpen(false)
                        setStatementImportPreview(null)
                      }}
                      destroyOnHidden
                      width={980}
                      footer={[
                        <Button key="cancel" onClick={() => {
                          setStatementImportModalOpen(false)
                          setStatementImportPreview(null)
                        }}>
                          取消
                        </Button>,
                        <Button
                          key="import"
                          type="primary"
                          loading={statementImportLoading}
                          disabled={!statementImportPreview}
                          onClick={() => {
                            if (!statementImportPreview) return
                            const template = String(statementImportPreview?.template || 'standard')
                            const rows = Array.isArray(statementImportPreview?.rows) ? statementImportPreview.rows : []
                            if (template === 'standard') {
                              const validated = validateStatementEditRows(rows)
                              if (!validated.ok) {
                                message.warning(validated.message)
                                return
                              }
                            } else {
                              const total = Number(statementImportPreview?.totalAmount || 0)
                              if (!(total > 0)) {
                                message.warning('导入文件未识别到合计金额')
                                return
                              }
                            }
                            const existingNo = String(statementImportPreview?.existingStatementNo || '').trim()
                            const overrideNo = String(statementImportOverwriteStatementNo || '').trim()
                            const overwriteNo = statementImportOverwriteExisting ? (overrideNo || existingNo) : ''
                            const overwriteEnabled = Boolean(statementImportOverwriteExisting && overwriteNo)
                            const plannedStatementNo = overwriteEnabled ? overwriteNo : String(statementImportPreview.statementNo || '')
                            modal.confirm({
                              title: '确认导入',
                              content: (
                                <div>
                                  <div>确认导入后将覆盖该客户在该期间的对账单数据。</div>
                                  {existingNo ? (
                                    <div style={{ marginTop: 8, color: overwriteEnabled ? '#111827' : '#cf1322' }}>
                                      已检测到现有对账单号：{existingNo}。{overwriteEnabled ? '将按该对账单号覆盖原明细。' : '当前未开启覆盖，将生成新的对账单号，可能不会替换原对账单展示。'}
                                    </div>
                                  ) : null}
                                  <div style={{ marginTop: 8, color: '#6b7280' }}>
                                    导入后对账单号：{plannedStatementNo}
                                  </div>
                                  <div style={{ marginTop: 8, color: '#6b7280' }}>
                                    导入完成后可进行一次回滚撤销。
                                  </div>
                                </div>
                              ),
                              okText: '确认导入',
                              okType: 'danger',
                              cancelText: '取消',
                              onOk: async () => {
                                setStatementImportLoading(true)
                                try {
                                  const payload = {
                                    customer: statementImportPreview.customer,
                                    period: statementImportPreview.period,
                                    statementNo: (() => {
                                      if (overwriteEnabled) return overwriteNo
                                      return String(statementImportPreview.statementNo || '')
                                    })(),
                                    rows: template === 'standard' ? withCalculatedStatementAmounts(statementImportPreview.rows) : statementImportPreview.rows,
                                    meta: {
                                      template,
                                      paymentTerm: template === 'standard' ? (statementImportPreview.paymentTerm || '') : '',
                                      source: 'import',
                                      filename: statementImportPreview.filename || '',
                                      importFormat: statementImportPreview.format || '',
                                      title: statementImportPreview.title || '',
                                      summaryAmount: template === 'standard'
                                        ? withCalculatedStatementAmounts(statementImportPreview.rows).reduce((sum, r) => sum + Number(r?.amount || 0), 0)
                                        : Number(statementImportPreview.totalAmount || 0),
                                      overwriteExistingStatementNo: overwriteEnabled,
                                      existingStatementNo: overwriteNo,
                                      computedStatementNo: String(statementImportPreview.statementNo || '').trim(),
                                      rawTruncated: !!statementImportPreview.rawTruncated,
                                      importErrors: Array.isArray(statementImportPreview.importErrors) ? statementImportPreview.importErrors : [],
                                      ...(template === 'deliveryDetail' ? { layout: statementImportPreview.raw || null } : {})
                                    }
                                  }
                                  let resp = null
                                  try {
                                    resp = await statementAPI.upsertStatement(payload)
                                    requireStatementApiSuccess(resp, '导入失败')
                                  } catch (e) {
                                    const serverMsg = e?.response?.data?.message || e?.response?.data?.error
                                    const rawMsg = String(serverMsg || e?.message || '')
                                    if (rawMsg.includes('ERR_BILL_LOCKED')) {
                                      modal.confirm({
                                        title: '对账单已锁定',
                                        content: '该客户该期间对账单已锁定。确认强制覆盖并继续导入？',
                                        okText: '强制导入',
                                        okType: 'danger',
                                        cancelText: '取消',
                                        onOk: async () => {
                                          setStatementImportLoading(true)
                                          try {
                                            const r2 = await statementAPI.upsertStatement({
                                              ...payload,
                                              meta: { ...(payload.meta || {}), forceUnlock: true }
                                            })
                                            requireStatementApiSuccess(r2, '导入失败')
                                            const p2 = r2?.data ?? r2
                                            const backupId2 = String(p2?.backupId || p2?.data?.backupId || '').trim()
                                            message.success('导入成功')
                                            setStatementImportModalOpen(false)
                                            setStatementImportPreview(null)
                                            try {
                                              const p = String(statementImportPreview?.period || '').trim()
                                              const m = p.match(/^(\d{4})-(\d{2})$/)
                                              if (m) {
                                                setReceivableYear(Number(m[1]))
                                                setReceivableMonth(Number(m[2]))
                                              }
                                            } catch (_) { void 0 }
                                            setReceivableStatus(undefined)
                                            setReceivableKeyword(String(statementImportPreview?.customer || '').trim())
                                            setDateRange(undefined)
                                            await loadProductionData()
                                            if (backupId2) {
                                              modal.confirm({
                                                title: '导入成功',
                                                content: '如需撤销本次导入，可点击“撤销导入”。撤销后将恢复导入前的数据。',
                                                okText: '撤销导入',
                                                cancelText: '关闭',
                                                okType: 'default',
                                                onOk: async () => {
                                                  await statementAPI.rollbackImport({ backupId: backupId2 })
                                                  message.success('已撤销导入')
                                                  await loadProductionData()
                                                }
                                              })
                                            }
                                          } catch (e2) {
                                            console.error(e2)
                                            const serverMsg2 = e2?.response?.data?.message || e2?.response?.data?.error
                                            message.error(serverMsg2 || e2?.message || '导入失败')
                                          } finally {
                                            setStatementImportLoading(false)
                                          }
                                        }
                                      })
                                      return
                                    }
                                    throw e
                                  }
                                  const payloadResp = resp?.data ?? resp
                                  const backupId = String(payloadResp?.backupId || payloadResp?.data?.backupId || '').trim()
                                  message.success('导入成功')
                                  setStatementImportModalOpen(false)
                                  setStatementImportPreview(null)
                                  try {
                                    const p = String(statementImportPreview?.period || '').trim()
                                    const m = p.match(/^(\d{4})-(\d{2})$/)
                                    if (m) {
                                      setReceivableYear(Number(m[1]))
                                      setReceivableMonth(Number(m[2]))
                                    }
                                  } catch (_) { void 0 }
                                  setReceivableStatus(undefined)
                                  setReceivableKeyword(String(statementImportPreview?.customer || '').trim())
                                  setDateRange(undefined)
                                  await loadProductionData()
                                  if (backupId) {
                                    modal.confirm({
                                      title: '导入成功',
                                      content: '如需撤销本次导入，可点击“撤销导入”。撤销后将恢复导入前的数据。',
                                      okText: '撤销导入',
                                      cancelText: '关闭',
                                      okType: 'default',
                                      onOk: async () => {
                                        await statementAPI.rollbackImport({ backupId })
                                        message.success('已撤销导入')
                                        await loadProductionData()
                                      }
                                    })
                                  }
                                } catch (e) {
                                  console.error(e)
                                  const serverMsg = e?.response?.data?.message || e?.response?.data?.error
                                  message.error(serverMsg || e?.message || '导入失败')
                                } finally {
                                  setStatementImportLoading(false)
                                }
                              }
                            })
                          }}
                        >
                          确认导入
                        </Button>
                      ]}
                    >
                      <Space direction="vertical" style={{ width: '100%' }} size={12}>
                        <Upload
                          accept=".xlsx,.xls,.csv"
                          maxCount={1}
                          beforeUpload={async (file) => {
                            setStatementImportPreview(null)
                            try {
                              const parsed = await parseImportedStatement(file)
                              setStatementImportPreview(parsed)
                              setStatementImportOverwriteExisting(Boolean(parsed?.existingStatementNo))
                              setStatementImportOverwriteStatementNo(String(parsed?.existingStatementNo || '').trim())
                              message.success('文件解析成功，请确认预览后导入')
                            } catch (e) {
                              message.error(e?.message || '文件解析失败')
                            }
                            return Upload.LIST_IGNORE
                          }}
                          showUploadList={false}
                        >
                          <Button icon={<UploadOutlined />}>选择Excel/CSV文件</Button>
                        </Upload>

                        {statementImportPreview ? (
                          <>
                            {(() => {
                              const existingNo = String(statementImportPreview?.existingStatementNo || '').trim()
                              return (
                                <Card size="small">
                                  <Space align="center" wrap>
                                    <span style={{ color: '#6b7280' }}>覆盖现有对账单号：</span>
                                    <Button
                                      type={statementImportOverwriteExisting ? 'primary' : 'default'}
                                      onClick={() => setStatementImportOverwriteExisting((v) => !v)}
                                    >
                                      {statementImportOverwriteExisting ? '已开启覆盖' : '未开启覆盖'}
                                    </Button>
                                    <Input
                                      style={{ width: 220 }}
                                      value={statementImportOverwriteStatementNo}
                                      onChange={(e) => setStatementImportOverwriteStatementNo(e.target.value)}
                                      placeholder={existingNo || '请输入要覆盖的对账单号（可选）'}
                                    />
                                    {statementImportOverwriteExisting ? (
                                      <span style={{ color: (existingNo || String(statementImportOverwriteStatementNo || '').trim()) ? '#6b7280' : '#cf1322' }}>
                                        {(() => {
                                          const override = String(statementImportOverwriteStatementNo || '').trim()
                                          if (override) return `将使用：${override}`
                                          if (existingNo) return `将使用：${existingNo}`
                                          return '未检测到可覆盖的对账单号，请手动填写'
                                        })()}
                                      </span>
                                    ) : null}
                                  </Space>
                                </Card>
                              )
                            })()}
                            <Row gutter={16}>
                              <Col span={12}>
                                <div>客户：<b>{statementImportPreview.customer}</b></div>
                                <div>期间：{statementImportPreview.period}</div>
                                <div>
                                  导入后对账单号：
                                  {(() => {
                                    const existingNo = String(statementImportPreview?.existingStatementNo || '').trim()
                                    const override = String(statementImportOverwriteStatementNo || '').trim()
                                    const used = statementImportOverwriteExisting && (override || existingNo)
                                      ? (override || existingNo)
                                      : String(statementImportPreview.statementNo || '')
                                    return used
                                  })()}
                                </div>
                              </Col>
                              <Col span={12}>
                                <div>格式：{statementImportPreview.template === 'deliveryDetail' ? '送货明细' : '对账单'}</div>
                                <div>结款方式：{statementImportPreview.paymentTerm || '-'}</div>
                                <div>合计金额：<b>¥{Number(statementImportPreview.totalAmount || 0).toFixed(2)}</b></div>
                              </Col>
                            </Row>
                            {statementImportPreview.template === 'deliveryDetail' ? (
                              <Table
                                rowKey="key"
                                columns={[
                                  { title: '序号', dataIndex: 'seq', key: 'seq', width: 80 },
                                  { title: '品名规格', dataIndex: 'nameSpec', key: 'nameSpec' },
                                  { title: '金额（含税）', dataIndex: 'amountIncl', key: 'amountIncl', width: 140, render: (v) => (v === '' || v == null ? '' : Number(v || 0).toFixed(2)) }
                                ]}
                                dataSource={statementImportPreview.previewRows || []}
                                pagination={false}
                                size="small"
                                scroll={{ y: 320 }}
                                summary={() => (
                                  <Table.Summary.Row>
                                    <Table.Summary.Cell index={0} colSpan={2} align="right">
                                      合计
                                    </Table.Summary.Cell>
                                    <Table.Summary.Cell index={2}>
                                      {Number(statementImportPreview.totalAmount || 0) ? Number(statementImportPreview.totalAmount || 0).toFixed(2) : ''}
                                    </Table.Summary.Cell>
                                  </Table.Summary.Row>
                                )}
                              />
                            ) : (
                              <Table
                                rowKey="key"
                                columns={statementPreviewColumnsStandardReadonly}
                                dataSource={statementImportPreview.rows}
                                pagination={false}
                                size="small"
                                scroll={{ y: 320 }}
                                summary={() => (
                                  <Table.Summary.Row>
                                    <Table.Summary.Cell index={0} colSpan={6} align="right">
                                      合计
                                    </Table.Summary.Cell>
                                    <Table.Summary.Cell index={6}>
                                      {Number(statementImportPreview.totalAmount || 0) ? Number(statementImportPreview.totalAmount || 0).toFixed(2) : ''}
                                    </Table.Summary.Cell>
                                    <Table.Summary.Cell index={7} />
                                  </Table.Summary.Row>
                                )}
                              />
                            )}
                            {Array.isArray(statementImportPreview.importErrors) && statementImportPreview.importErrors.length ? (
                              (() => {
                                const errs = Array.isArray(statementImportPreview.importErrors) ? statementImportPreview.importErrors : []
                                const invalidRows = errs.filter((e) => Number(e?.row || 0) > 0)
                                const infoMessages = errs.filter((e) => !(Number(e?.row || 0) > 0))
                                return (
                                  <>
                                    {invalidRows.length ? (
                                      <Card
                                        size="small"
                                        style={{ marginTop: 12 }}
                                        title={`导入校验提示（可部分成功导入，已跳过无效行：${invalidRows.length}条）`}
                                      >
                                        <div style={{ maxHeight: 160, overflow: 'auto' }}>
                                          {invalidRows.slice(0, 50).map((e, idx) => (
                                            <div key={`${e?.row || 0}_${idx}`} style={{ color: '#cf1322' }}>
                                              行{e?.row}：{String(e?.message || '')}
                                            </div>
                                          ))}
                                          {invalidRows.length > 50 ? (
                                            <div style={{ color: '#6b7280' }}>仅展示前50条无效行</div>
                                          ) : null}
                                        </div>
                                      </Card>
                                    ) : null}
                                    {infoMessages.length ? (
                                      <Card
                                        size="small"
                                        style={{ marginTop: 12 }}
                                        title="导入信息提示"
                                      >
                                        <div style={{ maxHeight: 160, overflow: 'auto' }}>
                                          {infoMessages.slice(0, 50).map((e, idx) => (
                                            <div key={`info_${idx}`} style={{ color: '#6b7280' }}>
                                              {String(e?.message || '')}
                                            </div>
                                          ))}
                                          {infoMessages.length > 50 ? (
                                            <div style={{ color: '#6b7280' }}>仅展示前50条提示信息</div>
                                          ) : null}
                                        </div>
                                      </Card>
                                    ) : null}
                                  </>
                                )
                              })()
                            ) : null}
                          </>
                        ) : (
                          <div style={{ color: '#6b7280' }}>请选择与导出格式一致的对账单文件，系统会先解析并显示预览。</div>
                        )}
                      </Space>
                    </Modal>
                    <Modal
                      title={receivableStatementDetailTitle || '对账单明细'}
                      open={receivableStatementDetailOpen}
                      onCancel={() => {
                        setReceivableStatementDetailOpen(false)
                        setReceivableStatementDetailTitle('')
                        setReceivableStatementDetailRows([])
                        setReceivableStatementDetailColumns([])
                        setReceivableStatementDetailTemplate('standard')
                        setReceivableStatementDetailTotalAmount(0)
                        setReceivableStatementDetailLayout(null)
                      }}
                      footer={[
                        <Button
                          key="close"
                          onClick={() => {
                            setReceivableStatementDetailOpen(false)
                            setReceivableStatementDetailTitle('')
                            setReceivableStatementDetailRows([])
                            setReceivableStatementDetailColumns([])
                            setReceivableStatementDetailTemplate('standard')
                            setReceivableStatementDetailTotalAmount(0)
                            setReceivableStatementDetailLayout(null)
                          }}
                        >
                          关闭
                        </Button>
                      ]}
                      width={980}
                      destroyOnHidden
                    >
                      {receivableStatementDetailTemplate === 'deliveryDetail' && receivableStatementDetailLayout && Array.isArray(receivableStatementDetailLayout?.aoa) && receivableStatementDetailLayout.aoa.length ? (
                        <Space direction="vertical" style={{ width: '100%' }} size={12}>
                          {renderSheetLayoutTable(receivableStatementDetailLayout)}
                          <div style={{ display: 'flex', justifyContent: 'flex-end', fontWeight: 600 }}>
                            合计：{Number(receivableStatementDetailTotalAmount || 0) ? Number(receivableStatementDetailTotalAmount || 0).toFixed(2) : ''}
                          </div>
                        </Space>
                      ) : (
                        <Table
                          rowKey="key"
                          columns={receivableStatementDetailColumns.length ? receivableStatementDetailColumns : statementPreviewColumnsStandardReadonly}
                          dataSource={receivableStatementDetailRows}
                          pagination={false}
                          size="small"
                          scroll={{ y: 520 }}
                          summary={() => {
                            const rows = Array.isArray(receivableStatementDetailRows) ? receivableStatementDetailRows : []
                            const total =
                              receivableStatementDetailTemplate === 'deliveryDetail'
                                ? Number(receivableStatementDetailTotalAmount || 0)
                                : rows.reduce((sum, r) => {
                                  const v = Number.isFinite(Number(r?.amount)) ? Number(r.amount) : calcRowAmount(r)
                                  return sum + (Number.isFinite(v) ? v : 0)
                                }, 0)
                            return (
                              <Table.Summary.Row>
                                <Table.Summary.Cell index={0} colSpan={receivableStatementDetailTemplate === 'deliveryDetail' ? 2 : 6} align="right">
                                  合计
                                </Table.Summary.Cell>
                                <Table.Summary.Cell index={receivableStatementDetailTemplate === 'deliveryDetail' ? 2 : 6}>
                                  {total ? total.toFixed(2) : ''}
                                </Table.Summary.Cell>
                                {receivableStatementDetailTemplate === 'deliveryDetail' ? null : <Table.Summary.Cell index={7} />}
                              </Table.Summary.Row>
                            )
                          }}
                        />
                      )}
                    </Modal>
                    <Modal
                      title="回款录入"
                      open={receivablePaymentModalVisible}
                      onOk={handlePayment}
                      onCancel={() => {
                        setReceivablePaymentModalVisible(false)
                        setReceivablePaymentRecord(null)
                        setReceivablePaymentAmount(null)
                      }}
                      destroyOnHidden
                    >
                      {receivablePaymentRecord && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                          <Row>
                            <Col span={8}>客户名称：</Col>
                            <Col span={16} style={{ fontWeight: 'bold' }}>{receivablePaymentRecord.customerName}</Col>
                          </Row>
                          <Row>
                            <Col span={8}>对账单号：</Col>
                            <Col span={16}>{receivablePaymentRecord.statementNo}</Col>
                          </Row>
                          <Row>
                            <Col span={8}>对账月份：</Col>
                            <Col span={16}>
                              {(() => {
                                const sn = receivablePaymentRecord.statementNo
                                if (sn && sn.startsWith('QXDZD')) {
                                  const y = sn.substr(5, 4)
                                  const m = sn.substr(9, 2)
                                  return `${y}年${m}月`
                                }
                                return receivablePaymentRecord.date || '-'
                              })()}
                            </Col>
                          </Row>
                          <Row>
                            <Col span={8}>对账金额：</Col>
                            <Col span={16}>¥{Number(receivablePaymentRecord.amountReceivable || 0).toLocaleString()}</Col>
                          </Row>
                          <Row align="middle">
                            <Col span={8}>本次回款金额：</Col>
                            <Col span={16}>
                              <InputNumber
                                style={{ width: '100%' }}
                                value={receivablePaymentAmount}
                                onChange={setReceivablePaymentAmount}
                                prefix="¥"
                                precision={2}
                                placeholder="请输入金额"
                              />
                            </Col>
                          </Row>
                        </div>
                      )}
                    </Modal>
                    <Modal
                      title={receivableRemarkRecord ? `设置备注（${receivableRemarkRecord.statementNo || ''}）` : '设置备注'}
                      open={receivableRemarkModalOpen}
                      onOk={handleReceivableRemarkSubmit}
                      onCancel={() => {
                        setReceivableRemarkModalOpen(false)
                        setReceivableRemarkRecord(null)
                        setReceivableRemarkText('')
                      }}
                      destroyOnHidden
                    >
                      <Input.TextArea
                        rows={4}
                        value={receivableRemarkText}
                        onChange={(e) => setReceivableRemarkText(e.target.value)}
                        placeholder="请输入备注"
                        allowClear
                      />
                    </Modal>
                    <Modal
                      title={receivableEditRecord ? `编辑应收（${receivableEditRecord.statementNo || ''}）` : '编辑应收'}
                      open={receivableEditModalOpen}
                      onCancel={closeReceivableEditModal}
                      footer={[
                        <Button key="cancel" onClick={closeReceivableEditModal}>
                          取消
                        </Button>,
                        <Button
                          key="void"
                          danger
                          onClick={handleVoidStatementFromEdit}
                          disabled={receivableVoidLoading || !receivableEditRecord?.statementNo}
                        >
                          作废对账单
                        </Button>,
                        <Button
                          key="voidInvoice"
                          danger
                          onClick={handleVoidInvoiceFromEdit}
                          disabled={
                            receivableVoidLoading ||
                            !receivableEditRecord?.statementNo ||
                            !statementOrders.some(
                              (o) =>
                                String(o?.statementNo || '') === String(receivableEditRecord?.statementNo || '') &&
                                String(o?.invoiceDate || '').trim()
                            )
                          }
                        >
                          发票作废
                        </Button>,
                        <Button
                          key="ok"
                          type="primary"
                          onClick={handleReceivableEditSubmit}
                          disabled={receivableVoidLoading}
                        >
                          确认
                        </Button>
                      ]}
                      destroyOnHidden
                    >
                      {receivableEditRecord && (
                        <Space direction="vertical" style={{ width: '100%' }} size={12}>
                          <Row gutter={12} align="middle">
                            <Col span={6}>客户名称</Col>
                            <Col span={18} style={{ fontWeight: 'bold' }}>{receivableEditRecord.customerName || '-'}</Col>
                          </Row>
                          <Row gutter={12} align="middle">
                            <Col span={6}>对账单号</Col>
                            <Col span={18}>{receivableEditRecord.statementNo || '-'}</Col>
                          </Row>
                          <Row gutter={12} align="middle">
                            <Col span={6}>对账金额</Col>
                            <Col span={18}>¥{Number(receivableEditRecord.amountReceivable || 0).toLocaleString()}</Col>
                          </Row>
                          <Row gutter={12} align="middle">
                            <Col span={6}>已收金额</Col>
                            <Col span={18}>
                              <InputNumber
                                style={{ width: '100%' }}
                                value={receivableEditAmountReceived}
                                onChange={setReceivableEditAmountReceived}
                                prefix="¥"
                                precision={2}
                                min={0}
                                placeholder="请输入已收金额"
                              />
                            </Col>
                          </Row>
                          <Row gutter={12} align="middle">
                            <Col span={6}>付款日期</Col>
                            <Col span={18}>
                              <DatePicker
                                style={{ width: '100%' }}
                                value={receivableEditPaymentDate}
                                onChange={setReceivableEditPaymentDate}
                                placeholder="选择付款日期"
                              />
                            </Col>
                          </Row>
                          <Row gutter={12} align="middle">
                            <Col span={6}>到期时间</Col>
                            <Col span={18}>
                              <DatePicker
                                style={{ width: '100%' }}
                                value={receivableEditDueDate}
                                onChange={setReceivableEditDueDate}
                                placeholder="选择到期时间"
                              />
                            </Col>
                          </Row>
                          <Row gutter={12} align="middle">
                            <Col span={6}>开票日期</Col>
                            <Col span={18}>
                              <DatePicker
                                style={{ width: '100%' }}
                                value={receivableEditInvoiceDate}
                                onChange={setReceivableEditInvoiceDate}
                                placeholder="选择开票日期"
                              />
                            </Col>
                          </Row>
                          <Row gutter={12} align="top">
                            <Col span={6}>备注</Col>
                            <Col span={18}>
                              <Input.TextArea
                                rows={3}
                                value={receivableEditRemark}
                                onChange={(e) => setReceivableEditRemark(e.target.value)}
                                placeholder="请输入备注"
                                allowClear
                              />
                            </Col>
                          </Row>
                        </Space>
                      )}
                    </Modal>
                  </Card>
                </>
              )
            },
            {
              key: 'payable',
              label: '应付款管理',
              children: (
                <>
                  {renderStatCards([
                    {
                      title: '应付合计',
                      value: payableTotalPayable,
                      precision: 2,
                      prefix: <DollarOutlined />,
                      suffix: '元',
                      color: '#111827'
                    },
                    {
                      title: '已付合计',
                      value: payableTotalPaid,
                      precision: 2,
                      prefix: <DollarOutlined />,
                      suffix: '元',
                      color: '#111827'
                    },
                    {
                      title: '待付货款(本月到期)',
                      value: payableTotalDueToPay,
                      precision: 2,
                      prefix: <DollarOutlined />,
                      suffix: '元',
                      color: '#faad14'
                    },
                    {
                      title: '未付的货款合计',
                      value: payableTotalUnpaid,
                      precision: 2,
                      prefix: <DollarOutlined />,
                      suffix: '元',
                      color: '#111827'
                    }
                  ])}

                  <Card>
                    <Space style={{ marginBottom: 16 }} wrap>
                      <Input
                        placeholder="搜索供应商名称"
                        value={payableKeyword}
                        onChange={(e) => setPayableKeyword(e.target.value)}
                        allowClear
                        style={{ width: 200 }}
                      />
                      <Select
                        allowClear
                        placeholder="应付状态"
                        value={payableStatus}
                        onChange={setPayableStatus}
                        style={{ width: 160 }}
                      >
                        <Option value="pending">待付款</Option>
                        <Option value="partial">部分付款</Option>
                        <Option value="paid">已付清</Option>
                      </Select>
                      <Select
                        value={payableYear}
                        onChange={setPayableYear}
                        style={{ width: 100 }}
                        options={(() => {
                          const curr = dayjs().year()
                          const opts = []
                          for (let y = curr; y >= 2023; y--) {
                            opts.push({ label: `${y}年`, value: y })
                          }
                          return opts
                        })()}
                      />
                      <Select
                        value={payableMonth}
                        onChange={setPayableMonth}
                        style={{ width: 100 }}
                        options={Array.from({ length: 12 }, (_, i) => ({
                          label: `${i + 1}月`,
                          value: i + 1
                        }))}
                      />
                      <Button type="primary" onClick={openPayableCreateModal}>
                        添加应付款
                      </Button>
                      {!payablePaymentMode ? (
                        <Button type="primary" onClick={startPayablePaymentMode}>
                          供应商付款
                        </Button>
                      ) : (
                        <Space>
                          <Button
                            type="primary"
                            onClick={confirmPayablePaymentFromList}
                            disabled={payablePaySelectedKeys.length !== 1}
                          >
                            确认付款
                          </Button>
                          <Button onClick={cancelPayablePaymentMode}>
                            取消
                          </Button>
                        </Space>
                      )}
                    </Space>
                    <Table
                      rowKey="key"
                      columns={payableColumns}
                      dataSource={filteredPayables}
                      pagination={{
                        pageSize: 10,
                        showSizeChanger: true
                      }}
                      rowSelection={payablePaymentMode ? {
                        type: 'checkbox',
                        selectedRowKeys: payablePaySelectedKeys,
                        onChange: (keys) => setPayablePaySelectedKeys(keys),
                        getCheckboxProps: (record) => ({
                          disabled: (record && record.status === 'paid')
                        })
                      } : undefined}
                    />
                    <Modal
                      open={payableCreateModalOpen}
                      title="添加应付款"
                      onCancel={() => setPayableCreateModalOpen(false)}
                      onOk={handleCreatePayable}
                      okText="确认"
                      cancelText="取消"
                      destroyOnHidden
                    >
                      <Space direction="vertical" style={{ width: '100%' }} size={12}>
                        <Row gutter={12} align="middle">
                          <Col span={6}>供应商名称</Col>
                          <Col span={18}>
                            <Select
                              showSearch
                              allowClear
                              value={payableFormSupplierName || undefined}
                              placeholder="请选择供应商全称"
                              onChange={(v) => setPayableFormSupplierName(v || '')}
                              style={{ width: '100%' }}
                              options={(() => {
                                const uniq = new Map()
                                  ; (allSuppliers || []).forEach((s) => {
                                    const fullName = String(s?.companyName || s?.name || s?.company || '').trim()
                                    if (!fullName) return
                                    if (!uniq.has(fullName)) {
                                      uniq.set(fullName, { value: fullName, label: fullName })
                                    }
                                  })
                                return Array.from(uniq.values())
                              })()}
                              filterOption={(inputValue, option) => {
                                const input = String(inputValue || '').toLowerCase()
                                const label = String(option?.label || option?.value || '').toLowerCase()
                                return label.includes(input)
                              }}
                            />
                          </Col>
                        </Row>
                        <Row gutter={12} align="middle">
                          <Col span={6}>收票时间</Col>
                          <Col span={18}>
                            <Space>
                              <Select
                                value={payableFormInvoiceYear}
                                onChange={setPayableFormInvoiceYear}
                                style={{ width: 120 }}
                                options={(() => {
                                  const curr = dayjs().year()
                                  const opts = []
                                  for (let y = curr; y >= 2023; y--) {
                                    opts.push({ label: `${y}年`, value: y })
                                  }
                                  return opts
                                })()}
                              />
                              <Select
                                value={payableFormInvoiceMonth}
                                onChange={setPayableFormInvoiceMonth}
                                style={{ width: 120 }}
                                options={Array.from({ length: 12 }, (_, i) => ({
                                  label: `${i + 1}月`,
                                  value: i + 1
                                }))}
                              />
                            </Space>
                          </Col>
                        </Row>
                        <Row gutter={12} align="middle">
                          <Col span={6}>应付金额</Col>
                          <Col span={18}>
                            <InputNumber
                              style={{ width: '100%' }}
                              value={payableFormAmountPayable}
                              onChange={setPayableFormAmountPayable}
                              prefix="¥"
                              precision={2}
                              placeholder="请输入应付金额"
                            />
                          </Col>
                        </Row>
                        <Row gutter={12} align="middle">
                          <Col span={6}>付款账期</Col>
                          <Col span={18}>
                            <Select
                              value={payableFormPaymentTerm}
                              onChange={setPayableFormPaymentTerm}
                              style={{ width: '100%' }}
                              options={[
                                { label: '现付', value: '现付' },
                                { label: '月结30天', value: '月结30天' },
                                { label: '月结60天', value: '月结60天' },
                                { label: '月结90天', value: '月结90天' }
                              ]}
                            />
                          </Col>
                        </Row>
                        <Row gutter={12} align="middle">
                          <Col span={6}>发票图片</Col>
                          <Col span={18}>
                            <Space direction="vertical" style={{ width: '100%' }} size={8}>
                              <Space>
                                {payableFormInvoiceImageDataUrl || payableFormInvoiceImageUrlText ? (
                                  <Image
                                    src={payableFormInvoiceImageDataUrl || payableFormInvoiceImageUrlText}
                                    width={48}
                                    height={48}
                                    style={{ objectFit: 'cover', borderRadius: 6 }}
                                  />
                                ) : (
                                  <span style={{ color: '#9ca3af' }}>未选择</span>
                                )}
                                <Upload
                                  accept="image/*"
                                  showUploadList={false}
                                  beforeUpload={(file) => {
                                    void (async () => {
                                      try {
                                        message.open({ type: 'loading', content: '正在上传发票图片...', key: 'payable_invoice_upload', duration: 0 })
                                        const uploaded = await uploadPayableInvoiceImageFile(file)
                                        setPayableFormInvoiceImageDataUrl(uploaded?.url || '')
                                        setPayableFormInvoiceImageUrlText('')
                                        setPayableFormInvoiceImageFileId(uploaded?.fileID || '')
                                        setPayableFormInvoiceImageName(file?.name || '')
                                        message.open({ type: 'success', content: '发票图片已上传', key: 'payable_invoice_upload' })
                                      } catch (_) {
                                        setPayableFormInvoiceImageDataUrl('')
                                        setPayableFormInvoiceImageFileId('')
                                        setPayableFormInvoiceImageName('')
                                        message.open({ type: 'error', content: '上传发票图片失败', key: 'payable_invoice_upload' })
                                      }
                                    })()
                                    return false
                                  }}
                                >
                                  <Button size="small" icon={<UploadOutlined />}>
                                    上传
                                  </Button>
                                </Upload>
                                <Button
                                  size="small"
                                  onClick={() => {
                                    setPayableFormInvoiceImageUrlText('')
                                    setPayableFormInvoiceImageDataUrl('')
                                    setPayableFormInvoiceImageFileId('')
                                    setPayableFormInvoiceImageName('')
                                  }}
                                >
                                  清除
                                </Button>
                              </Space>
                              <Input
                                value={payableFormInvoiceImageUrlText}
                                onChange={(e) => {
                                  setPayableFormInvoiceImageUrlText(e.target.value)
                                  setPayableFormInvoiceImageDataUrl('')
                                  setPayableFormInvoiceImageFileId('')
                                  setPayableFormInvoiceImageName('')
                                }}
                                onPaste={handlePayableFormImagePaste}
                                placeholder="可粘贴图片链接，或直接在此粘贴截图"
                                allowClear
                              />
                            </Space>
                          </Col>
                        </Row>
                      </Space>
                    </Modal>
                    <Modal
                      open={payablePayModalOpen}
                      title="付款录入"
                      onCancel={() => {
                        setPayablePayModalOpen(false)
                        setPayablePayRecord(null)
                        setPayablePayAmount(null)
                        setPayablePayRemark('')
                      }}
                      onOk={handlePayablePayConfirm}
                      okText="确认"
                      cancelText="取消"
                      destroyOnHidden
                    >
                      {payablePayRecord && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                          <Row>
                            <Col span={8}>供应商名称：</Col>
                            <Col span={16} style={{ fontWeight: 'bold' }}>{payablePayRecord.supplierName || ''}</Col>
                          </Row>
                          <Row>
                            <Col span={8}>开票时间：</Col>
                            <Col span={16}>{payablePayRecord.invoiceDate || ''}</Col>
                          </Row>
                          <Row>
                            <Col span={8}>应付金额(元)：</Col>
                            <Col span={16} style={{ fontWeight: 'bold' }}>
                              ¥{Number(payablePayRecord.amountPayable || 0).toLocaleString()}
                            </Col>
                          </Row>
                          <Row>
                            <Col span={8}>发票图片：</Col>
                            <Col span={16}>
                              {(() => {
                                const url = payablePayRecord && payablePayRecord.invoiceImageUrl
                                  ? String(payablePayRecord.invoiceImageUrl)
                                  : ''
                                if (!url) return <span style={{ color: '#9ca3af' }}>未上传</span>
                                return (
                                  <Image
                                    src={url}
                                    width={120}
                                    style={{ borderRadius: 6 }}
                                  />
                                )
                              })()}
                            </Col>
                          </Row>
                          <Row align="middle">
                            <Col span={8}>付款金额(元)：</Col>
                            <Col span={16}>
                              <InputNumber
                                style={{ width: '100%' }}
                                value={payablePayAmount}
                                onChange={setPayablePayAmount}
                                prefix="¥"
                                precision={2}
                                placeholder="请输入付款金额"
                              />
                            </Col>
                          </Row>
                          <Row align="middle">
                            <Col span={8}>备注：</Col>
                            <Col span={16}>
                              <Input.TextArea
                                value={payablePayRemark}
                                onChange={(e) => setPayablePayRemark(e.target.value)}
                                placeholder="请输入备注"
                                rows={3}
                                allowClear
                              />
                            </Col>
                          </Row>
                        </div>
                      )}
                    </Modal>
                    <Modal
                      open={payableEditModalOpen}
                      title={payableEditRecord ? `编辑应付（${payableEditRecord.supplierName || ''}）` : '编辑应付'}
                      onCancel={resetPayableEditState}
                      onOk={handlePayableEditSubmit}
                      okText="确认"
                      cancelText="取消"
                      footer={[
                        <Button key="delete" danger onClick={handlePayableDelete} disabled={!payableEditRecord}>
                          删除
                        </Button>,
                        <Button key="cancel" onClick={resetPayableEditState}>
                          取消
                        </Button>,
                        <Button key="ok" type="primary" onClick={handlePayableEditSubmit}>
                          确认
                        </Button>
                      ]}
                      destroyOnHidden
                    >
                      {payableEditRecord && (
                        <Space direction="vertical" style={{ width: '100%' }} size={12}>
                          <Row gutter={12} align="middle">
                            <Col span={6}>供应商名称</Col>
                            <Col span={18}>
                              <Select
                                showSearch
                                allowClear
                                value={payableEditSupplierName || undefined}
                                placeholder="请选择供应商全称"
                                onChange={(v) => setPayableEditSupplierName(v || '')}
                                style={{ width: '100%' }}
                                options={(() => {
                                  const uniq = new Map()
                                    ; (allSuppliers || []).forEach((s) => {
                                      const fullName = String(s?.companyName || s?.name || s?.company || '').trim()
                                      if (!fullName) return
                                      if (!uniq.has(fullName)) {
                                        uniq.set(fullName, { value: fullName, label: fullName })
                                      }
                                    })
                                  return Array.from(uniq.values())
                                })()}
                                filterOption={(inputValue, option) => {
                                  const input = String(inputValue || '').toLowerCase()
                                  const label = String(option?.label || option?.value || '').toLowerCase()
                                  return label.includes(input)
                                }}
                              />
                            </Col>
                          </Row>
                          <Row gutter={12} align="middle">
                            <Col span={6}>收票时间</Col>
                            <Col span={18}>
                              <DatePicker
                                style={{ width: '100%' }}
                                value={payableEditInvoiceDate}
                                onChange={setPayableEditInvoiceDate}
                                placeholder="选择收票日期"
                              />
                            </Col>
                          </Row>
                          <Row gutter={12} align="middle">
                            <Col span={6}>到期时间</Col>
                            <Col span={18}>
                              <DatePicker
                                style={{ width: '100%' }}
                                value={payableEditDueDate}
                                onChange={setPayableEditDueDate}
                                placeholder="选择到期时间"
                              />
                            </Col>
                          </Row>
                          <Row gutter={12} align="middle">
                            <Col span={6}>应付金额</Col>
                            <Col span={18}>
                              <InputNumber
                                style={{ width: '100%' }}
                                value={payableEditAmountPayable}
                                onChange={setPayableEditAmountPayable}
                                prefix="¥"
                                precision={2}
                                min={0}
                                placeholder="请输入应付金额"
                              />
                            </Col>
                          </Row>
                          <Row gutter={12} align="middle">
                            <Col span={6}>已付金额</Col>
                            <Col span={18}>
                              <InputNumber
                                style={{ width: '100%' }}
                                value={payableEditAmountPaid}
                                onChange={setPayableEditAmountPaid}
                                prefix="¥"
                                precision={2}
                                min={0}
                                placeholder="请输入已付金额"
                              />
                            </Col>
                          </Row>
                          <Row gutter={12} align="middle">
                            <Col span={6}>付款日期</Col>
                            <Col span={18}>
                              <DatePicker
                                style={{ width: '100%' }}
                                value={payableEditPaymentDate}
                                onChange={setPayableEditPaymentDate}
                                placeholder="选择付款日期"
                              />
                            </Col>
                          </Row>
                          <Row gutter={12} align="middle">
                            <Col span={6}>付款账期</Col>
                            <Col span={18}>
                              <Select
                                value={payableEditPaymentTerm}
                                onChange={setPayableEditPaymentTerm}
                                style={{ width: '100%' }}
                                options={[
                                  { label: '现付', value: '现付' },
                                  { label: '月结30天', value: '月结30天' },
                                  { label: '月结60天', value: '月结60天' },
                                  { label: '月结90天', value: '月结90天' }
                                ]}
                              />
                            </Col>
                          </Row>
                        </Space>
                      )}
                    </Modal>
                  </Card>
                </>
              )
            }
          ]}
        />
      </div>
    </ConfigProvider>
  )
}

export default FinancialManagement
