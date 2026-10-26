@echo off
chcp 65001 > nul
title AI VTuber Framework Lite

echo ==============================================
echo   AI VTuber Framework Lite - Starting...
echo ==============================================

if not exist node_modules (
    echo [1/3] Installing dependencies...
    call npm install
    if errorlevel 1 goto error
)

if not exist dist\server\index.js (
    echo [2/3] Building project...
    call npm run build
    if errorlevel 1 goto error
)

if not exist .env (
    copy .env.example .env > nul
)

echo [3/3] Launching app...
call npm start
goto end

:error
echo [ERROR] Failed to start. Check errors above.
pause

:end
