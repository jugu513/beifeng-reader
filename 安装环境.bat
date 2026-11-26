@echo off
chcp 65001 >nul
title 北风 · 安装运行环境（Python）
cd /d "%~dp0"
echo 北风的启动脚本用 Python 开一个本机服务，让书和笔记能正常存进浏览器。
echo Python 只需要装一次，装好后双击「启动北风.bat」即可。
echo.
where winget >nul 2>nul
if not errorlevel 1 goto winget
goto manual

:winget
echo [*] 检测到 winget，正在安装 Python 3.12 ...
winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
if not errorlevel 1 goto done
echo [!] 自动安装未成功，转手动安装。
goto manual

:done
echo [OK] 安装完成。请重新双击「启动北风.bat」。
pause
exit /b 0

:manual
echo [!] 请手动安装（一次即可）：
echo     1. 浏览器已打开官方下载页，下载 Python 3.x 安装包
echo     2. 安装时务必勾选 "Add Python to PATH"
echo     3. 装完重新双击「启动北风.bat」
start "" "https://www.python.org/downloads/"
pause
exit /b 1
