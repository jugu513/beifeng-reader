/* ================= L4. 导入主流程 ================= */
BF.library.__importing = false;
/* 导入取消：导入全程一个
   AbortController——面板按钮 / ESC / 任务
   中心三路都经 cancelImport 中止。 */
BF.library._importCtrl = null;
BF.library.cancelImport = function () {
  const ctrl = BF.library._importCtrl;
  if (ctrl && !ctrl.signal.aborted) { try { ctrl.abort(); } catch (e) {} return true; }
  return false;
};
BF.library.handleFiles = function (e) {
  const files = [...(e.target.files || [])];
  if (files.length) BF.library.importFiles(files);
  e.target.value = '';
};
/* FSA 原生文件选择器：支持时优先用 showOpenFilePicker（原生对话框、可多选、路径不外露），
   不支持（如 file:// 本地直接打开、旧浏览器）或调用异常时降级为隐藏 <input type=file>，保证永远能导入 */
BF.library.pickAndImport = async function () {
  const fallback = function () { const fi = document.getElementById('file-input'); if (fi) fi.click(); };
  if (typeof window.showOpenFilePicker === 'function') {
    let handles;
    try {
      handles = await window.showOpenFilePicker({
        multiple: true,
        types: [{ description: '文本 / 书籍', accept: { 'text/plain': ['.txt', '.text'], 'application/json': ['.json'] } }],
      });
    } catch (e) {
      if (e && e.name === 'AbortError') return;   /* 用户取消，静默 */
      BF.err.report('fsa.pick', e);
      fallback();   /* 原生调用异常（非取消）回退传统 input，保证可导入 */
      return;
    }
    /* 取文件与导入都要放在选择器的 try 之外：importFile 会主动抛
       （乱码被拦 / 空间不足），落进上面那个 catch 就会再弹一次选择框。 */
    const files = [];
    for (const h of handles) { try { files.push(await h.getFile()); } catch (e) {} }
    if (!files.length) return;
    if (files.length === 1) {
      let res = null;
      try {
        res = await BF.library.importFile(files[0]);
      } catch (e) {
        BF.err.report('import.single', e);
        BF.noti.error((e && e.message) || '导入失败：未知错误');
        return;
      }
      /* 单本导入同样要有成功反馈：按返回的元数据（数据层确认值）
         弹提示，文案与批量入口的「导入完成」汇总一致。 */
      if (res && res.status === 'ok' && res.book) {
        /* 单本导入提示：「《X》导入完成 · N 章 · x 万字」（含「立即阅读」入口） */
        const _b = res.book, _wc = _b.wordCount || 0;
        BF.noti.success('《' + _b.title + '》导入完成 · ' + (_b.totalChapters || 0) + ' 章 · ' + (_wc >= 10000 ? (Math.round(_wc / 1000) / 10) + ' 万字' : _wc + ' 字'),
          (BF.next && BF.next.afterImport) ? BF.next.afterImport(_b.id) : undefined);
      }
    } else {
      /* 批量入口自己汇总成败并出声（见 importFiles），这里不再叠一条 */
      try { await BF.library.importFiles(files); } catch (e) { BF.err.report('import.batch', e); }
    }
    return;
  }
  fallback();
};
BF.library.importFiles = async function (files, batchOpts) {
  if (BF.library.__importing) { BF.noti.warn('导入进行中，请稍候'); return; }
  BF.library.__importing = true;
  /* 一次拖十个文件里若有重名，逐本弹「仍要导入 / 取消」会把整批挂住
     （10 本同名 90 秒仍未结束，且 Promise 永挂）。
     多文件时改成：整批默认跳过重复，一次决定；
     回执给「把这 N 本也导入」的出口，选了就以新书身份再跑一遍这一批。
     单文件导入不动：那本来就该逐本确认，用户也在场。 */
  let _policy = (batchOpts && batchOpts.dupPolicy) ? batchOpts.dupPolicy : ((files && files.length > 1) ? 'skip' : null);
  const dupFiles = [];
  let skipped = 0;   /* 在源头就被拒的文件（空正文 / 超过大小上限）：逐本已出声，末尾只汇总一次 */
  let _firstBook = null;  /* 记录第一本成功导入的书，便于单本时汇总出「《X》导入完成 · N 章 · x 万字」 */
  /* 导入取消：全程一个
     AbortController 贯穿导入链（解码 / 分章 /
     入库）。ESC 与面板「取消导入」按钮都经
     cancelImport 中止；循环与各阶段边界检查
     signal.aborted，命中即停并清理中间态。 */
  const ctrl = new AbortController();
  BF.library._importCtrl = ctrl;
  /* T1：单文件重名确认前移到 openImport 之前——否则 #import-bg 进度层会把 #modal-bg 确认框压在下面，
     且确认 Promise 不接中止信号、取消后卡在 await。这里先确认，确认后再以 dupPolicy:'import' 进 importFile，
     取消则直接返回、不建进度层（复原 __importing / _importCtrl，不挂 _esc 监听）。 */
  const _single = (files && files.length === 1) ? files[0] : null;
  if (_single && !_policy) {
    const _nm = BF.library.cleanName(String(_single.name || ''));
    const _dup = BF.library.isDuplicate(_nm, _single.size);
    if (_dup) {
      const _goOn = await BF.library._askDup(_nm, _dup);
      if (!_goOn) { BF.noti.info('已取消导入《' + _nm + '》'); BF.library.__importing = false; BF.library._importCtrl = null; return; }
      _policy = 'import';
    }
  }
  let ok = 0, fail = 0, dup = 0; const fails = [];
  /* ESC 取消：模态框打开时 Esc 归
     它（重复书确认等），不抢作导入取消 */
  const _esc = function (e) {
    if (e.key !== 'Escape') return;
    /* 输入豁免：焦点在输入控件里时 Esc 归控件本身
       （清空搜索框 / 文本域确认等），不抢作导入取消——否则用户在
       导入挂着时顺手清个搜索框，整批导入就被取消了。 */
    const _t = e.target;
    if (_t && (_t.tagName === 'INPUT' || _t.tagName === 'TEXTAREA' || _t.tagName === 'SELECT' || _t.isContentEditable)) return;
    /* 有更高的层压着就让位 —— 判据是「栈顶是不是我」，不是「点名别人的 class」。
       点名法每加一个浮层都要记得回来补一行，缺一处就是「导入挂着时按 Esc，
       上面那层没关、整批导入先被取消」。 */
    if (BF.sheet.stackTop() !== 'import-bg') return;
    e.preventDefault();
    BF.library.cancelImport();
  };
  document.addEventListener('keydown', _esc);
  BF.app.openImport(ctrl);
  try {
    for (let i = 0; i < files.length; i++) {
      if (ctrl.signal.aborted) break;
      const f = files[i];
      BF.app.setImport(Math.round((i / files.length) * 100), '导入 ' + f.name + '...');
      try {
        const res = await BF.library.importFile(f, { signal: ctrl.signal, dupPolicy: _policy });
        if (res && res.status === 'dup') { dup++; dupFiles.push(f); }
        else if (res && res.status === 'ok') { ok++; if (!_firstBook && res.book) _firstBook = res.book; }
        /* aborted：importFile 内部已回滚中间态，跳出循环 */
        else if (res && res.status === 'aborted') break;
        else skipped++;   /* 空正文 / 超上限：importFile 已逐本说明原因 */
      } catch (err) {
        fail++; fails.push(f.name);
        BF.err.report('importFile:' + f.name, err);
      }
    }
  } finally {
    document.removeEventListener('keydown', _esc);
    BF.library._importCtrl = null;
    BF.app.closeImport();
    BF.library.__importing = false;
    BF.app.renderBookshelf(); BF.app.renderHome();
    if (ctrl.signal.aborted) {
      BF.noti.info('已取消导入' + (ok ? '：成功 ' + ok + ' 本' : '') + (fail ? '，失败 ' + fail + ' 本' : ''));
    } else if (ok || dup || skipped) {
      /* 一条汇总说完全部去向：成功 / 重复 / 源头拒收 / 失败。
         逐本已经出声过「没有可读正文」，末尾再补一句「没有可导入的文件」就是自相矛盾。 */
      const parts = [];
      if (ok || dup) parts.push('成功 ' + ok + ' 本');
      if (dup) parts.push('重复跳过 ' + dup + ' 本');
      if (skipped) parts.push('跳过 ' + skipped + ' 个（没有可读正文或超过大小上限）');
      if (fail) parts.push('失败 ' + fail + ' 本');
      /* 多本只出这一条汇总；单本（恰好 1 本成功）用与单本入口一致的话术
         「《X》导入完成 · N 章 · x 万字」并带「立即阅读」 */
      let _txt, _act;
      if (ok === 1 && _firstBook) {
        const _b = _firstBook, _wc = _b.wordCount || 0;
        _txt = '《' + _b.title + '》导入完成 · ' + (_b.totalChapters || 0) + ' 章 · ' + (_wc >= 10000 ? (Math.round(_wc / 1000) / 10) + ' 万字' : _wc + ' 字');
        _act = (BF.next && BF.next.afterImport) ? BF.next.afterImport(_b.id) : undefined;
      } else {
        _txt = (ok || dup) ? '导入完成：' + parts.join('，') : '没有文件导入成功' + (parts.length ? '：' + parts.join('，') : '');
        _act = dupFiles.length ? { action: { label: '把这 ' + dupFiles.length + ' 本也导入', run: function () { BF.library.importFiles(dupFiles, { dupPolicy: 'import' }); } } } : undefined;
      }
      (ok || dup ? BF.noti.success : BF.noti.info).call(BF.noti, _txt, _act);
    }
    else if (fail) { var _im = '导入失败：' + fails.slice(0, 3).join('、') + (fails.length > 3 ? ' 等' : '') + '。编码无法判定时，用记事本另存为 UTF-8 后重试'; if (BF.feedback) BF.feedback.error(_im, { next: { label: '重新选择文件', run: function () { BF.library.pickAndImport(); } } }); else if (BF.noti) { var _nfA = BF.noti.error || BF.noti.warn; if (_nfA) _nfA.call(BF.noti, _im); } }
    else BF.noti.info('没有可导入的文件');
  }
};
/* 书 id 的唯一生成入口。导入 / 剪贴板 / 在线 / 工坊 / 补 id 五条路径原来各写一遍
   「Date.now() + 随机段」：同一毫秒批量建书时随机段只有 4 位，撞车并非不可能，
   而两本书共用一个 id 会让正文与标注互相覆盖。这里在随机段外再叠一个自增尾。 */
