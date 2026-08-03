@echo off
REM ============================================================
REM  IQ Academy - Stop All Servers
REM  Delegate to tools\stop.bat (the launcher lives in tools\).
REM ============================================================
cd /d "%~dp0"
call tools\stop.bat %*