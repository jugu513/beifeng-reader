/* 浏览器侧三条验收数字：开书耗时 / 进度往返误差 / 搜索跳转必中。

   为什么不写成「必须装 Playwright」：这三条量的是产品自己的时间，不是驱动的时间。
   谁把页面打开、怎么点，工具不该管。所以这里只有两端：
     · 一个本机 HTTP 服务（stdlib），把母本原样发出去，只在 </body> 前追加一段
       内联测速脚本（CSP 只有 script-src 'unsafe-inline'，外链脚本会被拦，故必须内联）；
     · 页面跑完，POST 一条 JSON 回来，命令行打印成表。

   于是它有两种跑法，都不用第三方依赖：
     node tool/tests/acceptance.browser.mjs --launch          # 自己拉起 chromium/firefox
     node tool/tests/acceptance.browser.mjs                   # 只起服务，自己用任一浏览器打开
     node tool/tests/acceptance.browser.mjs --which=old       # 量 pre/release-2026-11-03.txt（对照列）

   造的书是固定种子生成的同一本：1000 章、每章约 1000 字，第 3/137/250/499/512/777/900/998
   章里各埋一个全书唯一的探针词。跑完自己把造出来的书按真实删除链彻底删掉，并在回执里
   核对「书、正文键、回收站记录」三处都归零——测试数据留在别人浏览器里，比没测更糟。

   退出码：三条全达标 + 清理核对通过 → 0；否则 1。 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { ROOT, TXT, PRE } from '../patch.mjs';

const argv = process.argv.slice(2);
const argOf = (k) => {
  const hit = argv.find((a) => a === '--' + k || a.startsWith('--' + k + '='));
  if (!hit) return undefined;
  return hit.includes('=') ? hit.slice(hit.indexOf('=') + 1) : true;
};

const PORT = Number(argOf('port') || 0);
const WHICH = String(argOf('which') || 'both');            /* new | old | both */
const LAUNCH = !!argOf('launch');
const BIN = String(argOf('bin') || '');                    /* 指定浏览器可执行文件 */
const TIMEOUT = Number(argOf('timeout') || 180) * 1000;
const JSON_OUT = !!argOf('json');
const KEEP = !!argOf('keep');                              /* 留浏览器 profile 供排查 */
/* 开书采样轮数：默认 1 轮 = 5 个落点章。本机五连测的组内散布能到 21→384ms，
   中位数在这种噪声下不足以判「慢了几十毫秒」这类趋势——比对回退时把轮数拉到 4–6，
   本件与旧件同机同轮才可比。 */
const OPEN_ROUNDS = Math.max(1, Math.min(12, Number(argOf('opens') || 1)));

/* ============ 阈值（与 tool/acceptance.mjs 同一套口径） ============ */
const LIMIT = {
  /* 开书 ≤100ms：这是外包票给的外部标准，也是「点一下就有」的心理线；
     超过 100ms 用户会开始怀疑没点上，会点第二下。 */
  openMs: 100,
  /* 进度往返 ≤0.5pp：按全书字数加权算。读者能察觉的偏差下限约是「半章」；
     1000 章的书半章 = 0.05%…所以 0.5pp 是宽松但仍能抓住「回到章首」「写零」这类硬伤的线。 */
  progressPp: 0.5,
  /* 搜索跳转必中：不是「大部分中」。8 个探针，8 个都要落在正确章 + 关键词可见 + 高亮在场。 */
  searchHit: 8,
  chapters: 1000,
  chapterChars: 1000,
  probes: [3, 137, 250, 499, 512, 777, 900, 998],
};

/* ============ 发出去的那段页面脚本 ============ */
/* 说明：这是量产品的仪表，不是产品的一部分；只读产品 API，不改产品状态
   （除了造一本书、再把它删干净）。所有等待都有上限，任何一步超时都照常回传，
   让命令行给出「哪一步没数」而不是干等。 */
