/* ===== L1. 读取章节文本 ===== */
BF.library.getChapterText = async function (book, idx) {
  try {
    /* 命中章节预取缓存（LRU，最多 9 章）：省去一次 IDB 读 + gzip 解压 */
    const _pk = book.id + '_' + idx;
    if (BF.reader && BF.reader.__prefetched && BF.reader.__prefetched[_pk] != null) {
      /* 命中时刷新访问序（真 LRU：最近访问的移到队尾，淘汰最久未访问）。
         命中不刷新就退化成 FIFO，冷门章会长期占缓存。 */
      if (BF.reader.__prefetchTouch) BF.reader.__prefetchTouch(_pk);
      return BF.reader.__prefetched[_pk];
    }
    const item = await BF.store.idbGet(BF.store.K.CHAPTERS, book.id + '_' + idx);
    if (item) {
      if (item.content == null) {
        /* content 缺失（旧数据/异常写入）不得静默返回空串——整章会显示空白，
           且无日志区分「章节不存在」与「章节存在但正文缺失」，必须留痕。 */
        BF.log && BF.log.warn('章节正文缺失 content 字段：' + _pk + '（旧格式或写入异常），尝试本地兜底');
      } else {
        /* 解压失败同样要下探：直接返回空串等于把「这一章坏了」显示成「这一章没字」 */
        const _dz = await BF.lz.decompressSafe(item.content);
        if (_dz.ok) return _dz.text;
        BF.log && BF.log.warn('章节正文解压失败：' + _pk + '，尝试本地兜底');
      }
    }
  } catch (e) { BF.err.report('getChapter.idb', e); }
  const ls = BF.store.lsGet('chap_' + book.id + '_' + idx, null);
  if (!ls) {
    /* 第三读层：OPFS 分批正文（写侧见 __putChapters.putBatchLayers），实现单源 _readOpfsChapter */
    const _op = await BF.library._readOpfsChapter(book.id, idx);
    if (_op && _op.text) return _op.text;
    BF.log && BF.log.warn('章节文本读取为空：' + book.id + '_' + idx + '（IDB 无记录且无本地兜底）');
  }
  return ls || '';
};
/* 导出用的正文：分章产物本身就以章标题行开头（`第1章 风起\n\n正文…`），
   导出时再拼一次标题就成了每章两遍；用户「导出 → 再导入」时重复会永久留在正文里
   （再分章只吃得到一层）。这里把要打印的那一行标题从正文开头剥掉，两处导出口共用本函数。 */
/* 导出用的正文：返回 { ok, text }。ok=false 表示这一章没读到（三层读路都空），
   调用方必须把它算进「缺章」并在回执里说出来——导出成一本只有章名的空书还报成功，
   等于把数据事故包装成正常结果。 */
BF.library.exportChapterText = async function (b, idx, title) {
  const r = await BF.library.readChapter(b, idx);
  if (!r.ok) return { ok: false, text: '' };
  const s = String(r.text || '');
  const nl = s.indexOf('\n');
  const head = nl < 0 ? s : s.slice(0, nl);
  const _t = String(title || '');
  /* 认两种：① 首行就是当前标题（改名后仍一致）；② 首行是章题样式（第N章 / 序章 / 楔子…）
     —— 改名过的书正文里留的还是导入时那一行，不认它就会重复打印。 */
  const _headT = head.trim();
  /* 非「第N章」的章题只认短行且不带句读（序章/楔子/前言…）：
     正文段落以「前言中作者提到…」开头时不能被当标题吃掉。 */
  const _isDefault = /^第\s*[0-9〇零一二三四五六七八九十百千两]+\s*章/.test(_headT)
    || (_headT.length <= 12 && !/[。！？；，、：,.!?;:]/.test(_headT) && /^(序章|楔子|引子|前言|序言|后记|尾声|终章|番外)/.test(_headT));
  if ((_t && head.indexOf(_t) === 0) || _isDefault) return { ok: true, text: (nl < 0 ? '' : s.slice(nl + 1)).replace(/^[ \t]+/, '') };
  return { ok: true, text: s };
};
/* getChapterMeta：返回 [{ title, sid }]，供标注重映射用。
     **独立读一次存储，不复用（更不存在）任何 sid 缓存。**
     理由：任何「读 titles 时顺手存的」sid 缓存，在书重新分章后
     CHAPTER_TITLES 被 __putChapters 覆写，缓存里仍是**改前陈旧**的 sid ——
     谁先读谁拿到过期数据，且过期与否取决于调用顺序，极难排查。重新分章后
     读到陈旧 sid 会让整套重映射算错，属静默错误。故这里每次都读真源，
     多一次 IDB 读取的成本可以忽略，换来的是「永远拿到当前真实值」。
     归一化方式与 getChapterTitles 相同（兼容旧格式字符串数组）。 */
