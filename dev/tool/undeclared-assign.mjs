/* 未声明标识符赋值扫描（只读，不进产品、不进闸门）
   为什么需要它：`node --check` 只判语法。`_foo = true` 里 `_foo` 从没声明过，
   语法完全合法——非严格模式下悄悄造一个全局（行为漂移），严格模式下运行才炸
   ReferenceError。本项目母本没有 'use strict'，所以这类错**只在真机跑到那条分支时**
   才露头：本工具上线当天就抓到一次「删了变量声明、漏了它的赋值」，
   而 18 项闸门全绿、91 条测试全绿。

   判据是刻意宽松的：凡出现在 const/let/var/function/catch 任一行的标识符都算「声明过」。
   宽松到几乎不会假阳性（实测全母本 0 条），代价是可能漏掉「声明在别的行、名字撞车」的
   极端情形——宁可漏，也不留一条天天红、下一个人只能选择忽略的判据。

   只看语句级、下划线开头的赋值（本项目的模块私有变量约定）：
   属性访问（`a.b =`）、对象解构、普通局部变量一律不算，避免把界面代码扫成噪声。 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, TXT } from './patch.mjs';

const file = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : TXT;
const src = fs.readFileSync(file, 'utf8');
const m = src.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('找不到内联 script：' + file); process.exit(2); }
const lines = m[1].split('\n');

const declared = new Set();
for (const l of lines) {
  if (/\b(const|let|var|function|catch)\b/.test(l)) {
    for (const d of l.matchAll(/[A-Za-z_$][\w$]*/g)) declared.add(d[0]);
  }
}

const hits = [];
lines.forEach((l, i) => {
  for (const seg of l.split(';')) {
    const t = seg.match(/^\s*(_[A-Za-z_$0-9]*)\s*(?:=|\+=|-=|\*=|\/=|%=|\|=|&=|\^=|<<=|>>=|\|\|=|&&=|\?\?=)\s*(?!=)/);
    if (t && !declared.has(t[1])) hits.push({ line: i + 1, name: t[1], text: seg.trim().slice(0, 78) });
  }
});

console.log(`扫描 ${file}`);
console.log(`未声明的 _前缀 语句级赋值：${hits.length} 处`);
hits.slice(0, 40).forEach(h => console.log(`  行 ${h.line}  <<${h.name}>>  ${h.text}`));
process.exit(hits.length ? 1 : 0);
