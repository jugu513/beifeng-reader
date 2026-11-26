/* 朗读缓存清单判据（只读母本，不改产品）。

   缓存的键是正文文本的内容地址，所以「文本没变」的命中天然正确；
   会出问题的两件事都在键之外：
     ① 旧切法留下的条目再也对不上任何句子，成了没人引用也占地方的孤儿；
     ② 命中缓存的那一句没再发请求，服务端也就没再回词边界——不存下来，
        「第二次听同一句反而没有逐词下划线」这种反差就说不清。
   本测试把缓存模块原样取进 Node，配一个假 IDB，逐条验：
   清单字段（书 / 章 / 档位签名）、按节压缩的边界、时间轴往返、删书连带删边界。
   反证写在一起：换一个档位签名再压一次，另一档的条目必须活着。 */
import vm from 'node:vm';
import { readMaster } from '../harness.mjs';
import { TXT } from '../patch.mjs';

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log('  ✓ ' + name + (extra ? ' — ' + extra : '')); }
  else { fail++; console.log('  ✗ ' + name + (extra ? ' — ' + extra : '')); }
};

const src = readMaster(TXT);
const START = 'BF.tts.cache = (function () {';
const END = 'BF.tts._saveSession = function ()';
const s = src.indexOf(START);
const e = src.indexOf(END, s);
if (s < 0 || e < 0) { console.error('找不到朗读缓存模块（母本结构变了？）'); process.exit(2); }
const body = src.slice(s, e) + '\nthis.__cache = BF.tts.cache;';

/* 假 IDB：一个 Map 就够，键名可见才好断言「音频与边界成对删」 */
function mkEnv(bookId, ch) {
  const store = new Map();
  const settings = { ttsCache: true, privacyMode: false, ttsEdgeVoice: 'v1', ttsRate: 1, ttsPitch: 1, mimoApiKey: '' };
  const sigs = { edge: function () { return 'edge|' + settings.ttsEdgeVoice + '|' + settings.ttsRate + '|' + settings.ttsPitch; }, mimo: function () { return 'mimo|mv|wav'; } };
  const BF = {
    settings: { get: (k) => settings[k], num: (k, d) => (typeof settings[k] === 'number' ? settings[k] : d) },
    appState: { currentBookId: bookId, currentChapterIdx: ch },
    timers: { timeout: (fn) => { fn(); return function () {}; } },
    err: { report: () => {} },
    log: { warn: () => {}, info: () => {} },
    tts: {
      cap: (eng) => ({ id: eng, cacheKeyOf: sigs[eng] ? sigs[eng] : function () { return eng; } }),
      mimo: { voiceId: () => 'mv', format: () => 'wav' },
      edge: {},
    },
    store: {
      idbKeyGet: async (k, d) => (store.has(k) ? store.get(k) : d),
      idbKeyPut: async (k, v) => { store.set(k, v); return true; },
      idbKeyDelete: async (k) => { store.delete(k); return true; },
    },
  };
  const sandbox = {
    BF, console, Date, Promise, Math, JSON, Object, Array, Set, Map, String, Number, Error, TextEncoder,
    crypto: {
      subtle: {
        /* 测试用哈希：不要求密码学强度，只要求「同文本同签名 → 同键，换了就换键」 */
        digest: async (_algo, data) => {
          const str = new TextDecoder().decode(data);
          let h = 2166136261;
          for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = (h * 16777619) >>> 0; }
          const hex = h.toString(16).padStart(8, '0').repeat(8).slice(0, 64);
          return new Uint8Array(hex.split('').map((c) => c.charCodeAt(0))).buffer;
        },
      },
    },
    TextDecoder,
  };
  vm.createContext(sandbox);
  sandbox.BF = BF;
  vm.runInContext(body, sandbox);
  return { cache: sandbox.__cache, store, BF, settings };
}

const mkBlob = (size) => ({ size: size, arrayBuffer: async () => new ArrayBuffer(0) });

