/* ================= 24b. 顶栏常驻状态=================
   一条原则：**凡是「在后台跑着」的东西，都必须在顶栏有一处常驻出口。**；
     · 通知只堆在右下角，3.5 秒后自动消失。错过的报错没人知道，
       而 BF.noti 早就在累加 _badge 并 emit 了 NOTI 事件，只是没人消费。

   为什么用 JS 注入而不是改 3 处顶栏 HTML：顶栏有 3 个（首页/书架/阅读器），
   逐一改则以后每加一个页面就得记得再来一遍，漏一处就是「这个页面上没有」。
   这里按 .topbar 统一注入，新页面自动获得。 */
BF.topStatus = (function () {
  const CHIP_HTML =
    '<button class="focus-chip" data-focus-chip hidden title="番茄钟运行中，点击打开工具·专注栏">' +
    '<span class="focus-chip__time">25:00</span>' +
    '<span class="focus-chip__label">专注中</span>' +
    '<span class="focus-chip__bar" style="width:100%"></span></button>';
  const BELL_HTML =
    '<button class="btn btn-sm btn-icon noti-bell" data-noti-bell title="通知中心" aria-label="通知中心">' +
    BF.dom.ic('noti') +
    /* 角标统一用 class（不用 id，避免与静态顶栏重复 id 违规） */
    '<span class="noti-bell__n" hidden>0</span></button>';

  const TASKS_CHIP_HTML =
    '<button class="focus-chip" data-tasks-chip hidden title="后台任务进行中，点击查看">' +
    '<span class="focus-chip__time" data-tasks-n>0</span>' +
    '<span class="focus-chip__label">任务中</span></button>';
  /* 顶栏不挂常驻健康位：备份状态入口在工作台「数据」栏。 */
  function mount() {
    document.querySelectorAll('.topbar').forEach(function (bar) {
      /* 插在 .topbar-spacer 之前：让它贴着右侧按钮区，符合「状态在左、动作在右」的读法 */
      const spacer = bar.querySelector('.topbar-spacer');
      /* tasks/番茄钟 chip 必须总是插入，且插在铃铛防重的 return 之前：
         防重只针对 bell，先 return 会让三处顶栏的 tasks chip 全部插不上。 */
      if (!bar.querySelector('[data-focus-chip]')) {
        const chip = document.createElement('div');
        chip.innerHTML = CHIP_HTML;
        const chipEl = chip.firstElementChild;
        if (spacer && spacer.parentNode) spacer.parentNode.insertBefore(chipEl, spacer);
        else bar.appendChild(chipEl);
      }
      if (!bar.querySelector('[data-tasks-chip]')) {
        const tasks = document.createElement('div');
        tasks.innerHTML = TASKS_CHIP_HTML;
        const tasksEl = tasks.firstElementChild;
        if (spacer && spacer.parentNode) spacer.parentNode.insertBefore(tasksEl, spacer);
        else bar.appendChild(tasksEl);
      }
      /* bell 防重：静态顶栏 HTML 已含通知铃铛（首页/书架/阅读器 3 处），
         已有则跳过 —— 否则每页双份铃铛 */
      if (bar.querySelector('[data-noti-bell]')) return;
      const bell = document.createElement('div');
      bell.innerHTML = BELL_HTML;
      const bellEl = bell.firstElementChild;
      if (spacer && spacer.parentNode) spacer.parentNode.insertBefore(bellEl, spacer);
      else bar.appendChild(bellEl);
    });
    /* 初始同步一次（脚本求值期可能已有过 warn/error） */
    paintBadge();
    if (BF.focus && BF.focus._render) BF.focus._render();
    /* 任务芯片刷新走 BF.jobs 的 onChange 订阅：begin/end/fail/abort/setDetail 都即时触发。
       保留低频兜底轮询（10s）—— 防订阅漏注册/异常情况下芯片长期不刷新；
       面板打开时（paintTasksBody 有渲染）任务详情也随事件即时重绘。 */
    if (!BF.topStatus._tasksTimer) {
      BF.topStatus._tasksTimer = BF.timers.interval(function () { BF.topStatus.paintTasks(); }, 10000);
    }
    if (!BF.topStatus._tasksOff) {
      try {
        BF.topStatus._tasksOff = BF.jobs.onChange(function () {
          BF.topStatus.paintTasks();
          /* 任务面板若正开着，同步刷新明细（秒数/详情会变） */
          if (BF.workbench && BF.sheet && BF.sheet.isOpen && BF.sheet.isOpen(BF.workbench.PANEL_ID) && BF.workbench.isSec('tasks')) {
            BF.topStatus.paintTasksBody();
          }
        });
      } catch (e) { BF.err.report('tasks.sub', e); }
    }
  }
  /* 刷新任务芯片（运行中任务数）。 */
  function paintTasks() {
    let n = 0;
    try {
      if (BF.jobs && BF.jobs.list) n = BF.jobs.list().filter(function (j) { return j.status === 'run'; }).length;
    } catch (e) { n = 0; }
    document.querySelectorAll('[data-tasks-chip]').forEach(function (el) {
      el.hidden = !n;
      const nn = el.querySelector('[data-tasks-n]');
      if (nn) nn.textContent = n;
    });
  }
  /* 任务中心（点芯片展开）。走 BF.sheet，Esc 可关。
     「任务」是工作台的一栏——这里只切栏，内容渲染由
     BF.workbench 承担。 */
  function openTasks() {
    BF.workbench.open('tasks');
  }
  function paintTasksBody() {
    const body = document.getElementById('bf-tasks-body');
    if (!body) return;
    let list = [];
    try { if (BF.jobs && BF.jobs.list) list = BF.jobs.list().filter(function (j) { return j.status === 'run'; }); } catch (e) {}
    /* D5 三态组件：空态走统一组件 */
    if (!list.length) { body.innerHTML = BF.ui.blank({ icon: BF.dom.ic('log'), msg: '没有进行中的任务' }); return; }
    body.innerHTML = list.map(function (j) {
      const sec = Math.max(1, Math.round(j.ms / 1000));
      const cancel = j.ctrl && j.ctrl.abort
        ? '<button class="btn btn-xs" data-tasks-cancel="' + j.id + '" style="margin-left:6px">取消</button>' : '';
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:5px 2px;border-bottom:1px solid var(--border)">' +
        '<span style="color:var(--text)">' + BF.dom.esc(j.label) + '</span>' +
        '<span style="color:var(--text-weak);font-size:11px;flex-shrink:0">' + sec + 's' + cancel + '</span></div>' +
        (j.detail ? '<div style="color:var(--text-weak);font-size:11px;padding:0 2px 4px">' + BF.dom.esc(j.detail) + '</div>' : '');
    }).join('');
    body.querySelectorAll('[data-tasks-cancel]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        try { BF.jobs.abort(parseInt(btn.dataset.tasksCancel, 10)); } catch (e) { BF.err.report('tasks.cancel', e); }
        paintTasksBody(); BF.topStatus.paintTasks();
      });
    });
  }

  function paintBadge() {
    const n = BF.noti.badge();
    /* 角标统一按 class 选择，覆盖全部角标——
       重复 id="noti-bell-n" 违反 HTML 规范，getElementById 只取首页那个。 */
    document.querySelectorAll('.noti-bell__n').forEach(function (el) {
      el.textContent = n > 99 ? '99+' : String(n);
      el.hidden = !n;
    });
  }

  function bind() {
    document.addEventListener('click', function (e) {
      const t = e.target;
      if (t.closest('[data-noti-bell]')) {
        /* 打开通知中心 = 「我看到了」，此时清零角标。
           放在这里而不是 notiCenter.render 里：清空历史与「已读」是两件事，
           用户可能想留着历史慢慢看。 */
        BF.noti.resetBadge(); paintBadge();
        BF.wsUI.openNotiCenter();
        return;
      }
      if (t.closest('[data-focus-chip]')) { BF.wsUI.toggleFocus(); return; }
      /* 点击任务芯片 → 打开任务中心 */
      if (t.closest('[data-tasks-chip]')) { BF.topStatus.openTasks(); return; }
      /* 点击保存失败提示条 → 打开基地的**存储**栏（引导清理空间）。
         入口带栏位：不带就落在上次停留的那一栏，用户点的是「存储写不进去了」。 */
      if (t.closest('[data-savefail]')) { try { BF.base && BF.base.open && BF.base.open('storage'); } catch (e) {} }
    });
  }

  /* 保存失败常驻状态。进度/划线等关键数据写盘失败时置为可见，
     下次成功写入时自动清除。 */
  function setSaveFail(on) {
    document.querySelectorAll('[data-savefail]').forEach(function (el) {
      el.hidden = !on;
    });
  }
  /* mount 时兜底插入保存失败条（三处顶栏，未手动加的自动获得） */
  function mountSaveFail() {
    const HTML = '<span class="tts-status" data-savefail hidden style="color:var(--danger-ink);cursor:pointer" title="数据保存失败，点击打开工作台·数据栏清理空间">⚠ 存储不足</span>';
    document.querySelectorAll('.topbar').forEach(function (bar) {
      if (bar.querySelector('[data-savefail]')) return;
      const spacer = bar.querySelector('.topbar-spacer');
      const wrap = document.createElement('div');
      wrap.innerHTML = HTML;
      const el = wrap.firstElementChild;
      if (spacer && spacer.parentNode) spacer.parentNode.insertBefore(el, spacer);
      else bar.appendChild(el);
    });
  }

  /* 角标监听必须在模块求值期挂：BF.noti 在本模块之后才定义，而脚本求值期与启动早期
     （存储恢复、设置归一）都可能已经弹过吐司。等到 boot 里再订阅，那几次发射既刷不到角标，
     又各留一条「bus.emit 无监听」warn。与点击铃铛后的清零共用同一个 paintBadge，只订阅一次。 */
  try { BF.bus.on(BF.EVENTS.NOTI, paintBadge); } catch (e) {}

  return { mount: mount, bind: bind, paintBadge: paintBadge, setSaveFail: setSaveFail, mountSaveFail: mountSaveFail, paintTasks: paintTasks, openTasks: openTasks, paintTasksBody: paintTasksBody };
})();

