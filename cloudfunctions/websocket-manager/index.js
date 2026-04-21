/**
 * WebSocket管理器云函数
 * 实现小程序端实时数据同步和设备间通信
 * 基于 wx-server-sdk 实现 WebSocket 能力
 */

const cloud = require('wx-server-sdk');

// 初始化云开发环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

// 全局变量 - 存储活跃连接
const activeConnections = new Map();
const deviceChannels = new Map(); // 设备频道映射

// 消息类型定义
const MESSAGE_TYPES = {
  DATA_CHANGE: 'data_change',
  DEVICE_STATUS: 'device_status',
  HEARTBEAT: 'heartbeat',
  SYNC_REQUEST: 'sync_request',
  CONFLICT_RESOLVE: 'conflict_resolve',
  SYSTEM_NOTIFICATION: 'system_notification'
};

// 设备状态定义
const DEVICE_STATUS = {
  ONLINE: 'online',
  OFFLINE: 'offline',
  BUSY: 'busy',
  SYNCING: 'syncing'
};

exports.main = async (event, context) => {
  const { action, data = {}, connectionId } = event;
  
  console.log(`[WebSocket管理] 动作: ${action}, 连接ID: ${connectionId}`);
  
  try {
    switch (action) {
      case 'connect':
        return await handleConnection(event);
      case 'disconnect':
        return await handleDisconnection(event);
      case 'message':
        return await handleMessage(event);
      case 'broadcast':
        return await handleBroadcast(event);
      case 'sync_request':
        return await handleSyncRequest(event);
      case 'heartbeat':
        return await handleHeartbeat(event);
      case 'get_device_status':
        return await getDeviceStatus(event);
      case 'create_channel':
        return await createChannel(event);
      case 'join_channel':
        return await joinChannel(event);
      case 'leave_channel':
        return await leaveChannel(event);
      default:
        throw new Error(`未知动作: ${action}`);
    }
  } catch (error) {
    console.error('[WebSocket管理] 错误:', error);
    return {
      success: false,
      error: error.message,
      timestamp: Date.now()
    };
  }
};

/**
 * 处理新连接
 */
async function handleConnection(event) {
  const { connectionId, deviceInfo = {}, userId = 'anonymous' } = event;
  
  console.log(`[连接] 新连接: ${connectionId}, 用户: ${userId}`);
  
  // 存储连接信息
  const connection = {
    connectionId,
    userId,
    deviceInfo,
    status: DEVICE_STATUS.ONLINE,
    lastHeartbeat: Date.now(),
    subscriptions: new Set(),
    channels: new Set()
  };
  
  activeConnections.set(connectionId, connection);
  
  // 创建设备频道
  const deviceChannelId = `device_${userId}_${connectionId}`;
  deviceChannels.set(deviceChannelId, {
    channelId: deviceChannelId,
    owner: connectionId,
    members: new Set([connectionId]),
    createdAt: Date.now()
  });
  
  // 发送欢迎消息
  await sendMessage(connectionId, {
    type: MESSAGE_TYPES.SYSTEM_NOTIFICATION,
    data: {
      message: '连接成功',
      connectionId,
      timestamp: Date.now()
    }
  });
  
  // 通知其他设备有新设备上线
  await broadcastToUser(userId, {
    type: MESSAGE_TYPES.DEVICE_STATUS,
    data: {
      action: 'device_online',
      deviceId: connectionId,
      deviceInfo,
      timestamp: Date.now()
    }
  }, connectionId);
  
  return {
    success: true,
    data: {
      connectionId,
      deviceChannelId,
      status: 'connected'
    }
  };
}

/**
 * 处理断开连接
 */
async function handleDisconnection(event) {
  const { connectionId } = event;
  
  console.log(`[断开连接] ${connectionId}`);
  
  const connection = activeConnections.get(connectionId);
  if (!connection) {
    return { success: true, message: '连接不存在' };
  }
  
  // 清理设备频道
  for (const channelId of connection.channels) {
    const channel = deviceChannels.get(channelId);
    if (channel) {
      channel.members.delete(connectionId);
      
      // 如果频道为空，删除频道
      if (channel.members.size === 0) {
        deviceChannels.delete(channelId);
      } else {
        // 通知其他成员
        await broadcastToChannel(channelId, {
          type: MESSAGE_TYPES.DEVICE_STATUS,
          data: {
            action: 'device_offline',
            deviceId: connectionId,
            timestamp: Date.now()
          }
        }, connectionId);
      }
    }
  }
  
  // 移除连接
  activeConnections.delete(connectionId);
  
  // 通知其他设备该设备下线
  await broadcastToUser(connection.userId, {
    type: MESSAGE_TYPES.DEVICE_STATUS,
    data: {
      action: 'device_offline',
      deviceId: connectionId,
      timestamp: Date.now()
    }
  }, connectionId);
  
  return { success: true };
}

