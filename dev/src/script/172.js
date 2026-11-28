/* ================= 22. 全局委托绑定 ================= */
(function () {
  const d = BF.delegate;
  d.onClick('[data-nav]', function (e) { BF.app.go(e.target.closest('[data-nav]').dataset.nav); });
  d.onClick('[data-open-settings]', function () { BF.settingsUI.toggle(); });
  /* 统一阅读设置面板入口（设置→阅读区）：下钻到第三层同一组件。 */
  d.onClick('[data-open-readpanel]', function () { BF.settingsUI.render({ detail: 'readPanel' }); });
  d.onClick('[data-open-notes]', function () { BF.notes.toggle(); });
  d.onClick('[data-close-settings]', function () { BF.settingsUI.close(); });
  /* 分组恢复默认：只还原本组 data-set* 键。快照走 act 撤销通道（自带成功吐司），
     重渲染定位到所在分区（rerender），不整面重建、不丢滚动位。 */
  d.onClick('[data-reset-keys]', function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('[data-reset-keys]') : null;
    if (!btn) return;
    const keys = String(btn.getAttribute('data-reset-keys') || '').split(',').filter(Boolean);
    const D = BF.settings.DEFAULTS || {};
    const before = {}, dflt = {};
    keys.forEach(function (k) { if (k in D) { before[k] = BF.settings.get(k); dflt[k] = D[k]; } });
    if (!Object.keys(dflt).length) return;
    const host = btn.closest('[data-sec-host]');
    const sid = host ? host.getAttribute('data-sec-host') : null;
    const redraw = function () { try { if (!sid || !BF.settingsUI.rerender(sid)) BF.settingsUI.render(); } catch (err) { BF.err.report('settings.resetGroup', err); } };
    BF.act.run('恢复默认（' + Object.keys(dflt).length + ' 项）', function () {
      BF.settings.patch(dflt);
      try { BF.theme.apply(); } catch (err) {}
      redraw();
    }, {
      /* 分组重置是设置动作 ⇒ 不带书归属，与全局恢复默认同判据 */
      bookId: null,
      undo: function () {
        BF.settings.patch(before);
        try { BF.theme.apply(); } catch (err) {}
        redraw();
      },
    });
  });
  d.onClick('[data-close-reader]', function () { BF.app.closeReader(); });
  d.onClick('[data-go-home]', function () { BF.app.go('home'); });
  d.onClick('[data-open-drawer]', function (e) {
    /* 「目录」按钮按**入口**定栏：抽屉上次停在搜索/书签栏时再点它，开的也必须是目录。
       过去这里只调 toggleDrawer，落点是「上次停留的那一栏」——按钮名与结果不符。
       已经在目标栏且抽屉开着时再点才收起（开/合的开关语义留给同一栏）。 */
    const tab = (e.target.closest('[data-open-drawer]').dataset.openDrawer || '').trim() || 'toc';
    if (BF.sheet.isOpen('drawer') && BF.appState.drawerTabName === tab) BF.reader.closeDrawer();
    else BF.reader.openDrawer(tab);
  });
  d.onClick('[data-close-drawer]', function () { BF.reader.closeDrawer(); });
  d.onClick('[data-drawer-tab]', function (e) { BF.reader.drawerTab(e.target.closest('[data-drawer-tab]').dataset.drawerTab); });
  d.onClick('[data-continue]', function () { BF.app.continueRead(); });
  d.onClick('[data-resume-tts]', function () { BF.tts.resumeTTS(); });
  /* 续读提示点击继续 → 打开该书 + 跳上次章节 + 恢复滚动位置 */
  d.onClick('[data-resume-read]', function (e) {
    const id = e.target.closest('[data-resume-read]').dataset.resumeRead;
    const tip = document.getElementById('resume-tip');
    if (tip) tip.classList.remove('show');
    if (!id) return;
    const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || [];
    const b = books.find(function (x) { return x && x.id === id; });
    if (!b) { BF.noti.warn('上次阅读的书已不存在'); return; }
    const rs = BF.store.lsGet(BF.store.K.READING_STATE, {}) || {};
    const st = rs[id] || {};
    const ch = (typeof st.currentChapter === 'number') ? st.currentChapter : (b.currentChapter || 0);
    BF.app.openBook(id).then(function () {
      BF.reader.gotoChapter(ch);
      /* 恢复滚动位置（scroll 模式） */
      if (!BF.reader.pageModeActive()) {
        const sv = BF.store.lsGet(BF.store.K.SCROLL_ + id, 0);
        const wrap = document.getElementById('reader-wrap');
        if (wrap && typeof sv === 'number' && sv >= 0 && sv < 1e7) {
          setTimeout(function () { wrap.scrollTop = sv; }, 50);
        }
      }
      BF.noti.info('已回到上次阅读位置');
    }).catch(function (err) { BF.err.report('resume-read', err); });
  });
  d.onClick('[data-back-top]', function () { const w = document.getElementById('reader-wrap'); if (w) w.scrollTop = 0; });
  d.onClick('[data-nav-back]', function () { if (BF.nav) BF.nav.back(); });
  d.onClick('[data-nav-forward]', function () { if (BF.nav) BF.nav.forward(); });
  d.onClick('[data-rebind]', function (e) { BF.hotkeys.beginCapture(e.target.closest('[data-rebind]').dataset.rebind); });
  /* 导入非破坏（不想要的书走书架删除进回收站），
     无可撤对象 —— 不传 undo；失败人话化反馈走通道。 */
  d.onClick('[data-trigger-import]', function () { BF.act.run('导入文件', function () { BF.library.pickAndImport(); }); });
  d.onClick('[data-clear-shelf]', function (e) {
    const t = e.target.closest('[data-clear-shelf]'); if (!t) return;
    const what = t.getAttribute('data-clear-shelf');
    BF.library.clearShelfFilters({ tag: what !== 'search', group: what !== 'search', search: what !== 'filter' });
  });
  d.onClick('[data-clipboard-import]', function () { BF.library.importClipboard(); });
  d.onClick('[data-url-import]', function () { BF.library.promptImportURL(); });
  d.onClick('[data-open-book]', function (e) { BF.app.openBook(e.target.closest('[data-open-book]').dataset.openBook); });
  d.onClick('[data-toggle-select]', function (e) { BF.app.toggleSelect(e.target.closest('[data-toggle-select]').dataset.toggleSelect); });
  d.onClick('[data-book-menu]', function (e) {
    /* 与右键菜单同一份实现（BF.library.openBookMenu），位置给按钮下沿。
       同一张卡再点一次＝收起，避免「点了关不掉只能点别处」。 */
    const btn = e.target.closest('[data-book-menu]');
    const id = btn.dataset.bookMenu;
    const m = document.getElementById('bf-book-ctx');
    if (m && m.style.display !== 'none' && m.dataset.owner === id) { BF.library.closeBookMenu(); return; }
    const r = btn.getBoundingClientRect();
    BF.library.openBookMenu(id, r.left, r.bottom + 4, btn);
  });
  /* 卡面常驻动作挑选器（设置节与书架就地入口共用同一份渲染，故共用这一份接线） */
  d.onClick('[data-ba-add]', function (e) {
    const btn = e.target.closest('[data-ba-add]'); if (!btn) return;
    const id = btn.dataset.baAdd;
    const cur = BF.bookCardOnCardIds();
    if (cur.length >= BF.BOOK_CARD_MAX) { BF.noti.warn('卡面最多常驻 ' + BF.BOOK_CARD_MAX + ' 枚（第四枚会压住卡片左上的选择圈），先移出一枚再放这枚。'); return; }
    const res = BF.bookCardActionsSet(cur.concat([id]));
    if (res.reason) BF.noti.warn(res.reason);
    BF.bookActionsRefreshPickers();
  });
  d.onClick('[data-ba-remove]', function (e) {
    const btn = e.target.closest('[data-ba-remove]'); if (!btn) return;
    const id = btn.dataset.baRemove;
    BF.bookCardActionsSet(BF.bookCardOnCardIds().filter(function (x) { return x !== id; }));
    BF.bookActionsRefreshPickers();
  });
  d.onClick('[data-shelf-picker]', function () {
    const p = document.getElementById('shelf-picker'); if (!p) return;
    if (p.hidden) { p.innerHTML = BF.bookActionsPickerHTML(); p.hidden = false; }
    else p.hidden = true;
  });
  /* 卡面常驻动作：按钮只带 id，实现回 BF.BOOK_ACTIONS 取。
     委托按「最具体者胜」选处理器，所以点动作不会被卡根的 data-open-book 抢走。 */
  d.onClick('[data-book-act]', function (e) {
    const btn = e.target.closest('[data-book-act]'); if (!btn) return;
    const a = BF.bookActionById(btn.dataset.bookAct);
    if (!a) { BF.noti.warn('这个书卡动作已不在登记表里：' + btn.dataset.bookAct); return; }
    try { a.run(btn.dataset.bookId); } catch (err) { BF.err.report('book.cardAct:' + a.id, err); }
  });
  d.onClick('[data-focus-noise]', function (e) {
    const on = !BF.settings.get('focusAutoNoise');
    BF.settings.set('focusAutoNoise', on);
    e.target.textContent = '自动白噪音：' + (on ? '开' : '关');
    BF.focus._render();
    BF.noti.info('专注自动白噪音：' + (on ? '开' : '关'));
  });
  d.onClick('[data-view]', function (e) { BF.app.setView(e.target.closest('[data-view]').dataset.view); });
  d.onClick('[data-batch]', function (e) { BF.app.batchAction(e.target.closest('[data-batch]').dataset.batch); });
  d.onClick('[data-nav-chapter]', function (e) {
    const dir = e.target.closest('[data-nav-chapter]').dataset.navChapter;
    if (dir === 'prev') BF.reader.prevChapter(); else BF.reader.nextChapter();
  });
  d.onChange('[data-search-books]', function () { BF.app.renderBookshelf(); });
  /* 跨书搜索 */
  d.onClick('[data-across-search]', function () { BF.library.openAcrossSearch(); });
  /* 热力图格子点击 → 当日明细；明细里的「继续读」→ 打开该书 */
  d.onClick('[data-heat-date]', function (e) {
    const k = e.target.closest('[data-heat-date]').dataset.heatDate;
    if (!k) return;
    const v4 = BF.modules && BF.modules.get ? BF.modules.get('enh.v4') : null;
    const fn = (v4 && v4.showDayDetail) || BF.enh.showDayDetail;
    if (fn) fn(k); else BF.noti.warn('热力图明细暂不可用');
  });
  d.onClick('[data-heat-open]', function (e) {
    const id = e.target.closest('[data-heat-open]').dataset.heatOpen;
    if (!id) return;
    if (BF.modal && BF.modal.hide) { try { BF.modal.hide(); } catch (e2) {} }
    BF.app.openBook(id);
  });
  d.onClick('[data-across-goto]', function (e) {
    const el = e.target.closest('[data-across-goto]');
    const id = el.dataset.acrossGoto;
    const ch = parseInt(el.dataset.acrossCh, 10) || 0;
    const pos = el.dataset.acrossPos ? parseInt(el.dataset.acrossPos, 10) : null;
    const hitQ = el.dataset.acrossQ || '';
    BF.sheet.close('bf-across-search');
    /* 跨书搜索跳转带章内偏移 pos（与书内搜索同款 gotoCharOffset 定位）。
       BF.app.openBook 返回 Promise，此处 .then 可用。 */
    BF.app.openBook(id).then(function () {
      BF.reader.gotoChapter(ch);
      if (typeof pos === 'number' && BF.reader.gotoCharOffset) {
        /* 等章节渲染完成后再定位（openBook/gotoChapter 是 async，但 DOM 渲染在其内部同步完成；
           仍加一层微任务确保 loadChapter 的 DOM 已挂载） */
        BF.timers.timeout(function () { try { BF.reader.gotoCharOffset(pos, { highlight: true, q: hitQ }); } catch (err2) { BF.err.report('across-pos', err2); } }, 60);
      }
    }).catch(function (err) { BF.err.report('across-goto', err); });
  });
  d.onChange('[data-sort-books]', function (e) {
    /* 排序选择写进设置：刷新后还在，DSL 与运维台也能读到当前排法 */
    try { BF.settings.set('shelfSort', String((e.target && e.target.value) || 'recent')); } catch (err) {}
    BF.app.renderBookshelf();
  });
  /* 搜索输入防抖（input 事件，250ms 合并） */
  (function () {
    const sb = document.getElementById('book-search');
    if (sb) {
      let t = null;
      sb.addEventListener('input', function () {
        if (t) clearTimeout(t);
        t = setTimeout(function () { BF.app.renderBookshelf(); }, 250);
      });
    }
  })();
  d.onChange('[data-tag-filter]', function (e) { BF.library.applyTagFilter(e.target.value); });
  d.onChange('[data-group-filter]', function (e) { BF.library.applyGroupFilter(e.target.value); });
  d.onClick('[data-shelf-manage]', function () { BF.shelf.openManage(); });
  d.onChange('[data-file-input]', function (e) { BF.library.handleFiles(e); });

  d.onClick('[data-goto-ch]', function (e) {
    const el = e.target.closest('[data-goto-ch]');
    const ch = parseInt(el.dataset.gotoCh, 10);
    /* 搜索结果携带命中偏移（data-goto-pos）与关键词（data-goto-q），点击后跳到那一句并临时高亮。
       目录/书签项没有 pos，保持原行为（只切章）。 */
    const pos = el.dataset.gotoPos;
    const hasPos = pos !== undefined && pos !== '';
    const q = el.dataset.gotoQ || '';
    /* 定位必须排在切章之后：gotoChapter 是 async，先高亮会被随后重建的正文抹掉
       （表现就是「点了搜索结果，页面无动于衷」）。
       gotoChapter 各分支返回类型不一，统一包 Promise.resolve 再挂。 */
    const _jump = BF.reader.gotoChapter(ch);
    BF.reader.closeDrawer();
    if (hasPos && BF.reader.gotoCharOffset) {
      Promise.resolve(_jump).then(function () {
        BF.reader.gotoCharOffset(parseInt(pos, 10), { highlight: true, q: q });
      });
    }
  });
  d.onClick('[data-next-chapter]', function () { BF.reader.nextChapter(); });
  /* 外部图片占位点击加载：sanitize 默认把远程 src 挪到 data-lazy-src（不自动发请求） */
  d.onClick('.bf-img-pending', function (e) {
    const el = e.target.closest ? e.target.closest('.bf-img-pending') : null;
    const url = el && el.getAttribute ? el.getAttribute('data-lazy-src') : '';
    if (!el || !url) return;
    el.setAttribute('src', url);
    el.removeAttribute('data-lazy-src');
    el.removeAttribute('title');
    el.classList.remove('bf-img-pending');
  });
  /* 重新导入同导入 —— 非破坏，无可撤对象，
     不传 undo；失败人话化反馈走通道。 */
  d.onClick('[data-reimport-book]', function () { BF.act.run('重新导入', function () { BF.library.pickAndImport(); }); });
  /* 章末卡「全书读完」态的「回顾本书」按钮 → 本书回顾卡 */
  d.onClick('[data-review-card]', function () { BF.reader.showReviewCard(); });
  d.onClick('[data-progress-bar]', function (e) {
    const b = BF.reader.state.book; if (!b || !b.totalChapters) return;
    /* 委托监听挂在 document 上，e.currentTarget 恒为 document、没有 getBoundingClientRect；
       这里必须自己 closest 回被点的条（同文件 [data-search-hist] 就是这个写法）。
       直接读 currentTarget ⇒ 每次点击都抛错、又被委托层的 err.report 吞掉，
       「点击跳转章节」这个 title 承诺就落空。 */
    const bar = e.target.closest('[data-progress-bar]');
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const idx = Math.min(b.totalChapters - 1, Math.floor(pct * b.totalChapters));
    BF.reader.gotoChapter(idx);
  });
  /* 进度条 hover 预览：鼠标移动时显示「章名 · 百分比」气泡，点击前先知道会跳到哪，
     消除「误点一下飞走」的未知感；点击跳章逻辑保持不变。 */
  (function () {
    var bar = document.getElementById('reader-progress');
    if (!bar) return;
    var tip = document.createElement('div');
    tip.className = 'reader-progress-tip';
    tip.setAttribute('role', 'tooltip');
    tip.hidden = true;
    document.body.appendChild(tip);
    function pctAt(cx) { var r = bar.getBoundingClientRect(); return Math.min(1, Math.max(0, (cx - r.left) / r.width)); }
    bar.addEventListener('mousemove', function (e) {
      var b = BF.reader.state.book; if (!b || !b.totalChapters) { tip.classList.remove('show'); return; }
      var p = pctAt(e.clientX);
      var idx = Math.min(b.totalChapters - 1, Math.floor(p * b.totalChapters));
      var chs = BF.reader.state.chapters;
      var name = (chs && chs[idx] && chs[idx].title) ? chs[idx].title : ('第 ' + (idx + 1) + ' 章');
      tip.textContent = name + ' · ' + Math.round(p * 100) + '%';
      var r = bar.getBoundingClientRect();
      tip.style.left = e.clientX + 'px';
      tip.style.top = (r.top - 6) + 'px';
      tip.hidden = false;
      tip.classList.add('show');
    });
    bar.addEventListener('mouseleave', function () { tip.classList.remove('show'); tip.hidden = true; });
  })();
  d.onClick('[data-search-hist]', function (e) {
    const q = e.target.closest('[data-search-hist]').dataset.searchHist;
    const inp = document.getElementById('search-input');
    if (inp) { inp.value = q; BF.reader.searchAll(q); }
  });
  /* 入口不再套 BF.act.run —— delBookmark / delNote 自己走通道，
     撤销登记与失败反馈都在能力内聚点完成。外层再包一次就是同一个动作
     两条反馈路径（内层已经弹过，外层失败时再弹一遍）。 */
  d.onClick('[data-del-bm]', function (e) { BF.reader.delBookmark(parseInt(e.target.closest('[data-del-bm]').dataset.delBm, 10)); });
  d.onClick('[data-del-note]', function (e) { BF.reader.delNote(e.target.closest('[data-del-note]').dataset.delNote); });
  /* 书签/划线「回到原文」——跳章 + 按 charOffset 定位到那一行 */
  d.onClick('[data-goto-origin]', function (e) {
    const el = e.target.closest('[data-goto-origin]');
    const ch = parseInt(el.dataset.gotoOrigin, 10);
    const off = parseInt(el.dataset.originOff, 10);
    if (isNaN(ch)) return;
    BF.reader.closeDrawer();
    const _jump = BF.reader.gotoChapter(ch);
    /* 等切章真的落地再定位，不拿 120ms 当「应该切完了」：
       大章的正文是异步读的，固定延时会先在高亮旧 DOM 上做一次无效定位，
       表现是「点了原文，位置没动」。与搜索结果那条同一口径（Promise.resolve 包一层，
       gotoChapter 各分支返回类型不一）。 */
    if (!isNaN(off) && BF.reader.gotoCharOffset) {
      Promise.resolve(_jump).then(function () { BF.reader.gotoCharOffset(off, { highlight: true }); });
    }
  });
  /* 生词「回到原文」——跳章 + 在章内找到该词首次出现处 */
  d.onClick('[data-vocab-goto]', function (e) {
    const el = e.target.closest('[data-vocab-goto]');
    const w = el.dataset.vocabGoto;
    const ch = parseInt(el.dataset.vocabGotoCh, 10);
    if (!w || isNaN(ch)) return;
    BF.sheet.close('bf-notes');
    BF.reader.closeDrawer();
    BF.reader.gotoChapter(ch).then(function () {
      const paras = BF.reader.state.paras || [];
      for (let i = 0; i < paras.length; i++) {
        const off = (paras[i] || '').indexOf(w);
        if (off >= 0) {
          /* 段前缀和走 BF.cfi 唯一实现 */
          BF.reader.gotoCharOffset(BF.cfi.locToOffset({ si: i, so: off }, paras), { highlight: true, q: w });
          return;
        }
      }
      BF.noti.info('在本书中未找到该生词原文');
    }).catch(function (err) { BF.err.report('vocab-goto', err); });
  });
  d.onChange('[data-search-input]', function (e) { BF.reader.searchAll(e.target.value.trim()); });
  d.onClick('[data-search-go]', function () {
    const inp = document.getElementById('search-input');
    BF.reader.searchAll((inp && inp.value || '').trim());
  });
  /* TTS */
  d.onClick('[data-tts]', function (e) {
    const act = e.target.closest('[data-tts]').dataset.tts;
    if (act === 'start') BF.tts.start();
    else if (act === 'play') BF.tts.toggle();
    else if (act === 'stop') BF.tts.stop();
    else if (act === 'prevChapter') BF.tts.prevChapter();
    else if (act === 'nextChapter') BF.tts.nextChapter();
    else if (act === 'try') BF.tts.tryVoice();
  });
  d.onChange('[data-tts-rate]', function (e) { BF.tts.setRate(e.target.value); });
  d.onClick('[data-tts-timer]', function () { BF.tts.cycleTimer(); });
  /* 选中工具条 */
  d.onClick('[data-sel]', function (e) {
    const act = e.target.closest('[data-sel]').dataset.sel;
    if (act === 'bookmark') BF.reader.addBookmark();
    else if (act === 'note-underline') BF.reader.addNote('underline');
    else if (act === 'note-wavy') BF.reader.addNote('wavy');
    else if (act === 'note-bg') BF.reader.addNote('bg');
    else if (act === 'hl-color') BF.reader.pickHlColor();
    else if (act === 'copy') BF.reader.copySel();
    else if (act === 'search') BF.reader.searchSel();
    else if (act === 'vocab') BF.reader.addVocab();
    else if (act === 'speak') BF.reader.speakSel();
    else if (act === 'ask-ai') BF.reader.askAISel();
  });
  /* AI 摘要（阅读器 bottom） */
  d.onClick('[data-ai-summary]', function () {
    /* T5：无密钥不创建常驻浮层，只给一条带「去设置」的提示——原逻辑在无密钥时把浮层停在「生成中」永不动。 */
    if (!BF.ai.hasKey()) {
      BF.noti.info('未配置 AI 密钥，无法生成章节摘要', {
        action: { label: '去设置', run: function () {
          try { BF.settingsUI.open('ai'); } catch (e) {}
        } }
      });
      return;
    }
    const box = document.createElement('div');
    box.id = 'ai-summary-pop';
    box.innerHTML = '<div style="font-weight:600;margin-bottom:8px;color:var(--text)">章节摘要</div><div style="color:var(--text-weak)">生成中...</div>';
    document.body.appendChild(box);
    /* 关闭监听在创建时就挂：只在 runCard 尘埃落定后挂会漏掉「一直不回包」的那条路，
       超时文案写着「点击关闭」却点不掉。 */
    box.addEventListener('click', function () { box.remove(); });
    /* T5：建议 10s 超时——真机无应答时浮层显示中文失败态（带关闭提示），不再永久「生成中」。 */
    let _done = false;
    const _to = setTimeout(function () {
      if (_done || !box.isConnected) return;
      _done = true;
      box.innerHTML = '<div style="font-weight:600;margin-bottom:8px;color:var(--text)">章节摘要</div><div style="color:var(--danger-ink)">生成超时，请稍后重试（点击关闭）</div>';
    }, 10000);
    BF.ai.runCard('summary-chapter', {
      setResult: function (text) {
        _done = true; try { clearTimeout(_to); } catch (e) {}
        const b = document.getElementById('ai-summary-pop');
        /* 无 sanitize 兜底 esc 纯文本，避免 TypeError 被吞导致卡在「生成中」 */
        const _rendered = BF.md ? BF.md.render(text) : String(text || '');
        const _safe = BF.dom.sanitize ? BF.dom.sanitize(_rendered) : BF.dom.esc(String(text || ''));
        if (b) b.innerHTML = '<div style="font-weight:600;margin-bottom:8px;color:var(--text)">章节摘要</div>' + _safe;
      },
    }).catch(function (e) {
      /* T5：失败态只给中文结论——不再把英文异常拼给用户（复制提示词已统一走 BF.copyText 中文兜底） */
      _done = true; try { clearTimeout(_to); } catch (e2) {}
      const b = document.getElementById('ai-summary-pop');
      if (b) b.innerHTML = '<div style="font-weight:600;margin-bottom:8px;color:var(--text)">章节摘要</div><div style="color:var(--danger-ink)">生成失败，请稍后重试（点击关闭）</div>';
    });
  });
  /* 书卡菜单（右键 与 卡上「菜单」按钮共用一份 items 与一把游标）：
     打开 / 书籍信息 / 置顶 / 收藏 / 设置标签 / 重命名 / 导出 TXT / 删除（+ 有待确认时给 AI 分章建议） */
  (function () {
    let _menu = null;
    /* 与 .bf-sel 同用 listbox/option + 共享游标（游标只在 BF.app.sel.cursor 绘制）——
       div 条目不可聚焦时键盘完全进不去，这套菜单不能是纯鼠标件。 */
    let _ctxItems = null, _ctxActive = -1, _ctxPrev = null, _ctxCtlItems = null;
    function closeMenu() {
      if (!_menu || _menu.style.display === 'none') return;
      const kb = document.activeElement === _menu;
      _menu.style.display = 'none';
      _menu.removeAttribute('aria-activedescendant');
      if (_ctxItems) _ctxItems.forEach(function (el) { el.classList.remove('is-active'); });
      _ctxActive = -1;
      if (_ctxPrev && _ctxPrev.setAttribute && _ctxPrev.hasAttribute('aria-expanded')) _ctxPrev.setAttribute('aria-expanded', 'false');
      /* 菜单项多半触发重渲染（收藏/置顶/标签/删除），开菜单的那枚按钮此时已从文档里掉出来，
         直接 focus 它等于把键盘用户丢回 body —— 掉出来了就按菜单记录的归属重新找回同一本书的按钮。 */
      if (kb && _ctxPrev && _ctxPrev.focus) {
        let back = _ctxPrev;
        if (!_ctxPrev.isConnected && _menu && _menu.dataset.owner) {
          back = document.querySelector('[data-book-menu="' + _menu.dataset.owner + '"]') || _ctxPrev;
        }
        try { back.focus(); } catch (e) {}
      }
    }
    /* 菜单项基本都会触发书架重渲染（收藏 / 置顶 / 标签）：
       关菜单那一刻焦点还在旧按钮上，渲染完成后那颗按钮已掉出文档、焦点落回 body。
       所以执行完再补一次找回，时机排在渲染的微任务之后（setTimeout 0）。 */
    function refocusOpener(wasKb) {
      if (!wasKb || !_menu || !_menu.dataset.owner) return;
      setTimeout(function () {
        if (_ctxPrev && _ctxPrev.isConnected && document.activeElement === _ctxPrev) return;
        if (document.activeElement && document.activeElement !== document.body) return;
        const back = document.querySelector('[data-book-menu="' + _menu.dataset.owner + '"]');
        if (back) { try { back.focus(); } catch (e) {} }
      }, 0);
    }
    /* 右键菜单与书卡上的「菜单」按钮共用这一个实现：同一份 items、同一把游标，
       不写第二套（两套游标会互相打架）。 */
    function openBookMenu(id, x, y, opener) {
      closeMenu();
      const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
      const b = books.find(function (x) { return x && x.id === id; });
      if (!_menu) {
        _menu = document.createElement('div');
        _menu.id = 'bf-book-ctx';
        _menu.setAttribute('role', 'listbox');
        _menu.setAttribute('aria-label', '书籍操作');
        _menu.tabIndex = -1;
        _menu.addEventListener('keydown', function (e) {
          if (e.key === 'Tab') { closeMenu(); return; }
          const ctl = {
            nodes: function () { return _ctxItems || []; },
            active: function () { return _ctxActive; },
            setActive: function (n) { _ctxActive = BF.app.sel.cursor(_ctxItems || [], n, _menu); },
            pick: function (n) {
              const it = _ctxCtlItems && _ctxCtlItems[n];
              const wasKb = document.activeElement === _menu;
              closeMenu();
              if (it) { try { it.run(); } catch (err) { BF.err.report('book.ctx:' + it.label, err); BF.noti.error('操作失败：' + (err && err.message || '未知错误')); } }
              refocusOpener(wasKb);
            },
            close: function () { closeMenu(); },
          };
          BF.app.sel.nav(e, ctl);
        });
        document.body.appendChild(_menu);
      }
      /* 菜单项与卡面按钮同一份来源：整份来自 BF.BOOK_ACTIONS（经 BF.bookMenuItems 过 cond）。
         另抄一份清单的话，加一个动作要在两处点名、改名也要改两处。 */
      const items = BF.bookMenuItems(b || { id: id });
      /* 条件项可能为空（如本书没有待确认的 AI 分章建议），先滤掉再编号，
         否则 data-i 与数组下标错位，点下去执行的是别一项的动作 */
      const vis = items.filter(function (x) { return !!x; });
      _ctxCtlItems = vis;
      _menu.innerHTML = vis.map(function (it, i) {
        return '<div class="ctx-item' + (it.danger ? ' danger' : '') + '" role="option" aria-selected="false" id="bfctx-i' + i + '" data-i="' + i + '">' + BF.dom.esc(it.label) + '</div>';
      }).join('');
      _menu.style.display = 'block';
      /* 位置由调用方给（右键＝指针处，按钮＝按钮下沿），这里只做「别出屏」的夹取 */
      const px = Math.max(8, Math.min(x, window.innerWidth - 170));
      const py = Math.min(y, window.innerHeight - _menu.offsetHeight - 8);
      _menu.style.left = px + 'px'; _menu.style.top = py + 'px';
      /* 打开即接管键盘（焦点落容器、游标画首项） */
      _ctxItems = Array.prototype.slice.call(_menu.querySelectorAll('.ctx-item'));
      _ctxActive = -1;
      _ctxPrev = opener || document.activeElement;
      /* 菜单 dataset 记的是「哪本书的菜单」，按钮委托据此判断同卡再点＝收起 */
      _menu.dataset.owner = String(id || '');
      if (opener && opener.setAttribute) opener.setAttribute('aria-expanded', 'true');
      try { _menu.focus(); } catch (err) {}
      _ctxActive = BF.app.sel.cursor(_ctxItems, 0, _menu);
      _menu.onclick = function (ev) {
        const it = ev.target && ev.target.closest ? ev.target.closest('.ctx-item') : null;
        if (!it) return;
        const a = vis[+it.dataset.i];
        closeMenu();
        try { a && a.run(); } catch (err) { BF.err.report('book.ctx:' + a.label, err); BF.noti.error('操作失败：' + (err && err.message || '未知错误')); }
      };
    }
    BF.library.openBookMenu = openBookMenu;
    BF.library.closeBookMenu = closeMenu;
    document.addEventListener('contextmenu', function (e) {
      const card = e.target && e.target.closest ? e.target.closest('.book-card') : null;
      closeMenu();
      if (!card || !card.dataset.openBook) return;
      e.preventDefault();
      openBookMenu(card.dataset.openBook, e.clientX, e.clientY, null);
    });
    /* 「点别处就关」的全局 click 与菜单按钮的 click 同阶段派发：委托注册在前、先跑，
       所以这里要把按钮自身排除掉，否则刚打开的菜单会被同一个事件立刻收起。 */
    document.addEventListener('click', function (e) {
      if (e.target && e.target.closest && e.target.closest('[data-book-menu]')) return;
      closeMenu();
    });
  })();
})();
