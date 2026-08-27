@echo off
:: zhiyun-label one-click launcher (production mode)
:: install deps -> build frontend -> start single server (port 3001) -> open browser
cd /d %~dp0

echo =======================================================
echo   zhiyun-label platform - one-click startup (prod mode)
echo =======================================================
echo.

:: 0. node check
node -v >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js not found. Install Node 20+ and add it to PATH.
    pause
    exit /b 1
)

:: 1. install deps
echo [1/3] npm install ...
call npm install
if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
)

:: 2. build frontend -> dist/
echo [2/3] npm run build ...
call npm run build
if errorlevel 1 (
    echo [ERROR] frontend build failed.
    pause
    exit /b 1
)

:: 3. start single server in its own window (API + static on :3001)
echo [3/3] starting server (npm run start, port 3001) ...
start "zhiyun-server" cmd /k npm run start

:: wait for server to come up, then open browser
timeout /t 4 >nul
start http://localhost:3001

echo.
echo Server started in a separate window. Browser opening http://localhost:3001
echo Close that server window to stop the service.
echo =======================================================
pause
