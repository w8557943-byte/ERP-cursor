import mongoose from 'mongoose'

// 数据库连接配置
class Database {
  constructor() {
    this.isConnected = false
    this.connection = null
  }

  // 连接数据库
  async connect() {
    if (this.isConnected) {
      return this.connection
    }

    try {
      const mongoURI = process.env.MONGODB_URI
      if (!mongoURI) {
        throw new Error('MONGODB_URI 未配置')
      }
      
      const options = {
        useNewUrlParser: true,
        useUnifiedTopology: true,
        serverSelectionTimeoutMS: 10000,
        socketTimeoutMS: 45000,
        maxPoolSize: 10,
        minPoolSize: 5,
        bufferCommands: false
      }

      console.log(`🔄 正在连接MongoDB: ${mongoURI}`)
      this.connection = await mongoose.connect(mongoURI, options)
      this.isConnected = true

      console.log('✅ MongoDB连接成功')
      console.log(`📍 数据库: ${mongoURI.split('/').pop()}`)
      
      return this.connection

    } catch (error) {
      console.error('❌ MongoDB连接失败:', error)
      console.error(`📋 连接字符串: ${process.env.MONGODB_URI || '未设置'}`)
      throw error
    }
  }

  // 断开数据库连接
  async disconnect() {
    if (this.isConnected) {
      await mongoose.disconnect()
      this.isConnected = false
      this.connection = null
      console.log('🔌 MongoDB连接已断开')
    }
  }

  // 获取连接状态
  getStatus() {
    return {
      isConnected: this.isConnected,
      readyState: mongoose.connection.readyState,
      host: mongoose.connection.host,
      name: mongoose.connection.name
    }
  }

  // 健康检查
  async healthCheck() {
    if (!this.isConnected) {
      return {
        status: 'disconnected',
        message: '数据库未连接'
      }
    }

    try {
      await mongoose.connection.db.admin().ping()
      return {
        status: 'connected',
        message: '数据库连接正常'
      }
    } catch (error) {
      return {
        status: 'error',
        message: `数据库连接异常: ${error.message}`
      }
    }
  }

  // 清理数据库连接
  async cleanup() {
    try {
      await this.disconnect()
    } catch (error) {
      console.error('清理数据库连接时出错:', error)
    }
  }
}

// 创建数据库单例
const database = new Database()

// 导出数据库实例和连接函数
export { database }
export default database
