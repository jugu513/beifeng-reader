/* ================= 4b. BF.jobs 任务注册表（进程中心） =================
   统一登记「正在跑、会让用户等」的异步任务，供运维台显示进程列表。
   为什么不让 BF.workerPool 自己存一份：
     ① 导入书籍是纯主线程任务（不进 Worker 池），若只查 workerPool 就看不见它；
     ② 两个数据源会让「有没有卡住」这个问题需要合并两处才能回答。
   采用 tasks Map + add/done/list/active 的思路，
   但北风这边是跨主线程/Worker 两条链路，所以 kind 字段用来区分。 */
BF.jobs = (function () {
  var _seq = 0, _m = new Map();
  /* 事件流：记录任务生命周期事件，运维台可见 */
  var _events = [];
  /* 变更订阅：jobs 若无内置通知，顶栏状态只能 1s 轮询。
     这里内置一个最小订阅器（不依赖 BF.bus：jobs 定义在 bus 之前，且保持模块独立），
     begin/end/fail/abort/setDetail 之后都广播 {type, id, label, status}，供顶栏芯片等即时刷新。 */
  var _subs = [];
  function _notify(type, j) {
    var payload = { type: type, id: j ? j.id : 0, label: j ? j.label : '', status: j ? j.status : '' };
    for (var i = 0; i < _subs.length; i++) { try { _subs[i](payload); } catch (e) {} }
  }
  function onChange(fn) {
    if (typeof fn === 'function') { _subs.push(fn); return function () { var i = _subs.indexOf(fn); if (i >= 0) _subs.splice(i, 1); }; }
    return function () {};
  }
  /* kind 归一化：只保留 worker / import / index / io / async 五类，
     避免调用方各写各的导致筛选失效。 */
  var KINDS = ['worker', 'import', 'index', 'io', 'async'];
  function _event(name, desc) {
    _events.push({ name: name, desc: desc || '', t: Date.now() });
    if (_events.length > 40) _events.shift();
  }
  function begin(label, opts) {
    _maybePrune();   /* 惰性清理：Map 超阈值时才扫一遍，不额外开销 */
    opts = opts || {};
    var id = ++_seq;
    var kind = KINDS.indexOf(opts.kind) >= 0 ? opts.kind : 'async';
    _m.set(id, { id: id, label: String(label || '任务'), kind: kind, detail: String(opts.detail || ''), startedAt: Date.now(), status: 'run', ctrl: opts.ctrl || null });
    _event('begin', String(label || '任务'));
    _notify('begin', _m.get(id));
    return id;
  }
  /* end 幂等：重复调用不抛错（超时兜底与onmessage 可能都先到） */
  function end(id) {
    if (id) {
      var j = _m.get(id);
      if (j && j.status !== 'done' && j.status !== 'fail' && j.status !== 'aborted') {
        j.end = Date.now(); j.status = 'done';
        _event('done', j.label);
        _notify('end', j);
      }
    }
    return id;
  }
  /* fail：任务失败。终态守卫与 end/abort 同口径：已结束的任务不再改写，
     否则同一任务会先 done 后 fail，顶栏芯片与进程页两处读数打架。 */
  function fail(id, err) {
    var j = _m.get(id);
    if (j && j.status === 'run') {
      j.end = Date.now(); j.status = 'fail'; j.error = String(err || '');
      _event('fail', j.label + (err ? '：' + err : ''));
      _notify('fail', j);
    }
    return id;
  }
  /* abort：中止任务（若有 ctrl.abort 则调用；.abort） */
  function abort(id) {
    var j = _m.get(id);
    if (j && j.status === 'run') {
      if (j.ctrl && typeof j.ctrl.abort === 'function') {
        try { j.ctrl.abort(); } catch (e) {}
      }
      j.end = Date.now(); j.status = 'aborted';
      _event('abort', j.label);
      _notify('abort', j);
    }
    return id;
  }
  /* setDetail 就地更新详情而不重建条目：id 不变、startedAt 不变，
     这样进度刷新不会让"已耗时"从0 重新开始计时。 */
  function setDetail(id, detail) {
    var j = _m.get(id);
    if (j) j.detail = String(detail == null ? '' : detail);
    if (j) _notify('detail', j);
    return !!j;
  }
  function list() {
    var now = Date.now();
    return Array.from(_m.values()).map(function (j) {
      return { id: j.id, label: j.label, kind: j.kind, detail: j.detail, ms: now - j.startedAt, status: j.status || 'run', error: j.error || '' };
    }).sort(function (a, b) { return b.ms - a.ms; });
  }
  function count() { return _m.size; }
  function events() { return _events.slice(); }
  /* 超过阈值仍未结束视为疑似卡死。已 done/fail/aborted 的条目会再保留 30s，
     只按耗时筛会把「慢但成功」的任务报成卡死。 */
  function stuck(ms) { var lim = ms || 10000; return list().filter(function (j) { return j.status === 'run' && j.ms > lim; }); }
  /* 惰性清理：终态条目保留 30s 后移除，防 Map 无限增长（长会话不泄漏） */
  function _prune() {
    var now = Date.now();
    for (const entry of _m) {
      const j = entry[1];
      if (j.status !== 'run' && now - (j.end || j.startedAt) > 30000) _m.delete(entry[0]);
    }
  }
  /* begin 前先清一次（顺手做，不需要定时器） */
  function _maybePrune() { if (_m.size > 200) _prune(); }
  return { begin: begin, end: end, fail: fail, abort: abort, setDetail: setDetail, list: list, count: count, events: events, stuck: stuck, onChange: onChange, KINDS: KINDS };
})();

