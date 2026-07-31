@echo off
REM ============================================================
REM  IQ Academy - Start All Servers
REM  Double-click this file to start the system.
REM ============================================================
title IQ Academy - Starting
cd /d "%~dp0\.."

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0\scripts\launcher.ps1" %*

if errorlevel 1 (
  echo.
  echo   Startup failed. See the messages above.
  pause
)
