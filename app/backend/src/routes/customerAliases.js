import express from 'express';
import CustomerAlias from '../models/CustomerAlias.js';
import cloudbaseService from '../services/cloudbaseService.js';
import { listLocalDocs, removeLocalDoc, upsertLocalDoc } from '../utils/localDocStore.js';

const router = express.Router();

const isOfflineMode = () => String(process.env.OFFLINE_MODE || '').toLowerCase() === 'true';

const ensureCloud = async () => {
  const ok = await cloudbaseService.initialize().catch(() => false)
  return ok
}

// Get all aliases
router.get('/', async (req, res) => {
  try {
    let aliases = [];
    
    if (isOfflineMode()) {
      aliases = await listLocalDocs('customer_aliases', { limit: 5000 }).catch(() => []);
      aliases.sort((a, b) => {
        const ta = Date.parse(String(a?.updatedAt || '')) || Number(a?._updateTime || 0) || 0;
        const tb = Date.parse(String(b?.updatedAt || '')) || Number(b?._updateTime || 0) || 0;
        return tb - ta;
      });
    } else if (process.env.USE_LOCAL_MONGO_READS !== 'false') {
      aliases = await CustomerAlias.find({}).sort({ updatedAt: -1 });
    } else {
      const cloudOk = await ensureCloud();
      if (!cloudOk) {
        return res.json({ success: true, data: [] });
      }
      try {
        const collection = cloudbaseService.getCollection('customer_aliases');
        const result = await collection.orderBy('updatedAt', 'desc').limit(1000).get();
        aliases = result.data || [];
      } catch (e) {
        console.warn('Cloud fetch failed for customer-aliases:', e);
        aliases = [];
      }
    }
    
    res.json({
      success: true,
      data: aliases
    });
  } catch (error) {
    console.error('Error fetching customer aliases:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch customer aliases',
      error: error.message
    });
  }
});

router.post('/upsert', async (req, res) => {
  try {
    const { alias, customerName, customerId } = req.body;
    
    if (!alias) {
      return res.status(400).json({
        success: false,
        message: 'Alias is required'
      });
    }
    
    let item = null;
    if (isOfflineMode()) {
      const usedAlias = String(alias).trim();
      const now = new Date();
      const data = {
        alias: usedAlias,
        customerName,
        customerId,
        updatedAt: now.toISOString(),
        _updateTime: now.getTime(),
        createdAt: now.toISOString(),
        _createTime: now.getTime()
      };
      await upsertLocalDoc('customer_aliases', data, usedAlias);
      item = { ...data, _id: usedAlias, id: usedAlias };
    } else if (process.env.USE_LOCAL_MONGO_READS !== 'false') {
      const customerAlias = await CustomerAlias.findOneAndUpdate(
        { alias },
        { alias, customerName, customerId },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      item = customerAlias;
    } else {
      const cloudOk = await ensureCloud();
      if (!cloudOk) {
        return res.json({ success: false, message: '云服务不可用' });
      }
      const collection = cloudbaseService.getCollection('customer_aliases');
      const now = new Date();
      const usedAlias = String(alias).trim();
      const existingRes = await collection.where({ alias: usedAlias }).limit(1).get();
      const existing = existingRes?.data && existingRes.data.length ? existingRes.data[0] : null;
      const data = {
        alias: usedAlias,
        customerName,
        customerId,
        updatedAt: now.toISOString(),
        _updateTime: now.getTime()
      };
      if (existing && existing._id) {
        await collection.doc(existing._id).update({ data });
        item = { ...existing, ...data, _id: existing._id };
      } else {
        const createData = {
          ...data,
          createdAt: now.toISOString(),
          _createTime: now.getTime()
        };
        const addRes = await collection.add({ data: createData });
        const id = addRes?._id || addRes?.id || undefined;
        item = { ...createData, _id: id };
      }
    }
    
    res.json({
      success: true,
      data: item
    });
  } catch (error) {
    console.error('Error saving customer alias:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save customer alias',
      error: error.message
    });
  }
});

