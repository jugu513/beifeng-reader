/* ================= L11. URL 导入 =================
   这条通道必须与文件通道同口径，少一样就是一处静默失败：
   ① 编码 —— `res.text()` 规范上恒按 UTF-8 解，中文站点的 TXT 大量是 GBK：同一本书的
      GBK 版本会解出 889 个字符的替换符，而只靠「长度 < 100」守不住，满屏 \ufffd 照样入库；
   ② 乱码拒收 —— 判据只写在文件通道里就不算有；
   ③ 取消与超时 —— fetch 不带 signal，进度条停在「正在下载」只能干等，也不限体积。
   编码与乱码判据复用文件通道那一处实现，不抄第二份。 */
BF.library.URL_IMPORT_MAX_BYTES = 32 * 1024 * 1024;
BF.library.importURL = async function (url) {
  const ctrl = new AbortController();
  let _timedOut = false;
  const timer = BF.timers.timeout(function () { _timedOut = true; try { ctrl.abort(); } catch (e) {} }, 60000);
  const _aborted = function () { return !!ctrl.signal.aborted; };
  /* 取消入口必须认得这个 ctrl：面板「取消导入」、任务中心「取消」、Esc 三路
     都走 BF.library.cancelImport()，而它只读 _importCtrl。文件通道有登记，
     URL 通道自建 ctrl 而不登记，取消按钮在这条通道上完全无效。 */
  BF.library._importCtrl = ctrl;
  /* 中止后的出口：遮罩必须关。两处 `if (_aborted()) return null;` 直接 return
     会跳过 closeImport ⇒ 全屏遮罩还挂着、Esc 与取消按钮同时失效、整屏不可点击，
     只能刷新页面。 */
  const _abortExit = function () {
    BF.app.closeImport();
    BF.noti.info(_timedOut ? '在线导入超时，已停止' : '已取消在线导入');
    return null;
  };
  try {
    BF.app.openImport(ctrl);
    /* 协议白名单与 AI 端点同一把尺：不该由程序去取 file:/data:/javascript: 这类地址 */
    let u;
    try { u = new URL(String(url || '').trim()); } catch (e) { throw new Error('地址格式不正确'); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('只支持 http(s) 地址（当前是 ' + u.protocol + '）');
    BF.app.setImport(5, '正在下载...');
    const res = await fetch(u.href, { signal: ctrl.signal, cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const MAXB = BF.library.URL_IMPORT_MAX_BYTES;
    const MB = Math.round(MAXB / 1048576);
    const clen = Number(res.headers && res.headers.get ? res.headers.get('content-length') : '') || 0;
    if (clen > MAXB) throw new Error('内容 ' + Math.round(clen / 1048576) + 'MB，超过 ' + MB + 'MB 上限');
    /* 上限得在「边下边看」时生效：服务端不给 content-length（分块传输、或干脆省略）时，
       arrayBuffer() 会把整个响应先吃进内存再检查 —— 一个几百 MB 的链接足够让标签页被系统杀掉。
       读不了流的老浏览器才退回一次性读取，那一支仍由上面的 clen 与下面的字节数两道拦。 */
    let buf;
    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      const parts = [];
      let got = 0;
      for (;;) {
        const it = await reader.read();
        if (it.done) break;
        parts.push(it.value);
        got += it.value.length;
        if (got > MAXB) {
          try { await reader.cancel(); } catch (e) {}
          throw new Error('下载已超过 ' + MB + 'MB 上限，已切断连接（服务端未声明内容长度）');
        }
        if (clen) BF.app.setImport(5 + Math.min(30, Math.round(got / clen * 30)), '正在下载 ' + Math.round(got / 1048576) + ' / ' + MB + 'MB');
      }
      buf = new Uint8Array(got);
      for (let i = 0, o = 0; i < parts.length; i++) { buf.set(parts[i], o); o += parts[i].length; }
    } else {
      buf = new Uint8Array(await res.arrayBuffer());
      if (buf.byteLength > MAXB) throw new Error('下载内容超过 ' + MB + 'MB 上限');
    }
    if (_aborted()) return _abortExit();
    BF.app.setImport(40, '正在解析...');
    const srcName = decodeURIComponent(u.pathname.split('/').pop() || '') || u.hostname;
    /* EPUB 分流（L13）：直链 .epub / PK 魔数走容器解析，不进文本解码与乱码判据——
       与文件通道同一条规矩：失败就如实抛错，不产出半成品书。 */
    let chapters = null;
    let enc = '';
    if (BF.epub && BF.epub.sniff(buf, srcName)) {
      BF.app.setImport(45, '解析 EPUB...');
      let ep = null;
      try { ep = await BF.epub.parse(buf); }
      catch (eEP) { throw new Error('EPUB 解析失败：' + ((eEP && eEP.message) || eEP)); }
      chapters = (ep.chapters || []).filter(function (c) { return c && String(c.content || '').trim(); });
      if (!chapters.length) throw new Error('EPUB 没有可读正文');
      enc = 'utf-8';
    } else {
      /* 编码：响应头 charset 优先，其余交给文件通道那套 BOM / 严格 UTF-8 / GB18030 / GBK / Big5 打分 */
      const ctype = String((res.headers && res.headers.get ? res.headers.get('content-type') : '') || '');
      const csM = ctype.match(/charset=([\w-]+)/i);
      const dec = BF.library.decodeBuffer(buf, csM ? csM[1].toUpperCase() : (BF.settings.get('encoding') || 'auto'));
      const text = dec.text;
      if (!text || !text.trim()) throw new Error('内容为空：该地址没有可读正文');
      if (text.length < 100) throw new Error('内容过短');
      const _g = BF.library.garbleCheck(text, '在线内容');
      if (_g.blocked) throw new Error(_g.report);
      if (_g.suspect) BF.library.garbleNotice(_g.report);
      else if (dec.confident === false) BF.library.lowConfNotice(srcName, dec.enc, dec);
      /* 与文件通道同一条规矩：猜出来的编码不进历史，否则下次导入把它当首选固化 */
      if (dec.confident !== false) BF.library.encHistSet(srcName, dec.enc || 'auto');
      /* 分章走 BF.smart.chapters（大书自动进 Worker 线程池）：与文件通道同一个入口，
         小书结果与 splitChapters 完全一致，大书不再卡主线程 */
      chapters = await BF.smart.chapters(text);
      enc = dec.enc || '';
    }
    if (_aborted()) return _abortExit();
    const name = BF.library.cleanName(decodeURIComponent(u.pathname.split('/').pop() || '在线书籍').replace(/\.(txt|epub)$/i, ''));
    const id = BF.library.newBookId();
    const book = {
      id, title: name, size: buf.byteLength, importedAt: Date.now(),
      totalChapters: chapters.length, currentChapter: 0, lastRead: null,
      starred: false, tags: [], enc: enc, src: 'url',
      wordCount: chapters.reduce((s, c) => s + (c.content || '').length, 0),
      chapterWords: chapters.map(c => (c.content || '').length),  /* 每章字数 */
    };
    BF.app.setImport(70, '正在入库...');
    /* 判重必须在入库之前：若放在 __putChapters 之后，命中重复直接 return，
       会留下一整套不可见的孤儿章节记录（book 未进 BOOKS_META，永远不会被删书级联清理），
       IDB 只增不减。与 importFile 通道的顺序对齐。 */
    if (BF.library.isDuplicate(name, book.size, { src: 'url' })) {
      BF.noti.warn('已存在《' + name + '》，跳过重复导入');
      BF.app.closeImport();
      return null;
    }
    let _bodyFailed = false;
    try {
      var _putRc = await BF.library.__putChapters(id, chapters);
    } catch (e) {
      BF.err.report('import.idb', e);
      book._lsFallback = true;
      /* 与文件通道同判据：双写皆败 ⇒ 正文一条没落进去，不上架「N 章、点开全空」的幽灵书。 */
      if (!BF.library.__lsFallback(id, chapters)) _bodyFailed = true;
      else BF.noti.warn('IndexedDB 不可用，已回退本地存储');
    }
    /* 部分批次失败（腾退续写后仍败）：回执口径出声，不上抛（同文件通道） */
    if (!_bodyFailed && _putRc && _putRc.failed > 0) {
      BF.noti.warn('《' + BF.dom.esc(name) + '》已存 ' + _putRc.written + ' 章、失败 ' + _putRc.failed + ' 章（缺章打开会显示读取失败，可释放空间后重新导入续写）');
    }
    if (_bodyFailed) {
      for (let _bi = 0; _bi < (book.totalChapters || 0); _bi++) {
        try { await BF.store.idbDelete(BF.store.K.CHAPTERS, id + '_' + _bi); } catch (e) { BF.err.report('import.bodyfail.chapter', e); }
        try { BF.store.lsRemove('chap_' + id + '_' + _bi); } catch (e) { BF.err.report('import.bodyfail.ls', e); }
      }
      try { await BF.store.idbDelete(BF.store.K.CHAPTER_TITLES, id); } catch (e) { BF.err.report('import.bodyfail.titles', e); }
      BF.app.closeImport();
      BF.noti.error('《' + BF.dom.esc(name) + '》正文写入失败（存储不可用或空间不足），本书未加入书架。可释放空间后重试。',
        { action: { label: '查看运维台', run: function () { try { if (BF.workbench && BF.workbench.open) BF.workbench.open('data'); } catch (e) { BF.err.report('import.bodyfail.toLog', e); } } } });
      return null;
    }
    /* 写库走 mutate 串行通道。回调内只 push 入参 book。 */
    const _pushed = await BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
      arr = arr || [];
      arr.push(book);
      return arr;
    });
    /* meta 写失败回滚：与 importFile 同一路径（逐条 idbDelete + 逐条 try/catch）。
       URL 通道必须有回滚：meta 写失败否则会留下不可见的孤儿章节。 */
    if (_pushed === false) {
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
    BF.app.setImport(100, '完成');
    BF.app.closeImport();
    BF.app.renderBookshelf(); BF.app.renderHome();
    BF.noti.success('在线导入成功：《' + name + '》 ' + chapters.length + ' 章',
      (BF.next && BF.next.afterImport) ? BF.next.afterImport(book.id) : undefined);
    return book;
  } catch (e) {
    BF.err.report('importURL', e);
    BF.app.closeImport();
    if (e && e.name === 'AbortError') { BF.noti.info(ctrl.signal.aborted && _timedOut ? '在线导入超时，已停止' : '已取消在线导入'); return null; }
    var msg = String((e && e.message) || '');
    /* 空消息或 Failed to fetch 在这条通道上多半是跨域：TXT 直链所在站点没给 CORS 头时
       浏览器直接拦下，页面拿不到任何状态码。不说清这句，用户会一直换链接试。 */
    if (!msg || /failed to fetch|networkerror|load failed|err_/i.test(msg)) {
      msg = '请求没能发出或被浏览器拦下：该地址可能不允许网页直接读取（跨域限制），也可能已失效或网络不通。可以先把它下载到本地，再拖进书架导入。';
    }
    var _um = '在线导入失败：' + msg.slice(0, 160) + '。请检查链接与网络后重试';
    if (BF.feedback) BF.feedback.error(_um, { next: { label: '重试', run: function () { BF.library.promptImportURL(); } } }); else if (BF.noti) { var _nfF = BF.noti.error || BF.noti.warn; if (_nfF) _nfF.call(BF.noti, _um); }
    return null;
  } finally { timer(); BF.library._importCtrl = null; }
};
BF.library.promptImportURL = function () {
  BF.modal.prompt('在线导入', '输入 TXT 文件直链 URL：').then(function (url) {
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) { BF.noti.warn('请输入 http(s) 开头的 URL'); return; }
    BF.library.importURL(url);
  });
};

