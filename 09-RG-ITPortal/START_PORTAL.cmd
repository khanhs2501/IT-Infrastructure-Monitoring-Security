@echo off
setlocal enableextensions
cd /d "%~dp0"
title ROYALGROUP IT Portal v1.8.2

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js chua duoc cai hoac chua nam trong PATH.
  echo         Cai Node.js 22 LTS x64 roi chay lai file nay.
  pause
  exit /b 1
)
for /f %%V in ('node -p "Number(process.versions.node.split('.')[0])"') do set NODE_MAJOR=%%V
if %NODE_MAJOR% LSS 20 (
  echo [ERROR] Can Node.js 20 tro len ^(khuyen nghi Node.js 22 LTS x64^).
  pause
  exit /b 1
)

if not exist ".env" (
  echo [ERROR] Thieu file .env ^(cau hinh ket noi^). Sao chep tu .env.example roi dien thong tin.
  pause
  exit /b 1
)

node -e "require('dotenv');require('express');require('express-session');require('sqlite3');require('ssh2')" >nul 2>&1
if errorlevel 1 (
  echo [INFO] Thieu hoac loi thu vien npm. Dang cai tu package-lock.json ...
  call npm ci --no-audit --no-fund
  if errorlevel 1 (
    echo [ERROR] npm ci that bai. Kiem tra Internet va phien ban Node.js.
    pause
    exit /b 1
  )
)

echo [INFO] Kiem tra cau hinh .env ...
call npm run --silent check:env
if errorlevel 1 (
  echo [ERROR] .env khong hop le. Sua .env roi chay lai.
  pause
  exit /b 1
)

if /I "%~1"=="test" (
  echo [INFO] Chay bo test tu dong ...
  call npm test
  if errorlevel 1 (
    echo [ERROR] Test that bai - xem dong loi o tren.
    pause
    exit /b 1
  )
)

for /f %%P in ('node -p "require('dotenv').config({quiet:true});process.env.PORT||80"') do set APP_PORT=%%P

sc query "royalgroupitportal.exe" 2>nul | find "RUNNING" >nul
if not errorlevel 1 (
  echo [WARN] Windows Service "RoyalGroup IT Portal" dang chay. Neu cung cong %APP_PORT% se bi trung cong.
  echo        Dung service truoc ^(services.msc^) hoac dat PORT khac trong .env.
)

echo [INFO] Dang khoi dong Portal. Giu cua so nay mo; Ctrl+C de dung.
echo [INFO] Mo http://localhost:%APP_PORT%
start "" "http://localhost:%APP_PORT%"
call npm start
if errorlevel 1 echo [ERROR] Portal thoat voi loi. Doc cac dong tren de biet nguyen nhan.
pause
