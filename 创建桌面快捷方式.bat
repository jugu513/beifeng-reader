@echo off
chcp 65001 >nul
title 北风 · 创建桌面快捷方式
cd /d "%~dp0"
rem 为绿色版用户补一个带图标的桌面快捷方式（安装版装完自带，无需运行本脚本）。
rem 快捷方式指向「启动北风.bat」——走本地服务模式，书和笔记才存得住。

powershell -NoProfile -Command ^
  "$d=[Environment]::GetFolderPath('Desktop'); " ^
  "$w=New-Object -ComObject WScript.Shell; " ^
  "$s=$w.CreateShortcut((Join-Path $d '北风.lnk')); " ^
  "$s.TargetPath='%~dp0启动北风.bat'; " ^
  "$s.WorkingDirectory='%~dp0'; " ^
  "$s.IconLocation='%~dp0北风.ico,0'; " ^
  "$s.Description='北风 · 离线阅读器'; " ^
  "$s.Save()"
if errorlevel 1 (
  echo [X] 创建失败。
  pause
  exit /b 1
)
echo [OK] 桌面快捷方式「北风」已创建，图标在旁边，双击即用。
pause
exit /b 0