const PAGE_SRC = String.raw`
(function () {
  var OUT = { variant: __VARIANT__, ua: navigator.userAgent, dpr: devicePixelRatio,
    viewport: [innerWidth, innerHeight], t0: Date.now(), steps: {}, err: null };
  var sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };
  /* 等 n 个渲染帧：正文进了 DOM 不等于用户看见了，中间还隔着一次合成。
     200ms 兜底——帧被节流时不让测量卡死，但也如实标「没等到帧」。 */
  function frames(n) {
    return new Promise(function (res) {
      var k = 0, done = false;
      var step = function () { if (done) return; if (++k >= n) { done = true; return res(true); } requestAnimationFrame(step); };
      requestAnimationFrame(step);
      setTimeout(function () { if (!done) { done = true; res(false); } }, 200);
    });
  }
  function until(fn, ms, step) {
    var t0 = performance.now();
    return new Promise(function (res) {
      (function tick() {
        var v = null;
        try { v = fn(); } catch (e) {}
        if (v) return res(v);
        if (performance.now() - t0 > ms) return res(null);
        setTimeout(tick, step || 10);
      })();
    });
  }
  function post(payload) {
    try {
      return fetch('/__result?variant=' + OUT.variant, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload),
      });
    } catch (e) { return Promise.resolve(); }
  }

  /* ---- 合成样书：固定种子，任何人任何次跑都是同一本 ---- */
  function synth(n, per, probes) {
    var pool = '的一是了我不人在他有这个上们来到时大地为子中你说生国年着就那和要她出也得里后自以会家可下而过天去能对小多然于心学么之都好看起发当没成只如事把还用第样道想作种开美总从无情己面最女但现前些所同日手又行意动方期它头经长儿回位分爱老因很给名法间斯知世什两次使身者被高已亲其进此话常与活正感';
    var s = 20261104;
    var rnd = function () { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    var out = [];
    for (var i = 0; i < n; i++) {
      var body = '';
      while (body.length < per) {
        var L = 12 + Math.floor(rnd() * 18), sent = '';
        for (var k = 0; k < L; k++) sent += pool[Math.floor(rnd() * pool.length)];
        body += sent + '。';
      }
      if (probes.indexOf(i) >= 0) {
        var at = Math.floor(body.length * 0.55);
        body = body.slice(0, at) + '这里埋了一个探针' + i + '号用来验证跳转。' + body.slice(at);
      }
      out.push('第' + (i + 1) + '章 第' + (i + 1) + '章标题\n' + body);
    }
    return out.join('\n\n');
  }

  function median(a) { a = a.slice().sort(function (x, y) { return x - y; }); return a[Math.floor(a.length / 2)]; }
  function round(x, n) { var p = Math.pow(10, n == null ? 2 : n); return Math.round(x * p) / p; }

  (async function main() {
    try {
      await until(function () { return typeof BF !== 'undefined' && BF.library && BF.library.importFile && BF.reader && BF.reader.openBook && !document.getElementById('boot-splash'); }, 25000, 50);
      if (typeof BF === 'undefined' || !BF.library) throw new Error('启动超时：25s 内 BF 未就绪');
      await sleep(300);
      OUT.version = BF.VERSION_DISPLAY || BF.version || '?';

      /* ============ 造书 ============ */
      var NCH = __NCH__, PER = __PER__, PROBES = __PROBES__;
      var text = synth(NCH, PER, PROBES);
      var name = '验收样书-' + Date.now() + '.txt';
      var tImp = performance.now();
      var rc = await BF.library.importFile(new File([text], name, { type: 'text/plain' }));
      var impMs = performance.now() - tImp;
      if (!rc || rc.status !== 'ok' || !rc.book) throw new Error('样书导入失败：' + JSON.stringify(rc && rc.status || rc));
      var id = rc.book.id;
      OUT.steps.import = { ms: round(impMs, 1), chapters: rc.book.totalChapters, chars: text.length, id: id, name: name };
      OUT.bookId = id;
      await sleep(300);

      /* ============ ① 开书耗时 ============ */
      /* 从「点书」到「正文首字进 DOM」。三次取中位数：第一次是冷缓存，
         后两次是热缓存，两者都报，判据用中位数（用户日常遇到的就是热缓存）。 */
      var OPENS_BASE = [137, 300, 450, 617, 900];
      /* 轮数由命令行 --opens 决定：一轮 5 个落点的中位数噪声太大（组内能差 6 倍），
         回退趋势要靠多轮才读得准。多轮时同一批章循环复用，
         每轮的「上一次停留章」都不同，防闪那条路照样每次都真的重画。 */
      var OPENS = [];
      for (var _r = 0; _r < __ROUNDS__; _r++) OPENS = OPENS.concat(OPENS_BASE);
      var openRuns = [];
      /* 归因探针：开书一旦变慢，只报一个总数没法回答「慢在哪一段」。
         这里把开书链上的关键函数临时包一层计时（跑完原样还原，不动产品一行代码）。
         父函数（app.openBook / reader.loadChapter）里含着被包住的子函数，
         所以各段之和会大于总耗时——这张表只用来读「哪一段最重」，不当判据。 */
      var PHASE_PAIRS = [
        [BF.app, 'openBook'], [BF.reader, 'openBook'], [BF.reader, 'loadChapter'],
        [BF.reader, 'renderChapter'], [BF.library, 'getChapterText'],
        [BF.reader, 'applyStyles'], [BF.reader, 'applyHighlights'], [BF.reader, 'applyExtras'],
        [BF.reader, 'updateProgress'], [BF.reader, 'renderPageMode'], [BF.reader, 'renderPageModeOff'],
      ];
      var _phBackup = [], _phMs = {}, _phN = {};
      function phaseStart() {
        _phMs = {}; _phN = {}; _phBackup = [];
        PHASE_PAIRS.forEach(function (pair) {
          var obj = pair[0], k = pair[1];
          if (!obj || typeof obj[k] !== 'function') return;
          var orig = obj[k];
          _phBackup.push([obj, k, orig]);
          obj[k] = function () {
            var s = performance.now();
            var r = orig.apply(this, arguments);
            var tally = function () { _phMs[k] = (_phMs[k] || 0) + (performance.now() - s); _phN[k] = (_phN[k] || 0) + 1; };
            if (r && typeof r.then === 'function') return r.then(function (v) { tally(); return v; }, function (e) { tally(); throw e; });
            tally(); return r;
          };
        });
      }
      function phaseEnd() {
        _phBackup.forEach(function (t) { t[0][t[1]] = t[2]; });
        _phBackup = [];
        return { ms: _phMs, n: _phN };
      }
      for (var r = 0; r < OPENS.length; r++) {
        var tch = OPENS[r];
        /* 每次换一个落点章：同书同章重开时产品会刻意保留 DOM（防闪），
           留着测出来的「首字可见」是上一次的残留，等于没测。
           换章会让防闪清除生效——那正是用户换章开书时走的路。 */
        /* 顺序有讲究：先离开阅读页，再改进度。反过来的话 go() 触发的
           saveProgress 会把内存里的旧章号写回去，刚设的落点就被抹平——
           表面上「跳了章」，实际开的还是上一章。 */
        BF.app.go('bookshelf');
        await sleep(220);
        await BF.store.mutate(BF.store.K.READING_STATE, function (rs) {
          rs = rs || {};
          rs[id] = { currentChapter: tch, lastRead: Date.now() };
          return rs;
        });
        var want = '第' + (tch + 1) + '章 第' + (tch + 1) + '章标题';
        var t0 = performance.now();
        phaseStart();
        var p = BF.app.openBook(id);
        var first = null;
        while (performance.now() - t0 < 10000) {
          var el = document.getElementById('reader-main');
          if (el && el.textContent.indexOf(want) >= 0) { first = performance.now() - t0; break; }
          await sleep(4);
        }
        /* 再等两帧：这才是「画出来了」。首字进 DOM 的时间另记，两个都给。 */
        var framesOk = first == null ? false : await frames(2);
        var visible = first == null ? null : (performance.now() - t0);
        await p;
        var dbg = '';
        var ph = phaseEnd();
        if (first == null) {
          var rm = document.getElementById('reader-main');
          dbg = 'landed=' + BF.appState.currentChapterIdx + ' head=' + String((rm && rm.textContent) || '').replace(/\s+/g, ' ').slice(0, 60);
        }
        openRuns.push({ chapter: tch, first: first, visible: visible, frames: framesOk, api: performance.now() - t0, dbg: dbg, ph: ph });
      }
      /* 各段取「每次开书里的耗时」的中位数：中位数抗单轮毛刺，均值会被一次 300ms 的抖动拖走 */
      var PHASE_KEYS = Object.keys(PHASE_PAIRS.reduce(function (a, x) { if (x[0] && typeof x[0][x[1]] === 'function') a[x[1]] = 1; return a; }, {}));
      var phases = {};
      PHASE_KEYS.forEach(function (k) {
        var arr = openRuns.map(function (x) { return (x.ph && x.ph.ms[k]) || 0; });
        var ns = openRuns.map(function (x) { return (x.ph && x.ph.n[k]) || 0; });
        phases[k] = { median: round(median(arr), 2), mean: round(arr.reduce(function (a, b) { return a + b; }, 0) / arr.length, 2), callsMedian: median(ns) };
      });
      OUT.steps.open = {
        chapters: OPENS,
        rounds: OPENS.length / OPENS_BASE.length,
        phases: phases,
        runs: openRuns.map(function (x) {
          return {
            chapter: x.chapter,
            first: x.first == null ? null : round(x.first, 1),
            visible: x.visible == null ? null : round(x.visible, 1),
            frames: x.frames, api: round(x.api, 1), dbg: x.dbg,
          };
        }),
        median: openRuns.some(function (x) { return x.visible == null; })
          ? null
          : round(median(openRuns.map(function (x) { return x.visible; })), 1),
        medianDom: openRuns.some(function (x) { return x.first == null; })
          ? null
          : round(median(openRuns.map(function (x) { return x.first; })), 1),
        framesOk: openRuns.every(function (x) { return x.frames; }),
        p90: (function () {
          var v = openRuns.map(function (x) { return x.visible; }).filter(function (x) { return x != null; }).sort(function (a, b) { return a - b; });
          return v.length ? round(v[Math.min(v.length - 1, Math.floor(v.length * 0.9))], 1) : null;
        })(),
        worst: (function () {
          var v = openRuns.map(function (x) { return x.visible; }).filter(function (x) { return x != null; });
          return v.length ? round(Math.max.apply(null, v), 1) : null;
        })(),
        sampleMs: 4,
      };

      /* ============ ② 进度往返误差 ============ */
      /* 往返 = 设位置 → 存档 → 退出阅读页 → 重新开书 → 读回。
         位置按「章号 + 章内滚动比例」表达；全书进度按字数加权（书里就有 chapterWords，
         不另造一套口径）。误差比较的是「设进去的」与「读回来的」，不是两次读数之差。 */
      var b = BF.reader.state.book;
      var words = b.chapterWords || [];
      var totalWords = words.reduce(function (a, x) { return a + (x || 0); }, 0) || b.wordCount || 1;
      function bookProgress(ch, ratio) {
        var acc = 0;
        for (var i = 0; i < ch && i < words.length; i++) acc += words[i] || 0;
        return (acc + (words[ch] || 0) * ratio) / totalWords;
      }
      var TARGET_CH = Math.min(617, (b.totalChapters || 1) - 1);
      var TARGET_RATIO = 0.64;
      await BF.reader.gotoChapter(TARGET_CH);
      await sleep(320);
      var wrap = document.getElementById('reader-wrap');
      var maxScroll = Math.max(1, wrap.scrollHeight - wrap.clientHeight);
      var targetTop = Math.round(maxScroll * TARGET_RATIO);
      wrap.scrollTop = targetTop;
      wrap.dispatchEvent(new Event('scroll'));
      await sleep(150);
      var sentP = bookProgress(TARGET_CH, wrap.scrollTop / maxScroll);
      var savedKey = (BF.store.K && BF.store.K.SCROLL_) ? (BF.store.K.SCROLL_ + id) : ('scroll_' + id);
      await BF.reader.saveProgress(true);
      await sleep(500);
      var savedTop = BF.store.lsGet(savedKey, null);

      BF.app.go('bookshelf');
      await sleep(250);
      await BF.app.openBook(id);
      await sleep(600);
      var gotCh = BF.appState.currentChapterIdx;
      var wrap2 = document.getElementById('reader-wrap');
      var max2 = Math.max(1, wrap2.scrollHeight - wrap2.clientHeight);
      var gotTop = wrap2.scrollTop;
      var gotP = bookProgress(gotCh, gotTop / max2);
      OUT.steps.progress = {
        targetChapter: TARGET_CH, targetRatio: TARGET_RATIO, targetTop: targetTop, scrollable: maxScroll,
        savedTop: savedTop, gotChapter: gotCh, gotTop: gotTop, scrollableAfter: max2,
        chapterDelta: gotCh - TARGET_CH,
        scrollDeltaPct: round(Math.abs(gotTop - targetTop) / maxScroll * 100, 3),
        bookPct: round(sentP * 100, 3), gotPct: round(gotP * 100, 3),
        bookPpError: round(Math.abs(gotP - sentP) * 100, 3),
      };

      /* ============ ③ 搜索跳转必中 ============ */
      /* 走的是用户那条路：开搜索抽屉 → 输入 → 搜索 → 点第一条命中。
         判据三条同时成立才算「中」：落在目标章、关键词在正文里、高亮 mark 在场。 */
      var hits = [];
      for (var pi = 0; pi < PROBES.length; pi++) {
        var ch = PROBES[pi];
        var kw = '探针' + ch + '号';
        var rec = { chapter: ch, kw: kw, ok: false, note: '' };
        try {
          BF.reader.openDrawer('search');
          var inp = await until(function () { return document.getElementById('search-input'); }, 4000, 20);
          if (!inp) throw new Error('搜索框没出来');
          inp.value = kw;
          var t1 = performance.now();
          await BF.reader.searchAll(kw);
          var item = await until(function () { var x = document.querySelector('#search-results [data-goto-ch]'); return x || false; }, 8000, 20);
          if (!item) throw new Error('没有命中项');
          rec.searchMs = round(performance.now() - t1, 1);
          var itemCh = parseInt(item.getAttribute('data-goto-ch'), 10);
          rec.hitChapter = itemCh;
          item.click();
          /* 三条判据分开记：跳错章、章对了但词不在、词在了但没高亮——
             三种毛病用户看到的是三种不同的怪，回执里也得能分开。 */
          var landed = await until(function () {
            return BF.appState.currentChapterIdx === ch &&
              (document.getElementById('reader-main') || {}).textContent &&
              document.getElementById('reader-main').textContent.indexOf(kw) >= 0 &&
              document.querySelector('#reader-main mark[data-goto-hl]');
          }, 5000, 20);
          var rm = document.getElementById('reader-main');
          rec.landChapter = BF.appState.currentChapterIdx;
          rec.chapterOk = BF.appState.currentChapterIdx === ch;
          rec.textOk = !!(rm && rm.textContent && rm.textContent.indexOf(kw) >= 0);
          rec.mark = !!document.querySelector('#reader-main mark[data-goto-hl]');
          /* 「跳到了」还不够：得跳进眼睛里。mark 必须落在阅读框的可视范围内，
             否则用户看到的是「点了，页面没动」。 */
          if (rec.mark) {
            try {
              var mk = document.querySelector('#reader-main mark[data-goto-hl]').getBoundingClientRect();
              var wr = document.getElementById('reader-wrap').getBoundingClientRect();
              rec.inView = mk.top < wr.bottom && mk.bottom > wr.top;
            } catch (e) { rec.inView = null; }
          }
          rec.ok = !!landed && itemCh === ch && rec.inView !== false;
          if (!rec.ok) {
            /* 五条线索全摆出来：等没等到、列表首项是哪章、落点哪章、词在不在、高亮在不在、
               高亮在可视区外还是压根没有——少一条就得再跑一遍才能定位，成本比这行字高。 */
            rec.note = '落点章 ' + rec.landChapter + (rec.chapterOk ? '' : '（应 ' + ch + '）') +
              ' / 词在正文 ' + (rec.textOk ? '是' : '否') + ' / 高亮 ' + (rec.mark ? '在' : '不在') +
              ' / 列表首项 ' + itemCh + (itemCh === ch ? '' : '（应 ' + ch + '）') +
              ' / 高亮在视野 ' + (rec.inView === false ? '否' : (rec.inView == null ? '未测' : '是')) +
              (landed ? '' : ' / 轮询超时');
          }
        } catch (e) { rec.note = (e && e.message) || String(e); }
        hits.push(rec);
        await sleep(120);
      }
      OUT.steps.search = { total: hits.length, hit: hits.filter(function (x) { return x.ok; }).length, items: hits };

    } catch (e) {
      /* 测量中途出错也照样往下走：清理由下面单独兜，不跟测量共用同一条
         异常路径——否则一错就跳过清理，把测试书留在别人的浏览器里。 */
      OUT.err = (e && e.message) || String(e);
    }

    {
      /* ============ 收尾：把造出来的书按真实删除链清干净 ============ */
      var clean = { moved: false, deleted: false, metaLeft: null, trashLeft: null, chapterKeys: null };
      try {
        BF.app.go('bookshelf');
        await sleep(200);
        BF.trash.moveTo(id);
        await sleep(400);
        await BF.app._doDelete(id);
        await BF.store.mutate(BF.store.K.TRASH, function (arr) {
          return (arr || []).filter(function (x) { return !(x && x.meta && x.meta.id === id); });
        });
        await sleep(400);
        var meta = BF.store.lsGetArray(BF.store.K.BOOKS_META, []).filter(function (x) { return x && x.id === id; }).length;
        var trash = (BF.store.lsGet(BF.store.K.TRASH, []) || []).filter(function (x) { return x && x.meta && x.meta.id === id; }).length;
        var keys = await BF.store.idbIndexKeys(BF.store.K.CHAPTERS, 'bk', IDBKeyRange.only(String(id))).catch(function () { return null; });
        clean.metaLeft = meta; clean.trashLeft = trash; clean.chapterKeys = keys ? keys.length : null;
        clean.deleted = (meta === 0 && trash === 0 && (keys == null || keys.length === 0));
        BF.app.renderBookshelf();
      } catch (e) { clean.err = (e && e.message) || String(e); }
      OUT.steps.cleanup = clean;
    }
    OUT.totalMs = Date.now() - OUT.t0;
    await post(OUT);
  })();
})();
`;

