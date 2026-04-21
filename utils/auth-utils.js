/**
 * 用户认证工具模块
 * 提供安全的用户认证和权限管理功能
 */

const { errorHandler, errorCodes } = require('./error-handler');

class AuthUtils {
  constructor() {
    this.tokenExpiry = 7 * 24 * 60 * 60 * 1000; // 7天
    this.loginAttemptLimit = 5; // 登录尝试次数限制
    this.loginLockoutTime = 15 * 60 * 1000; // 15分钟锁定
  }

  /**
   * 密码加密
   */
  encryptPassword(password) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(password + 'ronghe-erp-salt').digest('hex');
  }

  /**
   * 生成安全的登录令牌
   */
  generateSecureToken(user) {
    const crypto = require('crypto');
    const payload = {
      userId: user._id,
      username: user.username,
      role: user.role,
      timestamp: Date.now(),
      exp: Date.now() + this.tokenExpiry,
      random: crypto.randomBytes(16).toString('hex')
    };
    
    const tokenData = Buffer.from(JSON.stringify(payload)).toString('base64');
    const signature = crypto.createHmac('sha256', 'ronghe-erp-secret').update(tokenData).digest('hex');
    
    return `token_${tokenData}.${signature}`;
  }

  /**
   * 验证令牌
   */
  verifyToken(token) {
    try {
      if (!token || !token.startsWith('token_')) {
        return { valid: false, error: '无效的令牌格式' };
      }

      const parts = token.split('.');
      if (parts.length !== 2) {
        return { valid: false, error: '令牌格式错误' };
      }

      const tokenData = parts[0].replace('token_', '');
      const signature = parts[1];

      const crypto = require('crypto');
      const expectedSignature = crypto.createHmac('sha256', 'ronghe-erp-secret').update(tokenData).digest('hex');

      if (signature !== expectedSignature) {
        return { valid: false, error: '令牌签名无效' };
      }

      const payload = JSON.parse(Buffer.from(tokenData, 'base64').toString());

      if (Date.now() > payload.exp) {
        return { valid: false, error: '令牌已过期' };
      }

      return { valid: true, payload: payload };
    } catch (error) {
      return { valid: false, error: '令牌验证失败' };
    }
  }

  /**
   * 获取用户权限
   */
  getUserPermissions(role) {
    const permissions = {
      // 管理员权限
      administrator: [
        'system:manage',
        'user:manage',
        'order:manage',
        'customer:manage',
        'product:manage',
        'inventory:manage',
        'production:manage',
        'report:view'
      ],
      
      // 经理权限
      manager: [
        'order:manage',
        'customer:manage',
        'product:manage',
        'inventory:view',
        'production:manage',
        'report:view'
      ],
      
      // 操作员权限
      operator: [
        'order:view',
        'production:manage',
        'inventory:view'
      ],
      
      // 普通用户权限
      user: [
        'order:view',
        'production:view'
      ]
    };

    return permissions[role] || ['order:view'];
  }

  /**
   * 检查用户权限
   */
  checkPermission(user, permission) {
    if (!user || !user.permissions) {
      return false;
    }

    return user.permissions.includes(permission) || user.permissions.includes('*');
  }

  /**
   * 记录登录尝试
   */
  async logLoginAttempt(username, status, ipAddress, errorMessage = null) {
    const db = require('wx-server-sdk').database();
    
    try {
      await db.collection('login_logs').add({
        data: {
          username: username,
          status: status,
          ipAddress: ipAddress,
          errorMessage: errorMessage,
          timestamp: Date.now(),
          userAgent: '' // 在实际项目中可以添加User-Agent信息
        }
      });
    } catch (error) {
      console.error('记录登录日志失败:', error);
    }
  }

  /**
   * 检查登录限制
   */
  async checkLoginLimit(username, ipAddress) {
    const db = require('wx-server-sdk').database();
    const fifteenMinutesAgo = Date.now() - this.loginLockoutTime;

    try {
      // 查询最近15分钟的失败登录尝试
      const failedAttempts = await db.collection('login_logs')
        .where({
          username: username,
          status: '密码错误',
          timestamp: db.command.gte(fifteenMinutesAgo)
        })
        .count();

      if (failedAttempts.total >= this.loginAttemptLimit) {
        return {
          allowed: false,
          remainingTime: this.loginLockoutTime,
          message: '登录尝试次数过多，请15分钟后再试'
        };
      }

      return { allowed: true };
    } catch (error) {
      console.error('检查登录限制失败:', error);
      return { allowed: true }; // 出错时允许登录
    }
  }

  /**
   * 验证用户状态
   */
  validateUserStatus(user) {
    if (!user) {
      return { valid: false, error: '用户不存在' };
    }

    if (user.status !== 'active') {
      return { valid: false, error: '用户账户已被禁用' };
    }

    return { valid: true };
  }

  /**
   * 安全的登录验证
   */
  async validateLogin(loginData, context) {
    const { username, password } = loginData;

    // 基本参数验证
    if (!username || !password) {
      return errorHandler.handleAuthError('INVALID_CREDENTIALS', '用户名和密码不能为空');
    }

    // 防止暴力破解，添加随机延时
    await new Promise(resolve => setTimeout(resolve, Math.random() * 500 + 300));

    // 检查登录限制
    const limitCheck = await this.checkLoginLimit(username, context.CLIENTIP);
    if (!limitCheck.allowed) {
      return errorHandler.handleAuthError('LOGIN_LIMIT', limitCheck.message);
    }

    try {
      const db = require('wx-server-sdk').database();

      // 查询用户
      const userResult = await db.collection('users')
        .where({
          username: username
        })
        .limit(1)
        .get();

      if (userResult.data.length === 0) {
        // 记录登录失败
        await this.logLoginAttempt(username, '用户不存在', context.CLIENTIP);
        
        return errorHandler.handleAuthError('USER_NOT_FOUND', '用户不存在');
      }

      const user = userResult.data[0];

      // 验证用户状态
      const statusCheck = this.validateUserStatus(user);
      if (!statusCheck.valid) {
        await this.logLoginAttempt(username, statusCheck.error, context.CLIENTIP);
        return errorHandler.handleAuthError('USER_DISABLED', statusCheck.error);
      }

      // 验证密码
      const encryptedPassword = this.encryptPassword(password);
      if (user.password !== encryptedPassword && user.password !== password) {
        // 兼容旧密码（未加密的）
        await this.logLoginAttempt(username, '密码错误', context.CLIENTIP);
        return errorHandler.handleAuthError('INVALID_CREDENTIALS', '密码错误');
      }

      // 登录成功，更新用户信息
      await db.collection('users').doc(user._id).update({
        data: {
          lastLoginAt: Date.now(),
          lastLoginIP: context.CLIENTIP,
          loginCount: (user.loginCount || 0) + 1
        }
      });

      // 记录成功登录
      await this.logLoginAttempt(username, '登录成功', context.CLIENTIP);

      // 生成令牌
      const token = this.generateSecureToken(user);
      const permissions = this.getUserPermissions(user.role);

      return errorHandler.createSuccessResponse({
        token: token,
        user: {
          id: user._id,
          username: user.username,
          name: user.name,
          role: user.role,
          avatar: user.avatar,
          department: user.department,
          permissions: permissions
        }
      }, '登录成功');

    } catch (error) {
      console.error('登录验证失败:', error);
      
      // 记录系统错误
      await this.logLoginAttempt(username, '系统错误', context.CLIENTIP, error.message);
      
      return errorHandler.handleError(error, '登录验证');
    }
  }

  /**
   * 验证API请求
   */
  async validateApiRequest(authorizationHeader) {
    if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
      return { valid: false, error: '缺少认证令牌' };
    }

    const token = authorizationHeader.replace('Bearer ', '');
    const tokenResult = this.verifyToken(token);

    if (!tokenResult.valid) {
      return { valid: false, error: tokenResult.error };
    }

    return { valid: true, user: tokenResult.payload };
  }
}

// 创建全局实例
const authUtils = new AuthUtils();

module.exports = {
  AuthUtils,
  authUtils
};