/* ================= 6. BF.state 状态机 ================= */
BF.state = (function () {
  /* 纯只读镜像，不自存任何字段：view/bookId/chapterIdx 一旦自存，
     bookId/chapterIdx 初始化后就没人写 ⇒ 开着书时 get() 返回
     {view:'reader', bookId:null, chapterIdx:0}，而 BF.appState 里是真实的那本书。
     另一处更阴的：初值 _view='home' 而 appState.currentPage 初值是 'bookshelf'
     （静态激活页就是书架）⇒ 冷启动没切过页时两边就已经在各说一套。
     三项全部读取时现取 BF.appState（唯一写入口），set() 只是「广播一次」，
     结构上不可能漂移。 */
  function cur() {
    return { view: BF.appState.currentPage, bookId: BF.appState.currentBookId, chapterIdx: BF.appState.currentChapterIdx };
  }
  return {
    get: cur,
    set: function (patch, silent) {
      /* 不接受旁路写入：状态归 BF.appState 管，这里只负责把变化广播出去。
         go() 的 set({view}) 发生在 currentPage 已落之后，值一致 ⇒ 不告警，
         否则每次切页都会往日志里灌一条噪声。 */
      if (patch && (
        (patch.bookId !== undefined && patch.bookId !== BF.appState.currentBookId) ||
        (patch.chapterIdx !== undefined && patch.chapterIdx !== BF.appState.currentChapterIdx) ||
        (patch.view !== undefined && patch.view !== BF.appState.currentPage))) {
        BF.log && BF.log.warn('BF.state 是 BF.appState 的只读镜像：改状态请写 BF.appState');
      }
      if (!silent) {
        try { BF.bus.emit(BF.EVENTS.STATE, { cur: cur() }); } catch (e) {}
      }
      return cur();
    },
  };
})();

