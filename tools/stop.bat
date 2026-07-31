@echo off
REM ============================================================
REM  IQ Academy - Stop All Servers
REM  Double-click this file to shut down the system.
REM ============================================================
title IQ Academy - Stop
cd /d "%~dp0\.."

powershell -NoLogo -NoProfile -ExecutionPolicy Bypass -Command ^
  "Write-Host ''; Write-Host '  IQ Academy - Stopping servers...' -ForegroundColor Cyan; Write-Host ''; $stopped = 0; foreach ($p in @(3000,3001)) { $c = Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue; if ($c) { foreach ($conn in $c) { try { Stop-Process -Id $conn.OwningProcess -Force -ErrorAction SilentlyContinue; Write-Host ('  [OK]  Stopped process on port ' + $p) -ForegroundColor Green; $stopped++ } catch {} } } else { Write-Host ('  [--]  Nothing running on port ' + $p) -ForegroundColor DarkGray } }; Write-Host ''; if ($stopped -gt 0) { Write-Host ('  Stopped ' + $stopped + ' process(es).') -ForegroundColor Green } else { Write-Host '  No servers were running.' -ForegroundColor DarkGray }; Write-Host ''; Write-Host '  IQ Academy has been stopped.' -ForegroundColor Yellow; Write-Host ''"

timeout /t 3 >nul
