/**
 * 订单号并发生成测试
 * 用于验证订单号生成逻辑在高并发情况下不会产生重复
 */

const axios = require('axios');

const BACKEND_URL = 'http://localhost:3003';
const CONCURRENT_REQUESTS = 50; // 并发请求数量

async function testOrderNumberGeneration() {
    console.log(`\n========== 订单号并发生成测试 ==========`);
    console.log(`并发请求数: ${CONCURRENT_REQUESTS}`);
    console.log(`后端地址: ${BACKEND_URL}\n`);

    const startTime = Date.now();
    const promises = [];

    // 创建并发请求
    for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
        promises.push(
            axios.post(`${BACKEND_URL}/api/order-numbers/generate`)
                .then(res => res.data.data || res.data)
                .catch(err => ({ error: err.message }))
        );
    }

    // 等待所有请求完成
    const results = await Promise.all(promises);
    const endTime = Date.now();

    // 分析结果
    const orderNumbers = [];
    const errors = [];

    results.forEach((result, index) => {
        if (result.error) {
            errors.push({ index, error: result.error });
        } else if (result.orderNumber || result.orderNo) {
            orderNumbers.push(result.orderNumber || result.orderNo);
        }
    });

    // 检查重复
    const uniqueNumbers = new Set(orderNumbers);
    const duplicates = orderNumbers.filter((num, index) =>
        orderNumbers.indexOf(num) !== index
    );

    // 输出结果
    console.log(`\n========== 测试结果 ==========`);
    console.log(`总请求数: ${CONCURRENT_REQUESTS}`);
    console.log(`成功生成: ${orderNumbers.length}`);
    console.log(`失败请求: ${errors.length}`);
    console.log(`唯一订单号: ${uniqueNumbers.size}`);
    console.log(`重复订单号: ${duplicates.length}`);
    console.log(`耗时: ${endTime - startTime}ms`);

    if (duplicates.length > 0) {
        console.log(`\n⚠️  发现重复订单号:`);
        const duplicateSet = new Set(duplicates);
        duplicateSet.forEach(dup => {
            const count = orderNumbers.filter(n => n === dup).length;
            console.log(`  - ${dup} (出现 ${count} 次)`);
        });
    } else {
        console.log(`\n✅ 所有订单号唯一,测试通过!`);
    }

    if (errors.length > 0) {
        console.log(`\n❌ 错误详情:`);
        errors.forEach(({ index, error }) => {
            console.log(`  请求 #${index}: ${error}`);
        });
    }

    // 显示前10个生成的订单号
    console.log(`\n生成的订单号示例 (前10个):`);
    orderNumbers.slice(0, 10).forEach((num, i) => {
        console.log(`  ${i + 1}. ${num}`);
    });

    return {
        total: CONCURRENT_REQUESTS,
        success: orderNumbers.length,
        failed: errors.length,
        unique: uniqueNumbers.size,
        duplicates: duplicates.length,
        passed: duplicates.length === 0
    };
}

// 运行测试
if (require.main === module) {
    testOrderNumberGeneration()
        .then(result => {
            console.log(`\n========== 测试完成 ==========\n`);
            process.exit(result.passed ? 0 : 1);
        })
        .catch(err => {
            console.error('测试失败:', err);
            process.exit(1);
        });
}

module.exports = { testOrderNumberGeneration };
