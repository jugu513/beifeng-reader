/* ================= 书卡动作登记表 =================
   卡面那一排按钮与「菜单 / 右键」两张画面都从这张表出：两处的动作差别只由 onCard 决定，
   两处各抄一份数组必然漂移（加一个动作要改两处、改名也要改两处）。
     id      持久化用的稳定名，写进 BF.settings.bookCardActions
     label   字符串，或 (book) => 字符串：置顶/收藏要按这本书的当前状态改名
     ico     卡面用的 SVG —— 每张都可能被用户放上卡面，所以项项都得有
     onCard  默认可否常驻；用户设定读不到时才回落到它
     danger  菜单里标红
     op      破坏性动作在 BF.act 里的登记名。带 op 的必须继续走 BF.act.run：
             确认框、撤销的计数全挂在那条通道上，绕过去就等于开了第二条通道
     cond    (book) => 布尔；假项两张画面里都不出现（如本书没有待确认的 AI 分章建议）
   「菜单」触发器不在此表内，也不可被收进菜单 —— 把手本身藏进它打开的东西里，
   用户第一次收起就把自己锁在外面了。它由 BF.bookCardActionsHTML 固定生成。 */
BF.BOOK_ACTIONS = [
  { id: 'info',   label: '书籍信息',   onCard: false,
    ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="9"></circle><line x1="12" y1="11" x2="12" y2="16"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>',
    run: function (id) { BF.enh.showBookInfo(id); } },
  { id: 'open',   label: '打开',       onCard: false,
    ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2 0 0 1 6.5 2z"></path></svg>',
    run: function (id) { BF.app.openBook(id); } },
  { id: 'pin',    label: function (b) { return b && b.pinned ? '取消置顶' : '置顶'; }, onCard: true,
    ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 17v5"></path><path d="M9 11V4h6v7l2 3H7z"></path></svg>',
    run: function (id) { BF.app.togglePin(id); } },
  { id: 'star',   label: function (b) { return b && b.starred ? '取消收藏' : '收藏'; }, onCard: true,
    ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polygon points="12 3 15 9.5 21.5 10.3 16.5 14.8 18 21.3 12 17.9 6 21.3 7.5 14.8 2.5 10.3 9 9.5"></polygon></svg>',
    run: function (id) { BF.app.toggleStar(id); } },
  { id: 'tag',    label: '设置标签',   onCard: false,
    ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20.6 13.4 12 22l-9-9V4h9z"></path><circle cx="7.5" cy="8.5" r="1.2"></circle></svg>',
    run: function (id) { BF.library.tagPrompt(id); } },
  { id: 'group',  label: '加入分组…',  onCard: false,
    ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>',
    run: function (id) { BF.shelf.openPicker([id]); } },
  { id: 'rename', label: '重命名',     onCard: false,
    ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z"></path></svg>',
    run: function (id) { BF.app.renameBook(id); } },
  { id: 'aisplit', label: '查看 AI 分章建议', onCard: false,
    cond: function (b) { return !!(BF.smart && BF.smart._pendingSplit && BF.smart._pendingSplit.bookId === (b && b.id)); },
    ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M12 3l2.4 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.6-.5z"></path></svg>',
    run: function (id, b) { BF.smart.reviewSplitPlan(BF.smart._pendingSplit); } },
  { id: 'export', label: '导出 TXT',   onCard: false,
    ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>',
    /* 导出只读、无可撤对象 ⇒ 不传 undo，但确认与失败提示仍走同一条通道 */
    run: function (id) { BF.act.run('导出 TXT', function () { BF.library.downloadBook(id); }); } },
  { id: 'trash',  label: '移入回收站', onCard: false, danger: true, op: '删除书籍',
    ico: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>',
    /* 软删本身即逆操作（恢复入口在回收站面板）⇒ 不传 undo */
    run: function (id) { BF.act.run('删除书籍', function () { BF.app.deleteBookConfirm(id); }); } },
];
BF.BOOK_CARD_MAX = 3;   /* 卡面 187px 宽、每枚 32px + 缝隙，第三枚起就会压住选择圈 */
BF.bookActionById = function (id) {
  for (const a of BF.BOOK_ACTIONS) if (a.id === id) return a;
  return null;
};
BF.bookActionLabel = function (a, b) { return String(typeof a.label === 'function' ? a.label(b) : a.label); };
/* 常驻集：用户设定（逗号串）优先，认不出的 id 丢掉、重复的只留一次、超出上限截断。
   设定读不到（旧存档 / 未写）才回落到登记表的 onCard 默认。 */
