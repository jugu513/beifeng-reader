/* ================= 本书回顾卡（C4/FS-6）：末章读完的成果物 =================
   回顾卡是浮层（BF.sheet 压栈、Esc 可关），由章末卡
   「回顾本书」按钮主动展开——不自动弹出、不阻断阅读。
   卡上每个数字必须来自数据层确认值，
   无确认值不估算、不硬编码：
   - 时长：BF.stats.bookMin（BOOK_TIME 按书累计秒→分钟）
   - 划线/书签/生词/便签：对应存储键按 bookId 过滤计数
   - 阅读天数：本书「有记录的活动日」去重——四类标注
     创建日 ∪ 末次阅读日（BOOK_TIME/DAILY 均无「书×日」
     二维记录，留了标注或阅读进度落盘的日子是可确认的
     阅读日；无任何记录的日子不可确认，不计入）
   - 首次阅读：books_meta.importedAt（入库＝首次接触本书）
   - 最后阅读：READING_STATE 轻量键优先（保存频率高、
     值新），books_meta.lastRead 兜底——与
     BF.library.mergeReadingState 同口径
   - 章节数/字数：books_meta 结构字段 */
BF.reader.reviewCardData = function (bookId) {
  const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || [];
  const b = books.find(function (x) { return x && x.id === bookId; });
  if (!b) return null;
  const K = BF.store.K;
  const byBook = function (arr) {
    return (arr || []).filter(function (x) { return x && x.bookId === bookId; });
  };
  const hls = byBook(BF.store.lsGet(K.HIGHLIGHTS, []));
  const bms = byBook(BF.store.lsGet(K.BOOKMARKS, []));
  const vocs = byBook(BF.store.lsGet(K.VOCAB, []));
  const notes = byBook(BF.store.lsGet(K.NOTES, []));
  /* 活动日去重：本地日期键（年月日），同日多次活动计一天 */
  const days = {};
  const dayOf = function (ts) {
    if (typeof ts !== 'number' || !ts) return;
    const d = new Date(ts);
    days[d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate()] = 1;
  };
  [hls, bms, vocs, notes].forEach(function (list) {
    list.forEach(function (x) { dayOf(x.created || x.createdAt); });
  });
  const rs = BF.store.lsGet(K.READING_STATE, {}) || {};
  const rst = rs[bookId] || {};
  const lastRead = (typeof rst.lastRead === 'number')
    ? rst.lastRead
    : (typeof b.lastRead === 'number' ? b.lastRead : null);
  dayOf(lastRead);
  return {
    title: b.title,
    days: Object.keys(days).length,
    minutes: (BF.stats && typeof BF.stats.bookMin === 'function') ? BF.stats.bookMin(bookId) : 0,
    hl: hls.length, bm: bms.length, vocab: vocs.length, notes: notes.length,
    firstRead: (typeof b.importedAt === 'number') ? b.importedAt : null,
    lastRead: lastRead,
    chapters: (typeof b.totalChapters === 'number') ? b.totalChapters : 0,
    words: (typeof b.wordCount === 'number') ? b.wordCount : 0,
  };
};
/* 回顾卡浮层：统计网格 + 两个出口
   （「回顾我的标注」跳抽屉标注中心；「导出本书笔记」
   与 book.notesExport 命令同一实现） */
