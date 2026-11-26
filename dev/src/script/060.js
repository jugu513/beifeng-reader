/* ===== 搜索的共用骨架（书内 searchAll 与跨书 searchAcrossBooks 同一份实现） =====
   以前两条路各写一遍「批次并发取正文 → 合并串交 Worker → 坐标还原 → 剥分隔符 → 让出主线程」，
   于是每一处修正都要记得改两次（分隔符泄漏那轮就是两处各改一次，跨书侧还长期漏剥）。
   合理的差异全部走参数（每章命中上限、上下文窗口、进度文案、中止与满量判据），
   算法本身只留这一份。放在 BF.library 是因为 reader 依赖 library，反过来会倒置分层。 */

/* 单本书的章批次并发骨架：一批 BATCH 章一起取正文，批间让出主线程。
   aborted() 为真即中止并返回 'aborted'；full() 为真表示命中已够，返回 'full'。
   onBatch(idxs, texts, doneCount) 可为 async。守卫与 reject 语义留在调用方。
   交给 onBatch 的 texts 已归一到「段落空间」：与 BF.reader.state.paras 同一次派生
   （剔空行 + 去重复标题行）再并回串。章原文里的偏移含空行与标题行，跳转吃的却是
   段落空间偏移（Σ(段长+1)），两个空间相差一个标题行的长度，命中会整条链路偏移一段。 */
BF.library.eachChapterBatch = async function (b, total, BATCH, onBatch, aborted, full) {
  for (let i = 0; i < total; i += BATCH) {
    if (aborted()) return 'aborted';
    const idxs = [];
    for (let k = i; k < Math.min(total, i + BATCH); k++) idxs.push(k);
    const raw = await Promise.all(idxs.map(function (n) { return BF.library.getChapterText(b, n); }));
    if (aborted()) return 'aborted';
    const texts = raw.map(function (t, k) {
      return BF.reader.toParas(t, BF.reader.chapterTitle(b, idxs[k])).join('\n');
    });
    await onBatch(idxs, texts, Math.min(total, i + BATCH));
    if (full()) return 'full';
    await new Promise(function (r) { setTimeout(r, 0); });
  }
  return 'done';
};
/* 一批章节正文交给 Worker：返回 [{idx, ctx, pos}]。
   合并串布局 = 段0 + 8 字节分隔符 + 段1 + …；base 只累加段内容长度，分隔符不计入任何段，
   落在分隔符区间的坐标（边界命中）丢弃，避免章节串台；ctx 落盘/展示前剥掉 @@CH@@。 */
BF.library.searchBatchInWorker = async function (idxs, texts, q) {
  const chunk = [];
  texts.forEach(function (t, k) { if (t) chunk.push({ idx: idxs[k], text: t }); });
  if (!chunk.length) return [];
  const hits = await BF.workerPool.searchAsync(chunk.map(function (c) { return c.text; }).join('\n@@CH@@\n'), q);
  if (!hits || !hits.length) return [];
  const parts = BF.cfi.buildMergedParts(chunk, 8);
  const out = [];
  for (const h of hits) {
    const rc = BF.cfi.restoreMergedCoord(h.pos, parts);
    if (rc) out.push({ idx: rc.idx, ctx: BF.dom.cleanSearchCtx(h.ctx), pos: rc.off });
  }
  return out;
};
/* 主线程逐章 indexOf 兜底：窗口与每章上限是参数（书内 −20/+30，跨书 −18/+26，都是每章 20 条）。 */
/* 搜索大小写/全半角归一。_foldSearch 只做 1:1 折叠（全角 Latin→半角、A-Z→a-z），
   不改变字符串长度，故 indexOf 命中下标可直接用于原串切片，无需长度回映射。 */