BF.bookCardOnCardIds = function () {
  const raw = BF.settings.get('bookCardActions');
  const src = (raw === undefined || raw === null || raw === '')
    ? BF.BOOK_ACTIONS.filter(function (a) { return a.onCard; }).map(function (a) { return a.id; }).join(',')
    : String(raw);
  const out = [];
  src.split(',').forEach(function (id) {
    const key = id.trim();
    if (key && BF.bookActionById(key) && out.indexOf(key) < 0) out.push(key);
  });
  return out.slice(0, BF.BOOK_CARD_MAX);
};
BF.bookMenuItems = function (b) {
  return BF.BOOK_ACTIONS.map(function (a) {
    if (a.cond && !a.cond(b)) return null;
    return { label: BF.bookActionLabel(a, b), danger: !!a.danger, run: function () { a.run(b.id, b); } };
  }).filter(function (x) { return !!x; });
};
/* 卡面按钮行。菜单触发器固定在最左（与既有排版一致），其余按常驻集顺序。
   按钮只写 data-book-act，实现由事件委托回表里取 —— 卡面不认识任何动作自己该干什么。 */
BF.bookCardActionsHTML = function (b) {
  const menu = '<button data-book-menu="' + BF.dom.escAttr(b.id) + '" title="菜单" aria-label="书籍菜单" aria-haspopup="listbox"><svg viewBox="0 0 24 24" fill="currentColor" stroke="none"><circle cx="5" cy="12" r="1.8"></circle><circle cx="12" cy="12" r="1.8"></circle><circle cx="19" cy="12" r="1.8"></circle></svg></button>';
  const btns = BF.bookCardOnCardIds().map(function (id) {
    const a = BF.bookActionById(id);
    if (a.cond && !a.cond(b)) return '';
    const lab = BF.bookActionLabel(a, b);
    return '<button data-book-act="' + a.id + '" data-book-id="' + BF.dom.escAttr(b.id) + '"' +
      ' title="' + BF.dom.escAttr(lab) + '" aria-label="' + BF.dom.escAttr(lab) + '">' + a.ico + '</button>';
  }).join('');
  return '<div class="actions">' + menu + btns + '</div>';
};

/* 写入常驻集的唯一入口（设置节、书架就地入口、DSL、Agent 建议通道都走这里）。
   三道闸：认不出的 id 丢、重复的只留一次、超出上限拒绝并说明原因 ——
   上限不是审美：卡面 187px 宽、每枚 32px 加缝隙，第四枚会压住左上的选择圈。 */
BF.bookCardActionsSet = function (ids) {
  const raw = Array.isArray(ids) ? ids : String(ids == null ? '' : ids).split(',');
  const clean = [];
  const unknown = [];
  raw.forEach(function (item) {
    const id = String(item == null ? '' : item).trim();
    if (!id) return;
    if (!BF.bookActionById(id)) { unknown.push(id); return; }
    if (clean.indexOf(id) < 0) clean.push(id);
  });
  let reason = '';
  if (clean.length > BF.BOOK_CARD_MAX) {
    reason = '卡面最多常驻 ' + BF.BOOK_CARD_MAX + ' 枚（第四枚会压住卡片左上的选择圈），已保留先选的 ' + BF.BOOK_CARD_MAX + ' 枚。';
    clean.length = BF.BOOK_CARD_MAX;
  }
  BF.settings.set('bookCardActions', clean.join(','));   /* 书架由设置热加载重渲染（卡面动作写在卡片 HTML 里） */
  return { ids: clean, reason: reason, unknown: unknown };
};
/* 两栏挑选器：设置里的「书架」节与书架顶栏的就地入口共用这一份渲染。
   两处出现的是同一个函数返回值，界面不该各写一套 —— 抄第二份就会漂移。
   用「点一下挪过去/挪回来」而不是拖拽：拖拽要另写一套键盘与读屏通路，
   而这项设置的频次很低，点击已经够快。 */
BF.bookActionsPickerHTML = function () {
  const on = BF.bookCardOnCardIds();
  const full = on.length >= BF.BOOK_CARD_MAX;
  const row = function (a, inCard) {
    const lab = BF.bookActionLabel(a, null);
    return '<div class="ba-row" data-ba-row="' + a.id + '">' +
      '<span class="ba-row__ico" aria-hidden="true">' + a.ico + '</span>' +
      '<span class="ba-row__label">' + BF.dom.esc(lab) + (a.danger ? '<span class="ba-row__flag">·危险</span>' : '') + '</span>' +
      '<button class="btn btn-xs" data-ba-' + (inCard ? 'remove' : 'add') + '="' + a.id + '"' +
      (!inCard && full ? ' aria-disabled="true" title="' + BF.dom.escAttr('卡面已满（上限 ' + BF.BOOK_CARD_MAX + ' 枚）') + '"' : '') + '>' +
      (inCard ? '移出卡面' : '放上卡面') + '</button></div>';
  };
  const col = function (ids, title, note) {
    return '<div class="ba-col"><div class="ba-col__h">' + title +
      '<span class="ba-col__n">' + ids.length + '/' + BF.BOOK_CARD_MAX + '</span></div>' +
      (ids.length ? ids.map(function (id) { return row(BF.bookActionById(id), true); }).join('')
                  : '<div class="ba-empty">一枚都没有。卡面只剩「菜单」把手。</div>') +
      (note || '') + '</div>';
  };
  const offIds = BF.BOOK_ACTIONS.filter(function (a) { return on.indexOf(a.id) < 0; });
  return '<div class="ba-picker">' +
    col(on, '卡面常驻', '') +
    '<div class="ba-col"><div class="ba-col__h">不常用<span class="ba-col__n">' + offIds.length + '</span></div>' +
    (offIds.length ? offIds.map(function (a) { return row(a, false); }).join('') : '<div class="ba-empty">都放上卡面了。</div>') +
    '</div>' +
    '<div class="ba-foot">「菜单」把手不参与挑选，它始终在卡面第一枚：收进菜单等于把自己锁在外面。' +
    '带·危险的项放上卡面后每次仍会弹确认，确认与撤销都走同一条通道。</div>' +
    '</div>';
};

