/* ================= 13.5 BF.shell 全局骨架（TabBar + 右抽屉） =================
   不接管路由，只在 BF.app.go 切页后同步 UI 状态：
   · TabBar 选中态跟随 page（home/bookshelf/notes/mine/reader）；
   · body.has-tabbar 控制页面底部留白与 TabBar 显隐；
   · qj/microread 模式下自动隐藏 TabBar；
   · 右抽屉：统一弹层，承载目录/搜索/设置/书签/笔记等内容。 */
BF.shell = (function () {
  const $ = function (id) { return document.getElementById(id); };
  let _inited = false;
  let _hideT = null;   /* 关抽屉的延迟隐藏句柄：320ms 内重开必须能取消，否则新开的被旧计时器关掉 */

  /* TabBar 可映射的页面；其它页面（qj）不显示 TabBar */
  const TAB_PAGES = ['home', 'bookshelf', 'notes', 'mine'];
  const tabbar = () => $('bf-tabbar');
  const drawer = () => $('bf-drawer');
  const mask = () => $('bf-drawer-mask');
  const titleEl = () => $('bf-drawer-title');
  const bodyEl = () => $('bf-drawer-body');

  function _setBodyClasses(page) {
    const b = document.body;
    const qj = !!(BF.settings && BF.settings.get && BF.settings.get('qjMode'));
    const micro = b.classList.contains('microread-on');
    b.classList.toggle('qj-on', !!qj);
    /* 设置 hideTabBar：用户自主关掉底部标签栏（默认显示，见 DEFAULTS 同名键）。
       与 qj/micro 一样只是显隐判定，不参与路由。 */
    const hideTab = !!(BF.settings && BF.settings.get && BF.settings.get('hideTabBar'));
    const showTab = !hideTab && !qj && !micro && TAB_PAGES.indexOf(page) >= 0;
    b.classList.toggle('has-tabbar', !!showTab);
    const tb = tabbar();
    if (tb) tb.hidden = !showTab;
  }

  function _syncTab(page) {
    const tb = tabbar(); if (!tb) return;
    tb.querySelectorAll('.bf-tab').forEach(function (t) {
      const p = t.getAttribute('data-tab');
      t.setAttribute('aria-selected', p === page ? 'true' : 'false');
    });
  }

  function _closeDrawer() {
    const d = drawer(), m = mask();
    if (!d || !m) return;
    d.classList.remove('open');
    m.classList.remove('show');
    d.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('drawer-open');
    if (_hideT) { clearTimeout(_hideT); _hideT = null; }
    _hideT = setTimeout(function () { _hideT = null; try { d.hidden = true; m.hidden = true; } catch (e) {} }, 320);
  }

  function openDrawer(opts) {
    /* opts: { title, html, onMount } —— html 可为字符串或 DOM 节点 */
    if (_hideT) { clearTimeout(_hideT); _hideT = null; }   /* 取消尚未执行的关闭：连点两个入口不该把自己关掉 */
    const d = drawer(), m = mask(), t = titleEl(), bd = bodyEl();
    if (!d || !m || !t || !bd) return;
    t.textContent = (opts && opts.title) || '面板';
    bd.innerHTML = '';
    if (opts && opts.html) {
      if (typeof opts.html === 'string') bd.innerHTML = opts.html;
      else bd.appendChild(opts.html);
    }
    d.hidden = false; m.hidden = false;
    /* 强制 reflow 让过渡生效 */
    void d.offsetWidth; void m.offsetWidth;
    d.classList.add('open');
    m.classList.add('show');
    d.setAttribute('aria-hidden', 'false');
    document.body.classList.add('drawer-open');
    if (opts && typeof opts.onMount === 'function') {
      try { opts.onMount(bd); } catch (e) { BF.err && BF.err.report('shell.drawer.onMount', e); }
    }
  }

  function sync(page) {
    if (!_inited) init();
    _setBodyClasses(page);
    _syncTab(page);
    /* 切到笔记页时刷新聚合列表（便签/标注可能被其它面板增删） */
    if (page === 'notes' && BF.notesTab && BF.notesTab.render) {
      try { BF.notesTab.render(); } catch (e) { BF.err && BF.err.report('notesTab.render', e); }
    }
    /* 切到我的页时刷新统计 */
    if (page === 'mine' && BF.mineTab && BF.mineTab.render) {
      try { BF.mineTab.render(); } catch (e) { BF.err && BF.err.report('mineTab.render', e); }
    }
  }

  function init() {
    if (_inited) return; _inited = true;
    const tb = tabbar();
    if (tb && !tb.__bound) {
      tb.__bound = true;
      tb.addEventListener('click', function (e) {
        const t = e.target && e.target.closest ? e.target.closest('.bf-tab') : null;
        if (!t) return;
        const p = t.getAttribute('data-tab');
        if (!p) return;
        /* 笔记/我的是新页；中心"阅读"按钮继续上次阅读 */
        if (p === 'reader') {
          try { BF.app.continueRead && BF.app.continueRead(); } catch (ex) { BF.err && BF.err.report('shell.tab.reader', ex); }
          return;
        }
        if (TAB_PAGES.indexOf(p) >= 0) BF.app.go(p);
      });
    }
    const m = mask(), closeBtn = $('bf-drawer-close'), d = drawer();
    if (m && !m.__bound) { m.__bound = true; m.addEventListener('click', _closeDrawer); }
    if (closeBtn && !closeBtn.__bound) { closeBtn.__bound = true; closeBtn.addEventListener('click', _closeDrawer); }
    if (d && !d.__bound) {
      d.__bound = true;
      d.addEventListener('keydown', function (e) { if (e.key === 'Escape') _closeDrawer(); });
    }
    /* 监听微读进入离开，刷新 TabBar 状态 */
    try {
      BF.bus && BF.bus.on && BF.bus.on(BF.EVENTS.STATE, function () {
        const page = BF.appState && BF.appState.currentPage;
        if (page) sync(page);
      });
    } catch (e) {}
    /* 首帧兜底：底栏显隐只在 sync(page) 里算，而 sync 要等第一次 STATE 广播；
       启动早期若还没广播，底栏会停在 HTML 上的 hidden 初值——用户先看到「没有底栏」，
       下一帧又冒出来。这里补一次下一帧的同步（sync 幂等，重复调用无副作用）。 */
    try {
      requestAnimationFrame(function () {
        try { sync((BF.appState && BF.appState.currentPage) || 'home'); } catch (e) {}
      });
    } catch (e) {}
  }

  return {
    init: init,
    sync: sync,
    openDrawer: openDrawer,
    closeDrawer: _closeDrawer,
  };
})();

