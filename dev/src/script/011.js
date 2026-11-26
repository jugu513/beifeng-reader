/* ================= 4e. BF.fsync · OPFS 文件系统抽象 =================
   书籍正文与快照的落点。可用时提供文件级 mkdir/写读/删/改名，
   且 stageWrite 实现「暂存→校验→原子改名激活」，为两阶段恢复打底。
   navigator.storage.getDirectory 不可用时 available=false，调用方回落 IDB/原层。 */
BF.fsync = (function () {
  let root = null, available = false, _err = null;
  async function init() {
    try {
      if (!(navigator.storage && navigator.storage.getDirectory)) { available = false; root = null; return false; }
      root = await navigator.storage.getDirectory();
      available = !!root;
    } catch (e) { _err = e; available = false; root = null; }
    return available;
  }
  function ok() { return available && !!root; }
  async function _dir(path) {
    let d = root;
    const parts = String(path || '').split('/').filter(Boolean);
    for (const p of parts) d = await d.getDirectoryHandle(p, { create: true });
    return d;
  }

  /* ===== OPFS 类别文件夹布局（C 的目录层）=================================
     固定四类根下平级目录：books（正文）/annotations（标注镜像）/cache（可重建缓存）/
     backups（备份）。四类均为根下「单段名」，刻意不嵌套进 books/：
     孤儿扫描只列 books/ 一层目录名当书 id（BF.library._listOpfsBookIds），
     新分区若塞进 books/ 会被当成「没有书架记录的书」在自愈时删光（地雷①）。
     结构隔离（平级目录）比复杂路径匹配可靠：新分区永远混不进书 id 清单。
     约定：books/<id>/body.txt 与 books/<id>/parts/ 既有路径一字不改，老书照常可读。 */
  const OPFS_DIRS = Object.freeze({ BOOKS: 'books', ANNOTATIONS: 'annotations', CACHE: 'cache', BACKUPS: 'backups' });
  const _RESERVED = Object.freeze([OPFS_DIRS.BOOKS, OPFS_DIRS.ANNOTATIONS, OPFS_DIRS.CACHE, OPFS_DIRS.BACKUPS, '快照', '工作区']);
  function isReservedOpfsDir(name) { return _RESERVED.indexOf(String(name || '')) >= 0; }
  /* 类别路径构造：dirPath('books', id, 'body.txt') → 'books/<id>/body.txt'。
     只拼路径不建目录、不改现有读写点（现有点保留字面量路径，避免动正文判据）。 */
  function dirPath(category) {
    const segs = Array.prototype.slice.call(arguments, 1).map(function (s) { return String(s == null ? '' : s); }).filter(Boolean);
    return [category].concat(segs).join('/');
  }
  /* 幂等建四类根目录（create:true 对已存在目录无副作用），失败静默：
     目录建不了不致命，读写路径各自有 create:true 兜底；这里只让面板列目录时结构整齐。 */
  async function ensureLayout() {
    if (!ok()) return false;
    try {
      for (const d of [OPFS_DIRS.BOOKS, OPFS_DIRS.ANNOTATIONS, OPFS_DIRS.CACHE, OPFS_DIRS.BACKUPS]) {
        try { await root.getDirectoryHandle(d, { create: true }); } catch (e) {}
      }
      return true;
    } catch (e) { return false; }
  }
  /* 列某类根目录一层条目名（只读，create:false 不建目录）。 */
  async function listCategory(category) {
    const out = [];
    if (!ok()) return out;
    try {
      const d = await root.getDirectoryHandle(category, { create: false });
      for await (const ent of d.entries()) out.push({ name: ent[0], dir: !!(ent[1] && ent[1].kind === 'directory') });
    } catch (e) {}
    return out;
  }

  /* ===== 根目录句柄绑定（用户自选存储位置）=================================
     支持 showDirectoryPicker 时可把 OPFS 逻辑根改绑到用户选的目录；不支持/取消/权限
     失效时静默回落内置 OPFS，绝不承诺做不到的事。句柄存独立 IDB 小库（不依赖
     BF.store，避免 initBackend 里 store 尚未构造完的循环依赖）。 */
  const RH_DB = 'bf_fsa_root', RH_STORE = 'handle', RH_KEY = 'root';
  function _rhOpen() {
    return new Promise(function (res, rej) {
      try {
        const rq = indexedDB.open(RH_DB, 1);
        rq.onupgradeneeded = function () { try { rq.result.createObjectStore(RH_STORE); } catch (e) {} };
        rq.onsuccess = function () { res(rq.result); };
        rq.onerror = function () { rej(rq.error); };
      } catch (e) { rej(e); }
    });
  }
  async function _rhGet() {
    try {
      const db = await _rhOpen();
      return await new Promise(function (res) {
        try {
          const rq = db.transaction(RH_STORE, 'readonly').objectStore(RH_STORE).get(RH_KEY);
          rq.onsuccess = function () { res(rq.result || null); };
          rq.onerror = function () { res(null); };
        } catch (e) { res(null); }
      });
    } catch (e) { return null; }
  }
  async function _rhSet(handle) {
    try {
      const db = await _rhOpen();
      await new Promise(function (res, rej) {
        try {
          const tx = db.transaction(RH_STORE, 'readwrite');
          tx.objectStore(RH_STORE).put(handle, RH_KEY);
          tx.oncomplete = function () { res(); }; tx.onerror = function () { rej(tx.error); };
        } catch (e) { rej(e); }
      });
      return true;
    } catch (e) { return false; }
  }
  async function _rhDel() {
    try {
      const db = await _rhOpen();
      await new Promise(function (res) {
        try {
          const tx = db.transaction(RH_STORE, 'readwrite');
          tx.objectStore(RH_STORE).delete(RH_KEY);
          tx.oncomplete = function () { res(); }; tx.onerror = function () { res(); };
        } catch (e) { res(); }
      });
      return true;
    } catch (e) { return false; }
  }
  function rootHandleSupported() { return typeof window.showDirectoryPicker === 'function'; }
  async function _permOf(handle) {
    try { return handle && typeof handle.queryPermission === 'function' ? (await handle.queryPermission({ mode: 'readwrite' })) : 'granted'; }
    catch (e) { return 'prompt'; }
  }
  /* 用户点「选择存储位置」触发：必须在用户手势里调用（FSA 要求）。
     返回结构化结果给 UI，成功则立即改绑 root 并重跑 init 语义（available 保持）。 */
  async function bindRootHandle() {
    if (!rootHandleSupported()) return { ok: false, reason: 'unsupported', msg: '当前浏览器不支持自选目录，仍使用内置存储' };
    try {
      const h = await window.showDirectoryPicker({ mode: 'readwrite' });
      if (!h) return { ok: false, reason: 'cancelled', msg: '已取消选择' };
      const perm = await _permOf(h);
      if (perm !== 'granted') {
        /* 刚授权完通常 granted；若仍 prompt，尝试 request（仍在用户手势链内） */
        let g = perm;
        if (perm === 'prompt' && typeof h.requestPermission === 'function') {
          try { g = await h.requestPermission({ mode: 'readwrite' }); } catch (e) { g = 'denied'; }
        }
        if (g !== 'granted') return { ok: false, reason: 'denied', msg: '目录权限未授予，继续使用内置存储' };
      }
      root = h; available = true; _externalRoot = true;
      await _rhSet(h);
      await ensureLayout();
      return { ok: true, msg: '已切换存储位置到自选目录' };
    } catch (e) {
      if (e && e.name === 'AbortError') return { ok: false, reason: 'cancelled', msg: '已取消选择' };
      _err = e;
      return { ok: false, reason: 'error', msg: '绑定目录失败，仍使用内置存储：' + (e && e.message || e) };
    }
  }
  /* 恢复：应用冷启动时尝试读回上次的句柄；权限过期则静静清掉回内置 OPFS，不打扰用户。 */
  async function restoreRootHandle() {
    if (!rootHandleSupported()) return false;
    const h = await _rhGet();
    if (!h) return false;
    const perm = await _permOf(h);
    if (perm !== 'granted') { await _rhDel(); return false; }
    root = h; available = true; _externalRoot = true;
    await ensureLayout();
    return true;
  }
  async function clearRootHandle() {
    await _rhDel();
    _externalRoot = false;
    /* 回到内置 OPFS：重新 init，失败则整体回落（由各调用方的 available 检查负责） */
    return await init();
  }
  let _externalRoot = false;

  async function writeFile(path, data) {
    if (!ok()) throw new Error('文件系统不可用（浏览器未开放 OPFS 持久化），已回退到 IndexedDB');
    const i = path.lastIndexOf('/');
    const dir = i >= 0 ? await _dir(path.slice(0, i)) : root;
    const name = i >= 0 ? path.slice(i + 1) : path;
    const fh = await dir.getFileHandle(name, { create: true });
    const w = await fh.createWritable();
    await w.write(data); await w.close();
    return true;
  }
  async function readFile(path) {
    if (!ok()) throw new Error('文件系统不可用（浏览器未开放 OPFS 持久化），已回退到 IndexedDB');
    const i = path.lastIndexOf('/');
    const dir = i >= 0 ? await _dir(path.slice(0, i)) : root;
    const name = i >= 0 ? path.slice(i + 1) : path;
    const fh = await dir.getFileHandle(name);
    const f = await fh.getFile();
    return await f.text();
  }
  async function remove(path) {
    if (!ok()) throw new Error('文件系统不可用（浏览器未开放 OPFS 持久化），已回退到 IndexedDB');
    const i = path.lastIndexOf('/');
    const dir = i >= 0 ? await _dir(path.slice(0, i)) : root;
    const name = i >= 0 ? path.slice(i + 1) : path;
    await dir.removeEntry(name, { recursive: true });
    return true;
  }
  async function rename(src, dst) {
    if (!ok()) throw new Error('文件系统不可用（浏览器未开放 OPFS 持久化），已回退到 IndexedDB');
    const sDir = src.indexOf('/') >= 0 ? await _dir(src.slice(0, src.lastIndexOf('/'))) : root;
    const dDir = dst.indexOf('/') >= 0 ? await _dir(dst.slice(0, dst.lastIndexOf('/'))) : root;
    const sfh = await sDir.getFileHandle(src.slice(src.lastIndexOf('/') + 1));
    const f = await sfh.getFile();
    const buf = await f.arrayBuffer();
    const dfh = await dDir.getFileHandle(dst.slice(dst.lastIndexOf('/') + 1), { create: true });
    const w = await dfh.createWritable();
    await w.write(buf); await w.close();
    await sDir.removeEntry(src.slice(src.lastIndexOf('/') + 1));
    return true;
  }
  /* 暂存写 + 校验 + 原子改名：写 <path>.staging → validate(tmp) → rename 覆盖 → 清旧暂存 */
  async function stageWrite(path, data, validate) {
    if (!ok()) throw new Error('文件系统不可用（浏览器未开放 OPFS 持久化），已回退到 IndexedDB');
    const tmp = path + '.staging';
    await writeFile(tmp, data);
    let okv = true;
    if (validate) { try { okv = await validate(tmp); } catch (e) { okv = false; } }
    if (!okv) { try { await remove(tmp); } catch (e) {} return false; }
    await rename(tmp, path);
    return true;
  }
  async function ls(path) {
    if (!ok()) return [];
    const d = path ? await _dir(path) : root;
    const out = [];
    try { for await (const ent of d.entries()) out.push({ name: ent[0], dir: ent[1].kind === 'directory' }); }
    catch (e) {}
    return out;
  }
  return {
    init: init,
    get available() { return available; },
    get root() { return root; },
    get error() { return _err; },
    get externalRoot() { return _externalRoot; },
    ok: ok, writeFile: writeFile, readFile: readFile, remove: remove, rename: rename, stageWrite: stageWrite, ls: ls, _dir: _dir,
    /* OPFS 类别文件夹 + 根目录句柄 */
    OPFS_DIRS: OPFS_DIRS, isReservedOpfsDir: isReservedOpfsDir, dirPath: dirPath, ensureLayout: ensureLayout, listCategory: listCategory,
    rootHandleSupported: rootHandleSupported, bindRootHandle: bindRootHandle, restoreRootHandle: restoreRootHandle, clearRootHandle: clearRootHandle
  };
})();

