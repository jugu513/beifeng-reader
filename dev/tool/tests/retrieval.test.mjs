/* 问书检索判据（只读母本，不改产品）。
   两件事分开验，因为它们会各自单独坏掉：
     ① 打分口径——旧口径「命中数 ÷ √块长」没有 IDF、词频不饱和，问题里的虚词
        能把无关长段顶到最前。这里留着旧实现作对照，同一批语料、同一个按章去重，
        谁召回高是算出来的，不是宣称的。
     ② 索引落盘——刷新或换标签页后不必再逐章解压。假 IDB 用 JSON 往返模拟结构化克隆，
        账本（ai.chunk.meta）与正文键要对得上：孤儿键要清、幽灵条目要撤、预算要守住。
   反证写在三处：BM25 的 b 拨成 0 后长块归一必须失效（参数确实被消费）；
   隐私模式开启时一个键都不写、每次都重读正文；扫到一半被中断的索引既不冒充完整、也不落盘。 */
import vm from 'node:vm';
import { readMaster } from '../harness.mjs';
import { TXT } from '../patch.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};
const settle = () => new Promise((r) => setTimeout(r, 25));

const src = readMaster(TXT);
function slice(startMark, endMark, label) {
  const a = src.indexOf(startMark);
  const b = src.indexOf(endMark, a + startMark.length);
  if (a < 0 || b < 0) { console.error('找不到' + label + '（母本结构变了？）'); process.exit(2); }
  return src.slice(a, b);
}
const KW_SRC = slice('BF.ai._keywords = function (q) {', '/* ---- 分块索引', '分词段');
const RANK_SRC = slice('BF.ai._BM25 = { k1: 1.2, b: 0.75 };', 'BF.ai.retrieve = async function', '打分段');
const IDX_SRC = slice('BF.ai.chunkIdx = (function () {', '/* 打分用 BM25', '分块索引段');

/* ---------- 假环境 ---------- */
function mkStore() {
  const map = new Map();
  const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));   /* 结构化克隆的近似：写了不可克隆的东西会在这里炸 */
  return {
    map,
    idbKeyGet: async (k, d) => (map.has(k) ? clone(map.get(k)) : d),
    idbKeyPut: async (k, v) => { map.set(k, clone(v)); return true; },
    idbKeyDelete: async (k) => { map.delete(k); return true; },
    idbAllKeys: async () => Array.from(map.keys()),
    idbDeleteMany: async (_store, keys) => { keys.forEach((k) => map.delete(k)); return keys.length; },
    keysOf: (prefix) => Array.from(map.keys()).filter((k) => k.indexOf(prefix) === 0 && k !== 'ai.chunk.meta'),
  };
}
function mkIdxEnv(store, opts) {
  opts = opts || {};
  const settings = Object.assign({ aiRefBook: true, privacyMode: false }, opts.settings || {});
  const io = { reads: 0 };
  const BF = {
    ai: {},
    settings: { get: (k) => settings[k] },
    appState: { currentChapterIdx: opts.current == null ? 0 : opts.current },
    library: {
      /* 同步抛＝取章这条基础线路整个坏掉（外层 catch 会中止扫描）；
         单章正文缺失则由内层 catch 折成空串，不影响其余章。两种失败分开测。 */
      getChapterText: function (b, n) {
        if (opts.hook) opts.hook(io);
        io.reads++;
        if (opts.failAt != null && n === opts.failAt) throw new Error('模拟读章失败');
        return Promise.resolve(opts.texts[n] || '');
      },
      /* 分块索引现在走 readChapter（要区分「读不到」与「本来就是空章」） */
      readChapter: function (b, n) {
        if (opts.hook) opts.hook(io);
        io.reads++;
        if (opts.failAt != null && n === opts.failAt) throw new Error('模拟读章失败');
        return Promise.resolve({ ok: true, text: opts.texts[n] || '' });
      },
    },
    err: { report: (w, e) => { (BF.__errs = BF.__errs || []).push(w + ':' + (e && e.message)); } },
    log: { info: () => {}, warn: () => {} },
    store,
  };
  const sandbox = { BF, console, Date, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Error, setTimeout, clearTimeout, AbortController };
  vm.createContext(sandbox);
  vm.runInContext(IDX_SRC + '\nthis.__idx = BF.ai.chunkIdx;', sandbox);
  return { idx: sandbox.__idx, BF, settings, io };
}
function mkRankEnv() {
  const BF = { ai: {} };
  const sandbox = { BF, console, Math, JSON, Object, Array, String, Number, Error };
  vm.createContext(sandbox);
  vm.runInContext(KW_SRC + '\n' + RANK_SRC + '\nthis.__ai = BF.ai;', sandbox);
  return sandbox.__ai;
}

