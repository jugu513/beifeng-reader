/* 验收数字：一条命令跑完「静态 + 半实物 + 对账」，只给数，不给口号。

   为什么要有这一条：静态闸门（tool/gate.mjs）只看结构，回归测试看的是行为，
   而「1000 章的书打开要多久」「搜索跳转落不落地」这两类数字，过去每次都靠人手点。
   手点的数字进不了基线，下次就没人知道是快了还是慢了。

   三段口径：
     ① 静态   —— 复跑既有闸门与三个只读扫描器（不另写一份检查，全部原样调用）；
     ② 半实物 —— 用 tool/harness.mjs 从母本按标记抽出分章/索引内核，在 Node 里
                 喂一本合成出来的 1000 章书，量「分章 / 索引构建 / 单章读取」；
                 它量的是纯逻辑，不含 IDB 与解压——那部分归浏览器三条（见
                 tool/tests/acceptance.browser.mjs）。
     ③ 对账   —— tool/fact-check.mjs 的「文案数字 vs 代码真值」。

   用法：
     node tool/acceptance.mjs                    # 审母本，全量
     node tool/acceptance.mjs --file=pre/release-2026-11-03.txt   # 审旧件，做对照列
     node tool/acceptance.mjs --json             # 机器可读，供基线表抄数
     node tool/acceptance.mjs --report-only      # 永远退 0（写基线表时用）

   退出码：红线全过 → 0；任一红线不过 → 1（--report-only 除外）。
   口味：这里只认数。数字没到就是没到，不写「基本达标」。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
import { readMaster, extract } from './harness.mjs';
import { ROOT, TXT, PRE, TARGET } from './patch.mjs';

/* ============ 参数 ============ */
const argv = process.argv.slice(2);
const argOf = (k) => {
  const hit = argv.find((a) => a === '--' + k || a.startsWith('--' + k + '='));
  if (!hit) return undefined;
  if (!hit.includes('=')) return true;
  return hit.slice(hit.indexOf('=') + 1);
};
if (argOf('help') || argv.includes('-h')) {
  console.log([
    '用法：node tool/acceptance.mjs [选项]',
    '  --file=<路径>    审指定母本（默认 work/北风V0.0.1-alpha.txt）',
    '  --json           机器可读输出（抄基线表用）',
    '  --report-only    永远退出 0（写对照列时用）',
    '  --help           这一屏',
    '',
    '退出码：红线全过 → 0；任一红线不过 → 1。',
  ].join('\n'));
  process.exit(0);
}
const FILE = argOf('file') ? path.resolve(ROOT, String(argOf('file'))) : TARGET;
if (!fs.existsSync(FILE)) {
  console.error('找不到要审的文件：' + FILE);
  process.exit(2);
}
const AS_JSON = !!argOf('json');
const REPORT_ONLY = !!argOf('report-only');
const OLD_FILE = path.join(PRE, 'release-2026-11-03.txt');

/* ============ 阈值 ============ */
/* 每个数都写清「怎么定的」。定太紧会天天红灯，定太松等于没有。 */
const LIMIT = {
  /* 1000 章 / 约 1MB 的书，实测中位数 ~10ms（本机 Node 20）。阈值取 500ms：
     一是吸收慢机与 CI 抖动（实测的 50 倍），二是 500ms 仍在「点了就有反应」的
     感知阈值内；超过 500ms 用户会开始怀疑卡死。 */
  splitMs: 500,
  /* 索引构建（1000 次 stableSid + 建表）实测 ~18ms。阈值 200ms ≈ 11 倍余量。
     它和分章叠在导入链上，两者合计仍须远小于一次导入的 1.5s 预算。 */
  indexMs: 200,
  /* 单章读取（切一刀 + 去首尾空白）实测 0.003ms。阈值 5ms 不是按倍数拍的，
     是按「翻章不许掉帧」拍的：一帧 16.7ms，读一章最多吃掉三成。 */
  readMs: 5,
  /* 书本规模：与外包票一致，1000 章 / 每章约 1000 字。 */
  chapters: 1000,
  chapterChars: 1000,
};

