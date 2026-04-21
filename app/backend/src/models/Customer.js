import mongoose from 'mongoose'

// 客户模型定义
const customerSchema = new mongoose.Schema({
  customerCode: {
    type: String,
    required: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 100
  },
  shortName: {
    type: String,
    trim: true,
    maxlength: 50
  },
  type: {
    type: String,
    enum: ['enterprise', 'individual', 'government', 'other'],
    default: 'enterprise'
  },
  contactPerson: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  email: {
    type: String,
    trim: true,
    lowercase: true
  },
  address: {
    type: String,
    trim: true
  },
  province: {
    type: String,
    trim: true
  },
  city: {
    type: String,
    trim: true
  },
  district: {
    type: String,
    trim: true
  },
  industry: {
    type: String,
    trim: true
  },
  creditRating: {
    type: String,
    enum: ['A', 'B', 'C', 'D', 'E'],
    default: 'C'
  },
  creditLimit: {
    type: Number,
    default: 0,
    min: 0
  },
  currentBalance: {
    type: Number,
    default: 0
  },
  totalOrders: {
    type: Number,
    default: 0
  },
  totalAmount: {
    type: Number,
    default: 0
  },
  avgOrderAmount: {
    type: Number,
    default: 0
  },
  lastOrderDate: {
    type: Date
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'blacklisted'],
    default: 'active'
  },
  source: {
    type: String,
    enum: ['pc', 'wechat', 'manual'],
    default: 'pc'
  },
  wechatCustomerId: {
    type: String
  },
  wechatOpenId: {
    type: String
  },
  notes: {
    type: String,
    default: ''
  },
  tags: [{
    type: String,
    trim: true
  }],
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
})

// 计算客户等级的虚拟字段
customerSchema.virtual('customerLevel').get(function() {
  if (this.totalAmount > 100000) return 'VIP'
  if (this.totalAmount > 50000) return '重要客户'
  if (this.totalAmount > 10000) return '普通客户'
  return '新客户'
})

// 检查信用额度是否超限
customerSchema.virtual('isCreditExceeded').get(function() {
  return this.creditLimit > 0 && this.currentBalance > this.creditLimit
})

// 更新客户统计信息
customerSchema.methods.updateStats = async function() {
  const Order = mongoose.model('Order')
  
  const stats = await Order.aggregate([
    { $match: { customerId: this._id, status: { $ne: 'cancelled' } } },
    {
      $group: {
        _id: null,
        totalOrders: { $sum: 1 },
        totalAmount: { $sum: '$finalAmount' },
        lastOrderDate: { $max: '$createdAt' }
      }
    }
  ])
  
  if (stats.length > 0) {
    this.totalOrders = stats[0].totalOrders
    this.totalAmount = stats[0].totalAmount
    this.avgOrderAmount = stats[0].totalOrders > 0 ? stats[0].totalAmount / stats[0].totalOrders : 0
    this.lastOrderDate = stats[0].lastOrderDate
  } else {
    this.totalOrders = 0
    this.totalAmount = 0
    this.avgOrderAmount = 0
    this.lastOrderDate = null
  }
  
  return this.save()
}

// 处理客户余额更新
customerSchema.methods.updateBalance = function(amount, type = 'income') {
  if (type === 'income') {
    this.currentBalance += amount
  } else if (type === 'expense') {
    this.currentBalance -= amount
  }
  
  // 检查信用额度
  if (this.creditLimit > 0 && this.currentBalance > this.creditLimit) {
    this.status = 'blacklisted'
  }
  
  return this.save()
}

// 静态方法：生成客户编码
customerSchema.statics.generateCustomerCode = async function() {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  
  const prefix = `CUST${year}${month}`
  
  // 查找当月最后一个客户
  const lastCustomer = await this.findOne({
    customerCode: new RegExp(`^${prefix}`)
  }).sort({ customerCode: -1 })
  
  let sequence = 1
  if (lastCustomer) {
    const lastSequence = parseInt(lastCustomer.customerCode.slice(-3))
    sequence = lastSequence + 1
  }
  
  return `${prefix}${String(sequence).padStart(3, '0')}`
}

// 静态方法：获取客户统计
customerSchema.statics.getCustomerStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalCreditLimit: { $sum: '$creditLimit' },
        totalBalance: { $sum: '$currentBalance' },
        avgBalance: { $avg: '$currentBalance' }
      }
    }
  ])
  
  return stats
}

// 静态方法：按行业统计
customerSchema.statics.getIndustryStats = async function() {
  const stats = await this.aggregate([
    { $match: { industry: { $ne: null, $ne: '' } } },
    {
      $group: {
        _id: '$industry',
        count: { $sum: 1 },
        totalAmount: { $sum: '$totalAmount' },
        avgOrderAmount: { $avg: '$avgOrderAmount' }
      }
    },
    { $sort: { totalAmount: -1 } }
  ])
  
  return stats
}

// 创建索引
customerSchema.index({ customerCode: 1 }, { unique: true })
customerSchema.index({ name: 1 })
customerSchema.index({ phone: 1 })
customerSchema.index({ email: 1 })
customerSchema.index({ type: 1 })
customerSchema.index({ status: 1 })
customerSchema.index({ creditRating: 1 })
customerSchema.index({ industry: 1 })
customerSchema.index({ createdAt: -1 })
customerSchema.index({ lastOrderDate: -1 })
customerSchema.index({ wechatCustomerId: 1 }, { unique: true, sparse: true })
customerSchema.index({ wechatOpenId: 1 }, { unique: true, sparse: true })

const Customer = mongoose.model('Customer', customerSchema)

export default Customer