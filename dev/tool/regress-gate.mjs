#!/usr/bin/env node
/* P0 行为回归汇总闸（2026-11-25 新增）：把 tool/tests/*.test.mjs 从"散落脚本"提升为
   闸门级执行——每次签字都跑，任一 fail 即红。这些是纯逻辑回归（从母本按标记抽代码块
   在 vm 里跑），与真机验证互补：真机证"渲染/存储/交互"，这里证"可抽取的内核语义没退化"。

   为什么现在才接：此前 11 个 test 里有 1 条反证夹具过期（export-roundtrip 的
   "旧拼法重分章数变多"——当前 _splitBounds 已能 merge 重复标题，模拟不出旧 bug），
   恒红无法入闸。2026-11-25 已把该反证更新为当前语义下的有效断言（全绿）。

   只读、不改母本。退出码：全部 0 → 0；任一非 0 → 1。
   用法：node tool/regress-gate.mjs [--quick]（--quick 只跑快组，跳过 retrieval 等慢项） */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './patch.mjs';

const HERE = path.resolve(import.meta.dirname, 'tests');
const QUICK = process.argv.includes('--quick');
/* 慢项：retrieval 约 950ms，其余均 <80ms；--quick 下跳过，完整档全跑。 */
const SLOW = new Set(['retrieval.test.mjs']);

const files = fs.readdirSync(HERE)
  .filter((f) => f.endsWith('.test.mjs'))
  .filter((f) => !(QUICK && SLOW.has(f)))
  .sort();

let totalPass = 0, totalFail = 0, bad = 0;
const rows = [];
for (const f of files) {
  const r = spawnSync(process.execPath, [path.join(HERE, f)], { cwd: ROOT, encoding: 'utf8', maxBuffer: 1 << 26 });
  const out = String(r.stdout || '') + String(r.stderr || '');
  const tally = out.match(/(\d+)\s+pass\s*\/\s*(\d+)\s+fail/);
  const pass = tally ? Number(tally[1]) : 0;
  const fail = tally ? Number(tally[2]) : (r.status === 0 ? 0 : 1);
  totalPass += pass; totalFail += fail;
  const okc = r.status === 0 && fail === 0;
  if (!okc) bad++;
  rows.push({ f, ok: okc, pass, fail, code: r.status });
}

console.log('行为回归汇总闸' + (QUICK ? ' [--quick 快组]' : '') + '：' + files.length + ' 套');
for (const r of rows) {
  console.log('  ' + (r.ok ? 'PASS' : 'FAIL') + '  ' + r.f.padEnd(28) + ' ' + r.pass + ' pass / ' + r.fail + ' fail' + (r.code !== 0 ? ' (exit ' + r.code + ')' : ''));
}
console.log('══ 合计 ' + totalPass + ' pass / ' + totalFail + ' fail · ' + (files.length - bad) + '/' + files.length + ' 套通过' + (QUICK ? '（快组）' : '') + ' ══');
process.exit(bad ? 1 : 0);