/* ============ 输出小工具 ============ */
const C = process.stdout.isTTY
  ? { g: '\x1b[32m', r: '\x1b[31m', y: '\x1b[33m', d: '\x1b[2m', b: '\x1b[1m', n: '\x1b[0m' }
  : { g: '', r: '', y: '', d: '', b: '', n: '' };
const pad = (s, n) => {
  /* 中文按 2 列算：只影响对齐，不影响判据 */
  let w = 0;
  for (const ch of String(s)) w += /[\u2e80-\uffff]/.test(ch) ? 2 : 1;
  return String(s) + ' '.repeat(Math.max(0, n - w));
};
const rows = [];
const add = (sec, name, value, unit, ok, note) => rows.push({ sec, name, value, unit: unit || '', ok, note: note || '' });

/* ============ ① 静态：原样调用既有工具 ============ */
function runTool(script, args) {
  try {
    const out = execFileSync(process.execPath, [path.join(ROOT, 'tool', script)].concat(args || []), {
      cwd: ROOT, encoding: 'utf8', maxBuffer: 64 << 20,
    });
    return { code: 0, out };
  } catch (e) {
    return { code: e.status == null ? -1 : e.status, out: String(e.stdout || '') + String(e.stderr || '') };
  }
}

/* ①-a 闸门：一次拿到 node --check / 双生 / 令牌 lint 等 18 项 */
const gateArgs = FILE !== path.resolve(TARGET) ? [FILE] : [];
const gateRun = runTool('gate-v2.mjs', gateArgs);
const gateLines = gateRun.out.split('\n');
const gateItems = gateLines.filter((l) => /^\s+(PASS|FAIL|SKIP)\s/.test(l)).map((l) => {
  const status = /^\s+SKIP/.test(l) ? 'skip' : /^\s+PASS/.test(l) ? 'pass' : 'fail';
  const m = l.match(/^\s+(?:PASS|FAIL|SKIP)\s+(.+?)\s+—\s*(.*)$/);
  return { ok: status === 'pass', status, name: m ? m[1].trim() : l.trim(), detail: m ? m[2].trim() : '' };
});
/* SKIP 项（闸门因环境缺件主动让过的项）不计入通过分母，也不染红；但要在总览里显式可见。
   2026-11-23：③ 已改为内联验密钥保护机制、不再 SKIP；SKIP 机制保留给将来真有环境缺件的场景。 */
const gateSkip = gateItems.filter((x) => x.status === 'skip');
const gateScored = gateItems.filter((x) => x.status !== 'skip');
const gatePass = gateScored.filter((x) => x.ok).length;
const gateTotal = gateScored.length || 19;
const detailOf = (prefix) => (gateItems.find((x) => x.name.startsWith(prefix)) || {}).detail || '';

const gateUnavailable = gateItems.length === 0 || gateRun.code !== 0;
const skipNote = gateSkip.length ? ` · ${gateSkip.length} 项 SKIP（${gateSkip.map((x) => x.name.slice(0, 3)).join('、')}：环境缺件，非母本缺陷）` : '';
const ghost = (() => { const m = detailOf('⑤').match(/幽灵\s*(\d+)/); return m ? Number(m[1]) : null; })();
const twin = detailOf('④');   /* 「逐字节一致」/「.html 工作副本缺失」/具体差异 */
const syntax = detailOf('①');

