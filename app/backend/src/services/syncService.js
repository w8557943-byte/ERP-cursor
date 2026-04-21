import { logger } from '../utils/logger.js'
import cloudbaseService from './cloudbaseService.js'

class SyncService {
  constructor() {
    this.defaultCollection = 'products'
  }

  shouldSyncToCloud() {
    const enabled = String(process.env.ENABLE_CLOUD_SYNC || '').toLowerCase() === 'true'
    if (!enabled) return false

    const envId = process.env.WECHAT_CLOUD_ENV_ID || process.env.WX_CLOUD_ENV
    if (!envId) return false

    const hasSecret = Boolean(process.env.TCB_SECRET_ID && process.env.TCB_SECRET_KEY)
    const hasPem = Boolean(process.env.WECHAT_API_KEY_ID && process.env.WECHAT_API_KEY)
    const hasCliPem = Boolean(process.env.WECHAT_CLI_SECRET && process.env.WECHAT_API_KEY)
    const allowDefault = String(process.env.CLOUDBASE_ALLOW_DEFAULT_CREDS || '').toLowerCase() === 'true'

    return hasSecret || hasPem || hasCliPem || allowDefault
  }

  /**
   * Sync a local entity to the cloud
   * @param {Object} entity - Sequelize instance (Product, Order, Customer)
   * @param {String} collectionName - CloudBase collection name
   * @param {Object} options
   */
  async sync(entity, collectionName, options = {}) {
    if (!entity) return
    if (!collectionName) collectionName = this.defaultCollection

    // Identify key identifier for logging
    const entityId = entity.id
    const entityCode = entity.productCode || entity.orderNo || entity.customerCode || entity.id
    
    try {
      if (!options.force && !this.shouldSyncToCloud()) {
        return false
      }

      logger.info(`[Sync] Starting sync for ${collectionName} - ${entityCode} (Local ID: ${entityId})`)

      // Ensure cloud service is ready
      const ok = await cloudbaseService.initialize().catch(() => false)
      if (!ok) {
        return false
      }

      const db = cloudbaseService.db
      if (!db) {
        return false
      }

      const collection = db.collection(collectionName)
      
      // Prepare data for cloud
      // Convert Sequelize instance to plain object
      const entityData = entity.toJSON()
      
      // Remove local-specific fields that shouldn't be in cloud or are managed by cloud
      const { 
        id, // Local ID (integer)
        cloudId, 
        syncStatus, 
        lastSyncedAt, 
        createdAt, 
        updatedAt, 
        ...cloudPayload 
      } = entityData

      // Add timestamps
      cloudPayload.updatedAt = new Date()
      
      let resultCloudId = cloudId

      if (cloudId) {
        // Update existing document in cloud
        logger.info(`[Sync] Updating cloud document ${cloudId} in ${collectionName}`)
        try {
            await collection.doc(cloudId).update(cloudPayload)
        } catch (err) {
            // Check if document missing error?
            // For now, assume error means failure
            throw err
        }
      } else {
        // Create new document in cloud
        logger.info(`[Sync] Creating new cloud document for ${entityCode} in ${collectionName}`)
        cloudPayload.createdAt = new Date()
        const res = await collection.add(cloudPayload)
        // cloudbase-node-sdk returns { id: "..." } or similar
        resultCloudId = res.id || res._id
        logger.info(`[Sync] Created cloud document with ID: ${resultCloudId}`)
      }

      // Update local record with success status
      // Use hooks: false to prevent triggering sync loop
      // Use direct Model update to avoid instance state issues
      await entity.constructor.update({
        cloudId: resultCloudId,
        lastSyncedAt: new Date(),
        syncStatus: 'synced'
      }, { 
        where: { id: entityId },
        hooks: false 
      })

      // Update in-memory instance
      entity.cloudId = resultCloudId
      entity.lastSyncedAt = new Date()
      entity.syncStatus = 'synced'

      logger.info(`[Sync] Successfully synced ${collectionName} - ${entityCode}`)
      return true
      
    } catch (error) {
      logger.error(`[Sync] Failed to sync ${collectionName} - ${entityCode}:`, error)
      
      // Update local record with error status
      try {
        await entity.constructor.update({
          syncStatus: 'error'
        }, { 
            where: { id: entityId },
            hooks: false 
        })
      } catch (updateError) {
        logger.error(`[Sync] Failed to update sync status for ${entityCode}:`, updateError)
      }
      
      return false
    }
  }

  // Deprecated: Alias for backward compatibility if needed, or redirect
  async syncProduct(product) {
    return this.sync(product, 'products')
  }
}

export default new SyncService()
