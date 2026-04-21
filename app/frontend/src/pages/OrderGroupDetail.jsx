import React, { useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Descriptions, Space, Spin, Table, Tag } from 'antd'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { orderAPI } from '../services/api'
import { cachedCustomerAPI, cachedCustomerSkuAPI } from '../services/cachedAPI'
import { safeNavigateBack } from '../utils'

function OrderGroupDetail() {
  const { message } = App.useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const { orderNo: orderNoParam } = useParams()
  const [reloadTick, setReloadTick] = useState(0)
  const [loading, setLoading] = useState(false)
  const [orders, setOrders] = useState([])
  const [customerLoading, setCustomerLoading] = useState(false)
  const [customer, setCustomer] = useState(null)
  const [customerSkusLoading, setCustomerSkusLoading] = useState(false)
  const [customerSkus, setCustomerSkus] = useState([])

  const normalizeText = (v) => String(v == null ? '' : v).trim()
  const toNumber = (v) => {
    if (v === null || v === undefined || v === '') return NaN
    if (typeof v === 'number') return v
    const n = Number(String(v).trim())
    return Number.isFinite(n) ? n : NaN
  }
  const formatCrease = (o) => {
    const c1 = Number(o?.creasingSize1 ?? o?.creaseSize1 ?? o?.creasingSize_1 ?? o?.creaseSize_1 ?? o?.creasing_size1 ?? o?.crease_size1 ?? o?.creasing_size_1 ?? o?.crease_size_1 ?? 0)
    const c2 = Number(o?.creasingSize2 ?? o?.creaseSize2 ?? o?.creasingSize_2 ?? o?.creaseSize_2 ?? o?.creasing_size2 ?? o?.crease_size2 ?? o?.creasing_size_2 ?? o?.crease_size_2 ?? 0)
    const c3 = Number(o?.creasingSize3 ?? o?.creaseSize3 ?? o?.creasingSize_3 ?? o?.creaseSize_3 ?? o?.creasing_size3 ?? o?.crease_size3 ?? o?.creasing_size_3 ?? o?.crease_size_3 ?? 0)
    const type = normalizeText(o?.creasingType ?? o?.creasing_type ?? o?.creaseType ?? o?.crease_type ?? '').trim()
    const pressLine = normalizeText(
      o?.pressLine ||
      o?.press_line ||
      o?.pressLineSize ||
      o?.press_line_size ||
      o?.creasingSize ||
      o?.creaseSize ||
      o?.creasing_size ||
      o?.crease_size ||
      ''
    ).trim()
    const hasNums = Boolean(c1 || c2 || c3)

    if (pressLine) {
      const nums = (pressLine.match(/-?\d+(\.\d+)?/g) || []).map(Number).filter(Number.isFinite)
      const typeMatch = pressLine.match(/[（(]([^（）()]+)[）)]/)
      const t = typeMatch ? typeMatch[1] : ''
      if (nums.length >= 2) return `${nums.join('-')}${t ? ` (${t})` : ''}`
      return pressLine
    }

    if (!hasNums && !type) return '-'
    if (!hasNums) return type
    return `${c1}-${c2}-${c3}${type ? ` (${type})` : ''}`
  }
  const formatMoney3 = (v) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return '-'
    return n.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })
  }
  const formatMoney4 = (v) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return '-'
    return n.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  }
  const formatMoney0to3 = (v) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return '-'
    return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })
  }

  const calcOrderInfoScore = (o) => {
    const obj = o && typeof o === 'object' ? o : {}
    const items =
      Array.isArray(obj.items) ? obj.items
        : Array.isArray(obj.products) ? obj.products
          : Array.isArray(obj.productList) ? obj.productList
            : Array.isArray(obj.orderItems) ? obj.orderItems
              : Array.isArray(obj.order_items) ? obj.order_items
                : Array.isArray(obj?.data?.items) ? obj.data.items
                  : Array.isArray(obj?.data?.products) ? obj.data.products
                    : []
    const fields = [
      obj._id,
      obj.id,
      obj.orderNo,
      obj.orderNumber,
      obj.customerId,
      obj.customerName,
      obj.goodsName,
      obj.productTitle,
      obj.title,
      obj.materialNo,
      obj.specification,
      obj.spec,
      obj.unitPrice,
      obj.amount,
      obj.status
    ]
    let score = 0
    for (const v of fields) {
      const s = normalizeText(v)
      if (s) score += 1
    }
    if (items.length) score += 2
    return score
  }

  const calcListScore = (list) => {
    const arr = Array.isArray(list) ? list : []
    return arr.reduce((m, x) => Math.max(m, calcOrderInfoScore(x)), 0)
  }

  const setOrdersIfBetter = (nextOrders) => {
    setOrders((prev) => {
      const prevScore = calcListScore(prev)
      const nextScore = calcListScore(nextOrders)
      if (nextScore === 0 && prevScore > 0) return prev
      if (prevScore >= 6 && nextScore < prevScore) return prev
      return nextOrders
    })
  }

  const parentNo = useMemo(() => {
    const raw = normalizeText(orderNoParam)
    let decoded = raw
    try { decoded = decodeURIComponent(raw) } catch (_) { void 0 }
    return normalizeText(decoded)
  }, [orderNoParam])

  useEffect(() => {
    const state = location?.state && typeof location.state === 'object' ? location.state : null
    if (!state || !parentNo) return
    const stateParentNo = normalizeText(state?.parentNo || state?.orderNo || state?.__parentNo)
    if (stateParentNo && stateParentNo !== parentNo) return
    const parent = state?.parent && typeof state.parent === 'object' ? state.parent : null
    const children = Array.isArray(state?.children) ? state.children : null
    if (!parent && (!children || children.length === 0)) return
    setOrders((prev) => {
      if (Array.isArray(prev) && prev.length) return prev
      const next = []
      if (parent) next.push(parent)
      if (children && children.length) next.push(...children)
      return next
    })
  }, [location, parentNo])

  useEffect(() => {
    if (!parentNo) return
    let cancelled = false
    const load = async () => {
      setLoading(true)
      try {
        const normalizeOrder = (o) => {
          const src = o && typeof o === 'object' ? o : {}
          const id = src?._id ?? src?.id
          const nested = src?.data && typeof src.data === 'object' ? src.data : null
          const orderNo = normalizeText(
            src?.orderNo ?? src?.orderNumber ?? src?.order_number ?? src?.order_no ?? src?.no ??
            nested?.orderNo ?? nested?.orderNumber ?? nested?.order_number ?? nested?.order_no ?? nested?.no
          )
          const out = { ...src, orderNo }
          if (id != null && String(id).trim()) {
            out._id = String(id).trim()
            out.id = String(id).trim()
          }
          if (orderNo) out.orderNumber = orderNo
          return out
        }

        const buildFromParent = (fallbackParent) => {
          if (!fallbackParent) return []
          const parentOrderNo = normalizeText(fallbackParent?.orderNo) || parentNo
          const items =
            Array.isArray(fallbackParent?.items) ? fallbackParent.items
              : Array.isArray(fallbackParent?.products) ? fallbackParent.products
                : Array.isArray(fallbackParent?.productList) ? fallbackParent.productList
                  : Array.isArray(fallbackParent?.orderItems) ? fallbackParent.orderItems
                    : Array.isArray(fallbackParent?.order_items) ? fallbackParent.order_items
                      : Array.isArray(fallbackParent?.data?.items) ? fallbackParent.data.items
                        : Array.isArray(fallbackParent?.data?.products) ? fallbackParent.data.products
                          : []
          if (items.length > 1) {
            const pid = fallbackParent?._id ?? fallbackParent?.id ?? ''
            const itemChildren = items.map((it, idx) => {
              const src = (it && typeof it === 'object') ? it : {}
              const qty = src.quantity ?? src.orderQty ?? src.qty ?? src.orderQuantity
              const unitPrice = src.unitPrice ?? src.listUnitPrice ?? fallbackParent?.unitPrice
              const amount = src.amount ?? (Number(qty || 0) * Number(unitPrice || 0))
              const materialNo = src.materialNo ?? fallbackParent?.materialNo
              const specification = src.specification ?? src.spec ?? fallbackParent?.specification ?? fallbackParent?.spec
              const goodsName = src.goodsName ?? src.title ?? src.productName ?? fallbackParent?.goodsName ?? fallbackParent?.productTitle ?? fallbackParent?.title
              return {
                ...fallbackParent,
                ...src,
                _id: undefined,
                id: undefined,
                orderNo: `${parentOrderNo}-${idx + 1}`,
                orderNumber: `${parentOrderNo}-${idx + 1}`,
                goodsName,
                materialNo,
                specification,
                spec: specification,
                quantity: qty,
                unitPrice,
                amount,
                status: fallbackParent?.status,
                __itemChild: true,
                __parentNo: parentOrderNo,
                __parentOrderId: pid || undefined
              }
            })
            return [fallbackParent, ...itemChildren].filter(Boolean)
          }
          return [fallbackParent].filter(Boolean)
        }

        const childNoRe = new RegExp(`^${parentNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`)
        let loaded = false
        let lastErr = null

        try {
          const res = await orderAPI.getOrderGroup(parentNo)
          const body = res?.data ?? res
          if (body && typeof body === 'object' && body.success === false) {
            throw new Error(body.message || '未找到订单')
          }
          const payload = body?.data ?? body
          const group = payload?.data ?? payload
          const parentDoc = group?.parent && typeof group.parent === 'object' ? group.parent : null
          const childrenDocs = Array.isArray(group?.children) ? group.children : []

          const parentNormalized = parentDoc ? normalizeOrder(parentDoc) : null
          const childrenNormalized = childrenDocs.map(normalizeOrder).filter((o) => normalizeText(o?.orderNo))

          if (childrenNormalized.length) {
            setOrdersIfBetter([parentNormalized, ...childrenNormalized].filter(Boolean))
            loaded = true
          } else if (parentNormalized) {
            const next = buildFromParent(parentNormalized)
            const nextScore = calcListScore(next)
            if (nextScore > 0) {
              setOrdersIfBetter(next)
              loaded = true
            }
          }
        } catch (e) {
          lastErr = e
        }

        if (!loaded) {
          try {
            const detailRes = await orderAPI.getOrderAny(parentNo)
            const detailBody = detailRes?.data ?? detailRes
            const detailPayload = detailBody?.data ?? detailBody
            const detailOrder = detailPayload?.data?.order ?? detailPayload?.order ?? detailPayload?.orderDetail ?? detailPayload
            if (detailOrder && typeof detailOrder === 'object') {
              setOrdersIfBetter(buildFromParent(normalizeOrder(detailOrder)))
              loaded = true
            }
          } catch (e) {
            lastErr = lastErr || e
          }
        }

        if (!loaded) {
          const extractList = (res) => {
            const body = res?.data ?? res
            const payload = body?.data ?? body
            const data = payload?.data ?? payload
            return Array.isArray(data?.orders) ? data.orders : (Array.isArray(data) ? data : [])
          }

          const all = []
          try {
            const r1 = await orderAPI.getOrders({ keyword: parentNo, limit: 100, withTotal: false })
            all.push(...extractList(r1))
          } catch (_) { void 0 }
          try {
            const r2 = await orderAPI.getOrders({ keyword: parentNo, orderType: 'purchase', limit: 100, withTotal: false })
            all.push(...extractList(r2))
          } catch (_) { void 0 }

          const normalized = all.map(normalizeOrder).filter((o) => normalizeText(o?.orderNo))
          const parentFromList = normalized.find((o) => normalizeText(o?.orderNo) === parentNo) || null
          const childrenFromList = normalized.filter((o) => childNoRe.test(normalizeText(o?.orderNo)))
          if (childrenFromList.length) {
            const parentBase = parentFromList || normalizeOrder({
              orderNo: parentNo,
              orderNumber: parentNo,
              customerId: childrenFromList?.[0]?.customerId,
              customerName: childrenFromList?.[0]?.customerName
            })
            setOrdersIfBetter([parentBase, ...childrenFromList].filter(Boolean))
            loaded = true
          } else if (parentFromList) {
            setOrdersIfBetter(buildFromParent(parentFromList))
            loaded = true
          }
        }

        if (!cancelled && !loaded) {
          setOrders((prev) => (Array.isArray(prev) && prev.length ? prev : []))
          message.error(lastErr?.message || '订单不存在')
        }
      } catch (e) {
        if (!cancelled) message.error(e?.message || '加载订单合集失败')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [message, parentNo, reloadTick])

  const customerId = useMemo(() => {
    const src =
      orders?.find((o) => normalizeText(o?.orderNo) === parentNo)?.customerId ||
      orders?.find((o) => normalizeText(o?.orderNo) === parentNo)?.customer?._id ||
      orders?.find((o) => normalizeText(o?.orderNo) === parentNo)?.customer?.id ||
      orders?.[0]?.customerId ||
      orders?.[0]?.customer?._id ||
      orders?.[0]?.customer?.id
    return normalizeText(src)
  }, [orders, parentNo])

  useEffect(() => {
    if (!customerId) {
      setCustomer(null)
      return
    }
    let cancelled = false
    const loadCustomer = async () => {
      setCustomerLoading(true)
      try {
        const res = await cachedCustomerAPI.getCustomer(customerId)
        const data = res?.data ?? res
        const c = data?.data?.customer ?? data?.customer ?? data
        if (cancelled) return
        if (c && typeof c === 'object') {
          const cid = normalizeText(c?._id ?? c?.id ?? customerId)
          setCustomer({ ...c, id: cid || undefined, _id: cid || undefined })
        } else {
          setCustomer(null)
        }
      } catch (_) {
        if (!cancelled) setCustomer(null)
      } finally {
        if (!cancelled) setCustomerLoading(false)
      }
    }
    loadCustomer()
    return () => { cancelled = true }
  }, [customerId])

  useEffect(() => {
    if (!customerId) {
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
          const resp = await cachedCustomerSkuAPI.getCustomerSkus({ customerId, params: { page, pageSize, limit: pageSize } })
          const list = extractList(resp)
          if (list.length) all.push(...list)
          if (!list.length || list.length < pageSize) break
        }
        if (cancelled) return
        const normalized = (all || []).map((s) => {
          const sid = normalizeText(s?.id ?? s?._id ?? '')
          return { ...s, id: sid || undefined, _id: sid || s?._id }
        })
        setCustomerSkus(normalized)
      } catch (_) {
        if (!cancelled) setCustomerSkus([])
      } finally {
        if (!cancelled) setCustomerSkusLoading(false)
      }
    }
    load()
    return () => { cancelled = true }
  }, [customerId])

  const parentOrder = useMemo(() => {
    return (orders || []).find((o) => normalizeText(o?.orderNo) === parentNo) || null
  }, [orders, parentNo])

  const childOrders = useMemo(() => {
    const list = (orders || []).filter((o) => {
      const ono = normalizeText(o?.orderNo)
      if (!ono) return false
      if (ono === parentNo) return false
      return new RegExp(`^${parentNo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-\\d+$`).test(ono)
    })
    return list.slice().sort((a, b) => normalizeText(a?.orderNo).localeCompare(normalizeText(b?.orderNo)))
  }, [orders, parentNo])

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

  const skuIndex = useMemo(() => {
    const byMaterialSpec = new Map()
    const byNameMaterialSpec = new Map()
    const byNameSpec = new Map()
    const byId = new Map()
    const all = Array.isArray(customerSkus) ? customerSkus : []
    all.forEach((s) => {
      const id = normalizeText(s?.id ?? s?._id ?? '')
      const name = normalizeText(s?.name)
      const materialNo = normalizeText(s?.materialNo)
      const specification = normalizeText(s?.specification)
      if (id) byId.set(id, s)
      if (materialNo && specification) {
        const k = `${materialNo}||${specification}`
        const arr = byMaterialSpec.get(k) || []
        arr.push(s)
        byMaterialSpec.set(k, arr)
      }
      if (name && materialNo && specification) {
        const k = `${name}||${materialNo}||${specification}`
        const arr = byNameMaterialSpec.get(k) || []
        arr.push(s)
        byNameMaterialSpec.set(k, arr)
      }
      if (name && specification) {
        const k = `${name}||${specification}`
        const arr = byNameSpec.get(k) || []
        arr.push(s)
        byNameSpec.set(k, arr)
      }
    })
    return { byMaterialSpec, byNameMaterialSpec, byNameSpec, byId, all }
  }, [customerSkus])

  const resolveSkuForOrder = (order) => {
    const goodsName = normalizeText(order?.goodsName || order?.productTitle || order?.title || '')
    const materialNo = normalizeText(order?.materialNo || '')
    const specification = normalizeText(order?.specification || order?.spec || '')
    const skuId = normalizeText(
      order?.skuId ||
      order?.sku_id ||
      order?.sku?._id ||
      order?.sku?.id ||
      order?.customerSkuId ||
      order?.customer_sku_id ||
      order?.customerSku?._id ||
      order?.customerSku?.id ||
      order?.data?.skuId ||
      order?.data?.sku_id ||
      order?.data?.sku?._id ||
      order?.data?.sku?.id ||
      order?.data?.customerSkuId ||
      order?.data?.customer_sku_id
    )
    if (skuId && skuIndex.byId.has(skuId)) return skuIndex.byId.get(skuId)
    if (goodsName && materialNo && specification) {
      const arr = skuIndex.byNameMaterialSpec.get(`${goodsName}||${materialNo}||${specification}`)
      if (Array.isArray(arr) && arr.length === 1) return arr[0]
    }
    if (materialNo && specification) {
      const arr = skuIndex.byMaterialSpec.get(`${materialNo}||${specification}`)
      if (Array.isArray(arr) && arr.length === 1) return arr[0]
    }
    if (goodsName && specification) {
      const arr = skuIndex.byNameSpec.get(`${goodsName}||${specification}`)
      if (Array.isArray(arr) && arr.length === 1) return arr[0]
    }
    const candidates = skuIndex.all.filter((s) => {
      if (materialNo) {
        const skuMaterialNo = normalizeText(s?.materialNo)
        if (skuMaterialNo && skuMaterialNo !== materialNo) return false
      }
      if (specification && normalizeText(s?.specification) !== specification) return false
      if (goodsName && normalizeText(s?.name) !== goodsName) return false
      return Boolean(normalizeText(s?.name) || normalizeText(s?.materialNo) || normalizeText(s?.specification))
    })
    if (candidates.length === 1) return candidates[0]
    return null
  }

  const ordersForRows = useMemo(() => {
    if ((childOrders || []).length) return childOrders
    const p = parentOrder
    if (!p) return []
    const parentOrderNo = normalizeText(p?.orderNo) || parentNo
    const pid = normalizeText(p?._id ?? p?.id ?? '')
    const items =
      Array.isArray(p?.items) ? p.items
        : Array.isArray(p?.products) ? p.products
          : Array.isArray(p?.productList) ? p.productList
            : Array.isArray(p?.orderItems) ? p.orderItems
              : Array.isArray(p?.order_items) ? p.order_items
                : Array.isArray(p?.data?.items) ? p.data.items
                  : Array.isArray(p?.data?.products) ? p.data.products
                    : []
    if (items.length) {
      return items.map((it, idx) => {
        const src = (it && typeof it === 'object') ? it : {}
        const qty = src.quantity ?? src.orderQty ?? src.qty ?? src.orderQuantity ?? p?.quantity ?? p?.totalQty
        const unitPrice = src.unitPrice ?? src.listUnitPrice ?? p?.unitPrice
        const amount = src.amount ?? (Number(qty || 0) * Number(unitPrice || 0))
        const materialNo = src.materialNo ?? p?.materialNo
        const specification = src.specification ?? src.spec ?? p?.specification ?? p?.spec
        const goodsName = src.goodsName ?? src.title ?? src.productName ?? p?.goodsName ?? p?.productTitle ?? p?.title
        return {
          ...p,
          ...src,
          _id: undefined,
          id: undefined,
          orderNo: `${parentOrderNo}-${idx + 1}`,
          orderNumber: `${parentOrderNo}-${idx + 1}`,
          goodsName,
          materialNo,
          specification,
          spec: specification,
          quantity: qty,
          unitPrice,
          amount,
          status: p?.status,
          __itemChild: true,
          __itemIndex: idx,
          __parentNo: parentOrderNo,
          __parentOrderId: pid || undefined
        }
      })
    }
    return [p]
  }, [childOrders, parentNo, parentOrder])

  const rows = useMemo(() => {
    return (ordersForRows || []).map((o) => {
      const sku = resolveSkuForOrder(o)
      const qty = toNumber(o?.quantity ?? o?.totalQty)
      const unitPrice = toNumber(o?.unitPrice)
      const rawFromOrder = toNumber(o?.rawUnitPrice ?? o?.rawMaterialUnitPrice ?? o?.rawMaterialCost)
      const rawFromSku = toNumber(sku?.rawMaterialCost)
      const rawUnitPrice = Number.isFinite(rawFromOrder) ? rawFromOrder : (Number.isFinite(rawFromSku) ? rawFromSku : NaN)
      const sheetFromOrder = toNumber(o?.sheetCount ?? o?.sheet_count)
      const perSheet = toNumber(sku?.sheetCount)
      const sheetCount = Number.isFinite(sheetFromOrder) ? sheetFromOrder : (Number.isFinite(qty) && Number.isFinite(perSheet) ? qty * perSheet : NaN)
      const amountFromOrder = toNumber(o?.amount ?? o?.totalAmount ?? o?.finalAmount)
      const amount = Number.isFinite(amountFromOrder) ? amountFromOrder : (Number.isFinite(qty) && Number.isFinite(unitPrice) ? qty * unitPrice : NaN)
      const grossProfit = (Number.isFinite(qty) && Number.isFinite(unitPrice) && Number.isFinite(rawUnitPrice) && Number.isFinite(sheetCount))
        ? (qty * unitPrice - rawUnitPrice * sheetCount)
        : NaN

      const specText = normalizeText(o?.specification || o?.spec || sku?.specification)
      const bw = toNumber(o?.boardWidth ?? sku?.boardWidth)
      const bh = toNumber(o?.boardHeight ?? sku?.boardHeight)
      const sizeText = (Number.isFinite(bw) && bw > 0 && Number.isFinite(bh) && bh > 0) ? `${bw}×${bh}` : ''
      const normalizeFlute = (raw) => {
        const s = normalizeText(raw)
        if (!s) return ''
        const tokens = ['AB', 'BC', 'AC', 'BE', 'CE', 'AE', 'EB', 'A', 'B', 'C', 'E', 'F', 'G', 'K', 'N']
        const re = new RegExp(`(?:${tokens.join('|')})\\s*楞`, 'gi')
        const matches = s.match(re)
        if (matches && matches.length) {
          const last = String(matches[matches.length - 1] || '').replace(/\s+/g, '')
          return last.replace(/^([A-Za-z]{1,4})楞$/, (_, p1) => `${String(p1 || '').toUpperCase()}楞`)
        }
        const idx = s.indexOf('楞')
        if (idx >= 0) return s.slice(0, idx + 1).trim()
        return s.trim()
      }
      const flute = normalizeFlute(o?.flute || o?.fluteType || o?.flute_type || o?.data?.flute || o?.data?.fluteType || o?.data?.flute_type || sku?.flute || sku?.fluteType || sku?.flute_type)

      const looksLikeMaterialCode = (v) => {
        const s = normalizeText(v).replace(/\s+/g, '')
        if (!s) return false
        if (s.length > 10) return false
        if (/[^\w]/.test(s)) return false
        if (/[\u4e00-\u9fa5]/.test(s)) return false
        const hasLetter = /[A-Za-z]/.test(s)
        const hasDigit = /\d/.test(s)
        return hasLetter && hasDigit
      }
      const skuMaterialNo = normalizeText(sku?.materialNo || sku?.material_no)
      const orderMaterialNo = normalizeText(o?.materialNo || o?.material_no)
      const materialNoText = skuMaterialNo ? skuMaterialNo : (looksLikeMaterialCode(orderMaterialNo) ? '' : orderMaterialNo)
      const skuMaterialCode = normalizeText(sku?.materialCode || sku?.material_code || sku?.material)
      const orderMaterialCode = normalizeText(
        o?.materialCode ||
        o?.material_code ||
        o?.material ||
        o?.data?.materialCode ||
        o?.data?.material_code ||
        o?.data?.material ||
        o?.meta?.materialCode ||
        o?.meta?.material_code ||
        o?.meta?.material
      )
      const materialCodeText = skuMaterialCode || orderMaterialCode || (looksLikeMaterialCode(orderMaterialNo) ? orderMaterialNo : '')

      const pickAny = (obj, keys) => {
        const src = obj && typeof obj === 'object' ? obj : null
        if (!src) return undefined
        for (const k of keys) {
          if (!k) continue
          const v = src[k]
          if (v === undefined || v === null || v === '') continue
          return v
        }
        return undefined
      }
      const pickFromSources = (keys) => {
        return (
          pickAny(o, keys) ??
          pickAny(o?.data, keys) ??
          pickAny(o?.meta, keys) ??
          pickAny(sku, keys) ??
          pickAny(sku?.data, keys) ??
          pickAny(sku?.meta, keys)
        )
      }
      const crease1Keys = ['creasingSize1', 'creaseSize1', 'creasingSize_1', 'creaseSize_1', 'creasing_size1', 'crease_size1', 'creasing_size_1', 'crease_size_1']
      const crease2Keys = ['creasingSize2', 'creaseSize2', 'creasingSize_2', 'creaseSize_2', 'creasing_size2', 'crease_size2', 'creasing_size_2', 'crease_size_2']
      const crease3Keys = ['creasingSize3', 'creaseSize3', 'creasingSize_3', 'creaseSize_3', 'creasing_size3', 'crease_size3', 'creasing_size_3', 'crease_size_3']
      const creaseTypeKeys = ['creasingType', 'creaseType', 'creasing_type', 'crease_type']
      const pressLineKeys = ['pressLine', 'press_line', 'pressLineSize', 'press_line_size', 'creasingSize', 'creaseSize', 'creasing_size', 'crease_size', '压线尺寸', '压线']
      const creaseMerged = {
        creasingSize1:
          pickFromSources(crease1Keys),
        creasingSize2:
          pickFromSources(crease2Keys),
        creasingSize3:
          pickFromSources(crease3Keys),
        creasingType:
          pickFromSources(creaseTypeKeys),
        pressLine: pickFromSources(pressLineKeys)
      }
      const creaseText = formatCrease(creaseMerged)

      return {
        ...o,
        __sku: sku,
        __qty: qty,
        __sheetCount: sheetCount,
        __unitPrice: unitPrice,
        __rawUnitPrice: rawUnitPrice,
        __grossProfit: grossProfit,
        __amount: amount,
        __specText: specText,
        __sizeText: sizeText,
        __materialNoText: materialNoText,
        __materialCodeText: materialCodeText,
        __flute: flute,
        __creaseText: creaseText === '-' ? '' : creaseText
      }
    })
  }, [ordersForRows, skuIndex])

  const summary = useMemo(() => {
    const list = Array.isArray(rows) ? rows : []
    const sum = (key) => list.reduce((s, r) => s + (Number.isFinite(r?.[key]) ? Number(r[key]) : 0), 0)
    return {
      qty: sum('__qty'),
      sheetCount: sum('__sheetCount'),
      grossProfit: sum('__grossProfit'),
      amount: sum('__amount')
    }
  }, [rows])

  const columns = useMemo(() => ([
    {
      title: '子订单号',
      key: 'orderNo',
      width: 140,
      render: (_, r) => {
        const text = normalizeText(r?.orderNo) || '-'
        if (r?.__itemChild) return text
        return text ? <a onClick={(e) => { e.preventDefault(); navigate(`/orders/${encodeURIComponent(text)}`) }} href="#">{text}</a> : text
      }
    },
    {
      title: '产品类别',
      key: 'productCategory',
      width: 140,
      render: (_, r) => normalizeText(r?.category || r?.productCategory || r?.productName || r?.__sku?.category) || '-'
    },
    {
      title: '商品名称',
      key: 'goodsName',
      width: 220,
      render: (_, r) => normalizeText(r?.goodsName || r?.productTitle || r?.title) || '-'
    },
    {
      title: '物料号',
      key: 'materialNo',
      width: 160,
      render: (_, r) => normalizeText(r?.__materialNoText) || '-'
    },
    {
      title: '规格尺寸原材料信息',
      key: 'rawInfo',
      width: 190,
      render: (_, r) => {
        const materialPrefix = normalizeText(r?.__materialCodeText)
        const fluteText = normalizeText(r?.__flute)
        const materialFlute = materialPrefix ? (fluteText ? `${materialPrefix} | ${fluteText}` : materialPrefix) : fluteText
        const lines = [
          normalizeText(r?.__specText),
          normalizeText(r?.__sizeText),
          materialFlute,
          normalizeText(r?.__creaseText) ? `压线: ${normalizeText(r.__creaseText)}` : ''
        ].filter(Boolean)
        if (!lines.length) return '-'
        return (
          <div style={{ lineHeight: 1.25 }}>
            {lines.map((t, i) => <div key={i}>{t}</div>)}
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
        return Number.isFinite(r?.__qty) ? formatMoney0to3(r.__qty) : '-'
      }
    },
    {
      title: '下单片数',
      key: 'sheetCount',
      width: 90,
      align: 'right',
      render: (_, r) => Number.isFinite(r?.__sheetCount) ? formatMoney0to3(r.__sheetCount) : '-'
    },
    {
      title: '单价',
      key: 'unitPrice',
      width: 90,
      align: 'right',
      render: (_, r) => Number.isFinite(r?.__unitPrice) ? formatMoney3(r.__unitPrice) : '-'
    },
    {
      title: '原材料单价',
      key: 'rawUnitPrice',
      width: 100,
      align: 'right',
      render: (_, r) => {
        const base = Number(r?.__rawUnitPrice)
        if (!Number.isFinite(base)) return '-'
        const qty = Number(r?.__qty)
        const totalSheets = Number(r?.__sheetCount)
        const ratio = (qty > 0 && totalSheets > 0) ? (totalSheets / qty) : 0
        const ratioRounded = Number.isFinite(ratio) && ratio > 0 ? Math.round(ratio) : 0
        const ratioFactor = ratioRounded > 0 && Math.abs(ratio - ratioRounded) <= 0.01 ? ratioRounded : 0

        const sku = r?.__sku
        const skuFactor = toNumber(sku?.sheetCount ?? sku?.skuSheetCount ?? sku?.sheetPerUnit ?? sku?.sheet_per_unit ?? 0)

        const jm = normalizeText(r?.joinMethod || r?.join_method || sku?.joinMethod || sku?.join_method)
        const joinFactor = jm.includes('四拼') ? 4 : (jm.includes('双拼') ? 2 : (jm.includes('单拼') ? 1 : 0))

        const factor = Math.max(
          Number.isFinite(skuFactor) && skuFactor > 0 ? skuFactor : 0,
          joinFactor,
          ratioFactor
        )
        return formatMoney4(factor > 0 ? base * factor : base)
      }
    },
    {
      title: '毛利润',
      key: 'grossProfit',
      width: 100,
      align: 'right',
      render: (_, r) => Number.isFinite(r?.__grossProfit) ? formatMoney3(r.__grossProfit) : '-'
    },
    {
      title: '订单金额',
      key: 'amount',
      width: 110,
      align: 'right',
      render: (_, r) => Number.isFinite(r?.__amount) ? formatMoney3(r.__amount) : '-'
    },
    {
      title: '订单状态',
      key: 'status',
      width: 100,
      render: (_, r) => {
        const s = normalizeText(r?.status).toLowerCase()
        const meta = statusMap[s] || {}
        return <Tag color={meta.color || 'default'}>{meta.text || s || '-'}</Tag>
      }
    }
  ]), [formatMoney0to3, formatMoney3, navigate])

  const customerName = normalizeText(
    parentOrder?.customerName ||
    childOrders?.[0]?.customerName ||
    parentOrder?.customer?.companyName ||
    parentOrder?.customer?.name
  )

  return (
    <Spin spinning={loading}>
      <div>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
          <h2 className="page-title" style={{ margin: 0 }}>多SKU订单详情</h2>
          <Space>
            <Button onClick={() => safeNavigateBack(navigate, '/orders')}>返回</Button>
            <Button onClick={() => setReloadTick((t) => t + 1)} disabled={loading}>刷新</Button>
          </Space>
        </div>

        <Card title="客户信息" style={{ marginBottom: 12 }} loading={(customerLoading && Boolean(customerId)) || (customerSkusLoading && Boolean(customerId))}>
          <Descriptions size="small" column={3}>
            <Descriptions.Item label="主订单号">{parentNo || '-'}</Descriptions.Item>
            <Descriptions.Item label="客户名称">{customer?.companyName || customer?.name || customerName || '-'}</Descriptions.Item>
            <Descriptions.Item label="客户简称">{customer?.shortName || '-'}</Descriptions.Item>
            <Descriptions.Item label="联系人">{customer?.contactName || customer?.contactPerson || customer?.contact || '-'}</Descriptions.Item>
            <Descriptions.Item label="联系电话">{customer?.phone || customer?.mobile || customer?.tel || '-'}</Descriptions.Item>
            <Descriptions.Item label="地址">{customer?.address || customer?.deliveryAddress || '-'}</Descriptions.Item>
          </Descriptions>
        </Card>

        <Card title="产品列表" style={{ marginBottom: 12 }}>
          {!loading && (!Array.isArray(rows) || rows.length === 0) ? (
            <div style={{ padding: 16, color: '#999', textAlign: 'center' }}>
              未加载到订单数据
            </div>
          ) : null}
          <Table
            columns={columns}
            dataSource={rows}
            rowKey={(r) => String(r?.__itemChild ? (r?.orderNo || '') : (r?._id || r?.id || r?.orderNo || ''))}
            pagination={false}
            size="small"
            scroll={{ x: 1420 }}
            summary={() => (
              <Table.Summary.Row>
                <Table.Summary.Cell index={0}>合计</Table.Summary.Cell>
                <Table.Summary.Cell index={1} />
                <Table.Summary.Cell index={2} />
                <Table.Summary.Cell index={3} />
                <Table.Summary.Cell index={4} />
                <Table.Summary.Cell index={5} align="right">{formatMoney0to3(summary.qty)}</Table.Summary.Cell>
                <Table.Summary.Cell index={6} align="right">{formatMoney0to3(summary.sheetCount)}</Table.Summary.Cell>
                <Table.Summary.Cell index={7} />
                <Table.Summary.Cell index={8} />
                <Table.Summary.Cell index={9} align="right">{formatMoney3(summary.grossProfit)}</Table.Summary.Cell>
                <Table.Summary.Cell index={10} align="right">{formatMoney3(summary.amount)}</Table.Summary.Cell>
                <Table.Summary.Cell index={11} />
              </Table.Summary.Row>
            )}
          />
        </Card>

        <Card type="inner" title="订单备注" style={{ marginBottom: 16 }}>
          <div style={{ whiteSpace: 'pre-wrap', fontSize: 14 }}>备注：{parentOrder?.notes || '-'}</div>
        </Card>
      </div>
    </Spin>
  )
}

export default OrderGroupDetail
