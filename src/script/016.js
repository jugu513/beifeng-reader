/* ===== P4b 腾退「搬迁档」（先搬后删，R-10）====================================
   满区时先把可重建/可搬内容迁到有余量的区，迁完腾不出空间才走下面的删除阶梯——
   删除从第一手段降为最后手段。复用 migrateCategory 的懒迁移形态（读旧区写新区、不删旧，
   资源一次性搬迁，不每次腾退都跑），只搬可重建的大体积类（正文），承重键主存永不迁。
   仅接入异步阶梯 evictLadder；同步版 evictLadderSync 跳过（守地雷④同步契约）。 */
let _relocateTried = false;
async function relocateBeforeEvict() {
  if (_relocateTried) return { moved: 0, target: null };   /* 一次会话只试一次：搬迁本身要时间，不每次腾退重跑 */
  _relocateTried = true;
  try {
    const budget = await mediaBudget();
    if (!budget.tight && !(budget.origin.capBytes > 0 && budget.origin.freeBytes < 8 * 1024 * 1024)) {
      return { moved: 0, target: null };   /* 不缺空间，无需搬 */
    }
    /* 谁有余量往谁导：LS 空 → 把正文迁到 LS；origin 空而 LS 紧 → 正文回 OPFS/IDB。 */
    const target = (budget.ls.freeBytes > 8 * 1024 * 1024) ? 'ls'
      : (budget.opfs ? 'opfs' : (budget.idb ? 'idb' : null));
    if (!target) return { moved: 0, target: null };
    /* 临时把 body 分配切到目标，借 migrateCategory 完成搬迁，再恢复用户原设置（不擅自改用户选择）。 */
    let saved = null;
    try { saved = BF.settings.get('storageAlloc'); } catch (e) {}
    const tmp = Object.assign({}, saved || {}, { body: target });
    try { BF.settings.set('storageAlloc', tmp); } catch (e) {}
    let r = { moved: 0, failed: 0, skipped: false };
    try { r = await migrateCategory('body'); } catch (e) {}
    /* 恢复用户原设置：不动用户对 body 的选择（搬迁是应急腾退，不是替用户改偏好）。 */
    try {
      if (saved && typeof saved === 'object') BF.settings.set('storageAlloc', saved);
      else { const cur = BF.settings.get('storageAlloc') || {}; delete cur.body; BF.settings.set('storageAlloc', cur); }
    } catch (e) {}
    return { moved: r.moved || 0, target: target };
  } catch (e) { BF.err && BF.err.report('evict.relocate', e); return { moved: 0, target: null }; }
}

BF.store.evictLadder = async function (tryFn, wkey) {
  const evicted = [];
  function bumpEv(name) { if (wkey) BF.store.wstats.bump(wkey, 'evicted'); if (evicted.indexOf(name) < 0) evicted.push(name); }
  /* P4b：先搬后删——第一步试搬迁档。搬迁成功且本次写入救回 → 直接返回，一档删除都不做（R-10）。 */
  try {
    const mv = await relocateBeforeEvict();
    if (mv.moved > 0) {
      const okMv = await tryFn();
      if (okMv) return { ok: true, evicted: evicted, relocated: mv };
      /* 搬了仍写不进（其它类占满）：如实记一笔，继续走删除阶梯，但不重复搬。 */
      try { BF.log && BF.log.warn('腾退：已把 ' + mv.moved + ' 项搬到 ' + mv.target + '，仍不足，转删除阶梯'); } catch (e) {}
    }
  } catch (e) {}
  for (const s of _EVICT_STEPS_ASYNC) {
    let freed = false;
    try { freed = await s.run(); } catch (e) { freed = false; }
    if (!freed) continue;
    /* 腾退完成即刻重试；tryFn 返回真值即成功，后面几档就不用再腾 */
    let okR = false;
    try { okR = await tryFn(); } catch (e) { okR = false; }
    if (okR) { bumpEv(s.name); return { ok: true, evicted: evicted }; }
    if (evicted.indexOf(s.name) < 0) evicted.push(s.name);
  }
  return { ok: false, evicted: evicted };
};
/* 同步档腾退：跳过异步的①朗读音频缓存（IDB 操作，setCritical 是同步契约，
   不能 await），按②→⑤逐档腾退+重试。供 setCritical 配额失败路径使用；
   异步档（含①）由 putBatchLayers 等异步上下文走完整 evictLadder。 */
