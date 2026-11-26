/* ================= BB. 基地（base）：数据资产管理 =================
   约束：备份写入必须 await 并按返回值反馈，失败不能报「已生成自动备份」；
     占用统计不各写一份，基地与运维台各自 lsGet 同样几个 store key 就会漂移；
     样式走类，随四套主题与窄屏自适应。

   职责边界（与运维台互斥，不各做一半）：
     基地 BF.base   —— 「我的数据」：有多少、占多大、能不能救回来。用户视角。
     运维台 BF.diag —— 「程序状态」：日志、进程、能力、任务。开发视角。
   两侧都调 BF.store.usage / BF.store.quota 取同一份算法，不各算各的。

   4 个 tab：总览 / 备份 / 存储 / 环境
   命名空间：挂顶层 BF.base（不要挂 BF.ui，会被整体赋值抹掉；
   顶层会被 autoregister 扫进 BF.modules，模块清单里能看见它）。 */
BF.base = (function () {
  const TABS = [
    { id: 'overview', label: '总览' },
    { id: 'backup', label: '备份记录' },
    { id: 'storage', label: '存储' },
    { id: 'env', label: '环境' },
  ];
  const S = { tab: 'overview' };
  const MAX_LIST = 50;

  function esc(s) { return BF.dom.esc(s); }
  function fmtBytes(n) { return BF.util.fmtBytes(n); }
  function card(v, k, tone) {
    return '<div class="pane-card' + (tone ? ' is-' + tone : '') + '"><div class="pane-card__v">' + esc(v) + '</div><div class="pane-card__k">' + esc(k) + '</div></div>';
  }
  function dot(tone) { return '<span class="pane-dot' + (tone ? ' is-' + tone : '') + '"></span>'; }

  /* ============ 数据收集（与渲染分离） ============ */
  /* 键名只在这里出现一次。运维台 collectOverview 也读同一批 key，
     两边各写一遍 lsGet 就会漂移：新增一类数据要改两处、漏一处就出现
     「总览说 3 本书、存储页说 4 本」的矛盾。 */
  function collect() {
    const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || [];
    const hls = BF.store.lsGetArray(BF.store.K.HIGHLIGHTS, []) || [];
    const bms = BF.store.lsGetArray(BF.store.K.BOOKMARKS, []);
    const vocab = BF.store.lsGetArray(BF.store.K.VOCAB, []);
    const notes = BF.store.lsGetArray(BF.store.K.NOTES, []);
    const daily = BF.store.lsGet(BF.store.K.DAILY, {}) || {};
    const backups = BF.bk.list() || [];
    /* 总字数在这里统计：diag 概览只有「本会话」的性能数据，
       用户真正想知道的是「我一共读过多少字」。 */
    const totalWords = books.reduce(function (s, b) { return s + (b.wordCount || 0); }, 0);
    const totalChapters = books.reduce(function (s, b) { return s + (b.totalChapters || 0); }, 0);
    const readDays = Object.keys(daily).length;
    return {
      books: books, hls: hls, bms: bms, vocab: vocab, notes: notes, daily: daily,
      backups: backups, totalWords: totalWords, totalChapters: totalChapters, readDays: readDays,
      starred: books.filter(function (b) { return b.starred; }).length,
      usage: BF.store.usage(),
    };
  }

  /* ============ 视图 1：总览 ============ */
  function viewOverview(d) {
    let h = '<div class="pane-cards">' +
      card(d.books.length, '书籍', d.books.length ? null : 'warn') +
      card(BF.util.fmtNum(d.totalWords), '总字数') +
      card(BF.util.fmtNum(d.totalChapters), '章节') +
      card(d.readDays, '阅读天数') +
      card(d.hls.length, '划线') +
      card(d.bms.length, '书签') +
      card(d.vocab.length, '生词') +
      card(d.notes.length, '便签') +
      card(d.starred, '收藏') +
      card(d.backups.length, '自动备份', d.backups.length ? null : 'warn') +
      '</div>';

    /* 备份是「能不能救回来」的唯一凭据，空的就要显眼 —— 这也是本面板存在的第一理由 */
    if (!d.backups.length) {
      /* 这里只说明「有没有快照」，不能替开关下结论：开关开着但还没有快照是常态
         （刚装/刚清空），写成「当前没有任何自动备份」会和隔壁「已开启，每 6 小时一份」当场打架。 */
      h += '<div class="pane-hint" style="margin-top:14px"><b>自动备份：' + (BF.settings.get('autoBackup') ? '开' : '关') + ' · 尚无快照。</b>误删书籍或换设备时将无法恢复，建议立刻到「备份」页生成一份。</div>';
    }

    /* 书架与正文库的对账结果由异步补写（#base-recover）：
       索引没了而正文还在时，这里给出「恢复书架」；
       残留量大到自愈不敢自动删时，这里给出「清理残留」。两者都要用户点头。 */
    h += '<div id="base-recover"></div>';

    h += '<div class="pane-sec pane-sec-gap">数据分布</div>';
    h += '<div class="pane-rows">';
    const groups = [
      { k: '阅读记录', n: Object.keys(d.daily).length, cls: 'is-a' },
      { k: '笔记与标记', n: d.hls.length + d.bms.length + d.notes.length + d.vocab.length, cls: 'is-b' },
      { k: '书籍元数据', n: d.books.length, cls: 'is-c' },
    ];
    const sum = groups.reduce(function (s, g) { return s + g.n; }, 0) || 1;
    groups.forEach(function (g) {
      /* Math.max(2, …)：n=0 时 width:0% 与「这条不存在」视觉上无法区分，
         留2% 的空条至少表明「这一类确实查了、确实是 0」。
         算法与存储页的 Math.max(2, …) 保持一致。 */
      h += '<div class="pane-row">' + dot(g.n ? 'ok' : null) +
        '<span class="pane-row__k" style="width:auto;flex:1">' + esc(g.k) + '</span>' +
        '<span class="pane-row__v" style="flex:0 0 46px;text-align:right">' + g.n + '</span>' +
        '<span style="flex:0 0 110px"><span class="pane-bar"><span class="pane-bar__fill" style="width:' +
        Math.max(2, Math.round(g.n / sum * 100)) + '%"></span></span></span></div>';
    });
    h += '</div>';

    /* 交叉入口：统计与运维台是两套实现，
       这里给出双向入口，避免用户在两个面板间猜哪个是「数据」、哪个是「状态」。 */
    h += '<div class="pane-sec pane-sec-gap">相关面板</div>';
    h += '<div class="pane-rows">' +
      '<div class="pane-row"><span class="pane-row__k" style="width:auto;flex:1">阅读统计</span>' +
      '<span class="pane-row__v" style="flex:0 0 auto;color:var(--text-weak)">阅读时长与热力图</span>' +
      '<button class="btn btn-xs" data-base-go="stats">打开</button></div>' +
      '<div class="pane-row"><span class="pane-row__k" style="width:auto;flex:1">运维台</span>' +
      '<span class="pane-row__v" style="flex:0 0 auto;color:var(--text-weak)">运行日志 · 任务 · 能力</span>' +
      '<button class="btn btn-xs" data-base-go="diag">打开</button></div>' +
      '</div>';
    h += viewCorrupt();
    return h;
  }

  /* ============ 视图 2：备份 ============ */
  function viewBackup(d) {
    let h = '<div class="pane-sec">生成与导出' +
      '<span class="pane-sec__act"><span style="font-size:11px;color:var(--text-weak)">最多保留 ' + (BF.CONFIG.BACKUP_MAX || 5) + ' 份</span></span></div>';
    const cd = BF.bk.cryptoDiagnosis();
    h += '<div class="base-acts">' +
      '<button class="base-act" data-base-a="backup">生成自动备份<small>含书籍、笔记、设置与章节正文</small></button>' +
      '<button class="base-act" data-base-a="export">导出备份文件<small>' +
      (cd.encrypted ? '可选择口令加密（AES-GCM）' : '当前环境将导出明文') + '</small></button>' +
      '<button class="base-act" data-base-a="import">导入备份文件<small>覆盖当前数据，需确认</small></button>' +
      '<button class="base-act" data-base-a="allbk">下载全部书籍<small>TXT 打包，换机迁移用</small></button>' +
      '</div>';
    if (!cd.encrypted) {
      h += '<div class="pane-hint" style="color:var(--warning-ink)">加密不可用：' + esc(cd.reason) + '</div>';
    }

    h += '<div class="pane-sec pane-sec-gap">备份历史</div>';
    if (!d.backups.length) {
      h += '<div class="pane-empty">暂无备份。点上方「生成自动备份」建立第一份。</div>';
    } else {
      h += '<div class="pane-rows">' + d.backups.map(function (b, i) {
        const t = new Date(b.at || Date.now()).toLocaleString('zh-CN');
        const _isFile = !!b.file;
        /* 体积：OPFS 文件清单只存轻量元数据（不含正文），体积以「文件」标识，
           不能再用 JSON.stringify 量（那只会量到很小的清单本身）。 */
        let size = '—';
        try { size = _isFile ? '文件' : fmtBytes(JSON.stringify(b).length); } catch (e) { BF.log && BF.log.warn('codec.体积计算失败：' + (e && e.message)); }
        const chN = b.idb && b.idb.chapters && b.idb.chapters.length ? b.idb.chapters.length : 0;
        return '<div class="base-bk">' + dot('ok') +
          '<span class="base-bk__t">' + esc(t) +
          '<small>' + esc(b.type === 'export' ? '手动导出' : '自动') + ' · ' + size + (_isFile ? ' · 含章节正文(OPFS)' : (chN ? ' · 含 ' + chN + ' 章正文' : (b.idb === null ? ' · 正文没读到（别用它恢复全书）' : ' · 无章节正文'))) + '</small></span>' +
          '<button class="btn btn-xs" data-base-restore="' + i + '">恢复</button>' +
          '<button class="btn btn-xs danger" data-base-delbk="' + i + '">删除</button></div>';
      }).join('') + '</div>';
      h += '<div class="pane-hint">最新一份在最上。恢复会<b>覆盖当前全部数据</b>，点「恢复」后仍需二次确认。' +
        (d.backups.length >= (BF.CONFIG.BACKUP_MAX || 5) ? '已达保留上限，再生成会自动挤掉最旧一份。' : '') + '</div>';
    }
    return h;
  }

  /* ============ 视图 3：存储 ============ */
  function viewStorage(d) {
    const u = d.usage;
    let h = '<div class="pane-sec">浏览器配额</div>';
    h += '<div class="pane-rows" id="base-quota"><div class="pane-empty">读取中…</div></div>';

    h += '<div class="pane-sec pane-sec-gap">本地数据占用' +
      '<span class="pane-sec__act"><span style="font-size:11px;color:var(--text-weak)">共 ' + fmtBytes(u.total) +
      (u.skippedTotal ? '（不含备份与日志 ' + fmtBytes(u.skippedTotal) + '）' : '') + '</span></span></div>';
    if (u.failed) {
      h += '<div class="pane-empty">无法读取 localStorage（可能被浏览器禁用或处于隐私模式）</div>';
    } else if (!u.rows.length) {
      h += '<div class="pane-empty">尚无本地数据</div>';
    } else {
      const top = u.rows.slice(0, MAX_LIST);
      const max = top[0] ? top[0].bytes : 1;
      h += '<div class="pane-rows">' +
        '<div class="base-keyrow base-keyrow--head"><span class="base-keyrow__k">键</span>' +
        '<span class="base-keyrow__bar">占比</span><span class="base-keyrow__v">大小</span></div>' +
        /* 正文在 IndexedDB / OPFS，不在 localStorage 明细里：只列 LS 时两本书只显示 9.8 KB，
           用户没法判断「书占了多少」。这一行等配额读完再填（来源合计 − 本地存储）。 */
        '<div class="base-keyrow" id="base-idbrow"><span class="base-keyrow__k">书籍正文（IndexedDB）</span>' +
        '<span class="base-keyrow__bar"><span class="pane-bar"><span class="pane-bar__fill" id="base-idbrow-bar"></span></span></span>' +
        '<span class="base-keyrow__v" id="base-idbrow-v">读取中…</span></div>' +
        top.map(function (r) {
          return '<div class="base-keyrow">' +
            '<span class="base-keyrow__k" title="' + esc('bf_' + r.key) + '">' + esc(r.key) + '</span>' +
            '<span class="base-keyrow__bar"><span class="pane-bar"><span class="pane-bar__fill" style="width:' +
            Math.max(2, Math.round(r.bytes / max * 100)) + '%"></span></span></span>' +
            '<span class="base-keyrow__v">' + fmtBytes(r.bytes) + '</span></div>';
        }).join('') + '</div>';
      if (u.rows.length > MAX_LIST) {
        h += '<div class="pane-hint">共 ' + u.rows.length + ' 个键，按占用倒序只列前 ' + MAX_LIST + ' 个。条宽按当前最大值归一化。</div>';
      }
      h += '<div class="pane-hint">正文与索引在 IndexedDB / OPFS，不在本地存储明细里；「书籍正文」一行 = 来源合计 − 本地存储，含浏览器缓存，按估算看。</div>';
    }

    /* 写入健康（可靠性三档·第③档）：BF.store.wstats 的会话口径逐键账本。
       只列出过事故的键（失败或被腾退救回），零事故时不占版面。 */
    const _ws = BF.store.wstats.snapshot();
    const _wsKeys = Object.keys(_ws).filter(function (k) { return _ws[k].fails > 0 || _ws[k].evicted > 0; });
    h += '<div class="pane-sec base-ws-sec">写入健康（本次会话）</div>';
    if (!_wsKeys.length) {
      h += '<div class="pane-empty">本会话没有写入失败或腾退记录。</div>';
    } else {
      h += '<div class="pane-rows">' + _wsKeys.map(function (k) {
        const e = _ws[k];
        return '<div class="pane-row">' + dot(e.evicted > 0 ? 'warn' : null) +
          '<span class="pane-row__k" title="' + esc(k) + '">' + esc(k) + '</span>' +
          '<span class="pane-row__v base-ws-v">尝试 ' + e.tries + ' · 失败 ' + e.fails +
          (e.evicted ? ' · 腾退救回 ' + e.evicted : '') + '</span></div>';
      }).join('') + '</div>';
      h += '<div class="pane-hint">失败指写入最终没落盘；「腾退救回」指清掉了可重建数据（朗读缓存/AI 摘要/日志等）后写入成功。随诊断报告一并导出。</div>';
    }

    h += '<div class="pane-sec pane-sec-gap">清理与重置</div>';
    h += '<div class="base-acts">' +
      '<button class="base-act" data-base-a="repair">数据修复<small>体检书籍元数据与阅读记录</small></button>' +
      '<button class="base-act" data-base-a="cache">清空缓存<small>清 AI 缓存与历史（可重建），<b>不碰自动备份</b></small></button>' +
      '<button class="base-act is-danger" data-base-a="backups">删除自动备份<small><b>删除后无法找回</b>，恢复数据的最后保险</small></button>' +
      '<button class="base-act is-danger" data-base-a="reset">重置全部数据<small>清空所有本地数据，不可撤销</small></button>' +
      '</div>';
    return h;
  }

  /* ============ 视图 4：环境 ============ */
  function viewEnv(d) {
    const cd = BF.bk.cryptoDiagnosis();
    const caps = (BF.caps && BF.caps.summary) ? BF.caps.summary() : { ok: 0, total: 0, list: [] };
    let h = '<div class="pane-sec">访问环境' +
      '<span class="pane-sec__act"><button class="btn btn-xs" data-base-a="refresh">刷新</button></span></div>';
    h += '<div class="pane-rows">' +
      '<div class="base-env">' + dot(cd.encrypted ? 'ok' : 'warn') +
      '<span class="base-env__k">备份加密</span><span class="base-env__v">' + (cd.encrypted ? '可用（AES-GCM + PBKDF2）' : '不可用，将导出明文') +
      (cd.encrypted ? '' : '<small class="base-env__note">' + esc(cd.reason) + '</small>') + '</span></div>' +
      '<div class="base-env">' + dot('ok') +
      '<span class="base-env__k">访问方式</span><span class="base-env__v is-mono" style="font-size:11px">' +
      esc(cd.proto + '//' + cd.host) + (cd.isLocal ? '（本地）' : '（远程）') + '</span></div>' +
      '<div class="base-env">' + dot('ok') +
      '<span class="base-env__k">自动备份</span><span class="base-env__v">' +
      (BF.settings.get('autoBackup') ? '已开启，每 6 小时一份' : '已<b>关闭</b>，只在此手动生成') + '</span></div>' +
      '<div class="base-env">' + dot('ok') +
      '<span class="base-env__k">导出询问</span><span class="base-env__v">' +
      (BF.settings.get('askOnExport') ? '每次导出都询问是否加密' : '直接导出明文') + '</span></div>' +
      '<div class="base-env">' + dot('ok') +
      '<span class="base-env__k">存储占用</span><span class="base-env__v">' + fmtBytes(d.usage.total) + '</span></div>';
    /* 离线包模式：只在自包含包里才出现。普通用户多一行毫无意义，
       而包里用户恰恰最需要知道数据的来源与去向 —— 往阅读器里新导入的书
       不会写回那个 zip，必须靠这一行说清楚。 */
    const pk = (BF.selfPackage && BF.selfPackage.pkgInfo) ? BF.selfPackage.pkgInfo() : null;
    if (pk) {
      h += '<div class="base-env">' + dot('warn') +
        '<span class="base-env__k">运行模式</span><span class="base-env__v">自包含离线包（数据来自包内）' +
        '<small class="base-env__note">共 ' + pk.books + ' 本' +
        (pk.at ? ' · 打包于 ' + new Date(pk.at).toLocaleString('zh-CN') : '') +
        (pk.dropped ? ' · 有 ' + pk.dropped + ' 章因体积上限未打包' : '') +
        '。在此新增或修改的数据只写入浏览器本地存储，不会写回 zip 文件。</small></span></div>';
    }
    h += '</div>';

    h += '<div class="pane-sec pane-sec-gap">浏览器能力</div>';
    h += '<div class="pane-rows">' + (caps.list.length ? caps.list.map(function (c) {
      return '<div class="pane-row">' + dot(c.ok ? 'ok' : 'warn') +
        '<span class="pane-row__k">' + esc(c.label) + '</span>' +
        '<span class="pane-row__v" style="color:var(--text-weak)">' + esc(c.detail || '') + '</span></div>';
    }).join('') : '<div class="pane-empty">探测失败</div>') + '</div>';
    h += '<div class="pane-hint">可用 ' + caps.ok + ' / ' + caps.total + ' 项。' +
      (caps.degraded ? '标黄项在当前访问方式下不可用，通常有降级路径，不影响基本阅读。' : '全部可用。') +
      ' 检测逻辑与运维台「存储」页同源（BF.caps）。</div>';
    return h;
  }

  /* ============ 面板骨架 ============
     基地不自建浮窗——骨架与栏导航由
     BF.workbench 提供（「数据」栏），四个子页
     （总览 / 备份 / 存储 / 环境）作为栏内子页签渲染。
     「立即备份」「导出」由工作台底栏以
     data-base-a 委托承担，行为路径不变。 */
  function open(tab) {
    if (tab) S.tab = tab;
    BF.workbench.open('data');
  }
  /* 入口是切换（基地恒为工作台「数据」栏）。 */
  function toggle(tab) {
    if (BF.sheet.closable(BF.workbench.PANEL_ID, 'data')) { BF.sheet.close(BF.workbench.PANEL_ID); return false; }
    open(tab); return true;
  }

  /* ============ 损坏隔离区 ============
     只读列表 + 导出 + 单键清除。不进「清空临时数据」的批量范围：
     隔离区里的原文是「刚才那一下读坏了」的唯一凭据，被顺手清掉就再无对账可能。
     脱敏沿用既有三件套（隐私键删除 + 预设内嵌密钥剥离 + 自由文本掩码），不另写一份。 */
  function _scrubCorruptValue(raw) {
    const s = String(raw == null ? '' : raw);
    let out = s;
    try {
      const obj = JSON.parse(s);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
        const cp = JSON.parse(JSON.stringify(obj));
        BF.store.PRIV_KEYS.forEach(function (kk) { delete cp[kk]; });
        out = JSON.stringify(BF.store.stripPresetSecrets(cp), null, 2);
      }
    } catch (e) { /* 不是设置对象（多半正是"读坏"的那半截），原样交给自由文本掩码 */ }
    return BF._scrubForDisk ? BF._scrubForDisk(out) : out;
  }
  function _corruptMap() {
    const c = BF.store.lsGet(BF.store.K.CORRUPT, null);
    return (c && typeof c === 'object') ? c : null;
  }
  function viewCorrupt() {
    const c = _corruptMap();
    const keys = c ? Object.keys(c).filter(function (k) { return c[k] != null; }) : [];
    let h = '<div class="pane-sec bf-corrupt-sec">损坏隔离区';
    if (keys.length) h += '<span class="pane-sec__act"><button class="btn btn-xs" data-base-a="exportCorrupt">导出隔离区</button></span>';
    h += '</div>';
    if (!keys.length) {
      h += '<div class="pane-empty">没有损坏数据。存储里的数据被读坏时，原文会备份到这里，再把该项重置为默认值。</div>';
      return h;
    }
    h += '<div class="pane-hint">这些键的原文被读坏，已备份到隔离区、原键已重置为默认值。导出文件已脱敏（移除密钥 / PIN 等），但<b>这份文件可能仍含敏感内容，不要发给别人</b>。</div>';
    h += '<div class="pane-rows">';
    keys.forEach(function (k) {
      const raw = c[k];
      const bytes = typeof raw === 'string' ? raw.length : JSON.stringify(raw || '').length;
      const t = BF.store.corruptTime ? BF.store.corruptTime(k) : null;
      const ts = t ? new Date(t).toLocaleString('zh-CN') : '—';
      h += '<div class="base-keyrow">' +
        '<span class="base-keyrow__k" title="' + esc('bf_' + k) + '">' + esc(k) + '</span>' +
        '<span class="base-keyrow__bar">' + esc(ts) + '</span>' +
        '<span class="base-keyrow__v">' + fmtBytes(bytes) +
        ' <button class="btn btn-xs danger" data-base-a="clearCorrupt" data-corrupt-k="' + esc(k) + '">清除</button></span>' +
        '</div>';
    });
    h += '</div>';
    return h;
  }
  async function exportCorrupt() {
    const c = _corruptMap();
    const keys = c ? Object.keys(c).filter(function (k) { return c[k] != null; }) : [];
    if (!keys.length) { BF.noti.warn('隔离区为空，无可导出'); return; }
    const ok = await BF.ask.confirm({
      title: '导出损坏隔离区',
      body: '将导出 ' + keys.length + ' 条读坏原文到文本文件。<br/>文件已脱敏（移除密钥 / PIN 等隐私键），但<b>这份文件可能仍含敏感内容，不要发给别人</b>。',
      confirmText: '导出', danger: 2, op: 'base.exportCorrupt', facts: {},
    });
    if (!ok) return;
    const lines = ['北风 · 损坏隔离区导出', '导出时间：' + new Date().toLocaleString('zh-CN'), '条目数：' + keys.length,
      '（已脱敏：移除隐私键，并对自由文本中的密钥形态做掩码；仍可能含其它敏感内容，请勿外发）', ''];
    keys.forEach(function (k) {
      const raw = c[k];
      lines.push('=== ' + k + ' ===');
      lines.push('大小：' + (typeof raw === 'string' ? raw.length : JSON.stringify(raw || '').length) + ' 字符');
      const t = BF.store.corruptTime ? BF.store.corruptTime(k) : null;
      lines.push('进入时间：' + (t ? new Date(t).toLocaleString('zh-CN') : '未知'));
      lines.push('');
      lines.push(_scrubCorruptValue(raw));
      lines.push('');
    });
    const d = new Date();
    const name = '北风_损坏隔离区_' + d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0') + '_' +
      String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0') + '.txt';
    await BF.exportBlob(name, lines.join('\n'), { mime: 'text/plain;charset=utf-8' });
  }
  async function clearCorruptKey(k) {
    if (!k) return false;
    const ok = await BF.ask.confirm({
      title: '清除损坏隔离区条目',
      body: '将永久删除隔离区中的「' + esc(k) + '」备份。<br/>这是读坏时的原文副本，删除后无法找回（原键已是默认值）。',
      confirmText: '删除该条目', danger: 2, op: 'base.clearCorrupt', facts: {},
    });
    if (!ok) return false;
    if (!BF.store.corruptClear(k)) { BF.noti.warn('该条目已不存在'); return false; }
    BF.noti.success('已清除隔离区条目：' + k);
    return true;
  }

  /* ============ 渲染 ============
     渲染目标是工作台内容区 #wb-body，
     且仅在工作台处于「数据」栏时才重画，避免
     越栏覆盖其他栏内容。子页签（总览 / 备份 / 存储 /
     环境）由本函数输出，与视图内容同块重渲染。 */
  function render() {
    const body = document.getElementById('wb-body');
    if (!body) return;
    if (!(BF.workbench && BF.workbench.isSec && BF.workbench.isSec('data'))) return;
    const scroll = body.scrollTop;
    const d = collect();
    let h = '';
    h += '<nav class="pane-tabs" role="tablist" style="margin-bottom:var(--sp-3)">' + TABS.map(function (t) {
      return '<button class="pane-tab" role="tab" data-base-tab="' + t.id + '" aria-selected="false">' + esc(t.label) + '</button>';
    }).join('') + '</nav>';
    if (S.tab === 'overview') h += viewOverview(d);
    else if (S.tab === 'backup') h += viewBackup(d);
    else if (S.tab === 'storage') h += viewStorage(d);
    else if (S.tab === 'env') h += viewEnv(d);
    body.innerHTML = '<div class="pane-view" role="tabpanel" data-base-view="' + S.tab + '">' + h + '</div>';
    document.querySelectorAll('[data-base-tab]').forEach(function (b) {
      const on = b.dataset.baseTab === S.tab;
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    body.scrollTop = scroll;
    /* 配额是异步的，渲染完再补，避免阻塞首屏 */
    if (S.tab === 'storage') {
      const q = document.getElementById('base-quota');
      if (q) {
        q.innerHTML = '<div class="pane-empty">读取中…</div>';
        (async function () {
          const est = await BF.store.quota();
          if (!q.isConnected) return;
          if (!est) { q.innerHTML = '<div class="pane-empty">当前环境不提供配额信息</div>'; return; }
          const pct = est.pct;
          const tone = BF.store.quotaTone(pct);
          const w = Math.min(100, Math.max(2, pct));
          q.innerHTML =
            '<div class="pane-row"><span class="pane-row__k">已用</span><span class="pane-row__v">' + fmtBytes(est.usage) + (est.degraded ? '（下限，未能读完）' : '') + '</span></div>' +
            '<div class="pane-row"><span class="pane-row__k">配额</span><span class="pane-row__v">' + (est.quota ? fmtBytes(est.quota) + (est.proxy ? '（浏览器不提供，按 5M 字符上限≈10MB 估）' : '') : '未知') + '</span></div>' +
            '<div class="pane-row"><span class="pane-row__k">占用率</span>' +
            '<span class="pane-row__v" style="flex:0 0 44px;text-align:right">' + pct.toFixed(1) + '%</span></div>' +
            '<div style="padding:8px 12px"><span class="pane-bar"><span class="pane-bar__fill ' + tone + '" style="width:' + w + '%"></span></span></div>';
          if (pct > BF.store.QUOTA_WARN) {
            q.innerHTML += '<div class="pane-hint" style="padding:0 12px 10px' +
              (pct > BF.store.QUOTA_ALERT ? ';color:var(--danger-ink)' : ';color:var(--warning-ink)') + '">' +
              (pct > BF.store.QUOTA_ALERT ? '空间紧张' : '空间偏紧') +
              '：建议导出备份后清理缓存，或删除不再需要的书籍。</div>';
          }
          /* 正文那行：来源合计减本地存储。estimate 是来源级的（含缓存与 IndexedDB 全部），
             所以报「估算」，并把两个减数写进 title，免得用户拿它当精确值去对账。 */
          const idbV = document.getElementById('base-idbrow-v');
          const idbBar = document.getElementById('base-idbrow-bar');
          if (idbV) {
            const u2 = BF.store.usage();
            const body = Math.max(0, (est.usage || 0) - (u2.total || 0));
            idbV.textContent = fmtBytes(body) + '（估）';
            idbV.title = '来源合计 ' + fmtBytes(est.usage || 0) + ' − 本地存储 ' + fmtBytes(u2.total || 0);
            if (idbBar) {
              const maxB = Math.max(body, (u2.rows[0] && u2.rows[0].bytes) || 1);
              idbBar.style.width = Math.max(2, Math.round(body / maxB * 100)) + '%';
            }
          }
        })();
      }
    }
    /* 对账区：可恢复的本数与扣住的残留条数都要读 IDB，异步补写，不挡首屏 */
    if (S.tab === 'overview') {
      const rec = document.getElementById('base-recover');
      if (rec) {
        (async function () {
          let html = '';
          try {
            const n = await BF.heal.shelfRestoreCandidate();
            if (n) html += '<div class="pane-hint"><b>本机正文库里还留着 ' + n + ' 本书的分章记录，书架上却没有它们。</b>' +
              '恢复会把这些书重新登记回书架（书名取自各自的第一章），正文与标注不受影响。' +
              '<button class="btn btn-xs" data-base-a="reshelf">恢复书架</button></div>';
          } catch (e) { BF.err.report('base.recover.shelf', e); }
          try {
            const held = BF.heal.orphanHold();
            if (held) html += '<div class="pane-hint">检测到至少 ' + held.books + ' 本书的正文不属于书架上的任何书' +
              '（正文 ' + held.chapters + ' 段 · 目录 ' + held.titles + ' 组，已达扫描上限，实际可能更多），未自动清理。' +
              '确认这些书真的不要了再删，删除后无法找回。' +
              '<button class="btn btn-xs danger" data-base-a="cleanorphans">清理残留</button></div>';
          } catch (e2) { BF.err.report('base.recover.hold', e2); }
          if (rec.isConnected) rec.innerHTML = html;
        })();
      }
    }
    try { BF.app.sel.scan(body); } catch (e) {}
  }

  /* ============ 动作 ============ */
  /* backup 必须 await：autoNow 是 async，不 await 就先弹「已生成」并重画，
     快照失败（配额满 / 序列化异常）时用户看到的仍是成功文案，
     直到下次打开面板才发现备份根本没进去。
     成功提示由 BF.bk.autoNow 自己发（带份数），这里不再重复弹。 */
  async function doAction(kind, el) {
    try {
      if (kind === 'backup') {
        await BF.bk.autoNow();   // 失败会抛到下面的 catch，由统一出口报错
      } else if (kind === 'export') {
        BF.bk.exportWithAsk(); return;
      } else if (kind === 'import') {
        /* 复用设置页那个隐藏 file input，避免维护第二份文件选择器 */
        let inp = document.getElementById('backup-input');
        if (!inp) {
          inp = document.createElement('input');
          inp.type = 'file'; inp.id = 'backup-input'; inp.accept = '.json';
          inp.style.display = 'none'; inp.setAttribute('data-backup-file', '');
          document.body.appendChild(inp);
        }
        inp.click(); return;
      } else if (kind === 'allbk') {
        BF.enh.exportAllBooks(false); return;
      } else if (kind === 'repair') {
        /* 分项修复：BF.heal.run 把三件事捆在一起，用户看不出修了什么。
           这里分别调并报出结果，让「数据修复」这个按钮有可解释的反馈。 */
        const b = await BF.heal.repairBooks();
        const d = BF.heal.repairDaily();
        const q = await BF.store.quotaCheck();
        const parts = [];
        parts.push('书籍元数据：修复 ' + b.fixed + ' 本' + (b.dropped ? '，剔除 ' + b.dropped + ' 条异常' : ''));
        parts.push('阅读记录：清理 ' + d.fixed + ' 条');
        if (q) parts.push('存储占用 ' + q.pct.toFixed(0) + '%');
        BF.noti.success('体检完成 · ' + parts.join(' · '));
      } else if (kind === 'reshelf') {
        /* 反馈由 BF.heal.restoreShelf 自己发（恢复几本、几本字数无从还原），
           这里只负责重画，不再叠第二条提示。 */
        await BF.heal.restoreShelf(); return;
      } else if (kind === 'cleanorphans') {
        /* 问前先验：确认框里的数当场从正文库查，不拿上一次自愈留下的快照凑数。
           查不到就不问、不删 —— 拿着假设去要一个「不可找回」的同意，是拿确认当形式。 */
        const facts = await BF.heal.orphanFacts();
        if (!facts) { BF.noti.warn('书架或正文库此刻读不到，先不处理残留清理'); return; }
        if (!facts.chapters && !facts.titles && !facts.opfs) { BF.noti.info('当前没有需要清理的残留正文'); return; }
        const ok = await BF.ask.confirm({
          title: '清理无所属书籍的正文',
          body: '将删除 {books} 本书遗留的正文 {chapters} 段 · 目录 {titles} 组 · 分批正文 {opfs} 本。<br/>' +
            '这些正文不属于书架上的任何一本书，删除后无法找回。' +
            '如果书还在回收站里，从回收站恢复即可，不用在这里清理。',
          confirmText: '清理残留', danger: 3, op: 'heal.cleanOrphans', facts: facts,
        });
        if (!ok) return;
        const r = await BF.heal.repairOrphans(true);
        /* 回执只说真删掉多少；一条没删时把原因摊开，不报「已清理 0 段」这种自相矛盾的话 */
        BF.noti.success((r.chapters || r.titles || r.opfsBooks)
          ? '已清理无所属书籍的正文 ' + r.chapters + ' 段、目录 ' + r.titles + ' 条' + (r.opfsBooks ? '、分批正文 ' + r.opfsBooks + ' 本' : '')
          : '没有执行清理：' + (r.skipped || '书架或正文库此刻读不到，先不删'));
      } else if (kind === 'cache') {
        /* 确认已内聚于 clearTransients（BF.ask danger=2，
           文案明示不碰自动备份）—— 此处不再叠加 modal，
           同一操作两套确认是体验事故。 */
        const r = await BF.store.clearTransients();
        if (r && r.cancelled) return;
        BF.noti.success('已清理 ' + ((r && r.cleared) || 0) + ' 项临时数据');
      } else if (kind === 'backups') {
        /* 自动备份独立入口 —— 确认内聚于 clearBackups
           （BF.ask danger=2，文案明示「删除后无法找回」）。 */
        const r = await BF.store.clearBackups();
        if (r && r.cancelled) return;
        BF.noti.success('已删除全部自动备份（删除后无法找回）');
      } else if (kind === 'reset') {
        /* 确认内聚于 BF.bk.resetAll（danger 3 + 敲 y），此处不再二次弹窗——
           同一操作连弹两窗是体验事故。 */
        BF.bk.resetAll(); return;
      } else if (kind === 'refresh') {
        /* 只是重画，但走 doAction 能复用末尾的 render 与 try/catch */
      } else if (kind === 'exportCorrupt') {
        /* 确认内聚在 exportCorrupt（BF.ask danger=2，文案写明导出件仍可能含敏感内容）；
           只读不改动，无需重画 */
        await exportCorrupt(); return;
      } else if (kind === 'clearCorrupt') {
        /* 同上，确认内聚在 clearCorruptKey；删掉了就必须重画，
           否则吐司说「已清除」而列表里那一行还挂在屏幕上。 */
        const k = el && el.dataset ? el.dataset.corruptK : null;
        if (await clearCorruptKey(k)) render();
        return;
      } else { return; }
    } catch (e) {
      BF.err.report('base.action:' + kind, e);
      BF.noti.error('操作失败：' + (e && e.message || '未知错误'));
    }
    render();
  }

  return { open: open, toggle: toggle, render: render, action: doAction, collect: collect, TABS: TABS, state: S };
})();

/* 基地交互：全部走事件委托。
   与运维台同理——备份/存储页会整块重渲染，绑在元素上的监听器会丢。 */
(function () {
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (!t.closest) return;
    const tab = t.closest('[data-base-tab]');
    if (tab) { BF.base.state.tab = tab.dataset.baseTab; BF.base.render(); return; }
    if (t.closest('[data-base-restore]')) {
      BF.bk.restoreAt(parseInt(t.closest('[data-base-restore]').dataset.baseRestore, 10));
      /* restoreAt 内部走 BF.ask 异步回调，恢复完成后自动 onChanged 触发重画；
         这里先刷一次把「已删除某份」的中间态纠正掉。*/
      setTimeout(function () { BF.base.render(); }, 300);
      return;
    }
    if (t.closest('[data-base-delbk]')) {
      BF.bk.delAt(parseInt(t.closest('[data-base-delbk]').dataset.baseDelbk, 10));
      BF.base.render(); return;
    }
    const go = t.closest('[data-base-go]');
    if (go) {
      /* 统计与运维都在工作台内，直接切栏 */
      const to = go.dataset.baseGo;
      if (to === 'stats') BF.workbench.open('stats');
      else if (to === 'diag') BF.workbench.open('diag');
      return;
    }
    const act = t.closest('[data-base-a]');
    if (act) { BF.base.action(act.dataset.baseA, act); return; }
  });
})();

