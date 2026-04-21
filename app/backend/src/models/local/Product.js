import { DataTypes } from 'sequelize'
import { sequelize } from '../../utils/sqliteDatabase.js'
import syncService from '../../services/syncService.js'

const Product = sequelize.define('Product', {
  id: {
    type: DataTypes.INTEGER,
    primaryKey: true,
    autoIncrement: true
  },
  productCode: {
    type: DataTypes.STRING,
    allowNull: false,
    unique: true,
    validate: {
      notEmpty: true
    }
  },
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false,
    validate: {
      notEmpty: true
    }
  },
  subcategory: {
    type: DataTypes.STRING
  },
  specification: {
    type: DataTypes.STRING
  },
  material: {
    type: DataTypes.STRING
  },
  size: {
    type: DataTypes.JSON,
    defaultValue: { length: 0, width: 0, height: 0, unit: 'mm' }
  },
  weight: {
    type: DataTypes.JSON,
    defaultValue: { value: 0, unit: 'g' }
  },
  color: {
    type: DataTypes.STRING
  },
  unit: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: '个'
  },
  price: {
    type: DataTypes.FLOAT, // or DECIMAL(10, 2)
    allowNull: false,
    validate: {
      min: 0
    }
  },
  cost: {
    type: DataTypes.FLOAT,
    allowNull: false,
    validate: {
      min: 0
    }
  },
  profitMargin: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  stock: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  minStock: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  maxStock: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  safetyStock: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  status: {
    type: DataTypes.ENUM('active', 'inactive', 'discontinued'),
    defaultValue: 'active'
  },
  isCustomizable: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  leadTime: {
    type: DataTypes.INTEGER,
    defaultValue: 0,
    validate: {
      min: 0
    }
  },
  images: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  description: {
    type: DataTypes.TEXT,
    defaultValue: ''
  },
  features: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  tags: {
    type: DataTypes.JSON,
    defaultValue: []
  },
  source: {
    type: DataTypes.ENUM('pc', 'wechat', 'manual'),
    defaultValue: 'pc'
  },
  wechatProductId: {
    type: DataTypes.STRING,
    unique: true
  },
  createdBy: {
    type: DataTypes.STRING,
    allowNull: false,
    defaultValue: ''
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
  // Model options
  indexes: [
    {
      unique: true,
      fields: ['productCode']
    },
    {
      fields: ['category']
    },
    {
      fields: ['status']
    },
    {
      unique: true,
      fields: ['cloudId']
    }
  ],
  tableName: 'Products',
  timestamps: true,
  version: true
})

const syncToCloud = async (product, options) => {
  if (options && options.hooks === false) return

  syncService.syncProduct(product).catch(err => {
    console.error(`[Product Hook] Sync failed for ${product.productCode}:`, err)
  })
}

Product.afterCreate(syncToCloud)
Product.afterUpdate(syncToCloud)

export default Product
