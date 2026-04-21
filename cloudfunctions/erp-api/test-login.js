/**
 * 测试登录功能
 */

const cloud = require('wx-server-sdk');

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV
});

/**
 * 测试登录函数
 */
exports.main = async (event, context) => {
  console.log('[test-login] 开始测试登录');
  
  const { action, username, password } = event;
  const wxContext = cloud.getWXContext();
  
  console.log('[test-login] 请求参数:', { action, username, password: password ? '***' : undefined });
  console.log('[test-login] 微信上下文:', wxContext);
  
  try {
    if (action === 'simple_login') {
      console.log('[test-login] 执行简单登录测试');
      
      // 测试云数据库连接
      const db = cloud.database();
      console.log('[test-login] 数据库初始化成功');
      
      // 尝试查询用户集合
      const testResult = await db.collection('users').limit(1).get();
      console.log('[test-login] 用户集合查询结果:', testResult);
      
      // 返回测试结果
      return {
        success: true,
        message: '测试成功',
        data: {
          hasUsers: testResult.data.length > 0,
          collection: 'users',
          env: cloud.DYNAMIC_CURRENT_ENV,
          openid: wxContext.OPENID
        }
      };
    }
    
    if (action === 'create_user') {
      console.log('[test-login] 创建测试用户');
      
      const db = cloud.database();
      const now = Date.now();
      
      const testUser = {
        username: 'testuser',
        password: 'test123',
        name: '测试用户',
        role: 'user',
        status: 'active',
        createdAt: now,
        updatedAt: now,
        _version: 1
      };
      
      const result = await db.collection('users').add({
        data: testUser
      });
      
      console.log('[test-login] 用户创建结果:', result);
      
      return {
        success: true,
        message: '用户创建成功',
        data: {
          userId: result._id,
          username: testUser.username
        }
      };
    }
    
    return {
      success: false,
      message: '未知操作'
    };
  } catch (error) {
    console.error('[test-login] 测试失败:', error);
    return {
      success: false,
      message: error.message,
      error: error.stack
    };
  }
};