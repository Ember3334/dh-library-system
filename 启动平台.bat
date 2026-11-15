@echo off
chcp 65001 >nul
title ShuWen DH Platform - Diagnostic
cd /d "%~dp0"

rem Diagnostic entry. A visible window so errors are readable.
rem Daily use: double-click ShuWen.vbs (hidden window instead).

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo   [ERROR] Node.js not found  /  未检测到 Node.js
  echo.
  echo   Please install Node.js 18+ from https://nodejs.org
  echo   请先安装 Node.js 18 或更高版本，然后重新双击本文件。
  echo.
  pause
  exit /b 1
)

node "%~dp0scripts\launch.js" %*
if errorlevel 1 pause
