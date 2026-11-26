/* ================= 3. BF.err 错误边界 + 看门狗 ================= */
BF.err = (function () {
  var _ring = [];            // 最近异常环形缓冲
  var RING_MAX = BF.CONFIG.ERR_RING_MAX;
  var _lastHeal = 0;        // 上次自动自愈时间戳
  var HEAL_COOLDOWN = BF.CONFIG.ERR_HEAL_COOLDOWN; // 自愈冷却 2 分钟
  var HEAL_RATE = BF.CONFIG.ERR_HEAL_RATE;  // 60s 内 >=3 次异常才触发
  var HEAL_WINDOW = BF.CONFIG.ERR_HEAL_WINDOW;
  /* 健康度滑动窗口：看门狗只在 60s 内 >=HEAL_RATE 时自愈，
     若异常持续发生但频率低于该阈值，用户就完全无感。这里用独立的 10 分钟长窗口统计，
     超阈值时主动提示一次（不打扰），把「静默的持续异常」变成用户可见信号。 */
  var _win = [];              // 10 分钟滑动窗口内的异常时间戳
  var HEALTH_WINDOW = BF.CONFIG.ERR_HEALTH_WINDOW; // 10 分钟
  var HEALTH_RATE = BF.CONFIG.ERR_HEALTH_RATE;     // 10 分钟内 >20 次视为健康度异常
  var HEALTH_COOLDOWN = BF.CONFIG.ERR_HEALTH_COOLDOWN; // 告警冷却 1 分钟，避免轰炸
  var _lastHealthWarn = 0;
  function _healthTick(ctx) {
    try {
      var now = Date.now();
      _win.push(now);
      while (_win.length && now - _win[0] > HEALTH_WINDOW) _win.shift();
      if (_win.length > HEALTH_RATE && now - _lastHealthWarn > HEALTH_COOLDOWN) {
        _lastHealthWarn = now;
        try { BF.log && BF.log.warn('错误健康度：10 分钟内 ' + _win.length + ' 次异常（最近：' + (ctx || '?') + '），请到「运维台」面板查看运行日志'); } catch (_) {}
        /* 有通知系统才提示，避免开机阶段 BF.noti 未就绪时抛错。
           通知带上跳转入口：只说「去运维台查看」而界面上没有门，用户等于无路可走
           。 */
        try {
          if (BF.noti && BF.noti.warn) {
            /* BF.noti 的参数名是 opts.action（单数），不是 actions 数组 */
            BF.noti.warn('检测到较多异常（10 分钟 ' + _win.length + ' 次），建议在「运维台」查看日志', {
              action: { label: '打开运维台', run: function () { BF.diag && BF.diag.open(); } },
            });
          }
        } catch (_) {}
      }
    } catch (_) {}
  }
  /* 健康度快照：供基地面板/诊断展示。
     rate = 窗口内异常数 / 阈值，>1 即超阈值，越大越差（不是 0~1 的健康分）。 */
  function health() {
    try {
      var now = Date.now();
      while (_win.length && now - _win[0] > HEALTH_WINDOW) _win.shift();
      var rate = _win.length / HEALTH_RATE;
      return {
        count: _win.length,
        windowMs: HEALTH_WINDOW,
        rate: rate,
        level: _win.length > HEALTH_RATE ? 'bad' : (_win.length > HEALTH_RATE / 2 ? 'warn' : 'ok'),
        lastWarn: _lastHealthWarn,
      };
    } catch (_) { return { count: 0, windowMs: HEALTH_WINDOW, rate: 0, level: 'ok', lastWarn: 0 }; }
  }
  /* 内部异常的用户侧提示：同一 ctx 只提示一次，且全局 30s 内最多提示一次——
     异常风暴（循环里反复抛）下弹 200 次通知等于把界面糊死，
     那比不提示更糟。日志仍然全量记录，节流只影响弹窗。 */
  const NOTIFY_WINDOW = 30000;
  let _notifiedAt = 0;
  const _notifiedCtx = Object.create(null);
  function _notifyUser(ctx, msg) {
    try {
      if (!BF.noti) return;
      const now = Date.now();
      if (now - _notifiedAt < NOTIFY_WINDOW) return;
      if (_notifiedCtx[ctx]) return;
      _notifiedCtx[ctx] = true;
      _notifiedAt = now;
      /* 带上 msg：缺的是哪个能力全在 msg 里（boot.must 那条），只拼 ctx 用户读不懂 */
      /* F-09：内部标识（ctx，如 heal.orphans.meta）只进日志，不进面向用户的 toast */
      BF.noti.warn('后台处理遇到问题' + (msg ? '：' + String(msg).slice(0, 60) : '') + '（已记入日志）', {
        action: { label: '打开运维台', run: function () { try { if (BF.workbench && BF.workbench.open) BF.workbench.open('diag'); else if (BF.diag && BF.diag.open) BF.diag.open(); } catch (e) {} } },
      });
    } catch (_) {}
  }
  function report(ctx, e) {
    var msg = (e && e.message) ? e.message : String(e);
    /* 环形缓冲连 stack 一起存——只有 message 时看不到是哪一行抛的，
       排错还得去复现。stack 截断存放（Error.stack 可能很长），
       非 Error 抛出（字符串等）没有 stack，留空串。 */
    var stack = (e && e.stack) ? String(e.stack) : '';
    try {
      _ring.push({ t: Date.now(), ctx: ctx, msg: String(msg).slice(0, 300), stack: String(stack).slice(0, 1500) });
      if (_ring.length > RING_MAX) _ring = _ring.slice(_ring.length - RING_MAX);
    } catch (_) {}
    try { BF.log && BF.log.error('[' + ctx + '] ' + msg); } catch (_) {}
    _notifyUser(ctx, msg);
    _healthTick(ctx);
    /* 回调里被 catch 后交到这里的异常占多数，也要参与自愈判定（内部有冷却，不会风暴） */
    try { _maybeHeal(); } catch (_) {}
    return e;
  }
  /* 看门狗：异常率超阈值且不在冷却期，则触发一次自愈 */
  function _maybeHeal() {
    try {
      var now = Date.now();
      if (now - _lastHeal < HEAL_COOLDOWN) return;
      var recent = _ring.filter(function (r) { return now - r.t <= HEAL_WINDOW; }).length;
      if (recent >= HEAL_RATE && typeof BF.heal === 'object' && BF.heal.run) {
        _lastHeal = now;
        BF.heal.run();
        try { BF.log && BF.log.warn('检测到异常率升高，已自动执行一次数据检查与修复'); } catch (_) {}
      }
    } catch (_) {}
  }
  /* 包装 fn 为「不抛异常」版本：同步异常与异步 rejection 都交给 report 留痕。。现在按返回值是否为 thenable 分流。
     用法：registerClick 等回调、插件 hooks、任何可能抛的外部入口。 */
  function safe(fn, ctx) {
    if (typeof fn !== 'function') return fn;
    const label = ctx || fn.name || 'safe';
    return function () {
      try {
        const r = fn.apply(this, arguments);
        if (r && typeof r.then === 'function') {
          return r.catch(function (e) { report(label + ':async', e); return undefined; });
        }
        return r;
      } catch (e) { report(label, e); return undefined; }
    };
  }
  function hook() {
    try {
      window.addEventListener('error', function (e) { report('window.error', e.error || e.message); _maybeHeal(); });
      window.addEventListener('unhandledrejection', function (e) { report('unhandledrejection', e.reason); _maybeHeal(); });
    } catch (e) {}
  }
  function recent(n) { return _ring.slice(Math.max(0, _ring.length - (n || RING_MAX))); }
  function count() { return _ring.length; }
  function lastHeal() { return _lastHeal; }
  return { report, safe, hook, recent, count, lastHeal, health, HEALTH_RATE: HEALTH_RATE, HEALTH_WINDOW: HEALTH_WINDOW };
})();

