/* ================= 导航历史（前进/后退阅读位置） ================= */
/* 记录粒度：章级（bookId + chapterIdx）。还原时若跨书则先开书再跳章。
   _restoring 标志防止 back/forward 自身触发的 gotoChapter/openBook 被再次记录，避免死循环 */
BF.nav = (function () {
  let stack = [], idx = -1, _restoring = false;
  function persist() { try { BF.store.lsSet(BF.store.K.NAV_HIST, { stack: stack, idx: idx }); } catch (e) { BF.err.report('nav.persist', e); } }
  function load() { try { const s = BF.store.lsGet(BF.store.K.NAV_HIST, null); if (s && s.stack && s.stack.length) { stack = s.stack; idx = Math.min(s.idx || 0, stack.length - 1); } } catch (e) { BF.log && BF.log.warn('导航历史读取失败：' + (e && e.message)); } }
  function cur() { return { bookId: BF.appState.currentBookId, chapterIdx: BF.appState.currentChapterIdx }; }
  function record() {
    if (_restoring) return;
    const c = cur();
    if (!c.bookId) return;
    if (idx >= 0 && stack[idx] && stack[idx].bookId === c.bookId && stack[idx].chapterIdx === c.chapterIdx) return;
    if (idx < stack.length - 1) stack = stack.slice(0, idx + 1);   /* 从中间跳转 → 丢弃「前进」分支 */
    stack.push(c);
    if (stack.length > 200) stack = stack.slice(-200);
    idx = stack.length - 1;
    persist();
    updateButtons();
  }
  async function restore() {
    const c = stack[idx];
    if (!c) return;
    _restoring = true;
    try {
      if (BF.appState.currentBookId !== c.bookId) {
        await BF.reader.openBook(c.bookId);
      }
      await BF.reader.gotoChapter(c.chapterIdx);
    } catch (e) {
      BF.err.report('nav.restore', e);
    } finally {
      _restoring = false;
    }
    updateButtons();
  }
  function back() { if (idx > 0) { idx--; persist(); restore(); } }
  function forward() { if (idx < stack.length - 1) { idx++; persist(); restore(); } }
  function updateButtons() {
    /* 前进/后退按钮已移入「更多」菜单（顶栏让位给书名），
       这里同时同步菜单内那一份的 disabled 态，否则会显示成永远可点 */
    const b = document.getElementById('nav-back'), f = document.getElementById('nav-forward');
    /* 菜单统一为 #bf-more-menu（reader 菜单并入 uiMenu） */
    const mb = document.querySelector('#bf-more-menu [data-nav-back]');
    const mf = document.querySelector('#bf-more-menu [data-nav-forward]');
    const bDis = idx <= 0, fDis = idx >= stack.length - 1;
    if (b) b.disabled = bDis;
    if (f) f.disabled = fDis;
    if (mb) mb.disabled = bDis;
    if (mf) mf.disabled = fDis;
  }
  load();
  return { record: record, back: back, forward: forward, updateButtons: updateButtons, cur: cur, get idx() { return idx; }, get len() { return stack.length; } };
})();

BF.reader.gotoPage = function (pi) {
  /* 越界钳制：直接 API/DSL 调 gotoPage(20)（共 20 页）会写出 pkPageIdx=20、paras=0、指示器「第 21/20 页」的空白页。
     分页态下 prevChapter/nextChapter 已靠边界判断回落 gotoChapter，这里再兜底钳到 [0, pn-1]。 */
  const _pn = (BF.reader.state.pkPages || []).length;
  if (_pn > 0) { if (pi < 0) pi = 0; if (pi > _pn - 1) pi = _pn - 1; }
  BF.reader.state.pkPageIdx = pi;
  /* 分页页码必须写独立 PROGRESS_ 键，不能写 SCROLL_ 键（滚动模式存的是像素 scrollTop）：
     页码存进 SCROLL_ 后切回滚动模式会被当成像素恢复（≈3px），位置错乱。
     键带章节号：书级单键会让切章后沿用上一章的页码 */
  BF.store.lsSet(BF.store.K.PROGRESS_ + BF.appState.currentBookId + '_' + BF.appState.currentChapterIdx, pi);
  BF.reader.renderPage();
};

BF.reader.prevChapter = function () {
  if (BF.reader.pageModeActive() && BF.reader.state.pkPageIdx > 0) {
    BF.reader.gotoPage(BF.reader.state.pkPageIdx - 1);
    /* 分页分支同步返回 Promise.resolve（与滚动分支 gotoChapter 的 Promise 一致），
       切章全链返回类型统一，调用方 await/.then 均可安全使用 */
    return Promise.resolve();
  }
  return BF.reader.gotoChapter(BF.appState.currentChapterIdx - 1);
};
BF.reader.nextChapter = function () {
  if (BF.reader.pageModeActive() && BF.reader.state.pkPageIdx < BF.reader.state.pkPages.length - 1) {
    BF.reader.gotoPage(BF.reader.state.pkPageIdx + 1);
    /* 同上，统一返回 Promise */
    return Promise.resolve();
  }
  return BF.reader.gotoChapter(BF.appState.currentChapterIdx + 1);
};
BF.reader.closeReader = function () {
  BF.reader.saveProgress();
  /* 关书三件收尾：只存进度 + 切页不够——朗读会在书架页背后
     继续念并自动翻章；微读 #mr-root 残留；预取正文驻留内存。
     先停朗读（stop 自带会话落盘）→ 销毁微读 → 清预取，再切页。
     go() 内另有离页兜底（覆盖快捷键等非 closeReader 离场路径），两处幂等。 */
  try { BF.tts && BF.tts.stop && BF.tts.stop(); } catch (e) {}
  try { BF.mr && BF.mr.destroy && BF.mr.destroy(); } catch (e) {}
  try { BF.reader.clearPrefetch && BF.reader.clearPrefetch(); } catch (e) {}
  BF.app.go('bookshelf');
};

