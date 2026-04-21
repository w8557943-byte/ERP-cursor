import { useState, useEffect } from 'react'
import { App } from 'antd'
import { api } from '../services/api'

/**
 * API Hook - 用于处理异步数据获取
 * @param {string} url - API地址
 * @param {Object} options - 请求选项
 * @returns {Object} 包含数据、加载状态和错误的对象
 */
export const useApi = (url, options = {}) => {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  useEffect(() => {
    const fetchData = async () => {
      try {
        setLoading(true)
        setError(null)
        
        const response = await api.get(url, options)
        setData(response.data)
      } catch (err) {
        setError(err)
        console.error('API请求失败:', err)
      } finally {
        setLoading(false)
      }
    }

    if (url) {
      fetchData()
    }
  }, [url])

  const refetch = async () => {
    if (url) {
      const fetchData = async () => {
        try {
          setLoading(true)
          setError(null)
          
          const response = await api.get(url, options)
          setData(response.data)
        } catch (err) {
          setError(err)
          console.error('API请求失败:', err)
        } finally {
          setLoading(false)
        }
      }
      
      fetchData()
    }
  }

  return { data, loading, error, refetch }
}

/**
 * 提交数据 Hook
 * @param {string} url - API地址
 * @param {string} method - 请求方法
 * @returns {[Function, Object]} 提交函数和状态对象
 */
export const useSubmit = (url, method = 'POST') => {
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)
  const { message } = App.useApp()

  const submit = async (data, options = {}) => {
    try {
      setSubmitting(true)
      setError(null)

      const response = await api.request({
        url,
        method,
        data,
        ...options
      })

      message.success('操作成功')
      return response.data
    } catch (err) {
      setError(err)
      message.error(err.message || '操作失败')
      throw err
    } finally {
      setSubmitting(false)
    }
  }

  return [submit, { submitting, error }]
}

/**
 * 数据删除 Hook
 * @param {string} url - API地址
 * @returns {[Function, Object]} 删除函数和状态对象
 */
export const useDelete = (url) => {
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState(null)
  const { message } = App.useApp()

  const deleteItem = async (id) => {
    try {
      setDeleting(true)
      setError(null)

      const response = await api.delete(`${url}/${id}`)
      
      message.success('删除成功')
      return response.data
    } catch (err) {
      setError(err)
      message.error('删除失败')
      throw err
    } finally {
      setDeleting(false)
    }
  }

  return [deleteItem, { deleting, error }]
}