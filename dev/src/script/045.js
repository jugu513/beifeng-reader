/* ===== 正文层字节级快照 / 复原 =====
   重建与重新分章两条写回通道共用这一份。快照 = 该书 CHAPTERS 的 IDB 原记录
   （content 已压缩、id/sid 原样）+ CHAPTER_TITLES 原记录 + meta 四个字段；
   复原 = 删当前章 → 原样放回，不经 __putChapters（它会再压缩一层并重发 id，
   标注 sid 映射会错乱）。
   「先删后写」中间那一截是这本书唯一不可逆的窗口：删完了写失败，
   meta 还写着 N 章、点开全是「读取失败」，而界面报「完成」——所以两条通道
   都必须在删之前拿到快照，写抛错就原样放回去。 */
BF.library.__snapChapters = async function (b) {
  /* 按 bk 索引只取这一本，全表 getAll 会把整库正文搬进栈 */
  const recs = await BF.store.idbIndexRecords(BF.store.K.CHAPTERS, 'bk', IDBKeyRange.only(String(b.id)), { strict: true }) || [];
  const titlesRec = await BF.store.idbGet(BF.store.K.CHAPTER_TITLES, b.id);
  let bytes = 0;
  recs.forEach(function (r) { const c = r && r.content; bytes += (c && (c.length || c.byteLength)) || 0; });
  /* 第三读层（OPFS 分批 / LS 兜底）不在 IDB 快照里。写回前会清掉第三层，
     所以先把「只在第三层」的章读出来补进快照 —— 否则删完就再也放不回去。
     读得到就补（压缩后入 recs），读不到就保持缺失，由调用方的覆盖率守卫拦下。
     这样混装书（前几章 IDB、中间批在 OPFS）也能被完整覆盖，不再靠探首末章猜。 */
  const _have = new Set();
  recs.forEach(function (r) {
    const m = String((r && r.id) || '').match(/_(\d+)$/);
    if (m) _have.add(Number(m[1]));
  });
  let _filled = 0;
  for (let i = 0; i < (b.totalChapters || 0); i++) {
    if (_have.has(i)) continue;
    let rr = null;
    try { rr = await BF.library.readChapter(b, i); } catch (e) { BF.err.report('snap.fill', e); }
    if (!rr || !rr.ok || !rr.text) continue;
    let content = null;
    try { content = await BF.lz.compress(rr.text); } catch (e) { BF.err.report('snap.fill.compress', e); continue; }
    recs.push({ id: b.id + '_' + i, bookId: b.id, idx: i, content: content });
    bytes += (content && content.length) || 0;
    _filled++;
  }
  if (_filled) BF.log.info('重新分章快照：从本地兜底层补入 ' + _filled + ' 章正文（原只存在 OPFS/本地存储）');
  return { bookId: b.id, recs: recs, titles: titlesRec || null, bytes: bytes, filled: _filled,
    mb: Math.round(bytes / 1048576 * 10) / 10,
    meta: { totalChapters: b.totalChapters || 0, wordCount: b.wordCount || 0,
      chapterWords: b.chapterWords || [], chapterBounds: b.chapterBounds || null } };
};
/* 撤销预算：整本正文驻留在撤销栈里，代价大于收益。>8MB 就不登记并如实写明——
   诚实告知胜过悄悄失败。快照取不到（IDB 异常）同样降级为无撤销。 */
