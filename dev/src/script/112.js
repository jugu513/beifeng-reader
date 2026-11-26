/* ================= A4. 摘要缓存（LRU） ================= */
BF.ai.sumCache = (function () {
  const KEY = 'AI_SUMMARY_CACHE';
  /* P4.5：读 allocOf('aiSummary') 决定写策略。摘要是同步读缓存（get 必须同步返回，
     研读卡在同步路径消费），主存恒 LS 不改语义；allocOf='idb' 时额外异步写一份 IDB
     耐久副本（LS 满/被清后可由 BF.ai.sumCache.restoreFromIdb 引导回），这就是本类
     「选 idb 真生效」的形态。切 LS 则只写主存、不留副本。 */
  function _mirror() {
    try { return BF.store.allocOf('aiSummary') === 'idb'; } catch (e) { return false; }
  }
  const IDB_K = 'ai.summary.mirror';
  let mem = null;
  function _load() {
    if (mem) return mem;
    mem = BF.store.lsGet(BF.store.K[KEY], {});
    return mem;
  }
  let _writeT = null;
  function _scheduleWrite() {
    if (_writeT) return;
    _writeT = setTimeout(function () {
      _writeT = null;
      BF.store.lsSet(BF.store.K[KEY], mem || {});
      /* P4.5：allocOf='idb' 时异步镜像一份耐久副本。失败静默（LS 主存已是真源）。 */
      if (_mirror()) {
        try { Promise.resolve(BF.store.idbKeyPut(IDB_K, mem || {})).catch(function () {}); } catch (e) {}
      }
    }, 250);
  }
  /* LRU 必须「先删再写」：m[k]=v 对已存在 key 不改变 Object.keys 顺序、命中也不重排，
     会退化成 FIFO（热门摘要被冷门挤掉），删后重写才能把热点移到末尾 = 真 LRU。
     get 命中时在内存重排（影响后续淘汰），持久化仍交给 set 的 _scheduleWrite，不做读放大。 */
  function get(k) { const m = _load(); if (!(k in m)) return undefined; const v = m[k]; delete m[k]; m[k] = v; return v; }
  function set(k, v) {
    const m = _load();
    if (k in m) delete m[k];
    m[k] = v;
    const keys = Object.keys(m);
    if (keys.length > 500) delete m[keys[0]];
    _scheduleWrite();
  }
  function clear() { mem = {}; BF.store.lsSet(BF.store.K[KEY], {}); if (_mirror()) { try { Promise.resolve(BF.store.idbKeyPut(IDB_K, {})).catch(function () {}); } catch (e) {} } }
  /* P4.5：从 IDB 耐久副本引导回 LS 主存——仅当 allocOf='idb' 且 LS 主存为空（被清/被驱逐）时调用，
     由数据自愈或面板显式触发；返回补回条目数。 */
  async function restoreFromIdb() {
    if (!_mirror()) return 0;
    try {
      const cur = BF.store.lsGet(BF.store.K[KEY], null);
      if (cur && typeof cur === 'object' && Object.keys(cur).length) return 0;   /* 主存有数据，不动 */
      const saved = await BF.store.idbKeyGet(IDB_K, null);
      if (saved && typeof saved === 'object' && Object.keys(saved).length) {
        mem = saved; BF.store.lsSet(BF.store.K[KEY], saved); return Object.keys(saved).length;
      }
    } catch (e) {}
    return 0;
  }
  return { get, set, clear, restoreFromIdb,
    flush() { if (_writeT) { clearTimeout(_writeT); _writeT = null; BF.store.lsSet(BF.store.K[KEY], mem || {}); if (_mirror()) { try { Promise.resolve(BF.store.idbKeyPut(IDB_K, mem || {})).catch(function () {}); } catch (e) {} } } } };
})();

