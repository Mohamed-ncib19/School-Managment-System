@echo off
REM ============================================================
REM  SCHOOL MANAGEMENT SYSTEM - Start All Servers
REM  Double-click this file to start the system.
REM ============================================================
title SCHOOL MANAGEMENT SYSTEM
cd /d "%~dp0\..\.."

REM UTF-8 code page so the launcher's box drawing renders instead of
REM appearing as stray accented characters. >nul keeps the switch silent.
chcp 65001 >nul

REM Ensure dependencies are intact before the launcher runs.
where pnpm >nul 2>&1
if %errorlevel%==0 (
  echo   [preflight] Checking dependencies...
  cd /d "%~dp0\..\.."
  call pnpm install
  cd /d "%~dp0\..\.."
) else (
  echo   [preflight] pnpm not found - skipping dependency check
)

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0\scripts\launcher.ps1" %*

if errorlevel 1 (
  title SCHOOL MANAGEMENT SYSTEM - Startup failed
  echo.
  pause
)
