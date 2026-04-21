import { Sequelize } from 'sequelize'
import path from 'path'
import fs from 'fs'
import os from 'os'

// 确定数据库存储路径
// 优先使用环境变量，否则使用 AppData/RongJiaHeERP/data
const getDatabasePath = () => {
  let finalPath
  if (process.env.SQLITE_DB_PATH) {
    finalPath = process.env.SQLITE_DB_PATH
  } else {
    const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support') : path.join(os.homedir(), '.local/share'))
    const configDir = path.join(appData, 'RongJiaHeERP', 'config')
    const settingsFile = path.join(configDir, 'settings.json')
    try {
      if (fs.existsSync(settingsFile)) {
        const raw = fs.readFileSync(settingsFile, 'utf8')
        const json = JSON.parse(raw || '{}')
        if (json && typeof json.localDbPath === 'string' && json.localDbPath.trim().length > 0) {
          finalPath = String(json.localDbPath).trim()
        }
      }
    } catch (_) { void 0 }
    if (!finalPath) {
      const dataDir = path.join(appData, 'RongJiaHeERP', 'data')
      finalPath = path.join(dataDir, 'local_database.sqlite')
    }
  }
  
  // Ensure directory exists
  const dir = path.dirname(finalPath)
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
  
  return finalPath
}

const dbPath = getDatabasePath()
const settingsFilePath = (() => {
  const appData = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support') : path.join(os.homedir(), '.local/share'))
  const configDir = path.join(appData, 'RongJiaHeERP', 'config')
  if (!fs.existsSync(configDir)) {
    try { fs.mkdirSync(configDir, { recursive: true }) } catch (_) { void 0 }
  }
  return path.join(configDir, 'settings.json')
})()

console.log(`[SQLite] Database path: ${dbPath}`)

// 初始化 Sequelize 实例
const sequelize = new Sequelize({
  dialect: 'sqlite',
  storage: dbPath,
  logging: (msg) => {
    // 仅在开发环境打印 SQL
    if (process.env.NODE_ENV === 'development') {
      console.log(`[Sequelize] ${msg}`)
    }
  },
  retry: {
    match: [/SQLITE_BUSY/, /SQLITE_LOCKED/],
    max: 5
  },
  pool: {
    max: 1,
    min: 0,
    idle: 10000,
    acquire: 30000
  },
  define: {
    timestamps: true, // 自动添加 createdAt, updatedAt
    freezeTableName: true // 表名与模型名一致，不自动复数化
  }
})

// 测试连接
const testConnection = async () => {
  try {
    await sequelize.authenticate()
    await sequelize.query('PRAGMA journal_mode = WAL;')
    await sequelize.query('PRAGMA busy_timeout = 5000;')
    console.log('[SQLite] Connection has been established successfully.')
    return true
  } catch (error) {
    console.error('[SQLite] Unable to connect to the database:', error)
    return false
  }
}

const ensureVersionColumns = async () => {
  const tables = ['Products', 'Orders', 'Customers']
  for (const table of tables) {
    try {
      const info = await sequelize.getQueryInterface().describeTable(table)
      if (info && !info.version) {
        await sequelize.query(`ALTER TABLE "${table}" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;`)
      }
    } catch (_) {
      void 0
    }
  }
}

// 同步模型到数据库
const syncDatabase = async (force = false) => {
  try {
    await sequelize.query('PRAGMA journal_mode = WAL;')
    await sequelize.query('PRAGMA busy_timeout = 5000;')
    
    await sequelize.sync({ force })
    await ensureVersionColumns()
    console.log('[SQLite] All models were synchronized successfully.')
  } catch (error) {
    console.error('[SQLite] Model synchronization failed:', error)
  }
}

const saveLocalDbPath = (newPath) => {
  try {
    const dir = path.dirname(settingsFilePath)
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true })
    }
    const input = String(newPath || '').trim()
    if (!input) return null
    const ext = path.extname(input).toLowerCase()
    const finalPath = ext === '.sqlite' || ext === '.db'
      ? input
      : path.join(input, 'local_database.sqlite')
    const dataDir = path.dirname(finalPath)
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true })
    }
    const payload = { localDbPath: finalPath }
    fs.writeFileSync(settingsFilePath, JSON.stringify(payload, null, 2))
    return finalPath
  } catch (e) {
    console.error('[SQLite] Failed to save settings:', e)
    return null
  }
}

export { sequelize, testConnection, syncDatabase, dbPath, settingsFilePath, saveLocalDbPath }
