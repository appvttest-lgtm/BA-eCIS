@echo off
setlocal
cd /d "%~dp0"

set APP_URL=http://127.0.0.1:3000
set HEALTH_URL=http://127.0.0.1:3000/healthz

echo ===============================================
echo Australia Post - eCommerce Integration Label Auditor
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

rem Health checks use curl.exe (shipped with Windows 10 1803+) so the
rem end-user launcher never needs PowerShell or an ExecutionPolicy bypass.
where curl >nul 2>nul
if errorlevel 1 set NO_CURL=1

if defined NO_CURL goto start_server
echo Checking whether the local server is already running...
curl -s -f --max-time 1 -o nul "%HEALTH_URL%" >nul 2>nul
if not errorlevel 1 (
  echo Local server is already running. Opening browser...
  start "" "%APP_URL%"
  exit /b 0
)

:start_server
echo Starting local server in a separate window...
start "Australia Post - eCommerce Integration Label Auditor Server" /min "%~dp0run-server.bat"

if defined NO_CURL (
  echo Waiting briefly for the local server to start...
  timeout /t 5 /nobreak >nul
  goto open_browser
)

echo Waiting for the local server to become ready...
set /a HEALTH_TRIES=0
:wait_loop
curl -s -f --max-time 1 -o nul "%HEALTH_URL%" >nul 2>nul
if not errorlevel 1 goto open_browser
set /a HEALTH_TRIES+=1
if %HEALTH_TRIES% geq 20 (
  echo WARNING: The browser did not open because the local server did not respond within 20 seconds.
  echo A server window may still be starting. Leave it open and browse to:
  echo %APP_URL%
  echo.
  echo If this repeats, check that port 3000 is not already being used by another app.
  pause
  exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_loop

:open_browser
echo Local server is ready. Opening browser...
start "" "%APP_URL%"
exit /b 0
