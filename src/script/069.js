/* ================= 微读模式：独立实现（R3/R4） ================= */
BF.mr = BF.mr || {};
/* ── 微信读书 Canvas 翻页（微读专属 · 可选）──
   移植官方 wr_horizontalReader 范式：measureText 逐字断行 + 标点避头尾 + 逐页位图 + 跟手平移。
   数据源直接用 BF.reader.state.paras/title（章节渲染后就绪），不重复异步取章、与正文同源。
   滚动仍是默认；Canvas 只在微读且 mrCanvas 开启时接管，且不支持选区划线/复制（与官方 Canvas 一致）。 */
BF.mr.canvas = (function () {
  const NO_START = /[、。，．・：；？！％‰’”,,.!?:;%)>\]}〉》」』】）”〃]/;
  const NO_END = /[（《「『【〈([{＜《﹙﹛﹝]/;
  let pages = [], drawn = {}, spread = 0, step = 0, pageW = 0, pageH = 0;
  let wrap = null, strip = null, tip = null, probe = null, raf = 0;
  let chKey = '', off = null, ttsTimer = null, ttsLast = '';

  function fonts() {
    const f = BF.settings.get('fontFamily');
    return f === 'kai' ? 'KaiTi,STKaiti,"Kaiti SC",serif' : f === 'serif' ? '"Songti SC","SourceHanSerifCN-Bold",SimSun,serif' : '-apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
  }
  function fg() {
    const th = BF.MR_THEMES[BF.settings.get('mrTheme')] || BF.MR_THEMES['wr-white'];
    return th.fg;
  }
  function active() {
    const pg = document.getElementById('page-reader');
    return !!(pg && pg.classList.contains('microread') && BF.settings.get('mrCanvas'));
  }
  /* 逐字断行 + 避头尾：返回 [{chars:[字符...], indent, blockLast}] */
  function wrapText(text, maxW, indentPx, font, fs, ls) {
    const out = []; let chars = [], w = indentPx;
    for (let i = 0; i < text.length; i++) {
      const c = text[i], cw = probe.measureText(c).width + ls;
      if (w + cw > maxW && chars.length) {
        if (NO_START.test(c)) { out.push({ chars: chars, indent: out.length === 0 && !!indentPx, blockLast: false }); chars = []; w = 0; }
        else if (NO_END.test(chars[chars.length - 1])) {
          const last = chars.pop(); out.push({ chars: chars, indent: out.length === 0 && !!indentPx, blockLast: false });
          chars = [last]; w = probe.measureText(last).width + ls;
        } else { out.push({ chars: chars, indent: out.length === 0 && !!indentPx, blockLast: false }); chars = []; w = 0; }
      }
      chars.push(c); w += cw;
    }
    if (chars.length || !out.length) out.push({ chars: chars, indent: out.length === 0 && !!indentPx, blockLast: true });
    if (out.length) out[out.length - 1].blockLast = true;
    return out;
  }
  function measure() {
    const r = wrap.getBoundingClientRect();
    pageW = Math.max(240, Math.floor(r.width)); pageH = Math.max(240, Math.floor(r.height));
    step = pageW;
  }
  function layout() {
    if (!probe) probe = document.createElement('canvas').getContext('2d');
    measure();
    const fs = Number(BF.settings.num('fontSize', 17)) || 17;
    const lh = Number(BF.settings.num('lineHeight', 1.95)) || 1.95;
    const fontName = fonts();
    probe.font = fs + 'px ' + fontName;
    const ls = Number(BF.settings.num('wordSpacing', 0)) || 0;
    const inner = Math.max(24, Math.min(64, Math.round(pageW * 0.09)));
    const topPad = Math.round(Math.min(72, pageH * 0.12)), botPad = 24;
    const availW = Math.max(120, pageW - 2 * inner);
    const linesPer = Math.max(6, Math.floor((pageH - topPad - botPad) / lh));
    const title = String(BF.reader.state.title || '');
    const paras = (BF.reader.state.paras || []).filter(function (p) { return String(p).trim(); });
    const blocks = [{ text: title, title: true }].concat(paras.map(function (p) { return { text: String(p), title: false }; }));
    const all = [];
    blocks.forEach(function (bl) {
      const indentPx = bl.title ? 0 : fs * 2;
      const lines = wrapText(bl.text, availW, indentPx, fontName, fs, ls);
      lines.forEach(function (ln, i) { ln.title = bl.title; ln.blockLast = (i === lines.length - 1); all.push(ln); });
    });
    pages = []; let cur = [], used = 0;
    all.forEach(function (ln) {
      const h = ln.title ? 1.7 : 1 + (ln.blockLast ? 0.45 : 0);
      if (used + h > linesPer && cur.length) { pages.push(cur); cur = []; used = 0; }
      cur.push(ln); used += h;
    });
    if (cur.length || !pages.length) pages.push(cur);
    spread = Math.min(spread, Math.max(0, pages.length - 1));
    drawn = {}; strip.innerHTML = ''; strip.style.transition = 'none';
    strip.style.transform = 'translateX(0px)';
    requestAnimationFrame(function () { strip.style.transition = ''; });
  }
  function segW(ctx, chars) {
    const ls = Number(BF.settings.num('wordSpacing', 0)) || 0; let w = 0;
    for (let i = 0; i < chars.length; i++) w += ctx.measureText(chars[i]).width + ls;
    return w;
  }
  function drawPage(idx) {
    const lnPage = pages[idx]; if (!lnPage) return false;
    const fs = Number(BF.settings.num('fontSize', 17)) || 17;
    const lh = Number(BF.settings.num('lineHeight', 1.95)) || 1.95;
    const fontName = fonts(), ls = Number(BF.settings.num('wordSpacing', 0)) || 0;
    const inner = Math.max(24, Math.min(64, Math.round(pageW * 0.09)));
    const topPad = Math.round(Math.min(72, pageH * 0.12));
    const availW = Math.max(120, pageW - 2 * inner);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    let cv = drawn[idx];
    if (!cv) {
      cv = document.createElement('canvas'); cv.className = 'mr-canvas-page';
      cv.style.width = pageW + 'px'; cv.style.height = pageH + 'px';
      cv.style.left = (idx * step) + 'px';
      cv.width = Math.round(pageW * dpr); cv.height = Math.round(pageH * dpr);
      strip.appendChild(cv); drawn[idx] = cv;
    }
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); ctx.clearRect(0, 0, pageW, pageH);
    ctx.textBaseline = 'top';
    let y = topPad;
    lnPage.forEach(function (ln) {
      let x = inner + (ln.indent ? fs * 2 : 0);
      if (ln.title) {
        ctx.font = 'bold ' + Math.round(fs * 1.3) + 'px ' + fontName;
        x = inner + Math.max(0, (availW - segW(ctx, ln.chars)) / 2);
      } else ctx.font = fs + 'px ' + fontName;
      const natural = segW(ctx, ln.chars);
      const lineAvail = availW - (ln.indent ? fs * 2 : 0);
      const extra = (!ln.title && !ln.blockLast && natural < lineAvail - 2) ? (lineAvail - natural) / Math.max(1, ln.chars.length - 1) : 0;
      ctx.fillStyle = fg();
      let cx = x;
      ln.chars.forEach(function (c) { ctx.fillText(c, cx, ln.title ? y + lh * 0.1 : y); cx += ctx.measureText(c).width + ls + extra; });
      if (ln.title && ln.blockLast) { ctx.globalAlpha = .5; ctx.fillRect(inner + availW / 2 - 15, y + lh * 1.2, 30, 2); ctx.globalAlpha = 1; }
      y += lh * (ln.title ? 1.7 : 1 + (ln.blockLast ? .45 : 0));
    });
    return true;
  }
  function ensureAround() {
    const lo = Math.max(0, spread - 1), hi = Math.min(pages.length - 1, spread + 1);
    for (let p = lo; p <= hi; p++) drawPage(p);
  }
  function paint() {
    if (!wrap || !strip) return;
    strip.style.transform = 'translateX(' + (-spread * step) + 'px)';
    if (tip) tip.textContent = '第 ' + (spread + 1) + ' / ' + Math.max(1, pages.length) + ' 页 · ← → 或点屏翻页';
    ensureAround();
  }
  function go(delta) {
    const next = Math.max(0, Math.min(pages.length - 1, spread + delta));
    if (next === spread) return;
    spread = next; paint();
  }
  function rebuild() {
    if (!active() || !wrap) return;
    chKey = (BF.reader.state.title || '') + '|' + ((BF.reader.state.paras || [])[0] || '').slice(0, 40);
    layout(); paint();
  }
  function bindNav() {
    if (wrap.__bound) return; wrap.__bound = true;
    wrap.addEventListener('click', function (e) {
      const r = wrap.getBoundingClientRect();
      go((e.clientX - r.left) < r.width / 2 ? -1 : 1);
    });
    wrap.addEventListener('wheel', function (e) {
      e.preventDefault();
      if (Math.abs(e.deltaY) < 8) return;
      const now = Date.now();
      if (wrap.__wt && now - wrap.__wt < 260) return;
      wrap.__wt = now; go(e.deltaY > 0 ? 1 : -1);
    }, { passive: false });
  }
  function onKey(e) {
    if (!active()) return;
    if (e.key === 'ArrowRight' || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); go(1); }
    else if (e.key === 'ArrowLeft' || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); go(-1); }
  }
  function watchChapter() {
    /* 章节切换：paras 引用/首段变了就重排；TTS 段落高亮变化只重绘当前页（轻量） */
    if (off) { try { off(); } catch (e) {} off = null; }
    if (ttsTimer) { clearInterval(ttsTimer); ttsTimer = null; }
    if (BF.bus && BF.bus.on && BF.EVENTS && BF.EVENTS.PROGRESS) {
      off = BF.bus.on(BF.EVENTS.PROGRESS, function () { if (!active()) return; const k = (BF.reader.state.title || '') + '|' + ((BF.reader.state.paras || [])[0] || '').slice(0, 40); if (k !== chKey) rebuild(); });
    }
  }
  function setOn(on) {
    const page = document.getElementById('page-reader');
    if (!page) return;
    if (on) {
      wrap = document.getElementById('mr-canvas-wrap');
      if (!wrap) {
        wrap = document.createElement('div'); wrap.className = 'mr-canvas-wrap'; wrap.id = 'mr-canvas-wrap';
        strip = document.createElement('div'); strip.className = 'mr-canvas-strip';
        tip = document.createElement('div'); tip.className = 'mr-canvas-tip';
        wrap.appendChild(strip); wrap.appendChild(tip); page.appendChild(wrap);
        bindNav();
      }
      strip = strip || wrap.querySelector('.mr-canvas-strip');
      tip = tip || wrap.querySelector('.mr-canvas-tip');
      const rm = document.getElementById('reader-main'); if (rm) rm.style.visibility = 'hidden';
      const wp = document.getElementById('reader-wrap'); if (wp) wp.style.overflow = 'hidden';
      requestAnimationFrame(function () { rebuild(); });
      watchChapter();
      document.addEventListener('keydown', onKey, true);
    } else {
      document.removeEventListener('keydown', onKey, true);
      if (off) { try { off(); } catch (e) {} off = null; }
      if (ttsTimer) { clearInterval(ttsTimer); ttsTimer = null; }
      const w = document.getElementById('mr-canvas-wrap'); if (w) w.remove();
      wrap = null; strip = null; tip = null;
      const rm = document.getElementById('reader-main'); if (rm) rm.style.visibility = '';
      const wp = document.getElementById('reader-wrap'); if (wp) wp.style.overflow = '';
    }
  }
  function onMount() { if (active()) setOn(true); }
  function onDestroy() { setOn(false); }
  window.addEventListener('resize', function () { if (active()) rebuild(); });
  return { active: active, setOn: setOn, onMount: onMount, onDestroy: onDestroy, rebuild: rebuild, go: go };
})();
BF.mr.mount = function () {
  if (document.getElementById('mr-root')) return;
  const page = document.getElementById('page-reader');
  if (!page) return;
  const root = document.createElement('div');
  root.id = 'mr-root';
  root.innerHTML =
    '<div id="mr-top" class="mr-top">' +
      '<button type="button" class="mr-top__back" data-mr-act="back" title="返回书架" aria-label="返回书架"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>' +
      '<span class="mr-top__title"></span>' +
      '<span class="mr-top__prog"></span>' +
    '</div>' +
    '<nav id="mr-rail" class="mr-rail"></nav>' +
    '<div class="mr-progress" id="mr-progress">' +
      '<div class="mr-progress__meta"><span id="mr-prog"></span><span id="mr-remain"></span></div>' +
      '<div class="mr-progress__track" id="mr-progress-track"><div class="mr-progress__fill" id="mr-progress-fill"></div></div>' +
    '</div>';
  page.appendChild(root);
  BF.mr._renderRail();
  BF.mr._updateTop();
  BF.mr._updateProgress();
  BF.mr._bindScroll();
  /* 进度条点击跳章（复用既有 gotoChapter） */
  const _track = document.getElementById('mr-progress-track');
  if (_track) {
    _track.addEventListener('click', function (e) {
      const b = BF.reader.state && BF.reader.state.book;
      if (!b || !b.totalChapters) return;
      const rect = _track.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
      const idx = Math.min(b.totalChapters - 1, Math.floor(p * b.totalChapters));
      BF.reader.gotoChapter(idx);
    });
  }
  /* 切章/进度变化时刷新轻量顶条与进度条（不改 gotoChapter，挂 BF.bus 的 PROGRESS 广播） */
  if (!BF.mr._busBound && BF.bus && BF.bus.on) {
    BF.bus.on(BF.EVENTS.PROGRESS, function () { BF.mr._updateTop(); BF.mr._updateProgress(); });
    BF.mr._busBound = true;
  }
  if (BF.mr.canvas) BF.mr.canvas.onMount();
};
/* 轻量顶条：书名 + 阅读进度（章节维度） */
BF.mr._updateTop = function () {
  const top = document.getElementById('mr-top');
  if (!top) return;
  const titleEl = document.getElementById('reader-book-title');
  const title = (titleEl && titleEl.textContent) || (BF.reader.state && BF.reader.state.book && BF.reader.state.book.title) || '北风';
  const titles = (BF.reader.state && BF.reader.state.bookTitles) || [];
  const total = titles.length || 0;
  const idx = BF.appState.currentChapterIdx || 0;
  const cur = Math.min(idx + 1, total || (idx + 1));
  const pct = total ? Math.round((idx + 1) / total * 100) : 0;
  const tEl = top.querySelector('.mr-top__title');
  const pEl = top.querySelector('.mr-top__prog');
  if (tEl) tEl.textContent = title;
  if (pEl) pEl.textContent = total ? (cur + '/' + total + ' · ' + pct + '%') : ('第' + cur + '章');
};
/* 右侧竖排图标条：目录 / AI 研读 / 想法笔记 / 书签 / 字体 / 设置 / 更多（不含划线——北风无打开划线面板能力，见任务书 F15）。
   图标复用北风既有 stroke 风格 SVG（与顶栏/底栏一致），不引入新图标库、不造新造型。每项必须调用既有实现。 */
