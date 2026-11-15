@echo off
chcp 65001 >nul
title ShuWen DH Platform - Stop
cd /d "%~dp0"

rem Stops the background platform process precisely by PID
rem (recorded in .runtime\instance.json), with a port scan fallback.

where node >nul 2>nul
if errorlevel 1 (
  echo   [ERROR] Node.js not found.
  pause
  exit /b 1
)

node "%~dp0scripts\launch.js" --stop
echo.
pause
