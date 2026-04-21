// API配置
export const API_CONFIG = {
  BASE_URL: import.meta.env.VITE_API_BASE_URL || '/api',
  TIMEOUT: 10000,
  RETRY_COUNT: 3
}

// 应用配置
export const APP_CONFIG = {
  TITLE: import.meta.env.VITE_APP_TITLE || 'ERP管理系统',
  VERSION: import.meta.env.VITE_APP_VERSION || '1.0.0'
}

const parseBoolEnv = (value, defaultValue) => {
  if (value === undefined || value === null || value === '') return defaultValue
  const v = String(value).trim().toLowerCase()
  if (v === 'true' || v === '1' || v === 'yes' || v === 'on') return true
  if (v === 'false' || v === '0' || v === 'no' || v === 'off') return false
  return defaultValue
}

export const OPT_FLAGS = {
  ENABLE_CACHED_API: parseBoolEnv(import.meta.env.VITE_ENABLE_CACHED_API, true),
  ENABLE_REQUEST_BATCHER: parseBoolEnv(import.meta.env.VITE_ENABLE_REQUEST_BATCHER, false),
  ENABLE_RATE_LIMITER: parseBoolEnv(import.meta.env.VITE_ENABLE_RATE_LIMITER, true),
  ENABLE_PERFORMANCE_MONITOR: parseBoolEnv(import.meta.env.VITE_ENABLE_PERFORMANCE_MONITOR, true),
  ENABLE_CLOUD_CALL_MONITOR: parseBoolEnv(import.meta.env.VITE_ENABLE_CLOUD_CALL_MONITOR, true)
}

// 路由配置
export const ROUTES = {
  LOGIN: '/login',
  DASHBOARD: '/dashboard',
  ORDERS: '/orders',
  PRODUCTION: '/production',
  CUSTOMERS: '/customers',
  FINANCE: '/finance',
  SETTINGS: '/settings'
}

// 订单状态
export const ORDER_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
}

// 生产状态
export const PRODUCTION_STATUS = {
  PENDING: 'pending',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  PAUSED: 'paused'
}

// 客户等级
export const CUSTOMER_LEVEL = {
  VIP: 'VIP',
  IMPORTANT: '重要',
  NORMAL: '普通'
}
