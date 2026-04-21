@echo off
REM PC端数据修复部署脚本 - Windows版本
REM 此脚本用于部署修复PC端路由映射和集合定义的更改

echo ==========================================
echo 开始部署PC端数据修复...
echo ==========================================

REM 设置变量
set PROJECT_ID=erp-system-prod-1glmda1zf4f9c7a7
set REGION=ap-shanghai

echo 1. 部署 erp-api 和 api-bridge 云函数...
REM 部署 erp-api 云函数
echo 正在部署 erp-api...
tcb functions:deploy erp-api
if %errorlevel% neq 0 (
    echo ✗ erp-api 云函数部署失败
    exit /b 1
)
echo ✓ erp-api 云函数部署成功

REM 部署 api-bridge 云函数
echo 正在部署 api-bridge...
tcb functions:deploy api-bridge
if %errorlevel% neq 0 (
    echo ✗ api-bridge 云函数部署失败
    exit /b 1
)
echo ✓ api-bridge 云函数部署成功

echo 2. 部署 database-init 云函数...
REM 部署 database-init 云函数
tcb functions:deploy database-init
if %errorlevel% neq 0 (
    echo ✗ database-init 云函数部署失败
    exit /b 1
)
echo ✓ database-init 云函数部署成功

echo 3. 初始化数据库集合...
REM 调用数据库初始化函数
tcb functions:invoke database-init --data "{\"action\":\"init\"}"
if %errorlevel% neq 0 (
    echo ✗ 数据库集合初始化失败
    exit /b 1
)
echo ✓ 数据库集合初始化成功

echo 4. 验证部署结果...
echo 测试API端点...

echo.
echo 测试订单数据端点...
curl -s "https://%PROJECT_ID%-%REGION%.app.tcloudbase.com/api-bridge/orders/list" | head -n 1

echo.
echo 测试生产数据端点...
curl -s "https://%PROJECT_ID%-%REGION%.app.tcloudbase.com/api-bridge/workorders/list" | head -n 1

echo.
echo 测试库存数据端点...
curl -s "https://%PROJECT_ID%-%REGION%.app.tcloudbase.com/api-bridge/inventory/list" | head -n 1

echo.
echo 测试采购数据端点...
curl -s "https://%PROJECT_ID%-%REGION%.app.tcloudbase.com/api-bridge/purchases/list" | head -n 1

echo.
echo ==========================================
echo 部署完成！
echo ==========================================
echo 修复内容：
echo 1. 将 /workorders/list 路由重定向到 production 集合
echo 2. 改进排序字段兼容性，使用更通用的 createdAt 字段
echo 3. 完善集合别名映射，确保不同路径能访问同一数据源
echo 4. 添加缺失的集合定义，包括 workorders 和 purchase_orders
echo.
echo 现在可以打开 pc-data-fix-test.html 测试修复效果
echo.
pause