BF.library.__snapUndoable = function (snap) { return !!snap && snap.bytes <= 8 * 1048576; };
BF.library.__restoreChapters = async function (snap) {
  const id = snap.bookId;
  /* 复原也走 strict：读不到当前章节就当没有旧章，会把同一本书留下两套章号 */
  const toDel = await BF.store.idbIndexKeys(BF.store.K.CHAPTERS, 'bk', IDBKeyRange.only(String(id)), { strict: true }) || [];
  for (const cid of toDel) { try { await BF.store.idbDelete(BF.store.K.CHAPTERS, cid); } catch (e) { BF.err.report('snap.restore.del', e); } }
  if (snap.recs.length) await BF.store.idbPutAll(BF.store.K.CHAPTERS, snap.recs);
  if (snap.titles) await BF.store.idbPutAll(BF.store.K.CHAPTER_TITLES, [snap.titles]);
  else { try { await BF.store.idbDelete(BF.store.K.CHAPTER_TITLES, id); } catch (e) { BF.err.report('snap.restore.titles', e); } }
  await BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
    const _b = (arr || []).find(function (x) { return x && x.id === id; });
    if (!_b) return false;
    _b.totalChapters = snap.meta.totalChapters;
    _b.wordCount = snap.meta.wordCount;
    _b.chapterWords = snap.meta.chapterWords;
    _b.chapterBounds = snap.meta.chapterBounds;
    return arr;
  });
  try { if (BF.reader && BF.reader.clearPrefetch) BF.reader.clearPrefetch(); } catch (e) {}
};
/* 写回第三层之前必须把它一起清干净：清旧章的循环只管 IDB，
   留下的旧键/旧分批就是下一次读取时的陈旧正文来源。按 max(旧章数, 新章数) 清，
   章数变少时旧尾键同样不能留。 */
BF.library.__dropBodyLayers = async function (bookId, oldCount, newCount) {
  try { await BF.library._dropOpfsBook(bookId); } catch (e) { BF.log.warn('清理 OPFS 分批正文失败：' + (e && e.message)); }
  const n = Math.max(oldCount || 0, newCount || 0);
  for (let i = 0; i < n; i++) { try { BF.store.lsRemove('chap_' + bookId + '_' + i); } catch (e) { BF.err.report('dropBodyLs', e); } }
};
/* 手动微调·重建并落盘：按给定 bounds（或自动 / 已存储的 chapterBounds）
   重新切片全书，应用改名（按 sid 的 chapterRenames），写回 IDB 与 meta。
   零丢失保证：重建的全文 = 各章 content 拼接（content 即偏移切片，拼接必还原原文），
   再按 bounds 切片——只是重新界定边界，绝不增删字符。 */
