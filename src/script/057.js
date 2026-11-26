/* ================= L10. 剪贴板导入 ================= */
BF.library.importClipboard = async function () {
  try {
    if (!navigator.clipboard || !navigator.clipboard.readText) {
      BF.noti.warn('当前环境不支持剪贴板读取');
      return;
    }
    const text = await navigator.clipboard.readText();
    if (!text || !text.trim()) { BF.noti.warn('剪贴板为空'); return; }
    if (text.length < 100) { BF.noti.warn('剪贴板内容过短，可能不是书籍'); return; }
    /* 以正文首行作书名（更易辨认），重复粘贴同一内容时首行相同 → 可去重 */
    const name = (text.split('\n').find(function (l) { return l.trim(); }) || '').trim().slice(0, 40)
      || ('剪贴板_' + new Date().toLocaleDateString('zh-CN').replace(/\//g, '') + '_' + Math.floor(Math.random() * 1000));
    /* 判重在分章之前：书名与体积此刻都已可用，重复粘贴不该白跑一遍最贵的分章。
       legacyChars：升级前剪贴板书 size 存的是字符数，用字符数再比一次才能认出旧书。 */
    const _bytes = BF.util.byteLen(text);
    if (BF.library.isDuplicate(name, _bytes, { legacyChars: text.length })) {
      BF.noti.warn('已存在《' + name + '》，跳过重复导入');
      return;
    }
    const chapters = BF.library.splitChapters(text);
    const id = BF.library.newBookId();
    const book = {
      id, title: name, size: _bytes, importedAt: Date.now(),
      totalChapters: chapters.length, currentChapter: 0, lastRead: null,
      starred: false, tags: [], enc: '', src: 'clipboard',
      wordCount: chapters.reduce((s, c) => s + (c.content || '').length, 0),
      chapterWords: chapters.map(c => (c.content || '').length),  /* 每章字数 */
    };
    let _bodyFailed = false;
    try {
      var _putRc = await BF.library.__putChapters(id, chapters);
    } catch (e) {
      BF.err.report('import.idb', e);
      book._lsFallback = true;
      /* 与文件通道同判据：IDB 与本地兜底双双失败 ⇒ 正文一条都没落进去，
         不能再上架一本「N 章、点开全空」的幽灵书。 */
      if (!BF.library.__lsFallback(id, chapters)) _bodyFailed = true;
      else BF.noti.warn('IndexedDB 不可用，已回退本地存储');
    }
    /* 部分批次失败（腾退续写后仍败）：回执口径出声，不上抛（同文件通道） */
    if (!_bodyFailed && _putRc && _putRc.failed > 0) {
      BF.noti.warn('《' + BF.dom.esc(name) + '》已存 ' + _putRc.written + ' 章、失败 ' + _putRc.failed + ' 章（缺章打开会显示读取失败，可释放空间后重新导入续写）');
    }
    if (_bodyFailed) {
      for (let _bi = 0; _bi < (book.totalChapters || 0); _bi++) {
        try { await BF.store.idbDelete(BF.store.K.CHAPTERS, id + '_' + _bi); } catch (e) { BF.err.report('import.bodyfail.chapter', e); }
        try { BF.store.lsRemove('chap_' + id + '_' + _bi); } catch (e) { BF.err.report('import.bodyfail.ls', e); }
      }
      try { await BF.store.idbDelete(BF.store.K.CHAPTER_TITLES, id); } catch (e) { BF.err.report('import.bodyfail.titles', e); }
      BF.noti.error('《' + BF.dom.esc(name) + '》正文写入失败（存储不可用或空间不足），本书未加入书架。可释放空间后重试。',
        { action: { label: '查看运维台', run: function () { try { if (BF.workbench && BF.workbench.open) BF.workbench.open('data'); } catch (e) { BF.err.report('import.bodyfail.toLog', e); } } } });
      return;
    }
    /* 写库走 mutate 串行通道。回调内只 push 入参 book。 */
    const _pushed = await BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
      arr = arr || [];
      arr.push(book);
      return arr;
    });
    /* meta 写失败回滚：与 importFile 同一路径（逐条 idbDelete + 逐条 try/catch）。
       剪贴板通道必须有回滚：meta 写失败否则会留下不可见的孤儿章节（书未进 BOOKS_META，
       永远不会被删书级联清理），IDB 只增不减。 */
    if (_pushed === false) {
      for (let _i = 0; _i < (book.totalChapters || 0); _i++) {
        try { await BF.store.idbDelete(BF.store.K.CHAPTERS, id + '_' + _i); } catch (e) { BF.err.report('import.rollback.chapter', e); }
        /* LS 兜底层的 chap_ 键也要收：chapters 落到 LS 层时正文在这里，
           不清就成永久孤儿（meta 写失败⇒书未上架⇒删书级联和 repairOrphans 都收不到）。
           lsRemove 不存在的键是空操作，无条件调用安全。 */
        try { BF.store.lsRemove('chap_' + id + '_' + _i); } catch (e) { BF.err.report('import.rollback.ls', e); }
      }
      try { await BF.store.idbDelete(BF.store.K.CHAPTER_TITLES, id); } catch (e) { BF.err.report('import.rollback.titles', e); }
      /* 回滚必须连第三层一起收：IDB 失败批写进的 OPFS 分批不在孤儿清单里，谁也收不走 */
      try { await BF.library._dropOpfsBook(id); } catch (e) { BF.log.warn('导入回滚时清理 OPFS 失败：' + (e && e.message)); }
      throw new Error('存储空间不足，本书未加入书架');
    }
    try { BF.bus.emit(BF.EVENTS.BOOKSHELF, book.id); } catch (e) {}
    BF.app.renderBookshelf(); BF.app.renderHome();
    BF.noti.success('剪贴板导入成功：' + chapters.length + ' 章',
      (BF.next && BF.next.afterImport) ? BF.next.afterImport(book.id) : undefined);
  } catch (e) {
    BF.err.report('importClipboard', e);
    /* 如实报原因：空间不足被改写成「剪贴板中需是纯文本」，会让人去改剪贴板而真因是存储 */
    var _cm = (e && e.message) ? ('剪贴板导入失败：' + e.message) : '剪贴板导入失败：剪贴板中需是纯文本';
    if (BF.feedback) BF.feedback.error(_cm, { next: { label: '重试', run: function () { BF.library.importClipboard(); } } }); else if (BF.noti) { var _nfE = BF.noti.error || BF.noti.warn; if (_nfE) _nfE.call(BF.noti, _cm); }
  }
};