/* 挑完一次要把两张画面同时刷新：书架就地入口那块、设置里的「书架」节。
   谁在 DOM 里就刷谁，不在就不去创建 —— 别为了刷新把隐藏的节拉出来。 */
BF.bookActionsRefreshPickers = function () {
  const html = BF.bookActionsPickerHTML();
  const p = document.getElementById('shelf-picker');
  if (p && !p.hidden) p.innerHTML = html;
  if (BF.sheet && BF.sheet.isOpen && BF.sheet.isOpen('settings')) { try { BF.settingsUI.render(); } catch (e) { BF.err.report('bookActions.settingsRender', e); } }
};

/* 书架布局状态（列表 / 密度）的唯一落点：只切网格类，不碰卡片内容。
   设置里改密度、设置广播都走这里——改一个开关不该让整架书重画一遍。 */
BF.app.syncShelfLayout = function () {
  const grid = document.getElementById('books-grid');
  if (!grid) return;
  grid.classList.toggle('list', BF.appState.viewMode === 'list');
  /* 每次渲染同步视图开关的 aria-pressed，让启动读回后的状态也被读屏识别 */
  const vg = document.getElementById('view-grid'), vl = document.getElementById('view-list');
  if (vg) vg.setAttribute('aria-pressed', BF.appState.viewMode === 'grid' ? 'true' : 'false');
  if (vl) vl.setAttribute('aria-pressed', BF.appState.viewMode === 'list' ? 'true' : 'false');
  grid.classList.toggle('compact', BF.settings.get('shelfDensity') === 'compact');
  grid.classList.toggle('comfortable', BF.settings.get('shelfDensity') === 'comfortable');
};
BF.app.renderBookshelf = function (opts) {
  opts = opts || {};
  /* 不在书架页就不跑书架渲染：设置广播、导入完成等入口在首页/阅读器页
     也照样把整表读一遍再渲染，白付全部读放大。go('bookshelf') 每次进入必触发渲染，
     所以跳过不会留下陈旧画面。 */
  if (BF.appState.currentPage !== 'bookshelf') return;
  /* 每次渲染领一个序号：骨架分支要把真内容推迟到下一帧写入，期间若又发生一次渲染
     （骨架屏上点了勾选圈即是），那次推迟写入的是过期快照，会把新状态整片盖掉。
     序号不一致就放弃这次推迟写入。 */
  const _paintSeq = (BF.app._shelfPaintSeq = (BF.app._shelfPaintSeq || 0) + 1);
  const searchEl = document.getElementById('book-search');
  const sortEl = document.getElementById('book-sort');
  const sq = searchEl ? searchEl.value.trim().toLowerCase() : '';
  /* 排序看设置，不看 DOM：DOM 只是它的显示。
     值不同才回写并同步自绘下拉的读数——不回写就会有「设置里是进度、
     框上写着最近阅读」这种两张皮。 */
  const sort = (function () {
    const v = BF.settings.get('shelfSort') || 'recent';
    if (sortEl && sortEl.value !== v) {
      sortEl.value = v;
      try { BF.app.sel.sync(sortEl); } catch (e) {}
    }
    return v;
  })();
  /* 可重赋：下面按 sorters 排序是 books = books.slice().sort(...) */
  let books = BF.library.shelfVisible();

  /* 进度只算一次：bookFrac 内含按章累加 chapterWords，做比较器时同一本书
     会被反复求值，千本书 × 三千章会把排序拖成主耗时。 */
  const _progCache = new Map();
  const _progOf = function (b) {
    if (!b) return 0;
    let v = _progCache.get(b.id);
    if (v === undefined) { v = BF.reader.bookFrac(b, b); _progCache.set(b.id, v); }
    return v;
  };

  const sorters = {
    recent: (a, b) => (b.lastRead || 0) - (a.lastRead || 0),
    /* 进度按卡面同一个数排：BF.reader.bookFrac 是唯一口径（章序 + 章内分数、按字数加权）。
       原来这里另写了一份 currentChapter/totalChapters，于是「按进度排序」把
       环上显示 30% 的书排在显示 90% 的书前面——章号相同、章内进度不同就翻转。 */
    progress: (a, b) => _progOf(b) - _progOf(a),
    title: (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN', { numeric: true }),
    imported: (a, b) => (b.importedAt || 0) - (a.importedAt || 0),
    /* 「大小」换成「字数」：卡面写的是「N 字」，排序却按文件字节，
       同一件事两个数（UTF-8 中文一字三字节），用户无从对照。 */
    words: (a, b) => (b.wordCount || 0) - (a.wordCount || 0),
  };
  /* 合法值名单交给写入侧（与设置下拉同一套守卫）：脏值不会静默排成默认档 */
  try { BF.settings.regEnum('shelfSort', Object.keys(sorters)); } catch (e) {}
  try { BF.settings.regEnum('moreMenuStyle', ['dropdown', 'panel']); } catch (e) {}
  try { BF.settings.regEnum('aiConvLang', ['en', 'zh']); } catch (e) {}
  if (sorters[sort]) books = books.slice().sort(function (a, b) {
    const pa = a && a.pinned ? 1 : 0, pb = b && b.pinned ? 1 : 0;
    if (pa !== pb) return pb - pa;   /* 置顶书籍优先 */
    return sorters[sort](a, b);
  });

  const grid = document.getElementById('books-grid');
  if (!grid) return;
  BF.app.syncShelfLayout();

  const stats = document.getElementById('bs-stats-top');
  const _gn = BF.library.__groupFilter ? (BF.shelf.groups().find(function (g) { return g.id === BF.library.__groupFilter; }) || {}).name || '' : '';
  /* 筛选态显示「共 N 本 · 筛出 M 本」，无筛选显示「N 本书」——
     让用户随时知道总共有多少本、当前筛出多少，不把筛选后数量误读成「书丢了」。
     N 取未筛选全集（与 shelfVisible 同口径净化），M 取本次渲染的筛选后列表。 */
  if (stats) {
    const _sq2 = searchEl ? searchEl.value.trim().toLowerCase() : '';
    const _filtered = !!(BF.library.__tagFilter || BF.library.__groupFilter || _sq2);
    const _total = (function () {
      const _all = BF.library.mergeReadingState(BF.store.lsGetArray(BF.store.K.BOOKS_META, []));
      return (_all || []).filter(function (b) { return b && typeof b === 'object' && b.id; }).length;
    })();
    /* 真无书（total===0）时，排序/视图/搜索这一条无意义，直接收起，
       避免「0 本书」却还挂着排序下拉与筛选等无效控件占黄金位；
       筛到 0 本（total>0）时保留，用户还要靠它清除筛选。 */
    try {
      const _bh = document.getElementById('bs-header');
      if (_bh) _bh.style.display = (_total === 0) ? 'none' : '';
    } catch (e) {}
    stats.textContent = (_filtered ? ('共 ' + _total + ' 本 · 筛出 ' + books.length + ' 本') : (_total + ' 本书'))
      + (BF.library.__tagFilter ? ' · 标签：' + BF.library.__tagFilter : '')
      + (_gn ? ' · 分组：' + _gn : '');
  }
  /* 回收站非空时在顶部条露出「回收站 N 本」入口，点击直达工作台「数据」栏。
     用 onclick/onkeydown 属性挂监听（每次渲染覆盖而非叠加），不累积监听器；
     回收站为空则隐藏，保持顶栏洁净。 */
  try {
    const _tl = document.getElementById('bs-trash-link');
    if (_tl) {
      const _tc = (BF.trash && typeof BF.trash.count === 'function') ? BF.trash.count() : 0;
      if (_tc > 0) {
        _tl.textContent = '回收站 ' + _tc + ' 本';
        _tl.hidden = false;
        _tl.onclick = function () { try { if (BF.workbench && BF.workbench.open) BF.workbench.open('data'); } catch (e) {} };
        _tl.onkeydown = function (e) { if (e && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); if (this.onclick) this.onclick(); } };
      } else {
        _tl.hidden = true; _tl.textContent = ''; _tl.onclick = null; _tl.onkeydown = null;
      }
    }
  } catch (e) { BF.err.report('render.trashLink', e); }
  /* 筛选条的分组选项跟着这一次渲染一起刷新：放在 renderBookshelf 里而不是四个调用点各补一刀
     （标签下拉那种「每条路径都要记得调 refresh」正是会漏的写法） */
  try { BF.library.refreshGroupFilter(); } catch (e) { BF.err.report('refreshGroupFilter', e); }

  const recentWrap = document.getElementById('bs-recent-wrap');
  if (recentWrap) {
    const recent = books.filter(b => b && b.lastRead).sort((a, b) => (b.lastRead || 0) - (a.lastRead || 0)).slice(0, 8);
    if (recent.length && !sq && !BF.library.__tagFilter && !BF.library.__groupFilter) {
      recentWrap.style.display = '';
      const rc = document.getElementById('bs-recent');
      if (rc) {
        rc.innerHTML = recent.map(BF.app.recentCardHTML).join('');
      }
    } else {
      recentWrap.style.display = 'none';
    }
  }

  const addCard = '<div class="add-card" data-trigger-import>' +
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>' +
    '<span class="t1">导入书籍</span><span class="t2">TXT/EPUB · 拖拽或点击</span>' +
    /* 这两个按钮必须收在导入卡内部：若作为 grid-column:1/-1 的整行元素
       插在网格中间，会把第一行书卡劈到第二行，多本书时整个网格从中间断开 */
    '<span style="display:flex;gap:6px;justify-content:center;margin-top:10px">' +
    '<button class="btn btn-xs" data-clipboard-import>' + BF.dom.ic('sheet') + ' 剪贴板</button>' +
    '<button class="btn btn-xs" data-url-import>' + BF.dom.ic('bus') + ' URL</button>' +
    '</span></div>';

  if (!books.length) {
    /* 空态要说清「为什么空」并给一条退出路径：只有搜索那一支有句话时，
       按标签/分组筛到 0 本的画面和「书架真没书」一模一样，
       用户的第一反应是书丢了，而不是「自己在筛」。
       标签名与关键词都来自用户输入，进 innerHTML 前必须过 esc。 */
    const filters = [];
    if (BF.library.__tagFilter) filters.push('标签「' + BF.dom.esc(BF.library.__tagFilter) + '」');
    if (BF.library.__groupFilter) filters.push('分组「' + BF.dom.esc(BF.library.__groupFilterName || BF.library.__groupFilter) + '」');
    /* 回显给用户的关键字取输入框原值：sq 是为匹配做过 toLowerCase 的，
       直接显示会把「Vim 教程」说成「vim 教程」。 */
    const sEl = document.getElementById('book-search');
    const shown = sEl ? sEl.value.trim() : '';
    let head, sub, clearWhat = '';
    if (sq && filters.length) { head = '没有同时满足条件的书'; sub = '筛选：' + filters.join('、') + ' · 关键词：' + BF.dom.esc(shown); clearWhat = 'both'; }
    else if (filters.length) { head = '这个筛选下没有书'; sub = '当前筛选：' + filters.join('、'); clearWhat = 'filter'; }
    else if (sq) { head = '没有匹配「' + BF.dom.esc(shown) + '」的书'; sub = '书名整段包含才算命中，换个关键词或清掉搜索'; clearWhat = 'search'; }
    else { head = '书架还是空的'; sub = '导入一本 TXT 开始，也可以把文件直接拖进这个窗口'; }
    grid.innerHTML = addCard +
      '<div class="empty-state"><div class="icon"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg></div>' +
      '<p>' + head + '</p><div class="sub">' + sub + '</div>' +
      (clearWhat ? '<button class="btn btn-sm empty-state__act" data-clear-shelf="' + clearWhat + '">' + (clearWhat === 'search' ? '清除搜索' : clearWhat === 'filter' ? '清除筛选' : '清除筛选与搜索') + '</button>' : '') +
      '</div>';
    BF.app.updateBatch();
    return;
  }
  /* 书卡质量信号——三指标均为本地事实，不虚构评分
     （设计约束：不展示无数据支撑的评分/推荐值，
     本地无社交数据，禁止伪造）。惰性计算：渲染时一次性聚合
     四键标注计数（O(标注总数) 单遍），单卡 O(1) 查表；
     200+ 本的大书架配合 content-visibility 离屏跳过，
     渲染期不逐卡访问存储。 */
  const annCounts = Object.create(null);
  try {
    [BF.store.K.HIGHLIGHTS, BF.store.K.BOOKMARKS, BF.store.K.NOTES, BF.store.K.VOCAB].forEach(function (kk) {
      const arr = BF.store.lsGet(kk, []);
      if (!Array.isArray(arr)) return;
      for (let i = 0; i < arr.length; i++) {
        const rec = arr[i];
        if (rec && rec.bookId) annCounts[rec.bookId] = (annCounts[rec.bookId] || 0) + 1;
      }
    });
  } catch (e) { /* 计数不可得时不虚构——密度段不展示；但静默会让「计数怎么没了」无从查起 */ BF.err.report('library.annCounts', e); }
  /* 健康度二态（不设阈值、不新增字段）。
     确定性解码（strict UTF-8 试解成功 enc==='UTF-8'，或 BOM
     直判 UTF-16LE/BE）且分章结果非空 → 健康；评分兜底猜码
     （GB18030/GBK/Big5）、分章为空、或编码史缺失（历史导入
     无法确认）→ 存疑。剪贴板/URL 导入的文本由浏览器解码交付、
     无文件猜码路径，归确定性。已知缺口：智能降级
     （正则结果不可信改用字数分章）不留痕，渲染期不可计算。 */
  function bookDoubt(b) {
    /* 来源与编码是两个维度（旧数据把 clipboard/url 塞进 enc，v3→v4 已拆出 src）。
       确定性来源、或测得 UTF 系编码 → 不算「存疑」；文件通道解出 GB18030/GBK/Big5
       仍算存疑（与原语义一致：编码可疑就标出来，不因来源明确而免检）。 */
    const enc = String(b.enc || ''), src = String(b.src || '');
    const deterministic = src === 'clipboard' || src === 'url' || src === 'workshop' ||
      enc === 'UTF-8' || enc === 'utf-8' ||
      enc === 'UTF-16LE' || enc === 'UTF-16BE';
    return !(deterministic && (b.totalChapters || 0) > 0);
  }

  /* 组名索引：每张卡都要查归属，逐本再扫一遍组表就是 O(书×组) */
  const _groupName = {};
  try { BF.shelf.groups().forEach(function (g) { _groupName[g.id] = g.name; }); } catch (e) { BF.err.report('shelf.names', e); }

  /* 书架虚拟化：书多时（>SHELF_CHUNK）首屏只渲染前 SHELF_CHUNK 张，
     滚动临近底部（IntersectionObserver 哨兵）时再按批追加，把 DOM 节点数控制在可控范围
     （1000 本约 31k 节点 → 首屏 ~1.3k），避免长任务卡顿；书少时（≤SHELF_CHUNK）走原路径，
     行为与修复前完全一致。 */
  if (!BF.app._SHELF_CHUNK) BF.app._SHELF_CHUNK = 40;
  /* 进度只认一个源：READING_STATE 是每次 saveProgress 写的，books_meta 里那份是低频镜像，
     渲染取前者；一次读表进 ctx，卡片按 id 查，不在每张卡里各读一次。 */
  const _shelfCtx = { _groupName: _groupName, annCounts: annCounts, bookDoubt: bookDoubt, rs: BF.store.lsGetMemo(BF.store.K.READING_STATE, {}) || {} };
  if (!BF.app._shelfCardHTML) {
    BF.app._shelfCardHTML = function (b, ctx) {
      const _groupName = ctx._groupName, annCounts = ctx.annCounts, bookDoubt = ctx.bookDoubt;
      /* 全书进度：章序 + 章内分数、按字数加权（无 chapterWords 时自动退回章数口径）。
         记录取 READING_STATE；老数据只镜像在 books_meta 时退回那份，两者都没有才算「没读过」。
         口径与 recentCardHTML 共用 recFor，一处定义两处消费。 */
      const _rec = BF.reader.recFor(b, ctx.rs);
      const _frac = BF.reader.bookFrac(b, _rec);
      const progress = Math.round(_frac * 100);
      const _state = BF.library.shelfState(b, _rec);
      const _stateText = _state === 'done' ? '读完' : (_state === 'reading' ? '在读' : '未读');
      /* 进度环：周长 2πr（r=13）= 81.68；只画弧，文字进度另在 meta 行里给（不只靠颜色编码） */
      const _ring = '<span class="shelf-ring" aria-hidden="true"><svg viewBox="0 0 32 32">' +
        '<circle class="ring-bg" cx="16" cy="16" r="13"></circle>' +
        '<circle class="ring-fg" cx="16" cy="16" r="13" stroke-dasharray="' + (81.68 * progress / 100).toFixed(1) + ' 81.7"></circle>' +
        '</svg></span>';
      const sel = BF.appState.selectedBooks.has(b.id) ? ' checked' : '';
      const flags = (b.starred ? '<span class="flag" title="已收藏">★ 收藏</span>' : '') +
        (b.pinned ? '<span class="flag" title="已置顶">置顶</span>' : '');
      const t = b.title || '未命名';
      const _gids = BF.shelf.groupsOf(b.id);
      const _gnames = _gids.map(function (g) { return _groupName[g]; }).filter(Boolean);
      const chips = (b.tags && b.tags.length) || _gnames.length
        ? '<div class="tag-chips">' +
          _gnames.map(function (n) { return '<span class="chip is-grp" title="分组：' + BF.dom.escAttr(n) + '">' + BF.dom.esc(n) + '</span>'; }).join('') +
          (b.tags || []).map(tag => '<span class="chip">' + BF.dom.esc(tag) + '</span>').join('') +
          '</div>'
        : '';
      const _ann = annCounts[b.id] || 0;
      const _doubt = bookDoubt(b);
      /* 卡面只报需要看的事：一切正常不打「健康」——每本书都标等于没标。
         存疑才亮标记（绿点也随它一起出现），已读%与标注数有值才写。 */
      const _qParts = [];
      if (_doubt) _qParts.push('存疑');
      if (_rec && _rec.lastRead && progress > 0) _qParts.push('已读 ' + progress + '%');
      if (_ann > 0) _qParts.push('标注 ' + _ann + ' 处');
      const quality = _qParts.length
        ? '<span class="quality' + (_doubt ? ' is-warn' : '') + '">' + (_doubt ? '<span class="q-dot" aria-hidden="true"></span>' : '') + '<span class="q-text">' + BF.dom.esc(_qParts.join(' · ')) + '</span></span>'
        : '';
      const meta = '<span class="shelf-state is-' + _state + '">' + _stateText + '</span>' + flags +
        '<span>' + (b.totalChapters || 0) + ' 章</span>' +
        (b.author ? '<span>' + BF.dom.esc(b.author) + '</span>' : '') +
        /* statsUnknown：书架从正文库重建时字数无从还原，写 0 是假数，明说未知 */
        '<span>' + (b.statsUnknown ? '字数未知' : BF.util.fmtNum(b.wordCount || 0) + ' 字') + '</span>' +
        (b.lastRead ? '<span>' + BF.util.timeAgo(b.lastRead) + '</span>' : '') +
        quality;
      return '<div class="book-card' + sel + '" data-open-book="' + BF.dom.escAttr(b.id) + '" style="--i:' + (b._i || 0) + '">' +
        '<div class="cover cover-art" style="' + BF.util.coverArt(t) + '">' +
        '<span class="check" data-toggle-select="' + BF.dom.escAttr(b.id) + '" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><polyline points="20 6 9 17 4 12"></polyline></svg></span>' +
        '<span class="seal" aria-hidden="true">' + BF.dom.esc(t.charAt(0) || '?') + '</span>' +
        '<span class="vtitle" aria-hidden="true">' + BF.dom.esc(t.slice(0, 8)) + '</span>' +
        _ring +
        '</div>' +
        BF.bookCardActionsHTML(b) +
        chips +
        '<div class="info"><div class="title" title="' + BF.dom.esc(t) + '">' + BF.dom.esc(t) + '</div>' +
        '<div class="meta">' + meta + '</div>' +
        '<div class="bar"><div class="bar-fill" style="width:' + progress + '%"></div></div></div>' +
        '</div>';
    };
    BF.app._shelfOnScroll = function () {
      const w = BF.app._shelfWin;
      if (!w || w.done) return;
      const grid = w.grid;
      if (!grid) return;
      const more = w.books.slice(w.next, w.next + BF.app._SHELF_CHUNK);
      const sentinel = grid.querySelector('.shelf-sentinel');
      if (!more.length) { w.done = true; if (sentinel) sentinel.remove(); if (BF.app._shelfIO) BF.app._shelfIO.disconnect(); return; }
      const frag = document.createElement('div');
      frag.innerHTML = more.map(function (b) { return BF.app._shelfCardHTML(b, w.ctx); }).join('');
      if (BF.a11y && BF.a11y.makeFocusable) BF.a11y.makeFocusable(frag);
      while (frag.firstChild) grid.insertBefore(frag.firstChild, sentinel);
      w.next += more.length;
      BF.app.updateBatch();
      if (w.next >= w.books.length) { w.done = true; if (sentinel) sentinel.remove(); if (BF.app._shelfIO) BF.app._shelfIO.disconnect(); }
    };
  }
  /* 重绘前记下滚动位置，画完回位：勾选、收藏、改组都会走到这里做整架
     innerHTML 重建，而 >40 本时窗口只填第一屏——重绘后文档比原来矮，
     浏览器把滚动条夹回顶部，用户点一下复选框就被弹回架顶。
     切页进入时 scrollTop 本就是 0，不进这条路径，不额外付补足的成本。 */
  const _sc0 = grid.closest ? grid.closest('.bookshelf-body') : null;
  const _top0 = _sc0 ? _sc0.scrollTop : 0;
  const _keepScroll = function () {
    if (!_sc0 || !_top0) return;
    /* 先按批补足到原滚动深度所需的那些卡片，再回位：DOM 里还没那么高时
       写 scrollTop 会被夹住，回不去原位。每批 _SHELF_CHUNK 张，有界。 */
    const w = BF.app._shelfWin;
    if (w && !w.done) {
      let guard = 0;
      while (!w.done && _sc0.scrollHeight < _top0 + _sc0.clientHeight && guard++ < 60) BF.app._shelfOnScroll();
    }
    _sc0.scrollTop = _top0;
  };
  const _paintShelf = function () {
    if (books.length <= BF.app._SHELF_CHUNK) {
      grid.innerHTML = addCard + books.map(function (b) { return BF.app._shelfCardHTML(b, _shelfCtx); }).join('');
      BF.a11y.makeFocusable(grid);
      BF.app.updateBatch();
      BF.app._shelfWin = null;
      if (BF.app._shelfIO) BF.app._shelfIO.disconnect();
      _keepScroll();
      return;
    }
    grid.innerHTML = addCard + books.slice(0, BF.app._SHELF_CHUNK).map(function (b) { return BF.app._shelfCardHTML(b, _shelfCtx); }).join('') +
      '<div class="shelf-sentinel" aria-hidden="true"></div>';
    BF.a11y.makeFocusable(grid);
    BF.app.updateBatch();
    BF.app._shelfWin = { seq: _paintSeq, books: books, next: BF.app._SHELF_CHUNK, grid: grid, done: false, ctx: _shelfCtx };
    const sc = grid.closest ? grid.closest('.bookshelf-body') : null;
    const _sentinel = grid.querySelector('.shelf-sentinel');
    if (sc && _sentinel) {
      if (!BF.app._shelfIO && 'IntersectionObserver' in window) {
        BF.app._shelfIO = new IntersectionObserver(function (entries) {
          for (let i = 0; i < entries.length; i++) if (entries[i].isIntersecting) BF.app._shelfOnScroll();
        }, { root: sc, rootMargin: '300px 0px' });
      }
      if (BF.app._shelfIO) { BF.app._shelfIO.disconnect(); BF.app._shelfIO.observe(_sentinel); }
      else if (sc.addEventListener) { sc.addEventListener('scroll', BF.app._shelfOnScroll, { passive: true }); }
    }
    _keepScroll();
  };

  /* ⑨ 骨架屏接线：
     书架渲染是同步的（localStorage 直读 + innerHTML），同步 JS 期间浏览器不绘制，
     所以「先画骨架、下一帧再填真内容」才能让骨架真的可见 —— 否则它永远只是一段死代码。
     只在 opts.skeleton 为真（切页进入书架）且书较多时启用：
       书少时同步渲染耗时远小于一帧，骨架不会被绘制，也就不会闪。
     空书架已在上方 return，绝不会走到这里，不会被骨架误盖。 */
  if (opts.skeleton && books.length >= 5) {
    BF.app.skeleton(grid, Math.min(books.length, 12), 'card');
    requestAnimationFrame(function () {
      if (_paintSeq !== BF.app._shelfPaintSeq) return;
      if (BF.appState.currentPage !== 'bookshelf') { BF.app.renderBookshelf(); return; }
      _paintShelf();
    });
    return;
  }
  _paintShelf();
};
/* SETTINGS 广播 → 只同步书架网格上的布局类（列表 / 密度），不重建书卡。
   书卡内容真的变了（卡面动作、书籍数据）由各自入口重渲染。 */
