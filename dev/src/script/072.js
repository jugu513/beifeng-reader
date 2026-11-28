/* ================= R7. 分页模式 ================= */
BF.reader.pageModeActive = function () {
  /* R3 智能协调：微读位图翻页（Canvas）自身接管翻页与键盘，此时 DOM 分页让位，
     避免两套分页机制并存（一个在 reader-main 切页、一个在 canvas-strip 平移）。
     reconcilePageMode 挂在 SETTINGS 总线上，mrCanvas/readerMode 变动会重算本函数，
     故进出 Canvas 自动切回，无需硬禁用开关、不改存档值。 */
  if (BF.mr && BF.mr.canvas && BF.mr.canvas.active && BF.mr.canvas.active()) return false;
  /* 图片书（CBZ）让位：分页要按段落切页，图片章没有段落——
     切了就是 0 页，页面停在上一章的分页残影上。存档值不动，只在这里放行滚动。 */
  if (BF.reader.state && BF.reader.state.book && BF.reader.state.book.img) return false;
  return (BF.settings.get('readerMode') || 'scroll') === 'page';
};
/* 长段落在一页里的落点：从满页位置往回找最近的句末标点（回看 20% 宽度）。
   找不到就正好切在满页处——宁可切在句中，也不能让这一页比视口高。 */
BF.reader._paraCutAt = function (txt, maxChars) {
  const s = String(txt || '');
  if (maxChars >= s.length) return s.length;
  if (maxChars <= 0) return 0;
  const back = Math.max(0, maxChars - Math.ceil(maxChars * 0.2));
  const ends = '。！？；…”』）)】';
  for (let i = maxChars - 1; i >= back; i--) { if (ends.indexOf(s.charAt(i)) >= 0) return i + 1; }
  return maxChars;
};
/* 分页切段：一处算法，renderPageMode 与 repaginate 共用。
   「每页固定 N 段」完全不计段长，一页实际高落在 2.6~6.6 屏之间，
   「一页」名不副实；字号、行高改了也只有切章才重算。
   填页按**估高**：每段行数 ≈ ceil(段字数 / 每行字数)，段高 = 行数×字号×行高 + 段间距，
   累计超过可用高度就翻页。字号/行高/段间距/容器高都在算式里，所以改排版必然重排。
   段本身就高过一页时必须再切开：整段塞一页时「一页」可以高达 31 屏，
   于是只剩 3% 可见、翻页按下去没有下一页、本章进度恒等于 100%。
   页里的每一项带三个字段：i=它来自 state.paras 的第几段、o=在这段里的起始字、
   t=这一页要显示的文字。段落空间（划线与搜索坐标用的那套偏移）仍然只认 paras，
   切开只发生在显示层，所以既有标注与搜索位置不会因为翻页规则改动而漂移。 */