BF.store.evictLadderSync = function (tryFn, wkey) {
  const evicted = [];
  function bumpEv(name) { if (wkey) BF.store.wstats.bump(wkey, 'evicted'); if (evicted.indexOf(name) < 0) evicted.push(name); }
  for (const s of _EVICT_STEPS_SYNC) {
    let freed = false;
    try { freed = s.run(); } catch (e) { freed = false; }
    if (!freed) continue;
    let okR = false;
    try { okR = tryFn(); } catch (e) { okR = false; }
    /* 计数只在救回成功这一刻记：wstats.evicted 的语义是「腾退救回」，
       腾了却没救回来的那些不算（异步版 evictLadder 同一口径）。 */
    if (okR) { bumpEv(s.name); return { ok: true, evicted: evicted }; }
    if (evicted.indexOf(s.name) < 0) evicted.push(s.name);
  }
  return { ok: false, evicted: evicted };
};
/* 防重入：腾退重试里的 setCritical 若再失败，不得再次进入腾退（死循环）。
   排队而非丢弃：连续两次配额失败共享一次腾退结果。 */
BF.store.__evictChain = Promise.resolve();
/* UGC→IDB 分层双写 + double-buffer。
   setCritical 主路径仍是 LS（语义不变，零破坏现有同步读取）；
   LS 写成功后，对 UGC 类键异步写一份到 IDB 'kv' 副本，
   写失败不影响 LS（反而多一层保障，不静默丢失）。
   新值用单条事务提交，不留 '__buf.' 回滚副本：IDB 事务天然原子，提交失败整条回滚，
   此时读回滚源只会读到 null —— 那次"回滚"本来就是空转，副本还占着配额。 */
