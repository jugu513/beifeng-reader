/* 只读取证：把注释正文挖空后输出「纯代码」渲染，用于证明清扫轮没有动过代码。
   用法：node tool/strip-comments.mjs <file> > out ；再对两份 out 做 diff。
   切分逻辑与 scan-comments.mjs / gate 同一组正则，保证看到的是同一份字节。 */
import fs from 'node:fs';

const FILE = process.argv[2];
const src = fs.readFileSync(FILE, 'utf8');

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
  const push = (start, end) => { if (end > start) cuts.push([base + start, base + end]); };
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
for (const m of src.matchAll(/<!--([\s\S]*?)-->/g)) {
  if (spanOffset.has(m.index)) continue;
  cuts.push([m.index, m.index + m[0].length]);
}

cuts.sort((a, b) => a[0] - b[0]);
let out = '', last = 0;
for (const [a, b] of cuts) {
  if (a < last) continue;
  out += src.slice(last, a) + '§';
  last = b;
}
out += src.slice(last);
process.stdout.write(out.split('\n').map(l => l.replace(/§/g, '').replace(/\s+$/g, '')).join('\n') + '\n');
