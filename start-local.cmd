@echo off
setlocal EnableExtensions
title Ziyunhu Shop - Local Server

set "PROJECT_ROOT=%~dp0"
set "SERVER_DIR=%~dp0server"
set "STORE_DIR=%~dp0.pnpm-store"
set "NODE_EXE="

if not exist "%SERVER_DIR%\package.json" (
  echo [ERROR] Cannot find server\package.json next to this launcher.
  goto :failed
)

rem Prefer the runtime shipped with the project because it matches native modules.
if exist "%SERVER_DIR%\.runtime\node.exe" (
  "%SERVER_DIR%\.runtime\node.exe" -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]===22&&v[1]>=22?0:1)" >nul 2>&1
  if not errorlevel 1 set "NODE_EXE=%SERVER_DIR%\.runtime\node.exe"
)

rem Fall back to a Node.js 22.22+ installation on PATH.
if defined NODE_EXE goto :node_ready
for /f "delims=" %%I in ('where node.exe 2^>nul') do if not defined NODE_EXE set "NODE_EXE=%%I"
if not defined NODE_EXE goto :node_ready
"%NODE_EXE%" -e "const v=process.versions.node.split('.').map(Number);process.exit(v[0]===22&&v[1]>=22?0:1)" >nul 2>&1
if errorlevel 1 set "NODE_EXE="

:node_ready

if not defined NODE_EXE (
  echo [ERROR] Node.js 22.22 or newer in the 22.x release line is required.
  echo Install Node.js 22.22.x, reopen this file, and try again.
  goto :failed
)

for %%I in ("%NODE_EXE%") do set "NODE_DIR=%%~dpI"
set "PATH=%NODE_DIR%;%PATH%"

cd /d "%SERVER_DIR%"
call :check_dependencies
if not errorlevel 1 goto :ready

if /i "%~1"=="--check" (
  echo [ERROR] Dependencies are missing, broken, or linked to another folder.
  exit /b 10
)

echo [INFO] Dependencies need repair. This can take a few minutes...
call :repair_dependencies
if errorlevel 1 goto :failed

call :check_dependencies
if errorlevel 1 (
  echo [ERROR] Dependency repair finished, but validation still failed.
  goto :failed
)

:ready
if /i "%~1"=="--check" (
  echo [OK] Node.js and dependencies are ready.
  exit /b 0
)

echo [OK] Dependencies are ready.
echo [INFO] Storefront: http://localhost:3000/
echo [INFO] Admin:      http://localhost:3000/admin
echo [INFO] Keep this window open. Press Ctrl+C to stop the server.
echo.
"%NODE_EXE%" server.js
if errorlevel 1 goto :failed
exit /b 0

:check_dependencies
"%NODE_EXE%" -e "const fs=require('fs'),path=require('path');const base=(path.resolve('node_modules')+path.sep).toLowerCase();for(const name of ['dotenv','better-sqlite3']){const resolved=fs.realpathSync(require.resolve(name)).toLowerCase();if(!resolved.startsWith(base))process.exit(2)}const Database=require('better-sqlite3');const db=new Database(':memory:');db.close()" >nul 2>&1
exit /b %errorlevel%

:repair_dependencies
set "CI=true"
set "COREPACK_CMD="
for /f "delims=" %%I in ('where corepack.cmd 2^>nul') do if not defined COREPACK_CMD set "COREPACK_CMD=%%I"

if defined COREPACK_CMD goto :repair_with_corepack

where pnpm.cmd >nul 2>&1
if not errorlevel 1 goto :repair_with_pnpm

echo [ERROR] Cannot find corepack.cmd or pnpm.cmd.
echo Reinstall Node.js 22.22.x with npm and Corepack included.
exit /b 11

:repair_with_corepack
call "%COREPACK_CMD%" pnpm install --force --frozen-lockfile --store-dir "%STORE_DIR%"
exit /b %errorlevel%

:repair_with_pnpm
call pnpm.cmd install --force --frozen-lockfile --store-dir "%STORE_DIR%"
exit /b %errorlevel%

:failed
if /i "%~1"=="--check" exit /b 1
echo.
echo Startup failed. Review the message above, then press any key to close.
pause >nul
exit /b 1
