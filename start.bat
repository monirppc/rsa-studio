@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org ^(LTS version^), then run this file again.
  pause
  exit /b
)
if not exist .env (
  copy .env.example .env >nul
  echo A .env file was created. Opening it now: paste your GEMINI_API_KEY, save, close Notepad.
  notepad .env
)
node server.js
pause
