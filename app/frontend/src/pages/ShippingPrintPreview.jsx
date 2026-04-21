import React, { useEffect, useMemo, useState } from 'react'
import { Card, Table, Space, Button, Input, App, Checkbox, Select } from 'antd'
import { useLocation, useNavigate } from 'react-router-dom'
import dayjs from 'dayjs'
import * as XLSX from 'xlsx'
import { orderAPI, shippingNumberAPI } from '../services/api'

function toChineseUppercase(n) {
  const fraction = ['角', '分']
  const digit = ['零', '壹', '贰', '叁', '肆', '伍', '陆', '柒', '捌', '玖']
  const unit = [['元', '万', '亿'], ['', '拾', '佰', '仟']]
  let num = Number(n)
  if (!Number.isFinite(num) || num < 0) return ''
  let s = ''
  fraction.forEach((f, i) => {
    const d = digit[Math.floor(num * 10 * (10 ** i)) % 10]
    s += (d + f).replace(/零./, '')
  })
  s = s || '整'
  num = Math.floor(num)
  for (let i = 0; i < unit[0].length && num > 0; i += 1) {
    let p = ''
    for (let j = 0; j < unit[1].length && num > 0; j += 1) {
      p = digit[num % 10] + unit[1][j] + p
      num = Math.floor(num / 10)
    }
    s = p.replace(/(零.)*零$/, '').replace(/^$/, '零') + unit[0][i] + s
  }
  return s
    .replace(/(零.)*零元/, '元')
    .replace(/(零.)+/g, '零')
    .replace(/^整$/, '零元整')
}

const TEMPLATE_CONFIGS = {
  withAmount: {
    productName: true,
    goodsName: false,
    spec: true,
    unitPrice: true,
    amount: true,
    materialNo: false,
    remark: true
  },
  withoutAmount: {
    productName: false,
    goodsName: true,
    spec: true,
    unitPrice: false,
    amount: false,
    materialNo: true,
    remark: true
  },
  jintianTools: {
    productName: false,
    goodsName: true,
    spec: false,
    unitPrice: false,
    amount: false,
    materialNo: true,
    remark: true
  },
  purchasedGoods: {
    productName: false,
    goodsName: true,
    spec: true,
    unitPrice: true,
    amount: true,
    materialNo: false,
    remark: true
  }
}

const COMPANY_PRESETS = [
  {
    key: 'kunshanQunxin',
    name: '昆山群鑫包装科技有限公司',
    address: '昆山花桥镇民高路188号',
    phone: '13817508995',
    maker: '林群',
    salesman: '祝启鑫'
  },
  {
    key: 'shanghaiRongjiahe',
    name: '上海荣佳禾工贸有限公司',
    address: '上海市嘉定区华庭镇唐窑路88号',
    phone: '13817508995',
    maker: '林群',
    salesman: '祝启鑫'
  },
  {
    key: 'taicangChengliang',
    name: '太仓诚亮包装科技有限公司',
    address: '太仓市城厢镇新毛新兴西路北侧',
    phone: '13817508895',
    maker: '柯露',
    salesman: '温亮'
  }
]

