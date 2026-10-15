@echo off
pwsh.exe -NoProfile -File "%~dp0tools\start-local.ps1" %*
if errorlevel 1 (
  pause
  exit /b 1
)
