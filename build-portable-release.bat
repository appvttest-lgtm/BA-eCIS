@echo off
setlocal
cd /d "%~dp0"

set "VERSION=1.6.8"
set "RELEASE_NAME=BarcodeAuditer-v%VERSION%-windows-x64-portable"
set "RELEASE_ROOT=release\%RELEASE_NAME%"
set "NODE_SOURCE=C:\Program Files\nodejs\node.exe"
set "VS_DEV_CMD=C:\Program Files (x86)\Microsoft Visual Studio\2022\BuildTools\Common7\Tools\VsDevCmd.bat"

echo Building Australia Post Barcode Auditer %VERSION% portable release...

if not exist "%NODE_SOURCE%" (
  echo ERROR: Node runtime was not found at %NODE_SOURCE%.
  exit /b 1
)

if not exist "%VS_DEV_CMD%" (
  echo ERROR: Visual Studio Build Tools were not found.
  exit /b 1
)

call npm.cmd ci
if errorlevel 1 exit /b 1

call npm.cmd run build
if errorlevel 1 exit /b 1

if exist "%RELEASE_ROOT%" rmdir /s /q "%RELEASE_ROOT%"
mkdir "%RELEASE_ROOT%"
mkdir "%RELEASE_ROOT%\node"

xcopy /e /i /y dist "%RELEASE_ROOT%\dist" >nul
copy /y server.mjs "%RELEASE_ROOT%\server.mjs" >nul
copy /y README.md "%RELEASE_ROOT%\README.md" >nul
copy /y README_LOCAL_SETUP.txt "%RELEASE_ROOT%\README_LOCAL_SETUP.txt" >nul
copy /y "%NODE_SOURCE%" "%RELEASE_ROOT%\node\node.exe" >nul

call "%VS_DEV_CMD%" -arch=x64 -host_arch=x64 >nul
cl /nologo /EHsc /O2 /MT /DUNICODE /D_UNICODE wrapper\windows\BarcodeAuditerLauncher.cpp /link /SUBSYSTEM:WINDOWS shell32.lib user32.lib /OUT:"%RELEASE_ROOT%\BarcodeAuditer.exe"
if errorlevel 1 exit /b 1

powershell -NoProfile -ExecutionPolicy Bypass -Command "Compress-Archive -LiteralPath '%RELEASE_ROOT%' -DestinationPath 'release\%RELEASE_NAME%.zip' -Force"
if errorlevel 1 exit /b 1

powershell -NoProfile -ExecutionPolicy Bypass -Command "$hash = Get-FileHash -Algorithm SHA256 'release\%RELEASE_NAME%.zip'; \"$($hash.Hash)  %RELEASE_NAME%.zip\" | Set-Content -Encoding ASCII 'release\%RELEASE_NAME%.zip.sha256'"
if errorlevel 1 exit /b 1

echo Portable release created:
echo release\%RELEASE_NAME%.zip
echo release\%RELEASE_NAME%.zip.sha256
endlocal
