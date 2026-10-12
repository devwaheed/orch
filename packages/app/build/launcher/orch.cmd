@echo off
setlocal
set "RESOURCES=%~dp0.."
set "APPDIR=%RESOURCES%\.."
set "ELECTRON_RUN_AS_NODE=1"
"%APPDIR%\orch.exe" "%RESOURCES%\app.asar\dist\orch.js" %*
exit /b %ERRORLEVEL%
