/* ================= 4f. BF.snap · 快照层（OPFS，独立逻辑分区） =================
   自动/手动备份写 snapshots/<kind>/<bookId>/<ts>.bfbak；未选文件夹时即落此默认程序目录。
   写路径走 fsync.stageWrite（暂存+校验+改名），为两阶段恢复提供 staging 区。
   OPFS 不可用时整体不可用（调用方回落原层备份机制）。 */
BF.snap = (function () {
  const ROOT = 'snapshots';
  function _path(kind, bookId, name) { return ROOT + '/' + (kind || 'auto') + '/' + (bookId || '_app') + '/' + name; }
  async function write(kind, bookId, name, dataStr, validate) {
    if (!BF.fsync || !BF.fsync.available) return { ok: false, reason: 'noOPFS' };
    const ok = await BF.fsync.stageWrite(_path(kind, bookId, name), dataStr, validate);
    return { ok: !!ok };
  }
  async function read(kind, bookId, name) {
    if (!BF.fsync || !BF.fsync.available) return null;
    try { return await BF.fsync.readFile(_path(kind, bookId, name)); } catch (e) { return null; }
  }
  async function list(kind, bookId) {
    if (!BF.fsync || !BF.fsync.available) return [];
    const ents = await BF.fsync.ls(ROOT + '/' + (kind || 'auto') + '/' + (bookId || '_app'));
    return ents.filter(function (e) { return !e.dir && !e.name.endsWith('.staging'); }).map(function (e) { return e.name; });
  }
  async function remove(kind, bookId, name) {
    if (!BF.fsync || !BF.fsync.available) return false;
    try { await BF.fsync.remove(_path(kind, bookId, name)); return true; } catch (e) { return false; }
  }
  return { write: write, read: read, list: list, remove: remove, ROOT: ROOT };
})();

