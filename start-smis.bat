@echo off
title SMIS - School Management Information System
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Download version 22 or newer from https://nodejs.org and run this file again.
  pause
  exit /b 1
)
echo Starting SMIS... keep this window open while the school is using the system.
start "" cmd /c "timeout /t 2 >nul & start http://localhost:3000"
node server\server.js
pause