/* ---------- 对照组：改造前的打分口径（逐字搬自被替换的实现） ---------- */
function rankLegacy(chunks, kws) {
  const scored = [];
  chunks.forEach(function (c) {
    let score = 0, first = -1;
    kws.forEach(function (w) {
      let p = c.text.indexOf(w), n = 0;
      while (p !== -1 && n < 30) { score++; if (first < 0 || p < first) first = p; p = c.text.indexOf(w, p + w.length); n++; }
    });
    if (score > 0) scored.push({ ch: c.ch, off: c.off, first: first, score: score, len: c.text.length });
  });
  scored.forEach(function (s) { s.ns = s.score / Math.sqrt(s.len || 1); });
  scored.sort(function (a, x) { return x.ns - a.ns; });
  return scored;
}
/* 两个口径共用同一份「按章去重取前 K 章」，否则比的是去重策略而不是打分 */
function topChapters(ranked, k) {
  const seen = {}, out = [];
  for (const s of ranked) { if (seen[s.ch]) continue; seen[s.ch] = true; out.push(s.ch); if (out.length >= k) break; }
  return out;
}

const ai = mkRankEnv();

/* ---------- 一、打分口径 ---------- */
console.log('\n[打分口径]');
ok('空索引 / 空词表都不打分', ai._rank([], ['张三']).length === 0 && ai._rank([{ ch: 0, off: 0, text: '张三' }], []).length === 0);

/* 语料：虚词「时候」每章都有而且重复十次，专名「灯塔」只在第 7 章出现一次。
   旧口径数命中个数，长章靠虚词刷分；BM25 认词的稀有度。 */
const corpus = [];
for (let ch = 0; ch < 12; ch++) {
  corpus.push(ch === 7
    ? { ch, off: 0, text: '灯塔下面站着守塔人的女儿。' }
    : { ch, off: 0, text: '那时候他坐在窗前，时候不早了，时候总是这样过去。'.repeat(5) });
}
const q = ai._keywords('时候 灯塔 下面 站着 谁');
const bm = ai._rank(corpus, q);
const lg = rankLegacy(corpus, q);
ok('中文问题被切成词与二元词', q.length >= 4 && q.indexOf('灯塔') >= 0 && q.indexOf('时候') >= 0, q.slice(0, 6).join('/'));
ok('BM25 把唯一含专名的章排第一', bm.length > 0 && bm[0].ch === 7, '首位=' + (bm[0] && bm[0].ch));
ok('旧口径把虚词长段排第一（缺陷复现）', lg.length > 0 && lg[0].ch !== 7, '旧首位=' + (lg[0] && lg[0].ch) + ' 旧前三=' + topChapters(lg, 3).join(','));

const rep = ai._rank([
  { ch: 0, off: 0, text: '锚' + 'x'.repeat(200) },
  { ch: 1, off: 0, text: '锚'.repeat(20) + 'x'.repeat(200) },
], ['锚']);
const s1 = rep.find((r) => r.ch === 0).score, s20 = rep.find((r) => r.ch === 1).score;
ok('词频二十倍不等于分数二十倍', s20 / s1 < 5 && s20 > s1, '比值=' + (s20 / s1).toFixed(2));