function ShippingPrintPreview() {
  const { message } = App.useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const rows = Array.isArray(location.state?.rows) ? location.state.rows : []
  const isPlainObject = (v) => Boolean(v) && typeof v === 'object' && !Array.isArray(v)
  const parseDraftUpdatedAt = (v) => {
    const t = Date.parse(String(v || ''))
    return Number.isFinite(t) ? t : 0
  }
  const pickDraftFromRows = (list) => {
    let best = null
    let bestAt = 0
    ;(Array.isArray(list) ? list : []).forEach((r) => {
      const note = isPlainObject(r?.shippingNote) ? r.shippingNote : null
      const draft = isPlainObject(note?.draft) ? note.draft : null
      if (!draft) return
      const at = parseDraftUpdatedAt(draft.updatedAt)
      if (!best || at >= bestAt) {
        best = draft
        bestAt = at
      }
    })
    return best
  }
  const initialDraft = pickDraftFromRows(rows)
  const initConsignee = rows[0]?.customerName || ''
  const initAddress =
    rows[0]?.shippingNote?.draft?.meta?.address ||
    rows[0]?.shippingNote?.address ||
    rows[0]?.customerInfo?.address ||
    rows[0]?.customerAddress ||
    rows[0]?.address ||
    rows[0]?.customer?.address ||
    ''
  const initShippingNoteNo =
    rows[0]?.shippingNote?.draft?.meta?.shippingNoteNo ||
    rows[0]?.shippingNote?.shippingNoteNo ||
    rows[0]?.shippingNoteNo ||
    ''
  const [selectedCompany, setSelectedCompany] = useState(() => {
    const key = String(initialDraft?.selectedCompany || '').trim()
    const ok = COMPANY_PRESETS.some(c => c.key === key)
    return ok ? key : (COMPANY_PRESETS[0]?.key || '')
  })
  const [meta, setMeta] = useState(() => {
    const preset = COMPANY_PRESETS[0] || {}

    let shipDateVal = dayjs().format('YYYY-MM-DD')
    if (rows.length > 0) {
      const r = rows[0]
      const candidates = [
        r.shippedAt,
        r.shippedAtTs,
        r.shippedAtText,
        r.deliveryTime
      ]
      for (const c of candidates) {
        if (!c) continue
        const d = dayjs(c)
        if (d.isValid()) {
          shipDateVal = d.format('YYYY-MM-DD')
          break
        }
      }
    }

    const baseMeta = {
      companyName: preset.name || '',
      companyAddress: preset.address || '',
      companyPhone: preset.phone || '',
      customerName: initConsignee,
      address: initAddress,
      shipDate: shipDateVal,
      maker: preset.maker || '',
      salesman: preset.salesman || '',
      receiver: '',
      shippingNoteNo: initShippingNoteNo,
      amountUpper: '',
      amountNumeric: ''
    }
    const draftMeta = isPlainObject(initialDraft?.meta) ? initialDraft.meta : null
    return draftMeta ? { ...baseMeta, ...draftMeta } : baseMeta
  })
  const [items, setItems] = useState(() => {
    const normalizeDraftItems = (draftItems) => {
      const list = Array.isArray(draftItems) ? draftItems : []
      const cleaned = list
        .filter(it => isPlainObject(it) && String(it.key || '').trim() !== 'extra_blank')
        .map((it, i) => ({
          key: it.key || `row_${i}`,
          name: String(it.name ?? ''),
          productName: String(it.productName ?? ''),
          spec: String(it.spec ?? ''),
          qty: Number(it.qty ?? 0) || 0,
          unit: String(it.unit ?? '片'),
          unitPrice: it.unitPrice === '' ? '' : (Number(it.unitPrice ?? 0) || ''),
          amount: it.amount === '' ? '' : (Number(it.amount ?? 0) || 0),
          materialNo: String(it.materialNo ?? ''),
          remark: String(it.remark ?? '')
        }))
      const minRows = 9
      if (cleaned.length < minRows) {
        const startIndex = cleaned.length
        for (let i = startIndex; i < minRows; i += 1) {
          cleaned.push({
            key: `row_${i}`,
            name: '',
            productName: '',
            spec: '',
            qty: 0,
            unit: '片',
            unitPrice: '',
            amount: '',
            materialNo: '',
            remark: ''
          })
        }
      }
      return cleaned
    }

    if (Array.isArray(initialDraft?.items) && initialDraft.items.length) {
      return normalizeDraftItems(initialDraft.items)
    }

    const base = rows.map((r, i) => {
      const shipQty = Number(r.shipQty || 0)
      const orderQty = Number(r.quantity || 0)
      const orderAmount = Number(r.amount || 0)
      let unitPrice = Number(r.unitPrice || 0)
      if (!unitPrice && orderQty > 0 && orderAmount) {
        unitPrice = orderAmount / orderQty
      }
      const rawAmount = shipQty * unitPrice
      const amount = Number.isFinite(rawAmount) ? Number(rawAmount.toFixed(2)) : 0
      const materialNo = r.materialNo || ''
      const toNum = (v) => {
        const n = Number(v)
        return Number.isFinite(n) ? n : NaN
      }
      const bw = toNum(r.boardWidth ?? r.board_width)
      const bh = toNum(r.boardHeight ?? r.board_height)
      const normalizedSpec = String(
        r.orderSpecText ||
        r.specification ||
        r.productSpec ||
        r.product_spec ||
        r.spec ||
        ''
      ).trim()
      const spec = normalizedSpec && normalizedSpec !== '-' ? normalizedSpec : ''
      return {
        key: r.key || `row_${i}`,
        name: r.goodsName || '',
        productName: r.rawGoodsName || r.goodsName || r.productName || '',
        spec,
        qty: shipQty,
        unit: r.unit || '片',
        unitPrice: unitPrice || '',
        amount,
        materialNo,
        remark: ''
      }
    })
    const minRows = 9
    if (base.length < minRows) {
      const startIndex = base.length
      for (let i = startIndex; i < minRows; i += 1) {
        base.push({
          key: `row_${i}`,
          name: '',
          productName: '',
          spec: '',
          qty: 0,
          unit: '片',
          unitPrice: '',
          amount: '',
          materialNo: '',
          remark: ''
        })
      }
    }
    return base
  })
  const [selectedTemplate, setSelectedTemplate] = useState(() => {
    const t = String(initialDraft?.selectedTemplate || '').trim()
    return TEMPLATE_CONFIGS[t] ? t : 'withAmount'
  })
  const [columnConfig, setColumnConfig] = useState(() => {
    if (isPlainObject(initialDraft?.columnConfig)) return initialDraft.columnConfig
    const t = String(initialDraft?.selectedTemplate || '').trim()
    return TEMPLATE_CONFIGS[t] || TEMPLATE_CONFIGS.withAmount
  })
  const [paperSize, setPaperSize] = useState(() => String(initialDraft?.paperSize || 'A4'))
  const [orientation, setOrientation] = useState(() => String(initialDraft?.orientation || 'portrait'))
  const [marginTop, setMarginTop] = useState(() => (Number.isFinite(Number(initialDraft?.marginTop)) ? Number(initialDraft.marginTop) : 4))
  const [marginRight, setMarginRight] = useState(() => (Number.isFinite(Number(initialDraft?.marginRight)) ? Number(initialDraft.marginRight) : 0))
  const [marginBottom, setMarginBottom] = useState(() => (Number.isFinite(Number(initialDraft?.marginBottom)) ? Number(initialDraft.marginBottom) : 0))
  const [marginLeft, setMarginLeft] = useState(() => (Number.isFinite(Number(initialDraft?.marginLeft)) ? Number(initialDraft.marginLeft) : 4))
  const [printScale, setPrintScale] = useState(() => (Number.isFinite(Number(initialDraft?.printScale)) ? Number(initialDraft.printScale) : 100))

  useEffect(() => {
    if (!rows.length) {
      message.info('未选择订单，返回发货管理')
      navigate('/shipping', { replace: true })
    }
  }, [])

  useEffect(() => {
    const currentNo = String(meta?.shippingNoteNo || '').trim()
    if (currentNo) return
    const shipDate = String(meta?.shipDate || '').trim()
    if (!shipDate) return
    let cancelled = false
    const run = async () => {
      try {
        console.log('[发货单号生成] 开始请求，shipDate:', shipDate)
        const gen = await shippingNumberAPI.generateShippingNoteNumber({ shipDate })
        console.log('[发货单号生成] 成功响应:', gen)
        const no = String(gen?.data?.shippingNoteNo || '').trim()
        if (!no || cancelled) return
        setMeta(prev => ({ ...prev, shippingNoteNo: no }))
        message.success(`发货单号生成成功: ${no}`)
      } catch (error) {
        console.error('[发货单号生成] 失败详情:', error)
        console.error('[发货单号生成] 错误消息:', error?.message)
        console.error('[发货单号生成] 错误响应:', error?.response)
        if (!cancelled) {
          const errorMsg = error?.response?.data?.message || error?.message || '生成发货单号失败'
          message.error(`生成发货单号失败: ${errorMsg}`)
        }
      }
    }
    run()
    return () => { cancelled = true }
  }, [meta?.shipDate, meta?.shippingNoteNo])

  useEffect(() => {
    const preset = COMPANY_PRESETS.find(c => c.key === selectedCompany)
    if (!preset) return
    setMeta(prev => ({
      ...prev,
      companyName: preset.name,
      companyAddress: preset.address,
      companyPhone: preset.phone,
      maker: preset.maker || prev.maker,
      salesman: preset.salesman || prev.salesman
    }))
  }, [selectedCompany])

  const columns = useMemo(() => {
    const isWithAmount = selectedTemplate === 'withAmount'
    const base = []
    if (columnConfig.goodsName) {
      base.push({
        title: '商品名称',
        dataIndex: 'name',
        key: 'name',
        width: 200,
        render: (t, r, idx) => (
          <Input size="small" value={t} onChange={e => onCellChange(idx, 'name', e.target.value)} />
        )
      })
    }
    if (columnConfig.productName) {
      base.push({
        title: '产品名称',
        dataIndex: 'productName',
        key: 'productName',
        width: 200,
        render: (t, r, idx) => (
          <Input size="small" value={t} onChange={e => onCellChange(idx, 'productName', e.target.value)} />
        )
      })
    }
    if (columnConfig.spec) {
      base.push({
        title: '规格尺寸（长*宽*高）/mm',
        dataIndex: 'spec',
        key: 'spec',
        width: 230,
        render: (t, r, idx) => (
          <Input size="small" value={t} onChange={e => onCellChange(idx, 'spec', e.target.value)} />
        )
      })
    }
    base.push(
      {
        title: '数量',
        dataIndex: 'qty',
        key: 'qty',
        width: isWithAmount ? 110 : 90,
        render: (t, r, idx) => {
          const qty = Number(t || 0)
          const isEmptyRow =
            (!r.name && !r.productName && !r.spec && !r.materialNo && !r.remark) &&
            (!qty || Number.isNaN(qty))
          return (
            <Input
              size="small"
              type="number"
              value={isEmptyRow ? '' : qty}
              onChange={e => onCellChange(idx, 'qty', Number(e.target.value || 0))}
            />
          )
        }
      },
      {
        title: '单位',
        dataIndex: 'unit',
        key: 'unit',
        width: 80,
        render: (t, r, idx) => {
          const qty = Number(r?.qty || 0)
          const isEmptyRow =
            (!r.name && !r.productName && !r.spec && !r.materialNo && !r.remark) &&
            (!qty || Number.isNaN(qty))
          return (
            <Input
              size="small"
              value={isEmptyRow ? '' : t}
              onChange={e => onCellChange(idx, 'unit', e.target.value)}
            />
          )
        }
      }
    )
    if (columnConfig.unitPrice) {
      base.push({
        title: '单价',
        dataIndex: 'unitPrice',
        key: 'unitPrice',
        width: 100,
        render: (t, r, idx) => (
          <Input
            size="small"
            type="number"
            value={t}
            onChange={e => onCellChange(idx, 'unitPrice', e.target.value)}
          />
        )
      })
    }
    if (columnConfig.amount) {
      base.push({
        title: '金额',
        dataIndex: 'amount',
        key: 'amount',
        width: isWithAmount ? 100 : 120,
        render: (t) => {
          const v = Number(t || 0)
          return Number.isFinite(v) && v !== 0 ? v.toFixed(2) : ''
        }
      })
    }
    if (columnConfig.materialNo) {
      base.push({
        title: '物料号',
        dataIndex: 'materialNo',
        key: 'materialNo',
        width: 160,
        render: (t, r, idx) => (
          <Input size="small" value={t} onChange={e => onCellChange(idx, 'materialNo', e.target.value)} />
        )
      })
    }
    if (columnConfig.remark) {
      base.push({
        title: '备注',
        dataIndex: 'remark',
        key: 'remark',
        width: 180,
        render: (t, r, idx) => (
          <Input size="small" value={t} onChange={e => onCellChange(idx, 'remark', e.target.value)} />
        )
      })
    }
    return base
  }, [columnConfig, selectedTemplate])

  const onCellChange = (index, field, value) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== index) return it
      const next = { ...it }
      if (field === 'qty') {
        const qty = Number(value || 0)
        next.qty = qty
        const p = Number(next.unitPrice || 0)
        if (Number.isFinite(qty) && Number.isFinite(p)) {
          const amt = qty * p
          next.amount = Number.isFinite(amt) ? Number(amt.toFixed(2)) : 0
        }
        return next
      }
      if (field === 'unitPrice') {
        const unitPrice = Number(value || 0)
        next.unitPrice = unitPrice
        const qty = Number(next.qty || 0)
        if (Number.isFinite(qty) && Number.isFinite(unitPrice)) {
          const amt = qty * unitPrice
          next.amount = Number.isFinite(amt) ? Number(amt.toFixed(2)) : 0
        }
        return next
      }
      next[field] = value
      return next
    }))
  }

  const onPrint = async () => {
    try {
      const page = document.getElementById('shipping-print-page')
      if (!page) {
        window.print()
        return
      }

      const shippingNoteNo = (meta.shippingNoteNo || '').trim()
      const draft = {
        version: 1,
        updatedAt: new Date().toISOString(),
        selectedCompany,
        selectedTemplate,
        columnConfig,
        paperSize,
        orientation,
        marginTop,
        marginRight,
        marginBottom,
        marginLeft,
        printScale,
        meta,
        items
      }
      const tasks = []
      const seenOrderIds = new Set()
      rows.forEach(r => {
        const orderId = r?.orderId
        if (!orderId) return
        const idKey = String(orderId)
        if (!idKey || seenOrderIds.has(idKey)) return
        seenOrderIds.add(idKey)
        const baseNote = r.shippingNote && typeof r.shippingNote === 'object'
          ? r.shippingNote
          : {}
        const nextNote = {
          ...baseNote,
          shippingNoteNo,
          address: meta.address,
          customerName: meta.customerName,
          shipDate: meta.shipDate,
          receiver: meta.receiver,
          companyName: meta.companyName,
          companyAddress: meta.companyAddress,
          companyPhone: meta.companyPhone,
          maker: meta.maker,
          salesman: meta.salesman,
          draft
        }
        tasks.push(orderAPI.updateOrder(orderId, { shippingNote: nextNote }))
      })
      if (tasks.length) {
        try {
          await Promise.all(tasks)
        } catch (_) {
          message.error('自动保存失败')
        }
      }

      let widthMm = 215
      let heightMm = 140
      if (paperSize === 'A4') {
        if (orientation === 'portrait') {
          widthMm = 210
          heightMm = 297
        } else {
          widthMm = 297
          heightMm = 210
        }
      } else if (paperSize === 'A5') {
        if (orientation === 'portrait') {
          widthMm = 148
          heightMm = 210
        } else {
          widthMm = 210
          heightMm = 148
        }
      } else {
        widthMm = 215
        heightMm = 140
      }

      const safeMargin = (v) => {
        if (!Number.isFinite(v)) return 0
        return Math.max(0, v)
      }

      const mt = safeMargin(marginTop)
      const mr = safeMargin(marginRight)
      const mb = safeMargin(marginBottom)
      const ml = safeMargin(marginLeft)

      const rawScale =
        Number.isFinite(printScale) && printScale > 0 ? printScale / 100 : 1
      const scale = rawScale > 0 ? rawScale : 1

      const contentWidthMm = Math.max(widthMm - ml - mr, 10)

      const isWithAmount = selectedTemplate === 'withAmount'

      const printColumns = []
      if (columnConfig.goodsName) printColumns.push({ key: 'name', title: '商品名称', width: 200 })
      if (columnConfig.productName) printColumns.push({ key: 'productName', title: '产品名称', width: 200 })
      if (columnConfig.spec) printColumns.push({ key: 'spec', title: '规格尺寸（长*宽*高）/mm', width: 230 })
      printColumns.push({ key: 'qty', title: '数量', width: isWithAmount ? 110 : 90 })
      printColumns.push({ key: 'unit', title: '单位', width: 80 })
      if (columnConfig.unitPrice) printColumns.push({ key: 'unitPrice', title: '单价', width: 100 })
      if (columnConfig.amount) printColumns.push({ key: 'amount', title: '金额', width: isWithAmount ? 100 : 120 })
      if (columnConfig.materialNo) printColumns.push({ key: 'materialNo', title: '物料号', width: 160 })
      if (columnConfig.remark) printColumns.push({ key: 'remark', title: '备注', width: 180 })

      const baseSum = printColumns.reduce((s, c) => s + (c.width || 0), 0) || 1
      const colPercents = new Array(printColumns.length).fill(0)
      let remain = 100
      for (let i = 0; i < printColumns.length; i += 1) {
        if (i === printColumns.length - 1) {
          colPercents[i] = remain
        } else {
          const pct = Math.round((printColumns[i].width / baseSum) * 1000) / 10
          const safePct = Math.max(5, Math.min(60, pct))
          colPercents[i] = safePct
          remain -= safePct
        }
      }

      const rowsForPrint = isWithAmount ? items : [...items, {
        key: 'extra_blank',
        name: '',
        productName: '',
        spec: '',
        qty: '',
        unit: '',
        unitPrice: '',
        amount: '',
        materialNo: '',
        remark: ''
      }]

      const theadHtml = `
        <tr>
          ${printColumns.map((c, i) => `<th style="width:${colPercents[i]}%">${c.title}</th>`).join('')}
        </tr>
      `

      const tbodyHtml = rowsForPrint.map(it => {
        const qty = Number(it.qty || 0)
        const isEmptyRow =
          (!it.name && !it.productName && !it.spec && !it.materialNo && !it.remark) &&
          (!qty || Number.isNaN(qty))
        const cells = printColumns.map(c => {
          let v = it[c.key]
          if (c.key === 'amount') {
            const num = Number(v || 0)
            v = Number.isFinite(num) && num !== 0 ? num.toFixed(2) : ''
          } else if (c.key === 'qty') {
            v = isEmptyRow ? '' : (Number(it.qty || 0) || '')
          } else if (c.key === 'unit') {
            v = isEmptyRow ? '' : (it.unit || '')
          } else {
            v = v || ''
          }
          const cls = c.key === 'amount' ? 'amount-cell' : ''
          return `<td class="${cls}">${v}</td>`
        }).join('')
        return `<tr>${cells}</tr>`
      }).join('')

      const numericTotal = isWithAmount
        ? rowsForPrint.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
        : 0
      const displayNumeric = isWithAmount && Number.isFinite(numericTotal) ? numericTotal.toFixed(2) : ''
      const upper = isWithAmount ? toChineseUppercase(numericTotal) : ''
      const summaryHtml = isWithAmount ? `
        <tr>
          <td colspan="${printColumns.length}">
            <div style="display:flex;justify-content:space-between;align-items:center;">
              <div style="display:flex;align-items:center;gap:6px;">
                <span>合计金额（大写）</span>
                <span style="display:inline-block;border-bottom:1px dashed #999;min-width:220px;padding:0 4px;font-size:13px;">${upper}</span>
              </div>
              <div style="display:flex;align-items:center;gap:6px;">
                <span>金额：</span>
                <span style="display:inline-block;border-bottom:1px dashed #999;min-width:160px;padding:0 4px;text-align:left;font-size:13px;">${displayNumeric}</span>
              </div>
            </div>
          </td>
        </tr>
      ` : ''

      const html = `
        <div class="print-card">
          <div class="company">
            <div class="name">${meta.companyName || ''}</div>
            <div class="sub">
              <span>地址：${meta.companyAddress || ''}</span>
              <span style="margin-left:28px;">电话：${meta.companyPhone || ''}</span>
            </div>
          </div>
          <div class="header-row">
            <div class="left">
              <span class="label">客户名称：</span>
              <span class="value">${meta.customerName || ''}</span>
            </div>
            <div class="title">发货单</div>
            <div class="right">
              <div style="display:flex;align-items:center;">
                <span class="label">发货日期：</span>
                <span class="value">${meta.shipDate || ''}</span>
              </div>
            </div>
          </div>
          <div class="meta">
            <div class="row" style="display:flex;align-items:center;justify-content:space-between;">
              <div style="display:flex;align-items:center;">
                <span class="label">客户地址：</span>
                <span class="value" style="min-width:260px;">${meta.address || ''}</span>
              </div>
              <div style="display:flex;align-items:center;">
                <span class="label">发货单号：</span>
                <span class="value" style="min-width:140px;">${meta.shippingNoteNo || ''}</span>
              </div>
            </div>
          </div>
          <table class="print-table">
            <thead>${theadHtml}</thead>
            <tbody>${tbodyHtml}</tbody>
            <tfoot>${summaryHtml}</tfoot>
          </table>
          <div class="footer-meta">
            <div class="group"><span class="label">制单人：</span><span class="value">${meta.maker || ''}</span></div>
            <div class="group"><span class="label">业务员：</span><span class="value">${meta.salesman || ''}</span></div>
            <div class="group receiver"><span class="label">收货人：</span><span class="value">${meta.receiver || ''}</span></div>
          </div>
        </div>
      `
      const w = window.open('', '_blank')
      if (!w) {
        window.print()
        return
      }

      const orientationCss = orientation === 'landscape' ? 'landscape' : 'portrait'
      const pageSizeCss = `@page { size: ${widthMm}mm ${heightMm}mm ${orientationCss}; margin: 0; }`

      w.document.write(`
        <html>
          <head>
            <meta charSet="utf-8" />
            <title>发货单打印</title>
            <style>
              ${pageSizeCss}
              html, body {
                margin: 0;
                padding: 0;
                height: 100%;
              }
              body {
                font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
                background: #ffffff;
                margin: 0;
              }
              .page {
                width: ${widthMm}mm;
                min-height: ${heightMm}mm;
                box-sizing: border-box;
                padding: ${mt}mm ${mr}mm ${mb}mm ${ml}mm;
                margin: 0 auto;
              }
              .preview-card, .print-card {
                width: ${contentWidthMm}mm;
                box-sizing: border-box;
                padding: 0 4mm 2mm;
                margin-top: 0;
                box-shadow: none;
                border: none;
                transform: scale(${scale});
                transform-origin: top left;
              }
              .company { text-align: center; margin: -1mm 0 2mm; }
              .company .name { font-size: 24px; }
              .company .sub { display: flex; justify-content: center; gap: 16px; margin-top: 2px; }
              .title { text-align: center; font-size: 20px; margin: 2px 0; }
              .header-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
              .header-row .label { width: 72px; color: #000; white-space: nowrap; }
              .header-row .value { display:inline-block; min-width: 120px; border-bottom: 1px dashed #999; padding: 0 4px; }
              .meta .row { display: flex; gap: 4px; align-items: center; margin-bottom: 3px; }
              .meta .label { width: 72px; color: #000; white-space: nowrap; }
              .meta .value { display:inline-block; min-width: 240px; border-bottom: 1px dashed #999; padding: 0 4px; white-space: nowrap; }
              .print-table { width: 100%; border-collapse: collapse; table-layout: fixed; }
              .print-table th, .print-table td {
                border: 1px solid #000;
                padding: 2px 4px;
                font-size: 15px;
                line-height: 1.2;
                height: 30px;
                vertical-align: middle;
                text-align: center;
              }
              .print-table td.amount-cell {
                font-size: 16px;
              }
              .print-table th { background: #fff; font-weight: 600; }
              .footer-meta { display: flex; justify-content: flex-start; gap: 120px; margin-top: 8px; }
              .footer-meta .group { display: flex; align-items: center; gap: 12px; white-space: nowrap; }
              .footer-meta .group.receiver { margin-left: 12px; }
              .footer-meta .label { width: 52px; color: #000; }
              .footer-meta .value { display: inline-block; min-width: 40px; }
              .title { text-align: center; font-size: 20px; margin-bottom: 0; }
              .header-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
              .header-left, .header-right { display: flex; align-items: center; gap: 4px; }
              .header-left .label, .header-right .label { width: 72px; color: #000; }
              .meta { display: grid; grid-template-columns: 1fr; gap: 2px; margin-bottom: 4px; }
              .meta .row { display: flex; gap: 4px; align-items: center; }
              .meta .label { width: 72px; color: #000; white-space: nowrap; }
              .footer-meta { display: flex; justify-content: flex-start; gap: 120px; margin-top: 8px; }
              .footer-meta .group { display: flex; align-items: center; gap: 12px; white-space: nowrap; }
              .footer-meta .group.receiver { margin-left: 12px; }
              .footer-meta .label { width: 52px; color: #000; }
              .company { text-align: center; margin: -2mm 0 1px; }
              .company .label { display: none; }
              .company .sub { display: flex; justify-content: center; gap: 4px; margin-top: 1px; }
              .excel-table .ant-table {
                border: 1px solid #000;
              }
              .excel-table .ant-table,
              .excel-table .ant-table-container,
              .excel-table .ant-table-content,
              .excel-table table {
                width: 100% !important;
                table-layout: fixed;
              }
              .excel-table .ant-table-thead > tr > th { border: 1px solid #000; background: transparent; padding: 0 3px; font-size: 11px; }
              .excel-table .ant-table-tbody > tr > td { border: 1px solid #000; padding: 0 3px; font-size: 11px; }
              .excel-table .ant-table-summary > tr > td { border: 1px solid #000; padding: 0 3px; font-size: 11px; }
              .preview-card input,
              .preview-card .ant-input,
              .preview-card .ant-input-affix-wrapper,
              .preview-card .ant-input-textarea {
                border: none !important;
                box-shadow: none !important;
                outline: none !important;
                background: transparent !important;
              }
              @media print {
                body {
                  background: #ffffff;
                }
              }
            </style>
          </head>
          <body>
            <div class="page">${html}</div>
            <script>
              window.onload = function () {
                window.print();
                window.close();
              };
            </script>
          </body>
        </html>
      `)
      w.document.close()
    } catch (e) {
      message.error('打印失败')
    }
  }

  const onExportExcel = () => {
    try {
      const wb = XLSX.utils.book_new()
      const sheetData = []

      const colWidths = []

      const pushColWidth = (wch) => {
        colWidths.push({ wch })
      }

      sheetData.push([meta.companyName || ''])
      sheetData.push([
        `地址：${meta.companyAddress || ''}`,
        `电话：${meta.companyPhone || ''}`
      ])
      sheetData.push([
        `客户名称：${meta.customerName || ''}`,
        `发货日期：${meta.shipDate || ''}`,
        `发货单号：${meta.shippingNoteNo || ''}`
      ])
      sheetData.push([`客户地址：${meta.address || ''}`])
      sheetData.push([])

      const isWithAmount = selectedTemplate === 'withAmount'
      const headers = ['序号']
      pushColWidth(6)
      if (columnConfig.goodsName) headers.push('商品名称')
      if (columnConfig.productName) headers.push('产品名称')
      if (columnConfig.spec) headers.push('规格尺寸（长*宽*高）/mm')
      headers.push('数量')
      headers.push('单位')
      if (columnConfig.unitPrice) headers.push('单价')
      if (columnConfig.amount) headers.push('金额')
      if (columnConfig.materialNo) headers.push('物料号')
      if (columnConfig.remark) headers.push('备注')

      sheetData.push(headers)

      const exportItems = items.filter(it =>
        it.name ||
        it.productName ||
        it.spec ||
        it.qty ||
        it.unit ||
        it.amount ||
        it.materialNo ||
        it.remark
      )

      exportItems.forEach((it, index) => {
        const row = []
        row.push(index + 1)
        if (columnConfig.goodsName) row.push(it.name || '')
        if (columnConfig.productName) row.push(it.productName || '')
        if (columnConfig.spec) row.push(it.spec || '')
        row.push(it.qty || '')
        row.push(it.unit || '')
        if (columnConfig.unitPrice) row.push(it.unitPrice || '')
        if (columnConfig.amount) {
          const v = Number(it.amount || 0)
          row.push(Number.isFinite(v) && v !== 0 ? v.toFixed(2) : '')
        }
        if (columnConfig.materialNo) row.push(it.materialNo || '')
        if (columnConfig.remark) row.push(it.remark || '')
        sheetData.push(row)
      })

      if (isWithAmount) {
        const total = exportItems.reduce(
          (sum, it) => sum + (Number(it.amount) || 0),
          0
        )
        const upper = toChineseUppercase(total)
        sheetData.push([])
        sheetData.push([
          `合计金额（大写）：${upper}`,
          `金额：${Number.isFinite(total) ? total.toFixed(2) : ''}`
        ])
      }

      const ws = XLSX.utils.aoa_to_sheet(sheetData)

      const totalCols = headers.length

      ws['!merges'] = ws['!merges'] || []
      ws['!merges'].push(
        { s: { r: 0, c: 0 }, e: { r: 0, c: totalCols - 1 } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: totalCols - 1 } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: totalCols - 2 } },
        { s: { r: 2, c: totalCols - 1 }, e: { r: 2, c: totalCols - 1 } },
        { s: { r: 3, c: 0 }, e: { r: 3, c: totalCols - 1 } }
      )

      const colDefs = []
      for (let i = 0; i < headers.length; i += 1) {
        if (i === 0) {
          colDefs.push({ wch: 6 })
          continue
        }
        const title = headers[i]
        if (title === '商品名称') colDefs.push({ wch: 24 })
        else if (title === '产品名称') colDefs.push({ wch: 24 })
        else if (title === '规格尺寸（长*宽*高）/mm') colDefs.push({ wch: 28 })
        else if (title === '数量') colDefs.push({ wch: isWithAmount ? 10 : 8 })
        else if (title === '单位') colDefs.push({ wch: 8 })
        else if (title === '单价') colDefs.push({ wch: 10 })
        else if (title === '金额') colDefs.push({ wch: 12 })
        else if (title === '物料号') colDefs.push({ wch: 18 })
        else if (title === '备注') colDefs.push({ wch: 20 })
        else colDefs.push({ wch: 10 })
      }
      ws['!cols'] = colDefs

      const titleCell = ws['A1']
      if (titleCell) {
        titleCell.s = {
          font: { sz: 16, bold: true },
          alignment: { horizontal: 'center', vertical: 'center' }
        }
      }

      const headerRowIndex = 5
      for (let c = 0; c < headers.length; c += 1) {
        const cellRef = XLSX.utils.encode_cell({ r: headerRowIndex, c })
        const cell = ws[cellRef]
        if (cell) {
          cell.s = {
            font: { bold: true },
            alignment: { horizontal: 'center', vertical: 'center' },
            border: {
              top: { style: 'thin', color: { rgb: '000000' } },
              bottom: { style: 'thin', color: { rgb: '000000' } },
              left: { style: 'thin', color: { rgb: '000000' } },
              right: { style: 'thin', color: { rgb: '000000' } }
            }
          }
        }
      }

      ws['!rows'] = ws['!rows'] || []
      ws['!rows'][0] = { hpt: 28 }
      ws['!rows'][1] = { hpt: 18 }
      ws['!rows'][2] = { hpt: 18 }
      ws['!rows'][3] = { hpt: 18 }

      ws['!margins'] = {
        left: 0.3,
        right: 0.3,
        top: 0.4,
        bottom: 0.4,
        header: 0.2,
        footer: 0.2
      }
      ws['!pageSetup'] = {
        orientation: 'landscape',
        fitToWidth: 1,
        fitToHeight: 0
      }

      XLSX.utils.book_append_sheet(wb, ws, '发货单')
      const fileName = `发货单-${meta.customerName || ''}-${dayjs().format('YYYYMMDDHHmmss')}.xlsx`
      XLSX.writeFile(wb, fileName)
    } catch (e) {
      message.error('导出失败')
    }
  }

  const printStyles = useMemo(() => {
    let widthMm = 215
    let heightMm = 140
    if (paperSize === 'A4') {
      if (orientation === 'portrait') {
        widthMm = 210
        heightMm = 297
      } else {
        widthMm = 297
        heightMm = 210
      }
    } else if (paperSize === 'A5') {
      if (orientation === 'portrait') {
        widthMm = 148
        heightMm = 210
      } else {
        widthMm = 210
        heightMm = 148
      }
    } else {
      widthMm = 215
      heightMm = 140
    }

    const safeMargin = (v) => {
      if (!Number.isFinite(v)) return 0
      return Math.max(0, v)
    }

    const mt = safeMargin(marginTop)
    const mr = safeMargin(marginRight)
    const mb = safeMargin(marginBottom)
    const ml = safeMargin(marginLeft)

    const visualScale =
      Number.isFinite(printScale) && printScale > 0 ? printScale / 100 : 1

    const printScaleValue = 1

    const contentWidthMm = Math.max(widthMm - ml - mr, 10)
    const contentHeightMm = Math.max(heightMm - mt - mb, 10)

    const orientationCss = orientation === 'landscape' ? 'landscape' : 'portrait'
    const pageCss = `
        @page { size: ${widthMm}mm ${heightMm}mm ${orientationCss}; margin: 0; }
        @media print {
          html,
          body {
            margin: 0;
            padding: 0;
          }
      `

    return `
        ${pageCss}
          body * {
            visibility: hidden;
          }
          .shipping-print-root,
          .shipping-print-root * {
            visibility: visible;
          }
          .shipping-print-root {
            width: ${widthMm}mm;
            margin: 0;
          }
          .toolbar { display: none !important; }
          .preview-card { box-shadow: none; border: none; margin-top: -6mm; }
          .page {
            width: ${widthMm}mm;
            margin: 0;
            padding: ${mt}mm ${mr}mm ${mb}mm ${ml}mm;
            display: flex;
            justify-content: center;
            align-items: flex-start;
            page-break-inside: avoid;
          }
          .preview-card {
            page-break-inside: avoid;
            height: auto !important;
            transform: scale(${printScaleValue});
            transform-origin: top left;
          }
          .action-bar { display: none !important; }
          .preview-card .ant-input,
          .preview-card .ant-input-affix-wrapper,
          .preview-card .ant-input-textarea {
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
          }
        }
        @media screen {
          .toolbar { padding: 1px; background: #fff; border-bottom: 1px solid #eee; margin-bottom: 8px; }
          .page { display: flex; justify-content: center; padding: 0; }
          .preview-card {
            width: ${contentWidthMm}mm;
            min-height: ${contentHeightMm}mm;
            height: auto;
            margin: 0 auto;
            box-sizing: border-box;
            padding: 0 4mm 2mm;
            transform: scale(${visualScale});
            transform-origin: top left;
          }
          .title { text-align: center; font-size: 20px; margin-bottom: 0; }
          .header-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 2px; }
          .header-left, .header-right { display: flex; align-items: center; gap: 4px; }
          .header-left .label, .header-right .label { width: 72px; color: #000; white-space: nowrap; }
          .meta { display: grid; grid-template-columns: 1fr; gap: 2px; margin-bottom: 4px; }
          .meta .row { display: flex; gap: 4px; align-items: center; }
          .meta .label { width: 72px; color: #000; }
          .footer-meta { display: flex; justify-content: flex-start; gap: 80px; margin-top: 4px; }
          .footer-meta .group { display: flex; align-items: center; gap: 8px; white-space: nowrap; }
          .footer-meta .group.receiver { margin-left: 4px; }
          .footer-meta .label { width: 52px; color: #000; }
          .company { text-align: center; margin: -2mm 0 1px; }
          .company .label { display: none; }
          .company .sub { display: flex; justify-content: center; gap: 4px; margin-top: 1px; }
          .excel-table .ant-table { border: 1px solid #000; }
          .excel-table .ant-table-thead > tr > th {
            border: 1px solid #000 !important;
            background: transparent;
            padding: 4px 2px !important;
            font-size: 11px;
            text-align: center;
            line-height: 1.5;
            height: 28px !important;
          }
          .excel-table .ant-table-tbody > tr > td {
            border: 1px solid #000 !important;
            padding: 4px 2px !important;
            font-size: 11px;
            text-align: center;
            line-height: 1.5;
            height: 30px !important;
          }
          .excel-table .ant-table-summary > tr > td {
            border: 1px solid #000 !important;
            padding: 4px 2px !important;
            font-size: 11px;
            text-align: center;
            line-height: 1.5;
            height: 30px !important;
          }
          .excel-table .ant-input {
            text-align: center;
          }
          .preview-card .ant-input {
            font-size: 12px;
            padding-top: 0 !important;
            padding-bottom: 0 !important;
            height: 22px !important;
          }
          .preview-card .company-name-input {
            font-size: 20px !important;
            text-align: center !important;
            height: auto !important;
          }
        }
    `
  }, [paperSize, orientation, marginTop, marginRight, marginBottom, marginLeft, printScale])

  return (
    <div className="shipping-print-root" style={{ padding: 0 }}>
      <style>
        {printStyles}
      </style>

      <div className="toolbar">
        <Space direction="vertical" size={8}>
          <Space size={8} wrap>
            <Button type="primary" onClick={onPrint}>打印</Button>

            <Button onClick={() => navigate('/shipping')}>返回发货管理</Button>
            <Select
              size="small"
              placeholder="选择公司抬头"
              style={{ width: 220 }}
              value={selectedCompany}
              options={COMPANY_PRESETS.map(c => ({ value: c.key, label: c.name }))}
              onChange={v => setSelectedCompany(v)}
            />
            <Select
              size="small"
              placeholder="选择模板"
              style={{ width: 160 }}
              value={selectedTemplate}
              options={[
                { value: 'withAmount', label: '显示金额' },
                { value: 'withoutAmount', label: '不显示金额' },
                { value: 'jintianTools', label: '金田工具' },
                { value: 'purchasedGoods', label: '外购商品' }
              ]}
              onChange={v => {
                setSelectedTemplate(v)
                const cfg = TEMPLATE_CONFIGS[v]
                if (cfg) {
                  setColumnConfig(cfg)
                }
              }}
            />
          </Space>
          <Space size={8}>
            <Checkbox
              checked={columnConfig.productName}
              onChange={e => setColumnConfig({ ...columnConfig, productName: e.target.checked })}
            >
              产品名称
            </Checkbox>
            <Checkbox
              checked={columnConfig.goodsName}
              onChange={e => setColumnConfig({ ...columnConfig, goodsName: e.target.checked })}
            >
              商品名称
            </Checkbox>
            <Checkbox
              checked={columnConfig.spec}
              onChange={e => setColumnConfig({ ...columnConfig, spec: e.target.checked })}
            >
              规格尺寸
            </Checkbox>
            <Checkbox
              checked={columnConfig.unitPrice}
              onChange={e => setColumnConfig({ ...columnConfig, unitPrice: e.target.checked })}
            >
              单价
            </Checkbox>
            <Checkbox
              checked={columnConfig.amount}
              onChange={e => setColumnConfig({ ...columnConfig, amount: e.target.checked })}
            >
              金额
            </Checkbox>
            <Checkbox
              checked={columnConfig.materialNo}
              onChange={e => setColumnConfig({ ...columnConfig, materialNo: e.target.checked })}
            >
              物料号
            </Checkbox>
            <Checkbox
              checked={columnConfig.remark}
              onChange={e => setColumnConfig({ ...columnConfig, remark: e.target.checked })}
            >
              备注
            </Checkbox>
          </Space>
          <Space size={8}>
            <span>纸张：</span>
            <Select
              size="small"
              style={{ width: 140 }}
              value={paperSize}
              options={[
                { value: 'custom', label: '自定义(215×140)' },
                { value: 'A4', label: 'A4' },
                { value: 'A5', label: 'A5' }
              ]}
              onChange={v => setPaperSize(v)}
            />
            <span>方向：</span>
            <Select
              size="small"
              style={{ width: 110 }}
              value={orientation}
              options={[
                { value: 'landscape', label: '横向' },
                { value: 'portrait', label: '纵向' }
              ]}
              onChange={v => setOrientation(v)}
            />
            <span>缩放%：</span>
            <Input
              size="small"
              type="number"
              style={{ width: 90 }}
              value={printScale}
              onChange={e =>
                setPrintScale(e.target.value === '' ? 100 : Number(e.target.value))
              }
            />
            <span>边距mm：</span>
            <span>上</span>
            <Input
              size="small"
              type="number"
              style={{ width: 70 }}
              value={marginTop}
              onChange={e => setMarginTop(Number(e.target.value || 0))}
            />
            <span>右</span>
            <Input
              size="small"
              type="number"
              style={{ width: 70 }}
              value={marginRight}
              onChange={e => setMarginRight(Number(e.target.value || 0))}
            />
            <span>下</span>
            <Input
              size="small"
              type="number"
              style={{ width: 70 }}
              value={marginBottom}
              onChange={e => setMarginBottom(Number(e.target.value || 0))}
            />
            <span>左</span>
            <Input
              size="small"
              type="number"
              style={{ width: 70 }}
              value={marginLeft}
              onChange={e => setMarginLeft(Number(e.target.value || 0))}
            />
          </Space>

        </Space>
      </div>

      <div className="page" id="shipping-print-page">
        <Card className="preview-card">
          <div className="company">
            <Input
              placeholder="公司名"
              autoComplete="off"
              value={meta.companyName}
              onChange={e => setMeta({ ...meta, companyName: e.target.value })}
              className="company-name-input"
              style={{ textAlign: 'center' }}
            />
            <div className="sub">
              <span>地址：</span>
              <Input
                size="small"
                placeholder="公司地址"
                autoComplete="off"
                value={meta.companyAddress}
                onChange={e => setMeta({ ...meta, companyAddress: e.target.value })}
                style={{ width: 240 }}
              />
              <span>电话：</span>
              <Input
                size="small"
                placeholder="公司电话"
                autoComplete="off"
                value={meta.companyPhone}
                onChange={e => setMeta({ ...meta, companyPhone: e.target.value })}
                style={{ width: 160 }}
              />
            </div>
          </div>
          <div className="header-row">
            <div className="header-left">
              <div className="label">客户名称：</div>
              <Input size="small" value={meta.customerName} onChange={e => setMeta({ ...meta, customerName: e.target.value })} style={{ width: 170 }} />
            </div>
            <div className="title">发货单</div>
            <div className="header-right">
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div className="label">发货日期：</div>
                <Input
                  size="small"
                  value={meta.shipDate}
                  onChange={e => setMeta({ ...meta, shipDate: e.target.value })}
                  style={{ width: 170 }}
                />
              </div>
            </div>
          </div>
          <div className="meta">
            <div
              className="row"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}
            >
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div className="label">客户地址：</div>
                <Input
                  size="small"
                  value={meta.address}
                  onChange={e => setMeta({ ...meta, address: e.target.value })}
                  style={{ width: 240 }}
                />
              </div>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <div className="label">发货单号：</div>
                <Input
                  size="small"
                  value={meta.shippingNoteNo}
                  onChange={e => setMeta({ ...meta, shippingNoteNo: e.target.value })}
                  style={{ width: 170 }}
                />
              </div>
            </div>
          </div>

          <div className="excel-table" style={{ marginTop: 8 }}>
            <Table
              rowKey="key"
              dataSource={(selectedTemplate === 'withAmount' || selectedTemplate === 'purchasedGoods')
                ? items
                : [...items, {
                  key: 'extra_blank',
                  name: '',
                  productName: '',
                  spec: '',
                  qty: '',
                  unit: '',
                  unitPrice: '',
                  amount: '',
                  materialNo: '',
                  remark: ''
                }]}
              columns={columns}
              pagination={false}
              size="small"
              summary={pageData => {
                if (!(selectedTemplate === 'withAmount' || selectedTemplate === 'purchasedGoods')) return null
                const totalCols = columns.length
                if (!totalCols) return null
                const numericTotal = pageData.reduce((sum, row) => sum + (Number(row.amount) || 0), 0)
                const displayNumeric = Number.isFinite(numericTotal) ? numericTotal.toFixed(2) : ''
                const upper = toChineseUppercase(numericTotal)
                return (
                  <Table.Summary>
                    <Table.Summary.Row>
                      <Table.Summary.Cell index={0} colSpan={totalCols}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ whiteSpace: 'nowrap' }}>合计金额（大写）</span>
                            <Input
                              size="small"
                              value={upper}
                              readOnly
                              style={{ width: 200 }}
                            />
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                            <span style={{ whiteSpace: 'nowrap' }}>金额：</span>
                            <Input
                              size="small"
                              value={displayNumeric}
                              readOnly
                              style={{ width: 160 }}
                            />
                          </div>
                        </div>
                      </Table.Summary.Cell>
                    </Table.Summary.Row>
                  </Table.Summary>
                )
              }}
            />
          </div>
          <div className="footer-meta">
            <div className="group">
              <div className="label">制单人：</div>
              <Input
                size="small"
                value={meta.maker}
                onChange={e => setMeta({ ...meta, maker: e.target.value })}
                style={{ width: 120 }}
              />
            </div>
            <div className="group">
              <div className="label">业务员：</div>
              <Input
                size="small"
                value={meta.salesman}
                onChange={e => setMeta({ ...meta, salesman: e.target.value })}
                style={{ width: 120 }}
              />
            </div>
            <div className="group receiver">
              <div className="label">收货人：</div>
              <Input
                size="small"
                value={meta.receiver}
                onChange={e => setMeta({ ...meta, receiver: e.target.value })}
                style={{ width: 120 }}
              />
            </div>
          </div>
        </Card>
      </div>
    </div>
  )
}

export default ShippingPrintPreview
