#!/bin/bash

# PC端数据修复部署脚本
# 此脚本用于部署修复PC端路由映射和集合定义的更改

echo "=========================================="
echo "开始部署PC端数据修复..."
echo "=========================================="

# 设置变量
PROJECT_ID="erp-system-prod-1glmda1zf4f9c7a7"
REGION="ap-shanghai"

echo "1. 部署 api-bridge 云函数..."
# 部署 api-bridge 云函数
tcb functions:deploy api-bridge

if [ $? -eq 0 ]; then
    echo "✓ api-bridge 云函数部署成功"
else
    echo "✗ api-bridge 云函数部署失败"
    exit 1
fi

echo "2. 部署 database-init 云函数..."
# 部署 database-init 云函数
tcb functions:deploy database-init

if [ $? -eq 0 ]; then
    echo "✓ database-init 云函数部署成功"
else
    echo "✗ database-init 云函数部署失败"
    exit 1
fi

echo "3. 初始化数据库集合..."
# 调用数据库初始化函数
tcb functions:invoke database-init --data '{"action":"init"}'

if [ $? -eq 0 ]; then
    echo "✓ 数据库集合初始化成功"
else
    echo "✗ 数据库集合初始化失败"
    exit 1
fi

echo "4. 验证部署结果..."
# 测试API端点
echo "测试订单数据端点..."
curl -s "https://$PROJECT_ID-$REGION.app.tcloudbase.com/api-bridge/orders/list" | head -n 1

echo -e "\n测试生产数据端点..."
curl -s "https://$PROJECT_ID-$REGION.app.tcloudbase.com/api-bridge/workorders/list" | head -n 1

echo -e "\n测试库存数据端点..."
curl -s "https://$PROJECT_ID-$REGION.app.tcloudbase.com/api-bridge/inventory/list" | head -n 1

echo -e "\n测试采购数据端点..."
curl -s "https://$PROJECT_ID-$REGION.app.tcloudbase.com/api-bridge/purchases/list" | head -n 1

echo "=========================================="
echo "部署完成！"
echo "=========================================="
echo "修复内容："
echo "1. 将 /workorders/list 路由重定向到 production 集合"
echo "2. 改进排序字段兼容性，使用更通用的 createdAt 字段"
echo "3. 完善集合别名映射，确保不同路径能访问同一数据源"
echo "4. 添加缺失的集合定义，包括 workorders 和 purchase_orders"
echo ""
echo "现在可以打开 pc-data-fix-test.html 测试修复效果"