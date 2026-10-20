@echo off
setlocal
title R6 StratShare - Local
cd /d "%~dp0"
set NODE_OPTIONS=
set NODE_PATH=
set NODE_ENV=production
if not exist "runtime\node.exe" goto missing
"%~dp0runtime\node.exe" "%~dp0scripts\portable-start.mjs"
if errorlevel 1 pause
exit /b
:missing
echo Extract the entire ZIP first, then run START.cmd from the extracted folder.
pause
exit /b 1
