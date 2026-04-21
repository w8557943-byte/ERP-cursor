import fs from 'fs'
import { settingsFilePath, syncDatabase } from '../utils/sqliteDatabase.js'
import cloudbaseService from './cloudbaseService.js'
import Customer from '../models/local/Customer.js'
import Order from '../models/local/Order.js'
import Product from '../models/local/Product.js'
import syncService from './syncService.js'
import { logger } from '../utils/logger.js'

const readSettingsJson = () => {
  try {
    if (fs.existsSync(settingsFilePath)) {
      const raw = fs.readFileSync(settingsFilePath, 'utf8')
      const json = JSON.parse(raw || '{}')
      return json && typeof json === 'object' ? json : {}
    }
  } catch (_) { void 0 }
  return {}
}

const getCloudSyncConfig = () => {
  const settings = readSettingsJson()
  const raw = settings && typeof settings.cloudSyncConfig === 'object'
    ? settings.cloudSyncConfig
    : (settings && typeof settings.backupConfig === 'object' ? settings.backupConfig : {})
  return {
    enabled: Boolean(raw.enabled),
    intervalMinutes: Math.max(10, Number(raw.intervalMinutes || 1440)),
    collections: Array.isArray(raw.collections) ? raw.collections.map((x) => String(x || '').trim()).filter(Boolean) : [],
    exitSync: Boolean(raw.exitSync ?? raw.exitBackup)
  }
}

class LocalCloudSyncScheduler {
  constructor() {
    this._timer = null
    this._lastRunAt = 0
    this._running = false
  }

  start() {
    if (this._timer) return
    const intervalMs = 60 * 1000
    this._timer = setInterval(() => {
      this._tick().catch(() => {})
    }, intervalMs)
    this._tick().catch(() => {})
  }

  stop() {
    if (this._timer) clearInterval(this._timer)
    this._timer = null
  }

  async _tick() {
    if (this._running) return

    const cfg = getCloudSyncConfig()
    if (!cfg.enabled) return

    const now = Date.now()
    const dueMs = cfg.intervalMinutes * 60 * 1000
    if (this._lastRunAt && now - this._lastRunAt < dueMs) return

    this._running = true
    try {
      const ok = await cloudbaseService.initialize().catch(() => false)
      if (!ok) return

      await syncDatabase(false)

      const allow = cfg.collections.length
        ? new Set(cfg.collections.map((x) => String(x || '').trim()).filter(Boolean))
        : new Set(['customers', 'orders', 'products'])

      const syncModels = [
        { name: 'customers', model: Customer },
        { name: 'orders', model: Order },
        { name: 'products', model: Product }
      ].filter((x) => allow.has(x.name))

      const summary = {}
      for (const { name, model } of syncModels) {
        const list = await model.findAll({ where: { syncStatus: 'pending' }, limit: 5000, order: [['updatedAt', 'ASC'], ['id', 'ASC']] })
        let success = 0
        let failed = 0
        for (const row of list || []) {
          const ok = await syncService.sync(row, name, { force: true })
          if (ok) success += 1
          else failed += 1
        }
        summary[name] = { total: (list || []).length, success, failed }
      }

      this._lastRunAt = Date.now()
      logger.info('[本地云同步] 按时云同步完成', { summary, finishedAt: this._lastRunAt })
    } finally {
      this._running = false
    }
  }
}

const localCloudSyncScheduler = new LocalCloudSyncScheduler()

export default localCloudSyncScheduler

