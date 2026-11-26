/* ================= 工作区同步 =================
   把本地 LS 数据增量同步到 OPFS 工作区（快照/ls.json），防换机/清站点数据丢失。
   - 增量哈希：每键哈希缓存（Map 键→{h,v}），值未变跳过，避免全量 IO
   - schedule 500ms 防抖 + 同步游标键直写（防自激循环）
   - restore 比对时间戳，远端更新则覆盖本地
   - 开关：settings.wsSync（默认关，用户自主开启） */
BF.enh.ws = (function () {
  const DIR = '工作区';
  const KEY = 'ws_saved_ts';
  let _sched = null, _busy = false, _lastSync = 0;
  let _keyHashes = new Map(), _lastHash = 0;
  function enabled() { return !!BF.settings.get('wsSync'); }
  async function _root() {
    try {
      if (!navigator.storage || !navigator.storage.getDirectory) return null;
      return await navigator.storage.getDirectory();
    } catch (e) { return null; }
  }
  async function _wsDir(root, create) {
    try { return await root.getDirectoryHandle(DIR, { create: !!create }); }
    catch (e) { return null; }
  }
  /* 收集 LS 快照（剥离密钥）。密钥清单必须与备份侧共用 BF.store.PRIV_KEYS
     唯一实现：PIN 哈希可被字典攻击穷举，与 API 密钥同级别敏感，
     任何一条落盘路径（备份/导出/工作区同步）都不例外。 */
  function _collect() {
    const PRIV = BF.store.PRIV_KEYS;   /* 唯一来源，见 BF.store 导出 */
    const out = {};
    for (const k of BF.store.lsKeys()) {
      if (k === BF.store.K.CORRUPT || k === BF.store.K.LOG || k === BF.store.K.AUTOBACKUPS || k === BF.store.K.DSL_LOG) continue;
      const v = BF.store.lsGet(k, null);
      if (v === null) continue;
      let val = v;
      if (k === BF.store.K.SETTINGS && typeof v === 'object') {
        val = JSON.parse(JSON.stringify(v));
        PRIV.forEach(function (p) { delete val[p]; });
        val = BF.store.stripPresetSecrets(val);
      }
      out[k] = val;
    }
    return out;
  }
  /* 增量哈希的序列化口径：JSON.stringify 保结构（对象键序稳定即可，
     同一份数据两次序列化结果一致）；异常/不可序列化值退回 String。
     lsGet 出来的是 JSON.parse 的产物，不存在循环引用，这里的 try
     只是纵深防御。 */
  function _ser(v) {
    try { const s = JSON.stringify(v); return s === undefined ? 'undefined' : s; }
    catch (e) { return String(v); }
  }
  async function sync() {
    if (!enabled()) return false;
    const root = await _root();
    if (!root) return false;
    try {
      const dir = await _wsDir(root, true);
      if (!dir) return false;
      const ls = _collect();
      const payload = { app: 'beifeng', ts: Date.now(), ls: ls };
      /* 增量哈希：只对值变化的键重算。序列化必须用 JSON.stringify(v)——
         String(v) 对对象恒得 "[object Object]"，所有对象键（books_meta /
         highlights / settings / notes…）哈希相同，内容变化检不出，
         同步会直接跳过写盘；缓存比对键也必须是序列化串（pe.s）而非值引用——
         _collect 每次返回全新 parse 对象，引用比较恒不相等、缓存永远命中不了。 */
      let h = 0;
      const nowH = new Map();
      try {
        for (const k in ls) {
          if (k === KEY) continue;
          const v = ls[k];
          const sv = _ser(v);
          const pe = _keyHashes.get(k);
          let kh = pe && pe.h;
          if (kh === undefined || !pe || pe.s !== sv) {
            kh = 0;
            for (let i = 0; i < sv.length; i++) kh = (kh * 31 + sv.charCodeAt(i)) >>> 0;
          }
          nowH.set(k, { h: kh, s: sv });
          h = (h * 31 + kh) >>> 0;
        }
      } catch (e) {
        for (const k in ls) {
          if (k === KEY) continue;
          const sv = _ser(ls[k]);
          for (let i = 0; i < sv.length; i++) h = (h * 31 + sv.charCodeAt(i)) >>> 0;
        }
      }
      _keyHashes = nowH;
      if (_lastHash === h) { _lastSync = payload.ts; return true; }
      _lastHash = h;
      const body = await BF.lz.compress(JSON.stringify(payload));
      const fh = await dir.getFileHandle('ls.json', { create: true });
      const w = await fh.createWritable();
      await w.write(body);
      await w.close();
      _lastSync = payload.ts;
      /* 同步游标直写（绕过 lsSet 防自激） */
      try { localStorage.setItem(BF.store.PREFIX + KEY, String(payload.ts)); } catch (e) { BF.err.report('ws.cursorWrite', e); }
      return true;
    } catch (e) {
      try { BF.log && BF.log.warn('工作区同步失败：' + (e && e.message)); } catch (e2) {}
      return false;
    }
  }
  function schedule() {
    if (!enabled()) return;
    if (_sched) clearTimeout(_sched);
    _sched = setTimeout(function () { _sched = null; sync(); }, 500);
  }
  /* 关页/切后台时把还在防抖窗口里的那一次同步立刻做掉：
     500ms 的窗口正好会吃掉「改完设置立刻关标签页」这一种，下一次打开看到的还是旧快照。 */
  try {
    const _flushNow = function () { if (_sched) { clearTimeout(_sched); _sched = null; try { sync(); } catch (e) {} } };
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') _flushNow(); });
    window.addEventListener('pagehide', _flushNow);
  } catch (e) {}
  async function restore() {
    const root = await _root();
    if (!root) return false;
    try {
      const dir = await _wsDir(root, false);
      if (!dir) return false;
      const fh = await dir.getFileHandle('ls.json');
      const f = await fh.getFile();
      const body = await f.text();
      const payload = body.slice(0, 4) === 'gz1:' ? JSON.parse(await BF.lz.decompress(body)) : JSON.parse(body);
      if (!payload || !payload.ls || payload.app !== 'beifeng') return false;
      const curTs = Number(localStorage.getItem(BF.store.PREFIX + KEY)) || 0;
      if (payload.ts > curTs) {
        /* 覆盖前先留一份内存回滚点：这是「先清空、再逐键写」，
           lsSet 在配额耗尽时只返回 false 不抛异常 —— 不看返回值就是清完一半、写不进去，
           用户看到空书架，而这里还返回 true。失败一律把本地原样放回去再报 false。 */
        const _keep = new Set([KEY, BF.store.K.CORRUPT, BF.store.K.LOG, BF.store.K.AUTOBACKUPS]);
        const _backup = {};
        try {
          for (const k of BF.store.lsKeys()) { if (!_keep.has(k)) _backup[k] = BF.store.lsGet(k, null); }
          for (const k of BF.store.lsKeys()) { if (!_keep.has(k)) BF.store.lsRemove(k); }
          let _failed = 0;
          for (const k in payload.ls) { if (!BF.store.lsSet(k, payload.ls[k])) _failed++; }
          if (_failed) throw new Error('写入失败 ' + _failed + ' 个键（存储空间不足）');
          try { localStorage.setItem(BF.store.PREFIX + KEY, String(payload.ts)); } catch (e) { BF.err.report('ws.cursorWriteRestore', e); }
          BF.settings.load();
          BF.theme.apply();
          try { BF.app.renderHome(); BF.app.renderBookshelf(); } catch (e) { BF.err.report('render.afterSettingsReset', e); }
          return true;
        } catch (e) {
          BF.err.report('ws.restore.apply', e);
          try {
            for (const k of BF.store.lsKeys()) { if (!_keep.has(k)) BF.store.lsRemove(k); }
            for (const k in _backup) BF.store.lsSet(k, _backup[k]);
            BF.settings.load(); BF.theme.apply();
          } catch (e2) { BF.err.report('ws.restore.rollback', e2); }
          try { BF.noti && BF.noti.warn('工作区同步未能落地，已还原本地数据：' + ((e && e.message) || e)); } catch (e3) {}
          return false;
        }
      }
      return false;
    } catch (e) { return false; }
  }
  function lastSync() { return _lastSync; }
  return { enabled: enabled, sync: sync, schedule: schedule, restore: restore, lastSync: lastSync };
})();

