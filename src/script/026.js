/* ================= 13. 应用状态 + 导航 ================= */
BF.appState = {
  currentBookId: null,
  currentChapterIdx: 0,
  /* 初始激活页是书架（page-bookshelf 静态 active + boot 先 renderBookshelf）；
     currentPage 必须与真实激活页一致，否则依赖它的守卫（如 saveProgress）会误判。 */
  currentPage: 'bookshelf',
  selectedBooks: new Set(),
  viewMode: 'grid',
  drawerTabName: 'toc',
};
BF.app = {
  go(page) {
    /* 曲径（实验）：开启时「首页 / 书架」都汇入曲径——首页保持当前站，
       书架落书架站（关书「返回书架」即回曲径书架）。 */
    if (BF.settings.get('qjMode') && (page === 'home' || page === 'bookshelf')) {
      if (page === 'bookshelf' && BF.qj && BF.qj.pend) { try { BF.qj.pend('jia'); } catch (_qe) {} }
      page = 'qj';
    }
    /* 从阅读器跳往其他页（如 Ctrl+Shift+H 回首页）时必须先保存本章进度 */
    if (BF.appState.currentPage === 'reader' && page !== 'reader') {
      if (BF.appState.currentBookId) { try { BF.reader.saveProgress(true); BF.reader.syncProgressToMeta(); } catch (e) {} }
      /* 离开阅读页时停自动滚动，否则 rAF 继续推隐藏容器（空转 + 位置漂移）。
         不挂在 currentBookId 条件上——自动滚动可能开着但当前无书（切章中途/导入未完成）。 */
      try { if (BF.enh && BF.enh.autoScroll && BF.enh.autoScroll.isOn()) BF.enh.autoScroll.stop(); } catch (e) {}
      /* 离页兜底：closeReader 之外的离场路径（快捷键回首页等）
         同样要停朗读、销毁微读、清预取 —— 否则书架页背后继续出声/残留浮层。
         与 closeReader 内同三件，全部幂等，重复调用无害。 */
      try { BF.tts && BF.tts.stop && BF.tts.stop(); } catch (e) {}
      try { BF.mr && BF.mr.destroy && BF.mr.destroy(); } catch (e) {}
      try { BF.reader.clearPrefetch && BF.reader.clearPrefetch(); } catch (e) {}
      /* 换页即关阅读抽屉：抽屉是 body 层常驻浮窗，页面切走它不会跟着藏，
         会开着悬在新页面上（目录/书签还指着上一页的书）。幂等：没开就是空操作。
         「回顾我的标注」这类不开页直接开抽屉的入口不走 go()，不受影响。 */
      try { if (BF.sheet.isOpen('drawer')) BF.sheet.close('drawer'); } catch (e) {}
      /* 页内查找框也不是 sheet 层：开着查找切页时，它会悬在新页面上，
         且 document 捕获的 Esc 监听与防抖扫描定时器不释放，继续扫已隐藏的旧正文。
         幂等：没开就是空操作。 */
      try { BF.findInPage && BF.findInPage.close && BF.findInPage.close(); } catch (e) {}
    }
    BF.appState.currentPage = page;
    document.querySelectorAll('.page').forEach(function (x) { x.hidden = true; });
    const target = document.getElementById('page-' + page);
    if (target) target.hidden = false;
    /* body.reading 供「仅阅读页显示滚动条」等 CSS 判定 */
    document.body.classList.toggle('reading', page === 'reader');
    BF.state.set({ view: page }, true);
    /* 先确保骨架监听已挂上，再广播：否则首次 go() 时 STATE 无人接，
       只能再直接 sync 一次，笔记/我的两页就会渲染两遍。 */
    try { if (BF.shell && BF.shell.init) BF.shell.init(); } catch (e) {}
    try { BF.bus.emit(BF.EVENTS.STATE, { view: page }); } catch (e) {}
    if (page === 'home') BF.app.renderHome();
    /* 曲径：进入曲径页刷新当前站（外部指定落站优先）。 */
    if (page === 'qj') BF.qj.open();
    /* 切页进入书架时启用骨架屏；后续的增删改重渲染不带该标记，避免每次操作都闪一下 */
    if (page === 'bookshelf') BF.app.renderBookshelf({ skeleton: true });
    /* 骨架同步（TabBar 选中态、body 类）由上面 STATE 广播的订阅方完成 */
  },
};

