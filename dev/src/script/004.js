/* ================= 2b. BF.sync 跨标签页同步（数据面，仅广播 kind） =================
   标注/进度/设置等变更经 BF.bus 广播后，此处把变更「种类」转发到
   BroadcastChannel（消息只带 kind 不带数据 —— 对端从自己的 IndexedDB 重新拉取，
   避免把大体积正文/标注在标签间反复搬运）。收到对端消息后本地重新 emit
   BF.EVENTS.SYNC_REMOTE，让监听方刷新。不回环：SYNC_REMOTE 不在广播集合内。
   SYNC_REMOTE 有统一订阅器按 kind 分发到既有重渲染函数；
   分发只做「重新拉取 + 重渲染」，不写数据——数据真源在各标签页自己的
   IndexedDB，避免跨标签并发写竞争。 */
BF.sync = (function () {
  const CHANNEL = 'beifeng-sync';
  /* 纳入跨标签同步的本地事件：取值匹配 BF.EVENTS，与事件总线扩面一一对应 */
  const BCAST = [
    BF.EVENTS.SETTINGS, BF.EVENTS.BOOKSHELF, BF.EVENTS.ANNOTATION, BF.EVENTS.READING_STATE,
    BF.EVENTS.PROGRESS, BF.EVENTS.BOOK_ADDED, BF.EVENTS.BOOK_DELETED, BF.EVENTS.IMPORT_DONE,
    BF.EVENTS.EXPORT_DONE, BF.EVENTS.TTS, BF.EVENTS.SEARCH, BF.EVENTS.AI_CONTEXT
  ];
  let _bc = null;
  let _started = false;
  function post(ev) { try { if (_bc) _bc.postMessage({ kind: ev }); } catch (e) {} }
  /* 统一订阅器：按 kind 分发到既有重渲染函数（模块加载时即注册，
     与通道开闭无关——启动期断言「SYNC_REMOTE 监听数 ≥ 1」因此
     不依赖 heal.run 与 boot 断言的先后顺序）。 */
  function _dispatch(ev) {
    try {
      switch (ev) {
        case BF.EVENTS.SETTINGS:
          /* 先把本标签页 200ms 防抖窗口内的在途改动落盘，再读远端快照。
             否则 load() 会用 LS 里的旧值整体替换 _s，抹掉本地刚 set 还没落盘的键；
             更糟的是随后本地 _saveT 到期又把旧值写回并广播，把错值扩散回所有标签。
             save(true) 立即落盘并清 dirty，last-write-wins，不会 ping-pong。 */
          if (BF.settings && BF.settings.save) { try { BF.settings.save(true); } catch (e) {} }
          if (BF.settings && BF.settings.load) BF.settings.load();
          if (BF.theme && BF.theme.apply) BF.theme.apply();
          /* 跨标签同步到达时若设置面板正开着，其分区缓存需标脏才能在下次渲染显示新值。
             广播载荷只带 kind 不带具体键，走 markDirty 的未知键→全分区标脏保守分支。 */
          if (BF.settingsUI && BF.settingsUI.markDirty) { try { BF.settingsUI.markDirty(); } catch (e) {} }
          break;
        case BF.EVENTS.BOOKSHELF:
        case BF.EVENTS.BOOK_ADDED:
        case BF.EVENTS.BOOK_DELETED:
        case BF.EVENTS.IMPORT_DONE:
        case BF.EVENTS.EXPORT_DONE:
          if (BF.app && BF.app.renderBookshelf) BF.app.renderBookshelf();
          if (BF.app && BF.app.renderHome) BF.app.renderHome();
          if (BF.library && BF.library.refreshTagFilter) BF.library.refreshTagFilter();
          break;
        case BF.EVENTS.ANNOTATION:
          /* 标注：阅读页重套高亮 + 刷新抽屉；书架页重渲染书卡（标注计数） */
          if (BF.appState && BF.appState.currentPage === 'reader') {
            if (BF.reader && BF.reader.applyHighlights) BF.reader.applyHighlights();
            if (BF.reader && BF.reader.refreshDrawer) BF.reader.refreshDrawer();
          }
          if (BF.app && BF.app.renderBookshelf) BF.app.renderBookshelf();
          break;
        case BF.EVENTS.READING_STATE:
        case BF.EVENTS.PROGRESS:
          /* 进度：书架卡「继续阅读」+ 首页最近阅读；阅读页内的进度条
             由本地 PROGRESS 链（mr._updateTop 等）自行处理 */
          if (BF.app && BF.app.renderBookshelf) BF.app.renderBookshelf();
          if (BF.app && BF.app.renderHome) BF.app.renderHome();
          break;
        case BF.EVENTS.TTS:
        case BF.EVENTS.SEARCH:
        case BF.EVENTS.AI_CONTEXT:
          /* 朗读态 / 搜索索引 / AI 上下文均为各标签页本地态，无需跨端重建；
             保留在 BCAST 中供将来扩展与启动断言完整性。 */
          break;
        default: break;
      }
    } catch (e) { BF.err && BF.err.report('sync.dispatch', e); }
  }
  try { BF.bus && BF.bus.on(BF.EVENTS.SYNC_REMOTE, function (p) { _dispatch(p && p.kind); }); } catch (e) {}
  /* 广播订阅只挂一次。post() 在通道未开时本来就什么都不做，
     所以监听器常驻、通道按需开关 —— 反复 start() 不会叠出 N 条同义监听
     （启动自愈每跑一次就 start 一次，叠下去就是一条改动广播 N 遍）。 */
  BCAST.forEach(function (ev) { BF.bus.on(ev, function () { post(ev); }); });
  function start() {
    if (_started && _bc) return true;
    if (typeof BroadcastChannel === 'undefined') return false;
    try {
      _bc = new BroadcastChannel(CHANNEL);
      _bc.onmessage = function (m) {
        const ev = m && m.data && m.data.kind;
        if (!ev) return;
        try { BF.bus && BF.bus.emit(BF.EVENTS.SYNC_REMOTE, { kind: ev }); } catch (e) {}
      };
      _started = true;
      BF.log && BF.log.info('BF.sync 跨标签页同步已启用');
      return true;
    } catch (e) { _bc = null; _started = false; BF.err && BF.err.report('sync.start', e); return false; }
  }
  function stop() { try { if (_bc) { _bc.close(); } } catch (e) {} _bc = null; _started = false; }
  /* 非 bus 路径的显式广播（如划线/书签落库后直接通告），kind 取 BCAST 成员 */
  function broadcast(kind) { post(kind || BF.EVENTS.BOOKSHELF); }
  return { start: start, stop: stop, broadcast: broadcast, channel: CHANNEL, BCAST: BCAST };
})();


