@echo off
title TikTok Live Bot v2
color 0A
echo.
echo  ============================================
echo   TikTok Live Bot v2 - Starting...
echo  ============================================
echo.

cd /d "%~dp0"

:: Check Node.js
node --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Node.js tidak ditemukan!
    echo  Download dari: https://nodejs.org
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo  Installing dependencies...
    npm install
    echo.
)

echo  Starting server...
echo  Dashboard : http://localhost:3000
echo  Chat OVL  : http://localhost:3000/overlay/chat
echo  Gift OVL  : http://localhost:3000/overlay/gift
echo  LBoard OVL: http://localhost:3000/overlay/leaderboard
echo.
echo  Press Ctrl+C to stop.
echo  ============================================
echo.

start "" http://localhost:3000
node server.js
pause