BF.reader._chunkPages = function (paras, vh, fs, lh) {
  const _chrome = BF.reader._chromeMeasured || 140;
  const avail = Math.max(fs * lh, vh - _chrome);
  const ps = BF.settings.num('paraSpacing', 1);
  const perLine = BF.reader._pageMetrics(fs);
  /* _pageK 是从真机上量回来的校正系数（见 renderPage 末尾的标定），默认 1 = 纯估算。 */
  const k = BF.reader._pageK > 0 ? BF.reader._pageK : 1;
  /* 一页能放几行 → 换算成能放几个字。行数按**校正后**的段高反推：
     _pageK 是「真实高度 ÷ 裸估高度」，真机普遍 >1（首行缩进、标点挤压、段间距都没入账），
     不除掉它切出来的片还是会比视口高出一截。 */
  const linesPerPage = Math.max(1, Math.floor((avail - ps * fs) / (fs * lh * k)));
  const maxChars = Math.max(8, perLine * linesPerPage);
  const pages = [];
  let cur = [], used = 0;
  const flush = function () { if (cur.length) { pages.push(cur); cur = []; used = 0; } };
  for (let i = 0; i < paras.length; i++) {
    const txt = String(paras[i] == null ? '' : paras[i]);
    const h = BF.reader._estParaH(txt, fs, lh, perLine, ps) * k;
    if (h > avail) {
      flush();
      let rest = txt, at = 0;
      while (rest.length > maxChars) {
        const cut = BF.reader._paraCutAt(rest, maxChars);
        if (cut <= 0) break;   /* 切不动就收手，绝不空切（空切会死循环） */
        pages.push([{ i: i, o: at, t: rest.slice(0, cut), c: at > 0 ? 1 : 0 }]);
        rest = rest.slice(cut); at += cut;
      }
      if (!rest.length) continue;
      cur = [{ i: i, o: at, t: rest, c: at > 0 ? 1 : 0 }];
      used = BF.reader._estParaH(rest, fs, lh, perLine, ps) * k;
      continue;
    }
    if (cur.length && used + h > avail) flush();
    cur.push({ i: i, o: 0, t: txt, c: 0 });
    used += h;
  }
  flush();
  return pages;
};
BF.reader._pageMetrics = function (fs) {
  /* 每行字数按「段落盒子真实宽 ÷ 字号」算。
     以前用 reader-wrap 的客户宽扣 padding 反推，可阅读区还有一层页宽约束
     （.reader-main 的 max-width / 自己的 padding），那一层没扣进去就每行多算几个字，
     估高系统性偏小 → 一页装多了 → 翻页边界错位。有已渲染的段落就直接量段落，
     量不到（首屏/虚拟化未落地）才退回容器反推。 */
  let perLine = 0;
  try {
    const p0 = document.querySelector('#reader-main p');
    const pw = p0 ? (p0.clientWidth || Math.round(p0.getBoundingClientRect().width)) : 0;
    if (pw > 40) perLine = Math.max(6, Math.floor(pw / fs));
  } catch (e) { perLine = 0; }
  if (perLine) return perLine;
  const wrap = document.getElementById('reader-wrap');
  try {
    const cs = wrap && window.getComputedStyle ? window.getComputedStyle(wrap) : null;
    const padX = cs ? (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0) : 48;
    const mainEl = document.getElementById('reader-main');
    const mcs = mainEl && window.getComputedStyle ? window.getComputedStyle(mainEl) : null;
    const mPadX = mcs ? (parseFloat(mcs.paddingLeft) || 0) + (parseFloat(mcs.paddingRight) || 0) : 0;
    const w = Math.max(120, (wrap ? wrap.clientWidth : 720) - padX - mPadX);
    perLine = Math.max(6, Math.floor(w / fs));
  } catch (e) { perLine = 0; }
  if (!perLine) perLine = Math.max(6, Math.round(680 / fs));
  return perLine;
};
/* 裸估高（不含校正系数）：行数 × 字号 × 行高 + 段间距。
   与 _chunkPages 共用同一个算式，校准才能拿「真实高度 ÷ 裸估高度」当系数。 */
BF.reader._estParaH = function (txt, fs, lh, perLine, ps) {
  return Math.max(1, Math.ceil(String(txt == null ? '' : txt).length / perLine)) * fs * lh + ps * fs;
};
/* 排版量签名：参与估高算式的量都在这里，音量/白噪音那类设置改动不触发重排 */
BF.reader._pageSig = function () {
  const wrap = document.getElementById('reader-wrap');
  const fs = Number(BF.prefs.resolve(BF.appState.currentBookId, 'fontSize', BF.settings.get('fontSize'))) || 16;
  return [
    wrap ? wrap.clientHeight : 0, wrap ? wrap.clientWidth : 0,
    fs, BF.settings.num('lineHeight', 1.9), BF.settings.num('paraSpacing', 1),
    BF.settings.get('readerMargin')
  ].join('|');
};
/* 就地重排：分页模式里改字号 / 行高 / 页边距，若只有切章才重排，
   逐页段数纹丝不动（[22,22,22,22]），而「一页」的实际高度从 2.6 屏涨到 5.6 屏，
   等于「一页」这个名字是假的。
   重排前记住「当前这页的第一段是全书第几段」，重排后跳到含这一段的那一页：
   按页码等比换算会跳字（字号变大页数变少，同序号页早已不是同一段）。 */
