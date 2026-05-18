@echo off
cd /d "%~dp0"
echo This optional developer command installs npm packages and rebuilds the frontend.
echo Normal users should run start-auditer.bat instead.
echo.
call npm install
if errorlevel 1 pause & exit /b 1
call npm run build
if errorlevel 1 pause & exit /b 1
echo Build complete.
pause