try {
  BF.bus.on(BF.EVENTS.SETTINGS, function () {
    try { BF.app.syncShelfLayout(); } catch (e) { BF.err.report('render.bookshelf.onSettings', e); }
  });
} catch (e) { BF.err.report('app.shelfSettings', e); }
BF.app.updateBatch = function () {
  const bar = document.getElementById('batchbar');
  const count = document.getElementById('batch-count');
  if (bar) bar.classList.toggle('show', BF.appState.selectedBooks.size > 0);
  if (count) count.textContent = BF.appState.selectedBooks.size ? '已选 ' + BF.appState.selectedBooks.size + ' 本' : '';
};

/* ---------- 键盘可达：书卡与抽屉列表项进焦点序 ----------
   两处都是「DIV + onclick」，不给 tabIndex 时 50 张卡里可聚焦者为 0，目录项 tabIndex = -1：
   纯键盘用户进不了任何一本书、也选不了任何一条目录。
   右键菜单不动——它是「容器持焦 + 游标画在项上」的 listbox 写法，
   项上 tabIndex=-1 本就是这个模式的正确形态。
   渲染点多（目录虚拟化窗口 / 书签 / 笔记 / 生词 / 全局搜索…），
   因此只在两个容器上各挂一个 MutationObserver 统一补属性，
   不在每个渲染函数里抄第二遍——抄了必然漏一处。 */
