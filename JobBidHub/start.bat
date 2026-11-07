@echo off
rem JobBid Hub: installs what is missing (first run only), builds the dashboard, starts the server
rem and opens http://localhost:4417 in your browser. Close this window to stop the hub.
title JobBid Hub
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install it from https://nodejs.org ^(version 22 or newer^), then run this again.
  pause
  exit /b 1
)

rem Open the dashboard in Google Chrome (where JobBid is installed) once the server has had a moment to start.
rem Windows' default browser is not used: on some PCs no program is set for web links ("Application not found").
set "HUB_URL=http://localhost:4417"
set "CHROME="
for %%P in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe") do (
  if not defined CHROME if exist %%P set "CHROME=%%~P"
)

rem Already running in the background (service\install-service.ps1): just open the dashboard.
powershell -NoProfile -Command "try { Invoke-WebRequest -UseBasicParsing http://127.0.0.1:4417/api/health -TimeoutSec 2 | Out-Null; exit 0 } catch { exit 1 }" >nul 2>nul
if not errorlevel 1 (
  echo JobBid Hub is already running in the background. Opening the dashboard...
  if defined CHROME ( start "" "%CHROME%" %HUB_URL% ) else ( start "" %HUB_URL% )
  timeout /t 3 /nobreak >nul
  exit /b 0
)

if not exist "server\node_modules" (
  echo Installing the server ^(first run only^)...
  pushd server
  call npm install --no-audit --no-fund
  if errorlevel 1 ( popd & echo Server install failed. & pause & exit /b 1 )
  popd
)

if not exist "web\dist\index.html" (
  echo Building the dashboard ^(first run only, about a minute^)...
  pushd web
  if not exist "node_modules" call npm install --no-audit --no-fund
  call npm run build
  if errorlevel 1 ( popd & echo Dashboard build failed. & pause & exit /b 1 )
  popd
)

if defined CHROME (
  start "" /min cmd /c "timeout /t 3 /nobreak >nul & start "" "%CHROME%" %HUB_URL%"
) else (
  echo Google Chrome was not found. Open %HUB_URL% in the browser where JobBid is installed.
)
echo.
echo JobBid Hub: %HUB_URL%   (keep this window open; close it to stop the hub)
echo.
cd server
:run
node --disable-warning=ExperimentalWarning src/index.js
rem Exit code 3 = the hub asked to restart (e.g. office-network access was switched on or off).
if %errorlevel%==3 (
  echo Restarting JobBid Hub...
  goto run
)
pause
