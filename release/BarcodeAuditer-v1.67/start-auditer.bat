@echo off
setlocal
cd /d "%~dp0"

set APP_URL=http://127.0.0.1:3000
set HEALTH_URL=http://127.0.0.1:3000/healthz

echo ===============================================
echo Australia Post - eCommerce Integration Label Auditor v1.6.6
echo ===============================================
echo This app runs locally at %APP_URL%
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo ERROR: Node.js was not found on this computer.
  echo Please install Node.js LTS from the company portal for the current Windows user.
  echo No administrator rights are required for a per-user install.
  pause
  exit /b 1
)

if not exist "dist\index.html" (
  echo ERROR: The prebuilt web app was not found at dist\index.html.
  echo Please re-extract the ZIP to a normal folder and try again.
  pause
  exit /b 1
)

echo Checking whether the local server is already running...
powershell -NoProfile -ExecutionPolicy Bypass -Command "try { $r = Invoke-WebRequest -Uri '%HEALTH_URL%' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -ge 200) { exit 0 } else { exit 1 } } catch { exit 1 }"
if not errorlevel 1 (
  echo Local server is already running. Opening browser...
  start "" "%APP_URL%"
  exit /b 0
)

echo Starting local server in a separate window...
start "Australia Post - eCommerce Integration Label Auditor Server" /min "%~dp0run-server.bat"

echo Waiting for the local server to become ready...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$deadline = (Get-Date).AddSeconds(20); do { try { $r = Invoke-WebRequest -Uri '%HEALTH_URL%' -UseBasicParsing -TimeoutSec 1; if ($r.StatusCode -ge 200) { exit 0 } } catch { Start-Sleep -Milliseconds 500 } } while ((Get-Date) -lt $deadline); exit 1"
if errorlevel 1 (
  echo WARNING: The browser did not open because the local server did not respond within 20 seconds.
  echo A server window may still be starting. Leave it open and browse to:
  echo %APP_URL%
  echo.
  echo If this repeats, check that port 3000 is not already being used by another app.
  pause
  exit /b 1
)

echo Local server is ready. Opening browser...
start "" "%APP_URL%"
exit /b 0
