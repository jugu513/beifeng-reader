/* ================= D2. 数据自愈 ================= */
BF.heal = (function () {
  async function repairBooks() {
    /* R1：整段逻辑移入 mutate 回调，{fixed,dropped} 用闭包带出供 .then 使用。
       无修复时返回 false —— 不写回，避免无意义的存储写入。 */
    let fixed = 0, dropped = 0;
    const _done = BF.store.mutate(BF.store.K.BOOKS_META, function (books) {
      books = books || [];
      const out = [];
      for (const b of books) {
        if (!b || typeof b !== 'object' || Array.isArray(b)) { dropped++; continue; }
        if (!b.id) { b.id = BF.library.newBookId(); fixed++; }
        if (!b.title) { b.title = '未命名书籍'; fixed++; }
        if (typeof b.totalChapters !== 'number' || b.totalChapters < 0) { b.totalChapters = 0; fixed++; }
        out.push(b);
      }
      if (!(fixed || dropped)) return false;   /* 无修复 → 不写回 */
      return out;
    });
    await _done;
    /* 注意：{fixed,dropped} 必须在 await 之后组装 ——
       mutate 回调在 prev.then 内异步执行，await 之前读这两个闭包量恒为 0，
       会让「修复 N 本」永远显示 0（静默失效，零报错）。 */
    const r = { fixed: fixed, dropped: dropped };
    if (r.fixed || r.dropped) {
      BF.log.warn('数据检查：修复 ' + r.fixed + ' 本元数据，剔除 ' + r.dropped + ' 条异常记录');
    }
    return r;
  }
  function repairDaily() {
    const daily = BF.store.lsGet(BF.store.K.DAILY, {});
    let fixed = 0;
    for (const k in daily) {
      if (typeof daily[k] !== 'number' || daily[k] < 0 || !/^\d{4}-\d{2}-\d{2}$/.test(k)) { delete daily[k]; fixed++; }
    }
    if (fixed) { BF.store.lsSet(BF.store.K.DAILY, daily); BF.log.warn('数据检查：清理 ' + fixed + ' 条异常每日统计记录'); }
    return { fixed };
  }
  /* 自动清理的量级上限：超过它就只统计不删（数据页确认后带 force 再来一次）。
     书架「读不到」与「真没有书」在数据上长得一样，而删正文不可逆 ——
     宁可留一堆残留让用户看见，也不能悄悄删掉上千段正文。 */
  const ORPHAN_CAP = { books: 3, chapters: 200, titles: 50 };
  /* 最近一次按上限扣住没删的统计，供数据页展示与人工确认 */
  let _held = null;
  function orphanHold() { return _held; }
  /* 孤儿判定的唯一一条路径：书架、损坏区、回收站、正文库四道前置都读得到，
     才给出「哪些正文没有归属」的清单；任一前置读不到就返回 { skip }。
     「读不到」不等于「没有」—— 拿它当依据删除，就是把一堆未知当成一堆垃圾。
     导入进行中同样跳过：那时新书正一段段落库、书架也还在补，此刻扫到的"没归属"
     多半是半成品，删下去就是切掉正在写入的正文。 */
  async function _orphanCollect(mode) {
    if (BF.library && BF.library.__importing) return { skip: '导入进行中，跳过残留数据清理' };
    let books;
    try {
      const _raw = localStorage.getItem(BF.store.PREFIX + BF.store.K.BOOKS_META);
      if (_raw == null) {
        books = [];
      } else {
        books = JSON.parse(_raw);
        if (!Array.isArray(books)) throw new Error('books_meta 结构异常（非数组）');
      }
    } catch (e) {
      BF.err.report('heal.orphans.meta', e);
      return { skip: '书架读取失败，跳过残留数据清理（不把「读不到」当「没有」）' };
    }
    const ids = new Set(books.map(function (b) { return b && String(b.id); }).filter(Boolean));
    /* corrupt 区里留着 books_meta 的备份 ⇒ 书架刚刚被损坏重置过，
       此刻的「空」是读坏，不是真没有书。这时清孤儿就是把所有正文判成垃圾删光，
       所以整体跳过，等用户从数据栏处理（恢复入口在那儿）。 */
    if (BF.store.corruptHas && BF.store.corruptHas(BF.store.K.BOOKS_META)) {
      return { skip: '书架记录刚从损坏中重置，跳过残留清理（先恢复书架，再谈清孤儿）', corrupt: true };
    }
    /* 回收站里的书不在 books_meta，但正文必须原样留着（恢复靠的就是它）：
       不把回收站 id 并进来，下次启动这里就会把回收站里每本书的正文当孤儿删干净 ——
       「删了能恢复」立刻变成「恢复出来一本空书」。同样按「不把读不到当没有」处理：
       trash 键解析失败就整体跳过孤儿清理，宁可不删。 */
    try {
      const _rawT = localStorage.getItem(BF.store.PREFIX + BF.store.K.TRASH);
      if (_rawT != null) {
        const tr = JSON.parse(_rawT);
        if (!Array.isArray(tr)) throw new Error('trash 结构异常（非数组）');
        tr.forEach(function (x) { if (x && x.meta && x.meta.id) ids.add(String(x.meta.id)); });
      }
    } catch (e) {
      BF.err.report('heal.orphans.trash', e);
      return { skip: '回收站读取失败，跳过残留数据清理（不把「读不到」当「没有」）' };
    }
    /* 归属扫描走索引，不搬正文。一条章节记录揣着整段压缩正文，全表 getAll 在十万段
       量级是十几秒（实测 13 万段 14.9s），而它过去在启动链路上每次都跑一遍。
       这里只需要两件事：库里有哪些书（索引键去重，请求数=书数）、某本书有哪些段（索引取主键）。
       读失败一律不往下删 —— 与旧版同一口径：读不到不等于没有。
       bookId 缺失的旧记录进不了索引，也就不会被判成孤儿删掉：宁可留一点认不出主人的残留。
       mode='force' 是人在数据页看过数并点头的那一次，要把键取全；
       平时只为"要不要扣住"判断，超过上限即停，不做无谓的全表游走。 */
    const full = mode === 'force';
    const keyCap = full ? Infinity : ORPHAN_CAP.chapters + 1;
    let owners = [];
    try { owners = await BF.store.idbIndexDistinct(BF.store.K.CHAPTERS, 'bk', { strict: true }) || []; }
    catch (e) { BF.err.report('heal.orphans.chapters', e); return { skip: '正文库读取失败，跳过残留数据清理' }; }
    const orphanBooks = new Set();
    owners.forEach(function (b) { const s = String(b == null ? '' : b); if (s && !ids.has(s)) orphanBooks.add(s); });
    const orphanCh = [];
    for (const bk of orphanBooks) {
      if (orphanCh.length > keyCap) break;
      let keys = [];
      try { keys = await BF.store.idbIndexKeys(BF.store.K.CHAPTERS, 'bk', IDBKeyRange.only(bk), { strict: true }) || []; }
      catch (e1) { BF.err.report('heal.orphans.chapterKeys', e1); return { skip: '正文库读取失败，跳过残留数据清理' }; }
      for (const k of keys) orphanCh.push({ id: k, bookId: bk });
    }
    let tsKeys = [];
    try { tsKeys = await BF.store.idbAllKeys(BF.store.K.CHAPTER_TITLES, { strict: true }) || []; }
    catch (e2) { BF.err.report('heal.orphans.titles', e2); return { skip: '章节目录读取失败，跳过残留数据清理' }; }
    const orphanTs = [];
    for (const k of tsKeys) {
      if (k == null || ids.has(String(k))) continue;
      orphanTs.push({ id: k });
      if (orphanTs.length > keyCap) break;
    }
    /* 正文的第三层落点：OPFS 分批目录。IDB 的 bk 索引看不见它 ——
       一本书若整本走了分批（IDB 全挂的那次导入），owners 里根本没有它，
       只按 IDB 判孤儿就会出现「书架清空了、正文还在磁盘上」。
       列一层目录名与 ids 取差集才认得出这一类残留。 */
    const orphanOpfs = [];
    try {
      const _opIds = await BF.library._listOpfsBookIds();
      for (const oid of _opIds) { if (oid && !ids.has(String(oid))) orphanOpfs.push(String(oid)); }
    } catch (e3) { BF.err.report('heal.orphans.opfs', e3); }
    return { ids: ids, orphanCh: orphanCh, orphanTs: orphanTs, orphanBooks: orphanBooks, orphanOpfs: orphanOpfs };
  }
  /* 孤儿章节清理：书已删但 IDB 里章节正文/标题残留。
     全量拉取 + 按 bookId 归属判定，残留按 500 键一事务批量删。
     返回 { chapters, titles, held }：held 是被上限扣住的条数（本次没删）。 */
  async function repairOrphans(force) {
    _held = null;   /* 每次进来先清空上一次的「扣住没删」统计：任何一条跳过路径都不该留下旧数 */
    const scan = await _orphanCollect(force ? 'force' : '');
    if (scan.skip) {
      BF.log.warn('数据检查：' + scan.skip);
      return scan.corrupt ? { chapters: 0, titles: 0, skipped: '书架记录损坏待恢复' } : { chapters: 0, titles: 0 };
    }
    const ids = scan.ids;
    const out = { chapters: 0, titles: 0, opfsBooks: 0, held: 0 };
    /* 超上限就扣住不删（force=true 是用户在数据页看过数之后手动点头的那一次）。
       不可逆的批量销毁不该由一次「读到空书架」代劳。 */
    if (!force && (scan.orphanBooks.size > ORPHAN_CAP.books || scan.orphanCh.length > ORPHAN_CAP.chapters || scan.orphanTs.length > ORPHAN_CAP.titles || scan.orphanOpfs.length > ORPHAN_CAP.books)) {
      _held = { books: scan.orphanBooks.size, chapters: scan.orphanCh.length, titles: scan.orphanTs.length, opfs: scan.orphanOpfs.length };
      out.held = scan.orphanCh.length + scan.orphanTs.length;
      BF.log.warn('数据检查：' + scan.orphanBooks.size + ' 本书的正文不属于书架（' + scan.orphanCh.length + ' 段正文、' + scan.orphanTs.length + ' 组标题、' + scan.orphanOpfs.length + ' 本分批正文），量级过大没有自动删除');
      return out;
    }
    if (scan.orphanCh.length) out.chapters = await BF.store.idbDeleteMany(BF.store.K.CHAPTERS, scan.orphanCh.map(function (x) { return x.id; }));
    if (scan.orphanTs.length) out.titles = await BF.store.idbDeleteMany(BF.store.K.CHAPTER_TITLES, scan.orphanTs.map(function (x) { return x.id; }));
    if (scan.orphanOpfs.length) {
      for (const oid of scan.orphanOpfs) {
        try { if (await BF.library._dropOpfsBook(oid)) out.opfsBooks++; } catch (e) { BF.err.report('heal.dropOpfs:' + oid, e); }
      }
    }
    /* 标注侧孤儿监测（防御性）：删书已级联清理书签/划线/便签/生词四类标注，
       此处兜底扫描 LS 标注键，统计 bookId 不在 ids 的孤儿条目并告警（不自动删，避免结构不明误删）。 */
    ['BOOKMARKS', 'HIGHLIGHTS', 'NOTES', 'VOCAB'].forEach(function (kk) {
      try {
        const _raw = localStorage.getItem(BF.store.PREFIX + BF.store.K[kk]);
        if (_raw == null) return;
        const arr = JSON.parse(_raw);
        if (!Array.isArray(arr)) return;
        const orphans = arr.filter(function (x) { return x && !ids.has(String(x.bookId)); });
        if (orphans.length) BF.log.warn('数据检查：发现 ' + orphans.length + ' 条没有所属书籍的标注（' + kk + '），可在书架或回收站清理相关书籍时一并处理');
      } catch (e) { BF.err.report('heal.orphans.' + kk, e); }
    });
    if (out.chapters || out.titles || out.opfsBooks) BF.log.warn('数据检查：清理无所属书籍的章节正文 ' + out.chapters + ' 段、标题 ' + out.titles + ' 条、分批正文 ' + out.opfsBooks + ' 本');
    return out;
  }
  /* 问前先验：确认框里的数字要当场查，不能拿上一次自愈留下的快照凑数
     （书架与正文库在这段时间里可能已经变了）。前置读不到时返回 null，
     由调用方决定「无法核实就别往下走」。 */
  async function orphanFacts() {
    const c = await _orphanCollect('force');
    if (c.skip) return null;
    return { books: c.orphanBooks.size, chapters: c.orphanCh.length, titles: c.orphanTs.length, opfs: c.orphanOpfs.length };
  }
  /* 回收站里的书不在书架上，但正文必须留着等恢复 ⇒ 它们不是「待恢复」，
     也不能被重建动作悄悄放回书架。读不到回收站时返回 null，调用方按
     「不知道」处理：不提恢复、不重建。 */
  function _trashIds() {
    try {
      const raw = localStorage.getItem(BF.store.PREFIX + BF.store.K.TRASH);
      if (raw == null) return new Set();
      const tr = JSON.parse(raw);
      if (!Array.isArray(tr)) return null;
      const s = new Set();
      tr.forEach(function (x) { if (x && x.meta && x.meta.id) s.add(String(x.meta.id)); });
      return s;
    } catch (e) { return null; }
  }
  /* 书架与正文库交叉对账：books_meta 是索引，IDB 里的正文与目录才是真源。
     返回「能放回书架的本数」（0 = 不提恢复）。
     两种形态才算候选：
       ① corrupt 区留着书架的损坏副本 ⇒ 索引是被读坏的，正文还在就是可恢复；
          这时哪怕用户已经导入了新书，其余几本也一样是被吃掉的书，要提。
       ② 没有任何损坏凭据而书架有书 ⇒ 目录里多出来的那些更可能是正常删除的残留，
          把它们放回书架就是复活用户明确删掉的东西 —— 不提。
     回收站里的书不算（正文本来就该留着，恢复要从回收站那条路走）。 */
  async function shelfRestoreCandidate() {
    let books = [];
    try {
      const raw = localStorage.getItem(BF.store.PREFIX + BF.store.K.BOOKS_META);
      if (raw != null) { const v = JSON.parse(raw); if (Array.isArray(v)) books = v; }
    } catch (e) { books = []; }   /* 解析失败按空书架看：正文还在，正是可恢复的那种形态 */
    const evidence = !!(BF.store.corruptHas && BF.store.corruptHas(BF.store.K.BOOKS_META));
    if (!evidence && books.length) return 0;
    const trashed = _trashIds();
    if (trashed === null) return 0;
    const onShelf = new Set(books.map(function (b) { return b && String(b.id); }).filter(Boolean));
    let ts = [];
    try { ts = await BF.store.idbGetAll(BF.store.K.CHAPTER_TITLES, { strict: true }) || []; }
    catch (e2) { return 0; }
    return ts.filter(function (t) {
      if (!t || !t.id) return false;
      const id = String(t.bookId || t.id);
      return !onShelf.has(id) && !trashed.has(id);
    }).length;
  }
  /* 从正文库重建书架：只补缺，已在书架上的 id 一概不动（用户改过的书名、
     收藏、标签是人的数据，索引重建不该重写它们）。
     书名只能取自目录首条 —— 原书名随索引一起丢了，无从还原；章数如实。
     字数只在整本正文读得到时才补，读不到就标 statsUnknown，
     书架显示「字数未知」，不写 0 冒充已知。 */
  async function rebuildShelfFromTitles() {
    const trashed = _trashIds();
    if (trashed === null) {
      BF.log.warn('数据检查：回收站读不到，暂不重建书架（避免把已删除的书放回书架）');
      return { restored: 0, skipped: '回收站读取失败，稍后再试' };
    }
    let ts = [];
    try { ts = await BF.store.idbGetAll(BF.store.K.CHAPTER_TITLES, { strict: true }) || []; }
    catch (e) {
      BF.err.report('heal.rebuild.titles', e);
      BF.noti && BF.noti.error('正文库读不到，暂时无法重建书架');
      return { restored: 0, failed: true };
    }
    const onShelf = new Set((BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || [])
      .map(function (b) { return b && String(b.id); }).filter(Boolean));
    const fresh = [];
    for (const t of ts) {
      if (!t || !t.id) continue;
      const id = String(t.bookId || t.id);
      if (trashed.has(id) || onShelf.has(id)) continue;
      const titles = Array.isArray(t.titles) ? t.titles : [];
      if (!titles.length) continue;
      const first = String((titles[0] && titles[0].title) || '').trim();
      fresh.push({
        id: id, title: (first || id).slice(0, 60), totalChapters: titles.length,
        currentChapter: 0, lastRead: null, starred: false, tags: [],
        size: 0, enc: '?', src: 'restore', importedAt: Date.now(),
        wordCount: 0, chapterWords: [], shelfRestored: true, statsUnknown: true,
      });
    }
    if (!fresh.length) return { restored: 0, skipped: '正文库里没有可恢复的书' };
    for (const b of fresh) {
      try {
        const body = await BF.store.loadBody(b.id);
        if (typeof body === 'string' && body.length) {
          /* 整本正文按章以换行拼接，字数要扣掉这 (章数-1) 个分隔符 */
          b.wordCount = Math.max(0, body.length - (b.totalChapters - 1));
          b.statsUnknown = false;
        }
      } catch (e) { BF.err.report('heal.rebuild.body', e); }
    }
    let addedCount = 0;
    const _okW = await BF.store.mutate(BF.store.K.BOOKS_META, function (books) {
      books = books || [];
      const have = new Set(books.map(function (b) { return b && String(b.id); }));
      const add = fresh.filter(function (b) { return !have.has(b.id); });
      if (!add.length) return false;
      addedCount = add.length;
      return books.concat(add);
    });
    /* 写没进去就必须停在这里：报「已恢复 N 本」是假回执，而清掉损坏凭据更糟——
       下一轮孤儿清理不再跳过这些书，会把它们的正文当残留批量删掉，不可逆。 */
    if (_okW !== true) return { restored: 0, failed: true };
    /* 书架重建成功 ⇒ 那份损坏原文的使命到此为止，清掉它，
       否则孤儿清理会一直被「损坏凭据」按着，残留正文只增不减。 */
    const clearedCorrupt = addedCount > 0 && !!(BF.store.corruptClear && BF.store.corruptClear(BF.store.K.BOOKS_META));
    try { if (BF.app && BF.app.renderBookshelf) BF.app.renderBookshelf(); } catch (e) { BF.err.report('heal.rebuild.render', e); }
    return {
      restored: addedCount,
      unknown: fresh.filter(function (b) { return b.statsUnknown; }).length,
      clearedCorrupt: clearedCorrupt,
    };
  }
  /* 恢复书架的统一出口（启动提示与数据页按钮都走这里），反馈只有一份。 */
  async function restoreShelf() {
    try {
      const r = await rebuildShelfFromTitles();
      if (r.failed) {
        BF.noti && BF.noti.warn('书架没能写回：本地存储不可写或已满，请先清理再试');
        return r;
      }
      if (!r.restored) {
        BF.noti && BF.noti.info(r.skipped || '没有可恢复的书');
        return r;
      }
      BF.noti && BF.noti.success('已恢复 ' + r.restored + ' 本书到书架（书名取自各自的第一章）' +
        (r.unknown ? '；其中 ' + r.unknown + ' 本的字数无从还原，书架上标「字数未知」' : '') +
        (r.clearedCorrupt ? '；那份读坏的书架记录已随恢复一并清掉' : ''));
      return r;
    } catch (e) {
      BF.err.report('heal.restoreShelf', e);
      BF.noti && BF.noti.error('恢复失败：' + (e && e.message || '未知错误'));
      return { restored: 0, failed: true };
    }
  }
  /* 启动对账：正文库里有货而书架上没有 ⇒ 出声并给一个按钮。
     不自动写书架：恢复会新增条目，那一下得用户自己点。 */
  async function offerShelfRestore() {
    const n = await shelfRestoreCandidate();
    if (!n) return;
    BF.log.warn('数据检查：本机正文库里还留着 ' + n + ' 本书的章节目录，但书架上没有它们');
    try {
      BF.noti.warn('本机正文库里还留着 ' + n + ' 本书的章节，书架上却没有它们，可以放回书架', {
        action: { label: '恢复书架', run: function () { restoreShelf(); } },
      });
    } catch (e) { BF.err.report('heal.offerRestore', e); }
  }
  /* 单飞：启动链跑一次，异常看门狗还会再喊。两轮同时在跑时，后一轮会拿着
     前一轮删到一半的现场做孤儿判定，并把 _held 覆盖成中间态 —— 扣住的数量
     因此可能是假的。第二次调用直接复用进行中的那一次，不另开扫描。 */
  let _running = null;
  async function run() {
    if (_running) return _running;
    _running = _runOnce().then(function (r) { _running = null; return r; },
      function (e) { _running = null; throw e; });
    return _running;
  }
  async function _runOnce() {
    try { repairBooks(); } catch (e) { BF.err.report('heal.books', e); }
    try { repairDaily(); } catch (e) { BF.err.report('heal.daily', e); }
    let orphanResult = null;
    try { orphanResult = await repairOrphans(); } catch (e) { BF.err.report('heal.orphans', e); }
    if (orphanResult && orphanResult.held) {
      try {
        /* F-03：held 是扫描到上限即停的采样值，不是确数——说「有 N 条」是假精确。
           直达清理复用数据页那条确认链（danger:3 + 查前验），不让用户去第三层找按钮。 */
        BF.noti.warn('检测到至少 ' + orphanResult.held + ' 条正文不属于书架里的任何书（已达扫描上限，实际可能更多），未自动清理', {
          action: { label: '立即清理', run: function () { try { if (BF.base && BF.base.action) BF.base.action('cleanorphans', null); } catch (e) {} } },
        });
      } catch (e) { BF.err.report('heal.orphans.holdNoti', e); }
    }
    /* UGC→IDB 启动回填与 '__buf.' 遗键清理都挂在这一轮自愈里（原本在存储模块加载时）：
       让它们第一个打开 IDB，就会抢在 idb:up 消费方注册前发事件，冷启动白刷一条告警。 */
    try { if (BF.store.selectBackend && BF.store.selectBackend() === 'next' && window.indexedDB) await BF.store.migrateUgcToIdb(); } catch (e) { BF.err.report('heal.ugcMigrate', e); }
    try { if (BF.store._cleanupLegacyBufferKeys) await BF.store._cleanupLegacyBufferKeys(); } catch (e) { BF.err.report('heal.legacyBufKeys', e); }
    try { await offerShelfRestore(); } catch (e) { BF.err.report('heal.offerRestore', e); }
    /* 分组归属只自检不自动删（与标注侧同一口径）：引用了不存在的组/书就告警，
       删与不删交给用户——自动删等于「悄悄没了」。 */
    try { BF.shelf.audit(); } catch (e) { BF.err.report('heal.shelf', e); }
    try { BF.store.quotaCheck(); } catch (e) { BF.log && BF.log.warn('storage.配额检查失败：' + (e && e.message)); }
    /* 启动即申请持久化存储，降低被浏览器自动清理的概率（失败静默，不影响启动） */
    try { if (navigator.storage && navigator.storage.persist) { navigator.storage.persist().catch(function () {}); } } catch (e) {}
    /* 记录持久化权限状态，供设置/运维面板展示与自愈决策（BF.store._persist 可被 UI 读取） */
    try { if (BF.store && BF.store.persistState) { BF.store.persistState().then(function (s) { BF.store._persist = s; BF.log && BF.log.info('存储持久化状态：' + JSON.stringify(s)); }).catch(function (e) { BF.err.report('heal.persistState', e); }); } } catch (e) { BF.err.report('heal.persistState', e); }
    /* 启动跨标签页同步（仅广播变更种类，对端从自身 IDB 重新拉取） */
    try { if (BF.sync && BF.sync.start) BF.sync.start(); } catch (e) {}
  }
  return { run, repairBooks, repairDaily, repairOrphans, orphanFacts, restoreShelf, shelfRestoreCandidate, orphanHold, ORPHAN_CAP };
})();

