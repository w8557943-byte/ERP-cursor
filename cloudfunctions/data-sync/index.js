const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

// 数据同步云函数 - 核心功能
exports.main = async (event, context) => {
  const { operation, table, data, timestamp, clientId, syncType = 'realtime' } = event;

  try {
    console.log(`[数据同步] 操作: ${operation}, 表: ${table}, 客户端: ${clientId}`);

    switch (operation) {
      case 'create':
        return await createRecord(table, data, clientId, timestamp);
      case 'update':
        return await updateRecord(table, data, timestamp, clientId);
      case 'delete':
        return await deleteRecord(table, data.id, clientId, timestamp);
      case 'batch_sync':
        return await batchSyncRecords(data, clientId, syncType);
      case 'query_changes':
        return await queryChanges(table, timestamp, clientId);
      case 'resolve_conflict':
        return await resolveConflict(table, data, clientId);
      default:
        throw new Error(`不支持的操作类型: ${operation}`);
    }
  } catch (error) {
    console.error('[数据同步] 错误:', error);
    
    // 记录同步错误日志
    await logSyncError({
      operation,
      table,
      clientId,
      error: error.message,
      timestamp: Date.now()
    });
    
    throw error;
  }
};

/**
 * 创建记录
 */
async function createRecord(table, data, clientId, timestamp) {
  const now = timestamp || Date.now();

  if (table === 'orders' || table === 'purchase_orders') {
    const action = table === 'purchase_orders' ? 'createPurchaseOrder' : 'createOrder'
    const payload = data && typeof data === 'object' ? { ...data } : {}
    delete payload._id
    delete payload._createTime
    delete payload._updateTime
    try {
      const result = await cloud.callFunction({
        name: 'erp-api',
        data: { action, data: { ...payload, source: payload.source || 'sync', createdBy: payload.createdBy || clientId } }
      })
      const out = result && result.result ? result.result : result
      if (out && out.success === true) {
        return { success: true, id: out.data?._id || out.data?.orderId || '', record: out.data, timestamp: now }
      }
      throw new Error((out && out.message) || '云端创建订单失败')
    } catch (e) {
      console.error('[数据同步] 创建订单通过erp-api失败:', e)
      throw e
    }
  }
  
  // 添加元数据
  const record = {
    ...data,
    createdAt: now,
    updatedAt: now,
    createdBy: clientId,
    updatedBy: clientId,
    _version: 1,
    _clientId: clientId
  };

  const result = await db.collection(table).add({
    data: record
  });

  // 广播变更事件
  await broadcastChange({
    type: 'create',
    table,
    recordId: result._id,
    data: record,
    clientId,
    timestamp: now
  });

  console.log(`[数据同步] 创建记录成功: ${table}/${result._id}`);

  return {
    success: true,
    id: result._id,
    record,
    timestamp: now
  };
}

/**
 * 更新记录
 */
async function updateRecord(table, data, timestamp, clientId) {
  const now = timestamp || Date.now();
  const { id, ...updateData } = data;

  // 获取当前版本
  const currentRecord = await db.collection(table).doc(id).get();
  const currentVersion = currentRecord.data._version || 1;

  // 增量更新数据
  const updateFields = {
    ...updateData,
    updatedAt: now,
    updatedBy: clientId,
    _version: currentVersion + 1,
    _clientId: clientId
  };

  const result = await db.collection(table).doc(id).update({
    data: updateFields
  });

  // 广播变更事件
  await broadcastChange({
    type: 'update',
    table,
    recordId: id,
    data: updateFields,
    clientId,
    timestamp: now
  });

  console.log(`[数据同步] 更新记录成功: ${table}/${id}`);

  return {
    success: true,
    updated: result.stats.updated,
    record: { ...currentRecord.data, ...updateFields },
    timestamp: now
  };
}

/**
 * 删除记录
 */
async function deleteRecord(table, id, clientId, timestamp) {
  const now = timestamp || Date.now();

  const result = await db.collection(table).doc(id).remove();

  // 广播删除事件
  await broadcastChange({
    type: 'delete',
    table,
    recordId: id,
    clientId,
    timestamp: now
  });

  console.log(`[数据同步] 删除记录成功: ${table}/${id}`);

  return {
    success: true,
    deleted: result.stats.removed,
    timestamp: now
  };
}

/**
 * 批量同步
 */
async function batchSyncRecords(records, clientId, syncType) {
  const results = [];
  const now = Date.now();

  for (const record of records) {
    try {
      const { operation, table, data } = record;
      const result = await exports.main.call(null, {
        operation,
        table,
        data,
        clientId,
        timestamp: now,
        syncType
      });
      results.push(result);
    } catch (error) {
      console.error(`[批量同步] 记录同步失败:`, error);
      results.push({
        success: false,
        error: error.message,
        record
      });
    }
  }

  return {
    success: true,
    results,
    total: records.length,
    timestamp: now
  };
}

/**
 * 查询变更
 */
async function queryChanges(table, sinceTimestamp, clientId) {
  const changes = await db.collection(table)
    .where({
      updatedAt: _.gte(sinceTimestamp),
      _clientId: _.neq(clientId) // 排除自己创建/更新的记录
    })
    .orderBy('updatedAt', 'asc')
    .limit(100)
    .get();

  return {
    success: true,
    changes: changes.data,
    timestamp: Date.now()
  };
}

/**
 * 冲突解决
 */
async function resolveConflict(table, data, clientId) {
  const { localData, remoteData, strategy = 'timestamp' } = data;
  
  let resolvedData;

  switch (strategy) {
    case 'timestamp':
      resolvedData = resolveByTimestamp(localData, remoteData);
      break;
    case 'version':
      resolvedData = resolveByVersion(localData, remoteData);
      break;
    case 'client_wins':
      resolvedData = localData;
      break;
    case 'server_wins':
      resolvedData = remoteData;
      break;
    default:
      resolvedData = localData;
  }

  // 如果需要更新，则执行更新
  if (resolvedData.id && resolvedData !== localData) {
    return await updateRecord(table, resolvedData, Date.now(), clientId);
  }

  return {
    success: true,
    resolvedData,
    strategy
  };
}

/**
 * 按时间戳解决冲突
 */
function resolveByTimestamp(localData, remoteData) {
  const localTime = new Date(localData.updatedAt).getTime();
  const remoteTime = new Date(remoteData.updatedAt).getTime();
  
  return localTime > remoteTime ? localData : remoteData;
}

/**
 * 按版本号解决冲突
 */
function resolveByVersion(localData, remoteData) {
  const localVersion = localData._version || 1;
  const remoteVersion = remoteData._version || 1;
  
  return localVersion > remoteVersion ? localData : remoteData;
}

/**
 * 广播变更事件
 */
async function broadcastChange(changeData) {
  try {
    // 记录到变更日志集合
    await db.collection('sync_changes').add({
      data: {
        ...changeData,
        processed: false,
        createdAt: Date.now()
      }
    });

    // 如果有WebSocket连接，推送实时事件
    // 这里可以集成WebSocket推送逻辑
    
  } catch (error) {
    console.error('[广播变更] 失败:', error);
  }
}

/**
 * 记录同步错误
 */
async function logSyncError(errorData) {
  try {
    await db.collection('sync_errors').add({
      data: {
        ...errorData,
        createdAt: Date.now()
      }
    });
  } catch (error) {
    console.error('[错误日志] 记录失败:', error);
  }
}
