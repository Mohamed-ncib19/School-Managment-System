@echo off
REM ============================================================
REM  SCHOOL MANAGEMENT SYSTEM - Unified Launcher
REM  Double-click to start, or pass a subcommand:
REM    start.bat            start the servers (default)
REM    start.bat start      start the servers
REM    start.bat stop       stop the servers and portable PostgreSQL
REM    start.bat restart    restart the servers
REM    start.bat status     show running status
REM ============================================================
title SCHOOL MANAGEMENT SYSTEM
cd /d "%~dp0\..\.."

REM UTF-8 so the console UI renders correctly.
chcp 65001 >nul

set "CMD=%~1"
if "%CMD%"=="" set "CMD=start"

REM Backward compatibility: if the first arg is not a known subcommand,
REM pass everything straight to launcher.ps1 (e.g. start.bat -Prod).
if /i not "%CMD%"=="start" if /i not "%CMD%"=="stop" if /i not "%CMD%"=="restart" if /i not "%CMD%"=="status" (
  powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0\scripts\launcher.ps1" %*
  if errorlevel 1 (
    title SCHOOL MANAGEMENT SYSTEM - Startup failed
    echo.
    pause
  )
  goto :EOF
)

if /i "%CMD%"=="stop"    goto :DO_STOP
if /i "%CMD%"=="restart" goto :DO_RESTART
if /i "%CMD%"=="status"  goto :DO_STATUS

REM ============================================================
REM  START (default)
REM ============================================================
:DO_START
shift 2>nul

REM --- preflight checks ----------------------------------------------------
where pnpm >nul 2>&1
if %errorlevel%==0 (
  if not exist "node_modules" (
    echo   [preflight] Installing dependencies (first run^)...
    call pnpm install
  ) else (
    echo   [preflight] Dependencies present
    echo   [preflight] Checking build dependencies...
    node scripts/check-builds.mjs
  )
  cd /d "%~dp0\..\.."
) else (
  echo   [preflight] pnpm not found - skipping dependency check
)

REM --- launch ---------------------------------------------------------------
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0\scripts\launcher.ps1" %*
if errorlevel 1 (
  title SCHOOL MANAGEMENT SYSTEM - Startup failed
  echo.
  pause
)
goto :EOF

REM ============================================================
REM  STOP
REM ============================================================
:DO_STOP
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0\scripts\stop.ps1" -StopDatabase
goto :EOF

REM ============================================================
REM  RESTART
REM ============================================================
:DO_RESTART
echo.
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0\scripts\stop.ps1" -StopDatabase
timeout /t 2 /nobreak >nul
echo.
goto :DO_START

REM ============================================================
REM  STATUS
REM ============================================================
:DO_STATUS
powershell -NoLogo -NoProfile -Command ^
  "$ports=@{3000='Web portal';3001='API'};" ^
  "foreach($p in 3000,3001){" ^
  "  $l=Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue|Select-Object -First 1;" ^
  "  if($l){Write-Host ('  '+$ports[$p]+' (port '+$p+'): RUNNING (PID '+$l.OwningProcess+')') -ForegroundColor Green}" ^
  "  else{Write-Host ('  '+$ports[$p]+' (port '+$p+'): stopped') -ForegroundColor DarkGray}" ^
  "}"
goto :EOF
