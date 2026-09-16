@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js not found. Please install Node 20+ first.
  pause
  exit /b 1
)

node "scripts\start.mjs" %*

if errorlevel 1 pause
