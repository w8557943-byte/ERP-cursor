import React, { useEffect, useMemo, useState } from 'react'
import { Card, Descriptions, Tag, Progress, Image as AntImage, Spin, App, Space, Button, Timeline, Table, Modal, Input } from 'antd'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import dayjs from 'dayjs'
import { orderAPI } from '../services/api'
import { cachedCustomerSkuAPI } from '../services/cachedAPI'

function ProductionDetail() {
  const { message } = App.useApp()
  const { id } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [order, setOrder] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [processList, setProcessList] = useState([])
  const [shipModalOpen, setShipModalOpen] = useState(false)
  const [shipQty, setShipQty] = useState('')
  const [forceShip, setForceShip] = useState(false)
  const location = useLocation()
  const qs = new URLSearchParams(location.search)
  const orderNoParam = qs.get('orderNo') || ''
  const seedOrderFromNav = useMemo(() => {
    const s = location && location.state && location.state.seedOrder
    return (s && typeof s === 'object') ? s : null
  }, [location])
  const unwrapOrderDetailResponse = (res) => {
    const body = res?.data ?? res
    if (!body) return null
    if (body && typeof body === 'object') {
      if (body.success === false) return null
      if (body.order && typeof body.order === 'object') return body.order
      const data = body.data
      if (data && typeof data === 'object') {
        if (data.order && typeof data.order === 'object') return data.order
        if (data.parent && typeof data.parent === 'object') return data.parent
        if (data.data && typeof data.data === 'object') return data.data
      }
      if (data && typeof data === 'object') return data
      if (data) return data
    }
    return body
  }

  const statusMap = {
    ordered: { text: '已下单', color: 'purple' },
    pending: { text: '待生产', color: 'orange' },
    processing: { text: '生产中', color: 'blue' },
    stocked: { text: '已入库', color: 'geekblue' },
    shipping: { text: '已发货', color: 'gold' },
    completed: { text: '已完成', color: 'green' }
  }

  const formatCrease = (o) => {
    const c1 = Number(o?.creasingSize1 || 0)
    const c2 = Number(o?.creasingSize2 || 0)
    const c3 = Number(o?.creasingSize3 || 0)
    const type = String(o?.creasingType || '').trim()
    const pressLine = String(o?.pressLine || o?.press_line || '').trim()
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

  const normalize = (o) => {
    const normalizeText = (v) => String(v ?? '').trim()
    const normalizeKey = (v) => normalizeText(v).toLowerCase()
    const keyOf = (x) => normalizeKey(String(x || ''))
    const pickVal = (v) => (v === undefined || v === null || v === '') ? undefined : v
    const parseCreaseText = (v) => {
      const s = normalizeText(v)
      if (!s) return null
      const nums = (s.match(/-?\d+(\.\d+)?/g) || []).map((n) => Number(n)).filter((n) => Number.isFinite(n))
      if (nums.length < 2) return null
      const typeMatch = s.match(/[（(]([^（）()]+)[）)]/)
      const type = normalizeText(typeMatch ? typeMatch[1] : '')
      return { c1: nums[0] || 0, c2: nums[1] || 0, c3: nums[2] || 0, type }
    }

    const items = Array.isArray(o?.items) ? o.items : (Array.isArray(o?.data?.items) ? o.data.items : [])
    const first = items[0] || {}
    const firstData = first?.data && typeof first.data === 'object' ? first.data : null
    const sku = (o && typeof o === 'object' && o.__sku && typeof o.__sku === 'object') ? o.__sku : {}
    const qty = (
      o.quantity ?? o.totalQty ?? o.orderQty ?? o.orderQuantity ?? o.qty ??
      first.quantity ?? first.orderQty ?? first.orderQuantity ?? first.qty ??
      items.reduce((s, it) => s + (Number(it?.quantity ?? it?.orderQty ?? it?.orderQuantity ?? it?.qty) || 0), 0)
    )
    const sheetCountRaw = (
      o.sheetCount ?? o.orderedSheetCount ?? o.orderSheetCount ??
      first.sheetCount ?? first.orderedSheetCount ?? first.orderSheetCount
    )
    const sheetCountNum = Number(sheetCountRaw)
    const produced = Number(o.producedQty || 0)
    const percent = Math.round(Math.min(100, (produced / Math.max(1, Number(qty))) * 100))
    const s = String(o.status || '').toLowerCase()
    let status = 'ordered'
    if (['ordered'].includes(s)) status = 'ordered'
    else if (['pending','waiting'].includes(s)) status = 'pending'
    else if (['processing','in_progress','producing'].includes(s)) status = 'processing'
    else if (['stocked','warehoused'].includes(s)) status = 'stocked'
    else if (['shipped','shipping','delivered'].includes(s)) status = 'shipping'
    else if (['completed','done'].includes(s)) status = 'completed'
    const attachments = Array.isArray(o.attachments) ? o.attachments : []

    const data = o?.data && typeof o.data === 'object' ? o.data : null
    const meta = o?.meta && typeof o.meta === 'object' ? o.meta : null
    const brief = meta?.brief && typeof meta.brief === 'object' ? meta.brief : null
    const product = o?.product && typeof o.product === 'object' ? o.product : null
    const materialCode = normalizeText(
      o.materialCode ?? o.material_code ??
      data?.materialCode ?? data?.material_code ??
      meta?.materialCode ?? meta?.material_code ??
      brief?.materialCode ?? brief?.material_code ??
      product?.materialCode ?? product?.material_code ??
      first.materialCode ?? first.material_code ??
      sku.materialCode ?? sku.material_code
    )
    const materialNo = normalizeText(
      o.materialNo ?? o.material_no ??
      data?.materialNo ?? data?.material_no ??
      meta?.materialNo ?? meta?.material_no ??
      brief?.materialNo ?? brief?.material_no ??
      product?.materialNo ?? product?.material_no ??
      first.materialNo ?? first.material_no ??
      sku.materialNo ?? sku.material_no
    )

    const creasingType = normalizeText(o.creasingType ?? o.creaseType ?? o.creasing_type ?? o.crease_type ?? data?.creasingType ?? data?.creaseType ?? meta?.creasingType ?? meta?.creaseType ?? brief?.creasingType ?? brief?.creaseType ?? product?.creasingType ?? product?.creaseType ?? first.creasingType ?? first.creaseType ?? first.creasing_type ?? first.crease_type ?? sku.creasingType ?? sku.creaseType ?? sku.creasing_type ?? sku.crease_type)
    const creasingSize1 = pickVal(
      o.creasingSize1 ?? o.creaseSize1 ?? o.creasing_size1 ?? o.crease_size1 ?? o.creasingSize_1 ?? o.creaseSize_1 ?? o.creasing_size_1 ?? o.crease_size_1 ??
      first.creasingSize1 ?? first.creaseSize1 ?? first.creasing_size1 ?? first.crease_size1 ?? first.creasingSize_1 ?? first.creaseSize_1 ?? first.creasing_size_1 ?? first.crease_size_1 ??
      sku.creasingSize1 ?? sku.creaseSize1 ?? sku.creasing_size1 ?? sku.crease_size1 ?? sku.creasingSize_1 ?? sku.creaseSize_1 ?? sku.creasing_size_1 ?? sku.crease_size_1
    )
    const creasingSize2 = pickVal(
      o.creasingSize2 ?? o.creaseSize2 ?? o.creasing_size2 ?? o.crease_size2 ?? o.creasingSize_2 ?? o.creaseSize_2 ?? o.creasing_size_2 ?? o.crease_size_2 ??
      first.creasingSize2 ?? first.creaseSize2 ?? first.creasing_size2 ?? first.crease_size2 ?? first.creasingSize_2 ?? first.creaseSize_2 ?? first.creasing_size_2 ?? first.crease_size_2 ??
      sku.creasingSize2 ?? sku.creaseSize2 ?? sku.creasing_size2 ?? sku.crease_size2 ?? sku.creasingSize_2 ?? sku.creaseSize_2 ?? sku.creasing_size_2 ?? sku.crease_size_2
    )
    const creasingSize3 = pickVal(
      o.creasingSize3 ?? o.creaseSize3 ?? o.creasing_size3 ?? o.crease_size3 ?? o.creasingSize_3 ?? o.creaseSize_3 ?? o.creasing_size_3 ?? o.crease_size_3 ??
      first.creasingSize3 ?? first.creaseSize3 ?? first.creasing_size3 ?? first.crease_size3 ?? first.creasingSize_3 ?? first.creaseSize_3 ?? first.creasing_size_3 ?? first.crease_size_3 ??
      sku.creasingSize3 ?? sku.creaseSize3 ?? sku.creasing_size3 ?? sku.crease_size3 ?? sku.creasingSize_3 ?? sku.creaseSize_3 ?? sku.creasing_size_3 ?? sku.crease_size_3
    )
    const hasNums = Boolean(Number(creasingSize1 || 0) || Number(creasingSize2 || 0) || Number(creasingSize3 || 0))
    const fromText = parseCreaseText(
      o?.pressLine ?? o?.press_line ??
      o?.creasingSize ?? o?.creaseSize ?? o?.pressLineSize ?? o?.press_line_size ??
      data?.pressLine ?? data?.press_line ??
      data?.creasingSize ?? data?.creaseSize ?? data?.pressLineSize ?? data?.press_line_size ??
      meta?.pressLine ?? meta?.press_line ??
      meta?.creasingSize ?? meta?.creaseSize ?? meta?.pressLineSize ?? meta?.press_line_size ??
      brief?.pressLine ?? brief?.press_line ??
      brief?.creasingSize ?? brief?.creaseSize ?? brief?.pressLineSize ?? brief?.press_line_size ??
      product?.pressLine ?? product?.press_line ??
      product?.creasingSize ?? product?.creaseSize ?? product?.pressLineSize ?? product?.press_line_size ??
      first?.pressLine ?? first?.press_line ??
      first?.creasingSize ?? first?.creaseSize ?? first?.pressLineSize ?? first?.press_line_size ??
      sku?.pressLine ?? sku?.press_line ??
      sku?.creasingSize ?? sku?.creaseSize ?? sku?.pressLineSize ?? sku?.press_line_size
    )
    const finalCreasingType = creasingType || normalizeText(fromText?.type) || undefined
    const finalS1 = hasNums ? creasingSize1 : (fromText ? fromText.c1 : creasingSize1)
    const finalS2 = hasNums ? creasingSize2 : (fromText ? fromText.c2 : creasingSize2)
    const finalS3 = hasNums ? creasingSize3 : (fromText ? fromText.c3 : creasingSize3)

    const spec = normalizeText(
      first?.specification ?? first?.productSpec ?? first?.product_spec ?? first?.spec ??
      firstData?.specification ?? firstData?.productSpec ?? firstData?.product_spec ?? firstData?.spec ??
      o.specification ?? o.productSpec ?? o.product_spec ?? o.spec ??
      data?.specification ?? data?.productSpec ?? data?.product_spec ?? data?.spec ??
      meta?.specification ?? meta?.productSpec ?? meta?.product_spec ?? meta?.spec ??
      brief?.specification ?? brief?.productSpec ?? brief?.product_spec ?? brief?.spec ??
      product?.specification ?? product?.productSpec ?? product?.product_spec ?? product?.spec ??
      sku?.specification ?? sku?.spec ??
      ''
    )

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
      return 0
    }

    const boardWidth = pickDim(o.boardWidth, data?.boardWidth, meta?.boardWidth, brief?.boardWidth, product?.boardWidth, first?.boardWidth, o.specWidth, data?.specWidth, product?.specWidth, first?.specWidth, sku?.boardWidth, sku?.board_width, sku?.width, sku?.specWidth)
    const boardHeight = pickDim(o.boardHeight, data?.boardHeight, meta?.boardHeight, brief?.boardHeight, product?.boardHeight, first?.boardHeight, o.specLength, data?.specLength, product?.specLength, first?.specLength, sku?.boardHeight, sku?.board_height, sku?.height, sku?.specLength, sku?.length)

    const normalizeSizeToken = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '').replace(/[x*]/g, '×').replace(/mm$/i, '')
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
    const sizeFromSpec = parseSizeFromSpec(spec) || parseSizeFromSpec(sku?.specification ?? sku?.spec)
    const finalBoardWidth = boardWidth || sizeFromSpec?.w
    const finalBoardHeight = boardHeight || sizeFromSpec?.h

    let boardSizeText = (Number.isFinite(finalBoardWidth) && Number.isFinite(finalBoardHeight) && finalBoardWidth > 0 && finalBoardHeight > 0)
      ? `${finalBoardWidth}×${finalBoardHeight}mm`
      : ''

    if (boardSizeText && finalCreasingType) {
      boardSizeText += ` (${finalCreasingType})`
    }

    return {
      id: o._id || o.id || id,
      orderNo: o.orderNo || o.orderNumber || '',
      qrCodeUrl: o.qrCodeUrl || '',
      customerName: normalizeText(
        o.customerName ?? o.customer?.name ?? o.customer?.companyName ?? o.customer ??
        data?.customerName ?? data?.customer?.name ?? data?.customer ??
        meta?.customerName ?? meta?.customer?.name ?? meta?.customer ??
        brief?.customerName ?? brief?.customer?.name ?? brief?.customer ??
        '-'
      ) || '-',
      goodsName: normalizeText(
        o.goodsName ?? o.goods_name ?? o.productTitle ?? o.product_title ?? o.title ??
        data?.goodsName ?? data?.goods_name ?? data?.productTitle ?? data?.product_title ?? data?.title ??
        meta?.goodsName ?? meta?.goods_name ?? meta?.productTitle ?? meta?.product_title ?? meta?.title ??
        brief?.goodsName ?? brief?.goods_name ?? brief?.productTitle ?? brief?.product_title ?? brief?.title ??
        product?.goodsName ?? product?.goods_name ?? product?.title ?? product?.name ??
        first.goodsName ?? first.title ?? first.productName ??
        firstData?.goodsName ?? firstData?.title ?? firstData?.productName ??
        sku?.goodsName ?? sku?.productName ?? sku?.name ??
        '-'
      ) || '-',
      productName: normalizeText(
        o.productName ?? o.productTitle ?? o.product_title ?? o.product?.name ?? o.product?.title ??
        data?.productName ?? data?.productTitle ?? data?.product?.name ?? data?.product?.title ??
        first.productName ?? first.title ??
        sku?.name ?? sku?.productName ?? sku?.goodsName ??
        ''
      ) || '-',
      spec: spec || '-',
      materialNo: materialNo || '-',
      materialCode: materialCode || '-',
      flute: normalizeText(
        o.flute ?? o.fluteType ?? o.flute_type ??
        data?.flute ?? data?.fluteType ?? data?.flute_type ??
        meta?.flute ?? meta?.fluteType ?? meta?.flute_type ??
        brief?.flute ?? brief?.fluteType ?? brief?.flute_type ??
        product?.flute ?? product?.fluteType ?? product?.flute_type ??
        first.flute ?? first.fluteType ?? first.flute_type ??
        sku.flute ?? sku.fluteType ?? sku.flute_type
      ) || '-',
      boardWidth: finalBoardWidth,
      boardHeight: finalBoardHeight,
      boardSizeText,
      creasingType: finalCreasingType,
      creasingSize1: finalS1,
      creasingSize2: finalS2,
      creasingSize3: finalS3,
      quantity: qty || 0,
      sheetCount: (Number.isFinite(sheetCountNum) && sheetCountNum > 0) ? sheetCountNum : undefined,
      producedQty: produced || 0,
      stockedQty: Number(o.stockedQty || 0),
      status,
      startedAt: (() => {
        const start = o.printStartAt || o.startedAt || o.startTime
        return (status === 'pending' || status === 'ordered') ? undefined : start
      })(),
      shippedAt: o.shippedAt || o.deliveredAt,
      shippedQty: Number(o.shippedQty || o.deliveredQty || 0),
      percent,
      attachments
    }
  }

  const remainQty = useMemo(() => {
    if (!order) return 0
    return Math.max(0, Number(order.stockedQty || 0) - Number(order.shippedQty || 0))
  }, [order])

  const getQrUrl = (o) => {
    if (o && o.qrCodeUrl) return o.qrCodeUrl
    return ''
  }

  const makeProcessKey = (p) => {
    const row = p && typeof p === 'object' ? p : {}
    return [
      row.name,
      row.status,
      row.operator,
      row.startTime,
      row.endTime,
      row.producedQty
    ].map((v) => String(v ?? '').trim()).join('|')
  }

  const load = async () => {
    setLoading(true)
    setLoadError('')
    try {
      let data = null
      const rawToken = String(orderNoParam || id || '').trim()
      const token = rawToken.includes(':') ? rawToken.split(':')[0].trim() : rawToken
      const isChildNo = /-\d+$/.test(token)
      let seedData = seedOrderFromNav && typeof seedOrderFromNav === 'object' ? seedOrderFromNav : null
      if (token) {
        try {
          const resp = await orderAPI.getOrderAny(token)
          data = unwrapOrderDetailResponse(resp)
        } catch (_) { void 0 }
      }
      if (data && isChildNo) {
        const seenNo = String(data?.orderNo || data?.orderNumber || '').trim()
        if (seenNo && seenNo !== token) {
          seedData = seedData ? { ...data, ...seedData } : data
          data = null
        }
      }
      if (!data && isChildNo) {
        const childNo = token
        const m = childNo.match(/^(.*)-(\d+)$/)
        const parentNo = m ? String(m[1] || '').trim() : ''
        const idx = m ? (Number(m[2]) - 1) : -1

        const buildChildFromParent = (parentOrder) => {
          const parent = parentOrder && typeof parentOrder === 'object' ? parentOrder : null
          if (!parent || !parentNo) return null
          const items = Array.isArray(parent.items)
            ? parent.items
            : (Array.isArray(parent?.data?.items) ? parent.data.items : [])
          if (!(Number.isFinite(idx) && idx >= 0 && idx < items.length)) return null
          const it = items[idx] && typeof items[idx] === 'object' ? items[idx] : {}
          const itData = it?.data && typeof it.data === 'object' ? it.data : null
          const pid = parent._id || parent.id || ''
          const qty = it.quantity ?? it.orderQty ?? it.qty ?? it.orderQuantity ?? itData?.quantity ?? itData?.orderQty ?? itData?.qty ?? itData?.orderQuantity ?? parent.quantity
          const unitPrice = it.unitPrice ?? it.listUnitPrice ?? itData?.unitPrice ?? itData?.listUnitPrice ?? parent.unitPrice
          const amount = it.amount ?? (Number(qty || 0) * Number(unitPrice || 0))
          const specification = it.specification ?? it.spec ?? itData?.specification ?? itData?.spec ?? parent.specification ?? parent.spec
          const goodsName = it.goodsName ?? it.title ?? it.productName ?? itData?.goodsName ?? itData?.title ?? itData?.productName ?? parent.goodsName ?? parent.productTitle ?? parent.title
          const materialNo = it.materialNo ?? itData?.materialNo ?? parent.materialNo
          return {
            ...parent,
            ...it,
            ...(itData || {}),
            _id: pid || parent._id,
            id: pid || parent.id,
            orderNo: childNo,
            orderNumber: childNo,
            goodsName,
            materialNo,
            specification,
            spec: specification,
            quantity: qty,
            unitPrice,
            amount,
            items: [it]
          }
        }

        if (parentNo) {
          try {
            const groupRes = await orderAPI.getOrderGroup(parentNo)
            const body = groupRes?.data ?? groupRes
            const payload = body?.data ?? body
            const group = payload?.data ?? payload
            const parentDoc = group?.parent && typeof group.parent === 'object' ? group.parent : null
            const children = Array.isArray(group?.children) ? group.children : []
            const childDoc =
              children.find((c) => String(c?.orderNo || c?.orderNumber || c?.subOrderNo || c?.subOrderNumber || '').trim() === childNo) ||
              (Number.isFinite(idx) && idx >= 0 && idx < children.length ? children[idx] : null) ||
              null
            if (childDoc && typeof childDoc === 'object') {
              const base = parentDoc ? (buildChildFromParent(parentDoc) || parentDoc) : null
              const merged = { ...(base || {}) }
              if (seedData && typeof seedData === 'object') {
                Object.keys(seedData).forEach((k) => {
                  const v = seedData[k]
                  if ((merged[k] === undefined || merged[k] === null || merged[k] === '') && v !== undefined && v !== null && v !== '') {
                    merged[k] = v
                  }
                })
              }
              Object.keys(childDoc).forEach((k) => {
                const v = childDoc[k]
                if (v !== undefined && v !== null && v !== '') merged[k] = v
              })
              merged.orderNo = childNo
              merged.orderNumber = childNo
              const pid = parentDoc?._id || parentDoc?.id || ''
              if (!merged._id && !merged.id && pid) {
                merged._id = pid
                merged.id = pid
              }
              data = merged
            } else if (parentDoc) {
              data = buildChildFromParent(parentDoc)
            }
          } catch (_) { void 0 }
        }

        if (!data && parentNo) {
          try {
            const parentRes = await orderAPI.getOrderAny(parentNo)
            const parentOrder = unwrapOrderDetailResponse(parentRes)
            data = buildChildFromParent(parentOrder) || parentOrder
            if (data && seedData && typeof seedData === 'object') {
              Object.keys(seedData).forEach((k) => {
                const v = seedData[k]
                if ((data[k] === undefined || data[k] === null || data[k] === '') && v !== undefined && v !== null && v !== '') {
                  data[k] = v
                }
              })
            }
          } catch (_) { void 0 }
        }
      }
      if (!data && seedData && typeof seedData === 'object' && Object.keys(seedData).length) {
        data = seedData
      }
      if (!data) {
        setLoadError('未找到订单或生产数据')
        message.error('加载生产详情失败')
        setOrder(null)
        setProcessList([])
        return
      }
      if (token && (!data.orderNo && !data.orderNumber)) {
        data.orderNo = token
        data.orderNumber = token
      }

      const isEmptyValue = (v) => {
        if (v === undefined || v === null) return true
        const s = String(v).trim()
        if (!s) return true
        return ['-', '—', '--', '---', '暂无', '无', 'null', 'undefined'].includes(s.toLowerCase())
      }
      const mergeMissing = (base, extra) => {
        const target = (base && typeof base === 'object') ? { ...base } : {}
        const src = (extra && typeof extra === 'object') ? extra : null
        if (!src) return target
        Object.keys(src).forEach((k) => {
          const sv = src[k]
          if (isEmptyValue(target[k]) && !isEmptyValue(sv)) {
            target[k] = sv
          }
        })
        return target
      }
      if (seedData && typeof seedData === 'object') {
        data = mergeMissing(data, seedData)
      }

      const normalizeText = (v) => String(v ?? '').trim()
      const normalizeKey = (v) => normalizeText(v).toLowerCase()
      const normalizeSpecKey = (v) => normalizeKey(v).replace(/[x*]/g, '×').replace(/mm$/i, '')
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
          const materialNo = normalizeKey(sku?.materialNo)
          const spec = normalizeSpecKey(sku?.specification ?? sku?.spec)
          const name = normalizeKey(sku?.name ?? sku?.goodsName ?? sku?.productName)
          if (materialNo) map.set(`m:${materialNo}`, sku)
          if (materialNo && spec) map.set(`ms:${materialNo}::${spec}`, sku)
          if (name) map.set(`n:${name}`, sku)
          if (name && spec) map.set(`ns:${name}::${spec}`, sku)
        })
        return map
      }

      const nested = data?.data && typeof data.data === 'object' ? data.data : null
      const meta = data?.meta && typeof data.meta === 'object' ? data.meta : null
      const brief = meta?.brief && typeof meta.brief === 'object' ? meta.brief : null
      const product = data?.product && typeof data.product === 'object' ? data.product : null
      const items = Array.isArray(data?.items) ? data.items : (Array.isArray(nested?.items) ? nested.items : [])
      const first = items[0] || {}
      const customerId = normalizeId(
        data?.customerId || data?.customer?._id || data?.customer?.id ||
        nested?.customerId || nested?.customer?._id || nested?.customer?.id ||
        meta?.customerId || meta?.customer?._id || meta?.customer?.id ||
        brief?.customerId || brief?.customer?._id || brief?.customer?.id ||
        product?.customerId || product?.customer?._id || product?.customer?.id ||
        first?.customerId || first?.customer?._id || first?.customer?.id
      )
      const skuId = normalizeId(
        data?.skuId || data?.sku_id || data?.sku?._id || data?.sku?.id || data?.customerSkuId || data?.customer_sku_id ||
        nested?.skuId || nested?.sku_id || nested?.sku?._id || nested?.sku?.id || nested?.customerSkuId || nested?.customer_sku_id ||
        meta?.skuId || meta?.sku_id || meta?.sku?._id || meta?.sku?.id || meta?.customerSkuId || meta?.customer_sku_id ||
        brief?.skuId || brief?.sku_id || brief?.sku?._id || brief?.sku?.id || brief?.customerSkuId || brief?.customer_sku_id ||
        product?.skuId || product?.sku_id || product?.sku?._id || product?.sku?.id || product?.customerSkuId || product?.customer_sku_id ||
        first?.skuId || first?.sku_id || first?.sku?._id || first?.sku?.id || first?.customerSkuId || first?.customer_sku_id
      )
      const rawSpec = normalizeText(
        data?.specification || data?.spec ||
        nested?.specification || nested?.spec ||
        meta?.specification || meta?.spec ||
        brief?.specification || brief?.spec ||
        product?.specification || product?.spec ||
        first?.specification || first?.spec ||
        ''
      )
      const rawMaterialNo = normalizeText(
        data?.materialNo || data?.material_no ||
        nested?.materialNo || nested?.material_no ||
        meta?.materialNo || meta?.material_no ||
        brief?.materialNo || brief?.material_no ||
        product?.materialNo || product?.material_no ||
        first?.materialNo || first?.material_no ||
        ''
      )
      const rawName = normalizeText(
        data?.goodsName || data?.goods_name || data?.productTitle || data?.product_title || data?.productName || data?.title ||
        nested?.goodsName || nested?.goods_name || nested?.productTitle || nested?.product_title || nested?.productName || nested?.title ||
        meta?.goodsName || meta?.goods_name || meta?.productTitle || meta?.product_title || meta?.productName || meta?.title ||
        brief?.goodsName || brief?.goods_name || brief?.productTitle || brief?.product_title || brief?.productName || brief?.title ||
        product?.goodsName || product?.goods_name || product?.title || product?.name ||
        first?.goodsName || first?.goods_name || first?.title || first?.productName ||
        ''
      )
      const sku = await (async () => {
        if (!customerId) return null
        const skus = await loadCustomerSkus(customerId).catch(() => [])
        const idx = buildSkuIndex(skus)
        if (skuId && idx.has(`id:${normalizeKey(skuId)}`)) return idx.get(`id:${normalizeKey(skuId)}`)
        const materialNoKey = normalizeKey(rawMaterialNo)
        const specKey = normalizeSpecKey(rawSpec)
        if (materialNoKey && specKey && idx.has(`ms:${materialNoKey}::${specKey}`)) return idx.get(`ms:${materialNoKey}::${specKey}`)
        if (materialNoKey && idx.has(`m:${materialNoKey}`)) return idx.get(`m:${materialNoKey}`)
        const nameKey = normalizeKey(rawName)
        if (nameKey && specKey && idx.has(`ns:${nameKey}::${specKey}`)) return idx.get(`ns:${nameKey}::${specKey}`)
        if (nameKey && idx.has(`n:${nameKey}`)) return idx.get(`n:${nameKey}`)
        return null
      })()

      const o = normalize({ ...data, __sku: sku || undefined })
      setOrder(o)
      const steps = []
      const statusOf = (ok) => ok ? 'completed' : 'pending'
      const shipped = !!o.shippedAt
      const printingStatus = o.status === 'completed' ? 'completed' : (o.producedQty > 0 ? 'processing' : 'pending')
      const printFinishRaw = data?.printFinishAt || data?.printedAt || data?.completedAt || ''
      const printEnd = printFinishRaw ? dayjs(printFinishRaw).format('YYYY-MM-DD HH:mm') : ''
      const printStartText = o.startedAt ? dayjs(o.startedAt).format('YYYY-MM-DD HH:mm') : ''
      const printStep = { name: '印刷', status: printingStatus, statusText: printingStatus === 'completed' ? '已完成' : printingStatus === 'processing' ? '进行中' : '待开始', startTime: printStartText, endTime: printEnd, producedQty: o.producedQty }
      steps.push({ ...printStep, key: makeProcessKey(printStep) })
      const stockTimeRaw = data?.stockedAt || data?.stockTime || (String(data?.status || '').toLowerCase() === 'stocked' ? (data?.updatedAt || data?.updateTime) : '')
      const stockEnd = stockTimeRaw ? dayjs(stockTimeRaw).format('YYYY-MM-DD HH:mm') : ''
      const stockStep = { name: '入库', status: statusOf(Number(o.stockedQty || 0) > 0), statusText: Number(o.stockedQty || 0) > 0 ? '已完成' : '待开始', startTime: '', endTime: stockEnd }
      steps.push({ ...stockStep, key: makeProcessKey(stockStep) })
      const shipEndText = shipped ? dayjs(o.shippedAt).format('YYYY-MM-DD HH:mm') : ''
      const shipStep = { name: '发货', status: statusOf(shipped), statusText: shipped ? '已完成' : '待开始', startTime: '', endTime: shipEndText }
      steps.push({ ...shipStep, key: makeProcessKey(shipStep) })
      const rawProc = Array.isArray(data?.processList) ? data.processList : (Array.isArray(data?.processes) ? data.processes : [])
      const procFromMini = (rawProc || []).map(p => ({
        name: p.name || p.processName || p.step || '-',
        status: (() => {
          const s = String(p.status || p.state || '').toLowerCase()
          if (['completed','done','finish'].includes(s)) return 'completed'
          if (['processing','in_progress','started'].includes(s)) return 'processing'
          if (['pending','todo','waiting','not_started'].includes(s)) return 'pending'
          return s || 'pending'
        })(),
        statusText: p.statusText || (p.status ? p.status : ''),
        operator: p.operator || p.user || p.staff || '',
        startTime: p.startTime || p.start_at || p.start || '',
        endTime: p.endTime || p.end_at || p.end || '',
        producedQty: Number(p.producedQty || p.qty || 0)
      })).map(x => {
        const startTime = x.startTime ? dayjs(x.startTime).format('YYYY-MM-DD HH:mm') : ''
        const endTime = x.endTime ? dayjs(x.endTime).format('YYYY-MM-DD HH:mm') : ''
        const next = { ...x, startTime, endTime }
        return { ...next, key: makeProcessKey(next) }
      })
      setProcessList((procFromMini && procFromMini.length) ? procFromMini : steps)

      const rawOps = Array.isArray(data?.operationLogs) ? data.operationLogs : (Array.isArray(data?.logs) ? data.logs : [])
      try {
        const pendingLog = (rawOps || []).find(it => {
          const c = String(it && (it.content || it.text) || '')
          return /待生产|设为待生产|置为待生产|pending|waiting|planned/i.test(c)
        })
        const pendingRaw = data?.pendingAt || data?.waitingAt || (pendingLog ? (pendingLog.time || pendingLog.at || pendingLog.date || '') : '')
        if (pendingRaw) {
          setOrder(prev => ({ ...(prev || o), pendingAtTime: pendingRaw }))
        }
      } catch (_) { void 0 }
    } catch (_) {
      setLoadError('加载过程中发生异常')
      message.error('加载生产详情失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!seedOrderFromNav || order) return
    const token = String(orderNoParam || seedOrderFromNav?.orderNo || seedOrderFromNav?.orderNumber || id || '').trim()
    const seeded = { ...seedOrderFromNav }
    if (token && (!seeded.orderNo && !seeded.orderNumber)) {
      seeded.orderNo = token
      seeded.orderNumber = token
    }
    try {
      setOrder(normalize(seeded))
    } catch (_) { void 0 }
  }, [seedOrderFromNav, order, orderNoParam, id])

  useEffect(() => { load() }, [id, orderNoParam])

  const handleOpenShipModal = () => {
    if (!order) return
    if (remainQty <= 0) {
      Modal.confirm({
        title: '无可用库存',
        content: '当前库存为0，仍要继续发货吗？',
        okText: '继续发货',
        cancelText: '取消',
        onOk: () => {
          setForceShip(true)
          setShipQty('')
          setShipModalOpen(true)
        }
      })
      return
    }
    setForceShip(false)
    setShipQty('')
    setShipModalOpen(true)
  }

  const handleConfirmShip = async () => {
    if (!order || !order.id) {
      message.error('无法获取订单ID，暂时不能发货')
      return
    }
    const val = Number(shipQty)
    if (!Number.isFinite(val) || val <= 0) {
      message.error('请输入大于0的发货数量')
      return
    }
    if (!forceShip && val > remainQty) {
      message.error(`发货数量不能大于库存数量（${remainQty}）`)
      return
    }
    try {
      const nowIso = new Date().toISOString()
      const prevShipments = Array.isArray(order.shipments) ? order.shipments : []
      const prevShipped = (() => {
        if (prevShipments.length) {
          const sum = prevShipments.reduce((s, it) => {
            const v = Number(it?.qty ?? it?.quantity ?? it?.shipQty ?? 0)
            if (!Number.isFinite(v) || v <= 0) return s
            return s + v
          }, 0)
          if (sum > 0) return sum
        }
        const n = Number(order.shippedQty || 0)
        return Number.isFinite(n) && n > 0 ? n : 0
      })()
      const totalShipped = prevShipped + val
      const totalStocked = Number(order.stockedQty || order.quantity || 0)
      const remain = Math.max(0, totalStocked - totalShipped)
      const status = remain > 0 ? 'shipping' : 'shipped'
      const shipments = prevShipments.concat([{ qty: val, time: nowIso }])
      const payload = {
        shippedQty: totalShipped,
        shippedAt: nowIso,
        status,
        shipments
      }
      await orderAPI.updateOrder(order.id, payload)
      message.success('发货已记录')
      setShipModalOpen(false)
      setShipQty('')
      setForceShip(false)
      load()
    } catch (e) {
      message.error('发货记录失败')
    }
  }

  const handlePrintWorkOrder = () => {
    if (!order) return
    navigate('/production/workorder-print', { state: { printRows: [order] } })
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 className="page-title">生产详情</h2>
        <Space>
          <Button onClick={handlePrintWorkOrder} disabled={!order}>打印施工单</Button>
          <Button type="primary" onClick={handleOpenShipModal} disabled={!order}>发货</Button>
          <Button onClick={() => navigate('/production')}>返回</Button>
        </Space>
      </div>
      <Spin spinning={loading}>
        {!order && loadError ? (
          <Card style={{ marginBottom: 16 }}>
            <div style={{ color: '#b91c1c' }}>{loadError}</div>
          </Card>
        ) : null}
        {order && (
          <div>
            <Space style={{ marginBottom: 12 }}>
              <span style={{ fontSize: 16, color: '#374151' }}>订单状态：</span>
              <Tag color={statusMap[order.status]?.color} style={{ fontSize: 18, fontWeight: 600, padding: '4px 12px' }}>{statusMap[order.status]?.text}</Tag>
            </Space>
            <Card title="订单信息" style={{ marginBottom: 16 }}>
              <div style={{ display: 'flex', alignItems: 'stretch', gap: 16 }}>
                <div style={{ flex: 1 }}>
                  <Descriptions column={3} bordered size="small">
                    <Descriptions.Item label="订单编号">{order.orderNo}</Descriptions.Item>
                    <Descriptions.Item label="客户名称">{order.customerName}</Descriptions.Item>
                    <Descriptions.Item label="产品名称">{order.productName}</Descriptions.Item>
                    <Descriptions.Item label="商品名称">{order.goodsName}</Descriptions.Item>
                    <Descriptions.Item label="物料号">{order.materialNo}</Descriptions.Item>
                    <Descriptions.Item label="规格尺寸">{order.spec}</Descriptions.Item>
                    <Descriptions.Item label="纸板尺寸">{order.boardSizeText || '-'}</Descriptions.Item>
                    <Descriptions.Item label="压线尺寸">{formatCrease(order)}</Descriptions.Item>
                    <Descriptions.Item label="数量">
                      {(() => {
                        const qty = Number(order.quantity || 0)
                        const sheetCount = Number(order.sheetCount)
                        const sheetCountDisplay = (Number.isFinite(sheetCount) && sheetCount > 0) ? sheetCount : qty
                        const perNum = qty > 0 ? sheetCountDisplay / qty : NaN
                        const per = (Number.isFinite(perNum) && perNum > 0) ? Math.round(perNum) : undefined
                        return (
                          <div>
                            <div>{qty}</div>
                            <div style={{ color: '#6b7280' }}>成型片数：{per ?? '-'}</div>
                            <div style={{ color: '#6b7280' }}>下单片数：{sheetCountDisplay}</div>
                          </div>
                        )
                      })()}
                    </Descriptions.Item>
                    <Descriptions.Item label="材质编码">{order.materialCode || '-'}</Descriptions.Item>
                    <Descriptions.Item label="楞别">{order.flute || '-'}</Descriptions.Item>

                  </Descriptions>
                  <div style={{ marginTop: 12 }}>
                    <div style={{ marginBottom: 8 }}>{order.producedQty}/{order.quantity}</div>
                    <Progress percent={order.percent} status={order.status === 'completed' ? 'success' : 'active'} />
                  </div>
                </div>
                {(() => {
                  const qrUrl = getQrUrl(order)
                  if (!qrUrl) return null
                  return (
                    <div style={{ width: 170, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', borderLeft: '1px solid #f0f0f0', paddingLeft: 16 }}>
                      <div style={{ marginBottom: 8, fontWeight: 600 }}>订单二维码</div>
                      <img src={qrUrl} alt="订单二维码" style={{ width: 120, height: 120 }} />
                    </div>
                  )
                })()}
              </div>
            </Card>

            <Card title="工序详情" style={{ marginBottom: 16 }}>
              {processList && processList.length ? (
                <Table
                  rowKey={(r) => r.key}
                  size="small"
                  pagination={false}
                  columns={[
                    { title: '工序', dataIndex: 'name', key: 'name', width: 160 },
                    { title: '状态', dataIndex: 'status', key: 'status', width: 120, render: (s, r) => (
                      <Tag color={s === 'completed' ? 'green' : s === 'processing' ? 'blue' : 'orange'}>{r.statusText || (s === 'completed' ? '已完成' : s === 'processing' ? '进行中' : '待开始')}</Tag>
                    ) },
                    { title: '操作人', dataIndex: 'operator', key: 'operator', width: 140 },
                    { title: '开始时间', dataIndex: 'startTime', key: 'startTime', width: 180 },
                    { title: '结束时间', dataIndex: 'endTime', key: 'endTime', width: 180 },
                    { title: '操作记录', key: 'operation', width: 240, render: (_, p) => {
                      const name = String(p.name || '').toLowerCase()
                      const isPrint = /印刷/.test(p.name || '') || name.includes('print')
                      const isStock = /入库/.test(p.name || '') || name.includes('stock') || name.includes('warehouse')
                      const isShip = /发货/.test(p.name || '') || name.includes('ship') || name.includes('deliver')
                      const printQty = Number(p.producedQty || p.qty || (order ? order.producedQty : 0) || 0)
                      const stockQty = Number(p.qty || (order ? order.stockedQty : 0) || 0)
                      const shipQty = Number(p.qty || (order ? (order.shippedQty || 0) : 0) || 0)
                      const remain = Math.max(0, Number(order?.stockedQty || 0) - Number(order?.shippedQty || 0))
                      let line = ''
                      if (isPrint && printQty > 0) line = `印刷完成数量：${printQty}`
                      else if (isStock && stockQty > 0) line = `入库数量：${stockQty}`
                      else if (isShip && shipQty > 0) line = `出货数量：${shipQty}`
                      return (
                        <div>
                          <div>{line || '-'}</div>
                          {isShip && remain > 0 ? <div style={{ color: '#6b7280' }}>库存：{remain}</div> : null}
                        </div>
                      )
                    } },
                  ]}
                  dataSource={processList}
                />
              ) : (
                <div style={{ color: '#6b7280' }}>暂无工序详情</div>
              )}
            </Card>

            

            <Card title="附件图纸" style={{ marginBottom: 16 }}>
              {Array.isArray(order.attachments) && order.attachments.length > 0 ? (
                <Space wrap>
                  {order.attachments.map((a, i) => (
                    <AntImage key={i} width={160} src={a.url || a} alt={a.name || `附件${i+1}`} />
                  ))}
                </Space>
              ) : (
                <div style={{ color: '#6b7280' }}>暂无附件图纸</div>
              )}
            </Card>

            
          </div>
        )}
        {!order && !loading ? (
          <Card>
            <Space direction="vertical">
              <Tag color="orange">{loadError || '暂无数据'}</Tag>
              <div>订单号/ID：{String(orderNoParam || id || '-')}</div>
              <Space>
                <Button onClick={() => load()}>重新加载</Button>
                <Button onClick={() => navigate('/production')}>返回列表</Button>
              </Space>
            </Space>
          </Card>
        ) : null}
      </Spin>
      <Modal
        title="发货"
        open={shipModalOpen}
        onOk={handleConfirmShip}
        onCancel={() => { setShipModalOpen(false); setShipQty(''); setForceShip(false) }}
        destroyOnHidden
      >
        {order && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div>订单编号：{order.orderNo}</div>
            <div>客户名称：{order.customerName}</div>
            <div>商品名称：{order.goodsName}</div>
            <div>物料号：{order.materialNo || '-'}</div>
            <div>规格尺寸：{order.spec}</div>
            <div>当前库存数量：{remainQty}</div>
            <div style={{ marginTop: 8 }}>
              <div style={{ marginBottom: 4 }}>发货数量</div>
              <Input
                type="number"
                value={shipQty}
                onChange={e => setShipQty(e.target.value)}
                placeholder={forceShip ? '强制发货（不校验库存）' : (remainQty > 0 ? `最多可发 ${remainQty}` : '暂无可发库存')}
                min={0}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

export default ProductionDetail
