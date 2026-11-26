/* 只读：找「定义了但全文件零引用」的函数/方法。
   口径保守：统计整份文件（含字符串、手册文案、DSL 代码样例）里出现次数，
   只报次数 == 1 的，即连文案都没提到它。闸门管不到 JS 侧，这一层靠本器补。
   用法：node tool/dead-fn.mjs [文件] */
import fs from 'node:fs';
import path from 'node:path';

import { ROOT, TARGET } from './patch.mjs';
const FILE = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : TARGET;
const src = fs.readFileSync(FILE, 'utf8');

const defs = new Map();
/* A. BF.<a>.<b> = function / = ( / = async function */
for (const m of src.matchAll(/\b(BF\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*=\s*(?:async\s+)?function\b/g)) {
  defs.set(m[1], (defs.get(m[1]) || 0) + 1);
}
/* B. 对象字面量里的方法：  name: function / name(args) { / async name( */
const methods = new Map();
for (const m of src.matchAll(/^\s{2,}(?:async\s+)?([A-Za-z_$][\w$]*)\s*:\s*(?:async\s*)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/gm)) {
  methods.set(m[1], (methods.get(m[1]) || 0) + 1);
}

const count = (name) => {
  let n = 0, i = 0;
  const re = new RegExp('(?<![\\w$.])' + name.replace(/\./g, '\\.') + '(?![\\w$])', 'g');
  while ((i = re.exec(src)) !== -1) { n++; if (n > 40) break; }
  return n;
};

const lineStarts = [0];
for (let i = 0; i < src.length; i++) if (src[i] === '\n') lineStarts.push(i + 1);
const lineOf = (off) => { let lo = 0, hi = lineStarts.length - 1; while (lo < hi) { const m = (lo + hi + 1) >> 1; if (lineStarts[m] <= off) lo = m; else hi = m - 1; } return lo + 1; };
const firstLine = new Map();
for (const m of src.matchAll(/\b(BF\.[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+)\s*=\s*(?:async\s+)?function\b/g)) {
  if (!firstLine.has(m[1])) firstLine.set(m[1], lineOf(m.index));
}

const dead = [];
for (const key of defs.keys()) if (count(key) <= 1) dead.push([key, firstLine.get(key)]);
dead.sort((a, b) => a[1] - b[1]);
console.log('BF.* 函数定义 ' + defs.size + ' 个 · 全文件零引用 ' + dead.length + ' 个');
for (const [k, l] of dead) console.log('  L' + l + '  ' + k);

/* 方法名（对象字面量内）单独一档：同名太常见，只报整词出现次数 == 1 的 */
const deadM = [];
for (const name of methods.keys()) if (count(name) <= 1) deadM.push(name);
console.log('\n对象方法名 ' + methods.size + ' 个 · 整词只出现一次（即只有定义行）' + deadM.length + ' 个：' + deadM.join('、'));
