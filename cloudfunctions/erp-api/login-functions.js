const cloud = require('wx-server-sdk');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

/**
 * 登录认证相关函数
 */

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

const DEFAULT_ADMIN_USERNAME = '13817508995';
let warnedDerivedSecret = false

function redactSensitive(value, depth = 0) {
  if (depth > 6) return '[redacted]';
  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    if (value.length > 500) return `${value.slice(0, 200)}...[truncated]`;
    return value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 50).map((v) => redactSensitive(v, depth + 1));
  }

  if (typeof value === 'object') {
    const out = {};
    const keys = Object.keys(value);
    for (const key of keys) {
      const lower = String(key).toLowerCase();
      const v = value[key];
      if (lower === 'body' && typeof v === 'string') {
        const trimmed = v.trim();
        if (trimmed && (trimmed.startsWith('{') || trimmed.startsWith('['))) {
          try {
            out[key] = redactSensitive(JSON.parse(trimmed), depth + 1);
            continue;
          } catch (_) {
            // fallthrough
          }
        }
      }
      const shouldRedact =
        lower.includes('secret') ||
        lower.includes('token') ||
        lower.includes('key') ||
        lower.includes('password') ||
        lower.includes('authorization') ||
        lower.includes('ticket') ||
        lower.includes('session') ||
        lower.includes('environ') ||
        lower.includes('wx_api_token');
      out[key] = shouldRedact ? '[redacted]' : redactSensitive(v, depth + 1);
    }
    return out;
  }

  return value;
}

function safeLogJson(prefix, payload) {
  try {
    console.log(prefix, JSON.stringify(redactSensitive(payload), null, 2));
  } catch (e) {
    console.log(prefix, '[unserializable]');
  }
}

function resolveTokenSecret() {
  const direct =
    process.env.ERP_TOKEN_SECRET ||
    process.env.WX_API_TOKEN ||
    process.env.WX_TRIGGER_API_TOKEN_V0 ||
    ''
  if (direct && String(direct).trim()) return String(direct).trim()

  const envId =
    process.env.TCB_ENV ||
    process.env.ENV_ID ||
    process.env.TENCENTCLOUD_TCBENV ||
    ''
  const appId = process.env.TENCENTCLOUD_APPID || ''
  const base = `${String(envId || '').trim()}|${String(appId || '').trim()}|erp-system`
  const derived = crypto.createHash('sha256').update(base).digest('hex')
  if (!warnedDerivedSecret) {
    warnedDerivedSecret = true
    console.warn('[login-functions] 未配置ERP_TOKEN_SECRET，已使用派生密钥；建议配置稳定的ERP_TOKEN_SECRET')
  }
  return derived
}

// 全局错误处理器
process.on('unhandledRejection', (reason, promise) => {
  console.error('未处理的Promise拒绝:', reason, '在Promise:', promise);
});

process.on('uncaughtException', (error) => {
  console.error('未捕获的异常:', error);
});

/**
 * 用户登录
 */
