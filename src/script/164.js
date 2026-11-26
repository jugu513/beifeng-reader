/* ================= 快捷键补充（延至启动时绑定） ================= */
BF.enh.bindHotkeys = function () {
  BF.hotkeys.bind('read.zoomIn', '=', function () { BF.enh.zoomBy(1); });
  /* `+` 键（Shift+=）同义放大。hit 用 e.key 比对，Shift+= 时 e.key='+'，
     combo 写 shift+plus（parse 把 plus 映射回 '+'；直接写 shift++ 会被 split 拆空）。 */
  BF.hotkeys.bind('read.zoomIn2', 'shift+plus', function () { BF.enh.zoomBy(1); });
  BF.hotkeys.bind('read.zoomOut', '-', function () { BF.enh.zoomBy(-1); });
  /* 撤销常驻入口：Ctrl/⌘+Z——toast 按钮之外再给一条键盘出路。
     输入框内让位原生文本撤销（hotkeys 对带修饰
     键组合在输入框内也放行，此处自查焦点，
     不劫持打字）；栈空时明示。 */
  const _doUndo = function () {
    const a = document.activeElement;
    if (a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.isContentEditable)) return;
    if (BF.undo && BF.undo.count()) BF.undo.undo();
    else BF.noti.info('暂无可撤销操作');
  };
  BF.hotkeys.bind('edit.undo', 'ctrl+z', _doUndo);
  BF.hotkeys.bind('edit.undo.mac', 'meta+z', _doUndo);
  /* 设置面板常驻快捷键：Ctrl/⌘+, —— 与命令 nav.settings 同源。 */
  BF.hotkeys.bind('nav.settings', 'ctrl+,', function () { BF.settingsUI.toggle(); });
  BF.hotkeys.bind('nav.settings.mac', 'meta+,', function () { BF.settingsUI.toggle(); });
  /* 自动滚动独占 a 键，翻页保持空格：
     V4 增强层 onKey 也用空格翻页（preventDefault 不阻止事件继续传播），
     空格若双绑，同一次按键会先翻页、再触发自动滚动 toggle——
     「按一下空格页面开始自己滚」。 */
  BF.hotkeys.bind('read.autoscroll', 'a', function () {
    if (BF.appState.currentPage !== 'reader') return;
    const on = BF.enh.autoScroll.toggle();
    BF.noti.info(on ? '自动滚动开启（a 键可停）' : '自动滚动已停止');
  });
};

/* ============================================================
   北风 · 通知系统 + 模态 + 快捷键 + 全局委托 + 启动
   ============================================================ */

/* 统一撤销栈 BF.undo。
   删书的吐司撤销只是快捷入口（书本体在回收站里），这里推广到标注/书签/生词删除等
   覆盖式写入操作。push({label, undo, ttl}) 后自动弹一条带「撤销」按钮的 toast，
   点撤销执行 undo()。
   约束：toast 驻留时长（8 秒）不是撤销时限——记录留在栈里（上限 20 条），
   Ctrl+Z 是常驻入口，吐司消失后仍可撤销；文案按真实能力说「Ctrl+Z 可撤销」，
   不把 ttl 写成删除倒计时。 */
