/**
 * 工具函数集合
 */

/**
 * 格式化金额
 * @param {number} amount - 金额
 * @param {number} decimals - 小数位数
 * @returns {string} 格式化后的金额
 */
export const formatAmount = (amount, decimals = 2) => {
  if (typeof amount !== 'number') return '0.00'
  return amount.toFixed(decimals).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/**
 * 格式化日期
 * @param {string|Date} date - 日期
 * @param {string} format - 格式
 * @returns {string} 格式化后的日期
 */
export const formatDate = (date, format = 'YYYY-MM-DD') => {
  if (!date) return ''
  
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  
  switch (format) {
    case 'YYYY-MM-DD':
      return `${year}-${month}-${day}`
    case 'YYYY年MM月DD日':
      return `${year}年${month}月${day}日`
    case 'MM/DD/YYYY':
      return `${month}/${day}/${year}`
    default:
      return `${year}-${month}-${day}`
  }
}

/**
 * 深度拷贝对象
 * @param {*} obj - 要拷贝的对象
 * @returns {*} 拷贝后的对象
 */
export const deepClone = (obj) => {
  if (obj === null || typeof obj !== 'object') return obj
  if (obj instanceof Date) return new Date(obj)
  if (obj instanceof Array) return obj.map(item => deepClone(item))
  
  const cloned = {}
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      cloned[key] = deepClone(obj[key])
    }
  }
  return cloned
}

/**
 * 防抖函数
 * @param {Function} func - 要执行的函数
 * @param {number} wait - 等待时间
 * @returns {Function} 防抖后的函数
 */
export const debounce = (func, wait) => {
  let timeout
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout)
      func(...args)
    }
    clearTimeout(timeout)
    timeout = setTimeout(later, wait)
  }
}

/**
 * 节流函数
 * @param {Function} func - 要执行的函数
 * @param {number} limit - 限制时间
 * @returns {Function} 节流后的函数
 */
export const throttle = (func, limit) => {
  let inThrottle
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args)
      inThrottle = true
      setTimeout(() => inThrottle = false, limit)
    }
  }
}

/**
 * 生成随机ID
 * @param {number} length - ID长度
 * @returns {string} 随机ID
 */
export const generateId = (length = 8) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'
  let result = ''
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length))
  }
  return result
}

/**
 * 验证手机号格式
 * @param {string} phone - 手机号
 * @returns {boolean} 是否有效
 */
export const validatePhone = (phone) => {
  const reg = /^1[3-9]\d{9}$/
  return reg.test(phone)
}

/**
 * 验证邮箱格式
 * @param {string} email - 邮箱
 * @returns {boolean} 是否有效
 */
export const validateEmail = (email) => {
  const reg = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
  return reg.test(email)
}

/**
 * 下载文件
 * @param {string} content - 文件内容
 * @param {string} filename - 文件名
 * @param {string} type - 文件类型
 */
