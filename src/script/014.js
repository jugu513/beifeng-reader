/* ===== 写入健康计数（可靠性三档·第③档） =====
   每键记账：tries=写尝试、fails=写失败、evicted=腾退救回。
   挂在 setCritical / idbPutAll 两个漏斗口：前者覆盖全部关键 LS 键
   （mutate/mergeWrite 内部也走它），后者覆盖章节批量入库。
   消费方：工作台·数据栏「存储」页（写入健康区块）与诊断报告导出。
   只增不减、仅存内存（会话口径）——持久化它自己反而要占配额，
   与「腾退救数据」的目标背道而驰。 */
BF.store.wstats = (function () {
  const m = {};
  function slot(k) { return m[k] || (m[k] = { tries: 0, fails: 0, evicted: 0 }); }
  return {
    bump: function (k, f, n) { if (!k) return; const e = slot(k); if (f === 'tries') e.tries += (n || 1); else if (f === 'fails') e.fails += (n || 1); else if (f === 'evicted') e.evicted += (n || 1); },
    snapshot: function () { try { return JSON.parse(JSON.stringify(m)); } catch (e) { return {}; } },
    hasIncident: function () { for (const k in m) { if (m[k].fails > 0 || m[k].evicted > 0) return true; } return false; },
  };
})();