/**
 * 处理消息
 */
async function handleMessage(event) {
  const { connectionId, message } = event;
  
  console.log(`[消息] 从 ${connectionId} 收到消息:`, message);
  
  const connection = activeConnections.get(connectionId);
  if (!connection) {
    throw new Error('连接不存在');
  }
  
  // 更新最后心跳时间
  connection.lastHeartbeat = Date.now();
  
  // 根据消息类型处理
  switch (message.type) {
    case MESSAGE_TYPES.DATA_CHANGE:
      return await handleDataChange(connection, message);
    case MESSAGE_TYPES.SYNC_REQUEST:
      return await handleSyncRequest(connection, message);
    case MESSAGE_TYPES.CONFLICT_RESOLVE:
      return await handleConflictResolve(connection, message);
    default:
      // 广播到订阅者
      return await broadcastMessage(connection, message);
  }
}

/**
 * 处理数据变更消息
 */
async function handleDataChange(connection, message) {
  const { data: changeData } = message;
  
  console.log(`[数据变更] ${connection.connectionId}:`, changeData);
  
  // 验证数据变更格式
  if (!changeData.collection || !changeData.operation || !changeData.data) {
    throw new Error('数据变更格式错误');
  }
  
  // 调用数据同步云函数
  try {
    const syncResult = await cloud.callFunction({
      name: 'data-sync',
      data: {
        action: 'broadcast_change',
        change: {
          ...changeData,
          source: connection.connectionId,
          timestamp: Date.now()
        }
      }
    });
    
    // 同步到数据库
    await syncToDatabase(changeData);
    
    // 广播给其他设备
    await broadcastToUser(connection.userId, {
      type: MESSAGE_TYPES.DATA_CHANGE,
      data: {
        ...changeData,
        source: connection.connectionId,
        timestamp: Date.now()
      }
    }, connection.connectionId);
    
    return {
      success: true,
      data: {
        synced: true,
        changeId: syncResult.result.changeId,
        timestamp: Date.now()
      }
    };
    
  } catch (error) {
    console.error('[数据变更] 同步失败:', error);
    throw error;
  }
}

/**
 * 同步到数据库
 */
async function syncToDatabase(changeData) {
  const { collection, operation, data, filter } = changeData;
  
  const db = cloud.database();
  
  switch (operation) {
    case 'create':
      return await db.collection(collection).add({
        data: {
          ...data,
          createdAt: new Date(),
          updatedAt: new Date(),
          _clientId: data._clientId || Date.now().toString()
        }
      });
      
    case 'update':
      return await db.collection(collection).where(filter).update({
        data: {
          ...data,
          updatedAt: new Date()
        }
      });
      
    case 'delete':
      return await db.collection(collection).where(filter).remove();
      
    default:
      throw new Error(`不支持的操作: ${operation}`);
  }
}

/**
 * 处理广播消息
 */
async function handleBroadcast(event) {
  const { connectionId, message, targetType = 'all', targetId = null } = event;
  
  console.log(`[广播] ${connectionId} 广播消息:`, message);
  
  let result;
  
  switch (targetType) {
    case 'all':
      result = await broadcastToAll(message, connectionId);
      break;
    case 'user':
      result = await broadcastToUser(targetId, message, connectionId);
      break;
    case 'channel':
      result = await broadcastToChannel(targetId, message, connectionId);
      break;
    case 'device':
      result = await sendMessage(targetId, message);
      break;
    default:
      throw new Error(`不支持的广播类型: ${targetType}`);
  }
  
  return {
    success: true,
    data: result
  };
}

/**
 * 处理同步请求
 */
