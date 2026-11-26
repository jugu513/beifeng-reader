@echo off
chcp 65001 >nul
title 北风 · 校验文件完整性
cd /d "%~dp0"
rem 官方指纹（与 README 中的 md5 一致），程序更新后需同步更新。
set EXPECT=3bb0502f5280f4aefe2b7f74f8022a6a
set BAD=0
call :check "北风V0.0.1-alpha.html"
call :check "index.html"
if "%BAD%"=="1" goto fail
echo.
echo [OK] 文件与官方指纹一致，下载完整。
pause
exit /b 0

:check
if not exist %1 (
  echo [X] 缺少文件：%~1
  set BAD=1
  exit /b 0
)
set H=
for /f "usebackq delims=" %%H in (`powershell -NoProfile -Command "(Get-FileHash -Algorithm MD5 -Path %1).Hash"`) do set H=%%H
if /i "%H%"=="%EXPECT%" (
  echo [OK] %~1
) else (
  echo [X] %~1 校验失败
  echo     期望：%EXPECT%
  echo     实际：%H%
  set BAD=1
)
exit /b 0

:fail
echo.
echo [X] 校验未通过：文件可能下载不完整或被改动。
echo     请重新下载 北风V0.0.1-alpha.html。
pause
exit /b 1
