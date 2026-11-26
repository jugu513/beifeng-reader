/* 北风 · 本机转发器（可选组件，不属产品）
   为什么需要：浏览器对页面发出的跨源请求强制 CORS 检查，页面内没有任何写法能绕过
   （Service Worker 的 fetch 同样受同源策略约束，no-cors 拿不到响应体）。个别 AI 服务商
   不回 Access-Control-Allow-Origin，从单文件本地页面就**结构性发不出去**，密钥填对也没用。
   本脚本在 127.0.0.1 上收请求、代发给目标、把响应带上 CORS 头回给页面，仅此一件事。

   安全边界（都是刻意的，别放宽）：
   ① 只监听 127.0.0.1，局域网/公网都摸不到它；
   ② 只受理 Origin 为 127.0.0.1/localhost 或 null（file://）的请求，别的源一律 403；
   ③ 目标只允许 https，且主机名解析结果必须是公网地址 —— 拒环回/私有段/链路本地/
      .local/.internal，否则本脚本会变成一台开往内网的任意代理（SSRF 面）；
   ④ 不记录、不打印任何请求头与正文（凭据只过路，不落日志）。

   用法：node beifeng/proxy.mjs [端口]     默认端口 8792，环境变量 BF_PROXY_PORT 同义
   与本文件同源的副本嵌在母本 BF.PROXY_SRC 里（设置→AI 的「导出转发脚本」用）；
   改这里必须同步改那边，两处不一致时以母本为准。
*/
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import dns from 'node:dns/promises';

const PORT = Number(process.argv[2] || process.env.BF_PROXY_PORT || 8792);
const MAX_BODY = 25 * 1024 * 1024;
const UPSTREAM_TIMEOUT_MS = 120000;

const isAllowedOrigin = (o) => {
  if (!o || o === 'null') return true;                       // file:// 形态
  try { const h = new URL(o).hostname; return h === 'localhost' || h === '127.0.0.1' || h === '[::1]'; } catch (e) { return false; }
};
const PRIV_V4 = [/^10\./, /^127\./, /^169\.254\./, /^192\.168\./, /^172\.(1[6-9]|2\d|3[01])\./, /^0\./];
const PRIV_V6 = [/^::1$/, /^fe80/i, /^fc/i, /^fd/i, /^::$/];
const isPrivateIp = (raw) => {
  // '::ffff:127.0.0.1' 这类映射形态先剥壳，否则走不进 v4 判据就当公网放行。
  const ip = String(raw == null ? '' : raw).toLowerCase().replace(/^::ffff:/, '');
  return net.isIPv4(ip) ? PRIV_V4.some((r) => r.test(ip))
    : net.isIPv6(ip) ? PRIV_V6.some((r) => r.test(ip)) : true;   // 认不出的按私有处理
};

async function assertPublicTarget(u) {
  if (u.protocol !== 'https:') throw new Error('只允许 https 目标');
  const host = u.hostname;
  if (!host || /\.(local|internal|localhost|test)$/i.test(host)) throw new Error('目标主机名被拒');
  if (net.isIP(host)) { if (isPrivateIp(host)) throw new Error('目标是内网/环回地址'); return { host, ip: host }; }
  const recs = await Promise.all([
    dns.resolve4(host).catch(() => []),
    dns.resolve6(host).catch(() => []),
  ]);
  const ips = recs.flat();
  if (!ips.length) throw new Error('目标解析不到地址');
  if (ips.some(isPrivateIp)) throw new Error('目标解析到内网地址');
  /* 返回校验过的那个 IP，连接时钉住它：否则「先查公网、连时再查一次」会被
     DNS 重绑定绕过（第二次返回内网地址），检查就白做了 */
  return { host, ip: ips[0] };
}

/* 逐跳头不转发；其余原样带过去，正文与凭据只过路不留存 */
const HOP_BY_HOP = /^(connection|keep-alive|proxy-|sec-websocket|te|trailer|transfer-encoding|upgrade|host|origin|referer)$/i;
const pick = (src, re) => { const o = {}; for (const k of Object.keys(src || {})) if (re.test(k)) { const v = src[k]; o[k] = Array.isArray(v) ? v.join(', ') : v; } return o; };

