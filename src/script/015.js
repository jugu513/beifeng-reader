/* ===== 腾退阶梯（可靠性三档·第①档） =====
   关键写入撞上配额/存储故障时，按「可重建数据先死」的次序逐档腾退，
   每腾一档立刻重试本次写入，能省则省：
   ① 朗读音频缓存（IDB，重听一次即回）→ ② AI 摘要缓存 → ③ 运行日志 →
   ④ 损坏隔离区旧副本（只清 24h 前的旧档，新鲜凭据绝不碰）→ ⑤ 最旧自动备份。
   每次腾退记入 wstats.evicted 与腾退名单，提示写明腾了什么。 */
/* 腾退阶梯：②③④⑤ 同步与异步两版共用一份定义；
   ①朗读音频缓存是异步的（IDB），只有异步版有。 */
const _evictStepTTS = { name: '朗读音频缓存', run: async function () {
  try { if (BF.tts && BF.tts.cache && BF.tts.cache.clear) return (await Promise.resolve(BF.tts.cache.clear())) > 0; } catch (e) {}
  return false;
}};
const _evictStepAI = { name: 'AI 摘要缓存', run: function () {
  try { if (BF.store.lsGet(BF.store.K.AI_SUMMARY_CACHE, null) == null) return false; BF.store.lsRemove(BF.store.K.AI_SUMMARY_CACHE); return true; } catch (e) { return false; }
}};
const _evictStepLog = { name: '运行日志', run: function () {
  try { if (BF.store.lsGet(BF.store.K.LOG, null) == null) return false; BF.store.lsRemove(BF.store.K.LOG); return true; } catch (e) { return false; }
}};
const _evictStepCorrupt = { name: '损坏隔离区旧副本', run: function () {
  /* 只清 24h 前的旧档：隔离区是「书架刚被读坏」的唯一凭据（见 corruptClear 处注释），
     新鲜的绝不能为腾退让路。旧档的定义：corrupt '_t' 时间戳早于 24h 前。 */
  try {
    const c = BF.store.lsGet(BF.store.K.CORRUPT, null) || {};
    let t = {}; try { t = BF.store.lsGet(BF.store.K.CORRUPT + '_t', {}) || {}; } catch (e0) {}
    const cut = Date.now() - 24 * 3600 * 1000;
    let n = 0;
    for (const kk in c) { const ts = t[kk] || 0; if (ts && ts < cut) { delete c[kk]; delete t[kk]; n++; } }
    if (!n) return false;
    /* force：这两档写的是「缩小后的自有数据」，而腾退恰恰发生在配额 block 级——
       不跳过非关键写入闸门，它们会恒被拒，阶梯实际只剩前两档。 */
    if (BF.store.lsSet(BF.store.K.CORRUPT, c, { force: true }) !== true) return false;
    try { BF.store.lsSet(BF.store.K.CORRUPT + '_t', t, { force: true }); } catch (e1) {}
    return true;
  } catch (e) { return false; }
}};
const _evictStepBackup = { name: '最旧自动备份', run: function () {
  /* 与 _saveAuto 轮转同口径：最新在 list[0]，最旧在末位；OPFS 文件一并删。 */
  try {
    const list = BF.store.lsGet(BF.store.K.AUTOBACKUPS, []);
    if (!list || !list.length) return false;
    const _old = list[list.length - 1];
    if (_old && _old.file && BF.snap) { try { BF.snap.remove('auto', 'full', _old.file); } catch (e0) {} }
    list.pop();
    if (BF.store.lsSet(BF.store.K.AUTOBACKUPS, list, { force: true }) !== true) return false;
    return true;
  } catch (e) { return false; }
}};
const _EVICT_STEPS_SYNC = [_evictStepAI, _evictStepLog, _evictStepCorrupt, _evictStepBackup];
const _EVICT_STEPS_ASYNC = [_evictStepTTS, _evictStepAI, _evictStepLog, _evictStepCorrupt, _evictStepBackup];

