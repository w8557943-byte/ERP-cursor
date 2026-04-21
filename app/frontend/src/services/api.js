import axios from 'axios'
import { useAuthStore } from '@/stores/authStore'
import { invalidateCache } from '../utils/cachedAPI'

const CLOUD_API_BASE_URL = 'https://erp-system-prod-1glmda1zf4f9c7a7-1367197884.ap-shanghai.app.tcloudbase.com/api-bridge'
const LOCAL_ELECTRON_API_BASE_URL = 'http://127.0.0.1:3003/api'

const isElectronRuntime = () => typeof window !== 'undefined' && window && window.electronAPI

const parseEnvBool = (value) => {
  if (value == null) return null
  const normalized = String(value).trim().toLowerCase()
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false
  return null
}

const resolveBaseUrl = () => {
  const normalize = (v) => String(v || '').trim()
  const envBase = normalize(import.meta.env.VITE_API_BASE_URL)
  const isElectron = isElectronRuntime()
  const webSimDesktop = !isElectron && String(import.meta.env.VITE_WEB_SIMULATE_DESKTOP || '').trim().toLowerCase() === 'true'

  try {
    const localFlag = parseEnvBool(import.meta.env.VITE_ELECTRON_USE_LOCAL_BACKEND)
    const useLocal = isElectron && localFlag !== false
    if (useLocal && isElectron) {
      console.log('[API Config] Using LOCAL_ELECTRON_API_BASE_URL:', LOCAL_ELECTRON_API_BASE_URL)
      console.log('[API Config] VITE_ELECTRON_USE_LOCAL_BACKEND:', import.meta.env.VITE_ELECTRON_USE_LOCAL_BACKEND)
      return LOCAL_ELECTRON_API_BASE_URL
    }
  } catch (_) { /* ignore */ }

  if (webSimDesktop) {
    return '/api'
  }

  try {
    const webFlag = parseEnvBool(import.meta.env.VITE_WEB_USE_LOCAL_BACKEND)
    if (!isElectron && webFlag === true) {
      console.log('[API Config] Using LOCAL_ELECTRON_API_BASE_URL for web:', LOCAL_ELECTRON_API_BASE_URL)
      return LOCAL_ELECTRON_API_BASE_URL
    }
  } catch (_) { /* ignore */ }

  if (envBase) {
    console.log('[API Config] Using VITE_API_BASE_URL:', envBase)
    console.log('[API Config] Is Electron:', isElectron)
    return envBase
  }

  try {
    if (typeof window !== 'undefined' && window?.location) {
      const host = String(window.location.hostname || '').toLowerCase()
      if (host === 'localhost' || host === '127.0.0.1') {
        return '/api'
      }
    }
  } catch (_) { /* ignore */ }

  if (import.meta.env.DEV) {
    return '/api'
  }

  console.log('[API Config] Using CLOUD_API_BASE_URL (default):', CLOUD_API_BASE_URL)
  console.log('[API Config] Is Electron:', isElectron)
  console.log('[API Config] VITE_API_BASE_URL:', import.meta.env.VITE_API_BASE_URL)
  console.log('[API Config] VITE_ELECTRON_USE_LOCAL_BACKEND:', import.meta.env.VITE_ELECTRON_USE_LOCAL_BACKEND)
  return CLOUD_API_BASE_URL
}

const shouldFallbackToLocalElectronApi = (error) => {
  if (!isElectronRuntime()) return false
  if (shouldFallbackToLocalElectronApiByPayload(error?.response?.data)) return true
  const msg = String(error?.response?.data?.message || error?.response?.data?.error || error?.message || '')
  if (msg.includes('未找到匹配的路由')) return true
  const status = Number(error?.response?.status)
  if (status === 404) return true
  return false
}

const shouldFallbackToLocalWebApi = (error) => {
  if (isElectronRuntime()) return false
  const status = Number(error?.response?.status)
  if (status === 404) return true
  const msg = String(error?.response?.data?.message || error?.response?.data?.error || error?.message || '')
  if (msg.includes('未找到匹配的路由')) return true
  if (/not\s*found/i.test(msg)) return true
  return false
}

const shouldFallbackToLocalElectronApiByPayload = (input) => {
  if (!isElectronRuntime()) return false
  const raw = input && typeof input === 'object' ? input : null
  if (!raw) return false
  const isAxiosResponseLike = Object.prototype.hasOwnProperty.call(raw, 'status') && Object.prototype.hasOwnProperty.call(raw, 'config')
  const payload = isAxiosResponseLike
    ? (raw.data && typeof raw.data === 'object' ? raw.data : null)
    : raw
  if (!payload) return false
  if (payload.success !== false) return false
  const msg = String(payload?.message || payload?.error || payload?.msg || '').trim()
  if (!msg) return true
  return (
    msg.includes('订单不存在') ||
    msg.includes('未找到订单') ||
    msg.includes('找不到订单') ||
    msg.includes('not found')
  )
}

const assertBusinessOk = (res) => {
  const body = res?.data ?? res
  const payload = body && typeof body === 'object' ? body : null
  if (!payload || payload.success !== false) return
  const msg = String(payload?.message || payload?.error || payload?.msg || '请求失败')
  const err = new Error(msg)
  err.response = { status: 200, data: payload }
  throw err
}

const isRouteNotFoundError = (error) => {
  const status = Number(error?.response?.status)
  if (status === 404) return true
  const msg = String(error?.response?.data?.message || error?.response?.data?.error || error?.message || '')
  if (!msg) return false
  if (msg.includes('未找到匹配的路由')) return true
  if (/route\s+.*\s+not\s+found/i.test(msg)) return true
  if (/not\s*found/i.test(msg)) return true
  return false
}

const normalizeCloudSyncConfig = (raw) => {
  const cfg = raw && typeof raw === 'object' ? raw : {}
  return {
    enabled: Boolean(cfg.enabled),
    intervalMinutes: Number(cfg.intervalMinutes || 1440),
    collections: Array.isArray(cfg.collections) ? cfg.collections.map((x) => String(x || '').trim()).filter(Boolean) : [],
    exitSync: Boolean(cfg.exitSync ?? cfg.exitBackup)
  }
}

const encodePathParam = (raw) => {
  const s = String(raw || '').trim()
  if (!s) return ''
  let decoded = s
  try {
    decoded = decodeURIComponent(s)
  } catch (_) { void 0 }
  return encodeURIComponent(decoded)
}

const stableStringify = (input) => {
  const seen = new WeakSet()

  const normalize = (value) => {
    if (value === null || value === undefined) return value
    const t = typeof value
    if (t === 'string' || t === 'number' || t === 'boolean') return value
    if (value instanceof Date) return value.toISOString()
    if (Array.isArray(value)) return value.map(normalize)
    if (t !== 'object') return String(value)
    if (seen.has(value)) return '[Circular]'
    seen.add(value)
    const keys = Object.keys(value).sort()
    const out = {}
    for (const k of keys) out[k] = normalize(value[k])
    return out
  }

  try {
    return JSON.stringify(normalize(input))
  } catch (_) {
    return ''
  }
}

const ordersListCache = new Map()
const orderStatsCache = new Map()
const orderMonthCountCache = new Map()
const dashboardStatsCache = new Map()
const dashboardRecentCache = new Map()
const customerListCache = new Map()
const productListCache = new Map()
const employeeListCache = new Map()
const maxCacheSize = 200

const getCacheTtlMs = (key, fallback) => {
  const raw = import.meta?.env ? import.meta.env[key] : undefined
  const n = Number(raw)
  if (Number.isFinite(n) && n >= 0) return n
  return fallback
}

const ORDERS_LIST_CACHE_MS = getCacheTtlMs('VITE_ORDERS_LIST_CACHE_MS', 60000)
const ORDERS_STATS_CACHE_MS = getCacheTtlMs('VITE_ORDERS_STATS_CACHE_MS', 300000)
const ORDERS_MONTH_COUNT_CACHE_MS = getCacheTtlMs('VITE_ORDERS_MONTH_COUNT_CACHE_MS', 60000)
const DASHBOARD_STATS_CACHE_MS = getCacheTtlMs('VITE_DASHBOARD_STATS_CACHE_MS', 60000)
const DASHBOARD_RECENT_CACHE_MS = getCacheTtlMs('VITE_DASHBOARD_RECENT_CACHE_MS', 60000)
const CUSTOMER_LIST_CACHE_MS = getCacheTtlMs('VITE_CUSTOMER_LIST_CACHE_MS', 600000)
const PRODUCT_LIST_CACHE_MS = getCacheTtlMs('VITE_PRODUCT_LIST_CACHE_MS', 600000)
const EMPLOYEE_LIST_CACHE_MS = getCacheTtlMs('VITE_EMPLOYEE_LIST_CACHE_MS', 3600000)

const trimCacheSize = (cache) => {
  while (cache.size > maxCacheSize) {
    const firstKey = cache.keys().next().value
    if (!firstKey) break
    cache.delete(firstKey)
  }
}

