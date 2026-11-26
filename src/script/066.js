/* ================= R5. 进度 ================= */
/* WPM 视口停留积分采样器：每 2s 采样一次，累计「已读到的最远字符数」(单调)
   与「平静阅读停留时长」。快速滚动（扫描）的窗口不计入，天然排除「滚到底即虚高」。
   切章时由渲染处调用 _wpmStartSampler 重置。
   拆为 start（切章重置）/ resume（进页不重置）/ stop（离页停）三个入口，
   定时器统一走 BF.timers.interval——裸 setInterval 离开阅读页仍每 2s 空转，
   定时器本身永不清理且绕过 BF.timers 治理。 */
BF.reader._wpmStopSampler = function () {
  try { if (BF.reader._wpmTimer) { BF.reader._wpmTimer(); } } catch (e) {}
  BF.reader._wpmTimer = null;
};
BF.reader._wpmTick = function () {
  try {
    /* 微读不豁免：底部「本章剩余」直接复用 updateRemain，而它算的就是下面这两个累计量。
       早退 ⇒ 微读里 _wpmReadChars / _wpmDwellSec 永远停在 0，剩余时间与进度数字死住不动。
       微读滚的也是 #reader-wrap（见 BF.mr._bindScroll），采样口径与经典模式一致。 */
    if (BF.appState.currentPage !== 'reader') return;
    const wrap = document.getElementById('reader-wrap');
    const b = BF.reader.state.book;
    if (!wrap || !b) return;
    const total = wrap.scrollHeight || 0;
    if (!total) return;
    let pct;
    if (BF.reader.pageModeActive() && (BF.reader.state.pkPages || []).length) {
      pct = Math.min(100, Math.round(((BF.reader.state.pkPageIdx || 0) + 1) / BF.reader.state.pkPages.length * 100));
    } else {
      const span = total - wrap.clientHeight;
      pct = span <= 0 ? 100 : Math.min(100, Math.round(wrap.scrollTop / span * 100));
    }
    const words = BF.reader.state.parasChars != null ? BF.reader.state.parasChars : ((BF.reader.state.paras || []).join('').length);
    const curChars = Math.round(words * pct / 100);
    /* 扫描检测改用像素速度：字符数在「滚一屏停一下」时会虚高，像素速度才是真扫描。
       阈值：2s 内滚动超过 1.2 屏高 → 判定为快速滚动扫描，丢弃该窗口。 */
    const curTop = wrap.scrollTop;
    const lastTop = BF.reader._wpmLastTop || 0;
    const pixelDelta = Math.abs(curTop - lastTop);
    const screenH = wrap.clientHeight || 1;
    BF.reader._wpmLastTop = curTop;
    BF.reader._wpmLastChars = curChars;
    if (pixelDelta > screenH * 1.2) return;   /* 扫描窗口：排除 */
    /* 平滑移进：只有当前字符数真正前进时才更新最远位置，避免来回滚动虚增 */
    if (curChars > (BF.reader._wpmReadChars || 0)) BF.reader._wpmReadChars = curChars;
    BF.reader._wpmDwellSec += 2;
  } catch (e) {}
};
BF.reader._wpmResumeSampler = function () {
  if (BF.reader._wpmTimer) return;   /* 已在跑：不重置累计值 */
  BF.reader._wpmTimer = BF.timers.interval(BF.reader._wpmTick, 2000);
};
BF.reader._wpmStartSampler = function () {
  BF.reader._wpmStopSampler();
  BF.reader._wpmReadChars = 0;   /* 累计已读到的最远字符数（单调，不计入扫描窗口） */
  BF.reader._wpmDwellSec = 0;    /* 平静阅读停留秒数（排除快速滚动窗口） */
  BF.reader._wpmLastChars = 0;   /* 上一次采样时的最远字符数 */
  BF.reader._wpmLastTop = 0;     /* 上一次采样时的 scrollTop（像素速度检测用） */
  BF.reader._wpmAvg = [];        /* WPM 移动平均窗口 */
  BF.reader._wpmTimer = BF.timers.interval(BF.reader._wpmTick, 2000);
};
/* 全书进度（0–1）：章序 + 章内分数，按字数加权；无 chapterWords 退回章数口径。
   没有阅读记录就是 0 —— 新书一上架就显示「读完 100%」是谎报。
   老数据只有章号、没有 chapterFrac 时当前章按「读过」算满：那是加这个字段之前的口径，
   不因为升级把已有的进度显示成变小。 */
