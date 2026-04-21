import { DataTypes } from 'sequelize'
import { sequelize } from '../../utils/sqliteDatabase.js'
import syncService from '../../services/syncService.js'

const Order = sequelize.define('Order', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  orderType: {
    type: DataTypes.STRING
  },
  purchaseCategory: {
    type: DataTypes.STRING
  },
  orderNo: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: { notEmpty: true }
  },
  customerId: {
    type: DataTypes.STRING, // Can store local ID or cloud ID, or both. For now string to be flexible.
    allowNull: true,
    defaultValue: ''
  },
  customerName: {
    type: DataTypes.STRING,
    allowNull: true,
    defaultValue: ''
  },
  supplierId: {
    type: DataTypes.STRING
  },
  supplierName: {
    type: DataTypes.STRING
  },
  contactPerson: {
    type: DataTypes.STRING
  },
  phone: {
    type: DataTypes.STRING
  },
  products: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  },
  items: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: []
  },
  meta: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  },
  totalAmount: {
    type: DataTypes.FLOAT,
    allowNull: false,
    validate: { min: 0 }
  },
  discount: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    validate: { min: 0 }
  },
  finalAmount: {
    type: DataTypes.FLOAT,
    allowNull: false,
    validate: { min: 0 }
  },
  sheetCount: {
    type: DataTypes.INTEGER,
    validate: { min: 0 }
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'pending'
  },
  paymentStatus: {
    type: DataTypes.STRING,
    defaultValue: 'pending'
  },
  paymentMethod: {
    type: DataTypes.STRING,
    defaultValue: 'cash'
  },
  paidAmount: {
    type: DataTypes.FLOAT,
    defaultValue: 0,
    validate: { min: 0 }
  },
  deliveryAddress: {
    type: DataTypes.STRING
  },
  deliveryDate: {
    type: DataTypes.DATE
  },
  actualDeliveryDate: {
    type: DataTypes.DATE
  },
  notes: {
    type: DataTypes.TEXT
  },
  priority: {
    type: DataTypes.STRING,
    defaultValue: 'normal'
  },
  source: {
    type: DataTypes.STRING,
    defaultValue: 'pc'
  },
  wechatOrderId: {
    type: DataTypes.STRING,
    unique: true
  },
  createdBy: {
    type: DataTypes.STRING
  },
  assignedTo: {
    type: DataTypes.STRING
  },
  productionOrderId: {
    type: DataTypes.STRING
  },
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
    { unique: true, fields: ['orderNo'] },
    { unique: true, fields: ['cloudId'] },
    { fields: ['status'] },
    { fields: ['customerId'] },
    { fields: ['createdAt'] }
  ],
  tableName: 'Orders',
  timestamps: true,
  version: true
})

const syncToCloud = async (order, options) => {
  if (options && options.hooks === false) return
  syncService.sync(order, 'orders').catch(err => {
    console.error(`[Order Hook] Sync failed for ${order.orderNo}:`, err)
  })
}

Order.afterCreate(syncToCloud)
Order.afterUpdate(syncToCloud)

export default Order
