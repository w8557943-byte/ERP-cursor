import mqtt from 'mqtt';
import protobuf from 'protobufjs';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../utils/logger.js';
import { mqttConfig } from '../config/mqttConfig.js';
import Product from '../models/local/Product.js';
import Order from '../models/local/Order.js';
import Customer from '../models/local/Customer.js';
import SyncQueue from '../models/local/SyncQueue.js';

class RealTimeSyncService {
  constructor() {
    this.client = null;
    this.root = null;
    this.SyncMessage = null;
    this.isConnected = false;
    this.isSyncing = false;
    this.protoPath = path.resolve('src/proto/sync.proto');
  }

  async initialize() {
    try {
      // Load Protobuf
      this.root = await protobuf.load(this.protoPath);
      this.SyncMessage = this.root.lookupType('sync.SyncMessage');
      
      // Ensure SyncQueue table exists
      await SyncQueue.sync();

      // Setup MQTT
      this.connect();

      // Register Hooks
      this.registerHooks();

      logger.info('[RealTimeSync] Initialized successfully');
    } catch (err) {
      logger.error('[RealTimeSync] Initialization failed:', err);
    }
  }

  connect() {
    const { brokerUrl, ...options } = mqttConfig;
    this.client = mqtt.connect(brokerUrl, {
      ...options,
      reconnectPeriod: 1000,
      connectTimeout: 30 * 1000,
      will: {
        topic: `${mqttConfig.topicPrefix}/status`,
        payload: 'offline',
        qos: 1,
        retain: true
      }
    });

    this.client.on('connect', () => {
      this.isConnected = true;
      logger.info('[RealTimeSync] Connected to MQTT broker');
      
      // Subscribe to topics
      const topic = `${mqttConfig.topicPrefix}/#`;
      this.client.subscribe(topic, { qos: 1 }, (err) => {
        if (!err) {
          logger.info(`[RealTimeSync] Subscribed to ${topic}`);
        }
      });

      // Publish status
      this.client.publish(`${mqttConfig.topicPrefix}/status`, 'online', { retain: true });

      // Process offline queue
      this.processOfflineQueue();
    });

    this.client.on('message', (topic, message) => {
      this.handleMessage(topic, message);
    });

    this.client.on('error', (err) => {
      logger.error('[RealTimeSync] MQTT Error:', err);
    });

    this.client.on('offline', () => {
      this.isConnected = false;
      logger.warn('[RealTimeSync] MQTT Offline');
    });
  }

  async processOfflineQueue() {
    if (this.isSyncing || !this.isConnected) return;
    this.isSyncing = true;

    try {
      const queue = await SyncQueue.findAll({
        where: { status: 'pending' },
        order: [['createdAt', 'ASC']],
        limit: 50
      });

      if (queue.length > 0) {
        logger.info(`[RealTimeSync] Processing ${queue.length} offline messages`);
        for (const item of queue) {
          try {
            // Check connection again
            if (!this.client.connected) break;

            await new Promise((resolve, reject) => {
              this.client.publish(item.topic, item.payload, { qos: 1 }, (err) => {
                if (err) reject(err);
                else resolve();
              });
            });

            item.status = 'completed';
            await item.save();
          } catch (err) {
            logger.error(`[RealTimeSync] Failed to publish queued item ${item.id}:`, err);
            item.retryCount += 1;
            if (item.retryCount > 5) {
              item.status = 'failed';
              item.errorMessage = err.message;
            }
            await item.save();
          }
        }
      }
    } catch (err) {
      logger.error('[RealTimeSync] Error processing offline queue:', err);
    } finally {
      this.isSyncing = false;
      // Check if more items exist
      const count = await SyncQueue.count({ where: { status: 'pending' } });
      if (count > 0 && this.isConnected) {
        setTimeout(() => this.processOfflineQueue(), 1000);
      }
    }
  }

  registerHooks() {
    const models = [
      { model: Product, type: 1 }, // PRODUCT
      { model: Order, type: 2 },   // ORDER
      { model: Customer, type: 3 } // CUSTOMER
    ];

    models.forEach(({ model, type }) => {
      model.afterCreate((instance, options) => this.handleHook('CREATE', type, instance, options));
      model.afterUpdate((instance, options) => this.handleHook('UPDATE', type, instance, options));
      model.afterDestroy((instance, options) => this.handleHook('DELETE', type, instance, options));
    });
  }

  async handleHook(action, entityType, instance, options) {
    if (options && options.sync === false) return; // Prevent loop

    try {
      const payload = {
        id: uuidv4(),
        timestamp: Date.now(),
        entity: entityType,
        action: action === 'CREATE' ? 1 : action === 'UPDATE' ? 2 : 3,
        source: mqttConfig.clientId,
        version: instance.version || 0,
        entityId: String(instance.id),
        payload: Buffer.from(JSON.stringify(instance.toJSON())) // Using JSON for flexibility inside protobuf wrapper
      };

      const errMsg = this.SyncMessage.verify(payload);
      if (errMsg) throw Error(errMsg);

      const message = this.SyncMessage.create(payload);
      const buffer = this.SyncMessage.encode(message).finish();

      const topic = `${mqttConfig.topicPrefix}/${this.getEntityTypeString(entityType)}/${instance.id}`;

      if (this.isConnected && this.client.connected) {
        this.client.publish(topic, buffer, { qos: 1 }, (err) => {
          if (err) {
            logger.error('[RealTimeSync] Publish failed, queuing:', err);
            this.queueMessage(topic, buffer);
          }
        });
      } else {
        logger.warn('[RealTimeSync] Offline, queuing message');
        this.queueMessage(topic, buffer);
      }

    } catch (err) {
      logger.error('[RealTimeSync] Hook handler error:', err);
    }
  }

  async queueMessage(topic, payload) {
    try {
      await SyncQueue.create({
        topic,
        payload,
        status: 'pending'
      });
    } catch (err) {
      logger.error('[RealTimeSync] Failed to queue message:', err);
    }
  }

  getEntityTypeString(type) {
    switch (type) {
      case 1: return 'product';
      case 2: return 'order';
      case 3: return 'customer';
      default: return 'unknown';
    }
  }

  async handleMessage(topic, buffer) {
    try {
      const message = this.SyncMessage.decode(buffer);
      
      // Ignore own messages
      if (message.source === mqttConfig.clientId) return;

      logger.info(`[RealTimeSync] Received update for ${message.entityId} from ${message.source}`);

      const model = this.getModelByType(message.entity);
      if (!model) return;

      const data = JSON.parse(message.payload.toString());
      const { id, ...updateData } = data;

      // Optimistic Locking Check
      const existing = await model.findByPk(message.entityId);
      
      if (existing) {
        if (existing.version > message.version) {
          logger.warn(`[RealTimeSync] Conflict detected for ${message.entityId}. Local version ${existing.version} > Remote ${message.version}. Ignoring.`);
          return;
        }
        
        if (message.action === 3) { // DELETE
          await existing.destroy({ hooks: false, sync: false });
        } else { // UPDATE
          await existing.update(updateData, { hooks: false, sync: false });
        }
      } else {
        if (message.action !== 3) { // CREATE or UPDATE (treat as upsert)
          await model.create({ ...updateData, id: message.entityId }, { hooks: false, sync: false });
        }
      }

    } catch (err) {
      logger.error('[RealTimeSync] Message handling error:', err);
    }
  }

  getModelByType(type) {
    switch (type) {
      case 1: return Product;
      case 2: return Order;
      case 3: return Customer;
      default: return null;
    }
  }
}

export default new RealTimeSyncService();