BF.store.__ugcToIdb = async function (k, v) {
  if (!BF.store.isUGCKey || !BF.store.isUGCKey(k)) return;
  try {
    await BF.store.idbKeyTxn([{ k: k, v: v }]);   /* 单条事务原子提交 */
  } catch (e) {
    /* 副本写入失败不影响 LS 真值：LS 已在 setCritical 同步落盘，IDB 仅作 durable 镜像，
       下次同键写入会重新镜像。 */
    BF.err.report('store.ugcToIdb:' + k, e);
    throw e;
  }
  /* 新拓扑镜像：整键数组按 bookId 拆进 IDB 'ugc' 库（按书增量，不整键全量重写）。
     LS 仍是同步真源，此处仅为 durable 副本；legacy 模式不写，强制原层时保持其纯净。 */
  try {
    if (BF.store.mirrorOf && BF.store.mirrorOf(k) && window.indexedDB && Array.isArray(v)) {
      const byBook = {};
      for (const r of v) { const b = r && r.bookId; if (!b) continue; (byBook[b] = byBook[b] || []).push(r); }
      for (const b in byBook) { try { await BF.store.ugcSet(k, b, byBook[b]); } catch (e) { BF.err.report('ugcToIdb.mirror:' + k + ':' + b, e); } }
    }
  } catch (e) { BF.err.report('store.ugcToIdb.mirror', e); }
};
BF.store.setCritical = function (k, v, label) {
  BF.store.wstats.bump(k, 'tries');
  const ok = BF.store.lsSet(k, v);
  if (ok && BF.store.isUGCKey && BF.store.isUGCKey(k)) {
    try { BF.store.__ugcToIdb(k, v).catch(function (e) { BF.err.report('ugcToIdb:' + k, e); }); } catch (e) {}
  }
  /* 记账与腾退分开：失败计数对任何写失败都记（非配额异常也要能在「写入健康」里看见），
     腾退阶梯只在配额型失败时才走。 */
  if (!ok) BF.store.wstats.bump(k, 'fails');
  if (!ok && BF.store.__evictBusy) {
    /* 腾退重试内部的再次失败：不再触发腾退/吐司，只记账（防死循环；调用方仍拿到 false） */
    return false;
  }
  if (!ok && BF.store.__lastSetQuota === true) {
    /* 阶梯腾退（同步档②→⑤）：每腾一档立刻重试本键。
       只有配额型失败才进这里 —— 腾退的代价是真删可重建数据，
       非配额异常（序列化、SecurityError）腾退了也存不进去，白删。
       成功 → 提示写明腾了什么（诚实口径：这是「腾退救回」，不是「没出事」）；
       失败 → 走原有报错路径，并挂一档异步兜底（清朗读音频缓存后补存）。 */
    BF.store.__evictBusy = true;
    let _ev = null;
    try {
      _ev = BF.store.evictLadderSync(function () { return BF.store.lsSet(k, v) === true; }, k);
    } finally { BF.store.__evictBusy = false; }
    if (_ev && _ev.ok) {
      /* 计数已在 evictLadderSync 内按 wkey 记过（evicted），这里不再重复 */
      delete _setCriticalFail[k];
      if (BF.topStatus && BF.topStatus.setSaveFail) { try { BF.topStatus.setSaveFail(false); } catch (e) {} }
      try { BF.noti.warn('存储空间不足：已腾退「' + _ev.evicted.join('」「') + '」后保存成功（' + (label || k) + '）'); } catch (e) {}
      /* 腾出来的空间要立即镜像 UGC 副本，与正常成功路径一致 */
      if (BF.store.isUGCKey && BF.store.isUGCKey(k)) {
        try { BF.store.__ugcToIdb(k, v).catch(function (e) { BF.err.report('ugcToIdb:' + k, e); }); } catch (e) {}
      }
      return true;
    }
    /* 异步兜底：完整阶梯（含①朗读音频缓存）再试一次，成功则补齐成功侧记账
       （顶栏熄灯、UGC 镜像）并补一条「补存成功」。
       tryFn 直接走 lsSet 而非 setCritical —— 后者失败会再次入队腾退，形成循环。
       排队串行，避免并发失败各跑一份阶梯。 */
    (function (kk, vv, ll, rk) {
      BF.store.__evictChain = BF.store.__evictChain.then(function () {
        /* 入队后同一键可能已有新写入成功：用 rev 比对，避免把「入队那一刻的旧整表」盖回去
           —— 否则删掉的书复活、新加的书消失，还弹一条「补存成功」。
           rev 变了说明键已被更新，直接放弃补存、只记日志。 */
        if (rk !== BF.store.rev(kk)) { BF.store.wstats.bump(kk, 'stale'); return null; }
        BF.store.wstats.bump(kk, 'tries');
        return BF.store.evictLadder(function () { return BF.store.lsSet(kk, vv) === true; }, kk);
      }).then(function (r) {
        if (r && r.ok) {
          delete _setCriticalFail[kk];
          if (BF.topStatus && BF.topStatus.setSaveFail) { try { BF.topStatus.setSaveFail(false); } catch (e2) {} }
          if (BF.store.isUGCKey && BF.store.isUGCKey(kk)) {
            try { BF.store.__ugcToIdb(kk, vv).catch(function (e3) { BF.err.report('ugcToIdb:' + kk, e3); }); } catch (e4) {}
          }
          try { BF.noti.success('刚才没存进去的「' + (ll || kk) + '」已腾退补存成功（腾退了「' + r.evicted.join('」「') + '」）'); } catch (e5) {}
        } else {
          BF.store.wstats.bump(kk, 'fails');
        }
      }).catch(function () {});
    })(k, v, label, BF.store.rev(k));
  }
  if (!ok && BF.store.__lastSetQuota === true && !BF.store.__quotaNotified) {
    /* 这条旗标只管「配额满了」这一种失败：一次会话里同一种失败只出声一回，
       写盘成功后由下面的 ok 分支复位。
       非配额型失败不在这里再补一条 —— lsSet 的 BF.err.report 已经出声并指到运维台，
       两处一起报就是「内部异常已记录 + 没能写进本机存储」两条说同一件事的吐司。 */
    BF.store.__quotaNotified = true;
    BF.feedback.error('存储空间不足，' + (label || k) + ' 未能保存', {
      next: { label: '清理数据', run: function () { try { if (BF.workbench && BF.workbench.open) BF.workbench.open('data'); else if (BF.diag && BF.diag.open) BF.diag.open(); } catch (e) {} } },
      detail: '请清理标注/备份或导出备份后重试',
    });
  } else if (!ok && BF.store.__lastSetQuota !== true) {
    BF.log && BF.log.warn('「' + (label || k) + '」未能写入本机存储（原因不是空间不足，详情见运维台）');
  }
  /* 关键数据写盘 → 顶栏保存失败状态按账本结算 */
  if (ok) {
    BF.store.__quotaNotified = false;   /* 写盘成功后复位配额提示旗标，下次真满再提示 */
    delete _setCriticalFail[k];
    if (!Object.keys(_setCriticalFail).length && BF.topStatus && BF.topStatus.setSaveFail) {
      try { BF.topStatus.setSaveFail(false); } catch (e) {}
    }
  } else {
    _setCriticalFail[k] = true;
    if (BF.topStatus && BF.topStatus.setSaveFail) {
      try { BF.topStatus.setSaveFail(true); } catch (e) {}
    }
  }
  return ok;
};

