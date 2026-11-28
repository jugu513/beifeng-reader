/* ================= 17. 书架辅助动作 ================= */
BF.app.setView = function (v) {
  BF.appState.viewMode = v;
  try { BF.settings.set('shelfViewMode', v); } catch (e) {}
  const vg = document.getElementById('view-grid'), vl = document.getElementById('view-list');
  if (vg) vg.setAttribute('aria-pressed', v === 'grid' ? 'true' : 'false');
  if (vl) vl.setAttribute('aria-pressed', v === 'list' ? 'true' : 'false');
  BF.app.renderBookshelf();
};
/* books_meta 的读改写统一走 BF.store.mutate（读最新值 → 回调 → 写回，按键串行）。
   toggleStar / togglePin / renameBook / _doDelete / batchAction 五处全部挂在
   mutate 上，禁止「读出数组 → 在闭包外等待 → 整条写回」的裸读改写 ——
   期间任何导入、收藏、删除都会被这条陈旧快照整条覆盖、永久丢失；
   renameBook 尤其危险 —— 它 await 的是用户可无限期停留的重命名对话框。
   定位用 grep 函数名，不要依赖注释里的行号：行号会随任何改动漂移，
   照着旧行号改会改错地方。例如：
     grep -n "BF.app._doDelete" / "BF.app.batchAction" / "BF.app.toggleStar" */
BF.app.toggleStar = function (id) {
  /* 渲染放 mutate 完成之后（与批量收藏同一口径）：
     回调是异步入队的，写在回调里等于在写回之前重渲染，
     读到的还是旧值 —— 点完收藏卡面不亮，得等下一次渲染才跟上。 */
  BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
    const b = (arr || []).find(x => x && x.id === id);
    if (!b) return false;
    b.starred = !b.starred;
    return arr;
  }).then(function (ok) {
    BF.app.renderBookshelf();
    if (ok === false) BF.log && BF.log.warn('收藏写入失败，书架数据可能未更新');
  });
};
BF.app.togglePin = function (id) {
  let on = false, title = '';
  BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
    const b = (arr || []).find(x => x && x.id === id);
    if (!b) return false;
    b.pinned = !b.pinned;
    on = b.pinned; title = b.title || '';
    return arr;
  }).then(function (ok) {
    BF.app.renderBookshelf();
    if (ok === false) { BF.log && BF.log.warn('置顶写入失败，书架数据可能未更新'); return; }
    BF.noti.info(on ? '已置顶《' + title + '》' : '已取消置顶');
  });
};
/* 想读（墨栖借鉴 #3）：独立布尔旗标，不参与 shelfState 进度派生——
   想读是「还没开读的意愿」，与 new/reading/done 三态正交，互不覆盖。 */
BF.app.toggleWish = function (id) {
  let on = false, title = '';
  BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
    const b = (arr || []).find(x => x && x.id === id);
    if (!b) return false;
    b.wish = !b.wish;
    on = b.wish; title = b.title || '';
    return arr;
  }).then(function (ok) {
    BF.app.renderBookshelf();
    if (ok === false) { BF.log && BF.log.warn('想读写入失败，书架数据可能未更新'); return; }
    BF.noti.info(on ? '已加入想读《' + title + '》' : '已移出想读');
  });
};
/* 重命名：修正错书名，写回 meta.title（书籍 id 不变，续读/进度/标签等关联不受影响） */
BF.app.renameBook = function (id) {
  const b0 = BF.store.lsGetArray(BF.store.K.BOOKS_META, []).find(x => x && x.id === id);
  if (!b0) return;
  BF.modal.prompt('重命名书籍', '修改书名（作者可在「书籍信息」中编辑）：', {
    value: b0.title || '',
    /* 空书名用 modal 内 inline 红字提示（输入即清除），不写进通知历史 */
    validate: function (v) { return (String(v == null ? '' : v).trim()) ? '' : '书名不能为空'; },
  }).then(function (val) {
    if (val == null) return;
    const t = String(val).trim();
    if (!t) return;   /* 校验已拦在 modal 内，正常不会到这；双保险 */
    /* 在 mutate 回调内重新取当前值，不复用对话开始时的快照 */
    BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
      const b = (arr || []).find(x => x && x.id === id);
      if (!b) return false;
      if (t === b.title) return false;
      b.title = t;
      return arr;
    }).then(function (ok) {
      if (ok === false) return;
      BF.app.renderBookshelf(); BF.app.renderHome();
      BF.noti.success('已重命名为《' + t + '》');
    });
  });
};
BF.app.toggleSelect = function (id) {
  if (!id) return;
  if (BF.appState.selectedBooks.has(id)) BF.appState.selectedBooks.delete(id);
  else BF.appState.selectedBooks.add(id);
  BF.app.renderBookshelf();
};
BF.app.deleteBookConfirm = function (id) {
  const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
  const b = books.find(x => x && x.id === id);
  if (!b) return;
  BF.ask.confirm({
    title: '删除书籍', body: '《' + BF.dom.esc(b.title) + '》将移入回收站：正文、划线、进度一条不动，随时可以恢复。' +
      '只有到了回收站里再点「彻底删除」，才是真的不可找回。',
    confirmText: '移入回收站', danger: 2, op: 'book.delete', facts: {},
  }).then(function (ok) {
    if (ok) BF.trash.moveTo(id);
  });
};
/* 批量删除的唯一入口：确认绑在能力上，不绑在入口上。
   书架批量按钮 / hub 的 shelf.batchDelete / DSL 的 books.batchDelete 都只调这里，
   任何入口都不得绕过确认框自行删除（档位再低也必须先问）。
   「搬进回收站」归 BF.trash，这里只负责「问」那一句。 */
