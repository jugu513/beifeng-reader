/* 分页长段切分判据（只读母本，不改产品）。
   分页模式按「段」填页，而一段本身高过一页时，那一页会比视口高几十倍：
   真机上实测过一章 21,760 字只有一段 → 1 页 / 进度恒 100% / 翻页按下去没有下一页 / 只有 3% 可见。
   切分只发生在显示层（源段落空间一个字都不动），所以这里最硬的一条是守恒：
   把每页的条目按页序拼回去，必须与原 paras 逐字相等。
   反证用旧实现（整段塞一页）跑同一批输入，它必须产出一页高过视口的页——
   否则这条判据就是在给一个不存在的 bug 站岗。 */
import vm from 'node:vm';
import { readMaster } from '../harness.mjs';
import { TXT } from '../patch.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};

const src = readMaster(TXT);
const A = src.indexOf('BF.reader._paraCutAt = function');
const B = src.indexOf('BF.reader._pageSig = function', A);
if (A < 0 || B < 0) { console.error('找不到分页切段段（母本结构变了？）'); process.exit(2); }

const VH = 600, FS = 16, LH = 1.9, PAGEW = 640;
const BF = { reader: {}, settings: { num: (k, d) => (k === 'paraSpacing' ? 1 : d) } };
const sandbox = { BF, console, Math, Number, String, Array, Object, JSON };
vm.createContext(sandbox);
sandbox.BF = BF;
vm.runInContext(src.slice(A, B) + '\nthis.__r = BF.reader;', sandbox);
const R = sandbox.__r;
/* 每行字数固定成可算的数：真机上 _pageMetrics 会量段落盒子，
   这里要判的是「切完之后每页装不装得下」，不是量宽本身。 */
R._pageMetrics = function (fs) { return Math.floor(PAGEW / fs); };
const perLine = R._pageMetrics(FS);
const avail = Math.max(FS * LH, VH - 60);
const h = (t) => R._estParaH(t, FS, LH, perLine, 1);

/* 旧实现（改造前逐字）：整段塞一页，不切 */
function chunkLegacy(paras) {
  const pages = []; let cur = [], used = 0;
  for (let i = 0; i < paras.length; i++) {
    const hh = h(paras[i]);
    if (cur.length && used + hh > avail) { pages.push(cur); cur = []; used = 0; }
    cur.push(paras[i]); used += hh;
  }
  if (cur.length) pages.push(cur);
  return pages;
}
const flat = (pages) => pages.map((p) => p.map((it) => (typeof it === 'string' ? it : it.t)).join('')).join('');

const LONG = ('这是一个长段的句子，里面写着灯塔与守塔人的事。'.repeat(120));   /* ~2400 字，无换行 */
const SHORTS = ['第一段短一些。', '第二段也短。', '第三段同样不长。', '第四段。', '第五段。'];
const paras = SHORTS.concat([LONG]);

const pages = R._chunkPages(paras, VH, FS, LH);
const items = pages.reduce((n, p) => n + p.length, 0);
console.log('\n[守恒]');
ok('切分不丢字也不改字（页序拼回 == 原段序拼回）', flat(pages) === paras.join(''),
  '拼回 ' + flat(pages).length + ' 字 / 源 ' + paras.join('').length + ' 字');
ok('每个条目都指向自己那一页的源段', pages.every((p) => p.every((it) => typeof it.i === 'number' && it.i >= 0 && it.i < paras.length && paras[it.i].substr(it.o, it.t.length) === it.t)),
  '条目数=' + items);
const covered = paras.every((txt, i) => {
  const mine = pages.reduce((a, p) => a.concat(p.filter((it) => it.i === i)), []);
  let at = 0;
  return mine.every((it) => it.o === at && (at += it.t.length, true)) && at === txt.length;
});
ok('同一源的条目首尾相接、无重叠、覆盖整段', covered);

console.log('\n[装得下]');
const worstPage = Math.max.apply(null, pages.map((p) => p.reduce((s, it) => s + h(it.t), 0)));
ok('没有任何一页的估高超过视口', worstPage <= avail + 2 * FS, '最高页=' + Math.round(worstPage) + ' / 可用=' + Math.round(avail));
ok('长段确实被切成了多条', pages.reduce((n, p) => n + p.filter((it) => it.i === SHORTS.length).length, 0) >= 2,
  '长段条目=' + pages.reduce((n, p) => n + p.filter((it) => it.i === SHORTS.length).length, 0));
const firstOfLong = pages.reduce((a, p) => a.concat(p.filter((it) => it.i === SHORTS.length)), [])[0];
const restOfLong = pages.reduce((a, p) => a.concat(p.filter((it) => it.i === SHORTS.length)), []).slice(1);
ok('段的第一页保留首行缩进、续页去掉', firstOfLong.c === 0 && restOfLong.every((it) => it.c === 1));
ok('短段一个都不被切', SHORTS.every((t, i) => pages.reduce((a, p) => a.concat(p.filter((it) => it.i === i)), []).length === 1));
ok('页数比整段塞一页时多得多（翻页真的有得翻）', pages.length > chunkLegacy(paras).length,
  '新=' + pages.length + ' 页 / 旧=' + chunkLegacy(paras).length + ' 页');

console.log('\n[切点]');
ok('优先切在句末标点上', /[。！？；…”』）)】]$/.test(LONG.slice(0, R._paraCutAt(LONG, 800))), '');
const cutMid = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
ok('没有句末标点时正好切在满页处（不留半页空白）', R._paraCutAt(cutMid, 50) === 50);
ok('整段装得下时不切', R._paraCutAt('短句。', 500) === '短句。'.length);
ok('切点永不为 0（0 会让 while 死循环）', R._paraCutAt('。', 1) > 0 && R._paraCutAt('', 10) === 0);

console.log('\n[边界]');
ok('空段列表 → 空页表', R._chunkPages([], VH, FS, LH).length === 0);
ok('全是空字符串段 → 不产生空页', R._chunkPages(['', ''], VH, FS, LH).every((p) => p.length));
const onePage = R._chunkPages(['很短的一段。'], VH, FS, LH);
ok('一段一页时不追加续页类', onePage.length === 1 && onePage[0][0].c === 0 && onePage[0][0].o === 0);

console.log('\n[反证：旧口径确实漏]');
const oldPages = chunkLegacy([LONG]);
const oldWorst = Math.max.apply(null, oldPages.map((p) => p.reduce((s, t) => s + h(t), 0)));
ok('旧口径产出一页高过视口的页（这条判据抓的是真 bug）', oldWorst > avail * 2,
  '旧最高页=' + Math.round(oldWorst) + 'px / 可用=' + Math.round(avail) + 'px · 旧页数=' + oldPages.length);
ok('旧口径只给一页 → 翻页与页码进度全失真', oldPages.length === 1);

console.log('\n=== 分页长段: ' + pass + ' pass / ' + fail + ' fail ===');
process.exit(fail === 0 ? 0 : 1);
