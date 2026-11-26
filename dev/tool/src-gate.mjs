#!/usr/bin/env node
/* 方案B · src 源码结构闸门
   与 build-check.mjs 的职责边界（严格不重叠）：
     · build-check：build.mjs 构建 → 与八份副本逐字节/md5 一致。守「产物还原」。
     · src-gate（本闸）：守 build-check 抓不到的「结构幽灵」：
         a) 孤儿段文件——src/script/NNN.js 存在但模板无对应占位符，不参与构建，
            build-check 照样全绿，但它是第二份没被守护的源码，改了不生效、删了没人知道；
         b) 占位符断号/重复/CSS 位数不对——构建时会抛，但独立门禁给可读诊断；
         c) 顶层 BF.xxx 命名空间在段里被整体赋值多次——mirror gate ⑰ 但定位到段文件，
            为 2b 分层归类准备（分层后同一命名空间若被两层各赋一次，就是静默抹除）。
   只读、不改任何文件、不构建。退出码 0=结构干净，1=有幽灵。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './patch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const TPL = path.join(SRC, 'index.template.html');
const SEGDIR = path.join(SRC, 'script');

const bad = [];
if (!fs.existsSync(TPL)) { console.error('✗ 模板缺失：' + TPL); process.exit(1); }
const tpl = fs.readFileSync(TPL, 'utf8');

// --- a/b) 占位符与段文件一一对应 ---
const scriptPhs = [...tpl.matchAll(/\{\{SCRIPT_(\d{3})\}\}/g)].map((m) => m[1]);
const stylePhs = [...tpl.matchAll(/\{\{STYLE_(\d{2})\}\}/g)].map((m) => m[1]);
const expectedScript = Array.from({ length: scriptPhs.length }, (_, i) => String(i).padStart(3, '0'));
if (!scriptPhs.length) bad.push('模板无 SCRIPT 占位符');
else if (scriptPhs.join(',') !== expectedScript.join(',')) {
  bad.push(`SCRIPT 占位符非 000 起连续：实得 ${scriptPhs[0]}..${scriptPhs.at(-1)} 共 ${scriptPhs.length} 个`);
}
if (stylePhs.join(',') !== Array.from({ length: 9 }, (_, i) => String(i + 1).padStart(2, '0')).join(',')) {
  bad.push(`STYLE 占位符应为 01..09 各一次，实得 ${stylePhs.join(',') || '(无)'}`);
}
// 畸形占位符（位数不对）也是幽灵
const malformed = tpl.match(/\{\{(?:SCRIPT|STYLE)_\d+\}\}/g) || [];
const wellFormed = new Set([...scriptPhs.map((n) => '{{SCRIPT_' + n + '}}'), ...stylePhs.map((n) => '{{STYLE_' + n + '}}')]);
const malformedOnly = malformed.filter((p) => !wellFormed.has(p));
if (malformedOnly.length) bad.push('畸形占位符（位数不对）：' + [...new Set(malformedOnly)].join(','));

const segFiles = fs.existsSync(SEGDIR)
  ? fs.readdirSync(SEGDIR).filter((f) => /^\d{3}\.js$/.test(f)).map((f) => f.slice(0, 3)).sort()
  : [];
const phSet = new Set(scriptPhs), segSet = new Set(segFiles);
const orphanSeg = segFiles.filter((n) => !phSet.has(n));
const missingSeg = scriptPhs.filter((n) => !segSet.has(n));
if (orphanSeg.length) bad.push('孤儿段文件（模板不引用）：' + orphanSeg.map((n) => n + '.js').join(','));
if (missingSeg.length) bad.push('缺段文件：' + missingSeg.map((n) => n + '.js').join(','));
// 段文件里有没有非 NNN.js 的杂项（README/备份/临时稿）
const junk = fs.existsSync(SEGDIR)
  ? fs.readdirSync(SEGDIR).filter((f) => !/^\d{3}\.js$/.test(f))
  : [];
if (junk.length) bad.push('script/ 下非段文件：' + junk.join(','));

// --- c) 顶层 BF.xxx 整体赋值唯一归属（定位到段） ---
const nsOwner = new Map();
const dupNs = [];
if (!junk.length) for (const n of segFiles) {
  const seg = fs.readFileSync(path.join(SEGDIR, n + '.js'), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '');
  for (const m of seg.matchAll(/^ {0,2}BF\.([A-Za-z_$][\w$]*)\s*=\s*[({]/gm)) {
    const ns = m[1];
    if (nsOwner.has(ns) && nsOwner.get(ns) !== n) dupNs.push(`${ns}（${nsOwner.get(ns)}.js 与 ${n}.js）`);
    else nsOwner.set(ns, n);
  }
}
if (dupNs.length) bad.push('命名空间跨段整体赋值（后写抹前写）：' + dupNs.join(', '));

const ok = bad.length === 0;
console.log(ok
  ? `✓ src 结构干净：${scriptPhs.length} 段 / ${stylePhs.length} 块 CSS · 占位符连续 · 无孤儿段 · 命名空间归属唯一（${nsOwner.size} 个）`
  : '✗ src 结构有幽灵：\n  - ' + bad.join('\n  - '));
process.exit(ok ? 0 : 1);
