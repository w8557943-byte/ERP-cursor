/**
 * 密码迁移脚本
 * 将所有明文密码迁移到bcrypt哈希
 * 
 * 使用方法:
 * 1. 在微信开发者工具控制台运行: wx.cloud.callFunction({ name: 'database-init', data: { action: 'migrate_passwords' } })
 * 2. 或者在云函数中直接调用此脚本
 */

const cloud = require('wx-server-sdk');
const bcrypt = require('bcryptjs');

cloud.init({
    env: cloud.DYNAMIC_CURRENT_ENV
});

const db = cloud.database();
const _ = db.command;

/**
 * 迁移所有用户密码到bcrypt
 */
async function migratePasswords() {
    console.log('[密码迁移] 开始迁移用户密码...');

    const results = {
        total: 0,
        migrated: 0,
        alreadyHashed: 0,
        failed: 0,
        errors: []
    };

    try {
        // 获取所有用户
        const usersResult = await db.collection('users').get();
        const users = usersResult.data || [];

        results.total = users.length;
        console.log(`[密码迁移] 找到 ${results.total} 个用户`);

        for (const user of users) {
            try {
                const password = user.password || user.passwordHash || '';

                // 跳过已经是bcrypt哈希的密码
                if (password.startsWith('$2')) {
                    results.alreadyHashed++;
                    console.log(`[密码迁移] 用户 ${user.username || user._id} 密码已经是bcrypt哈希,跳过`);
                    continue;
                }

                // 跳过空密码
                if (!password) {
                    console.warn(`[密码迁移] 用户 ${user.username || user._id} 没有密码,跳过`);
                    results.failed++;
                    results.errors.push({
                        userId: user._id,
                        username: user.username,
                        error: '没有密码'
                    });
                    continue;
                }

                // 使用bcrypt哈希密码 (cost factor 12)
                const hashedPassword = bcrypt.hashSync(password, 12);

                // 更新数据库
                await db.collection('users').doc(user._id).update({
                    data: {
                        password: hashedPassword,
                        passwordMigratedAt: Date.now(),
                        updatedAt: Date.now()
                    }
                });

                results.migrated++;
                console.log(`[密码迁移] ✅ 用户 ${user.username || user._id} 密码已迁移`);

            } catch (error) {
                results.failed++;
                results.errors.push({
                    userId: user._id,
                    username: user.username,
                    error: error.message
                });
                console.error(`[密码迁移] ❌ 用户 ${user.username || user._id} 迁移失败:`, error);
            }
        }

        console.log('[密码迁移] 迁移完成!');
        console.log(`  总用户数: ${results.total}`);
        console.log(`  已迁移: ${results.migrated}`);
        console.log(`  已经是哈希: ${results.alreadyHashed}`);
        console.log(`  失败: ${results.failed}`);

        return {
            success: true,
            message: '密码迁移完成',
            data: results
        };

    } catch (error) {
        console.error('[密码迁移] 迁移过程出错:', error);
        return {
            success: false,
            message: '密码迁移失败',
            error: error.message,
            data: results
        };
    }
}

/**
 * 验证所有密码是否已迁移
 */
async function verifyPasswordMigration() {
    console.log('[密码验证] 开始验证密码迁移状态...');

    try {
        const usersResult = await db.collection('users').get();
        const users = usersResult.data || [];

        const unmigrated = users.filter(user => {
            const password = user.password || user.passwordHash || '';
            return password && !password.startsWith('$2');
        });

        if (unmigrated.length === 0) {
            console.log('[密码验证] ✅ 所有用户密码已迁移到bcrypt');
            return {
                success: true,
                message: '所有密码已迁移',
                data: {
                    total: users.length,
                    unmigrated: 0
                }
            };
        } else {
            console.warn(`[密码验证] ⚠️  还有 ${unmigrated.length} 个用户密码未迁移`);
            return {
                success: false,
                message: `还有 ${unmigrated.length} 个用户密码未迁移`,
                data: {
                    total: users.length,
                    unmigrated: unmigrated.length,
                    unmigratedUsers: unmigrated.map(u => ({
                        id: u._id,
                        username: u.username
                    }))
                }
            };
        }

    } catch (error) {
        console.error('[密码验证] 验证失败:', error);
        return {
            success: false,
            message: '验证失败',
            error: error.message
        };
    }
}

module.exports = {
    migratePasswords,
    verifyPasswordMigration
};

// 如果直接运行此脚本
if (require.main === module) {
    console.log('请在云函数中调用 migratePasswords() 或 verifyPasswordMigration()');
}
