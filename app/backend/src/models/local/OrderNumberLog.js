import { DataTypes } from 'sequelize'
import { sequelize } from '../../utils/sqliteDatabase.js'

const OrderNumberLog = sequelize.define('OrderNumberLog', {
  action: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      isIn: [['generate', 'reused', 'confirm', 'release']]
    }
  },
  orderNo: {
    type: DataTypes.STRING,
    allowNull: false
  },
  seq: {
    type: DataTypes.INTEGER
  },
  date: {
    type: DataTypes.STRING
  },
  source: {
    type: DataTypes.STRING,
    defaultValue: 'pc'
  },
  reservationId: {
    type: DataTypes.STRING
  },
  timestamp: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  indexes: [
    {
      fields: ['action', 'timestamp']
    },
    {
      fields: ['date', 'seq']
    }
  ]
})

export default OrderNumberLog