BF.app.deleteBooks = function (ids) {
  ids = (ids || []).filter(Boolean);
  if (!ids.length) return Promise.resolve(false);
  const victims = BF.store.lsGetArray(BF.store.K.BOOKS_META, []).filter(function (b) { return b && ids.indexOf(b.id) >= 0; });
  if (!victims.length) { BF.noti.warn('没有可删除的书籍'); return Promise.resolve(false); }
  return BF.ask.confirm({
    title: '批量移入回收站',
    body: victims.length + ' 本将移入回收站：<br/>' + victims.map(function (b) { return BF.dom.esc(b.title); }).join('、') +
      '。<br/>正文与标注原样保留，在回收站里可逐本恢复。',
    confirmText: '移入回收站', danger: 2, op: 'book.deleteBatch', facts: {},
  }).then(function (ok) {
    if (!ok) return false;
    try { return BF.trash.moveMany(ids).then(function (n) { return n > 0; }); }
    catch (e) { BF.err.report('batch.delete', e); return false; }
  });
};
/* 彻底销毁数据本体：不动 books_meta（搬离书架是 BF.trash.moveTo 的事，
   抹掉回收站记录是 BF.trash.purge 的事）。拆成三段是为了让「可恢复」与
   「不可恢复」各挂各的档位：移入回收站 danger 2，彻底删除 danger 3 要敲字。
   本函数只负责级联清理，读改写一律走 mutate 串行通道，不做裸的
   lsGet → lsSet；删除（splice）归 BF.trash 管。 */
