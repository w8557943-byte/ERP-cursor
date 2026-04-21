import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Card, Table, Space, Select, Input, Button, Tag, Tabs, DatePicker, Modal, Form, App } from 'antd'
import { Link } from 'react-router-dom'
import dayjs from 'dayjs'
import { api } from '../services/api'
import { cachedOrderAPI, cachedPurchaseAPI } from '../services/cachedAPI'
import { matchSizeKeyword } from '../utils'

const InventoryManagement = () => {
  const [loading, setLoading] = useState(false)
  const [orders, setOrders] = useState([])
  const [customerFilter, setCustomerFilter] = useState(undefined)
  const [keyword, setKeyword] = useState('')
  const [sortField] = useState('time')
  const [sortDir] = useState('desc')
  const [viewType, setViewType] = useState('production')
  const [dateRange, setDateRange] = useState()
  const [importOpen, setImportOpen] = useState(false)
  const [shipModalOpen, setShipModalOpen] = useState(false)
  const [shipOrder, setShipOrder] = useState(null)
  const [shipQty, setShipQty] = useState('')
  const [form] = Form.useForm()
  const { message } = App.useApp()
  const loadPromiseRef = useRef(null)
  const tabItems = useMemo(() => ([
    { key: 'production', label: '生产库存' },
    { key: 'purchased', label: '外购商品库存' },
    { key: 'boards', label: '纸板库存' }
  ]), [])

  const loadData = (options = {}) => {
    if (loadPromiseRef.current) return loadPromiseRef.current
    loadPromiseRef.current = (async () => {
      setLoading(true)
      try {
        const force = Boolean(options?.force)
        const cacheBust = force ? Date.now() : undefined
        const extractList = (res) => {
          if (Array.isArray(res?.data)) return res.data
          if (Array.isArray(res?.list)) return res.list
          if (Array.isArray(res?.result?.data)) return res.result.data
          if (Array.isArray(res?.data?.orders)) return res.data.orders
          if (Array.isArray(res?.data?.list)) return res.data.list
          if (Array.isArray(res?.data?.data)) return res.data.data
          return []
        }

        const fetchAll = async (fn, baseParams) => {
          const pageSize = 50
          const maxPages = 20
          const all = []
          for (let page = 1; page <= maxPages; page += 1) {
            const res = await fn({ ...(baseParams || {}), page, pageSize })
            const rows = extractList(res)
            if (rows.length) all.push(...rows)
            if (rows.length < pageSize) break
          }
          return all
        }

        const ordersParams = cacheBust ? { _ts: cacheBust } : {}
        const purchaseParams = cacheBust ? { _ts: cacheBust } : {}
        const [ordersData, purchaseData] = await Promise.all([
          viewType === 'production' ? fetchAll(cachedOrderAPI.getOrders, ordersParams) : Promise.resolve([]),
          viewType !== 'production'
            ? fetchAll(cachedPurchaseAPI.getPurchaseOrders, {
              ...purchaseParams,
              ...(viewType === 'boards' ? { category: 'boards' } : {})
            })
            : Promise.resolve([])
        ])

        const data = viewType === 'production' ? ordersData : purchaseData
        const list = data.map((o, i) => {
          const items = Array.isArray(o.items) ? o.items : []
          const first = items[0] || {}
          const normalizeText = (v) => String(v ?? '').trim()
          const isBadText = (v) => {
            const s = normalizeText(v)
            if (!s || s === '-') return true
            return s === '真实订单信息' || s === 'SKU订单信息' || s === '多SKU'
          }
          const pickText = (...candidates) => {
            for (const c of candidates) {
              if (!isBadText(c)) return normalizeText(c)
            }
            return '-'
          }
          const pickFromItems = (getter) => {
            for (const it of items) {
              if (!it || typeof it !== 'object') continue
              const v = getter(it)
              if (!isBadText(v)) return normalizeText(v)
            }
            return ''
          }
          let shipped = Number(o.shippedQty ?? o.deliveredQty ?? 0)
          if (!Number.isFinite(shipped) || shipped < 0) shipped = 0
          if (shipped <= 0 && Array.isArray(o.shipments)) {
            const sum = o.shipments.reduce((s, it) => {
              const v = Number(it?.qty ?? it?.quantity ?? it?.shipQty ?? 0)
              if (!Number.isFinite(v) || v <= 0) return s
              return s + v
            }, 0)
            if (Number.isFinite(sum) && sum > 0) shipped = sum
          }
          const unit = o.unit || first.unit || '片'
          const status = String(o.status || '').toLowerCase()
          const quantity = Number(o.quantity || o.totalQty || (Array.isArray(o.items) ? o.items.reduce((s, it) => s + (Number(it.quantity) || 0), 0) : 0))
          const rawStockedQty = Number(o.stockedQty || 0)
          const stockedQty = rawStockedQty > 0
            ? rawStockedQty
            : (['stocked', 'completed', 'warehoused', 'done', '已入库'].includes(status) ? quantity : 0)
          const stockedAtRaw = o.stockedAt || o.stockTime || (String(o.status || '').toLowerCase() === 'stocked' ? (o.updatedAt || o.updateTime) : '')
          const stockedAtText = stockedAtRaw ? dayjs(stockedAtRaw).format('YYYY-MM-DD HH:mm') : ''
          const stockedAtTs = stockedAtRaw && dayjs(stockedAtRaw).isValid() ? dayjs(stockedAtRaw).valueOf() : 0
          const unitPrice = Number(o.unitPrice || first.unitPrice || 0)
          const createdAtRaw = o.createdAt || o.createTime || o.create_time || ''
          const createdAtTs = createdAtRaw && dayjs(createdAtRaw).isValid() ? dayjs(createdAtRaw).valueOf() : 0
          const supplierName = o.supplierName || o.supplier?.name || o.supplier || ''
          const sourceVal = String(o.source || '').toLowerCase()
          const orderTypeVal = String(o.orderType || '').toLowerCase()
          const rawCategoryVal = String(o.purchaseCategory || o.category || '').toLowerCase()
          const isPurchasedExact = viewType !== 'production'
            ? true
            : ((sourceVal === 'purchased') || (orderTypeVal === 'purchase'))
          const categoryVal = (() => {
            if (rawCategoryVal) return rawCategoryVal
            if (viewType === 'boards') return 'boards'
            if (viewType === 'purchased') return 'goods'
            return rawCategoryVal
          })()
          const inventoryQty = Math.max(0, stockedQty - shipped)
          return {
            key: o._id || o.id || o.orderNo || `inv_${i}`,
            orderId: o._id || o.id,
            orderNo: o.orderNo || o.orderNumber || '',
            customerName: o.customerName || o.customer?.name || o.customer || supplierName || '-',
            supplierName,
            productName: pickText(
              o.productName,
              o.product?.name,
              pickFromItems((it) => it.productName || it.product?.name || it.category || it.productCategory || it.productType || it.type),
              first.productName,
              first.product?.name,
              first.category,
              first.productCategory,
              first.productType,
              first.type
            ),
            productCategory: pickText(
              o.productCategory,
              o.categoryName,
              o.productType,
              o.type,
              pickFromItems((it) => it.productCategory || it.categoryName || it.productType || it.type || it.category),
              first.productCategory,
              first.categoryName,
              first.productType,
              first.type
            ),
            goodsName: pickText(
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
            spec: pickText(
              o.spec,
              first.spec,
              pickFromItems((it) => it.spec || it.specification)
            ),
            materialNo: pickText(
              o.materialNo,
              first.materialNo,
              pickFromItems((it) => it.materialNo || it.material_no || it.materialCode || it.material_code)
            ),
            inventoryQty,
            shippedQty: shipped,
            shipments: Array.isArray(o.shipments) ? o.shipments : [],
            inventoryChangeLogs: Array.isArray(o.inventoryChangeLogs) ? o.inventoryChangeLogs : [],
            unit,
            stockedAtText,
            stockedAtTs,
            unitPrice,
            createdAtTs,
            quantity,
            salePrice: Number(o.salePrice || first.salePrice || 0),
            amount: Number(o.amount || o.totalAmount || o.finalAmount || (quantity * unitPrice) || 0),
            stockedQty,
            source: sourceVal,
            orderType: orderTypeVal,
            category: categoryVal,
            isPurchasedExact,
            status
          }
        })
        const uniq = new Map()
        for (const r of list) {
          if (!uniq.has(r.key)) uniq.set(r.key, r)
        }
        setOrders(Array.from(uniq.values()))
      } finally {
        setLoading(false)
        loadPromiseRef.current = null
      }
    })()
    return loadPromiseRef.current
  }

  useEffect(() => { loadData() }, [viewType])
  useEffect(() => {
    if (viewType !== 'boards') return
    const timer = setInterval(() => {
      try {
        if (typeof document !== 'undefined' && document.hidden) return
      } catch (_) { void 0 }
      loadData()
    }, 60000)
    return () => clearInterval(timer)
  }, [viewType])

  const customers = useMemo(() => {
    const set = new Set((orders || []).filter(o => !o.isPurchasedExact).map(o => o.customerName).filter(Boolean))
    return Array.from(set).map(c => ({ label: c, value: c }))
  }, [orders])

  const suppliers = useMemo(() => {
    const set = new Set((orders || []).filter(o => o.isPurchasedExact).map(o => o.supplierName).filter(Boolean))
    return Array.from(set).map(s => ({ label: s, value: s }))
  }, [orders])

  const stats = useMemo(() => {
    const allRelevant = (orders || []).filter(o => {
      if (viewType === 'boards') {
        return o.isPurchasedExact && o.category === 'boards'
      }
      if (viewType === 'purchased') {
        return o.isPurchasedExact && o.category !== 'raw_materials' && o.category !== 'boards'
      }
      return !o.isPurchasedExact && o.category !== 'raw_materials'
    })
    const invOrders = allRelevant.filter(o => Number(o.inventoryQty || 0) > 0)
    const invCount = invOrders.length
    const now = Date.now()
    const twoWeeksMs = 14 * 24 * 60 * 60 * 1000
    const staleCount = invOrders.filter(o => {
      const t = Number(o.stockedAtTs || 0)
      if (!t) return false
      return (now - t) >= twoWeeksMs
    }).length
    const totalAmount = invOrders.reduce((s, o) => {
      if (viewType === 'purchased' || viewType === 'boards') {
        return s + Number(o.amount || 0)
      }
      const price = Number(o.unitPrice || 0)
      return s + Number(o.inventoryQty || 0) * price
    }, 0)
    const unfinishedTotal = allRelevant.filter(o => {
      const s = String(o.status || '').toLowerCase()
      if (['cancelled', 'canceled', '已取消'].includes(s) || o.status === '已取消') return false
      if (['completed', 'done', 'finished', '已完成'].includes(s) || o.status === '已完成') return false
      return true
    }).length
    const healthScore = unfinishedTotal > 0
      ? Math.max(0, Math.min(100, Math.round(100 - (staleCount / unfinishedTotal) * 100)))
      : 100
    return { invCount, staleCount, totalAmount, healthScore }
  }, [orders, viewType])

  const shipRemainQty = useMemo(() => {
    if (!shipOrder) return 0
    return Math.max(0, Number(shipOrder.inventoryQty || 0))
  }, [shipOrder])

  const filtered = useMemo(() => {
    let list = orders.filter(o => {
      if (viewType === 'boards') {
        return o.isPurchasedExact &&
               o.category === 'boards'
      }
      if (viewType === 'purchased') {
        return o.isPurchasedExact &&
               o.category !== 'raw_materials' &&
               o.category !== 'boards' &&
               Number(o.inventoryQty || 0) > 0
      }
      return !o.isPurchasedExact &&
             o.category !== 'raw_materials' &&
             Number(o.inventoryQty || 0) > 0
    })
    if (viewType !== 'boards') {
      list = list.filter(o => Number(o.inventoryQty || 0) > 0)
    }
    if (dateRange && Array.isArray(dateRange) && dateRange.length === 2) {
      const [start, end] = dateRange
      const s = start ? dayjs(start).startOf('day').valueOf() : 0
      const e = end ? dayjs(end).endOf('day').valueOf() : Number.MAX_SAFE_INTEGER
      list = list.filter(o => o.stockedAtTs && o.stockedAtTs >= s && o.stockedAtTs <= e)
    }
    if (customerFilter) {
      list = (viewType !== 'production')
        ? list.filter(o => o.supplierName === customerFilter)
        : list.filter(o => o.customerName === customerFilter)
    }
    if (keyword) {
      const k = keyword.trim().toLowerCase()
      list = list.filter(o => (
        String(o.orderNo||'').toLowerCase().includes(k) ||
        String((viewType!=='production') ? (o.supplierName||'') : (o.customerName||'')).toLowerCase().includes(k) ||
        String(o.productName||'').toLowerCase().includes(k) ||
        String(o.goodsName||'').toLowerCase().includes(k) ||
        String(o.materialNo||'').toLowerCase().includes(k) ||
        matchSizeKeyword(keyword, o.materialNo, o.spec)
      ))
    }
    const keyGetter = (o) => {
      if (sortField === 'time') return Number(o.stockedAtTs || 0)
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
  }, [orders, viewType, customerFilter, keyword, sortField, sortDir])

  const openShipModal = (record) => {
    if (!record.orderId) {
      message.error('无法获取订单ID，暂时不能发货')
      return
    }
    if (Number(record.inventoryQty || 0) <= 0) {
      message.error('当前无可用库存，无法发货')
      return
    }
    setShipOrder(record)
    setShipQty('')
    setShipModalOpen(true)
  }

  const handleConfirmShip = async () => {
    if (!shipOrder || !shipOrder.orderId) {
      message.error('无法获取订单ID，暂时不能发货')
      return
    }
    if (shipRemainQty <= 0) {
      message.error('当前无可用库存，无法发货')
      return
    }
    const val = Number(shipQty)
    if (!Number.isFinite(val) || val <= 0) {
      message.error('请输入大于0的发货数量')
      return
    }
    if (val > shipRemainQty) {
      message.error(`发货数量不能大于库存数量（${shipRemainQty}）`)
      return
    }
    try {
      const nowIso = new Date().toISOString()
      const prevShipped = Number(shipOrder.shippedQty || 0)
      const totalShipped = prevShipped + val
      const totalStocked = Number(shipOrder.stockedQty || shipOrder.quantity || 0)
      const remain = Math.max(0, totalStocked - totalShipped)
      const status = remain > 0 ? 'shipping' : 'shipped'
      const prevShipments = Array.isArray(shipOrder.shipments) ? shipOrder.shipments : []
      const newShipment = { qty: val, time: nowIso }
      const payload = {
        shippedQty: totalShipped,
        shippedAt: nowIso,
        status,
        shipments: prevShipments.concat([newShipment])
      }
      await cachedOrderAPI.updateOrder(shipOrder.orderId, payload)
      message.success('发货已记录')
      setShipModalOpen(false)
      setShipOrder(null)
      setShipQty('')
      loadData()
    } catch (e) {
      message.error('发货记录失败')
    }
  }

  const columns = useMemo(() => {
    if (viewType === 'boards') {
      const getUsageStatus = (r) => {
        const total = Math.max(0, Number(r.stockedQty ?? r.quantity ?? 0))
        const used = Math.max(0, Number(r.shippedQty ?? 0))
        if (total <= 0) return '待使用'
        if (used <= 0) return '待使用'
        if (used >= total) return '已使用'
        return '部分使用'
      }
      const getUsageTagColor = (status) => {
        if (status === '已使用') return 'green'
        if (status === '部分使用') return 'gold'
        return 'blue'
      }
      return [
        { title: '订单编号', dataIndex: 'orderNo', key: 'orderNo', width: 160, render: (_, r) => (
          r.orderNo ? (
            <Link
              to="/inventory/boards/detail"
              state={{ entry: 'inventory', fromInventory: true, purchaseOrder: { _id: r.orderId, id: r.orderId, orderNo: r.orderNo } }}
            >
              {r.orderNo}
            </Link>
          ) : '-'
        ) },
        { title: '供应商', dataIndex: 'supplierName', key: 'supplierName', width: 160 },
        { title: '纸板信息', key: 'goods', width: 260, render: (_, r) => (
          <div>
            <div>商品名称：{r.goodsName}</div>
            {r.materialNo ? (
              <div style={{ color: '#6b7280' }}>规格尺寸：{r.materialNo || r.spec}</div>
            ) : (
              <div style={{ color: '#6b7280' }}>规格尺寸：{r.spec || '-'}</div>
            )}
          </div>
        ) },
        { title: '入库数量', key: 'stockedQty', width: 140, render: (_, r) => (
          <Space>
            <Tag color={Number(r.stockedQty || 0) > 0 ? 'green' : 'default'}>{Number(r.stockedQty || 0)}</Tag>
            <span>{r.unit}</span>
          </Space>
        ) },
        { title: '库存订单金额', key: 'invAmount', width: 160, render: (_, r) => (
          <div style={{ color: '#ff4d4f' }}>
            ¥{Number(r.amount || 0).toFixed(2)}
          </div>
        ) },
        { title: '库存数量', key: 'inventory', width: 140, render: (_, r) => (
          <Space>
            <Tag color={r.inventoryQty > 0 ? 'blue' : 'default'}>{r.inventoryQty}</Tag>
            <span>{r.unit}</span>
          </Space>
        ) },
        { title: '状态栏', key: 'usageStatus', width: 160, render: (_, r) => {
          const s = getUsageStatus(r)
          const total = Math.max(0, Number(r.stockedQty ?? r.quantity ?? 0))
          const used = Math.max(0, Number(r.shippedQty ?? 0))
          const logs = Array.isArray(r.inventoryChangeLogs) ? r.inventoryChangeLogs : []
          const last = logs.length ? logs[logs.length - 1] : null
          const lastAt = last?.at || last?.time || last?.ts || ''
          const lastText = lastAt ? dayjs(lastAt).format('YYYY-MM-DD HH:mm') : ''
          return (
            <div style={{ lineHeight: 1.1 }}>
              <Tag color={getUsageTagColor(s)} style={{ fontWeight: 600 }}>{s}</Tag>
              <div style={{ color: '#6b7280', fontSize: 12 }}>
                已用 {Math.min(used, total)} / 入库 {total}
              </div>
              {lastText ? (
                <div style={{ color: '#6b7280', fontSize: 12 }}>
                  最近变更 {lastText}
                </div>
              ) : null}
            </div>
          )
        } },
        { title: '入库时间', dataIndex: 'stockedAtText', key: 'stockedAtText', width: 180 },
      ]
    }
    if (viewType === 'purchased') {
      return [
        { title: '订单编号', dataIndex: 'orderNo', key: 'orderNo', width: 160 },
        { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 160 },
        { title: '商品信息', key: 'goods', width: 260, render: (_, r) => (
          <div>
            <div>商品名称：{r.goodsName}</div>
            <div style={{ color: '#6b7280' }}>产品类别：{(r.productCategory && r.productCategory !== '-') ? r.productCategory : (r.productName || '-')}</div>
            <div style={{ color: '#6b7280' }}>规格尺寸：{(r.spec && r.spec !== '-') ? r.spec : ((r.materialNo && r.materialNo !== '-') ? r.materialNo : '-')}</div>
          </div>
        ) },
        { title: '库存订单金额', key: 'invAmount', width: 160, render: (_, r) => (
          <div style={{ color: '#ff4d4f' }}>
            ¥{Number(r.amount || 0).toFixed(2)}
          </div>
        ) },
        { title: '库存数量', key: 'inventory', width: 140, render: (_, r) => (
          <Space>
            <Tag color={r.inventoryQty > 0 ? 'blue' : 'default'}>{r.inventoryQty}</Tag>
            <span>{r.unit}</span>
          </Space>
        ) },
        { title: '入库时间', dataIndex: 'stockedAtText', key: 'stockedAtText', width: 180 },
        { title: '操作', key: 'action', width: 120, render: (_, r) => (
          <Button
            type="default"
            style={{ borderColor: '#52c41a', color: '#52c41a' }}
            onClick={() => openShipModal(r)}
            disabled={!r.orderId || Number(r.inventoryQty || 0) <= 0}
          >
            发货
          </Button>
        ) },
      ]
    }
    return [
      { title: '订单编号', dataIndex: 'orderNo', key: 'orderNo', width: 160, render: (_, r) => (
        <Link
          to={`/production/${r.key}?orderNo=${encodeURIComponent(r.orderNo || '')}`}
          state={{ seedOrder: r }}
        >
          {r.orderNo}
        </Link>
      ) },
      { title: '客户名称', dataIndex: 'customerName', key: 'customerName', width: 160, render: (text, record) => {
        const customerId = record.customerId || record.customer?._id || record.customer?.id
        const customerName = text
        const customer = customers.find(c => 
          (customerId && (c._id === customerId || c.id === customerId)) || 
          (c.name === customerName || c.companyName === customerName)
        )
        return customer?.shortName || text || '-'
      } },
      { title: '产品', key: 'product', width: 260, render: (_, r) => (
        <div>
          <div>商品名称：{r.goodsName}</div>
          <div style={{ color: '#6b7280' }}>产品类别：{r.productName}</div>
          <div style={{ color: '#6b7280' }}>规格：{r.spec}</div>
          {r.materialNo ? (
            <div style={{ color: '#6b7280' }}>物料号：{r.materialNo}</div>
          ) : null}
        </div>
      ) },
      { title: '库存订单金额', key: 'invAmount', width: 160, render: (_, r) => (
        <div style={{ color: '#ff4d4f' }}>¥{(Number(r.inventoryQty||0) * Number(r.unitPrice||0)).toFixed(2)}</div>
      ) },
      { title: '入库时间', dataIndex: 'stockedAtText', key: 'stockedAtText', width: 180 },
      { title: '库存数量', key: 'inventory', width: 140, render: (_, r) => (
        <Space>
          <Tag color={r.inventoryQty > 0 ? 'blue' : 'default'}>{r.inventoryQty}</Tag>
          <span>{r.unit}</span>
        </Space>
      ) },
      { title: '操作', key: 'action', width: 120, render: (_, r) => (
        <Button
          type="default"
          style={{ borderColor: '#52c41a', color: '#52c41a' }}
          onClick={() => openShipModal(r)}
          disabled={!r.orderId || Number(r.inventoryQty || 0) <= 0}
        >
          发货
        </Button>
      ) },
    ]
  }, [viewType])

  return (
    <div>
      <h2 className="page-title">库存管理</h2>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-start' }}>
        <Tabs activeKey={viewType} onChange={setViewType} items={tabItems} />
      </div>
      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Card className="stats-card" style={{ width: 160, height: 160, background: '#42a5f5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <div className="stats-value">{stats.invCount}</div>
          <div className="stats-label">
            {viewType === 'boards' ? '纸板库存订单' : (viewType==='purchased') ? '外购商品库存订单' : '生产库存订单'}
          </div>
        </Card>
        <Card className="stats-card" style={{ width: 160, height: 160, background: '#ff8a65', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <div className="stats-value">{stats.staleCount}</div>
          <div className="stats-label">呆滞订单</div>
        </Card>
        <Card className="stats-card" style={{ width: 160, height: 160, background: '#7e57c2', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <div className="stats-value" style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 20 }}>¥</span>
            <span style={{ fontSize: 22 }}>{Number(stats.totalAmount || 0).toFixed(2)}</span>
          </div>
          <div className="stats-label">库存总金额</div>
        </Card>
        <Card className="stats-card" style={{ width: 160, height: 160, background: '#4caf50', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <div className="stats-value" style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
            <span style={{ fontSize: 22 }}>{stats.healthScore}</span>
            <span className="stat-unit" style={{ fontSize: 14 }}>分</span>
          </div>
          <div className="stats-label">库存健康度</div>
        </Card>
      </div>
      <Card style={{ marginBottom: 12 }}>
        <Space wrap size={20}>
          <Select
            allowClear
            placeholder={(viewType!=='production') ? '筛选供应商' : '筛选客户'}
            options={(viewType!=='production') ? suppliers : customers}
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
              placeholder={(viewType!=='production') ? '搜索订单/供应商/商品/规格尺寸' : '搜索订单/客户/商品/物料号'}
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              allowClear
              style={{ width: 200 }}
            />
            <Button onClick={() => setKeyword(String(keyword || '').trim())}>搜索</Button>
          </Space.Compact>
          <Button type="primary" onClick={() => setImportOpen(true)}>导入库存</Button>
          <Button onClick={() => loadData({ force: true })} loading={loading}>刷新</Button>
        </Space>
      </Card>
      <Card>
        <Table
          rowKey="key"
          loading={loading}
          columns={columns}
          dataSource={filtered}
          pagination={{ pageSize: 20 }}
          scroll={{ x: 1000 }}
        />
      </Card>

      <Modal
        title="导入库存"
        open={importOpen}
        onOk={async () => {
          try {
            const values = await form.validateFields()
            const baseURL = String(api?.defaults?.baseURL || '')
            const isCloudBridge = baseURL.includes('api-bridge')
            const qty = Number(values.quantity || 0)
            const unitPrice = Number(values.unitPrice || 0)
            const isMeaningfulText = (v) => {
              const s = String(v ?? '').trim()
              if (!s) return false
              return !['-', '—', '--', '---', '暂无', '无'].includes(s)
            }
            if (!Number.isFinite(qty) || qty <= 0) {
              throw new Error('库存数量必须大于0')
            }
            if (viewType === 'production' && !isMeaningfulText(values.customerName)) {
              throw new Error('缺少必填参数：客户名称')
            }
            if (viewType !== 'production' && !isMeaningfulText(values.supplierName)) {
              throw new Error('缺少必填参数：供应商')
            }
            if (!isMeaningfulText(values.goodsName)) {
              throw new Error('缺少必填参数：商品名称')
            }
            const payload = {
              orderNo: `INV${dayjs().format('YYYYMMDDHHmmss')}`,
              customerName: viewType==='production' ? values.customerName : undefined,
              supplierName: (viewType!=='production') ? values.supplierName : undefined,
              customerId: (viewType === 'production' && isCloudBridge) ? (values.customerName || 'PC') : undefined,
              productTitle: values.goodsName,
              productName: values.goodsName,
              goodsName: values.goodsName,
              materialNo: values.materialNo,
              unit: values.unit || '片',
              unitPrice,
              quantity: qty,
              amount: Math.max(0, unitPrice * qty),
              totalAmount: Math.max(0, unitPrice * qty),
              stockedQty: qty,
              stockedAt: (values.stockedAt ? values.stockedAt.toDate() : new Date()).toISOString(),
              source: (viewType!=='production') ? 'purchased' : 'production',
              orderType: (viewType!=='production') ? 'purchase' : 'production',
              purchaseCategory: viewType === 'boards' ? 'boards' : 'goods',
              notes: values.notes
            }
            if (viewType === 'production' && isCloudBridge) {
              payload.items = [{
                name: values.goodsName,
                quantity: qty,
                unit: payload.unit,
                unitPrice,
                spec: values.materialNo
              }]
            }
            if (viewType !== 'production') {
              await cachedPurchaseAPI.createPurchaseOrder(payload)
            } else {
              await cachedOrderAPI.createOrder(payload)
            }
            message.success('库存已导入')
            form.resetFields()
            setImportOpen(false)
            loadData()
          } catch (e) {
            message.error('导入失败')
          }
        }}
        onCancel={() => { form.resetFields(); setImportOpen(false) }}
        destroyOnHidden
        forceRender
      >
        <Form form={form} layout="vertical">
          {viewType==='production' ? (
            <Form.Item name="customerName" label="客户名称" rules={[{ required: true, message: '请选择客户名称' }]}>
              <Select
                style={{ width: 280 }}
                placeholder="请选择客户"
                options={customers}
                showSearch
                optionFilterProp="label"
                allowClear
              />
            </Form.Item>
          ) : (
            <Form.Item name="supplierName" label="供应商" rules={[{ required: true, message: '请选择供应商' }]}>
              <Select
                style={{ width: 280 }}
                placeholder="请选择供应商"
                options={suppliers}
                showSearch
                optionFilterProp="label"
                allowClear
              />
            </Form.Item>
          )}
          <Form.Item name="goodsName" label="商品名称" rules={[{ required: true, message: '请输入商品名称' }]}>
            <Input placeholder="请输入商品名称" />
          </Form.Item>
          <Form.Item name="materialNo" label="型号规格">
            <Input placeholder="请输入型号规格" />
          </Form.Item>
          <Form.Item name="quantity" label="库存数量" rules={[{ required: true, message: '请输入数量' }]}>
            <Input type="number" placeholder="数量" />
          </Form.Item>
          <Form.Item name="unit" label="单位">
            <Input placeholder="单位（默认：片）" />
          </Form.Item>
          <Form.Item name="unitPrice" label="单价">
            <Input type="number" placeholder="单价" />
          </Form.Item>
          <Form.Item name="stockedAt" label="入库时间">
            <DatePicker showTime />
          </Form.Item>
          <Form.Item name="notes" label="备注">
            <Input.TextArea rows={3} placeholder="备注" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title="发货"
        open={shipModalOpen}
        onOk={handleConfirmShip}
        onCancel={() => { setShipModalOpen(false); setShipOrder(null); setShipQty('') }}
        destroyOnHidden
      >
        {shipOrder && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>订单编号：{shipOrder.orderNo}</div>
            {viewType !== 'production' ? (
              <>
                <div>供应商：{shipOrder.supplierName || shipOrder.customerName || '-'}</div>
                <div>商品名称：{shipOrder.goodsName}</div>
                <div>规格尺寸：{shipOrder.materialNo || shipOrder.spec || '-'}</div>
              </>
            ) : (
              <>
                <div>客户名称：{shipOrder.customerName}</div>
                <div>商品名称：{shipOrder.goodsName}</div>
                <div>物料号：{shipOrder.materialNo || '-'}</div>
                <div>规格尺寸：{shipOrder.spec || '-'}</div>
              </>
            )}
            <div>当前库存数量：{shipRemainQty}</div>
            <div style={{ marginTop: 8 }}>
              <div style={{ marginBottom: 4 }}>发货数量</div>
              <Input
                type="number"
                value={shipQty}
                onChange={e => setShipQty(e.target.value)}
                placeholder={shipRemainQty > 0 ? `最多可发 ${shipRemainQty}` : '暂无可发库存'}
                min={0}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default InventoryManagement
