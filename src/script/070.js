/* ================= 微读浮层统一工厂 + 排版/目录/进度/自动隐藏 ================= */
/* 同屏只开一个浮层（排版/目录/更多互斥）；元素挂在 #mr-root 下，destroy 时一并移除，不泄漏 body */
BF.mr._popover = function (id, cls, build) {
  const existing = document.getElementById(id);
  if (existing) { existing.remove(); return; }
  const root = document.getElementById('mr-root');
  if (!root) return;
  ['mr-menu', 'mr-typeset', 'mr-toc'].forEach(function (x) {
    if (x !== id) { const e = document.getElementById(x); if (e) e.remove(); }
  });
  root.classList.remove('mr-chrome-hidden');
  const el = document.createElement('div');
  el.id = id;
  el.className = 'mr-pop' + (cls ? ' ' + cls : '');
  build(el);
  root.appendChild(el);
  const closeFn = function (e) {
    if (!el.isConnected) { document.removeEventListener('click', closeFn); return; }
    if (!el.contains(e.target) && !(e.target.closest && e.target.closest('[data-mr-act]'))) {
      el.remove();
    }
  };
  /* 摘监听不能只挂在「点击外部」这一条路上：互斥开另一个浮层、destroy 收场都是直接
     el.remove()，监听留在 document 上累积，下次点击才触发、还可能关掉别人的弹层。
     接管 el.remove 让任何关闭路径先摘监听；rAF 里再确认一次，覆盖「挂上之前就被移除」的顺序。 */
  let _detached = false;
  const _origRemove = el.remove.bind(el);
  el.remove = function () { _detached = true; document.removeEventListener('click', closeFn); return _origRemove(); };
  requestAnimationFrame(function () { if (!_detached) document.addEventListener('click', closeFn); });
  return el;
};
/* 微读底部进度条 + 剩余时间：复用既有 updateProgress/updateRemain 算法，仅搬运结果到微读专属 DOM */
BF.mr._updateProgress = function () {
  const fill = document.getElementById('mr-progress-fill');
  const prog = document.getElementById('mr-prog');
  const remain = document.getElementById('mr-remain');
  if (!fill) return;
  const st = BF.reader.state || {};
  const titles = st.bookTitles || [];
  const book = st.book;
  const total = titles.length || (book && book.totalChapters) || 0;
  const idx = BF.appState.currentChapterIdx || 0;
  const pct = total ? Math.round((idx + 1) / total * 100) : 0;
  fill.style.width = pct + '%';
  if (prog) prog.textContent = pct + '%';
  /* 复用既有剩余时间估算：updateRemain 写 #reader-remain（其所在底栏虽隐藏，DOM 文本仍可读） */
  try { if (BF.reader.updateRemain) BF.reader.updateRemain(); } catch (e) {}
  const src = document.getElementById('reader-remain');
  if (remain && src) remain.textContent = src.textContent || '';
};
/* 微读「字体」→ 阅读中排版小面板。复用既有设置键与 BF.reader.applyStyles 落地，不打开整个设置面板 */
/* ── BF.readPanel · 统一「阅读设置」面板（一处渲染，多处引用） ──
   排版/字号/行距/配色/翻页这一组控件，过去在「微读浮层 openTypeset」与「设置→阅读区」
   各写一份（data-ts 直绑 vs data-set 委托），改一处忘一处。现在收敛为唯一渲染源：
     · BF.readPanel.html()  产出控件（全局 .mr-ts-* class，两个容器都能渲染，无内联 style）
     · BF.readPanel.bind()  事件委托，绑一次；挂在浮层或设置第三层都走同一套
   字号保留随书偏好双写（perBook + 全局），这是原 openTypeset 的既有语义，不能丢。 */
