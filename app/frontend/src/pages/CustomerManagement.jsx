import React, { useRef, useState, useEffect } from 'react'
import { Table, Card, Input, Button, Select, Space, Tag, App, Modal, Form, Tabs } from 'antd'
import { PlusOutlined, SearchOutlined, EditOutlined, DeleteOutlined, PhoneOutlined } from '@ant-design/icons'
import { useLocation, useNavigate } from 'react-router-dom'
import customerService from '../services/customerService'
import { cachedOrderAPI } from '../services/cachedAPI'
import { supplierAPI, customerAPI } from '../services/api'

const { Option } = Select

function CustomerManagement() {
  const { message } = App.useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [activeTab, setActiveTab] = useState('customers')
  const [loading, setLoading] = useState(false)
  const [customers, setCustomers] = useState([])
  const [customerPage, setCustomerPage] = useState(1)
  const [customerPageSize, setCustomerPageSize] = useState(10)
  const [customerTotal, setCustomerTotal] = useState(0)
  const [customerStats, setCustomerStats] = useState(null)
  const [customerMetrics, setCustomerMetrics] = useState({})
  const [supplierLoading, setSupplierLoading] = useState(false)
  const [suppliers, setSuppliers] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [supplierModalOpen, setSupplierModalOpen] = useState(false)
  const [editingCustomer, setEditingCustomer] = useState(null)
  const [editingSupplier, setEditingSupplier] = useState(null)
  const [form] = Form.useForm()
  const [supplierForm] = Form.useForm()
  const [searchParams, setSearchParams] = useState({
    keyword: '',
    status: ''
  })
  const [supplierSearchKeyword, setSupplierSearchKeyword] = useState('')
  const [pendingSupplierEditId, setPendingSupplierEditId] = useState('')
  const supplierEditAttemptsRef = useRef(0)

  const statusMap = {
    'active': { text: '活跃', color: 'green' },
    'inactive': { text: '非活跃', color: 'red' }
  }

  const extractPagination = (res) => {
    return res?.pagination || res?.data?.pagination || res?.data?.data?.pagination || {}
  }

  const extractList = (res) => {
    if (Array.isArray(res)) return res
    if (Array.isArray(res?.data)) return res.data
    if (Array.isArray(res?.customers)) return res.customers
    if (Array.isArray(res?.data?.customers)) return res.data.customers
    if (Array.isArray(res?.suppliers)) return res.suppliers
    if (Array.isArray(res?.data?.suppliers)) return res.data.suppliers
    if (Array.isArray(res?.orders)) return res.orders
    if (Array.isArray(res?.data?.orders)) return res.data.orders
    if (Array.isArray(res?.list)) return res.list
    if (Array.isArray(res?.data?.list)) return res.data.list
    return []
  }

  const fetchAllPages = async (fn, baseParams, options = {}) => {
    const pageKey = options.pageKey || 'page'
    const sizeKey = options.sizeKey || 'limit'
    const pageSize = Number(options.pageSize || 200)
    const maxPages = Number(options.maxPages || 5000)
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

  const getFrequencyStars = (frequency) => {
    return Array.from({ length: 5 }, (_, index) => (
      <span key={index} style={{ color: index < frequency ? '#ffd700' : '#ddd' }}>
        {index < frequency ? '★' : '☆'}
      </span>
    ))
  }

  const normalizeIdSegment = (v) => {
    const s = String(v == null ? '' : v).trim()
    if (!s) return ''
    const parts = s.split(/[\\/]/).filter(Boolean)
    return parts.length ? parts[parts.length - 1] : s
  }

  const isUuidLike = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || '').trim())

  const extractErrorMessage = (error) => {
    const direct = error?.response?.data?.message || error?.response?.data?.error || error?.message
    return String(direct || '').trim()
  }

  const resolveCustomerId = (record) => {
    const id = record?._id ?? record?.id ?? record?.key
    return normalizeIdSegment(id)
  }

  const extractOrders = (res) => {
    if (Array.isArray(res)) return res
    if (Array.isArray(res?.orders)) return res.orders
    if (Array.isArray(res?.data?.orders)) return res.data.orders
    if (Array.isArray(res?.data?.data?.orders)) return res.data.data.orders
    if (Array.isArray(res?.data)) return res.data
    return []
  }

  const extractOrderSkuKeys = (o) => {
    const normalizeText = (v) => String(v == null ? '' : v).trim()
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
    const normalizeText = (v) => String(v == null ? '' : v).trim()
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

  const customerMetricsInflightRef = useRef(false)
  const customerMetricsSigRef = useRef('')

  const loadCustomerOrderAndInventoryMetrics = async (rows) => {
    if (customerMetricsInflightRef.current) return
    const list = Array.isArray(rows) ? rows : []
    const ids = list.map(resolveCustomerId).filter(Boolean)
    const sig = ids.join('|')
    if (!sig) {
      setCustomerMetrics({})
      customerMetricsSigRef.current = ''
      return
    }
    if (sig === customerMetricsSigRef.current) return

    customerMetricsInflightRef.current = true
    customerMetricsSigRef.current = sig
    try {
      const normalizeText = (v) => String(v == null ? '' : v).trim()
      const idSet = new Set(ids)

      const nameToId = new Map()
      list.forEach((c) => {
        const id = resolveCustomerId(c)
        if (!id) return
        const companyName = normalizeText(c?.companyName ?? c?.name ?? c?.company ?? c?.customerName)
        const shortName = normalizeText(c?.shortName)
        const name = normalizeText(c?.name)
        ;[companyName, shortName, name].filter(Boolean).forEach((n) => nameToId.set(n, id))
      })

      const allOrders = await cachedOrderAPI.getAllOrders().catch(() => null)
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
        if (!customerId || !idSet.has(customerId)) return

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

        if (!isPurchase && computeOrderInventoryQty(o) > 0) {
          const skuKeys = extractOrderSkuKeys(o)
          skuKeys.forEach((k) => bucket.inventorySkus.add(k))
        }
      })

      const next = {}
      ids.forEach((id) => {
        const m = agg.get(id)
        next[id] = {
          orderCount: m ? m.orderCount : 0,
          inventorySkuCount: m ? m.inventorySkus.size : 0
        }
      })
      setCustomerMetrics(next)
    } catch (_) {
      setCustomerMetrics({})
    } finally {
      customerMetricsInflightRef.current = false
    }
  }

  const confirmDeleteCustomer = (record) => {
    const usedId = resolveCustomerId(record)
    if (!usedId) {
      message.error('缺少客户ID')
      return
    }
    const displayName = record?.name || record?.companyName || record?.company || '-'
    Modal.confirm({
      title: '确认删除客户？',
      content: `客户：${displayName}`,
      okText: '删除',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await customerService.deleteCustomer(usedId)
          message.success('客户已删除')
          const nextPage = customers.length <= 1 && customerPage > 1 ? customerPage - 1 : customerPage
          await loadCustomers(nextPage, customerPageSize)
          await loadCustomerStats()
        } catch (e) {
          const detail = extractErrorMessage(e)
          message.error(`删除客户失败${detail ? `：${detail}` : ''}`)
          throw e
        }
      }
    })
  }

  const columns = [
    {
      title: '客户名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      ellipsis: true,
      render: (text, record) => {
        const id = record?._id ?? record?.id
        const usedId = normalizeIdSegment(id)
        const display =
          text ||
          record?.companyName ||
          record?.company_name ||
          record?.customerName ||
          record?.customer_name ||
          record?.name ||
          record?.company ||
          record?.data?.companyName ||
          record?.data?.company_name ||
          record?.data?.customerName ||
          record?.data?.customer_name ||
          record?.data?.name ||
          record?.data?.company ||
          record?.meta?.companyName ||
          record?.meta?.company_name ||
          record?.meta?.customerName ||
          record?.meta?.customer_name ||
          record?.meta?.name ||
          record?.meta?.company ||
          '-'
        return (
          <Button
            type="link"
            onClick={() => {
              if (!usedId) return
              navigate(`/customers/${encodeURIComponent(usedId)}?tab=products`)
            }}
            style={{ padding: 0, height: 'auto' }}
          >
            {display}
          </Button>
        )
      }
    },
    {
      title: '客户简称',
      dataIndex: 'shortName',
      key: 'shortName',
      width: 120,
      ellipsis: true,
      render: (text) => text || '-'
    },
    {
      title: '结款方式',
      dataIndex: 'paymentTerms',
      key: 'paymentTerms',
      width: 120,
      ellipsis: true,
      render: (text) => text || '-'
    },
    {
      title: '联系人',
      dataIndex: 'contact',
      key: 'contact',
      width: 100
    },
    {
      title: '联系电话',
      dataIndex: 'phone',
      key: 'phone',
      width: 130,
      render: (phone) => (
        <Space>
          <PhoneOutlined />
          {phone}
        </Space>
      )
    },
    {
      title: '邮箱',
      dataIndex: 'email',
      key: 'email',
      width: 150,
      ellipsis: true,
      render: (email) => email || '-'
    },
    {
      title: '地址',
      dataIndex: 'address',
      key: 'address',
      width: 200,
      ellipsis: true,
      render: (address) => address || '-'
    },
    {
      title: '库存产品数量',
      key: 'inventorySkuCount',
      width: 120,
      align: 'center',
      render: (_, record) => {
        const cid = resolveCustomerId(record)
        const v = cid ? customerMetrics?.[cid]?.inventorySkuCount : null
        return Number(v ?? 0)
      }
    },
    {
      title: '订单数量',
      key: 'orderCount',
      width: 100,
      align: 'center',
      render: (_, record) => {
        const cid = resolveCustomerId(record)
        const v = cid ? customerMetrics?.[cid]?.orderCount : null
        const fallback = Number(record?.orderCount ?? record?.ordersCount ?? 0)
        return Number(v ?? fallback ?? 0)
      }
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (status) => (
        <Tag color={statusMap[status]?.color}>
          {statusMap[status]?.text}
        </Tag>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 180,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Button 
            type="link" 
            icon={<EditOutlined />}
            size="small"
            onClick={() => openEditModal(record)}
          >
            编辑
          </Button>
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            size="small"
            onClick={() => confirmDeleteCustomer(record)}
          >
            删除
          </Button>
        </Space>
      )
    }
  ]

  const supplierColumns = [
    {
      title: '供应商名称',
      dataIndex: 'name',
      key: 'name',
      width: 200,
      ellipsis: true
    },
    {
      title: '供应商简称',
      dataIndex: 'shortName',
      key: 'shortName',
      width: 120,
      ellipsis: true,
      render: (text) => text || '-'
    },
    {
      title: '联系人',
      dataIndex: 'contactName',
      key: 'contactName',
      width: 100
    },
    {
      title: '联系电话',
      dataIndex: 'phone',
      key: 'phone',
      width: 130,
      render: (phone) => (
        <Space>
          <PhoneOutlined />
          {phone}
        </Space>
      )
    },
    {
      title: '行业',
      dataIndex: 'industry',
      key: 'industry',
      width: 120,
      ellipsis: true,
      render: (text) => String(text || '').trim() || '-'
    },
    {
      title: '地址',
      dataIndex: 'address',
      key: 'address',
      width: 220,
      ellipsis: true,
      render: (text) => String(text || '').trim() || '-'
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 80,
      render: (status) => (
        <Tag color={statusMap[status]?.color}>
          {statusMap[status]?.text}
        </Tag>
      )
    },
    {
      title: '操作',
      key: 'action',
      width: 150,
      fixed: 'right',
      render: (_, record) => (
        <Space size="small">
          <Button 
            type="link" 
            icon={<EditOutlined />}
            size="small"
            onClick={() => openSupplierEditModal(record)}
          >
            编辑
          </Button>
        </Space>
      )
    }
  ]

  // 加载客户数据
  const loadCustomers = async (pageArg = customerPage, pageSizeArg = customerPageSize) => {
    setLoading(true)
    try {
      const wantedPage = Number(pageArg || 1)
      const wantedPageSize = Number(pageSizeArg || 10)
      const params = {
        ...(searchParams || {})
      }
      if (!params.keyword || !String(params.keyword).trim()) delete params.keyword
      if (!params.status || !String(params.status).trim()) delete params.status
      if (params.keyword) params._ts = Date.now()

      const normalizeText = (v) => String(v == null ? '' : v).trim()
      const pickNonEmptyText = (...vals) => {
        for (const v of vals) {
          const s = normalizeText(v)
          if (s) return s
        }
        return ''
      }

      const normalize = (customer, index) => ({
        ...customer,
        name: pickNonEmptyText(
          customer.companyName,
          customer.company_name,
          customer.customerName,
          customer.customer_name,
          customer.name,
          customer.company,
          customer?.data?.companyName,
          customer?.data?.company_name,
          customer?.data?.customerName,
          customer?.data?.customer_name,
          customer?.data?.name,
          customer?.data?.company,
          customer?.meta?.companyName,
          customer?.meta?.company_name,
          customer?.meta?.customerName,
          customer?.meta?.customer_name,
          customer?.meta?.name,
          customer?.meta?.company
        ),
        contact: customer.contact ?? customer.contactName,
        key: customer._id ?? customer.id ?? `customer_${index}`,
        totalAmount: customer.totalAmount ?? customer.totalAmountSum ?? 0,
        orderCount: customer.orderCount ?? customer.ordersCount ?? 0,
        createdAt: customer.createdAt ?? customer.createTime ?? null
      })

      const rawKeyword = String(params.keyword || '').trim()
      const keywordId = normalizeIdSegment(rawKeyword)
      if (rawKeyword && isUuidLike(keywordId)) {
        try {
          const candidateIds = [
            keywordId,
            `customers/${keywordId}`,
            `customers\\${keywordId}`
          ]
          for (const cid of candidateIds) {
            const detailRes = await customerAPI.getCustomer(cid)
            const payload = detailRes?.data
            const customer =
              payload?.data?.customer ||
              payload?.customer ||
              payload?.data?.data?.customer ||
              null
            if (customer) {
              const normalized = normalize(customer)
              setCustomers([normalized])
              setCustomerPage(1)
              setCustomerPageSize(wantedPageSize)
              setCustomerTotal(1)
              return
            }
          }
        } catch (_) { void 0 }
        const baseParams = { ...(params || {}) }
        delete baseParams.keyword
        baseParams._ts = Date.now()
        const all = await fetchAllPages(
          customerService.getCustomers,
          baseParams,
          { pageKey: 'page', sizeKey: 'limit', pageSize: 200, maxPages: 5000 }
        )
        const matched = all
          .filter((c) => {
            const cid = normalizeIdSegment(c?._id ?? c?.id ?? c?.key)
            if (cid && cid === keywordId) return true
            const raw = String(c?._id ?? c?.id ?? '').trim()
            if (raw && raw.includes(keywordId)) return true
            return false
          })
          .map(normalize)
        setCustomers(matched)
        setCustomerPage(1)
        setCustomerPageSize(wantedPageSize)
        setCustomerTotal(matched.length)
        return
      }

      const resp = await customerService.getCustomers({
        ...params,
        page: wantedPage,
        limit: wantedPageSize,
        pageSize: wantedPageSize
      })

      const list = extractList(resp)
      const pagination = extractPagination(resp)

      const totalFromApi = Number(pagination?.total || 0)

      if ((!list || list.length === 0) && totalFromApi > 0 && wantedPage > 1) {
        const fallbackLimit = Math.max(1000, wantedPage * wantedPageSize)
        const allResp = await customerService.getCustomers({
          ...params,
          page: 1,
          limit: fallbackLimit,
          pageSize: fallbackLimit
        })
        const allList = extractList(allResp)
        const allNormalized = allList.map(normalize)
        const start = (wantedPage - 1) * wantedPageSize
        const end = start + wantedPageSize
        setCustomers(allNormalized.slice(start, end))
        setCustomerPage(wantedPage)
        setCustomerPageSize(wantedPageSize)
        setCustomerTotal(allNormalized.length)
        return
      }

      const customerList = list.map(normalize)
      setCustomers(customerList)
      setCustomerPage(wantedPage)
      setCustomerPageSize(wantedPageSize)
      setCustomerTotal(totalFromApi || customerList.length)
    } catch (error) {
      console.error('加载客户数据失败:', error)
      message.error('加载客户数据失败')
      setCustomers([])
      setCustomerTotal(0)
    } finally {
      setLoading(false)
    }
  }

  const loadCustomerStats = async () => {
    try {
      const res = await customerService.getCustomerStats()
      const summary = res?.data?.data?.summary ?? res?.data?.summary ?? null
      setCustomerStats(summary && typeof summary === 'object' ? summary : null)
    } catch (_) {
      setCustomerStats(null)
    }
  }

  // 搜索功能
  const handleSearch = () => {
    loadCustomers(1, customerPageSize)
  }

  const handleSupplierSearch = () => {
    loadSuppliers()
  }

  // 组件加载时获取数据
  useEffect(() => {
    loadCustomers(1, customerPageSize)
    loadCustomerStats()
  }, [])

  useEffect(() => {
    loadCustomerOrderAndInventoryMetrics(customers)
  }, [customers])

  useEffect(() => {
    if (activeTab === 'suppliers' && suppliers.length === 0 && !supplierLoading) {
      loadSuppliers()
    }
  }, [activeTab, suppliers.length, supplierLoading])

  useEffect(() => {
    const nextTab = location.state?.tab
    const editSupplierId = String(location.state?.editSupplierId || '').trim()
    if (nextTab === 'suppliers') {
      setActiveTab('suppliers')
      if (editSupplierId) {
        setPendingSupplierEditId(editSupplierId)
      }
    }
  }, [location.state])

  useEffect(() => {
    const targetId = String(pendingSupplierEditId || '').trim()
    if (activeTab !== 'suppliers' || !targetId) return
    if (supplierModalOpen) return

    const found = (suppliers || []).find((s) => {
      const sid = String(s?._id ?? s?.id ?? s?.key ?? '').trim()
      return sid === targetId
    })

    if (found) {
      supplierEditAttemptsRef.current = 0
      setPendingSupplierEditId('')
      openSupplierEditModal(found)
      return
    }

    if (!supplierLoading && supplierEditAttemptsRef.current < 1) {
      supplierEditAttemptsRef.current += 1
      loadSuppliers()
      return
    }

    if (!supplierLoading) {
      supplierEditAttemptsRef.current = 0
      setPendingSupplierEditId('')
      message.error('未找到要编辑的供应商')
    }
  }, [activeTab, pendingSupplierEditId, suppliers, supplierLoading, supplierModalOpen])

  const handleSearchInput = (e) => {
    setSearchParams({...searchParams, keyword: e.target.value})
  }

  const handleStatusFilter = (value) => {
    setSearchParams({...searchParams, status: value})
  }

  const loadSuppliers = async () => {
    setSupplierLoading(true)
    try {
      const params = {}
      const rawKeyword = String(supplierSearchKeyword || '').trim()
      const keywordId = normalizeIdSegment(rawKeyword)
      if (rawKeyword && isUuidLike(keywordId)) {
        params._ts = Date.now()
        try {
          const candidateIds = [
            keywordId,
            `suppliers/${keywordId}`,
            `suppliers\\${keywordId}`
          ]
          for (const cid of candidateIds) {
            const detailRes = await supplierAPI.getSupplier(cid)
            const payload = detailRes?.data
            const supplier =
              payload?.data?.supplier ||
              payload?.supplier ||
              payload?.data?.data?.supplier ||
              null
            if (supplier) {
              const next = [{
                ...supplier,
                key: supplier?._id ?? supplier?.id ?? keywordId,
                name: supplier?.name ?? supplier?.companyName ?? supplier?.company,
                contactName: supplier?.contactName ?? supplier?.contact ?? supplier?.linkman
              }]
              setSuppliers(next)
              return
            }
          }
        } catch (_) { void 0 }

        const list = await fetchAllPages(
          supplierAPI.getSuppliers,
          { _ts: Date.now() },
          { pageKey: 'page', sizeKey: 'limit', pageSize: 200, maxPages: 5000 }
        )
        const matched = list.filter((s) => {
          const sid = normalizeIdSegment(s?._id ?? s?.id ?? s?.key)
          if (sid && sid === keywordId) return true
          const raw = String(s?._id ?? s?.id ?? '').trim()
          if (raw && raw.includes(keywordId)) return true
          return false
        })
        const next = matched.map((s, index) => ({
          ...s,
          key: s._id ?? s.id ?? `supplier_${index}`,
          name: s.name ?? s.companyName ?? s.company,
          contactName: s.contactName ?? s.contact ?? s.linkman
        }))
        setSuppliers(next)
        return
      }

      if (rawKeyword) {
        params.keyword = rawKeyword
      }

      const list = await fetchAllPages(
        supplierAPI.getSuppliers,
        params,
        { pageKey: 'page', sizeKey: 'limit', pageSize: 200, maxPages: 5000 }
      )
      const next = list.map((s, index) => ({
        ...s,
        key: s._id ?? s.id ?? `supplier_${index}`,
        name: s.name ?? s.companyName ?? s.company,
        contactName: s.contactName ?? s.contact ?? s.linkman
      }))
      setSuppliers(next)
    } catch (error) {
      message.error('加载供应商数据失败')
      setSuppliers([])
    } finally {
      setSupplierLoading(false)
    }
  }

  const openCreateModal = () => {
    setEditingCustomer(null)
    setModalOpen(true)
    form.resetFields()
  }

  const openEditModal = (record) => {
    setEditingCustomer(record)
    setModalOpen(true)
    form.setFieldsValue({
      name: record.name,
      shortName: record.shortName,
      paymentTerms: record.paymentTerms,
      contact: record.contact,
      phone: record.phone,
      email: record.email,
      address: record.address,
      status: record.status || 'active'
    })
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      const payload = {
        companyName: values.name,
        shortName: values.shortName,
        paymentTerms: values.paymentTerms,
        contactName: values.contact,
        phone: values.phone,
        email: values.email,
        address: values.address,
        status: values.status || 'active'
      }
      if (editingCustomer && (editingCustomer._id || editingCustomer.key)) {
        const id = editingCustomer._id || editingCustomer.key
        await customerService.updateCustomer(id, payload)
        message.success('客户信息已更新')
      } else {
        await customerService.createCustomer(payload)
        message.success('客户已新增')
      }
      setModalOpen(false)
      setEditingCustomer(null)
      form.resetFields()
      loadCustomers()
      loadCustomerStats()
    } catch (error) {
      message.error('提交失败')
    }
  }

  const handleCancel = () => {
    setModalOpen(false)
    setEditingCustomer(null)
  }

  const openSupplierEditModal = (record) => {
    setEditingSupplier(record)
    const address = record?.address ?? record?.companyAddress ?? record?.company_address ?? record?.addr ?? ''
    supplierForm.setFieldsValue({
      name: record.name,
      shortName: record.shortName,
      contactName: record.contactName,
      phone: record.phone,
      industry: record.industry,
      address
    })
    setSupplierModalOpen(true)
  }

  const handleSupplierSubmit = async () => {
    try {
      const values = await supplierForm.validateFields()
      const payload = {
        name: values.name,
        shortName: values.shortName,
        contactName: values.contactName,
        phone: values.phone,
        industry: values.industry || '',
        address: values.address || ''
      }
      
      if (editingSupplier && (editingSupplier._id || editingSupplier.key)) {
        const id = editingSupplier._id || editingSupplier.key
        await supplierAPI.updateSupplier(id, payload)
        message.success('供应商信息已更新')
      } else {
        await supplierAPI.createSupplier(payload)
        message.success('供应商已新增')
      }

      setSupplierModalOpen(false)
      setEditingSupplier(null)
      supplierForm.resetFields()
      loadSuppliers()
    } catch (error) {
      message.error('提交失败')
    }
  }

  const handleSupplierCancel = () => {
    setSupplierModalOpen(false)
    setEditingSupplier(null)
    supplierForm.resetFields()
  }

  return (
    <div>
      <h2 className="page-title">客户管理</h2>

      <Tabs
        activeKey={activeTab}
        onChange={setActiveTab}
        items={[
          { key: 'customers', label: '客户' },
          { key: 'suppliers', label: '供应商' }
        ]}
        style={{ marginBottom: 16 }}
      />

      {activeTab === 'customers' && (
        <>
          <div style={{ display: 'flex', gap: 16, marginBottom: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
            <Card className="stats-card" style={{ width: 160, height: 160, background: '#7F7FD5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
              <div className="stats-value">{customerStats?.totalCustomers ?? customerTotal ?? customers.length}</div>
              <div className="stats-label">客户总数</div>
            </Card>
            <Card className="stats-card" style={{ width: 160, height: 160, background: '#4caf50', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
              <div className="stats-value">{customerStats?.activeCustomers ?? customers.filter(c => c.status === 'active').length}</div>
              <div className="stats-label">活跃客户</div>
            </Card>
            <Card className="stats-card" style={{ width: 160, height: 160, background: '#42a5f5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
              <div className="stats-value">{
                (() => {
                  const year = new Date().getFullYear()
                  const count = customers.filter(c => {
                    const src = c.createdAt ?? c.lastOrderDate
                    if (!src) return false
                    const d = typeof src === 'number' ? new Date(src) : new Date(src)
                    return !isNaN(d) && d.getFullYear() === year
                  }).length
                  return count
                })()
              }</div>
              <div className="stats-label">新增客户(全年)</div>
            </Card>
            <Card className="stats-card" style={{ width: 160, height: 160, background: '#ff8a65', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
              <div className="stats-value">{
                (() => {
                  const sixMonths = 1000 * 60 * 60 * 24 * 180
                  const now = Date.now()
                  const count = customers.filter(c => {
                    const src = c.lastOrderDate ?? c.lastPurchaseDate ?? c.updatedAt ?? c.createdAt
                    if (!src) return true
                    const d = typeof src === 'number' ? new Date(src) : new Date(src)
                    if (isNaN(d)) return true
                    return now - d.getTime() > sixMonths
                  }).length
                  return count
                })()
              }</div>
              <div className="stats-label">呆滞客户</div>
            </Card>
          </div>

          <Card style={{ marginBottom: 24 }}>
            <Space size={24} style={{ marginBottom: 24 }}>
              <Input 
                placeholder="搜索客户名称、联系人、电话"
                value={searchParams.keyword}
                onChange={handleSearchInput}
                onPressEnter={handleSearch}
                style={{ width: 250 }}
                allowClear
              />
              <Select 
                placeholder="客户状态"
                value={searchParams.status}
                onChange={handleStatusFilter}
                style={{ width: 120 }}
                allowClear
              >
                <Option value="active">活跃</Option>
                <Option value="inactive">非活跃</Option>
              </Select>
              <Button 
                type="primary" 
                icon={<SearchOutlined />}
                onClick={handleSearch}
                loading={loading}
              >
                搜索
              </Button>
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={openCreateModal}
              >
                新增客户
              </Button>
            </Space>
          </Card>

          <Table
            columns={columns}
            dataSource={customers}
            loading={loading}
            pagination={{
              current: customerPage,
              total: customerTotal,
              pageSize: customerPageSize,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total) => `共 ${total} 条记录`,
              onChange: (page, pageSize) => {
                loadCustomers(page, pageSize)
              }
            }}
            scroll={{ x: 1400 }}
          />

          <Modal
            title={editingCustomer ? '编辑客户' : '新增客户'}
            open={modalOpen}
            onOk={handleSubmit}
            onCancel={handleCancel}
            forceRender
          >
            <Form form={form} layout="vertical">
              <Form.Item name="name" label="客户名称" rules={[{ required: true, message: '请输入客户名称' }]}> 
                <Input placeholder="请输入客户名称" />
              </Form.Item>
              <Form.Item name="shortName" label="客户简称" rules={[{ required: true, message: '请输入客户简称' }]}>
                <Input placeholder="请输入客户简称" />
              </Form.Item>
              <Form.Item name="paymentTerms" label="结款方式">
                <Select placeholder="请选择结款方式">
                  <Option value="现结">现结</Option>
                  <Option value="月结30天">月结30天</Option>
                  <Option value="月结60天">月结60天</Option>
                  <Option value="月结90天">月结90天</Option>
                  <Option value="月结105天">月结105天</Option>
                </Select>
              </Form.Item>
              <Form.Item name="contact" label="联系人" rules={[{ required: true, message: '请输入联系人' }]}>
                <Input placeholder="请输入联系人" />
              </Form.Item>
              <Form.Item name="phone" label="联系电话">
                <Input placeholder="请输入联系电话" />
              </Form.Item>
              <Form.Item name="email" label="邮箱">
                <Input placeholder="请输入邮箱" />
              </Form.Item>
              <Form.Item name="address" label="地址">
                <Input placeholder="请输入地址" />
              </Form.Item>
              <Form.Item name="status" label="状态" initialValue="active">
                <Select options={[{ value: 'active', label: '活跃' }, { value: 'inactive', label: '非活跃' }]} />
              </Form.Item>
            </Form>
          </Modal>
        </>
      )}

      {activeTab === 'suppliers' && (
        <>
          <Card style={{ marginBottom: 24 }}>
            <Space size={24} style={{ marginBottom: 24 }}>
              <Input 
                placeholder="搜索供应商名称、联系人、电话"
                value={supplierSearchKeyword}
                onChange={(e) => setSupplierSearchKeyword(e.target.value)}
                onPressEnter={handleSupplierSearch}
                style={{ width: 250 }}
                allowClear
              />
              <Button 
                type="primary" 
                icon={<SearchOutlined />}
                onClick={handleSupplierSearch}
                loading={supplierLoading}
              >
                搜索
              </Button>
              <Button 
                type="primary" 
                icon={<PlusOutlined />}
                onClick={() => {
                  supplierForm.resetFields()
                  setSupplierModalOpen(true)
                }}
              >
                新增供应商
              </Button>
            </Space>
          </Card>

          <Table
            columns={supplierColumns}
            dataSource={suppliers}
            loading={supplierLoading}
            pagination={{
              total: suppliers.length,
              pageSize: 10,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (total) => `共 ${total} 条记录`
            }}
            scroll={{ x: 800 }}
          />

          <Modal
            title={editingSupplier ? "编辑供应商" : "新增供应商"}
            open={supplierModalOpen}
            onOk={handleSupplierSubmit}
            onCancel={handleSupplierCancel}
            forceRender
          >
            <Form form={supplierForm} layout="vertical">
              <Form.Item name="name" label="供应商名称" rules={[{ required: true, message: '请输入供应商名称' }]}> 
                <Input placeholder="请输入供应商名称" />
              </Form.Item>
              <Form.Item name="shortName" label="供应商简称" rules={[{ required: true, message: '请输入供应商简称' }]}>
                <Input placeholder="请输入供应商简称" />
              </Form.Item>
              <Form.Item name="contactName" label="联系人">
                <Input placeholder="请输入联系人" />
              </Form.Item>
              <Form.Item name="phone" label="联系电话">
                <Input placeholder="请输入联系电话" />
              </Form.Item>
              <Form.Item name="industry" label="行业">
                <Input placeholder="请输入行业" />
              </Form.Item>
              <Form.Item name="address" label="地址">
                <Input placeholder="请输入地址" />
              </Form.Item>
            </Form>
          </Modal>
        </>
      )}
    </div>
  )
}

export default CustomerManagement