function replyCors(res, req, extra) {
  const o = Object.assign({ 'Access-Control-Allow-Origin': String(req.headers.origin || 'null'), Vary: 'Origin' }, extra || {});
  Object.keys(o).forEach((k) => { try { res.setHeader(k, o[k]); } catch (e) {} });
}

const server = http.createServer(async (req, res) => {
  const send = (code, obj) => { replyCors(res, req, { 'Content-Type': 'application/json; charset=utf-8' }); res.writeHead(code); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };

  if (!isAllowedOrigin(req.headers.origin)) return send(403, { ok: false, error: '来源不被允许（只允许本机页面调用）' });
  if (req.method === 'OPTIONS') {                                   // 预检由本转发器自己答，这才是它能救 CORS 的原因
    replyCors(res, req, {
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization, api-key, X-Proxy-Target',
      'Access-Control-Max-Age': '600',
    });
    res.writeHead(204); return res.end();
  }
  // 健康探针只在「没带转发目标」时应答，否则 GET + X-Proxy-Target 会被吃掉并回 200。
  if (req.method === 'GET' && (req.url === '/' || req.url === '/health') && !req.headers['x-proxy-target'] && !/[?&]to=/.test(String(req.url || ''))) return send(200, { ok: true, name: 'beifeng-proxy', version: 1 });

  let target = '';
  try {
    const q = new URL(req.url, 'http://127.0.0.1');
    target = req.headers['x-proxy-target'] || q.searchParams.get('to') || '';
    if (!target) throw new Error('缺少目标地址');
    const u = new URL(target);
    const pinned = await assertPublicTarget(u);

    const body = req.method === 'GET' || req.method === 'HEAD' ? null : await readBody(req);
    const upstream = await request(u, {
      method: req.method,
      ip: pinned.ip,
      headers: Object.assign({}, pick(req.headers, /^(authorization|api-key|content-type|accept|accept-language)$/i), { host: u.host }),
      body,
    });
    replyCors(res, req, {
      'Content-Type': upstream.headers['content-type'] || 'application/octet-stream',
      'X-Proxy-Status': String(upstream.status),
    });
    res.writeHead(upstream.status);
    return res.end(upstream.body);
  } catch (e) {
    const msg = String((e && e.message) || '转发失败').slice(0, 200);
    console.log('转发被拒：' + new URL(target || 'https://x').hostname + ' · ' + msg);   // 只记主机与原因，不记正文与凭据
    return send(502, { ok: false, error: msg });
  }
});

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
    const req = https.request({
      /* hostname 用校验过的 IP（钉死，防重绑定），servername 与 Host 仍用真实主机名（SNI/虚拟主机依赖它） */
      hostname: opt.ip || u.hostname, port: 443, path: u.pathname + (u.search || ''), method: opt.method, headers: opt.headers,
      servername: u.hostname, timeout: UPSTREAM_TIMEOUT_MS,
    }, (res) => {
      const cs = []; let n = 0;
      res.on('data', (c) => { n += c.length; if (n > MAX_BODY) { reject(new Error('响应体超过上限')); res.destroy(); } else cs.push(c); });
      res.on('end', () => resolve({ status: res.statusCode || 0, headers: res.headers || {}, body: Buffer.concat(cs) }));
      res.on('error', reject);
    });
    req.on('timeout', () => { req.destroy(new Error('目标超时')); });
    req.on('error', reject);
    if (opt.body) req.write(opt.body);
    req.end();
  });
}

server.listen(PORT, '127.0.0.1', () => {
  console.log('北风本机转发器已启动：http://127.0.0.1:' + PORT);
  console.log('保持本窗口开着，回到北风「设置 → AI 服务」填这个地址并点「探测本机转发」。');
  console.log('按 Ctrl+C 停止。');
});
server.on('error', (e) => { console.log('启动失败：' + (e && e.code === 'EADDRINUSE' ? '端口 ' + PORT + ' 已被占用（可能已经开着一个转发器）' : e.message)); process.exit(1); });
process.on('SIGINT', () => { console.log('\n已停止。'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 300); });
