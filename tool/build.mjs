#!/usr/bin/env node
/* 方案B构建脚本 —— 2026-11-25 起为「母本唯一生成入口」（真源反转 P1）。
   无第三方依赖：读 src/index.template.html + src/styles/NN.css + src/script/NNN.js，替换占位符，产出单文件。
   设计约束：
   - 所有文件用 UTF-8 原样读写，newline 不做任何转换（保持字节级一致）。
   - 占位符 {{STYLE_NN}} 各出现且仅出现一次；{{SCRIPT_NNN}} 按 000..N 连续出现，缺/多/断号即报错。
   - 默认产出到仓库根的 北风V0.0.1-alpha.txt（唯一编辑真源已反转到 src/，根 txt 变成构建产物）；
     显式传参数1则产出到指定路径——build-check.mjs 用后者构建到临时文件做字节比对，不受默认改变影响。
   - 只读 src/，唯一写点是参数指定的输出文件。日常改母本的正确流程：
     编辑 src/ → node tool/build.mjs（生成根 txt）→ node tool/deploy.mjs（同步五份）——
     或直接 node tool/selfcheck.mjs（⓪ 已把 build+deploy 串起来）。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './patch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(ROOT, 'src');
const TEMPLATE = path.join(SRC, 'index.template.html');
const OUT = process.argv[2] ? path.resolve(process.argv[2]) : path.join(ROOT, '北风V0.0.1-alpha.txt');

const tpl = fs.readFileSync(TEMPLATE, 'utf8');
let out = tpl;
for (let i = 1; i <= 9; i++) {
  const ph = '{{STYLE_' + String(i).padStart(2, '0') + '}}';
  const cssFile = path.join(SRC, 'styles', String(i).padStart(2, '0') + '.css');
  if (!fs.existsSync(cssFile)) throw new Error('缺 CSS 模块：' + cssFile);
  const css = fs.readFileSync(cssFile, 'utf8');
  const hits = out.split(ph).length - 1;
  if (hits !== 1) throw new Error(`占位符 ${ph} 命中 ${hits} 次，期望 1——模板可能被手改`);
  out = out.replace(ph, () => css);
}
// script 段：占位符必须 000..N 连续、各一次；段文件必须齐全
const scriptPhs = [...out.matchAll(/\{\{SCRIPT_(\d{3})\}\}/g)].map((m) => m[1]);
if (!scriptPhs.length) throw new Error('模板无 script 占位符——请先跑 node tool/resplit.mjs');
const expected = Array.from({ length: scriptPhs.length }, (_, i) => String(i).padStart(3, '0'));
if (scriptPhs.join(',') !== expected.join(',')) {
  throw new Error(`script 占位符非 000 起连续：实得 ${scriptPhs[0]}..${scriptPhs.at(-1)} 共 ${scriptPhs.length} 个`);
}
out = out.replace(/\{\{SCRIPT_(\d{3})\}\}/g, (full, n) => {
  const segFile = path.join(SRC, 'script', n + '.js');
  if (!fs.existsSync(segFile)) throw new Error('缺 script 段：' + segFile);
  return fs.readFileSync(segFile, 'utf8');
});

// 确认无残留占位符：用宽松形态 \{{\w+\d+\}\}，畸形位数（如 SCRIPT_0000）也算残留，
// 不能因为正则只认恰好 3/2 位就放它过去——模板被手改出畸形占位符时必须报错。
const leftover = out.match(/\{\{[A-Z_]+\d+\}\}/g);
if (leftover) throw new Error('构建后仍有残留占位符：' + leftover.join(','));

fs.writeFileSync(OUT, out, 'utf8');
const buf = fs.readFileSync(OUT);
console.log('构建完成：' + OUT);
console.log('字节：' + buf.length + ' · 行：' + (out.match(/\n/g) || []).length);
