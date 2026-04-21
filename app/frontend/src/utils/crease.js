export const parseCreaseText = (val) => {
  const s = String(val ?? '').trim()
  if (!s) return { spec: '', type: '' }
  const nums = (s.match(/\d+(?:\.\d+)?/g) || []).map((n) => Number(n)).filter((n) => Number.isFinite(n))
  const spec = nums.length ? nums.join('-') : ''
  const m = s.match(/[（(]([^（）()]+)[）)]/)
  const typeInParen = m ? String(m[1] || '').trim() : ''
  let type = typeInParen || (!spec ? s : '')
  if (!type && spec && /[A-Za-z\u4e00-\u9fff]/.test(s)) {
    const rest = s
      .replace(/[（(][^（）()]+[）)]/g, '')
      .replace(/\d+(?:\.\d+)?/g, '')
      .replace(/mm\b/gi, '')
      .replace(/[x×*]/g, '')
      .replace(/[-\s]/g, '')
      .trim()
    if (rest) type = rest
  }
  return { spec, type }
}

export const calcCreaseFromSku = (sku) => {
  const s0 = (sku && typeof sku === 'object') ? sku : null
  if (!s0) return { spec: '', type: '' }
  const finalize = (spec, type) => {
    const specOut = String(spec ?? '').trim()
    let typeOut = String(type ?? '').trim()
    if (!typeOut && specOut && /\d/.test(specOut)) typeOut = '凹凸压线'
    return { spec: specOut, type: typeOut }
  }
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
  const pickNum = (...vals) => {
    for (const v of vals) {
      const n = Number(v)
      if (Number.isFinite(n) && n !== 0) return n
    }
    return 0
  }

  const directType = pickText(
    s0?.creaseType,
    s0?.creasingType,
    s0?.creasing_type,
    s0?.crease_type,
    s0?.pressLineType,
    s0?.press_line_type
  )

  const directText = pickText(
    s0?.pressLine,
    s0?.press_line,
    s0?.pressLineSize,
    s0?.press_line_size,
    s0?.creasingSize,
    s0?.creaseSize,
    s0?.creasing_size,
    s0?.crease_size,
    s0?.creaseText,
    s0?.crease_text,
    s0?.creaseSpec,
    s0?.crease_spec,
    s0?.creasingSpec,
    s0?.creasing_spec
  )
  if (directText) {
    const parsed = parseCreaseText(directText)
    return finalize(parsed.spec || '', parsed.type || directType || '')
  }

  const c1 = pickNum(
    s0?.creasingSize1, s0?.creaseSize1, s0?.creasing_size1, s0?.crease_size1,
    s0?.creasingSize_1, s0?.creaseSize_1, s0?.creasing_size_1, s0?.crease_size_1
  )
  const c2 = pickNum(
    s0?.creasingSize2, s0?.creaseSize2, s0?.creasing_size2, s0?.crease_size2,
    s0?.creasingSize_2, s0?.creaseSize_2, s0?.creasing_size_2, s0?.crease_size_2
  )
  const c3 = pickNum(
    s0?.creasingSize3, s0?.creaseSize3, s0?.creasing_size3, s0?.crease_size3,
    s0?.creasingSize_3, s0?.creaseSize_3, s0?.creasing_size_3, s0?.crease_size_3
  )
  if (c1 || c2 || c3) return finalize(`${c1}-${c2}-${c3}`, directType || '')

  const sizes = Array.isArray(s0?.creasingSizes)
    ? s0.creasingSizes
    : (Array.isArray(s0?.creaseSizes) ? s0.creaseSizes : null)
  if (sizes && sizes.length) {
    const nums = sizes.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n !== 0)
    if (nums.length) return finalize(nums.join('-'), directType || '')
  }

  return finalize('', directType || '')
}

