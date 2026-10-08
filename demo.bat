@echo off
chcp 65001 >nul
cd /d "%~dp0"
set PORT=7778
node server.js --demo
if errorlevel 1 pause
