#!/usr/bin/env node
/* W1 真机验证：起 serve → CDP 连 chromium → 触发固定轴色板+暖色互斥 → 读提示文案 → 抓 pageerror。
   纯 Node，无第三方包。CDP 用最小 WebSocket 客户端（RFC6455 客户端帧 + 服务端帧解析）。 */
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

import { ROOT, HTML } from './patch.mjs';
const PORT = 8798;
const CDP = 9333;

const delay = (ms) => new Promise((r) => setTimeout(r, ms));
const getJSON = (url) => new Promise((res, rej) => {
  http.get(url, (r) => { let d = ''; r.on('data', (c) => d += c); r.on('end', () => { try { res(JSON.parse(d)); } catch (e) { rej(e); } }); }).on('error', rej);
});

// 简版 WS 客户端：只处理文本帧、掩码客户端帧
class WS {
  constructor(url) {
    this.url = new URL(url);
    this.buf = Buffer.alloc(0);
    this.pending = new Map();
    this.events = [];
    this.seq = 0;
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.sock = net.connect(Number(this.url.port), this.url.hostname, () => {
        const key = crypto.randomBytes(16).toString('base64');
        this.sock.write(`GET ${this.url.pathname} HTTP/1.1\r\nHost: ${this.url.host}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: ${key}\r\nSec-WebSocket-Version: 13\r\n\r\n`);
      });
      let handshaken = false;
      this.sock.on('data', (chunk) => {
        this.buf = Buffer.concat([this.buf, chunk]);
        if (!handshaken) {
          const idx = this.buf.indexOf('\r\n\r\n');
          if (idx < 0) return;
          this.buf = this.buf.slice(idx + 4);
          handshaken = true;
          resolve();
        }
        this._frames();
      });
      this.sock.on('error', reject);
    });
  }
  _frames() {
    while (this.buf.length >= 2) {
      const b0 = this.buf[0], b1 = this.buf[1];
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) { if (this.buf.length < 10) return; len = Number(this.buf.readBigUInt64BE(2)); off = 10; }
      if (this.buf.length < off + len) return;
      const payload = this.buf.slice(off, off + len).toString('utf8');
      this.buf = this.buf.slice(off + len);
      let msg; try { msg = JSON.parse(payload); } catch { continue; }
      if (msg.id && this.pending.has(msg.id)) { this.pending.get(msg.id)(msg); this.pending.delete(msg.id); }
      else if (msg.method) this.events.push(msg);
    }
  }
  send(method, params = {}) {
    const id = ++this.seq;
    const data = Buffer.from(JSON.stringify({ id, method, params }));
    const mask = crypto.randomBytes(4);
    let head;
    if (data.length < 126) { head = Buffer.alloc(2); head[1] = 0x80 | data.length; }
    else if (data.length < 65536) { head = Buffer.alloc(4); head[1] = 0x80 | 126; head.writeUInt16BE(data.length, 2); }
    else { head = Buffer.alloc(10); head[1] = 0x80 | 127; head.writeBigUInt64BE(BigInt(data.length), 2); }
    head[0] = 0x81;
    const masked = Buffer.alloc(data.length);
    for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
    this.sock.write(Buffer.concat([head, mask, masked]));
    return new Promise((resolve) => this.pending.set(id, resolve));
  }
  async eval(expr) {
    const r = await this.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.result?.exceptionDetails) return { error: r.result.exceptionDetails.text };
    return r.result?.result?.value;
  }
}

