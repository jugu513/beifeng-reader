#!/usr/bin/env node
/* 从交付母本重拆 src/：把 9 块 CSS + script 正文按分区注释切成源码模块，重写模板占位符。
   合法改产物流程：改根 txt → deploy → 本脚本重拆 src → build-check 必须全绿。
   约束：只读根 txt 与模板，按字节原样切分，拼回应逐字节等于母本（由 build-check 守护）。
   script 段命名 src/script/NNN.js（3 位），HEAD 段为 000.js，其后按分区顺序。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { ROOT } from './patch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const MASTER = path.join(ROOT, '北风V0.0.1-alpha.txt');
const TPL = path.join(SRC, 'index.template.html');
const md5 = (p) => crypto.createHash('md5').update(fs.readFileSync(p)).digest('hex');

const master = fs.readFileSync(MASTER, 'utf8');
let tpl = fs.readFileSync(TPL, 'utf8');
const before = md5(TPL);

// ---------- 1) 9 块 CSS 重拆（若模板已是占位符则跳过内容重拆，仅保证占位符在位） ----------
// CSS 占位符必须各出现一次
for (let i = 1; i <= 9; i++) {
  const ph = '{{STYLE_' + String(i).padStart(2, '0') + '}}';
  const hits = tpl.split(ph).length - 1;
  if (hits !== 1) throw new Error(`模板 CSS 占位符 ${ph} 命中 ${hits} 次——第一步 CSS 拆分未就绪`);
}

// ---------- 2) script 正文定位与切分 ----------
const mOpen = master.indexOf('<script>');
const mClose = master.indexOf('</script>', mOpen);
if (mOpen < 0 || mClose < 0) throw new Error('母本 script 边界定位失败');
const body = master.slice(mOpen + '<script>'.length, mClose);

// 模板里 script 块当前应仍是整块（未含 SCRIPT 占位符）；若已含则以母本为准重建
const tOpen = tpl.indexOf('<script>');
const tClose = tpl.indexOf('</script>', tOpen);
if (tOpen < 0 || tClose < 0) throw new Error('模板 script 边界定位失败');

const lines = body.split('\n');
const re = /^\/\*\s*=+\s/;
const marks = [];
let acc = 0;
for (const ln of lines) {
  if (re.test(ln)) marks.push(acc);
  acc += ln.length + 1;
}
const cuts = [];
if (marks[0] > 0) cuts.push([0, marks[0]]);
for (let i = 0; i < marks.length; i++) {
  cuts.push([marks[i], i + 1 < marks.length ? marks[i + 1] : body.length]);
}

// 拼回自检（任何手工篡改切分逻辑都会在此暴露）
if (cuts.map(([s, e]) => body.slice(s, e)).join('') !== body) throw new Error('切分拼接不自洽，拒绝写入');

const scriptDir = path.join(SRC, 'script');
fs.mkdirSync(scriptDir, { recursive: true });
// 清空旧段，避免陈旧文件残留
for (const f of fs.readdirSync(scriptDir)) if (/^\d{3}\.js$/.test(f)) fs.unlinkSync(path.join(scriptDir, f));

cuts.forEach(([s, e], i) => {
  fs.writeFileSync(path.join(scriptDir, String(i).padStart(3, '0') + '.js'), body.slice(s, e), 'utf8');
});

const phs = cuts.map((_, i) => '{{SCRIPT_' + String(i).padStart(3, '0') + '}}').join('');
// body 以 <script> 后的换行符开头，不能再手工加 '\n'
const newTpl = tpl.slice(0, tOpen + '<script>'.length) + phs + tpl.slice(tClose);
fs.writeFileSync(TPL, newTpl, 'utf8');

console.log(JSON.stringify({
  masterMd5: md5(MASTER),
  tplBefore: before.slice(0, 12),
  tplAfter: md5(TPL).slice(0, 12),
  scriptBytes: Buffer.byteLength(body, 'utf8'),
  scriptLines: lines.length,
  segments: cuts.length,
  templateChanged: before !== md5(TPL),
}, null, 2));
