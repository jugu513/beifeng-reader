/* ================= BF.smart 章节 / AI 路由层 =================
   把分散的「分章路由 / AI-或-本地回退 / 导入增强」收敛成统一入口：
   - chapters(text)：分章统一入口（未来可在此切换主线程/Worker/AI 策略）
   - aiOr(aiFn, localFn)：有 key 才花配额走 AI，否则（或 AI 抛错时）回退本地结果。async。
   - importEnrich(bookId)：导入后 AI 摘要 + 标签，写回 book meta */
BF.smart = (function () {
  /* 分章统一入口：大文件(>512KB)自动切 Worker 线程池离线计算，避免卡 UI；
     其余同步（零开销），Worker 失败回退主线程。importFile 统一调这里，只有这一个入口。 */
  async function chapters(text) {
    var opts = {
      strategy: BF.settings.get('chapterStrategy') || 'smart',
      chapterRegex: BF.settings.get('chapterRegex') || '',
      chapterWordCount: BF.settings.get('chapterWordCount') || BF.settings.DEFAULTS.chapterWordCount,
      autoDetectTitle: BF.settings.get('autoDetectTitle') !== false,
      mergeTocBlock: BF.settings.get('mergeTocBlock') !== false,
    };
    /* 派发 Worker 前用同一把静态检测尺预检自定义正则。命中则明示 +
       改传空串，让 Worker 直接用内置规则——否则 Worker 内的回退是静默的
       （_splitBounds 注入 Worker 后不能引用 BF 打印日志），用户无从知晓。 */
    var _crx = (opts.chapterRegex || '').trim();
    if (_crx) {
      var _crxRisk = _regexRisk(_crx);
      if (_crxRisk) { opts.__regexRejected = _crxRisk; opts.chapterRegex = ''; }
    }
    _warnRegexRisk(opts);
    if (String(text).length > 512 * 1024 && BF.workerPool && BF.workerPool.available()) {
      try {
        const _w = await BF.workerPool.splitChaptersAsync(text, opts);
        /* Worker 路径补齐 sid：
           Worker 经 .toString() 复用主线程同一份分章核心（cleanText /
           _splitBounds / _buildChapters，见 _workerSrc），分章结果与主线程一致；
           但 BF.cfi 不在 Worker 作用域，sid 由
           这里在**主线程**回填（不内联第二份 stableSid，避免又一处漂移）。 */
        BF.library.__ensureSid(_w);
        return _w;
      }
      catch (e) { BF.err.report('worker.split', e); }
    }
    return BF.library.splitChapters(text);
  }
  /* aiOr(aiFn, localFn)：有 key 才花配额走 AI，否则（或 AI 失败时）回退本地结果。async。 */
  async function aiOr(aiFn, localFn) {
    if (BF.ai.hasKey()) {
      try { return await aiFn(); }
      catch (e) { BF.err.report('smart.aiOr', e); }
    }
    return localFn ? localFn() : null;
  }
  /* ================= AI 分章：模型只说「在哪儿断」，正文一律本地逐字取 =================
     让模型返回整段正文再由本地写库，丢字、改写、加空格全都无人发现；若只取
     第 0 章（idx 默认 0）、正文还截到 12000，写库用的 __putChapters 只覆盖 0..n-1
     不删尾章 ⇒ 一改就把整本砍成第 1 章的碎片，repairOrphans 也不会清（bookId 仍有效）。

     三种依据，产出的都是同一件东西：bounds（切分偏移数组），交
     BF.library.rebuildBookChapters 落库（它已经会：清旧章、写新章、回写 meta、
     按 sid 应用改名、_boundsIntegral 不闭合就拒绝切）：
       anchors —— [{title, marker}]，marker 是原文里能定位的一段文字
       ranges  —— [{title, start, end}]
       regex   —— 一条切分正则，交给现成 _splitBounds（内含 _regexRisk 回溯防护，
                  模型给的正则与用户自填正则走同一道闸，不新写一套）
     红线：坐标系必须是 cleanText 之后的全书串——原始文件与清洗后不等长（零宽剥离、
     \n{3,} 合并），按原书字数算出来的边界会被判不闭合，整本静默退化成单章。 */
  async function _aiFullText(b) {
    return BF.library.rebuildCleanedText(b);
  }
  /* 锚点 → bounds：marker 从上一个切点往后找（天然单调）；找不到的那个点**跳过**，
     绝不猜位置 —— 宁可少切一章，也不把正文切错。 */
  function _boundsFromAnchors(cleaned, items) {
    const pts = []; let from = 0; const missed = [];
    items.forEach(function (it, k) {
      const mk = String((it && (it.marker || it.startText || it.at)) || '').trim();
      if (!mk) { if (k) missed.push(k); return; }
      const p = cleaned.indexOf(mk, from);
      if (p < 0) { missed.push(k); return; }
      if (p > 0 && (!pts.length || p > pts[pts.length - 1].pos)) pts.push({ pos: p, title: String(it.title || '') });
      from = p + 1;
    });
    return {
      bounds: [0].concat(pts.map(function (x) { return x.pos; })).concat([cleaned.length]),
      titles: [''].concat(pts.map(function (x) { return x.title; })).concat(['']),
      missed: missed.length,
    };
  }
  /* 区间 → bounds：要求首尾与长度对齐，中间留洞或互相重叠就整批拒绝（宁可不动） */
  function _boundsFromRanges(cleaned, items) {
    const n = cleaned.length; let prev = 0; const pts = [0]; const titles = [''];
    for (let i = 0; i < items.length; i++) {
      const s = Number(items[i].start), e = Number(items[i].end);
      if (!isFinite(s) || !isFinite(e)) return { bad: '第 ' + (i + 1) + ' 段区间不是数字' };
      if (s !== prev) return { bad: '区间不连续（第 ' + (i + 1) + ' 段起点 ' + s + '，上一段结束 ' + prev + '），会丢正文' };
      if (e <= s || e > n) return { bad: '第 ' + (i + 1) + ' 段长度不合法' };
      pts.push(e); titles.push(String(items[i].title || '')); prev = e;
    }
    if (prev !== n) return { bad: '最后一段没接到全书结尾（' + prev + ' ≠ ' + n + '），会丢正文' };
    return { bounds: pts, titles: titles, missed: 0 };
  }
  /* 从模型回复里取出 JSON 数组：容忍 ```json 围栏与前后那句「好的，以下是…」 */
  function _parseAiJson(txt) {
    const raw = String(txt || '');
    /* 从第一个 [ 或 { 起做括号配对（字符串内的括号与转义都跳过），配平到哪一位就截到哪一位。
       按最后一个 } 取最大边界时，模型在 JSON 后面附一句「以上（共 12 章）」之类的话
       就会把尾巴一起切进解析范围，整批建议当场作废。 */
    let start = -1;
    for (let i = 0; i < raw.length; i++) { const c = raw.charAt(i); if (c === '[' || c === '{') { start = i; break; } }
    if (start < 0) return null;
    let depth = 0, inStr = false, esc = false, end = -1;
    for (let i = start; i < raw.length; i++) {
      const c = raw.charAt(i);
      if (esc) { esc = false; continue; }
      if (c === '\\') { if (inStr) esc = true; continue; }
      if (c === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (c === '[' || c === '{') depth++;
      else if (c === ']' || c === '}') { depth--; if (depth === 0) { end = i; break; } }
    }
    if (end < 0) return null;
    try { const j = JSON.parse(raw.slice(start, end + 1)); return Array.isArray(j) ? j : (j && Array.isArray(j.chapters) ? j.chapters : null); }
    catch (e) { BF.err.report('ai.parseJson', e); return null; }
  }
  async function aiSplit(bookId, opts) {
    opts = opts || {};
    const b = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (x) { return x && x.id === bookId; });
    if (!b) return { error: '书不存在' };
    if (!BF.ai.requireKey('AI 分章', { silent: true })) return { error: '未配置 API 密钥' };
    const cleaned = await _aiFullText(b);
    if (cleaned.length < 40) return { error: '正文过短，没有可切的量' };
    const cap = (BF.CONFIG.AI_SPLIT_SAMPLE_CAP || 60000);
    const prompt = String(BF.ai.prompts.aiSplit != null ? BF.ai.prompts.aiSplit : BF.ai._promptDefaults.aiSplit)
      .replace(/\{\{book\}\}/g, b.title || '')
      .replace(/\{\{content\}\}/g, cleaned.slice(0, cap))
      .replace(/\{\{count\}\}/g, String(b.totalChapters || 1));
    const jobId = BF.jobs.begin('AI · 分章建议《' + (b.title || '') + '》', { kind: 'io' });
    const t0 = Date.now();
    let out = null, gwyErr = '';
    try {
      out = await BF.ai.gateway.call([{ role: 'user', content: prompt }], { stream: false, signal: opts.signal, timeout: opts.timeout || 120000 });
    } catch (e) { gwyErr = String((e && e.message) || e); }
    finally { try { if (out) BF.jobs.end(jobId); else BF.jobs.fail(jobId, gwyErr || '没拿到内容'); } catch (e) {} }
    if (!out || !out.content) return { error: gwyErr || '模型没返回内容' };
    const items = _parseAiJson(out.content);
    if (!items) return { error: '模型未按结构返回（拿不到数组），本次不改动任何章节' };
    let plan = null, form = '';
    const rx = items.length === 1 && items[0] && (items[0].regex || items[0].pattern);
    if (rx) {
      form = 'regex';
      const sopts = { strategy: 'regex', chapterRegex: String(rx), chapterWordCount: BF.settings.get('chapterWordCount') || BF.settings.DEFAULTS.chapterWordCount, autoDetectTitle: true, mergeTocBlock: BF.settings.get('mergeTocBlock') !== false };
      plan = { bounds: BF.library._splitBounds(cleaned, sopts), titles: [], missed: 0 };
      if (sopts.__regexRejected) return { error: '模型给的正则被回溯防护拒绝（' + sopts.__regexRejected + '），不执行' };
    } else if (items.length >= 2 && items.every(function (x) { return x && typeof x.start === 'number'; })) {
      form = 'ranges'; plan = _boundsFromRanges(cleaned, items);
    } else {
      form = 'anchors'; plan = _boundsFromAnchors(cleaned, items);
    }
    if (!plan || plan.bad) return { error: (plan && plan.bad) || '拿不到可用的切分依据' };
    if (plan.bounds.length < 3 || !BF.library._boundsIntegral(cleaned, plan.bounds)) {
      return { error: '切分依据不能恰好铺满原文（' + form + '），为避免丢字整本不动' };
    }
    /* 标题走 rebuildBookChapters 的 renames（按 sid），不覆盖本地派生标题：
       sid = stableSid(title, content)，直接改 title 会整批换 sid、标注重映射集体失效 */
    const chapters = BF.library._buildChapters(cleaned, plan.bounds, { autoDetectTitle: true });
    BF.library.__ensureSid(chapters);
    const renames = {};
    chapters.forEach(function (c, i) {
      const t = String((plan.titles && plan.titles[i]) || '').trim();
      if (t && c.sid != null && t !== c.title) renames[c.sid] = t;
    });
    /* 守恒判据用「去掉空白后的字符数」，不是原样字数合计：_buildChapters 会裁每章
       首尾空白（与手动重新分章同一规则），拿长度硬相等会永远不通过 ——
       全书 581 字、分章合计 573，差的 8 个全是空白，去空白后两侧同为 552。
       真丢正文（模型漏切一段、区间留洞）时这个判据一定拦得住。 */
    const _noWs = function (s) { return String(s).replace(/\s+/g, '').length; };
    const joined = chapters.map(function (c) { return String(c.content || ''); }).join('');
    return {
      bookId: bookId, bounds: plan.bounds, renames: renames, form: form, cleaned: cleaned,
      oldChapters: (b.totalChapters || 0), newChapters: chapters.length,
      titles: chapters.map(function (c) { return renames[c.sid] || c.title; }),
      conserved: _noWs(joined) === _noWs(cleaned), chars: cleaned.length, trimmed: cleaned.length - joined.length,
      model: out.model || '', ms: Date.now() - t0, missed: plan.missed || 0,
    };
  }
  /* 落库：写库前取字节级快照（与手动重新分章同一条通道）。撤销时原样放回，
     **不经 __putChapters** —— 它会二次压缩正文 + 重发 id，标注 sid 会错乱。 */
  async function applySplitPlan(plan, label) {
    if (!plan || !plan.bookId) return false;
    if (!plan.conserved) { BF.noti.error('切分未通过字数守恒校验，已拒绝写入'); return false; }
    const bookId = plan.bookId;
    let snap = null, snapMB = 0;
    try {
      /* AI 分章的撤销快照同样只要这一本书的记录本体 */
      const recs = await BF.store.idbIndexRecords(BF.store.K.CHAPTERS, 'bk', IDBKeyRange.only(String(bookId)), { strict: true }) || [];
      const titlesRec = await BF.store.idbGet(BF.store.K.CHAPTER_TITLES, bookId);
      const meta = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (x) { return x && x.id === bookId; });
      const bytes = recs.reduce(function (s, r) { return s + (((r.content && r.content.length) || (r.content && r.content.byteLength) || 0)); }, 0);
      snapMB = Math.round(bytes / 1048576 * 10) / 10;
      if (bytes <= 8 * 1048576 && meta) {
        snap = { recs: recs, titles: titlesRec, meta: { totalChapters: meta.totalChapters, wordCount: meta.wordCount, chapterWords: meta.chapterWords, chapterBounds: meta.chapterBounds, chapterRenames: meta.chapterRenames } };
      }
    } catch (e) { snap = null; }
    const _noUndo = snap ? '' : '（本书 ' + snapMB + 'MB 超撤销预算或快照不可用，未登记撤销）';
    return BF.act.run((label || 'AI 分章') + _noUndo, function () {
      return BF.library.rebuildBookChapters(bookId, { full: plan.cleaned, bounds: plan.bounds, renames: plan.renames });
    }, {
      undo: snap ? async function () {
        const toDel = await BF.store.idbIndexKeys(BF.store.K.CHAPTERS, 'bk', IDBKeyRange.only(String(bookId)), { strict: true }) || [];
        for (const cid of toDel) { try { await BF.store.idbDelete(BF.store.K.CHAPTERS, cid); } catch (e) { BF.err.report('aiSplit.undo.del', e); } }
        await BF.store.idbPutAll(BF.store.K.CHAPTERS, snap.recs);
        if (snap.titles) await BF.store.idbPutAll(BF.store.K.CHAPTER_TITLES, [snap.titles]);
        await BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
          const _b = (arr || []).find(function (x) { return x && x.id === bookId; });
          if (!_b) return false;
          Object.keys(snap.meta).forEach(function (k) { _b[k] = snap.meta[k]; });
          return arr;
        });
        try { BF.reader.clearPrefetch(); } catch (e) {}
      } : null,
      onOk: function () { try { BF.reader.clearPrefetch(); } catch (e) {} BF.app.renderBookshelf(); },
    });
  }
  /* 预览卡：AI 只出建议，**用户点确认才写库**。
     卡片必须把「依据形态、字数守恒结论、被跳过的锚点数」如实摆出来 ——
     这三样是判断这次建议能不能用的全部依据。 */
  function reviewSplitPlan(plan, onApplied) {
    if (!plan || plan.error) { BF.noti.warn('AI 分章没成功：' + ((plan && plan.error) || '未知原因')); return; }
    const b = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (x) { return x && x.id === plan.bookId; }) || {};
    const formName = { anchors: '锚点定位', ranges: '字符区间', regex: '切分正则' }[plan.form] || plan.form;
    const rows = plan.titles.slice(0, 12).map(function (t, i) {
      return '<li><span class="ai-plan__w">' + (plan.bounds[i + 1] - plan.bounds[i]) + ' 字</span>' +
        BF.dom.esc(t || ('第 ' + (i + 1) + ' 章')) + '</li>';
    }).join('');
    BF.modal.custom('AI 分章建议',
      '<div class="ai-plan">' +
      '<div>《' + BF.dom.esc(b.title || '') + '》：' + plan.oldChapters + ' 章 → <b>' + plan.newChapters + '</b> 章' +
      '（依据：' + BF.dom.esc(formName) + ' · 耗时 ' + Math.round(plan.ms / 1000) + 's）</div>' +
      '<div>正文守恒：<b>' + (plan.conserved ? '通过' : '不通过') + '</b>（全书 ' + plan.chars + ' 字' +
      (plan.trimmed ? '，各章首尾空白合计裁掉 ' + plan.trimmed + ' 个字符' : '') + '，正文不增不减）</div>' +
      (plan.missed ? '<div class="ai-plan__warn">模型给的锚点有 ' + plan.missed + ' 个在原文里找不到，已跳过、不猜位置</div>' : '') +
      '<ol class="ai-plan__list">' + rows + '</ol>' +
      (plan.titles.length > 12 ? '<div class="ai-plan__more">… 其余 ' + (plan.titles.length - 12) + ' 章未列出</div>' : '') +
      '<div class="ai-plan__note">确认后仍可 Ctrl+Z 撤销；不点确认不会改动任何章节。</div></div>' +
      '<div class="dlg-foot"><button class="btn btn-sm" data-modal-cancel>不用了</button>' +
      '<button class="btn btn-sm primary" data-modal-ok>确认分章</button></div>',
      function (box, dismiss) {
        box.querySelector('[data-modal-cancel]').onclick = function () { dismiss(); BF.modal.hide(); };
        box.querySelector('[data-modal-ok]').onclick = function () {
          dismiss(); BF.modal.hide();
          applySplitPlan(plan, 'AI 分章').then(function (ok) { if (ok && onApplied) onApplied(); });
        };
      });
  }
  /* AI 打标签：只出建议，**写库要用户点确认**（与分章、聚会同一口径）。
     拿到标签就直接 `_b.tags = _tags` 覆盖的话，导入增强开着时，
     用户既没同意、也看不见，手写的标签还会被整组抹掉。 */
  async function aiTagSuggest(bookId, opts) {
    opts = opts || {};
    const b = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (x) { return x && x.id === bookId; });
    if (!b) return null;
    if (!BF.ai.requireKey('AI 打标签', { silent: true })) return null;
    let t = '';
    try { t = (await BF.library.getChapterText(b, 0)) || ''; } catch (e) {}
    const prompt = (BF.ai.prompts && BF.ai.prompts.aiTag || BF.ai._promptDefaults.aiTag)
      .replace(/\{\{book\}\}/g, b.title || '')
      .replace(/\{\{content\}\}/g, String(t).slice(0, 3000));
    const out = await aiOr(
      function () { return BF.ai.gateway.call([{ role: 'user', content: prompt }], { stream: false, signal: opts.signal }); },
      function () { return null; }
    );
    if (!out || !out.content) return null;
    const tags = String(out.content).replace(/[\[\]"']/g, '').split(/[,，、]/).map(function (s) { return s.trim(); }).filter(Boolean).slice(0, 5);
    return tags.length ? { bookId: bookId, title: b.title || '', tags: tags } : null;
  }
  /* 写库：合并而非覆盖（原有标签是用户自己写的），撤销走快照 */
  function applyTags(sug, label) {
    if (!sug || !sug.tags || !sug.tags.length) return Promise.resolve(false);
    const before = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (x) { return x && x.id === sug.bookId; }) || {};
    const snap = (before.tags || []).slice();
    return BF.act.run(label || 'AI 打标签', function () {
      return BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
        const _b = (arr || []).find(function (x) { return x && x.id === sug.bookId; });
        if (!_b) return false;
        _b.tags = Array.from(new Set((snap || []).concat(sug.tags)));
        return arr;
      });
    }, {
      undo: function () {
        BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
          const _b = (arr || []).find(function (x) { return x && x.id === sug.bookId; });
          if (!_b) return false;
          _b.tags = snap;
          return arr;
        });
        BF.app.renderBookshelf();
      },
      onOk: function () { BF.app.renderBookshelf(); },
    });
  }
  /* 建议确认卡：摆出「原来有什么、要新增什么」，不点确认一个字都不写 */
  function reviewTagSuggestion(sug, onApplied) {
    if (!sug) { BF.noti.warn('AI 没给出可用的标签建议'); return; }
    const cur = ((BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (x) { return x && x.id === sug.bookId; }) || {}).tags || [];
    const adds = sug.tags.filter(function (t) { return cur.indexOf(t) < 0; });
    BF.modal.custom('AI 标签建议',
      '<div class="ai-plan">' +
      '<div>《' + BF.dom.esc(sug.title || '') + '》</div>' +
      '<div>现有标签：' + (cur.length ? BF.dom.esc(cur.join('、')) : '（无）') + '</div>' +
      '<div>建议新增：<b>' + BF.dom.esc(adds.length ? adds.join('、') : '（全是已有的）') + '</b></div>' +
      '<div class="ai-plan__note">只新增、不覆盖你手写的标签；确认后仍可 Ctrl+Z 撤销。</div></div>' +
      '<div class="dlg-foot"><button class="btn btn-sm" data-modal-cancel>不用了</button>' +
      '<button class="btn btn-sm primary" data-modal-ok' + (adds.length ? '' : ' disabled') + '>应用标签</button></div>',
      function (box, dismiss) {
        box.querySelector('[data-modal-cancel]').onclick = function () { dismiss(); BF.modal.hide(); };
        box.querySelector('[data-modal-ok]').onclick = function () {
          dismiss(); BF.modal.hide();
          applyTags({ bookId: sug.bookId, tags: adds }).then(function (ok) { if (ok && onApplied) onApplied(); });
        };
      });
  }
  /* 兼容旧调用点：aiTag 现在等于「出建议 + 暂存 + 通知」，绝不自动写库 */
  async function aiTag(bookId, opts) {
    const sug = await aiTagSuggest(bookId, opts);
    if (sug) { BF.smart._pendingTag = sug; BF.noti.info('AI 给了标签建议：' + sug.tags.join('、') + '（还没应用）', { action: { label: '查看建议', run: function () { reviewTagSuggestion(sug); } } }); }
    return sug ? sug.tags : null;
  }

  /* ---------- AI 智能聚会：把书按氛围/主题聚成一组组的建议 ----------
     模型只给「组名 + 成员 id + 一句理由」，正文一个字都不搬运；
     成员 id 一律本地校验（不存在的 id 直接丢，不猜是哪本书）。 */
  async function aiGather(opts) {
    opts = opts || {};
    const all = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).filter(function (b) { return b && b.id; });
    const scope = (opts.bookIds && opts.bookIds.length)
      ? all.filter(function (b) { return opts.bookIds.indexOf(b.id) >= 0; }) : all;
    if (scope.length < 2) { BF.noti.warn('至少两本书才谈得上「聚会」；先导入几本'); return { error: '范围太小' }; }
    if (!BF.ai.requireKey('AI 聚会', { silent: true })) return { error: '未配置 AI 端点' };
    /* 取材：书名 + 作者 + 已有标签 + 全书摘要（有就用），没有摘要就只靠书名标签——
       「AI 相关一律先出建议」：取材不够就让它少分几组，而不是编。 */
    const rows = scope.map(function (b) {
      return { id: b.id, title: b.title || '', author: b.author || '', tags: b.tags || [], summary: String(b.summary || '').slice(0, 120) };
    });
    const prompt = String(BF.ai.prompts.aiGather || BF.ai._promptDefaults.aiGather)
      .replace(/\{\{count\}\}/g, String(rows.length))
      .replace(/\{\{hint\}\}/g, String(opts.question || '').trim() || '（用户没特别说，按内容与氛围自然聚）')
      .replace(/\{\{books\}\}/g, JSON.stringify(rows).slice(0, 12000));
    let parsed;
    try {
      parsed = await BF.ai.structured([{ role: 'user', content: prompt }], {
        type: 'object',
        properties: { groups: { type: 'array', items: { type: 'object', properties: {
          name: { type: 'string' }, bookIds: { type: 'array', items: { type: 'string' } }, why: { type: 'string' } },
          required: ['name', 'bookIds'] } } },
        required: ['groups'],
      }, { desc: '把给出的书按主题/氛围聚会', signal: opts.signal });
    } catch (e) {
      BF.err.report('aiGather', e);
      BF.noti.warn('AI 聚会没成功：' + String(e && e.message || e));
      return { error: String(e && e.message || e) };
    }
    const valid = new Set(rows.map(function (r) { return r.id; }));
    const byId = {};
    rows.forEach(function (r) { byId[r.id] = r; });
    const nameOf = {};
    BF.shelf.groups().forEach(function (g) { nameOf[g.name] = g.id; });
    const raw = Array.isArray(parsed) ? parsed : (parsed && parsed.groups);
    const groups = (Array.isArray(raw) ? raw : []).map(function (g) {
      const ids = (g && Array.isArray(g.bookIds) ? g.bookIds : []).filter(function (x) { return valid.has(x); });
      return { name: String((g && g.name) || '').trim().slice(0, 20), ids: ids, why: String((g && g.why) || '').trim().slice(0, 120), existing: !!nameOf[String((g && g.name) || '').trim()] };
    }).filter(function (g) { return g.name && g.ids.length >= 2; });
    if (!groups.length) { BF.noti.warn('模型没给出可用的组（组名或成员不合规）'); return { error: '返回不合规' }; }
    const plan = { scope: rows.length, groups: groups, byId: byId };
    reviewGather(plan);
    return plan;
  }
  function reviewGather(plan, onApplied) {
    BF.modal.custom('AI 聚会建议',
      '<div class="ai-plan">' +
      '<div>范围 ' + plan.scope + ' 本，模型聚出 <b>' + plan.groups.length + '</b> 组。确认后才会建组并放书。</div>' +
      '<div class="grp-pick__list">' + plan.groups.map(function (g, i) {
        return '<label class="grp-row"><input type="checkbox" data-gh="' + i + '" checked>' +
          '<span class="grp-row__n">' + BF.dom.esc(g.name) + (g.existing ? '（已有同名组）' : '') + '</span>' +
          '<span class="grp-row__c">' + g.ids.length + ' 本</span></label>' +
          '<div class="grp-pick__tip">' + g.ids.map(function (id) { return BF.dom.esc((plan.byId[id] || {}).title || '?'); }).join('、') +
          (g.why ? '<br>理由：' + BF.dom.esc(g.why) : '') + '</div>';
      }).join('') + '</div>' +
      '<div class="ai-plan__note">同名组不重复建，直接往现有组里放书；不点确认不会改动任何东西。</div></div>' +
      '<div class="dlg-foot"><button class="btn btn-sm" data-modal-cancel>不用了</button>' +
      '<button class="btn btn-sm primary" data-modal-ok>全部应用</button></div>',
      function (box, dismiss) {
        box.querySelector('[data-modal-cancel]').onclick = function () { dismiss(); BF.modal.hide(); };
        box.querySelector('[data-modal-ok]').onclick = function () {
          const picked = Array.prototype.slice.call(box.querySelectorAll('[data-gh]:checked')).map(function (el) { return +el.dataset.gh; });
          dismiss(); BF.modal.hide();
          applyGather(plan, picked).then(function (ok) { if (ok && onApplied) onApplied(); });
        };
      });
  }
  async function applyGather(plan, picked) {
    const chosen = (picked || plan.groups.map(function (g, i) { return i; })).map(function (i) { return plan.groups[i]; }).filter(Boolean);
    if (!chosen.length) { BF.noti.info('一组都没勾，什么都没改'); return false; }
    const snap = { g: BF.store.lsGetArray(BF.store.K.SHELF_GROUPS, []), i: BF.store.lsGet(BF.store.K.SHELF_ITEMS, {}) };
    /* act.run 的 fn 同步返回 Promise，撤销栈据此把「归零」登记成可回退的一步 */
    return BF.act.run('AI 聚会落组', function () {
      return (async function () {
        let made = 0;
        for (let k = 0; k < chosen.length; k++) {
          const g = chosen[k];
          let id = (BF.shelf.groups().find(function (x) { return x.name === g.name; }) || {}).id;
          if (!id) { const created = await BF.shelf.create(g.name); id = created.id; made++; }
          await BF.shelf.applyDiff(g.ids, [id], []);
        }
        return { made: made, groups: chosen.length };
      })();
    }, {
      detail: chosen.length + ' 组',
      undo: function () {
        BF.store.lsSet(BF.store.K.SHELF_GROUPS, snap.g);
        BF.store.lsSet(BF.store.K.SHELF_ITEMS, snap.i);
        BF.app.renderBookshelf();
      },
      onOk: function () { BF.app.renderBookshelf(); },
    });
  }
  async function importEnrich(bookId) {
    if (!BF.settings.get('aiImportEnhance') || !BF.ai.requireKey('导入增强', { silent: true })) return false;
    const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
    const b = books.find(function (x) { return x && x.id === bookId; });
    if (!b) return false;
    try {
      const total = b.totalChapters || 0;
      const sampleN = Math.min(total, 8);
      let sample = '';
      for (let i = 0; i < sampleN; i++) {
        try { const t = await BF.library.getChapterText(b, i); if (t) sample += '【第' + (i + 1) + '章】\n' + String(t).slice(0, 1200) + '\n\n'; } catch (_) {}
      }
      /* 摘要与标签各自独立回退（走 aiOr）：两个 AI 调用串在同一个 try 里时，
         标签请求失败会连带把已拿到的摘要一起丢掉 —— 用户表现为「AI 增强没反应」，
         实际已经花了配额拿到一半。分开后，标签失败时摘要仍然写回。 */
      /* 摘要与标签提示词读提示词注册表，不在这里内联抄文案：
         用户在提示词预设里改了「全书摘要」「AI 主题标签」，导入增强要跟着变；
         字数也不能由文案硬顶，要由档位设置决定。占位符按本书与当前档位就地填充。 */
      const _lvlWords = BF.CONFIG.AI_SUMMARY_LEVEL_WORDS[BF.settings.get('aiSummaryLevel') || 'standard'] || '150';
      const sumOut = await aiOr(
        function () {
          const _p = String(BF.ai.prompts.summaryBook)
            .replace(/\{\{book\}\}/g, b.title || '')
            .replace(/\{\{level\}\}/g, _lvlWords);
          return BF.ai.gateway.call([{ role: 'user', content: _p + '\n\n' + sample.slice(0, 8000) }], { stream: false });
        },
        function () { return null; }
      );
      if (sumOut && sumOut.content) b.summary = String(sumOut.content).slice(0, 600);
      /* 标签只出建议、不写库：AI 相关写操作一律要用户点头。
         直接 `b.tags = _t.slice()` 会覆盖用户手写的标签；
         兜底若挂在 `if (!_tagDone)` 上，**关着「AI 自动打标签」也会发一次请求并写标签**，
         开关根本不管用。整块由 aiAutoTag 一处决定，且只走 aiTag 的建议通道。 */
      if (BF.settings.get('aiAutoTag')) {
        try { await aiTag(bookId, {}); } catch (e) { BF.log.info('AI 标签建议未产出：' + String(e && e.message || e)); }
      }
      /* AI 分章不写回正文 —— 把模型返回的正文直接 __putChapters 落库，
         既丢字又砍书。只出建议：吐司带一个动作进预览卡，用户按「确认分章」
         才走快照 + 写库；吐司过期后书卡「菜单 → AI 分章」也还能进同一张卡。 */
      if (BF.settings.get('aiAutoSplit')) {
        try {
          const _plan = await aiSplit(bookId, {});
          if (_plan && _plan.error) BF.log.info('AI 分章未产出建议：' + _plan.error);
          else if (_plan) {
            BF.smart._pendingSplit = _plan;
            BF.noti.info('AI 给了分章建议：' + _plan.oldChapters + ' 章 → ' + _plan.newChapters + ' 章（还没应用）', {
              action: { label: '查看建议', run: function () { reviewSplitPlan(_plan); } },
            });
          }
        } catch (e) { BF.err.report('importEnrich.aiSplit', e); }
      }
      /* 逐字段合并：b 是本函数开头 lsGet 的快照，而本函数跨多次 await（取章节文本 → AI 摘要
         → AI 标签 → AI 分章），期间用户完全可能在书架上改标题/作者/收藏/置顶，
         整体替换会把这些改动静默回滚。回调内重新 find 到最新记录，只写回本函数
         真正产出的字段（summary）。tags / totalChapters 本函数一个都不产出
         （标签与分章现在都只出建议、由用户确认），把开头的快照再写回去只会
         在用户中途手改标签、手动重新分章时把那些改动回滚成旧值。 */
      const _hasSummary = !!(sumOut && sumOut.content);
      await BF.store.mutate(BF.store.K.BOOKS_META, function (arr) {
        arr = arr || [];
        const _b = arr.find(function (x) { return x && x.id === bookId; });
        if (!_b) return false;
        if (_hasSummary) _b.summary = String(sumOut.content).slice(0, 600);
        return arr;
      });
      return !!(b.summary || (b.tags && b.tags.length));
    } catch (e) { BF.err.report('smart.importEnrich', e); }
    return false;
  }
  /* aiSplit 现在返回「建议计划」而不是章节数组：{bounds, renames, conserved, …} 或 {error}。
     _pendingSplit 暂存最近一次未确认的建议，吐司过期后书卡「菜单 → AI 分章」还能进同一张预览卡。 */
  return { chapters: chapters, aiOr: aiOr, importEnrich: importEnrich, aiSplit: aiSplit, aiTag: aiTag,
    aiTagSuggest: aiTagSuggest, applyTags: applyTags, reviewTagSuggestion: reviewTagSuggestion,
    aiGather: aiGather, applyGather: applyGather, reviewGather: reviewGather,
    applySplitPlan: applySplitPlan, reviewSplitPlan: reviewSplitPlan, _pendingSplit: null, _pendingTag: null };
})();

