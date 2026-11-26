#!/usr/bin/env node
/* 交付前唯一签字入口 —— 闸门与报告分家（2026-11-23 重建）。
   用法：node tool/selfcheck.mjs [--quick]

   核心机制：
     · 闸门白名单 GATE_WHITELIST —— 只有名单内的检查失败才写 failures[]、才卡签字。
       新增闸门必须先加进白名单（改白名单 = 评审动作，须先证红证绿）。
     · 报告清单 REPORT_TOOLS —— L4 只读诊断工具，退出码非 0 只渲染高亮、不卡签字，
       汇总单列「报告（不卡）」栏提示人工复核。彻底解决"清单冒充闸门"。
     · 每步打印 [GATE]/[REPORT] 角色标签，签字结论只看闸门栏。

   做什么：⓪a build(src→根txt)  ⓪b deploy(根txt→五份)  ① 六份指纹  ② gate-v2  ③ acceptance  ④ dup-scan
           ⑤ build-check  ⑥ src-gate  ⑥b layer-gate(方案B分层清单)  ⑦ parity(G21,--strict)
           ⑦b regress(行为回归汇总闸，11套纯逻辑) —— 以上闸门；⑧ L4 报告工具（不卡）。
   退出码：任一【闸门】硬失败 → 1；仅报告红 → 0（签字通过 + 高亮提示）。

   三档用法（2026-11-25 P2 分层减负）：
     · 默认（发布前签字）：全部闸门 + 行为回归完整档 + 12 项报告；
     · --quick（日常迭代）：全部闸门 + 行为回归快组（跳过 retrieval 慢项）+ 跳过报告层；
       适合改完立刻自查，秒级反馈；发布前必须用默认档跑全。
   纪律：新增检查必须先能红；本脚本对"指纹不一致/闸门崩/验收红/重复组>0/回归 fail"都真判红。 */
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

/* ══════════ 闸门白名单（唯一真源 · 改这里即评审） ══════════
   只有下列 id 的失败会写进 failures[]、导致签字失败。
   摘掉任一 id = 把该检查降级为报告（须显式评审 + 留痕 + 先证红）。 */
const GATE_WHITELIST = Object.freeze([
  'build', 'deploy', 'fingerprint', 'gate-v2', 'acceptance', 'dup-scan', 'build-check', 'src-gate', 'layer', 'parity', 'regress',
]);
const isGate = (id) => GATE_WHITELIST.includes(id);

/* ══════════ 报告清单（只出数，永不卡签字） ══════════
   退出码非 0 只进 reportWarns 渲染高亮；即使全红，签字仍可通过。 */
const REPORT_TOOLS = [
  { id: 'fact-check', label: '文案对账' },
  { id: 'dead-fn', label: '死函数' },
  { id: 'empty-catch', label: '空 catch' },
  { id: 'scan-comments', label: '注释空洞' },
  { id: 'comment-facts', label: '注释失实' },
  { id: 'aa-skins', label: '皮肤对比度' },
  { id: 'ui-copy-flags', label: 'UI 文案标志' },
  { id: 'ui-strings', label: 'UI 字符串' },
  { id: 'copy-audit', label: '文案审计' },
  { id: 'copy-consistency', label: '文案一致性' },
  { id: 'undeclared-assign', label: '未声明赋值' },
  { id: 'polish-audit', label: '润色审计' },
];
const QUICK = process.argv.includes('--quick');

const lines = [];
const say = (s = '') => { lines.push(s); console.log(s); };
const fails = [];         // 闸门失败 → 卡签字
const reportWarns = [];   // 报告异常 → 只提示
const gateFail = (id, msg) => { if (isGate(id)) fails.push(id + ': ' + msg); else reportWarns.push(id + '(非白名单): ' + msg); };

