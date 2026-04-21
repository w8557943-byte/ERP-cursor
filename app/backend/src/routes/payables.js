import express from 'express';
import Payable from '../models/Payable.js';
import cloudbaseService from '../services/cloudbaseService.js';
import { getLocalDoc, listLocalDocs, removeLocalDoc, upsertLocalDoc } from '../utils/localDocStore.js';

const router = express.Router();

const isOfflineMode = () => String(process.env.OFFLINE_MODE || '').toLowerCase() === 'true';

const ensureCloud = async () => {
  const ok = await cloudbaseService.initialize().catch(() => false)
  return ok
}

// List payables
router.get('/', async (req, res) => {
  try {
    const { page = 1, limit = 500, orderBy } = req.query;
    const limitNum = parseInt(limit) || 500;
    const pageNum = parseInt(page) || 1;
    const skip = (pageNum - 1) * limitNum;
    
    let payables = [];
    let total = 0;
    
    if (isOfflineMode()) {
      const all = await listLocalDocs('payables', { limit: 10000 }).catch(() => []);
      total = all.length;
      let rows = all.slice();
      if (orderBy) {
        const parts = String(orderBy || '').split('_');
        if (parts.length === 2) {
          const field = parts[0];
          const dir = parts[1] === 'desc' ? -1 : 1;
          rows.sort((a, b) => {
            const av = a?.[field];
            const bv = b?.[field];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * dir;
            return String(av).localeCompare(String(bv)) * dir;
          });
        }
      } else {
        rows.sort((a, b) => {
          const ta = Date.parse(String(a?.updatedAt || '')) || Number(a?._updateTime || 0) || 0;
          const tb = Date.parse(String(b?.updatedAt || '')) || Number(b?._updateTime || 0) || 0;
          return tb - ta;
        });
      }
      payables = rows.slice(skip, skip + limitNum);
    } else if (process.env.USE_LOCAL_MONGO_READS !== 'false') {
      // Build sort object
      let sort = { updatedAt: -1 };
      if (orderBy) {
        const parts = orderBy.split('_');
        if (parts.length === 2) {
          sort = { [parts[0]]: parts[1] === 'desc' ? -1 : 1 };
        }
      }
      
      const [list, count] = await Promise.all([
        Payable.find({})
          .sort(sort)
          .skip(skip)
          .limit(limitNum),
        Payable.countDocuments({})
      ]);
      payables = list;
      total = count;
    } else {
       // Cloud implementation
       const cloudOk = await ensureCloud();
       if (!cloudOk) {
         return res.json({ data: [], pagination: { total: 0, page: pageNum, limit: limitNum, pages: 0 } });
       }
       
       try {
         const collection = cloudbaseService.getCollection('payables');
         let query = collection;
         
         // Handle sort
         if (orderBy) {
           const parts = orderBy.split('_');
           if (parts.length === 2) {
             query = query.orderBy(parts[0], parts[1]);
           } else {
             query = query.orderBy('updatedAt', 'desc');
           }
         } else {
           query = query.orderBy('updatedAt', 'desc');
         }

         const [listRes, countRes] = await Promise.all([
           query.skip(skip).limit(limitNum).get(),
           collection.count()
         ]);
         
         payables = listRes.data || [];
         total = countRes.total || 0;
       } catch (e) {
         console.warn('Cloud fetch failed for payables:', e);
         payables = [];
         total = 0;
       }
    }
    
    const normalized = Array.isArray(payables)
      ? payables.map((item) => {
          if (!item) return item
          const key = item.key || item._id || item.id
          return key ? { ...item, key: String(key) } : item
        })
      : []
    
    res.json({
      success: true,
      data: {
        items: normalized,
        pagination: {
          total,
          page: pageNum,
          limit: limitNum,
          pages: Math.ceil(total / limitNum)
        }
      }
    });
  } catch (error) {
    console.error('Error fetching payables:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch payables',
      error: error.message
    });
  }
});