const lenRank = ai._rank([
  { ch: 0, off: 0, text: '锚出现在短句' },
  { ch: 1, off: 0, text: '填充文字'.repeat(60) + '锚出现在长句' },
], ['锚']);
ok('同词频下短块优先', lenRank[0].ch === 0, '首位=' + lenRank[0].ch);

const allSame = ai._rank([
  { ch: 0, off: 0, text: '常常常常' }, { ch: 1, off: 0, text: '常常常常' }, { ch: 2, off: 0, text: '常常常常' },
], ['常']);
ok('每块都命中的词给不出排名优势', allSame.length === 3 && allSame.every((r) => r.score === allSame[0].score), '分数=' + allSame[0].score.toFixed(6));

const two = ai._rank([{ ch: 0, off: 0, text: '甲字' }, { ch: 1, off: 0, text: '无关' }], ['甲字']);
const K1 = ai._BM25.k1, N = 2, df = 1;
const expect = Math.log(1 + (N - df + 0.5) / (df + 0.5)) * (1 * (K1 + 1)) / (1 + K1 * (1 - ai._BM25.b + ai._BM25.b * 2 / 2));
ok('分数与 BM25 公式逐位对齐', Math.abs(two[0].score - expect) < 1e-9, two[0].score.toFixed(6) + ' vs ' + expect.toFixed(6));
ok('命中锚点取最靠前的位置', ai._rank([{ ch: 0, off: 900, text: '前面没有词，后面有目标词在这里' }], ['目标词'])[0].first === 9);

const beforeB = ai._BM25.b;
ai._BM25.b = 0;
const noNorm = ai._rank([{ ch: 0, off: 0, text: '锚' }, { ch: 1, off: 0, text: '锚' + '填充'.repeat(80) }], ['锚']);
ai._BM25.b = beforeB;
const withNorm = ai._rank([{ ch: 0, off: 0, text: '锚' }, { ch: 1, off: 0, text: '锚' + '填充'.repeat(80) }], ['锚']);
ok('反证：b 拨成 0 后长块不再被压（b 真被消费）', noNorm[0].score === noNorm[1].score && withNorm[0].score > withNorm[1].score);

/* ---------- 二、召回对照（A/B） ---------- */
console.log('\n[召回对照]');
const FIX = [];
(function () {
  const filler = '那一天下了雨，雨声落在瓦上。时候不早，街上没有人。';
  for (let ch = 0; ch < 12; ch++) {
    let t = filler;
    if (ch === 2) t += '船长把航海图摊开，图上标着一座废弃的灯塔，坐标是东经一百二十度。';
    else if (ch === 5) t += '守塔人的女儿学会用摩尔斯电码，滴答滴答，灯塔重新亮了。';
    else if (ch === 9) t += '航海图后来被烧掉，只剩下灯塔那一页，纸边焦黑。';
    else if (ch === 11) t += '东经一百二十度的海域上，新的灯塔在冬天完工，塔身刷成白色。';
    else t += '灯塔。'.repeat(10) + '守夜的人把故事讲了一遍又一遍。';   /* 干扰章：同一个词刷十次 */
    FIX.push({ ch, off: 0, text: t });
  }
})();
const CASES = [
  { name: '废弃灯塔的坐标', q: '废弃的灯塔在哪个坐标', want: 2 },
  { name: '谁让灯塔重新亮', q: '灯塔 重新 亮了 谁', want: 5 },
  { name: '烧掉的航海图', q: '被烧掉的航海图剩下什么', want: 9 },
  { name: '冬天完工的灯塔', q: '冬天 完工 灯塔 什么颜色', want: 11 },
  { name: '全是虚词的问法', q: '那时候雨声落在瓦上', want: -1 },
];
const KTOP = 3;
let pBm = 0, pLg = 0, rrBm = 0, rrLg = 0, better = 0;
const rr = (arr, w) => { const i = arr.indexOf(w); return i < 0 ? 0 : 1 / (i + 1); };
for (const c of CASES) {
  const kws = ai._keywords(c.q);
  const bmCh = topChapters(ai._rank(FIX, kws), KTOP);
  const lgCh = topChapters(rankLegacy(FIX, kws), KTOP);
  if (c.want >= 0) {
    const hitBm = bmCh.indexOf(c.want) >= 0 ? 1 : 0;
    const hitLg = lgCh.indexOf(c.want) >= 0 ? 1 : 0;
    pBm += hitBm; pLg += hitLg;
    rrBm += rr(bmCh, c.want); rrLg += rr(lgCh, c.want);
    if (hitBm > hitLg || rr(bmCh, c.want) > rr(lgCh, c.want)) better++;
  }
  console.log('    ' + c.name + '：BM25@3=' + bmCh.join(',') + ' | 旧口径@3=' + lgCh.join(',') + ' | 标注=' + (c.want < 0 ? '—' : '第' + c.want + '章'));
}
const labeled = CASES.filter((c) => c.want >= 0).length;
ok('BM25 标注问题全部命中@3', pBm === labeled, pBm + '/' + labeled);
ok('旧口径确有漏检（对照成立）', pLg < pBm, '旧 ' + pLg + '/' + labeled + ' → 新 ' + pBm + '/' + labeled);
ok('BM25 的 MRR 严格高于旧口径', rrBm > rrLg, 'RR=' + rrBm.toFixed(3) + ' vs 旧 ' + rrLg.toFixed(3));
ok('至少一条标注问题被 BM25 救回', better >= 1, '救回 ' + better + ' 条');
ok('全虚词问法也给出满额结果（不退化）', topChapters(ai._rank(FIX, ai._keywords('那时候雨声落在瓦上')), KTOP).length === KTOP);