say('══ 北风 交付前自检 · 唯一签字入口 · ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + ' ══');
say('   node ' + process.version + ' · ' + process.platform + ' ' + process.arch);
say('   闸门白名单：' + GATE_WHITELIST.join(' · '));
say('');

/* ⓪ 先构建母本（真源已反转到 src/）再同步测试输入（P1 · 2026-11-25） */
say('[GATE] 【⓪a 从 src 构建母本 build】');
const bld = run('build.mjs');
bld.out.split('\n').filter(Boolean).forEach((l) => say('  ' + l));
if (bld.code !== 0) gateFail('build', 'src 构建失败（占位符/分段异常）');
say('');
say('[GATE] 【⓪b 发布测试输入 deploy】');
const dep = run('deploy.mjs');
dep.out.split('\n').filter(Boolean).forEach((l) => say('  ' + l));
if (dep.code !== 0) gateFail('deploy', '同步失败');
say('');

/* ① 六份母本指纹 */
const files = [TXT, HTML, path.join(ROOT, 'work', '北风V0.0.1-alpha.txt'), path.join(ROOT, 'work', '北风V0.0.1-alpha.html'), TARGET, TARGET_HTML];
say('[GATE] 【① 母本指纹】');
const hashes = [];
for (const f of files) {
  if (!fs.existsSync(f)) { say('  ✗ 缺失 ' + path.relative(ROOT, f)); gateFail('fingerprint', '母本缺失'); continue; }
  const b = fs.readFileSync(f);
  const h = md5(b);
  hashes.push(h);
  say('  ' + h + '  ' + path.relative(ROOT, f) + '  (' + (b.toString('utf8').split('\n').length - 1) + ' 行 / ' + b.length + ' B)');
}
const consistent = hashes.length === 6 && hashes.every((h) => h === hashes[0]);
if (consistent) say('  ✓ 六份一致（根 2 + work 2 + target 2）');
else { say('  ✗ 六份不一致 —— 根↔work↔target 未同步 / html 未重生成'); gateFail('fingerprint', '六份指纹不一致'); }
say('');

/* ② gate-v2 */
say('[GATE] 【② 闸门 gate-v2】');
const g = run('gate-v2.mjs');
const gSummary = g.out.split('\n').find((l) => /═\s*\d+\/\d+/.test(l)) || '(无汇总行)';
g.out.split('\n').filter((l) => /^\s+(PASS|FAIL|SKIP)\s/.test(l)).forEach((l) => say('  ' + l.trim()));
say('  ' + (g.code === 0 ? '✓' : '✗') + ' ' + gSummary.trim());
if (g.code !== 0) gateFail('gate-v2', '闸门有 FAIL');
if (!/19\/19/.test(g.out)) { say('  ⚠ 未见 19/19——确认③判据是否接上、是否有闸门未过'); gateFail('gate-v2', '闸门非 19/19'); }
say('');

/* ③ acceptance */
say('[GATE] 【③ 验收 acceptance】');
const a = run('acceptance.mjs');
const aBody = a.out.split('\n');
aBody.filter((l) => /^\s+[✓✗·]/.test(l)).forEach((l) => say('  ' + l.trim()));
const aVerdict = aBody.find((l) => /══ (红线全过|未过)/.test(l)) || '(无结论行)';
say('  ' + (a.code === 0 ? '✓' : '✗') + ' ' + aVerdict.trim());
if (a.code !== 0) gateFail('acceptance', '验收有未过红线');
say('');

/* ④ dup-scan 显式传参 */
say('[GATE] 【④ 重复组 dup-scan（显式传参）】');
const d = run('dup-scan.mjs', ['18', path.relative(ROOT, TARGET)]);
const dHead = d.out.split('\n').find((l) => /^\[输入\]/.test(l)) || '(无输入抬头)';
const dSum = d.out.split('\n').find((l) => /重复组/.test(l)) || '(无结果行)';
say('  ' + dHead.trim());
say('  ' + dSum.trim());
const dMatch = dSum.match(/重复组\s*(\d+)\s*处/);
if (!dMatch) gateFail('dup-scan', 'dup-scan 未产出结果');
else if (Number(dMatch[1]) !== 0) gateFail('dup-scan', '重复组 ' + dMatch[1] + ' 处');
else say('  ✓ 0 处重复组，且抬头确认了实际读取的文件');
say('');

/* ⑤ build-check */
say('[GATE] 【⑤ src 构建一致性 build-check】');
const bc = run('build-check.mjs');
bc.out.split('\n').filter(Boolean).forEach((l) => say('  ' + l.trim()));
if (bc.code !== 0) gateFail('build-check', 'src 构建与母本不一致');
say('');

/* ⑥ src-gate */
say('[GATE] 【⑥ src 结构闸门 src-gate】');
const sg = run('src-gate.mjs');
sg.out.split('\n').filter(Boolean).forEach((l) => say('  ' + l.trim()));
if (sg.code !== 0) gateFail('src-gate', 'src 结构有幽灵');
say('');

/* ⑥b 方案B 分层清单审计 layer-gate */
say('[GATE] 【⑥b 分层清单 layer-gate（方案B 2b）】');
const lg = run('layer-gate.mjs');
lg.out.split('\n').filter(Boolean).forEach((l) => say('  ' + l.trim()));
if (lg.code !== 0) gateFail('layer', '分层清单与段定义漂移');
say('');

/* ⑦ 契约一致 G21 —— 修完 readerFilter 漂移后升格入硬链（2026-11-23） */
say('[GATE] 【⑦ 契约一致 parity G21（--strict）】');
const pg = run('parity-gate.mjs', ['--strict']);
pg.out.split('\n').filter((l) => /^(✓|✗|⚠|小结：|\[GATE\])/.test(l.trim()) || /处不一致|抽取失败/.test(l)).forEach((l) => say('  ' + l.trim()));
if (pg.code !== 0) gateFail('parity', '同一事实多处声明不一致（readerFilter 漂移已修，若再红必是新引入）');
say('');

/* ⑦b 行为回归汇总闸（P0）—— --quick 下跑快组，其余同 */
say('[GATE] 【⑦b 行为回归 regress（' + (QUICK ? '快组' : '完整档') + '）】');
const rg = run('regress-gate.mjs', QUICK ? ['--quick'] : []);
rg.out.split('\n').filter((l) => /^(行为回归|  (PASS|FAIL)|══)/.test(l)).forEach((l) => say('  ' + l.trim()));
if (rg.code !== 0) gateFail('regress', '行为回归有 fail（纯逻辑内核语义退化）');
say('');

/* ⑧ L4 报告层 —— 只渲染，退出码非 0 不写 failures */
say('[REPORT] 【⑧ L4 报告工具（不卡签字 · 红项提示人工复核）】' + (QUICK ? ' [--quick 跳过]' : ''));
if (!QUICK) {
  for (const t of REPORT_TOOLS) {
    const r = run(t.id + '.mjs');
    const bad = r.code !== 0;
    // 取一行摘要：优先含小结/结论/合计/通过的行，否则取最后一行非空
    const body = r.out.split('\n').map((l) => l.trim()).filter(Boolean);
    const sum = body.find((l) => /小结|结论|合计|共|通过|处不一致|命中/.test(l)) || body[body.length - 1] || '(无输出)';
    say('  ' + (bad ? '⚠' : '·') + ' [' + t.id + '] ' + t.label + ' → ' + sum.slice(0, 110));
    if (bad) {
      reportWarns.push(t.id + ': 退出码 ' + r.code + ' —— ' + sum.slice(0, 90));
      body.slice(-3).forEach((l) => say('      ' + l.slice(0, 120)));
    }
  }
} else {
  say('  （--quick 已跳过报告层；签字结论不含报告层）');
}
say('');

/* ══════════ 汇总结论 ══════════ */
say('══ 签字结论 ══');
say('  [闸门·卡] ' + (fails.length === 0
  ? GATE_WHITELIST.map((id) => id + '✓').join('  ')
  : '✗ 未过：' + fails.join(' / ')));
say('  [报告·不卡] ' + (reportWarns.length === 0
  ? '全部 ' + REPORT_TOOLS.length + ' 项正常（或 --quick 跳过）'
  : reportWarns.length + ' 项红，仅提示人工复核，不影响签字：' + reportWarns.map((w) => w.split(':')[0]).join(', ')));
if (fails.length === 0) {
  say('  ✓ 签字通过（闸门全绿）——可以交付' + (reportWarns.length ? '；报告层红项请人工过目' : ''));
} else {
  say('  ✗ 未过：' + fails.join(' / '));
  say('  没到就是没到：先修这些闸门，再交付。');
}
process.exitCode = fails.length ? 1 : 0;
