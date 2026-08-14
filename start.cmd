@echo off
rem Bring up the local stack: database, dev server, closing worker.
rem The database keeps its data in the postgres-data volume, so migrations
rem and seeding are one-time - see docs/running-locally.md for a cold start.

setlocal
cd /d "%~dp0"

netstat -ano | findstr "LISTENING" | findstr ":3000 " >nul
if not errorlevel 1 (
  echo Port 3000 is already in use.
  echo Next would silently bind 3001 instead, so stop that process first.
  exit /b 1
)

echo [1/4] Starting PostgreSQL...
docker compose up -d
if errorlevel 1 (
  echo Could not reach Docker. Is Docker Desktop running?
  exit /b 1
)

echo [2/4] Waiting for the database to accept connections...
set /a tries=0
:waitdb
docker compose exec -T postgres pg_isready -U auctionhouse -d auctionhouse >nul 2>&1
if not errorlevel 1 goto dbready
set /a tries+=1
if %tries% geq 60 (
  echo Database did not accept connections within 60s.
  exit /b 1
)
ping -n 2 127.0.0.1 >nul
goto waitdb
:dbready

echo [3/4] Starting the dev server...
start "auction dev" cmd /k npm run dev

set /a tries=0
:waitweb
curl -s -o nul http://localhost:3000/api/time
if not errorlevel 1 goto webready
set /a tries+=1
if %tries% geq 90 (
  echo Dev server did not answer within 90s. Check the "auction dev" window.
  exit /b 1
)
ping -n 2 127.0.0.1 >nul
goto waitweb
:webready

rem The worker polls the app, so it only starts once the app answers -
rem otherwise its first ticks are just connection errors.
echo [4/4] Starting the closing worker...
start "auction worker" cmd /k npm run worker

echo.
echo Ready: http://localhost:3000
echo Close the "auction dev" and "auction worker" windows to stop them.
echo The database keeps running; "docker compose down" stops it.

start "" http://localhost:3000/
