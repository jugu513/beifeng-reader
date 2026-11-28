/* ================= R10. 抽屉（目录/搜索/书签/笔记/生词/标注 6 tab） ================= */
/* 入口按钮（顶栏「目录」）= 再点一次收起。
   「打开抽屉并停在某一栏」是导航，必须走 openDrawer ——两件事若挤在同一个
   toggleDrawer 上、调用方各自补一句 drawerTab，抽屉本来开着时那条链会先把抽屉关掉，
   再把栏位写进一个已经关上的抽屉（表现为：书卡回顾、微读栏点便签/书签，抽屉直接没影）。 */
BF.reader.toggleDrawer = function () {
  BF.sheet.toggle('drawer', { render: function () { BF.reader.renderDrawer(); } });
};
BF.reader.openDrawer = function (tab) {
  if (!BF.sheet.isOpen('drawer')) BF.sheet.open('drawer', { render: function () { BF.reader.renderDrawer(); } });
  if (tab) BF.reader.drawerTab(tab);
};
BF.reader.closeDrawer = function () { BF.sheet.close('drawer'); };
BF.reader.drawerTab = function (tab) {
  BF.appState.drawerTabName = tab;
  document.querySelectorAll('[data-drawer-tab]').forEach(function (b) {
    const on = b.dataset.drawerTab === tab;
    b.setAttribute('aria-selected', on ? 'true' : 'false');
    b.setAttribute('tabindex', on ? '0' : '-1');
  });
  const body = document.getElementById('drawer-body');
  if (body) body.setAttribute('aria-labelledby', 'drawer-tab-' + tab);
  /* 目录 tab 在 body 上挂了虚拟列表的滚动重绘；切走必须摘掉，否则每次滚动都对着已 detach 的节点重算全表 */
  if (body && tab !== 'toc') body.onscroll = null;
  BF.reader.renderDrawer();
};
/* 抽屉 tab 键盘导航（roving tabindex 已随 drawerTab 设置）。
   ArrowLeft/Right（及 Up/Down）在 tab 间移动并切换；Home/End 跳到首尾。
   仅在 tablist 上挂一次（__bfKeys 守卫，避免 renderDrawer 反复调用堆叠监听）。 */
BF.reader.bindDrawerTabs = function () {
  const list = document.getElementById('drawer-tabs');
  if (!list || list.__bfKeys) return;
  list.__bfKeys = true;
  list.addEventListener('keydown', function (e) {
    const tabs = Array.prototype.slice.call(list.querySelectorAll('[data-drawer-tab]'));
    if (!tabs.length) return;
    const i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    let n = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = tabs.length - 1;
    else return;
    e.preventDefault();
    tabs[n].focus();
    BF.reader.drawerTab(tabs[n].dataset.drawerTab);
  });
};
BF.reader.renderDrawer = function () {
  const c = document.getElementById('drawer-body');
  if (!c) return;
  const tab = BF.appState.drawerTabName;
  if (tab === 'toc') BF.reader.renderTOC(c);
  else if (tab === 'search') BF.reader.renderSearch(c);
  else if (tab === 'bookmarks') BF.reader.renderBookmarks(c);
  else if (tab === 'notes') BF.reader.renderNotes(c);
  else if (tab === 'vocab') BF.reader.renderVocab(c);
  else if (tab === 'marks') BF.reader.renderMarks(c);
  /* 抽屉标签计数徽标（书签/笔记/生词/标注）随当前书实时刷新；
     复用诊断那套 .pane-tab__n 徽标样式，避免另起一套令牌。 */
  try { BF.reader.updateDrawerTabBadges(); } catch (e) { BF.err.report('renderDrawer.badges', e); }
  /* 抽屉 tablist 键盘导航（只挂一次） */
  try { BF.reader.bindDrawerTabs(); } catch (e) {}
};
/* 抽屉标签计数徽标：统计当前书的书签/笔记/生词/标注条数，写入对应
   data-drawer-tabn 徽标；为 0 则隐藏（与诊断徽标 [hidden] 规则一致）。 */
BF.reader.updateDrawerTabBadges = function () {
  const bid = BF.appState.currentBookId;
  const counts = { bookmarks: 0, notes: 0, vocab: 0, marks: 0 };
  if (bid) {
    try {
      const _cnt = function (k) {
        const arr = BF.store.lsGet(k, []) || [];
        let n = 0;
        for (let i = 0; i < arr.length; i++) { if (arr[i] && arr[i].bookId === bid) n++; }
        return n;
      };
      counts.bookmarks = _cnt(BF.store.K.BOOKMARKS);
      /* 徽标必须与点开后的列表同源：抽屉「笔记」tab 渲染的是 HIGHLIGHTS（renderNotes），
         数 NOTES 会出现「笔记 5」点进去 0 条。 */
      counts.notes = _cnt(BF.store.K.HIGHLIGHTS);
      counts.vocab = _cnt(BF.store.K.VOCAB);
      counts.marks = _cnt(BF.store.K.HIGHLIGHTS);
    } catch (e) { BF.log && BF.log.warn('store.标注计数读取失败，侧栏计数将停在旧值：' + (e && e.message)); }
  }
  /* 把可见计数同步进 aria-label（读屏报「书签，3 条」），与屏幕徽标一致 */
  const _lbl = { bookmarks: '书签', notes: '笔记', vocab: '生词', marks: '标注' };
  ['bookmarks', 'notes', 'vocab', 'marks'].forEach(function (t) {
    const el = document.querySelector('[data-drawer-tabn="' + t + '"]');
    if (!el) return;
    const n = counts[t];
    if (n > 0) { el.textContent = n > 99 ? '99+' : String(n); el.hidden = false; }
    else { el.hidden = true; el.textContent = ''; }
    const tabEl = el.closest('[data-drawer-tab]');
    if (tabEl) tabEl.setAttribute('aria-label', _lbl[t] + (n > 0 ? ('，' + n + ' 条') : ''));
  });
};
/* 抽屉就地刷新：增删书签/笔记/生词写存储后必须重绘抽屉，
   否则抽屉正好开着对应页时新条目不会出现（要关掉重开才看得到） */
