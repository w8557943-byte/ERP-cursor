import mongoose from 'mongoose'

// 订单模型定义
const orderSchema = new mongoose.Schema({
  orderType: {
    type: String
  },
  purchaseCategory: {
    type: String
  },
  supplierId: {
    type: String
  },
  supplierName: {
    type: String
  },
  items: {
    type: mongoose.Schema.Types.Mixed,
    default: []
  },
  meta: {
    type: mongoose.Schema.Types.Mixed,
    default: {}
  },
  orderNo: {
    type: String,
    required: true,
    trim: true
  },
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  customerName: {
    type: String,
    required: true,
    trim: true
  },
  contactPerson: {
    type: String,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  products: [{
    productId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Product',
      required: true
    },
    productName: {
      type: String,
      required: true
    },
    materialCode: {
      type: String,
      trim: true
    },
    materialNo: {
      type: String,
      trim: true
    },
    boardSize: {
      type: String,
      trim: true
    },
    specification: {
      type: String,
      default: ''
    },
    quantity: {
      type: Number,
      required: true,
      min: 1
    },
    unitPrice: {
      type: Number,
      required: true,
      min: 0
    },
    totalPrice: {
      type: Number,
      required: true,
      min: 0
    }
  }],
  totalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  discount: {
    type: Number,
    default: 0,
    min: 0
  },
  finalAmount: {
    type: Number,
    required: true,
    min: 0
  },
  sheetCount: {
    type: Number,
    min: 0
  },
  status: {
    type: String,
    enum: ['pending', 'confirmed', 'processing', 'shipped', 'completed', 'cancelled', 'refunded'],
    default: 'pending'
  },
  paymentStatus: {
    type: String,
    enum: ['pending', 'paid', 'partial', 'overdue', 'refunded'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['cash', 'bank_transfer', 'wechat_pay', 'alipay', 'credit'],
    default: 'cash'
  },
  paidAmount: {
    type: Number,
    default: 0,
    min: 0
  },
  deliveryAddress: {
    type: String,
    trim: true
  },
  deliveryDate: {
    type: Date
  },
  actualDeliveryDate: {
    type: Date
  },
  notes: {
    type: String,
    default: ''
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  source: {
    type: String,
    enum: ['pc', 'wechat', 'manual'],
    default: 'pc'
  },
  wechatOrderId: {
    type: String
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  productionOrderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'ProductionOrder'
  }
}, {
  timestamps: true
})

// 计算订单总金额的虚拟字段
orderSchema.virtual('remainingAmount').get(function() {
  return this.finalAmount - this.paidAmount
})

// 计算订单项小计
orderSchema.methods.calculateProductTotal = function() {
  this.products.forEach(product => {
    product.totalPrice = product.quantity * product.unitPrice
  })
}

// 计算订单总金额
orderSchema.methods.calculateTotalAmount = function() {
  this.totalAmount = this.products.reduce((sum, product) => sum + product.totalPrice, 0)
  this.finalAmount = this.totalAmount - this.discount
}

// 更新订单状态
orderSchema.methods.updateStatus = function(newStatus) {
  this.status = newStatus
  
  // 自动更新相关时间戳
  if (newStatus === 'completed') {
    this.actualDeliveryDate = new Date()
  }
  
  return this.save()
}

// 处理付款
orderSchema.methods.processPayment = function(amount, method = null) {
  this.paidAmount += amount
  
  if (method) {
    this.paymentMethod = method
  }
  
  // 更新付款状态
  if (this.paidAmount >= this.finalAmount) {
    this.paymentStatus = 'paid'
  } else if (this.paidAmount > 0) {
    this.paymentStatus = 'partial'
  }
  
  return this.save()
}

// 静态方法：生成订单号
orderSchema.statics.generateOrderNo = async function() {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  
  const prefix = `ORD${year}${month}${day}`
  
  // 查找当天的最后一个订单
  const lastOrder = await this.findOne({
    orderNo: new RegExp(`^${prefix}`)
  }).sort({ orderNo: -1 })
  
  let sequence = 1
  if (lastOrder) {
    const lastSequence = parseInt(lastOrder.orderNo.slice(-4))
    sequence = lastSequence + 1
  }
  
  return `${prefix}${String(sequence).padStart(4, '0')}`
}

// 静态方法：获取订单统计
orderSchema.statics.getOrderStats = async function(startDate, endDate) {
  const matchStage = {}
  
  if (startDate || endDate) {
    matchStage.createdAt = {}
    if (startDate) matchStage.createdAt.$gte = new Date(startDate)
    if (endDate) matchStage.createdAt.$lte = new Date(endDate)
  }
  
  const stats = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalAmount: { $sum: '$finalAmount' },
        avgAmount: { $avg: '$finalAmount' }
      }
    }
  ])
  
  return stats
}

// 创建索引
orderSchema.index({ orderNo: 1 }, { unique: true })
orderSchema.index({ customerId: 1 })
orderSchema.index({ status: 1 })
orderSchema.index({ paymentStatus: 1 })
orderSchema.index({ createdAt: -1 })
orderSchema.index({ deliveryDate: 1 })
orderSchema.index({ wechatOrderId: 1 }, { unique: true, sparse: true })
orderSchema.index({ createdBy: 1 })
orderSchema.index({ assignedTo: 1 })
orderSchema.index({ status: 1, createdAt: -1 })
orderSchema.index({ orderType: 1, createdAt: -1 })
orderSchema.index({ source: 1, createdAt: -1 })
orderSchema.index({ purchaseCategory: 1, createdAt: -1 })
orderSchema.index({ supplierId: 1, status: 1, createdAt: -1 })
orderSchema.index({ isDeleted: 1, createdAt: -1 })
orderSchema.index({ isDeleted: 1, status: 1, createdAt: -1 })
orderSchema.index({ isDeleted: 1, customerId: 1, createdAt: -1 })
orderSchema.index({ isDeleted: 1, supplierId: 1, createdAt: -1 })
orderSchema.index({ isDeleted: 1, orderType: 1, createdAt: -1 })

const Order = mongoose.model('Order', orderSchema)

export default Order