BF.readPanel = (function () {
  var THEME_KEYS = ['wr-white', 'wr-sepia', 'wr-green', 'wr-night', 'wr-mono'];
  var opt = function (v, t, cur) { return '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + t + '</option>'; };
  function curFs() {
    var b = BF.appState.currentBookId;
    return Number(BF.prefs.resolve(b, 'fontSize', BF.settings.get('fontSize'))) || 16;
  }
  /* 唯一渲染源。ctx='pop' 微读浮层 / ctx='panel' 设置第三层——内容一致，仅外层由调用方包。 */
  function html() {
    var s = BF.settings;
    var fs = curFs();
    var lh = Number(s.get('lineHeight') || 1.9);
    var ff = s.get('fontFamily') || 'sans';
    var ws = Number(s.get('wordSpacing') || 0);
    var ps = Number(s.get('paraSpacing') || 1);
    var zoom = Number(s.get('mrZoom') || 100);
    var theme = s.get('mrTheme') || 'wr-white';
    var margin = s.get('readerMargin') || 'normal';
    var noIndent = String(!!s.get('noIndent'));
    var justify = String(!!s.get('justify'));
    var dots = THEME_KEYS.map(function (k) {
      var th = BF.MR_THEMES[k];
      return '<button type="button" class="mr-ts-dot" data-rp-wr="' + k + '" title="' + th.name + '" aria-label="配色：' + th.name + '" aria-pressed="' + (k === theme) + '"></button>';
    }).join('');
    return '<div class="mr-ts-row"><span>整体缩放</span><span class="mr-ts-flex"><input type="range" class="mr-ts-range" data-rp="zoom" min="70" max="150" step="5" value="' + zoom + '" aria-label="整体缩放"/><span class="mr-ts-val" data-rp-val="zoom">' + zoom + '%</span></span></div>' +
      '<div class="mr-ts-row"><span>字号</span><span class="mr-ts-flex"><button type="button" class="mr-ts-btn" data-rp="fs-" aria-label="减小字号">A−</button><input type="range" class="mr-ts-range" data-rp="fs" min="' + BF.settings.RANGES.fontSize.min + '" max="' + BF.settings.RANGES.fontSize.max + '" step="1" value="' + fs + '" aria-label="字号"/><button type="button" class="mr-ts-btn" data-rp="fs+" aria-label="增大字号">A+</button><span class="mr-ts-val" data-rp-val="fs">' + fs + '</span></span></div>' +
      '<div class="mr-ts-row"><span>行距</span><span class="mr-ts-flex"><input type="range" class="mr-ts-range" data-rp="lh" min="1.3" max="2.6" step="0.1" value="' + lh + '" aria-label="行距"/><span class="mr-ts-val" data-rp-val="lh">' + lh.toFixed(1) + '</span></span></div>' +
      '<div class="mr-ts-row"><span>字间距</span><span class="mr-ts-flex"><input type="range" class="mr-ts-range" data-rp="ws" min="0" max="4" step="0.5" value="' + ws + '" aria-label="字间距"/><span class="mr-ts-val" data-rp-val="ws">' + ws + '</span></span></div>' +
      '<div class="mr-ts-row"><span>段间距</span><span class="mr-ts-flex"><input type="range" class="mr-ts-range" data-rp="ps" min="0.5" max="2" step="0.1" value="' + ps + '" aria-label="段间距"/><span class="mr-ts-val" data-rp-val="ps">' + ps.toFixed(1) + '</span></span></div>' +
      '<div class="mr-ts-row"><span>字体</span><select class="mr-ts-sel" data-rp="ff">' + opt('sans', '无衬线', ff) + opt('serif', '衬线', ff) + opt('kai', '楷体', ff) + '</select></div>' +
      '<div class="mr-ts-row"><span>页边距</span><select class="mr-ts-sel" data-rp="margin">' + opt('narrow', '窄', margin) + opt('normal', '标准', margin) + opt('wide', '宽', margin) + '</select></div>' +
      '<div class="mr-ts-row"><span>首行缩进</span><select class="mr-ts-sel" data-rp="noIndent">' + opt('false', '开启', noIndent) + opt('true', '关闭', noIndent) + '</select></div>' +
      '<div class="mr-ts-row"><span>两端对齐</span><select class="mr-ts-sel" data-rp="justify">' + opt('false', '关闭', justify) + opt('true', '开启', justify) + '</select></div>' +
      '<div class="mr-ts-row"><span>微信读书配色</span><span class="mr-ts-dots">' + dots + '</span></div>' +
      '<div class="mr-ts-row"><span>逐页翻页（Canvas）</span><select class="mr-ts-sel" data-rp="canvas">' + opt('false', '滚动（默认）', String(!!s.get('mrCanvas'))) + opt('true', '逐页位图', String(!!s.get('mrCanvas'))) + '</select></div>';
  }
  /* 统一事件：事件委托绑一次；root 内的控件失效重建也不掉绑。
     与 document 级 data-set 委托互不干扰——本组件全部走私有 data-rp，不重复写键。 */
  function bind(root) {
    if (!root || root.__rpBound) return;
    root.__rpBound = true;
    var s = BF.settings;
    var refresh = function () { try { BF.reader.applyStyles(); } catch (e) {} if (BF.mr.canvas && BF.mr.canvas.active() && BF.mr.canvas.rebuild) BF.mr.canvas.rebuild(); };
    var val = function (k, txt) { var n = root.querySelector('[data-rp-val="' + k + '"]'); if (n) n.textContent = txt; };
    var setFs = function (v) {
      v = Math.max(BF.settings.RANGES.fontSize.min, Math.min(BF.settings.RANGES.fontSize.max, v));
      var b = BF.appState.currentBookId;
      if (b) BF.prefs.set(b, 'fontSize', v);
      s.set('fontSize', v);
      var r = root.querySelector('[data-rp="fs"]'); if (r) r.value = v;
      val('fs', String(v));
      refresh();
    };
    root.addEventListener('click', function (e) {
      var t = e.target;
      var fsBtn = t.closest && t.closest('[data-rp="fs-"],[data-rp="fs+"]');
      if (fsBtn) { var r = root.querySelector('[data-rp="fs"]'); setFs((Number(r && r.value) || 16) + (fsBtn.getAttribute('data-rp') === 'fs+' ? 1 : -1)); return; }
      var wr = t.closest && t.closest('[data-rp-wr]');
      if (wr) {
        s.set('mrTheme', wr.getAttribute('data-rp-wr'));
        refresh();
        root.querySelectorAll('[data-rp-wr]').forEach(function (x) { x.setAttribute('aria-pressed', x === wr ? 'true' : 'false'); });
      }
    });
    root.addEventListener('input', function (e) {
      var t = e.target, k = t.getAttribute && t.getAttribute('data-rp');
      if (k === 'zoom') { var v = Number(t.value); s.set('mrZoom', v); val('zoom', v + '%'); refresh(); }
      else if (k === 'fs') { setFs(Number(t.value)); }
      else if (k === 'lh') { var v2 = Number(t.value); s.set('lineHeight', v2); val('lh', v2.toFixed(1)); refresh(); }
      else if (k === 'ws') { var v3 = Number(t.value); s.set('wordSpacing', v3); val('ws', String(v3)); refresh(); }
      else if (k === 'ps') { var v4 = Number(t.value); s.set('paraSpacing', v4); val('ps', v4.toFixed(1)); refresh(); }
    });
    root.addEventListener('change', function (e) {
      var t = e.target, k = t.getAttribute && t.getAttribute('data-rp');
      if (k === 'ff') { s.set('fontFamily', t.value); refresh(); }
      else if (k === 'margin') { s.set('readerMargin', t.value); refresh(); }
      else if (k === 'noIndent') { s.set('noIndent', t.value === 'true'); refresh(); }
      else if (k === 'justify') { s.set('justify', t.value === 'true'); refresh(); }
      else if (k === 'canvas') { var on = t.value === 'true'; s.set('mrCanvas', on); if (BF.mr.canvas && BF.mr.canvas.setOn) BF.mr.canvas.setOn(on); }
    });
  }
  /* 把一组控件挂到任意容器：先渲染再绑。浮层与设置第三层都走这一个入口。 */
  function mount(root) { if (!root) return; root.innerHTML = html(); bind(root); }
  return { html: html, bind: bind, mount: mount, THEME_KEYS: THEME_KEYS };
})();

BF.mr.openTypeset = function () {
  BF.mr._popover('mr-typeset', 'mr-typeset', function (el) { BF.readPanel.mount(el); });
};
/* 微读「目录」→ 轻量章节浮层（当前章高亮、点击即跳），不复用 640px 六页签大抽屉 */
BF.mr.tocPanel = function () {
  BF.mr._popover('mr-toc', 'mr-toc', function (el) {
    const titles = (BF.reader.state && BF.reader.state.bookTitles) || [];
    const total = titles.length;
    const cur = BF.appState.currentChapterIdx || 0;
    const head = document.createElement('div');
    head.className = 'mr-toc__head';
    head.textContent = total ? ('共 ' + total + ' 章 · 当前第 ' + (cur + 1) + ' 章') : '目录加载中…';
    el.appendChild(head);
    if (total) {
      /* 一处委托代替每章一个闭包：否则千章书每开一次目录要建一千个 handler；
         章序带在条目自己的 data-idx 上，点击时现读。 */
      titles.forEach(function (t, i) {
        const it = document.createElement('div');
        it.className = 'mr-toc__item';
        it.setAttribute('data-idx', String(i));
        if (i === cur) it.setAttribute('aria-current', 'true');
        it.textContent = t || ('第 ' + (i + 1) + ' 章');
        el.appendChild(it);
      });
      el.onclick = function (ev) {
        const it = ev.target && ev.target.closest ? ev.target.closest('.mr-toc__item') : null;
        if (!it) return;
        BF.reader.gotoChapter(Number(it.getAttribute('data-idx')) || 0);
        el.remove();
      };
    } else {
      setTimeout(function () {
        const p = document.getElementById('mr-toc');
        if (p && (BF.reader.state.bookTitles || []).length) { p.remove(); BF.mr.tocPanel(); }
      }, 300);
    }
  });
};
/* 微读态阅读中自动隐藏顶条与右图标栏。下滚收起、上滚/点正文恢复；同时刷新进度条 */
BF.mr._bindScroll = function () {
  if (BF.mr._scrollBound) return;
  const wrap = document.getElementById('reader-wrap');
  if (!wrap) return;
  BF.mr._scrollBound = true;
  BF.mr._ac = new AbortController();
  let lastTop = wrap.scrollTop || 0;
  let raf = false;
  const tick = function () {
    const top = wrap.scrollTop || 0;
    const root = document.getElementById('mr-root');
    if (root) {
      /* 微读顶条自动隐藏与 TTS「停止时隐藏朗读条」统一为同一开关 ttsHideOnStop。
         关掉则始终显示 chrome，不再随滚动收起（两条策略并一条，避免互相打架）。 */
      if (!BF.settings.get('ttsHideOnStop')) root.classList.remove('mr-chrome-hidden');
      else if (root.querySelector('.mr-pop')) root.classList.remove('mr-chrome-hidden');
      else if (top - lastTop > 6 && top > 90) root.classList.add('mr-chrome-hidden');
      else if (top - lastTop < -6) root.classList.remove('mr-chrome-hidden');
    }
    lastTop = top;
    BF.mr._updateProgress();
  };
  const onScroll = function () {
    /* rAF 合并 + 后台标签页兜底：rAF 被节流时 100ms 内仍触发一次 tick */
    BF.timers.rafFallthru(function () { return raf; }, function (v) { raf = v; }, tick);
  };
  wrap.addEventListener('scroll', onScroll, { passive: true, signal: BF.mr._ac.signal });
  const main = document.getElementById('reader-main');
  if (main) {
    main.addEventListener('click', function () {
      const root = document.getElementById('mr-root');
      if (!root) return;
      const sel = (window.getSelection && window.getSelection()) || '';
      if (sel && sel.toString && sel.toString().length) return;
      root.classList.remove('mr-chrome-hidden');
    }, { passive: true, signal: BF.mr._ac.signal });
  }
};
/* N9 修复：enh.v4 install 在模块 enable 时会重跑，无守卫则每次把「已被包装的」函数
   捕获为新 _orig 再包一层，反复 enable/disable 会无限嵌套（栈溢出风险）。加幂等守卫，只包一次。 */
if (!BF.reader.__v4Wrapped) {
BF.reader.__v4Wrapped = true;
/* 切换微读时自动挂载/销毁 */
const _origToggleMicroread = BF.reader.toggleMicroread;
BF.reader.toggleMicroread = function () {
  const page = document.getElementById('page-reader');
  if (!page) return;
  const was = page.classList.contains('microread');
  _origToggleMicroread.call(this);
  const now = page.classList.contains('microread');
  if (now && !was) {
    requestAnimationFrame(function () {
      BF.mr.mount();
    });
  } else if (!now && was) {
    BF.mr.destroy();
  }
};
/* 进阅读器时按设置恢复微读 */
const _origOpenBook = BF.reader.openBook;
BF.reader.openBook = function (id) {
  const ret = _origOpenBook.apply(this, arguments);
  if (BF.settings.get('microread')) {
    const rp = document.getElementById('page-reader');
    if (rp && !rp.classList.contains('microread')) {
      rp.classList.add('microread');
      requestAnimationFrame(function () {
        BF.mr.mount();
      });
    }
  }
  /* 分页模式单击翻页：每次开书/切章确保事件绑定 */
  if (BF.reader._bindPageClick) BF.reader._bindPageClick();
  return ret;
};
}
BF.reader.gotoChapter = async function (idx, opts) {
  const b = BF.reader.state.book;
  if (!b) return;
  /* 只挡 <0 / >=total 时，NaN、null、'abc' 都能穿过比较直接写进状态：
     currentChapterIdx 变成 NaN 后取章节文本拿到 undefined，界面停在旧章却不报错。
     入口是数据（备份跳转、搜索命中、AI 定位），先归一成整数再判边界。 */
  const _i = Math.floor(Number(idx));
  if (!Number.isFinite(_i) || _i < 0 || _i >= (b.totalChapters || 0)) return;
  idx = _i;
  /* 非自动续播的切章（目录 / 搜索 / AI 定位 / 进度条）作废在途令牌：
     用户已经改主意换章了，等待中的那次自动起播不该再念起来。 */
  if (BF.tts && BF.tts.state && !(opts && opts.autoNext)) BF.tts.state._autoTok = null;
  /* C31 修复：TTS 暂停中切章给提示。朗读被暂停（非播放态）时切章，
     用户容易以为朗读会跟着新章走，实际是静默停在旧章位置。 */
  try {
    if (BF.tts && BF.tts.state && !BF.tts.state.playing && (BF.tts.state.timer || BF.tts.state._autoNextT)) {
      BF.noti.info('TTS 已暂停，切章后如需继续朗读请重新开始');
    }
    /* 并发修复：朗读播放中（playing=true）切章 → 朗读内容与屏幕脱节，
       先停掉朗读再切，避免旧章语音继续读、新章画面已换。 */
    if (BF.tts && BF.tts.state && BF.tts.state.playing && BF.tts.stop) {
      BF.tts.stop({ autoNext: !!(opts && opts.autoNext) });
    }
  } catch (e) {}
  BF.appState.currentChapterIdx = idx;
  /* 切章必须回到本章第 1 页：分页模式页码若不重置，切章后会沿用上一章停着的页码 */
  BF.reader.state.pkPageIdx = 0;
  /* 选区备份状态必须在切章边界清空：否则下一章的划线/书签/生词会写进上一章的文本与段索引 */
  BF.reader.clearSelState();
  const wrap = document.getElementById('reader-wrap');
  if (wrap) wrap.scrollTop = 0;
  await BF.reader.loadChapter();
  BF.reader.saveProgress();
  if (BF.nav && BF.nav.record) BF.nav.record();
};
