@echo off
REM  Takes an immediate backup of the IQ Academy database into backups\
title IQ Academy - Backup

cd /d "%~dp0"

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backup.ps1"

echo.
pause