BF.app._doDelete = async function (id) {
  /* 返回 {ok, failed}：级联各步失败不得只 log 后当没发生 ——
     purge/empty 拿不到失败事实就会对用户谎报「已彻底删除」，
     残留正文/标注成为界面永远清不掉的孤儿。failed 计每步失败次数，
     调用方据此决定回执文案；本函数自身仍不中断后续步骤（能清多少清多少）。 */
  let _failed = 0;
  try { BF.reader.clearPrefetch(); } catch (e) {}   /* 删书：清正文缓存 */
  try { BF.bus.emit(BF.EVENTS.BOOKSHELF, id); } catch (e) {}
  try {
    /* 只取这本书的章节键名（bk 索引），不再全表 getAll 把整库正文搬进内存 ——
       删一本书不该付全库的代价。读不到章节表 ≠ 这本书没有章节：走 strict 让异常露出来，
       计入 failed，否则下面 toDel 为空、一步没删，回执却仍是「已彻底删除」，正文成了孤儿。 */
    let toDel = [];
    try { toDel = await BF.store.idbIndexKeys(BF.store.K.CHAPTERS, 'bk', IDBKeyRange.only(String(id)), { strict: true }) || []; }
    catch (e) { _failed++; BF.log.warn('删除前读取章节表失败（正文可能残留）：' + (e && e.message)); }
    for (const cid of toDel) { try { await BF.store.idbDelete(BF.store.K.CHAPTERS, cid); } catch (e) { _failed++; BF.log.warn('删除章节失败（残留 ' + cid + '）：' + (e && e.message)); } }
    try { await BF.store.idbDelete(BF.store.K.CHAPTER_TITLES, id); } catch (e) { _failed++; BF.log.warn('删除章节目录失败（残留 ' + id + '）：' + (e && e.message)); }
    /* 正文的第三个落点：OPFS 分批文件。IDB 与 LS 都清了，分批目录不清就是「删了书、正文还在」，
       失败批次接进 OPFS 的那些章尤其如此 —— 孤儿扫描看不见它（清单来自 IDB 索引）。 */
    try { if (!await BF.library._dropOpfsBook(id)) _failed++; } catch (e) { _failed++; BF.log.warn('清理 OPFS 分批正文失败（残留 books/' + id + '）：' + (e && e.message)); }
    /* 这本书的朗读音频缓存也清掉：缓存键带 bookId，删书后那段音频不该留在磁盘上 */
    try { if (BF.tts && BF.tts.cache && BF.tts.cache.purgeBook) await BF.tts.cache.purgeBook(id); } catch (e) { BF.log.warn('清理朗读缓存失败：' + (e && e.message)); }
    /* 问书分块索引一并失效：按 id 前缀清，索引里的正文已随书删掉 */
    try { if (BF.ai && BF.ai.chunkIdx) BF.ai.chunkIdx.invalidate(String(id)); } catch (e) {}
    /* 章节 LS 键清理用动态前缀枚举，不用固定次数循环：
       `for (i < total + 4) lsRemove('chap_'+id+'_'+i)` 里 total+4 是魔法数，
       书被重新分章后旧的章节键可能超出该范围而残留成孤儿。
       统一用 BF.store.lsKeys() 枚举（不裸用 Object.keys(localStorage)，
       lsKeys 已按 PREFIX 过滤并去掉前缀）。 */
    try {
      const _pfx = 'chap_' + id + '_';
      /* lsKeys() 返回的键已去掉 bf_ 前缀（BF.store 内 PREFIX='bf_'），
         即 k 已是完整键 chap_<id>_<n>，直接 lsRemove(k)，不可再拼前缀。 */
      (BF.store.lsKeys() || []).filter(function (k) { return String(k).indexOf(_pfx) === 0; })
        .forEach(function (k) { BF.store.lsRemove(k); });
    } catch (e) { _failed++; BF.log.warn('清理章节 LS 键失败（残留）：' + (e && e.message)); }
    /* 四张标注表必须走 mutate 串行通道，不能 lsGet→filter→lsSet 裸读改写：
       删除窗口里任何一处并发写入（用户刚划的一条线、刚存的一个生词）
       都会被这份「删除开始前读到的旧快照」整表覆盖掉。
       mutate 在队列内重读现值再改，读到的一定是写的那一刻的真值。
       返回 false = 写入失败：计入 failed，不许对用户谎报删干净。 */
    if (await BF.store.mutate(BF.store.K.BOOKMARKS, function (arr) { return (arr || []).filter(x => x && x.bookId !== id); }) === false) _failed++;
    if (await BF.store.mutate(BF.store.K.HIGHLIGHTS, function (arr) { return (arr || []).filter(x => x && x.bookId !== id); }) === false) _failed++;
    if (await BF.store.mutate(BF.store.K.VOCAB, function (arr) { return (arr || []).filter(x => x && x.bookId !== id); }) === false) _failed++;
    /* 删书级联清理便签：便签残留会造成幽灵数据 */
    if (await BF.store.mutate(BF.store.K.NOTES, function (arr) { return (arr || []).filter(x => x && x.bookId !== id); }) === false) _failed++;
    /* 新拓扑：同步清理 IDB 'ugc' 库里该书的所有标注（划线/书签/生词/便签）。
       不进 mutate 队列——'ugc' 是按书维度的独立索引，整书删除用 ugcDelBook 一次性清。
       ugcDelBook 真删失败返回 false，此处据实计入 failed —— IDB 副本删不掉会残留孤儿，
       不能再像旧版那样吞掉谎报成功（LS 那四张表由上方 mutate 负责，这里只负责 IDB 副本这一份）。 */
    try { if ((await BF.store.ugcDelBook(id)) === false) _failed++; } catch (e) { _failed++; BF.log.warn('清理 IDB 标注副本失败（' + id + '）：' + (e && e.message)); }
    /* 整书正文副本（OPFS books/<id>/body.txt，或降级时 kv 的 body:<id>）也随书删掉：
       只清章节表的话，这份整本副本没有任何界面入口，只会一直占着磁盘。
       计入 failed 与其它级联同一口径 —— 清不掉要让调用方知道，不能谎报删干净。
       delBookFiles 现在按每层真删结果返回 ok，返回 false 即某层未删净。 */
    try { if ((await BF.store.delBookFiles(id)) === false) _failed++; } catch (e) { _failed++; BF.log.warn('清理整书正文副本失败（' + id + '）：' + (e && e.message)); }
    BF.store.lsRemove(BF.store.K.SCROLL_ + id);
    BF.store.lsRemove(BF.store.K.PROGRESS_ + id);
    /* 删书同步清理轻量阅读进度键（书级单条），避免残留 */
    try {
      const rs = BF.store.lsGet(BF.store.K.READING_STATE, {}) || {};
      if (rs[id]) { delete rs[id]; BF.store.lsSet(BF.store.K.READING_STATE, rs); }
    } catch (e) { BF.err.report('deleteBook.readingState', e); }
    /* 按章页码键（progress_<id>_<idx>）随书一起清理，避免残留。
       与上方章节键清理统一走 BF.store.lsKeys()（不裸用
       Object.keys(localStorage) 绕过封装，catch 不得为空吞异常）。 */
    try {
      const _pPfx = BF.store.K.PROGRESS_ + id + '_';
      (BF.store.lsKeys() || []).filter(function (k) { return String(k).indexOf(_pPfx) === 0; })
        .forEach(function (k) { BF.store.lsRemove(k); });
    } catch (e) { _failed++; BF.log.warn('清理进度 LS 键失败（残留）：' + (e && e.message)); }
    if (BF.store.lsGet(BF.store.K.LAST_BOOK) === id) BF.store.lsSet(BF.store.K.LAST_BOOK, null);
    /* 删书级联清理 AI 问书会话 / 摘要缓存 / 阅读时长，避免跨书残留 */
    try {
      const _asks = BF.store.lsGet(BF.store.K.AI_ASK_SESSIONS, {}) || {};
      if (_asks[id]) { delete _asks[id]; BF.store.lsSet(BF.store.K.AI_ASK_SESSIONS, _asks); }
      const _sum = BF.store.lsGet(BF.store.K.AI_SUMMARY_CACHE, {}) || {};
      if (_sum[id]) { delete _sum[id]; BF.store.lsSet(BF.store.K.AI_SUMMARY_CACHE, _sum); }
      const _bt = BF.store.lsGet(BF.store.K.BOOK_TIME, {}) || {};
      if (_bt[id]) { delete _bt[id]; BF.store.lsSet(BF.store.K.BOOK_TIME, _bt); }
    } catch (e) { BF.err.report('deleteBook.ai', e); }
    /* 删书级联清理随书偏好孤儿：perbook_prefs 若残留该书条目，
       用得越久垃圾越多 */
    try { if (BF.prefs && BF.prefs.purgeBook) BF.prefs.purgeBook(id); } catch (e) { _failed++; BF.err.report('deleteBook.prefs', e); }
  } catch (e) { _failed++; BF.err.report('deleteBook.cleanup', e); }
  /* 幽灵书处理（与回收站 moveMany 的归属清理同形）：
     若彻底销毁的正是当前阅读器正打开的那本书，正文销毁后阅读页仍挂着旧 DOM，
     继续划标注/进度会产生无法归属的数据。处理与 moveMany 同形：先趁还读得到落一次进度，
     再清 currentBookId、关阅读器、回书架 —— 此后 addNote/addBookmark 等以 currentBookId
     为门的写入口自然拒绝，不必各自再判。不动分章、不加第二条撤销通道。 */
  try {
    if (String(id) === String(BF.appState.currentBookId)) {
      try { BF.reader.saveProgress(true); BF.reader.syncProgressToMeta(); } catch (e) { BF.err.report('deleteBook.saveProgressOnDelete', e); }
      BF.appState.currentBookId = null;
      try { BF.app.closeReader(); } catch (e) {}
      try { BF.app.go('bookshelf'); } catch (e) {}
    }
  } catch (e) { BF.err.report('deleteBook.ghostGuard', e); }
  /* 删书级联清分组归属：书没了还留一条 group_items 引用，就是永久孤儿。
     只在彻底销毁这里挂——「移进回收站」必须无损可恢复，分组也跟着原样留着。 */
  try { await BF.shelf.purgeBook(id); } catch (e) { _failed++; BF.err.report('deleteBook.shelf', e); }
  try { BF.bus.emit(BF.EVENTS.BOOK_DELETED, id); } catch (e) {}
  BF.app.renderBookshelf(); BF.app.renderHome();
  return { ok: _failed === 0, failed: _failed };
};
/* ============================================================
   回收站 BF.trash
   ------------------------------------------------------------
   软删标记路线：只把 books_meta 里那条记录搬进 bf_trash，正文
   （IDB chapters / chapter_titles）与随书数据（划线 / 书签 / 便签 /
   生词 / 进度 / AI 会话 / 随书偏好）原地不动。恢复因此是无损的，
   也不必给每本书另做影子副本。
   两条代价，都不许悄悄成立：
     · 自愈的孤儿清理（repairOrphans）凭 books_meta 认正文。回收站里的
       书不在 books_meta，不并集它的 id，下次启动就会把回收站里每本书的
       正文当孤儿删干净 —— 「删了能恢复」立刻变成「恢复出来一本空书」。
       那边有关键签名守着正文认领规则，动它等于拆承重墙。
     · 回收站里的书仍占存储，且不做自动过期。自动过期就是「悄悄没了」
       换了个名字，与「破坏必有回响」的设计方向相反；要减存储只剩一条路：
       用户在回收站里自己动手彻底删除。
   三级动作三个档位：移入 danger 2（可恢复）· 彻底删除 danger 3（要敲字）·
   清空 danger 3（要敲字）。面板 / hub / DSL 三条路径同一个标准。
   ============================================================ */
