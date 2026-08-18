@echo off
chcp 65001 >nul
title Antigravity IDE (CDP Debug Mode)

echo ========================================================
echo  🚀 Launching Antigravity with Remote Debugging Port 9000
echo ========================================================
echo.

node dist/bin/cli.js open
pause
