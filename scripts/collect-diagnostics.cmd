@echo off
setlocal
cd /d "%~dp0"
title QuickDesk Diagnostics Collector
echo ============================================================
echo  QuickDesk diagnostics collector
echo  Collects DSH / QuickDesk logs and environment into a zip.
echo  It does NOT change DSH or QuickDesk settings.
echo ============================================================
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0collect-diagnostics.ps1" %*
set "QD_EXIT=%ERRORLEVEL%"
echo.
echo Collector finished with exit code %QD_EXIT%.
echo If a report zip path was printed above, send that zip to the developer.
echo.
pause
