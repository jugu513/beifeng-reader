#!/usr/bin/env node
/* 方案B 2b · 分层清单审计闸门（只读）
   职责边界（与 src-gate/build-check 不重叠）：
     · build-check：src 字节级还原八份副本（产物一致）。
     · src-gate：段文件齐全、占位符连续、命名空间归属唯一（结构无幽灵）。
     · layer-gate（本闸）：src/LAYERS.json 分层清单覆盖全部段、层合法、且与段内 BF 定义归属一致。
   它守的是"分层视图不漂移"——清单是架构可读性的单一来源，若删段/加段/改定义而清单没跟上，
   分层视图就成了假地图，比没有更坏。分层是标注，不改段物理顺序（字节一致由 build-check 守）。

   可真红的点：段文件增删、清单缺段/重段/层名非法、有定义段的层归属与命名空间映射不符。
   不假阳：只验清单与客观事实（段号集合、命名空间定义）的一致性，不评判分类对错。
   退出码 0=清单一致，1=漂移。 */
import fs from 'node:fs';
import path from 'node:path';
import { ROOT } from './patch.mjs';

const SRC = path.join(ROOT, 'src');
const SEGDIR = path.join(SRC, 'script');
const LAYERS = path.join(SRC, 'LAYERS.json');
const bad = [];

// 命名空间 → 层的权威映射（与生成脚本一致，固化在此作为审计基准）
const NS_LAYER = {
  EVENTS: 'core', CONFIG: 'core', bus: 'core', sync: 'core', log: 'core', err: 'core',
  timers: 'core', jobs: 'core', trace: 'core', caps: 'core', fsync: 'core', snap: 'core',
  store: 'core', state: 'core', dom: 'core', settings: 'core', prefs: 'core', commands: 'core',
  sheet: 'core', v3Scrim: 'core', shell: 'core', appState: 'core', app: 'core', util: 'core',
  nav: 'core', cfi: 'core', stats: 'core', trash: 'core', lz: 'core', flavor: 'core',
  shelf: 'domain', ann: 'domain', hlc: 'domain', findInPage: 'domain',
  smart: 'domain', worker: 'domain', backup: 'domain', base: 'domain',
  theme: 'ui', skin: 'ui', sul: 'ui', qj: 'ui', notesTab: 'ui', mineTab: 'ui',
  noti: 'ui', feedback: 'ui', act: 'ui', ui: 'ui', modal: 'ui', hotkeys: 'ui',
  reader: 'ui', agent: 'ui', taste: 'ui',
  modules: 'boot',
};
const LAYERS_OK = new Set(['core', 'domain', 'ui', 'boot']);

// 1) 段文件集合
if (!fs.existsSync(SEGDIR)) { console.error('✗ 缺段目录：' + path.relative(ROOT, SEGDIR)); process.exit(1); }
const segFiles = fs.readdirSync(SEGDIR).filter((f) => /^\d{3}\.js$/.test(f)).sort().map((f) => f.slice(0, 3));

// 2) 清单
if (!fs.existsSync(LAYERS)) { console.error('✗ 缺分层清单：' + path.relative(ROOT, LAYERS)); process.exit(1); }
let data;
try { data = JSON.parse(fs.readFileSync(LAYERS, 'utf8')); }
catch (e) { console.error('✗ LAYERS.json 解析失败：' + e.message); process.exit(1); }
const list = Array.isArray(data.segments) ? data.segments : [];
const listNums = list.map((x) => x.n);

// a) 覆盖：清单段号 == 段文件集合（顺序一致）
if (listNums.join(',') !== segFiles.join(',')) {
  const missing = segFiles.filter((n) => !listNums.includes(n));
  const extra = listNums.filter((n) => !segFiles.includes(n));
  if (missing.length) bad.push('清单缺段：' + missing.join(','));
  if (extra.length) bad.push('清单多段：' + extra.join(','));
  if (!missing.length && !extra.length) bad.push('清单段顺序与段文件不一致');
}
// b) 层名合法 + 无重复段号
const seen = new Set();
for (const x of list) {
  if (!LAYERS_OK.has(x.layer)) bad.push('段 ' + x.n + ' 层名非法：' + x.layer);
  if (seen.has(x.n)) bad.push('段 ' + x.n + ' 在清单里重复');
  seen.add(x.n);
}
// c) 有定义段的层归属与命名空间映射一致
let checkedDefs = 0;
for (const x of list) {
  const f = path.join(SEGDIR, x.n + '.js');
  if (!fs.existsSync(f)) continue;
  const s = fs.readFileSync(f, 'utf8');
  const defs = [...new Set([...s.matchAll(/^ {0,2}BF\.([A-Za-z_$][\w$]*)\s*=\s*[({]/gm)].map((m) => m[1]))];
  const mapped = [...new Set(defs.map((d) => NS_LAYER[d]).filter(Boolean))];
  if (!mapped.length) continue;
  checkedDefs++;
  if (mapped.length > 1) bad.push('段 ' + x.n + ' 定义了跨层命名空间（' + defs.join(',') + ' → ' + mapped.join('/') + '）');
  else if (x.layer !== mapped[0]) bad.push('段 ' + x.n + ' 层为 ' + x.layer + '，但定义 ' + defs.join(',') + ' 归属 ' + mapped[0]);
}

const ok = bad.length === 0;
const dist = {};
list.forEach((x) => dist[x.layer] = (dist[x.layer] || 0) + 1);
console.log((ok ? '✓' : '✗') + ' 分层清单审计：' + list.length + ' 段 / 分布 ' + JSON.stringify(dist) + ' / 校验定义段 ' + checkedDefs);
if (bad.length) console.log('  - ' + bad.slice(0, 12).join('\n  - '));
else console.log('  · 清单覆盖全部段、层合法、命名空间归属一致；分层是标注，段序与字节未变');
process.exit(ok ? 0 : 1);