const cachedGet = async (url, config, ttlMs, cache) => {
  const usedTtl = Math.max(0, Number(ttlMs || 0))
  if (usedTtl <= 0) return api.get(url, config)

  const params = config && config.params ? config.params : {}
  const key = `GET:${String(url)}:${stableStringify(params)}`
  const now = Date.now()

  const existing = cache.get(key)
  if (existing && existing.expireAt > now) {
    if (existing.value !== undefined) return existing.value
    if (existing.promise) return existing.promise
  }

  const promise = api
    .get(url, config)
    .then((value) => {
      cache.set(key, { expireAt: Date.now() + usedTtl, value })
      trimCacheSize(cache)
      return value
    })
    .catch((err) => {
      cache.delete(key)
      throw err
    })

  cache.set(key, { expireAt: now + usedTtl, promise })
  trimCacheSize(cache)
  return promise
}

const cachedGetValidated = async (url, config, ttlMs, cache, validate) => {
  const usedTtl = Math.max(0, Number(ttlMs || 0))
  if (usedTtl <= 0) {
    const value = await api.get(url, config)
    if (typeof validate === 'function') validate(value)
    return value
  }

  const params = config && config.params ? config.params : {}
  const key = `GET:${String(url)}:${stableStringify(params)}`
  const now = Date.now()

  const existing = cache.get(key)
  if (existing && existing.expireAt > now) {
    if (existing.value !== undefined) return existing.value
    if (existing.promise) return existing.promise
  }

  const promise = api
    .get(url, config)
    .then((value) => {
      if (typeof validate === 'function') validate(value)
      cache.set(key, { expireAt: Date.now() + usedTtl, value })
      trimCacheSize(cache)
      return value
    })
    .catch((err) => {
      cache.delete(key)
      throw err
    })

  cache.set(key, { expireAt: now + usedTtl, promise })
  trimCacheSize(cache)
  return promise
}

const parseOrderNumberPayload = (input) => {
  const payload = input?.data ?? input
  const data = payload?.data ?? payload
  const orderNumber =
    data?.orderNumber ??
    data?.orderNo ??
    data?.no ??
    payload?.orderNumber ??
    payload?.orderNo ??
    payload?.no
  const reservationId =
    data?.reservationId ??
    payload?.reservationId ??
    data?.rid ??
    payload?.rid ??
    data?.id ??
    payload?.id
  return { orderNumber, reservationId }
}

const clearOrdersCache = () => {
  ordersListCache.clear()
  orderStatsCache.clear()
  orderMonthCountCache.clear()
  dashboardStatsCache.clear()
  dashboardRecentCache.clear()
  try { invalidateCache('orders') } catch (_) { void 0 }
  try { invalidateCache('purchases') } catch (_) { void 0 }
  try {
    const ts = Date.now()
    if (typeof window !== 'undefined' && window) {
      try { window.localStorage.setItem('erp_orders_changed_at', String(ts)) } catch (_) { void 0 }
      try {
        window.dispatchEvent(new CustomEvent('erp:ordersChanged', { detail: { ts } }))
      } catch (_) {
        window.dispatchEvent(new Event('erp:ordersChanged'))
      }
    }
  } catch (_) { void 0 }
}

const clearCustomerCache = () => {
  customerListCache.clear()
  try { invalidateCache('customers') } catch (_) { void 0 }
}

const clearProductCache = () => {
  productListCache.clear()
  try { invalidateCache('products') } catch (_) { void 0 }
}

const clearEmployeeCache = () => {
  employeeListCache.clear()
  try { invalidateCache('employees') } catch (_) { void 0 }
}

const stripBearer = (token) => String(token || '').trim().replace(/^bearer\s+/i, '').trim()

const isCloudBridgeBaseUrl = (baseUrl) => String(baseUrl || '').includes('api-bridge')

const normalizeTokenForHeaders = (input) => {
  const raw = String(input || '').trim()
  if (!raw) return ''
  const stripped = raw.replace(/^bearer\s+/i, '').trim()
  const lower = stripped.toLowerCase()
  if (!stripped || lower === 'null' || lower === 'undefined') return ''
  if (stripped.split('.').length === 3) return stripped
  if (stripped.length >= 20) return stripped
  return ''
}

const readPersistedAuthToken = () => {
  try {
    if (typeof window === 'undefined' || !window?.localStorage) return ''
    const raw = window.localStorage.getItem('auth-storage')
    if (!raw) return ''
    const parsed = JSON.parse(raw)
    const state = parsed && typeof parsed === 'object' ? (parsed.state || parsed) : null
    const t = state && typeof state === 'object' ? state.token : null
    return t != null ? String(t).trim() : ''
  } catch (_) {
    return ''
  }
}