BF.undo = (function () {
  var _stack = [];
  /* 跨书判断：rec 记了 bookId 且当前正打开另一本时，撤销会改到「看不见的那本书」。
     返回那本书的标题用于提示；非书籍动作（bookId 为空）或无当前书时不限制。 */
  function _crossBook(rec) {
    var cur = (BF.appState && BF.appState.currentBookId != null) ? String(BF.appState.currentBookId) : null;
    var bid = (rec && rec.bookId != null) ? String(rec.bookId) : null;
    if (!bid || !cur || bid === cur) return null;
    /* 只报「属于另一本书」不够：用户听不懂该干什么。带上书名与一个直达动作，
       拒绝的同时给出去路（记录留在栈里，打开那本书后 Ctrl+Z 仍可用）。 */
    var title = '（id ' + bid + '）';
    try {
      var m = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).filter(function (b) { return b && String(b.id) === bid; })[0];
      if (m && m.title) title = m.title;
    } catch (e) { /* 元数据读不到就用 id 兜底，不影响拒绝本身 */ BF.err.report('undo.crossBookTitle', e); }
    return { id: bid, title: title };
  }
  function _crossBookToast(other) {
    if (!BF.noti) return;
    BF.noti.warn('这条撤销属于《' + other.title + '》；先打开那本书再撤销', {
      action: { label: '打开这本书', run: function () { BF.app.openBook(other.id); } },
    });
  }
  function push(opts) {
    opts = opts || {};
    if (typeof opts.undo !== 'function') return false;
    var label = String(opts.label || '操作');
    var ttl = typeof opts.ttl === 'number' ? opts.ttl : 8000;
    /* 撤销栈按书归属——登记时带上当前 bookId（caller 也可显式传 opts.bookId；
       撤销时与当前书不符则提示并排除，不再「在 B 书里静默撤销 A 书的删除」。
       不新开第二条撤销通道。 */
    var rec = { label: label, undo: opts.undo, ttl: ttl, bookId: (typeof opts.bookId !== 'undefined' ? opts.bookId : (BF.appState ? BF.appState.currentBookId : null)) };
    _stack.push(rec);
    if (_stack.length > 20) _stack.shift();   /* 栈上限，防止无限增长 */
    if (BF.noti) {
      /* toast 的「撤销」action 直接持有本条 rec、按引用出栈执行——
         撤销栈与 toast 逐条绑定；若跑 undo() 弹栈顶，连续两个可撤销
         操作时，第 1 条 toast 的撤销实际撤的是最后一条操作。 */
      BF.noti.success(label + '（Ctrl+Z 可撤销）', {
        action: { label: '撤销', run: function () { BF.undo.undoOne(rec); } },
        duration: ttl,
      });
    }
    return true;
  }
  function undo() {
    if (!_stack.length) return false;
    var rec = _stack[_stack.length - 1];   /* 先窥视栈顶，跨书时不弹出，避免误撤 */
    var other = _crossBook(rec);
    if (other) { _crossBookToast(other); return false; }
    _stack.pop();
    try { rec.undo(); } catch (e) { BF.err.report('undo:' + rec.label, e); }
    if (BF.noti) BF.noti.info('已撤销：' + rec.label);
    return true;
  }
  /* 按记录撤销：撤销栈与 toast 逐条绑定的
     执行端——自栈中摘除本条（不弹出栈顶），执行
     其 undo。 */
  function undoOne(rec) {
    if (!rec || typeof rec.undo !== 'function') return false;
    var other = _crossBook(rec);
    if (other) { _crossBookToast(other); return false; }
    var i = _stack.indexOf(rec);
    /* 记录已被 shift 淘汰（栈上限 20）后，其 toast 的撤销按钮仍可能存活。
       此时 indexOf 为 -1：不能照旧执行 rec.undo()——那会撤销一个已不在栈里、
       用户以为过期的操作。拒绝执行，让 toast 按钮变成无操作。 */
    if (i < 0) return false;
    _stack.splice(i, 1);
    try { rec.undo(); } catch (e) { BF.err.report('undo:' + rec.label, e); }
    if (BF.noti) BF.noti.info('已撤销：' + rec.label);
    return true;
  }
  function count() { return _stack.length; }
  return { push: push, undo: undo, undoOne: undoOne, count: count };
})();

/* 下一步引导器 BF.next。
   硬规则：完成态 toast 带一个可点击的下一步动作（复用 noti 的 action），
   空态带一个行动按钮。这里集中提供常用动作，各完成点引用。 */
BF.next = (function () {
  function act(label, run) { return { action: { label: label, run: run } }; }
  return {
    /* 导入完成 → 立即阅读 / 再导入一本 */
    afterImport: function (bookId) {
      return act('立即阅读', function () { BF.app.openBook(bookId); });
    },
    /* 备份完成 → 打开基地恢复点 */
    afterBackup: function () {
      return act('查看备份', function () { try { BF.base && BF.base.open && BF.base.open(); } catch (e) {} });
    },
    /* 目标达成 → 看统计 */
    afterGoal: function () {
      return act('看今日统计', function () { try { BF.wsUI && BF.wsUI.toggleStats && BF.wsUI.toggleStats(); } catch (e) {} });
    },
    /* AI 研读完成 → 存为笔记 */
    afterAI: function (note) {
      return act('存为笔记', function () {
        try { if (BF.notes && BF.notes.create) { const n = BF.notes.create(BF.appState.currentBookId); if (n && BF.notes.update(n.id, { text: note })) BF.noti.success('已存入便签'); else BF.noti.warn('便签没有存进去：存储空间不足'); } } catch (e) { BF.err.report('next.afterAI', e); }
      });
    },
  };
})();

