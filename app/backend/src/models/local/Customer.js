import { DataTypes } from 'sequelize'
import { sequelize } from '../../utils/sqliteDatabase.js'
import syncService from '../../services/syncService.js'

const Customer = sequelize.define('Customer', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  customerCode: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: { notEmpty: true }
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: { notEmpty: true }
  },
  shortName: {
    type: DataTypes.STRING(50)
  },
  type: {
    type: DataTypes.ENUM('enterprise', 'individual', 'government', 'other'),
    defaultValue: 'enterprise'
  },
  contactPerson: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { notEmpty: true }
  },
  phone: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: { notEmpty: true }
  },
  email: {
    type: DataTypes.STRING,
    validate: { isEmail: true }
  },
  address: {
    type: DataTypes.STRING
  },
  province: {
    type: DataTypes.STRING
  },
  city: {
    type: DataTypes.STRING
  },
  district: {
    type: DataTypes.STRING
  },
  industry: {
    type: DataTypes.STRING
  },
  creditRating: {
    type: DataTypes.ENUM('A', 'B', 'C', 'D', 'E'),
    defaultValue: 'C'
  },
  creditLimit: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    validate: { min: 0 }
  },
  currentBalance: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  totalOrders: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  totalAmount: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  avgOrderAmount: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  lastOrderDate: {
    type: DataTypes.DATE
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'blacklisted'),
    defaultValue: 'active'
  },
  source: {
    type: DataTypes.ENUM('pc', 'wechat', 'manual'),
    defaultValue: 'pc'
  },
  wechatCustomerId: {
    type: DataTypes.STRING,
    unique: true
  },
  wechatOpenId: {
    type: DataTypes.STRING,
    unique: true
  },
  notes: {
    type: DataTypes.TEXT
  },
  tags: {
    type: DataTypes.JSON, // Stores array of strings
    defaultValue: []
  },
  createdBy: {
    type: DataTypes.STRING // Storing ID as string for now, or link to local User model if exists
  },
  
  // Cloud Sync Fields
  cloudId: {
    type: DataTypes.STRING,
    unique: true
  },
  lastSyncedAt: {
    type: DataTypes.DATE
  },
  syncStatus: {
    type: DataTypes.ENUM('synced', 'pending', 'conflict', 'error'),
    defaultValue: 'pending'
  }
}, {
  indexes: [
    { unique: true, fields: ['customerCode'] },
    { unique: true, fields: ['cloudId'] },
    { fields: ['status'] },
    { fields: ['name'] }
  ],
  timestamps: true,
  version: true
})

// Hooks for Cloud Sync
const syncToCloud = async (customer, options) => {
  if (options && options.hooks === false) return
  syncService.sync(customer, 'customers').catch(err => {
    console.error(`[Customer Hook] Sync failed for ${customer.customerCode}:`, err)
  })
}

Customer.afterCreate(syncToCloud)
Customer.afterUpdate(syncToCloud)

export default Customer
