import { DataTypes } from 'sequelize';
import { sequelize } from '../../utils/sqliteDatabase.js';

const SyncQueue = sequelize.define('SyncQueue', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  topic: {
    type: DataTypes.STRING,
    allowNull: false
  },
  payload: {
    type: DataTypes.BLOB, // Store protobuf bytes
    allowNull: false
  },
  status: {
    type: DataTypes.ENUM('pending', 'processing', 'completed', 'failed'),
    defaultValue: 'pending'
  },
  retryCount: {
    type: DataTypes.INTEGER,
    defaultValue: 0
  },
  errorMessage: {
    type: DataTypes.TEXT
  },
  createdAt: {
    type: DataTypes.DATE,
    defaultValue: DataTypes.NOW
  }
}, {
  timestamps: true,
  updatedAt: 'updatedAt'
});

export default SyncQueue;
