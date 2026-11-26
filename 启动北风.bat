@echo off
chcp 65001 >nul
title 北风 · 本地启动
cd /d "%~dp0"
setlocal
rem 北风启动器：用 Python 起一个本机服务再打开浏览器。
rem 为什么要服务：直接双击 HTML 属于 file:// 方式，浏览器会禁用本地数据库，书和笔记存不住。

set "PY="
where py >nul 2>nul
if not errorlevel 1 set "PY=py -3"
if defined PY goto havepy
where python >nul 2>nul
if not errorlevel 1 set "PY=python"
if defined PY goto havepy

echo [X] 没有检测到 Python。
echo     请先双击本文件夹里的「安装环境.bat」，装完再回来双击本文件。
pause
exit /b 1

:havepy
echo [*] 正在启动本地服务：http://127.0.0.1:8791
start "北风·本地服务" %PY% -m http.server 8791 --bind 127.0.0.1
timeout /t 1 /nobreak >nul
start "" "http://127.0.0.1:8791"
echo [OK] 已在浏览器打开北风。关闭「北风·本地服务」窗口即停止服务。
timeout /t 3 >nul
exit /b 0