BF.reader.refreshDrawer = function () {
  if (!BF.sheet.isOpen || !BF.sheet.isOpen('drawer')) return;
  try { BF.reader.renderDrawer(); } catch (e) { BF.err.report('refreshDrawer', e); }
};
BF.reader.renderTOC = function (c) {
  const b = BF.reader.state.book;
  if (!b) { c.innerHTML = '<div class="cmdk-empty">请先打开一本书</div>'; return; }
  const titles = BF.reader.state.bookTitles || [];
  if (!titles.length) {
    BF.library.getChapterTitles(b.id).then(function (t) {
      BF.reader.state.bookTitles = t;
      if (BF.appState.drawerTabName === 'toc') BF.reader.renderTOC(c);
    });
    c.innerHTML = BF.ui.loading('目录加载中…');
    return;
  }
  const cur = BF.appState.currentChapterIdx;
  /* 每章进度条：已读章满条，当前章按章内分数（READING_STATE.chapterFrac），未读不画。
     只在渲染后补节点、宽度走 style.width（不往 HTML 里塞内联样式，闸门 ⑫ 有内联样式上限）。 */
  const _rsAll = (function () { try { return BF.store.lsGet(BF.store.K.READING_STATE, {}) || {}; } catch (e) { return {}; } })();
  const _curRec = _rsAll[b.id] || {};
  const _curPct = Math.round(Math.min(1, Math.max(0, typeof _curRec.chapterFrac === 'number' ? _curRec.chapterFrac : 0)) * 100);
  const paintProg = function () {
    const nodes = view.querySelectorAll('[data-goto-ch]');
    for (let k = 0; k < nodes.length; k++) {
      const i = +nodes[k].getAttribute('data-goto-ch');
      const p = i < cur ? 100 : (i === cur ? _curPct : 0);
      if (!p) continue;
      const bar = document.createElement('span');
      bar.className = 'toc-prog';
      if (p >= 100) {
        /* 100% 时改形态：实心圆点（已读完）替代进度条，避免「100% 宽条」与「未读 0%」在视觉上无法区分 */
        bar.style.width = '8px';
        bar.style.height = '8px';
        bar.style.borderRadius = '50%';
        bar.style.background = 'var(--accent)';
        bar.style.opacity = '1';
      } else {
        bar.style.width = Math.max(2, p) + '%';
      }
      nodes[k].appendChild(bar);
    }
  };
  /* 扉页章（第 0 章装的是书名那一行）不进目录。
     判据与 openBook 同一份真源：BF.library.isPseudoHead（认字面，不认长度）。 */
  const _t0 = titles[0];
  const _isPseudo = BF.library.isPseudoHead(_t0, b && b.title);
  /* 文首信息块面板（设置项 bookInfoPanel）：站点导出的 TXT 开头那段元信息
     （书名/作者/字数/章节数/书籍 ID…）在目录顶部多给一个看原文的入口。
     只做入口：第 0 章那一行照旧留在目录里，不折叠、不跳章、不改章号 ——
     分章只是切片，显示层任何改造都不许把内容吞掉或让某一章变得不可达。
     关掉开关就退回原样（那段仍按普通章节显示）。 */
  const _infoOn = !!BF.settings.get('bookInfoPanel');
  const _infoText = (_infoOn && b && BF.reader.state.bookInfoFor === b.id) ? (BF.reader.state.bookInfoText || '') : '';
  if (_infoOn && b && !_infoText && !BF.reader.state.__infoProbe) {
    /* 正文还没读过：异步探一次首章，认出来就带着面板重绘一次。
       额度一次一本书（openBook 里随书复位），免得每次滚动重绘都发一次 IDB 读。 */
    BF.reader.state.__infoProbe = 1;
    BF.library.getChapterText(b, 0).then(function (t) {
      if (!BF.library.isBookInfoBlock(t)) return;
      BF.reader.state.bookInfoText = t;
      BF.reader.state.bookInfoFor = b.id;
      if (BF.appState.drawerTabName === 'toc') BF.reader.renderTOC(c);
    }).catch(function (e) { BF.err.report('toc.infoProbe', e); });
  }
  /* 目录按卷分组：识别「第X卷 / 上卷 / 卷X」等卷标，后续章节归入该卷，直到下一个卷标 */
  const VOL_RE = /(第?\s*[一二三四五六七八九十百千]+\s*卷|上卷|中卷|下卷|卷\s*[一二三四五六七八九十百千0-9]+)/;
  const groups = [];
  let curGroup = null;
  titles.forEach(function (t, i) {
    if (_isPseudo && i === 0) return;   /* 伪章不进目录 */
    /* F-04：文首信息块在第 0 章时，目录里如实标注「（信息页·非正文）」——
       正文留在原章不删不跳过（零丢字硬约束），只把label说明白，别让用户以为是漏章。 */
    const label = (i === 0 && BF.reader.state.bookInfoFor === b.id)
      ? '书籍信息（非正文）' : (t || ('第' + (i + 1) + '章'));
    const vm = label.match(VOL_RE);
    if (vm) { curGroup = { vol: label, items: [] }; groups.push(curGroup); }
    else { if (!curGroup) { curGroup = { vol: '', items: [] }; groups.push(curGroup); } curGroup.items.push({ i: i, label: label }); }
  });
  /* 目录虚拟列表：3000 章全量建 DOM 节点会卡，渲染的节点数必须压到可视区规模。
     扁平化为「卷标行 + 章节行」数组，固定行高（见下面 ROW/VOL，只此一处定义），
     只渲染可视区 ± 30 行缓冲，滚动时按 scrollTop 切片重渲染。
     ROW 取 32px：这是点击目标，低于 32 在触屏与手抖场景容易点空——
     行高、内联 height/line-height、总高三处必须同源，改一处就错位。 */
  const ROW = 32, VOL = 26, BUF = 30;
  const flat = [];
  groups.forEach(function (g) {
    if (g.vol) flat.push({ type: 'vol', label: g.vol, h: VOL });
    g.items.forEach(function (it) { flat.push({ type: 'item', i: it.i, label: it.label, h: ROW, it: it }); });
  });
  if (_infoText) flat.unshift({ type: 'info', label: '文首信息块（原文）', h: ROW });
  const totalH = flat.reduce(function (s, r) { return s + r.h; }, 0);
  const list = document.createElement('div');
  list.id = 'toc-list';
  list.style.cssText = 'position:relative;height:' + totalH + 'px;overflow:hidden';
  const view = document.createElement('div');
  view.id = 'toc-view';
  list.appendChild(view);
  const body = document.getElementById('drawer-body');
  /* 目标章行的 y 坐标：按 flat 表逐行累计（卷标行/信息行也占高）。
     虚拟列表只渲染可视区 ± 缓冲，目标行多半不在 DOM 里——
     scrollIntoView 摸不到没渲染的节点，定位必须走算出来的 y 落 scrollTop。 */
  const rowY = function (ch) {
    let y = 0;
    for (let i = 0; i < flat.length; i++) {
      if (flat[i].type === 'item' && flat[i].i === ch) return y;
      y += flat[i].h;
    }
    return -1;
  };
  const scrollToCh = function (ch) {
    if (!body) return false;
    const y = rowY(ch);
    if (y < 0) return false;
    body.scrollTop = Math.max(0, y - (body.clientHeight - ROW) / 2);
    return true;
  };
  /* 面板行只做一件事：把那段的原文弹出来看。不改当前章、不动任何目录行，
     所以它既不带 data-goto-ch，也不参与进度条与「回到当前位置」的选取。 */
  view.addEventListener('click', function (e) {
    const t = e.target && e.target.closest ? e.target.closest('[data-info-panel]') : null;
    if (!t) return;
    BF.modal.custom('文首信息块（原文）',
      '<pre class="toc-info-pre">' + BF.dom.esc(BF.reader.state.bookInfoText || '') + '</pre>');
  });
  view.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const t = e.target && e.target.closest ? e.target.closest('[data-info-panel]') : null;
    if (!t) return;
    e.preventDefault();
    t.click();
  });
  /* 行 HTML 只写一处：虚拟切片与过滤两条渲染路径共用同一支模板。
     两处各写一份时，「行高 / 内联 height+line-height / 总高」这三个同源口径
     会在其中一处漂移，错位就出在滚过缓冲区的行上。 */
  const rowHtml = function (r, y) {
    if (r.type === 'vol')
      return '<div class="toc-vol" style="position:absolute;top:' + y + 'px;left:0;right:0;height:' + VOL + 'px;line-height:' + VOL + 'px;padding:0 10px;font-size:12px;color:var(--text-weak);box-sizing:border-box">' + BF.dom.esc(r.label) + '</div>';
    if (r.type === 'info')
      /* 面板行没有章号：不带 data-goto-ch，进度条与「回到当前位置」都不会误把它当章节 */
      return '<div class="drawer-item" data-info-panel="1" role="button" tabindex="0" aria-label="查看文首信息块原文" style="position:absolute;top:' + y + 'px;left:0;right:0;height:' + ROW + 'px;line-height:' + ROW + 'px;padding:0 10px;border-radius:var(--r-sm);cursor:pointer;font-size:13px;box-sizing:border-box;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:var(--text-dim)">' + BF.dom.esc(r.label) + '</div>';
    return '<div class="drawer-item" data-goto-ch="' + r.i + '" data-toc-title="' + BF.dom.escAttr(String(r.label).toLowerCase()) + '" style="position:absolute;top:' + y + 'px;left:0;right:0;height:' + ROW + 'px;line-height:' + ROW + 'px;padding:0 10px;border-radius:var(--r-sm);cursor:pointer;font-size:13px;box-sizing:border-box;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;' +
      (r.i === cur ? 'color: var(--accent-ink);font-weight:600;background:var(--bg-input)' : 'color:var(--text-dim)') + '">' +
      BF.dom.esc(r.label) + '</div>';
  };
  const renderWin = function () {
    const st = body.scrollTop;
    const vh = body.clientHeight;
    /* 行号 → y 位置（累计高度） */
    let acc = 0, startIdx = 0, endIdx = flat.length;
    for (let i = 0; i < flat.length; i++) {
      if (acc + flat[i].h > st && startIdx === 0) { startIdx = Math.max(0, i - 1); }
      if (acc > st + vh + BUF * ROW) { endIdx = i; break; }
      acc += flat[i].h;
    }
    startIdx = Math.max(0, (startIdx || 0) - BUF);
    endIdx = Math.min(flat.length, endIdx + BUF);
    let html = '', y = 0;
    for (let i = 0; i < startIdx; i++) y += flat[i].h;
    for (let i = startIdx; i < endIdx; i++) {
      const r = flat[i];
      html += rowHtml(r, y);
      y += r.h;
    }
    view.innerHTML = html;
    /* 过滤态会把 list 高度压成命中行的高度，回到未过滤时必须还原全表高度，
       否则滚动条长度还停在过滤后的短值，后面几章滚不到。 */
    list.style.height = totalH + 'px';
    paintProg();
  };
  c.innerHTML = '<input class="input" id="toc-filter" placeholder="过滤目录（输入关键词）..." style="width:100%;margin-bottom:8px" data-toc-filter/>' +
    '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
    '<span style="font-size:11px;color:var(--text-weak)">共 ' + (titles.length - (_isPseudo ? 1 : 0)) + ' 章 · 当前第 ' + Math.max(1, cur + 1 - (_isPseudo ? 1 : 0)) + ' 章</span>' +
    '<span style="display:flex;gap:6px">' +
    '<button class="btn btn-xs" id="toc-manage" title="手动合并/拆分/改名章节">✎分章</button>' +
    '<button class="btn btn-xs" id="toc-locate" title="滚动到当前阅读的章节">回到当前位置</button></span></div>';
  c.appendChild(list);
  /* 换书后的第一次目录渲染要落在当前章：#drawer-body 是常驻节点，
     scrollTop 跨书残留——上一本滚到 1200px，换本书打开目录还停在那，
     看到的是另一本书的中段。定位只在新书首渲做；同书重渲（异步标题/
     信息块补绘）不许抢用户已经滚到的位置。 */
  if (BF.reader.state.__tocBookId !== b.id) {
    BF.reader.state.__tocBookId = b.id;
    if (!scrollToCh(cur) && body) body.scrollTop = 0;
  }
  renderWin();
  if (body) body.onscroll = function () { if (BF.appState.drawerTabName === 'toc') renderWin(); };
  /* 目录过滤：实时隐藏不匹配的章节（虚拟列表下重新切片） */
  const f = document.getElementById('toc-filter');
  if (f) f.oninput = function () {
    const k = (f.value || '').trim().toLowerCase();
    /* 过滤结果是一次性全量写的静态定位行；此时 body 上挂的滚动重绘仍在按
       「未过滤切片」重算，一滚动就把过滤结果整片覆盖回未过滤的章节。
       故过滤期间摘掉滚动重绘，清空关键词时按原条件挂回。 */
    if (body) body.onscroll = k ? null : function () { if (BF.appState.drawerTabName === 'toc') renderWin(); };
    if (!k) { renderWin(); return; }
    /* 过滤时退化为全量渲染（结果通常很少），避免虚拟切片与过滤叠加复杂度 */
    let html = '', y = 0;
    flat.forEach(function (r) {
      if (r.type === 'vol' || r.type === 'info' || String(r.label).toLowerCase().includes(k)) {
        html += rowHtml(r, y);
        y += r.h;
      }
    });
    view.innerHTML = html;
    /* 过滤结果的真实高度：list 原先是全表高，不压回来的话滚动条与内容脱节
       （能滚进一大片空白）。 */
    list.style.height = Math.max(y, 1) + 'px';
    paintProg();
  };
  /* 回到当前位置：长书翻目录后找不到自己在哪。虚拟列表下目标行多半没渲染，
     scrollIntoView 摸不到它（长书表现为「点了没反应」）——改按 flat 表算 y
     直接落 scrollTop，滚动重绘自会把目标行补出来。 */
  const loc = document.getElementById('toc-locate');
  if (loc) loc.onclick = function () {
    /* 过滤态下列表是压缩静态表，y 已失义：先清过滤（恢复滚动重绘与全表高）再定位 */
    const f = document.getElementById('toc-filter');
    if (f && f.value) {
      f.value = '';
      if (body) body.onscroll = function () { if (BF.appState.drawerTabName === 'toc') renderWin(); };
      renderWin();
    }
    if (!scrollToCh(cur)) BF.noti.info('当前章节不在目录中');
  };
  /* L-2 入口：打开分章管理模态框 */
  const mg = document.getElementById('toc-manage');
  if (mg) mg.onclick = function () { try { BF.reader.chapterManager(); } catch (e) { BF.err.report('toc-manage', e); } };
};
/* 人工微调·分章管理模态框：列出当前书全部章节，支持
   改名（按 sid 持久化，重分章后仍生效）、合并相邻两章（内容拼接，零丢失）、
   拆分（在指定字数处切开）、以及「重新自动分章」（清除手动结构）。
   所有编辑均走 BF.library.rebuildBookChapters —— 从存储重建全文再按 bounds 重新切片，
   内容永不增删；合并/拆分只是移动边界，改名只是按 sid 覆写标题。 */
