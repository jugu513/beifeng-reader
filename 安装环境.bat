@echo off
chcp 65001 >nul
title 北风 · 安装运行环境
cd /d "%~dp0"
rem 北风的启动脚本用 Python/Node 开一个本机服务，让书和笔记能正常存进浏览器。
rem 用法：安装环境.bat [py|node] 直选（启动器 Y 分支传 py）；不带参数进菜单。
rem 刻意不用 setlocal：装完刷新的 PATH 要能传回调用它的启动器，setlocal 会把它关在本文件里。
rem 复验纪律：winget 退出码 0 不算数——装完必须真探测到才算成（防 PATH 没刷新、商店占位）。

if /i "%~1"=="py" goto do_py
if /i "%~1"=="node" goto do_node

echo 北风的启动脚本会自动选择本机已有的运行环境，缺哪个装哪个。
echo.
echo  [1] 安装 Python（推荐，约 30 MB）
echo  [2] 安装 Node.js
echo  [0] 退出
set "CH="
set /p "CH=选择: "
if "%CH%"=="1" goto do_py
if "%CH%"=="2" goto do_node
exit /b 0

:do_py
py -3 -c "import sys;sys.stdout.write('bfprobe')" 2>nul | findstr /c:"bfprobe" >nul && goto have_py
python -c "import sys;sys.stdout.write('bfprobe')" 2>nul | findstr /c:"bfprobe" >nul && goto have_py
where winget >nul 2>nul
if errorlevel 1 goto py_manual
echo [*] 正在用 winget 安装 Python 3.12（一两分钟，装完自动验证）...
winget install -e --id Python.Python.3.12 --accept-source-agreements --accept-package-agreements
call :refresh_path
py -3 -c "import sys;sys.stdout.write('bfprobe')" 2>nul | findstr /c:"bfprobe" >nul && goto ok_py
python -c "import sys;sys.stdout.write('bfprobe')" 2>nul | findstr /c:"bfprobe" >nul && goto ok_py
goto py_manual

:py_manual
echo [!] 自动安装没成功（本机没有 winget，或装完仍未就绪）。
echo     手动装一次即可：1^) 下载 Python 3.x 安装包  2^) 安装时务必勾选 "Add Python to PATH"  3^) 重新双击「启动北风.bat」
start "" "https://www.python.org/downloads/"
if not "%~1"=="" exit /b 1
pause
exit /b 1

:have_py
echo [OK] 本机已装好 Python，无需重复安装。
if not "%~1"=="" exit /b 0
pause
exit /b 0

:ok_py
echo [OK] Python 安装完成并已验证就绪。
if not "%~1"=="" exit /b 0
echo 请重新双击「启动北风.bat」。
pause
exit /b 0

:do_node
node -e "process.stdout.write('bfprobe')" 2>nul | findstr /c:"bfprobe" >nul && goto have_node
where winget >nul 2>nul
if errorlevel 1 goto node_manual
echo [*] 正在用 winget 安装 Node.js LTS（一两分钟，装完自动验证）...
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
call :refresh_path
node -e "process.stdout.write('bfprobe')" 2>nul | findstr /c:"bfprobe" >nul && goto ok_node
goto node_manual

:node_manual
echo [!] 自动安装没成功。手动装一次：下载 Node.js LTS，保持默认选项安装，
echo     装完重新双击「启动北风.bat」。
start "" "https://nodejs.org/"
if not "%~1"=="" exit /b 1
pause
exit /b 1

:have_node
echo [OK] 本机已装好 Node.js，无需重复安装。
if not "%~1"=="" exit /b 0
pause
exit /b 0

:ok_node
echo [OK] Node.js 安装完成并已验证就绪。
if not "%~1"=="" exit /b 0
echo 请重新双击「启动北风.bat」。
pause
exit /b 0

:refresh_path
rem 刷新本会话 PATH：winget 装完不会给当前窗口发新 PATH，不刷新就会"装好了却探不到"。
rem 机器 PATH + 用户 PATH 合起来就是新进程会拿到的那份。
set "MPATH="
set "UPATH="
for /f "usebackq tokens=2*" %%A in (`reg query "HKLM\SYSTEM\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul ^| findstr /i /c:"Path"`) do set "MPATH=%%B"
for /f "usebackq tokens=2*" %%A in (`reg query "HKCU\Environment" /v Path 2^>nul ^| findstr /i /c:"Path"`) do set "UPATH=%%B"
if defined MPATH set "PATH=%MPATH%"
if defined UPATH set "PATH=%PATH%;%UPATH%"
exit /b 0