async function handleSyncRequest(event) {
  const { connectionId, request } = event;
  
  console.log(`[同步请求] ${connectionId}:`, request);
  
  const connection = activeConnections.get(connectionId);
  if (!connection) {
    throw new Error('连接不存在');
  }
  
  try {
    // 调用数据同步云函数
    const syncResult = await cloud.callFunction({
      name: 'data-sync',
      data: {
        action: 'query_changes',
        request
      }
    });
    
    // 发送同步数据
    await sendMessage(connectionId, {
      type: MESSAGE_TYPES.SYNC_REQUEST,
      data: {
        requestId: request.requestId,
        changes: syncResult.result.changes || [],
        timestamp: Date.now()
      }
    });
    
    return {
      success: true,
      data: {
        requestId: request.requestId,
        changesCount: syncResult.result.changes?.length || 0
      }
    };
    
  } catch (error) {
    console.error('[同步请求] 失败:', error);
    throw error;
  }
}

/**
 * 处理心跳包
 */
async function handleHeartbeat(event) {
  const { connectionId } = event;
  
  const connection = activeConnections.get(connectionId);
  if (!connection) {
    return { success: false, error: '连接不存在' };
  }
  
  // 更新心跳时间
  connection.lastHeartbeat = Date.now();
  connection.status = DEVICE_STATUS.ONLINE;
  
  return {
    success: true,
    data: {
      timestamp: Date.now(),
      status: connection.status
    }
  };
}

/**
 * 获取设备状态
 */
async function getDeviceStatus(event) {
  const { userId } = event;
  
  const devices = [];
  
  for (const [connectionId, connection] of activeConnections) {
    if (connection.userId === userId) {
      devices.push({
        connectionId,
        deviceInfo: connection.deviceInfo,
        status: connection.status,
        lastHeartbeat: connection.lastHeartbeat,
        channels: Array.from(connection.channels)
      });
    }
  }
  
  return {
    success: true,
    data: {
      devices,
      totalDevices: devices.length
    }
  };
}

/**
 * 创建频道
 */
