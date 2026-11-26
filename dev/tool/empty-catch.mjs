/* 只读诊断：把空 catch 按 try 体里的调用域分档，输出「该补 warn 的候选清单」。
   不进产品、不进闸门；判据来自功能生态审查报告 P2-1 的分级口径。 */
import fs from 'node:fs';

import { TARGET } from './patch.mjs';
const FILE = process.argv[2] || TARGET;
const src = fs.readFileSync(FILE, 'utf8');

const LINE_AT = (i) => src.slice(0, i).split('\n').length;

function matchBrace(open) {
  let depth = 0, i = open;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === '{') depth++;
    else if (c === '}') { depth--; if (depth === 0) return i; }
    else if (c === '"' || c === "'" || c === '`') {
      const q = c; i++;
      while (i < src.length && src[i] !== q) { if (src[i] === '\\') i++; i++; }
    } else if (c === '/' && src[i + 1] === '/') { while (i < src.length && src[i] !== '\n') i++; }
    else if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 1; }
  }
  return -1;
}

const buckets = new Map();
/* 按所属模块归堆：空 catch 要补上报，一次补一个模块才谈得拢口径，
   零散按行号补最容易改一处漏一处。锚点取「该位置之前最后一个 BF.xxx =」 */
const ANCHORS = [...src.matchAll(/^BF\.([A-Za-z_$][\w$]*)\s*=/gm)].map((m) => ({ i: m.index, name: 'BF.' + m[1] }));
function moduleOf(idx) {
  let n = '（顶层/未归属）';
  for (const a of ANCHORS) { if (a.i <= idx) n = a.name; else break; }
  return n;
}
const byModule = new Map();
const sites = [];
const re = /catch\s*\([^)]*\)\s*\{/g;
let m;
while ((m = re.exec(src))) {
  /* `.catch(fn)` 是 Promise 的收尾不是 try/catch —— 那属于另一类（未处理的 rejection），
     混进来会把「补 warn」的清单撑虚。 */
  let p = m.index - 1;
  while (p >= 0 && /\s/.test(src[p])) p--;
  if (p >= 0 && src[p] === '.') continue;
  const open = src.indexOf('{', m.index + m[0].length - 1);
  const close = matchBrace(open);
  if (close < 0) continue;
  const body = src.slice(open + 1, close).trim();
  if (body && !/^\/\*[\s\S]*\*\/$/.test(body)) continue;
  const tryIdx = src.lastIndexOf('try', open);
  let tryBody = '';
  if (tryIdx >= 0) {
    const to = src.indexOf('{', tryIdx);
    if (to >= 0 && to < open) {
      const tc = matchBrace(to);
      tryBody = src.slice(to + 1, tc < 0 ? Math.min(open, to + 400) : Math.min(tc, to + 400)).replace(/\s+/g, ' ').trim();
    }
  }
  const lead = tryBody.slice(0, 90);
  const kind = classify(lead);
  buckets.set(kind, (buckets.get(kind) || 0) + 1);
  sites.push({ line: LINE_AT(m.index), idx: m.index, kind, lead });
}

function classify(t) {
  if (!t) return '空try体';
  if (/BF\.err\.|BF\.log\.|report\(/.test(t)) return '上报通路自身';
  if (/BF\.store\.|BF\.idb|idbOpen|indexedDB|localStorage|sessionStorage|BF\.ls|\.setKV|\.del\(/.test(t)) return '存储';
  if (/fetch|XMLHttpRequest|WebSocket|BF\.net|BF\.gateway|BF\.ai\.|BF\.tts|navigator\.|BF\.mimo|BF\.edge/.test(t)) return '网络·引擎';
  if (/JSON\.parse|JSON\.stringify|gzip|ungzip|compress|decompress|Blob|FileReader|TextDecoder|TextEncoder|BF\.import|BF\.bk\.|BF\.backup|BF\.restore|_apply/.test(t)) return '数据编解码';
  if (/BF\.undo|BF\.act\.|BF\.trash|BF\.ann\.|BF\.bookmark|BF\.notes|BF\.tags/.test(t)) return '标注·撤销数据';
  if (/classList|style\.|scrollTop|scrollIntoView|focus\(|blur\(|offset|getBoundingClientRect|matchMedia|querySelector|createElement|appendChild|removeChild|innerWidth/.test(t)) return 'UI·布局';
  if (/revokeObjectURL|dispatchEvent|bus\.emit|\bemit\(|addEventListener|removeEventListener|click\(|animate\(/.test(t)) return '事件·资源';
  if (/BF\.settings|BF\.prefs|BF\.theme|BF\.skin|BF\.appearance/.test(t)) return '设置·外观';
  if (/wakeLock|MediaSession|speechSynthesis|BF\.jobs|BF\.timers|BF\.worker|Worker\(|postMessage/.test(t)) return '运行时能力';
  return '其他';
}

const order = [...buckets.entries()].sort((a, b) => b[1] - a[1]);
console.log('空 catch 总数 ' + sites.length + '（含仅注释体）');
for (const [k, n] of order) console.log(String(n).padStart(4) + '  ' + k);
for (const s of sites) { const m = moduleOf(s.idx); byModule.set(m, (byModule.get(m) || 0) + 1); }
console.log('\n=== 按所属模块归堆（一次补一个模块，口径才谈得拢）===');
for (const [m, n] of [...byModule.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(String(n).padStart(4) + '  ' + m);
const must = new Set(['存储', '网络·引擎', '数据编解码', '标注·撤销数据']);
console.log('\n=== 报告口径「必须补 warn」的候选（' + sites.filter((s) => must.has(s.kind)).length + ' 处）===');
for (const s of sites) if (must.has(s.kind)) console.log(s.line + '\t' + s.kind + '\t' + moduleOf(s.idx) + '\t' + s.lead);