BF.reader.showReviewCard = function () {
  const bid = BF.appState.currentBookId;
  if (!bid) { BF.noti.warn('请先打开一本书'); return; }
  const d = BF.reader.reviewCardData(bid);
  if (!d) { BF.noti.warn('书籍不存在'); return; }
  let el = document.getElementById('book-review-card');
  if (!el) {
    /* 骨架统一由 BF._panel 工厂生成；
       close 按钮带 data-panel-close 走文档级委托。 */
    BF._panel('book-review-card', '本书回顾', {
      cls: 'dlg-shell', cssText: '--dlg-w:min(560px,94vw)',   /* 本书回顾：窄栏 */
      bodyId: 'book-review-body',
      bodyCss: 'padding:12px 16px;overflow-y:auto;min-height:0',
    });
  }
  function stat(label, value) {
    return '<div style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--bg-input)">' +
      '<div style="font-size:11px;color:var(--text-weak)">' + label + '</div>' +
      '<div style="font-size:14px;color:var(--text);margin-top:2px">' + value + '</div></div>';
  }
  const fmtDT = function (ts) { return ts ? new Date(ts).toLocaleString('zh-CN') : '—'; };
  const fmtMin = function (m) {
    return m >= 60 ? Math.floor(m / 60) + ' 小时 ' + (m % 60) + ' 分钟' : m + ' 分钟';
  };
  const body = document.getElementById('book-review-body');
  body.innerHTML =
    '<div style="text-align:center;padding:2px 0 10px">' +
      '<div style="font-size:17px;font-weight:700;color:var(--text)">《' + BF.dom.esc(d.title) + '》</div>' +
      '<div style="font-size:11px;color:var(--text-weak)">全书读完 · 数字全部来自数据层确认值</div>' +
    '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;font-size:13px">' +
      stat('阅读天数', d.days + ' 天') +
      stat('阅读时长', fmtMin(d.minutes)) +
      stat('划线', d.hl + ' 条') +
      stat('书签', d.bm + ' 个') +
      stat('生词', d.vocab + ' 条') +
      stat('便签', d.notes + ' 条') +
      stat('首次阅读', fmtDT(d.firstRead)) +
      stat('最后阅读', fmtDT(d.lastRead)) +
      stat('章节数', d.chapters + ' 章') +
      stat('字数', BF.util.fmtNum(d.words) + ' 字') +
    '</div>' +
    '<div style="font-size:11px;color:var(--text-weak);margin-top:8px">阅读天数按本书有标注/阅读记录的日子统计（无记录的日子不计入）</div>' +
    '<div style="display:flex;gap:8px;justify-content:center;margin-top:12px">' +
      '<button class="btn btn-sm" data-rc-marks>回顾我的标注</button>' +
      '<button class="btn btn-sm primary" data-rc-export>导出本书笔记</button>' +
    '</div>';
  body.querySelector('[data-rc-marks]').onclick = function () {
    BF.sheet.close('book-review-card');
    /* 回顾我的标注：开抽屉并切标注中心 tab（marks） */
    BF.reader.openDrawer('marks');
  };
  body.querySelector('[data-rc-export]').onclick = function () {
    /* 导出本书笔记：与 book.notesExport 命令同一实现（BF.enh.v4 顶层无条件赋值，恒可调用） */
    if (BF.enh && BF.enh.v4 && typeof BF.enh.v4.exportNotes === 'function') BF.enh.v4.exportNotes();
  };
  BF.sheet.open('book-review-card');
};
BF.reader.saveProgress = async function (force) {
  const b = BF.reader.state.book;
  if (!b) return;
  /* 阅读进度走轻量键 bf_reading_state（书级），不再每 20s 全量重写 books_meta。
     结构性字段（totalChapters 等）仍留在 books_meta，进度归进度、结构归结构。
     books_meta 仅保留当前章+最后阅读时间的写回（离开阅读页/关标签时才写，频率极低）。 */
  /* READING_STATE 走 mutate 串行写，消除「读→改→写」竞态。
     回调在 prev.then 内异步执行，故回调内只允许读入参与回调外先算好的局部量：
     _curCh 提前快照（emit 也不得读会变的 b.currentChapter）；
     b 是本函数已捕获的局部引用，回调执行时 b.id 不会变。
     rs 由 mutate 传入最新值，回调内直接写 rs[b.id]，不在回调外先算好再传入。 */
  const _curCh = BF.appState.currentChapterIdx;
  /* 滚动读数必须取在任何 await 之前。下面那次 mutate 是 await，而 BF.app.go 调
     saveProgress 并不 await 它 —— 于是「存滚动」这段实际跑在微任务里，
     那时阅读页已经被 hidden，读到的 scrollTop 恒为 0：章内位置被写零，
     还会顺手把稳定判据的基线也污染成 0。隐藏态直接不取（null），取到才存。 */
  const _fracNow = BF.reader._currentFrac();
  /* 章内滚动位置同样要在 await 之前自取：_currentFrac 只给分数、不给原始 scrollTop，
     隐藏态（offsetParent === null）取 null，沿用 _currentFrac 同一判据。 */
  const _wrapNow = document.getElementById('reader-wrap');
  const _scrollNow = (_wrapNow && _wrapNow.offsetParent !== null) ? _wrapNow.scrollTop : null;
  let _payload = null;
  try {
    const _ok = await BF.store.mutate(BF.store.K.READING_STATE, function (rs) {
      rs = rs || {};
      const _prev = rs[b.id] || {};
      /* 换章了但没取到滚动：旧分数属于上一章，不能搬过来 */
      const _frac = (_fracNow !== null) ? _fracNow
        : ((_prev.currentChapter === _curCh && typeof _prev.chapterFrac === 'number') ? _prev.chapterFrac : 0);
      rs[b.id] = { currentChapter: _curCh, lastRead: Date.now(), chapterFrac: _frac };
      _payload = rs;
      return rs;
    });
    /* C28 修复：进度写失败不静默。配额满等场景下进度丢失是数据问题，
       必须让用户在顶栏看到常驻失败状态（通知会 3.5s 消失，顶栏不消失）。
       mutate 返回 false = 写入失败或回调放弃，视为关键数据写失败。 */
    if (_ok === false) {
      try { BF.store.setCritical(BF.store.K.READING_STATE, _payload || {}, '阅读进度'); } catch (e) { BF.err.report('progress.fallbackWrite', e); }
      try { if (BF.topStatus && BF.topStatus.setSaveFail) BF.topStatus.setSaveFail(true); } catch (e) {}
    }
  } catch (e) {
    try { BF.err.report('reader.saveProgress', e); } catch (e2) {}
    try { if (BF.topStatus && BF.topStatus.setSaveFail) BF.topStatus.setSaveFail(true); } catch (e2) {}
  }
  /* 事件总线扩面：阅读进度/状态变更广播，供多标签同步与 AI 上下文刷新订阅 */
  try { if (BF.bus) { BF.bus.emit(BF.EVENTS.PROGRESS, { bookId: b.id, chapter: _curCh }); BF.bus.emit(BF.EVENTS.READING_STATE, { bookId: b.id }); } } catch (e) {}
  if (!BF.reader.pageModeActive()) {
    /* 滚动位置要稳定后再存。滚动中途 scrollTop 是中间态（半屏位置），
       必须连续稳定才落盘：这里比较与上次保存值，变化 <1px 视为稳定；
       仍在滚动则跳过当次（下次定时/退出时再存，避免写中间态）。 */
    if (_scrollNow !== null) {
      const st = _scrollNow;
      /* force=true（beforeunload/离开阅读页）时无条件存；否则稳定才存 */
      if (force || (typeof BF.reader.__lastSavedScroll === 'number' && Math.abs(st - BF.reader.__lastSavedScroll) < 1)) {
        /* 写没写进去要出得了声：配额拦截与存储异常都只表现为「下次进来位置不对」，
           静默失败等于把这条留给用户猜。 */
        if (BF.store.lsSet(BF.store.K.SCROLL_ + b.id, st) !== true) BF.log.warn('阅读位置未写入（配额拦截或存储异常）：' + b.title);
      }
      BF.reader.__lastSavedScroll = st;
    }
  }
};
/* 把内存进度同步回 books_meta（离开阅读页 / beforeunload / 删书前调用，频率低）。
   兼容旧数据：若 books_meta 里已有 currentChapter/lastRead，则以此为准合并。 */