/* ============ 服务 ============ */
const VARIANTS = {
  new: { file: TXT, label: '本件' },
  old: { file: path.join(PRE, 'release-2026-11-03.txt'), label: '旧件' },
};
const want = WHICH === 'both' ? ['new', 'old'] : [WHICH];
for (const w of want) {
  if (!VARIANTS[w]) { console.error('未知的 --which=' + w + '（new / old / both）'); process.exit(2); }
  if (!fs.existsSync(VARIANTS[w].file)) { console.error('缺文件：' + VARIANTS[w].file); process.exit(2); }
}

const results = new Map();
const waiters = new Map();
let server = null;
let origin = '';

function pageFor(variant) {
  const html = fs.readFileSync(VARIANTS[variant].file, 'utf8');
  const script = PAGE_SRC
    .replace(/__VARIANT__/g, JSON.stringify(variant))
    .replace(/__NCH__/g, String(LIMIT.chapters))
    .replace(/__PER__/g, String(LIMIT.chapterChars))
    .replace(/__PROBES__/g, JSON.stringify(LIMIT.probes))
    .replace(/__ROUNDS__/g, String(OPEN_ROUNDS));
  const tag = '<script>' + script + '</script>';
  const i = html.lastIndexOf('</body>');
  return i < 0 ? html + tag : html.slice(0, i) + tag + html.slice(i);
}

