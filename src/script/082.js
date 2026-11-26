/* ================= R14. 阅读统计埋点 ================= */
BF.stats = (function () {
  let _pending = 0, _lastFlush = Date.now(), _lastTs = Date.now();
  function todayKey(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  async function _flush() {
    /* 先快照再清零，随后用 mutate 串行落盘。
       mutate 回调在 prev.then 内异步执行——若把 _pending 直接读进回调，
       会读到回调外已清零的 0，这批时长静默丢失且零报错。
       故必须先把 _pending 快照到局部量 _p，回调内只用 _p 与提前算好的日键 k。
       mutate 失败（返回 false）或抛错时把 _p 回补进 _pending，保证统计不丢。 */
    if (_pending > 0) {
      const _p = _pending;
      _pending = 0;
      const k = todayKey();
      try {
        const _ok = await BF.store.mutate(BF.store.K.DAILY, function (s) {
          s = s || {};
          s[k] = (s[k] || 0) + _p;
          return s;
        });
        if (_ok === false) {
          _pending += _p;
          try { BF.err.report('stats._flush', new Error('DAILY 写入失败，已回补 ' + _p + 's')); } catch (e) {}
        }
      } catch (e) {
        _pending += _p;
        try { BF.err.report('stats._flush', e); } catch (e2) {}
      }
    }
    _lastFlush = Date.now();
  }
  function add(sec) {
    _pending += sec;
    /* 落盘阈值取 60s：采样周期 30s，阈值 300s 时读不满 5 分钟就离开，
       pending 会随标签关闭全部丢失（读完整本书 DAILY 仍为空）。60s 兼顾落盘频次与丢失窗口。 */
    if (Date.now() - _lastFlush >= 60000) _flush();
    /* 目标达成提醒：必须在埋点里调 BF.goal.check——统计面板默认关闭，别处不触发时提醒永远不出现 */
    try { BF.goal && BF.goal.check(); } catch (e) {}
  }
  function pending() { return Math.round(_pending / 60); }
  /* 卸载同步兜底专用：取出未落盘的**秒**数并同步清零（pending() 返回分钟，两者单位不同勿混用）。
     必须是「取出并清零」而非纯读取 —— 纯读取时外部写完 _pending 仍是原值，
     下次 _flush() 会把同一批时长再写一次（双写）。清零与 _flush 里的
     `const _p = _pending; _pending = 0;` 同样发生在同步段（await 之前），
     故二者不会同时拿到同一批秒数。 */
  function takePendingSec() { const _p = _pending; _pending = 0; return _p; }
  /* 记录定时器句柄，重复 install 时先摘旧的（reader.core 重装会翻倍计时） */
  let _readerTimer = null;
  function startReaderTimer() {
    stopReaderTimer();
    _lastTs = Date.now();
    _readerTimer = BF.timers.interval(function () {
      const now = Date.now();
      if (!BF.appState.currentBookId || BF.appState.currentPage !== 'reader' || document.hidden) {
        /* 离开阅读页或切到后台：结算已累计的时长并重置基线，否则这段既不计入、
           也不会在下个周期被排除（基线不重置会把后台时长算进下一次采样）。 */
        _flush();
        _lastTs = now;
        return;
      }
      const delta = Math.floor((now - _lastTs) / 1000);
      _lastTs = now;
      /* 全局累计 + 按书累计（书级阅读时长）：只记全局就统计不出单本书读了多久 */
      if (delta > 0) { add(delta); if (BF.appState.currentBookId) addBook(BF.appState.currentBookId, delta); }
    }, 30000);
    /* 采样周期 30s、落盘阈值 60s：阈值取 300s 时，读不满 5 分钟就离开，内存里的 pending 会随标签关闭丢弃，
       表现为「读完一整本书，DAILY 仍是空、首页永远 0 分钟今天」。
       60s 阈值把最坏丢失窗口从 5 分钟缩到 1 分钟。 */
    return _readerTimer;
  }
  function stopReaderTimer() {
    if (!_readerTimer) return;
    /* BF.timers.interval 返回的是取消函数（无 .cancel 方法） */
    try { if (typeof _readerTimer === 'function') _readerTimer(); } catch (e) {}
    _readerTimer = null;
  }
  function addBook(bookId, sec) {
    if (!bookId) return;
    /* 走 mutate 串行写，与 add/_flush 同一写队列，避免与其它路径的
       读→改→写互相覆盖。回调内不读任何外部可变状态：bookId、sec 为入参（不变），
       m 由 mutate 传入的最新值提供，故无需 await（fire-and-forget，与
       toggleStar/togglePin/renameBook 同一写法）。 */
    BF.store.mutate(BF.store.K.BOOK_TIME, function (m) {
      m = m || {};
      m[bookId] = (m[bookId] || 0) + sec;
      return m;
    });
  }
  function bookMin(bookId) {
    const m = BF.store.lsGet(BF.store.K.BOOK_TIME, {});
    return Math.round((m[bookId] || 0) / 60);
  }
  function bookList() {
    const m = BF.store.lsGet(BF.store.K.BOOK_TIME, {});
    return Object.keys(m).map(function (id) { return { id: id, sec: m[id] }; })
      .sort(function (a, b) { return b.sec - a.sec; });
  }
  function today() {
    const s = BF.store.lsGet(BF.store.K.DAILY, {});
    return Math.round((s[todayKey()] || 0) / 60);
  }
  function total() {
    const s = BF.store.lsGet(BF.store.K.DAILY, {});
    return Math.round(Object.values(s).reduce((a, b) => a + (Number(b) || 0), 0) / 3600);
  }
  /* 「今日已读 X 分钟」的唯一实现：界面上所有该数字必须走这一个函数。
     today() 只读已落盘日账，落盘窗口里的当前阅读段不进它——统计面板用 today()、
     目标环自拼 today()+pending(+专注)，同一块屏就会出现两个打架的「今天」。
     展示值 = 落盘 + 未落盘；专注是否并入是**目标设置**的选择（goalIncludeFocus），
     不混进通用展示。 */
  function todayDisplay() { return today() + pending(); }
  /* 连续打卡：从今天（或昨天，若今天尚未阅读）往前数连续有阅读记录的天数 */
  function streak() {
    const s = BF.store.lsGet(BF.store.K.DAILY, {});
    let n = 0;
    const d = new Date();
    if (!(s[todayKey(d)] > 0)) d.setDate(d.getDate() - 1);
    while (s[todayKey(d)] > 0) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  /* 「最近 N 天窗」的唯一实现：统计与专注两块共用这一份，
     各自手抄 `Object.keys(map).filter(k => Date.now() - new Date(k + 'T00:00:00').getTime() < N*86400000)`
     必然漂移（时区成分必须带 T00:00:00，否则 'YYYY-MM-DD' 被当 UTC 午夜、
     东八区差 8 小时，窗口边界会多算/少算一天）。 */
  function windowSum(map, days) {
    const now = Date.now();
    return Object.keys(map || {}).reduce(function (a, k) {
      const t = new Date(k + 'T00:00:00').getTime();
      if (!Number.isFinite(t)) return a;
      return now - t < days * 86400000 ? a + (Number(map[k]) || 0) : a;
    }, 0);
  }
  return { todayKey, add, addBook, startReaderTimer, stopReaderTimer, _flush, today, todayDisplay, total, pending, takePendingSec, streak, bookMin, bookList, windowSum };
})();