BF.selfPackage = (function () {
  const MAX_MB = BF.CONFIG.SELFPKG_MAX_MB;

  /* 取本页 HTML 源码作为外壳，但必须消毒后再取。
     outerHTML 会把运行时渲染出来的 DOM 一起带走，而设置面板的密钥是写成
     `<input type="password" value="…">` 属性放在 #settings-body 里的（escAttr 之后仍是明文），
     所以 payload 那头剥干净了、外壳这头还留着 —— 导出方一打开过「AI 服务 / 语音」分区，
     把包发给别人就等于把自己的服务商密钥一起发出去了。
     做法是克隆一份再洗，活页面一个字节不动：输入控件的值一律清掉（值在属性里，
     只改 property 不会反映到序列化结果，必须摘属性），运行时才填充的面板容器清空 ——
     这些容器在磁盘原文件里本来就是空的，启动后各模块照常重渲染，清空反而更接近原始文件。
     浏览器保存的 outerHTML 与磁盘原文件仍有细微差异（自闭合标签规范化），对单文件阅读器无影响。 */
  function _selfHtml() {
    const root = document.documentElement.cloneNode(true);
    root.querySelectorAll('input, textarea, select').forEach(function (n) {
      if (n.type === 'checkbox' || n.type === 'radio') n.checked = false;
      if (n.type !== 'checkbox' && n.type !== 'radio' && n.type !== 'hidden') { n.removeAttribute('value'); n.value = ''; }
      if (n.tagName === 'TEXTAREA') n.textContent = '';
    });
    ['#settings-body', '#settings-nav', '#modal-box', '#dwb-log'].forEach(function (sel) {
      const n = root.querySelector(sel);
      if (n) n.innerHTML = '';
    });
    return '<!DOCTYPE html>\n' + root.outerHTML;
  }
  /* 注入离线数据包：挂在 window 上的一个常量里。
     注意：源码里任何位置都不能出现字面的 script 闭合标签序列（否则本函数
     所在的 script 块会被浏览器提前截断）。因此闭合标签一律用拼接写法，
     注释里也不写全拼。 */
  function _injectData(html, payload) {
    const json = JSON.stringify(payload);
    const closeTag = '<' + '/script>';
    /* payload 里的 `<` 一律转义成 \\u003c（JSON 合法转义，解析回来还是 `<`，零依赖）。
       原来只匹配「`<` + `/script` + 可选空白 + `>`」这一种形态：正文里写「`<` + `/script` + 空格 + 属性」
       同样会终止 script data，包内脚本被截断，后半截正文成了接收方页面的 HTML —— 恶意 TXT
       就此在收件人机器上执行，读走对方全部本地数据。逐个形态匹配注定漏，所以不认形态只认字符。 */
    const tag = '<script>window.__BF_SELFPKG__=' + json.replace(/</g, '\\u003c') + ';' + closeTag;
    /* 注入点必须是文件末尾那个体闭合标（用 lastIndexOf）——
       String.replace 只换第一个匹配，而导出 HTML 里第一个匹配落在本函数
       自己的源码字符串上，payload 被插进脚本中间，整包一行 JS 都跑不了
       （界面看似有书架的"死页"，实际零数据）。闭合体标同样用拼接写法，
       源码里不出现字面量，与 closeTag 同一纪律。 */
    const closeBody = '<' + '/body>';
    const at = html.lastIndexOf(closeBody);
    return at < 0 ? html + tag : html.slice(0, at) + tag + '\n' + html.slice(at);
  }
  async function build(opts) {
    opts = opts || {};
    /* 大书库逐章串行拉取（几千章就是几千次 IDB 读）必须可观测：
       只有一句「正在打包，请稍候…」时，用户无从判断还要等多久、也无法中止。
       opts.onProgress(done,total,phase) 报进度、
       opts.signal（AbortSignal）在单元边界检查取消。build 本身不碰 UI，
       由 exportPkg 接 BF.jobs 任务中心（与导入同一套表面）。 */
    const onProg = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const signal = opts.signal || null;
    const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || [];
    const chapters = {};
    const titles = {};
    let dropped = 0, totalChars = 0;
    const cap = MAX_MB * 1024 * 1024;
    /* 总单元数 = 每本书 1（书名表）+ 每章 1；先算确定分母，空书架/零章书也不会除零 */
    let total = 0;
    for (const b of books) { if (b && b.id) total += 1 + (b.totalChapters || 0); }
    let done = 0;
    function _tick(phase) {
      done++;
      if (onProg) { try { onProg(done, total, phase); } catch (e) {} }
    }
    function _chk() {
      if (signal && signal.aborted) { const e = new Error('已取消'); e.__bfCancel = true; throw e; }
    }
    for (const b of books) {
      if (!b || !b.id) continue;
      _chk();
      titles[b.id] = await BF.library.getChapterTitles(b.id);
      _tick('titles');
      const list = [];
      let bookChars = 0;   /* 每本书独立计字数，避免跨书累加导致后续整本书被截断成空章 */
      for (let i = 0; i < (b.totalChapters || 0); i++) {
        _chk();
        const t = await BF.library.getChapterText(b, i);
        if (bookChars > cap) { dropped++; list.push(''); _tick('chapter'); continue; }
        bookChars += (t ? t.length : 0);
        totalChars += (t ? t.length : 0);
        list.push(t || '');
        _tick('chapter');
      }
      chapters[b.id] = list;
    }
    /* 设置与笔记整体走 ls，键名与 store.K 一致 */
    const all = {};
    for (const k of BF.store.lsKeys()) {
      if (k === BF.store.K.CORRUPT || k === BF.store.K.LOG || k === BF.store.K.AUTOBACKUPS || k === BF.store.K.DSL_LOG) continue;
      all[k] = BF.store.lsGet(k, null);
    }
    /* 剥离密钥（与 exportFull 同一套规则） */
    if (all[BF.store.K.SETTINGS]) {
      try { all[BF.store.K.SETTINGS] = JSON.parse(JSON.stringify(all[BF.store.K.SETTINGS])); } catch (e) { BF.log && BF.log.warn('storage.设置深拷贝失败：' + (e && e.message)); }
      BF.bk.PRIV_KEYS.forEach(function (kk) { delete all[BF.store.K.SETTINGS][kk]; });
      all[BF.store.K.SETTINGS] = BF.store.stripPresetSecrets(all[BF.store.K.SETTINGS]);
    }
    const payload = {
      version: 1, at: Date.now(), app: '北风阅读器',
      books: books, chapters: chapters, titles: titles, store: all,
      truncatedBooks: dropped,
    };
    return { html: _injectData(_selfHtml(), payload), stats: { books: books.length, chars: totalChars, dropped: dropped } };
  }
  async function exportPkg() {
    let jobId = 0;
    const ctrl = new AbortController();
    try {
      try { BF.noti && BF.noti.info('正在打包，请稍候…', { silent: true }); } catch (e) {}   /* 过程话不入历史，见 downloadBook 同条注释 */
      /* 登记长任务（kind: io），进度经 setDetail 进任务详情——
         顶栏任务芯片、工作台任务栏、运维台进程页都能看到百分比与已拉取数；
         ctrl 让任务中心的「取消」按钮可中止（单元边界生效，与导入同一套做法）。 */
      if (BF.jobs && BF.jobs.begin) {
        try { jobId = BF.jobs.begin('导出自包含离线包', { kind: 'io', detail: '准备…', ctrl: ctrl }); } catch (e) {}
      }
      /* 按百分比变化节流：setDetail 会触发订阅者重绘，几千章只刷约 100 次 */
      let lastPct = -1;
      const r = await build({
        signal: ctrl.signal,
        onProgress: function (done, total, phase) {
          if (!jobId) return;
          const pct = total > 0 ? Math.floor(done * 100 / total) : 100;
          if (pct === lastPct) return;
          lastPct = pct;
          try {
            BF.jobs.setDetail(jobId, pct + '% · ' + (phase === 'titles' ? '读取书目' : '拉取章节') + ' ' + done + '/' + total);
          } catch (e) {}
        }
      });
      const files = [
        { name: 'index.html', data: new TextEncoder().encode(r.html) },
        { name: '使用说明.txt', data: new TextEncoder().encode(
          '北风阅读器 · 自包含离线包\n\n' +
          '用法：解压后双击 index.html 即可阅读，无需联网、无需安装任何东西。\n' +
          '（若包内设置带着在线朗读引擎档，点「朗读」会尝试联网获取语音；纯本地阅读不受影响。）\n' +
          '（浏览器可能提示"是否允许此页面读取本地文件"，选择"是"即可。）\n\n' +
          '包含内容：\n' +
          '  书籍：' + r.stats.books + ' 本\n' +
          '  正文总字数：约 ' + Math.round(r.stats.chars / 1000) + ' 千字\n' +
          (r.stats.dropped ? '  注意：受体积上限限制，有 ' + r.stats.dropped + ' 个章节未打包\n' : '') +
          '\n安全说明：本包已剥离全部 API Key，不会外传任何密钥。\n' +
          '导出时间：' + new Date().toLocaleString('zh-CN') + '\n') },
      ];
      const blob = BF.zip.pack(files);
      /* 保存可能被取消（BF.zip.save → BF.download 返回 false）：
         这时不能说「已导出」，否则界面上报成功、磁盘上没有这个包。 */
      const _saved = await BF.zip.save(blob, '北风离线包_' + new Date().toISOString().slice(0, 10) + '.zip');
      if (_saved) BF.noti.success('自包含包已导出（' + r.stats.books + ' 本书，约 ' + Math.round(blob.size / 1024 / 1024 * 10) / 10 + ' MB）');
    } catch (e) {
      if (e && e.__bfCancel) { try { BF.noti.info('已取消导出'); } catch (e2) {} }
      else {
        BF.err.report('selfPkg.export', e);
        try { BF.noti.error('导出失败：' + ((e && e.message) || e)); } catch (e2) {}
      }
    } finally {
      if (jobId && BF.jobs && BF.jobs.end) { try { BF.jobs.end(jobId); } catch (e) {} }
    }
  }
  /* 离线包模式查询：用户双击离线包里的 index.html 打开后，数据是从包里导入的，
     界面上必须说明这一点——「书都在」不代表这些书的生命周期与普通浏览器存储相同
     （往包里加书不会写回包里）。
     这里是唯一实现，UI（基地环境页）据此展示。 */
  function isOfflinePkg() {
    const p = window.__BF_SELFPKG__;
    return !!(p && p.version === 1);
  }
  function pkgInfo() {
    const p = window.__BF_SELFPKG__;
    if (!p || p.version !== 1) return null;
    return {
      books: (p.books || []).length,
      at: p.at || null,
      dropped: p.truncatedBooks || 0,
      /* 导入是一次性的（restoreSelfPkg 只在无本地数据时跑），所以这里的
         「离线包」只说明数据来源，不说明此后写入的数据会回到包里。 */
      restored: !!window.__BF_SELFPKG_RESTORE__,
    };
  }
  return { build: build, export: exportPkg, _injectData: _injectData, isOfflinePkg: isOfflinePkg, pkgInfo: pkgInfo };
})();

