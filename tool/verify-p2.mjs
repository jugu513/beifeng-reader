#!/usr/bin/env node
/* W1 真机验证：起 serve → CDP 连 chromium → 触发固定轴色板+暖色互斥 → 读提示文案 → 抓 pageerror。
   纯 Node，无第三方包。CDP 用最小 WebSocket 客户端（RFC6455 客户端帧 + 服务端帧解析）。 */
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

import { ROOT, HTML } from './patch.mjs';
const PORT = 8805;
const CDP = 9340;

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
  const CHROME = process.env.BF_CHROMIUM || '/usr/bin/chromium';
  if (!fs.existsSync(CHROME)) { console.log('[SKIP] 无 chromium'); return; }
  const procs = []; let ws;
  try {
    const srv = spawn(process.execPath, [ROOT + '/tool/serve.mjs', String(PORT)], { cwd: ROOT, stdio: 'ignore' }); procs.push(srv);
    await delay(600);
    const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${CDP}`,'--user-data-dir=/tmp/p2-chrome-profile','about:blank'], { stdio:'ignore' }); procs.push(chrome);
    let tabs;
    for (let i=0;i<40;i++){ try{ tabs=await getJSON(`http://127.0.0.1:${CDP}/json`); if(tabs?.length) break; }catch{} await delay(250); }
    if (!tabs?.length) throw new Error('CDP 未就绪');
    ws = new WS(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
    await ws.connect(); await ws.send('Runtime.enable'); await ws.send('Page.enable');
    await ws.send('Page.navigate', { url:`http://127.0.0.1:${PORT}/` });
    let ready=false;
    for(let i=0;i<40;i++){ const r=await ws.eval(`typeof BF!=='undefined' && !!(BF.reader&&BF.theme)`); if(r===true){ready=true;break;} await delay(250); }
    if(!ready) throw new Error('BF 未就绪');
    await delay(300); ws.events.length=0;
    const r = await ws.eval(`(() => {
      const out={}; const T=(n,f)=>{try{out[n]=f();}catch(e){out[n]={error:String(e&&e.message||e)};}};
      // R1 命名
      T('r1Naming',()=>{
        // 读设置区渲染函数源码，避开懒渲染/缓存节点的 innerText 时序问题
        const sec=(BF.settingsUI.sections||[]).filter(x=>x.id==='reading')[0];
        const src=sec?sec.render.toString():'';
        const ok=src.indexOf('翻页方式')>=0&&src.indexOf('微读排版')>=0&&src.indexOf("'阅读模式'")<0&&src.indexOf("'微读模式'")<0;
        return {hasNew:src.indexOf('翻页方式')>=0&&src.indexOf('微读排版')>=0, noOld:src.indexOf("'阅读模式'")<0, ok};
      });
      // R4 行距口径：设置区应是滑块非下拉
      T('r4Slider',()=>{
        BF.settingsUI.open(); BF.settingsUI.render({detail:'reading'});
        const host=document.querySelector('[data-sec-host="reading"]');
        const r=host.querySelector('[data-set-num="lineHeight"]');
        const sel=host.querySelector('select[data-set="lineHeight"]');
        return {hasSlider:!!r, noSelect:!sel, ok:!!r&&!sel};
      });
      // S3 流体合并：选 apple 风格应自动 fluid-ui
      T('s3Fluid',()=>{
        BF.settings.set('skinStyle','apple'); BF.theme.apply();
        const on=document.body.classList.contains('fluid-ui');
        const mat=document.body.getAttribute('data-material');
        // 恢复
        BF.settings.set('skinStyle','default'); BF.theme.apply();
        const off=document.body.classList.contains('fluid-ui');
        return {on,mat,off,ok:on===true&&mat==='apple'};
      });
      // R3 智能让位：模拟 canvas active 时 pageModeActive 返回 false
      T('r3Yield',()=>{
        const orig=BF.settings.get('readerMode');
        BF.settings.set('readerMode','page');
        const pageWithout=BF.reader.pageModeActive();
        // 伪造 canvas.active
        const ca=BF.mr.canvas; const oa=ca.active;
        ca.active=function(){return true;};
        const pageWith=BF.reader.pageModeActive();
        ca.active=oa;
        BF.settings.set('readerMode',orig);
        return {pageWithout,pageWith,ok:pageWithout===true&&pageWith===false};
      });
      // 面板含 noIndent/justify
      T('panelFull',()=>{ const h=BF.readPanel.html(); return {ok:h.indexOf('data-rp="noIndent"')>=0&&h.indexOf('data-rp="justify"')>=0}; });
      return out;
    })()`);
    const errs = ws.events.filter(e=>e.method==='Runtime.exceptionThrown' || (e.method==='Runtime.consoleAPICalled'&&e.params?.type==='error'));
    console.log(JSON.stringify({results:r, pageerrors:errs.length}, null, 2));
    const fail=[];
    if(!r.r1Naming?.ok) fail.push('r1Naming');
    if(!r.r4Slider?.ok) fail.push('r4Slider');
    if(!r.s3Fluid?.ok) fail.push('s3Fluid');
    if(!r.r3Yield?.ok) fail.push('r3Yield');
    if(!r.panelFull?.ok) fail.push('panelFull');
    if(errs.length) fail.push('pageerror');
    if(fail.length){ console.log('✗ 专项失败：'+fail.join(', ')); process.exitCode=1; }
    else console.log('✓ P2专项真机通过：命名/行距滑块/S3流体合并/R3智能让位/面板完整/零pageerror');
  } catch(e){ console.error('✗ 专项脚本异常：'+e.message); process.exitCode=1; }
  finally { for(const p of procs) try{p.kill('SIGKILL');}catch{} }
})();