BF.reader.syncProgressToMeta = function () {
  const b = BF.reader.state.book;
  if (!b) return;
  /* 读改写必须收敛进 mutate：若 lsGet 取整数组 → 闭包外改 → setCritical
     整条写回，会与 toggleStar 等同型竞争——阅读中并发导入/收藏/删除
     把陈旧 books 快照整条覆盖。用「读最新值 → 回调 → 写回」，
      READING_STATE 的读取也放进回调内（取同一时刻的最新进度）。 */
  /* 返回 mutate 承诺：调用方（页面卸载兜底等）可按需等待落盘；
      同步调用点不等待也可（本就 fire-and-forget）。 */
  return BF.store.mutate(BF.store.K.BOOKS_META, function (books) {
    const i = (books || []).findIndex(x => x && x.id === b.id);
    if (i < 0) return false;
    const rs = BF.store.lsGet(BF.store.K.READING_STATE, {}) || {};
    const st = rs[b.id] || {};
    if (typeof st.currentChapter === 'number') books[i].currentChapter = st.currentChapter;
    if (typeof st.lastRead === 'number') books[i].lastRead = st.lastRead;
    /* 章内分数不再镜像进 books_meta：进度只有一个源（READING_STATE），
       镜像一份就会出现「卡面读旧值、真值已更新」的两套数（书架显示 48% 而真值 8.6% 就是这么来的）。 */
    books[i].currentChapter = books[i].currentChapter || 0;
    return books;
  }, '阅读进度');
};
