@echo off
REM ============================================================
REM  IQ Academy - Update Script
REM  Checks for new commits, stops servers, pulls, restarts.
REM ============================================================
title IQ Academy - Update
cd /d "%~dp0\.."

setlocal enabledelayedexpansion

echo.
echo ==========================================
echo   IQ Academy - Update Script
echo ==========================================
echo.

REM Check if git is available
where git >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Git is not available in PATH.
    pause
    exit /b 1
)

REM Check if we are in a git repository
if not exist ".git" (
    echo ERROR: Not a git repository. Run this from the project root.
    pause
    exit /b 1
)

REM Fetch the latest changes from origin
echo Fetching latest changes from origin...
git fetch origin
if %ERRORLEVEL% neq 0 (
    echo ERROR: Failed to fetch from origin.
    pause
    exit /b 1
)

REM Check if we are behind the remote
git rev-parse --is-inside-work-tree >nul 2>&1
for /f "delims=" %%i in ('git rev-list HEAD..origin/main --count 2^>nul') do set BEHIND=%%i
for /f "delims=" %%i in ('git rev-list origin/main..HEAD --count 2^>nul') do set AHEAD=%%i

echo.
echo Local commits ahead of remote: %AHEAD%
echo Remote commits ahead of local: %BEHIND%

REM If no changes, skip update
if "%BEHIND%"=="0" (
    echo.
    echo Already on the latest version. No update needed.
    goto :check_servers
)

echo.
echo Found %BEHIND% new commit(s). Proceeding with update...

REM Stop servers if they are running
echo.
echo Stopping servers...

REM Stop by using the stop.bat script
call "%~dp0stop.bat"

REM Wait a moment for ports to be released
timeout /t 2 /nobreak >nul

REM Pull latest changes
echo.
echo Pulling latest changes from origin...
git pull origin main

echo.
echo Update complete.

:check_servers
echo.
echo Starting servers...

REM Start using the start.bat script
call "%~dp0start.bat"

echo.
echo Done.
echo   Backend:  http://localhost:3001
echo   Frontend: http://localhost:3000
echo.
pause
exit /b 0