router.post('/delete', async (req, res) => {
  try {
    const { id, alias } = req.body || {};
    const usedId = String(id || '').trim();
    const usedAlias = String(alias || '').trim();
    
    if (!usedId && !usedAlias) {
      return res.status(400).json({
        success: false,
        message: 'Alias id or alias is required'
      });
    }
    
    if (isOfflineMode()) {
      const targetId = usedId || usedAlias;
      await removeLocalDoc('customer_aliases', targetId);
    } else if (process.env.USE_LOCAL_MONGO_READS !== 'false') {
      let customerAlias = null;
      if (usedId) {
        customerAlias = await CustomerAlias.findByIdAndDelete(usedId);
      } else if (usedAlias) {
        customerAlias = await CustomerAlias.findOneAndDelete({ alias: usedAlias });
      }
      if (!customerAlias) {
        return res.status(404).json({
          success: false,
          message: 'Customer alias not found'
        });
      }
    } else {
      const cloudOk = await ensureCloud();
      if (!cloudOk) {
        return res.json({ success: false, message: '云服务不可用' });
      }
      const collection = cloudbaseService.getCollection('customer_aliases');
      if (usedId) {
        try {
          await collection.doc(usedId).remove();
        } catch (_) {
          return res.status(404).json({ success: false, message: 'Customer alias not found' });
        }
      } else {
        const existingRes = await collection.where({ alias: usedAlias }).limit(1).get();
        const existing = existingRes?.data && existingRes.data.length ? existingRes.data[0] : null;
        if (!existing || !existing._id) {
          return res.status(404).json({ success: false, message: 'Customer alias not found' });
        }
        await collection.doc(existing._id).remove();
      }
    }
    
    res.json({
      success: true
    });
  } catch (error) {
    console.error('Error deleting customer alias:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to delete customer alias',
      error: error.message
    });
  }
});

router.post('/', async (req, res) => {
  try {
    const { alias, customerName, customerId } = req.body;
    
    if (!alias) {
      return res.status(400).json({
        success: false,
        message: 'Alias is required'
      });
    }
    
    let item = null;
    if (isOfflineMode()) {
      const usedAlias = String(alias).trim();
      const now = new Date();
      const data = {
        alias: usedAlias,
        customerName,
        customerId,
        updatedAt: now.toISOString(),
        _updateTime: now.getTime(),
        createdAt: now.toISOString(),
        _createTime: now.getTime()
      };
      await upsertLocalDoc('customer_aliases', data, usedAlias);
      item = { ...data, _id: usedAlias, id: usedAlias };
    } else if (process.env.USE_LOCAL_MONGO_READS !== 'false') {
      const customerAlias = await CustomerAlias.findOneAndUpdate(
        { alias },
        { alias, customerName, customerId },
        { new: true, upsert: true, setDefaultsOnInsert: true }
      );
      item = customerAlias;
    } else {
      const cloudOk = await ensureCloud();
      if (!cloudOk) {
        return res.json({ success: false, message: '云服务不可用' });
      }
      const collection = cloudbaseService.getCollection('customer_aliases');
      const now = new Date();
      const usedAlias = String(alias).trim();
      const existingRes = await collection.where({ alias: usedAlias }).limit(1).get();
      const existing = existingRes?.data && existingRes.data.length ? existingRes.data[0] : null;
      const data = {
        alias: usedAlias,
        customerName,
        customerId,
        updatedAt: now.toISOString(),
        _updateTime: now.getTime()
      };
      if (existing && existing._id) {
        await collection.doc(existing._id).update({ data });
        item = { ...existing, ...data, _id: existing._id };
      } else {
        const createData = {
          ...data,
          createdAt: now.toISOString(),
          _createTime: now.getTime()
        };
        const addRes = await collection.add({ data: createData });
        const id = addRes?._id || addRes?.id || undefined;
        item = { ...createData, _id: id };
      }
    }
    
    res.json({
      success: true,
      data: item
    });
  } catch (error) {
    console.error('Error saving customer alias:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save customer alias',
      error: error.message
    });
  }
});

export default router;
