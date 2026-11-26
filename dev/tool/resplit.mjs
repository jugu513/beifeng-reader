#!/usr/bin/env node
/* ⚠️  HISTORICAL / MIGRATION-ONLY（2026-11-25 真源反转 P1 后降级）——
   真源已反转：现在 src/ 是唯一编辑源，根 txt 由 build.mjs 生成。本脚本方向相反
   （根 txt → 重拆 src），日常**禁止**运行：它会用旧的母本覆盖 src 里的真源改动。
   仅当从「旧流程时代的母本」一次性迁移到 src 时才用，且用完必须确认 src 无本地改动。
   日常改母本的正确流程见 build.mjs 头部：编辑 src → build → deploy（或 selfcheck）。

   ——— 以下为遗留说明（历史用途，保留供迁移时参考）———
   从交付母本重拆 src/：把 9 块 CSS + script 正文按分区注释切成源码模块，重写模板占位符。
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

/* P1 后护栏：真源已反转到 src，本脚本方向相反、日常有害。
   必须显式带 --confirm-overwrite-src 才运行，防止误把旧母本盖回新 src。 */
if (!process.argv.includes('--confirm-overwrite-src')) {
  console.error('✗ resplit.mjs 已降级为迁移工具（真源已是 src/）。');
  console.error('  日常改母本请用：node tool/build.mjs && node tool/deploy.mjs（或 node tool/selfcheck.mjs）。');
  console.error('  确需从旧母本迁移到 src，才加 --confirm-overwrite-src 显式确认。');
  process.exit(2);
}

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
