import express from 'express';
import UserConfig from '../models/UserConfig.js';
import cloudbaseService from '../services/cloudbaseService.js';
import { listLocalDocs, upsertLocalDoc } from '../utils/localDocStore.js';

const router = express.Router();

const isOfflineMode = () => String(process.env.OFFLINE_MODE || '').toLowerCase() === 'true';

const ensureCloud = async () => {
  const ok = await cloudbaseService.initialize().catch(() => false)
  return ok
}

const normalizeConfigDoc = (doc) => {
  if (!doc) return null
  const key = doc.key || doc?.data?.key
  if (!key) return null
  const value = doc.value !== undefined ? doc.value : doc?.data?.value
  const userId = doc.userId || doc?.data?.userId
  return { ...doc, key, value, userId }
}

// Get user configs
router.get('/', async (req, res) => {
  try {
    const { keys, key } = req.query;
    
    let configs = [];
    
    if (isOfflineMode()) {
      const all = await listLocalDocs('user_configs', { limit: 10000 }).catch(() => []);
      const allDocs = (all || []).map(normalizeConfigDoc).filter(Boolean);
      if (keys) {
        const keyList = String(keys)
          .split(',')
          .map(k => String(k).trim())
          .filter(Boolean);
        configs = keyList.length
          ? allDocs.filter((item) => keyList.includes(String(item.key)))
          : [];
      } else if (key) {
        const usedKey = String(key).trim();
        configs = allDocs.filter((item) => String(item.key) === usedKey);
      } else {
        configs = allDocs;
      }
    } else if (process.env.USE_LOCAL_MONGO_READS !== 'false') {
      const filter = {};
      if (keys) {
        filter.key = { $in: keys.split(',') };
      } else if (key) {
        filter.key = key;
      }
      configs = await UserConfig.find(filter);
    } else {
      // Cloud implementation
      const cloudOk = await ensureCloud();
      if (!cloudOk) {
        console.warn('Cloud service unavailable for user-config, returning empty');
        return res.json(keys ? {} : null);
      }
      
      try {
        const collection = cloudbaseService.getCollection('user_configs');
        const result = await collection.limit(1000).get();
        const allDocs = (result?.data || []).map(normalizeConfigDoc).filter(Boolean);
        if (keys) {
          const keyList = keys.split(',').map(k => String(k).trim()).filter(Boolean);
          configs = keyList.length
            ? allDocs.filter((item) => keyList.includes(String(item.key)))
            : [];
        } else if (key) {
          const usedKey = String(key).trim();
          configs = allDocs.filter((item) => String(item.key) === usedKey);
        } else {
          configs = allDocs;
        }
      } catch (e) {
        console.warn('Cloud fetch failed for user-config:', e);
        // Return empty instead of error to prevent UI crash
        configs = [];
      }
    }
    
    // Transform to map if keys requested, or single value if key requested
    if (keys) {
      const configMap = configs.reduce((acc, curr) => {
        if (curr && curr.key) {
          acc[curr.key] = curr.value;
        }
        return acc;
      }, {});
      res.json({ success: true, data: { configs: configMap } });
    } else if (key) {
      const value = configs[0] ? configs[0].value : null;
      res.json({ success: true, data: { configs: { [String(key)]: value } } });
    } else {
      res.json({ success: true, data: { configs } });
    }
  } catch (error) {
    console.error('Error fetching user configs:', error);
    res.status(500).json({ 
      success: false, 
      message: 'Failed to fetch user configs',
      error: error.message 
    });
  }
});

// Create or update user config
router.post('/', async (req, res) => {
  try {
    const { key, value, userId } = req.body;
    
    if (!key) {
      return res.status(400).json({
        success: false,
        message: 'Key is required'
      });
    }
    
    let config = null;
    let localError = null;
    if (isOfflineMode()) {
      const usedKey = String(key).trim();
      const now = new Date();
      const data = {
        key: usedKey,
        value,
        userId: userId || undefined,
        updatedAt: now.toISOString(),
        _updateTime: now.getTime(),
        createdAt: now.toISOString(),
        _createTime: now.getTime()
      };
      await upsertLocalDoc('user_configs', data, usedKey);
      config = data;
    } else if (process.env.USE_LOCAL_MONGO_READS !== 'false') {
      try {
        config = await UserConfig.findOneAndUpdate(
          { key },
          { key, value, userId },
          { new: true, upsert: true, setDefaultsOnInsert: true }
        );
      } catch (error) {
        localError = error;
      }
    }
    if (!config && (process.env.USE_LOCAL_MONGO_READS === 'false' || localError)) {
      const cloudOk = await ensureCloud();
      if (!cloudOk) {
        return res.json({ success: false, message: '云服务不可用' });
      }
      try {
        const collection = cloudbaseService.getCollection('user_configs');
        const now = new Date();
        const usedKey = String(key).trim();
        const existingRes = await collection.where({ key: usedKey }).limit(1).get();
        const existing = existingRes?.data && existingRes.data.length ? existingRes.data[0] : null;
        const data = {
          key: usedKey,
          value,
          userId: userId || undefined,
          updatedAt: now.toISOString(),
          _updateTime: now.getTime()
        };
        if (existing && existing._id) {
          await collection.doc(existing._id).update({ data });
          config = { ...existing, ...data, _id: existing._id };
        } else {
          const createData = {
            ...data,
            createdAt: now.toISOString(),
            _createTime: now.getTime()
          };
          const addRes = await collection.add({ data: createData });
          const id = addRes?._id || addRes?.id || undefined;
          config = { ...createData, _id: id };
        }
      } catch (error) {
        return res.status(500).json({
          success: false,
          message: '保存用户配置失败',
          error: error.message
        });
      }
    }
    
    res.json({
      success: true,
      data: { item: config }
    });
  } catch (error) {
    console.error('Error saving user config:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to save user config',
      error: error.message
    });
  }
});

export default router;
