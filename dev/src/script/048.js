/* ===== 把轻量阅读进度（bf_reading_state）合并进 books_meta 数组供渲染 =====
   渲染入口统一调用，下游 filter/sort/render 无感；books_meta 里已有的旧值优先，轻量键为准。 */
BF.library.mergeReadingState = function (books) {
  try {
    const rs = BF.store.lsGet(BF.store.K.READING_STATE, {}) || {};
    /* 净化 null/非对象/无 id 的脏条目（corrupt 自愈路径兜底），避免下游排序/渲染崩溃 */
    return (books || []).filter(function (b) { return b && typeof b === 'object' && b.id; }).map(function (b) {
      const st = rs[b.id];
      if (st) {
        if (typeof st.currentChapter === 'number') b.currentChapter = st.currentChapter;
        if (typeof st.lastRead === 'number') b.lastRead = st.lastRead;
      }
      return b;
    });
  } catch (e) { return (books || []).filter(function (b) { return b && typeof b === 'object' && b.id; }); }
};

BF.library.resplitBook = async function (bookId) {
  /* 手动重新分章。用当前 chapterStrategy + chapterRegex 对全书原文重跑分章，
     重新入库并更新元数据。用于「分错了可手动重分」。
     注意：重新分章会改变章节边界 → 旧标注按章定位可能失效（loc 的 si/so 是章内，
     章号变了就错位）。执行前提示用户，执行后旧标注由 pending 机制显式提示。 */
  const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
  const b = books.find(function (x) { return x && x.id === bookId; });
  if (!b) { BF.noti.warn('书不存在'); return; }
  /* 图片书（CBZ）没有文本正文可重切：readChapter 照实返回空串，逐章拼出来是一串
     换行，splitChapters 只会切成一本单章空书写回去 —— 旧图片记录那时已经删了，
     不可逆。先在这里拦住，别把确认框弹给一个注定失败的操作。 */
  if (b.img) { BF.noti.warn('《' + b.title + '》是图片书（CBZ），没有可重分的文本正文'); return; }
  /* 确认绑在能力上：确认由 BF.ask.confirm 统一发起——菜单项不再各自问
     一句（且文案与菜单同名重复），命令与 DSL 这条路径同样被覆盖。
     下面的取原文是只读的，无须提前做。 */
  const _ok = await BF.ask.confirm({
    title: '重新分章',
    body: '按当前分章规则重跑《' + BF.dom.esc(b.title) + '》全书？<br/>现有 ' + (b.totalChapters || 0) +
      ' 章的边界会被替换，旧标注若错位将逐条提示。<br/>完成后可 Ctrl+Z 撤销（超大书超预算时不登记，完成提示里会写明）。',
    confirmText: '重新分章', danger: 2, op: 'book.resplit', facts: {},
  });
  if (!_ok) return { ok: false, cancelled: true };
  /* 取全书原文：逐章拼接（章节标题行保留）。
     走 readChapter 而不是 getChapterText：某章读不到时必须停在这里，
     拿空串拼下去会得到一本"章数正常、少了几章正文"的书，
     而写回之后原来的字节就没了 —— 这是重分章唯一不可逆的那条路。
     content 恒等于原文切片，章头行本来就在里面，所以这里绝不再拼一次标题：
     拼了就成了「第1章 X\n第1章 X\n正文」，splitChapters 认两遍章头，
     每重分一次章数翻一倍、空章成倍增加，而界面照常报「完成」。
     标题只影响目录显示，重分章后目录本来就要按新边界重取。 */
  let full = '';
  for (let i = 0; i < (b.totalChapters || 0); i++) {
    const r = await BF.library.readChapter(b, i);
    if (!r.ok) {
      BF.noti.error('重新分章已中止：第 ' + (i + 1) + ' 章正文读不到（' + r.error + '）。为避免把缺章写回正文，本次未改动任何章节。');
      return { ok: false, readFailed: true, chapter: i + 1 };
    }
    if (i > 0) full += '\n';
    full += r.text;
  }
  const chapters = BF.library.splitChapters(full);
  if (!chapters.length) { BF.noti.error('重新分章失败：未分出任何章节'); return; }
  /* 撤销包与回滚快照都用共用那一份（见 __snapChapters）：
     分章数学（splitChapters 及以上）永不可动，只在写库前取字节级快照。 */
  let snap = null;
  try { snap = await BF.library.__snapChapters(b); } catch (e) { BF.err.report('resplit.snapshot', e); }
  const snapMB = snap ? snap.mb : 0;
  const _undoable = BF.library.__snapUndoable(snap);
  /* 写库经 act.run 通道——失败给人话化反馈（只 report+error 吐司不够），
     可逆时撤销登记绑在能力上；快照不可用时用显式 success 写明「未登记撤销」。 */
  const _noUndo = _undoable ? '' : (snap && snap.bytes > 8 * 1048576
    ? '（本书 ' + snapMB + 'MB 超撤销预算，未登记撤销）'
    : '（快照不可用，未登记撤销）');
  BF.act.run('重新分章为 ' + chapters.length + ' 章', function () {
    return (async function () {
      /* 读旧章节走 strict：读不到就当「没有旧章节」会把新章写完、旧章全留，
         界面看到的是重复章节混在一本书里，而且没有任何失败信号。
         按 bk 索引只取这本书的键名 —— 重切一本书不该付全库的代价。 */
      const toDel = await BF.store.idbIndexKeys(BF.store.K.CHAPTERS, 'bk', IDBKeyRange.only(String(bookId)), { strict: true }) || [];
      for (const cid of toDel) { try { await BF.store.idbDelete(BF.store.K.CHAPTERS, cid); } catch (e) { BF.err.report('resplit.clearOldChapters', e); } }
      /* 旧卷次的 OPFS 分批与 LS 兜底键一起清（口径同重建通道）：
         不清的话新章某批写失败时，第三读层会把上一卷的正文当成本章读回来。 */
      await BF.library.__dropBodyLayers(bookId, b.totalChapters || 0, chapters.length);
      let _putRc;
      try {
        _putRc = await BF.library.__putChapters(bookId, chapters);
      } catch (e) {
        /* 写完抛错而旧字节已删 —— 有快照就放回，没快照就如实说这本书坏了，
           绝不让它带着「重新分章完成」的界面状态活下去。 */
        if (snap) {
          try {
            await BF.library.__restoreChapters(snap);
            BF.noti.error('重新分章未生效，已按快照放回原章节（这本书没有被改动）：' + ((e && e.message) || e));
          } catch (e2) {
            BF.err.report('resplit.rollback', e2);
            BF.noti.error('重新分章失败且回滚也失败：' + ((e && e.message) || e) + '。这本书的正文可能已不完整，请先从备份恢复',
              { action: { label: '查看运维台', run: function () { try { if (BF.workbench && BF.workbench.open) BF.workbench.open('data'); } catch (e3) { BF.err.report('resplit.toLog', e3); } } } });
          }
        } else {
          BF.err.report('resplit.noSnap', e);
          BF.noti.error('重新分章失败且没有可用快照：' + ((e && e.message) || e) + '。旧章节已清，请从备份恢复或重新导入这本书');
        }
        throw e;
      }
      /* 部分批次失败（三层选层后仍败）不上抛，但必须出声（口径同 rebuild 通道） */
      if (_putRc && _putRc.failed > 0) {
        BF.noti.warn('重新分章部分完成：已存 ' + _putRc.written + ' 章、失败 ' + _putRc.failed + ' 章（缺章打开会显示读取失败，可释放空间后重试）');
      }
      /* meta 写回收敛进 mutate，回调内重新 find 该书（不持有回调外的陈旧 b 引用）。 */
      const _okMeta = await BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
        arr = arr || [];
        const _b = arr.find(function (x) { return x && x.id === bookId; });
        if (!_b) return false;
        _b.totalChapters = chapters.length;
        _b.wordCount = chapters.reduce(function (s, c) { return s + (c.content || '').length; }, 0);
        _b.chapterWords = chapters.map(function (c) { return (c.content || '').length; });  /* 每章字数 */
        /* 章界换了，手动边界就成了陈旧坐标：留着它，下一次改名走的重建会拿
           旧边界切新正文 —— 对不上就整本压成 1 章。重分章后一律作废，
           要手动边界得重新调一次。 */
        _b.chapterBounds = null;
        return arr;
      });
      if (_okMeta === false) throw new Error('书可能已被删除，书架未更新');
      /* 换章界即换 key 语义：预取缓存（bookId_idx 键）不清就是把新章节号
         对上旧正文的静默串页——重分章与撤销两条路都必须清。 */
      try { if (BF.reader && BF.reader.clearPrefetch) BF.reader.clearPrefetch(); } catch (e) {}
      try { BF.app.renderBookshelf(); BF.app.renderHome(); } catch (e) { BF.err.report('render.afterResplit', e); }
      try { BF.bus.emit(BF.EVENTS.BOOKSHELF); } catch (e) {}
    })();
  }, _undoable ? {
    /* 重分章改的是这本（也可能从书架对另一本发起）⇒ 归属记目标书，不是当时开着的书 */
    bookId: bookId,
    undo: function () {
      (async function () {
        /* 复原用共用那一份（见 __restoreChapters）：删当前章 → 快照原样放回，
           不经 __putChapters（它会再压缩一层并重发 id，标注 sid 映射会错乱），
           连 meta 的章数/字数/每章字数/手动边界一起回到快照那一刻 */
        await BF.library.__restoreChapters(snap);
        try { if (BF.reader && BF.reader.clearPrefetch) BF.reader.clearPrefetch(); } catch (e) {}
        try { BF.app.renderBookshelf(); BF.app.renderHome(); } catch (e) {}
        if (BF.appState.currentBookId === bookId) { try { BF.reader.loadChapter(true); BF.reader.refreshDrawer(); } catch (e) {} }
        try { BF.bus.emit(BF.EVENTS.BOOKSHELF); } catch (e) {}
      })().catch(function (e) { BF.err.report('resplit.undo', e); });
    },
  } : { success: '重新分章完成：' + chapters.length + ' 章' + _noUndo });
};