export const resolveBoardPurchaseCrease = (r) => {
  const row = (r && typeof r === 'object') ? r : {}
  const product0 = (row?.product && typeof row.product === 'object') ? row.product : undefined
  const meta0 = (row?.meta && typeof row.meta === 'object') ? row.meta : undefined
  const brief0 = (meta0?.brief && typeof meta0.brief === 'object') ? meta0.brief : undefined
  const itemsArr = Array.isArray(row?.items) ? row.items : []
  const skuResolved0 = (row?.__skuResolved && typeof row.__skuResolved === 'object') ? row.__skuResolved : null

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
  const pickType = (...candidates) => {
    let best = ''
    for (const c of candidates) {
      if (!isMeaningful(c)) continue
      const t = safeText(c)
      if (!best || t.length > best.length) best = t
    }
    return best
  }

  const itemIdx = Number(row?.__itemIndex ?? row?.__item_index)
  const hasItemIndex = Number.isFinite(itemIdx) && itemIdx >= 0
  const item0 = (() => {
    if (hasItemIndex && itemIdx < itemsArr.length) {
      const v = itemsArr[itemIdx]
      if (v && typeof v === 'object') return v
    }
    if (itemsArr.length !== 1) return undefined
    const first = itemsArr[0]
    return (first && typeof first === 'object') ? first : undefined
  })()

  const directText = hasItemIndex ? pickText(
    item0?.creaseText,
    item0?.crease_text,
    row?.__creaseText,
    row?.__crease_text,
    product0?.creaseText,
    product0?.crease_text,
    meta0?.creaseText,
    meta0?.crease_text,
    brief0?.creaseText,
    brief0?.crease_text,
    row?.creaseText,
    row?.crease_text
  ) : pickText(
    row?.__creaseText,
    row?.__crease_text,
    item0?.creaseText,
    item0?.crease_text,
    product0?.creaseText,
    product0?.crease_text,
    meta0?.creaseText,
    meta0?.crease_text,
    brief0?.creaseText,
    brief0?.crease_text,
    row?.creaseText,
    row?.crease_text
  )

  const explicitSpec = pickText(
    item0?.creaseSpec,
    item0?.crease_spec,
    item0?.creasingSpec,
    item0?.creasing_spec,
    product0?.creaseSpec,
    product0?.crease_spec,
    product0?.creasingSpec,
    product0?.creasing_spec,
    meta0?.creaseSpec,
    meta0?.crease_spec,
    meta0?.creasingSpec,
    meta0?.creasing_spec,
    brief0?.creaseSpec,
    brief0?.crease_spec,
    brief0?.creasingSpec,
    brief0?.creasing_spec,
    row?.creaseSpec,
    row?.crease_spec,
    row?.creasingSpec,
    row?.creasing_spec
  )

  const numFrom = (...vals) => {
    for (const v of vals) {
      const n = Number(v)
      if (Number.isFinite(n) && n !== 0) return n
    }
    return 0
  }
  const c1 = numFrom(
    item0?.creasingSize1, item0?.creaseSize1, item0?.creasing_size1, item0?.crease_size1,
    item0?.creasingSize_1, item0?.creaseSize_1, item0?.creasing_size_1, item0?.crease_size_1,
    product0?.creasingSize1, product0?.creaseSize1, product0?.creasing_size1, product0?.crease_size1,
    product0?.creasingSize_1, product0?.creaseSize_1, product0?.creasing_size_1, product0?.crease_size_1,
    meta0?.creasingSize1, meta0?.creaseSize1, meta0?.creasing_size1, meta0?.crease_size1,
    meta0?.creasingSize_1, meta0?.creaseSize_1, meta0?.creasing_size_1, meta0?.crease_size_1,
    brief0?.creasingSize1, brief0?.creaseSize1, brief0?.creasing_size1, brief0?.crease_size1,
    brief0?.creasingSize_1, brief0?.creaseSize_1, brief0?.creasing_size_1, brief0?.crease_size_1,
    row?.creasingSize1, row?.creaseSize1, row?.creasing_size1, row?.crease_size1,
    row?.creasingSize_1, row?.creaseSize_1, row?.creasing_size_1, row?.crease_size_1
  )
  const c2 = numFrom(
    item0?.creasingSize2, item0?.creaseSize2, item0?.creasing_size2, item0?.crease_size2,
    item0?.creasingSize_2, item0?.creaseSize_2, item0?.creasing_size_2, item0?.crease_size_2,
    product0?.creasingSize2, product0?.creaseSize2, product0?.creasing_size2, product0?.crease_size2,
    product0?.creasingSize_2, product0?.creaseSize_2, product0?.creasing_size_2, product0?.crease_size_2,
    meta0?.creasingSize2, meta0?.creaseSize2, meta0?.creasing_size2, meta0?.crease_size2,
    meta0?.creasingSize_2, meta0?.creaseSize_2, meta0?.creasing_size_2, meta0?.crease_size_2,
    brief0?.creasingSize2, brief0?.creaseSize2, brief0?.creasing_size2, brief0?.crease_size2,
    brief0?.creasingSize_2, brief0?.creaseSize_2, brief0?.creasing_size_2, brief0?.crease_size_2,
    row?.creasingSize2, row?.creaseSize2, row?.creasing_size2, row?.crease_size2,
    row?.creasingSize_2, row?.creaseSize_2, row?.creasing_size_2, row?.crease_size_2
  )
  const c3 = numFrom(
    item0?.creasingSize3, item0?.creaseSize3, item0?.creasing_size3, item0?.crease_size3,
    item0?.creasingSize_3, item0?.creaseSize_3, item0?.creasing_size_3, item0?.crease_size_3,
    product0?.creasingSize3, product0?.creaseSize3, product0?.creasing_size3, product0?.crease_size3,
    product0?.creasingSize_3, product0?.creaseSize_3, product0?.creasing_size_3, product0?.crease_size_3,
    meta0?.creasingSize3, meta0?.creaseSize3, meta0?.creasing_size3, meta0?.crease_size3,
    meta0?.creasingSize_3, meta0?.creaseSize_3, meta0?.creasing_size_3, meta0?.crease_size_3,
    brief0?.creasingSize3, brief0?.creaseSize3, brief0?.creasing_size3, brief0?.crease_size3,
    brief0?.creasingSize_3, brief0?.creaseSize_3, brief0?.creasing_size_3, brief0?.crease_size_3,
    row?.creasingSize3, row?.creaseSize3, row?.creasing_size3, row?.crease_size3,
    row?.creasingSize_3, row?.creaseSize_3, row?.creasing_size_3, row?.crease_size_3
  )

  const sizes =
    (Array.isArray(item0?.creasingSizes) ? item0.creasingSizes : null) ||
    (Array.isArray(item0?.creaseSizes) ? item0.creaseSizes : null) ||
    (Array.isArray(product0?.creasingSizes) ? product0.creasingSizes : null) ||
    (Array.isArray(product0?.creaseSizes) ? product0.creaseSizes : null) ||
    (Array.isArray(meta0?.creasingSizes) ? meta0.creasingSizes : null) ||
    (Array.isArray(meta0?.creaseSizes) ? meta0.creaseSizes : null) ||
    (Array.isArray(brief0?.creasingSizes) ? brief0.creasingSizes : null) ||
    (Array.isArray(brief0?.creaseSizes) ? brief0.creaseSizes : null) ||
    (Array.isArray(row?.creasingSizes) ? row.creasingSizes : null) ||
    (Array.isArray(row?.creaseSizes) ? row.creaseSizes : null)

  const fromText = pickText(
    row?.__creaseText,
    row?.__crease_text,
    row?.creasing,
    row?.crease,
    row?.pressLine,
    row?.press_line,
    row?.pressLineSize,
    row?.press_line_size,
    row?.creasingSize,
    row?.creaseSize,
    row?.creasing_size,
    row?.crease_size,
    product0?.creasing,
    product0?.crease,
    product0?.pressLine,
    product0?.press_line,
    product0?.pressLineSize,
    product0?.press_line_size,
    product0?.creasingSize,
    product0?.creaseSize,
    product0?.creasing_size,
    product0?.crease_size,
    item0?.creasing,
    item0?.crease,
    item0?.pressLine,
    item0?.press_line,
    item0?.pressLineSize,
    item0?.press_line_size,
    item0?.creasingSize,
    item0?.creaseSize,
    item0?.creasing_size,
    item0?.crease_size,
    meta0?.creasing,
    meta0?.crease,
    meta0?.pressLine,
    meta0?.press_line,
    meta0?.pressLineSize,
    meta0?.press_line_size,
    meta0?.creasingSize,
    meta0?.creaseSize,
    meta0?.creasing_size,
    meta0?.crease_size,
    brief0?.creasing,
    brief0?.crease,
    brief0?.pressLine,
    brief0?.press_line,
    brief0?.pressLineSize,
    brief0?.press_line_size,
    brief0?.creasingSize,
    brief0?.creaseSize,
    brief0?.creasing_size,
    brief0?.crease_size
  )

  const directType = pickType(
    item0?.pressLineType,
    item0?.press_line_type,
    item0?.creaseType,
    item0?.creasingType,
    item0?.creasing_type,
    item0?.crease_type,
    product0?.pressLineType,
    product0?.press_line_type,
    product0?.creaseType,
    product0?.creasingType,
    product0?.creasing_type,
    product0?.crease_type,
    meta0?.pressLineType,
    meta0?.press_line_type,
    meta0?.creaseType,
    meta0?.creasingType,
    meta0?.creasing_type,
    meta0?.crease_type,
    brief0?.pressLineType,
    brief0?.press_line_type,
    brief0?.creaseType,
    brief0?.creasingType,
    brief0?.creasing_type,
    brief0?.crease_type,
    row?.pressLineType,
    row?.press_line_type,
    row?.creaseType,
    row?.creasingType,
    row?.creasing_type,
    row?.crease_type
  )

  let spec = ''
  let type = directType || ''

  if (directText) {
    const parsed = parseCreaseText(directText)
    spec = parsed.spec || ''
    if (parsed.type) type = parsed.type
  } else if (explicitSpec) {
    const parsed = parseCreaseText(explicitSpec)
    spec = parsed.spec || String(explicitSpec || '').trim()
    if (parsed.type) type = parsed.type
  } else if (c1 || c2 || c3) {
    spec = `${c1}-${c2}-${c3}`
  } else if (sizes && sizes.length) {
    const nums = sizes.map((v) => Number(v)).filter((n) => Number.isFinite(n) && n !== 0)
    if (nums.length) spec = nums.join('-')
  } else if (fromText) {
    const parsed = parseCreaseText(fromText)
    spec = parsed.spec || ''
    if (parsed.type) type = parsed.type || type
  }

  if (!type) {
    const computed = hasItemIndex
      ? pickText(item0?.creaseText, item0?.crease_text, row?.__creaseText, row?.__crease_text)
      : pickText(row?.__creaseText, row?.__crease_text)
    if (computed) {
      const parsed = parseCreaseText(computed)
      if (parsed.type) type = parsed.type
    }
  }

  if ((!spec || !type) && skuResolved0) {
    const skuCrease = calcCreaseFromSku(skuResolved0)
    if (!spec && skuCrease?.spec) spec = String(skuCrease.spec || '').trim()
    if (!type && skuCrease?.type) type = String(skuCrease.type || '').trim()
  }

  const specOut0 = String(spec || '').trim()
  const width0 = (() => {
    const candidates = [
      item0?.boardWidth, item0?.board_width, item0?.specWidth, item0?.spec_width, item0?.width, item0?.w,
      product0?.boardWidth, product0?.board_width, product0?.specWidth, product0?.spec_width, product0?.width, product0?.w,
      meta0?.boardWidth, meta0?.board_width, meta0?.specWidth, meta0?.spec_width, meta0?.width, meta0?.w,
      brief0?.boardWidth, brief0?.board_width, brief0?.specWidth, brief0?.spec_width, brief0?.width, brief0?.w,
      row?.boardWidth, row?.board_width, row?.specWidth, row?.spec_width, row?.width, row?.w
    ]
    for (const v of candidates) {
      const n = Number(v)
      if (Number.isFinite(n) && n > 0) return n
    }
    return undefined
  })()
  const specOut = (() => {
    if (!specOut0 || !/\d/.test(specOut0) || !Number.isFinite(width0)) return specOut0
    const nums = (specOut0.match(/\d+(?:\.\d+)?/g) || [])
      .map((x) => Number(x))
      .filter((n) => Number.isFinite(n) && n > 0)
    if (nums.length !== 3) return specOut0
    const sum = nums[0] + nums[1] + nums[2]
    if (!Number.isFinite(sum)) return specOut0
    const delta = Math.abs(sum - width0)
    if (delta < 1) return specOut0
    const mid = width0 - nums[0] - nums[2]
    if (!Number.isFinite(mid) || mid <= 0) return ''
    const fmt = (n) => {
      if (!Number.isFinite(n)) return ''
      const fixed = Number.isInteger(n) ? String(n) : String(Number(n.toFixed(3)))
      return fixed.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1')
    }
    const a = fmt(nums[0])
    const b = fmt(mid)
    const c = fmt(nums[2])
    if (!a || !b || !c) return ''
    return `${a}-${b}-${c}`
  })()
  let typeOut = String(type || '').trim()
  if (!typeOut && specOut && /\d/.test(specOut)) typeOut = '凹凸压线'
  return { spec: specOut, type: typeOut }
}
