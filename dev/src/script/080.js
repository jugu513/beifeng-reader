/* ================= R12. 选中工具条 ================= */
BF.reader.__lastSelText = '';
BF.reader.__lastRange = null;
BF.reader.__lastLoc = null;
/* 选区备份状态的生命周期边界。
   __lastRange / __lastSelText / __lastLoc 若只在 positionSel 里赋值、没有置回 null 的出口，
   切章也不清 → 在第 5 章划一段、切到第 6 章后按快捷键划线，
   入库的就是 chapterIdx=6 但 text/loc 全属于第 5 章的脏数据（选区状态跨章泄漏）。
   统一在此显式清空，切章/开书调用即可，不依赖各处自觉。 */
BF.reader.clearSelState = function () {
  BF.reader.__lastSelText = '';
  BF.reader.__lastRange = null;
  BF.reader.__lastLoc = null;
};
BF.reader.hideSel = function () {
  const bar = document.getElementById('selbar');
  if (bar) bar.classList.remove('show');
};
BF.reader.clearSelState();
BF.reader.positionSel = function () {
  const s = window.getSelection();
  if (!s || s.isCollapsed || !BF.appState.currentBookId) { BF.reader.hideSel(); return; }
  const t = s.toString().trim();
  if (!t) { BF.reader.hideSel(); return; }
  const bar = document.getElementById('selbar');
  if (!bar) return;
  const range = s.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  bar.style.top = Math.max(10, rect.top - 46) + 'px';
  bar.classList.add('show');
  BF.reader.__lastSelText = t;
  /* 深拷贝当前 Range。工具条操作（书签/划线/生词）优先用这份备份，
     而不是实时选区——一次划词可连续施加多个标注，不被第一次操作后的
     removeAllRanges 清掉。划新词时 positionSel 会重新覆盖此备份。 */
  try { BF.reader.__lastRange = range.cloneRange(); } catch (e) { BF.reader.__lastRange = null; }
  /* 备份定位（段索引+段内偏移+文本/前后文），供划线/书签/生词统一使用。
     优先于 charOffset——段定位不受「段落增删」「DOM 虚拟化」「全文 offset 口径不一致」影响。 */
  try {
    BF.reader.__lastLoc = BF.cfi.locOfRange(range, BF.reader.state.paras || []);
  } catch (e) { BF.reader.__lastLoc = null; }
};
BF.reader.copySel = function () {
  const t = BF.reader.__lastSelText || (window.getSelection() || {}).toString();
  /* 走 BF.copyText 唯一实现并等它落定：writeText 返回的是 Promise，
     不 await 时「已复制」说的是「已经发起了」，不是「剪贴板里真有」。
     焦点不在文档内 / 权限被拒都会失败，而那正是选中正文后最容易踩到的条件。 */
  BF.copyText(t).then(function (r) {
    if (r && r.ok) BF.noti.success('已复制');
    else BF.noti.error('复制失败：' + ((r && r.error) || '剪贴板不可用'));
  });
  BF.reader.hideSel();
};
BF.reader.searchSel = function () {
  const t = BF.reader.__lastSelText || (window.getSelection() || {}).toString();
  if (!t) return;
  BF.reader.openDrawer('search');
  setTimeout(function () {
    const input = document.getElementById('search-input');
    if (input) { input.value = t; BF.reader.searchAll(t); }
  }, 120);
  BF.reader.hideSel();
};
BF.reader.speakSel = function () {
  const t = BF.reader.__lastSelText || (window.getSelection() || {}).toString();
  if (!t) return;
  BF.tts.selSpeak(t);
  BF.reader.hideSel();
};
/* 选中文本 → 问 AI（第九键）。复用既有研读中心问书管线：
   打开面板、把选中文本预填到 #ai-ask-input、派发 Enter 触发既有 doAsk。
   不静默：空选区给提示；面板/输入异常走 BF.err.report 而非吞掉。 */
BF.reader.askAISel = function () {
  const t = (BF.reader.__lastSelText || '').trim() || (window.getSelection() || {}).toString().trim();
  if (!t) { BF.noti.info('请先选中一段文字再问 AI'); BF.reader.hideSel(); return; }
  try { BF.aiUI.open(); } catch (e) { BF.err.report('askAISel.open', e); }
  const inp = document.getElementById('ai-ask-input');
  if (inp) {
    inp.value = t;
    try { inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); }
    catch (e) { BF.err.report('askAISel.dispatch', e); }
  }
  BF.reader.hideSel();
};
(function () {
  const bar = document.getElementById('selbar');
  if (bar) bar.addEventListener('mousedown', function (e) { e.preventDefault(); });
})();

/* 按章内字符偏移定位到段并临时高亮（搜索命中跳转用）。
   offset 恒为「段落空间」偏移（Σ(段长+1)，与 BF.cfi 同一口径）：标注、书签、章内查找
   本来就在这个空间，搜索命中由批次入口在产出坐标时归一（见 BF.library.eachChapterBatch）。
   虚拟化模式下 DOM 只渲染窗口段，直接扫 DOM 会假阴性——先按 paras 数组算出段索引，
   滚动到该段进入渲染窗口，等一帧再对真实节点高亮。分页模式 DOM 只有当前页，
   先换到含目标段的那一页。 */