(async function () {
  /* 1. 写入即带清单，命中回音频 + 时间轴 */
  const A = mkEnv('bookA', 2);
  await A.cache.put('edge', '北风其凉。', mkBlob(1000), { words: [{ txt: '北风', ms: 0, dur: 250 }, { txt: '其凉', ms: 250, dur: 200 }] });
  const hit = await A.cache.get('edge', '北风其凉。');
  ok('命中返回音频块', !!(hit && hit.blob && hit.blob.size === 1000));
  ok('命中同时带回词边界（第二次听也能逐词跟随）',
    !!(hit && hit.tl && hit.tl.words && hit.tl.words.length === 2 && hit.tl.words[0].txt === '北风' && hit.tl.words[1].ms === 250),
    hit && hit.tl ? JSON.stringify(hit.tl.words) : 'null');
  const idx = await A.cache.stats();
  ok('清单条目记的是这本书这一节', idx.n === 1 && (idx.byBook.bookA.chapters['2'] === 1), JSON.stringify(idx.byBook));

  /* 2. 没有边界的句子不写孤儿键 */
  const B = mkEnv('bookB', 0);
  await B.cache.put('edge', '没有边界的一句。', mkBlob(10));
  const tlKeys = Array.from(B.store.keys()).filter((k) => k.indexOf('tts.cache.t.') === 0);
  ok('服务端没回边界时不留空的时间轴键', tlKeys.length === 0, JSON.stringify(Array.from(B.store.keys())));

  /* 3. 按节压缩：只删这一节里不再出现的键 */
  const C = mkEnv('bookC', 1);
  const k1 = await C.cache.keyOf('edge', '旧切法第一句。');
  const k2 = await C.cache.keyOf('edge', '旧切法第二句。');
  const kLive = await C.cache.keyOf('edge', '新切法第一句。');
  const kOtherCh = await C.cache.keyOf('edge', '另一章的句子。');
  await C.cache.put('edge', '旧切法第一句。', mkBlob(20), { words: [{ txt: '旧', ms: 0, dur: 9 }] });
  await C.cache.put('edge', '旧切法第二句。', mkBlob(20));
  await C.cache.put('edge', '新切法第一句。', mkBlob(20));
  /* 先制造「另一章」的条目：把当前章号改一下再写 */
  C.BF.appState.currentChapterIdx = 5;
  await C.cache.put('edge', '另一章的句子。', mkBlob(20));
  C.BF.appState.currentChapterIdx = 1;
  const r = await C.cache.syncSectionFrom('edge', 'bookC', 1, ['新切法第一句。']);
  ok('按节压掉不再出现的键（这一节从 3 条压到 1 条）', r.dropped === 2, JSON.stringify(r));
  ok('压掉的键连音频一起删', !C.store.has(k1) && !C.store.has(k2), '仍在:' + Array.from(C.store.keys()).join(','));
  ok('时间轴键跟着删（不留解不开的边界）', !C.store.has(k1.replace('tts.cache.a.', 'tts.cache.t.')));
  ok('当前句子用的键保留', C.store.has(kLive));
  ok('另一章的键不受影响', C.store.has(kOtherCh));

  /* 4. 反证：档位签名不同 = 不同一档的缓存，压不得 */
  const D = mkEnv('bookD', 0);
  await D.cache.put('edge', '同一句文本。', mkBlob(30));
  const edgeKey = await D.cache.keyOf('edge', '同一句文本。');
  D.settings.ttsEdgeVoice = 'v2';   /* 换音色 → 签名变 → 新键；旧键成了这一节的孤儿 */
  const edgeKey2 = await D.cache.keyOf('edge', '同一句文本。');
  ok('换音色后键真的变了', edgeKey !== edgeKey2);
  await D.cache.put('edge', '同一句文本。', mkBlob(30));   /* 新音色这条也存一份：这一节现在有两条 Edge 条目 */
  await D.cache.put('mimo', '同一句文本。', mkBlob(30));
  const r2 = await D.cache.syncSectionFrom('mimo', 'bookD', 0, ['同一句文本。']);
  ok('按 MiMo 这一档压缩时，Edge 的条目一条不动（反证）',
    r2.dropped === 0 && D.store.has(edgeKey) && D.store.has(edgeKey2), JSON.stringify(r2));
  const r3 = await D.cache.syncSectionFrom('mimo', 'bookD', 9, []);
  ok('没句子的节不越界删别的节', r3.dropped === 0);
  /* 反证：同一个键清单，不告诉它档位签名就会把另一档的条目一起删——
     这条断言守的就是 sig 这个过滤条件别被「顺手简化」掉。 */
  const r4 = await D.cache.syncSection('bookD', 0, [await D.cache.keyOf('mimo', '同一句文本。')]);
  ok('不传签名时 Edge 的两条会被一起删（说明按档过滤是必要的）',
    r4.dropped === 2 && !D.store.has(edgeKey) && !D.store.has(edgeKey2), JSON.stringify(r4));

  /* 5. 定点清节与删书 */
  const E = mkEnv('bookE', 3);
  await E.cache.put('edge', '要被清掉的一句。', mkBlob(15));
  await E.cache.put('edge', '同章另一句。', mkBlob(15));
  E.BF.appState.currentChapterIdx = 4;
  await E.cache.put('edge', '另一章要留的句。', mkBlob(15));
  const n = await E.cache.dropChapter('bookE', 3);
  ok('dropChapter 只清这一节', n === 2 && (await E.cache.stats()).n === 1, 'n=' + n);
  await E.cache.purgeBook('bookE');
  const st = await E.cache.stats();
  ok('删书后清单与存储都空了', st.n === 0 && Array.from(E.store.keys()).filter((k) => k.indexOf('tts.cache.') === 0).every((k) => k === 'tts.cache.index'),
    JSON.stringify(Array.from(E.store.keys())));

  /* 6. 隐私模式与开关：不读不写 */
  const F = mkEnv('bookF', 0);
  F.settings.privacyMode = true;
  await F.cache.put('edge', '隐私下不写。', mkBlob(10));
  ok('隐私模式下不写缓存', (await F.cache.stats()).n === 0);
  ok('隐私模式下也不读缓存', (await F.cache.get('edge', '隐私下不写。')) === null);
  const G = mkEnv('bookG', 0);
  G.settings.ttsCache = false;
  await G.cache.put('edge', '关掉后不写。', mkBlob(10));
  ok('缓存开关关闭时不写', (await G.cache.stats()).n === 0);

  console.log('\n=== 朗读缓存清单: ' + pass + ' pass / ' + fail + ' fail ===');
  process.exit(fail ? 1 : 0);
})().catch(function (err) { console.error('测试自身异常：', err); process.exit(2); });
