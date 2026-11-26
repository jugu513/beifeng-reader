/* 皮肤令牌对比度复算（独立实现，用来验外部交回件的自报表）
   从母本/副本里抠 BF.XXX_TOKENS 块，按八对判据实算：
     正文/底 次要/底 正文/面板 次要/输入底 正文/阅读底(mix 82%) 强调/底(≥3) CTA前景/强调底 控件边界/底(≥3)
   用法：node beifeng/aa-skins.mjs [文件]   默认 ../北风V0.0.1-alpha.txt */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TARGET } from './patch.mjs';

const FILE = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : TARGET;
const src = fs.readFileSync(FILE, 'utf8');

function parse(v) {
  v = String(v == null ? '' : v).trim();
  let m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/.exec(v);
  if (m) return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
  if (v[0] === '#') {
    let h = v.slice(1);
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  return null;
}
function over(fg, bg) { const F = parse(fg), B = parse(bg); if (!F || !B) return null; if (F[3] === 1) return F.slice(0, 3); return [0, 1, 2].map(i => Math.round(F[i] * F[3] + B[i] * (1 - F[3]))); }
function lum(c) { const k = c.map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * k[0] + 0.7152 * k[1] + 0.0722 * k[2]; }
function ratioC(a, b) { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); }
function ratio(fg, bg) { const a = over(fg, bg), b = parse(bg); if (!a || !b) return null; return ratioC(a, b); }
function mix(c1, c2, k) { const A = parse(c1), B = parse(c2); if (!A || !B) return null; return 'rgb(' + [0, 1, 2].map(i => Math.round(A[i] * k + B[i] * (1 - k))).join(',') + ')'; }

/* 抠 BF.<NAME>_TOKENS = { ... }; 块 */
const skins = [];
const re = /BF\.([A-Z]+)_TOKENS = \{([\s\S]*?)\n\s*\};/g;
let m;
while ((m = re.exec(src))) {
  const body = m[2];
  const t = {};
  body.replace(/'(--[a-z0-9-]+)'\s*:\s*'([^']*)'/g, (_, k, v) => { t[k] = v; return ''; });
  if (m[1] === 'SKIN') continue;   /* SKIN_TOKENS 是映射表不是色板 */
  skins.push({ id: m[1].toLowerCase(), t });
}
if (!skins.length) { console.error('没抠到 *_TOKENS 块'); console.error('档数 0 · 失败 0'); process.exit(1); }

/* 色板按口径**不写 --accent**（换肤换纸墨、不换印章：强调色跨档恒定，
   由主题作用域供给）。所以这里必须从作用域把继承值取回来，
   否则五套色板全部「无法判定」——判的是工具的取数方式，不是色板。 */
function scopeBlocks(sel) {
  /* 同一选择器可能出现多次（`:root { color-scheme: dark; }` 就单独一条），
     取第一条等于取到空壳 —— 所以把所有块都交出去，由调用方挑含目标键的那块。 */
  const out = [];
  let from = 0;
  for (;;) {
    const i = src.indexOf(sel + ' {', from);
    if (i < 0) break;
    const j = src.indexOf('}', i);
    if (j < 0) break;
    out.push(src.slice(i, j));
    from = j + 1;
  }
  return out;
}
function pick(sel, key) {
  for (const block of scopeBlocks(sel)) {
    const m = new RegExp('--' + key + ':\\s*([^;\\n]+)').exec(block);
    if (m) return m[1].trim();
  }
  return null;
}
const AXIS_BASE = {
  dark: { accent: pick(':root', 'accent'), ink: pick(':root', 'accent-ink') },
  light: { accent: pick('body.light', 'accent'), ink: pick('body.light', 'accent-ink') },
};
const axisOf = (t) => {
  const c = parse(t['--bg']);
  if (!c) return 'dark';
  return lum(c) < 0.2 ? 'dark' : 'light';
};
/* var(--x) 别名解一层（--*-ink 都指向同族主色，不解就判不了） */
function deref(t, v, depth) {
  if (v == null || depth > 4) return v;
  const m = /^var\((--[a-z0-9-]+)\)$/.exec(String(v).trim());
  return m ? deref(t, t[m[1]] || AXIS_ALL[m[1]], depth + 1) : v;
}
const AXIS_ALL = {};
for (const s of skins) { /* 色板内部互相引用先并进来 */ Object.keys(s.t).forEach(k => { if (!(k in AXIS_ALL)) AXIS_ALL[k] = s.t[k]; }); }
for (const k of ['accent', 'accent-ink']) for (const ax of ['dark', 'light']) if (AXIS_ALL['--' + k] == null && AXIS_BASE[ax][k]) AXIS_ALL['--' + k] = AXIS_BASE[ax][k];
for (const s of skins) {
  const base = AXIS_BASE[axisOf(s.t)];
  if (!s.t['--accent'] && base.accent) s.t['--accent'] = base.accent;
  if (!s.t['--accent-ink'] && (base.ink || base.accent)) s.t['--accent-ink'] = base.ink || base.accent;
}

const PAIRS = [
  ['正文/底', '--text', '--bg', 4.5],
  ['次要/底', '--text-dim', '--bg', 4.5],
  ['弱化/底', '--text-weak', '--bg', 4.5],
  ['正文/面板', '--text', '--bg-panel', 4.5],
  ['次要/输入底', '--text-dim', '--bg-input', 4.5],
  ['正文/阅读底', '--text', '@reader', 4.5],
  ['强调文字/底', '--accent-ink', '--bg', 4.5],
  ['强调/底', '--accent', '--bg', 3],
  ['CTA前景/强调底', '--brand-fg', '--accent', 4.5],
  ['控件边界/底', '--border-strong', '--bg', 3],
  /* 弱化文本（占位符、次级说明）确实落在输入底上，这一对必须一起判：
     只判「弱化/底」会漏掉最暗的那档背景是输入底的情形。 */
  ['弱化/输入底', '--text-weak', '--bg-input', 4.5],
  ['弱化/面板', '--text-weak', '--bg-panel', 4.5],
];

let fails = 0;
for (const s of skins) {
  const t = s.t;
  const reader = mix(t['--bg-reader'], t['--reader-tint'], 0.82);
  const bad = [];
  const vals = [];
  for (const [label, fk, bk, line] of PAIRS) {
    const bg = bk === '@reader' ? reader : deref(t, t[bk], 0);
    const fg = deref(t, t[fk], 0);
    if (!bg || !fg || String(fg).startsWith('var(') || String(bg).startsWith('var(')) { bad.push(label + ' 无法判定(' + (fg || '缺') + ')'); continue; }
    const r = ratio(fg, bg);
    if (r == null) { bad.push(label + ' 非法色值 ' + fg + '|' + bg); continue; }
    vals.push(label + ' ' + r.toFixed(2));
    if (r < line) bad.push(label + ' ' + r.toFixed(2) + ' < ' + line);
  }
  if (bad.length) fails++;
  console.log((bad.length ? 'FAIL ' : 'PASS ') + s.id.padEnd(10) + (bad.length ? '\n       ' + bad.join('\n       ') : '\n       ' + vals.join(' · ')));
}
console.log('\n档数 ' + skins.length + ' · 失败 ' + fails);
