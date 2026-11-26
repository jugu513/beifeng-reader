/* ================= T10. UI ================= */
BF.tts.setPlayIcon = function (playing) {
  /* 播放态一变，顶栏的灯必须跟着变：
     灯只在降级/探针事件里刷新时，「开始朗读/暂停」不改文案。
     放在 bar 判空之前——朗读条不在（微读/未开书）时顶栏的灯照样得说话。 */
  try { if (BF.tts.stab && BF.tts.stab.lampRefresh) BF.tts.stab.lampRefresh(); } catch (e) { BF.err.report('tts.lamp.onPlay', e); }
  const bar = document.getElementById('tts-bar');
  if (!bar) return;
  const play = bar.querySelector('.play');
  const pause = bar.querySelector('.pause');
  if (play) play.style.display = playing ? 'none' : '';
  if (pause) pause.style.display = playing ? '' : 'none';
};
BF.tts.updateVoiceLabel = function (eng) {
  const v = document.getElementById('tts-voice');
  if (!v) return;
  /* 朗读条标签 = 档位名 + 这一档当前用的音色。音色名怎么找由能力表那一行给：
     原来这里手抄了一份 names 表并各摸一次 VOICES，加一档就要回来补一格，
     漏格的现象是标签显示原始档位名（'edge'）而不是「Edge · 晓晓」。 */
  const cap = BF.tts.cap(eng);
  let txt = eng;
  if (cap) {
    let vn = null;
    try { vn = cap.voiceName ? cap.voiceName() : null; } catch (e) { vn = null; }
    txt = vn ? (cap.label + ' · ' + vn) : cap.label;
  }
  v.textContent = txt;
  const dot = document.getElementById('tts-dot');
  /* 点色看这一档走不走网络，不看名字：本机档亮「在线」色会让人以为服务连着 */
  if (dot) dot.className = 'dot ' + (cap && cap.network ? 'online' : 'offline');
  BF.tts.syncStatusLabel();
};
/* 书架顶栏的朗读状态条：#tts-status-label2 必须与 tts-voice 同步并可点击跳回，
   否则在书架/首页时完全看不出后台是否还在朗读（它是个占位元素） */
BF.tts.syncStatusLabel = function () {
  const l2 = document.getElementById('tts-status-label2');
  if (!l2) return;
  if (BF.tts.state.playing && BF.tts.state.bookId) {
    const b = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (x) { return x && x.id === BF.tts.state.bookId; });
    l2.textContent = '朗读中：' + ((b && b.title) || '未命名') + ' 第' + ((BF.tts.state.chapterIdx || 0) + 1) + '章';
    l2.title = '点击回到正在朗读的书';
    l2.style.cursor = 'pointer';
  } else {
    l2.textContent = ''; l2.title = ''; l2.style.cursor = '';
  }
};
BF.tts.updateStats = function () {
  const e = Math.floor((Date.now() - (BF.tts.state.startTime || Date.now())) / 1000);
  const m = Math.floor(e / 60), s = e % 60;
  const el = document.getElementById('tts-time');
  if (el) el.textContent = String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
  const st = document.getElementById('tts-stats');
  if (st && BF.tts.state.segs) st.textContent = '句 ' + Math.min(BF.tts.state.pos + 1, BF.tts.state.segs.length) + '/' + BF.tts.state.segs.length + ' · ' + BF.tts.state.wordsRead + ' 字';
  /* 剩余时间：剩余字符 ÷ 实测字符/秒（本次朗读累计），约值，不写精确秒 */
  const rmEl = document.getElementById('tts-remain');
  if (rmEl && BF.tts.state.segs && BF.tts.state.playing) {
    const segs = BF.tts.state.segs;
    let total = 0;
    for (let i = 0; i < segs.length; i++) { const t = (typeof segs[i] === 'string') ? segs[i] : ((segs[i] && segs[i].text) || ''); total += t.length; }
    const read = BF.tts.state.wordsRead || 0;
    const remain = Math.max(0, total - read);
    const rate = (e > 0 && read > 0) ? read / e : 0;   /* 实测字符/秒 */
    rmEl.textContent = rate > 0 ? ('约剩 ' + Math.max(1, Math.round(remain / rate / 60)) + ' 分') : '';
  } else if (rmEl) {
    rmEl.textContent = '';
  }
};
/* 整句高光基线。
   拿 seg.slice(0,8) 去全文扫 <p> 并无条件取第一个命中不可靠：
   · 短句键成片撞车（编号列表/表格行的 `4.`、`0.`、`|` 键命中 12–14 段）
     → 朗读第 36 句时高光跳回第 3 段；
   · 跨段/markdown 句的键落在任何单段之外 → 零命中，循环走完直接
     return，不高亮不滚动不提示，静默失效。
   句若带 pi（segment 的索引化结果，见 BF.tts.offline.segment），
   直接按段索引选段 + 段内偏移取区间，不做全文搜索；无 pi 时走
   全文搜索兜底（选区朗读 / 旧会话等未索引路径行为不变）。
   虚拟化渲染（>2000 段）只渲染窗口段，此时段元素带 data-vi，按它取。 */
