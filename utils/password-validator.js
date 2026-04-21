/**
 * 密码强度验证工具
 * 用于验证密码复杂度和生成安全密码
 */

const crypto = require('crypto');

/**
 * 密码强度要求
 */
const PASSWORD_REQUIREMENTS = {
    minLength: 12,
    requireUppercase: true,
    requireLowercase: true,
    requireNumbers: true,
    requireSpecialChars: true,
    specialChars: '!@#$%^&*()_+-=[]{}|;:,.<>?'
};

/**
 * 验证密码强度
 * @param {string} password - 待验证的密码
 * @returns {Object} - 验证结果 { valid: boolean, errors: string[] }
 */
function validatePasswordStrength(password) {
    const errors = [];

    if (!password || typeof password !== 'string') {
        return { valid: false, errors: ['密码不能为空'] };
    }

    // 检查长度
    if (password.length < PASSWORD_REQUIREMENTS.minLength) {
        errors.push(`密码长度至少${PASSWORD_REQUIREMENTS.minLength}位`);
    }

    // 检查大写字母
    if (PASSWORD_REQUIREMENTS.requireUppercase && !/[A-Z]/.test(password)) {
        errors.push('密码必须包含至少一个大写字母');
    }

    // 检查小写字母
    if (PASSWORD_REQUIREMENTS.requireLowercase && !/[a-z]/.test(password)) {
        errors.push('密码必须包含至少一个小写字母');
    }

    // 检查数字
    if (PASSWORD_REQUIREMENTS.requireNumbers && !/\d/.test(password)) {
        errors.push('密码必须包含至少一个数字');
    }

    // 检查特殊字符
    if (PASSWORD_REQUIREMENTS.requireSpecialChars) {
        const specialCharsRegex = new RegExp(`[${PASSWORD_REQUIREMENTS.specialChars.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}]`);
        if (!specialCharsRegex.test(password)) {
            errors.push('密码必须包含至少一个特殊字符 (!@#$%^&*等)');
        }
    }

    // 检查常见弱密码
    const weakPasswords = [
        'password', 'admin123', 'test123', '123456', 'qwerty',
        '12345678', 'abc123', 'password123', 'admin', 'root'
    ];

    if (weakPasswords.some(weak => password.toLowerCase().includes(weak))) {
        errors.push('密码不能包含常见弱密码模式');
    }

    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * 生成安全的随机密码
 * @param {number} length - 密码长度,默认16位
 * @returns {string} - 生成的密码
 */
function generateSecurePassword(length = 16) {
    const uppercase = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const lowercase = 'abcdefghijklmnopqrstuvwxyz';
    const numbers = '0123456789';
    const special = '!@#$%^&*()_+-=';

    const allChars = uppercase + lowercase + numbers + special;

    let password = '';

    // 确保至少包含每种类型的字符
    password += uppercase[crypto.randomInt(0, uppercase.length)];
    password += lowercase[crypto.randomInt(0, lowercase.length)];
    password += numbers[crypto.randomInt(0, numbers.length)];
    password += special[crypto.randomInt(0, special.length)];

    // 填充剩余长度
    for (let i = password.length; i < length; i++) {
        password += allChars[crypto.randomInt(0, allChars.length)];
    }

    // 打乱顺序
    password = password.split('').sort(() => crypto.randomInt(0, 3) - 1).join('');

    return password;
}

/**
 * 获取密码强度等级
 * @param {string} password - 待评估的密码
 * @returns {Object} - { level: string, score: number, feedback: string }
 */
function getPasswordStrength(password) {
    let score = 0;

    if (!password) {
        return { level: 'weak', score: 0, feedback: '密码为空' };
    }

    // 长度评分
    if (password.length >= 8) score += 1;
    if (password.length >= 12) score += 1;
    if (password.length >= 16) score += 1;

    // 字符类型评分
    if (/[a-z]/.test(password)) score += 1;
    if (/[A-Z]/.test(password)) score += 1;
    if (/\d/.test(password)) score += 1;
    if (/[^a-zA-Z0-9]/.test(password)) score += 1;

    // 多样性评分
    const uniqueChars = new Set(password).size;
    if (uniqueChars >= password.length * 0.5) score += 1;

    let level, feedback;

    if (score <= 3) {
        level = 'weak';
        feedback = '密码强度弱,建议增加长度和复杂度';
    } else if (score <= 5) {
        level = 'medium';
        feedback = '密码强度中等,建议进一步增强';
    } else if (score <= 7) {
        level = 'strong';
        feedback = '密码强度良好';
    } else {
        level = 'very-strong';
        feedback = '密码强度优秀';
    }

    return { level, score, feedback };
}

module.exports = {
    validatePasswordStrength,
    generateSecurePassword,
    getPasswordStrength,
    PASSWORD_REQUIREMENTS
};