function route(req, res) {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'POST' && u.pathname === '/__result') {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      let data = null;
      try { data = JSON.parse(body); } catch (e) { data = { err: '结果不是 JSON：' + body.slice(0, 200) }; }
      const v = u.searchParams.get('variant') || 'new';
      results.set(v, data);
      const w = waiters.get(v);
      if (w) w(data);
      res.writeHead(204, { 'access-control-allow-origin': '*' });
      res.end();
    });
    return;
  }
  const key = u.pathname.replace(/^\//, '') || 'new';
  if (!VARIANTS[key]) { res.writeHead(404); res.end('not found'); return; }
  const html = pageFor(key);
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer(route);
    server.listen(PORT, '127.0.0.1', () => {
      origin = 'http://127.0.0.1:' + server.address().port;
      resolve();
    });
  });
}

function findBin() {
  if (BIN) return BIN;
  const cands = ['chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable', 'microsoft-edge', 'msedge'];
  for (const c of cands) {
    for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
      const f = path.join(dir, c);
      if (fs.existsSync(f)) return f;
    }
  }
  /* Windows 上常见安装路径 */
  if (process.platform === 'win32') {
    for (const p of ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe']) {
      if (fs.existsSync(p)) return p;
    }
  }
  return '';
}

function launchFor(bin, variant) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-acc-'));
  const url = origin + '/' + variant;
  const child = spawn(bin, [
    '--headless=new', '--disable-gpu', '--no-sandbox', '--disable-dev-shm-usage',
    '--no-first-run', '--no-default-browser-check', '--disable-extensions',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--window-size=1280,900', '--user-data-dir=' + profile, url,
  ], { stdio: 'ignore' });
  child.on('error', () => {});
  return { child, profile };
}

