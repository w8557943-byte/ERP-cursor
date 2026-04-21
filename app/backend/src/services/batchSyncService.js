
import { Op } from 'sequelize';
import { v4 as uuidv4 } from 'uuid';
import Product from '../models/local/Product.js';
import Order from '../models/local/Order.js';
import Customer from '../models/local/Customer.js';
import syncService from './syncService.js';
import syncManager from './syncManager.js';
import { logger } from '../utils/logger.js';

class BatchSyncService {
  constructor() {
    this.isSyncing = false;
    this.lock = false;
    this.jobs = new Map();
  }

  isWriteLocked() {
    return Boolean(this.lock);
  }

  createJob(payload) {
    const id = uuidv4();
    const job = {
      id,
      status: 'queued',
      createdAt: new Date(),
      startedAt: null,
      finishedAt: null,
      progress: { total: 0, processed: 0, success: 0, failed: 0 },
      payload: payload || {},
      errors: [],
      logs: []
    };
    this.jobs.set(id, job);
    return job;
  }

  getJob(jobId) {
    return this.jobs.get(jobId) || null;
  }

  enqueueFullSync(since) {
    const job = this.createJob({ since: since ? new Date(since) : null });
    setImmediate(() => {
      this.runFullSyncJob(job.id).catch((err) => {
        logger.error('[BatchSync] Job crashed:', err);
      });
    });
    return job.id;
  }

  async retryJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) throw new Error('Job not found');
    if (job.status === 'running') throw new Error('Job is running');
    if (this.lock) throw new Error('Sync already in progress');

    job.status = 'queued';
    job.startedAt = null;
    job.finishedAt = null;
    job.progress = { total: 0, processed: 0, success: 0, failed: 0 };
    job.errors = [];
    job.logs = [];

    setImmediate(() => {
      this.runFullSyncJob(job.id).catch((err) => {
        logger.error('[BatchSync] Retry job crashed:', err);
      });
    });

    return job.id;
  }

  async runFullSyncJob(jobId) {
    const job = this.getJob(jobId);
    if (!job) throw new Error('Job not found');

    const since = job.payload?.since ? new Date(job.payload.since) : null;
    if (this.lock) {
      throw new Error('Sync already in progress');
    }
    
    const startTime = since ? new Date(since) : new Date(Date.now() - 5 * 60 * 1000);
    
    this.lock = true;
    this.isSyncing = true;
    job.status = 'running';
    job.startedAt = new Date();

    const log = (message) => {
      job.logs.push({ ts: new Date().toISOString(), message: String(message) });
    };

    try {
      logger.info('[BatchSync] Locking local writes...');
      log('锁定本地写入');
      
      logger.info(`[BatchSync] Starting sync since ${startTime.toISOString()}`);
      log(`开始同步 since=${startTime.toISOString()}`);
      
      syncManager.broadcastSyncUpdate('batch_start', job);

      const models = [
        { model: Product, name: 'products' },
        { model: Order, name: 'orders' },
        { model: Customer, name: 'customers' }
      ];

      let total = 0;
      for (const { model } of models) {
        total += await model.count({ where: { updatedAt: { [Op.gte]: startTime } } });
      }
      job.progress.total = total;
      syncManager.broadcastSyncUpdate('batch_progress', job);

      for (const { model, name } of models) {
        const items = await model.findAll({
          where: {
            updatedAt: { [Op.gte]: startTime }
          }
        });

        logger.info(`[BatchSync] Found ${items.length} ${name} to sync`);
        log(`发现待同步 ${name}=${items.length}`);

        const chunkSize = 5;
        for (let i = 0; i < items.length; i += chunkSize) {
          const chunk = items.slice(i, i + chunkSize);
          
          await Promise.all(chunk.map(async (item) => {
            try {
              const attempts = 3;
              let lastErr = null;
              for (let a = 1; a <= attempts; a += 1) {
                try {
                  await syncService.sync(item, name);
                  lastErr = null;
                  break;
                } catch (e) {
                  lastErr = e;
                  if (a < attempts) {
                    await new Promise((resolve) => setTimeout(resolve, 250 * a));
                  }
                }
              }
              if (lastErr) throw lastErr;

              job.progress.success += 1;
            } catch (err) {
              job.progress.failed += 1;
              job.errors.push({
                entity: name,
                id: item.id,
                error: err.message
              });
              logger.error(`[BatchSync] Failed to sync ${name} ${item.id}:`, err);
            } finally {
              job.progress.processed += 1;
            }
          }));
          
          syncManager.broadcastSyncUpdate('batch_progress', job);
          await new Promise(resolve => setTimeout(resolve, 200));
        }
      }

      logger.info('[BatchSync] Sync completed successfully');
      log('同步完成');
      job.status = 'completed';
      syncManager.broadcastSyncUpdate('batch_complete', job);
      
    } catch (err) {
      logger.error('[BatchSync] Fatal error:', err);
      log(`同步失败: ${err.message}`);
      job.status = 'failed';
      syncManager.broadcastSyncUpdate('batch_error', job);
      throw err;
    } finally {
      this.lock = false;
      this.isSyncing = false;
      job.finishedAt = new Date();
      logger.info('[BatchSync] Unlocked local writes.');
      log('释放本地写入锁');
    }

    return job;
  }
}

export default new BatchSyncService();
