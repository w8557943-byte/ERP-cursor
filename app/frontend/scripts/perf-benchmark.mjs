import axios from 'axios'

const CLOUD_API_BASE_URL = 'https://erp-system-prod-1glmda1zf4f9c7a7-1367197884.ap-shanghai.app.tcloudbase.com/api-bridge'

const toNumber = (value, fallback) => {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

const percentile = (sorted, p) => {
  if (!sorted.length) return 0
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))
  return sorted[idx]
}

const BASE_URL =
  String(process.env.ERP_BENCH_BASE_URL || '').trim() ||
  String(process.env.VITE_API_BASE_URL || '').trim() ||
  CLOUD_API_BASE_URL

const TOKEN = String(process.env.ERP_BENCH_TOKEN || '').trim()
const ITERATIONS = Math.max(1, Math.floor(toNumber(process.env.ERP_BENCH_ITERATIONS, 20)))
const CONCURRENCY = Math.max(1, Math.floor(toNumber(process.env.ERP_BENCH_CONCURRENCY, 2)))
const TIMEOUT_MS = Math.max(1000, Math.floor(toNumber(process.env.ERP_BENCH_TIMEOUT_MS, 30000)))

const client = axios.create({
  baseURL: BASE_URL,
  timeout: TIMEOUT_MS,
  headers: {
    'Content-Type': 'application/json',
    ...(TOKEN ? { Authorization: `Bearer ${TOKEN}` } : {})
  }
})

const endpoints = [
  { name: 'orders.list.p1_50', method: 'get', url: '/orders', params: { page: 1, limit: 50, orderBy: 'createdAt_desc' } },
  { name: 'orders.stats', method: 'get', url: '/orders/stats', params: {} },
  { name: 'customers.list.p1_200', method: 'get', url: '/customers', params: { page: 1, limit: 200, orderBy: 'createdAt_desc' } },
  { name: 'purchases.boards.p1_50', method: 'get', url: '/orders', params: { page: 1, limit: 50, orderType: 'purchase', purchaseCategory: 'boards', orderBy: 'createdAt_desc' } },
  { name: 'dashboard.stats', method: 'get', url: '/dashboard/stats', params: {} }
]

const runOne = async (ep) => {
  const start = Date.now()
  try {
    const resp =
      ep.method === 'get'
        ? await client.get(ep.url, { params: ep.params })
        : await client.request({ method: ep.method, url: ep.url, params: ep.params, data: ep.data })
    const ms = Date.now() - start
    return { ok: true, ms, bytes: JSON.stringify(resp?.data ?? resp ?? {}).length }
  } catch (err) {
    const ms = Date.now() - start
    const status = err?.response?.status
    const message = err?.response?.data?.message || err?.message || 'request failed'
    return { ok: false, ms, status, message }
  }
}

const runEndpoint = async (ep) => {
  const samples = []
  const failures = []
  let i = 0

  const worker = async () => {
    while (true) {
      const idx = i
      if (idx >= ITERATIONS) return
      i += 1
      const r = await runOne(ep)
      if (r.ok) samples.push(r.ms)
      else failures.push(r)
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()))

  samples.sort((a, b) => a - b)
  const sum = samples.reduce((acc, v) => acc + v, 0)
  const avg = samples.length ? sum / samples.length : 0

  return {
    name: ep.name,
    ok: samples.length,
    fail: failures.length,
    avgMs: Math.round(avg),
    p50Ms: percentile(samples, 50),
    p90Ms: percentile(samples, 90),
    p95Ms: percentile(samples, 95),
    minMs: samples[0] || 0,
    maxMs: samples[samples.length - 1] || 0,
    failures: failures.slice(0, 5)
  }
}

const main = async () => {
  const startedAt = new Date().toISOString()
  const meta = { startedAt, baseURL: BASE_URL, iterations: ITERATIONS, concurrency: CONCURRENCY, timeoutMs: TIMEOUT_MS }

  const results = []
  for (const ep of endpoints) {
    results.push(await runEndpoint(ep))
  }

  const out = { meta, results }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`)
}

main().catch((e) => {
  process.stderr.write(`${String(e?.stack || e?.message || e)}\n`)
  process.exitCode = 1
})

