import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

// 用户模型定义
const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    trim: true,
    minlength: 3,
    maxlength: 30
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true,
    maxlength: 50
  },
  role: {
    type: String,
    enum: ['admin', 'manager', 'user'],
    default: 'user'
  },
  phone: {
    type: String,
    trim: true
  },
  department: {
    type: String,
    trim: true
  },
  avatar: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['active', 'inactive', 'suspended'],
    default: 'active'
  },
  lastLogin: {
    type: Date,
    default: null
  },
  loginAttempts: {
    type: Number,
    default: 0
  },
  lockUntil: {
    type: Date,
    default: null
  },
  wechatUserId: {
    type: String
  },
  wechatOpenId: {
    type: String
  }
}, {
  timestamps: true,
  toJSON: {
    transform: function(doc, ret) {
      delete ret.password
      delete ret.loginAttempts
      delete ret.lockUntil
      return ret
    }
  }
})

// 密码加密中间件
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next()
  
  try {
    const salt = await bcrypt.genSalt(10)
    this.password = await bcrypt.hash(this.password, salt)
    next()
  } catch (error) {
    next(error)
  }
})

// 密码验证方法
userSchema.methods.comparePassword = async function(candidatePassword) {
  try {
    return await bcrypt.compare(candidatePassword, this.password)
  } catch (error) {
    throw error
  }
}

// 检查账户是否被锁定
userSchema.methods.isLocked = function() {
  return !!(this.lockUntil && this.lockUntil > Date.now())
}

// 增加登录尝试次数
userSchema.methods.incrementLoginAttempts = function() {
  if (this.lockUntil && this.lockUntil < Date.now()) {
    return this.update({
      $set: { loginAttempts: 1 },
      $unset: { lockUntil: 1 }
    })
  }
  
  const updates = { $inc: { loginAttempts: 1 } }
  
  if (this.loginAttempts + 1 >= 5 && !this.isLocked()) {
    updates.$set = { lockUntil: Date.now() + 2 * 60 * 60 * 1000 } // 锁定2小时
  }
  
  return this.update(updates)
}

// 重置登录尝试次数
userSchema.methods.resetLoginAttempts = function() {
  return this.update({
    $set: { loginAttempts: 0 },
    $unset: { lockUntil: 1 }
  })
}

// 静态方法：通过用户名查找用户
userSchema.statics.findByUsername = function(username) {
  return this.findOne({ username: new RegExp('^' + username + '$', 'i') })
}

// 静态方法：通过邮箱查找用户
userSchema.statics.findByEmail = function(email) {
  return this.findOne({ email: new RegExp('^' + email + '$', 'i') })
}

// 静态方法：通过微信用户ID查找用户
userSchema.statics.findByWechatId = function(wechatUserId) {
  return this.findOne({ wechatUserId })
}

// 创建索引
userSchema.index({ username: 1 }, { unique: true })
userSchema.index({ email: 1 }, { unique: true })
userSchema.index({ wechatUserId: 1 }, { unique: true, sparse: true })
userSchema.index({ wechatOpenId: 1 }, { unique: true, sparse: true })
userSchema.index({ role: 1 })
userSchema.index({ status: 1 })
userSchema.index({ createdAt: -1 })

const User = mongoose.model('User', userSchema)

export default User