async function createChannel(event) {
  const { connectionId, channelName, settings = {} } = event;
  
  const connection = activeConnections.get(connectionId);
  if (!connection) {
    throw new Error('连接不存在');
  }
  
  const channelId = `channel_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  const channel = {
    channelId,
    name: channelName,
    owner: connectionId,
    members: new Set([connectionId]),
    settings: {
      maxMembers: settings.maxMembers || 100,
      allowInvite: settings.allowInvite !== false,
      autoDelete: settings.autoDelete !== false,
      ...settings
    },
    createdAt: Date.now()
  };
  
  deviceChannels.set(channelId, channel);
  connection.channels.add(channelId);
  
  return {
    success: true,
    data: {
      channelId,
      channel
    }
  };
}

/**
 * 加入频道
 */
async function joinChannel(event) {
  const { connectionId, channelId } = event;
  
  const channel = deviceChannels.get(channelId);
  const connection = activeConnections.get(connectionId);
  
  if (!channel || !connection) {
    throw new Error('频道或连接不存在');
  }
  
  if (channel.members.has(connectionId)) {
    return { success: true, message: '已在频道中' };
  }
  
  if (channel.members.size >= channel.settings.maxMembers) {
    throw new Error('频道已满');
  }
  
  channel.members.add(connectionId);
  connection.channels.add(channelId);
  
  // 通知频道成员
  await broadcastToChannel(channelId, {
    type: MESSAGE_TYPES.SYSTEM_NOTIFICATION,
    data: {
      message: `${connectionId} 加入了频道`,
      timestamp: Date.now()
    }
  });
  
  return {
    success: true,
    data: {
      channelId,
      memberCount: channel.members.size
    }
  };
}

/**
 * 离开频道
 */
async function leaveChannel(event) {
  const { connectionId, channelId } = event;
  
  const channel = deviceChannels.get(channelId);
  const connection = activeConnections.get(connectionId);
  
  if (!channel || !connection) {
    throw new Error('频道或连接不存在');
  }
  
  channel.members.delete(connectionId);
  connection.channels.delete(channelId);
  
  // 如果频道为空且设置为自动删除，则删除频道
  if (channel.members.size === 0 && channel.settings.autoDelete) {
    deviceChannels.delete(channelId);
  } else {
    // 通知频道成员
    await broadcastToChannel(channelId, {
      type: MESSAGE_TYPES.SYSTEM_NOTIFICATION,
      data: {
        message: `${connectionId} 离开了频道`,
        timestamp: Date.now()
      }
    });
  }
  
  return {
    success: true,
    data: {
      channelId,
      remainingMembers: channel.members.size
    }
  };
}

/**
 * 发送消息给指定连接
 */
async function sendMessage(connectionId, message) {
  // 在真实环境中，这里会通过 WebSocket 发送消息
  // 由于云函数环境限制，我们通过数据库存储消息，然后在客户端轮询
  
  const messageId = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  try {
    const db = cloud.database();
    await db.collection('message_queue').add({
      data: {
        messageId,
        connectionId,
        message,
        timestamp: Date.now(),
        delivered: false,
        retryCount: 0
      }
    });
    
    console.log(`[消息发送] 队列化消息: ${messageId} -> ${connectionId}`);
    
    return {
      success: true,
      data: {
        messageId,
        connectionId,
        queued: true
      }
    };
    
  } catch (error) {
    console.error('[消息发送] 失败:', error);
    throw error;
  }
}

/**
 * 广播给所有连接
 */
async function broadcastToAll(message, excludeConnectionId = null) {
  const results = [];
  
  for (const [connectionId] of activeConnections) {
    if (connectionId !== excludeConnectionId) {
      try {
        const result = await sendMessage(connectionId, message);
        results.push({ connectionId, ...result });
      } catch (error) {
        console.error(`[广播] 发送失败到 ${connectionId}:`, error);
        results.push({ connectionId, success: false, error: error.message });
      }
    }
  }
  
  return {
    success: true,
    data: {
      totalRecipients: activeConnections.size - (excludeConnectionId ? 1 : 0),
      successfulSends: results.filter(r => r.success).length,
      failedSends: results.filter(r => !r.success).length,
      results
    }
  };
}

/**
 * 广播给指定用户的所有设备
 */
async function broadcastToUser(userId, message, excludeConnectionId = null) {
  const results = [];
  
  for (const [connectionId, connection] of activeConnections) {
    if (connection.userId === userId && connectionId !== excludeConnectionId) {
      try {
        const result = await sendMessage(connectionId, message);
        results.push({ connectionId, ...result });
      } catch (error) {
        console.error(`[用户广播] 发送失败到 ${connectionId}:`, error);
        results.push({ connectionId, success: false, error: error.message });
      }
    }
  }
  
  return {
    success: true,
    data: {
      userId,
      totalDevices: results.length,
      successfulSends: results.filter(r => r.success).length,
      failedSends: results.filter(r => !r.success).length,
      results
    }
  };
}

/**
 * 广播给指定频道
 */
async function broadcastToChannel(channelId, message, excludeConnectionId = null) {
  const channel = deviceChannels.get(channelId);
  if (!channel) {
    throw new Error('频道不存在');
  }
  
  const results = [];
  
  for (const connectionId of channel.members) {
    if (connectionId !== excludeConnectionId) {
      try {
        const result = await sendMessage(connectionId, message);
        results.push({ connectionId, ...result });
      } catch (error) {
        console.error(`[频道广播] 发送失败到 ${connectionId}:`, error);
        results.push({ connectionId, success: false, error: error.message });
      }
    }
  }
  
  return {
    success: true,
    data: {
      channelId,
      totalMembers: channel.members.size,
      successfulSends: results.filter(r => r.success).length,
      failedSends: results.filter(r => !r.success).length,
      results
    }
  };
}

/**
 * 广播消息（通用）
 */
async function broadcastMessage(connection, message) {
  const { message: msg, targetType = 'subscribers', targetId = null } = message;
  
  switch (targetType) {
    case 'subscribers':
      // 广播给订阅者
      return await broadcastToUser(connection.userId, msg, connection.connectionId);
      
    case 'channel':
      return await broadcastToChannel(targetId, msg, connection.connectionId);
      
    case 'device':
      return await sendMessage(targetId, msg);
      
    default:
      throw new Error(`不支持的广播类型: ${targetType}`);
  }
}

/**
 * 处理冲突解决
 */
async function handleConflictResolve(connection, message) {
  const { data: conflictData } = message;
  
  console.log(`[冲突解决] ${connection.connectionId}:`, conflictData);
  
  try {
    const resolveResult = await cloud.callFunction({
      name: 'data-sync',
      data: {
        action: 'resolve_conflict',
        conflict: conflictData,
        resolver: connection.connectionId
      }
    });
    
    // 广播解决结果
    await broadcastToUser(connection.userId, {
      type: MESSAGE_TYPES.CONFLICT_RESOLVE,
      data: {
        conflictId: conflictData.conflictId,
        resolution: resolveResult.result.resolution,
        timestamp: Date.now()
      }
    }, connection.connectionId);
    
    return {
      success: true,
      data: resolveResult.result
    };
    
  } catch (error) {
    console.error('[冲突解决] 失败:', error);
    throw error;
  }
}