BF.tts._segLoc = function (segs, idx) {
  /* 取第 idx 句的 {text, pi, po}。segs 元素可能是字符串（未索引化）
     或 {text, pi, po}（索引化）；两种都能吃。 */
  const s = segs && segs[idx];
  if (s == null) return null;
  if (typeof s === 'string') return { text: s, pi: -1, po: 0 };
  return { text: s.text, pi: typeof s.pi === 'number' ? s.pi : -1, po: typeof s.po === 'number' ? s.po : 0 };
};
BF.tts._visibleStartSeg = function (segs) {
  /* 听读共锚：取「视口第一个可见段落」所属的首句索引。
     段索引算法与 _paraNode 完全一致：虚拟化段读 data-vi，否则按 <p> 序号
     （reader-main 内 <p> 恰为正文段落序列）。判不出锚（不在阅读页 /
     segs 未索引化 / 无可见段）返回 null，由调用方回落断点会话。 */
  if (BF.appState.currentPage !== 'reader') return null;
  if (!segs || !segs.length || typeof segs[0] === 'string') return null;
  const rm = document.getElementById('reader-main');
  const wrap = document.getElementById('reader-wrap') || rm;
  if (!rm || !wrap) return null;
  const nodes = rm.querySelectorAll('p');
  if (!nodes.length) return null;
  const wr = wrap.getBoundingClientRect();
  let visPi = -1;
  for (let i = 0; i < nodes.length; i++) {
    const pr = nodes[i].getBoundingClientRect();
    if (pr.bottom > wr.top + 8 && pr.top < wr.bottom - 8) {
      const dvi = nodes[i].getAttribute('data-vi');
      visPi = dvi != null ? parseInt(dvi, 10) : i;
      break;
    }
  }
  if (!(visPi >= 0)) return null;
  for (let j = 0; j < segs.length; j++) {
    const L = BF.tts._segLoc(segs, j);
    if (L && L.pi >= visPi) return j;
  }
  return null;
};
BF.tts._paraNode = function (rm, pi) {
  /* 段落索引 → <p>。虚拟化段带 data-vi；否则按段落序号取。
     reader-main 内 <p> 恰为正文的段落序列（标题是 h2，页脚是 div）。 */
  if (pi < 0) return null;
  const vi = rm.querySelector('p[data-vi="' + pi + '"]');
  if (vi) return vi;
  const all = rm.querySelectorAll('p');
  return (pi < all.length) ? all[pi] : null;
};
/* 在段内定位并套色。start 为段内偏移（<0 表示从头），end 为终止偏移
   （<0/超长表示到段尾或到句尾）。返回是否套上了。 */
