/* ================= 25b. 增强层（V4，原生模块） =================
   - 挂 BF.enh.v4 命名空间，注册为模块 enh.v4（install 钩子初始化），
     不依赖 window load / 独立 script（与主程序生命周期一致）
   - 版本号读 BF.VERSION_DISPLAY，不写死
   - 快捷键与主 hotkeys 表让位：DSL 终端(dsl-console)/模态/导入 打开时
     不抢空格翻页；? 速查、Ctrl+G 跳章、Ctrl+±0 字号为未占用的键
   功能：快捷键速查面板 / 全书进度芯片+预计剩余 / 标签页标题同步 /
         空格翻页·边界切章·字号微调·Ctrl+G / 笔记书签导出 MD /
         首页热力图+继续阅读增强 / 书卡进度百分比 / 导入完成直接开读
   ============================================================ */
BF.enh.v4 = (function () {
  const S = function () { return BF.settings; }, store = function () { return BF.store; };
  /* 容错包装：任何一步失败只留痕，不影响主程序 */
  function safe(fn, tag) { return function () { try { return fn.apply(this, arguments); } catch (e) { try { BF.err.report('v4:' + tag, e); } catch (_) {} } }; }

  /* ---------- 1. 快捷键速查面板 ----------
     速查表唯一实现：从 BF.hotkeys 注册表（热键 + 行为键）
     生成，每次打开重渲染，用户自定义键位实时生效——
     独立维护静态表会与使用手册 / 设置帮助互相矛盾。 */
  function cheatGroups() {
    const groups = [['导航', []], ['阅读', []], ['朗读', []], ['工具', []]];
    const pick = function (cat) {
      for (let i = 0; i < groups.length; i++) if (groups[i][0] === cat) return groups[i][1];
      return groups[3][1];
    };
    const hks = (BF.hotkeys && typeof BF.hotkeys.list === 'function') ? BF.hotkeys.list() : [];
    for (let i = 0; i < hks.length; i++) {
      const h = hks[i];
      if (!h || !h.id || /\.mac$/.test(h.id)) continue;
      let cat = '工具';
      if (/^nav\./.test(h.id)) cat = '导航';
      else if (/^(read|find)\./.test(h.id)) cat = '阅读';
      else if (/^tts\./.test(h.id)) cat = '朗读';
      const combo = (BF.hotkeys && typeof BF.hotkeys.fmt === 'function') ? BF.hotkeys.fmt(h.combo) : h.combo;
      const label = (BF.hotkeys && BF.hotkeys.LABELS) ? (BF.hotkeys.LABELS[h.id] || h.id) : h.id;
      pick(cat).push([combo, label]);
    }
    const bk = (BF.hotkeys && typeof BF.hotkeys.behaviorKeys === 'function') ? BF.hotkeys.behaviorKeys() : [];
    for (let j = 0; j < bk.length; j++) pick(bk[j][0]).push([bk[j][1], bk[j][2]]);
    return groups;
  }
  function cheatGridHTML() {
    const esc = function (s) { return BF.dom.esc(s); };
    return cheatGroups().map(function (g) {
      return '<div class="v4-cheat-g">' + esc(g[0]) + '</div>' +
        g[1].map(function (r) { return '<div class="v4-cheat-row"><span>' + esc(r[1]) + '</span><kbd>' + esc(r[0]) + '</kbd></div>'; }).join('');
    }).join('');
  }
  function toggleCheat(force) {
    let mask = document.getElementById('v4-cheat');
    if (!mask) {
      mask = document.createElement('div');
      mask.id = 'v4-cheat';
      mask.className = 'v4-cheat-mask';
      mask.innerHTML = '<div class="v4-cheat-box" role="dialog" aria-label="快捷键速查">' +
        '<h3>快捷键速查</h3><div class="v4-cheat-sub">按 Esc 或点击空白处关闭</div>' +
        '<div class="v4-cheat-grid" data-cheat-grid></div></div>';
      mask.addEventListener('mousedown', function (e) { if (e.target === mask) toggleCheat(false); });
      document.body.appendChild(mask);
    }
    /* 每次打开重渲染 —— 用户自定义键位实时生效 */
    const grid = mask.querySelector('[data-cheat-grid]');
    if (grid) grid.innerHTML = cheatGridHTML();
    /* 状态读 sheet 的账，不再各处从 class 重复推导。
       速查表是压在读页之上的一层 → tier:'overlay'。 */
    const show = force !== undefined ? force : !BF.sheet.isOpen('v4-cheat');
    if (show) BF.sheet.open('v4-cheat', { cls: 'show', tier: 'overlay' });
    else BF.sheet.close('v4-cheat');
    if (show) { const b = mask.querySelector('.v4-cheat-box'); if (b) b.scrollTop = 0; }
  }

  /* ---------- 2. 阅读页：全书进度芯片 + 预计剩余 ---------- */
  function fmtDur(min) {
    if (!isFinite(min) || min <= 0) return '—';
    if (min < 60) return Math.round(min) + ' 分钟';
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return m ? h + ' 小时 ' + m + ' 分' : h + ' 小时';
  }
  function updateBookProg() {
    const chip = document.getElementById('v4-bookprog');
    if (!chip) return;
    const bid = BF.appState.currentBookId;
    if (!bid) { chip.textContent = ''; return; }
    const b = (store().lsGet(store().K.BOOKS_META, []) || []).find(function (x) { return x && x.id === bid; });
    if (!b) { chip.textContent = ''; return; }
    /* 进度走轻量键合并 */
    const _rs = store().lsGet(store().K.READING_STATE, {}) || {};
    const _st = _rs[bid] || {};
    if (typeof _st.currentChapter === 'number') b.currentChapter = _st.currentChapter;
    const total = b.totalChapters || 1;
    const done = Math.min((b.currentChapter || 0) + 1, total);
    const pct = Math.round(done / total * 100);
    /* 估算剩余：按 350 字/分钟的中速朗读-默读之间值 */
    const remainWords = Math.max(0, (b.wordCount || 0) * (1 - done / total));
    chip.innerHTML = '全书 <b>' + pct + '%</b> · 约剩 ' + fmtDur(remainWords / 350);
  }
  function mountBookProg() {
    if (document.getElementById('v4-bookprog')) return true;
    const nav = document.querySelector('#page-reader .reader-bottom .nav');
    if (!nav) return false;
    nav.insertAdjacentHTML('afterend', '<span class="v4-chip" id="v4-bookprog" title="按 350 字/分钟估算"></span>');
    updateBookProg();
    return true;
  }

  /* ---------- 3. 标签页标题同步 ---------- */
  function syncTitle() {
    try {
      if (BF.appState.currentPage === 'reader' && BF.reader.state && BF.reader.state.book) {
        document.title = '《' + BF.reader.state.book.title + '》 · 北风';
      } else {
        document.title = '北风';
      }
    } catch (e) {}
  }

  /* ---------- 4. 键盘增强：空格翻页 / 边界切章 / 字号 / Ctrl+G / ? ---------- */
  function readerWrap() { return document.getElementById('reader-wrap'); }
  function overlayOpen() {
    /* 一句话读 sheet 的账（anyOpen）。手抄 id 名单会漏掉名单外的层
       （便签 / AI 中心 / 跨书搜索 / 提示词预设 / 使用手册…）——
       那些层都装了 Tab 陷阱、打开即夺焦点，本就不该让背后的书继续吃键。 */
    return !!(BF.sheet && BF.sheet.anyOpen());
  }
  function onKey(e) {
    const t = e.target;
    /* IME 组合期不触发空格翻页/方向键切章/字号等（与 hotkeys 同一防线） */
    if (e.isComposing || e.keyCode === 229) return;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    const cheatOpen = BF.sheet.isOpen('v4-cheat');
    /* ? 速查 */
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) { toggleCheat(); e.preventDefault(); return; }
    /* v4-cheat 是 sheet 层（open 时已入账本，
       cls:'show'、esc 默认可关），关掉它只有 escTop 一条通道——
       同一层不该有两个关闭入口、账本与 class 各自判断。
       保留 return：速查开着时其余按键一律不下发给背后的书。 */
    if (cheatOpen) return;
    const inReader = BF.appState.currentPage === 'reader';
    /* Ctrl+G 跳章（全局，但需在读页内） */
    if (inReader && (e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'g' || e.key === 'G')) {
      e.preventDefault();
      const total = (BF.reader.state.book && BF.reader.state.book.totalChapters) || 0;
      BF.modal.prompt('跳转章节', '输入章节号（1 ~ ' + total + '）：').then(function (v) {
        const n = parseInt(v, 10);
        if (!n || n < 1 || n > total) { if (v != null && v !== '') BF.noti.warn('章节号超出范围'); return; }
        BF.app.gotoChapter(n - 1);
      });
      return;
    }
    /* 字号微调：统一走唯一实现，不自带 13-26 的第二套钳位与复位值 */
    if (inReader && (e.ctrlKey || e.metaKey) && ['=', '-', '0'].indexOf(e.key) >= 0) {
      e.preventDefault();
      BF.enh.zoomBy(e.key === '0' ? 0 : (e.key === '=' ? 1 : -1));
      return;
    }
    if (!inReader || overlayOpen()) return;
    const wrap = readerWrap();
    if (!wrap) return;
    const page = wrap.clientHeight * 0.88;
    if (e.key === ' ' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      wrap.scrollBy({ top: e.shiftKey ? -page : page, behavior: S().get('reduceMotion') ? 'auto' : 'smooth' });
      return;
    }
    /* T3：分页态接管 ←/→/PageUp/PageDown 直接翻页（到边界自动转切章；
       prevChapter/nextChapter 内部已含「本页内翻页 / 边界切章」逻辑）。
       输入控件 / 编辑态已在函数顶部豁免，不会抢输入框。 */
    if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'PageUp' || e.key === 'PageDown') && BF.reader.pageModeActive()) {
      e.preventDefault();
      if (e.key === 'ArrowLeft' || e.key === 'PageUp') BF.app.prevChapter();
      else BF.app.nextChapter();
      return;
    }
    if (e.key === 'PageDown' || e.key === 'PageUp') {
      e.preventDefault();
      wrap.scrollBy({ top: (e.key === 'PageDown' ? page : -page), behavior: 'auto' });
      return;
    }
    /* 滚动模式：滚到边界时方向键切章 */
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      const atTop = wrap.scrollTop <= 4;
      const atBottom = wrap.scrollHeight - wrap.scrollTop - wrap.clientHeight <= 4;
      if (e.key === 'ArrowLeft' && atTop) { e.preventDefault(); BF.app.prevChapter(); }
      else if (e.key === 'ArrowRight' && atBottom) { e.preventDefault(); BF.app.nextChapter(); }
    }
  }

  /* ---------- 5. 笔记/书签导出 Markdown ---------- */
  function exportNotes() {
    const bid = BF.appState.currentBookId;
    if (!bid) { BF.noti.warn('请先打开一本书再导出标注'); return; }
    const b = (store().lsGet(store().K.BOOKS_META, []) || []).find(function (x) { return x && x.id === bid; });
    const title = b ? b.title : '未命名';
    const K = store().K;
    const pick = function (it, keys) { for (let k = 0; k < keys.length; k++) if (it && it[keys[k]]) return String(it[keys[k]]); return ''; };
    const fmtDate = function (ts) { return ts ? new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };
    const bms = (store().lsGet(K.BOOKMARKS, []) || []).filter(function (x) { return x && x.bookId === bid; });
    const hls = (store().lsGet(K.HIGHLIGHTS, []) || []).filter(function (x) { return x && x.bookId === bid; });
    const notes = (store().lsGet(K.NOTES, []) || []).filter(function (x) { return x && x.bookId === bid; });
    if (!bms.length && !hls.length && !notes.length) { BF.noti.warn('本书还没有书签、划线或笔记'); return; }
    const ch = function (i) { return '第' + ((i || 0) + 1) + '章'; };
    let md = '# 《' + title + '》阅读笔记\n\n导出时间：' + new Date().toLocaleString('zh-CN') + '\n';
    if (bms.length) {
      md += '\n## 书签（' + bms.length + '）\n\n';
      bms.forEach(function (x) { md += '- **' + ch(x.chapterIdx) + '**' + (x.text ? '：' + String(x.text).replace(/\n/g, ' ') : '') + ((x.created || x.createdAt) ? '  <sub>' + fmtDate(x.created || x.createdAt) + '</sub>' : '') + '\n'; });
    }
    if (hls.length) {
      md += '\n## 划线（' + hls.length + '）\n\n';
      hls.forEach(function (x) {
        const quote = pick(x, ['text', 'quote', 'content', 'sel']);
        const note = pick(x, ['note', 'comment', 'memo']);
        md += '- **' + ch(x.chapterIdx) + '** ' + quote.replace(/\n/g, ' ');
        if (note) md += '\n  > 批注：' + note.replace(/\n/g, ' ');
        md += '\n';
      });
    }
    if (notes.length) {
      md += '\n## 便签（' + notes.length + '）\n\n';
      notes.forEach(function (x) { md += '- **' + ch(x.chapterIdx) + '** ' + pick(x, ['text', 'content', 'note']).replace(/\n/g, ' ') + '\n'; });
    }
    BF.exportBlob(title + '_阅读笔记.md', md, { mime: 'text/markdown;charset=utf-8' })
      .then(function (ok) { if (ok) BF.noti.success('笔记已导出：' + hls.length + ' 条划线 · ' + bms.length + ' 个书签'); });
  }

  /* ---------- 6. 首页：热力图 + 继续阅读按钮增强 ---------- */
  function renderHeat() {
    const hs = document.getElementById('home-stats');
    if (!hs) return false;
    let box = document.getElementById('v4-heatbox');
    if (!box) {
      box = document.createElement('div');
      box.id = 'v4-heatbox';
      hs.insertAdjacentElement('afterend', box);
    }
    const daily = store().lsGet(store().K.DAILY, {}) || {};
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const WEEKS = 12;
    /* 对齐到本周一，往前铺 11 个整周，再从本周一排到今天 —— 最后一列不满 7 格是正常的。
       覆盖到今天，避免本周已产生的阅读时长在图上不可见。 */
    const monday = new Date(today);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    const startMonday = new Date(monday);
    startMonday.setDate(startMonday.getDate() - (WEEKS - 1) * 7);
    const days = [];
    for (let d = new Date(startMonday); d <= today; d.setDate(d.getDate() + 1)) days.push(new Date(d));
    const keyOf = function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); };
    const level = function (sec) { const m = (sec || 0) / 60; return m <= 0 ? 0 : m < 15 ? 1 : m < 30 ? 2 : m < 60 ? 3 : 4; };
    let totalMin = 0;
    const cells = days.map(function (d) {
      const sec = daily[keyOf(d)] || 0;
      totalMin += sec / 60;
      const k = keyOf(d);
      const tip = k + ' · ' + (sec ? Math.round(sec / 60) + ' 分钟' : '未阅读') + '（回车或点击看当日明细）';
      /* 热力图格子可点击（data-heat-date），点开当日阅读明细。
         它是 84 个「能点但没有名字」的元素：读屏只能念出「未命名项」，
         日期与分钟数本来就写在这里，报出来即可。
         tabindex 交给下面的游标规则，不在每格写 0 —— 逐格 84 个 Tab 位
         会把首页其余部分推到 90 次按键之外；数据网格按「一个落点 + 方向键」走。 */
      return '<i class="l' + level(sec) + '" role="button" tabindex="-1" title="' + tip + '" aria-label="' + BF.dom.escAttr(tip) + '" data-heat-date="' + k + '"></i>';
    });
    let html = '<div class="v4-heat">';
    /* 列数由格子数推，不写死 WEEKS：末列不满 7 格时写死会把多出来的格子丢掉 */
    for (let c = 0; c * 7 < cells.length; c++) html += '<div class="v4-heat-col">' + cells.slice(c * 7, c * 7 + 7).join('') + '</div>';
    html += '</div>';
    const streak = (BF.stats && BF.stats.streak) ? BF.stats.streak() : 0;
    box.innerHTML = '<div class="section-title" style="margin-top:18px">近 12 周阅读</div>' + html +
      '<div class="v4-heat-tip">共 ' + Math.round(totalMin) + ' 分钟 · 当前连续 ' + streak + ' 天 · 方向键选格，回车看当日明细</div>';
    heatCursor(box);
    return true;
  }
  /* 数据网格的键盘流线：整张图只占一个 Tab 落点，方向键在格间移游标（roving tabindex）。
     DOM 是「12 列 × 每列 7 天」，列内 index = c*7 + r，所以上下 ±1、左右 ±7。
     落点给最后一格（今天），因为开图时想看的是今天读了多久。
     回车/空格由全局 a11y 委托（认 data-heat-date）转成 click，这里不重复实现。 */
  function heatCursor(box) {
    const all = box.querySelectorAll('[data-heat-date]');
    if (!all.length) return;
    for (let i = 0; i < all.length; i++) all[i].tabIndex = -1;
    all[all.length - 1].tabIndex = 0;
    if (box.__heatKb) return;
    box.__heatKb = true;
    box.addEventListener('keydown', function (e) {
      const step = e.key === 'ArrowRight' ? 7 : e.key === 'ArrowLeft' ? -7
        : e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : null;
      if (step === null) return;
      const t = e.target;
      if (!t || !t.hasAttribute || !t.hasAttribute('data-heat-date')) return;
      e.preventDefault();
      /* 每次按键都按当前 DOM 重新取格子：重渲染换掉整批元素，攥着的旧 NodeList 不能用 */
      const live = box.querySelectorAll('[data-heat-date]');
      const i = Array.prototype.indexOf.call(live, t);
      if (i < 0) return;
      const tgt = live[Math.min(Math.max(i + step, 0), live.length - 1)];
      if (!tgt || tgt === t) return;
      t.tabIndex = -1;
      tgt.tabIndex = 0;
      try { tgt.focus(); } catch (err) { BF.err.report('heat.focus', err); }
    });
  }
  /* 热力图点击 → 当日明细（读了哪些书/多久/几条标注，可继续读）。
     数据口径：BOOK_TIME 按书累计（无日期维度），按比例估算当日各书时长；
     标注数按创建时间归属当日。 */
  function showDayDetail(dateKey) {
    const daily = store().lsGet(store().K.DAILY, {}) || {};
    const sec = daily[dateKey] || 0;
    const min = Math.round(sec / 60);
    const books = store().lsGet(store().K.BOOKS_META, []) || [];
    const bt = store().lsGet(store().K.BOOK_TIME, {}) || {};
    /* 当天有阅读记录的书：BOOK_TIME 无日期，用「当天总时长 × 该书占比」估算 */
    const totalBt = Object.values(bt).reduce(function (a, b) { return a + (Number(b) || 0); }, 0);
    const dayStart = new Date(dateKey + 'T00:00:00').getTime();
    const dayEnd = dayStart + 86400000;
    const hls = (store().lsGet(store().K.HIGHLIGHTS, []) || []).filter(function (x) { return x && x.created >= dayStart && x.created < dayEnd; }).length;
    const bms = (store().lsGet(store().K.BOOKMARKS, []) || []).filter(function (x) { return x && x.created >= dayStart && x.created < dayEnd; }).length;
    const vocs = (store().lsGet(store().K.VOCAB, []) || []).filter(function (x) { return x && x.created >= dayStart && x.created < dayEnd; }).length;
    const marks = hls + bms + vocs;
    /* 当天读过的书（按 lastRead 落在当天 + 有阅读时长） */
    const readBooks = books.filter(function (b) {
      return b && b.lastRead >= dayStart && b.lastRead < dayEnd;
    }).slice(0, 12);
    const rows = readBooks.length ? readBooks.map(function (b) {
      const bm = Math.round((min * ((bt[b.id] || 0) / (totalBt || 1))));
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;border-bottom:1px solid var(--border)">' +
        '<span style="color:var(--text);font-size:12px">' + BF.dom.esc(b.title) + '</span>' +
        '<span style="display:flex;gap:6px;align-items:center"><span style="color:var(--text-weak);font-size:11px">' + (bm > 0 ? '约 ' + bm + ' 分钟' : '—') + '</span>' +
        '<button class="btn btn-xs" data-heat-open="' + BF.dom.escAttr(b.id) + '">继续读</button></span></div>';
    }).join('') : '<div style="color:var(--text-weak);font-size:12px;padding:4px 0">当天没有阅读记录</div>';
    BF.modal.alert(dateKey + ' 阅读明细',
      '<div style="line-height:1.8;font-size:13px;color:var(--text-dim)">' +
        '当日阅读：<b style="color:var(--accent-ink)">' + min + ' 分钟</b> · 新增标注：<b>' + marks + '</b> 条' +
        '<div style="margin-top:8px;border-top:1px solid var(--border);padding-top:6px">' + rows + '</div></div>', { html: true });
  }
  function humanizeContinue() {
    const btn = document.getElementById('btn-continue');
    if (!btn) return;
    const id = store().lsGet(store().K.LAST_BOOK, null);
    const b = id && (store().lsGet(store().K.BOOKS_META, []) || []).find(function (x) { return x && x.id === id; });
    if (b) {
      btn.textContent = '继续《' + (b.title.length > 8 ? b.title.slice(0, 8) + '…' : b.title) + '》';
      btn.title = '第 ' + ((b.currentChapter || 0) + 1) + '/' + (b.totalChapters || '?') + ' 章';
    } else {
      /* 灰着的按钮仍写着「继续上次」= 骗用户有个位置可以继续。
         分两种实话：架上有书但没读过 / 连书都没有。 */
      const hasAny = (store().lsGet(store().K.BOOKS_META, []) || []).length > 0;
      btn.textContent = hasAny ? '还没有阅读记录' : '先导入一本书';
      btn.title = hasAny ? '从书架点开一本书开始读，之后这里会接着上次的位置' : '导入一本 TXT 之后，这里会变成「继续上次」';
    }
  }

  /* ---------- 7. 书卡进度百分比 ---------- */
  function paintPct() {
    const grid = document.getElementById('books-grid');
    if (!grid) return;
    grid.querySelectorAll('.book-card').forEach(function (card) {
      const bar = card.querySelector('.bar');
      if (!bar || bar.parentElement.querySelector('.v4-pct')) return;
      const fill = bar.querySelector('.bar-fill');
      const pct = fill ? parseInt(fill.style.width, 10) : 0;
      if (pct > 0) bar.insertAdjacentHTML('afterend', '<span class="v4-pct">' + pct + '%</span>');
    });
  }

  /* ---------- 8. 导入完成反馈：单本入口（pickAndImport）与批量汇总（importFiles）各自出声 ---------- */
  function wrapImport() { /* 导入成功通知集中到两条入口，无需在此拦截 */ }

  /* ---------- 9. 命令注册 ---------- */
  function registerCmds() {
    BF.commands.register({ id: 'app.cheat', label: '快捷键速查', cat: '应用', keywords: ['快捷键', 'help', 'keyboard', '?'], run: function () { toggleCheat(true); } });
    BF.commands.register({ id: 'book.notesExport', label: '导出本书笔记 (Markdown)', cat: '书籍', keywords: ['导出', '笔记', '书签', 'markdown', 'md'], run: exportNotes });
    /* 生词 Anki TSV 导出。
       新格式走搜索命中，不占主菜单位。 */
    BF.commands.register({ id: 'book.vocabExport', label: '导出生词 (Anki TSV)', cat: '书籍', keywords: ['导出', '生词', 'Anki', 'TSV', 'tsv', 'anki'], run: function () { BF.reader.exportVocabAnki(); } });
    /* 标注 W3C 导出/导入（JSON-LD，三层锚点往返无损；
       导入对配不上的标注给明确回执、不静默丢弃） */
    BF.commands.register({ id: 'ann.w3cExport', label: '导出标注 (W3C JSON-LD)', cat: '书籍', keywords: ['导出', '标注', 'W3C', 'JSON-LD', 'json', 'web', 'annotation'], run: function () { BF.ann.exportAnnotations(); } });
    BF.commands.register({ id: 'ann.w3cImport', label: '导入标注 (W3C JSON-LD)', cat: '书籍', keywords: ['导入', '标注', 'W3C', 'JSON-LD', 'json', 'web', 'annotation', '回灌'], run: function () { BF.ann.importAnnotations(); } });
    /* 标注跨书聚合视图 + Obsidian 回链导出 */
    BF.commands.register({ id: 'ann.across', label: '标注跨书聚合', cat: '书籍', keywords: ['标注', '跨书', '聚合', '全部', 'across', 'annotation'], run: function () { BF.annAcross.open(); } });
    BF.commands.register({ id: 'ann.obsidian', label: '导出标注 (Obsidian 回链)', cat: '书籍', keywords: ['导出', '标注', 'Obsidian', '回链', 'markdown', 'obsidian'], run: function () { BF.ai.obsidianExport(); } });
    /* 不注册 read.goto —— 菜单版（BF.commands 内）已注册同名命令，
       重复注册会被 findIndex 覆盖，且这里模拟 Ctrl+G 与菜单版 prompt 跳章重复。
       保留 Ctrl+G 快捷键本身（onKey 处理），命令入口统一走菜单版。 */
  }

  /* ---------- 10. 初始化（模块 install 钩子调用，跟随主程序生命周期） ---------- */
  let _tries = 0;
  /* 同一时刻只留一个待触发的重试：原写法 40 次失败后永久放弃且不复位，
     读者之后打开书 / 切到阅读页时进度芯片再也不会挂上，只能刷新页面。
     复位点见 resetMount；每次复位都会另起一轮，若不先取消旧的就会叠出多条 250ms 链。 */
  let _cancelMount = null;
  function mount() {
    if (mountBookProg()) return;
    if (_tries >= 40) return;
    _tries++;
    if (_cancelMount) _cancelMount();
    _cancelMount = BF.timers.timeout(mount, 250);
  }
  /* 进入阅读页 / 重开书或切章后重新给一次挂载机会；mountBookProg 成功即停，不会空转。 */
  function resetMount() {
    _tries = 0;
    try { mount(); } catch (e) {}
  }
  function init() {
    try {
      /* 版本号：读全局显示值 BF.VERSION_DISPLAY，不写死 */
      const ver = document.getElementById('topbar-ver');
      if (ver) ver.textContent = BF.VERSION_DISPLAY || 'V0.0.1-alpha';
    } catch (e) {}
    /* keydown 监听由模块资源系统登记，disable 时统一摘除（否则永不卸载） */
    if (BF.modules && BF.modules.resources) {
      try {
        const _m = BF.modules.get('enh.v4') || { id: 'enh.v4' };
        BF.modules.resources(_m, 'dom', [document, 'keydown', safe(onKey, 'key'), undefined]);
      } catch (e) { BF.err.report('enh.v4.res', e); }
    } else {
      document.addEventListener('keydown', safe(onKey, 'key'));
    }
    /* 切章 / 打开书后刷新进度芯片 + 标签页标题 */
    ['loadChapter', 'openBook'].forEach(function (name) {
      const orig = BF.reader && BF.reader[name];
      if (typeof orig !== 'function') return;
      BF.reader[name] = function () {
        const r = orig.apply(this, arguments);
        if (r && typeof r.then === 'function') {
          return r.then(function (v) { try { updateBookProg(); syncTitle(); resetMount(); } catch (e) {} return v; });
        }
        try { updateBookProg(); syncTitle(); resetMount(); } catch (e) {}
        return r;
      };
    });
    /* 离开阅读页时还原标签标题；离开即停 WPM 采样器、
       返回阅读页不重置累计值地恢复（切章重置仍由 _wpmStartSampler 负责） */
    const _go = BF.app.go;
    BF.app.go = function (page) {
      const r = _go.apply(this, arguments);
      try {
        if (page === 'reader') { if (BF.reader._wpmResumeSampler) BF.reader._wpmResumeSampler(); resetMount(); }
        else if (BF.reader._wpmStopSampler) BF.reader._wpmStopSampler();
      } catch (e) {}
      setTimeout(syncTitle, 0);
      return r;
    };
    /* 渲染钩子 */
    const _rh = BF.app.renderHome;
    BF.app.renderHome = function () { const r = _rh.apply(this, arguments); try { renderHeat(); humanizeContinue(); } catch (e) {} return r; };
    const _rb = BF.app.renderBookshelf;
    BF.app.renderBookshelf = function () { const r = _rb.apply(this, arguments); try { paintPct(); } catch (e) {} return r; };
    try { wrapImport(); } catch (e) {}
    try { registerCmds(); } catch (e) {}
    try { BF.bus.on(BF.EVENTS.BOOKSHELF, safe(function () { setTimeout(function () { try { renderHeat(); } catch (e) {} }, 300); }, 'heat')); } catch (e) {}
    mount();
    try { renderHeat(); humanizeContinue(); } catch (e) {}
  }
  /* 暴露到 BF.enh（委托区可从 BF.enh.showDayDetail 取到） */
  try { if (BF.enh) BF.enh.showDayDetail = showDayDetail; } catch (e) {}
  return { install: init, toggleCheat: toggleCheat, exportNotes: exportNotes, showDayDetail: showDayDetail };
})();

