import React, { useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Card, Descriptions, InputNumber, Space, Table } from 'antd'
import { ArrowLeftOutlined } from '@ant-design/icons'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { orderAPI } from '../services/api'
import { cachedCustomerAPI } from '../services/cachedAPI'
import { safeNavigateBack } from '../utils'

function CustomerOrderCreate() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams()

  const submittedRef = useRef(false)
  const [loading, setLoading] = useState(false)
  const [orderNoLoading, setOrderNoLoading] = useState(false)
  const [orderNo, setOrderNo] = useState('')
  const [reservedId, setReservedId] = useState()
  const [customer, setCustomer] = useState(null)
  const [items, setItems] = useState([])

  const stateCustomer = location?.state?.customer
  const stateSkus = Array.isArray(location?.state?.skus) ? location.state.skus : []
  const customerId = String(stateCustomer?._id ?? stateCustomer?.id ?? id ?? '').trim()

  const normalizeText = (v) => String(v == null ? '' : v).trim()

  const extractErrorMessage = (e) => {
    const msg =
      e?.response?.data?.message ||
      e?.response?.data?.error ||
      e?.message ||
      ''
    return normalizeText(msg)
  }

  const formatMoney = (v) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return '-'
    return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })
  }

  useEffect(() => {
    const loadCustomer = async () => {
      if (stateCustomer && typeof stateCustomer === 'object') {
        const cid = String(stateCustomer?._id ?? stateCustomer?.id ?? '').trim()
        setCustomer({ ...stateCustomer, id: cid || undefined, _id: cid || undefined })
        return
      }
      if (!customerId) return
      try {
        const res = await cachedCustomerAPI.getCustomer(customerId)
        const data = res?.data ?? res
        const c = data?.data?.customer ?? data?.customer ?? data
        if (!c) return
        const cid = String(c?._id ?? c?.id ?? customerId).trim()
        setCustomer({ ...c, id: cid, _id: cid })
      } catch (e) {
        const detail = extractErrorMessage(e)
        message.error(`加载客户信息失败${detail ? `：${detail}` : ''}`)
      }
    }
    loadCustomer()
  }, [customerId, message, stateCustomer])

  useEffect(() => {
    if (!stateSkus.length) {
      message.warning('未选择SKU')
      safeNavigateBack(navigate, customerId ? `/customers/${customerId}` : '/customers')
      return
    }
    const next = stateSkus.map((s, idx) => {
      const sid = String(s?.id ?? s?._id ?? '').trim() || `sku_${idx}`
      const sheetCount = Number(s?.sheetCount || 0)
      const unitPrice = Number(s?.unitPrice || 0)
      const rawMaterialCost = Number(s?.rawMaterialCost || 0)
      return {
        key: sid,
        skuId: sid,
        category: normalizeText(s?.category || ''),
        goodsName: normalizeText(s?.name || ''),
        materialNo: normalizeText(s?.materialNo || ''),
        specification: normalizeText(s?.specification || ''),
        boardWidth: s?.boardWidth,
        boardHeight: s?.boardHeight,
        materialCode: normalizeText(s?.materialCode || ''),
        flute: normalizeText(s?.flute || ''),
        creasingSize1: s?.creasingSize1 ?? s?.creaseSize1,
        creasingSize2: s?.creasingSize2 ?? s?.creaseSize2,
        creasingSize3: s?.creasingSize3 ?? s?.creaseSize3,
        creasingType: normalizeText(s?.creasingType || s?.creaseType || ''),
        pressLine: normalizeText(s?.pressLine || s?.press_line || ''),
        pressLineSize: normalizeText(s?.pressLineSize || s?.press_line_size || ''),
        creasingSize: normalizeText(s?.creasingSize || s?.creaseSize || ''),
        skuSheetCount: Number.isFinite(sheetCount) && sheetCount > 0 ? sheetCount : 0,
        orderQty: 0,
        unitPrice: Number.isFinite(unitPrice) && unitPrice >= 0 ? unitPrice : 0,
        rawUnitPrice: Number.isFinite(rawMaterialCost) && rawMaterialCost >= 0 ? rawMaterialCost : 0,
        unit: normalizeText(s?.unit || '') || '个'
      }
    })
    setItems(next)
  }, [message, navigate, stateSkus])

  const getOrderedSheets = (it) => {
    const perUnit = Number(it?.skuSheetCount || 0)
    const qty = Number(it?.orderQty || 0)
    if (!Number.isFinite(perUnit) || !Number.isFinite(qty) || perUnit <= 0 || qty <= 0) return 0
    return perUnit * qty
  }

  useEffect(() => {
    const reserve = async () => {
      setOrderNoLoading(true)
      try {
        const res = await orderAPI.getNextOrderNumber()
        const payload = res?.data ?? res
        const data = payload?.data ?? payload
        const no = normalizeText(data?.orderNumber ?? data?.orderNo)
        const rid = data?.reservationId
        if (no) setOrderNo(no)
        if (rid) setReservedId(rid)
      } catch (e) {
        const detail = extractErrorMessage(e)
        message.error(`订单号生成失败${detail ? `：${detail}` : ''}`)
      } finally {
        setOrderNoLoading(false)
      }
    }
    reserve()
  }, [message])

  useEffect(() => {
    return () => {
      if (submittedRef.current) return
      const no = normalizeText(orderNo)
      const rid = reservedId
      if (!no && !rid) return
      orderAPI.releaseOrderNumber({ reservationId: rid, orderNumber: no }).catch(() => { })
    }
  }, [orderNo, reservedId])

  const totals = useMemo(() => {
    const meaningful = (items || []).filter((it) => (Number(it?.orderQty || 0) || 0) > 0)
    const totalAmount = meaningful.reduce((sum, it) => sum + (Number(it.orderQty || 0) * Number(it.unitPrice || 0)), 0)
    const totalGrossProfit = meaningful.reduce((sum, it) => {
      const qty = Number(it?.orderQty || 0)
      const up = Number(it?.unitPrice || 0)
      const rp = Number(it?.rawUnitPrice || 0)
      const perSheet = Number(it?.skuSheetCount || 0)
      const sheetCount = Number.isFinite(perSheet) && perSheet > 0 ? perSheet : 1
      return sum + qty * (up - rp * sheetCount)
    }, 0)
    const totalSheetCount = meaningful.reduce((sum, it) => sum + getOrderedSheets(it), 0)
    return {
      totalAmount,
      totalGrossProfit,
      totalSheetCount
    }
  }, [items])

  const updateItem = (key, patch) => {
    const k = String(key || '').trim()
    if (!k) return
    setItems((prev) => (prev || []).map((it) => (String(it?.key || '') === k ? { ...it, ...(patch || {}) } : it)))
  }

  const columns = useMemo(() => ([
    {
      title: '产品类别',
      dataIndex: 'category',
      key: 'category',
      width: 110,
      ellipsis: true,
      render: (v) => normalizeText(v) || '-'
    },
    {
      title: '商品名称',
      dataIndex: 'goodsName',
      key: 'goodsName',
      width: 180,
      ellipsis: true,
      render: (v) => normalizeText(v) || '-'
    },
    {
      title: '物料号',
      dataIndex: 'materialNo',
      key: 'materialNo',
      width: 140,
      ellipsis: true,
      render: (v) => normalizeText(v) || '-'
    },
    {
      title: '规格尺寸',
      dataIndex: 'specification',
      key: 'specification',
      width: 140,
      ellipsis: true,
      render: (v, r) => {
        const bw = Number(r?.boardWidth || 0)
        const bh = Number(r?.boardHeight || 0)
        const sizeText = bw > 0 && bh > 0 ? `${bw}×${bh}` : '-'
        const parseCreaseText = (val) => {
          const s = normalizeText(val)
          if (!s) return null
          const nums = (s.match(/-?\d+(\.\d+)?/g) || []).map((n) => Number(n)).filter((n) => Number.isFinite(n))
          if (nums.length < 2) return null
          const [a, b, c] = [nums[0] || 0, nums[1] || 0, nums[2] || 0]
          const typeMatch = s.match(/[（(]([^（）()]+)[）)]/)
          const type = normalizeText(typeMatch ? typeMatch[1] : '')
          return { c1: a, c2: b, c3: c, type }
        }
        const c1 = Number(r?.creasingSize1 ?? r?.creaseSize1 ?? 0)
        const c2 = Number(r?.creasingSize2 ?? r?.creaseSize2 ?? 0)
        const c3 = Number(r?.creasingSize3 ?? r?.creaseSize3 ?? 0)
        const type = normalizeText(r?.creasingType ?? r?.creaseType ?? '')
        const hasNums = Boolean(c1 || c2 || c3)
        const fromAny = parseCreaseText(
          r?.pressLine ?? r?.press_line ??
          r?.creasingSize ?? r?.creaseSize ?? r?.pressLineSize ?? r?.press_line_size
        )
        const resolvedType = type || (fromAny?.type || '')
        const resolvedC1 = hasNums ? c1 : (fromAny?.c1 || 0)
        const resolvedC2 = hasNums ? c2 : (fromAny?.c2 || 0)
        const resolvedC3 = hasNums ? c3 : (fromAny?.c3 || 0)
        const resolvedHasNums = Boolean(resolvedC1 || resolvedC2 || resolvedC3)
        let creaseText = '-'
        if (resolvedHasNums) {
          creaseText = `${resolvedC1}-${resolvedC2}-${resolvedC3}${resolvedType ? ` (${resolvedType})` : ''}`
        } else if (resolvedType) {
          creaseText = resolvedType
        }
        return (
          <div style={{ lineHeight: 1.25 }}>
            <div>{normalizeText(v) || '-'}</div>
            <div style={{ fontSize: '12px', color: '#888' }}>纸板尺寸：{sizeText}</div>
            <div style={{ fontSize: '12px', color: '#888' }}>压线尺寸：{creaseText}</div>
          </div>
        )
      }
    },
    {
      title: '原材料信息',
      key: 'raw',
      width: 170,
      render: (_, r) => {
        const materialCode = normalizeText(r?.materialCode) || '-'
        const flute = normalizeText(r?.flute) || '-'
        return (
          <div style={{ lineHeight: 1.25 }}>
            <div><span style={{ color: '#888' }}>材质编码：</span>{materialCode}</div>
            <div><span style={{ color: '#888' }}>楞别：</span>{flute}</div>
          </div>
        )
      }
    },
    {
      title: '订单数量',
      dataIndex: 'orderQty',
      key: 'orderQty',
      width: 110,
      align: 'right',
      render: (v, r) => (
        <InputNumber
          min={0}
          value={Number(v || 0)}
          style={{ width: 100 }}
          onChange={(val) => updateItem(r.key, { orderQty: Number(val || 0) })}
        />
      )
    },
    {
      title: '下单片数',
      key: 'orderedSheets',
      width: 110,
      align: 'right',
      render: (_, r) => (
        <InputNumber
          min={0}
          value={getOrderedSheets(r)}
          style={{ width: 100 }}
          disabled
        />
      )
    },
    {
      title: '单价',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: 110,
      align: 'right',
      render: (v, r) => (
        <InputNumber
          min={0}
          value={Number(v || 0)}
          style={{ width: 100 }}
          onChange={(val) => updateItem(r.key, { unitPrice: Number(val || 0) })}
        />
      )
    },
    {
      title: '原材料单价',
      dataIndex: 'rawUnitPrice',
      key: 'rawUnitPrice',
      width: 120,
      align: 'right',
      render: (v, r) => (
        <InputNumber
          min={0}
          value={Number(v || 0)}
          style={{ width: 110 }}
          onChange={(val) => updateItem(r.key, { rawUnitPrice: Number(val || 0) })}
        />
      )
    },
    {
      title: '毛利润',
      key: 'grossProfit',
      width: 120,
      align: 'right',
      render: (_, r) => {
        const qty = Number(r?.orderQty || 0)
        const perSheet = Number(r?.skuSheetCount || 0)
        const sheetCount = Number.isFinite(perSheet) && perSheet > 0 ? perSheet : 1
        const profit = qty * (Number(r?.unitPrice || 0) - Number(r?.rawUnitPrice || 0) * sheetCount)
        return formatMoney(profit)
      }
    },
    {
      title: '订单金额',
      key: 'amount',
      width: 120,
      align: 'right',
      render: (_, r) => {
        const amount = Number(r?.orderQty || 0) * Number(r?.unitPrice || 0)
        return formatMoney(amount)
      }
    }
  ]), [])

  const handleSubmit = async () => {
    if (orderNoLoading || !normalizeText(orderNo)) {
      message.warning('订单号生成中，请稍后再试')
      return
    }
    const c = customer || {}
    const customerName = normalizeText(c?.companyName || c?.name || c?.shortName)
    if (!customerId) {
      message.error('客户ID缺失')
      return
    }
    if (!customerName) {
      message.error('客户信息缺失')
      return
    }
    const meaningfulItems = (items || []).filter((it) => Number(it?.orderQty || 0) > 0)
    if (!meaningfulItems.length) {
      message.warning('请至少填写一条SKU的订单数量')
      return
    }
    const invalidPriceItems = meaningfulItems.filter((it) => !(Number(it?.unitPrice) > 0))
    if (invalidPriceItems.length) {
      const first = invalidPriceItems[0] || {}
      message.warning(`请完善单价：${normalizeText(first?.goodsName) || normalizeText(first?.materialNo) || 'SKU'}`)
      return
    }

    setLoading(true)
    try {
      const totalQty = meaningfulItems.reduce((sum, it) => sum + (Number(it.orderQty || 0) || 0), 0)
      const totalSheetCount = meaningfulItems.reduce((sum, it) => sum + getOrderedSheets(it), 0)
      const payloadItems = meaningfulItems.map((it) => {
        const orderQty = Number(it.orderQty || 0) || 0
        const sheetCount = getOrderedSheets(it)
        const unitPrice = Number(it.unitPrice || 0) || 0
        const rawUnitPrice = Number(it.rawUnitPrice || 0) || 0
        return {
          category: normalizeText(it.category) || undefined,
          productName: normalizeText(it.goodsName) || undefined,
          goodsName: normalizeText(it.goodsName),
          title: normalizeText(it.goodsName),
          materialNo: normalizeText(it.materialNo) || undefined,
          spec: normalizeText(it.specification) || undefined,
          specification: normalizeText(it.specification) || undefined,
          boardWidth: it.boardWidth,
          boardHeight: it.boardHeight,
          materialCode: normalizeText(it.materialCode) || undefined,
          flute: normalizeText(it.flute) || undefined,
          quantity: orderQty,
          orderQuantity: orderQty,
          orderedQuantity: sheetCount,
          sheetCount,
          unit: normalizeText(it.unit) || '个',
          unitPrice,
          rawUnitPrice,
          grossProfit: (orderQty * unitPrice) - (sheetCount * rawUnitPrice),
          amount: orderQty * unitPrice
        }
      })

      const first = payloadItems[0] || {}
      const productName = payloadItems.length === 1 ? (first.goodsName || first.productName || undefined) : '多SKU'
      const totalAmount = totals.totalAmount

      const createPayload = {
        orderNo: normalizeText(orderNo),
        reservationId: reservedId,
        customerId: customerId || undefined,
        customerName,
        productName,
        goodsName: first.goodsName || undefined,
        quantity: totalQty,
        unit: first.unit || '个',
        unitPrice: undefined,
        amount: totalAmount,
        totalAmount,
        sheetCount: totalSheetCount,
        status: 'ordered',
        source: 'pc',
        items: payloadItems,
        meta: {
          totalGrossProfit: totals.totalGrossProfit
        },
        createdAt: Date.now()
      }

      const res = await orderAPI.createOrder(createPayload)
      const body = res?.data ?? res
      if (body && typeof body === 'object' && body.success === false) {
        throw new Error(body.message || '订单创建失败')
      }
      submittedRef.current = true
      orderAPI.confirmOrderNumber(normalizeText(orderNo)).catch(() => { })
      message.success(`订单已创建（编号：${normalizeText(orderNo)}）`)
      navigate('/production')
    } catch (e) {
      const detail = extractErrorMessage(e)
      message.error(detail || '提交失败')
    } finally {
      setLoading(false)
    }
  }

  const handleBack = async () => {
    if (!submittedRef.current) {
      const no = normalizeText(orderNo)
      const rid = reservedId
      if (no || rid) {
        await orderAPI.releaseOrderNumber({ reservationId: rid, orderNumber: no }).catch(() => { })
      }
    }
    safeNavigateBack(navigate, customerId ? `/customers/${customerId}` : '/customers')
  }

  const customerName = normalizeText(customer?.companyName || customer?.name || customer?.shortName)

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 className="page-title" style={{ margin: 0 }}>创建订单</h2>
        <Space>
          <Button icon={<ArrowLeftOutlined />} onClick={handleBack}>返回</Button>
        </Space>
      </div>

      <Card style={{ marginBottom: 12 }} loading={orderNoLoading}>
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="订单号">{orderNo || '-'}</Descriptions.Item>
          <Descriptions.Item label="客户名称">{customerName || '-'}</Descriptions.Item>
          <Descriptions.Item label="客户ID">{customerId || '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="客户信息" style={{ marginBottom: 12 }} loading={!customer && Boolean(customerId)}>
        <Descriptions size="small" column={3}>
          <Descriptions.Item label="客户名称">{customer?.companyName || customer?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="客户简称">{customer?.shortName || '-'}</Descriptions.Item>
          <Descriptions.Item label="联系人">{customer?.contactName || customer?.contact || '-'}</Descriptions.Item>
          <Descriptions.Item label="联系电话">{customer?.phone || '-'}</Descriptions.Item>
          <Descriptions.Item label="地址" span={2}>{customer?.address || '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="产品列表" style={{ marginBottom: 12 }}>
        <Table
          columns={columns}
          dataSource={items}
          rowKey={(r) => r.key}
          pagination={false}
          scroll={{ x: 1250 }}
          summary={() => (
            <Table.Summary.Row>
              <Table.Summary.Cell index={0} colSpan={9} align="right">汇总</Table.Summary.Cell>
              <Table.Summary.Cell index={9} align="right">{formatMoney(totals.totalGrossProfit)}</Table.Summary.Cell>
              <Table.Summary.Cell index={10} align="right">{formatMoney(totals.totalAmount)}</Table.Summary.Cell>
            </Table.Summary.Row>
          )}
        />
      </Card>

      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <Space>
          <Button onClick={handleBack}>返回</Button>
          <Button type="primary" onClick={handleSubmit} loading={loading}>提交订单</Button>
        </Space>
      </div>
    </div>
  )
}

export default CustomerOrderCreate