BF.reader.repaginate = function (force) {
  if (!BF.reader.pageModeActive() || BF.reader.state.mode !== 'page') return false;
  const paras = BF.reader.state.paras;
  if (!paras || !paras.length) return false;
  const wrap = document.getElementById('reader-wrap');
  if (!wrap) return false;
  const sig = BF.reader._pageSig();
  if (!force && sig === BF.reader._lastPageSig) return false;
  BF.reader._lastPageSig = sig;
  const old = BF.reader.state.pkPages || [];
  /* 锚 = 当前页第一段是「全书第几段」（state.paras 的下标）。
     长段被切开后页内条目数不再等于段数，所以只能按条目带的源下标取锚。 */
  const _op = old[Math.min(BF.reader.state.pkPageIdx || 0, Math.max(0, old.length - 1))] || [];
  const anchor = _op.length ? _op[0].i : 0;
  const vh = wrap.clientHeight || 600;
  const fs = Number(BF.prefs.resolve(BF.appState.currentBookId, 'fontSize', BF.settings.get('fontSize'))) || 16;
  const pages = BF.reader._chunkPages(paras, vh, fs, BF.settings.num('lineHeight', 1.9));
  if (!pages.length) return false;
  let target = 0, found = -1;
  for (let i = 0; i < pages.length && found < 0; i++) {
    const it = pages[i] || [];
    for (let j = 0; j < it.length; j++) { if (it[j].i === anchor) { found = i; break; } }
  }
  if (found >= 0) target = found;
  else for (let i = 0; i < pages.length; i++) { const it = pages[i] || []; if (it.length && it[0].i <= anchor) target = i; }
  BF.reader.state.pkPages = pages;
  BF.reader.state.pkPageIdx = target;
  BF.reader.renderPage();
  return true;
};
/* 模式对账：设置里的 readerMode 与阅读器当前的 state.mode 必须落在同一条线上。
   过去只有设置面板的那个 change 委托负责切换，于是「非面板入口改 readerMode」
   （DSL、命令、恢复默认、跨标签同步）全部表现为「值改了、界面没换」——
   pageModeActive() 已经是 true，state.mode 却还是 scroll。
   挪到 SETTINGS 总线上，任何写路径都只有一条生效链；面板那条 change 分支删掉，
   不留第二份实现。幂等：mode 已经一致时什么都不做，避免每次改设置都重排一次。 */
BF.reader.reconcilePageMode = function () {
  if (BF.appState.currentPage !== 'reader') return false;
  const want = BF.reader.pageModeActive() ? 'page' : 'scroll';
  if (BF.reader.state.mode === want) return false;
  if (want === 'page') BF.reader.renderPageMode();
  else BF.reader.renderPageModeOff();
  return true;
};
/* 排版类设置一变就就地重排：签名没变直接返回，
   所以拖音量、开关白噪音这类改动不会白跑一遍重排。 */
try {
  BF.bus.on(BF.EVENTS.SETTINGS, function () {
    try { BF.reader.reconcilePageMode(); } catch (e0) { BF.err.report('reader.reconcileMode.onSettings', e0); }
    try { BF.reader.repaginate(); } catch (e) { BF.err.report('reader.repaginate.onSettings', e); }
    try { BF.reader.applyExtras(); } catch (e2) { BF.err.report('reader.extras.onSettings', e2); }
  });
} catch (e) { BF.err.report('reader.repaginate.bind', e); }
BF.reader.renderPageMode = function () {
  const wrap = document.getElementById('reader-wrap');
  if (!wrap) return;
  /* C36 修复：滚动→分页切换保持相对位置。在切 mode 之前记录当前滚动进度，
     换算成页码；否则固定从保存的页码或第 0 页开始。 */
  const _fromScroll = (BF.reader.state.mode === 'scroll' && wrap.scrollTop > 0);
  const _scrollRatio = _fromScroll ? (wrap.scrollTop / Math.max(1, wrap.scrollHeight - wrap.clientHeight)) : 0;
  BF.reader.state.mode = 'page';
  const paras = BF.reader.state.paras;
  if (!paras.length) return;
  const vh = wrap.clientHeight || 600;
  /* 阶段4：分页模式字号随书 */
  const fs = Number(BF.prefs.resolve(BF.appState.currentBookId, 'fontSize', BF.settings.get('fontSize'))) || 16;
  const lh = BF.settings.num('lineHeight', 1.9);
  const pages = BF.reader._chunkPages(paras, vh, fs, lh);
  BF.reader._lastPageSig = BF.reader._pageSig();
  BF.reader.state.pkPages = pages;
  const savedPage = BF.store.lsGet(BF.store.K.PROGRESS_ + BF.appState.currentBookId + '_' + BF.appState.currentChapterIdx, 0);
  let pageIdx = (typeof savedPage === 'number' && savedPage >= 0 && savedPage < pages.length) ? savedPage : 0;
  if (_fromScroll) {
    pageIdx = Math.min(pages.length - 1, Math.max(0, Math.floor(_scrollRatio * pages.length)));
  }
  BF.reader.state.pkPageIdx = pageIdx;
  BF.reader.renderPage();
};
BF.reader.renderPageModeOff = function () {
  /* C36 修复：分页→滚动切换保持相对位置。离开分页时把当前页码换算成滚动位置，
     切回滚动模式后停在对应位置，而不是回到章首。 */
  const wrap = document.getElementById('reader-wrap');
  const pages = BF.reader.state.pkPages || [];
  if (wrap && pages.length) {
    const pct = (BF.reader.state.pkPageIdx || 0) / pages.length;
    BF.reader.state.mode = 'scroll';
    BF.reader.loadChapter().then(function () {
      /* 必须等正文重新渲染完再量高度：此刻 DOM 还是「一页」的内容，
         scrollHeight - clientHeight ≈ 0，提前算出来的目标是章首。 */
      requestAnimationFrame(function () {
        const w2 = document.getElementById('reader-wrap');
        if (!w2) return;
        const total = Math.max(1, w2.scrollHeight - w2.clientHeight);
        w2.scrollTop = Math.round(pct * total);
      });
    });
    return;
  }
  BF.reader.state.mode = 'scroll';
  BF.reader.loadChapter();
};
/* 分页段模板（T2）：innerHTML 路径与 Fragment 路径共用同一套锚点规则。
   data-vi = 源段号、data-vo = 段内起始偏移，划线锚点才能落回源码段落位置
   （长段被切开时，locOfRange 会把 data-vo 加到段内偏移上）。
   it.c = 同一段的续页：不再首行缩进，看起来才是一页没写完。 */