BF.tts._markInPara = function (rm, p, text, start, end) {
  const mark = document.createElement('mark');
  mark.style.background = 'color-mix(in srgb, var(--accent) 25%, transparent)';
  mark.textContent = text;
  try {
    /* 前缀键提在循环外：放进循环里就是每个文本节点重切一次 slice(0,8) */
    const key8 = text.slice(0, 8);
    const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      /* 优先按段内偏移；无偏移（pi>=0 但 po=0 的段落档，或文本无空白）
         时退回句内首字定位，保证跨段句也能落点。 */
      const len = node.textContent.length;
      let i = -1;
      if (start > 0 && start < len) i = start;
      else i = node.textContent.indexOf(key8);
      if (i < 0 && start >= 0 && start <= len && len > 0) i = Math.min(start, Math.max(0, len - 1));
      if (i >= 0) {
        const e = (end >= 0) ? Math.min(Math.max(end, i + 1), len) : Math.min(i + text.length, len);
        const range = document.createRange();
        range.setStart(node, i);
        range.setEnd(node, e);
        range.surroundContents(mark);
        BF.tts._curMark = mark;   /* 刚插入的就是它，不必回头再全子树 querySelector */
        return true;
      }
    }
  } catch (e) { mark.remove(); }
  return false;
};
BF.tts.highlight = function (segs, idx) {
  if (!BF.settings.get('ttsAutoScroll')) return;
  if (Date.now() - BF.tts._userScrollAt < 600) return;
  const rm = document.getElementById('reader-main');
  if (!rm) return;
  const L = BF.tts._segLoc(segs, idx);
  if (!L || !L.text) return;
  BF.tts._clearHighlight();
  /* 路径一（索引化）：按段索引直接落段，跨段句不再依赖键落在单段里 */
  if (L.pi >= 0) {
    const p = BF.tts._paraNode(rm, L.pi);
    if (p) {
      const paraText = p.textContent || '';
      const inPara = paraText.indexOf(L.text.slice(0, 8));
      const start = inPara >= 0 ? inPara : Math.max(0, L.po);
      BF.tts._markInPara(rm, p, L.text, start, start + L.text.length);
      p.scrollIntoView({ block: 'center', behavior: 'smooth' });
      BF.tts._curMark = BF.tts._curMark || rm.querySelector('mark');   /* 此处 mark 由 _markInPara 直存，query 仅在缺位时兜底 */
      return;
    }
  }
  /* 路径二（兜底）：全文搜索 —— 未索引路径
     （选区朗读回落、段落为空导致 pi<0）走这条，行为与索引路径一致。 */
  const seg = L.text;
  const key8b = seg.slice(0, 8);   /* 前缀键提到段循环外 */
  const nodes = rm.querySelectorAll('p');
  for (const p of nodes) {
    if (p.textContent.includes(key8b)) {
      const mark = document.createElement('mark');
      mark.style.background = 'color-mix(in srgb, var(--accent) 25%, transparent)';
      mark.textContent = seg;
      try {
        const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const i = node.textContent.indexOf(key8b);
          if (i >= 0) {
            const range = document.createRange();
            range.setStart(node, i);
            range.setEnd(node, Math.min(i + seg.length, node.textContent.length));
            range.surroundContents(mark);
            break;
          }
        }
      } catch (e) { mark.remove(); }
      p.scrollIntoView({ block: 'center', behavior: 'smooth' });
      BF.tts._curMark = mark;   /* 直存局部变量，免每句一次全子树 querySelector */
      return;
    }
  }
};
/* 逐词高亮：在整句基线（BF.tts.highlight）被 onboundary 接管后，按 charIndex 增量高亮
   已朗读部分 [0, ci]；不滚动（滚动由整句基线 onstart 负责），避免逐词狂滚。
   若浏览器不触发 boundary（如部分 Chromium 中文），逐词高亮不介入，整句基线保留，不降级。

   选段同样走索引——逐词高亮与整句高光共用同一条定位路径，
   只处理整句侧的话，逐词侧会继续在高亮错误的段上推进。
   seg 可传字符串或 {text, pi, po}；ci 是「句内偏移」，故段内起点需加 po。 */