(async () => {
  /* 三态降级：缺 chromium = 环境缺件，显式 SKIP 退 0（非程序失败）；有件保持原判定。 */
  const CHROME = process.env.BF_CHROMIUM || '/usr/bin/chromium';
  if (!fs.existsSync(CHROME)) {
    console.log('[SKIP] 真机验证未运行：找不到 chromium（' + CHROME + '）——环境缺件，非程序失败。');
    process.exitCode = 0;
    return;
  }
  console.log('[GATE] 通知文案真机验证 verify-notice · chromium=' + CHROME);
  const procs = [];
  let ws;
  try {
    // 起静态服务
    const srv = spawn(process.execPath, [ROOT + '/tool/serve.mjs', String(PORT)], { cwd: ROOT, stdio: 'ignore' });
    procs.push(srv);
    await delay(600);
    // 起 chromium（headless + 远程调试）
    const chrome = spawn(CHROME, [
      '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
      `--remote-debugging-port=${CDP}`, '--user-data-dir=/tmp/w1-chrome-profile',
      'about:blank',
    ], { stdio: 'ignore' });
    procs.push(chrome);
    // 等 CDP 就绪
    let tabs;
    for (let i = 0; i < 40; i++) {
      try { tabs = await getJSON(`http://127.0.0.1:${CDP}/json`); if (tabs?.length) break; } catch {}
      await delay(250);
    }
    if (!tabs?.length) throw new Error('CDP 未就绪');
    const page = tabs.find((t) => t.type === 'page');
    ws = new WS(page.webSocketDebuggerUrl);
    await ws.connect();
    await ws.send('Runtime.enable');
    await ws.send('Page.enable');
    // 加载母本
    await ws.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` });
    // 等 BF 就绪
    let ready = false;
    for (let i = 0; i < 40; i++) {
      const r = await ws.eval(`typeof BF !== 'undefined' && !!(BF.settings && BF.settings.set)`);
      if (r === true) { ready = true; break; }
      await delay(250);
    }
    if (!ready) throw new Error('页面 BF 未就绪');
    await delay(300);
    // 清 pageerror 记录
    ws.events.length = 0;
    // 触发互斥：设墨绿(songyan)为外观，再开暖色
    const setup = await ws.eval(`(() => {
      const out = {};
      out.hasBF = typeof BF !== 'undefined';
      out.hasSettings = !!(BF && BF.settings && BF.settings.set);
      return out;
    })()`);
    // 用 settings.set 走正规链（触发 reconcileSkin → _skinNotice → BF.noti.info）
    // hook BF.noti.info 精准捕获提示字符串，不依赖 UI 渲染时机
    const trigger = await ws.eval(`(() => {
      const r = {};
      try {
        window.__captured = [];
        const orig = BF.noti.info;
        BF.noti.info = function(msg){ window.__captured.push(String(msg)); return orig.apply(this, arguments); };
        BF.settings.set('appearance', 'songyan');
        r.appeared = BF.settings.get('appearance');
        BF.settings.set('warmth', 'warm');
        r.afterAppearance = BF.settings.get('appearance');
        r.warmth = BF.settings.get('warmth');
        r.captured = window.__captured;
        r.newHint = r.captured.some(m => /不能配暖色|已帮你关掉暖色|已帮你换成/.test(m));
        r.oldHint = r.captured.some(m => /色温与暖滤镜已复位|钉死在|互斥/.test(m));
        BF.noti.info = orig;
        return r;
      } catch(e) { r.error = e.message; return r; }
    })()`);
    const pageerrors = ws.events.filter((e) => e.method === 'Runtime.exceptionThrown').map((e) => e.params?.exceptionDetails?.text || 'err');
    console.log(JSON.stringify({ setup, trigger, pageerrors }, null, 2));
    const ok = trigger && !trigger.error && trigger.newHint && !trigger.oldHint && pageerrors.length === 0;
    console.log(ok ? '\n✓ W1 真机验证通过：新文案生效、旧文案消失、零 pageerror' : '\n✗ W1 真机验证未通过');
    process.exitCode = ok ? 0 : 1;
  } catch (e) {
    console.error('验证脚本异常：' + e.message);
    process.exitCode = 1;
  } finally {
    if (ws?.sock) ws.sock.destroy();
    procs.forEach((p) => { try { p.kill('SIGTERM'); } catch {} });
  }
})();
