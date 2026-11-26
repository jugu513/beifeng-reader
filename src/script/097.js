/* ================= T8b. 跨会话朗读缓存（可选，默认关） =================
   按「引擎 + 音色/语速/音调 + 书 + 句文本」缓存合成好的音频块：回听上一句、
   重读同一章、重开听书头都零请求。上限 64MB、LRU 淘汰；只存音频，不存别的东西。
   隐私模式下一律不读不写；默认关 —— 要不要把正文音频留在磁盘上是用户的决定。
   索引落在 kv store（与音频块同一库），索引里带 book，删书时按书清干净。 */
BF.tts.cache = (function () {
  /* P4.5：音频块读写读 allocOf('audio')。音频是 Blob，只有 IndexedDB 能原样存 Blob；
     OPFS 封装是文本 API、LS 是字符串——两者存 Blob 需 base64 膨胀且无收益。故当前
     allocOf 选 opfs/ls 时如实回落 idb（介质不支持，非静默忽略），选 idb/auto 走原路径。
     接线点在此，未来若 OPFS 支持二进制块只需替换 put/get 的读写实现。 */
  function _audioMedia() {
    try { return BF.store.allocOf('audio'); } catch (e) { return 'auto'; }
  }
  const INDEX_KEY = 'tts.cache.index';
  const BLOB_PFX = 'tts.cache.a.';
  const TL_PFX = 'tts.cache.t.';   /* 同一句的词/句边界，跟着音频键的十六进制尾巴走 */
  const CAP = 64 * 1024 * 1024;
  let _idx = null;        /* [{k, bytes, at, book}] —— 内存真源，改动后台落盘 */
  let _saveT = null;
  function enabled() {
    try {
      if (!BF.settings.get('ttsCache')) return false;
      if (BF.settings.get('privacyMode')) return false;
      return !!(typeof crypto !== 'undefined' && crypto.subtle);
    } catch (e) { return false; }
  }
  async function loadIndex() {
    if (_idx) return _idx;
    try {
      const v = await BF.store.idbKeyGet(INDEX_KEY, null);
      _idx = Array.isArray(v) ? v.filter(function (x) { return x && typeof x.k === 'string'; }) : [];
    } catch (e) { _idx = []; }
    return _idx;
  }
  function saveIndexSoon() {
    if (_saveT) return;
    _saveT = BF.timers.timeout(function () {
      _saveT = null;
      const snap = (_idx || []).slice();
      Promise.resolve(BF.store.idbKeyPut(INDEX_KEY, snap)).catch(function (e) { BF.err.report('tts.cacheIndex', e); });
    }, 400);
  }
  function _bookId() {
    try { return (BF.tts.state && BF.tts.state.bookId) || BF.appState.currentBookId || '-'; } catch (e) { return '-'; }
  }
  function voiceSig(eng) {    /* 缓存键的「这一档当前用的是什么声音」由能力表那一行给：
       换了音色/语速/输出格式，键必须跟着变，否则会拿旧音色的音频播新设置。 */
    try {
      const cap = BF.tts.cap(eng);
      if (cap && cap.cacheKeyOf) return cap.cacheKeyOf();
      return String(eng);
    } catch (e) { return String(eng); }
  }
  async function keyOf(eng, text) {
    /* 会话书号优先：朗读中切书时 appState 已经指向新书，缓存却还在给旧书音频记账。
       start() 明确用 state.bookId 钉住会话，缓存必须同一口径。 */
    const raw = voiceSig(eng) + '|' + _bookId() + '|' + text;
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const arr = new Uint8Array(buf);
    let hex = '';
    for (let i = 0; i < 16; i++) hex += ('0' + arr[i].toString(16)).slice(-2);
    return BLOB_PFX + hex;
  }
  /* 一条缓存 = 音频块 + 可选的词/句边界 + 它属于哪一节（book + 章号 + 句序）。
     键是按正文文本算的内容地址，所以「文本没变」的命中天然正确；
     会留下的问题只有一个：重分章 / 改净化之后，旧切法的句子再也对不上任何键，
     变成没人引用也占地方的孤儿。清单（每节当前用着哪些键）就是为了能按节把它压掉。 */
  async function get(eng, text) {
    if (!enabled() || !text) return null;
    try {
      const k = await keyOf(eng, text);
      const idx = await loadIndex();
      const hit = idx.find(function (x) { return x.k === k; });
      if (!hit) return null;
      const blob = await BF.store.idbKeyGet(k, null);
      if (!blob || !blob.size) {   /* 索引在、文件没了：顺手把脏索引清掉，别让它一直骗人 */
        const i = idx.indexOf(hit); if (i >= 0) { idx.splice(i, 1); saveIndexSoon(); }
        return null;
      }
      /* 时间轴跟着音频一起回：命中缓存的句子也要能逐词跟随，
         否则「第二次听同一句反而没有下划线」这种反差没人解释得清。 */
      let tl = null;
      try {
        const raw = await BF.store.idbKeyGet(TL_PFX + k.slice(BLOB_PFX.length), null);
        if (raw && Array.isArray(raw.words) && raw.words.length) {
          tl = { words: raw.words.map(function (w) { return { txt: w.t || '', ms: w.ms | 0, dur: w.d | 0 }; }) };
        }
      } catch (e) { tl = null; }
      hit.at = Date.now(); saveIndexSoon();
      return { blob: blob, tl: tl || null };
    } catch (e) { return null; }
  }
  async function put(eng, text, blob, tl) {
    if (!enabled() || !text || !blob || !blob.size) return;
    /* P4.5：音频块介质由 allocOf('audio') 决定；Blob 仅 IDB 可原样存，opfs/ls 回落 idb。 */
    const _media = _audioMedia();
    const _blobStore = (_media === 'idb' || _media === 'auto' || _media === 'opfs' || _media === 'ls') ? 'idb' : 'idb';
    try {
      const k = await keyOf(eng, text);
      const idx = await loadIndex();
      const bytes = blob.size;
      const old = idx.find(function (x) { return x.k === k; });
      if (old) { old.bytes = bytes; old.at = Date.now(); }
      else idx.push({
        k: k, bytes: bytes, at: Date.now(),
        book: _bookId(),
        ch: (typeof BF.appState.currentChapterIdx === 'number') ? BF.appState.currentChapterIdx : -1,
        /* sig = 这一条是哪一档、哪个音色下出来的。按节压缩时必须只压同 sig 的：
           否则「刚用 MiMo 听完这一章」会把 Edge 那份同样合法的缓存一起删掉。 */
        sig: voiceSig(eng),
      });
      let total = idx.reduce(function (s, x) { return s + (x.bytes || 0); }, 0);
      while (total > CAP && idx.length > 1) {
        let oi = 0;
        for (let i = 1; i < idx.length; i++) if (idx[i].at < idx[oi].at) oi = i;
        const victim = idx.splice(oi, 1)[0];
        total -= victim.bytes || 0;
        Promise.resolve(BF.store.idbKeyDelete(victim.k)).catch(function () {});
        /* 音频没了，边界留着就是孤儿：一起删 */
        Promise.resolve(BF.store.idbKeyDelete(TL_PFX + victim.k.slice(BLOB_PFX.length))).catch(function () {});
      }
      await BF.store.idbKeyPut(k, blob);
      const tk = TL_PFX + k.slice(BLOB_PFX.length);
      const _words = (tl && tl.words) ? tl.words.map(function (w) {
        return { t: String((w && w.txt) || ''), ms: (w && w.ms) | 0, d: (w && w.dur) | 0 };
      }) : null;
      if (_words && _words.length) {
        try { await BF.store.idbKeyPut(tk, { words: _words }); } catch (e) { BF.err.report('tts.cacheTlPut', e); }
      } else { try { await BF.store.idbKeyDelete(tk); } catch (e) { BF.err.report('tts.cacheTlDel', e); } }
      saveIndexSoon();
    } catch (e) { BF.log && BF.log.warn('朗读缓存写入失败：' + (e && e.message)); }
  }
  /* 按节压缩：这一节现在用着哪些键，进来就说一次。
     上一次记的键里，这次不再出现的（重分章、换分段粒度、改净化都可能）直接删。
     只动这一节、只动这一本书，别处的缓存一条不碰。 */
  async function syncSection(bookId, ch, keys, sig) {
    if (!bookId || !Array.isArray(keys)) return { dropped: 0 };
    try {
      const idx = await loadIndex();
      const want = new Set();
      keys.forEach(function (k) { if (k) want.add(String(k)); });
      const keep = [];
      let dropped = 0;
      for (const x of idx) {
        /* 只有「同一本书、同一节、同一档同一音色」的条目才在本次判定范围内 */
        if (x.book === bookId && (x.ch == null ? -1 : x.ch) === ch && (!sig || x.sig === sig) && !want.has(x.k)) {
          try { await BF.store.idbKeyDelete(x.k); } catch (e) { BF.err.report('tts.cacheDrop:' + x.k, e); }
          try { await BF.store.idbKeyDelete(TL_PFX + x.k.slice(BLOB_PFX.length)); } catch (e) { BF.err.report('tts.cacheDropTl', e); }
          dropped++;
          continue;
        }
        keep.push(x);
      }
      if (dropped) { _idx = keep; saveIndexSoon(); }
      return { dropped: dropped, kept: want.size };
    } catch (e) { BF.err.report('tts.cacheSyncSection', e); return { dropped: 0 }; }
  }
  /* 给朗读启动用的高层入口：只交这一节的句文本，键怎么算、比哪一档由缓存自己管 */
  async function syncSectionFrom(eng, bookId, ch, texts) {
    if (!enabled() || !Array.isArray(texts) || !texts.length) return { dropped: 0 };
    const keys = [];
    for (let i = 0; i < texts.length; i++) {
      const t = texts[i];
      if (t) { try { keys.push(await keyOf(eng, t)); } catch (e) {} }
    }
    return syncSection(bookId, ch, keys, voiceSig(eng));
  }
  /* 某一节的正文变了（如手动改过这一章）时用的定点清节 */
  async function dropChapter(bookId, ch) {
    try {
      const idx = await loadIndex();
      const keep = [];
      let n = 0;
      for (const x of idx) {
        if (x.book === bookId && (x.ch == null ? -1 : x.ch) === ch) {
          try { await BF.store.idbKeyDelete(x.k); } catch (e) { BF.err.report('tts.cacheDrop:' + x.k, e); }
          try { await BF.store.idbKeyDelete(TL_PFX + x.k.slice(BLOB_PFX.length)); } catch (e) { BF.err.report('tts.cacheDropTl', e); }
          n++;
          continue;
        }
        keep.push(x);
      }
      if (n) { _idx = keep; saveIndexSoon(); }
      return n;
    } catch (e) { BF.err.report('tts.cacheDropChapter', e); return 0; }
  }
  async function purgeBook(bookId) {
    try {
      const idx = await loadIndex();
      const keep = [];
      for (const x of idx) {
        if (x.book === bookId) {
          try { await BF.store.idbKeyDelete(x.k); } catch (e) { BF.err.report('tts.cachePurgeKey:' + x.k, e); }
          try { await BF.store.idbKeyDelete(TL_PFX + x.k.slice(BLOB_PFX.length)); } catch (e) { BF.err.report('tts.cachePurgeTl', e); }
        }
        else keep.push(x);
      }
      if (keep.length !== idx.length) { _idx = keep; saveIndexSoon(); }
    } catch (e) { BF.err.report('tts.cachePurge', e); }
  }
  /* 返回实际删掉的条数：腾退阶梯据此判断「真的腾出了东西」，
     缓存本来就空时不能报腾退成功（否则 evicted 名单与提示都是假的）。 */
  async function clear() {
    let _n = 0;
    try {
      const idx = await loadIndex();
      _n = idx.length;
      for (const x of idx) {
        try { await BF.store.idbKeyDelete(x.k); } catch (e) { BF.err.report('tts.cachePurgeKey:' + x.k, e); }
        try { await BF.store.idbKeyDelete(TL_PFX + x.k.slice(BLOB_PFX.length)); } catch (e) { BF.err.report('tts.cachePurgeTl', e); }
      }
      _idx = [];
      await BF.store.idbKeyDelete(INDEX_KEY);
    } catch (e) { BF.err.report('tts.cacheClear', e); }
    return _n;
  }
  async function stats() {
    const idx = await loadIndex();
    const byBook = {};
    idx.forEach(function (x) {
      const b = x.book || '-';
      const e = byBook[b] || (byBook[b] = { n: 0, bytes: 0, chapters: {} });
      e.n++; e.bytes += (x.bytes || 0);
      const c = String(x.ch == null ? -1 : x.ch);
      e.chapters[c] = (e.chapters[c] || 0) + 1;
    });
    return { n: idx.length, bytes: idx.reduce(function (s, x) { return s + (x.bytes || 0); }, 0), cap: CAP, byBook: byBook };
  }
  return {
    get: get, put: put, purgeBook: purgeBook, clear: clear, stats: stats,
    /* 清单对外要的三件：算键（给 syncSection 用）、按节压、按节清 */
    keyOf: keyOf, syncSection: syncSection, syncSectionFrom: syncSectionFrom, dropChapter: dropChapter,
    _enabled: enabled,
  };
})();

