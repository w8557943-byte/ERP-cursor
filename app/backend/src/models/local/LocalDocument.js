import { DataTypes } from 'sequelize'
import { sequelize } from '../../utils/sqliteDatabase.js'

const LocalDocument = sequelize.define('LocalDocument', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  collection: {
    type: DataTypes.STRING,
    allowNull: false
  },
  docId: {
    type: DataTypes.STRING,
    allowNull: false
  },
  data: {
    type: DataTypes.JSON,
    allowNull: false,
    defaultValue: {}
  }
}, {
  indexes: [
    { unique: true, fields: ['collection', 'docId'] },
    { fields: ['collection'] },
    { fields: ['docId'] }
  ],
  tableName: 'LocalDocuments',
  timestamps: true,
  version: true
})

export default LocalDocument
