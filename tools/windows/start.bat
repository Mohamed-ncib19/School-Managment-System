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

REM Ensure dependencies are intact before the launcher runs. Only install
REM when node_modules is missing - an unconditional install adds ~6s to every
REM launch. (The update path - do-update.ps1 - runs pnpm install itself.)
where pnpm >nul 2>&1
if %errorlevel%==0 (
  cd /d "%~dp0\..\.."
  if not exist "node_modules" (
    echo   [preflight] Installing dependencies ^(first run^)...
    call pnpm install
  ) else (
    echo   [preflight] Dependencies present
  )
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