BF.reader.chapterManager = function () {
  const bookId = BF.appState.currentBookId;
  if (!bookId) { BF.noti.warn('请先打开一本书'); return; }
  const b = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (x) { return x && x.id === bookId; });
  if (!b) { BF.noti.warn('书不存在'); return; }
  const overlay = document.createElement('div');
  overlay.className = 'cm-mask';
  const panel = document.createElement('div');
  panel.className = 'cm-panel';
  overlay.appendChild(panel);
  document.body.appendChild(overlay);
  const close = function () { overlay.remove(); };
  overlay.addEventListener('click', function (e) { if (e.target === overlay) close(); });

  let full = '', bounds = [], chapters = [], renames = Object.assign({}, b.chapterRenames || {});
  const header = document.createElement('div');
  header.className = 'cm-head';
  const htitle = document.createElement('div');
  htitle.className = 'cm-title';
  htitle.textContent = '分章管理 · ' + (b.title || '');
  const hbtns = document.createElement('div');
  hbtns.className = 'cm-btns';
  hbtns.innerHTML = '<button class="btn btn-xs" id="cm-auto">重新自动分章</button><button class="btn btn-xs" id="cm-close">关闭</button>';
  header.appendChild(htitle); header.appendChild(hbtns);
  panel.appendChild(header);
  const list = document.createElement('div');
  list.className = 'cm-list';
  panel.appendChild(list);
  const foot = document.createElement('div');
  foot.className = 'cm-foot';
  foot.textContent = '合并：相邻两章拼接为一段（不丢字）。拆分：在指定字数处切开。改名：按章节稳定 ID 保存，重新分章后仍生效。卷标以「卷」徽标显示。';
  panel.appendChild(foot);

  const loadFull = async function () {
    full = await BF.library.rebuildCleanedText(b);
    bounds = await BF.library.getCurrentBounds(bookId);
  };
  const rebuildLocal = function () {
    const adetect = BF.settings.get('autoDetectTitle') !== false;
    const ch = BF.library._buildChapters(full, bounds, { autoDetectTitle: adetect });
    BF.library.__ensureSid(ch);
    ch.forEach(function (c) { if (c.sid != null && renames[c.sid] != null) c.title = renames[c.sid]; });
    chapters = ch;
  };
  const refreshTitles = async function () {
    const t = await BF.library.getChapterTitles(bookId);
    BF.reader.state.bookTitles = t || [];
    if (BF.appState.drawerTabName === 'toc') BF.reader.renderDrawer();
  };
  const render = function () {
    list.innerHTML = '';
    chapters.forEach(function (c, i) {
      const row = document.createElement('div');
      row.className = 'cm-row';
      const idx = document.createElement('span');
      idx.className = 'cm-idx';
      idx.textContent = (i + 1);
      const badge = document.createElement('span');
      badge.className = 'cm-badge';
      badge.textContent = '卷';
      badge.style.display = (c.level === 0) ? '' : 'none';
      const inp = document.createElement('input');
      inp.className = 'input cm-inp';
      inp.value = c.title || '';
      inp.onchange = function () {
        const v = (inp.value || '').trim();
        if (!v) { inp.value = c.title || ''; return; }
        renames[c.sid] = v;
        applyEdits(null, { renames: Object.assign({}, renames) });
      };
      const wc = document.createElement('span');
      wc.className = 'cm-wc';
      wc.textContent = (c.content || '').length + '字';
      const mBtn = document.createElement('button');
      mBtn.className = 'btn btn-xs cm-btn';
      mBtn.textContent = '合并↓';
      if (i >= chapters.length - 1) mBtn.disabled = true;
      mBtn.onclick = function () {
        if (i >= bounds.length - 2) return;
        bounds.splice(i + 1, 1);   /* 合并第 i 章与第 i+1 章 */
        applyEdits(bounds.slice());
      };
      const sBtn = document.createElement('button');
      sBtn.className = 'btn btn-xs cm-btn';
      sBtn.textContent = '拆分';
      sBtn.onclick = async function () {
        const len = (c.content || '').length;
        if (len < 2) { BF.noti.warn('本章过短，无法拆分'); return; }
        const def = String(Math.floor(len / 2));
        const r = await BF.modal.prompt('在第几个字处拆分本章（共 ' + len + ' 字，范围 1-' + (len - 1) + '）', '第几个字处拆开', { value: def });
        if (r == null) return;
        let k = parseInt(r, 10);
        if (isNaN(k) || k < 1 || k > len - 1) { BF.noti.warn('拆分位置无效'); return; }
        const abs = bounds[i] + k;   /* 章节内偏移 k → 全文绝对偏移 */
        let pos = i + 1;
        while (pos < bounds.length && bounds[pos] < abs) pos++;
        bounds.splice(pos, 0, abs);
        applyEdits(bounds.slice());
      };
      row.appendChild(idx); row.appendChild(badge); row.appendChild(inp); row.appendChild(wc); row.appendChild(mBtn); row.appendChild(sBtn);
      list.appendChild(row);
    });
  };
  const applyEdits = async function (newBounds, extra) {
    try {
      const opts = { full: full };
      if (newBounds) opts.bounds = newBounds;
      if (extra && extra.renames) opts.renames = extra.renames;
      await BF.library.rebuildBookChapters(bookId, opts);
      bounds = await BF.library.getCurrentBounds(bookId);
      rebuildLocal();
      render();
      await refreshTitles();
      BF.noti.success('已更新分章（' + chapters.length + ' 章）');
    } catch (e) { BF.err.report('chapterManager.apply', e); BF.noti.error((e && e.userMessage) || '分章更新失败，见运维台'); }
  };
  hbtns.querySelector('#cm-close').onclick = close;
  hbtns.querySelector('#cm-auto').onclick = async function () {
    try {
      await BF.library.rebuildBookChapters(bookId, { full: full, clearBounds: true });
      renames = {};
      bounds = await BF.library.getCurrentBounds(bookId);
      rebuildLocal(); render(); await refreshTitles();
      BF.noti.success('已恢复自动分章');
    } catch (e) { BF.err.report('chapterManager.auto', e); BF.noti.error((e && e.userMessage) || '恢复失败'); }
  };
  (async function () {
    try { await loadFull(); rebuildLocal(); render(); }
    catch (e) { BF.err.report('chapterManager.init', e); BF.noti.error('加载分章失败'); }
  })();
};
BF.reader.renderSearch = function (c) {
  const hist = BF.store.lsGetArray(BF.store.K.SEARCH_HIST, []) || [];
  const histHtml = hist.length ? '<div style="margin:4px 0 8px"><span style="font-size:11px;color:var(--text-weak)">最近搜索：</span>' +
    hist.map(function (h) { return '<span class="chip" data-search-hist="' + BF.dom.escAttr(h) + '" style="cursor:pointer;margin:2px;display:inline-block;padding:2px 8px;background:var(--bg-input);border-radius:10px;font-size:11px;color:var(--text-dim)">' + BF.dom.esc(h) + '</span>'; }).join('') + '</div>' : '';
  c.innerHTML = '<div style="display:flex;gap:6px;margin-bottom:8px">' +
    '<input class="input" id="search-input" placeholder="搜索当前书全文..." style="flex:1" data-search-input/>' +
    '<button class="btn btn-sm" data-search-go style="flex:none">搜索</button></div>' +
    histHtml +
    '<div id="search-results" style="font-size:12px;color:var(--text-weak);padding:4px 0">输入关键词后回车搜索</div>';
  /* 占位文案承诺「回车搜索」，输入框就必须绑 keydown Enter——
     只绑 onChange（失焦才触发）时回车毫无反应（元素每次 render 新建，无重复绑定）。 */
  const inp = c.querySelector('#search-input');
  if (inp) inp.addEventListener('keydown', function (e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      const q = (inp.value || '').trim();
      if (q) BF.reader.searchAll(q);
    }
  });
};
/* R3-A：把搜索命中的 ctx 渲染成「以命中为中心」的摘要 HTML。
   流程严格遵循票务红线：先走现有转义（BF.dom.esc）把用户文本变安全 HTML，
   再在已转义串里定位命中词、用字面量 <mark> 包住——顺序反了（先包后转义）就是注入洞。
   切片以命中为轴取 −B/+A 字符；命中靠段首/段尾时贴边裁剪并加省略号，不强求对称。
   ctx 是检索层产出的窗口片段，pos 是章内绝对偏移（留给定位跳转，本函数不碰）。 */