/* ①-b 三个只读扫描器：子进程调用，口径与它们自己打印的一字不差 */
const deadRun = runTool('dead-fn.mjs', FILE !== path.resolve(TXT) ? [path.relative(ROOT, FILE)] : []);
const deadZero = (() => {
  const a = deadRun.out.match(/全文件零引用\s*(\d+)\s*个/);
  const b = deadRun.out.match(/只有定义行）\s*(\d+)\s*个/);
  if (!a && !b) return null;
  return Number(a ? a[1] : 0) + Number(b ? b[1] : 0);
})();
const dupRun = runTool('dup-scan.mjs', FILE !== path.resolve(TXT) ? ['18', path.relative(ROOT, FILE)] : []);
const dupGroups = (() => { const m = dupRun.out.match(/重复组\s*(\d+)\s*处/); return m ? Number(m[1]) : null; })();
const emptyRun = runTool('empty-catch.mjs', FILE !== path.resolve(TXT) ? [path.relative(ROOT, FILE)] : []);
const emptyCatch = (() => { const m = emptyRun.out.match(/空 catch 总数\s*(\d+)/); return m ? Number(m[1]) : null; })();
/* 空 catch 的趋势对照：只跟 pre 里那份历史件比，不设红线（它是个存量，不是一个能一刀切的判据） */
const emptyOld = (() => {
  if (!fs.existsSync(OLD_FILE) || path.resolve(OLD_FILE) === FILE) return null;
  const r = runTool('empty-catch.mjs', [path.relative(ROOT, OLD_FILE)]);
  const m = r.out.match(/空 catch 总数\s*(\d+)/);
  return m ? Number(m[1]) : null;
})();

/* ①-c 对账 */
const factRun = runTool('fact-check.mjs', FILE !== path.resolve(TXT) ? [path.relative(ROOT, FILE)] : []);
const fact = (() => {
  const m = factRun.out.match(/一致\s*(\d+)\s*·\s*不一致\s*(\d+)\s*·\s*无可比对声明\s*(\d+)/);
  return m ? { ok: Number(m[1]), bad: Number(m[2]), none: Number(m[3]) } : null;
})();

/* ============ ② 半实物：1000 章合成 → 分章 → 索引 → 单章读 ============ */
const BF = { library: {} };
const ctx = vm.createContext({ BF, console, Math, JSON, Date, Object, Array, String, Number, Boolean, RegExp, Error, BigInt, Promise });
/* 从母本里按标记取块：取的是原文的那一段，不另抄一份实现。
   标记成对来自 tool/harness.mjs 的 extract（单一真源），这里只负责求值。 */
function loadBlock(decl, endMark) {
  const code = decl + extract(BF_SRC, decl, endMark);
  vm.runInContext(code, ctx, { filename: 'acceptance:' + decl.slice(0, 28) });
}
let BF_SRC = '';
const semi = { split: null, index: null, read: null, chapters: null, bytes: 0, err: null };

function synthBook(n, perChapter) {
  /* 固定种子：任何机器、任何次跑出来的都是同一本书，数字才可比。
     不用 Math.random —— 那样两次基线没法比，等于没基线。 */
  const pool = '的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感';
  const out = [];
  let s = 20261104;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  for (let i = 0; i < n; i++) {
    let body = '';
    while (body.length < perChapter) {
      const L = 12 + Math.floor(rnd() * 18);
      let sent = '';
      for (let k = 0; k < L; k++) sent += pool[Math.floor(rnd() * pool.length)];
      body += sent + '。';
    }
    out.push('第' + (i + 1) + '章 第' + (i + 1) + '章标题\n' + body);
  }
  return out.join('\n\n');
}

function median(xs) {
  const a = xs.slice().sort((x, y) => x - y);
  return a[Math.floor(a.length / 2)];
}

