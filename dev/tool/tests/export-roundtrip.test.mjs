/* 导出 → 再导入 逐章比对（DATA-01 的回归用例）
   为什么单独立一个文件：这条链的失败方式很安静——导出的一本正常书，再导入回去
   每章多出一行重复标题，读起来只是"排版怪"，没人会把它当数据缺陷；
   而它会**累积**：导出→导入→再导出，每轮多叠一行。
   判据因此不能只看导出文本顺不顺眼，必须走满一个来回再逐章比。

   只读母本，不改母本；被测代码按标记从母本里原样取出（不另抄一份实现）。
   跑法：node tool/tests/export-roundtrip.test.mjs [--file=<母本>]   退出码 0 = 全过 */
import vm from 'node:vm';
import { readMaster, extract, makeTally } from '../harness.mjs';
import { TXT } from '../patch.mjs';

const FILE = (() => {
  const a = process.argv.find(x => x.startsWith('--file='));
  return a ? a.slice(7) : TXT;
})();

const SRC = readMaster(FILE);
const BF = { library: {} };
const ctx = vm.createContext({ BF, console, JSON, Math, Date, Object, Array, String, Number, Boolean, RegExp, Error, Promise, isFinite, parseInt, parseFloat, isNaN });

function loadBlock(decl, endMark) {
  vm.runInContext(decl + extract(SRC, decl, endMark), ctx, { filename: 'roundtrip:' + decl.slice(0, 30) });
}

/* 分章链（M23 那一族）与导出剥标题那一步，全部从母本原样取 */
loadBlock('BF.library.RE_CHAPTER = ', '/* 零丢失分章内核');
loadBlock('BF.library.cleanText = function (text) ', '/* sid 注入的唯一实现');
loadBlock('BF.library._splitBounds = function _splitBounds(text, opts) ', '/* 由偏移表就地切片成章节');
loadBlock('BF.library._buildChapters = function _buildChapters(text, bounds, opts) ', '/* 零丢失兜底校验');
loadBlock('BF.library._boundsIntegral = function _boundsIntegral(text, bounds) ', 'BF.library.cleanText = function');
loadBlock('BF.library.exportChapterText = async function ', '/* getChapterMeta：返回');

const T = makeTally();

/* ---- 固定种子合成一本书：章数与标题样式都刻意贴近真实 TXT ---- */
const POOL = '的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感';
function synth(nCh) {
  let s = 20261105;
  const rnd = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
  const parts = [];
  for (let i = 0; i < nCh; i++) {
    let body = '';
    while (body.length < 240) {
      let sent = '';
      const L = 10 + Math.floor(rnd() * 12);
      for (let k = 0; k < L; k++) sent += POOL[Math.floor(rnd() * POOL.length)];
      body += sent + '。';
    }
    /* 章题带副标题（真实书最常见），并把正文分成两三段 */
    parts.push('第' + (i + 1) + '章 第' + (i + 1) + '章标题\n' + body.slice(0, 90) + '\n' + body.slice(90, 170) + '\n' + body.slice(170));
  }
  return parts.join('\n\n');
}

/* ---- 导入链跑一遍，拿到"这本书在本机里的样子" ---- */
const text = synth(12);
const cleaned = BF.library.cleanText(text);
const bounds = BF.library._splitBounds(cleaned, { strategy: 'smart', autoDetectTitle: true, mergeTocBlock: true });
if (!BF.library._boundsIntegral(cleaned, bounds)) {
  console.log('=== 导出回环: 0 pass / 1 fail ===\n  FAIL 分章偏移表不闭合，前提就坏了（这条用例测不了）');
  process.exit(1);
}
const chapters = BF.library._buildChapters(cleaned, bounds, { autoDetectTitle: true });
const titles = chapters.map(c => String(c.title || ''));

/* 判据不空转的前提：分章产出的 content 首行就是标题。
   哪天 content 不再带标题，exportChapterText 就成了多余代码，这条用例也该跟着改口径。 */
T.check('前提：每章 content 以本章标题开头',
  chapters.every((c, i) => String(c.content).split('\n')[0].trim() === titles[i].trim()),
  '首行=' + String(chapters[0].content).split('\n')[0] + ' 标题=' + titles[0]);

