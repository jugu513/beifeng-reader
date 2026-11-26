/* 只读：找「大段重复」——规范化后的连续 K 行窗口哈希相同即一组。
   规范化 = 去注释、去行首尾空白、丢空行，所以只差注释/缩写的近似重复也能抓到。
   用法：node tool/dup-scan.mjs [窗口行数=18] [文件] */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { TARGET } from './patch.mjs';

const HERE = path.resolve(import.meta.dirname, '..');
/* 参数自证：只给一个非数字位置参数时，视作文件而非窗口行数——
   旧版静默把它当 K，回退默认文件，比对两版时会给出与声称无关的假绿。 */
const a2 = process.argv[2] || '', a3 = process.argv[3] || '';
const K = a2 && /^\d+$/.test(a2) ? Number(a2) : 18;
const fileArg = /^\d+$/.test(a2) ? a3 : (a2 || a3 || '');
const FILE = fileArg ? path.resolve(HERE, fileArg) : TARGET;
const src = fs.readFileSync(FILE, 'utf8');
/* 每次输出都带「实际读了哪个文件 + 它的 md5」——比对类工具不自证就等于没检查。 */
const md5 = crypto.createHash('md5').update(src).digest('hex');
console.log(`[输入] ${path.relative(HERE, FILE)} · md5 ${md5} · ${src.split('\n').length - 1} 行`);

/* 注释挖空：直接借 tool/strip-comments.mjs 的口径（同一套切分） */
const spans = [];
for (const m of src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) spans.push({ kind: 'css', from: m.index + m[0].indexOf('>') + 1, body: m[1] });
for (const m of src.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)) {
  if (/src\s*=/i.test(m[1])) continue;
  spans.push({ kind: 'js', from: m.index + m[0].indexOf('>') + 1, body: m[2] });
}
const spanOffset = new Set();
for (const s of spans) for (let i = s.from; i < s.from + s.body.length; i++) spanOffset.add(i);
const cuts = [];
function commentsIn(body, base, kind) {
  let i = 0, prevSig = '';
  const push = (a, b) => { if (b > a) cuts.push([base + a, base + b]); };
  while (i < body.length) {
    const c = body[i];
    if (c === '"' || c === "'") { const q = c; i++; while (i < body.length && body[i] !== q) { if (body[i] === '\\') i++; i++; } i++; prevSig = 'x'; continue; }
    if (c === '`') { i++; while (i < body.length && body[i] !== '`') { if (body[i] === '\\') i++; i++; } i++; prevSig = 'x'; continue; }
    if (c === '/' && body[i + 1] === '/') { let e = body.indexOf('\n', i); if (e < 0) e = body.length; push(i, e); i = e; continue; }
    if (c === '/' && body[i + 1] === '*') { const e = body.indexOf('*/', i + 2); const stop = e < 0 ? body.length : e + 2; push(i, stop); i = stop; continue; }
    if (kind === 'js' && c === '/' && (prevSig === '' || /[=(,:[{;&|!?+\-*%<>]$/.test(prevSig))) {
      const save = i; i++; let cls = false, ok = false;
      while (i < body.length) {
        const d = body[i];
        if (d === '\\') { i += 2; continue; }
        if (d === '\n') break;
        if (d === '[') cls = true; else if (d === ']') cls = false;
        else if (d === '/' && !cls) { ok = true; i++; break; }
        i++;
      }
      if (ok) { while (i < body.length && /[a-z]/.test(body[i])) i++; prevSig = 're'; continue; }
      i = save;
    }
    if (/[A-Za-z0-9_$.]/.test(c)) { let j = i; while (j < body.length && /[A-Za-z0-9_$.]/.test(body[j])) j++; prevSig = body.slice(i, j); i = j; continue; }
    if (/\s/.test(c)) { i++; continue; }
    prevSig = c; i++;
  }
}
for (const s of spans) commentsIn(s.body, s.from, s.kind);
for (const m of src.matchAll(/<!--([\s\S]*?)-->/g)) { if (!spanOffset.has(m.index)) cuts.push([m.index, m.index + m[0].length]); }
cuts.sort((a, b) => a[0] - b[0]);

const lines = src.split('\n');
const lineStarts = [0];
for (let i = 0; i < lines.length; i++) lineStarts.push(lineStarts[i] + lines[i].length + 1);
const lineOf = (off) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStarts[m] <= off) lo = m; else hi = m - 1; } return lo; };
const masked = new Uint8Array(lines.length);
for (const [a, b] of cuts) { const s = lineOf(a), e = lineOf(b); for (let l = s; l <= e && l < lines.length; l++) if (lineStarts[l] >= a && lineStarts[l] < b) masked[l] = 1; }

const rows = [];
for (let i = 0; i < lines.length; i++) {
  if (masked[i]) continue;
  let t = lines[i].replace(/\s+/g, ' ').trim();
  if (!t || /^[{}();,]+$/.test(t)) { rows.push({ ln: i + 1, norm: '' }); continue; }
  rows.push({ ln: i + 1, norm: t });
}
/* 滑窗：只在连续非空有效行上累计，遇到 norm==='' 作为占位仍计入，保持行号对齐 */
const groups = new Map();
for (let i = 0; i + K <= rows.length; i++) {
  let sig = '', useful = 0, meat = 0;
  for (let j = i; j < i + K; j++) { if (rows[j].norm) { sig += rows[j].norm + '\n'; useful++; if (/[A-Za-z_$]{3}/.test(rows[j].norm) && rows[j].norm.length > 12) meat++; } }
  if (useful < K || meat < K * 0.6) continue;
  if (!groups.has(sig)) groups.set(sig, []);
  groups.get(sig).push([rows[i].ln, rows[i + K - 1].ln]);
}
const hits = [...groups.entries()].filter(([, v]) => v.length > 1);
/* 每个重复组报「出现位置 + 可向下延伸到多长」：
   同一条重复会连续命中很多窗口，取首尾两次出现的最长公共前缀即块长。 */
const blocks = [];
for (const [, v] of hits) {
  v.sort((a, b) => a[0] - b[0]);
  if (v.length < 2) continue;
  const a = v[0][0], b = v[1][0];
  let len = K;
  while (a + len - 1 < lines.length && b + len - 1 < lines.length &&
    (lines[a + len - 1] || '').replace(/\s+/g, ' ').trim() === (lines[b + len - 1] || '').replace(/\s+/g, ' ').trim()) len++;
  blocks.push({ a, b, len, n: v.length });
}
blocks.sort((x, y) => y.len - x.len);
console.log('窗口 ' + K + ' 行 · 重复组 ' + blocks.length + ' 处（列前 25）');
for (const b of blocks.slice(0, 25)) console.log('  L' + b.a + ' 与 L' + b.b + ' 起 · 同 ' + b.len + ' 行  | ' + (lines[b.a - 1] || '').trim().slice(0, 64));
