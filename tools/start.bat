@echo off
REM ============================================================
REM  IQ Academy - Start All Servers
REM  Double-click this file to start the system.
REM ============================================================
title IQ Academy
cd /d "%~dp0\.."

REM UTF-8 code page so the launcher's box drawing renders instead of
REM appearing as stray accented characters. >nul keeps the switch silent.
chcp 65001 >nul

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0\scripts\launcher.ps1" %*

if errorlevel 1 (
  title IQ Academy - Startup failed
  echo.
  pause
)
