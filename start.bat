@echo off
chcp 65001 >nul
cd /d "%~dp0"
node server.js
if errorlevel 1 pause
