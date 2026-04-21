/**
 * 统一错误处理模块
 * 提供统一的错误处理和响应格式
 */

class ErrorHandler {
  constructor() {
    this.errorCodes = {
      // 系统错误
      SYSTEM_ERROR: 'SYSTEM_ERROR',
      DATABASE_ERROR: 'DATABASE_ERROR',
      NETWORK_ERROR: 'NETWORK_ERROR',
      
      // 业务错误
      VALIDATION_ERROR: 'VALIDATION_ERROR',
      AUTH_ERROR: 'AUTH_ERROR',
      PERMISSION_DENIED: 'PERMISSION_DENIED',
      RESOURCE_NOT_FOUND: 'RESOURCE_NOT_FOUND',
      
      // 用户错误
      INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
      USER_NOT_FOUND: 'USER_NOT_FOUND',
      USER_DISABLED: 'USER_DISABLED'
    };
  }

  /**
   * 创建标准错误响应
   */
  createErrorResponse(errorCode, message, details = null) {
    return {
      success: false,
      error: {
        code: errorCode,
        message: message,
        details: details,
        timestamp: Date.now()
      }
    };
  }

  /**
   * 创建成功响应
   */
  createSuccessResponse(data = null, message = '操作成功') {
    return {
      success: true,
      data: data,
      message: message,
      timestamp: Date.now()
    };
  }

  /**
   * 处理数据库错误
   */
  handleDatabaseError(error) {
    console.error('数据库错误:', error);
    
    if (error.errCode === -1) {
      return this.createErrorResponse(
        this.errorCodes.DATABASE_ERROR,
        '数据库连接失败',
        { errCode: error.errCode, errMsg: error.errMsg }
      );
    }
    
    if (error.errCode === 60103) {
      return this.createErrorResponse(
        this.errorCodes.RESOURCE_NOT_FOUND,
        '请求的资源不存在',
        { errCode: error.errCode, errMsg: error.errMsg }
      );
    }
    
    return this.createErrorResponse(
      this.errorCodes.DATABASE_ERROR,
      '数据库操作失败',
      { errCode: error.errCode, errMsg: error.errMsg }
    );
  }

  /**
   * 处理认证错误
   */
  handleAuthError(errorType = 'INVALID_CREDENTIALS', message = '认证失败') {
    return this.createErrorResponse(
      this.errorCodes.AUTH_ERROR,
      message,
      { errorType: errorType }
    );
  }

  /**
   * 处理验证错误
   */
  handleValidationError(field, message) {
    return this.createErrorResponse(
      this.errorCodes.VALIDATION_ERROR,
      '参数验证失败',
      { field: field, message: message }
    );
  }

  /**
   * 处理权限错误
   */
  handlePermissionError(resource = null) {
    return this.createErrorResponse(
      this.errorCodes.PERMISSION_DENIED,
      '权限不足，无法访问该资源',
      { resource: resource }
    );
  }

  /**
   * 处理未找到资源错误
   */
  handleNotFoundError(resourceType, resourceId) {
    return this.createErrorResponse(
      this.errorCodes.RESOURCE_NOT_FOUND,
      `${resourceType}不存在`,
      { resourceType: resourceType, resourceId: resourceId }
    );
  }

  /**
   * 通用错误处理
   */
  handleError(error, context = '') {
    console.error(`[ErrorHandler] ${context} 错误:`, error);
    
    if (error.errCode) {
      // 云开发错误
      return this.handleDatabaseError(error);
    }
    
    if (error.message && error.message.includes('权限')) {
      return this.handlePermissionError();
    }
    
    if (error.message && error.message.includes('不存在')) {
      return this.handleNotFoundError('资源', '');
    }
    
    return this.createErrorResponse(
      this.errorCodes.SYSTEM_ERROR,
      '系统内部错误',
      { message: error.message }
    );
  }

  /**
   * 包装异步函数，提供统一的错误处理
   */
  async wrapAsync(fn, context = '') {
    try {
      const result = await fn();
      return this.createSuccessResponse(result);
    } catch (error) {
      return this.handleError(error, context);
    }
  }

  /**
   * 验证必需参数
   */
  validateRequiredParams(params, requiredFields) {
    const missingFields = [];
    
    for (const field of requiredFields) {
      if (params[field] === undefined || params[field] === null || params[field] === '') {
        missingFields.push(field);
      }
    }
    
    if (missingFields.length > 0) {
      throw new Error(`缺少必需参数: ${missingFields.join(', ')}`);
    }
    
    return true;
  }
}

// 创建全局实例
const errorHandler = new ErrorHandler();

module.exports = {
  ErrorHandler,
  errorHandler,
  errorCodes: errorHandler.errorCodes
};