async function login(loginData, wxContext) {
  safeLogJson('[login-functions] 登录请求参数:', loginData);
  
  const rawUsername = loginData ? (loginData.username || loginData.phone) : '';
  const rawPassword = loginData ? loginData.password : '';
  const terminal = loginData ? String(loginData.terminal || loginData.client || '').toLowerCase() : '';
  const platform = terminal === 'pc' ? 'pc' : 'mp';
  const username = typeof rawUsername === 'string' ? rawUsername.trim() : String(rawUsername || '').trim();
  const password = typeof rawPassword === 'string' ? rawPassword : String(rawPassword || '');
  const db = cloud.database();
  
  // 验证参数
  if (!username || !password) {
    console.log('[login-functions] 参数验证失败');
    return {
      success: false,
      message: '用户名和密码不能为空'
    };
  }

  const isStrongPassword = (pwd) => {
    const s = String(pwd || '')
    if (s.length < 8) return false
    const hasLetter = /[a-z]/i.test(s)
    const hasDigit = /\d/.test(s)
    return hasLetter && hasDigit
  }

  if (platform === 'pc' && !isStrongPassword(password)) {
    return { success: false, message: '管理员密码强度不足：至少8位且包含字母和数字' }
  }
  
  try {
    const phoneLooksValid = /^1[3-9]\d{9}$/.test(username);
    let candidates = [];
    
    // 并行查询 username 和 phone
    const queries = [
      db.collection('users').where({ username }).limit(20).get()
        .then(res => res.data || [])
        .catch(e => { console.error('[login] username查询失败', e); return []; })
    ];

    if (phoneLooksValid) {
      queries.push(
        db.collection('users').where({ phone: username }).limit(20).get()
          .then(res => res.data || [])
          .catch(e => { console.error('[login] phone查询失败', e); return []; })
      );
    }

    const results = await Promise.all(queries);
    
    // 合并结果并去重
    const userMap = new Map();
    results.flat().forEach(u => {
      if (u && u._id) {
        userMap.set(String(u._id), u);
      }
    });
    
    candidates = Array.from(userMap.values());
    
    console.log(`[login-functions] 查询到 ${candidates.length} 个候选用户`);
    
    if (!candidates.length) {
      return {
        success: false,
        message: '用户不存在'
      };
    }
    
    const normalizedCandidates = candidates
      .filter((u) => u && String(u.status || 'active').toLowerCase() !== 'disabled')
      .map((u) => {
        const storedPassword = String((u.password || u.passwordHash || '') || '');
        const passwordLooksHashed = storedPassword.startsWith('$2');
        let match = false;
        if (passwordLooksHashed) {
          try {
            match = bcrypt.compareSync(password, storedPassword);
          } catch (_) {
            match = false;
          }
        } else {
          match = storedPassword === String(password || '');
        }
        return {
          user: u,
          match,
          score: Number(u.updatedAt || u.createdAt || 0) || 0
        };
      })
      .sort((a, b) => b.score - a.score);

    const matched = normalizedCandidates.find((item) => item.match);
    if (!matched) {
      return {
        success: false,
        message: '密码错误'
      };
    }

    const user = matched.user;

    const deletedFlag =
      user && (user.isDeleted === true || user.deleted === true || user.deletedAt || user.removedAt);
    if (deletedFlag) {
      return {
        success: false,
        message: '账号不存在'
      };
    }

    if (user && user.status && String(user.status) !== 'active') {
      return {
        success: false,
        message: '账号已停用',
        errorCode: 'USER_INACTIVE'
      };
    }

    const role = String(user.role || '').toLowerCase()
    const isAdmin = role === 'admin' || role === 'administrator'
    if (isAdmin && !isStrongPassword(password)) {
      return { success: false, message: '管理员密码强度不足：至少8位且包含字母和数字' }
    }
    
    const sessionId =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : crypto.randomBytes(16).toString('hex');
    const now = Date.now();

    if (platform === 'pc') {
      if (!isAdmin) {
        return { success: false, message: '仅管理员账号可登录PC端', errorCode: 'PC_ONLY_ADMIN' }
      }
    }

    const token = generateToken(user, { platform, sessionId });
    
    // 更新最后登录时间
    await db.collection('users').doc(user._id).update({
      data: {
        lastLoginAt: now,
        lastLoginIP: wxContext.CLIENTIP,
        ...(platform === 'pc'
          ? { currentSessionIdPc: sessionId }
          : { currentSessionId: sessionId, currentSessionIdMp: sessionId }),
        updatedAt: now,
        updatedBy: wxContext.OPENID
      }
    });
    
    console.log(`[login-functions] 用户登录成功: ${username}`);
    
    return {
      success: true,
      data: {
        token,
        sessionId,
        user: {
          id: user._id,
          username: user.username,
          name: user.name,
          role: user.role,
          phone: user.phone || '',
          avatar: user.avatar,
          department: user.department,
          companyName: user.companyName || '',
          introduction: user.introduction || ''
        }
      },
      message: '登录成功'
    };
  } catch (error) {
    console.error('[login-functions] 登录失败:', error);
    return {
      success: false,
      message: '登录过程中发生错误',
      error: error.message
    };
  }
}

/**
 * 创建默认管理员账户
 */