function runSemi() {
  BF_SRC = readMaster(FILE);
  loadBlock('BF.library.RE_CHAPTER = ', '/* 零丢失分章内核');
  loadBlock('BF.library.cleanText = function (text) ', '/* sid 注入的唯一实现');
  loadBlock('BF.library._splitBounds = function _splitBounds(text, opts) ', '/* 由偏移表就地切片成章节');
  loadBlock('BF.library._buildChapters = function _buildChapters(text, bounds, opts) ', '/* 零丢失兜底校验');
  loadBlock('BF.library._boundsIntegral = function _boundsIntegral(text, bounds) ', 'BF.library.cleanText = function');
  loadBlock('function stableSid(title, content) ', '/* chapterBase');

  const text = synthBook(LIMIT.chapters, LIMIT.chapterChars);
  semi.bytes = text.length;

  const splitRuns = [], indexRuns = [];
  let cleaned = '', bounds = null, chapters = null;
  for (let r = 0; r < 3; r++) {
    const t0 = performance.now();
    cleaned = BF.library.cleanText(text);
    bounds = BF.library._splitBounds(cleaned, { strategy: 'smart', autoDetectTitle: true, mergeTocBlock: true });
    const integral = BF.library._boundsIntegral(cleaned, bounds);
    chapters = BF.library._buildChapters(cleaned, bounds, { autoDetectTitle: true });
    const t1 = performance.now();
    splitRuns.push(t1 - t0);
    if (!integral) throw new Error('分章偏移表不闭合（_boundsIntegral=false）');
    if (chapters.length !== LIMIT.chapters) throw new Error('分章数 ' + chapters.length + ' ≠ ' + LIMIT.chapters);
    /* 索引构建：与 getSidIndex 同口径（sid → 首个章号），只是把 IDB 换成内存表。
       量的是纯计算，不含读库。 */
    const t2 = performance.now();
    const idx = {};
    for (let i = 0; i < chapters.length; i++) {
      const sid = ctx.stableSid(chapters[i].title, chapters[i].content);
      if (!(sid in idx)) idx[sid] = i;
    }
    indexRuns.push(performance.now() - t2);
    if (Object.keys(idx).length !== chapters.length) throw new Error('sid 撞车：' + Object.keys(idx).length + ' / ' + chapters.length);
  }
  semi.split = median(splitRuns);
  semi.index = median(indexRuns);
  semi.chapters = chapters.length;

  /* 单章读取：取 200 个分散章号，量「切一刀 + 去首尾空白」，报均值与 p95。
     固定步长 37 与 1000 互质，能扫满全表而不是只测前几章。 */
  const reads = [];
  for (let k = 0; k < 200; k++) {
    const i = (k * 37) % chapters.length;
    const t = performance.now();
    const s = cleaned.slice(bounds[i], bounds[i + 1]).replace(/^\s+|\s+$/g, '');
    reads.push(performance.now() - t);
    if (!s) throw new Error('第 ' + i + ' 章读出来是空的');
  }
  reads.sort((a, b) => a - b);
  semi.read = { avg: reads.reduce((a, b) => a + b, 0) / reads.length, p95: reads[190] };
}
try { runSemi(); } catch (e) { semi.err = e && e.message; }

/* ============ 记账 ============ */
add('静态', 'node --check', gateUnavailable ? '闸门不可用' : gateItems.find((x) => x.name.startsWith('①')) ? (gateItems.find((x) => x.name.startsWith('①')).ok ? '通过' : '失败') : '未取到', '', gateUnavailable ? null : !!(gateItems.find((x) => x.name.startsWith('①')) || {}).ok, gateUnavailable ? 'gate-v2 未能产出结果，此项未验' : syntax);
add('静态', '双生逐字节 (txt=html)', gateUnavailable ? '闸门不可用' : (/逐字节一致/.test(twin) ? '一致' : twin), '', gateUnavailable ? null : /逐字节一致/.test(twin),
  gateUnavailable ? 'gate-v2 未能产出结果，此项未验' : twin + (FILE !== path.resolve(TXT) ? '（闸门 ④ 恒审母本那一对，不随 --file 变）' : ''));
add('静态', '令牌 lint 幽灵', gateUnavailable ? '闸门不可用' : ghost, '处', gateUnavailable ? null : ghost === 0, gateUnavailable ? 'gate-v2 未能产出结果，此项未验' : detailOf('⑤'));
add('静态', '零引用函数（定义未用）', deadZero, '个', deadZero === 0, (deadRun.out.split('\n')[0] || '').trim());
add('静态', '重复组（18 行窗口）', dupGroups, '处', dupGroups === 0, (dupRun.out.split('\n').find((l) => /重复组/.test(l)) || dupRun.out.split('\n')[0] || '').trim());
add('静态', '空 catch 总数', emptyCatch, '处', null,
  '只报趋势，不设红线：存量清理不是一刀切，' + (emptyOld != null ? '旧件 ' + emptyOld + ' → 本件 ' + emptyCatch + '（Δ' + ((emptyCatch || 0) - emptyOld) + '）' : '无历史件可比'));
