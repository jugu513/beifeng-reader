#!/usr/bin/env node
/* 交付前一键自检 —— 只汇总既有工具的结论，自己不重写任何判据。
   用法：node tool/selfcheck.mjs
   做什么：⓪ 先 deploy（根→target 同步，保证审到最新）  ① 六份母本指纹一致
           ② gate-v2（19/19 全 PASS）  ③ acceptance（红线）  ④ dup-scan 显式传参
           ⑤ build-check（src 构建字节级还原六份母本）  ⑥ src-gate（src 结构无幽灵）。
   退出码：任一步硬失败 → 1。
   纪律：新增检查必须先能红；本脚本对"指纹不一致/闸门崩/验收红/重复组>0"都真判红。 */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { ROOT, TXT, HTML, TARGET, TARGET_HTML } from './patch.mjs';

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const run = (script, args = []) => {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tool', script)].concat(args), {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status == null ? -1 : e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
};

const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const fails = [];

say('══ 北风 交付前自检 · ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + ' ══');
say('   node ' + process.version + ' · ' + process.platform + ' ' + process.arch);
say('');

/* 方案B 后新增 ⑤⑥ 两步：src 源码树再干净、六份母本再一致，也不能替代
   「src 能字节级还原产物」+「src 结构无幽灵」两道检查。缺了它们，有人改坏 src
   而母本没动时，①–④ 全绿会给出"可以交付"的假绿——这正是 2a 后补上的缺口。 */

/* ⓪ 先同步测试输入：工具只读 target，务必先把根母本的最新字节发布过去 */
say('【⓪ 发布到测试输入 deploy】');
const dep = run('deploy.mjs');
dep.out.split('\n').filter(Boolean).forEach((l) => say('  ' + l));
if (dep.code !== 0) fails.push('deploy 同步失败');
say('');

/* ① 六份母本指纹（根 2 + work 2 + target 2） */
const files = [TXT, HTML, path.join(ROOT, 'work', '北风V0.0.1-alpha.txt'), path.join(ROOT, 'work', '北风V0.0.1-alpha.html'), TARGET, TARGET_HTML];
say('【① 母本指纹】');
const hashes = [];
for (const f of files) {
  if (!fs.existsSync(f)) { say('  ✗ 缺失 ' + path.relative(ROOT, f)); fails.push('母本缺失'); continue; }
  const b = fs.readFileSync(f);
  const h = md5(b);
  hashes.push(h);
  say('  ' + h + '  ' + path.relative(ROOT, f) + '  (' + (b.toString('utf8').split('\n').length - 1) + ' 行 / ' + b.length + ' B)');
}
const consistent = hashes.length === 6 && hashes.every((h) => h === hashes[0]);
if (consistent) say('  ✓ 六份一致（根 2 + work 2 + target 2）');
else { say('  ✗ 六份不一致 —— 根↔work↔target 未同步 / html 未重生成'); fails.push('母本指纹不一致'); }
say('');

/* ② gate-v2 */
say('【② 闸门 gate-v2】');
const g = run('gate-v2.mjs');
const gSummary = g.out.split('\n').find((l) => /═\s*\d+\/\d+/.test(l)) || '(无汇总行)';
g.out.split('\n').filter((l) => /^\s+(PASS|FAIL|SKIP)\s/.test(l)).forEach((l) => say('  ' + l.trim()));
say('  ' + (g.code === 0 ? '✓' : '✗') + ' ' + gSummary.trim());
if (g.code !== 0) fails.push('闸门有 FAIL');
if (!/19\/19/.test(g.out)) { say('  ⚠ 未见 19/19——确认③判据是否接上、是否有闸门未过'); fails.push('闸门非 19/19'); }
say('');

/* ③ acceptance */
say('【③ 验收 acceptance】');
const a = run('acceptance.mjs');
const aBody = a.out.split('\n');
aBody.filter((l) => /^\s+[✓✗·]/.test(l)).forEach((l) => say('  ' + l.trim()));
const aVerdict = aBody.find((l) => /══ (红线全过|未过)/.test(l)) || '(无结论行)';
say('  ' + (a.code === 0 ? '✓' : '✗') + ' ' + aVerdict.trim());
if (a.code !== 0) fails.push('验收有未过红线');
say('');

/* ④ dup-scan 显式传参（不信默认） */
say('【④ 重复组 dup-scan（显式传参）】');
const d = run('dup-scan.mjs', ['18', path.relative(ROOT, TARGET)]);
const dHead = d.out.split('\n').find((l) => /^\[输入\]/.test(l)) || '(无输入抬头)';
const dSum = d.out.split('\n').find((l) => /重复组/.test(l)) || '(无结果行)';
say('  ' + dHead.trim());
say('  ' + dSum.trim());
const dMatch = dSum.match(/重复组\s*(\d+)\s*处/);
if (!dMatch) fails.push('dup-scan 未产出结果');
else if (Number(dMatch[1]) !== 0) fails.push('重复组 ' + dMatch[1] + ' 处');
else say('  ✓ 0 处重复组，且抬头确认了实际读取的文件');
say('');

/* ⑤ src 能字节级还原六份母本（build-check） */
say('【⑤ src 构建一致性 build-check】');
const bc = run('build-check.mjs');
bc.out.split('\n').filter(Boolean).forEach((l) => say('  ' + l.trim()));
if (bc.code !== 0) fails.push('src 构建与母本不一致');
say('');

/* ⑥ src 源码结构无幽灵（src-gate） */
say('【⑥ src 结构闸门 src-gate】');
const sg = run('src-gate.mjs');
sg.out.split('\n').filter(Boolean).forEach((l) => say('  ' + l.trim()));
if (sg.code !== 0) fails.push('src 结构有幽灵');
say('');

/* 汇总结论 */
say('══ 自检结论 ══');
if (fails.length === 0) {
  say('  ✓ 七步全过（deploy + 六份指纹 + 19/19 闸门 + 红线验收 + 重复组 + src 构建一致 + src 结构）——可以交付');
} else {
  say('  ✗ 未过：' + fails.join(' / '));
  say('  没到就是没到：先修这些，再交付。');
}
process.exitCode = fails.length ? 1 : 0;
