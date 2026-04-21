import { useCallback, useState } from 'react'

/**
 * 本地存储 Hook
 * @param {string} key - 存储键名
 * @param {*} initialValue - 初始值
 * @returns {[any, Function]} 状态值和设置函数
 */
export const useLocalStorage = (key, initialValue) => {
  // 从本地存储获取初始值
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch (error) {
      console.warn(`Error reading localStorage key "${key}":`, error)
      return initialValue
    }
  })

  // 返回包装的setter函数，同时更新本地存储
  const setValue = useCallback((value) => {
    setStoredValue((prev) => {
      const valueToStore = value instanceof Function ? value(prev) : value
      try {
        window.localStorage.setItem(key, JSON.stringify(valueToStore))
      } catch (error) {
        console.warn(`Error setting localStorage key "${key}":`, error)
      }
      return valueToStore
    })
  }, [key])

  return [storedValue, setValue]
}

/**
 * 会话存储 Hook
 * @param {string} key - 存储键名
 * @param {*} initialValue - 初始值
 * @returns {[any, Function]} 状态值和设置函数
 */
export const useSessionStorage = (key, initialValue) => {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.sessionStorage.getItem(key)
      return item ? JSON.parse(item) : initialValue
    } catch (error) {
      console.warn(`Error reading sessionStorage key "${key}":`, error)
      return initialValue
    }
  })

  const setValue = useCallback((value) => {
    setStoredValue((prev) => {
      const valueToStore = value instanceof Function ? value(prev) : value
      try {
        window.sessionStorage.setItem(key, JSON.stringify(valueToStore))
      } catch (error) {
        console.warn(`Error setting sessionStorage key "${key}":`, error)
      }
      return valueToStore
    })
  }, [key])

  return [storedValue, setValue]
}