BF.reader.searchExcerpt = function (ctx, q) {
  const c = String(ctx == null ? '' : ctx);
  const qn = String(q == null ? '' : q);
  if (!qn) return BF.dom.esc(c);
  /* 在 ctx 里用 1:1 折叠匹配定位命中（折叠不改长度，下标与原串一致）。 */
  const cf = BF.library._foldSearch(c);
  const qf = BF.library._foldSearch(qn);
  let hp = qf ? cf.indexOf(qf) : -1;
  if (hp < 0) hp = 0;
  const B = 20, A = 40;   /* 命中前约 20、命中后约 40，使摘要总宽大致恒定 */
  let s = hp - B, pre = '';
  if (s < 0) { s = 0; } else { pre = '…'; }
  let e = hp + qn.length + A, post = '';
  if (e > c.length) { e = c.length; } else { post = '…'; }
  const excerpt = c.slice(s, e);
  /* 先转义：excerpt 可能含 < & " ' 等敏感字符，必须过转义再插入 <mark>（顺序反了即注入洞）。
     esc 会把 " ' & < > 变成多字符实体，所以命中跨度长度必须以「转义后的查询」长度为准，
     不能再用折叠字符数 qf.length（那样遇到引号会少切）。 */
  const esc = BF.dom.esc(excerpt);
  const target = BF.dom.esc(qn);
  /* 在已转义串里折叠定位（fold 不改长度，命中下标对 esc 同样有效）；命中跨度用 target.length。 */
  const escFold = BF.library._foldSearch(esc);
  const tf = BF.library._foldSearch(target);
  let ep = tf ? escFold.indexOf(tf) : -1, hitLen = tf ? target.length : 0;
  if (ep < 0) { ep = esc.indexOf(target); hitLen = target.length; }
  if (ep < 0) return pre + esc + post;
  return pre + esc.slice(0, ep) + '<mark>' + esc.slice(ep, ep + hitLen) + '</mark>' + esc.slice(ep + hitLen) + post;
};
/* 章批次并发骨架与 Worker/主线程两套扫描都在 BF.library（searchBatchInWorker /
   scanBatchOnMain / eachChapterBatch），书内与跨书共用同一份；这里只是调用方。 */