BF.library.getChapterMeta = async function (bookId) {
  try {
    const item = await BF.store.idbGet(BF.store.K.CHAPTER_TITLES, bookId);
    if (item && Array.isArray(item.titles)) {
      return item.titles.map(function (x) {
        if (x && typeof x === 'object' && !Array.isArray(x)) {
          return { title: x.title == null ? '' : String(x.title), sid: x.sid == null ? '' : String(x.sid) };
        }
        return { title: x == null ? '' : String(x), sid: '' };   /* 旧数据无 sid */
      });
    }
  } catch (e) { BF.err.report('getChapterMeta.idb', e); }
  return [];
};
/* getSidIndex：{ sid → chapterIdx }。
     **无 sid 的旧章不进映射**（sid 为空串一律跳过）—— 空串不是合法 sid，
     放进去会让「所有无 sid 的章」挤在 key '' 上互相覆盖，后续重映射
     会把标注错配到最后一章。查不到映射时应视为「无法重映射」，
     退化为按章号处理并明确提示用户，而不是猜。 */
BF.library.getSidIndex = async function (bookId) {
  const meta = await BF.library.getChapterMeta(bookId);
  const idx = {};
  meta.forEach(function (m, i) {
    if (m && m.sid) { if (!(m.sid in idx)) idx[m.sid] = i; }   /* 同 sid（内容重复章）取首个 */
  });
  return idx;
};

BF.library.getChapterTitles = async function (bookId) {
  /* 归一化。
     titles 表条目是「[{title, sid}]」（写入方见 __putChapters），
     而本函数的消费点（渲染目录、导出、AI 取章节名等）全都按字符串数组用。
     **返回类型必须
     仍是字符串数组**，否则各消费点会一起拿到对象、目录直接渲染出 [object Object]。
     故在此处把新格式归一化回字符串数组，让消费点零感知；旧数据本身就是字符串
     数组，原样返回即可。
     读到的 sid 由 BF.library.getChapterMeta 独立取（见该函数注释），本函数不
     缓存 sid —— 任何顺手缓存都会在重新分章后过期且无人消费，是静默错误源。 */
  try {
    const item = await BF.store.idbGet(BF.store.K.CHAPTER_TITLES, bookId);
    if (item && Array.isArray(item.titles)) {
      const raw = item.titles;
      /* 形态判定：元素是对象且带 title → 新格式；否则视为旧格式（字符串）。
         不靠数组长度或是否全为对象来猜 —— 旧数据被外部工具改坏成混合形态时，
         逐元素判断仍能正确取到能取的那部分，不整体失败。 */
      const isNew = raw.some(function (x) { return x && typeof x === 'object' && !Array.isArray(x); });
      if (isNew) {
        return raw.map(function (x) {
          if (x && typeof x === 'object' && !Array.isArray(x)) return x.title == null ? '' : String(x.title);
          return x == null ? '' : String(x);   /* 混合形态里的字符串项：照旧取其本身 */
        });
      }
      return raw.map(function (x) { return x == null ? '' : String(x); });
    }
  } catch (e) { BF.err.report('getTitles.idb', e); }
  return [];
};

