import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Card, Form, Input, Select, Space, Button, App, ConfigProvider, Descriptions, Row, Col, Table, InputNumber, Tag } from 'antd'
import zhCN from 'antd/locale/zh_CN'
import { purchaseAPI, supplierAPI, customerAPI } from '../services/api'
import { cachedCustomerAPI, cachedCustomerSkuAPI } from '../services/cachedAPI'
import { useLocation, useNavigate } from 'react-router-dom'

function GoodsPurchase() {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const [suppliers, setSuppliers] = useState([])
  const [customers, setCustomers] = useState([])
  const [customersLoading, setCustomersLoading] = useState(false)
  const [customerSkus, setCustomerSkus] = useState([])
  const [customerSkusLoading, setCustomerSkusLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [reservedId, setReservedId] = useState()
  const reservedIdRef = useRef()
  const customerSearchRef = useRef({ timer: null, seq: 0 })
  const navigate = useNavigate()
  const location = useLocation()
  const submittingRef = useRef(false)
  const submittedRef = useRef(false)
  const orderNoErrorShownRef = useRef(false)

  const purchaseCategory = useMemo(() => {
    const sp = new URLSearchParams(location.search || '')
    const raw = String(sp.get('category') || location.state?.purchaseCategory || location.state?.category || '').trim().toLowerCase()
    if (raw === 'boards') return 'boards'
    if (raw === 'raw_materials' || raw === 'raw-materials' || raw === 'rawmaterials') return 'raw_materials'
    return 'goods'
  }, [location.search, location.state?.category, location.state?.purchaseCategory])

  const selectedCustomerId = Form.useWatch('customerId', form)
  const linesWatch = Form.useWatch('lines', form)
  const orderNoWatch = Form.useWatch('orderNo', form)

  const normalizeText = (v) => String(v == null ? '' : v).trim()
  const safeNumber = (v, fallback = 0) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  const formatMoney3 = (v) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return '-'
    return n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
  }

  const locked = useMemo(() => {
    const from = location.state?.from
    const cid = String(location.state?.customerId || location.state?.customer?.id || location.state?.customer?._id || '').trim()
    return Boolean(from === 'customer-skus' && cid)
  }, [location.state])

  const lockedCustomerId = useMemo(() => {
    const cid = String(location.state?.customerId || location.state?.customer?.id || location.state?.customer?._id || '').trim()
    return cid || undefined
  }, [location.state])

  const supplierOptions = useMemo(() => (suppliers || []).map((s) => {
    const value = s.name || s.companyName || s.title || s.id || s._id
    const label = s.shortName ? `${s.shortName} (${s.name || s.companyName || s.title || value || ''})` : (s.name || s.companyName || s.title || String(value || ''))
    return { value: String(value || label), label }
  }), [suppliers])

  const customerOptions = useMemo(() => (customers || []).map((c) => {
    const id = String(c?._id ?? c?.id ?? '').trim()
    const name = c.companyName || c.name || c.company || ''
    const label = c.shortName ? `${c.shortName} (${name})` : name
    return { value: id, label }
  }).filter((x) => x.value && x.label), [customers])

  const customerById = useMemo(() => {
    const map = new Map()
    ;(customers || []).forEach((c) => {
      const id = String(c?._id ?? c?.id ?? '').trim()
      if (!id) return
      map.set(id, c)
    })
    return map
  }, [customers])

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
    return (listC || []).map((c) => {
      const id = String(c?._id ?? c?.id ?? '').trim()
      return { ...c, id: id || undefined, _id: id || c?._id }
    })
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
        const normalized = normalizeCustomersResp(resp)
        if (customerSearchRef.current.seq !== seq) return
        setCustomers((prev) => mergeCustomerList(prev, normalized))
      } catch (_) {
        void 0
      } finally {
        if (customerSearchRef.current.seq === seq) setCustomersLoading(false)
      }
    }, 250)
  }

  useEffect(() => {
    const loadMeta = async () => {
      try {
        const res = await supplierAPI.getSuppliers({ page: 1, limit: 1000 })
        const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : []
        setSuppliers(list)
      } catch (_) {
        setSuppliers([])
      }
      try {
        const resC = await customerAPI.getCustomers({ page: 1, pageSize: 200, limit: 200 })
        setCustomers(normalizeCustomersResp(resC))
      } catch (_) {
        setCustomers([])
      }
    }
    loadMeta()
  }, [])

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
    if (!lockedCustomerId) return
    form.setFieldsValue({
      customerId: lockedCustomerId,
      customerName: normalizeText(location.state?.customer?.companyName || location.state?.customer?.name || ''),
      lines: Array.isArray(location.state?.skus) && location.state.skus.length
        ? location.state.skus.map((s) => {
          const sid = String(s?.id ?? s?._id ?? '').trim()
          return {
            skuId: sid || undefined,
            goodsName: normalizeText(s?.name || s?.goodsName || s?.productName) || undefined,
            materialNo: normalizeText(s?.materialNo) || undefined,
            specification: normalizeText(s?.specification) || undefined,
            orderQty: 0
          }
        })
        : undefined
    })
    const supplierNames = (Array.isArray(location.state?.skus) ? location.state.skus : [])
      .map((s) => normalizeText(s?.supplierName))
      .filter(Boolean)
    const uniq = Array.from(new Set(supplierNames))
    if (uniq.length === 1) {
      form.setFieldsValue({ supplierName: uniq[0] })
    }
  }, [form, lockedCustomerId, location.state])

  useEffect(() => {
    const cid = String(selectedCustomerId || '').trim()
    if (!cid) {
      setCustomerSkus([])
      return
    }
    let cancelled = false
    const extractList = (res) => {
      if (Array.isArray(res)) return res
      if (Array.isArray(res?.skus)) return res.skus
      if (Array.isArray(res?.data?.skus)) return res.data.skus
      if (Array.isArray(res?.data?.data?.skus)) return res.data.data.skus
      if (Array.isArray(res?.data)) return res.data
      if (Array.isArray(res?.data?.data)) return res.data.data
      if (Array.isArray(res?.data?.data?.list)) return res.data.data.list
      return []
    }
    const load = async () => {
      setCustomerSkusLoading(true)
      try {
        const pageSize = 200
        const maxPages = 50
        const all = []
        for (let page = 1; page <= maxPages; page += 1) {
          const resp = await cachedCustomerSkuAPI.getCustomerSkus({ customerId: cid, params: { page, pageSize, limit: pageSize } })
          const list = extractList(resp)
          if (list.length) all.push(...list)
          if (!list.length || list.length < pageSize) break
        }
        if (cancelled) return
        const normalized = (all || []).map((s) => {
          const sid = String(s?.id ?? s?._id ?? '').trim()
          return { ...s, id: sid || undefined, _id: sid || s?._id }
        })
        setCustomerSkus(normalized)
      } catch (_) {
        if (cancelled) return
        setCustomerSkus([])
      } finally {
        if (!cancelled) setCustomerSkusLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [selectedCustomerId])

  useEffect(() => {
    const cid = String(selectedCustomerId || '').trim()
    if (!cid) {
      form.setFieldsValue({ customerName: undefined })
      return
    }
    const c = customerById.get(cid) || null
    form.setFieldsValue({ customerName: normalizeText(c?.companyName || c?.name || c?.shortName) || undefined })
  }, [customerById, form, selectedCustomerId])

  useEffect(() => {
    reservedIdRef.current = reservedId
  }, [reservedId])

  useEffect(() => {
    const gen = async () => {
      try {
        const prevRid = reservedIdRef.current
        const prevNo = form.getFieldValue('orderNo')
        if (!submittedRef.current && (prevRid || prevNo)) {
          await purchaseAPI.releaseOrderNumber({ reservationId: prevRid, orderNumber: prevNo }).catch(() => {})
        }
        reservedIdRef.current = undefined
        setReservedId(undefined)
        submittedRef.current = false

        const res = await purchaseAPI.getNextOrderNumber()
        const payload = res?.data ?? res
        const no = payload?.orderNumber
        const rid = payload?.reservationId
        if (no) {
          form.setFieldsValue({ orderNo: no })
        }
        if (rid) {
          reservedIdRef.current = rid
          setReservedId(rid)
        }
        orderNoErrorShownRef.current = false
      } catch (_) {
        if (!orderNoErrorShownRef.current) {
          orderNoErrorShownRef.current = true
          message.error('订单号生成失败')
        }
      }
    }
    gen()
  }, [form, location.key, message])

  useEffect(() => {
    return () => {
      try {
        if (submittedRef.current) return
        const ono = form.getFieldValue('orderNo')
        if (reservedId || ono) {
          purchaseAPI.releaseOrderNumber({ reservationId: reservedId, orderNumber: ono }).catch(() => {})
        }
      } catch (_) { /* ignore */ }
    }
  }, [form, reservedId])

  const skuById = useMemo(() => {
    const map = new Map()
    ;(customerSkus || []).forEach((s) => {
      const sid = String(s?.id ?? s?._id ?? '').trim()
      if (!sid) return
      map.set(sid, s)
    })
    return map
  }, [customerSkus])

  const matchSkus = (input) => {
    const gn = normalizeText(input?.goodsName)
    const mn = normalizeText(input?.materialNo)
    const sp = normalizeText(input?.specification)
    if (!gn && !mn && !sp) return []
    return (customerSkus || []).filter((s) => {
      const sName = normalizeText(s?.name)
      const sMn = normalizeText(s?.materialNo)
      const sSp = normalizeText(s?.specification)
      if (gn && sName !== gn) return false
      if (mn && sMn !== mn) return false
      if (sp && sSp !== sp) return false
      return true
    })
  }

  const resolveLineSku = (index) => {
    const line = form.getFieldValue(['lines', index]) || {}
    const matches = matchSkus(line)
    if (matches.length !== 1) {
      if (line?.skuId) {
        const curr = Array.isArray(form.getFieldValue('lines')) ? form.getFieldValue('lines') : []
        form.setFieldsValue({ lines: curr.map((it, i) => (i === index ? { ...it, skuId: undefined } : it)) })
      }
      return
    }
    const sku = matches[0]
    const sid = String(sku?.id ?? sku?._id ?? '').trim()
    const patched = {
      skuId: sid || undefined,
      goodsName: normalizeText(sku?.name) || undefined,
      materialNo: normalizeText(sku?.materialNo) || undefined,
      specification: normalizeText(sku?.specification) || undefined
    }
    const curr = Array.isArray(form.getFieldValue('lines')) ? form.getFieldValue('lines') : []
    form.setFieldsValue({ lines: curr.map((it, i) => (i === index ? { ...it, ...patched } : it)) })
  }

  const deferResolveLineSku = (index) => {
    Promise.resolve().then(() => resolveLineSku(index))
  }

  const buildLineFieldOptions = (field, line) => {
    const rawLine = line || {}
    const gn = field === 'goodsName' ? '' : normalizeText(rawLine.goodsName)
    const mn = field === 'materialNo' ? '' : normalizeText(rawLine.materialNo)
    const sp = field === 'specification' ? '' : normalizeText(rawLine.specification)
    const hasOtherFilters = !!(gn || mn || sp)
    const candidates = hasOtherFilters ? matchSkus({ goodsName: gn, materialNo: mn, specification: sp }) : (customerSkus || [])
    if (hasOtherFilters && !candidates.length) return []

    const set = new Set()
    candidates.forEach((s) => {
      const v = field === 'goodsName'
        ? normalizeText(s?.name)
        : (field === 'materialNo' ? normalizeText(s?.materialNo) : normalizeText(s?.specification))
      if (v) set.add(v)
    })
    return Array.from(set).sort().map((v) => ({ value: v, label: v }))
  }

  const handleSubmit = async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const values = await form.validateFields()
      const baseOrderNo = normalizeText(values.orderNo)
      const cid = String(values.customerId || '').trim()
      const customer = cid ? (customerById.get(cid) || null) : null
      const customerName = normalizeText(values.customerName) || normalizeText(customer?.companyName || customer?.name || '')
      const supplierName = normalizeText(values.supplierName)

      if (!baseOrderNo) {
        message.warning('订单号生成中，请稍后再试')
        return
      }
      if (!cid) {
        message.error('请选择客户')
        return
      }
      if (!supplierName) {
        message.error('请选择供应商')
        return
      }

      const lines = Array.isArray(values.lines) ? values.lines : []
      const meaningful = lines
        .map((it, idx) => ({ it: it || {}, idx }))
        .filter(({ it }) => safeNumber(it?.orderQty, 0) > 0)
      if (!meaningful.length) {
        message.warning('请至少填写一条SKU的订单数量')
        return
      }

      const payloadItems = []
      for (const row of meaningful) {
        const line = row.it || {}
        const qty = safeNumber(line.orderQty, 0)
        const matches = line?.skuId ? [skuById.get(String(line.skuId || '').trim())].filter(Boolean) : matchSkus(line)
        if (matches.length !== 1) {
          message.warning(`第${row.idx + 1}行SKU未匹配，请完善商品名称/物料号/规格尺寸`)
          return
        }
        const sku = matches[0]
        const goodsName = normalizeText(sku?.name)
        const materialNo = normalizeText(sku?.materialNo)
        const specification = normalizeText(sku?.specification)
        const unit = normalizeText(sku?.unit) || '个'
        const purchaseUnitPrice = safeNumber(sku?.rawMaterialCost, 0)
        const listUnitPrice = safeNumber(sku?.unitPrice, 0)
        if (!(purchaseUnitPrice > 0)) {
          message.warning(`请完善采购单价：${goodsName || materialNo || 'SKU'}`)
          return
        }
        const itemOrderNo = meaningful.length > 1 ? `${baseOrderNo}-${row.idx + 1}` : baseOrderNo
        payloadItems.push({
          orderNo: itemOrderNo,
          orderNumber: itemOrderNo,
          category: normalizeText(sku?.category) || undefined,
          goodsName: goodsName || undefined,
          productName: goodsName || undefined,
          title: goodsName || undefined,
          materialNo: materialNo || undefined,
          specification: specification || undefined,
          spec: specification || undefined,
          boardWidth: sku?.boardWidth,
          boardHeight: sku?.boardHeight,
          materialCode: normalizeText(sku?.materialCode) || undefined,
          flute: normalizeText(sku?.flute) || undefined,
          quantity: qty,
          unit,
          unitPrice: purchaseUnitPrice,
          salePrice: purchaseUnitPrice,
          listUnitPrice: listUnitPrice || 0,
          amount: Math.max(0, qty * purchaseUnitPrice)
        })
      }

      const totalQty = payloadItems.reduce((s, it) => s + safeNumber(it?.quantity, 0), 0)
      const totalAmount = payloadItems.reduce((s, it) => s + safeNumber(it?.amount, 0), 0)
      const first = payloadItems[0] || {}
      const multi = payloadItems.length > 1
      const title = multi ? '多SKU' : normalizeText(first?.goodsName)

      const payload = {
        orderNo: baseOrderNo,
        reservationId: reservedId,
        customerId: cid,
        customerName: customerName || undefined,
        supplierName,
        goodsName: title || undefined,
        productTitle: title || undefined,
        productName: title || undefined,
        materialNo: multi ? undefined : (normalizeText(first?.materialNo) || undefined),
        specification: multi ? undefined : (normalizeText(first?.specification) || undefined),
        quantity: totalQty,
        unit: normalizeText(first?.unit) || '个',
        salePrice: multi ? 0 : safeNumber(first?.salePrice, 0),
        unitPrice: multi ? 0 : safeNumber(first?.listUnitPrice, 0),
        amount: totalAmount,
        items: payloadItems,
        purchaseCategory,
        orderType: 'purchase',
        source: 'purchased',
        createdAt: new Date().toISOString(),
        notes: values.notes
      }

      const res = await purchaseAPI.createPurchaseOrder({ ...payload, reservationId: reservedId })
      const serverNo = res?.data?.orderNo || res?.data?.orderNumber || payload.orderNo
      message.success(serverNo ? `商品采购单已新增（编号：${serverNo}）` : '商品采购单已新增')
      if (serverNo) purchaseAPI.confirmOrderNumber(serverNo).catch(() => { })

      submittedRef.current = true
      setReservedId(undefined)
      navigate('/purchase', { state: { viewType: 'goods' } })
    } catch (e) {
      const msg = e?.response?.data?.message || e?.message || '提交失败'
      message.error(msg)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  const handleCancel = async () => {
    try {
      const ono = form.getFieldValue('orderNo')
      if (reservedId || ono) {
        await purchaseAPI.releaseOrderNumber({ reservationId: reservedId, orderNumber: ono })
      }
    } catch (_) { /* ignore */ }
    setReservedId(undefined)
    navigate('/purchase', { state: { viewType: 'goods' } })
  }

  const selectedCustomer = useMemo(() => {
    const cid = String(selectedCustomerId || '').trim()
    if (!cid) return null
    return customerById.get(cid) || null
  }, [customerById, selectedCustomerId])

  const totals = useMemo(() => {
    const lines = Array.isArray(linesWatch) ? linesWatch : []
    const rows = lines
      .map((it, idx) => ({ it: it || {}, idx }))
      .filter(({ it }) => safeNumber(it?.orderQty, 0) > 0)
    return rows.reduce((acc, r) => {
      const qty = safeNumber(r.it?.orderQty, 0)
      const sku = r.it?.skuId ? skuById.get(String(r.it.skuId || '').trim()) : null
      const up = safeNumber(sku?.unitPrice, 0)
      const rp = safeNumber(sku?.rawMaterialCost, 0)
      const sc = safeNumber(sku?.sheetCount, 0)
      const sheetCount = sc > 0 ? sc : 1
      acc.profit += qty > 0 ? qty * (up - rp * sheetCount) : 0
      acc.sales += qty > 0 ? qty * up : 0
      return acc
    }, { profit: 0, sales: 0 })
  }, [linesWatch, skuById])

  return (
    <ConfigProvider locale={zhCN}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 className="page-title" style={{ margin: 0 }}>商品采购 - 新建订单</h2>
          <Button onClick={handleCancel}>返回</Button>
        </div>

        <Form form={form} layout="vertical" initialValues={{ lines: [{ skuId: undefined, goodsName: undefined, materialNo: undefined, specification: undefined, orderQty: 0 }] }}>
          <Form.Item name="customerName" hidden>
            <Input />
          </Form.Item>
          <Form.Item name="orderNo" hidden>
            <Input />
          </Form.Item>

          <Card title="客户信息" style={{ marginBottom: 12 }}>
            <Row gutter={12}>
              <Col xs={24} md={12}>
                <Form.Item name="customerId" label="客户名称" rules={[{ required: true, message: '请选择客户' }]}>
                  <Select
                    placeholder="请选择客户"
                    options={customerOptions}
                    showSearch
                    optionFilterProp="label"
                    allowClear
                    disabled={locked}
                    loading={customersLoading || customerSkusLoading}
                    onSearch={remoteSearchCustomers}
                  />
                </Form.Item>
              </Col>
              <Col xs={24} md={12}>
                <Form.Item name="supplierName" label="供应商" rules={[{ required: true, message: '请选择供应商' }]}>
                  <Select
                    placeholder="请选择供应商"
                    options={supplierOptions}
                    showSearch
                    optionFilterProp="label"
                    allowClear
                  />
                </Form.Item>
              </Col>
            </Row>

            <Descriptions size="small" column={3}>
              <Descriptions.Item label="客户名称">{selectedCustomer?.companyName || selectedCustomer?.name || '-'}</Descriptions.Item>
              <Descriptions.Item label="客户简称">{selectedCustomer?.shortName || '-'}</Descriptions.Item>
              <Descriptions.Item label="联系人">{selectedCustomer?.contactName || selectedCustomer?.contact || '-'}</Descriptions.Item>
              <Descriptions.Item label="联系电话">{selectedCustomer?.phone || '-'}</Descriptions.Item>
              <Descriptions.Item label="地址" span={2}>{selectedCustomer?.address || '-'}</Descriptions.Item>
            </Descriptions>
          </Card>

          <Card title="产品列表" style={{ marginBottom: 12 }}>
            <Form.List name="lines">
              {(fields, { add, remove }) => {
                const columns = [
                  {
                    title: '订单号',
                    key: 'orderNo',
                    width: 140,
                    render: (_, f) => {
                      const base = normalizeText(orderNoWatch)
                      if (!base) return '-'
                      const lineCount = Array.isArray(linesWatch) ? linesWatch.length : 0
                      if (lineCount <= 1) return base
                      const idx = Number(f?.name)
                      const suffix = Number.isFinite(idx) ? (idx + 1) : ''
                      return suffix ? `${base}-${suffix}` : base
                    }
                  },
                  {
                    title: '商品名称',
                    key: 'goodsName',
                    width: 180,
                    render: (_, f) => {
                      const idx = Number(f?.name)
                      const line = form.getFieldValue(['lines', idx]) || {}
                      const sku = line?.skuId ? skuById.get(String(line.skuId || '').trim()) : null
                      const isOutsourced = normalizeText(sku?.productionMode) === 'outsourced'
                      return (
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <Form.Item name={[f.name, 'goodsName']} style={{ margin: 0, flex: 1 }}>
                            <Select
                              placeholder={selectedCustomerId ? '请选择' : '请先选择客户'}
                              loading={customerSkusLoading}
                              disabled={!selectedCustomerId}
                              allowClear
                              showSearch
                              optionFilterProp="label"
                              options={buildLineFieldOptions('goodsName', line)}
                              onChange={() => deferResolveLineSku(f.name)}
                            />
                          </Form.Item>
                          {isOutsourced ? <Tag color="orange" style={{ marginInlineEnd: 0 }}>外采购</Tag> : null}
                        </div>
                      )
                    }
                  },
                  {
                    title: '物料号',
                    key: 'materialNo',
                    width: 160,
                    render: (_, f) => {
                      const idx = Number(f?.name)
                      const line = form.getFieldValue(['lines', idx]) || {}
                      return (
                        <Form.Item name={[f.name, 'materialNo']} style={{ margin: 0 }}>
                          <Select
                            placeholder={selectedCustomerId ? '请选择' : '请先选择客户'}
                            loading={customerSkusLoading}
                            disabled={!selectedCustomerId}
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            options={buildLineFieldOptions('materialNo', line)}
                            onChange={() => deferResolveLineSku(f.name)}
                          />
                        </Form.Item>
                      )
                    }
                  },
                  {
                    title: '规格尺寸',
                    key: 'specification',
                    width: 160,
                    render: (_, f) => {
                      const idx = Number(f?.name)
                      const line = form.getFieldValue(['lines', idx]) || {}
                      return (
                        <Form.Item name={[f.name, 'specification']} style={{ margin: 0 }}>
                          <Select
                            placeholder={selectedCustomerId ? '请选择' : '请先选择客户'}
                            loading={customerSkusLoading}
                            disabled={!selectedCustomerId}
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            options={buildLineFieldOptions('specification', line)}
                            onChange={() => deferResolveLineSku(f.name)}
                          />
                        </Form.Item>
                      )
                    }
                  },
                  {
                    title: '订单数量',
                    key: 'orderQty',
                    width: 110,
                    align: 'right',
                    render: (_, f) => (
                      <Form.Item name={[f.name, 'orderQty']} style={{ margin: 0 }}>
                        <InputNumber min={0} style={{ width: 100 }} />
                      </Form.Item>
                    )
                  },
                  {
                    title: '单位',
                    key: 'unit',
                    width: 70,
                    align: 'center',
                    render: (_, f) => {
                      const idx = Number(f?.name)
                      const line = form.getFieldValue(['lines', idx]) || {}
                      const sku = line?.skuId ? skuById.get(String(line.skuId || '').trim()) : null
                      return normalizeText(sku?.unit) || '-'
                    }
                  },
                  {
                    title: '单价元',
                    key: 'unitPrice',
                    width: 110,
                    align: 'right',
                    render: (_, f) => {
                      const idx = Number(f?.name)
                      const line = form.getFieldValue(['lines', idx]) || {}
                      const sku = line?.skuId ? skuById.get(String(line.skuId || '').trim()) : null
                      const v = safeNumber(sku?.unitPrice, NaN)
                      return Number.isFinite(v) ? formatMoney3(v) : '-'
                    }
                  },
                  {
                    title: '原材料单价元',
                    key: 'rawUnitPrice',
                    width: 120,
                    align: 'right',
                    render: (_, f) => {
                      const idx = Number(f?.name)
                      const line = form.getFieldValue(['lines', idx]) || {}
                      const sku = line?.skuId ? skuById.get(String(line.skuId || '').trim()) : null
                      const v = safeNumber(sku?.rawMaterialCost, NaN)
                      return Number.isFinite(v) ? formatMoney3(v) : '-'
                    }
                  },
                  {
                    title: '毛利润元',
                    key: 'profit',
                    width: 120,
                    align: 'right',
                    render: (_, f) => {
                      const idx = Number(f?.name)
                      const line = form.getFieldValue(['lines', idx]) || {}
                      const qty = safeNumber(line?.orderQty, 0)
                      const sku = line?.skuId ? skuById.get(String(line.skuId || '').trim()) : null
                      const up = safeNumber(sku?.unitPrice, 0)
                      const rp = safeNumber(sku?.rawMaterialCost, 0)
                      const sc = safeNumber(sku?.sheetCount, 0)
                      const sheetCount = sc > 0 ? sc : 1
                      const val = qty > 0 ? qty * (up - rp * sheetCount) : 0
                      return formatMoney3(val)
                    }
                  },
                  {
                    title: '订单金额元',
                    key: 'amount',
                    width: 120,
                    align: 'right',
                    render: (_, f) => {
                      const idx = Number(f?.name)
                      const line = form.getFieldValue(['lines', idx]) || {}
                      const qty = safeNumber(line?.orderQty, 0)
                      const sku = line?.skuId ? skuById.get(String(line.skuId || '').trim()) : null
                      const up = safeNumber(sku?.unitPrice, 0)
                      const val = qty > 0 ? qty * up : 0
                      return formatMoney3(val)
                    }
                  },
                  {
                    title: '操作',
                    key: 'action',
                    width: 70,
                    render: (_, f) => (
                      <Button
                        type="link"
                        danger
                        onClick={() => remove(f.name)}
                        disabled={fields.length <= 1}
                      >
                        删除
                      </Button>
                    )
                  }
                ]

                return (
                  <div>
                    <Space style={{ marginBottom: 12 }}>
                      <Button onClick={() => add({ skuId: undefined, goodsName: undefined, materialNo: undefined, specification: undefined, orderQty: 0 })} disabled={!selectedCustomerId}>
                        添加产品
                      </Button>
                    </Space>
                    <Table
                      columns={columns}
                      dataSource={fields}
                      pagination={false}
                      rowKey={(f) => f.key}
                      loading={customerSkusLoading}
                      scroll={{ x: 1200 }}
                      summary={() => (
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0} colSpan={99} align="right">
                            毛利润：{formatMoney3(totals.profit)}元，订单金额：{formatMoney3(totals.sales)}元
                          </Table.Summary.Cell>
                        </Table.Summary.Row>
                      )}
                    />
                  </div>
                )
              }}
            </Form.List>
          </Card>

          <Card title="备注" style={{ marginBottom: 12 }}>
            <Form.Item name="notes">
              <Input.TextArea placeholder="备注" rows={3} />
            </Form.Item>
          </Card>

          <Space size={12}>
            <Button type="primary" onClick={handleSubmit} loading={submitting}>保存</Button>
            <Button onClick={handleCancel}>取消</Button>
          </Space>
        </Form>
      </div>
    </ConfigProvider>
  )
}

export default GoodsPurchase
