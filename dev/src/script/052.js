/* ================= L6b. 章节入库（三处导入通道共用） =================
   ① 3000 章的书不得一次性 Promise.all 创建上千个 gzip 流并全部驻留内存
   （低端机易 OOM）；按 BATCH 一批的有界并发 + 分批写库 + 每批让出主线程。
   ② 剪贴板 / URL 导入的 IDB 失败分支不得静默——统一留痕并提示。
   ③ 可靠性三档·第②档：每批独立重试（1 次，400ms 退避）与独立选层
   （IDB → OPFS 分批文件 → LS 逐章），失败批次记录在回执里（可续写：腾退
   阶梯后补写一轮；可撤销：partial 失败的书照常可删）。回执报
   「已存 N 章、失败 M 章」。全批失败仍抛出——调用方的 __lsFallback
   整书兜底与幽灵书防线上移语义不变。 */
BF.library.CH_BATCH = 200;   /* 分批大小；readChapter 的 OPFS 第三读层按同常量取批 */
BF.library.__putChapters = async function (id, chapters, onProgress) {
  /* BATCH=200 控制批次数量；每批压缩后立即落库并让出（防整书压缩记录全量驻留内存）；
     大文本单章 >128KB 时该章自身走 Worker 压缩（BF.lz 已处理） */
  const BATCH = BF.library.CH_BATCH;
  /* 批内压缩并发上限：一次事务落 200 章，但压缩不许 200 路齐跑——
     每章原文与压缩中间缓冲同时在场，峰值内存就是 200×章大小。 */
  const COMPRESS_LIMIT = 6;
  async function compressPool(slice, offset) {
    const out = new Array(slice.length);
    let next = 0;
    async function worker() {
      while (next < slice.length) {
        const k = next++;
        const c = slice[k];
        out[k] = {
          id: id + '_' + (offset + k), bookId: id, idx: offset + k, title: c.title,
          /* 章节记录带 sid（稳定章节 ID，重新分章后据此找回）。
             旧数据没有该字段，用 || '' 兜底 —— 缺 sid 只是失去「重分章后
             找回」的能力，不会让章节读不出来。 */
          sid: (c && c.sid) || '',
          content: await BF.lz.compress(c.content),
        };
      }
    }
    const ws = [];
    for (let w = 0; w < Math.min(COMPRESS_LIMIT, slice.length); w++) ws.push(worker());
    await Promise.all(ws);
    return out;
  }
  function _sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  /* 单批三层选层。返回 'idb' | 'opfs' | 'ls' | null（三层皆败）。
     层语义：IDB 是主读取路径；OPFS 分批文件（books/<id>/parts/b<批号>.json）
     存压缩记录，由 readChapter/getChapterText 的第三读层解压；
     LS 逐章键（chap_<id>_<idx>）存**原始正文**——与 __lsFallback 及两条读路的
     LS 兜底约定一致（LS 值就是可显示的文本，读路不再解压）。 */
  async function putBatchLayers(offset, part, rawSlice) {
    /* P4.5：底层写读 allocOf('chapters') 选介质。'ls' 且尺寸装得下 → LS 层提到首选；
       其余（auto/idb/opfs）保持既有 IDB→OPFS→LS 顺序，读路兼容不变。 */
    const _pref = (typeof BF.store.allocOf === 'function') ? BF.store.allocOf('chapters') : 'auto';
    function _tryLs() {
      try {
        let lsAll = true;
        for (let k = 0; k < part.length; k++) {
          BF.store.wstats.bump('ls:chapters', 'tries');
          const _raw = rawSlice && rawSlice[k] && rawSlice[k].content != null ? rawSlice[k].content : '';
          if (BF.store.lsSet('chap_' + id + '_' + (offset + k), _raw) !== true) { BF.store.wstats.bump('ls:chapters', 'fails'); lsAll = false; }
        }
        return lsAll ? 'ls' : null;
      } catch (e) { BF.err.report('putChapters.ls:' + id + ':' + offset, e); return null; }
    }
    if (_pref === 'ls') { const r = _tryLs(); if (r) return r; }
    /* 层1：IDB + 1 次重试（短退避，扛瞬时事务冲突/IO 抖动） */
    for (let a = 0; a < 2; a++) {
      BF.store.wstats.bump('idb:' + BF.store.K.CHAPTERS, 'tries');
      try {
        await BF.store.idbPutAll(BF.store.K.CHAPTERS, part);
        return 'idb';
      } catch (e) {
        BF.store.wstats.bump('idb:' + BF.store.K.CHAPTERS, 'fails');
        BF.err.report('putChapters.idb:' + id + ':' + offset, e);
        if (!a) await _sleep(400);
      }
    }
    /* 层2：OPFS 分批文件（fsync 不可用时直接落空） */
    if (BF.fsync && BF.fsync.available) {
      BF.store.wstats.bump('opfs:chapters', 'tries');
      try {
        await BF.fsync.writeFile('books/' + id + '/parts/b' + Math.floor(offset / BATCH) + '.json', JSON.stringify(part));
        return 'opfs';
      } catch (e) {
        BF.store.wstats.bump('opfs:chapters', 'fails');
        BF.err.report('putChapters.opfs:' + id + ':' + offset, e);
      }
    }
    /* 层3：LS 逐章（readChapter 的既有兜底键，存原始正文）。全部成功才算该批落地。
       P4.5：复用上面的 _tryLs（_pref==='ls' 时它已是首选层，这里再试一次作兜底）。 */
    const _ls = _tryLs();
    if (_ls) return _ls;
    return null;
  }
  const total = chapters.length;
  const written = [];           /* IDB 已落地的记录键（全批失败回滚用，语义与旧版一致） */
  const writtenLs = [];         /* LS 层落地的章节 idx（全批失败时一并回滚） */
  const failedBatches = [];     /* 三层皆败的批：[{offset, part}]，腾退后补写一轮 */
  const failedRanges = [];      /* 对外回执：失败章节 idx 区间 */
  let evictedNames = [];
  const receipt = { written: 0, failed: 0, failedRanges: failedRanges, layers: { idb: 0, opfs: 0, ls: 0 }, evicted: evictedNames, titles: false };
  try {
    for (let i = 0; i < total; i += BATCH) {
      const slice = chapters.slice(i, i + BATCH);
      const part = await compressPool(slice, i);
      const layer = await putBatchLayers(i, part, slice);
      if (layer === 'idb') {
        /* 登记已落库的章节 id，写入失败时可精确回滚，避免孤儿章节残留 */
        for (const rec of part) written.push(rec.id);
        receipt.layers.idb++;
      } else if (layer === 'opfs') {
        receipt.layers.opfs++;
      } else if (layer === 'ls') {
        for (let k = 0; k < part.length; k++) writtenLs.push(i + k);
        receipt.layers.ls++;
      } else {
        failedBatches.push({ offset: i, part: part, raw: slice });
      }
      if (onProgress) try { onProgress(Math.min(i + BATCH, total), total); } catch (e) {}
      /* 每批让出宏任务：保持 UI 响应，且批次内内存随 slice 出作用域回收 */
      if (i + BATCH < total) await new Promise(function (r) { setTimeout(r, 0); });
    }
    /* 失败批次可续写：先走腾退阶梯（完整版，含朗读音频缓存）腾出空间，
       再补写一轮；补写也失败才如实计入回执。
       阶梯的 tryFn 是「真写第一批失败批次」——每腾一档试写一次，写得进去
       就停手，不为续写空烧整座阶梯。 */
    if (failedBatches.length) {
      const _probe = failedBatches[0];
      const _r = await (async function () {
        try {
          return await BF.store.evictLadder(function () {
            return putBatchLayers(_probe.offset, _probe.part, _probe.raw).then(function (layer) {
              if (!layer) return false;
              if (layer === 'idb') { for (const rec of _probe.part) written.push(rec.id); receipt.layers.idb++; }
              else if (layer === 'opfs') receipt.layers.opfs++;
              else { for (let k = 0; k < _probe.part.length; k++) writtenLs.push(_probe.offset + k); receipt.layers.ls++; }
              const _pi = failedBatches.indexOf(_probe);
              if (_pi >= 0) failedBatches.splice(_pi, 1);
              return true;
            });
          }, 'chapters.continue');
        } catch (e) { return { ok: false, evicted: [] }; }
      })();
      if (_r && _r.evicted && _r.evicted.length) { for (const nm of _r.evicted) if (evictedNames.indexOf(nm) < 0) evictedNames.push(nm); }
      const still = [];
      for (const fb of failedBatches) {
        const layer2 = await putBatchLayers(fb.offset, fb.part, fb.raw);
        if (layer2 === 'idb') { for (const rec of fb.part) written.push(rec.id); receipt.layers.idb++; }
        else if (layer2 === 'opfs') receipt.layers.opfs++;
        else if (layer2 === 'ls') { for (let k = 0; k < fb.part.length; k++) writtenLs.push(fb.offset + k); receipt.layers.ls++; }
        else still.push(fb);
      }
      failedBatches.length = 0; still.forEach(function (fb) { failedBatches.push(fb); });
    }
    for (const fb of failedBatches) failedRanges.push({ from: fb.offset, to: fb.offset + fb.part.length - 1 });
    receipt.written = total - failedRanges.reduce(function (s, r) { return s + (r.to - r.from + 1); }, 0);
    receipt.failed = total - receipt.written;
    /* 全批失败 → 维持旧契约：回滚（三层都无残留可清，走一遍保底删除）后抛出，
       调用方的 __lsFallback 整书兜底 / 幽灵书防线照旧接管。 */
    if (total > 0 && receipt.written === 0) {
      throw new Error('章节正文全部写入失败（IDB/OPFS/LS 三层皆败）');
    }
    /* titles 表按 [{title, sid}] 写入。
       旧数据是纯字符串数组，**必须仍能读** —— 由 getChapterTitles 归一化
       承担（见该函数），本函数不做向下兼容，避免两处各写一套判断。
       titles 失败维持旧语义：回滚 + 抛出（没有目录的书不能上架）。 */
    try {
      await BF.store.idbPutAll(BF.store.K.CHAPTER_TITLES, [{ id: id, bookId: id, titles: chapters.map(c => ({ title: c.title, sid: (c && c.sid) || '' })) }]);
      receipt.titles = true;
    } catch (eT) {
      BF.err.report('putChapters.titles:' + id, eT);
      throw eT;
    }
    written.push('titles:' + id);
    /* 新拓扑：整本正文源落 OPFS books/<id>/body.txt（IDB 降级），供重分章/导出免重新导入；
       LS 仍不承载正文；失败静默，正文读取仍走 IDB chapters，不受影响。 */
    try { BF.store.saveBody(id, chapters.map(function (c) { return c && c.content != null ? c.content : ''; }).join('\n')).catch(function (e) { BF.err.report('lz.saveBody', e); }); } catch (e) { BF.err.report('lz.saveBody', e); }
    return receipt;
  } catch (e) {
    /* 正文入库中途失败 → 回滚已写入的章节，防止 importFile 的 LS 兜底也失败时留下半本书的孤儿数据 */
    for (const recId of written) {
      try {
        if (recId.indexOf('titles:') === 0) await BF.store.idbDelete(BF.store.K.CHAPTER_TITLES, recId.slice(7));
        else await BF.store.idbDelete(BF.store.K.CHAPTERS, recId);
      } catch (e2) { BF.err.report('import.rollback.idb', e2); }
    }
    for (const idx of writtenLs) { try { BF.store.lsRemove('chap_' + id + '_' + idx); } catch (e3) { BF.err.report('import.rollback.ls', e3); } }
    /* 分批正文失败前可能已落了几批 OPFS 文件：只回滚 IDB/LS 会把它们留成孤儿 */
    try { await BF.library._dropOpfsBook(id); } catch (e4) { BF.log.warn('入库回滚时清理 OPFS 失败：' + (e4 && e4.message)); }
    throw e;
  }
};
/* 统一的 LS 兜底：返回是否全部写成功，便于上层给出真实提示 */
BF.library.__lsFallback = function (id, chapters) {
  let ok = true;
  chapters.forEach(function (c, i) { if (!BF.store.lsSet('chap_' + id + '_' + i, c.content)) ok = false; });
  return ok;
};