BF.library._foldSearch = function (s) {
  if (!s) return '';
  /* 先扫一遍有没有可折叠字符：既没大写字母、又没全角 ASCII/全角空格的文本（中文正文的绝大多数）
     折叠后与原串逐字相同，直接返回原串，省掉整串逐字符重建。
     不用 toLowerCase 代替：它在个别码位（如 U+0130）会变长，破坏下面这条 1:1 映射。 */
  if (!/[A-Z＀-｟　]/.test(s)) return s;
  let r = '';
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c >= 0xFF01 && c <= 0xFF5E) c -= 0xFEE0;        // 全角 ASCII 变体 → 半角
    else if (c === 0x3000) c = 0x20;                    // 全角空格 → 半角空格
    if (c >= 65 && c <= 90) c += 32;                    // A-Z → a-z
    r += String.fromCharCode(c);
  }
  return r;
};
BF.library.scanBatchOnMain = function (idxs, texts, q, capPerChapter, before, after) {
  const hits = [];
  const qn = BF.library._foldSearch(q);
  if (!qn) return hits;
  for (let k = 0; k < texts.length; k++) {
    const t = texts[k];
    /* 缺章的空值防护：undefined 参与 indexOf 会抛，抛在 forEach 的 async 里冒泡出来，
       搜索就永远停在「搜索中…」——没有哪条 catch 会替你收尾。 */
    if (!t) continue;
    const tn = BF.library._foldSearch(t);
    let pos = 0, count = 0;
    while ((pos = tn.indexOf(qn, pos)) !== -1 && count < capPerChapter) {
      const start = Math.max(0, pos - before);
      /* pos 来自归一化串；_foldSearch 是 1:1 映射，下标与原串一致，可直接切原串 t */
      hits.push({ idx: idxs[k], ctx: (start > 0 ? '…' : '') + t.slice(start, pos + q.length + after) + '…', pos: pos });
      pos += qn.length; count++;
    }
  }
  return hits;
};
/* 跨书搜索世代号（防重，见 searchAcrossBooks） */
BF.library._acrossSeq = 0;
BF.library.openAcrossSearch = function () {
  let el = document.getElementById('bf-across-search');
  if (!el) {
    /* 骨架统一由 BF._panel 工厂生成（customHTML
       形态——搜索框与结果区在主体内）；close 按钮
       带 data-panel-close 走文档级委托。 */
    BF._panel('bf-across-search', '跨书搜索', {
      cls: 'dlg-shell', cssText: '--dlg-w:min(720px,94vw)',   /* 跨书搜索：比默认宽 40px */
      html: '<header class="pk-panel__head"><span class="pk-panel__title">跨书搜索</span>' +
        '<div class="pk-panel__actions"><button class="pk-panel__close" data-across-close data-panel-close aria-label="关闭">' + (BF.dom.ICON_CLOSE || '×') + '</button></div></header>' +
        '<div class="pk-panel__body" style="display:flex;flex-direction:column;gap:8px;min-height:0">' +
        '<div style="display:flex;gap:6px"><input class="input" id="across-q" placeholder="在所有书籍正文中搜索..." style="flex:1"/><button class="btn btn-sm" data-across-go>搜索</button></div>' +
        '<div id="across-results" style="font-size:12px;color:var(--text-weak);padding:4px 0;overflow-y:auto;flex:1;min-height:0"></div></div>',
    });
    el = document.getElementById('bf-across-search');
    el.querySelector('[data-across-go]').addEventListener('click', function () { doAcross(); });
    const qi = el.querySelector('#across-q');
    qi.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); doAcross(); } });
    function doAcross() {
      const q = (qi.value || '').trim();
      if (!q) { BF.noti.warn('请输入搜索词'); return; }
      BF.library.searchAcrossBooks(q).then(function (res) { renderAcross(res, q); });
    }
  }
  BF.sheet.open('bf-across-search', { render: function () {
    const qi = document.getElementById('across-q');
    if (qi) { qi.focus(); qi.select(); }
  } });
};
BF.library.searchAcrossBooks = async function (q) {
  /* 跨书搜索防重（世代号，与书内 searchAll 的 _gen 同款）。
     连续触发多次搜索时，旧搜索在批间检查被取代即中止返回，避免并发任务堆积。 */
  const mySeq = ++BF.library._acrossSeq;
  const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || [];
  const out = [];   /* { bookId, title, idx, ctx, pos } */
  const box = document.getElementById('across-results');
  const BATCH = 4;   /* 书级并发：每批 4 本 */
  const capPerBook = 30;   /* 每本书命中上限，防止单本刷屏 */
  /* 跨书搜索挂进 BF.jobs —— 长任务顶栏可见（BF.tasks），可取消（若各书循环有空档）。 */
  let jobId = 0;
  try {
    if (BF.jobs && BF.jobs.begin) jobId = BF.jobs.begin('跨书搜索「' + String(q).slice(0, 20) + '」', { kind: 'io', detail: '准备…' });
  } catch (e) {}
  let scanned = 0;
  const totalBooks = books.length;
  try {
  for (let i = 0; i < books.length; i += BATCH) {
    if (mySeq !== BF.library._acrossSeq) { out.length = 0; return out; }   /* 被新搜索取代：中止 */
    const chunk = books.slice(i, i + BATCH);
    const results = await Promise.all(chunk.map(function (b) {
      if (!b) return { b: b, hits: [] };
      /* 复用 reader 的 searchAll？它绑定当前打开的书。这里独立实现：
         单本书内部复用 Worker searchAsync（与书内 searchAll 同款「章合并串检索 + 坐标还原」），
         大书（>80 章）检索不占主线程；Worker 不可用/失败自动回退主线程 indexOf。 */
      return (async function () {
        const hits = [];
        const total = b.totalChapters || 0;
        const useW = total > 80 && BF.workerPool && BF.workerPool.available() && typeof BF.workerPool.searchAsync === 'function';
        let _workerOk = false;
        if (useW) {
          /* Worker 路径：批次骨架与坐标还原一律复用「书内搜索」那一份（见 BF.library.eachChapterBatch /
             searchBatchInWorker）。若在这里另写一遍 for + Promise.all + buildMergedParts，
             两份就会各自演化——@@CH@@ 标记只在一处被剥掉，跨书结果里就会带出脏标记。 */
          const CH_BATCH = 6;
          try {
            await BF.library.eachChapterBatch(b, total, CH_BATCH, async function (idxs, texts) {
              const hs = await BF.library.searchBatchInWorker(idxs, texts, q);
              for (let n = 0; n < hs.length && hits.length < capPerBook; n++) hits.push(hs[n]);
            }, function () { return mySeq !== BF.library._acrossSeq; }, function () { return hits.length >= capPerBook; });
            _workerOk = true;
          } catch (e) {
            BF.err.report('across.worker', e);
            hits.length = 0;   /* 回退主线程：清空 Worker 半成品 */
          }
          if (hits.length) return { b: b, hits: hits };
          /* Worker 正常扫完、确实无命中：直接返回空。只有 Worker 抛错才落到主线程——
             跨书搜索多半是无命中，无脑重扫等于常态翻倍。 */
          if (_workerOk) return { b: b, hits: [] };
        }
        /* 主线程兜底：批次骨架与逐章扫描也走同一份（上下文窗口仍是跨书的 −18/+26）。
           按批走而不是逐章串行 await：千章级的书会被拖成分钟级，而且一批之间不让出主线程。 */
        await BF.library.eachChapterBatch(b, total, 6, async function (idxs, texts) {
          const hs = BF.library.scanBatchOnMain(idxs, texts, q, 20, 18, 26);
          for (let n = 0; n < hs.length && hits.length < capPerBook; n++) hits.push(hs[n]);
        }, function () { return mySeq !== BF.library._acrossSeq; }, function () { return hits.length >= capPerBook; });
        return { b: b, hits: hits };
      })();
    }));
    /* 批内 await 完成后必须再次检查世代号——首批期间新搜索可能已发起，
       批前检查拦不住（发起时序在批内），批后检查确保旧搜索不把半截结果混入。 */
    if (mySeq !== BF.library._acrossSeq) { out.length = 0; return out; }
    results.forEach(function (r) {
      if (r && r.hits && r.hits.length) {
        r.hits.forEach(function (h) {
          out.push({ bookId: r.b.id, title: r.b.title, idx: h.idx, ctx: h.ctx, pos: h.pos });
        });
      }
    });
    scanned = Math.min(totalBooks, i + BATCH);
    if (box) box.textContent = '搜索中…（已扫 ' + scanned + '/' + totalBooks + ' 本）';
    /* 进度挂 BF.jobs（BF.tasks 面板可见「跨书搜索」实时进度） */
    try { if (jobId && BF.jobs.setDetail) BF.jobs.setDetail(jobId, '已扫 ' + scanned + '/' + totalBooks + ' 本'); } catch (e) {}
    await new Promise(function (r2) { setTimeout(r2, 0); });
  }
  } finally {
    try { if (jobId && BF.jobs.end) BF.jobs.end(jobId); } catch (e) {}
  }
  return out;
};
function renderAcross(res, q) {
  const box = document.getElementById('across-results');
  if (!box) return;
  /* D5 三态组件：空结果走统一组件。
     行为测试以 stub 环境单独 eval 本函数
     （global.BF 只注入 dom），BF.ui 未注入
     时回落内联 HTML —— 生产环境 BF.ui 在
     浮层栈之后定义（先于任何调用点执行），
     恒可用。 */
  if (!res.length) {
    box.innerHTML = (BF.ui && typeof BF.ui.blank === 'function')
      ? BF.ui.blank({ icon: BF.dom.ic('find'), msg: '未找到「' + BF.dom.esc(q) + '」', hint: '试试更短的关键词；书架的「搜正文」可跨书搜索' })
      : '<div style="padding:10px;color:var(--text-weak)">未找到「' + BF.dom.esc(q) + '」</div>';
    return;
  }
  /* 按书分组 */
  const groups = {};
  res.forEach(function (r) {
    (groups[r.bookId] = groups[r.bookId] || { title: r.title, hits: [] }).hits.push(r);
  });
  let html = '';
  Object.keys(groups).forEach(function (bid) {
    const g = groups[bid];
    html += '<div style="margin:6px 0 4px"><b style="color:var(--accent-ink)">《' + BF.dom.esc(g.title) + '》</b> <span style="font-size:11px;color:var(--text-weak)">' + g.hits.length + ' 处</span></div>';
    html += g.hits.slice(0, 15).map(function (h) {
      return '<div class="drawer-item" data-across-goto="' + BF.dom.escAttr(h.bookId) + '" data-across-ch="' + h.idx + '"' + (typeof h.pos === 'number' ? ' data-across-pos="' + h.pos + '"' : '') + ' data-across-q="' + BF.dom.escAttr(q) + '" style="padding:5px 8px;border-radius:var(--r-sm);cursor:pointer;font-size:12px;color:var(--text-dim);border-bottom:1px solid var(--border)">' +
        '<b style="color:var(--text-weak)">第' + (h.idx + 1) + '章</b> ' + BF.reader.searchExcerpt(h.ctx, q) + '</div>';
    }).join('');
    if (g.hits.length > 15) html += '<div style="font-size:11px;color:var(--text-weak);padding:2px 8px">… 其余 ' + (g.hits.length - 15) + ' 处略</div>';
  });
  box.innerHTML = '<div style="font-size:11px;color:var(--text-weak);margin-bottom:4px">共 ' + res.length + ' 处命中（' + Object.keys(groups).length + ' 本书）</div>' + html;
}

