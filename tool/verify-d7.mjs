#!/usr/bin/env node
/* D7 真机验证：删铅字主题后外观 7 档 + 旧存档 qianzi 兼容
   W1 真机验证：起 serve → CDP 连 chromium → 触发固定轴色板+暖色互斥 → 读提示文案 → 抓 pageerror。
   纯 Node，无第三方包。CDP 用最小 WebSocket 客户端（RFC6455 客户端帧 + 服务端帧解析）。 */
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

import { ROOT, HTML } from './patch.mjs';
const PORT = 8816;
const CDP = 9351;

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
    if (r.result?.exceptionDetails) return { error: (r.result.exceptionDetails.exception?.description || r.result.exceptionDetails.text) };
    return r.result?.result?.value;
  }
}

(async () => {
  const CHROME = process.env.BF_CHROMIUM || '/usr/bin/chromium';
  if (!fs.existsSync(CHROME)) { console.log('[SKIP] 无 chromium'); return; }
  const procs = []; let ws;
  try {
    const srv = spawn(process.execPath, [ROOT + '/tool/serve.mjs', String(PORT)], { cwd: ROOT, stdio: 'ignore' }); procs.push(srv);
    await delay(600);
    const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${CDP}`,'--user-data-dir=/tmp/d7-chrome-profile','about:blank'], { stdio:'ignore' }); procs.push(chrome);
    let tabs;
    for (let i=0;i<40;i++){ try{ tabs=await getJSON(`http://127.0.0.1:${CDP}/json`); if(tabs?.length) break; }catch{} await delay(250); }
    if (!tabs?.length) throw new Error('CDP 未就绪');
    ws = new WS(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
    await ws.connect(); await ws.send('Runtime.enable'); await ws.send('Page.enable');
    await ws.send('Page.navigate', { url:`http://127.0.0.1:${PORT}/` });
    let ready=false;
    for(let i=0;i<40;i++){ const r=await ws.eval(`typeof BF!=='undefined' && !!(BF.readPanel&&BF.readPanel.mount)`); if(r===true){ready=true;break;} await delay(250); }
    if(!ready) throw new Error('BF.readPanel 未就绪');
    // ── 阶段 A：登记表 / 枚举 / 循环 / 下拉文案 ──
    const r = await ws.eval(`(() => {
      const out={}; const T=(n,f)=>{try{out[n]=f();}catch(e){out[n]={error:String(e&&e.message||e)};}};
      const EXP=['light','dark','black','system','songyan','yan','yehang'];
      T('skins',()=>{const l=BF.SKINS.slice();return {list:l,n:l.length,ok:l.length===7&&l.indexOf('qianzi')<0};});
      T('opts',()=>{const o=BF.skin.opts().map(function(x){return x[0];});return {ids:o,ok:o.length===7&&o.indexOf('qianzi')<0&&o.slice().sort().join()===EXP.slice().sort().join()};});
      T('labels',()=>{const k=Object.keys(BF.SKIN_LABELS);return {keys:k,ok:k.length===7&&!BF.SKIN_LABELS.qianzi&&k.slice().sort().join()===EXP.slice().sort().join()};});
      T('tokens',()=>{const k=Object.keys(BF.SKIN_TOKENS);return {keys:k,ok:k.length===3&&k.indexOf('qianzi')<0&&typeof BF.QIANZI_TOKENS==='undefined'};});
      T('uiCopy',()=>{const t=BF.skin.opts().map(function(x){return x[1];}).join('|');return {text:t,ok:t.indexOf('铅字')<0};});
      T('cycle',()=>{const bad=[];EXP.forEach(function(s){BF.settings.set('appearance',s);try{BF.commands.run('theme.cycle');}catch(e){bad.push(s+':throw');return;}const c=BF.skin.get();if(EXP.indexOf(c)<0)bad.push(s+'>'+c);});BF.settings.set('appearance','dark');return {bad:bad,ok:bad.length===0};});
      return out;
    })()`);
    console.log('阶段A '+JSON.stringify(r));
    // ── 阶段 B：写入旧存档 appearance=qianzi → 真实 reload → 复核兜底 ──
    const wr = await ws.eval(`(function(){ BF.settings.set('appearance','qianzi'); return {raw:BF.settings.get('appearance'), prefix:(BF.store&&BF.store.PREFIX)||'na'}; })()`); console.log('写入 '+JSON.stringify(wr));
    await delay(500);
    await ws.send('Page.reload', { ignoreCache: false });
    let ready2=false;
    for(let i=0;i<40;i++){ const q=await ws.eval(`typeof BF!=='undefined' && !!(BF.skin&&BF.skin.get)`); if(q===true){ready2=true;break;} await delay(250); }
    if(!ready2) throw new Error('reload 后 BF 未就绪');
    const diag1 = await ws.eval(`({hasBF: typeof BF!=='undefined', url: location.href, ready: document.readyState})`); console.log('B诊断 '+JSON.stringify(diag1)); await delay(300);
    const r2 = await ws.eval(`(() => {
      const out={};
      out.raw = BF.settings.get('appearance');
      out.effective = BF.skin.get();
      out.label = BF.skin.label(out.effective);
      out.isPalette = BF.skin.isPalette(out.effective);
      out.bodyOk = !!document.body && document.body.childElementCount>0;
      out.ok = out.raw==='qianzi' && out.effective==='dark' && out.bodyOk;
      return out;
    })()`);
    console.log('阶段B '+JSON.stringify(r2));
    const errs = ws.events.filter(e=>e.method==='Runtime.exceptionThrown' || (e.method==='Runtime.consoleAPICalled'&&e.params?.type==='error'));
    const fail=[];
    for(const k of ['skins','opts','labels','tokens','uiCopy','cycle']) if(!r?.[k]?.ok) fail.push('A.'+k);
    if(!r2?.ok) fail.push('B.旧存档兜底');
    if(errs.length) fail.push('pageerror');
    if(fail.length){ console.log('✗ D7 专项失败：'+fail.join(', ')); process.exitCode=1; }
    else console.log('✓ 删铅字专项真机通过：7档/3板 · 下拉无铅字 · 循环不越界 · 旧存档qianzi退回深色不崩 · 零pageerror');
  } catch(e){ console.error('✗ 专项脚本异常：'+e.message); process.exitCode=1; }
  finally { for(const p of procs) try{p.kill('SIGKILL');}catch{} }
})();
