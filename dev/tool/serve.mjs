/* 北风本地预览服务
   为什么不用 file://：Chromium 把 file:// 当不透明源，indexedDB.open 直接抛 SecurityError
   （源码 4546 行 BF.db 用的就是 IndexedDB），localStorage 也会与本机所有 file 页面共用一个域。
   也就是说在 file:// 下跑出来的"零报错启动"是降级环境的结果，不能作为验收证据。

   设计约束：
   - 不复制文件。每次请求现读 .txt 母本并按 text/html 返回 —— 母本即真相，
     不存在第二份可能漂移的副本，也不动闸门 ④ 的 txt/html 逐字节同步。
   - 只绑 127.0.0.1，不对外网卡开放。
   - 只暴露工作区母本与 beifeng/pre 下的留档（文件名白名单正则），不 serve 整个目录。 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { TXT, PRE } from './patch.mjs';
const HOST = '127.0.0.1';
const DEFAULT_PORT = 8791;
/* 端口参数容错：常见误用是把它当 `serve <母本> [端口]` 来敲（第一个参数是路径）。
   拿 Number() 硬转会得到 NaN，Node 直接以
   "options.port should be >= 0 and < 65536" 崩掉，看不出是自己敲错了位置。
   规则：在参数里找第一个落在合法区间的整数当端口，其余忽略；一个都没有就用默认值。 */
const portArgs = process.argv.slice(2).map((a) => Number(a)).filter((n) => Number.isInteger(n) && n > 0 && n < 65536);
const START = portArgs.length ? portArgs[0] : DEFAULT_PORT;
if (!process.argv.slice(2).every((a) => /^\d+$/.test(a))) {
  console.log(`提示：端口是第一个参数（serve ${START}）；忽略非数字参数，端口不在 1-65534 内一律不用。`);
}

const server = http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  let body, type = 'text/html; charset=utf-8';
  try {
    if (url === '/' || url === '/index.html') {
      body = fs.readFileSync(TXT);
    } else if (url === '/sim') {
      /* 界面实验室：纯界面与交互的壳，不读写任何存储，与母本同源但互不影响。
         本包没有 ui-lab/，所以这里要说人话，别把 ENOENT 路径当错误页甩给人看。 */
      const sim = path.join(path.dirname(TXT), '..', 'ui-lab', 'sim.html');
      if (!fs.existsSync(sim)) { res.writeHead(404, { 'content-type': type }).end('<h3>没有 ui-lab/sim.html</h3><p>界面实验室不在本包里（本包只含母本与验收工具）。阅读器本体不受影响，从 / 进。</p>'); return; }
      body = fs.readFileSync(sim);
    } else if (url === '/pre' || url === '/pre/') {
      /* 留档目录页：不必记住文件名也能点开改前/改后两份对比 */
      const list = fs.readdirSync(PRE).filter((f) => f.endsWith('.txt')).sort().map((f) => {
        const st = fs.statSync(path.join(PRE, f));
        return `<li><a href="/pre/${encodeURIComponent(f)}">${f}</a> · ${(st.size / 1048576).toFixed(2)} MB · ${st.mtime.toISOString().slice(0, 16).replace('T', ' ')}</li>`;
      }).join('');
      body = Buffer.from(`<!doctype html><meta charset="utf-8"><title>pre 留档</title><body style="font:14px/1.7 system-ui;padding:24px"><h1>pre/ 留档</h1>${list ? `<ul>${list}</ul>` : '（空）'}`, 'utf8');
    } else if (/^\/pre\/[A-Za-z0-9._-]+\.txt$/.test(url)) {
      /* 留档也能直接开：改前/改后各开一个标签页，计算样式差异就不必靠脑补。
         basename() 已经吃掉任何 ../ 穿越，所以这里不要求文件名带 step- 前缀 */
      body = fs.readFileSync(path.join(PRE, path.posix.basename(url)));
    } else { res.writeHead(404).end('404'); return; }
  } catch (e) { res.writeHead(500).end(String(e.message)); return; }
  res.writeHead(200, {
    'content-type': type,
    'cache-control': 'no-store',
    'content-length': body.length,
  });
  res.end(body);
});

/* 端口被占就顺延，打印实际端口供浏览器 MCP 使用 */
let port = START;
const tryListen = () => new Promise((resolve, reject) => {
  const onErr = (e) => {
    if (e.code === 'EADDRINUSE' && port < START + 20) { port += 1; server.removeListener('error', onErr); tryListen().then(resolve, reject); }
    else reject(e);
  };
  server.once('error', onErr);
  server.listen(port, HOST, () => { server.removeListener('error', onErr); resolve(); });
});

tryListen().then(() => {
  console.log(`北风 → http://${HOST}:${port}/  (母本现读，无副本)`);
  console.log(`留档 → http://${HOST}:${port}/pre`);
}).catch((e) => { console.error('启动失败：' + (e && e.code === 'EADDRINUSE' ? `端口 ${START}–${START + 20} 都被占用` : e.message)); process.exit(1); });
