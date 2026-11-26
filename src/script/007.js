/* ================= 4. BF.timers 定时器管理器 ================= */
BF.timers = (function () {
  const _i = new Set(), _t = new Set();
  let _warnT = 0;
  return {
    interval(fn, ms) {
      const id = setInterval(fn, ms); _i.add(id);
      const n = _i.size + _t.size;
      if (n > 40 && Date.now() - _warnT > 60000) { _warnT = Date.now(); BF.log && BF.log.warn('定时器风暴预警：当前 ' + n + ' 个（正常 <15）'); }
      return () => { _i.delete(id); clearInterval(id); };
    },
    timeout(fn, ms) {
      const id = setTimeout(function () { _t.delete(id); fn(); }, ms); _t.add(id);
      return () => { _t.delete(id); clearTimeout(id); };
    },
    safeTimeout(fn, ms, tag) {
      return BF.timers.timeout(function () {
        try { fn(); } catch (e) { BF.err.report('timer:' + (tag || '?'), e); }
      }, ms);
    },
    raf(fn) { const id = requestAnimationFrame(fn); return () => cancelAnimationFrame(id); },
    /* rAF 合并 + 兜底：flag 为 true 期间只排一次；rAF 被后台标签页节流（甚至永不回调）时，
       100ms 内用 setTimeout 兜底触发 fn 一次，避免渲染窗 / 进度条 / 设置面板卡在旧状态不更新。 */
    rafFallthru(getFlag, setFlag, fn) {
      if (getFlag()) return;
      setFlag(true);
      let done = false;
      const fire = function () { if (done) return; done = true; setFlag(false); try { fn(); } catch (e) { BF.err.report('rafFallthru', e); } };
      try { requestAnimationFrame(fire); } catch (e) {}
      BF.timers.timeout(fire, 100);
    },
    clearAll() {
      for (const id of _i) clearInterval(id); _i.clear();
      for (const id of _t) clearTimeout(id); _t.clear();
    },
    count() { return _i.size + _t.size; },
  };
})();

