/* ================= 运维台 =================
   围绕「出问题时能查、能救」组织，复用既有设施：
     概览 —— 数据统计 + 健康度 + 异常快查
     日志 —— 搜索 / 级别筛选 / 折叠 / 最大化 / 清空
     存储 —— 分区占用明细 + 能力检测 + 备份管理
     进程 —— 进行中任务 / Worker 池 / 内核服务 / 启动时序
     工具 —— 修复 / 备份 / 导出 / 清缓存 / 快捷键表
   命名空间：留在 BF.diag 内部（不要挂 BF.ui，会被整体赋值抹掉）。
   横切设施（BF.jobs / BF.trace / BF.caps）挂在顶层，同样避开了 BF.ui。 */
BF.diag = (function () {
  const TABS = [
    { id: 'overview', label: '概览', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"></polyline></svg>' },
    { id: 'logs', label: '日志', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>' },
    { id: 'storage', label: '存储', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>' },
    { id: 'runtime', label: '进程', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>' },
    { id: 'tools', label: '工具', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>' },
  ];
  /* 页签图标与底部按钮图标（纯视觉，data-* 契约不变） */
  const ICON_FIX = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path></svg>';
  const ICON_BASE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path><polyline points="9 22 9 12 15 12 15 22"></polyline></svg>';
  /* 日志区保留条数：条数太少时，刚发生的异常会被更早的 info 挤出窗口 */
  const LOG_KEEP = 200;
  /* 状态：跨 render 保留（切 tab / 重新渲染不该丢搜索词与筛选） */
  const S = { tab: 'overview', q: '', lv: { info: true, warn: true, error: true }, max: false, logOpen: true };
  /* F-07：健康胶囊刷新抽成一处，诊断 render 与工作台 render 共用——
     原来只有诊断页渲染时刷，工作台停在「数据/统计」栏时胶囊永远挂在「检测中…」。 */
  function paintHealth() {
    const pill = document.getElementById('diag-health');
    if (!pill) return;
    let h = null;
    try { h = BF.err && BF.err.health ? BF.err.health() : null; } catch (e) {}
    const lv = (h && h.level) || 'ok';
    const span = pill.querySelector('span');
    if (span) span.textContent = lv === 'bad' ? ('异常 ' + (h.count || 0) + ' 次') : (lv === 'warn' ? ('需关注 ' + (h.count || 0) + ' 次') : '系统正常');
    pill.classList.toggle('is-warn', lv === 'warn');
    pill.classList.toggle('is-bad', lv === 'bad');
  }
  /* 「日志」「运行时」是工作台顶级栏，
     诊断栏内只有概览 / 存储 / 工具三个子页（SUBS）。
     _sub 记忆诊断栏内最后停留的子页——从日志 / 进程栏
     切回诊断栏时复原，不至于每次都被打回概览。 */
  const SUBS = TABS.filter(function (t) { return t.id !== 'logs' && t.id !== 'runtime'; });
  let _sub = 'overview';

  function esc(s) { return BF.dom.esc(s); }
  function fmtMs(ms) {
    if (ms == null || isNaN(ms)) return '—';
    if (ms < 1000) return Math.round(ms) + ' ms';
    return (ms / 1000).toFixed(2) + ' s';
  }
  function fmtBytes(n) { return BF.util.fmtBytes(n); }
  function hhmmss(t) {
    try { return new Date(t).toLocaleTimeString('zh-CN', { hour12: false }); } catch (e) { return '--:--:--'; }
  }
  function card(v, k, tone) {
    return '<div class="pane-card' + (tone ? ' is-' + tone : '') + '"><div class="pane-card__v">' + esc(v) + '</div><div class="pane-card__k">' + esc(k) + '</div></div>';
  }
  function dot(tone) { return '<span class="pane-dot' + (tone ? ' is-' + tone : '') + '"></span>'; }

  /* ============ 面板骨架 ============
     运维台不自建浮窗——骨架与栏导航由
     BF.workbench 提供（头部健康胶囊 / 版本胶囊随栏保留，
     footer 的「数据修复」「打开基地」由工作台底栏以
     data-diag-t / data-diag-gobase 委托承担，图标经
     ICON_FIX / ICON_BASE 导出保持单源）。此处只保留
     「打开」语义：日志 / 进程直达工作台对应顶级栏，
     其余子页（概览 / 存储 / 工具）进「诊断」栏。 */
  function open(tab) {
    if (tab) S.tab = tab;
    if (S.tab !== 'logs' && S.tab !== 'runtime') _sub = S.tab;
    if (S.tab === 'logs' || S.tab === 'runtime') BF.workbench.open(S.tab);
    else BF.workbench.open('diag');
  }
  /* 入口是切换。运维台本身已是工作台的一栏，
     关不关要看工作台正显示哪一栏 —— 判据用 workbench.toggle，不在这里另算一份。 */
  function toggle(tab) {
    const t = tab || S.tab;
    const sec = (t === 'logs' || t === 'runtime') ? t : 'diag';
    if (BF.sheet.closable(BF.workbench.PANEL_ID, sec)) { BF.sheet.close(BF.workbench.PANEL_ID); return false; }
    open(tab); return true;   /* 走 open() 才保留子页 _sub 的记账 */
  }

  /* ============ 数据收集（与渲染分离，便于只重画当前 tab） ============ */
  function collectOverview() {
    const daily = BF.store.lsGet(BF.store.K.DAILY, {}) || {};
    const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || [];
    const hls = BF.store.lsGetArray(BF.store.K.HIGHLIGHTS, []) || [];
    const bms = BF.store.lsGetArray(BF.store.K.BOOKMARKS, []);
    const vocab = BF.store.lsGetArray(BF.store.K.VOCAB, []);
    const notes = BF.store.lsGetArray(BF.store.K.NOTES, []);
    const backups = BF.bk.list() || [];
    const perfS = BF.perf.snapshot();
    const hz = (BF.err && BF.err.health) ? BF.err.health() : null;
    const errs = BF.err && BF.err.recent ? BF.err.recent(8).reverse() : [];
    return { daily: daily, books: books, hls: hls, bms: bms, vocab: vocab, notes: notes, backups: backups, perfS: perfS, hz: hz, errs: errs };
  }

  /* ============ 视图 1：概览 ============ */
  function viewOverview(d) {
    const hz = d.hz;
    const hzTone = !hz ? null : (hz.level === 'bad' ? 'bad' : hz.level === 'warn' ? 'warn' : 'ok');
    const hzText = !hz ? '—' : (hz.level === 'bad' ? '异常偏多' : hz.level === 'warn' ? '轻度波动' : '正常');
    /* 数据统计卡收进基地：两处各渲染一遍同样的 6 张卡既是重复劳动，
       又注定漂移 —— base 加了「总字数」而 diag 没加，就会出现
       「两个面板数字不一样」。 */
    let h = '<div class="pane-cards">' +
      card(d.perfS.fps || '—', 'FPS') +
      card((d.perfS.longTasks || []).length, '长任务', (d.perfS.longTasks || []).length > 2 ? 'warn' : 'ok') +
      card(d.perfS.mem || '—', '内存') +
      card(d.backups.length, '自动备份', d.backups.length ? null : 'warn') +
      '</div>';
    h += '<div class="pane-hint">数据统计（书籍、字数、笔记等）在<b>基地</b>查看，两处不再各算一份。</div>';

    h += '<div class="pane-sec pane-sec-gap">进程守护' +
      '<span class="pane-sec__act"></span></div>';
    h += '<div class="pane-rows">' +
      '<div class="pane-row">' + dot(hzTone === 'bad' ? 'bad' : hzTone === 'warn' ? 'warn' : 'ok') +
      '<span class="pane-row__k">健康度</span><span class="pane-row__v">10 分钟内 <b>' + (hz ? hz.count : 0) + '</b> 次异常（阈值 ' + (BF.err.HEALTH_RATE || 20) + '）</span>' +
      '<span class="pane-card__v" style="font-size:13px;color:var(--' + (hzTone || 'text') + ')">' + esc(hzText) + '</span></div>' +
      '<div class="pane-row">' + dot((BF.err.count() || 0) > 0 ? 'warn' : 'ok') +
      '<span class="pane-row__k">已捕获</span><span class="pane-row__v">' + (BF.err.count ? BF.err.count() : 0) + ' 次异常' +
      (BF.err.lastHeal && BF.err.lastHeal() ? ' · 上次自愈 ' + hhmmss(BF.err.lastHeal()) : ' · 尚未触发自愈') + '</span></div>' +
      '<div class="pane-row">' + dot((BF.timers.count() || 0) > 40 ? 'warn' : 'ok') +
      '<span class="pane-row__k">定时器</span><span class="pane-row__v">' + (BF.timers.count ? BF.timers.count() : 0) + ' 个（正常 &lt; 15）</span></div>' +
      '<div class="pane-row">' + dot((BF.bus.health() || 0) > 200 ? 'warn' : 'ok') +
      '<span class="pane-row__k">事件监听</span><span class="pane-row__v">' + (BF.bus.health ? BF.bus.health() : 0) + ' 个</span></div>' +
      '<div class="pane-row">' + dot('ok') +
      '<span class="pane-row__k">版本</span><span class="pane-row__v is-mono">北风 V' + esc(BF.version) + '</span></div>' +
      '</div>';

    /* 最近异常：出问题时第一眼要看的就是它，所以放概览而不是只留在日志区 */
    h += '<div class="pane-sec pane-sec-gap">最近异常' +
      '<span class="pane-sec__act"><button class="btn btn-xs" data-diag-tabgo="logs">查看全部日志</button></span></div>';
    h += d.errs.length
      ? '<div class="pane-rows">' + d.errs.map(function (r) {
          /* stack 进 title 悬浮提示——只存 message 时「undefined 的
             属性」这类错在运维台里查不出出处，悬停可见调用栈。 */
          return '<div class="pane-row">' + dot('bad') +
            '<span class="pane-row__k is-mono" style="width:auto;color:var(--text-weak)">' + hhmmss(r.t) + '</span>' +
            '<span class="pane-row__v is-mono" title="' + esc(r.ctx + (r.stack ? '\n' + r.stack : '')) + '">' + esc(r.msg) + '</span></div>';
        }).join('') + '</div>'
      : '<div class="pane-empty">暂无异常</div>';
    return h;
  }

  /* ============ 视图 2：日志 ============ */
  function viewLogs() {
    let logs = BF.log.list();
    const all = logs.length;
    logs = logs.slice(-LOG_KEEP);
    /* 级别计数基于完整缓冲，展示基于截断后的窗口 —— 否则计数会和列表对不上 */
    const cnt = { info: 0, warn: 0, error: 0 };
    logs.forEach(function (l) { if (cnt[l.lvl] != null) cnt[l.lvl]++; });
    const q = S.q.trim();
    let shown = logs.filter(function (l) {
      if (!S.lv[l.lvl]) return false;
      if (q && String(l.msg).toLowerCase().indexOf(q.toLowerCase()) < 0) return false;
      return true;
    });

    const LVCN = { info: '信息', warn: '警告', error: '错误' };
    let h = '<div class="pane-rows" style="overflow:hidden">' +
      '<div class="diag-logbar">' +
      '<input type="search" data-diag-logq placeholder="搜索日志内容…" value="' + esc(q) + '" aria-label="搜索日志">' +
      ['info', 'warn', 'error'].map(function (lv) {
        return '<button class="diag-lv diag-lv--' + lv + '" data-diag-lv="' + lv + '" aria-pressed="' + (S.lv[lv] ? 'true' : 'false') + '">' +
          esc(LVCN[lv]) + '<span class="diag-lv__n">' + cnt[lv] + '</span></button>';
      }).join('') +
      '<span class="pane-tab__n" style="margin-left:auto">' + shown.length + ' / ' + all + '</span>' +
      '<button class="btn btn-xs" data-diag-logmax>' + (S.max ? '还原' : '最大化') + '</button>' +
      '<button class="btn btn-xs" data-diag-logclear>清空</button>' +
      '</div>';

    /* 高亮正则随查询串编译一次——写进 shown.map 里就是每行重建（200 行=200 次） */
    const _hlRe = (function () { try { return q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi') : null; } catch (e) { return null; } })();
    h += shown.length
      ? '<div class="diag-logbox' + (S.max ? ' is-max' : '') + '" data-diag-logbox>' + shown.map(function (l) {
          /* 搜索命中高亮：转义后再插<mark>，顺序不能反（先插标签再转义会把标签也转义掉） */
          let msg = esc(l.msg);
          if (_hlRe) { try { msg = msg.replace(_hlRe, function (mm) { return '<mark>' + mm + '</mark>'; }); } catch (e) {} }
          return '<div class="diag-logline diag-logline--' + esc(l.lvl) + '">' +
            '<span class="diag-logline__t">' + hhmmss(l.t) + '</span>' +
            '<span class="diag-logline__l">' + esc(l.lvl.toUpperCase()) + '</span>' +
            '<span class="diag-logline__m">' + msg + '</span></div>';
        }).join('') + '</div>'
      : '<div class="pane-empty">' + (all ? '没有符合条件的日志' : '暂无日志') + '</div>';
    h += '</div>';
    /* 必须显式说明 info 为 0 的原因：BF.log.info 受设置项 captureLog 控制（默认关），
       不写清楚，用户看到「信息 0 条」会以为日志面板坏了。 */
    const captureOn = BF.settings && BF.settings.get ? !!BF.settings.get('captureLog') : false;
    h += '<div class="pane-hint">环形缓冲上限 ' + LOG_KEEP + ' 条 · 缓冲总量 ' + all + ' 条。' +
      '<code>warn</code> 与 <code>error</code> 始终记录；' +
      (captureOn
        ? '<code>info</code> 已在设置中开启记录。'
        : '<code>info</code> 当前<b>未开启</b>记录，所以「信息」一栏为 0 属正常。' +
          '<button class="btn btn-xs" data-diag-opencap style="margin-left:6px">去开启</button>') +
      '</div>';
    return h;
  }

  /* ============ 视图 3：存储 ============ */
  /* 占用与配额的计算统一由 BF.store.usage() 单点承担，diag 与 base 两边共享。 */
  function viewStorage() {
    const u = BF.store.usage();
    let h = '<div class="pane-sec">占用明细' +
      '<span class="pane-sec__act"><button class="btn btn-xs" data-diag-gobase>在基地中管理</button></span></div>';
    /* 用户真正的问题是「哪一项占的」，总数回答不了 */
    let lsRows;
    if (u.failed) lsRows = '<div class="pane-empty">localStorage 不可读</div>';
    else if (!u.rows.length) lsRows = '<div class="pane-empty">无本地数据</div>';
    else lsRows = u.rows.slice(0, 8).map(function (x) {
      return '<div class="pane-row"><span class="pane-row__k is-mono">' + esc('bf_' + x.key) + '</span>' +
        '<span class="pane-row__v" style="flex:0 0 76px;text-align:right">' + fmtBytes(x.bytes) + '</span></div>';
    }).join('');
    h += '<div class="pane-rows"><div class="pane-row pane-row--head"><span class="pane-row__k">键</span><span class="pane-row__v" style="flex:0 0 76px;text-align:right">大小</span></div>' + lsRows + '</div>';
    h += '<div class="pane-hint">已排除自动备份与运行日志（合计 ' + fmtBytes(u.skippedTotal) + '）。完整明细在基地。</div>';

    h += '<div class="pane-sec pane-sec-gap">浏览器配额</div>';
    h += '<div class="pane-rows" id="diag-quota"><div class="pane-empty">读取中…</div></div>';

    h += '<div class="pane-sec pane-sec-gap">能力检测' +
      '<span class="pane-sec__act"><button class="btn btn-xs" data-diag-caps>刷新</button></span></div>';
    const caps = (BF.caps && BF.caps.summary) ? BF.caps.summary() : { ok: 0, total: 0, list: [] };
    /* 运行健康并入能力检测区顶部。health() 的真实返回：
       { count, windowMs, rate, level, lastWarn }，level 取值域仅 'bad' | 'warn' | 'ok'
       （正常路径的三元与 catch 分支都只返回这三种）。故此处只判这三种，
       未知值一律落回 'ok'，不会渲染出既没有样式也没有文案的状态。 */
    const _hz2 = (BF.err && BF.err.health) ? BF.err.health() : null;
    const _hzTone = !_hz2 ? 'ok' : (_hz2.level === 'bad' ? 'bad' : _hz2.level === 'warn' ? 'warn' : 'ok');
    const _hzText = !_hz2 ? '—' : (_hz2.level === 'bad' ? '异常偏多（见日志）' : _hz2.level === 'warn' ? '轻度波动' : '正常');
    h += '<div class="pane-rows">' +
      '<div class="pane-row">' + dot(_hzTone) +
      '<span class="pane-row__k">运行健康</span>' +
      '<span class="pane-row__v" style="color:var(--text-weak)">近 ' + (_hz2 ? Math.round((_hz2.windowMs || 0) / 60000) : 0) + ' 分钟 ' +
      (_hz2 ? _hz2.count : 0) + ' 次异常</span>' +
      '<span class="pane-card__v" style="font-size:13px;color:var(--' + _hzTone + ')">' + esc(_hzText) + '</span></div>' +
      (caps.list.length ? caps.list.map(function (c) {
        return '<div class="pane-row">' + dot(c.ok ? 'ok' : 'warn') +
          '<span class="pane-row__k">' + esc(c.label) + '</span>' +
          '<span class="pane-row__v" style="color:var(--text-weak)">' + esc(c.detail || '') + '</span></div>';
      }).join('') : '<div class="pane-empty">探测失败</div>') + '</div>';
    h += '<div class="pane-hint">可用 ' + caps.ok + ' / ' + caps.total + ' 项。' +
      (caps.degraded ? '标黄项在当前访问方式下不可用，通常有降级路径，不影响基本阅读。' : '全部可用。') + '</div>';

    /* 自动备份的完整管理（恢复/删除/导出/导入）已独立到 BF.base。
       这里只留一个入口 + 份数提示，不重复渲染一套备份列表 ——
       两处各渲染一次意味着用户删了一份、另一处还显示着。 */
    h += '<div class="pane-sec pane-sec-gap">自动备份' +
      '<span class="pane-sec__act"><button class="btn btn-xs" data-diag-gobase="backup">打开基地</button></span></div>';
    const backups = BF.bk.list() || [];
    h += '<div class="pane-rows"><div class="pane-row">' +
      dot(backups.length ? 'ok' : 'warn') +
      '<span class="pane-row__k" style="width:auto;flex:1">现有 ' + backups.length + ' 份（上限 ' + (BF.CONFIG.BACKUP_MAX || 5) + ' 份）</span>' +
      '<span class="pane-row__v" style="flex:0 0 auto;color:var(--text-weak)">' +
      (backups.length ? new Date(backups[0].at).toLocaleString('zh-CN') : '尚未备份，数据无法恢复') +
      '</span></div></div>';
    return h;
  }

  /* ============ 视图 4：进程 ============ */
  function viewRuntime() {
    /* 这里用 BF.jobs.count()：视图各处若各用自己的算法（jobs.length / stuck.length），
       「进行中任务」的读数就和下面的列表对不上。count 与 BF.jobs 的
       内部 _m.size 是同一份，不会出现两处数字打架。 */
    const jobCount = (BF.jobs && BF.jobs.count) ? BF.jobs.count() : 0;
    let h = '<div class="pane-sec">进行中任务' +
      '<span class="pane-sec__act"><span style="font-size:11px;color:var(--text-weak)">' +
      (jobCount ? jobCount + ' 个进行中' : '空闲') + '</span>' +
      '<button class="btn btn-xs" data-diag-jobs>刷新</button></span></div>';
    const jobs = (BF.jobs && BF.jobs.list) ? BF.jobs.list() : [];
    const stuck = (BF.jobs && BF.jobs.stuck) ? BF.jobs.stuck(10000) : [];
    /* stuck 与 jobs 是两次独立调用生成的不同对象，引用比较永远 false，
       必须按任务 id 匹配。 */
    const stuckIds = new Set((stuck || []).map(function (s) { return s && s.id; }).filter(Boolean));
    h += jobs.length ? '<div class="pane-rows">' + jobs.map(function (j) {
        const isStuck = stuckIds.has(j.id);
        const st = j.status || 'run';
        const stDot = st === 'fail' ? 'bad' : (st === 'aborted' ? 'warn' : (isStuck ? 'bad' : 'ok'));
        const stLabel = st === 'fail' ? '失败' : (st === 'aborted' ? '已中止' : (isStuck ? '疑似卡死' : '运行中'));
        return '<div class="pane-row">' + dot(stDot) +
          '<span class="pane-row__k">' + esc(j.label) + '</span>' +
          '<span class="pane-row__v" style="color:var(--text-weak)">' + esc(j.detail || '') + (j.error ? '<span style="color:var(--danger-ink)"> ' + esc(String(j.error).slice(0, 40)) + '</span>' : '') + '</span>' +
          '<span class="pane-row__v" style="flex:0 0 52px;text-align:right;color:var(--' + (st === 'fail' ? 'danger' : st === 'aborted' ? 'warning' : 'text-dim') + ')">' + stLabel + '</span>' +
          '<span class="pane-row__v" style="flex:0 0 74px;text-align:right;color:var(--' + (isStuck ? 'danger' : 'text-dim') + ')">' + fmtMs(j.ms) + '</span>' +
          (st === 'run' && BF.jobs.abort ? '<button class="btn btn-xs" data-diag-jobs-abort="' + j.id + '" title="中止任务">中止</button>' : '') +
          '</div>';
      }).join('') + '</div>'
      : '<div class="pane-empty">当前无进行中任务</div>';
    if (stuck.length) h += '<div class="pane-hint" style="color:var(--danger-ink)">' + stuck.length + ' 个任务已超过 10 秒未完成，可能卡在超大文件处理上。</div>';
    /* 事件流：最近 40 条任务生命周期事件 */
    const evs = (BF.jobs && BF.jobs.events) ? BF.jobs.events() : [];
    if (evs.length) {
      h += '<div class="pane-sec pane-sec-gap">任务事件流</div><div class="pane-rows">' +
        evs.slice(-10).reverse().map(function (ev) {
          return '<div class="pane-row">' + dot(ev.name === 'fail' ? 'bad' : ev.name === 'abort' ? 'warn' : 'ok') +
            '<span class="pane-row__k">' + esc(ev.name) + '</span>' +
            '<span class="pane-row__v" style="color:var(--text-weak)">' + esc(ev.desc || '') + '</span>' +
            '<span class="pane-row__v" style="flex:0 0 64px;text-align:right;color:var(--text-weak)">' + new Date(ev.t).toLocaleTimeString('zh-CN', { hour12: false }) + '</span></div>';
        }).join('') + '</div>';
    }

    h += '<div class="pane-sec pane-sec-gap">Worker 池</div>';
    const wp = BF.workerPool;
    const st = (wp && wp.poolStatus) ? wp.poolStatus() : [];
    h += '<div class="pane-rows">' +
      '<div class="pane-row">' + dot(wp && wp.available() ? 'ok' : 'bad') +
      '<span class="pane-row__k">环境</span><span class="pane-row__v">' + (wp && wp.available() ? 'Web Worker 可用' : '不可用，大文件分章回退同步') + '</span></div>' +
      '<div class="pane-row">' + dot((wp && wp.pendingCount() >= (wp.MAX_PENDING || 4)) ? 'warn' : 'ok') +
      '<span class="pane-row__k">负载</span><span class="pane-row__v">' + (wp ? wp.pendingCount() : 0) + ' / ' + (wp ? wp.MAX_PENDING : '?') + ' 个任务排队</span></div>' +
      '<div class="pane-row">' + dot('ok') +
      '<span class="pane-row__k">限流</span><span class="pane-row__v">单任务超时 ' + Math.round((wp ? wp.TASK_TIMEOUT : 0) / 1000) + 's</span></div>' +
      (st.length ? st.map(function (s) {
        return '<div class="pane-row">' + dot(s.live ? 'ok' : 'warn') +
          '<span class="pane-row__k is-mono">' + esc(s.op) + '</span>' +
          '<span class="pane-row__v">' + (s.live ? '运行中' : s.dead ? '已崩溃（下次调用自动重建）' : '未使用') + '</span></div>';
      }).join('') : '') +
      (wp && wp.poolSize() ? '' : '<div class="pane-row"><span class="pane-row__k is-mono">—</span><span class="pane-row__v">尚未创建 Worker 池</span></div>') +
      '</div>';

    /* 性能采样开关：perf.start 在 boot 里无条件启动，rAF 循环 + longtask
       observer 会一直跑到底，因此必须有 stop 出口，也要有 isRunning
       给出「能不能停」的判断依据。
       采样本身只有约 1k 内存，但用户如果想确认「不采样时是否更流畅」，
       必须能真的关掉再对比。 */
    const perfOn = (BF.perf && BF.perf.isRunning) ? BF.perf.isRunning() : false;
    h += '<div class="pane-sec pane-sec-gap">性能采样' +
      '<span class="pane-sec__act"><span style="font-size:11px;color:var(--' + (perfOn ? 'success-ink' : 'text-weak') + ')">' +
      (perfOn ? '运行中' : '已停止') + '</span>' +
      '<button class="btn btn-xs" data-diag-perf="' + (perfOn ? 'stop' : 'start') + '">' +
      (perfOn ? '停止' : '启动') + '</button></span></div>';
    h += '<div class="pane-hint">帧率与长任务采样常驻运行会占用主线程。排查「阅读时偶发卡顿」时可保持运行，'
      + '其余时间建议停止。停止不影响任何阅读功能，只影响本页读数。</div>';

    h += '<div class="pane-sec pane-sec-gap">内核服务' +
      '<span class="pane-sec__act"><span style="font-size:11px;color:var(--text-weak)">' + (BF.modules.list ? BF.modules.list().length : 0) + ' 个扩展</span></span></div>';
    const mods = (BF.modules && BF.modules.list) ? BF.modules.list() : [];
    if (mods.length) {
      const enabled = mods.filter(function (m) { return BF.modules.isEnabled(m.id); });
      h += '<div class="pane-rows">' +
        '<div class="pane-row pane-row--head"><span class="pane-row__k">模块</span><span class="pane-row__v">状态</span><span class="pane-row__v" style="flex:0 0 84px;text-align:right">依赖 / 标签</span></div>' +
        enabled.sort(function (a, b) { return (BF.modules._isCore(a.id) ? 0 : 1) - (BF.modules._isCore(b.id) ? 0 : 1); })
          .map(function (m) {
            const isCore = BF.modules._isCore(m.id);
            const deps = (m.deps && m.deps.length) ? m.deps.join(' ') : '—';
            return '<div class="pane-row">' +
              '<span class="pane-row__k is-mono" style="width:auto;flex:1" title="' + esc(m.name || m.id) + '">' + esc(m.id) + '</span>' +
              '<span class="pane-row__v">' + dot(isCore ? 'ok' : 'warn') + (isCore ? '核心' : (m.enabled === false ? '已停用' : '扩展')) + '</span>' +
              '<span class="pane-row__v" style="flex:0 0 84px;text-align:right;color:var(--text-weak)">' + esc(deps) + '</span></div>';
          }).join('') + '</div>';
    } else h += '<div class="pane-empty">模块系统未启动</div>';

    h += '<div class="pane-sec pane-sec-gap">启动时序' +
      '<span class="pane-sec__act"><span style="font-size:11px;color:var(--text-weak)">总计 ' + fmtMs(BF.trace ? BF.trace.total() : 0) + '</span></span></div>';
    const tr = (BF.trace && BF.trace.list) ? BF.trace.list() : [];
    if (tr.length) {
      const maxMs = tr.reduce(function (m, x) { return Math.max(m, x.ms); }, 0) || 1;
      /* 超过均值 2 倍的阶段标为「慢」：只看绝对值不合理 —— PIN 解锁本来就会占大头 */
      const avg = tr.reduce(function (s, x) { return s + x.ms; }, 0) / tr.length || 1;
      h += '<div class="pane-rows">' + tr.map(function (x) {
          const slow = x.ms > avg * 2 && x.ms > 8;
          return '<div class="diag-trace-row' + (slow ? ' is-slow' : '') + '">' +
            '<span class="diag-trace-row__k">' + esc(x.name) + '</span>' +
            '<span class="diag-trace-row__bar"><span class="pane-bar"><span class="pane-bar__fill' + (slow ? ' is-warn' : '') + '" style="width:' + Math.max(2, Math.round(x.ms / maxMs * 100)) + '%"></span></span></span>' +
            '<span class="diag-trace-row__v">' + fmtMs(x.ms) + '</span></div>';
        }).join('') + '</div>';
      h += '<div class="pane-hint">仅记录本次会话的开机耗时。橙色为超过平均值 2 倍的阶段。</div>';
      /* 时序表要逐行扫才知道哪一段最慢，
         而用户问的往往正是「开机慢在哪」。这里用 slowest(1) 直接点名，
         与表格里的高亮用同一份 ms，不会出现摘要与行内读数不一致。 */
      const slow1 = (BF.trace && BF.trace.slowest) ? BF.trace.slowest(1)[0] : null;
      if (slow1) {
        const trAvg = tr.reduce(function (s, x) { return s + x.ms; }, 0) / tr.length;
        h += '<div class="pane-row" style="border-top:1px solid var(--border)">' +
          '<span class="pane-row__k">最慢阶段</span>' +
          '<span class="pane-row__v" style="color:' + (slow1.ms > trAvg * 2 && slow1.ms > 8 ? 'var(--warning-ink)' : 'var(--text-dim)') + '">' +
          esc(slow1.name) + '</span>' +
          '<span class="pane-row__v" style="flex:0 0 74px;text-align:right">' + fmtMs(slow1.ms) + '</span></div>';
      }
    } else h += '<div class="pane-empty">本次会话未记录到时序数据</div>';
    return h;
  }

  /* ============ 视图 5：工具 ============ */
  /* 数据操作不在运维台与基地各放一份：同一颗按钮在两处说明不一样，
     用户点了「导出」不知道会不会加密。数据操作 → 一律去基地。 */
  function viewTools() {
    let h = '<div class="pane-sec">进程操作</div>';
    h += '<div class="pane-rows">' +
      '<div class="pane-row">' + dot(BF.workerPool && BF.workerPool.available() ? 'ok' : 'warn') +
      '<span class="pane-row__k" style="width:auto;flex:1">重置 Worker 池</span>' +
      '<span class="pane-row__v" style="flex:0 0 auto;color:var(--text-weak)">仅在分章卡死时使用</span>' +
      '<button class="btn btn-xs" data-diag-t="kill">重置</button></div>' +
      '<div class="pane-row">' + dot('ok') +
      '<span class="pane-row__k" style="width:auto;flex:1">数据修复</span>' +
      '<span class="pane-row__v" style="flex:0 0 auto;color:var(--text-weak)">体检书籍元数据与阅读记录</span>' +
      '<button class="btn btn-xs" data-diag-t="repair">执行</button></div>' +
      '</div>';
    h += '<div class="pane-hint">备份、导出、导入、清缓存与重置全部数据已收进<b>基地</b>，那里有完整列表与风险说明。' +
      '<button class="btn btn-xs" data-diag-gobase style="margin-left:6px">打开基地</button></div>';

    h += '<div class="pane-sec pane-sec-gap">导出诊断报告</div>';
    h += '<div class="pane-rows"><div class="pane-row" style="flex-wrap:wrap">' +
      '<span class="pane-row__k" style="width:auto;flex:1">把当前运行状态导出为 JSON，便于反馈问题</span>' +
      '<button class="btn btn-xs" data-diag-t="report">导出</button></div></div>';

    h += '<div class="pane-sec pane-sec-gap">快捷键' +
      '<span class="pane-sec__act"><button class="btn btn-xs" data-diag-tabgo="tools">在设置中自定义</button></span></div>';
    /* 不能用 BF.help.shortcutsHTML —— 那是 BF.help 的模块内私有函数，
       BF.hotkeys 只导出了 list 与 LABELS。
       这里用 list + LABELS 自己渲染，能反映用户改过的热键
       （改过的条目 combo ≠ _default，加「已改」标记）。 */
    const hks = (BF.hotkeys && BF.hotkeys.list) ? BF.hotkeys.list() : [];
    if (hks.length) {
      const L = (BF.hotkeys && BF.hotkeys.LABELS) || {};
      h += '<div class="pane-rows">' + hks.map(function (k) {
          const label = L[k.id] || k.id;
          const changed = k._default && k.combo !== k._default;
          return '<div class="pane-row">' +
            '<span class="pane-row__k" style="width:auto;flex:1">' + esc(label) + '</span>' +
            '<kbd style="font-family:var(--mono);font-size:11px;background:var(--bg-input);border:1px solid var(--border);border-radius:var(--r-xs);padding:1px 6px;color:var(--text)">' + esc(k.combo) + '</kbd>' +
            (changed ? '<span style="font-size:10px;color:var(--text-weak)">已改</span>' : '') +
            '</div>';
        }).join('') + '</div>';
      const changedN = hks.filter(function (k) { return k._default && k.combo !== k._default; }).length;
      h += '<div class="pane-hint">共 ' + hks.length + ' 条' + (changedN ? '，其中 ' + changedN + ' 条已自定义' : '') + '。修改入口在设置 → 快捷键自定义。</div>';
    } else h += '<div class="pane-empty">快捷键尚未绑定（启动时绑定，若为空请检查启动日志）</div>';
    return h;
  }

  /* ============ 渲染 ============
     渲染目标是工作台内容区 #wb-body。
     仅在工作台处于运维相关栏（日志 / 进程 / 诊断）时
     才重画，避免越栏覆盖统计 / 任务 / 通知栏的内容。
     日志与进程栏不含子页签；诊断栏渲染自己的三个
     子页签（概览 / 存储 / 工具）。 */
  function render() {
    const body = document.getElementById('wb-body');
    if (!body) return;
    if (!(BF.workbench && BF.workbench.isDiagSec && BF.workbench.isDiagSec())) return;
    if (S.tab !== 'logs' && S.tab !== 'runtime') _sub = S.tab;
    const scroll = body.scrollTop;
    const d = collectOverview();
    let h = '';
    if (S.tab !== 'logs' && S.tab !== 'runtime') {
      h += '<nav class="pane-tabs" role="tablist" style="margin-bottom:var(--sp-3)">' + SUBS.map(function (t) {
        return '<button class="pane-tab" role="tab" data-diag-tab="' + t.id + '" aria-selected="false">' + t.icon + esc(t.label) + '</button>';
      }).join('') + '</nav>';
    }
    if (S.tab === 'overview') h += viewOverview(d);
    else if (S.tab === 'logs') h += viewLogs();
    else if (S.tab === 'storage') h += viewStorage();
    else if (S.tab === 'runtime') h += viewRuntime();
    else if (S.tab === 'tools') h += viewTools();

    body.innerHTML = '<div class="pane-view" role="tabpanel" data-diag-view="' + S.tab + '">' + h + '</div>';

    /* tab 激活态 + 错误计数徽章：错误数是最需要被看见的信号 */
    document.querySelectorAll('[data-diag-tab]').forEach(function (b) {
      const on = b.dataset.diagTab === S.tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const badge = document.querySelector('[data-diag-tabn="logs"]');
    if (badge) {
      const logs = BF.log.list();
      /* 必须是 nErr + nWarn，不能写 nErr || nWarn ——
         JS 的 || 返回第一个 truthy 值，5||15 === 5，
         那样 5 个错误就会把 15 个警告盖掉，用户以为只有 5 条待查。 */
      const nErr = logs.filter(function (l) { return l.lvl === 'error'; }).length;
      const nWarn = logs.filter(function (l) { return l.lvl === 'warn'; }).length;
      const n = nErr + nWarn;
      badge.hidden = !n;
      badge.textContent = n > 99 ? '99+' : n;
      badge.classList.toggle('is-alert', nErr > 0);
    }
    /* 头部健康胶囊 —— F-07：统一走 paintHealth，工作台各栏共用同一刷新 */
    paintHealth();
    body.scrollTop = scroll;

    /* 配额是异步的，渲染完再补，避免阻塞首屏 */
    if (S.tab === 'storage') {
      const q = document.getElementById('diag-quota');
      if (q) {
        q.innerHTML = '<div class="pane-empty">读取中…</div>';
        (async function () {
          const est = await BF.store.quota();
          if (!q.isConnected) return;
          if (!est) { q.innerHTML = '<div class="pane-empty">当前环境不提供配额信息</div>'; return; }
          const pct = est.pct;
          const tone = BF.store.quotaTone(pct);
          q.innerHTML =
            '<div class="pane-row"><span class="pane-row__k">已用</span><span class="pane-row__v">' + fmtBytes(est.usage) + (est.degraded ? '（下限，未能读完）' : '') + '</span></div>' +
            '<div class="pane-row"><span class="pane-row__k">配额</span><span class="pane-row__v">' + (est.quota ? fmtBytes(est.quota) + (est.proxy ? '（浏览器不提供，按 5M 字符上限≈10MB 估）' : '') : '未知') + '</span></div>' +
            '<div class="pane-row"><span class="pane-row__k">占用率</span>' +
            '<span class="pane-row__v" style="flex:0 0 52px;text-align:right">' + pct.toFixed(1) + '%</span></div>' +
            '<div style="padding:8px 12px"><span class="pane-bar"><span class="pane-bar__fill ' + tone + '" style="width:' + Math.min(100, Math.max(2, pct)) + '%"></span></span></div>';
        })();
      }
    }
    /* 自绘下拉接管：本面板的 select 会走这里 */
    try { BF.app.sel.scan(body); } catch (e) {}
  }

  /* ============ 动作 ============ */
  async function doAction(kind) {
    try {
      if (kind === 'backup' || kind === 'export' || kind === 'cache' || kind === 'backups' || kind === 'reset') {
        if (BF.base) return BF.base.action(kind);
        return;
      }
      if (kind === 'repair') {
        /* 与基地同一套分项修复，反馈内容保持一致（两处措辞不同会让用户以为做了不同的事） */
        const b = await BF.heal.repairBooks();
        const dd = BF.heal.repairDaily();
        const q = await BF.store.quotaCheck();
        const parts = [];
        parts.push('书籍元数据：修复 ' + b.fixed + ' 本' + (b.dropped ? '，剔除 ' + b.dropped + ' 条异常' : ''));
        parts.push('阅读记录：清理 ' + dd.fixed + ' 条');
        if (q) parts.push('存储占用 ' + q.pct.toFixed(0) + '%');
        BF.noti.success('体检完成 · ' + parts.join(' · '));
      } else if (kind === 'kill') {
        if (!BF.workerPool || !BF.workerPool.available()) { BF.noti.info('当前环境无 Worker 池'); return; }
        BF.workerPool.killAll();
        BF.noti.success('Worker 池已重置，下次调用自动重建');
      } else if (kind === 'report') {
        const r = (BF.caps && BF.caps.summary) ? BF.caps.summary() : null;
        const perfS = BF.perf.snapshot();
        const report = {
          生成时间: new Date().toISOString(),
          版本: '北风 V' + BF.version,
          环境: { 协议: location.protocol, 能力: r ? r.list : null },
          启动时序: BF.trace ? BF.trace.list() : null,
          启动总耗时ms: BF.trace ? BF.trace.total() : null,
          最慢阶段: BF.trace && BF.trace.slowest ? BF.trace.slowest(3) : null,
          内核: {
            模块数: BF.modules.list ? BF.modules.list().length : 0,
            命令数: BF.commands && BF.commands.list ? BF.commands.list().length : null,
            定时器: BF.timers.count ? BF.timers.count() : null,
            监听器: BF.bus.health ? BF.bus.health() : null,
            Worker池: BF.workerPool ? BF.workerPool.poolStatus() : null,
          },
          异常: { 累计: BF.err.count ? BF.err.count() : 0, 健康度: BF.err.health ? BF.err.health() : null, 最近: BF.err.recent ? BF.err.recent(20) : null },
          性能: perfS,
          写入健康: (BF.store && BF.store.wstats) ? BF.store.wstats.snapshot() : null,
          日志: BF.log.list().slice(-LOG_KEEP),
        };
        /* 按 exportBlob 返回值门控（同步站点走
           .then，对齐阅读笔记导出的门控模式） */
        BF.exportBlob('北风-诊断-' + new Date().toISOString().slice(0, 19).replace(/[:T]/g, '') + '.json', JSON.stringify(report, null, 2), { mime: 'application/json' })
          .then(function (ok) { if (ok) BF.noti.success('诊断报告已导出'); });
      }
    } catch (e) {
      BF.err.report('diag.action:' + kind, e);
      BF.noti.error('操作失败：' + (e && e.message || '未知错误'));
    }
    render();
  }

  return { open: open, toggle: toggle, render: render, action: doAction, sub: function () { return _sub; }, ICON_FIX: ICON_FIX, ICON_BASE: ICON_BASE, TABS: TABS, state: S, paintHealth: paintHealth };
})();
/* 运维台交互：全部走事件委托，绑一次即可。
   注意日志搜索用 'input' 而非 'change' —— change 要失焦才触发，边打字边筛是基本需求。
   日志区/进程区会重渲染，绑在元素上会丢，所以放在 document 上按 closest 判定。 */
(function () {
  let _qTimer = null;
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t.closest) return;
    const tab = t.closest('[data-diag-tab]');
    if (tab) { BF.diag.state.tab = tab.dataset.diagTab; BF.diag.render(); return; }
    const go = t.closest('[data-diag-tabgo]');
    if (go) {
      /* 日志 / 进程是工作台顶级栏，
         跳转到它们 = 切换工作台栏；其余子页仍在诊断栏内切换 */
      const v = go.dataset.diagTabgo;
      if (v === 'logs' || v === 'runtime') BF.workbench.open(v);
      else { BF.diag.state.tab = v; BF.diag.render(); }
      return;
    }
    const lv = t.closest('[data-diag-lv]');
    if (lv) {
      const k = lv.dataset.diagLv;
      BF.diag.state.lv[k] = !BF.diag.state.lv[k];
      /* 至少留一个级别开着，否则用户点了全部关闭会以为面板坏了 */
      if (!BF.diag.state.lv.info && !BF.diag.state.lv.warn && !BF.diag.state.lv.error) BF.diag.state.lv[k] = true;
      BF.diag.render(); return;
    }
    if (t.closest('[data-diag-logmax]')) { BF.diag.state.max = !BF.diag.state.max; BF.diag.render(); return; }
    /* 无「导出异常日志」入口：新增导出站点会与既有导出站点数量的
       硬约束冲突，二者不可同时满足，整条不做（不留半截 UI）。
       若日后落地，注意 BF.err.recent(n) 的 n 是条数上限，
       环形缓冲上限 ERR_RING_MAX=20，传 1000 至多拿到 20 条，
       导出时要按实际条数如实标注，不能假装 1000 条。 */
    if (t.closest('[data-diag-logclear]')) {
      if (BF.log.clear()) BF.noti.info('运行日志已清空');
      else BF.noti.warn('运行日志只清了本次会话：本地存储不可写，重开页面还会看到旧日志');
      BF.diag.render(); return;
    }
    /* 备份列表只在基地渲染，这里只给一个跳转入口：
     两个面板各渲染一份备份列表会导致「删了一份、另一处还显示在」的不一致。 */
    if (t.closest('[data-diag-gobase]')) {
      /* 基地是工作台的「数据」栏，
         同面板内切栏即可，无需关闭再开 */
      const tab = t.closest('[data-diag-gobase]').dataset.diagGobase || 'overview';
      if (BF.base) BF.base.open(tab);
      return;
    }
    if (t.closest('[data-diag-caps]') || t.closest('[data-diag-jobs]')) { BF.diag.render(); return; }
    /* 中止任务：运维台进程页的「中止」按钮 */
    const jab = t.closest('[data-diag-jobs-abort]');
    if (jab) {
      const id = parseInt(jab.dataset.diagJobsAbort, 10);
      if (id && BF.jobs && BF.jobs.abort) {
        BF.jobs.abort(id);
        BF.noti.info('已发送中止指令');
        BF.diag.render();
      }
      return;
    }
    /* 性能采样开关（采样必须能关：只有开没有关，就没法和停止状态对比） */
    const pf = t.closest('[data-diag-perf]');
    if (pf) {
      try {
        if (pf.dataset.diagPerf === 'stop') { BF.perf.stop(); BF.log.info('性能采样已停止'); }
        else { BF.perf.start(); BF.log.info('性能采样已启动'); }
      } catch (e) { BF.err.report('diag.perf', e); BF.noti.error('采样开关失败：' + (e && e.message || '未知错误')); }
      BF.diag.render(); return;
    }
    /* 直达设置里的「记录普通日志」开关：info 为 0 时给用户一条路，
       否则只能自己在设置里翻找。 */
    if (t.closest('[data-diag-opencap]')) {
      try {
        BF.sheet.close('workbench-panel');
        BF.settingsUI.open();
        setTimeout(function () {
          const sel = document.querySelector('[data-set-k="captureLog"]') || document.querySelector('select[data-k="captureLog"]');
          if (sel) { sel.scrollIntoView({ block: 'center' }); sel.focus(); BF.noti.info('已定位到「记录普通日志」，设为「开启」后 info 级才会入缓冲'); }
          else BF.noti.info('请在设置中搜索「记录普通日志」并设为「开启」');
        }, 500);
      } catch (e) { BF.err.report('diag.opencap', e); }
      return;
    }
    const act = t.closest('[data-diag-t]');
    if (act) { BF.diag && doDiagAction(act.dataset.diagT); return; }
  });
  /* 暴露给上面的委托调用（闭包内不便直接引用 doAction） */
  function doDiagAction(kind) { BF.diag.action(kind); }
  document.addEventListener('input', function (e) {
    const t = e.target;
    if (!t.closest) return;
    const q = t.closest('[data-diag-logq]');
    if (!q) return;
    const v = q.value;
    if (_qTimer) clearTimeout(_qTimer);
    /* 180ms 防抖：日志最多 200 条，全量重绘不卡，但连续输入时没必要每键都重画 */
    _qTimer = setTimeout(function () {
      BF.diag.state.q = v;
      BF.diag.render();
      /* 重绘会换掉 input，焦点与光标位置必须显式恢复，否则连打两个字就失焦 */
      const box = document.querySelector('[data-diag-logq]');
      if (box) { box.focus(); try { box.setSelectionRange(v.length, v.length); } catch (e) {} }
    }, 180);
  });
})();

/* ============================================================
   北风 · 性能监控（long task / FPS / 内存）
   ============================================================ */
BF.perf = (function () {
  let _fps = 0, _frames = 0, _last = 0, _raf = null, _obs = null;
  let _longTasks = [];
  function start() {
    if (_raf) return;
    _last = performance.now();
    _raf = requestAnimationFrame(function loop(now) {
      _frames++;
      if (now - _last >= 1000) {
        _fps = Math.round(_frames * 1000 / (now - _last));
        _frames = 0; _last = now;
      }
      _raf = requestAnimationFrame(loop);
    });
    try {
      if ('PerformanceObserver' in window) {
        /* observer 是模块级变量，stop() 才够得着——局部常量时
           关掉性能监控后 longtask 监听照跑不误（观察者不释放即持续回调），
           且反复 start 会叠加多个 observer 重复记账。
           disconnect 放在 start 入口与 stop 两处，保证同一时刻至多一个。 */
        if (_obs) { try { _obs.disconnect(); } catch (e) {} _obs = null; }
        const obs = new PerformanceObserver(function (list) {
          for (const entry of list.getEntries()) {
            _longTasks.push({ start: Math.round(entry.startTime), dur: Math.round(entry.duration) });
            if (_longTasks.length > 50) _longTasks.shift();
          }
        });
        obs.observe({ entryTypes: ['longtask'] });
        _obs = obs;
      }
    } catch (e) {}
  }
  function stop() {
    if (_raf) cancelAnimationFrame(_raf);
    _raf = null;
    if (_obs) { try { _obs.disconnect(); } catch (e) {} _obs = null; }
  }
  /* isRunning：UI 要给它一个开关，就得能判断当前采样状态。
     与 snapshot 分开：snapshot 报的是数据，这个报的是「采样器在不在跑」。 */
  function isRunning() { return !!_raf; }
  function snapshot() {
    let mem = null;
    try { if (performance.memory) mem = Math.round(performance.memory.usedJSHeapSize / 1048576) + 'MB'; } catch (e) {}
    return { fps: _fps, longTasks: _longTasks.slice(-5), mem, running: !!_raf };
  }
  return { start, stop, snapshot, isRunning };
})();
/* perf 懒启动：在 boot._enter 进入应用后再启动，避免脚本求值期即开 rAF 循环 */

/* ============================================================
   北风 · 增强域：章节截图 / 笔记导出 / 批量导出 / 自动滚动
   缩放 / 书籍信息 / 跨标签同步 / OPFS 快照
   ============================================================ */
BF.enh = BF.enh || {};

