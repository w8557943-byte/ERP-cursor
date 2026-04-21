import mongoose from 'mongoose'

// 生产订单模型定义
const productionOrderSchema = new mongoose.Schema({
  productionNo: {
    type: String,
    required: true,
    trim: true
  },
  orderId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Order',
    required: true
  },
  orderNo: {
    type: String,
    required: true
  },
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
  customerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Customer',
    required: true
  },
  customerName: {
    type: String,
    required: true
  },
  quantity: {
    type: Number,
    required: true,
    min: 1
  },
  plannedStartDate: {
    type: Date,
    required: true
  },
  plannedEndDate: {
    type: Date,
    required: true
  },
  actualStartDate: {
    type: Date
  },
  actualEndDate: {
    type: Date
  },
  status: {
    type: String,
    enum: ['pending', 'scheduled', 'in_progress', 'paused', 'completed', 'cancelled'],
    default: 'pending'
  },
  priority: {
    type: String,
    enum: ['low', 'normal', 'high', 'urgent'],
    default: 'normal'
  },
  progress: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  completedQuantity: {
    type: Number,
    default: 0,
    min: 0
  },
  defectiveQuantity: {
    type: Number,
    default: 0,
    min: 0
  },
  qualityRate: {
    type: Number,
    default: 0,
    min: 0,
    max: 100
  },
  assignedWorkers: [{
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    name: String,
    role: String,
    assignedHours: { type: Number, default: 0 }
  }],
  materials: [{
    materialId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Material'
    },
    materialName: String,
    requiredQuantity: Number,
    actualQuantity: Number,
    unit: String
  }],
  equipment: [{
    equipmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Equipment'
    },
    equipmentName: String,
    plannedHours: Number,
    actualHours: Number
  }],
  productionSteps: [{
    stepName: String,
    description: String,
    plannedDuration: Number, // 分钟
    actualDuration: Number,
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed'],
      default: 'pending'
    },
    startTime: Date,
    endTime: Date,
    operator: String,
    notes: String
  }],
  qualityChecks: [{
    checkName: String,
    standard: String,
    result: {
      type: String,
      enum: ['pass', 'fail', 'pending']
    },
    checkedBy: String,
    checkedAt: Date,
    notes: String
  }],
  estimatedCost: {
    type: Number,
    default: 0
  },
  actualCost: {
    type: Number,
    default: 0
  },
  notes: {
    type: String,
    default: ''
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  supervisor: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
})

// 计算生产周期的虚拟字段
productionOrderSchema.virtual('plannedDuration').get(function() {
  if (!this.plannedStartDate || !this.plannedEndDate) return 0
  return (this.plannedEndDate - this.plannedStartDate) / (1000 * 60 * 60 * 24) // 天数
})

productionOrderSchema.virtual('actualDuration').get(function() {
  if (!this.actualStartDate || !this.actualEndDate) return 0
  return (this.actualEndDate - this.actualStartDate) / (1000 * 60 * 60 * 24) // 天数
})

// 计算生产效率
productionOrderSchema.virtual('efficiency').get(function() {
  if (this.actualDuration === 0) return 0
  return ((this.plannedDuration - this.actualDuration) / this.plannedDuration * 100).toFixed(2)
})

// 更新生产进度
productionOrderSchema.methods.updateProgress = function(completedQty, defectiveQty = 0) {
  this.completedQuantity = completedQty
  this.defectiveQuantity = defectiveQty
  
  // 计算进度百分比
  if (this.quantity > 0) {
    this.progress = Math.min(100, Math.max(0, (completedQty / this.quantity) * 100))
  }
  
  // 计算合格率
  if (completedQty > 0) {
    this.qualityRate = ((completedQty - defectiveQty) / completedQty * 100).toFixed(2)
  }
  
  // 自动更新状态
  if (this.progress >= 100) {
    this.status = 'completed'
    this.actualEndDate = new Date()
  } else if (this.progress > 0 && this.status === 'pending') {
    this.status = 'in_progress'
    if (!this.actualStartDate) {
      this.actualStartDate = new Date()
    }
  }
  
  return this.save()
}

// 添加生产步骤
productionOrderSchema.methods.addProductionStep = function(stepData) {
  this.productionSteps.push({
    ...stepData,
    status: 'pending'
  })
  return this.save()
}

// 更新生产步骤状态
productionOrderSchema.methods.updateStepStatus = function(stepIndex, status, operator = null) {
  if (stepIndex >= 0 && stepIndex < this.productionSteps.length) {
    const step = this.productionSteps[stepIndex]
    step.status = status
    
    if (status === 'in_progress' && !step.startTime) {
      step.startTime = new Date()
      step.operator = operator
    } else if (status === 'completed' && !step.endTime) {
      step.endTime = new Date()
      step.actualDuration = (step.endTime - step.startTime) / (1000 * 60) // 分钟
    }
  }
  
  return this.save()
}

// 添加质量检查
productionOrderSchema.methods.addQualityCheck = function(checkData) {
  this.qualityChecks.push({
    ...checkData,
    checkedAt: new Date()
  })
  return this.save()
}

// 静态方法：生成生产单号
productionOrderSchema.statics.generateProductionNo = async function() {
  const today = new Date()
  const year = today.getFullYear()
  const month = String(today.getMonth() + 1).padStart(2, '0')
  const day = String(today.getDate()).padStart(2, '0')
  
  const prefix = `PROD${year}${month}${day}`
  
  // 查找当天的最后一个生产订单
  const lastOrder = await this.findOne({
    productionNo: new RegExp(`^${prefix}`)
  }).sort({ productionNo: -1 })
  
  let sequence = 1
  if (lastOrder) {
    const lastSequence = parseInt(lastOrder.productionNo.slice(-4))
    sequence = lastSequence + 1
  }
  
  return `${prefix}${String(sequence).padStart(4, '0')}`
}

// 静态方法：获取生产统计
productionOrderSchema.statics.getProductionStats = async function(startDate, endDate) {
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
        totalQuantity: { $sum: '$quantity' },
        avgProgress: { $avg: '$progress' },
        avgQualityRate: { $avg: '$qualityRate' }
      }
    }
  ])
  
  return stats
}

// 静态方法：获取生产效率统计
productionOrderSchema.statics.getEfficiencyStats = async function() {
  const stats = await this.aggregate([
    { $match: { status: 'completed', actualDuration: { $gt: 0 } } },
    {
      $group: {
        _id: null,
        avgEfficiency: { $avg: '$efficiency' },
        avgDuration: { $avg: '$actualDuration' },
        totalCompleted: { $sum: '$completedQuantity' }
      }
    }
  ])
  
  return stats.length > 0 ? stats[0] : null
}

// 创建索引
productionOrderSchema.index({ productionNo: 1 })
productionOrderSchema.index({ orderId: 1 })
productionOrderSchema.index({ productId: 1 })
productionOrderSchema.index({ customerId: 1 })
productionOrderSchema.index({ status: 1 })
productionOrderSchema.index({ priority: 1 })
productionOrderSchema.index({ plannedStartDate: 1 })
productionOrderSchema.index({ plannedEndDate: 1 })
productionOrderSchema.index({ createdAt: -1 })

const ProductionOrder = mongoose.model('ProductionOrder', productionOrderSchema)

export default ProductionOrder