BF.enh.exportBookText = async function (b) {
  const titles = await BF.library.getChapterTitles(b.id);
  let text = '';
  let miss = 0;
  for (let i = 0; i < (b.totalChapters || 0); i++) {
    const title = (titles && titles[i]) || '第' + (i + 1) + '章';
    const r = await BF.library.exportChapterText(b, i, title);
    if (!r.ok) miss++;
    text += title + '\n\n' + r.text + '\n\n';
  }
  /* 缺章出声（按书一次）：全量导出/自包含包里每本都留一条日志，
     比在完成回执里堆一串书名更容易定位到底是哪本缺。 */
  if (miss) BF.log.warn('导出《' + b.title + '》时有 ' + miss + ' 章正文没读到（文件里只有章名）');
  return text;
};
BF.enh.exportAllBooks = async function (asZip) {
  const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
  if (!books.length) { BF.noti.warn('书架为空'); return; }
  BF.noti.info('正在导出 ' + books.length + ' 本书...', { silent: true });   /* 过程话不入历史，见 downloadBook 同条注释 */
  try {
    if (asZip) {
      /* 真 ZIP：全部书籍打成一个包，避免逐个下载弹出的 N 个保存对话框 */
      const enc = new TextEncoder();
      const files = [];
      /* 同名书名不去重会写成两个同名条目，解压时后者盖掉前者：三本进包、两本出包，
         且不报错。基名撞上就加序号，并在完成提示里说明改过几个。 */
      const _usedNames = new Set();
      let _renamed = 0;
      for (const b of books) {
        const text = await BF.enh.exportBookText(b);
        const _safe = (b.title || '未命名').replace(/[\\/:*?"<>|]/g, '_').replace(/\.{2,}/g, '_').slice(0, 80);
        let _name = _safe, _k = 2;
        while (_usedNames.has(_name)) _name = _safe + '_' + (_k++);
        if (_name !== _safe) _renamed++;
        _usedNames.add(_name);
        files.push({ name: _name + '.txt', data: enc.encode(text) });
      }
      const blob = BF.zip.pack(files);
      const _saved = await BF.zip.save(blob, '北风书架-' + new Date().toISOString().slice(0, 10) + '.zip');
      if (_saved) BF.noti.success('已打包导出 ' + books.length + ' 本书（ZIP）' + (_renamed ? '，同名 ' + _renamed + ' 本已加序号' : ''));
    } else {
      for (const b of books) {
        await BF.library.downloadBook(b.id);
      }
      BF.noti.success('已批量导出 ' + books.length + ' 本书');
    }
  } catch (e) { BF.err.report('exportAllBooks', e); BF.noti.error('导出失败'); }
};