async function createDefaultAdmin(username, password) {
  const db = cloud.database();
  const now = Date.now();
  const actualUsername = String(username || '').trim() || DEFAULT_ADMIN_USERNAME;
  const actualPassword = String(password || '').trim();
  const phoneLooksValid = /^1[3-9]\d{9}$/.test(actualUsername);
  const looksStrong = actualPassword.length >= 10 && /[a-zA-Z]/.test(actualPassword) && /\d/.test(actualPassword);
  if (!looksStrong) {
    return { success: false, message: '管理员初始化密码不符合要求' };
  }
  const hashedPassword = bcrypt.hashSync(actualPassword, 10);
  const adminUser = {
    username: actualUsername,
    password: hashedPassword,
    name: '系统管理员',
    role: 'admin',
    department: '管理部',
    avatar: '/images/profile.png',
    status: 'active',
    createdAt: now,
    updatedAt: now,
    ...(phoneLooksValid ? { phone: actualUsername } : {}),
    _version: 1
  };
  
  try {
    // 创建管理员账户
    const result = await db.collection('users').add({
      data: adminUser
    });
    
    const sessionId =
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : crypto.randomBytes(16).toString('hex');
    const token = generateToken(
      {
        _id: result._id,
        ...adminUser
      },
      { platform: 'mp', sessionId }
    );
    try {
      await db.collection('users').doc(result._id).update({
        data: { currentSessionId: sessionId, currentSessionIdMp: sessionId, lastLoginAt: now, updatedAt: now }
      });
    } catch (_) {}
    
    console.log(`[login-functions] 创建默认管理员账户成功: ${username}`);
    
    return {
      success: true,
      data: {
        token,
        sessionId,
        user: {
          id: result._id,
          username: adminUser.username,
          name: adminUser.name,
          role: adminUser.role,
          phone: adminUser.phone || '',
          avatar: adminUser.avatar,
          department: adminUser.department,
          companyName: adminUser.companyName || '',
          introduction: adminUser.introduction || ''
        }
      },
      message: '登录成功'
    };
  } catch (error) {
    console.error('[login-functions] 创建默认管理员失败:', error);
    return {
      success: false,
      message: '系统初始化失败',
      error: error.message
    };
  }
}

/**
 * 生成登录令牌
 */
function generateToken(user, options = {}) {
  const secret = resolveTokenSecret();
  if (!secret) {
    throw new Error('缺少令牌签名密钥');
  }
  const platform = String(options.platform || '').toLowerCase() || 'mp'
  const sessionId = options.sessionId ? String(options.sessionId) : ''

  const payload = {
    userId: user._id,
    username: user.username,
    role: user.role,
    platform,
    ...(sessionId ? { sessionId } : {}),
    timestamp: Date.now(),
    exp: Date.now() + 24 * 60 * 60 * 1000,
    random: crypto.randomBytes(16).toString('hex')
  };
  
  const tokenData = Buffer.from(JSON.stringify(payload)).toString('base64');
  const signature = crypto.createHmac('sha256', secret).update(tokenData).digest('hex');
  return `token_${tokenData}.${signature}`;
}

/**
 * 用户登出
 */
async function logout(wxContext) {
  try {
    // 记录登出日志
    await logOperation('logout', 'users', wxContext.OPENID, {
      logoutTime: Date.now()
    }, wxContext.OPENID);
    
    console.log(`[login-functions] 用户登出成功: ${wxContext.OPENID}`);
    
    return {
      success: true,
      message: '登出成功'
    };
  } catch (error) {
    console.error('[login-functions] 登出失败:', error);
    return {
      success: false,
      message: '登出失败',
      error: error.message
    };
  }
}

/**
 * 记录操作日志
 */
async function logOperation(operation, collection, recordId, data, userId) {
  const db = cloud.database();
  try {
    await db.collection('operation_logs').add({
      data: {
        operation,
        collection,
        recordId,
        data,
        userId,
        timestamp: Date.now(),
        _version: 1
      }
    });
  } catch (error) {
    console.error('[login-functions] 记录操作日志失败:', error);
  }
}

module.exports = {
  login,
  logout,
  createDefaultAdmin,
  generateToken,
  logOperation
};
