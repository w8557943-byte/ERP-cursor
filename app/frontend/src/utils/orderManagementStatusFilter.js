export function normalizeStatusFilter(raw) {
  const list = Array.isArray(raw) ? raw : (raw ? [raw] : [])
  const cleaned = list
    .map((v) => String(v ?? '').trim())
    .filter(Boolean)
  return cleaned.filter((v, idx) => cleaned.indexOf(v) === idx)
}

export function toggleSingleStatus(prev, statusKey) {
  const key = String(statusKey ?? '').trim()
  if (!key) return normalizeStatusFilter(prev)
  const prevArr = normalizeStatusFilter(prev)
  return prevArr.includes(key) ? [] : [key]
}

export function getEmptyText(statusFilter) {
  const normalized = normalizeStatusFilter(statusFilter)
  return normalized.length ? '当前状态暂无订单' : '暂无订单'
}

const STATUS_QUERY_MAP = {
  ordered: ['ordered', 'created', 'confirmed', '已下单'],
  pending: ['pending', 'waiting', 'planned', 'to_produce', 'prepare', '待生产'],
  processing: ['processing', 'producing', 'in_progress', 'in_production', '生产中'],
  stocked: ['stocked', 'warehoused', 'warehouse', '已入库']
}

export function expandStatusFilter(statusFilter) {
  const normalized = normalizeStatusFilter(statusFilter)
  const all = []
  normalized.forEach((k) => {
    const mapped = STATUS_QUERY_MAP[k]
    if (Array.isArray(mapped) && mapped.length) all.push(...mapped)
    else all.push(k)
  })
  const cleaned = all.map((v) => String(v ?? '').trim()).filter(Boolean)
  return cleaned.filter((v, idx) => cleaned.indexOf(v) === idx)
}

export function buildOrdersQuery(input) {
  const page = Math.max(1, Number(input?.page ?? 1) || 1)
  const limit = Math.max(1, Number(input?.limit ?? input?.pageSize ?? 30) || 30)
  const keyword = String(input?.keyword ?? '').trim()
  const startDate = String(input?.startDate ?? '').trim()
  const endDate = String(input?.endDate ?? '').trim()
  const statusFilter = expandStatusFilter(input?.statusFilter)

  const query = {
    page,
    limit,
    orderBy: 'createdAt_desc',
    excludeOrderType: 'purchase',
    withTotal: true
  }

  if (keyword) query.keyword = keyword
  if (startDate && endDate) {
    query.startDate = startDate
    query.endDate = endDate
  }
  if (statusFilter.length) query.status = statusFilter.join(',')

  return query
}
