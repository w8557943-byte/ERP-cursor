import OrderSequence from '../models/OrderSequence.js';
import OrderReservation from '../models/OrderReservation.js';
import OrderNumberLog from '../models/OrderNumberLog.js';
import OrderSequenceLocal from '../models/local/OrderSequence.js';
import OrderReservationLocal from '../models/local/OrderReservation.js';
import OrderNumberLogLocal from '../models/local/OrderNumberLog.js';
import { sequelize, syncDatabase } from '../utils/sqliteDatabase.js';
import mongoose from 'mongoose';
import database from '../utils/database.js';
import { Op } from 'sequelize';

const PREFIX = 'QXDD';
const RESERVATION_TIMEOUT_MINUTES = 30;

class OrderNumberService {
  constructor() {
    this.useLocal = false;
    this._indexesReady = false;
    this._sqliteReady = false;
    this._localOrderNoMutex = null;
  }

  _runWithLocalMutex(fn) {
    const prev = this._localOrderNoMutex || Promise.resolve();
    const task = prev.then(fn, fn);
    this._localOrderNoMutex = task.then(() => void 0, () => void 0);
    return task;
  }

  async ensureSnowflakeStateCollection() {
    await this.ensureConnected();
    if (this.useLocal) return;
    
    if (this._snowflakeStateReady) return;
    try {
      await mongoose.connection.db.collection('snowflake_states').createIndex({ _id: 1 }, { unique: true });
    } catch (_) { void 0; }
    this._snowflakeStateReady = true;
  }

  async ensureConnected() {
    if (process.env.USE_SQLITE === 'true' || !process.env.MONGODB_URI) {
      this.useLocal = true;
      if (!this._sqliteReady) {
        await syncDatabase(false);
        this._sqliteReady = true;
      }
      return;
    }

    if (mongoose.connection.readyState === 1) {
      if (!this._indexesReady) {
        await Promise.all([OrderReservation.init(), OrderSequence.init(), OrderNumberLog.init()]);
        this._indexesReady = true;
      }
      return;
    }

    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI 未配置');
    }

    if (mongoose.connection.readyState === 2) {
      const start = Date.now();
      while (mongoose.connection.readyState === 2 && Date.now() - start < 12000) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (mongoose.connection.readyState !== 1) {
      await database.connect();
    }

    if (!this._indexesReady) {
      await Promise.all([OrderReservation.init(), OrderSequence.init(), OrderNumberLog.init()]);
      this._indexesReady = true;
    }
  }

  async ensureSequenceAtLeast(dateKey, minSeq) {
    await this.ensureConnected();
    const key = String(dateKey || '').trim();
    const desired = Number(minSeq);
    if (!/^\d{8}$/.test(key)) return;
    if (!Number.isFinite(desired) || desired <= 0) return;

    if (this.useLocal) {
      return this._runWithLocalMutex(async () => {
        const [seqDoc] = await OrderSequenceLocal.findOrCreate({
          where: { date: key },
          defaults: { seq: 0, lastUpdated: new Date() }
        });
        if (seqDoc.seq < desired) {
          seqDoc.seq = desired;
          seqDoc.lastUpdated = new Date();
          await seqDoc.save();
        }
      });
    }

    const existing = await OrderSequence.findOne({ date: key }).lean();
    const currentSeq = Number(existing?.seq || 0);
    if (!existing) {
      try {
        await OrderSequence.create({ date: key, seq: desired, lastUpdated: new Date() });
        return;
      } catch (_) { void 0; }
    }

    if (currentSeq < desired) {
      await OrderSequence.updateOne(
        { date: key, seq: currentSeq },
        { $set: { seq: desired, lastUpdated: new Date() } }
      ).catch(() => void 0);
    }
  }

