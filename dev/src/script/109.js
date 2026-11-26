/* ================= 北风工程模式（终端 beifeng666） =================
   输入 beifeng666 进入工程模式：自动导出配套启动器 beifeng-tools.bat，
   提示符切到 C:\beifeng\ops，解锁 ops 命令（bat / ping / off）。
   bat 的职责：在本机起「本地预览服务（现读母本，8791）」与「本机转发器（8792）」。
   bat 自包含：不依赖 tool 目录或任何外部脚本，两个引擎都内嵌在 bat 尾部自解出——
   有 Node → 内嵌 Node 引擎（serve：现读母本、pre/ 白名单；
             proxy：本机转发器的正主逻辑）；
   无 Node → Python 兜底引擎（stdlib only，行为同上）。
   bat 只带运行所需的两份引擎，测试工具不进来。
   bat 全文由母本生成（batSource）：端口、路径约定只在这里写一份。
   bat 用 CRLF + UTF-8（先 chcp 65001）。 */
BF.ops = {
  active: false,
  SERVE_PORT: 8791,
  PROXY_PORT: 8792,
  exportBat: function () {
    try {
      BF.exportBlob('beifeng-tools.bat', BF.ops.batSource(), { mime: 'application/octet-stream' });
      return '已导出 beifeng-tools.bat（默认进下载目录）';
    } catch (e) { BF.err.report('ops.exportBat', e); return '导出失败：' + ((e && e.message) || e); }
  },
  batSource: function () {
    return String.raw`@echo off
rem ============================================================
rem 北风 - 本地工具启动器（由北风终端 beifeng666 命令导出）
rem 自包含：不依赖任何外部脚本，引擎内嵌在本文件尾部。
rem   有 Node → 自解出内嵌 Node 引擎（预览=现读母本；转发器=正主逻辑）
rem   无 Node → 自解出 Python 兜底引擎（stdlib only）
rem 放置：任意位置双击即可；它会自动找旁边的母本，找不到会让你拖进来。
rem ============================================================
setlocal
chcp 65001 >nul
title 北风 · 本地工具启动器
set "SELF=%~f0"

rem ---- 定位母本：bat 旁边找一轮，找不到让用户拖进来 ----
set "SRC="
if exist "%~dp0work\北风V0.0.1-alpha.txt" set "SRC=%~dp0work\北风V0.0.1-alpha.txt"
if not defined SRC if exist "%~dp0北风V0.0.1-alpha.txt" set "SRC=%~dp0北风V0.0.1-alpha.txt"
if not defined SRC if exist "%~dp0work\北风V0.0.1-alpha.html" set "SRC=%~dp0work\北风V0.0.1-alpha.html"
if not defined SRC if exist "%~dp0北风V0.0.1-alpha.html" set "SRC=%~dp0北风V0.0.1-alpha.html"
if defined SRC goto src_ready
rem 第一个参数当母本路径：把母本文件直接拖到 bat 图标上（Windows 会把它作为 %1 传进来），
rem 比在控制台里等 set /p 可靠——bat 通常导到下载目录，那里永远不会「旁边就有母本」，
rem 于是这条回退提示是每个真实用户的第一道坎，不能只在键盘交互下才成立。
if not "%~1"=="" if exist "%~1" set "SRC=%~1"
if defined SRC goto src_ready
if not "%~1"=="" (
  echo [x] 传进来的路径不存在：%~1
  pause
  exit /b 1
)
echo 没在 bat 旁边找到母本（work\北风V0.0.1-alpha.txt，或同目录、或 .html 同名文件）。
echo 把母本文件拖到本 bat 图标上再运行即可，那样不用在窗口里输入路径。
set /p "SRC=或把母本路径粘进本窗口后回车："
:src_ready
if not defined SRC (
  echo [x] 没给母本路径，退出。
  pause
  exit /b 1
)
if not exist "%SRC%" (
  echo [x] 母本不存在：%SRC%
  pause
  exit /b 1
)
echo 母本： %SRC%

rem ---- 引擎探测：Node 优先，Python 兜底（两者都不装则无法运行）----
rem 探测必须真跑一句再认输出：Windows 自带的 python.exe 是商店占位别名，
rem 它存在、where 能查到、退出码还是 0，但什么都不打印也什么都不起——
rem 只 where 一下就把引擎认下来，用户会拿到一个"启动了"的死窗口。
set "NODE="
node -e "process.stdout.write('bfprobe')" 2>nul | findstr /c:"bfprobe" >nul && set "NODE=node"
set "PY="
if defined NODE goto py_done
py -3 -c "import sys;sys.stdout.write('bfprobe')" 2>nul | findstr /c:"bfprobe" >nul && set "PY=py -3"
if defined PY goto py_done
python -c "import sys;sys.stdout.write('bfprobe')" 2>nul | findstr /c:"bfprobe" >nul && set "PY=python"
:py_done
if not defined NODE if not defined PY (
  echo [x] 本机既没有 node 也没有 python，两个引擎都起不来。
  echo     任装其一： Node https://nodejs.org  或  Python https://www.python.org
  echo     只有 python 提示"从商店安装"的那种不算装：装上真正的 Python 再运行本文件。
  pause
  exit /b 1
)
if defined NODE (echo 引擎： Node（内嵌脚本自解出）) else (echo 引擎： Python 兜底 %PY%)

set "NODEF=%TEMP%\bf_node_tools.mjs"
set "PYF=%TEMP%\bf_pytools.py"
rem 自解出失败必须当场退出：call 里的 exit /b 只结子过程，落到 :menu 会继续
rem 用一个并不存在的引擎文件，用户看到的是另一个窗口里的「Cannot find module」。
if defined NODE call :extract_node
if errorlevel 1 exit /b 1
if defined PY call :extract_py
if errorlevel 1 exit /b 1

:menu
echo.
echo ====== 北风 · 本地工具（自包含版） ======
echo  [1] 全部启动：本地预览 8791 + 转发器 8792（端口被占自动顺延，看引擎窗口）
echo  [2] 仅本地预览   http://127.0.0.1:8791/
echo  [3] 仅本机转发器 http://127.0.0.1:8792/
echo  [0] 退出
set "CH="
set /p CH=选择:
if "%CH%"=="1" call :start_both
if "%CH%"=="2" call :start_serve
if "%CH%"=="3" call :start_proxy
if "%CH%"=="0" exit /b 0
goto menu

:start_serve
if defined NODE (
  start "北风预览" cmd /k node "%NODEF%" serve "%SRC%" 8791
) else (
  start "北风预览(py兜底)" cmd /k %PY% "%PYF%" serve "%SRC%" 8791
)
rem 浏览器要等引擎真起来再开：start 之后立刻开，第一屏常常是「无法访问此网站」。
rem 用 ping 不用 timeout——timeout.exe 在标准输入被重定向时会直接报错退出。
ping -n 4 127.0.0.1 >nul
start "" "http://127.0.0.1:8791/"
echo 已请求启动本地预览（窗口：北风预览），母本现读无副本。
echo 8791 被占用时引擎自动顺延端口，打不开就看引擎窗口第一行那个地址。
exit /b 0

:start_proxy
if defined NODE (
  start "北风转发器" cmd /k node "%NODEF%" proxy 8792
) else (
  start "北风转发器(py兜底)" cmd /k %PY% "%PYF%" proxy 8792
)
echo 已请求启动转发器（窗口：北风转发器）。回北风「设置 → AI 服务」填本机地址并点「探测本机转发」。
echo 8792 被占用时引擎自动顺延，填进设置里的端口以引擎窗口第一行为准。
exit /b 0

:start_both
call :start_serve
call :start_proxy
exit /b 0

:extract_node
rem Node 引擎夹在两个标记之间，用 PowerShell 切片（Windows 自带；-Command 不受执行策略限制）。
rem 路径一律从环境变量取，不拼进命令串：拼进去时空格、&、单引号都会改写这条命令
rem （用户名里带个撇号就足够让它解错文件）。
powershell -NoProfile -Command "$s=[Environment]::GetEnvironmentVariable('SELF'); $o=[Environment]::GetEnvironmentVariable('NODEF'); if(-not $s -or -not $o){exit 2}; $l=[IO.File]::ReadAllLines($s, [Text.Encoding]::UTF8); $a=[array]::IndexOf($l,'::NODE_ENGINE_BELOW'); $b=[array]::IndexOf($l,'::PY_ENGINE_BELOW'); if($a -lt 0 -or $b -le $a){exit 1}; [IO.File]::WriteAllLines($o, $l[($a+1)..($b-1)])"
if errorlevel 1 (
  echo [x] 自解出 Node 引擎失败（标记切片不成功，本文件可能被改动过）。
  pause
  exit /b 1
)
if not exist "%NODEF%" (
  echo [x] 自解出 Node 引擎没落盘：%NODEF%
  pause
  exit /b 1
)
exit /b 0

:extract_py
rem Python 引擎是文件尾部整段，more +N 直接跳过前 N 行落盘
set "PYSRC="
for /f "tokens=1 delims=:" %%a in ('findstr /n /b "::PY_ENGINE_BELOW" "%SELF%"') do set "PYSRC=%%a"
if not defined PYSRC (
  echo [x] 本文件损坏：找不到内嵌 Python 引擎标记。
  pause
  exit /b 1
)
more +%PYSRC% "%SELF%" > "%PYF%"
if not exist "%PYF%" (
  echo [x] 自解出 Python 引擎没落盘：%PYF%
  pause
  exit /b 1
)
exit /b 0

::NODE_ENGINE_BELOW
/* 北风内嵌 Node 引擎（由 beifeng-tools.bat 自解出；行为与本地预览服务、本机转发器一致）
   用法：node bf_node_tools.mjs serve <母本> [起始端口]  |  proxy [起始端口]
   serve：每次请求现读母本按 text/html 返回（母本即真相，无副本）；只绑 127.0.0.1；
          pre/ 下的留档文件按白名单正则放行（basename 吃掉穿越）。
   proxy：本机转发器，安全边界与正主一致——只听 127.0.0.1、只受理本机来源/null、
          目标限 https 且解析必须公网、连接钉 IP 防 DNS 重绑定、不落日志。 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns/promises';

const HOST = '127.0.0.1';
const MAX_BODY = 25 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 120000;

function listen(server, start, label) {
  let port = start;
  const tryListen = () => new Promise((resolve, reject) => {
    const onErr = (e) => {
      if (e.code === 'EADDRINUSE' && port < start + 20) { port += 1; server.removeListener('error', onErr); tryListen().then(resolve, reject); }
      else reject(e);
    };
    server.once('error', onErr);
    server.listen(port, HOST, () => { server.removeListener('error', onErr); resolve(); });
  });
  return tryListen().then(() => port).catch((e) => { console.error(label + ' 启动失败：' + e.message); process.exit(1); });
}

function cmdServe() {
  const txt = process.argv[3];
  const start = Number(process.argv[4] || 8791);
  const preDir = path.join(path.dirname(txt), '..', 'pre');
  const server = http.createServer((req, res) => {
    const url = (req.url || '/').split('?')[0];
    let body;
    try {
      if (url === '/' || url === '/index.html') body = fs.readFileSync(txt);   /* 现读：改完源码刷新即生效 */
      else if (/^\/pre\/[A-Za-z0-9._-]+\.txt$/.test(url)) body = fs.readFileSync(path.join(preDir, path.posix.basename(url)));
      else { res.writeHead(404).end('404'); return; }
    } catch (e) { res.writeHead(500).end(String((e && e.message) || e)); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-length': body.length });
    res.end(body);
  });
  listen(server, start, 'serve').then((p) => {
    console.log('北风预览(Node) -> http://' + HOST + ':' + p + '/  (母本现读，无副本)');
    console.log('保持本窗口开着，关掉即停止。');
  });
}

const isAllowedOrigin = (o) => {
  if (!o || o === 'null') return true;
  try { const h = new URL(o).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'; } catch (e) { return false; }
};
const PRIV_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./];
const PRIV_V6 = [/^::1$/, /^fe80/i, /^fc/i, /^fd/i, /^::$/];
const isPrivateIp = (raw) => {
  /* 映射形态先剥壳：'::ffff:127.0.0.1' 既不走 v4 分支也过不了 ^127. 的判据，
     不剥就等于给环回留了扇后门。认不出的照旧按私有处理。 */
  const ip = String(raw == null ? '' : raw).toLowerCase().replace(/^::ffff:/, '');
  return net.isIPv4(ip) ? PRIV_V4.some((r) => r.test(ip))
    : net.isIPv6(ip) ? PRIV_V6.some((r) => r.test(ip)) : true;
};
async function assertPublicTarget(u) {
  if (u.protocol !== 'https:') throw new Error('只允许 https 目标');
  const host = u.hostname;
  if (!host || /\.(local|internal|localhost|test)$/i.test(host)) throw new Error('目标主机名被拒');
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('目标是内网/环回地址'); return { host, ip: host }; }
  const recs = await Promise.all([dns.resolve4(host).catch(() => []), dns.resolve6(host).catch(() => [])]);
  const ips = recs.flat();
  if (!ips.length) throw new Error('目标解析不到地址');
  if (ips.some(isPrivateIp)) throw new Error('目标解析到内网地址');
  /* 连接时用校验过的那个 IP（钉住）：否则「先查公网、连时再查一次」会被 DNS 重绑定绕过 */
  return { host, ip: ips[0] };
}
const HOP_BY_HOP = /^(connection|keep-alive|proxy-|sec-websocket|te|trailer|transfer-encoding|upgrade|host|origin|referer)$/i;
const pick = (src, re) => { const o = {}; for (const k of Object.keys(src || {})) if (re.test(k)) { const v = src[k]; o[k] = Array.isArray(v) ? v.join(', ') : v; } return o; };
function replyCors(res, req, extra) {
  const o = Object.assign({ 'Access-Control-Allow-Origin': String(req.headers.origin || 'null'), Vary: 'Origin' }, extra || {});
  Object.keys(o).forEach((k) => { try { res.setHeader(k, o[k]); } catch (e) {} });
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(new Error('请求体超过上限')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
function request(u, opt) {
  return new Promise((resolve, reject) => {
    const rq = https.request({
      /* hostname 用校验过的 IP（钉死，防重绑定），servername 与 Host 仍用真实主机名（SNI/虚拟主机依赖） */
      hostname: opt.ip || u.hostname, port: 443, path: u.pathname + (u.search || ''), method: opt.method, headers: opt.headers,
      servername: u.hostname, timeout: UPSTREAM_TIMEOUT_MS,
    }, (res) => {
      const cs = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(new Error('响应体超过上限')); res.destroy(); } else cs.push(c); });
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers || {}, body: Buffer.concat(cs) }));
      res.on('error', reject);
    });
    rq.on('timeout', () => { rq.destroy(new Error('目标超时')); });
    rq.on('error', reject);
    if (opt.body) rq.write(opt.body);
    rq.end();
  });
}
function cmdProxy() {
  const start = Number(process.argv[3] || process.env.BF_PROXY_PORT || 8792);
  const server = http.createServer(async (req, res) => {
    const send = (code, obj) => { replyCors(res, req, { 'Content-Type': 'application/json; charset=utf-8' }); res.writeHead(code); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
    if (!isAllowedOrigin(req.headers.origin)) return send(403, { ok: false, error: '来源不被允许（只允许本机页面调用）' });
    if (req.method === 'OPTIONS') {
      replyCors(res, req, {
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization, api-key, X-Proxy-Target',
        'Access-Control-Max-Age': '600',
      });
      res.writeHead(204); return res.end();
    }
    /* 健康探针只在「没带转发目标」时应答：GET + X-Proxy-Target 曾被这一行吃掉，
       调用方收到 200 + {"ok":true…}，转发其实没发生——错误被伪装成正常结果。 */
    const _hasTarget = !!req.headers['x-proxy-target'] || /[?&]to=/.test(String(req.url || ''));
    if (req.method === 'GET' && !_hasTarget && (req.url === '/' || req.url === '/health')) return send(200, { ok: true, name: 'beifeng-proxy', version: 1 });
    let target = '';
    try {
      const q = new URL(req.url, 'http://127.0.0.1');
      target = req.headers['x-proxy-target'] || q.searchParams.get('to') || '';
      if (!target) throw new Error('缺少目标地址');
      const u = new URL(target);
      const pinned = await assertPublicTarget(u);
      const body = req.method === 'GET' || req.method === 'HEAD' ? null : await readBody(req);
      const upstream = await request(u, {
        method: req.method, ip: pinned.ip,
        headers: Object.assign({}, pick(req.headers, /^(authorization|api-key|content-type|accept|accept-language)$/i), { host: u.host }),
        body,
      });
      replyCors(res, req, { 'Content-Type': upstream.headers['content-type'] || 'application/octet-stream', 'X-Proxy-Status': String(upstream.status) });
      res.writeHead(upstream.status);
      return res.end(upstream.body);
    } catch (e) {
      const msg = String((e && e.message) || '转发失败').slice(0, 200);
      let h = '?'; try { h = new URL(target || 'https://x').hostname; } catch (er) {}
      console.log('转发被拒：' + h + ' · ' + msg);   /* 只记主机与原因，不记正文与凭据 */
      return send(502, { ok: false, error: msg });
    }
  });
  listen(server, start, 'proxy').then((p) => {
    console.log('北风本机转发器(Node) 已启动：http://127.0.0.1:' + p);
    console.log('保持本窗口开着，回到北风「设置 → AI 服务」填这个地址并点「探测本机转发」。按 Ctrl+C 停止。');
  });
}
const act = String(process.argv[2] || '').toLowerCase();
if (act === 'serve') cmdServe();
else if (act === 'proxy') cmdProxy();
else { console.log('用法: bf_node_tools.mjs serve <母本> [端口] | proxy [端口]'); process.exit(1); }

::PY_ENGINE_BELOW
# -*- coding: utf-8 -*-
# ===== 北风 Python 兜底引擎（stdlib only；无 Node 时的完整替代，功能与 Node 引擎一致）=====
# 用法: bf_pytools.py serve <母本.txt> [起始端口]  |  proxy [起始端口]
# serve：每次请求现读母本按 text/html 返回；只监听 127.0.0.1。
# proxy：只受理本机来源 / 目标限 https 且拒内网 / 钉 IP / 不落日志。
import http.server, socketserver, socket, ssl, sys, os, re, urllib.parse, http.client

HOST = "127.0.0.1"
MAX_BODY = 25 * 1024 * 1024

def free_port(start):
    p = start
    while p < start + 20:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            try:
                s.bind((HOST, p))
                return p
            except OSError:
                p += 1
    raise SystemExit("端口 %d~%d 全被占用" % (start, p))

def cmd_serve():
    txt = sys.argv[2] if len(sys.argv) > 2 else os.path.join("work", "北风V0.0.1-alpha.txt")
    start = int(sys.argv[3]) if len(sys.argv) > 3 else 8791
    port = free_port(start)
    # 与 Node 引擎同一条 pre/ 白名单：兜底档缺了它，读「留档」的功能在没装 Node 的机器上会 404
    pre_dir = os.path.join(os.path.dirname(txt), "..", "pre")

    class H(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            path = urllib.parse.urlsplit(self.path).path
            if path in ("/", "/index.html"):
                try:
                    body = open(txt, "rb").read()   # 每请求现读：改完源码刷新即生效，无副本
                    code = 200
                except OSError as e:
                    body = ("母本读取失败: %s" % e).encode("utf-8"); code = 500
            elif re.match(r"^/pre/[A-Za-z0-9._-]+\.txt$", path):
                try:
                    body = open(os.path.join(pre_dir, os.path.basename(path)), "rb").read(); code = 200
                except OSError:
                    body, code = b"404", 404
            else:
                body, code = b"404", 404
            self.send_response(code)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        def log_message(self, *a):
            pass

    socketserver.ThreadingTCPServer.allow_reuse_address = True
    httpd = socketserver.ThreadingTCPServer((HOST, port), H)
    print("北风预览(py兜底) -> http://%s:%d/  (母本现读, 无副本)" % (HOST, port))
    print("保持本窗口开着, 关掉即停止。")
    httpd.serve_forever()

PRIV4 = ("10.", "127.", "169.254.", "192.168.", "0.")
PRIV172 = tuple("172.%d." % i for i in range(16, 32))

def ip_is_private(raw):
    # '::ffff:127.0.0.1' 这类映射形态先剥壳，否则走不进 v4 判据就当公网放行
    ip = str(raw or "").lower()
    if ip.startswith("::ffff:"):
        ip = ip[7:]
    if ip == "::1" or ip.startswith(("fe80", "fc", "fd")):
        return True
    return ip.startswith(PRIV4) or ip.startswith(PRIV172)

def _ssl_context():
    # Windows 上的 Python 经常验不了链：它自带的 CA 包不全，而 Node 自带一套根证书，
    # 于是"没装 Node 的机器"这条兜底路会 100% 报 CERTIFICATE_VERIFY_FAILED。
    # 依次补：certifi（装了就用）→ Windows 证书库 ROOT。全程保持校验开启——
    # 关校验等于把用户的密钥与书稿明文交给任意中间人，比转发失败更坏。
    ctx = ssl.create_default_context()
    try:
        import certifi
        ctx.load_verify_locations(cafile=certifi.where())
    except Exception:
        pass
    try:
        pems = []
        for der, _enc, _kind in ssl.enum_certificates("ROOT"):
            try:
                pems.append(ssl.DER_cert_to_PEM_cert(der))
            except Exception:
                pass
        if pems:
            ctx.load_verify_locations(cadata="".join(pems))
    except Exception:
        pass
    return ctx

SSL_CTX = _ssl_context()

def cmd_proxy():
    start = int(sys.argv[2]) if len(sys.argv) > 2 else 8792
    port = free_port(start)
    KEEP = ("authorization", "api-key", "content-type", "accept", "accept-language")

    class H(http.server.BaseHTTPRequestHandler):
        def _cors(self):
            return {
                "Access-Control-Allow-Origin": self.headers.get("Origin") or "null",
                "Vary": "Origin",
            }
        def _send(self, code, body, ctype="application/json; charset=utf-8", extra=None):
            self.send_response(code)
            for k, v in self._cors().items():
                self.send_header(k, v)
            if extra:
                for k, v in extra.items():
                    self.send_header(k, v)
            self.send_header("Content-Type", ctype)
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if body:
                self.wfile.write(body)
        def do_OPTIONS(self):
            self.send_response(204)
            for k, v in self._cors().items():
                self.send_header(k, v)
            self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, api-key, X-Proxy-Target")
            self.send_header("Access-Control-Max-Age", "600")
            self.end_headers()
        def _relay(self):
            origin = self.headers.get("Origin")
            if origin and origin != "null":
                h = urllib.parse.urlsplit(origin).hostname or ""
                if h not in ("localhost", "127.0.0.1", "::1"):
                    return self._send(403, b'{"ok":false,"error":"origin denied"}')
            if self.path in ("/", "/health") and not self.headers.get("X-Proxy-Target"):
                return self._send(200, b'{"ok":true,"name":"beifeng-proxy-py","version":1}')
            target = self.headers.get("X-Proxy-Target") or ""
            if not target:
                q = urllib.parse.urlsplit(self.path)
                target = (urllib.parse.parse_qs(q.query).get("to") or [""])[0]
            if not target:
                return self._send(400, b'{"ok":false,"error":"missing target"}')
            u = urllib.parse.urlsplit(target)
            if u.scheme != "https":
                return self._send(400, b'{"ok":false,"error":"https only"}')
            host = u.hostname or ""
            if not host or host.lower().endswith((".local", ".internal", ".localhost", ".test")):
                return self._send(403, b'{"ok":false,"error":"target host denied"}')
            try:
                infos = socket.getaddrinfo(host, 443, proto=socket.IPPROTO_TCP)
            except OSError:
                return self._send(502, b'{"ok":false,"error":"dns fail"}')
            ips = [x[4][0] for x in infos]
            # 与 Node 引擎同一条判据：只要解析结果里混进内网地址就整条拒。
            # 不能挑「第一个公网地址」用：那等于允许 DNS 把公网名换到内网后再放行。
            if not ips:
                return self._send(502, b'{"ok":false,"error":"no address"}')
            if any(ip_is_private(a) for a in ips):
                return self._send(403, b'{"ok":false,"error":"target resolves to private"}')
            ip = ips[0]
            ln = int(self.headers.get("Content-Length") or 0)
            if ln > MAX_BODY:
                return self._send(413, b'{"ok":false,"error":"request body too large"}')
            body = self.rfile.read(ln) if ln else None
            if body and len(body) > MAX_BODY:
                return self._send(413, b'{"ok":false,"error":"request body too large"}')
            hdrs = {}
            for k in KEEP:
                v = self.headers.get(k)
                if v:
                    hdrs[k] = v
            hdrs["Host"] = u.netloc
            try:
                raw = socket.create_connection((ip, 443), timeout=120)
                tls = SSL_CTX.wrap_socket(raw, server_hostname=host)
                c = http.client.HTTPSConnection(host, 443, timeout=120)
                c.sock = tls
                c.request(self.command, u.path + (("?" + u.query) if u.query else ""), body=body, headers=hdrs)
                r = c.getresponse()
                rb = r.read(MAX_BODY + 1)
                if len(rb) > MAX_BODY:
                    return self._send(502, b'{"ok":false,"error":"response too large"}')
                return self._send(r.status, rb, ctype=r.getheader("Content-Type") or "application/octet-stream", extra={"X-Proxy-Status": str(r.status)})
            except Exception as e:
                msg = str(e).replace(chr(34), chr(39))[:180]
                if "CERTIFICATE_VERIFY" in msg or "unable to get local issuer" in msg:
                    # 别把裸的 OpenSSL 文案丢给用户：这条兜底档缺可信根时说不清该干什么。
                    msg = "本机 Python 建不起可信证书链：装 Node 后重跑本 bat（或 pip install certifi）"
                return self._send(502, ('{"ok":false,"error":"%s"}' % msg).encode("utf-8"))
        def do_GET(self):
            self._relay()
        def do_POST(self):
            self._relay()
        def log_message(self, *a):
            pass

    httpd = socketserver.ThreadingTCPServer((HOST, port), H)
    print("北风本机转发器(py兜底) -> http://%s:%d" % (HOST, port))
    print("保持本窗口开着, 回北风设置-AI服务填该地址并点探测。Ctrl+C 停止。")
    httpd.serve_forever()

if __name__ == "__main__":
    act = (sys.argv[1].lower() if len(sys.argv) > 1 else "")
    if act == "serve":
        cmd_serve()
    elif act == "proxy":
        cmd_proxy()
    else:
        print("用法: bf_pytools.py serve <母本.txt> [端口] | proxy [端口]")
`.replace(/\n/g, '\r\n');
  },
};
/* 免安装版转发器：Windows 自带 PowerShell，不需要 Node。脚本正文全 ASCII ——
   Windows PowerShell 5.1 按 ANSI 读无 BOM 的 .ps1，中文注释会直接解坏，
   所以中文说明放进入口 .bat（它先 chcp 65001）。
   三条边界：只监听 127.0.0.1；只转发到导出时算出的那一个主机；凭据与正文不落日志。 */
