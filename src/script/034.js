/* ================= 14b. 曲径（实验界面 · qjMode）：多驿站式接管界面 =================
   设置 → 实验 → 曲径界面 开启；开启后应用落在曲径（boot 落点 + nav.home /
   「返回书架」都汇入），唯一出口在右上「出口」与设置里的本开关——关闭即整体还原。
   独立的一套：自有五站路由（今/架/迹/坊/笺）与切换动画、自绘书架与
   统计图；功能面仍走 BF.commands / BF.app /
   BF.notes 总线，与旧界面同源，数据零损耗。 */
BF.qj = (function () {
  const $ = function (id) { return document.getElementById(id); };
  function esc(s) { return BF.dom.esc(s); }   /* 转义只有 BF.dom 一处实现；不设放行裸串的兜底（兜底一旦走到就是注入面） */
  function escAttr(s) { return BF.dom.esc(s); }
  function fmtNum(n) { return BF.util.fmtNum(n); }
  function timeAgo(ts) { return BF.util.timeAgo(ts); }
  function coverHue(t) { return (BF.util && BF.util.coverHue) ? BF.util.coverHue(String(t || '')) : 0; }

  /* ===== 驿站登记表：一条路串起全部功能，路径动画方向由站序差决定 ===== */
  const STATIONS = [
    { id: 'jin',  ch: '今', label: '今站', title: '今站 · 今日与续读' },
    { id: 'jia',  ch: '架', label: '书架', title: '书架 · 全部藏书' },
    { id: 'ji',   ch: '迹', label: '足迹', title: '足迹 · 阅读统计' },
    { id: 'fang', ch: '坊', label: '工坊', title: '工坊 · 朗读与工具' },
    { id: 'jian', ch: '笺', label: '手记', title: '手记 · 便签标注与 AI' },
  ];
  const stIdx = function (id) { for (let i = 0; i < STATIONS.length; i++) if (STATIONS[i].id === id) return i; return 0; };

  let cur = 'jin';        /* 当前站 */
  let pend = null;        /* 外部指定的落站（go('bookshelf') 时想去书架） */
  let initialized = false;

  /* ===== 数据源：与旧界面同一套存储层 ===== */
  function books() {
    const raw = (BF.store && BF.store.lsGetArray) ? BF.store.lsGetArray(BF.store.K.BOOKS_META, []) : [];
    return (BF.library && BF.library.mergeReadingState) ? BF.library.mergeReadingState(raw) : raw;
  }
  function byRecent(bks) {
    return (bks || []).slice().sort(function (a, b) {
      return ((b.lastRead || 0) - (a.lastRead || 0)) || String(a.title || '').localeCompare(String(b.title || ''));
    });
  }
  function lastBook() {
    try {
      const lb = (BF.store && BF.store.lsGet) ? BF.store.lsGet(BF.store.K.LAST_BOOK, null) : null;
      if (!lb) return null;
      return books().find(function (x) { return x && x.id === lb; }) || null;
    } catch (e) { return null; }
  }
  function dailyMap() { return (BF.store && BF.store.lsGet) ? (BF.store.lsGet(BF.store.K.DAILY, {}) || {}) : {}; }
  function todayMin() { return (BF.stats && BF.stats.todayDisplay) ? BF.stats.todayDisplay() : 0; }
  function goalMin() { return BF.settings.num('readGoal', 30); }
  function greeting() {
    const h = new Date().getHours();
    return h < 6 ? '夜正深' : h < 11 ? '早上好' : h < 13 ? '午安' : h < 18 ? '下午好' : '晚上好';
  }
  function quote() {
    if (!BF.QUOTES || !BF.QUOTES.length) return null;
    return BF.QUOTES[Math.floor(Date.now() / 86400000) % BF.QUOTES.length];
  }
  function wordsEst(b) { return b && b.size ? Math.max(1, Math.round(b.size / 3)) : 0; }
  function chapPct(b) { return b && b.totalChapters ? Math.min(100, Math.round((b.currentChapter || 0) / b.totalChapters * 100)) : 0; }

  /* ===== 各站渲染（进站时整屏重绘；数据量小，直接拼 HTML） ===== */

  /* 站牌头 */
  function stnHTML(id) {
    const st = STATIONS[stIdx(id)];
    return '<div class="qj-stn"><span class="qj-stn__t">' + st.label + '</span><span class="qj-stn__s">' + st.title.split(' · ')[1] + '</span><span class="qj-stn__rule"></span></div>';
  }

  /* —— 今站 —— */
  function vJin() {
    const bks = books();
    const last = lastBook();
    const q = quote();
    const goal = goalMin(), tm = todayMin();
    const streak = (BF.stats && BF.stats.streak) ? BF.stats.streak() : 0;
    const totalH = (BF.stats && BF.stats.total) ? BF.stats.total() : 0;
    const d = new Date();
    const week = ['日', '一', '二', '三', '四', '五', '六'][d.getDay()];
    /* 今日圆环 */
    const R = 52, C = 2 * Math.PI * R;
    const p = Math.min(tm / (goal || 1), 1);
    const recent = byRecent(bks.filter(function (b) { return b && b.lastRead; })).slice(0, 8);

    const continueCard = last
      ? '<div class="qj-panel qj-continue" data-qj-open="' + escAttr(last.id) + '" role="button" tabindex="0" title="继续阅读">' +
          '<div class="qj-continue__cv" data-cv="' + coverHue(last.title) + '"></div>' +
          '<div class="qj-continue__b">' +
            '<div class="qj-continue__t">' + esc(last.title || '未命名') + '</div>' +
            '<div class="qj-continue__m">第 ' + (last.currentChapter || 0) + ' / ' + (last.totalChapters || 0) + ' 章 · 已读完 ' + chapPct(last) + '%</div>' +
            '<div class="qj-continue__bar"><i data-w="' + chapPct(last) + '"></i></div>' +
          '</div>' +
          '<span class="qj-continue__go">继 续</span>' +
        '</div>'
      : '<div class="qj-panel qj-continue qj-continue--empty" data-qj-cmd="import.txt" role="button" tabindex="0">' +
          '<b>还没有在读的书</b><span>从书架挑一本，或直接导入 TXT →</span>' +
        '</div>';

    const quick = [
      { cmd: 'import.txt', t: '导入 TXT', d: '本地文件' },
      { cmd: 'import.clipboard', t: '剪贴板', d: '即贴即存' },
      { cmd: 'import.url', t: '网址', d: '抓取正文' },
      { cmd: 'across.open', t: '跨书检索', d: '全库找一句' },
      { cmd: 'ws.focus', t: '番茄钟', d: '专注一段' },
      { cmd: 'ws.noise', t: '白噪音', d: '环境伴读' },
      { cmd: 'data.autobackup', t: '立即备份', d: '桌面快照' },
      { cmd: 'theme.cycle', t: '换一换', d: '轮换外观' },
    ].map(function (x) {
      return '<div class="qj-qcell" data-qj-cmd="' + x.cmd + '" role="button" tabindex="0"><b>' + x.t + '</b><i>' + x.d + '</i></div>';
    }).join('');

    const spines = recent.length
      ? recent.map(function (b) {
          return '<div class="qj-spine" data-qj-open="' + escAttr(b.id) + '" role="button" tabindex="0" title="' + escAttr(b.title || '') + '">' +
            '<div class="qj-spine__cv" data-cv="' + coverHue(b.title) + '"></div>' +
            '<div class="qj-spine__t">' + esc(b.title || '未命名') + '</div>' +
            '<div class="qj-spine__m">' + timeAgo(b.lastRead) + '</div></div>';
        }).join('')
      : '<div class="qj-empty qj-empty--wide">暂无阅读记录 —— 开一本书，路就走起来了</div>';

    return '<div class="qj-jin">' +
      '<div class="qj-jin__main">' +
        '<div>' +
          '<div class="qj-hello">' + greeting() + '，<em>书在等</em></div>' +
          '<div class="qj-dateline">' + d.getFullYear() + ' 年 ' + (d.getMonth() + 1) + ' 月 ' + d.getDate() + ' 日 · 星期' + week + '</div>' +
          (q ? '<div class="qj-verse">「' + esc(q.text) + '」<i>—— ' + esc(q.source) + '</i></div>' : '') +
        '</div>' +
        continueCard +
        '<div class="qj-quick">' + quick + '</div>' +
      '</div>' +
      '<div class="qj-jin__side">' +
        '<div class="qj-panel qj-ringbox">' +
          '<div class="qj-ring"><svg viewBox="0 0 120 120">' +
            '<circle class="qj-ring__bg" cx="60" cy="60" r="' + R + '"></circle>' +
            '<circle class="qj-ring__fg" cx="60" cy="60" r="' + R + '" stroke-dasharray="' + C.toFixed(1) + '" stroke-dashoffset="' + (C * (1 - p)).toFixed(1) + '"></circle>' +
          '</svg><div class="qj-ring__num"><b>' + tm + '</b><small>今日 · 分</small></div></div>' +
          '<div class="qj-ringbox__stats">' +
            '<div class="r"><span>目标</span><b>' + goal + ' 分</b></div>' +
            '<div class="r"><span>连续</span><b>' + streak + ' 天</b></div>' +
            '<div class="r"><span>累计</span><b>' + totalH + ' 时</b></div>' +
            '<div class="r"><span>藏书</span><b>' + bks.length + ' 册</b></div>' +
          '</div>' +
        '</div>' +
        '<div class="qj-panel">' +
          '<div class="qj-stn__s qj-stn__s--tight">最 近 在 读</div>' +
          '<div class="qj-spines">' + spines + '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }

  /* —— 书架站 —— */
  const shelfQ = { q: '', sort: 'recent' };
  function vJia() {
    let bks = books();
    const n = bks.length;
    const k = shelfQ.q.trim().toLowerCase();
    if (k) bks = bks.filter(function (b) { return String(b.title || '').toLowerCase().indexOf(k) >= 0; });
    if (shelfQ.sort === 'recent') bks = byRecent(bks);
    else if (shelfQ.sort === 'added') bks = bks.slice().sort(function (a, b) { return (b.importedAt || 0) - (a.importedAt || 0); });
    else bks = bks.slice().sort(function (a, b) { return String(a.title || '').localeCompare(String(b.title || ''), 'zh-CN'); });

    const tickets = bks.length ? bks.map(function (b) {
      return '<div class="qj-ticket" data-qj-open="' + escAttr(b.id) + '" role="button" tabindex="0" title="' + escAttr(b.title || '') + '">' +
        '<div class="qj-ticket__cv" data-cv="' + coverHue(b.title) + '"></div>' +
        '<div class="qj-ticket__b">' +
          '<div class="qj-ticket__t">' + esc(b.title || '未命名') + '</div>' +
          '<div class="qj-ticket__m">第 ' + (b.currentChapter || 0) + ' / ' + (b.totalChapters || 0) + ' 章 · 约 ' + fmtNum(wordsEst(b)) + ' 字 · ' + (b.lastRead ? timeAgo(b.lastRead) : '未开始') + '</div>' +
          '<div class="qj-ticket__bar"><i data-w="' + chapPct(b) + '"></i></div>' +
        '</div>' +
        '<span class="qj-ticket__go">读 →</span></div>';
    }).join('')
      : '<div class="qj-empty qj-empty--wide">' + (n ? '没有匹配「' + esc(shelfQ.q) + '」的书' : '书架空空 —— 导入第一本，或按 Ctrl O') + '</div>';

    const sortBtn = function (id, lb) {
      return '<button class="qj-qbtn' + (shelfQ.sort === id ? ' on' : '') + '" data-qj-sort="' + id + '">' + lb + '</button>';
    };
    return stnHTML('jia') +
      '<div class="qj-shelfbar">' +
        '<input type="text" id="qj-shelf-q" placeholder="在书架里找一本书…" value="' + escAttr(shelfQ.q) + '" autocomplete="off" spellcheck="false">' +
        sortBtn('recent', '最近在读') + sortBtn('added', '最近导入') + sortBtn('title', '书名') +
        '<button class="qj-qbtn" data-qj-cmd="import.txt">＋ 导入 TXT</button>' +
        '<span class="qj-shelfmeta">共 ' + n + ' 册' + (k ? ' · 命中 ' + bks.length : '') + '</span>' +
      '</div>' +
      '<div class="qj-tickets">' + tickets + '</div>';
  }

  /* —— 足迹站 —— */
  function vJi() {
    const daily = dailyMap();
    const tm = todayMin();
    const weekMin = Math.round(((BF.stats && BF.stats.windowSum) ? BF.stats.windowSum(daily, 7) : 0) / 60);
    const totalH = (BF.stats && BF.stats.total) ? BF.stats.total() : 0;
    const streak = (BF.stats && BF.stats.streak) ? BF.stats.streak() : 0;
    /* 近 14 天柱图 */
    let maxBar = 1;
    const days = [];
    for (let i = 13; i >= 0; i--) {
      const dd = new Date(Date.now() - i * 86400000);
      const key = (BF.stats && BF.stats.todayKey) ? BF.stats.todayKey(dd) : dd.toISOString().slice(0, 10);
      const min = Math.round((Number(daily[key]) || 0) / 60);
      if (min > maxBar) maxBar = min;
      days.push({ min: min, label: (dd.getMonth() + 1) + '/' + dd.getDate(), today: i === 0 });
    }
    const cols = days.map(function (x) {
      const h = Math.max(x.min ? 4 : 2, Math.round(x.min / maxBar * 100));
      return '<div class="qj-chart__col' + (x.today ? ' is-today' : '') + '" title="' + x.label + ' · ' + x.min + ' 分钟">' +
        '<div class="qj-chart__bar" data-h="' + h + '"></div>' +
        '<span class="qj-chart__lb">' + x.label + '</span></div>';
    }).join('');
    /* 最常读的书 Top5 */
    const bks = books();
    const top = ((BF.stats && BF.stats.bookList) ? BF.stats.bookList() : []).slice(0, 5).map(function (x) {
      const b = bks.find(function (y) { return y && y.id === x.id; });
      return { id: x.id, title: b ? b.title : '(已删除的书)', min: Math.round((x.sec || 0) / 60) };
    }).filter(function (x) { return x.min > 0; });
    const topMax = top.length ? top[0].min : 1;
    const rows = top.length ? top.map(function (x, i) {
      return '<div class="qj-tbrow" data-qj-open="' + escAttr(x.id) + '" role="button" tabindex="0">' +
        '<span class="qj-tbrow__i">' + String(i + 1).padStart(2, '0') + '</span>' +
        '<span class="qj-tbrow__t">' + esc(x.title) + '</span>' +
        '<span class="qj-tbrow__m">' + x.min + ' 分钟</span>' +
        '<span class="qj-tbrow__bar"><i data-w="' + Math.max(3, Math.round(x.min / topMax * 100)) + '"></i></span></div>';
    }).join('') : '<div class="qj-empty">还没有按书计的时长 —— 去读几页，足迹自会落笔</div>';

    return stnHTML('ji') +
      '<div class="qj-nums">' +
        '<div class="qj-num"><b>' + tm + '<small>分</small></b><span>今日</span></div>' +
        '<div class="qj-num"><b>' + weekMin + '<small>分</small></b><span>近 7 天</span></div>' +
        '<div class="qj-num"><b>' + totalH + '<small>时</small></b><span>累计</span></div>' +
        '<div class="qj-num"><b>' + streak + '<small>天</small></b><span>连续</span></div>' +
      '</div>' +
      '<div class="qj-panel qj-chart">' + cols + '</div>' +
      '<div class="qj-stn__s qj-stn__s--head">最 常 读 的 书</div>' +
      '<div class="qj-topbooks">' + rows + '</div>';
  }

  /* —— 工坊站 —— */
  function ttsOn() { return !!(BF.tts && BF.tts.state && BF.tts.state.playing); }
  function vFang() {
    const cards = [
      { act: 'tts', ch: '声', t: '朗读开关', d: '当前书从头念起或停止；朗读中也可用 Ctrl 空格切换', live: true },
      { cmd: 'tts.stop', ch: '止', t: '停止朗读', d: '立刻安静，断点自动落盘' },
      { cmd: 'ws.focus', ch: '专', t: '番茄钟', d: '25 分钟专注一段，与白噪音搭着用' },
      { cmd: 'ws.noise', ch: '噪', t: '白噪音', d: '雨声、篝火、翻页——环境伴读' },
      { cmd: 'theme.cycle', ch: '肤', t: '轮换外观', d: '七档外观逐档换，含明暗与色板' },
      { cmd: 'data.autobackup', ch: '存', t: '立即备份', d: '全量快照落到本地' },
      { cmd: 'wb.open', ch: '台', t: '工作台', d: '数据 / 任务 / 日志 / 通知一屋收齐' },
      { cmd: 'dev.console', ch: '码', t: 'DSL 终端', d: 'Ctrl Shift J，脚本驱动阅读器' },
      { cmd: 'help.changelog', ch: '册', t: '使用手册', d: '玩法、快捷键与更新日志' },
      { cmd: 'stats.open', ch: '表', t: '统计面板', d: '热力图与目标环的完整版' },
    ];
    /* D2：devTools 关时不渲染工作台那张卡；工作台仍可由「设置·数据→高级工具」开启入口或直接 DSL wb.open。 */
    var _fangCards = cards.filter(function (c) { return BF.settings.get('devTools') || c.cmd !== 'wb.open'; });
    return stnHTML('fang') + '<div class="qj-grid">' + _fangCards.map(function (c) {
      return '<div class="qj-card" role="button" tabindex="0" ' + (c.act ? 'data-qj-act="' + c.act + '"' : 'data-qj-cmd="' + c.cmd + '"') + '>' +
        '<div class="qj-card__ch">' + c.ch + '</div>' +
        '<div class="qj-card__t">' + c.t + '</div>' +
        '<div class="qj-card__d">' + c.d + '</div>' +
        (c.live ? '<span class="qj-card__live" id="qj-tts-live">' + (ttsOn() ? '朗读中' : '未在朗读') + '</span>' : '') +
        '<span class="qj-card__arrow">→</span></div>';
    }).join('') + '</div>';
  }

  /* —— 手记站 —— */
  function vJian() {
    const cards = [
      { cmd: 'nav.notes', ch: '笺', t: '便签本', d: '随手记，写作与摘抄的草稿区' },
      { cmd: 'ann.across', ch: '批', t: '划线与标注', d: '全部书的批注聚合一处' },
      { cmd: 'ai.center', ch: '问', t: 'AI 问书 · 研读中心', d: '带着书提问，AI 替你翻' },
      { cmd: 'ai.prompts', ch: '令', t: '提示词预设', d: '编辑问书用的提示词' },
      { cmd: 'ai.exportAskMd', ch: '稿', t: '导出问书记录', d: '对话落成 Markdown 文件' },
      { cmd: 'across.open', ch: '检', t: '跨书全文检索', d: '在全库正文里找一句话' },
    ];
    return stnHTML('jian') + '<div class="qj-grid">' + cards.map(function (c) {
      return '<div class="qj-card" role="button" tabindex="0" data-qj-cmd="' + c.cmd + '">' +
        '<div class="qj-card__ch">' + c.ch + '</div>' +
        '<div class="qj-card__t">' + c.t + '</div>' +
        '<div class="qj-card__d">' + c.d + '</div>' +
        '<span class="qj-card__arrow">→</span></div>';
    }).join('') + '</div>';
  }

  const RENDERERS = { jin: vJin, jia: vJia, ji: vJi, fang: vFang, jian: vJian };

  /* ===== 路由：站间切换 + 方向动画 ===== */
  function go(id, opts) {
    opts = opts || {};
    if (!RENDERERS[id]) id = 'jin';
    const dir = stIdx(id) >= stIdx(cur) ? 'qj-in-r' : 'qj-in-l';
    cur = id;
    const views = document.querySelectorAll('.qj-view');
    for (let i = 0; i < views.length; i++) {
      const v = views[i].getAttribute('data-qj-v') === id;
      views[i].hidden = !v;
      views[i].classList.remove('qj-in-r', 'qj-in-l');
      if (v) { views[i].innerHTML = RENDERERS[id](); try { BF.util.applyDataGeom(views[i]); } catch (e) {} views[i].classList.add(dir); views[i].scrollTop = 0; }
    }
    drawPath();
    refreshTrail();
    if (id === 'jia') {
      const q = $('qj-shelf-q');
      if (q && !opts.noFocus) { try { q.focus(); } catch (e) {} }
    }
  }
  /* 驿道绘制：站 + 段（走过的段实线） */
  function drawPath() {
    const path = $('qj-path');
    if (!path) return;
    const ci = stIdx(cur);
    let html = '';
    STATIONS.forEach(function (st, i) {
      if (i > 0) html += '<span class="qj-leg' + (i <= ci ? ' done' : '') + '"></span>';
      html += '<button class="qj-node" data-qj-go="' + st.id + '" aria-current="' + (i === ci) + '" title="' + escAttr(st.title) + '">' +
        '<span class="qj-node__dot">' + st.ch + '</span><span class="qj-node__lb">' + st.label + '</span></button>';
    });
    path.innerHTML = html;
    /* §4.5.2 里程尺：走过的刻度填色，纯装饰 aria-hidden */
    try {
      const fill = $('qj-mileage-fill');
      const labels = $('qj-mileage-labels');
      if (fill) fill.style.width = Math.round((ci / Math.max(1, STATIONS.length - 1)) * 100) + '%';
      if (labels && !labels.__qjDrawn) {
        labels.__qjDrawn = 1;
        labels.innerHTML = STATIONS.map(function (st) { return '<span>' + st.ch + '</span>'; }).join('');
      }
    } catch (e) {}
  }

  /* ===== 底径记 + 时钟 ===== */
  function refreshTrail() {
    try {
      const tm = todayMin(), goal = goalMin();
      const t = $('qj-trail-today'); if (t) t.textContent = '今日 ' + tm + ' 分';
      const g = $('qj-trail-goal'); if (g) g.textContent = '目标 ' + goal + ' 分';
      const x = $('qj-trail-x'); if (x) x.style.width = Math.round(Math.min(tm / (goal || 1), 1) * 100) + '%';
      const sk = $('qj-trail-streak'); if (sk) sk.textContent = '连续 ' + ((BF.stats && BF.stats.streak) ? BF.stats.streak() : 0) + ' 天';
      const bk = $('qj-trail-books'); if (bk) bk.textContent = '藏书 ' + books().length + ' 册';
      const live = $('qj-tts-live');
      if (live) { live.textContent = ttsOn() ? '朗读中' : '未在朗读'; live.classList.toggle('on', ttsOn()); }
    } catch (e) {}
  }
  function tickClockRun() {
    const el = () => { const c = $('qj-clock'); if (c) { const d = new Date(); c.textContent = String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); } };
    el();
    try { BF.timers.interval(function () { el(); if (BF.appState.currentPage === 'qj') refreshTrail(); }, 15000); } catch (e) {}
  }

  /* ===== 事件绑定（页内委托一次成型） ===== */
  function bind() {
    const page = $('page-qj');
    if (!page || page.__qjBound) return;
    page.__qjBound = true;
    page.addEventListener('click', function (e) {
      try {
        /* 「出口」就是出口：关掉曲径、回旧首页。想先改设置再走，用旁边那颗「设置」。 */
        if (e.target.closest('#qj-exit')) {
          try { BF.settings.set('qjMode', false); } catch (ex2) { BF.err.report('qj.exit', ex2); }
          BF.app.go('home');
          return;
        }
        if (e.target.closest('#qj-gear')) { if (BF.settingsUI && BF.settingsUI.open) BF.settingsUI.open(); return; }
        const nGo = e.target.closest('[data-qj-go]');
        if (nGo) { go(nGo.getAttribute('data-qj-go')); return; }
        const nSort = e.target.closest('[data-qj-sort]');
        if (nSort) { shelfQ.sort = nSort.getAttribute('data-qj-sort'); go('jia', { noFocus: true }); return; }
        const nOpen = e.target.closest('[data-qj-open]');
        if (nOpen) { try { BF.app.openBook(nOpen.getAttribute('data-qj-open')); } catch (ex) { BF.err.report('qj.openBook', ex); } return; }
        const nCmd = e.target.closest('[data-qj-cmd]');
        if (nCmd) { BF.commands.run(nCmd.getAttribute('data-qj-cmd')); refreshTrail(); return; }
        const nAct = e.target.closest('[data-qj-act]');
        if (nAct) {
          const act = nAct.getAttribute('data-qj-act');
          if (act === 'tts') {
            if (ttsOn()) { BF.tts.stop(); BF.noti.info('朗读已停止'); }
            else if (BF.appState.currentBookId) BF.tts.start();
            else BF.noti.warn('请先打开一本书');
          }
          setTimeout(refreshTrail, 350);
          return;
        }
      } catch (ex) { BF.err.report('qj.click', ex); }
    });
    /* 书架站筛选：重切整段视图，并把焦点与插入点还给输入框 */
    const renderJia = function () {
      const view = document.querySelector('.qj-view[data-qj-v="jia"]');
      if (!view) return;
      view.innerHTML = RENDERERS.jia();
      const q = $('qj-shelf-q');
      if (q) { q.focus(); try { q.setSelectionRange(q.value.length, q.value.length); } catch (ex) {} }
    };
    /* 输入法合成期（拼音还没转成汉字）不能重建视图：合成中的每一次 input 都带着
       半成品字母，重建会连正在拼的字与候选一起换掉，用户看到的是
       「打字没反应 / 半截字母消失」。合成结束时再按最终文本补切一次。 */
    let _composing = false;
    page.addEventListener('compositionstart', function () { _composing = true; });
    page.addEventListener('compositionend', function (e) {
      _composing = false;
      try {
        if (e.target && e.target.id === 'qj-shelf-q') { shelfQ.q = e.target.value; renderJia(); }
      } catch (ex) { BF.err.report('qj.compose', ex); }
    });
    page.addEventListener('input', function (e) {
      try {
        if (e.target.id === 'qj-shelf-q') { shelfQ.q = e.target.value; if (e.isComposing || _composing) return; renderJia(); }
      } catch (ex) { BF.err.report('qj.input', ex); }
    });
    page.addEventListener('keydown', function (e) {
      try {
        if (e.target.id === 'qj-shelf-q' && e.key === 'Enter') {
          const t = document.querySelector('.qj-view[data-qj-v="jia"] .qj-ticket');
          if (t) { e.preventDefault(); t.click(); }
          return;
        }
        /* 卡片聚焦时回车即触发 */
        /* role=button 的卡片空格键也要激活（WAI-ARIA button 语义要求 Enter+Space）。
           全文件其它自绘按钮都是 Enter||' '，这里是唯一漏项；曲径页不在阅读器，
           空格翻页守卫 !inReader 也不接管，按空格此前彻底无反应。 */
        if ((e.key === 'Enter' || e.key === ' ') && e.target.closest && e.target.closest('.qj-card, .qj-ticket, .qj-qcell, .qj-continue, .qj-spine, .qj-qbtn, .qj-node')) { e.preventDefault(); e.target.click(); }
      } catch (ex) { BF.err.report('qj.key', ex); }
    });
    /* 面板 Esc 必须比旧浮层栈先拿到：捕获阶段独享 */
    document.addEventListener('keydown', function (e) {
      try {
        /* 1–5 快速换站：输入焦点在文本框里时不抢 */
        if (BF.appState.currentPage === 'qj' && e.key >= '1' && e.key <= String(STATIONS.length)) {
          const t = e.target;
          const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
          if (!typing) { const st = STATIONS[parseInt(e.key, 10) - 1]; if (st) go(st.id); }
        }
      } catch (ex) { BF.err.report('qj.keycap', ex); }
    }, true);
  }

  /* ===== 开关热切换 ===== */
  function onTgle() {
    try {
      const on = !!(BF.settings && BF.settings.get && BF.settings.get('qjMode'));
      if (on) {
        if (BF.appState.currentPage === 'qj' || BF.appState.currentPage === 'home' || BF.appState.currentPage === 'bookshelf') BF.app.go('home');
        return;
      }

    } catch (e) { BF.err.report('qj.onTgle', e); }
  }

  return {
    init: function () {
      bind();
      drawPath();
      tickClockRun();
      initialized = true;
    },
    open: function () {
      const want = pend; pend = null;
      if (!initialized) { bind(); initialized = true; }
      go(want || cur);
      drawPath();
    },
    /* 外部指定落站：go('bookshelf') 转入时想去书架站 */
    pend: function (id) { pend = id; },
    onTgle: onTgle,
    isOn: function () { return !!(BF.settings && BF.settings.get && BF.settings.get('qjMode')); },
    go: go,
  };
})();

