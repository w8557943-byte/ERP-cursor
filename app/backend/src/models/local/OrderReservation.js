import { DataTypes } from 'sequelize'
import { sequelize } from '../../utils/sqliteDatabase.js'

const OrderReservation = sequelize.define('OrderReservation', {
  orderNo: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  seq: {
    type: DataTypes.INTEGER,
    allowNull: false
  },
  date: {
    type: DataTypes.STRING,
    allowNull: false
  },
  status: {
    type: DataTypes.STRING,
    defaultValue: 'RESERVED',
    validate: {
      isIn: [['RESERVED', 'USED', 'RELEASED']]
    }
  },
  expiresAt: {
    type: DataTypes.DATE,
    allowNull: false
  }
}, {
  indexes: [
    {
      fields: ['status', 'expiresAt']
    },
    {
      unique: true,
      fields: ['date', 'seq']
    }
  ]
})

export default OrderReservation
