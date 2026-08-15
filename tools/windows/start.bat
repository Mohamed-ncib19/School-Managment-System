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

REM The original arguments are forwarded to launcher.ps1 on the start path
REM (e.g. -Prod). `restart` is a batch-level subcommand, not a launcher
REM argument, so the restart path blanks it before falling through to start.
set "LAUNCH_ARGS=%*"

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
set "SCRIPT_DIR=%~dp0"
shift 2>nul

REM --- preflight checks ----------------------------------------------------
REM Node first: without it nothing below can run, and the message it fails with
REM otherwise ("'node' is not recognized") does not say what to install.
where node >nul 2>&1
if not %errorlevel%==0 (
  echo.
  echo   [preflight] Node.js is not installed.
  echo.
  echo   Install Node.js 20 LTS or newer, then run start.bat again:
  echo     winget install OpenJS.NodeJS.LTS
  echo   or download it from https://nodejs.org
  echo.
  pause
  goto :EOF
)

where pnpm >nul 2>&1
if %errorlevel%==0 (
  if not exist "node_modules" (
    echo   [preflight] Installing dependencies (first run^)...
    call pnpm install
    if errorlevel 1 (
      echo.
      echo   [preflight] Dependency installation failed.
      echo   Check your internet connection, then run start.bat again.
      echo.
      pause
      goto :EOF
    )
  ) else (
    echo   [preflight] Dependencies present
    echo   [preflight] Checking build dependencies...
    node scripts/check-builds.mjs
  )
  cd /d "%~dp0\..\.."
) else (
  REM The launcher enables pnpm via corepack, so a missing pnpm here is not
  REM fatal - it just means the dependency check is deferred to that step.
  echo   [preflight] pnpm not found - the launcher will install it
)

REM --- launch ---------------------------------------------------------------
powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%scripts\launcher.ps1" %LAUNCH_ARGS%
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
REM 2s pause for the ports to release (ping works with redirected stdin, unlike timeout).
ping -n 3 127.0.0.1 >nul
echo.
set "LAUNCH_ARGS="
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