add('静态', '闸门总项', gateUnavailable ? '闸门不可用' : gatePass + '/' + gateTotal + (gateSkip.length ? ` (SKIP ${gateSkip.length})` : ''), '', gateUnavailable ? null : gatePass === gateTotal && gateTotal >= 19, gateUnavailable ? 'gate-v2 未能产出结果，整条闸门链不可用' : (gateLines.filter((l) => /═.*通过/.test(l)).pop() || '') + skipNote);

add('半实物', '1000 章合成体量', semi.bytes, '字', null, '固定种子，任一次跑都是同一本书');
add('半实物', '分章（clean+切+校验+建章）', semi.split == null ? '失败' : semi.split.toFixed(1), 'ms', semi.split != null && semi.split <= LIMIT.splitMs, '≤' + LIMIT.splitMs + 'ms · 中位数（3 次）');
add('半实物', '索引构建（1000 × stableSid）', semi.index == null ? '失败' : semi.index.toFixed(1), 'ms', semi.index != null && semi.index <= LIMIT.indexMs, '≤' + LIMIT.indexMs + 'ms · 中位数（3 次）');
add('半实物', '单章读取 均值 / p95', semi.read == null ? '失败' : semi.read.avg.toFixed(4) + ' / ' + semi.read.p95.toFixed(4), 'ms', !!semi.read && semi.read.p95 <= LIMIT.readMs, '≤' + LIMIT.readMs + 'ms · 200 次抽样');
add('半实物', '分章结果自洽', semi.chapters == null ? '失败' : semi.chapters + ' 章', '', semi.chapters === LIMIT.chapters, semi.err || '偏移表闭合 · 章数对齐 · sid 无撞车');

add('对账', '文案数字 vs 代码真值', fact ? fact.ok + ' 一致 / ' + fact.bad + ' 不一致' : '失败', '', !!fact && fact.bad === 0, fact ? '无可比对声明 ' + fact.none + ' 条（工具原样输出）' : factRun.out.trim().split('\n').slice(-3).join(' '));

/* ============ 打印 ============ */
const reds = rows.filter((r) => r.ok === false);
const verdict = reds.length === 0;

if (AS_JSON) {
  console.log(JSON.stringify({
    file: path.relative(ROOT, FILE),
    node: process.version,
    limits: LIMIT,
    rows: rows.map((r) => ({ sec: r.sec, name: r.name, value: r.value, unit: r.unit, ok: r.ok, note: r.note })),
    reds: reds.map((r) => r.name),
  }, null, 2));
} else {
  console.log('');
  console.log(C.b + '══ 北风 验收数字 · ' + path.relative(ROOT, FILE) + ' · ' + new Date().toISOString().slice(0, 19).replace('T', ' ') + ' ══' + C.n);
  console.log(C.d + '   node ' + process.version + ' · ' + process.platform + ' ' + process.arch + ' · ' + os.cpus().length + ' 核' + C.n);
  let sec = '';
  for (const r of rows) {
    if (r.sec !== sec) { sec = r.sec; console.log('\n' + C.b + '【' + sec + '】' + C.n); }
    const mark = r.ok === true ? C.g + '  ✓' + C.n : r.ok === false ? C.r + '  ✗' + C.n : C.y + '  ·' + C.n;
    console.log(mark + ' ' + pad(r.name, 30) + pad(String(r.value), 16) + pad(r.unit, 4) + C.d + r.note + C.n);
  }
  console.log('');
  if (verdict) console.log(C.g + '══ 红线全过（' + rows.filter((r) => r.ok === true).length + ' 项判据）══' + C.n);
  else {
    console.log(C.r + '══ 未过：' + reds.map((r) => r.name).join(' / ') + ' ══' + C.n);
    console.log(C.d + '   没到就是没到：这一版不签字，先把数字做进红线以内。' + C.n);
  }
  console.log('');
}

process.exitCode = (verdict || REPORT_ONLY) ? 0 : 1;
