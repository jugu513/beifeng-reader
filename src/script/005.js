/* ================= 2. BF.log 日志门面 ================= */
BF.log = (function () {
  const MAX = 400;
  let buf = [];
  let _saveT = null;
  /* 落盘失败熔断：lsSet 失败会经 BF.err.report 回调 log.error → push('error') → 再排 persist，
     不设这道退避就是永不停止的 2 秒自激——恰好在最需要日志的存储故障场景下先崩。
     连续失败达阈值后退避到 60s 并停止重试，避免与看门狗互相唤醒。 */
  let _failStreak = 0;
  let _failUntil = 0;
  const FAIL_LIMIT = 3;
  const FAIL_BACKOFF = 60000;
  function persist() {
    if (BF.settings && BF.settings.get && BF.settings.get('privacyMode')) return;
    if (Date.now() < _failUntil) return;
    /* 日志保留天数：超出 captureLogDays 的条目在落盘前过滤掉 */
    let out = buf;
    const days = parseInt(BF.settings && BF.settings.get ? BF.settings.get('captureLogDays') : 7, 10);
    if (days > 0) {
      const cut = Date.now() - days * 86400000;
      out = out.filter(function (r) { return !r || r.t >= cut; });
    }
    if (BF.store.lsSet(BF.store.K.LOG, out.slice(-MAX))) {
      if (_failStreak) _failStreak = 0;
    } else if (++_failStreak >= FAIL_LIMIT) {
      _failUntil = Date.now() + FAIL_BACKOFF;
      _failStreak = 0;
    }
  }
  function push(level, msg) {
    const rec = { t: Date.now(), lvl: level, msg: String(msg).slice(0, 500) };
    buf.push(rec);
    if (buf.length > MAX) buf.shift();
    /* 熔断生效期间不再排新的落盘任务，避免自激 */
    if (Date.now() < _failUntil) return;
    /* 三个级别都进节流落盘（info 也进，避免日志面板丢历史） */
    if (level) {
      if (!_saveT) _saveT = setTimeout(function () { _saveT = null; persist(); }, 2000);
    }
  }
  /* 两件分开的事：
     · captureLog（记录普通日志）= info 级要不要进环形缓冲并落盘；
     · consoleEcho（控制台输出）= 要不要往 DevTools 刷回声，三级一起受控。
     日志面板读的是缓冲，与回声无关；默认不开回声，发布件里不产生控制台流水。 */
  function _captureOn() {
    try { return !!(BF.settings && BF.settings.get && BF.settings.get('captureLog')); } catch (e) { return false; }
  }
  function _echoOn() {
    try { return !!(BF.settings && BF.settings.get && BF.settings.get('consoleEcho')); } catch (e) { return false; }
  }
  function _echo(level, msg) {
    if (!_echoOn()) return;
    try {
      if (level === 'error') console.error('[北风]', msg);
      else if (level === 'warn') console.warn('[北风]', msg);
      else console.log('[北风]', msg);
    } catch (e) {}
  }
  return {
    info: function (msg) {
      try {
        if (!_captureOn()) return;
        _echo('info', msg);
        push('info', msg);
      } catch (e) {}
    },
    warn: function (msg) { push('warn', msg); _echo('warn', msg); },
    error: function (msg) { push('error', msg); _echo('error', msg); },
    /* 读取路径改「内存 ∪ 落盘」。buf 是最新内存环形缓冲；
       落盘副本（persist 写入 BF.store.K.LOG，按 captureLogDays 过滤、截断 MAX）补齐更早的历史，
       两者按时间戳去重合并，避免诊断/日志面板只看到当前会话的内存段（warn/error 始终落盘，但
       历史 info 与跨重载记录若不合并会被吞掉）。 */
    list: function () {
      var arr = buf.slice();
      try {
        var disk = (BF.store && BF.store.lsGet) ? BF.store.lsGet(BF.store.K.LOG, null) : null;
        if (disk && disk.length) {
          /* 去重键含级别与正文：warn/error 常在同一毫秒成对产生，只认时间戳会吞掉一条 */
          var _fk = function (x) { return x.t + '|' + x.lvl + '|' + x.msg; };
          var seen = {};
          for (var z = 0; z < arr.length; z++) if (arr[z] && arr[z].t != null) seen[_fk(arr[z])] = 1;
          for (var d = 0; d < disk.length; d++) {
            if (disk[d] && disk[d].t != null && !seen[_fk(disk[d])]) { arr.push(disk[d]); seen[_fk(disk[d])] = 1; }
          }
          arr.sort(function (a, b) { return a.t - b.t; });
        }
      } catch (e) {}
      return arr;
    },
    clear: function () {
      buf = [];
      /* 盘上那份清不掉就必须说出来：list() 会把磁盘副本合并回来。
         清空只会更小，force 跳过非关键闸门 —— 95% 档用户唯一的自救动作不能被自己拦住。 */
      try { return BF.store.lsSet(BF.store.K.LOG, [], { force: true }) === true; } catch (e) { return false; }
    },   /* 清盘同时清落盘副本 */
    flush: persist,
  };
})();

/* idb:up/down 与 state:change 的消费方挂在总线之后、任何 emit 之前：
   挂在应用启动里就晚了——IndexedDB 就绪与首次进页面都发生在那之前，
   总线对「没人听的事件」每次都要警告一句，冷启动日志里那两条「无监听」就是这么来的。
   消费内容：IDB 上下线 → 状态点 + 日志；页面切换 → 日志留痕。 */
BF.bus.on(BF.EVENTS.IDB_UP, function () { try { BF.ui.setStatusDot(''); BF.log.info('IndexedDB 已就绪'); } catch (e) {} });
BF.bus.on(BF.EVENTS.IDB_DOWN, function (err) { try { BF.ui.setStatusDot('warn'); BF.log.warn('IndexedDB 不可用：' + (err && err.message || err)); } catch (e) {} });
BF.bus.on(BF.EVENTS.STATE, function (s) { try { BF.log.info('页面切换：' + ((s && s.view) || (s && s.cur) || '?')); } catch (e) {} });