BF.reader.bookFrac = function (book, rec) {
  if (!book || !rec) return 0;
  if (rec.currentChapter == null && rec.chapterFrac == null && rec.lastRead == null) return 0;
  const total = Math.max(1, book.totalChapters || 1);
  let ch = (typeof rec.currentChapter === 'number') ? rec.currentChapter : 0;
  ch = Math.min(Math.max(0, ch), total - 1);
  let frac = (typeof rec.chapterFrac === 'number' && isFinite(rec.chapterFrac)) ? rec.chapterFrac : (rec.lastRead != null ? 1 : 0);
  frac = Math.min(1, Math.max(0, frac));
  const cw = book.chapterWords;
  if (Array.isArray(cw) && cw.length && book.wordCount) {
    let before = 0;
    for (let i = 0; i < ch && i < cw.length; i++) before += (cw[i] || 0);
    const cur = cw[ch] || 0;
    return Math.min(1, (before + cur * frac) / book.wordCount);
  }
  return Math.min(1, (ch + frac) / total);
};
/* 书架三态：同一份读数派生，卡面不各写一份判据。
   先问「打开过没有」：没打开过就是未读，哪怕算出来的进度是 100%（单章书的进度口径就是满）；
   done 用 ≥ 99.9%（浮点别写 ===1）；停在第 0 章开头也算未读。 */
BF.library.shelfState = function (book, rec) {
  if (!book || !rec || rec.lastRead == null) return 'new';
  const p = BF.reader.bookFrac(book, rec);
  if (p >= 0.999) return 'done';
  if (p <= 0.0005) return 'new';
  return 'reading';
};
/* 进度读数唯一来源：READING_STATE 优先；老数据只镜像在
   books_meta 时退回那份（章号+最后阅读时间+章内分数），两者都没有才算「没读过」。
   recentCardHTML / _shelfCardHTML / shelfState 共用这一份。 */
BF.reader.recFor = function (b, rsMap) {
  const rec = (rsMap && rsMap[b.id]) || null;
  if (rec) return rec;
  return (b.currentChapter != null || b.lastRead)
    ? { currentChapter: b.currentChapter, lastRead: b.lastRead, chapterFrac: b.chapterFrac }
    : null;
};
/* 阅读标尺 + 英文断词：设置一变就地生效，不重开书。
   标尺是一根跟随鼠标的横线（帮助长行不串行），默认关；断词只作用于拉丁段落
   （逐段判定字符组成，中文段落一律不加 lang，避免浏览器把中文也断词）。 */
BF.reader.applyExtras = function () {
  const wrap = document.getElementById('reader-wrap');
  if (!wrap) return;
  const on = !!BF.settings.get('readingRuler');
  let el = document.getElementById('read-ruler');
  if (on && !el) {
    el = document.createElement('div');
    el.id = 'read-ruler';
    el.className = 'read-ruler';
    el.setAttribute('aria-hidden', 'true');
    el.__mv = function (e) { el.style.top = (e.clientY | 0) + 'px'; };
    wrap.addEventListener('mousemove', el.__mv, { passive: true });
    document.body.appendChild(el);
  }
  if (el) {
    el.classList.toggle('on', on);
    if (!on && el.__mv) { wrap.removeEventListener('mousemove', el.__mv); el.__mv = null; }
  }
  const main = document.getElementById('reader-main');
  if (main) {
    const en = !!BF.settings.get('enHyphen');
    document.body.classList.toggle('en-hyphen', en);
    BF.reader.markEnLang(main);
  }
};
/* 英文断词的逐段标记。CSS hyphens 认 lang，而分批 flush / 虚拟窗口重建会
   插入全新 <p>——只在「章号或开关变化」时扫一遍，后续段就永远没有 lang。 */
