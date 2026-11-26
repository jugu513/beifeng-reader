/* ================= 独立便签编辑器 =================
   独立面板：左列表（搜索/按书过滤/按标签过滤）+ 右编辑区（新建/编辑/删除/跳转原文）。
   与划线（HIGHLIGHTS）是两套东西：便签是自由记录，划线是正文中选中片段。 */
BF.notes = (function () {
  const MAX_TEXT = 20000;
  let _q = '', _book = '', _tag = '', _editing = null;

  /* 面板一次 render 调 all() 约 5 次，每次全量 JSON.parse 整表——
     改 store.rev 记忆化（与 reader._hlc.list 同一范式：同页写路径都走 lsSet/setCritical 自增 rev）。 */
  let _allRev = -1, _allCache = null;
  function all() {
    const rv = BF.store.rev(BF.store.K.NOTES);
    if (_allCache && _allRev === rv) return _allCache;
    try { _allCache = BF.store.lsGetArray(BF.store.K.NOTES, []) || []; } catch (e) { return _allCache || []; }
    _allRev = BF.store.rev(BF.store.K.NOTES);
    return _allCache;
  }
  function save(list) {
    try {
      /* setCritical 配额满时返回 false（不抛）：只接 throw 会把「没落盘」当成保存成功。
         人话提示由存储层那一条负责，这里只把真实结果透出去。 */
      return BF.store.setCritical(BF.store.K.NOTES, list, '便签') !== false;
    }
    catch (e) { BF.err.report('notes.save', e); BF.noti.error('便签保存失败'); return false; }
  }
  function tagsOf(n) { return Array.isArray(n.tags) ? n.tags : []; }
  function allTags() {
    const m = new Map();
    all().forEach(function (n) { tagsOf(n).forEach(function (t) { m.set(t, (m.get(t) || 0) + 1); }); });
    return Array.from(m.entries()).map(function (e) { return { tag: e[0], n: e[1] }; }).sort(function (a, b) { return b.n - a.n; });
  }
  function filtered() {
    const q = _q.trim().toLowerCase();
    return all().filter(function (n) {
      if (!n) return false;
      if (_book && n.bookId !== _book) return false;
      if (_tag && tagsOf(n).indexOf(_tag) < 0) return false;
      if (q && String(n.text || '').toLowerCase().indexOf(q) < 0 && String(n.title || '').toLowerCase().indexOf(q) < 0) return false;
      return true;
    }).sort(function (a, b) { return (b.updated || b.created || 0) - (a.updated || a.created || 0); });
  }
  /* 每行一次 bookTitle = 每次全表 parse；改 rev 键控 Map */
  let _btRev = -1, _btMap = null;
  function bookTitle(id) {
    if (!id) return '未关联书籍';
    const rv = BF.store.rev(BF.store.K.BOOKS_META);
    if (!_btMap || _btRev !== rv) {
      _btMap = new Map();
      try { (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).forEach(function (x) { if (x && x.id) _btMap.set(x.id, x.title); }); } catch (e) { _btMap = new Map(); }
      _btRev = rv;
    }
    return _btMap.has(id) ? _btMap.get(id) : '（书已删除）';
  }
  function create(bookId) {
    const n = { id: 'n_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6), bookId: bookId || BF.appState.currentBookId || '', title: '', text: '', tags: [], created: Date.now() };
    const list = all(); list.unshift(n); save(list);
    _editing = n.id;
    return n;
  }
  function update(id, patch) {
    const list = all();
    const n = list.find(function (x) { return x && x.id === id; });
    if (!n) return false;
    if (patch.title != null) n.title = String(patch.title).slice(0, 80);
    if (patch.text != null) n.text = String(patch.text).slice(0, MAX_TEXT);
    /* 内容 #tag 自动提取：从正文里抽 #标签 合并进 tags，
       去重、去 # 前缀，保留用户手填的标签 */
    if (patch.text != null) {
      const auto = (String(patch.text).match(/#([^\s#]+)/g) || []).map(function (t) { return t.slice(1); });
      if (auto.length) {
        const cur = (Array.isArray(n.tags) ? n.tags : []).map(function (t) { return String(t).replace(/^#/, ''); });
        n.tags = Array.from(new Set(cur.concat(auto))).filter(Boolean).slice(0, 8);
      }
    }
    if (patch.tags != null) n.tags = (Array.isArray(patch.tags) ? patch.tags : String(patch.tags).split(/[,，\s]+/))
      .map(function (t) { return String(t).trim().replace(/^#/, ''); }).filter(Boolean).slice(0, 8);
    n.updated = Date.now();
    return save(list);
  }
  /* 删除便签的唯一能力：确认与撤销都绑在这里——标注中心、AI 面板、
     hub（DSL 经此）都走这里，不能有「不问就删」的旁路
     （op note.delete, danger 2）。
     删完登记进撤销通道：撤销即原样插回（按下标定位，
     不甩到列表末尾）。 */
  async function remove(id) {
    const list0 = all();
    const ix = list0.findIndex(function (n) { return n && n.id === id; });
    if (ix < 0) return false;
    const cur = list0[ix];
    const wasEditing = _editing;
    const ok = await BF.ask.confirm({
      title: '删除便签',
      body: '确定删除便签「' + BF.dom.esc(String(cur.title || (cur.text || '').slice(0, 24) || '（无标题）')) + '」？',
      confirmText: '删除', danger: 2, op: 'note.delete', facts: {},
    });
    if (!ok) return false;
    BF.act.run('删除便签', function () {
      save(all().filter(function (n) { return n && n.id !== id; }));
      if (_editing === id) _editing = null;
    }, {
      undo: function () {
        const list = all();
        list.splice(Math.min(ix, list.length), 0, cur);
        save(list);
        if (wasEditing === id) _editing = id;
        /* 便签的三个可见面：编辑器 / 标注中心 / AI 研读中心便签折叠区；
           哪块开着重画哪块，全关着时下次打开自然带最新数据 */
        ['bf-notes', 'ann-across', 'ai-center'].forEach(function (pid) {
          try { if (BF.sheet && BF.sheet.rerender) BF.sheet.rerender(pid); } catch (e) {}
        });
      },
    });
    return true;
  }
  /* 打开面板 */
  function open() {
    let el = document.getElementById('bf-notes');
    if (!el) {
      /* 骨架统一由 BF._panel 工厂生成
         （customHTML 形态——头部含搜索框与新建
         按钮）；close 按钮带 data-panel-close
         走文档级委托。 */
      BF._panel('bf-notes', '便签', {
        cls: 'dlg-shell', cssText: '--dlg-top:6vh;--dlg-w:min(1000px,96vw);--dlg-h:88vh;--dlg-maxh:none',   /* 便签：唯一用定高而非上限的，所以必须显式撤掉默认上限，否则 88vh 被压成 84vh */
        html:
          '<header class="pk-panel__head"><span class="pk-panel__title">便签</span>' +
          '<div class="pk-panel__actions">' +
          '<input id="bn-q" class="input" placeholder="搜索便签…" style="width:180px;height:28px;font-size:12px" data-bn-q>' +
          '<button class="btn btn-xs" data-bn-new>+ 新建</button>' +
          '<button class="pk-panel__close" data-bn-close data-panel-close aria-label="关闭">' + BF.dom.ICON_CLOSE + '</button>' +
          '</div></header>' +
          '<div class="pk-panel__body" id="bn-body" style="flex:1;min-height:0;display:flex;gap:0;padding:0"></div>',
      });
      el = document.getElementById('bf-notes');
      el.querySelector('[data-bn-new]').addEventListener('click', function () { create(); render(); });
      const qi = el.querySelector('[data-bn-q]');
      let _qT = null;   /* 每击键全表过滤+重绘 → 180ms 防抖（与 diag 同口径） */
      qi.addEventListener('input', function () {
        _q = qi.value;
        if (_qT) clearTimeout(_qT);
        _qT = setTimeout(function () { _qT = null; render(); }, 180);
      });
    }
    BF.sheet.open('bf-notes', { render: render });
  }
  /* 入口（顶栏）是切换；书卡里那颗「打开便签编辑器」是导航。 */
  function toggle() {
    if (BF.sheet.closable('bf-notes')) { BF.sheet.close('bf-notes'); return false; }
    open(); return true;   /* 同上：便签骨架在 open() 里生成 */
  }
  function render() {
    const body = document.getElementById('bn-body');
    if (!body) return;
    const list = filtered();
    const books = Array.from(new Set(all().map(function (n) { return n.bookId; }).filter(Boolean)))
      .map(function (id) { return { id: id, t: bookTitle(id) }; });
    const tg = allTags();
    /* 筛选/切书后原选中项可能不在可见列表里：右侧会回落到列表首条，
       选中态必须同步落到同一条。这一步要放在左栏渲染之前 ——
       若等左栏 HTML 拼完再改 _editing，本次渲染的左栏就没有高亮，
       要等下一次重绘才补上（右栏已经显示首条了）。 */
    const cur = list.filter(function (n) { return n.id === _editing; })[0] || list[0] || null;
    if (cur && _editing !== cur.id) _editing = cur.id;

    const left =
      '<div style="width:270px;flex:none;border-right:1px solid var(--border);display:flex;flex-direction:column;min-height:0">' +
        '<div style="padding:8px;border-bottom:1px solid var(--border);display:flex;flex-direction:column;gap:6px">' +
          '<select class="select" data-bn-book style="width:100%;height:28px;font-size:12px">' +
            '<option value="">全部书籍（' + all().length + '）</option>' +
            books.map(function (b) { return '<option value="' + BF.dom.escAttr(b.id) + '"' + (_book === b.id ? ' selected' : '') + '>' + BF.dom.esc(b.t) + '</option>'; }).join('') +
          '</select>' +
          (tg.length ? '<div style="display:flex;flex-wrap:wrap;gap:4px">' +
            '<button class="btn btn-xs" data-bn-tag=""' + (_tag ? '' : ' style="border-color: var(--accent);color:var(--accent-ink)"') + '>无筛选</button>' +
            tg.slice(0, 12).map(function (t) {
              return '<button class="btn btn-xs" data-bn-tag="' + BF.dom.escAttr(t.tag) + '"' + (_tag === t.tag ? ' style="border-color: var(--accent);color:var(--accent-ink)"' : '') + '>#' + BF.dom.esc(t.tag) + ' ' + t.n + '</button>';
            }).join('') + '</div>' : '') +
        '</div>' +
        '<div style="flex:1;overflow-y:auto">' +
          (list.length ? list.map(function (n) {
            const on = _editing === n.id;
            const snip = String(n.text || '').replace(/\s+/g, ' ').slice(0, 60);
            return '<div data-bn-open="' + BF.dom.escAttr(n.id) + '" style="padding:8px 10px;border-bottom:1px solid var(--border);cursor:pointer;' +
              (on ? 'background:var(--bg-input);' : '') + '">' +
              '<div style="font-size:12.5px;color:var(--text);font-weight:' + (n.title ? '600' : '400') + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
                BF.dom.esc(n.title || snip || '（空便签）') + '</div>' +
              (n.title && snip ? '<div style="font-size:11px;color:var(--text-weak);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;margin-top:2px">' + BF.dom.esc(snip) + '</div>' : '') +
              '<div style="font-size:10px;color:var(--text-weak);margin-top:3px;display:flex;gap:6px;align-items:center">' +
                '<span>' + BF.dom.esc(bookTitle(n.bookId)) + '</span>' +
                tagsOf(n).slice(0, 3).map(function (t) { return '<span>#' + BF.dom.esc(t) + '</span>'; }).join('') +
                '<span style="margin-left:auto">' + new Date(n.updated || n.created || Date.now()).toLocaleDateString('zh-CN') + '</span>' +
              '</div></div>';
          }).join('') : (all().length
            ? BF.ui.blank({ compact: true, icon: BF.dom.ic('find'), msg: '没有匹配的便签', hint: '调整搜索词或筛选' })
            : BF.ui.blank({ compact: true, icon: BF.dom.ic('md'), msg: '还没有便签', hint: '点右上角「+ 新建」开始' }))) +
        '</div>' +
      '</div>';

    const right = cur
      ? '<div style="flex:1;min-width:0;display:flex;flex-direction:column;padding:12px;gap:8px">' +
          '<input id="bn-title" class="input" data-bn-title placeholder="标题（可留空）" value="' + BF.dom.escAttr(cur.title || '') + '" style="height:30px;font-size:13.5px;font-weight:600">' +
          '<div style="display:flex;gap:6px;align-items:center">' +
            '<input id="bn-tags" class="input" data-bn-tags placeholder="标签，逗号分隔" value="' + BF.dom.escAttr(tagsOf(cur).join(', ')) + '" style="flex:1;height:26px;font-size:12px">' +
            (cur.bookId && cur.bookId === BF.appState.currentBookId && BF.appState.currentPage === 'reader'
              ? '<button class="btn btn-xs" data-bn-locate title="在正文中定位">定位</button>' : '') +
            '<button class="btn btn-xs" data-bn-jump title="打开关联书籍">打开书</button>' +
            '<button class="btn btn-xs" data-bn-del style="color:var(--danger-ink)">删除</button>' +
          '</div>' +
          '<textarea id="bn-text" data-bn-text placeholder="写点什么…" style="flex:1;min-height:200px;resize:vertical;font-size:13px;line-height:1.75;padding:10px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--bg-input);color:var(--text);font-family:var(--sans)">' + BF.dom.esc(cur.text || '') + '</textarea>' +
          '<div id="bn-preview" data-bn-preview style="flex:1;min-height:200px;overflow-y:auto;display:none;font-size:13px;line-height:1.75;padding:10px;border:1px solid var(--border);border-radius:var(--r-card);background:var(--bg-input);color:var(--text)"></div>' +
          '<div style="display:flex;gap:8px;align-items:center;font-size:11px;color:var(--text-weak)">' +
            '<button class="btn btn-xs" data-bn-prev-toggle>预览</button>' +
            '<span data-bn-saved>' + (cur.updated ? '已保存 ' + new Date(cur.updated).toLocaleTimeString('zh-CN') : '未修改') + '</span>' +
            '<span style="margin-left:auto" data-bn-cnt>' + String(cur.text || '').length + ' 字</span>' +
          '</div>' +
        '</div>'
      : BF.ui.blank({ icon: BF.dom.ic('md'), msg: all().length ? '在左侧选择一条便签，或点右上角「+ 新建」' : '还没有便签' });

    body.innerHTML = left + right;

    /* 事件 */
    const bsel = body.querySelector('[data-bn-book]');
    if (bsel) bsel.addEventListener('change', function () { _book = bsel.value; render(); });
    /* 自绘下拉：便签面板是 innerHTML 重建的，每次都要重新接管。
       放在 addEventListener 之后 —— enhance 不改 value，原监听器照常收到 change。 */
    try { BF.app.sel.scan(body); } catch (e) { BF.err.report('sel.scan:notes', e); }
    body.querySelectorAll('[data-bn-tag]').forEach(function (b) {
      b.addEventListener('click', function () { _tag = b.getAttribute('data-bn-tag'); render(); });
    });
    body.querySelectorAll('[data-bn-open]').forEach(function (d) {
      d.addEventListener('click', function () { _editing = d.getAttribute('data-bn-open'); render(); });
    });
    if (!cur) return;
    const tEl = body.querySelector('[data-bn-title]');
    const xEl = body.querySelector('[data-bn-text]');
    const gEl = body.querySelector('[data-bn-tags]');
    const savedEl = body.querySelector('[data-bn-saved]');
    const cntEl = body.querySelector('[data-bn-cnt]');
    let _t = null;
    function _save() {
      const ok = update(cur.id, { title: tEl.value, text: xEl.value, tags: gEl.value });
      /* 保存指示按真实写入结果走：写失败仍显示「已保存」，
         用户关面板就丢稿，比不显示更害人。 */
      if (ok) {
        if (savedEl) savedEl.textContent = '已保存 ' + new Date().toLocaleTimeString('zh-CN');
      } else if (savedEl) {
        savedEl.textContent = '未保存：存储空间不足';
      }
      if (cntEl) cntEl.textContent = xEl.value.length + ' 字';
    }
    [tEl, xEl, gEl].forEach(function (e2) {
      e2.addEventListener('input', function () { if (_t) clearTimeout(_t); _t = setTimeout(_save, 600); });
      e2.addEventListener('blur', function () { if (_t) clearTimeout(_t); _save(); });
    });
    /* 预览切换：Markdown 渲染 + sanitize 防注入 */
    const pvBtn = body.querySelector('[data-bn-prev-toggle]');
    const pvBox = body.querySelector('[data-bn-preview]');
    if (pvBtn && pvBox) {
      pvBtn.addEventListener('click', function () {
        const on = pvBox.style.display !== 'none';
        if (on) {
          pvBox.style.display = 'none'; xEl.style.display = ''; pvBtn.textContent = '预览';
        } else {
          /* sanitize 缺失时不得把 md.render 的 HTML 原样 innerHTML——
             用户正文经 markdown 直通就是 XSS 通道。降级路径走 esc 纯文本：没有净化器
             就不该有富文本，宁可难看不可开门。 */
          const _html = BF.dom.sanitize
            ? BF.dom.sanitize(BF.md ? BF.md.render(xEl.value || '') : BF.dom.esc(xEl.value || ''))
            : BF.dom.esc(xEl.value || '');
          pvBox.innerHTML = _html;
          pvBox.style.display = ''; xEl.style.display = 'none'; pvBtn.textContent = '编辑';
        }
      });
    }
    const del = body.querySelector('[data-bn-del]');
    if (del) del.addEventListener('click', async function () {
      /* 确认内聚于 remove（note.delete, danger 2）；
         成功吐司由撤销通道自带，不再重复弹。 */
      if (await remove(cur.id)) { render(); }
    });
    const jb = body.querySelector('[data-bn-jump]');
    if (jb) jb.addEventListener('click', function () {
      if (!cur.bookId) { BF.noti.warn('这条便签没有关联书籍'); return; }
      const meta = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).filter(function (x) { return x && x.id === cur.bookId; })[0];
      if (!meta) { BF.noti.warn('关联的书籍已被删除，无法打开'); return; }
      BF.sheet.close('bf-notes');
      /* BF.app.openBook 内部转发 BF.reader.openBook（async），但外层没有 return，
         返回值是 undefined —— 不能直接 .then，否则必崩。
         统一用 Promise.resolve 兜住，兼容两种返回形态。 */
      try {
        Promise.resolve(BF.app.openBook(cur.bookId)).then(function () {
          BF.noti.info('已打开《' + bookTitle(cur.bookId) + '》');
        }, function (e) { BF.err.report('notes.openBook', e); BF.noti.error('打开书籍失败'); });
      } catch (e) {
        BF.err.report('notes.openBook', e);
        BF.app.openBook(cur.bookId);
        BF.noti.info('已打开《' + bookTitle(cur.bookId) + '》');
      }
    });
    const lb = body.querySelector('[data-bn-locate]');
    if (lb) lb.addEventListener('click', function () {
      /* 定位=打开章内查找并预填首个词，让用户能跳回原文出处 */
      BF.sheet.close('bf-notes');
      const kw = String(cur.text || '').trim().split(/\s+/).filter(function (w) { return w.length >= 2; })[0];
      BF.findInPage.open();
      const inp = document.getElementById('bf-find-input');
      if (inp && kw) {
        inp.value = kw;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      }
      BF.noti.info(kw ? ('章内查找已打开，搜索词「' + kw.slice(0, 12) + '」') : '已打开章内查找');
    });
  }
  return { open, toggle, render, create: create, update: update, remove: remove, all: all, filtered: filtered, allTags: allTags, _reset: function () { _q = ''; _book = ''; _tag = ''; _editing = null; } };
})();

BF.workshop = (function () {
  function esc(s) { return BF.dom.esc(s); }
  /* 打开文本制作弹窗 */
  function open() {
    const make = async function () {
      const titleEl = document.getElementById('wk-title');
      const textEl = document.getElementById('wk-text');
      const text = (textEl && textEl.value || '').trim();
      if (!text) { BF.noti.warn('文本不能为空'); return; }
      const title = (titleEl && titleEl.value.trim()) || text.split(/\n/)[0].slice(0, 30) || '未命名';
      try {
        BF.noti.info('正在分章...');
        const chapters = await BF.smart.chapters(text);
        if (!chapters || !chapters.length) { BF.noti.warn('分章结果为空'); return; }
        const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
        const id = BF.library.newBookId();
        const book = {
          id, title: title.slice(0, 60), size: BF.util.byteLen(text), importedAt: Date.now(),
          totalChapters: chapters.length, currentChapter: 0, lastRead: null,
          starred: false, tags: [], enc: 'utf-8', src: 'workshop',
          wordCount: chapters.reduce(function (s2, c) { return s2 + (c.content || '').length; }, 0),
        };
        try { var _putRc = await BF.library.__putChapters(id, chapters); }
        catch (e) {
          BF.err.report('workshop.idb', e);
          if (!BF.library.__lsFallback(id, chapters)) { BF.noti.error('正文入库失败'); return; }
          BF.noti.warn('IndexedDB 不可用，已回退本地存储');
        }
        /* 部分批次失败（腾退续写后仍败）：回执口径出声，不上抛（同导入三通道） */
        if (_putRc && _putRc.failed > 0) {
          BF.noti.warn('已存 ' + _putRc.written + ' 章、失败 ' + _putRc.failed + ' 章（缺章打开会显示读取失败，可释放空间后重试）');
        }
        /* R1：收敛进 mutate 串行写，回调内只 push 入参 book。 */
        const _pushed = await BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
          arr = arr || [];
          arr.push(book);
          return arr;
        });
        if (_pushed === false) BF.log && BF.log.warn('工坊制作的书籍条目写入失败（存储异常，如配额耗尽）');
        try { BF.bus.emit(BF.EVENTS.BOOKSHELF, id); } catch (e) {}
        BF.app.renderBookshelf(); BF.app.renderHome();
        BF.noti.success('已制作《' + book.title + '》' + book.totalChapters + ' 章');
        BF.app.openBook(id);
      } catch (e) {
        BF.err.report('workshop.make', e);
        BF.noti.error('制作失败：' + e.message);
      }
    };
    BF.modal.custom('文本制作书籍',
      '<div style="font-size:12px;color:var(--text-weak);margin-bottom:6px">粘贴小说/文档文本，自动分章入库。书名默认为首行（可改）。</div>' +
      '<input class="input" id="wk-title" style="width:100%;margin-bottom:8px" placeholder="书名（默认取首行）"/>' +
      '<textarea class="input" id="wk-text" style="width:100%;min-height:180px;font-size:12px;line-height:1.6;resize:vertical" placeholder="在此粘贴文本..."></textarea>' +
      '<div class="dlg-foot">' +
      '<button class="btn btn-sm" data-modal-cancel>取消</button>' +
      '<button class="btn btn-sm primary" data-modal-ok>制作书籍</button>' +
      '</div>',
      function (box, dismiss) {
        box.querySelector('[data-modal-cancel]').onclick = function () { dismiss(); BF.modal.hide(); };
        box.querySelector('[data-modal-ok]').onclick = function () { dismiss(); make(); BF.modal.hide(); };
      });
  }
  /* 批量设置作者（多选后） */
  function batchAuthor() {
    const sel = BF.appState.selectedBooks;
    if (!sel || !sel.size) { BF.noti.warn('请先选择书籍'); return; }
    BF.modal.prompt('批量作者', '输入作者（应用到所选书籍）：').then(function (val) {
      if (val === null) return;
      /* R1：selectedBooks 在回调外快照成 _sel（它随后会被清空），
         回调内只遍历快照，改 author 后返回 arr。 */
      const _sel = [...sel];
      const _author = val.trim();
      let c = 0;
      BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
        arr = arr || [];
        arr.forEach(function (b) { if (b && _sel.indexOf(b.id) >= 0) { b.author = _author; c++; } });
        return arr;
      }).then(function (ok) {
        if (ok === false) { BF.log && BF.log.warn('批量作者写入失败，书架数据可能未更新'); return; }
        BF.app.renderBookshelf(); BF.app.renderHome();
        BF.noti.success('已为 ' + c + ' 本书设置作者');
      });
    });
  }
  return { open: open, batchAuthor: batchAuthor };
})();

