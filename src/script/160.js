/* ================= OPFS 快照（不可用时降级） =================
   轮转（保留 5 份 history）+ latest 损坏回退 history +
   失败 3 次告警 toast + 压缩存储。
   目录结构：快照/latest.json（当前）+ 快照/history-时间戳.json（历史轮转） */
BF.enh.opfs = (function () {
  let _fail = 0;
  async function _root() {
    try {
      if (!navigator.storage || !navigator.storage.getDirectory) return null;
      return await navigator.storage.getDirectory();
    } catch (e) { return null; }
  }
  async function _snapDir(root, create) {
    try { return await root.getDirectoryHandle('快照', { create: !!create }); }
    catch (e) { return null; }
  }
  async function _readJson(dir, name) {
    try {
      const fh = await dir.getFileHandle(name);
      const f = await fh.getFile();
      const body = await f.text();
      /* 兼容压缩：gz1: 前缀用 BF.lz 解压；纯 JSON 直接解析 */
      if (body.slice(0, 4) === 'gz1:') {
        return JSON.parse(await BF.lz.decompress(body));
      }
      return JSON.parse(body);
    } catch (e) { return null; }
  }
  async function _writeJson(dir, name, obj) {
    const body = await BF.lz.compress(JSON.stringify(obj));
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(body);
    await w.close();
  }
  async function _warn(msg) {
    _fail++;
    try { BF.log && BF.log.warn('opfs 快照：' + msg); } catch (e) {}
    if (_fail >= 3) {
      _fail = 0;
      try { BF.noti && BF.noti.error('快照备份失败，OPFS 可能不可用'); } catch (e) {}
    }
  }
  async function snapshot() {
    const root = await _root();
    if (!root) return { ok: false, reason: 'OPFS 不可用' };
    try {
      const dir = await _snapDir(root, true);
      if (!dir) throw new Error('无法创建快照目录');
      /* 轮转：把现有 latest 推入 history，保留 5 份 */
      try {
        const _old = await _readJson(dir, 'latest.json');
        if (_old && _old.at) {
          await _writeJson(dir, 'history-' + Date.now() + '.json', _old);
          const _list = [];
          try {
            for await (const entry of dir.entries()) {
              if (entry[1].kind === 'file' && /^history-\d+\.json$/.test(entry[0])) _list.push(entry[0]);
            }
          } catch (e) {}
          _list.sort(function (a, b) { return a < b ? 1 : -1; });
          for (let i = 5; i < _list.length; i++) {
            try { await dir.removeEntry(_list[i]); } catch (e) { BF.log && BF.log.warn('OPFS 快照轮转删除失败：' + _list[i] + '（' + (e && e.message) + '）'); }
          }
        }
      } catch (e) { try { BF.log && BF.log.warn('快照轮转异常：' + e.message); } catch (e2) {} }
      /* 写入最新快照。带 version 与校验和：恢复走的是同一个 _apply，
         没有这两样就会被当成「旧格式备份」，每次恢复都要问一句迁移，还可能带着损坏落盘。 */
      const data = { at: Date.now(), version: 2, data: {} };
      for (const k of BF.store.lsKeys()) {
        if (k === BF.store.K.CORRUPT || k === BF.store.K.LOG || k === BF.store.K.AUTOBACKUPS || k === BF.store.K.DSL_LOG) continue;
        data.data[k] = BF.store.lsGet(k, null);
      }
      /* settings 里的 AI 密钥/PIN 哈希/盐不得明文写进 OPFS 文件，
         与备份/导出/工作区同步三条路径同规则，接入 BF.store.PRIV_KEYS。
         lsGet 返回 JSON 解析副本，剔除不影响 localStorage 原值。 */
      if (data.data[BF.store.K.SETTINGS] && typeof data.data[BF.store.K.SETTINGS] === 'object') {
        const _priv = data.data[BF.store.K.SETTINGS];
        BF.store.PRIV_KEYS.forEach(function (kk) { delete _priv[kk]; });
        data.data[BF.store.K.SETTINGS] = BF.store.stripPresetSecrets(_priv);
      }
      data.checksum = BF.bk._ckSum(data.data);   /* 与恢复侧同一个实现，见 BF.bk._ckSum */
      await _writeJson(dir, 'latest.json', data);
      _fail = 0;
      return { ok: true, at: data.at };
    } catch (e) {
      BF.err.report('opfs.snapshot', e);
      await _warn((e && e.message) || '写入失败');
      return { ok: false, reason: e.message };
    }
  }
  /* 读最新；latest 缺失/损坏时回退读最近的 history */
  async function _readLatestWithFallback(root) {
    const dir = await _snapDir(root, false);
    if (!dir) return null;
    let bk = await _readJson(dir, 'latest.json');
    if (bk && bk.data) return bk;
    /* 回退：读最近的 history */
    const _list = [];
    try {
      for await (const entry of dir.entries()) {
        if (entry[1].kind === 'file' && /^history-\d+\.json$/.test(entry[0])) _list.push(entry[0]);
      }
    } catch (e) {}
    _list.sort(function (a, b) { return a < b ? 1 : -1; });
    for (const name of _list) {
      const b2 = await _readJson(dir, name);
      if (b2 && b2.data) return b2;
    }
    return null;
  }
  async function restore() {
    const root = await _root();
    if (!root) return { ok: false, reason: 'OPFS 不可用' };
    /* 恢复 = 用快照覆盖当前全部数据，与自动备份列表的恢复入口
       （restoreAt）同用 danger 2 确认——点一下不能整库替换。 */
    const _ok = await BF.ask.confirm({
      title: '恢复 OPFS 快照',
      body: '将用最近一份快照覆盖当前全部数据（书籍、标注、设置、进度），<b>当前状态会被替换</b>。',
      confirmText: '恢复', danger: 2, op: 'opfs.restore', facts: {},
    });
    if (!_ok) return { ok: false, reason: '已取消' };
    try {
      const bk = await _readLatestWithFallback(root);
      if (!bk) return { ok: false, reason: '无快照或读取失败' };
      /* _apply 返回 false 是「一字节都没动」（版本过新 / 校验和不符 / 正文缺席 / 安全差异被拒）。
         吞掉这个返回值就等于对用户说「已恢复」，而数据还停在原样。 */
      const _r = await BF.bk._apply(bk);
      if (_r === false) return { ok: false, reason: '恢复未执行（校验或版本检查未通过，具体见提示与日志）' };
      return { ok: true };
    } catch (e) { return { ok: false, reason: '无快照或读取失败' }; }
  }
  async function clear() {
    const root = await _root();
    if (!root) return { ok: false, reason: 'OPFS 不可用' };
    try {
      const dir = await _snapDir(root, false);
      if (!dir) return { ok: true };
      const names = [];
      try { for await (const entry of dir.entries()) names.push(entry[0]); } catch (e) {}
      for (const n of names) { try { await dir.removeEntry(n); } catch (e) {} }
      return { ok: true };
    } catch (e) { return { ok: false, reason: e.message }; }
  }
  return { snapshot, restore, clear };
})();

