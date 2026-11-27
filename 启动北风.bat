@echo off
chcp 65001 >nul
title 北风 · 本地启动
cd /d "%~dp0"
setlocal
rem 北风启动器（引擎路由器）：起一个本机服务再打开浏览器。
rem 为什么要服务：双击 HTML 属于 file:// 方式，浏览器会禁用本地数据库，书和笔记存不住。
rem 引擎路由：Python → Node → Windows 自带（PowerShell，零安装保底）。
rem   探测是"真探测"：真跑一句再认输出——Windows 商店的 python.exe 假别名
rem   存在、退出码 0、但什么都不起，只 where 一下会拿到死窗口。
rem 缺环境时先问你要不要装：Y 走 winget 装完复验，N 或装失败走自带方式。
rem 端口 8791 起顺延到 8811；引擎各开独立窗口（cmd /k），关窗即停，报错留得住。

set "SELF=%~f0"
set "NODEF=%TEMP%\bf_serve.js"
set "PSF=%TEMP%\bf_serve.ps1"
set "APP=北风V0.0.1-alpha.html"

rem ---- ① 引擎探测 ----
call :probe
if defined ENGINE goto engine_ok

rem ---- ② 都没有 → 交互式装环境 ----
echo [!] 未检测到 Python 或 Node，本地服务暂时起不来。
echo     选项一：现在自动安装 Python（推荐，走 winget，装完自动验证）
echo     选项二：不装任何东西，用 Windows 自带方式启动（能用，功能略简）
set "ANS="
set /p "ANS=现在安装 Python 吗？(Y/N): "
if /i "%ANS%"=="Y" (
  call "%~dp0安装环境.bat" py
  call :probe
)
if defined ENGINE goto engine_ok
echo [*] 将使用 Windows 自带方式（PowerShell，无需安装任何东西）。
set "ENGINE=ps"

:engine_ok
if "%ENGINE%"=="py" set "ELABEL=Python（%PYCMD%）"
if "%ENGINE%"=="node" set "ELABEL=Node.js"
if "%ENGINE%"=="ps" set "ELABEL=Windows 自带"

rem ---- ③ 选空闲端口（8791→8811，全占则退出）----
call :pick_port
if not defined PORT (
  echo [X] 8791-8811 都被占用了，关掉占端口的程序再试。
  pause
  exit /b 1
)

rem ---- ④ 按引擎启动（独立窗口，出错看得见）----
if "%ENGINE%"=="node" (
  call :extract_node
  if errorlevel 1 exit /b 1
)
if "%ENGINE%"=="ps" (
  call :extract_ps
  if errorlevel 1 exit /b 1
)
echo [*] 引擎：%ELABEL% · 端口：%PORT%
if "%ENGINE%"=="py" start "北风·本地服务" cmd /k %PYCMD% -m http.server %PORT% --bind 127.0.0.1
if "%ENGINE%"=="node" start "北风·本地服务" cmd /k node "%NODEF%" %PORT% "%~dp0%APP%"
if "%ENGINE%"=="ps" start "北风·本地服务" cmd /k powershell -NoProfile -ExecutionPolicy Bypass -File "%PSF%" %PORT% "%~dp0%APP%"

rem 等服务真起来再开浏览器（用 ping 不用 timeout：stdin 被重定向时 timeout.exe 会报错退出）
ping -n 3 127.0.0.1 >nul
powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient;try{$c.Connect('127.0.0.1',%PORT%);$c.Close();exit 0}catch{exit 1}" >nul 2>&1
if errorlevel 1 (
  echo [X] 服务没起来——看「北风·本地服务」窗口里的报错。
  echo     急用可直接双击同目录的 %APP%（file:// 方式，数据不持久）。
  pause
  exit /b 1
)
set "URL=http://127.0.0.1:%PORT%/"
if "%ENGINE%"=="py" set "URL=http://127.0.0.1:%PORT%/%APP%"
start "" "%URL%"
echo [OK] 已在浏览器打开北风。关闭「北风·本地服务」窗口即停止服务。
ping -n 3 127.0.0.1 >nul
exit /b 0

rem ══════════ 子过程 ══════════

:probe
set "ENGINE="
set "PYCMD="
py -3 -c "import sys;sys.stdout.write('bfprobe')" 2>nul | findstr /c:"bfprobe" >nul && set "PYCMD=py -3"
if defined PYCMD set "ENGINE=py"
if defined ENGINE exit /b 0
python -c "import sys;sys.stdout.write('bfprobe')" 2>nul | findstr /c:"bfprobe" >nul && set "PYCMD=python"
if defined PYCMD set "ENGINE=py"
if defined ENGINE exit /b 0
node -e "process.stdout.write('bfprobe')" 2>nul | findstr /c:"bfprobe" >nul && set "ENGINE=node"
exit /b 0

:port_free
powershell -NoProfile -Command "$c=New-Object Net.Sockets.TcpClient;try{$c.Connect('127.0.0.1',%1);$c.Close();exit 1}catch{exit 0}" >nul 2>&1
if not errorlevel 1 set "PORT=%1"
exit /b 0