const fmt = (x, n) => {
  if (x == null) return '—';
  if (typeof x !== 'number') return String(x);
  const d = n == null ? (Number.isInteger(x) ? 0 : 1) : n;
  return x.toFixed(d);
};

function report(variant, data) {
  const L = VARIANTS[variant].label + '（' + path.relative(ROOT, VARIANTS[variant].file) + '）';
  console.log('\n【' + L + '】' + (data.version ? ' v' + data.version : '') + ' · ' + (data.viewport || []).join('×') + ' · dpr ' + data.dpr);
  if (data.err) {
    console.log('  ✗ 页面内报错：' + data.err);
    const c0 = (data.steps || {}).cleanup;
    if (c0) console.log('  ' + (c0.deleted ? '✓' : '✗') + ' 测试数据清理    书架残留 ' + fmt(c0.metaLeft) + ' · 回收站残留 ' + fmt(c0.trashLeft) + ' · 正文键残留 ' + fmt(c0.chapterKeys) + (c0.err ? ' · ' + c0.err : ''));
    return;
  }
  const st = data.steps || {};
  const imp = st.import || {};
  console.log('  · 样书导入        ' + fmt(imp.ms) + ' ms · ' + fmt(imp.chapters) + ' 章 · ' + fmt(imp.chars) + ' 字');

  const o = st.open || {};
  const openOk = o.median != null && o.median <= LIMIT.openMs;
  const shown = (o.runs || []).slice(0, 6);
  console.log('  ' + (openOk ? '✓' : '✗') + ' 开书耗时        ' + fmt(o.median) + ' ms（中位数 / ' + fmt((o.runs || []).length, 0) + ' 次 · ' + fmt(o.rounds || 1, 0) + ' 轮，含两帧）· 首字进 DOM 中位 ' + fmt(o.medianDom) +
    ' ms · p90 ' + fmt(o.p90) + ' ms · 最差 ' + fmt(o.worst) + ' ms · 各次 ' + shown.map((x) => fmt(x.first) + '→' + fmt(x.visible)).join(' / ') +
    ((o.runs || []).length > shown.length ? ' …' : '') + (o.framesOk ? '' : ' · 有帧没等到'));
  /* 归因表：只在多轮采样时才打（一轮的段中位数没意义），按耗时从大到小 */
  if (o.phases && (o.rounds || 1) > 1) {
    const rows = Object.keys(o.phases).map((k) => [k, o.phases[k].median, o.phases[k].mean, o.phases[k].callsMedian])
      .sort((a, b) => b[1] - a[1]);
    console.log('    └ 开书链归因（每次开书的段耗时中位 / 均值 ms；父函数含子函数，不做加和）');
    rows.slice(0, 8).forEach((r) => {
      if (r[1] <= 0.05) return;
      console.log('       ' + r[0].padEnd(18, ' ') + ' 中位 ' + fmt(r[1], 2) + ' · 均值 ' + fmt(r[2], 2) + ' · 次数 ' + fmt(r[3], 0));
    });
  }

  const p = st.progress || {};
  const progOk = p.chapterDelta === 0 && p.bookPpError != null && p.bookPpError <= LIMIT.progressPp;
  console.log('  ' + (progOk ? '✓' : '✗') + ' 进度往返        第 ' + fmt(p.targetChapter, 0) + ' 章 · 设入 ' + fmt(p.targetTop, 0) + 'px / 存档 ' +
    fmt(p.savedTop, 0) + 'px / 读回 ' + fmt(p.gotTop, 0) + 'px · 章号差 ' + fmt(p.chapterDelta, 0) + ' · 章内差 ' + fmt(p.scrollDeltaPct, 3) +
    '% · 全书 ' + fmt(p.bookPct, 3) + '% → ' + fmt(p.gotPct, 3) + '%（误差 ' + fmt(p.bookPpError, 3) + ' pp）');

  const s = st.search || {};
  const searchOk = s.hit === s.total && s.total === LIMIT.searchHit;
  console.log('  ' + (searchOk ? '✓' : '✗') + ' 搜索跳转        ' + fmt(s.hit) + ' / ' + fmt(s.total) + ' 必中' +
    (s.hit === s.total ? '' : ' · 未中：' + (s.items || []).filter((x) => !x.ok).map((x) => '第' + x.chapter + '章(' + (x.note || '') + ')').join('，')));
  const c = st.cleanup || {};
  console.log('  ' + (c.deleted ? '✓' : '✗') + ' 测试数据清理    书架残留 ' + fmt(c.metaLeft) + ' · 回收站残留 ' + fmt(c.trashLeft) + ' · 正文键残留 ' + fmt(c.chapterKeys));
}

