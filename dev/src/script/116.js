/* ================= A7. Agent 工具集（覆盖用户可操作能力域）+ Agent ================= */
/* Agent 可直接调用的工具白名单：一律「显式命名的薄封装」，调用既有的用户面向 API
   （与界面按钮同一个入口），因此确认框、撤销栈、通知、hub 鉴权链路全部原样保留。
   不提供通用命令 runner（直连 BF.commands.run 没有鉴权），不暴露任意属性路径，密钥零接触。
   设置建议仍走「建议 + 授权」弹窗：模型能提建议，但一条都不会自己落地，必须用户点头。 */
/* 两个内部 helper：按 id / 书名定位书，以及长数组摘要。下划线前缀，不在白名单，模型调不到。 */
const _bfAgentBook = function (s) {
  const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || [];
  const q = String(s == null ? '' : s).trim();
  if (!q) return (BF.reader.state && BF.reader.state.book) || books[0] || null;
  let b = books.find(function (x) { return x && String(x.id) === q; });
  if (!b) b = books.find(function (x) { return x && x.title === q; });
  if (!b) b = books.find(function (x) { return x && x.title && x.title.indexOf(q) >= 0; });
  return b || null;
};
const _bfAgentList = function (arr, n) {
  const a = arr || [];
  const lim = n || 8;
  return '共 ' + a.length + ' 条' + (a.length ? '：' + a.slice(0, lim).join('、') + (a.length > lim ? '…' : '') : '');
};
BF.ai.AGENT_TOOLS = [
  /* 组1 阅读与导航 */
  'getBook', 'gotoChapter', 'nextChapter', 'prevChapter', 'getChapterText', 'getChapterMeta',
  'getToc', 'getProgress', 'openDrawer', 'closeDrawer', 'toggleMicroread',
  'findInPage', 'searchBook', 'searchAcrossBooks', 'gotoPage', 'updateRemain',
  /* 组2 标注与便签 */
  'addNote', 'addBookmark', 'addVocab', 'listAnnotations', 'removeNote', 'listNoteTags',
  /* 组3 书籍与书架 */
  'listBooks', 'openBook', 'closeReader', 'continueRead', 'goPage', 'toggleStar', 'togglePin',
  'renameBook', 'tagBook', 'listTags', 'filterTag', 'clearShelfFilters', 'setShelfView',
  'deleteBook', 'exportBook', 'resplitBook',
  /* 组4 导入 / 导出 / 备份 */
  'importFile', 'importClipboard', 'importURL', 'promptImportURL', 'backupNow', 'exportBackup',
  'listBackups', 'restoreBackup', 'exportAllBooks', 'exportNotes', 'importAnnotations',
  'exportAskHistory', 'selfPackage',
  /* 组5 回收站 / 撤销 */
  'listTrash', 'restoreTrash', 'purgeTrash', 'emptyTrash', 'undo', 'undoCount',
  /* 组6 外观 / 设置 / 场景 */
  'cycleTheme', 'setTheme', 'listThemes', 'applyScene', 'listScenes', 'adviseSettings',
  'getSettings', 'fontUp', 'fontDown', 'lineHeightUp', 'lineHeightDown',
  'toggleFocus', 'toggleNoise', 'toggleStats',
  /* 组8 存储规划：planStorage 只规划不写盘；applyStoragePlan 走授权弹窗由用户勾选批准 */
  'planStorage', 'applyStoragePlan',
  /* 组7 朗读 / 工具 / 面板 */
  'speak', 'stopSpeak', 'pauseSpeak', 'resumeSpeak', 'ttsStatus', 'getStats',
  'autoScrollToggle', 'openPanel', 'chapterManager', 'openTrash'
];
BF.ai.tools = {
  getBook: function () { const b = BF.reader.state.book; return b ? b.title : '未打开书'; },
  gotoChapter: function (idx) {
    /* T4：模型给的是 1 基章号，BF.reader.gotoChapter 收 0 基索引。入口 -1 并夹到 >=0；
      越界（>总章数）夹到末章、<1 夹到第 1 章；回执用实际落点（用户/模型看到的章号）。 */
    const _book = BF.reader.state.book;
    const _total = (_book && _book.totalChapters) || 0;
    let _n = (parseInt(idx, 10) || 1) - 1;
    if (_n < 0) _n = 0;
    if (_total && _n > _total - 1) _n = _total - 1;
    BF.reader.gotoChapter(_n);
    return '已跳转第' + (_n + 1) + '章';
  },
  searchBook: function (q) { BF.reader.searchAll(String(q)); return '已搜索：' + q; },
  addNote: function (text) {
    /* 与划线/书签/生词一样带齐位置字段，并走 mergeWrite 获得并发合并保护：
       ① 不能裸读-改-写 —— 两标签页同时让 Agent 记笔记会互相整键覆盖；
       ② id 必须带随机后缀 —— 只取 'n_' + Date.now() 会同毫秒两条相撞，
          mergeWrite/mergeRemove 按 id 去重时会互相吞掉；
       ③ chapterIdx/loc/sid 不能缺 —— 缺了便签在标注中心与导出里恒为
          「（未定位）」，回原文只能按词搜，重新分章后也找不回。
       Agent 无选区，loc/charOffset 诚实置 null（同 W3C 导入便签），
       sid 走 __backfillSid 异步补写（「同步落库 + 异步补 sid」通路，
       结构性避免漏 await 把 [object Promise] 写进 sid）。 */
    const t = String(text == null ? '' : text).slice(0, 20000);   /* 与 BF.notes MAX_TEXT 同口径 */
    if (!t.trim()) return '笔记内容为空，未添加';
    const now = Date.now();
    const n = {
      id: 'n_' + now + '_' + Math.random().toString(36).slice(2, 6),   /* 同 BF.notes.create 口径，防同毫秒相撞 */
      bookId: BF.appState.currentBookId || '',
      chapterIdx: (typeof BF.appState.currentChapterIdx === 'number') ? BF.appState.currentChapterIdx : null,
      title: '', text: t, tags: [],
      charOffset: null, loc: null, sid: '',
      created: now,
    };
    const res = BF.store.mergeWrite(BF.store.K.NOTES, n, function (x) { return x && x.id; }, '便签');
    BF.reader.__backfillSid(BF.store.K.NOTES, n);
    const where = (n.chapterIdx == null) ? '（未关联书籍）' : ('（第' + (n.chapterIdx + 1) + '章）');
    /* 这条返回值是给模型看的：写失败却回「已添加笔记」，模型会照着告诉用户已存好。
       如实回「未写入」，并让它把原因转达给用户。 */
    if (!res || res.ok !== true) return '笔记未保存：本地存储空间不足，这条没有写入（请告知用户清理存储空间后重试）';
    if (res.ext > 0) return '已添加笔记' + where + '；检测到其他标签页同时写入，已合并保留双方条目';
    return '已添加笔记' + where;
  },
  speak: function () { BF.tts.start(); return '已开始朗读'; },
  stopSpeak: function () { BF.tts.stop(); return '已停止朗读'; },
  nextChapter: function () { BF.reader.nextChapter(); return '已下一章'; },
  prevChapter: function () { BF.reader.prevChapter(); return '已上一章'; },
  cycleTheme: function () { BF.theme.cycle(); return '已切换外观'; },
  getStats: function () { return '今日阅读 ' + BF.stats.todayDisplay() + ' 分钟，累计 ' + BF.stats.total() + ' 小时'; },
  /* 建议通道入口：把 key=value 建议交给授权弹窗，落地与否由用户决定。
     返回 Promise，字符串是给模型看的答复（含用户实际批准了哪些）。 */
  adviseSettings: function (arg) { return BF.ai.adviseSettings(arg); },
  /* ---- 组8 存储规划 ----
     planStorage：只读规划，报出「正文放哪、各类放哪」与理由，绝不写盘。
     applyStoragePlan：把当前规划交给专用授权弹窗，用户逐类勾选后才写 storageAlloc/mirrorKeys；
       未获批的一项都不改；破坏性迁移不自动做（仍由用户点「立即迁移」）。 */
  planStorage: async function () {
    try {
      const p = await BF.store.planStorage();
      const lines = Object.keys(p.reasons).map(function (k) { return '· ' + k + '：' + p.reasons[k]; });
      return p.summary + '\n\n逐项理由：\n' + lines.join('\n') +
        '\n\n注意：这只是推荐方案，尚未修改任何设置。若用户认可，再调用 [[tool:applyStoragePlan]] 让用户逐项勾选确认。' +
        '方案按各区剩余容量泄洪：装得下的内容往有余量的区导、装不下的大内容回落 IDB/OPFS；承重键主存恒本地存储只配镜像。';
    } catch (e) { return '生成存储方案失败：' + (e && e.message || e); }
  },
  applyStoragePlan: function () {
    try {
      return BF.ai.showStoragePlan();
    } catch (e) { return Promise.resolve('应用存储方案失败：' + (e && e.message || e)); }
  },
  /* ---- 组1 阅读与导航：读正文、目录、进度，以及用户可见的阅读态开关 ---- */
  getChapterText: async function (n) {
    const b = BF.reader.state.book;
    if (!b) return '当前没有打开书';
    const idx = BF.appState.currentChapterIdx || 0;
    try {
      const r = await BF.library.getChapterText(b, idx);
      const text = typeof r === 'string' ? r : String((r && (r.text || r.content)) || '');
      const lim = Math.max(200, Math.min(6000, parseInt(n, 10) || 1200));
      return '《' + b.title + '》第 ' + (idx + 1) + ' 章正文（共 ' + text.length + ' 字，显示前 ' + Math.min(lim, text.length) + ' 字）：' + text.slice(0, lim);
    } catch (e) { return '读取章节正文失败：' + (e && e.message || e); }
  },
  getChapterMeta: async function () {
    const b = BF.reader.state.book;
    if (!b) return '当前没有打开书';
    const idx = BF.appState.currentChapterIdx || 0;
    let titles = [];
    try { titles = (await BF.library.getChapterTitles(b.id)) || []; } catch (e) {}
    const cw = (b.chapterWords || [])[idx] || 0;
    return '《' + b.title + '》共 ' + (b.totalChapters || 0) + ' 章 / ' + (b.wordCount || 0) + ' 字；当前第 ' + (idx + 1) + ' 章「' + (titles[idx] || '（无标题）') + '」，本章 ' + cw + ' 字';
  },
  getToc: async function () {
    const b = _bfAgentBook('');
    if (!b) return '书架为空，没有目录';
    try {
      const t = (await BF.library.getChapterTitles(b.id)) || [];
      return '《' + b.title + '》目录 ' + _bfAgentList(t.map(function (x, i) { return (i + 1) + '.' + x; }), 60);
    } catch (e) { return '读取目录失败：' + (e && e.message || e); }
  },
  getProgress: function () {
    const b = BF.reader.state.book;
    if (!b) return '当前页 ' + BF.appState.currentPage + '，没有打开书';
    const pct = document.getElementById('reader-prog');
    const chap = document.getElementById('reader-chap-indicator');
    return '《' + b.title + '》进度 ' + (pct ? pct.textContent.trim() : '?') + '，' +
      (chap ? chap.textContent.trim() : ('第 ' + ((BF.appState.currentChapterIdx || 0) + 1) + ' 章')) +
      (BF.reader.pageModeActive() ? '（分页模式，共 ' + (BF.reader.state.pkPages || []).length + ' 页）' : '（滚动模式）');
  },
  openDrawer: function (tab) {
    const t = String(tab || '').trim();
    const map = { '目录': 'toc', '书签': 'bookmarks', '笔记': 'notes', '生词': 'vocab', '搜索': 'search', '标注': 'marks',
      toc: 'toc', bookmarks: 'bookmarks', notes: 'notes', vocab: 'vocab', search: 'search', marks: 'marks' };
    const name = map[t] || 'toc';
    BF.reader.openDrawer(name);
    return '已打开抽屉「' + name + '」';
  },
  closeDrawer: function () { BF.reader.closeDrawer(); return '已关闭抽屉'; },
  toggleMicroread: function () {
    if (BF.appState.currentPage !== 'reader') return '请先打开一本书';
    BF.reader.toggleMicroread();
    const p = document.getElementById('page-reader');
    return p && p.classList.contains('microread') ? '已开启微读模式' : '已退出微读模式';
  },
  findInPage: function (q) {
    const s = String(q || '').trim();
    if (BF.appState.currentPage !== 'reader') return '章内查找只在阅读页可用（当前页：' + BF.appState.currentPage + '）';
    BF.findInPage.open();
    const inp = document.getElementById('bf-find-input');
    if (!inp) return '查找条未就绪';
    if (s) { inp.value = s; inp.dispatchEvent(new Event('input', { bubbles: true })); }
    return s ? '已在章内查找：' + s : '已打开章内查找框';
  },
  searchAcrossBooks: async function (q) {
    const s = String(q || '').trim();
    if (!s) return '请给出要搜索的词';
    try {
      const r = await BF.library.searchAcrossBooks(s);
      const n = Array.isArray(r) ? r.length : (r && Array.isArray(r.hits) ? r.hits.length : null);
      return '跨书搜索「' + s + '」完成' + (n != null ? '，命中 ' + n + ' 处' : '，结果已显示在搜索面板');
    } catch (e) { return '跨书搜索失败：' + (e && e.message || e); }
  },
  gotoPage: function (n) {
    if (!BF.reader.pageModeActive()) return '当前不是分页模式（可先用设置切到分页）';
    const pages = BF.reader.state.pkPages || [];
    if (!pages.length) return '本章还没有分页';
    let i = (parseInt(n, 10) || 1) - 1;
    i = Math.max(0, Math.min(pages.length - 1, i));
    BF.reader.gotoPage(i);
    return '已翻到第 ' + (i + 1) + '/' + pages.length + ' 页';
  },
  updateRemain: function () {
    if (BF.appState.currentPage !== 'reader') return '请先打开一本书';
    BF.reader.updateRemain();
    const el = document.getElementById('reader-remain');
    return '本章剩余：' + ((el && el.textContent.trim()) || '（无进度信息）');
  },
  /* ---- 组2 标注与便签：写走原有 mergeWrite / 确认链路，读只读账本 ---- */
  addBookmark: function () {
    if (BF.appState.currentPage !== 'reader' || !BF.appState.currentBookId) return '请在阅读页打开一本书后添加书签';
    const K = BF.store.K.BOOKMARKS;
    const before = (BF.store.lsGetArray(K, []) || []).length;
    try { BF.reader.addBookmark(); } catch (e) { return '添加书签失败：' + (e && e.message || e); }
    const after = (BF.store.lsGetArray(K, []) || []).length;
    return after > before ? '已添加书签（共 ' + after + ' 条）' : '未添加书签（选区校验未通过或写入失败，请查看界面通知）';
  },
  addVocab: function (word) {
    const w = String(word || '').trim();
    if (!w) return '请给出要收藏的生词';
    if (BF.appState.currentPage !== 'reader' || !BF.appState.currentBookId) return '请在阅读页打开一本书后收藏生词';
    const K = BF.store.K.VOCAB;
    const before = (BF.store.lsGetArray(K, []) || []).length;
    BF.reader.__lastSelText = w;   /* 与选区工具条同一份备份选区 */
    try { BF.reader.addVocab(); } catch (e) { BF.reader.__lastSelText = ''; return '收藏生词失败：' + (e && e.message || e); }
    BF.reader.__lastSelText = '';
    const after = (BF.store.lsGetArray(K, []) || []).length;
    return after > before ? '已收藏生词「' + w + '」' : '未收藏生词「' + w + '」（选区校验未通过、正文中找不到或已收藏过）';
  },
  listAnnotations: function (kind) {
    const K = BF.store.K;
    const map = { '划线': [K.HIGHLIGHTS, '划线'], hl: [K.HIGHLIGHTS, '划线'], '书签': [K.BOOKMARKS, '书签'], bm: [K.BOOKMARKS, '书签'],
      '便签': [K.NOTES, '便签'], note: [K.NOTES, '便签'], '生词': [K.VOCAB, '生词'], vocab: [K.VOCAB, '生词'] };
    const hit = map[String(kind || '').trim()];
    if (!hit) return '请指定类别：hl 划线 / bm 书签 / note 便签 / vocab 生词';
    const all = BF.store.lsGetArray(hit[0], []) || [];
    const bid = BF.appState.currentBookId;
    const mine = bid ? all.filter(function (x) { return x && x.bookId === bid; }) : all;
    const names = mine.slice(0, 8).map(function (x) { return String((x && (x.word || x.text || x.title)) || '（空）').slice(0, 24); });
    return '当前书' + hit[1] + '共 ' + mine.length + ' 条' + (names.length ? '：' + names.join('、') : '');
  },
  removeNote: async function (id) {
    const s = String(id || '').trim();
    if (!s) return '请给出便签 id（可用 listAnnotations:note 查）';
    try { const ok = await BF.notes.remove(s); return ok ? '已删除便签 ' + s : '未找到便签 ' + s; }
    catch (e) { return '删除便签失败：' + (e && e.message || e); }
  },
  listNoteTags: function () {
    try {
      const t = BF.notes.allTags() || [];
      return _bfAgentList(t.map(function (x) { return Array.isArray(x) ? x[0] + '(' + x[1] + ')' : String(x); }), 30);
    } catch (e) { return '读取便签标签失败：' + (e && e.message || e); }
  },
  /* ---- 组3 书籍与书架：id 或书名均可定位；删书/重分章只触发原有确认框 ---- */
  listBooks: function () {
    const a = BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || [];
    if (!a.length) return '书架为空';
    return '书架共 ' + a.length + ' 本：' + a.slice(0, 20).map(function (b, i) {
      return (i + 1) + '.《' + (b.title || '?') + '》 ' + (b.totalChapters || 0) + ' 章 / ' + (b.wordCount || 0) + ' 字' +
        (b.starred ? ' [星标]' : '') + (b.pinned ? ' [置顶]' : '') + ' id=' + b.id;
    }).join('；');
  },
  openBook: async function (s) {
    const b = _bfAgentBook(s);
    if (!b) return '未找到书：' + String(s || '');
    try { await BF.app.openBook(b.id); return '已打开《' + b.title + '》'; }
    catch (e) { return '打开书失败：' + (e && e.message || e); }
  },
  closeReader: function () {
    if (BF.appState.currentPage !== 'reader') return '当前不在阅读页';
    BF.app.closeReader(); return '已关闭阅读器，回到书架';
  },
  continueRead: function () { BF.app.continueRead(); return '已触发继续阅读'; },
  goPage: function (p) {
    const s = String(p || '').trim();
    const map = { '首页': 'home', '书架': 'bookshelf', '笔记': 'notes', '我的': 'mine', '阅读': 'reader', '曲径': 'qj',
      home: 'home', bookshelf: 'bookshelf', notes: 'notes', mine: 'mine', reader: 'reader' };
    const name = map[s];
    if (!name) return '未知页面：' + s + '（可用 home/bookshelf/notes/mine/reader）';
    BF.app.go(name); return '已切到页面：' + name;
  },
  toggleStar: function (s) {
    const b = _bfAgentBook(s); if (!b) return '未找到书：' + String(s || '');
    BF.app.toggleStar(b.id);
    return '已切换《' + b.title + '》的星标（状态以书架卡为准）';
  },
  togglePin: function (s) {
    const b = _bfAgentBook(s); if (!b) return '未找到书：' + String(s || '');
    BF.app.togglePin(b.id);
    return '已切换《' + b.title + '》的置顶（状态以书架卡为准）';
  },
  renameBook: function (s) {
    const b = _bfAgentBook(s); if (!b) return '未找到书：' + String(s || '');
    BF.app.renameBook(b.id); return '已弹出《' + b.title + '》的重命名输入框（需用户在框里填写新书名）';
  },
  tagBook: function (s) {
    const b = _bfAgentBook(s); if (!b) return '未找到书：' + String(s || '');
    BF.library.tagPrompt(b.id); return '已弹出《' + b.title + '》的标签输入框（需用户填写标签）';
  },
  listTags: function () { return _bfAgentList(BF.library.allTags() || [], 40); },
  filterTag: function (t) {
    const s = String(t || '').trim();
    BF.library.applyTagFilter(s);
    return '书架标签筛选：' + (s || '（已清空）');
  },
  clearShelfFilters: function () { BF.library.clearShelfFilters({}); return '已清空书架筛选'; },
  setShelfView: function (v) {
    const s = String(v || '').trim();
    const name = (s === '列表' || s === 'list') ? 'list' : 'grid';
    BF.app.setView(name); return '书架视图：' + name;
  },
  deleteBook: function (s) {
    const b = _bfAgentBook(s); if (!b) return '未找到书：' + String(s || '');
    BF.app.deleteBookConfirm(b.id);
    return '已弹出《' + b.title + '》的删除确认框（移入回收站，需用户确认，工具不会代点）';
  },
  exportBook: async function (s) {
    const b = _bfAgentBook(s); if (!b) return '未找到书：' + String(s || '');
    try { await BF.library.downloadBook(b.id); return '已触发导出《' + b.title + '》（下载由浏览器处理）'; }
    catch (e) { return '导出失败：' + (e && e.message || e); }
  },
  resplitBook: async function (s) {
    const b = _bfAgentBook(s); if (!b) return '未找到书：' + String(s || '');
    try { await BF.library.resplitBook(b.id); return '已触发《' + b.title + '》重新分章（改动沿用原有确认与撤销链路）'; }
    catch (e) { return '重新分章失败：' + (e && e.message || e); }
  },
  /* ---- 组4 导入 / 导出 / 备份：异步一律 await，回执说真实结果 ---- */
  importFile: function () { BF.library.pickAndImport(); return '已触发导入文件选择（需用户选择 TXT 文件；原生选择器可能要求用户手势）'; },
  importClipboard: async function () {
    try { await BF.library.importClipboard(); return '已触发剪贴板导入（结果以界面通知为准）'; }
    catch (e) { return '剪贴板导入失败：' + (e && e.message || e); }
  },
  importURL: async function (url) {
    const u = String(url || '').trim();
    if (!/^https?:\/\//i.test(u)) return '请给出 http(s) 开头的 TXT 直链';
    try { await BF.library.importURL(u); return '已触发在线导入：' + u + '（结果以界面通知为准）'; }
    catch (e) { return '在线导入失败：' + (e && e.message || e); }
  },
  promptImportURL: function () { BF.library.promptImportURL(); return '已弹出在线导入 URL 输入框（需用户填写）'; },
  backupNow: async function () {
    try { await BF.bk.autoNow(); return '已生成自动备份（当前共 ' + ((BF.bk.list() || []).length) + ' 份）'; }
    catch (e) { return '自动备份失败：' + (e && e.message || e); }
  },
  exportBackup: function () { BF.bk.exportWithAsk(); return '已触发导出备份（可能弹出加密询问或文件下载）'; },
  listBackups: function () {
    const a = BF.bk.list() || [];
    return _bfAgentList(a.map(function (x, i) { return i + ':' + String((x && (x.time || x.at || x.created)) || '?'); }), 12);
  },
  restoreBackup: async function (i) {
    const n = parseInt(i, 10);
    if (isNaN(n)) return '请给出备份序号（可用 listBackups 查）';
    const a = BF.bk.list() || [];
    if (!a[n]) return '第 ' + n + ' 份备份不存在（当前共 ' + a.length + ' 份）';
    try { await BF.bk.restoreAt(n); return '已触发恢复第 ' + n + ' 份备份（沿用原有确认链路，结果以界面通知为准）'; }
    catch (e) { return '恢复备份失败：' + (e && e.message || e); }
  },
  exportAllBooks: async function () {
    try { await BF.enh.exportAllBooks(false); return '已触发导出全部书籍'; }
    catch (e) { return '导出全部书籍失败：' + (e && e.message || e); }
  },
  exportNotes: function (fmt) {
    const f = String(fmt || 'md').trim();
    BF.enh.exportNotes(f); return '已触发导出便签/标注（格式：' + f + '）';
  },
  importAnnotations: function () {
    if (!BF.appState.currentBookId) return '请先打开一本书（标注导入到当前打开的书）';
    BF.ann.importAnnotations(); return '已弹出标注导入框（需用户选择文件）';
  },
  exportAskHistory: async function (fmt) {
    if (!BF.appState.currentBookId) return '请先打开一本书';
    try { await BF.ai.exportAskHistory(null, String(fmt || 'md').trim()); return '已请求导出 AI 问答历史（无历史时界面会提示）'; }
    catch (e) { return '导出问答历史失败：' + (e && e.message || e); }
  },
  selfPackage: async function () {
    try { await BF.selfPackage.export(); return '已触发自打包导出'; }
    catch (e) { return '自打包失败：' + (e && e.message || e); }
  },
  /* ---- 组5 回收站 / 撤销：破坏操作只触发，确认与 danger 档位原样保留 ---- */
  listTrash: function () {
    const a = BF.store.lsGetArray(BF.store.K.TRASH, []) || [];
    if (!a.length) return '回收站为空';
    return '回收站共 ' + a.length + ' 本：' + a.slice(0, 15).map(function (x, i) {
      return (i + 1) + '.《' + ((x && x.meta && x.meta.title) || '?') + '》 id=' + ((x && x.meta && x.meta.id) || '?');
    }).join('；');
  },
  restoreTrash: async function (s) {
    const q = String(s || '').trim();
    if (!q) return '请给出要恢复的书 id 或书名（可用 listTrash 查）';
    const a = BF.store.lsGetArray(BF.store.K.TRASH, []) || [];
    const it = a.find(function (x) { return x && x.meta && (String(x.meta.id) === q || x.meta.title === q || (x.meta.title || '').indexOf(q) >= 0); });
    if (!it) return '回收站里没有这本书：' + q;
    try { const ok = await BF.trash.restore(String(it.meta.id)); return ok !== false ? '已恢复《' + it.meta.title + '》' : '恢复未成功（可能同名冲突）'; }
    catch (e) { return '恢复失败：' + (e && e.message || e); }
  },
  purgeTrash: function (s) {
    const q = String(s || '').trim();
    if (!q) return '请给出要彻底删除的回收站条目 id（可用 listTrash 查）';
    const a = BF.store.lsGetArray(BF.store.K.TRASH, []) || [];
    const it = a.find(function (x) { return x && x.meta && String(x.meta.id) === q; });
    if (!it) return '回收站里没有这个条目：' + q + '（未弹出确认框）';
    BF.trash.purge(q);
    return '已弹出《' + ((it.meta && it.meta.title) || q) + '》的「彻底删除」确认框（danger 3，需用户确认，工具不会代点）';
  },
  emptyTrash: function () {
    const a = BF.store.lsGetArray(BF.store.K.TRASH, []) || [];
    if (!a.length) return '回收站本来就是空的，无需清空（未弹出确认框）';
    BF.trash.empty();
    return '已弹出「清空回收站」确认框（' + a.length + ' 本，danger 3，需用户确认，工具不会代点）';
  },
  undo: function () { const ok = BF.undo.undo(); return ok === false ? '没有可撤销的操作' : '已撤销上一步操作'; },
  undoCount: function () { return '撤销栈还有 ' + BF.undo.count() + ' 步'; },
  /* ---- 组6 外观 / 设置 / 场景：只读密钥之外的设置；改设置只走外观键 ---- */
  setTheme: function (name) {
    const s = String(name || '').trim();
    if (!s) return '请给出外观名（可用 listThemes 查）';
    try { BF.theme.set(s); return '已请求切换外观：' + s + '（当前生效：' + BF.skin.get() + '）'; }
    catch (e) { return '切换外观失败：' + (e && e.message || e); }
  },
  listThemes: function () {
    const o = BF.skin.opts() || [];
    return _bfAgentList(o.map(function (x) { return (x && (x.label || x.name || x.key || x.id || x.value)) || String(x); }), 20);
  },
  applyScene: function (name) {
    const s = String(name || '').trim();
    const keys = Object.keys(BF.SCENES || {});
    if (!s) return '请给出场景名，可用：' + keys.join('、');
    if (keys.indexOf(s) < 0) return '未知场景「' + s + '」，可用：' + keys.join('、');
    BF.scene.apply(s); return '已应用场景：' + s;
  },
  listScenes: function () { return _bfAgentList(Object.keys(BF.SCENES || {}), 20); },
  getSettings: function () {
    const keys = ['fontSize', 'lineHeight', 'appearance', 'readerMode', 'shelfViewMode', 'autoTheme', 'pageWidth'];
    const out = {};
    keys.forEach(function (k) { try { const v = BF.settings.get(k); if (v !== undefined) out[k] = v; } catch (e) {} });
    return '当前外观相关设置（不含任何密钥）：' + JSON.stringify(out);
  },
  fontUp: function () {
    if (BF.appState.currentPage !== 'reader') return '字号调节只在阅读页生效';
    BF.enh.zoomBy(1); return '已增大字号，当前 ' + BF.settings.get('fontSize') + 'px';
  },
  fontDown: function () {
    if (BF.appState.currentPage !== 'reader') return '字号调节只在阅读页生效';
    BF.enh.zoomBy(-1); return '已减小字号，当前 ' + BF.settings.get('fontSize') + 'px';
  },
  lineHeightUp: function () {
    const v = Math.min(3, +(BF.settings.num('lineHeight', 1.9)) + 0.1).toFixed(2);
    BF.settings.set('lineHeight', v); BF.theme.apply(); return '已增大行距至 ' + v;
  },
  lineHeightDown: function () {
    const v = Math.max(1, +(BF.settings.num('lineHeight', 1.9)) - 0.1).toFixed(2);
    BF.settings.set('lineHeight', v); BF.theme.apply(); return '已减小行距至 ' + v;
  },
  toggleFocus: function () { BF.wsUI.toggleFocus(); return '已切换专注模式'; },
  toggleNoise: function () { BF.wsUI.toggleNoise(); return '已切换白噪音'; },
  toggleStats: function () { BF.wsUI.toggleStats(); return '已切换阅读统计显示'; },
  /* ---- 组7 朗读 / 工具 / 面板：一个 openPanel 覆盖所有常驻面板 ---- */
  pauseSpeak: function () { BF.tts.pause(); return '已请求暂停朗读'; },
  resumeSpeak: function () { BF.tts.resume(); return '已请求继续朗读'; },
  ttsStatus: function () {
    const s = BF.tts.state || {};
    return '朗读：' + (s.playing ? '播放中' : '未播放') + ' · 引擎 ' + (s.engine || '未知');
  },
  autoScrollToggle: function () {
    BF.enh.autoScroll.toggle();
    return '自动滚动：' + (BF.enh.autoScroll.isOn() ? '已开启' : '已关闭');
  },
  chapterManager: function () {
    if (!BF.appState.currentBookId) return '请先打开一本书';
    BF.reader.chapterManager(); return '已打开分章管理面板';
  },
  openTrash: function () { BF.trash.open(); return '已打开回收站面板'; },
  openPanel: function (name) {
    const s = String(name || '').trim();
    const map = {
      '设置': 'settings', settings: 'settings', '通知': 'noti', noti: 'noti', '通知中心': 'noti',
      '工作台': 'workbench', workbench: 'workbench', '基地': 'base', base: 'base', '数据': 'base',
      '运维台': 'diag', diag: 'diag', '诊断': 'diag', '帮助': 'help', help: 'help',
      'AI中心': 'ai', ai: 'ai', '终端': 'terminal', terminal: 'terminal', dsl: 'terminal',
      '便签': 'notes', notes: 'notes', '标注中心': 'ann', ann: 'ann'
    };
    const k = map[s];
    if (!k) return '未知面板「' + s + '」，可用：settings/noti/workbench/base/diag/help/ai/terminal/notes/ann';
    try {
      if (k === 'settings') BF.settingsUI.toggle();
      else if (k === 'noti') BF.wsUI.openNotiCenter();
      else if (k === 'workbench') BF.workbench.open();
      else if (k === 'base') BF.base.open();
      else if (k === 'diag') BF.diag.open();
      else if (k === 'help') BF.help.open();
      else if (k === 'ai') BF.aiUI.toggle();
      else if (k === 'terminal') BF.dslUI.toggle();
      else if (k === 'notes') BF.notes.open();
      else if (k === 'ann') BF.app.go('notes');
      return '已打开面板：' + k;
    } catch (e) { return '打开面板失败：' + (e && e.message || e); }
  },
};
/* 全书检索（供 Agent 模式的问书取材）：按问题关键词打分取最相关章节片段。
   有界扫描：最多 60 章、6 章并发、跳过当前章（当前章已单独注入） */
BF.ai._keywords = function (q) {
  const s = String(q || '').replace(/[，。？！、；：""''（）《》〈〉\s,.?!;:()"']/g, ' ');
  const toks = s.split(/\s+/).filter(function (t) { return t.length >= 2; });
  /* 中文无空格分词 → 整句被当 1 个 token，indexOf 整串匹配几乎必败、召回近零。
     对含 CJK 且长度≥3 的 token 再做二元滑动切分（2 字窗口），召回显著提升；英文/数字 token 保留原样。 */
  const out = []; const seen = Object.create(null);
  function add(t) { if (t && !seen[t]) { seen[t] = 1; out.push(t); } }
  toks.forEach(function (t) {
    add(t);
    if (/[一-鿿]/.test(t) && t.length >= 3) {
      for (let i = 0; i + 2 <= t.length; i++) add(t.slice(i, i + 2));
    }
  });
  return out.slice(0, 24);
};
/* ---- 分块索引（#151 分块 500/重叠 50/窗口 100，按书哈希存） ----
   问书 Agent 每次检索原本现读最多 400 章（IDB 逐章解压），同一本书的
   第二个问题把这笔 IO 原样再付一遍。这里把「可读范围」按 500 字分块、
   相邻块重叠 50 字（步长 450，关键词跨块边界不漏），索引按书哈希
   （id:章数:字数）缓存——重新分章/正文变化自动失效，进度推进自动扩界。
   窗口 100：内存最多缓存 100 本书的索引（LRU），超窗淘汰最久未用。
   全程本地计算（本地优先）：分块、检索、打分不发任何网络请求。
   防剧透开启时只分块到当前进度；关闭时整本（≤400 章）并给块标已读/未读。
   索引另落一份到 IndexedDB 的 'kv'（键 ai.chunk.<书哈希>）：刷新或换标签页后读它，
   同一本书的下一次检索不必再把几百章逐章解压一遍。落盘是派生数据的副本，三条约束：
   只认一个账本（ai.chunk.meta，账本外的前缀键启动时对账删掉）；有预算上限
   （超了按最久未用淘汰，不给用户数据抢地盘）；隐私模式开启时一份都不写。
   备份快照只搬 chapters / chapter_titles，不含 'kv'，索引不会让备份变大。 */
BF.ai.chunkIdx = (function () {
  const SIZE = 500, OVERLAP = 50, STEP = SIZE - OVERLAP, WIN = 100, CAP = 400;
  const DK = 'ai.chunk.', META_K = 'ai.chunk.meta';
  /* P4.5：底层读写读 allocOf('chunkIdx') 选介质。当前问书索引只有 IndexedDB 一种实现
     （带淘汰的 kv store），allocOf 恒为 idb，其余取值一律回落 idb——接线点留在这里，
     未来若新增介质只需加分支，不动调用方。读回退仍以账本 + idb 为准，行为零变化。 */
  function _chunkMedia() {
    try { const m = BF.store.allocOf('chunkIdx'); return (m === 'idb' || m === 'auto' || m === 'ls') ? m : 'idb'; }
    catch (e) { return 'idb'; }
  }
  const DISK_BYTES = 6 * 1024 * 1024, DISK_MIN_CHUNKS = 24;
  const mem = new Map();   /* hash -> { chunks, limit, at } */
  let _meta = null;        /* 账本的内存影子：hash -> { at, bytes } */
  let _reconciled = false;
  let _pending = Promise.resolve();   /* 最近一次落盘/清盘链：测试与诊断要能等它落地 */
  function hashOf(b) { return (b && b.id ? String(b.id) : '') + ':' + (b && b.totalChapters || 0) + ':' + (b && b.wordCount || 0); }
  function bookOf(hash) { return String(hash).split(':')[0]; }
  function bytesOf(chunks) { let n = 0; for (let i = 0; i < chunks.length; i++) n += (chunks[i].text || '').length; return n * 2; }   /* UTF-16：一字两字节，够做预算判断 */
  async function readMeta() {
    if (_meta) return _meta;
    let m = null;
    try { m = await BF.store.idbKeyGet(META_K, null); } catch (e) { m = null; }
    _meta = (m && typeof m === 'object') ? m : {};
    return _meta;
  }
  async function writeMeta() { try { await BF.store.idbKeyPut(META_K, _meta || {}); } catch (e) { BF.err.report('chunkIdx.meta', e); } }
  function totalBytes(m) { let n = 0; for (const k in m) n += (m[k] && m[k].bytes) || 0; return n; }
  /* 对账：账本与 'kv' 实际键不一致，只能是崩在「写正文」与「写账本」之间留下的残骸。
     账本里没有的前缀键一律删——那是没人引用、也永远不会再读的正文副本；
     账本里有而键没了的条目也删——留着会把预算占死，真索引反而挤不进去。 */
  async function reconcile() {
    if (_reconciled) return;
    _reconciled = true;
    const m = await readMeta();
    let keys = [];
    try { keys = await BF.store.idbAllKeys('kv') || []; } catch (e) { BF.err.report('chunkIdx.keys', e); return; }
    const present = Object.create(null);
    const orphans = [];
    for (const k of keys) {
      if (typeof k !== 'string' || k.indexOf(DK) !== 0 || k === META_K) continue;
      const h = k.slice(DK.length);
      present[h] = true;
      if (!m[h]) orphans.push(k);
    }
    if (orphans.length) { try { await BF.store.idbDeleteMany('kv', orphans); } catch (e) { BF.err.report('chunkIdx.orphan', e); } }
    let dirty = false;
    for (const h of Object.keys(m)) { if (!present[h]) { delete m[h]; dirty = true; } }
    if (dirty) await writeMeta();
  }
  async function loadDisk(hash) {
    if (!BF.store || typeof BF.store.idbKeyGet !== 'function') return null;
    /* P4.5：介质由 allocOf 决定；当前只有 IDB 实现，ls/auto 仍从 idb 读（无 LS 索引实现，回落）。 */
    const _media = _chunkMedia();
    if (_media === 'ls') { /* 预留：LS 索引尚未实现，回落 idb，不改行为 */ }
    await reconcile();
    const m = await readMeta();
    if (!m[hash]) return null;
    let rec = null;
    try { rec = await BF.store.idbKeyGet(DK + hash, null); } catch (e) { rec = null; }
    if (!rec || !Array.isArray(rec.chunks) || typeof rec.limit !== 'number') {
      /* 账本说有、读出来不是索引：撤条目、下次重建覆盖，别把坏记录当命中 */
      delete m[hash]; await writeMeta();
      return null;
    }
    return rec;
  }
  /* 落盘顺序：先写正文、后记账。反过来崩掉会留下「账本说有、键其实没有」的空条目，
     而空条目既读不出东西，又要到对账时才被发现。 */
  async function saveDisk(hash, chunks, limit) {
    if (!BF.store || typeof BF.store.idbKeyPut !== 'function') return;
    /* P4.5：介质由 allocOf 决定；当前只有 IDB 实现，ls/auto 仍写 idb（无 LS 索引实现，回落）。 */
    const _media = _chunkMedia();
    if (_media === 'ls') { /* 预留：LS 索引尚未实现，回落 idb，不改行为 */ }
    if (BF.settings.get('privacyMode')) return;
    if (chunks.length < DISK_MIN_CHUNKS) return;   /* 小书重建比读盘快，不值得占一个键 */
    const bytes = bytesOf(chunks);
    if (bytes > DISK_BYTES) return;                 /* 单本就超预算：只留内存，不淘汰别人来腾地方 */
    await reconcile();
    const m = await readMeta();
    const bk = bookOf(hash);
    for (const h of Object.keys(m)) {
      if (h === hash || bookOf(h) !== bk) continue;
      delete m[h];
      try { await BF.store.idbKeyDelete(DK + h); } catch (e) { BF.err.report('chunkIdx.stale', e); }
    }
    let evicted = false;
    while (totalBytes(m) + bytes > DISK_BYTES) {
      let oldest = null;
      for (const h of Object.keys(m)) { if (h !== hash && (!oldest || (m[h].at || 0) < (m[oldest].at || 0))) oldest = h; }
      if (!oldest) break;
      delete m[oldest]; evicted = true;
      try { await BF.store.idbKeyDelete(DK + oldest); } catch (e) { BF.err.report('chunkIdx.evict', e); }
    }
    m[hash] = { at: Date.now(), bytes: bytes };
    try { await BF.store.idbKeyPut(DK + hash, { chunks: chunks, limit: limit, bytes: bytes, at: m[hash].at }); }
    catch (e) { delete m[hash]; BF.err.report('chunkIdx.write', e); return; }
    await writeMeta();
    if (evicted) BF.log && BF.log.info('问书索引落盘已满，淘汰了最久未用的那本');
  }
  /* 按前缀清：传书 id 只清这本书（含它的旧切法），传 null 清全部。
     内存是同步删的、落盘是异步删的，删书之后不许再让旧正文留在 'kv' 里。 */
  function dropByPrefix(prefix) {
    _pending = readMeta().then(function (m) {
      const hs = Object.keys(m).filter(function (h) { return !prefix || h.indexOf(prefix) === 0; });
      if (!hs.length) return null;
      return Promise.all(hs.map(function (h) {
        delete m[h];
        return BF.store.idbKeyDelete(DK + h).catch(function (e) { BF.err.report('chunkIdx.delete', e); });
      })).then(writeMeta);
    }).catch(function (e) { BF.err.report('chunkIdx.drop', e); });
  }
  async function build(b, opts) {
    const hash = hashOf(b);
    const total = b.totalChapters || 0;
    const cur = BF.appState.currentChapterIdx || 0;
    const want = (BF.settings.get('aiRefBook') === false) ? Math.min(total, CAP) : Math.min(total, cur + 1, CAP);
    const hit = mem.get(hash);
    /* 覆盖章数 ≥ 当前要求即可命中：索引只会多不会少（书章数变才会换 hash），
       命中后按当前进度截断即可，不能要求精确相等——回看前一章会整本重建。 */
    if (hit && hit.limit >= want) { mem.delete(hash); mem.set(hash, hit); return hit.chunks.filter(function (c) { return c.ch <= want - 1; }); }
    /* 内存没有 → 先看落盘副本。命中就把「几百章逐章解压」这笔 IO 省掉。
       落盘副本覆盖的章数不够（进度往前走了）时按未命中处理，重建后覆盖写回。 */
    const disk = await loadDisk(hash);
    if (disk && disk.limit >= want) {
      mem.set(hash, { chunks: disk.chunks, limit: disk.limit, at: Date.now() });
      while (mem.size > WIN) { mem.delete(mem.keys().next().value); }
      return disk.chunks.filter(function (c) { return c.ch <= want - 1; });
    }
    const chunks = [];
    const BATCH = 6;
    /* 实际扫到第几章要单独记：中断（用户按停止）与读章失败都会提前 break，
       这时缓存里只有前半本的块。拿 want 当覆盖数会把它当成完整索引，
       于是「同一本书后半本永远搜不到」——中断一次就中招，落盘还会把它带到下次启动。 */
    let covered = 0;
    for (let i = 0; i < want; i += BATCH) {
      if (opts && opts.signal && opts.signal.aborted) break;
      const idxs = [];
      for (let k = i; k < Math.min(want, i + BATCH); k++) idxs.push(k);
      /* 用 readChapter 而不是 getChapterText：只有前者能区分「读不到」与「本来就是空章」——
         把空章也当成失败会让这类书永远不落盘索引，每次提问重建全书。 */
      let rs = [];
      try { rs = await Promise.all(idxs.map(function (n) { return BF.library.readChapter(b, n).catch(function () { return { ok: false }; }); })); } catch (_) { break; }
      let _bad = false;
      rs.forEach(function (r, k) {
        if (!r || !r.ok) { _bad = true; return; }
        const s = String(r.text || '');
        if (!s) return;
        if (s.length <= SIZE) { chunks.push({ ch: idxs[k], off: 0, text: s }); return; }
        for (let p = 0; p < s.length; p += STEP) {
          chunks.push({ ch: idxs[k], off: p, text: s.slice(p, p + SIZE) });
          if (p + SIZE >= s.length) break;
        }
      });
      await new Promise(function (r) { setTimeout(r, 0); });
      /* 有章读不到：覆盖到此为止。按「尝试过的章数」推进会把缺章索引
         当完整索引落盘，之后搜不到那几章且跨启动复现。 */
      if (_bad) break;
      covered = Math.min(want, i + BATCH);
    }
    mem.set(hash, { chunks: chunks, limit: covered, at: Date.now() });
    while (mem.size > WIN) { mem.delete(mem.keys().next().value); }
    /* 落盘不挡回答：切块与打分已经跑完，再等一次 IDB 写只是让用户白等一次。
       只落扫完的完整索引——半本的块落盘会把「搜不到后半本」带到下次启动。 */
    if (covered >= want) _pending = saveDisk(hash, chunks, covered).catch(function (e) { BF.err.report('chunkIdx.save', e); });
    return chunks;
  }
  function invalidate(b) {
    /* 传对象 → 用它的书 id 作前缀；传字符串 → 本身就是书 id（删书时拿不到 meta，
       章数/字数对不上，只能按 id 前缀清）；不传 → 全清。
       按前缀而不是精确哈希：同一本书的旧切法顺带清掉，不留没人引用的正文副本。 */
    let prefix = null;
    if (b && typeof b === 'object') prefix = String(b.id || '') + ':';
    else if (typeof b === 'string') prefix = b + ':';
    for (const k of Array.from(mem.keys())) { if (!prefix || k.indexOf(prefix) === 0) mem.delete(k); }
    dropByPrefix(prefix);
  }
  return {
    build: build, invalidate: invalidate, hashOf: hashOf,
    size: function () { return mem.size; },
    stats: function () { return { mem: mem.size, disk: _meta ? Object.keys(_meta).length : 0, bytes: _meta ? totalBytes(_meta) : 0, cap: DISK_BYTES, minChunks: DISK_MIN_CHUNKS }; },
    sync: function () { return _pending; },
  };
})();
/* 打分用 BM25（Okapi，k1=1.2 / b=0.75）：词频饱和 + 逆文档频率 + 块长归一。
   旧口径是「命中次数总和 ÷ √块长」，两处会稳定地把无关段落顶到前面：
   ① 没有 IDF——「一个人」「时候」这种全书都有的词与只出现过一次的专名同价，
      问题里的虚词命中就能压掉真正判别性的词；
   ② 词频不饱和——同一段里把人名重复二十次就值二十倍分，长段还靠 √ 归一压不住。
   三项都在块级算（块是索引的单位），avgdl 用整本索引的平均块长，
   所以「进度推进后索引变大」不会让同一本书的相对次序漂移。 */
BF.ai._BM25 = { k1: 1.2, b: 0.75 };
BF.ai._rank = function (chunks, kws) {
  if (!chunks || !chunks.length || !kws || !kws.length) return [];
  const K1 = BF.ai._BM25.k1, B = BF.ai._BM25.b, N = chunks.length;
  const hits = new Array(N);
  const df = Object.create(null);   /* 每个查询词出现在多少块里 */
  let lenSum = 0;
  for (let i = 0; i < N; i++) {
    const text = String(chunks[i].text || '');
    lenSum += text.length;
    let tf = null, first = -1;
    for (let j = 0; j < kws.length; j++) {
      const w = kws[j];
      if (!w) continue;
      let p = text.indexOf(w), n = 0;
      /* 每词每块封顶 30 次：BM25 本身会饱和，这层只是不让一段刷屏的块白耗扫描 */
      while (p !== -1 && n < 30) { n++; if (first < 0 || p < first) first = p; p = text.indexOf(w, p + w.length); }
      if (!n) continue;
      if (!tf) tf = Object.create(null);
      tf[w] = n;
      df[w] = (df[w] || 0) + 1;
    }
    if (tf) hits[i] = { tf: tf, first: first, len: text.length };
  }
  const avgdl = (lenSum / N) || 1;
  const out = [];
  for (let i = 0; i < N; i++) {
    const h = hits[i];
    if (!h) continue;
    let score = 0;
    for (const w in h.tf) {
      const n = h.tf[w], d = df[w] || 1;
      /* Robertson-Warren 的宽松 IDF：df=N 时给 0 而不是负数——全书都有的词不该反扣分 */
      const idf = Math.log(1 + (N - d + 0.5) / (d + 0.5));
      score += idf * (n * (K1 + 1)) / (n + K1 * (1 - B + B * h.len / avgdl));
    }
    if (score > 0) out.push({ ch: chunks[i].ch, off: chunks[i].off, first: h.first, score: score, len: h.len });
  }
  out.sort(function (a, x) { return x.score - a.score; });
  return out;
};
BF.ai.retrieve = async function (b, question, maxChapters, opts) {
  opts = opts || {};
  /* Agent 停止后立即退出检索，避免继续跑满 CAP 章空耗 IDB 读取 */
  if (opts.signal && opts.signal.aborted) return [];
  if (!b) return [];
  const kws = BF.ai._keywords(question);
  if (!kws.length) return [];
  const cur = BF.appState.currentChapterIdx || 0;
  /* 分块索引上打分（本地、无网络），命中块按章归并，同章取最高分块回填原文片段 */
  const chunks = await BF.ai.chunkIdx.build(b, opts);
  const scored = BF.ai._rank(chunks, kws);
  /* 防剧透兜底：索引可能是旧版本（整本）留下的，命中条件修好也管不到已落盘的旧副本。
     召回侧按章号再截一刀，未读章一律不返回。 */
  const _spoiler = BF.settings.get('aiRefBook') !== false;
  const out = [], seen = {};
  for (const s of scored) {
    if (_spoiler && s.ch > cur) continue;
    if (seen[s.ch]) continue;
    seen[s.ch] = true;
    const t = await BF.library.getChapterText(b, s.ch).catch(function () { return ''; });
    if (!t) continue;
    const base = Math.max(0, s.off + s.first - 60);
    out.push({ idx: s.ch, score: s.score, len: t.length, snippet: t.slice(base, base + 460), read: s.ch <= cur });
    if (out.length >= (maxChapters || 3)) break;
  }
  return out;
};
/* ---- Agent 设置建议通道：模型只能「建议」，落地必须用户点头 ----
   安全边界（三层，缺一层都不放行）：
     1) SETTING_ADVICE 白名单：只列外观/阅读/朗读这类无副作用的呈现参数，
        密钥（aiApiKey/mimoApiKey）、PIN（pinHash/pinSalt）、数据面（autoBackup 等）
        与一切删除类操作都不在表里，模型点名也传不进来；
     2) 取值校验：枚举项查表、数值项查区间，越界直接判非法、就地回绝，
        杜绝模型写坏设置（比如把 fontSize 设成 9999）；
     3) 用户授权：弹窗默认全不勾选，必须用户显式点「全部允许」或勾选后确认。
   交互（对应用户需求）：
     · 全部允许    —— 勾选全部并立即落地；
     · 仅允许选中项  —— 只落地勾选行，其余原样保留；
     · 拒绝 / Esc / 超时 —— 一条都不落地，且这不是错误：答复明确告知模型「用户未授权」，
        让它继续正常回答，而不是把整轮 Agent 打断成异常。 */
BF.ai.SETTING_ADVICE = {
  /* 数值项的区间一律取自 BF.settings.RANGES：模型建议的边界与真正生效的夹取边界同源，
     不会出现「放行到 40、读侧夹到 32」这种放行与生效打架。 */
  fontSize:      { cn: '字号',       type: 'num', min: BF.settings.RANGES.fontSize.min, max: BF.settings.RANGES.fontSize.max, step: 1, unit: 'px' },
  lineHeight:    { cn: '行距',       type: 'num', min: BF.settings.RANGES.lineHeight.min, max: BF.settings.RANGES.lineHeight.max, step: 0.1 },
  wordSpacing:   { cn: '字间距',     type: 'num', min: BF.settings.RANGES.wordSpacing.min, max: BF.settings.RANGES.wordSpacing.max, step: 0.5, unit: 'px' },
  paraSpacing:   { cn: '段间距',     type: 'num', min: BF.settings.RANGES.paraSpacing.min, max: BF.settings.RANGES.paraSpacing.max, step: 0.1 },
  brightness:    { cn: '亮度',       type: 'num', min: BF.settings.RANGES.brightness.min, max: BF.settings.RANGES.brightness.max, step: 5, unit: '%' },
  /* 主题与外观模式共用单键 appearance（无纸鸢档）：枚举只能从登记表生成 */
  appearance:    { cn: '外观模式',   type: 'enum', opts: BF.skin.opts() },
  accent:        { cn: '强调色',     type: 'enum', opts: [['red', '朱砂'], ['amber', '赭黄'], ['green', '松绿'], ['blue', '黛蓝']] },
  warmth:        { cn: '色温',       type: 'enum', opts: [['off', '关闭'], ['mild', '微暖'], ['warm', '暖'], ['dusk', '黄昏']] },
  readerFilter:  { cn: '阅读滤镜',   type: 'enum', opts: [['none', '标准'], ['sepia', '纸色'], ['paper', '纸感'], ['night', '夜间'], ['clean-white', '纯白'], ['clean-black', '纯净黑']] },
  readerMargin:  { cn: '页边距',     type: 'enum', opts: [['narrow', '窄'], ['normal', '标准'], ['wide', '宽']] },
  readerMode:    { cn: '阅读模式',   type: 'enum', opts: [['scroll', '滚动'], ['page', '分页']] },
  fontFamily:    { cn: '字体',       type: 'enum', opts: [['sans', '无衬线'], ['serif', '衬线'], ['kai', '楷体']] },
  justify:       { cn: '两端对齐',   type: 'bool', yes: '开启', no: '关闭' },
  noIndent:      { cn: '首行缩进',   type: 'bool', yes: '关闭缩进', no: '保留缩进', invert: true },
  ttsRate:       { cn: '语速',       type: 'num', min: BF.settings.RANGES.ttsRate.min, max: BF.settings.RANGES.ttsRate.max, step: 0.1, unit: '倍' },
  ttsPitch:      { cn: '音调',       type: 'num', min: BF.settings.RANGES.ttsPitch.min, max: BF.settings.RANGES.ttsPitch.max, step: 0.1 },
  ttsVolume:     { cn: '音量',       type: 'num', min: BF.settings.RANGES.ttsVolume.min, max: BF.settings.RANGES.ttsVolume.max, step: 0.05 },
  /* edgeToken 不在模型可建议表里：它今天是微软的公开协议常量，但这一行的说明写着
     「微软换要求时把新值填这里」—— 那一天它就是个人凭据。让模型能改写一个凭据位，
     收益为零、风险不对称。 */
  ttsAutoNext:   { cn: '自动连读',   type: 'bool', yes: '开启', no: '关闭' },
  readGoal:      { cn: '每日阅读目标', type: 'num', min: BF.settings.RANGES.readGoal.min, max: BF.settings.RANGES.readGoal.max, step: 5, unit: '分钟' },
  goalIncludeFocus: { cn: '目标纳入专注', type: 'bool', yes: '开启', no: '关闭' },
  scrollSpeed:   { cn: '滚动速度',   type: 'num', min: BF.settings.RANGES.scrollSpeed.min, max: BF.settings.RANGES.scrollSpeed.max, step: 1 },
  chapterWordCount: { cn: '单章字数', type: 'num', min: BF.settings.RANGES.chapterWordCount.min, max: BF.settings.RANGES.chapterWordCount.max, step: 500, unit: '字' },
  aiSummaryLevel: { cn: '摘要长度',  type: 'enum', opts: [['brief', '简要'], ['standard', '标准'], ['detail', '详细']] },
};
/* 白名单外的键统一回绝。显式列出被拒的敏感键是为了让拒绝理由更清楚，
   也顺带把「模型会不会碰密钥」这件事写成可测断言。 */
BF.ai.SETTING_DENY = ['aiApiKey', 'mimoApiKey', 'pinHash', 'pinSalt', 'pinLock', 'aiLock', 'aiEndpoint',
  'autoBackup', 'chapterRegex', 'encoding', 'aiProvider', 'aiModel', 'captureLog', 'captureLogDays', 'consoleEcho',
  /* Edge 的两个协议位：默认值内置且由闸门③ 逐字节守护，模型改写它们没有使用场景，
     却在「用户把个人 token 填进这一行」之后变成一条由模型驱动的凭据写入路径。 */
  'edgeToken', 'edgeSecVer'];
/* 把模型给的字符串值转成与现有设置同类型的真值。
   设置项类型混杂（数字/布尔/字符串），不转换就会把 "18" 写进数字项，
   后面 range 控件与样式计算会静默失效。 */
BF.ai.coerceSetting = function (k, raw) {
  const spec = BF.ai.SETTING_ADVICE[k];
  if (!spec) return { ok: false, reason: 'not_allowed' };
  let v = raw;
  if (spec.type === 'num') {
    const n = parseFloat(v);
    if (!isFinite(n)) return { ok: false, reason: 'not_number' };
    v = spec.step >= 1 ? Math.round(n) : Math.round(n / spec.step) * spec.step;
    v = Math.min(spec.max, Math.max(spec.min, v));
    v = spec.step >= 1 ? Math.round(v) : Math.round(v * 1000) / 1000;
  } else if (spec.type === 'bool') {
    const s = String(v).trim().toLowerCase();
    if (['true', '1', 'on', 'yes', '是', '开'].indexOf(s) !== -1) v = true;
    else if (['false', '0', 'off', 'no', '否', '关'].indexOf(s) !== -1) v = false;
    else return { ok: false, reason: 'not_bool' };
  } else {
    v = String(v);
    /* 枚举既比 value 也比中文标签，模型写「深色」或 dark 都认 */
    const hit = spec.opts.filter(function (o) { return o[0] === v || o[1] === v; })[0];
    if (!hit) return { ok: false, reason: 'not_in_options' };
    v = hit[0];
  }
  return { ok: true, value: v };
};
BF.ai.settingLabel = function (k) {
  const s = BF.ai.SETTING_ADVICE[k];
  if (!s) return k;
  return s.cn + '：' + BF.ai.settingValueLabel(k);
};
/* 单个设置项的「友好值」：枚举查中文名、布尔查开/关文案、数值带单位。
   建议弹窗与答复共用，保证「弹窗里看到的」与「答复里说的」是同一套话术。 */
BF.ai.settingValueLabel = function (k, v) {
  const s = BF.ai.SETTING_ADVICE[k];
  if (!s) return String(v == null ? '' : v);
  if (v === undefined) v = BF.settings.get(k);
  if (s.type === 'enum') {
    const hit = s.opts.filter(function (o) { return o[0] === String(v); })[0];
    return hit ? hit[1] : String(v);
  }
  if (s.type === 'bool') {
    const on = !!v;
    return (s.invert ? !on : on) ? s.yes : s.no;
  }
  return String(v) + (s.unit || '');
};
/* 解析模型给的建议参数。支持三种写法：
     key=value              单条
     key1=v1;key2=v2        多条（分号或逗号分隔）
     {"key":"v"}            JSON（模型很爱输出这个）
   返回 {ok:[{k,v,spec}], bad:[{k,reason,raw}]} */
BF.ai.parseAdvice = function (arg) {
  const out = { ok: [], bad: [] };
  const push = function (k, v) {
    k = String(k || '').trim();
    if (!k) return;
    if (BF.ai.SETTING_DENY.indexOf(k) !== -1) return out.bad.push({ k: k, reason: 'denied', raw: v });
    const c = BF.ai.coerceSetting(k, v);
    if (c.ok) out.ok.push({ k: k, v: c.value, spec: BF.ai.SETTING_ADVICE[k] });
    else out.bad.push({ k: k, reason: c.reason, raw: v });
  };
  const s = String(arg == null ? '' : arg).trim();
  if (!s) return out;
  if (s.charAt(0) === '{') {
    try {
      const o = JSON.parse(s);
      if (o && typeof o === 'object') { for (const k in o) push(k, o[k]); return out; }
    } catch (e) { /* 落到下面按分隔符解析 */ }
  }
  s.split(/[;；\n]+/).forEach(function (part) {
    part.trim().split(/\s*[,，]\s*/).forEach(function (kv) {
      const i = kv.indexOf('=');
      if (i <= 0) { if (kv.trim()) out.bad.push({ k: kv.trim(), reason: 'no_equals', raw: '' }); return; }
      push(kv.slice(0, i), kv.slice(i + 1));
    });
  });
  return out;
};
/* 弹建议清单，返回 Promise<{applied:[{k,v}], rejected:[{k}]}>。
   默认一个都不勾——用户要的是「建议」，不是「默认接受」。 */
BF.ai.showAdvice = function (items, opts) {
  opts = opts || {};
  return new Promise(function (resolve) {
    const rows = items.map(function (it, i) {
      /* 用 div 不用 label：label 包裹 input 时浏览器会自动切换勾选状态，
         再叠一行「点整行切换」的 handler 就会二次反转，表现为点了没反应。 */
      return '<div class="adv-row" data-adv-row="' + i + '" style="display:flex;align-items:center;gap:10px;padding:8px 10px;border:1px solid var(--border);border-radius:8px;margin-bottom:6px;cursor:pointer">' +
        /* 宽高走 CSS 类 .bf-check，内联 15px 值会压掉自绘尺寸。
           字符串拼接行的注释内不允许出现行尾 `+`：上一行行尾的 `+` 与本行
           行尾的 `+` 被注释隔开后仍相邻（注释对词法只是空白），构成 `A + + B`，
           被解析为 `A + (+B)`——一元 `+` 把后面整段 HTML 转成 NaN，
           整行只剩 `<div class="adv-row">NaN`，复选框与文案全部消失。 */
        '<input type="checkbox" class="bf-check" data-adv-pick="' + i + '" aria-label="' + BF.dom.escAttr(it.spec.cn) + '"/>' +
        '<span style="flex:1;min-width:0">' +
          '<span style="display:block;font-size:13px;color:var(--text)">' + BF.dom.esc(it.spec.cn) +
            ' <code style="opacity:.55;font-size:11px">' + BF.dom.esc(it.k) + '</code></span>' +
          '<span style="display:block;font-size:11px;color:var(--text-weak)">' +
            '当前 ' + BF.dom.esc(BF.ai.settingValueLabel(it.k)) + ' → 建议 ' + BF.dom.esc(BF.ai.settingValueLabel(it.k, it.v)) +
          '</span>' +
        '</span></div>';
    }).join('');
    /* 渲染断言：行模板若再被改动（如字符串拼接行的注释末尾
       混入 `+`，形成 `A + + B` 被解析为 `A + (+B)` → 整行 NaN），
       复选框锚点必须仍在——否则「仅允许选中项 / 全部允许」
       恒等于空选择，「模型只能建议、落地必须用户点头」的安全边界
       在 UI 层失效。 */
    if (items.length && rows.indexOf('data-adv-pick') < 0) {
      BF.err.report('ai.showAdvice', new Error('渲染断言失败：advice rows 缺少 data-adv-pick'));
    }
    const body =
      '<div style="font-size:12px;color:var(--text-dim);margin-bottom:10px;line-height:1.6">' +
        BF.dom.esc(opts.reason || '阅读助手想调整以下设置，请挑选你认可的项。') +
        '<br><span style="color:var(--text-weak)">未勾选的一律不会改动。</span></div>' +
      '<div id="adv-list" style="max-height:44vh;overflow:auto">' + rows + '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;flex-wrap:wrap">' +
        '<button class="btn btn-sm" data-bk-cancel>全部拒绝</button>' +
        '<button class="btn btn-sm" data-adv-picked>仅允许选中项</button>' +
        '<button class="btn btn-sm primary" data-adv-all>全部允许</button>' +
      '</div>';
    let settled = false;
    const finish = function (picks) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { dismiss(); } catch (e) {}
      BF.modal.hide();
      const applied = [], rejected = [];
      items.forEach(function (it, i) {
        if (picks && picks.indexOf(i) !== -1) {
          try { BF.settings.set(it.k, it.v); applied.push({ k: it.k, v: it.v }); }
          catch (e) { BF.err.report('agent.advice.apply', e); rejected.push({ k: it.k }); }
        } else rejected.push({ k: it.k });
      });
      if (applied.length) {
        BF.noti && BF.noti.success('已按你的选择调整 ' + applied.length + ' 项设置');
        /* 设置面板开着就直接反映出来；没开则等下次打开 */
        try { if (BF.settingsUI && BF.settingsUI.render) BF.settingsUI.render(); } catch (e) { BF.err.report('render.settingsUI', e); }
      }
      resolve({ applied: applied, rejected: rejected });
    };
    const picked = function () {
      const out = [];
      document.querySelectorAll('[data-adv-pick]').forEach(function (c) {
        if (c.checked) out.push(parseInt(c.getAttribute('data-adv-pick'), 10));
      });
      return out;
    };
    /* 无操作时自动按「拒绝」收场：弹窗不能无限期挂着把 Agent 流程卡死 */
    const timer = setTimeout(function () { finish(null); }, BF.CONFIG.AGENT_ADVICE_TTL);
    const dismiss = BF.modal.custom(opts.title || '助手想调整这些设置', body, function (box) {
      box.querySelector('[data-adv-all]').onclick = function () { finish(items.map(function (_, i) { return i; })); };
      box.querySelector('[data-adv-picked]').onclick = function () { finish(picked()); };
      box.querySelector('[data-bk-cancel]').onclick = function () { finish(null); };
      /* 点整行也能勾选，减少点中小复选框的难度 */
      box.querySelectorAll('[data-adv-row]').forEach(function (row) {
        row.addEventListener('click', function (e) {
          if (e.target.tagName === 'INPUT') return;
          const c = row.querySelector('[data-adv-pick]');
          if (c) { c.checked = !c.checked; }
        });
      });
    });
  });
};
/* 建议通道总入口：解析 → 弹窗 → 返回给模型的文字答复。
   无论用户怎么选都 resolve（不 reject），Agent 循环据此继续，不会因授权被拒而崩。 */
BF.ai.adviseSettings = function (arg) {
  const parsed = BF.ai.parseAdvice(arg);
  const cap = BF.CONFIG.AGENT_ADVICE_MAX;
  let ok = parsed.ok;
  let dropped = 0;
  if (ok.length > cap) { dropped = ok.length - cap; ok = ok.slice(0, cap); }
  const REASON = { denied: '涉及密钥或安全设置，不允许 AI 修改', not_number: '建议值不是数字', not_bool: '建议值不是开关', not_in_options: '建议值不在可选范围', no_equals: '格式无法解析（应为 键=值）' };
  if (!ok.length) {
    const why = parsed.bad.map(function (b) { return b.k + '（' + (REASON[b.reason] || b.reason) + '）'; }).join('、');
    return Promise.resolve('未提交任何设置建议：' + (why || '没有解析出 键=值 形式的建议') +
      '。请改用 [[tool:adviseSettings:fontSize=20]] 这样的格式，或直接用文字回答。');
  }
  /* 同键多条建议只留最后一条，避免弹窗里出现自相矛盾的两行 */
  const seen = {};
  const items = [];
  for (let i = ok.length - 1; i >= 0; i--) {
    if (seen[ok[i].k]) continue;
    seen[ok[i].k] = 1;
    items.unshift(ok[i]);
  }
  return BF.ai.showAdvice(items, {}).then(function (r) {
    const parts = [];
    /* 答复用友好值（与弹窗同一套话术）：模型看到「字号：22px」比「fontSize=22」更好理解 */
    if (r.applied.length) {
      parts.push('用户已允许并应用：' + r.applied.map(function (a) { return BF.ai.settingLabel(a.k).split('：')[0] + '=' + BF.ai.settingValueLabel(a.k, a.v); }).join('、'));
    }
    if (r.rejected.length) {
      parts.push('用户未授权：' + r.rejected.map(function (a) { return BF.ai.settingLabel(a.k); }).join('、') + '（设置保持原样，请勿在回答里声称已修改）');
    }
    if (parsed.bad.length) parts.push('被拒绝的非法建议：' + parsed.bad.length + ' 条（' + (REASON[parsed.bad[0].reason] || '不合法') + '）');
    if (dropped) parts.push('超出上限已忽略 ' + dropped + ' 条');
    return parts.join('\n');
  });
};

/* 存储方案授权弹窗（applyStoragePlan 专用）。
   与 showAdvice 分开：那是标量设置表，这里要写的是 storageAlloc/mirrorKeys 两个对象表，
   且承重键只能改镜像、不能改主存。逐项列「当前 → 建议」，只写用户勾选的项；
   未勾选一律不动；确认后不自动迁移（迁移仍由用户在存储面板点「立即迁移」）。
   无论用户怎么选都 resolve 出给模型的文字，Agent 循环不会因拒绝而崩。 */
BF.ai.showStoragePlan = function () {
  return Promise.resolve().then(function () { return BF.store.planStorage(); }).then(function (plan) {
    return new Promise(function (resolve) {
    const ctx = plan.context;
    const MODE = { auto: '自动', idb: 'IndexedDB', opfs: 'OPFS', ls: '本地存储', legacy: '原层' };
    const CAT = { body: '正文', chapters: '章节缓存', audio: '朗读音频缓存', aiSummary: 'AI 摘要缓存', chunkIdx: '问书索引',
      bookmarks: '书签镜像', highlights: '划线镜像', notes: '便签镜像', vocab: '生词镜像', reading_state: '阅读进度镜像', perbook_prefs: '随书偏好镜像' };
    /* 构造逐项：alloc 项写 storageAlloc[cat]，mirror 项写 mirrorKeys[cat]。
       每项带 kind/key/target，勾选后在 finish 里按 kind 分别落到两个对象表。 */
    const items = [];
    (BF.store.ALLOC_CATEGORIES || []).forEach(function (cat) {
      items.push({ kind: 'alloc', key: cat, cur: BF.store.allocOf(cat), target: plan.alloc[cat], label: CAT[cat] || cat, why: plan.reasons[cat] || '' });
    });
    (BF.store.MIRROR_CATEGORIES || []).forEach(function (cat) {
      items.push({ kind: 'mirror', key: cat, cur: BF.store.mirrorOf(cat), target: plan.mirror[cat], label: CAT[cat] || cat, why: plan.reasons[cat] || '' });
    });
    const fmt = function (v) { return v === true ? '留镜像' : v === false ? '不留镜像' : (MODE[v] || String(v)); };
    const rows = items.map(function (it, i) {
      return '<div class="adv-row bf-sp-itemrow" data-sp-row="' + i + '">' +
        '<input type="checkbox" class="bf-check" data-sp-pick="' + i + '" aria-label="' + BF.dom.escAttr(it.label) + '"/>' +
        '<span class="bf-sp-itemmain">' +
          '<span class="bf-sp-itemlabel">' + BF.dom.esc(it.label) +
            ' <code class="bf-sp-keycode">' + BF.dom.esc(it.key) + '</code></span>' +
          '<span class="bf-sp-itemshift">当前 ' + BF.dom.esc(fmt(it.cur)) + ' → 建议 ' + BF.dom.esc(fmt(it.target)) + '</span>' +
          '<span class="bf-sp-itemwhy">' + BF.dom.esc(it.why) + '</span>' +
        '</span></div>';
    }).join('');
    if (items.length && rows.indexOf('data-sp-pick') < 0) {
      BF.err.report('ai.showStoragePlan', new Error('渲染断言失败：方案行缺少 data-sp-pick'));
    }
    const body =
      '<div class="bf-sp-plantip">' +
        '助手按各区剩余容量（本地存储余 ' + Math.round((ctx.lsFreeBytes || 0) / 1024) + ' KB / IndexedDB·OPFS 余 ' + Math.round((ctx.originFreeBytes || 0) / 1024) + ' KB' +
        '，水位 ' + BF.dom.esc(ctx.quotaLevel) + '）生成了下面的最优方案——能装下的往空区导、装不下的大内容回落。请勾选你认可的项；<b>未勾选的一律不改</b>。' +
        '<br>承重键只决定是否额外留 IndexedDB 镜像，<b>主存始终在本地存储同步读，不受影响</b>。' +
        '<br>应用后不会自动搬迁旧数据；如需把已有内容搬到新区，请到「设置 → 数据 → 存储分配」点「立即迁移」。' +
        '<br><span class="bf-sp-plannote">正文可进本地存储，但仅限单本装得下时（尺寸闸门自动兜底，绝不超 5MB 撞假成功）；问书索引只有 IndexedDB 一种实现。</span></div>' +
      '<div id="sp-list" class="bf-sp-splist">' + rows + '</div>' +
      '<div class="bf-sp-planbar">' +
        '<button class="btn btn-sm" data-sp-cancel>全部拒绝</button>' +
        '<button class="btn btn-sm" data-sp-picked>仅应用选中项</button>' +
        '<button class="btn btn-sm primary" data-sp-all>全部应用</button>' +
      '</div>';
    let settled = false;
    const finish = function (picks) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { dismiss(); } catch (e) {}
      BF.modal.hide();
      const applied = [], rejected = [];
      const nextAlloc = {}, nextMirror = {};
      let hasAlloc = false, hasMirror = false;
      items.forEach(function (it, i) {
        if (picks && picks.indexOf(i) !== -1) {
          if (it.kind === 'alloc') { nextAlloc[it.key] = it.target; hasAlloc = true; }
          else { nextMirror[it.key] = it.target; hasMirror = true; }
          applied.push(it.label);
        } else rejected.push(it.label);
      });
      /* 只在有勾选时写对应对象表：用 Object.assign 合并现状，不动未勾选的项。 */
      if (hasAlloc) {
        let cur = {}; try { cur = BF.settings.get('storageAlloc') || {}; } catch (e) {}
        BF.settings.set('storageAlloc', Object.assign({}, cur, nextAlloc));
      }
      if (hasMirror) {
        let cur = {}; try { cur = BF.settings.get('mirrorKeys') || {}; } catch (e) {}
        BF.settings.set('mirrorKeys', Object.assign({}, cur, nextMirror));
      }
      if (applied.length) {
        BF.noti && BF.noti.success('已按你的选择应用 ' + applied.length + ' 项存储设置（旧数据未搬迁）');
        try { if (BF.settingsUI && BF.settingsUI.render) BF.settingsUI.render(); } catch (e) { BF.err.report('render.settingsUI.plan', e); }
      }
      resolve('用户已' + (applied.length ? ('应用 ' + applied.length + ' 项：' + applied.join('、')) : '拒绝全部建议') +
        (rejected.length && applied.length ? ('；未授权 ' + rejected.length + ' 项（保持原样）') : '') +
        '。设置已生效于新写入；迁移旧数据需用户另行确认。请勿在收到本回执前声称方案已应用。');
    };
    const picked = function () {
      const out = [];
      document.querySelectorAll('[data-sp-pick]').forEach(function (c) {
        if (c.checked) out.push(parseInt(c.getAttribute('data-sp-pick'), 10));
      });
      return out;
    };
    const timer = setTimeout(function () { finish(null); }, BF.CONFIG.AGENT_ADVICE_TTL);
    const dismiss = BF.modal.custom('应用存储优化方案', body, function (box) {
      box.querySelector('[data-sp-all]').onclick = function () { finish(items.map(function (_, i) { return i; })); };
      box.querySelector('[data-sp-picked]').onclick = function () { finish(picked()); };
      box.querySelector('[data-sp-cancel]').onclick = function () { finish(null); };
      box.querySelectorAll('[data-sp-row]').forEach(function (row) {
        row.addEventListener('click', function (e) {
          if (e.target.tagName === 'INPUT') return;
          const c = row.querySelector('[data-sp-pick]');
          if (c) c.checked = !c.checked;
        });
      });
    });
    });
  }).catch(function (e) { return '生成方案失败：' + (e && e.message || e); });
};

/* Agent 工具循环执行器，由「Agent 模式」卡片驱动。
   协议：模型输出里含 [[tool:名称:参数]] 就执行该工具，把结果回灌后继续，最多 3 轮。
   安全约束：工具名必须在 BF.ai.tools 白名单内（不可用任意属性路径），
   工具抛错不中断整体流程；支持 AbortSignal 中止。 */
BF.ai.AGENT_MAX_LOOP = BF.CONFIG.AGENT_MAX_LOOP;
/* Agent 的系统提示词只有这一份：AI 中心那张 Agent 卡与终端 agent 动词共用
   （工具协议、设置建议、以及「没拿到工具结果前不许说已改好」这条底线）。 */
BF.ai.agentSystemPrompt = function (bookName) {
  const tools = (BF.ai.AGENT_TOOLS || Object.keys(BF.ai.tools || {})).slice();
  const adviceKeys = Object.keys(BF.ai.SETTING_ADVICE || {}).join('、');
  const G = [
    ['阅读导航', 'getBook、gotoChapter(1基章号)、nextChapter、prevChapter、getChapterText(可给字数上限)、getChapterMeta、getToc、getProgress、openDrawer(目录/书签/笔记/生词/搜索/标注)、closeDrawer、toggleMicroread、findInPage(词)、searchBook(词)、searchAcrossBooks(词)、gotoPage(1基页码)、updateRemain'],
    ['标注便签', 'addNote(文本)、addBookmark、addVocab(词)、listAnnotations(hl划线/bm书签/note便签/vocab生词)、removeNote(id)、listNoteTags'],
    ['书籍书架', 'listBooks、openBook(id或书名)、closeReader、continueRead、goPage(home/bookshelf/notes/mine/reader)、toggleStar、togglePin、renameBook、tagBook、listTags、filterTag、clearShelfFilters、setShelfView(grid/list)、deleteBook、exportBook、resplitBook'],
    ['导入导出备份', 'importFile、importClipboard、importURL(链接)、promptImportURL、backupNow、exportBackup、listBackups、restoreBackup(序号)、exportAllBooks、exportNotes(md/csv/w3c)、importAnnotations、exportAskHistory、selfPackage'],
    ['回收站撤销', 'listTrash、restoreTrash(id或书名)、purgeTrash(id)、emptyTrash、undo、undoCount'],
    ['外观设置场景', 'cycleTheme、setTheme(名称)、listThemes、applyScene(名称)、listScenes、adviseSettings(键=值)、getSettings、fontUp、fontDown、lineHeightUp、lineHeightDown、toggleFocus、toggleNoise、toggleStats'],
    ['朗读工具面板', 'speak、stopSpeak、pauseSpeak、resumeSpeak、ttsStatus、getStats、autoScrollToggle、openPanel(settings/noti/workbench/base/diag/help/ai/terminal/notes/ann)、chapterManager、openTrash'],
    ['存储规划', 'planStorage（只读，规划正文等各类内容的最优落点并给出理由，不写盘）、applyStoragePlan（把规划交给用户逐项勾选授权后才写入；未勾选不改；不自动搬迁旧数据）'],
  ];
  const groupText = G.map(function (g) { return '【' + g[0] + '】' + g[1]; }).join('\n');
  return '你是《' + (bookName || '当前书') + '》的阅读助手，可以调用本地工具完成几乎所有用户在界面上能做的操作。' +
    '需要工具时，只输出 [[tool:工具名:参数]] 这一段（一次一个；参数可省略，多项用 | 分隔）。' +
    '拿到工具结果后继续回答用户问题，最终用中文给出完整答复。\n' +
    '可用工具共 ' + tools.length + ' 个，按组（括号内是参数含义）：\n' + groupText + '\n' +
    '工具名清单：' + tools.join('、') + '。\n' +
    '若用户抱怨排版、字号、主题、语速等阅读体验，可用 [[tool:adviseSettings:键=值]] 提建议（分号分隔）。' +
    '可建议的键有：' + adviceKeys + '。' +
    '如果用户问「正文该放哪」「怎么分配存储最合理」「帮我优化存储」，用 [[tool:planStorage]] 生成方案（只读、不改动），' +
    '把各类落点与理由讲给用户听；用户明确认可后再用 [[tool:applyStoragePlan]] 弹窗让他逐项勾选授权。' +
    'planStorage/applyStoragePlan 遵守红线：正文绝不进纯本地存储、承重键主存恒本地存储只配镜像，应用后旧数据不会自动搬迁。' +
    '这只是建议，会弹窗让用户勾选授权，用户可能全部拒绝；' +
    '所以在收到「已应用」之前，回答里绝不能说「已帮你改好设置」或「方案已生效」。' +
    '删除书籍、清空回收站、彻底删除、恢复备份、重新分章等破坏操作与导入导出都会沿用界面原有的确认框/文件框，' +
    '工具只负责触发，不会替用户点确认；工具回执说「未成功」时必须如实转达，不许说成已办妥。';
};
BF.ai.agentRun = async function (messages, opt) {
  opt = opt || {};
  const setResult = opt.setResult || function () {};
  let msgs = messages.slice();
  /* token 预算 + 工具重复调用环检测。
     两条终止都走「可解释终止」——把原因作为一条 user 消息注入对话，
     再调一次 gateway 让模型自己收尾给出最终回答，而不是在循环里硬切
     （硬切的结果是模型停在半句话上，用户看到的是「答非所问的残句」，
     且不知道发生了什么）。 */
  const _budget = BF.CONFIG.AGENT_TOKEN_BUDGET || 20000;
  const _repLimit = BF.CONFIG.AGENT_REPEAT_LIMIT || 3;
  let _used = 0;
  let _usageMissing = false;      /* usage 字段读不到时置位，只 warn 一次 */
  const _sigs = {};               /* 工具签名 → 连续次数 */
  /* 网关返回的用量字段各家不一致：OpenAI 兼容是 usage.total_tokens，
     部分中转只给 totalTokens。两者都读不到时按 0 计但**必须留痕** ——
     静默当 0 会让预算彻底形同虚设（永远触发不了），用户无从发现。 */
  const _readUsage = function (out) {
    const u = out && out.usage;
    if (!u) { _usageMissing = true; return 0; }
    const n = (typeof u.total_tokens === 'number' ? u.total_tokens
      : (typeof u.totalTokens === 'number' ? u.totalTokens : null));
    if (n === null) { _usageMissing = true; return 0; }
    return n;
  };
  const _stop = async function (reason) {
    BF.log && BF.log.warn('agentRun 终止：' + reason + '（已用 ' + _used + ' token）');
    msgs = msgs.concat([{ role: 'user', content: reason + '\n不要再调用工具，请基于目前已有信息直接给出最终回答。' }]);
    const last = await BF.ai.gateway.call(msgs, { stream: false, signal: opt.signal });
    const finalText = (last && last.content) || '';
    try { setResult(finalText); } catch (e) {}
    return finalText;
  };
  for (let loop = 0; loop < BF.ai.AGENT_MAX_LOOP; loop++) {
    const out = await BF.ai.gateway.call(msgs, { stream: false, signal: opt.signal });
    _used += _readUsage(out);
    if (_usageMissing && !BF.log._agentUsageWarned) {
      try { BF.log._agentUsageWarned = true; BF.log.warn('agentRun：网关未返回 usage（total_tokens / totalTokens 均缺失），token 预算按 0 计 —— 预算可能无法触发'); } catch (e) {}
    }
    if (_used > _budget) return await _stop('已超出本次问答的 token 预算（' + _used + ' > ' + _budget + '）');
    const content = (out && out.content) || '';   /* 网关两种传输形态同形，读 .content */
    if (!content) break;
    try { setResult(content); } catch (e) {}
    const m = content.match(/\[\[tool:([a-zA-Z_][\w]*):([^\]]*)\]\]/);
    if (!m) return content;
    const name = m[1];
    /* 白名单校验：必须同时满足「是自己拥有的工具函数」与「在 AGENT_TOOLS 名单内」 */
    const allowed = BF.ai.AGENT_TOOLS.indexOf(name) !== -1;
    const fn = (allowed && Object.prototype.hasOwnProperty.call(BF.ai.tools, name)) ? BF.ai.tools[name] : null;
    if (typeof fn !== 'function') {
      msgs = msgs.concat([
        { role: 'assistant', content: content },
        { role: 'user', content: '工具结果：不存在工具 ' + name + '。请直接给出最终回答。' },
      ]);
      continue;
    }
    let result;
    /* 同工具同参数连续调用检测：模型陷入「查了再查同样的东西」的死循环时，
       每轮都是一次真实计费。签名取工具名 + 前 120 字参数（截断避免超长
       参数让签名各不相同而检不出重复）。计数连续，中途换了参数即归零。 */
    const _sig = name + ':' + String(m[2] || '').slice(0, 120);
    _sigs[_sig] = (_sigs[_sig] || 0) + 1;
    if (_sigs[_sig] > _repLimit) {
      return await _stop('检测到重复调用同一工具「' + name + '」连续 ' + _sigs[_sig] + ' 次，判定为调用环路');
    }
    /* 必须 await：建议通道要等用户在弹窗里点选，是 Promise。
       不 await 的话会走 JSON.stringify(Promise) 得到 "{}"，
       模型收到空结果就会以为设置已生效，然后对着没生效的界面胡说。 */
    try { result = await fn(m[2]); } catch (e) { result = '工具调用失败：' + (e && e.message || e); }
    try { result = typeof result === 'string' ? result : JSON.stringify(result); } catch (e) { result = String(result); }
    msgs = msgs.concat([
      { role: 'assistant', content: content },
      { role: 'user', content: '工具结果：' + String(result).slice(0, 1000) + '\n请继续（若任务完成，直接给出最终回答）' },
    ]);
  }
  const last = await BF.ai.gateway.call(msgs, { stream: false, signal: opt.signal });
  const finalText = (last && last.content) || '';  /* 网关已同形化为 .content，读 choices 是失效路径（答复恒为空） */
  try { setResult(finalText); } catch (e) {}
  return finalText;
};

