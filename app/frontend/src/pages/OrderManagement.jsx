import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Table, Button, Space, Tag, Input, Select, DatePicker, Card, App, Modal, Form, Row, Col, ConfigProvider, Divider, Upload, Pagination, Image as AntImage, Descriptions, Spin } from 'antd'
import { PlusOutlined, DeleteOutlined, CheckCircleFilled, DownloadOutlined, UploadOutlined, ReloadOutlined, PlusSquareOutlined, MinusSquareOutlined } from '@ant-design/icons'
import { Link, useNavigate, useLocation } from 'react-router-dom'
import { orderAPI, supplierAPI, categoryAPI, api } from '../services/api'
import { cachedOrderAPI, cachedCustomerAPI, cachedCustomerSkuAPI } from '../services/cachedAPI'
import { matchSizeKeyword, extractListFromResponse, extractPaginationFromResponse } from '../utils'
import { invalidateCache } from '../utils/cachedAPI'
import { useLocalStorage } from '../hooks/useLocalStorage'
import * as statusFilterUtils from '../utils/orderManagementStatusFilter.js'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import 'dayjs/locale/zh-cn'
import * as XLSX from 'xlsx'

dayjs.locale('zh-cn')

const { RangePicker } = DatePicker

function OrderManagement() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const refreshTimerRef = useRef(null)
  const loadOrdersReqIdRef = useRef(0)
  const loadSummaryReqIdRef = useRef(0)
  const listPageRef = useRef(1)
  const listPageSizeRef = useRef(30)
  const inflightProfitRef = useRef(new Set())
  const profitCacheRef = useRef(new Map())
  const expandedStoreKey = 'erp_order_management_expanded_row_keys'
  const [loading, setLoading] = useState(false)
  const [allOrders, setAllOrders] = useState([])
  const [orders, setOrders] = useState([])
  const [listPage, setListPage] = useState(1)
  const [listPageSize, setListPageSize] = useState(100)
  const [listTotal, setListTotal] = useState(0)
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailOrder, setDetailOrder] = useState(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const detailReqIdRef = useRef(0)
  const ensureCustomerSkusLoadedRef = useRef(null)
  const [form] = Form.useForm()
  const [reservedId, setReservedId] = useState()
  const [customers, setCustomers] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [categories, setCategories] = useState(['纸箱', '隔板', '天地盒', '飞机盒', '异性纸盒'])
  const [customerSkusByCustomerId, setCustomerSkusByCustomerId] = useState({})
  const [creatingSupplier, setCreatingSupplier] = useState(false)
  const [creatingCategory, setCreatingCategory] = useState(false)
  const [creatingFlute, setCreatingFlute] = useState(false)
  const [supplierHistory, setSupplierHistory] = useState([])
  const [selectionMode] = useState(true)
  const [selectedRowKeys, setSelectedRowKeys] = useLocalStorage('erp_order_management_selected_row_keys', [])
  const [importOpen, setImportOpen] = useState(false)
  const [importFileName, setImportFileName] = useState('')
  const [importParsing, setImportParsing] = useState(false)
  const [importSubmitting, setImportSubmitting] = useState(false)
  const [importRows, setImportRows] = useState([])
  const [batchShippingOpen, setBatchShippingOpen] = useState(false)
  const [shippingOrders, setShippingOrders] = useState([])
  const [shippingForm] = Form.useForm()
  const [expandedRowKeys, setExpandedRowKeys] = useState(() => {
    try {
      if (typeof window === 'undefined') return []
      const raw = window.localStorage.getItem(expandedStoreKey) || '[]'
      const arr = JSON.parse(raw)
      return Array.isArray(arr) ? arr.map(String) : []
    } catch (_) {
      return []
    }
  })
  const [searchParams, setSearchParams] = useState(() => ({
    keyword: '',
    quickRange: '',
    dateRange: []
  }))
  const [statusFilter, setStatusFilter] = useLocalStorage('erp_order_management_status_filter', [])
  const [sortField] = useState('')
  const [sortDir] = useState('desc')
  const getStickyContainer = useCallback(() => {
    if (typeof document === 'undefined') return undefined
    return document.querySelector('.app-content') || document.body
  }, [])

  const safeText = (v) => String(v ?? '').trim()
  const isMeaningfulText = (v) => {
    const s = safeText(v)
    if (!s) return false
    const lower = s.toLowerCase()
    return !['-', '—', '--', '---', '暂无', '无', 'null', 'undefined'].includes(lower)
  }
  const pickText = (...candidates) => {
    for (const c of candidates) {
      if (isMeaningfulText(c)) return safeText(c)
    }
    return ''
  }
  const toNumber = (v) => {
    if (v === null || v === undefined || v === '') return NaN
    if (typeof v === 'number') return v
    const n = Number(String(v).trim())
    return Number.isFinite(n) ? n : NaN
  }
  const pickNumber = (...candidates) => {
    for (const c of candidates) {
      const n = toNumber(c)
      if (Number.isFinite(n)) return n
    }
    return NaN
  }
  const formatCrease = (o) => {
    const data = o?.data && typeof o.data === 'object' ? o.data : {}
    const meta = o?.meta && typeof o.meta === 'object' ? o.meta : {}
    const brief = meta?.brief && typeof meta.brief === 'object' ? meta.brief : {}
    const product = o?.product && typeof o.product === 'object' ? o.product : {}
    const first = Array.isArray(o?.items) && o.items.length && typeof o.items[0] === 'object' ? o.items[0] : {}
    const firstData = first?.data && typeof first.data === 'object' ? first.data : {}

    const c1 = Number(
      o?.creasingSize1 ?? o?.creaseSize1 ?? o?.creasingSize_1 ?? o?.creaseSize_1 ?? o?.creasing_size1 ?? o?.crease_size1 ?? o?.creasing_size_1 ?? o?.crease_size_1 ??
      data?.creasingSize1 ?? data?.creaseSize1 ?? data?.creasingSize_1 ?? data?.creaseSize_1 ?? data?.creasing_size1 ?? data?.crease_size1 ?? data?.creasing_size_1 ?? data?.crease_size_1 ??
      meta?.creasingSize1 ?? meta?.creaseSize1 ?? meta?.creasingSize_1 ?? meta?.creaseSize_1 ?? meta?.creasing_size1 ?? meta?.crease_size1 ?? meta?.creasing_size_1 ?? meta?.crease_size_1 ??
      brief?.creasingSize1 ?? brief?.creaseSize1 ?? brief?.creasingSize_1 ?? brief?.creaseSize_1 ?? brief?.creasing_size1 ?? brief?.crease_size1 ?? brief?.creasing_size_1 ?? brief?.crease_size_1 ??
      product?.creasingSize1 ?? product?.creaseSize1 ?? product?.creasingSize_1 ?? product?.creaseSize_1 ?? product?.creasing_size1 ?? product?.crease_size1 ?? product?.creasing_size_1 ?? product?.crease_size_1 ??
      first?.creasingSize1 ?? first?.creaseSize1 ?? first?.creasingSize_1 ?? first?.creaseSize_1 ?? first?.creasing_size1 ?? first?.crease_size1 ?? first?.creasing_size_1 ?? first?.crease_size_1 ??
      firstData?.creasingSize1 ?? firstData?.creaseSize1 ?? firstData?.creasingSize_1 ?? firstData?.creaseSize_1 ?? firstData?.creasing_size1 ?? firstData?.crease_size1 ?? firstData?.creasing_size_1 ?? firstData?.crease_size_1 ??
      0
    )
    const c2 = Number(
      o?.creasingSize2 ?? o?.creaseSize2 ?? o?.creasingSize_2 ?? o?.creaseSize_2 ?? o?.creasing_size2 ?? o?.crease_size2 ?? o?.creasing_size_2 ?? o?.crease_size_2 ??
      data?.creasingSize2 ?? data?.creaseSize2 ?? data?.creasingSize_2 ?? data?.creaseSize_2 ?? data?.creasing_size2 ?? data?.crease_size2 ?? data?.creasing_size_2 ?? data?.crease_size_2 ??
      meta?.creasingSize2 ?? meta?.creaseSize2 ?? meta?.creasingSize_2 ?? meta?.creaseSize_2 ?? meta?.creasing_size2 ?? meta?.crease_size2 ?? meta?.creasing_size_2 ?? meta?.crease_size_2 ??
      brief?.creasingSize2 ?? brief?.creaseSize2 ?? brief?.creasingSize_2 ?? brief?.creaseSize_2 ?? brief?.creasing_size2 ?? brief?.crease_size2 ?? brief?.creasing_size_2 ?? brief?.crease_size_2 ??
      product?.creasingSize2 ?? product?.creaseSize2 ?? product?.creasingSize_2 ?? product?.creaseSize_2 ?? product?.creasing_size2 ?? product?.crease_size2 ?? product?.creasing_size_2 ?? product?.crease_size_2 ??
      first?.creasingSize2 ?? first?.creaseSize2 ?? first?.creasingSize_2 ?? first?.creaseSize_2 ?? first?.creasing_size2 ?? first?.crease_size2 ?? first?.creasing_size_2 ?? first?.crease_size_2 ??
      firstData?.creasingSize2 ?? firstData?.creaseSize2 ?? firstData?.creasingSize_2 ?? firstData?.creaseSize_2 ?? firstData?.creasing_size2 ?? firstData?.crease_size2 ?? firstData?.creasing_size_2 ?? firstData?.crease_size_2 ??
      0
    )
    const c3 = Number(
      o?.creasingSize3 ?? o?.creaseSize3 ?? o?.creasingSize_3 ?? o?.creaseSize_3 ?? o?.creasing_size3 ?? o?.crease_size3 ?? o?.creasing_size_3 ?? o?.crease_size_3 ??
      data?.creasingSize3 ?? data?.creaseSize3 ?? data?.creasingSize_3 ?? data?.creaseSize_3 ?? data?.creasing_size3 ?? data?.crease_size3 ?? data?.creasing_size_3 ?? data?.crease_size_3 ??
      meta?.creasingSize3 ?? meta?.creaseSize3 ?? meta?.creasingSize_3 ?? meta?.creaseSize_3 ?? meta?.creasing_size3 ?? meta?.crease_size3 ?? meta?.creasing_size_3 ?? meta?.crease_size_3 ??
      brief?.creasingSize3 ?? brief?.creaseSize3 ?? brief?.creasingSize_3 ?? brief?.creaseSize_3 ?? brief?.creasing_size3 ?? brief?.crease_size3 ?? brief?.creasing_size_3 ?? brief?.crease_size_3 ??
      product?.creasingSize3 ?? product?.creaseSize3 ?? product?.creasingSize_3 ?? product?.creaseSize_3 ?? product?.creasing_size3 ?? product?.crease_size3 ?? product?.creasing_size_3 ?? product?.crease_size_3 ??
      first?.creasingSize3 ?? first?.creaseSize3 ?? first?.creasingSize_3 ?? first?.creaseSize_3 ?? first?.creasing_size3 ?? first?.crease_size3 ?? first?.creasing_size_3 ?? first?.crease_size_3 ??
      firstData?.creasingSize3 ?? firstData?.creaseSize3 ?? firstData?.creasingSize_3 ?? firstData?.creaseSize_3 ?? firstData?.creasing_size3 ?? firstData?.crease_size3 ?? firstData?.creasing_size_3 ?? firstData?.crease_size_3 ??
      0
    )
    const type = pickText(
      o?.creasingType, o?.creasing_type, o?.creaseType, o?.crease_type,
      data?.creasingType, data?.creasing_type, data?.creaseType, data?.crease_type,
      meta?.creasingType, meta?.creasing_type, meta?.creaseType, meta?.crease_type,
      brief?.creasingType, brief?.creasing_type, brief?.creaseType, brief?.crease_type,
      product?.creasingType, product?.creasing_type, product?.creaseType, product?.crease_type,
      first?.creasingType, first?.creasing_type, first?.creaseType, first?.crease_type,
      firstData?.creasingType, firstData?.creasing_type, firstData?.creaseType, firstData?.crease_type
    )
    const pressLine = pickText(
      o?.pressLine, o?.press_line, o?.pressLineSize, o?.press_line_size, o?.creasingSize, o?.creaseSize, o?.creasing_size, o?.crease_size,
      data?.pressLine, data?.press_line, data?.pressLineSize, data?.press_line_size, data?.creasingSize, data?.creaseSize, data?.creasing_size, data?.crease_size,
      meta?.pressLine, meta?.press_line, meta?.pressLineSize, meta?.press_line_size, meta?.creasingSize, meta?.creaseSize, meta?.creasing_size, meta?.crease_size,
      brief?.pressLine, brief?.press_line, brief?.pressLineSize, brief?.press_line_size, brief?.creasingSize, brief?.creaseSize, brief?.creasing_size, brief?.crease_size,
      product?.pressLine, product?.press_line, product?.pressLineSize, product?.press_line_size, product?.creasingSize, product?.creaseSize, product?.creasing_size, product?.crease_size,
      first?.pressLine, first?.press_line, first?.pressLineSize, first?.press_line_size, first?.creasingSize, first?.creaseSize, first?.creasing_size, first?.crease_size,
      firstData?.pressLine, firstData?.press_line, firstData?.pressLineSize, firstData?.press_line_size, firstData?.creasingSize, firstData?.creaseSize, firstData?.creasing_size, firstData?.crease_size
    )
    const hasNums = Boolean(c1 || c2 || c3)
    if (pressLine) {
      const nums = (pressLine.match(/-?\d+(\.\d+)?/g) || []).map(Number).filter(Number.isFinite)
      const typeMatch = pressLine.match(/[（(]([^（）()]+)[）)]/)
      const t = typeMatch ? typeMatch[1] : ''
      if (nums.length >= 2) return `${nums.join('-')}${t ? ` (${t})` : ''}`
      return pressLine
    }
    if (!hasNums && !type) return '-'
    if (!hasNums) return type
    return `${c1}-${c2}-${c3}${type ? ` (${type})` : ''}`
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
        if (data.data && typeof data.data === 'object') return data.data
      }
      if (data && typeof data === 'object') return data
      if (data) return data
    }
    return body
  }
  const mergeOrder = (base, fetched) => {
    const b = base && typeof base === 'object' ? base : {}
    const f = fetched && typeof fetched === 'object' ? fetched : {}
    const next = { ...b, ...f }
    const isItemChild = Boolean(b?.__itemChild)
    const bData = b?.data && typeof b.data === 'object' ? b.data : null
    const fData = f?.data && typeof f.data === 'object' ? f.data : null
    const bMeta = b?.meta && typeof b.meta === 'object' ? b.meta : null
    const fMeta = f?.meta && typeof f.meta === 'object' ? f.meta : null
    if (bData || fData) next.data = { ...(bData || {}), ...(fData || {}) }
    if (bMeta || fMeta) next.meta = { ...(bMeta || {}), ...(fMeta || {}) }
    const fItems =
      Array.isArray(f?.items) ? f.items
        : Array.isArray(f?.data?.items) ? f.data.items
          : Array.isArray(f?.data?.data?.items) ? f.data.data.items
            : Array.isArray(f?.meta?.items) ? f.meta.items
              : []
    if (!isItemChild && Array.isArray(fItems) && fItems.length) next.items = fItems

    if (isItemChild) {
      const baseOrderNo = pickText(b?.orderNo, b?.orderNumber, b?.order_number, b?.no)
      if (baseOrderNo) {
        next.orderNo = baseOrderNo
        next.orderNumber = baseOrderNo
        next.order_number = baseOrderNo
      }
      if (b?.key) next.key = b.key
      if (b?.__parentOrderId) next.__parentOrderId = b.__parentOrderId
      if (b?.__parentNo) next.__parentNo = b.__parentNo
      next.__itemChild = true

      const preferValue = (k) => {
        const v = b?.[k]
        if (v === 0) {
          next[k] = 0
          return
        }
        if (typeof v === 'number') {
          if (Number.isFinite(v)) next[k] = v
          return
        }
        if (isMeaningfulText(v)) next[k] = v
      }
      ;[
        'productName',
        'productTitle',
        'goodsName',
        'spec',
        'specification',
        'materialNo',
        'materialCode',
        'flute',
        'quantity',
        'unitPrice',
        'amount',
        'skuId',
        'customerSkuId',
        'customer_sku_id',
        'creasingType',
        'creasingSize1',
        'creasingSize2',
        'creasingSize3',
        'pressLine',
        'pressLineSize',
        'press_line',
        'press_line_size'
      ].forEach(preferValue)
    }
    return next
  }
  const normalizeDetailOrder = (input) => {
    const o = input && typeof input === 'object' ? input : {}
    const data = o?.data && typeof o.data === 'object' ? o.data : {}
    const meta = o?.meta && typeof o.meta === 'object' ? o.meta : {}
    const brief = meta?.brief && typeof meta.brief === 'object' ? meta.brief : {}
    const orderNo = pickText(o.orderNo, o.orderNumber, o.order_number, o.no, data.orderNo, data.orderNumber, data.order_number, data.no)
    const customerName = pickText(
      o.customerName,
      o.customer_name,
      o.customer?.companyName,
      o.customer?.shortName,
      o.customer?.name,
      data.customerName,
      data.customer_name,
      meta.customerName,
      meta.customer_name,
      brief.customerName,
      brief.customer_name
    )
    const deliveryDate = pickText(o.deliveryDate, o.delivery_date, data.deliveryDate, data.delivery_date, meta.deliveryDate, meta.delivery_date)
    const items =
      Array.isArray(o?.items) ? o.items
        : Array.isArray(data?.items) ? data.items
          : Array.isArray(data?.data?.items) ? data.data.items
            : Array.isArray(meta?.items) ? meta.items
              : []
    const normalizeItem = (it) => {
      const row = it && typeof it === 'object' ? it : {}
      return {
        ...row,
        productName: pickText(row.productName, row.product_name, row.goodsName, row.goods_name, row.productTitle, row.product_title, row.title, o.productName, o.goodsName, o.title),
        spec: pickText(row.spec, row.specification, row.productSpec, row.product_spec, o.spec, o.specification),
        materialCode: pickText(row.materialCode, row.material_code, o.materialCode, o.material_code),
        materialNo: pickText(row.materialNo, row.material_no, o.materialNo, o.material_no),
        flute: pickText(row.flute, row.fluteType, row.flute_type, o.flute, o.fluteType, o.flute_type),
        quantity: pickNumber(row.quantity, row.qty, row.count, row.orderQty, row.orderQuantity, o.quantity),
        unitPrice: pickNumber(row.unitPrice, row.unit_price, row.salePrice, row.sale_price, row.price, o.unitPrice),
        amount: pickNumber(row.amount, row.totalAmount, row.total_amount, row.finalAmount, row.final_amount, o.amount),
        skuId: pickText(row.skuId, row.sku_id, row.customerSkuId, row.customer_sku_id, o.skuId, o.sku_id, o.customerSkuId, o.customer_sku_id),
        goodsName: pickText(row.goodsName, row.goods_name, row.productTitle, row.product_title, row.title, o.goodsName, o.productTitle, o.title),
        creasingType: pickText(row.creasingType, row.creasing_type, row.creaseType, row.crease_type, o.creasingType, o.creasing_type, o.creaseType, o.crease_type),
        creasingSize1: pickNumber(row.creasingSize1, row.creaseSize1, row.creasingSize_1, row.creaseSize_1, row.creasing_size1, row.crease_size1, row.creasing_size_1, row.crease_size_1, o.creasingSize1, o.creaseSize1),
        creasingSize2: pickNumber(row.creasingSize2, row.creaseSize2, row.creasingSize_2, row.creaseSize_2, row.creasing_size2, row.crease_size2, row.creasing_size_2, row.crease_size_2, o.creasingSize2, o.creaseSize2),
        creasingSize3: pickNumber(row.creasingSize3, row.creaseSize3, row.creasingSize_3, row.creaseSize_3, row.creasing_size3, row.crease_size3, row.creasing_size_3, row.crease_size_3, o.creasingSize3, o.creaseSize3),
        pressLine: pickText(row.pressLine, row.press_line, row.pressLineSize, row.press_line_size, row.creasingSize, row.creaseSize, row.creasing_size, row.crease_size, o.pressLine, o.press_line)
      }
    }
    const normalizedItems = (items || []).map(normalizeItem)
    const base = {
      ...o,
      orderNo: orderNo || o.orderNo,
      customerName: customerName || o.customerName,
      deliveryDate: deliveryDate || o.deliveryDate,
      customerId: pickText(
        o.customerId,
        o.customer_id,
        o.customer?._id,
        o.customer?.id,
        data.customerId,
        data.customer_id,
        data.customer?._id,
        data.customer?.id,
        meta.customerId,
        meta.customer_id,
        meta.customer?._id,
        meta.customer?.id,
        brief.customerId,
        brief.customer_id,
        brief.customer?._id,
        brief.customer?.id
      )
    }
    if (normalizedItems.length) base.items = normalizedItems
    base.productName = pickText(o.productName, o.product_name, o.goodsName, o.goods_name, o.productTitle, o.product_title, o.title)
    base.spec = pickText(o.spec, o.specification, o.productSpec, o.product_spec)
    base.materialCode = pickText(o.materialCode, o.material_code)
    base.materialNo = pickText(o.materialNo, o.material_no)
    base.flute = pickText(o.flute, o.fluteType, o.flute_type)
    return base
  }

  const hydrateProfitForOrders = useCallback(async (list) => {
    const arr = Array.isArray(list) ? list : []
    if (!arr.length) return

    const safeToken = (v) => {
      const s = String(v ?? '').trim()
      if (!s) return ''
      const lower = s.toLowerCase()
      if (['-', '—', '--', '---', '暂无', '无', 'null', 'undefined'].includes(lower)) return ''
      return s
    }
    const pickToken = (...vals) => {
      for (const v of vals) {
        const s = safeToken(v)
        if (s) return s
      }
      return ''
    }
    const normalizeOrderToken = (raw) => {
      const s = safeToken(raw)
      if (!s) return ''
      const first = s.split(/\s+/).filter(Boolean)[0] || ''
      return first
    }
    const tokenOf = (o) => {
      const primary = pickToken(o?.orderNo, o?.orderNumber, o?._id, o?.id)
      if (primary) return primary
      const k = safeToken(o?.key)
      if (!k) return ''
      if (/^order_\d+_\d+$/i.test(k)) return ''
      return k
    }
    const tokenOfNormalized = (o) => normalizeOrderToken(tokenOf(o))

    const toNumberLocal = (v) => {
      if (v === null || v === undefined || v === '') return NaN
      if (typeof v === 'number') return v
      const raw = String(v).trim()
      if (!raw) return NaN
      const cleaned = raw.replace(/[,\s¥￥]/g, '')
      const n = Number(cleaned)
      if (Number.isFinite(n)) return n
      const m = cleaned.match(/-?\d+(\.\d+)?/)
      return m ? Number(m[0]) : NaN
    }
    const pickNumberLocal = (...candidates) => {
      for (const c of candidates) {
        const n = toNumberLocal(c)
        if (Number.isFinite(n)) return n
      }
      return NaN
    }
    const unwrapDetail = (res) => {
      const body = res?.data ?? res
      if (!body) return null
      if (body && typeof body === 'object') {
        if (body.success === false) return null
        if (body.order && typeof body.order === 'object') return body.order
        const data = body.data
        if (data && typeof data === 'object') {
          if (data.order && typeof data.order === 'object') return data.order
          if (data.data && typeof data.data === 'object') return data.data
          return data
        }
      }
      return body
    }
    const calcProfitFromDetail = (input) => {
      const obj = input && typeof input === 'object' ? input : {}
      const dataObj = obj?.data && typeof obj.data === 'object' ? obj.data : {}
      const metaObj = obj?.meta && typeof obj.meta === 'object' ? obj.meta : {}
      const existing = pickNumberLocal(
        obj?.profit,
        obj?.orderProfit,
        obj?.order_profit,
        obj?.totalProfit,
        obj?.total_profit,
        obj?.totalGrossProfit,
        obj?.total_gross_profit,
        obj?.grossProfit,
        obj?.gross_profit,
        dataObj?.profit,
        dataObj?.orderProfit,
        dataObj?.order_profit,
        dataObj?.totalProfit,
        dataObj?.total_profit,
        dataObj?.totalGrossProfit,
        dataObj?.total_gross_profit,
        dataObj?.grossProfit,
        dataObj?.gross_profit,
        metaObj?.profit,
        metaObj?.orderProfit,
        metaObj?.order_profit,
        metaObj?.totalProfit,
        metaObj?.total_profit,
        metaObj?.totalGrossProfit,
        metaObj?.total_gross_profit,
        metaObj?.grossProfit,
        metaObj?.gross_profit
      )
      if (Number.isFinite(existing)) return existing

      const readItems = () => {
        if (Array.isArray(obj?.items)) return obj.items
        if (Array.isArray(dataObj?.items)) return dataObj.items
        if (Array.isArray(dataObj?.data?.items)) return dataObj.data.items
        if (Array.isArray(metaObj?.items)) return metaObj.items
        return []
      }

      const calcItemProfit = (r) => {
        const row = r && typeof r === 'object' ? r : {}
        const qty = pickNumberLocal(row?.quantity, row?.qty, row?.count, row?.orderQty, row?.orderQuantity, 0)
        let amount = pickNumberLocal(row?.amount, row?.totalAmount, row?.total_amount, row?.finalAmount, row?.final_amount)
        if (!Number.isFinite(amount)) {
          const price = pickNumberLocal(
            row?.unitPrice,
            row?.unit_price,
            row?.salePrice,
            row?.sale_price,
            row?.price,
            obj?.unitPrice,
            obj?.unit_price,
            dataObj?.unitPrice,
            dataObj?.unit_price
          )
          if (qty > 0 && Number.isFinite(price)) amount = qty * price
        }
        if (!Number.isFinite(amount)) return NaN

        const costPrice = pickNumberLocal(
          row?.rawUnitPrice,
          row?.raw_unit_price,
          row?.rawMaterialUnitPrice,
          row?.raw_material_unit_price,
          row?.costPrice,
          row?.cost_price,
          row?.purchasePrice,
          row?.purchase_price,
          obj?.rawUnitPrice,
          obj?.raw_unit_price,
          obj?.rawMaterialUnitPrice,
          obj?.raw_material_unit_price,
          obj?.costPrice,
          obj?.cost_price,
          obj?.purchasePrice,
          obj?.purchase_price,
          dataObj?.rawUnitPrice,
          dataObj?.raw_unit_price,
          dataObj?.rawMaterialUnitPrice,
          dataObj?.raw_material_unit_price,
          dataObj?.costPrice,
          dataObj?.cost_price,
          dataObj?.purchasePrice,
          dataObj?.purchase_price,
          metaObj?.rawUnitPrice,
          metaObj?.raw_unit_price,
          metaObj?.rawMaterialUnitPrice,
          metaObj?.raw_material_unit_price,
          metaObj?.costPrice,
          metaObj?.cost_price,
          metaObj?.purchasePrice,
          metaObj?.purchase_price,
          0
        )
        const totalSheets = pickNumberLocal(
          row?.sheetCount,
          row?.sheet_count,
          row?.sheetQty,
          row?.sheet_qty,
          row?.orderedQuantity,
          row?.ordered_quantity,
          row?.orderedSheets,
          row?.ordered_sheets,
          0
        )
        const rawPerSheets = pickNumberLocal(
          row?.skuSheetCount,
          row?.sheetPerUnit,
          row?.sheet_per_unit,
          row?.perSheet,
          row?.per_sheet,
          0
        )
        const jm = String(row?.joinMethod ?? row?.join_method ?? obj?.joinMethod ?? obj?.join_method ?? '').trim()
        const joinFactor = jm.includes('四拼') ? 4 : (jm.includes('双拼') ? 2 : (jm.includes('单拼') ? 1 : 0))
        const ratio = (qty > 0 && totalSheets > 0) ? (totalSheets / qty) : 0
        const ratioRounded = Number.isFinite(ratio) && ratio > 0 ? Math.round(ratio) : 0
        const ratioFactor = ratioRounded > 0 && Math.abs(ratio - ratioRounded) <= 0.01 ? ratioRounded : 0
        const perSheets = Math.max(
          Number.isFinite(rawPerSheets) && rawPerSheets > 0 ? rawPerSheets : 0,
          joinFactor,
          ratioFactor
        )
        const computedSheets = (qty > 0 && Number.isFinite(perSheets) && perSheets > 0) ? qty * perSheets : 0
        const sheetsForCost = totalSheets > 0 ? totalSheets : (computedSheets > 0 ? computedSheets : qty)
        let rawAmount = 0
        if (totalSheets > 0 && Number.isFinite(costPrice)) rawAmount = totalSheets * costPrice
        else if (qty > 0 && Number.isFinite(costPrice)) rawAmount = sheetsForCost * costPrice
        return amount - rawAmount
      }

      const items = readItems()
      if (Array.isArray(items) && items.length) {
        let sum = 0
        let counted = 0
        for (const it of items) {
          const p = calcItemProfit(it)
          if (Number.isFinite(p)) {
            sum += p
            counted += 1
          }
        }
        if (counted > 0) return sum
      }

      const qty = pickNumberLocal(obj?.quantity, obj?.qty, obj?.count, obj?.orderQty, obj?.orderQuantity, dataObj?.quantity, 0)
      let amount = pickNumberLocal(
        obj?.amount, obj?.totalAmount, obj?.total_amount, obj?.finalAmount, obj?.final_amount,
        dataObj?.amount, dataObj?.totalAmount, dataObj?.total_amount, dataObj?.finalAmount, dataObj?.final_amount
      )
      if (!Number.isFinite(amount)) {
        const price = pickNumberLocal(obj?.unitPrice, obj?.unit_price, obj?.salePrice, obj?.sale_price, obj?.price, dataObj?.unitPrice, dataObj?.unit_price)
        if (qty > 0 && Number.isFinite(price)) amount = qty * price
      }
      if (!Number.isFinite(amount)) return undefined

      const costPrice = pickNumberLocal(
        obj?.rawUnitPrice,
        obj?.raw_unit_price,
        obj?.rawMaterialUnitPrice,
        obj?.raw_material_unit_price,
        obj?.costPrice,
        obj?.cost_price,
        obj?.purchasePrice,
        obj?.purchase_price,
        dataObj?.rawUnitPrice,
        dataObj?.raw_unit_price,
        dataObj?.rawMaterialUnitPrice,
        dataObj?.raw_material_unit_price,
        dataObj?.costPrice,
        dataObj?.cost_price,
        dataObj?.purchasePrice,
        dataObj?.purchase_price,
        metaObj?.rawUnitPrice,
        metaObj?.raw_unit_price,
        metaObj?.rawMaterialUnitPrice,
        metaObj?.raw_material_unit_price,
        metaObj?.costPrice,
        metaObj?.cost_price,
        metaObj?.purchasePrice,
        metaObj?.purchase_price,
        0
      )
      const totalSheets = pickNumberLocal(
        obj?.sheetCount,
        obj?.sheet_count,
        obj?.sheetQty,
        obj?.sheet_qty,
        obj?.orderedQuantity,
        obj?.ordered_quantity,
        obj?.orderedSheets,
        obj?.ordered_sheets,
        dataObj?.sheetCount,
        dataObj?.sheet_count,
        dataObj?.sheetQty,
        dataObj?.sheet_qty,
        dataObj?.orderedQuantity,
        dataObj?.ordered_quantity,
        dataObj?.orderedSheets,
        dataObj?.ordered_sheets,
        0
      )
      const rawPerSheets = pickNumberLocal(
        obj?.skuSheetCount,
        obj?.sheetPerUnit,
        obj?.sheet_per_unit,
        obj?.perSheet,
        obj?.per_sheet,
        dataObj?.skuSheetCount,
        dataObj?.sheetPerUnit,
        dataObj?.sheet_per_unit,
        dataObj?.perSheet,
        dataObj?.per_sheet,
        0
      )
      const jm = String(obj?.joinMethod ?? obj?.join_method ?? dataObj?.joinMethod ?? dataObj?.join_method ?? '').trim()
      const joinFactor = jm.includes('四拼') ? 4 : (jm.includes('双拼') ? 2 : (jm.includes('单拼') ? 1 : 0))
      const ratio = (qty > 0 && totalSheets > 0) ? (totalSheets / qty) : 0
      const ratioRounded = Number.isFinite(ratio) && ratio > 0 ? Math.round(ratio) : 0
      const ratioFactor = ratioRounded > 0 && Math.abs(ratio - ratioRounded) <= 0.01 ? ratioRounded : 0
      const perSheets = Math.max(
        Number.isFinite(rawPerSheets) && rawPerSheets > 0 ? rawPerSheets : 0,
        joinFactor,
        ratioFactor
      )
      const computedSheets = (qty > 0 && Number.isFinite(perSheets) && perSheets > 0) ? qty * perSheets : 0
      const sheetsForCost = totalSheets > 0 ? totalSheets : (computedSheets > 0 ? computedSheets : qty)
      let rawAmount = 0
      if (totalSheets > 0 && Number.isFinite(costPrice)) rawAmount = totalSheets * costPrice
      else if (qty > 0 && Number.isFinite(costPrice)) rawAmount = sheetsForCost * costPrice
      return amount - rawAmount
    }

    const updatesFromCache = new Map()
    const toFetch = []

    for (const o of arr) {
      const token = tokenOfNormalized(o)
      if (!token) continue
      const cur = toNumberLocal(o?.profit)
      const trusted = Boolean(o?.__profitTrusted)
      if (Number.isFinite(cur) && trusted) continue
      if (profitCacheRef.current.has(token)) {
        const cached = profitCacheRef.current.get(token)
        if (Number.isFinite(cached)) {
          updatesFromCache.set(token, cached)
          continue
        }
        if (cached === null) {
          profitCacheRef.current.delete(token)
        } else {
          continue
        }
      }
      if (inflightProfitRef.current.has(token)) continue
      toFetch.push(token)
    }

    const applyUpdates = (updates) => {
      if (!updates || !updates.size) return
      setAllOrders((prev) => {
        const pArr = Array.isArray(prev) ? prev : []
        let changed = false
        const next = pArr.map((o) => {
          const token = tokenOfNormalized(o)
          if (!token) return o
          if (!updates.has(token)) return o
          const profit = updates.get(token)
          if (!Number.isFinite(profit)) return o
          const cur = toNumberLocal(o?.profit)
          if (Number.isFinite(cur) && cur === profit && o?.__profitTrusted) return o
          changed = true
          return { ...o, profit, grossProfit: profit, __profitTrusted: true }
        })
        return changed ? next : prev
      })
    }

    applyUpdates(updatesFromCache)
    if (!toFetch.length) return

    const queue = toFetch.slice(0, 30)
    const resultUpdates = new Map()
    const limit = 4

    const worker = async () => {
      while (queue.length) {
        const token = queue.shift()
        if (!token) continue
        if (profitCacheRef.current.has(token)) continue
        if (inflightProfitRef.current.has(token)) continue
        inflightProfitRef.current.add(token)
        try {
          const fetched = unwrapDetail(await orderAPI.getOrderAny(token))
          const p = calcProfitFromDetail(fetched)
          if (Number.isFinite(Number(p))) {
            const val = Number(p)
            profitCacheRef.current.set(token, val)
            resultUpdates.set(token, val)
          } else {
            profitCacheRef.current.set(token, null)
          }
        } catch (_) {
          profitCacheRef.current.set(token, null)
        } finally {
          inflightProfitRef.current.delete(token)
        }
      }
    }

    const workers = Array.from({ length: Math.min(limit, queue.length || 1) }, () => worker())
    await Promise.allSettled(workers)
    applyUpdates(resultUpdates)
  }, [])

  const openOrderDetail = useCallback(async (record) => {
    const base = record && typeof record === 'object' ? record : null
    if (base) {
      try {
        const loader = ensureCustomerSkusLoadedRef.current
        if (typeof loader === 'function') await loader([base])
      } catch (_) { void 0 }
    }
    setDetailOrder(base ? normalizeDetailOrder(base) : null)
    setDetailOpen(true)
    const token = pickText(base?.orderNo, base?.orderNumber, base?._id, base?.id)
    if (!token) return
    const reqId = ++detailReqIdRef.current
    setDetailLoading(true)
    try {
      const fetched = unwrapOrderDetailResponse(await orderAPI.getOrderAny(token))
      if (reqId !== detailReqIdRef.current) return
      if (fetched) {
        setDetailOrder((prev) => normalizeDetailOrder(mergeOrder(prev, fetched)))
      }
    } catch (_) {
      if (reqId !== detailReqIdRef.current) return
    } finally {
      if (reqId === detailReqIdRef.current) setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    const token = String(location?.state?.openDetailFor || '').trim()
    if (!token) return
    void openOrderDetail({ orderNo: token, orderNumber: token })
    navigate('/orders', { replace: true, state: null })
  }, [location?.state?.openDetailFor])

  useEffect(() => {
    listPageRef.current = listPage
  }, [listPage])

  useEffect(() => {
    listPageSizeRef.current = listPageSize
  }, [listPageSize])

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

  const [stats, setStats] = useState({ total: 0, ordered: 0, pending: 0, processing: 0, stocked: 0 })
  const [monthOrderCount, setMonthOrderCount] = useState(0)

  const supplierOptions = useMemo(() => {
    const base = (suppliers || []).map(s => ({ value: s._id || s.id, label: s.name }))
    const histNames = Array.from(new Set((orders || []).map(o => o.supplierName).filter(n => n && !base.some(b => b.label === n))))
    const hist = histNames.map(n => ({ value: `name::${n}`, label: n }))
    return [...base, ...hist, { value: '__NEW__', label: '新增供应商' }]
  }, [suppliers, orders])

  const customerOptions = useMemo(() => {
    if ((customers || []).length) {
      return customers.map(c => ({ value: c._id || c.id, label: c.companyName || c.name || c.company }))
    }
    const hist = Array.from(new Set((orders || []).map(o => o.customerName).filter(Boolean)))
    return hist.map(n => ({ value: `name::${n}`, label: n }))
  }, [customers, orders])

  const columns = [
    {
      title: '订单编号',
      dataIndex: 'orderNo',
      key: 'orderNo',
      width: 200,
      render: (value, record) => {
        const raw = String(value || record.orderNumber || '').trim()
        const m = raw.match(/^(.*?)-(\d+)$/)
        const parentNo = m ? String(m[1] || '').trim() : raw
        const text = parentNo || '-'
        const id = record._id || record.id || record.key

        if (record?.__groupParent) {
          return parentNo
            ? (
              <Space size={6}>
                <Link
                  to={`/orders/group/${encodeURIComponent(parentNo)}`}
                  state={{ parentNo, parent: record, children: record?.children }}
                  className="erp-order-orderNo-multi"
                >
                  {text}
                </Link>
                <Tag color="geekblue">多SKU</Tag>
              </Space>
            )
            : text
        }

        const orderNo = String(record?.orderNo || record?.orderNumber || '').trim()
        const isChild = /-\d+$/.test(orderNo)
        if (isChild) {
          return null
        }

        const items = Array.isArray(record?.items) ? record.items : []
        if (items.length > 1) {
          return parentNo
            ? <Link to={`/orders/group/${encodeURIComponent(parentNo)}`} state={{ parentNo, parent: record }}>{text}</Link>
            : text
        }

        const detailToken = String(record?.orderNo || record?.orderNumber || parentNo || id || '').trim()
        return detailToken ? <Link to={`/orders/${encodeURIComponent(detailToken)}`} state={{ baseOrder: record }}>{text}</Link> : text
      }
    },
    {
      title: '客户',
      dataIndex: 'customerName',
      key: 'customerName',
      width: 120,
      render: (text, record) => {
        const customerId = record.customerId || record.customer?._id || record.customer?.id
        const customerName = text
        const customer = customers.find(c =>
          (customerId && (c._id === customerId || c.id === customerId)) ||
          (c.name === customerName || c.companyName === customerName)
        )
        return customer?.shortName || text || '-'
      }
    },
    {
      title: '子订单号',
      key: 'subOrderNo',
      width: 130,
      render: (_, record) => {
        if (record?.__groupParent) return null
        if (record?.__itemChild) {
          const raw = String(record?.orderNo || record?.orderNumber || '').trim()
          return raw || null
        }
        const raw = String(record?.orderNo || record?.orderNumber || '').trim()
        if (!raw) return null
        const m = raw.match(/^(.*?)-(\d+)$/)
        if (!m) return null
        return <Link to={`/orders/${encodeURIComponent(raw)}`} state={{ baseOrder: record }}>{raw}</Link>
      }
    },
    {
      title: '产品',
      key: 'product',
      width: 180,
      render: (_, r) => {
        if (r.__groupParent) return null
        const rawOrderNo = String(r?.orderNo || r?.orderNumber || '').trim()


        const normalizeText = (v) => String(v ?? '').trim()
        const normalizeKey = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, '')
        const normalizeSpecKey = (v) => normalizeKey(v).replace(/[x*]/g, '×').replace(/mm$/i, '')
        const normalizeId = (v) => {
          const s = normalizeText(v)
          if (!s) return ''
          const parts = s.split(/[\\/]/).filter(Boolean)
          return parts.length ? parts[parts.length - 1] : s
        }

        const first = (r.items && r.items[0]) ? r.items[0] : null
        const data = r?.data && typeof r.data === 'object' ? r.data : null
        const firstData = first?.data && typeof first.data === 'object' ? first.data : null
        const meta = r?.meta && typeof r.meta === 'object' ? r.meta : null
        const brief = meta?.brief && typeof meta.brief === 'object' ? meta.brief : null
        const product = r?.product && typeof r.product === 'object' ? r.product : null

        const customerId = normalizeId(r.customerId || r.customer?._id || r.customer?.id)
        const skuId = normalizeId(
          r.skuId || r.sku_id || r.sku?._id || r.sku?.id || r.customerSkuId || r.customer_sku_id ||
          first?.skuId || first?.sku_id || first?.sku?._id || first?.sku?.id || first?.customerSkuId || first?.customer_sku_id
        )
        const skuIndex = customerId ? customerSkuIndexByCustomerId.get(customerId) : null
        const rawSpec = normalizeText(
          r.specification || r.productSpec || r.product_spec ||
          data?.specification || data?.productSpec || data?.product_spec ||
          meta?.specification || meta?.productSpec || meta?.product_spec ||
          brief?.specification || brief?.productSpec || brief?.product_spec ||
          product?.specification || product?.productSpec || product?.product_spec ||
          first?.specification || first?.productSpec || first?.product_spec ||
          firstData?.specification || firstData?.productSpec || firstData?.product_spec ||
          r.spec || data?.spec || first?.spec || firstData?.spec ||
          ''
        )
        const materialNoKey = normalizeKey(
          r.materialNo || r.material_no ||
          data?.materialNo || data?.material_no ||
          meta?.materialNo || meta?.material_no ||
          brief?.materialNo || brief?.material_no ||
          product?.materialNo || product?.material_no ||
          first?.materialNo || first?.material_no ||
          firstData?.materialNo || firstData?.material_no
        )
        const specKey = normalizeSpecKey(rawSpec)
        const skuFromIndex = (() => {
          if (!skuIndex) return null
          if (skuId && skuIndex.has(`id:${normalizeKey(skuId)}`)) return skuIndex.get(`id:${normalizeKey(skuId)}`)
          if (materialNoKey && specKey && skuIndex.has(`ms:${materialNoKey}::${specKey}`)) return skuIndex.get(`ms:${materialNoKey}::${specKey}`)
          if (materialNoKey && skuIndex.has(`m:${materialNoKey}`)) return skuIndex.get(`m:${materialNoKey}`)
          const nameKey = normalizeKey(r.goodsName || r.goods_name || r.productTitle || r.product_title || r.title || first?.title || first?.productName || first?.goodsName || '')
          if (nameKey && specKey && skuIndex.has(`ns:${nameKey}::${specKey}`)) return skuIndex.get(`ns:${nameKey}::${specKey}`)
          if (nameKey && skuIndex.has(`n:${nameKey}`)) return skuIndex.get(`n:${nameKey}`)
          return null
        })()

        const toNum = (v) => {
          const n = Number(v)
          if (Number.isFinite(n)) return n
          const m = String(v ?? '').match(/-?\d+(\.\d+)?/)
          return m ? Number(m[0]) : NaN
        }
        const w = toNum(r.boardWidth ?? first?.boardWidth ?? skuFromIndex?.boardWidth ?? skuFromIndex?.board_width)
        const h = toNum(r.boardHeight ?? first?.boardHeight ?? skuFromIndex?.boardHeight ?? skuFromIndex?.board_height)
        const sizeText = (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) ? `${w}×${h}mm` : ''
        const skuSpecRaw = normalizeText(skuFromIndex?.specification ?? skuFromIndex?.spec)
        const finalSpecRaw = rawSpec || skuSpecRaw
        const specText = finalSpecRaw ? (/(mm)$/i.test(finalSpecRaw) ? finalSpecRaw : `${finalSpecRaw}mm`) : ''
        const categoryText = normalizeText(
          r.category || r.productCategory || r.productType ||
          first?.category || first?.productCategory || first?.productType ||
          skuFromIndex?.category || skuFromIndex?.productCategory || skuFromIndex?.productType
        )
        const c1 = Number((
          r?.creasingSize1 ?? r?.creaseSize1 ?? r?.creasingSize_1 ?? r?.creaseSize_1 ?? r?.creasing_size1 ?? r?.crease_size1 ?? r?.creasing_size_1 ?? r?.crease_size_1 ??
          data?.creasingSize1 ?? data?.creaseSize1 ?? data?.creasingSize_1 ?? data?.creaseSize_1 ?? data?.creasing_size1 ?? data?.crease_size1 ?? data?.creasing_size_1 ?? data?.crease_size_1 ??
          meta?.creasingSize1 ?? meta?.creaseSize1 ?? meta?.creasingSize_1 ?? meta?.creaseSize_1 ?? meta?.creasing_size1 ?? meta?.crease_size1 ?? meta?.creasing_size_1 ?? meta?.crease_size_1 ??
          brief?.creasingSize1 ?? brief?.creaseSize1 ?? brief?.creasingSize_1 ?? brief?.creaseSize_1 ?? brief?.creasing_size1 ?? brief?.crease_size1 ?? brief?.creasing_size_1 ?? brief?.crease_size_1 ??
          product?.creasingSize1 ?? product?.creaseSize1 ?? product?.creasingSize_1 ?? product?.creaseSize_1 ?? product?.creasing_size1 ?? product?.crease_size1 ?? product?.creasing_size_1 ?? product?.crease_size_1 ??
          first?.creasingSize1 ?? first?.creaseSize1 ?? first?.creasingSize_1 ?? first?.creaseSize_1 ?? first?.creasing_size1 ?? first?.crease_size1 ?? first?.creasing_size_1 ?? first?.crease_size_1 ??
          firstData?.creasingSize1 ?? firstData?.creaseSize1 ?? firstData?.creasingSize_1 ?? firstData?.creaseSize_1 ?? firstData?.creasing_size1 ?? firstData?.crease_size1 ?? firstData?.creasing_size_1 ?? firstData?.crease_size_1 ??
          skuFromIndex?.creasingSize1 ?? skuFromIndex?.creaseSize1 ?? skuFromIndex?.creasingSize_1 ?? skuFromIndex?.creaseSize_1 ?? skuFromIndex?.creasing_size1 ?? skuFromIndex?.crease_size1 ?? skuFromIndex?.creasing_size_1 ?? skuFromIndex?.crease_size_1 ??
          0
        ) ?? 0)
        const c2 = Number((
          r?.creasingSize2 ?? r?.creaseSize2 ?? r?.creasingSize_2 ?? r?.creaseSize_2 ?? r?.creasing_size2 ?? r?.crease_size2 ?? r?.creasing_size_2 ?? r?.crease_size_2 ??
          data?.creasingSize2 ?? data?.creaseSize2 ?? data?.creasingSize_2 ?? data?.creaseSize_2 ?? data?.creasing_size2 ?? data?.crease_size2 ?? data?.creasing_size_2 ?? data?.crease_size_2 ??
          meta?.creasingSize2 ?? meta?.creaseSize2 ?? meta?.creasingSize_2 ?? meta?.creaseSize_2 ?? meta?.creasing_size2 ?? meta?.crease_size2 ?? meta?.creasing_size_2 ?? meta?.crease_size_2 ??
          brief?.creasingSize2 ?? brief?.creaseSize2 ?? brief?.creasingSize_2 ?? brief?.creaseSize_2 ?? brief?.creasing_size2 ?? brief?.crease_size2 ?? brief?.creasing_size_2 ?? brief?.crease_size_2 ??
          product?.creasingSize2 ?? product?.creaseSize2 ?? product?.creasingSize_2 ?? product?.creaseSize_2 ?? product?.creasing_size2 ?? product?.crease_size2 ?? product?.creasing_size_2 ?? product?.crease_size_2 ??
          first?.creasingSize2 ?? first?.creaseSize2 ?? first?.creasingSize_2 ?? first?.creaseSize_2 ?? first?.creasing_size2 ?? first?.crease_size2 ?? first?.creasing_size_2 ?? first?.crease_size_2 ??
          firstData?.creasingSize2 ?? firstData?.creaseSize2 ?? firstData?.creasingSize_2 ?? firstData?.creaseSize_2 ?? firstData?.creasing_size2 ?? firstData?.crease_size2 ?? firstData?.creasing_size_2 ?? firstData?.crease_size_2 ??
          skuFromIndex?.creasingSize2 ?? skuFromIndex?.creaseSize2 ?? skuFromIndex?.creasingSize_2 ?? skuFromIndex?.creaseSize_2 ?? skuFromIndex?.creasing_size2 ?? skuFromIndex?.crease_size2 ?? skuFromIndex?.creasing_size_2 ?? skuFromIndex?.crease_size_2 ??
          0
        ) ?? 0)
        const c3 = Number((
          r?.creasingSize3 ?? r?.creaseSize3 ?? r?.creasingSize_3 ?? r?.creaseSize_3 ?? r?.creasing_size3 ?? r?.crease_size3 ?? r?.creasing_size_3 ?? r?.crease_size_3 ??
          data?.creasingSize3 ?? data?.creaseSize3 ?? data?.creasingSize_3 ?? data?.creaseSize_3 ?? data?.creasing_size3 ?? data?.crease_size3 ?? data?.creasing_size_3 ?? data?.crease_size_3 ??
          meta?.creasingSize3 ?? meta?.creaseSize3 ?? meta?.creasingSize_3 ?? meta?.creaseSize_3 ?? meta?.creasing_size3 ?? meta?.crease_size3 ?? meta?.creasing_size_3 ?? meta?.crease_size_3 ??
          brief?.creasingSize3 ?? brief?.creaseSize3 ?? brief?.creasingSize_3 ?? brief?.creaseSize_3 ?? brief?.creasing_size3 ?? brief?.crease_size3 ?? brief?.creasing_size_3 ?? brief?.crease_size_3 ??
          product?.creasingSize3 ?? product?.creaseSize3 ?? product?.creasingSize_3 ?? product?.creaseSize_3 ?? product?.creasing_size3 ?? product?.crease_size3 ?? product?.creasing_size_3 ?? product?.crease_size_3 ??
          first?.creasingSize3 ?? first?.creaseSize3 ?? first?.creasingSize_3 ?? first?.creaseSize_3 ?? first?.creasing_size3 ?? first?.crease_size3 ?? first?.creasing_size_3 ?? first?.crease_size_3 ??
          firstData?.creasingSize3 ?? firstData?.creaseSize3 ?? firstData?.creasingSize_3 ?? firstData?.creaseSize_3 ?? firstData?.creasing_size3 ?? firstData?.crease_size3 ?? firstData?.creasing_size_3 ?? firstData?.crease_size_3 ??
          skuFromIndex?.creasingSize3 ?? skuFromIndex?.creaseSize3 ?? skuFromIndex?.creasingSize_3 ?? skuFromIndex?.creaseSize_3 ?? skuFromIndex?.creasing_size3 ?? skuFromIndex?.crease_size3 ?? skuFromIndex?.creasing_size_3 ?? skuFromIndex?.crease_size_3 ??
          0
        ) ?? 0)
        const pickText = (...vals) => {
          for (const v of vals) {
            const s = normalizeText(v)
            if (!s) continue
            if (['-', '—', '--', '---', '暂无', '无'].includes(s)) continue
            return s
          }
          return ''
        }
        const type = pickText(
          r?.creasingType, r?.creasing_type, r?.creaseType, r?.crease_type,
          data?.creasingType, data?.creasing_type, data?.creaseType, data?.crease_type,
          meta?.creasingType, meta?.creasing_type, meta?.creaseType, meta?.crease_type,
          brief?.creasingType, brief?.creasing_type, brief?.creaseType, brief?.crease_type,
          product?.creasingType, product?.creasing_type, product?.creaseType, product?.crease_type,
          first?.creasingType, first?.creasing_type, first?.creaseType, first?.crease_type,
          firstData?.creasingType, firstData?.creasing_type, firstData?.creaseType, firstData?.crease_type,
          skuFromIndex?.creasingType, skuFromIndex?.creasing_type, skuFromIndex?.creaseType, skuFromIndex?.crease_type
        )
        const hasNums = Boolean(c1 || c2 || c3)
        const parseCreaseText = (v) => {
          const s = normalizeText(v)
          if (!s) return null
          const nums = (s.match(/-?\d+(\.\d+)?/g) || []).map((n) => Number(n)).filter((n) => Number.isFinite(n))
          if (nums.length < 2) return null
          const [a, b, c] = [nums[0] || 0, nums[1] || 0, nums[2] || 0]
          const typeMatch = s.match(/[（(]([^（）()]+)[）)]/)
          const t = normalizeText(typeMatch ? typeMatch[1] : '')
          return { c1: a, c2: b, c3: c, type: t }
        }
        const fromAny = parseCreaseText(pickText(
          r?.crease, r?.creaseText, r?.crease_text,
          data?.crease, data?.creaseText, data?.crease_text,
          meta?.crease, meta?.creaseText, meta?.crease_text,
          brief?.crease, brief?.creaseText, brief?.crease_text,
          product?.crease, product?.creaseText, product?.crease_text,
          first?.crease, first?.creaseText, first?.crease_text,
          firstData?.crease, firstData?.creaseText, firstData?.crease_text,
          r?.pressLine, r?.press_line,
          r?.creasingSize, r?.creaseSize, r?.pressLineSize, r?.press_line_size,
          data?.pressLine, data?.press_line,
          data?.creasingSize, data?.creaseSize, data?.pressLineSize, data?.press_line_size,
          meta?.pressLine, meta?.press_line,
          meta?.creasingSize, meta?.creaseSize, meta?.pressLineSize, meta?.press_line_size,
          brief?.pressLine, brief?.press_line,
          brief?.creasingSize, brief?.creaseSize, brief?.pressLineSize, brief?.press_line_size,
          product?.pressLine, product?.press_line,
          product?.creasingSize, product?.creaseSize, product?.pressLineSize, product?.press_line_size,
          first?.pressLine, first?.press_line,
          first?.creasingSize, first?.creaseSize, first?.pressLineSize, first?.press_line_size,
          firstData?.pressLine, firstData?.press_line,
          firstData?.creasingSize, firstData?.creaseSize, firstData?.pressLineSize, firstData?.press_line_size,
          skuFromIndex?.crease, skuFromIndex?.creaseText, skuFromIndex?.crease_text,
          skuFromIndex?.pressLine, skuFromIndex?.press_line,
          skuFromIndex?.creasingSize, skuFromIndex?.creaseSize, skuFromIndex?.pressLineSize, skuFromIndex?.press_line_size
        ))
        const resolvedType = type || (fromAny?.type || '')
        const resolvedC1 = hasNums ? c1 : (fromAny?.c1 || 0)
        const resolvedC2 = hasNums ? c2 : (fromAny?.c2 || 0)
        const resolvedC3 = hasNums ? c3 : (fromAny?.c3 || 0)
        const resolvedHasNums = Boolean(resolvedC1 || resolvedC2 || resolvedC3)
        const creaseText = resolvedHasNums ? `${resolvedC1}-${resolvedC2}-${resolvedC3}mm${resolvedType ? ` (${resolvedType})` : ''}` : (resolvedType || '')
        return (
          <div>
            {categoryText ? <div style={{ fontWeight: 700 }}>类别：{categoryText}</div> : null}
            {specText ? <div>规格：{specText}</div> : null}
            {sizeText ? <div>纸板尺寸：{sizeText}</div> : null}
            {creaseText ? <div style={{ color: '#6b7280' }}>压线尺寸：{creaseText}</div> : null}
          </div>
        )

      }
    },
    {
      title: '商品名称',
      dataIndex: 'goodsName',
      key: 'goodsName',
      width: 140,
      render: (_, r) => {
        if (r.__groupParent) return null
        const normalizeText = (v) => String(v ?? '').trim()
        const normalizeKey = (v) => normalizeText(v).toLowerCase()
        const normalizeId = (v) => {
          const s = normalizeText(v)
          if (!s) return ''
          const parts = s.split(/[\\/]/).filter(Boolean)
          return parts.length ? parts[parts.length - 1] : s
        }
        const normalizeSpecKey = (v) => normalizeKey(v).replace(/[x*]/g, '×').replace(/mm$/i, '')
        const isMaterialNo = (val) => {
          const s = normalizeText(val)
          if (!s) return false
          if (s.includes('-')) return /^\d/.test(s) && /\d/.test(s)
          return /^\d{6,}$/.test(s)
        }

        const first = (r.items && r.items[0]) ? r.items[0] : null
        const data = r?.data && typeof r.data === 'object' ? r.data : null
        const firstData = first?.data && typeof first.data === 'object' ? first.data : null
        const meta = r?.meta && typeof r.meta === 'object' ? r.meta : null
        const brief = meta?.brief && typeof meta.brief === 'object' ? meta.brief : null
        const product = r?.product && typeof r.product === 'object' ? r.product : null

        const customerId = normalizeId(
          r.customerId || r.customer?._id || r.customer?.id ||
          data?.customerId || data?.customer?._id || data?.customer?.id ||
          meta?.customerId || meta?.customer?._id || meta?.customer?.id ||
          brief?.customerId || brief?.customer?._id || brief?.customer?.id ||
          product?.customerId || product?.customer?._id || product?.customer?.id
        )
        const skuId = normalizeId(
          r.skuId || r.sku_id || r.sku?._id || r.sku?.id || r.customerSkuId || r.customer_sku_id ||
          first?.skuId || first?.sku_id || first?.sku?._id || first?.sku?.id || first?.customerSkuId || first?.customer_sku_id ||
          firstData?.skuId || firstData?.sku_id || firstData?.sku?._id || firstData?.sku?.id || firstData?.customerSkuId || firstData?.customer_sku_id ||
          data?.skuId || data?.sku_id || data?.sku?._id || data?.sku?.id || data?.customerSkuId || data?.customer_sku_id ||
          meta?.skuId || meta?.sku_id || meta?.sku?._id || meta?.sku?.id || meta?.customerSkuId || meta?.customer_sku_id ||
          brief?.skuId || brief?.sku_id || brief?.sku?._id || brief?.sku?.id || brief?.customerSkuId || brief?.customer_sku_id ||
          product?.skuId || product?.sku_id || product?.sku?._id || product?.sku?.id || product?.customerSkuId || product?.customer_sku_id
        )
        const skuIndex = customerId ? customerSkuIndexByCustomerId.get(customerId) : null
        const rawSpec = normalizeText(
          r.specification || r.productSpec || r.product_spec ||
          data?.specification || data?.productSpec || data?.product_spec ||
          meta?.specification || meta?.productSpec || meta?.product_spec ||
          brief?.specification || brief?.productSpec || brief?.product_spec ||
          product?.specification || product?.productSpec || product?.product_spec ||
          first?.specification || first?.productSpec || first?.product_spec ||
          firstData?.specification || firstData?.productSpec || firstData?.product_spec ||
          r.spec || data?.spec || first?.spec || firstData?.spec ||
          ''
        )
        const localMaterialNo = normalizeText(
          r.materialNo || r.material_no ||
          data?.materialNo || data?.material_no ||
          meta?.materialNo || meta?.material_no ||
          brief?.materialNo || brief?.material_no ||
          product?.materialNo || product?.material_no ||
          first?.materialNo || first?.material_no ||
          firstData?.materialNo || firstData?.material_no
        )
        const localMaterialCode = normalizeText(
          r.materialCode || r.material_code ||
          data?.materialCode || data?.material_code ||
          meta?.materialCode || meta?.material_code ||
          brief?.materialCode || brief?.material_code ||
          product?.materialCode || product?.material_code ||
          first?.materialCode || first?.material_code ||
          firstData?.materialCode || firstData?.material_code
        )
        const specKey = normalizeSpecKey(rawSpec)
        const nameKey = normalizeKey(r.goodsName || r.goods_name || r.productTitle || r.product_title || r.title || first?.title || first?.productName || first?.goodsName || '')
        const materialNoKeyBase = normalizeKey(localMaterialNo)
        let skuFromIndex = null
        if (skuIndex) {
          if (skuId && skuIndex.has(`id:${normalizeKey(skuId)}`)) skuFromIndex = skuIndex.get(`id:${normalizeKey(skuId)}`)
          else if (materialNoKeyBase && specKey && skuIndex.has(`ms:${materialNoKeyBase}::${specKey}`)) skuFromIndex = skuIndex.get(`ms:${materialNoKeyBase}::${specKey}`)
          else if (materialNoKeyBase && skuIndex.has(`m:${materialNoKeyBase}`)) skuFromIndex = skuIndex.get(`m:${materialNoKeyBase}`)
          else if (nameKey && specKey && skuIndex.has(`ns:${nameKey}::${specKey}`)) skuFromIndex = skuIndex.get(`ns:${nameKey}::${specKey}`)
          else if (nameKey && skuIndex.has(`n:${nameKey}`)) skuFromIndex = skuIndex.get(`n:${nameKey}`)
        }
        const skuMaterialNo = normalizeText(skuFromIndex?.materialNo || skuFromIndex?.material_no)
        const skuMaterialCode = normalizeText(skuFromIndex?.materialCode || skuFromIndex?.material_code)
        const materialCodeRaw = localMaterialCode || skuMaterialCode
        const materialCode = isMaterialNo(materialCodeRaw) ? '' : materialCodeRaw
        const isMaterialCodeFormat = (val) => /^(AB|EB|A|B|E)楞$/.test(normalizeText(val))
        const materialNoFromCode = (!localMaterialNo && isMaterialNo(materialCodeRaw)) ? materialCodeRaw : ''
        const materialNoKey = normalizeKey(localMaterialNo || materialNoFromCode)
        if (!skuFromIndex && materialNoFromCode && skuIndex) {
          if (materialNoKey && specKey && skuIndex.has(`ms:${materialNoKey}::${specKey}`)) skuFromIndex = skuIndex.get(`ms:${materialNoKey}::${specKey}`)
          else if (materialNoKey && skuIndex.has(`m:${materialNoKey}`)) skuFromIndex = skuIndex.get(`m:${materialNoKey}`)
        }
        const materialNoDisplay = (() => {
          const v = normalizeText(localMaterialNo || materialNoFromCode) || normalizeText(skuMaterialNo)
          if (!v) return ''
          if (materialCode && normalizeKey(v) === normalizeKey(materialCode)) return ''
          return v
        })()
        const rawName = normalizeText(r.goodsName || r.productTitle || first?.title || first?.productName || first?.goodsName || '-')
        const skuName = normalizeText(skuFromIndex?.name ?? skuFromIndex?.goodsName ?? skuFromIndex?.productName)
        const name = (() => {
          if (skuName && (!rawName || rawName === '-' || isMaterialNo(rawName) || isMaterialCodeFormat(rawName) || rawName === materialCode)) return skuName
          if (rawName && rawName !== materialCode) return rawName
          if (skuName) return skuName
          return rawName || '-'
        })()
        return (
          <div>
            <div style={{ fontWeight: 500 }}>{name}</div>
            {materialNoDisplay ? <div><span style={{ color: '#6b7280' }}>物料号：</span>{materialNoDisplay}</div> : null}
          </div>
        )
      }
    },
    // 材质信息列已按需求删除


    {
      title: '数量',
      dataIndex: 'quantity',
      key: 'quantity',
      width: 72,
      render: (v) => (v ?? '-')
    },
    {
      title: '单价',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: 72,
      render: (v, r) => (r.__groupParent ? null : (v ?? '-'))
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 86,
      render: (amount) => (amount ?? 0).toLocaleString()
    },
    {
      title: '利润',
      dataIndex: 'profit',
      key: 'profit',
      width: 86,
      render: (v, r) => {
        const toNum = (x) => {
          if (x === null || x === undefined || x === '') return NaN
          if (typeof x === 'number') return x
          const raw = String(x).trim()
          if (!raw) return NaN
          const cleaned = raw.replace(/[,\s¥￥]/g, '')
          const n = Number(cleaned)
          if (Number.isFinite(n)) return n
          const m = cleaned.match(/-?\d+(\.\d+)?/)
          return m ? Number(m[0]) : NaN
        }
        const n = toNum(r?.profit ?? r?.grossProfit ?? r?.gross_profit ?? v)
        return Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-'
      }
    },
    {
      title: '订单状态',
      dataIndex: 'status',
      key: 'status',
      width: 84,
      render: (status, record) => {
        const raw = String(status ?? '').trim()
        const normalized = (() => {
          const s = raw.toLowerCase()
          if (raw === '已取消' || raw === '取消' || s === 'cancelled' || s === 'canceled') return 'cancelled'
          if (raw === '已完成' || raw === '完成' || s === 'completed' || s === 'done') return 'completed'
          if (raw === '已发货' || raw === '正在发货' || raw === '已送货' || s === 'shipped' || s === 'shipping' || s === 'delivered') return 'shipping'
          if (raw === '已入库' || s === 'stocked' || s === 'warehoused' || s === 'warehouse') return 'stocked'
          if (raw === '生产中' || s === 'processing' || s === 'in_progress' || s === 'producing') return 'processing'
          if (raw === '待生产' || s === 'pending' || s === 'waiting' || s === 'planned') return 'pending'
          if (raw === '已下单' || s === 'ordered') return 'ordered'
          return s || 'ordered'
        })()
        const showArrived = normalized === 'ordered' && record?.materialArrived
        if (showArrived) {
          return <Tag color="green">已来料</Tag>
        }
        const meta = statusMap[normalized] || statusMap[raw] || {}
        return (
          <Tag color={meta.color || 'default'}>{meta.text || raw || '-'}</Tag>
        )
      }
    },
    {
      title: '采购',
      key: 'materialIn',
      width: 72,
      render: (_, record) => {
        const hasPurchaseOrder = Boolean(record.purchaseOrderNo || record.purchaseOrderId)
        const poNo = record.purchaseOrderNo ? String(record.purchaseOrderNo) : ''
        return (
          <span
            className={hasPurchaseOrder ? 'material-status material-status--arrived' : 'material-status material-status--pending'}
            title={hasPurchaseOrder ? (poNo ? `已生成采购单：${poNo}` : '已生成采购单') : '未生成采购单'}
          >
            {hasPurchaseOrder ? (
              <CheckCircleFilled className="material-status-icon" />
            ) : (
              <span className="material-status-circle" />
            )}
          </span>
        )
      }
    },
    {
      title: '下单时间',
      key: 'createdAt',
      width: 110,
      render: (_, r) => {
        const t = r.createTime || r.createdAt
        return t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '-'
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 60,
      render: (_, record) => {
        const id = record._id || record.id || ''
        if (!id) return null
        return (
          <Space size="small">
            <Button
              type="link"
              danger
              icon={<DeleteOutlined style={{ fontSize: 20 }} />}
              onClick={() => {
                Modal.confirm({
                  title: '确认删除',
                  content: '此操作为永久删除，将从数据库中移除且不可恢复，是否确认删除该订单？',
                  okText: '删除',
                  okType: 'danger',
                  cancelText: '取消',
                  onOk: () => handleDelete(record)
                })
              }}
            />
          </Space>
        )
      }
    }
  ]

  const extractList = (res) => {
    return extractListFromResponse(res)
  }

  const extractPagination = (res) => {
    return extractPaginationFromResponse(res)
  }

  const normalizeOrders = (data, pageNo) => {
    const pickText = (...vals) => {
      for (const v of vals) {
        const s = String(v ?? '').trim()
        if (!s) continue
        if (['-', '—', '--', '---', '暂无', '无'].includes(s)) continue
        return s
      }
      return ''
    }
    const toNum = (v) => {
      const n = Number(v)
      if (Number.isFinite(n)) return n
      const m = String(v ?? '').match(/-?\d+(\.\d+)?/)
      return m ? Number(m[0]) : 0
    }
    const pickOrderNo = (o) => {
      const top = String(o?.orderNo ?? '').trim()
      if (top) return top

      const candidates = [
        o?.orderNumber,
        o?.order_number,
        o?.no,
        o?.data?.orderNo,
        o?.data?.orderNumber,
        o?.data?.order_number,
        o?.data?.no,
        o?.data?.data?.orderNo,
        o?.data?.data?.orderNumber,
        o?.data?.data?.order_number,
        o?.data?.data?.no,
        o?.meta?.orderNo,
        o?.meta?.orderNumber,
        o?.meta?.order_number,
        o?.meta?.no
      ]
        .map(v => String(v ?? '').trim())
        .filter(Boolean)

      const child = candidates.find(v => /-\d+$/.test(v))
      return child || candidates[0] || ''
    }
    const buildQrServerUrl = (payload, size = 220) => {
      const s = Number(size) || 220
      return `https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&data=${encodeURIComponent(String(payload || ''))}`
    }
    const buildOrderQrPayload = ({ orderId, orderNo }) => {
      return JSON.stringify({ v: 1, orderId: String(orderId || '').trim(), orderNo: String(orderNo || '').trim() })
    }
    const normalizeQrUrl = (rawUrl, { orderId, orderNo }) => {
      const url = String(rawUrl || '').trim()
      if (url) {
        const lower = url.toLowerCase()
        if (lower.includes('api.qrserver.com/v1/create-qr-code')) {
          const sizeMatch = url.match(/[?&]size=([^&]+)/i)
          const sizeVal = sizeMatch ? String(sizeMatch[1]) : ''
          const okSize = /^\d+x\d+$/i.test(sizeVal)
          const hasData = /[?&]data=/.test(url)
          if (okSize && hasData) return url
          return buildQrServerUrl(buildOrderQrPayload({ orderId, orderNo }), 220)
        }
        return url
      }
      if (!orderId && !orderNo) return ''
      return buildQrServerUrl(buildOrderQrPayload({ orderId, orderNo }), 220)
    }
    const list = (data || []).map((o, idx) => {
      const resolvedOrderNo = pickOrderNo(o)
      const normalizedItems =
        Array.isArray(o?.items) ? o.items
          : Array.isArray(o?.data?.items) ? o.data.items
            : Array.isArray(o?.data?.data?.items) ? o.data.data.items
              : Array.isArray(o?.meta?.items) ? o.meta.items
                : []
      const firstItem = normalizedItems[0] || {}
      const dataObj = o?.data && typeof o.data === 'object' ? o.data : null
      const metaObj = o?.meta && typeof o.meta === 'object' ? o.meta : null
      const briefObj = metaObj?.brief && typeof metaObj.brief === 'object' ? metaObj.brief : null
      const productObj = o?.product && typeof o.product === 'object' ? o.product : null
      const firstData = firstItem?.data && typeof firstItem.data === 'object' ? firstItem.data : null
      const specification = pickText(
        o?.specification,
        o?.productSpec,
        o?.product_spec,
        dataObj?.specification,
        dataObj?.productSpec,
        dataObj?.product_spec,
        metaObj?.specification,
        metaObj?.productSpec,
        metaObj?.product_spec,
        briefObj?.specification,
        briefObj?.productSpec,
        briefObj?.product_spec,
        productObj?.specification,
        productObj?.productSpec,
        productObj?.product_spec,
        firstItem?.specification,
        firstItem?.productSpec,
        firstItem?.product_spec,
        firstData?.specification,
        firstData?.productSpec,
        firstData?.product_spec,
        o?.spec,
        dataObj?.spec,
        metaObj?.spec,
        briefObj?.spec,
        productObj?.spec,
        firstItem?.spec,
        firstData?.spec
      )
      const boardWidth = toNum(
        o?.boardWidth ?? o?.board_width ??
        dataObj?.boardWidth ?? dataObj?.board_width ??
        metaObj?.boardWidth ?? metaObj?.board_width ??
        briefObj?.boardWidth ?? briefObj?.board_width ??
        productObj?.boardWidth ?? productObj?.board_width ??
        firstItem?.boardWidth ?? firstItem?.board_width ??
        firstData?.boardWidth ?? firstData?.board_width ??
        o?.specWidth ?? o?.spec_width ??
        dataObj?.specWidth ?? dataObj?.spec_width ??
        0
      )
      const boardHeight = toNum(
        o?.boardHeight ?? o?.board_height ??
        dataObj?.boardHeight ?? dataObj?.board_height ??
        metaObj?.boardHeight ?? metaObj?.board_height ??
        briefObj?.boardHeight ?? briefObj?.board_height ??
        productObj?.boardHeight ?? productObj?.board_height ??
        firstItem?.boardHeight ?? firstItem?.board_height ??
        firstData?.boardHeight ?? firstData?.board_height ??
        o?.specLength ?? o?.spec_length ??
        dataObj?.specLength ?? dataObj?.spec_length ??
        0
      )
      const materialNoResolved = pickText(
        o?.materialNo,
        o?.material_no,
        dataObj?.materialNo,
        dataObj?.material_no,
        metaObj?.materialNo,
        metaObj?.material_no,
        briefObj?.materialNo,
        briefObj?.material_no,
        productObj?.materialNo,
        productObj?.material_no,
        firstItem?.materialNo,
        firstItem?.material_no,
        firstData?.materialNo,
        firstData?.material_no
      ) || undefined
      const profitMeta = (() => {
        const toNumMaybe = (v) => {
          if (v === null || v === undefined || v === '') return NaN
          if (typeof v === 'number') return v
          const raw = String(v).trim()
          if (!raw) return NaN
          const cleaned = raw.replace(/[,\s¥￥]/g, '')
          const n = Number(cleaned)
          if (Number.isFinite(n)) return n
          const m = cleaned.match(/-?\d+(\.\d+)?/)
          return m ? Number(m[0]) : NaN
        }
        const pickNumMeta = (...vals) => {
          for (const v of vals) {
            const n = toNumMaybe(v)
            if (Number.isFinite(n)) return ({ val: n, found: true })
          }
          return ({ val: undefined, found: false })
        }

        const direct = pickNumMeta(
          o?.profit,
          o?.orderProfit,
          o?.order_profit,
          o?.totalProfit,
          o?.total_profit,
          o?.totalGrossProfit,
          o?.total_gross_profit,
          o?.grossProfit,
          o?.gross_profit,
          dataObj?.profit,
          dataObj?.orderProfit,
          dataObj?.order_profit,
          dataObj?.totalProfit,
          dataObj?.total_profit,
          dataObj?.totalGrossProfit,
          dataObj?.total_gross_profit,
          dataObj?.grossProfit,
          dataObj?.gross_profit,
          dataObj?.meta?.profit,
          dataObj?.meta?.totalProfit,
          dataObj?.meta?.totalGrossProfit,
          metaObj?.profit,
          metaObj?.totalProfit,
          metaObj?.totalGrossProfit,
          metaObj?.grossProfit,
          briefObj?.profit,
          briefObj?.totalProfit,
          briefObj?.totalGrossProfit,
          briefObj?.grossProfit,
          productObj?.profit,
          productObj?.totalProfit,
          productObj?.totalGrossProfit,
          productObj?.grossProfit
        )
        if (direct.found) return ({ val: direct.val, trusted: true })
        return ({ val: undefined, trusted: false })
      })()
      return ({
        ...o,
        items: normalizedItems.length ? normalizedItems : o.items,
        key: o._id ?? o.id ?? `order_${pageNo}_${idx}`,
        orderNo: resolvedOrderNo,
        orderNumber: resolvedOrderNo || o?.orderNumber,
        customerName: pickText(
          o.customerName,
          o.customer_name,
          o.customer?.companyName,
          o.customer?.shortName,
          o.customer?.name,
          o.customer?.company,
          o.customer,
          o.data?.customerName,
          o.data?.customer_name,
          o.meta?.customerName,
          o.meta?.customer_name
        ),
        productName: o.productName ?? o.product?.name ?? o.product,
        goodsName: pickText(
          o.goodsName,
          o.goods_name,
          o.productTitle,
          o.product_title,
          firstItem.goodsName,
          firstItem.title,
          firstItem.productName,
          o.title,
          o.productName
        ) || '-',
        orderType: String(o.orderType || '').toLowerCase(),
        boardWidth: boardWidth > 0 ? boardWidth : undefined,
        boardHeight: boardHeight > 0 ? boardHeight : undefined,
        materialNo: materialNoResolved,
        quantity: o.quantity ?? o.totalQty ?? normalizedItems.reduce((s, it) => s + (Number(it?.quantity || 0) || 0), 0) ?? 0,
        unitPrice: o.unitPrice ?? firstItem.unitPrice ?? undefined,
        amount: o.amount ?? o.totalAmount ?? o.finalAmount ?? 0,
        profit: profitMeta.val,
        __profitTrusted: Boolean(profitMeta.trusted),
      stockedAtTs: (() => {
        const t = o.stockedAt || o.warehouseAt || o.updatedAt || null
        if (!t) return 0
        try { return dayjs(t).valueOf() } catch { return 0 }
      })(),
      status: (() => {
        const raw = String(o.status ?? '').trim()
        const s = raw.toLowerCase()
        if (raw === '已取消' || raw === '取消' || s === 'cancelled' || s === 'canceled') return 'cancelled'
        if (raw === '已完成' || raw === '完成' || s === 'completed' || s === 'done') return 'completed'
        if (raw === '已发货' || raw === '正在发货' || raw === '已送货' || s === 'shipped' || s === 'shipping' || s === 'delivered') return 'shipping'
        if (raw === '已入库' || s === 'stocked' || s === 'warehoused' || s === 'warehouse') return 'stocked'
        if (raw === '生产中' || s === 'processing' || s === 'in_progress' || s === 'producing') return 'processing'
        if (raw === '待生产' || s === 'pending' || s === 'waiting' || s === 'planned') return 'pending'
        if (raw === '已下单' || s === 'ordered') return 'ordered'
        return 'ordered'
      })(),
      priority: o.priority ?? 'normal',
      createTime: o.createTime ?? o.createdAt ?? null,
      deliveryDate: o.deliveryDate ?? null,
      specification,
      spec: specification,
      materialCode: pickText(
        o.materialCode,
        o.material_code,
        o.material,
        o.data?.materialCode,
        o.data?.material_code,
        o.data?.material,
        o.meta?.materialCode,
        o.meta?.material_code,
        o.meta?.material,
        o.meta?.brief?.materialCode,
        o.meta?.brief?.material_code,
        o.meta?.brief?.material,
        o.product?.materialCode,
        o.product?.material_code,
        o.product?.material,
        firstItem.materialCode,
        firstItem.material_code,
        firstItem.material,
        firstItem?.data?.materialCode,
        firstItem?.data?.material_code,
        firstItem?.data?.material,
        firstItem?.product?.materialCode,
        firstItem?.product?.material_code,
        firstItem?.product?.material,
        firstItem?.meta?.materialCode,
        firstItem?.meta?.material_code,
        firstItem?.meta?.material,
        firstItem?.meta?.brief?.materialCode,
        firstItem?.meta?.brief?.material_code,
        firstItem?.meta?.brief?.material
      ),
      flute: pickText(
        o.flute,
        o.fluteType,
        o.flute_type,
        o.flute_code,
        o.data?.flute,
        o.data?.fluteType,
        o.data?.flute_type,
        o.data?.flute_code,
        o.meta?.flute,
        o.meta?.fluteType,
        o.meta?.flute_type,
        o.meta?.flute_code,
        o.meta?.brief?.flute,
        o.meta?.brief?.fluteType,
        o.meta?.brief?.flute_type,
        o.meta?.brief?.flute_code,
        o.product?.flute,
        o.product?.fluteType,
        o.product?.flute_type,
        o.product?.flute_code,
        firstItem.flute,
        firstItem.fluteType,
        firstItem.flute_type,
        firstItem.flute_code,
        firstItem?.data?.flute,
        firstItem?.data?.fluteType,
        firstItem?.data?.flute_type,
        firstItem?.data?.flute_code
      ),
      creasingType: o.creasingType,
      creasingSize1: o.creasingSize1,
      creasingSize2: o.creasingSize2,
      creasingSize3: o.creasingSize3,
      materialArrived: !!(o.materialArrived || o.material_status === 'arrived'),
        qrCodeUrl: normalizeQrUrl(o.qrCodeUrl, { orderId: o._id ?? o.id ?? '', orderNo: resolvedOrderNo })
      })
    })

    console.log('[normalizeOrders] Total orders before filtering:', list.length)

    const filtered = list.filter((o) => {
      const deletedFlag = Boolean(o.isDeleted || o.is_deleted || o.deletedAt || o.deleted_at) || String(o.deleted).toLowerCase() === 'true'

      const orderTypeVal = String(o.orderType || '').toLowerCase()
      const sourceVal = String(o.source || '').toLowerCase()
      const purchaseCategoryVal = String(o.purchaseCategory || o.category || '').trim().toLowerCase()
      const isThirdPartyOrder =
        orderTypeVal === 'purchase' ||
        sourceVal === 'purchased' ||
        Boolean(purchaseCategoryVal)

      const shouldKeep = !deletedFlag && !isThirdPartyOrder

      if (!shouldKeep) {
        console.log('[normalizeOrders] Filtering out order:', {
          id: o._id || o.id,
          orderNo: o.orderNo || o.orderNumber,
          deleted: deletedFlag,
          purchaseCategory: o.purchaseCategory,
          reason: deletedFlag ? 'deleted' : 'purchase_like'
        })
      }

      return shouldKeep
    })

    console.log('[normalizeOrders] Orders after filtering:', filtered.length)
    console.log('[normalizeOrders] Filtered out count:', list.length - filtered.length)

    return filtered
  }

  const inflightCustomerSkuRef = useRef(new Set())

  const customerSkuIndexByCustomerId = useMemo(() => {
    const normalizeText = (v) => String(v ?? '').trim()
    const normalizeKey = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, '')
    const normalizeSpecKey = (v) => normalizeKey(v).replace(/[x*]/g, '×').replace(/mm$/i, '')
    const normalizeId = (v) => {
      const s = normalizeText(v)
      if (!s) return ''
      const parts = s.split(/[\\/]/).filter(Boolean)
      return parts.length ? parts[parts.length - 1] : s
    }
    const result = new Map()
    Object.entries(customerSkusByCustomerId || {}).forEach(([cid, skus]) => {
      const map = new Map()
      ;(Array.isArray(skus) ? skus : []).forEach((sku) => {
        const sid = normalizeId(sku?.id ?? sku?._id)
        if (sid) map.set(`id:${normalizeKey(sid)}`, sku)
        const materialNo = normalizeKey(sku?.materialNo ?? sku?.material_no)
        const materialCode = normalizeKey(sku?.materialCode ?? sku?.material_code ?? sku?.material)
        const spec = normalizeSpecKey(sku?.specification ?? sku?.spec)
        const name = normalizeKey(sku?.name ?? sku?.goodsName ?? sku?.productName)
        if (materialNo) map.set(`m:${materialNo}`, sku)
        if (materialNo && spec) map.set(`ms:${materialNo}::${spec}`, sku)
        if (materialCode) map.set(`c:${materialCode}`, sku)
        if (materialCode && spec) map.set(`cs:${materialCode}::${spec}`, sku)
        if (materialNo) {
          const baseNo = materialNo.split('/').filter(Boolean)[0] || ''
          if (baseNo && baseNo !== materialNo) {
            const mk = `m:${baseNo}`
            if (!map.has(mk)) map.set(mk, sku)
            if (spec) {
              const msk = `ms:${baseNo}::${spec}`
              if (!map.has(msk)) map.set(msk, sku)
            }
          }
        }
        if (name) map.set(`n:${name}`, sku)
        if (name && spec) map.set(`ns:${name}::${spec}`, sku)
      })
      result.set(String(cid), map)
    })
    return result
  }, [customerSkusByCustomerId])

  useEffect(() => {
    const normalizeText = (v) => String(v ?? '').trim()
    const normalizeId = (v) => {
      const s = normalizeText(v)
      if (!s) return ''
      const parts = s.split(/[\\/]/).filter(Boolean)
      return parts.length ? parts[parts.length - 1] : s
    }
    const extractSkus = (resp) => {
      const body = resp?.data ?? resp
      if (Array.isArray(body?.data?.skus)) return body.data.skus
      if (Array.isArray(body?.data?.data?.skus)) return body.data.data.skus
      if (Array.isArray(body?.skus)) return body.skus
      if (Array.isArray(body?.data)) return body.data
      return []
    }
    const readTotalPages = (resp) => {
      const body = resp?.data ?? resp
      const pagination = body?.data?.pagination ?? body?.data?.data?.pagination ?? body?.pagination ?? null
      const n = Number(pagination?.totalPages || 0)
      return Number.isFinite(n) && n > 0 ? n : 0
    }
    const ids = Array.from(new Set((orders || [])
      .map((o) => normalizeId(o?.customerId ?? o?.customer?._id ?? o?.customer?.id))
      .filter(Boolean)))
    if (!ids.length) return

    let cancelled = false
    const loadForCustomer = async (customerId) => {
      if (!customerId) return
      if ((customerSkusByCustomerId || {})[customerId]) return
      if (inflightCustomerSkuRef.current.has(customerId)) return
      inflightCustomerSkuRef.current.add(customerId)
      try {
        const all = []
        const pageSize = 200
        const maxPages = 50
        for (let page = 1; page <= maxPages; page += 1) {
          const resp = await cachedCustomerSkuAPI.getCustomerSkus({ customerId, params: { page, pageSize, limit: pageSize } })
          const list = extractSkus(resp)
          if (list.length) all.push(...list)
          const totalPages = readTotalPages(resp)
          if (totalPages && page >= totalPages) break
          if (!list.length || list.length < pageSize) break
        }
        if (cancelled) return
        const normalized = (all || []).map((s) => {
          const sid = normalizeId(s?.id ?? s?._id)
          return { ...s, id: sid || undefined, _id: sid || s?._id }
        })
        setCustomerSkusByCustomerId((prev) => ({ ...(prev || {}), [customerId]: normalized }))
      } catch (_) {
        if (!cancelled) setCustomerSkusByCustomerId((prev) => ({ ...(prev || {}), [customerId]: [] }))
      } finally {
        inflightCustomerSkuRef.current.delete(customerId)
      }
    }
    ;(async () => {
      for (const cid of ids) {
        if (cancelled) return
        await loadForCustomer(cid)
      }
    })()
    return () => { cancelled = true }
  }, [orders, customerSkusByCustomerId])

  const applySearch = useCallback((params) => {
    let data = [...allOrders]
    const keyGetter = (o) => {
      if (sortField === 'time') return Number(o.stockedAtTs || 0)
      if (sortField === 'qty') return Number(o.quantity || 0)
      if (sortField === 'amount') return Number(o.amount || 0)
      return 0
    }
    data = data.slice().sort((a, b) => {
      const av = keyGetter(a)
      const bv = keyGetter(b)
      return sortDir === 'desc' ? (bv - av) : (av - bv)
    })
    setOrders(data)
  }, [allOrders, sortDir, sortField])

  useEffect(() => {
    applySearch(searchParams)
  }, [allOrders])

  useEffect(() => {
    hydrateProfitForOrders(allOrders)
  }, [allOrders, hydrateProfitForOrders])

  const rowKeyOf = useCallback((record) => {
    if (record?.__groupParent) {
      const parentNo = String(record?.__parentNo || record?.orderNo || record?.orderNumber || record?.key || '').trim()
      return parentNo ? `group:${parentNo}` : String(record?.key || '')
    }
    if (record?.__itemChild) {
      const k = String(record?.key || '').trim()
      if (k) return k
      const ono = String(record?.orderNo || record?.orderNumber || '').trim()
      return ono ? `item:${ono}` : ''
    }
    const k = record?._id || record?.id || record?.key
    const s = String(k ?? '').trim()
    return s
  }, [])

  const persistExpandedKeys = useCallback((keys) => {
    try {
      if (typeof window === 'undefined') return
      window.localStorage.setItem(expandedStoreKey, JSON.stringify((keys || []).map(String)))
    } catch (_) {
      void 0
    }
  }, [expandedStoreKey])

  const toggleExpand = useCallback((record) => {
    const k = rowKeyOf(record)
    if (!k) return
    setExpandedRowKeys((prev) => {
      const current = Array.isArray(prev) ? prev.map(String) : []
      const exists = current.includes(k)
      const next = exists ? current.filter(x => x !== k) : [...current, k]
      persistExpandedKeys(next)
      return next
    })
  }, [persistExpandedKeys, rowKeyOf])

  const setExpandedForRecord = useCallback((record, expanded) => {
    const k = rowKeyOf(record)
    if (!k) return
    setExpandedRowKeys((prev) => {
      const current = Array.isArray(prev) ? prev.map(String) : []
      const next = expanded ? (current.includes(k) ? current : [...current, k]) : current.filter(x => x !== k)
      persistExpandedKeys(next)
      return next
    })
  }, [persistExpandedKeys, rowKeyOf])

  const groupedOrders = useMemo(() => {
    const list = Array.isArray(orders) ? orders : []
    const parentByNo = new Map()
    const childrenByParentNo = new Map()
    const itemsByParentNo = new Map()
    const itemChildSourceByParentNo = new Map()

    const parseOrderNo = (raw) => {
      const orderNo = String(raw || '').trim()
      if (!orderNo) return { parentNo: '', isChild: false, orderNo: '' }
      const m = orderNo.match(/^(.*?)-(\d+)$/)
      if (!m) return { parentNo: orderNo, isChild: false, orderNo }
      const parentNo = String(m[1] || '').trim()
      return { parentNo: parentNo || orderNo, isChild: true, orderNo }
    }

    list.forEach((o) => {
      const { parentNo, isChild, orderNo } = parseOrderNo(o?.orderNo)
      if (!orderNo || !parentNo) return

      if (isChild) {
        const items = Array.isArray(o?.items) ? o.items : []
        if (items.length > 1) {
          if (!itemChildSourceByParentNo.has(parentNo)) {
            itemChildSourceByParentNo.set(parentNo, { parent: o, items })
          }
          return
        }
        if (!childrenByParentNo.has(parentNo)) childrenByParentNo.set(parentNo, [])
        childrenByParentNo.get(parentNo).push(o)
        return
      }
      parentByNo.set(parentNo, o)

      const items = Array.isArray(o?.items) ? o.items : []
      if (items.length > 1) {
        itemsByParentNo.set(parentNo, items)
      }
    })

    const result = []
    const seenParent = new Set()

    const toNumMaybe = (v) => {
      if (v === null || v === undefined || v === '') return NaN
      if (typeof v === 'number') return v
      const raw = String(v).trim()
      if (!raw) return NaN
      const cleaned = raw.replace(/[,\s¥￥]/g, '')
      const n = Number(cleaned)
      if (Number.isFinite(n)) return n
      const m = cleaned.match(/-?\d+(\.\d+)?/)
      return m ? Number(m[0]) : NaN
    }
    const toNum = (v) => {
      const n = toNumMaybe(v)
      return Number.isFinite(n) ? n : 0
    }

    const readProfit = (o) => {
      const n = toNumMaybe(
        o?.profit ??
        o?.orderProfit ??
        o?.order_profit ??
        o?.totalProfit ??
        o?.total_profit ??
        o?.totalGrossProfit ??
        o?.total_gross_profit ??
        o?.grossProfit ??
        o?.gross_profit
      )
      return Number.isFinite(n) ? n : NaN
    }

    const calcRowProfit = (row) => {
      const r = row && typeof row === 'object' ? row : {}
      const existing = readProfit(r)
      if (Number.isFinite(existing)) return existing

      const qty = toNumMaybe(r?.quantity ?? r?.qty ?? r?.count ?? r?.orderQty ?? r?.orderQuantity ?? 0)
      let amount = toNumMaybe(r?.amount ?? r?.totalAmount ?? r?.total_amount ?? r?.finalAmount ?? r?.final_amount)
      if (!Number.isFinite(amount)) {
        const price = toNumMaybe(r?.unitPrice ?? r?.unit_price ?? r?.salePrice ?? r?.sale_price ?? r?.price ?? 0)
        if (qty > 0 && Number.isFinite(price)) amount = qty * price
      }
      if (!Number.isFinite(amount)) return NaN

      const costPrice = toNumMaybe(r?.rawUnitPrice ?? r?.raw_unit_price ?? r?.rawMaterialUnitPrice ?? r?.raw_material_unit_price ?? r?.costPrice ?? r?.cost_price ?? r?.purchasePrice ?? r?.purchase_price ?? 0)
      const totalSheets = toNumMaybe(
        r?.sheetCount ??
        r?.sheet_count ??
        r?.sheetQty ??
        r?.sheet_qty ??
        r?.orderedQuantity ??
        r?.ordered_quantity ??
        r?.orderedSheets ??
        r?.ordered_sheets ??
        0
      )
      const rawPerSheets = toNumMaybe(
        r?.skuSheetCount ??
        r?.sheetPerUnit ??
        r?.sheet_per_unit ??
        r?.perSheet ??
        r?.per_sheet ??
        0
      )
      const jm = String(r?.joinMethod ?? r?.join_method ?? '').trim()
      const joinFactor = jm.includes('四拼') ? 4 : (jm.includes('双拼') ? 2 : (jm.includes('单拼') ? 1 : 0))
      const ratio = (qty > 0 && totalSheets > 0) ? (totalSheets / qty) : 0
      const ratioRounded = Number.isFinite(ratio) && ratio > 0 ? Math.round(ratio) : 0
      const ratioFactor = ratioRounded > 0 && Math.abs(ratio - ratioRounded) <= 0.01 ? ratioRounded : 0
      const perSheets = Math.max(
        Number.isFinite(rawPerSheets) && rawPerSheets > 0 ? rawPerSheets : 0,
        joinFactor,
        ratioFactor
      )
      const computedSheets = (qty > 0 && Number.isFinite(perSheets) && perSheets > 0) ? qty * perSheets : 0
      const sheetsForCost = totalSheets > 0 ? totalSheets : (computedSheets > 0 ? computedSheets : qty)
      let rawAmount = 0
      if (totalSheets > 0 && Number.isFinite(costPrice)) rawAmount = totalSheets * costPrice
      else if (qty > 0 && Number.isFinite(costPrice)) rawAmount = sheetsForCost * costPrice
      return amount - rawAmount
    }

    const rank = {
      ordered: 0,
      pending: 1,
      processing: 2,
      producing: 2,
      stocked: 3,
      shipping: 4,
      shipped: 4,
      completed: 5,
      done: 5,
      cancelled: -1,
      canceled: -1
    }

    const summarizeChildren = (parentNo, children) => {
      const sortedChildren = (children || []).slice().sort((a, b) => String(a?.orderNo || '').localeCompare(String(b?.orderNo || '')))
      const first = sortedChildren[0] || {}
      const totalAmount = sortedChildren.reduce((s, c) => s + toNum(c?.amount ?? c?.totalAmount ?? c?.finalAmount), 0)
      const totalQty = sortedChildren.reduce((s, c) => s + toNum(c?.quantity), 0)
      const profitParts = sortedChildren.map(calcRowProfit).filter(Number.isFinite)
      const totalProfit = profitParts.length ? profitParts.reduce((s, p) => s + Number(p), 0) : undefined
      const createdMin = sortedChildren.reduce((min, c) => {
        const t = String(c?.createTime || c?.createdAt || '').trim()
        if (!t) return min
        if (!min) return t
        try {
          return dayjs(t).isBefore(dayjs(min)) ? t : min
        } catch (_) {
          return min
        }
      }, '')
      const statuses = sortedChildren.map(c => String(c?.status || '').toLowerCase()).filter(Boolean)
      const nonCancelled = statuses.filter(s => !['cancelled', 'canceled'].includes(s))
      const effective = nonCancelled.length ? nonCancelled : statuses
      const summaryStatus = effective.reduce((acc, s) => {
        const a = rank[acc] ?? 0
        const b = rank[s] ?? 0
        return b < a ? s : acc
      }, effective[0] || 'ordered')

      return {
        ...first,
        key: `group:${parentNo}`,
        orderNo: parentNo,
        amount: totalAmount,
        quantity: totalQty,
        profit: totalProfit,
        grossProfit: totalProfit,
        status: summaryStatus || 'ordered',
        createTime: createdMin || first?.createTime || first?.createdAt,
        __groupParent: true,
        __parentNo: parentNo,
        children: sortedChildren
      }
    }

    const buildItemChildren = (parent, parentNo, items) => {
      const pid = parent?._id || parent?.id || parent?.key || ''
      return (items || []).map((it, idx) => {
        const src = (it && typeof it === 'object') ? it : {}
        const qty = src.quantity ?? src.orderQty ?? src.qty ?? src.orderQuantity
        const unitPrice = src.unitPrice ?? src.listUnitPrice ?? parent?.unitPrice
        const amount = src.amount ?? (Number(qty || 0) * Number(unitPrice || 0))
        const materialNo = src.materialNo ?? parent?.materialNo
        const specification = src.specification ?? src.spec ?? parent?.specification ?? parent?.spec
        const goodsName = src.goodsName ?? src.title ?? parent?.goodsName ?? parent?.productTitle ?? parent?.title
        const productName = (
          src.productName ??
          src.productCategory ??
          src.productType ??
          src.category ??
          parent?.productName ??
          parent?.productCategory ??
          parent?.productType ??
          parent?.category
        )
        const rawUnitPrice = src.rawUnitPrice ?? src.raw_unit_price ?? src.rawMaterialUnitPrice ?? src.raw_material_unit_price ?? src.costPrice ?? src.cost_price ?? src.purchasePrice ?? src.purchase_price ?? parent?.rawUnitPrice ?? parent?.raw_unit_price
        const childProfit = calcRowProfit({
          ...parent,
          ...src,
          quantity: qty,
          unitPrice,
          amount,
          rawUnitPrice
        })
        return {
          ...parent,
          ...src,
          key: `item:${parentNo}-${idx + 1}:${pid || 'p'}`,
          orderNo: `${parentNo}-${idx + 1}`,
          orderNumber: `${parentNo}-${idx + 1}`,
          goodsName,
          productTitle: goodsName,
          productName,
          materialNo,
          specification,
          spec: specification,
          joinMethod: src.joinMethod ?? src.join_method ?? parent?.joinMethod ?? parent?.join_method,
          creasingType: src.creasingType ?? src.creasing_type ?? src.creaseType ?? src.crease_type ?? parent?.creasingType ?? parent?.creasingType,
          creasingSize1: src.creasingSize1 ?? src.creasing_size1 ?? src.creaseSize1 ?? src.crease_size1 ?? src.creasingSize_1 ?? src.creasing_size_1 ?? src.creaseSize_1 ?? src.crease_size_1 ?? parent?.creasingSize1 ?? parent?.creasing_size1 ?? parent?.creaseSize1 ?? parent?.crease_size1 ?? parent?.creasingSize_1 ?? parent?.creasing_size_1 ?? parent?.creaseSize_1 ?? parent?.crease_size_1,
          creasingSize2: src.creasingSize2 ?? src.creasing_size2 ?? src.creaseSize2 ?? src.crease_size2 ?? src.creasingSize_2 ?? src.creasing_size_2 ?? src.creaseSize_2 ?? src.crease_size_2 ?? parent?.creasingSize2 ?? parent?.creasing_size2 ?? parent?.creaseSize2 ?? parent?.crease_size2 ?? parent?.creasingSize_2 ?? parent?.creasing_size_2 ?? parent?.creaseSize_2 ?? parent?.crease_size_2,
          creasingSize3: src.creasingSize3 ?? src.creasing_size3 ?? src.creaseSize3 ?? src.crease_size3 ?? src.creasingSize_3 ?? src.creasing_size_3 ?? src.creaseSize_3 ?? src.crease_size_3 ?? parent?.creasingSize3 ?? parent?.creasing_size3 ?? parent?.creaseSize3 ?? parent?.crease_size3 ?? parent?.creasingSize_3 ?? parent?.creasing_size_3 ?? parent?.creaseSize_3 ?? parent?.crease_size_3,
          pressLine: src.pressLine ?? src.press_line ?? src.pressLineSize ?? src.press_line_size ?? src.creasingSize ?? src.creasing_size ?? src.creaseSize ?? src.crease_size ?? parent?.pressLine ?? parent?.press_line ?? parent?.pressLineSize ?? parent?.press_line_size ?? parent?.creasingSize ?? parent?.creasing_size ?? parent?.creaseSize ?? parent?.crease_size,
          quantity: qty,
          unitPrice,
          amount,
          profit: Number.isFinite(childProfit) ? childProfit : (Number.isFinite(Number(src?.profit)) ? Number(src.profit) : undefined),
          grossProfit: Number.isFinite(childProfit) ? childProfit : (Number.isFinite(Number(src?.grossProfit)) ? Number(src.grossProfit) : undefined),
          __itemChild: true,
          __parentNo: parentNo,
          __parentOrderId: pid,
          __itemIndex: idx
        }
      })
    }

    list.forEach((o) => {
      const { parentNo } = parseOrderNo(o?.orderNo)
      if (!parentNo || seenParent.has(parentNo)) return

      const parent = parentByNo.get(parentNo)
      const children = childrenByParentNo.get(parentNo) || []
      const itemChildSource = itemChildSourceByParentNo.get(parentNo)
      if (children.length) {
        if (parent) {
          const sortedChildren = children.slice().sort((a, b) => String(a?.orderNo || '').localeCompare(String(b?.orderNo || '')))
          const summary = summarizeChildren(parentNo, sortedChildren)
          const profitParts = (children || []).map(calcRowProfit).filter(Number.isFinite)
          const totalProfit = profitParts.length ? profitParts.reduce((s, p) => s + Number(p), 0) : undefined
          result.push({
            ...parent,
            orderNo: parentNo,
            amount: summary.amount,
            totalAmount: summary.amount,
            quantity: summary.quantity,
            status: summary.status,
            createTime: summary.createTime,
            profit: totalProfit,
            grossProfit: totalProfit,
            __groupParent: true,
            __parentNo: parentNo,
            children: sortedChildren
          })
        } else {
          result.push(summarizeChildren(parentNo, children))
        }
      } else if (itemChildSource && itemChildSource.parent && Array.isArray(itemChildSource.items) && itemChildSource.items.length > 1) {
        const base = parent || itemChildSource.parent
        const itemChildren = buildItemChildren(base, parentNo, itemChildSource.items)
        const totalAmount = itemChildren.reduce((s, c) => s + toNum(c?.amount ?? c?.totalAmount ?? c?.finalAmount), 0)
        const totalQty = itemChildren.reduce((s, c) => s + toNum(c?.quantity), 0)
        const profitParts = (itemChildren || []).map(calcRowProfit).filter(Number.isFinite)
        const totalProfit = profitParts.length ? profitParts.reduce((s, p) => s + Number(p), 0) : undefined
        result.push({
          ...base,
          orderNo: parentNo,
          amount: totalAmount,
          totalAmount: totalAmount,
          quantity: totalQty,
          profit: totalProfit,
          grossProfit: totalProfit,
          __groupParent: true,
          __parentNo: parentNo,
          __groupKind: 'items',
          children: itemChildren
        })
      } else if (parent && itemsByParentNo.has(parentNo)) {
        const itemChildren = buildItemChildren(parent, parentNo, itemsByParentNo.get(parentNo))
        const totalAmount = itemChildren.reduce((s, c) => s + toNum(c?.amount ?? c?.totalAmount ?? c?.finalAmount), 0)
        const totalQty = itemChildren.reduce((s, c) => s + toNum(c?.quantity), 0)
        const profitParts = (itemChildren || []).map(calcRowProfit).filter(Number.isFinite)
        const totalProfit = profitParts.length ? profitParts.reduce((s, p) => s + Number(p), 0) : undefined
        result.push({
          ...parent,
          orderNo: parentNo,
          amount: totalAmount,
          totalAmount: totalAmount,
          quantity: totalQty,
          profit: totalProfit,
          grossProfit: totalProfit,
          __groupParent: true,
          __parentNo: parentNo,
          __groupKind: 'items',
          children: itemChildren
        })
      } else if (parent) {
        result.push(parent)
      }
      seenParent.add(parentNo)
    })

    return result
  }, [orders])

  const parentChildKeys = useMemo(() => {
    const map = new Map()
    ;(groupedOrders || []).forEach((r) => {
      if (!r?.__groupParent) return
      if (!Array.isArray(r?.children) || r.children.length === 0) return
      const parentKey = String(rowKeyOf(r) || '').trim()
      if (!parentKey) return
      const childKeys = r.children.map((c) => String(rowKeyOf(c) || '').trim()).filter(Boolean)
      if (childKeys.length) map.set(parentKey, childKeys)
    })
    return map
  }, [groupedOrders, rowKeyOf])

  const normalizeSelectedKeys = useCallback((keys) => {
    const set = new Set((keys || []).map(k => String(k)).filter(Boolean))

    for (const [parentKey, childKeys] of parentChildKeys.entries()) {
      if (set.has(parentKey)) {
        childKeys.forEach(k => set.add(k))
      }
    }

    return Array.from(set)
  }, [parentChildKeys])

  const rowSelectionConfig = useMemo(() => {
    return {
      preserveSelectedRowKeys: true,
      selectedRowKeys,
      onChange: (nextKeys) => {
        setSelectedRowKeys((prev) => {
          const prevSet = new Set((prev || []).map(String).filter(Boolean))
          const nextSet = new Set((nextKeys || []).map(String).filter(Boolean))

          const removed = []
          prevSet.forEach((k) => {
            if (!nextSet.has(k)) removed.push(k)
          })

          const added = []
          nextSet.forEach((k) => {
            if (!prevSet.has(k)) added.push(k)
          })

          removed.forEach((k) => {
            const childKeys = parentChildKeys.get(k)
            if (childKeys && childKeys.length) {
              childKeys.forEach((ck) => nextSet.delete(String(ck)))
            }
          })

          added.forEach((k) => {
            const childKeys = parentChildKeys.get(k)
            if (childKeys && childKeys.length) {
              childKeys.forEach((ck) => nextSet.add(String(ck)))
            }
          })

          return normalizeSelectedKeys(Array.from(nextSet))
        })
      }
    }
  }, [normalizeSelectedKeys, parentChildKeys, rowKeyOf, selectedRowKeys])

  const expandableKeysSet = useMemo(() => {
    const set = new Set()
    ;(groupedOrders || []).forEach((r) => {
      if (Array.isArray(r?.children) && r.children.length > 0) {
        const k = rowKeyOf(r)
        if (k) set.add(k)
      }
    })
    return set
  }, [groupedOrders, rowKeyOf])

  const visibleExpandedRowKeys = useMemo(() => {
    const keys = Array.isArray(expandedRowKeys) ? expandedRowKeys.map(String) : []
    return keys.filter(k => expandableKeysSet.has(k))
  }, [expandedRowKeys, expandableKeysSet])

  const tableExpandable = useMemo(() => ({
    rowExpandable: (record) => Array.isArray(record?.children) && record.children.length > 0,
    expandedRowKeys: visibleExpandedRowKeys,
    onExpand: (expanded, record) => setExpandedForRecord(record, expanded),
    indentSize: 24,
    childrenColumnName: 'children',
    expandIcon: ({ expanded, onExpand, record }) => {
      const canExpand = Boolean(record?.__groupParent) && Array.isArray(record?.children) && record.children.length > 0
      if (!canExpand) return null
      const Icon = expanded ? MinusSquareOutlined : PlusSquareOutlined
      return (
        <span
          className="erp-order-expand-icon-large"
          onClick={(e) => onExpand(record, e)}
          style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <Icon />
        </span>
      )
    }
  }), [setExpandedForRecord, visibleExpandedRowKeys])

  useEffect(() => {
    let timer = null
    timer = setTimeout(() => {
      applySearch(searchParams)
    }, 300)
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [applySearch, searchParams])

  const handlePrintWorkOrder = useCallback(() => {
    if (!selectedRowKeys.length) {
      message.warning('请先勾选需要打印的订单')
      return
    }

    const getCustomerNameDisplay = (r) => {
      const customerId = r?.customerId || r?.customer?._id || r?.customer?.id
      const customerName = r?.customerName
      const customer = customers.find(c =>
        (customerId && (c._id === customerId || c.id === customerId)) ||
        (c.name === customerName || c.companyName === customerName)
      )
      return customer?.shortName || customerName || r?.shortName || '-'
    }

    const normalizeKey = (v) => String(v ?? '').trim()
    const keyOf = (r) => normalizeKey(rowKeyOf(r) || r?._id || r?.id || r?.key)

    const picked = []
    const pickedKeySet = new Set()
    const pushPicked = (r) => {
      if (!r || typeof r !== 'object') return
      const k = keyOf(r)
      if (!k || pickedKeySet.has(k)) return
      pickedKeySet.add(k)
      picked.push(r)
    }

    const groupByParentNo = new Map()
    ;(groupedOrders || []).forEach((r) => {
      if (!r?.__groupParent) return
      const parentNo = normalizeKey(r?.__parentNo || r?.orderNo || r?.orderNumber)
      if (!parentNo) return
      const children = Array.isArray(r?.children) ? r.children : []
      if (!children.length) return
      if (!groupByParentNo.has(parentNo)) {
        groupByParentNo.set(parentNo, { children, kind: normalizeKey(r?.__groupKind) })
      }
    })

    const pushOrderOrExpand = (r) => {
      if (!r || typeof r !== 'object') return
      if (r?.__itemChild) { pushPicked(r); return }
      if (r?.__groupParent && Array.isArray(r?.children) && r.children.length) {
        r.children.forEach((c) => pushOrderOrExpand(c))
        return
      }
      const orderNo = normalizeKey(r?.orderNo || r?.orderNumber)
      if (orderNo && /-\d+$/.test(orderNo)) { pushPicked(r); return }
      const group = orderNo ? groupByParentNo.get(orderNo) : undefined
      if (group && Array.isArray(group.children) && group.children.length) {
        group.children.forEach((c) => pushOrderOrExpand(c))
        return
      }
      pushPicked(r)
    }

    const orderById = new Map(
      (orders || [])
        .map((o) => [normalizeKey(o?._id || o?.id || o?.key), o])
        .filter(([k]) => Boolean(k))
    )

    const groupIndex = new Map()
    const itemChildIndex = new Map()
    ;(groupedOrders || []).forEach((r) => {
      if (!r?.__groupParent) return
      const groupKey = keyOf(r)
      if (!groupKey) return
      const children = Array.isArray(r?.children) ? r.children : []
      groupIndex.set(groupKey, { children, kind: normalizeKey(r?.__groupKind) })
      children.forEach((c) => {
        if (!c?.__itemChild) return
        const ck = keyOf(c)
        if (ck) itemChildIndex.set(ck, c)
      })
    })

    ;(selectedRowKeys || []).forEach((k) => {
      const s = normalizeKey(k)
      if (!s) return

      const groupMeta = groupIndex.get(s)
      if (groupMeta) {
        const hasItemChildren = groupMeta.children.some((c) => Boolean(c?.__itemChild))
        const isItemsGroup = groupMeta.kind === 'items' || hasItemChildren
        if (isItemsGroup) groupMeta.children.forEach((c) => pushPicked(c))
        else groupMeta.children.forEach((c) => pushOrderOrExpand(c))
        return
      }

      const itemChild = itemChildIndex.get(s)
      if (itemChild) { pushPicked(itemChild); return }

      const matched = orderById.get(s)
      if (matched) { pushOrderOrExpand(matched); return }

      const matchedByNo = (orders || []).find((o) => normalizeKey(o?.orderNo || o?.orderNumber) === s)
      if (matchedByNo) { pushOrderOrExpand(matchedByNo); return }
    })

    if (!picked.length) {
      message.warning('未找到选中的订单数据')
      return
    }

    const printRows = picked.map((r) => ({
      ...r,
      customerName: getCustomerNameDisplay(r)
    }))
    navigate('/production/workorder-print', { state: { printRows } })
  }, [selectedRowKeys, groupedOrders, message, customers, navigate])

  const loadSummary = useCallback(async () => {
    const reqId = ++loadSummaryReqIdRef.current
    const unwrapTotal = (res) => {
      const p = extractPaginationFromResponse(res) || {}
      const t = Number(p.total ?? NaN)
      return Number.isFinite(t) ? t : 0
    }
    try {
      const cacheBust = Date.now()
      const keyword = String(searchParams?.keyword || '').trim()
      const [start, end] = Array.isArray(searchParams?.dateRange) ? searchParams.dateRange : []
      const startIso = start ? dayjs(start).startOf('day').toISOString() : ''
      const endIso = end ? dayjs(end).endOf('day').toISOString() : ''

      const baseQuery = {
        page: 1,
        limit: 1,
        excludeOrderType: 'purchase',
        withTotal: true
      }
      if (keyword) baseQuery.keyword = keyword
      if (startIso && endIso) {
        baseQuery.startDate = startIso
        baseQuery.endDate = endIso
      }

      const monthQuery = (() => {
        if (startIso && endIso) return baseQuery
        return {
          ...baseQuery,
          startDate: dayjs().startOf('month').startOf('day').toISOString(),
          endDate: dayjs().endOf('month').endOf('day').toISOString()
        }
      })()

      const orderedStatuses = ['ordered', 'created', 'confirmed', '已下单']
      const pendingStatuses = ['pending', 'waiting', 'planned', 'to_produce', 'prepare', '待生产']
      const processingStatuses = ['processing', 'producing', 'in_progress', 'in_production', '生产中']
      const stockedStatuses = ['stocked', 'warehoused', 'warehouse', '已入库']

      const [monthRes, totalRes, orderedRes, pendingRes, processingRes, stockedRes] = await Promise.allSettled([
        orderAPI.getOrders({ ...monthQuery, _ts: cacheBust }),
        orderAPI.getOrders({ ...baseQuery, _ts: cacheBust }),
        orderAPI.getOrders({ ...baseQuery, status: orderedStatuses.join(','), _ts: cacheBust }),
        orderAPI.getOrders({ ...baseQuery, status: pendingStatuses.join(','), _ts: cacheBust }),
        orderAPI.getOrders({ ...baseQuery, status: processingStatuses.join(','), _ts: cacheBust }),
        orderAPI.getOrders({ ...baseQuery, status: stockedStatuses.join(','), _ts: cacheBust })
      ])

      if (reqId !== loadSummaryReqIdRef.current) return

      const monthCount = monthRes && monthRes.status === 'fulfilled' ? unwrapTotal(monthRes.value) : 0
      setMonthOrderCount(monthCount)

      const total = totalRes && totalRes.status === 'fulfilled' ? unwrapTotal(totalRes.value) : 0
      const ordered = orderedRes && orderedRes.status === 'fulfilled' ? unwrapTotal(orderedRes.value) : 0
      const pending = pendingRes && pendingRes.status === 'fulfilled' ? unwrapTotal(pendingRes.value) : 0
      const processing = (processingRes && processingRes.status === 'fulfilled' ? unwrapTotal(processingRes.value) : 0)
      const stocked = stockedRes && stockedRes.status === 'fulfilled' ? unwrapTotal(stockedRes.value) : 0

      setStats({ total, ordered, pending, processing, stocked })
    } catch (_) {
      if (reqId !== loadSummaryReqIdRef.current) return
      setStats({ total: 0, ordered: 0, pending: 0, processing: 0, stocked: 0 })
      setMonthOrderCount(0)
    }
  }, [searchParams])

  const normalizedStatusFilter = useMemo(() => {
    const raw = Array.isArray(statusFilter) ? statusFilter : (statusFilter ? [statusFilter] : [])
    return raw
      .map((v) => String(v ?? '').trim())
      .filter(Boolean)
      .filter((v, idx, arr) => arr.indexOf(v) === idx)
  }, [statusFilter])

  const expandedStatusFilter = useMemo(() => {
    return statusFilterUtils.expandStatusFilter(normalizedStatusFilter)
  }, [normalizedStatusFilter])

  const toggleStatusFilter = useCallback((statusKey) => {
    const key = String(statusKey || '').trim()
    if (!key) return
    setLoading(true)
    setStatusFilter((prev) => {
      const prevArr = Array.isArray(prev) ? prev.map((x) => String(x ?? '').trim()).filter(Boolean) : []
      const exists = prevArr.includes(key)
      if (exists) return []
      return [key]
    })
  }, [setStatusFilter])

  const loadOrders = useCallback(async (pageArg, pageSizeArg) => {
    const reqId = ++loadOrdersReqIdRef.current
    setLoading(true)
    try {
      const wantedPage = Math.max(1, Number(pageArg ?? listPageRef.current ?? 1))
      const wantedPageSize = Math.max(1, Number(pageSizeArg ?? listPageSizeRef.current ?? 100))

      const keyword = String(searchParams?.keyword || '').trim()
      const [start, end] = Array.isArray(searchParams?.dateRange) ? searchParams.dateRange : []
      const startIso = start ? dayjs(start).startOf('day').toISOString() : ''
      const endIso = end ? dayjs(end).endOf('day').toISOString() : ''

      const query = {
        page: wantedPage,
        limit: wantedPageSize,
        orderBy: 'createdAt_desc',
        excludeOrderType: 'purchase',
        withTotal: true
      }
      if (keyword) query.keyword = keyword
      if (startIso && endIso) {
        query.startDate = startIso
        query.endDate = endIso
      }
      if (expandedStatusFilter.length) {
        query.status = expandedStatusFilter.join(',')
      }

      const result = await cachedOrderAPI.getOrders(query)
      const pageData = extractListFromResponse(result)
      const pagination = extractPaginationFromResponse(result)

      const normalized = normalizeOrders(pageData, wantedPage)
      if (reqId !== loadOrdersReqIdRef.current) return
      setAllOrders(normalized)
      setListPage(wantedPage)
      setListPageSize(wantedPageSize)
      setListTotal(Number(pagination?.total || 0) || normalized.length)
    } catch (e) {
      if (reqId !== loadOrdersReqIdRef.current) return
      message.error('加载订单失败')
      setAllOrders([])
      setOrders([])
      setListTotal(0)
      setStats({ total: 0, ordered: 0, pending: 0, processing: 0, stocked: 0 })
      setMonthOrderCount(0)
    } finally {
      if (reqId === loadOrdersReqIdRef.current) {
        setLoading(false)
      }
    }
  }, [message, expandedStatusFilter, searchParams])

  const refreshOnce = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current)
    }
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null
      loadOrders(listPage, listPageSize)
      loadSummary()
    }, 200)
  }, [loadOrders, loadSummary, listPage, listPageSize])

  useEffect(() => {
    const onChanged = (ev) => {
      const ts = ev && ev.detail && ev.detail.ts ? Number(ev.detail.ts) : Date.now()
      if (!Number.isFinite(ts)) return
      refreshOnce()
    }

    const onStorage = (e) => {
      if (e && e.key === 'erp_orders_changed_at') {
        refreshOnce()
      }
    }

    window.addEventListener('erp:ordersChanged', onChanged)
    window.addEventListener('storage', onStorage)
    return () => {
      window.removeEventListener('erp:ordersChanged', onChanged)
      window.removeEventListener('storage', onStorage)
      if (refreshTimerRef.current) {
        clearTimeout(refreshTimerRef.current)
        refreshTimerRef.current = null
      }
    }
  }, [refreshOnce])

  useEffect(() => {
    setListPage(1)
    loadOrders(1, listPageSize)
    loadSummary()
  }, [searchParams, listPageSize, normalizedStatusFilter, loadOrders, loadSummary])

  const isStatusSelected = useCallback((statusKey) => {
    const key = String(statusKey || '').trim()
    if (!key) return false
    return normalizedStatusFilter.includes(key)
  }, [normalizedStatusFilter])

  const handleExport = () => {
    try {
      const getCustomerShortName = (order) => {
        const customerId = order.customerId || order.customer?._id || order.customer?.id
        const customerName = order.customerName
        const customer = customers.find(c =>
          (customerId && (c._id === customerId || c.id === customerId)) ||
          (c.name === customerName || c.companyName === customerName)
        )
        return customer?.shortName || customerName || ''
      }

      const getSupplierShortName = (order) => {
        const supplierId = order.supplierId || order.supplier?._id || order.supplier?.id
        const supplierName = order.supplierName
        const supplier = suppliers.find(s =>
          (supplierId && (s._id === supplierId || s.id === supplierId)) ||
          (s.name === supplierName || s.companyName === supplierName)
        )
        return supplier?.shortName || supplierName || ''
      }

      const getGoodsName = (order) => {
        return (
          order.goodsName ||
          order.productTitle ||
          (order.items && order.items[0] && (order.items[0].title || order.items[0].productName || order.items[0].goodsName)) ||
          ''
        )
      }

      const parseSpecDims = (order) => {
        const raw = String(order?.spec || '').trim()
        if (!raw) return { specL: '', specW: '', specH: '' }
        const cleaned = raw.replace(/mm/gi, '').trim()
        const parts = cleaned.split(/[×xX*]/).map(s => s.trim()).filter(Boolean)
        const nums = parts.map(p => Number(String(p).replace(/[^\d.]/g, ''))).filter(n => Number.isFinite(n))
        return {
          specL: nums[0] ?? '',
          specW: nums[1] ?? '',
          specH: nums[2] ?? ''
        }
      }

      const getMaterialNo = (order) => {
        return (
          order.materialNo ||
          (order.items && order.items[0] && (order.items[0].materialNo || order.items[0].material_no)) ||
          ''
        )
      }

      const header1 = [
        '客名（简称）',
        '产品类别',
        '商品名称',
        '物料号',
        '规格尺寸（mm）',
        '',
        '',
        '材质编码',
        '楞别',
        '纸板尺寸（mm）',
        '',
        '压线尺寸（mm）',
        '',
        '',
        '压线类型',
        '下单片数',
        '数量',
        '单位',
        '供应商（简称）',
        '拼接方式',
        '单价',
        '金额',
        '备注'
      ]
      const header2 = [
        '',
        '',
        '',
        '',
        '长',
        '宽',
        '高',
        '',
        '',
        '宽（门幅）',
        '长度',
        '压线1',
        '压线2',
        '压线3',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        ''
      ]

      const keyOf = (r) => r?._id || r?.id || r?.key
      const selectedSet = new Set((selectedRowKeys || []).map(String))
      const sourceOrders = selectedSet.size
        ? (orders || []).filter((r) => selectedSet.has(String(keyOf(r))))
        : (orders || [])
      const rows = sourceOrders.map(o => {
        const { specL, specW, specH } = parseSpecDims(o)
        const sheetCount = o.sheetCount ?? o.totalQty ?? ''
        const quantity = o.quantity ?? ''
        const unit = o.unit ?? ''
        const supplierShortName = getSupplierShortName(o)
        const joinMethod = o.joinMethod ?? ''
        const unitPrice = o.unitPrice ?? o.price ?? ''
        const amount = o.amount ?? o.totalAmount ?? ''
        return [
          getCustomerShortName(o),
          o.productName || '',
          getGoodsName(o),
          getMaterialNo(o),
          specL,
          specW,
          specH,
          o.materialCode || '',
          o.flute || '',
          o.boardWidth ?? '',
          o.boardHeight ?? '',
          o.creasingSize1 ?? '',
          o.creasingSize2 ?? '',
          o.creasingSize3 ?? '',
          o.creasingType || '',
          sheetCount,
          quantity,
          unit,
          supplierShortName,
          joinMethod,
          unitPrice,
          amount,
          o.notes || ''
        ]
      })

      const ws = XLSX.utils.aoa_to_sheet([header1, header2, ...rows])
      ws['!merges'] = [
        { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
        { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
        { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },
        { s: { r: 0, c: 3 }, e: { r: 1, c: 3 } },
        { s: { r: 0, c: 4 }, e: { r: 0, c: 6 } },
        { s: { r: 0, c: 7 }, e: { r: 1, c: 7 } },
        { s: { r: 0, c: 8 }, e: { r: 1, c: 8 } },
        { s: { r: 0, c: 9 }, e: { r: 0, c: 10 } },
        { s: { r: 0, c: 11 }, e: { r: 0, c: 13 } },
        { s: { r: 0, c: 14 }, e: { r: 1, c: 14 } },
        { s: { r: 0, c: 15 }, e: { r: 1, c: 15 } },
        { s: { r: 0, c: 16 }, e: { r: 1, c: 16 } },
        { s: { r: 0, c: 17 }, e: { r: 1, c: 17 } },
        { s: { r: 0, c: 18 }, e: { r: 1, c: 18 } },
        { s: { r: 0, c: 19 }, e: { r: 1, c: 19 } },
        { s: { r: 0, c: 20 }, e: { r: 1, c: 20 } },
        { s: { r: 0, c: 21 }, e: { r: 1, c: 21 } },
        { s: { r: 0, c: 22 }, e: { r: 1, c: 22 } }
      ]
      ws['!cols'] = [
        { wch: 14 },
        { wch: 12 },
        { wch: 18 },
        { wch: 12 },
        { wch: 8 },
        { wch: 8 },
        { wch: 8 },
        { wch: 10 },
        { wch: 8 },
        { wch: 10 },
        { wch: 10 },
        { wch: 8 },
        { wch: 8 },
        { wch: 8 },
        { wch: 10 },
        { wch: 10 },
        { wch: 10 },
        { wch: 8 },
        { wch: 14 },
        { wch: 10 },
        { wch: 10 },
        { wch: 12 },
        { wch: 16 }
      ]
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, "订单列表")

      XLSX.writeFile(wb, `订单导出_${dayjs().format('YYYYMMDDHHmm')}.xlsx`)
      message.success('导出成功')
      if ((selectedRowKeys || []).length) setSelectedRowKeys([])
    } catch (e) {
      console.error(e)
      message.error('导出失败')
    }
  }

  const normalizeHeaderKey = (k) => String(k || '').trim()

  const parseReadableNumber = (v) => {
    if (v === undefined || v === null) return NaN
    if (typeof v === 'number') return v
    const s = String(v).trim()
    if (!s) return NaN
    const cleaned = s.replace(/[,，\s]/g, '')
    const n = Number(cleaned)
    return Number.isFinite(n) ? n : NaN
  }

  const parseBoardSizeText = (v) => {
    const s = String(v || '').trim()
    if (!s) return {}
    const cleaned = s.replace(/mm$/i, '').trim()
    const parts = cleaned.split(/[×xX*]/).map(p => p.trim()).filter(Boolean)
    const w = parseReadableNumber(parts[0])
    const h = parseReadableNumber(parts[1])
    return {
      boardWidth: Number.isFinite(w) ? w : undefined,
      boardHeight: Number.isFinite(h) ? h : undefined
    }
  }

  const parseCreaseText = (v) => {
    const s = String(v || '').trim()
    if (!s) return {}
    const parts = s.split(/[-—–]/).map(p => p.trim()).filter(Boolean)
    const c1 = parseReadableNumber(parts[0])
    const c2 = parseReadableNumber(parts[1])
    const c3 = parseReadableNumber(parts[2])
    return {
      creasingSize1: Number.isFinite(c1) ? c1 : undefined,
      creasingSize2: Number.isFinite(c2) ? c2 : undefined,
      creasingSize3: Number.isFinite(c3) ? c3 : undefined
    }
  }

  const normalizeImportRow = (raw, idx) => {
    const normalized = {}
    Object.entries(raw || {}).forEach(([k, v]) => {
      const nk = normalizeHeaderKey(k)
      if (!nk) return
      normalized[nk] = v
    })

    const pick = (...keys) => {
      for (const k of keys) {
        const nk = normalizeHeaderKey(k)
        if (Object.prototype.hasOwnProperty.call(normalized, nk)) return normalized[nk]
      }
      return undefined
    }

    const customerText = String(pick('客名（简称）', '客户', '客户名称', '客名', '客名(简称)', '客名（简）') || '').trim()
    const productName = String(pick('产品类别', '产品', '产品名称') || '').trim()
    const goodsName = String(pick('商品名称', '品名', '商品', '产品标题') || '').trim()
    const materialNo = String(pick('物料号', '物料编号', '物料') || '').trim()
    const specRaw = String(pick('规格尺寸（mm）', '规格尺寸', '规格', '尺寸') || '').trim()
    const spec = specRaw ? (/(mm)$/i.test(specRaw) ? specRaw : `${specRaw}mm`) : ''
    const materialCode = String(pick('材质编码', '材质', '材质代码') || '').trim()
    const flute = String(pick('楞别', '楞型') || '').trim()
    const paperSize = pick('纸板尺寸（mm）', '纸板尺寸', '纸板', '纸板规格')
    const creaseSize = pick('压线尺寸（mm）', '压线尺寸', '压线')
    const creasingType = String(pick('压线类型', '压线方式') || '').trim()
    const supplierShortName = String(pick('供应商（简称）', '供应商简称', '供应商(简称)', '供应商（简）', '供应商简') || '').trim()
    const joinMethod = String(pick('拼接方式', '拼接') || '').trim()
    const notes = String(pick('备注', '说明') || '').trim()

    const sheetCountRaw = pick('下单片数', '片数', '下单片数(片)', '下单片数（片）')
    const sheetCountN = parseReadableNumber(sheetCountRaw)
    const sheetCount = Number.isFinite(sheetCountN) ? Math.round(sheetCountN) : NaN
    const quantityRaw = pick('数量', '下单数量')
    const quantityN = parseReadableNumber(quantityRaw)
    const quantity = Number.isFinite(quantityN) ? Math.round(quantityN) : NaN
    const unit = String(pick('单位') || '').trim() || undefined

    const unitPriceRaw = pick('单价', '含税单价', '价格')
    const amountRaw = pick('金额', '订单金额', '总金额', '合计')
    const unitPriceN = parseReadableNumber(unitPriceRaw)
    const amountN = parseReadableNumber(amountRaw)

    let unitPrice = Number.isFinite(unitPriceN) ? unitPriceN : NaN
    let amount = Number.isFinite(amountN) ? amountN : NaN
    if (!Number.isFinite(amount) && Number.isFinite(sheetCount) && Number.isFinite(unitPrice)) {
      amount = Number(sheetCount) * Number(unitPrice)
    }
    if (!Number.isFinite(amount) && Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
      amount = Number(quantity) * Number(unitPrice)
    }
    if (!Number.isFinite(unitPrice) && Number.isFinite(sheetCount) && Number.isFinite(amount) && Number(sheetCount) !== 0) {
      unitPrice = Number(amount) / Number(sheetCount)
    }
    if (!Number.isFinite(unitPrice) && Number.isFinite(quantity) && Number.isFinite(amount) && Number(quantity) !== 0) {
      unitPrice = Number(amount) / Number(quantity)
    }

    const customer = (customers || []).find(c => {
      const shortName = String(c?.shortName || '').trim()
      const name = String(c?.name || '').trim()
      const companyName = String(c?.companyName || '').trim()
      return (
        (shortName && shortName === customerText) ||
        (name && name === customerText) ||
        (companyName && companyName === customerText)
      )
    })

    const mappedCustomerId = customer ? (customer._id || customer.id) : undefined
    const customerId = mappedCustomerId || customerText || undefined
    const customerName = customer ? (customer.companyName || customer.name || customerText) : customerText

    const size = parseBoardSizeText(paperSize)
    const crease = parseCreaseText(creaseSize)

    const errors = []
    if (!customerText) errors.push('缺少客户')
    if (!productName) errors.push('缺少产品类别')
    if (!supplierShortName) errors.push('缺少供应商（简称）')
    if (joinMethod && !['打钉', '粘胶'].includes(joinMethod)) errors.push('拼接方式仅支持：打钉/粘胶')
    if ((!Number.isFinite(sheetCount) || sheetCount <= 0) && (!Number.isFinite(quantity) || quantity <= 0)) {
      errors.push('缺少下单片数/数量')
    }
    if (!Number.isFinite(amount) || amount <= 0) errors.push('缺少金额/单价')

    return {
      key: `import_${idx}`,
      rowIndex: idx + 2,
      customerText,
      customerId,
      customerName,
      productName,
      goodsName,
      materialNo,
      spec,
      materialCode,
      flute,
      ...size,
      creasingType,
      ...crease,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : (Number.isFinite(sheetCount) ? sheetCount : undefined),
      unit,
      supplierShortName,
      joinMethod: joinMethod || undefined,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : undefined,
      amount: Number.isFinite(amount) ? amount : undefined,
      sheetCount: Number.isFinite(sheetCount) ? sheetCount : undefined,
      notes,
      errors,
      status: errors.length ? 'invalid' : 'valid'
    }
  }

  const normalizeTemplateRow = (row, excelRowIndex) => {
    const getText = (i) => String(row?.[i] ?? '').trim()
    const getNum = (i) => {
      const n = parseReadableNumber(row?.[i])
      return Number.isFinite(n) ? n : undefined
    }

    const customerText = getText(0)
    const productName = getText(1)
    const goodsName = getText(2)
    const materialNo = getText(3)
    const specL = getNum(4)
    const specW = getNum(5)
    const specH = getNum(6)
    const materialCode = getText(7)
    const flute = getText(8)
    const boardWidth = getNum(9)
    const boardHeight = getNum(10)
    const creasingSize1 = getNum(11)
    const creasingSize2 = getNum(12)
    const creasingSize3 = getNum(13)
    const creasingType = getText(14)
    const sheetCountN = parseReadableNumber(row?.[15])
    const sheetCount = Number.isFinite(sheetCountN) ? Math.round(sheetCountN) : undefined
    const quantityN = parseReadableNumber(row?.[16])
    const quantity = Number.isFinite(quantityN) ? Math.round(quantityN) : undefined
    const unit = getText(17) || undefined
    const supplierShortName = getText(18)
    const joinMethod = getText(19)
    const unitPriceN = parseReadableNumber(row?.[20])
    const amountN = parseReadableNumber(row?.[21])
    const notes = getText(22)

    let amount = Number.isFinite(amountN) ? amountN : NaN
    let unitPrice = Number.isFinite(unitPriceN) ? unitPriceN : NaN
    if (!Number.isFinite(amount) && Number.isFinite(sheetCount) && Number.isFinite(unitPrice)) {
      amount = Number(sheetCount) * Number(unitPrice)
    }
    if (!Number.isFinite(amount) && Number.isFinite(quantity) && Number.isFinite(unitPrice)) {
      amount = Number(quantity) * Number(unitPrice)
    }
    if (!Number.isFinite(unitPrice) && Number.isFinite(sheetCount) && Number.isFinite(amount) && Number(sheetCount) !== 0) {
      unitPrice = Number(amount) / Number(sheetCount)
    }
    if (!Number.isFinite(unitPrice) && Number.isFinite(quantity) && Number.isFinite(amount) && Number(quantity) !== 0) {
      unitPrice = Number(amount) / Number(quantity)
    }

    const customer = (customers || []).find(c => {
      const shortName = String(c?.shortName || '').trim()
      const name = String(c?.name || '').trim()
      const companyName = String(c?.companyName || '').trim()
      return (
        (shortName && shortName === customerText) ||
        (name && name === customerText) ||
        (companyName && companyName === customerText)
      )
    })
    const mappedCustomerId = customer ? (customer._id || customer.id) : undefined
    const customerId = mappedCustomerId || customerText || undefined
    const customerName = customer ? (customer.companyName || customer.name || customerText) : customerText

    const specParts = [specL, specW, specH].filter(v => v !== undefined && v !== '')
    const spec = specParts.length ? `${specParts.join('×')}mm` : ''

    const errors = []
    if (!customerText) errors.push('缺少客户')
    if (!productName) errors.push('缺少产品类别')
    if (!Number.isFinite(sheetCount) || sheetCount <= 0) errors.push('缺少下单片数')
    if (!supplierShortName) errors.push('缺少供应商（简称）')
    if (joinMethod && !['打钉', '粘胶'].includes(joinMethod)) errors.push('拼接方式仅支持：打钉/粘胶')
    if (!Number.isFinite(amount) || amount <= 0) errors.push('缺少金额/单价')

    return {
      key: `import_${excelRowIndex}`,
      rowIndex: excelRowIndex,
      customerText,
      customerId,
      customerName,
      productName,
      goodsName,
      materialNo,
      spec,
      materialCode,
      flute,
      boardWidth,
      boardHeight,
      creasingType,
      creasingSize1,
      creasingSize2,
      creasingSize3,
      quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : sheetCount,
      unit,
      supplierShortName,
      joinMethod: joinMethod || undefined,
      unitPrice: Number.isFinite(unitPrice) ? unitPrice : undefined,
      amount: Number.isFinite(amount) ? amount : undefined,
      sheetCount,
      notes,
      errors,
      status: errors.length ? 'invalid' : 'valid'
    }
  }

  const readExcelAsRows = (file) => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(new Error('读取文件失败'))
      reader.onload = () => {
        try {
          const buf = reader.result
          const wb = XLSX.read(buf, { type: 'array' })
          const firstName = (wb.SheetNames || [])[0]
          if (!firstName) throw new Error('未找到工作表')
          const ws = wb.Sheets[firstName]
          const aoa = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' })
          const headerRowIdx = (aoa || []).findIndex((r) => {
            const a = String(r?.[0] ?? '').trim()
            const b = String(r?.[1] ?? '').trim()
            const c = String(r?.[2] ?? '').trim()
            return a.includes('客名') && b.includes('产品') && c.includes('商品')
          })
          const subHeaderRow = headerRowIdx >= 0 ? (aoa?.[headerRowIdx + 1] || []) : []
          const isTemplate =
            headerRowIdx >= 0 &&
            String(subHeaderRow?.[4] ?? '').trim() === '长' &&
            String(subHeaderRow?.[5] ?? '').trim() === '宽' &&
            String(subHeaderRow?.[6] ?? '').trim() === '高'
          if (isTemplate) {
            resolve({ sheetName: firstName, mode: 'template', headerRowIdx, rows: aoa })
            return
          }
          const rows = XLSX.utils.sheet_to_json(ws, { defval: '' })
          resolve({ sheetName: firstName, mode: 'json', rows })
        } catch (e) {
          reject(e)
        }
      }
      reader.readAsArrayBuffer(file)
    })
  }

  const handleImportFile = async (file) => {
    setImportParsing(true)
    setImportFileName(file?.name || '')
    try {
      const parsed = await readExcelAsRows(file)
      const mode = parsed?.mode || 'json'
      const normalized = (() => {
        if (mode === 'template') {
          const aoa = Array.isArray(parsed?.rows) ? parsed.rows : []
          const headerRowIdx = Number(parsed?.headerRowIdx ?? -1)
          const dataStart = headerRowIdx >= 0 ? headerRowIdx + 2 : 2
          return aoa
            .slice(dataStart)
            .map((r, idx) => ({ r, excelRow: dataStart + idx + 1 }))
            .filter(({ r }) => Array.isArray(r) && r.some(v => String(v ?? '').trim() !== ''))
            .map(({ r, excelRow }) => normalizeTemplateRow(r, excelRow))
            .filter(r => r.customerText || r.productName || Number.isFinite(r.quantity) || r.goodsName || r.spec)
        }
        const rows = Array.isArray(parsed?.rows) ? parsed.rows : []
        return rows
          .map((r, idx) => normalizeImportRow(r, idx))
          .filter(r => r.customerText || r.productName || Number.isFinite(r.quantity) || r.goodsName || r.spec)
      })()
      if (!normalized.length) {
        message.error('未识别到可导入的数据')
        setImportOpen(false)
        setImportRows([])
        return false
      }
      setImportRows(normalized)
      setImportOpen(true)
      return false
    } catch (e) {
      message.error(e?.message || '解析Excel失败')
      setImportOpen(false)
      setImportRows([])
      return false
    } finally {
      setImportParsing(false)
    }
  }

  const importPreviewColumns = useMemo(() => ([
    { title: '行', dataIndex: 'rowIndex', key: 'rowIndex', width: 70 },
    { title: '客户', dataIndex: 'customerName', key: 'customerName', width: 140, ellipsis: true },
    { title: '产品类别', dataIndex: 'productName', key: 'productName', width: 140, ellipsis: true },
    { title: '商品名称', dataIndex: 'goodsName', key: 'goodsName', width: 160, ellipsis: true },
    { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 90 },
    { title: '供应商（简称）', dataIndex: 'supplierShortName', key: 'supplierShortName', width: 140, ellipsis: true },
    { title: '拼接方式', dataIndex: 'joinMethod', key: 'joinMethod', width: 110 },
    {
      title: '单价',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: 100,
      render: (v) => (v === undefined || v === null || v === '') ? '' : Number(v).toFixed(4).replace(/\.?0+$/, '')
    },
    {
      title: '金额',
      dataIndex: 'amount',
      key: 'amount',
      width: 110,
      render: (v) => (v === undefined || v === null || v === '') ? '' : Number(v).toFixed(2).replace(/\.00$/, '')
    },
    {
      title: '结果',
      key: 'status',
      width: 120,
      render: (_, r) => {
        if (r.status === 'success') return <Tag color="green">已导入</Tag>
        if (r.status === 'failed') return <Tag color="red">失败</Tag>
        if (r.status === 'invalid') return <Tag color="red">不可导入</Tag>
        return <Tag color="blue">可导入</Tag>
      }
    },
    {
      title: '错误信息',
      key: 'errors',
      width: 240,
      render: (_, r) => {
        const msgs = Array.isArray(r.errors) ? r.errors : []
        const err = r.importError ? [r.importError, ...msgs] : msgs
        return err.length ? err.join('；') : ''
      }
    }
  ]), [importRows])

  const buildCreatePayload = (r) => {
    const baseURL = String(api?.defaults?.baseURL || '')
    const isCloudBridge = baseURL.includes('api-bridge')
    const supplierText = String(r.supplierShortName || '').trim()
    const supplier = supplierText ? (suppliers || []).find(s => {
      const shortName = String(s?.shortName || '').trim()
      const name = String(s?.name || '').trim()
      const companyName = String(s?.companyName || '').trim()
      return (
        (shortName && shortName === supplierText) ||
        (name && name === supplierText) ||
        (companyName && companyName === supplierText)
      )
    }) : undefined
    let payload = {
      customerName: r.customerName,
      supplierId: supplier ? (supplier._id || supplier.id) : undefined,
      supplierName: supplier ? (supplier.name || supplier.companyName || supplierText) : supplierText || undefined,
      productName: r.productName,
      productTitle: r.goodsName || undefined,
      goodsName: r.goodsName || undefined,
      quantity: r.quantity,
      unit: r.unit || '片',
      unitPrice: r.unitPrice,
      amount: r.amount,
      totalAmount: r.amount,
      createdAt: Date.now(),
      deliveryDate: null,
      priority: 'normal',
      boardWidth: r.boardWidth,
      boardHeight: r.boardHeight,
      creasingType: r.creasingType,
      creasingSize1: r.creasingSize1,
      creasingSize2: r.creasingSize2,
      creasingSize3: r.creasingSize3,
      spec: r.spec,
      flute: r.flute,
      materialCode: r.materialCode,
      materialNo: r.materialNo,
      sheetCount: r.sheetCount,
      joinMethod: r.joinMethod,
      notes: r.notes,
      orderType: 'production'
    }
    if (isCloudBridge) {
      payload = {
        ...payload,
        customerId: r.customerId || r.customerName || 'PC',
        items: [{
          name: r.productName,
          quantity: Number(r.quantity || 0),
          unit: r.unit || '片',
          unitPrice: Number(r.unitPrice || 0),
          spec: r.spec,
          materialCode: r.materialCode,
          materialNo: r.materialNo,
          flute: r.flute,
          boardWidth: r.boardWidth,
          boardHeight: r.boardHeight,
          creasingType: r.creasingType,
          creasingSize1: r.creasingSize1,
          creasingSize2: r.creasingSize2,
          creasingSize3: r.creasingSize3,
          sheetCount: r.sheetCount
        }]
      }
    }
    return payload
  }

  const ensureCustomerSkusLoaded = useCallback(async (rows) => {
    const normalizeText = (v) => String(v ?? '').trim()
    const normalizeKey = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, '')
    const normalizeId = (v) => {
      const s = normalizeText(v)
      if (!s) return ''
      const parts = s.split(/[\\/]/).filter(Boolean)
      return parts.length ? parts[parts.length - 1] : s
    }

    const resolveCustomerId = (row) => {
      if (!row || typeof row !== 'object') return ''
      const base = (row.__parent && typeof row.__parent === 'object') ? row.__parent : row
      let customerId = normalizeId(
        row.customerId || row.customer?._id || row.customer?.id ||
        base?.customerId || base?.customer?._id || base?.customer?.id
      )
      if (customerId) return customerId

      const customerName = normalizeText(
        row.customerName || row.customer?.name || row.customer?.companyName ||
        base?.customerName || base?.customer?.name || base?.customer?.companyName ||
        ''
      )
      if (!customerName) return ''
      const nameKey = normalizeKey(customerName)
      const matched =
        (customers || []).find((c) => {
          const fullName = normalizeText(c?.companyName || c?.name || c?.company || '')
          const shortName = normalizeText(c?.shortName || c?.short_name || '')
          return normalizeKey(fullName) === nameKey || (shortName && normalizeKey(shortName) === nameKey)
        }) ||
        (customers || []).find((c) => {
          const fullName = normalizeText(c?.companyName || c?.name || c?.company || '')
          const shortName = normalizeText(c?.shortName || c?.short_name || '')
          const fullKey = normalizeKey(fullName)
          const shortKey = shortName ? normalizeKey(shortName) : ''
          if (fullKey && (nameKey.includes(fullKey) || fullKey.includes(nameKey))) return true
          if (shortKey && (nameKey.includes(shortKey) || shortKey.includes(nameKey))) return true
          return false
        })
      customerId = normalizeId(matched?._id || matched?.id)
      return customerId
    }

    const ids = Array.from(new Set((rows || []).map(resolveCustomerId).filter(Boolean)))
    if (!ids.length) return

    const known = new Set(Object.keys(customerSkusByCustomerId || {}))

    const extractSkus = (resp) => {
      const body = resp?.data ?? resp
      if (Array.isArray(body?.data?.skus)) return body.data.skus
      if (Array.isArray(body?.data?.data?.skus)) return body.data.data.skus
      if (Array.isArray(body?.skus)) return body.skus
      if (Array.isArray(body?.data)) return body.data
      return []
    }
    const readTotalPages = (resp) => {
      const body = resp?.data ?? resp
      const pagination = body?.data?.pagination ?? body?.data?.data?.pagination ?? body?.pagination ?? null
      const n = Number(pagination?.totalPages || 0)
      return Number.isFinite(n) && n > 0 ? n : 0
    }

    for (const customerId of ids) {
      if (!customerId) continue
      if (known.has(customerId)) continue
      if (inflightCustomerSkuRef.current.has(customerId)) continue
      inflightCustomerSkuRef.current.add(customerId)
      try {
        const all = []
        const pageSize = 200
        const maxPages = 50
        for (let page = 1; page <= maxPages; page += 1) {
          const resp = await cachedCustomerSkuAPI.getCustomerSkus({ customerId, params: { page, pageSize, limit: pageSize } })
          const list = extractSkus(resp)
          if (list.length) all.push(...list)
          const totalPages = readTotalPages(resp)
          if (totalPages && page >= totalPages) break
          if (!list.length || list.length < pageSize) break
        }
        const normalized = (all || []).map((s) => {
          const sid = normalizeId(s?.id ?? s?._id)
          return { ...s, id: sid || undefined, _id: sid || s?._id }
        })
        setCustomerSkusByCustomerId((prev) => ({ ...(prev || {}), [customerId]: normalized }))
        known.add(customerId)
      } catch (_) {
        setCustomerSkusByCustomerId((prev) => ({ ...(prev || {}), [customerId]: [] }))
        known.add(customerId)
      } finally {
        inflightCustomerSkuRef.current.delete(customerId)
      }
    }
  }, [customers, customerSkusByCustomerId])
  ensureCustomerSkusLoadedRef.current = ensureCustomerSkusLoaded

  const openBoardPurchasePreview = async () => {
    const keyOf = (r) => String(rowKeyOf(r) || r?._id || r?.id || r?.key || '').trim()
    const picked = []
    const pickedKeySet = new Set()

    const normalizeText = (v) => String(v ?? '').trim()
    const normalizeKey = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, '')
    const normalizeSpecKey = (v) => normalizeKey(v).replace(/[x*]/g, '×').replace(/mm$/i, '')
    const normalizeId = (v) => {
      const s = normalizeText(v)
      if (!s) return ''
      const parts = s.split(/[\\/]/).filter(Boolean)
      return parts.length ? parts[parts.length - 1] : s
    }

    const enrichForBoardPurchase = (row) => {
      if (!row || typeof row !== 'object') return row
      if (row.__groupParent) return row

      const base = (row.__parent && typeof row.__parent === 'object') ? row.__parent : row
      let customerId = normalizeId(
        row.customerId || row.customer?._id || row.customer?.id ||
        base?.customerId || base?.customer?._id || base?.customer?.id
      )
      if (!customerId) {
        const customerName = normalizeText(
          row.customerName || row.customer?.name || row.customer?.companyName ||
          base?.customerName || base?.customer?.name || base?.customer?.companyName ||
          ''
        )
        if (customerName) {
          const nameKey = normalizeKey(customerName)
          const matched =
            (customers || []).find((c) => {
              const fullName = normalizeText(c?.companyName || c?.name || c?.company || '')
              const shortName = normalizeText(c?.shortName || c?.short_name || '')
              return normalizeKey(fullName) === nameKey || (shortName && normalizeKey(shortName) === nameKey)
            }) ||
            (customers || []).find((c) => {
            const fullName = normalizeText(c?.companyName || c?.name || c?.company || '')
            const shortName = normalizeText(c?.shortName || c?.short_name || '')
              const fullKey = normalizeKey(fullName)
              const shortKey = shortName ? normalizeKey(shortName) : ''
              if (fullKey && (nameKey.includes(fullKey) || fullKey.includes(nameKey))) return true
              if (shortKey && (nameKey.includes(shortKey) || shortKey.includes(nameKey))) return true
              return false
            })
          customerId = normalizeId(matched?._id || matched?.id)
        }
      }
      const skuId = normalizeId(row.skuId || row.sku_id || row.sku?._id || row.sku?.id || row.customerSkuId || row.customer_sku_id)
      const rawSpec = normalizeText(row.specification || row.spec || row.paperSize || row.paper_size || base?.specification || base?.spec || base?.paperSize || base?.paper_size || '')
      const materialCandidate = normalizeText(row.materialNo || row.material_no || row.materialCode || row.material_code || row.material || base?.materialNo || base?.material_no || base?.materialCode || base?.material_code || base?.material || '')
      const materialNoKey = normalizeKey(materialCandidate)
      const specKey = (() => {
        const nums = String(rawSpec || '').match(/\d+(?:\.\d+)?/g)
        if (nums && nums.length >= 2) return normalizeSpecKey(`${nums[0]}×${nums[1]}`)
        return normalizeSpecKey(rawSpec)
      })()
      const nameCandidate = normalizeText(row.goodsName || row.productName || row.name || row.productTitle || base?.goodsName || base?.productName || base?.name || base?.productTitle || '')
      const nameKey = normalizeKey(nameCandidate)
      const findSkuInIndex = (skuIndex) => {
        if (!skuIndex) return null
        if (skuId && skuIndex.has(`id:${normalizeKey(skuId)}`)) return skuIndex.get(`id:${normalizeKey(skuId)}`)
        if (materialNoKey && specKey && skuIndex.has(`ms:${materialNoKey}::${specKey}`)) return skuIndex.get(`ms:${materialNoKey}::${specKey}`)
        if (nameKey && specKey && skuIndex.has(`ns:${nameKey}::${specKey}`)) return skuIndex.get(`ns:${nameKey}::${specKey}`)
        if (materialNoKey && skuIndex.has(`m:${materialNoKey}`)) return skuIndex.get(`m:${materialNoKey}`)
        if (nameKey && skuIndex.has(`n:${nameKey}`)) return skuIndex.get(`n:${nameKey}`)
        return null
      }

      const primarySkuIndex = customerId ? customerSkuIndexByCustomerId.get(customerId) : null
      let sku = findSkuInIndex(primarySkuIndex)
      if (!sku && !customerId) {
        const matches = []
        for (const idx of customerSkuIndexByCustomerId.values()) {
          const hit = findSkuInIndex(idx)
          if (hit) matches.push(hit)
          if (matches.length > 1) break
        }
        if (matches.length === 1) sku = matches[0]
      }

      const pickVal = (v) => (v === undefined || v === null || v === '') ? undefined : v
      const pickText = (v) => {
        const s = normalizeText(v)
        return s ? s : undefined
      }
      const pickNum = (v) => {
        const n = Number(v)
        return Number.isFinite(n) && n !== 0 ? n : undefined
      }
      const specFromSku = normalizeText(sku?.specification ?? sku?.spec ?? '')
      const parsedSize = (() => {
        const src = specFromSku || rawSpec
        const nums = String(src || '').match(/\d+(?:\.\d+)?/g)
        if (nums && nums.length >= 2) {
          const a = Number(nums[0])
          const b = Number(nums[1])
          if (Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0) return { w: a, h: b }
        }
        return { w: undefined, h: undefined }
      })()

      const rawMaterialNo = pickText(
        row.materialNo ?? row.material_no ??
        base?.materialNo ?? base?.material_no ??
        sku?.materialNo ?? sku?.material_no ??
        undefined
      )
      const materialNoParts = rawMaterialNo
        ? String(rawMaterialNo).split(/[/／]/).map((s) => String(s || '').trim()).filter(Boolean)
        : []
      const parsedMaterialFromNo = materialNoParts.length >= 2 ? materialNoParts[0] : undefined
      const parsedFluteFromNo = materialNoParts.length >= 2 ? materialNoParts[1] : undefined

      const nextMaterialCode = pickText(
        row.materialCode ?? row.material_code ??
        base?.materialCode ?? base?.material_code ??
        sku?.materialCode ?? sku?.material_code ??
        sku?.material ??
        row.material ??
        base?.material ??
        parsedMaterialFromNo
      )
      const nextFlute = pickText(
        row.flute ?? row.fluteType ?? row.flute_type ?? row.flute_code ??
        base?.flute ?? base?.fluteType ?? base?.flute_type ?? base?.flute_code ??
        sku?.flute ?? sku?.flute_code ?? sku?.fluteType ??
        (Array.isArray(sku?.flutes) && sku.flutes.length ? sku.flutes[0] : undefined) ??
        (Array.isArray(sku?.fluteOptions) && sku.fluteOptions.length ? sku.fluteOptions[0] : undefined) ??
        (Array.isArray(sku?.flute_options) && sku.flute_options.length ? sku.flute_options[0] : undefined) ??
        (Array.isArray(sku?.fluteList) && sku.fluteList.length ? sku.fluteList[0] : undefined) ??
        (Array.isArray(sku?.flute_list) && sku.flute_list.length ? sku.flute_list[0] : undefined) ??
        parsedFluteFromNo
      )
      const nextBoardWidth = pickNum(row.boardWidth ?? row.board_width ?? base?.boardWidth ?? base?.board_width ?? sku?.boardWidth ?? sku?.board_width) ?? parsedSize.w
      const nextBoardHeight = pickNum(row.boardHeight ?? row.board_height ?? base?.boardHeight ?? base?.board_height ?? sku?.boardHeight ?? sku?.board_height) ?? parsedSize.h
      const nextSpec = pickText(row.specification ?? row.spec ?? base?.specification ?? base?.spec) ?? pickText(specFromSku)
      const nextSupplierName = pickText(row.supplierName ?? base?.supplierName ?? sku?.supplierName ?? sku?.supplier_name)
      const nextSupplierId = pickText(row.supplierId ?? base?.supplierId ?? sku?.supplierId ?? sku?.supplier_id)
      const curType = normalizeText(row.creasingType ?? row.creaseType ?? row.creasing_type ?? row.crease_type)
      const nextType = curType || normalizeText(sku?.creasingType ?? sku?.creaseType ?? sku?.creasing_type ?? sku?.crease_type) || undefined

      const s1 = pickVal(row.creasingSize1 ?? row.creaseSize1 ?? row.creasing_size1 ?? row.crease_size1)
      const s2 = pickVal(row.creasingSize2 ?? row.creaseSize2 ?? row.creasing_size2 ?? row.crease_size2)
      const s3 = pickVal(row.creasingSize3 ?? row.creaseSize3 ?? row.creasing_size3 ?? row.crease_size3)

      const nextS1 = (s1 !== undefined) ? s1 : pickVal(sku?.creasingSize1 ?? sku?.creasing_size1 ?? sku?.creaseSize1 ?? sku?.crease_size1)
      const nextS2 = (s2 !== undefined) ? s2 : pickVal(sku?.creasingSize2 ?? sku?.creasing_size2 ?? sku?.creaseSize2 ?? sku?.crease_size2)
      const nextS3 = (s3 !== undefined) ? s3 : pickVal(sku?.creasingSize3 ?? sku?.creasing_size3 ?? sku?.creaseSize3 ?? sku?.crease_size3)

      const hasAny =
        Boolean(nextMaterialCode || nextFlute || nextBoardWidth || nextBoardHeight || nextSpec || nextSupplierName || nextSupplierId) ||
        Boolean(nextType || nextS1 !== undefined || nextS2 !== undefined || nextS3 !== undefined)
      if (!hasAny) return row

      return {
        ...row,
        ...(nextSupplierId ? { supplierId: nextSupplierId } : {}),
        ...(nextSupplierName ? { supplierName: nextSupplierName } : {}),
        ...(nextMaterialCode ? { materialCode: nextMaterialCode } : {}),
        ...(rawMaterialNo ? { materialNo: rawMaterialNo } : {}),
        ...(nextFlute ? { flute: nextFlute } : {}),
        ...(nextSpec ? { spec: nextSpec, specification: nextSpec } : {}),
        ...(nextBoardWidth !== undefined ? { boardWidth: nextBoardWidth } : {}),
        ...(nextBoardHeight !== undefined ? { boardHeight: nextBoardHeight } : {}),
        creasingType: nextType,
        creasingSize1: nextS1,
        creasingSize2: nextS2,
        creasingSize3: nextS3
      }
    }

    const pushPicked = (r) => {
      if (!r || typeof r !== 'object') return
      const k = keyOf(r)
      if (!k || pickedKeySet.has(k)) return
      pickedKeySet.add(k)
      picked.push(r)
    }

    const groupByParentNo = new Map()
    ;(groupedOrders || []).forEach((r) => {
      if (!r?.__groupParent) return
      const parentNo = String(r?.__parentNo || r?.orderNo || r?.orderNumber || '').trim()
      if (!parentNo) return
      const children = Array.isArray(r?.children) ? r.children : []
      if (!children.length) return
      if (!groupByParentNo.has(parentNo)) {
        groupByParentNo.set(parentNo, { children, kind: String(r?.__groupKind || '').trim() })
      }
    })

    const pushOrderOrExpand = (r) => {
      if (!r || typeof r !== 'object') return
      if (r?.__itemChild) { pushPicked(r); return }
      if (r?.__groupParent && Array.isArray(r?.children) && r.children.length) {
        r.children.forEach((c) => pushPicked(c))
        return
      }
      const orderNo = String(r?.orderNo || r?.orderNumber || '').trim()
      if (orderNo && /-\d+$/.test(orderNo)) { pushPicked(r); return }
      const group = orderNo ? groupByParentNo.get(orderNo) : undefined
      if (group && Array.isArray(group.children) && group.children.length) {
        group.children.forEach((c) => pushPicked(c))
        return
      }
      pushPicked(r)
    }

    const orderById = new Map(
      (orders || [])
        .map((o) => [keyOf(o), o])
        .filter(([k]) => Boolean(k))
    )

    const groupIndex = new Map()
    const itemChildIndex = new Map()
    ;(groupedOrders || []).forEach((r) => {
      if (!r?.__groupParent) return
      const groupKey = String(rowKeyOf(r) || '').trim()
      if (!groupKey) return
      const children = Array.isArray(r?.children) ? r.children : []
      groupIndex.set(groupKey, { children, kind: String(r?.__groupKind || '').trim() })
      children.forEach((c) => {
        if (!c?.__itemChild) return
        const ck = String(rowKeyOf(c) || '').trim()
        if (ck) itemChildIndex.set(ck, c)
      })
    })

    ;(selectedRowKeys || []).forEach((k) => {
      const s = String(k || '').trim()
      if (!s) return

      const groupMeta = groupIndex.get(s)
      if (groupMeta) {
        const hasItemChildren = groupMeta.children.some((c) => Boolean(c?.__itemChild))
        const isItemsGroup = groupMeta.kind === 'items' || hasItemChildren

        if (isItemsGroup) groupMeta.children.forEach((c) => pushPicked(c))
        else groupMeta.children.forEach((c) => pushOrderOrExpand(c))
        return
      }

      const itemChild = itemChildIndex.get(s)
      if (itemChild) { pushPicked(itemChild); return }

      if (s.startsWith('item:')) {
        const orderNo = s.slice('item:'.length).trim()
        if (orderNo) {
          const matched = (orders || []).find(o => String(o?.orderNo || o?.orderNumber || '').trim() === orderNo)
          if (matched) pushOrderOrExpand(matched)
        }
        return
      }

      const matched = orderById.get(s)
      if (matched) { pushOrderOrExpand(matched); return }

      const matchedByNo = (orders || []).find((o) => String(o?.orderNo || o?.orderNumber || '').trim() === s)
      if (matchedByNo) pushOrderOrExpand(matchedByNo)
    })

    await ensureCustomerSkusLoaded(picked)
    const selected = picked.map(enrichForBoardPurchase)
    if (!selected.length) {
      message.warning('请先勾选订单')
      return
    }
    navigate('/purchase/boards/preview', { state: { rows: selected } })
    setSelectedRowKeys([])
  }

  useEffect(() => {
    loadOrders(1, listPageSize)
    loadMeta()
    loadSummary()
  }, [])

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('supplierHistory') || '[]')
      setSupplierHistory(Array.isArray(saved) ? saved : [])
    } catch (e) { void 0 }
  }, [])

  useEffect(() => {
    try {
      const id = sessionStorage.getItem('editOrderId')
      if (id) {
        sessionStorage.removeItem('editOrderId')
        navigate(`/orders/edit/${id}`)
      }
    } catch (e) { void 0 }
  }, [orders])

  const openCreateModal = () => {
    setEditingOrder(null)
    setModalOpen(true)
    setReservedId(undefined)
    form.resetFields()
    form.setFieldsValue({ creasingType: undefined, boardWidth: undefined, creasingSize1: undefined, creasingSize2: undefined, creasingSize3: undefined })
    const init = async () => {
      try {
        const res = await orderAPI.getNextOrderNumber()
        const payload = res?.data ?? res?.data?.data ?? res
        const no = payload?.orderNumber || payload?.orderNo
        const rid = payload?.reservationId
        if (no) {
          form.setFieldsValue({
            orderNo: no,
            deliveryDate: dayjs().add(3, 'day')
          })
          setReservedId(rid)
          return
        }
      } catch (e) { /* ignore */ }
      form.setFieldsValue({ orderNo: undefined, qrCodeUrl: undefined, deliveryDate: dayjs().add(3, 'day') })
      setReservedId(undefined)
    }
    init()
  }

  const openEditModal = (record) => {
    setEditingOrder(record)
    setModalOpen(true)
    setReservedId(undefined)
    const matchedSupplier = (suppliers || []).find(s => s.name === record.supplierName || s.companyName === record.supplierName)
    form.setFieldsValue({
      orderNo: record.orderNo || record.orderNumber,
      customerName: record.customerName,
      productName: record.productName,
      productTitle: record.productTitle,
      spec: record.spec,
      flute: record.flute,
      materialCode: record.materialCode,
      materialNo: record.materialNo,
      joinMethod: record.joinMethod,
      quantity: record.quantity,
      unitPrice: record.unitPrice,
      amount: record.amount,
      deposit: record.deposit,
      balance: Math.max(0, (record.amount || 0) - (record.deposit || 0)),
      priority: record.priority || 'normal',
      deliveryDate: record.deliveryDate ? (dayjs.isDayjs(record.deliveryDate) ? record.deliveryDate : dayjs(record.deliveryDate)) : null,
      notes: record.notes,
      supplierId: record.supplierId || matchedSupplier?._id || matchedSupplier?.id,
      supplierName: record.supplierName,
      qrCodeUrl: record.qrCodeUrl
    })
    const files = Array.isArray(record.attachments) ? record.attachments.map((a, i) => {
      if (typeof a === 'string') return { uid: String(i), name: a, url: a }
      return { uid: a.fileID || String(i), name: a.name || `附件${i + 1}`, url: a.url }
    }) : []
    form.setFieldsValue({ attachments: files })
    const specParts = String(record.spec || '')
      .replace(/mm/gi, '')
      .split(/[×xX*]/)
      .map(s => String(s || '').trim())
      .filter(Boolean)
      .map(s => {
        const v = s.replace(/[^\d.]/g, '')
        return v || undefined
      })
      .filter(v => v !== undefined)
    form.setFieldsValue({ spec1: specParts[0], spec2: specParts[1], spec3: specParts[2] })
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      const compressImageFile = (file) => new Promise((resolve) => {
        try {
          if (!file.originFileObj || file.url) return resolve(file)
          const reader = new FileReader()
          reader.onload = (ev) => {
            const img = new Image()
            img.onload = () => {
              const maxW = 1200
              const scale = Math.min(1, maxW / img.width)
              const w = Math.round(img.width * scale)
              const h = Math.round(img.height * scale)
              const canvas = document.createElement('canvas')
              canvas.width = w
              canvas.height = h
              const ctx = canvas.getContext('2d')
              ctx.drawImage(img, 0, 0, w, h)
              try {
                file.url = canvas.toDataURL('image/jpeg', 0.7)
              } catch (e) {
                file.url = ev.target.result
              }
              resolve(file)
            }
            img.src = ev.target.result
          }
          reader.readAsDataURL(file.originFileObj)
        } catch (e) {
          resolve(file)
        }
      })
      const ensureAttachmentUrls = async (files = []) => {
        const pending = (files || []).filter(f => f.originFileObj && !f.url)
        if (!pending.length) return files
        await Promise.all(pending.map(compressImageFile))
        form.setFieldsValue({ attachments: [...files] })
        return files
      }
      await ensureAttachmentUrls(values.attachments || [])
      const storeCustomerName = form.getFieldValue('customerName')
      const safeCustomerName = String(values.customerName || storeCustomerName || '').trim()
      const selectedCustomer = (customers || []).find(c => (c._id || c.id) === values.customerId)
      const selectedSupplier = (suppliers || []).find(s => (s._id || s.id) === values.supplierId)
      const safeAttachments = (values.attachments || [])
        .map(f => {
          const name = f.name || '附件'
          const url = f.url || (f.response && f.response.url) || undefined
          return url ? { name, url } : name
        })
      const normalizeText = (v) => String(v ?? '').trim()
      const normalizeKey = (v) => normalizeText(v).toLowerCase()
      const normalizeSpecKey = (v) => normalizeKey(v).replace(/[x*]/g, '×').replace(/mm$/i, '')
      const normalizeId = (v) => {
        const s = normalizeText(v)
        if (!s) return ''
        const parts = s.split(/[\\/]/).filter(Boolean)
        return parts.length ? parts[parts.length - 1] : s
      }
      const preferValue = (current, fallback) => (current === undefined || current === null || current === '') ? fallback : current
      const skuFromIndex = (() => {
        const customerId = normalizeId(values.customerId || selectedCustomer?._id || selectedCustomer?.id)
        if (!customerId) return null
        const skuIndex = customerSkuIndexByCustomerId.get(customerId)
        if (!skuIndex) return null
        const skuId = normalizeId(values.skuId || values.customerSkuId)
        const materialNoKey = normalizeKey(values.materialNo)
        const specKey = normalizeSpecKey(values.spec)
        const nameKey = normalizeKey(values.productTitle || values.productName)
        if (skuId && skuIndex.has(`id:${normalizeKey(skuId)}`)) return skuIndex.get(`id:${normalizeKey(skuId)}`)
        if (materialNoKey && specKey && skuIndex.has(`ms:${materialNoKey}::${specKey}`)) return skuIndex.get(`ms:${materialNoKey}::${specKey}`)
        if (materialNoKey && skuIndex.has(`m:${materialNoKey}`)) return skuIndex.get(`m:${materialNoKey}`)
        if (nameKey && specKey && skuIndex.has(`ns:${nameKey}::${specKey}`)) return skuIndex.get(`ns:${nameKey}::${specKey}`)
        if (nameKey && skuIndex.has(`n:${nameKey}`)) return skuIndex.get(`n:${nameKey}`)
        return null
      })()
      const payload = {
        orderNo: values.orderNo,
        customerId: values.customerId || (safeCustomerName ? `name::${safeCustomerName}` : undefined),
        customerName: safeCustomerName || selectedCustomer?.companyName || selectedCustomer?.name,
        productName: values.productName,
        productTitle: values.productTitle,
        supplierId: values.supplierId,
        supplierName: values.supplierName || selectedSupplier?.name,
        quantity: values.quantity,
        unitPrice: values.unitPrice,
        amount: values.amount ?? Math.max(0, Number(values.unitPrice || 0) * Number(values.quantity || 0)),
        deposit: values.deposit || 0,
        balance: (values.amount ?? Math.max(0, Number(values.unitPrice || 0) * Number(values.quantity || 0))) - Number(values.deposit || 0),
        items: [{ name: values.productName, quantity: Number(values.quantity || 0), unitPrice: Number(values.unitPrice || 0), spec: values.spec }],
        totalAmount: values.amount ?? Math.max(0, Number(values.unitPrice || 0) * Number(values.quantity || 0)),
        createdAt: Date.now(),
        deliveryDate: values.deliveryDate ? (values.deliveryDate.format ? values.deliveryDate.format('YYYY-MM-DD') : values.deliveryDate) : null,
        priority: values.priority || 'normal',
        boardWidth: values.boardWidth,
        boardHeight: values.boardHeight,
        creasingType: preferValue(values.creasingType, normalizeText(skuFromIndex?.creasingType ?? skuFromIndex?.creaseType ?? skuFromIndex?.creasing_type ?? skuFromIndex?.crease_type) || undefined),
        creasingSize1: preferValue(values.creasingSize1, skuFromIndex?.creasingSize1 ?? skuFromIndex?.creaseSize1 ?? skuFromIndex?.creasing_size1 ?? skuFromIndex?.crease_size1),
        creasingSize2: preferValue(values.creasingSize2, skuFromIndex?.creasingSize2 ?? skuFromIndex?.creaseSize2 ?? skuFromIndex?.creasing_size2 ?? skuFromIndex?.crease_size2),
        creasingSize3: preferValue(values.creasingSize3, skuFromIndex?.creasingSize3 ?? skuFromIndex?.creaseSize3 ?? skuFromIndex?.creasing_size3 ?? skuFromIndex?.crease_size3),
        spec: values.spec,
        flute: values.flute,
        materialCode: preferValue(values.materialCode, normalizeText(skuFromIndex?.materialCode ?? skuFromIndex?.material_code) || undefined),
        materialNo: preferValue(values.materialNo, normalizeText(skuFromIndex?.materialNo ?? skuFromIndex?.material_no) || undefined),
        joinMethod: preferValue(values.joinMethod, normalizeText(skuFromIndex?.joinMethod ?? skuFromIndex?.join_method) || undefined),
        notes: values.notes,
        attachments: safeAttachments,
        qrCodeUrl: values.qrCodeUrl,
        orderType: 'production'
      }
      if (editingOrder && (editingOrder._id || editingOrder.id || editingOrder.key)) {
        const id = editingOrder._id || editingOrder.id || editingOrder.key
        await cachedOrderAPI.updateOrder(id, payload)
        message.success('订单已更新')
      } else {
        const orderType = String(payload?.orderType || '').toLowerCase()
        const source = String(payload?.source || '').toLowerCase()
        const purchaseCategory = String(payload?.purchaseCategory || payload?.category || '').toLowerCase()
        const supplierName = String(payload?.supplierName || '').trim()
        const isPurchase =
          orderType === 'purchase' ||
          source === 'purchased' ||
          Boolean(supplierName) ||
          Boolean(purchaseCategory)
        const res = await cachedOrderAPI.createOrder({ ...payload, status: 'ordered', reservationId: reservedId })
        const orderNo = res?.data?.order?.orderNo || res?.data?.orderNo || res?.data?.orderNumber
        message.success(orderNo ? `订单已创建（编号：${orderNo}）` : '订单已创建')
        if (orderNo) {
          orderAPI.confirmOrderNumber(orderNo).catch(() => { })
        }
        setReservedId(undefined)
        try {
          const name = payload.supplierName
          if (name) {
            const next = Array.from(new Set([name, ...supplierHistory])).slice(0, 20)
            setSupplierHistory(next)
            localStorage.setItem('supplierHistory', JSON.stringify(next))
          }
        } catch (e) { void 0 }
        try {
          const memKey = (payload.spec && String(payload.spec).trim()) || [String(payload.boardWidth || ''), String(payload.boardHeight || '')].filter(Boolean).join('×')
          const raw = localStorage.getItem('orderCreateMemory') || '{}'
          const obj = JSON.parse(raw)
          obj[memKey] = {
            flute: payload.flute,
            creasingType: payload.creasingType,
            joinMethod: payload.joinMethod,
            unitPrice: payload.unitPrice,
            productTitle: payload.productTitle
          }
          localStorage.setItem('orderCreateMemory', JSON.stringify(obj))
        } catch (e) { void 0 }
      }
      setModalOpen(false)
      setEditingOrder(null)
      form.resetFields()
      setListPage(1)
      loadOrders(1, listPageSize)
      loadSummary()
    } catch (error) {
      if (!editingOrder) {
        try {
          const ono = form.getFieldValue('orderNo')
          if (reservedId || ono) {
            await orderAPI.releaseOrderNumber({ reservationId: reservedId, orderNumber: ono })
          }
        } catch (e) { void 0 }
        setReservedId(undefined)
      }
      const msg = error?.response?.data?.message || error?.message || '提交失败'
      message.error(msg)
    }
  }

  const handleDelete = async (record) => {
    const id = record?._id || record?.id || record?.key
    if (!id) {
      message.error('缺少订单ID，无法删除')
      return
    }
    const idStr = String(id)
    try {
      const res = await cachedOrderAPI.deleteOrder(idStr)
      if (res?.data?.success === false) {
        throw new Error(res?.data?.message || '删除失败')
      }
      message.success(res?.data?.message || '订单已删除')
      setSelectedRowKeys((prev) => (prev || []).filter((k) => String(k) !== idStr))
      loadOrders(listPage, listPageSize)
      loadSummary()
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || '删除失败'
      message.error(msg)
    }
  }



  const normalizeUpload = (e) => {
    const fileList = Array.isArray(e) ? e : e && e.fileList
    if (!fileList) return []
    return fileList.map(f => {
      if (f.url) return f
      if (f.originFileObj && !f.thumbUrl) {
        const reader = new FileReader()
        reader.onload = (ev) => {
          const img = new Image()
          img.onload = () => {
            const maxW = 1200
            const scale = Math.min(1, maxW / img.width)
            const w = Math.round(img.width * scale)
            const h = Math.round(img.height * scale)
            const canvas = document.createElement('canvas')
            canvas.width = w
            canvas.height = h
            const ctx = canvas.getContext('2d')
            ctx.drawImage(img, 0, 0, w, h)
            try {
              f.url = canvas.toDataURL('image/jpeg', 0.7)
            } catch (e) {
              f.url = ev.target.result
            }
            form.setFieldsValue({ attachments: [...(form.getFieldValue('attachments') || [])] })
          }
          img.src = ev.target.result
        }
        reader.readAsDataURL(f.originFileObj)
      }
      return f
    })
  }

  const loadMeta = async () => {
    try {
      const cusRes = await cachedCustomerAPI.getCustomers({ page: 1, limit: 100 })
      const normalizeCustomers = (res) => {
        if (Array.isArray(res)) return res
        if (Array.isArray(res?.data)) return res.data
        if (Array.isArray(res?.data?.customers)) return res.data.customers
        return []
      }
      setCustomers(normalizeCustomers(cusRes))
    } catch (e) {
      setCustomers([])
    }
    try {
      const supRes = await supplierAPI.getSuppliers({ page: 1, limit: 1000 })
      const normalizeSuppliers = (res) => {
        if (Array.isArray(res)) return res
        if (Array.isArray(res?.data)) return res.data
        if (Array.isArray(res?.suppliers)) return res.suppliers
        if (Array.isArray(res?.data?.suppliers)) return res.data.suppliers
        return []
      }
      setSuppliers(normalizeSuppliers(supRes))
    } catch (e) {
      setSuppliers([])
    }
  }

  const onCategorySelect = async (value) => {
    if (value === '__NEW__') {
      setCreatingCategory(true)
      return
    }
    form.setFieldsValue({ productName: value })
  }

  const onSupplierSelect = async (value, option) => {
    if (value === '__NEW__') {
      setCreatingSupplier(true)
      return
    }
    if (String(value).startsWith('name::')) {
      const name = option?.label
      form.setFieldsValue({ supplierId: undefined, supplierName: name })
      return
    }
    const sup = suppliers.find(s => (s._id || s.id) === value)
    form.setFieldsValue({ supplierId: value, supplierName: sup?.name || '' })
  }

  const onFluteSelect = (value) => {
    if (value === '__NEW_FLUTE__') {
      setCreatingFlute(true)
      return
    }
    form.setFieldsValue({ flute: value })
  }

  const handleCreateCategory = async () => {
    const name = form.getFieldValue('newCategoryName')
    if (!name) return
    try {
      await categoryAPI.createCategory({ name })
      setCategories(prev => Array.from(new Set([...(prev || []), name])))
      form.setFieldsValue({ productName: name, newCategoryName: undefined })
      setCreatingCategory(false)
    } catch (e) {
      setCreatingCategory(false)
    }
  }

  const handleCreateSupplier = async () => {
    const name = form.getFieldValue('newSupplierName')
    if (!name) return
    try {
      const res = await supplierAPI.createSupplier({ name })
      const created = res?.data
      setSuppliers(prev => [created, ...(prev || [])])
      form.setFieldsValue({ supplierId: created?._id || created?.id, supplierName: created?.name, newSupplierName: undefined })
      setCreatingSupplier(false)
    } catch (e) {
      setCreatingSupplier(false)
    }
  }

  const handleBatchShipping = () => {
    const selectedSet = new Set((selectedRowKeys || []).map(String).filter(Boolean))
    const selected = (orders || []).filter((o) => {
      const k = String(o?._id || o?.id || o?.key || '').trim()
      return k && selectedSet.has(k)
    })

    if (selected.length === 0) {
      message.warning('请先勾选要发货的订单')
      return
    }

    const toNumber = (v, fallback = 0) => {
      const n = Number(v)
      return Number.isFinite(n) ? n : fallback
    }

    const withRemain = []
    selected.forEach((order) => {
      const totalStocked = toNumber(order.stockedQty || order.quantity, 0)
      const shippedAlready = (() => {
        if (Array.isArray(order.shipments) && order.shipments.length) {
          const sum = order.shipments.reduce((s, it) => {
            const v = toNumber(it?.qty ?? it?.quantity ?? it?.shipQty, 0)
            if (v <= 0) return s
            return s + v
          }, 0)
          if (sum > 0) return sum
        }
        return toNumber(order.shippedQty ?? order.deliveredQty, 0)
      })()
      const remain = Math.max(0, totalStocked - shippedAlready)
      if (remain > 0) {
        withRemain.push({ ...order, _shipRemain: remain })
      }
    })

    if (!withRemain.length) {
      message.warning('选中的订单暂无可发数量')
      return
    }

    if (withRemain.length !== selected.length) {
      message.info(`已过滤 ${selected.length - withRemain.length} 个无可发数量的订单`)
    }

    // 初始化发货数量为可发数量
    const initialValues = {}
    withRemain.forEach(order => {
      const key = order._id || order.id || order.key
      initialValues[`quantity_${key}`] = Number(order._shipRemain || 0)
    })

    shippingForm.setFieldsValue(initialValues)
    setShippingOrders(withRemain)
    setBatchShippingOpen(true)
  }

  const handleConfirmShipping = async () => {
    try {
      const values = await shippingForm.validateFields()

      const toNumber = (v, fallback = 0) => {
        const n = Number(v)
        return Number.isFinite(n) ? n : fallback
      }

      const nowIso = new Date().toISOString()

      const updates = shippingOrders.map(order => {
        const id = order._id || order.id || order.key
        const key = id
        const inputQty = toNumber(values[`quantity_${key}`], 0)
        const totalStocked = toNumber(order.stockedQty || order.quantity, 0)
        const prevShipments = Array.isArray(order.shipments) ? order.shipments : []
        const shippedAlready = (() => {
          if (prevShipments.length) {
            const sum = prevShipments.reduce((s, it) => {
              const v = toNumber(it?.qty ?? it?.quantity ?? it?.shipQty, 0)
              if (v <= 0) return s
              return s + v
            }, 0)
            if (sum > 0) return sum
          }
          return toNumber(order.shippedQty ?? order.deliveredQty, 0)
        })()
        const remain = Math.max(0, totalStocked - shippedAlready)
        if (inputQty <= 0) {
          throw new Error(`订单 ${order.orderNo || ''} 发货数量必须大于0`)
        }
        if (inputQty > remain) {
          throw new Error(`订单 ${order.orderNo || ''} 发货数量不能大于可发数量（${remain}）`)
        }
        const shippedQty = shippedAlready + inputQty
        const shipments = prevShipments.concat([{ qty: inputQty, time: nowIso }])
        const payload = {
          shippedQty,
          shippedAt: nowIso,
          status: 'shipping',
          shipments
        }
        return { id, payload, shippedQty }
      })

      await Promise.all(updates.map(u => cachedOrderAPI.updateOrder(u.id, u.payload)))

      message.success('已记录发货')
      loadOrders(listPage, listPageSize)
      loadSummary()

      // 关闭对话框并清空选择
      setBatchShippingOpen(false)
      setShippingOrders([])
      setSelectedRowKeys([])
      shippingForm.resetFields()
      navigate('/shipping')

    } catch (error) {
      if (error.errorFields) {
        message.error('请检查发货数量输入')
      } else {
        message.error(error.message || '操作失败')
      }
    }
  }

  return (
    <ConfigProvider locale={zhCN}>
      <div>
        <h2 className="page-title">订单管理</h2>

        <Row gutter={[16, 16]} justify="center" style={{ marginBottom: 16 }}>
          <Col xs={24} sm={12} md={8} lg={4}>
            <Card className="stats-card" style={{ width: 160, height: 160, background: '#7F7FD5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
              <div className="stats-value">{monthOrderCount}</div>
              <div className="stats-label">{(searchParams?.dateRange || []).length ? '筛选区间订单' : '本月订单'}</div>
            </Card>
          </Col>
          <Col xs={24} sm={12} md={8} lg={4}>
            <Card
              className="stats-card"
              onClick={() => toggleStatusFilter('ordered')}
              style={{
                width: 160,
                height: 160,
                background: '#ffb74d',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                cursor: 'pointer',
                border: isStatusSelected('ordered') ? '2px solid #1677ff' : '2px solid transparent',
                boxShadow: isStatusSelected('ordered') ? '0 0 0 2px rgba(22,119,255,0.35)' : undefined,
                transition: 'box-shadow 120ms ease, border-color 120ms ease'
              }}
            >
              <div className="stats-value">{stats.ordered}</div>
              <div className="stats-label">已下单</div>
            </Card>
          </Col>
          <Col xs={24} sm={12} md={8} lg={4}>
            <Card
              className="stats-card"
              onClick={() => toggleStatusFilter('pending')}
              style={{
                width: 160,
                height: 160,
                background: '#ff8a65',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                cursor: 'pointer',
                border: isStatusSelected('pending') ? '2px solid #1677ff' : '2px solid transparent',
                boxShadow: isStatusSelected('pending') ? '0 0 0 2px rgba(22,119,255,0.35)' : undefined,
                transition: 'box-shadow 120ms ease, border-color 120ms ease'
              }}
            >
              <div className="stats-value">{stats.pending}</div>
              <div className="stats-label">待生产</div>
            </Card>
          </Col>
          <Col xs={24} sm={12} md={8} lg={4}>
            <Card
              className="stats-card"
              onClick={() => toggleStatusFilter('processing')}
              style={{
                width: 160,
                height: 160,
                background: '#42a5f5',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                cursor: 'pointer',
                border: isStatusSelected('processing') ? '2px solid #1677ff' : '2px solid transparent',
                boxShadow: isStatusSelected('processing') ? '0 0 0 2px rgba(22,119,255,0.35)' : undefined,
                transition: 'box-shadow 120ms ease, border-color 120ms ease'
              }}
            >
              <div className="stats-value">{stats.processing}</div>
              <div className="stats-label">生产中</div>
            </Card>
          </Col>
          <Col xs={24} sm={12} md={8} lg={4}>
            <Card
              className="stats-card"
              onClick={() => toggleStatusFilter('stocked')}
              style={{
                width: 160,
                height: 160,
                background: '#4caf50',
                color: '#fff',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexDirection: 'column',
                cursor: 'pointer',
                border: isStatusSelected('stocked') ? '2px solid #1677ff' : '2px solid transparent',
                boxShadow: isStatusSelected('stocked') ? '0 0 0 2px rgba(22,119,255,0.35)' : undefined,
                transition: 'box-shadow 120ms ease, border-color 120ms ease'
              }}
            >
              <div className="stats-value">{stats.stocked}</div>
              <div className="stats-label">已入库</div>
            </Card>
          </Col>
        </Row>

        <Card style={{ marginBottom: 24 }}>
          <Space wrap size={20} style={{ marginBottom: 28 }}>
            <Input
              placeholder="搜索客户名/订单号/商品名称/物料号/规格/纸板尺寸"
              value={searchParams.keyword}
              onChange={(e) => {
                const v = e.target.value
                const next = { ...searchParams, keyword: v }
                setSearchParams(next)
                if (!v) {
                  applySearch({ ...next, keyword: '' })
                }
              }}
              style={{ width: 200 }}
              allowClear
            />
            {(selectedRowKeys || []).length ? (
              <Tag color="blue">已选 {(selectedRowKeys || []).length} 条</Tag>
            ) : null}
            {(selectedRowKeys || []).length ? (
              <Button onClick={() => setSelectedRowKeys([])}>
                清空勾选
              </Button>
            ) : null}
            <RangePicker
              value={searchParams.dateRange && searchParams.dateRange.length ? searchParams.dateRange : null}
              allowClear
              onChange={(dates) => setSearchParams({ ...searchParams, dateRange: dates || [] })}
            />
            <Button
              type="primary"
              icon={<PlusOutlined />}
              onClick={() => navigate('/orders/create')}
            >
              新建订单
            </Button>
            <Button onClick={openBoardPurchasePreview}>
              生成采购单
            </Button>
            <Button
              icon={<DownloadOutlined />}
              onClick={handleExport}
            >
              订单导出
            </Button>
            <Button
              onClick={handlePrintWorkOrder}
              disabled={!selectedRowKeys.length}
            >
              打印施工单
            </Button>
            <Button
              onClick={() => navigate('/orders/stats')}
            >
              订单统计
            </Button>
            <Button
              icon={<ReloadOutlined />}
              onClick={() => {
                try { invalidateCache('orders') } catch (_) { void 0 }
                try { orderAPI.clearCache() } catch (_) { void 0 }
                refreshOnce()
              }}
            >
              刷新数据
            </Button>
          </Space>
        </Card>



        <div>
          <Table
            columns={columns}
            dataSource={groupedOrders}
            loading={loading}
            pagination={false}
            locale={{ emptyText: normalizedStatusFilter.length ? '当前状态暂无订单' : '暂无订单' }}
            rowKey={(record) => rowKeyOf(record)}
            rowSelection={selectionMode ? rowSelectionConfig : undefined}
            expandable={tableExpandable}
            rowClassName={(record) => {
              if (record?.__groupParent) return 'erp-order-multi-sku-parent'
              const orderNo = String(record?.orderNo || record?.orderNumber || '').trim()
              if (!record?.__groupParent && /-\d+$/.test(orderNo)) return 'erp-order-multi-sku-child'
              return ''
            }}
            onRow={(record) => {
              const canExpand = Boolean(record?.__groupParent) && Array.isArray(record?.children) && record.children.length > 0
              const orderNo = String(record?.orderNo || '').trim()
              
              return {
                style: { 
                  cursor: 'pointer'
                },
                onClick: (ev) => {
                  const target = ev?.target
                  if (target && typeof target.closest === 'function') {
                    const hit = target.closest('a,button,input,textarea,select,.ant-checkbox-wrapper,.ant-checkbox,.ant-btn')
                    if (hit) return
                  }
                  
                  if (canExpand) {
                    toggleExpand(record)
                  } else {
                    const items = Array.isArray(record?.items) ? record.items : []
                    const isSingleSkuOrder = items.length <= 1
                    if (isSingleSkuOrder) {
                      const token = String(record?.orderNo || record?.orderNumber || record?._id || record?.id || rowKeyOf(record) || '').trim()
                      if (token) {
                        navigate(`/orders/${encodeURIComponent(token)}`, { state: { baseOrder: record } })
                      }
                      return
                    }

                    void openOrderDetail(record)
                  }
                }
              }
            }}
            size="small"
            tableLayout="fixed"
            scroll={{ x: 'max-content' }}
            sticky={{ offsetHeader: 0, getContainer: getStickyContainer }}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <Pagination
              current={listPage}
              pageSize={listPageSize}
              total={listTotal}
              showSizeChanger={false}
              showTotal={(total) => `共 ${total} 条`}
              onChange={(page, pageSize) => {
                const nextPage = Number(page || 1)
                const nextPageSize = Number(pageSize || listPageSize)
                setListPage(nextPage)
                setListPageSize(nextPageSize)
                loadOrders(nextPage, nextPageSize)
              }}
            />
          </div>
        </div>

        <Modal
          title={`订单导入预览${importFileName ? `：${importFileName}` : ''}`}
          open={importOpen}
          onCancel={() => {
            if (importSubmitting) return
            setImportOpen(false)
            setImportRows([])
            setImportFileName('')
          }}
          okText="开始导入"
          cancelText="取消"
          confirmLoading={importSubmitting}
          okButtonProps={{
            disabled: importSubmitting || !(importRows || []).some(r => r.status === 'valid')
          }}
          onOk={() => {
            void (async () => {
              const valid = (importRows || []).filter(r => r.status === 'valid')
              if (!valid.length) {
                message.warning('没有可导入的数据')
                return
              }
              setImportSubmitting(true)
              try {
                const chunkSize = 10
                const results = []
                for (let i = 0; i < valid.length; i += chunkSize) {
                  const chunk = valid.slice(i, i + chunkSize)
                  const settled = await Promise.allSettled(
                    chunk.map(r => {
                      const p = buildCreatePayload(r)
                      const orderType = String(p?.orderType || '').toLowerCase()
                      const source = String(p?.source || '').toLowerCase()
                      const purchaseCategory = String(p?.purchaseCategory || p?.category || '').toLowerCase()
                      const supplierName = String(p?.supplierName || '').trim()
                      const isPurchase =
                        orderType === 'purchase' ||
                        source === 'purchased' ||
                        Boolean(supplierName) ||
                        Boolean(purchaseCategory)
                      return cachedOrderAPI.createOrder({ ...p, status: 'ordered' })
                    })
                  )
                  settled.forEach((s, idx) => {
                    results.push({ key: chunk[idx].key, status: s.status, reason: s.status === 'rejected' ? s.reason : undefined })
                  })
                }

                const nextRows = (importRows || []).map(r => {
                  const hit = results.find(x => x.key === r.key)
                  if (!hit) return r
                  if (hit.status === 'fulfilled') return { ...r, status: 'success', importError: '' }
                  const msg = hit.reason?.response?.data?.message || hit.reason?.message || '导入失败'
                  return { ...r, status: 'failed', importError: msg }
                })
                setImportRows(nextRows)

                const successCount = nextRows.filter(r => r.status === 'success').length
                const failedCount = nextRows.filter(r => r.status === 'failed').length
                message.success(`导入完成：成功 ${successCount} 条，失败 ${failedCount} 条`)
                setListPage(1)
                await loadOrders(1, listPageSize)
                loadSummary()
              } finally {
                setImportSubmitting(false)
              }
            })()
          }}
          width={1100}
          destroyOnHidden
        >
          <Space style={{ marginBottom: 12 }} wrap>
            <Tag color="blue">总行数：{(importRows || []).length}</Tag>
            <Tag color="green">可导入：{(importRows || []).filter(r => r.status === 'valid').length}</Tag>
            <Tag color="red">不可导入：{(importRows || []).filter(r => r.status === 'invalid').length}</Tag>
            <Tag color="green">已导入：{(importRows || []).filter(r => r.status === 'success').length}</Tag>
            <Tag color="red">失败：{(importRows || []).filter(r => r.status === 'failed').length}</Tag>
          </Space>
          <Table
            columns={importPreviewColumns}
            dataSource={importRows}
            rowKey={(r) => r.key}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            size="small"
            scroll={{ x: 'max-content', y: 520 }}
          />
        </Modal>

        <Modal
          title={editingOrder ? '编辑订单' : '新建订单'}
          open={modalOpen}
          onOk={handleSubmit}
          onCancel={() => {
            if (!editingOrder) {
              try {
                const ono = form.getFieldValue('orderNo')
                if (reservedId || ono) {
                  orderAPI.releaseOrderNumber({ reservationId: reservedId, orderNumber: ono }).catch(() => { })
                }
              } catch (_) { void 0 }
              setReservedId(undefined)
            }
            setModalOpen(false)
            setEditingOrder(null)
            form.resetFields()
          }}
          destroyOnHidden
          forceRender
          width={1000}
          styles={{ body: { maxHeight: '70vh', overflowY: 'auto', padding: 16 } }}
        >
          <Form form={form} layout="vertical" onValuesChange={(changed, all) => {
            if (changed.boardWidth || changed.creasingSize1 || changed.creasingSize2) {
              const w = Number(all.boardWidth || 0)
              const s1 = Number(all.creasingSize1 || 0)
              const s2 = Number(all.creasingSize2 || 0)
              const s3 = Math.max(0, w - s1 - s2)
              form.setFieldsValue({ creasingSize3: s3 })
            }
            if (changed.creasingType) {
              const ct = all.creasingType
              if (ct === '无压线') {
                form.setFieldsValue({ creasingSize1: undefined, creasingSize2: undefined, creasingSize3: undefined })
              }
            }
            if (changed.quantity || changed.unitPrice) {
              const qty = Number(all.quantity || 0)
              const price = Number(all.unitPrice || 0)
              const amt = Math.max(0, qty * price)
              const dep = Number(all.deposit || 0)
              form.setFieldsValue({ amount: amt, balance: Math.max(0, amt - dep) })
            }
            if (changed.deposit) {
              const amt = Number(all.amount || 0)
              const dep = Number(all.deposit || 0)
              form.setFieldsValue({ balance: Math.max(0, amt - dep) })
            }
            if (changed.spec1 || changed.spec2 || changed.spec3) {
              const a = all.spec1
              const b = all.spec2
              const c = all.spec3
              const parts = [a, b, c].map(v => (v === undefined || v === null) ? '' : String(v).trim()).filter(v => v !== '')
              const s = parts.length ? parts.join('×') : ''
              form.setFieldsValue({ spec: s })
            }
            if (changed.boardWidth || changed.boardHeight || changed.spec) {
              try {
                const k = (all.spec && String(all.spec).trim()) || [String(all.boardWidth || ''), String(all.boardHeight || '')].filter(Boolean).join('×')
                const raw = localStorage.getItem('orderCreateMemory') || '{}'
                const obj = JSON.parse(raw)
                const mem = obj[k]
                if (mem) {
                  const patch = {}
                  if (!all.flute && mem.flute) patch.flute = mem.flute
                  if (!all.creasingType && mem.creasingType) patch.creasingType = mem.creasingType
                  if (!all.joinMethod && mem.joinMethod) patch.joinMethod = mem.joinMethod
                  if (!all.unitPrice && mem.unitPrice) patch.unitPrice = mem.unitPrice
                  if (!all.productTitle && mem.productTitle) patch.productTitle = mem.productTitle
                  if (Object.keys(patch).length) form.setFieldsValue(patch)
                }
              } catch (e) { void 0 }
            }
          }}>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item shouldUpdate noStyle>
                  {() => {
                    const orderNo = form.getFieldValue('orderNo')
                    const qrUrl = form.getFieldValue('qrCodeUrl')
                    return orderNo && qrUrl ? (
                      <div style={{ textAlign: 'center', padding: 12, border: '1px dashed #e5e5e5', borderRadius: 8, marginBottom: 12, background: '#fafafa' }}>
                        <AntImage width={160} src={qrUrl} />
                      </div>
                    ) : null
                  }}
                </Form.Item>
                <Form.Item name="orderNo" label="订单编号" style={{ width: 280 }}>
                  <Input disabled style={{ width: 280 }} />
                </Form.Item>
                <Form.Item name="customerId" label="客户名称" rules={[{ validator: async (_, val) => { const name = form.getFieldValue('customerName'); if (val || name) return Promise.resolve(); return Promise.reject('请选择客户') } }]}>
                  <Select
                    placeholder="请选择客户"
                    options={customerOptions}
                    showSearch
                    filterOption={false}
                    style={{ width: 280 }}
                    onSearch={async (q) => {
                      try {
                        const res = await cachedCustomerAPI.getCustomers({ q, page: 1, limit: 50 })
                        const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : Array.isArray(res?.data?.customers) ? res.data.customers : []
                        setCustomers(list)
                      } catch (e) {
                        setCustomers(prev => prev)
                      }
                    }}
                    onChange={(val, option) => {
                      if (String(val).startsWith('name::')) {
                        const name = option?.label
                        form.setFieldsValue({ customerId: undefined, customerName: name })
                      } else {
                        const c = (customers || []).find(x => (x._id || x.id) === val)
                        form.setFieldsValue({ customerId: val, customerName: c?.companyName || c?.name || c?.company })
                      }
                    }}
                    allowClear
                  />
                </Form.Item>
                <Form.Item name="customerName" hidden>
                  <Input />
                </Form.Item>
                <Form.Item name="supplierId" label="供应商" rules={[{ required: true, message: '请选择供应商' }]}>
                  <Select
                    placeholder="请选择供应商"
                    options={supplierOptions}
                    showSearch
                    optionFilterProp="label"
                    style={{ width: 280 }}
                    onChange={onSupplierSelect}
                    allowClear
                  />
                </Form.Item>
                {creatingSupplier && (
                  <Space style={{ marginBottom: 8 }}>
                    <Input
                      placeholder="输入供应商名称"
                      style={{ width: 200 }}
                      value={form.getFieldValue('newSupplierName')}
                      onChange={(e) => form.setFieldsValue({ newSupplierName: e.target.value })}
                    />
                    <Button type="primary" onClick={handleCreateSupplier}>保存</Button>
                    <Button onClick={() => setCreatingSupplier(false)}>取消</Button>
                  </Space>
                )}
                <Form.Item name="supplierName" hidden>
                  <Input />
                </Form.Item>
                <Form.Item name="quantity" label="数量" rules={[{ required: true, message: '请输入数量' }]}>
                  <Input type="number" placeholder="请输入数量" style={{ width: 180, color: '#1677ff' }} />
                </Form.Item>
                <Form.Item name="unitPrice" label="单价(元)" rules={[{ required: true, message: '请输入单价' }]}>
                  <Input type="number" placeholder="请输入单价" style={{ width: 180, color: '#ff4d4f' }} />
                </Form.Item>
                <Form.Item name="amount" label="金额(元)">
                  <Input type="number" placeholder="自动计算" readOnly style={{ width: 180, color: '#ff4d4f' }} />
                </Form.Item>
                <Form.Item name="deposit" label="已付定金(元)">
                  <Input type="number" placeholder="请输入已付定金" style={{ width: 180 }} />
                </Form.Item>
                <Form.Item name="balance" label="余额(元)">
                  <Input type="number" placeholder="自动计算" disabled style={{ width: 180 }} />
                </Form.Item>
                <Form.Item name="joinMethod" label="拼接方式">
                  <Select options={[{ value: '打钉', label: '打钉' }, { value: '粘胶', label: '粘胶' }]} allowClear style={{ width: 200 }} />
                </Form.Item>
                <Form.Item name="notes" label="备注">
                  <Input.TextArea style={{ height: 100, width: 280 }} />
                </Form.Item>

              </Col>
              <Col span={12}>
                <Form.Item name="productName" label="产品名称" rules={[{ required: true, message: '请选择或新增产品名称' }]} style={{ width: 320 }}>
                  <>
                    <Select
                      placeholder="请选择产品名称"
                      options={[...(categories || []).map(n => ({ value: n, label: n })), { value: '__NEW__', label: '新增产品名称' }]}
                      showSearch
                      onChange={onCategorySelect}
                      style={{ width: 320 }}
                    />
                    {creatingCategory && (
                      <Space style={{ marginTop: 8 }}>
                        <Input placeholder="输入产品名称" style={{ width: 200 }} value={form.getFieldValue('newCategoryName')} onChange={(e) => form.setFieldsValue({ newCategoryName: e.target.value })} />
                        <Button type="primary" onClick={handleCreateCategory}>保存</Button>
                        <Button onClick={() => setCreatingCategory(false)}>取消</Button>
                      </Space>
                    )}
                  </>
                </Form.Item>
                <Form.Item name="materialCode" label="材料编码" rules={[{ required: true, message: '请输入材料编码' }]} style={{ width: 240 }}>
                  <Input placeholder="请输入材料编码" style={{ width: 240 }} />
                </Form.Item>
                <Form.Item label="产品规格（mm）" required>
                  <Space>
                    <Form.Item name="spec1" noStyle rules={[{ required: true, message: '请输入规格' }]}>
                      <Input type="number" placeholder="mm" style={{ width: 120 }} />
                    </Form.Item>
                    ×
                    <Form.Item name="spec2" noStyle rules={[{ required: true, message: '请输入规格' }]}>
                      <Input type="number" placeholder="mm" style={{ width: 120 }} />
                    </Form.Item>
                    ×
                    <Form.Item name="spec3" noStyle>
                      <Input type="number" placeholder="mm" style={{ width: 120 }} />
                    </Form.Item>
                  </Space>
                </Form.Item>
                <Form.Item name="spec" hidden>
                  <Input />
                </Form.Item>
                <Form.Item
                  name="flute"
                  label="愣型"
                  rules={[
                    {
                      validator: async (_, value) => {
                        if (value && value !== '__NEW_FLUTE__') return Promise.resolve()
                        return Promise.reject(new Error('请选择愣型'))
                      }
                    }
                  ]}
                  style={{ width: 180 }}
                >
                  <>
                    <Select
                      placeholder="请选择愣型"
                      options={[
                        { value: 'AB楞', label: 'AB楞' },
                        { value: 'EB楞', label: 'EB楞' },
                        { value: 'A楞', label: 'A楞' },
                        { value: 'B楞', label: 'B楞' },
                        { value: 'E楞', label: 'E楞' },
                        { value: '__NEW_FLUTE__', label: '新增' }
                      ]}
                      onChange={onFluteSelect}
                      showSearch
                      style={{ width: 180 }}
                    />
                    {creatingFlute && (
                      <Space style={{ marginTop: 8 }}>
                        <Input style={{ width: 180 }} placeholder="输入愣型" value={form.getFieldValue('newFlute')} onChange={(e) => form.setFieldsValue({ newFlute: e.target.value })} />
                        <Button type="primary" onClick={() => { const v = form.getFieldValue('newFlute'); if (v) { form.setFieldsValue({ flute: v, newFlute: undefined }); setCreatingFlute(false) } }}>保存</Button>
                        <Button onClick={() => setCreatingFlute(false)}>取消</Button>
                      </Space>
                    )}
                  </>
                </Form.Item>
                <Form.Item name="creasingType" label="压线方式" style={{ width: 200 }}>
                  <Select options={[{ value: '凹凸压线', label: '凹凸压线' }, { value: '平压线', label: '平压线' }, { value: '无压线', label: '无压线' }]} style={{ width: 200 }} />
                </Form.Item>
                <Form.Item label="纸板尺寸（门幅mm×长度mm）" required>
                  <Space>
                    <Form.Item name="boardWidth" noStyle rules={[{ required: true, message: '请输入门幅' }]}>
                      <Input type="number" placeholder="门幅(mm)" style={{ width: 120 }} />
                    </Form.Item>
                    ×
                    <Form.Item name="boardHeight" noStyle rules={[{ required: true, message: '请输入长度' }]}>
                      <Input type="number" placeholder="长度(mm)" style={{ width: 120 }} />
                    </Form.Item>
                  </Space>
                </Form.Item>
                <Form.Item label="压线尺寸（mm）(1-2-3)" shouldUpdate>
                  {() => {
                    const isNoCrease = form.getFieldValue('creasingType') === '无压线'
                    return (
                      <Space>
                        <Form.Item name="creasingSize1" noStyle>
                          <Input type="number" placeholder="尺寸1(mm)" style={{ width: 120 }} disabled={isNoCrease} />
                        </Form.Item>
                        -
                        <Form.Item name="creasingSize2" noStyle>
                          <Input type="number" placeholder="尺寸2(mm)" style={{ width: 120 }} disabled={isNoCrease} />
                        </Form.Item>
                        -
                        <Form.Item name="creasingSize3" noStyle>
                          <Input type="number" placeholder="尺寸3(mm,自动)" style={{ width: 120 }} disabled />
                        </Form.Item>
                      </Space>
                    )
                  }}
                </Form.Item>
                <Form.Item name="productTitle" label="商品名称" style={{ width: 320 }}>
                  <Input placeholder="请输入商品名称" style={{ width: 320 }} />
                </Form.Item>
                <Form.Item name="materialNo" label="物料号" style={{ width: 360 }}>
                  <Input placeholder="请输入物料号" style={{ width: 360 }} />
                </Form.Item>
                <Form.Item name="priority" label="优先级" initialValue="normal" style={{ width: 200 }}>
                  <Select options={[{ value: 'normal', label: '普通' }, { value: 'urgent', label: '加急' }]} style={{ width: 200 }} />
                </Form.Item>
                <Form.Item name="deliveryDate" label="交付日期" style={{ width: 200 }}>
                  <DatePicker style={{ width: 200 }} />
                </Form.Item>
                <Form.Item name="attachments" label="上传图纸" valuePropName="fileList" getValueFromEvent={normalizeUpload}>
                  <Upload.Dragger multiple listType="picture" beforeUpload={() => false} style={{ height: 160, width: 320, display: 'inline-block' }}>
                    <p className="ant-upload-drag-icon">📄</p>
                    <p className="ant-upload-text">点击或拖拽文件到此处上传</p>
                  </Upload.Dragger>
                </Form.Item>
              </Col>


            </Row>
          </Form>
        </Modal>

        <Modal
          title="订单详情"
          open={detailOpen}
          onOk={() => setDetailOpen(false)}
          onCancel={() => setDetailOpen(false)}
          destroyOnHidden
          width={1000}
          footer={null}
          styles={{ body: { maxHeight: '80vh', overflowY: 'auto', padding: 24 } }}
        >
          <Spin spinning={detailLoading}>
            {detailOrder && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Customer Info */}
                <Card title="客户信息" size="small">
                  <Row gutter={24} align="top">
                    <Col xs={24} md={16}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 72, color: '#666' }}>订单编号</div>
                          <div style={{ fontWeight: 500 }}>{detailOrder.orderNo || '-'}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 72, color: '#666' }}>客户名称</div>
                          <div>{detailOrder.customerName || '-'}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 72, color: '#666' }}>交付日期</div>
                          <div>{detailOrder.deliveryDate ? dayjs(detailOrder.deliveryDate).format('YYYY-MM-DD') : '-'}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 72, color: '#666' }}>订单状态</div>
                          <div>
                            <Tag color={statusMap[detailOrder.status]?.color}>
                              {statusMap[detailOrder.status]?.text || detailOrder.status}
                            </Tag>
                          </div>
                        </div>
                      </div>
                    </Col>
                    <Col xs={24} md={8} style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ marginBottom: 8, color: '#666' }}>订单二维码</div>
                        {(() => {
                          const orderNo = String(detailOrder?.orderNo || '').trim()
                          const orderId = String(detailOrder?.__parentOrderId || detailOrder?._id || detailOrder?.id || '').trim()
                          const rawUrl = String(detailOrder?.qrCodeUrl || '').trim()
                          const lower = rawUrl.toLowerCase()
                          const isChild = /-\d+$/.test(orderNo)
                          const preferRaw = rawUrl && !lower.includes('api.qrserver.com/v1/create-qr-code') && !isChild
                          const payload = JSON.stringify({ v: 1, orderId, orderNo })
                          const url = preferRaw
                            ? rawUrl
                            : (orderNo || orderId)
                              ? `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}`
                              : ''
                          return url
                            ? <AntImage width={160} src={url} />
                            : <span style={{ color: '#999' }}>暂无二维码</span>
                        })()}
                      </div>
                    </Col>
                  </Row>
                </Card>

                {/* Product List */}
                <Card title="产品列表" size="small">
                  <Table
                    dataSource={detailOrder?.__itemChild ? [detailOrder] : (Array.isArray(detailOrder.items) && detailOrder.items.length ? detailOrder.items : [detailOrder])}
                    rowKey={(r, idx) => r._id || r.id || idx}
                    pagination={false}
                    size="small"
                    columns={[
                      { title: '产品名称', dataIndex: 'productName', key: 'productName', render: (v) => v || '-' },
                      { title: '规格', dataIndex: 'spec', key: 'spec', render: (v) => v || '-' },
                      {
                        title: '材质',
                        key: 'materialCode',
                        render: (_, r) => {
                          const normalizeText = (v) => String(v ?? '').trim()
                          const normalizeKey = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, '')
                          const normalizeSpecKey = (v) => normalizeKey(v).replace(/[x*]/g, '×').replace(/mm$/i, '')
                          const normalizeId = (v) => {
                            const s = normalizeText(v)
                            if (!s) return ''
                            const parts = s.split(/[\\/]/).filter(Boolean)
                            return parts.length ? parts[parts.length - 1] : s
                          }
                          const isMaterialNo = (val) => {
                            const s = normalizeText(val)
                            if (!s) return false
                            if (s.includes('-')) return /^\d/.test(s) && /\d/.test(s)
                            return /^\d{6,}$/.test(s)
                          }
                          const isMaterialCodeFormat = (val) => /^(AB|EB|A|B|E)楞$/.test(normalizeText(val))
                          const pickText = (...candidates) => {
                            for (const c of candidates) {
                              const s = normalizeText(c)
                              if (s) return s
                            }
                            return ''
                          }

                          const customerId = normalizeId(
                            detailOrder?.customerId ||
                            detailOrder?.customer_id ||
                            detailOrder?.customerID ||
                            detailOrder?.customer?._id ||
                            detailOrder?.customer?.id ||
                            r?.customerId ||
                            r?.customer_id ||
                            r?.customerID ||
                            r?.customer?._id ||
                            r?.customer?.id ||
                            ''
                          )
                          const skuIndex = customerId ? customerSkuIndexByCustomerId.get(customerId) : null
                          const skuId = normalizeId(r?.skuId || r?.sku_id || r?.customerSkuId || r?.customer_sku_id)
                          const materialKey = normalizeKey(
                            r?.materialNo || r?.material_no ||
                            r?.materialCode || r?.material_code || r?.material ||
                            detailOrder?.materialNo || detailOrder?.material_no ||
                            detailOrder?.materialCode || detailOrder?.material_code || detailOrder?.material
                          )
                          const specKey = normalizeSpecKey(r?.spec || r?.specification || detailOrder?.spec || detailOrder?.specification)
                          const nameKey = normalizeKey(r?.goodsName || r?.goods_name || r?.productName || r?.productTitle || r?.title || detailOrder?.goodsName || detailOrder?.productName || detailOrder?.productTitle || detailOrder?.title)

                          const sku =
                            skuIndex
                              ? (skuId && skuIndex.get(`id:${normalizeKey(skuId)}`)) ||
                                (materialKey && specKey && skuIndex.get(`ms:${materialKey}::${specKey}`)) ||
                                (materialKey && specKey && skuIndex.get(`cs:${materialKey}::${specKey}`)) ||
                                (materialKey && skuIndex.get(`m:${materialKey}`)) ||
                                (materialKey && skuIndex.get(`c:${materialKey}`)) ||
                                (nameKey && specKey && skuIndex.get(`ns:${nameKey}::${specKey}`)) ||
                                (nameKey && skuIndex.get(`n:${nameKey}`)) ||
                                null
                              : null

                          const localMaterialNo = normalizeText(
                            r?.materialNo ||
                            r?.material_no ||
                            ''
                          )
                          const skuMaterialNo = normalizeText(sku?.materialNo || sku?.material_no || '')
                          const fromSku = pickText(sku?.materialCode, sku?.material_code, sku?.material)
                          const fromLocal = pickText(r?.materialCode, r?.material_code, r?.material, detailOrder?.materialCode, detailOrder?.material_code, detailOrder?.material)
                          const materialCodeRaw = fromLocal || fromSku
                          const materialCodeFrom = fromLocal ? 'local' : (fromSku ? 'sku' : '')
                          const materialCode = isMaterialNo(materialCodeRaw) ? '' : materialCodeRaw
                          if (materialCode) {
                            if (materialCodeFrom === 'local' && !skuMaterialNo && localMaterialNo && normalizeKey(materialCode) === normalizeKey(localMaterialNo)) {
                              return fromSku || '-'
                            }
                            return materialCode
                          }

                          const parseCode = (rawNo) => {
                            const s = normalizeText(rawNo)
                            if (!s) return ''
                            const parts = s.split(/[/／]/).map((x) => String(x || '').trim()).filter(Boolean)
                            if (parts.length < 2) return ''
                            const code = parts[0] || ''
                            if (!code || isMaterialNo(code)) return ''
                            return code
                          }
                          const parsedFromSkuNo = parseCode(sku?.materialNo || sku?.material_no)
                          if (parsedFromSkuNo) return parsedFromSkuNo
                          const parsedFromLocalNo = parseCode(r?.materialNo || r?.material_no || detailOrder?.materialNo || detailOrder?.material_no)
                          if (parsedFromLocalNo) return parsedFromLocalNo

                          if (localMaterialNo && !localMaterialNo.includes('/') && !localMaterialNo.includes('／') && !isMaterialNo(localMaterialNo) && !isMaterialCodeFormat(localMaterialNo)) {
                            return localMaterialNo
                          }

                          return '-'
                        }
                      },
                      {
                        title: '物料号',
                        key: 'materialNo',
                        render: (_, r) => {
                          const normalizeText = (v) => String(v ?? '').trim()
                          const normalizeKey = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, '')
                          const normalizeSpecKey = (v) => normalizeKey(v).replace(/[x*]/g, '×').replace(/mm$/i, '')
                          const normalizeId = (v) => {
                            const s = normalizeText(v)
                            if (!s) return ''
                            const parts = s.split(/[\\/]/).filter(Boolean)
                            return parts.length ? parts[parts.length - 1] : s
                          }
                          const isMaterialNo = (val) => {
                            const s = normalizeText(val)
                            if (!s) return false
                            if (s.includes('-')) return /^\d/.test(s) && /\d/.test(s)
                            return /^\d{6,}$/.test(s)
                          }
                          const isMaterialCodeFormat = (val) => /^(AB|EB|A|B|E)楞$/.test(normalizeText(val))

                          const customerId = normalizeId(
                            detailOrder?.customerId ||
                            detailOrder?.customer_id ||
                            detailOrder?.customerID ||
                            detailOrder?.customer?._id ||
                            detailOrder?.customer?.id ||
                            r?.customerId ||
                            r?.customer_id ||
                            r?.customerID ||
                            r?.customer?._id ||
                            r?.customer?.id ||
                            ''
                          )
                          const skuIndex = customerId ? customerSkuIndexByCustomerId.get(customerId) : null
                          const skuId = normalizeId(r?.skuId || r?.sku_id || r?.customerSkuId || r?.customer_sku_id)
                          const specKey = normalizeSpecKey(r?.spec || r?.specification || detailOrder?.spec || detailOrder?.specification)
                          const nameKey = normalizeKey(r?.goodsName || r?.goods_name || r?.productName || r?.productTitle || r?.title || detailOrder?.goodsName || detailOrder?.productName || detailOrder?.productTitle || detailOrder?.title)
                          const materialKey = normalizeKey(
                            r?.materialNo || r?.material_no ||
                            r?.materialCode || r?.material_code || r?.material ||
                            detailOrder?.materialNo || detailOrder?.material_no ||
                            detailOrder?.materialCode || detailOrder?.material_code || detailOrder?.material
                          )
                          const sku =
                            skuIndex
                              ? (skuId && skuIndex.get(`id:${normalizeKey(skuId)}`)) ||
                                (materialKey && specKey && skuIndex.get(`ms:${materialKey}::${specKey}`)) ||
                                (materialKey && specKey && skuIndex.get(`cs:${materialKey}::${specKey}`)) ||
                                (materialKey && skuIndex.get(`m:${materialKey}`)) ||
                                (materialKey && skuIndex.get(`c:${materialKey}`)) ||
                                (nameKey && specKey && skuIndex.get(`ns:${nameKey}::${specKey}`)) ||
                                (nameKey && skuIndex.get(`n:${nameKey}`)) ||
                                null
                              : null
                          const skuNo = normalizeText(sku?.materialNo || sku?.material_no || '')
                          const skuCode = normalizeText(sku?.materialCode || sku?.material_code || sku?.material || '')

                          if (skuNo) {
                            if (skuCode && normalizeKey(skuNo) === normalizeKey(skuCode)) return '-'
                            return skuNo
                          }

                          const localNo = normalizeText(r?.materialNo || r?.material_no || '')
                          if (!localNo) return '-'
                          if (skuCode && normalizeKey(localNo) === normalizeKey(skuCode)) return '-'

                          const localCode = normalizeText(r?.materialCode || r?.material_code || r?.material || '')
                          if (localCode && normalizeKey(localNo) === normalizeKey(localCode)) return '-'

                          if (!localNo.includes('/') && !localNo.includes('／') && !isMaterialNo(localNo) && !isMaterialCodeFormat(localNo)) return '-'
                          return localNo
                        }
                      },
                      {
                        title: '楞型',
                        key: 'flute',
                        render: (_, r) => {
                          const normalizeText = (v) => String(v ?? '').trim()
                          const normalizeKey = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, '')
                          const normalizeSpecKey = (v) => normalizeKey(v).replace(/[x*]/g, '×').replace(/mm$/i, '')
                          const normalizeId = (v) => {
                            const s = normalizeText(v)
                            if (!s) return ''
                            const parts = s.split(/[\\/]/).filter(Boolean)
                            return parts.length ? parts[parts.length - 1] : s
                          }
                          const pickText = (...candidates) => {
                            for (const c of candidates) {
                              const s = normalizeText(c)
                              if (s) return s
                            }
                            return ''
                          }
                          const parseFlute = (rawNo) => {
                            const s = normalizeText(rawNo)
                            if (!s) return ''
                            const parts = s.split(/[/／]/).map((x) => String(x || '').trim()).filter(Boolean)
                            return parts.length >= 2 ? (parts[1] || '') : ''
                          }

                          const customerId = normalizeId(
                            detailOrder?.customerId ||
                            detailOrder?.customer_id ||
                            detailOrder?.customerID ||
                            detailOrder?.customer?._id ||
                            detailOrder?.customer?.id ||
                            r?.customerId ||
                            r?.customer_id ||
                            r?.customerID ||
                            r?.customer?._id ||
                            r?.customer?.id ||
                            ''
                          )
                          const skuIndex = customerId ? customerSkuIndexByCustomerId.get(customerId) : null
                          const skuId = normalizeId(r?.skuId || r?.sku_id || r?.customerSkuId || r?.customer_sku_id)
                          const materialNoKey = normalizeKey(r?.materialNo || r?.material_no || detailOrder?.materialNo || detailOrder?.material_no)
                          const specKey = normalizeSpecKey(r?.spec || r?.specification || detailOrder?.spec || detailOrder?.specification)
                          const nameKey = normalizeKey(r?.goodsName || r?.goods_name || r?.productName || r?.productTitle || r?.title || detailOrder?.goodsName || detailOrder?.productName || detailOrder?.productTitle || detailOrder?.title)

                          const sku =
                            skuIndex
                              ? (skuId && skuIndex.get(`id:${normalizeKey(skuId)}`)) ||
                                (materialNoKey && specKey && skuIndex.get(`ms:${materialNoKey}::${specKey}`)) ||
                                (materialNoKey && skuIndex.get(`m:${materialNoKey}`)) ||
                                (nameKey && specKey && skuIndex.get(`ns:${nameKey}::${specKey}`)) ||
                                (nameKey && skuIndex.get(`n:${nameKey}`)) ||
                                null
                              : null

                          const fromLocal = pickText(r?.flute, r?.fluteType, r?.flute_type, r?.flute_code, detailOrder?.flute, detailOrder?.fluteType, detailOrder?.flute_type, detailOrder?.flute_code)
                          if (fromLocal) return fromLocal

                          const fromSku = pickText(
                            sku?.flute,
                            sku?.flute_code,
                            sku?.fluteType,
                            sku?.flute_type,
                            Array.isArray(sku?.flutes) && sku.flutes.length ? sku.flutes[0] : '',
                            Array.isArray(sku?.fluteOptions) && sku.fluteOptions.length ? sku.fluteOptions[0] : '',
                            Array.isArray(sku?.flute_options) && sku.flute_options.length ? sku.flute_options[0] : '',
                            Array.isArray(sku?.fluteList) && sku.fluteList.length ? sku.fluteList[0] : '',
                            Array.isArray(sku?.flute_list) && sku.flute_list.length ? sku.flute_list[0] : ''
                          )
                          if (fromSku) return fromSku

                          const parsed = parseFlute(r?.materialNo || r?.material_no || detailOrder?.materialNo || detailOrder?.material_no)
                          if (parsed) return parsed
                          return '-'
                        }
                      },
                      {
                        title: '压线',
                        key: 'crease',
                        render: (_, r) => {
                          const normalizeText = (v) => String(v ?? '').trim()
                          const normalizeKey = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, '')
                          const normalizeSpecKey = (v) => normalizeKey(v).replace(/[x*]/g, '×').replace(/mm$/i, '')
                          const normalizeId = (v) => {
                            const s = normalizeText(v)
                            if (!s) return ''
                            const parts = s.split(/[\\/]/).filter(Boolean)
                            return parts.length ? parts[parts.length - 1] : s
                          }

                          const customerId = normalizeId(
                            detailOrder?.customerId ||
                            detailOrder?.customer_id ||
                            detailOrder?.customerID ||
                            detailOrder?.customer?._id ||
                            detailOrder?.customer?.id ||
                            r?.customerId ||
                            r?.customer_id ||
                            r?.customerID ||
                            r?.customer?._id ||
                            r?.customer?.id ||
                            ''
                          )
                          const skuIndex = customerId ? customerSkuIndexByCustomerId.get(customerId) : null
                          const skuId = normalizeId(r?.skuId || r?.sku_id || r?.customerSkuId || r?.customer_sku_id)
                          const materialNoKey = normalizeKey(r?.materialNo || r?.material_no || detailOrder?.materialNo || detailOrder?.material_no)
                          const specKey = normalizeSpecKey(r?.spec || r?.specification || detailOrder?.spec || detailOrder?.specification)
                          const nameKey = normalizeKey(r?.goodsName || r?.goods_name || r?.productName || r?.productTitle || r?.title || detailOrder?.goodsName || detailOrder?.productName || detailOrder?.productTitle || detailOrder?.title)

                          const sku =
                            skuIndex
                              ? (skuId && skuIndex.get(`id:${normalizeKey(skuId)}`)) ||
                                (materialNoKey && specKey && skuIndex.get(`ms:${materialNoKey}::${specKey}`)) ||
                                (materialNoKey && skuIndex.get(`m:${materialNoKey}`)) ||
                                (nameKey && specKey && skuIndex.get(`ns:${nameKey}::${specKey}`)) ||
                                (nameKey && skuIndex.get(`n:${nameKey}`)) ||
                                null
                              : null

                          const merged = {
                            ...r,
                            creasingSize1:
                              r?.creasingSize1 ?? r?.creasing_size1 ?? r?.creaseSize1 ?? r?.crease_size1 ?? r?.creasingSize_1 ?? r?.creasing_size_1 ?? r?.creaseSize_1 ?? r?.crease_size_1 ??
                              sku?.creasingSize1 ?? sku?.creasing_size1 ?? sku?.creaseSize1 ?? sku?.crease_size1 ?? sku?.creasingSize_1 ?? sku?.creasing_size_1 ?? sku?.creaseSize_1 ?? sku?.crease_size_1 ??
                              detailOrder?.creasingSize1 ?? detailOrder?.creasing_size1 ?? detailOrder?.creaseSize1 ?? detailOrder?.crease_size1 ?? detailOrder?.creasingSize_1 ?? detailOrder?.creasing_size_1 ?? detailOrder?.creaseSize_1 ?? detailOrder?.crease_size_1,
                            creasingSize2:
                              r?.creasingSize2 ?? r?.creasing_size2 ?? r?.creaseSize2 ?? r?.crease_size2 ?? r?.creasingSize_2 ?? r?.creasing_size_2 ?? r?.creaseSize_2 ?? r?.crease_size_2 ??
                              sku?.creasingSize2 ?? sku?.creasing_size2 ?? sku?.creaseSize2 ?? sku?.crease_size2 ?? sku?.creasingSize_2 ?? sku?.creasing_size_2 ?? sku?.creaseSize_2 ?? sku?.crease_size_2 ??
                              detailOrder?.creasingSize2 ?? detailOrder?.creasing_size2 ?? detailOrder?.creaseSize2 ?? detailOrder?.crease_size2 ?? detailOrder?.creasingSize_2 ?? detailOrder?.creasing_size_2 ?? detailOrder?.creaseSize_2 ?? detailOrder?.crease_size_2,
                            creasingSize3:
                              r?.creasingSize3 ?? r?.creasing_size3 ?? r?.creaseSize3 ?? r?.crease_size3 ?? r?.creasingSize_3 ?? r?.creasing_size_3 ?? r?.creaseSize_3 ?? r?.crease_size_3 ??
                              sku?.creasingSize3 ?? sku?.creasing_size3 ?? sku?.creaseSize3 ?? sku?.crease_size3 ?? sku?.creasingSize_3 ?? sku?.creasing_size_3 ?? sku?.creaseSize_3 ?? sku?.crease_size_3 ??
                              detailOrder?.creasingSize3 ?? detailOrder?.creasing_size3 ?? detailOrder?.creaseSize3 ?? detailOrder?.crease_size3 ?? detailOrder?.creasingSize_3 ?? detailOrder?.creasing_size_3 ?? detailOrder?.creaseSize_3 ?? detailOrder?.crease_size_3,
                            creasingType:
                              r?.creasingType ?? r?.creasing_type ?? r?.creaseType ?? r?.crease_type ??
                              sku?.creasingType ?? sku?.creaseType ?? sku?.creasing_type ?? sku?.crease_type ??
                              detailOrder?.creasingType ?? detailOrder?.creasing_type ?? detailOrder?.creaseType ?? detailOrder?.crease_type,
                            pressLine:
                              r?.crease ?? r?.creaseText ?? r?.crease_text ??
                              r?.pressLine ?? r?.press_line ?? r?.pressLineSize ?? r?.press_line_size ?? r?.creasingSize ?? r?.creaseSize ?? r?.creasing_size ?? r?.crease_size ??
                              sku?.crease ?? sku?.creaseText ?? sku?.crease_text ??
                              sku?.pressLine ?? sku?.press_line ?? sku?.pressLineSize ?? sku?.press_line_size ?? sku?.creasingSize ?? sku?.creaseSize ?? sku?.creasing_size ?? sku?.crease_size ??
                              detailOrder?.crease ?? detailOrder?.creaseText ?? detailOrder?.crease_text ??
                              detailOrder?.pressLine ?? detailOrder?.press_line ?? detailOrder?.pressLineSize ?? detailOrder?.press_line_size ?? detailOrder?.creasingSize ?? detailOrder?.creaseSize ?? detailOrder?.creasing_size ?? detailOrder?.crease_size
                          }

                          return formatCrease(merged)
                        }
                      },
                      {
                        title: 'SKU',
                        key: 'sku',
                        render: (_, r) => {
                          const normalizeText = (v) => String(v ?? '').trim()
                          const normalizeKey = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, '')
                          const normalizeSpecKey = (v) => normalizeKey(v).replace(/[x*]/g, '×').replace(/mm$/i, '')
                          const normalizeId = (v) => {
                            const s = normalizeText(v)
                            if (!s) return ''
                            const parts = s.split(/[\\/]/).filter(Boolean)
                            return parts.length ? parts[parts.length - 1] : s
                          }

                          const customerId = normalizeId(detailOrder?.customerId || detailOrder?.customer?._id || detailOrder?.customer?.id || '')
                          const skuIndex = customerId ? customerSkuIndexByCustomerId.get(customerId) : null
                          if (!skuIndex) return '-'

                          const skuId = normalizeId(r?.skuId || r?.sku_id || r?.customerSkuId || r?.customer_sku_id)
                          const materialNoKey = normalizeKey(r?.materialNo || r?.material_no)
                          const specKey = normalizeSpecKey(r?.spec || r?.specification)
                          const nameKey = normalizeKey(r?.goodsName || r?.goods_name || r?.productName || r?.productTitle || r?.title)

                          const sku =
                            (skuId && skuIndex.get(`id:${normalizeKey(skuId)}`)) ||
                            (materialNoKey && specKey && skuIndex.get(`ms:${materialNoKey}::${specKey}`)) ||
                            (materialNoKey && skuIndex.get(`m:${materialNoKey}`)) ||
                            (nameKey && specKey && skuIndex.get(`ns:${nameKey}::${specKey}`)) ||
                            (nameKey && skuIndex.get(`n:${nameKey}`)) ||
                            null

                          const text = normalizeText(sku?.materialNo || sku?.material_no || sku?.name || sku?.goodsName || sku?.productName || '')
                          return text || '-'
                        }
                      },
                      { title: '数量', dataIndex: 'quantity', key: 'quantity' },
                      { title: '单价', dataIndex: 'unitPrice', key: 'unitPrice', render: v => v ?? '-' },
                      { title: '金额', dataIndex: 'amount', key: 'amount', render: v => v ?? '-' },
                    ]}
                  />
                  <div style={{ marginTop: 16 }}>
                    <h4>附件图纸</h4>
                    {Array.isArray(detailOrder.attachments) && detailOrder.attachments.length ? (
                      <Space wrap>
                        {detailOrder.attachments.map((f) => (
                          f.url ? <AntImage key={f.uid} width={100} src={f.url} /> : <Tag key={f.uid}>{f.name}</Tag>
                        ))}
                      </Space>
                    ) : (
                      <span style={{ color: '#999' }}>暂无附件</span>
                    )}
                  </div>
                </Card>

                {/* Order Notes */}
                <Card title="订单备注" size="small">
                  <div style={{ whiteSpace: 'pre-wrap', minHeight: 40, color: detailOrder.remarks || detailOrder.notes ? 'inherit' : '#999' }}>
                    {detailOrder.remarks || detailOrder.notes || '无备注'}
                  </div>
                </Card>
              </div>
            )}
          </Spin>
        </Modal>

        <Modal
          title="批量发货确认"
          open={batchShippingOpen}
          onCancel={() => {
            setBatchShippingOpen(false)
            setShippingOrders([])
            shippingForm.resetFields()
          }}
          onOk={handleConfirmShipping}
          width={900}
          okText="确认发货"
          cancelText="取消"
        >
          <Form form={shippingForm} layout="vertical">
            <p>已选择 <strong>{shippingOrders.length}</strong> 个订单</p>
            <Divider />
            <Table
              dataSource={shippingOrders}
              pagination={false}
              size="small"
              scroll={{ y: 400 }}
              rowKey={(record) => record._id || record.id || record.key}
              columns={[
                {
                  title: '订单号',
                  dataIndex: 'orderNo',
                  key: 'orderNo',
                  width: 140
                },
                {
                  title: '客户',
                  dataIndex: 'customerName',
                  key: 'customerName',
                  width: 120
                },
                {
                  title: '产品',
                  dataIndex: 'productName',
                  key: 'productName',
                  width: 120
                },
                {
                  title: '订单数量',
                  dataIndex: 'quantity',
                  key: 'quantity',
                  width: 100
                },
                {
                  title: '发货数量',
                  key: 'shippingQuantity',
                  width: 150,
                  render: (_, record) => {
                    const key = record._id || record.id || record.key
                    const toNumber = (v, fallback = 0) => {
                      const n = Number(v)
                      return Number.isFinite(n) ? n : fallback
                    }
                    const totalStocked = toNumber(record.stockedQty || record.quantity, 0)
                    const shippedAlready = toNumber(record.shippedQty ?? record.deliveredQty, 0)
                    const remain = Math.max(0, totalStocked - shippedAlready)
                    return (
                      <Form.Item
                        name={`quantity_${key}`}
                        rules={[
                          { required: true, message: '请输入发货数量' },
                          {
                            validator: async (_, value) => {
                              const n = Number(value)
                              if (!Number.isFinite(n) || n <= 0) {
                                throw new Error('发货数量必须大于0')
                              }
                              if (n > remain) {
                                throw new Error(`发货数量不能大于可发数量（${remain}）`)
                              }
                            }
                          }
                        ]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input
                          type="number"
                          min={0}
                          max={remain}
                          placeholder={remain > 0 ? `最多可发 ${remain}` : '暂无可发数量'}
                        />
                      </Form.Item>
                    )
                  }
                }
              ]}
            />
          </Form>
        </Modal>
      </div>
    </ConfigProvider>
  )
}

export default OrderManagement
