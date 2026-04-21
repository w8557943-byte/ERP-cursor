import React, { useEffect, useMemo, useState } from 'react'
import { Card, Table, Space, Select, Input, Button, Tag } from 'antd'
import { ArrowUpOutlined, ArrowDownOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { cachedOrderAPI } from '../services/cachedAPI'

const PurchasedInventory = () => {
  const [loading, setLoading] = useState(false)
  const [orders, setOrders] = useState([])
  const [supplierFilter, setSupplierFilter] = useState(undefined)
  const [keyword, setKeyword] = useState('')
  const [sortField, setSortField] = useState('time')
  const [sortDir, setSortDir] = useState('desc')

  const loadData = async () => {
    setLoading(true)
    try {
      const res = await cachedOrderAPI.getOrders({ page: 1, pageSize: 500 })
      const data = Array.isArray(res?.data) ? res.data : (Array.isArray(res?.list) ? res.list : [])
      const list = (data || []).map((o, i) => {
        const items = Array.isArray(o.items) ? o.items : []
        const first = items[0] || {}
        const shipped = Number(o.shippedQty || o.deliveredQty || 0)
        const stocked = Number(o.stockedQty || 0)
        const inventoryQty = Math.max(0, stocked - shipped)
        const unit = o.unit || first.unit || '件'
        const stockedAtRaw = o.stockedAt || o.stockTime || (String(o.status||'').toLowerCase()==='stocked' ? (o.updatedAt || o.updateTime) : '')
        const stockedAtText = stockedAtRaw ? dayjs(stockedAtRaw).format('YYYY-MM-DD HH:mm') : ''
        const stockedAtTs = stockedAtRaw && dayjs(stockedAtRaw).isValid() ? dayjs(stockedAtRaw).valueOf() : 0
        const unitPrice = Number(o.unitPrice || first.unitPrice || 0)
        const quantity = Number(o.quantity || o.totalQty || (Array.isArray(o.items) ? o.items.reduce((s, it) => s + (Number(it.quantity)||0), 0) : 0))
        const createdAtRaw = o.createdAt || o.createTime || o.create_time || ''
        const createdAtTs = createdAtRaw && dayjs(createdAtRaw).isValid() ? dayjs(createdAtRaw).valueOf() : 0
        const supplierName = o.supplierName || o.supplier?.name || o.supplier || ''
        const isPurchased = !!(supplierName || String(o.source||'').toLowerCase()==='purchased' || String(o.purchaseType||'').toLowerCase()==='external' || o.isPurchased === true)
        return {
          key: o._id || o.id || `pinv_${i}`,
          orderNo: o.orderNo || o.orderNumber || '',
          supplierName,
          customerName: o.customerName || o.customer?.name || o.customer || '-',
          goodsName: o.goodsName || o.productTitle || first.goodsName || first.title || first.productName || o.goods_name || o.title || '-',
          spec: o.spec || first.spec || '-',
          materialNo: o.materialNo || first.materialNo || '-',
          inventoryQty,
          unit,
          stockedAtText,
          stockedAtTs,
          unitPrice,
          createdAtTs,
          quantity,
          amount: Number(o.amount || o.totalAmount || o.finalAmount || (quantity * unitPrice) || 0),
          isPurchased
        }
      })
      setOrders(list)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadData() }, [])

  const suppliers = useMemo(() => {
    const set = new Set((orders || []).filter(o => o.isPurchased).map(o => o.supplierName).filter(Boolean))
    return Array.from(set).map(s => ({ label: s, value: s }))
  }, [orders])

  const stats = useMemo(() => {
    const invOrders = (orders || []).filter(o => o.isPurchased && o.inventoryQty > 0)
    const invCount = invOrders.length
    const staleCount = invOrders.filter(o => (o.stockedAtTs ? dayjs().diff(o.stockedAtTs, 'month') >= 3 : false)).length
    const totalAmount = invOrders.reduce((s, o) => s + Number(o.inventoryQty || 0) * Number(o.unitPrice || 0), 0)
    const mStart = dayjs().startOf('month').valueOf()
    const mEnd = dayjs().endOf('month').valueOf()
    const monthOrders = (orders || []).filter(o => o.isPurchased && o.createdAtTs && o.createdAtTs >= mStart && o.createdAtTs <= mEnd)
    const monthInvOrders = monthOrders.filter(o => o.inventoryQty > 0)
    const ratio = monthOrders.length ? (monthInvOrders.length / monthOrders.length) : 0
    let score = 0
    if (ratio <= 0.1) score = 100
    else if (ratio >= 0.6) score = 0
    else score = Math.round(100 * (1 - ((ratio - 0.1) / 0.5)))
    return { invCount, staleCount, totalAmount, healthScore: score }
  }, [orders])

  const filtered = useMemo(() => {
    let list = (orders || []).filter(o => o.isPurchased)
    list = list.filter(o => o.inventoryQty > 0)
    if (supplierFilter) list = list.filter(o => o.supplierName === supplierFilter)
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
  }, [orders, supplierFilter, keyword, sortField, sortDir])

  const columns = [
    { title: '订单编号', dataIndex: 'orderNo', key: 'orderNo', width: 160 },
    { title: '供应商', dataIndex: 'supplierName', key: 'supplierName', width: 160 },
    { title: '商品名称', key: 'goods', width: 240, render: (_, r) => (
      <div>
        <div>{r.goodsName}</div>
        <div style={{ color: '#6b7280' }}>{r.materialNo}</div>
      </div>
    ) },
    { title: '库存订单金额', key: 'invAmount', width: 160, render: (_, r) => (
      <div style={{ color: '#ff4d4f' }}>¥{(Number(r.inventoryQty||0) * Number(r.unitPrice||0)).toFixed(2)}</div>
    ) },
    { title: '库存数量', key: 'inventory', width: 140, render: (_, r) => (
      <Space>
        <Tag color={r.inventoryQty > 0 ? 'blue' : 'default'}>{r.inventoryQty}</Tag>
        <span>{r.unit}</span>
      </Space>
    ) },
    { title: '入库时间', dataIndex: 'stockedAtText', key: 'stockedAtText', width: 180 },
  ]

  return (
    <div>
      <h2 className="page-title">外购产品库存</h2>

      <div style={{ display: 'flex', gap: 16, marginBottom: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Card className="stats-card" style={{ width: 160, height: 160, background: '#42a5f5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <div className="stats-value">{stats.invCount}</div>
          <div className="stats-label">外购库存订单</div>
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
            placeholder="筛选供应商"
            options={suppliers}
            value={supplierFilter}
            onChange={setSupplierFilter}
            style={{ width: 180 }}
          />
          <Select
            value={sortField}
            onChange={setSortField}
            options={[
              { label: '按入库时间排序', value: 'time' },
              { label: '按订单数量排序', value: 'qty' },
              { label: '按订单金额排序', value: 'amount' }
            ]}
            style={{ width: 220 }}
          />
          <Button
            shape="circle"
            onClick={() => setSortDir(sortDir === 'desc' ? 'asc' : 'desc')}
            icon={sortDir === 'desc' ? <ArrowDownOutlined /> : <ArrowUpOutlined />}
            title={sortDir === 'desc' ? '降序' : '升序'}
          />
          <Space.Compact>
            <Input
              placeholder="搜索订单/供应商/商品/物料号"
              value={keyword}
              onChange={e => setKeyword(e.target.value)}
              allowClear
              style={{ width: 260 }}
            />
            <Button onClick={() => setKeyword(String(keyword || '').trim())}>搜索</Button>
          </Space.Compact>
          <Button onClick={loadData} loading={loading}>刷新</Button>
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
    </div>
  )
}

export default PurchasedInventory
