export const round4 = (n) => Math.round(Number(n) * 10000) / 10000

export const normalizeText = (v) => String(v == null ? '' : v).trim()

export const computeInhouseRawMaterialCost = ({ boardWidth, boardHeight, pricePerSqm }) => {
  const bw = Number(boardWidth)
  const bh = Number(boardHeight)
  const price = Number(pricePerSqm)
  if (!Number.isFinite(bw) || !Number.isFinite(bh) || !Number.isFinite(price)) return undefined
  const sqm = ((bw + 20) * bh) / 1000000
  if (!Number.isFinite(sqm)) return undefined
  return round4(sqm * price)
}

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

export const resolveSupplierMaterialPricePerSqm = ({ supplierId, materialCode, flute, supplierMaterialsBySupplier }) => {
  const sid = normalizeText(supplierId)
  const code = normalizeText(materialCode)
  if (!sid || !code) return undefined
  const map = supplierMaterialsBySupplier && typeof supplierMaterialsBySupplier === 'object' ? supplierMaterialsBySupplier : null
  const list = map && Array.isArray(map[sid]) ? map[sid] : []
  if (!list.length) return undefined

  const fluteText = normalizeText(flute)
  const hit = list.find((r) => normalizeText(r?.materialCode) === code)
  const pickPrice = (r) => {
    const n = Number(r?.pricePerSqm ?? r?.materialPricePerSqm ?? r?.materialPrice ?? r?.unitPrice)
    return Number.isFinite(n) ? n : undefined
  }
  if (!fluteText) return pickPrice(hit)

  const candidates = list.filter((r) => normalizeText(r?.materialCode) === code)
  if (!candidates.length) return undefined

  const matched = candidates.find((r) => {
    const flutes = normalizeFluteList(r?.flutes ?? r?.fluteOptions ?? r?.flute_options ?? r?.fluteList ?? r?.flute_list ?? r?.flute)
    return flutes.includes(fluteText)
  })
  return pickPrice(matched || hit)
}