BF.mr._renderRail = function () {
  const rail = document.getElementById('mr-rail');
  if (!rail) return;
  const I = {
    toc:       '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    ai:        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5 14 11.4 12 16l-2-4.6L5.5 9.5 10 7.6 12 3z"/><path d="M19 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2z"/></svg>',
    notes:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 4h16v12H7l-3 3V4z"/><line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="13" y2="13"/></svg>',
    bookmarks: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z"/></svg>',
    font:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7V5h16v2"/><path d="M12 5v14"/><path d="M9 19h6"/></svg>',
    settings:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>',
    menu:      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="5" cy="12" r="1.6" fill="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/><circle cx="19" cy="12" r="1.6" fill="currentColor"/></svg>'
  };
  const B = [
    ['toc', '目录', I.toc],
    ['ai', 'AI 研读中心', I.ai],
    ['notes', '想法 / 笔记', I.notes],
    ['bookmarks', '书签', I.bookmarks],
    ['font', '字体', I.font],
    ['settings', '设置', I.settings],
    ['menu', '更多', I.menu]
  ];
  rail.innerHTML = B.map(function (b) {
    return '<button class="mr-rail-btn" data-mr-act="' + b[0] + '" title="' + b[1] + '" aria-label="' + b[1] + '">' + b[2] + '</button>';
  }).join('');
  /* 委托：图标按钮动态渲染，用一次性全局 click 委托（_railDelegated 保证只绑一次，规避监听器堆积） */
  if (!BF.mr._railDelegated) {
    BF.mr._railDelegated = true;
    document.addEventListener('click', function (e) {
      const btn = e.target.closest('[data-mr-act]');
      if (!btn) return;
      const act = btn.dataset.mrAct;
      if (act === 'back') { BF.reader.exitMicroread(); BF.app.closeReader(); }
      else if (act === 'menu') BF.mr.openPanel();
      else if (act === 'toc') BF.mr.tocPanel();
      else if (act === 'ai') BF.aiUI.toggle();
      else if (act === 'notes') BF.reader.openDrawer('notes');
      else if (act === 'bookmarks') BF.reader.openDrawer('bookmarks');
      else if (act === 'font') BF.mr.openTypeset();
      else if (act === 'settings') BF.settingsUI.open('reading');
    });
  }
};
/* 退出微读时整体移除 #mr-root——经典模式下列表/图标条必须不可见且不可点 */
BF.mr.destroy = function () {
  if (BF.mr.canvas) BF.mr.canvas.onDestroy();
  if (BF.mr._ac) { try { BF.mr._ac.abort(); } catch (e) {} BF.mr._ac = null; }
  BF.mr._scrollBound = false;
  /* 三个浮层都由 _popover 挂在 #mr-root 下，remove(root) 本该一并带走；
     这里先逐个点名摘除是双保险——退出微读后浮层不可见、不可点，
     而此时已没有「更多」按钮能关它。 */
  ['mr-menu', 'mr-typeset', 'mr-toc'].forEach(function (x) {
    const e = document.getElementById(x);
    if (e) e.remove();
  });
  const root = document.getElementById('mr-root');
  if (root) root.remove();
};
BF.mr.openPanel = function () {
  /* 「更多」菜单也走 _popover 工厂：挂 #mr-root（不再往 body 上append）、与排版/目录
     三个浮层互斥、外点关闭都由工厂一处管。挂进 #mr-root 还有一层用处——
     自动隐藏顶条/图标条的判据读的是 root 下有没有 .mr-pop，菜单若挂在 body 上，
     开着菜单也会被当成「没有浮层」，顶条照旧滑走。 */
  const el = BF.mr._popover('mr-menu', null, function (menu) {
  /* listbox/option + 共享游标：浮层开着时键盘必须能进菜单——
     没有这套处理，方向键完全进不去，Esc 也只关得掉 sheet 层、管不到浮层。 */
  menu.setAttribute('role', 'listbox');
  menu.setAttribute('aria-label', '微读更多');
  menu.tabIndex = -1;
  var MI = {
    shelf: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 5h6v14H4zM10 5h10v14H10z"/></svg>',
    book: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 6c-1.5-1-4-1.5-7-1.5V19c3 0 5.5.5 7 1.5 1.5-1 4-1.5 7-1.5V4.5C16 4.5 13.5 5 12 6z"/><path d="M12 6v14"/></svg>',
    noise: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12h3l2-7 4 16 3-12 2 6h4"/></svg>',
    tomato: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="13" r="7"/><path d="M12 9v4l2.5 2.5"/><path d="M9 2h6"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"/><path d="M6 21v-7"/><path d="M11 21V8"/><path d="M16 21v-4"/></svg>',
    noti: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
    /* 与顶栏那道门同一个字形：BF.dom._ic.sheet（面板 + 左栏）。 */
    wb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>',
    ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l2.4 5.5L20 9l-4 4 1 6-5-3-5 3 1-6-4-4 5.6-.5z"/></svg>',
    settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
  };
  const items = [
    { label: '返回书架', icon: 'shelf', run: function () { BF.reader.exitMicroread(); BF.app.closeReader(); } },
    { label: '切换到经典模式', icon: 'book', run: function () { BF.reader.exitMicroread(); } },
    { label: '─', sep: true },
    /* 这几项必须调用全站真实存在的入口（与 BF.uiMenu itemsFor 同一套）——
       指向不存在的实现（未知场景名/不存在的方法名）时，点击要么静默无反应、
       要么直接 TypeError，且 apply() 对未知名称是「if (!p) return;」静默返回。 */
    { label: '白噪音', icon: 'noise', run: function () { BF.wsUI.toggleNoise(); } },
    { label: '番茄钟', icon: 'tomato', run: function () { BF.wsUI.toggleFocus(); } },
    { label: '阅读统计', icon: 'stats', run: function () { BF.wsUI.toggleStats(); } },
    { label: '通知中心', icon: 'noti', run: function () { BF.wsUI.openNotiCenter(); } },
    /* 微读没有顶栏（.mr-top 不是 .topbar），这枚菜单项是它唯一的
       工作台入口，名字与顶栏那道门一致。 */
    { label: '工作台', icon: 'wb', run: function () { BF.workbench && BF.workbench.toggle(); } },
    { label: 'AI 研读中心', icon: 'ai', run: function () { BF.aiUI.toggle(); } },
    { label: '设置', icon: 'settings', run: function () { BF.settingsUI.toggle(); } }
  ];
  var nOpt = 0;
  items.forEach(function (it) {
    /* D2：工作台在微读里只有这枚菜单入口，devTools 关时不渲染，功能仍可由 DSL 打开 */
    if (it.icon === 'wb' && !BF.settings.get('devTools')) return;
    if (it.sep) {
      var hr = document.createElement('div');
      hr.className = 'mr-menu__sep';
      menu.appendChild(hr);
      return;
    }
    var el = document.createElement('div');
    el.className = 'mr-menu__item';
    el.setAttribute('role', 'option');
    el.setAttribute('aria-selected', 'false');
    el.id = 'mrm-item-' + nOpt; nOpt++;
    var ico = it.icon ? '<span class="mr-menu__ico">' + (MI[it.icon] || '') + '</span>' : '';
    el.innerHTML = ico + '<span class="mr-menu__label">' + BF.dom.esc(it.label) + '</span>';
    el.onclick = function () {
      /* 单项报错不拖垮整个菜单，但也不静默吞掉——问题不在报错本身，
         在报错之后用户看不到任何反馈。*/
      try { it.run(); } catch (e) {
        BF.log.warn('微读菜单项执行失败：' + it.label + ' —— ' + (e && e.message));
        try { BF.noti.warn('「' + it.label + '」本次没能打开'); } catch (e2) {}
      }
      menu.remove();
    };
    menu.appendChild(el);
  });
  menu.addEventListener('keydown', function (e) {
    if (e.key === 'Tab') { menu.remove(); return; }
    /* Esc 必须在这里就地关掉菜单并止流：菜单虽然挂在 #mr-root 下，但不进 BF.sheet 账本，
       全局 Esc 那一路只管得到面板、管不到它。不拦的话一次按键两层各干各的，菜单原地不动。 */
    if (e.key === 'Escape') { e.stopPropagation(); menu.remove(); return; }
    var nds = Array.prototype.slice.call(menu.querySelectorAll('.mr-menu__item'));
    var ctl = {
      nodes: function () { return nds; },
      active: function () { return +(menu.dataset.act || 0); },
      setActive: function (n2) { menu.dataset.act = BF.app.sel.cursor(nds, n2, menu); },
      pick: function (n2) { if (nds[n2]) nds[n2].click(); },
      close: function () { menu.remove(); },
    };
    BF.app.sel.nav(e, ctl);
  });
  });
  /* 焦点与游标都得等节点进了 DOM 再给：build 是在挂载之前跑的，对未挂载元素调
     focus() 是空操作，而这个浮层的 keydown 挂在它自己身上 —— 不给焦点方向键完全进不来。
     游标同理，cursor() 要把首项滚进视野，脱离文档时算了白算。 */
  if (el) {
    try { el.focus(); } catch (e) { BF.err.report('mr.menu.focus', e); }
    try { el.dataset.act = BF.app.sel.cursor(el.querySelectorAll('.mr-menu__item'), 0, el); } catch (e) { BF.err.report('mr.menu.cursor', e); }
  }
};
