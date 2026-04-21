/**
 * 云开发环境部署状态检查
 * 检查实际部署的云函数数量与本地云函数目录的差异
 */

async function checkCloudFunctionDeploymentStatus() {
    console.log('=== 云开发环境部署状态检查 ===');
    
    // 本地云函数列表（基于文件系统）
    const localCloudFunctions = [
        'api-bridge',
        'data-sync', 
        'database-init',
        'database-ops',
        'deploy-diagnosis',
        'erp-api',
        'sync-monitor',
        'utils',
        'websocket-manager'
    ];
    
    console.log(`本地云函数数量: ${localCloudFunctions.length}`);
    console.log('本地云函数列表:', localCloudFunctions.join(', '));
    
    // 在云开发环境中执行的检查代码
    const cloudCheckCode = `
        const checkDeploymentStatus = async () => {
            try {
                // 调用部署诊断云函数
                const result = await wx.cloud.callFunction({
                    name: 'deploy-diagnosis',
                    data: {
                        action: 'list_cloud_functions'
                    }
                });
                
                console.log('云开发环境部署状态:', result.result);
                
                if (result.result.success && result.result.data) {
                    const deployedFunctions = result.result.data.functions || [];
                    console.log('实际部署的云函数数量:', deployedFunctions.length);
                    console.log('实际部署的云函数列表:', deployedFunctions.join(', '));
                    
                    // 对比分析
                    const localFunctions = [
                        'api-bridge', 'data-sync', 'database-init', 
                        'database-ops', 'deploy-diagnosis', 'erp-api', 
                        'sync-monitor', 'utils', 'websocket-manager'
                    ];
                    
                    console.log('\\n=== 部署差异分析 ===');
                    console.log('本地: ' + localFunctions.length + '个云函数');
                    console.log('云端: ' + deployedFunctions.length + '个云函数');
                    
                    if (localFunctions.length !== deployedFunctions.length) {
                        const missing = localFunctions.filter(f => !deployedFunctions.includes(f));
                        const extra = deployedFunctions.filter(f => !localFunctions.includes(f));
                        
                        if (missing.length > 0) {
                            console.log('缺少的云函数:', missing.join(', '));
                            console.log('这些云函数需要重新部署到云开发环境');
                        }
                        
                        if (extra.length > 0) {
                            console.log('多余的云函数:', extra.join(', '));
                        }
                    }
                }
                
                return result.result;
            } catch (error) {
                console.error('部署状态检查失败:', error);
                return { success: false, error: error.message };
            }
        };
        
        // 执行检查
        checkDeploymentStatus();
    `;
    
    console.log('=== 检查代码 ===');
    console.log('请在微信开发者工具控制台中执行以下代码:');
    console.log('```javascript');
    console.log(cloudCheckCode);
    console.log('```');
    
    // 手动检查方法
    const manualCheckSteps = [
        '1. 在微信开发者工具中，打开云开发控制台',
        '2. 进入"云函数"页面',
        '3. 查看已部署的云函数列表',
        '4. 对比本地cloudfunctions目录中的云函数',
        '5. 找出缺失的云函数并重新部署'
    ];
    
    console.log('=== 手动检查方法 ===');
    manualCheckSteps.forEach(step => console.log(step));
    
    // 常见问题及解决方案
    const commonIssues = {
        'utils云函数未部署': {
            '原因': 'utils云函数缺少index.js文件（已修复）',
            '解决方案': '重新上传部署utils云函数'
        },
        'deploy-diagnosis云函数未部署': {
            '原因': '部署诊断云函数可能没有正确部署',
            '解决方案': '首先部署deploy-diagnosis云函数'
        },
        '依赖问题': {
            '原因': '云函数依赖安装失败',
            '解决方案': '上传时选择"云端安装依赖"选项'
        },
        '权限问题': {
            '原因': '云函数权限配置错误',
            '解决方案': '检查云函数权限设置'
        }
    };
    
    console.log('=== 常见问题及解决方案 ===');
    for (const [issue, info] of Object.entries(commonIssues)) {
        console.log(`❌ ${issue}`);
        console.log(`   原因: ${info['原因']}`);
        console.log(`   解决方案: ${info['解决方案']}`);
        console.log('');
    }
    
    // 批量部署建议
    const deploymentSuggestions = [
        '1. 优先部署 deploy-diagnosis 云函数（用于后续状态检查）',
        '2. 部署 utils 云函数（刚刚修复的）',
        '3. 部署其他核心云函数（database-init, api-bridge等）',
        '4. 最后部署辅助云函数（sync-monitor, websocket-manager等）'
    ];
    
    console.log('=== 批量部署建议 ===');
    deploymentSuggestions.forEach(suggestion => console.log(suggestion));
}

// 在控制台中直接调用检查函数
checkCloudFunctionDeploymentStatus();