import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Table, Card, Progress, Tag, Button, Space, App, Modal, Input, Form, Divider, Pagination } from 'antd'
import { Link, useNavigate } from 'react-router-dom'
import { PlayCircleOutlined, PauseCircleOutlined, CheckCircleOutlined, PlusSquareOutlined, MinusSquareOutlined } from '@ant-design/icons'
import dayjs from 'dayjs'
import { orderAPI, customerAPI } from '../services/api'
import { cachedCustomerSkuAPI } from '../services/cachedAPI'
import { useLocalStorage } from '../hooks/useLocalStorage'

function ProductionManagement() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [orders, setOrders] = useState([])
  const [selectedRowKeys, setSelectedRowKeys] = useLocalStorage('erp_production_management_selected_row_keys', [])
  const [searchKeyword, setSearchKeyword] = useState('')
  const [customers, setCustomers] = useState([])
  const [customerSkusByCustomerId, setCustomerSkusByCustomerId] = useState({})
  const inflightCustomerSkuRef = useRef(new Set())
  const [batchShippingOpen, setBatchShippingOpen] = useState(false)
  const [shippingOrders, setShippingOrders] = useState([])
  const [shippingForm] = Form.useForm()
  const [currentPage, setCurrentPage] = useState(1)
  const [totalOrders, setTotalOrders] = useState(0)
  const [efficiencyStats, setEfficiencyStats] = useState({
    total: 0,
    pending: 0,
    processing: 0,
    completedRate: 0,
    scrapRate: 0,
    avgDeliveryDays: 0,
    onTimeRate: 0
  })

  const statusMap = {
    ordered: { text: '已下单', color: 'purple', icon: <PauseCircleOutlined /> },
    pending: { text: '待生产', color: 'orange', icon: <PauseCircleOutlined /> },
    processing: { text: '生产中', color: 'blue', icon: <PlayCircleOutlined /> },
    stocked: { text: '已入库', color: 'geekblue', icon: <CheckCircleOutlined /> },
    shipping: { text: '已发货', color: 'gold', icon: <PlayCircleOutlined /> },
    completed: { text: '已完成', color: 'green', icon: <CheckCircleOutlined /> }
  }

  const loadMeta = useCallback(async () => {
    try {
      const res = await customerAPI.getCustomers({ page: 1, limit: 1000 })
      const list = Array.isArray(res) ? res : Array.isArray(res?.data) ? res.data : Array.isArray(res?.data?.customers) ? res.data.customers : []
      setCustomers(list)
    } catch (e) {
      // ignore
    }
  }, [])

  const loadStats = useCallback(async () => {
    try {
      const resp = await orderAPI.getProductionEfficiencyStats({ period: '90d', limit: 500 })
      const payload = resp?.data?.data ?? resp?.data ?? {}
      const data = payload?.data ?? payload
      const summary = data?.summary ?? data?.data?.summary ?? {}
      setEfficiencyStats({
        total: Number(summary.total || 0) || 0,
        pending: Number(summary.pending || 0) || 0,
        processing: Number(summary.processing || 0) || 0,
        completedRate: Number(summary.completedRate || 0) || 0,
        scrapRate: Number(summary.scrapRate || 0) || 0,
        avgDeliveryDays: Number(summary.avgDeliveryDays || 0) || 0,
        onTimeRate: Number(summary.onTimeRate || 0) || 0
      })
    } catch (_) {
      setEfficiencyStats({
        total: 0,
        pending: 0,
        processing: 0,
        completedRate: 0,
        scrapRate: 0,
        avgDeliveryDays: 0,
        onTimeRate: 0
      })
    }
  }, [])

  const loadOrders = useCallback(async (page = 1, keywordArg) => {
    setLoading(true)
    try {
      const kw = String((keywordArg !== undefined ? keywordArg : searchKeyword) || '').trim()
      const resp = await orderAPI.getOrders({
        page,
        limit: 30,
        orderBy: 'createdAt_desc',
        withTotal: true,
        keyword: kw || undefined
      })
      const payload = resp?.data?.data ?? resp?.data ?? {}
      const data = Array.isArray(payload?.orders)
        ? payload.orders
        : Array.isArray(payload?.data?.orders)
          ? payload.data.orders
          : Array.isArray(payload?.data)
            ? payload.data
            : []
      const pagination =
        payload?.pagination ??
        payload?.data?.pagination ??
        payload?.pageInfo ??
        payload?.meta?.pagination ??
        null
      const limit = 30
      let total =
        Number(pagination?.total) ||
        Number(pagination?.totalCount) ||
        Number(pagination?.count) ||
        Number(payload?.total) ||
        Number(payload?.count) ||
        0
      if (!Number.isFinite(total) || total <= 0) {
        const totalPages =
          Number(pagination?.totalPages) ||
          Number(pagination?.pages) ||
          Number(payload?.totalPages) ||
          0
        if (Number.isFinite(totalPages) && totalPages > 0) {
          total = totalPages * limit
        } else {
          const hasMore =
            Boolean(pagination?.hasMore) ||
            Boolean(payload?.hasMore) ||
            (Array.isArray(data) && data.length === limit)
          if (hasMore) {
            total = page * limit + 1
          } else {
            total = (page - 1) * limit + (Array.isArray(data) ? data.length : 0)
          }
        }
      }
      setTotalOrders(Number.isFinite(total) ? total : 0)
      setCurrentPage(page)

      const list = (data || []).map((o, idx) => {
        const orderNo = o.orderNo ?? o.orderNumber ?? ''
        const normalizeText = (v) => String(v ?? '').trim()
        const pickText = (...candidates) => {
          for (const c of candidates) {
            const s = normalizeText(c)
            if (s) return s
          }
          return ''
        }
        const isBadNameText = (v) => {
          const s = normalizeText(v)
          if (!s || s === '-') return true
          return s === '真实订单信息' || s === 'SKU订单信息' || s === '多SKU'
        }
        const pickNameText = (...candidates) => {
          for (const c of candidates) {
            if (!isBadNameText(c)) return normalizeText(c)
          }
          return '-'
        }

        const shippedAt = (() => {
          const ships = Array.isArray(o.shipments) ? o.shipments : (Array.isArray(o.deliveryLogs) ? o.deliveryLogs : [])
          const times = ships.map(it => it && (it.time || it.at || it.date || it.createdAt || it.ts)).filter(Boolean)
          if (times.length) {
            const latest = times.reduce((max, cur) => (dayjs(cur).isValid() && dayjs(cur).valueOf() > (dayjs(max).isValid() ? dayjs(max).valueOf() : 0)) ? cur : max, '')
            return latest || null
          }
          return o.shippedAt || o.deliveredAt || (String(o.status || '').toLowerCase() === 'shipped' ? (o.updatedAt || o.updateTime) : null) || null
        })()

        const stockedAt = o.stockedAt || o.stockTime || o.warehousedAt || (String(o.status || '').toLowerCase() === 'stocked' ? (o.updatedAt || o.updateTime) : null) || null

        const startedAt = (() => {
          const s = String(o.status || '').toLowerCase()
          if (['pending', 'ordered', 'waiting'].includes(s)) return null
          const logs = Array.isArray(o.operationLogs) ? o.operationLogs : (Array.isArray(o.logs) ? o.logs : [])
          const hit = (logs || []).find(it => {
            const c = String((it && (it.content || it.text)) || '')
            return (/开始(生产|印刷)/.test(c) && /(扫码|扫描|scan)/i.test(c))
          })
          const t = hit ? (hit.time || hit.at || hit.date || hit.createdAt) : (o.printStartAt || o.startedAt || o.startTime)
          return t || null
        })()

        const printFinishAt = o.printFinishAt || o.printedAt || o.completedAt || null

        const status = (() => {
          const s = String(o.status || '').toLowerCase()
          if (s === 'completed' || s === 'done' || o.status === '已完成' || o.status === '完成') return 'completed'
          if (shippedAt || ['shipped', 'shipping', 'delivered'].includes(s) || ['正在发货', '已发货', '已送货'].includes(String(o.status || ''))) return 'shipping'
          if (stockedAt || ['stocked', 'warehoused', 'warehouse'].includes(s) || ['已入库'].includes(String(o.status || ''))) return 'stocked'
          if (printFinishAt) return 'processing'
          if (startedAt || ['processing', 'in_progress', 'producing'].includes(s) || ['生产中'].includes(String(o.status || ''))) return 'processing'
          if (['pending', 'waiting', 'planned'].includes(s) || ['待生产'].includes(String(o.status || ''))) return 'pending'
          if (s === 'ordered' || o.status === '已下单') return 'ordered'
          return 'ordered'
        })()

        const createdAtRaw = o.createTime || o.createdAt || o.createdTime || o.createAt || null
        const createAt = createdAtRaw ? dayjs(createdAtRaw).isValid() ? dayjs(createdAtRaw).valueOf() : (typeof createdAtRaw === 'number' ? createdAtRaw : Date.parse(createdAtRaw)) : 0

        const data = o?.data && typeof o.data === 'object' ? o.data : null
        const meta = o?.meta && typeof o.meta === 'object' ? o.meta : null
        const brief = meta?.brief && typeof meta.brief === 'object' ? meta.brief : null
        const product = o?.product && typeof o.product === 'object' ? o.product : null
        const items = Array.isArray(o.items) ? o.items : (Array.isArray(data?.items) ? data.items : [])
        const first = items[0] && typeof items[0] === 'object' ? items[0] : null
        const firstData = first?.data && typeof first.data === 'object' ? first.data : null
        const pickFromItems = (getter) => {
          for (const it of items) {
            if (!it || typeof it !== 'object') continue
            const v = getter(it)
            if (!isBadNameText(v)) return normalizeText(v)
          }
          return ''
        }
        const materialNo = pickText(
          o.materialNo, o.material_no,
          data?.materialNo, data?.material_no,
          meta?.materialNo, meta?.material_no,
          brief?.materialNo, brief?.material_no,
          product?.materialNo, product?.material_no,
          first?.materialNo, first?.material_no,
          firstData?.materialNo, firstData?.material_no
        )
        const spec = pickText(
          o.specification, o.spec, o.productSpec, o.product_spec,
          data?.specification, data?.spec, data?.productSpec, data?.product_spec,
          meta?.specification, meta?.spec,
          brief?.specification, brief?.spec,
          product?.specification, product?.spec,
          first?.specification, first?.spec, first?.productSpec, first?.product_spec,
          firstData?.specification, firstData?.spec, firstData?.productSpec, firstData?.product_spec
        )
        const boardWidth = o.boardWidth ?? o.board_width ?? data?.boardWidth ?? data?.board_width ?? first?.boardWidth ?? first?.board_width ?? firstData?.boardWidth ?? firstData?.board_width ?? undefined
        const boardHeight = o.boardHeight ?? o.board_height ?? data?.boardHeight ?? data?.board_height ?? first?.boardHeight ?? first?.board_height ?? firstData?.boardHeight ?? firstData?.board_height ?? undefined

        return {
          ...o,
          key: o._id ?? o.id ?? `order_${idx}`,
          orderNo,
          customerName: o.customerName ?? o.customer?.name ?? o.customer,
          productName: pickNameText(
            o.productName,
            o.product?.name,
            o.product,
            data?.productName,
            meta?.productName,
            brief?.productName,
            first?.productName,
            firstData?.productName,
            pickFromItems((it) => it.productName || it.product?.name || it.category || it.productCategory || it.productType || it.type)
          ),
          goodsName: (() => {
            const firstItem = first || {}
            return pickNameText(
              o.goodsName,
              o.productTitle,
              o.goods_name,
              o.title,
              firstItem.goodsName,
              firstItem.name,
              firstItem.title,
              firstItem.productName,
              pickFromItems((it) => it.goodsName || it.name || it.title || it.productName)
            )
          })(),
          spec,
          boardWidth,
          boardHeight,
          materialNo,
          quantity: o.quantity ?? o.totalQty ?? (Array.isArray(items) ? items.reduce((s, it) => s + (Number(it.quantity) || 0), 0) : 0),
          producedQty: Number(o.producedQty || 0),
          stockedQty: Number(o.stockedQty || 0),
          shippedQty: Number(o.shippedQty || o.deliveredQty || 0),
          materialArrived: (() => {
            const ms = String(o.material_status || o.materialStatus || (o.material && o.material.status) || '').toLowerCase()
            const zh = ['到料', '已到料', '材料已到']
            return !!(o.materialArrived || ms === 'arrived' || zh.includes(String(o.material_status || '').trim()))
          })(),
          status,
          startedAt,
          printFinishAt,
          shippedAt,
          stockedAt,
          createAt,
          startTime: createAt ? dayjs(createAt).format('YYYY-MM-DD') : ''
        }
      })
        .filter((o) => {
          const orderType = String(o?.orderType || o?.order_type || o?.type || '').trim().toLowerCase()
          const purchaseCategory = String(o?.purchaseCategory || o?.purchase_category || o?.category || '').trim().toLowerCase()
          const orderNoText = String(o?.orderNo || o?.orderNumber || '').trim()
          const goodsNameText = String(o?.goodsName || '').trim()
          const items = Array.isArray(o?.items) ? o.items : []
          const first = items[0] && typeof items[0] === 'object' ? items[0] : null
          const firstGoodsName = String(first?.goodsName || first?.name || first?.title || '').trim()

          const isBoardCategory = purchaseCategory === 'boards'
          const isBoardNo = /^(QXDD|QXBZ)\d+/i.test(orderNoText)
          const isBoardGoods = goodsNameText === '纸板' || firstGoodsName === '纸板'
          const isBoardPurchase = orderType === 'purchase' && (isBoardCategory || isBoardGoods)
          const isBoardNoLikely = isBoardNo && (isBoardCategory || isBoardGoods || orderType === 'purchase')

          return !(isBoardCategory || isBoardPurchase || isBoardNoLikely)
        })
        // 显示全部订单（含采购等所有类型），仅排除已删除
        .filter((o) => {
          const deletedFlag =
            Boolean(o.isDeleted || o.is_deleted || o.deletedAt || o.deleted_at) ||
            String(o.deleted).toLowerCase() === 'true'
          return !deletedFlag
        })
      const sorted = list
        .slice()
        .sort((a, b) => {
          const ta = Number(a.createAt || 0)
          const tb = Number(b.createAt || 0)
          return tb - ta
        })
      setOrders(sorted)
    } catch (e) {
      setOrders([])
      setTotalOrders(0)
      message.error('加载生产数据失败')
    } finally {
      setLoading(false)
    }
  }, [message, searchKeyword])

  useEffect(() => {
    loadOrders(1)
    loadMeta()
    loadStats()
  }, [loadMeta, loadOrders, loadStats])

  useEffect(() => {
    if (typeof window === 'undefined') return undefined
    let timer = null
    const trigger = () => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        loadOrders(currentPage || 1)
        loadStats()
      }, 300)
    }
    const onStorage = (e) => {
      if (e && e.key === 'erp_orders_changed_at') {
        trigger()
      }
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('erp:ordersChanged', trigger)
    return () => {
      if (timer) clearTimeout(timer)
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('erp:ordersChanged', trigger)
    }
  }, [currentPage, loadOrders, loadStats])

  useEffect(() => {
    let timer = null
    timer = setTimeout(() => {
      setCurrentPage(1)
      loadOrders(1)
    }, 300)
    return () => {
      if (timer) clearTimeout(timer)
    }
  }, [loadOrders, searchKeyword])

  const customerSkuIndexByCustomerId = useMemo(() => {
    const normalizeText = (v) => String(v ?? '').trim()
    const normalizeKey = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, '')
    const normalizeSpecKey = (v) => normalizeKey(v).replace(/[x*]/g, '×').replace(/mm$/i, '')
    const normalizeId = (v) => {
      const s = normalizeText(v)
      if (!s) return ''
      const parts = s.split(/[\\/]/).filter(Boolean)
      return parts.length ? parts[parts.length - 1] : s
    }
    const result = new Map()
    Object.entries(customerSkusByCustomerId || {}).forEach(([cid, skus]) => {
      const map = new Map()
      ;(Array.isArray(skus) ? skus : []).forEach((sku) => {
        const sid = normalizeId(sku?.id ?? sku?._id)
        if (sid) map.set(`id:${normalizeKey(sid)}`, sku)
        const materialNo = normalizeKey(sku?.materialNo ?? sku?.material_no)
        const spec = normalizeSpecKey(sku?.specification ?? sku?.spec)
        const name = normalizeKey(sku?.name ?? sku?.goodsName ?? sku?.productName)
        if (materialNo) map.set(`m:${materialNo}`, sku)
        if (materialNo && spec) map.set(`ms:${materialNo}::${spec}`, sku)
        if (name) map.set(`n:${name}`, sku)
        if (name && spec) map.set(`ns:${name}::${spec}`, sku)
      })
      result.set(String(cid), map)
    })
    return result
  }, [customerSkusByCustomerId])

  useEffect(() => {
    const normalizeText = (v) => String(v ?? '').trim()
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
    const ids = Array.from(new Set((orders || [])
      .map((o) => normalizeId(
        o?.customerId ??
        o?.customer?._id ??
        o?.customer?.id ??
        o?.data?.customerId ??
        o?.data?.customer?._id ??
        o?.data?.customer?.id ??
        o?.meta?.customerId ??
        o?.meta?.customer?._id ??
        o?.meta?.customer?.id ??
        o?.meta?.brief?.customerId ??
        o?.meta?.brief?.customer?._id ??
        o?.meta?.brief?.customer?.id ??
        o?.product?.customerId ??
        o?.product?.customer?._id ??
        o?.product?.customer?.id
      ))
      .filter(Boolean)))
    if (!ids.length) return

    let cancelled = false
    const loadForCustomer = async (customerId) => {
      if (!customerId) return
      if ((customerSkusByCustomerId || {})[customerId]) return
      if (inflightCustomerSkuRef.current.has(customerId)) return
      inflightCustomerSkuRef.current.add(customerId)
      try {
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
        if (cancelled) return
        const normalized = (all || []).map((s) => {
          const sid = normalizeId(s?.id ?? s?._id)
          return { ...s, id: sid || undefined, _id: sid || s?._id }
        })
        setCustomerSkusByCustomerId((prev) => ({ ...(prev || {}), [customerId]: normalized }))
      } catch (_) {
        if (!cancelled) setCustomerSkusByCustomerId((prev) => ({ ...(prev || {}), [customerId]: [] }))
      } finally {
        inflightCustomerSkuRef.current.delete(customerId)
      }
    }
    ;(async () => {
      for (const cid of ids) {
        if (cancelled) return
        await loadForCustomer(cid)
      }
    })()
    return () => { cancelled = true }
  }, [orders, customerSkusByCustomerId])

  const displayOrders = useMemo(() => {
    const list = Array.isArray(orders) ? orders : []
    const out = []
    const normalizeText = (v) => String(v ?? '').trim()
    const normalizeKey = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, '')
    const normalizeSpecKey = (v) => normalizeKey(v).replace(/[x*]/g, '×').replace(/mm$/i, '')
    const normalizeSizeToken = (v) =>
      normalizeText(v)
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
    const normalizeId = (v) => {
      const s = normalizeText(v)
      if (!s) return ''
      const parts = s.split(/[\\/]/).filter(Boolean)
      return parts.length ? parts[parts.length - 1] : s
    }
    const pickText = (...candidates) => {
      for (const c of candidates) {
        const s = normalizeText(c)
        if (s) return s
      }
      return ''
    }
    const toNum = (v) => {
      const n = Number(v)
      if (Number.isFinite(n)) return n
      const m = String(v ?? '').match(/-?\d+(\.\d+)?/)
      return m ? Number(m[0]) : 0
    }
    const isMaterialCodeFormat = (val) => /^(AB|EB|A|B|E)楞$/.test(normalizeText(val))
    const resolveMaterialNo = ({ localMaterialNo, skuMaterialNo, materialCode }) => {
      const keyOf = (x) => normalizeKey(String(x || ''))
      const local = normalizeText(localMaterialNo)
      const sku = normalizeText(skuMaterialNo)
      const code = normalizeText(materialCode)
      if (local && !isMaterialCodeFormat(local) && (!code || keyOf(local) !== keyOf(code))) return local
      if (sku && !isMaterialCodeFormat(sku) && (!code || keyOf(sku) !== keyOf(code))) return sku
      return ''
    }
    const resolveSpecText = (raw, skuFromIndex, boardWidth, boardHeight) => {
      const skuSpecRaw = normalizeText(skuFromIndex?.specification ?? skuFromIndex?.spec)
      const rawSpec = normalizeText(raw)
      const rawDims = parseDimsFromToken(rawSpec)
      if (rawDims && rawDims.length === 2 && Number(boardWidth) > 0 && Number(boardHeight) > 0 && skuSpecRaw) {
        const s0 = normalizeSizeToken(`${rawDims[0]}×${rawDims[1]}`)
        const bw = normalizeSizeToken(`${boardWidth}×${boardHeight}`)
        const bh = normalizeSizeToken(`${boardHeight}×${boardWidth}`)
        if ((s0 === bw || s0 === bh) && normalizeSizeToken(skuSpecRaw) !== normalizeSizeToken(rawSpec)) {
          return /(mm)$/i.test(skuSpecRaw) ? skuSpecRaw : `${skuSpecRaw}mm`
        }
      }
      if (rawDims && rawDims.length === 2 && Number(boardWidth) > 0 && Number(boardHeight) > 0 && !skuSpecRaw) {
        const s0 = normalizeSizeToken(`${rawDims[0]}×${rawDims[1]}`)
        const bw = normalizeSizeToken(`${boardWidth}×${boardHeight}`)
        const bh = normalizeSizeToken(`${boardHeight}×${boardWidth}`)
        if (s0 === bw || s0 === bh) return ''
      }
      const finalSpecRaw = rawSpec || skuSpecRaw
      if (!finalSpecRaw) return ''
      return /(mm)$/i.test(finalSpecRaw) ? finalSpecRaw : `${finalSpecRaw}mm`
    }

    const getOrderItems = (order) => {
      const o = order && typeof order === 'object' ? order : {}
      if (Array.isArray(o.items)) return o.items
      if (Array.isArray(o?.data?.items)) return o.data.items
      return []
    }

    const normalizeRow = (order, item) => {
      const o = order && typeof order === 'object' ? order : {}
      const it = item && typeof item === 'object' ? item : null
      const data = o?.data && typeof o.data === 'object' ? o.data : null
      const meta = o?.meta && typeof o.meta === 'object' ? o.meta : null
      const brief = meta?.brief && typeof meta.brief === 'object' ? meta.brief : null
      const product = o?.product && typeof o.product === 'object' ? o.product : null
      const first = (o?.items && o.items[0]) ? o.items[0] : null
      const firstData = first?.data && typeof first.data === 'object' ? first.data : null
      const itemData = it?.data && typeof it.data === 'object' ? it.data : null

      const customerId = normalizeId(
        o.customerId || o.customer?._id || o.customer?.id ||
        data?.customerId || data?.customer?._id || data?.customer?.id ||
        meta?.customerId || meta?.customer?._id || meta?.customer?.id ||
        brief?.customerId || brief?.customer?._id || brief?.customer?.id ||
        product?.customerId || product?.customer?._id || product?.customer?.id
      )
      const skuId = normalizeId(
        it?.skuId || it?.sku_id || it?.sku?._id || it?.sku?.id || it?.customerSkuId || it?.customer_sku_id ||
        o.skuId || o.sku_id || o.sku?._id || o.sku?.id || o.customerSkuId || o.customer_sku_id ||
        data?.skuId || data?.sku_id || data?.sku?._id || data?.sku?.id || data?.customerSkuId || data?.customer_sku_id ||
        meta?.skuId || meta?.sku_id || meta?.sku?._id || meta?.sku?.id || meta?.customerSkuId || meta?.customer_sku_id ||
        brief?.skuId || brief?.sku_id || brief?.sku?._id || brief?.sku?.id || brief?.customerSkuId || brief?.customer_sku_id ||
        product?.skuId || product?.sku_id || product?.sku?._id || product?.sku?.id || product?.customerSkuId || product?.customer_sku_id
      )
      const skuIndex = customerId ? customerSkuIndexByCustomerId.get(customerId) : null
      const rawSpec = pickText(
        it?.specification, it?.spec, it?.productSpec, it?.product_spec,
        itemData?.specification, itemData?.spec, itemData?.productSpec, itemData?.product_spec,
        o?.specification, o?.spec, o?.productSpec, o?.product_spec,
        data?.specification, data?.spec, data?.productSpec, data?.product_spec,
        meta?.specification, meta?.spec, meta?.productSpec, meta?.product_spec,
        brief?.specification, brief?.spec, brief?.productSpec, brief?.product_spec,
        product?.specification, product?.spec, product?.productSpec, product?.product_spec,
        first?.specification, first?.spec, first?.productSpec, first?.product_spec,
        firstData?.specification, firstData?.spec, firstData?.productSpec, firstData?.product_spec
      )
      const localMaterialNo = pickText(
        it?.materialNo, it?.material_no,
        itemData?.materialNo, itemData?.material_no,
        o?.materialNo, o?.material_no,
        data?.materialNo, data?.material_no,
        meta?.materialNo, meta?.material_no,
        brief?.materialNo, brief?.material_no,
        product?.materialNo, product?.material_no,
        first?.materialNo, first?.material_no,
        firstData?.materialNo, firstData?.material_no
      )
      const materialNoKey = normalizeKey(localMaterialNo)
      const specKey = normalizeSpecKey(rawSpec)
      const nameKey = normalizeKey(
        it?.goodsName || it?.goods_name || it?.productTitle || it?.product_title || it?.title || it?.productName || it?.product_name ||
        o?.goodsName || o?.goods_name || o?.productTitle || o?.product_title || o?.title || o?.productName || o?.product_name ||
        first?.goodsName || first?.goods_name || first?.title || first?.productName || first?.product_name ||
        product?.name || product?.productName || ''
      )
      const skuFromIndex = (() => {
        if (!skuIndex) return null
        if (skuId && skuIndex.has(`id:${normalizeKey(skuId)}`)) return skuIndex.get(`id:${normalizeKey(skuId)}`)
        if (materialNoKey && specKey && skuIndex.has(`ms:${materialNoKey}::${specKey}`)) return skuIndex.get(`ms:${materialNoKey}::${specKey}`)
        if (materialNoKey && skuIndex.has(`m:${materialNoKey}`)) return skuIndex.get(`m:${materialNoKey}`)
        if (nameKey && specKey && skuIndex.has(`ns:${nameKey}::${specKey}`)) return skuIndex.get(`ns:${nameKey}::${specKey}`)
        if (nameKey && skuIndex.has(`n:${nameKey}`)) return skuIndex.get(`n:${nameKey}`)
        return null
      })()

      const materialCodePicked = pickText(
        it?.materialCode, it?.material_code,
        itemData?.materialCode, itemData?.material_code,
        o?.materialCode, o?.material_code,
        data?.materialCode, data?.material_code,
        meta?.materialCode, meta?.material_code,
        brief?.materialCode, brief?.material_code,
        product?.materialCode, product?.material_code,
        first?.materialCode, first?.material_code,
        firstData?.materialCode, firstData?.material_code,
        skuFromIndex?.materialCode, skuFromIndex?.material_code
      )
      const materialNoPicked = pickText(
        it?.materialNo, it?.material_no,
        itemData?.materialNo, itemData?.material_no,
        o?.materialNo, o?.material_no,
        data?.materialNo, data?.material_no,
        meta?.materialNo, meta?.material_no,
        brief?.materialNo, brief?.material_no,
        product?.materialNo, product?.material_no,
        first?.materialNo, first?.material_no,
        firstData?.materialNo, firstData?.material_no,
        skuFromIndex?.materialNo, skuFromIndex?.material_no
      )

      const looksLikeMaterialNo2 = (v) => {
        const s = normalizeText(v)
        if (!s) return false
        if (/^\d+$/.test(s)) return true
        if (s.length > 6 && /\d/.test(s) && /^[A-Za-z0-9-]+$/.test(s)) return true
        return false
      }
      const looksLikeMaterialCode2 = (v) => {
        const s = normalizeText(v)
        if (!s) return false
        if (/^\d+$/.test(s)) return false
        if (s.length < 12) return true
        return false
      }

      let materialCodeFinal = normalizeText(materialCodePicked)
      let materialNo = normalizeText(materialNoPicked)

      if (looksLikeMaterialNo2(materialCodeFinal) && (!materialNo || looksLikeMaterialCode2(materialNo))) {
        const temp = materialCodeFinal
        materialCodeFinal = materialNo
        materialNo = temp
      } else if (looksLikeMaterialNo2(materialCodeFinal) && !materialNo) {
        materialNo = materialCodeFinal
        materialCodeFinal = ''
      } else if (!materialCodeFinal && materialNo && looksLikeMaterialCode2(materialNo) && !looksLikeMaterialNo2(materialNo)) {
        materialCodeFinal = materialNo
        materialNo = ''
      }

      if (materialCodeFinal && materialNo && normalizeKey(materialCodeFinal) === normalizeKey(materialNo)) {
        materialCodeFinal = ''
      }

      const flute = normalizeText(
        it?.flute ?? it?.flute_code ??
        itemData?.flute ?? itemData?.flute_code ??
        o?.flute ?? o?.flute_code ??
        data?.flute ?? data?.flute_code ??
        first?.flute ?? first?.flute_code ??
        firstData?.flute ?? firstData?.flute_code ??
        skuFromIndex?.flute ?? skuFromIndex?.flute_code
      )
      
      const joinMethod = normalizeText(
        it?.joinMethod ?? it?.join_method ??
        o?.joinMethod ?? o?.join_method ??
        first?.joinMethod ?? first?.join_method ??
        skuFromIndex?.joinMethod ?? skuFromIndex?.join_method
      )
      
      const notes = pickText(
        it?.notes, it?.note, it?.remark, it?.remarks, it?.memo, it?.comment, it?.comments, it?.description,
        itemData?.notes, itemData?.note, itemData?.remark, itemData?.remarks, itemData?.memo, itemData?.comment, itemData?.comments, itemData?.description,
        o?.notes, o?.note, o?.remark, o?.remarks, o?.memo, o?.comment, o?.comments, o?.description,
        data?.notes, data?.note, data?.remark, data?.remarks, data?.memo, data?.comment, data?.comments, data?.description,
        meta?.notes, meta?.note, meta?.remark, meta?.remarks, meta?.memo,
        brief?.notes, brief?.note, brief?.remark, brief?.remarks, brief?.memo
      )

      const boardWidth = toNum(
        it?.boardWidth ?? it?.board_width ??
        itemData?.boardWidth ?? itemData?.board_width ??
        o?.boardWidth ?? o?.board_width ??
        data?.boardWidth ?? data?.board_width ??
        meta?.boardWidth ?? meta?.board_width ??
        brief?.boardWidth ?? brief?.board_width ??
        product?.boardWidth ?? product?.board_width ??
        first?.boardWidth ?? first?.board_width ??
        firstData?.boardWidth ?? firstData?.board_width ??
        it?.specWidth ?? it?.spec_width ??
        itemData?.specWidth ?? itemData?.spec_width ??
        o?.specWidth ?? o?.spec_width ??
        data?.specWidth ?? data?.spec_width ??
        skuFromIndex?.boardWidth ?? skuFromIndex?.board_width ??
        0
      )
      const boardHeight = toNum(
        it?.boardHeight ?? it?.board_height ??
        itemData?.boardHeight ?? itemData?.board_height ??
        o?.boardHeight ?? o?.board_height ??
        data?.boardHeight ?? data?.board_height ??
        meta?.boardHeight ?? meta?.board_height ??
        brief?.boardHeight ?? brief?.board_height ??
        product?.boardHeight ?? product?.board_height ??
        first?.boardHeight ?? first?.board_height ??
        firstData?.boardHeight ?? firstData?.board_height ??
        it?.specLength ?? it?.spec_length ??
        itemData?.specLength ?? itemData?.spec_length ??
        o?.specLength ?? o?.spec_length ??
        data?.specLength ?? data?.spec_length ??
        skuFromIndex?.boardHeight ?? skuFromIndex?.board_height ??
        0
      )

      const specText = resolveSpecText(rawSpec, skuFromIndex, boardWidth, boardHeight)

      return {
        skuFromIndex,
        materialNo,
        materialCode: materialCodeFinal,
        flute,
        joinMethod,
        notes,
        boardWidth: boardWidth > 0 ? boardWidth : undefined,
        boardHeight: boardHeight > 0 ? boardHeight : undefined,
        spec: specText
      }
    }

    list.forEach((o) => {
      const items = getOrderItems(o)
      const baseRaw = String(o?.orderNo || o?.orderNumber || '').trim()
      const baseForSplit = baseRaw.replace(/-\d+$/, '') || baseRaw
      if (items.length <= 1) {
        const extra = normalizeRow(o, items[0] || null)
        out.push({
          ...o,
          skuFromIndex: extra.skuFromIndex,
          materialNo: extra.materialNo || '',
          materialCode: extra.materialCode || '',
          flute: extra.flute || '',
          joinMethod: extra.joinMethod || '',
          notes: extra.notes || '',
          spec: extra.spec || o?.spec || '',
          boardWidth: o?.boardWidth ?? o?.board_width ?? extra.boardWidth ?? undefined,
          boardHeight: o?.boardHeight ?? o?.board_height ?? extra.boardHeight ?? undefined
        })
        return
      }
      items.forEach((it, idx) => {
        const rowNo = baseForSplit ? `${baseForSplit}-${idx + 1}` : ''
        const goodsName = it?.goodsName || it?.title || it?.productName || it?.name || o?.goodsName || o?.productTitle || '-'
        const extra = normalizeRow(o, it)
        out.push({
          ...o,
          key: `order_item_${String(o?.key || o?._id || o?.id || baseForSplit || baseRaw || 'order')}_${idx + 1}`,
          __parentKey: o?.key,
          __itemIndex: idx,
          orderNo: rowNo || baseRaw || o?.orderNo || '',
          goodsName,
          skuFromIndex: extra.skuFromIndex,
          materialNo: extra.materialNo,
          materialCode: extra.materialCode,
          flute: extra.flute,
          joinMethod: extra.joinMethod,
          notes: extra.notes,
          skuId: normalizeId(it?.skuId || it?.sku_id || it?.sku?._id || it?.sku?.id || it?.customerSkuId || it?.customer_sku_id || o?.skuId || o?.sku_id || o?.customerSkuId || o?.customer_sku_id),
          spec: extra.spec,
          boardWidth: extra.boardWidth,
          boardHeight: extra.boardHeight,
          quantity: Number(it?.quantity ?? 0) || 0,
          sheetCount: Number(it?.quantity ?? 0) || 0
        })
      })
    })
    return out
  }, [customerSkuIndexByCustomerId, orders])

  const groupedDisplayOrders = useMemo(() => {
    const flat = Array.isArray(displayOrders) ? displayOrders : []
    const getOrderItems = (order) => {
      const o = order && typeof order === 'object' ? order : {}
      if (Array.isArray(o.items)) return o.items
      if (Array.isArray(o?.data?.items)) return o.data.items
      return []
    }
    const byParentKey = new Map()
    flat.forEach((r) => {
      const pk = String(r?.__parentKey || '').trim()
      if (!pk) return
      if (!byParentKey.has(pk)) byParentKey.set(pk, [])
      byParentKey.get(pk).push(r)
    })
    const out = []
    const byKey = new Map()
    flat.forEach((r) => {
      const k = String(r?.key || '').trim()
      if (k) byKey.set(k, r)
    })
    ;(Array.isArray(orders) ? orders : []).forEach((o) => {
      const items = getOrderItems(o)
      const parentKey = String(o?.key || o?._id || o?.id || '').trim()
      const baseNoRaw = String(o?.orderNo || o?.orderNumber || '').trim()
      const baseNo = baseNoRaw.replace(/-\d+$/, '') || baseNoRaw
      if (items.length > 1) {
        const children = (byParentKey.get(parentKey) || []).slice().sort((a, b) => Number(a?.__itemIndex ?? 0) - Number(b?.__itemIndex ?? 0))
        out.push({
          ...o,
          key: parentKey || (baseNo ? `order_parent_${baseNo}` : undefined),
          orderNo: baseNo,
          __groupParent: true,
          children
        })
      } else {
        const k = parentKey
        const leaf = byKey.get(k)
        out.push(leaf || o)
      }
    })
    return out
  }, [orders, displayOrders])

  const rowKeyToParentKey = useMemo(() => {
    const map = new Map()
    ;(displayOrders || []).forEach((r) => {
      const k = String(r?.key || '').trim()
      if (!k) return
      const pk = String(r?.__parentKey || r?.key || '').trim()
      if (!pk) return
      map.set(k, pk)
    })
    return map
  }, [displayOrders])

  const selectedParentKeys = useMemo(() => {
    const set = new Set()
    ;(selectedRowKeys || []).forEach((k) => {
      const key = String(k || '').trim()
      if (!key) return
      const pk = rowKeyToParentKey.get(key) || key
      if (pk) set.add(pk)
    })
    return Array.from(set)
  }, [rowKeyToParentKey, selectedRowKeys])

  const setPending = async () => {
    if (!selectedRowKeys.length) { message.info('请选择订单'); return }
    setLoading(true)
    try {
      const targets = orders.filter(o => selectedParentKeys.includes(o.key))
      await Promise.all(targets.map(async (o) => {
        const id = o._id || o.id || o.key
        await orderAPI.updateOrder(id, { status: 'pending' }).catch(() => undefined)
      }))
      const next = orders.map(o => selectedParentKeys.includes(o.key) ? { ...o, status: 'pending' } : o)
      setOrders(next)
      setSelectedRowKeys([])
      loadStats()
      message.success('已设为待生产')
    } catch (_) {
      message.error('设置失败')
    } finally {
      setLoading(false)
    }
  }

  const handleBatchShipping = () => {
    const selectedKeySet = new Set((selectedRowKeys || []).map((k) => String(k || '').trim()).filter(Boolean))
    const selected = displayOrders.filter((r) => selectedKeySet.has(String(r?.key || '').trim()))

    if (selected.length === 0) {
      message.warning('请先勾选要发货的订单')
      return
    }

    const toNumber = (v, fallback = 0) => {
      const n = Number(v)
      return Number.isFinite(n) ? n : fallback
    }

    const normalizeKey = (v) => String(v ?? '').trim().toLowerCase().replace(/\s+/g, '')
    const distributeQty = (totalQty, weights) => {
      const total = Math.round(Number(totalQty) || 0)
      if (total <= 0) return weights.map(() => 0)
      if (weights.length <= 1) return [total]
      const w = weights.map((v) => {
        const n = Number(v)
        return Number.isFinite(n) && n > 0 ? n : 0
      })
      const sum = w.reduce((s, x) => s + x, 0)
      if (sum <= 0) {
        const out = weights.map(() => 0)
        out[0] = total
        return out
      }
      const raw = w.map((x) => (total * x) / sum)
      const base = raw.map((x) => Math.floor(x))
      let remain = total - base.reduce((s, x) => s + x, 0)
      const remainders = raw.map((x, idx) => ({ idx, r: x - base[idx] }))
      remainders.sort((a, b) => b.r - a.r)
      let ptr = 0
      while (remain > 0) {
        const idx = remainders[ptr]?.idx ?? 0
        base[idx] += 1
        remain -= 1
        ptr = (ptr + 1) % remainders.length
      }
      return base
    }

    const parentIdOf = (r) => String(r?._id || r?.id || r?.orderId || '').trim()
    const rowsByParentId = new Map()
    selected.forEach((r) => {
      const pid = parentIdOf(r)
      if (!pid) return
      if (!rowsByParentId.has(pid)) rowsByParentId.set(pid, [])
      rowsByParentId.get(pid).push(r)
    })

    const allRowsForParent = (pid) => {
      const list = displayOrders.filter((r) => parentIdOf(r) === pid)
      return list.sort((a, b) => Number(a?.__itemIndex ?? 0) - Number(b?.__itemIndex ?? 0))
    }

    const buildKey = (r) => `${normalizeKey(r?.materialNo)}|${normalizeKey(r?.goodsName)}|${normalizeKey(r?.spec)}`

    const calcTotals = (orderLike) => {
      const totalStocked = toNumber(orderLike?.stockedQty || orderLike?.quantity, 0)
      const shipments = Array.isArray(orderLike?.shipments) ? orderLike.shipments : []
      const shippedAlready = (() => {
        if (shipments.length) {
          const sum = shipments.reduce((s, it) => {
            const v = toNumber(it?.qty ?? it?.quantity ?? it?.shipQty, 0)
            if (v <= 0) return s
            return s + v
          }, 0)
          if (sum > 0) return sum
        }
        return toNumber(orderLike?.shippedQty ?? orderLike?.deliveredQty, 0)
      })()
      return { totalStocked, shippedAlready, shipments }
    }

    const calcItemShippedByIndex = (orderLike, itemRows, shippedAlreadyTotal) => {
      const shipments = Array.isArray(orderLike?.shipments) ? orderLike.shipments : []
      const anyShipmentItems = shipments.some((s) => Array.isArray(s?.items) && s.items.length)
      const idxByKey = new Map(itemRows.map((r, idx) => [buildKey(r), idx]))
      if (anyShipmentItems) {
        const out = itemRows.map(() => 0)
        shipments.forEach((s) => {
          const shipItems = Array.isArray(s?.items) ? s.items : []
          shipItems.forEach((it) => {
            const qty = toNumber(it?.qty ?? it?.quantity, 0)
            if (qty <= 0) return
            const idx = Number.isFinite(Number(it?.itemIndex)) ? Number(it.itemIndex) : null
            if (idx !== null && idx >= 0 && idx < out.length) {
              out[idx] += qty
              return
            }
            const k = `${normalizeKey(it?.materialNo)}|${normalizeKey(it?.name || it?.goodsName)}|${normalizeKey(it?.spec)}`
            const hit = idxByKey.get(k)
            if (hit !== undefined) out[hit] += qty
          })
        })
        if (out.some((v) => v > 0)) return out
      }

      const noteItems = Array.isArray(orderLike?.shippingNote?.items) ? orderLike.shippingNote.items : []
      if (noteItems.length) {
        const noteQtyByKey = new Map()
        noteItems.forEach((it) => {
          const qty = toNumber(it?.qty ?? it?.quantity, 0)
          if (qty <= 0) return
          const k = `${normalizeKey(it?.materialNo)}|${normalizeKey(it?.name || it?.goodsName)}|${normalizeKey(it?.spec)}`
          noteQtyByKey.set(k, (noteQtyByKey.get(k) || 0) + qty)
        })
        let matched = 0
        const out = itemRows.map((r) => {
          const v = noteQtyByKey.get(buildKey(r)) ?? 0
          if (v > 0) matched += 1
          return v
        })
        if (matched > 0) return out
      }

      const weights = itemRows.map((r) => toNumber(r?.quantity, 0))
      return distributeQty(shippedAlreadyTotal, weights)
    }

    const prepared = []
    rowsByParentId.forEach((rows, pid) => {
      const sample = rows[0]
      const allRows = allRowsForParent(pid)
      const { totalStocked, shippedAlready, shipments } = calcTotals(sample)
      const weights = allRows.map((r) => toNumber(r?.quantity, 0))
      const stockedByIndex = distributeQty(totalStocked, weights)
      const shippedByIndex = calcItemShippedByIndex({ ...sample, shipments }, allRows, shippedAlready)
      rows.forEach((r) => {
        const idx = Number.isFinite(Number(r?.__itemIndex)) ? Number(r.__itemIndex) : 0
        const remain = Math.max(0, (stockedByIndex[idx] ?? 0) - (shippedByIndex[idx] ?? 0))
        prepared.push({ ...r, _shipRemain: remain, _shipParentId: pid })
      })
    })

    const preparedRows = prepared.length
      ? prepared
      : selected.map((r) => {
        const pid = parentIdOf(r) || String(r?.key || '').trim()
        return { ...r, _shipRemain: 0, _shipParentId: pid }
      })

    // 初始化发货数量为订单数量（可手动修改，且不做上限限制）
    const initialValues = {}
    preparedRows.forEach(order => {
      const key = String(order?.key || '')
      initialValues[`quantity_${key}`] = toNumber(order?.quantity, 0)
    })

    shippingForm.setFieldsValue(initialValues)
    setShippingOrders(preparedRows)
    setBatchShippingOpen(true)
  }

  const handleConfirmShipping = async () => {
    try {
      const values = await shippingForm.validateFields()

      const toNumber = (v, fallback = 0) => {
        const n = Number(v)
        return Number.isFinite(n) ? n : fallback
      }

      const nowIso = new Date().toISOString()

      const parentIdOf = (r) => String(r?._shipParentId || r?._id || r?.id || '').trim()
      const rowsByParent = new Map()
      shippingOrders.forEach((r) => {
        const pid = parentIdOf(r)
        if (!pid) return
        if (!rowsByParent.has(pid)) rowsByParent.set(pid, [])
        rowsByParent.get(pid).push(r)
      })

      const updates = Array.from(rowsByParent.entries()).map(([pid, rows]) => {
        const sample = rows[0]
        const prevShipments = Array.isArray(sample?.shipments) ? sample.shipments : []
        const shippedAlready = (() => {
          if (prevShipments.length) {
            const sum = prevShipments.reduce((s, it) => {
              const v = toNumber(it?.qty ?? it?.quantity ?? it?.shipQty, 0)
              if (v <= 0) return s
              return s + v
            }, 0)
            if (sum > 0) return sum
          }
          return toNumber(sample?.shippedQty ?? sample?.deliveredQty, 0)
        })()

        const shipmentItems = []
        let inputTotal = 0
        rows.forEach((r) => {
          const key = String(r?.key || '')
          const inputQty = toNumber(values[`quantity_${key}`], 0)
          if (inputQty <= 0) {
            throw new Error(`订单 ${r.orderNo || ''} 发货数量必须大于0`)
          }
          inputTotal += inputQty
          shipmentItems.push({
            itemIndex: r?.__itemIndex,
            name: r?.goodsName || '',
            spec: r?.spec || '',
            materialNo: r?.materialNo || '',
            unit: r?.unit || '',
            qty: inputQty
          })
        })

        const shippedQty = shippedAlready + inputTotal
        const shipments = prevShipments.concat([{ qty: inputTotal, time: nowIso, items: shipmentItems }])
        const payload = {
          shippedQty,
          shippedAt: nowIso,
          status: 'shipping',
          shipments
        }
        return { id: pid, payload, shippedQty, shipments }
      })

      await Promise.all(updates.map(u => orderAPI.updateOrder(u.id, u.payload)))

      const updatedIds = new Set(updates.map(u => String(u.id)))
      const shippedById = new Map(updates.map(u => [String(u.id), u.shippedQty]))
      const shipmentsById = new Map(updates.map(u => [String(u.id), u.shipments]))

      setOrders(prev => prev.map(o => {
        const id = o._id || o.id || o.key
        const idStr = String(id)
        if (!updatedIds.has(idStr)) return o
        return {
          ...o,
          status: 'shipping',
          shippedQty: shippedById.get(idStr),
          shipments: shipmentsById.get(idStr),
          shippedAt: nowIso
        }
      }))

      // 关闭对话框并清空选择
      setBatchShippingOpen(false)
      setShippingOrders([])
      setSelectedRowKeys([])
      shippingForm.resetFields()
      message.success('已记录发货')
      navigate('/shipping')

    } catch (error) {
      if (error.errorFields) {
        message.error('请检查发货数量输入')
      } else {
        message.error(error.message || '操作失败')
      }
    }
  }

  const getCustomerNameDisplay = (r) => {
    const customerId = r?.customerId || r?.customer?._id || r?.customer?.id
    const customerName = r?.customerName
    const customer = customers.find(c =>
      (customerId && (c._id === customerId || c.id === customerId)) ||
      (c.name === customerName || c.companyName === customerName)
    )
    return customer?.shortName || customerName || r?.shortName || '-'
  }

  const getCategoryDisplay = (r) => {
    const normalizeText = (v) => String(v ?? '').trim()
    const pickText = (...vals) => {
      for (const v of vals) {
        const s = normalizeText(v)
        if (s) return s
      }
      return ''
    }
    const first = (r?.items && r.items[0]) ? r.items[0] : null
    const data = r?.data && typeof r.data === 'object' ? r.data : null
    const meta = r?.meta && typeof r.meta === 'object' ? r.meta : null
    const brief = meta?.brief && typeof meta.brief === 'object' ? meta.brief : null
    const product = r?.product && typeof r.product === 'object' ? r.product : null
    const fromName = pickText(
      r?.productName,
      product?.name,
      r?.productTitle,
      first?.productName,
      first?.title,
      first?.goodsName
    )
    const fromCategory = pickText(
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
    return fromName || fromCategory || '-'
  }

  const buildPrintHtml = (rows, tpl = 'standard') => {
    const buildQrServerUrl = (payload, size = 220) => {
      const s = Number(size) || 220
      return `https://api.qrserver.com/v1/create-qr-code/?size=${s}x${s}&data=${encodeURIComponent(String(payload || ''))}`
    }
    const buildOrderQrPayload = ({ orderId, orderNo }) => {
      return JSON.stringify({ v: 1, orderId: String(orderId || '').trim(), orderNo: String(orderNo || '').trim() })
    }
    const widthMm = 80
    const heightMm = 140
    // 调整样式：字体加大，行高加大
    const pageCss = `@page{size:${widthMm}mm ${heightMm}mm;margin:0;}html,body{margin:0;padding:0;}`
    const styleBase = `
      body{font-family:Arial,'Microsoft YaHei';margin:0;padding:0;font-size:18px;color:#111827;background:#fff;}
      .print-page{page-break-after:always;break-after:page;box-sizing:border-box;width:${widthMm}mm;height:${heightMm}mm;padding:0mm 3mm 0mm;margin:0;overflow:hidden;position:relative;transform:translateY(-6mm);display:flex;flex-direction:column;}
      .print-page:last-child{page-break-after:auto;break-after:auto;}
      .header{margin:0 0 1mm;}
      .title{font-size:20px;line-height:1.2;font-weight:700;margin:0;text-align:center;}
      .order-no{font-size:18px;line-height:1.2;font-weight:700;margin:0;text-align:left;}
      table{border-collapse:collapse;table-layout:fixed;width:100%;}
      th,td{border:1px solid #d1d5db;padding:3px 4px;font-size:18px;line-height:1.4;vertical-align:top;word-break:break-all;overflow-wrap:anywhere;}
      th{background:#f3f4f6;text-align:left;width:24mm;white-space:nowrap;font-weight:700;}
      td{font-weight:600;}
      .qr-wrap{text-align:center;margin-top:auto;padding-top:1.5mm;display:flex;flex-direction:column;align-items:center;}
      .qr-wrap-label{font-size:16px;font-weight:700;margin-bottom:1.5mm;display:block;}
      .qr-wrap img{width:52mm;height:52mm;display:block;margin:0 auto;}
    `
    const style = `${pageCss}${styleBase}`
    
    const normalizeText = (v) => String(v ?? '').trim()
    const toNum = (v) => {
        const n = Number(v)
        if (Number.isFinite(n)) return n
        const m = String(v ?? '').match(/-?\d+(\.\d+)?/)
        return m ? Number(m[0]) : 0
    }

    const rowsHtml = rows.map(r => {
      // 确定当前行对应的 item (如果是子订单)
      const item = (r.__itemIndex !== undefined && Array.isArray(r.items)) 
          ? r.items[r.__itemIndex] 
          : ((Array.isArray(r.items) && r.items[0]) ? r.items[0] : null)
      const itemData = item?.data && typeof item.data === 'object' ? item.data : null
      const data = r?.data && typeof r.data === 'object' ? r.data : null
      const meta = r?.meta && typeof r.meta === 'object' ? r.meta : null
      const brief = meta?.brief && typeof meta.brief === 'object' ? meta.brief : null
      const product = r?.product && typeof r.product === 'object' ? r.product : null
      const first = (r?.items && r.items[0]) ? r.items[0] : null
      const firstData = first?.data && typeof first.data === 'object' ? first.data : null
          
      const customerNameDisplay = getCustomerNameDisplay(r)
      const categoryDisplay = getCategoryDisplay(r)
      const orderNo = r?.orderNo || r?.orderNumber || ''
      const orderId = r?._id || r?.id || r?.key || ''
      const qrUrl = r?.qrCodeUrl || (orderId || orderNo ? buildQrServerUrl(buildOrderQrPayload({ orderId, orderNo }), 220) : '')
      
      // 使用 displayOrders 预计算的字段
      const specText = r.spec || '-'
      const size = (r.boardWidth && r.boardHeight) ? `${r.boardWidth}×${r.boardHeight}mm` : '-'
      
      // 材质信息
      const skuFromIndex = r.skuFromIndex
      const materialCode = normalizeText(r.materialCode || '')
      const flute = normalizeText(r.flute || '')
      const materialText = (() => {
        if (!materialCode && !flute) return '-'
        if (!materialCode) return flute || '-'
        if (!flute) return materialCode || '-'
        return `${materialCode}/${flute}`
      })()
      const materialNoRaw = normalizeText(r.materialNo || '')
      const materialNoDisplay = (() => {
        if (!materialNoRaw) return '-'
        const norm = (v) => normalizeText(v).toLowerCase().replace(/[^a-z0-9]/g, '')
        const noKey = norm(materialNoRaw)
        const codeKey = norm(materialCode)
        if (noKey && codeKey && noKey === codeKey) return '-'
        const skuCode = normalizeText(skuFromIndex?.materialCode ?? skuFromIndex?.material_code)
        const skuNo = normalizeText(skuFromIndex?.materialNo ?? skuFromIndex?.material_no)
        const skuCodeKey = norm(skuCode)
        if (skuCodeKey && !skuNo && noKey === skuCodeKey) return '-'
        return materialNoRaw
      })()
      
      // 数量
      // quantity 是 displayOrders 计算好的 (子订单数量)
      // sheetCount 是 displayOrders 计算好的 (子订单片数)
      const quantity = r.quantity || 0
      const sheetCount = r.sheetCount || r.quantity || 0
      
      const pickText = (...vals) => {
        for (const v of vals) {
          const s = normalizeText(v)
          if (!s) continue
          if (['-', '—', '--', '---', '暂无', '无'].includes(s)) continue
          return s
        }
        return ''
      }

      // 拼接方式
      const joinMethod = r.joinMethod || '-'
      const notesText = pickText(
        r?.notes, r?.note, r?.remark, r?.remarks, r?.memo, r?.comment, r?.comments, r?.description,
        item?.notes, item?.note, item?.remark, item?.remarks, item?.memo, item?.comment, item?.comments, item?.description,
        itemData?.notes, itemData?.note, itemData?.remark, itemData?.remarks, itemData?.memo, itemData?.comment, itemData?.comments, itemData?.description,
        data?.notes, data?.note, data?.remark, data?.remarks, data?.memo, data?.comment, data?.comments, data?.description,
        meta?.notes, meta?.note, meta?.remark, meta?.remarks, meta?.memo,
        brief?.notes, brief?.note, brief?.remark, brief?.remarks, brief?.memo
      )
      
      // 压线尺寸 - 需要重新计算，因为 displayOrders 没有返回 resolved crease string
      // 优先使用 item 的压线信息
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
        skuFromIndex?.creasingSize_1, skuFromIndex?.creasing_size_1, skuFromIndex?.creaseSize_1, skuFromIndex?.crease_size_1
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
        skuFromIndex?.creasingSize_2, skuFromIndex?.creasing_size_2, skuFromIndex?.creaseSize_2, skuFromIndex?.crease_size_2
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
        skuFromIndex?.creasingSize_3, skuFromIndex?.creasing_size_3, skuFromIndex?.creaseSize_3, skuFromIndex?.crease_size_3
      )
      
      const creaseType = normalizeText(
          item?.creasingType ?? item?.creaseType ?? 
          itemData?.creasingType ?? itemData?.creaseType ??
          r.creasingType ?? r.creaseType ?? 
          data?.creasingType ?? data?.creaseType ??
          meta?.creasingType ?? meta?.creaseType ??
          brief?.creasingType ?? brief?.creaseType ??
          product?.creasingType ?? product?.creaseType ??
          first?.creasingType ?? first?.creaseType ??
          firstData?.creasingType ?? firstData?.creaseType ??
          skuFromIndex?.creasingType ?? skuFromIndex?.creaseType ?? ''
      )
      
      const pressLine = pickText(
          item?.pressLine, item?.press_line,
          item?.creasingSize, item?.creaseSize, item?.pressLineSize, item?.press_line_size,
          itemData?.pressLine, itemData?.press_line,
          itemData?.creasingSize, itemData?.creaseSize, itemData?.pressLineSize, itemData?.press_line_size,
          r.pressLine, r.press_line,
          r.creasingSize, r.creaseSize, r.pressLineSize, r.press_line_size,
          data?.pressLine, data?.press_line,
          data?.creasingSize, data?.creaseSize, data?.pressLineSize, data?.press_line_size,
          meta?.pressLine, meta?.press_line,
          meta?.creasingSize, meta?.creaseSize, meta?.pressLineSize, meta?.press_line_size,
          brief?.pressLine, brief?.press_line,
          brief?.creasingSize, brief?.creaseSize, brief?.pressLineSize, brief?.press_line_size,
          product?.pressLine, product?.press_line,
          product?.creasingSize, product?.creaseSize, product?.pressLineSize, product?.press_line_size,
          first?.pressLine, first?.press_line,
          first?.creasingSize, first?.creaseSize, first?.pressLineSize, first?.press_line_size,
          firstData?.pressLine, firstData?.press_line,
          firstData?.creasingSize, firstData?.creaseSize, firstData?.pressLineSize, firstData?.press_line_size,
          skuFromIndex?.pressLine, skuFromIndex?.press_line,
          skuFromIndex?.creasingSize, skuFromIndex?.creaseSize, skuFromIndex?.pressLineSize, skuFromIndex?.press_line_size
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
          const typeMatch = pressText.match(/[（(]([^（）()]+)[）)]/)
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

      return `
      <div class="print-page">
        <div class="header">
          <div class="title">施工单</div>
          <div class="order-no">订单号：${orderNo}</div>
        </div>
        <table>
          <tr><th>客户</th><td>${customerNameDisplay}</td></tr>
          <tr><th>产品</th><td>${categoryDisplay}</td></tr>
          <tr><th>规格</th><td>${specText}</td></tr>
          <tr><th>纸板尺寸</th><td>${size}</td></tr>
          <tr><th>压线尺寸</th><td>${crease}</td></tr>
          <tr><th>材质/楞别</th><td>${materialText}</td></tr>
          <tr><th>数量</th><td>${quantity}</td></tr>
          <tr><th>下单片数</th><td>${sheetCount}</td></tr>
          <tr><th>拼接方式</th><td>${joinMethod}</td></tr>
          <tr><th>物料号</th><td>${materialNoDisplay}</td></tr>
          <tr><th>商品名称</th><td>${r.goodsName || '-'}</td></tr>
          <tr><th>订单备注</th><td>${notesText || '-'}</td></tr>
        </table>
        ${qrUrl ? `<div class="qr-wrap"><span class="qr-wrap-label">订单二维码：</span><img src="${qrUrl}" alt="订单二维码"/></div>` : ''}
      </div>`
    }).join('')
    return `<!DOCTYPE html><html><head><meta charset="utf-8"><title>施工单打印</title><style>${style}</style></head><body>${rowsHtml}</body></html>`
  }

  const handlePrintWorkOrder = async () => {
    const rows = displayOrders.filter(o => selectedRowKeys.includes(o.key))
    if (!rows.length) { message.info('请选择订单'); return }

    const printRows = rows.map((r) => ({
      ...r,
      customerName: getCustomerNameDisplay(r)
    }))
    navigate('/production/workorder-print', { state: { printRows } })
    setSelectedRowKeys([])
  }

  const columns = [
    {
      title: '订单编号', dataIndex: 'orderNo', key: 'orderNo', width: 200, render: (_, r) => {
        const isGroupParent = Boolean(r?.__groupParent && Array.isArray(r?.children) && r.children.length > 0)
        return (
          <Space size={6}>
            <Link
              to={`/production/${r._id || r.id || r.key}?orderNo=${encodeURIComponent(r.orderNo || '')}`}
              state={{ seedOrder: r }}
              className={isGroupParent ? 'erp-production-orderNo-multi' : undefined}
            >
              {r.orderNo}
            </Link>
            {isGroupParent ? <Tag color="geekblue">多SKU</Tag> : null}
          </Space>
        )
      }
    },
    {
      title: '客户', dataIndex: 'customerName', key: 'customerName', width: 160, render: (text, record) => {
        const customerId = record.customerId || record.customer?._id || record.customer?.id
        const customerName = text
        const customer = customers.find(c =>
          (customerId && (c._id === customerId || c.id === customerId)) ||
          (c.name === customerName || c.companyName === customerName)
        )
        return customer?.shortName || text || '-'
      }
    },
    {
      title: '产品', key: 'product', width: 280, render: (_, r) => {
        const normalizeText = (v) => String(v ?? '').trim()
        const normalizeKey = (v) => normalizeText(v).toLowerCase().replace(/\s+/g, '')
        const normalizeSpecKey = (v) => normalizeKey(v).replace(/[x*]/g, '×').replace(/mm$/i, '')
        const toNum = (v) => {
          const n = Number(v)
          if (Number.isFinite(n)) return n
          const m = String(v ?? '').match(/-?\d+(\.\d+)?/)
          return m ? Number(m[0]) : 0
        }
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
        const pickText = (...vals) => {
          for (const v of vals) {
            const s = normalizeText(v)
            if (!s) continue
            if (['-', '—', '--', '---', '暂无', '无'].includes(s)) continue
            return s
          }
          return ''
        }
        const normalizeId = (v) => {
          const s = normalizeText(v)
          if (!s) return ''
          const parts = s.split(/[\\/]/).filter(Boolean)
          return parts.length ? parts[parts.length - 1] : s
        }
        const item = (r.__itemIndex !== undefined && Array.isArray(r.items))
          ? r.items[r.__itemIndex]
          : ((r.items && r.items[0]) ? r.items[0] : null)
        const first = (r.items && r.items[0]) ? r.items[0] : null
        const data = r?.data && typeof r.data === 'object' ? r.data : null
        const itemData = item?.data && typeof item.data === 'object' ? item.data : null
        const firstData = first?.data && typeof first.data === 'object' ? first.data : null
        const meta = r?.meta && typeof r.meta === 'object' ? r.meta : null
        const brief = meta?.brief && typeof meta.brief === 'object' ? meta.brief : null
        const product = r?.product && typeof r.product === 'object' ? r.product : null
        const customerId = normalizeId(r.customerId || r.customer?._id || r.customer?.id)
        const skuId = normalizeId(
          r.skuId || r.sku_id || r.sku?._id || r.sku?.id || r.customerSkuId || r.customer_sku_id ||
          first?.skuId || first?.sku_id || first?.sku?._id || first?.sku?.id || first?.customerSkuId || first?.customer_sku_id
        )
        const skuIndex = customerId ? customerSkuIndexByCustomerId.get(customerId) : null
        const rawSpec = normalizeText(
          item?.specification || item?.spec || item?.productSpec || item?.product_spec ||
          itemData?.specification || itemData?.spec || itemData?.productSpec || itemData?.product_spec ||
          r.specification ||
          r.productSpec || r.product_spec ||
          data?.specification || data?.productSpec || data?.product_spec ||
          first?.specification ||
          first?.productSpec || first?.product_spec ||
          firstData?.specification || firstData?.productSpec || firstData?.product_spec ||
          r.spec || data?.spec || first?.spec || firstData?.spec ||
          ''
        )
        const materialNoKey = normalizeKey(
          item?.materialNo || item?.material_no ||
          itemData?.materialNo || itemData?.material_no ||
          r.materialNo || r.material_no ||
          data?.materialNo || data?.material_no ||
          meta?.materialNo || meta?.material_no ||
          brief?.materialNo || brief?.material_no ||
          product?.materialNo || product?.material_no ||
          first?.materialNo || first?.material_no ||
          firstData?.materialNo || firstData?.material_no
        )
        const specKey = normalizeSpecKey(rawSpec)
        const skuFromIndex = (() => {
          if (!skuIndex) return null
          if (skuId && skuIndex.has(`id:${normalizeKey(skuId)}`)) return skuIndex.get(`id:${normalizeKey(skuId)}`)
          if (materialNoKey && specKey && skuIndex.has(`ms:${materialNoKey}::${specKey}`)) return skuIndex.get(`ms:${materialNoKey}::${specKey}`)
          if (materialNoKey && skuIndex.has(`m:${materialNoKey}`)) return skuIndex.get(`m:${materialNoKey}`)
          const nameKey = normalizeKey(
            r.goodsName || r.goods_name || r.productTitle || r.product_title || r.title ||
            first?.title || first?.productName || first?.goodsName || ''
          )
          if (nameKey && specKey && skuIndex.has(`ns:${nameKey}::${specKey}`)) return skuIndex.get(`ns:${nameKey}::${specKey}`)
          if (nameKey && skuIndex.has(`n:${nameKey}`)) return skuIndex.get(`n:${nameKey}`)
          return null
        })()

        const c1 = toNum((item?.creasingSize1 ?? item?.creaseSize1 ?? itemData?.creasingSize1 ?? itemData?.creaseSize1 ?? r.creasingSize1 ?? r.creaseSize1 ?? data?.creasingSize1 ?? data?.creaseSize1 ?? first?.creasingSize1 ?? first?.creaseSize1 ?? firstData?.creasingSize1 ?? firstData?.creaseSize1 ?? skuFromIndex?.creasingSize1) ?? 0)
        const c2 = toNum((item?.creasingSize2 ?? item?.creaseSize2 ?? itemData?.creasingSize2 ?? itemData?.creaseSize2 ?? r.creasingSize2 ?? r.creaseSize2 ?? data?.creasingSize2 ?? data?.creaseSize2 ?? first?.creasingSize2 ?? first?.creaseSize2 ?? firstData?.creasingSize2 ?? firstData?.creaseSize2 ?? skuFromIndex?.creasingSize2) ?? 0)
        const c3 = toNum((item?.creasingSize3 ?? item?.creaseSize3 ?? itemData?.creasingSize3 ?? itemData?.creaseSize3 ?? r.creasingSize3 ?? r.creaseSize3 ?? data?.creasingSize3 ?? data?.creaseSize3 ?? first?.creasingSize3 ?? first?.creaseSize3 ?? firstData?.creasingSize3 ?? firstData?.creaseSize3 ?? skuFromIndex?.creasingSize3) ?? 0)
        const creaseTextFromAny = parseCreaseText(pickText(
          item?.pressLine, item?.press_line,
          item?.creasingSize, item?.creaseSize, item?.pressLineSize, item?.press_line_size,
          itemData?.pressLine, itemData?.press_line,
          itemData?.creasingSize, itemData?.creaseSize, itemData?.pressLineSize, itemData?.press_line_size,
          r.pressLine, r.press_line,
          r.creasingSize, r.creaseSize, r.pressLineSize, r.press_line_size,
          data?.pressLine, data?.press_line,
          data?.creasingSize, data?.creaseSize, data?.pressLineSize, data?.press_line_size,
          meta?.pressLine, meta?.press_line,
          meta?.creasingSize, meta?.creaseSize, meta?.pressLineSize, meta?.press_line_size,
          brief?.pressLine, brief?.press_line,
          brief?.creasingSize, brief?.creaseSize, brief?.pressLineSize, brief?.press_line_size,
          product?.pressLine, product?.press_line,
          product?.creasingSize, product?.creaseSize, product?.pressLineSize, product?.press_line_size,
          first?.pressLine, first?.press_line,
          first?.creasingSize, first?.creaseSize, first?.pressLineSize, first?.press_line_size,
          firstData?.pressLine, firstData?.press_line,
          firstData?.creasingSize, firstData?.creaseSize, firstData?.pressLineSize, firstData?.press_line_size,
          skuFromIndex?.pressLine, skuFromIndex?.press_line,
          skuFromIndex?.creasingSize, skuFromIndex?.creaseSize, skuFromIndex?.pressLineSize, skuFromIndex?.press_line_size
        ))
        const type = String(
          item?.creasingType ?? item?.creaseType ??
          itemData?.creasingType ?? itemData?.creaseType ??
          r.creasingType ?? r.creaseType ??
          data?.creasingType ?? data?.creaseType ??
          first?.creasingType ?? first?.creaseType ??
          firstData?.creasingType ?? firstData?.creaseType ??
          skuFromIndex?.creasingType ?? skuFromIndex?.creaseType ??
          ''
        ).trim()
        const hasNums = Boolean(c1 || c2 || c3)
        const resolvedType = type || (creaseTextFromAny?.type || '')
        const resolvedC1 = hasNums ? c1 : (creaseTextFromAny?.c1 || 0)
        const resolvedC2 = hasNums ? c2 : (creaseTextFromAny?.c2 || 0)
        const resolvedC3 = hasNums ? c3 : (creaseTextFromAny?.c3 || 0)
        const resolvedHasNums = Boolean(resolvedC1 || resolvedC2 || resolvedC3)
        const creaseText = resolvedHasNums ? `${resolvedC1}-${resolvedC2}-${resolvedC3}mm${resolvedType ? ` (${resolvedType})` : ''}` : (resolvedType || '')

        const bw = toNum(item?.boardWidth ?? item?.board_width ?? itemData?.boardWidth ?? itemData?.board_width ?? r.boardWidth ?? r.board_width ?? data?.boardWidth ?? data?.board_width ?? first?.boardWidth ?? first?.board_width ?? firstData?.boardWidth ?? firstData?.board_width ?? r.specWidth ?? r.spec_width ?? data?.specWidth ?? data?.spec_width ?? skuFromIndex?.boardWidth ?? skuFromIndex?.board_width ?? 0)
        const bh = toNum(item?.boardHeight ?? item?.board_height ?? itemData?.boardHeight ?? itemData?.board_height ?? r.boardHeight ?? r.board_height ?? data?.boardHeight ?? data?.board_height ?? first?.boardHeight ?? first?.board_height ?? firstData?.boardHeight ?? firstData?.board_height ?? r.specLength ?? r.spec_length ?? data?.specLength ?? data?.spec_length ?? skuFromIndex?.boardHeight ?? skuFromIndex?.board_height ?? 0)
        const boardSpecText = (bw > 0 && bh > 0) ? `${bw}×${bh}mm` : ''

        const specText = normalizeText(r.spec || '')
        const categoryText = normalizeText(
          item?.category || item?.productCategory || item?.productType ||
          r.category || r.productCategory || r.productType ||
          first?.category || first?.productCategory || first?.productType ||
          skuFromIndex?.category || skuFromIndex?.productCategory || skuFromIndex?.productType
        )
        const flute = normalizeText(
          item?.flute ?? item?.flute_code ??
          itemData?.flute ?? itemData?.flute_code ??
          r.flute ?? r.flute_code ??
          data?.flute ?? data?.flute_code ??
          first?.flute ?? first?.flute_code ??
          firstData?.flute ?? firstData?.flute_code ??
          skuFromIndex?.flute ?? skuFromIndex?.flute_code
        )
        const isMaterialNo = (val) => {
          const s = normalizeText(val)
          if (!s) return false
          if (s.includes('-')) return /^\d/.test(s) && /\d/.test(s)
          return /^\d{6,}$/.test(s)
        }
        const materialCodeTextRaw = normalizeText(r.materialCode || r.material_code || skuFromIndex?.materialCode || skuFromIndex?.material_code)
        const materialCodeText = (() => {
          const codeKey = normalizeKey(materialCodeTextRaw)
          const noKey = normalizeKey(r.materialNo || r.material_no || '')
          if (codeKey && noKey && codeKey === noKey) return ''
          if (isMaterialNo(materialCodeTextRaw)) return ''
          return materialCodeTextRaw
        })()
        return (
          <div>
            {categoryText ? <div style={{ fontWeight: 700 }}>类别：{categoryText}</div> : null}
            {specText ? <div style={{ color: '#6b7280' }}>规格：{specText}</div> : null}
            {boardSpecText ? <div style={{ color: '#6b7280' }}>纸板尺寸：{boardSpecText}</div> : null}
            {creaseText ? <div style={{ color: '#6b7280' }}>压线尺寸：{creaseText}</div> : null}
          </div>
        )
      }
    },
    {
      title: '商品名称', dataIndex: 'goodsName', key: 'goodsName', width: 180, render: (_, r) => {
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
        const v = r.goodsName || r.productTitle || (r.items && r.items[0] && (r.items[0].title || r.items[0].productName || r.items[0].goodsName)) || '-'
        const first = (r.items && r.items[0]) ? r.items[0] : null
        const data = r?.data && typeof r.data === 'object' ? r.data : null
        const firstData = first?.data && typeof first.data === 'object' ? first.data : null
        const meta = r?.meta && typeof r.meta === 'object' ? r.meta : null
        const brief = meta?.brief && typeof meta.brief === 'object' ? meta.brief : null
        const product = r?.product && typeof r.product === 'object' ? r.product : null
        const customerId = normalizeId(
          r.customerId || r.customer?._id || r.customer?.id ||
          data?.customerId || data?.customer?._id || data?.customer?.id ||
          meta?.customerId || meta?.customer?._id || meta?.customer?.id ||
          brief?.customerId || brief?.customer?._id || brief?.customer?.id ||
          product?.customerId || product?.customer?._id || product?.customer?.id
        )
        const skuId = normalizeId(
          r.skuId || r.sku_id || r.sku?._id || r.sku?.id || r.customerSkuId || r.customer_sku_id ||
          first?.skuId || first?.sku_id || first?.sku?._id || first?.sku?.id || first?.customerSkuId || first?.customer_sku_id ||
          data?.skuId || data?.sku_id || data?.sku?._id || data?.sku?.id || data?.customerSkuId || data?.customer_sku_id ||
          meta?.skuId || meta?.sku_id || meta?.sku?._id || meta?.sku?.id || meta?.customerSkuId || meta?.customer_sku_id ||
          brief?.skuId || brief?.sku_id || brief?.sku?._id || brief?.sku?.id || brief?.customerSkuId || brief?.customer_sku_id ||
          product?.skuId || product?.sku_id || product?.sku?._id || product?.sku?.id || product?.customerSkuId || product?.customer_sku_id
        )
        const skuIndex = customerId ? customerSkuIndexByCustomerId.get(customerId) : null
        const rawSpec = normalizeText(
          r?.specification ||
          r?.productSpec || r?.product_spec ||
          data?.specification || data?.productSpec || data?.product_spec ||
          meta?.specification || meta?.productSpec || meta?.product_spec ||
          brief?.specification || brief?.productSpec || brief?.product_spec ||
          product?.specification || product?.productSpec || product?.product_spec ||
          first?.specification ||
          first?.productSpec || first?.product_spec ||
          firstData?.specification || firstData?.productSpec || firstData?.product_spec ||
          r?.spec || data?.spec || meta?.spec || brief?.spec || product?.spec || first?.spec || firstData?.spec ||
          ''
        )
        const localMaterialNo = normalizeText(
          r.materialNo || r.material_no ||
          data?.materialNo || data?.material_no ||
          meta?.materialNo || meta?.material_no ||
          brief?.materialNo || brief?.material_no ||
          product?.materialNo || product?.material_no ||
          first?.materialNo || first?.material_no ||
          firstData?.materialNo || firstData?.material_no
        )
        const localMaterialCode = normalizeText(
          r.materialCode || r.material_code ||
          data?.materialCode || data?.material_code ||
          meta?.materialCode || meta?.material_code ||
          brief?.materialCode || brief?.material_code ||
          product?.materialCode || product?.material_code ||
          first?.materialCode || first?.material_code ||
          firstData?.materialCode || firstData?.material_code
        )
        const materialNoKey = normalizeKey(localMaterialNo)
        const specKey = normalizeSpecKey(rawSpec)
        const skuFromIndex = (() => {
          if (!skuIndex) return null
          if (skuId && skuIndex.has(`id:${normalizeKey(skuId)}`)) return skuIndex.get(`id:${normalizeKey(skuId)}`)
          if (materialNoKey && specKey && skuIndex.has(`ms:${materialNoKey}::${specKey}`)) return skuIndex.get(`ms:${materialNoKey}::${specKey}`)
          if (materialNoKey && skuIndex.has(`m:${materialNoKey}`)) return skuIndex.get(`m:${materialNoKey}`)
          return null
        })()
        const skuMaterialNo = normalizeText(skuFromIndex?.materialNo || skuFromIndex?.material_no)
        const skuMaterialCode = normalizeText(skuFromIndex?.materialCode || skuFromIndex?.material_code)
        const materialCodeRaw = localMaterialCode || skuMaterialCode
        const materialCode = isMaterialNo(materialCodeRaw) ? '' : materialCodeRaw
        const materialNoFromCode = (!localMaterialNo && isMaterialNo(materialCodeRaw)) ? materialCodeRaw : ''
        const materialNoDisplay = (() => {
          const v = normalizeText(localMaterialNo || materialNoFromCode) || normalizeText(skuMaterialNo)
          if (!v) return ''
          if (materialCode && normalizeKey(v) === normalizeKey(materialCode)) return ''
          return v
        })()

        const pickText = (...vals) => {
          for (const v of vals) {
            const s = normalizeText(v)
            if (!s) continue
            if (['-', '—', '--', '---', '暂无', '无'].includes(s)) continue
            return s
          }
          return ''
        }

        const c1 = Number((
          r?.creasingSize1 ?? r?.creaseSize1 ?? r?.creasingSize_1 ?? r?.creaseSize_1 ?? r?.creasing_size1 ?? r?.crease_size1 ?? r?.creasing_size_1 ?? r?.crease_size_1 ??
          data?.creasingSize1 ?? data?.creaseSize1 ?? data?.creasingSize_1 ?? data?.creaseSize_1 ?? data?.creasing_size1 ?? data?.crease_size1 ?? data?.creasing_size_1 ?? data?.crease_size_1 ??
          meta?.creasingSize1 ?? meta?.creaseSize1 ?? meta?.creasingSize_1 ?? meta?.creaseSize_1 ?? meta?.creasing_size1 ?? meta?.crease_size1 ?? meta?.creasing_size_1 ?? meta?.crease_size_1 ??
          brief?.creasingSize1 ?? brief?.creaseSize1 ?? brief?.creasingSize_1 ?? brief?.creaseSize_1 ?? brief?.creasing_size1 ?? brief?.crease_size1 ?? brief?.creasing_size_1 ?? brief?.crease_size_1 ??
          product?.creasingSize1 ?? product?.creaseSize1 ?? product?.creasingSize_1 ?? product?.creaseSize_1 ?? product?.creasing_size1 ?? product?.crease_size1 ?? product?.creasing_size_1 ?? product?.crease_size_1 ??
          first?.creasingSize1 ?? first?.creaseSize1 ?? first?.creasingSize_1 ?? first?.creaseSize_1 ?? first?.creasing_size1 ?? first?.crease_size1 ?? first?.creasing_size_1 ?? first?.crease_size_1 ??
          firstData?.creasingSize1 ?? firstData?.creaseSize1 ?? firstData?.creasingSize_1 ?? firstData?.creaseSize_1 ?? firstData?.creasing_size1 ?? firstData?.crease_size1 ?? firstData?.creasing_size_1 ?? firstData?.crease_size_1 ??
          skuFromIndex?.creasingSize1 ?? skuFromIndex?.creaseSize1 ?? skuFromIndex?.creasingSize_1 ?? skuFromIndex?.creaseSize_1 ?? skuFromIndex?.creasing_size1 ?? skuFromIndex?.crease_size1 ?? skuFromIndex?.creasing_size_1 ?? skuFromIndex?.crease_size_1 ??
          0
        ) ?? 0)
        const c2 = Number((
          r?.creasingSize2 ?? r?.creaseSize2 ?? r?.creasingSize_2 ?? r?.creaseSize_2 ?? r?.creasing_size2 ?? r?.crease_size2 ?? r?.creasing_size_2 ?? r?.crease_size_2 ??
          data?.creasingSize2 ?? data?.creaseSize2 ?? data?.creasingSize_2 ?? data?.creaseSize_2 ?? data?.creasing_size2 ?? data?.crease_size2 ?? data?.creasing_size_2 ?? data?.crease_size_2 ??
          meta?.creasingSize2 ?? meta?.creaseSize2 ?? meta?.creasingSize_2 ?? meta?.creaseSize_2 ?? meta?.creasing_size2 ?? meta?.crease_size2 ?? meta?.creasing_size_2 ?? meta?.crease_size_2 ??
          brief?.creasingSize2 ?? brief?.creaseSize2 ?? brief?.creasingSize_2 ?? brief?.creaseSize_2 ?? brief?.creasing_size2 ?? brief?.crease_size2 ?? brief?.creasing_size_2 ?? brief?.crease_size_2 ??
          product?.creasingSize2 ?? product?.creaseSize2 ?? product?.creasingSize_2 ?? product?.creaseSize_2 ?? product?.creasing_size2 ?? product?.crease_size2 ?? product?.creasing_size_2 ?? product?.crease_size_2 ??
          first?.creasingSize2 ?? first?.creaseSize2 ?? first?.creasingSize_2 ?? first?.creaseSize_2 ?? first?.creasing_size2 ?? first?.crease_size2 ?? first?.creasing_size_2 ?? first?.crease_size_2 ??
          firstData?.creasingSize2 ?? firstData?.creaseSize2 ?? firstData?.creasingSize_2 ?? firstData?.creaseSize_2 ?? firstData?.creasing_size2 ?? firstData?.crease_size2 ?? firstData?.creasing_size_2 ?? firstData?.crease_size_2 ??
          skuFromIndex?.creasingSize2 ?? skuFromIndex?.creaseSize2 ?? skuFromIndex?.creasingSize_2 ?? skuFromIndex?.creaseSize_2 ?? skuFromIndex?.creasing_size2 ?? skuFromIndex?.crease_size2 ?? skuFromIndex?.creasing_size_2 ?? skuFromIndex?.crease_size_2 ??
          0
        ) ?? 0)
        const c3 = Number((
          r?.creasingSize3 ?? r?.creaseSize3 ?? r?.creasingSize_3 ?? r?.creaseSize_3 ?? r?.creasing_size3 ?? r?.crease_size3 ?? r?.creasing_size_3 ?? r?.crease_size_3 ??
          data?.creasingSize3 ?? data?.creaseSize3 ?? data?.creasingSize_3 ?? data?.creaseSize_3 ?? data?.creasing_size3 ?? data?.crease_size3 ?? data?.creasing_size_3 ?? data?.crease_size_3 ??
          meta?.creasingSize3 ?? meta?.creaseSize3 ?? meta?.creasingSize_3 ?? meta?.creaseSize_3 ?? meta?.creasing_size3 ?? meta?.crease_size3 ?? meta?.creasing_size_3 ?? meta?.crease_size_3 ??
          brief?.creasingSize3 ?? brief?.creaseSize3 ?? brief?.creasingSize_3 ?? brief?.creaseSize_3 ?? brief?.creasing_size3 ?? brief?.crease_size3 ?? brief?.creasing_size_3 ?? brief?.crease_size_3 ??
          product?.creasingSize3 ?? product?.creaseSize3 ?? product?.creasingSize_3 ?? product?.creaseSize_3 ?? product?.creasing_size3 ?? product?.crease_size3 ?? product?.creasing_size_3 ?? product?.crease_size_3 ??
          first?.creasingSize3 ?? first?.creaseSize3 ?? first?.creasingSize_3 ?? first?.creaseSize_3 ?? first?.creasing_size3 ?? first?.crease_size3 ?? first?.creasing_size_3 ?? first?.crease_size_3 ??
          firstData?.creasingSize3 ?? firstData?.creaseSize3 ?? firstData?.creasingSize_3 ?? firstData?.creaseSize_3 ?? firstData?.creasing_size3 ?? firstData?.crease_size3 ?? firstData?.creasing_size_3 ?? firstData?.crease_size_3 ??
          skuFromIndex?.creasingSize3 ?? skuFromIndex?.creaseSize3 ?? skuFromIndex?.creasingSize_3 ?? skuFromIndex?.creaseSize_3 ?? skuFromIndex?.creasing_size3 ?? skuFromIndex?.crease_size3 ?? skuFromIndex?.creasing_size_3 ?? skuFromIndex?.crease_size_3 ??
          0
        ) ?? 0)

        const type = pickText(
          r?.creasingType, r?.creasing_type, r?.creaseType, r?.crease_type,
          data?.creasingType, data?.creasing_type, data?.creaseType, data?.crease_type,
          meta?.creasingType, meta?.creasing_type, meta?.creaseType, meta?.crease_type,
          brief?.creasingType, brief?.creasing_type, brief?.creaseType, brief?.crease_type,
          product?.creasingType, product?.creasing_type, product?.creaseType, product?.crease_type,
          first?.creasingType, first?.creasing_type, first?.creaseType, first?.crease_type,
          firstData?.creasingType, firstData?.creasing_type, firstData?.creaseType, firstData?.crease_type,
          skuFromIndex?.creasingType, skuFromIndex?.creasing_type, skuFromIndex?.creaseType, skuFromIndex?.crease_type
        )
        const hasNums = Boolean(c1 || c2 || c3)
        const parseCreaseText = (v) => {
          const s = normalizeText(v)
          if (!s) return null
          const nums = (s.match(/-?\d+(\.\d+)?/g) || []).map((n) => Number(n)).filter((n) => Number.isFinite(n))
          if (nums.length < 2) return null
          const [a, b, c] = [nums[0] || 0, nums[1] || 0, nums[2] || 0]
          const typeMatch = s.match(/[（(]([^（）()]+)[）)]/)
          const t = normalizeText(typeMatch ? typeMatch[1] : '')
          return { c1: a, c2: b, c3: c, type: t }
        }
        const fromAny = parseCreaseText(pickText(
          r?.crease, r?.creaseText, r?.crease_text,
          data?.crease, data?.creaseText, data?.crease_text,
          meta?.crease, meta?.creaseText, meta?.crease_text,
          brief?.crease, brief?.creaseText, brief?.crease_text,
          product?.crease, product?.creaseText, product?.crease_text,
          first?.crease, first?.creaseText, first?.crease_text,
          firstData?.crease, firstData?.creaseText, firstData?.crease_text,
          r?.pressLine, r?.press_line,
          r?.creasingSize, r?.creaseSize, r?.pressLineSize, r?.press_line_size,
          data?.pressLine, data?.press_line,
          data?.creasingSize, data?.creaseSize, data?.pressLineSize, data?.press_line_size,
          meta?.pressLine, meta?.press_line,
          meta?.creasingSize, meta?.creaseSize, meta?.pressLineSize, meta?.press_line_size,
          brief?.pressLine, brief?.press_line,
          brief?.creasingSize, brief?.creaseSize, brief?.pressLineSize, brief?.press_line_size,
          product?.pressLine, product?.press_line,
          product?.creasingSize, product?.creaseSize, product?.pressLineSize, product?.press_line_size,
          first?.pressLine, first?.press_line,
          first?.creasingSize, first?.creaseSize, first?.pressLineSize, first?.press_line_size,
          firstData?.pressLine, firstData?.press_line,
          firstData?.creasingSize, firstData?.creaseSize, firstData?.pressLineSize, firstData?.press_line_size,
          skuFromIndex?.crease, skuFromIndex?.creaseText, skuFromIndex?.crease_text,
          skuFromIndex?.pressLine, skuFromIndex?.press_line,
          skuFromIndex?.creasingSize, skuFromIndex?.creaseSize, skuFromIndex?.pressLineSize, skuFromIndex?.press_line_size
        ))
        const resolvedType = type || (fromAny?.type || '')
        const resolvedC1 = hasNums ? c1 : (fromAny?.c1 || 0)
        const resolvedC2 = hasNums ? c2 : (fromAny?.c2 || 0)
        const resolvedC3 = hasNums ? c3 : (fromAny?.c3 || 0)
        const resolvedHasNums = Boolean(resolvedC1 || resolvedC2 || resolvedC3)
        const creaseText = resolvedHasNums ? `${resolvedC1}-${resolvedC2}-${resolvedC3}mm${resolvedType ? ` (${resolvedType})` : ''}` : (resolvedType || '')

        return (
          <div>
            <div>{v}</div>
            {materialNoDisplay ? <div style={{ color: '#6b7280' }}>物料号：{materialNoDisplay}</div> : null}
            {creaseText ? <div style={{ color: '#6b7280' }}>压线：{creaseText}</div> : null}
          </div>
        )
      }
    },
    { title: '数量', dataIndex: 'quantity', key: 'quantity', width: 100 },
    {
      title: '状态/进度', key: 'statusProgress', width: 220, render: (_, r) => {
        const map = { ordered: 0, pending: 0, processing: 50, stocked: 75, shipping: 90, completed: 100 }
        const percent = map[r.status] ?? 0
        const status = r.status === 'completed' ? 'success' : 'active'
        return (
          <div>
            <div style={{ marginBottom: 8 }}>
              <Tag color={statusMap[r.status]?.color} icon={statusMap[r.status]?.icon}>{statusMap[r.status]?.text}</Tag>
            </div>
            <Progress percent={percent} size="small" status={status} />
          </div>
        )
      }
    },
    { title: '开始时间', dataIndex: 'startedAt', key: 'startedAt', width: 160, render: (t, r) => (t && r.status !== 'pending' && r.status !== 'ordered') ? dayjs(t).format('YYYY-MM-DD HH:mm') : '' },
    { title: '完工时间', dataIndex: 'stockedAt', key: 'stockedAt', width: 180, render: (t) => t ? dayjs(t).format('YYYY-MM-DD HH:mm') : '' },
    {
      title: '完成数量', key: 'qtyDone', width: 140, render: (_, r) => {
        const producedQty = Number(r.producedQty || 0)
        const stockedQty = Number(r.stockedQty || 0)
        return (
          <div>
            <div>完成：{producedQty}</div>
            <div style={{ color: '#6b7280' }}>入库：{stockedQty}</div>
          </div>
        )
      }
    },
  ]

  return (
    <div>
      <h2 className="page-title">生产管理</h2>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 16, marginBottom: 16, flexWrap: 'wrap' }}>
        <Card className="stats-card" style={{ width: 160, height: 160, background: '#ff8a65', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}><div className="stats-value">{efficiencyStats.pending}</div><div className="stats-label">待生产</div></Card>
        <Card className="stats-card" style={{ width: 160, height: 160, background: '#42a5f5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}><div className="stats-value">{efficiencyStats.processing}</div><div className="stats-label">生产中</div></Card>
        <Card className="stats-card" style={{ width: 160, height: 160, background: '#4caf50', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}><div className="stats-value">{efficiencyStats.completedRate}<span className="stat-unit">%</span></div><div className="stats-label">完成率</div></Card>
        <Card className="stats-card" style={{ width: 160, height: 160, background: '#7e57c2', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}><div className="stats-value">{efficiencyStats.scrapRate}<span className="stat-unit">%</span></div><div className="stats-label">良品率</div></Card>
        <Card className="stats-card" style={{ width: 160, height: 160, background: '#7F7FD5', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}>
          <div className="stats-value" style={{ display: 'flex', alignItems: 'baseline', gap: 4, fontSize: 22, whiteSpace: 'nowrap' }}>
            <span style={{ fontSize: 22 }}>{efficiencyStats.avgDeliveryDays}</span>
            <span className="stat-unit" style={{ fontSize: 14 }}>天</span>
          </div>
          <div className="stats-label">完工时间</div>
        </Card>
        <Card className="stats-card" style={{ width: 160, height: 160, background: '#ffb74d', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column' }}><div className="stats-value">{efficiencyStats.onTimeRate}<span className="stat-unit">%</span></div><div className="stats-label">交付及时率</div></Card>
      </div>

      <Card style={{ marginBottom: 12 }}>
        <Space style={{ width: '100%', justifyContent: 'space-between' }}>
          <Space>
            <Space.Compact>
              <Input
                placeholder="搜索客户名、订单号、商品名称、物料号、规格、纸板尺寸"
                value={searchKeyword}
                onChange={(e) => setSearchKeyword(e.target.value)}
                onPressEnter={() => {
                  const trimmed = String(searchKeyword || '').trim()
                  setSearchKeyword(trimmed)
                  setCurrentPage(1)
                  loadOrders(1, trimmed)
                }}
                allowClear
                style={{ width: 320 }}
              />
              <Button onClick={() => {
                const trimmed = String(searchKeyword || '').trim()
                setSearchKeyword(trimmed)
                setCurrentPage(1)
                loadOrders(1, trimmed)
              }}>搜索</Button>
            </Space.Compact>
          </Space>
          <Space>
            {Array.isArray(selectedRowKeys) && selectedRowKeys.length ? (
              <Tag color="blue">已选 {selectedRowKeys.length} 条</Tag>
            ) : null}
            {Array.isArray(selectedRowKeys) && selectedRowKeys.length ? (
              <Button onClick={() => setSelectedRowKeys([])}>清空勾选</Button>
            ) : null}
            <Button type="primary" onClick={handleBatchShipping} disabled={!selectedRowKeys.length}>批量发货</Button>
            <Button onClick={() => handlePrintWorkOrder('standard')} disabled={!selectedRowKeys.length}>打印施工单</Button>
            <Button onClick={() => { loadOrders(currentPage); loadStats() }} loading={loading}>数据刷新</Button>
          </Space>
        </Space>
      </Card>

      <div>
        <Table
          rowSelection={{
            preserveSelectedRowKeys: true,
            selectedRowKeys,
            onChange: (keys) => setSelectedRowKeys(Array.isArray(keys) ? keys : [])
          }}
          rowClassName={(record) => {
            if (record?.__groupParent) return 'erp-production-multi-sku-parent'
            if (record?.__parentKey) return 'erp-production-multi-sku-child'
            return ''
          }}
          expandable={{
            indentSize: 24,
            expandIcon: ({ expanded, onExpand, record }) => {
              const canExpand = Boolean(record?.__groupParent && Array.isArray(record?.children) && record.children.length > 0)
              if (!canExpand) return null
              const Icon = expanded ? MinusSquareOutlined : PlusSquareOutlined
              return (
                <span
                  className="erp-production-expand-icon-large"
                  onClick={(e) => onExpand(record, e)}
                  style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
                >
                  <Icon />
                </span>
              )
            }
          }}
          columns={columns}
          dataSource={groupedDisplayOrders}
          loading={loading}
          pagination={false}
          sticky
          scroll={{ x: 1000, y: 640 }}
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
          <Pagination
            current={currentPage}
            pageSize={30}
            total={totalOrders}
            showSizeChanger={false}
            showTotal={(total) => `共 ${total} 条`}
            onChange={(page) => {
              const nextPage = Number(page || 1)
              setCurrentPage(nextPage)
              loadOrders(nextPage)
            }}
          />
        </div>
      </div>

      <Modal
        title="批量发货确认"
        open={batchShippingOpen}
        onCancel={() => {
          setBatchShippingOpen(false)
          setShippingOrders([])
          shippingForm.resetFields()
        }}
        onOk={handleConfirmShipping}
        width={900}
        okText="确认发货"
        cancelText="取消"
      >
        <Form form={shippingForm} layout="vertical">
          <p>已选择 <strong>{shippingOrders.length}</strong> 个订单</p>
          <Divider />
          <Table
            dataSource={shippingOrders}
            pagination={false}
            size="small"
            scroll={{ y: 400 }}
            rowKey={(record) => record.key}
            columns={[
              {
                title: '订单号',
                dataIndex: 'orderNo',
                key: 'orderNo',
                width: 140
              },
              {
                title: '客户',
                dataIndex: 'customerName',
                key: 'customerName',
                width: 120
              },
              {
                title: '产品',
                dataIndex: 'productName',
                key: 'productName',
                width: 120
              },
              {
                title: '商品名称',
                dataIndex: 'goodsName',
                key: 'goodsName',
                width: 150
              },
              {
                title: '规格',
                dataIndex: 'spec',
                key: 'spec',
                width: 120
              },
              {
                title: '物料号',
                dataIndex: 'materialNo',
                key: 'materialNo',
                width: 120
              },
              {
                title: '订单数量',
                dataIndex: 'quantity',
                key: 'quantity',
                width: 100
              },
              {
                title: '发货数量',
                key: 'shippingQuantity',
                width: 150,
                render: (_, record) => {
                  const key = String(record?.key || '')
                  const toNumber = (v, fallback = 0) => {
                    const n = Number(v)
                    return Number.isFinite(n) ? n : fallback
                  }
                  const remain = toNumber(record?._shipRemain, 0)
                  return (
                    <Form.Item
                      name={`quantity_${key}`}
                      rules={[
                        { required: true, message: '请输入发货数量' },
                        {
                          validator: async (_, value) => {
                            const n = Number(value)
                            if (!Number.isFinite(n) || n <= 0) {
                              throw new Error('发货数量必须大于0')
                            }
                          }
                        }
                      ]}
                      style={{ marginBottom: 0 }}
                    >
                      <Input
                        type="number"
                        min={0}
                        placeholder={remain > 0 ? `参考可发 ${remain}` : undefined}
                      />
                    </Form.Item>
                  )
                }
              }
            ]}
          />
        </Form>
      </Modal>
    </div>
  )
}

export default ProductionManagement
