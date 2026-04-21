import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Table, Card, Input, Button, Select, Space, App, Modal, Form, AutoComplete, Tabs, DatePicker, ConfigProvider, Tag } from 'antd'
import { PlusOutlined, SearchOutlined, ReloadOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { purchaseAPI, supplierAPI } from '../services/api'
import { cachedPurchaseAPI, cachedCustomerAPI } from '../services/cachedAPI'
import { extractListFromResponse, extractPaginationFromResponse } from '../utils'
import { useAuthStore } from '@/stores/authStore'
import zhCN from 'antd/locale/zh_CN'
import { useLocation, useNavigate } from 'react-router-dom'

const { Option } = Select

function PurchaseManagement() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const { isAuthenticated } = useAuthStore()
  const [loading, setLoading] = useState(false)
  const [orders, setOrders] = useState([])
  const [suppliers, setSuppliers] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editingOrder, setEditingOrder] = useState(null)
  const [form] = Form.useForm()
  const [searchParams, setSearchParams] = useState({ keyword: '', supplier: undefined })
  const [sortField, setSortField] = useState('createdAt')
  const [sortDir, setSortDir] = useState('desc')
  const [viewType, setViewType] = useState('boards')
  const tabItems = useMemo(() => ([
    { key: 'boards', label: '纸板采购' },
    { key: 'goods', label: '商品采购' },
    { key: 'raw_materials', label: '辅材采购' }
  ]), [])
  const unitOptions = useMemo(() => (
    ['公斤','片','只','个','套','米','卷','根'].map(u => ({ label: u, value: u }))
  ), [])
  const [reservedId, setReservedId] = useState()
  const [customers, setCustomers] = useState([])
  const [customersLoading, setCustomersLoading] = useState(false)
  const customerSearchRef = useRef({ timer: null, seq: 0 })
  const [datePreset, setDatePreset] = useState()
  const [dateRange, setDateRange] = useState()

  const normalizePurchaseCategory = (raw, fallback, isPurchase) => {
    const s = String(raw ?? '').trim().toLowerCase()
    const f = String(fallback ?? '').trim().toLowerCase()
    const base = s || f || (isPurchase ? 'goods' : '')
    if (!base) return ''
    if (base === 'boards' || base === 'goods' || base === 'raw_materials') return base
    if (base === 'board' || base === '纸板' || base.includes('纸板')) return 'boards'
    if (base === 'raw' || base === 'materials' || base === 'raw_material' || base.includes('辅材') || base.includes('原材料') || base.includes('物料')) return 'raw_materials'
    if (base.includes('goods') || base.includes('商品')) return 'goods'
    return f || (isPurchase ? 'goods' : '')
  }

  useEffect(() => {
    const next = location.state?.viewType
    if (next === 'boards' || next === 'goods' || next === 'raw_materials') {
      setViewType(next)
    }
  }, [location.state])

  const extractPagination = (res) => {
    return extractPaginationFromResponse(res)
  }

  const extractList = (res) => {
    return extractListFromResponse(res)
  }

  const fetchAllPages = async (fn, baseParams, options = {}) => {
    const pageKey = options.pageKey || 'page'
    const sizeKey = options.sizeKey || 'pageSize'
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
      if (!rows.length || rows.length < pageSize) break
    }
    return all
  }

  const loadMeta = async () => {
    try {
      const res = await supplierAPI.getSuppliers({ page: 1, pageSize: 200 })
      const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []
      setSuppliers(list)
    } catch (e) {
      setSuppliers([])
    }
    try {
      const resC = await cachedCustomerAPI.getCustomers({ page: 1, pageSize: 200 })
      const listC = Array.isArray(resC) ? resC : Array.isArray(resC?.data) ? resC.data : Array.isArray(resC?.customers) ? resC.customers : Array.isArray(resC?.data?.customers) ? resC.data.customers : []
      setCustomers(listC)
    } catch (_) {
      setCustomers([])
    }
  }

  const mergeCustomerList = (prevList, newList) => {
    const prevArr = Array.isArray(prevList) ? prevList : []
    const nextArr = Array.isArray(newList) ? newList : []
    const nextById = new Map()
    nextArr.forEach((c) => {
      const id = String(c?._id ?? c?.id ?? '').trim()
      if (!id) return
      nextById.set(id, c)
    })
    const out = []
    const seen = new Set()
    nextArr.forEach((c) => {
      const id = String(c?._id ?? c?.id ?? '').trim()
      if (!id || seen.has(id)) return
      seen.add(id)
      out.push(c)
    })
    prevArr.forEach((c) => {
      const id = String(c?._id ?? c?.id ?? '').trim()
      if (!id || seen.has(id)) return
      seen.add(id)
      out.push(nextById.get(id) || c)
    })
    return out
  }

  const normalizeCustomersResp = (resC) => {
    const listC = Array.isArray(resC)
      ? resC
      : Array.isArray(resC?.customers)
        ? resC.customers
        : Array.isArray(resC?.data?.customers)
          ? resC.data.customers
          : Array.isArray(resC?.data)
            ? resC.data
            : Array.isArray(resC?.data?.data?.customers)
              ? resC.data.data.customers
              : []
    return listC
  }

  const remoteSearchCustomers = (raw) => {
    const kw = String(raw ?? '').trim()
    if (customerSearchRef.current.timer) {
      clearTimeout(customerSearchRef.current.timer)
      customerSearchRef.current.timer = null
    }
    if (!kw) return
    const seq = (customerSearchRef.current.seq || 0) + 1
    customerSearchRef.current.seq = seq
    customerSearchRef.current.timer = setTimeout(async () => {
      setCustomersLoading(true)
      try {
        const resp = await cachedCustomerAPI.getCustomers({ page: 1, pageSize: 50, limit: 50, keyword: kw, _ts: Date.now() })
        const list = normalizeCustomersResp(resp)
        if (customerSearchRef.current.seq !== seq) return
        setCustomers((prev) => mergeCustomerList(prev, list))
      } catch (_) {
        void 0
      } finally {
        if (customerSearchRef.current.seq === seq) setCustomersLoading(false)
      }
    }, 250)
  }

  const loadOrders = async () => {
    setLoading(true)
    try {
      const serverCategory = viewType === 'goods' ? undefined : viewType
      const res = await cachedPurchaseAPI.getPurchaseOrders({
        page: 1,
        pageSize: 100,
        withTotal: false,
        withProducts: false,
        ...(serverCategory ? { category: serverCategory } : {}),
        _ts: Date.now()
      })
      const data = extractList(res)
      const listCloudRaw = (data || []).map((o, idx) => {
        const srcOrderType = String(o?.orderType || '').toLowerCase()
        const srcSource = String(o?.source || '').toLowerCase()
        const hasPurchaseCategory = o?.purchaseCategory != null && String(o.purchaseCategory) !== ''
        const hasCategory = o?.category != null && String(o.category) !== ''
        const hasLegacyCategory = o?.purchase_category != null && String(o.purchase_category) !== ''
        const supplierNameCandidate = o?.supplierName ?? o?.supplier?.name ?? o?.supplier ?? ''
        const hasSupplier = Boolean(String(supplierNameCandidate || '').trim()) ||
          Boolean(o?.supplierId || o?.supplier_id || o?.supplier?._id || o?.supplier?.id)
        const isPurchase = srcOrderType === 'purchase' || srcSource === 'purchased' || hasPurchaseCategory || hasCategory || hasLegacyCategory || hasSupplier
        const rawCategory = String(o?.purchaseCategory ?? o?.category ?? o?.purchase_category ?? '').toLowerCase()
        const normalizedCategory = normalizePurchaseCategory(rawCategory, viewType, isPurchase)

        // 状态归一化
        let normalizedStatus = o.status || 'ordered'
        const statusMap = {
          '已下单': 'ordered',
          '采购中': 'processing',
          '已入库': 'stocked',
          '已完成': 'completed',
          '已取消': 'cancelled',
          'ordered': 'ordered',
          'processing': 'processing',
          'stocked': 'stocked',
          'completed': 'completed',
          'cancelled': 'cancelled'
        }
        if (statusMap[normalizedStatus]) {
          normalizedStatus = statusMap[normalizedStatus]
        }
        const hasStockedInfo =
          Number(o.stockedQty || 0) > 0 ||
          Boolean(o.stockedAt) ||
          Boolean(o.stockTime)
        if (
          hasStockedInfo &&
          normalizedStatus !== 'cancelled' &&
          normalizedStatus !== 'completed' &&
          normalizedStatus !== 'stocked'
        ) {
          normalizedStatus = 'stocked'
        }
        
        return {
        ...o,
        key: o._id ?? o.id ?? o.docId ?? o.orderId ?? o.order_id ?? `po_${idx}`,
        source: srcSource,
        orderType: srcOrderType,
        category: normalizedCategory,
        isPurchase,
        orderNo: o.orderNo ?? o.orderNumber ?? '',
        customerName: o.customerName ?? o.customer?.name ?? o.customer ?? '',
        supplierName: o.supplierName ?? o.supplier?.name ?? o.supplier ?? '',
        goodsName: (() => {
          const items = Array.isArray(o.items) ? o.items : []
          const first = items[0] || {}
          return o.goodsName || o.productTitle || first.goodsName || first.title || first.productName || o.title || '-'
        })(),
        materialNo: o.materialNo ?? (o.items && o.items[0] && o.items[0].materialNo) ?? undefined,
        quantity: o.quantity ?? o.totalQty ?? (Array.isArray(o.items) ? o.items.reduce((s, it) => s + (Number(it.quantity)||0), 0) : 0),
        unit: o.unit ?? ((Array.isArray(o.items) && o.items[0] && o.items[0].unit) ? o.items[0].unit : '片'),
        unitPrice: Number(o.unitPrice || 0),
        salePrice: Number(o.salePrice || 0),
        amount: (() => {
          const raw = Number(o.amount || o.totalAmount || o.finalAmount || 0)
          if (raw) return raw
          const boardItemsTotal = (() => {
            const items = Array.isArray(o.items) ? o.items : []
            if (!items.length) return 0
            const sum = items.reduce((s, it) => s + (Number(it?.amount) || 0), 0)
            return Number.isFinite(sum) && sum > 0 ? sum : 0
          })()
          if (String(o.purchaseCategory || o.category || '').toLowerCase() === 'boards' && boardItemsTotal > 0) return boardItemsTotal
          const price = Number(o.salePrice || 0)
          const qty = Number(o.quantity || 0)
          const computed = price * qty
          if (computed) return computed
          return 0
        })(),
        stockedQty: Number(o.stockedQty || 0),
        stockedAtText: (o.stockedAt || o.stockTime) ? dayjs(o.stockedAt || o.stockTime).format('YYYY-MM-DD HH:mm') : '',
        stockedAtTs: (() => {
          const src = o.stockedAt || o.stockTime || ''
          return (src && dayjs(src).isValid()) ? dayjs(src).valueOf() : 0
        })(),
        updatedAtTs: (() => {
          const src = o.updatedAt || o.updateTime || ''
          return (src && dayjs(src).isValid()) ? dayjs(src).valueOf() : 0
        })(),
        status: normalizedStatus, // 使用归一化后的状态
        createdAtText: (() => {
          const src = o.createdAt || o.createTime
          return (src && dayjs(src).isValid()) ? dayjs(src).format('YYYY-MM-DD HH:mm') : ''
        })(),
        createdAtTs: (() => {
          const src = o.createdAt || o.createTime
          return (src && dayjs(src).isValid()) ? dayjs(src).valueOf() : 0
        })()
      }})
      setOrders(
        listCloudRaw
          .filter(x => x.isPurchase)
          .filter((o) => {
            const deletedFlag =
              Boolean(o?.isDeleted || o?.is_deleted || o?.deletedAt || o?.deleted_at || o?.deletedBy || o?.deleted_by) ||
              String(o?.deleted || '').toLowerCase() === 'true'
            return !deletedFlag
          })
      )
    } catch (error) {
      try { if (error?.response?.status === 401) { message.warning('请先登录'); navigate('/login') } } catch { void 0 }
      try {
        if (Number(error?.response?.status) === 504) {
          message.error('云函数请求超时，请稍后重试或缩小筛选范围')
        } else {
          const msg = error?.response?.data?.message || error?.message || '加载采购单失败'
          message.error(msg)
        }
      } catch { void 0 }
      setOrders([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!isAuthenticated) { navigate('/login'); return }
    loadMeta(); loadOrders()
  }, [isAuthenticated, viewType])

  useEffect(() => {
    return () => {
      customerSearchRef.current.seq = (customerSearchRef.current.seq || 0) + 1
      if (customerSearchRef.current.timer) {
        clearTimeout(customerSearchRef.current.timer)
        customerSearchRef.current.timer = null
      }
    }
  }, [])

  useEffect(() => {
    if (!isAuthenticated) return
    let timer = null
    const trigger = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        loadOrders()
      }, 300)
    }
    const onStorage = (e) => {
      if (!e) return
      if (e.key === 'erp_orders_changed_at') trigger()
    }
    try { window.addEventListener('storage', onStorage) } catch (_) { void 0 }
    try { window.addEventListener('erp:ordersChanged', trigger) } catch (_) { void 0 }
    return () => {
      if (timer) clearTimeout(timer)
      try { window.removeEventListener('storage', onStorage) } catch (_) { void 0 }
      try { window.removeEventListener('erp:ordersChanged', trigger) } catch (_) { void 0 }
    }
  }, [isAuthenticated, viewType])

  const stats = useMemo(() => {
    const base = orders.filter(o => o.category === viewType)
    const total = base.length
    const inbound = base.filter(o => Number(o.stockedQty||0) > 0).length
    const totalAmount = base.reduce((s, o) => s + Number(o.amount || 0), 0)
    const startOfMonthTs = dayjs().startOf('month').valueOf()
    const monthlyAmount = (viewType === 'boards')
      ? base
        .filter(o => {
          const t =
            Number(o.createdAtTs || 0) ||
            Number(o.updatedAtTs || 0) ||
            (() => {
              const src = o.createdAt || o.createTime || o.updatedAt || o.updateTime || ''
              return (src && dayjs(src).isValid()) ? dayjs(src).valueOf() : 0
            })()
          return t >= startOfMonthTs
        })
        .reduce((s, o) => {
          const items = Array.isArray(o.items) ? o.items : []
          const sum = items.reduce((acc, it) => {
            const w = Number(it?.width ?? it?.specWidth ?? 0)
            const l = Number(it?.length ?? it?.specLength ?? 0)
            const p = Number(it?.unitPrice ?? 0)
            const d = Number(it?.deliveryQty ?? it?.deliveredQty ?? it?.stockedQty ?? 0)
            if (Number.isFinite(w) && Number.isFinite(l) && Number.isFinite(p) && Number.isFinite(d) && w > 0 && l > 0 && p > 0 && d > 0) {
              const a = p * ((w * l) / 1000000) * d
              if (Number.isFinite(a) && a > 0) return acc + a
            }
            const raw = Number(it?.amount || 0)
            if (Number.isFinite(raw) && raw > 0) return acc + raw
            return acc
          }, 0)
          return s + (Number.isFinite(sum) ? sum : 0)
        }, 0)
      : totalAmount
    const now = Date.now()
    const twoWeeksMs = 14 * 24 * 60 * 60 * 1000
    const staleCount = base.filter(o => {
      if (!['stocked', 'completed'].includes(o.status)) return false
      const t = Number(o.stockedAtTs || o.updatedAtTs || o.createdAtTs || 0)
      if (!t) return false
      return (now - t) >= twoWeeksMs
    }).length
    return { total, inbound, totalAmount, monthlyAmount, staleCount }
  }, [orders, viewType])

  const supplierOptions = useMemo(() => (suppliers||[]).map(s => {
    const value = s.name || s.companyName || s.title || s.id || s._id
    const name = s.name || s.companyName || s.title || String(value || '')
    const label = s.shortName ? `${s.shortName} (${name})` : name
    return { value, label }
  }), [suppliers])

  const filtered = useMemo(() => {
    let list = orders.filter(o => o.category === viewType)
    const { keyword, supplier } = searchParams
    if (supplier) list = list.filter(o => (o.supplierName||'') === supplier)
    // 日期预设筛选（按订单创建时间）
    if (datePreset) {
      const startEnd = (() => {
        const todayStart = dayjs().startOf('day').valueOf()
        const todayEnd = dayjs().endOf('day').valueOf()
        if (datePreset === 'today') return [todayStart, todayEnd]
        if (datePreset === 'last7') return [dayjs().subtract(7, 'day').startOf('day').valueOf(), todayEnd]
        if (datePreset === 'last30') return [dayjs().subtract(30, 'day').startOf('day').valueOf(), todayEnd]
        return [0, Number.MAX_SAFE_INTEGER]
      })()
      list = list.filter(o => o.createdAtTs && o.createdAtTs >= startEnd[0] && o.createdAtTs <= startEnd[1])
    }
    // 自定义日期区间筛选（优先于预设）
    if (dateRange && Array.isArray(dateRange) && dateRange.length === 2) {
      const [start, end] = dateRange
      const s = start ? dayjs(start).startOf('day').valueOf() : 0
      const e = end ? dayjs(end).endOf('day').valueOf() : Number.MAX_SAFE_INTEGER
      list = list.filter(o => o.createdAtTs && o.createdAtTs >= s && o.createdAtTs <= e)
    }
    if (keyword) {
      const k = keyword.trim().toLowerCase()
      list = list.filter(o => (
        String(o.orderNo||'').toLowerCase().includes(k) ||
        String(o.supplierName||'').toLowerCase().includes(k) ||
        String(o.goodsName||'').toLowerCase().includes(k) ||
        String(o.materialNo||'').toLowerCase().includes(k)
      ))
    }
    const keyGetter = (o) => {
      if (sortField === 'createdAt') return Number(o.createdAtTs || 0)
      if (sortField === 'qty') return Number(o.quantity || 0)
      if (sortField === 'amount') return Number(o.amount || 0)
      return 0
    }
    list = list.slice().sort((a, b) => {
      const av = keyGetter(a)
      const bv = keyGetter(b)
      return sortDir === 'desc' ? (bv - av) : (av - bv)
    })
    return list
  }, [orders, viewType, searchParams, sortField, sortDir, datePreset, dateRange])

  const displayed = useMemo(() => {
    if (viewType !== 'goods') return filtered
    const list = Array.isArray(filtered) ? filtered : []
    const out = []
    list.forEach((o) => {
      const items = Array.isArray(o?.items) ? o.items : []
      if (items.length <= 1) {
        out.push(o)
        return
      }
      const base = String(o?.orderNo || o?.orderNumber || '').trim()
      items.forEach((it, idx) => {
        const rowNo = base ? `${base}-${idx + 1}` : ''
        const goodsName = it?.goodsName || it?.title || it?.productName || it?.name || o?.goodsName || o?.productTitle || '-'
        const materialNo = it?.materialNo || o?.materialNo
        const specification = it?.specification || it?.spec || o?.specification || o?.spec
        const quantity = Number(it?.quantity ?? 0) || 0
        const unit = it?.unit || o?.unit || '片'
        const salePrice = Number(it?.salePrice ?? it?.unitPrice ?? o?.salePrice ?? 0) || 0
        const unitPrice = Number(it?.unitPrice ?? it?.listUnitPrice ?? o?.unitPrice ?? 0) || 0
        const amount = (() => {
          const a = Number(it?.amount ?? 0)
          if (Number.isFinite(a) && a > 0) return a
          const computed = quantity * salePrice
          return Number.isFinite(computed) ? computed : 0
        })()
        out.push({
          ...o,
          key: `po_item_${String(o?.key || o?._id || o?.id || base || 'po')}_${idx + 1}`,
          orderNo: rowNo || o?.orderNo || '',
          goodsName,
          materialNo,
          specification,
          quantity,
          unit,
          salePrice,
          unitPrice,
          amount,
          stockedQty: Number(it?.stockedQty ?? o?.stockedQty ?? 0) || 0,
          __parent: o,
          __itemIndex: idx
        })
      })
    })
    return out
  }, [filtered, viewType])

  const columns = (viewType === 'boards'
    ? [
      {
        title: '采购单号',
        dataIndex: 'orderNo',
        key: 'orderNo',
        width: 180,
        render: (text, record) => (
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault()
              navigate('/purchase/boards/preview', { state: { purchaseOrder: record } })
            }}
          >
            {text || '-'}
          </a>
        )
      },
      {
        title: '供应商名称',
        dataIndex: 'supplierName',
        key: 'supplierName',
        width: 140,
        ellipsis: true,
        render: (text, record) => {
          const supplierId = record.supplierId || record.supplier?._id || record.supplier?.id
          const supplierName = text
          const supplier = suppliers.find(s =>
            (supplierId && (s._id === supplierId || s.id === supplierId)) ||
            (s.name === supplierName || s.companyName === supplierName)
          )
          return supplier?.shortName || text || '-'
        }
      },
      { title: '下单数量', dataIndex: 'quantity', key: 'quantity', width: 100 },
      { title: '下单时间', dataIndex: 'createdAtText', key: 'createdAtText', width: 150 },
      {
        title: '状态',
        key: 'inboundStatus',
        width: 120,
        render: (_, r) => {
          const qty = Number(r.quantity || 0)
          const stocked = Number(r.stockedQty || 0)
          if (stocked <= 0) return <Tag color="default">未入库</Tag>
          if (qty > 0 && stocked >= qty) return <Tag color="success">全部入库</Tag>
          return <Tag color="processing">部分入库</Tag>
        }
      },
      {
        title: '操作',
        key: 'action',
        width: 80,
        render: (_, record) => (
          <Space size="small">
            <Button
              type="link"
              danger
              size="small"
              onClick={() => handleDelete(record)}
            >删除</Button>
          </Space>
        )
      }
    ]
    : [
    ...(viewType === 'raw_materials'
      ? []
      : [{
        title: '采购单号',
        dataIndex: 'orderNo',
        key: 'orderNo',
        width: 170,
        render: (text, record) => (
          <div>
            <div>{text || '-'}</div>
            <div style={{ color: '#6b7280', fontSize: '12px' }}>{record.createdAtText || '-'}</div>
          </div>
        )
      }]),
    { 
      title: (viewType === 'raw_materials' || viewType === 'boards') ? '供应商' : '客户名称', 
      dataIndex: (viewType === 'raw_materials' || viewType === 'boards') ? 'supplierName' : 'customerName', 
      key: (viewType === 'raw_materials' || viewType === 'boards') ? 'supplierName' : 'customerName', 
      width: 120, 
      ellipsis: true,
      render: (text, record) => {
        if (viewType === 'raw_materials' || viewType === 'boards') {
          const supplierId = record.supplierId || record.supplier?._id || record.supplier?.id
          const supplierName = text
          const supplier = suppliers.find(s => 
            (supplierId && (s._id === supplierId || s.id === supplierId)) || 
            (s.name === supplierName || s.companyName === supplierName)
          )
          return supplier?.shortName || text || '-'
        }
        const customerId = record.customerId || record.customer?._id || record.customer?.id
        const customerName = text
        const customer = customers.find(c => 
          (customerId && (c._id === customerId || c.id === customerId)) || 
          (c.name === customerName || c.companyName === customerName)
        )
        return customer?.shortName || text || '-'
      }
    },
    { title: viewType === 'raw_materials' ? '辅材名称' : '商品名称', key: 'goods', width: 100, ellipsis: true, render: (_, r) => (
      <div>
        <div>{r.goodsName || '-'}</div>
        <div style={{ color: '#6b7280' }}>
          {(viewType === 'goods' ? (r.specification || r.spec || r.materialNo) : r.materialNo) || '-'}
        </div>
      </div>
    ) },
    { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 80 },
    ...(viewType === 'raw_materials' ? [] : [
      { title: '进价', dataIndex: 'salePrice', key: 'salePrice', width: 80 },
      { title: '售价', dataIndex: 'unitPrice', key: 'unitPrice', width: 80 },
      { title: '单位', dataIndex: 'unit', key: 'unit', width: 60 },
      { title: '利润', key: 'profit', width: 90, render: (_, r) => {
        const profit = (Number(r.unitPrice || 0) * Number(r.quantity || 0)) - (Number(r.salePrice || 0) * Number(r.quantity || 0))
        return <span style={{ color: profit >= 0 ? '#f5222d' : '#52c41a' }}>{profit.toFixed(2)}</span>
      }}
    ]),
    { title: '金额', key: 'amount', width: 100, render: (_, r) => {
      const val = Number(r.amount || 0)
      return val.toLocaleString()
    } },
    { title: '状态', key: 'status', width: 160, render: (_, r) => {
      if (viewType === 'goods') {
        const hasStockedInfo = Number(r.stockedQty || 0) > 0 || Boolean(r.stockedAtText)
        if (hasStockedInfo && r.status !== 'cancelled') {
          return (
            <div style={{ color: '#111827' }}>
              <div style={{ fontSize: 12 }}>入库时间：{r.stockedAtText || '-'}</div>
              <div style={{ fontSize: 12 }}>入库数量：{Number(r.stockedQty || 0)} {r.unit || ''}</div>
            </div>
          )
        }
        return null
      }
      const statusConfig = {
        'ordered': { color: 'blue', text: '已下单' },
        'processing': { color: 'processing', text: '采购中' },
        'stocked': { color: 'success', text: '已入库' },
        'completed': { color: 'success', text: '已完成' },
        'cancelled': { color: 'default', text: '已取消' }
      }
      const conf = statusConfig[r.status] || statusConfig['ordered']
      return <Tag color={conf.color}>{conf.text}</Tag>
    } },
    ...(viewType === 'raw_materials' ? [{ title: '入库时间', dataIndex: 'stockedAtText', key: 'stockedAtText', width: 140 }] : []),
    ...(viewType === 'raw_materials' ? [{ title: '下单时间', dataIndex: 'createdAtText', key: 'createdAtText', width: 140 }] : []),
    { title: '操作', key: 'action', width: 120, fixed: 'right', render: (_, record) => (
      <Space size="small">
        {viewType !== 'boards' && record.status !== 'stocked' && record.status !== 'completed' && record.status !== 'cancelled' && (
          <Button 
            type="link"
            size="small"
            onClick={() => openInboundModal(record)}
          >入库</Button>
        )}
        <Button 
          type="link" 
          danger 
          size="small"
          onClick={() => handleDelete(record)}
        >删除</Button>
        {viewType === 'goods' ? (
          <Button
            type="link"
            size="small"
            onClick={() => handleReorder(record)}
          >再次下单</Button>
        ) : null}
      </Space>
    ) }
  ])

  const handleDelete = (record) => {
    const src = record?.__parent || record
    Modal.confirm({
      title: '确认删除',
      content: `此操作为永久删除，将从数据库中移除且不可恢复，确定要删除采购单 ${src.orderNo} 吗？`,
      okText: '删除',
      okType: 'danger',
      cancelText: '取消',
      onOk: async () => {
        try {
          const candidates = [
            src?._id,
            src?.id,
            src?.orderId,
            src?.order_id,
            src?.orderNo,
            src?.orderNumber,
            src?.key
          ]
          const picked = candidates
            .map((v) => String(v || '').trim())
            .find((v) => v && !/^po_\d+$/i.test(v))
          const idStr = String(picked || '').trim()
          if (!idStr) {
            message.error('缺少采购单ID，无法删除')
            return
          }
          await cachedPurchaseAPI.deletePurchaseOrder(idStr)
          message.success('删除成功')
          loadOrders()
        } catch (e) {
          const msg = e?.response?.data?.message || e?.message || '删除失败'
          message.error(msg)
        }
      }
    })
  }

  const handleReorder = (record) => {
    const src = record?.__parent || record
    Modal.confirm({
      title: '再次下单',
      content: `确定要基于采购单 ${src.orderNo || ''} 生成新的采购单吗？`,
      okText: '生成',
      cancelText: '取消',
      onOk: async () => {
        try {
          const nextNoRes = await purchaseAPI.getNextOrderNumber()
          const payload = nextNoRes?.data ?? nextNoRes
          const orderNo = payload?.orderNumber
          const reservationId = payload?.reservationId
          if (!orderNo) {
            message.error('获取采购单号失败')
            return
          }

          const quantity = Number(record?.__itemIndex != null ? (record?.quantity ?? 0) : (src?.quantity ?? 0)) || 0
          const unitPrice = Number(record?.__itemIndex != null ? (record?.unitPrice ?? 0) : (src?.unitPrice ?? 0)) || 0
          const salePrice = Number(record?.__itemIndex != null ? (record?.salePrice ?? 0) : (src?.salePrice ?? 0)) || 0
          const goodsName = (record?.__itemIndex != null ? (record?.goodsName || record?.productTitle) : (src?.goodsName || src?.productTitle)) || ''
          const materialNo = (record?.__itemIndex != null ? record?.materialNo : src?.materialNo) || ''
          const unit = (record?.__itemIndex != null ? record?.unit : src?.unit) || '片'

          const createPayload = {
            orderNo,
            customerName: src.customerName || '',
            supplierName: src.supplierName || '',
            productTitle: goodsName,
            materialNo,
            quantity,
            unit,
            unitPrice,
            salePrice,
            amount: quantity * unitPrice,
            items: [{
              goodsName,
              materialNo,
              quantity,
              unit,
              unitPrice: salePrice
            }],
            source: 'purchased',
            purchaseCategory: 'goods',
            orderType: 'purchase',
            status: 'ordered',
            createdAt: new Date().toISOString(),
            notes: src.notes || ''
          }

          const res = await cachedPurchaseAPI.createPurchaseOrder({ ...createPayload, reservationId })
          const serverOrder = res?.data?.order || res?.data?.data?.order || res?.data || res?.order || res
          const serverNo = serverOrder?.orderNo || serverOrder?.orderNumber || orderNo
          if (serverNo) {
            purchaseAPI.confirmOrderNumber(serverNo).catch(() => { })
          }
          message.success(serverNo ? `已生成采购单（编号：${serverNo}）` : '已生成采购单')
          setDatePreset(undefined)
          setDateRange(undefined)
          loadOrders()
        } catch (e) {
          const msg = e?.response?.data?.message || e?.message || '生成失败'
          message.error(msg)
        }
      }
    })
  }

  const [inboundModalOpen, setInboundModalOpen] = useState(false)
  const [inboundForm] = Form.useForm()
  const [inboundOrder, setInboundOrder] = useState(null)

  const openInboundModal = (record) => {
    const src = record?.__parent || record
    setInboundOrder(record)
    setInboundModalOpen(true)
    inboundForm.setFieldsValue({
      inboundQty: Number(record?.quantity ?? src?.quantity ?? 0) || 0
    })
  }

  const handleInboundSubmit = async () => {
    try {
      const values = await inboundForm.validateFields()
      const src = inboundOrder?.__parent || inboundOrder
      const id = src?._id || src?.id
      if (!id) return
      
      const qty = Number(values.inboundQty)
      
      // 更新采购单入库状态
      const itemIndex = inboundOrder?.__itemIndex
      const nowIso = new Date().toISOString()
      if (Number.isFinite(itemIndex) && itemIndex >= 0 && Array.isArray(src?.items) && src.items.length) {
        const nextItems = src.items.map((it, idx) => {
          if (idx !== itemIndex) return it
          const curStocked = Number(it?.stockedQty ?? 0) || 0
          return { ...(it && typeof it === 'object' ? it : {}), stockedQty: curStocked + qty }
        })
        const nextStockedTotal = nextItems.reduce((s, it) => s + (Number(it?.stockedQty ?? 0) || 0), 0)
        await cachedPurchaseAPI.updatePurchaseOrder(id, {
          items: nextItems,
          stockedQty: nextStockedTotal,
          stockedAt: nowIso,
          source: 'purchased',
          status: 'stocked'
        })
      } else {
        await cachedPurchaseAPI.updatePurchaseOrder(id, { 
          stockedQty: (Number(src?.stockedQty || 0) + qty), 
          stockedAt: nowIso, 
          source: 'purchased',
          status: 'stocked'
        })
      }
      
      message.success('已确认入库')
      setInboundModalOpen(false)
      setInboundOrder(null)
      loadOrders()
    } catch (e) {
      message.error('入库失败')
    }
  }

  const handleSearchInput = (e) => setSearchParams(prev => ({ ...prev, keyword: e.target.value }))
  const handleSupplierFilter = (value) => setSearchParams(prev => ({ ...prev, supplier: value }))
  const executeSearch = () => setSearchParams(prev => ({ ...prev, keyword: String(prev.keyword || '').trim() }))

  const openCreateModal = async () => {
    setEditingOrder(null)
    setModalOpen(true)
    form.resetFields()
    try {
      const res = await purchaseAPI.getNextOrderNumber()
      const payload = res?.data ?? res
      const no = payload?.orderNumber
      const rid = payload?.reservationId
      if (no) {
        form.setFieldsValue({ orderNo: no })
        setReservedId(rid)
      }
    } catch (_) { void 0 }
  }
  const openEditModal = (record) => {
    setEditingOrder(record)
    setModalOpen(true)
    form.setFieldsValue({
      orderNo: record.orderNo,
      customerName: record.customerName,
      supplierName: record.supplierName,
      goodsName: record.goodsName,
      materialNo: record.materialNo,
      quantity: record.quantity,
      unit: record.unit,
      salePrice: record.salePrice,
      unitPrice: record.unitPrice,
      notes: record.notes
    })
  }

  const handleSubmit = async () => {
    try {
      const values = await form.validateFields()
      const payload = {
        orderNo: values.orderNo,
        customerName: values.customerName,
        supplierName: values.supplierName,
        productTitle: values.goodsName,
        materialNo: values.materialNo,
        quantity: values.quantity,
        unit: values.unit,
        unitPrice: values.unitPrice,
        salePrice: values.salePrice,
        amount: Number(values.quantity || 0) * Number(values.unitPrice || 0),
        items: [{
          goodsName: values.goodsName,
          materialNo: values.materialNo,
          quantity: values.quantity,
          unit: values.unit,
          unitPrice: values.salePrice
        }],
        source: 'purchased',
        purchaseCategory: viewType,
        orderType: 'purchase',
        status: 'ordered',
        createdAt: new Date().toISOString(),
        notes: values.notes
      }
      if (editingOrder && (editingOrder._id || editingOrder.id)) {
        await cachedPurchaseAPI.updatePurchaseOrder(editingOrder._id || editingOrder.id, payload)
        message.success('采购单已更新')
      } else {
        const res = await cachedPurchaseAPI.createPurchaseOrder({ ...payload, reservationId: reservedId })
        const serverOrder = res?.data?.order || res?.data?.data?.order || res?.data || res?.order || res
        const serverNo = serverOrder?.orderNo || serverOrder?.orderNumber
        message.success(serverNo ? `采购单已新增（编号：${serverNo}）` : '采购单已新增')
        if (serverNo) {
          purchaseAPI.confirmOrderNumber(serverNo).catch(() => { })
        }
        setReservedId(undefined)
      }
      setModalOpen(false)
      setEditingOrder(null)
      form.resetFields()
      setDatePreset(undefined)
      setDateRange(undefined)
      loadOrders()
    } catch (error) {
      const msg = error?.response?.data?.message || error?.message || '提交失败'
      message.error(msg)
    }
  }

  const handleCancel = async () => {
    try {
      const ono = form.getFieldValue('orderNo')
      if (!editingOrder && (reservedId || ono)) {
        await purchaseAPI.releaseOrderNumber({ reservationId: reservedId, orderNumber: ono })
      }
    } catch (_) { void 0 }
    setReservedId(undefined)
    setModalOpen(false)
    setEditingOrder(null)
  }

  return (
    <ConfigProvider locale={zhCN}>
      <div>
        <h2 className="page-title">采购管理</h2>

      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-start' }}>
        <Tabs activeKey={viewType} onChange={setViewType} items={tabItems} />
      </div>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Card className="stats-card" style={{ width: 160, height: 160, background: '#7F7FD5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <div className="stats-value">{stats.total}</div>
          <div className="stats-label">采购单数</div>
        </Card>
        <Card className="stats-card" style={{ width: 160, height: 160, background: '#4caf50', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <div className="stats-value">{stats.inbound}</div>
          <div className="stats-label">已入库</div>
        </Card>
        <Card className="stats-card" style={{ width: 160, height: 160, background: '#7e57c2', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <div className="stats-value" style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 20 }}>¥</span>
            <span style={{ fontSize: 22 }}>{Number((viewType === 'boards' ? stats.monthlyAmount : stats.totalAmount) || 0).toFixed(2)}</span>
          </div>
          <div className="stats-label">{viewType === 'boards' ? '本月采购总金额' : '采购总金额'}</div>
        </Card>
        {viewType === 'goods' ? (
          <Card className="stats-card" style={{ width: 160, height: 160, background: '#ff8a65', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
            <div className="stats-value">{stats.staleCount}</div>
            <div className="stats-label">呆滞采购</div>
          </Card>
        ) : null}
      </div>

      <Card style={{ marginBottom: 24 }}>
        <Space wrap size={20} style={{ marginBottom: 12 }}>
          <Select
            placeholder="订单筛选"
            value={datePreset}
            onChange={(v) => { setDatePreset(v); setDateRange(undefined) }}
            options={[
              { label: '今日订单', value: 'today' },
              { label: '近7天订单', value: 'last7' },
              { label: '近30天订单', value: 'last30' }
            ]}
            style={{ width: 160 }}
          />
          <DatePicker.RangePicker
            onChange={(dates) => { setDateRange(dates); setDatePreset(undefined) }}
            placeholder={["开始日期", "结束日期"]}
          />
          <Space.Compact>
            <Input 
              placeholder="搜索采购单号/供应商/商品/型号规格"
              value={searchParams.keyword}
              onChange={handleSearchInput}
              style={{ width: 220 }}
              allowClear
            />
            <Button 
              icon={<SearchOutlined />}
              onClick={executeSearch}
            >
              搜索
            </Button>
          </Space.Compact>
          {viewType !== 'boards' ? (
            <Button 
              type="primary" 
              icon={<PlusOutlined />}
              onClick={() => {
                if (viewType === 'raw_materials') {
                  navigate('/purchase/materials/create')
                  return
                }
                navigate('/purchase/goods/create')
              }}
            >
              {viewType === 'raw_materials' ? '新增辅材采购' : '新增商品采购'}
            </Button>
          ) : null}
          <Button icon={<ReloadOutlined />} onClick={loadOrders}>刷新</Button>
        </Space>

        <Table
          columns={columns}
          dataSource={displayed}
          loading={loading}
          pagination={{ pageSize: 10 }}
          scroll={viewType === 'boards' ? undefined : { x: viewType === 'raw_materials' ? 910 : 1050 }}
        />
      </Card>

      <Modal
        title="确认入库"
        open={inboundModalOpen}
        onOk={handleInboundSubmit}
        onCancel={() => setInboundModalOpen(false)}
        destroyOnHidden
      >
        <Form form={inboundForm} layout="vertical">
          <div style={{ marginBottom: 16, padding: '12px 16px', background: '#f5f5f5', borderRadius: 6 }}>
            <div><strong>商品：</strong>{inboundOrder?.goodsName}</div>
            <div><strong>采购数量：</strong>{inboundOrder?.quantity} {inboundOrder?.unit}</div>
            <div><strong>已入库：</strong>{inboundOrder?.stockedQty || 0} {inboundOrder?.unit}</div>
          </div>
          <Form.Item 
            name="inboundQty" 
            label="本次入库数量" 
            rules={[
              { required: true, message: '请输入入库数量' },
              { 
                validator: (_, value) => {
                  if (value > (Number(inboundOrder?.quantity) - Number(inboundOrder?.stockedQty || 0))) {
                    return Promise.reject('入库数量不能超过剩余未入库数量')
                  }
                  return Promise.resolve()
                }
              }
            ]}
          >
            <Input type="number" suffix={inboundOrder?.unit} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={editingOrder ? '编辑采购单' : '新增采购单'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={handleCancel}
        forceRender
      >
        <Form form={form} layout="vertical">
          <Form.Item name="orderNo" label="订单号" rules={[{ required: true, message: '订单号生成失败' }]}>
            <Input placeholder="系统自动生成" readOnly />
          </Form.Item>
          <Form.Item name="customerName" label="客户名称">
            <Select
              style={{ width: 280 }}
              placeholder="请选择客户"
              options={(customers || []).map(c => {
                const name = c.companyName || c.name || c.company
                return {
                  value: name,
                  label: c.shortName ? `${c.shortName} (${name})` : name
                }
              })}
              showSearch
              optionFilterProp="label"
              allowClear
              loading={customersLoading}
              onSearch={remoteSearchCustomers}
            />
          </Form.Item>
          <Form.Item name="supplierName" label="供应商" rules={[{ required: true, message: '请选择供应商' }]}> 
            <Select
              style={{ width: 280 }}
              placeholder="请选择供应商"
              options={supplierOptions}
              showSearch
              optionFilterProp="label"
              allowClear
            />
          </Form.Item>
          <Space size={16} wrap>
            <Form.Item name="goodsName" label="商品名称" rules={[{ required: true, message: '请输入商品名称' }]}> 
              <Input placeholder="请输入商品名称" style={{ width: 240 }} />
            </Form.Item>
            <Form.Item name="materialNo" label="型号规格">
              <Input placeholder="请输入型号规格" style={{ width: 240 }} />
            </Form.Item>
          </Space>
          <Form.Item name="quantity" label="数量" rules={[{ required: true, message: '请输入数量' }]}> 
            <Space.Compact>
              <Input type="number" placeholder="数量" style={{ width: 120 }} />
              <Form.Item name="unit" noStyle initialValue="片">
                <Select style={{ width: 120 }} options={unitOptions} />
              </Form.Item>
            </Space.Compact>
          </Form.Item>
          <Form.Item name="salePrice" label="进货价"> 
            <Space size={8} align="center">
              <Input type="number" placeholder="进货价" style={{ width: 120 }} />
              <span>元</span>
              <Form.Item noStyle shouldUpdate={(prev, cur) => (
                prev.quantity !== cur.quantity || prev.salePrice !== cur.salePrice
              )}>
                {() => {
                  const qty = Number(form.getFieldValue('quantity') || 0)
                  const p = Number(form.getFieldValue('salePrice') || 0)
                  const val = qty * p
                  return <span style={{ color: '#6b7280' }}>采购成本：<span style={{ color: '#111827' }}>¥{Number.isFinite(val) ? val.toFixed(2) : '0.00'} 元</span></span>
                }}
              </Form.Item>
            </Space>
          </Form.Item>
          <Form.Item name="unitPrice" label="售价" rules={[{ required: true, message: '请输入售价' }]}> 
            <Space size={8} align="center">
              <Input type="number" placeholder="售价" style={{ width: 120 }} />
              <span>元</span>
              <Form.Item noStyle shouldUpdate={(prev, cur) => (
                prev.quantity !== cur.quantity || prev.unitPrice !== cur.unitPrice
              )}>
                {() => {
                  const qty = Number(form.getFieldValue('quantity') || 0)
                  const s = Number(form.getFieldValue('unitPrice') || 0)
                  const val = qty * s
                  return <span style={{ color: '#6b7280' }}>订单金额：<span style={{ color: '#111827' }}>¥{Number.isFinite(val) ? val.toFixed(2) : '0.00'} 元</span></span>
                }}
              </Form.Item>
            </Space>
          </Form.Item>
          <Form.Item label="利润" shouldUpdate={(prev, cur) => (
            prev.quantity !== cur.quantity || prev.salePrice !== cur.salePrice || prev.unitPrice !== cur.unitPrice
          )}>
            {() => {
              const qty = Number(form.getFieldValue('quantity') || 0)
              const purchasePrice = Number(form.getFieldValue('salePrice') || 0)
              const salePriceVal = Number(form.getFieldValue('unitPrice') || 0)
              const purchaseAmount = (qty * purchasePrice) || 0
              const saleAmount = (qty * salePriceVal) || 0
              const profit = saleAmount - purchaseAmount
              const displayVal = Number.isFinite(profit) ? profit.toFixed(2) : '0.00'
              return (
                <Space size={8} align="center">
                  <Input readOnly style={{ width: 120 }} value={displayVal} />
                  <span>元</span>
                </Space>
              )
            }}
          </Form.Item>
          <Form.Item name="notes" label="备注"> 
            <Input.TextArea placeholder="备注" rows={3} />
          </Form.Item>
        </Form>
      </Modal>
      </div>
    </ConfigProvider>
  )
}

export default PurchaseManagement