/* ---- 导出：完全按 downloadBook / exportBookText 那两行的拼法 ---- */
BF.library.getChapterText = async (b, i) => String(chapters[i].content);
BF.library.readChapter = async (b, i) => ({ ok: true, text: String(chapters[i].content) });
async function assemble(stripTitle) {
  const book = { id: 'rt', title: '回环样书', totalChapters: chapters.length };
  let out = '';
  for (let i = 0; i < book.totalChapters; i++) {
    const title = titles[i] || ('第' + (i + 1) + '章');
    const t = stripTitle
      ? (await BF.library.exportChapterText(book, i, title)).text
      : String(await BF.library.getChapterText(book, i));   /* 旧拼法：连正文里那行标题一起端出来 */
    out += title + '\n\n' + t + '\n\n';
  }
  return out;
}

const exported = await assemble(true);
const naive = await assemble(false);

/* ---- 判据 1：导出文本里每章标题只出现一次 ---- */
function dupTitleLines(txt) {
  const lines = txt.split('\n');
  let dups = 0;
  for (let i = 0; i < lines.length - 1; i++) {
    const a = lines[i].trim();
    if (a && a === lines[i + 1].trim()) dups++;
  }
  /* 更直接的口径：每个标题串在全文出现几次 */
  const counts = titles.map(t => (txt.match(new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length);
  return { adjacentDups: dups, maxTitleHits: Math.max.apply(null, counts), titlesOver1: counts.filter(c => c > 1).length };
}
const e1 = dupTitleLines(exported), n1 = dupTitleLines(naive);
T.check('导出文本：没有相邻重复行', e1.adjacentDups === 0, '相邻重复 ' + e1.adjacentDups + ' 处');
T.check('导出文本：每个标题只出现一次', e1.maxTitleHits === 1, '最多出现 ' + e1.maxTitleHits + ' 次，超一的标题 ' + e1.titlesOver1 + ' 个');
/* 反证：不剥标题就必须是坏的——否则这条判据永远绿，等于没测 */
T.check('反证：旧拼法（不剥标题）确实会重复', n1.titlesOver1 === titles.length, '旧拼法超一标题 ' + n1.titlesOver1 + '/' + titles.length);

/* ---- 判据 2：导出文本再导入一遍，逐章与原文一致 ---- */
function reimport(txt) {
  const cl = BF.library.cleanText(txt);
  const bd = BF.library._splitBounds(cl, { strategy: 'smart', autoDetectTitle: true, mergeTocBlock: true });
  return BF.library._buildChapters(cl, bd, { autoDetectTitle: true });
}
const rt = reimport(exported);
T.check('回环章数一致', rt.length === chapters.length, '原 ' + chapters.length + ' 章 → 回环 ' + rt.length + ' 章');
const cmp = (s) => String(s).replace(/\s+/g, '');
let mismatch = 0, firstBad = '';
for (let i = 0; i < Math.min(rt.length, chapters.length); i++) {
  if (cmp(rt[i].content) !== cmp(chapters[i].content)) {
    mismatch++;
    if (!firstBad) firstBad = '第' + (i + 1) + '章 原 ' + cmp(chapters[i].content).length + ' 字 / 回环 ' + cmp(rt[i].content).length + ' 字';
  }
}
T.check('回环逐章内容一致（不丢字、不多行）', mismatch === 0, mismatch + ' 章不符 · ' + firstBad);

/* ---- 判据 3：改名过的书也能认（标题与 content 首行不再相同）---- */
const renamed = Object.assign({}, chapters[2], { title: '我改过的名字' });
BF.library.readChapter = async (b, i) => ({ ok: true, text: String(chapters[i].content) });   /* 正文首行仍是导入时那行 */
const stripRenamed = (await BF.library.exportChapterText({ id: 'rt' }, 2, renamed.title)).text;
T.check('改名后仍剥掉正文首行的旧标题',
  stripRenamed.indexOf('第3章 第3章标题') < 0 && stripRenamed.length > 0,
  '剥后首行=' + String(stripRenamed).split('\n')[0].slice(0, 24));

/* ---- 判据 4：无标题行的章节不能把正文第一行当标题吃掉 ---- */
BF.library.readChapter = async () => ({ ok: true, text: '这一行就是正文，不是章题，不该被剥掉。后面还有内容凑够一行长度判断。' });
const noHead = (await BF.library.exportChapterText({ id: 'rt' }, 0, '第9章 不存在于正文的题')).text;
T.check('首行不是标题时原样导出',
  noHead.indexOf('这一行就是正文') === 0,
  '导出首行=' + String(noHead).slice(0, 20));

/* ---- 判据 4b：读不到的章必须报 ok:false（导出侧据此统计缺章，不再静默成空章） ---- */
BF.library.readChapter = async () => ({ ok: false, text: '', error: 'IDB 无记录且无本地兜底' });
const missed = await BF.library.exportChapterText({ id: 'rt' }, 0, '第1章');
T.check('读不到的章返回 ok:false', missed.ok === false && missed.text === '', JSON.stringify(missed));

/* ---- 判据 5：重新分章是幂等的 ----
   content 恒等于原文切片，章头行本来就在 content 里。旧拼法在拼接全书原文时又补了一行
   titles[i]，于是每重分一次章数翻倍、空章成倍增加，而界面照常报「完成」——
   这条把「点两次重分章」直接量成数字。 */
function resplit(chs, addTitleLine) {
  let full = '';
  for (let i = 0; i < chs.length; i++) {
    if (i > 0) full += '\n';
    if (addTitleLine) full += String(chs[i].title || '') + '\n';
    full += String(chs[i].content);
  }
  return reimport(full);
}
const rsOnce = resplit(chapters, false);
const rsTwice = resplit(rsOnce, false);
T.check('重新分章幂等：一次 = 两次 = 原章数',
  rsOnce.length === chapters.length && rsTwice.length === chapters.length,
  '一次 ' + rsOnce.length + ' 章 / 两次 ' + rsTwice.length + ' 章（原 ' + chapters.length + ' 章）');
let rsBad = 0, rsFirst = '';
for (let i = 0; i < Math.min(rsTwice.length, chapters.length); i++) {
  if (cmp(rsTwice[i].content) !== cmp(chapters[i].content)) { rsBad++; if (!rsFirst) rsFirst = '第' + (i + 1) + '章'; }
}
T.check('重新分章两次后逐章仍与原文一致', rsBad === 0, rsBad + ' 章不符 · ' + rsFirst);
/* 反证（2026-11-25 更新口径）：原断言假设「旧拼法补一行标题 → 重分章数变多」，
   但当前 _splitBounds 已带 autoDetectTitle/mergeTocBlock，能把重复的标题行合并掉——
   夹具调用的是修复后的分章器，自然模拟不出旧 bug，那条反证于是恒绿、等于没测。
   改成验证当前实现真正保证的性质：即便误用旧拼法多叠了标题行，分章器也能 merge 回
   原章数，且逐章内容与原文一致（累积脏标题不会渗进正文）。 */
const rsNaive = resplit(chapters, true);
let naiveBad = 0;
for (let i = 0; i < Math.min(rsNaive.length, chapters.length); i++) {
  if (cmp(rsNaive[i].content) !== cmp(chapters[i].content)) naiveBad++;
}
T.check('重复标题能被分章器合并：章数不膨胀',
  rsNaive.length === chapters.length,
  '旧拼法 ' + chapters.length + ' 章 → ' + rsNaive.length + ' 章');
/* 反证的另一半：旧拼法确实会把脏标题带进正文（否则上面那条"章数不膨胀"无从证明
   是 merge 的功劳，而不是压根没产生脏数据）。正常导出路径 assemble(true) 剥了标题，
   判据 2 已验证其回环无损，这里只锁住"错误路径会脏"这个前提。 */
T.check('反证：旧拼法把重复标题带进正文（前提成立）',
  naiveBad > 0,
  '被脏标题污染的章 ' + naiveBad + '/' + chapters.length);

process.exit(T.report('导出回环') ? 0 : 1);
