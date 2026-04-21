const apiBase = String(process.env.API_BASE_URL || '').trim()
const token = String(process.env.API_TOKEN || '').trim()
const total = Math.max(1, Number(process.env.TOTAL || 200) || 200)
const concurrency = Math.max(1, Number(process.env.CONCURRENCY || 40) || 40)
const mode = String(process.env.MODE || 'order-create').trim().toLowerCase()
const customerId = String(process.env.CUSTOMER_ID || '').trim()
const scenario = String(process.env.SCENARIO || '').trim() || 'default'

if (!apiBase) {
  console.error('缺少 API_BASE_URL')
  process.exit(1)
}
if (!token) {
  console.error('缺少 API_TOKEN')
  process.exit(1)
}

const endpoint = apiBase.replace(/\/+$/, '') + '/orders'
const now = Date.now()
const customersSkuEndpoint = customerId ? (apiBase.replace(/\/+$/, '') + `/customers/${encodeURIComponent(customerId)}/skus`) : ''

const buildPayload = (i) => ({
  customerName: '压测客户',
  productName: '纸箱',
  productTitle: `压测订单_${now}_${i}`,
  quantity: 1,
  unit: '个',
  unitPrice: 0,
  amount: 0,
  totalAmount: 0,
  status: 'ordered'
})

const parseJson = async (resp) => {
  const text = await resp.text()
  let body = null
  try { body = JSON.parse(text) } catch (_) { body = { raw: text } }
  return body
}

const postOnce = async (i) => {
  const resp = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify(buildPayload(i))
  })
  const body = await parseJson(resp)
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`)
    err.detail = body
    throw err
  }
  if (body && typeof body === 'object' && body.success === false) {
    const err = new Error(String(body.message || '创建失败'))
    err.detail = body
    throw err
  }
  const data = body?.data ?? body
  const orderNo = data?.orderNo || data?.orderNumber || data?.data?.orderNo || data?.data?.orderNumber
  const id = data?._id || data?.id || data?.data?._id || data?.data?.id
  return { orderNo, id }
}

const createSkuOnce = async (i) => {
  if (!customersSkuEndpoint) return { id: null }
  const resp = await fetch(customersSkuEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({
      name: `压测SKU_${now}_${i}`,
      productionMode: 'inhouse'
    })
  })
  const body = await parseJson(resp)
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`)
    err.detail = body
    throw err
  }
  if (body && typeof body === 'object' && body.success === false) {
    const err = new Error(String(body.message || '创建SKU失败'))
    err.detail = body
    throw err
  }
  const data = body?.data ?? body
  const id = data?.id || data?._id || data?.data?.id || data?.data?._id || null
  return { id }
}

const shipOnce = async (id) => {
  const url = apiBase.replace(/\/+$/, '') + `/orders/${encodeURIComponent(String(id || ''))}/status`
  const resp = await fetch(url, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`
    },
    body: JSON.stringify({ status: 'shipping' })
  })
  const body = await parseJson(resp)
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`)
    err.detail = body
    throw err
  }
  if (body && typeof body === 'object' && body.success === false) {
    const err = new Error(String(body.message || '发货失败'))
    err.detail = body
    throw err
  }
  return true
}

const deleteOnce = async (id) => {
  const url = apiBase.replace(/\/+$/, '') + `/orders/${encodeURIComponent(String(id || ''))}`
  const resp = await fetch(url, {
    method: 'DELETE',
    headers: {
      Authorization: `Bearer ${token}`
    }
  })
  const body = await parseJson(resp)
  if (!resp.ok) {
    const err = new Error(`HTTP ${resp.status}`)
    err.detail = body
    throw err
  }
  if (body && typeof body === 'object' && body.success === false) {
    const err = new Error(String(body.message || '删除失败'))
    err.detail = body
    throw err
  }
  return true
}

const fullOnce = async (i) => {
  const sku = await createSkuOnce(i)
  const order = await postOnce(i)
  if (order?.id) {
    await shipOnce(order.id)
    await deleteOnce(order.id)
  }
  return { ...order, skuId: sku?.id || null }
}

const run = async () => {
  const startedAt = Date.now()
  const ok = []
  const failed = []
  let cursor = 0

  const worker = async () => {
    while (true) {
      const i = cursor
      cursor += 1
      if (i >= total) return
      try {
        const out = mode === 'full' ? await fullOnce(i) : await postOnce(i)
        ok.push(out)
      } catch (e) {
        const status = e?.detail?.status || e?.detail?.code || e?.detail?.errcode
        failed.push({ i, message: String(e?.message || e || ''), status: status ?? null, detail: e?.detail })
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()))

  const orderNos = ok.map((x) => String(x.orderNo || '')).filter(Boolean)
  const unique = new Set(orderNos)
  const duplicates = orderNos.length - unique.size
  const ms = Date.now() - startedAt
  const rps = Math.round((ok.length / Math.max(1, ms)) * 1000)

  console.log(JSON.stringify({
    apiBase,
    scenario,
    mode,
    customerId: customerId || null,
    total,
    concurrency,
    ok: ok.length,
    failed: failed.length,
    unauthorized: failed.filter((x) => String(x?.message || '').includes('HTTP 401')).length,
    elapsedMs: ms,
    rps,
    orderNos: orderNos.length,
    uniqueOrderNos: unique.size,
    duplicates
  }, null, 2))

  if (failed.length) {
    console.log(JSON.stringify({ failed: failed.slice(0, 10) }, null, 2))
  }

  process.exitCode = duplicates > 0 ? 2 : (failed.length ? 1 : 0)
}

run().catch((e) => {
  console.error(String(e?.message || e || 'unknown error'))
  process.exit(1)
})