BF.reader.pageItemHTML = function (it) {
  return '<p' + (it.c ? ' class="pk-cont"' : '') + ' data-vi="' + it.i + '" data-vo="' + (it.o || 0) + '">' + BF.dom.esc(it.t) + '</p>';
};
BF.reader.renderPage = function () {
  const rm = document.getElementById('reader-main');
  if (!rm) return;
  const pages = BF.reader.state.pkPages;
  const idx = BF.reader.state.pkPageIdx;
  if (!pages || !pages.length) return;
  const page = pages[idx] || [];
  /* 分页渲染：小页（≤50 段）用 innerHTML 一次性构建；超大页用 Fragment 分批插入，
     避免巨型字符串一次解析造成的长时间主线程占用（大屏/大字号下每页可达数百段）。
     Fragment 路径不解析字符串（textContent 直写），但属性与 pk-cont 规则与
     pageItemHTML 完全一致——改锚点规则只改 pageItemHTML，Fragment 路径同步跟上。 */
  if (page.length > 50) {
    const frag = document.createDocumentFragment();
    const h = document.createElement('h2'); h.textContent = BF.reader.state.title;
    frag.appendChild(h);
    for (let i = 0; i < page.length; i += 50) {
      const batch = document.createDocumentFragment();
      for (let j = i; j < Math.min(page.length, i + 50); j++) {
        const it = page[j];
        const p = document.createElement('p');
        p.textContent = it.t;
        p.setAttribute('data-vi', it.i);
        p.setAttribute('data-vo', it.o || 0);
        if (it.c) p.className = 'pk-cont';
        batch.appendChild(p);
      }
      frag.appendChild(batch);
    }
    rm.textContent = '';
    rm.appendChild(frag);
  } else {
    rm.innerHTML = '<h2>' + BF.dom.esc(BF.reader.state.title) + '</h2>' +
      page.map(BF.reader.pageItemHTML).join('');
  }
  /* 分页方向动画：用页索引差判断滑入方向（增→右滑入，减→左滑入），无需侵入 prev/next */
  const last = BF.reader.state._lastPageIdx;
  BF.reader.state._lastPageIdx = idx;
  const dir = (typeof last === 'number' && last !== idx) ? (idx > last ? 1 : -1) : 0;
  if (dir !== 0) {
    rm.classList.remove('page-in-right', 'page-in-left');
    void rm.offsetWidth;   /* 强制 reflow，保证每次翻页动画重放 */
    rm.classList.add(dir > 0 ? 'page-in-right' : 'page-in-left');
  }
  /* 分页模式渲染完必须补一次 applyHighlights：缺了它，已存的划线与批注
     在分页模式下全部不可见（数据仍在）——全文其余重绘点只在滚动/快路径/虚拟化路径上。
     页内定位交由 applyHighlights 自行按当前 DOM 匹配，跨页划线在翻到对应页时命中。 */
  try { BF.reader.applyHighlights(); } catch (e) { BF.err.report('renderPage.applyHighlights', e); }
  /* 估高校准。以前「一页 ≈1.76 屏、翻页边界错位」的根因是纯估算：
     行数按「段字数 ÷ 每行字数」算，而中文标点压缩、首行缩进、字体度量都会让真实
     行数比估的多，估小就装多了 → 一页比视口高。这里不猜系数：
     拿刚渲染好的这一页量真实内容高（首段顶 → 末段底），与同样这些段落的裸估高相比，
     比值回填 _pageK；若量出来确实溢出了可用高度，就按新系数重排一次（每个排版签名
     只重排一次，不递归，避免来回抖）。改字号/行高/窗口宽都算新签名，会重新标定。 */
  try {
    const _ps = Array.prototype.slice.call(rm.querySelectorAll('p'));
    /* 量的是整块内容高（含 h2 与容器内边距）：只算段落顶到底会漏掉每页固定开销，
       系数就校不准 —— 页高溢出的真凶之一正是这笔没入账的开销。 */
    if (_ps.length === page.length) {
      const _fs = Number(BF.prefs.resolve(BF.appState.currentBookId, 'fontSize', BF.settings.get('fontSize'))) || 16;
      const _lh = BF.settings.num('lineHeight', 1.9);
      const _psp = BF.settings.num('paraSpacing', 1);
      const _perLine = BF.reader._pageMetrics(_fs);
      const _bare = _ps.reduce(function (s, el, i) { return s + BF.reader._estParaH(page[i].t, _fs, _lh, _perLine, _psp); }, 0);
      const _real = Math.max(1, Math.round(rm.offsetHeight) || (_ps[_ps.length - 1].getBoundingClientRect().bottom - _ps[0].getBoundingClientRect().top));
      if (_bare > 0) {
        /* 固定开销（h2 + 章信息 + 容器内边距）单列，不摊进段高：
           否则 _real（含整页 chrome）除以 _bare（仅段落）会把本页段高多算一截，
           收敛到 1 段/页、每页空白 58% —— 分页容量漂移的根因。
           K 只对段落本身，可用高度扣掉固定开销（而不是拍脑袋的 60）。 */
        const _ptTop = _ps[0].getBoundingClientRect().top;
        const _ptBot = _ps[_ps.length - 1].getBoundingClientRect().bottom;
        const _chromeH = Math.max(0, _real - (_ptBot - _ptTop));
        BF.reader._chromeMeasured = Math.round(_chromeH);
        const _k = Math.min(2.5, Math.max(0.5, (_ptBot - _ptTop) / _bare));
        BF.reader._pageK = Math.round(_k * 1000) / 1000;
        const _wrapH = ((document.getElementById('reader-wrap') || {}).clientHeight || 600);
        const _avail = Math.max(_fs * _lh, _wrapH - _chromeH);
        const _sig = BF.reader._pageSig();
        if (_real > _avail + 8 && BF.reader._pageCalibSig !== _sig) {
          BF.reader._pageCalibSig = _sig;
          BF.reader.repaginate(true);
          return;
        }
      }
    }
  } catch (e) { BF.err.report('renderPage.calib', e); }
  /* 进度显示与滚动模式一致：全书章节进度（若显示「本章内页%」，两套算法互踩） */
  BF.reader.updateProgress();
  BF.reader.saveProgress();
};
/* ---- 分页模式单击翻页 ----
   左 1/3 → 上一页；右 1/3 → 下一页；中间 → 唤出/收起工具栏。
   事件委托在 #reader-main 上，只在分页态生效，滚动模式不受影响。 */