BF.library.rebuildBookChapters = async function (bookId, opts) {
  opts = opts || {};
  const b = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (x) { return x && x.id === bookId; });
  if (!b) return null;
  /* 图片书（CBZ）没有文本正文：任何按文本重切的写回通道（手动重分 / 手动合并拆分 /
     AI 分章）都会把它压成一本单章空书，而删旧章那一截不可逆。
     三条路都收口在本函数，拦一道就够。 */
  if (b.img) {
    try { BF.noti.error('《' + b.title + '》是图片书（CBZ），没有可重排的文本正文'); } catch (e) {}
    return null;
  }
  /* 1. 重建全书正文（除非调用方已提供清洗后的全文，省去一次全量读取）
     本函数会把结果写回章节表，所以走 strict：读不到就抛出，
     不能让缺的章节以空串参与切片——那会把这本书永久重写成少了那几章的样子。 */
  let cleaned;
  if (opts.full != null) cleaned = opts.full;
  else cleaned = await BF.library.rebuildCleanedText(b, { strict: true });
  /* 2. 确定边界：显式 bounds > 已存储 chapterBounds > 自动 */
  const autoBounds = function () {
    const sopts = {
      strategy: BF.settings.get('chapterStrategy') || 'smart',
      chapterRegex: BF.settings.get('chapterRegex') || '',
      chapterWordCount: BF.settings.get('chapterWordCount') || BF.settings.DEFAULTS.chapterWordCount,
      autoDetectTitle: BF.settings.get('autoDetectTitle') !== false,
      mergeTocBlock: BF.settings.get('mergeTocBlock') !== false,
    };
    const bs = BF.library._splitBounds(cleaned, sopts);
    _warnRegexRisk(sopts);   /* 自定义正则被回溯防护拒绝时明示一次 */
    return bs;
  };
  let bounds, boundsStored = false;
  if (opts.bounds && opts.bounds.length >= 2) bounds = opts.bounds;
  else if (b.chapterBounds && b.chapterBounds.length >= 2) { bounds = b.chapterBounds; boundsStored = true; }
  else bounds = autoBounds();
  if (!BF.library._boundsIntegral(cleaned, bounds)) {
    /* 已存边界与这份正文对不上 ⇒ 正文被改过而边界是旧的（重新分章改章数就不刷新
       chapterBounds，下一次改名走的正是这条重建路）。此时塌成整本单章等于把这本书
       压平且无声——所以先按现行规则重算，只有重算也不闭合才退回单章，且必须出声。 */
    boundsStored = false;
    bounds = autoBounds();
    if (!BF.library._boundsIntegral(cleaned, bounds)) {
      BF.log.warn('L-2 重建偏移不闭合，回退整本单章以避免内容丢失');
      bounds = [0, cleaned.length];
    } else {
      BF.noti.warn('旧的章节边界与当前正文对不上（正文改过或重新分过章），已按现行分章规则重切');
    }
  }
  const adetect = BF.settings.get('autoDetectTitle') !== false;
  const chapters = BF.library._buildChapters(cleaned, bounds, { autoDetectTitle: adetect });
  BF.library.__ensureSid(chapters);   /* 手动重建同样要 sid/卷章层级，否则标注重映射失效 */
  /* 3. 应用改名（按 sid；改名键用实际 sid，含卷章层级与 sid 去重复合键） */
  const renames = Object.assign({}, b.chapterRenames || {}, opts.renames || {});
  if (Object.keys(renames).length) {
    chapters.forEach(function (c) { if (c.sid != null && renames[c.sid] != null) c.title = renames[c.sid]; });
  }
  /* 4. 落盘：先取字节级快照，再清旧章节、清第三层、写新章节。
     「删了才写」中间那一截是这本书唯一不可逆的窗口：写完抛错而旧字节已没，
     meta 仍写着 N 章、点开全是「读取失败」，界面还报完成。所以写失败必须原样放回。
     旧章节按 bk 索引只取这本书的键名（全表 getAll 会把整库正文搬进来，
     重切一本书不该付全库的代价）。读不到就直接抛出（strict）——
     把它当「没有旧章节」会留下孤儿记录。 */
  let _snap = null;
  try { _snap = await BF.library.__snapChapters(b); } catch (e) { BF.err.report('rebuild.snapshot', e); }
  /* 快照取不到（IDB 被占用 / 隐私模式 / 存储抖动 —— 恰是最容易出问题的时刻）
     绝不能带着 null 往下走：下面会先删旧章再清第三层，null 会让「少一章就取消」的
     守卫被短路，用户点「重新分章」就永久丢整本正文。与「少一章就取消」同档 fail-closed。 */
  if (!_snap) {
    const _e = new Error('分章前取快照失败，已取消操作（正文未被改动）：可先从运维台导出备份，关闭其他标签页后重试');
    _e.userMessage = _e.message;
    throw _e;
  }
  /* 快照只覆盖 IDB + 能从第三层补读到的章。补读后仍缺章（正文确实读不到），
     删掉第三层就无法原样回滚——宁可取消，也不能报「没有被改动」实则少章。 */
  if (_snap && _snap.recs.length < (b.totalChapters || 0)) {
    const _miss = (b.totalChapters || 0) - _snap.recs.length;
    const _err = new Error('这本书有 ' + _miss + ' 章正文读不到，无法保证可回滚，已取消分章更新（正文未被改动）。可先从运维台导出备份，重新导入后再分章');
    _err.userMessage = _err.message;
    throw _err;
  }
  const toDel = await BF.store.idbIndexKeys(BF.store.K.CHAPTERS, 'bk', IDBKeyRange.only(String(bookId)), { strict: true });
  for (const cid of toDel) { try { await BF.store.idbDelete(BF.store.K.CHAPTERS, cid); } catch (e) { BF.err.report('rebuild.clearOldChapters', e); } }
  /* 旧卷次的 OPFS 分批与 localStorage 兜底键一起清：新章节若某批写失败，第三读层会把
     上一卷的正文当成本章读回来——章数对得上、字是旧的，这种错界面看不出来。 */
  await BF.library.__dropBodyLayers(bookId, b.totalChapters || 0, chapters.length);
  let _putRc;
  try {
    _putRc = await BF.library.__putChapters(bookId, chapters);
  } catch (e) {
    if (_snap) {
      try {
        await BF.library.__restoreChapters(_snap);
        BF.noti.error('重建未生效，已按快照放回原章节（这本书没有被改动）：' + ((e && e.message) || e));
      } catch (e2) {
        BF.err.report('rebuild.rollback', e2);
        BF.noti.error('重建失败且回滚也失败：' + ((e && e.message) || e) + '。这本书的正文可能已不完整，请先从备份恢复',
          { action: { label: '查看运维台', run: function () { try { if (BF.workbench && BF.workbench.open) BF.workbench.open('data'); } catch (e3) { BF.err.report('rebuild.toLog', e3); } } } });
      }
    } else {
      BF.err.report('rebuild.noSnap', e);
      BF.noti.error('重建失败且没有可用快照：' + ((e && e.message) || e) + '。旧章节已清，请从备份恢复或重新导入这本书');
    }
    throw e;
  }
  /* 部分批次失败（三层选层后仍败）不上抛，但必须出声：缺章打开就是「读取失败」，
     与「重新分章完成」的默认口径矛盾。 */
  if (_putRc && _putRc.failed > 0) {
    BF.noti.warn('重新分章部分完成：已存 ' + _putRc.written + ' 章、失败 ' + _putRc.failed + ' 章（缺章打开会显示读取失败，可释放空间后重试）');
  }
  /* 5. 回写 meta：总章数 / 字数 / 每章字数 / 手动边界 / 改名表 */
  const newRenames = Object.keys(renames).length ? renames : (b.chapterRenames || null);
  const _okMeta = await BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
    arr = arr || [];
    const _b = arr.find(function (x) { return x && x.id === bookId; });
    if (!_b) return false;
    _b.totalChapters = chapters.length;
    _b.wordCount = chapters.reduce(function (s, c) { return s + (c.content || '').length; }, 0);
    _b.chapterWords = chapters.map(function (c) { return (c.content || '').length; });
    if (opts.bounds) _b.chapterBounds = bounds.slice();   /* 写本次实际使用的边界，不是调用方那份（不闭合时已被重算替换） */
    /* 这次不是按已存边界切的（自动 / 旧边界不闭合已重算）⇒ 旧值必须清掉，
       留着它下一次重建又会拿不闭合的边界去切同一份正文 */
    else if (!boundsStored) _b.chapterBounds = null;
    if (opts.bounds || opts.renames) _b.chapterRenames = newRenames;   /* 改名（无边界变更）也要持久化 */
    if (opts.clearBounds) { _b.chapterBounds = null; _b.chapterRenames = null; }
    return arr;
  });
  /* 目录信息（总章数 / 字数 / 进度口径）写失败必须出声：正文已按新章数入库，
     若 meta 仍是旧值，目录条数、进度百分比、字数统计全部错位，而界面默认报完成。
     这里不直接回滚章节（章节已落盘、回滚代价高），降级为「部分完成」提示。 */
  if (_okMeta === false) {
    BF.noti.warn('重新分章：正文已更新，但目录信息写回失败（章数 / 字数可能未同步），可释放空间后重试或重新导入');
  }
  return chapters;
};