export const downloadFile = (content, filename, type = 'text/plain') => {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * 获取文件大小文本
 * @param {number} bytes - 字节数
 * @returns {string} 文件大小文本
 */
export const getFileSizeText = (bytes) => {
  if (bytes === 0) return '0 B'
  
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

/**
 * 数组去重
 * @param {Array} arr - 数组
 * @returns {Array} 去重后的数组
 */
export const uniqueArray = (arr) => {
  return [...new Set(arr)]
}

/**
 * 获取对象中的值
 * @param {Object} obj - 对象
 * @param {string} path - 路径
 * @param {*} defaultValue - 默认值
 * @returns {*} 获取的值
 */
export const get = (obj, path, defaultValue = undefined) => {
  const travel = (regexp) =>
    String.prototype.split
      .call(path, regexp)
      .filter(Boolean)
      .reduce((res, key) => (res !== null && res !== undefined ? res[key] : res), obj)
  
  const result = travel(/[,[\]]+?/) || travel(/[,[\].]+?/)
  return result === undefined || result === obj ? defaultValue : result
}

export const parseSizePair = (input) => {
  const s = String(input || '').trim()
  if (!s) return null
  const lower = s.toLowerCase()
  const hasExplicitSep = /[×x*]/.test(lower)
  const hasSpaceSep = /\d\s+\d/.test(lower)
  if (!hasExplicitSep && !hasSpaceSep) return null
  const nums = lower.match(/\d+(?:\.\d+)?/g)
  if (!nums || nums.length < 2) return null
  const a = Number(nums[0])
  const b = Number(nums[1])
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null
  return { a, b }
}

export const matchSizeKeyword = (keyword, ...values) => {
  const kwPair = parseSizePair(keyword)
  if (!kwPair) return false
  const same = (p) =>
    !!p &&
    ((Number(p.a) === kwPair.a && Number(p.b) === kwPair.b) ||
      (Number(p.a) === kwPair.b && Number(p.b) === kwPair.a))

  for (const v of values) {
    if (v == null || v === '') continue
    if (typeof v === 'object' && v && 'a' in v && 'b' in v) {
      if (same(v)) return true
      continue
    }
    const p = parseSizePair(v)
    if (same(p)) return true
  }
  return false
}

export const extractPaginationFromResponse = (res) => {
  return res?.pagination || res?.data?.pagination || res?.data?.data?.pagination || {}
}

export const extractListFromResponse = (res) => {
  if (Array.isArray(res)) return res
  if (res && Array.isArray(res.data)) return res.data
  if (res && Array.isArray(res.orders)) return res.orders
  if (res && Array.isArray(res.list)) return res.list
  if (res && res.data && Array.isArray(res.data.orders)) return res.data.orders
  if (res && res.data && Array.isArray(res.data.list)) return res.data.list
  if (res && res.data && res.data.data && Array.isArray(res.data.data.orders)) return res.data.data.orders
  if (res && res.data && res.data.data && Array.isArray(res.data.data.list)) return res.data.data.list
  return []
}

export const looksLikeOrderNo = (v) => /^(QXDD|QXBZ)\d{7,12}(?:-\d+)?$/i.test(String(v || '').trim())

export const buildStatementParentChildKeyMap = (rows) => {
  const list = Array.isArray(rows) ? rows : []
  const childrenByParentNo = new Map()
  const parentKeyByNo = new Map()
  const orderNoByKey = new Map()
  const orderKeyByNo = new Map()

  list.forEach((r) => {
    const orderNo = String(r?.orderNo || '').trim()
    const key = String(r?.key ?? '').trim()
    if (!orderNo || !key) return
    orderNoByKey.set(key, orderNo)
    orderKeyByNo.set(orderNo, key)
    const m = orderNo.match(/^(.*?)-(\d+)$/)
    if (m) {
      const parentNo = String(m[1] || '').trim()
      if (!parentNo) return
      const arr = childrenByParentNo.get(parentNo) || []
      arr.push(key)
      childrenByParentNo.set(parentNo, arr)
      return
    }
    parentKeyByNo.set(orderNo, key)
  })

  const map = new Map()
  childrenByParentNo.forEach((childKeys, parentNo) => {
    const uniqChildren = Array.from(new Set((childKeys || []).map((k) => String(k || '').trim()).filter(Boolean)))
    if (!uniqChildren.length) return
    const parentKey = String(parentKeyByNo.get(parentNo) || '').trim()
    if (parentKey) map.set(parentKey, uniqChildren)
    map.set(`group:${parentNo}`, uniqChildren)
    map.set(parentNo, uniqChildren)
  })

  return { parentChildKeyMap: map, parentKeyByNo, orderNoByKey, orderKeyByNo }
}

export const expandStatementKeys = (baseKeys, parentChildKeyMap, orderKeyByNo) => {
  const input = Array.isArray(baseKeys) ? baseKeys : []
  const expandedSet = new Set()

  input.forEach((k) => {
    const s = String(k ?? '').trim()
    if (!s) return
    expandedSet.add(s)

    const mapped = String(orderKeyByNo?.get(s) || '').trim()
    if (mapped) expandedSet.add(mapped)

    const childKeys = parentChildKeyMap?.get(s) || (mapped ? parentChildKeyMap?.get(mapped) : undefined)
    if (childKeys && childKeys.length) {
      childKeys.forEach((ck) => {
        const cs = String(ck ?? '').trim()
        if (cs) expandedSet.add(cs)
      })
    }
  })

  const normalized = []
  expandedSet.forEach((k) => {
    const s = String(k ?? '').trim()
    if (!s) return
    if (s.startsWith('group:')) return
    const mapped = String(orderKeyByNo?.get(s) || '').trim()
    normalized.push(mapped || s)
  })

  return Array.from(new Set(normalized))
}

export const safeNavigateBack = (navigate, fallbackPath = '/', options = {}) => {
  const to = String(fallbackPath || '/').trim() || '/'
  const replace = options?.replace !== undefined ? Boolean(options.replace) : true
  const state = options?.state

  try {
    const idx = window?.history?.state?.idx
    if (typeof idx === 'number' && idx > 0) {
      navigate(-1)
      return
    }
  } catch (_) { void 0 }

  try {
    if (window?.history?.length > 1) {
      navigate(-1)
      return
    }
  } catch (_) { void 0 }

  navigate(to, { replace, state })
}
