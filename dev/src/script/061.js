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
/* 标签颜色（墨栖借鉴 #4 颜色编码分类）：注册表存 BF.settings.tagColors（{标签: 色名}），
   与 hlLastColor 同一存放先例——settings 键天然进备份/导出，不新增 K 表键。
   色名与高亮八色同一套（HL_RGB 提供实体色值），卡片色片按 data-tc 上 CSS 类。 */
BF.library.TAG_PALETTE = ['yellow', 'green', 'blue', 'pink', 'orange', 'purple', 'teal', 'slate'];
BF.library.tagColor = function (tag) {
  const m = BF.settings.get('tagColors') || {};
  return m[tag] || '';
};
BF.library.setTagColor = function (tag, color) {
  const m = Object.assign({}, BF.settings.get('tagColors') || {});
  if (color) m[tag] = color; else delete m[tag];
  try { BF.settings.set('tagColors', m); } catch (e) { BF.err.report('tag.color', e); }
};
BF.library.tagPrompt = function (bookId) {
  const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
  const b = books.find(x => x && x.id === bookId);
  if (!b) return;
  /* 用 custom 而非 prompt：要在同一张对话框里放「标签输入 + 颜色色板」。
     色板只对本次新建（尚无颜色）的标签生效，已有颜色的标签保持原色——
     改一个标签的色不该顺手改掉整本书其它标签的色。 */
  const sw = BF.library.TAG_PALETTE.map(function (c) {
    /* 色值走渲染期 el.style 赋值（闸门⑫按源码里的 style 属性字面量计数，棘轮只许降不许升） */
    return '<button type="button" class="tp-sw" data-tp-color="' + c + '" title="' + c + '" aria-label="颜色 ' + c + '"></button>';
  }).join('');
  const body =
    '<div class="tp-label">输入标签（多个用空格分隔）</div>' +
    '<input class="tp-input" data-tp-input value="' + BF.dom.escAttr((b.tags || []).join(' ')) + '">' +
    '<div class="tp-label">给还没有颜色的标签选个色（已有颜色的不变）</div>' +
    '<div class="tp-sw-row">' + sw + '</div>' +
    '<div class="tp-btns"><button class="btn btn-sm" data-tp-cancel>取消</button>' +
    '<button class="btn btn-sm primary" data-tp-ok>确定</button></div>';
  BF.modal.custom('设置标签', body, function (box, dismiss) {
    let color = '';
    box.querySelectorAll('[data-tp-color]').forEach(function (el) {
      el.style.background = (BF.reader.HL_RGB && BF.reader.HL_RGB[el.dataset.tpColor]) || 'rgba(245,212,66,0.85)';
      el.onclick = function () {
        color = el.dataset.tpColor;
        box.querySelectorAll('[data-tp-color]').forEach(function (x) { x.classList.toggle('is-cur', x === el); });
      };
    });
    const _cancel = box.querySelector('[data-tp-cancel]');
    if (_cancel) _cancel.onclick = function () { dismiss(); };
    const _ok = box.querySelector('[data-tp-ok]');
    const _input = box.querySelector('[data-tp-input]');
    const _save = function () {
      const val = _input ? _input.value : '';
      const _tags = val.trim() ? val.trim().split(/\s+/) : [];
      dismiss();
      if (color) _tags.forEach(function (t) { if (!BF.library.tagColor(t)) BF.library.setTagColor(t, color); });
      /* R1：表单值在回调外读成局部量，回调内重新 find 改 tags。 */
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
    };
    if (_ok) _ok.onclick = _save;
    if (_input) _input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); _save(); } });
    if (_input) _input.focus();
  }, function () {});
};

/* ============================================================
   北风 · reader 域（一）：三路径渲染 / 进度 / 导航 / 排版
   ============================================================ */
BF.reader = BF.reader || {};

