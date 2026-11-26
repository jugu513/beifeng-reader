/* ================= A1c. 本机转发器源码（页面里永不执行，只用于导出） =================
   为什么长在这儿：个别服务商不回 CORS 头，浏览器里再怎么写都发不出去（见 BF.net），
   必须由一个页面之外的进程代跑一次 HTTP。单文件形态下没有随包文件，只能让程序自己
   把脚本导出给用户。写成 async 函数而不是字符串字面量，有三条实在的好处：
   ① 母本仍然只有一个内联 <script>（jsAll 计数不变）；
   ② 这段源码本身被 node --check 当 JS 校验，改坏了当场就红，字符串副本做不到；
   ③ 导出时 Function.prototype.toString() 取原文，不存在「两份副本互相漂移」。
   动态 import 在 Node 里合法；浏览器这边永远不会调用它，也不需要 CORS 豁免。
   安全边界（只监听 127.0.0.1 / 只受理本机与 file 源 / 目标限 https 且拒内网 /
   钉住校验过的 IP 防 DNS 重绑定 / 不记正文与凭据）都在这段里，导出后即成品。 */
BF.ai.PROXY_SRC_FN = async function () {
  const http = (await import('node:http')).default;
  const https = (await import('node:https')).default;
  const net = (await import('node:net')).default;
  const dns = (await import('node:dns/promises')).default;
  const PORT = Number(process.argv[2] || process.env.BF_PROXY_PORT || 8792);
  const MAX_BODY = 25 * 1024 * 1024;
  const TO_MS = 120000;
  const isAllowedOrigin = function (o) {
    if (!o || o === 'null') return true;
    try { const h = new URL(o).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'; } catch (e) { return false; }
  };
  const PRIV_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./];
  const PRIV_V6 = [/^::1$/, /^fe80/i, /^fc/i, /^fd/i, /^::$/];
  const isPrivateIp = function (raw) {
    /* '::ffff:127.0.0.1' 这类映射形态先剥壳，否则走不进 v4 判据就当公网放行。 */
    var ip = String(raw == null ? '' : raw).toLowerCase().replace(/^::ffff:/, '');
    return net.isIPv4(ip) ? PRIV_V4.some(function (r) { return r.test(ip); })
      : net.isIPv6(ip) ? PRIV_V6.some(function (r) { return r.test(ip); }) : true;
  };
  async function assertPublic(u) {
    if (u.protocol !== 'https:') throw new Error('只允许 https 目标');
    const host = u.hostname;
    if (!host || /\.(local|internal|localhost|test)$/i.test(host)) throw new Error('目标主机名被拒');
    if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('目标是内网/环回地址'); return host; }
    const ips = (await Promise.all([dns.resolve4(host).catch(function () { return []; }), dns.resolve6(host).catch(function () { return []; })])).flat();
    if (!ips.length) throw new Error('目标解析不到地址');
    if (ips.some(isPrivateIp)) throw new Error('目标解析到内网地址');
    return ips[0];
  }
  const KEEP = /^(authorization|api-key|content-type|accept|accept-language)$/i;
  function pick(src) { const o = {}; Object.keys(src || {}).forEach(function (k) { if (KEEP.test(k)) { const v = src[k]; o[k] = Array.isArray(v) ? v.join(', ') : v; } }); return o; }
  function up(u, ip, method, headers, body) {
    return new Promise(function (resolve, reject) {
      const r = https.request({ hostname: ip, port: 443, path: u.pathname + (u.search || ''), method: method,
        headers: headers, servername: u.hostname, timeout: TO_MS }, function (res) {
        const cs = []; let n = 0;
        res.on('data', function (c) { n += c.length; if (n > MAX_BODY) { reject(new Error('响应体超过上限')); res.destroy(); } else cs.push(c); });
        res.on('end', function () { resolve({ status: res.statusCode || 0, type: res.headers['content-type'] || 'application/octet-stream', body: Buffer.concat(cs) }); });
        res.on('error', reject);
      });
      r.on('timeout', function () { r.destroy(new Error('目标超时')); });
      r.on('error', reject);
      if (body) r.write(body);
      r.end();
    });
  }
  const server = http.createServer(function (req, res) {
    const send = function (code, obj, ctype) {
      res.setHeader('Access-Control-Allow-Origin', String(req.headers.origin || 'null'));
      res.setHeader('Vary', 'Origin');
      res.setHeader('Content-Type', ctype || 'application/json; charset=utf-8');
      res.writeHead(code);
      res.end(typeof obj === 'string' ? obj : JSON.stringify(obj));
    };
    if (!isAllowedOrigin(req.headers.origin)) { send(403, { ok: false, error: '来源不被允许（只允许本机页面调用）' }); return; }
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Origin', String(req.headers.origin || 'null'));
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, api-key, X-Proxy-Target');
      res.setHeader('Access-Control-Max-Age', '600');
      res.writeHead(204); res.end(); return;
    }
    if (req.method === 'GET' && (req.url === '/' || req.url === '/health') && !req.headers['x-proxy-target'] && !/[?&]to=/.test(String(req.url || ''))) { send(200, { ok: true, name: 'beifeng-proxy', version: 1 }); return; }
    let target = '';
    const done = function (code, obj) { send(code, obj); };
    (async function () {
      const q = new URL(req.url, 'http://127.0.0.1');
      target = String(req.headers['x-proxy-target'] || q.searchParams.get('to') || '');
      const u = new URL(target);
      const ip = await assertPublic(u);
      const bufs = [];
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        let n = 0;
        for await (const c of req) { n += c.length; if (n > MAX_BODY) throw new Error('请求体超过上限'); bufs.push(c); }
      }
      const r = await up(u, ip, req.method, Object.assign(pick(req.headers), { host: u.host }), bufs.length ? Buffer.concat(bufs) : null);
      res.setHeader('Access-Control-Allow-Origin', String(req.headers.origin || 'null'));
      res.setHeader('Vary', 'Origin');
      res.setHeader('Content-Type', r.type);
      res.setHeader('X-Proxy-Status', String(r.status));
      res.writeHead(r.status);
      res.end(r.body);
    })().catch(function (e) {
      const msg = String((e && e.message) || '转发失败').slice(0, 200);
      let host = '';
      try { host = new URL(target).hostname; } catch (err) { host = '?'; }
      console.log('转发被拒：' + host + ' · ' + msg);   /* 只记主机与原因：正文与凭据不落日志 */
      done(502, { ok: false, error: msg });
    });
  });
  server.on('error', function (e) { console.log('启动失败：' + (e && e.code === 'EADDRINUSE' ? '端口 ' + PORT + ' 已被占用（可能已经开着一个转发器）' : e.message)); process.exit(1); });
  server.listen(PORT, '127.0.0.1', function () {
    console.log('北风本机转发器已启动：http://127.0.0.1:' + PORT);
    console.log('保持本窗口开着，回到北风「设置 → AI 服务」填这个地址并点「探测各服务商」。按 Ctrl+C 停止。');
  });
};
/* 导出成品：函数原文外层包一对括号再自执行 —— 匿名函数声明放在语句位置是
   语法错误（Function statements require a function name），必须当表达式求值。 */
BF.ai.proxySource = function () {
  return '/* 北风本机转发器 · 由「设置 → AI 服务 → 导出转发脚本（Node 版）」生成\n' +
    '   用法：node beifeng-proxy.mjs [端口]（默认 8792，只监听 127.0.0.1）\n' +
    '   它只代跑一次 HTTP 请求并补 CORS 头，不存正文、不存凭据、不受理非本机来源。 */\n' +
    '(' + String(BF.ai.PROXY_SRC_FN) + '\n)();\n';
};
BF.ai.proxyBat = function () {
  return '@echo off\r\nrem 北风本机转发器：双击启动，关掉本窗口即停止\r\ncd /d "%~dp0"\r\nnode beifeng-proxy.mjs\r\npause\r\n';
};