BF.a11y = BF.a11y || {};
BF.a11y.makeFocusable = function (root) {
  if (!root || !root.querySelectorAll) return;
  const nodes = root.querySelectorAll('.book-card, .drawer-item');
  for (let i = 0; i < nodes.length; i++) {
    const el = nodes[i];
    if (el.tabIndex < 0) el.tabIndex = 0;
    if (!el.getAttribute('role')) {
      el.setAttribute('role', el.classList.contains('book-card') ? 'link' : 'button');
    }
  }
};
(function () {
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
    const t = e.target;
    if (!t || !t.classList || !t.closest) return;
    /* 只认焦点正落在卡片/条目本身：落在卡内按钮上时让按钮自己处理，
       否则「Tab 到删除键按回车」会连带触发开书 */
    if (!t.classList.contains('book-card') && !t.classList.contains('drawer-item') && !t.hasAttribute('data-heat-date')) return;
    if (e.key !== 'Enter') e.preventDefault();
    try { t.click(); } catch (err) { BF.err.report('a11y.activate', err); }
  });
  /* 书卡出现在三个容器（书架网格 + 首页最近阅读条 + 书架最近阅读条），
     目录/书签/笔记/生词/搜索的条目都在 drawer-body 下。不观察 document.body：
     阅读器虚拟化的每帧增删会把这些回调变成热路径噪声。 */
  ['books-grid', 'drawer-body', 'recent-scroll', 'bs-recent'].forEach(function (id) {
    const host = document.getElementById(id);
    if (!host || typeof MutationObserver === 'undefined') return;
    const run = function () { try { BF.a11y.makeFocusable(host); } catch (e) { BF.err.report('a11y.focusable', e); } };
    try { new MutationObserver(run).observe(host, { childList: true, subtree: true }); } catch (e) { BF.err.report('a11y.observe', e); }
    run();
  });
})();