BF.reader.searchAll = (function () {
  let _timer = null;
  let _gen = 0;
  /* F2：searchAll 改为「返回 Promise」。防抖仍保留（连续输入只搜最后一次），
     但调用方（DSL 等）能拿到结构化结果。
     旧 Promise 会被新搜索拒绝（AbortError 语义），避免旧结果覆盖新结果。 */
  let _pendingResolve = null;
  let _pendingReject = null;
  const SEARCH_CAP = 200;   /* 书内搜索的命中上限：扫描停止、返回条数、界面渲染共用这一个数 */
  return async function (q) {
    const b = BF.reader.state.book;
    const box = document.getElementById('search-results');
    if (!b || !q) return { query: q, total: 0, capped: false, hits: [] };
    /* 防抖：连续输入只搜最后一次（计时器统一走 BF.timers，卸载时可一并清掉） */
    if (_timer) { try { _timer(); } catch (e) {} _timer = null; }
    if (box) box.textContent = '搜索中...';
    /* 世代号：并发搜索只保留最新一次，避免旧结果覆盖新书/新词 */
    const myGen = ++_gen;
    /* 旧 Promise 作废（调用方拿到 rejected 可感知「被新搜索取代」，不视为错误） */
    if (_pendingReject) { try { _pendingReject(new Error('search superseded')); } catch (e) {} }
    _pendingResolve = null; _pendingReject = null;
    return new Promise(function (resolve, reject) {
      _pendingResolve = resolve; _pendingReject = reject;
      _timer = BF.timers.timeout(async function () {
      _timer = null;
      const out = [];
      /* 把「渲染 + 写搜索历史 + resolve」抽成 _finish，
         三路（Worker 命中 / 主线程全量 / 兜底）共用，杜绝路径分叉。Worker 分支已扫出结果时
         直接 _finish 并 return，跳过下方主线程全量扫描——漏掉 return 会让主线程
         无条件再扫一遍，结果整份重复 + 白跑一轮。 */
      const _finish = function () {
        if (myGen !== _gen) { reject(new Error('search superseded')); return; }
        const box2 = document.getElementById('search-results');
        /* 一份数字三处共用：扫描停止条件、返回的 hits、界面渲染的都是这 SEARCH_CAP 条。
           以前 total 数收集到的全部、hits 只给前 200、界面却把全部渲染出来——三个口径互相打脸。 */
        const capped = out.length >= SEARCH_CAP;
        const shown = out.slice(0, SEARCH_CAP);
        const result = { query: q, total: shown.length, capped: capped, hits: shown };
        if (box2) {
          if (!out.length) box2.innerHTML = '<div style="padding:10px;color:var(--text-weak)">未找到「' + BF.dom.esc(q) + '」，试试更短的关键词；书架的「搜正文」可跨书搜索</div>';
          else {
            /* R3-A：计数按去重后的命中数——同一段落多次命中按不同 pos 分开计，
               完全同 (章,pos) 的才算重复（实测 Worker/主线程两条路径不会产出这种重复）。 */
            const _seen = {};
            shown.forEach(function (r) { _seen[r.idx + ':' + r.pos] = 1; });
            const _n = Object.keys(_seen).length;
            box2.innerHTML = '<div class="search-count">共 ' + _n + ' 处</div>' + shown.map(function (r) {
              return '<div class="drawer-item" data-goto-ch="' + r.idx + '"' + (typeof r.pos === 'number' ? ' data-goto-pos="' + r.pos + '"' : '') + ' data-goto-q="' + BF.dom.escAttr(q) + '" style="padding:6px 8px;border-radius:var(--r-sm);cursor:pointer;font-size:12px;color:var(--text-dim);border-bottom:1px solid var(--border)">' +
                '<b style="color:var(--accent-ink)">' + BF.dom.esc(((BF.reader.state.bookTitles || [])[r.idx]) || ('第' + (r.idx + 1) + '章')) + '</b> ' + BF.reader.searchExcerpt(r.ctx, q) + '</div>';
            }).join('') +
            (capped ? '<div style="padding:10px;color:var(--warning-ink);font-size:12px">命中已达 ' + SEARCH_CAP + ' 条并停止扫描，实际可能更多。请用更精确的关键词。</div>' : '');
          }
          try {
            const hk = BF.store.K.SEARCH_HIST;
            const hh = BF.store.lsGet(hk, []) || [];
            const hi = hh.indexOf(q);
            if (hi >= 0) hh.splice(hi, 1);
            hh.unshift(q);
            if (hh.length > 10) hh.pop();
            BF.store.lsSet(hk, hh);
          } catch (e) { BF.err.report('search.historyWrite', e); }
        }
        if (_pendingResolve === resolve) { _pendingResolve = null; _pendingReject = null; }
        resolve(result);
      };
      /* 逐章串行 await 会让千章级的书变成分钟级等待且无进度，
         必须 6 章一批并发 + 每批让出主线程 + 实时显示已扫进度。 */
      const total = b.totalChapters || 0;
      /* 并发度取设置项 aiSearchPar（若在此硬编码数值，该设置项就没有消费者） */
      const BATCH = Math.max(1, Math.min(16, BF.settings.num('aiSearchPar', 6)));
      /* Worker 全文检索索引：大文件（>512KB）把每章正文解压 + 检索整体挪进 Worker 线程池，
         主线程只做收集与排序，避免千章级书籍逐章 await 造成的 UI 卡顿。失败自动回退主线程。 */
      if (total > 80 && BF.workerPool && BF.workerPool.available() && typeof BF.workerPool.searchAsync === 'function') {
        const box3 = document.getElementById('search-results');
        if (box3) box3.textContent = '搜索中…（Worker 索引）';
        try {
          /* Worker 路：合并串布局、坐标还原与 @@CH@@ 清洗共用 BF.library.searchBatchInWorker
             （分隔符不该计入 base、ctx 落展示前要剥两道，都写在那一份里）。
             命中自带段落空间偏移 pos，供点击定位到那一行。 */
          const _wb = async function (idxs, texts, doneCount) {
            const hs = await BF.library.searchBatchInWorker(idxs, texts, q);
            if (myGen !== _gen) return;   /* 世代已让位：本批丢弃，外层按 aborted 结束并 reject */
            for (let n = 0; n < hs.length; n++) out.push(hs[n]);
            const pb2 = document.getElementById('search-results');
            if (pb2) pb2.textContent = '搜索中…（Worker 已扫 ' + doneCount + '/' + total + ' 章）';
          };
          const _st = await BF.library.eachChapterBatch(b, total, BATCH, _wb, function () { return myGen !== _gen; }, function () { return out.length >= SEARCH_CAP; });
          if (_st === 'aborted') { reject(new Error('search superseded')); return; }
          if (out.length) {
            out.sort(function (a, b) { return a.idx - b.idx; });
            _finish();   /* Worker 已扫出结果 → 直接收尾并 return，跳过下方主线程全量扫描 */
            return;
          }
        } catch (e) {
          BF.err.report('searchAll.worker', e);
          out.length = 0;   /* 回退主线程：清空 Worker 半成品，走下方全量主线程扫描 */
          const box4 = document.getElementById('search-results');
          if (box4) box4.textContent = '搜索中…';
        }
      }
      if (!out.length) {
        /* 主线程兜底：逐章 indexOf 走 BF.library.scanBatchOnMain（每章 20 条、窗口 −20/+30，
           与跨书只差窗口数字，扫描实现同一份；命中带章内字符偏移 pos 供定位）。 */
        const _mb = async function (idxs, texts, doneCount) {
          const hs = BF.library.scanBatchOnMain(idxs, texts, q, 20, 20, 30);
          for (let n = 0; n < hs.length; n++) out.push(hs[n]);
          const pb = document.getElementById('search-results');
          if (pb) pb.textContent = '搜索中…（已扫 ' + doneCount + '/' + total + ' 章）';
        };
        const _st2 = await BF.library.eachChapterBatch(b, total, BATCH, _mb, function () { return myGen !== _gen; }, function () { return out.length >= SEARCH_CAP; });
        if (_st2 === 'aborted') { reject(new Error('search superseded')); return; }
      }
      /* 无论走 Worker 命中还是主线程全量，统一由 _finish 渲染 + 写历史 + resolve（唯一实现） */
      _finish();
      }, 300);
    });
  };
})();
BF.reader.renderBookmarks = function (c) {
  const bmsAll = BF.store.lsGetArray(BF.store.K.BOOKMARKS, []);
  const bms = bmsAll.map((b, bi) => ({ b, bi })).filter(x => x.b.bookId === BF.appState.currentBookId);
  if (!bms.length) { c.innerHTML = '<div class="cmdk-empty">书签还空着。读到想回来的地方，选中文字点「书签」（Ctrl+D）</div>'; return; }
  c.innerHTML = '<div style="display:flex;flex-direction:column;gap:4px">' +
    bms.map(function (x) {
      const bm = x.b;
      const _ch = BF.dom.intAttr(bm.chapterIdx), _off = BF.dom.intAttr(bm.charOffset);
      /* 条目本身也带上偏移（data-goto-pos）：书签存的就是章内精确位置，
         点条目却只切章、落在章首，等于把存下来的坐标丢掉——
         委托那一处已经会按 pos 定位并高亮，这里只管把坐标交出去。 */
      return '<div class="drawer-item"' + (_ch !== null ? ' data-goto-ch="' + _ch + '"' : '') + (_ch !== null && _off !== null ? ' data-goto-pos="' + _off + '"' : '') + ' style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--r-sm);font-size:12px;cursor:pointer">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">' +
        '<span style="color:var(--accent-ink)">第' + ((_ch !== null ? +_ch : 0) + 1) + '章</span>' +
        '<span style="display:flex;gap:4px;flex-shrink:0">' +
        (_ch !== null && _off !== null ? '<button class="btn btn-xs" data-goto-origin="' + _ch + '" data-origin-off="' + _off + '">原文</button>' : '') +
        '<button class="btn btn-xs" data-del-bm="' + x.bi + '">删除</button></span></div>' +
        (bm.text ? '<div style="color:var(--text-dim);margin-top:4px">' + BF.dom.esc(bm.text.slice(0, 80)) + '</div>' : '<div style="color:var(--text-weak);margin-top:4px">（位置书签）</div>') +
        '</div>';
    }).join('') + '</div>';
};
BF.reader.renderNotes = function (c) {
  const notes = BF.store.lsGetArray(BF.store.K.HIGHLIGHTS, []).filter(x => x.bookId === BF.appState.currentBookId);
  /* 顶部「便签」入口：没有它，便签只能在 AI 研读中心的折叠区看到，
     抽屉里完全不可达。点它开独立编辑器。 */
  const head = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">' +
    '<button class="btn btn-xs" data-open-notes style="flex:1;justify-content:flex-start">' + BF.dom.ic('md') + ' 打开便签编辑器</button>' +
    '</div>';
  if (!notes.length) { c.innerHTML = head + '<div class="cmdk-empty">还没有一条划线。阅读时选中句子点「划线」</div>'; return; }
  c.innerHTML = head + '<div style="display:flex;flex-direction:column;gap:4px">' +
    notes.map(function (n) {
      const _ch = BF.dom.intAttr(n.chapterIdx), _off = BF.dom.intAttr(n.charOffset);
      return '<div style="padding:8px 10px;border:1px solid var(--border);border-radius:var(--r-sm);font-size:12px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">' +
        '<span class="pk-hl-' + BF.dom.esc(n.color || 'yellow') + '" style="padding:0 4px">' + BF.dom.esc((n.text || '').slice(0, 60)) + '</span>' +
        '<span style="display:flex;gap:4px;flex-shrink:0">' +
        (_ch !== null && _off !== null ? '<button class="btn btn-xs" data-goto-origin="' + _ch + '" data-origin-off="' + _off + '">原文</button>' : '') +
        '<button class="btn btn-xs" data-del-note="' + BF.dom.escAttr(n.id) + '">删除</button></span></div>' +
        (n.note ? '<div style="color:var(--text-dim);margin-top:4px">' + BF.dom.esc(n.note.slice(0, 60)) + '</div>' : '') +
        '</div>';
    }).join('') + '</div>';
};

