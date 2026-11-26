/* 局部代码打磨候选排名（只读）：超长函数、渲染里的同步存储读、循环内 DOM 写、重复字面量阈值。 */
import fs from 'node:fs';
import { TARGET } from './patch.mjs';
const FILE = process.argv[2] || TARGET;
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');

/* 1) 函数定义起点：形如  BF.a.b = function  /  function name(  /  b: function (  */
const heads = [];
lines.forEach((l, i) => {
  let m = /^\s*(?:BF\.[A-Za-z0-9_.]+\s*=\s*|const\s+|let\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/.exec(l);
  if (m) { heads.push({ name: m[1], line: i + 1 }); return; }
  m = /^\s*(?:BF\.)?([A-Za-z0-9_.$]+)\s*[:=]\s*(?:async\s*)?function\s*\(/.exec(l);
  if (m) heads.push({ name: m[1], line: i + 1 });
});
const braceLen = start => {
  let depth = 0, i = start - 1, seen = false;
  for (; i < lines.length; i++) {
    const l = lines[i].replace(/'[^']*'|`[^`]*`|\/\*[\s\S]*?\*\/|\/\/.*$/g, '');
    for (const ch of l) { if (ch === '{') { depth++; seen = true; } else if (ch === '}') depth--; }
    if (seen && depth <= 0) return i - start + 2;
  }
  return 0;
};
const big = heads.map(h => ({ ...h, len: braceLen(h.line) })).filter(h => h.len >= 120)
  .sort((a, b) => b.len - a.len);
console.log('=== ≥120 行的函数（前 14）===');
big.slice(0, 14).forEach(h => console.log('  ' + h.len + ' 行  ' + h.name + ' @L' + h.line));

/* 2) 渲染函数内部的同步存储读：函数体里出现 lsGet/idbGetAll 且函数名含 render/paint */
const renderLike = heads.filter(h => /^(BF\.)?[A-Za-z0-9_.$]*(render|paint|refresh)[A-Za-z0-9_.$]*$/.test(h.name));
const risky = renderLike.map(h => {
  const body = lines.slice(h.line - 1, h.line - 1 + braceLen(h.line)).join('\n');
  const gets = (body.match(/lsGet\(|lsGetMemo\(|idbGetAll\(|JSON\.parse\(/g) || []).length;
  return { name: h.name, line: h.line, gets };
}).filter(r => r.gets >= 2).sort((a, b) => b.gets - a.gets);
console.log('=== 渲染路径里同步读 ≥2 次（前 10）===');
risky.slice(0, 10).forEach(r => console.log('  ' + r.gets + ' 次  ' + r.name + ' @L' + r.line));

/* 3) 循环内逐个 innerHTML += / insertAdjacentHTML（DOM 抖动） */
const churn = [];
lines.forEach((l, i) => {
  if (/insertAdjacentHTML\(|innerHTML\s*\+=/.test(l)) churn.push(i + 1);
});
console.log('=== 循环内 DOM 追加式写入落点 ===');
console.log('  ' + churn.length + ' 处：' + churn.slice(0, 12).join(', '));
