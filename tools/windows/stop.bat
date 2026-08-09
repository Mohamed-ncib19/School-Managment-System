@echo off
REM ============================================================
REM  SCHOOL MANAGEMENT SYSTEM - Stop All Servers
REM  Double-click this file to stop the system.
REM  Stops the web portal and the API, and the project's own
REM  portable PostgreSQL cluster when one is in use.
REM ============================================================
title SCHOOL MANAGEMENT SYSTEM - Stop
cd /d "%~dp0\..\.."

REM UTF-8 code page so the engine's box drawing renders correctly.
chcp 65001 >nul

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0\scripts\stop.ps1" -StopDatabase