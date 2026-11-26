/* ===== 读改写原子化：消除 books_meta 等键的「读→改→写」竞争 =====
   背景：全书多处 `const arr = lsGet(K); arr.push(x); lsSet(K, arr)`，
   同标签内并发（双击导入 / 快速批量操作）或跨标签同时写会把彼此的改动覆盖。
   这里给每键维护一个队列，读改写以「取最新值 → 回调 → 写回」串行执行；
   回调返回 false 表示放弃写回（如去重命中）。 */
(function () {
  const _queue = {};        /* key -> Promise 链尾 */
  /* 原始串读取：只比「有没有人动过这张表」，不解析，代价是一次 localStorage 取值 */
  function _rawOf(k) {
    try { return localStorage.getItem(BF.store.PREFIX + k); } catch (e) { return null; }
  }
  /* 按 id 的三方合并：base=开始读时的那份，live=对端此刻的那份，mine=这次算出的新份。
     没动过的行 → 采纳 live；动过的行 → 用 mine（后写者胜）；
     live 里新增而行在 base 里没有 → 保留（那是对端新建的书）；
     本次删掉的 → 就是删掉（删除是有意的动作，不被对端复活）。 */
  function _mergeMetaById(base, live, mine) {
    const key = function (x) { return x && x.id; };
    const baseById = new Map(), liveById = new Map();
    (base || []).forEach(function (x) { const id = key(x); if (id) baseById.set(id, x); });
    (live || []).forEach(function (x) { const id = key(x); if (id) liveById.set(id, x); });
    const eq = function (a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } };
    const mineIds = new Set();
    const out = [];
    (mine || []).forEach(function (x) {
      const id = key(x);
      if (id) mineIds.add(id);
      const theirLive = id ? liveById.get(id) : null;
      const ourBase = id ? baseById.get(id) : null;
      if (theirLive && ourBase && !eq(theirLive, ourBase) && eq(x, ourBase)) { out.push(theirLive); return; }
      out.push(x);
    });
    (live || []).forEach(function (x) { const id = key(x); if (id && !mineIds.has(id) && !baseById.has(id)) out.push(x); });
    return out;
  }
  /* label 为可选第三参：写入失败时的用户可见键名（如「阅读进度」），
     缺省退回键名本身 —— 与既有 15 处调用点行为一致。 */
  function mutate(k, fn, label) {
    const prev = _queue[k] || Promise.resolve();
    /* 入队时记 rev：用原始串快照做「数据有没有被改过」的判据。
       同 key 的多个 mutate 排队时，后面的若发现盘上已变（被前面的或并发的改过），
       就放弃执行只记日志 —— 否则读-改-写的窗口会把并发写覆盖掉。 */
    const _revAtQueue = _rawOf(k);
    const next = prev.then(function () {
      /* 执行前比对：变了就放弃，不谎报成功 */
      /* 执行前比对。注意：同键两个 mutate 排队时，第二个看到的「变」是第一个
         的正常串行写，不是竞态——旧实现在这里 return false，会静默丢掉第二个
         mutate（真机 CDP 实测：同 tick 连点两次标注丢一次）。而下一行
         `cur = lsGet(k)` 本来就是现读最新值，串行语义天然成立，直接继续即可。
         跨标签/非队列写入的真竞态由 books_meta 的 _guard 三方合并兜底；
         其余键若发生外部并发写，回调按最新盘面执行是比「丢弃」更可接受的语义。 */
      if (_rawOf(k) !== _revAtQueue) {
        try { BF.log && BF.log.debug && BF.log.debug('store.mutate.stale: ' + k + ' rev changed during queue, 以最新盘面继续'); } catch (e0) {}
      }
      const cur = BF.store.lsGet(k, null);
      /* books_meta 是「整本书列表一次写回」的表：读与写之间别的标签插进来，
         后写的整表会盖掉先写的记录（A 改了书名、B 改了阅读进度 → 书名被还原）。
         这里在写前再读一次原始串：没变 → 照常写；变了 → 按 id 三方合并。
         只对这张表开启，别的键不付这份重复读的成本；
         同一条记录两边都改过时后写者胜（字段级合并在没有版本戳的前提下做不到）。 */
      const _guard = k === BF.store.K.BOOKS_META;
      const _rawSeen = _guard ? _rawOf(k) : null;
      const r = fn(cur);
      if (r === false) return false;              /* 回调显式放弃写回 */
      if (r === undefined) return true;           /* 回调未返回新值 → 视为只读探测，不写 */
      let out = r;
      if (_guard && Array.isArray(r)) {
        /* 只有原始串变了才付合并的代价；基准直接从「读到的那份原始串」重新解析 ——
           回调拿到的是 cur 本体（多数调用点原地改），事后已经拿不到干净的基准。 */
        const _rawNow = _rawOf(k);
        if (_rawNow !== _rawSeen) {
          let base = null, live = null;
          try { base = _rawSeen ? JSON.parse(_rawSeen) : []; live = BF.store.lsGet(k, null); } catch (e) { base = null; }
          if (Array.isArray(base) && Array.isArray(live)) out = _mergeMetaById(base, live, r);
        }
      }
      /* 写后校验（只对 books_meta）：从合并到落盘之间还有一段窄窗，别的标签可能又写了
         一次——我们的整表会把那一次盖掉。读回若与自写不一致，就按「同一份基准 + 最新
         在盘 + 我们的结果」再合并一次并重写，最多补一次（每次都是整表比较与整表写，
         不无限重试）。真正消除窗口要版本戳/CAS，那是判定不可动的邻域。 */
      if (_guard && Array.isArray(out)) {
        let _wroteOut = null;   /* 循环里最后一次成功落盘的那份（引用） */
        try {
          for (let _try = 0; _try < 2; _try++) {
            const _want = JSON.stringify(out);
            if (_rawOf(k) === _want) break;
            let live2 = null;
            try { live2 = BF.store.lsGet(k, null); } catch (e) { live2 = null; }
            if (!Array.isArray(live2)) break;
            let base2 = [];
            try { base2 = _rawSeen ? JSON.parse(_rawSeen) : []; } catch (e) { base2 = []; }
            if (!Array.isArray(base2)) break;
            const merged2 = _mergeMetaById(base2, live2, out);
            if (JSON.stringify(merged2) === _want) break;
            out = merged2;
            _wroteOut = BF.store.setCritical(k, out, label || k) === true ? out : null;
          }
        } catch (e) { BF.err.report('store.mutate.recheck', e); }
        /* 循环里已经写下最后这一份，就别在外层再写一次整表：
           重复写会双 bump rev 并再跑一遍 UGC 镜像。 */
        if (_wroteOut === out) return true;
      }
      return !!BF.store.setCritical(k, out, label || k);   /* 写没写进去只看真假值：true 才算成功 */
    }).catch(function (e) {
      BF.err.report('store.mutate:' + k, e);
      return false;
    });
    /* 链尾保持可继续 then，避免 unhandled rejection */
    const _tail = next.catch(function () {});
    _queue[k] = _tail;
    /* 这条链跑完且后面没有新任务排队时摘掉：不留下每个历史键名的常驻 Promise 链 */
    _tail.then(function () { if (_queue[k] === _tail) delete _queue[k]; });
    return next;
  }
  BF.store.mutate = mutate;
  /* ===== 标注键的读-改-写保护（通用范式）=====
     源自 BF.reader.addNote 划线键的实现（「写后二次校验 + 检出并发
     就合并重写，有界重试」）。本地Storage 的互斥粒度是**单次操作**，
     读与写之间可被另一标签页的写入插入，没有跨页 CAS 指令 —— 读-改-写
     之间**永远留一条缝**，靠「读得更勤」补不上；把重试次数调大也只是把
     窗口推后，不能消除。
     本 helper 的判据一律用 keyOf(rec) 而不是 rec.id：书签/生词的数据格式
     没有 id 字段，且同一本书同一章同一位置**可以合法地存在多条**书签
     （addBookmark 无去重守卫，renderBookmarks 逐条渲染、逐条可删），
     用 bookId|chapterIdx|charOffset 当唯一标识会把它们误判成重复而合并掉。
     故调用方必须保证 keyOf 对**每条记录唯一**（接入点在写入时
     分配 BF.hlc 生成的 bm_/vc_ 前缀 id，keyOf 取该 id）。 */
  BF.store.__mergeMax = 4;
  /* 通用合并写：以 keyOf 唯一标识一条记录，写前合并、写后校验、有界重试。
     返回 {ok, merged, ext, label}：ok=落盘成功；merged=重试次数；
     ext=当次需提示的「他页条目数」。重试用尽时以最后一版落盘并如实
     返回 ext —— 不无限循环、也不谎报。 */
  BF.store.mergeWrite = function (k, rec, keyOf, label) {
    const max = BF.store.__mergeMax;
    let attempts = 0;
    const seen = new Set();
    const myKey = keyOf(rec);
    let _lastOk = true;
    const commit = function () {
      const latest = BF.store.lsGet(k, []) || [];
      latest.forEach(function (x) { const kk = keyOf(x); if (kk != null) seen.add(kk); });
      seen.add(myKey);
      /* 同 key 视为同一条（重划覆盖），其余原样保留 —— 本页既有的
         其它条目、以及并发进来的他页条目都不丢。 */
      const merged = latest.filter(function (x) { return keyOf(x) !== myKey; });
      merged.push(rec);
      _lastOk = BF.store.setCritical(k, merged, label);   /* 透传真实写入结果 */
    };
    commit();
    while (attempts < max) {
      const after = BF.store.lsGet(k, []) || [];
      let foreign = 0;
      after.forEach(function (x) { const kk = keyOf(x); if (kk != null && kk !== myKey && !seen.has(kk)) foreign++; });
      if (!foreign) break;
      attempts++;
      commit();   /* 把 foreign 并进去重写；commit 内会把它们记入 seen */
    }
    const after = BF.store.lsGet(k, []) || [];
    let ext = 0;
    /* ext 只统计"当次并发新增"（相对 seen 差集），不是存储里除本条外
       的全部条目——否则"已有 10 条书签再加 1 条"时 ext=10，会误报"其他标签页添加"。 */
    after.forEach(function (x) { const kk = keyOf(x); if (kk != null && kk !== myKey && !seen.has(kk)) ext++; });
    return { ok: _lastOk, merged: attempts, ext: ext, label: label };   /* 返回真实结果 */
  };
  /* 通用合并删：与 mergeWrite 同内核，按 keyOf 匹配删除而非按 id 覆盖。
     用于「删除某条」在并发下会因数组漂移而删错记录的场景（按下标删除是
     最典型的：另一页先插一条，本页的下标就指向了别人）。
     返回同 mergeWrite。 */
  BF.store.mergeRemove = function (k, id, keyOf, label) {
    const max = BF.store.__mergeMax;
    /* id 直接就是目标条目的 key（调用方已定位到具体记录），不再对它
       套 keyOf —— 套了会把字符串 id 当记录解析，keyOf 返回 undefined
       而「一条都删不掉」。keyOf 只用于识别数组里的其它条目。 */
    const myKey = (typeof id === 'function') ? id() : id;
    let attempts = 0;
    const seen = new Set();
    let _lastOk = true;
    const commit = function () {
      const latest = BF.store.lsGet(k, []) || [];
      latest.forEach(function (x) { const kk = keyOf(x); if (kk != null) seen.add(kk); });
      const kept = latest.filter(function (x) { return keyOf(x) !== myKey; });
      _lastOk = BF.store.setCritical(k, kept, label);   /* 透传真实写入结果 */
    };
    commit();
    while (attempts < max) {
      const after = BF.store.lsGet(k, []) || [];
      /* 删除侧的并发检出：条目数比 seen 记录的还多，说明期间有他页
         新增（删除不涉及「恢复」，只需重放一次删除即可保持一致）。 */
      let unknown = 0;
      after.forEach(function (x) { const kk = keyOf(x); if (kk != null && !seen.has(kk)) unknown++; });
      if (!unknown) break;
      attempts++;
      commit();
    }
    /* 与 mergeWrite 不同：删除侧没有消费者读 ext（两个调用点都不接返回值），
       省掉整表再读一遍的开销。 */
    return { ok: _lastOk, merged: attempts, ext: 0, label: label };   /* 返回真实结果 */
  };
})();