/* 高亮回绘：重进章节时，从 HIGHLIGHTS 按 charOffset 重新套色，否则划线会消失 */
BF.reader.applyHighlights = function () {
  const bookId = BF.appState.currentBookId;
  const ch = BF.appState.currentChapterIdx;
  if (!bookId) return;
  const main = document.getElementById('reader-main');
  if (!main) return;
  /* 划线列表记忆化：虚拟化模式下 renderWindow 每帧调用本函数——
     若每次都全量 lsGet + JSON.parse + filter、_noSid 非空时每帧再触发一次
     currentSid()（其内部是一次 IDB 读 getChapterText）、loc 迁移的读探测
     每轮重跑，几十条划线即足以让滚动掉帧。
     按 (bookId, chapterIdx, 写修订) 记忆过滤结果，三项全同才复用。
     失效真源是 BF.store.rev(HIGHLIGHTS)：它覆盖全部写入漏斗
     （addNote/删划线/备份恢复/工作区同步恢复，见 BF.store 声明处），
     故无需另挂 ANNOTATION 事件——事件本就是写入的子集，且漏报
      direct-lsSet 的写路径。sid 补写与 loc 迁移只在重建分支里跑：
     每次列表重建才跑一次（补写/迁移自身会 bump rev，自然触发
     下一次重建后转入缓存命中，不会每帧重跑）。 */
  const _rev = BF.store.rev(BF.store.K.HIGHLIGHTS);
  const C = BF.reader._hlc || (BF.reader._hlc = {});
  let hls;
  if (C.list && C.list.bk === bookId && C.list.ch === ch && C.list.rev === _rev) {
    hls = C.list.hls;
  } else {
    /* 按书分桶：划线全表只在写修订变化时解析一次并按 bookId 分桶，
       之后每次切章只扫本书那一桶 —— 不再每次切章都全表 JSON.parse + 过滤。
       桶按书不按章：sid 重映射可能把划线挂到与 chapterIdx 不同的章
       （章边界变了内容没变），按章分桶会把这类划线漏掉。 */
    let B = C.bucket;
    if (!B || B.rev !== _rev) {
      const _all0 = BF.store.lsGetArray(BF.store.K.HIGHLIGHTS, []) || [];
      const byBook = {};
      for (const _h of _all0) { if (_h && _h.bookId) { (byBook[_h.bookId] || (byBook[_h.bookId] = [])).push(_h); } }
      B = C.bucket = { rev: _rev, byBook: byBook, all: _all0 };
    }
    const _all0 = B.all;
    const _sidIdx = BF.reader.state.sidIndex || null;
    /* 按 sid 重映射：书被重新分章后 chapterIdx 变了，但 sid（由内容决定）没变——
       只按 chapterIdx 过滤会把划线全部丢掉（划线还在，只是不在当前章了）。
       故：有 sid 且能在 sidIndex 里查到、且**查到的章号 ≠ 当前章号** → 认定它
       属于另一章，**在这一章按该章的 paras 定位**。
       查不到（内容变了 / 无 sid / 旧数据）→ **一律走原有回退链**（按原
       chapterIdx + loc→text→charOffset 三级定位）。**绝不猜章号**：猜错等于把
       划线套到别的文字上，比不显示更糟。 */
    hls = (B.byBook[bookId] || []).filter(function (h) {
      if (!h || h.bookId !== bookId || !h.text) return false;
      /* 有 sid 且能在 sidIndex 里查到 → 一律以 sid 为准（章节边界
         变了按内容找回正确章）：「原章号优先」会把标注错挂到新同号章，甚至同一标注
         在原章号 + sid 映射章各渲染一份。 */
      if (_sidIdx && h.sid) {
        const mapped = _sidIdx[h.sid];
        /* mapped 可能是 0（真值判断会漏），故用 typeof + !== undefined */
        if (typeof mapped === 'number') return mapped === ch;
      }
      return h.chapterIdx === ch;   /* 无 sid 或无映射 → 回退原章号 */
    });
    C.list = { bk: bookId, ch: ch, rev: _rev, hls: hls };
    /* 旧标注惰性补 sid：
       没有 sid 的划线扛不住一次重新分章——在渲染时补写。
       刻意**不 await**（渲染不等 IO，划线立刻出现）；补写走 store.mutate 串行防竞态，
       失败留 warn 不静默。currentSid() 是 async，故整段挂在 .then 里 fire-and-forget。
       只补「归属当前章且无 sid」的：其余章的划线等它被读到那一章时再补，
       避免为整本书的划线各触发一次写入。 */
    try {
      const _noSid = hls.filter(function (h) { return h && !h.sid; });
      if (_noSid.length) {
        BF.reader.currentSid().then(function (sid) {
          if (!sid) return;                      /* 算不出就不补，不写脏值 */
          const ids = {};
          _noSid.forEach(function (h) { if (h.id) ids[h.id] = true; });
          let _changed = false;
          BF.store.mutate(BF.store.K.HIGHLIGHTS, function (arr) {
            (arr || []).forEach(function (x) { if (x && x.id && ids[x.id] && !x.sid) { x.sid = sid; _changed = true; } });
            return _changed ? arr : false;
          }).then(function (ok) {
            if (ok === false) { BF.log && BF.log.warn('旧划线补 sid 未写入（存储可能异常）'); return; }
            if (_changed) { _noSid.forEach(function (h) { h.sid = sid; }); }   /* 回填内存，避免当前会话重复补 */
          }).catch(function (e) { BF.log && BF.log.warn('旧划线补 sid 失败：' + (e && e.message)); });
        }).catch(function (e) { BF.log && BF.log.warn('旧划线补 sid 取当前章 sid 失败：' + (e && e.message)); });
      }
    } catch (e) { BF.log && BF.log.warn('旧划线补 sid 启动失败：' + (e && e.message)); }
    /* 旧标注迁移（text+charOffset → loc）。渲染即迁移：
       无 loc 字段的旧数据，用当前 paras 的 BF.cfi.locate 回退定位补 loc，写回一次。
       只迁移无 loc 的，已有 loc 不动（避免覆盖用户在迁移后重划的定位）。 */
    try {
      const paras = BF.reader.state.paras || [];
      const needMig = hls.filter(function (h) { return h && !h.loc; });
      if (needMig.length && paras.length) {
        let changed = false;
        needMig.forEach(function (h) {
          const L = BF.cfi.locate({ text: h.text, charOffset: h.charOffset }, paras);
          if (L && L.match) {
            /* loc 构造走 BF.cfi 唯一实现：after 不得含选中文本自身 */
            h.loc = BF.cfi.makeLoc(L.si, L.so, h.text, paras);
            changed = true;
          }
        });
        if (changed) {
          BF.store.setCritical(BF.store.K.HIGHLIGHTS, _all0, '划线');
          /* 迁移写回会 bump 写修订——把新修订记进缓存，避免下一次调用
             白白重建一次列表（重建本身无害，但每章首访多一次全量解析）。 */
          C.list.rev = BF.store.rev(BF.store.K.HIGHLIGHTS);
        }
      }
    } catch (e) { BF.log && BF.log.warn('旧划线迁移失败：' + (e && e.message)); }
  }
  if (!hls.length) return;
  /* 全文节点映射整章只建一次：若每条高亮都重建一次全文映射（O(条数 × 全文)），
     虚拟化模式下 renderWindow 每帧调用，几十条划线时滚动直接掉帧；
     命中区间统一算出后倒序套色（先套末尾，避免拆分影响前方偏移）。
     第二层复用：nodes/full 也按条件复用。
     复用判定：同书、同章、同世代，且缓存首节点仍挂在 #reader-main 内
     （虚拟化每帧重建 sizer.innerHTML，旧文本节点全部 detach，连通性
     校验天然失败 → 每帧重建；但窗口本就只含几十个 <p>，
     这层开销极小，真正的收益在列表层）。非虚拟化路径一次渲染只调
     一次本函数，本层很少命中。套色会拆分文本节点（surroundContents
     把区间提成 <span>），故套色生效后置 dirty，下次调用重建——
     只置标志不清引用，避免虚拟化帧内反复建大对象。 */
  const _gen = BF.reader.state.gen;
  if (!C.dom || C.dom.bk !== bookId || C.dom.ch !== ch || C.dom.gen !== _gen ||
      !C.dom.nodes.length || !main.contains(C.dom.nodes[0].node) || C.dom.dirty) {
    const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let g = 0, node;
    while ((node = walker.nextNode())) { nodes.push({ node: node, start: g }); g += node.nodeValue.length; }
    if (!nodes.length) return;
    C.dom = {
      bk: bookId, ch: ch, gen: _gen, dirty: false,
      nodes: nodes,
      full: nodes.map(function (x) { return x.node.nodeValue; }).join(''),
    };
  }
  const nodes = C.dom.nodes;
  const full = C.dom.full;
  const clsOf = function (hl) {
    /* underline 和 bg 分开：underline 走 note-under（真下划线），bg 走 pk-hl-*（底色）。
       没有类型字段的老数据也默认 note-under（下划线），不冒充底色。 */
    if (hl.type === 'wavy') return 'note-wavy';
    if (hl.type === 'bg') {
      /* 底色白名单单一事实源在 BF.reader.hlBgClass（079），两边不再各写一份 */
      return BF.reader.hlBgClass(hl.color || 'yellow');
    }
    /* type=underline 或无 type（老数据）→ 真下划线，颜色取 color 字段 */
    return 'note-under' + (hl.color && hl.color !== 'yellow' ? ' ' + hl.color : '');
  };
  const hits = [];
  const pending = [];
  let _mutated = false;   /* 是否真的拆过文本节点（套色生效）——决定 DOM 缓存是否失效 */
  hls.forEach(function (hl) {
    const t = hl.text;
    /* 优先三层锚定定位（loc.si/so → text+前后文 → 指纹）：
       命中即用段定位直接算区间，不用全文 indexOf（否则会「重复文本标错段」）。 */
    if (hl.loc) {
      const L = BF.cfi.locate(hl.loc, BF.reader.state.paras || []);
      if (L && L.match && L.si >= 0 && L.si < (BF.reader.state.paras || []).length) {
        /* locHit：用 loc 的文本 + 前后文指纹在 DOM full 里选「正确出现」。
           不直接算 DOM 偏移（paras 口径与 DOM 口径差标题占位，无法可靠转换），
           而是：loc.text 在 full 的每次出现，用 before/after 指纹校验，选最匹配的。 */
        let idx = -1, end = -1;
        if (t) {
          let from = 0, best = -1, bestScore = -1;
          while ((from = full.indexOf(t, from)) >= 0) {
            const segB = full.slice(Math.max(0, from - 20), from);
            const segA = full.slice(from + t.length, from + t.length + 20);
            let score = 0;
            if (hl.loc.before) score += (segB.indexOf(hl.loc.before.slice(-8)) >= 0 ? 2 : 0) + (segB.indexOf(hl.loc.before.slice(-12)) >= 0 ? 1 : 0);
            if (hl.loc.after) score += (segA.indexOf(hl.loc.after.slice(0, 8)) >= 0 ? 2 : 0) + (segA.indexOf(hl.loc.after.slice(0, 12)) >= 0 ? 1 : 0);
            if (!hl.loc.before && !hl.loc.after) score = 1;
            if (score > bestScore) { bestScore = score; best = from; }
            from += t.length;
          }
          if (best >= 0) { idx = best; end = idx + t.length; }
        }
        if (idx < 0) { pending.push(hl); return; }   /* loc 与文本都失效 → pending */
        /* idx/end 是 DOM 偏移，直接在 nodes 里找起止节点并入 hits */
        let sn = null, en = null;
        for (const x of nodes) {
          if (idx >= x.start && idx < x.start + x.node.nodeValue.length) sn = x;
          if (end > x.start && end <= x.start + x.node.nodeValue.length) en = x;
        }
        if (sn && en) hits.push({ hl: hl, sn: sn, idx: idx, end: end, weak: !!L.weak });
        return;   /* locHit 已处理完，跳过 text 回退 */
      }
      /* loc 定位失败但文本还在：走下方 text 回退 */
    }
    let idx = full.indexOf(t, Math.max(0, (hl.charOffset || 0) - t.length));
    if (idx < 0) idx = full.indexOf(t);
    let end = idx >= 0 ? idx + t.length : -1;
    if (idx < 0) {
      /* 跨段划线的文本含换行，而 DOM 正文按段渲染后段落间没有换行符，
         直接 indexOf 必然失败 —— 退化为「首片段起点 + 尾片段终点」定位 */
      const parts = t.split(/\s*\n+\s*/).filter(Boolean);
      if (parts.length) {
        const head = parts[0], tail = parts[parts.length - 1];
        let a = full.indexOf(head, Math.max(0, (hl.charOffset || 0) - t.length));
        if (a < 0) a = full.indexOf(head);
        if (a >= 0) {
          const b = full.indexOf(tail, a);
          if (b >= 0) { idx = a; end = b + tail.length; }
        }
      }
    }
    if (idx < 0) {
      /* text 回退也失败时，若 charOffset 有效且小于全文长，用它精确定位。
         场景：loc 失效 + 文本被改写（text 找不到），但段落结构未变 → charOffset 仍准。
         这是 loc（段定位）与 text（内容定位）之外的第三层——位置定位。 */
      const co = hl.charOffset;
      if (typeof co === 'number' && co >= 0 && co < full.length) {
        idx = co;
        end = Math.min(full.length, co + (t ? t.length : 1));
      } else { pending.push(hl); return; }
    }
    let sn = null, en = null;
    for (const x of nodes) {
      if (idx >= x.start && idx < x.start + x.node.nodeValue.length) sn = x;
      if (end > x.start && end <= x.start + x.node.nodeValue.length) en = x;
    }
    if (!sn || !en) { pending.push(hl); return; }
    if (sn !== en) {
      /* 跨节点（长划线跨段）：对覆盖到的每个文本节点各套一段，不再整条静默丢弃 */
      const parts = [];
      for (const x of nodes) {
        if (x.start + x.node.nodeValue.length <= idx || x.start >= end) continue;
        const a = Math.max(idx, x.start) - x.start;
        const b = Math.min(end, x.start + x.node.nodeValue.length) - x.start;
        if (b > a) parts.push({ node: x.node, a: a, b: b });
      }
      let _cf1 = 0;
      for (let i = parts.length - 1; i >= 0; i--) {
        try {
          const r = document.createRange();
          r.setStart(parts[i].node, parts[i].a);
          r.setEnd(parts[i].node, parts[i].b);
          const sp = document.createElement('span');
          sp.className = clsOf(hl);
          r.surroundContents(sp);
          _mutated = true;
        } catch (e) { _cf1++; }
      }
      if (_cf1) BF.log.warn('划线套色 ' + _cf1 + ' 段失败');
      return;
    }
    hits.push({ hl: hl, sn: sn, idx: idx, end: end });
  });
  hits.sort(function (a, b) { return a.idx - b.idx; });
  /* 同段同类区间合并：重叠/相邻的同款划线先并成一段再套色。
     逐条套色时后画的 span 会套进先画的 span 里（嵌套），同一位置叠几条
     标注就滚几层 span，重绘时每层都要拆一次文本节点，越滚越贵。
     只合同类（同款同色）：异类重叠的语义是「底色+波浪线」叠用，不能互吞。
     仅合并落在同一文本节点内的区间 —— 跨节点合并要重推节点映射，收益不成比例。 */
  const spans = [];
  for (let _i = 0; _i < hits.length; _i++) {
    const _h = hits[_i];
    const _cls = clsOf(_h.hl);
    const _last = spans[spans.length - 1];
    if (_last && _last.cls === _cls && _last.sn === _h.sn && _h.idx <= _last.end) {
      if (_h.end > _last.end) { _last.end = _h.end; _last.weak = _last.weak && !!_h.weak; }
      continue;
    }
    spans.push({ hl: _h.hl, sn: _h.sn, idx: _h.idx, end: _h.end, cls: _cls, weak: !!_h.weak });
  }
  spans.sort(function (a, b) { return b.idx - a.idx; });
  let _cf2 = 0;
  spans.forEach(function (h) {
    try {
      /* addNote 划线时已直接 surroundContents 套过色（即时反馈），
         applyHighlights 再次定位会套第二层 span → 嵌套。这里检测命中区间是否已
         被 pk-hl span 包裹（父节点是划线 span 且文本一致），是则跳过，避免双层。 */
      const parent = h.sn.node.parentElement;
      if (parent && parent.tagName === 'SPAN' && parent.className) {
        /* 判据须识别 clsOf 产生的全部类名（note-wavy / note-bg / pk-hl-*），
           原仅认 'pk-hl' 前缀 → 波浪线/底色每帧再包一层 span → 无限嵌套。 */
        const _pcn = String(parent.className).split(/\s+/);
        if (_pcn.indexOf(h.cls) >= 0 || _pcn.indexOf('pk-hl') >= 0) return;   /* 已套色，跳过 */
      }
      const range = document.createRange();
      range.setStart(h.sn.node, h.idx - h.sn.start);
      range.setEnd(h.sn.node, h.end - h.sn.start);
      const span = document.createElement('span');
      span.className = h.cls;
      if (h.weak) {
        /* K：弱匹配（ambiguous/fuzzy/无文本回退），锚点可能已漂移 → 虚线描边显式提示 */
        span.style.outline = '1.5px dashed var(--warning)';
        span.title = '标注可能已移位（锚点弱匹配，点击可重新划线）';
      }
      range.surroundContents(span);
      _mutated = true;
    } catch (e) { _cf2++; }
  });
  if (_cf2) BF.log.warn('划线套色 ' + _cf2 + ' 段失败');
  /* 套色会把文本节点拆成 span（surroundContents 副作用）——缓存的
     nodes/full 自此失效，置 dirty 让下次调用重建（见上方第二层说明）。
     只认真实拆分：全部命中都因「已包裹」而跳过时不动 DOM，缓存继续
     有效（重复调用/标注事件重绘不再每轮重建映射）。 */
  if (_mutated) C.dom.dirty = true;
  /* pending 显式提示（不静默）：位置失效的划线渲染成提示条，
     用户可据文本重新定位；不得「高亮标错段并静默成功」。 */
  if (pending.length) {
    try {
      const main = document.getElementById('reader-main');
      if (main && !main.querySelector('.pk-pending-tip')) {
        const tip = document.createElement('div');
        tip.className = 'pk-pending-tip';
        tip.textContent = pending.length + ' 条划线因文本变更无法定位，已跳过（可重新划线）。';
        main.insertBefore(tip, main.firstChild);
      }
    } catch (e) {}
  }
};

