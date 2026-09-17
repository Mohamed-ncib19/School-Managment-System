@echo off
REM Local dev helper (not part of the installed product): starts the Nest API
REM on :3001 and the Next.js portal on :3000 with live logs in this window.
REM Stop both with Ctrl+C.
title School Management System - dev servers
cd /d "%~dp0"
echo Starting backend :3001 + frontend :3000 ...
echo Login: http://localhost:3000/login
echo.
call pnpm dev
echo.
echo Servers stopped.
pause