BF.trash = (function () {
  function all() {
    const t = BF.store.lsGetArray(BF.store.K.TRASH, []);
    return (Array.isArray(t) ? t : []).filter(function (x) { return x && x.meta && x.meta.id; });
  }
  function list() {
    return all().slice().sort(function (a, b) { return (b.deletedAt || 0) - (a.deletedAt || 0); });
  }
  function count() { return all().length; }
  function find(id) {
    const k = String(id);
    return all().find(function (x) { return String(x.meta.id) === k; }) || null;
  }
  function titleOf(m) { return (m && m.title) || '（无书名）'; }
  function dropOne(id) {
    return BF.store.mutate(BF.store.K.TRASH, function (arr) {
      return (Array.isArray(arr) ? arr : []).filter(function (x) { return x && String(x.meta.id) !== String(id); });
    });
  }
  /* 先入站、后摘架。顺序反了就是：摘架成功、入站失败 → 这本书哪都不在，
     等于「悄悄没了」——不允许。最坏只会出现「两处各显示一份」，
     移动时按 id 去重，一条数据不丢。 */
  async function moveMany(ids) {
    const uniq = Array.from(new Set((ids || []).filter(Boolean).map(String)));
    if (!uniq.length) return 0;
    const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
    const victims = (books || []).filter(function (b) { return b && uniq.indexOf(String(b.id)) >= 0; });
    if (!victims.length) return 0;
    const stamped = victims.map(function (m) { return { meta: m, deletedAt: Date.now() }; });
    const inHouse = await BF.store.mutate(BF.store.K.TRASH, function (arr) {
      const keep = (Array.isArray(arr) ? arr : []).filter(function (x) {
        return x && x.meta && stamped.every(function (t) { return String(t.meta.id) !== String(x.meta.id); });
      });
      return keep.concat(stamped);
    });
    if (inHouse === false) { BF.noti.error('回收站写入失败，本次一本书都没动'); return 0; }
    const off = await BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
      return (arr || []).filter(function (b) { return b && uniq.indexOf(String(b.id)) < 0; });
    });
    if (off === false) BF.log.warn('回收站：已入站但书架记录未摘除（写入失败），刷新后会同时出现在两处');
    if (uniq.indexOf(String(BF.store.lsGet(BF.store.K.LAST_BOOK, ''))) >= 0) BF.store.lsSet(BF.store.K.LAST_BOOK, null);
    /* 幽灵书处理：正在读的那本被移进回收站后，如果 currentBookId 与阅读器缓存的书还留着，
       之后的划线、便签、进度会继续写进一本「书架上已经不存在」的书 —— 数据不可归属，
       恢复回来时才发现多出一堆不知道算谁的标注。先趁还读得到落一次进度，再关阅读器清当前书：
       此后 addNote / addBookmark 这些以 currentBookId 为门的写入口自然拒绝，不必各自再判一遍。 */
    try {
      if (uniq.indexOf(String(BF.appState.currentBookId)) >= 0) {
        try { BF.reader.saveProgress(true); BF.reader.syncProgressToMeta(); } catch (e) { BF.err.report('trash.saveProgressOnMove', e); }
        BF.appState.currentBookId = null;
        try { BF.app.closeReader(); } catch (e) {}
        BF.app.go('bookshelf');
      }
    } catch (e) { BF.err.report('trash.ghostGuard', e); }
    try { uniq.forEach(function (id) { BF.appState.selectedBooks.delete(id); }); BF.app.updateBatch(); } catch (e) {}
    BF.app.renderBookshelf(); BF.app.renderHome();
    try { BF.bus.emit(BF.EVENTS.BOOKSHELF); } catch (e) {}
    renderIfOpen();
    return victims.length;
  }
  async function moveTo(id) {
    const b = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (x) { return x && String(x.id) === String(id); });
    if (!b) return false;
    const n = await moveMany([id]);
    if (!n) return false;
    /* 撤销按钮是快捷入口，不是倒计时：吐司 8 秒后消失，书照样在回收站里等着。 */
    BF.noti.success('《' + BF.dom.esc(titleOf(b)) + '》已移入回收站', {
      action: { label: '撤销', run: function () { restore(id); } },
      duration: 8000,
    });
    return true;
  }
  async function restore(id) {
    const it = find(id);
    if (!it) { BF.noti.warn('回收站里没有这本书'); return false; }
    const bid = String(it.meta.id);
    const dup = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).some(function (b) { return b && String(b.id) === bid; });
    if (dup) { BF.noti.warn('书架上已有同 ID 的书，《' + BF.dom.esc(titleOf(it.meta)) + '》不能重复恢复'); return false; }
    const back = await BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
      const a = Array.isArray(arr) ? arr : [];
      a.unshift(it.meta);
      return a;
    });
    if (back === false) { BF.noti.error('写回书架失败，《' + BF.dom.esc(titleOf(it.meta)) + '》仍在回收站'); return false; }
    const cutOk = await dropOne(bid);
    if (cutOk === false) BF.log.warn('回收站：已回到书架但入站记录没删掉（写入失败），刷新后会同时出现在两处');
    BF.app.renderBookshelf(); BF.app.renderHome();
    renderIfOpen();
    BF.noti.success('《' + BF.dom.esc(titleOf(it.meta)) + '》已恢复到书架');
    return true;
  }
  /* 问前先验：彻底删除的后果文案必须拿数据层真值填，不能靠 meta 上的缓存字段猜。
     段数走 bk 索引只取这本书的键名；读不到返回 null（不是 0）——
     「正文 0 段」和「正文此刻读不到」在确认框里是两句不同的话，
     把后者写成前者，用户就是在错误前提下敲的字。 */
  function facts(id) {
    const n = function (k) {
      return (BF.store.lsGet(k, []) || []).filter(function (x) { return x && String(x.bookId) === String(id); }).length;
    };
    return BF.store.idbIndexKeys(BF.store.K.CHAPTERS, 'bk', IDBKeyRange.only(String(id)), { strict: true })
      .then(function (keys) {
        return {
          chapters: (keys || []).length,
          marks: n(BF.store.K.HIGHLIGHTS), marksBm: n(BF.store.K.BOOKMARKS),
          notes: n(BF.store.K.NOTES), words: n(BF.store.K.VOCAB),
        };
      })
      .catch(function (e) { BF.err.report('trash.purgeFacts', e); return null; });
  }
  async function purge(id) {
    const it = find(id);
    if (!it) return false;
    const ok = await BF.ask.confirm({
      title: '彻底删除《' + BF.dom.esc(titleOf(it.meta)) + '》',
      body: '正文与随书数据一并从本机抹掉，回收站里也不再保留：<br/>' +
        '正文 {chapters} 段 · 划线 {marks} 条 · 书签 {marksBm} 条 · 便签 {notes} 条 · 生词 {words} 个。<br/>' +
        '这一步后面没有回收站了，删除后无法找回。',
      confirmText: '彻底删除', danger: 3, op: 'book.purge',
      verify: function () { return facts(id); },
    });
    if (!ok) return false;
    const gone = await dropOne(id);
    if (gone === false) { BF.noti.error('回收站记录删除失败，《' + BF.dom.esc(titleOf(it.meta)) + '》未被彻底删除'); return false; }
    /* _doDelete 返回 {ok, failed}：级联失败不许再报「已彻底删除」——
       那是回执与事实不符，残留数据从此界面上无处可寻。 */
    const _r = await BF.app._doDelete(String(it.meta.id));
    if (!_r || _r.ok !== true) {
      BF.noti.warn('《' + BF.dom.esc(titleOf(it.meta)) + '》删除未完成：有 ' + ((_r && _r.failed) || 1) + ' 步清理失败，残留数据会在下次启动时自动清理，原因见运维台。',
        { action: { label: '查看运维台', run: function () { try { if (BF.workbench && BF.workbench.open) BF.workbench.open('logs'); } catch (e) { BF.err.report('trash.purgeToLog', e); } } } });
    } else {
      BF.noti.success('已彻底删除《' + BF.dom.esc(titleOf(it.meta)) + '》');
    }
    BF.app.renderBookshelf(); renderIfOpen();
    return _r ? _r.ok : false;
  }
  async function empty() {
    const items = list();
    if (!items.length) { BF.noti.info('回收站本来就是空的'); return 0; }
    const ok = await BF.ask.confirm({
      title: '清空回收站',
      body: items.length + ' 本书的正文与随书数据将全部抹掉：<br/>' +
        items.slice(0, 12).map(function (x) { return BF.dom.esc(titleOf(x.meta)); }).join('、') +
        (items.length > 12 ? ' 等共 ' + items.length + ' 本' : '') + '<br/>' +
        '这一步后面没有回收站了，删除后无法找回。',
      confirmText: '清空回收站', danger: 3, op: 'trash.empty', facts: {},
    });
    if (!ok) return 0;
    const ids = items.map(function (x) { return String(x.meta.id); });
    /* 先销账本再清数据：中途崩了的话，正文成了哪都不认的孤儿，
       下次启动自愈照常收走 —— 与「彻底删除」的语义一致，不会留下幽灵书。 */
    const cleared = await BF.store.mutate(BF.store.K.TRASH, function () { return []; });
    if (cleared === false) { BF.noti.error('回收站写入失败，一本都没删'); return 0; }
    let n = 0; const failed = [];
    for (const id of ids) {
      /* _doDelete 返回 {ok, failed}：只有抛异常或返回 ok!==true 都记账，
         否则逐步 catch 吞掉的失败永远进不了 failed，回执恒为「全删干净」。 */
      try {
        const _r = await BF.app._doDelete(id);
        if (_r && _r.ok === true) n++; else { failed.push(id); if (!_r) BF.err.report('trash.emptyOne', new Error('_doDelete 无返回')); }
      } catch (e) { failed.push(id); BF.err.report('trash.emptyOne', e); }
    }
    BF.app.renderBookshelf(); BF.app.renderHome(); renderIfOpen();
    /* 提示必须与实际一致：删了 1 本却报「已清空」是假成功 ——
       失败那本的正文会留在库里（下次启动由 BF.heal.repairOrphans 收走），
       但用户有权知道这一本没删干净、以及去哪儿看原因。 */
    if (failed.length) {
      BF.noti.warn('回收站清空未完成：成功 ' + n + ' 本，失败 ' + failed.length + ' 本。失败那本的残留章节会在下次启动时自动清理，原因见运维台。',
        { action: { label: '查看运维台', run: function () { try { if (BF.workbench && BF.workbench.open) BF.workbench.open('logs'); } catch (e) { BF.err.report('trash.emptyToLog', e); } } } });
    } else {
      BF.noti.success('回收站已清空，彻底删除 ' + n + ' 本');
    }
    return n;
  }
  function renderIfOpen() { try { if (BF.sheet.isOpen('bf-trash')) render(); } catch (e) {} }
  function render() {
    const body = document.getElementById('bt-body');
    if (!body) return;
    const items = list();
    const cnt = document.getElementById('bt-count');
    if (cnt) cnt.textContent = items.length ? items.length + ' 本' : '空';
    if (!items.length) {
      body.innerHTML = BF.ui.blank({ icon: BF.dom.ic('folder'), msg: '回收站是空的', hint: '删除的书先进这里；「彻底删除」后不可找回' });
      return;
    }
    body.innerHTML =
      '<div class="bf-trash__tip">这里的东西都还完整：正文、划线、进度一条没动，点「恢复」就回书架。<b>不自动清除，直到你彻底删除</b>。</div>' +
      '<div class="bf-trash__list">' + items.map(function (x) {
        return '<div class="bf-trash__row">' +
          '<div class="bf-trash__main">' +
            '<div class="bf-trash__name">' + BF.dom.esc(titleOf(x.meta)) + '</div>' +
            '<div class="bf-trash__sub">移入 ' + new Date(x.deletedAt || Date.now()).toLocaleString('zh-CN') +
              ' · ' + (x.meta.totalChapters || 0) + ' 章' +
              (x.meta.wordCount ? ' · ' + Number(x.meta.wordCount).toLocaleString('zh-CN') + ' 字' : '') + '</div>' +
          '</div>' +
          '<button class="btn btn-xs" data-bt-back="' + BF.dom.escAttr(x.meta.id) + '">恢复</button>' +
          '<button class="btn btn-xs" data-bt-purge="' + BF.dom.escAttr(x.meta.id) + '">彻底删除</button>' +
        '</div>';
      }).join('') + '</div>';
    body.querySelectorAll('[data-bt-back]').forEach(function (b) {
      b.addEventListener('click', function () { restore(b.getAttribute('data-bt-back')); });
    });
    body.querySelectorAll('[data-bt-purge]').forEach(function (b) {
      b.addEventListener('click', function () { purge(b.getAttribute('data-bt-purge')); });
    });
  }
  function open() {
    /* 骨架由 BF._panel 工厂生成（标准形态：标题 + 头部控件 + 统一关闭按钮），
       开合与 Esc 交给 BF.sheet 浮层栈；这里只挂头部那颗「全部彻底删除」。 */
    if (!document.getElementById('bf-trash')) {
      const p = BF._panel('bf-trash', '回收站', {
        cls: 'dlg-shell', cssText: '--dlg-w:min(760px,94vw);--dlg-maxh:80vh',
        label: '回收站', bodyId: 'bt-body',
        actionsHTML: '<span class="bt-count" id="bt-count"></span><button class="btn btn-xs" data-bt-empty>全部彻底删除</button>',
      });
      p.actions.querySelector('[data-bt-empty]').addEventListener('click', function () { empty(); });
    }
    BF.sheet.open('bf-trash', { render: render });
  }
  function toggle() {
    if (BF.sheet.closable('bf-trash')) { BF.sheet.close('bf-trash'); return false; }
    open(); return true;
  }
  return { all, list, count, find, moveTo, moveMany, restore, purge, empty, open, toggle, render };
})();
BF.app.continueRead = function () {
  const id = BF.store.lsGet(BF.store.K.LAST_BOOK, null);
  if (id) BF.app.openBook(id); else BF.noti.warn('暂无阅读记录');
};
BF.app.batchAction = function (act) {
  if (act === 'selectAll') {
    /* 全选只作用于「当前可见集」，与渲染共用 BF.library.shelfVisible：
       直接遍历 BOOKS_META 全表会在筛到 1 本时点全选得到 3 本，
       计数与亮圈不符，后续批量删除会带走当前看不见的书。 */
    const visible = BF.library.shelfVisible();
    const ids = visible.map(b => b.id);
    if (BF.appState.selectedBooks.size === ids.length && ids.every(function (i) { return BF.appState.selectedBooks.has(i); })) BF.appState.selectedBooks.clear();
    else ids.forEach(id => BF.appState.selectedBooks.add(id));
    BF.app.renderBookshelf();
  } else if (act === 'clear') {
    BF.appState.selectedBooks.clear(); BF.app.updateBatch(); BF.app.renderBookshelf();
  } else if (act === 'star') {
    if (!BF.appState.selectedBooks.size) return;
    /* R1：收敛进 mutate。selectedBooks **不在回调内读取** —— 它在回调外
       被清空（与「回调在 prev.then 内异步执行」组合会让回调恒读到空集合，
       批量收藏静默失效、零报错）。改为回调外先快照成 _sel 数组，
       回调内只遍历这份不再变化的快照。 */
    const _sel = [...BF.appState.selectedBooks];
    BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
      arr = arr || [];
      arr.forEach(b => { if (b && _sel.indexOf(b.id) >= 0) b.starred = !b.starred; });
      return arr;
    }).then(function (ok) {
      /* 清空与渲染一律放 mutate 完成之后，不塞进回调内 */
      BF.appState.selectedBooks.clear(); BF.app.renderBookshelf();
      if (ok === false) BF.log && BF.log.warn('批量收藏写入失败，书架数据可能未更新');
    });
  } else if (act === 'delete') {
    /* 确认内聚于 BF.app.deleteBooks（danger 2）。
       先 clear 再弹确认，用户取消后勾选已被清空 ——「取消」就成了有损操作。
       确认通过（或已删除）之后才清选择集。 */
    BF.app.deleteBooks([...BF.appState.selectedBooks]).then(function (_ok) {
      if (_ok !== false) { BF.appState.selectedBooks.clear(); BF.app.updateBatch(); }
      BF.app.renderBookshelf();
    });
  } else if (act === 'collect') {
    /* 放分组：不清选择集——刚放进去通常还想接着筛 / 接着批量做别的 */
    const _sel = [...BF.appState.selectedBooks];
    if (!_sel.length) { BF.noti.warn('先勾选要放哪组的书'); return; }
    BF.shelf.openPicker(_sel);
  } else if (act === 'gather') {
    const _sel = [...BF.appState.selectedBooks];
    if (!_sel.length) { BF.noti.warn('先勾选几本书，AI 才知道该按什么氛围聚会'); return; }
    if (BF.smart && BF.smart.aiGather) BF.smart.aiGather({ bookIds: _sel });
    else BF.noti.warn('AI 聚会不可用');
  } else if (act === 'tag') {
    BF.modal.prompt('批量标签', '输入标签（多个用空格分隔）：').then(function (val) {
      if (!val) return;
      const tags = val.trim().split(/\s+/);
      /* R1：同 star 分支 —— selectedBooks 在回调外快照成 _sel，
         回调内不读 selectedBooks（它在 mutate 完成后才被清空）。
         count 取快照 _sel.length（不读 selectedBooks），语义等价且确定。 */
      const _sel = [...BF.appState.selectedBooks];
      if (!_sel.length) return;
      const count = _sel.length;
      BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
        arr = arr || [];
        arr.forEach(b => {
          if (b && _sel.indexOf(b.id) >= 0) {
            b.tags = b.tags || [];
            tags.forEach(t => { if (!b.tags.includes(t)) b.tags.push(t); });
          }
        });
        return arr;
      }).then(function (ok) {
        /* 清选择 + 渲染 + 提示全部在 mutate 之后 */
        BF.appState.selectedBooks.clear(); BF.app.renderBookshelf();
        if (ok === false) { BF.log && BF.log.warn('批量标签写入失败，书架数据可能未更新'); BF.noti.warn('批量标签未保存：存储不可写或书已删除'); }
        else BF.noti.success('已为 ' + count + ' 本书设置标签');
      }).catch(function (e) {
        BF.err.report('books.batchTag', e);
        BF.noti.warn('批量标签未保存：' + ((e && e.message) || '未知错误'));
      });
    });
  } else if (act === 'download') {
    if (!BF.appState.selectedBooks.size) return;
    /* C29 修复：批量下载串行化。原 forEach 并发触发 N 个保存框且大书导出互相争抢；
       改为逐本导出，避免浏览器弹一堆对话框、也避免同屏 N 个下载同时跑。 */
    const _ids = [...BF.appState.selectedBooks];
    BF.appState.selectedBooks.clear(); BF.app.renderBookshelf();
    (async function () {
      for (const id of _ids) {
        try { await BF.library.downloadBook(id); } catch (e) { BF.err.report('batch.download:' + id, e); }
      }
    })();
  }
};

