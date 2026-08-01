@echo off
REM ============================================================
REM  IQ Academy - Stop All Servers
REM  Double-click this file to shut down the system.
REM  The database keeps running: your data is not affected.
REM ============================================================
title IQ Academy - Stopping
cd /d "%~dp0\.."

REM UTF-8 code page so the box drawing renders correctly.
chcp 65001 >nul

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0\scripts\stop.ps1" %*
