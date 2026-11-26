/* ================= L12. 标签系统 ================= */
BF.library.allTags = function () {
  const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
  const set = new Set();
  books.forEach(b => (b.tags || []).forEach(t => set.add(t)));
  return [...set].sort();
};
BF.library.applyTagFilter = function (tag) {
  BF.library.__tagFilter = tag || '';
  BF.app.renderBookshelf();
};
BF.library.applyGroupFilter = function (gid) {
  BF.library.__groupFilter = gid || '';
  /* 记下档名：悬空对账（reconcileFilters）触发时分组对象已不存在，拿不到名字，
     没有这份快照就只能对用户说「分组 grp_1792… 失效」。 */
  BF.library.__groupFilterName = gid ? ((BF.shelf.groups().find(function (g) { return g && g.id === gid; }) || {}).name || '') : '';
  BF.app.renderBookshelf();
};
/* 清除书架的筛选与搜索。走「改控件值 + 派发 change」而不是直接写 __tagFilter：
   筛选条的可见标签由 BF.select 在 change 上同步，直接写状态会把下拉留在旧值上，
   变成「显示着标签X、其实已经清掉了」的名实不符。 */
BF.library.clearShelfFilters = function (opts) {
  const o = opts || {};
  let touched = false;
  const reset = function (id) {
    const el = document.getElementById(id);
    if (!el || el.value === '') return;
    el.value = '';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    touched = true;
  };
  if (o.tag !== false) reset('tag-filter');
  if (o.group !== false) reset('group-filter');
  if (o.search !== false) {
    const s = document.getElementById('book-search');
    if (s && s.value !== '') { s.value = ''; touched = true; }
  }
  if (!touched) { BF.library.__tagFilter = ''; BF.library.__groupFilter = ''; BF.library.__groupFilterName = ''; }
  BF.app.renderBookshelf();
  return touched;
};
/* 分组下拉的选项由归属表实时算出：只在「非空」的组里出现，
   刚建的空组不该在筛选条里占一格——它该出现在「分组管理」里。
   例外：当前正按它筛选时，即便空了也保留选项——否则触发器显示「全部分组」
   而内部仍在按该组筛（0 本），名实不符且没有清除入口。 */
BF.library.refreshGroupFilter = function () {
  const sel = document.getElementById('group-filter');
  if (!sel) return;
  const cur = BF.library.__groupFilter;
  const gs = BF.shelf.groups().filter(function (g) { return BF.shelf.countOf(g.id) > 0 || g.id === cur; });
  sel.innerHTML = '<option value="">全部分组</option>' +
    gs.map(function (g) { return '<option value="' + BF.dom.escAttr(g.id) + '"' + (g.id === cur ? ' selected' : '') + '>' + BF.dom.esc(g.name) + ' · ' + BF.shelf.countOf(g.id) + '</option>'; }).join('');
  try { BF.app.sel.enhance(sel); } catch (e) { BF.err.report('sel.enhance:groupFilter', e); }
};
BF.library.refreshTagFilter = function () {
  const sel = document.getElementById('tag-filter');
  if (!sel) return;
  const cur = BF.library.__tagFilter;
  const tags = BF.library.allTags();
  sel.innerHTML = '<option value="">全部标签</option>' +
    tags.map(t => '<option value="' + BF.dom.escAttr(t) + '"' + (t === cur ? ' selected' : '') + '>' + BF.dom.esc(t) + '</option>').join('');
  /* 重写 innerHTML 后自绘触发器还挂着旧文字：调 sync 同步（enhance 对已增强过的 select 直接早退） */
  try { BF.app.sel.sync(sel); } catch (e) { BF.err.report('sel.sync:tagFilter', e); }
};
BF.library.tagPrompt = function (bookId) {
  const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
  const b = books.find(x => x && x.id === bookId);
  if (!b) return;
  BF.modal.prompt('设置标签', '输入标签（多个用空格分隔）：', { value: (b.tags || []).join(' ') }).then(function (val) {
    if (val == null) return;
    /* R1：表单值在回调外读成局部量，回调内重新 find 改 tags。 */
    const _tags = val.trim() ? val.trim().split(/\s+/) : [];
    BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
      arr = arr || [];
      const _b = arr.find(function (x) { return x && x.id === bookId; });
      if (!_b) return false;
      _b.tags = _tags;
      return arr;
    }).then(function (ok) {
      if (ok === false) { BF.log && BF.log.warn('标签写入失败，书可能已被删除'); BF.noti.warn('标签未保存：这本书可能已被删除，或存储空间不足'); return; }
      BF.app.renderBookshelf(); BF.library.refreshTagFilter();
      BF.noti.success('标签已更新');
    }).catch(function (e) {
      /* 用户主动输入的内容，失败必须给回执：只写 log 等于让人对着界面猜存没存 */
      BF.err.report('book.tags', e);
      BF.noti.warn('标签未保存：' + ((e && e.message) || '未知错误'));
    });
  });
};

/* ============================================================
   北风 · reader 域（一）：三路径渲染 / 进度 / 导航 / 排版
   ============================================================ */
BF.reader = BF.reader || {};

