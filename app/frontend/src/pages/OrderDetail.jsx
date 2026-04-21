import React, { useEffect, useState } from 'react'
import { Card, Descriptions, Tag, Space, Image, Spin, App, Divider, Button, Row, Col, Segmented, Table } from 'antd'
import { EditOutlined } from '@ant-design/icons'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import dayjs from 'dayjs'
import { orderAPI } from '../services/api'
import { cachedCustomerSkuAPI } from '../services/cachedAPI'
import { safeNavigateBack } from '../utils'

function OrderDetail() {
  const { message } = App.useApp()
  const { id } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [loading, setLoading] = useState(false)
  const [order, setOrder] = useState(null)
  const [customerSkuIndex, setCustomerSkuIndex] = useState(null)
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
    const type = String(
      o?.creasingType ?? o?.creasing_type ?? o?.creaseType ?? o?.crease_type ??
      data?.creasingType ?? data?.creasing_type ?? data?.creaseType ?? data?.crease_type ??
      meta?.creasingType ?? meta?.creasing_type ?? meta?.creaseType ?? meta?.crease_type ??
      brief?.creasingType ?? brief?.creasing_type ?? brief?.creaseType ?? brief?.crease_type ??
      product?.creasingType ?? product?.creasing_type ?? product?.creaseType ?? product?.crease_type ??
      first?.creasingType ?? first?.creasing_type ?? first?.creaseType ?? first?.crease_type ??
      firstData?.creasingType ?? firstData?.creasing_type ?? firstData?.creaseType ?? firstData?.crease_type ??
      ''
    ).trim()
    const pressLine = String(
      o?.pressLine ??
      o?.press_line ??
      o?.pressLineSize ??
      o?.press_line_size ??
      o?.creasingSize ??
      o?.creaseSize ??
      o?.creasing_size ??
      o?.crease_size ??
      o?.['压线尺寸'] ??
      o?.['压线'] ??
      data?.['压线尺寸'] ??
      data?.['压线'] ??
      data?.pressLine ??
      data?.press_line ??
      data?.pressLineSize ??
      data?.press_line_size ??
      data?.creasingSize ??
      data?.creaseSize ??
      data?.creasing_size ??
      data?.crease_size ??
      meta?.['压线尺寸'] ??
      meta?.['压线'] ??
      meta?.pressLine ??
      meta?.press_line ??
      meta?.pressLineSize ??
      meta?.press_line_size ??
      meta?.creasingSize ??
      meta?.creaseSize ??
      meta?.creasing_size ??
      meta?.crease_size ??
      brief?.['压线尺寸'] ??
      brief?.['压线'] ??
      brief?.pressLine ??
      brief?.press_line ??
      brief?.pressLineSize ??
      brief?.press_line_size ??
      brief?.creasingSize ??
      brief?.creaseSize ??
      brief?.creasing_size ??
      brief?.crease_size ??
      product?.['压线尺寸'] ??
      product?.['压线'] ??
      product?.pressLine ??
      product?.press_line ??
      product?.pressLineSize ??
      product?.press_line_size ??
      product?.creasingSize ??
      product?.creaseSize ??
      product?.creasing_size ??
      product?.crease_size ??
      first?.['压线尺寸'] ??
      first?.['压线'] ??
      first?.pressLine ??
      first?.press_line ??
      first?.pressLineSize ??
      first?.press_line_size ??
      first?.creasingSize ??
      first?.creaseSize ??
      first?.creasing_size ??
      first?.crease_size ??
      firstData?.['压线尺寸'] ??
      firstData?.['压线'] ??
      firstData?.pressLine ??
      firstData?.press_line ??
      firstData?.pressLineSize ??
      firstData?.press_line_size ??
      firstData?.creasingSize ??
      firstData?.creaseSize ??
      firstData?.creasing_size ??
      firstData?.crease_size ??
      ''
    ).trim()
    const hasNums = Boolean(c1 || c2 || c3)

    if (pressLine) {
      const nums = (pressLine.match(/-?\d+(\.\d+)?/g) || []).map(Number).filter(Number.isFinite)
      const typeMatch = pressLine.match(/[（(]([^（）()]+)[）)]/)
      const t = typeMatch ? typeMatch[1] : ''
      if (nums.length >= 2) {
        return `${nums.join('-')}${t ? ` (${t})` : ''}`
      }
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
  const [imgSize, setImgSize] = useState('标准')
  const [pdfSize, setPdfSize] = useState('标准')
  const sizeMap = { '缩略': 320, '标准': 480, '大图': 720 }
  const onEdit = () => {
    const editId = order?._id || order?.id || id
    if (editId) {
      navigate(`/orders/edit/${encodeURIComponent(editId)}`)
    }
  }

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

  const loadDetail = async () => {
    setLoading(true)
    try {
      let resp = null
      let oRaw = null
      try {
        resp = await orderAPI.getOrderAny(id)
        oRaw = unwrapOrderDetailResponse(resp)
      } catch (_) {
        oRaw = null
      }
      if (!oRaw || (oRaw && typeof oRaw === 'object' && Object.keys(oRaw).length === 0)) {
        setOrder(null)
        message.error('未找到订单')
        return
      }
      const baseOrder = location?.state?.baseOrder && typeof location.state.baseOrder === 'object'
        ? location.state.baseOrder
        : (location?.state?.order && typeof location.state.order === 'object' ? location.state.order : null)
      const fetchedOrder = oRaw && typeof oRaw === 'object' ? oRaw : {}
      const mergeOrder = (base, fetched) => {
        const b = base && typeof base === 'object' ? base : {}
        const f = fetched && typeof fetched === 'object' ? fetched : {}
        const out = { ...b, ...f }
        const arrKeys = ['items', 'products', 'productList', 'orderItems', 'order_items', 'details', 'lines', 'lineItems']
        for (const k of arrKeys) {
          if (Array.isArray(b?.[k]) && b[k].length > 0 && Array.isArray(f?.[k]) && f[k].length === 0) {
            out[k] = b[k]
          }
        }
        return out
      }
      const o = mergeOrder(baseOrder, fetchedOrder)
      const safeText = (v) => String(v ?? '').trim()
      const isMeaningful = (v) => {
        const s = safeText(v)
        if (!s) return false
        return !['-', '—', '--', '---', '暂无', '无', 'null', 'undefined'].includes(s.toLowerCase())
      }
      const pickText = (...candidates) => {
        for (const c of candidates) {
          if (isMeaningful(c)) return safeText(c)
        }
        return ''
      }
      const pickNumber = (...candidates) => {
        for (const c of candidates) {
          const n = Number(c)
          if (Number.isFinite(n)) return n
        }
        return undefined
      }
      const parseCreaseText = (v) => {
        const s = String(v ?? '').trim()
        if (!s) return null
        const nums = (s.match(/-?\d+(\.\d+)?/g) || []).map((n) => Number(n)).filter((n) => Number.isFinite(n))
        if (nums.length < 2) return null
        const typeMatch = s.match(/[（(]([^（）()]+)[）)]/)
        const type = String(typeMatch ? typeMatch[1] : '').trim()
        return { c1: nums[0] || 0, c2: nums[1] || 0, c3: nums[2] || 0, type }
      }
      const normalizeText = (v) => String(v ?? '').trim()
      const normalizeKey = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, '')
      const normalizeSpecKey = (v) => normalizeKey(v).replace(/[x*]/g, '×').replace(/mm$/i, '')
      const normalizeId = (v) => {
        const s = normalizeText(v)
        if (!s) return ''
        const parts = s.split(/[\\/]/).filter(Boolean)
        return parts.length ? parts[parts.length - 1] : s
      }
      const isMaterialCodeFormat = (val) => /^(AB|EB|A|B|E)楞$/.test(normalizeText(val))
      const keyOf = (x) => normalizeKey(String(x || ''))
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
      const loadCustomerSkus = async (customerId) => {
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
        return (all || []).map((s) => {
          const sid = normalizeId(s?.id ?? s?._id)
          return { ...s, id: sid || undefined, _id: sid || s?._id }
        })
      }
      const buildSkuIndex = (skus) => {
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
        return map
      }
      const pickVal = (v) => (v === undefined || v === null || v === '') ? undefined : v
      const coerceArray = (v) => {
        if (Array.isArray(v)) return v
        if (v && typeof v === 'object') return Object.values(v)
        return []
      }
      const pickItems = (...candidates) => {
        for (const c of candidates) {
          const arr = coerceArray(c)
          if (arr.length) return arr
        }
        return []
      }
      const items = pickItems(
        o?.items,
        o?.products,
        o?.productList,
        o?.orderItems,
        o?.order_items,
        o?.details,
        o?.lines,
        o?.lineItems,
        o?.data?.items,
        o?.data?.products,
        o?.data?.data?.items,
        o?.data?.data?.products,
        o?.meta?.items,
        o?.meta?.products
      ).map((it) => {
        if (typeof it === 'string') return { title: it, goodsName: it }
        if (it && typeof it === 'object') return it
        return {}
      })
      const first = items[0] && typeof items[0] === 'object' ? items[0] : {}
      const product = o.product && typeof o.product === 'object' ? o.product : {}
      const meta = o.meta && typeof o.meta === 'object' ? o.meta : {}
      const brief = meta.brief && typeof meta.brief === 'object' ? meta.brief : {}
      const data = o.data && typeof o.data === 'object' ? o.data : {}
      const firstData = first?.data && typeof first.data === 'object' ? first.data : {}
      const toExt = (n) => {
        const s = String(n || '').toLowerCase()
        const q = s.split('?')[0]
        const parts = q.split('.')
        return parts.length > 1 ? parts.pop() : ''
      }
      const isImgExt = (ext) => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext)
      const isPdfExt = (ext) => ext === 'pdf'
      const attachments = Array.isArray(o.attachments) ? o.attachments.map((a, i) => {
        const raw = typeof a === 'string' ? { name: a, url: a } : a || {}
        const name = raw.name || `附件${i + 1}`
        const url = raw.url || ''
        const ext = toExt(name || url)
        const isPdf = isPdfExt(ext)
        const isImage = isImgExt(ext) || (!isPdf && !!url)
        return { uid: raw.fileID || String(i), name, url, ext, isImage, isPdf }
      }) : []
      const orderId = o._id || o.id || id
      const orderNo = pickText(o.orderNo, o.orderNumber, o.order_no, o.order_number, meta.orderNo, meta.orderNumber, brief.orderNo, brief.orderNumber)
      const qrCodeUrl = normalizeQrUrl(o.qrCodeUrl, { orderId, orderNo })
      const quantityFromItems = items.reduce((s, it) => s + (Number(it?.quantity ?? it?.qty ?? it?.count ?? it?.orderQty ?? it?.orderQuantity ?? 0) || 0), 0)
      const purchaseOrderId = pickText(o.purchaseOrderId, o.purchase_order_id, meta.purchaseOrderId, meta.purchase_order_id, first.purchaseOrderId, first.purchase_order_id)
      const purchaseOrderNo = pickText(o.purchaseOrderNo, o.purchase_order_no, meta.purchaseOrderNo, meta.purchase_order_no, first.purchaseOrderNo, first.purchase_order_no)

      const customerId = normalizeId(pickText(
        o.customerId,
        o.customer_id,
        o.customerID,
        o.customerIdText,
        o.customer?._id,
        o.customer?.id,
        o.customer?.customerId,
        data.customerId,
        data.customer_id,
        data.customerID,
        data.customer?._id,
        data.customer?.id,
        data.customer?.customerId,
        meta.customerId,
        meta.customer_id,
        meta.customerID,
        meta.customer?._id,
        meta.customer?.id,
        meta.customer?.customerId,
        brief.customerId,
        brief.customer_id,
        brief.customerID,
        baseOrder?.customerId,
        baseOrder?.customer_id,
        baseOrder?.customerID,
        baseOrder?.customer?._id,
        baseOrder?.customer?.id
      ))
      const skuId = normalizeId(
        o.skuId || o.sku_id || o.sku?._id || o.sku?.id || o.customerSkuId || o.customer_sku_id ||
        data.skuId || data.sku_id || data.sku?._id || data.sku?.id || data.customerSkuId || data.customer_sku_id ||
        first.skuId || first.sku_id || first.sku?._id || first.sku?.id || first.customerSkuId || first.customer_sku_id ||
        firstData.skuId || firstData.sku_id || firstData.sku?._id || firstData.sku?.id || firstData.customerSkuId || firstData.customer_sku_id
      )

      const materialCodePicked = pickText(
        o.materialCode, o.material_code,
        data.materialCode, data.material_code,
        meta.materialCode, meta.material_code,
        brief.materialCode, brief.material_code,
        product.materialCode, product.material_code,
        first.materialCode, first.material_code,
        firstData.materialCode, firstData.material_code
      )
      const rawMaterialNoPicked = pickText(
        o.materialNo, o.material_no,
        data.materialNo, data.material_no,
        meta.materialNo, meta.material_no,
        brief.materialNo, brief.material_no,
        product.materialNo, product.material_no,
        first.materialNo, first.material_no,
        firstData.materialNo, firstData.material_no
      )
      
      // 优先使用后端返回的字段
      let finalMaterialCode = materialCodePicked
      const finalMaterialNo = rawMaterialNoPicked

      const isNumeric = (str) => /^\d+$/.test(String(str ?? ''))
      const looksLikeMaterialNo = (str) => isNumeric(str) && String(str ?? '').length > 6
      if (looksLikeMaterialNo(finalMaterialCode)) finalMaterialCode = ''

      // 纸板尺寸计算
      const parseDim = (v) => {
        if (typeof v === 'number') return v
        const s = String(v ?? '').trim()
        if (!s) return undefined
        const m = s.match(/^(\d+(\.\d+)?)/)
        return m ? Number(m[1]) : undefined
      }
      
      const pickDim = (...candidates) => {
        for (const c of candidates) {
           const n = parseDim(c)
           if (Number.isFinite(n) && n > 0) return n
        }
        return undefined
      }



      const userSpec = pickText(
        o.specification,
        o.spec,
        data.specification,
        data.spec,
        meta.specification,
        meta.spec,
        brief.specification,
        brief.spec
      )
      const skuSpecCandidate = pickText(
        product.specification,
        product.spec,
        first.specification,
        first.spec,
        firstData.specification,
        firstData.spec
      )
      const specPicked = userSpec || skuSpecCandidate



      let skuIndex = null
      if (customerId) {
        const skus = await loadCustomerSkus(customerId).catch(() => [])
        skuIndex = buildSkuIndex(skus)
      }
      setCustomerSkuIndex(skuIndex)

      const skuFromIndex = (() => {
        if (!skuIndex) return null
        if (skuId && skuIndex.has(`id:${normalizeKey(skuId)}`)) return skuIndex.get(`id:${normalizeKey(skuId)}`)
        const materialNoKey = normalizeKey(finalMaterialNo)
        const specKey = normalizeSpecKey(specPicked)
        if (materialNoKey && specKey && skuIndex.has(`ms:${materialNoKey}::${specKey}`)) return skuIndex.get(`ms:${materialNoKey}::${specKey}`)
        if (materialNoKey && skuIndex.has(`m:${materialNoKey}`)) return skuIndex.get(`m:${materialNoKey}`)
        const nameKey = normalizeKey(pickText(o.goodsName, o.goods_name, o.productTitle, o.product_title, o.title, first?.goodsName, first?.goods_name, first?.title, first?.productName, first?.product_name))
        if (nameKey && specKey && skuIndex.has(`ns:${nameKey}::${specKey}`)) return skuIndex.get(`ns:${nameKey}::${specKey}`)
        if (nameKey && skuIndex.has(`n:${nameKey}`)) return skuIndex.get(`n:${nameKey}`)
        return null
      })()

      // 优先从 SKU 获取材质编码，确保准确性
      const skuCode = normalizeText(skuFromIndex?.materialCode || skuFromIndex?.material_code)
      if (skuCode) {
          finalMaterialCode = skuCode
      }

      // --- 移动到此处：纸板尺寸计算 (确保能利用 skuFromIndex) ---
      const normalizeSizeToken = (v) => String(v ?? '')
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[x*]/g, '×')
        .replace(/mm$/i, '')
        
      // 尝试从规格字符串解析尺寸作为最后兜底
      const parseSizeFromSpec = (s) => {
         const n = normalizeSizeToken(s)
         if (/^\d+(\.\d+)?×\d+(\.\d+)?$/.test(n)) {
            const parts = n.split('×').map(Number)
            if (parts.length === 2 && parts.every(x => Number.isFinite(x) && x > 0)) {
               return { w: parts[0], h: parts[1] }
            }
         }
         return null
      }

      const boardWidthPicked = pickDim(
        o.boardWidth, o.board_width,
        data.boardWidth, data.board_width,
        meta.boardWidth, meta.board_width, brief.boardWidth, brief.board_width,
        product.boardWidth, product.board_width,
        first.boardWidth, first.board_width,
        firstData.boardWidth, firstData.board_width,
        o.specWidth, data.specWidth, product.specWidth, first.specWidth, firstData.specWidth,
        skuFromIndex?.boardWidth, skuFromIndex?.board_width, skuFromIndex?.width, skuFromIndex?.specWidth
      )
      const boardHeightPicked = pickDim(
        o.boardHeight, o.board_height,
        data.boardHeight, data.board_height,
        meta.boardHeight, meta.board_height, brief.boardHeight, brief.board_height,
        product.boardHeight, product.board_height,
        first.boardHeight, first.board_height,
        firstData.boardHeight, firstData.board_height,
        o.specLength, data.specLength, product.specLength, first.specLength, firstData.specLength,
        skuFromIndex?.boardHeight, skuFromIndex?.board_height, skuFromIndex?.height, skuFromIndex?.length, skuFromIndex?.specLength
      )
      
      const sizeFromSpec = parseSizeFromSpec(specPicked) || parseSizeFromSpec(pickText(skuFromIndex?.specification, skuFromIndex?.spec))
      
      const finalBoardWidth = boardWidthPicked || sizeFromSpec?.w
      const finalBoardHeight = boardHeightPicked || sizeFromSpec?.h

      const boardSizeText = (Number.isFinite(finalBoardWidth) && Number.isFinite(finalBoardHeight) && finalBoardWidth > 0 && finalBoardHeight > 0) 
        ? `${finalBoardWidth}×${finalBoardHeight}mm` 
        : ''

      const looksLikeTwoDimSize = (v) => /^\d+(\.\d+)?×\d+(\.\d+)?$/.test(normalizeSizeToken(v))
      const looksLikeBoardSize = (specText) => {
        if (!looksLikeTwoDimSize(specText)) return false
        if (!boardSizeText) return true
        const s = normalizeSizeToken(specText)
        const a = normalizeSizeToken(boardSizeText)
        const b = normalizeSizeToken(boardSizeText.split('×').reverse().join('×'))
        return s === a || s === b
      }
      // -----------------------------------------------------------

      const baseCreasingType = pickText(
        o.creasingType, o.creasing_type, o.creaseType, o.crease_type,
        meta.creasingType, meta.creasing_type, meta.creaseType, meta.crease_type,
        brief.creasingType, brief.creasing_type, brief.creaseType, brief.crease_type,
        product.creasingType, product.creasing_type, product.creaseType, product.crease_type,
        first.creasingType, first.creasing_type, first.creaseType, first.crease_type
      )
      const baseS1 = pickVal(pickNumber(
        o.creasingSize1, o.creasing_size1, o.creaseSize1, o.crease_size1, o.creasingSize_1, o.creasing_size_1, o.creaseSize_1, o.crease_size_1,
        meta.creasingSize1, meta.creasing_size1, meta.creaseSize1, meta.crease_size1, meta.creasingSize_1, meta.creasing_size_1, meta.creaseSize_1, meta.crease_size_1,
        brief.creasingSize1, brief.creasing_size1, brief.creaseSize1, brief.crease_size1, brief.creasingSize_1, brief.creasing_size_1, brief.creaseSize_1, brief.crease_size_1,
        product.creasingSize1, product.creasing_size1, product.creaseSize1, product.crease_size1, product.creasingSize_1, product.creasing_size_1, product.creaseSize_1, product.crease_size_1,
        first.creasingSize1, first.creasing_size1, first.creaseSize1, first.crease_size1, first.creasingSize_1, first.creasing_size_1, first.creaseSize_1, first.crease_size_1
      ))
      const baseS2 = pickVal(pickNumber(
        o.creasingSize2, o.creasing_size2, o.creaseSize2, o.crease_size2, o.creasingSize_2, o.creasing_size_2, o.creaseSize_2, o.crease_size_2,
        meta.creasingSize2, meta.creasing_size2, meta.creaseSize2, meta.crease_size2, meta.creasingSize_2, meta.creasing_size_2, meta.creaseSize_2, meta.crease_size_2,
        brief.creasingSize2, brief.creasing_size2, brief.creaseSize2, brief.crease_size2, brief.creasingSize_2, brief.creasing_size_2, brief.creaseSize_2, brief.crease_size_2,
        product.creasingSize2, product.creasing_size2, product.creaseSize2, product.crease_size2, product.creasingSize_2, product.creasing_size_2, product.creaseSize_2, product.crease_size_2,
        first.creasingSize2, first.creasing_size2, first.creaseSize2, first.crease_size2, first.creasingSize_2, first.creasing_size_2, first.creaseSize_2, first.crease_size_2
      ))
      const baseS3 = pickVal(pickNumber(
        o.creasingSize3, o.creasing_size3, o.creaseSize3, o.crease_size3, o.creasingSize_3, o.creasing_size_3, o.creaseSize_3, o.crease_size_3,
        meta.creasingSize3, meta.creasing_size3, meta.creaseSize3, meta.crease_size3, meta.creasingSize_3, meta.creasing_size_3, meta.creaseSize_3, meta.crease_size_3,
        brief.creasingSize3, brief.creasing_size3, brief.creaseSize3, brief.crease_size3, brief.creasingSize_3, brief.creasing_size_3, brief.creaseSize_3, brief.crease_size_3,
        product.creasingSize3, product.creasing_size3, product.creaseSize3, product.crease_size3, product.creasingSize_3, product.creasing_size_3, product.creaseSize_3, product.crease_size_3,
        first.creasingSize3, first.creasing_size3, first.creaseSize3, first.crease_size3, first.creasingSize_3, first.creasing_size_3, first.creaseSize_3, first.crease_size_3
      ))
      const creaseFromText = parseCreaseText(pickText(
        o.pressLine, o.press_line,
        o.creasingSize, o.creaseSize, o.pressLineSize, o.press_line_size,
        meta.pressLine, meta.press_line,
        meta.creasingSize, meta.creaseSize, meta.pressLineSize, meta.press_line_size,
        brief.pressLine, brief.press_line,
        brief.creasingSize, brief.creaseSize, brief.pressLineSize, brief.press_line_size,
        product.pressLine, product.press_line,
        product.creasingSize, product.creaseSize, product.pressLineSize, product.press_line_size,
        first.pressLine, first.press_line,
        first.creasingSize, first.creaseSize, first.pressLineSize, first.press_line_size
      ))

      const finalCreasingType = baseCreasingType || normalizeText(skuFromIndex?.creasingType ?? skuFromIndex?.creaseType ?? skuFromIndex?.creasing_type ?? skuFromIndex?.crease_type) || normalizeText(creaseFromText?.type) || ''
      const finalS1 = baseS1 !== undefined ? baseS1 : (creaseFromText ? creaseFromText.c1 : pickVal(
        skuFromIndex?.creasingSize1 ?? skuFromIndex?.creasing_size1 ?? skuFromIndex?.creaseSize1 ?? skuFromIndex?.crease_size1 ??
        skuFromIndex?.creasingSize_1 ?? skuFromIndex?.creasing_size_1 ?? skuFromIndex?.creaseSize_1 ?? skuFromIndex?.crease_size_1
      ))
      const finalS2 = baseS2 !== undefined ? baseS2 : (creaseFromText ? creaseFromText.c2 : pickVal(
        skuFromIndex?.creasingSize2 ?? skuFromIndex?.creasing_size2 ?? skuFromIndex?.creaseSize2 ?? skuFromIndex?.crease_size2 ??
        skuFromIndex?.creasingSize_2 ?? skuFromIndex?.creasing_size_2 ?? skuFromIndex?.creaseSize_2 ?? skuFromIndex?.crease_size_2
      ))
      const finalS3 = baseS3 !== undefined ? baseS3 : (creaseFromText ? creaseFromText.c3 : pickVal(
        skuFromIndex?.creasingSize3 ?? skuFromIndex?.creasing_size3 ?? skuFromIndex?.creaseSize3 ?? skuFromIndex?.crease_size3 ??
        skuFromIndex?.creasingSize_3 ?? skuFromIndex?.creasing_size_3 ?? skuFromIndex?.creaseSize_3 ?? skuFromIndex?.crease_size_3
      ))
      const skuSpec = pickText(skuFromIndex?.specification, skuFromIndex?.spec)
      const finalSpec = (() => {
        const base = specPicked
        if (!base && skuSpec) return skuSpec
        if (skuSpec && looksLikeBoardSize(base) && normalizeSizeToken(base) !== normalizeSizeToken(skuSpec)) return skuSpec
        return base
      })()

      const finalGoodsName = (() => {
          return pickText(
            o.goodsName,
            o.goods_name,
            o.productTitle,
            o.product_title,
            o.productName,
            o.product_name,
            o.title,
            meta.goodsName,
            meta.goods_name,
            meta.productTitle,
            meta.product_title,
            meta.productName,
            meta.product_name,
            meta.title,
            brief.goodsName,
            brief.goods_name,
            brief.productTitle,
            brief.product_title,
            brief.productName,
            brief.product_name,
            brief.title,
            product.title,
            product.name,
            product.goodsName,
            product.goods_name,
            first.goodsName,
            first.goods_name,
            first.title,
            first.name,
            first.productName,
            first.product_name,
            '-'
          )
        })()

      const finalJoinMethod = pickText(o.joinMethod, o.join_method, meta.joinMethod, meta.join_method, brief.joinMethod, brief.join_method, product.joinMethod, first.joinMethod, skuFromIndex?.joinMethod, skuFromIndex?.join_method)
      const finalFlute = pickText(skuFromIndex?.flute, skuFromIndex?.fluteType, skuFromIndex?.flute_type, o.flute, o.fluteType, o.flute_type, meta.flute, meta.fluteType, brief.flute, brief.fluteType, product.flute, product.fluteType, first.flute, first.fluteType)
      const finalQuantity = pickNumber(o.quantity, o.qty, o.count, o.sheetCount, o.totalQty) ?? (quantityFromItems || 0)
      const finalUnitPrice = pickNumber(o.unitPrice, o.unit_price, o.salePrice, o.sale_price, o.price, product.unitPrice, product.salePrice, first.unitPrice, first.salePrice)
      
      const rawFromOrder = pickNumber(o.rawUnitPrice, o.raw_unit_price, o.rawMaterialUnitPrice, o.raw_material_unit_price, o.rawMaterialCost, o.raw_material_cost)
      const rawFromFirst = pickNumber(first.rawUnitPrice, first.raw_unit_price, first.rawMaterialUnitPrice, first.raw_material_unit_price, first.costPrice, first.cost_price, first.purchasePrice, first.purchase_price)
      const rawFromSku = pickNumber(skuFromIndex?.rawMaterialCost, skuFromIndex?.costPrice, skuFromIndex?.purchasePrice)
      const finalRawUnitPrice = rawFromOrder ?? rawFromFirst ?? rawFromSku
      const finalSheetCount = pickNumber(
        o.sheetCount, o.sheet_count, o.sheetQty, o.sheet_qty,
        data.sheetCount, data.sheet_count, data.sheetQty, data.sheet_qty,
        meta.sheetCount, meta.sheet_count, meta.sheetQty, meta.sheet_qty,
        brief.sheetCount, brief.sheet_count, brief.sheetQty, brief.sheet_qty,
        product.sheetCount, product.sheet_count,
        first.sheetCount, first.sheet_count,
        firstData.sheetCount, firstData.sheet_count
      )

      const finalAmount = pickNumber(o.amount, o.totalAmount, o.total_amount, o.finalAmount, o.final_amount)
      const finalNotes = pickText(o.notes, meta.notes, brief.notes)

      const resolveSkuForItem = (it) => {
        if (!skuIndex) return null
        const obj = it && typeof it === 'object' ? it : {}
        const itData = obj?.data && typeof obj.data === 'object' ? obj.data : {}
        const itSkuId = normalizeId(
          obj.skuId || obj.sku_id || obj.sku?._id || obj.sku?.id || obj.customerSkuId || obj.customer_sku_id ||
          itData.skuId || itData.sku_id || itData.sku?._id || itData.sku?.id || itData.customerSkuId || itData.customer_sku_id
        )
        if (itSkuId && skuIndex.has(`id:${normalizeKey(itSkuId)}`)) return skuIndex.get(`id:${normalizeKey(itSkuId)}`)

        const materialNoKey = normalizeKey(pickText(obj.materialNo, obj.material_no, itData.materialNo, itData.material_no, finalMaterialNo))
        const specCandidate = pickText(obj.specification, obj.spec, itData.specification, itData.spec, finalSpec)
        const specKey = normalizeSpecKey(specCandidate)
        if (materialNoKey && specKey && skuIndex.has(`ms:${materialNoKey}::${specKey}`)) return skuIndex.get(`ms:${materialNoKey}::${specKey}`)
        if (materialNoKey && skuIndex.has(`m:${materialNoKey}`)) return skuIndex.get(`m:${materialNoKey}`)

        const nameKey = normalizeKey(pickText(obj.goodsName, obj.goods_name, obj.productTitle, obj.product_title, obj.title, obj.productName, obj.product_name, obj.name, itData.goodsName, itData.goods_name, itData.title, finalGoodsName))
        if (nameKey && specKey && skuIndex.has(`ns:${nameKey}::${specKey}`)) return skuIndex.get(`ns:${nameKey}::${specKey}`)
        if (nameKey && skuIndex.has(`n:${nameKey}`)) return skuIndex.get(`n:${nameKey}`)
        return null
      }
      const normalizeItemForView = (it) => {
        const obj = it && typeof it === 'object' ? it : {}
        const itData = obj?.data && typeof obj.data === 'object' ? obj.data : {}
        const itMeta = obj?.meta && typeof obj.meta === 'object' ? obj.meta : {}
        const itBrief = itMeta?.brief && typeof itMeta.brief === 'object' ? itMeta.brief : {}
        const itProduct = obj?.product && typeof obj.product === 'object' ? obj.product : {}
        const sku = resolveSkuForItem(obj)

        const goodsName = pickText(
          obj.goodsName, obj.goods_name, obj.productTitle, obj.product_title, obj.title, obj.productName, obj.product_name, obj.name,
          itData.goodsName, itData.goods_name, itData.productTitle, itData.product_title, itData.title, itData.productName, itData.product_name, itData.name,
          itBrief.goodsName, itBrief.goods_name, itBrief.productTitle, itBrief.product_title, itBrief.title,
          itProduct.goodsName, itProduct.goods_name, itProduct.name, itProduct.title,
          sku?.goodsName, sku?.name, sku?.productName,
          finalGoodsName
        )
        const category = pickText(
          obj.category, obj.productCategory, obj.productType,
          itData.category, itData.productCategory, itData.productType,
          itBrief.category, itBrief.productCategory, itBrief.productType,
          itProduct.category, itProduct.productCategory, itProduct.productType,
          sku?.category, sku?.productCategory, sku?.productType
        )
        const specification = pickText(
          obj.specification, obj.spec,
          itData.specification, itData.spec,
          itBrief.specification, itBrief.spec,
          itProduct.specification, itProduct.spec,
          sku?.specification, sku?.spec,
          finalSpec
        )
        const materialNo = pickText(
          obj.materialNo, obj.material_no,
          itData.materialNo, itData.material_no,
          itBrief.materialNo, itBrief.material_no,
          itProduct.materialNo, itProduct.material_no,
          sku?.materialNo,
          finalMaterialNo
        )
        const materialCode = pickText(
          obj.materialCode, obj.material_code,
          itData.materialCode, itData.material_code,
          itBrief.materialCode, itBrief.material_code,
          itProduct.materialCode, itProduct.material_code,
          sku?.materialCode, sku?.material_code,
          finalMaterialCode
        )
        const flute = pickText(
          obj.flute, obj.fluteType, obj.flute_type,
          itData.flute, itData.fluteType, itData.flute_type,
          itBrief.flute, itBrief.fluteType, itBrief.flute_type,
          itProduct.flute, itProduct.fluteType, itProduct.flute_type,
          sku?.flute, sku?.fluteType, sku?.flute_type,
          finalFlute
        )
        const joinMethod = pickText(
          obj.joinMethod, obj.join_method,
          itData.joinMethod, itData.join_method,
          itBrief.joinMethod, itBrief.join_method,
          itProduct.joinMethod, itProduct.join_method,
          sku?.joinMethod, sku?.join_method,
          finalJoinMethod
        )

        const boardWidth = pickDim(
          obj.boardWidth, obj.board_width, obj.specWidth, obj.width,
          itData.boardWidth, itData.board_width, itData.specWidth, itData.width,
          itBrief.boardWidth, itBrief.board_width, itBrief.specWidth, itBrief.width,
          itProduct.boardWidth, itProduct.board_width, itProduct.specWidth, itProduct.width,
          sku?.boardWidth, sku?.board_width, sku?.width, sku?.specWidth
        )
        const boardHeight = pickDim(
          obj.boardHeight, obj.board_height, obj.specLength, obj.specHeight, obj.length, obj.height,
          itData.boardHeight, itData.board_height, itData.specLength, itData.specHeight, itData.length, itData.height,
          itBrief.boardHeight, itBrief.board_height, itBrief.specLength, itBrief.specHeight, itBrief.length, itBrief.height,
          itProduct.boardHeight, itProduct.board_height, itProduct.specLength, itProduct.specHeight, itProduct.length, itProduct.height,
          sku?.boardHeight, sku?.board_height, sku?.height, sku?.length, sku?.specLength, sku?.specHeight
        )
        const sizeFromSpec = parseSizeFromSpec(specification) || parseSizeFromSpec(pickText(sku?.specification, sku?.spec))
        const finalBoardWidth2 = boardWidth || sizeFromSpec?.w
        const finalBoardHeight2 = boardHeight || sizeFromSpec?.h

        const quantity = pickNumber(
          obj.quantity, obj.qty, obj.count, obj.orderQty, obj.orderQuantity,
          itData.quantity, itData.qty, itData.count, itData.orderQty, itData.orderQuantity
        )
        const unitPrice = (() => {
          const p = pickNumber(
            obj.unitPrice, obj.unit_price, obj.salePrice, obj.sale_price, obj.price,
            itData.unitPrice, itData.unit_price, itData.salePrice, itData.sale_price, itData.price
          )
          if (Number.isFinite(p)) return p
          const total = pickNumber(obj.totalPrice, obj.total_price, obj.totalAmount, obj.total_amount, itData.totalPrice, itData.total_price, itData.totalAmount, itData.total_amount)
          const q = Number(quantity ?? 0)
          if (Number.isFinite(total) && total >= 0 && q > 0) return total / q
          return undefined
        })()
        const amount = (() => {
          const a = pickNumber(
            obj.amount, obj.totalAmount, obj.total_amount, obj.finalAmount, obj.final_amount,
            obj.totalPrice, obj.total_price,
            itData.amount, itData.totalAmount, itData.total_amount, itData.finalAmount, itData.final_amount, itData.totalPrice, itData.total_price
          )
          if (Number.isFinite(a)) return a
          const q = Number(quantity ?? 0)
          const p = Number(unitPrice ?? 0)
          if (q > 0 && Number.isFinite(p) && p >= 0) return q * p
          return undefined
        })()
        const rawUnitPrice = pickNumber(
          obj.rawUnitPrice, obj.raw_unit_price, obj.rawMaterialUnitPrice, obj.raw_material_unit_price, obj.rawMaterialCost, obj.raw_material_cost,
          obj.costPrice, obj.cost_price, obj.purchasePrice, obj.purchase_price,
          itData.rawUnitPrice, itData.raw_unit_price, itData.rawMaterialUnitPrice, itData.raw_material_unit_price, itData.rawMaterialCost, itData.raw_material_cost,
          itData.costPrice, itData.cost_price, itData.purchasePrice, itData.purchase_price,
          sku?.rawMaterialCost, sku?.costPrice, sku?.purchasePrice,
          finalRawUnitPrice
        )
        const sheetPerUnit = pickNumber(
          obj.skuSheetCount, obj.sheetPerUnit, obj.sheet_per_unit,
          itData.skuSheetCount, itData.sheetPerUnit, itData.sheet_per_unit,
          sku?.skuSheetCount, sku?.sheetPerUnit, sku?.sheet_per_unit
        )
        const sheetCount = (() => {
          const s = pickNumber(
            obj.sheetCount, obj.sheet_count, obj.sheetQty, obj.sheet_qty,
            obj.orderedQuantity, obj.ordered_quantity, obj.orderedSheets, obj.ordered_sheets,
            itData.sheetCount, itData.sheet_count, itData.sheetQty, itData.sheet_qty,
            itData.orderedQuantity, itData.ordered_quantity, itData.orderedSheets, itData.ordered_sheets
          )
          if (Number.isFinite(s) && s > 0) return s
          const q = Number(quantity ?? 0)
          const per = Number(sheetPerUnit ?? 0)
          if (q > 0 && Number.isFinite(per) && per > 0) return q * per
          return undefined
        })()

        return {
          ...obj,
          category: category || obj.category,
          goodsName: goodsName || obj.goodsName,
          materialNo: materialNo || obj.materialNo,
          materialCode: materialCode || obj.materialCode,
          specification: specification || obj.specification,
          spec: specification || obj.spec,
          boardWidth: finalBoardWidth2 ?? obj.boardWidth,
          boardHeight: finalBoardHeight2 ?? obj.boardHeight,
          flute: flute || obj.flute,
          joinMethod: joinMethod || obj.joinMethod,
          quantity: quantity ?? obj.quantity,
          sheetCount: sheetCount ?? obj.sheetCount,
          unitPrice: unitPrice ?? obj.unitPrice,
          rawUnitPrice: rawUnitPrice ?? obj.rawUnitPrice,
          amount: amount ?? obj.amount
        }
      }

      let finalItems = Array.isArray(items) ? [...items] : []
      if (finalItems.length === 0) {
        finalItems.push({
          goodsName: finalGoodsName,
          materialNo: finalMaterialNo,
          materialCode: finalMaterialCode,
          specification: finalSpec,
          boardWidth: finalBoardWidth,
          boardHeight: finalBoardHeight,
          flute: finalFlute,
          creasingType: finalCreasingType,
          creasingSize1: finalS1,
          creasingSize2: finalS2,
          creasingSize3: finalS3,
          pressLine: pickText(o.pressLine, o.press_line),
          joinMethod: finalJoinMethod,
          quantity: finalQuantity,
          unitPrice: finalUnitPrice,
          rawUnitPrice: finalRawUnitPrice,
          amount: finalAmount
        })
      } else {
        finalItems = finalItems.map(normalizeItemForView)
      }

      setOrder({
        ...o,
        items: finalItems,
        orderNo,
        purchaseOrderId,
        purchaseOrderNo,
        materialCode: finalMaterialCode,
        materialNo: finalMaterialNo,
        boardWidth: boardWidthPicked,
        boardHeight: boardHeightPicked,
        boardSize: boardSizeText, // For backward compatibility if used elsewhere
        boardSizeText,
        customerName: pickText(
          o.customerName,
          o.customer_name,
          o.customer?.companyName,
          o.customer?.shortName,
          o.customer?.name,
          o.customer,
          meta.customerName,
          meta.customer_name,
          brief.customerName,
          brief.customer_name,
          product.customerName,
          product.customer_name,
          product.customer?.companyName,
          product.customer?.shortName,
          product.customer?.name,
          product.customer,
          first.customerName,
          first.customer_name,
          first.customer?.companyName,
          first.customer?.shortName,
          first.customer?.name,
          first.customer
        ),
        supplierName: pickText(
          o.supplierName,
          o.supplier_name,
          meta.supplierName,
          meta.supplier_name,
          brief.supplierName,
          brief.supplier_name,
          product.supplierName,
          product.supplier_name,
          first.supplierName,
          first.supplier_name
        ),
        supplierShortName: pickText(
          o.supplierShortName,
          o.supplier_short_name,
          meta.supplierShortName,
          meta.supplier_short_name,
          brief.supplierShortName,
          brief.supplier_short_name,
          product.supplierShortName,
          product.supplier_short_name,
          first.supplierShortName,
          first.supplier_short_name
        ),
        productName: pickText(o.productName, o.product_name, meta.productName, meta.product_name, brief.productName, brief.product_name, product.name, product.productName, first.productName, first.product_name),
        goodsName: finalGoodsName,
        spec: finalSpec,
        joinMethod: finalJoinMethod,
        flute: finalFlute,
        creasingType: finalCreasingType,
        creasingSize1: finalS1,
        creasingSize2: finalS2,
        creasingSize3: finalS3,
        quantity: finalQuantity,
        sheetCount: finalSheetCount,
        unitPrice: finalUnitPrice,
        rawUnitPrice: finalRawUnitPrice,
        amount: finalAmount,
        status: pickText(o.status, meta.status, brief.status),
        createdAt: (() => {
          const t = pickText(o.createdAt, o.createTime, meta.createdAt, meta.createTime, brief.createdAt, brief.createTime)
          return (t && dayjs(t).isValid()) ? dayjs(t).format('YYYY-MM-DD HH:mm:ss') : '-'
        })(),
        deliveryDate: pickText(o.deliveryDate, o.deadline, meta.deliveryDate, meta.deadline, brief.deliveryDate, brief.deadline),
        notes: finalNotes,
        attachments,
        qrCodeUrl
      })

    } catch (e) {
      message.error('加载订单详情失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadDetail() }, [id])

  const columns = [
    { title: '序号', key: 'idx', width: 50, render: (_, r) => r.__idx },
    {
      title: '产品类别',
      key: 'category',
      width: 100,
      render: (_, r) => {
        const normalizeText = (v) => String(v ?? '').trim()
        const normalizeKey = (v) => normalizeText(v).toLowerCase()
        const normalizeId = (v) => {
          const s = normalizeText(v)
          if (!s) return ''
          const parts = s.split(/[\\/]/).filter(Boolean)
          return parts.length ? parts[parts.length - 1] : s
        }
        const skuId = normalizeId(r?.skuId || r?.sku_id || r?.sku?._id || r?.sku?.id || r?.customerSkuId || r?.customer_sku_id)
        const materialKey = normalizeKey(
          r?.materialNo || r?.material_no ||
          r?.materialCode || r?.material_code || r?.material ||
          order?.materialNo || order?.material_no ||
          order?.materialCode || order?.material_code || order?.material
        )
        const rawSpec = normalizeText(r?.specification || r?.spec || order?.spec || '')
        const specKey = normalizeKey(rawSpec).replace(/[x*]/g, '×').replace(/mm$/i, '')
        const idx = customerSkuIndex
        const skuFromIndex = (() => {
          if (!idx) return null
          if (skuId && idx.has(`id:${normalizeKey(skuId)}`)) return idx.get(`id:${normalizeKey(skuId)}`)
          if (materialKey && specKey && idx.has(`ms:${materialKey}::${specKey}`)) return idx.get(`ms:${materialKey}::${specKey}`)
          if (materialKey && specKey && idx.has(`cs:${materialKey}::${specKey}`)) return idx.get(`cs:${materialKey}::${specKey}`)
          if (materialKey && idx.has(`m:${materialKey}`)) return idx.get(`m:${materialKey}`)
          if (materialKey && idx.has(`c:${materialKey}`)) return idx.get(`c:${materialKey}`)
          return null
        })()
        
        return r?.category || r?.productCategory || r?.productType || skuFromIndex?.category || skuFromIndex?.productCategory || skuFromIndex?.productType || '-'
      }
    },
    {
      title: '商品名称',
      key: 'goodsName',
      width: 180,
      render: (_, r) => {
        const name = String(r?.goodsName || r?.title || r?.productName || r?.name || '').trim()
        return name || (order.goodsName || '-')
      }
    },
    {
      title: '物料号',
      key: 'materialNo',
      width: 140,
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
        const extractValidMaterialNo = (raw) => {
          const s = normalizeText(raw)
          if (!s) return ''
          const parts = s.split(/[/／]/).map((x) => String(x || '').trim()).filter(Boolean)
          const head = parts[0] || ''
          if (head && isMaterialNo(head)) return head
          if (isMaterialNo(s)) return s
          return ''
        }

        const skuId = normalizeId(r?.skuId || r?.sku_id || r?.sku?._id || r?.sku?.id || r?.customerSkuId || r?.customer_sku_id)
        const rawSpec = normalizeText(r?.specification || r?.spec || order?.spec || '')
        const specKey = normalizeSpecKey(rawSpec)
        const nameKey = normalizeKey(r?.goodsName || r?.title || r?.productName || r?.name || order?.goodsName || order?.title || order?.productName || order?.name || '')
        const materialKey = normalizeKey(
          r?.materialNo || r?.material_no ||
          r?.materialCode || r?.material_code || r?.material ||
          order?.materialNo || order?.material_no ||
          order?.materialCode || order?.material_code || order?.material
        )
        const idx = customerSkuIndex
        const skuFromIndex = (() => {
          if (!idx) return null
          if (skuId && idx.has(`id:${normalizeKey(skuId)}`)) return idx.get(`id:${normalizeKey(skuId)}`)
          if (materialKey && specKey && idx.has(`ms:${materialKey}::${specKey}`)) return idx.get(`ms:${materialKey}::${specKey}`)
          if (materialKey && specKey && idx.has(`cs:${materialKey}::${specKey}`)) return idx.get(`cs:${materialKey}::${specKey}`)
          if (materialKey && idx.has(`m:${materialKey}`)) return idx.get(`m:${materialKey}`)
          if (materialKey && idx.has(`c:${materialKey}`)) return idx.get(`c:${materialKey}`)
          if (nameKey && specKey && idx.has(`ns:${nameKey}::${specKey}`)) return idx.get(`ns:${nameKey}::${specKey}`)
          if (nameKey && idx.has(`n:${nameKey}`)) return idx.get(`n:${nameKey}`)
          return null
        })()

        const skuNo = extractValidMaterialNo(skuFromIndex?.materialNo ?? skuFromIndex?.material_no)
        const skuCode = normalizeText(skuFromIndex?.materialCode ?? skuFromIndex?.material_code ?? skuFromIndex?.material)
        if (skuNo) {
          if (skuCode && normalizeKey(skuNo) === normalizeKey(skuCode)) return '-'
          return skuNo
        }

        const itemMaterialNo = normalizeText(r?.materialNo || r?.material_no)
        const itemMaterialCode = normalizeText(r?.materialCode || r?.material_code || r?.material)
        const itemNo = extractValidMaterialNo(itemMaterialNo)
        if (!itemNo) return '-'
        if (itemMaterialCode && normalizeKey(itemNo) === normalizeKey(itemMaterialCode)) return '-'
        if (skuCode && normalizeKey(itemNo) === normalizeKey(skuCode)) return '-'
        return itemNo
      }
    },
    {
      title: '规格尺寸原材料信息',
      key: 'specInfo',
      width: 220,
      render: (_, r) => {
        const normalizeText = (v) => String(v ?? '').trim()
        const normalizeKey = (v) => normalizeText(v).toLowerCase()
        const normalizeId = (v) => {
          const s = normalizeText(v)
          if (!s) return ''
          const parts = s.split(/[\\/]/).filter(Boolean)
          return parts.length ? parts[parts.length - 1] : s
        }
        const skuId = normalizeId(r?.skuId || r?.sku_id || r?.sku?._id || r?.sku?.id || r?.customerSkuId || r?.customer_sku_id)
        const materialKey = normalizeKey(
          r?.materialNo || r?.material_no ||
          r?.materialCode || r?.material_code || r?.material ||
          order?.materialNo || order?.material_no ||
          order?.materialCode || order?.material_code || order?.material
        )
        const rawSpec = normalizeText(r?.specification || r?.spec || order?.spec || '')
        const specKey = normalizeKey(rawSpec).replace(/[x*]/g, '×').replace(/mm$/i, '')
        const idx = customerSkuIndex
        const skuFromIndex = (() => {
          if (!idx) return null
          if (skuId && idx.has(`id:${normalizeKey(skuId)}`)) return idx.get(`id:${normalizeKey(skuId)}`)
          if (materialKey && specKey && idx.has(`ms:${materialKey}::${specKey}`)) return idx.get(`ms:${materialKey}::${specKey}`)
          if (materialKey && specKey && idx.has(`cs:${materialKey}::${specKey}`)) return idx.get(`cs:${materialKey}::${specKey}`)
          if (materialKey && idx.has(`m:${materialKey}`)) return idx.get(`m:${materialKey}`)
          if (materialKey && idx.has(`c:${materialKey}`)) return idx.get(`c:${materialKey}`)
          return null
        })()

        const spec = String(r?.specification || r?.spec || skuFromIndex?.specification || skuFromIndex?.spec || order.spec || '-').trim()
        
        const w = Number(r?.boardWidth ?? r?.board_width ?? r?.specWidth ?? r?.width ?? skuFromIndex?.boardWidth ?? skuFromIndex?.board_width ?? skuFromIndex?.width)
        const h = Number(r?.boardHeight ?? r?.board_height ?? r?.specLength ?? r?.length ?? skuFromIndex?.boardHeight ?? skuFromIndex?.board_height ?? skuFromIndex?.height)
        const boardSize = (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) 
            ? `${w}×${h}mm` 
            : (order.boardSizeText || order.boardSize || '')
        
        let itemMaterialNo = normalizeText(r?.materialNo || r?.material_no)
        let itemMaterialCode = normalizeText(r?.materialCode || r?.material_code)
        const isNumeric = (str) => /^\d+$/.test(str)
        const looksLikeMaterialNo = (str) => isNumeric(str) && str.length > 6
        const looksLikeMaterialCode = (str) => !isNumeric(str) && str.length < 10
        if (looksLikeMaterialNo(itemMaterialCode) && looksLikeMaterialCode(itemMaterialNo)) {
            const temp = itemMaterialCode
            itemMaterialCode = itemMaterialNo
            itemMaterialNo = temp
        } else if (looksLikeMaterialNo(itemMaterialCode) && !itemMaterialNo) {
            itemMaterialNo = itemMaterialCode
            itemMaterialCode = ''
        } else if (looksLikeMaterialCode(itemMaterialNo) && !itemMaterialCode) {
            itemMaterialCode = itemMaterialNo
            itemMaterialNo = ''
        }
        const mc = itemMaterialCode || skuFromIndex?.materialCode || skuFromIndex?.material_code || String(order.materialCode || '').trim() || ''
        const fl = String(r?.flute || r?.fluteType || r?.flute_type || skuFromIndex?.flute || skuFromIndex?.fluteType || '').trim() || String(order.flute || '').trim() || ''

        const mergedCrease = {
          creasingSize1:
            r?.creasingSize1 ?? r?.creasing_size1 ?? r?.creaseSize1 ?? r?.crease_size1 ?? r?.creasingSize_1 ?? r?.creasing_size_1 ?? r?.creaseSize_1 ?? r?.crease_size_1 ??
            skuFromIndex?.creasingSize1 ?? skuFromIndex?.creasing_size1 ?? skuFromIndex?.creaseSize1 ?? skuFromIndex?.crease_size1 ?? skuFromIndex?.creasingSize_1 ?? skuFromIndex?.creasing_size_1 ?? skuFromIndex?.creaseSize_1 ?? skuFromIndex?.crease_size_1 ??
            order?.creasingSize1 ?? order?.creasing_size1 ?? order?.creaseSize1 ?? order?.crease_size1 ?? order?.creasingSize_1 ?? order?.creasing_size_1 ?? order?.creaseSize_1 ?? order?.crease_size_1,
          creasingSize2:
            r?.creasingSize2 ?? r?.creasing_size2 ?? r?.creaseSize2 ?? r?.crease_size2 ?? r?.creasingSize_2 ?? r?.creasing_size_2 ?? r?.creaseSize_2 ?? r?.crease_size_2 ??
            skuFromIndex?.creasingSize2 ?? skuFromIndex?.creasing_size2 ?? skuFromIndex?.creaseSize2 ?? skuFromIndex?.crease_size2 ?? skuFromIndex?.creasingSize_2 ?? skuFromIndex?.creasing_size_2 ?? skuFromIndex?.creaseSize_2 ?? skuFromIndex?.crease_size_2 ??
            order?.creasingSize2 ?? order?.creasing_size2 ?? order?.creaseSize2 ?? order?.crease_size2 ?? order?.creasingSize_2 ?? order?.creasing_size_2 ?? order?.creaseSize_2 ?? order?.crease_size_2,
          creasingSize3:
            r?.creasingSize3 ?? r?.creasing_size3 ?? r?.creaseSize3 ?? r?.crease_size3 ?? r?.creasingSize_3 ?? r?.creasing_size_3 ?? r?.creaseSize_3 ?? r?.crease_size_3 ??
            skuFromIndex?.creasingSize3 ?? skuFromIndex?.creasing_size3 ?? skuFromIndex?.creaseSize3 ?? skuFromIndex?.crease_size3 ?? skuFromIndex?.creasingSize_3 ?? skuFromIndex?.creasing_size_3 ?? skuFromIndex?.creaseSize_3 ?? skuFromIndex?.crease_size_3 ??
            order?.creasingSize3 ?? order?.creasing_size3 ?? order?.creaseSize3 ?? order?.crease_size3 ?? order?.creasingSize_3 ?? order?.creasing_size_3 ?? order?.creaseSize_3 ?? order?.crease_size_3,
          creasingType: r?.creasingType ?? r?.creasing_type ?? r?.creaseType ?? r?.crease_type ?? skuFromIndex?.creasingType ?? skuFromIndex?.creaseType ?? skuFromIndex?.creasing_type ?? skuFromIndex?.crease_type ?? order?.creasingType ?? order?.creasing_type ?? order?.creaseType ?? order?.crease_type,
          pressLine: r?.pressLine ?? r?.press_line ?? r?.pressLineSize ?? r?.press_line_size ?? r?.creasingSize ?? r?.creaseSize ?? r?.creasing_size ?? r?.crease_size ?? skuFromIndex?.pressLine ?? skuFromIndex?.press_line ?? skuFromIndex?.pressLineSize ?? skuFromIndex?.press_line_size ?? skuFromIndex?.creasingSize ?? skuFromIndex?.creaseSize ?? skuFromIndex?.creasing_size ?? skuFromIndex?.crease_size ?? order?.pressLine ?? order?.press_line ?? order?.pressLineSize ?? order?.press_line_size ?? order?.creasingSize ?? order?.creaseSize ?? order?.creasing_size ?? order?.crease_size
        }
        const cr = formatCrease(mergedCrease)
        const crText = cr === '-' ? '' : cr

        const lines = [
           spec,
           boardSize ? `纸板: ${boardSize}` : null,
           (mc || fl) ? [mc, fl].filter(Boolean).join(' | ') : null,
           crText ? `压线: ${crText}` : null
        ].filter(Boolean)

        return (
          <div style={{ fontSize: 13, lineHeight: 1.5 }}>
              {lines.map((t, i) => (
                  <div key={i} style={i === 0 ? { fontWeight: 500, marginBottom: 2 } : { color: '#666', fontSize: 12 }}>
                      {t}
                  </div>
              ))}
          </div>
        )
      }
    },
    {
      title: '订单数量',
      key: 'quantity',
      width: 90,
      align: 'right',
      render: (_, r) => {
        const q = Number(r?.quantity ?? r?.qty ?? r?.count ?? r?.orderQty ?? r?.orderQuantity)
        if (Number.isFinite(q)) return q.toLocaleString()
        return (order.quantity ?? '-')
      }
    },
    {
      title: '下单片数',
      key: 'sheetCount',
      width: 90,
      align: 'right',
      render: (_, r) => {
          const s = Number(r?.sheetCount ?? r?.sheet_count ?? r?.sheetQty ?? r?.sheet_qty ?? r?.orderedQuantity ?? r?.ordered_quantity ?? r?.orderedSheets ?? r?.ordered_sheets ?? order?.sheetCount ?? 0)
          if (Number.isFinite(s) && s > 0) return s.toLocaleString()
          return '-'
      }
    },
    {
      title: '单价',
      key: 'unitPrice',
      width: 90,
      align: 'right',
      render: (_, r) => {
        const p = Number(r?.unitPrice ?? r?.unit_price ?? r?.salePrice ?? r?.sale_price ?? r?.price)
        if (Number.isFinite(p)) return p.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })
        return (order.unitPrice ?? '-')
      }
    },
    {
      title: '原材料单价',
      key: 'rawUnitPrice',
      width: 100,
      align: 'right',
      render: (_, r) => {
        const base = Number(
          r?.rawUnitPrice ??
            r?.raw_unit_price ??
            r?.rawMaterialUnitPrice ??
            r?.raw_material_unit_price ??
            order?.rawUnitPrice ??
            order?.raw_unit_price ??
            order?.rawMaterialUnitPrice ??
            order?.raw_material_unit_price
        )
        const rawFactor = Number(
          r?.skuSheetCount ??
            r?.sheetPerUnit ??
            r?.sheet_per_unit ??
            r?.perSheet ??
            r?.per_sheet ??
            0
        )
        const qty = Number(r?.quantity ?? r?.qty ?? r?.count ?? r?.orderQty ?? r?.orderQuantity ?? 0)
        const totalSheets = Number(
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
        const ratio = (qty > 0 && totalSheets > 0) ? (totalSheets / qty) : 0
        const ratioRounded = Number.isFinite(ratio) && ratio > 0 ? Math.round(ratio) : 0
        const ratioFactor = ratioRounded > 0 && Math.abs(ratio - ratioRounded) <= 0.01 ? ratioRounded : 0
        const jm = String(r?.joinMethod ?? r?.join_method ?? '').trim()
        const joinFactor = jm.includes('四拼') ? 4 : (jm.includes('双拼') ? 2 : (jm.includes('单拼') ? 1 : 0))
        const skuFactor = Number.isFinite(rawFactor) && rawFactor > 0 ? rawFactor : 0
        const factor = Math.max(skuFactor, joinFactor, ratioFactor)
        const p = Number.isFinite(base) && factor > 0 ? base * factor : base
        return Number.isFinite(p) ? p.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 }) : '-'
      }
    },
    {
      title: '毛利润',
      key: 'grossProfit',
      width: 100,
      align: 'right',
      render: (_, r) => {
        const qty = Number(r?.quantity ?? r?.qty ?? r?.count ?? r?.orderQty ?? r?.orderQuantity ?? 0)
        let amount = Number(r?.amount ?? r?.totalAmount ?? r?.total_amount ?? r?.finalAmount ?? r?.final_amount)
        if (!Number.isFinite(amount)) {
            const price = Number(r?.unitPrice ?? r?.unit_price ?? r?.salePrice ?? r?.sale_price ?? r?.price ?? 0)
            if (qty > 0 && Number.isFinite(price)) amount = qty * price
        }
        const costPrice = Number(r?.rawUnitPrice ?? r?.raw_unit_price ?? r?.costPrice ?? r?.cost_price ?? r?.purchasePrice ?? r?.purchase_price ?? 0)
        let rawAmount = 0
        const totalSheets = Number(
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
        const rawPerSheets = Number(
          r?.skuSheetCount ??
            r?.sheetPerUnit ??
            r?.sheet_per_unit ??
            r?.perSheet ??
            r?.per_sheet ??
            0
        )
        const jm = String(r?.joinMethod ?? r?.join_method ?? '').trim()
        const joinFactor = jm.includes('四拼') ? 4 : (jm.includes('双拼') ? 2 : (jm.includes('单拼') ? 1 : 0))
        const perSheets = Math.max(
          Number.isFinite(rawPerSheets) && rawPerSheets > 0 ? rawPerSheets : 0,
          joinFactor,
          (() => {
            const ratio = (qty > 0 && totalSheets > 0) ? (totalSheets / qty) : 0
            const ratioRounded = Number.isFinite(ratio) && ratio > 0 ? Math.round(ratio) : 0
            return ratioRounded > 0 && Math.abs(ratio - ratioRounded) <= 0.01 ? ratioRounded : 0
          })()
        )
        const computedSheets = (qty > 0 && Number.isFinite(perSheets) && perSheets > 0) ? qty * perSheets : 0
        const sheetsForCost = totalSheets > 0 ? totalSheets : (computedSheets > 0 ? computedSheets : qty)
        if (totalSheets > 0 && Number.isFinite(costPrice)) {
            rawAmount = totalSheets * costPrice
        } else if (qty > 0 && Number.isFinite(costPrice)) {
            rawAmount = sheetsForCost * costPrice
        }
        if (Number.isFinite(amount)) {
            const p = amount - rawAmount
            return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        }
        return '-'
      }
    },
    {
      title: '订单金额',
      key: 'amount',
      width: 110,
      align: 'right',
      render: (_, r) => {
        let a = Number(r?.amount ?? r?.totalAmount ?? r?.total_amount ?? r?.finalAmount ?? r?.final_amount)
        if (!Number.isFinite(a)) {
          const q = Number(r?.quantity ?? r?.qty ?? r?.count ?? r?.orderQty ?? r?.orderQuantity ?? 0)
          const p = Number(r?.unitPrice ?? r?.unit_price ?? r?.salePrice ?? r?.sale_price ?? r?.price ?? 0)
          if (q > 0 && p >= 0) a = q * p
        }
        if (Number.isFinite(a)) return a.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
        return '-'
      }
    },
    {
      title: '订单状态',
      key: 'status',
      width: 100,
      render: (_, r) => {
          const s = r?.status || order.status || '-'
          const t = statusMap[s]?.text || s
          const c = statusMap[s]?.color || 'default'
          return <Tag color={c}>{t}</Tag>
      }
    }
  ]

  return (
    <Spin spinning={loading}>
      <Card title="订单详情" extra={<Space><Button onClick={() => safeNavigateBack(navigate, '/orders')}>返回</Button><Button type="primary" icon={<EditOutlined />} onClick={onEdit}>编辑</Button><Button onClick={() => navigate(`/orders/create?mode=copy&from=${encodeURIComponent(order?._id || order?.id || id)}`)}>复制订单</Button></Space>}>
        {order && (
          <>
            <Card type="inner" title="客户信息" style={{ marginBottom: 16 }}>
              <Row gutter={24}>
                <Col xs={24} md={16}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 72, color: '#666' }}>订单编号</div>
                      <div style={{ fontWeight: 500 }}>{order.orderNo || '-'}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 72, color: '#666' }}>订单状态</div>
                      <div>
                        <Tag color={statusMap[order.status]?.color || 'default'} style={{ fontSize: 16, fontWeight: 600, padding: '4px 10px' }}>
                          {statusMap[order.status]?.text || order.status || '-'}
                        </Tag>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 72, color: '#666' }}>客户名</div>
                      <div>{order.customerName || '-'}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 72, color: '#666' }}>供应商</div>
                      <div>{order.supplierShortName || order.supplierName || '-'}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div style={{ width: 72, color: '#666' }}>下单时间</div>
                      <div>{order.createdAt || '-'}</div>
                    </div>
                  </div>
                </Col>
                <Col xs={24} md={8} style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                  <div style={{ textAlign: 'center' }}>
                    <div style={{ marginBottom: 8, color: '#666' }}>订单二维码</div>
                    {order.qrCodeUrl ? (
                      <Image width={120} src={order.qrCodeUrl} />
                    ) : (
                      <Tag>暂无二维码</Tag>
                    )}
                  </div>
                </Col>
              </Row>
            </Card>
            <Card type="inner" title="产品列表" style={{ marginBottom: 16 }}>
              <Table
                size="small"
                pagination={false}
                dataSource={order.items.map((it, idx) => ({
                  ...(it && typeof it === 'object' ? it : {}),
                  __idx: idx + 1,
                  __key: String(it?.id || it?._id || it?.key || `${order._id || order.id || id || 'order'}:${idx + 1}`)
                }))}
                rowKey={(r) => r.__key}
                columns={columns}
                scroll={{ x: 'max-content' }}
              />
            </Card>

            <Card type="inner" title="订单备注" style={{ marginBottom: 16 }}>
              <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>备注：{order.notes || '-'}</div>
            </Card>

            <Card type="inner" title="附件信息" style={{ marginBottom: 16 }}>
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontWeight: 600, marginBottom: 12 }}>图纸预览</div>
                {Array.isArray(order.attachments) && order.attachments.filter(f => f.isImage && f.url).length ? (
                  <Image.PreviewGroup>
                    <Space wrap>
                      {order.attachments.filter(f => f.isImage && f.url).map((f) => (
                        <Image key={f.uid} width={sizeMap[imgSize]} src={f.url} />
                      ))}
                    </Space>
                  </Image.PreviewGroup>
                ) : (
                  <Tag>暂无可预览图片</Tag>
                )}
                <Space style={{ marginTop: 8 }}>
                  <Segmented value={imgSize} onChange={setImgSize} options={['缩略', '标准', '大图']} />
                </Space>
              </div>
              
              <div style={{ marginBottom: 24 }}>
                <div style={{ fontWeight: 600, marginBottom: 12 }}>PDF预览</div>
                {Array.isArray(order.attachments) && order.attachments.filter(f => f.isPdf && f.url).length ? (
                  <Space wrap>
                    {order.attachments.filter(f => f.isPdf && f.url).map((f) => (
                      <iframe key={f.uid} src={f.url} style={{ width: sizeMap[pdfSize], height: Math.round(sizeMap[pdfSize] * 0.75), border: '1px solid #eee', borderRadius: 6 }} title={f.name} />
                    ))}
                  </Space>
                ) : (
                  <Tag>暂无PDF文件</Tag>
                )}
                <Space style={{ marginTop: 8 }}>
                  <Segmented value={pdfSize} onChange={setPdfSize} options={['缩略', '标准', '大图']} />
                </Space>
              </div>

              <div>
                <div style={{ fontWeight: 600, marginBottom: 12 }}>附件列表</div>
                {Array.isArray(order.attachments) && order.attachments.length ? (
                  <Space direction="vertical" style={{ width: '100%' }}>
                    {order.attachments.map((f) => (
                      f.url ? (
                        <a key={f.uid} href={f.url} target="_blank" rel="noreferrer">{f.name}</a>
                      ) : (
                        <Tag key={f.uid}>{f.name}</Tag>
                      )
                    ))}
                  </Space>
                ) : (
                  <Tag>暂无附件</Tag>
                )}
              </div>
            </Card>
          </>
        )}
        {!order && !loading ? (
          <div style={{ padding: 12 }}>
            <Tag>未找到订单</Tag>
          </div>
        ) : null}
      </Card>
    </Spin>
  )
}

export default OrderDetail
