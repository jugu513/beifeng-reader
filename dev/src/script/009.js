/* ================= 4c. BF.trace 启动时序 =================
   在 BF.boot._enter 的各阶段之间插桩，记录分段耗时；没有插桩时启动耗时无法定位。
   为什么不用 performance.mark/measure：
     ① mark 会把 name 堆进 performance.getEntriesByName，用户自己开Performance 面板
        会看到一堆 bf_boot_* 条目，噪音；
     ② 诉求是「阶段 → 毫秒」的固定结构，自己存更直接。
   仅记录、不做性能断言，失败静默（perf.now 在极端环境可能不存在）。 */
BF.trace = (function () {
  var _marks = [];   /* [{name, ms, at}] */
  var _t0 = 0;
  function now() { try { return (window.performance && performance.now) ? performance.now() : Date.now(); } catch (e) { return Date.now(); } }
  function start() { _t0 = now(); _marks = []; }
  /* mark('渲染首页') 记录从 start 或上一个 mark 起的耗时 */
  function mark(name) {
    try {
      var t = now();
      var prev = _marks.length ? _marks[_marks.length - 1].at : _t0;
      _marks.push({ name: String(name), ms: Math.max(0, Math.round((t - prev) * 10) / 10), at: t });
      return t;
    } catch (e) { return 0; }
  }
  function list() { return _marks.map(function (m) { return { name: m.name, ms: m.ms }; }); }
  /* 总耗时取最后一个 mark 的 at 减 t0，而不是累加各段 —— 后者会把
     「阶段之间的空隙」也算进去，读数偏大且无法解释。 */
  function total() {
    if (!_marks.length) return 0;
    return Math.max(0, Math.round((_marks[_marks.length - 1].at - _t0) * 10) / 10);
  }
  function slowest(n) {
    return list().slice().sort(function (a, b) { return b.ms - a.ms; }).slice(0, n || 1);
  }
  return { start: start, mark: mark, list: list, total: total, slowest: slowest };
})();

