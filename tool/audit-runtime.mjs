#!/usr/bin/env node
/* 只读运行时审计：D1 导航激活态单一事实源 + E2 事件监听成对 Top N。
   不进产品、不进闸门、不改母本——只出清单，供 owner 判断"哪些是真问题"。

   D1 口径：沿用闸门⑧——激活态只准 aria-current/aria-selected/aria-pressed 承载，
      禁 .active 类、禁 JS 写 active 类、禁 is-on/is-open 手写态。
      本工具额外报告"多套导航各自写激活态"的分布（顶部 data-nav / #bw-nav / 素览 / 曲径 / 工作台），
      指出潜在不同步点，不下"必须改"结论。
   E2 口径：addEventListener 与 removeEventListener 的配对率。单文件长生命周期下，
      add 远多于 remove 是泄漏候选；但很多监听随页面常驻、无需 remove，故只报 Top N 归属模块。
   用法：node tool/audit-runtime.mjs [--json] [文件]  （默认 pre/target 母本） */
import fs from 'node:fs';
import { TARGET } from './patch.mjs';
const asJson = process.argv.includes('--json');
const fileArg = process.argv.find((a) => a.endsWith('.txt') || a.endsWith('.html'));
const FILE = fileArg || TARGET;
const src = fs.readFileSync(FILE, 'utf8');
const lines = src.split('\n');
const lineAt = (i) => src.slice(0, i).split('\n').length;

const ANCHORS = [...src.matchAll(/^BF\.([A-Za-z_$][\w$]*)\s*=/gm)].map((m) => ({ i: m.index, name: 'BF.' + m[1] }));
function moduleOf(idx) {
  let n = '（顶层/未归属）';
  for (const a of ANCHORS) { if (a.i <= idx) n = a.name; else break; }
  return n;
}

/* ---------- D1 ---------- */
const count = (re) => (src.match(re) || []).length;
// 与闸门⑧同口径：.active 选择器只在 <style> CSS 段里数，避免把注释/document.activeElement/st.active 游标误判
const cssAll = [...src.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1].replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
const d1 = {
  aria_current: count(/aria-current/g),
  aria_selected: count(/aria-selected/g),
  aria_pressed: count(/aria-pressed/g),
  css_active_class: (cssAll.match(/[^\w-]\.active(?![\w-])/g) || []).length,
  js_write_active: count(/classList\.(?:add|toggle)\(['"]active['"]/g),
  is_on_open: count(/\bis-on\b|is-open\b/g),
};
// 各套导航的 aria-current 使用分布（选择器前缀）
const navGroups = [
  ['工作台 nav (.wb-nav__item)', /\.wb-nav__item\[aria-current/g],
  ['设置 nav (.settings-nav)', /\.settings-nav button\[aria-current/g],
  ['bw 侧栏 (#bw-nav)', /#bw-nav button\[aria-current/g],
  ['素览 (.sul-rail__b)', /\.sul-rail__b\[aria-current/g],
  ['曲径 (.qj-node)', /\.qj-node\[aria-current/g],
  ['通知 chip (.nc-chip)', /\.nc-chip\[aria-current/g],
  ['目录 (.mr-toc__item)', /\.mr-toc__item\[aria-current/g],
  ['设置卡 (.settings-card)', /\.settings-card\[aria-current/g],
];
const navDist = navGroups.map(([name, re]) => [name, count(re)]).filter(([, n]) => n > 0);
// data-nav 点击写点（谁在切页）——潜在第二事实源
const dataNavWrites = [...src.matchAll(/data-nav=/g)].length;
const d1Verdict = (d1.css_active_class === 0 && d1.js_write_active === 0 && d1.is_on_open === 0)
  ? '激活态写入仍单一（全部 aria-*），无 .active 类回潮'
  : `发现非 aria 激活态写点：.active类 ${d1.css_active_class} / JS写active ${d1.js_write_active} / is-on|open ${d1.is_on_open}`;

/* ---------- E2 ---------- */
const addHits = [...src.matchAll(/\.addEventListener\s*\(/g)].map((m) => ({ i: m.index }));
const remHits = [...src.matchAll(/\.removeEventListener\s*\(/g)].map((m) => ({ i: m.index }));
const byMod = new Map();
for (const a of addHits) byMod.set(moduleOf(a.i), (byMod.get(moduleOf(a.i)) || 0) + 1);
const removedByMod = new Map();
for (const r of remHits) removedByMod.set(moduleOf(r.i), (removedByMod.get(moduleOf(r.i)) || 0) + 1);
const top = [...byMod.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12)
  .map(([mod, adds]) => ({ module: mod, adds, removes: removedByMod.get(mod) || 0 }));

const result = {
  file: FILE,
  D1_导航激活态: {
    统计: d1,
    各套导航分布: Object.fromEntries(navDist),
    dataNav属性出现: dataNavWrites,
    结论: d1Verdict,
    潜在不同步点: navDist.length > 1
      ? `${navDist.length} 套导航各自用 aria-current；切页时须同步刷新，否则高亮不一致（闸门⑧只保证"走aria"，不保证"多处一致"）`
      : '单一导航',
  },
  E2_监听成对: {
    add总数: addHits.length,
    remove总数: remHits.length,
    配对率: (remHits.length / Math.max(addHits.length, 1) * 100).toFixed(1) + '%',
    Top模块: top,
    说明: '多数监听随页面常驻无需 remove；此表只标"add 密集且 remove 为 0"的模块供人工判断，不下泄漏结论',
  },
};

if (asJson) {
  console.log(JSON.stringify(result, null, 2));
} else {
  console.log(`输入：${FILE}`);
  console.log('\n【D1 导航激活态单一事实源】');
  console.log(`  aria-current ${d1.aria_current} · aria-selected ${d1.aria_selected} · aria-pressed ${d1.aria_pressed}`);
  console.log(`  .active类 ${d1.css_active_class} · JS写active ${d1.js_write_active} · is-on/open ${d1.is_on_open}`);
  console.log('  各套导航 aria-current 分布：');
  for (const [name, n] of navDist) console.log(`    ${n}  ${name}`);
  console.log(`  ${d1.dataNavWrites ? 'data-nav 属性出现 ' + d1.dataNavWrites + ' 次（切页写点）' : ''}`);
  console.log('  结论：' + d1Verdict);
  console.log('  潜在不同步点：' + result.D1_导航激活态.潜在不同步点);
  console.log('\n【E2 事件监听成对 Top N】');
  console.log(`  add ${addHits.length} · remove ${remHits.length} · 配对率 ${result.E2_监听成对.配对率}`);
  for (const t of top) console.log(`    add ${String(t.adds).padStart(3)} / rm ${String(t.removes).padStart(3)}  ${t.module}`);
  console.log('  说明：' + result.E2_监听成对.说明);
}
