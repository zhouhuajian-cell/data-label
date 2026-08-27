@echo off
:: 智标数据协作平台 - 一键启动脚本(生产模式)
:: 自动: 安装依赖 -> 构建前端 -> 单进程启动(端口默认3001) -> 打开浏览器
chcp 65001 >nul

:: 切换到脚本所在目录,保证从任意位置双击都能正常运行
cd /d %~dp0

echo =======================================================
echo        智标数据协作平台 - 一键启动 (生产模式)
echo =======================================================
echo.

:: 0. 环境检查
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] 未检测到 Node.js,请先安装 Node 20+ 并加入 PATH。
    pause
    exit /b 1
)

:: 1. 安装/校验依赖(已装则很快跳过)
echo [1/3] 安装依赖 (npm install)...
call npm install
if errorlevel 1 (
    echo [ERROR] 依赖安装失败,请检查网络或 node 版本。
    pause
    exit /b 1
)

:: 2. 构建前端 -> dist/
echo [2/3] 构建前端 (npm run build)...
call npm run build
if errorlevel 1 (
    echo [ERROR] 前端构建失败。
    pause
    exit /b 1
)

:: 3. 启动单进程服务(后端 API + 托管 dist 静态资源),独立窗口常驻
echo [3/3] 启动服务 (npm run start, 默认端口 3001)...
start "智标平台后端" cmd /k npm run start

:: 等待服务拉起后打开浏览器
timeout /t 4 >nul
start http://localhost:3001

echo.
echo 服务已在后台窗口启动,浏览器即将打开 http://localhost:3001
echo 关闭该后端窗口即可停止服务。
echo =======================================================
pause