BF.tts.wordHighlight = function (seg, charIndex) {
  if (BF.settings.get('ttsWordHighlight') === false) return;
  if (Date.now() - BF.tts._userScrollAt < 600) return;
  const rm = document.getElementById('reader-main');
  if (!rm || !seg) return;
  const L = BF.tts._segLoc([seg], 0);
  if (!L || !L.text) return;
  const text = L.text;
  let targetP = null, start = 0;
  if (L.pi >= 0) {
    targetP = BF.tts._paraNode(rm, L.pi);
    if (targetP) {
      const inPara = (targetP.textContent || '').indexOf(text.slice(0, 8));
      start = inPara >= 0 ? inPara : Math.max(0, L.po);
    }
  } else {
    const nodes = rm.querySelectorAll('p');
    for (const p of nodes) {
      if (p.textContent.includes(text.slice(0, 8))) { targetP = p; break; }
    }
  }
  if (!targetP) return;
  /* 两层高亮：整句底色（highlight 已绘，这里不清）之上叠逐词下划线层。
     逐词层是独立 span，换词只摘旧层换新层，底色纹丝不动。 */
  BF.tts._clearWordLayer();
  const wu = document.createElement('span');
  wu.className = 'tts-word-u';
  BF.tts._curWord = wu;
  try {
    const walker = document.createTreeWalker(targetP, NodeFilter.SHOW_TEXT);
    /* ci 是句内偏移；段内起点 start 是该句在段中的位置，
       故绝对位置 = start + ci（不能按 acc=0 从段首算，差的正是这句前缀）。 */
    const ci = Math.max(0, Math.min(charIndex | 0, text.length));
    const abs = start + ci;
    let node, acc = 0, sN = null, sO = 0, eN = null, eO = 0;
    while ((node = walker.nextNode())) {
      const len = node.textContent.length;
      if (sN === null && acc + len > abs) { sN = node; sO = abs - acc; }
      if (acc + len >= abs) { eN = node; eO = abs - acc; break; }
      acc += len;
    }
    if (sN) {
      const range = document.createRange();
      range.setStart(sN, sO);
      range.setEnd(eN || sN, eO || sN.textContent.length);
      range.surroundContents(wu);
    } else { BF.tts._curWord = null; }
  } catch (e) { BF.tts._curWord = null; }
};
/* 按服务端时间轴推进逐词下划线（在线引擎专用；无时间轴时整句底色照旧）。
   时间轴来自 Edge 回的 audio.metadata，毫秒；这里只做「到点就推进到第几个词」，
   不做平滑插值——词边界本身就是离散的。 */
