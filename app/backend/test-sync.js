import axios from 'axios';

async function testSyncService() {
  try {
    // 1. 登录获取访问令牌
    console.log('🔄 登录获取访问令牌...');
    const loginResponse = await axios.post('http://localhost:3000/api/auth/login', {
      username: 'admin',
      password: 'admin123'
    });
    
    console.log('📋 登录响应:', JSON.stringify(loginResponse.data, null, 2));
    const accessToken = loginResponse.data.data.token;
    console.log('✅ 登录成功，获取访问令牌:', accessToken ? accessToken.substring(0, 20) + '...' : '无令牌');
    
    // 2. 检查同步状态
    console.log('🔍 检查同步状态...');
    const statusResponse = await axios.get('http://localhost:3000/api/sync/status', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    console.log('📊 同步状态:', JSON.stringify(statusResponse.data, null, 2));
    
    // 3. 检查客户数据 - 使用正确的API端点
    console.log('👥 检查客户数据...');
    try {
      const customersResponse = await axios.get('http://localhost:3000/api/customers', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      console.log('👥 客户数据数量:', customersResponse.data.data?.length || 0);
    } catch (error) {
      console.log('👥 客户数据获取失败:', error.response?.data || error.message);
    }
    
    // 4. 执行强制同步 - 使用正确的API端点
    console.log('🔄 执行强制同步...');
    try {
      const forceSyncResponse = await axios.post('http://localhost:3000/api/sync/sync/force', {}, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      console.log('✅ 强制同步结果:', JSON.stringify(forceSyncResponse.data, null, 2));
    } catch (error) {
      console.log('❌ 强制同步失败:', error.response?.data || error.message);
      // 尝试使用手动同步端点
      try {
        const syncResponse = await axios.post('http://localhost:3000/api/sync/sync/start', {
          type: 'all'
        }, {
          headers: { 'Authorization': `Bearer ${accessToken}` }
        });
        console.log('✅ 使用同步启动结果:', JSON.stringify(syncResponse.data, null, 2));
      } catch (syncError) {
        console.log('❌ 同步启动也失败:', syncError.response?.data || syncError.message);
      }
    }
    
    // 5. 等待3秒后再次检查客户数据
    console.log('⏳ 等待3秒后再次检查客户数据...');
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    try {
      const customersResponse2 = await axios.get('http://localhost:3000/api/customers', {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      
      console.log('👥 同步后客户数据数量:', customersResponse2.data.data?.length || 0);
    } catch (error) {
      console.log('👥 同步后客户数据获取失败:', error.response?.data || error.message);
    }
    
    // 6. 检查同步历史
    console.log('📋 检查同步历史...');
    const historyResponse = await axios.get('http://localhost:3000/api/sync/history', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    
    console.log('📋 同步历史:', JSON.stringify(historyResponse.data, null, 2));
    
    console.log('✅ 测试完成！');
    
  } catch (error) {
    console.error('❌ 测试失败:', error.response?.data || error.message);
  }
}

testSyncService();