async function runVariant(variant) {
  const bin = LAUNCH ? findBin() : '';
  if (LAUNCH && !bin) throw new Error('没找到浏览器可执行文件，用 --bin= 指定');
  console.log('\n▶ ' + VARIANTS[variant].label + '：' + origin + '/' + variant + (LAUNCH ? '（自动拉起 ' + path.basename(bin) + '）' : '（等外部浏览器打开）'));
  const waiting = new Promise((resolve) => waiters.set(variant, resolve));
  const launched = LAUNCH ? launchFor(bin, variant) : null;
  const timer = new Promise((resolve) => setTimeout(() => resolve('__timeout__'), TIMEOUT));
  const got = await Promise.race([waiting, timer]);
  if (launched) {
    try { launched.child.kill('SIGKILL'); } catch (e) {}
    if (!KEEP) { try { fs.rmSync(launched.profile, { recursive: true, force: true }); } catch (e) {} }
  }
  if (got === '__timeout__') { console.log('  ✗ 超时：' + (TIMEOUT / 1000) + 's 内没有收到结果'); return null; }
  return got;
}

/* ============ 主流程 ============ */
(async function () {
  await startServer();
  if (!JSON_OUT) {
    console.log('══ 北风 浏览器验收 · 三条数字 ══');
    console.log('   node ' + process.version + ' · ' + os.platform() + ' ' + os.arch() + ' · ' + os.cpus().length + ' 核 · 书 ' + LIMIT.chapters + ' 章');
    if (!LAUNCH) {
      console.log('   粘地址到任一浏览器（或任一驱动）即可，跑完页面会自己把结果送回来：');
      for (const v of want) console.log('     ' + origin + '/' + v + '   ' + VARIANTS[v].label);
    }
  }
  for (const v of want) {
    const data = await runVariant(v);
    if (!data) { results.set(v, { err: 'timeout' }); continue; }
    if (!JSON_OUT) report(v, data);
  }
  try { server.close(); } catch (e) {}

  /* 判据只压在本件上：旧件那一列是参照物，它不达标正是本件存在的理由，
     拿它去判生死等于把「以前就这样」当成红线。 */
  const bad = [];
  for (const v of want) {
    if (v === 'old') continue;
    const d = results.get(v) || {};
    if (d.err) { bad.push(VARIANTS[v].label + ': 无结果'); continue; }
    const st = d.steps || {};
    if (!st.open || st.open.median == null || st.open.median > LIMIT.openMs) bad.push(VARIANTS[v].label + ': 开书 ' + fmt(st.open && st.open.median) + 'ms > ' + LIMIT.openMs);
    if (!st.progress || st.progress.chapterDelta !== 0 || st.progress.bookPpError > LIMIT.progressPp) bad.push(VARIANTS[v].label + ': 进度误差 ' + fmt(st.progress && st.progress.bookPpError, 3) + 'pp > ' + LIMIT.progressPp);
    if (!st.search || st.search.hit !== st.search.total || st.search.total !== LIMIT.searchHit) bad.push(VARIANTS[v].label + ': 搜索 ' + fmt(st.search && st.search.hit) + '/' + fmt(st.search && st.search.total));
    if (!st.cleanup || !st.cleanup.deleted) bad.push(VARIANTS[v].label + ': 测试数据没清干净');
  }

  if (JSON_OUT) {
    const out = {};
    for (const v of want) out[v] = results.get(v) || null;
    console.log(JSON.stringify({ limits: LIMIT, variants: out }, null, 2));
  } else {
    console.log('');
    if (bad.length) { console.log('══ 未达标 ══'); bad.forEach((x) => console.log('   ✗ ' + x)); }
    else if (want.length === 1 && want[0] === 'old') console.log('══ 只量了旧件（对照列），不做判定 ══');
    else console.log('══ 本件三条全达标' + (want.indexOf('old') >= 0 ? '（旧件列只作对照，不参与判定）' : '') + ' ══');
    console.log('');
  }
  process.exitCode = bad.length ? 1 : 0;
})().catch((e) => {
  console.error('运行失败：' + (e && e.stack || e));
  try { server && server.close(); } catch (e2) {}
  process.exitCode = 1;
});