BF.reader.gotoCharOffset = function (offset, opts) {
  opts = opts || {};
  const paras = BF.reader.state.paras || [];
  if (!paras.length || typeof offset !== 'number') return;
  /* 偏移 → 段索引 + 段起始偏移（BF.cfi 唯一实现） */
  const _L = BF.cfi.offsetToLoc(offset, paras);
  if (!_L) return;
  const vi = _L.si;
  const acc = _L.base;
  const wrap = document.getElementById('reader-wrap');
  const virt = wrap ? wrap.querySelector('.reader-virt') : null;
  const q = opts.q || '';
  /* 段索引 → 当前 DOM 里的段落元素。
     分页模式下 renderPage 可能触发一次估高校准重排（页界随之变化），所以换页之后
     要重新按新页表算一次「所在页 + 页内序号」，不能拿换页前的页界取节点。 */
  const paraEl = function () {
    const rm = document.getElementById('reader-main');
    if (!rm) return null;
    if (virt) return rm.querySelector('p[data-vi="' + vi + '"]');
    if (BF.reader.pageModeActive()) {
      /* 长段被切成多页后，「页内序号」与「全书第几段」不再相等，
         所以按条目带的源段号找页；再用段内偏移挑出真正含目标那句的那一页，
         免得从第 20 页的命中跳过去却停在整段的第一页。 */
      const intra = Math.max(0, offset - acc);
      const locate = function () {
        const pages = BF.reader.state.pkPages || [];
        let first = null;
        for (let i = 0; i < pages.length; i++) {
          const it = pages[i] || [];
          for (let j = 0; j < it.length; j++) {
            if (it[j].i !== vi) continue;
            if (!first) first = { pi: i, local: j };
            if (intra >= it[j].o && intra < it[j].o + it[j].t.length) return { pi: i, local: j };
          }
        }
        return first;
      };
      const at = locate();
      if (!at) return null;
      if (BF.reader.state.pkPageIdx !== at.pi) {
        BF.reader.gotoPage(at.pi);
        const at2 = locate();
        if (!at2) return null;
        return rm.querySelectorAll('p')[at2.local] || null;
      }
      return rm.querySelectorAll('p')[at.local] || null;
    }
    return rm.querySelectorAll('p')[vi] || null;
  };
  /* 段内字符偏移 → 承载它的文本节点 + 节点内偏移。
     段落被划线与批注拆成多个节点后，p.firstChild 只是第一个节点，直接 setStart 会越界
     抛 IndexSizeError——跳转既不滚动也不高亮，异常还被 report 压成一条日志。 */
  const textNodeAt = function (p, at) {
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let n, seen = 0, tail = null;
    while ((n = walker.nextNode())) {
      const len = n.textContent.length;
      if (!len) continue;
      if (at < seen + len) return { node: n, off: at - seen };
      seen += len;
      tail = { node: n, off: len };
    }
    return at === seen ? tail : null;
  };
  const doHighlight = function () {
    const p = paraEl();
    if (!p) return;
    try { p.scrollIntoView({ block: 'center', behavior: opts.highlight ? 'smooth' : 'auto' }); } catch (e) { p.scrollIntoView(); }
    /* 搜索侧按 _foldSearch 折叠后取偏移，折叠是 1:1 的，折叠串下标与原串逐字对齐 */
    const pn = BF.library._foldSearch(p.textContent);
    const qn = BF.library._foldSearch(q);
    let start = Math.max(0, Math.min(offset - acc, pn.length));
    if (qn && pn.substr(start, qn.length) !== qn) {
      /* 偏移处读不出关键词 = 段内文本已随改章/重排变动，退到本段首次出现；
         本段也没有就只滚动不高亮：把色块划到段首是「看着成功、其实指错」。 */
      start = pn.indexOf(qn);
    }
    if (start < 0 || start >= pn.length) return;
    if (p.querySelector('mark[data-goto-hl]')) return;   /* 虚拟化二次重试不再套第二层 */
    const hit = textNodeAt(p, start);
    if (!hit) return;
    const end = Math.min(hit.off + (qn.length || 1), hit.node.textContent.length);
    if (end <= hit.off) return;
    const range = document.createRange();
    range.setStart(hit.node, hit.off);
    range.setEnd(hit.node, end);
    const mark = document.createElement('mark');
    mark.dataset.gotoHl = '1';
    mark.style.background = 'color-mix(in srgb, var(--accent) 30%, transparent)';
    range.surroundContents(mark);
    setTimeout(function () {
      try { if (mark.parentNode) mark.parentNode.replaceChild(document.createTextNode(mark.textContent), mark); } catch (e) {}
    }, 2600);
  };
  if (virt) {
    /* 虚拟化：把目标段滚进窗口再高亮（center 改动 scrollTop 会触发 renderWindow 重建，
       必须先滚动、等一帧，否则 mark 会被 innerHTML 重写抹掉） */
    /* 按虚拟化真实前缀和定位——vi*estH 估算在
       中文段落折行 3-6 行时严重偏离实际段顶 → 跳转错位。
       _virtTop 由 loadChapter 虚拟化分支注入；未就绪（首帧渲染前）
       回退 _estH 估算。 */
    const _top = BF.reader._virtTop ? BF.reader._virtTop(vi) : vi * (BF.reader._estH || 40);
    wrap.scrollTop = Math.max(0, _top - wrap.clientHeight * 0.4);
    /* 这两个是「等多久」，不是「多高」：与两处 260px 只是数字撞车，
       命名后调高度不会顺手改到它们。 */
    const HL_FIRST_MS = 60, HL_RETRY_MS = 260;
    setTimeout(doHighlight, HL_FIRST_MS);
    setTimeout(doHighlight, HL_RETRY_MS);
  } else {
    doHighlight();
  }
};