/* ---------- 三、索引落盘 ---------- */
console.log('\n[索引落盘]');
const mkTexts = (n, size) => {
  const unit = '正文填充。锚点词在灯塔里发光。';   /* 13 字 */
  const repN = Math.max(1, Math.ceil(size / unit.length));
  return Array.from({ length: n }, (_, i) => '第' + i + '章 ' + unit.repeat(repN));
};
const bookA = { id: 'bkA', totalChapters: 30, wordCount: 60000 };

(async function () {
  /* 1) 首次构建：落一个正文键 + 一条账本 */
  const store = mkStore();
  const env = mkIdxEnv(store, { texts: mkTexts(30, 900), current: 29 });
  const c1 = await env.idx.build(bookA, {});
  await env.idx.sync(); await settle();
  const hashA = env.idx.hashOf(bookA);
  const meta = store.map.get('ai.chunk.meta');
  ok('构建后落一个正文键', store.map.has('ai.chunk.' + hashA), '块数=' + c1.length);
  ok('账本记下字节数与时间', !!(meta && meta[hashA] && meta[hashA].bytes > 0 && meta[hashA].at > 0));
  ok('账本条数 = 正文键数', Object.keys(meta).length === store.keysOf('ai.chunk.').length);

  /* 2) 新会话（内存空）读落盘：一次正文都不读 */
  const env2 = mkIdxEnv(store, { texts: mkTexts(30, 900), current: 29 });
  const c2 = await env2.idx.build(bookA, {});
  ok('换会话命中落盘、零正文读取', c2.length === c1.length && env2.io.reads === 0, '读取=' + env2.io.reads);
  ok('落盘内容与原索引逐字一致', JSON.stringify(c2) === JSON.stringify(c1));
  ok('stats 认得落盘副本', env2.idx.stats().disk === 1 && env2.idx.stats().mem === 1, JSON.stringify(env2.idx.stats()));

  /* 3) 反证：隐私模式一个键都不写，第二次照样逐章读 */
  const storeNo = mkStore();
  const envNo = mkIdxEnv(storeNo, { texts: mkTexts(30, 900), current: 29, settings: { privacyMode: true } });
  await envNo.idx.build(bookA, {});
  await envNo.idx.sync(); await settle();
  const envNo2 = mkIdxEnv(storeNo, { texts: mkTexts(30, 900), current: 29, settings: { privacyMode: true } });
  await envNo2.idx.build(bookA, {});
  ok('反证：隐私模式不落盘且每次重读正文', storeNo.map.size === 0 && envNo2.io.reads === 30, '键数=' + storeNo.map.size + ' 读取=' + envNo2.io.reads);

  /* 4) 重新分章 → 哈希变 → 旧切法被覆盖删掉 */
  const bookA2 = { id: 'bkA', totalChapters: 31, wordCount: 62000 };
  const env3 = mkIdxEnv(store, { texts: mkTexts(31, 900), current: 30 });
  await env3.idx.build(bookA2, {});
  await env3.idx.sync(); await settle();
  const keysOfA = store.keysOf('ai.chunk.bkA:');
  ok('同书旧切法被清掉，只留最新一份', keysOfA.length === 1 && keysOfA[0] === 'ai.chunk.' + env3.idx.hashOf(bookA2), '本书键=' + keysOfA.join(','));

  /* 5) 小索引不值得落盘 */
  const storeSmall = mkStore();
  const envS = mkIdxEnv(storeSmall, { texts: Array.from({ length: 4 }, (_, i) => '小书第' + i + '章'), current: 3 });
  await envS.idx.build({ id: 'bkS', totalChapters: 4, wordCount: 200 }, {});
  await envS.idx.sync(); await settle();
  ok('少于 24 块不落盘', storeSmall.map.size === 0, '键数=' + storeSmall.map.size);

  /* 6) 中断：半本不落盘，也不许冒充完整索引 */
  const storeAb = mkStore();
  const ac = new AbortController();
  const envAb = mkIdxEnv(storeAb, { texts: mkTexts(30, 900), current: 29, hook: (io) => { if (io.reads >= 6) ac.abort(); } });
  const cAb = await envAb.idx.build(bookA, { signal: ac.signal });
  await envAb.idx.sync(); await settle();
  ok('中断后不落半本索引', storeAb.map.size === 0, '键数=' + storeAb.map.size);
  ok('中断只扫到前半本', cAb.length > 0 && cAb.length < 60, '块数=' + cAb.length);
  const readsAt = envAb.io.reads;
  const cFull = await envAb.idx.build(bookA, {});   /* 同一个 env：内存里存着半本 */
  await envAb.idx.sync(); await settle();
  ok('半本索引不冒充完整（再检索重读正文）', envAb.io.reads > readsAt && cFull.length > cAb.length, '读取 ' + readsAt + '→' + envAb.io.reads);
  ok('扫完后再落盘', storeAb.map.has('ai.chunk.' + hashA));

  /* 7) 读章失败同样不落盘 */
  const storeFail = mkStore();
  const envF = mkIdxEnv(storeFail, { texts: mkTexts(30, 900), current: 29, failAt: 12 });
  await envF.idx.build(bookA, {});
  await envF.idx.sync(); await settle();
  ok('读章失败不落半本索引', storeFail.map.size === 0, '键数=' + storeFail.map.size);

  /* 8) 预算：塞满后按最久未用淘汰，淘汰的键真被删 */
  const storeB = mkStore();
  const cap = mkIdxEnv(mkStore(), {}).idx.stats().cap;
  const minChunks = mkIdxEnv(mkStore(), {}).idx.stats().minChunks;
  const bigTexts = mkTexts(30, 14000);
  const written = [];
  for (let i = 0; i < 12; i++) {
    const e = mkIdxEnv(storeB, { texts: bigTexts, current: 29 });
    const bk = { id: 'bkBig' + i, totalChapters: 30, wordCount: 420000 };
    const cb = await e.idx.build(bk, {});
    await e.idx.sync(); await settle();
    written.push({ hash: e.idx.hashOf(bk), n: cb.length });
  }
  const mB = storeB.map.get('ai.chunk.meta');
  const bytes = Object.keys(mB).reduce((s, h) => s + mB[h].bytes, 0);
  ok('每本都够落盘门槛', written.every((w) => w.n >= minChunks), '最小块数=' + Math.min.apply(null, written.map((w) => w.n)));
  ok('落盘总量守住预算', bytes <= cap, bytes + ' ≤ ' + cap);
  ok('淘汰后账本与键一一对应', storeB.keysOf('ai.chunk.').length === Object.keys(mB).length, '键=' + storeB.keysOf('ai.chunk.').length + ' 账本=' + Object.keys(mB).length);
  ok('预算内留的是最新的几本（LRU 留新）', mB[written[written.length - 1].hash] != null && mB[written[0].hash] == null);
  ok('被淘汰的正文键真被删掉', !storeB.map.has('ai.chunk.' + written[0].hash));
  const envB2 = mkIdxEnv(storeB, { texts: bigTexts, current: 29 });
  const reRead = await envB2.idx.build({ id: 'bkBig0', totalChapters: 30, wordCount: 420000 }, {});
  ok('被淘汰的书重读正文重建', envB2.io.reads === 30 && reRead.length > 0, '读取=' + envB2.io.reads);

  /* 9) 对账：孤儿键清掉、幽灵条目撤掉 */
  const storeR = mkStore();
  storeR.map.set('ai.chunk.bkGhost:9:9', { chunks: [{ ch: 0, off: 0, text: '没人引用的正文副本' }], limit: 9, bytes: 100, at: 1 });
  const envR = mkIdxEnv(storeR, { texts: mkTexts(30, 900), current: 29 });
  await envR.idx.build(bookA, {});
  await envR.idx.sync(); await settle();
  ok('账本外的前缀键被对账删掉', !storeR.map.has('ai.chunk.bkGhost:9:9'));
  const mm = storeR.map.get('ai.chunk.meta');
  mm['bkNever:1:1'] = { at: 1, bytes: 50 };
  storeR.map.set('ai.chunk.meta', mm);
  const envR2 = mkIdxEnv(storeR, { texts: mkTexts(30, 900), current: 29 });
  await envR2.idx.build(bookA, {});
  await envR2.idx.sync(); await settle();
  ok('键不存在的账本条目被撤掉', (storeR.map.get('ai.chunk.meta') || {})['bkNever:1:1'] == null, '账本=' + Object.keys(storeR.map.get('ai.chunk.meta')).length);

  /* 10) 坏记录当未命中并重建 */
  const storeBad = mkStore();
  const envBad = mkIdxEnv(storeBad, { texts: mkTexts(30, 900), current: 29 });
  await envBad.idx.build(bookA, {});
  await envBad.idx.sync(); await settle();
  storeBad.map.set('ai.chunk.' + hashA, { limit: 30, at: 1, bytes: 10 });   /* chunks 字段没了 */
  const envBad2 = mkIdxEnv(storeBad, { texts: mkTexts(30, 900), current: 29 });
  const cBad = await envBad2.idx.build(bookA, {});
  ok('读不出索引时按未命中重建', cBad.length > 0 && envBad2.io.reads === 30, '读取=' + envBad2.io.reads);

  /* 11) 删书：内存与落盘一起清 */
  const storeD = mkStore();
  const envD = mkIdxEnv(storeD, { texts: mkTexts(30, 900), current: 29 });
  await envD.idx.build(bookA, {});
  await envD.idx.sync(); await settle();
  ok('删书前确有落盘副本', storeD.map.has('ai.chunk.' + hashA) && !!storeD.map.get('ai.chunk.meta')[hashA]);
  envD.idx.invalidate(String(bookA.id));
  await envD.idx.sync(); await settle();
  ok('删书连带删正文键', !storeD.map.has('ai.chunk.' + hashA));
  ok('删书连带撤账本条目', (storeD.map.get('ai.chunk.meta') || {})[hashA] == null);
  ok('删书后内存索引为空', envD.idx.size() === 0);
  ok('全程无未捕获错误上报', (envD.BF.__errs || []).length === 0, (envD.BF.__errs || []).join(' | '));

  console.log('\n=== 检索与索引: ' + pass + ' pass / ' + fail + ' fail ===');
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => { console.error('测试自身崩溃：' + (e && e.stack)); process.exit(2); });
