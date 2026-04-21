import React, { useEffect, useRef, useState } from 'react'
import { App, Button, Card, Input, Select, Space, Table, Tabs, Tag } from 'antd'
import { EditOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons'
import { useNavigate } from 'react-router-dom'
import { cachedCustomerAPI, cachedOrderAPI, cachedPurchaseAPI } from '../services/cachedAPI'
import { customerAPI, customerSkuAPI, supplierAPI, supplierMaterialAPI } from '../services/api'

function ProductManagement() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('customers')

  const [customerLoading, setCustomerLoading] = useState(false)
  const [customerRows, setCustomerRows] = useState([])
  const [customerPage, setCustomerPage] = useState(1)
  const [customerPageSize, setCustomerPageSize] = useState(10)
  const [customerKeywordInput, setCustomerKeywordInput] = useState('')
  const [customerKeyword, setCustomerKeyword] = useState('')
  const [skuCountOverrides, setSkuCountOverrides] = useState({})
  const skuCountInFlightRef = useRef(new Set())
  const skuCountSourceRef = useRef(new Map())
  const [supplierLoading, setSupplierLoading] = useState(false)
  const [supplierRows, setSupplierRows] = useState([])
  const [supplierPage, setSupplierPage] = useState(1)
  const [supplierPageSize, setSupplierPageSize] = useState(10)
  const [supplierTotal, setSupplierTotal] = useState(0)
  const [filters, setFilters] = useState({
    keyword: '',
    status: ''
  })

  const extractCustomers = (res) => {
    if (Array.isArray(res)) return res
    if (Array.isArray(res?.customers)) return res.customers
    if (Array.isArray(res?.data?.customers)) return res.data.customers
    if (Array.isArray(res?.data?.data?.customers)) return res.data.data.customers
    if (Array.isArray(res?.data)) return res.data
    if (Array.isArray(res?.data?.data)) return res.data.data
    return []
  }

  const extractOrders = (res) => {
    if (Array.isArray(res)) return res
    if (Array.isArray(res?.orders)) return res.orders
    if (Array.isArray(res?.data?.orders)) return res.data.orders
    if (Array.isArray(res?.data?.data?.orders)) return res.data.data.orders
    if (Array.isArray(res?.data)) return res.data
    return []
  }

  const extractSkuStats = (res) => {
    const payload = res?.data ?? res
    const data = payload?.data ?? payload?.data?.data ?? payload
    if (Array.isArray(data?.stats)) return data.stats
    if (Array.isArray(data?.data?.stats)) return data.data.stats
    if (Array.isArray(payload?.stats)) return payload.stats
    return []
  }

  const normalizeText = (v) => String(v == null ? '' : v).trim()

  const pickFrequency = (orderCount) => {
    const n = Number(orderCount || 0)
    if (Number.isFinite(n) && n >= 20) return 'high'
    if (Number.isFinite(n) && n >= 5) return 'mid'
    return 'low'
  }

  const normalizeIdSegment = (v) => {
    const s = normalizeText(v)
    if (!s) return ''
    const parts = s.split(/[\\/]/).filter(Boolean)
    return parts.length ? parts[parts.length - 1] : s
  }

  const extractOrderSkuKeys = (o) => {
    const keys = []
    const products = Array.isArray(o?.products) ? o.products : []
    const items = Array.isArray(o?.items) ? o.items : []
    const list = products.length ? products : items

    if (list.length) {
      list.forEach((it) => {
        const id = normalizeText(it?.productId ?? it?.product_id ?? it?.pid ?? it?.id ?? it?._id)
        const code = normalizeText(it?.productCode ?? it?.sku ?? it?.skuCode ?? it?.code)
        const name = normalizeText(it?.productName ?? it?.name ?? it?.title ?? it?.goodsName)
        const spec = normalizeText(it?.specification ?? it?.spec ?? it?.productSpec)
        const key = id || code || normalizeText([name, spec].filter(Boolean).join('|'))
        if (key) keys.push(key)
      })
      return keys
    }

    const id = normalizeText(o?.productId ?? o?.product_id ?? o?.pid)
    const code = normalizeText(o?.productCode ?? o?.sku ?? o?.skuCode ?? o?.code)
    const name = normalizeText(o?.productName ?? o?.productTitle ?? o?.goodsName)
    const spec = normalizeText(o?.specification ?? o?.spec)
    const key = id || code || normalizeText([name, spec].filter(Boolean).join('|'))
    if (key) keys.push(key)
    return keys
  }

  const computeOrderInventoryQty = (o) => {
    const status = normalizeText(o?.status).toLowerCase()
    const items = Array.isArray(o?.items) ? o.items : []
    const quantity = Number(
      o?.quantity ??
      o?.totalQty ??
      (items.length ? items.reduce((s, it) => s + (Number(it?.quantity) || 0), 0) : 0)
    )
    const shippedFromField = Number(o?.shippedQty ?? o?.deliveredQty ?? 0)
    let shipped = Number.isFinite(shippedFromField) && shippedFromField > 0 ? shippedFromField : 0
    if (shipped <= 0 && Array.isArray(o?.shipments)) {
      const sum = o.shipments.reduce((s, it) => {
        const v = Number(it?.qty ?? it?.quantity ?? it?.shipQty ?? 0)
        if (!Number.isFinite(v) || v <= 0) return s
        return s + v
      }, 0)
      if (Number.isFinite(sum) && sum > 0) shipped = sum
    }
    const stockedQtyRaw = Number(o?.stockedQty ?? o?.stockedQuantity ?? 0)
    const stockedQty = Number.isFinite(stockedQtyRaw) && stockedQtyRaw > 0
      ? stockedQtyRaw
      : (['stocked', 'completed', 'warehoused', 'warehouse', 'done', '已入库'].includes(status) ? (Number.isFinite(quantity) ? quantity : 0) : 0)
    return Math.max(0, stockedQty - shipped)
  }

  const loadCustomerProductStats = async () => {
    setCustomerLoading(true)
    try {
      setSkuCountOverrides({})
      skuCountInFlightRef.current = new Set()
      const fetchAllCustomers = async () => {
        const pageSize = 200
        const maxPages = 50
        const all = []
        for (let page = 1; page <= maxPages; page += 1) {
          const resp = await cachedCustomerAPI.getCustomers({ page, pageSize, limit: pageSize })
          const list = extractCustomers(resp)
          if (list.length) all.push(...list)
          const pagination = resp?.data?.data?.pagination ?? resp?.data?.pagination ?? {}
          const totalPages = Number(pagination?.totalPages || 0)
          if (totalPages > 0 && page >= totalPages) break
          if (!list.length || list.length < pageSize) break
        }
        return all
      }
      const [customerSettled, ordersSettled, skuStatsSettled] = await Promise.allSettled([
        fetchAllCustomers(),
        cachedOrderAPI.getAllOrders(),
        customerAPI.getCustomerSkuStats()
      ])
      if (customerSettled.status !== 'fulfilled') throw customerSettled.reason
      const customerResp = customerSettled.value
      const allOrders = ordersSettled.status === 'fulfilled' ? ordersSettled.value : null
      const skuStatsResp = skuStatsSettled.status === 'fulfilled' ? skuStatsSettled.value : null
      if (ordersSettled.status !== 'fulfilled') {
        message.warning('订单数据加载失败，库存产品数量/订单数量已降级为 0')
      }
      if (skuStatsSettled.status !== 'fulfilled') {
        message.warning('SKU 统计加载失败，产品数量已降级为 0')
      }
      const rawCustomers = Array.isArray(customerResp) ? customerResp : extractCustomers(customerResp)
      const customersNorm = rawCustomers.map((c, index) => {
        const rawId = normalizeText(c?._id ?? c?.id)
        const id = normalizeIdSegment(rawId)
        const companyName = normalizeText(c?.companyName ?? c?.name ?? c?.company)
        const shortName = normalizeText(c?.shortName)
        const address = normalizeText(c?.address ?? c?.companyAddress ?? c?.addr ?? '')
        const status = normalizeText(c?.status) || 'active'
        return {
          ...c,
          id,
          key: id || rawId || `customer_${index}`,
          companyName,
          shortName,
          address,
          status
        }
      })

      const nameById = new Map()
      const nameToId = new Map()
      customersNorm.forEach((c) => {
        if (c.id) {
          if (c.companyName) nameToId.set(c.companyName, c.id)
          if (c.shortName) nameToId.set(c.shortName, c.id)
          const name = normalizeText(c?.name)
          if (name) nameToId.set(name, c.id)
          const aliases = [normalizeText(c?.shortName), normalizeText(c?.companyName), normalizeText(c?.name)]
            .filter((x) => String(x || '').trim())
          if (aliases.length) nameById.set(c.id, aliases)
        }
      })
      customerNamesByIdRef.current = nameById

      const skuStats = extractSkuStats(skuStatsResp)
      const skuCountByCustomerId = new Map()
      ;(skuStats || []).forEach((r) => {
        const cid = normalizeIdSegment(normalizeText(r?.customerId))
        if (!cid) return
        const n = Number(r?.skuCount ?? r?.count ?? 0)
        skuCountByCustomerId.set(cid, Number.isFinite(n) && n >= 0 ? n : 0)
        skuCountSourceRef.current.set(cid, { source: 'bulk', updatedAt: Date.now() })
      })

      const orders = allOrders ? extractOrders(allOrders) : []
      const agg = new Map()

      const ensure = (customerId) => {
        if (!agg.has(customerId)) {
          agg.set(customerId, { orderCount: 0, orders: new Set(), inventorySkus: new Set() })
        }
        return agg.get(customerId)
      }

      orders.forEach((o) => {
        const deletedFlag =
          Boolean(o?.isDeleted || o?.is_deleted || o?.deletedAt || o?.deleted_at) ||
          String(o?.deleted || '').toLowerCase() === 'true'
        if (deletedFlag) return

        const rawCustomerId = normalizeIdSegment(normalizeText(o?.customerId ?? o?.customer?._id ?? o?.customer?.id))
        const rawCustomerName = normalizeText(o?.customerName ?? o?.customer?.companyName ?? o?.customer?.name)
        const customerId = rawCustomerId || (rawCustomerName ? (nameToId.get(rawCustomerName) || '') : '')
        if (!customerId) return

        const bucket = ensure(customerId)
        const orderKey = normalizeText(o?.orderNo ?? o?.orderNumber ?? o?.order_id ?? o?._id ?? o?.id)
        const source = normalizeText(o?.source).toLowerCase()
        const orderType = normalizeText(o?.orderType).toLowerCase()
        const isPurchase = source === 'purchased' || orderType === 'purchase'
        if (!isPurchase && source === 'pc') {
          if (orderKey && !bucket.orders.has(orderKey)) {
            bucket.orders.add(orderKey)
            bucket.orderCount += 1
          } else if (!orderKey) {
            bucket.orderCount += 1
          }
        }

        const skuKeys = extractOrderSkuKeys(o)
        if (!isPurchase && computeOrderInventoryQty(o) > 0) {
          skuKeys.forEach((k) => bucket.inventorySkus.add(k))
        }
      })

      const rows = customersNorm
        .map((c) => {
          const metrics = c.id ? agg.get(c.id) : null
          return {
            key: c.key,
            id: c.id,
            shortName: c.shortName,
            companyName: c.companyName,
            address: c.address,
            status: c.status,
            productCount: c.id ? (skuCountByCustomerId.get(c.id) || 0) : 0,
            inventorySkuCount: metrics ? metrics.inventorySkus.size : 0,
            orderCount: metrics ? metrics.orderCount : 0
          }
        })
        .sort((a, b) => {
          if (b.orderCount !== a.orderCount) return b.orderCount - a.orderCount
          return normalizeText(a.shortName || a.companyName).localeCompare(normalizeText(b.shortName || b.companyName), 'zh-CN')
        })

      setCustomerRows(rows)
      setCustomerPage(1)
    } catch (_) {
      message.error('加载客户产品库失败')
      setCustomerRows([])
    } finally {
      setCustomerLoading(false)
    }
  }

  const filteredCustomerRows = customerKeyword
    ? customerRows.filter((r) => {
      const kw = String(customerKeyword || '').trim()
      if (!kw) return true
      return String(r?.shortName || '').includes(kw) || String(r?.companyName || '').includes(kw)
    })
    : customerRows

  const extractSkuPaginationTotal = (res) => {
    const payload = res?.data ?? res
    const data = payload?.data ?? payload?.data?.data ?? payload
    const total =
      data?.pagination?.total ??
      data?.data?.pagination?.total ??
      payload?.pagination?.total ??
      payload?.data?.pagination?.total
    const n = Number(total)
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  const customerNamesByIdRef = useRef(new Map())

  const loadSkuCountOverride = async (customerId) => {
    const cid = normalizeIdSegment(normalizeText(customerId))
    if (!cid) return
    if (skuCountOverrides[cid] != null) return
    const inflight = skuCountInFlightRef.current
    if (inflight.has(cid)) return
    inflight.add(cid)
    try {
      const res = await customerSkuAPI.getCustomerSkus(cid, { page: 1, pageSize: 1, limit: 1 })
      const total = extractSkuPaginationTotal(res)
      if (total != null) {
        setSkuCountOverrides((prev) => (prev[cid] != null ? prev : { ...prev, [cid]: total }))
        skuCountSourceRef.current.set(cid, { source: 'id', updatedAt: Date.now() })
        return
      }
      const aliases = customerNamesByIdRef.current.get(cid) || []
      for (const alias of aliases) {
        const used = normalizeText(alias)
        if (!used) continue
        const byNameRes = await customerSkuAPI.getCustomerSkus(used, { page: 1, pageSize: 1, limit: 1 })
        const totalByName = extractSkuPaginationTotal(byNameRes)
        if (totalByName != null) {
          setSkuCountOverrides((prev) => (prev[cid] != null ? prev : { ...prev, [cid]: totalByName }))
          skuCountSourceRef.current.set(cid, { source: 'name', updatedAt: Date.now() })
          break
        }
      }
    } catch (_) { void 0 } finally {
      inflight.delete(cid)
    }
  }

  useEffect(() => {
    const start = (Number(customerPage) - 1) * Number(customerPageSize)
    const end = start + Number(customerPageSize)
    const visible = filteredCustomerRows.slice(Math.max(0, start), Math.max(0, end))
    visible.forEach((r) => {
      const cid = normalizeIdSegment(normalizeText(r?.id))
      if (!cid) return
      if (skuCountOverrides[cid] != null) return
      loadSkuCountOverride(cid)
    })
  }, [customerPage, customerPageSize, filteredCustomerRows, skuCountOverrides])

  const handleCustomerSearch = () => {
    setCustomerKeyword(String(customerKeywordInput || '').trim())
    setCustomerPage(1)
  }

  const extractList = (res) => {
    const payload = res?.data ?? res
    const data = payload?.data ?? payload?.data?.data ?? payload
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.data)) return data.data
    if (Array.isArray(data?.orders)) return data.orders
    if (Array.isArray(data?.suppliers)) return data.suppliers
    return []
  }

  const extractPagination = (res) => {
    const payload = res?.data ?? res
    const data = payload?.data ?? payload?.data?.data ?? payload
    return data?.pagination ?? payload?.pagination ?? payload?.data?.pagination ?? {}
  }

  const fetchAllPages = async (fn, baseParams, options = {}) => {
    const pageKey = options.pageKey || 'page'
    const sizeKey = options.sizeKey || 'pageSize'
    const pageSize = Number(options.pageSize || 200)
    const maxPages = Number(options.maxPages || 200)
    const all = []
    let firstPageSig = ''
    for (let page = 1; page <= maxPages; page += 1) {
      const resp = await fn({ ...(baseParams || {}), [pageKey]: page, [sizeKey]: pageSize })
      const rows = extractList(resp)

      const headSig = rows
        .slice(0, 5)
        .map((r) => String(r?._id ?? r?.id ?? ''))
        .filter(Boolean)
        .join('|')

      if (page === 1) {
        firstPageSig = headSig
      } else if (headSig && firstPageSig && headSig === firstPageSig) {
        break
      }

      if (rows.length) all.push(...rows)

      const pagination = extractPagination(resp)
      const totalPages = Number(pagination?.totalPages || pagination?.pages || 0)
      const hasMore = pagination?.hasMore

      if (totalPages > 0 && page >= totalPages) break
      if (hasMore === false) break
      const hasExplicitPaging = totalPages > 0 || typeof hasMore === 'boolean'
      if (!hasExplicitPaging && (!rows.length || rows.length < pageSize)) break
    }
    return all
  }

  const loadSupplierMaterialLibrary = async (pageArg = supplierPage, pageSizeArg = supplierPageSize) => {
    setSupplierLoading(true)
    try {
      const rawSuppliers = await fetchAllPages(
        supplierAPI.getSuppliers,
        {},
        { pageKey: 'page', sizeKey: 'limit', pageSize: 200, maxPages: 200 }
      )
      const unwrapSupplier = (s) => {
        const base = s && typeof s === 'object' ? s : {}
        const d1 = base?.data && typeof base.data === 'object' && !Array.isArray(base.data) ? base.data : {}
        const d2 = d1?.data && typeof d1.data === 'object' && !Array.isArray(d1.data) ? d1.data : {}
        return { base, d1, d2 }
      }
      const suppliers = (rawSuppliers || []).map((s, index) => {
        const { base, d1, d2 } = unwrapSupplier(s)
        const id = String(base?._id ?? base?.id ?? d1?._id ?? d1?.id ?? d2?._id ?? d2?.id ?? '').trim()
        const name = String(
          base?.name ??
          base?.companyName ??
          base?.company ??
          d1?.name ??
          d1?.companyName ??
          d1?.company ??
          d2?.name ??
          d2?.companyName ??
          d2?.company ??
          ''
        ).trim()
        const shortName = String(base?.shortName ?? d1?.shortName ?? d2?.shortName ?? '').trim()
        const status = String(base?.status ?? d1?.status ?? d2?.status ?? 'active').trim() || 'active'
        const address = String(
          base?.address ??
          base?.companyAddress ??
          base?.company_address ??
          base?.addr ??
          base?.location ??
          base?.addressText ??
          base?.address_text ??
          d1?.address ??
          d1?.companyAddress ??
          d1?.company_address ??
          d1?.addr ??
          d1?.location ??
          d1?.addressText ??
          d1?.address_text ??
          d2?.address ??
          d2?.companyAddress ??
          d2?.company_address ??
          d2?.addr ??
          d2?.location ??
          d2?.addressText ??
          d2?.address_text ??
          ''
        ).trim()
        const industry = String(
          base?.industry ??
          base?.industryName ??
          base?.industry_name ??
          base?.trade ??
          base?.category ??
          base?.type ??
          d1?.industry ??
          d1?.industryName ??
          d1?.industry_name ??
          d1?.trade ??
          d1?.category ??
          d1?.type ??
          d2?.industry ??
          d2?.industryName ??
          d2?.industry_name ??
          d2?.trade ??
          d2?.category ??
          d2?.type ??
          ''
        ).trim()
        return {
          ...base,
          ...(d1 && typeof d1 === 'object' ? d1 : {}),
          id,
          name,
          shortName,
          status,
          address,
          industry,
          key: id || `supplier_${index}`
        }
      })

      const materialStatsRes = await supplierMaterialAPI.stats()
      const materialStats = extractList(materialStatsRes)
      const materialCountBySupplierId = new Map()
      ;(materialStats || []).forEach((r) => {
        const sid = String(r?.supplierId || '').trim()
        if (!sid) return
        const n = Number(r?.materialCount || 0)
        materialCountBySupplierId.set(sid, Number.isFinite(n) && n >= 0 ? n : 0)
      })

      const ordersBoards = await fetchAllPages(
        cachedPurchaseAPI.getPurchaseOrders,
        { category: 'boards', withTotal: false, withProducts: false },
        { pageKey: 'page', sizeKey: 'pageSize', pageSize: 500, maxPages: 50 }
      )
      const ordersRaw = await fetchAllPages(
        cachedPurchaseAPI.getPurchaseOrders,
        { category: 'raw_materials', withTotal: false, withProducts: false },
        { pageKey: 'page', sizeKey: 'pageSize', pageSize: 500, maxPages: 50 }
      )
      const orders = [...(ordersBoards || []), ...(ordersRaw || [])]

      const idBySupplierName = new Map()
      suppliers.forEach((s) => {
        const id = String(s?.id || '').trim()
        if (!id) return
        const fullName = String(s?.name || '').trim()
        const shortName = String(s?.shortName || '').trim()
        if (fullName) idBySupplierName.set(fullName, id)
        if (shortName) idBySupplierName.set(shortName, id)
      })

      const pickSupplierId = (o) => {
        const direct = String(o?.supplierId ?? o?.supplier?._id ?? o?.supplier?.id ?? '').trim()
        if (direct) return direct
        const name = String(o?.supplierName ?? o?.supplier?.name ?? o?.supplier?.companyName ?? '').trim()
        return name ? String(idBySupplierName.get(name) || '').trim() : ''
      }

      const orderCountBySupplierId = new Map()
      orders.forEach((o) => {
        const supplierId = pickSupplierId(o)
        if (!supplierId) return
        orderCountBySupplierId.set(supplierId, (orderCountBySupplierId.get(supplierId) || 0) + 1)
      })

      const kw = String(filters.keyword || '').trim()
      const st = String(filters.status || '').trim()
      const filtered = (suppliers || []).filter((s) => {
        if (kw) {
          const full = String(s?.name || '')
          const short = String(s?.shortName || '')
          if (!full.includes(kw) && !short.includes(kw)) return false
        }
        if (st) {
          const id = String(s?.id || '').trim()
          const orderCount = id ? (orderCountBySupplierId.get(id) || 0) : 0
          if (pickFrequency(orderCount) !== st) return false
        }
        return true
      })

      const rowsAll = filtered
        .map((s) => {
          const id = String(s?.id || '').trim()
          const materialCount = id ? (materialCountBySupplierId.get(id) || 0) : 0
          const orderCount = id ? (orderCountBySupplierId.get(id) || 0) : 0
          return {
            key: s.key,
            supplierId: id,
            supplierName: s.name,
            supplierShortName: s.shortName,
            address: s.address,
            industry: s.industry,
            materialCount,
            orderCount,
            status: pickFrequency(orderCount)
          }
        })
        .sort((a, b) => {
          if (b.materialCount !== a.materialCount) return b.materialCount - a.materialCount
          return String(a.supplierShortName || a.supplierName || '').localeCompare(String(b.supplierShortName || b.supplierName || ''), 'zh-CN')
        })

      const total = rowsAll.length
      const wantedPage = Number(pageArg || 1)
      const wantedPageSize = Number(pageSizeArg || 10)
      const offset = (wantedPage - 1) * wantedPageSize
      const paged = rowsAll.slice(offset, offset + wantedPageSize)

      setSupplierRows(paged)
      setSupplierTotal(total)
      setSupplierPage(wantedPage)
      setSupplierPageSize(wantedPageSize)
    } catch (_) {
      message.error('加载供应商材质库失败')
      setSupplierRows([])
      setSupplierTotal(0)
    } finally {
      setSupplierLoading(false)
    }
  }

  useEffect(() => {
    loadCustomerProductStats()
    loadSupplierMaterialLibrary(1, supplierPageSize)
  }, [])

  const supplierColumns = [
    {
      title: '供应商名称',
      dataIndex: 'supplierName',
      key: 'supplierName',
      width: 160,
      align: 'center',
      ellipsis: true,
      render: (_, record) => record?.supplierShortName || record?.supplierName || '-'
    },
    {
      title: '地址',
      dataIndex: 'address',
      key: 'address',
      width: 160,
      align: 'center',
      ellipsis: true,
      render: (v) => String(v || '').trim() || '-'
    },
    {
      title: '行业',
      dataIndex: 'industry',
      key: 'industry',
      width: 160,
      align: 'center',
      ellipsis: true,
      render: (v) => String(v || '').trim() || '-'
    },
    {
      title: '材质数量',
      dataIndex: 'materialCount',
      key: 'materialCount',
      width: 160,
      align: 'center',
      render: (v) => Number(v || 0)
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 160,
      align: 'center',
      render: (v, record) => {
        const s = String(v || '').trim() || 'low'
        const orderCount = Number(record?.orderCount || 0)
        if (s === 'high') return <Tag color="green" title={`下单次数：${orderCount}`}>高频</Tag>
        if (s === 'mid') return <Tag color="blue" title={`下单次数：${orderCount}`}>中频</Tag>
        return <Tag title={`下单次数：${orderCount}`}>低频</Tag>
      }
    },
    {
      title: '操作',
      key: 'action',
      width: 120,
      align: 'center',
      render: (_, record) => (
        <Space size="small">
          <Button
            type="link"
            icon={<EditOutlined />}
            onClick={() => {
              const id = String(record?.supplierId || '').trim()
              if (!id) return
              navigate(`/products/supplier-materials/${encodeURIComponent(id)}`)
            }}
          >
            编辑
          </Button>
        </Space>
      )
    }
  ]

  const customerColumns = [
    {
      title: '客户名称',
      dataIndex: 'shortName',
      key: 'shortName',
      width: 220,
      align: 'center',
      ellipsis: true,
      render: (_, record) => {
        const display = record?.shortName || record?.companyName || '-'
        return (
          <Button
            type="link"
            style={{ padding: 0, height: 'auto', fontSize: 'inherit' }}
            onClick={() => {
              const id = normalizeIdSegment(record?.id)
              if (!id) return
              navigate(`/products/customer/${encodeURIComponent(id)}`)
            }}
          >
            {display}
          </Button>
        )
      }
    },
    {
      title: '客户地址',
      dataIndex: 'address',
      key: 'address',
      width: 240,
      align: 'center',
      ellipsis: true,
      render: (v) => String(v || '').trim() || '-'
    },
    {
      title: 'SKU产品数量',
      dataIndex: 'productCount',
      key: 'productCount',
      width: 110,
      align: 'center',
      sorter: (a, b) => Number(a.productCount || 0) - Number(b.productCount || 0),
      render: (v, record) => {
        const cid = normalizeIdSegment(normalizeText(record?.id))
        const override = cid ? skuCountOverrides[cid] : null
        const value = override != null ? override : v
        return Number(value || 0)
      }
    },
    {
      title: '库存产品数量',
      dataIndex: 'inventorySkuCount',
      key: 'inventorySkuCount',
      width: 140,
      align: 'center',
      sorter: (a, b) => Number(a.inventorySkuCount || 0) - Number(b.inventorySkuCount || 0),
      render: (v) => Number(v || 0)
    },
    {
      title: '订单数量',
      dataIndex: 'orderCount',
      key: 'orderCount',
      width: 110,
      align: 'center',
      defaultSortOrder: 'descend',
      sorter: (a, b) => Number(a.orderCount || 0) - Number(b.orderCount || 0),
      render: (v) => Number(v || 0)
    },
    {
      title: '状态',
      key: 'status',
      width: 110,
      align: 'center',
      render: (_, record) => {
        const orderCount = Number(record?.orderCount || 0)
        const s = pickFrequency(orderCount)
        if (s === 'high') return <Tag color="green" title={`下单次数：${orderCount}`}>高频</Tag>
        if (s === 'mid') return <Tag color="blue" title={`下单次数：${orderCount}`}>中频</Tag>
        return <Tag title={`下单次数：${orderCount}`}>低频</Tag>
      }
    }
  ]

  return (
    <div>
      <h2 className="page-title">产品管理</h2>

      <Tabs
        activeKey={activeTab}
        onChange={(k) => setActiveTab(k === 'products' ? 'products' : 'customers')}
        items={[
          {
            key: 'customers',
            label: '客户产品库',
            children: (
              <Card style={{ marginBottom: 16 }}>
                <Space wrap size={12} style={{ marginBottom: 12 }}>
                  <Input
                    placeholder="搜索客户名称"
                    value={customerKeywordInput}
                    onChange={(e) => setCustomerKeywordInput(e.target.value)}
                    onPressEnter={handleCustomerSearch}
                    allowClear
                    style={{ width: 240 }}
                  />
                  <Button icon={<SearchOutlined />} onClick={handleCustomerSearch} loading={customerLoading}>搜索</Button>
                  <Button icon={<ReloadOutlined />} onClick={loadCustomerProductStats} loading={customerLoading}>刷新</Button>
                </Space>
                <Table
                  columns={customerColumns}
                  dataSource={filteredCustomerRows}
                  loading={customerLoading}
                  style={{ fontSize: 15 }}
                  pagination={{
                    current: customerPage,
                    pageSize: customerPageSize,
                    total: filteredCustomerRows.length,
                    showSizeChanger: true,
                    showQuickJumper: true,
                    showTotal: (t) => `共 ${t} 条记录`,
                    onChange: (p, ps) => {
                      setCustomerPage(p)
                      setCustomerPageSize(ps)
                    }
                  }}
                  scroll={{ x: 1100 }}
                />
              </Card>
            )
          },
          {
            key: 'products',
            label: '供应商材质库',
            children: (
              <>
                <Card style={{ marginBottom: 16 }}>
                  <Space wrap size={12}>
                    <Input
                      placeholder="搜索供应商名称"
                      value={filters.keyword}
                      onChange={(e) => setFilters((prev) => ({ ...prev, keyword: e.target.value }))}
                      allowClear
                      style={{ width: 240 }}
                    />
                    <Select
                      placeholder="状态"
                      value={filters.status}
                      onChange={(v) => setFilters((prev) => ({ ...prev, status: v }))}
                      allowClear
                      style={{ width: 120 }}
                      options={[
                        { value: 'high', label: '高频' },
                        { value: 'mid', label: '中频' },
                        { value: 'low', label: '低频' }
                      ]}
                    />
                    <Button icon={<SearchOutlined />} onClick={() => loadSupplierMaterialLibrary(1, supplierPageSize)} loading={supplierLoading}>搜索</Button>
                    <Button icon={<ReloadOutlined />} onClick={() => loadSupplierMaterialLibrary(supplierPage, supplierPageSize)} loading={supplierLoading}>刷新</Button>
                  </Space>
                </Card>

                <Table
                  columns={supplierColumns}
                  dataSource={supplierRows}
                  loading={supplierLoading}
                  style={{ fontSize: 15 }}
                  pagination={{
                    current: supplierPage,
                    pageSize: supplierPageSize,
                    total: supplierTotal,
                    showSizeChanger: true,
                    showQuickJumper: true,
                    showTotal: (t) => `共 ${t} 条记录`,
                    onChange: (p, ps) => loadSupplierMaterialLibrary(p, ps)
                  }}
                  scroll={{ x: 960 }}
                />
              </>
            )
          }
        ]}
      />
    </div>
  )
}

export default ProductManagement