BF.tts._driveTimeline = function (seg, text, tl) {
  BF.tts._stopTimeline();
  if (!tl || !tl.words || !tl.words.length) return;
  /* 词的起止位置按顺序游标找：边界文本是朗读文本的子串，标点通常不在里面，
     全局 indexOf 会让重复词互相纠缠。 */
  let cur = 0;
  const parts = [];
  for (let i = 0; i < tl.words.length; i++) {
    const w = tl.words[i], t = String(w.txt || '');
    if (!t) continue;
    let at = text.indexOf(t, cur);
    if (at < 0) at = cur;
    parts.push({ ms: w.ms | 0, end: at + t.length });
    cur = at + t.length;
  }
  if (!parts.length) return;
  /* Edge 的时间轴同样算「本句有逐词进度」：不置这个标记，onended 里的
     「不提供逐词进度」提示会在下划线正常推进时照弹一次。 */
  BF.tts.state._boundarySeg = seg;
  const t0 = performance.now();
  let lastEnd = -1;
  BF.tts._tlStop = BF.timers.interval(function () {
    if (!BF.tts.state.playing) { BF.tts._stopTimeline(); return; }
    const el = performance.now() - t0;
    let p = parts[0];
    for (let i = 0; i < parts.length; i++) { if (parts[i].ms <= el) p = parts[i]; else break; }
    if (p.end !== lastEnd) { lastEnd = p.end; try { BF.tts.wordHighlight(seg, p.end); } catch (e) {} }
  }, 60);
};
BF.tts._stopTimeline = function () {
  if (BF.tts._tlStop) { try { BF.tts._tlStop(); } catch (e) {} BF.tts._tlStop = null; }
};
/* 摘逐词层：只解自己的 span，不碰整句底色。 */
BF.tts._clearWordLayer = function () {
  const w = BF.tts._curWord;
  if (w && w.parentNode) {
    const parent = w.parentNode;
    parent.replaceChild(document.createTextNode(w.textContent), w);
    parent.normalize();
  }
  BF.tts._curWord = null;
};
BF.tts._clearHighlight = function () {
  const rm = document.getElementById('reader-main');
  BF.tts._clearWordLayer();
  if (rm && BF.tts._curMark && BF.tts._curMark.parentNode) {
    const parent = BF.tts._curMark.parentNode;
    parent.replaceChild(document.createTextNode(BF.tts._curMark.textContent), BF.tts._curMark);
  }
  BF.tts._curMark = null;
};
BF.tts.hideHighlight = function () { BF.tts._clearHighlight(); };
/* 引擎档变更的落地：正在播放时按「暂停→应用→恢复」走 ——
   start({from:当前句}) 开新会话以新引擎续读，旧会话被代次自弃。
   语速 / 音调 / 音量不在此列：它们每句现读，下一句自然生效，
   为它们打断当前句属于过度敏感。载荷是全量快照，引擎档靠上次快照对差。 */
(function () {
  /* 基线取当前值，不取 undefined：原来「第一次广播只看不动」是为了躲开机时那次补齐写盘，
     但代价是本次会话里第一次真切引擎档也不重画——面板刚打开就切档，行集停在上一档。
     有了基线值，值没变就自然跳过，开机那趟不再需要特例。 */
  let _lastEngine = (function () { try { return BF.settings.get('ttsEngine'); } catch (e) { return undefined; } })();
  try {
    BF.bus.on(BF.EVENTS.SETTINGS, function (snap) {
      if (!snap || typeof snap.ttsEngine === 'undefined') return;
      const cur = snap.ttsEngine;
      const prev = _lastEngine;
      _lastEngine = cur;
      if (prev === cur) return;
      /* 行集先于播放：这一条订阅是唯一入口——面板下拉、DSL、恢复默认、
         跨标签同步都会走到这里。只有挂在 DOM 变化上重建，就会有
         「策略改了、语音那一屏还是上一档的行」这种漂移。
         重建换掉用户正对着的控件，所以记住键名再还回去。 */
      try {
        if (BF.settingsUI && BF.sheet && BF.sheet.isOpen && BF.sheet.isOpen('settings')) {
          let focusKey = null;
          const a = document.activeElement;
          if (a && a.dataset) focusKey = a.dataset.set || a.dataset.setText || a.dataset.setStep || null;
          BF.settingsUI._dirty.tts = true;
          BF.settingsUI.rerender('tts');
          if (focusKey) { const el = BF.settingsUI._ctl(focusKey); if (el) el.focus(); }
        }
      } catch (e2) { BF.err.report('tts.policyRerender', e2); }
      if (!BF.tts.state.playing) return;
      BF.tts.start({ from: BF.tts.state.pos || 0 });
    });
  } catch (e) { if (BF.err) BF.err.report('tts.engineSwitchWatch', e); }
})();
BF.tts._userScrollAt = 0;
(function () {
  const wrap = document.getElementById('reader-wrap');
  if (wrap) wrap.addEventListener('scroll', function () { BF.tts._userScrollAt = Date.now(); }, { passive: true });
})();

