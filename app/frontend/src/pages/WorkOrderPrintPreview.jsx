import React, { useRef, useState, useEffect } from 'react'
import { Card, Button, Space, message, Select, InputNumber, Popover } from 'antd'
import { useNavigate, useLocation } from 'react-router-dom'
import QRCode from 'qrcode'
import { useLocalStorage } from '../hooks/useLocalStorage'
import { cachedCustomerSkuAPI } from '../services/cachedAPI'
import { orderAPI } from '../services/api'

const QR_OPTIONS = { width: 420, margin: 1 }

const WorkOrderPrintPreview = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const [rows, setRows] = useState([])
  const [paperSize, setPaperSize] = useLocalStorage('workorder_print_paper_size', '80x180') // 80x140 or 80x180
  const [printPaperMode, setPrintPaperMode] = useLocalStorage('workorder_print_paper_mode', 'a4') // ticket | a4
  const [printTopOffsetMm, setPrintTopOffsetMm] = useLocalStorage('workorder_print_top_offset_mm', 0)
  const [printLeftOffsetMm, setPrintLeftOffsetMm] = useLocalStorage('workorder_print_left_offset_mm', 0)
  const [printScale, setPrintScale] = useLocalStorage('workorder_print_scale', 1)
  const [fontScale, setFontScale] = useLocalStorage('workorder_print_font_scale', 1)
  const [pagePaddingXmm, setPagePaddingXmm] = useLocalStorage('workorder_print_padding_x_mm', 4)
  const [pagePaddingYmm, setPagePaddingYmm] = useLocalStorage('workorder_print_padding_y_mm', 2)
  const [tableHeaderWidthMm, setTableHeaderWidthMm] = useLocalStorage('workorder_print_th_width_mm', 24)
  const [qrMap, setQrMap] = useState({})
  const [skuIndexByCustomerId, setSkuIndexByCustomerId] = useState(new Map())
  const [refreshing, setRefreshing] = useState(false)
  const inflightSkuRef = useRef(new Set())
  const inflightOrderRef = useRef(new Set())
  const pagesRef = useRef(null)

  useEffect(() => {
    if (location.state?.rows) {
      setRows(location.state.rows)
    } else if (location.state?.printRows) {
      setRows(location.state.printRows)
    } else {
      // Fallback or empty
    }
  }, [location.state])

  // Helper to safely pick text from various possible fields
  const pickText = (...args) => {
    for (const a of args) {
      if (a === undefined || a === null) continue
      const s = String(a).trim()
      if (!s) continue
      if (['-', '—', '--', '---', '暂无', '无', 'null', 'undefined'].includes(s.toLowerCase())) continue
      return s
    }
    return ''
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

  const normalizeText = (s) => (s ? String(s).trim() : '')
  const normalizeKey = (s) => normalizeText(s).toLowerCase().replace(/[^a-z0-9]/g, '')
  const normalizeKeyLoose = (s) => normalizeText(s).toLowerCase().replace(/\s+/g, '')
  const normalizeSpecKey = (s) => normalizeKeyLoose(s).replace(/[x*]/g, '×').replace(/mm$/i, '')

  const normalizeId = (v) => {
    const s = normalizeText(v)
    if (!s) return ''
    const parts = s.split(/[\\/]/).filter(Boolean)
    return parts.length ? parts[parts.length - 1] : s
  }

  const toNum = (v) => {
    if (v === undefined || v === null) return 0
    const n = Number(v)
    if (Number.isFinite(n)) return n
    const m = String(v).match(/-?\d+(\.\d+)?/)
    return m ? Number(m[0]) : 0
  }

  const normalizeSizeToken = (v) =>
    String(v ?? '')
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[x*]/g, '×')
      .replace(/mm$/i, '')

  const parseDimsFromToken = (token) => {
    const t = normalizeSizeToken(token)
    if (!t) return null
    const m3 = t.match(/^(\d+(\.\d+)?)×(\d+(\.\d+)?)×(\d+(\.\d+)?)$/)
    if (m3) {
      const a = Number(m3[1])
      const b = Number(m3[3])
      const c = Number(m3[5])
      if ([a, b, c].every((x) => Number.isFinite(x) && x > 0)) return [a, b, c]
      return null
    }
    const m2 = t.match(/^(\d+(\.\d+)?)×(\d+(\.\d+)?)$/)
    if (m2) {
      const a = Number(m2[1])
      const b = Number(m2[3])
      if ([a, b].every((x) => Number.isFinite(x) && x > 0)) return [a, b]
      return null
    }
    return null
  }

  const getOrderNo = (r) => {
    const data = r?.data || {}
    const meta = (r?.meta && typeof r.meta === 'object') ? r.meta : ((data?.meta && typeof data.meta === 'object') ? data.meta : {})
    const brief = (meta?.brief && typeof meta.brief === 'object') ? meta.brief : (r?.brief || data?.brief || {})
    return pickText(
      r?.orderNo, r?.orderNumber, r?.order_no,
      data?.orderNo, data?.orderNumber, data?.order_no,
      meta?.orderNo, meta?.orderNumber, meta?.order_no,
      brief?.orderNo, brief?.orderNumber, brief?.order_no
    )
  }

  const parseItemIndexFromOrderNo = (orderNo) => {
    const s = String(orderNo || '').trim()
    if (!s) return undefined
    const m = s.match(/-(\d+)$/)
    if (!m) return undefined
    const idx = Number(m[1]) - 1
    return Number.isFinite(idx) && idx >= 0 ? idx : undefined
  }

  const getRowItemIndex = (r) => {
    const n = Number(r?.__itemIndex)
    if (Number.isFinite(n) && n >= 0) return n
    return parseItemIndexFromOrderNo(pickText(r?.orderNo, r?.orderNumber, r?.order_no, getOrderNo(r)))
  }

  const getRowQrOrderId = (r) => normalizeId(
    r?.__parentOrderId ??
    r?._id ??
    r?.id ??
    r?.key ??
    r?.data?._id ??
    r?.data?.id ??
    r?.data?.key
  )

  const buildOrderQrPayload = ({ orderId, orderNo }) => {
    return JSON.stringify({ v: 1, orderId: String(orderId || '').trim(), orderNo: String(orderNo || '').trim() })
  }

  const getCustomerId = (r) => {
    const data = r?.data || {}
    const meta = r?.meta || {}
    const brief = r?.brief || data?.brief || meta?.brief || {}
    const product = r?.product || {}
    const items = Array.isArray(r?.items) ? r.items : Array.isArray(data?.items) ? data.items : []
    const idx = getRowItemIndex(r)
    const item = (idx !== undefined && items[idx]) ? items[idx] : (items[0] || {})
    const itemData = item?.data || {}
    return normalizeId(
      r?.customerId ??
      r?.customer_id ??
      r?.customer?._id ??
      r?.customer?.id ??
      data?.customerId ??
      data?.customer_id ??
      data?.customer?._id ??
      data?.customer?.id ??
      meta?.customerId ??
      meta?.customer_id ??
      meta?.customer?._id ??
      meta?.customer?.id ??
      brief?.customerId ??
      brief?.customer_id ??
      brief?.customer?._id ??
      brief?.customer?.id ??
      product?.customerId ??
      product?.customer_id ??
      product?.customer?._id ??
      product?.customer?.id ??
      item?.customerId ??
      item?.customer_id ??
      item?.customer?._id ??
      item?.customer?.id ??
      itemData?.customerId ??
      itemData?.customer_id ??
      itemData?.customer?._id ??
      itemData?.customer?.id
    )
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

  const buildSkuIndex = (skus) => {
    const idx = new Map()
    const add = (k, v) => {
      if (!k || idx.has(k)) return
      idx.set(k, v)
    }
    ;(Array.isArray(skus) ? skus : []).forEach((raw) => {
      const s = raw && typeof raw === 'object' ? raw : {}
      const sid = normalizeId(s?.id ?? s?._id)
      const idKey = normalizeKeyLoose(sid)
      if (idKey) add(`id:${idKey}`, s)

      const materialNo = normalizeText(s?.materialNo ?? s?.material_no)
      const materialNoKey = normalizeKeyLoose(materialNo)
      const materialCode = normalizeText(s?.materialCode ?? s?.material_code ?? s?.code)
      const materialCodeKey = normalizeKeyLoose(materialCode)
      const skuNo = normalizeText(s?.skuNo ?? s?.sku_no ?? s?.skuCode ?? s?.sku_code ?? '')
      const skuNoKey = normalizeKeyLoose(skuNo)
      const spec = normalizeText(s?.specification ?? s?.spec ?? '')
      const specKey = normalizeSpecKey(spec)
      const name = normalizeText(
        s?.goodsName ?? s?.goods_name ?? s?.productTitle ?? s?.product_title ?? s?.title ??
        s?.productName ?? s?.product_name ?? s?.name ?? ''
      )
      const nameKey = normalizeKeyLoose(name)

      if (materialNoKey) {
        add(`m:${materialNoKey}`, s)
        if (specKey) add(`ms:${materialNoKey}::${specKey}`, s)
      }
      if (materialCodeKey) {
        add(`c:${materialCodeKey}`, s)
        if (specKey) add(`cs:${materialCodeKey}::${specKey}`, s)
      }
      if (skuNoKey) {
        add(`k:${skuNoKey}`, s)
        if (specKey) add(`ks:${skuNoKey}::${specKey}`, s)
      }
      if (nameKey) {
        add(`n:${nameKey}`, s)
        if (specKey) add(`ns:${nameKey}::${specKey}`, s)
      }
    })
    return idx
  }

  useEffect(() => {
    const ids = Array.from(new Set((Array.isArray(rows) ? rows : []).map(getCustomerId).filter(Boolean)))
    if (!ids.length) return undefined
    let cancelled = false

    const loadForCustomer = async (customerId) => {
      if (!customerId) return
      if (skuIndexByCustomerId.has(customerId)) return
      if (inflightSkuRef.current.has(customerId)) return
      inflightSkuRef.current.add(customerId)
      try {
        const related = (Array.isArray(rows) ? rows : []).filter((r) => getCustomerId(r) === customerId)
        const skuIdKeywords = []
        const codeKeywords = []
        const nameKeywords = []

        related.forEach((r) => {
          const data = r?.data || {}
          const meta = r?.meta || {}
          const brief = r?.brief || data?.brief || meta?.brief || {}
          const product = r?.product || {}
          const items = Array.isArray(r?.items) ? r.items : Array.isArray(data?.items) ? data.items : []
          const item = (r?.__itemIndex !== undefined && items[r.__itemIndex]) ? items[r.__itemIndex] : (items[0] || {})
          const itemData = item?.data || {}
          const skuDirect = (() => {
            const candidates = [
              item?.sku, itemData?.sku,
              r?.__sku, r?.sku,
              data?.__sku, data?.sku,
              meta?.__sku, meta?.sku,
              brief?.__sku, brief?.sku,
              product?.__sku, product?.sku
            ]
            for (const c of candidates) {
              if (c && typeof c === 'object') return c
            }
            return null
          })()
          const first = items[0] || {}
          const firstData = first?.data || {}

          const skuId = normalizeId(
            item?.skuId ?? item?.sku_id ?? item?.sku?._id ?? item?.sku?.id ?? item?.customerSkuId ?? item?.customer_sku_id ??
            itemData?.skuId ?? itemData?.sku_id ?? itemData?.sku?._id ?? itemData?.sku?.id ?? itemData?.customerSkuId ?? itemData?.customer_sku_id ??
            r?.skuId ?? r?.sku_id ?? r?.sku?._id ?? r?.sku?.id ?? r?.customerSkuId ?? r?.customer_sku_id ??
            data?.skuId ?? data?.sku_id ?? data?.sku?._id ?? data?.sku?.id ?? data?.customerSkuId ?? data?.customer_sku_id ??
            meta?.skuId ?? meta?.sku_id ?? meta?.sku?._id ?? meta?.sku?.id ?? meta?.customerSkuId ?? meta?.customer_sku_id ??
            brief?.skuId ?? brief?.sku_id ?? brief?.sku?._id ?? brief?.sku?.id ?? brief?.customerSkuId ?? brief?.customer_sku_id ??
            product?.skuId ?? product?.sku_id ?? product?.sku?._id ?? product?.sku?.id ?? product?.customerSkuId ?? product?.customer_sku_id ??
            skuDirect?._id ?? skuDirect?.id
          )
          if (skuId) skuIdKeywords.push(skuId)

          const materialNo = pickText(
            item?.materialNo, item?.material_no,
            itemData?.materialNo, itemData?.material_no,
            skuDirect?.materialNo, skuDirect?.material_no,
            r?.materialNo, r?.material_no,
            data?.materialNo, data?.material_no,
            meta?.materialNo, meta?.material_no,
            brief?.materialNo, brief?.material_no,
            product?.materialNo, product?.material_no,
            first?.materialNo, first?.material_no,
            firstData?.materialNo, firstData?.material_no
          )
          const materialCode = pickText(
            item?.materialCode, item?.material_code,
            itemData?.materialCode, itemData?.material_code,
            skuDirect?.materialCode, skuDirect?.material_code, skuDirect?.code,
            r?.materialCode, r?.material_code,
            data?.materialCode, data?.material_code,
            meta?.materialCode, meta?.material_code,
            brief?.materialCode, brief?.material_code,
            product?.materialCode, product?.material_code,
            first?.materialCode, first?.material_code,
            firstData?.materialCode, firstData?.material_code
          )
          if (materialNo) codeKeywords.push(materialNo)
          if (materialCode) codeKeywords.push(materialCode)
          const skuNo = pickText(
            item?.skuNo, item?.sku_no, item?.skuCode, item?.sku_code,
            itemData?.skuNo, itemData?.sku_no, itemData?.skuCode, itemData?.sku_code,
            skuDirect?.skuNo, skuDirect?.sku_no, skuDirect?.skuCode, skuDirect?.sku_code,
            r?.skuNo, r?.sku_no, r?.skuCode, r?.sku_code,
            data?.skuNo, data?.sku_no, data?.skuCode, data?.sku_code,
            meta?.skuNo, meta?.sku_no, meta?.skuCode, meta?.sku_code,
            brief?.skuNo, brief?.sku_no, brief?.skuCode, brief?.sku_code,
            product?.skuNo, product?.sku_no, product?.skuCode, product?.sku_code,
            first?.skuNo, first?.sku_no, first?.skuCode, first?.sku_code,
            firstData?.skuNo, firstData?.sku_no, firstData?.skuCode, firstData?.sku_code
          )
          if (skuNo) codeKeywords.push(skuNo)

          const name = pickText(
            item?.goodsName, item?.goods_name, item?.productTitle, item?.product_title, item?.title, item?.productName, item?.product_name,
            itemData?.goodsName, itemData?.goods_name, itemData?.productTitle, itemData?.product_title, itemData?.title, itemData?.productName, itemData?.product_name,
            skuDirect?.goodsName, skuDirect?.goods_name, skuDirect?.productTitle, skuDirect?.product_title, skuDirect?.title, skuDirect?.productName, skuDirect?.product_name, skuDirect?.name,
            r?.goodsName, r?.goods_name, r?.productTitle, r?.product_title, r?.title, r?.productName, r?.product_name,
            data?.goodsName, data?.goods_name, data?.productTitle, data?.product_title, data?.title, data?.productName, data?.product_name,
            first?.goodsName, first?.goods_name, first?.title, first?.productName, first?.product_name,
            firstData?.goodsName, firstData?.goods_name, firstData?.title, firstData?.productName, firstData?.product_name
          )
          if (name) nameKeywords.push(name)
        })

        const uniq = (arr) => Array.from(new Set(arr.map((x) => normalizeText(x)).filter(Boolean)))
        const keywords = [
          ...uniq(skuIdKeywords),
          ...uniq(codeKeywords),
          ...uniq(nameKeywords)
        ].slice(0, 12)

        const fetchPages = async (params) => {
          const all = []
          const pageSize = 200
          const maxPages = 5
          for (let page = 1; page <= maxPages; page += 1) {
            const resp = await cachedCustomerSkuAPI.getCustomerSkus({
              customerId,
              params: { page, pageSize, limit: pageSize, ...(params || {}) }
            })
            const list = extractSkus(resp)
            if (list.length) all.push(...list)
            const totalPages = readTotalPages(resp)
            if (totalPages && page >= totalPages) break
            if (!list.length || list.length < pageSize) break
          }
          return all
        }

        const rawSkus = []
        if (keywords.length) {
          for (const keyword of keywords) {
            const got = await fetchPages({ keyword })
            if (got.length) rawSkus.push(...got)
          }
        } else {
          rawSkus.push(...(await fetchPages({})))
        }

        const byId = new Map()
        rawSkus.forEach((s) => {
          const sid = normalizeKeyLoose(normalizeId(s?.id ?? s?._id))
          if (!sid || byId.has(sid)) return
          byId.set(sid, s)
        })
        const all = Array.from(byId.values())

        if (cancelled) return
        const idx = buildSkuIndex(all)
        setSkuIndexByCustomerId((prev) => {
          const next = new Map(prev)
          next.set(customerId, idx)
          return next
        })
      } catch (_) {
        if (cancelled) return
        setSkuIndexByCustomerId((prev) => {
          const next = new Map(prev)
          next.set(customerId, new Map())
          return next
        })
      } finally {
        inflightSkuRef.current.delete(customerId)
      }
    }

    ;(async () => {
      for (const cid of ids) {
        if (cancelled) return
        await loadForCustomer(cid)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [rows, skuIndexByCustomerId])

  useEffect(() => {
    let cancelled = false
    const orderNos = (Array.isArray(rows) ? rows : []).map(getOrderNo).filter(Boolean)
    const uniq = Array.from(new Set(orderNos))
    const missing = uniq.filter((o) => !qrMap[o])
    if (!missing.length) return () => {}

    Promise.all(
      missing.map(async (orderNo) => {
        const row = (Array.isArray(rows) ? rows : []).find((r) => getOrderNo(r) === orderNo) || null
        try {
          const rawUrl = pickText(
            row?.qrCodeUrl, row?.qr_code_url,
            row?.data?.qrCodeUrl, row?.data?.qr_code_url,
            row?.meta?.qrCodeUrl, row?.meta?.qr_code_url
          )
          const lower = String(rawUrl || '').trim().toLowerCase()
          const isChild = /-\d+$/.test(String(orderNo || '').trim())
          const preferRaw = rawUrl && !lower.includes('api.qrserver.com/v1/create-qr-code') && !isChild
          if (preferRaw) return { orderNo, url: rawUrl }

          const orderId = getRowQrOrderId(row)
          const payload = buildOrderQrPayload({ orderId, orderNo })
          const url = await QRCode.toDataURL(payload, QR_OPTIONS)
          return { orderNo, url }
        } catch (e) {
          return { orderNo, url: '' }
        }
      })
    ).then((pairs) => {
      if (cancelled) return
      setQrMap((prev) => {
        const next = { ...prev }
        for (const p of pairs) {
          if (p?.orderNo && p?.url) next[p.orderNo] = p.url
        }
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [rows, qrMap])

  useEffect(() => {
    if (!Array.isArray(rows) || !rows.length) return undefined
    let cancelled = false

    const mergeOrder = (base, fetched) => {
      const b = base && typeof base === 'object' ? base : {}
      const f = fetched && typeof fetched === 'object' ? fetched : {}
      const next = { ...b, ...f, __creaseHydrateTried: true }
      const bData = b?.data && typeof b.data === 'object' ? b.data : null
      const fData = f?.data && typeof f.data === 'object' ? f.data : null
      const bMeta = b?.meta && typeof b.meta === 'object' ? b.meta : null
      const fMeta = f?.meta && typeof f.meta === 'object' ? f.meta : null
      if (bData || fData) next.data = { ...(bData || {}), ...(fData || {}) }
      if (bMeta || fMeta) next.meta = { ...(bMeta || {}), ...(fMeta || {}) }
      const fItems =
        Array.isArray(f?.items) ? f.items
          : Array.isArray(f?.data?.items) ? f.data.items
            : Array.isArray(f?.data?.data?.items) ? f.data.data.items
              : Array.isArray(f?.meta?.items) ? f.meta.items
                : []
      if (Array.isArray(fItems) && fItems.length) next.items = fItems
      return next
    }

    const sameRow = (a, b) => {
      const aid = normalizeId(a?._id ?? a?.id ?? a?.key)
      const bid = normalizeId(b?._id ?? b?.id ?? b?.key)
      if (aid && bid && aid === bid) return true
      const ano = getOrderNo(a)
      const bno = getOrderNo(b)
      if (ano && bno && ano === bno) return true
      return false
    }

    const tryHydrateOne = async (row) => {
      if (!row || typeof row !== 'object') return null
      if (row.__creaseHydrateTried) return null

      const resolved = resolveRow(row)
      const needsHydrate = (
        !resolved ||
        resolved.crease === '-' ||
        resolved.sizeText === '-' ||
        resolved.materialText === '-' ||
        !resolved.joinMethod ||
        resolved.joinMethod === '-'
      )
      if (!needsHydrate) return null

      const orderId = normalizeId(row?._id ?? row?.id ?? row?.key)
      const orderNo = getOrderNo(row)
      const token = orderId ? `id:${orderId}` : orderNo ? `no:${orderNo}` : ''
      if (!token) return null
      if (inflightOrderRef.current.has(token)) return null
      inflightOrderRef.current.add(token)

      try {
        let fetched = null
        const isChildNo = orderNo && /-\d+$/.test(String(orderNo))
        if (!fetched && isChildNo) {
          try {
            const m = String(orderNo).match(/^(.*)-(\d+)$/)
            const parentNo = m ? String(m[1] || '').trim() : ''
            const idx = m ? (Number(m[2]) - 1) : -1
            if (parentNo) {
              const groupRes = await orderAPI.getOrderGroup(parentNo)
              const body = groupRes?.data ?? groupRes
              const payload = body?.data ?? body
              const group = payload?.data ?? payload
              const parentDoc = group?.parent && typeof group.parent === 'object' ? group.parent : null
              const children = Array.isArray(group?.children) ? group.children : []
              const childDoc =
                children.find((c) => String(c?.orderNo || c?.orderNumber || c?.subOrderNo || c?.subOrderNumber || '').trim() === String(orderNo)) ||
                (Number.isFinite(idx) && idx >= 0 && idx < children.length ? children[idx] : null) ||
                null
              if (parentDoc && typeof parentDoc === 'object') {
                const base = { ...parentDoc }
                if (Array.isArray(parentDoc?.items)) base.items = parentDoc.items
                if (Number.isFinite(idx) && idx >= 0) base.__itemIndex = idx
                base.__parentOrderId = normalizeId(parentDoc?._id ?? parentDoc?.id)
                if (childDoc && typeof childDoc === 'object') {
                  const merged = { ...base, ...childDoc }

                  const joinMethod = pickText(
                    childDoc?.joinMethod, childDoc?.join_method,
                    childDoc?.joinWay, childDoc?.join_way,
                    childDoc?.spliceMethod, childDoc?.splice_method,
                    childDoc?.splicingMethod, childDoc?.splicing_method,
                    childDoc?.connectMethod, childDoc?.connect_method,
                    base?.joinMethod, base?.join_method,
                    base?.joinWay, base?.join_way,
                    base?.spliceMethod, base?.splice_method,
                    base?.splicingMethod, base?.splicing_method,
                    base?.connectMethod, base?.connect_method
                  )
                  if (joinMethod) {
                    merged.joinMethod = joinMethod
                    merged.join_method = joinMethod
                  }

                  const c1 = pickText(childDoc?.creasingSize1, childDoc?.creasing_size1, childDoc?.creaseSize1, childDoc?.crease_size1, childDoc?.creasingSize_1, childDoc?.creasing_size_1, childDoc?.creaseSize_1, childDoc?.crease_size_1, base?.creasingSize1, base?.creasing_size1, base?.creaseSize1, base?.crease_size1, base?.creasingSize_1, base?.creasing_size_1, base?.creaseSize_1, base?.crease_size_1)
                  const c2 = pickText(childDoc?.creasingSize2, childDoc?.creasing_size2, childDoc?.creaseSize2, childDoc?.crease_size2, childDoc?.creasingSize_2, childDoc?.creasing_size_2, childDoc?.creaseSize_2, childDoc?.crease_size_2, base?.creasingSize2, base?.creasing_size2, base?.creaseSize2, base?.crease_size2, base?.creasingSize_2, base?.creasing_size_2, base?.creaseSize_2, base?.crease_size_2)
                  const c3 = pickText(childDoc?.creasingSize3, childDoc?.creasing_size3, childDoc?.creaseSize3, childDoc?.crease_size3, childDoc?.creasingSize_3, childDoc?.creasing_size_3, childDoc?.creaseSize_3, childDoc?.crease_size_3, base?.creasingSize3, base?.creasing_size3, base?.creaseSize3, base?.crease_size3, base?.creasingSize_3, base?.creasing_size_3, base?.creaseSize_3, base?.crease_size_3)
                  if (c1) merged.creasingSize1 = c1
                  if (c2) merged.creasingSize2 = c2
                  if (c3) merged.creasingSize3 = c3

                  const creaseType = pickText(childDoc?.creasingType, childDoc?.creaseType, childDoc?.creasing_type, childDoc?.crease_type, base?.creasingType, base?.creaseType, base?.creasing_type, base?.crease_type)
                  if (creaseType) merged.creasingType = creaseType

                  fetched = merged
                } else {
                  fetched = base
                }
              }
            }
          } catch (_) { void 0 }
        }
        if (!fetched && orderId) {
          try {
            fetched = unwrapOrderDetailResponse(await orderAPI.getOrder(orderId))
          } catch (_) { void 0 }
        }
        if (!fetched && orderNo) {
          try {
            const resp = await orderAPI.getOrders({ search: orderNo, page: 1, pageSize: 30, orderBy: 'createdAt_desc', excludeOrderType: 'purchase' })
            const list = Array.isArray(resp) ? resp : Array.isArray(resp?.data) ? resp.data : Array.isArray(resp?.data?.orders) ? resp.data.orders : []
            fetched = list.find((x) => String(x?.orderNo || x?.orderNumber || '') === String(orderNo)) || list[0] || null
          } catch (_) { void 0 }
        }
        if (!fetched) return { ...row, __creaseHydrateTried: true }
        return mergeOrder(row, fetched)
      } finally {
        inflightOrderRef.current.delete(token)
      }
    }

    ;(async () => {
      for (const row of rows) {
        if (cancelled) return
        const nextRow = await tryHydrateOne(row)
        if (cancelled) return
        if (!nextRow) continue
        setRows((prev) => {
          if (!Array.isArray(prev) || !prev.length) return prev
          const idx = prev.findIndex((x) => sameRow(x, row))
          if (idx < 0) return prev
          const updated = prev.slice()
          updated[idx] = mergeOrder(prev[idx], nextRow)
          return updated
        })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [rows, skuIndexByCustomerId])

  const formatSpecText = ({ l, w, h, specCandidate }) => {
    const specDims = parseDimsFromToken(specCandidate)
    const a = Number(l || 0)
    const b = Number(w || 0)
    const c = Number(h || 0)
    if (specDims && specDims.length === 3) return `${specDims.join('×')}mm`
    if (a > 0 && b > 0 && c > 0) return `${a}×${b}×${c}mm`
    if (specDims) return `${specDims.join('×')}mm`
    if (a > 0 && b > 0) return `${a}×${b}mm`
    if (a > 0) return String(a)
    if (b > 0) return String(b)
    if (c > 0) return String(c)
    return '-'
  }

  const formatBoardSizeText = ({ boardW, boardH, candidate }) => {
    const dims = parseDimsFromToken(candidate)
    if (dims && dims.length === 2) return `${dims[0]}×${dims[1]}mm`
    const w = Number(boardW || 0)
    const h = Number(boardH || 0)
    if (w > 0 && h > 0) return `${w}×${h}mm`
    return '-'
  }

  const looksLikeMaterialNo = (v) => {
    const s = normalizeText(v)
    if (!s) return false
    if (/^\d+$/.test(s)) return true
    if (s.length > 6 && /\d/.test(s) && /^[A-Za-z0-9-]+$/.test(s)) return true
    return false
  }

  const looksLikeMaterialCode = (v) => {
    const s = normalizeText(v)
    if (!s) return false
    if (/^\d+$/.test(s)) return false
    if (s.length < 12) return true
    return false
  }

  const buildMaterialText = ({ material, materialCode, flute }) => {
    const m = normalizeText(material || materialCode || '')
    const f = normalizeText(flute || '')
    if (!m && !f) return '-'
    if (!m) return f || '-'
    if (!f) return m || '-'
    return `${m || '-'}/${f}`
  }

  const buildMaterialNoDisplay = ({ materialNo, materialCode, material }) => {
    const no = normalizeText(materialNo)
    if (!no) return ''
    if (materialCode && normalizeKey(no) === normalizeKey(materialCode)) return ''
    if (material && normalizeKey(no) === normalizeKey(material)) return ''
    return no
  }

  const getCategoryDisplay = (r) => {
    const normalizeTextLocal = (v) => String(v ?? '').trim()
    const pickTextLocal = (...vals) => {
      for (const v of vals) {
        const s = normalizeTextLocal(v)
        if (s) return s
      }
      return ''
    }
    const data = r?.data && typeof r.data === 'object' ? r.data : null
    const items = Array.isArray(r?.items) ? r.items : Array.isArray(data?.items) ? data.items : []
    const idx = getRowItemIndex(r)
    const item = (idx !== undefined && items[idx]) ? items[idx] : (items[0] || null)
    const itemData = item?.data && typeof item.data === 'object' ? item.data : null
    const first = items[0] || null
    const meta = r?.meta && typeof r.meta === 'object' ? r.meta : null
    const brief = meta?.brief && typeof meta.brief === 'object' ? meta.brief : null
    const product = r?.product && typeof r.product === 'object' ? r.product : null
    const fromCategory = pickTextLocal(
      item?.category,
      item?.productCategory,
      item?.productType,
      itemData?.category,
      itemData?.productCategory,
      itemData?.productType,
      r?.category,
      r?.productCategory,
      r?.productType,
      data?.category,
      data?.productCategory,
      data?.productType,
      meta?.category,
      meta?.productCategory,
      meta?.productType,
      brief?.category,
      brief?.productCategory,
      brief?.productType,
      product?.category,
      product?.productCategory,
      product?.productType,
      first?.category,
      first?.productCategory,
      first?.productType
    )
    const fromProductName = pickTextLocal(
      item?.productName,
      itemData?.productName,
      r?.productName,
      data?.productName,
      meta?.productName,
      brief?.productName,
      product?.name,
      first?.productName
    )
    return fromCategory || fromProductName || '-'
  }

  const resolveRow = (r) => {
    const data = r?.data || {}
    const meta = (r?.meta && typeof r.meta === 'object') ? r.meta : ((data?.meta && typeof data.meta === 'object') ? data.meta : {})
    const brief = (meta?.brief && typeof meta.brief === 'object') ? meta.brief : (r?.brief || data?.brief || {})
    const items = Array.isArray(r?.items) ? r.items : Array.isArray(data?.items) ? data.items : []
    const orderNo = getOrderNo(r)
    const itemIndex = getRowItemIndex(r)
    const item = (itemIndex !== undefined && items[itemIndex]) ? items[itemIndex] : (items[0] || {})
    const itemData = item?.data || {}
    const product = (() => {
      const candidates = [
        r?.product,
        data?.product,
        meta?.product,
        brief?.product,
        item?.product,
        itemData?.product
      ]
      for (const c of candidates) {
        if (c && typeof c === 'object') return c
      }
      return {}
    })()
    const skuDirect = (() => {
      const candidates = [
        item?.sku, itemData?.sku,
        r?.__sku, r?.sku,
        data?.__sku, data?.sku,
        meta?.__sku, meta?.sku,
        brief?.__sku, brief?.sku,
        product?.__sku, product?.sku
      ]
      for (const c of candidates) {
        if (c && typeof c === 'object') return c
      }
      return null
    })()
    const first = items[0] || {}
    const firstData = first?.data || {}
    const customerId = getCustomerId(r)
    const skuIndex = customerId ? skuIndexByCustomerId.get(customerId) : null
    const skuId = normalizeId(
      item?.skuId ?? item?.sku_id ?? item?.sku?._id ?? item?.sku?.id ?? item?.customerSkuId ?? item?.customer_sku_id ??
      itemData?.skuId ?? itemData?.sku_id ?? itemData?.sku?._id ?? itemData?.sku?.id ?? itemData?.customerSkuId ?? itemData?.customer_sku_id ??
      r?.skuId ?? r?.sku_id ?? r?.sku?._id ?? r?.sku?.id ?? r?.customerSkuId ?? r?.customer_sku_id ??
      data?.skuId ?? data?.sku_id ?? data?.sku?._id ?? data?.sku?.id ?? data?.customerSkuId ?? data?.customer_sku_id ??
      meta?.skuId ?? meta?.sku_id ?? meta?.sku?._id ?? meta?.sku?.id ?? meta?.customerSkuId ?? meta?.customer_sku_id ??
      brief?.skuId ?? brief?.sku_id ?? brief?.sku?._id ?? brief?.sku?.id ?? brief?.customerSkuId ?? brief?.customer_sku_id ??
      product?.skuId ?? product?.sku_id ?? product?.sku?._id ?? product?.sku?.id ?? product?.customerSkuId ?? product?.customer_sku_id ??
      skuDirect?._id ?? skuDirect?.id
    )
    const localMaterialNoForSku = pickText(
      item?.materialNo, item?.material_no,
      item?.materialNoDisplay, item?.material_no_display,
      itemData?.materialNo, itemData?.material_no,
      itemData?.materialNoDisplay, itemData?.material_no_display,
      skuDirect?.materialNo, skuDirect?.material_no,
      r?.materialNo, r?.material_no,
      r?.materialNoDisplay, r?.material_no_display,
      data?.materialNo, data?.material_no,
      data?.materialNoDisplay, data?.material_no_display,
      meta?.materialNo, meta?.material_no,
      brief?.materialNo, brief?.material_no,
      product?.materialNo, product?.material_no,
      first?.materialNo, first?.material_no,
      firstData?.materialNo, firstData?.material_no
    )
    const localMaterialCodeForSku = pickText(
      item?.materialCode, item?.material_code,
      itemData?.materialCode, itemData?.material_code,
      skuDirect?.materialCode, skuDirect?.material_code, skuDirect?.code,
      r?.materialCode, r?.material_code,
      data?.materialCode, data?.material_code,
      meta?.materialCode, meta?.material_code,
      brief?.materialCode, brief?.material_code,
      product?.materialCode, product?.material_code,
      first?.materialCode, first?.material_code,
      firstData?.materialCode, firstData?.material_code
    )
    const specForSku = pickText(
      item?.specification, item?.spec, item?.productSpec, item?.product_spec,
      itemData?.specification, itemData?.spec, itemData?.productSpec, itemData?.product_spec,
      skuDirect?.specification, skuDirect?.spec, skuDirect?.productSpec, skuDirect?.product_spec,
      r?.specification, r?.spec, r?.productSpec, r?.product_spec,
      data?.specification, data?.spec, data?.productSpec, data?.product_spec,
      meta?.specification, meta?.spec, meta?.productSpec, meta?.product_spec,
      brief?.specification, brief?.spec, brief?.productSpec, brief?.product_spec,
      product?.specification, product?.spec, product?.productSpec, product?.product_spec,
      first?.specification, first?.spec, first?.productSpec, first?.product_spec,
      firstData?.specification, firstData?.spec, firstData?.productSpec, firstData?.product_spec
    )
    const nameForSku = pickText(
      item?.goodsName, item?.goods_name, item?.productTitle, item?.product_title, item?.title, item?.productName, item?.product_name,
      itemData?.goodsName, itemData?.goods_name, itemData?.productTitle, itemData?.product_title, itemData?.title, itemData?.productName, itemData?.product_name,
      skuDirect?.goodsName, skuDirect?.goods_name, skuDirect?.productTitle, skuDirect?.product_title, skuDirect?.title, skuDirect?.productName, skuDirect?.product_name, skuDirect?.name,
      r?.goodsName, r?.goods_name, r?.productTitle, r?.product_title, r?.title, r?.productName, r?.product_name,
      data?.goodsName, data?.goods_name, data?.productTitle, data?.product_title, data?.title, data?.productName, data?.product_name,
      first?.goodsName, first?.goods_name, first?.title, first?.productName, first?.product_name,
      firstData?.goodsName, firstData?.goods_name, firstData?.title, firstData?.productName, firstData?.product_name
    )
    const skuFromIndexResolved = (() => {
      if (r?.skuFromIndex) return r.skuFromIndex
      if (!(skuIndex instanceof Map) || !skuIndex.size) return null
      const skuIdKey = normalizeKeyLoose(skuId)
      const materialNoKey = normalizeKeyLoose(localMaterialNoForSku)
      const materialCodeKey = normalizeKeyLoose(localMaterialCodeForSku)
      const localSkuNo = pickText(
        item?.skuNo, item?.sku_no, item?.skuCode, item?.sku_code,
        itemData?.skuNo, itemData?.sku_no, itemData?.skuCode, itemData?.sku_code,
        skuDirect?.skuNo, skuDirect?.sku_no, skuDirect?.skuCode, skuDirect?.sku_code,
        r?.skuNo, r?.sku_no, r?.skuCode, r?.sku_code,
        data?.skuNo, data?.sku_no, data?.skuCode, data?.sku_code,
        meta?.skuNo, meta?.sku_no, meta?.skuCode, meta?.sku_code,
        brief?.skuNo, brief?.sku_no, brief?.skuCode, brief?.sku_code,
        product?.skuNo, product?.sku_no, product?.skuCode, product?.sku_code,
        first?.skuNo, first?.sku_no, first?.skuCode, first?.sku_code,
        firstData?.skuNo, firstData?.sku_no, firstData?.skuCode, firstData?.sku_code
      )
      const skuNoKey = normalizeKeyLoose(localSkuNo)
      const specKey = normalizeSpecKey(specForSku)
      const nameKey = normalizeKeyLoose(nameForSku)
      if (skuIdKey && skuIndex.has(`id:${skuIdKey}`)) return skuIndex.get(`id:${skuIdKey}`)
      if (materialNoKey && specKey && skuIndex.has(`ms:${materialNoKey}::${specKey}`)) return skuIndex.get(`ms:${materialNoKey}::${specKey}`)
      if (materialNoKey && skuIndex.has(`m:${materialNoKey}`)) return skuIndex.get(`m:${materialNoKey}`)
      if (materialCodeKey && specKey && skuIndex.has(`cs:${materialCodeKey}::${specKey}`)) return skuIndex.get(`cs:${materialCodeKey}::${specKey}`)
      if (materialCodeKey && skuIndex.has(`c:${materialCodeKey}`)) return skuIndex.get(`c:${materialCodeKey}`)
      if (skuNoKey && specKey && skuIndex.has(`ks:${skuNoKey}::${specKey}`)) return skuIndex.get(`ks:${skuNoKey}::${specKey}`)
      if (skuNoKey && skuIndex.has(`k:${skuNoKey}`)) return skuIndex.get(`k:${skuNoKey}`)
      if (nameKey && specKey && skuIndex.has(`ns:${nameKey}::${specKey}`)) return skuIndex.get(`ns:${nameKey}::${specKey}`)
      if (nameKey && skuIndex.has(`n:${nameKey}`)) return skuIndex.get(`n:${nameKey}`)
      return null
    })()
    const skuFromIndex = skuFromIndexResolved || {}

    const customerNameDisplay = pickText(
      r?.customerName, r?.customer_name,
      data?.customerName, data?.customer_name,
      meta?.customerName, meta?.customer_name,
      brief?.customerName, brief?.customer_name
    )

    const specCandidatePicked = pickText(
      r?.specification, r?.productSpec, r?.product_spec, r?.spec,
      data?.specification, data?.productSpec, data?.product_spec, data?.spec,
      meta?.specification, meta?.productSpec, meta?.product_spec, meta?.spec,
      brief?.specification, brief?.productSpec, brief?.product_spec, brief?.spec,
      product?.specification, product?.productSpec, product?.product_spec, product?.spec,
      first?.specification, first?.productSpec, first?.product_spec, first?.spec,
      firstData?.specification, firstData?.productSpec, firstData?.product_spec, firstData?.spec,
      item?.specification, item?.productSpec, item?.product_spec, item?.spec,
      itemData?.specification, itemData?.productSpec, itemData?.product_spec, itemData?.spec
    )
    const skuSpecCandidate = pickText(skuFromIndex?.specification, skuFromIndex?.spec)
    const finalSpecCandidate = specCandidatePicked || skuSpecCandidate

    const l = toNum(pickText(r?.length, data?.length, meta?.length, brief?.length, product?.length, first?.length, firstData?.length, skuFromIndex?.length))
    const w = toNum(pickText(r?.width, data?.width, meta?.width, brief?.width, product?.width, first?.width, firstData?.width, skuFromIndex?.width))
    const h = toNum(pickText(r?.height, data?.height, meta?.height, brief?.height, product?.height, first?.height, firstData?.height, skuFromIndex?.height))
    let specText = formatSpecText({ l, w, h, specCandidate: finalSpecCandidate })

    const boardW = toNum(
      pickText(
        r?.boardWidth, r?.board_width, r?.specWidth,
        data?.boardWidth, data?.board_width, data?.specWidth,
        meta?.boardWidth, meta?.board_width, meta?.specWidth,
        brief?.boardWidth, brief?.board_width, brief?.specWidth,
        product?.boardWidth, product?.board_width, product?.specWidth,
        first?.boardWidth, first?.board_width, first?.specWidth,
        firstData?.boardWidth, firstData?.board_width, firstData?.specWidth,
        skuFromIndex?.boardWidth, skuFromIndex?.board_width, skuFromIndex?.specWidth, skuFromIndex?.width
      )
    )
    const boardH = toNum(
      pickText(
        r?.boardHeight, r?.board_height, r?.boardLength, r?.board_length, r?.specLength,
        data?.boardHeight, data?.board_height, data?.boardLength, data?.board_length, data?.specLength,
        meta?.boardHeight, meta?.board_height, meta?.boardLength, meta?.board_length, meta?.specLength,
        brief?.boardHeight, brief?.board_height, brief?.boardLength, brief?.board_length, brief?.specLength,
        product?.boardHeight, product?.board_height, product?.boardLength, product?.board_length, product?.specLength,
        first?.boardHeight, first?.board_height, first?.boardLength, first?.board_length, first?.specLength,
        firstData?.boardHeight, firstData?.board_height, firstData?.boardLength, firstData?.board_length, firstData?.specLength,
        skuFromIndex?.boardHeight, skuFromIndex?.board_height, skuFromIndex?.specLength, skuFromIndex?.height, skuFromIndex?.length
      )
    )
    const sizeText = formatBoardSizeText({
      boardW,
      boardH,
      candidate: pickText(r?.boardSizeText, r?.boardSize, data?.boardSize, meta?.boardSize, brief?.boardSize, skuFromIndex?.boardSize)
    })

    const specDims = parseDimsFromToken(specCandidatePicked)
    if (specDims && specDims.length === 2 && boardW > 0 && boardH > 0 && skuSpecCandidate) {
      const s0 = normalizeSizeToken(`${specDims[0]}×${specDims[1]}`)
      const bw = normalizeSizeToken(`${boardW}×${boardH}`)
      const bh = normalizeSizeToken(`${boardH}×${boardW}`)
      if ((s0 === bw || s0 === bh) && normalizeSizeToken(skuSpecCandidate) !== normalizeSizeToken(specCandidatePicked)) {
        specText = formatSpecText({ l, w, h, specCandidate: skuSpecCandidate })
      }
    }

    const material = pickText(
      r?.material, r?.materialName, r?.material_name,
      data?.material, data?.materialName, data?.material_name,
      meta?.material, meta?.materialName, meta?.material_name,
      brief?.material, brief?.materialName, brief?.material_name,
      product?.material, product?.materialName, product?.material_name,
      first?.material, first?.materialName, first?.material_name,
      firstData?.material, firstData?.materialName, firstData?.material_name,
      item?.material, item?.materialName, item?.material_name,
      itemData?.material, itemData?.materialName, itemData?.material_name,
      skuFromIndex?.material, skuFromIndex?.materialName, skuFromIndex?.material_name
    )

    const materialCodePicked = pickText(
      r?.materialCode, r?.material_code,
      data?.materialCode, data?.material_code,
      meta?.materialCode, meta?.material_code,
      brief?.materialCode, brief?.material_code,
      product?.materialCode, product?.material_code,
      first?.materialCode, first?.material_code,
      firstData?.materialCode, firstData?.material_code,
      item?.materialCode, item?.material_code,
      itemData?.materialCode, itemData?.material_code
    )

    const materialNoPicked = pickText(
      r?.materialNo, r?.material_no,
      data?.materialNo, data?.material_no,
      meta?.materialNo, meta?.material_no,
      brief?.materialNo, brief?.material_no,
      product?.materialNo, product?.material_no,
      first?.materialNo, first?.material_no,
      firstData?.materialNo, firstData?.material_no,
      item?.materialNo, item?.material_no,
      itemData?.materialNo, itemData?.material_no
    )

    let finalMaterialCode = materialCodePicked
    let finalMaterialNo = materialNoPicked

    if (looksLikeMaterialNo(finalMaterialCode) && (!finalMaterialNo || looksLikeMaterialCode(finalMaterialNo))) {
      const temp = finalMaterialCode
      finalMaterialCode = finalMaterialNo
      finalMaterialNo = temp
    } else if (looksLikeMaterialNo(finalMaterialCode) && !finalMaterialNo) {
      finalMaterialNo = finalMaterialCode
      finalMaterialCode = ''
    } else if (!finalMaterialCode && finalMaterialNo && looksLikeMaterialCode(finalMaterialNo) && !looksLikeMaterialNo(finalMaterialNo)) {
      finalMaterialCode = finalMaterialNo
      finalMaterialNo = ''
    }

    if (finalMaterialCode && finalMaterialNo && normalizeKey(finalMaterialCode) === normalizeKey(finalMaterialNo)) {
      finalMaterialCode = ''
    }

    const skuCode = normalizeText(
      skuFromIndex?.materialCode || skuFromIndex?.material_code ||
      skuDirect?.materialCode || skuDirect?.material_code
    )
    if (skuCode && !finalMaterialCode) {
      finalMaterialCode = skuCode
    }
    const skuNo = normalizeText(
      skuFromIndex?.materialNo || skuFromIndex?.material_no ||
      skuDirect?.materialNo || skuDirect?.material_no
    )
    if (skuNo && !finalMaterialNo) {
      finalMaterialNo = skuNo
    }
    if (skuCode && !skuNo && finalMaterialNo && normalizeKey(finalMaterialNo) === normalizeKey(skuCode)) {
      finalMaterialNo = ''
    }

    const flute = normalizeText(
      r?.flute ?? r?.flute_code ?? r?.fluteType ?? r?.flute_type ??
      data?.flute ?? data?.flute_code ?? data?.fluteType ?? data?.flute_type ??
      meta?.flute ?? meta?.flute_code ?? meta?.fluteType ?? meta?.flute_type ??
      brief?.flute ?? brief?.flute_code ?? brief?.fluteType ?? brief?.flute_type ??
      product?.flute ?? product?.flute_code ?? product?.fluteType ?? product?.flute_type ??
      first?.flute ?? first?.flute_code ?? first?.fluteType ?? first?.flute_type ??
      firstData?.flute ?? firstData?.flute_code ?? firstData?.fluteType ?? firstData?.flute_type ??
      item?.flute ?? item?.flute_code ?? item?.fluteType ?? item?.flute_type ??
      itemData?.flute ?? itemData?.flute_code ?? itemData?.fluteType ?? itemData?.flute_type ??
      skuFromIndex?.flute ?? skuFromIndex?.flute_code ?? skuFromIndex?.fluteType ?? skuFromIndex?.flute_type ??
      skuDirect?.flute ?? skuDirect?.flute_code ?? skuDirect?.fluteType ?? skuDirect?.flute_type ??
      ''
    )

    const materialText = buildMaterialText({ material, materialCode: finalMaterialCode, flute })
    const materialNoDisplay = buildMaterialNoDisplay({ materialNo: finalMaterialNo, materialCode: finalMaterialCode, material })

    const c1Text = pickText(
      item?.creasingSize1, item?.creasing_size1, item?.creaseSize1, item?.crease_size1,
      item?.creasingSize_1, item?.creasing_size_1, item?.creaseSize_1, item?.crease_size_1,
      itemData?.creasingSize1, itemData?.creasing_size1, itemData?.creaseSize1, itemData?.crease_size1,
      itemData?.creasingSize_1, itemData?.creasing_size_1, itemData?.creaseSize_1, itemData?.crease_size_1,
      r?.creasingSize1, r?.creasing_size1, r?.creaseSize1, r?.crease_size1,
      r?.creasingSize_1, r?.creasing_size_1, r?.creaseSize_1, r?.crease_size_1,
      data?.creasingSize1, data?.creasing_size1, data?.creaseSize1, data?.crease_size1,
      data?.creasingSize_1, data?.creasing_size_1, data?.creaseSize_1, data?.crease_size_1,
      meta?.creasingSize1, meta?.creasing_size1, meta?.creaseSize1, meta?.crease_size1,
      meta?.creasingSize_1, meta?.creasing_size_1, meta?.creaseSize_1, meta?.crease_size_1,
      brief?.creasingSize1, brief?.creasing_size1, brief?.creaseSize1, brief?.crease_size1,
      brief?.creasingSize_1, brief?.creasing_size_1, brief?.creaseSize_1, brief?.crease_size_1,
      product?.creasingSize1, product?.creasing_size1, product?.creaseSize1, product?.crease_size1,
      product?.creasingSize_1, product?.creasing_size_1, product?.creaseSize_1, product?.crease_size_1,
      first?.creasingSize1, first?.creasing_size1, first?.creaseSize1, first?.crease_size1,
      first?.creasingSize_1, first?.creasing_size_1, first?.creaseSize_1, first?.crease_size_1,
      firstData?.creasingSize1, firstData?.creasing_size1, firstData?.creaseSize1, firstData?.crease_size1,
      firstData?.creasingSize_1, firstData?.creasing_size_1, firstData?.creaseSize_1, firstData?.crease_size_1,
      skuFromIndex?.creasingSize1, skuFromIndex?.creasing_size1, skuFromIndex?.creaseSize1, skuFromIndex?.crease_size1,
      skuFromIndex?.creasingSize_1, skuFromIndex?.creasing_size_1, skuFromIndex?.creaseSize_1, skuFromIndex?.crease_size_1,
      skuDirect?.creasingSize1, skuDirect?.creasing_size1, skuDirect?.creaseSize1, skuDirect?.crease_size1,
      skuDirect?.creasingSize_1, skuDirect?.creasing_size_1, skuDirect?.creaseSize_1, skuDirect?.crease_size_1
    )
    const c2Text = pickText(
      item?.creasingSize2, item?.creasing_size2, item?.creaseSize2, item?.crease_size2,
      item?.creasingSize_2, item?.creasing_size_2, item?.creaseSize_2, item?.crease_size_2,
      itemData?.creasingSize2, itemData?.creasing_size2, itemData?.creaseSize2, itemData?.crease_size2,
      itemData?.creasingSize_2, itemData?.creasing_size_2, itemData?.creaseSize_2, itemData?.crease_size_2,
      r?.creasingSize2, r?.creasing_size2, r?.creaseSize2, r?.crease_size2,
      r?.creasingSize_2, r?.creasing_size_2, r?.creaseSize_2, r?.crease_size_2,
      data?.creasingSize2, data?.creasing_size2, data?.creaseSize2, data?.crease_size2,
      data?.creasingSize_2, data?.creasing_size_2, data?.creaseSize_2, data?.crease_size_2,
      meta?.creasingSize2, meta?.creasing_size2, meta?.creaseSize2, meta?.crease_size2,
      meta?.creasingSize_2, meta?.creasing_size_2, meta?.creaseSize_2, meta?.crease_size_2,
      brief?.creasingSize2, brief?.creasing_size2, brief?.creaseSize2, brief?.crease_size2,
      brief?.creasingSize_2, brief?.creasing_size_2, brief?.creaseSize_2, brief?.crease_size_2,
      product?.creasingSize2, product?.creasing_size2, product?.creaseSize2, product?.crease_size2,
      product?.creasingSize_2, product?.creasing_size_2, product?.creaseSize_2, product?.crease_size_2,
      first?.creasingSize2, first?.creasing_size2, first?.creaseSize2, first?.crease_size2,
      first?.creasingSize_2, first?.creasing_size_2, first?.creaseSize_2, first?.crease_size_2,
      firstData?.creasingSize2, firstData?.creasing_size2, firstData?.creaseSize2, firstData?.crease_size2,
      firstData?.creasingSize_2, firstData?.creasing_size_2, firstData?.creaseSize_2, firstData?.crease_size_2,
      skuFromIndex?.creasingSize2, skuFromIndex?.creasing_size2, skuFromIndex?.creaseSize2, skuFromIndex?.crease_size2,
      skuFromIndex?.creasingSize_2, skuFromIndex?.creasing_size_2, skuFromIndex?.creaseSize_2, skuFromIndex?.crease_size_2,
      skuDirect?.creasingSize2, skuDirect?.creasing_size2, skuDirect?.creaseSize2, skuDirect?.crease_size2,
      skuDirect?.creasingSize_2, skuDirect?.creasing_size_2, skuDirect?.creaseSize_2, skuDirect?.crease_size_2
    )
    const c3Text = pickText(
      item?.creasingSize3, item?.creasing_size3, item?.creaseSize3, item?.crease_size3,
      item?.creasingSize_3, item?.creasing_size_3, item?.creaseSize_3, item?.crease_size_3,
      itemData?.creasingSize3, itemData?.creasing_size3, itemData?.creaseSize3, itemData?.crease_size3,
      itemData?.creasingSize_3, itemData?.creasing_size_3, itemData?.creaseSize_3, itemData?.crease_size_3,
      r?.creasingSize3, r?.creasing_size3, r?.creaseSize3, r?.crease_size3,
      r?.creasingSize_3, r?.creasing_size_3, r?.creaseSize_3, r?.crease_size_3,
      data?.creasingSize3, data?.creasing_size3, data?.creaseSize3, data?.crease_size3,
      data?.creasingSize_3, data?.creasing_size_3, data?.creaseSize_3, data?.crease_size_3,
      meta?.creasingSize3, meta?.creasing_size3, meta?.creaseSize3, meta?.crease_size3,
      meta?.creasingSize_3, meta?.creasing_size_3, meta?.creaseSize_3, meta?.crease_size_3,
      brief?.creasingSize3, brief?.creasing_size3, brief?.creaseSize3, brief?.crease_size3,
      brief?.creasingSize_3, brief?.creasing_size_3, brief?.creaseSize_3, brief?.crease_size_3,
      product?.creasingSize3, product?.creasing_size3, product?.creaseSize3, product?.crease_size3,
      product?.creasingSize_3, product?.creasing_size_3, product?.creaseSize_3, product?.crease_size_3,
      first?.creasingSize3, first?.creasing_size3, first?.creaseSize3, first?.crease_size3,
      first?.creasingSize_3, first?.creasing_size_3, first?.creaseSize_3, first?.crease_size_3,
      firstData?.creasingSize3, firstData?.creasing_size3, firstData?.creaseSize3, firstData?.crease_size3,
      firstData?.creasingSize_3, firstData?.creasing_size_3, firstData?.creaseSize_3, firstData?.crease_size_3,
      skuFromIndex?.creasingSize3, skuFromIndex?.creasing_size3, skuFromIndex?.creaseSize3, skuFromIndex?.crease_size3,
      skuFromIndex?.creasingSize_3, skuFromIndex?.creasing_size_3, skuFromIndex?.creaseSize_3, skuFromIndex?.crease_size_3,
      skuDirect?.creasingSize3, skuDirect?.creasing_size3, skuDirect?.creaseSize3, skuDirect?.crease_size3,
      skuDirect?.creasingSize_3, skuDirect?.creasing_size_3, skuDirect?.creaseSize_3, skuDirect?.crease_size_3
    )

    const creaseType = pickText(
      item?.creasingType, item?.creaseType, item?.creasing_type, item?.crease_type,
      itemData?.creasingType, itemData?.creaseType, itemData?.creasing_type, itemData?.crease_type,
      r?.creasingType, r?.creaseType,
      data?.creasingType, data?.creaseType,
      meta?.creasingType, meta?.creaseType,
      brief?.creasingType, brief?.creaseType,
      product?.creasingType, product?.creaseType,
      first?.creasingType, first?.creaseType,
      firstData?.creasingType, firstData?.creaseType,
      skuFromIndex?.creasingType, skuFromIndex?.creaseType, skuFromIndex?.creasing_type, skuFromIndex?.crease_type,
      skuDirect?.creasingType, skuDirect?.creaseType, skuDirect?.creasing_type, skuDirect?.crease_type
    )

    const pressLine = pickText(
      r?.crease, r?.creaseText, r?.crease_text,
      item?.pressLine, item?.press_line,
      item?.creasingSize, item?.creaseSize, item?.pressLineSize, item?.press_line_size,
      itemData?.pressLine, itemData?.press_line,
      itemData?.creasingSize, itemData?.creaseSize, itemData?.pressLineSize, itemData?.press_line_size,
      r?.pressLine, r?.press_line,
      data?.pressLine, data?.press_line,
      meta?.pressLine, meta?.press_line,
      brief?.pressLine, brief?.press_line,
      product?.pressLine, product?.press_line,
      first?.pressLine, first?.press_line,
      firstData?.pressLine, firstData?.press_line,
      r?.creasingSize, r?.creaseSize, r?.pressLineSize, r?.press_line_size,
      data?.creasingSize, data?.creaseSize, data?.pressLineSize, data?.press_line_size,
      meta?.creasingSize, meta?.creaseSize, meta?.pressLineSize, meta?.press_line_size,
      brief?.creasingSize, brief?.creaseSize, brief?.pressLineSize, brief?.press_line_size,
      product?.creasingSize, product?.creaseSize, product?.pressLineSize, product?.press_line_size,
      first?.creasingSize, first?.creaseSize, first?.pressLineSize, first?.press_line_size,
      firstData?.creasingSize, firstData?.creaseSize, firstData?.pressLineSize, firstData?.press_line_size,
      skuFromIndex?.pressLine, skuFromIndex?.press_line,
      skuFromIndex?.creasingSize, skuFromIndex?.creaseSize, skuFromIndex?.pressLineSize, skuFromIndex?.press_line_size,
      skuDirect?.pressLine, skuDirect?.press_line,
      skuDirect?.creasingSize, skuDirect?.creaseSize, skuDirect?.pressLineSize, skuDirect?.press_line_size
    )

    const crease = (() => {
      const extractNums = (txt) => (String(txt ?? '').match(/-?\d+(\.\d+)?/g) || [])
        .map(Number)
        .filter((n) => Number.isFinite(n) && n > 0)
      const parts = [...extractNums(c1Text), ...extractNums(c2Text), ...extractNums(c3Text)]
      const hasNums = parts.length > 0

      if (pressLine) {
        const pressText = String(pressLine)
        const nums = (pressText.match(/-?\d+(\.\d+)?/g) || []).map(Number).filter((n) => Number.isFinite(n) && n > 0)
        const typeMatch = String(pressLine).match(/[（(]([^（）()]+)[）)]/)
        const t = normalizeText(typeMatch ? typeMatch[1] : '')
        if (nums.length >= 1) {
          const base = `${nums.join('-')}${t ? ` (${t})` : ''}`
          return /mm/i.test(pressText) ? base : `${base}mm`
        }
        return pressLine
      }

      if (!hasNums && !creaseType) return '-'
      if (!hasNums) return creaseType || '-'
      if (!parts.length) return creaseType || '-'
      return `${parts.join('-')}${creaseType ? ` (${creaseType})` : ''}mm`
    })()


    const quantity = toNum(pickText(item?.quantity, itemData?.quantity, r?.quantity, data?.quantity, meta?.quantity, brief?.quantity, first?.quantity, firstData?.quantity))
    const sheetCount = toNum(pickText(
      item?.sheetCount, item?.sheet_count,
      itemData?.sheetCount, itemData?.sheet_count,
      r?.sheetCount, r?.sheet_count,
      data?.sheetCount, data?.sheet_count,
      first?.sheetCount, first?.sheet_count
    ))
    const goodsName = pickText(
      item?.goodsName, item?.goods_name, item?.productTitle, item?.product_title, item?.title, item?.productName, item?.product_name,
      itemData?.goodsName, itemData?.goods_name, itemData?.productTitle, itemData?.product_title, itemData?.title, itemData?.productName, itemData?.product_name,
      r?.goodsName, r?.goods_name, r?.productTitle, r?.product_title, r?.title,
      r?.productName, r?.product_name,
      data?.goodsName, data?.goods_name, data?.productTitle, data?.product_title, data?.title,
      data?.productName, data?.product_name,
      first?.goodsName, first?.goods_name, first?.title, first?.productName, first?.product_name,
      firstData?.goodsName, firstData?.goods_name, firstData?.title, firstData?.productName, firstData?.product_name,
      '-'
    )
    const notesText = pickText(
      item?.notes, item?.note, item?.remark, item?.remarks, item?.memo, item?.comment, item?.comments, item?.description,
      itemData?.notes, itemData?.note, itemData?.remark, itemData?.remarks, itemData?.memo, itemData?.comment, itemData?.comments, itemData?.description,
      r?.notes, r?.note, r?.remark, r?.remarks, r?.memo, r?.comment, r?.comments, r?.description,
      data?.notes, data?.note, data?.remark, data?.remarks, data?.memo, data?.comment, data?.comments, data?.description,
      brief?.notes, brief?.note, brief?.remark, brief?.remarks, brief?.memo,
      meta?.notes, meta?.note, meta?.remark, meta?.remarks, meta?.memo,
      skuFromIndex?.notes, skuFromIndex?.note, skuFromIndex?.remark, skuFromIndex?.remarks, skuFromIndex?.memo, skuFromIndex?.comment, skuFromIndex?.comments, skuFromIndex?.description,
      skuDirect?.notes, skuDirect?.note, skuDirect?.remark, skuDirect?.remarks, skuDirect?.memo, skuDirect?.comment, skuDirect?.comments, skuDirect?.description
    )
    const joinMethodPicked = pickText(
      item?.joinMethod, item?.join_method,
      item?.joinWay, item?.join_way,
      item?.spliceMethod, item?.splice_method,
      item?.splicingMethod, item?.splicing_method,
      item?.connectMethod, item?.connect_method,
      itemData?.joinMethod, itemData?.join_method,
      itemData?.joinWay, itemData?.join_way,
      itemData?.spliceMethod, itemData?.splice_method,
      itemData?.splicingMethod, itemData?.splicing_method,
      itemData?.connectMethod, itemData?.connect_method,
      r?.joinMethod, r?.join_method,
      r?.joinWay, r?.join_way,
      r?.spliceMethod, r?.splice_method,
      r?.splicingMethod, r?.splicing_method,
      r?.connectMethod, r?.connect_method,
      data?.joinMethod, data?.join_method,
      data?.joinWay, data?.join_way,
      data?.spliceMethod, data?.splice_method,
      data?.splicingMethod, data?.splicing_method,
      data?.connectMethod, data?.connect_method,
      product?.joinMethod, product?.join_method,
      product?.joinWay, product?.join_way,
      product?.spliceMethod, product?.splice_method,
      product?.splicingMethod, product?.splicing_method,
      product?.connectMethod, product?.connect_method,
      first?.joinMethod, first?.join_method,
      first?.joinWay, first?.join_way,
      first?.spliceMethod, first?.splice_method,
      first?.splicingMethod, first?.splicing_method,
      first?.connectMethod, first?.connect_method,
      firstData?.joinMethod, firstData?.join_method,
      firstData?.joinWay, firstData?.join_way,
      firstData?.spliceMethod, firstData?.splice_method,
      firstData?.splicingMethod, firstData?.splicing_method,
      firstData?.connectMethod, firstData?.connect_method,
      meta?.joinMethod, meta?.join_method,
      meta?.joinWay, meta?.join_way,
      meta?.spliceMethod, meta?.splice_method,
      meta?.splicingMethod, meta?.splicing_method,
      meta?.connectMethod, meta?.connect_method,
      brief?.joinMethod, brief?.join_method,
      brief?.joinWay, brief?.join_way,
      brief?.spliceMethod, brief?.splice_method,
      brief?.splicingMethod, brief?.splicing_method,
      brief?.connectMethod, brief?.connect_method,
      skuFromIndex?.joinMethod, skuFromIndex?.join_method,
      skuFromIndex?.joinWay, skuFromIndex?.join_way,
      skuFromIndex?.spliceMethod, skuFromIndex?.splice_method,
      skuFromIndex?.splicingMethod, skuFromIndex?.splicing_method,
      skuFromIndex?.connectMethod, skuFromIndex?.connect_method,
      skuDirect?.joinMethod, skuDirect?.join_method,
      skuDirect?.joinWay, skuDirect?.join_way,
      skuDirect?.spliceMethod, skuDirect?.splice_method,
      skuDirect?.splicingMethod, skuDirect?.splicing_method,
      skuDirect?.connectMethod, skuDirect?.connect_method
    )
    const joinFromNotes = (() => {
      const s = normalizeText(notesText)
      if (!s) return ''
      const m =
        s.match(/(?:拼接方式|拼接)\s*[:：-]\s*([^\s，,；;。]+)/) ||
        s.match(/(?:join\s*method|splice\s*method)\s*[:：-]\s*([^\s，,；;。]+)/i)
      return normalizeText(m ? m[1] : '')
    })()
    const joinMethod = joinMethodPicked || joinFromNotes

    const categoryDisplay = getCategoryDisplay(r)

    return {
      orderNo,
      customerNameDisplay,
      specText,
      sizeText,
      materialText,
      materialNoDisplay,
      crease,
      quantity,
      sheetCount: sheetCount || quantity,
      goodsName,
      joinMethod,
      notesText,
      qrUrl: qrMap[orderNo] || '',
      categoryDisplay
    }
  }

  const getRowOrderId = (r) => normalizeId(
    r?._id ??
    r?.id ??
    r?.key ??
    r?.data?._id ??
    r?.data?.id ??
    r?.data?.key
  )

  const getRowStatusRaw = (r) => pickText(
    r?.status,
    r?.data?.status,
    r?.meta?.status
  )

  const markRowsPendingOnPrint = async () => {
    const targets = []
    const seen = new Set()
    ;(Array.isArray(rows) ? rows : []).forEach((r) => {
      const id = getRowOrderId(r)
      if (!id) return
      const raw = String(getRowStatusRaw(r) || '').trim()
      const s = raw.toLowerCase()
      const isOrdered = s === 'ordered' || raw === '已下单'
      if (!isOrdered) return
      if (seen.has(id)) return
      seen.add(id)
      targets.push(id)
    })

    if (!targets.length) return

    const msgKey = 'workorder-print-mark-pending'
    message.loading({ content: '正在更新订单状态...', key: msgKey, duration: 0 })
    try {
      await Promise.all(
        targets.map((id) => orderAPI.updateOrder(id, { status: 'pending' }).catch(() => undefined))
      )
      setRows((prev) => {
        if (!Array.isArray(prev) || !prev.length) return prev
        return prev.map((r) => {
          const id = getRowOrderId(r)
          if (!id || !seen.has(id)) return r
          return { ...r, status: 'pending' }
        })
      })
    } finally {
      message.destroy(msgKey)
    }
  }

  const handleRefresh = async () => {
    if (!Array.isArray(rows) || !rows.length) return
    const msgKey = 'workorder-print-refresh'
    setRefreshing(true)
    message.loading({ content: '正在刷新订单信息...', key: msgKey, duration: 0 })
    try {
      try { inflightSkuRef.current.clear() } catch (_) { void 0 }
      try { inflightOrderRef.current.clear() } catch (_) { void 0 }
      setSkuIndexByCustomerId(new Map())
      setQrMap({})

      const mergeOrder = (base, fetched) => {
        const b = base && typeof base === 'object' ? base : {}
        const f = fetched && typeof fetched === 'object' ? fetched : {}
        const next = { ...b, ...f }
        const bData = b?.data && typeof b.data === 'object' ? b.data : null
        const fData = f?.data && typeof f.data === 'object' ? f.data : null
        const bMeta = b?.meta && typeof b.meta === 'object' ? b.meta : null
        const fMeta = f?.meta && typeof f.meta === 'object' ? f.meta : null
        if (bData || fData) next.data = { ...(bData || {}), ...(fData || {}) }
        if (bMeta || fMeta) next.meta = { ...(bMeta || {}), ...(fMeta || {}) }
        const fItems =
          Array.isArray(f?.items) ? f.items
            : Array.isArray(f?.data?.items) ? f.data.items
              : Array.isArray(f?.data?.data?.items) ? f.data.data.items
                : Array.isArray(f?.meta?.items) ? f.meta.items
                  : []
        if (Array.isArray(fItems) && fItems.length) next.items = fItems
        delete next.__creaseHydrateTried
        return next
      }

      const fetchDetailForRow = async (row) => {
        if (!row || typeof row !== 'object') return null
        const orderId = normalizeId(row?._id ?? row?.id ?? row?.key)
        const orderNo = getOrderNo(row)
        let fetched = null
        const isChildNo = orderNo && /-\d+$/.test(String(orderNo))
        if (!fetched && isChildNo) {
          try {
            const m = String(orderNo).match(/^(.*)-(\d+)$/)
            const parentNo = m ? String(m[1] || '').trim() : ''
            const idx = m ? (Number(m[2]) - 1) : -1
            if (parentNo) {
              const groupRes = await orderAPI.getOrderGroup(parentNo)
              const body = groupRes?.data ?? groupRes
              const payload = body?.data ?? body
              const group = payload?.data ?? payload
              const parentDoc = group?.parent && typeof group.parent === 'object' ? group.parent : null
              const children = Array.isArray(group?.children) ? group.children : []
              const childDoc =
                children.find((c) => String(c?.orderNo || c?.orderNumber || c?.subOrderNo || c?.subOrderNumber || '').trim() === String(orderNo)) ||
                (Number.isFinite(idx) && idx >= 0 && idx < children.length ? children[idx] : null) ||
                null
              if (parentDoc && typeof parentDoc === 'object') {
                const base = { ...parentDoc }
                if (Array.isArray(parentDoc?.items)) base.items = parentDoc.items
                if (Number.isFinite(idx) && idx >= 0) base.__itemIndex = idx
                base.__parentOrderId = normalizeId(parentDoc?._id ?? parentDoc?.id)
                if (childDoc && typeof childDoc === 'object') fetched = { ...base, ...childDoc }
                else fetched = base
              }
            }
          } catch (_) { void 0 }
        }
        if (!fetched && orderId) {
          try {
            fetched = unwrapOrderDetailResponse(await orderAPI.getOrder(orderId))
          } catch (_) { void 0 }
        }
        if (!fetched && orderNo) {
          try {
            const resp = await orderAPI.getOrders({ search: orderNo, page: 1, pageSize: 30, orderBy: 'createdAt_desc', excludeOrderType: 'purchase' })
            const list = Array.isArray(resp) ? resp : Array.isArray(resp?.data) ? resp.data : Array.isArray(resp?.data?.orders) ? resp.data.orders : []
            fetched = list.find((x) => String(x?.orderNo || x?.orderNumber || '') === String(orderNo)) || list[0] || null
          } catch (_) { void 0 }
        }
        return fetched
      }

      const nextRows = []
      for (const r of rows) {
        const fetched = await fetchDetailForRow(r)
        nextRows.push(fetched ? mergeOrder(r, fetched) : mergeOrder(r, null))
      }
      setRows(nextRows)
      message.success({ content: '刷新完成', key: msgKey, duration: 1 })
    } finally {
      message.destroy(msgKey)
      setRefreshing(false)
    }
  }

  const handlePrint = async () => {
    if (!rows.length) return
    try {
      await markRowsPendingOnPrint()
      const pagesEl = pagesRef.current
      if (!pagesEl) {
        window.print()
        return
      }

      const iframe = document.createElement('iframe')
      iframe.setAttribute('aria-hidden', 'true')
      iframe.style.position = 'fixed'
      iframe.style.right = '0'
      iframe.style.bottom = '0'
      iframe.style.width = '0'
      iframe.style.height = '0'
      iframe.style.border = '0'
      document.body.appendChild(iframe)

      const ticketW = ticketSize.width
      const ticketH = ticketSize.height
      const paperW = paperSizeForPrint.width
      const paperH = paperSizeForPrint.height
      const padX = paddingXmm
      const padY = paddingYmm
      const thW = thWidthMm
      const css = `
        @page { size: ${paperW} ${paperH}; margin: 0; }
        html, body { margin: 0; padding: 0; }
        body { background: #fff; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .print-root {
          width: ${ticketW};
          position: relative;
          top: ${topOffsetMm}mm;
          left: ${leftOffsetMm}mm;
          transform: scale(${scaleNum});
          transform-origin: top left;
        }
        .workorder-pages { display: flex; flex-direction: column; gap: 0; }
        .workorder-page {
          width: ${ticketW};
          height: ${ticketH};
          background: #fff;
          padding: ${padY}mm ${padX}mm;
          box-sizing: border-box;
          display: flex;
          flex-direction: column;
          overflow: hidden;
          page-break-after: always;
          break-after: page;
          break-inside: avoid;
          page-break-inside: avoid;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "PingFang SC", "Microsoft YaHei", sans-serif;
        }
        .workorder-page:last-child { page-break-after: auto; break-after: auto; }
        .workorder-header { border-bottom: 2px solid #000; padding-bottom: 1mm; margin-bottom: 1mm; text-align: left; }
        .workorder-title { font-size: ${titlePx}px; font-weight: 700; margin-bottom: 1mm; text-align: center; }
        .workorder-order { font-size: ${orderPx}px; color: #374151; font-weight: 700; }
        .workorder-body { flex: 1 1 auto; display: block; font-size: ${bodyPx}px; color: #111827; overflow: hidden; }
        .workorder-table { width: 100%; border-collapse: collapse; table-layout: fixed; font-size: inherit; }
        .workorder-table th, .workorder-table td {
          border: 1px solid #d1d5db;
          padding: ${tableCellPadding};
          line-height: ${tableLineHeight};
          vertical-align: top;
          word-break: break-all;
          overflow-wrap: anywhere;
        }
        .workorder-table th { background: #f3f4f6; text-align: left; width: ${thW}mm; white-space: nowrap; font-weight: 700; }
        .workorder-table td { font-weight: 600; }
        .workorder-qr { margin-top: auto; display: flex; justify-content: center; align-items: center; padding-top: 0; flex-direction: column; }
        .workorder-qr-label { font-size: ${qrLabelPx}px; font-weight: 700; margin-bottom: ${qrLabelMarginBottomMm}mm; line-height: 1.2; }
        .workorder-qr img { width: ${qrSizeMm}mm; height: ${qrSizeMm}mm; display: block; }
      `

      const cleanup = () => {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe)
      }

      const html = `<!doctype html><html><head><meta charset="utf-8"/><title>print</title><style>${css}</style></head><body><div class="print-root">${pagesEl.outerHTML}</div></body></html>`

      iframe.onload = async () => {
        const doc = iframe.contentDocument
        const win = iframe.contentWindow
        if (!doc || !win) {
          cleanup()
          window.print()
          return
        }

        const waitImages = () => new Promise((resolve) => {
          const imgs = Array.from(doc.images || [])
          if (!imgs.length) return resolve()
          let done = 0
          const finish = () => {
            done += 1
            if (done >= imgs.length) resolve()
          }
          imgs.forEach((img) => {
            if (img.complete) finish()
            else {
              img.addEventListener('load', finish, { once: true })
              img.addEventListener('error', finish, { once: true })
            }
          })
          setTimeout(resolve, 800)
        })

        await waitImages()
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))

        win.onafterprint = cleanup
        win.focus()
        win.print()
        setTimeout(cleanup, 2000)
      }

      iframe.srcdoc = html
    } catch (e) {
      message.error('打印失败')
    }
  }

  const ticketSize = paperSize === '80x140'
    ? { width: '80mm', height: '140mm', heightMm: 140 }
    : { width: '80mm', height: '180mm', heightMm: 180 }

  const paperSizeForPrint = (() => {
    const mode = String(printPaperMode || 'ticket').toLowerCase()
    if (mode === 'a4') return { width: '210mm', height: '297mm' }
    return { width: ticketSize.width, height: ticketSize.height }
  })()

  const topOffsetMm = (() => {
    const n = Number(printTopOffsetMm)
    return Number.isFinite(n) ? n : 0
  })()

  const leftOffsetMm = (() => {
    const n = Number(printLeftOffsetMm)
    return Number.isFinite(n) ? n : 0
  })()

  const scaleNum = (() => {
    const n = Number(printScale)
    if (!Number.isFinite(n)) return 1
    return Math.max(0.6, Math.min(1.4, n))
  })()

  const fontScaleNum = (() => {
    const n = Number(fontScale)
    if (!Number.isFinite(n)) return 1
    return Math.max(0.7, Math.min(1.6, n))
  })()

  const paddingXmm = (() => {
    const n = Number(pagePaddingXmm)
    if (!Number.isFinite(n)) return 4
    return Math.max(0, Math.min(20, n))
  })()

  const paddingYmm = (() => {
    const n = Number(pagePaddingYmm)
    if (!Number.isFinite(n)) return 2
    return Math.max(0, Math.min(20, n))
  })()

  const thWidthMm = (() => {
    const n = Number(tableHeaderWidthMm)
    if (!Number.isFinite(n)) return 24
    return Math.max(10, Math.min(40, n))
  })()

  const resetLayout = () => {
    setPaperSize('80x180')
    setPrintPaperMode('a4')
    setPrintTopOffsetMm(0)
    setPrintLeftOffsetMm(0)
    setPrintScale(1)
    setFontScale(1)
    setPagePaddingXmm(4)
    setPagePaddingYmm(2)
    setTableHeaderWidthMm(24)
  }

  const layoutPopoverContent = (
    <div style={{ width: 320 }}>
      <div style={{ marginBottom: 10, color: '#6b7280' }}>
        如果其他电脑打印页头空白很大，通常是驱动按A4居中打印导致，可先切换“打印纸张”为 A4 兼容模式
      </div>
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <Space size={6} style={{ width: '100%', justifyContent: 'space-between' }}>
          <span>打印纸张</span>
          <Select
            style={{ width: 190 }}
            value={String(printPaperMode || 'ticket')}
            onChange={setPrintPaperMode}
            options={[
              { value: 'ticket', label: '票据纸(80mm)' },
              { value: 'a4', label: 'A4兼容(避免页头空白)' }
            ]}
          />
        </Space>
        <Space size={6} style={{ width: '100%', justifyContent: 'space-between' }}>
          <span>上边距</span>
          <Space size={6}>
            <InputNumber
              style={{ width: 110 }}
              value={topOffsetMm}
              min={-100}
              max={100}
              step={1}
              onChange={(v) => {
                const n = Number(v)
                setPrintTopOffsetMm(Number.isFinite(n) ? n : 0)
              }}
            />
            <span>mm</span>
          </Space>
        </Space>
        <Space size={6} style={{ width: '100%', justifyContent: 'space-between' }}>
          <span>左边距</span>
          <Space size={6}>
            <InputNumber
              style={{ width: 110 }}
              value={leftOffsetMm}
              min={-100}
              max={100}
              step={1}
              onChange={(v) => {
                const n = Number(v)
                setPrintLeftOffsetMm(Number.isFinite(n) ? n : 0)
              }}
            />
            <span>mm</span>
          </Space>
        </Space>
        <Space size={6} style={{ width: '100%', justifyContent: 'space-between' }}>
          <span>打印缩放</span>
          <Space size={6}>
            <InputNumber
              style={{ width: 110 }}
              value={Math.round(scaleNum * 100)}
              min={60}
              max={140}
              step={1}
              onChange={(v) => {
                const n = Number(v)
                setPrintScale(Number.isFinite(n) ? n / 100 : 1)
              }}
            />
            <span>%</span>
          </Space>
        </Space>
        <Space size={6} style={{ width: '100%', justifyContent: 'space-between' }}>
          <span>字体缩放</span>
          <Space size={6}>
            <InputNumber
              style={{ width: 110 }}
              value={Math.round(fontScaleNum * 100)}
              min={70}
              max={160}
              step={1}
              onChange={(v) => {
                const n = Number(v)
                setFontScale(Number.isFinite(n) ? n / 100 : 1)
              }}
            />
            <span>%</span>
          </Space>
        </Space>
        <Space size={6} style={{ width: '100%', justifyContent: 'space-between' }}>
          <span>内边距(左右)</span>
          <Space size={6}>
            <InputNumber
              style={{ width: 110 }}
              value={paddingXmm}
              min={0}
              max={20}
              step={0.5}
              onChange={(v) => {
                const n = Number(v)
                setPagePaddingXmm(Number.isFinite(n) ? n : 4)
              }}
            />
            <span>mm</span>
          </Space>
        </Space>
        <Space size={6} style={{ width: '100%', justifyContent: 'space-between' }}>
          <span>内边距(上下)</span>
          <Space size={6}>
            <InputNumber
              style={{ width: 110 }}
              value={paddingYmm}
              min={0}
              max={20}
              step={0.5}
              onChange={(v) => {
                const n = Number(v)
                setPagePaddingYmm(Number.isFinite(n) ? n : 2)
              }}
            />
            <span>mm</span>
          </Space>
        </Space>
        <Space size={6} style={{ width: '100%', justifyContent: 'space-between' }}>
          <span>表头宽度</span>
          <Space size={6}>
            <InputNumber
              style={{ width: 110 }}
              value={thWidthMm}
              min={10}
              max={40}
              step={1}
              onChange={(v) => {
                const n = Number(v)
                setTableHeaderWidthMm(Number.isFinite(n) ? n : 24)
              }}
            />
            <span>mm</span>
          </Space>
        </Space>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Button onClick={resetLayout}>重置默认</Button>
          <div style={{ color: '#9ca3af' }}>已自动保存到本机</div>
        </Space>
      </Space>
    </div>
  )

  const titlePx = Math.round((ticketSize.heightMm <= 140 ? 22 : 24) * fontScaleNum)
  const orderPx = Math.round((ticketSize.heightMm <= 140 ? 16 : 18) * fontScaleNum)
  const bodyPx = Math.round((ticketSize.heightMm <= 140 ? 14 : 16) * fontScaleNum)
  const qrLabelPx = Math.round((ticketSize.heightMm <= 140 ? 14 : 16) * fontScaleNum)
  const isShortTicket = ticketSize.heightMm <= 140
  const tableCellPadding = isShortTicket ? '2px 3px' : '3px 4px'
  const tableLineHeight = isShortTicket ? 1.32 : 1.45
  const qrSizeMm = isShortTicket ? 34 : 46
  const qrLabelMarginBottomMm = isShortTicket ? 0.3 : 0.5

  const previewStyles = `
    @page {
      size: ${paperSizeForPrint.width} ${paperSizeForPrint.height};
      margin: 0;
    }
    html,
    body {
      margin: 0;
      padding: 0;
    }
    .workorder-screen-root {
      padding: 16px;
    }
    .workorder-preview-root {
      display: flex;
      justify-content: center;
      background: #f3f4f6;
      padding: 24px;
      min-height: 400px;
    }
    .workorder-pages {
      display: flex;
      flex-direction: column;
      gap: 16px;
      transform: translate(${leftOffsetMm}mm, ${topOffsetMm}mm) scale(${scaleNum});
      transform-origin: top left;
    }
    .workorder-page {
      width: ${ticketSize.width};
      height: ${ticketSize.height};
      background: white;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      padding: ${paddingYmm}mm ${paddingXmm}mm;
      box-sizing: border-box;
      display: flex;
      flex-direction: column;
      overflow: hidden;
      border: 1px solid #e5e7eb;
    }
    .workorder-header {
      border-bottom: 2px solid #000;
      padding-bottom: 1mm;
      margin-bottom: 1mm;
      text-align: left;
    }
    .workorder-title {
      font-size: ${titlePx}px;
      font-weight: 700;
      margin-bottom: 1mm;
      text-align: center;
    }
    .workorder-order {
      font-size: ${orderPx}px;
      color: #374151;
      font-weight: 700;
    }
    .workorder-body {
      flex: 1 1 auto;
      display: block;
      font-size: ${bodyPx}px;
      color: #111827;
      overflow: hidden;
    }
    .workorder-table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: inherit;
    }
    .workorder-table th,
    .workorder-table td {
      border: 1px solid #d1d5db;
      padding: ${tableCellPadding};
      line-height: ${tableLineHeight};
      vertical-align: top;
      word-break: break-all;
      overflow-wrap: anywhere;
    }
    .workorder-table th {
      background: #f3f4f6;
      text-align: left;
      width: ${thWidthMm}mm;
      white-space: nowrap;
      font-weight: 700;
    }
    .workorder-table td {
      font-weight: 600;
    }
    .workorder-qr {
      margin-top: auto;
      display: flex;
      justify-content: center;
      align-items: center;
      padding-top: 0;
      flex-direction: column;
      align-items: center;
    }
    .workorder-qr-label {
      font-size: ${qrLabelPx}px;
      font-weight: 700;
      margin-bottom: ${qrLabelMarginBottomMm}mm;
      line-height: 1.2;
    }
    .workorder-qr img {
      width: ${qrSizeMm}mm;
      height: ${qrSizeMm}mm;
      display: block;
    }
    @media print {
      html,
      body {
        margin: 0 !important;
        padding: 0 !important;
      }
      body {
        margin: 0 !important;
        background: #fff !important;
      }
      body * {
        visibility: hidden;
      }
      .workorder-screen-root,
      .workorder-screen-root * {
        visibility: visible;
      }
      .workorder-screen-root {
        position: absolute;
        left: var(--workorder-print-left-offset, 0mm);
        top: var(--workorder-print-top-offset, 0mm);
        transform: scale(var(--workorder-print-scale, 1));
        transform-origin: top left;
        width: ${ticketSize.width};
      }
      .workorder-screen-root {
        padding: 0 !important;
        margin: 0 !important;
      }
      .workorder-toolbar {
        display: none !important;
      }
      .ant-card {
        border: 0 !important;
      }
      .ant-card-body {
        padding: 0 !important;
      }
      .workorder-preview-root {
        padding: 0 !important;
        background: #fff !important;
        justify-content: flex-start !important;
      }
      .workorder-pages {
        gap: 0 !important;
        transform: none !important;
      }
      .workorder-pages > .workorder-page {
        box-shadow: none !important;
        border: 0 !important;
        margin-top: 0 !important;
        page-break-after: always;
        break-after: page;
      }
      .workorder-pages > .workorder-page:last-child {
        page-break-after: auto !important;
        break-after: auto !important;
      }
    }
  `

  return (
    <div
      className="workorder-screen-root"
      style={{
        '--workorder-print-top-offset': `${topOffsetMm}mm`,
        '--workorder-print-left-offset': `${leftOffsetMm}mm`,
        '--workorder-print-scale': String(scaleNum)
      }}
    >
      <div className="workorder-toolbar" style={{ marginBottom: 16 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Button type="primary" onClick={handlePrint} disabled={!rows.length}>
              打印
            </Button>
            <Button onClick={handleRefresh} disabled={!rows.length} loading={refreshing}>
              刷新
            </Button>
            <Button onClick={() => navigate(-1)}>返回</Button>
            <Select
              style={{ width: 160 }}
              value={paperSize}
              onChange={setPaperSize}
              options={[
                { value: '80x140', label: '80×140mm' },
                { value: '80x180', label: '80×180mm' }
              ]}
            />
            <Select
              style={{ width: 210 }}
              value={String(printPaperMode || 'ticket')}
              onChange={setPrintPaperMode}
              options={[
                { value: 'ticket', label: '票据纸(80mm)' },
                { value: 'a4', label: 'A4兼容(避免页头空白)' }
              ]}
            />
            <Popover placement="bottomLeft" content={layoutPopoverContent} trigger="click">
              <Button>版式调节</Button>
            </Popover>
          </Space>
          <div style={{ color: '#6b7280' }}>{`已选择 ${rows.length} 个订单`}</div>
        </Space>
      </div>
      <Card>
        <div className="workorder-preview-root">
          <style>{previewStyles}</style>
          <div className="workorder-pages" ref={pagesRef}>
            {rows.map((r, idx) => {
              const resolved = resolveRow(r)
              const notesText = normalizeText(resolved.notesText)
              const categoryDisplay = resolved.categoryDisplay || '-'
              return (
                <div
                  key={r.key || r._id || r.id || `page_${idx}`}
                  className="workorder-page"
                >
                  <div className="workorder-header">
                    <div className="workorder-title">施工单</div>
                    <div className="workorder-order">订单号：{resolved.orderNo || ''}</div>
                  </div>
                  <div className="workorder-body">
                    <table className="workorder-table">
                      <tbody>
                        <tr>
                          <th>客户</th>
                          <td>{resolved.customerNameDisplay || '-'}</td>
                        </tr>
                        <tr>
                          <th>产品</th>
                          <td>{categoryDisplay}</td>
                        </tr>
                        <tr>
                          <th>规格</th>
                          <td>{resolved.specText || '-'}</td>
                        </tr>
                        <tr>
                          <th>纸板尺寸</th>
                          <td>{resolved.sizeText || '-'}</td>
                        </tr>
                        <tr>
                          <th>压线尺寸</th>
                          <td>{resolved.crease || '-'}</td>
                        </tr>
                        <tr>
                          <th>材质/楞别</th>
                          <td>{resolved.materialText || '-'}</td>
                        </tr>
                        <tr>
                          <th>数量</th>
                          <td>{resolved.quantity || 0}</td>
                        </tr>
                        <tr>
                          <th>下单片数</th>
                          <td>{resolved.sheetCount || 0}</td>
                        </tr>
                        <tr>
                          <th>拼接方式</th>
                          <td>{resolved.joinMethod || '-'}</td>
                        </tr>
                        <tr>
                          <th>物料号</th>
                          <td>{resolved.materialNoDisplay || '-'}</td>
                        </tr>
                        <tr>
                          <th>商品名称</th>
                          <td>{resolved.goodsName || '-'}</td>
                        </tr>
                        <tr>
                          <th>订单备注</th>
                          <td>{notesText || '-'}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="workorder-qr">
                    {resolved.qrUrl ? (
                      <>
                        <div className="workorder-qr-label">订单二维码：</div>
                        <img src={resolved.qrUrl} alt="订单二维码" />
                      </>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </Card>
    </div>
  )
}

export default WorkOrderPrintPreview