  async generateOrderNumber(options = {}) {
    await this.ensureConnected();
    const optDateKey = typeof options === 'object' && options ? String(options.dateKey || '').trim() : '';
    const useDateKey = /^\d{8}$/.test(optDateKey) ? optDateKey : '';
    const now = new Date();
    const year = now.getFullYear();
    const month = (now.getMonth() + 1).toString().padStart(2, '0');
    const day = now.getDate().toString().padStart(2, '0');
    const dateKey = useDateKey || `${year}${month}${day}`;
    const maxRetries = 20;

    if (this.useLocal) {
      return this._runWithLocalMutex(() => this._generateOrderNumberLocal(dateKey, maxRetries, now, options));
    }

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await OrderReservation.updateMany(
          { date: dateKey, status: 'RESERVED', expiresAt: { $lt: now } },
          { $set: { status: 'RELEASED' } }
        );

        const algo = String(process.env.ORDER_NO_ALGO || '').trim().toLowerCase() || 'sequence';

        let orderNo = '';
        let seq = 0;

        if (algo === 'snowflake') {
          const snowflake = await this.generateSnowflakeId();
          orderNo = `${PREFIX}${snowflake.id}`;
          const sequenceDoc = await OrderSequence.findOneAndUpdate(
            { date: dateKey },
            { $inc: { seq: 1 } },
            { new: true, upsert: true }
          );
          seq = sequenceDoc.seq;
        } else {
          const sequenceDoc = await OrderSequence.findOneAndUpdate(
            { date: dateKey },
            { $inc: { seq: 1 } },
            { new: true, upsert: true }
          );

          seq = sequenceDoc.seq;
          const seqPart = seq.toString().padStart(3, '0');
          orderNo = `${PREFIX}${dateKey}${seqPart}`;
        }

        // 检查订单号是否已在云数据库中存在
        // 注意：这里需要调用云函数来检查,因为后端无法直接访问云数据库
        // 如果云数据库检查失败,我们仍然继续,因为本地MongoDB的预约系统已经保证了唯一性

        const reservation = new OrderReservation({
          orderNo,
          seq,
          date: dateKey,
          status: 'RESERVED',
          expiresAt: new Date(now.getTime() + RESERVATION_TIMEOUT_MINUTES * 60000)
        });

        await reservation.save();

        const payload = {
          orderNo,
          orderNumber: orderNo,
          reservationId: reservation._id?.toString?.() || reservation._id,
          expiresAt: reservation.expiresAt,
          seq,
          source: 'new'
        };

        await OrderNumberLog.create({
          action: 'generate',
          orderNo,
          seq,
          date: dateKey,
          reservationId: payload.reservationId,
          source: algo === 'snowflake' ? 'pc_snowflake' : 'pc'
        });

        console.log(`[OrderNumberService] Generated new order number: ${orderNo} (attempt ${attempt + 1})`);
        return payload;
      } catch (error) {
        console.error(`[OrderNumberService] Error generating order number (attempt ${attempt + 1}):`, error);

        // 如果是最后一次尝试,抛出错误
        if (attempt === maxRetries - 1) {
          throw error;
        }

        // 否则继续重试
        await new Promise(resolve => setTimeout(resolve, 100)); // 短暂延迟后重试
      }
    }

    throw new Error(`Failed to generate order number after ${maxRetries} attempts`);
  }

  async _generateOrderNumberLocal(dateKey, maxRetries, now, options) {
    const algo = String(process.env.ORDER_NO_ALGO || '').trim().toLowerCase() || 'sequence';

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        const payload = await sequelize.transaction(async (t) => {
          await OrderReservationLocal.update(
            { status: 'RELEASED' },
            {
              where: {
                date: dateKey,
                status: 'RESERVED',
                expiresAt: { [Op.lt]: now }
              },
              transaction: t
            }
          );

          let orderNo = '';
          let seq = 0;
          const [sequenceDoc] = await OrderSequenceLocal.findOrCreate({
            where: { date: dateKey },
            defaults: { seq: 0, lastUpdated: new Date() },
            transaction: t
          });
          await sequenceDoc.increment('seq', { transaction: t });
          await sequenceDoc.reload({ transaction: t });
          seq = sequenceDoc.seq;

          if (algo === 'snowflake') {
            const snowflake = await this.generateSnowflakeId();
            orderNo = `${PREFIX}${snowflake.id}`;
          } else {
            const seqPart = seq.toString().padStart(3, '0');
            orderNo = `${PREFIX}${dateKey}${seqPart}`;
          }

          const reservation = await OrderReservationLocal.create(
            {
              orderNo,
              seq,
              date: dateKey,
              status: 'RESERVED',
              expiresAt: new Date(now.getTime() + RESERVATION_TIMEOUT_MINUTES * 60000)
            },
            { transaction: t }
          );

          const result = {
            orderNo,
            orderNumber: orderNo,
            reservationId: reservation.id,
            expiresAt: reservation.expiresAt,
            seq,
            source: 'new'
          };

          await OrderNumberLogLocal.create(
            {
              action: 'generate',
              orderNo,
              seq,
              date: dateKey,
              reservationId: String(result.reservationId),
              source: algo === 'snowflake' ? 'pc_snowflake' : 'pc'
            },
            { transaction: t }
          );

          return result;
        });

        console.log(`[OrderNumberService] Generated new order number (Local): ${payload.orderNo} (attempt ${attempt + 1})`);
        return payload;
      } catch (error) {
        console.error(`[OrderNumberService] Error generating order number (Local) (attempt ${attempt + 1}):`, error);
        if (attempt === maxRetries - 1) throw error;
        const delay = Math.min(100 * Math.pow(2, attempt) + Math.random() * 100, 2000);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw new Error(`Failed to generate order number after ${maxRetries} attempts`);
  }

  async confirmOrderNumber(orderNo) {
    await this.ensureConnected();
    if (this.useLocal) {
       const result = await OrderReservationLocal.findOne({ where: { orderNo } });
       if (result) {
         result.status = 'USED';
         await result.save();
         
         await OrderNumberLogLocal.create({
            action: 'confirm',
            orderNo,
            seq: result.seq,
            date: result.date,
            reservationId: String(result.id),
            source: 'pc'
         });
       }
       return result;
    }

    const result = await OrderReservation.findOneAndUpdate(
      { orderNo },
      { status: 'USED' },
      { new: true }
    );
    if (result) {
      await OrderNumberLog.create({
        action: 'confirm',
        orderNo,
        seq: result.seq,
        date: result.date,
        reservationId: result._id?.toString?.() || result._id,
        source: 'pc'
      });
    }
    return result;
  }

  async releaseOrderNumber(payload = {}) {
    await this.ensureConnected();
    const { orderNo, reservationId } = payload;

    if (this.useLocal) {
      const query = reservationId ? { id: reservationId } : { orderNo };
      const doc = await OrderReservationLocal.findOne({ where: query });
      if (!doc) return null;
      if (doc.status !== 'USED') {
        doc.status = 'RELEASED';
        await doc.save();
      }
      await OrderNumberLogLocal.create({
        action: 'release',
        orderNo: doc.orderNo,
        seq: doc.seq,
        date: doc.date,
        reservationId: String(doc.id),
        source: 'pc'
      });
      return doc;
    }

    const query = reservationId ? { _id: reservationId } : { orderNo };
    const doc = await OrderReservation.findOne(query);
    if (!doc) return null;
    if (doc.status !== 'USED') {
      doc.status = 'RELEASED';
      await doc.save();
    }
    await OrderNumberLog.create({
      action: 'release',
      orderNo: doc.orderNo,
      seq: doc.seq,
      date: doc.date,
      reservationId: doc._id?.toString?.() || doc._id,
      source: 'pc'
    });
    return doc;
  }

  startCleanupJob() {
    if (this._cleanupTimer) return;
    this._cleanupTimer = setInterval(async () => {
      try {
        if (!process.env.MONGODB_URI && !this.useLocal) return;
        await this.ensureConnected();
        const now = new Date();
        
        if (this.useLocal) {
          await OrderReservationLocal.update(
            { status: 'RELEASED' },
            { 
              where: { 
                status: 'RESERVED', 
                expiresAt: { [Op.lt]: now } 
              } 
            }
          );
          return;
        }

        await OrderReservation.updateMany(
          { status: 'RESERVED', expiresAt: { $lt: now } },
          { $set: { status: 'RELEASED' } }
        );
      } catch (_) {
      }
    }, 60 * 1000);
  }

  async generateSnowflakeId() {
    const epoch = Number(process.env.SNOWFLAKE_EPOCH_MS || 1704067200000);
    if (!Number.isFinite(epoch) || epoch <= 0) {
      throw new Error('SNOWFLAKE_EPOCH_MS 配置无效');
    }

    const machineId = this.resolveSnowflakeMachineId();

    if (!this._snowflakeState) this._snowflakeState = { lastTs: 0, seq: 0 };
    const run = async () => {
      for (let attempt = 0; attempt < 2000; attempt++) {
        const nowMs = Date.now();
        const ts = nowMs < epoch ? epoch : nowMs;

        if (ts < this._snowflakeState.lastTs) {
          await new Promise(resolve => setTimeout(resolve, Math.min(5, this._snowflakeState.lastTs - ts)));
          continue;
        }

        if (ts === this._snowflakeState.lastTs) {
          const nextSeq = (Number(this._snowflakeState.seq) + 1) & 0xfff;
          this._snowflakeState.seq = nextSeq;
          if (nextSeq === 0) {
            while (Date.now() <= ts) {
              await new Promise(resolve => setTimeout(resolve, 1));
            }
            continue;
          }
          return { id: this.composeSnowflakeId(ts, machineId, nextSeq, epoch), timestamp: ts, machineId, sequence: nextSeq };
        }

        this._snowflakeState.lastTs = ts;
        this._snowflakeState.seq = 0;
        return { id: this.composeSnowflakeId(ts, machineId, 0, epoch), timestamp: ts, machineId, sequence: 0 };
      }

      throw new Error('Snowflake 生成失败，请稍后重试');
    };

    const prev = this._snowflakeMutex || Promise.resolve();
    const task = prev.then(run, run);
    this._snowflakeMutex = task.then(() => void 0, () => void 0);
    return task;
  }

  resolveSnowflakeMachineId() {
    const v = String(process.env.SNOWFLAKE_MACHINE_ID ?? '').trim();
    const n = Number(v);
    if (Number.isFinite(n) && n >= 0 && n <= 1023) return Math.floor(n);

    const pid = Number(process.pid) || 0;
    return pid % 1024;
  }

  composeSnowflakeId(timestampMs, machineId, sequence, epochMs) {
    const ts = BigInt(Number(timestampMs) - Number(epochMs));
    const mid = BigInt(Number(machineId) & 0x3ff);
    const seq = BigInt(Number(sequence) & 0xfff);
    const id = (ts << 22n) | (mid << 12n) | seq;
    return id.toString(10);
  }
}

export default new OrderNumberService();
