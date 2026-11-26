/* ================= 1. BF.bus 事件总线（副中枢） ================= */
BF.bus = (function () {
  const _h = {};
  function on(ev, fn) {
    if (!ev || typeof fn !== 'function') return function () {};
    (_h[ev] = _h[ev] || []).push(fn);
    return function () { off(ev, fn); };
  }
  function off(ev, fn) {
    const a = _h[ev]; if (!a) return;
    const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1);
  }
  function emit(ev, data) {
    (emit.__count = emit.__count || {})[ev] = ((emit.__count[ev] || 0) + 1);  /* E：审计用累计发射计数 */
    const a = _h[ev];
    if (!a || !a.length) {
      const now = Date.now();
      /* 每条通道各自计时：没有记录的新通道必须立刻告警，缺值不参与减法比较 */
      const _lastWarn = emit.__warnT && emit.__warnT[ev];
      if (_lastWarn === undefined || now - _lastWarn > 60000) {
        (emit.__warnT = emit.__warnT || {})[ev] = now;
        BF.log && BF.log.warn('bus.emit 无监听：' + ev + '（可能拼错或未注册）');
      }
      return false;
    }
    for (const fn of a.slice()) {
      try { fn(data); } catch (e) { BF.err && BF.err.report('bus:' + ev, e); }
    }
    return true;
  }
  function once(ev, fn) {
    /* once 返回解绑函数（协议层缺口补齐）：once 触发后自动解绑，
       但调用者也要能提前解绑——否则「只听一次但可能提前不需要了」
       的场景无法表达。 */
    const offFn = on(ev, function (d) { offFn(); fn(d); });
    return offFn;
  }
  function clear(ev) { if (ev) delete _h[ev]; else for (const k in _h) delete _h[k]; }
  function listenerCount(ev) { return (_h[ev] || []).length; }
  /* E：事件总线审计。三栏输出——事件 / 实时监听数 / 累计发射次数（跨标签广播另列）。
     用于发现「声明但未发射」「发射但无监听」「有监听但从未发射」三类脱节，驱动闭环或清理。 */
  function audit() {
    const bcast = {};
    try { (BF.sync && BF.sync.BCAST || []).forEach(function (ev) { bcast[ev] = true; }); } catch (e) {}
    const rows = [];
    for (const k in BF.EVENTS) {
      const ev = BF.EVENTS[k];
      rows.push({
        key: k,
        event: ev,
        listeners: listenerCount(ev),
        emitted: (emit.__count && emit.__count[ev]) || 0,
        crossTab: bcast[ev] ? 'yes' : ''
      });
    }
    rows.sort(function (a, b) { return b.listeners - a.listeners || b.emitted - a.emitted; });
    return rows;
  }
  function health() {
    let total = 0;
    for (const k in _h) total += _h[k].length;
    if (total > 200) { BF.log && BF.log.warn('bus 监听总数 ' + total + '，疑似泄漏，可用 BF.bus.clear() 清理'); }
    return total;
  }
  /* 模块作用域：{on, off, dispose, count}，dispose 幂等 */
  function scope() {
    const regs = [];
    return {
      on(ev, fn) { const offFn = on(ev, fn); regs.push(offFn); return offFn; },
      off(ev, fn) {
        const i = regs.findIndex(f => f === fn);
        if (i >= 0) regs.splice(i, 1);
        return off(ev, fn);
      },
      dispose() {
        const r = regs.splice(0);
        for (const offFn of r) { try { offFn(); } catch (e) { BF.err && BF.err.report('bus.scope.dispose', e); } }
        return r.length;
      },
      count() { return regs.length; }
    };
  }
  return { on, off, emit, once, clear, listenerCount, health, scope, audit };
})();


