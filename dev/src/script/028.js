/* ================= 13.5b 笔记 Tab 聚合渲染 ================= */
BF.notesTab = (function () {
  const $ = id => document.getElementById(id);
  const esc = s => BF.dom.esc(String(s == null ? '' : s));
  const fmtDate = ts => {
    if (!ts) return '';
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return '今天 ' + d.toTimeString().slice(0,5);
    const y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + d.toTimeString().slice(0,5);
    return (d.getMonth()+1) + '月' + d.getDate() + '日';
  };
  /* 本页渲染出来的可跳转条目，按 data-note-goto 的下标取。
     与「跨书标注」面板同一套下标做法：过滤/分组怎么变，下标都不跟着漂。 */
  let _rows = [];
  function render() {
    const row = $('note-stat-row'), list = $('notes-list');
    if (!row || !list) return;
    /* 本页 = 跨书标注聚合（划线 / 书签 / 便签 / 生词），按书名分组。
       条目只取 BF.annAcross._gather()：全库这张表仅此一份口径，与「跨书标注」
       面板同源；这里再自己读一遍存储，两处迟早报出两个数。 */
    let items = [], titleOf = function () { return '（未关联）'; };
    try {
      const g = BF.annAcross && BF.annAcross._gather ? BF.annAcross._gather() : null;
      items = (g && g.items) || [];
      if (g && g.titleOf) titleOf = g.titleOf;
    } catch (e) { BF.err && BF.err.report('notesTab.gather', e); }
    const cnt = { hl: 0, bm: 0, note: 0, voc: 0 };
    items.forEach(function (it) { if (cnt[it.kind] !== undefined) cnt[it.kind]++; });
    row.innerHTML =
      '<div class="note-stat"><div class="note-stat__num">' + cnt.hl + '</div><div class="note-stat__lbl">划线</div></div>' +
      '<div class="note-stat"><div class="note-stat__num">' + cnt.bm + '</div><div class="note-stat__lbl">书签</div></div>' +
      '<div class="note-stat"><div class="note-stat__num">' + cnt.note + '</div><div class="note-stat__lbl">便签</div></div>' +
      '<div class="note-stat"><div class="note-stat__num">' + cnt.voc + '</div><div class="note-stat__lbl">生词</div></div>';
    _rows = [];
    if (!items.length) {
      list.innerHTML =
        '<div class="note-empty">' +
        '<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".45"><path d="M14 8h28l12 12v36H14z"/><path d="M42 8v12h12"/><path d="M22 28h24M22 38h24M22 48h16"/></svg>' +
        '<div class="note-empty__lead">还没有标注</div>' +
        '<div class="note-empty__hint">划线、书签、批注都会列在这里</div>' +
        '</div>';
      return;
    }
    const byBook = new Map();
    items.forEach(function (it) {
      const k = String(it.bookId || '');
      if (!byBook.has(k)) byBook.set(k, []);
      byBook.get(k).push(it);
    });
    const PER_BOOK = 12, PER_PAGE = 60;
    let html = '', shown = 0;
    byBook.forEach(function (of, bookId) {
      if (shown >= PER_PAGE) return;
      const take = of.slice(0, PER_BOOK);
      const name = bookId ? titleOf(bookId) : '未关联书籍';
      html += '<div class="note-group"><span class="note-group__t">' + esc(name) + '</span><span>' + of.length + ' 条</span></div>';
      take.forEach(function (it) {
        /* 只有真的带章号才给跳转：没有 chapterIdx 的条目跳过去会落在第一章
           且三段定位全不命中——与「跨书标注」面板同一道门（不给死胡同做按钮）。 */
        const gotoable = typeof it.ch === 'number';
        let attr = '';
        if (it.kind === 'note' && it.id) attr = ' data-note-open="' + BF.dom.escAttr(it.id) + '"';
        else if (gotoable) { _rows.push(it); attr = ' data-note-goto="' + (_rows.length - 1) + '"'; }
        html += '<div class="note-card"' + attr + '>' +
          '<div class="note-card__meta">' +
            '<span class="note-card__tag">' + esc(it.type) + '</span>' +
            '<span class="note-card__date">' + esc(fmtDate(it.t)) + '</span>' +
          '</div>' +
          '<div class="note-card__text">' + esc(String(it.text || '').slice(0, 80) || '（无文字）') + '</div>' +
          '<div class="note-card__snippet">' + (gotoable ? '第 ' + (it.ch + 1) + ' 章' : '（未定位）') + '</div>' +
        '</div>';
      });
      shown += take.length;
      if (of.length > take.length) html += '<div class="note-empty__hint">《' + esc(name) + '》另有 ' + (of.length - take.length) + ' 条，点上方「跨书标注」看全部</div>';
    });
    if (items.length > shown) html += '<div class="note-empty__hint">本页先列最近 ' + shown + ' 条，全部标注走「跨书标注」</div>';
    list.innerHTML = html;
  }
  function _bind() {
    const body = $('notes-body');
    if (!body || body.__bound) return;
    body.__bound = true;
    body.addEventListener('click', function (e) {
      const gg = e.target && e.target.closest ? e.target.closest('[data-note-goto]') : null;
      if (gg) {
        const it = _rows[Number(gg.getAttribute('data-note-goto'))];
        /* 跳转走「跨书标注」的同一份实现：开书 → 定位章 → 偏移定位，
           这里再写第二份就会和面板的落点慢慢分叉。 */
        if (it && BF.annAcross && BF.annAcross.goto) {
          try { BF.annAcross.goto(it); } catch (ex) { BF.err && BF.err.report('notesTab.goto', ex); }
        }
        return;
      }
      const card = e.target && e.target.closest ? e.target.closest('[data-note-open]') : null;
      if (card) {
        /* 打开便签面板并定位到这一条 */
        try {
          const id = card.getAttribute('data-note-open');
          /* 让编辑器下次打开时选中这条：通过劫持 BF.notes 内部 _editing */
          if (BF.notes && BF.notes.open) {
            /* 先 open 建面板，再 post 选中 */
            BF.notes.open();
            setTimeout(function () {
              try {
                /* 模拟点击左列表中同 id 的项 */
                const item = document.querySelector('[data-bn-open="' + id + '"]');
                if (item) item.click();
              } catch (ex) {}
            }, 60);
          }
        } catch (ex) { BF.err && BF.err.report('notesTab.open', ex); }
        return;
      }
      const nb = e.target && e.target.closest ? e.target.closest('#notes-new') : null;
      if (nb) {
        try {
          if (BF.notes && BF.notes.create && BF.notes.open) {
            BF.notes.create();
            BF.notes.open();
          }
        } catch (ex) { BF.err && BF.err.report('notesTab.new', ex); }
        return;
      }
      const rf = e.target && e.target.closest ? e.target.closest('#notes-refresh') : null;
      if (rf) { render(); BF.noti && BF.noti.success && BF.noti.success('已刷新'); }
    });
  }
  return {
    render: render,
    bind: _bind,
  };
})();

