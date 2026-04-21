import React, { useEffect, useMemo, useRef, useState } from 'react'
import { Card, Descriptions, Form, Input, Select, Button, App, Row, Col, Space, InputNumber, Typography, Table, Tag } from 'antd'
import { useNavigate, useParams, useLocation } from 'react-router-dom'
import dayjs from 'dayjs'
import { orderAPI, customerAPI, api } from '../services/api'
import { cachedCustomerAPI, cachedCustomerSkuAPI } from '../services/cachedAPI'

function OrderCreate() {
  const { message } = App.useApp()
  const [form] = Form.useForm()
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams()
  const isEdit = !!id
  const [customers, setCustomers] = useState([])
  const [customersLoading, setCustomersLoading] = useState(false)
  const [customersSearching, setCustomersSearching] = useState(false)
  const customerSearchRef = useRef({ timer: null, seq: 0 })
  const [customerSkus, setCustomerSkus] = useState([])
  const [customerSkusLoading, setCustomerSkusLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const [reservedId, setReservedId] = useState()
  const submittingRef = useRef(false)
  const submittedRef = useRef(false)

  const selectedCustomerId = Form.useWatch('customerId', form)
  const linesWatch = Form.useWatch('lines', form)
  const orderNoWatch = Form.useWatch('orderNo', form)

  const normalizeText = (v) => String(v == null ? '' : v).trim()
  const normalizeIdSegment = (v) => {
    const s = normalizeText(v)
    if (!s) return ''
    const parts = s.split(/[\\/]/).filter(Boolean)
    return parts.length ? parts[parts.length - 1] : s
  }
  const safeNumber = (v, fallback = 0) => {
    const n = Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  const formatMoney = (v) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return '-'
    return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })
  }
  const formatMoney3 = (v) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return '-'
    return n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
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

  const normalizeCustomersResp = (res) => {
    const list = Array.isArray(res)
      ? res
      : Array.isArray(res?.customers)
        ? res.customers
        : Array.isArray(res?.data?.customers)
          ? res.data.customers
          : Array.isArray(res?.data?.data?.customers)
            ? res.data.data.customers
            : Array.isArray(res?.data)
              ? res.data
              : Array.isArray(res?.data?.data)
                ? res.data.data
                : []
    return (list || []).map((c) => {
      const cid = String(c?._id ?? c?.id ?? '').trim()
      return { ...c, id: cid || undefined, _id: cid || c?._id }
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
      setCustomersSearching(true)
      try {
        const resp = await cachedCustomerAPI.getCustomers({ page: 1, pageSize: 50, limit: 50, keyword: kw, _ts: Date.now() })
        const normalized = normalizeCustomersResp(resp)
        if (customerSearchRef.current.seq !== seq) return
        setCustomers((prev) => mergeCustomerList(prev, normalized))
      } catch (_) {
        void 0
      } finally {
        if (customerSearchRef.current.seq === seq) setCustomersSearching(false)
      }
    }, 250)
  }

  useEffect(() => {
    if (!isEdit) {
      const init = async () => {
        try {
          const res = await orderAPI.getNextOrderNumber()
          const payload = res?.data ?? res?.data?.data ?? res
          const no = payload?.orderNumber ?? payload?.orderNo
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
        form.setFieldsValue({ deliveryDate: dayjs().add(3, 'day'), orderNo: undefined, qrCodeUrl: undefined })
      }
      init()
    }
  }, [isEdit])

  useEffect(() => {
    return () => {
      try {
        if (submittedRef.current) return
        const rid = reservedId
        const ono = form.getFieldValue('orderNo')
        if (!isEdit && (rid || ono)) {
          orderAPI.releaseOrderNumber({ reservationId: rid, orderNumber: ono }).catch(() => { })
        }
      } catch (_) { void 0 }
    }
  }, [isEdit, reservedId])

  useEffect(() => {
    const loadMeta = async () => {
      try {
        setCustomersLoading(true)
        const extractCustomers = (res) => {
          if (Array.isArray(res)) return res
          if (Array.isArray(res?.customers)) return res.customers
          if (Array.isArray(res?.data?.customers)) return res.data.customers
          if (Array.isArray(res?.data?.data?.customers)) return res.data.data.customers
          if (Array.isArray(res?.data)) return res.data
          if (Array.isArray(res?.data?.data)) return res.data.data
          return []
        }
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
        let list = []
        try {
          list = await fetchAllCustomers()
        } catch (_) {
          const res = await customerAPI.getCustomers({ page: 1, pageSize: 200, limit: 200 })
          list = extractCustomers(res)
        }
        const normalized = (list || []).map((c) => {
          const cid = String(c?._id ?? c?.id ?? '').trim()
          return { ...c, id: cid || undefined, _id: cid || c?._id }
        })
        setCustomers(normalized)
      } catch (e) {
        setCustomers([])
      } finally {
        setCustomersLoading(false)
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

  const customerById = useMemo(() => {
    const map = new Map()
    ;(customers || []).forEach((c) => {
      const cid = String(c?.id ?? c?._id ?? '').trim()
      if (!cid) return
      map.set(cid, c)
    })
    return map
  }, [customers])

  const selectedCustomer = useMemo(() => {
    const cid = String(selectedCustomerId || '').trim()
    return cid ? (customerById.get(cid) || null) : null
  }, [customerById, selectedCustomerId])

  useEffect(() => {
    const cid = normalizeIdSegment(selectedCustomerId)
    if (!cid) {
      setCustomerSkus([])
      form.setFieldsValue({
        lines: [{ skuId: undefined, goodsName: undefined, materialNo: undefined, specification: undefined, orderQty: 0 }]
      })
      return
    }
    let cancelled = false
    const loadSkus = async () => {
      try {
        setCustomerSkusLoading(true)
        const extractSkus = (resp) => {
          const body = resp?.data ?? resp
          if (Array.isArray(body?.data?.skus)) return body.data.skus
          if (Array.isArray(body?.data?.data?.skus)) return body.data.data.skus
          if (Array.isArray(body?.skus)) return body.skus
          return []
        }
        const readTotalPages = (resp) => {
          const body = resp?.data ?? resp
          const pagination = body?.data?.pagination ?? body?.data?.data?.pagination ?? body?.pagination ?? null
          const n = Number(pagination?.totalPages || 0)
          return Number.isFinite(n) && n > 0 ? n : 0
        }
        const all = []
        const pageSize = 200
        const maxPages = 50
        for (let page = 1; page <= maxPages; page += 1) {
          const resp = await cachedCustomerSkuAPI.getCustomerSkus({ customerId: cid, params: { page, pageSize, limit: pageSize } })
          const list = extractSkus(resp)
          if (list.length) all.push(...list)
          const totalPages = readTotalPages(resp)
          if (totalPages && page >= totalPages) break
          if (!list.length || list.length < pageSize) break
        }
        if (cancelled) return
        const normalized = (all || []).map((s) => {
          const sid = String(s?.id ?? s?._id ?? '').trim()
          return { ...s, id: sid || undefined, _id: sid || s?._id }
        })
        setCustomerSkus(normalized)
        form.setFieldsValue({
          lines: [{ skuId: undefined, goodsName: undefined, materialNo: undefined, specification: undefined, orderQty: 0 }]
        })
      } catch (e) {
        if (!cancelled) {
          setCustomerSkus([])
          message.error('加载客户SKU失败')
        }
      } finally {
        if (!cancelled) setCustomerSkusLoading(false)
      }
    }
    loadSkus()
    return () => { cancelled = true }
  }, [form, selectedCustomerId])

  useEffect(() => {
    if (!isEdit || !id) return
    const loadOrder = async () => {
      try {
        const res = await orderAPI.getOrder(id)
        const o = res?.data || res?.order || res
        if (!o) return
        const customerId = normalizeText(o.customerId ?? o.customer?._id ?? o.customer?.id)
        const spec = normalizeText(o.specification ?? o.spec)
        const goodsName = normalizeText(o.goodsName ?? o.productTitle ?? o.productName)
        form.setFieldsValue({
          orderNo: o.orderNo || o.orderNumber,
          customerId: customerId || undefined,
          customerName: o.customerName,
          lines: [{
            skuId: undefined,
            goodsName: goodsName || undefined,
            materialNo: normalizeText(o.materialNo) || undefined,
            specification: spec || undefined,
            orderQty: safeNumber(o.quantity, 0)
          }],
          deliveryDate: o.deliveryDate ? (dayjs.isDayjs(o.deliveryDate) ? o.deliveryDate : dayjs(o.deliveryDate)) : null,
          notes: o.notes
        })
      } catch (e) { void 0 }
    }
    loadOrder()
  }, [isEdit, id])

  useEffect(() => {
    if (isEdit) return
    const state = (location && location.state) || {}
    const fromOrder = state?.fromOrder
    const fromOrderId = state?.fromOrderId || (location?.search ? new URLSearchParams(location.search).get('from') : null)
    const copyMode = (location?.search ? new URLSearchParams(location.search).get('mode') : null) === 'copy'

    const applyFromOrder = (baseOrder) => {
      if (!baseOrder) return
      const base = baseOrder || {}
      const rawDelivery = base.deliveryDate || base.delivery_date
      const deliveryDate = rawDelivery ? dayjs(rawDelivery) : dayjs().add(3, 'day')
      form.setFieldsValue({
        customerId: normalizeText(base.customerId ?? base.customer?._id ?? base.customer?.id) || undefined,
        customerName: base.customerName || base.customer?.name,
        goodsName: normalizeText(base.goodsName ?? base.productTitle ?? base.productName) || undefined,
        materialNo: normalizeText(base.materialNo) || undefined,
        specification: normalizeText(base.specification ?? base.spec) || undefined,
        sheetCount: base.sheetCount,
        quantity: base.quantity,
        unit: base.unit ?? '个',
        unitPrice: base.unitPrice,
        amount: base.amount ?? base.totalAmount,
        deliveryDate,
        notes: base.notes
      })
    }

    if (fromOrder) {
      if (copyMode) {
        const keepNo = form.getFieldValue('orderNo')
        const keepDelivery = form.getFieldValue('deliveryDate')
        form.resetFields()
        form.setFieldsValue({ orderNo: keepNo, deliveryDate: keepDelivery })
      }
      applyFromOrder(fromOrder)
      return
    }

    if (fromOrderId) {
      (async () => {
        try {
          const res = await orderAPI.getOrder(fromOrderId)
          const raw = res?.data || res?.order || res
          if (raw) {
            if (copyMode) {
              const keepNo = form.getFieldValue('orderNo')
              const keepDelivery = form.getFieldValue('deliveryDate')
              form.resetFields()
              form.setFieldsValue({ orderNo: keepNo, deliveryDate: keepDelivery })
            }
            applyFromOrder(raw)
          }
        } catch (e) { void 0 }
      })()
    }
  }, [isEdit, location, form])

  const skuById = useMemo(() => {
    const map = new Map()
    ;(customerSkus || []).forEach((s) => {
      const sid = String(s?.id ?? s?._id ?? '').trim()
      if (!sid) return
      map.set(sid, s)
    })
    return map
  }, [customerSkus])

  const outsourcedView = useMemo(() => {
    const lines = Array.isArray(linesWatch) ? linesWatch : []
    const candidates = lines
      .map((l) => {
        const sid = String(l?.skuId ?? '').trim()
        if (!sid) return null
        return skuById.get(sid) || null
      })
      .filter(Boolean)
    if (!candidates.length) return false
    return candidates.every((s) => normalizeText(s?.productionMode) === 'outsourced')
  }, [linesWatch, skuById])

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

  const resolveLineSku = (index, triggerField) => {
    const line = form.getFieldValue(['lines', index]) || {}

    // 如果用户清除了某个字段（变为空），且当前行已经选中了SKU（skuId存在），则认为是用户想要取消当前SKU的选择，
    // 此时应该清空所有关联字段，允许用户重新选择。
    if (triggerField && !normalizeText(line[triggerField]) && line.skuId) {
      const curr = Array.isArray(form.getFieldValue('lines')) ? form.getFieldValue('lines') : []
      const next = curr.map((it, i) => (i === index ? {
        ...it,
        skuId: undefined,
        goodsName: undefined,
        materialNo: undefined,
        specification: undefined
      } : it))
      form.setFieldsValue({ lines: next })
      return
    }

    const matches = matchSkus(line)
    if (matches.length !== 1) {
      if (line?.skuId) {
        form.setFieldsValue({ lines: (Array.isArray(form.getFieldValue('lines')) ? form.getFieldValue('lines') : []).map((it, i) => (i === index ? { ...it, skuId: undefined } : it)) })
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
    const next = curr.map((it, i) => (i === index ? { ...it, ...patched } : it))
    form.setFieldsValue({ lines: next })
  }

  const deferResolveLineSku = (index, triggerField) => {
    Promise.resolve().then(() => resolveLineSku(index, triggerField))
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

  const meaningfulLines = useMemo(() => {
    const lines = Array.isArray(linesWatch) ? linesWatch : []
    return lines
      .map((it, idx) => ({ it: it || {}, idx }))
      .filter(({ it }) => safeNumber(it?.orderQty, 0) > 0)
  }, [linesWatch])

  const handleSubmit = async () => {
    if (submittingRef.current) return
    submittingRef.current = true
    setSubmitting(true)
    try {
      const values = await form.validateFields()
      const baseURL = String(api?.defaults?.baseURL || '')
      const isCloudBridge = baseURL.includes('api-bridge')
      const cid = String(values.customerId || '').trim()
      const customer = cid ? (customerById.get(cid) || null) : null
      const baseOrderNo = normalizeText(values.orderNo)
      if (!baseOrderNo) {
        message.error('订单号缺失')
        return
      }
      const safeCustomerName = normalizeText(values.customerName) || normalizeText(customer?.companyName || customer?.name || '')
      const lines = Array.isArray(values.lines) ? values.lines : []
      const meaningful = lines
        .map((it, idx) => ({ it: it || {}, idx }))
        .filter(({ it }) => safeNumber(it?.orderQty, 0) > 0)
      if (!meaningful.length) {
        message.warning('请至少填写一条SKU的订单数量')
        return
      }
      const toIsoDate = (d) => {
        if (!d) return undefined
        try {
          const dt = dayjs.isDayjs(d) ? d : dayjs(d)
          if (!dt.isValid()) return undefined
          return dt.toISOString()
        } catch (_) {
          return undefined
        }
      }
      const normalizeItemFromSku = ({ sku, qty, sheetCount, unitPrice, rawUnitPrice }) => {
        const goodsName = normalizeText(sku?.name || '') || undefined
        const materialNo = normalizeText(sku?.materialNo || '') || undefined
        const specification = normalizeText(sku?.specification || '') || undefined
        const category = normalizeText(sku?.category || '') || undefined
        const unitText = normalizeText(sku?.unit || '') || '个'
        const bw = sku?.boardWidth
        const bh = sku?.boardHeight
        const materialCode = normalizeText(sku?.materialCode || '') || undefined
        const flute = normalizeText(sku?.flute || '') || undefined
        const up = safeNumber(unitPrice, 0)
        const rp = safeNumber(rawUnitPrice, 0)
        const amount = Math.max(0, qty * up)
        return {
          category,
          productName: goodsName || undefined,
          goodsName,
          title: goodsName,
          materialNo,
          spec: specification,
          specification,
          boardWidth: bw,
          boardHeight: bh,
          materialCode,
          flute,
          quantity: qty,
          orderQuantity: qty,
          orderedQuantity: sheetCount,
          sheetCount,
          unit: unitText,
          unitPrice: up,
          rawUnitPrice: rp,
          grossProfit: (qty * up) - (sheetCount * rp),
          amount
        }
      }
      const builds = []
      for (const [seqIndex, row] of meaningful.entries()) {
        const line = row.it || {}
        const qty = safeNumber(line.orderQty, 0)
        const matches = line?.skuId ? [skuById.get(String(line.skuId || '').trim())].filter(Boolean) : matchSkus(line)
        if (matches.length !== 1) {
          message.warning(`第${row.idx + 1}行SKU未匹配，请完善商品名称/物料号/规格尺寸`)
          return
        }
        const sku = matches[0]
        const productionMode = normalizeText(sku?.productionMode)
        const isOutsourced = productionMode === 'outsourced'
        const unitPrice = safeNumber(sku?.unitPrice, 0)
        if (!(unitPrice > 0)) {
          message.warning(`第${row.idx + 1}行单价未设置`)
          return
        }
        const supplierName = isOutsourced ? normalizeText(sku?.supplierName) : ''
        const purchasePrice = isOutsourced ? safeNumber(sku?.rawMaterialCost, 0) : 0
        if (isOutsourced && !supplierName) {
          message.warning(`第${row.idx + 1}行外厂采购SKU缺少供应商`)
          return
        }
        if (isOutsourced && !(purchasePrice > 0)) {
          message.warning(`第${row.idx + 1}行外厂采购SKU缺少原材料成本（进价）`)
          return
        }
        const sheetPerUnit = safeNumber(sku?.sheetCount, 0)
        const totalSheetCount = (sheetPerUnit > 0 && qty > 0) ? Math.round(sheetPerUnit * qty) : undefined
        const orderNo = meaningful.length > 1 ? `${baseOrderNo}-${seqIndex + 1}` : baseOrderNo
        const finalUnitPrice = isOutsourced ? purchasePrice : unitPrice
        const amount = Math.max(0, qty * finalUnitPrice)
        let payload = {
          orderNo,
          customerId: cid,
          customerName: safeCustomerName || `客户${cid}`,
          productName: normalizeText(sku?.name) || normalizeText(sku?.category) || 'SKU',
          goodsName: normalizeText(sku?.name) || undefined,
          materialNo: normalizeText(sku?.materialNo) || undefined,
          specification: normalizeText(sku?.specification) || undefined,
          sheetCount: totalSheetCount,
          quantity: qty,
          unit: normalizeText(sku?.unit) || '个',
          unitPrice: unitPrice || undefined,
          amount,
          createdAt: isEdit ? undefined : Date.now(),
          notes: values.notes,
          orderType: isOutsourced ? 'purchase' : (values.orderType || (isEdit ? undefined : 'production')),
          source: isOutsourced ? 'purchased' : (values.source || (isEdit ? undefined : 'pc')),
          deliveryDate: toIsoDate(values.deliveryDate)
        }
        if (isOutsourced) {
          payload = {
            ...payload,
            supplierName: supplierName || undefined,
            salePrice: purchasePrice || undefined,
            purchaseCategory: 'goods'
          }
        }
        if (isCloudBridge) {
          if (isOutsourced) {
            payload = {
              ...payload,
              items: [{
                name: payload.productName,
                quantity: qty,
                unit: payload.unit,
                unitPrice: purchasePrice,
                materialNo: payload.materialNo,
                specification: payload.specification,
                sheetCount: payload.sheetCount
              }],
              totalAmount: amount
            }
          } else {
            payload = {
              ...payload,
              customerId: cid || safeCustomerName || 'PC',
              items: [{
                name: payload.productName,
                quantity: qty,
                unit: payload.unit,
                unitPrice,
                materialNo: payload.materialNo,
                specification: payload.specification,
                sheetCount: payload.sheetCount
              }],
              totalAmount: amount
            }
          }
        }
        payload = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== undefined))
        builds.push(payload)
      }

      if (isEdit && id) {
        const first = builds[0]
        const res = await orderAPI.updateOrder(id, first)
        const body = res?.data ?? res
        if (body && typeof body === 'object' && body.success === false) {
          throw new Error(body.message || '订单更新失败')
        }
        message.success('订单已更新')
        const isPurchase = String(first?.orderType || '').toLowerCase() === 'purchase' || String(first?.source || '').toLowerCase() === 'purchased' || Boolean(first?.purchaseCategory)
        navigate(isPurchase ? '/purchase' : '/orders', isPurchase ? { state: { viewType: 'goods' } } : undefined)
        return
      }

      const isPurchaseOnly = builds.length > 0 && builds.every((p) => (
        String(p?.orderType || '').toLowerCase() === 'purchase' ||
        String(p?.source || '').toLowerCase() === 'purchased' ||
        Boolean(p?.purchaseCategory)
      ))

      if (builds.length === 1) {
        const payload = builds[0]
        const res = await orderAPI.createOrder({ ...payload, status: 'ordered', reservationId: reservedId })
        const body = res?.data ?? res
        if (body && typeof body === 'object' && body.success === false) {
          throw new Error(body.message || '订单创建失败')
        }
        setReservedId(undefined)
        message.success(payload.orderNo ? `订单已创建（编号：${payload.orderNo}）` : '订单已创建')
        navigate(isPurchaseOnly ? '/purchase' : '/orders', isPurchaseOnly ? { state: { viewType: 'goods' } } : undefined)
        return
      }

      const payloadItems = []
      for (const [seqIndex, row] of meaningful.entries()) {
        const line = row.it || {}
        const qty = safeNumber(line.orderQty, 0)
        const matches = line?.skuId ? [skuById.get(String(line.skuId || '').trim())].filter(Boolean) : matchSkus(line)
        if (matches.length !== 1) {
          message.warning(`第${row.idx + 1}行SKU未匹配，请完善商品名称/物料号/规格尺寸`)
          return
        }
        const sku = matches[0]
        const productionMode = normalizeText(sku?.productionMode)
        const isOutsourced = productionMode === 'outsourced'
        const up = safeNumber(sku?.unitPrice, 0)
        const rp = safeNumber(sku?.rawMaterialCost, 0)
        if (!isOutsourced && !(up > 0)) {
          message.warning(`第${row.idx + 1}行单价未设置`)
          return
        }
        if (isOutsourced && !(rp > 0)) {
          message.warning(`第${row.idx + 1}行外厂采购SKU缺少原材料成本（进价）`)
          return
        }
        const sheetPerUnit = safeNumber(sku?.sheetCount, 0)
        const totalSheetCount = (sheetPerUnit > 0 && qty > 0) ? Math.round(sheetPerUnit * qty) : 0
        payloadItems.push(normalizeItemFromSku({
          sku,
          qty,
          sheetCount: totalSheetCount,
          unitPrice: isOutsourced ? rp : up,
          rawUnitPrice: rp
        }))
      }

      const first = payloadItems[0] || {}
      const totalQty = payloadItems.reduce((s, it) => s + (Number(it?.quantity || 0) || 0), 0)
      const totalSheetCount = payloadItems.reduce((s, it) => s + (Number(it?.sheetCount || 0) || 0), 0)
      const totalAmount = payloadItems.reduce((s, it) => s + (Number(it?.amount || 0) || 0), 0)
      const totalGrossProfit = payloadItems.reduce((s, it) => s + (Number(it?.grossProfit || 0) || 0), 0)
      const createPayload = {
        orderNo: baseOrderNo,
        reservationId: reservedId,
        customerId: cid,
        customerName: safeCustomerName || `客户${cid}`,
        productName: payloadItems.length > 1 ? '多SKU' : (first.goodsName || first.productName || 'SKU'),
        goodsName: payloadItems.length > 1 ? '多SKU' : (first.goodsName || undefined),
        materialNo: payloadItems.length > 1 ? undefined : (first.materialNo || undefined),
        quantity: totalQty,
        unit: first.unit || '个',
        unitPrice: undefined,
        amount: totalAmount,
        totalAmount,
        sheetCount: totalSheetCount || undefined,
        status: 'ordered',
        source: values.source || 'pc',
        orderType: values.orderType || 'production',
        deliveryDate: toIsoDate(values.deliveryDate),
        items: payloadItems,
        meta: { totalGrossProfit },
        notes: values.notes,
        createdAt: Date.now()
      }
      const res = await orderAPI.createOrder(Object.fromEntries(Object.entries(createPayload).filter(([, v]) => v !== undefined)))
      const body = res?.data ?? res
      if (body && typeof body === 'object' && body.success === false) {
        throw new Error(body.message || '订单创建失败')
      }
      submittedRef.current = true
      orderAPI.confirmOrderNumber(baseOrderNo).catch(() => { })
      setReservedId(undefined)
      message.success(`订单已创建（SKU数：${payloadItems.length}）`)
      navigate(isPurchaseOnly ? '/purchase' : '/orders', isPurchaseOnly ? { state: { viewType: 'goods' } } : undefined)
    } catch (error) {
      if (!isEdit) {
        try {
          const rid = reservedId
          const ono = form.getFieldValue('orderNo')
          if (!submittedRef.current && (rid || ono)) {
            await orderAPI.releaseOrderNumber({ reservationId: rid, orderNumber: ono })
          }
        } catch (_) { void 0 }
        setReservedId(undefined)
      }
      const msg = error?.response?.data?.message || error?.message || '提交失败'
      message.error(msg)
    } finally {
      submittingRef.current = false
      setSubmitting(false)
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 className="page-title" style={{ margin: 0 }}>
          {isEdit ? '编辑订单' : (outsourcedView ? '外厂采购 - 新建订单' : '创建订单')}
        </h2>
        <Space>
          <Button onClick={async () => {
            try {
              if (!submittedRef.current && reservedId) await orderAPI.releaseOrderNumber({ reservationId: reservedId })
            } finally {
              setReservedId(undefined)
              navigate(outsourcedView ? '/purchase' : '/orders', outsourcedView ? { state: { viewType: 'goods' } } : undefined)
            }
          }}>返回</Button>
        </Space>
      </div>

      <Form
        form={form}
        layout="vertical"
        className="order-create-form"
        onValuesChange={(changed, all) => {
          if (changed.customerId !== undefined) {
            const cid = String(all.customerId || '').trim()
            const c = cid ? (customerById.get(cid) || null) : null
            form.setFieldsValue({ customerName: normalizeText(c?.companyName || c?.name || '') || undefined })
          }
        }}
      >
        <Form.Item name="customerName" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="orderNo" hidden>
          <Input />
        </Form.Item>

        <Card style={{ marginBottom: 12 }}>
          <Row gutter={12}>
            <Col xs={24} md={12}>
              <Form.Item name="customerId" label="客户名称" rules={[{ required: true, message: '请选择客户名称' }]}>
                <Select
                  placeholder="请选择客户"
                  loading={customersLoading || customersSearching}
                  options={(customers || []).map((c) => {
                    const cid = String(c?.id ?? c?._id ?? '').trim()
                    const name = c.companyName || c.name || c.company || ''
                    const label = c.shortName ? `${c.shortName} (${name})` : name
                    return { value: cid, label }
                  }).filter((x) => x.value && x.label)}
                  showSearch
                  optionFilterProp="label"
                  allowClear
                  onSearch={remoteSearchCustomers}
                />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label="订单号">
                <Input disabled value={normalizeText(orderNoWatch) || '-'} />
              </Form.Item>
            </Col>
            <Col xs={24} md={6}>
              <Form.Item label="客户ID">
                <Input disabled value={String(selectedCustomerId || '').trim() || '-'} />
              </Form.Item>
            </Col>
          </Row>
          <Descriptions size="small" column={3}>
            <Descriptions.Item label="客户简称">{selectedCustomer?.shortName || '-'}</Descriptions.Item>
            <Descriptions.Item label="联系人">{selectedCustomer?.contactName || selectedCustomer?.contact || '-'}</Descriptions.Item>
            <Descriptions.Item label="联系电话">{selectedCustomer?.phone || '-'}</Descriptions.Item>
            <Descriptions.Item label="地址" span={3}>{selectedCustomer?.address || '-'}</Descriptions.Item>
          </Descriptions>
        </Card>

        <Card title="产品列表" style={{ marginBottom: 12 }}>
          <Form.List name="lines" initialValue={[{ skuId: undefined, goodsName: undefined, materialNo: undefined, specification: undefined, orderQty: 0 }]}>
            {(fields, { add, remove }) => {
              const columns = [
                {
                  title: '产品类别',
                  key: 'category',
                  width: 110,
                  ellipsis: true,
                  render: (_, f) => {
                    const idx = Number(f?.name)
                    const line = form.getFieldValue(['lines', idx]) || {}
                    const sku = line?.skuId ? skuById.get(String(line.skuId || '').trim()) : null
                    return normalizeText(sku?.category) || '-'
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
                    const isOutsourcedSku = normalizeText(sku?.productionMode) === 'outsourced'
                    return (
                      <Space size={6} align="center">
                        <Form.Item name={[f.name, 'goodsName']} style={{ margin: 0 }}>
                          <Select
                            placeholder={selectedCustomerId ? '请选择' : '请先选择客户'}
                            loading={customerSkusLoading}
                            disabled={!selectedCustomerId}
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            options={buildLineFieldOptions('goodsName', line)}
                            onChange={() => deferResolveLineSku(f.name, 'goodsName')}
                          />
                        </Form.Item>
                        {isOutsourcedSku ? <Tag color="orange">外采购</Tag> : null}
                      </Space>
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
                          onChange={() => deferResolveLineSku(f.name, 'materialNo')}
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
                    const sku = line?.skuId ? skuById.get(String(line.skuId || '').trim()) : null
                    const bw = Number(sku?.boardWidth || 0)
                    const bh = Number(sku?.boardHeight || 0)
                    const sizeText = bw > 0 && bh > 0 ? `${bw}×${bh}` : '-'
                    const parseCreaseText = (v) => {
                      const s = normalizeText(v)
                      if (!s) return null
                      const nums = (s.match(/-?\d+(\.\d+)?/g) || []).map((n) => Number(n)).filter((n) => Number.isFinite(n))
                      if (nums.length < 2) return null
                      const [a, b, c] = [nums[0] || 0, nums[1] || 0, nums[2] || 0]
                      const typeMatch = s.match(/[（(]([^（）()]+)[）)]/)
                      const type = normalizeText(typeMatch ? typeMatch[1] : '')
                      return { c1: a, c2: b, c3: c, type }
                    }
                    const c1 = Number(sku?.creasingSize1 ?? sku?.creaseSize1 ?? 0)
                    const c2 = Number(sku?.creasingSize2 ?? sku?.creaseSize2 ?? 0)
                    const c3 = Number(sku?.creasingSize3 ?? sku?.creaseSize3 ?? 0)
                    const type = normalizeText(sku?.creasingType ?? sku?.creaseType ?? '')
                    const hasNums = Boolean(c1 || c2 || c3)
                    const fromAny = parseCreaseText(
                      sku?.pressLine ?? sku?.press_line ??
                      sku?.creasingSize ?? sku?.creaseSize ?? sku?.pressLineSize ?? sku?.press_line_size
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
                        <Form.Item name={[f.name, 'specification']} style={{ margin: 0 }}>
                          <Select
                            placeholder={selectedCustomerId ? '请选择' : '请先选择客户'}
                            loading={customerSkusLoading}
                            disabled={!selectedCustomerId}
                            allowClear
                            showSearch
                            optionFilterProp="label"
                            options={buildLineFieldOptions('specification', line)}
                            onChange={() => deferResolveLineSku(f.name, 'specification')}
                          />
                        </Form.Item>
                        <div style={{ fontSize: '12px', color: '#888' }}>
                          <div>纸板尺寸：{sizeText}</div>
                          <div>压线尺寸：{creaseText}</div>
                        </div>
                      </div>
                    )
                  }
                },
                ...(outsourcedView ? [] : [{
                  title: '原材料信息',
                  key: 'raw',
                  width: 230,
                  render: (_, f) => {
                    const idx = Number(f?.name)
                    const line = form.getFieldValue(['lines', idx]) || {}
                    const sku = line?.skuId ? skuById.get(String(line.skuId || '').trim()) : null
                    const materialCode = normalizeText(sku?.materialCode || sku?.material_code) || '-'
                    const flute = normalizeText(sku?.flute) || '-'

                    return (
                      <div style={{ lineHeight: 1.25, fontSize: '13px' }}>
                        <div><span style={{ color: '#888' }}>材质编码：</span>{materialCode}</div>
                        <div><span style={{ color: '#888' }}>楞别：</span>{flute}</div>
                      </div>
                    )
                  }
                }]),
                {
                  title: '订单数量',
                  key: 'orderQty',
                  width: 120,
                  align: 'right',
                  render: (_, f) => (
                    <Form.Item name={[f.name, 'orderQty']} style={{ margin: 0 }}>
                      <InputNumber min={0} style={{ width: 110 }} />
                    </Form.Item>
                  )
                },
                ...(outsourcedView ? [{
                  title: '单位',
                  key: 'unit',
                  width: 90,
                  align: 'center',
                  render: (_, f) => {
                    const idx = Number(f?.name)
                    const line = form.getFieldValue(['lines', idx]) || {}
                    const sku = line?.skuId ? skuById.get(String(line.skuId || '').trim()) : null
                    return normalizeText(sku?.unit) || '-'
                  }
                }] : [{
                  title: '下单片数',
                  key: 'sheetCount',
                  width: 120,
                  align: 'right',
                  render: (_, f) => {
                    const idx = Number(f?.name)
                    const line = form.getFieldValue(['lines', idx]) || {}
                    const qty = safeNumber(line?.orderQty, 0)
                    const sku = line?.skuId ? skuById.get(String(line.skuId || '').trim()) : null
                    const per = safeNumber(sku?.sheetCount, 0)
                    const total = per > 0 && qty > 0 ? per * qty : 0
                    return formatMoney(total)
                  }
                }]),
                {
                  title: outsourcedView ? '单价(元)' : '单价',
                  key: 'unitPrice',
                  width: 110,
                  align: 'right',
                  render: (_, f) => {
                    const idx = Number(f?.name)
                    const line = form.getFieldValue(['lines', idx]) || {}
                    const sku = line?.skuId ? skuById.get(String(line.skuId || '').trim()) : null
                    const val = formatMoney(sku?.unitPrice)
                    return outsourcedView ? `${val} 元` : val
                  }
                },
                {
                  title: outsourcedView ? '原材料单价(元)' : '原材料单价',
                  key: 'rawUnitPrice',
                  width: 120,
                  align: 'right',
                  render: (_, f) => {
                    const idx = Number(f?.name)
                    const line = form.getFieldValue(['lines', idx]) || {}
                    const sku = line?.skuId ? skuById.get(String(line.skuId || '').trim()) : null
                    const val = formatMoney(sku?.rawMaterialCost)
                    return outsourcedView ? `${val} 元` : val
                  }
                },
                {
                  title: '毛利润',
                  key: 'grossProfit',
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
                    const amount = qty > 0 ? qty * up : 0
                    const rawAmount = qty > 0 ? qty * rp * sheetCount : 0
                    const v = formatMoney(amount - rawAmount)
                    return outsourcedView ? `${v} 元` : v
                  }
                },
                {
                  title: outsourcedView ? '订单金额(元)' : '订单金额',
                  key: 'amount',
                  width: 120,
                  align: 'right',
                  render: (_, f) => {
                    const idx = Number(f?.name)
                    const line = form.getFieldValue(['lines', idx]) || {}
                    const qty = safeNumber(line?.orderQty, 0)
                    const sku = line?.skuId ? skuById.get(String(line.skuId || '').trim()) : null
                    const up = safeNumber(sku?.unitPrice, 0)
                    const v = formatMoney3(qty > 0 ? qty * up : 0)
                    return outsourcedView ? `${v} 元` : v
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
                      onClick={() => {
                        remove(f.name)
                      }}
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
                    <Button
                      onClick={() => add({ skuId: undefined, goodsName: undefined, materialNo: undefined, specification: undefined, orderQty: 0 })}
                      disabled={!selectedCustomerId}
                    >
                      添加产品
                    </Button>
                  </Space>
                  <Table
                    columns={columns}
                    dataSource={fields}
                    pagination={false}
                    rowKey={(f) => f.key}
                    scroll={{ x: outsourcedView ? 1250 : 1450 }}
                    summary={() => {
                      const lines = Array.isArray(linesWatch) ? linesWatch : []
                      const rows = lines
                        .map((it, idx) => ({ it: it || {}, idx }))
                        .filter(({ it }) => safeNumber(it?.orderQty, 0) > 0)
                      const totals = rows.reduce((acc, r) => {
                        const qty = safeNumber(r.it?.orderQty, 0)
                        const sku = r.it?.skuId ? skuById.get(String(r.it.skuId || '').trim()) : null
                        const up = safeNumber(sku?.unitPrice, 0)
                        const rp = safeNumber(sku?.rawMaterialCost, 0)
                        const per = safeNumber(sku?.sheetCount, 0)
                        if (!outsourcedView) {
                          acc.sheet += (per > 0 && qty > 0) ? (per * qty) : 0
                        }
                        const sheetCount = per > 0 ? per : 1
                        acc.profit += qty > 0 ? qty * (up - rp * sheetCount) : 0
                        acc.amount += qty > 0 ? qty * up : 0
                        return acc
                      }, { sheet: 0, profit: 0, amount: 0 })
                      return (
                        <Table.Summary.Row>
                          <Table.Summary.Cell index={0} colSpan={columns.length} align="right">
                            {outsourcedView
                              ? `毛利润：${formatMoney3(totals.profit)} 元，订单金额：${formatMoney3(totals.amount)} 元`
                              : `毛利合计：${formatMoney3(totals.profit)}，订单金额合计：${formatMoney3(totals.amount)}`}
                          </Table.Summary.Cell>
                        </Table.Summary.Row>
                      )
                    }}
                  />
                </div>
              )
            }}
          </Form.List>
        </Card>

        <Card title="备注" style={{ marginBottom: 12 }}>
          <Form.Item name="notes">
            <Input.TextArea style={{ height: 80 }} />
          </Form.Item>
        </Card>

        <Space>
          <Button onClick={async () => {
            try {
              if (!submittedRef.current && reservedId) await orderAPI.releaseOrderNumber({ reservationId: reservedId })
            } finally {
              setReservedId(undefined)
              navigate('/orders')
            }
          }}>返回</Button>
          <Button type="primary" loading={submitting} disabled={submitting} onClick={handleSubmit}>生成订单</Button>
        </Space>
      </Form>
    </div>
  )
}

export default OrderCreate