BF.reader._pageClickBound = false;
BF.reader._bindPageClick = function () {
  if (BF.reader._pageClickBound) return;
  BF.reader._pageClickBound = true;
  /* F-02：委托绑 wrap 而不是 main —— main 只有正文列那么宽，两侧留白（大屏接近半屏）
     收不到点击，而三分判据是按 wrap 宽算的，右 1/3 那片永远点不到。
     绑 wrap 后要排除正文里的可点击物（脚注/划线/按钮）与正在选字的情形，否则误翻页。 */
  const wrap0 = document.getElementById('reader-wrap');
  if (!wrap0 || wrap0._pgTapWired) return;
  wrap0._pgTapWired = true;
  wrap0.addEventListener('click', function (e) {
    if (!BF.reader.pageModeActive()) return;
    const t = e.target;
    if (t && t.closest && t.closest('a,button,[role="button"],.anno-layer,mark.anno,.mr-rail')) return;
    if (window.getSelection && String(window.getSelection())) return;
    const wrap = wrap0;
    const w = wrap.clientWidth || 1;
    const x = e.clientX - (wrap.getBoundingClientRect ? wrap.getBoundingClientRect().left : 0);
    if (x < w / 3) {
      if (BF.reader.state.pkPageIdx > 0) BF.reader.prevChapter();
    } else if (x > w * 2 / 3) {
      if (BF.reader.state.pkPageIdx < BF.reader.state.pkPages.length - 1) BF.reader.nextChapter();
    } else {
      /* 中间：唤出/收起底部工具栏（复用已有 toggle 行为） */
      const tb = document.getElementById('reader-bottom');
      if (tb) tb.classList.toggle('show');
    }
  });
};

