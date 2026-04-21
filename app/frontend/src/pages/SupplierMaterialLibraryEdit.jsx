import React, { useEffect, useMemo, useState } from 'react'
import { App, Button, Card, Descriptions, Form, Input, InputNumber, Modal, Radio, Select, Space, Table, Tag } from 'antd'
import { ArrowLeftOutlined, DeleteOutlined, EditOutlined, PlusOutlined, ReloadOutlined } from '@ant-design/icons'
import { useNavigate, useParams } from 'react-router-dom'
import { cachedPurchaseAPI } from '../services/cachedAPI'
import { supplierAPI, supplierMaterialAPI, supplierOutsourcedMaterialAPI } from '../services/api'

function SupplierMaterialLibraryEdit() {
  const { message } = App.useApp()
  const navigate = useNavigate()
  const { id } = useParams()

  const supplierId = useMemo(() => String(id || '').trim(), [id])
  const baseFontSize = 16

  const [supplierLoading, setSupplierLoading] = useState(false)
  const [supplier, setSupplier] = useState(null)

  const [materialLoading, setMaterialLoading] = useState(false)
  const [materialRows, setMaterialRows] = useState([])

  const [outsourcedLoading, setOutsourcedLoading] = useState(false)
  const [outsourcedRows, setOutsourcedRows] = useState([])

  const [editOpen, setEditOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editForm] = Form.useForm()
  const [creatingNewFlute, setCreatingNewFlute] = useState(false)
  const [extraFluteOptions, setExtraFluteOptions] = useState([])

  const [outsourcedOpen, setOutsourcedOpen] = useState(false)
  const [outsourcedSaving, setOutsourcedSaving] = useState(false)
  const [outsourcedEditing, setOutsourcedEditing] = useState(null)
  const [outsourcedForm] = Form.useForm()

  const [adjustOpen, setAdjustOpen] = useState(false)
  const [adjustForm] = Form.useForm()
  const [adjusting, setAdjusting] = useState(false)

  const extractList = (res) => {
    const payload = res?.data ?? res
    const data = payload?.data ?? payload?.data?.data ?? payload
    if (Array.isArray(data)) return data
    if (Array.isArray(data?.data)) return data.data
    if (Array.isArray(data?.suppliers)) return data.suppliers
    return []
  }

  const FLUTE_PRESETS = useMemo(() => (['A楞', 'B楞', 'E楞', 'AB楞', 'EB楞']), [])
  const normalizeText = (v) => String(v == null ? '' : v).trim()
  const normalizeFluteList = (v) => {
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
  }
  const buildFluteDisplay = (flutes) => {
    const list = normalizeFluteList(flutes)
    return list.length ? list.join('、') : ''
  }

  const fetchAllPages = async (fn, baseParams, options = {}) => {
    const pageKey = options.pageKey || 'page'
    const sizeKey = options.sizeKey || 'pageSize'
    const pageSize = Number(options.pageSize || 200)
    const maxPages = Number(options.maxPages || 50)
    const all = []
    let firstPageSig = ''
    for (let page = 1; page <= maxPages; page += 1) {
      const resp = await fn({ ...(baseParams || {}), [pageKey]: page, [sizeKey]: pageSize })
      const rows = extractList(resp)
      const headSig = rows
        .slice(0, 5)
        .map((r) => String(r?._id ?? r?.id ?? ''))
        .filter(Boolean)
        .join('|')
      if (page === 1) {
        firstPageSig = headSig
      } else if (headSig && firstPageSig && headSig === firstPageSig) {
        break
      }
      if (rows.length) all.push(...rows)
      if (!rows.length || rows.length < pageSize) break
    }
    return all
  }

  const resolveSupplier = async () => {
    if (!supplierId) return
    setSupplierLoading(true)
    try {
      const list = await fetchAllPages(
        supplierAPI.getSuppliers,
        {},
        { pageKey: 'page', sizeKey: 'limit', pageSize: 200, maxPages: 200 }
      )
      const found = (list || []).find((s) => {
        const sid = String(s?._id ?? s?.id ?? s?.key ?? '').trim()
        return sid === supplierId
      })
      if (!found) {
        message.error('供应商不存在')
        navigate('/products')
        return
      }
      setSupplier({
        ...found,
        id: String(found?._id ?? found?.id ?? supplierId).trim() || supplierId,
        name: found?.name ?? found?.companyName ?? found?.company ?? ''
      })
    } catch (_) {
      message.error('加载供应商信息失败')
    } finally {
      setSupplierLoading(false)
    }
  }

  const pickSupplierIdFromOrder = (o) => {
    const direct = String(o?.supplierId ?? o?.supplier?._id ?? o?.supplier?.id ?? '').trim()
    if (direct) return direct
    const supName = String(o?.supplierName ?? o?.supplier?.name ?? o?.supplier?.companyName ?? '').trim()
    const selfName = String(supplier?.name ?? supplier?.companyName ?? '').trim()
    const selfShort = String(supplier?.shortName ?? '').trim()
    if (!supName) return ''
    if (selfName && supName === selfName) return supplierId
    if (selfShort && supName === selfShort) return supplierId
    return ''
  }

  const pickMaterialCodeFromOrder = (o) => {
    const items = Array.isArray(o?.items) ? o.items : []
    const first = items[0] || {}
    const raw =
      o?.materialNo ??
      o?.materialCode ??
      o?.material_code ??
      first?.materialNo ??
      first?.materialCode ??
      first?.material_no ??
      first?.material_code ??
      ''
    return String(raw || '').trim()
  }

  const pickFluteFromOrder = (o) => {
    const items = Array.isArray(o?.items) ? o.items : []
    const first = items[0] || {}
    const raw = o?.flute ?? o?.fluteType ?? o?.flute_type ?? first?.flute ?? first?.fluteType ?? first?.flute_type ?? ''
    return String(raw || '').trim()
  }

  const pickPriceFromOrder = (o) => {
    const items = Array.isArray(o?.items) ? o.items : []
    const first = items[0] || {}
    const raw = first?.unitPrice ?? o?.unitPrice ?? ''
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : null
  }

  const pickQuoteAtTs = (o) => {
    const raw = o?.updatedAt ?? o?._updateTime ?? o?.updateTime ?? o?.updatedTime ?? o?.createdAt ?? o?._createTime ?? o?.createdTime
    const n = Number(raw)
    if (Number.isFinite(n) && n > 0) return n
    const d = raw ? new Date(raw) : null
    const ts = d && Number.isFinite(d.getTime()) ? d.getTime() : null
    return ts != null && ts > 0 ? ts : null
  }

  const formatQuoteTime = (ts) => {
    const n = ts != null ? Number(ts) : NaN
    if (!Number.isFinite(n) || n <= 0) return '-'
    try {
      return new Date(n).toLocaleString('zh-CN', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch (_) {
      return '-'
    }
  }

  const extractMaterialItem = (res) => {
    const payload = res?.data ?? res
    const data = payload?.data ?? payload?.data?.data ?? payload
    return data?.item ?? data?.data?.item ?? payload?.item ?? null
  }

  const loadMaterials = async () => {
    if (!supplierId) return
    setMaterialLoading(true)
    try {
      const [ordersBoards, ordersRaw, savedRes] = await Promise.all([
        fetchAllPages(
          cachedPurchaseAPI.getPurchaseOrders,
          { category: 'boards', withTotal: false, withProducts: false },
          { pageKey: 'page', sizeKey: 'pageSize', pageSize: 500, maxPages: 50 }
        ),
        fetchAllPages(
          cachedPurchaseAPI.getPurchaseOrders,
          { category: 'raw_materials', withTotal: false, withProducts: false },
          { pageKey: 'page', sizeKey: 'pageSize', pageSize: 500, maxPages: 50 }
        ),
        supplierMaterialAPI.list({ supplierId })
      ])

      const savedList = extractList(savedRes).map((r) => ({
        ...r,
        id: String(r?._id ?? r?.id ?? '').trim(),
        materialCode: String(r?.materialCode ?? r?.code ?? '').trim(),
        grammageText: String(r?.grammageText ?? r?.grammageLabel ?? r?.grammageDisplay ?? '').trim(),
        flutes: normalizeFluteList(r?.flutes ?? r?.fluteOptions ?? r?.flute_options ?? r?.fluteList ?? r?.flute_list ?? r?.flute),
        quoteAt: pickQuoteAtTs(r)
      }))

      const discovered = new Map()
      const orders = [...(ordersBoards || []), ...(ordersRaw || [])]
      orders.forEach((o) => {
        const sid = pickSupplierIdFromOrder(o)
        if (sid !== supplierId) return
        const code = pickMaterialCodeFromOrder(o)
        if (!code) return
        const flute = pickFluteFromOrder(o)
        const unitPrice = pickPriceFromOrder(o)
        const prev = discovered.get(code)
        const next = {
          materialCode: code,
          flutes: normalizeFluteList([...(prev?.flutes || []), flute].filter(Boolean)),
          suggestedPricePerSqm: unitPrice != null ? unitPrice : (prev?.suggestedPricePerSqm ?? null)
        }
        discovered.set(code, next)
      })

      const merged = new Map()
      Array.from(discovered.values()).forEach((it) => {
        merged.set(it.materialCode, {
          key: `m_${it.materialCode}`,
          id: '',
          supplierId,
          materialCode: it.materialCode,
          grammageG: null,
          grammageText: '',
          flute: '',
          flutes: normalizeFluteList(it.flutes),
          pricePerSqm: null,
          quoteAt: null,
          suggestedPricePerSqm: it.suggestedPricePerSqm ?? null
        })
      })

      savedList.forEach((it, idx) => {
        const code = String(it.materialCode || '').trim()
        if (!code) return
        const prev = merged.get(code)
        const flutes = normalizeFluteList(it?.flutes?.length ? it.flutes : (prev?.flutes || prev?.flute || ''))
        merged.set(code, {
          ...(prev || {}),
          key: prev?.key || it.id || `saved_${idx}`,
          id: it.id || prev?.id || '',
          supplierId,
          materialCode: code,
          grammageG: it.grammageG != null ? Number(it.grammageG) : (prev?.grammageG ?? null),
          grammageText: String(it.grammageText || prev?.grammageText || '').trim(),
          flute: flutes.length ? flutes[0] : '',
          flutes,
          pricePerSqm: it.pricePerSqm != null ? Number(it.pricePerSqm) : null,
          quoteAt: it.quoteAt ?? prev?.quoteAt ?? null
        })
      })

      const rows = Array.from(merged.values())
      rows.sort((a, b) => String(a.materialCode || '').localeCompare(String(b.materialCode || ''), 'zh-CN'))
      setMaterialRows(rows)
    } catch (_) {
      message.error('加载材质数据失败')
      setMaterialRows([])
    } finally {
      setMaterialLoading(false)
    }
  }

  const loadOutsourcedMaterials = async (options = {}) => {
    if (!supplierId) return
    setOutsourcedLoading(true)
    try {
      const force = Boolean(options?.force)
      const res = await supplierOutsourcedMaterialAPI.list({ supplierId, ...(force ? { _ts: Date.now() } : {}) })
      const list = extractList(res).map((r) => ({
        ...r,
        id: String(r?._id ?? r?.id ?? '').trim(),
        name: String(r?.name ?? r?.rawMaterialName ?? r?.materialName ?? r?.title ?? '').trim(),
        specification: String(r?.specification ?? r?.spec ?? r?.size ?? '').trim(),
        unit: String(r?.unit ?? r?.uom ?? '').trim(),
        unitPrice:
          r?.unitPrice != null && r?.unitPrice !== '' && Number.isFinite(Number(r.unitPrice))
            ? Number(r.unitPrice)
            : (r?.price != null && r?.price !== '' && Number.isFinite(Number(r.price)) ? Number(r.price) : null),
        quoteAt: pickQuoteAtTs(r)
      }))
      const normalized = list.filter((r) => r?.id && r?.name)
      normalized.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-CN'))
      setOutsourcedRows(normalized)
    } catch (_) {
      message.error('加载外购材料失败')
      setOutsourcedRows([])
    } finally {
      setOutsourcedLoading(false)
    }
  }

  useEffect(() => { resolveSupplier() }, [supplierId])
  useEffect(() => {
    if (!supplier) return
    loadMaterials()
    loadOutsourcedMaterials()
  }, [supplier])

  const materialInfoTags = useMemo(() => {
    const seen = new Set()
    const tags = []
    ;(materialRows || []).forEach((r) => {
      const code = String(r?.materialCode || '').trim()
      if (!code || seen.has(code)) return
      const grammageText = String(r?.grammageText || '').trim()
      const grammageG = r?.grammageG != null ? Number(r.grammageG) : NaN
      const grammage = grammageText || (Number.isFinite(grammageG) && grammageG > 0 ? `${grammageG}g` : '')
      if (!grammage) return
      const fluteText = buildFluteDisplay(r?.flutes ?? r?.flute)
      const text = `${code}:${grammage}${fluteText ? ` ${fluteText}` : ''}`
      seen.add(code)
      tags.push({ key: String(r?.id || r?._id || code), text })
    })
    return tags.slice(0, 120)
  }, [materialRows])

  const openAdd = () => {
    setEditing(null)
    setCreatingNewFlute(false)
    setExtraFluteOptions([])
    editForm.resetFields()
    editForm.setFieldsValue({
      materialCode: '',
      grammageText: '',
      flutes: [],
      newFlute: undefined,
      pricePerSqm: null
    })
    setEditOpen(true)
  }

  const openEdit = (row) => {
    setEditing(row)
    const usedFlutes = normalizeFluteList(row?.flutes ?? row?.flute)
    setCreatingNewFlute(false)
    setExtraFluteOptions(usedFlutes.filter((x) => !FLUTE_PRESETS.includes(x)))
    editForm.setFieldsValue({
      materialCode: row?.materialCode || '',
      grammageText: String(row?.grammageText || (row?.grammageG != null ? `${row.grammageG}g` : '')).trim(),
      flutes: usedFlutes,
      newFlute: undefined,
      pricePerSqm: row?.pricePerSqm ?? null
    })
    setEditOpen(true)
  }

  const openAddOutsourced = () => {
    setOutsourcedEditing(null)
    outsourcedForm.resetFields()
    outsourcedForm.setFieldsValue({
      name: '',
      specification: '',
      unit: '',
      unitPrice: null
    })
    setOutsourcedOpen(true)
  }

  const openEditOutsourced = (row) => {
    setOutsourcedEditing(row)
    outsourcedForm.resetFields()
    outsourcedForm.setFieldsValue({
      name: String(row?.name || '').trim(),
      specification: String(row?.specification || '').trim(),
      unit: String(row?.unit || '').trim(),
      unitPrice: row?.unitPrice != null && Number.isFinite(Number(row.unitPrice)) ? Number(row.unitPrice) : null
    })
    setOutsourcedOpen(true)
  }

  const handleSaveOutsourced = async () => {
    if (!supplierId) return
    setOutsourcedSaving(true)
    try {
      const values = await outsourcedForm.validateFields()
      const payload = {
        supplierId,
        name: String(values?.name || '').trim(),
        specification: String(values?.specification || '').trim(),
        unit: String(values?.unit || '').trim(),
        unitPrice: values?.unitPrice != null ? Number(values.unitPrice) : null
      }
      const usedId = String(outsourcedEditing?.id || outsourcedEditing?._id || '').trim()
      if (usedId) {
        await supplierOutsourcedMaterialAPI.update(usedId, { ...payload, id: usedId })
      } else {
        await supplierOutsourcedMaterialAPI.upsert(payload)
      }
      message.success('已保存')
      setOutsourcedOpen(false)
      setOutsourcedEditing(null)
      outsourcedForm.resetFields()
      loadOutsourcedMaterials()
    } catch (e) {
      if (e?.errorFields) return
      const serverMsg = e?.response?.data?.message || e?.response?.data?.error || e?.message
      message.error(serverMsg ? `保存失败：${serverMsg}` : '保存失败')
    } finally {
      setOutsourcedSaving(false)
    }
  }

  const handleSave = async () => {
    if (!supplierId) return
    try {
      const values = await editForm.validateFields()
      const nextCode = String(values.materialCode || '').trim()
      if (editing?.id) {
        const conflict = (materialRows || []).some((r) => {
          const rid = String(r?.id || r?._id || '').trim()
          if (!rid || rid === String(editing?.id)) return false
          return String(r?.materialCode || '').trim() === nextCode
        })
        if (conflict) {
          message.error('该材质编码已存在，请更换材质编码')
          return
        }
      }
      const mergedFlutes = normalizeFluteList([...(Array.isArray(values.flutes) ? values.flutes : []), values.newFlute])
      const payload = {
        supplierId,
        materialCode: nextCode,
        grammageG: String(values.grammageText ?? '').trim(),
        grammageText: String(values.grammageText ?? '').trim(),
        flutes: mergedFlutes,
        flute: (() => {
          return mergedFlutes.length ? mergedFlutes[0] : ''
        })(),
        pricePerSqm: values.pricePerSqm != null ? Number(values.pricePerSqm) : null
      }
      if (editing?.id) {
        await supplierMaterialAPI.update(editing.id, payload)
      } else {
        await supplierMaterialAPI.upsert(payload)
      }
      message.success('已保存')
      setEditOpen(false)
      setEditing(null)
      setCreatingNewFlute(false)
      setExtraFluteOptions([])
      editForm.resetFields()
      loadMaterials()
    } catch (e) {
      const serverMsg = e?.response?.data?.message || e?.response?.data?.error || e?.message
      message.error(serverMsg ? `保存失败：${serverMsg}` : '保存失败')
    }
  }

  const handleDelete = async (row) => {
    const rid = String(row?.id || row?._id || '').trim()
    if (!rid) {
      message.warning('该材质未保存，无法删除')
      return
    }
    try {
      await supplierMaterialAPI.remove(rid)
      message.success('已删除')
      loadMaterials()
    } catch (_) {
      message.error('删除失败')
    }
  }

  const handleDeleteOutsourced = async (row) => {
    const rid = String(row?.id || row?._id || '').trim()
    if (!rid) {
      message.warning('该外购材料未保存，无法删除')
      return
    }
    try {
      await supplierOutsourcedMaterialAPI.remove(rid)
      message.success('已删除')
      setOutsourcedRows((prev) => (Array.isArray(prev) ? prev.filter((it) => String(it?.id || '').trim() !== rid) : []))
      loadOutsourcedMaterials({ force: true })
    } catch (e) {
      const serverMsg = e?.response?.data?.message || e?.response?.data?.error || e?.message
      message.error(serverMsg ? `删除失败：${serverMsg}` : '删除失败')
    }
  }

  const openAdjust = () => {
    adjustForm.resetFields()
    adjustForm.setFieldsValue({
      direction: 'up',
      percent: null
    })
    setAdjustOpen(true)
  }

  const processBatches = (items, batchSize, task) => {
    const results = []
    const run = (start) => {
      if (start >= items.length) return Promise.resolve(results)
      const batch = items.slice(start, start + batchSize)
      return Promise.allSettled(batch.map(task)).then((settled) => {
        results.push(...settled)
        return run(start + batchSize)
      })
    }
    return run(0)
  }

  const handleAdjustPrices = async () => {
    if (!supplierId) return
    try {
      const values = await adjustForm.validateFields()
      const percent = values?.percent != null ? Number(values.percent) : NaN
      if (!Number.isFinite(percent) || percent <= 0) {
        message.warning('请输入大于 0 的百分比')
        return
      }
      const direction = String(values?.direction || 'up')
      const factor = direction === 'down' ? 1 - percent / 100 : 1 + percent / 100
      if (!Number.isFinite(factor) || factor <= 0) {
        message.warning('调价结果无效')
        return
      }

      const targets = (materialRows || [])
        .map((r) => {
          const code = String(r?.materialCode || '').trim()
          if (!code) return null
          const base =
            r?.pricePerSqm != null && Number.isFinite(Number(r.pricePerSqm))
              ? Number(r.pricePerSqm)
              : (r?.suggestedPricePerSqm != null && Number.isFinite(Number(r.suggestedPricePerSqm)) ? Number(r.suggestedPricePerSqm) : null)
          if (base == null || base < 0) return null
          const next = Number((base * factor).toFixed(3))
          if (!Number.isFinite(next) || next < 0) return null
          const prevSaved = r?.pricePerSqm != null && Number.isFinite(Number(r.pricePerSqm)) ? Number(r.pricePerSqm) : null
          if (prevSaved != null && Number((prevSaved).toFixed(3)) === next) return null
          return {
            supplierId,
            materialCode: code,
            grammageG: r?.grammageG != null && Number.isFinite(Number(r.grammageG)) ? Number(r.grammageG) : null,
            grammageText: String(r?.grammageText || '').trim(),
            flutes: normalizeFluteList(r?.flutes ?? r?.flute),
            flute: (() => {
              const list = normalizeFluteList(r?.flutes ?? r?.flute)
              return list.length ? list[0] : ''
            })(),
            pricePerSqm: next
          }
        })
        .filter(Boolean)

      if (!targets.length) {
        message.info('没有可调价的材质')
        return
      }

      setAdjusting(true)
      const settled = await processBatches(targets, 10, (payload) => supplierMaterialAPI.upsert(payload))
      const okCount = settled.filter((r) => r.status === 'fulfilled').length
      const failCount = settled.length - okCount
      if (failCount) {
        message.warning(`整体调价完成：成功 ${okCount} 条，失败 ${failCount} 条`)
      } else {
        message.success(`整体调价完成：成功 ${okCount} 条`)
      }
      setAdjustOpen(false)
      adjustForm.resetFields()
      loadMaterials()
    } catch (e) {
      const serverMsg = e?.response?.data?.message || e?.response?.data?.error || e?.message
      message.error(serverMsg ? `整体调价失败：${serverMsg}` : '整体调价失败')
    } finally {
      setAdjusting(false)
    }
  }

  const columns = [
    {
      title: '材质编码',
      dataIndex: 'materialCode',
      key: 'materialCode',
      width: 120,
      ellipsis: true,
      align: 'left',
      render: (v) => <span style={{ fontSize: baseFontSize, fontWeight: 600 }}>{String(v || '').trim() || '-'}</span>
    },
    {
      title: '楞别',
      dataIndex: 'flute',
      key: 'flute',
      width: 120,
      align: 'center',
      ellipsis: true,
      render: (_, r) => <span style={{ fontSize: baseFontSize }}>{buildFluteDisplay(r?.flutes ?? r?.flute) || '-'}</span>
    },
    {
      title: '克重',
      dataIndex: 'grammageText',
      key: 'grammageG',
      width: 160,
      align: 'center',
      render: (_, r) => {
        const text = String(r?.grammageText || '').trim()
        if (text) return <div style={{ whiteSpace: 'normal', wordBreak: 'break-all', fontSize: baseFontSize }}>{text}</div>
        const n = r?.grammageG != null ? Number(r.grammageG) : NaN
        if (Number.isFinite(n) && n > 0) return <div style={{ whiteSpace: 'normal', wordBreak: 'break-all', fontSize: baseFontSize }}>{`${n}g`}</div>
        return <span style={{ fontSize: baseFontSize }}>-</span>
      }
    },
    {
      title: '平方单价',
      dataIndex: 'pricePerSqm',
      key: 'pricePerSqm',
      width: 170,
      align: 'center',
      render: (v, r) => {
        const n = v != null ? Number(v) : NaN
        if (Number.isFinite(n) && n >= 0) return <span style={{ fontSize: baseFontSize }}>{`${n.toFixed(3)} 元/㎡`}</span>
        const s = r?.suggestedPricePerSqm != null ? Number(r.suggestedPricePerSqm) : NaN
        if (Number.isFinite(s) && s >= 0) return <span style={{ color: '#6b7280', fontSize: baseFontSize }}>{`${s.toFixed(3)} 元/㎡`}</span>
        return <span style={{ fontSize: baseFontSize }}>-</span>
      }
    },
    {
      title: '报价时间',
      dataIndex: 'quoteAt',
      key: 'quoteAt',
      width: 180,
      align: 'center',
      ellipsis: true,
      render: (v) => <span style={{ fontSize: baseFontSize }}>{formatQuoteTime(v)}</span>
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      align: 'center',
      fixed: 'right',
      render: (_, r) => (
        <Space size="small">
          <Button type="link" size="small" style={{ fontSize: baseFontSize }} icon={<EditOutlined />} onClick={() => openEdit(r)}>编辑</Button>
          <Button type="link" size="small" style={{ fontSize: baseFontSize }} danger icon={<DeleteOutlined />} onClick={() => handleDelete(r)}>删除</Button>
        </Space>
      )
    }
  ]

  const outsourcedColumns = [
    {
      title: '原材料名称',
      dataIndex: 'name',
      key: 'name',
      width: 220,
      ellipsis: true,
      render: (v) => <span style={{ fontSize: baseFontSize, fontWeight: 600 }}>{String(v || '').trim() || '-'}</span>
    },
    {
      title: '规格',
      dataIndex: 'specification',
      key: 'specification',
      width: 220,
      ellipsis: true,
      render: (v) => <span style={{ fontSize: baseFontSize }}>{String(v || '').trim() || '-'}</span>
    },
    {
      title: '单位',
      dataIndex: 'unit',
      key: 'unit',
      width: 120,
      align: 'center',
      ellipsis: true,
      render: (v) => <span style={{ fontSize: baseFontSize }}>{String(v || '').trim() || '-'}</span>
    },
    {
      title: '单价',
      dataIndex: 'unitPrice',
      key: 'unitPrice',
      width: 160,
      align: 'center',
      render: (v, r) => {
        const n = v != null ? Number(v) : NaN
        const unit = String(r?.unit || '').trim()
        if (Number.isFinite(n) && n >= 0) {
          return <span style={{ fontSize: baseFontSize }}>{`${n.toFixed(4)}${unit ? ` / ${unit}` : ''}`}</span>
        }
        return <span style={{ fontSize: baseFontSize }}>-</span>
      }
    },
    {
      title: '更新时间',
      dataIndex: 'quoteAt',
      key: 'quoteAt',
      width: 180,
      align: 'center',
      ellipsis: true,
      render: (v) => <span style={{ fontSize: baseFontSize }}>{formatQuoteTime(v)}</span>
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      align: 'center',
      fixed: 'right',
      render: (_, r) => (
        <Space size="small">
          <Button type="link" size="small" style={{ fontSize: baseFontSize }} icon={<EditOutlined />} onClick={() => openEditOutsourced(r)}>编辑</Button>
          <Button type="link" size="small" style={{ fontSize: baseFontSize }} danger icon={<DeleteOutlined />} onClick={() => handleDeleteOutsourced(r)}>删除</Button>
        </Space>
      )
    }
  ]

  return (
    <div style={{ fontSize: baseFontSize }}>
      <h2 className="page-title" style={{ fontSize: 20, marginBottom: 12 }}>材质库编辑</h2>

      <Space style={{ marginBottom: 16 }}>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate('/products')} style={{ fontSize: baseFontSize }}>返回</Button>
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            loadMaterials()
            loadOutsourcedMaterials()
          }}
          loading={materialLoading || outsourcedLoading}
          style={{ fontSize: baseFontSize }}
        >
          刷新
        </Button>
      </Space>

      <Card style={{ marginBottom: 16 }} loading={supplierLoading}>
        <Descriptions title="供应商信息" column={3} size="default">
          <Descriptions.Item label="供应商名称">{supplier?.name || supplier?.companyName || supplier?.shortName || '-'}</Descriptions.Item>
          <Descriptions.Item label="联系人">{supplier?.contactName || supplier?.contact || '-'}</Descriptions.Item>
          <Descriptions.Item label="电话">{supplier?.phone || '-'}</Descriptions.Item>
          <Descriptions.Item label="状态">
            {String(supplier?.status || 'active') === 'inactive' ? <Tag color="red">停用</Tag> : <Tag color="green">启用</Tag>}
          </Descriptions.Item>
          <Descriptions.Item label="供应商ID" span={2}>{supplierId || '-'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card
        style={{ marginBottom: 16 }}
        title={(
          <Space size={8}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>材质信息</span>
          </Space>
        )}
      >
        <Space wrap size={8} style={{ marginBottom: 12 }}>
          {materialInfoTags.length
            ? materialInfoTags.map((t) => <Tag key={t.key} style={{ fontSize: baseFontSize }}>{t.text}</Tag>)
            : <span style={{ color: '#6b7280', fontSize: baseFontSize }}>暂无已维护克重的材质</span>}
        </Space>
      </Card>

      <Card
        title={(
          <Space size={8}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>材质列表</span>
            <Button type="primary" icon={<PlusOutlined />} onClick={openAdd} style={{ fontSize: baseFontSize }}>新增材质</Button>
            <Button icon={<PlusOutlined />} onClick={openAddOutsourced} style={{ fontSize: baseFontSize }}>新增外购材料</Button>
            <Button onClick={openAdjust} style={{ fontSize: baseFontSize }}>整体调价</Button>
          </Space>
        )}
      >
        <Table
          columns={columns}
          dataSource={materialRows}
          loading={materialLoading}
          size="large"
          bordered
          tableLayout="fixed"
          rowKey={(r, idx) => String(r?.id || r?._id || r?.materialCode || r?.key || `row_${idx}`)}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 920 }}
        />
      </Card>

      <Card
        title={(
          <Space size={8}>
            <span style={{ fontSize: 18, fontWeight: 600 }}>{`外购材料列表（${outsourcedRows.length}）`}</span>
          </Space>
        )}
      >
        <Table
          columns={outsourcedColumns}
          dataSource={outsourcedRows}
          loading={outsourcedLoading}
          size="large"
          bordered
          tableLayout="fixed"
          rowKey={(r, idx) => String(r?.id || r?._id || r?.key || `outs_${idx}`)}
          pagination={{ pageSize: 20, showSizeChanger: true }}
          scroll={{ x: 1040 }}
        />
      </Card>

      <Modal
        title={editing ? '编辑材质' : '新增材质'}
        open={editOpen}
        onOk={handleSave}
        onCancel={() => {
          setEditOpen(false)
          setEditing(null)
          setCreatingNewFlute(false)
          setExtraFluteOptions([])
          editForm.resetFields()
        }}
        forceRender
      >
        <Form form={editForm} layout="vertical">
          <Form.Item
            name="materialCode"
            label="材质编码"
            rules={[{ required: true, message: '请输入材质编码' }]}
          >
            <Input placeholder="例如：C、3、C3、C/3" style={{ fontSize: baseFontSize }} />
          </Form.Item>
          <Form.Item name="flutes" label="楞别" rules={[]}>
            <>
              <Select
                mode="multiple"
                placeholder="请选择楞别"
                options={[
                  ...FLUTE_PRESETS.map((v) => ({ value: v, label: v })),
                  ...extraFluteOptions
                    .filter((v) => normalizeText(v) && !FLUTE_PRESETS.includes(normalizeText(v)))
                    .map((v) => ({ value: normalizeText(v), label: normalizeText(v) })),
                  { value: '__NEW_FLUTE__', label: '新增' }
                ]}
                onChange={(vals) => {
                  const arr = Array.isArray(vals) ? vals : []
                  if (arr.includes('__NEW_FLUTE__')) {
                    setCreatingNewFlute(true)
                    editForm.setFieldsValue({ flutes: arr.filter((x) => x !== '__NEW_FLUTE__') })
                    return
                  }
                  editForm.setFieldsValue({ flutes: arr })
                }}
                showSearch
                optionFilterProp="label"
                style={{ width: '100%' }}
              />
              {creatingNewFlute ? (
                <Space style={{ marginTop: 8 }}>
                  <Form.Item name="newFlute" noStyle>
                    <Input placeholder="请输入楞别" style={{ width: 240, fontSize: baseFontSize }} />
                  </Form.Item>
                  <Button onClick={() => {
                    const text = normalizeText(editForm.getFieldValue('newFlute'))
                    if (!text) return
                    const current = normalizeFluteList(editForm.getFieldValue('flutes'))
                    const next = normalizeFluteList([...current, text])
                    setExtraFluteOptions((prev) => normalizeFluteList([...(prev || []), text]))
                    editForm.setFieldsValue({ flutes: next, newFlute: undefined })
                    setCreatingNewFlute(false)
                  }}>新增</Button>
                </Space>
              ) : null}
            </>
          </Form.Item>
          <Form.Item name="grammageText" label="克重(g)" rules={[]}>
            <Input placeholder="例如：80g / 80g 高瓦 / 80±2g" style={{ fontSize: baseFontSize }} />
          </Form.Item>
          <Form.Item name="pricePerSqm" label="平方单价" rules={[]}>
            <InputNumber min={0} style={{ width: '100%', fontSize: baseFontSize }} placeholder="例如：1.234" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={outsourcedEditing ? '编辑外购材料' : '新增外购材料'}
        open={outsourcedOpen}
        onOk={handleSaveOutsourced}
        onCancel={() => {
          setOutsourcedOpen(false)
          setOutsourcedEditing(null)
          outsourcedForm.resetFields()
        }}
        confirmLoading={outsourcedSaving}
        forceRender
      >
        <Form form={outsourcedForm} layout="vertical">
          <Form.Item name="name" label="原材料名称" rules={[{ required: true, message: '请输入原材料名称' }]}>
            <Input placeholder="例如：牛皮纸" style={{ fontSize: baseFontSize }} />
          </Form.Item>
          <Form.Item name="specification" label="规格" rules={[]}>
            <Input placeholder="例如：80g / 1000mm" style={{ fontSize: baseFontSize }} />
          </Form.Item>
          <Form.Item name="unit" label="单位" rules={[{ required: true, message: '请输入单位' }]}>
            <Input placeholder="例如：kg / 张 / 卷" style={{ fontSize: baseFontSize }} />
          </Form.Item>
          <Form.Item name="unitPrice" label="单价" rules={[{ required: true, message: '请输入单价' }]}>
            <InputNumber min={0} style={{ width: '100%', fontSize: baseFontSize }} placeholder="例如：12.34" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="整体调价"
        open={adjustOpen}
        onOk={handleAdjustPrices}
        onCancel={() => {
          setAdjustOpen(false)
          adjustForm.resetFields()
        }}
        confirmLoading={adjusting}
        forceRender
      >
        <Form form={adjustForm} layout="vertical">
          <Form.Item name="direction" label="方向" rules={[{ required: true, message: '请选择方向' }]}>
            <Radio.Group
              options={[
                { label: '上调', value: 'up' },
                { label: '下浮', value: 'down' }
              ]}
              optionType="button"
              buttonStyle="solid"
            />
          </Form.Item>
          <Form.Item
            name="percent"
            label="百分比(%)"
            rules={[{ required: true, message: '请输入百分比' }]}
          >
            <InputNumber
              min={0}
              precision={3}
              style={{ width: '100%', fontSize: baseFontSize }}
              placeholder="例如：1 表示 1%"
              parser={(v) => String(v ?? '').replace(/[^\d.]/g, '')}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

export default SupplierMaterialLibraryEdit
