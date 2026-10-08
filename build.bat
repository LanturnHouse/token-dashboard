@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0build\build.ps1"
if errorlevel 1 (
  echo.
  echo 빌드에 실패했습니다. 위 오류 메시지를 확인하세요.
  pause
  exit /b 1
)
echo.
echo 빌드 완료: dist\token-dashboard.exe
