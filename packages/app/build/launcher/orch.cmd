@echo off
setlocal
rem INS-02/INS-03: this file is in <install dir>\bin and in <install dir>\resources\bin.
if exist "%~dp0..\orch.exe" (set "APPDIR=%~dp0..") else (set "APPDIR=%~dp0..\..")
set "ELECTRON_RUN_AS_NODE=1"
"%APPDIR%\orch.exe" "%APPDIR%\resources\app.asar\dist\orch.js" %*
exit /b %ERRORLEVEL%