// Create payable
router.post('/', async (req, res) => {
  try {
    let item = null;
    if (isOfflineMode()) {
      const now = new Date();
      const key = String(req.body?.key || req.body?._id || req.body?.id || '').trim() || `payable_${now.getTime()}`;
      const data = {
        ...req.body,
        key,
        updatedAt: now.toISOString(),
        _updateTime: now.getTime(),
        createdAt: req.body?.createdAt || now.toISOString(),
        _createTime: now.getTime()
      };
      const created = await upsertLocalDoc('payables', data, key);
      item = { ...data, _id: created?.id, id: created?.id };
    } else if (process.env.USE_LOCAL_MONGO_READS !== 'false') {
      const payable = new Payable(req.body);
      await payable.save();
      const key = payable.key || payable._id || payable.id;
      item = key ? { ...payable.toObject(), key: String(key) } : payable.toObject();
    } else {
      const cloudOk = await ensureCloud();
      if (!cloudOk) {
        return res.json({ success: false, message: '云服务不可用' });
      }
      const now = new Date();
      const key = String(req.body?.key || req.body?._id || req.body?.id || '').trim() || `payable_${now.getTime()}`;
      const data = {
        ...req.body,
        key,
        updatedAt: now.toISOString(),
        _updateTime: now.getTime(),
        createdAt: req.body?.createdAt || now.toISOString(),
        _createTime: now.getTime()
      };
      const collection = cloudbaseService.getCollection('payables');
      const addRes = await collection.add({ data });
      const id = addRes?._id || addRes?.id || undefined;
      item = { ...data, _id: id };
    }
    
    res.status(201).json({
      success: true,
      data: { item }
    });
  } catch (error) {
    console.error('Error creating payable:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to create payable',
      error: error.message
    });
  }
});

// Update payable
router.put('/:id', async (req, res) => {
  try {
    const usedId = String(req.params.id || '').trim();
    let item = null;
    
    if (isOfflineMode()) {
      const existing = await getLocalDoc('payables', usedId).catch(() => null);
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Payable not found'
        });
      }
      const now = new Date();
      const data = {
        ...existing,
        ...req.body,
        key: String(req.body?.key || existing?.key || usedId),
        updatedAt: now.toISOString(),
        _updateTime: now.getTime()
      };
      await upsertLocalDoc('payables', data, usedId);
      item = { ...data, _id: usedId, id: usedId, key: String(data.key || usedId) };
    } else if (process.env.USE_LOCAL_MONGO_READS !== 'false') {
      const payable = await Payable.findByIdAndUpdate(
        usedId,
        req.body,
        { new: true }
      );
      if (!payable) {
        return res.status(404).json({
          success: false,
          message: 'Payable not found'
        });
      }
      const key = payable.key || payable._id || payable.id;
      item = key ? { ...payable.toObject(), key: String(key) } : payable.toObject();
    } else {
      const cloudOk = await ensureCloud();
      if (!cloudOk) {
        return res.json({ success: false, message: '云服务不可用' });
      }
      const collection = cloudbaseService.getCollection('payables');
      const now = new Date();
      const data = {
        ...req.body,
        updatedAt: now.toISOString(),
        _updateTime: now.getTime()
      };
      try {
        await collection.doc(usedId).update({ data });
        item = { ...data, _id: usedId, key: req.body?.key || usedId };
      } catch (_) {
        const found = await collection.where({ key: usedId }).limit(1).get();
        const existing = found?.data && found.data.length ? found.data[0] : null;
        if (!existing || !existing._id) {
          return res.status(404).json({ success: false, message: 'Payable not found' });
        }
        await collection.doc(existing._id).update({ data });
        item = { ...existing, ...data, _id: existing._id, key: existing.key || usedId };
      }
    }
    
    res.json({
      success: true,
      data: { item }
    });
  } catch (error) {
    console.error('Error updating payable:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to update payable',
      error: error.message
    });
  }
});

// Delete payable
router.delete('/:id', async (req, res) => {
  try {
    const usedId = String(req.params.id || '').trim();
    if (isOfflineMode()) {
      const existing = await getLocalDoc('payables', usedId).catch(() => null);
      if (!existing) {
        return res.status(404).json({
          success: false,
          message: 'Payable not found'
        });
      }
      await removeLocalDoc('payables', usedId);
    } else if (process.env.USE_LOCAL_MONGO_READS !== 'false') {
      const payable = await Payable.findByIdAndDelete(usedId);
      if (!payable) {
        return res.status(404).json({
          success: false,
          message: 'Payable not found'
        });
      }
    } else {
      const cloudOk = await ensureCloud();
      if (!cloudOk) {
        return res.json({ success: false, message: '云服务不可用' });
      }
      const collection = cloudbaseService.getCollection('payables');
      try {
        await collection.doc(usedId).remove();
      } catch (_) {
        const found = await collection.where({ key: usedId }).limit(1).get();
        const existing = found?.data && found.data.length ? found.data[0] : null;
        if (!existing || !existing._id) {
          return res.status(404).json({ success: false, message: 'Payable not found' });
        }
        await collection.doc(existing._id).remove();
      }
    }
    
    res.json({
      success: true
    });
  } catch (error) {
    console.error('Error deleting payable:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete payable',
      error: error.message
    });
  }
});

// Stub for invoice upload complete
router.post('/invoice-upload/complete', (req, res) => {
  res.json({
    success: true,
    data: {
      fileID: 'stub-file-id-' + Date.now(),
      url: 'http://placeholder.url/file.pdf'
    }
  });
});

export default router;