BF.reader.markEnLang = function (root) {
  const main = root || document.getElementById('reader-main');
  if (!main || !main.querySelectorAll) return;
  const en = !!BF.settings.get('enHyphen');
  const ps = main.querySelectorAll('p');
  for (let i = 0; i < ps.length; i++) {
    const t = ps[i].textContent || '';
    let latin = 0;
    for (let k = 0; k < t.length; k++) { const c = t.charCodeAt(k); if ((c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 32) latin++; }
    if (en && t.length > 20 && latin / t.length > 0.6) ps[i].setAttribute('lang', 'en');
    else if (ps[i].getAttribute('lang') === 'en') ps[i].removeAttribute('lang');
  }
};
/* T3：底栏「上一章 / 下一章」在分页态下切「上一页 / 下一页」，到章边界时再切回章节。
   与翻页/切章同源（prevChapter/nextChapter 已含边界判定），读屏 aria-label 同步。 */
BF.reader._updateNavButtons = function () {
  const prev = document.querySelector('[data-nav-chapter="prev"]');
  const next = document.querySelector('[data-nav-chapter="next"]');
  if (!prev || !next) return;
  const b = BF.reader.state.book;
  const idx = BF.appState.currentChapterIdx || 0;
  const total = (b && b.totalChapters) || 0;
  const paging = BF.reader.pageModeActive() && (BF.reader.state.pkPages || []).length > 0;
  let pt = '上一章', nt = '下一章';
  let prevDisabled = false, nextDisabled = false;
  if (paging) {
    const pi = BF.reader.state.pkPageIdx || 0, pn = BF.reader.state.pkPages.length;
    pt = pi <= 0 ? '上一章' : '上一页';
    nt = pi >= pn - 1 ? '下一章' : '下一页';
    /* 边界置灰：分页态要看「当前页是否首/末页」与「当前章是否首/末章」共同决定——
       只在「首页且首章」「末页且末章」才禁用；否则「上一章/下一章」仍可翻章。
       disabled 让按钮不触发点击（含 apple 材质 pointer-events:none），从源头消除「点了没反应」。 */
    prevDisabled = pi <= 0 && idx <= 0;
    nextDisabled = pi >= pn - 1 && idx >= total - 1;
  } else {
    prevDisabled = idx <= 0;
    nextDisabled = idx >= total - 1;
  }
  prev.textContent = pt; prev.setAttribute('aria-label', pt);
  next.textContent = nt; next.setAttribute('aria-label', nt);
  prev.disabled = prevDisabled; prev.setAttribute('aria-disabled', prevDisabled ? 'true' : 'false');
  next.disabled = nextDisabled; next.setAttribute('aria-disabled', nextDisabled ? 'true' : 'false');
};
/* 章内分数：唯一来源，updateProgress 读、saveProgress 写，同一套判据。
   分页态按页码算（容器不滚动），滚动态按 scrollTop/可滚动高度算。
   拿不到滚动（页面已隐藏）返回 null，由调用方沿用旧值，不写 0。
   定义在两个调用方之前：加载期若有人同步触发 updateProgress，不会撞上未定义。 */
BF.reader._currentFrac = function () {
  const _wrapLive = document.getElementById('reader-wrap');
  if (BF.reader.pageModeActive && BF.reader.pageModeActive()) {
    const _ps = BF.reader.state.pkPages || [];
    if (_ps.length) {
      /* 单页章已整章可见 ⇒ 记满；多页用 idx/(n-1) 让末页正好 1（与滚动到底同义） */
      return (_ps.length === 1) ? 1 : Math.min(1, Math.max(0, (BF.reader.state.pkPageIdx || 0) / (_ps.length - 1)));
    }
    return null;
  }
  if (!_wrapLive) return null;
  const _scrollNow = (_wrapLive.offsetParent !== null) ? _wrapLive.scrollTop : null;
  if (_scrollNow === null) return null;
  /* 短于一屏的章节：scrollHeight ≈ clientHeight ⇒ _max 被压成 1、_scrollNow 恒 0，
     进度恒为 0，与「本章已读完」的卡片互相打脸。整章可见即视为读完。 */
  if (_wrapLive.scrollHeight <= _wrapLive.clientHeight + 2) return 1;
  const _max = Math.max(1, _wrapLive.scrollHeight - _wrapLive.clientHeight);
  return Math.min(1, Math.max(0, _scrollNow / _max));
};
BF.reader.updateProgress = function () {
  const idx = BF.appState.currentChapterIdx;
  const b = BF.reader.state.book;
  if (!b) return;
  /* 阅读标尺 / 英文断词：章号或开关变一次才重扫，滚动热路径不做重复工作 */
  const _sig = idx + '|' + (BF.settings.get('enHyphen') ? 1 : 0) + '|' + (BF.settings.get('readingRuler') ? 1 : 0);
  if (BF.reader.__extraSig !== _sig) { BF.reader.__extraSig = _sig; try { BF.reader.applyExtras(); } catch (e) {} }
  /* 统一进度口径：顶栏进度条与书架卡面共用 bookFrac 同一套公式。
     旧算法把当前章整章计入（idx+1），与 bookFrac 的 chapterFrac 加权互踩——
     读到第 3 章 50% 时顶栏显示「已读 3 章」、卡面显示「已读 2.5 章」。
     现在用 _currentFrac() 取实时章内分数，代进 bookFrac 的公式，两边一致。 */
  const _frac = BF.reader._currentFrac();
  const _rec = { currentChapter: idx, chapterFrac: (_frac !== null ? _frac : 0), lastRead: Date.now() };
  let prog = Math.round(BF.reader.bookFrac(b, _rec) * 100);
  if (prog < 0) prog = 0; else if (prog > 100) prog = 100;
  const fill = document.getElementById('reader-progress-fill');
  const pct = document.getElementById('reader-prog');
  if (fill) fill.style.width = prog + '%';
  /* 百分比只当 aria-valuenow 走：进度条每滚一行就变，
     设成 live region 会让读屏逐行播报，反而不可用。
     需要播报的是「翻到第几章」和「本章读完」——变化稀疏、信息密度高。 */
  if (pct) { pct.textContent = prog + '%'; pct.setAttribute('aria-valuenow', String(prog)); }
  /* 进度条本体也是 progressbar：宽度是 CSS，读屏拿不到，数值要跟 #reader-prog 同步 */
  const bar = document.getElementById('reader-progress');
  if (bar) bar.setAttribute('aria-valuenow', String(prog));
  const chap = document.getElementById('reader-chap-indicator');
  if (chap) {
    /* T3：分页态在章号后追加「第 x/y 页」页码（页脚指标） */
    if (BF.reader.pageModeActive() && (BF.reader.state.pkPages || []).length) {
      const pi = (BF.reader.state.pkPageIdx || 0) + 1, pn = BF.reader.state.pkPages.length;
      chap.textContent = '第 ' + (idx + 1) + ' / ' + (b.totalChapters || idx + 1) + ' 章 · 第 ' + pi + '/' + pn + ' 页';
    } else {
      chap.textContent = (idx + 1) + ' / ' + (b.totalChapters || idx + 1) + ' 章';
    }
  }
  /* T3：底栏「上一章/下一章」在分页态切「上一页/下一页」 */
  try { BF.reader._updateNavButtons(); } catch (e) {}
  /* 回到顶部按钮：滚动超过一屏才显示 */
  const wrap = document.getElementById('reader-wrap');
  const bt = document.getElementById('back-top');
  if (wrap && bt) {
    bt.classList.toggle('show', wrap.scrollTop > wrap.clientHeight * 0.6);
  }
};
/* 阅读速度（字/分）+ 本章剩余时间 + 读完检测
   与微读同款口径；底栏 #reader-remain 在此真实写入 */
BF.reader.updateRemain = function () {
  const el = document.getElementById('reader-remain');
  if (!el) return;
  const wrap = document.getElementById('reader-wrap');
  if (!wrap || !BF.reader.state.book) { el.textContent = ''; return; }
  const total = wrap.scrollHeight || 0;
  if (!total) { el.textContent = ''; return; }
  /* 读完口径用 scrollTop / (scrollHeight - clientHeight)：若用 (scrollTop + clientHeight) / scrollHeight，
     一屏能装下的短章开章即 100%，底栏立刻显示「本章已读完」并弹提示；
     只有真正滚到底才是 100%。分页模式下滚动量无意义，按页码算。 */
  let pct;
  if (BF.reader.pageModeActive() && (BF.reader.state.pkPages || []).length) {
    pct = Math.min(100, Math.round(((BF.reader.state.pkPageIdx || 0) + 1) / BF.reader.state.pkPages.length * 100));
  } else {
    const span = total - wrap.clientHeight;
    /* 内容不足一屏（span<=0）的短章，打开即读完 → 直接 100%；
       若用 max(1, span) 兜底，pct 永远算 0，底栏显示「测算中」、章末卡永不出现。 */
    if (span <= 0) pct = 100;
    else pct = Math.min(100, Math.round(wrap.scrollTop / span * 100));
  }
  const words = BF.reader.state.parasChars != null ? BF.reader.state.parasChars : ((BF.reader.state.paras || []).join('').length);
  /* J-2：WPM 改用视口停留积分（_wpmReadChars / _wpmDwellSec），天然排除快速滚动扫描——
     旧算法 readWords = words×pct/100 在「一滚到底」时虚高到整章。 */
  const readWords = Math.round(BF.reader._wpmReadChars || 0);
  const dwellMin = (BF.reader._wpmDwellSec || 0) / 60;
  let wpm = dwellMin > 0.05 ? Math.round(readWords / dwellMin) : 0;   /* 需 ≥3s 平静阅读才出数 */
  /* 阶段4c：WPM 移动平均平滑。即时 wpm 受「滚动暂停/跳章」影响剧烈跳变，
     保存最近 5 次采样取平均，消除单次抖动，剩余时间显示更稳定。 */
  if (wpm > 0) {
    if (!BF.reader._wpmAvg) BF.reader._wpmAvg = [];
    BF.reader._wpmAvg.push(wpm);
    if (BF.reader._wpmAvg.length > 5) BF.reader._wpmAvg.shift();
    wpm = Math.round(BF.reader._wpmAvg.reduce(function (a, b) { return a + b; }, 0) / BF.reader._wpmAvg.length);
  } else {
    BF.reader._wpmAvg = [];
  }
  /* 采样窗口不足时「最远字符数 / 累计停留」会把几秒滚到章末算成 4 万字/分。
     超过人类速读上限即判样本不足，清空平滑窗口并落回下方历史/默认兜底。 */
  const WPM_MAX = 2000;
  if (wpm > WPM_MAX) { BF.reader._wpmAvg = []; wpm = 0; }
  /* 刚开章（dwellMin<=0.05）时 wpm=0，底栏会永远「测算中」，
     用历史阅读速度兜底：本书累计阅读分钟与已读字数估全书 WPM（无样本则给 300 字/分默认中速）。 */
  if (wpm === 0) {
    try {
      const _bookId = BF.appState && BF.appState.currentBookId;
      const _bookMin = _bookId && BF.stats && BF.stats.bookMin ? BF.stats.bookMin(_bookId) : 0;
      const _b = BF.reader.state.book;
      const _readRatio = (_b && _b.totalChapters) ? Math.min(1, ((_b.currentChapter || 0) + 1) / _b.totalChapters) : 0;
      const _histReadWords = _b && _b.wordCount ? Math.round(_b.wordCount * _readRatio) : 0;
      if (_bookMin >= 2 && _histReadWords > 0) {
        wpm = Math.round(_histReadWords / _bookMin);
      } else {
        wpm = 300;   /* 无历史样本：默认中速 300 字/分 */
      }
    } catch (e) { wpm = 300; }
  }
  const leftWords = Math.max(0, words - readWords);
  const leftMin = wpm > 0 ? Math.max(1, Math.round(leftWords / wpm)) : 0;
  el.textContent = pct >= 99 ? '本章已读完'
    : (wpm > 0 ? '本章剩余约 ' + leftMin + ' 分钟 · ' + wpm + ' 字/分' : '本章剩余约 — · 测算中');
  /* 读完提示：章末卡片（chap-end-card，下方）已表达「本章读完，继续往下读？」，
     不单独发一条进通知历史的 toast，避免每读完一章都往通知中心塞一条。 */
  /* 章末卡：本章读到末尾时浮现「下一章」入口，末章显示「全书读完」；
     仅在本页阅读态、且非微读模式时显示；状态不变则不重绘，避免滚动抖动。 */
  var card = document.getElementById('chap-end-card');
  if (card) {
    var _b = BF.reader.state.book;
    var _total = _b ? (_b.totalChapters || 0) : 0;
    var _idx = BF.appState.currentChapterIdx || 0;
    var _isLast = _idx >= _total - 1;
    var _atEnd = (BF.reader.pageModeActive() && (BF.reader.state.pkPages || []).length)
      ? BF.reader.state.pkPageIdx >= BF.reader.state.pkPages.length - 1
      : pct >= 99;
    var _page = document.getElementById('page-reader');
    var _micro = _page && _page.classList.contains('microread');
    var _state = (_atEnd && !_micro && BF.appState.currentPage === 'reader')
      ? (_isLast ? 'last' : 'next') : 'hide';
    if (card._state !== _state) {
      card._state = _state;
      if (_state === 'hide') {
        card.classList.remove('show');
      } else {
        card.innerHTML = _state === 'last'
          ? '<span>全书读完 🎉</span><button class="btn btn-xs" data-review-card="" aria-label="本书回顾">回顾本书</button>'
          : '<span>本章读完，继续往下读？</span><button class="btn btn-xs" data-next-chapter="" aria-label="下一章">下一章 →</button>';
        card.classList.add('show');
      }
    }
  }
};

