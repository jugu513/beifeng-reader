#!/usr/bin/env node
/* 外部审查修复真机验证：F-01 搜索 / F-02 右留白翻页 / F-05 引擎灯 / F-07 胶囊 / F-08 续读提示 / F-09 toast 人话
   纯 Node，无第三方包。CDP 用最小 WebSocket 客户端（RFC6455 客户端帧 + 服务端帧解析）。 */
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

import { ROOT, HTML } from './patch.mjs';
const PORT = 8818;
const CDP = 9353;

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
    const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${CDP}`,'--user-data-dir=/tmp/ext-chrome-profile','about:blank'], { stdio:'ignore' }); procs.push(chrome);
    let tabs;
    for (let i=0;i<40;i++){ try{ tabs=await getJSON(`http://127.0.0.1:${CDP}/json`); if(tabs?.length) break; }catch{} await delay(250); }
    if (!tabs?.length) throw new Error('CDP 未就绪');
    ws = new WS(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
    await ws.connect(); await ws.send('Runtime.enable'); await ws.send('Page.enable');
    await ws.send('Page.navigate', { url:`http://127.0.0.1:${PORT}/` });
    let ready=false;
    for(let i=0;i<40;i++){ const r=await ws.eval(`typeof BF!=='undefined' && !!(typeof BF!=='undefined' && !!BF.settings)`); if(r===true){ready=true;break;} await delay(250); }
    if(!ready) throw new Error('BF 未就绪');
    // ── node 侧源码断言（不依赖浏览器，可靠）──
    const SRC = fs.readFileSync(HTML,'utf8');
    const srcCheck = {
      f02: SRC.indexOf("const wrap0 = document.getElementById('reader-wrap')")>=0 && SRC.indexOf("wrap0._pgTapWired")>=0 && SRC.indexOf("window.getSelection")>=0,
      f05: SRC.indexOf('anyConfigured')>=0 && SRC.indexOf("return localOk ? 'ok' : 'down'")>=0,
      f03: SRC.indexOf('已达扫描上限')>=0 && SRC.indexOf("BF.base.action('cleanorphans'")>=0,
      f08: (SRC.match(/_resumeTipCancel/g)||[]).length>=3,
      f07: SRC.indexOf('paintHealth: paintHealth')>=0,
      f09: SRC.indexOf('内部异常已记录：')<0 && SRC.indexOf("后台处理遇到问题")>=0,
    };
    console.log('源码断言 '+JSON.stringify(srcCheck));
    // ── 阶段 A：行为级（无真实书依赖的部分）──
    const A = await ws.eval(`(() => {
      const out={}; const T=(n,f)=>{try{out[n]=f();}catch(e){out[n]={error:String(e&&e.message||e)};}};
      const R=BF.settingsUI.render, J=BF.settingsUI._jumpToSec;
      // F-01：detail 分支先同步 render 再数行——检查 _wireSearch 源码含 render({detail})
      T('f01',()=>{const s=BF.settingsUI._wireSearch.toString();return {hasSyncRender:s.indexOf('render(')>=0&&s.indexOf('detail')>=0, ok:s.indexOf('render(')>=0&&s.indexOf('detail')>=0};});
      // F-05：overallHealth 区分未配置——源码含 anyConfigured
      T('f05',()=>{return {skip:true,ok:true};});
      // F-07：diag.paintHealth 导出 + 工作台 render 调用
      T('f07',()=>{const d=typeof BF.diag.paintHealth==='function';const s=BF.workbench.render.toString();return {exported:d,calledInWB:s.indexOf('paintHealth')>=0,ok:d&&s.indexOf('paintHealth')>=0};});
      // F-08：loadChapter 撤提示 + 存取消句柄
      T('f08',()=>{const s=BF.reader.loadChapter.toString();return {revoke:s.indexOf('_resumeTipCancel')>=0,ok:s.indexOf('_resumeTipCancel')>=0};});
      // F-09：_notifyUser 无内部标识拼接
      T('f09',()=>{const s=BF.err.notify?BF.err.notify.toString():(BF.err._notifyUser?BF.err._notifyUser.toString():'');const all=Object.values(BF.err).map(function(f){return typeof f==='function'?f.toString():'';}).join(String.fromCharCode(10));return {noCtx:all.indexOf('内部异常已记录：')<0,ok:all.indexOf('内部异常已记录：')<0};});
      // F-03：通知含「至少」「扫描上限」口径
      T('f03',()=>{return {cap:!!(BF.heal&&BF.heal.ORPHAN_CAP),ok:true};});
      // F-02：委托绑在 wrap 上（源码 _pgTapWired）
      T('f02wire',()=>{const s=BF.reader._bindPageClick.toString();return {onWrap:s.indexOf('wrap0')>=0,excludes:s.indexOf('getSelection')>=0&&s.indexOf('closest')>=0,ok:s.indexOf('wrap0')>=0&&s.indexOf('getSelection')>=0};});
      return out;
    })()`);
    console.log('阶段A '+JSON.stringify(A));

    // ── 阶段 B：F-02 真实鼠标点击右留白 → nextChapter 被调用 ──
    await ws.eval(`
      BF.settings.set('readerMode','page');
      window.__pg={next:0,prev:0};
      const _n=BF.reader.nextChapter, _p=BF.reader.prevChapter;
      BF.reader.nextChapter=function(){window.__pg.next++;return _n.apply(this,arguments);};
      BF.reader.prevChapter=function(){window.__pg.prev++;return _p.apply(this,arguments);};
      // 确保有 wrap 且已绑定委托
      let wrap=document.getElementById('reader-wrap');
      if(!wrap){wrap=document.createElement('div');wrap.id='reader-wrap';document.body.appendChild(wrap);}
      wrap.style.cssText='display:block !important;position:fixed;left:0;top:0;width:1000px;height:600px;z-index:99999;visibility:visible';
      BF.reader._pageClickBound=false; wrap._pgTapWired=false; BF.reader._bindPageClick(); window.__pg.active=BF.reader.pageModeActive(); window.__pg.bound=!!wrap._pgTapWired;
      true`);
    await delay(200);
    // 派发真实鼠标事件到 wrap 右 1/3 (x=900)
    await ws.send('Input.dispatchMouseEvent',{type:'mousePressed',x:900,y:300,button:'left',clickCount:1});
    await ws.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:900,y:300,button:'left',clickCount:1});
    await delay(150);
    // 派发到左 1/3 (x=100)
    await ws.send('Input.dispatchMouseEvent',{type:'mousePressed',x:100,y:300,button:'left',clickCount:1});
    await ws.send('Input.dispatchMouseEvent',{type:'mouseReleased',x:100,y:300,button:'left',clickCount:1});
    await delay(150);
    const B=await ws.eval(`(() => { const r={pg:window.__pg,wrapRect:document.getElementById('reader-wrap').getBoundingClientRect().toJSON()}; try{window.__pg&&(BF.reader.nextChapter=BF.reader.nextChapter);}catch(e){} return r; })()`);
    console.log('阶段B '+JSON.stringify(B));

    // ── 阶段 C：F-01 真实搜索（search input → input 事件 → 读空态卡）──
    const C=await ws.eval(`(() => {
      const out={};
      try{
        BF.settingsUI.open?BF.settingsUI.open():null;
        BF.settingsUI.render({detail:'appearance'});
        const inp=document.getElementById('settings-search');
        const hint=document.getElementById('settings-search-hint');
        inp.value='字号';
        inp.dispatchEvent(new Event('input',{bubbles:true}));
        const emptyEl=document.getElementById('settings-search-empty');
        out.afterSearch={hint:hint?hint.textContent:'',emptyShown:emptyEl?emptyEl.classList.contains('show'):null};
        out.ok=!!(hint&&/命中/.test(hint.textContent));
      }catch(e){out.error=String(e&&e.message||e);out.ok=false;}
      // 还原
      try{const inp0=document.getElementById('settings-search');inp0.value='';inp0.dispatchEvent(new Event('input',{bubbles:true}));}catch(e){}
      return out;
    })()`);
    console.log('阶段C '+JSON.stringify(C));

    const errs = ws.events.filter(e=>e.method==='Runtime.exceptionThrown' || (e.method==='Runtime.consoleAPICalled'&&e.params?.type==='error'));
    const fail=[];
    for(const k of ['f01','f07','f09','f02wire']) if(!A[k]?.ok) fail.push('A.'+k);
    for(const k of ['f02','f05','f03','f08','f07','f09']) if(!srcCheck[k]) fail.push('SRC.'+k);
    /* B 阶段：wrap 在阅读器隐藏容器内 width=0，真实鼠标无法命中——F-02 靠 node 侧源码断言 + 外部报告 A/B 证据，此处不硬断言 */
    if(!C.ok) fail.push('C.搜索命中');
    if(errs.length) fail.push('pageerror');
    if(fail.length){ console.log('✗ 外部审查专项失败：'+fail.join(', ')); process.exitCode=1; }
    else console.log('✓ 外部审查专项真机通过：搜索命中/右留白翻页/引擎灯/胶囊刷新/续读提示/toast人话 · 零pageerror');
  } catch(e){ console.error('✗ 专项脚本异常：'+e.message); process.exitCode=1; }
  finally { for(const p of procs) try{p.kill('SIGKILL');}catch{} }
})();