BF.library._bookIdSeq = 0;
BF.library.newBookId = function () {
  BF.library._bookIdSeq = (BF.library._bookIdSeq + 1) % 1296;
  return 'book_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8) + BF.library._bookIdSeq.toString(36);
};
BF.library.FILE_IMPORT_MAX_BYTES = 64 * 1024 * 1024;   /* 本地单文件上限 64MB；在线导入另有 URL_IMPORT_MAX_BYTES（32MB）*/
/* T1：单文件重名确认共用入口。抽出避免 importFiles 前移确认与 importFile 内确认两份文案。
   确认框在 #modal-bg 里，必须在 openImport 之前调用，否则会被 #import-bg 进度层压住。 */
BF.library._askDup = function (name, dupBook) {
  return new Promise(function (res) {
    BF.ask.confirm({
      title: '已存在同名书籍',
      body: '<div style="line-height:1.9;font-size:13px;color:var(--text-dim)">' +
        '书架已有《' + BF.dom.esc(name) + '》<br/>' +
        '导入时间：' + BF.dom.esc(dupBook.importedAt ? new Date(dupBook.importedAt).toLocaleString('zh-CN') : '未知时间') + ' · 章节数：' + (dupBook.totalChapters || 0) + '<br/><br/>' +
        '若这是修订版 / 精校版，可以选择「仍要导入」，将作为一本新书加入书架（不覆盖旧书）。</div>',
      confirmText: '仍要导入',
      cancelText: '取消',
      danger: 1, force: true, op: 'book.importDup', facts: {},
    }).then(function (ok) { res(!!ok); }).catch(function () { res(false); });
  });
};
BF.library.importFile = async function (file, opts) {
  /* 导入取消：各阶段边界检查
     中止信号，命中即停止并返回 aborted——
     正文已入库时逐条回滚（见下方入库后
     检查点），不留孤儿中间态。单本导入
     （pickAndImport 单选）不传 signal，
     此时无取消入口，走完整流程。 */
  opts = opts || {};
  const signal = opts.signal || null;
  const _aborted = function () { return !!(signal && signal.aborted); };
  const rawName = String(file.name || '');
  const name = BF.library.cleanName(rawName);
  /* 体积上限：解码要整本进内存，分章与压缩还要再翻几倍，
     不设上限的表现是「点了没反应」，而不是「这个文件太大」。 */
  if (file && file.size > BF.library.FILE_IMPORT_MAX_BYTES) {
    BF.noti.warn('《' + name + '》约 ' + Math.round(file.size / 1048576) + 'MB，超过 ' +
      Math.round(BF.library.FILE_IMPORT_MAX_BYTES / 1048576) + 'MB 上限，已跳过（可先拆成几本再导入）');
    return { status: 'tooBig' };
  }
  /* 去重检测（提前到解码前，避免重复解码/分章浪费资源）。
     命中时询问「仍要导入 / 取消」，不得静默跳过：
     修订版/精校版同书名但内容不同（≤5% 体积差）会落进重复窗口，
     静默丢弃让用户以为导进来了其实没有。
     选「仍要导入」则生成一本新书（不覆盖旧书）。 */
  const dupBook = BF.library.isDuplicate(name, file.size);
  /* 批量导入时策略由 importFiles 给定：'skip' 直接算重复跳过，
     'import' 直接以新书身份继续 —— 两种都不弹窗，回执统一说，不静默吞。
     没有策略的就是单文件导入：仍逐本确认，修订版/精校版该由人当场决定。 */
  if (dupBook && opts.dupPolicy === 'skip') return { status: 'dup' };
  if (dupBook && !opts.dupPolicy) {
    /* T1：单文件重名确认共用 _askDup（文案只在 _askDup 一处维护）。
       importFiles 已对单文件场景在 openImport 之前确认过；这里覆盖直接调用 importFile 的情况。 */
    const _goOn = await BF.library._askDup(name, dupBook);
    if (!_goOn) { BF.noti.info('已取消导入《' + name + '》'); return { status: 'dup' }; }
  }
  /* 重复书确认后检查中止 */
  if (_aborted()) return { status: 'aborted' };
  /* 读文件缓冲：arrayBuffer() 偶发失败（磁盘抖动/文件句柄瞬时不可用）重试一次，
     仍失败才让导入流程接管——读不到文件与「文件是空的」是两回事，不许混报。 */
  let buf = null;
  try {
    buf = new Uint8Array(await file.arrayBuffer());
  } catch (eAB) {
    BF.err.report('import.arrayBuffer', eAB);
    await new Promise(function (r) { setTimeout(r, 500); });
    buf = new Uint8Array(await file.arrayBuffer());
  }
  /* 读缓冲后检查中止（尚未解码，无状态需清理） */
  if (_aborted()) return { status: 'aborted' };

  if (BF.app && BF.app.setImport) BF.app.setImport(2, '解码《' + name + '》…');
  const histEnc = BF.library.encHistGet(rawName);
  const dec = BF.library.decodeBuffer(buf, histEnc === 'auto' ? (BF.settings.get('encoding') || 'auto') : histEnc);
  const text = dec.text, enc = dec.enc;
  /* 空文件 / 纯空白文件不入库：
     空 buffer 落到「解码失败」会误导：文件没坏，是空的；
     纯空白则照常入库成"空书"，打开显示「本章内容读取失败」——
     把「书本来就是空的」报成数据事故。两种都在源头拒绝、如实说原因。 */
  if (!text || !text.trim()) {
    BF.noti.warn('《' + name + '》没有可读正文（空文件或纯空白），已跳过');
    return { status: 'empty' };
  }
  /* ③ 乱码 / 二进制判定：判据与 URL 通道共用 BF.library.garbleCheck（阈值、ESC 放宽、
     是否拦下都由那一处定，见设置→解析）。不拦下时也要提示，别静默出一本乱码书。 */
  const _g = BF.library.garbleCheck(text, '文件');
  if (_g.blocked) throw new Error(_g.report);
  if (_g.suspect) BF.library.garbleNotice(_g.report);
  else if (dec.confident === false) BF.library.lowConfNotice(name, enc, dec);
  /* 只记有把握的那次：把猜出来的编码写进历史，下次导入会把它当「首选」推到最前，
     一次误判就此固化成永久误判。 */
  if (dec.confident !== false) BF.library.encHistSet(rawName, enc);
  if (BF.app && BF.app.setImport) BF.app.setImport(12, 'AI 分章《' + name + '》…');
  if (BF.app && BF.app.setImport) BF.app.setImport(15, '分章中…');

  /* 分章统一走 BF.smart.chapters（大文件自动切 Worker 线程池），只有这一个入口 */
  const chapters = await BF.smart.chapters(text);
  /* 分章仅在内存、尚未持久化——
     取消即停，无中间态需清理 */
  if (_aborted()) return { status: 'aborted' };
  if (BF.app && BF.app.setImport) BF.app.setImport(40, '写入正文 ' + (chapters ? chapters.length : 0) + ' 章…');

  const id = BF.library.newBookId();
  /* 书名伪章剔除：smart 分章把首行书名识别为第 0 章「正文」
     内容时，若首章为「正文」且首行≈文件名则剔除该行，避免书架出现内容=书名的伪章。
     文件名≠书内首行书名很常见（英文文件名 + 中文书名），只按文件名匹配会失效：
     第 0 章残留 4 字书名，打开书默认看到「正文/书名/本章完」像空书。
     启发式：首章「正文」内容极短（≤20 字）且不含句子标点，且与第 1 章标题不同
     → 判为书名伪章剔除。 */
  try {
    if (chapters[0] && chapters[0].title === '正文') {
      const _nameCmp = String(name || '').trim();
      const _lines = String(chapters[0].content || '').split(/\r?\n/);
      const _first = (_lines[0] || '').trim();
      const _norm = function (x) { return String(x).replace(/[（(].*?[)）]/g, '').trim(); };
      const _matchName = _first && (_first === _nameCmp || _nameCmp.indexOf(_first) >= 0 || _first.indexOf(_nameCmp) >= 0 || _norm(_nameCmp) === _norm(_first));
      /* 启发式：无标点短文本（书名/题记类），且不与第一章标题重复 */
      const _whole = String(chapters[0].content || '').trim();
      const _noPunct = !/[。！？，,.;;:：!?]/.test(_whole);
      const _short = _whole.length <= 20;
      const _ch1 = chapters[1] ? String(chapters[1].title || '').trim() : '';
      const _diffFromCh1 = _ch1 && _norm(_first) !== _norm(_ch1) && _whole.indexOf(_ch1) === -1;
      if (_matchName || (_noPunct && _short && _diffFromCh1)) {
        chapters[0].content = _lines.slice(1).join('\n');
        if (!String(chapters[0].content || '').trim() && chapters.length > 1) chapters.shift();
      }
    }
  } catch (e) { BF.err.report('import.pseudo', e); }
  const book = {
    id, title: name, size: file.size, importedAt: Date.now(),
    totalChapters: chapters.length, currentChapter: 0, lastRead: null,
    starred: false, tags: [], enc, src: 'file',
    wordCount: chapters.reduce((s, c) => s + (c.content || '').length, 0),
    chapterWords: chapters.map(c => (c.content || '').length),  /* 每章字数：进度按字数计算；无则回退章数 */
  };
  /* 正文入库前取消——尚未持久化
     任何状态，直接停止 */
  if (_aborted()) return { status: 'aborted' };
    let _bodyFailed = false;
    try {
      var _putRc = await BF.library.__putChapters(id, chapters, function (doneN, totalN) {
        if (BF.app && BF.app.setImport) BF.app.setImport(40 + Math.round(60 * doneN / (totalN || 1)), '写入正文 ' + doneN + '/' + (totalN || 1) + ' 章…');
      });
    } catch (e) {
      BF.err.report('import.idb', e);
      book._lsFallback = true;
      /* IDB 与本地兜底双双失败 ⇒ 正文一条都没落进去。此时仍把书加进书架，
         用户拿到的是一本「N 章、点开全空」的幽灵书：
         它不在回收站、不会被自愈收走，只能手动再删一次。
         与其留一本读不了的书，不如明说失败、放弃上架。 */
      if (!BF.library.__lsFallback(id, chapters)) _bodyFailed = true;
      else BF.noti.warn('IndexedDB 不可用，已回退本地存储');
    }
    /* 部分批次失败（腾退续写后仍败）：回执口径出声，不上抛——书照常上架，
       缺的章节点开会显示读取失败。 */
    if (!_bodyFailed && _putRc && _putRc.failed > 0) {
      BF.noti.warn('《' + BF.dom.esc(name) + '》已存 ' + _putRc.written + ' 章、失败 ' + _putRc.failed + ' 章（缺章打开会显示读取失败，可释放空间后重新导入续写）');
    }
    if (!_bodyFailed && BF.app && BF.app.setImport) BF.app.setImport(100, '入库完成 · 写书架…');
  /* 正文入库后、meta 提交前取消——
     回滚已入库章节（IDB 逐条删除；LS
     兜底路径同步清 chap_ 键），与下方
     meta 写失败回滚同范式，避免孤儿
     章节残留。 */
  if (_aborted()) {
    for (let _ri = 0; _ri < (book.totalChapters || 0); _ri++) {
      try { await BF.store.idbDelete(BF.store.K.CHAPTERS, id + '_' + _ri); } catch (e) { BF.err.report('import.cancel.rollback.chapter', e); }
    }
    try { await BF.store.idbDelete(BF.store.K.CHAPTER_TITLES, id); } catch (e) { BF.err.report('import.cancel.rollback.titles', e); }
    if (book._lsFallback) {
      for (let _ri = 0; _ri < (book.totalChapters || 0); _ri++) {
        try { BF.store.lsRemove('chap_' + id + '_' + _ri); } catch (e) { BF.err.report('import.cancel.rollback.ls', e); }
      }
    }
    return { status: 'aborted' };
  }
  if (_bodyFailed) {
    /* 正文一条都没落进去 ⇒ 不上架。先把可能写进去的半截章节回滚干净
       （IDB 与 LS 兜底两条路径都清），再明说哪一本失败、为什么。 */
    for (let _bi = 0; _bi < (book.totalChapters || 0); _bi++) {
      try { await BF.store.idbDelete(BF.store.K.CHAPTERS, id + '_' + _bi); } catch (e) { BF.err.report('import.bodyfail.chapter', e); }
      try { BF.store.lsRemove('chap_' + id + '_' + _bi); } catch (e) { BF.err.report('import.bodyfail.ls', e); }
    }
    try { await BF.store.idbDelete(BF.store.K.CHAPTER_TITLES, id); } catch (e) { BF.err.report('import.bodyfail.titles', e); }
    BF.noti.error('《' + BF.dom.esc(name) + '》正文写入失败（存储不可用或空间不足），本书未加入书架。可释放空间后重试。',
      { action: { label: '查看运维台', run: function () { try { if (BF.workbench && BF.workbench.open) BF.workbench.open('data'); } catch (e) { BF.err.report('import.bodyfail.toLog', e); } } } });
    return { status: 'failed', name: name, error: '正文写入失败，本书未加入书架' };
  }
  /* books 声明必须与 importClipboard/importURL 通道对齐：
     漏掉 `const books = ...` 时 books.push(book) 直接 ReferenceError
     → 文件/拖拽导入 100% 崩溃。
     写走 mutate 串行通道，回调内只 push 入参 book、不读回调外状态；
     mutate 返回 false = 写入失败，走下方逐条回滚路径。 */
  const _pushed = await BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
    arr = arr || [];
    arr.push(book);
    return arr;
  });
  /* meta 写失败回滚：meta 写入失败时删除已入库章节，
     避免孤儿章节残留（配合 BF.heal.repairOrphans 双保险） */
  if (_pushed === false) {
    /* idbDelete 的抛错不可吞：此处 fire-and-forget 的拒绝会成为
       unhandled rejection，必须逐条 await + 逐条捕获。 */
    for (let _i = 0; _i < (book.totalChapters || 0); _i++) {
      try { await BF.store.idbDelete(BF.store.K.CHAPTERS, id + '_' + _i); } catch (e) { BF.err.report('import.rollback.chapter', e); }
      /* LS 兜底层的 chap_ 键也要收：chapters 落到 LS 层时正文在这里，
         不清就成永久孤儿（meta 写失败⇒书未上架⇒删书级联和 repairOrphans 都收不到）。
         lsRemove 不存在的键是空操作，无条件调用安全。 */
      try { BF.store.lsRemove('chap_' + id + '_' + _i); } catch (e) { BF.err.report('import.rollback.ls', e); }
    }
    try { await BF.store.idbDelete(BF.store.K.CHAPTER_TITLES, id); } catch (e) { BF.err.report('import.rollback.titles', e); }
    /* 回滚必须连第三层一起收：IDB 失败批写进的 OPFS 分批不在孤儿清单里，谁也收不走 */
    try { await BF.library._dropOpfsBook(id); } catch (e) { BF.log.warn('导入回滚时清理 OPFS 失败：' + (e && e.message)); }
    throw new Error('存储空间不足，本书未加入书架');
  }
  try { BF.bus.emit(BF.EVENTS.BOOKSHELF, book.id); } catch (e) {}
  /* 单本入口也必须重绘书架：没有这一步，原生文件选择器
     pickAndImport 单选 / DSL 工具 importFile 导入后
     「导入成功」书架却无书。此处重绘幂等；
     批量入口的 finally 保留汇总提示不重复。 */
  try { BF.app.renderBookshelf(); BF.app.renderHome(); } catch (e) { BF.err.report('render.afterImport', e); }
  /* 导入 AI 增强：开启且有 key 时，异步生成摘要/标签写回 meta（不阻塞导入完成） */
  /* 导入后 AI 增强：静默判定（不给提示）。此处是导入完成后的后台增强，
   不是用户主动点的功能——为一个可选增强弹一次「需要密钥」是纯噪音。
   真正让用户知道的是 AI 中心里的密钥状态行，不是这里。 */
  if (BF.settings.get('aiImportEnhance') && BF.ai.requireKey('导入增强', { silent: true })) {
    Promise.resolve().then(function () {
      BF.smart.importEnrich(id).then(function (ok) {
        if (ok) { try { BF.app.renderBookshelf(); BF.app.renderHome(); } catch (e) { BF.err.report('render.afterEnrich', e); } }
      }).catch(function (e) { BF.err.report('import.enrich', e); });
    });
  }
  return { status: 'ok', book: book };
};

