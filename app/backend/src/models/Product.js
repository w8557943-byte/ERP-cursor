import mongoose from 'mongoose'

// 产品模型定义
const productSchema = new mongoose.Schema({
  productCode: {
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
  category: {
    type: String,
    required: true,
    trim: true
  },
  subcategory: {
    type: String,
    trim: true
  },
  specification: {
    type: String,
    trim: true
  },
  material: {
    type: String,
    trim: true
  },
  size: {
    length: { type: Number, default: 0 },
    width: { type: Number, default: 0 },
    height: { type: Number, default: 0 },
    unit: { type: String, default: 'mm' }
  },
  weight: {
    value: { type: Number, default: 0 },
    unit: { type: String, default: 'g' }
  },
  color: {
    type: String,
    trim: true
  },
  unit: {
    type: String,
    required: true,
    default: '个'
  },
  price: {
    type: Number,
    required: true,
    min: 0
  },
  cost: {
    type: Number,
    required: true,
    min: 0
  },
  profitMargin: {
    type: Number,
    default: 0
  },
  stock: {
    type: Number,
    default: 0,
    min: 0
  },
  minStock: {
    type: Number,
    default: 0,
    min: 0
  },
  maxStock: {
    type: Number,
    default: 0,
    min: 0
  },
  safetyStock: {
    type: Number,
    default: 0,
    min: 0
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'discontinued'],
    default: 'active'
  },
  isCustomizable: {
    type: Boolean,
    default: false
  },
  leadTime: {
    type: Number,
    default: 0, // 生产周期（天）
    min: 0
  },
  images: [{
    url: String,
    alt: String,
    isPrimary: { type: Boolean, default: false }
  }],
  description: {
    type: String,
    default: ''
  },
  features: [{
    type: String,
    trim: true
  }],
  tags: [{
    type: String,
    trim: true
  }],
  source: {
    type: String,
    enum: ['pc', 'wechat', 'manual'],
    default: 'pc'
  },
  wechatProductId: {
    type: String
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
})

// 计算利润率的虚拟字段
productSchema.virtual('calculatedProfitMargin').get(function() {
  if (this.cost === 0) return 0
  return ((this.price - this.cost) / this.cost * 100).toFixed(2)
})

// 检查库存状态的虚拟字段
productSchema.virtual('stockStatus').get(function() {
  if (this.stock <= 0) return 'out_of_stock'
  if (this.stock <= this.safetyStock) return 'low_stock'
  if (this.stock > this.maxStock && this.maxStock > 0) return 'over_stock'
  return 'normal'
})

// 更新库存
productSchema.methods.updateStock = function(quantity, type = 'in') {
  if (type === 'in') {
    this.stock += quantity
  } else if (type === 'out') {
    if (this.stock < quantity) {
      throw new Error('库存不足')
    }
    this.stock -= quantity
  }
  
  return this.save()
}

// 检查是否需要补货
productSchema.methods.needsReorder = function() {
  return this.stock <= this.minStock
}

// 计算库存价值
productSchema.methods.calculateStockValue = function() {
  return this.stock * this.cost
}

// 静态方法：生成产品编码
productSchema.statics.generateProductCode = async function() {
  const prefix = 'PROD'
  
  // 查找最后一个产品
  const lastProduct = await this.findOne({
    productCode: new RegExp(`^${prefix}`)
  }).sort({ productCode: -1 })
  
  let sequence = 1
  if (lastProduct) {
    const lastSequence = parseInt(lastProduct.productCode.slice(-4))
    sequence = lastSequence + 1
  }
  
  return `${prefix}${String(sequence).padStart(4, '0')}`
}

// 静态方法：获取产品统计
productSchema.statics.getProductStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
        totalStock: { $sum: '$stock' },
        totalValue: { $sum: { $multiply: ['$stock', '$cost'] } },
        avgPrice: { $avg: '$price' },
        avgCost: { $avg: '$cost' }
      }
    }
  ])
  
  return stats
}

// 静态方法：按分类统计
productSchema.statics.getCategoryStats = async function() {
  const stats = await this.aggregate([
    {
      $group: {
        _id: '$category',
        count: { $sum: 1 },
        totalStock: { $sum: '$stock' },
        totalValue: { $sum: { $multiply: ['$stock', '$cost'] } },
        avgPrice: { $avg: '$price' },
        avgProfitMargin: { $avg: '$profitMargin' }
      }
    },
    { $sort: { count: -1 } }
  ])
  
  return stats
}

// 静态方法：获取低库存产品
productSchema.statics.getLowStockProducts = async function() {
  return this.find({
    $expr: {
      $and: [
        { $gt: ['$minStock', 0] },
        { $lte: ['$stock', '$minStock'] }
      ]
    },
    status: 'active'
  }).sort({ stock: 1 })
}

// 静态方法：获取缺货产品
productSchema.statics.getOutOfStockProducts = async function() {
  return this.find({
    stock: 0,
    status: 'active'
  }).sort({ name: 1 })
}

// 创建索引
productSchema.index({ productCode: 1 }, { unique: true })
productSchema.index({ name: 1 })
productSchema.index({ category: 1 })
productSchema.index({ status: 1 })
productSchema.index({ price: 1 })
productSchema.index({ stock: 1 })
productSchema.index({ createdAt: -1 })
productSchema.index({ wechatProductId: 1 }, { unique: true, sparse: true })

const Product = mongoose.model('Product', productSchema)

export default Product