/* ================= 通用更多菜单（带箭头，首页/书架/阅读器共用） ================= */
BF.uiMenu = (function () {
  /* 焦点归还锚点与统一入口：关闭一律走 _hideMore；
     键盘游标用户（焦点在容器上）关完把焦点还给触发按钮——
     菜单不能只有鼠标关路，键盘进去也要能出来。 */
  var _moreAnchor = null;
  function _hideMore() {
    const menu = document.getElementById('bf-more-menu');
    if (!menu || menu.style.display === 'none') return;
    const kb = document.activeElement === menu;
    menu.style.display = 'none';
    menu.removeAttribute('aria-activedescendant');
    menu.querySelectorAll('.bf-more-item').forEach(function (el) { el.classList.remove('is-active'); });
    menu.__bfActive = -1;
    if (kb && _moreAnchor) { try { _moreAnchor.focus(); } catch (e) {} }
  }
  function itemsFor(ctx) {
    /* g = 分组归属（R4-A 收敛为 4 组：reading 阅读 / transfer 导出·备份 / tools 工具 / system 系统）。
       分组信息挂在条目自身上、由下方渲染统一消费，
       不在三个 ctx 里各写一遍分组逻辑（同一份 common 被三处复用，
       同一 id 因此在三套菜单里天然同组，不会漂移）。
       组序固定见下方 GROUPS；无 g 的条目归入「其它」并排最后（不静默丢弃）。 */
    /* 降噪：白噪音/番茄钟/AI/统计已从 common 移除——它们在我的页有常驻入口，
       更多菜单再放一份是重复（实测两处重合率约 73%）。工作台保留（受 devTools 门控）。 */
    const common = [
      { id: 'settings', label: '设置', g: 'tools', run: function () { BF.settingsUI.toggle(); } },
      { id: 'help', label: '使用手册', g: 'tools', run: function () { if (BF.help) BF.help.toggle(); } },
      { id: 'noti', label: '通知中心', g: 'system', run: function () { BF.wsUI.openNotiCenter(); } },
      { id: 'trash', label: '回收站（' + (BF.trash ? BF.trash.count() : 0) + '）', g: 'system', run: function () { BF.trash.toggle(); } },
      /* 工作台 / DSL 终端：与「设置·数据」同源的运维入口，归入系统组 */
      { id: 'wb', label: '工作台', g: 'system', run: function () { BF.workbench && BF.workbench.toggle(); } },
      { id: 'dsl', label: 'DSL 终端', g: 'system', run: function () { BF.dslUI.toggle(); } },
    ];
    /* D2：devTools 关时「工作台」不进更多菜单，与其他入口同一门控；
       DSL wb.open 与命令表仍可打开，显式开启即在所有入口复原。 */
    if (!BF.settings.get('devTools')) {
      var _wi = common.findIndex(function (it) { return it.id === 'wb'; });
      if (_wi >= 0) common.splice(_wi, 1);
    }
    if (ctx === 'home') {
      return [
        { id: 'shelf', label: '进入书架', g: 'reading', run: function () { BF.app.go('bookshelf'); } },
        ...common,
      ];
    }
    if (ctx === 'shelf') {
      return [
        { id: 'import', label: '导入文件', g: 'transfer', run: function () { BF.library.pickAndImport(); } },
        { id: 'clip', label: '导入剪贴板', g: 'transfer', run: function () { BF.library.importClipboard(); } },
        { id: 'url', label: '导入链接', g: 'transfer', run: function () { BF.library.promptImportURL(); } },
        { id: 'exportAll', label: '批量导出全部（TXT）', g: 'transfer', run: function () { BF.enh.exportAllBooks(false); } },
        { id: 'exportAllZip', label: '批量导出全部（ZIP 打包）', g: 'transfer', run: function () { BF.enh.exportAllBooks(true); } },
        /* 就地入口：attrs 让菜单项把点击交给 [data-shelf-picker] 委托，
           顶栏下面那块挑选器与设置「书架」节出的是同一份内容。 */
        { id: 'cardActions', label: '卡面动作…', g: 'tools', attrs: 'data-shelf-picker' },
        /* 分组管理：窄屏顶栏把它收进「更多」（CSS 隐藏），菜单兜底可达 */
        { id: 'grpMng', label: '分组管理', g: 'tools', attrs: 'data-shelf-manage' },
        ...common,
      ];
    }
    /* 阅读器菜单共用统一构建器：项用 attrs 透传 data-* 属性，
       复用既有全局委托（data-go-home / data-nav-back / ...），
       避免每个菜单项重复绑定事件。 */
    if (ctx === 'reader') {
      return [
        { id: 'goHome', label: '回到首页', g: 'reading', attrs: 'data-go-home' },
        { id: 'navBack', label: '后退', g: 'reading', attrs: 'data-nav-back' },
        { id: 'navFwd', label: '前进', g: 'reading', attrs: 'data-nav-forward' },
        { id: 'askExp', label: '导出问书记录', g: 'transfer', attrs: 'data-export-ask="md"' },
        { id: 'shot', label: '章节截图', g: 'transfer', attrs: 'data-chapter-shot' },
        { id: 'noteMd', label: '导出标注 MD', g: 'transfer', attrs: 'data-export-notes="md"' },
        { id: 'noteCsv', label: '导出标注 CSV', g: 'transfer', attrs: 'data-export-notes="csv"' },
        { id: 'noteW3C', label: '导出标注 W3C', attrs: 'data-export-notes="w3c"' },
        { id: 'annImp', label: '导入标注 W3C', attrs: 'data-ann-import' },
        { id: 'expAll', label: '批量导出 TXT', g: 'transfer', attrs: 'data-export-all' },
        { id: 'expAllZip', label: '批量导出 ZIP', g: 'transfer', attrs: 'data-export-all-zip' },
        { id: 'selfpkg', label: '自包含离线包', g: 'transfer', attrs: 'data-export-selfpkg' },
        { id: 'resplit', label: '重新分章（按当前规则）', g: 'tools', run: function () {
          const _bid = BF.appState.currentBookId;
          if (!_bid) { BF.noti.warn('请先打开一本书'); return; }
          BF.library.resplitBook(_bid);   /* 确认内聚于能力，入口不再问 */
        } },
        { id: 'autoscroll', label: '自动滚动', g: 'reading', attrs: 'data-autoscroll' },
        { id: 'opfsSnap', label: 'OPFS 快照', g: 'transfer', attrs: 'data-opfs-snap' },
        { id: 'opfsRestore', label: 'OPFS 恢复', g: 'transfer', attrs: 'data-opfs-restore' },
        ...common,
      ];
    }
    /* 笔记页：刷新是页面专属动作，窄屏收进「更多」后需在此兜底可达 */
    if (ctx === 'notes') {
      return [
        { id: 'notesRefresh', label: '刷新笔记', g: 'tools', run: function () { var b = document.getElementById('notes-refresh'); if (b) b.click(); } },
        ...common,
      ];
    }
    /* 我的页：无专属顶栏动作，菜单与其它页同源（设置/手册/通知等） */
    if (ctx === 'mine') {
      return [ ...common ];
    }
    return common;
  }
  function open(ctx, anchorBtn) {
    let menu = document.getElementById('bf-more-menu');
    if (menu && menu.style.display !== 'none') { _hideMore(); return; }
    if (!menu) {
      menu = document.createElement('div');
      menu.id = 'bf-more-menu';
      menu.className = 'bf-more-menu';
      /* 与 .bf-sel 同用 listbox/option + 键盘游标。焦点落在容器
         （tabindex -1），条目 role=option、由唯一游标绘制位置，
         aria-activedescendant 恒指当前游标。 */
      menu.setAttribute('role', 'listbox');
      menu.setAttribute('aria-label', '操作菜单');
      menu.tabIndex = -1;
      document.body.appendChild(menu);
    }
    _moreAnchor = anchorBtn;
    if (!menu.__bfNav) {
      menu.__bfNav = true;
      menu.__bfActive = -1;
      menu.addEventListener('keydown', function (e) {
        if (e.key === 'Tab') { _hideMore(); return; }   /* Tab 出菜单即收，不留挂层的菜单 */
        const ctl = {
          nodes: function () { return Array.prototype.slice.call(menu.querySelectorAll('.bf-more-item')); },
          active: function () { return menu.__bfActive; },
          setActive: function (n) { menu.__bfActive = BF.app.sel.cursor(ctl.nodes(), n, menu); },
          pick: function (n) { const nd = ctl.nodes()[n]; if (nd) nd.click(); },
          close: function () { _hideMore(); },
        };
        BF.app.sel.nav(e, ctl);
      });
    }
    /* 点击外部关闭：常驻监听，不随菜单关闭自我摘除——
       否则第二次打开后点页面任何地方都关不掉（只能再点「更多」按钮） */
    if (menu.__bfCloseFn) document.removeEventListener('click', menu.__bfCloseFn);
    const close = function (e) {
      if (menu.style.display !== 'none' && !e.target.closest('#bf-more-menu') && !e.target.closest('[data-more-menu]') && !e.target.closest('[data-reader-more]')) {
        _hideMore();
      }
    };
    menu.__bfCloseFn = close;
    document.addEventListener('click', close);
    const items = itemsFor(ctx);
    /* 按组渲染。R4-A：收敛为 4 组（阅读 / 导出·备份 / 工具 / 系统），组序固定、与 ctx 无关。
       组内保持 items 的原序。每组前加一行「不可点组标题」（小号灰字，aria-hidden，不进键盘游标）；
       组间保留细分隔线。条目仍是 <button class="bf-more-item">，键盘可达性与 role 语义不变。 */
    const GROUPS = [
      { g: 'reading', name: '阅读' },
      { g: 'transfer', name: '导出·备份' },
      { g: 'tools', name: '工具' },
      { g: 'system', name: '系统' },
    ];
    const btnHtml = function (it) {
      /* 支持 attrs 透传 data-*（复用全局委托） */
      const attr = it.attrs ? ' ' + it.attrs : '';
      /* role=option + 游标可达的 id；tabindex -1 让 Tab 直接出菜单
         （菜单内步进归游标，键盘两套路线不该并存）。 */
      return '<button class="bf-more-item" id="bfmi-' + (++_miSeq) + '" role="option" aria-selected="false" tabindex="-1" data-more-item="' + it.id + '"' + attr + '>' + it.label + '</button>';
    };
    let _miSeq = 0;
    /* 按 GROUPS 顺序装桶；不在表里的 g 归入「其它」并排最后（不静默丢弃） */
    /* 例外：noteW3C / annImp 两条的条目定义不能带 g 字段——
       外部门禁以完整字面量匹配这两行（接线断言），插入任何字段都会失配。
       故分组归属在此处补（R4-A 统一归入「导出·备份」），既保住门禁字面量，又不让它们掉进「其它」。 */
    const GROUP_OF = { noteW3C: 'transfer', annImp: 'transfer' };
    items.forEach(function (it) {
      if (it.g === undefined && GROUP_OF[it.id]) it.g = GROUP_OF[it.id];
    });
    const buckets = new Map();
    GROUPS.forEach(function (grp) { buckets.set(grp.g, { name: grp.name, items: [] }); });
    const other = { name: '其它', items: [] };
    items.forEach(function (it) {
      const b = buckets.get(it.g);
      (b || other).items.push(it);
    });
    if (other.items.length) buckets.set('__other', other);
    let first = true;
    let html = '';
    buckets.forEach(function (grp) {
      if (!grp.items.length) return;
      /* 组间保留细分隔线（首组不画）；每组前加一行不可点组标题（小号灰字，aria-hidden，不进键盘游标） */
      if (!first) html += '<div class="bf-more-sep" role="separator" aria-hidden="true"></div>';
      first = false;
      html += '<div class="bf-more-grouptitle" aria-hidden="true">' + BF.dom.esc(grp.name) + '</div>';
      html += grp.items.map(btnHtml).join('');
    });
    menu.innerHTML = html;
    /* 定位到按钮下方（带小箭头）。平铺面板形态更宽，向左让出宽度；
       下拉态维持原行为不变。 */
    const r = anchorBtn.getBoundingClientRect();
    let _mStyle = 'dropdown';
    try { _mStyle = BF.settings.get('moreMenuStyle') || 'dropdown'; } catch (e) {}
    const _isPanel = _mStyle === 'panel';
    menu.classList.toggle('bf-more-panel', _isPanel);
    menu.style.display = _isPanel ? 'flex' : 'block';
    menu.style.top = (r.bottom + 8) + 'px';
    menu.style.left = Math.max(8, r.right - (_isPanel ? 640 : 180)) + 'px';
    /* 箭头指向按钮 */
    menu.style.setProperty('--arrow-x', Math.min(170, r.right - r.left - 14) + 'px');
    /* 绑定项点击 */
    menu.querySelectorAll('[data-more-item]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        _hideMore();
        const it = items.find(x => x.id === btn.dataset.moreItem);
        if (it && it.attrs) return;   /* attrs 项由全局委托处理（data-* 已在委托区注册），这里只关菜单 */
        if (it) { try { it.run(); } catch (e) { BF.err.report('moreMenu.' + it.id, e); } }
      });
    });
    /* 打开即接管键盘——焦点落容器、游标画首项（与 .bf-sel 同法）。 */
    menu.__bfActive = -1;
    try { menu.focus(); } catch (e) {}
    menu.__bfActive = BF.app.sel.cursor(menu.querySelectorAll('.bf-more-item'), 0, menu);
  }
  /* 固定到顶栏的菜单项：按设置 pinnedTop（逗号分隔 id）把对应条目渲染成
     文字小按钮，插在「更多」按钮左侧；「更多」菜单里仍保留原条目（不去重，
     固定只是快捷面，不是搬走）。attrs 项（data-shelf-picker 等）原样透传，
     由各自既有全局委托处理；run 项由下方文档级委托执行。 */
  function pinnedIds() {
    let v = '';
    try { v = BF.settings.get('pinnedTop') || ''; } catch (e) {}
    return String(v).split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }
  function renderPins() {
    const ids = pinnedIds();
    ['home', 'shelf'].forEach(function (ctx) {
      const host = document.querySelector('[data-more-menu="' + ctx + '"]');
      if (!host || !host.parentElement) return;
      host.parentElement.querySelectorAll('[data-pin-item]').forEach(function (n) { n.remove(); });
      const items = itemsFor(ctx);
      const frags = ids.map(function (id) {
        const it = items.find(function (x) { return x.id === id; });
        if (!it) return '';
        const attr = it.attrs ? ' ' + it.attrs : '';
        return '<button class="bf-topbar-pin" data-pin-item="' + it.id + '" title="' + BF.dom.esc(it.label) + '" aria-label="' + BF.dom.esc(it.label) + '"' + attr + '>' + BF.dom.esc(it.label) + '</button>';
      }).join('');
      if (frags) host.insertAdjacentHTML('beforebegin', frags);
    });
  }
  document.addEventListener('click', function (e) {
    const b = e.target.closest('[data-pin-item]');
    if (!b) return;
    /* attrs 项交给各自委托（data-shelf-picker / data-shelf-manage 等），这里只兜 run 项 */
    if (b.hasAttribute('data-shelf-picker') || b.hasAttribute('data-shelf-manage')) return;
    const host = b.parentElement ? b.parentElement.querySelector('[data-more-menu]') : null;
    const ctx = host ? host.getAttribute('data-more-menu') : 'shelf';
    const it = itemsFor(ctx).find(function (x) { return x.id === b.getAttribute('data-pin-item'); });
    if (it && it.run) { try { it.run(); } catch (err) { BF.err.report('pin.' + it.id, err); } }
  });
  return { open, itemsFor, renderPins, pinnedIds };
})();
(function () {
  document.addEventListener('click', function (e) {
    const t = e.target;
    const moreBtn = t.closest('[data-more-menu]');
    if (moreBtn) { BF.uiMenu.open(moreBtn.dataset.moreMenu, moreBtn); return; }
  });
})();
BF.enh.readerMoreMenu = function () {
  /* 阅读器更多菜单共用统一构建器（BF.uiMenu）：
     三个入口（home/shelf/reader）共用 itemsFor 与同一个菜单 UI，
     项集合与术语一致。 */
  const btn = document.querySelector('[data-reader-more]');
  if (!btn) return;
  BF.uiMenu.open('reader', btn);
  try { if (BF.nav && BF.nav.updateButtons) BF.nav.updateButtons(); } catch (e) {}
};