const getOrCreateDeviceId = () => {
  try {
    if (typeof window === 'undefined' || !window?.localStorage) return ''
    const key = 'erp_device_id'
    const existing = String(window.localStorage.getItem(key) || '').trim()
    if (existing) return existing
    const next = (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function')
      ? globalThis.crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`
    window.localStorage.setItem(key, next)
    return next
  } catch (_) {
    return ''
  }
}

const getAuthLockUntil = () => {
  try {
    if (typeof window === 'undefined' || !window?.localStorage) return 0
    const raw = Number(window.localStorage.getItem('erp_auth_lock_until') || 0)
    return Number.isFinite(raw) ? raw : 0
  } catch (_) {
    return 0
  }
}

const setAuthLockUntil = (until) => {
  try {
    if (typeof window === 'undefined' || !window?.localStorage) return
    const v = Number(until || 0)
    window.localStorage.setItem('erp_auth_lock_until', String(Number.isFinite(v) ? v : 0))
  } catch (_) {
    void 0
  }
}

const noteUnauthorizedForLock = () => {
  try {
    if (typeof window === 'undefined' || !window?.localStorage) return { hits: 0, locked: false }
    const key = 'erp_unauth_hits'
    const now = Date.now()
    const windowMs = 60 * 60 * 1000
    const threshold = 3
    const raw = String(window.localStorage.getItem(key) || '').trim()
    const hits = raw ? (JSON.parse(raw) || []) : []
    const filtered = Array.isArray(hits) ? hits.map((t) => Number(t)).filter((t) => Number.isFinite(t) && t >= now - windowMs) : []
    filtered.push(now)
    window.localStorage.setItem(key, JSON.stringify(filtered))
    if (filtered.length >= threshold) {
      const until = now + 15 * 60 * 1000
      setAuthLockUntil(until)
      return { hits: filtered.length, locked: true, until }
    }
    return { hits: filtered.length, locked: false }
  } catch (_) {
    return { hits: 0, locked: false }
  }
}

// 创建axios实例
const api = axios.create({
  baseURL: resolveBaseUrl(),
  timeout: 30000, // 增加到30秒,避免大数据量查询超时
  headers: {
    'Content-Type': 'application/json'
  }
})

const refreshClient = axios.create({
  baseURL: api.defaults.baseURL,
  timeout: 30000,
  headers: {
    'Content-Type': 'application/json'
  }
})

const probeLocalBackendOnce = (() => {
  let started = false
  let webLocalOk = false
  return () => {
    if (started) return
    started = true
    try {
      if (typeof window === 'undefined') return
      if (isElectronRuntime()) return
      if (String(import.meta.env.VITE_WEB_SIMULATE_DESKTOP || '').trim().toLowerCase() === 'true') return
      const current = String(api.defaults.baseURL || '')
      if (current === LOCAL_ELECTRON_API_BASE_URL) return
      if (current === '/api') return
      const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
      const timer = controller ? setTimeout(() => controller.abort(), 800) : null
      fetch('http://127.0.0.1:3005/health', { method: 'GET', signal: controller ? controller.signal : undefined })
        .then((r) => {
          if (timer) clearTimeout(timer)
          if (!r || !r.ok) return
          webLocalOk = true
          api.defaults.baseURL = LOCAL_ELECTRON_API_BASE_URL
          refreshClient.defaults.baseURL = LOCAL_ELECTRON_API_BASE_URL
          console.log('[API Config] Switched to local backend for web:', LOCAL_ELECTRON_API_BASE_URL)
        })
        .catch(() => {
          if (timer) clearTimeout(timer)
        })
    } catch (_) { void 0 }
  }
})()

probeLocalBackendOnce()

const isWebLocalBackendOk = () => {
  try {
    return typeof window !== 'undefined' && !isElectronRuntime() && String(api.defaults.baseURL || '') === LOCAL_ELECTRON_API_BASE_URL
  } catch (_) {
    return false
  }
}

let refreshPromise = null
let refreshDisabledUntil = 0

const extractRefreshPayload = (raw) => {
  const payload = raw && typeof raw === 'object' ? raw : {}
  const candidates = [
    payload,
    payload.data,
    payload.data?.data,
    payload.result,
    payload.result?.data
  ].filter((v) => v && typeof v === 'object')
  const token =
    candidates.map((c) => c.token).find(Boolean) ??
    candidates.map((c) => c.accessToken).find(Boolean) ??
    candidates.map((c) => c.jwt).find(Boolean)
  const user =
    candidates.map((c) => c.user).find(Boolean) ??
    candidates.map((c) => c.currentUser).find(Boolean) ??
    candidates.map((c) => c.profile).find(Boolean)
  return { token: token || null, user: user || null }
}

const refreshAuthToken = async () => {
  if (refreshDisabledUntil && refreshDisabledUntil > Date.now()) return null
  if (refreshPromise) return refreshPromise
  const { token: rawToken, user: rawUser } = useAuthStore.getState()
  const token = normalizeTokenForHeaders(rawToken)
  if (!token) {
    return null
  }
  const refreshAuthHeaderValue = `Bearer ${token}`
  refreshPromise = refreshClient
    .post(
      '/auth/refresh',
      {},
      {
        headers: {
          Authorization: refreshAuthHeaderValue,
          authorization: refreshAuthHeaderValue,
          'X-Authorization': refreshAuthHeaderValue,
          'x-authorization': refreshAuthHeaderValue,
          'X-Access-Token': token,
          'x-access-token': token
        }
      }
    )
    .then((res) => {
      const { token: nextToken, user: nextUser } = extractRefreshPayload(res?.data)
      if (!nextToken) {
        refreshDisabledUntil = Date.now() + 30 * 1000
        return null
      }
      refreshDisabledUntil = 0
      useAuthStore.setState({
        token: nextToken,
        user: nextUser || rawUser || null,
        isAuthenticated: true
      })
      return nextToken
    })
    .catch((err) => {
      const status = Number(err?.response?.status || 0)
      const now = Date.now()
      if (status === 401 || status === 403) {
        try { useAuthStore.getState().logout() } catch (_) { void 0 }
        refreshDisabledUntil = now + 30 * 1000
        return null
      }
      if (status === 404) {
        refreshDisabledUntil = now + 30 * 1000
        return null
      }
      refreshDisabledUntil = now + 5 * 1000
      return null
    })
    .finally(() => {
      refreshPromise = null
    })
  return refreshPromise
}

// 请求拦截器
api.interceptors.request.use(
  (config) => {
    try {
      const url = String(config.url || '')
      // 统一移除以 /api/ 开头的前缀，避免代理或本地路径混用
      if (/^\/api\//i.test(url)) {
        config.url = config.url.replace(/^\/api\//i, '/')
      }
    } catch (_) { /* ignore */ }
    try {
      const url = String(config.url || '')
      const raw = url.startsWith('http') ? url : `/${url}`.replace(/\/{2,}/g, '/')
      const isAuthEndpoint = raw.includes('/auth/login') || raw.includes('/auth/logout') || raw.includes('/auth/me') || raw.includes('/auth/refresh')
      const lockUntil = getAuthLockUntil()
      if (!isAuthEndpoint && lockUntil > Date.now()) {
        const err = new Error('账号已被临时锁定，请稍后重试')
        err.code = 'ACCOUNT_LOCKED'
        throw err
      }
    } catch (e) {
      if (e && e.code === 'ACCOUNT_LOCKED') {
        return Promise.reject(e)
      }
    }
    try {
      const deviceId = getOrCreateDeviceId()
      if (deviceId) {
        const setHeader = (k, v) => {
          if (config.headers && typeof config.headers.set === 'function') {
            config.headers.set(k, v)
          } else {
            config.headers = { ...(config.headers || {}), [k]: v }
          }
        }
        setHeader('X-Device-Id', deviceId)
        setHeader('X-Client-Env', isElectronRuntime() ? 'electron' : (import.meta.env.DEV ? 'dev' : 'web'))
      }
    } catch (_) { /* ignore */ }
    const { token: rawToken } = useAuthStore.getState()
    const readPersistedToken = () => {
      try {
        if (typeof window === 'undefined' || !window?.localStorage) return ''
        const raw = window.localStorage.getItem('auth-storage')
        if (!raw) return ''
        const parsed = JSON.parse(raw)
        const state = parsed && typeof parsed === 'object' ? (parsed.state || parsed) : null
        const t = state && typeof state === 'object' ? state.token : null
        return t != null ? String(t).trim() : ''
      } catch (_) {
        return ''
      }
    }
    const tokenCandidate = rawToken != null ? String(rawToken).trim() : readPersistedToken()
    const normalizedToken = normalizeTokenForHeaders(tokenCandidate)
    if (!rawToken && normalizedToken) {
      try { useAuthStore.setState({ token: normalizedToken }) } catch (_) { void 0 }
    }

    try {
      const method = String(config.method || 'get').toLowerCase()
      const url = String(config.url || '')
      const rawUrl = url.startsWith('http') ? url : `/${url}`.replace(/\/{2,}/g, '/')
      const isAuthEndpoint = rawUrl.includes('/auth/login') || rawUrl.includes('/auth/logout') || rawUrl.includes('/auth/me') || rawUrl.includes('/auth/refresh')
      const isWrite = method === 'post' || method === 'put' || method === 'patch' || method === 'delete'
      if (isWrite && !normalizedToken && !isAuthEndpoint) {
        const err = new Error('登录已失效，请重新登录')
        err.code = 'AUTH_REQUIRED'
        return Promise.reject(err)
      }
    } catch (_) { /* ignore */ }

    if (normalizedToken) {
      const bearerValue = `Bearer ${normalizedToken}`
      const setHeader = (k, v) => {
        if (config.headers && typeof config.headers.set === 'function') {
          config.headers.set(k, v)
        } else {
          config.headers = { ...(config.headers || {}), [k]: v }
        }
      }
      setHeader('Authorization', bearerValue)
      setHeader('authorization', bearerValue)
      setHeader('X-Authorization', bearerValue)
      setHeader('x-authorization', bearerValue)
      setHeader('X-Access-Token', normalizedToken)
      setHeader('x-access-token', normalizedToken)
    }
    return config
  },
  (error) => {
    return Promise.reject(error)
  }
)

// 响应拦截器
api.interceptors.response.use(
  (response) => {
    return response.data
  },
  async (error) => {
    const { status } = error.response || {}
    if (status === 423) {
      try {
        const data = error?.response?.data
        const code = data && typeof data === 'object' ? data.code : undefined
        if (String(code || '') === 'ACCOUNT_LOCKED') {
          setAuthLockUntil(Date.now() + 15 * 60 * 1000)
          useAuthStore.getState().logout()
        }
      } catch (_) { void 0 }
      return Promise.reject(error)
    }
    if (status === 401) {
      const headers = error?.config?.headers
      const authHeader =
        (headers && typeof headers.get === 'function' ? headers.get('Authorization') : null) ||
        (headers && (headers.Authorization || headers.authorization)) ||
        ''
      const sentAuth = Boolean(String(authHeader || '').trim())
      const url = String(error?.config?.url || '')
      const baseURL = String(error?.config?.baseURL || api?.defaults?.baseURL || '')
      const normalizedUrl = (() => {
        const raw = url.startsWith('http') ? url : `/${url}`.replace(/\/{2,}/g, '/')
        if (raw.startsWith('http')) return raw
        if (!baseURL) return raw
        try {
          return new URL(raw, baseURL.endsWith('/') ? baseURL : `${baseURL}/`).toString()
        } catch (_) {
          return raw
        }
      })()
      const isAuthEndpoint = normalizedUrl.includes('/auth/me') || normalizedUrl.includes('/auth/logout') || normalizedUrl.includes('/auth/refresh')

      const config = error?.config || {}
      const readPersistedToken = () => {
        try {
          if (typeof window === 'undefined' || !window?.localStorage) return ''
          const raw = window.localStorage.getItem('auth-storage')
          if (!raw) return ''
          const parsed = JSON.parse(raw)
          const state = parsed && typeof parsed === 'object' ? (parsed.state || parsed) : null
          const t = state && typeof state === 'object' ? state.token : null
          return t != null ? String(t).trim() : ''
        } catch (_) {
          return ''
        }
      }
      const token = (() => {
        const raw = useAuthStore.getState().token
        const s = raw != null ? String(raw).trim() : ''
        return s || readPersistedToken()
      })()

      if ((sentAuth || Boolean(token)) && !isAuthEndpoint && !config._retry) {
        config._retry = true
        try {
          const newToken = await refreshAuthToken()
          if (newToken) {
            const raw = String(newToken || '').replace(/^bearer\s+/i, '').trim()
            const bearerValue = /^bearer\s+/i.test(newToken) ? String(newToken) : `Bearer ${raw}`
            const setHeader = (k, v) => {
              if (config.headers && typeof config.headers.set === 'function') {
                config.headers.set(k, v)
              } else {
                config.headers = { ...(config.headers || {}), [k]: v }
              }
            }
            setHeader('Authorization', bearerValue)
            setHeader('authorization', bearerValue)
            setHeader('X-Authorization', bearerValue)
            setHeader('x-authorization', bearerValue)
            setHeader('X-Access-Token', raw)
            setHeader('x-access-token', raw)
            return api.request(config)
          }
        } catch (_) { void 0 }
      }

      const data = error?.response?.data
      const msg = String(data?.message || data?.error || data?.msg || error?.message || '')
      const msgLower = String(msg || '').toLowerCase()
      const authErrorCodes = new Set(['TOKEN_INVALID', 'TOKEN_EXPIRED', 'UNAUTHORIZED', 'AUTH_REQUIRED'])
      const logoutMessages = new Set([
        '访问令牌不存在',
        '无效的访问令牌',
        '访问令牌已过期',
        '用户未登录',
        '未提供认证令牌',
        '无效的认证令牌',
        '用户不存在'
      ])
      const code = data && typeof data === 'object' ? data.code : undefined
      const looksTokenProblem =
        msg.includes('令牌') ||
        msg.includes('认证') ||
        msg.includes('登录') ||
        msgLower.includes('token') ||
        msgLower.includes('jwt')
      const shouldLogout = (sentAuth || Boolean(token)) && (isAuthEndpoint || authErrorCodes.has(String(code || '')) || (looksTokenProblem && logoutMessages.has(msg)))
      if (shouldLogout) {
        useAuthStore.getState().logout()
      } else {
        try {
          const rawToken = useAuthStore.getState().token
          const tokenStr = rawToken != null ? String(rawToken).trim() : ''
          const tokenMeta = {
            hasToken: Boolean(tokenStr),
            len: tokenStr.length,
            looksJwt: tokenStr.split('.').length === 3,
            hasBearer: /^bearer\s+/i.test(tokenStr)
          }
          console.warn('[API 401]', { url: normalizedUrl, token: tokenMeta, code: code ?? null, message: msg || null })
        } catch (_) { void 0 }
      }

      try {
        const deviceId = getOrCreateDeviceId()
        const shouldCountLockHit = shouldLogout || looksTokenProblem || authErrorCodes.has(String(code || ''))
        const lock = shouldCountLockHit ? noteUnauthorizedForLock() : { hits: 0, locked: false }
        if (lock.locked) {
          useAuthStore.getState().logout()
        }
        if (isElectronRuntime() && window?.electronAPI?.reportRasp) {
          await window.electronAPI.reportRasp({
            type: lock.locked ? 'unauthorized.threshold' : 'unauthorized',
            status: 401,
            code: code ?? null,
            message: msg || null,
            url: normalizedUrl,
            method: String(error?.config?.method || 'GET').toUpperCase(),
            deviceId: deviceId || null,
            userId: useAuthStore.getState().user?.id || useAuthStore.getState().user?.userId || null,
            stack: new Error().stack,
            extra: lock.locked ? { hitsLastHour: lock.hits, lockUntil: lock.until } : { hitsLastHour: lock.hits }
          })
        }
      } catch (_) { void 0 }
    }
    try {
      if (shouldFallbackToLocalElectronApi(error)) {
        const config = error?.config || {}
        if (!config._triedLocalFallback) {
          config._triedLocalFallback = true
          config.baseURL = LOCAL_ELECTRON_API_BASE_URL
          return api.request(config)
        }
      }
      if (shouldFallbackToLocalWebApi(error)) {
        const config = error?.config || {}
        if (!config._triedLocalFallback) {
          config._triedLocalFallback = true
          if (isWebLocalBackendOk()) {
            config.baseURL = LOCAL_ELECTRON_API_BASE_URL
            return api.request(config)
          }
        }
      }
    } catch (_) { void 0 }
    return Promise.reject(error)
  }
)

// API服务定义
export const authAPI = {
  login: (credentials) => api.post('/auth/login', credentials),
  logout: () => api.post('/auth/logout'),
  verifyToken: () => api.get('/auth/me'),
  refreshToken: () => api.post('/auth/refresh')
}

export const statementAPI = {
  getStatements: (params = {}) => api.get('/statements', { params }),
  upsertStatement: (payload) => api.post('/statements', payload),
  rollbackImport: (payload) => api.post('/statements/rollback', payload)
}

export const customerAliasAPI = {
  getAliases: (params = {}) => api.get('/customer-aliases', { params }),
  upsertAlias: (payload) => api.post('/customer-aliases/upsert', payload),
  deleteAlias: (payload) => api.post('/customer-aliases/delete', payload)
}

export const dataManagementAPI = {
  async getStats(params = {}) {
    return api.get('/data-management/stats', { params })
  }
}

export const orderAPI = {
  async getOrders(params = {}) {
    const {
      page = 1,
      pageSize,
      limit,
      search,
      keyword,
      withTotal,
      ...rest
    } = params || {}
    const finalLimitRaw = Number.isFinite(Number(pageSize))
      ? Number(pageSize)
      : Number.isFinite(Number(limit))
        ? Number(limit)
        : 20
    const finalLimit = Math.min(1000, finalLimitRaw)
    const searchKeyword = keyword != null && keyword !== '' ? keyword : search
    const query = {
      page,
      limit: finalLimit,
      ...rest
    }
    if (withTotal !== undefined) {
      query.withTotal = withTotal
    } else {
      query.withTotal = false
    }
    if (searchKeyword != null && searchKeyword !== '') {
      query.keyword = searchKeyword
      query.search = searchKeyword
      query.q = searchKeyword
    }
    try {
      const res = await cachedGetValidated('/orders', { params: query }, ORDERS_LIST_CACHE_MS, ordersListCache, (value) => {
        assertBusinessOk(value)
      })
      if (shouldFallbackToLocalElectronApiByPayload(res?.data)) {
        return await api.request({ baseURL: LOCAL_ELECTRON_API_BASE_URL, method: 'get', url: '/orders', params: query })
      }
      return res
    } catch (error) {
      try {
        if (shouldFallbackToLocalElectronApi(error)) {
          return await api.request({ baseURL: LOCAL_ELECTRON_API_BASE_URL, method: 'get', url: '/orders', params: query })
        }
      } catch (_) { void 0 }
      console.error('获取订单列表失败:', error)
      throw error
    }
  },
  clearCache: () => {
    clearOrdersCache()
  },
  async getOrder(id) {
    const url = `/orders/${encodePathParam(id)}`
    try {
      const res = await api.get(url)
      assertBusinessOk(res)
      if (shouldFallbackToLocalElectronApiByPayload(res?.data)) {
        return await api.request({ baseURL: LOCAL_ELECTRON_API_BASE_URL, method: 'get', url })
      }
      return res
    } catch (error) {
      if (!shouldFallbackToLocalElectronApi(error)) throw error
      return await api.request({ baseURL: LOCAL_ELECTRON_API_BASE_URL, method: 'get', url })
    }
  },
  async getOrderAny(idOrNo) {
    const token = String(idOrNo || '').trim()
    if (!token) throw new Error('缺少订单ID')

    const safeText = (v) => String(v ?? '').trim()
    const normalizeNo = (x) => safeText(x?.orderNo || x?.orderNumber || x?.order_no || x?.order_number || x?.no || '')
    const looksLikeChildNo = /^(.*?)-\d+$/.test(token)
    const isMeaningfulText = (v) => {
      const s = safeText(v)
      if (!s) return false
      return !['-', '—', '--', '---', '暂无', '无', 'null', 'undefined'].includes(s.toLowerCase())
    }

    const unwrapOrder = (res) => {
      const body = res?.data ?? res
      if (!body) return null
      if (body && typeof body === 'object') {
        if (body.success === false) return null
        if (body.order && typeof body.order === 'object') return body.order
        const data = body.data
        if (data && typeof data === 'object') {
          if (data.order && typeof data.order === 'object') return data.order
          if (data.data && typeof data.data === 'object') return data.data
        }
        if (data && typeof data === 'object') return data
      }
      return body
    }

    const isOrderKeyObject = (o) => {
      if (!o || typeof o !== 'object') return false
      if (o._id || o.id || o.orderNo || o.orderNumber) return true
      return false
    }

    const isRichOrderObject = (o) => {
      if (!o || typeof o !== 'object') return false
      const items = Array.isArray(o.items) ? o.items : (Array.isArray(o.products) ? o.products : [])
      if (items.length) return true
      if (isMeaningfulText(o.customerName) || isMeaningfulText(o.customer?.name) || isMeaningfulText(o.customer?.companyName) || isMeaningfulText(o.supplierName)) return true
      if (isMeaningfulText(o.goodsName) || isMeaningfulText(o.productTitle) || isMeaningfulText(o.productName) || isMeaningfulText(o.title)) return true
      if (isMeaningfulText(o.materialNo) || isMeaningfulText(o.materialCode) || isMeaningfulText(o.spec) || isMeaningfulText(o.specification)) return true
      const qty = Number(o.quantity ?? o.qty ?? o.count)
      if (Number.isFinite(qty) && qty > 0) return true
      const amount = Number(o.amount ?? o.totalAmount ?? o.total_amount ?? o.finalAmount ?? o.final_amount)
      if (Number.isFinite(amount) && amount > 0) return true
      return false
    }

    try {
      const res = await orderAPI.getOrder(token)
      const o = unwrapOrder(res)
      if (isRichOrderObject(o)) return res

      const fetchedId = safeText(o?._id || o?.id)
      if (fetchedId && fetchedId !== token) {
        try {
          const full = await orderAPI.getOrder(fetchedId)
          const o2 = unwrapOrder(full)
          if (isRichOrderObject(o2) || isOrderKeyObject(o2)) return full
        } catch (_) { void 0 }
      }
    } catch (_) { void 0 }

    const extractOrdersArray = (resp) => {
      const body = resp?.data ?? resp
      const payload = body?.data ?? body
      const data = payload?.data ?? payload
      const candidates = [
        data?.orders,
        payload?.orders,
        body?.orders,
        data?.list,
        payload?.list,
        body?.list,
        data?.rows,
        payload?.rows,
        body?.rows,
        data?.items,
        payload?.items,
        body?.items,
        data
      ]
      for (const c of candidates) {
        if (Array.isArray(c)) return c
      }
      return []
    }

    // 若形如“主号-子序号”，优先走订单组路径以减少回退链路
    if (looksLikeChildNo) {
      try {
        const groupRes = await orderAPI.getOrderGroup(token)
        const body = groupRes?.data ?? groupRes
        const payload = body?.data ?? body
        const group = payload?.data ?? payload
        const parent = group?.parent && typeof group.parent === 'object' ? group.parent : null
        const children = Array.isArray(group?.children) ? group.children : []
        const matchedChild =
          children.find(c => normalizeNo(c) === token) ||
          null
        const preferred = matchedChild || parent || children[0] || null
        if (preferred && typeof preferred === 'object') {
          const pid = safeText(preferred?._id || preferred?.id)
          if (pid) {
            try {
              const full = await orderAPI.getOrder(pid)
              const o = unwrapOrder(full)
              if (isRichOrderObject(o) || isOrderKeyObject(o)) return full
            } catch (_) { void 0 }
          }
          return { data: { success: true, data: { order: preferred } } }
        }
      } catch (_) { void 0 }
    }

    let arr = []
    try {
      const listResp = await orderAPI.getOrders({ keyword: token, page: 1, limit: 200, withTotal: false })
      arr = extractOrdersArray(listResp)
    } catch (_) { void 0 }
    if (!arr.length) {
      try {
        const listResp = await orderAPI.getOrders({ keyword: token, orderType: 'purchase', page: 1, limit: 200, withTotal: false })
        arr = extractOrdersArray(listResp)
      } catch (_) { void 0 }
    }

    const hit =
      arr.find(x => normalizeNo(x) === token) ||
      (!looksLikeChildNo ? arr.find(x => normalizeNo(x).startsWith(token)) : null) ||
      null

    if (hit) {
      const hitId = safeText(hit?._id || hit?.id)
      if (hitId && hitId !== token) {
        try {
          const full = await orderAPI.getOrder(hitId)
          const o = unwrapOrder(full)
          if (isRichOrderObject(o) || isOrderKeyObject(o)) return full
        } catch (_) { void 0 }
      }
      return { data: { success: true, data: { order: hit } } }
    }

    try {
      const groupRes = await orderAPI.getOrderGroup(token)
      const body = groupRes?.data ?? groupRes
      const payload = body?.data ?? body
      const group = payload?.data ?? payload
      const parent = group?.parent && typeof group.parent === 'object' ? group.parent : null
      const children = Array.isArray(group?.children) ? group.children : []
      const matchedChild =
        children.find(c => normalizeNo(c) === token) ||
        (!looksLikeChildNo ? children.find(c => normalizeNo(c).startsWith(token)) : null) ||
        null
      const preferred = matchedChild || parent || children[0] || null
      if (preferred && typeof preferred === 'object') {
        const pid = safeText(preferred?._id || preferred?.id)
        if (pid) {
          try {
            const full = await orderAPI.getOrder(pid)
            const o = unwrapOrder(full)
            if (isRichOrderObject(o) || isOrderKeyObject(o)) return full
          } catch (_) { void 0 }
        }
        return { data: { success: true, data: { order: preferred } } }
      }
    } catch (_) { void 0 }

    throw new Error('未找到订单')
  },
  async getOrderGroup(orderNo) {
    const url = `/orders/group/${encodePathParam(orderNo)}`
    try {
      const res = await api.get(url)
      assertBusinessOk(res)
      if (shouldFallbackToLocalElectronApiByPayload(res?.data)) {
        return await api.request({ baseURL: LOCAL_ELECTRON_API_BASE_URL, method: 'get', url })
      }
      return res
    } catch (error) {
      if (!shouldFallbackToLocalElectronApi(error)) throw error
      return await api.request({ baseURL: LOCAL_ELECTRON_API_BASE_URL, method: 'get', url })
    }
  },
  createOrder: async (data) => {
    const role = useAuthStore.getState().user?.role
    if (role && role !== 'admin') {
      throw new Error('权限不足：需要管理员账号才能新建订单')
    }
    const res = await api.post('/orders', data)
    clearOrdersCache()
    return res
  },
  updateOrder: async (id, data) => {
    const res = await api.put(`/orders/${id}`, data)
    clearOrdersCache()
    return res
  },
  deleteOrder: async (id) => {
    const idStr = String(id || '').trim()
    if (!idStr) throw new Error('缺少订单ID')
    try {
      const res = await api.delete(`/orders/${idStr}`)
      clearOrdersCache()
      return res
    } catch (error) {
      try {
        const res = await api.post(`/orders/${idStr}/delete`, { id: idStr })
        clearOrdersCache()
        return res
      } catch (_) { void 0 }
      try {
        const res = await api.post('/orders/delete', { id: idStr })
        clearOrdersCache()
        return res
      } catch (_) { void 0 }
      throw error
    }
  },
  async getOrderStats(params = {}) {
    const query = params && typeof params === 'object' ? params : {}
    const hasQuery = Object.keys(query).length > 0
    return await cachedGet('/orders/stats', hasQuery ? { params: query } : undefined, ORDERS_STATS_CACHE_MS, orderStatsCache)
  },
  async getMonthOrderCount() {
    return await cachedGet('/orders/month-count', undefined, ORDERS_MONTH_COUNT_CACHE_MS, orderMonthCountCache)
  },
  async getProductionEfficiencyStats(params = {}) {
    const query = params && typeof params === 'object' ? params : {}
    const hasQuery = Object.keys(query).length > 0
    return await cachedGet('/orders/production-efficiency-stats', hasQuery ? { params: query } : undefined, ORDERS_STATS_CACHE_MS, orderStatsCache)
  },
  getNextOrderNumber: async () => {
    const cacheBust = Date.now()
    const isBridge = isCloudBridgeBaseUrl(api?.defaults?.baseURL)
    try {
      const res = await api.get('/orders/next-no', {
        params: { _ts: cacheBust },
        headers: { 'Cache-Control': 'no-store' }
      })
      const { orderNumber, reservationId } = parseOrderNumberPayload(res)
      if (orderNumber) return { data: { orderNumber, reservationId } }
    } catch (_) { void 0 }
    if (!isBridge) {
      try {
        const res = await api.post(
          '/orders/next-no',
          { _ts: cacheBust },
          { headers: { 'Cache-Control': 'no-store' } }
        )
        const { orderNumber, reservationId } = parseOrderNumberPayload(res)
        if (orderNumber) return { data: { orderNumber, reservationId } }
      } catch (_) { void 0 }
    }
    const res = await api.post(
      '/order-numbers/generate',
      { _ts: cacheBust },
      { headers: { 'Cache-Control': 'no-store' } }
    )
    const { orderNumber, reservationId } = parseOrderNumberPayload(res)
    if (!orderNumber) {
      throw new Error('获取订单号失败')
    }
    return { data: { orderNumber, reservationId } }
  },
  confirmOrderNumber: (orderNo) => api.post('/order-numbers/confirm', { orderNo }),
  releaseOrderNumber: async (data) => {
    try {
      return await api.post('/order-numbers/release', data)
    } catch (_) {
      return await api.post('/orders/release-no', data)
    }
  },
  fixDuplicateOrderNos: async (payload = {}) => {
    const res = await api.post('/orders/fix-duplicate-order-nos', payload)
    clearOrdersCache()
    return res
  }
}

const parseShippingNoteNumberPayload = (input) => {
  const payload = input?.data ?? input
  const data = payload?.data ?? payload
  const shippingNoteNo =
    data?.shippingNoteNo ??
    data?.no ??
    payload?.shippingNoteNo ??
    payload?.no
  const dateKey =
    data?.dateKey ??
    payload?.dateKey
  const seq =
    data?.seq ??
    payload?.seq
  return { shippingNoteNo, dateKey, seq }
}

export const shippingNumberAPI = {
  generateShippingNoteNumber: async (payload = {}) => {
    try {
      const res = await api.post('/shipping-numbers/generate', payload)
      const { shippingNoteNo, dateKey, seq } = parseShippingNoteNumberPayload(res)
      if (!shippingNoteNo) {
        throw new Error('获取发货单号失败')
      }
      return { data: { shippingNoteNo, dateKey, seq } }
    } catch (error) {
      if (shouldFallbackToLocalElectronApi(error)) {
        const res = await api.request({
          baseURL: LOCAL_ELECTRON_API_BASE_URL,
          method: 'post',
          url: '/shipping-numbers/generate',
          data: payload
        })
        const { shippingNoteNo, dateKey, seq } = parseShippingNoteNumberPayload(res)
        if (!shippingNoteNo) {
          throw new Error('获取发货单号失败')
        }
        return { data: { shippingNoteNo, dateKey, seq } }
      }
      throw error
    }
  }
}

// 采购通道专用 API（云端）
export const purchaseAPI = {
  async getPurchaseOrders(params = {}) {
    const {
      page = 1,
      pageSize,
      limit,
      search,
      keyword,
      category,
      withTotal,
      withProducts,
      ...rest
    } = params || {}
    const finalLimitRaw = Number.isFinite(Number(pageSize))
      ? Number(pageSize)
      : Number.isFinite(Number(limit))
        ? Number(limit)
        : 20
    const finalLimit = Math.min(50, finalLimitRaw)
    const searchKeyword = keyword != null && keyword !== '' ? keyword : search
    const next = {
      page,
      limit: finalLimit,
      ...rest,
      orderType: 'purchase'
    }
    if (withTotal !== undefined) {
      next.withTotal = withTotal
    } else {
      next.withTotal = false
    }
    if (withProducts !== undefined) {
      next.withProducts = withProducts
    } else {
      next.withProducts = false
    }
    if (searchKeyword != null && searchKeyword !== '') {
      next.keyword = searchKeyword
      next.search = searchKeyword
      next.q = searchKeyword
    }
    if (category) {
      next.purchaseCategory = category
      next.category = category
      next.purchase_category = category
    }
    try {
      const res = await cachedGetValidated('/orders', { params: next }, ORDERS_LIST_CACHE_MS, ordersListCache, (value) => {
        assertBusinessOk(value)
      })
      if (shouldFallbackToLocalElectronApiByPayload(res?.data)) {
        return await api.request({ baseURL: LOCAL_ELECTRON_API_BASE_URL, method: 'get', url: '/orders', params: next })
      }
      return res
    } catch (error) {
      try {
        if (shouldFallbackToLocalElectronApi(error)) {
          return await api.request({ baseURL: LOCAL_ELECTRON_API_BASE_URL, method: 'get', url: '/orders', params: next })
        }
      } catch (_) { void 0 }
      throw error
    }
  },
  // 创建：为采购通道规范化负载
  createPurchaseOrder: (payload) => {
    // 确保参数不被覆盖，保留 frontend 传递的 purchaseCategory
    const data = {
      orderType: 'purchase',
      source: 'purchased',
      ...payload
    }
    return api.post('/orders', data).then((res) => {
      clearOrdersCache()
      return res
    })
  },
  // 更新：通用更新
  updatePurchaseOrder: (id, data) =>
    api.put(`/orders/${id}`, data).then((res) => {
      clearOrdersCache()
      return res
    }),
  relinkBoardPurchaseAssociation: async (payload) => {
    const res = await api.post('/orders/boards/relink', payload)
    clearOrdersCache()
    return res
  },
  // 删除
  deletePurchaseOrder: async (id) => {
    const idStr = String(id || '').trim()
    if (!idStr) throw new Error('缺少订单ID')
    try {
      const res = await api.delete(`/orders/${idStr}`)
      clearOrdersCache()
      return res
    } catch (error) {
      try {
        const res = await api.post(`/orders/${idStr}/delete`, { id: idStr })
        clearOrdersCache()
        return res
      } catch (_) { void 0 }
      try {
        const res = await api.post('/orders/delete', { id: idStr })
        clearOrdersCache()
        return res
      } catch (_) { void 0 }
      throw error
    }
  },
  // 预约与释放编号：沿用订单号服务
  getNextOrderNumber: async () => {
    const cacheBust = Date.now()
    const isBridge = isCloudBridgeBaseUrl(api?.defaults?.baseURL)
    try {
      const res = await api.get('/orders/next-no', {
        params: { _ts: cacheBust },
        headers: { 'Cache-Control': 'no-store' }
      })
      const { orderNumber, reservationId } = parseOrderNumberPayload(res)
      if (orderNumber) return { data: { orderNumber, reservationId } }
    } catch (_) { void 0 }
    if (!isBridge) {
      try {
        const res = await api.post(
          '/orders/next-no',
          { _ts: cacheBust },
          { headers: { 'Cache-Control': 'no-store' } }
        )
        const { orderNumber, reservationId } = parseOrderNumberPayload(res)
        if (orderNumber) return { data: { orderNumber, reservationId } }
      } catch (_) { void 0 }
    }
    const res = await api.post(
      '/order-numbers/generate',
      { _ts: cacheBust },
      { headers: { 'Cache-Control': 'no-store' } }
    )
    const { orderNumber, reservationId } = parseOrderNumberPayload(res)
    if (!orderNumber) {
      throw new Error('获取订单号失败')
    }
    return { data: { orderNumber, reservationId } }
  },
  confirmOrderNumber: (orderNo) => api.post('/order-numbers/confirm', { orderNo }),
  releaseOrderNumber: async (data) => {
    try {
      return await api.post('/order-numbers/release', data)
    } catch (_) {
      return await api.post('/orders/release-no', data)
    }
  }
}

export const productionAPI = {
  async getProductionPlans(params) {
    return await api.get('/workorders/list', { params })
  },
  getProductionPlan: (id) => api.get(`/workorders/${id}`),
  createProductionPlan: (data) => api.post('/workorders', data),
  updateProductionPlan: (id, data) => api.put(`/workorders/${id}`, data),
  async getProductionStats() {
    return await api.get('/dashboard/stats')
  }
}

export const customerAPI = {
  async getCustomers(params) {
    return await cachedGet('/customers', { params }, CUSTOMER_LIST_CACHE_MS, customerListCache)
  },
  getCustomer: (id) => api.get(`/customers/${encodePathParam(id)}`),
  getCustomerSkuStats: () => api.get('/customers/sku-stats').then((res) => {
    assertResponseSuccess(res, 'SKU统计加载失败')
    return res
  }),
  createCustomer: (data) => api.post('/customers', data).then((res) => {
    clearCustomerCache()
    return res
  }),
  updateCustomer: (id, data) => api.put(`/customers/${encodePathParam(id)}`, data).then((res) => {
    clearCustomerCache()
    return res
  }),
  deleteCustomer: (id) => api.delete(`/customers/${encodePathParam(id)}`).then((res) => {
    clearCustomerCache()
    return res
  }),
  async getCustomerStats() {
    return await api.get('/customers/stats')
  }
}

const assertResponseSuccess = (res, fallbackMessage) => {
  const body = res?.data
  if (!body || typeof body !== 'object') return
  const nested =
    body?.data && typeof body.data === 'object'
      ? body.data
      : (body?.result && typeof body.result === 'object' ? body.result : null)
  const nested2 =
    nested?.data && typeof nested.data === 'object'
      ? nested.data
      : null
  const failed =
    body?.success === false ||
    nested?.success === false ||
    nested2?.success === false
  if (!failed) return
  const msg =
    body?.message ||
    nested?.message ||
    nested2?.message ||
    fallbackMessage ||
    '请求失败'
  throw new Error(String(msg))
}

export const customerSkuAPI = {
  getCustomerSkus: (customerId, params = {}) => api.get(`/customers/${encodePathParam(customerId)}/skus`, { params }).then((res) => {
    assertResponseSuccess(res, '加载客户SKU失败')
    return res
  }),
  getCustomerSku: (customerId, skuId) => api.get(`/customers/${encodePathParam(customerId)}/skus/${encodePathParam(skuId)}`).then((res) => {
    assertResponseSuccess(res, '加载SKU失败')
    return res
  }),
  batchSetMaterial: (customerId, data) => api.post(`/customers/${encodePathParam(customerId)}/skus/batch/material`, data).then((res) => {
    assertResponseSuccess(res, '批量设置材质失败')
    return res
  }),
  createCustomerSku: (customerId, data) => {
    const role = useAuthStore.getState().user?.role
    if (role && role !== 'admin') {
      return Promise.reject(new Error('权限不足：需要管理员账号才能新建SKU'))
    }
    return api.post(`/customers/${encodePathParam(customerId)}/skus`, data).then((res) => {
    assertResponseSuccess(res, 'SKU创建失败')
    return res
    })
  },
  updateCustomerSku: (customerId, skuId, data) => api.put(`/customers/${encodePathParam(customerId)}/skus/${encodePathParam(skuId)}`, data).then((res) => {
    assertResponseSuccess(res, 'SKU更新失败')
    return res
  }),
  deleteCustomerSku: (customerId, skuId) => api.delete(`/customers/${encodePathParam(customerId)}/skus/${encodePathParam(skuId)}`).then((res) => {
    assertResponseSuccess(res, 'SKU删除失败')
    return res
  }),
  importCustomerSkus: (customerId, rows, options = {}) => api.post(`/customers/${encodePathParam(customerId)}/skus/import`, { rows, ...(options || {}) }).then((res) => {
    assertResponseSuccess(res, '导入SKU失败')
    return res
  })
}

export const productAPI = {
  async getProducts(params = {}) {
    try {
      return await cachedGetValidated(
        '/products',
        { params },
        PRODUCT_LIST_CACHE_MS,
        productListCache,
        (res) => {
          const payload = res && typeof res === 'object' ? res : {}
          if (payload.success === false) {
            throw new Error(payload.message || '获取产品列表失败')
          }
        }
      )
    } catch (error) {
      console.error('获取产品列表失败:', error)
      throw error
    }
  },
  async getProduct(id) {
    const usedId = String(id || '').trim()
    if (!usedId) throw new Error('产品ID不能为空')
    const res = await api.get(`/products/${usedId}`)
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '获取产品详情失败')
    }
    return res
  },
  async createProduct(data) {
    const res = await api.post('/products', data)
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '创建产品失败')
    }
    clearProductCache()
    return payload.data || res
  },
  async updateProduct(id, data) {
    const usedId = String(id || data?.id || data?._id || '').trim()
    if (!usedId) throw new Error('产品ID不能为空')
    const res = await api.put(`/products/${usedId}`, data)
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '更新产品失败')
    }
    clearProductCache()
    return payload.data || res
  },
  async updateProductStock(id, data) {
    const usedId = String(id || data?.id || data?._id || '').trim()
    if (!usedId) throw new Error('产品ID不能为空')
    const res = await api.patch(`/products/${usedId}/stock`, data)
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '更新产品库存失败')
    }
    clearProductCache()
    return payload.data || res
  },
  async deleteProduct(id) {
    const usedId = String(id || '').trim()
    if (!usedId) throw new Error('产品ID不能为空')
    const res = await api.delete(`/products/${usedId}`, { data: { id: usedId } })
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '删除产品失败')
    }
    clearProductCache()
    return payload.data || res
  }
}

export const supplierAPI = {
  async getSuppliers(params) {
    return await api.get('/suppliers', { params })
  },
  getSupplier: (id) => api.get(`/suppliers/${encodePathParam(id)}`),
  async getDeletedSuppliers(params) {
    return await api.get('/suppliers/trash', { params })
  },
  createSupplier: (data) => api.post('/suppliers', data),
  updateSupplier: (id, data) => api.put(`/suppliers/${id}`, { ...data, id }),
  deleteSupplier: (id) => api.delete(`/suppliers/${id}`, { data: { id } }),
  restoreSupplier: (id) => api.post('/suppliers/restore', { id })
}

export const supplierMaterialAPI = {
  async list(params) {
    return await api.get('/supplier-materials', { params })
  },
  async stats(params) {
    return await api.get('/supplier-materials/stats', { params })
  },
  async upsert(data) {
    return await api.post('/supplier-materials/upsert', data)
  },
  async update(id, data) {
    const usedId = String(id || data?.id || data?._id || '').trim()
    if (!usedId) throw new Error('缺少材质记录ID')
    return await api.put(`/supplier-materials/${usedId}`, { ...data, id: usedId })
  },
  async remove(id) {
    const usedId = String(id || '').trim()
    if (!usedId) throw new Error('缺少材质记录ID')
    return await api.delete(`/supplier-materials/${usedId}`, { data: { id: usedId } })
  }
}

export const supplierOutsourcedMaterialAPI = {
  async list(params) {
    try {
      return await api.get('/supplier-materials/outsourced', { params })
    } catch (e) {
      if (!shouldFallbackToLocalElectronApi(e)) throw e
      return await api.request({ baseURL: LOCAL_ELECTRON_API_BASE_URL, method: 'get', url: '/supplier-materials/outsourced', params })
    }
  },
  async upsert(data) {
    try {
      return await api.post('/supplier-materials/outsourced', data)
    } catch (e) {
      if (!shouldFallbackToLocalElectronApi(e)) throw e
      return await api.request({ baseURL: LOCAL_ELECTRON_API_BASE_URL, method: 'post', url: '/supplier-materials/outsourced', data })
    }
  },
  async update(id, data) {
    const usedId = String(id || data?.id || data?._id || '').trim()
    if (!usedId) throw new Error('缺少外购材料记录ID')
    try {
      return await api.post('/supplier-materials/outsourced/upsert', { ...data, id: usedId })
    } catch (e) {
      if (!shouldFallbackToLocalElectronApi(e)) throw e
      return await api.request({
        baseURL: LOCAL_ELECTRON_API_BASE_URL,
        method: 'post',
        url: '/supplier-materials/outsourced/upsert',
        data: { ...data, id: usedId }
      })
    }
  },
  async remove(id) {
    const usedId = String(id || '').trim()
    if (!usedId) throw new Error('缺少外购材料记录ID')
    const isRouteMissing = (err) => {
      const msg = String(err?.response?.data?.message || err?.response?.data?.error || err?.message || '').trim()
      if (msg.includes('未找到匹配的路由')) return true
      return Number(err?.response?.status || 0) === 404
    }
    try {
      return await api.delete(`/supplier-materials/outsourced/${usedId}`, { data: { id: usedId } })
    } catch (e) {
      let err = e
      if (isRouteMissing(err)) {
        try {
          return await api.post('/supplier-materials/outsourced/delete', { id: usedId })
        } catch (e2) {
          err = e2
        }
      }
      if (!shouldFallbackToLocalElectronApi(err)) throw err
      try {
        return await api.request({
          baseURL: LOCAL_ELECTRON_API_BASE_URL,
          method: 'delete',
          url: `/supplier-materials/outsourced/${usedId}`,
          data: { id: usedId }
        })
      } catch (e3) {
        if (!isRouteMissing(e3)) throw e3
        return await api.request({
          baseURL: LOCAL_ELECTRON_API_BASE_URL,
          method: 'post',
          url: '/supplier-materials/outsourced/delete',
          data: { id: usedId }
        })
      }
    }
  }
}

export const materialCodeAPI = {
  async list(params) {
    return await api.get('/material-codes', { params })
  },
  async upsert(data) {
    return await api.post('/material-codes/upsert', data)
  },
  async remove(id) {
    const usedId = String(id || '').trim()
    if (!usedId) throw new Error('缺少材质代码ID')
    return await api.delete(`/material-codes/${usedId}`, { data: { id: usedId } })
  }
}

export const employeeAPI = {
  async getEmployees(params) {
    try {
      return await cachedGetValidated(
        '/employees',
        { params },
        EMPLOYEE_LIST_CACHE_MS,
        employeeListCache,
        (res) => {
          const payload = res && typeof res === 'object' ? res : {}
          if (payload.success === false) {
            throw new Error(payload.message || '获取员工列表失败')
          }
        }
      )
    } catch (error) {
      console.error('获取员工列表失败:', error)
      throw error
    }
  },
  async getEmployee(id) {
    const res = await api.get(`/employees/${id}`)
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '获取员工详情失败')
    }
    return res
  },
  async createEmployee(data) {
    const res = await api.post('/employees', data)
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '创建员工失败')
    }
    clearEmployeeCache()
    return payload.data || res
  },
  async updateEmployee(id, data) {
    const res = await api.put(`/employees/${id}`, data)
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '更新员工失败')
    }
    clearEmployeeCache()
    return payload.data || res
  },
  async deleteEmployee(id) {
    const res = await api.delete(`/employees/${id}`)
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '删除员工失败')
    }
    clearEmployeeCache()
    return payload.data || res
  }
}

export const fixedCostAPI = {
  async list(params) {
    try {
      const res = await api.get('/fixed-costs', { params })
      const payload = res && typeof res === 'object' ? res : {}
      if (payload.success === false) {
        throw new Error(payload.message || '获取固定成本数据失败')
      }
      if (Array.isArray(payload.data?.items)) {
        return payload.data.items
      }
      if (Array.isArray(payload.items)) {
        return payload.items
      }
      if (Array.isArray(payload.data)) {
        return payload.data
      }
      return []
    } catch (error) {
      console.error('获取固定成本数据失败:', error)
      throw error
    }
  },
  async create(data) {
    const res = await api.post('/fixed-costs', data)
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '创建固定成本失败')
    }
    const item = payload.data?.item || payload.item || payload.data || payload
    return item
  },
  async remove(id) {
    const res = await api.delete(`/fixed-costs/${id}`)
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '删除固定成本失败')
    }
    const item = payload.data?.item || payload.item || payload.data || payload
    return item
  }
}

export const payableAPI = {
  async list(params) {
    try {
      const res = await api.get('/payables', { params })
      const payload = res && typeof res === 'object' ? res : {}
      if (payload.success === false) {
        throw new Error(payload.message || '获取应付账款失败')
      }
      if (Array.isArray(payload.data?.items)) {
        return payload.data.items
      }
      if (Array.isArray(payload.items)) {
        return payload.items
      }
      if (Array.isArray(payload.data)) {
        return payload.data
      }
      return []
    } catch (error) {
      console.error('获取应付账款失败:', error)
      throw error
    }
  },
  async create(data) {
    const res = await api.post('/payables', data)
    const payload = res && typeof res === 'object' ? res : {}
    const item = payload.data?.item || payload.item || payload.data || payload
    if (payload.success !== true || !item || !item.key) {
      const serverMsg = payload.error || payload.message
      throw new Error(serverMsg || '创建应付账款失败')
    }
    return item
  },
  async update(id, data) {
    const usedId = String(id || data?.key || data?.id || '').trim()
    if (!usedId) {
      throw new Error('缺少应付账款ID')
    }
    const res = await api.put(`/payables/${usedId}`, data)
    const payload = res && typeof res === 'object' ? res : {}
    const item = payload.data?.item || payload.item || payload.data || payload
    if (payload.success !== true || !item || !item.key) {
      const serverMsg = payload.error || payload.message
      throw new Error(serverMsg || '更新应付账款失败')
    }
    return item
  },
  async remove(id) {
    const usedId = String(id || '').trim()
    if (!usedId) {
      throw new Error('缺少应付账款ID')
    }
    const res = await api.delete(`/payables/${usedId}`)
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '删除应付账款失败')
    }
    const item = payload.data?.item || payload.item || payload.data || payload
    return item
  },
  async invoiceUploadInit(data) {
    const res = await api.post('/payables/invoice-upload/init', data, { timeout: 60000 })
    const payload = res && typeof res === 'object' ? res : {}
    const uploadId = payload?.data?.uploadId || payload?.uploadId
    if (!uploadId) {
      const serverMsg = payload.error || payload.message
      throw new Error(serverMsg || '初始化上传失败')
    }
    return { uploadId: String(uploadId) }
  },
  async invoiceUploadChunk(data) {
    const res = await api.post('/payables/invoice-upload/chunk', data, { timeout: 60000 })
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      const serverMsg = payload.error || payload.message
      throw new Error(serverMsg || '上传分片失败')
    }
    return payload?.data || payload
  },
  async invoiceUploadComplete(data) {
    const res = await api.post('/payables/invoice-upload/complete', data, { timeout: 60000 })
    const payload = res && typeof res === 'object' ? res : {}
    const fileID = payload?.data?.fileID || payload?.fileID
    const url = payload?.data?.url || payload?.url
    if (!fileID) {
      const serverMsg = payload.error || payload.message
      throw new Error(serverMsg || '完成上传失败')
    }
    return { fileID: String(fileID), url: url ? String(url) : '' }
  }
}

export const userConfigAPI = {
  async getMany(keys = []) {
    const list = Array.isArray(keys) ? keys.map((k) => String(k || '').trim()).filter(Boolean) : []
    const res = await api.get('/user-config', { params: { keys: list.join(',') } })
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '获取用户配置失败')
    }
    const configs = payload.data?.configs || payload.configs || {}
    return configs && typeof configs === 'object' ? configs : {}
  },
  async get(key) {
    const usedKey = String(key || '').trim()
    if (!usedKey) return undefined
    const res = await api.get('/user-config', { params: { key: usedKey } })
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '获取用户配置失败')
    }
    const configs = payload.data?.configs || payload.configs || {}
    if (configs && typeof configs === 'object' && usedKey in configs) {
      return configs[usedKey]
    }
    return undefined
  },
  async set(key, value) {
    const usedKey = String(key || '').trim()
    if (!usedKey) {
      throw new Error('缺少配置key')
    }
    const res = await api.post('/user-config', { key: usedKey, value })
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '保存用户配置失败')
    }
    return payload.data?.item || payload.item || payload.data || payload
  }
}

export const userAPI = {
  async getUsers(params = {}) {
    const query = {
      page: Number(params.page || 1),
      limit: Number(params.limit || params.pageSize || 20),
      keyword: params.keyword != null ? String(params.keyword || '').trim() : ''
    }
    return await api.get('/users', { params: query })
  },
  async createUser(data) {
    const res = await api.post('/users', data)
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '创建用户失败')
    }
    return payload.data || res
  },
  async updateUser(id, data) {
    const usedId = String(id || data?.id || data?._id || '').trim()
    if (!usedId) throw new Error('用户ID不能为空')
    const res = await api.put(`/users/${usedId}`, { ...data, id: usedId })
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '更新用户失败')
    }
    return payload.data || res
  },
  async deleteUser(id) {
    const usedId = String(id || '').trim()
    if (!usedId) throw new Error('用户ID不能为空')
    const res = await api.delete(`/users/${usedId}`, { data: { id: usedId } })
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) {
      throw new Error(payload.message || '删除用户失败')
    }
    return payload.data || res
  }
}

export const categoryAPI = {
  getCategories: (params) => api.get('/product-categories', { params }),
  createCategory: (data) => api.post('/product-categories', data)
}

export const financialAPI = {
  async getFinancialStats() {
    return await cachedGet('/dashboard/stats', undefined, DASHBOARD_STATS_CACHE_MS, dashboardStatsCache)
  },
  async getRevenueReport(params) {
    return await cachedGet('/dashboard/stats', { params }, DASHBOARD_STATS_CACHE_MS, dashboardStatsCache)
  },
  async getExpenseReport(params) {
    return await cachedGet('/dashboard/stats', { params }, DASHBOARD_STATS_CACHE_MS, dashboardStatsCache)
  },
  async getProfitReport(params) {
    return await cachedGet('/dashboard/stats', { params }, DASHBOARD_STATS_CACHE_MS, dashboardStatsCache)
  }
}

export const dashboardAPI = {
  async getDashboardData() {
    return await cachedGet('/dashboard/stats', undefined, DASHBOARD_STATS_CACHE_MS, dashboardStatsCache)
  },
  async getRealTimeData() {
    return await cachedGet('/dashboard/recent', undefined, DASHBOARD_RECENT_CACHE_MS, dashboardRecentCache)
  }
}

export const systemAPI = {
  async getOverview() {
    const res = await api.get('/system/overview')
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) throw new Error(payload.message || '获取系统概览失败')
    return payload.data || payload
  },
  async getStoragePath() {
    const res = await api.get('/system/storage-path')
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) throw new Error(payload.message || '获取数据库路径失败')
    return payload.data || payload
  },
  async saveStoragePath(path) {
    const usedPath = String(path || '').trim()
    if (!usedPath) throw new Error('缺少路径参数')
    const res = await api.put('/system/storage-path', { path: usedPath })
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) throw new Error(payload.message || '保存数据库路径失败')
    return payload.data || payload
  },
  async getSettings() {
    const res = await api.get('/system/settings')
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) throw new Error(payload.message || '获取系统设置失败')
    return payload.data?.settings || payload.settings || payload.data || {}
  },
  async saveSettings(data) {
    const res = await api.put('/system/settings', data)
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) throw new Error(payload.message || '保存系统设置失败')
    return payload.data?.settings || payload.settings || payload.data || {}
  },
  async getCloudSyncConfig() {
    try {
      const res = await api.get('/system/cloud-sync/config')
      const payload = res && typeof res === 'object' ? res : {}
      if (payload.success === false) throw new Error(payload.message || '获取云同步设置失败')
      return normalizeCloudSyncConfig(payload.data || payload)
    } catch (e) {
      if (!isRouteNotFoundError(e)) throw e
      try {
        const res = await api.get('/system/backup/config')
        const payload = res && typeof res === 'object' ? res : {}
        if (payload.success === false) throw new Error(payload.message || '获取云同步设置失败')
        const data = payload.data || payload
        const backup = data && typeof data === 'object' ? (data.backup || data) : {}
        return normalizeCloudSyncConfig(backup)
      } catch (fallbackErr) {
        if (!isRouteNotFoundError(fallbackErr)) throw fallbackErr
        return normalizeCloudSyncConfig({})
      }
    }
  },
  async saveCloudSyncConfig(data) {
    const normalized = normalizeCloudSyncConfig(data)
    try {
      const res = await api.put('/system/cloud-sync/config', normalized)
      const payload = res && typeof res === 'object' ? res : {}
      if (payload.success === false) throw new Error(payload.message || '保存云同步设置失败')
      return normalizeCloudSyncConfig(payload.data || payload)
    } catch (e) {
      if (!isRouteNotFoundError(e)) throw e
      try {
        const res = await api.put('/system/backup/config', {
          enabled: normalized.enabled,
          intervalMinutes: normalized.intervalMinutes,
          collections: normalized.collections,
          exitBackup: normalized.exitSync
        })
        const payload = res && typeof res === 'object' ? res : {}
        if (payload.success === false) throw new Error(payload.message || '保存云同步设置失败')
        const data = payload.data || payload
        const backup = data && typeof data === 'object' ? (data.backup || data) : {}
        return normalizeCloudSyncConfig(backup)
      } catch (fallbackErr) {
        if (!isRouteNotFoundError(fallbackErr)) throw fallbackErr
        return normalized
      }
    }
  },
  async runCloudSync(data = {}) {
    const mode = String(data?.mode || 'incremental').trim().toLowerCase()
    const isForce = mode === 'force' || mode === 'full' || mode === 'all'
    const candidates = [
      { path: '/system/cloud-sync/run', body: data },
      { path: '/manual-sync/sync-to-cloud', body: { mode } },
      { path: isForce ? '/cloud/sync/full' : '/cloud/sync/incremental', body: data },
      { path: isForce ? '/sync/sync/force' : '/sync/sync/incremental', body: { options: data } }
    ]
    let lastError = null
    for (const item of candidates) {
      try {
        const res = await api.post(item.path, item.body)
        const payload = res && typeof res === 'object' ? res : {}
        if (payload.success === false) {
          throw new Error(payload.message || '云同步失败')
        }
        if (Object.prototype.hasOwnProperty.call(payload, 'code') && Number(payload.code) !== 200) {
          throw new Error(payload.message || '云同步失败')
        }
        return payload.data || payload
      } catch (err) {
        if (!isRouteNotFoundError(err)) throw err
        lastError = err
      }
    }
    if (lastError) throw lastError
    throw new Error('云同步失败：未找到可用同步接口')
  },
  async installLocalDbFromCloud(data = {}) {
    try {
      const res = await api.post('/system/local-db/install-from-cloud', data)
      const payload = res && typeof res === 'object' ? res : {}
      if (payload.success === false) throw new Error(payload.message || '安装本地数据库失败')
      return payload.data || payload
    } catch (e) {
      if (!isRouteNotFoundError(e)) throw e
      try {
        const res = await api.post('/manual-sync/sync-from-cloud', data)
        const payload = res && typeof res === 'object' ? res : {}
        if (payload.success === false) throw new Error(payload.message || '安装本地数据库失败')
        return payload.data || payload
      } catch (fallbackErr) {
        if (!isRouteNotFoundError(fallbackErr)) throw fallbackErr
        const res = await api.post('/cloud/sync/from-cloudbase', data)
        const payload = res && typeof res === 'object' ? res : {}
        if (payload.success === false) throw new Error(payload.message || '安装本地数据库失败')
        return payload.data || payload
      }
    }
  },
  async getOperationLogs(params = {}) {
    const res = await api.get('/system/logs/operations', { params })
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) throw new Error(payload.message || '获取操作日志失败')
    return payload.data || payload
  },
  async getSystemLogs(params = {}) {
    const res = await api.get('/system/logs/system', { params })
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) throw new Error(payload.message || '获取系统日志失败')
    return payload.data || payload
  },
  async getErrorLogs(params = {}) {
    const res = await api.get('/system/logs/errors', { params })
    const payload = res && typeof res === 'object' ? res : {}
    if (payload.success === false) throw new Error(payload.message || '获取错误日志失败')
    return payload.data || payload
  }
}

export { api }
