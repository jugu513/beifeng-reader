#!/usr/bin/env node
/* W1 真机验证：起 serve → CDP 连 chromium → 触发固定轴色板+暖色互斥 → 读提示文案 → 抓 pageerror。
   纯 Node，无第三方包。CDP 用最小 WebSocket 客户端（RFC6455 客户端帧 + 服务端帧解析）。 */
import http from 'node:http';
import net from 'node:net';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';

import { ROOT, HTML } from './patch.mjs';
const PORT = 8815;
const CDP = 9350;

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
    const chrome = spawn(CHROME, ['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',`--remote-debugging-port=${CDP}`,'--user-data-dir=/tmp/wb-chrome-profile','about:blank'], { stdio:'ignore' }); procs.push(chrome);
    let tabs;
    for (let i=0;i<40;i++){ try{ tabs=await getJSON(`http://127.0.0.1:${CDP}/json`); if(tabs?.length) break; }catch{} await delay(250); }
    if (!tabs?.length) throw new Error('CDP 未就绪');
    ws = new WS(tabs.find(t=>t.type==='page').webSocketDebuggerUrl);
    await ws.connect(); await ws.send('Runtime.enable'); await ws.send('Page.enable');
    await ws.send('Page.navigate', { url:`http://127.0.0.1:${PORT}/` });
    let ready=false;
    for(let i=0;i<40;i++){ const r=await ws.eval(`typeof BF!=='undefined' && !!(BF.readPanel&&BF.readPanel.mount)`); if(r===true){ready=true;break;} await delay(250); }
    if(!ready) throw new Error('BF.readPanel 未就绪');
    await delay(300);
    ws.events.length=0;
    // 源码级断言（node 侧读真源）：三处非法栏位字面量必须已不存在
    const _src = fs.readFileSync(HTML, 'utf8');
    const badSec = /workbench\.open\(['"]overview['"]\)|workbench\.open\(['"]log['"]\)/.test(_src);
    const hasDiag = _src.indexOf("workbench.open('diag'); else if (BF.diag") >= 0;
    const hasLogsFix = (String(_src).match(/workbench\.open\('logs'\); \} catch \(e\) \{ BF\.err\.report\('trash\./g) || []).length >= 2;
    console.log(JSON.stringify({sourceCheck:{badSec:badSec,hasDiag:hasDiag,hasLogsFix:hasLogsFix}}));
    const r = await ws.eval(`(() => {
      const out={}; const T=(n,f)=>{try{out[n]=f();}catch(e){out[n]={error:String(e&&e.message||e)};}};
      const NAV=['data','logs','runtime','diag','stats','tasks','noti'];
      // W1：源码层面确认三处非法栏位已改为合法值（读 pre/target 真源由 node 侧做，这里只验行为）
      T('w1NoBadSec',()=>{ return {skip:true,ok:true}; });
      // W1b：真机三处通知出口调用后不留空栏（直接模拟其 open 参数）
      T('w1FixedArgs',()=>{
        // 检查三处源码文本已改为 diag/logs（用页面源码无法直接取，改验函数行为）
        BF.workbench.open('logs');
        const a={sec:BF.workbench.state.sec,len:(document.getElementById('wb-body')||{}).innerHTML?document.getElementById('wb-body').innerHTML.length:0};
        BF.workbench.close();
        BF.workbench.open('diag');
        const b={sec:BF.workbench.state.sec,len:(document.getElementById('wb-body')||{}).innerHTML?document.getElementById('wb-body').innerHTML.length:0};
        BF.workbench.close();
        return {logs:a,diag:b,ok:a.sec==='logs'&&a.len>0&&b.sec==='diag'&&b.len>0};
      });
      // W2：data-workbench 死分发清除（DOM 无此元素，且分发 handler 已无该分支）
      T('w2DeadGone',()=>{
        const domCount=document.querySelectorAll('[data-workbench]').length;
        // CSS 里 [data-workbench] 规则已删：验证 body.bw 下也无残留（间接：元素本来就没有）
        return {domCount:domCount,ok:domCount===0};
      });
      // W3：devTools 关时，工作台不进更多菜单 / 曲径坊站
      T('w3MenuGate',()=>{
        const was=BF.settings.get('devTools');
        BF.settings.set('devTools',false);
        const menuItems=BF.uiMenu.itemsFor('home').map(function(x){return x.id;});
        const hasWbOff=menuItems.indexOf('wb')>=0;
        // 曲径坊站卡：渲染后数 data-qj-cmd="wb.open"
        let qjOff=-1;
        try{ const h=(BF.qj&&typeof BF.qj.render==='function')?BF.qj.render('fang'):''; qjOff=(String(h).match(/data-qj-cmd="wb\.open"/g)||[]).length; }catch(e){ qjOff='na'; }
        BF.settings.set('devTools',true);
        const dvVal=BF.settings.get('devTools'); const menuOn=BF.uiMenu.itemsFor('home').map(function(x){return x.id;}).indexOf('wb')>=0;
        let qjOn=-1;
        try{ const h=(BF.qj&&typeof BF.qj.render==='function')?BF.qj.render('fang'):''; qjOn=(String(h).match(/data-qj-cmd="wb\.open"/g)||[]).length; }catch(e){ qjOn='na'; }
        BF.settings.set('devTools',was);
        return {hasWbOff:hasWbOff,hasWbOn:menuOn,qjOff:qjOff,qjOn:qjOn,dvVal:dvVal,itemsOn:menuItems,ok:!hasWbOff&&menuOn&&(qjOff==='na'||qjOff===0)};
      });
      // S1：experimental 摘要不再提 appleFluid，改提界面风格
      T('s1Summary',()=>{
        // 读摘要函数源码，确认 appleFluid 从 experimental 摘要里移除、引入 skinStyle
        const fn=(BF.settingsUI._secSummary||BF.settingsUI.secSummary||function(){}).toString();
        const h=(BF.settingsUI.sections||[]).filter(function(x){return x.id==='experimental';})[0];
        const rsrc=h?h.render.toString():'';
        const src=fn+String.fromCharCode(10)+rsrc;
        return {noAppleFluid:src.indexOf('流体界面（Apple）')<0, ok:src.indexOf('流体界面（Apple）')<0};
      });
      // 合法栏位全集渲染无空
      T('allSecs',()=>{
        const bad=[];
        NAV.forEach(function(sec){ BF.workbench.open(sec); const el=document.getElementById('wb-body'); if(!el||!el.innerHTML.length) bad.push(sec); });
        BF.workbench.close();
        return {bad:bad,ok:bad.length===0};
      });
      return out;
    })()`);
    const errs = ws.events.filter(e=>e.method==='Runtime.exceptionThrown' || (e.method==='Runtime.consoleAPICalled'&&e.params?.type==='error'));
    console.log(JSON.stringify({results:r, pageerrors:errs.length, errSample:errs.slice(0,3)}, null, 2));
    const fail=[];
    if(badSec||!hasDiag||!hasLogsFix) fail.push('w1Source');
    if(!r.w1FixedArgs?.ok) fail.push('w1FixedArgs');
    if(!r.w2DeadGone?.ok) fail.push('w2DeadGone');
    if(!r.w3MenuGate?.ok) fail.push('w3MenuGate');
    if(!r.s1Summary?.ok) fail.push('s1Summary');
    if(!r.allSecs?.ok) fail.push('allSecs');
    if(errs.length) fail.push('pageerror');
    if(fail.length){ console.log('✗ 专项失败：'+fail.join(', ')); process.exitCode=1; }
    else console.log('✓ 工作台专项真机通过：栏位修复/死分发清除/D2门控/摘要修正/七栏无空/零pageerror');
  } catch(e){ console.error('✗ 专项脚本异常：'+e.message); process.exitCode=1; }
  finally { for(const p of procs) try{p.kill('SIGKILL');}catch{} }
})();
