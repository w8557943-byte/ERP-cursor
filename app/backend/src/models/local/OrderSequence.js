import { DataTypes } from 'sequelize'
import { sequelize } from '../../utils/sqliteDatabase.js'

const OrderSequence = sequelize.define('OrderSequence', {
  date: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true
  },
  seq: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  lastUpdated: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
})

export default OrderSequence
