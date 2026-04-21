import React, { useEffect, useMemo, useRef, useState } from 'react'
import { App, Button, Card, Col, ConfigProvider, Descriptions, Image as AntImage, Input, Modal, Row, Select, Space, Spin, Table, Tag } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import zhCN from 'antd/locale/zh_CN'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import { customerSkuAPI, orderAPI, purchaseAPI } from '../services/api'
import { looksLikeOrderNo } from '../utils'
import { calcCreaseFromSku, parseCreaseText, resolveBoardPurchaseCrease } from '../utils/crease'

function BoardPurchasePreview() {
  const { message, modal } = App.useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const purchaseOrder = location.state?.purchaseOrder
  const isFromPurchaseOrder = Boolean(purchaseOrder)
  const isFromInventory = Boolean(
    location.state?.fromInventory ||
    location.state?.entry === 'inventory' ||
    String(location.pathname || '').startsWith('/inventory')
  )
  const rows = useMemo(() => (Array.isArray(location.state?.rows) ? location.state.rows : []), [location.state?.rows])
  const createdRef = useRef(false)
  const reconstructedRef = useRef(false)

  const [purchaseOrderDetail, setPurchaseOrderDetail] = useState()
  const [orderBriefLoadingKey, setOrderBriefLoadingKey] = useState('')
  const [orderBriefCache, setOrderBriefCache] = useState(() => new Map())
  const [relatedDetailOpen, setRelatedDetailOpen] = useState(false)
  const [relatedDetailLoading, setRelatedDetailLoading] = useState(false)
  const [relatedDetailOrder, setRelatedDetailOrder] = useState(null)
  const [relatedDetailRequestedNo, setRelatedDetailRequestedNo] = useState('')
  const [relatedDetailSourceRow, setRelatedDetailSourceRow] = useState(null)
  const relatedDetailReqIdRef = useRef(0)
  const [repairLoading, setRepairLoading] = useState(false)
  const sourceResolvedSigRef = useRef('')

  const [supplierShortName, setSupplierShortName] = useState('')
  const [orderDateText, setOrderDateText] = useState(() => dayjs().format('YYYY年M月D日'))
  const [purchaseOrderNo, setPurchaseOrderNo] = useState('')
  const [reservedId, setReservedId] = useState()
  const [items, setItems] = useState([])
  const [initializedSig, setInitializedSig] = useState('')
  const [modifyOpen, setModifyOpen] = useState(false)
  const [modifyIndex, setModifyIndex] = useState(-1)
  const [candidateOrders, setCandidateOrders] = useState([])
  const [candidateLoading, setCandidateLoading] = useState(false)
  const [candidateKeyword, setCandidateKeyword] = useState('')
  const [candidatePickedId, setCandidatePickedId] = useState('')
  const [candidateLoadedAt, setCandidateLoadedAt] = useState(0)
  const [hydratedOrderCache, setHydratedOrderCache] = useState(() => new Map())
  const [hydratedSkuCache, setHydratedSkuCache] = useState(() => new Map())
  const inflightSkuRef = useRef(new Set())

  const effectivePurchaseOrder = purchaseOrderDetail || purchaseOrder

  const unwrapList = (res) => {
    if (Array.isArray(res?.data)) return res.data
    if (Array.isArray(res?.list)) return res.list
    if (Array.isArray(res?.result?.data)) return res.result.data
    if (Array.isArray(res?.data?.orders)) return res.data.orders
    if (Array.isArray(res?.data?.list)) return res.data.list
    if (Array.isArray(res?.data?.data)) return res.data.data
    if (Array.isArray(res?.orders)) return res.orders
    return []
  }

  const fetchUnpurchasedBoardOrders = async () => {
    const pageSize = 200
    const maxPages = 20
    const all = []
    const cacheBust = Date.now()
    for (let page = 1; page <= maxPages; page += 1) {
      const res = await orderAPI.getOrders({ page, pageSize, excludeOrderType: 'purchase', _ts: cacheBust })
      const rows = unwrapList(res)
      if (rows.length) all.push(...rows)
      if (rows.length < pageSize) break
    }
    const hasBoardSignals = (o) => {
      const items = Array.isArray(o?.items) ? o.items : []
      const first = items[0] || {}
      const isMeaningful = (v) => {
        const s = String(v ?? '').trim()
        if (!s) return false
        return !['-', '—', '--', '---', '暂无', '无', 'null', 'undefined'].includes(s.toLowerCase())
      }
      const fields = [
        o?.materialCode, o?.materialNo, o?.material, o?.flute, o?.fluteType,
        o?.boardWidth, o?.boardHeight, o?.specWidth, o?.specLength,
        o?.creasingType, o?.creasingSize1, o?.creasingSize2, o?.creasingSize3,
        o?.spec, o?.paperSize,
        first?.materialCode, first?.materialNo, first?.material, first?.flute, first?.fluteType,
        first?.boardWidth, first?.boardHeight, first?.specWidth, first?.specLength,
        first?.creasingType, first?.creasingSize1, first?.creasingSize2, first?.creasingSize3,
        first?.spec, first?.paperSize
      ]
      return fields.some((v) => isMeaningful(v))
    }
    const normalized = all
      .filter((o) => {
        const deletedFlag =
          Boolean(o?.isDeleted || o?.is_deleted || o?.deletedAt || o?.deleted_at) ||
          String(o?.deleted || '').toLowerCase() === 'true'
        if (deletedFlag) return false
        const orderType = String(o?.orderType || '').toLowerCase()
        const source = String(o?.source || '').toLowerCase()
        const isPurchase = orderType === 'purchase' || source === 'purchased'
        if (isPurchase) return false
        if (!hasBoardSignals(o)) return false
        const meta = o?.meta && typeof o.meta === 'object' ? o.meta : {}
        const hasPurchase = Boolean(
          o?.purchaseOrderId ||
          o?.purchaseOrderNo ||
          o?.purchase_order_id ||
          o?.purchase_order_no ||
          meta?.purchaseOrderId ||
          meta?.purchaseOrderNo ||
          meta?.purchase_order_id ||
          meta?.purchase_order_no
        )
        return !hasPurchase
      })
      .map((o) => ({
        id: String(o?._id || o?.id || '').trim(),
        orderNo: String(o?.orderNo || o?.orderNumber || '').trim(),
        customerName: String(o?.customerName || o?.customer?.name || '').trim(),
        goodsName: String(o?.goodsName || o?.productTitle || o?.productName || '').trim()
      }))
      .filter((o) => o.id && o.orderNo)
    const uniq = new Map()
    for (const o of normalized) {
      if (!uniq.has(o.id)) uniq.set(o.id, o)
    }
    return Array.from(uniq.values())
  }

  const openModifyAssociation = async (idx) => {
    setModifyIndex(idx)
    setCandidatePickedId('')
    setCandidateKeyword('')
    setModifyOpen(true)
    const now = Date.now()
    const shouldReload = !candidateOrders.length || (candidateLoadedAt > 0 && (now - candidateLoadedAt) > 15000)
    if (shouldReload) {
      setCandidateLoading(true)
      try {
        const list = await fetchUnpurchasedBoardOrders()
        setCandidateOrders(list)
        setCandidateLoadedAt(Date.now())
      } catch (_) {
        message.error('加载订单列表失败')
      } finally {
        setCandidateLoading(false)
      }
    }
  }

  const submitModifyAssociation = async () => {
    const idx = Number(modifyIndex)
    if (!Number.isFinite(idx) || idx < 0) return
    const picked = (candidateOrders || []).find((o) => o.id === candidatePickedId)
    if (!picked) {
      message.warning('请选择要关联的订单号')
      return
    }
    const row = (items || [])[idx] || {}
    const oldOrderNo = String(row.relatedOrderNo || '').trim()
    const oldOrderId = String(row.relatedOrderId || '').trim()
    if ((oldOrderId && picked.id === oldOrderId) || (oldOrderNo && picked.orderNo === oldOrderNo)) {
      message.info('关联未变化')
      setModifyOpen(false)
      return
    }

    modal.confirm({
      title: '确认修改关联',
      content: `将第${idx + 1}行关联订单从「${oldOrderNo || '-'}」修改为「${picked.orderNo}」，确认继续？`,
      onOk: async () => {
        const poId = String(
          effectivePurchaseOrder?._id ||
          effectivePurchaseOrder?.id ||
          effectivePurchaseOrder?.docId ||
          effectivePurchaseOrder?.orderId ||
          effectivePurchaseOrder?.key ||
          ''
        ).trim()
        if (!poId) {
          message.error('缺少采购单ID')
          return
        }
        try {
          const rawVersion = effectivePurchaseOrder?._version
          const expectedVersion = Number.isFinite(Number(rawVersion)) ? Number(rawVersion) : 1
          const res = await purchaseAPI.relinkBoardPurchaseAssociation({
            purchaseOrderId: poId,
            itemIndex: idx,
            oldRelatedOrderId: oldOrderId || undefined,
            oldRelatedOrderNo: oldOrderNo || undefined,
            newOrderId: picked.id,
            newOrderNo: picked.orderNo,
            expectedPurchaseOrderVersion: expectedVersion
          })
          const payload = res?.data ?? res
          const updatedPurchase = payload?.data?.purchaseOrder || payload?.data?.order || payload?.data || payload
          if (updatedPurchase && typeof updatedPurchase === 'object') {
            setPurchaseOrderDetail((prev) => ({
              ...(prev && typeof prev === 'object' ? prev : {}),
              ...(updatedPurchase && typeof updatedPurchase === 'object' ? updatedPurchase : {})
            }))
          }
          setItems((prev) => {
            const base = Array.isArray(prev) ? prev : []
            return base.map((it, i) => {
              if (i !== idx) return it
              return { ...it, relatedOrderId: picked.id, relatedOrderNo: picked.orderNo }
            })
          })
          setCandidateOrders((prev) => {
            const base = Array.isArray(prev) ? prev : []
            return base.filter((o) => String(o?.id || '').trim() !== String(picked.id || '').trim())
          })
          setOrderBriefCache((prev) => {
            const next = new Map(prev || [])
            const oldKey = oldOrderId || oldOrderNo
            const newKey = picked.id || picked.orderNo
            if (oldKey) next.delete(oldKey)
            if (newKey) next.delete(newKey)
            return next
          })
          message.success('关联已更新')
          setModifyOpen(false)
        } catch (e) {
          const msg = e?.response?.data?.message || e?.message || '修改关联失败'
          message.error(msg)
        }
      }
    })
  }

  useEffect(() => {
    if (!isFromPurchaseOrder) return
    const id = String(purchaseOrder?._id || purchaseOrder?.id || purchaseOrder?.docId || purchaseOrder?.orderId || purchaseOrder?.key || '').trim()
    if (!id) return
    const hasItems = Array.isArray(purchaseOrder?.items) && purchaseOrder.items.length > 0
    const hasBoardFields = hasItems && purchaseOrder.items.some((it) => String(it?.materialCode || it?.material || '').trim() || String(it?.flute || '').trim())
    if (hasBoardFields) return
    let mounted = true
    orderAPI.getOrder(id).then((res) => {
      const body = res?.data ?? res
      const order =
        body?.order ??
        body?.data?.order ??
        body?.data?.data ??
        body?.data ??
        body
      if (mounted && order && order?.success !== false) setPurchaseOrderDetail(order)
    }).catch(() => {}).finally(() => {})
    return () => { mounted = false }
  }, [isFromPurchaseOrder, purchaseOrder])

  useEffect(() => {
    if (isFromPurchaseOrder) {
      const candidate = String(effectivePurchaseOrder?.meta?.supplierShortName || effectivePurchaseOrder?.supplierShortName || effectivePurchaseOrder?.supplierName || '').trim()
      if (!supplierShortName && candidate) setSupplierShortName(candidate)
      const dt = String(effectivePurchaseOrder?.meta?.orderDateText || '').trim()
      if (dt) setOrderDateText(dt)
      const poNo = String(effectivePurchaseOrder?.orderNo || effectivePurchaseOrder?.orderNumber || '').trim()
      if (poNo) setPurchaseOrderNo(poNo)
      return
    }

    if (!rows.length) {
      message.info('未选择订单，返回订单管理')
      navigate('/orders', { replace: true })
      return
    }
    const first = rows.find(r => r && r.supplierName) || rows[0]
    const candidate = String(first?.supplierShortName || first?.supplierShort || first?.supplierName || '').trim()
    if (!supplierShortName && candidate) setSupplierShortName(candidate)
  }, [message, navigate, rows, isFromPurchaseOrder, purchaseOrder])

  useEffect(() => {
    if (isFromPurchaseOrder) return
    if (reservedId) return
    const gen = async () => {
      try {
        const res = await orderAPI.getNextOrderNumber()
        const payload = res?.data ?? res
        const no = payload?.orderNumber ?? payload?.orderNo ?? payload?.no
        const rid = payload?.reservationId ?? payload?.rid ?? payload?.id
        if (!purchaseOrderNo && no) {
          setPurchaseOrderNo(no)
        }
        if (rid) setReservedId(rid)
      } catch (_) { /* ignore */ }
    }
    gen()
  }, [reservedId, isFromPurchaseOrder])

  useEffect(() => {
    return () => {
      try {
        if (createdRef.current) return
        if (!isFromPurchaseOrder && (reservedId || purchaseOrderNo)) {
          purchaseAPI.releaseOrderNumber({ reservationId: reservedId, orderNumber: purchaseOrderNo }).catch(() => {})
        }
      } catch (_) { /* ignore */ }
    }
  }, [reservedId, purchaseOrderNo, isFromPurchaseOrder])

  const extractOrderNoToken = (v) => {
    const s = String(v ?? '').trim()
    if (!s) return ''
    const m = s.match(/(QXDD|QXBZ)\d{7,12}(?:-\d+)?/i)
    if (m && m[0]) return String(m[0]).trim()
    return s
  }

  const getRowOrderId = (r) => String(
    r?.orderId ||
    r?.order_id ||
    r?._id ||
    r?.id ||
    r?.docId ||
    r?.doc_id ||
    r?.__parentOrderId ||
    ''
  ).trim()

  const getRowOrderNo = (r) => {
    const candidate = extractOrderNoToken(
      r?.orderNo ||
      r?.orderNumber ||
      r?.order_no ||
      r?.order_number ||
      r?.__parentNo ||
      (typeof r?.key === 'string' ? r.key : '') ||
      ''
    )
    return looksLikeOrderNo(candidate) ? candidate : String(candidate || '').trim()
  }
  const getRowCacheKey = (r) => {
    const no = getRowOrderNo(r)
    const isChild = Boolean(r?.__itemChild) && /-\d+$/.test(String(no || '').trim())
    const parentId = isChild ? String(r?.__parentOrderId || '').trim() : ''
    if (isChild) {
      const cid = getRowOrderId(r)
      if (cid) return `id:${cid}`
      if (no) return `no:${no}`
      if (parentId) return `id:${parentId}`
      return ''
    }
    const id = getRowOrderId(r)
    if (id) return `id:${id}`
    if (no) return `no:${no}`
    return ''
  }

  const normalizeMaybeId = (v) => {
    if (!v) return ''
    if (typeof v === 'string' || typeof v === 'number') return String(v).trim()
    if (typeof v === 'object') return String(v?._id || v?.id || v?.key || '').trim()
    return ''
  }

  const resolveCustomerIdAny = (o) => {
    if (!o || typeof o !== 'object') return ''
    return normalizeMaybeId(
      o.customerId ||
      o.customer_id ||
      o.customer ||
      o.clientId ||
      o.client_id ||
      o.client ||
      o.meta?.customerId ||
      o.meta?.customer_id ||
      o.meta?.customer ||
      o.meta?.brief?.customerId ||
      o.meta?.brief?.customer_id ||
      o.meta?.brief?.customer ||
      o.data?.customerId ||
      o.data?.customer_id ||
      o.data?.customer ||
      ''
    )
  }

  const resolveSkuIdAny = (o) => {
    if (!o || typeof o !== 'object') return ''
    return normalizeMaybeId(
      o.skuId ||
      o.sku_id ||
      o.customerSkuId ||
      o.customer_sku_id ||
      o.customerSku ||
      o.customer_sku ||
      o.sku ||
      o.meta?.skuId ||
      o.meta?.sku_id ||
      o.meta?.customerSkuId ||
      o.meta?.customer_sku_id ||
      o.meta?.customerSku ||
      o.meta?.customer_sku ||
      o.meta?.sku ||
      o.meta?.brief?.skuId ||
      o.meta?.brief?.sku_id ||
      o.meta?.brief?.customerSkuId ||
      o.meta?.brief?.customer_sku_id ||
      o.meta?.brief?.customerSku ||
      o.meta?.brief?.customer_sku ||
      o.meta?.brief?.sku ||
      o.data?.skuId ||
      o.data?.sku_id ||
      o.data?.customerSkuId ||
      o.data?.customer_sku_id ||
      o.data?.customerSku ||
      o.data?.customer_sku ||
      o.data?.sku ||
      ''
    )
  }

  const getSizePair = (o) => {
    if (!o || typeof o !== 'object') return { w: 0, h: 0 }
    const w0 = Number(o.boardWidth ?? o.board_width ?? o.specWidth ?? o.spec_width ?? o.width ?? o.w ?? 0)
    const h0 = Number(o.boardHeight ?? o.board_height ?? o.specLength ?? o.spec_length ?? o.length ?? o.h ?? 0)
    const w = Number.isFinite(w0) && w0 > 0 ? w0 : 0
    const h = Number.isFinite(h0) && h0 > 0 ? h0 : 0
    return { w, h }
  }

  const sameSize = (a, b) => {
    const aw = Number(a?.w || 0)
    const ah = Number(a?.h || 0)
    const bw = Number(b?.w || 0)
    const bh = Number(b?.h || 0)
    if (!aw || !ah || !bw || !bh) return false
    return (aw === bw && ah === bh) || (aw === bh && ah === bw)
  }

  const getRowSkuKey = (r) => {
    const row = (r && typeof r === 'object') ? r : null
    if (!row) return ''
    const hydrated = (row.__hydrated && typeof row.__hydrated === 'object') ? row.__hydrated : null
    const src = hydrated || row
    const rowNo = getRowOrderNo(row)
    const itemsArr = Array.isArray(src?.items) ? src.items : []

    let item0 = null
    let idx = Number(row?.__itemIndex ?? row?.__item_index)
    if (!Number.isFinite(idx) || idx < 0) idx = -1
    if (!Number.isFinite(idx) || idx < 0) {
      const m = String(rowNo || '').match(/-(\d+)$/)
      if (m && m[1]) idx = Number(m[1]) - 1
    }
    if (Number.isFinite(idx) && idx >= 0 && idx < itemsArr.length) item0 = itemsArr[idx]
    if (!item0 && rowNo && itemsArr.length) {
      item0 = itemsArr.find((it) => {
        const itNo = String(it?.orderNo || it?.orderNumber || it?.subOrderNo || it?.subOrderNumber || it?.no || it?.key || '').trim()
        return itNo && itNo === rowNo
      }) || null
    }
    if (!item0 && itemsArr.length) {
      const rowSize = getSizePair(row)
      const found = itemsArr.find((it) => sameSize(rowSize, getSizePair(it)))
      if (found && typeof found === 'object') item0 = found
    }

    const customerId = resolveCustomerIdAny(item0) || resolveCustomerIdAny(src) || resolveCustomerIdAny(row)
    const skuId = resolveSkuIdAny(item0) || resolveSkuIdAny(src) || resolveSkuIdAny(row)
    if (!customerId || !skuId) return ''
    return `${customerId}:${skuId}`
  }

  const effectiveRows = useMemo(() => {
    if (isFromPurchaseOrder) return []
    const list = Array.isArray(rows) ? rows : []
    if (!list.length) return list
    return list.map((r) => {
      const key = getRowCacheKey(r)
      const hydrated = key ? hydratedOrderCache.get(key) : undefined
      const merged = hydrated ? { ...r, __hydrated: hydrated } : r
      const skuKey = getRowSkuKey(merged)
      const skuResolved = skuKey ? hydratedSkuCache.get(skuKey) : undefined
      if (!skuKey && !skuResolved) return merged
      return { ...merged, __skuKey: skuKey || '', __skuResolved: skuResolved }
    })
  }, [rows, hydratedOrderCache, hydratedSkuCache, isFromPurchaseOrder])

  const rowsSig = useMemo(() => {
    if (isFromPurchaseOrder) return ''
    return (effectiveRows || [])
      .map((r) => `${String(r?.key || r?._id || r?.id || '')}:${r?.__hydrated ? '1' : '0'}:${r?.__skuResolved ? '1' : (r?.__skuKey ? 'k' : '0')}`)
      .filter(Boolean)
      .join('|')
  }, [effectiveRows, isFromPurchaseOrder])

  const getItemIndex = (r) => {
    const n = Number(r?.__itemIndex ?? r?.__item_index)
    if (!Number.isFinite(n) || n < 0) return -1
    return n
  }

  const pickItemFrom = (r, itemsArr) => {
    const arr = Array.isArray(itemsArr) ? itemsArr : []
    const idx = getItemIndex(r)
    if (idx >= 0 && idx < arr.length) {
      const v = arr[idx]
      if (v && typeof v === 'object') return v
    }
    const first = arr[0]
    return (first && typeof first === 'object') ? first : undefined
  }

  const getBoardSize = (r) => {
    const product0 = (r?.product && typeof r.product === 'object') ? r.product : undefined
    const meta0 = (r?.meta && typeof r.meta === 'object') ? r.meta : undefined
    const brief0 = (meta0?.brief && typeof meta0.brief === 'object') ? meta0.brief : undefined
    const itemsArr = Array.isArray(r?.items) ? r.items : []
    const item0 = pickItemFrom(r, itemsArr)
    const skuResolved0 = (r?.__skuResolved && typeof r.__skuResolved === 'object') ? r.__skuResolved : null

    const numFrom = (...vals) => {
      for (const v of vals) {
        const n = Number(v)
        if (Number.isFinite(n) && n > 0) return n
      }
      return 0
    }

    const w = numFrom(
      skuResolved0?.boardWidth, skuResolved0?.board_width, skuResolved0?.specWidth, skuResolved0?.spec_width,
      item0?.boardWidth, item0?.board_width, item0?.specWidth, item0?.spec_width,
      product0?.boardWidth, product0?.board_width, product0?.specWidth, product0?.spec_width,
      meta0?.boardWidth, meta0?.board_width, meta0?.specWidth, meta0?.spec_width,
      brief0?.boardWidth, brief0?.board_width, brief0?.specWidth, brief0?.spec_width,
      r?.boardWidth, r?.board_width, r?.specWidth, r?.spec_width
    )
    const h = numFrom(
      skuResolved0?.boardHeight, skuResolved0?.board_height, skuResolved0?.specLength, skuResolved0?.spec_length,
      item0?.boardHeight, item0?.board_height, item0?.specLength, item0?.spec_length,
      product0?.boardHeight, product0?.board_height, product0?.specLength, product0?.spec_length,
      meta0?.boardHeight, meta0?.board_height, meta0?.specLength, meta0?.spec_length,
      brief0?.boardHeight, brief0?.board_height, brief0?.specLength, brief0?.spec_length,
      r?.boardHeight, r?.board_height, r?.specLength, r?.spec_length
    )
    if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
      return { width: w, length: h }
    }
    const fromPaperSize = String(
      skuResolved0?.paperSize ??
      skuResolved0?.paper_size ??
      item0?.paperSize ??
      item0?.paper_size ??
      product0?.paperSize ??
      product0?.paper_size ??
      meta0?.paperSize ??
      meta0?.paper_size ??
      brief0?.paperSize ??
      brief0?.paper_size ??
      r?.paperSize ??
      r?.paper_size ??
      ''
    ).trim()
    const nums1 = fromPaperSize.match(/\d+(?:\.\d+)?/g)
    if (nums1 && nums1.length >= 2) {
      const ww = Number(nums1[0])
      const hh = Number(nums1[1])
      if (Number.isFinite(ww) && Number.isFinite(hh) && ww > 0 && hh > 0) {
        return { width: ww, length: hh }
      }
    }
    const spec = String(
      skuResolved0?.spec ??
      skuResolved0?.specification ??
      item0?.spec ??
      item0?.specification ??
      product0?.spec ??
      product0?.specification ??
      meta0?.spec ??
      meta0?.specification ??
      brief0?.spec ??
      brief0?.specification ??
      r?.spec ??
      r?.specification ??
      ''
    ).trim()
    const nums2 = spec.match(/\d+(?:\.\d+)?/g)
    if (nums2 && nums2.length >= 2) {
      const ww = Number(nums2[0])
      const hh = Number(nums2[1])
      if (Number.isFinite(ww) && Number.isFinite(hh) && ww > 0 && hh > 0) {
        return { width: ww, length: hh }
      }
    }
    return { width: undefined, length: undefined }
  }

  const getCreaseText = (r) => resolveBoardPurchaseCrease(r).spec || ''

  const getCreaseTypeText = (r) => resolveBoardPurchaseCrease(r).type || ''

  const getMaterialCodeText = (r) => {
    const product0 = (r?.product && typeof r.product === 'object') ? r.product : undefined
    const meta0 = (r?.meta && typeof r.meta === 'object') ? r.meta : undefined
    const brief0 = (meta0?.brief && typeof meta0.brief === 'object') ? meta0.brief : undefined
    const itemsArr = Array.isArray(r?.items) ? r.items : []
    const item0 = pickItemFrom(r, itemsArr)
    const skuResolved0 = (r?.__skuResolved && typeof r.__skuResolved === 'object') ? r.__skuResolved : null

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

    const raw = pickText(
      skuResolved0?.materialCode,
      skuResolved0?.material_code,
      skuResolved0?.material,
      item0?.materialCode,
      item0?.material_code,
      item0?.material,
      product0?.materialCode,
      product0?.material_code,
      product0?.material,
      meta0?.materialCode,
      meta0?.material_code,
      meta0?.material,
      brief0?.materialCode,
      brief0?.material_code,
      brief0?.material,
      r?.materialCode,
      r?.material_code,
      r?.material
    )
    if (!raw) {
      const materialNo = pickText(
        skuResolved0?.materialNo,
        skuResolved0?.material_no,
        item0?.materialNo,
        item0?.material_no,
        product0?.materialNo,
        product0?.material_no,
        meta0?.materialNo,
        meta0?.material_no,
        brief0?.materialNo,
        brief0?.material_no,
        r?.materialNo,
        r?.material_no
      )
      if (!materialNo) return ''
      const parts = materialNo.split(/[/／]/).map((s) => String(s || '').trim()).filter(Boolean)
      return parts.length >= 2 ? parts[0] : ''
    }
    const parts = raw.split(/[/／]/).map((s) => String(s || '').trim()).filter(Boolean)
    return parts.length ? parts[0] : raw
  }

  const getFluteText = (r) => {
    const product0 = (r?.product && typeof r.product === 'object') ? r.product : undefined
    const meta0 = (r?.meta && typeof r.meta === 'object') ? r.meta : undefined
    const brief0 = (meta0?.brief && typeof meta0.brief === 'object') ? meta0.brief : undefined
    const itemsArr = Array.isArray(r?.items) ? r.items : []
    const item0 = pickItemFrom(r, itemsArr)
    const skuResolved0 = (r?.__skuResolved && typeof r.__skuResolved === 'object') ? r.__skuResolved : null

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

    const explicit = pickText(
      skuResolved0?.flute,
      skuResolved0?.fluteType,
      skuResolved0?.flute_code,
      product0?.flute,
      product0?.fluteType,
      product0?.flute_code,
      item0?.flute,
      item0?.fluteType,
      item0?.flute_code,
      meta0?.flute,
      meta0?.fluteType,
      meta0?.flute_code,
      brief0?.flute,
      brief0?.fluteType,
      brief0?.flute_code,
      r?.flute,
      r?.fluteType,
      r?.flute_code
    )
    if (explicit) return explicit

    const materialNo = pickText(
      skuResolved0?.materialNo,
      skuResolved0?.material_no,
      item0?.materialNo,
      item0?.material_no,
      product0?.materialNo,
      product0?.material_no,
      meta0?.materialNo,
      meta0?.material_no,
      brief0?.materialNo,
      brief0?.material_no,
      r?.materialNo,
      r?.material_no
    )
    if (!materialNo) return ''
    const parts = materialNo.split(/[/／]/).map((s) => String(s || '').trim()).filter(Boolean)
    if (parts.length >= 2) return parts[1]
    return ''
  }

  const extractSourceOrders = (po) => {
    const rawList = [
      po?.meta?.sourceOrders,
      po?.sourceOrders,
      po?.meta?.sourceOrderIds,
      po?.sourceOrderIds,
      po?.meta?.sourceOrderId,
      po?.sourceOrderId,
      po?.meta?.sourceOrderNos,
      po?.sourceOrderNos,
      po?.meta?.source_order_nos,
      po?.source_order_nos,
      po?.meta?.sourceOrderNo,
      po?.sourceOrderNo,
      po?.meta?.source_order_no,
      po?.source_order_no,
    ].filter((v) => v !== undefined && v !== null)

    const raw = rawList.length ? rawList : [po]
    const arr = raw.flatMap((v) => (Array.isArray(v) ? v : [v]))

    const pairs = []

    const extractEmbeddedOrderNo = (token) => {
      const s = String(token ?? '').trim()
      if (!s) return ''
      const m = s.match(/(QXDD|QXBZ)\d{7,12}(?:-\d+)?/i)
      return m && m[0] ? String(m[0]).trim() : ''
    }

    arr.forEach((v) => {
      if (!v) return
      if (typeof v === 'string' || typeof v === 'number') {
        const token = String(v).trim()
        if (!token) return
        const embedded = extractEmbeddedOrderNo(token)
        if (embedded && looksLikeOrderNo(embedded)) {
          pairs.push({ orderNo: embedded })
          return
        }
        pairs.push(looksLikeOrderNo(token) ? { orderNo: token } : { id: token })
        return
      }

      const id = String(v?._id || v?.id || v?.key || v?.orderId || v?.order_id || '').trim()
      const orderNo = String(v?.orderNo || v?.orderNumber || v?.order_no || v?.order_number || '').trim()
      if (id || orderNo) {
        pairs.push({ id: id || undefined, orderNo: orderNo || undefined })
      }

      const items = Array.isArray(v?.items) ? v.items : []
      items.forEach((it) => {
        if (!it || typeof it !== 'object') return
        const rid = String(
          it?.relatedOrderId ??
          it?.related_order_id ??
          it?.sourceOrderId ??
          it?.source_order_id ??
          it?.orderId ??
          it?.order_id ??
          ''
        ).trim()
        const rno = String(
          it?.relatedOrderNo ??
          it?.related_order_no ??
          it?.sourceOrderNo ??
          it?.source_order_no ??
          it?.orderNo ??
          it?.orderNumber ??
          it?.order_no ??
          it?.order_number ??
          ''
        ).trim()
        if (!rid && !rno) return
        const embeddedNo = extractEmbeddedOrderNo(rno)
        const finalNo = looksLikeOrderNo(rno) ? rno : (looksLikeOrderNo(embeddedNo) ? embeddedNo : '')
        const finalId = finalNo ? rid : (rid || (rno && !looksLikeOrderNo(rno) ? rno : ''))
        pairs.push({ id: finalId || undefined, orderNo: finalNo || undefined })
      })
    })

    const byNo = new Map()
    const byId = new Map()
    pairs.forEach((p) => {
      if (p.orderNo && !byNo.has(p.orderNo)) byNo.set(p.orderNo, p)
      if (p.id && !byId.has(p.id)) byId.set(p.id, p)
    })

    const merged = []
    pairs.forEach((p) => {
      if (p.orderNo && byNo.has(p.orderNo)) {
        merged.push(byNo.get(p.orderNo))
        byNo.delete(p.orderNo)
      } else if (p.id && byId.has(p.id)) {
        merged.push(byId.get(p.id))
        byId.delete(p.id)
      }
    })
    byNo.forEach((p) => merged.push(p))
    byId.forEach((p) => merged.push(p))

    const seenKey = new Set()
    const finalPairs = []
    merged.forEach((p) => {
      const key = p.orderNo ? `no:${p.orderNo}` : p.id ? `id:${p.id}` : ''
      if (!key || seenKey.has(key)) return
      seenKey.add(key)
      finalPairs.push(p)
    })
    return finalPairs
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

  const unwrapSkuDetailResponse = (res) => {
    const body = res?.data ?? res
    if (!body) return null
    if (body && typeof body === 'object') {
      if (body.success === false) return null
      if (body.sku && typeof body.sku === 'object') return body.sku
      const data = body.data
      if (data && typeof data === 'object') {
        if (data.sku && typeof data.sku === 'object') return data.sku
        if (data.data && typeof data.data === 'object') return data.data
      }
      if (data && typeof data === 'object') return data
      if (data) return data
    }
    return body
  }

  const unwrapOrdersListResponse = (res) => {
    const body = res?.data ?? res
    if (!body) return []
    if (body && typeof body === 'object' && body.success === false) return []
    const data = body?.data ?? body
    if (Array.isArray(data)) return data
    if (data && typeof data === 'object') {
      if (Array.isArray(data.orders)) return data.orders
      if (Array.isArray(data.list)) return data.list
      if (Array.isArray(data.items)) return data.items
      if (Array.isArray(data.rows)) return data.rows
      if (Array.isArray(data.data)) return data.data
    }
    return []
  }

  useEffect(() => {
    if (isFromPurchaseOrder) return
    const list = Array.isArray(rows) ? rows : []
    if (!list.length) return

    const pairs = list
      .map((r) => {
        const key = getRowCacheKey(r)
        if (!key) return null
        const s = String(key || '').trim()
        const id = s.startsWith('id:') ? String(s.slice(3) || '').trim() : ''
        const orderNo = s.startsWith('no:') ? String(s.slice(3) || '').trim() : ''
        return { id: id || undefined, orderNo: orderNo || undefined, key: s }
      })
      .filter(Boolean)

    const need = pairs.filter((p) => p?.key && !hydratedOrderCache.has(p.key)).slice(0, 40)
    if (!need.length) return

    let canceled = false
    ;(async () => {
      const tasks = need.map(async (pair) => {
        if (pair?.id) {
          try {
            return unwrapOrderDetailResponse(await orderAPI.getOrder(pair.id))
          } catch (_) {
            return null
          }
        }
        if (pair?.orderNo) {
          try {
            return unwrapOrderDetailResponse(await orderAPI.getOrderAny(String(pair.orderNo).trim()))
          } catch (_) {
            return null
          }
        }
        return null
      })
      const results = await Promise.allSettled(tasks)
      if (canceled) return
      setHydratedOrderCache((prev) => {
        const next = new Map(prev || [])
        results.forEach((r, idx) => {
          if (!r || r.status !== 'fulfilled' || !r.value) return
          const o = r.value
          const id = String(o?._id || o?.id || o?.key || '').trim()
          const no = String(o?.orderNo || o?.orderNumber || '').trim()
          if (id) next.set(`id:${id}`, o)
          if (no) next.set(`no:${no}`, o)
          const requested = need[idx]
          if (requested?.id) next.set(`id:${String(requested.id).trim()}`, o)
          if (requested?.orderNo) next.set(`no:${String(requested.orderNo).trim()}`, o)
          if (requested?.key) next.set(String(requested.key).trim(), o)
        })
        return next
      })
    })()

    return () => { canceled = true }
  }, [rows, isFromPurchaseOrder, hydratedOrderCache])

  useEffect(() => {
    if (isFromPurchaseOrder) return
    const list = Array.isArray(effectiveRows) ? effectiveRows : []
    if (!list.length) return

    const pairs = []
    list.forEach((r) => {
      const key = String(r?.__skuKey || '').trim()
      if (!key) return
      if (hydratedSkuCache.has(key)) return
      if (inflightSkuRef.current.has(key)) return
      const [customerId, skuId] = key.split(':')
      if (!customerId || !skuId) return
      pairs.push({ key, customerId, skuId })
    })
    const need = pairs.slice(0, 40)
    if (!need.length) return

    let canceled = false
    need.forEach((p) => inflightSkuRef.current.add(p.key))
    ;(async () => {
      const tasks = need.map(async (p) => {
        try {
          const res = await customerSkuAPI.getCustomerSku(p.customerId, p.skuId)
          return { key: p.key, sku: unwrapSkuDetailResponse(res) }
        } catch (_) {
          return { key: p.key, sku: null }
        }
      })
      const results = await Promise.allSettled(tasks)
      need.forEach((p) => inflightSkuRef.current.delete(p.key))
      if (canceled) return
      setHydratedSkuCache((prev) => {
        const next = new Map(prev || [])
        results.forEach((r) => {
          if (!r || r.status !== 'fulfilled' || !r.value) return
          const v = r.value
          if (!v?.key || !v?.sku) return
          next.set(String(v.key).trim(), v.sku)
        })
        return next
      })
    })()

    return () => { canceled = true }
  }, [effectiveRows, isFromPurchaseOrder, hydratedSkuCache])

  const fetchSourceOrders = async (sourcePairs) => {
    const fetchOne = async (pair) => {
      const normalizeOrderNo = (v) => {
        const s = String(v ?? '').trim()
        if (!s) return ''
        const m = s.match(/(QXDD|QXBZ)\d{7,12}(?:-\d+)?/i)
        return m && m[0] ? String(m[0]).trim() : s
      }

      if (pair?.id) {
        try {
          return unwrapOrderDetailResponse(await orderAPI.getOrder(pair.id))
        } catch (_) { void 0 }
      }
      if (pair?.orderNo) {
        try {
          return unwrapOrderDetailResponse(await orderAPI.getOrderAny(String(pair.orderNo).trim()))
        } catch (_) {
          return null
        }
      }
      return null
    }

    const results = await Promise.allSettled((sourcePairs || []).slice(0, 60).map((p) => fetchOne(p)))
    const seen = new Set()
    const ordered = []
    results.forEach((r) => {
      if (!r || r.status !== 'fulfilled' || !r.value) return
      const o = r.value
      const no = String(o?.orderNo || o?.orderNumber || '').trim()
      const id = String(o?._id || o?.id || o?.key || '').trim()
      const key = no || id
      if (!key || seen.has(key)) return
      seen.add(key)
      ordered.push(o)
    })
    return ordered
  }

  useEffect(() => {
    if (!isFromPurchaseOrder) return
    if (!isFromInventory) return
    const po = effectivePurchaseOrder
    if (!po || typeof po !== 'object') return
    const sourcePairs = extractSourceOrders(po)
    if (!sourcePairs.length) return
    const hasMissingOrderNo = sourcePairs.some((p) => p?.id && !p?.orderNo)
    if (!hasMissingOrderNo) return
    const sig = sourcePairs.map((p) => `${p.id || ''}:${p.orderNo || ''}`).join('|')
    if (sig && sig === sourceResolvedSigRef.current) return
    sourceResolvedSigRef.current = sig

    let mounted = true
    ;(async () => {
      const orders = await fetchSourceOrders(sourcePairs)
      if (!mounted || !orders.length) return
      const byId = new Map()
      const byNo = new Map()
      orders.forEach((o) => {
        const id = String(o?._id || o?.id || o?.key || '').trim()
        const no = String(o?.orderNo || o?.orderNumber || '').trim()
        if (id && no && !byId.has(id)) byId.set(id, no)
        if (no && !byNo.has(no)) byNo.set(no, no)
      })
      setItems((prev) => {
        const base = Array.isArray(prev) ? prev : []
        if (!base.length) return prev
        const next = base.map((it, idx) => {
          if (!it || typeof it !== 'object') return it
          const currentNo = String(it.relatedOrderNo || '').trim()
          if (currentNo) return it
          const currentId = String(it.relatedOrderId || '').trim()
          const noFromId = currentId ? byId.get(currentId) : ''
          const idxPair = sourcePairs[idx]
          const noFromIndex = idxPair?.orderNo ? String(idxPair.orderNo).trim() : ''
          const finalNo = String(noFromId || noFromIndex || '').trim()
          if (!finalNo) return it
          const finalId = currentId || String(idxPair?.id || '').trim()
          return { ...it, relatedOrderNo: finalNo, relatedOrderId: finalId }
        })
        return next
      })
    })().catch(() => {
      sourceResolvedSigRef.current = ''
    })
    return () => { mounted = false }
  }, [isFromPurchaseOrder, isFromInventory, effectivePurchaseOrder])

  const mapOrdersToItems = (orders) => {
    return (orders || []).map((o, idx) => {
      const size = getBoardSize(o)
      const qty = Number(o?.sheetCount ?? o?.totalQty ?? o?.quantity ?? 0)
      const width = size.width
      const length = size.length
      return {
        goodsName: '纸板',
        name: '纸板',
        materialCode: String(getMaterialCodeText(o) || '').trim(),
        flute: String(getFluteText(o) || '').trim(),
        specWidth: width == null ? '' : String(width),
        specLength: length == null ? '' : String(length),
        width: '',
        length: '',
        creaseSpec: String(getCreaseText(o) || '').trim(),
        creaseType: String(getCreaseTypeText(o) || '').trim(),
        quantity: Number.isFinite(qty) && qty !== 0 ? qty : 0,
        unit: '片',
        deliveryQty: 0,
        unitPrice: 0,
        amount: 0,
        relatedOrderNo: String(o?.orderNo || o?.orderNumber || '').trim(),
        relatedOrderId: String(o?._id || o?.id || o?.key || `src_${idx}`),
      }
    })
  }

  useEffect(() => {
    if (!isFromPurchaseOrder) return
    if (reconstructedRef.current) return
    const po = effectivePurchaseOrder
    const category = String(po?.purchaseCategory || po?.category || '').trim().toLowerCase()
    if (category !== 'boards') return
    const list = Array.isArray(po?.items) ? po.items : []
    const hasBoardFields = list.some((it) => {
      const material = String(it?.materialCode || it?.material || '').trim()
      const flute = String(it?.flute || '').trim()
      const w = String(it?.specWidth || it?.width || '').trim()
      const l = String(it?.specLength || it?.length || '').trim()
      const crease = String(it?.creaseSpec || it?.creaseType || it?.creasingType || '').trim()
      return Boolean(material || flute || w || l || crease)
    })
    const hasMissingCrease = list.some((it) => {
      if (!it || typeof it !== 'object') return false
      const material = String(it?.materialCode || it?.material || '').trim()
      const flute = String(it?.flute || '').trim()
      const w = String(it?.specWidth || it?.width || '').trim()
      const l = String(it?.specLength || it?.length || '').trim()
      const qty = Number(it?.quantity ?? 0)
      const looksLikeBoardLine = Boolean(material || flute || w || l || (Number.isFinite(qty) && qty > 0))
      if (!looksLikeBoardLine) return false
      const creaseSpec = String(it?.creaseSpec || '').trim()
      const creaseType = String(it?.creaseType || it?.creasingType || '').trim()
      return !creaseSpec && !creaseType
    })
    const hasRelated = list.some((it) => {
      const no = String(it?.relatedOrderNo || '').trim()
      const id = String(it?.relatedOrderId || '').trim()
      return Boolean(no || id)
    })
    const hasInbound = list.some((it) => {
      const inboundAt = it?.inboundAt || it?.stockedAt || it?.stockedTime || it?.stockTime || ''
      const deliveryQty = Number(it?.deliveryQty ?? it?.deliveredQty ?? it?.stockedQty ?? 0)
      return Boolean(inboundAt) || (Number.isFinite(deliveryQty) && deliveryQty > 0)
    })
    const sourcePairs = extractSourceOrders(po)
    const hasMultipleSources = sourcePairs.length > 1
    const shouldReconstruct =
      !hasInbound &&
      sourcePairs.length > 0 &&
      (
        list.length === 0 ||
        !hasBoardFields ||
        hasMissingCrease ||
        !hasRelated ||
        (hasMultipleSources && list.length <= 1)
      )
    if (!shouldReconstruct) return
    reconstructedRef.current = true
    ;(async () => {
      const orders = await fetchSourceOrders(sourcePairs)
      if (!orders.length) return
      const mappedItems = mapOrdersToItems(orders)
      setPurchaseOrderDetail({
        ...(po && typeof po === 'object' ? po : {}),
        items: mappedItems
      })
    })().catch(() => {
      reconstructedRef.current = false
    })
  }, [isFromPurchaseOrder, effectivePurchaseOrder])

  useEffect(() => {
    if (isFromPurchaseOrder) {
      const list = Array.isArray(effectivePurchaseOrder?.items) ? effectivePurchaseOrder.items : []
      const sourcePairs = extractSourceOrders(effectivePurchaseOrder)
      const sourceById = new Map(
        sourcePairs
          .filter((p) => p && p.id && p.orderNo)
          .map((p) => [String(p.id).trim(), String(p.orderNo).trim()])
      )
      const hasUsefulLines = list.some((it) => {
        const material = String(it?.materialCode || it?.material || '').trim()
        const flute = String(it?.flute || '').trim()
        const w = String(it?.specWidth || it?.width || '').trim()
        const l = String(it?.specLength || it?.length || '').trim()
        const crease = String(it?.creaseSpec || it?.creaseType || it?.creasingType || '').trim()
        return Boolean(material || flute || w || l || crease)
      })
      const base = list.map((it, idx) => {
        const qty = Number(it?.quantity ?? 0)
        const deliveryQty = Number(it?.deliveryQty ?? it?.deliveredQty ?? it?.stockedQty ?? 0)
        const unitPrice = Number(it?.unitPrice ?? 0)
        const unitPriceManual = Boolean(it?.unitPriceManual)
        const inboundAtRaw = it?.stockedAt || it?.inboundAt || it?.stockedTime || it?.stockTime || ''
        const relatedIdCandidate = String(
          it?.relatedOrderId ??
          it?.related_order_id ??
          it?.sourceOrderId ??
          it?.source_order_id ??
          it?.sourceOrder?.id ??
          it?.sourceOrder?._id ??
          it?.source_order?.id ??
          it?.source_order?._id ??
          it?.orderId ??
          it?.order_id ??
          ''
        ).trim()
        const relatedNoCandidate = String(
          it?.relatedOrderNo ??
          it?.related_order_no ??
          it?.sourceOrderNo ??
          it?.source_order_no ??
          it?.sourceOrderNumber ??
          it?.source_order_number ??
          it?.sourceOrder?.orderNo ??
          it?.sourceOrder?.orderNumber ??
          it?.source_order?.orderNo ??
          it?.source_order?.orderNumber ??
          it?.meta?.relatedOrderNo ??
          it?.meta?.sourceOrderNo ??
          it?.meta?.source_order_no ??
          it?.orderNo ??
          it?.orderNumber ??
          ''
        ).trim()
        const byIdNo = relatedIdCandidate ? sourceById.get(relatedIdCandidate) : ''
        const idxPair = sourcePairs[idx]
        const idxPairNo = idxPair?.orderNo ? String(idxPair.orderNo).trim() : ''
        const idxPairId = idxPair?.id ? String(idxPair.id).trim() : ''
        const relatedOrderNo = String(relatedNoCandidate || byIdNo || idxPairNo || '').trim()
        const relatedOrderId = String(relatedIdCandidate || idxPairId || it?.relatedOrderId || it?.orderId || '').trim()
        const sizeText = String(it?.spec || it?.materialNo || '').trim()
        const nums = sizeText.match(/\d+(?:\.\d+)?/g)
        const parsedW = nums && nums.length >= 2 ? String(nums[0]) : ''
        const parsedL = nums && nums.length >= 2 ? String(nums[1]) : ''
        const specWidth = String(it?.specWidth || parsedW || it?.width || '').trim()
        const specLength = String(it?.specLength || parsedL || it?.length || '').trim()
        const width = ''
        const length = ''
        const computedAmount = (() => {
          const p = Number(unitPrice || 0)
          const d = Number(deliveryQty || 0)
          if (!Number.isFinite(p) || !Number.isFinite(d)) return 0
          if (p <= 0 || d <= 0) return 0
          const a = p * d
          return Number.isFinite(a) && a > 0 ? a : 0
        })()
        const amount = computedAmount > 0 ? computedAmount : Number(it?.amount ?? 0)
        return {
          key: it?._id || it?.id || it?.key || `po_item_${idx}`,
          material: String(it?.materialCode || it?.material || '').trim(),
          flute: String(it?.flute || '').trim(),
          specWidth,
          specLength,
          width,
          length,
          creaseSpec: String(it?.creaseSpec ?? it?.crease_spec ?? getCreaseText(it) ?? '').trim(),
          creaseType: String(it?.creaseType ?? it?.crease_type ?? it?.creasingType ?? it?.creasing_type ?? getCreaseTypeText(it) ?? '').trim(),
          quantity: Number.isFinite(qty) && qty !== 0 ? String(qty) : '',
          deliveryQty: inboundAtRaw && Number.isFinite(deliveryQty) && deliveryQty !== 0 ? String(deliveryQty) : '',
          unitPrice: Number.isFinite(unitPrice) && unitPrice !== 0 ? String(unitPrice) : '',
          unitPriceManual,
          amount: Number.isFinite(amount) && amount !== 0 ? String(amount) : '',
          inboundAt: inboundAtRaw ? String(inboundAtRaw) : '',
          relatedOrderNo,
          relatedOrderId
        }
      })
      if (!hasUsefulLines) {
        const materialNo = String(effectivePurchaseOrder?.materialNo || '').trim()
        const parts = materialNo.split('/').map((s) => String(s || '').trim()).filter(Boolean)
        const materialGuess = parts[0] || ''
        const fluteGuess = parts[1] || ''
        const qty = Number(effectivePurchaseOrder?.quantity ?? effectivePurchaseOrder?.totalQty ?? 0)
        const unitPrice = Number(effectivePurchaseOrder?.unitPrice ?? effectivePurchaseOrder?.salePrice ?? 0)
        const inboundAtRaw = effectivePurchaseOrder?.stockedAt || effectivePurchaseOrder?.inboundAt || effectivePurchaseOrder?.stockedTime || effectivePurchaseOrder?.stockTime || ''
        const deliveryQty = Number(effectivePurchaseOrder?.stockedQty ?? effectivePurchaseOrder?.deliveredQty ?? 0)
        const computedAmount = (() => {
          const p = Number(unitPrice || 0)
          const d = Number(inboundAtRaw ? (deliveryQty || qty || 0) : 0)
          if (!Number.isFinite(p) || !Number.isFinite(d)) return 0
          if (p <= 0 || d <= 0) return 0
          const a = p * d
          return Number.isFinite(a) && a > 0 ? a : 0
        })()
        base.splice(0, base.length, {
          key: String(effectivePurchaseOrder?._id || effectivePurchaseOrder?.id || effectivePurchaseOrder?.docId || effectivePurchaseOrder?.orderNo || effectivePurchaseOrder?.orderNumber || 'po_fallback'),
          material: materialGuess,
          flute: fluteGuess,
          specWidth: '',
          specLength: '',
          width: '',
          length: '',
          creaseSpec: String(getCreaseText(effectivePurchaseOrder) || '').trim(),
          creaseType: String(getCreaseTypeText(effectivePurchaseOrder) || '').trim(),
          quantity: Number.isFinite(qty) && qty !== 0 ? String(qty) : '',
          deliveryQty: inboundAtRaw ? String(deliveryQty || qty || '') : '',
          unitPrice: Number.isFinite(unitPrice) && unitPrice !== 0 ? String(unitPrice) : '',
          unitPriceManual: false,
          amount: computedAmount > 0 ? String(computedAmount) : '',
          inboundAt: inboundAtRaw ? String(inboundAtRaw) : '',
          relatedOrderNo: '',
          relatedOrderId: ''
        })
      }
      const minRows = 12
      const targetLen = Math.max(minRows, base.length || 0)
      const padded = [...base]
      for (let i = padded.length; i < targetLen; i += 1) {
        padded.push({
          key: `empty_po_${String(effectivePurchaseOrder?.orderNo || '')}_${i}`,
          material: '',
          flute: '',
          specWidth: '',
          specLength: '',
          width: '',
          length: '',
          creaseSpec: '',
          creaseType: '',
          quantity: '',
          deliveryQty: '',
          unitPrice: '',
          amount: '',
          inboundAt: '',
          relatedOrderNo: '',
          relatedOrderId: ''
        })
      }
      setItems(padded)
      return
    }

    if (!rowsSig) return
    if (rowsSig === initializedSig) return

    const base = (effectiveRows || []).map((r, idx) => {
      const src = (() => {
        if (!r || typeof r !== 'object') return r
        const hydrated = (r.__hydrated && typeof r.__hydrated === 'object') ? r.__hydrated : null
        if (!hydrated) return r
        const parseSize2 = (o) => {
          if (!o || typeof o !== 'object') return { w: undefined, h: undefined }
          const numFrom = (...vals) => {
            for (const v of vals) {
              const n = Number(v)
              if (Number.isFinite(n) && n > 0) return n
            }
            return undefined
          }
          const w1 = numFrom(o?.boardWidth, o?.board_width, o?.specWidth, o?.spec_width)
          const h1 = numFrom(o?.boardHeight, o?.board_height, o?.specLength, o?.spec_length)
          if (w1 !== undefined && h1 !== undefined) return { w: w1, h: h1 }

          const text = String(
            o?.paperSize ??
            o?.paper_size ??
            o?.paper ??
            o?.spec ??
            o?.specification ??
            o?.sizeText ??
            o?.size_text ??
            ''
          ).trim()
          if (!text) return { w: undefined, h: undefined }
          const m = text.match(/(\d+(?:\.\d+)?)\s*[x×*]\s*(\d+(?:\.\d+)?)/i)
          if (m) {
            const a = Number(m[1])
            const b = Number(m[2])
            if (Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0) return { w: a, h: b }
          }
          const nums = text.match(/\d+(?:\.\d+)?/g)
          if (nums && nums.length >= 2) {
            const a = Number(nums[0])
            const b = Number(nums[1])
            if (Number.isFinite(a) && a > 0 && Number.isFinite(b) && b > 0) return { w: a, h: b }
          }
          return { w: undefined, h: undefined }
        }

        const sameSize = (a, b) => {
          if (!a || !b) return false
          if (!Number.isFinite(a.w) || !Number.isFinite(a.h) || !Number.isFinite(b.w) || !Number.isFinite(b.h)) return false
          return (a.w === b.w && a.h === b.h) || (a.w === b.h && a.h === b.w)
        }

        const inferItemIndexFromNo = () => {
          const rowNo = String(r?.orderNo || r?.orderNumber || '').trim()
          const hydratedNo = String(hydrated?.orderNo || hydrated?.orderNumber || '').trim()
          const preferParent = String(r?.__parentNo || '').trim()
          const baseNo = preferParent || hydratedNo
          if (!rowNo || !baseNo) return -1
          if (!rowNo.startsWith(`${baseNo}-`)) return -1
          const m = rowNo.match(/-(\d+)$/)
          if (!m) return -1
          const n = Number(m[1])
          if (!Number.isFinite(n) || n <= 0) return -1
          return n - 1
        }

        const findItemIndexBySize = (itemsArr) => {
          const rowSize = parseSize2(r)
          if (!Number.isFinite(rowSize.w) || !Number.isFinite(rowSize.h)) return -1
          const arr = Array.isArray(itemsArr) ? itemsArr : []
          for (let i = 0; i < arr.length; i += 1) {
            const it = arr[i]
            const itSize = parseSize2(it)
            if (sameSize(rowSize, itSize)) return i
          }
          return -1
        }

        let idx0 = getItemIndex(r)
        const itemsArr = Array.isArray(hydrated?.items) ? hydrated.items : []
        if (idx0 >= itemsArr.length) idx0 = -1
        const idxFromNo = inferItemIndexFromNo()
        const idxFromSize = findItemIndexBySize(itemsArr)
        if (idx0 >= 0 && idx0 < itemsArr.length) {
          const rowSize = parseSize2(r)
          const itSize = parseSize2(itemsArr[idx0])
          if (Number.isFinite(rowSize.w) && Number.isFinite(rowSize.h) && !sameSize(rowSize, itSize)) {
            idx0 = -1
          }
        }
        if (idxFromNo >= 0 && idxFromNo < itemsArr.length && idxFromNo !== idx0) idx0 = idxFromNo
        if (idx0 < 0 && idxFromNo >= 0) idx0 = idxFromNo
        if (idx0 < 0 && idxFromSize >= 0) idx0 = idxFromSize
        if (idx0 < 0 && itemsArr.length === 1) idx0 = 0
        const item0 = (idx0 >= 0 && idx0 < itemsArr.length) ? itemsArr[idx0] : null
        const merged = {
          ...hydrated,
          ...(item0 && typeof item0 === 'object' ? item0 : {}),
          ...r,
          ...(idx0 >= 0 && idx0 < itemsArr.length ? { __itemIndex: idx0 } : {})
        }
        if (Array.isArray(hydrated?.items)) merged.items = hydrated.items
        if (hydrated?.product && typeof hydrated.product === 'object') merged.product = hydrated.product
        if (hydrated?.meta && typeof hydrated.meta === 'object') merged.meta = hydrated.meta
        return merged
      })()
      const size = getBoardSize(src)
      const qty = Number(src?.sheetCount ?? src?.totalQty ?? src?.quantity ?? 0)
      const width = size.width
      const length = size.length
      const rowKey = String(r?.key || r?._id || r?.id || src?._id || src?.id || `bp_${idx}`)
      const relatedOrderId = String(src?._id || src?.id || src?.key || r?._id || r?.id || r?.key || '').trim()
      const relatedOrderNo = String(getRowOrderNo(r) || src?.orderNo || src?.orderNumber || r?.orderNo || r?.orderNumber || '').trim()
      const rowCrease = resolveBoardPurchaseCrease(src)
      return {
        key: rowKey,
        material: String(getMaterialCodeText(src) || '').trim(),
        flute: String(getFluteText(src) || '').trim(),
        specWidth: width == null ? '' : String(width),
        specLength: length == null ? '' : String(length),
        width: '',
        length: '',
        creaseSpec: String(rowCrease?.spec || '').trim(),
        creaseType: String(rowCrease?.type || '').trim(),
        quantity: Number.isFinite(qty) && qty !== 0 ? String(qty) : '',
        deliveryQty: '',
        unitPrice: '',
        amount: '',
        inboundAt: '',
        relatedOrderNo,
        relatedOrderId,
        delivery: String(src?.deliveryDate || src?.deliverDate || r?.deliveryDate || r?.deliverDate || '').trim(),
        remark: String(src?.notes || src?.remark || r?.notes || r?.remark || '').trim()
      }
    })

    const minRows = 12
    const targetLen = Math.max(minRows, base.length || 0)
    const padded = [...base]
    for (let i = padded.length; i < targetLen; i += 1) {
      padded.push({
        key: `empty_${rowsSig}_${i}`,
        material: '',
        flute: '',
        specWidth: '',
        specLength: '',
        width: '',
        length: '',
        creaseSpec: '',
        creaseType: '',
        quantity: '',
        deliveryQty: '',
        unitPrice: '',
        amount: '',
        inboundAt: '',
          relatedOrderNo: '',
          relatedOrderId: '',
        delivery: '',
        remark: ''
      })
    }
    setItems(padded)
    setInitializedSig(rowsSig)
  }, [effectiveRows, rowsSig, initializedSig, isFromPurchaseOrder, effectivePurchaseOrder])

  const totalQty = useMemo(() => {
    return (items || []).reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)
  }, [items])

  const focusTdInput = (e) => {
    try {
      const input = e?.currentTarget?.querySelector?.('input, textarea, [contenteditable="true"]')
      if (input && typeof input.focus === 'function') {
        input.focus()
        if (typeof input.select === 'function') input.select()
      }
    } catch (_) { /* ignore */ }
  }

  const onCellChange = (index, field, value) => {
    setItems((prev) => {
      const next = Array.isArray(prev) ? [...prev] : []
      if (!next[index]) return prev
      const current = next[index]
      const updated = { ...current, [field]: value }
      next[index] = updated
      return next
    })
  }

  const meaningfulItems = useMemo(() => {
    return (items || []).filter((r) => {
      const hasText =
        String(r.material || '').trim() ||
        String(r.flute || '').trim() ||
        String(r.specWidth || '').trim() ||
        String(r.specLength || '').trim() ||
        String(r.creaseSpec || '').trim() ||
        String(r.creaseType || '').trim()
      const qty = Number(r.quantity || 0)
      const deliveryQty = Number(r.deliveryQty || 0)
      const unitPrice = Number(r.unitPrice || 0)
      return Boolean(hasText) || qty > 0 || deliveryQty > 0 || unitPrice > 0
    })
  }, [items])

  const getRowUnitPrice = (r) => {
    const v = Number(r?.unitPrice || 0)
    return Number.isFinite(v) && v > 0 ? v : 0
  }

  const computeRowAmount = (r) => {
    const unitPrice = getRowUnitPrice(r)
    const deliveryQty = Number(r?.deliveryQty || 0)
    const amount = unitPrice * (Number.isFinite(deliveryQty) && deliveryQty > 0 ? deliveryQty : 0)
    if (Number.isFinite(amount) && amount > 0) return String(Number(amount.toFixed(2)))
    const fallback = Number(r?.amount || 0)
    if (!Number.isFinite(fallback) || fallback <= 0) return ''
    return String(Number(fallback.toFixed(2)))
  }

  const onUnitPriceChange = (index, value) => {
    setItems((prev) => {
      const next = Array.isArray(prev) ? [...prev] : []
      if (!next[index]) return prev
      const text = value == null ? '' : String(value).trim()
      if (!text) {
        next[index] = {
          ...next[index],
          unitPrice: '',
          unitPriceManual: false
        }
        return next
      }
      next[index] = {
        ...next[index],
        unitPrice: text,
        unitPriceManual: true
      }
      return next
    })
  }

  const onConfirmInbound = async (index) => {
    try {
      const row = items?.[index]
      const deliveryQty = Number(row?.deliveryQty || 0)
      if (!deliveryQty || deliveryQty <= 0) {
        message.warning('请先填写送货数')
        return
      }
      const poId = effectivePurchaseOrder?._id || effectivePurchaseOrder?.id || effectivePurchaseOrder?.docId || effectivePurchaseOrder?.orderId || effectivePurchaseOrder?.key || purchaseOrder?._id || purchaseOrder?.id || purchaseOrder?.docId || purchaseOrder?.orderId || purchaseOrder?.key
      const nowIso = new Date().toISOString()

      const base = Array.isArray(items) ? items : []
      const nextRows = base.map((it, i) => {
        if (i !== index) return it
        const nextDeliveryQty = String(it.deliveryQty || deliveryQty)
        return {
          ...it,
          deliveryQty: nextDeliveryQty,
          amount: computeRowAmount({ ...it, deliveryQty: nextDeliveryQty }),
          inboundAt: nowIso
        }
      })

      setItems(nextRows)

      if (!isFromPurchaseOrder || !poId) {
        message.success('已确认入库')
        return
      }

      const meaningful = nextRows.filter((r) => {
        const hasText =
          String(r.material || '').trim() ||
          String(r.flute || '').trim() ||
          String(r.specWidth || '').trim() ||
          String(r.specLength || '').trim() ||
          String(r.creaseSpec || '').trim() ||
          String(r.creaseType || '').trim()
        const ordered = Number(r.quantity || 0)
        return Boolean(hasText) || ordered > 0
      })

      const orderedTotal = meaningful.reduce((s, it) => s + (Number(it.quantity || 0) || 0), 0)
      const stockedQty = meaningful.reduce((s, it) => {
        if (!it.inboundAt) return s
        const d = Number(it.deliveryQty || 0) || Number(it.quantity || 0) || 0
        return s + d
      }, 0)

      const prevStatus = String(effectivePurchaseOrder?.status || purchaseOrder?.status || 'ordered').toLowerCase()
      let nextStatus = prevStatus || 'ordered'
      if (!['cancelled', 'completed'].includes(prevStatus)) {
        if (orderedTotal > 0 && stockedQty >= orderedTotal) nextStatus = 'stocked'
      }

      const payloadItems = meaningful.map((it) => ({
          goodsName: '纸板',
          materialCode: String(it.material || '').trim(),
          flute: String(it.flute || '').trim(),
          specWidth: String(it.specWidth || '').trim(),
          specLength: String(it.specLength || '').trim(),
          width: String(it.width || '').trim(),
          length: String(it.length || '').trim(),
          creaseSpec: String(it.creaseSpec || '').trim(),
          creaseType: String(it.creaseType || '').trim(),
          quantity: Number(it.quantity || 0) || 0,
          unit: '片',
          deliveryQty: Number(it.deliveryQty || 0) || 0,
          unitPrice: getRowUnitPrice(it),
          unitPriceManual: Boolean(it.unitPriceManual),
          amount: Number(computeRowAmount(it) || 0) || 0,
          stockedAt: it.inboundAt ? String(it.inboundAt) : '',
          stockedQty: it.inboundAt ? (Number(it.deliveryQty || 0) || Number(it.quantity || 0) || 0) : 0
        }))

      const orderAmount = payloadItems.reduce((s, it) => s + (Number(it.amount) || 0), 0)

      await purchaseAPI.updatePurchaseOrder(poId, {
        items: payloadItems,
        amount: Number.isFinite(orderAmount) ? orderAmount : 0,
        stockedQty,
        stockedAt: nowIso,
        status: nextStatus,
        source: 'purchased'
      })

      const rawSourceOrderIds =
        effectivePurchaseOrder?.meta?.sourceOrderIds ??
        effectivePurchaseOrder?.sourceOrderIds ??
        effectivePurchaseOrder?.meta?.sourceOrders ??
        effectivePurchaseOrder?.sourceOrders ??
        effectivePurchaseOrder?.meta?.sourceOrderId ??
        effectivePurchaseOrder?.sourceOrderId ??
        purchaseOrder?.meta?.sourceOrderIds ??
        purchaseOrder?.sourceOrderIds ??
        purchaseOrder?.meta?.sourceOrders ??
        purchaseOrder?.sourceOrders ??
        purchaseOrder?.meta?.sourceOrderId ??
        purchaseOrder?.sourceOrderId ??
        []
      const sourceOrderIds = (Array.isArray(rawSourceOrderIds) ? rawSourceOrderIds : [rawSourceOrderIds])
        .map((v) => {
          if (!v) return ''
          if (typeof v === 'string' || typeof v === 'number') return String(v)
          return String(v?._id || v?.id || v?.key || v?.orderId || v?.orderNo || v?.orderNumber || '')
        })
        .filter(Boolean)

      if (sourceOrderIds.length && stockedQty > 0) {
        await Promise.allSettled(
          sourceOrderIds.map((id) =>
            orderAPI.updateOrder(id, {
              materialArrived: true,
              material_status: 'arrived',
              materialStatus: 'arrived'
            })
          )
        )
      }

      message.success('已确认入库')
    } catch (_) {
      message.error('确认入库失败')
    }
  }

  const onCreatePurchaseOrder = async () => {
    try {
      if (!meaningfulItems.length) {
        message.warning('没有可生成的采购明细')
        return
      }
      if (!purchaseOrderNo) {
        message.warning('采购单号生成中，请稍后再试')
        return
      }

      const first = rows.find(r => r && r.supplierName) || rows[0] || {}
      const supplierName = String(first?.supplierName || supplierShortName || '').trim()
      if (!supplierName) {
        message.warning('请填写供应商简称')
        return
      }

      const total = meaningfulItems.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0)
      const sourceOrders = Array.from(
        new Map(
          (rows || [])
            .map((r) => {
              const id = String(r?._id || r?.id || r?.__parentOrderId || '').trim()
              const orderNo = String(r?.orderNo || r?.orderNumber || r?.__parentNo || '').trim()
              const key = id || orderNo
              if (!key) return null
              return [key, { id: id || undefined, orderNo: orderNo || undefined }]
            })
            .filter(Boolean)
        ).values()
      )
      const payload = {
        orderNo: purchaseOrderNo,
        supplierName,
        goodsName: '纸板',
        materialNo: `${String(meaningfulItems[0]?.material || '').trim()}${meaningfulItems[0]?.flute ? `/${String(meaningfulItems[0]?.flute || '').trim()}` : ''}`.trim(),
        quantity: total,
        unit: '片',
        salePrice: 0,
        unitPrice: 0,
        amount: 0,
        purchaseCategory: 'boards',
        status: 'ordered',
        createdAt: new Date().toISOString(),
        meta: {
          supplierShortName,
          orderDateText,
          sourceOrders,
          sourceOrderIds: sourceOrders.map((x) => x.id).filter(Boolean),
          sourceOrderNos: sourceOrders.map((x) => x.orderNo).filter(Boolean)
        },
        items: meaningfulItems.map((it) => ({
          goodsName: '纸板',
          name: '纸板',
          materialCode: String(it.material || '').trim(),
          flute: String(it.flute || '').trim(),
          specWidth: String(it.specWidth || '').trim(),
          specLength: String(it.specLength || '').trim(),
          width: String(it.width || '').trim(),
          length: String(it.length || '').trim(),
          creaseSpec: String(it.creaseSpec || '').trim(),
          creaseType: String(it.creaseType || '').trim(),
          quantity: Number(it.quantity || 0),
          unit: '片',
          deliveryQty: Number(it.deliveryQty || 0) || Number(it.quantity || 0) || 0,
          unitPrice: getRowUnitPrice(it),
          unitPriceManual: Boolean(it.unitPriceManual),
          amount: Number(computeRowAmount(it) || 0) || 0,
          relatedOrderNo: String(it.relatedOrderNo || '').trim(),
          relatedOrderId: String(it.relatedOrderId || '').trim()
        }))
      }

      const res = await purchaseAPI.createPurchaseOrder({ ...payload, reservationId: reservedId })
      const serverOrder = res?.data?.order || res?.data?.data?.order || res?.data || res?.order || res
      const serverNo = String(serverOrder?.orderNo || serverOrder?.orderNumber || purchaseOrderNo || '').trim()
      const poId = serverOrder?._id || serverOrder?.id
      createdRef.current = true
      const sourceOrderIds = Array.from(new Set((sourceOrders || []).map((x) => x?.id).filter(Boolean)))
      if (sourceOrderIds.length) {
        await Promise.allSettled(
          sourceOrderIds.map((id) => orderAPI.updateOrder(id, {
            purchaseOrderNo: serverNo || purchaseOrderNo,
            purchaseOrderId: poId,
            purchaseOrderCreatedAt: new Date().toISOString(),
            supplierName,
            supplierShortName
          }))
        )
      }

      message.success(`采购单已生成（编号：${serverNo || purchaseOrderNo}）`)
      setReservedId(undefined)
      navigate('/purchase', { state: { viewType: 'boards' } })
    } catch (error) {
      const msg = error?.response?.data?.message || error?.message || '生成采购单失败'
      message.error(msg)
    }
  }

  const onRepairAndSave = async () => {
    if (!isFromPurchaseOrder) return
    const po = effectivePurchaseOrder
    const category = String(po?.purchaseCategory || po?.category || '').trim().toLowerCase()
    if (category !== 'boards') return
    const list = Array.isArray(po?.items) ? po.items : []
    const hasInbound = list.some((it) => {
      const inboundAt = it?.inboundAt || it?.stockedAt || it?.stockedTime || it?.stockTime || ''
      const deliveryQty = Number(it?.deliveryQty ?? it?.deliveredQty ?? it?.stockedQty ?? 0)
      return Boolean(inboundAt) || (Number.isFinite(deliveryQty) && deliveryQty > 0)
    })
    if (hasInbound) {
      message.warning('该采购单已存在入库数据，避免覆盖明细，请手工核对后再修改')
      return
    }

    const poId = String(po?._id || po?.id || po?.docId || po?.orderId || po?.key || '').trim()
    if (!poId) {
      message.error('缺少采购单ID')
      return
    }

    setRepairLoading(true)
    try {
      const currentItems = Array.isArray(po?.items) ? po.items : []
      const pairsFromLines = currentItems
        .map((it) => ({
          id: String(it?.relatedOrderId || it?.related_order_id || it?.sourceOrderId || it?.source_order_id || '').trim(),
          orderNo: String(it?.relatedOrderNo || it?.related_order_no || it?.sourceOrderNo || it?.source_order_no || '').trim()
        }))
        .filter((p) => p.id || p.orderNo)

      const mergedPairs = (() => {
        const base = [...extractSourceOrders(po), ...pairsFromLines]
        const seen = new Set()
        const out = []
        base.forEach((p) => {
          const id = String(p?.id || '').trim()
          const no = String(p?.orderNo || '').trim()
          const key = id ? `id:${id}` : (no ? `no:${no}` : '')
          if (!key || seen.has(key)) return
          seen.add(key)
          out.push({ id: id || undefined, orderNo: no || undefined })
        })
        return out
      })()

      if (!mergedPairs.length) {
        message.error('未找到关联订单来源，无法重算压线')
        return
      }

      const orders = await fetchSourceOrders(mergedPairs)
      if (!orders.length) {
        message.error('未能获取关联订单数据，无法重算压线')
        return
      }

      const extractOrderItems = (o) => {
        if (!o || typeof o !== 'object') return []
        if (Array.isArray(o.items)) return o.items
        if (Array.isArray(o.products)) return o.products
        if (Array.isArray(o.orderItems)) return o.orderItems
        if (Array.isArray(o.skus)) return o.skus
        if (Array.isArray(o.skuList)) return o.skuList
        return []
      }

      const orderById = new Map()
      const orderByNo = new Map()
      orders.forEach((o) => {
        const id = String(o?._id || o?.id || o?.key || '').trim()
        const no = String(o?.orderNo || o?.orderNumber || '').trim()
        if (id && !orderById.has(id)) orderById.set(id, o)
        if (no && !orderByNo.has(no)) orderByNo.set(no, o)
      })

      const normalizeKey = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '')
      const toNum = (v) => {
        if (v === null || v === undefined || v === '') return NaN
        const n = Number(String(v).trim())
        return Number.isFinite(n) ? n : NaN
      }
      const getLineSize = (it) => {
        const w = toNum(it?.specWidth ?? it?.width ?? '')
        const l = toNum(it?.specLength ?? it?.length ?? '')
        return {
          w: Number.isFinite(w) && w > 0 ? w : undefined,
          l: Number.isFinite(l) && l > 0 ? l : undefined
        }
      }
      const getLineQty = (it) => {
        const q = toNum(it?.quantity ?? it?.sheetCount ?? it?.totalQty ?? it?.qty ?? '')
        return Number.isFinite(q) && q > 0 ? q : undefined
      }

      const resolvedLines = []
      const skuMap = new Map()
      const skuNeed = new Set()

      currentItems.forEach((line) => {
        const relatedId = String(line?.relatedOrderId || line?.related_order_id || '').trim()
        const relatedNoRaw = String(line?.relatedOrderNo || line?.related_order_no || '').trim()
        const relatedNo = relatedNoRaw ? relatedNoRaw.replace(/\s+/g, '') : ''
        const parentNo = relatedNo ? relatedNo.replace(/-\d+$/, '') : ''
        const looksLikeChildNo = /^(.*?)-\d+$/.test(String(relatedNo || '').trim())
        const order =
          (looksLikeChildNo && relatedNo ? orderByNo.get(relatedNo) : null) ||
          (relatedId ? orderById.get(relatedId) : null) ||
          (!looksLikeChildNo && relatedNo ? orderByNo.get(relatedNo) : null) ||
          (parentNo ? orderByNo.get(parentNo) : null)
        if (!order) {
          resolvedLines.push({ line })
          return
        }

        const itemsArr = extractOrderItems(order)
        if (!itemsArr.length) {
          resolvedLines.push({ line, order })
          return
        }

        const targetSize = getLineSize(line)
        const targetMaterial = normalizeKey(line?.materialCode || line?.material || '')
        const targetFlute = normalizeKey(line?.flute || '')
        const targetQty = getLineQty(line)

        let bestIdx = -1
        let bestScore = -1
        for (let i = 0; i < itemsArr.length; i += 1) {
          const ctx = { ...(order && typeof order === 'object' ? order : {}), items: itemsArr, __itemIndex: i }
          const size = getBoardSize(ctx)
          const candW = Number(size?.width)
          const candL = Number(size?.length)
          const candMaterial = normalizeKey(getMaterialCodeText(ctx) || '')
          const candFlute = normalizeKey(getFluteText(ctx) || '')
          const candQtyRaw = itemsArr[i]?.sheetCount ?? itemsArr[i]?.totalQty ?? itemsArr[i]?.quantity ?? itemsArr[i]?.qty
          const candQty = toNum(candQtyRaw)

          let score = 0
          if (targetSize.w && targetSize.l && Number.isFinite(candW) && Number.isFinite(candL)) {
            if (candW === targetSize.w && candL === targetSize.l) score += 4
            else if (candW === targetSize.l && candL === targetSize.w) score += 3
          }
          if (targetMaterial && candMaterial && targetMaterial === candMaterial) score += 2
          if (targetFlute && candFlute && targetFlute === candFlute) score += 1
          if (targetQty && Number.isFinite(candQty) && candQty > 0 && candQty === targetQty) score += 0.5

          if (score > bestScore) {
            bestScore = score
            bestIdx = i
          }
        }

        if (bestIdx < 0 || bestScore <= 0) {
          resolvedLines.push({ line, order, itemsArr })
          return
        }

        const ctx = { ...(order && typeof order === 'object' ? order : {}), items: itemsArr, __itemIndex: bestIdx }
        const creaseSpec = String(getCreaseText(ctx) || '').trim()
        const creaseType = String(getCreaseTypeText(ctx) || '').trim()

        const skuKey = (!creaseSpec || !creaseType) ? String(getRowSkuKey(ctx) || '').trim() : ''
        if (skuKey) {
          const cachedSku = hydratedSkuCache.get(skuKey)
          if (cachedSku && typeof cachedSku === 'object') skuMap.set(skuKey, cachedSku)
          else skuNeed.add(skuKey)
        }

        resolvedLines.push({ line, ctx, creaseSpec, creaseType, skuKey })
      })

      const needList = Array.from(skuNeed)
        .map((key) => {
          const [customerId, skuId] = String(key || '').split(':')
          if (!customerId || !skuId) return null
          return { key: String(key).trim(), customerId: String(customerId).trim(), skuId: String(skuId).trim() }
        })
        .filter(Boolean)
        .slice(0, 60)

      if (needList.length) {
        const results = await Promise.allSettled(
          needList.map(async (p) => {
            const res = await customerSkuAPI.getCustomerSku(p.customerId, p.skuId)
            return { key: p.key, sku: unwrapSkuDetailResponse(res) }
          })
        )
        results.forEach((r) => {
          if (!r || r.status !== 'fulfilled' || !r.value) return
          const v = r.value
          if (!v?.key || !v?.sku) return
          if (v.sku && typeof v.sku === 'object') skuMap.set(String(v.key).trim(), v.sku)
        })
      }

      const nextItems = resolvedLines.map((rec) => {
        const line = rec?.line
        const next = { ...(line && typeof line === 'object' ? line : {}) }
        let creaseSpec = String(rec?.creaseSpec || '').trim()
        let creaseType = String(rec?.creaseType || '').trim()
        if ((!creaseSpec || !creaseType) && rec?.skuKey) {
          const sku = skuMap.get(String(rec.skuKey).trim())
          if (sku && typeof sku === 'object') {
            const skuCrease = calcCreaseFromSku(sku)
            creaseSpec = creaseSpec || String(skuCrease?.spec || '').trim()
            creaseType = creaseType || String(skuCrease?.type || '').trim()
          }
        }
        if (creaseSpec) next.creaseSpec = creaseSpec
        if (creaseType) next.creaseType = creaseType
        return next
      })

      const nextMeta = {
        ...(po?.meta && typeof po.meta === 'object' ? po.meta : {})
      }
      const qty = nextItems.reduce((s, it) => s + (Number(it?.quantity || 0) || 0), 0)
      await purchaseAPI.updatePurchaseOrder(poId, { items: nextItems, quantity: qty, meta: nextMeta })
      setPurchaseOrderDetail({
        ...(po && typeof po === 'object' ? po : {}),
        meta: nextMeta,
        items: nextItems,
        quantity: qty
      })
      message.success('已重算压线并保存明细')
    } catch (_) {
      message.error('重算保存失败')
    } finally {
      setRepairLoading(false)
    }
  }

  const openRelatedOrderBrief = async (row) => {
    setRelatedDetailSourceRow(row && typeof row === 'object' ? row : null)
    const rawOrderNo = String(row?.relatedOrderNo || '').trim()
    const extractedOrderNo = (() => {
      const m = rawOrderNo.match(/(QXDD|QXBZ)\d{7,12}(-\d+)?/i)
      return m && m[0] ? String(m[0]).trim() : ''
    })()
    const orderNo = extractedOrderNo || rawOrderNo
    const parentOrderNo = (() => {
      const s = String(orderNo || '').trim()
      if (!s) return ''
      const m = s.match(/^(.*?)-\d+$/)
      return m && m[1] ? String(m[1]).trim() : ''
    })()
    const orderId = String(row?.relatedOrderId || '').trim()
    const cacheKey = orderId || orderNo
    if (!cacheKey) return
    setRelatedDetailRequestedNo(String(orderNo || '').trim())
    setRelatedDetailOrder(null)
    setRelatedDetailOpen(true)
    setRelatedDetailLoading(true)
    const reqId = ++relatedDetailReqIdRef.current
    const safeText = (v) => String(v ?? '').trim()
    const isMeaningful = (v) => {
      const s = safeText(v)
      if (!s) return false
      return !['-', '—', '--', '---', '暂无', '无', 'null', 'undefined'].includes(s.toLowerCase())
    }
    const toBrief = (o) => {
      const pickText = (...candidates) => {
        for (const c of candidates) {
          if (isMeaningful(c)) return safeText(c)
        }
        return ''
      }
      const itemsArr =
        Array.isArray(o?.items) ? o.items : (
          Array.isArray(o?.products) ? o.products : (
            Array.isArray(o?.orderItems) ? o.orderItems : (
              Array.isArray(o?.skus) ? o.skus : (
                Array.isArray(o?.skuList) ? o.skuList : []
              )
            )
          )
        )
      const items0 = itemsArr.length ? itemsArr[0] : undefined
      const product0 = (o?.product && typeof o.product === 'object') ? o.product : undefined
      const data0 = (o?.data && typeof o.data === 'object') ? o.data : undefined
      const dataMeta0 = (data0?.meta && typeof data0.meta === 'object') ? data0.meta : undefined
      const dataBrief0 = (dataMeta0?.brief && typeof dataMeta0.brief === 'object') ? dataMeta0.brief : undefined
      const dataProduct0 = (data0?.product && typeof data0.product === 'object') ? data0.product : undefined
      const meta0 = (o?.meta && typeof o.meta === 'object') ? o.meta : undefined
      const brief0 = (meta0?.brief && typeof meta0.brief === 'object') ? meta0.brief : undefined
      const sku0 = (() => {
        const candidates = [
          o?.sku,
          data0?.sku,
          dataMeta0?.sku,
          dataBrief0?.sku,
          dataProduct0?.sku,
          meta0?.sku,
          brief0?.sku,
          product0?.sku,
          items0?.sku
        ]
        for (const c of candidates) {
          if (c && typeof c === 'object') return c
        }
        return undefined
      })()
      const orderNoText = pickText(
        o?.orderNo,
        o?.orderNumber,
        o?.order_no,
        o?.order_number,
        data0?.orderNo,
        data0?.orderNumber,
        data0?.order_no,
        data0?.order_number,
        dataMeta0?.orderNo,
        dataMeta0?.orderNumber,
        dataMeta0?.order_no,
        dataMeta0?.order_number,
        dataBrief0?.orderNo,
        dataBrief0?.orderNumber,
        dataBrief0?.order_no,
        dataBrief0?.order_number,
        meta0?.orderNo,
        meta0?.orderNumber,
        meta0?.order_no,
        meta0?.order_number,
        brief0?.orderNo,
        brief0?.orderNumber,
        brief0?.order_no,
        brief0?.order_number,
        orderNo
      )
      const customerText = pickText(
        o?.customerName,
        o?.customer_name,
        o?.customer?.companyName,
        o?.customer?.shortName,
        o?.customer?.name,
        o?.customer,
        o?.clientName,
        o?.client_name,
        o?.supplierName,
        o?.supplierShortName,
        o?.shortName,
        data0?.customerName,
        data0?.customer_name,
        data0?.customer?.companyName,
        data0?.customer?.shortName,
        data0?.customer?.name,
        data0?.customer,
        data0?.clientName,
        data0?.client_name,
        data0?.supplierName,
        data0?.supplierShortName,
        data0?.shortName,
        meta0?.customerName,
        meta0?.customer_name,
        brief0?.customerName,
        brief0?.customer_name,
        dataMeta0?.customerName,
        dataMeta0?.customer_name,
        dataBrief0?.customerName,
        dataBrief0?.customer_name,
        items0?.customerName,
        items0?.customer_name,
        items0?.customer?.name,
        items0?.customer,
        product0?.customerName,
        product0?.customer_name,
        product0?.customer?.name,
        product0?.customer,
        o?.customerShortName,
        items0?.customerShortName,
        meta0?.customerShortName,
        brief0?.customerShortName,
        data0?.customerShortName,
        dataMeta0?.customerShortName,
        dataBrief0?.customerShortName
      )
      const titleText = pickText(
        o?.goodsName,
        o?.goods_name,
        o?.productTitle,
        o?.product_title,
        o?.productName,
        o?.product_name,
        o?.title,
        data0?.goodsName,
        data0?.goods_name,
        data0?.productTitle,
        data0?.product_title,
        data0?.productName,
        data0?.product_name,
        data0?.title,
        sku0?.name,
        sku0?.goodsName,
        sku0?.goods_name,
        sku0?.productName,
        sku0?.product_name,
        meta0?.goodsName,
        meta0?.goods_name,
        meta0?.productTitle,
        meta0?.product_title,
        meta0?.productName,
        meta0?.product_name,
        meta0?.title,
        brief0?.goodsName,
        brief0?.goods_name,
        brief0?.productTitle,
        brief0?.product_title,
        brief0?.productName,
        brief0?.product_name,
        brief0?.title,
        dataMeta0?.goodsName,
        dataMeta0?.goods_name,
        dataMeta0?.productTitle,
        dataMeta0?.product_title,
        dataMeta0?.productName,
        dataMeta0?.product_name,
        dataMeta0?.title,
        dataBrief0?.goodsName,
        dataBrief0?.goods_name,
        dataBrief0?.productTitle,
        dataBrief0?.product_title,
        dataBrief0?.productName,
        dataBrief0?.product_name,
        dataBrief0?.title,
        product0?.goodsName,
        product0?.goods_name,
        product0?.productTitle,
        product0?.product_title,
        product0?.productName,
        product0?.product_name,
        product0?.title,
        product0?.name,
        dataProduct0?.goodsName,
        dataProduct0?.goods_name,
        dataProduct0?.productTitle,
        dataProduct0?.product_title,
        dataProduct0?.productName,
        dataProduct0?.product_name,
        dataProduct0?.title,
        dataProduct0?.name,
        items0?.goodsName,
        items0?.goods_name,
        items0?.productTitle,
        items0?.product_title,
        items0?.productName,
        items0?.product_name,
        items0?.title,
        items0?.name
      )
      const size =
        getBoardSize(o || {}) ||
        getBoardSize(data0 || {}) ||
        getBoardSize(product0 || {}) ||
        getBoardSize(dataProduct0 || {}) ||
        getBoardSize(sku0 || {}) ||
        getBoardSize(items0 || {}) ||
        {}
      const fallbackSizeText = (() => {
        const w = pickText(
          o?.specWidth,
          product0?.specWidth,
          items0?.specWidth,
          data0?.specWidth,
          dataProduct0?.specWidth,
          o?.width,
          product0?.width,
          items0?.width,
          data0?.width,
          dataProduct0?.width,
          o?.boardWidth,
          product0?.boardWidth,
          items0?.boardWidth
        )
        const l = pickText(
          o?.specLength,
          product0?.specLength,
          items0?.specLength,
          data0?.specLength,
          dataProduct0?.specLength,
          o?.length,
          product0?.length,
          items0?.length,
          data0?.length,
          dataProduct0?.length,
          o?.boardHeight,
          product0?.boardHeight,
          items0?.boardHeight
        )
        if (w && l) return `${w}×${l}`
        return ''
      })()
      const explicitSpecText = pickText(
        o?.spec,
        meta0?.spec,
        brief0?.spec,
        product0?.spec,
        sku0?.spec,
        items0?.spec,
        data0?.spec,
        dataMeta0?.spec,
        dataBrief0?.spec,
        dataProduct0?.spec,
        o?.size,
        o?.specification,
        meta0?.size,
        meta0?.specification,
        brief0?.size,
        brief0?.specification,
        product0?.size,
        product0?.specification,
        sku0?.size,
        sku0?.specification,
        items0?.size,
        items0?.specification
      )
      const paperSizeText = pickText(
        o?.paperSize,
        o?.paper_size,
        o?.paperSizeDisplay,
        o?.paper_size_display,
        meta0?.paperSize,
        meta0?.paper_size,
        meta0?.paperSizeDisplay,
        meta0?.paper_size_display,
        brief0?.paperSize,
        brief0?.paper_size,
        brief0?.paperSizeDisplay,
        brief0?.paper_size_display,
        product0?.paperSize,
        product0?.paper_size,
        product0?.paperSizeDisplay,
        product0?.paper_size_display,
        items0?.paperSize,
        items0?.paper_size,
        items0?.paperSizeDisplay,
        items0?.paper_size_display,
        data0?.paperSize,
        data0?.paper_size,
        data0?.paperSizeDisplay,
        data0?.paper_size_display,
        dataMeta0?.paperSize,
        dataMeta0?.paper_size,
        dataMeta0?.paperSizeDisplay,
        dataMeta0?.paper_size_display,
        dataBrief0?.paperSize,
        dataBrief0?.paper_size,
        dataBrief0?.paperSizeDisplay,
        dataBrief0?.paper_size_display,
        dataProduct0?.paperSize,
        dataProduct0?.paper_size,
        dataProduct0?.paperSizeDisplay,
        dataProduct0?.paper_size_display
      )
      const sizeText =
        explicitSpecText ||
        paperSizeText ||
        ((size?.width && size?.length) ? `${size.width}×${size.length}` : '') ||
        fallbackSizeText
      const materialFluteDisplay = pickText(
        o?.materialFluteDisplay,
        o?.material_flute_display,
        meta0?.materialFluteDisplay,
        meta0?.material_flute_display,
        brief0?.materialFluteDisplay,
        brief0?.material_flute_display,
        product0?.materialFluteDisplay,
        product0?.material_flute_display,
        items0?.materialFluteDisplay,
        items0?.material_flute_display,
        data0?.materialFluteDisplay,
        data0?.material_flute_display,
        dataMeta0?.materialFluteDisplay,
        dataMeta0?.material_flute_display,
        dataBrief0?.materialFluteDisplay,
        dataBrief0?.material_flute_display,
        dataProduct0?.materialFluteDisplay,
        dataProduct0?.material_flute_display
      )
      const materialText = pickText(
        o?.materialNo,
        o?.material_no,
        o?.materialCode,
        o?.material_code,
        data0?.materialNo,
        data0?.material_no,
        data0?.materialCode,
        data0?.material_code,
        sku0?.materialNo,
        sku0?.material_no,
        sku0?.materialCode,
        sku0?.material_code,
        meta0?.materialNo,
        meta0?.material_no,
        meta0?.materialCode,
        meta0?.material_code,
        brief0?.materialNo,
        brief0?.material_no,
        brief0?.materialCode,
        brief0?.material_code,
        dataMeta0?.materialNo,
        dataMeta0?.material_no,
        dataMeta0?.materialCode,
        dataMeta0?.material_code,
        dataBrief0?.materialNo,
        dataBrief0?.material_no,
        dataBrief0?.materialCode,
        dataBrief0?.material_code,
        product0?.materialNo,
        product0?.material_no,
        product0?.materialCode,
        product0?.material_code,
        dataProduct0?.materialNo,
        dataProduct0?.material_no,
        dataProduct0?.materialCode,
        dataProduct0?.material_code,
        items0?.materialNo,
        items0?.material_no,
        items0?.materialCode,
        items0?.material_code
      )
      const fluteText = pickText(
        o?.flute,
        o?.fluteType,
        o?.flute_type,
        data0?.flute,
        data0?.fluteType,
        data0?.flute_type,
        meta0?.flute,
        meta0?.fluteType,
        meta0?.flute_type,
        brief0?.flute,
        brief0?.fluteType,
        brief0?.flute_type,
        dataMeta0?.flute,
        dataMeta0?.fluteType,
        dataMeta0?.flute_type,
        dataBrief0?.flute,
        dataBrief0?.fluteType,
        dataBrief0?.flute_type,
        product0?.flute,
        product0?.fluteType,
        product0?.flute_type,
        dataProduct0?.flute,
        dataProduct0?.fluteType,
        dataProduct0?.flute_type,
        sku0?.flute,
        sku0?.fluteType,
        sku0?.flute_type,
        items0?.flute,
        items0?.fluteType,
        items0?.flute_type
      )
      let materialNoText = materialText && fluteText ? `${materialText}/${fluteText}` : (materialText || fluteText)
      if (!isMeaningful(materialNoText) && isMeaningful(materialFluteDisplay)) materialNoText = materialFluteDisplay
      if (materialFluteDisplay && materialFluteDisplay.includes('/')) materialNoText = materialFluteDisplay
      const sumQty = itemsArr.reduce((s, it) => s + (Number(it?.quantity ?? it?.qty ?? it?.count ?? 0) || 0), 0)
      const parseNumberFromText = (v) => {
        const m = safeText(v).match(/-?\d+(?:\.\d+)?/)
        if (!m || !m[0]) return NaN
        const n = Number(m[0])
        return Number.isFinite(n) ? n : NaN
      }
      let qtyVal = Number(
        o?.sheetCount ??
        o?.totalQty ??
        o?.quantity ??
        o?.qty ??
        o?.count ??
        data0?.sheetCount ??
        data0?.totalQty ??
        data0?.quantity ??
        data0?.qty ??
        data0?.count ??
        sku0?.sheetCount ??
        sku0?.sheet_count ??
        sku0?.quantity ??
        sku0?.qty ??
        meta0?.sheetCount ??
        meta0?.totalQty ??
        meta0?.quantity ??
        meta0?.qty ??
        meta0?.count ??
        brief0?.sheetCount ??
        brief0?.totalQty ??
        brief0?.quantity ??
        brief0?.qty ??
        brief0?.count ??
        dataMeta0?.sheetCount ??
        dataMeta0?.totalQty ??
        dataMeta0?.quantity ??
        dataMeta0?.qty ??
        dataMeta0?.count ??
        dataBrief0?.sheetCount ??
        dataBrief0?.totalQty ??
        dataBrief0?.quantity ??
        dataBrief0?.qty ??
        dataBrief0?.count ??
        product0?.quantity ??
        product0?.qty ??
        product0?.count ??
        items0?.quantity ??
        items0?.qty ??
        items0?.count ??
        0
      )
      if ((!Number.isFinite(qtyVal) || qtyVal === 0) && sumQty) qtyVal = sumQty
      if (!Number.isFinite(qtyVal) || qtyVal === 0) {
        const parsed = parseNumberFromText(pickText(
          o?.sheetCountDisplay,
          o?.sheet_count_display,
          o?.quantityDisplay,
          o?.quantity_display,
          o?.totalQtyDisplay,
          o?.total_qty_display,
          data0?.sheetCountDisplay,
          data0?.sheet_count_display,
          data0?.quantityDisplay,
          data0?.quantity_display,
          data0?.totalQtyDisplay,
          data0?.total_qty_display,
          meta0?.sheetCountDisplay,
          meta0?.sheet_count_display,
          brief0?.sheetCountDisplay,
          brief0?.sheet_count_display,
          dataMeta0?.sheetCountDisplay,
          dataMeta0?.sheet_count_display,
          dataBrief0?.sheetCountDisplay,
          dataBrief0?.sheet_count_display
        ))
        if (Number.isFinite(parsed) && parsed !== 0) qtyVal = parsed
      }
      const qtyText = Number.isFinite(qtyVal) && qtyVal !== 0 ? String(qtyVal) : ''
      const unitPriceVal = Number(
        o?.unitPrice ??
        o?.unit_price ??
        o?.salePrice ??
        o?.sale_price ??
        o?.price ??
        data0?.unitPrice ??
        data0?.unit_price ??
        data0?.salePrice ??
        data0?.sale_price ??
        data0?.price ??
        sku0?.unitPrice ??
        sku0?.unit_price ??
        sku0?.salePrice ??
        sku0?.sale_price ??
        sku0?.price ??
        meta0?.unitPrice ??
        meta0?.unit_price ??
        meta0?.salePrice ??
        meta0?.sale_price ??
        meta0?.price ??
        brief0?.unitPrice ??
        brief0?.unit_price ??
        brief0?.salePrice ??
        brief0?.sale_price ??
        brief0?.price ??
        dataMeta0?.unitPrice ??
        dataMeta0?.unit_price ??
        dataMeta0?.salePrice ??
        dataMeta0?.sale_price ??
        dataMeta0?.price ??
        dataBrief0?.unitPrice ??
        dataBrief0?.unit_price ??
        dataBrief0?.salePrice ??
        dataBrief0?.sale_price ??
        dataBrief0?.price ??
        product0?.unitPrice ??
        product0?.unit_price ??
        product0?.salePrice ??
        product0?.sale_price ??
        product0?.price ??
        dataProduct0?.unitPrice ??
        dataProduct0?.unit_price ??
        dataProduct0?.salePrice ??
        dataProduct0?.sale_price ??
        dataProduct0?.price ??
        items0?.unitPrice ??
        items0?.unit_price ??
        items0?.salePrice ??
        items0?.sale_price ??
        items0?.price ??
        0
      )
      let unitPriceText = Number.isFinite(unitPriceVal) && unitPriceVal !== 0 ? String(unitPriceVal) : ''
      if (!isMeaningful(unitPriceText)) {
        const parsed = parseNumberFromText(pickText(
          o?.unitPriceDisplay,
          o?.unit_price_display,
          o?.salePriceDisplay,
          o?.sale_price_display,
          o?.priceDisplay,
          o?.price_display,
          data0?.unitPriceDisplay,
          data0?.unit_price_display,
          data0?.salePriceDisplay,
          data0?.sale_price_display,
          data0?.priceDisplay,
          data0?.price_display,
          meta0?.unitPriceDisplay,
          meta0?.unit_price_display,
          brief0?.unitPriceDisplay,
          brief0?.unit_price_display,
          dataMeta0?.unitPriceDisplay,
          dataMeta0?.unit_price_display,
          dataBrief0?.unitPriceDisplay,
          dataBrief0?.unit_price_display
        ))
        if (Number.isFinite(parsed) && parsed !== 0) unitPriceText = String(parsed)
      }
      return {
        orderNo: orderNoText,
        customerName: customerText,
        spec: sizeText,
        goodsName: titleText,
        materialNo: materialNoText,
        quantity: qtyText,
        unitPrice: unitPriceText
      }
    }

    const hasMeaningfulBrief = (b) => {
      if (!b || typeof b !== 'object') return false
      const fields = [b.customerName, b.spec, b.goodsName, b.materialNo, b.quantity, b.unitPrice]
      return fields.some((v) => isMeaningful(v))
    }

    const briefScore = (b) => {
      if (!b || typeof b !== 'object') return 0
      const fields = [b.customerName, b.spec, b.goodsName, b.materialNo, b.quantity, b.unitPrice]
      return fields.reduce((s, v) => s + (isMeaningful(v) ? 1 : 0), 0)
    }

    const pickBetterOrder = (preferred, candidate) => {
      if (!candidate) return preferred
      if (!preferred) return candidate
      const a = toBrief(preferred)
      const b = toBrief(candidate)
      const sa = briefScore(a)
      const sb = briefScore(b)
      if (sb > sa) return candidate
      return preferred
    }

    const normalizeOrderNo = (o) => String(o?.orderNo || o?.orderNumber || o?.order_no || o?.order_number || '').trim()
    const isSameOrder = (o) => {
      const got = normalizeOrderNo(o)
      if (!got) return true
      const targets = new Set([orderNo, parentOrderNo].filter(Boolean).map((x) => String(x).trim()))
      if (!targets.size) return true
      if (targets.has(got)) return true
      const gotParent = String(got || '').trim().replace(/-\d+$/, '')
      if (gotParent && targets.has(gotParent)) return true
      for (const t of targets) {
        const tParent = String(t || '').trim().replace(/-\d+$/, '')
        if (tParent && tParent === got) return true
      }
      return false
    }

    const showBriefModal = (brief) => {
      modal.info({
        title: `订单信息：${brief.orderNo || orderNo || '-'}`,
        width: 720,
        content: (
          <Descriptions bordered size="small" column={2}>
            <Descriptions.Item label="客户名">{brief.customerName || '-'}</Descriptions.Item>
            <Descriptions.Item label="规格">{brief.spec || '-'}</Descriptions.Item>
            <Descriptions.Item label="商品名称">{brief.goodsName || '-'}</Descriptions.Item>
            <Descriptions.Item label="物料号">{brief.materialNo || '-'}</Descriptions.Item>
            <Descriptions.Item label="数量">{brief.quantity || '-'}</Descriptions.Item>
            <Descriptions.Item label="单价">{brief.unitPrice || '-'}</Descriptions.Item>
          </Descriptions>
        )
      })
    }

    setOrderBriefLoadingKey(cacheKey)
    try {
      const resolveCloudBridgeBase = () => {
        const normalize = (v) => String(v || '').trim().replace(/\/+$/, '')
        const envBase = normalize(import.meta.env.VITE_API_BASE_URL)
        if (envBase) return envBase
        if (import.meta.env.DEV) return '/api'
        return 'https://erp-system-prod-1glmda1zf4f9c7a7-1367197884.ap-shanghai.app.tcloudbase.com/api-bridge'
      }
      const joinUrl = (base, path) => {
        const b = String(base || '').trim().replace(/\/+$/, '')
        const p = String(path || '').trim().replace(/^\/+/, '')
        if (!b) return `/${p}`
        if (b === '/api') return `/api/${p}`
        return `${b}/${p}`
      }
      const cloudBridgeBase = resolveCloudBridgeBase()
      const getOrderFromCloudBridge = async (key) => {
        const k = String(key || '').trim()
        if (!k) return null
        try {
          const url = joinUrl(cloudBridgeBase, `/orders/${encodeURIComponent(k)}`)
          const resp = await fetch(url, { method: 'GET' })
          const json = await resp.json().catch(() => null)
          return unwrapOrderDetailResponse(json)
        } catch (_) {
          return null
        }
      }
      const getOrderSafe = async (key) => {
        const k = String(key || '').trim()
        if (!k) return null
        try {
          return await orderAPI.getOrderAny(k)
        } catch (_) {
          return null
        }
      }
      const unwrapGroupResponse = (res) => {
        const body = res?.data ?? res
        if (!body) return null
        if (body && typeof body === 'object' && body.success === false) return null
        const payload = body?.data ?? body?.result?.data ?? body?.result ?? body
        if (payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object') return payload.data
        return payload
      }
      const unwrapSkuResponse = (res) => {
        const body = res?.data ?? res
        const payload = body?.data ?? body?.result?.data ?? body?.result ?? body
        const data = payload?.data ?? payload
        if (data?.sku && typeof data.sku === 'object') return data.sku
        if (data && typeof data === 'object') return data
        return null
      }
      const normalizeId = (v) => String(v ?? '').trim()
      const normalizeMaybeId = (v) => {
        const s = String(v ?? '').trim()
        if (!s) return ''
        if (/^[a-f0-9]{24}$/i.test(s)) return s
        if (/^[0-9a-f-]{32,36}$/i.test(s)) return s
        return ''
      }
      const resolveCustomerId = (o) => normalizeId(
        o?.customerId || o?.customer_id || o?.customerID ||
        o?.customer?.id || o?.customer?._id ||
        o?.meta?.customer?.id || o?.meta?.customer?._id ||
        o?.meta?.customerId || o?.meta?.customer_id || o?.meta?.customerID ||
        o?.data?.customerId || o?.data?.customer_id || o?.data?.customerID ||
        o?.data?.customer?.id || o?.data?.customer?._id
      ) || normalizeMaybeId(o?.customer)
      const resolveSkuId = (o) => normalizeId(
        o?.skuId || o?.sku_id || o?.customerSkuId || o?.customer_sku_id ||
        o?.customerSku?._id || o?.customerSku?.id || normalizeMaybeId(o?.customerSku) ||
        o?.meta?.skuId || o?.meta?.sku_id || o?.meta?.customerSkuId || o?.meta?.customer_sku_id ||
        o?.meta?.customerSku?._id || o?.meta?.customerSku?.id || normalizeMaybeId(o?.meta?.customerSku) ||
        o?.meta?.brief?.skuId || o?.meta?.brief?.sku_id || o?.meta?.brief?.customerSkuId || o?.meta?.brief?.customer_sku_id ||
        o?.meta?.brief?.sku?._id || o?.meta?.brief?.sku?.id || normalizeMaybeId(o?.meta?.brief?.sku) ||
        o?.product?.skuId || o?.product?.sku_id || o?.product?.customerSkuId || o?.product?.customer_sku_id ||
        o?.product?.sku?._id || o?.product?.sku?.id || normalizeMaybeId(o?.product?.sku) ||
        o?.sku?._id || o?.sku?.id || normalizeMaybeId(o?.sku) ||
        o?.data?.skuId || o?.data?.sku_id || o?.data?.customerSkuId || o?.data?.customer_sku_id ||
        o?.data?.sku?._id || o?.data?.sku?.id || normalizeMaybeId(o?.data?.sku) ||
        (Array.isArray(o?.items) && o.items[0] ? (o.items[0]?.skuId || o.items[0]?.sku_id || o.items[0]?.customerSkuId || o.items[0]?.customer_sku_id || o.items[0]?.sku?._id || o.items[0]?.sku?.id || normalizeMaybeId(o.items[0]?.sku)) : '') ||
        (Array.isArray(o?.products) && o.products[0] ? (o.products[0]?.skuId || o.products[0]?.sku_id || o.products[0]?.customerSkuId || o.products[0]?.customer_sku_id || o.products[0]?.sku?._id || o.products[0]?.sku?.id || normalizeMaybeId(o.products[0]?.sku)) : '')
      )
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
      const extractItemsFromOrder = (o) => pickItems(
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
      )
      const isRichOrderObject = (o) => {
        if (!o || typeof o !== 'object') return false
        const items = extractItemsFromOrder(o)
        if (items.length) return true
        const t = (v) => String(v ?? '').trim()
        if (isMeaningful(t(o.customerName)) || isMeaningful(t(o.customer?.name)) || isMeaningful(t(o.customer?.companyName))) return true
        if (isMeaningful(t(o.goodsName)) || isMeaningful(t(o.productTitle)) || isMeaningful(t(o.productName)) || isMeaningful(t(o.title))) return true
        if (isMeaningful(t(o.materialNo)) || isMeaningful(t(o.materialCode)) || isMeaningful(t(o.spec)) || isMeaningful(t(o.specification))) return true
        const qty = Number(o.quantity ?? o.qty ?? o.count ?? o.sheetCount ?? o.sheet_count)
        if (Number.isFinite(qty) && qty > 0) return true
        const amount = Number(o.amount ?? o.totalAmount ?? o.total_amount ?? o.finalAmount ?? o.final_amount)
        if (Number.isFinite(amount) && amount > 0) return true
        return false
      }
      const loadSkuFromOrder = async (o) => {
        const customerId = resolveCustomerId(o)
        const skuId = resolveSkuId(o)
        if (!customerId || !skuId) return null
        try {
          const resp = await customerSkuAPI.getCustomerSku(customerId, skuId)
          return unwrapSkuResponse(resp)
        } catch (_) {
          return null
        }
      }
      const buildSyntheticItemFromSku = (order, sku) => {
        const qtyRaw = order?.sheetCount ?? order?.sheet_count ?? order?.quantity ?? order?.qty ?? order?.count ?? 0
        const unitPriceRaw = order?.unitPrice ?? order?.unit_price ?? order?.price ?? order?.salePrice ?? order?.sale_price ?? 0
        const qty = Number(qtyRaw)
        const unitPrice = Number(unitPriceRaw)
        const skuName = safeText(sku?.name || sku?.goodsName || sku?.goods_name || sku?.productName || sku?.product_name)
        const skuSpec = safeText(sku?.specification || sku?.spec)
        const skuMaterial = safeText(sku?.materialNo || sku?.material_no || sku?.materialCode || sku?.material_code)
        const skuFlute = safeText(sku?.flute || sku?.fluteType || sku?.flute_type)
        const skuMaterialText = skuMaterial && skuFlute ? `${skuMaterial}/${skuFlute}` : (skuMaterial || skuFlute)
        return {
          goodsName: skuName || undefined,
          productName: skuName || undefined,
          spec: skuSpec || undefined,
          materialNo: skuMaterialText || undefined,
          flute: skuFlute || undefined,
          quantity: Number.isFinite(qty) ? qty : undefined,
          unitPrice: Number.isFinite(unitPrice) ? unitPrice : undefined
        }
      }
      const parseChildIndex = (no) => {
        const s = String(no || '').trim()
        if (!s) return NaN
        const m = s.match(/-(\d+)$/)
        if (!m || !m[1]) return NaN
        const n = Number(m[1])
        if (!Number.isFinite(n)) return NaN
        const idx = n - 1
        return idx >= 0 ? idx : NaN
      }
    const fastNormalizeOrderNo = (o) => String(o?.orderNo || o?.orderNumber || '').trim()
      const buildChildFromParent = (parent, childNo) => {
        const p = parent && typeof parent === 'object' ? parent : null
        const cn = String(childNo || '').trim()
        if (!p || !cn) return null
        const parentNoText = normalizeOrderNo(p) || requestedParentNo || cn.replace(/-\d+$/, '')
        const idx = parseChildIndex(cn)
        const pid = String(p?._id || p?.id || p?.key || '').trim()
        const items = extractItemsFromOrder(p)
        if (!items.length) return null
        const pickedByNo =
          items.find((it) => {
            if (!it || typeof it !== 'object') return false
            const itNo = String(it?.orderNo || it?.orderNumber || it?.subOrderNo || it?.subOrderNumber || '').trim()
            return itNo === cn
          }) || null
        const pickedByIdx = Number.isFinite(idx) && idx >= 0 && idx < items.length ? (items[idx] || null) : null
        const src = (pickedByNo && typeof pickedByNo === 'object') ? pickedByNo : ((pickedByIdx && typeof pickedByIdx === 'object') ? pickedByIdx : null)
        if (!src) return null

        const qty = src.quantity ?? src.orderQty ?? src.qty ?? src.orderQuantity ?? p?.quantity ?? p?.totalQty
        const unitPrice = src.unitPrice ?? src.listUnitPrice ?? p?.unitPrice
        const amount = src.amount ?? (Number(qty || 0) * Number(unitPrice || 0))
        const materialNo = src.materialNo ?? p?.materialNo
        const specification = src.specification ?? src.spec ?? p?.specification ?? p?.spec
        const goodsName = src.goodsName ?? src.title ?? src.productName ?? p?.goodsName ?? p?.productTitle ?? p?.title
        const productName = (
          src.productName ??
          src.productCategory ??
          src.productType ??
          src.category ??
          src.goodsName ??
          src.title ??
          p?.productName ??
          p?.productCategory ??
          p?.productType ??
          p?.category ??
          p?.goodsName ??
          p?.productTitle ??
          p?.title
        )

        const child = {
          ...p,
          ...src,
          _id: undefined,
          id: undefined,
          orderNo: cn,
          orderNumber: cn,
          goodsName,
          productName,
          materialNo,
          specification,
          spec: specification,
          quantity: qty,
          unitPrice,
          amount,
          status: p?.status,
          __itemChild: true,
          __parentNo: parentNoText,
          __parentOrderId: pid || undefined,
          items: [src]
        }
        return child
      }
      const isWeakForDetailView = (o) => {
        const b = toBrief(o)
        if (!b || typeof b !== 'object') return true
        if (!isMeaningful(b.customerName)) return true
        const score = briefScore(b)
        return score < 3
      }
      const requestedNo = String(orderNo || '').trim()
      const requestedParentNo = String(parentOrderNo || '').trim()
      const isRequestedChild = Boolean(requestedNo && /-\d+$/.test(requestedNo))
      const parentKey = isRequestedChild ? (requestedParentNo || requestedNo.replace(/-\d+$/, '')) : ''

    // 快速路径：直接依赖 getOrderAny 的子单优先匹配；若返回足够“富”，立即渲染；否则继续走兼容回退
    try {
      const primaryToken = requestedNo || orderId || orderNo
      if (primaryToken) {
        const primaryRes = await getOrderSafe(primaryToken)
        const primary = unwrapOrderDetailResponse(primaryRes)
        if (primary) {
          let final = primary
          if (isRequestedChild) {
            const gotNo = fastNormalizeOrderNo(final)
            if (gotNo && gotNo !== requestedNo) {
              // 若看起来像父单且有 items，则快速从父单构造子单视图
              const hasMany = Array.isArray(final?.items) && final.items.length > 1
              const looksLikeParent = hasMany || (gotNo && !/-\d+$/.test(gotNo) && gotNo === parentKey)
              if (looksLikeParent) {
                const childFromFound = buildChildFromParent(final, requestedNo)
                if (childFromFound) final = childFromFound
              }
            }
          }
          if (!isRequestedChild) {
            const gotNo0 = fastNormalizeOrderNo(final)
            if (gotNo0 && /-\d+$/.test(gotNo0) && requestedNo) {
              try {
                const gRes0 = await orderAPI.getOrderGroup(requestedNo)
                const g0 = unwrapGroupResponse(gRes0)
                const pid0 = String(g0?.parent?._id || g0?.parent?.id || g0?.order?._id || g0?.order?.id || g0?._id || g0?.id || '').trim()
                if (pid0) {
                  const pRes0 = await getOrderSafe(pid0)
                  const p0 = unwrapOrderDetailResponse(pRes0)
                  if (p0) final = p0
                }
              } catch (_) { void _ }
            }
          }
          
          if (isWeakForDetailView(final)) {
            const fid = String(final?._id || final?.id || '').trim()
            if (fid) {
              try {
                const richerRes = await getOrderSafe(fid)
                const richer = unwrapOrderDetailResponse(richerRes)
                if (richer) {
                  let richFinal = richer
                  if (isRequestedChild) {
                    const gotNo2 = fastNormalizeOrderNo(richFinal)
                    if (gotNo2 && gotNo2 !== requestedNo) {
                      const hasMany2 = Array.isArray(richFinal?.items) && richFinal.items.length > 1
                      const looksLikeParent2 = hasMany2 || (gotNo2 && !/-\d+$/.test(gotNo2) && gotNo2 === parentKey)
                      if (looksLikeParent2) {
                        const child2 = buildChildFromParent(richFinal, requestedNo)
                        if (child2) richFinal = child2
                      }
                    }
                  }
                  if (!isWeakForDetailView(richFinal)) {
                    if (reqId === relatedDetailReqIdRef.current) {
                      setRelatedDetailOrder(richFinal)
                      const finalNo2 = fastNormalizeOrderNo(richFinal)
                      if (finalNo2) setRelatedDetailRequestedNo(finalNo2)
                      setRelatedDetailLoading(false)
                      return
                    }
                  }
                }
              } catch (_) { /* ignore */ }
            }
          } else {
            if (reqId === relatedDetailReqIdRef.current) {
              setRelatedDetailOrder(final)
              const finalNo = fastNormalizeOrderNo(final)
              if (finalNo) setRelatedDetailRequestedNo(finalNo)
              setRelatedDetailLoading(false)
              return
            }
          }
        }
      }
    } catch (_) { /* 忽略，进入后续兼容回退 */ }

      let found = null
      if (isRequestedChild && requestedNo) {
        const res = await getOrderSafe(requestedNo)
        found = unwrapOrderDetailResponse(res)
      }
      if (!found && orderId) {
        const res = await getOrderSafe(orderId)
        found = unwrapOrderDetailResponse(res)
        if (found) {
          const foundNo = normalizeOrderNo(found)
          if (isRequestedChild && foundNo && /-\d+$/.test(foundNo) && foundNo !== requestedNo) {
            found = null
          } else if (!isSameOrder(found)) {
            found = null
          }
        }
      }
      if (!found && orderNo) {
        const res = await getOrderSafe(orderNo)
        found = unwrapOrderDetailResponse(res)
      }
      if (!found && orderNo) {
        try {
          const res = await orderAPI.getOrders({ page: 1, limit: 10, keyword: orderNo })
          const list = unwrapOrdersListResponse(res)
          const listFound = (list || []).find((o) => String(o?.orderNo || o?.orderNumber || '').trim() === orderNo) || null
          found = listFound
          const maybeId = String(listFound?._id || listFound?.id || listFound?.key || listFound?.orderId || '').trim()
          if (listFound && maybeId) {
            const res2 = await getOrderSafe(maybeId)
            const detailFound = unwrapOrderDetailResponse(res2)
            found = pickBetterOrder(listFound, detailFound)
          }
        } catch (_) { void 0 }
      }
      if (!found) {
        const cloudById = orderId ? await getOrderFromCloudBridge(orderId) : null
        const cloudOkById = cloudById && isSameOrder(cloudById) ? cloudById : null
        const cloud = cloudOkById || (orderNo ? await getOrderFromCloudBridge(orderNo) : null)
        if (cloud) found = cloud
      }
      if (!found) {
        message.error('未找到关联订单')
        return
      }

      const gotNo = normalizeOrderNo(found)
      if (!isRequestedChild && requestedNo && gotNo && /-\d+$/.test(gotNo)) {
        // 请求的是主号，但拿到了子单；优先尝试定位父单，否则保留子单作为降级展示
        try {
          const gRes1 = await orderAPI.getOrderGroup(requestedNo)
          const g1 = unwrapGroupResponse(gRes1)
          const pid1 = String(g1?.parent?._id || g1?.parent?.id || g1?.order?._id || g1?.order?.id || g1?._id || g1?.id || '').trim()
          if (pid1) {
            const pRes1 = await getOrderSafe(pid1)
            const p1 = unwrapOrderDetailResponse(pRes1)
            if (p1) found = p1
          }
        } catch (_) { /* 保留子单作为降级 */ }
      }
      if (reqId !== relatedDetailReqIdRef.current) return
      if (requestedNo && gotNo && gotNo === requestedNo && !isWeakForDetailView(found)) {
        setRelatedDetailOrder(found)
        setRelatedDetailRequestedNo(gotNo)
        return
      }
      if (isRequestedChild) {
        try {
          const groupKey = parentKey
          if (groupKey) {
            const groupRes = await orderAPI.getOrderGroup(groupKey)
            const group = unwrapGroupResponse(groupRes)
            const children = Array.isArray(group?.children) ? group.children : []
            const hit =
              children.find((c) => String(c?.orderNo || c?.orderNumber || c?.subOrderNo || c?.subOrderNumber || '').trim() === requestedNo) ||
              null
            if (hit) {
              const hid = String(hit?._id || hit?.id || '').trim()
              if (hid) {
                const detailRes = await getOrderSafe(hid)
                const detail = unwrapOrderDetailResponse(detailRes)
                if (detail) found = pickBetterOrder(hit, detail)
                else found = pickBetterOrder(found, hit)
              } else {
                found = pickBetterOrder(found, hit)
              }
            }
          }
        } catch (_) { void 0 }

        try {
          const hasMany = extractItemsFromOrder(found).length > 1
          const looksLikeParent =
            (gotNo && !/-\d+$/.test(gotNo) && gotNo === parentKey) ||
            (gotNo && gotNo === parentKey) ||
            (!gotNo && Boolean(parentKey))
          if (looksLikeParent || hasMany) {
            const childFromFound = buildChildFromParent(found, requestedNo)
            if (childFromFound) found = childFromFound
          }
        } catch (_) { void 0 }

        if (isWeakForDetailView(found)) {
          try {
            if (parentKey) {
              const parentRes = await getOrderSafe(parentKey)
              const parent = unwrapOrderDetailResponse(parentRes)
              const child = buildChildFromParent(parent, requestedNo)
              if (child) {
                const prev = found && typeof found === 'object' ? found : {}
                const merged = { ...prev, ...child }
                merged.orderNo = requestedNo
                merged.orderNumber = requestedNo
                merged.__itemChild = true
                merged.__parentNo = child.__parentNo
                if (child.__parentOrderId) merged.__parentOrderId = child.__parentOrderId
                found = merged
              }
            }
          } catch (_) { void 0 }
        }
      }
      if (requestedNo && isWeakForDetailView(found)) {
        try {
          const tryMergeFromList = async (kw) => {
            const keyword = String(kw || '').trim()
            if (!keyword) return
            const res = await orderAPI.getOrders({ page: 1, limit: 50, keyword })
            const list = unwrapOrdersListResponse(res)
            const hit = (list || []).find((x) => String(x?.orderNo || x?.orderNumber || '').trim() === requestedNo) || null
            if (!hit) return
            found = pickBetterOrder(found, hit)
            const hid = String(hit?._id || hit?.id || hit?.key || '').trim()
            if (hid) {
              const detailRes = await getOrderSafe(hid)
              const detail = unwrapOrderDetailResponse(detailRes)
              if (detail) found = pickBetterOrder(found, detail)
            }
          }
          await tryMergeFromList(requestedNo)
          if (requestedParentNo && requestedParentNo !== requestedNo) await tryMergeFromList(requestedParentNo)
        } catch (_) { void 0 }
      }
      if (isRequestedChild) {
        try {
          const ensureChildView = () => {
            if (!parentKey) return
            const finalNo = normalizeOrderNo(found)
            if (finalNo === requestedNo) return
            const hasMany = extractItemsFromOrder(found).length > 1
            const looksLikeParent = (finalNo && !/-\d+$/.test(finalNo) && finalNo === parentKey) || Boolean(hasMany)
            if (!looksLikeParent) return
            const childFromFound = buildChildFromParent(found, requestedNo)
            if (childFromFound) found = childFromFound
          }
          ensureChildView()
        } catch (_) { void 0 }
      }

      if (isWeakForDetailView(found)) {
        const sku = await loadSkuFromOrder(found)
        if (sku) {
          const synthesized = buildSyntheticItemFromSku(found, sku)
          const nextItems = synthesized && typeof synthesized === 'object' ? [synthesized] : []
          const next = { ...(found && typeof found === 'object' ? found : {}) }
          if (nextItems.length) next.items = nextItems
          found = next
        }
      }

      if (reqId !== relatedDetailReqIdRef.current) return
      if (isRequestedChild && parentKey && !(found && typeof found === 'object' && found.__itemChild)) {
        try {
          const foundNo = normalizeOrderNo(found)
          const hasMany = extractItemsFromOrder(found).length > 1
          const looksLikeParent = hasMany || (foundNo && !/-\d+$/.test(foundNo) && foundNo === parentKey)
          if (looksLikeParent) {
            const next = { ...(found && typeof found === 'object' ? found : {}) }
            next.orderNo = parentKey
            next.orderNumber = parentKey
            found = next
          }
        } catch (_) { void 0 }
      }
      setRelatedDetailOrder(found)
      const finalNo = normalizeOrderNo(found)
      if (finalNo) setRelatedDetailRequestedNo(finalNo)
    } catch (_) {
      message.error('获取订单信息失败')
    } finally {
      setOrderBriefLoadingKey('')
      if (reqId === relatedDetailReqIdRef.current) setRelatedDetailLoading(false)
    }
  }

  const openOrderDetailInOrderManagement = undefined

  const onExportExcel = () => {
    try {
      const isFullColumns = isFromPurchaseOrder || isFromInventory
      const totalCols = isFullColumns ? 13 : 8
      const metaRightSpan = isFullColumns ? 4 : 3
      const metaLeftSpan = totalCols - metaRightSpan
      const wb = XLSX.utils.book_new()
      const sheetData = []

      const title = '昆山群鑫纸板订购单'
      sheetData.push([title])
      const metaRow = Array.from({ length: totalCols }).fill('')
      metaRow[0] = `供应商简称：${supplierShortName || ''}`
      metaRow[metaLeftSpan] = `订购日：${orderDateText || ''}`
      sheetData.push(metaRow)

      const header1 = Array.from({ length: totalCols }).fill('')
      header1[0] = '序号'
      header1[1] = '材质'
      header1[2] = '楞别'
      header1[3] = '规格（mm）'
      header1[5] = '压线规格（mm）'
      header1[6] = '压线类型'
      header1[7] = '数量'
      if (isFullColumns) {
        header1[8] = '送货数'
        header1[9] = '单价'
        header1[10] = '纸板金额'
        header1[11] = '订单号'
        header1[12] = '入库时间'
      }
      sheetData.push(header1)

      const header2 = Array.from({ length: totalCols }).fill('')
      header2[3] = '宽（门幅）'
      header2[4] = '长'
      sheetData.push(header2)

      ;(items || []).forEach((r, idx) => {
        const amountText = computeRowAmount(r)
        const unitPriceText = (() => {
          const v = getRowUnitPrice(r)
          if (!Number.isFinite(v) || v <= 0) return ''
          return String(Number(v.toFixed(6)))
        })()
        const inboundAtText = r.inboundAt ? dayjs(r.inboundAt).format('YYYY-MM-DD HH:mm:ss') : ''
        const relatedOrderNoText = String(r.relatedOrderNo || '').trim()
        const hasContent = Boolean(
          String(r.material || '').trim() ||
          String(r.flute || '').trim() ||
          String(r.specWidth || '').trim() ||
          String(r.specLength || '').trim() ||
          String(r.quantity || '').trim() ||
          String(r.deliveryQty || '').trim() ||
          String(r.unitPrice || '').trim() ||
          String(r.amount || '').trim() ||
          relatedOrderNoText
        )
        const creaseSpecText = String(r.creaseSpec || '').trim() || (hasContent ? '—' : '')
        const creaseTypeText = String(r.creaseType || '').trim() || (hasContent ? '—' : '')
        if (isFullColumns) {
          sheetData.push([
            idx + 1,
            r.material || '',
            r.flute || '',
            r.specWidth || '',
            r.specLength || '',
            creaseSpecText,
            creaseTypeText,
            r.quantity || '',
            r.deliveryQty || '',
            unitPriceText || '',
            amountText || '',
            relatedOrderNoText || '',
            inboundAtText || ''
          ])
        } else {
          sheetData.push([
            idx + 1,
            r.material || '',
            r.flute || '',
            r.specWidth || '',
            r.specLength || '',
            creaseSpecText,
            creaseTypeText,
            r.quantity || ''
          ])
        }
      })

      const ws = XLSX.utils.aoa_to_sheet(sheetData)

      const merge = (sR, sC, eR, eC) => ({ s: { r: sR, c: sC }, e: { r: eR, c: eC } })
      ws['!merges'] = ws['!merges'] || []
      ws['!merges'].push(
        merge(0, 0, 0, totalCols - 1),
        merge(1, 0, 1, metaLeftSpan - 1),
        merge(1, metaLeftSpan, 1, totalCols - 1),
        merge(2, 0, 3, 0),
        merge(2, 1, 3, 1),
        merge(2, 2, 3, 2),
        merge(2, 3, 2, 4),
        merge(2, 5, 3, 5),
        merge(2, 6, 3, 6),
        merge(2, 7, 3, 7)
      )

      if (isFullColumns) {
        ws['!merges'].push(
          merge(2, 8, 3, 8),
          merge(2, 9, 3, 9),
          merge(2, 10, 3, 10),
          merge(2, 11, 3, 11),
          merge(2, 12, 3, 12)
        )
      }

      ws['!cols'] = isFullColumns
        ? [
            { wch: 6 },
            { wch: 12 },
            { wch: 8 },
            { wch: 10 },
            { wch: 10 },
            { wch: 18 },
            { wch: 10 },
            { wch: 8 },
            { wch: 10 },
            { wch: 10 },
            { wch: 12 },
            { wch: 16 },
            { wch: 18 }
          ]
        : [
            { wch: 6 },
            { wch: 12 },
            { wch: 8 },
            { wch: 10 },
            { wch: 10 },
            { wch: 18 },
            { wch: 10 },
            { wch: 8 }
          ]

      ws['!rows'] = ws['!rows'] || []
      ws['!rows'][0] = { hpt: 30 }
      ws['!rows'][1] = { hpt: 20 }
      ws['!rows'][2] = { hpt: 20 }
      ws['!rows'][3] = { hpt: 20 }

      const border = {
        top: { style: 'thin', color: { rgb: '000000' } },
        bottom: { style: 'thin', color: { rgb: '000000' } },
        left: { style: 'thin', color: { rgb: '000000' } },
        right: { style: 'thin', color: { rgb: '000000' } }
      }

      const ensureCell = (r, c) => {
        const addr = XLSX.utils.encode_cell({ r, c })
        if (!ws[addr]) ws[addr] = { t: 's', v: '' }
        return ws[addr]
      }

      const applyStyle = (r, c, style) => {
        const cell = ensureCell(r, c)
        cell.s = style
      }

      const baseFont = { name: '宋体', sz: 11, color: { rgb: '000000' } }
      const center = { horizontal: 'center', vertical: 'center', wrapText: true }
      const left = { horizontal: 'left', vertical: 'center', wrapText: true }
      const right = { horizontal: 'right', vertical: 'center', wrapText: true }

      const lastRow = sheetData.length - 1
      for (let r = 0; r <= lastRow; r += 1) {
        for (let c = 0; c < totalCols; c += 1) {
          const isTitle = r === 0
          const isMeta = r === 1
          const isHeader = r === 2 || r === 3

          if (isTitle) {
            applyStyle(r, c, { font: { ...baseFont, sz: 20, bold: true }, alignment: center })
            continue
          }

          if (isMeta) {
            applyStyle(r, c, {
              font: { ...baseFont, sz: 12, bold: true },
              alignment: c <= metaLeftSpan - 1 ? left : right,
              border
            })
            continue
          }

          if (isHeader) {
            applyStyle(r, c, {
              font: { ...baseFont, bold: true },
              alignment: center,
              border
            })
            continue
          }

          applyStyle(r, c, { font: baseFont, alignment: center, border })
        }
      }

      XLSX.utils.book_append_sheet(wb, ws, '纸板订购单')
      const fileName = `纸板订购单${dayjs().format('YYYY')}-${supplierShortName || '供应商'}-${dayjs().format('YYYYMMDDHHmmss')}.xlsx`
      XLSX.writeFile(wb, fileName)
      message.success('已导出Excel')
    } catch (e) {
      message.error('导出失败')
    }
  }

  const isFullColumns = isFromPurchaseOrder || isFromInventory
  const tableColSpan = isFullColumns ? 13 : 8
  const metaRightSpan = isFullColumns ? 4 : 3
  const metaLeftSpan = tableColSpan - metaRightSpan
  const colWidths = isFullColumns
    ? ['4%', '9%', '6%', '7%', '7%', '15%', '8%', '7%', '8%', '7%', '8%', '10%', '10%']
    : ['6%', '15%', '8%', '10%', '10%', '22%', '12%', '17%']
  const filteredCandidateOrders = useMemo(() => {
    const kw = String(candidateKeyword || '').trim().toLowerCase()
    const list = Array.isArray(candidateOrders) ? candidateOrders : []
    const row = (Array.isArray(items) && Number.isFinite(Number(modifyIndex)) && modifyIndex >= 0) ? (items[modifyIndex] || {}) : {}
    const excludeId = String(row?.relatedOrderId || '').trim()
    const excludeNo = String(row?.relatedOrderNo || '').trim()
    const base = list.filter((o) => {
      const id = String(o?.id || '').trim()
      const no = String(o?.orderNo || '').trim()
      if (excludeId && id && id === excludeId) return false
      if (excludeNo && no && no === excludeNo) return false
      return true
    })
    if (!kw) return base
    return base.filter((o) => {
      return (
        String(o?.orderNo || '').toLowerCase().includes(kw) ||
        String(o?.customerName || '').toLowerCase().includes(kw) ||
        String(o?.goodsName || '').toLowerCase().includes(kw)
      )
    })
  }, [candidateOrders, candidateKeyword, items, modifyIndex])

  const relatedDetailOrderNoText = useMemo(() => {
    const s = String(
      relatedDetailOrder?.orderNo ||
      relatedDetailOrder?.orderNumber ||
      relatedDetailOrder?.order_no ||
      relatedDetailOrder?.order_number ||
      relatedDetailRequestedNo ||
      ''
    ).trim()
    return s
  }, [relatedDetailOrder, relatedDetailRequestedNo])

  const relatedDetailItems = useMemo(() => {
    const o = relatedDetailOrder && typeof relatedDetailOrder === 'object' ? relatedDetailOrder : null
    if (!o) return []
    const toArr = (v) => {
      if (Array.isArray(v)) return v
      if (v && typeof v === 'object') return Object.values(v)
      return []
    }
    const candidates = [
      o.items,
      o.products,
      o.productList,
      o.product_list,
      o.orderItems,
      o.order_items,
      o.orderItemList,
      o.order_item_list,
      o.details,
      o.detailList,
      o.detail_list,
      o.lines,
      o.lineItems,
      o.data?.items,
      o.data?.products,
      o.data?.productList,
      o.data?.product_list,
      o.data?.data?.items,
      o.data?.data?.products,
      o.data?.data?.productList,
      o.data?.data?.product_list,
      o.meta?.items,
      o.meta?.products,
      o.meta?.productList,
      o.meta?.product_list
    ]
    for (const c of candidates) {
      const arr = toArr(c)
      if (arr.length) {
        return arr.map((it, idx) => ({
          ...(it && typeof it === 'object' ? it : { title: String(it ?? '') }),
          __idx: idx + 1,
          __key: String(it?._id || it?.id || it?.key || `${relatedDetailOrderNoText || 'order'}:${idx + 1}`)
        }))
      }
    }
    return []
  }, [relatedDetailOrder, relatedDetailOrderNoText])

  const relatedDetailStatusMap = useMemo(() => {
    return {
      ordered: { text: '已下单', color: 'blue' },
      producing: { text: '生产中', color: 'geekblue' },
      stocked: { text: '已入库', color: 'cyan' },
      shipped: { text: '已发货', color: 'green' },
      completed: { text: '已完成', color: 'green' },
      canceled: { text: '已取消', color: 'default' },
      cancelled: { text: '已取消', color: 'default' }
    }
  }, [])

  const relatedDetailView = useMemo(() => {
    const o = relatedDetailOrder && typeof relatedDetailOrder === 'object' ? relatedDetailOrder : null
    if (!o) return null
    const safeText = (v) => {
      const s = String(v ?? '').trim()
      return s ? s : ''
    }
    const isMeaningfulText = (v) => {
      const s = safeText(v)
      if (!s) return false
      return !['-', '—', '--', '---', '暂无', '无', 'null', 'undefined'].includes(s.toLowerCase())
    }
    const pickText = (...arr) => {
      for (const v of arr) {
        if (isMeaningfulText(v)) return safeText(v)
      }
      return ''
    }
    const pickNum = (...arr) => {
      for (const v of arr) {
        const s = String(v ?? '').trim()
        if (!s || ['-', '—', '--', '---', '暂无', '无', 'null', 'undefined'].includes(s.toLowerCase())) continue
        const n = Number(s)
        if (Number.isFinite(n)) return n
      }
      return NaN
    }
    const fmtMoney = (n) => (Number.isFinite(n) ? n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : '-')

    const data0 = (o?.data && typeof o.data === 'object') ? o.data : {}
    const meta0 = (o?.meta && typeof o.meta === 'object') ? o.meta : {}
    const brief0 = (meta0?.brief && typeof meta0.brief === 'object') ? meta0.brief : {}
    const product0 = (o?.product && typeof o.product === 'object') ? o.product : {}
    const firstItem0 = (Array.isArray(o?.items) && o.items.length && typeof o.items[0] === 'object') ? o.items[0] : {}
    const firstItemData0 = (firstItem0?.data && typeof firstItem0.data === 'object') ? firstItem0.data : {}
    const sku0 = (() => {
      const candidates = [
        o?.sku,
        data0?.sku,
        meta0?.sku,
        brief0?.sku,
        product0?.sku,
        firstItem0?.sku,
        firstItemData0?.sku
      ]
      for (const c of candidates) {
        if (c && typeof c === 'object') return c
      }
      return null
    })()

    const orderNo = safeText(relatedDetailOrderNoText)
    const status = safeText(o.status || o.orderStatus || o.state)
    const customerName = pickText(
      o.customerName,
      o.customer?.companyName,
      o.customer?.shortName,
      o.customer?.name,
      data0?.customerName,
      data0?.customer?.companyName,
      data0?.customer?.shortName,
      data0?.customer?.name,
      o.meta?.customerName,
      o.meta?.customer?.companyName,
      o.meta?.customer?.shortName,
      o.meta?.customer?.name
    )
    const deliveryDate = pickText(o.deliveryDate, o.delivery_date, o.meta?.deliveryDate, o.meta?.delivery_date)
    const notes = pickText(o.notes, o.remark, o.remarks, o.memo, o.comment, o.meta?.notes, o.meta?.remark)
    const orderId = safeText(o.__parentOrderId || o._id || o.id)

    const rawAttachments =
      o.attachments || o.attachmentList || o.files ||
      data0?.attachments || data0?.attachmentList || data0?.files ||
      o.meta?.attachments || o.meta?.files || []
    const attachments = Array.isArray(rawAttachments)
      ? rawAttachments.map((x, idx) => {
        if (!x) return null
        if (typeof x === 'string') {
          const url = safeText(x)
          return url ? { uid: `a_${idx}`, url, name: url.split('/').pop() || url } : null
        }
        if (typeof x === 'object') {
          const url = pickText(x.url, x.thumbUrl, x.preview, x.path, x.fileUrl, x.file_url)
          const name = pickText(x.name, x.filename, x.fileName, x.originalName, x.original_name) || (url ? (url.split('/').pop() || url) : '')
          if (!url && !name) return null
          return { uid: String(x.uid || x.id || x._id || `a_${idx}`), url, name }
        }
        return null
      }).filter(Boolean)
      : []

    const items = (Array.isArray(relatedDetailItems) && relatedDetailItems.length ? relatedDetailItems : [o]).map((it, idx) => {
      const row = it && typeof it === 'object' ? it : { title: String(it ?? '') }
      const rowData = (row?.data && typeof row.data === 'object') ? row.data : {}
      const rowMeta = (row?.meta && typeof row.meta === 'object') ? row.meta : {}
      const rowBrief = (rowMeta?.brief && typeof rowMeta.brief === 'object') ? rowMeta.brief : {}
      const rowProduct = (row?.product && typeof row.product === 'object') ? row.product : {}
      const rowSku = (() => {
        const candidates = [
          row?.sku,
          rowData?.sku,
          rowMeta?.sku,
          rowBrief?.sku,
          rowProduct?.sku,
          sku0
        ]
        for (const c of candidates) {
          if (c && typeof c === 'object') return c
        }
        return null
      })()
      const productName = pickText(row.productName, row.productTitle, row.goodsName, row.goods_name, row.title, o.productName, o.productTitle, o.goodsName)
      const productName2 = pickText(
        productName,
        rowData?.productName, rowData?.productTitle, rowData?.goodsName, rowData?.title,
        rowProduct?.productName, rowProduct?.productTitle, rowProduct?.goodsName, rowProduct?.title,
        rowBrief?.productName, rowBrief?.productTitle, rowBrief?.goodsName, rowBrief?.title,
        sku0?.name, sku0?.goodsName, sku0?.productName,
        rowSku?.name, rowSku?.goodsName, rowSku?.productName,
        product0?.productName, product0?.productTitle, product0?.goodsName, product0?.title,
        brief0?.productName, brief0?.productTitle, brief0?.goodsName, brief0?.title
      )
      const spec = pickText(
        row.spec, row.specification, row.sizeText, row.size_text,
        rowData?.spec, rowData?.specification, rowData?.sizeText, rowData?.size_text,
        rowProduct?.spec, rowProduct?.specification,
        rowBrief?.spec, rowBrief?.specification,
        rowSku?.spec, rowSku?.specification,
        o.spec, o.specification,
        data0?.spec, data0?.specification,
        product0?.spec, product0?.specification,
        brief0?.spec, brief0?.specification,
        sku0?.spec, sku0?.specification,
        firstItem0?.spec, firstItem0?.specification,
        firstItemData0?.spec, firstItemData0?.specification
      )
      const materialNo = pickText(
        row.materialNo, row.material_no,
        rowData?.materialNo, rowData?.material_no,
        rowProduct?.materialNo, rowProduct?.material_no,
        rowBrief?.materialNo, rowBrief?.material_no,
        rowSku?.materialNo, rowSku?.material_no,
        o.materialNo, o.material_no,
        data0?.materialNo, data0?.material_no,
        product0?.materialNo, product0?.material_no,
        brief0?.materialNo, brief0?.material_no,
        sku0?.materialNo, sku0?.material_no,
        firstItem0?.materialNo, firstItem0?.material_no,
        firstItemData0?.materialNo, firstItemData0?.material_no
      )
      const rawMaterialCode = pickText(
        row.materialCode, row.material_code, row.material,
        rowData?.materialCode, rowData?.material_code, rowData?.material,
        rowProduct?.materialCode, rowProduct?.material_code, rowProduct?.material,
        rowBrief?.materialCode, rowBrief?.material_code, rowBrief?.material,
        rowSku?.materialCode, rowSku?.material_code, rowSku?.material,
        o.materialCode, o.material_code, o.material,
        data0?.materialCode, data0?.material_code, data0?.material,
        product0?.materialCode, product0?.material_code, product0?.material,
        brief0?.materialCode, brief0?.material_code, brief0?.material,
        sku0?.materialCode, sku0?.material_code, sku0?.material
      )
      const materialCode = (() => {
        const mc = safeText(rawMaterialCode)
        if (mc) return mc
        const mn = safeText(materialNo)
        if (!mn) return ''
        const parts = mn.split(/[/／]/).map((x) => String(x || '').trim()).filter(Boolean)
        if (parts.length >= 2 && parts[0] && !/^\d{6,}$/.test(parts[0])) return parts[0]
        return ''
      })()
      const flute = pickText(
        row.flute, row.fluteType, row.flute_type, row.flute_name,
        rowData?.flute, rowData?.fluteType, rowData?.flute_type, rowData?.flute_name,
        rowProduct?.flute, rowProduct?.fluteType, rowProduct?.flute_type,
        rowBrief?.flute, rowBrief?.fluteType, rowBrief?.flute_type,
        rowSku?.flute, rowSku?.fluteType, rowSku?.flute_type,
        o.flute, o.fluteType, o.flute_type,
        data0?.flute, data0?.fluteType, data0?.flute_type,
        product0?.flute, product0?.fluteType, product0?.flute_type,
        brief0?.flute, brief0?.fluteType, brief0?.flute_type,
        sku0?.flute, sku0?.fluteType, sku0?.flute_type
      )
      const creasingType = pickText(
        row.creasingType, row.creasing_type,
        rowData?.creasingType, rowData?.creasing_type,
        rowProduct?.creasingType, rowProduct?.creasing_type,
        rowBrief?.creasingType, rowBrief?.creasing_type,
        rowSku?.creasingType, rowSku?.creasing_type,
        o.creasingType, o.creasing_type,
        data0?.creasingType, data0?.creasing_type,
        product0?.creasingType, product0?.creasing_type,
        brief0?.creasingType, brief0?.creasing_type,
        sku0?.creasingType, sku0?.creasing_type
      )
      const creaseSpec = (() => {
        const direct = pickText(row.creaseSpec, row.crease_spec, row.creasingSpec, row.creasing_spec)
        if (direct) return direct
        const s1 = pickNum(row.creasingSize1, row.creasing_size1, o.creasingSize1, o.creasing_size1)
        const s2 = pickNum(row.creasingSize2, row.creasing_size2, o.creasingSize2, o.creasing_size2)
        const s3 = pickNum(row.creasingSize3, row.creasing_size3, o.creasingSize3, o.creasing_size3)
        const parts = [s1, s2, s3].filter((n) => Number.isFinite(n) && n > 0)
        return parts.length ? parts.join('-') : ''
      })()
      const sku = pickText(
        row.skuName,
        row.sku?.name,
        row.sku?.skuName,
        rowSku?.name,
        rowSku?.skuName,
        sku0?.name,
        sku0?.skuName,
        row.goodsName,
        row.goods_name,
        row.productTitle,
        row.title
      )
      const quantity = pickNum(row.quantity, row.qty, row.count, row.sheetCount, row.sheet_count, o.quantity, o.qty, o.sheetCount, o.sheet_count)
      const unitPrice = pickNum(row.unitPrice, row.unit_price, row.price, row.salePrice, row.sale_price, o.unitPrice, o.unit_price)
      const amount = pickNum(row.amount, row.totalAmount, row.total_amount)
      const computedAmount = Number.isFinite(amount) ? amount : (Number.isFinite(quantity) && Number.isFinite(unitPrice) ? quantity * unitPrice : NaN)
      return {
        __key: String(row._id || row.id || row.key || `${orderNo || orderId || 'order'}:${idx + 1}`),
        productName: productName2,
        spec,
        materialCode,
        materialNo: safeText(materialNo),
        flute,
        creasingType,
        creaseSpec,
        sku,
        quantity: Number.isFinite(quantity) ? quantity : null,
        unitPrice: Number.isFinite(unitPrice) ? unitPrice : null,
        amount: Number.isFinite(computedAmount) ? computedAmount : null
      }
    })

    const qrCodeUrl = (() => {
      const rawUrl = safeText(
        o.qrCodeUrl || o.qr_code_url ||
        data0?.qrCodeUrl || data0?.qr_code_url ||
        o.meta?.qrCodeUrl || o.meta?.qr_code_url ||
        meta0?.qrCodeUrl || meta0?.qr_code_url
      )
      const lower = rawUrl.toLowerCase()
      const isChild = /-\d+$/.test(orderNo)
      const preferRaw = rawUrl && !lower.includes('api.qrserver.com/v1/create-qr-code') && !isChild
      const payload = JSON.stringify({ v: 1, orderId, orderNo })
      if (preferRaw) return rawUrl
      if (!orderNo && !orderId) return ''
      return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}`
    })()

    return {
      orderNo,
      status,
      customerName,
      deliveryDate,
      notes,
      orderId,
      qrCodeUrl,
      items,
      attachments
    }
  }, [relatedDetailItems, relatedDetailOrder, relatedDetailOrderNoText, relatedDetailRequestedNo])

  const relatedDetailColumns = useMemo(() => {
    const pickText = (...arr) => {
      for (const v of arr) {
        const s = String(v ?? '').trim()
        if (s && !['-', '—', '--', '---', '暂无', '无', 'null', 'undefined'].includes(s.toLowerCase())) return s
      }
      return '-'
    }
    const pickNum = (...arr) => {
      for (const v of arr) {
        const n = Number(v)
        if (Number.isFinite(n)) return n
      }
      return NaN
    }
    const fmtNum = (n, digits = 2) => {
      if (!Number.isFinite(n)) return '-'
      return n.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits })
    }
    const fmtQty = (n) => {
      if (!Number.isFinite(n)) return '-'
      return String(n)
    }
    const calcAmount = (r) => {
      const q = pickNum(r?.quantity, r?.qty, r?.count, r?.sheetCount, r?.sheet_count)
      const p = pickNum(r?.unitPrice, r?.unit_price, r?.price, r?.salePrice, r?.sale_price)
      if (!Number.isFinite(q) || !Number.isFinite(p)) return NaN
      return q * p
    }
    return [
      { title: '序号', dataIndex: '__idx', key: '__idx', width: 70 },
      {
        title: '商品名称',
        key: 'goodsName',
        width: 220,
        render: (_, r) => pickText(r?.goodsName, r?.goods_name, r?.productTitle, r?.product_title, r?.productName, r?.product_name, r?.title)
      },
      {
        title: '规格',
        key: 'spec',
        width: 160,
        render: (_, r) => {
          const spec = pickText(r?.spec, r?.specification, r?.sizeText, r?.size_text, r?.boardSizeText, r?.board_size_text)
          const w = pickNum(r?.boardWidth, r?.board_width, r?.specWidth, r?.spec_width, r?.width)
          const h = pickNum(r?.boardHeight, r?.board_height, r?.specLength, r?.spec_length, r?.length)
          if (spec !== '-') return spec
          if (Number.isFinite(w) && Number.isFinite(h)) return `${w}×${h}`
          return '-'
        }
      },
      {
        title: '物料号',
        key: 'materialNo',
        width: 160,
        render: (_, r) => pickText(r?.materialNo, r?.material_no, r?.materialCode, r?.material_code, r?.material)
      },
      {
        title: '楞别',
        key: 'flute',
        width: 100,
        render: (_, r) => pickText(r?.flute, r?.fluteType, r?.flute_type)
      },
      {
        title: '数量',
        key: 'quantity',
        width: 100,
        render: (_, r) => fmtQty(pickNum(r?.quantity, r?.qty, r?.count, r?.sheetCount, r?.sheet_count))
      },
      {
        title: '单价',
        key: 'unitPrice',
        width: 100,
        render: (_, r) => fmtNum(pickNum(r?.unitPrice, r?.unit_price, r?.price, r?.salePrice, r?.sale_price), 2)
      },
      {
        title: '金额',
        key: 'amount',
        width: 120,
        render: (_, r) => fmtNum(calcAmount(r), 2)
      }
    ]
  }, [])

  return (
    <ConfigProvider locale={zhCN}>
      <div>
        <h2 className="page-title">{isFromInventory ? '纸板库存详情' : (isFromPurchaseOrder ? '采购详情' : '采购预览')}</h2>
        <Card style={{ marginBottom: 12 }}>
          <Space wrap size={10}>
            {!isFromPurchaseOrder ? (
              <Button type="primary" onClick={onCreatePurchaseOrder}>生成采购单</Button>
            ) : null}
            {isFromPurchaseOrder ? (
              <Button loading={repairLoading} onClick={onRepairAndSave}>重算压线并保存明细</Button>
            ) : null}
            <Button onClick={onExportExcel}>导出EXCEL</Button>
            <Button
              onClick={() => navigate(isFromInventory ? '/inventory' : (isFromPurchaseOrder ? '/purchase' : '/orders'))}
            >
              {isFromInventory ? '返回库存管理' : (isFromPurchaseOrder ? '返回采购管理' : '返回订单管理')}
            </Button>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 84 }}>采购单号：</div>
              <Input value={purchaseOrderNo} readOnly style={{ width: 220 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 84 }}>数量合计：</div>
              <Input value={String(totalQty)} readOnly style={{ width: 120 }} />
            </div>
          </Space>
        </Card>

        <Card>
          <style>
            {`
              .bp-sheet-wrap { width: 100%; overflow-x: hidden; }
              .bp-sheet { width: 100%; border-collapse: collapse; table-layout: fixed; background: #fff; }
              .bp-sheet th, .bp-sheet td { border: 1px solid #000; padding: 2px 4px; font-size: 13px; text-align: center; vertical-align: middle; }
              .bp-sheet .bp-title { font-size: 26px; font-weight: 700; height: 52px; }
              .bp-sheet .bp-meta { font-size: 15px; font-weight: 700; height: 36px; }
              .bp-sheet .bp-meta-left { text-align: left; padding-left: 10px; }
              .bp-sheet .bp-meta-right { text-align: right; padding-right: 10px; }
              .bp-sheet .bp-input, .bp-sheet .bp-input .ant-input { border: none !important; box-shadow: none !important; background: transparent !important; padding: 0 !important; height: 24px; text-align: center; }
              .bp-sheet .bp-meta .bp-input, .bp-sheet .bp-meta .bp-input .ant-input { font-size: 15px; font-weight: 700; text-align: left; }
              .bp-sheet .bp-meta-right .bp-input, .bp-sheet .bp-meta-right .bp-input .ant-input { text-align: right; }
              .bp-sheet .bp-edit-cell { padding: 0 !important; }
              .bp-sheet .bp-native-input { width: 100%; height: 24px; line-height: 24px; border: none; background: transparent; color: #111827; text-align: center; outline: none; box-sizing: border-box; }
              .bp-sheet .bp-native-input:focus { outline: 2px solid rgba(22, 119, 255, 0.35); outline-offset: 0; }
              .bp-sheet .bp-th { font-weight: 700; }
              .bp-sheet .bp-action-btn { padding: 0; height: 24px; }
            `}
          </style>

          <div className="bp-sheet-wrap">
            <table className="bp-sheet">
              <colgroup>
                {colWidths.map((w, i) => (
                  <col key={`c_${i}`} style={{ width: w }} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="bp-title" colSpan={tableColSpan}>昆山群鑫纸板订购单</th>
                </tr>
                <tr>
                  <th className="bp-meta bp-meta-left" colSpan={metaLeftSpan}>
                    供应商简称：
                    <Input
                      className="bp-input"
                      value={supplierShortName}
                      onChange={(e) => setSupplierShortName(e.target.value)}
                      style={{ width: 180, marginLeft: 6 }}
                    />
                  </th>
                  <th className="bp-meta bp-meta-right" colSpan={metaRightSpan}>
                    订购日：
                    <Input
                      className="bp-input"
                      value={orderDateText}
                      onChange={(e) => setOrderDateText(e.target.value)}
                      style={{ width: 160, marginLeft: 6 }}
                    />
                  </th>
                </tr>
                <tr>
                  <th className="bp-th" rowSpan={2}>序号</th>
                  <th className="bp-th" rowSpan={2}>材质</th>
                  <th className="bp-th" rowSpan={2}>楞别</th>
                  <th className="bp-th" colSpan={2}>规格（mm）</th>
                  <th className="bp-th" rowSpan={2}>压线规格（mm）</th>
                  <th className="bp-th" rowSpan={2}>压线类型</th>
                  <th className="bp-th" rowSpan={2}>数量</th>
                  {isFullColumns ? (
                    <>
                      <th className="bp-th" rowSpan={2}>送货数</th>
                      <th className="bp-th" rowSpan={2}>单价</th>
                      <th className="bp-th" rowSpan={2}>纸板金额</th>
                      <th className="bp-th" rowSpan={2}>订单号</th>
                      <th className="bp-th" rowSpan={2}>操作</th>
                    </>
                  ) : null}
                </tr>
                <tr>
                  <th className="bp-th">宽（门幅）</th>
                  <th className="bp-th">长</th>
                </tr>
              </thead>
              <tbody>
                {(items || []).map((r, idx) => (
                  <tr key={r.key || `r_${idx}`}>
                    <td>{idx + 1}</td>
                    <td>
                      <Input className="bp-input" value={r.material} onChange={(e) => onCellChange(idx, 'material', e.target.value)} />
                    </td>
                    <td>
                      <Input className="bp-input" value={r.flute} onChange={(e) => onCellChange(idx, 'flute', e.target.value)} />
                    </td>
                    <td>
                      <Input className="bp-input" value={r.specWidth} onChange={(e) => onCellChange(idx, 'specWidth', e.target.value)} />
                    </td>
                    <td>
                      <Input className="bp-input" value={r.specLength} onChange={(e) => onCellChange(idx, 'specLength', e.target.value)} />
                    </td>
                    <td>
                      <Input className="bp-input" value={r.creaseSpec} placeholder="—" onChange={(e) => onCellChange(idx, 'creaseSpec', e.target.value)} />
                    </td>
                    <td>
                      <Input className="bp-input" value={r.creaseType} placeholder="—" onChange={(e) => onCellChange(idx, 'creaseType', e.target.value)} />
                    </td>
                    <td>
                      <Input className="bp-input" value={r.quantity} onChange={(e) => onCellChange(idx, 'quantity', e.target.value)} />
                    </td>
                    {isFullColumns ? (
                      <>
                        <td className="bp-edit-cell" onMouseDown={focusTdInput} onTouchStart={focusTdInput}>
                          <input
                            className="bp-native-input"
                            inputMode="numeric"
                            value={r.deliveryQty ?? ''}
                            onChange={(e) => onCellChange(idx, 'deliveryQty', e.target.value)}
                            onInput={(e) => onCellChange(idx, 'deliveryQty', e.target.value)}
                          />
                        </td>
                        <td className="bp-edit-cell" onMouseDown={focusTdInput} onTouchStart={focusTdInput}>
                          <input
                            className="bp-native-input"
                            inputMode="decimal"
                            value={r.unitPrice ?? ''}
                            onChange={(e) => onUnitPriceChange(idx, e.target.value)}
                            onInput={(e) => onUnitPriceChange(idx, e.target.value)}
                          />
                        </td>
                        <td>
                          {computeRowAmount(r)}
                        </td>
                        <td>
                          {(() => {
                            const relatedNo = String(r.relatedOrderNo || '').trim()
                            const hasContent = Boolean(
                              String(r.material || '').trim() ||
                              String(r.flute || '').trim() ||
                              String(r.specWidth || '').trim() ||
                              String(r.specLength || '').trim() ||
                              String(r.creaseSpec || '').trim() ||
                              String(r.creaseType || '').trim() ||
                              String(r.quantity || '').trim() ||
                              String(r.deliveryQty || '').trim() ||
                              String(r.unitPrice || '').trim() ||
                              String(r.amount || '').trim()
                            )
                            if (!relatedNo) return hasContent ? '-' : ''
                            return (() => {
                              const parentNo = relatedNo.replace(/-\d+$/, '')
                              const displayNo = parentNo || relatedNo
                              const loadingKey = String(r.relatedOrderId || '').trim() || displayNo
                              return (
                                <a
                                  href="#"
                                  onClick={(e) => {
                                    e.preventDefault()
                                    const parentRow = { ...r, relatedOrderNo: displayNo, relatedOrderId: '' }
                                    openRelatedOrderBrief(parentRow)
                                  }}
                                  style={{ whiteSpace: 'nowrap' }}
                                >
                                  {orderBriefLoadingKey === loadingKey ? '加载中...' : displayNo}
                                </a>
                              )
                            })()
                          })()}
                        </td>
                        <td>
                          {r.inboundAt
                            ? dayjs(r.inboundAt).format('YYYY-MM-DD HH:mm:ss')
                            : (
                              isFromInventory ? (
                                <Button
                                  type="link"
                                  size="small"
                                  className="bp-action-btn"
                                  onClick={() => openModifyAssociation(idx)}
                                >
                                  修改关联
                                </Button>
                              ) : (
                                <Button
                                  type="link"
                                  size="small"
                                  className="bp-action-btn"
                                  onClick={() => onConfirmInbound(idx)}
                                >
                                  确认入库
                                </Button>
                              )
                            )}
                        </td>
                      </>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Modal
          title="修改关联"
          open={modifyOpen}
          onOk={submitModifyAssociation}
          onCancel={() => setModifyOpen(false)}
          okText="保存"
          cancelText="取消"
          destroyOnHidden
        >
          <Space direction="vertical" style={{ width: '100%' }} size={12}>
            <Input
              placeholder="搜索订单号/客户/商品"
              value={candidateKeyword}
              onChange={(e) => setCandidateKeyword(e.target.value)}
              allowClear
            />
            <Select
              value={candidatePickedId || undefined}
              placeholder={candidateLoading ? '加载中...' : '请选择订单号'}
              options={filteredCandidateOrders.map((o) => ({
                value: o.id,
                label: `${o.orderNo}${o.customerName ? ` - ${o.customerName}` : ''}${o.goodsName ? ` - ${o.goodsName}` : ''}`
              }))}
              onChange={(v) => setCandidatePickedId(String(v || ''))}
              loading={candidateLoading}
              showSearch={false}
              style={{ width: '100%' }}
              notFoundContent={candidateLoading ? '加载中...' : '无匹配订单'}
            />
          </Space>
        </Modal>
        <Modal
          title="订单详情"
          open={relatedDetailOpen}
          onCancel={() => setRelatedDetailOpen(false)}
          destroyOnHidden
          width={1000}
          footer={null}
          styles={{ body: { maxHeight: '80vh', overflowY: 'auto', padding: 24 } }}
        >
          <Spin spinning={relatedDetailLoading}>
            {relatedDetailView ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                <Card title="客户信息" size="small">
                  <Row gutter={24} align="top">
                    <Col xs={24} md={16}>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 72, color: '#666' }}>订单编号</div>
                          <div style={{ fontWeight: 500 }}>{relatedDetailView.orderNo || '-'}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 72, color: '#666' }}>客户名称</div>
                          <div>{relatedDetailView.customerName || '-'}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 72, color: '#666' }}>交付日期</div>
                          <div>{relatedDetailView.deliveryDate ? dayjs(relatedDetailView.deliveryDate).format('YYYY-MM-DD') : '-'}</div>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                          <div style={{ width: 72, color: '#666' }}>订单状态</div>
                          <div>
                            {(() => {
                              const key = String(relatedDetailView.status || '').trim()
                              const mapped = relatedDetailStatusMap[key]
                              const text = mapped?.text || key || '-'
                              const color = mapped?.color
                              return key ? <Tag color={color}>{text}</Tag> : '-'
                            })()}
                          </div>
                        </div>
                      </div>
                    </Col>
                    <Col xs={24} md={8} style={{ display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                      <div style={{ textAlign: 'center' }}>
                        <div style={{ marginBottom: 8, color: '#666' }}>订单二维码</div>
                        {relatedDetailView.qrCodeUrl
                          ? <AntImage width={160} src={relatedDetailView.qrCodeUrl} />
                          : <span style={{ color: '#999' }}>暂无二维码</span>}
                      </div>
                    </Col>
                  </Row>
                </Card>

                <Card title="产品列表" size="small">
                  <Table
                    dataSource={Array.isArray(relatedDetailView.items) && relatedDetailView.items.length ? relatedDetailView.items : []}
                    rowKey={(r) => r.__key}
                    pagination={false}
                    size="small"
                    scroll={{ x: 'max-content' }}
                    columns={[
                      { title: '产品名称', dataIndex: 'productName', key: 'productName', render: (v) => v || '-' },
                      { title: '规格', dataIndex: 'spec', key: 'spec', render: (v) => v || '-' },
                      { title: '材质', dataIndex: 'materialCode', key: 'materialCode', render: (v) => v || '-' },
                      { title: '物料号', dataIndex: 'materialNo', key: 'materialNo', render: (v) => v || '-' },
                      { title: '楞型', dataIndex: 'flute', key: 'flute', render: (v) => v || '-' },
                      {
                        title: '压线',
                        key: 'creasing',
                        render: (_, r) => {
                          const t = String(r?.creasingType || '').trim()
                          if (!t && !String(r?.creaseSpec || '').trim()) return '-'
                          if (t === '无压线') return '无压线'
                          const spec = String(r?.creaseSpec || '').trim()
                          return spec ? `${t || '压线'} ${spec}` : (t || '-')
                        }
                      },
                      { title: 'SKU', dataIndex: 'sku', key: 'sku', render: (v) => v || '-' },
                      {
                        title: '数量',
                        dataIndex: 'quantity',
                        key: 'quantity',
                        render: (v) => {
                          const s = String(v ?? '').trim()
                          if (!s || ['-', '—', '--', '---', '暂无', '无', 'null', 'undefined'].includes(s.toLowerCase())) return '-'
                          const n = Number(s)
                          if (!Number.isFinite(n)) return '-'
                          return String(n)
                        }
                      },
                      {
                        title: '单价',
                        dataIndex: 'unitPrice',
                        key: 'unitPrice',
                        render: (v) => {
                          const s = String(v ?? '').trim()
                          if (!s || ['-', '—', '--', '---', '暂无', '无', 'null', 'undefined'].includes(s.toLowerCase())) return '-'
                          const n = Number(s)
                          if (!Number.isFinite(n)) return '-'
                          return String(n)
                        }
                      },
                      {
                        title: '金额',
                        dataIndex: 'amount',
                        key: 'amount',
                        render: (v) => {
                          const s = String(v ?? '').trim()
                          if (!s || ['-', '—', '--', '---', '暂无', '无', 'null', 'undefined'].includes(s.toLowerCase())) return '-'
                          const n = Number(s)
                          if (!Number.isFinite(n)) return '-'
                          return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        }
                      }
                    ]}
                    locale={{ emptyText: '暂无数据' }}
                  />
                </Card>

                <Card title="附件图纸" size="small">
                  {Array.isArray(relatedDetailView.attachments) && relatedDetailView.attachments.length ? (
                    <Space wrap size={12}>
                      {relatedDetailView.attachments.map((a) => {
                        const url = String(a?.url || '').trim()
                        const name = String(a?.name || url || '').trim()
                        if (!url) return null
                        const lower = url.toLowerCase()
                        const isImage = /\.(png|jpe?g|gif|webp|bmp)$/i.test(lower)
                        return isImage ? (
                          <AntImage key={a.uid} width={120} src={url} />
                        ) : (
                          <a key={a.uid} href={url} target="_blank" rel="noreferrer">{name || '附件'}</a>
                        )
                      })}
                    </Space>
                  ) : (
                    <div style={{ color: '#999' }}>暂无附件</div>
                  )}
                </Card>

                <Card title="订单备注" size="small">
                  <div style={{ whiteSpace: 'pre-wrap' }}>{relatedDetailView.notes || '-'}</div>
                </Card>
              </div>
            ) : <div style={{ padding: 12, color: '#999' }}>未加载到订单数据</div>}
          </Spin>
        </Modal>
      </div>
    </ConfigProvider>
  )
}

export default BoardPurchasePreview
