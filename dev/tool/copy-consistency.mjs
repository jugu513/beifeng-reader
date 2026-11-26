/* 只读：找「文案与现状不符」——不看语气，看**事实**。
   三类机器判据：
   ① 点了名但源码里没有这个界面名（「」/『』/" 设置 → X" 里的 X 不在任何可见文案里）；
   ② 承诺了快捷键（Ctrl+X / Alt+X / F1），但快捷键表里没有这条绑定；
   ③ 数字承诺（N 种 / N 档 / N 色 / N 个）——列出来人工核，脚本不猜。
   用法：node tool/copy-consistency.mjs [母本] */
import fs from 'node:fs';

import { TARGET } from './patch.mjs';
const FILE = process.argv[2] || TARGET;
const L = fs.readFileSync(FILE, 'utf8').split('\n');
const STR = /'(?:[^'\\]|\\.)*[\u4e00-\u9fa5](?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*[\u4e00-\u9fa5](?:[^"\\]|\\.)*"/g;

const items = [];   /* { line, text } */
for (let i = 0; i < L.length; i++) {
  const s = L[i];
  if (!/[\u4e00-\u9fa5]/.test(s)) continue;
  if (/^\s*(\/\*|\*|\/\/)/.test(s)) continue;
  const ms = s.match(STR);
  if (!ms) continue;
  for (const raw of ms) items.push({ line: i + 1, text: raw.slice(1, -1) });
}
const corpus = items.map(x => x.text).join('\n');
const hasName = (name) => corpus.indexOf(name) >= 0;

/* ① 引用的界面名 */
const nameRefs = [];
const RE_NAME = /(?:「([^」]{2,14})」|『([^』]{2,14})』)/g;
for (const it of items) {
  let m;
  RE_NAME.lastIndex = 0;
  while ((m = RE_NAME.exec(it.text))) {
    const name = (m[1] || m[2] || '').trim();
    if (!name || /^(已|取消|确定|是|否|好)$/.test(name)) continue;
    /* 允许：本身是另一个文案里的整名 */
    if (!hasName(name)) nameRefs.push({ line: it.line, name, ctx: it.text.slice(0, 60) });
  }
}
/* ② 「设置 → X」引用的面板名 */
const settingRefs = [];
for (const it of items) {
  const m = /设置\s*(?:→|->|>)\s*([\u4e00-\u9fa5A-Za-z ]{2,10})/.exec(it.text);
  if (m) settingRefs.push({ line: it.line, target: m[1].trim(), ctx: it.text.slice(0, 60) });
}
/* ③ 快捷键承诺 */
const hot = [];
const RE_KEY = /\b(Ctrl|Alt|Shift|Meta)\s*\+\s*([A-Za-z0-9]|F\d{1,2}|Enter|Esc|Space|Tab|Delete|Backspace)\b/g;
for (const it of items) {
  let m;
  RE_KEY.lastIndex = 0;
  while ((m = RE_KEY.exec(it.text))) hot.push({ line: it.line, combo: (m[1] + '+' + m[2]).toLowerCase(), ctx: it.text.slice(0, 60) });
}
/* 快捷键真源：hotkeys.bind 注册 */
const binds = new Set();
L.forEach(s => {
  const m = /hotkeys\.bind\(\s*'[^']+'\s*,\s*'([^']+)'/.exec(s);
  if (m) binds.add(m[1].toLowerCase().replace(/\s+/g, ''));
});

/* ④ 数字承诺（人工核） */
const nums = [];
for (const it of items) {
  const m = /([0-9一二三四五六七八九十两]{1,3})\s*(种|档|色|个|条|项|章|分钟|MB|秒)/.exec(it.text);
  if (m && /种|档|色|条|项/.test(m[2])) nums.push({ line: it.line, claim: m[0], ctx: it.text.slice(0, 56) });
}

const uniq = (arr, key) => { const seen = new Set(); return arr.filter(x => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; }); };

console.log('== ① 引用了源码里不存在的名字 ==');
uniq(nameRefs, x => x.name).slice(0, 40).forEach(x => console.log(`${String(x.line).padStart(6)} 「${x.name}」  ← ${x.ctx}`));
console.log('== ② 设置 → X 的落点 ==');
uniq(settingRefs, x => x.target).slice(0, 30).forEach(x => console.log(`${String(x.line).padStart(6)} 设置→${x.target}  ← ${x.ctx}`));
console.log('== ③ 快捷键承诺 vs 实际绑定 ==');
console.log('已注册：', Array.from(binds).sort().join(' '));
uniq(hot, x => x.combo).slice(0, 30).forEach(x => console.log(`${String(x.line).padStart(6)} ${x.combo} ${binds.has(x.combo) ? 'OK' : '⚠ 未注册'}  ← ${x.ctx}`));
console.log('== ④ 数字承诺（人工核） ==');
uniq(nums, x => x.claim + x.ctx.slice(0, 12)).slice(0, 40).forEach(x => console.log(`${String(x.line).padStart(6)} ${x.claim}  ← ${x.ctx}`));