:pick_port
set "PORT="
for /l %%p in (8791,1,8811) do if not defined PORT call :port_free %%p
exit /b 0

:extract_node
rem Node 引擎夹在两个标记之间，用 PowerShell 切片（Windows 自带；-Command 不受执行策略限制）。
rem 路径一律从环境变量取，不拼进命令串：拼进去时空格、&、单引号都会改写这条命令。
powershell -NoProfile -Command "$s=[Environment]::GetEnvironmentVariable('SELF'); $o=[Environment]::GetEnvironmentVariable('NODEF'); if(-not $s -or -not $o){exit 2}; $l=[IO.File]::ReadAllLines($s, [Text.Encoding]::UTF8); $a=[array]::IndexOf($l,'::NODE_ENGINE_BELOW'); $b=[array]::IndexOf($l,'::PS_ENGINE_BELOW'); if($a -lt 0 -or $b -le $a){exit 1}; [IO.File]::WriteAllLines($o, $l[($a+1)..($b-1)])"
if errorlevel 1 (
  echo [X] 自解出 Node 引擎失败（标记切片不成功，本文件可能被改动过）。
  pause
  exit /b 1
)
if not exist "%NODEF%" (
  echo [X] 自解出 Node 引擎没落盘：%NODEF%
  pause
  exit /b 1
)
exit /b 0

:extract_ps
rem PowerShell 引擎是文件尾部整段，more +N 跳过前 N 行落盘（与产品内置启动器同款做法）。
set "PSL="
for /f "tokens=1 delims=:" %%a in ('findstr /n /b "::PS_ENGINE_BELOW" "%SELF%"') do set "PSL=%%a"
if not defined PSL (
  echo [X] 本文件损坏：找不到内嵌引擎标记。
  pause
  exit /b 1
)
more +%PSL% "%SELF%" > "%PSF%"
if not exist "%PSF%" (
  echo [X] 自解出 PowerShell 引擎没落盘：%PSF%
  pause
  exit /b 1
)
exit /b 0

::NODE_ENGINE_BELOW
/* Beifeng built-in static server (extracted by the launcher bat)
   Usage: node bf_serve.js <port> <html-file>
   Routes: / and /index.html -> the single HTML file; anything else 404.
   Binds 127.0.0.1 only. Re-reads the file per request (the file is the truth). */
'use strict';
const http = require('http');
const fs = require('fs');
const port = Number(process.argv[2]);
const file = process.argv[3];
if (!port || !file) { console.error('usage: node bf_serve.js <port> <html-file>'); process.exit(1); }
try { fs.readFileSync(file); } catch (e) { console.error('[X] cannot read ' + file + ': ' + e.message); process.exit(1); }
const server = http.createServer((req, res) => {
  const p = (req.url || '/').split('?')[0];
  if (p === '/' || p === '/index.html') {
    try {
      const b = fs.readFileSync(file);
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': b.length });
      res.end(b);
    } catch (e) { res.writeHead(500); res.end(String(e.message)); }
  } else { res.writeHead(404); res.end('404'); }
});
server.on('error', (e) => { console.error('[X] server failed: ' + e.message); process.exit(1); });
server.listen(port, '127.0.0.1', () => { console.log('Beifeng (node) -> http://127.0.0.1:' + port + '/'); });
::PS_ENGINE_BELOW
# Beifeng built-in static server (extracted by the launcher bat)
# Usage: powershell -File bf_serve.ps1 <port> <html-file>
# Serves the single HTML file at / and /index.html; anything else 404.
# Binds localhost only. If binding fails, opens the file directly (degraded mode).
param([int]$Port, [string]$File)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $File)) { Write-Host "[X] file not found: $File"; exit 1 }
$l = New-Object Net.HttpListener
$l.Prefixes.Add("http://localhost:$Port/")
$l.Prefixes.Add("http://127.0.0.1:$Port/")
try { $l.Start() } catch {
  Write-Host "[X] cannot listen on port ${Port}: $_"
  Write-Host "    degraded mode: open the file directly (books/notes will NOT persist):"
  Write-Host "    $File"
  Start-Process -FilePath $File
  exit 1
}
$bytes = [IO.File]::ReadAllBytes($File)
Write-Host "Beifeng (windows built-in) -> http://127.0.0.1:$Port/"
while ($true) {
  $ctx = $l.GetContext()
  $p = $ctx.Request.Url.AbsolutePath
  if ($p -eq '/' -or $p -eq '/index.html') {
    $r = $ctx.Response
    $r.StatusCode = 200
    $r.ContentType = 'text/html; charset=utf-8'
    $r.Headers.Add('Cache-Control', 'no-store')
    $r.ContentLength64 = $bytes.Length
    $r.OutputStream.Write($bytes, 0, $bytes.Length)
    $r.OutputStream.Close()
  } else {
    $ctx.Response.StatusCode = 404
    $ctx.Response.Close()
  }
}
