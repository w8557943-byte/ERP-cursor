import { customerAPI } from './api'
import { cachedCustomerAPI } from './cachedAPI'

// 使用云端 API，基础地址在 services/api.js 的 axios 实例中统一配置

const customerService = {
  // 获取客户列表
  async getCustomers(params = {}) {
    try {
      const response = await cachedCustomerAPI.getCustomers(params)
      return response
    } catch (error) {
      console.error('获取客户列表失败:', error)
      throw error
    }
  },

  // 创建客户
  async createCustomer(customerData) {
    try {
      const response = await cachedCustomerAPI.createCustomer(customerData)
      return response
    } catch (error) {
      console.error('创建客户失败:', error)
      throw error
    }
  },

  // 更新客户信息
  async updateCustomer(customerId, customerData) {
    try {
      const response = await cachedCustomerAPI.updateCustomer(customerId, customerData)
      return response
    } catch (error) {
      console.error('更新客户失败:', error)
      throw error
    }
  },

  // 删除客户
  async deleteCustomer(customerId) {
    try {
      const response = await cachedCustomerAPI.deleteCustomer(customerId)
      return response
    } catch (error) {
      console.error('删除客户失败:', error)
      throw error
    }
  },

  // 搜索客户
  async searchCustomers(searchTerm) {
    try {
      const response = await cachedCustomerAPI.getCustomers({ q: searchTerm })
      return response
    } catch (error) {
      console.error('搜索客户失败:', error)
      throw error
    }
  },

  // 获取客户统计信息
  async getCustomerStats() {
    try {
      const response = await customerAPI.getCustomerStats()
      return response
    } catch (error) {
      console.error('获取客户统计失败:', error)
      throw error
    }
  }
}

export default customerService
