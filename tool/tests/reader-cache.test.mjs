/* 章节预取缓存（LRU 9 章）：纯逻辑，从母本按标记抽取。
   锁住四条易回潮的语义：空正文不入表、访问序只有一份实现、在途结果跨世代丢弃、
   失败不缓存且能重试。真实读章耗时归真机验证，这里不替它下结论。 */
import vm from 'node:vm';
import { readMaster } from '../harness.mjs';
import { TXT } from '../patch.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};

const src = readMaster(process.env.BF_MASTER || TXT);
const MARK_START = 'BF.reader.__prefetched = {};';
const MARK_END = '/* ================= R9. 续读提示 ================= */';
const a = src.indexOf(MARK_START);
const b = src.indexOf(MARK_END, a);
if (a < 0 || b < 0) { console.error('找不到 R8 预取块（母本结构变了？）'); process.exit(2); }
const block = src.slice(a, b);

const settings = { chapterPrefetch: true };
const calls = [];
const reports = [];
let pending = [];
const box = {
  BF: {
    reader: { state: { book: null } },
    settings: { get: (k) => settings[k] },
    library: {
      getChapterText: function (book, idx) {
        calls.push(book.id + '_' + idx);
        return new Promise(function (res, rej) { pending.push({ key: book.id + '_' + idx, res: res, rej: rej }); });
      },
    },
    err: { report: (w, e) => reports.push(w + ':' + (e && e.message)) },
  },
  console, JSON, Math, Object, Array, String, Number, Boolean, Promise, RegExp, Date, Error,
};
vm.createContext(box);
vm.runInContext(block, box);
const R = box.BF.reader;

const flush = () => new Promise((r) => setTimeout(r, 0));
const reset = () => { R.clearPrefetch(); calls.length = 0; reports.length = 0; pending = []; };

/* —— LRU 核心 —— */
reset();
R.__prefetchPut('a', '');
R.__prefetchPut('b', null);
R.__prefetchPut('c', undefined);
R.__prefetchPut('d', 0);
ok('空正文不入表（失败不能被缓存成持久故障）', R.__prefetchOrder.length === 0 && Object.keys(R.__prefetched).length === 0,
  'order=' + JSON.stringify(R.__prefetchOrder));

R.__prefetchPut('a', 'A');
R.__prefetchPut('a', 'A2');
ok('同键重写不占两格', R.__prefetchOrder.length === 1 && R.__prefetched.a === 'A2', JSON.stringify(R.__prefetchOrder));

reset();
for (const k of 'abcdefghij') R.__prefetchPut(k, k.toUpperCase());
ok('上限 9 章，最早的被淘汰', R.__prefetchOrder.length === 9 && R.__prefetched.a === undefined && R.__prefetched.b === 'B',
  R.__prefetchOrder.join(''));

R.__prefetchTouch('c');
ok('访问序刷新把命中项移到队尾', R.__prefetchOrder[R.__prefetchOrder.length - 1] === 'c', R.__prefetchOrder.join(''));
R.__prefetchPut('z', 'Z');
ok('刷新过的项不被下次淘汰（a 已被 z 顶掉，c 还在）', R.__prefetchOrder.length === 9 && R.__prefetched.c === 'C' && R.__prefetched.a === undefined,
  R.__prefetchOrder.join(''));

ok('访问序只有一份实现', (block.match(/__prefetchOrder\.(push|splice)\(/g) || []).length === 2 && /__prefetchTouch = function/.test(block));

/* —— prefetch 门与在途去重 —— */
reset();
R.state.book = { id: 'B', totalChapters: 3 };
R.prefetch(1); R.prefetch(1);
ok('在途去重：同一章并发只读一次', calls.length === 1, JSON.stringify(calls));
pending[0].res('第一章正文');
await flush();
ok('预取结果落到缓存且清掉在途标记', R.__prefetched['B_1'] === '第一章正文' && !R.__prefetching['B_1']);

reset();
R.prefetch(2);
pending[0].res('第一章正文');
await flush();
ok('已缓存的章不再重读', (R.prefetch(2), calls.length === 1), JSON.stringify(calls));

reset();
settings.chapterPrefetch = false;
R.prefetch(0);
ok('开关关闭时不读盘', calls.length === 0);
settings.chapterPrefetch = true;

reset();
R.prefetch(-1); R.prefetch(3); R.prefetch(99);
ok('越界章号不读盘', calls.length === 0, JSON.stringify(calls));
R.state.book = null;
R.prefetch(0);
ok('没有开书时不读盘', calls.length === 0);

/* —— 世代号：清缓存后在途结果必须丢弃 —— */
reset();
R.state.book = { id: 'C', totalChapters: 5 };
R.prefetch(0);
R.clearPrefetch();
pending[0].res('上一本的正文');
await flush();
ok('clearPrefetch 后回来的在途结果不写入', Object.keys(R.__prefetched).length === 0 && R.__prefetchOrder.length === 0,
  JSON.stringify(R.__prefetched));
R.prefetch(0);
ok('清过缓存后同一章可以重新预取', calls.length === 2, JSON.stringify(calls));

/* —— 失败路径 —— */
reset();
R.prefetch(1);
pending[0].rej(new Error('IDB 读失败'));
await flush();
ok('预取失败出声', reports.some((x) => x.indexOf('prefetch:IDB 读失败') === 0), JSON.stringify(reports));
ok('失败不写缓存', Object.keys(R.__prefetched).length === 0);
ok('失败后清掉在途标记（否则该章永远不再预取）', !R.__prefetching['C_1']);
R.prefetch(1);
ok('失败后可重试', calls.length === 2, JSON.stringify(calls));

/* —— 静态棘轮：母本级唯一性 —— */
ok('母本：访问序写点只经 __prefetchTouch', (src.match(/__prefetchOrder\.(push|splice)\(/g) || []).length === 2);
ok('母本：正文入表只有 __prefetchPut（定义 + 预取 + 开章）', (src.match(/__prefetchPut/g) || []).length === 3);
ok('母本：getChapterText 命中走同一次序实现', /if \(BF\.reader\.__prefetchTouch\) BF\.reader\.__prefetchTouch\(_pk\);/.test(src));
ok('母本：fmtBytes 档位各一份实现',
  (src.match(/\(n \/ 1048576\)\.toFixed\(2\)/g) || []).length === 1 &&
  (src.match(/\(n \/ 1024\)\.toFixed\(1\)/g) || []).length === 1);
ok('母本：带内联实体表的 esc 副本已清零（只剩 ESC_MAP 与 md 的 3 字符表）',
  (src.match(/'&': '&amp;'/g) || []).length === 2);

console.log('\n=== 预取缓存: ' + pass + ' pass / ' + fail + ' fail ===');
process.exit(fail ? 1 : 0);
