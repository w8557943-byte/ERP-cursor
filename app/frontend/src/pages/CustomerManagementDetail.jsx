import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { App, Badge, Button, Card, Checkbox, Col, Descriptions, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography, Upload } from 'antd'
import { ArrowLeftOutlined, PlusOutlined, ReloadOutlined, SearchOutlined, UploadOutlined } from '@ant-design/icons'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import * as XLSX from 'xlsx'
import { cachedCustomerAPI, cachedCustomerSkuAPI } from '../services/cachedAPI'
import { customerSkuAPI, supplierAPI, supplierMaterialAPI, supplierOutsourcedMaterialAPI, userConfigAPI } from '../services/api'
import { computeInhouseRawMaterialCost, resolveSupplierMaterialPricePerSqm } from '../utils/materialCost'
import { safeNavigateBack } from '../utils'

function CustomerManagementDetail() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const location = useLocation()
  const { id } = useParams()

  const [loading, setLoading] = useState(false)
  const [customer, setCustomer] = useState(null)
  const [skuLoading, setSkuLoading] = useState(false)
  const [skuRows, setSkuRows] = useState([])
  const [skuPage, setSkuPage] = useState(1)
  const [skuPageSize, setSkuPageSize] = useState(10)
  const [skuTotal, setSkuTotal] = useState(0)
  const [skuImporting, setSkuImporting] = useState(false)
  const [skuImportReplaceMode, setSkuImportReplaceMode] = useState(false)
  const [skuKeywordInput, setSkuKeywordInput] = useState('')
  const [skuKeyword, setSkuKeyword] = useState('')
  const [selectedSkuKeys, setSelectedSkuKeys] = useState([])
  const [selectedSkuMap, setSelectedSkuMap] = useState({})
  const [skuDedupeLoading, setSkuDedupeLoading] = useState(false)
  const [skuQuoteGenerating, setSkuQuoteGenerating] = useState(false)
  const [skuBatchDeleting, setSkuBatchDeleting] = useState(false)
  const [skuImportReportOpen, setSkuImportReportOpen] = useState(false)
  const [skuImportReport, setSkuImportReport] = useState(null)

  const [batchMaterialOpen, setBatchMaterialOpen] = useState(false)
  const [batchMaterialSaving, setBatchMaterialSaving] = useState(false)
  const [batchMaterialType, setBatchMaterialType] = useState('inhouse')
  const [batchSupplierId, setBatchSupplierId] = useState('')
  const [batchMaterialCode, setBatchMaterialCode] = useState('')
  const [batchFlute, setBatchFlute] = useState('')
  const [batchOutsourcedMaterialId, setBatchOutsourcedMaterialId] = useState('')

  const [adjustPriceOpen, setAdjustPriceOpen] = useState(false)
  const [adjustPriceLoading, setAdjustPriceLoading] = useState(false)
  const [adjustPriceSaving, setAdjustPriceSaving] = useState(false)
  const [adjustPriceRows, setAdjustPriceRows] = useState([])

  const [priceTaxMode, setPriceTaxMode] = useState('taxed')

  const [skuSaving, setSkuSaving] = useState(false)
  const [editingSku, setEditingSku] = useState(null)
  const [skuForm] = Form.useForm()
  const skuProductionMode = Form.useWatch('productionMode', skuForm)
  const skuSupplierId = Form.useWatch('supplierId', skuForm)
  const skuMaterialCode = Form.useWatch('materialCode', skuForm)
  const skuBoardWidth = Form.useWatch('boardWidth', skuForm)
  const skuBoardHeight = Form.useWatch('boardHeight', skuForm)
  const skuMaterialPricePerSqm = Form.useWatch('materialPricePerSqm', skuForm)
  const skuUnitPrice = Form.useWatch('unitPrice', skuForm)
  const skuJoinMethod = Form.useWatch('joinMethod', skuForm)
  const skuDrawingUrl = Form.useWatch('drawingUrl', skuForm)
  const prevSupplierIdRef = useRef('')
  const prevCustomerIdRef = useRef('')
  const [skuDrawingFileList, setSkuDrawingFileList] = useState([])

  const [productCategories, setProductCategories] = useState(() => ['纸箱', '隔板', '天地盒', '飞机盒', '异性纸盒'])
  const [newCategory, setNewCategory] = useState('')
  const [categoryModalOpen, setCategoryModalOpen] = useState(false)
  const [categoryModalValue, setCategoryModalValue] = useState('')
  const [categorySaving, setCategorySaving] = useState(false)
  const [suppliersLoading, setSuppliersLoading] = useState(false)
  const [suppliers, setSuppliers] = useState([])
  const [supplierMaterialsLoading, setSupplierMaterialsLoading] = useState(false)
  const [supplierMaterialsBySupplier, setSupplierMaterialsBySupplier] = useState({})
  const [supplierOutsourcedMaterialsLoading, setSupplierOutsourcedMaterialsLoading] = useState(false)
  const [supplierOutsourcedMaterialsBySupplier, setSupplierOutsourcedMaterialsBySupplier] = useState({})
  const skuUnitOptions = useMemo(() => ([
    { value: '个', label: '个' },
    { value: '只', label: '只' },
    { value: '片', label: '片' },
    { value: '套', label: '套' },
    { value: '卷', label: '卷' },
    { value: '公斤', label: '公斤' },
    { value: '箱', label: '箱' }
  ]), [])

  const extractCustomer = (res) => {
    const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v)
    const looksLikeCustomer = (v) => {
      if (!isObject(v)) return false
      const keys = ['id', '_id', 'companyName', 'name', 'shortName', 'contact', 'contactName', 'phone', 'email']
      return keys.some((k) => v[k] !== undefined && v[k] !== null && String(v[k]).trim() !== '')
    }

    const candidates = [
      res,
      res?.data,
      res?.data?.data,
      res?.result,
      res?.result?.data
    ].filter(isObject)

    for (const c of candidates) {
      if (isObject(c.customer)) return c.customer
      if (isObject(c.data?.customer)) return c.data.customer
      if (looksLikeCustomer(c)) return c
      if (looksLikeCustomer(c.data)) return c.data
    }

    return null
  }

  const normalizeText = (v) => String(v == null ? '' : v).trim()
  const normalizeFluteList = useCallback((v) => {
    const out = []
    const push = (x) => {
      const s = normalizeText(x)
      if (!s) return
      if (out.includes(s)) return
      out.push(s)
    }
    if (Array.isArray(v)) {
      v.forEach(push)
      return out
    }
    const s = normalizeText(v)
    if (!s) return out
    s
      .split(/[/,，;；]+/)
      .map((x) => normalizeText(x))
      .filter(Boolean)
      .forEach(push)
    return out
  }, [])
  const buildFluteDisplay = useCallback((v) => {
    const list = normalizeFluteList(v)
    return list.length ? list.join('、') : ''
  }, [normalizeFluteList])
  const round4 = (n) => Math.round(Number(n) * 10000) / 10000
  const roundIntHalfUp = (n) => {
    const v = Number(n)
    if (!Number.isFinite(v)) return undefined
    return Math.floor(v + 0.5 + 1e-6)
  }
  const readFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    try {
      const reader = new FileReader()
      reader.onload = (e) => resolve(String(e?.target?.result || ''))
      reader.onerror = (e) => reject(e)
      reader.readAsDataURL(file)
    } catch (e) {
      reject(e)
    }
  })
  const getDrawingPreviewType = (url) => {
    const u = String(url || '').trim()
    if (!u) return 'none'
    const low = u.toLowerCase()
    if (low.startsWith('data:image/')) return 'image'
    if (low.startsWith('data:application/pdf')) return 'pdf'
    if (/\.(png|jpg|jpeg|gif|webp|bmp)(\?|#|$)/i.test(u)) return 'image'
    if (/\.(pdf)(\?|#|$)/i.test(u)) return 'pdf'
    return 'iframe'
  }
  const normalizeJoinMethod = (v) => {
    const s = normalizeText(v)
    if (!s) return ''
    const key = s.replace(/\s+/g, '')
    if (
      key === '-' ||
      key === '/' ||
      key === '无' ||
      key.includes('不选') ||
      key.includes('不选择') ||
      key.includes('不拼接') ||
      key.includes('无需') ||
      key.includes('不用')
    ) return ''
    if (key.includes('钉') || key.includes('订')) return '打钉'
    if (key.includes('粘') || key.includes('胶')) return '粘胶'
    return s
  }
  const toUntaxedPrice = (taxed) => {
    const n = Number(taxed)
    if (!Number.isFinite(n)) return undefined
    return round4(n / 1.13)
  }
  const toTaxedPrice = (untaxed) => {
    const n = Number(untaxed)
    if (!Number.isFinite(n)) return undefined
    return round4(n * 1.13)
  }
  const normalizeSupplierKey = (v) => String(v == null ? '' : v)
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[()（）【】[\]{}<>《》"“”'‘’·,，.。;；:：/\\\-_|]/g, '')
  const pickPrimaryNameFromDisplay = (v) => {
    const s = String(v == null ? '' : v).trim()
    if (!s) return ''
    const idx1 = s.indexOf('(')
    const idx2 = s.indexOf('（')
    const idx = idx1 >= 0 ? idx1 : idx2
    if (idx > 0) return s.slice(0, idx).trim()
    return s
  }
  const simplifySupplierKey = (v) => {
    let s = normalizeSupplierKey(v)
    if (!s) return ''
    const suffixes = [
      '有限责任公司',
      '有限公司',
      '纸业有限公司',
      '纸品有限公司',
      '包装有限公司',
      '印刷有限公司',
      '科技有限公司',
      '贸易有限公司',
      '实业有限公司',
      '纸业',
      '纸品',
      '包装',
      '印刷',
      '科技',
      '贸易',
      '实业',
      '公司'
    ]
    let changed = true
    while (changed) {
      changed = false
      for (const suf of suffixes) {
        if (s.endsWith(suf) && s.length > suf.length) {
          s = s.slice(0, -suf.length)
          changed = true
        }
      }
    }
    return s
  }

  const isDedupeTargetCustomer = useMemo(() => {
    const nm = normalizeText(customer?.companyName || customer?.name)
    return nm.includes('上海金田工具有限公司')
  }, [customer?.companyName, customer?.name])

  const formatMoneyLike = (v) => {
    const n = Number(v)
    if (!Number.isFinite(n)) return '-'
    return n.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })
  }

  const TaxModeToggle = ({ size = 'middle' } = {}) => (
    <Space.Compact>
      <Button
        size={size}
        type={priceTaxMode === 'taxed' ? 'primary' : 'default'}
        onClick={() => {
          if (priceTaxMode === 'taxed') return
          if (isSkuEditor) {
            const current = skuForm.getFieldValue('unitPrice')
            const next = toTaxedPrice(current)
            if (next !== undefined) {
              const raw = Number(skuForm.getFieldValue('rawMaterialCost'))
              const sheetCountNum = Number(skuForm.getFieldValue('sheetCount'))
              const sheetCount = Number.isFinite(sheetCountNum) && sheetCountNum > 0 ? sheetCountNum : 1
              const patch = { unitPrice: next }
              if (Number.isFinite(raw)) patch.profit = round4(Number(next) - raw * sheetCount)
              skuForm.setFieldsValue(patch)
            }
          }
          setPriceTaxMode('taxed')
        }}
      >
        含税价
      </Button>
      <Button
        size={size}
        type={priceTaxMode === 'untaxed' ? 'primary' : 'default'}
        onClick={() => {
          if (priceTaxMode === 'untaxed') return
          if (isSkuEditor) {
            const current = skuForm.getFieldValue('unitPrice')
            const next = toUntaxedPrice(current)
            if (next !== undefined) {
              const raw = Number(skuForm.getFieldValue('rawMaterialCost'))
              const sheetCountNum = Number(skuForm.getFieldValue('sheetCount'))
              const sheetCount = Number.isFinite(sheetCountNum) && sheetCountNum > 0 ? sheetCountNum : 1
              const patch = { unitPrice: next }
              if (Number.isFinite(raw)) patch.profit = round4(Number(next) - raw * sheetCount)
              skuForm.setFieldsValue(patch)
            }
          }
          setPriceTaxMode('untaxed')
        }}
      >
        未税价
      </Button>
    </Space.Compact>
  )

  const joinMethodOptions = useMemo(() => {
    const base = [
      { value: '打钉', label: '打钉' },
      { value: '粘胶', label: '粘胶' }
    ]
    const seen = new Set(base.map((x) => x.value))
    const current = normalizeJoinMethod(skuJoinMethod)
    if (current && !seen.has(current)) {
      base.push({ value: current, label: current })
    }
    return base
  }, [skuJoinMethod])
  const supplierOptions = useMemo(() => (suppliers || []).map((s) => {
    const value = String(s?.id ?? s?._id ?? '').trim()
    const label = String(s?.displayName ?? s?.name ?? '').trim()
    return { value, label }
  }).filter((x) => x.value && x.label), [suppliers])

  const supplierById = useMemo(() => {
    const map = new Map()
    ;(suppliers || []).forEach((s) => {
      const sid = String(s?.id ?? s?._id ?? '').trim()
      if (!sid) return
      map.set(sid, s)
    })
    return map
  }, [suppliers])

  const supplierMatchIndex = useMemo(() => {
    const supplierByKey = new Map()
    const supplierEntries = []
    ;(suppliers || []).forEach((doc) => {
      const id = String(doc?.id ?? doc?._id ?? '').trim()
      if (!id) return
      const name = normalizeText(doc?.name || doc?.companyName || doc?.title || '')
      const shortName = normalizeText(doc?.shortName || '')
      const display = normalizeText(doc?.displayName || (shortName && name ? `${shortName} (${name})` : (name || shortName)))
      const entry = { id, name, shortName, display }
      supplierEntries.push(entry)

      const addKey = (k) => {
        const key = normalizeSupplierKey(k)
        if (key && !supplierByKey.has(key)) supplierByKey.set(key, entry)
        const simpleKey = simplifySupplierKey(k)
        if (simpleKey && !supplierByKey.has(simpleKey)) supplierByKey.set(simpleKey, entry)
      }

      addKey(name)
      addKey(shortName)
      addKey(display)
      addKey(pickPrimaryNameFromDisplay(name))
      addKey(pickPrimaryNameFromDisplay(shortName))
      addKey(pickPrimaryNameFromDisplay(display))
    })
    return { supplierByKey, supplierEntries }
  }, [suppliers])

  const resolveSupplierFromName = useCallback((rawName) => {
    const raw = normalizeText(rawName)
    if (!raw) return null
    const key1 = normalizeSupplierKey(raw)
    const key2 = normalizeSupplierKey(pickPrimaryNameFromDisplay(raw))
    const key3 = simplifySupplierKey(raw)
    const key4 = simplifySupplierKey(pickPrimaryNameFromDisplay(raw))
    const direct = supplierMatchIndex.supplierByKey.get(key1)
      || supplierMatchIndex.supplierByKey.get(key2)
      || supplierMatchIndex.supplierByKey.get(key3)
      || supplierMatchIndex.supplierByKey.get(key4)
    if (direct) return direct

    const inputSimple = simplifySupplierKey(raw)
    if (!inputSimple || inputSimple.length < 2) return null
    let best = null
    let bestScore = Number.POSITIVE_INFINITY
    for (const s of supplierMatchIndex.supplierEntries || []) {
      const candidates = [
        simplifySupplierKey(s?.shortName),
        simplifySupplierKey(s?.name),
        simplifySupplierKey(s?.display)
      ].filter(Boolean)
      for (const c of candidates) {
        if (!c || c.length < 2) continue
        const hit = c.includes(inputSimple) || inputSimple.includes(c)
        if (!hit) continue
        const lenDiff = Math.abs(c.length - inputSimple.length)
        const starts = c.startsWith(inputSimple) || inputSimple.startsWith(c)
        const score = lenDiff + (starts ? 0 : 3)
        if (score < bestScore) {
          bestScore = score
          best = s
        }
      }
    }
    return best
  }, [supplierMatchIndex])

  const selectedSkuRows = useMemo(() => {
    const map = selectedSkuMap || {}
    return (selectedSkuKeys || []).map((k) => map[String(k)]).filter(Boolean)
  }, [selectedSkuKeys, selectedSkuMap])

  const supplierMaterialsForSelected = useMemo(() => {
    const sid = normalizeText(skuSupplierId)
    if (!sid) return []
    const list = supplierMaterialsBySupplier && supplierMaterialsBySupplier[sid] ? supplierMaterialsBySupplier[sid] : []
    return Array.isArray(list) ? list : []
  }, [skuSupplierId, supplierMaterialsBySupplier])

  const supplierMaterialsForBatch = useMemo(() => {
    const sid = normalizeText(batchSupplierId)
    if (!sid) return []
    const list = supplierMaterialsBySupplier && supplierMaterialsBySupplier[sid] ? supplierMaterialsBySupplier[sid] : []
    return Array.isArray(list) ? list : []
  }, [batchSupplierId, supplierMaterialsBySupplier])

  const supplierOutsourcedMaterialsForBatch = useMemo(() => {
    const sid = normalizeText(batchSupplierId)
    if (!sid) return []
    const list =
      supplierOutsourcedMaterialsBySupplier && supplierOutsourcedMaterialsBySupplier[sid]
        ? supplierOutsourcedMaterialsBySupplier[sid]
        : []
    return Array.isArray(list) ? list : []
  }, [batchSupplierId, supplierOutsourcedMaterialsBySupplier])

  const batchOutsourcedMaterialOptions = useMemo(() => {
    const out = []
    supplierOutsourcedMaterialsForBatch.forEach((r) => {
      const id = normalizeText(r?.id || r?._id)
      const name = normalizeText(r?.name)
      if (!id || !name) return
      const spec = normalizeText(r?.specification)
      const unit = normalizeText(r?.unit)
      const unitPrice = r?.unitPrice != null && r?.unitPrice !== '' ? Number(r.unitPrice) : NaN
      const tail = [
        spec ? `规格:${spec}` : '',
        unit ? `单位:${unit}` : '',
        Number.isFinite(unitPrice) ? `单价:${unitPrice}` : ''
      ].filter(Boolean).join('，')
      out.push({ value: id, label: tail ? `${name}（${tail}）` : name })
    })
    return out
  }, [supplierOutsourcedMaterialsForBatch])

  const batchOutsourcedMaterialSelected = useMemo(() => {
    const id = normalizeText(batchOutsourcedMaterialId)
    if (!id) return null
    const hit = supplierOutsourcedMaterialsForBatch.find((r) => normalizeText(r?.id || r?._id) === id)
    return hit || null
  }, [batchOutsourcedMaterialId, supplierOutsourcedMaterialsForBatch])

  const materialCodeOptions = useMemo(() => {
    const seen = new Set()
    const out = []
    supplierMaterialsForSelected.forEach((r) => {
      const code = normalizeText(r?.materialCode)
      if (!code || seen.has(code)) return
      seen.add(code)
      out.push({ value: code, label: code })
    })
    return out
  }, [supplierMaterialsForSelected])

  const batchMaterialCodeOptions = useMemo(() => {
    const seen = new Set()
    const out = []
    supplierMaterialsForBatch.forEach((r) => {
      const code = normalizeText(r?.materialCode)
      if (!code || seen.has(code)) return
      seen.add(code)
      out.push({ value: code, label: code })
    })
    return out
  }, [supplierMaterialsForBatch])

  const fluteOptions = useMemo(() => {
    const presets = ['AB楞', 'EB楞', 'A楞', 'B楞', 'E楞']
    const code = normalizeText(skuMaterialCode)
    if (code) {
      const hit = (supplierMaterialsForSelected || []).find((r) => normalizeText(r?.materialCode) === code)
      const list = normalizeFluteList(hit?.flutes ?? hit?.fluteOptions ?? hit?.flute_options ?? hit?.fluteList ?? hit?.flute_list ?? hit?.flute)
      if (list.length) return list.map((v) => ({ value: v, label: v }))
    }
    return presets.map((v) => ({ value: v, label: v }))
  }, [normalizeFluteList, skuMaterialCode, supplierMaterialsForSelected])

  const batchFluteOptions = useMemo(() => {
    const code = normalizeText(batchMaterialCode)
    if (!code) return []
    const hit = (supplierMaterialsForBatch || []).find((r) => normalizeText(r?.materialCode) === code)
    const list = normalizeFluteList(hit?.flutes ?? hit?.fluteOptions ?? hit?.flute_options ?? hit?.fluteList ?? hit?.flute_list ?? hit?.flute)
    if (list.length) return list.map((v) => ({ value: v, label: v }))
    return ['AB楞', 'EB楞', 'A楞', 'B楞', 'E楞'].map((v) => ({ value: v, label: v }))
  }, [batchMaterialCode, normalizeFluteList, supplierMaterialsForBatch])

  const batchMaterialPricePerSqm = useMemo(() => {
    const code = normalizeText(batchMaterialCode)
    if (!code) return undefined
    const hit = (supplierMaterialsForBatch || []).find((r) => normalizeText(r?.materialCode) === code)
    const price = Number(hit?.pricePerSqm ?? hit?.materialPricePerSqm)
    return Number.isFinite(price) ? price : undefined
  }, [batchFlute, batchMaterialCode, supplierMaterialsForBatch])

  const batchMaterialInfoText = useMemo(() => {
    const code = normalizeText(batchMaterialCode)
    if (!code) return ''
    const flute = normalizeText(batchFlute)
    const list = supplierMaterialsForBatch || []
    let hit = list.find((r) => {
      if (normalizeText(r?.materialCode) !== code) return false
      if (!flute) return true
      const flutes = normalizeFluteList(r?.flutes ?? r?.fluteOptions ?? r?.flute_options ?? r?.fluteList ?? r?.flute_list ?? r?.flute)
      return flutes.includes(flute)
    })
    if (!hit) hit = list.find((r) => normalizeText(r?.materialCode) === code)
    if (!hit) return code
    const grammageText = normalizeText(hit?.grammageText ?? hit?.grammageLabel ?? hit?.grammageDisplay ?? '')
    const grammageGRaw = hit?.grammageG ?? hit?.grammage ?? hit?.grammage_g
    const grammageG = Number(String(grammageGRaw == null ? '' : grammageGRaw).replace(/[^\d.]/g, ''))
    const grammage = grammageText || (Number.isFinite(grammageG) && grammageG > 0 ? `${grammageG}g` : '')
    const fluteText = buildFluteDisplay(hit?.flutes ?? hit?.flute)
    const suffix = `${grammage ? `:${grammage}` : ''}${fluteText ? ` ${fluteText}` : ''}`
    return `${code}${suffix}`
  }, [batchFlute, batchMaterialCode, buildFluteDisplay, normalizeFluteList, supplierMaterialsForBatch])

  const parseSpecParts = (raw) => {
    const s = normalizeText(raw).replace(/mm/gi, '')
    if (!s) return []
    return s
      .split(/[×xX*]/)
      .map((part) => normalizeText(part).replace(/[^\d.]/g, ''))
      .filter(Boolean)
      .slice(0, 3)
  }

  const safeDecode = (raw) => {
    const s = normalizeText(raw)
    if (!s) return ''
    try {
      return decodeURIComponent(s)
    } catch (_) {
      return s
    }
  }

  const normalizeIdSegment = (v) => {
    const s = normalizeText(v)
    if (!s) return ''
    const parts = s.split(/[\\/]/).filter(Boolean)
    return parts.length ? parts[parts.length - 1] : s
  }

  const extractErrorMessage = (err) => {
    const payload = err?.response?.data ?? err?.data ?? null
    const msg =
      payload?.message ??
      payload?.error ??
      err?.message ??
      err?.toString?.()
    const s = msg != null ? String(msg).trim() : ''
    return s
  }

  const customerId = useMemo(() => normalizeIdSegment(safeDecode(id)), [id])

  const skuAction = useMemo(() => {
    const params = new URLSearchParams(String(location?.search || ''))
    const v = String(params.get('sku') || '').trim().toLowerCase()
    return v === 'create' || v === 'edit' ? v : ''
  }, [location?.search])

  const skuIdInSearch = useMemo(() => {
    const params = new URLSearchParams(String(location?.search || ''))
    return String(params.get('skuId') || '').trim()
  }, [location?.search])

  const isSkuEditor = skuAction === 'create' || skuAction === 'edit'
  const isSkuEditMode = isSkuEditor && skuAction === 'edit'

  const updateSearch = useCallback((mutate, options = {}) => {
    const params = new URLSearchParams(String(location?.search || ''))
    mutate(params)
    const qs = params.toString()
    const nextUrl = qs ? `${location.pathname}?${qs}` : location.pathname
    navigate(nextUrl, options)
  }, [location?.pathname, location?.search, navigate])

  const exitSkuEditor = useCallback(() => {
    updateSearch((params) => {
      params.delete('sku')
      params.delete('skuId')
    }, { replace: true, state: null })
  }, [updateSearch])

  const openSkuCreate = useCallback(() => {
    updateSearch((params) => {
      params.set('sku', 'create')
      params.delete('skuId')
    }, { state: { sku: null } })
  }, [updateSearch])

  const openSkuEdit = useCallback((row) => {
    const sid = String(row?.id ?? row?._id ?? '').trim()
    if (!sid) return
    updateSearch((params) => {
      params.set('sku', 'edit')
      params.set('skuId', sid)
    }, { state: { sku: row } })
  }, [updateSearch])

  useEffect(() => {
    const loadCategories = async () => {
      try {
        const key = 'erp_productCategories'
        const cloud = await userConfigAPI.get(key)
        if (Array.isArray(cloud) && cloud.length) {
          const arr = cloud.map((x) => normalizeText(x)).filter(Boolean)
          if (arr.length) {
            setProductCategories(arr)
            return
          }
        }
        const raw = window.localStorage.getItem(key)
        if (raw) {
          const parsed = JSON.parse(raw)
          if (Array.isArray(parsed) && parsed.length) {
            const arr = parsed.map((x) => normalizeText(x)).filter(Boolean)
            if (arr.length) setProductCategories(arr)
          }
        }
      } catch (_) { void 0 }
    }
    loadCategories()
  }, [])

  const persistProductCategories = async (next) => {
    const key = 'erp_productCategories'
    window.localStorage.setItem(key, JSON.stringify(next))
    await userConfigAPI.set(key, next)
  }

  const addProductCategory = async (value) => {
    const val = normalizeText(value)
    if (!val) return
    const exists = (productCategories || []).some((x) => normalizeText(x) === val)
    if (exists) {
      skuForm.setFieldsValue({ category: val })
      return
    }
    const next = [...productCategories, val]
    setProductCategories(next)
    try {
      await persistProductCategories(next)
    } catch (_) { void 0 }
    skuForm.setFieldsValue({ category: val })
  }

  const loadCustomer = async () => {
    if (!customerId) {
      message.error('缺少客户ID')
      return
    }
    setLoading(true)
    try {
      const res = await cachedCustomerAPI.getCustomer(customerId)
      const found = extractCustomer(res)
      if (!found) {
        setCustomer(null)
        return
      }
      const cid = String(found?.id ?? found?._id ?? customerId)
      setCustomer({ ...found, id: cid, _id: cid })
    } catch (_) {
      message.error('加载客户信息失败')
      setCustomer(null)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { loadCustomer() }, [customerId])

  const extractSkus = (res) => {
    const payload = res?.data ?? res
    const data = payload?.data ?? payload?.data?.data ?? payload
    const list = data?.skus ?? payload?.skus ?? data?.list ?? payload?.list
    return Array.isArray(list) ? list : []
  }

  const extractPagination = (res) => {
    const payload = res?.data ?? res
    const data = payload?.data ?? payload?.data?.data ?? payload
    return data?.pagination ?? payload?.pagination ?? {}
  }

  const extractSkuFromMutationResponse = (res) => {
    const payload = res?.data ?? res
    const data = payload?.data ?? payload?.data?.data ?? payload
    const sku = data?.sku ?? payload?.sku ?? data?.data?.sku ?? payload?.data?.sku
    return sku && typeof sku === 'object' ? sku : null
  }

  const extractList = (res) => {
    const payload = res?.data ?? res
    const data = payload?.data ?? payload?.data?.data ?? payload
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.data)) return data.data
    if (Array.isArray(data?.suppliers)) return data.suppliers
    if (Array.isArray(payload?.data)) return payload.data
    return []
  }

  const normalizeSupplierRow = (row) => {
    const id = String(row?._id ?? row?.id ?? row?.key ?? '').trim()
    const name = normalizeText(row?.name || row?.companyName || row?.title || '')
    if (!id || !name) return null
    const shortName = normalizeText(row?.shortName || '')
    return {
      ...row,
      id,
      _id: id,
      name,
      shortName,
      displayName: shortName ? `${shortName} (${name})` : name
    }
  }

  const loadSuppliers = useCallback(async () => {
    if (suppliersLoading) return
    setSuppliersLoading(true)
    try {
      const all = []
      for (let page = 1; page <= 200; page += 1) {
        const res = await supplierAPI.getSuppliers({ page, limit: 200, withTotal: 0 })
        const list = extractList(res)
        if (!list.length) break
        all.push(...list)
        const payload = res?.data ?? res
        const data = payload?.data ?? payload?.data?.data ?? payload
        const totalPages = Number(data?.pagination?.totalPages ?? payload?.pagination?.totalPages ?? 0) || 0
        if (totalPages && page >= totalPages) break
        if (list.length < 200) break
      }
      const normalized = all
        .map(normalizeSupplierRow)
        .filter(Boolean)
        .sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), 'zh-CN'))
      setSuppliers(normalized)
    } catch (e) {
      const detail = extractErrorMessage(e)
      message.error(`加载供应商失败${detail ? `：${detail}` : ''}`)
      setSuppliers([])
    } finally {
      setSuppliersLoading(false)
    }
  }, [message, suppliersLoading])

  const loadSupplierMaterials = useCallback(async (supplierId) => {
    const sid = normalizeText(supplierId)
    if (!sid) return []
    if (supplierMaterialsBySupplier && supplierMaterialsBySupplier[sid]) return supplierMaterialsBySupplier[sid] || []
    if (supplierMaterialsLoading) return []
    setSupplierMaterialsLoading(true)
    try {
      const res = await supplierMaterialAPI.list({ supplierId: sid })
      const list = extractList(res)
        .map((r) => {
          const code = normalizeText(r?.materialCode ?? r?.code)
          if (!code) return null
          const flutes = normalizeFluteList(r?.flutes ?? r?.fluteOptions ?? r?.flute_options ?? r?.fluteList ?? r?.flute_list ?? r?.flute)
          const flute = flutes.length ? flutes[0] : normalizeText(r?.flute)
          const price = r?.pricePerSqm != null && r?.pricePerSqm !== '' ? Number(r.pricePerSqm) : NaN
          return {
            ...r,
            materialCode: code,
            flute: flute || '',
            flutes,
            pricePerSqm: Number.isFinite(price) ? price : null
          }
        })
        .filter(Boolean)
      setSupplierMaterialsBySupplier((prev) => ({ ...(prev || {}), [sid]: list }))
      return list
    } catch (e) {
      const detail = extractErrorMessage(e)
      message.error(`加载材质库失败${detail ? `：${detail}` : ''}`)
      setSupplierMaterialsBySupplier((prev) => ({ ...(prev || {}), [sid]: [] }))
      return []
    } finally {
      setSupplierMaterialsLoading(false)
    }
  }, [message, normalizeFluteList, supplierMaterialsBySupplier, supplierMaterialsLoading])

  const loadSupplierOutsourcedMaterials = useCallback(async (supplierId) => {
    const sid = normalizeText(supplierId)
    if (!sid) return []
    if (supplierOutsourcedMaterialsBySupplier && supplierOutsourcedMaterialsBySupplier[sid]) {
      return supplierOutsourcedMaterialsBySupplier[sid] || []
    }
    if (supplierOutsourcedMaterialsLoading) return []
    setSupplierOutsourcedMaterialsLoading(true)
    try {
      const res = await supplierOutsourcedMaterialAPI.list({ supplierId: sid })
      const list = extractList(res)
        .map((r) => {
          const id = normalizeText(r?.id || r?._id)
          const name = normalizeText(r?.name)
          if (!id || !name) return null
          const unit = normalizeText(r?.unit)
          const unitPrice = r?.unitPrice != null && r?.unitPrice !== '' ? Number(r.unitPrice) : NaN
          return {
            ...r,
            id,
            _id: id,
            name,
            unit,
            unitPrice: Number.isFinite(unitPrice) ? unitPrice : null
          }
        })
        .filter(Boolean)
      setSupplierOutsourcedMaterialsBySupplier((prev) => ({ ...(prev || {}), [sid]: list }))
      return list
    } catch (e) {
      const detail = extractErrorMessage(e)
      message.error(`加载外购材料失败${detail ? `：${detail}` : ''}`)
      setSupplierOutsourcedMaterialsBySupplier((prev) => ({ ...(prev || {}), [sid]: [] }))
      return []
    } finally {
      setSupplierOutsourcedMaterialsLoading(false)
    }
  }, [message, supplierOutsourcedMaterialsBySupplier, supplierOutsourcedMaterialsLoading])

  const loadSkus = async (options = {}) => {
    if (!customerId) return
    const pageToLoad = Number(options.page ?? skuPage) || 1
    const pageSizeToLoad = Number(options.pageSize ?? skuPageSize) || 10
    setSkuLoading(true)
    try {
      const refreshToken = options.forceRefresh ? Date.now() : undefined
      const resp = await cachedCustomerSkuAPI.getCustomerSkus({
        customerId,
        params: {
          page: pageToLoad,
          pageSize: pageSizeToLoad,
          ...(skuKeyword ? { keyword: skuKeyword } : {}),
          ...(refreshToken ? { _refresh: refreshToken } : {})
        }
      })
      let list = extractSkus(resp)
      let pagination = extractPagination(resp)
      console.debug('sku-list:primary', { customerId, page: pageToLoad, pageSize: pageSizeToLoad, total: Number(pagination?.total ?? 0) || 0, rows: Array.isArray(list) ? list.length : 0 })
      if ((!Array.isArray(list) || !list.length) && Number(pagination?.total || 0) === 0) {
        const aliases = [
          normalizeText(customer?.shortName),
          normalizeText(customer?.companyName),
          normalizeText(customer?.name)
        ].filter(Boolean)
        for (const alias of aliases) {
          const retry = await cachedCustomerSkuAPI.getCustomerSkus({
            customerId: alias,
            params: {
              page: pageToLoad,
              pageSize: pageSizeToLoad,
              ...(skuKeyword ? { keyword: skuKeyword } : {}),
              ...(refreshToken ? { _refresh: refreshToken } : {})
            }
          })
          const tryList = extractSkus(retry)
          const tryPagination = extractPagination(retry)
          console.debug('sku-list:fallback', { alias, page: pageToLoad, pageSize: pageSizeToLoad, total: Number(tryPagination?.total ?? 0) || 0, rows: Array.isArray(tryList) ? tryList.length : 0 })
          if (Array.isArray(tryList) && tryList.length) {
            list = tryList
            pagination = tryPagination
            break
          }
          if (Number(tryPagination?.total || 0) > 0) {
            list = tryList
            pagination = tryPagination
            break
          }
        }
      }
      const nextRows = list.map((r, idx) => {
        const id = String(r?.id ?? r?._id ?? '').trim()
        const key = String(r?.id ?? r?._id ?? `sku_${idx}`)
        const joinMethod = normalizeJoinMethod(r?.joinMethod ?? r?.join_method ?? '')
        return {
          ...r,
          id,
          key,
          joinMethod,
          join_method: joinMethod
        }
      })
      setSkuRows(nextRows)
      setSkuTotal(Number(pagination?.total ?? 0) || 0)
      const supplierIdsToPrefetch = Array.from(new Set(
        (nextRows || [])
          .filter((r) => normalizeText(r?.productionMode) !== 'outsourced')
          .map((r) => normalizeText(r?.supplierId))
          .filter(Boolean)
      ))
      if (supplierIdsToPrefetch.length) {
        void Promise.allSettled(supplierIdsToPrefetch.map((sid) => loadSupplierMaterials(sid)))
      }
      setSelectedSkuMap((prev) => {
        const base = prev || {}
        const keys = Object.keys(base)
        if (!keys.length) return base
        const next = { ...base }
        nextRows.forEach((r) => {
          const k = String(r?.key ?? r?.id ?? r?._id ?? '').trim()
          if (k && next[k]) next[k] = { ...next[k], ...r }
        })
        return next
      })
    } catch (e) {
      const detail = extractErrorMessage(e)
      message.error(`加载客户SKU失败${detail ? `：${detail}` : ''}`)
      console.error('sku-list:error', { customerId, page: pageToLoad, pageSize: pageSizeToLoad, error: detail || String(e?.message || e || '') })
      setSkuRows([])
      setSkuTotal(0)
    } finally {
      setSkuLoading(false)
    }
  }

  useEffect(() => { loadSkus() }, [customerId, skuPage, skuPageSize, skuKeyword])

  useEffect(() => {
    const prevCustomerId = String(prevCustomerIdRef.current || '').trim()
    prevCustomerIdRef.current = customerId
    if (!prevCustomerId) return
    if (prevCustomerId === customerId) return
    setSelectedSkuKeys([])
    setSelectedSkuMap({})
    setEditingSku(null)
    skuForm.resetFields()
    if (isSkuEditor) exitSkuEditor()
  }, [customerId, exitSkuEditor, isSkuEditor, skuForm])

  useEffect(() => {
    if (!customerId) return
    if (suppliersLoading) return
    if (suppliers && suppliers.length) return
    loadSuppliers()
  }, [customerId, loadSuppliers, suppliers, suppliersLoading])

  useEffect(() => {
    if (!isSkuEditor) return
    loadSuppliers()
  }, [isSkuEditor, loadSuppliers])

  useEffect(() => {
    if (!isSkuEditor) return
    const sid = normalizeText(skuSupplierId)
    const prev = normalizeText(prevSupplierIdRef.current)
    const prevValid = prev && supplierById.has(prev)
    const nextValid = sid && supplierById.has(sid)
    if (prevValid && nextValid && prev !== sid) {
      skuForm.setFieldsValue({
        materialCode: '',
        flute: undefined,
        materialPricePerSqm: undefined
      })
    }
    prevSupplierIdRef.current = sid

    if (!sid) {
      skuForm.setFieldsValue({ supplierName: '' })
      return
    }
    const found = (suppliers || []).find((s) => String(s.id || s._id || '') === sid)
    if (found) {
      skuForm.setFieldsValue({ supplierName: found.name || found.displayName || '' })
    }
    loadSupplierMaterials(sid)
  }, [isSkuEditor, loadSupplierMaterials, skuForm, skuSupplierId, supplierById, suppliers])

  useEffect(() => {
    if (!isSkuEditor) return
    if (normalizeText(skuAction) !== 'edit') return
    if (!suppliers || !suppliers.length) return

    const currentSupplierId = normalizeText(skuForm.getFieldValue('supplierId'))
    const hasValidId = currentSupplierId && supplierById.has(currentSupplierId)
    if (hasValidId) return

    const currentSupplierName = normalizeText(skuForm.getFieldValue('supplierName'))
    const raw = currentSupplierName || currentSupplierId
    if (!raw) return

    const found = resolveSupplierFromName(raw)
    if (!found?.id) return

    skuForm.setFieldsValue({
      supplierId: String(found.id),
      supplierName: normalizeText(found.name) || raw
    })
  }, [isSkuEditor, resolveSupplierFromName, skuAction, skuForm, supplierById, suppliers])

  useEffect(() => {
    if (!isSkuEditor) return
    const mode = normalizeText(skuProductionMode) === 'outsourced' ? 'outsourced' : 'inhouse'
    if (mode !== 'inhouse') return

    const bw = Number(skuBoardWidth)
    const bh = Number(skuBoardHeight)
    const pricePerSqm = Number(skuMaterialPricePerSqm)
    const canCalc = Number.isFinite(bw) && Number.isFinite(bh) && Number.isFinite(pricePerSqm)

    const round4 = (n) => Math.round(n * 10000) / 10000
    const computeProfit = (unitPriceArg, rawMaterialCostArg, sheetCountArg) => {
      const unitPrice = Number(unitPriceArg)
      const rawMaterialCost = Number(rawMaterialCostArg)
      const sheetCountNum = Number(sheetCountArg)
      const sheetCount = Number.isFinite(sheetCountNum) && sheetCountNum > 0 ? sheetCountNum : 1
      if (Number.isFinite(unitPrice) && Number.isFinite(rawMaterialCost)) return round4(unitPrice - rawMaterialCost * sheetCount)
      return undefined
    }
    const sheetCount = skuForm.getFieldValue('sheetCount')

    if (!canCalc) {
      const current = skuForm.getFieldValue('rawMaterialCost')
      const currentNum = Number(current)
      if (Number.isFinite(currentNum)) {
        skuForm.setFieldsValue({
          rawMaterialCost: undefined,
          profit: computeProfit(skuUnitPrice, undefined, sheetCount)
        })
      } else {
        skuForm.setFieldsValue({ profit: computeProfit(skuUnitPrice, undefined, sheetCount) })
      }
      return
    }

    const sqm = ((bw + 20) * bh) / 1000000
    const nextCost = round4(sqm * pricePerSqm)
    const current = skuForm.getFieldValue('rawMaterialCost')
    const currentNum = Number(current)
    const shouldUpdate = !Number.isFinite(currentNum) || Math.abs(currentNum - nextCost) > 1e-6
    if (shouldUpdate) {
      skuForm.setFieldsValue({
        rawMaterialCost: nextCost,
        profit: computeProfit(skuUnitPrice, nextCost, sheetCount)
      })
    } else {
      skuForm.setFieldsValue({ profit: computeProfit(skuUnitPrice, currentNum, sheetCount) })
    }
  }, [isSkuEditor, skuBoardHeight, skuBoardWidth, skuForm, skuMaterialPricePerSqm, skuProductionMode, skuUnitPrice])

  useEffect(() => {
    if (!isSkuEditor) return
    const sid = normalizeText(skuSupplierId)
    const code = normalizeText(skuMaterialCode)
    if (!sid || !code) return
    const list = supplierMaterialsBySupplier && supplierMaterialsBySupplier[sid] ? supplierMaterialsBySupplier[sid] : []
    const hit = (list || []).find((r) => normalizeText(r?.materialCode) === code)
    if (!hit) return
    const patch = {}
    const currentFlute = normalizeText(skuForm.getFieldValue('flute'))
    const flutes = normalizeFluteList(hit?.flutes ?? hit?.fluteOptions ?? hit?.flute_options ?? hit?.fluteList ?? hit?.flute_list ?? hit?.flute)
    if (flutes.length) {
      if (!currentFlute) {
        if (flutes.length === 1) patch.flute = flutes[0]
      } else if (!flutes.includes(currentFlute)) {
        patch.flute = undefined
      }
    }
    const currentPrice = skuForm.getFieldValue('materialPricePerSqm')
    if ((currentPrice === undefined || currentPrice === null || String(currentPrice).trim() === '') && hit.pricePerSqm != null) {
      patch.materialPricePerSqm = hit.pricePerSqm
    }
    if (Object.keys(patch).length) skuForm.setFieldsValue(patch)
  }, [isSkuEditor, normalizeFluteList, skuForm, skuMaterialCode, skuSupplierId, supplierMaterialsBySupplier])

  const handleSkuSearch = () => {
    setSkuKeyword(String(skuKeywordInput || '').trim())
    setSkuPage(1)
  }

  const handlePendingOrder = () => {
    if (!selectedSkuRows.length) {
      message.warning('请先勾选SKU')
      return
    }
    Modal.confirm({
      title: '确认进入创建订单？',
      content: `已选择 ${selectedSkuRows.length} 个SKU`,
      okText: '确认',
      cancelText: '取消',
      onOk: () => {
        const allOutsourced = (selectedSkuRows || []).length > 0 && (selectedSkuRows || []).every((s) => normalizeText(s?.productionMode) === 'outsourced')
        if (allOutsourced) {
          navigate('/purchase/goods/create', {
            state: {
              from: 'customer-skus',
              customer,
              customerId,
              skus: selectedSkuRows
            }
          })
          return
        }
        navigate(`/customers/${encodeURIComponent(customerId)}/orders/create`, {
          state: {
            customer,
            skus: selectedSkuRows
          }
        })
      }
    })
  }

  const openBatchSetMaterial = async () => {
    if (!selectedSkuKeys.length) {
      message.warning('请先勾选SKU')
      return
    }
    const map = selectedSkuMap || {}
    const pickedModes = (selectedSkuKeys || [])
      .map((k) => normalizeText(map[String(k)]?.productionMode))
      .filter(Boolean)
    const uniqueModes = Array.from(new Set(pickedModes))
    const initialType = uniqueModes.length === 1 && uniqueModes[0] === 'outsourced' ? 'outsourced' : 'inhouse'
    const pickedSupplierIds = (selectedSkuKeys || [])
      .map((k) => normalizeText(map[String(k)]?.supplierId))
      .filter(Boolean)
    const uniqueSupplierIds = Array.from(new Set(pickedSupplierIds))
    const initialSupplierId = uniqueSupplierIds.length === 1 ? uniqueSupplierIds[0] : ''
    setBatchMaterialType(initialType)
    setBatchSupplierId(initialSupplierId)
    setBatchMaterialCode('')
    setBatchFlute('')
    setBatchOutsourcedMaterialId('')
    setBatchMaterialOpen(true)
    if (initialSupplierId) {
      if (initialType === 'outsourced') {
        await loadSupplierOutsourcedMaterials(initialSupplierId)
      } else {
        await loadSupplierMaterials(initialSupplierId)
      }
    }
  }

  const handleConfirmBatchSetMaterial = async () => {
    if (!customerId) return
    const skuIds = (selectedSkuKeys || []).map((k) => String(k)).filter(Boolean)
    if (!skuIds.length) {
      message.warning('请先勾选SKU')
      return
    }
    const map = selectedSkuMap || {}
    const invalidName = skuIds
      .map((id) => ({ id, row: map[String(id)] }))
      .filter(({ row }) => !normalizeText(row?.name || row?.goodsName || row?.productName))
    if (invalidName.length) {
      const examples = invalidName
        .slice(0, 5)
        .map(({ id, row }) => normalizeText(row?.materialNo) || normalizeText(row?.specification) || id)
        .filter(Boolean)
        .join('、')
      message.error(`有 ${invalidName.length} 条SKU缺少商品名称，无法批量设置材质，请先补全${examples ? `：${examples}` : ''}`)
      return
    }
    const supplierId = normalizeText(batchSupplierId)
    if (!supplierId) {
      message.warning('请选择供应商')
      return
    }

    setBatchMaterialSaving(true)
    try {
      let res
      if (batchMaterialType === 'outsourced') {
        const outsourcedId = normalizeText(batchOutsourcedMaterialId)
        if (!outsourcedId) {
          message.warning('请选择原材料名称')
          return
        }
        const unitPrice = Number(batchOutsourcedMaterialSelected?.unitPrice)
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          message.warning('所选原材料缺少单价，请先在外购材料库维护')
          return
        }
        res = await cachedCustomerSkuAPI.batchSetMaterial(customerId, {
          skuIds,
          supplierId,
          outsourcedMaterialId: outsourcedId
        })
      } else {
        const materialCode = normalizeText(batchMaterialCode)
        const flute = normalizeText(batchFlute)
        if (!materialCode) {
          message.warning('请选择材质编码')
          return
        }
        if (!flute) {
          message.warning('请选择楞别')
          return
        }
        if (!Number.isFinite(Number(batchMaterialPricePerSqm)) || Number(batchMaterialPricePerSqm) <= 0) {
          message.warning('所选材质缺少平方单价，请先在供应商材质库维护')
          return
        }
        res = await cachedCustomerSkuAPI.batchSetMaterial(customerId, {
          skuIds,
          supplierId,
          materialCode,
          flute,
          materialPricePerSqm: Number(batchMaterialPricePerSqm)
        })
      }
      const payload = res?.data ?? res
      const data = payload?.data ?? payload?.result?.data ?? payload
      const updatedCountRaw = data?.updatedCount ?? data?.okCount ?? data?.successCount
      const failedRaw = data?.failed ?? data?.failures ?? data?.errors
      const updatedCount = Number(updatedCountRaw)
      const failCount = Array.isArray(failedRaw) ? failedRaw.length : Number(data?.failedCount ?? 0)
      const okCount = Number.isFinite(updatedCount) && updatedCount >= 0 ? updatedCount : skuIds.length
      if (Number(failCount) > 0) {
        message.warning(`批量设置材质完成：成功 ${okCount} 条，失败 ${failCount} 条`)
      } else {
        message.success(`批量设置材质完成：成功 ${okCount} 条`)
      }
      setBatchMaterialOpen(false)
      setBatchMaterialType('inhouse')
      setBatchSupplierId('')
      setBatchMaterialCode('')
      setBatchFlute('')
      setBatchOutsourcedMaterialId('')
      await loadSkus({ page: skuPage, forceRefresh: true })
    } catch (e) {
      const detail = extractErrorMessage(e)
      message.error(`批量设置材质失败${detail ? `：${detail}` : ''}`)
    } finally {
      setBatchMaterialSaving(false)
    }
  }

  const openAdjustPrice = () => {
    if (!customerId) return
    setAdjustPriceRows([])
    setAdjustPriceOpen(true)
    const loadAll = async () => {
      setAdjustPriceLoading(true)
      try {
        const all = []
        const pageSize = 200
        const maxTotal = 5000
        for (let page = 1; page <= 200; page += 1) {
          const resp = await cachedCustomerSkuAPI.getCustomerSkus({
            customerId,
            params: {
              page,
              pageSize,
              ...(skuKeyword ? { keyword: skuKeyword } : {})
            }
          })
          const list = extractSkus(resp)
          if (!list.length) break
          all.push(...list)
          const pagination = extractPagination(resp)
          const totalPages = Number(pagination?.totalPages ?? 0) || 0
          if (totalPages && page >= totalPages) break
          if (list.length < pageSize) break
          if (all.length >= maxTotal) break
        }

        if (all.length >= maxTotal) {
          message.warning(`SKU数量较多，仅加载前 ${maxTotal} 条用于批量调价`)
        }

        const next = all.map((r) => {
          const id = String(r?.id ?? r?._id ?? r?.key ?? '').trim()
          const unitPrice = r?.unitPrice != null && r?.unitPrice !== '' ? Number(r.unitPrice) : undefined
          return {
            id,
            key: id || String(r?.key ?? ''),
            name: normalizeText(r?.name),
            materialNo: normalizeText(r?.materialNo),
            materialCode: normalizeText(r?.materialCode),
            flute: normalizeText(r?.flute),
            supplierId: normalizeText(r?.supplierId),
            supplierName: normalizeText(r?.supplierName),
            unitPrice: Number.isFinite(unitPrice) ? unitPrice : undefined,
            nextUnitPrice: Number.isFinite(unitPrice) ? unitPrice : undefined
          }
        }).filter((r) => r.id)

        setAdjustPriceRows(next)
      } catch (e) {
        const detail = extractErrorMessage(e)
        message.error(`加载SKU用于批量调价失败${detail ? `：${detail}` : ''}`)
        setAdjustPriceOpen(false)
        setAdjustPriceRows([])
      } finally {
        setAdjustPriceLoading(false)
      }
    }
    loadAll()
  }

  const handleConfirmAdjustPrice = async () => {
    if (!customerId) return
    const changed = (adjustPriceRows || []).filter((r) => {
      const a = Number(r?.unitPrice)
      const b = Number(r?.nextUnitPrice)
      if (!Number.isFinite(b) || b < 0) return false
      if (!Number.isFinite(a)) return true
      return Math.abs(a - b) > 1e-9
    })
    if (!changed.length) {
      message.info('没有需要保存的单价变动')
      setAdjustPriceOpen(false)
      return
    }
    setAdjustPriceSaving(true)
    try {
      const settled = await Promise.allSettled(
        changed.map((r) => cachedCustomerSkuAPI.updateCustomerSku(customerId, r.id, { unitPrice: r.nextUnitPrice }))
      )
      const ok = settled.filter((x) => x.status === 'fulfilled').length
      const fail = settled.length - ok
      if (fail) {
        message.warning(`单价调整完成：成功 ${ok} 条，失败 ${fail} 条`)
      } else {
        message.success(`单价调整完成：成功 ${ok} 条`)
      }
      setAdjustPriceOpen(false)
      setAdjustPriceRows([])
      loadSkus()
    } finally {
      setAdjustPriceSaving(false)
    }
  }

  const statusTag = useMemo(() => {
    const s = String(customer?.status || '').trim() || 'active'
    if (s === 'active') return <Tag color="green">活跃</Tag>
    if (s === 'inactive') return <Tag color="red">非活跃</Tag>
    return <Tag>{s}</Tag>
  }, [customer?.status])

  const pageTitle = useMemo(() => {
    const name = customer?.companyName || customer?.name
    if (isSkuEditor) {
      const base = skuAction === 'edit' ? '编辑SKU' : '添加SKU'
      return name ? `${base} - ${name}` : base
    }
    return name ? `客户SKU管理 - ${name}` : '客户SKU管理'
  }, [customer?.companyName, customer?.name, isSkuEditor, skuAction])

  const computeSkuRawMaterialCostFromRow = (row) => {
    const mode = normalizeText(row?.productionMode)
    if (mode === 'outsourced') return undefined
    const bw = Number(row?.boardWidth)
    const bh = Number(row?.boardHeight)
    const priceFromRow = Number(row?.materialPricePerSqm ?? row?.pricePerSqm ?? row?.materialPrice)
    const price = Number.isFinite(priceFromRow)
      ? priceFromRow
      : resolveSupplierMaterialPricePerSqm({
        supplierId: normalizeText(row?.supplierId),
        materialCode: normalizeText(row?.materialCode),
        flute: normalizeText(row?.flute),
        supplierMaterialsBySupplier
      })
    return computeInhouseRawMaterialCost({ boardWidth: bw, boardHeight: bh, pricePerSqm: price })
  }

  const skuColumns = ([
    {
      title: '产品类别',
      dataIndex: 'category',
      key: 'category',
      align: 'center',
      render: (v, r) => (
        <div style={{ textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-all' }}>
          {normalizeText(v) || '-'}
          {normalizeText(r?.productionMode) === 'outsourced' ? (
            <Tag color="orange" style={{ marginInlineStart: 4 }}>外采购</Tag>
          ) : null}
        </div>
      )
    },
    {
      title: '商品名称',
      dataIndex: 'name',
      key: 'name',
      align: 'center',
      render: (v, r) => {
        const name = normalizeText(v)
        const materialNo = normalizeText(r?.materialNo)
        if (!materialNo) {
          return (
            <div style={{ textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-all' }}>
              {name || '-'}
            </div>
          )
        }
        return (
          <div style={{ lineHeight: 1.25, textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-all' }}>
            <div>{name || '-'}</div>
            <div style={{ color: '#6b7280' }}>{materialNo}</div>
          </div>
        )
      }
    },
    {
      title: '规格尺寸',
      dataIndex: 'specification',
      key: 'specification',
      align: 'center',
      render: (v, r) => {
        const specTextRaw = normalizeText(v)
        const bw = Number(r?.boardWidth)
        const bh = Number(r?.boardHeight)
        const boardSizeText = (Number.isFinite(bw) && bw > 0 && Number.isFinite(bh) && bh > 0) ? `${bw}×${bh}mm` : ''
        const c1 = Number(r?.creasingSize1 ?? 0)
        const c2 = Number(r?.creasingSize2 ?? 0)
        const c3 = Number(r?.creasingSize3 ?? 0)
        const ct = normalizeText(r?.creasingType)
        const hasNums = Boolean(c1 || c2 || c3)
        const creaseText = hasNums ? `${c1}-${c2}-${c3}mm${ct ? ` (${ct})` : ''}` : (ct || '')
        return (
          <div style={{ textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-all', lineHeight: 1.25 }}>
            <div>{specTextRaw || '-'}</div>
            {boardSizeText ? <div style={{ color: '#6b7280' }}>纸板尺寸：{boardSizeText}</div> : null}
            {creaseText ? <div style={{ color: '#6b7280' }}>压线尺寸：{creaseText}</div> : null}
          </div>
        )
      }
    },
    {
      title: '材质编码',
      dataIndex: 'materialCode',
      key: 'materialCode',
      align: 'center',
      render: (v, r) => {
        const code = normalizeText(v)
        const flute = normalizeText(r?.flute)
        if (!flute) {
          return (
            <div style={{ textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-all' }}>
              {code || '-'}
            </div>
          )
        }
        return (
          <div style={{ lineHeight: 1.25, textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-all' }}>
            <div>{code || '-'}</div>
            <div style={{ color: '#6b7280' }}>{flute}</div>
          </div>
        )
      }
    },
    {
      title: '单价',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      align: 'center',
      render: (v) => {
        if (v === undefined || v === null || v === '') return '-'
        const n = Number(v)
        if (!Number.isFinite(n)) return String(v)
        const display = priceTaxMode === 'untaxed' ? toUntaxedPrice(n) : n
        const label = priceTaxMode === 'untaxed' ? '未税' : '含税'
        const color = priceTaxMode === 'untaxed' ? 'gold' : 'blue'
        return (
          <span>
            {formatMoneyLike(display)}
            <Tag color={color} style={{ marginInlineStart: 6 }}>{label}</Tag>
          </span>
        )
      }
    },
    {
      title: '单位',
      dataIndex: 'unit',
      key: 'unit',
      align: 'center',
      render: (v) => (
        <div style={{ textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-all' }}>
          {normalizeText(v) || '-'}
        </div>
      )
    },
    {
      title: '拼接方式',
      dataIndex: 'joinMethod',
      key: 'joinMethod',
      align: 'center',
      render: (v) => (
        <div style={{ textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-all' }}>
          {normalizeText(v) || '-'}
        </div>
      )
    },
    {
      title: '原材料成本',
      dataIndex: 'rawMaterialCost',
      key: 'rawMaterialCost',
      align: 'center',
      render: (v, r) => {
        const n = v === undefined || v === null || v === '' ? NaN : Number(v)
        const baseCost = Number.isFinite(n) ? n : computeSkuRawMaterialCostFromRow(r)
        const sheetCount = (Number(r?.sheetCount) || 0) > 0 ? Number(r?.sheetCount) : 1
        const finalCost = Number.isFinite(baseCost) ? baseCost * sheetCount : NaN
        if (!Number.isFinite(finalCost)) return '-'
        return finalCost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })
      }
    },
    {
      title: '利润',
      dataIndex: 'profit',
      key: 'profit',
      align: 'center',
      render: (v, r) => {
        const unitPrice = r?.unitPrice === undefined || r?.unitPrice === null || r?.unitPrice === '' ? NaN : Number(r.unitPrice)
        const rawFromRow = r?.rawMaterialCost === undefined || r?.rawMaterialCost === null || r?.rawMaterialCost === '' ? NaN : Number(r.rawMaterialCost)
        const rawMaterialCost = Number.isFinite(rawFromRow) ? rawFromRow : computeSkuRawMaterialCostFromRow(r)
        
        const sheetCount = (Number(r?.sheetCount) || 0) > 0 ? Number(r?.sheetCount) : 1
        const totalMaterialCost = Number.isFinite(rawMaterialCost) ? rawMaterialCost * sheetCount : NaN
        
        const computed = Number.isFinite(unitPrice) && Number.isFinite(totalMaterialCost) ? unitPrice - totalMaterialCost : NaN
        const finalProfit = computed
        if (!Number.isFinite(finalProfit)) return '-'
        const s = finalProfit.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 4 })
        const color = '#dc2626'
        return <span style={{ color }}>{s}</span>
      }
    },
    {
      title: '供应商',
      dataIndex: 'supplierName',
      key: 'supplierName',
      align: 'center',
      render: (_, r) => {
        const sid = normalizeText(r?.supplierId)
        const sup = sid ? supplierById.get(sid) : null
        const shortName = sup ? normalizeText(sup?.shortName) : ''
        return (
          <div style={{ textAlign: 'center', whiteSpace: 'normal', wordBreak: 'break-all' }}>
            {shortName || normalizeText(r?.supplierName) || '-'}
          </div>
        )
      }
    },
    {
      title: '操作',
      key: 'actions',
      align: 'center',
      render: (_, r) => (
        <Space size={4} direction="vertical">
          <Button
            size="small"
            style={{ width: 84, height: 24 }}
            onClick={() => {
              openSkuEdit(r)
            }}
          >
            编辑SKU
          </Button>
          <Popconfirm
            title="确认删除该SKU？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => handleDeleteSku(r)}
          >
            <Button danger size="small" style={{ width: 84, height: 24 }}>删除</Button>
          </Popconfirm>
        </Space>
      )
    }
  ])

  const refresh = async () => {
    await loadCustomer()
    await loadSkus()
  }

  const parseSkuRowsFromExcel = async (file) => {
    const data = await file.arrayBuffer()
    const wb = XLSX.read(data, { type: 'array' })
    const sheetNames = Array.isArray(wb?.SheetNames) ? wb.SheetNames : []
    const toNumber = (v) => {
      if (v === '' || v === undefined || v === null) return undefined
      if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
      const s = String(v).trim()
      if (!s) return undefined
      const normalized = s
        .replace(/，/g, ',')
        .replace(/,/g, '')
        .replace(/mm/ig, '')
        .trim()
      const n = Number(normalized)
      return Number.isFinite(n) ? n : undefined
    }

    const normalizeHeaderKey = (v) => String(v == null ? '' : v)
      .trim()
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[（]/g, '(')
      .replace(/[）]/g, ')')
      .replace(/[【】[\]{}<>《》"“”'‘’·,，.。;；:：/\\\-_|]/g, '')
    const parseTwoNumbers = (v) => {
      const s = normalizeText(v)
      if (!s) return []
      const cleaned = s
        .replace(/mm/ig, '')
        .replace(/[×xX*]/g, '×')
        .replace(/[，,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      const nums = cleaned.match(/-?\d+(\.\d+)?/g) || []
      return nums.map((n) => Number(n)).filter((n) => Number.isFinite(n)).slice(0, 2)
    }
    const parseThreeNumbers = (v) => {
      const s = normalizeText(v)
      if (!s) return []
      const cleaned = s
        .replace(/mm/ig, '')
        .replace(/[×xX*]/g, '×')
        .replace(/[，,]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      const nums = cleaned.match(/-?\d+(\.\d+)?/g) || []
      return nums.map((n) => Number(n)).filter((n) => Number.isFinite(n)).slice(0, 3)
    }

    const parseSheet = (sheetName) => {
      const sheet = sheetName ? wb.Sheets[sheetName] : null
      if (!sheet) return []
      const aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) || []
      const rowsText = (aoa || []).map((r) => (Array.isArray(r) ? r.map((x) => normalizeText(x)) : []))
      const maxScan = Math.min(20, rowsText.length)
      const headerRowIndex = (() => {
        for (let i = 0; i < maxScan; i += 1) {
          const cells = rowsText[i] || []
          const hasName = cells.some((v) => v === '商品名称' || v === '商品名' || v === '产品名称')
          const hasCategory = cells.includes('产品类别') || cells.includes('类别')
          const hasCode = cells.includes('物料号') || cells.includes('SKU编码') || cells.includes('SKU编号') || cells.includes('sku')
          if (hasName && (hasCategory || hasCode)) return i
        }
        return -1
      })()
      if (headerRowIndex < 0) return []
      const subHeaderRowIndex = headerRowIndex + 1 < rowsText.length ? headerRowIndex + 1 : -1
      const headerRow = rowsText[headerRowIndex] || []
      const subRow = subHeaderRowIndex >= 0 ? (rowsText[subHeaderRowIndex] || []) : []
      const subLooksUseful = subRow.some((v) => ['长', '宽', '高', '宽(门幅)', '宽（门幅）', '长度', '压线1', '下单片数', '成型片数'].includes(v))
      const useSub = Boolean(subLooksUseful)
      const startRow = headerRowIndex + (useSub ? 2 : 1)
      const colCount = Math.max(headerRow.length, useSub ? subRow.length : 0, ...(aoa.slice(startRow, startRow + 10).map((r) => (Array.isArray(r) ? r.length : 0))))

      const colIndicesByKey = new Map()
      const addKey = (k, idx) => {
        const key = normalizeHeaderKey(k)
        if (!key) return
        const arr = colIndicesByKey.get(key) || []
        arr.push(idx)
        colIndicesByKey.set(key, arr)
      }
      for (let c = 0; c < colCount; c += 1) {
        const main = headerRow[c] || ''
        const sub = useSub ? (subRow[c] || '') : ''
        const merged = normalizeText([main, sub].filter(Boolean).join(''))
        addKey(merged, c)
        addKey(main, c)
        addKey(sub, c)
      }

      const pickCell = (rowArr, headerAliases, occurrence = 0) => {
        const aliases = Array.isArray(headerAliases) ? headerAliases : []
        for (const a of aliases) {
          const aliasKey = normalizeHeaderKey(a)
          if (!aliasKey) continue
          const exactIdxs = colIndicesByKey.get(aliasKey)
          if (exactIdxs && exactIdxs.length > occurrence) return rowArr[exactIdxs[occurrence]]

          const fuzzy = []
          for (const [k, idxs] of colIndicesByKey.entries()) {
            if (k && k.includes(aliasKey)) fuzzy.push(...idxs)
          }
          const uniqSorted = Array.from(new Set(fuzzy)).sort((x, y) => x - y)
          if (uniqSorted.length > occurrence) return rowArr[uniqSorted[occurrence]]
        }
        return ''
      }

      const out = []
      for (let rIndex = startRow; rIndex < aoa.length; rIndex += 1) {
        const rowArr = Array.isArray(aoa[rIndex]) ? aoa[rIndex] : []
        const isBlank = rowArr.every((x) => !normalizeText(x))
        if (isBlank) continue

        const category = normalizeText(pickCell(rowArr, ['产品类别', '类别', '分类']))
        const name = normalizeText(pickCell(rowArr, ['商品名称', '商品名', '品名', '产品名称', '产品名']))
        if (!name) continue
        const materialNo = normalizeText(pickCell(rowArr, ['物料号', '物料编号', '物料编码', 'SKU编码', 'SKU编号', 'SKU', '编码']))

        const dimL = normalizeText(pickCell(rowArr, ['规格尺寸长', '规格长', '长', '规格1', '规格(1)', '规格一']))
        const dimW = normalizeText(pickCell(rowArr, ['规格尺寸宽', '规格宽', '宽', '规格2', '规格(2)', '规格二']))
        const dimH = normalizeText(pickCell(rowArr, ['规格尺寸高', '规格高', '高', '规格3', '规格(3)', '规格三']))
        const specDirect = normalizeText(pickCell(rowArr, [
          '规格尺寸',
          '规格',
          '规格尺寸(mm)',
          '规格尺寸（mm）',
          '规格(mm)',
          '规格（mm）'
        ]))
        const specParts = [dimL, dimW, dimH].filter(Boolean)
        const specification = specParts.length >= 2 ? specParts.join('×') : specDirect

        const materialCode = normalizeText(pickCell(rowArr, ['材质编码', '材质', '材质代码']))
        const flute = normalizeText(pickCell(rowArr, ['楞别', '楞型']))

        const sizeCombined = pickCell(rowArr, [
          '纸板尺寸(门幅mm×长度mm)',
          '纸板尺寸(门幅mmx长度mm)',
          '纸板尺寸(门幅mm*长度mm)',
          '纸板尺寸(门幅×长度)',
          '纸板尺寸(宽×长)',
          '纸板尺寸(宽mm×长mm)',
          '纸板尺寸(宽mmx长mm)',
          '纸板尺寸（mm）',
          '纸板尺寸'
        ])
        const sizeNums = parseTwoNumbers(sizeCombined)
        const widthDirect = toNumber(pickCell(rowArr, ['宽（门幅）', '宽(门幅)', '门幅mm', '门幅(mm)', '门幅', '幅宽', '纸板尺寸宽（门幅）', '纸板尺寸宽(门幅)']))
        const heightDirect = toNumber(pickCell(rowArr, ['长度', '长度mm', '长度(mm)', '纸板尺寸长度']))
        let boardWidth = widthDirect
        let boardHeight = heightDirect
        if (sizeNums.length >= 2) {
          const a = toNumber(sizeNums[0])
          const b = toNumber(sizeNums[1])
          if (a !== undefined && b !== undefined) {
            if (boardWidth === undefined && boardHeight === undefined) {
              boardWidth = a
              boardHeight = b
            } else if (boardWidth !== undefined && boardHeight === undefined) {
              const pickA = Math.abs(a - boardWidth) <= Math.abs(b - boardWidth)
              boardHeight = pickA ? b : a
            } else if (boardHeight !== undefined && boardWidth === undefined) {
              const pickA = Math.abs(a - boardHeight) <= Math.abs(b - boardHeight)
              boardWidth = pickA ? b : a
            }
          }
        }

        const creaseCombined = pickCell(rowArr, ['压线尺寸(mm)(1-2-3)', '压线尺寸（mm）(1-2-3)', '压线尺寸(1-2-3)', '压线尺寸'])
        const creaseNums = parseThreeNumbers(creaseCombined)
        const creaseAlias = ['压线1', '压线尺寸1', '压线尺寸(1)', '压线尺寸压线1']
        const creasingSize1 = creaseNums.length >= 1 ? toNumber(creaseNums[0]) : toNumber(pickCell(rowArr, creaseAlias, 0))
        const creasingSize2 = creaseNums.length >= 2 ? toNumber(creaseNums[1]) : toNumber(pickCell(rowArr, ['压线2', '压线尺寸2', '压线尺寸(2)', ...creaseAlias], 1))
        const creasingSize3 = creaseNums.length >= 3 ? toNumber(creaseNums[2]) : toNumber(pickCell(rowArr, ['压线3', '压线尺寸3', '压线尺寸(3)', ...creaseAlias], 2))

        const creasingType = normalizeText(pickCell(rowArr, ['压线方式', '压线类型', '压线']))
        const sheetCount = toNumber(pickCell(rowArr, ['成型片数', '下单片数(片)', '下单片数', '下单数量', '数量']))
        const unit = normalizeText(pickCell(rowArr, ['单位', 'unit']))
        const supplierName = normalizeText(pickCell(rowArr, ['供应商', '供应商名称', '供应商简称', '供应商(简称)', '供应商（简称）']))
        const isTruthyMark = (v) => {
          const s = normalizeText(v).toLowerCase()
          if (!s) return false
          if (s === '0' || s === '否' || s === 'no' || s === 'n' || s === 'false' || s === '-' || s === '/') return false
          return true
        }
        let joinMethod = normalizeJoinMethod(pickCell(rowArr, ['拼接方式', '拼接']))
        if (!joinMethod) {
          const nailMark = pickCell(rowArr, ['打钉', '订钉', '钉'])
          const glueMark = pickCell(rowArr, ['粘胶', '粘', '胶'])
          const nailOk = isTruthyMark(nailMark)
          const glueOk = isTruthyMark(glueMark)
          joinMethod = nailOk && !glueOk ? '打钉' : (!nailOk && glueOk ? '粘胶' : '')
        }
        const unitPrice = toNumber(pickCell(rowArr, ['单价', '价格', '含税单价', '不含税单价']))

        out.push({
          __sheetName: sheetName,
          __rowNumber: rIndex + 1,
          category,
          name,
          materialNo,
          specification,
          materialCode,
          flute,
          boardWidth,
          boardHeight,
          creasingSize1,
          creasingSize2,
          creasingSize3,
          creasingType,
          sheetCount,
          unit,
          supplierName,
          joinMethod,
          unitPrice
        })
      }
      return out
    }

    const all = []
    for (const sheetName of sheetNames) {
      all.push(...parseSheet(sheetName))
    }
    return all
  }

  const handleImportSku = async (file) => {
    if (!customerId) return false
    setSkuImporting(true)
    try {
      const rows = await parseSkuRowsFromExcel(file)
      if (!rows.length) {
        message.error('未识别到可导入的SKU数据')
        return false
      }
      const resp = await cachedCustomerSkuAPI.importCustomerSkus(
        customerId,
        rows,
        skuImportReplaceMode ? { matchMode: 'auto' } : {}
      )
      const payload = resp?.data ?? resp
      const data = payload?.data ?? payload?.data?.data ?? payload
      const successCount = Number(data?.successCount ?? 0) || 0
      const failedCount = Number(data?.failedCount ?? 0) || 0
      const createdCount = Number(data?.createdCount ?? 0) || 0
      const replacedCount = Number(data?.replacedCount ?? 0) || 0
      const failedRows = Array.isArray(data?.failedRows) ? data.failedRows : []
      const breakdown = createdCount || replacedCount
        ? `（新增 ${createdCount} 条，替换 ${replacedCount} 条）`
        : ''
      const msgText = normalizeText(payload?.message)
      const summaryText = `成功 ${successCount} 条${breakdown}${failedCount ? `，失败 ${failedCount} 条` : ''}`
      if (msgText && msgText.includes('校验失败')) {
        message.error(`${msgText}：${summaryText}`)
      } else {
        message.success(`导入完成：${summaryText}`)
      }
      setSkuImportReport({
        successCount,
        createdCount,
        replacedCount,
        failedCount,
        failedRows
      })
      if (failedCount) setSkuImportReportOpen(true)
      setSkuPage(1)
      await loadSkus({ page: 1 })
    } catch (e) {
      const detail = extractErrorMessage(e)
      message.error(`导入SKU失败${detail ? `：${detail}` : ''}`)
    } finally {
      setSkuImporting(false)
    }
    return false
  }

  const handleBatchDeleteSkus = async () => {
    if (!customerId) {
      message.error('缺少客户ID')
      return
    }
    const ids = (selectedSkuKeys || []).map((k) => String(k || '').trim()).filter(Boolean)
    if (!ids.length) {
      message.info('请先勾选要删除的SKU')
      return
    }
    if (skuBatchDeleting) return

    const ok = await new Promise((resolve) => {
      Modal.confirm({
        title: '批量删除SKU',
        content: `确定删除已选择的 ${ids.length} 条SKU？删除后不可恢复。`,
        okText: '删除',
        okButtonProps: { danger: true },
        cancelText: '取消',
        onOk: () => resolve(true),
        onCancel: () => resolve(false)
      })
    })
    if (!ok) return

    setSkuBatchDeleting(true)
    const msgKey = 'sku_batch_delete'
    try {
      message.loading({ content: `正在删除SKU：0/${ids.length}`, key: msgKey, duration: 0 })
      const failed = []
      let done = 0
      const concurrency = 3
      for (let i = 0; i < ids.length; i += concurrency) {
        const chunk = ids.slice(i, i + concurrency)
        const results = await Promise.allSettled(
          chunk.map((sid) => cachedCustomerSkuAPI.deleteCustomerSku(customerId, sid))
        )
        results.forEach((r, idx) => {
          done += 1
          if (r.status === 'rejected') {
            failed.push({ skuId: chunk[idx], error: extractErrorMessage(r.reason) })
          }
        })
        message.loading({ content: `正在删除SKU：${done}/${ids.length}`, key: msgKey, duration: 0 })
      }

      const okCount = ids.length - failed.length
      if (failed.length) {
        message.warning({ content: `批量删除完成：成功 ${okCount} 条，失败 ${failed.length} 条`, key: msgKey, duration: 3 })
      } else {
        message.success({ content: `批量删除完成：已删除 ${okCount} 条`, key: msgKey, duration: 2 })
      }

      setSelectedSkuKeys([])
      setSelectedSkuMap({})
      setSkuPage(1)
      await loadSkus({ page: 1, forceRefresh: true })
    } catch (e) {
      const detail = extractErrorMessage(e)
      message.error({ content: `批量删除SKU失败${detail ? `：${detail}` : ''}`, key: msgKey })
    } finally {
      setSkuBatchDeleting(false)
    }
  }

  const handleGenerateQuote = async () => {
    if (!customerId) {
      message.error('缺少客户ID')
      return
    }
    if (skuQuoteGenerating) return
    setSkuQuoteGenerating(true)
    const msgKey = 'sku_quote'
    try {
      message.loading({ content: '正在拉取SKU并生成报价单…', key: msgKey, duration: 0 })
      const all = await fetchAllCustomerSkus()
      const list = (all || [])
        .map((r) => ({ ...r, id: String(r?.id ?? r?._id ?? '') }))
        .filter((r) => normalizeText(r?.name) || normalizeText(r?.materialNo))
        .sort((a, b) => {
          const ma = normalizeText(a?.materialNo)
          const mb = normalizeText(b?.materialNo)
          if (ma && mb && ma !== mb) return ma.localeCompare(mb, 'zh-CN')
          const na = normalizeText(a?.name)
          const nb = normalizeText(b?.name)
          if (na && nb && na !== nb) return na.localeCompare(nb, 'zh-CN')
          return String(a.id).localeCompare(String(b.id), 'zh-CN')
        })

      const customerName = normalizeText(customer?.companyName || customer?.name) || '客户'
      const normalizeFilename = (name) => String(name || '')
        .replace(/[\\/:*?"<>|]/g, '_')
        .replace(/\s+/g, ' ')
        .trim()
      const guessSpec = (spec) => {
        const s = normalizeText(spec)
        if (!s) return ''
        const lower = s.toLowerCase()
        if (lower.includes('mm')) return s
        return s
      }
      const quoteRows = list.map((r) => {
        const materialNo = normalizeText(r?.materialNo)
        const name = normalizeText(r?.name)
        const spec = guessSpec(r?.specification)
        const priceRaw = r?.unitPrice
        const priceNum = priceRaw === undefined || priceRaw === null || priceRaw === '' ? NaN : Number(priceRaw)
        const displayPrice = Number.isFinite(priceNum)
          ? (priceTaxMode === 'untaxed' ? toUntaxedPrice(priceNum) : priceNum)
          : ''
        return ['', materialNo, name, spec, displayPrice ?? '', '']
      })

      const electronAPI = typeof window !== 'undefined' ? window.electronAPI : null
      if (electronAPI && typeof electronAPI.generateQuoteXlsx === 'function') {
        const targetPath = 'd:\\ERP-cursor\\纸箱报价单.xlsx'
        const result = await electronAPI.generateQuoteXlsx({
          templatePath: targetPath,
          targetPath,
          customerName,
          rows: quoteRows
        })
        const savedPath = result && result.savedPath ? String(result.savedPath) : ''
        if (savedPath) {
          message.success({ content: `报价单已生成：${savedPath}`, key: msgKey, duration: 2 })
          if (typeof electronAPI.showItemInFolder === 'function') {
            await electronAPI.showItemInFolder(savedPath).catch(() => void 0)
          }
          return
        }
        message.info({ content: '已取消保存', key: msgKey, duration: 2 })
        return
      }

      const header = ['系列号', '料号', '名称', '规格', '价格', '备注']
      const ws = XLSX.utils.aoa_to_sheet([header, ...quoteRows])
      const wb = XLSX.utils.book_new()
      XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
      const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
      const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = normalizeFilename(`${customerName}报价单.xlsx`) || '报价单.xlsx'
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(url)
      message.success({ content: '报价单已生成并开始下载', key: msgKey, duration: 2 })
    } catch (e) {
      const detail = extractErrorMessage(e)
      message.error({ content: `生成报价单失败${detail ? `：${detail}` : ''}`, key: msgKey })
    } finally {
      setSkuQuoteGenerating(false)
    }
  }

  const handleDeleteSku = async (row) => {
    if (!customerId) {
      message.error('缺少客户ID')
      return
    }
    const skuId = String(row?.id ?? row?._id ?? '').trim()
    if (!skuId) {
      message.error('缺少SKU ID')
      return
    }
    setSkuLoading(true)
    try {
      await cachedCustomerSkuAPI.deleteCustomerSku(customerId, skuId)
      message.success('SKU已删除')
      setSelectedSkuKeys((prev) => (prev || []).filter((k) => String(k) !== skuId))
      setSelectedSkuMap((prev) => {
        const next = { ...(prev || {}) }
        delete next[skuId]
        return next
      })
      const nextPage = skuRows.length <= 1 && skuPage > 1 ? skuPage - 1 : skuPage
      if (nextPage !== skuPage) setSkuPage(nextPage)
      await loadSkus({ page: nextPage })
    } catch (e) {
      const detail = extractErrorMessage(e)
      message.error(`SKU删除失败${detail ? `：${detail}` : ''}`)
    } finally {
      setSkuLoading(false)
    }
  }

  const fetchAllCustomerSkus = async () => {
    if (!customerId) return []
    const all = []
    const pageSize = 200
    const refreshToken = Date.now()
    for (let page = 1; page <= 500; page += 1) {
      const resp = await cachedCustomerSkuAPI.getCustomerSkus({
        customerId,
        params: { page, pageSize, _refresh: refreshToken }
      })
      const list = extractSkus(resp)
      if (!list.length) break
      all.push(...list)
      const pagination = extractPagination(resp)
      const totalPages = Number(pagination?.totalPages ?? pagination?.pages ?? 0) || 0
      if (totalPages && page >= totalPages) break
      if (list.length < pageSize) break
    }
    return all
  }

  const analyzeDuplicateSkus = (rows) => {
    const normLower = (v) => normalizeText(v).toLowerCase()
    const getRowId = (r) => normalizeText(r?.id ?? r?._id)
    const buildKey = (r) => {
      const supplierId = normalizeText(r?.supplierId)
      const supplierKey = supplierId || simplifySupplierKey(r?.supplierName)
      return [
        normLower(r?.productionMode),
        normLower(r?.name),
        normLower(r?.specification),
        normLower(r?.materialNo),
        normLower(r?.unit),
        normLower(normalizeJoinMethod(r?.joinMethod)),
        normLower(supplierKey),
        normLower(r?.materialCode),
        normLower(r?.flute)
      ].join('\u0001')
    }

    const toTs = (v) => {
      const s = normalizeText(v)
      if (!s) return 0
      const t = Date.parse(s)
      return Number.isFinite(t) ? t : 0
    }
    const getTime = (r) => Math.max(
      toTs(r?.updatedAt),
      toTs(r?.updateTime),
      toTs(r?.updated_at),
      toTs(r?.createdAt),
      toTs(r?.createTime),
      toTs(r?.created_at)
    )
    const score = (r) => {
      const hasText = (v) => Boolean(normalizeText(v))
      const hasNum = (v) => {
        if (v === '' || v === undefined || v === null) return false
        const n = Number(v)
        return Number.isFinite(n)
      }
      let s = 0
      if (hasText(r?.materialCode)) s += 6
      if (hasText(r?.flute)) s += 3
      if (hasText(r?.supplierId)) s += 5
      if (hasText(r?.supplierName)) s += 2
      if (hasNum(r?.materialPricePerSqm ?? r?.pricePerSqm ?? r?.materialPrice)) s += 4
      if (hasNum(r?.unitPrice)) s += 4
      if (hasNum(r?.rawMaterialCost)) s += 3
      if (hasNum(r?.profit)) s += 2
      if (hasText(r?.joinMethod)) s += 1
      if (hasText(r?.category)) s += 1
      if (hasText(r?.unit)) s += 1
      if (hasNum(r?.boardWidth)) s += 1
      if (hasNum(r?.boardHeight)) s += 1
      if (hasText(r?.creasingType)) s += 1
      if (hasNum(r?.creasingSize1)) s += 1
      if (hasNum(r?.creasingSize2)) s += 1
      if (hasNum(r?.creasingSize3)) s += 1
      if (hasNum(r?.sheetCount)) s += 1
      return s
    }

    const groups = new Map()
    ;(rows || []).forEach((r) => {
      const id = getRowId(r)
      if (!id) return
      const key = buildKey(r)
      if (!key || key === '\u0001\u0001\u0001\u0001\u0001\u0001\u0001\u0001\u0001') return
      const arr = groups.get(key) || []
      arr.push({ ...r, id, _id: id })
      groups.set(key, arr)
    })

    const toDeleteIds = []
    let duplicateGroupCount = 0
    groups.forEach((arr) => {
      if (!arr || arr.length <= 1) return
      duplicateGroupCount += 1
      const sorted = [...arr].sort((a, b) => {
        const sa = score(a)
        const sb = score(b)
        if (sb !== sa) return sb - sa
        const ta = getTime(a)
        const tb = getTime(b)
        if (tb !== ta) return tb - ta
        return String(a.id).localeCompare(String(b.id), 'zh-CN')
      })
      sorted.slice(1).forEach((r) => {
        const sid = getRowId(r)
        if (sid) toDeleteIds.push(sid)
      })
    })

    return { toDeleteIds, duplicateGroupCount }
  }

  const handleDeleteDuplicateSkus = async () => {
    if (!customerId) {
      message.error('缺少客户ID')
      return
    }
    if (skuDedupeLoading) return
    setSkuDedupeLoading(true)
    const msgKey = 'sku_dedupe'
    try {
      const all = await fetchAllCustomerSkus()
      const { toDeleteIds, duplicateGroupCount } = analyzeDuplicateSkus(all)
      const deleteCount = toDeleteIds.length
      if (!deleteCount) {
        message.success('未发现重复SKU')
        return
      }

      const ok = await new Promise((resolve) => {
        Modal.confirm({
          title: '删除重复SKU',
          content: `检测到 ${duplicateGroupCount} 组重复SKU，将删除 ${deleteCount} 条并保留每组信息最完整的一条。`,
          okText: `删除 ${deleteCount} 条`,
          okButtonProps: { danger: true },
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false)
        })
      })
      if (!ok) return

      message.loading({ content: `正在删除重复SKU：0/${deleteCount}`, key: msgKey, duration: 0 })
      const failed = []
      let done = 0
      const concurrency = 3
      for (let i = 0; i < toDeleteIds.length; i += concurrency) {
        const chunk = toDeleteIds.slice(i, i + concurrency)
        const results = await Promise.allSettled(
          chunk.map((sid) => cachedCustomerSkuAPI.deleteCustomerSku(customerId, sid))
        )
        results.forEach((r, idx) => {
          done += 1
          if (r.status === 'rejected') {
            failed.push({ skuId: chunk[idx], error: extractErrorMessage(r.reason) })
          }
        })
        message.loading({ content: `正在删除重复SKU：${done}/${deleteCount}`, key: msgKey, duration: 0 })
      }

      const okCount = deleteCount - failed.length
      if (failed.length) {
        message.warning({ content: `重复SKU删除完成：成功 ${okCount} 条，失败 ${failed.length} 条`, key: msgKey, duration: 3 })
      } else {
        message.success({ content: `重复SKU删除完成：已删除 ${okCount} 条`, key: msgKey, duration: 2 })
      }
      setSkuPage(1)
      await loadSkus({ page: 1, forceRefresh: true })
    } catch (e) {
      const detail = extractErrorMessage(e)
      message.error({ content: `删除重复SKU失败${detail ? `：${detail}` : ''}`, key: msgKey })
    } finally {
      setSkuDedupeLoading(false)
    }
  }

  const handleSaveSku = async () => {
    if (!customerId) {
      message.error('缺少客户ID')
      return
    }
    setSkuSaving(true)
    try {
      const values = await skuForm.validateFields()
      const toNumber = (v) => {
        if (v === '' || v === undefined || v === null) return undefined
        const n = Number(v)
        return Number.isFinite(n) ? n : undefined
      }
      const toInt = (v) => {
        const n = toNumber(v)
        if (!Number.isFinite(n)) return undefined
        return roundIntHalfUp(n)
      }
      const productionModeRaw = normalizeText(values.productionMode) || 'inhouse'
      const productionMode = productionModeRaw === 'outsourced' ? 'outsourced' : 'inhouse'
      const normalizedSupplierId = normalizeText(skuForm.getFieldValue('supplierId') ?? values.supplierId)
      const supplierFromId = normalizedSupplierId ? supplierById.get(normalizedSupplierId) : null
      const resolvedSupplierName = normalizeText(skuForm.getFieldValue('supplierName') ?? values.supplierName)
        || normalizeText(supplierFromId?.name || '')
        || normalizeText(supplierFromId?.displayName || '')
      const sheetCountNum = toNumber(values.sheetCount)
      const sheetCount = Number.isFinite(Number(sheetCountNum)) && Number(sheetCountNum) > 0 ? Number(sheetCountNum) : 1
      const unitPriceInput = toNumber(values.unitPrice)
      const unitPriceTaxed = unitPriceInput === undefined
        ? undefined
        : (priceTaxMode === 'untaxed' ? toTaxedPrice(unitPriceInput) : unitPriceInput)
      const rawMaterialCostNum = toNumber(values.rawMaterialCost)
      const computedProfitTaxed = (unitPriceTaxed !== undefined && rawMaterialCostNum !== undefined)
        ? round4(Number(unitPriceTaxed) - Number(rawMaterialCostNum) * sheetCount)
        : undefined
      const joinMethodValue = normalizeJoinMethod(skuForm.getFieldValue('joinMethod') ?? values.joinMethod)
      const base = {
        productionMode,
        category: normalizeText(values.category),
        name: normalizeText(values.name),
        materialNo: normalizeText(values.materialNo),
        unit: normalizeText(values.unit),
        supplierId: normalizedSupplierId,
        supplierName: resolvedSupplierName,
        materialCode: normalizeText(values.materialCode),
        flute: normalizeText(values.flute),
        materialPricePerSqm: toNumber(values.materialPricePerSqm),
        unitPrice: unitPriceTaxed === undefined ? undefined : Number(unitPriceTaxed),
        rawMaterialCost: rawMaterialCostNum,
        profit: computedProfitTaxed ?? toNumber(values.profit),
        joinMethod: joinMethodValue,
        join_method: joinMethodValue,
        drawingUrl: normalizeText(values.drawingUrl),
        drawingName: normalizeText(values.drawingName),
        remark: normalizeText(values.remark),
        remark_text: normalizeText(values.remark)
      }

      const payload = productionMode === 'outsourced'
        ? {
          ...base,
          specification: normalizeText(values.specification)
        }
        : (() => {
          const specParts = [values.spec1, values.spec2, values.spec3]
            .map((v) => normalizeText(v))
            .filter(Boolean)
          const computedSpec = specParts.length ? specParts.join('×') : ''
          const specification = computedSpec || normalizeText(values.specification)
          return {
            ...base,
            specification,
            boardWidth: toNumber(values.boardWidth),
            boardHeight: toNumber(values.boardHeight),
            creasingType: normalizeText(values.creasingType),
            creasingSize1: toInt(values.creasingSize1),
            creasingSize2: toInt(values.creasingSize2),
            creasingSize3: toInt(values.creasingSize3),
            sheetCount: toNumber(values.sheetCount)
          }
        })()

      const expectedRemark = normalizeText(values.remark)
      const checkJoinMethodPersistence = async (res, { action, pageToReload, skuId, customerIdToCheck } = {}) => {
        const cid = String(customerIdToCheck || customerId || '').trim()
        const returnedSku = extractSkuFromMutationResponse(res)
        const returnedJoin = normalizeJoinMethod(returnedSku?.joinMethod ?? returnedSku?.join_method ?? '')
        const expectedJoin = normalizeJoinMethod(joinMethodValue)
        if (expectedJoin === returnedJoin) return true

        const targetId = String(skuId || returnedSku?.id || returnedSku?._id || '').trim()
        const nextPage = pageToReload ?? skuPage
        const refreshToken = Date.now()
        const resp = await cachedCustomerSkuAPI.getCustomerSkus({
          customerId: cid,
          params: {
            page: nextPage,
            pageSize: skuPageSize,
            ...(skuKeyword ? { keyword: skuKeyword } : {}),
            _refresh: refreshToken
          }
        })
        const list = extractSkus(resp)
        const row = targetId ? list.find((r) => String(r?.id ?? r?._id ?? '') === targetId) : null
        const actualJoin = normalizeJoinMethod(row?.joinMethod ?? row?.join_method ?? '')
        if (expectedJoin === actualJoin) {
          if (cid === customerId) {
            await loadSkus({ page: nextPage, forceRefresh: true })
          }
          return true
        }

        message.error(`${action || 'SKU更新'}失败：拼接方式未保存成功（期望：${expectedJoin || '-'}，实际：${actualJoin || returnedJoin || '-'}）`)
        return false
      }

      const checkRemarkPersistence = async (res, { action, skuId, customerIdToCheck } = {}) => {
        const cid = String(customerIdToCheck || customerId || '').trim()
        const returnedSku = extractSkuFromMutationResponse(res)
        const returnedRemark = normalizeText(returnedSku?.remark ?? returnedSku?.remark_text ?? returnedSku?.note ?? returnedSku?.memo ?? '')
        if (expectedRemark === returnedRemark) return true

        const targetId = String(skuId || returnedSku?.id || returnedSku?._id || '').trim()
        if (!targetId) return false

        let lastServerRemark = returnedRemark
        let lastMeta = null
        for (let i = 0; i < 8; i += 1) {
          try {
            const resp = await customerSkuAPI.getCustomerSku(cid, targetId)
            const payload = resp?.data ?? resp
            const data = payload?.data ?? payload?.data?.data ?? payload
            const sku = data?.sku ?? payload?.sku ?? data?.data?.sku ?? payload?.data?.sku
            const serverRemark = normalizeText(sku?.remark ?? sku?.remark_text ?? sku?.note ?? sku?.memo ?? '')
            lastServerRemark = serverRemark
            lastMeta = sku && typeof sku === 'object'
              ? { updatedAt: sku.updatedAt, _updateTime: sku._updateTime, _clientId: sku._clientId }
              : null
            if (expectedRemark === serverRemark) return true
          } catch (_) { void 0 }
          const wait = Math.min(250 * (i + 1), 2000)
          await new Promise((r) => setTimeout(r, wait))
        }

        const metaText = lastMeta
          ? `，实际：${lastServerRemark || '-'}，updatedAt=${normalizeText(lastMeta.updatedAt) || '-'}，_updateTime=${lastMeta._updateTime ?? '-'}，_clientId=${normalizeText(lastMeta._clientId) || '-'}`
          : (lastServerRemark ? `，实际：${lastServerRemark}` : '')
        message.error(`${action || 'SKU更新'}失败：备注未保存成功（期望：${expectedRemark || '-'}${metaText}）`)
        return false
      }

      if (editingSku?.id) {
        let finalCustomerId = customerId
        let updateRes = null
        try {
          updateRes = await cachedCustomerSkuAPI.updateCustomerSku(customerId, editingSku.id, payload)
        } catch (err) {
          const status = err?.response?.status
          const body = err?.response?.data ?? err?.data ?? null
          const actualCustomerId = String(body?.data?.actualCustomerId || '').trim()
          if (status === 409 && actualCustomerId && actualCustomerId !== customerId) {
            finalCustomerId = actualCustomerId
            updateRes = await cachedCustomerSkuAPI.updateCustomerSku(actualCustomerId, editingSku.id, payload)
          } else {
            throw err
          }
        }
        const ok = await checkJoinMethodPersistence(updateRes, { action: 'SKU更新', pageToReload: skuPage, skuId: editingSku.id, customerIdToCheck: finalCustomerId })
        if (!ok) return
        const okRemark = await checkRemarkPersistence(updateRes, { action: 'SKU更新', skuId: editingSku.id, customerIdToCheck: finalCustomerId })
        if (!okRemark) return
        message.success('SKU已更新')
        if (finalCustomerId !== customerId) {
          navigate(`/customers/${encodeURIComponent(finalCustomerId)}`, { replace: true })
          return
        }
      } else {
        const createRes = await cachedCustomerSkuAPI.createCustomerSku(customerId, payload)
        const ok = await checkJoinMethodPersistence(createRes, { action: 'SKU创建', pageToReload: 1, customerIdToCheck: customerId })
        if (!ok) return
        const okRemark = await checkRemarkPersistence(createRes, { action: 'SKU创建', customerIdToCheck: customerId })
        if (!okRemark) return
        message.success('SKU已创建')
        setSkuPage(1)
      }
      exitSkuEditor()
      setEditingSku(null)
      skuForm.resetFields()
      await loadSkus({ page: editingSku?.id ? skuPage : 1, forceRefresh: true })
    } catch (e) {
      if (e?.errorFields) return
      const detail = extractErrorMessage(e)
      const base = editingSku?.id ? 'SKU更新失败' : 'SKU创建失败'
      message.error(`${base}${detail ? `：${detail}` : ''}`)
    } finally {
      setSkuSaving(false)
    }
  }

  useEffect(() => {
    if (!isSkuEditor) return

    if (skuAction === 'create') {
      setEditingSku(null)
        setSkuDrawingFileList([])
      skuForm.setFieldsValue({
        productionMode: 'inhouse',
        category: '',
        supplierId: '',
        supplierName: '',
        materialNo: '',
        name: '',
        specification: '',
        spec1: undefined,
        spec2: undefined,
        spec3: undefined,
        materialCode: '',
        flute: undefined,
        materialPricePerSqm: undefined,
        boardWidth: undefined,
        boardHeight: undefined,
        creasingType: undefined,
        creasingSize1: undefined,
        creasingSize2: undefined,
        creasingSize3: undefined,
        sheetCount: 1,
        unit: undefined,
        joinMethod: undefined,
        drawingUrl: '',
        drawingName: '',
        remark: '',
        unitPrice: undefined,
        rawMaterialCost: undefined,
        profit: undefined
      })
      return
    }

    const fromState = location?.state?.sku
    const fallback = skuIdInSearch
      ? skuRows.find((r) => String(r?.id ?? r?._id ?? '') === String(skuIdInSearch))
      : null
    const row = fromState || fallback

    if (!row) {
      message.error('未找到SKU信息')
      exitSkuEditor()
      return
    }
    const rowCustomerId = normalizeText(row?.customerId)
    if (rowCustomerId && rowCustomerId !== customerId) {
      message.error('SKU不属于该客户')
      exitSkuEditor()
      return
    }

    const sid = String(row?.id ?? row?._id ?? '').trim()
    const specParsed = parseSpecParts(row?.specification)
    const unitPriceTaxed = row?.unitPrice != null && row?.unitPrice !== '' ? Number(row.unitPrice) : NaN
    const rawMaterialCost = row?.rawMaterialCost != null && row?.rawMaterialCost !== '' ? Number(row.rawMaterialCost) : NaN
    const profitFromRow = row?.profit != null && row?.profit !== '' ? Number(row.profit) : NaN
    const sheetCountNum = Number(row?.sheetCount)
    const sheetCount = Number.isFinite(sheetCountNum) && sheetCountNum > 0 ? sheetCountNum : 1
    const computedProfit = Number.isFinite(unitPriceTaxed) && Number.isFinite(rawMaterialCost) ? unitPriceTaxed - rawMaterialCost * sheetCount : NaN
    const finalProfit = Number.isFinite(profitFromRow) ? profitFromRow : (Number.isFinite(computedProfit) ? computedProfit : undefined)
    const cs1 = row?.creasingSize1 != null && row?.creasingSize1 !== '' ? Number(row.creasingSize1) : NaN
    const cs2 = row?.creasingSize2 != null && row?.creasingSize2 !== '' ? Number(row.creasingSize2) : NaN
    const cs3 = row?.creasingSize3 != null && row?.creasingSize3 !== '' ? Number(row.creasingSize3) : NaN
    const cs1Rounded = Number.isFinite(cs1) ? roundIntHalfUp(cs1) : NaN
    const cs2Rounded = Number.isFinite(cs2) ? roundIntHalfUp(cs2) : NaN
    const cs3Rounded = Number.isFinite(cs3) ? roundIntHalfUp(cs3) : NaN
    const bwFromCreases = (Number.isFinite(cs1Rounded) || Number.isFinite(cs2Rounded) || Number.isFinite(cs3Rounded))
      ? round4((Number.isFinite(cs1Rounded) ? cs1Rounded : 0) + (Number.isFinite(cs2Rounded) ? cs2Rounded : 0) + (Number.isFinite(cs3Rounded) ? cs3Rounded : 0))
      : undefined
    const bwFromRow = row?.boardWidth != null && row?.boardWidth !== '' ? Number(row.boardWidth) : NaN
    const boardWidthValueRaw = bwFromCreases !== undefined && (!Number.isFinite(bwFromRow) || Math.abs(bwFromRow - bwFromCreases) > 1e-9)
      ? bwFromCreases
      : (Number.isFinite(bwFromRow) ? bwFromRow : undefined)
    const boardWidthValue = boardWidthValueRaw === undefined ? undefined : roundIntHalfUp(boardWidthValueRaw)
    const bhFromRow = row?.boardHeight != null && row?.boardHeight !== '' ? Number(row.boardHeight) : NaN
    const boardHeightValue = Number.isFinite(bhFromRow) ? roundIntHalfUp(bhFromRow) : undefined
    setEditingSku({ ...row, id: sid, _id: sid })
    setSkuDrawingFileList(() => {
      const url = normalizeText(row?.drawingUrl || row?.drawing_url || '')
      if (!url) return []
      const name = normalizeText(row?.drawingName || row?.drawing_name || '') || '图纸'
      return [{ uid: 'drawing', name, status: 'done', url }]
    })
    skuForm.setFieldsValue({
      productionMode: normalizeText(row?.productionMode || '') || 'inhouse',
      category: normalizeText(row?.category || ''),
      supplierId: normalizeText(row?.supplierId || ''),
      supplierName: normalizeText(row?.supplierName || ''),
      materialNo: normalizeText(row?.materialNo || ''),
      name: normalizeText(row?.name || ''),
      specification: normalizeText(row?.specification || ''),
      spec1: specParsed[0],
      spec2: specParsed[1],
      spec3: specParsed[2],
      materialCode: normalizeText(row?.materialCode || ''),
      flute: normalizeText(row?.flute || ''),
      materialPricePerSqm: row?.materialPricePerSqm ?? row?.pricePerSqm ?? row?.materialPrice ?? undefined,
      boardWidth: boardWidthValue,
      boardHeight: boardHeightValue,
      creasingType: normalizeText(row?.creasingType || ''),
      creasingSize1: Number.isFinite(cs1Rounded) ? cs1Rounded : undefined,
      creasingSize2: Number.isFinite(cs2Rounded) ? cs2Rounded : undefined,
      creasingSize3: Number.isFinite(cs3Rounded) ? cs3Rounded : undefined,
      sheetCount: row?.sheetCount ?? undefined,
      unit: normalizeText(row?.unit || '') || undefined,
      joinMethod: normalizeJoinMethod(row?.joinMethod || row?.join_method || '') || undefined,
      drawingUrl: normalizeText(row?.drawingUrl || row?.drawing_url || ''),
      drawingName: normalizeText(row?.drawingName || row?.drawing_name || ''),
      remark: normalizeText(row?.remark || row?.remark_text || row?.note || row?.memo || ''),
      unitPrice: Number.isFinite(unitPriceTaxed) ? (priceTaxMode === 'untaxed' ? toUntaxedPrice(unitPriceTaxed) : unitPriceTaxed) : undefined,
      rawMaterialCost: Number.isFinite(rawMaterialCost) ? rawMaterialCost : undefined,
      profit: finalProfit
    })
  }, [exitSkuEditor, isSkuEditor, location?.state, message, skuAction, skuForm, skuIdInSearch, skuRows])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 className="page-title" style={{ margin: 0 }}>{pageTitle}</h2>
        <Space align="center">
          <Button icon={<ReloadOutlined />} onClick={refresh} loading={loading || skuLoading}>刷新</Button>
          <Button icon={<ArrowLeftOutlined />} onClick={() => (isSkuEditor ? exitSkuEditor() : safeNavigateBack(navigate, '/customers'))}>返回</Button>
        </Space>
      </div>

      <Card title="客户信息" style={{ marginBottom: 12 }} loading={loading}>
        <Descriptions
          size="small"
          column={3}
          labelStyle={{ color: '#000' }}
          contentStyle={{ color: '#000' }}
        >
          <Descriptions.Item label="客户名称">{customer?.companyName || customer?.name || '-'}</Descriptions.Item>
          <Descriptions.Item label="客户简称">{customer?.shortName || '-'}</Descriptions.Item>
          <Descriptions.Item label="状态">{statusTag}</Descriptions.Item>
          <Descriptions.Item label="结款方式">{customer?.paymentTerms || '-'}</Descriptions.Item>
          <Descriptions.Item label="联系人">{customer?.contactName || customer?.contact || '-'}</Descriptions.Item>
          <Descriptions.Item label="联系电话">{customer?.phone || '-'}</Descriptions.Item>
          <Descriptions.Item label="邮箱">{customer?.email || '-'}</Descriptions.Item>
          <Descriptions.Item label="地址">{customer?.address || '-'}</Descriptions.Item>
          <Descriptions.Item label="SKU产品数量">{Number(skuTotal || 0)}</Descriptions.Item>
        </Descriptions>
      </Card>

      {isSkuEditor ? (
        <Card>
          <Form
            form={skuForm}
            layout="vertical"
            onValuesChange={(changed, all) => {
              const round4 = (n) => Math.round(n * 10000) / 10000
              const mode = normalizeText(all?.productionMode) === 'outsourced' ? 'outsourced' : 'inhouse'
              const computeProfit = (unitPriceArg, rawMaterialCostArg, sheetCountArg) => {
                const unitPrice = Number(unitPriceArg)
                const rawMaterialCost = Number(rawMaterialCostArg)
                const sheetCountNum = Number(sheetCountArg)
                const sheetCount = Number.isFinite(sheetCountNum) && sheetCountNum > 0 ? sheetCountNum : 1
                if (Number.isFinite(unitPrice) && Number.isFinite(rawMaterialCost)) return round4(unitPrice - rawMaterialCost * sheetCount)
                return undefined
              }

              if (all.creasingType !== '无压线') {
                if (changed.boardWidth !== undefined || changed.creasingSize1 !== undefined || changed.creasingSize2 !== undefined) {
                  const w = Number(all.boardWidth)
                  const s1 = Number(all.creasingSize1)
                  const s2 = Number(all.creasingSize2)
                  if (Number.isFinite(w) && Number.isFinite(s1) && Number.isFinite(s2)) {
                    const nextS3 = roundIntHalfUp(w - s1 - s2)
                    const current = skuForm.getFieldValue('creasingSize3')
                    const currentNum = current === undefined || current === null || current === '' ? NaN : Number(current)
                    if (nextS3 !== undefined && (!Number.isFinite(currentNum) || currentNum !== nextS3)) {
                      skuForm.setFieldsValue({ creasingSize3: nextS3 })
                    }
                  }
                }
              }
              if (changed.spec1 || changed.spec2 || changed.spec3) {
                const a = all.spec1
                const b = all.spec2
                const c = all.spec3
                const parts = [a, b, c].map(v => (v === undefined || v === null) ? '' : String(v).trim()).filter(v => v !== '')
                const s = parts.length ? parts.join('×') : ''
                skuForm.setFieldsValue({ specification: s })
              }
              if (changed.creasingType) {
                const ct = all.creasingType
                if (ct === '无压线') {
                  skuForm.setFieldsValue({ creasingSize1: undefined, creasingSize2: undefined, creasingSize3: undefined })
                }
              }
              if (
                mode === 'inhouse' &&
                (changed.boardWidth !== undefined || changed.boardHeight !== undefined || changed.materialPricePerSqm !== undefined)
              ) {
                const bw = Number(all.boardWidth)
                const bh = Number(all.boardHeight)
                const pricePerSqm = Number(all.materialPricePerSqm)
                const canCalc = Number.isFinite(bw) && Number.isFinite(bh) && Number.isFinite(pricePerSqm)
                if (canCalc) {
                  const sqm = ((bw + 20) * bh) / 1000000
                  const nextCost = round4(sqm * pricePerSqm)
                  const current = skuForm.getFieldValue('rawMaterialCost')
                  const currentNum = Number(current)
                  const shouldUpdate = !Number.isFinite(currentNum) || Math.abs(currentNum - nextCost) > 1e-6
                  if (shouldUpdate) {
                    skuForm.setFieldsValue({
                      rawMaterialCost: nextCost,
                      profit: computeProfit(all.unitPrice, nextCost, all.sheetCount)
                    })
                  } else {
                    skuForm.setFieldsValue({ profit: computeProfit(all.unitPrice, currentNum, all.sheetCount) })
                  }
                } else {
                  skuForm.setFieldsValue({
                    rawMaterialCost: undefined,
                    profit: computeProfit(all.unitPrice, undefined, all.sheetCount)
                  })
                }
              }

              if (changed.unitPrice !== undefined || changed.rawMaterialCost !== undefined || changed.sheetCount !== undefined) {
                skuForm.setFieldsValue({ profit: computeProfit(all.unitPrice, all.rawMaterialCost, all.sheetCount) })
              }
            }}
          >
            <Card
              size="small"
              title={(
                <Space size={18} align="center">
                  <span>产品信息</span>
                  <Form.Item name="productionMode" noStyle>
                    <Select
                      style={{ width: 120 }}
                      options={[
                        { value: 'inhouse', label: '本厂生产' },
                        { value: 'outsourced', label: '外厂采购' }
                      ]}
                      value={skuProductionMode || 'inhouse'}
                      onChange={(v) => {
                        const next = v === 'outsourced' ? 'outsourced' : 'inhouse'
                        skuForm.setFieldsValue({ productionMode: next })
                        if (next === 'outsourced') {
                          skuForm.setFieldsValue({
                            spec1: undefined,
                            spec2: undefined,
                            spec3: undefined,
                            materialCode: '',
                            flute: undefined,
                            materialPricePerSqm: undefined,
                            boardWidth: undefined,
                            boardHeight: undefined,
                            creasingType: undefined,
                            creasingSize1: undefined,
                            creasingSize2: undefined,
                            creasingSize3: undefined,
                            sheetCount: undefined,
                            rawMaterialCost: undefined,
                            profit: undefined
                          })
                        } else {
                          const currentSheetCount = skuForm.getFieldValue('sheetCount')
                          const nextSheetCount = (Number(currentSheetCount) || 0) > 0 ? Number(currentSheetCount) : 1
                          skuForm.setFieldsValue({ sheetCount: nextSheetCount })
                        }
                      }}
                    />
                  </Form.Item>
                </Space>
              )}
              variant="borderless"
            >
              {skuProductionMode === 'outsourced' ? (
                <>
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Form.Item
                        label="产品类别"
                        required
                        style={{ width: 320 }}
                      >
                        <Space.Compact style={{ width: 320 }}>
                          <Form.Item name="category" noStyle rules={[{ required: true, message: '请选择产品类别' }]}>
                            <Select
                              placeholder="请选择产品类别"
                              style={{ width: 240 }}
                              options={(productCategories || []).map((x) => ({ value: x, label: x }))}
                              showSearch
                              optionFilterProp="label"
                              allowClear
                              dropdownRender={(menu) => (
                                <div>
                                  {menu}
                                  <div style={{ display: 'flex', gap: 8, padding: 8 }}>
                                    <Input
                                      placeholder="新增产品类别"
                                      value={newCategory}
                                      onChange={(e) => setNewCategory(e.target.value)}
                                    />
                                    <Button
                                      type="link"
                                      onClick={async () => {
                                        const val = normalizeText(newCategory)
                                        if (!val) return
                                        setNewCategory('')
                                        await addProductCategory(val)
                                      }}
                                    >
                                      新增
                                    </Button>
                                  </div>
                                </div>
                              )}
                            />
                          </Form.Item>
                          <Button onClick={() => { setCategoryModalValue(''); setCategoryModalOpen(true) }}>新增</Button>
                        </Space.Compact>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="specification" label="规格尺寸（选填）" style={{ width: 320 }}>
                        <Input placeholder="如 100×200×300" style={{ width: 320 }} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Form.Item name="name" label="商品名称" rules={[{ required: true, message: '请输入商品名称' }]} style={{ width: 320 }}>
                        <Input placeholder="请输入商品名称" style={{ width: 320 }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="unit" label="单位" rules={[{ required: true, message: '请选择单位' }]} style={{ width: 200 }}>
                        <Select
                          placeholder="请选择单位"
                          style={{ width: 200 }}
                          options={skuUnitOptions}
                          showSearch
                          optionFilterProp="label"
                          allowClear
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Form.Item name="materialNo" label="物料号" style={{ width: 360 }}>
                        <Input placeholder="请输入物料号" style={{ width: 360 }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="joinMethod" label="拼接方式" rules={[{ required: true, message: '请选择拼接方式' }]} style={{ width: 200 }}>
                        <Select
                          options={joinMethodOptions}
                          allowClear
                          style={{ width: 200 }}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              ) : (
                <>
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Form.Item
                        label="产品类别"
                        required
                        style={{ width: 320 }}
                      >
                        <Space.Compact style={{ width: 320 }}>
                          <Form.Item name="category" noStyle rules={[{ required: true, message: '请选择产品类别' }]}>
                            <Select
                              placeholder="请选择产品类别"
                              style={{ width: 240 }}
                              options={(productCategories || []).map((x) => ({ value: x, label: x }))}
                              showSearch
                              optionFilterProp="label"
                              allowClear
                              dropdownRender={(menu) => (
                                <div>
                                  {menu}
                                  <div style={{ display: 'flex', gap: 8, padding: 8 }}>
                                    <Input
                                      placeholder="新增产品类别"
                                      value={newCategory}
                                      onChange={(e) => setNewCategory(e.target.value)}
                                    />
                                    <Button
                                      type="link"
                                      onClick={async () => {
                                        const val = normalizeText(newCategory)
                                        if (!val) return
                                        setNewCategory('')
                                        await addProductCategory(val)
                                      }}
                                    >
                                      新增
                                    </Button>
                                  </div>
                                </div>
                              )}
                            />
                          </Form.Item>
                          <Button onClick={() => { setCategoryModalValue(''); setCategoryModalOpen(true) }}>新增</Button>
                        </Space.Compact>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="产品规格（mm）" required>
                        <Space>
                          <Form.Item name="spec1" noStyle rules={[{ required: true, message: '请输入规格' }]}>
                            <Input type="number" placeholder="mm" style={{ width: 120 }} />
                          </Form.Item>
                          ×
                          <Form.Item name="spec2" noStyle>
                            <Input type="number" placeholder="mm" style={{ width: 120 }} />
                          </Form.Item>
                          ×
                          <Form.Item name="spec3" noStyle>
                            <Input type="number" placeholder="mm" style={{ width: 120 }} />
                          </Form.Item>
                        </Space>
                      </Form.Item>
                      <Form.Item name="specification" hidden>
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Form.Item label="纸板尺寸（门幅mm×长度mm）" required>
                        <Space>
                          <Form.Item name="boardWidth" noStyle rules={[{ required: true, message: '请输入门幅' }]}>
                            <InputNumber min={0} step={1} precision={0} placeholder="门幅(mm)" style={{ width: 120 }} />
                          </Form.Item>
                          ×
                          <Form.Item name="boardHeight" noStyle rules={[{ required: true, message: '请输入长度' }]}>
                            <InputNumber min={0} step={1} precision={0} placeholder="长度(mm)" style={{ width: 120 }} />
                          </Form.Item>
                        </Space>
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item label="压线尺寸（mm）(1-2-3)" shouldUpdate>
                        {() => {
                          const isNoCrease = skuForm.getFieldValue('creasingType') === '无压线'
                          return (
                            <Space>
                              <Form.Item name="creasingSize1" noStyle>
                                <InputNumber min={0} step={1} precision={0} placeholder="尺寸1(mm)" style={{ width: 100 }} disabled={isNoCrease} />
                              </Form.Item>
                              -
                              <Form.Item name="creasingSize2" noStyle>
                                <InputNumber min={0} step={1} precision={0} placeholder="尺寸2(mm)" style={{ width: 100 }} disabled={isNoCrease} />
                              </Form.Item>
                              -
                              <Form.Item name="creasingSize3" noStyle>
                                <InputNumber min={0} step={1} precision={0} placeholder="尺寸3(mm)" style={{ width: 100 }} disabled={isNoCrease} />
                              </Form.Item>
                            </Space>
                          )
                        }}
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Form.Item name="flute" label="楞别" style={{ width: 200 }}>
                        <Select
                          placeholder="请选择楞别"
                          options={fluteOptions}
                          allowClear
                          showSearch
                          optionFilterProp="label"
                          style={{ width: 200 }}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="creasingType" label="压线方式" style={{ width: 200 }}>
                        <Select options={[{ value: '凹凸压线', label: '凹凸压线' }, { value: '平压线', label: '平压线' }, { value: '无压线', label: '无压线' }]} style={{ width: 200 }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="name" label="商品名称" rules={[{ required: true, message: '请输入商品名称' }]} style={{ width: 320 }}>
                        <Input placeholder="请输入商品名称" style={{ width: 320 }} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Form.Item name="sheetCount" label="成型片数" rules={[{ required: true, message: '请选择成型片数' }]} style={{ width: 200 }}>
                        <Select
                          style={{ width: 200 }}
                          options={[
                            { value: 1, label: '单拼' },
                            { value: 2, label: '双拼' },
                            { value: 4, label: '四拼' }
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="materialNo" label="物料号" style={{ width: 360 }}>
                        <Input placeholder="请输入物料号" style={{ width: 360 }} />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Form.Item name="unit" label="单位" style={{ width: 200 }}>
                        <Select
                          placeholder="请选择单位"
                          style={{ width: 200 }}
                          options={skuUnitOptions}
                          showSearch
                          optionFilterProp="label"
                          allowClear
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="joinMethod" label="拼接方式" rules={[{ required: true, message: '请选择拼接方式' }]} style={{ width: 200 }}>
                        <Select
                          options={joinMethodOptions}
                          allowClear
                          style={{ width: 200 }}
                        />
                      </Form.Item>
                    </Col>
                  </Row>
                </>
              )}
              <Card size="small" title="产品价格" style={{ marginTop: 8, marginBottom: 12 }}>
                <Row gutter={12}>
                  <Col xs={24} md={6}>
                    <Form.Item
                      name="unitPrice"
                      label={(
                        <Space size={8} align="center">
                          <span>单价</span>
                          <TaxModeToggle size="small" />
                        </Space>
                      )}
                      style={{ width: 260 }}
                    >
                      <InputNumber
                        min={0}
                        precision={4}
                        placeholder={priceTaxMode === 'untaxed' ? '未税价' : '含税价'}
                        style={{ width: 260 }}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={6}>
                    {skuProductionMode === 'outsourced' ? (
                      <Form.Item name="rawMaterialCost" label="原材料成本" style={{ width: 200 }}>
                        <InputNumber
                          min={0}
                          precision={4}
                          placeholder="请输入原材料成本"
                          style={{ width: 200 }}
                          styles={{ input: { fontSize: 18, fontWeight: 600, color: '#16a34a' } }}
                        />
                      </Form.Item>
                    ) : (
                      <>
                        <Form.Item name="rawMaterialCost" hidden>
                          <InputNumber />
                        </Form.Item>
                        <Form.Item label="原材料成本" style={{ width: 200 }} shouldUpdate>
                          {() => (
                            <Typography.Text style={{ fontSize: 18, fontWeight: 600, color: '#16a34a' }}>
                              {formatMoneyLike((() => {
                                const baseCost = Number(skuForm.getFieldValue('rawMaterialCost'))
                                const sheetCountNum = Number(skuForm.getFieldValue('sheetCount'))
                                const sheetCount = Number.isFinite(sheetCountNum) && sheetCountNum > 0 ? sheetCountNum : 1
                                return Number.isFinite(baseCost) ? baseCost * sheetCount : NaN
                              })())}
                            </Typography.Text>
                          )}
                        </Form.Item>
                      </>
                    )}
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item name="profit" hidden>
                      <InputNumber />
                    </Form.Item>
                    <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                      <Form.Item label="利润" style={{ width: 200, marginBottom: 0 }} shouldUpdate>
                        {() => (
                          <Typography.Text style={{ fontSize: 18, fontWeight: 600, color: '#dc2626' }}>
                            {formatMoneyLike(skuForm.getFieldValue('profit'))}
                          </Typography.Text>
                        )}
                      </Form.Item>
                      <Form.Item label="利润率" style={{ width: 160, marginBottom: 0 }} shouldUpdate>
                        {() => {
                          const profit = Number(skuForm.getFieldValue('profit'))
                          const unitPrice = Number(skuForm.getFieldValue('unitPrice'))
                          const ok = Number.isFinite(profit) && Number.isFinite(unitPrice) && unitPrice > 0
                          const rate = ok ? (profit / unitPrice) * 100 : NaN
                          return (
                            <Typography.Text style={{ fontSize: 18, fontWeight: 600, color: '#dc2626' }}>
                              {Number.isFinite(rate) ? `${rate.toFixed(2)}%` : '-'}
                            </Typography.Text>
                          )
                        }}
                      </Form.Item>
                    </div>
                  </Col>
                </Row>
              </Card>

              <Card size="small" title="材质信息" style={{ marginBottom: 12 }}>
                <Row gutter={12}>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="supplierId"
                      label="供应商名称"
                      rules={[]}
                      style={{ width: 320 }}
                    >
                      <Select
                        placeholder="请选择供应商"
                        options={supplierOptions}
                        showSearch
                        optionFilterProp="label"
                        allowClear
                        disabled
                        loading={suppliersLoading}
                        style={{ width: 320 }}
                      />
                    </Form.Item>
                    <Form.Item name="supplierName" hidden>
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="materialCode"
                      label="材质编码"
                      rules={[]}
                      style={{ width: 320 }}
                    >
                      <Select
                        placeholder={skuSupplierId ? '请选择材质编码' : '请先选择供应商'}
                        options={materialCodeOptions}
                        disabled
                        allowClear
                        loading={supplierMaterialsLoading}
                        showSearch
                        optionFilterProp="label"
                        style={{ width: 320 }}
                      />
                    </Form.Item>
                  </Col>
                </Row>
                <Row gutter={12}>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="materialPricePerSqm"
                      label="材质平方单价"
                      rules={[]}
                      style={{ width: 200 }}
                    >
                      <InputNumber
                        min={0}
                        precision={4}
                        placeholder="请输入单价"
                        disabled
                        style={{ width: 200 }}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>

              <Card size="small" title="图纸预览" style={{ marginBottom: 12 }}>
                <Form.Item name="remark" label="备注" rules={[]}>
                  <Input.TextArea placeholder="请输入备注" allowClear autoSize={{ minRows: 2, maxRows: 6 }} />
                </Form.Item>
                <Form.Item name="drawingUrl" hidden>
                  <Input />
                </Form.Item>
                <Form.Item name="drawingName" hidden>
                  <Input />
                </Form.Item>
                <Upload.Dragger
                  accept=".pdf,image/*"
                  maxCount={1}
                  showUploadList={false}
                  fileList={skuDrawingFileList}
                  beforeUpload={() => false}
                  onChange={(info) => {
                    const next = Array.isArray(info?.fileList) ? info.fileList.slice(-1) : []
                    const active = next[0]
                    if (!active) {
                      setSkuDrawingFileList([])
                      skuForm.setFieldsValue({ drawingUrl: '', drawingName: '' })
                      return
                    }
                    if (active?.status === 'removed') {
                      setSkuDrawingFileList([])
                      skuForm.setFieldsValue({ drawingUrl: '', drawingName: '' })
                      return
                    }
                    const raw = active?.originFileObj
                    if (!raw) {
                      setSkuDrawingFileList(next)
                      if (active?.url) {
                        skuForm.setFieldsValue({ drawingUrl: String(active.url), drawingName: String(active.name || '图纸') })
                      }
                      return
                    }
                    const maxBytes = 7 * 1024 * 1024
                    if (Number(raw.size || 0) > maxBytes) {
                      message.error('图纸文件过大，请压缩后再上传（建议≤7MB）')
                      setSkuDrawingFileList([])
                      skuForm.setFieldsValue({ drawingUrl: '', drawingName: '' })
                      return
                    }
                    setSkuDrawingFileList(next)
                    void (async () => {
                      try {
                        const url = await readFileAsDataUrl(raw)
                        skuForm.setFieldsValue({ drawingUrl: url, drawingName: String(raw.name || '图纸') })
                      } catch (e) {
                        setSkuDrawingFileList([])
                        skuForm.setFieldsValue({ drawingUrl: '', drawingName: '' })
                        message.error('读取图纸失败，请重试')
                      }
                    })()
                  }}
                  onRemove={() => {
                    setSkuDrawingFileList([])
                    skuForm.setFieldsValue({ drawingUrl: '', drawingName: '' })
                  }}
                  style={{ height: 160 }}
                >
                  <p className="ant-upload-drag-icon">📄</p>
                  <p className="ant-upload-text">点击或拖拽文件到此处上传（支持 PDF / 图片）</p>
                </Upload.Dragger>
                {skuDrawingUrl ? (
                  <div style={{ marginTop: 8 }}>
                    <Button
                      onClick={() => {
                        setSkuDrawingFileList([])
                        skuForm.setFieldsValue({ drawingUrl: '', drawingName: '' })
                      }}
                    >
                      清除图纸
                    </Button>
                  </div>
                ) : null}
                {skuDrawingUrl ? (
                  <div style={{ border: '1px solid #f0f0f0', borderRadius: 6, overflow: 'hidden', marginTop: 12 }}>
                    {getDrawingPreviewType(skuDrawingUrl) === 'image' ? (
                      <div style={{ padding: 12, display: 'flex', justifyContent: 'center' }}>
                        <img src={skuDrawingUrl} alt="图纸预览" style={{ maxWidth: '100%', maxHeight: 520, objectFit: 'contain' }} />
                      </div>
                    ) : (
                      <iframe
                        src={skuDrawingUrl}
                        title="图纸预览"
                        style={{ width: '100%', height: 520, border: 0 }}
                      />
                    )}
                  </div>
                ) : (
                  <Typography.Text type="secondary">上传图纸后自动预览</Typography.Text>
                )}
              </Card>
            </Card>
            <Space style={{ marginTop: 16 }}>
              <Button onClick={exitSkuEditor}>返回</Button>
              <Button type="primary" onClick={handleSaveSku} loading={skuSaving}>提交</Button>
            </Space>
          </Form>
        </Card>
      ) : (
        <Card
          title={(
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <div>产品SKU列表</div>
                  <Input
                    placeholder="搜索SKU"
                    value={skuKeywordInput}
                    onChange={(e) => setSkuKeywordInput(e.target.value)}
                    onPressEnter={handleSkuSearch}
                    allowClear
                    style={{ width: 220 }}
                  />
                  <Button icon={<SearchOutlined />} onClick={handleSkuSearch} loading={skuLoading}>搜索</Button>
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={openSkuCreate}
                  >
                    添加SKU
                  </Button>
                  <Upload
                    accept=".xlsx,.xls"
                    showUploadList={false}
                    beforeUpload={handleImportSku}
                    disabled={!customerId || skuImporting}
                  >
                    <Button icon={<UploadOutlined />} loading={skuImporting}>导入SKU</Button>
                  </Upload>
                  <Checkbox
                    checked={skuImportReplaceMode}
                    onChange={(e) => setSkuImportReplaceMode(Boolean(e?.target?.checked))}
                    disabled={skuImporting || !customerId}
                  >
                    匹配替换
                  </Checkbox>
                  {isDedupeTargetCustomer ? (
                    <Button danger onClick={handleDeleteDuplicateSkus} loading={skuDedupeLoading} disabled={!customerId}>
                      删除重复SKU
                    </Button>
                  ) : null}
                  <Button type="primary" onClick={openBatchSetMaterial}>批量设置材质</Button>
                  <Button danger onClick={handleBatchDeleteSkus} loading={skuBatchDeleting} disabled={!customerId}>
                    批量删除SKU
                  </Button>
                </div>

                <div style={{ flex: 1, display: 'flex', justifyContent: 'center', minWidth: 140 }}>
                  <TaxModeToggle size="middle" />
                </div>

                <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10, justifyContent: 'flex-end' }}>
                  <Button onClick={openAdjustPrice}>调整单价</Button>
                  <Button type="primary" onClick={handleGenerateQuote} loading={skuQuoteGenerating} disabled={!customerId}>
                    生成报价单
                  </Button>
                  <Badge count={selectedSkuKeys.length} size="small">
                    <Button type="primary" onClick={handlePendingOrder} disabled={!selectedSkuKeys.length}>待下订单</Button>
                  </Badge>
                </div>
              </div>
            </div>
          )}
        >
          <Table
            columns={skuColumns}
            dataSource={skuRows}
            loading={skuLoading}
            tableLayout="auto"
            rowSelection={{
              selectedRowKeys: selectedSkuKeys,
              preserveSelectedRowKeys: true,
              onChange: (keys, rows) => {
                const nextKeys = (keys || []).map((k) => String(k))
                setSelectedSkuKeys(nextKeys)
                setSelectedSkuMap((prev) => {
                  const next = { ...(prev || {}) }
                  const keep = new Set(nextKeys)
                  Object.keys(next).forEach((k) => {
                    if (!keep.has(String(k))) delete next[k]
                  })
                  ;(rows || []).forEach((r) => {
                    const k = String(r?.key ?? r?.id ?? r?._id ?? '').trim()
                    if (k) next[k] = r
                  })
                  return next
                })
              }
            }}
            locale={{
              emptyText: skuLoading ? '加载中…' : '暂无SKU，请点击右上角“添加SKU”'
            }}
            pagination={{
              current: skuPage,
              pageSize: skuPageSize,
              total: skuTotal,
              showSizeChanger: true,
              showQuickJumper: true,
              showTotal: (t) => `共 ${t} 条记录`,
              onChange: (p, ps) => { setSkuPage(p); setSkuPageSize(ps) }
            }}
          />
        </Card>
      )}

      <Modal
        title="SKU导入报告"
        open={skuImportReportOpen}
        onCancel={() => setSkuImportReportOpen(false)}
        footer={(
          <Button onClick={() => setSkuImportReportOpen(false)}>关闭</Button>
        )}
        width={920}
        destroyOnHidden
        forceRender
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <Typography.Text>
            {`成功 ${Number(skuImportReport?.successCount || 0)} 条（新增 ${Number(skuImportReport?.createdCount || 0)} 条，替换 ${Number(skuImportReport?.replacedCount || 0)} 条），失败 ${Number(skuImportReport?.failedCount || 0)} 条`}
          </Typography.Text>
          <Table
            rowKey={(r, idx) => `${r?.sheetName || ''}_${r?.rowNumber || ''}_${r?.index || idx}`}
            size="small"
            dataSource={Array.isArray(skuImportReport?.failedRows) ? skuImportReport.failedRows : []}
            pagination={{ pageSize: 10, showSizeChanger: true }}
            columns={[
              {
                title: '序号',
                width: 70,
                align: 'center',
                render: (_, __, idx) => idx + 1
              },
              {
                title: '工作表',
                dataIndex: 'sheetName',
                width: 160,
                ellipsis: true,
                render: (v) => normalizeText(v) || '-'
              },
              {
                title: '行号',
                dataIndex: 'rowNumber',
                width: 90,
                align: 'center',
                render: (v, r) => {
                  const n = Number(v || r?.index || 0)
                  return Number.isFinite(n) && n > 0 ? n : '-'
                }
              },
              {
                title: '列',
                dataIndex: 'column',
                width: 140,
                ellipsis: true,
                render: (v) => normalizeText(v) || '-'
              },
              {
                title: '原因',
                dataIndex: 'reason',
                ellipsis: true,
                render: (v) => normalizeText(v) || '-'
              }
            ]}
            scroll={{ x: 860 }}
          />
        </Space>
      </Modal>

      <Modal
        title="新增产品类别"
        open={categoryModalOpen}
        okText="保存"
        cancelText="取消"
        confirmLoading={categorySaving}
        onCancel={() => { setCategoryModalOpen(false); setCategoryModalValue('') }}
        onOk={async () => {
          const val = normalizeText(categoryModalValue)
          if (!val) return
          setCategorySaving(true)
          try {
            await addProductCategory(val)
            setCategoryModalOpen(false)
            setCategoryModalValue('')
          } finally {
            setCategorySaving(false)
          }
        }}
      >
        <Input
          value={categoryModalValue}
          onChange={(e) => setCategoryModalValue(e.target.value)}
          placeholder="请输入新的产品类别"
        />
      </Modal>

      <Modal
        title="批量设置材质"
        open={batchMaterialOpen}
        okText="确认"
        cancelText="取消"
        confirmLoading={batchMaterialSaving}
        onCancel={() => {
          setBatchMaterialOpen(false)
          setBatchMaterialType('inhouse')
          setBatchSupplierId('')
          setBatchMaterialCode('')
          setBatchFlute('')
          setBatchOutsourcedMaterialId('')
        }}
        onOk={handleConfirmBatchSetMaterial}
      >
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Typography.Text>{`已选择 ${selectedSkuKeys.length} 条SKU`}</Typography.Text>
          <Select
            placeholder="请选择类型"
            value={batchMaterialType || undefined}
            options={[
              { value: 'inhouse', label: '纸板材质' },
              { value: 'outsourced', label: '外购材料' }
            ]}
            onChange={async (v) => {
              const nextType = String(v || 'inhouse')
              setBatchMaterialType(nextType === 'outsourced' ? 'outsourced' : 'inhouse')
              setBatchMaterialCode('')
              setBatchFlute('')
              setBatchOutsourcedMaterialId('')
              const sid = normalizeText(batchSupplierId)
              if (!sid) return
              if (nextType === 'outsourced') {
                await loadSupplierOutsourcedMaterials(sid)
              } else {
                await loadSupplierMaterials(sid)
              }
            }}
            style={{ width: '100%' }}
          />
          <Select
            placeholder="请选择供应商"
            options={supplierOptions}
            value={batchSupplierId || undefined}
            showSearch
            optionFilterProp="label"
            allowClear
            loading={suppliersLoading}
            onChange={async (v) => {
              const nextSupplierId = normalizeText(v)
              setBatchSupplierId(nextSupplierId)
              setBatchMaterialCode('')
              setBatchFlute('')
              setBatchOutsourcedMaterialId('')
              if (nextSupplierId) {
                if (batchMaterialType === 'outsourced') {
                  await loadSupplierOutsourcedMaterials(nextSupplierId)
                } else {
                  await loadSupplierMaterials(nextSupplierId)
                }
              }
            }}
            style={{ width: '100%' }}
          />
          {batchMaterialType === 'outsourced' ? (
            <>
              <Select
                placeholder={batchSupplierId ? '请选择原材料名称' : '请先选择供应商'}
                options={batchOutsourcedMaterialOptions}
                value={batchOutsourcedMaterialId || undefined}
                disabled={!batchSupplierId}
                allowClear
                showSearch
                optionFilterProp="label"
                onChange={(v) => setBatchOutsourcedMaterialId(normalizeText(v))}
                loading={supplierOutsourcedMaterialsLoading}
                style={{ width: '100%' }}
              />
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <Typography.Text type="secondary">单价：</Typography.Text>
                  <Typography.Text>
                    {Number.isFinite(Number(batchOutsourcedMaterialSelected?.unitPrice))
                      ? `${Number(batchOutsourcedMaterialSelected.unitPrice).toFixed(4)}`
                      : '-'}
                    {normalizeText(batchOutsourcedMaterialSelected?.unit) ? ` / ${normalizeText(batchOutsourcedMaterialSelected.unit)}` : ''}
                  </Typography.Text>
                </div>
                {normalizeText(batchOutsourcedMaterialSelected?.specification) ? (
                  <Typography.Text type="secondary">{`规格：${normalizeText(batchOutsourcedMaterialSelected.specification)}`}</Typography.Text>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <Space wrap size={12}>
                <Select
                  placeholder={batchSupplierId ? '请选择材质编码' : '请先选择供应商'}
                  options={batchMaterialCodeOptions}
                  value={batchMaterialCode || undefined}
                  disabled={!batchSupplierId}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  onChange={(v) => {
                    setBatchMaterialCode(normalizeText(v))
                    setBatchFlute('')
                  }}
                  style={{ width: 220 }}
                />
                <Select
                  placeholder="请选择楞别"
                  options={batchFluteOptions}
                  value={batchFlute || undefined}
                  disabled={!batchSupplierId || !batchMaterialCode}
                  allowClear
                  showSearch
                  optionFilterProp="label"
                  onChange={(v) => setBatchFlute(normalizeText(v))}
                  style={{ width: 180 }}
                />
              </Space>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <div>
                  <Typography.Text type="secondary">平方单价：</Typography.Text>
                  <Typography.Text>
                    {Number.isFinite(Number(batchMaterialPricePerSqm))
                      ? `${Number(batchMaterialPricePerSqm).toFixed(4)} 元/㎡`
                      : '-'}
                  </Typography.Text>
                </div>
                {batchMaterialInfoText ? (
                  <Typography.Text type="secondary">{batchMaterialInfoText}</Typography.Text>
                ) : null}
              </div>
            </>
          )}
        </Space>
      </Modal>

      <Modal
        title="调整SKU单价"
        open={adjustPriceOpen}
        okText="确认保存"
        cancelText="取消"
        confirmLoading={adjustPriceSaving}
        onCancel={() => {
          setAdjustPriceOpen(false)
          setAdjustPriceRows([])
        }}
        onOk={handleConfirmAdjustPrice}
        width={860}
      >
        <Table
          size="small"
          bordered
          loading={adjustPriceLoading}
          pagination={false}
          rowKey={(r) => String(r?.id || r?.key)}
          dataSource={adjustPriceRows}
          columns={[
            {
              title: '商品',
              dataIndex: 'name',
              key: 'name',
              width: 260,
              render: (v, r) => {
                const name = normalizeText(v)
                const materialNo = normalizeText(r?.materialNo)
                if (!materialNo) return name || '-'
                return (
                  <div style={{ lineHeight: 1.25 }}>
                    <div>{name || '-'}</div>
                    <div style={{ color: '#6b7280' }}>{materialNo}</div>
                  </div>
                )
              }
            },
            {
              title: '材质',
              dataIndex: 'materialCode',
              key: 'materialCode',
              width: 160,
              render: (v, r) => {
                const code = normalizeText(v)
                const flute = normalizeText(r?.flute)
                return flute ? `${code || '-'} / ${flute}` : (code || '-')
              }
            },
            {
              title: '供应商',
              dataIndex: 'supplierName',
              key: 'supplierName',
              width: 160,
              render: (_, r) => {
                const sid = normalizeText(r?.supplierId)
                const sup = sid ? supplierById.get(sid) : null
                const shortName = sup ? normalizeText(sup?.shortName) : ''
                return shortName || normalizeText(r?.supplierName) || '-'
              }
            },
            {
              title: '当前单价',
              dataIndex: 'unitPrice',
              key: 'unitPrice',
              width: 120,
              align: 'right',
              render: (v) => {
                if (v === undefined || v === null || v === '') return '-'
                const n = Number(v)
                if (!Number.isFinite(n)) return String(v)
                const display = priceTaxMode === 'untaxed' ? toUntaxedPrice(n) : n
                const label = priceTaxMode === 'untaxed' ? '未税' : '含税'
                const color = priceTaxMode === 'untaxed' ? 'gold' : 'blue'
                return (
                  <span>
                    {formatMoneyLike(display)}
                    <Tag color={color} style={{ marginInlineStart: 6 }}>{label}</Tag>
                  </span>
                )
              }
            },
            {
              title: '调整后单价',
              dataIndex: 'nextUnitPrice',
              key: 'nextUnitPrice',
              width: 140,
              align: 'right',
              render: (_, r, idx) => (
                <InputNumber
                  min={0}
                  precision={4}
                  value={priceTaxMode === 'untaxed' ? toUntaxedPrice(r?.nextUnitPrice) : r?.nextUnitPrice}
                  style={{ width: '100%' }}
                  onChange={(val) => {
                    const nextTaxed = val === null || val === undefined || val === '' ? undefined : (
                      priceTaxMode === 'untaxed' ? toTaxedPrice(val) : Number(val)
                    )
                    setAdjustPriceRows((prev) => {
                      const next = [...(prev || [])]
                      const row = next[idx]
                      if (!row) return next
                      next[idx] = { ...row, nextUnitPrice: nextTaxed }
                      return next
                    })
                  }}
                />
              )
            }
          ]}
        />
      </Modal>
    </div>
  )
}

export default CustomerManagementDetail
