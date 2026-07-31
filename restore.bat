@echo off
REM  Restores the IQ Academy database from a backup in backups\
REM  This REPLACES current data - it asks for confirmation first.
title IQ Academy - Restore

cd /d "%~dp0"

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\restore.ps1"

echo.
pause