BF.ai.proxyPs1 = function () {
  /* 白名单主机在导出时算定：这段跑在网关之前，只能走公开面拿端点 */
  let host = '';
  try {
    const p = BF.ai.currentProvider();
    const base = (p && p.id === 'custom') ? String(BF.settings.get('aiEndpoint') || '') : ((p && p.base) || '');
    host = new URL(base).host;
  } catch (e) { host = ''; }
  const L = [
    '# Beifeng local forwarder (no Node needed). Loopback only, single target host.',
    'param([int]$Port = 8796, [string]$AllowHost = ' + "'" + host + "'" + ')',
    '$ErrorActionPreference = "Stop"',
    'Add-Type -AssemblyName System.Net.Http | Out-Null',
    '[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12',
    'if (-not $AllowHost) { Write-Host "No target host baked in: pick the AI provider in Beifeng, then export again."; exit 1 }',
    '$listener = New-Object System.Net.HttpListener',
    '$listener.Prefixes.Add("http://127.0.0.1:" + $Port + "/")',
    'try { $listener.Start() } catch { Write-Host ("start failed: " + $_.Exception.Message); exit 1 }',
    'Write-Host ("Beifeng forwarder  http://127.0.0.1:" + $Port + "  ->  " + $AllowHost)',
    'Write-Host "Keep this window open. Press Ctrl+C or close it to stop."',
    '$client = New-Object System.Net.Http.HttpClient',
    'while ($listener.IsListening) {',
    '  $ctx = $listener.GetContext()',
    '  $res = $ctx.Response',
    '  try {',
    '    $req = $ctx.Request',
    '    $origin = [string]$req.Headers["Origin"]',
    '    if ($origin) { $res.AddHeader("Access-Control-Allow-Origin", $origin); $res.AddHeader("Vary", "Origin") }',
    '    if ($req.HttpMethod -eq "OPTIONS") {',
    '      $res.AddHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS")',
    '      $res.AddHeader("Access-Control-Allow-Headers", "authorization,content-type,api-key")',
    '      $res.AddHeader("Access-Control-Max-Age", "600")',
    '      $res.StatusCode = 204; $res.Close(); continue',
    '    }',
    '    $to = [string]$req.QueryString["to"]',
    '    $u = New-Object System.Uri($to)',
    /* 白名单比对必须用 Authority（主机+端口），不能用 Host：.NET 的 Uri.Host 不带端口，
       而白名单是按 URL.host 生成的（带端口）。用 Host 比时，凡是写明端点的目标
       （http://127.0.0.1:8899、https://内网机:8443）两边永远对不上，一律 403。 */
    '    if ([string]$u.Authority -ne $AllowHost) {',
    '      Write-Host ("refused: " + [string]$u.Authority)',
    '      $res.StatusCode = 403',
    '      $bad = [Text.Encoding]::UTF8.GetBytes(' + "'{\"ok\":false,\"error\":\"host not allowed\"}'" + ')',
    '      $res.OutputStream.Write($bad, 0, $bad.Length); $res.Close(); continue',
    '    }',
    '    $msg = New-Object System.Net.Http.HttpRequestMessage([System.Net.Http.HttpMethod]::Post, $to)',
    '    if ($req.HttpMethod -eq "GET") { $msg.Method = [System.Net.Http.HttpMethod]::Get }',
    '    foreach ($h in @("authorization", "api-key", "content-type")) {',
    '      $v = [string]$req.Headers[$h]',
    '      if ($v) { [void]$msg.Headers.TryAddWithoutValidation($h, $v) }',
    '    }',
    '    if ($req.HttpMethod -ne "GET" -and $req.HasEntityBody) {',
    '      $ms = New-Object System.IO.MemoryStream',
    '      $req.InputStream.CopyTo($ms)',
    '      $body = $ms.ToArray()',
    '      if ($body.Length -gt 8388608) { throw "request body too large" }',
    '      $sc = New-Object System.Net.Http.ByteArrayContent(,$body)',
    '      $ct = [string]$req.Headers["Content-Type"]',
    '      if ($ct) { [void]$sc.Headers.TryAddWithoutValidation("Content-Type", $ct) }',
    '      $msg.Content = $sc',
    '    }',
    '    $resp = $client.SendAsync($msg, [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()',
    '    $res.StatusCode = [int]$resp.StatusCode',
    '    $res.AddHeader("X-Proxy-Status", [string][int]$resp.StatusCode)',
    '    if ($resp.Content.Headers.ContentType) { $res.ContentType = $resp.Content.Headers.ContentType.ToString() }',
    '    $rs = $resp.Content.ReadAsStreamAsync().GetAwaiter().GetResult()',
    '    $os = $res.OutputStream',
    '    $buf = New-Object byte[] 16384',
    '    while ($true) {',
    '      $n = $rs.Read($buf, 0, $buf.Length)',
    '      if ($n -le 0) { break }',
    '      $os.Write($buf, 0, $n)',
    '      $os.Flush()',
    '    }',
    '    $os.Close()',
    '    Write-Host ("ok " + [int]$resp.StatusCode + "  " + [string]$u.Authority + $u.PathAndQuery)',
    '  } catch {',
    '    Write-Host ("failed: " + $_.Exception.Message)',
    '    try { $res.StatusCode = 502; $e = [Text.Encoding]::UTF8.GetBytes(' + "'{\"ok\":false,\"error\":\"forward failed\"}'" + '); $res.OutputStream.Write($e, 0, $e.Length); $res.Close() } catch {}',
    '  }',
    '}',
    '$listener.Stop()'
  ];
  return L.join('\r\n') + '\r\n';
};
BF.ai.proxyBatNoNode = function () {
  return '@echo off\r\n' +
    'chcp 65001 >nul\r\n' +
    'cd /d "%~dp0"\r\n' +
    'echo 北风本机转发器 · 免安装版（用系统自带 PowerShell，不需要 Node）\r\n' +
    'echo 只监听 127.0.0.1，且只转发到导出时选定的那一家服务商；其余目标一律 403。\r\n' +
    'echo 凭据与正文都不写日志。关闭本窗口即停止。\r\n' +
    'echo.\r\n' +
    'powershell -NoProfile -ExecutionPolicy Bypass -File "beifeng-proxy.ps1" %*\r\n' +
    'pause\r\n';
};
