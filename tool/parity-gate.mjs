#!/usr/bin/env node
/* 新题型原型 · 契约一致闸门（Parity Gate）
   ────────────────────────────────────────────────────────────────
   题型定义：纵向对账（fact-check）比的是「文案宣称 vs 代码真值」——一端是叙述、一端是事实，
             只有一个真值。横向 parity 比的是「同一逻辑事实在 N 处独立声明」——没有天然的
             真值，任何一处改了而别处没跟上，就是静默漂移。本闸门把每个事实族的 N 处声明点
             抽成集合，要求全相等；不等即报，且指出谁多谁少。

   为什么要这个题型：本项目事故反复出在"一张表加了、另一张表没加"——
             edgeToken 补进 PRIV_KEYS、aiPrompts 补进 reset 保留、paper 补进 readerFilter
             下拉——都是改一处漏一处。现有 19 闸门只验"存在"或"数量"，不验"跨点相等"。

   边界（刻意不做）：
     · 只读，不写母本、不进产品（遵守项目记忆 §4）；
     · 不判定"哪处对"，只报"不一致"——修哪处由 owner 拍板；
     · SPEC 里的声明点是"抽取器"，抽取失败（锚点找不到）单独报，不静默当作空集。

   用法：node tool/parity-gate.mjs [母本路径]
   退出码：当前恒 0（原型/清单性质，与 fact-check 一致）；加 --strict 后不一致退 1。 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, TARGET } from './patch.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const fileArg = argv.find((a) => !a.startsWith('--'));
const FILE = fileArg ? path.resolve(ROOT, fileArg) : TARGET;
if (!fs.existsSync(FILE)) { console.error('找不到母本：' + FILE); process.exit(2); }
const src = fs.readFileSync(FILE, 'utf8');

/* ---------- 抽取原语 ---------- */
function slice(from, until) {
  const i = src.indexOf(from);
  if (i < 0) return null;
  const j = until ? src.indexOf(until, i) : -1;
  return j < 0 ? src.slice(i, i + 3000) : src.slice(i, j);
}
const quoted = (s) => (s.match(/'[^']*'|"[^"]*"/g) || []).map((x) => x.slice(1, -1));
const pairs = (s) => [...s.matchAll(/\[\s*'([^']+)'\s*,\s*'([^']*)'\s*\]/g)].map((m) => m[1]);
/* schema 行：从「<field>: { cn:」锚点到行尾，避免误命中 CSS 的 --accent: */
const schemaOpts = (field) => {
  const re = new RegExp('\\b' + field + ':\\s*\\{\\s*cn:.*$', 'm');
  const m = src.match(re);
  return m ? pairs(m[0]) : null;
};
/* 对象表键：取 { ... } 内每个「行首 键:」形式的键，跳过注释里的行 */
const objKeys = (from, until) => {
  const s = slice(from, until);
  if (!s) return null;
  const body = s.replace(/\/\*[\s\S]*?\*\//g, '');
  // 同时支持多行「^  键:」和单行「{ 键: v, 键: v }」；用 \b 边界排除冒号后的 CSS 伪类等
  const keys = [...body.matchAll(/(?:^|[,{])\s*([a-z][\w-]*)\s*:\s*['"'"'"#\d]/gm)].map((m) => m[1]);
  return [...new Set(keys)];
};

/* 一个声明点 = {name, get(): string[] | null}
   null 表示锚点没找到（抽取失败），与空数组 []（找到但没有成员）区分。 */
const SPEC = [
  {
    family: '外观档位（appearance 的合法值）',
    why: '记忆 §9：加一档皮肤要改多处；gate⑮ 只守登记表自身数量，不守消费端是否对齐',
    points: [
      { name: 'BF.SKINS 登记表', get: () => { const s = slice('BF.SKINS = [', '];'); return s && quoted(s); } },
      { name: 'BF.SKIN_LABELS 键', get: () => objKeys('BF.SKIN_LABELS = {', '};') },
    ],
  },
  {
    family: '强调色（accent 的合法值）',
    why: 'ACCENTS 表 + schema opts + 设置下拉三处手抄同一组色名',
    points: [
      { name: 'ACCENTS 表键', get: () => { const s = slice('const ACCENTS = {', '};'); return s && [...s.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/^\s{2}([a-z]+)\s*:\s*\{/gm)].map((m) => m[1]); } },
      { name: 'schema accent.opts', get: () => schemaOpts('accent') },
      /* T2：accent 从下拉改成色块点选，合法值移到 _accentSwatches 的 opts 表。
         两个锚点都认（新优先、旧回退），保证回退 AB2 后闸门仍能工作；仍须与另两处相等。 */
      { name: '设置面板 accent 控件', get: () => { const n = slice("BF.settingsUI._accentSwatches = function", "};"); const s = n || slice("_sel('accent'", ')) +'); return s && pairs(s); } },
    ],
  },
  {
    family: '阅读滤镜（readerFilter 的合法值）',
    why: 'schema opts 与设置面板下拉各抄一份；本轮 paper 就是补进这两处才修好',
    points: [
      { name: 'schema readerFilter.opts', get: () => schemaOpts('readerFilter') },
      { name: '设置面板 readerFilter 下拉', get: () => { const s = slice("_sel('readerFilter'", ')) +'); return s && pairs(s); } },
    ],
  },
  {
    family: '色温（warmth 的合法值）',
    why: 'schema opts 与设置面板下拉各抄一份',
    points: [
      { name: 'schema warmth.opts', get: () => schemaOpts('warmth') },
      { name: '设置面板 warmth 下拉', get: () => { const s = slice("_sel('warmth'", ')) +'); return s && pairs(s); } },
    ],
  },
];

/* ---------- 比对 ---------- */
const norm = (xs) => [...new Set(xs)].sort().join(',');
let diffs = 0, extractFails = 0;
console.log((STRICT ? '[GATE] ' : '[REPORT] ') + '契约一致闸门 G21 · ' + path.relative(ROOT, FILE));
console.log('题型：同一事实的 N 处声明必须集合相等；只报不一致，不判谁对。\n');
for (const fam of SPEC) {
  const got = fam.points.map((p) => ({ name: p.name, v: p.get() }));
  const fails = got.filter((g) => g.v === null);
  if (fails.length) {
    extractFails++;
    console.log('⚠ ' + fam.family + '：抽取失败 → ' + fails.map((f) => f.name).join('、'));
    continue;
  }
  const keys = got.map((g) => norm(g.v));
  const same = keys.every((k) => k === keys[0]);
  if (same) {
    console.log('✓ ' + fam.family + '：' + got.length + ' 处一致 → ' + keys[0]);
  } else {
    diffs++;
    console.log('✗ ' + fam.family + '：' + got.length + ' 处不一致');
    for (const g of got) console.log('    · ' + g.name + ' → [' + norm(g.v) + ']');
    console.log('    （why：' + fam.why + '）');
  }
}
console.log('\n小结：' + SPEC.length + ' 个事实族 · ' + diffs + ' 处不一致 · ' + extractFails + ' 抽取失败');
if (!STRICT) console.log('（清单模式：退出 0；加 --strict 令不一致退 1）');
process.exitCode = STRICT && (diffs > 0 || extractFails > 0) ? 1 : 0;
