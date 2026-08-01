@echo off
REM ============================================================
REM  IQ Academy - Update Script
REM  Fetches from GitHub, pulls changes, syncs dependencies,
REM  runs migrations (data-safe), and restarts the app.
REM ============================================================
title IQ Academy - Update
cd /d "%~dp0\.."

setlocal enabledelayedexpansion

echo.
echo ==========================================
echo   IQ Academy - Update Script
echo ==========================================
echo.

REM Check prerequisites
where git >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Git is not available in PATH.
    pause
    exit /b 1
)

if not exist ".git" (
    echo ERROR: Not a git repository. Run this from the project root.
    pause
    exit /b 1
)

REM Fetch latest
echo Fetching latest changes from origin...
git fetch origin
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to fetch from origin.
    pause
    exit /b 1
)

REM Check if behind
for /f "delims=" %%i in ('git rev-list HEAD..origin/main --count 2^>nul') do set BEHIND=%%i
for /f "delims=" %%i in ('git rev-list origin/main..HEAD --count 2^>nul') do set AHEAD=%%i

echo.
echo Local commits ahead of remote: %AHEAD%
echo Remote commits ahead of local: %BEHIND%

if "%BEHIND%"=="0" (
    echo.
    echo Already on the latest version. No update needed.
    goto :start_servers
)

echo.
echo Found %BEHIND% new commit(s). Proceeding with update...

REM Stop servers
echo.
echo Stopping servers...
call "%~dp0stop.bat"

REM Wait for Windows to release locked DLL handles (fixes EPERM on prisma generate)
echo.
echo Waiting for processes to release file handles...
set /a WAIT_COUNT=0
:wait_loop
timeout /t 1 /nobreak >nul
set /a WAIT_COUNT+=1
netstat -ano | findstr ":3000 " >nul 2>&1
set PORT3000=%ERRORLEVEL%
netstat -ano | findstr ":3001 " >nul 2>&1
set PORT3001=%ERRORLEVEL%
if !PORT3000! equ 0 (
    if !PORT3001! equ 0 (
        if !WAIT_COUNT! lss 10 goto :wait_loop
    )
)
echo Ready after !WAIT_COUNT!s.

REM Pull changes
echo.
echo Pulling latest changes from origin...
git pull origin main
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to pull changes. Resolve conflicts and try again.
    pause
    exit /b 1
)

REM Sync dependencies (fixes prisma generate errors)
echo.
echo Syncing dependencies...
pnpm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to install dependencies.
    pause
    exit /b 1
)

REM Ensure Prisma client matches schema (with retry for Windows EPERM)
echo.
echo Generating Prisma client...
cd /d "%~dp0..\apps\backend"
set /a GEN_ATTEMPT=0
:gen_loop
set /a GEN_ATTEMPT+=1
pnpm exec prisma generate
if %ERRORLEVEL% equ 0 goto :gen_success
if !GEN_ATTEMPT! geq 5 (
    echo ERROR: prisma generate failed after !GEN_ATTEMPT! attempts.
    echo Check apps\backend\prisma\schema.prisma for errors.
    pause
    exit /b 1
)
echo prisma generate failed (attempt !GEN_ATTEMPT!/5), retrying in 3s...
timeout /t 3 /nobreak >nul
goto :gen_loop
:gen_success
echo Prisma client generated successfully.

REM Apply any new migrations without erasing data
echo.
echo Applying database migrations...
pnpm run db:migrate
if %ERRORLEVEL% neq 0 (
    echo WARNING: Migration encountered issues. Your data is safe.
    echo Review the error above. If needed, run 'pnpm db:migrate' manually.
)

echo.
echo Update complete.

:start_servers
echo.
echo Starting servers...
call "%~dp0start.bat"

echo.
echo Done.
echo   Backend:  http://localhost:3001
echo   Frontend: http://localhost:3000
echo.
pause
exit /b 0
