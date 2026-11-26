/* ================= DSL 终端（终端式工作台） =================
   「编辑器 · 控制台」单列终端：REPL（↑↓ 历史 / 多行转编辑器 / clear /
   perm / Tab 补全）、权限档位徽章、语法高亮与实时静态校验、行列字数状态栏、
   手册导出。
     · 脚本管理走「扩展管理」面板；模板与示例收录在 ctx.tools.exportManual()
       导出的 .md 手册里
     · 对外契约：{ toggle, run, render, _out, _clearOut }，
       id 契约：dsl-console / dsl-code / dsl-name / dsl-out
     · 快捷键：Ctrl/Cmd+Enter 运行 · Ctrl/Cmd+S 保存 · Esc 关闭（模态框让位）
   */
BF.dslUI = (function () {
  /* 终端文案统一从 BF.dsl.t 取（同一张表）：切语言后只把静态标签重画一遍，
     不重建面板、不动日志与在途会话。 */
  const T = function (k, v) { try { return BF.dsl.t(k, v); } catch (e) { return k; } };
  const PANEL_ID = 'dsl-console';
  /* 结果的「有限等待」渲染实现住在本模块之外的 BF.dsl 里，编辑器与 REPL 两条路径共用一份。
     取别名而不是就地重写：本模块作用域拿不到 dsl 的私有函数名，直接引用会在 promise 回调里
     抛错并被吞掉，表现为终端只回声、无输出。 */
  const _fmtResult = BF.dsl.formatResultAwaited;
  const LOG_MAX = 400;                 /* 输出保留条数（超出丢弃最旧） */
  const HIST_MAX = 60;
  /* 内置示例脚本收录在 ctx.tools.exportManual() 导出的 .md 手册里
     （脚本基础 / 工具集 / 权限三段都有可直接复制的代码片段）。 */
  /* 会话态：跨 render 保留；输出与 REPL 历史为内存态（刷新清零） */
  let _cur = null;
  let _log = [];                       /* [{ type, text, t }] */
  let _hist = [];                      /* REPL 历史（最新在前） */
  let _histIdx = -1;
  let _running = false;
  const esc = function (s) { return BF.dom.esc(s); };
  const escAttr = function (s) { return BF.dom.esc(s); };

  /* Tab 命令补全的候选词由命令表派生（BF.dsl.CMDS / META_CMDS 的 tab 字段）。
     带尾空格＝这条命令要跟参数。别名（dir/cd/cls/exit…）一并进候选，
     它们只住在命令表的 alias 字段里，这里读出来，不另写一份。
     表读不到时退回一份最小硬表，补全宁缺不炸。 */
  const REPL_CMDS = (function () {
    try {
      const all = (BF.dsl.CMDS || []).concat(BF.dsl.META_CMDS || []);
      const t = [];
      all.forEach(function (c) {
        if (c.tab) t.push(c.tab);
        (c.alias || []).forEach(function (a) { if (t.indexOf(a + ' ') < 0) t.push(a + ' '); });
      });
      if (t.length) return t;
    } catch (e) { BF.err.report('dsl.replCmds', e); }
    return ['help', 'ls', 'stats', 'tag'];
  })();

  /* ============================================================
     输出模型：类型化行 + 时间戳（_out/_clearOut 是对外契约，签名稳定）
     ============================================================ */
  /* 输出留痕：内存态之外再存末 200 行，重开面板（含刷新页面）还能看到
     上一次跑过什么 —— 终端的滚动缓冲不该跟着页面一起蒸发。
     只存 type/text：时间戳与旧会话的滚动位置都无意义，不占存储。
     200 行上限让这块读写小到可以直接在开窗时同步读，不用挂到 boot 后。
     键名不带 bf_：BF.store 自己加 PREFIX，写成 'bf_dsl_log' 会落成交叠
     双前缀的 bf_bf_dsl_log（READING_STATE 踩过的同一个坑）。 */
  const LOG_KEY = BF.store.K.DSL_LOG;
  const LOG_PERSIST = 200;
  const LOG_SEP_TEXT = '—— 以上为上次会话输出 ——';
  /* 落盘前脱敏。屏幕上刚经闸门放行给本人看的明文，不该顺手写进一份会被
     备份快照与自包含离线包一起带走的滚动缓冲。判据只认「密钥长相」，
     不做语义猜测：sk- 前缀串、Bearer/basic 后随值、显式密钥键名的赋值右侧、
     以及 32 位十六进制串。中文句子、书目标识、正常命令回显都不受影响。
     只改落盘的那份拷贝——内存态与当前屏幕渲染保持原样，用户刚授权看到的东西
     不该在下一秒自己消失。 */
  function _scrubForDisk(text) {
    const s = String(text == null ? '' : text);
    if (!s) return s;
    return s
      .replace(/\bsk-[A-Za-z0-9_-]{8,}/g, 'sk-***')
      /* 按形态补的两类：以服务商前缀开头的 token（nvapi-…）与「短id.长secret」点分形态。
         只认形态不认语义 —— 猜"这像不像密钥"会把普通日志涂成一团，也照样漏掉新的一家。 */
      .replace(/\bnvapi-[A-Za-z0-9_-]{10,}/g, 'nvapi-***')
      .replace(/\b[0-9a-f]{8}\.[A-Za-z0-9_\-.]{20,}/gi, '***')
      .replace(/((?:Bearer|basic)\s+)[A-Za-z0-9._+\/=-]{6,}/gi, '$1***')
      .replace(/((?:aiApiKey|mimoApiKey|api[_-]?key|access[_-]?key|secret|token|password|passwd|pin)\s*(?:=|:)\s*)("[^"]*"|'[^']*'|[^\s,;}]+)/gi, '$1***')
      .replace(/\b[0-9a-f]{32}\b/gi, '***');
  }
  let _logSaveT = null;
  function _persistLogSoon() {
    if (_logSaveT) clearTimeout(_logSaveT);
    _logSaveT = setTimeout(function () {
      _logSaveT = null;
      try {
        BF.store.lsSet(LOG_KEY, _log.slice(-LOG_PERSIST).map(function (l) { return { type: l.type, text: _scrubForDisk(l.text) }; }));
      } catch (e) { BF.err.report('dsl.log.persist', e); }
    }, 500);
  }
  function _restoreLog() {
    if (_log.length) return;   /* 当前会话已经打过字：旧存档不能盖掉眼前这几行 */
    let saved = null;
    try { saved = BF.store.lsGet(LOG_KEY, null); } catch (e) { return; }
    if (!Array.isArray(saved) || !saved.length) return;
    const TYPES = { in: 1, ok: 1, err: 1, warn: 1, info: 1 };
    saved.forEach(function (l) {
      if (!l || typeof l.text !== 'string') return;
      if (l.text === LOG_SEP_TEXT) return;   /* 上次那道分隔线不再灌一次 */
      _log.push({ type: TYPES[l.type] ? l.type : 'info', text: l.text, t: Date.now() });
    });
    if (!_log.length) return;
    if (_log.length > LOG_MAX) _log.splice(0, _log.length - LOG_MAX);
    renderLog();
    _out(LOG_SEP_TEXT, 'info');
  }
  /* 贴底策略：终端的滚动条属于用户。只有他本来就停在底部时才跟着新内容走，
     往上翻看历史时新行照常进来、视口不动 —— 无条件 scrollTop=scrollHeight
     会在流式回答时把人一次次拽回底部，等于没法边生成边回看。 */
  function _atBottom(el) {
    return !el || el.scrollHeight - el.clientHeight - el.scrollTop < 8;
  }
  function _followBottom(el) {
    if (el) el.scrollTop = el.scrollHeight;
  }
  function _out(text, cls) {
    /* cls 兼容入参：cmd/head/ok/err/warn/默认 —— 统一映射到输出行类型 */
    const type = cls === 'cmd' ? 'in' : (cls === 'head' ? 'info' : (cls === 'ok' || cls === 'err' || cls === 'warn' ? cls : 'info'));
    _log.push({ type: type, text: String(text == null ? '' : text), t: Date.now() });
    if (_log.length > LOG_MAX) _log.splice(0, _log.length - LOG_MAX);
    renderLog();
    _persistLogSoon();
  }
  /* 流式行：先占一行，之后逐块就地改写末行文本。每来一个 token 就全量重画会拖住
     终端，所以 90ms 合并一次；_log 里那条始终同步，重画与持久化拿到的都是最新文本。 */
  function _live(cls) {
    _out('', cls || 'ok');
    const ent = _log[_log.length - 1];
    let node = null, cancel = null, buf = '';
    const paint = function () {
      const logEl = document.getElementById('dwb-log');
      /* 必须在写入前量贴底态：写完再量，新行本身已把 scrollHeight 撑大，永远量不到「写入前就贴着底」 */
      const stick = _atBottom(logEl);
      if (!node && logEl && logEl.lastElementChild) node = logEl.lastElementChild.querySelector('.dwb-line__m');
      if (node) node.textContent = buf;
      if (stick) _followBottom(logEl);
    };
    const fn = function (text) {
      buf = String(text == null ? '' : text);
      ent.text = buf;
      if (cancel) return;
      cancel = BF.timers.timeout(function () { cancel = null; paint(); }, 90);
    };
    fn.finish = function (text) {
      buf = String(text == null ? '' : text);
      ent.text = buf;
      if (cancel) { cancel(); cancel = null; }
      node = null;
      renderLog();
      _persistLogSoon();
    };
    fn.cancel = function () { if (cancel) { cancel(); cancel = null; } };
    return fn;
  }
  /* 提示符带当前态：C:\beifeng\bookshelf> / C:\beifeng\<book>\ch3>，会话态优先。
     只读不回写，也不挂总线 —— 开面板与每条命令后刷新一次就够，
     多挂一个监听只会多一条「无监听」告警。 */
  function _promptText() {
    try {
      if (BF.dsl.agentState && BF.dsl.agentState().on) return T('promptAgent');
      if (BF.dsl.chatState && BF.dsl.chatState().on) return T('promptChat');
      const st = BF.appState || {};
      const _p = {
        home: 'pathHome', bookshelf: 'pathShelf', settings: 'pathConfig', search: 'pathFind',
        stats: 'pathStats', notes: 'pathNotes', mine: 'pathMe', reader: 'pathRead', qj: 'pathQj',
      }[st.currentPage];
      const pageName = _p ? T(_p) : '';
      if (st.currentPage === 'reader' && st.currentBookId) {
        const b = (BF.library.mergeReadingState(BF.store.lsGetArray(BF.store.K.BOOKS_META, [])) || [])
          .find(function (x) { return x && x.id === st.currentBookId; });
        const t = String(b && b.title ? b.title : T('bookFallback')).replace(/[\\/>:*?"|]/g, '').slice(0, 20);
        return T('bookDir', { title: t, ch: T('chapterSeg', { n: Number(st.currentChapterIdx || 0) + 1 }) });
      }
      /* 工程模式（beifeng666）：提示符显式换挡，让"现在敲的命令属于运维语境"看得见 */
      if (BF.ops && BF.ops.active) return 'C:\\beifeng\\ops' + (pageName ? '\\' + pageName : '') + '>';
      return 'C:\\beifeng' + (pageName ? '\\' + pageName : '') + '>';
    } catch (e) { return 'C:\\beifeng>'; }
  }
  function _refreshPrompt() {
    const ps = document.querySelector('#dwb-replrow .dwb-ps1');
    if (ps) ps.textContent = _promptText();
  }
  /* 会话模式的显示态：状态只住 BF.dsl 一处，这里改提示符与输入框语义 */
  function _setChatMode(on) {
    _refreshPrompt();
    const inp = document.getElementById('dsl-repl');
    if (inp) {
      inp.placeholder = on ? T('phChat') : '';
      inp.setAttribute('aria-label', on ? T('phChat') : T('replAria'));
    }
  }
  BF.dsl.setUiSink({ out: _out, live: _live, chatMode: _setChatMode });
  function _clearOut() {
    _log.length = 0;
    renderLog();
    /* 清屏是用户的明确意图 → 存档同步抹掉，且取消在途的那笔防抖写，
       否则 500ms 后又把清空前的尾巴写回去。 */
    if (_logSaveT) { clearTimeout(_logSaveT); _logSaveT = null; }
    try { BF.store.lsRemove(LOG_KEY); } catch (e) { BF.err.report('log.clear', e); }
  }
  function renderLog() {
    const logEl = document.getElementById('dwb-log');
    if (!logEl) return;
    const lineStr = function (l) {
      return '<div class="dwb-line is-' + l.type + '">' +
        '<span class="dwb-line__m">' + esc(l.text) + '</span></div>';
    };
    /* 每输出一行就全量重画至多 400 条的话，脚本狂打印时是 O(n²)。
       恰好新增一行 → 只 append 该行并掐掉溢出头部；其余情形（清空/重建）仍全量。 */
    /* 贴底才跟：用户往上翻历史时，新行照进、视口不动 */
    const stick = _atBottom(logEl);
    if (logEl.__shown === _log.length - 1 && logEl.childElementCount === logEl.__shown) {
      const node = document.createElement('div');
      node.innerHTML = lineStr(_log[_log.length - 1]);
      while (logEl.childElementCount > LOG_MAX - 1) logEl.removeChild(logEl.firstChild);
      logEl.appendChild(node.firstChild);
    } else {
      logEl.innerHTML = _log.map(lineStr).join('');
    }
    logEl.__shown = _log.length;
    if (stick) _followBottom(logEl);
  }

  /* ============================================================
     语法高亮：先切分再转义，绝不让脚本内容变成 HTML（XSS 防线）
     ============================================================ */
  function highlight(src) {
    const s = String(src == null ? '' : src);
    if (s.length > 60000) return esc(s);          /* 超长脚本降级纯文本，保交互流畅 */
    const re = /(\/\/[^\n]*|\/\*[\s\S]*?\*\/)|('(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`)|\b(0x[\da-fA-F]+|\d+(?:\.\d+)?)\b|\b(const|let|var|function|return|if|else|for|while|do|switch|case|break|continue|new|class|extends|super|this|typeof|instanceof|in|of|try|catch|finally|throw|async|await|yield|delete|void|default|true|false|null|undefined)\b|(\b(?:BF|ctx)\b(?:\s*\.\s*[A-Za-z_$][\w$]*)?)/g;
    let out = '', last = 0, m;
    while ((m = re.exec(s))) {
      out += esc(s.slice(last, m.index));
      if (m[1]) out += '<span class="tk-com">' + esc(m[1]) + '</span>';
      else if (m[2]) out += '<span class="tk-str">' + esc(m[2]) + '</span>';
      else if (m[3]) out += '<span class="tk-num">' + esc(m[3]) + '</span>';
      else if (m[4]) out += '<span class="tk-kw">' + esc(m[4]) + '</span>';
      else if (m[5]) {
        const i = m[5].indexOf('.');
        if (i < 0) out += '<span class="tk-ctx">' + esc(m[5]) + '</span>';
        else out += '<span class="tk-ctx">' + esc(m[5].slice(0, i)) + '</span><span class="tk-api">' + esc(m[5].slice(i)) + '</span>';
      }
      last = m.index + m[0].length;
    }
    out += esc(s.slice(last));
    return out + '\n';                             /* 末尾补行，滚动高度与 textarea 对齐 */
  }

  /* ============================================================
     面板骨架（静态部分只建一次，事件全走面板级委托）
     ============================================================ */

  /* ---------- 窗口手感：标题栏拖动 + 落点记忆 + 双击整屏 ----------
     存档只有两件事：dslPos（窗口左上角的视口坐标）与 dslMax（整屏）。
     落点与 CSS 的居中 transform 互斥 —— 有显式落点就把 transform 关掉
     改用 left/top；整屏态同理必须清掉内联落点，否则 CSS 的 left:0/top:0
     输给内联样式，「最大化」只改了尺寸没改位置。
     起点用 getBoundingClientRect 现算（它含 transform 效果，与视觉一致），
     所以切到显式定位的那一帧窗口不会跳。 */
  const DRAG_KEEP = 40;   /* 钳位底线：标题栏至少还有 40px 留在视口内 */
  let _drag = null;
  function _clampPos(p, el) {
    const w = (el && el.offsetWidth) || 640;
    return {
      x: Math.min(Math.max(p.x, DRAG_KEEP - w), Math.max(DRAG_KEEP, window.innerWidth - DRAG_KEEP)),
      y: Math.min(Math.max(p.y, 0), Math.max(DRAG_KEEP, window.innerHeight - DRAG_KEEP)),
    };
  }
  /* 存档优先判 dslMax；其次落点必须还在当前视口内（换过屏幕 / 缩过窗口
     就当作越界，回 CSS 居中），否则用户会面对一个「开着但看不见」的面板。 */
  function _applyWinState(el) {
    if (!el) return;
    let max = false, pos = null;
    try { max = !!BF.settings.get('dslMax'); pos = BF.settings.get('dslPos'); } catch (e) {}
    if (max) {
      el.classList.add('mode-max');
      /* left/top 交给 CSS（.mode-max 的特异度高于窄屏那段 #dsl-console），
         transform 必须留内联：reduce-motion 那两条是 body.reduce-motion
         #dsl-console 的复合选择器，特异度压过 .mode-max，不顶掉它的话
         整屏窗口会被 translate 挪走半个身位。 */
      el.style.left = ''; el.style.top = ''; el.style.transform = 'none';
      return;
    }
    el.classList.remove('mode-max');
    if (pos && typeof pos.x === 'number' && typeof pos.y === 'number') {
      const c = _clampPos(pos, el);
      if (c.x === pos.x && c.y === pos.y) {
        el.style.left = c.x + 'px'; el.style.top = c.y + 'px'; el.style.transform = 'none';
        return;
      }
      /* 存档落点已不在当前视口（拔外接屏等），回中并提示 */
      try { if (BF.noti && BF.noti.info) BF.noti.info(T('outPosReset')); } catch (e) {}
    }
    el.style.left = ''; el.style.top = ''; el.style.transform = '';
  }
  function _toggleMax(el) {
    el = el || document.getElementById(PANEL_ID);
    if (!el) return;
    const next = !el.classList.contains('mode-max');
    try { BF.settings.set('dslMax', next); } catch (e) {}
    _applyWinState(el);
  }
  function _wireDrag(el) {
    const head = el.querySelector('.dwb-head');
    if (!head || head.__dslDrag) return;
    head.__dslDrag = true;
    head.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      /* 按钮 / 权限徽章 / 表单控件是各自的交互面，按下不启动拖动 */
      if (e.target && e.target.closest && e.target.closest('button, .dwb-perm, input')) return;
      if (el.classList.contains('mode-max')) return;   /* 整屏态没有「挪窗口」这件事 */
      if (_drag) onDragEnd(e);                          /* 上一轮没收尾（多点触控）→ 先落定 */
      const rect = el.getBoundingClientRect();
      _drag = { id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: rect.left, oy: rect.top, moved: false, pos: null };
      const move = function (ev) {
        if (!_drag || ev.pointerId !== _drag.id) return;
        const nx = _drag.ox + (ev.clientX - _drag.sx);
        const ny = _drag.oy + (ev.clientY - _drag.sy);
        if (!_drag.moved) {
          /* 位移不到 2px 不算拖动：单击标题栏不该让窗口从居中「钉」到 left/top */
          if (Math.abs(ev.clientX - _drag.sx) < 2 && Math.abs(ev.clientY - _drag.sy) < 2) return;
          _drag.moved = true;
          el.classList.add('dwb-dragging');
        }
        const c = _clampPos({ x: nx, y: ny }, el);
        _drag.pos = c;
        el.style.transform = 'none';
        el.style.left = c.x + 'px'; el.style.top = c.y + 'px';
        ev.preventDefault();
      };
      const up = function (ev) { if (_drag && ev.pointerId === _drag.id) onDragEnd(ev); };
      _drag.move = move; _drag.up = up; _drag.head = head;
      try { head.setPointerCapture(_drag.id); } catch (err) {}
      head.addEventListener('pointermove', move);
      head.addEventListener('pointerup', up);
      head.addEventListener('pointercancel', up);
    });
    /* 双击标题栏 = 窗口最大化/还原。按钮与权限徽章上的双击不算。 */
    head.addEventListener('dblclick', function (e) {
      if (e.target && e.target.closest && e.target.closest('button, .dwb-perm, input')) return;
      _toggleMax(el);
    });
  }
  function onDragEnd(ev) {
    const d = _drag;
    if (!d) return;
    if (d.head) {
      try { if (d.head.hasPointerCapture && d.head.hasPointerCapture(d.id)) d.head.releasePointerCapture(d.id); } catch (e) {}
      d.head.removeEventListener('pointermove', d.move);
      d.head.removeEventListener('pointerup', d.up);
      d.head.removeEventListener('pointercancel', d.up);
    }
    const el = document.getElementById(PANEL_ID);
    if (el) el.classList.remove('dwb-dragging');
    _drag = null;
    if (d.moved && d.pos) { try { BF.settings.set('dslPos', d.pos); } catch (e) {} }
  }
  function ensure() {
    let el = document.getElementById(PANEL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = PANEL_ID;
    el.className = 'pk-panel dsl-console';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-label', T('title'));
    el.innerHTML =
      /* ---- 顶栏 ---- */
      '<div class="dwb-head">' +
        '<span class="dwb-logo" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg></span>' +
        '<span class="dwb-title">' + T('title') + '</span>' +
        '<div class="pk-panel__actions">' +
          '<button class="btn dwb-mode" data-dsl-mode="terminal" aria-pressed="true">' + T('modeTerminal') + '</button>' +
          '<button class="btn dwb-mode" data-dsl-mode="editor" aria-pressed="false">' + T('modeEditor') + '</button>' +
          '<span class="dwb-perm" id="dsl-perm-badge" role="button" tabindex="0" aria-label="' + escAttr(T('permAria', { lv: T('permRead') })) + '" title="' + escAttr(T('permTipRead')) + '"><i></i><b>' + T('permRead') + '</b></span>' +
          /* AI 就绪状态与 ask/chat 的对话轮数：终端里问 AI 前先在这里看得见，
             没配密钥时点它直接落到「设置 → AI 服务」，不用记路径。 */
          '<span class="dwb-perm dwb-ai" id="dsl-ai-badge" role="button" tabindex="0" aria-label="AI status"><i></i><b>AI</b></span>' +
          '<button class="btn btn-sm" data-dsl-manual title="' + escAttr(T('btnManualTip')) + '">' + T('btnManual') + '</button>' +
          '<button class="btn btn-sm primary" data-dsl-run id="dwb-runbtn" title="' + escAttr(T('btnRunTip')) + '">' + T('btnRun') + '</button>' +
          '<button class="btn btn-sm" data-dsl-save title="' + escAttr(T('btnSaveTip')) + '">' + T('btnSave') + '</button>' +
          '<button class="pk-panel__close" data-dsl-close data-panel-close aria-label="' + escAttr(T('closeAria')) + '">' + (BF.dom.ICON_CLOSE || '×') + '</button>' +
        '</div>' +
      '</div>' +
      /* ---- 主体：编辑器 + 终端（单列）----
         DSL 是终端窗口，不是应用面板：无脚本库侧栏、无模板 chips、
         无控制台 tab、无手册卡片墙。
         · 脚本管理走「扩展管理」面板（BF.modules 里可启停 / 删除）
         · 模板与示例收录在 ctx.tools.exportManual() 导出的 .md 手册
         · 清屏走 REPL 命令 clear（_clearOut 路径） */
      '<div class="dwb-body">' +
        '<section class="dwb-main">' +
          '<div class="dwb-editor">' +
            '<div class="dwb-editor__bar">' +
              '<input id="dsl-name" class="dwb-name" list="dwb-scripts" placeholder="' + escAttr(T('phScriptName')) + '" aria-label="' + escAttr(T('phScriptName')) + '"/>' +
              /* 脚本名候选：datalist 只做提示，输入新名字仍然是「新脚本」，
                 不会把同名旧脚本顶掉（save 的行为不变）。 */
              '<datalist id="dwb-scripts"></datalist>' +
              '<span class="dwb-spacer"></span>' +
            '</div>' +
            '<div class="dwb-code">' +
              '<div class="dwb-codewrap" id="dwb-codewrap">' +
                '<pre class="dwb-hl" id="dwb-hl" aria-hidden="true"><code id="dwb-hlcode"></code></pre>' +
                '<textarea id="dsl-code" class="dwb-ta" spellcheck="false" autocapitalize="off" autocomplete="off" wrap="off" placeholder="' + escAttr(T('phCode')) + '"></textarea>' +
              '</div>' +
            '</div>' +
            '<div class="dwb-status" id="dwb-status"></div>' +
          '</div>' +
          '<div class="dwb-console">' +
            '<div class="dwb-console__body">' +
              '<div class="dwb-banner">' + esc(T('banner', { ver: (BF.VERSION_DISPLAY || 'V0.0.1-alpha') })) + '</div>' +
              '<div class="dwb-log" id="dwb-log"></div>' +
              '<div class="dwb-repl" id="dwb-replrow">' +
                '<span class="dwb-ps1" aria-hidden="true">C:\\beifeng&gt;</span>' +
                '<input id="dsl-repl" aria-label="' + escAttr(T('replAria')) + '"/>' +
              '</div>' +
            '</div>' +
          '</div>' +
        '</section>' +
      '</div>';
    document.body.appendChild(el);
    /* Self-XSS 首开横幅（终端定位）：程序化建而不是写进 innerHTML ——
       隐藏态由 class 控制、文案是静态字面量无注入面，事件走面板级委托
       （data-dsl-selfxss-ok）。默认 hidden，首开时由 _maybeShowSelfXss 揭开。 */
    const _sx = document.createElement('div');
    _sx.id = 'dsl-selfxss';
    _sx.className = 'dwb-selfxss hidden';
    _sx.setAttribute('role', 'alert');
    const _sxT = document.createElement('span');
    _sxT.className = 'dwb-selfxss__t';
    _sxT.innerHTML = '<b>' + esc(T('selfXssLead')) + '</b>' + esc(T('selfXss'));
    const _sxB = document.createElement('button');
    _sxB.className = 'btn btn-sm';
    _sxB.setAttribute('data-dsl-selfxss-ok', '');
    _sxB.textContent = T('selfXssOk');
    _sx.appendChild(_sxT);
    _sx.appendChild(_sxB);
    el.insertBefore(_sx, el.firstChild);
    setMode(BF.settings.get('dslMode') === 'editor' ? 'editor' : 'terminal', false);
    _bindPanel(el);
    _wireDrag(el);
    _applyWinState(el);
    _restoreLog();
    return el;
  }

  /* ---------- Tab 参数候选 ----------
     只列「这条命令能接的那个维度」，而且全部现取真源，不在这里养副本：
     书名读书架元数据、外观读 BF.SKINS、场景读 BF.SCENES 的键。
     go 只给三个真页面 —— 路由按 #page-<名> 找 DOM，只有 home/bookshelf/reader
     三块，补出「settings」会让人跳成一片空白（设置是面板不是页）。 */
  /* 参数候选同样由命令表的 args 派生：加一条命令只写 CMDS 那一行 */
  function _argCandidates(cmd) {
    try {
      const all = (BF.dsl.CMDS || []).concat(BF.dsl.META_CMDS || []);
      const c = all.find(function (x) { return x.name === cmd && typeof x.args === 'function'; });
      if (c) { const r = c.args(); return Array.isArray(r) ? r : []; }
    } catch (e) { return []; }
    return [];
  }

  /* ---------- 面板事件：一次绑定，委托分发 ---------- */
  function _bindPanel(el) {
    el.addEventListener('click', function (e) {
      const t = e.target;
      if (!t.closest) return;
      /* Self-XSS 横幅确认：落持久 flag 并隐藏，之后不再打扰 */
      if (t.closest('[data-dsl-selfxss-ok]')) {
        _selfXssAck();
        const b = document.getElementById('dsl-selfxss');
        if (b) b.classList.add('hidden');
        return;
      }
      if (t.closest('[data-dsl-close]')) { BF.sheet.close(PANEL_ID); return; }
      if (t.closest('[data-dsl-mode]')) { setMode(t.closest('[data-dsl-mode]').getAttribute('data-dsl-mode'), true); return; }
      if (t.closest('[data-dsl-run]')) { run(); return; }
      if (t.closest('[data-dsl-save]')) { save(); return; }
      if (t.closest('[data-dsl-manual]')) {
        const r = BF.dsl.tools.exportManual();
        if (r && r.ok) _out(T('outManual', { name: r.name, chars: r.chars }), 'ok');
        return;
      }
    });
    /* 编辑器：输入 / 光标 / 滚动 */
    el.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'dsl-code') _refreshSoon();
    });
    /* 脚本名改值 → 命中同名脚本就载入它（datalist 选中或手打全名都算）。
       只挂 change 不挂 input：手打到一半刚好路过某个真名时不该被顶掉代码。 */
    el.addEventListener('change', function (e) {
      if (e.target && e.target.id === 'dsl-name') _pickScriptByName(e.target.value);
    });
    /* 校验失败条上的「跳到错误行」+ 权限徽章（renderStatus 渲染成按钮） */
    el.addEventListener('click', function (e) {
      const t = e.target;
      if (!t.closest) return;
      const b = t.closest('[data-dsl-errline]');
      if (b) { _jumpToLine(parseInt(b.getAttribute('data-dsl-errline'), 10)); return; }
      /* 只读档拒绝联网/写操作时，出口要在眼前：报错只写「输入 perm data」
         等于要求用户自己想起来去敲。徽章就是那条命令的按钮化身，
         这里只负责把命令送进去——判据、确认、TTL 一律还是 perm 那一套。 */
      if (t.closest('#dsl-perm-badge')) { _permBadgeClick(); }
      if (t.closest('#dsl-ai-badge')) { _aiBadgeClick(); }
    });
    el.addEventListener('keydown', function (e) {
      if (!(e.key === 'Enter' || e.key === ' ')) return;
      const t = e.target;
      if (!t || !t.closest || !t.closest('#dsl-perm-badge')) return;
      e.preventDefault();
      _permBadgeClick();
    });
    el.addEventListener('keydown', function (e) {
      if (!(e.key === 'Enter' || e.key === ' ')) return;
      const t = e.target;
      if (!t || !t.closest || !t.closest('#dsl-ai-badge')) return;
      e.preventDefault();
      _aiBadgeClick();
    });
    el.addEventListener('keyup', function (e) {
      if (e.target && e.target.id === 'dsl-code' && (e.key.startsWith('Arrow') || e.key === 'Home' || e.key === 'End')) _refreshSoon();
    });
    el.addEventListener('click', function (e) {
      if (e.target && e.target.id === 'dsl-code') { renderStatus(); }
    });
    /* 面板快捷键：Ctrl/Cmd+Enter 运行 · Ctrl/Cmd+S 保存 · Ctrl+C 中断 · Esc 关闭 */
    el.addEventListener('keydown', function (e) {
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key === 'Enter') { e.preventDefault(); run(); return; }
      if (mod && (e.key === 's' || e.key === 'S')) { e.preventDefault(); save(); return; }
      /* Ctrl+C = 终端的中断键。只在「面板内 + 脚本正在跑」时接管：
         输入框/文本域里有选区时先放行 —— 那是用户要复制文本，不是发信号，
         把它吃掉等于偷偷废掉面板里的复制。 */
      if (e.ctrlKey && !e.metaKey && !e.altKey && (e.key === 'c' || e.key === 'C')) {
        const tag = e.target && e.target.tagName;
        const box = (tag === 'INPUT' || tag === 'TEXTAREA') ? e.target : null;
        if (box && typeof box.selectionStart === 'number' && box.selectionStart !== box.selectionEnd) return;
        if (!_running && !(BF.dsl.chatBusy && BF.dsl.chatBusy())) return;
        e.preventDefault();
        _interrupt();
        return;
      }
      /* 这里没有 Esc 分支。面板内按 Esc 冒泡到启动区的栈兜底，
         栈顶就是本面板（刚 open 过）→ 关闭；若模态压在上面，栈顶是模态 → 关模态。
         「谁优先」由栈顺序决定，不需要在每个面板里抄一份让位判断。 */
    });
    /* 面板 Esc 不在这里处理：焦点在面板外时的关闭由启动区 escTop() 统一负责，
       一处判据即可，不在每个面板里各写一份让位判断。 */
    /* 编辑器内按键：Tab 缩进 / 回车自动缩进（滚动同步用 capture 保证先于浏览器） */
    const ta = el.querySelector('#dsl-code');
    if (ta) {
      ta.addEventListener('scroll', syncScroll);
      ta.addEventListener('keydown', function (e) {
        if (e.key === 'Tab') { e.preventDefault(); e.shiftKey ? outdentSel() : indentSel(); return; }
        if (e.key === 'Enter') { autoIndent(e); }
      });
    }
    /* REPL：回车执行 / ↑↓ 历史 / Tab 补全 / 多行转编辑器 */
    const repl = el.querySelector('#dsl-repl');
    if (repl) {
      repl.addEventListener('keydown', function (e) {
        /* 会话模式：回车把输入当消息发出去；Esc 只退会话，不关面板。
           以 ! / chat / ask / agent 开头的仍按命令执行，否则退不出会话也发不了命令。 */
        const _agentMode = !!(BF.dsl.agentState && BF.dsl.agentState().on);
        const _chatMode = !!(BF.dsl.chatState && BF.dsl.chatState().on);
        if (_agentMode || _chatMode) {
          if (e.key === 'Escape') {
            if (_agentMode) BF.dsl.agentStop(); else BF.dsl.chatStop();
            _out(_agentMode ? T('outAgentClosed') : T('outChatClosed'), 'info');
            e.preventDefault(); e.stopPropagation();
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            const q = this.value.trim();
            if (!q) { e.preventDefault(); return; }
            if (!/^(!|chat\b|ask\b|agent\b)/i.test(q)) {
              e.preventDefault();
              this.value = '';
              _out(T('youPrefix') + q, 'cmd');
              const _send = _agentMode ? BF.dsl.agentSay(q) : BF.dsl.chatSay(q);
              _send.then(function (r) { if (r) _out(r, 'ok'); }, function (err) {
                _out('error: ' + String((err && err.message) || err), 'err');
              });
              return;
            }
          }
        }
        if (e.key === 'Enter') {
          const v = this.value;
          if (/\n/.test(v)) {
            /* 多行粘贴 → 转入编辑器继续编辑 */
            const ta2 = document.getElementById('dsl-code');
            if (ta2) {
              ta2.value = ta2.value ? ta2.value.replace(/\n$/, '') + '\n' + v + '\n' : v + '\n';
              refreshEditor();
              ta2.focus();
            }
            _out('C:\\beifeng>' + v.split('\n')[0] + T('outMoved'), 'cmd');
            _hist.unshift(v); if (_hist.length > HIST_MAX) _hist.length = HIST_MAX; _histIdx = -1;
            this.value = '';
            e.preventDefault();
            return;
          }
          e.preventDefault();
          replExec(v);
        } else if (e.key === 'ArrowUp') {
          if (_hist.length) { _histIdx = Math.min(_hist.length - 1, _histIdx + 1); this.value = _hist[_histIdx] || ''; }
          e.preventDefault();
        } else if (e.key === 'ArrowDown') {
          if (_histIdx >= 0) { _histIdx--; this.value = _histIdx >= 0 ? (_hist[_histIdx] || '') : ''; }
          e.preventDefault();
        } else if (e.key === 'Tab') {
          e.preventDefault();
          const v = this.value;
          /* 两段式补全：「命令 + 空格 + 半截参数」补参数，其余补命令名。
             参数候选同样只在唯一命中时改写输入框（不补尾随空格，命令名
             候选自带的那一个照旧）；多命中列出来，无命中什么都不动 ——
             绝不能把用户已经打出来的词吞掉。 */
          const sp = v.indexOf(' ');
          if (sp > 0) {
            const head = v.slice(0, sp).toLowerCase();
            const part = v.slice(sp + 1);
            const opts = _argCandidates(head);
            if (opts.length) {
              const hits = opts.filter(function (o) { return part === '' || String(o).indexOf(part) === 0; });
              if (hits.length === 1) this.value = head + ' ' + hits[0];
              else if (hits.length > 1) _out(hits.map(function (h) { return h.trim(); }).join('   '), 'info');
              return;
            }
          }
          if (v) {
            const hits = REPL_CMDS.filter(function (c) { return c.indexOf(v) === 0; });
            if (hits.length === 1) this.value = hits[0];
            else if (hits.length > 1) _out(hits.map(function (h) { return h.trim(); }).join('   '), 'info');
          }
        }
      });
    }
  }

  /* ---------- 编辑器行为 ---------- */
  function syncScroll() {
    const ta = document.getElementById('dsl-code');
    const hl = document.getElementById('dwb-hl');
    if (!ta || !hl) return;
    hl.scrollTop = ta.scrollTop; hl.scrollLeft = ta.scrollLeft;
  }
  /* 同一次刷新里 split('\n') 至多三份 + 每击键全文重高亮。
     行表按 value 引用记忆化；input/方向键走 150ms 防抖，程序化换脚本仍同步全量。 */
  let _lnV = null, _lnCache = [];
  function _linesOf(v) { if (_lnV === v) return _lnCache; _lnV = v; _lnCache = v.split('\n'); return _lnCache; }
  let _rfT = null;
  function _refreshSoon() { if (_rfT) return; _rfT = setTimeout(function () { _rfT = null; refreshEditor(); }, 150); }
  function refreshEditor() {
    const ta = document.getElementById('dsl-code');
    const hl = document.getElementById('dwb-hlcode');
    if (!ta || !hl) return;
    hl.innerHTML = highlight(ta.value);
    syncScroll();
    renderStatus();
  }
  function renderStatus() {
    const ta = document.getElementById('dsl-code');
    const el = document.getElementById('dwb-status');
    if (!ta || !el) return;
    const before = ta.value.slice(0, ta.selectionStart);
    const ln = before.split('\n').length;
    const col = before.length - before.lastIndexOf('\n');
    let v = { ok: true, msg: '' };
    try {
      if (BF.dsl.validateScript) {
        /* 按当前权限档位校验（终端定位）：状态栏「校验通过」必须与执行拦截一致 ——
           read 档含联网调用的脚本在编辑器里就该黄条预警，而不是运行时才炸 */
        let _lv = 'read';
        try { _lv = BF.dsl.permLevel() || 'read'; } catch (e2) {}
        v = BF.dsl.validateScript(ta.value, _lv);
      }
    } catch (e) {}
    el.innerHTML =
      '<span>' + T('statusPos', { ln: '<b>' + ln + '</b>', col: '<b>' + col + '</b>' }) + '</span>' +
      '<span>' + T('statusSize', { lines: _linesOf(ta.value).length, chars: ta.value.length }) + '</span>' +
      (v.ok ? '<span class="dwb-ok">' + T('statusOk') + '</span>'
        /* 校验引擎报得出行号时，这段红字就是个能点的按钮（点了把光标丢到
           那一行行首）；报不出行号（如注释切割后位置失真）保持纯文本，
           不渲染一个点了没反应的按钮。 */
        : (v.line
          ? '<button type="button" class="dwb-errjump" data-dsl-errline="' + Number(v.line) + '" title="' + escAttr(v.msg || '') + '">⚠ ' + esc(v.msg || '') + '</button>'
          : '<span class="dwb-bad" title="' + escAttr(v.msg || '') + '">⚠ ' + esc(v.msg || '') + '</span>'));
  }
  function _mapSelLines(fn) {
    const ta = document.getElementById('dsl-code');
    if (!ta) return;
    const v = ta.value, s = ta.selectionStart, e2 = ta.selectionEnd;
    const ls = v.lastIndexOf('\n', s - 1) + 1;
    let le = v.indexOf('\n', e2); if (le < 0) le = v.length;
    const block = v.slice(ls, le).split('\n').map(fn).join('\n');
    ta.value = v.slice(0, ls) + block + v.slice(le);
    ta.selectionStart = ls; ta.selectionEnd = ls + block.length;
    refreshEditor();
  }
  function indentSel() { _mapSelLines(function (l) { return '  ' + l; }); }
  function outdentSel() { _mapSelLines(function (l) { return l.replace(/^ {1,2}/, ''); }); }
  function autoIndent(e) {
    const ta = document.getElementById('dsl-code');
    if (!ta) return;
    const s = ta.selectionStart, e2 = ta.selectionEnd;
    if (s !== e2) return;                          /* 有选区时走默认换行 */
    const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
    const curLine = ta.value.slice(lineStart, s);
    const indent = (curLine.match(/^\s*/) || [''])[0] + (/[{[(]\s*$/.test(curLine) ? '  ' : '');
    if (!indent) return;
    e.preventDefault();
    const ins = '\n' + indent;
    ta.value = ta.value.slice(0, s) + ins + ta.value.slice(e2);
    ta.selectionStart = ta.selectionEnd = s + ins.length;
    refreshEditor();
  }
  /* 校验失败 → 跳到出错那一行：光标落到行首、滚动到位、状态条行列跟着走。
     textarea 没有「滚到第 N 行」的接口，靠行号 × 行高估算 —— 代码区是
     wrap=off 的等宽单行流，一行就是一个视觉行，估算不会跑偏。 */
  function _jumpToLine(n) {
    const ta = document.getElementById('dsl-code');
    if (!ta) return;
    const total = ta.value.split('\n').length;
    const line = Math.max(1, Math.min(Math.floor(n || 1) || 1, total));
    let idx = 0;
    for (let i = 1; i < line; i++) {
      const p = ta.value.indexOf('\n', idx);
      if (p < 0) { idx = ta.value.length; break; }
      idx = p + 1;
    }
    try { ta.focus(); } catch (e) {}
    try { ta.setSelectionRange(idx, idx); } catch (e) {}
    const lh = parseFloat(window.getComputedStyle(ta).lineHeight) || 20;
    ta.scrollTop = Math.max(0, (line - 1) * lh - ta.clientHeight / 2 + lh / 2);
    syncScroll();
    /* 跳行后给一次性高亮（overlay 定位，2s 后移除；刻意不加行号 gutter） */
    try {
      const hl = document.getElementById('dwb-hl');
      if (hl) {
        const hi = document.createElement('div');
        hi.className = 'dwb-line-hi';
        hi.style.top = ((line - 1) * lh) + 'px';
        hi.style.height = lh + 'px';
        hl.appendChild(hi);
        BF.timers.timeout(function () { try { hi.remove(); } catch (e) {} }, 2000);
      }
    } catch (e) {}
    renderStatus();
    /* 按钮被点击后，浏览器的默认动作会在处理器返回之后再抢一次焦点，
       跳完行却发现焦点停在状态条上。延一拍把焦点交回代码区。 */
    setTimeout(function () { try { ta.focus(); } catch (e) {} }, 0);
  }

  /* ---------- 双模式：终端 = 纯命令行流；编辑器 = 脚本缓冲，点运行才执行 ----------
     唯一状态源是面板上的 mode-edit 类，两个按钮的 pressed 态由它派生；
     模式写入 settings.dslMode，重开原样恢复。 */
  function setMode(m, byUser) {
    const el = document.getElementById(PANEL_ID);
    if (!el) return;
    const edit = m === 'editor';
    el.classList.toggle('mode-edit', edit);
    el.querySelectorAll('[data-dsl-mode]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.getAttribute('data-dsl-mode') === (edit ? 'editor' : 'terminal')));
    });
    if (byUser) {
      try { BF.settings.set('dslMode', edit ? 'editor' : 'terminal'); } catch (e) {}
      const target = document.getElementById(edit ? 'dsl-code' : 'dsl-repl');
      if (target) { try { target.focus(); } catch (e) {} }
    }
  }
  /* ---------- 渲染 ---------- */
  function _refreshPerm() {
    const b = document.getElementById('dsl-perm-badge');
    if (!b) return;
    let lv = 'read';
    try { lv = BF.dsl.permLevel() || 'read'; } catch (e) {}
    const lvKey = lv === 'data' ? 'permData' : lv === 'secrets' ? 'permSecrets' : lv === 'full' ? 'permFull' : 'permRead';
    const tipKey = lv === 'data' ? 'permTipData' : lv === 'secrets' ? 'permTipSecrets' : lv === 'full' ? 'permTipFull' : 'permTipRead';
    b.innerHTML = '<i></i><b>' + esc(T(lvKey)) + '</b>';
    b.className = 'dwb-perm' + (lv === 'data' ? ' is-data' : (lv === 'full' ? ' is-full' : (lv === 'secrets' ? ' is-full' : '')));
    b.title = T(tipKey);
    b.setAttribute('aria-label', T('permAria', { lv: T(lvKey) }));
  }
  /* 徽章即「perm」的入口：只读档直接问要不要升到 data，已提权则展开档位列表。
     不在此处判定任何权限——execute 走的就是命令行那条路径，确认框与 TTL 都在 perm 里。 */
  function _permBadgeClick() {
    let lv = 'read';
    try { lv = BF.dsl.permLevel() || 'read'; } catch (e) {}
    replExec(lv === 'read' ? 'perm data' : 'perm');
  }
  /* AI 状态徽章：问 AI 之前先看得见「能不能问」，以及会话开没开、几轮了。
     没配密钥时点它 = 落到设置 → AI 服务；配好了点它 = 进出会话模式（chat）。
     判据不在这里 —— hasKey / chatState / chat 各自还是唯一来源。 */
  function _refreshAi() {
    const b = document.getElementById('dsl-ai-badge');
    if (!b) return;
    let has = false, prov = '', st = { on: false, turns: 0 }, ag = { on: false, turns: 0 };
    try { has = !!BF.ai.hasKey(); } catch (e) {}
    try { prov = (BF.ai.currentProvider() || {}).id || ''; } catch (e) {}
    try { if (BF.dsl.chatState) st = BF.dsl.chatState() || st; } catch (e) {}
    try { if (BF.dsl.agentState) ag = BF.dsl.agentState() || ag; } catch (e) {}
    let txt, cls, title;
    if (!has) {
      txt = T('aiOff'); cls = ' dwb-ai-off';
      title = T('aiTipOff');
    } else if (ag.on) {
      txt = T('aiAgent', { n: ag.turns }); cls = ' is-data';
      title = T('aiTipAgent');
    } else if (st.on) {
      txt = T('aiChat', { n: st.turns }); cls = ' is-data';
      title = T('aiTipChat');
    } else {
      txt = T('aiReady', { prov: prov || T('aiReadyWord') }); cls = '';
      title = T('aiTipReady');
    }
    b.innerHTML = '<i></i><b>' + BF.dom.esc(txt) + '</b>';
    b.className = 'dwb-perm dwb-ai' + cls;
    b.title = title;
    b.setAttribute('aria-label', title);
  }
  function _aiBadgeClick() {
    let has = false;
    try { has = !!BF.ai.hasKey(); } catch (e) {}
    if (!has) { try { BF.settingsUI.open('ai'); } catch (e) { BF.err.report('dsl.aiBadge.openSettings', e); } return; }
    replExec('chat');
  }
  /* 脚本名候选（编辑器标题条的 datalist）：每次 render 重建。
     无名脚本（只有 id 的旧数据）不进候选 —— 选中它填进输入框，
     之后 save 会写回那个 id，等于用空名字盖掉旧记录。 */
  function _renderScriptOptions() {
    const dl = document.getElementById('dwb-scripts');
    if (!dl) return;
    let list = [];
    try { list = BF.dsl.listScripts() || []; } catch (e) { list = []; }
    dl.innerHTML = list.filter(function (s) { return s && s.name; })
      .map(function (s) { return '<option value="' + escAttr(s.name) + '"></option>'; })
      .join('');
  }
  /* 名字改值时载入同名脚本。「恰好等于」是硬要求：模糊匹配会让人以为
     切过去了，实际改的仍是 _cur 那个脚本。已经是当前脚本时不重灌 ——
     未保存的编辑会被存档代码盖掉。 */
  function _pickScriptByName(rawName) {
    const nm = String(rawName == null ? '' : rawName).trim();
    if (!nm) return false;
    let list = [];
    try { list = BF.dsl.listScripts() || []; } catch (e) { return false; }
    const sc = list.filter(function (s) { return s && s.name === nm; })[0];
    if (!sc || sc.id === _cur) return false;
    _cur = sc.id;
    const codeEl = document.getElementById('dsl-code');
    if (codeEl) codeEl.value = sc.code || '';
    refreshEditor();
    _renderScriptOptions();
    _out(T('outLoaded', { name: (sc.name || sc.id), inactive: sc.active ? '' : T('outInactive') }), 'head');
    return true;
  }
  /* ---------- 渲染 ----------
     刷新编辑器 + 输出流 + 脚本名候选 + 权限徽章 —— 终端没有列表、没有 tab。
     _cur 是当前脚本 id：保存时仍需写入对应 BF.dsl 记录，
     但没有"切换脚本"动作（脚本库管理走「扩展管理」面板，
     同名切换由脚本名输入框的 datalist 承担，见 _pickScriptByName）。 */
  function render() {
    const el = document.getElementById(PANEL_ID);
    if (!el) return;
    if (!_cur) {
      const scripts = BF.dsl.listScripts();
      if (scripts.length) {
        _cur = scripts[0].id;
        const sc = scripts[0];
        const nameEl = document.getElementById('dsl-name');
        const codeEl = document.getElementById('dsl-code');
        if (nameEl) nameEl.value = sc.name || '';
        if (codeEl) codeEl.value = sc.code || '';
        _out(T('outLoaded', { name: (sc.name || _cur), inactive: sc.active ? '' : T('outInactive') }), 'head');
      }
    }
    refreshEditor();
    renderLog();
    _renderScriptOptions();
    _refreshPerm();
    _refreshAi();
    _refreshPrompt();
  }

  /* save：写 BF.dsl + syncCommands + 提示；
     首次保存（无 _cur）自动建一个以输入框值为名的脚本 */
  function save() {
    if (!_cur) { _cur = 'sc_' + Date.now(); }
    const nameEl = document.getElementById('dsl-name');
    const codeEl = document.getElementById('dsl-code');
    const sc = BF.dsl.getScript(_cur) || { id: _cur, active: true };
    sc.name = (nameEl && nameEl.value.trim()) || sc.id;
    sc.code = (codeEl && codeEl.value) || '';
    sc._up = Date.now();
    BF.dsl.saveScript(sc);
    BF.dsl.syncCommands();
    BF.noti && BF.noti.success('已保存脚本：' + sc.name);
  }

  /* 脚本管理（新建/复制/删除/启停）由「扩展管理」面板承担，DSL 面板不重复提供。 */

  /* ---------- 运行 / REPL ---------- */
  function updateRunBtn() {
    const b = document.getElementById('dwb-runbtn');
    if (!b) return;
    b.textContent = _running ? T('btnRunning') : T('btnRun');
    b.disabled = _running;
  }
  function run() {
    const codeEl = document.getElementById('dsl-code');
    if (!codeEl || _running) return;
    const code = codeEl.value;
    /* 有选区 → 只跑选中的那几行（「跑到哪看到哪」的终端用法）。
       片段照旧按脚本执行：script:true 才有末值包装，选中一段表达式
       点运行也能拿到返回值。无选区行为不变。 */
    const s0 = codeEl.selectionStart, s1 = codeEl.selectionEnd;
    const sel = (typeof s0 === 'number' && typeof s1 === 'number' && s0 !== s1) ? code.slice(s0, s1) : '';
    const useSel = !!sel && !!sel.trim();
    const body = useSel ? sel : code;
    if (!body.trim()) return;
    const name = (document.getElementById('dsl-name') && document.getElementById('dsl-name').value.trim()) || _cur || '未命名';
    _running = true;
    updateRunBtn();
    _out(useSel ? T('outRunSel', { n: sel.split('\n').length }) : T('outRun', { name: name }), 'cmd');
    const t0 = Date.now();
    BF.dsl.execute(body, { name: name, script: true, print: function (msg) { _out(msg, 'info'); } }).then(async function (r) {
      _running = false;
      updateRunBtn();
      try { _refreshPerm(); _refreshAi(); } catch (e) {}
      const ms = Date.now() - t0;
      if (r === '' || r === undefined || r === null) { _out(T('outDone', { ms: ms }), 'ok'); return; }
      const s = await _fmtResult(r);
      if ((BF.dsl.lastError && BF.dsl.lastError.ok === false) || (typeof r === 'string' && /错误|失败|异常|拒绝/.test(r))) _out(s, 'err');
      else _out(s + '   （' + ms + 'ms）', 'ok');
    }, function (e) {
      _running = false;
      updateRunBtn();
      _out(T('errPrefix') + String(e && e.message || e), 'err');
    });
  }
  /* Ctrl+C：jobs 里 kind==='io' 的网络活、AI 请求、工作线程脚本可中止；
     主线程脚本无抢占点，仍按预算自行跑完。 */
  function _interrupt() {
    let targets = [];
    try {
      targets = (BF.jobs.list() || []).filter(function (j) {
        return j && j.status === 'run' && (j.kind === 'io' || String(j.label || '').indexOf('AI ·') === 0);
      });
    } catch (e) { targets = []; }
    for (let i = 0; i < targets.length; i++) {
      try { BF.jobs.abort(targets[i].id); } catch (e) {}
    }
    const chatStopped = !!(BF.dsl.chatAbort && BF.dsl.chatAbort());
    const scriptStopped = !!(BF.dsl.abortWorker && BF.dsl.abortWorker('脚本已被 ^C 终止'));
    const n = targets.length + (chatStopped ? 1 : 0);
    const acts = [];
    if (scriptStopped) acts.push('脚本已终止');
    if (n) acts.push('中断 ' + n + ' 个网络任务' + (chatStopped ? '，含本轮对话' : ''));
    if (!scriptStopped && _running) acts.push('主线程脚本无法抢占，会自行跑完');
    _out(acts.length ? '^C ' + acts.join('；') : '^C 当前无可中断任务', (scriptStopped || n) ? 'warn' : 'info');
  }
  function replExec(line) {
    const repl = document.getElementById('dsl-repl');
    const v = String(line == null ? (repl ? repl.value : '') : line).trim();
    if (!v) return;
    /* 回显与 dsl_log 持久化同源 —— 明文敲进来的密钥若原样回显，
       会随 200 行终端缓冲落盘，只读档脚本 lsRead('dsl_log') 即可取回。
       回显前把 key 命令的值段掩掉（命令本身仍按原文执行，历史仍在内存 _hist）。 */
    const _echo = /^(\s*key\s+(?:ai|mimo)\s+)\S+/.test(v)
      ? v.replace(/^(\s*key\s+(?:ai|mimo)\s+)\S+/, '$1***')
      : v;
    _out(_promptText() + _echo, 'cmd');
    _hist.unshift(v); if (_hist.length > HIST_MAX) _hist.length = HIST_MAX; _histIdx = -1;
    if (repl) repl.value = '';
    BF.dsl.execute(v, { print: function (msg) { _out(msg, 'info'); } }).then(async function (r) {
      try { _refreshPerm(); _refreshAi(); } catch (e) {}
      try { _refreshPrompt(); } catch (e) {}
      /* clear 返回的 meta-clear 在这里落成真正清屏，不回显对象 */
      if (r && typeof r === 'object' && r.type === 'meta-clear') { _clearOut(); return; }
      if (r === '' || r === undefined || r === null) return;
      const s = await _fmtResult(r);
      if ((BF.dsl.lastError && BF.dsl.lastError.ok === false) || (typeof r === 'string' && /错误|失败|异常|拒绝/.test(r))) _out(s, 'err');
      else _out(s, 'ok');
    }, function (e) {
      _out(T('errPrefix') + String(e && e.message || e), 'err');
    });
  }

  /* ---------- 导入 / 导出 ----------
     面板内没有导入导出按钮：脚本批量备份走 BF.bk.exportWithAsk()
     （见 .md 手册）；DSL 面板层不替用户猜「哪些是密钥」。 */

  /* ---------- API 手册 ----------
     全部 ctx.* / BF.* 白名单文档都集中在 ctx.tools.exportManual() 导出的
     .md 手册里（顶栏「手册」按钮导出，可发给 AI 或协作者照抄）。
     唯一实现原则：手册只维护一份，不在 DSL 面板里另开页面重复展示。 */

  /* ---------- Self-XSS 首开横幅（终端定位边界之一） ---------- */
  /* 确认flag持久化在 BF.store；读失败视为「已见」——存储坏掉时不该每次
     打开都弹（横幅是提醒不是闸门，真闸门是权限档位 + _secretGate）。 */
  const SELFXSS_KEY = 'dsl_selfxss_ack';
  function _selfXssSeen() {
    try { return !!BF.store.lsGet(SELFXSS_KEY, ''); } catch (e) { return true; }
  }
  function _selfXssAck() { try { BF.store.lsSet(SELFXSS_KEY, '1'); } catch (e) { BF.log && BF.log.warn('storage.安全确认写入失败：' + (e && e.message)); } }
  function _maybeShowSelfXss() {
    if (_selfXssSeen()) return;
    const b = document.getElementById('dsl-selfxss');
    if (b) b.classList.remove('hidden');
  }

  /* ---------- 开关 ---------- */
  function toggle() {
    const el = ensure();
    render();
    /* 落点/整屏态每次开窗都按存档重摆一遍：面板节点是常驻的（ensure 只建
       一次），期间设置可能被备份导入或别的入口改过。 */
    _applyWinState(el);
    /* 打开后聚焦编辑器；更多菜单/热键/AI 联动共用这一个入口 */
    const nowOpen = BF.sheet.toggle(PANEL_ID);
    if (nowOpen) {
      _maybeShowSelfXss();
      const edit = BF.settings.get('dslMode') === 'editor';
      setMode(edit ? 'editor' : 'terminal', false);
      /* 打开后聚焦当前模式的主输入位：编辑器模式聚焦代码区，终端模式聚焦命令行。
         用定时器不用 rAF：窗口被遮挡／节流时 rAF 不回调，聚焦就整条丢掉。 */
      BF.timers.timeout(function () {
        const ta = document.getElementById(edit ? 'dsl-code' : 'dsl-repl');
        if (ta) { try { ta.focus(); } catch (e) {} }
      }, 0);
    }
  }

  /* 切语言：只改已有节点的文字，不重建面板——日志、在途会话、滚动位置都保住。 */
  function applyLang() {
    const el = document.getElementById(PANEL_ID);
    if (!el) return;
    el.setAttribute('aria-label', T('title'));
    const set = function (sel, text) { const n = el.querySelector(sel); if (n) n.textContent = text; };
    const attr = function (sel, name, val) { const n = el.querySelector(sel); if (n) n.setAttribute(name, val); };
    set('.dwb-title', T('title'));
    set('[data-dsl-mode="terminal"]', T('modeTerminal'));
    set('[data-dsl-mode="editor"]', T('modeEditor'));
    set('[data-dsl-manual]', T('btnManual'));
    attr('[data-dsl-manual]', 'title', T('btnManualTip'));
    set('[data-dsl-save]', T('btnSave'));
    attr('[data-dsl-save]', 'title', T('btnSaveTip'));
    attr('#dwb-runbtn', 'title', T('btnRunTip'));
    attr('[data-dsl-close]', 'aria-label', T('closeAria'));
    attr('#dsl-name', 'placeholder', T('phScriptName'));
    attr('#dsl-name', 'aria-label', T('phScriptName'));
    attr('#dsl-code', 'placeholder', T('phCode'));
    attr('#dsl-repl', 'aria-label', T('replAria'));
    const bn = el.querySelector('.dwb-banner');
    if (bn) bn.textContent = T('banner', { ver: (BF.VERSION_DISPLAY || 'V0.0.1-alpha') });
    const sx = el.querySelector('#dsl-selfxss');
    if (sx) {
      const st = sx.querySelector('.dwb-selfxss__t');
      if (st) st.innerHTML = '<b>' + esc(T('selfXssLead')) + '</b>' + esc(T('selfXss'));
      const sb = sx.querySelector('[data-dsl-selfxss-ok]');
      if (sb) sb.textContent = T('selfXssOk');
    }
    updateRunBtn();
    renderStatus();
    _refreshPrompt();
    _refreshPerm();
    _refreshAi();
    _setChatMode(!!(BF.dsl.chatState && BF.dsl.chatState().on) || !!(BF.dsl.agentState && BF.dsl.agentState().on));
  }

  /* DSL 手册内容只在 ctx.tools.exportManual() 导出的 .md 里维护一份，
     顶栏「手册」按钮导出；BF.dslUI 内不再有手册视图。 */

  /* 自由文本脱敏的唯一实现就在这里，导出隔离区等外部调用点用它，
     不另写第二份掩码——两份掩码迟早会漂移成"一处过、一处漏"。 */
  BF._scrubForDisk = _scrubForDisk;
  return { toggle, run, render, setMode, applyLang: applyLang, _out: _out, _clearOut: _clearOut };
})();

