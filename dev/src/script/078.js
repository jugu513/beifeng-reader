/* ============ W3C Web Annotation 标注层（BF.ann，C5） ============
   标注导出/导入按 W3C Web Annotation 数据模型（JSON-LD，
   @context: http://www.w3.org/ns/anno.jsonld）。
   BF.cfi 的 {si,so,text,before,after,len} 与 TextPositionSelector
   + TextQuoteSelector 同构，北风段定位经
   FragmentSelector 导出，构成三层锚点冗余（参照 EPUB 阅读器实践：
   多锚点互为兜底，单一锚点错位不致整条失效）：
   ① TextQuoteSelector：exact/prefix/suffix 文本引用锚
   ② TextPositionSelector：start/end 章内字符偏移锚
   ③ FragmentSelector：ch{章}/p{段}/s{段内偏移}/l{长度}/f{指纹}
     段定位锚（北风 loc 唯一实现映射，精确抗段落重排）
   导出补齐 charOffset/color/status（数据模型已有这些字段，导出不得缺失）。
   导入对配不上的标注给明确报告、
   不静默丢弃（来源书不一致/章节越界/三层锚定全失败
   均列入报告明细）。 */
BF.ann = (function () {
  const CTX = 'http://www.w3.org/ns/anno.jsonld';
  const LOC_CONFORMS = 'https://breeze.local/ns/anno-loc/v1';
  const FRAG_RE = /^ch(\d+)\/p(\d+)\/s(\d+)\/l(\d+)(?:\/f([0-9a-z]+))?$/;
  /* 段定位 → FragmentSelector 值（指纹取 BF.cfi.fingerprint
     的散列段，作冗余锚点，导入侧不强制比对） */
  function fragOf(loc, chapterIdx) {
    const fp = (loc && typeof loc.text === 'string' && loc.text)
      ? BF.cfi.fingerprint(loc.text).split(':').pop()
      : '';
    return 'ch' + (chapterIdx || 0) + '/p' + (loc.si || 0) + '/s' + (loc.so || 0) + '/l' + (typeof loc.len === 'number' ? loc.len : (loc.text || '').length) + (fp ? '/f' + fp : '');
  }
  /* FragmentSelector 值 → {chapterIdx, si, so, len} */
  function parseFrag(v) {
    const m = FRAG_RE.exec(String(v || ''));
    if (!m) return null;
    return { chapterIdx: parseInt(m[1], 10), si: parseInt(m[2], 10), so: parseInt(m[3], 10), len: parseInt(m[4], 10) };
  }
  /* 存储记录 → W3C Annotation（四类标注统一建模） */
  function toAnnotation(kind, rec, book) {
    const loc = rec.loc || null;
    const text = rec.text || rec.word || '';
    const before = (loc && loc.before) || '';
    const after = (loc && loc.after) || '';
    const sel = [];
    /* ① 文本引用锚 */
    if (text) sel.push({ type: 'TextQuoteSelector', exact: text, prefix: before, suffix: after });
    /* ② 字符偏移锚 */
    if (typeof rec.charOffset === 'number') {
      const len = (loc && typeof loc.len === 'number') ? loc.len : text.length;
      sel.push({ type: 'TextPositionSelector', start: rec.charOffset, end: rec.charOffset + len });
    }
    /* ③ 段定位锚 */
    if (loc && typeof loc.si === 'number') sel.push({ type: 'FragmentSelector', value: fragOf(loc, rec.chapterIdx), conformsTo: LOC_CONFORMS });
    const motivation = kind === 'hl' ? 'highlighting' : kind === 'bm' ? 'bookmarking' : kind === 'note' ? 'commenting' : 'tagging';
    const ann = {
      '@context': CTX,
      /* W3C id：原记录 id 直接沿用（往返保真——导入侧
         据此还原同 id）；无 id 记录（书签/生词）才
         造 urn 兜底 */
      id: rec.id || ('urn:breeze:' + kind + ':' + book.id + ':' + (rec.chapterIdx || 0) + ':' + ('x' + (rec.created || 0))),
      type: 'Annotation',
      motivation: motivation,
      created: rec.created ? new Date(rec.created).toISOString() : undefined,
      /* 补 modified / canonical。修改时间按 updated→reviewedAt→created
         回退（划线重划写 updated、生词复习写 reviewedAt），都没有才用 now。
         canonical：W3C 期望它是一个权威标识 URI；本应用是单机、无远程
         权威副本，故 canonical 即本机 id + '#v' + 修改时刻，声明
         「这条的当前版本是哪一版」——不是指向别处的可解析 URI，
         导入侧不得拿它去联网解析。 */
      modified: new Date(rec.updated || rec.reviewedAt || rec.created || Date.now()).toISOString(),
      canonical: (rec.id || ('urn:breeze:' + kind + ':' + book.id + ':' + (rec.chapterIdx || 0) + ':' + ('x' + (rec.created || 0)))) + '#v' + (rec.updated || rec.reviewedAt || rec.created || 0),
      target: { source: book.id },
    };
    if (sel.length) ann.target.selector = sel;
    /* body：划线的批注 / 书签与便签的文本 / 生词的词 */
    const body = kind === 'hl' ? (rec.note || '') : kind === 'vocab' ? (rec.word || '') : text;
    if (body) ann.body = { type: 'TextualBody', value: body, format: 'text/plain' };
    /* 北风扩展：补齐 charOffset/color/status 等数据模型字段。
       chapterIdx 仅当记录确有时写入——无位置便签无章节，
       写入 0 会让导入侧误判为「有章节」而去定位（配不上） */
    ann.bf = { kind: kind };
    if (typeof rec.chapterIdx === 'number') ann.bf.chapterIdx = rec.chapterIdx;
    if (rec.id) ann.bf.id = rec.id;
    if (typeof rec.charOffset === 'number') ann.bf.charOffset = rec.charOffset;
    if (kind === 'hl') {
      ann.bf.color = rec.color || 'yellow';
      ann.bf.type = rec.type || 'underline';
      if (rec.note) ann.bf.note = rec.note;
    } else if (kind === 'vocab') {
      ann.bf.word = rec.word || '';
      ann.bf.ctx = rec.ctx || '';
      ann.bf.status = rec.status || 'unknown';
    }
    return ann;
  }
  /* 四类标注 → W3C AnnotationCollection（JSON-LD 文档） */
  function buildW3C(recs, book) {
    const items = [];
    (recs.hls || []).forEach(function (r) { items.push(toAnnotation('hl', r, book)); });
    (recs.bms || []).forEach(function (r) { items.push(toAnnotation('bm', r, book)); });
    (recs.notes || []).forEach(function (r) { items.push(toAnnotation('note', r, book)); });
    (recs.vocs || []).forEach(function (r) { items.push(toAnnotation('vocab', r, book)); });
    return {
      '@context': CTX,
      type: 'AnnotationCollection',
      id: 'urn:breeze:annotations:' + book.id,
      label: '《' + (book.title || '') + '》标注',
      generated: new Date().toISOString(),
      items: items,
    };
  }
  /* W3C 文档 → 标注候选（兼容：数组 / {items} / {first:{items}} / 单条） */
  function parseW3C(doc) {
    if (!doc) return [];
    let items = null;
    if (Array.isArray(doc)) items = doc;
    else if (Array.isArray(doc.items)) items = doc.items;
    else if (doc.first && Array.isArray(doc.first.items)) items = doc.first.items;
    else if (doc.type === 'Annotation' || doc.motivation) items = [doc];
    if (!items) return [];
    const label = (typeof doc.label === 'string') ? doc.label : '';
    const tm = label.match(/《(.+?)》/);
    const sourceTitle = tm ? tm[1] : '';
    const out = [];
    items.forEach(function (a) {
      if (!a || a.type === 'AnnotationCollection' || a.type === 'AnnotationPage') return;
      const sel = (a.target && a.target.selector) || [];
      const one = function (t) { return sel.filter(function (s) { return s && s.type === t; })[0] || null; };
      const tq = one('TextQuoteSelector');
      const tp = one('TextPositionSelector');
      const fs = sel.filter(function (s) { return s && s.type === 'FragmentSelector' && (!s.conformsTo || s.conformsTo === LOC_CONFORMS); })[0] || null;
      const fr = fs ? parseFrag(fs.value) : null;
      const bf = a.bf || {};
      const mot = String(a.motivation || '');
      const kind = bf.kind || (mot === 'highlighting' ? 'hl' : mot === 'bookmarking' ? 'bm' : mot === 'commenting' ? 'note' : mot === 'tagging' ? 'vocab' : '');
      if (!kind) return;
      const src = a.target && a.target.source;
      const c = {
        kind: kind,
        sourceBookId: (typeof src === 'string' && src.indexOf('urn:') !== 0) ? src : null,
        sourceTitle: sourceTitle,
        id: a.id || bf.id || null,
        created: a.created ? (new Date(a.created).getTime() || null) : (typeof bf.created === 'number' ? bf.created : null),
        chapterIdx: typeof bf.chapterIdx === 'number' ? bf.chapterIdx : (fr ? fr.chapterIdx : null),
      };
      if (kind === 'vocab') {
        c.word = ((a.body && a.body.value) || bf.word || (tq && tq.exact) || '');
        c.ctx = bf.ctx || '';
        c.status = bf.status || 'unknown';
        c.label = '生词「' + (c.word || '') + '」';
      } else {
        c.text = (tq && tq.exact) || (a.body && a.body.value) || '';
        c.note = kind === 'hl' ? ((a.body && a.body.value) || bf.note || '') : '';
        c.color = bf.color || 'yellow';
        c.type = bf.type || 'underline';
        c.charOffset = typeof bf.charOffset === 'number' ? bf.charOffset : (tp && typeof tp.start === 'number' ? tp.start : null);
        c.before = (tq && tq.prefix) || '';
        c.after = (tq && tq.suffix) || '';
        if (fr) c.loc = { si: fr.si, so: fr.so, len: fr.len, text: c.text, before: c.before, after: c.after };
        c.label = (kind === 'hl' ? '划线' : kind === 'bm' ? '书签' : '便签') + (c.text ? '「' + c.text.slice(0, 20) + '」' : '');
      }
      out.push(c);
    });
    return out;
  }
  /* 候选 + 章内段落 → 定位结果（三层锚定，BF.cfi 唯一实现）。
     返回 {ok:true, si, so, match} 或 {ok:false, reason}。 */
  function locate(c, paras) {
    if (!paras || !paras.length) return { ok: false, reason: '章节正文为空' };
    if (c.kind === 'vocab') {
      if (c.word && paras.join('\n').indexOf(c.word) >= 0) return { ok: true, si: -1, so: 0, match: 'word' };
      return { ok: false, reason: '正文中未找到生词「' + c.word + '」' };
    }
    if (!c.text && !c.loc) return { ok: false, reason: '标注缺少定位信息（文本/段定位/偏移均无）' };
    const loc = c.loc || { si: -1, so: 0, text: c.text, before: c.before || '', after: c.after || '', len: c.text ? c.text.length : 0 };
    const r = BF.cfi.locate(loc, paras);
    if (r.match) return { ok: true, si: r.si, so: r.so, match: r.match };
    /* 文本锚全失效时，字符偏移锚兜底（段落结构未变仍可精确定位） */
    if (typeof c.charOffset === 'number' && c.charOffset >= 0) {
      const full = paras.join('\n');
      if (c.charOffset < full.length) {
        const L = BF.cfi.offsetToLoc(c.charOffset, paras);
        if (L) return { ok: true, si: L.si, so: L.so, match: 'offset' };
      }
    }
    return { ok: false, reason: '三层锚定（段定位/文本引用/字符偏移）均未命中正文，文本可能已被改写' };
  }
  /* 导入核心：解析 → 逐条定位 → 写存储 → 汇总报告。
     配不上的标注进 failed 明细（不静默丢弃）。 */
  async function ingest(doc, book) {
    const cands = parseW3C(doc);
    const ok = { hl: [], bm: [], note: [], vocab: [] };
    const failed = [];
    const lib = BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || [];
    const K = BF.store.K;
    const splitParas = function (text) { return String(text || '').split('\n').filter(function (p) { return p.trim(); }); };
    for (let i = 0; i < cands.length; i++) {
      const c = cands[i];
      /* 来源书校验：导出书在书库且非当前书 → 明确拒绝（防导错书）；
         书库中不存在（外站导出/重导入的书）→ 放行，用户显式选择当前书 */
      if (c.sourceBookId) {
        const src = lib.find(function (x) { return x && x.id === c.sourceBookId; });
        if (src && src.id !== book.id) {
          failed.push({ label: c.label, reason: '来源书不一致（导出书《' + (src.title || c.sourceBookId) + '》，当前书《' + book.title + '》）' });
          continue;
        }
      }
      if (c.kind === 'note' && typeof c.chapterIdx !== 'number') {
        /* 无位置便签：无需定位 */
        ok.note.push({ id: c.id || ('n_' + Date.now() + '_' + i), bookId: book.id, text: c.text, created: c.created || Date.now() });
        continue;
      }
      if (typeof c.chapterIdx !== 'number' || c.chapterIdx < 0) {
        failed.push({ label: c.label, reason: '缺少章节信息' });
        continue;
      }
      if ((book.totalChapters || 0) > 0 && c.chapterIdx >= book.totalChapters) {
        failed.push({ label: c.label, reason: '章节越界（第' + (c.chapterIdx + 1) + '章超出本书 ' + book.totalChapters + ' 章）' });
        continue;
      }
      let text = '';
      try { text = await BF.library.getChapterText(book, c.chapterIdx); } catch (e) { text = ''; }
      const paras = splitParas(text);
      const r = locate(c, paras);
      if (!r.ok) { failed.push({ label: c.label, reason: r.reason }); continue; }
      if (c.kind === 'vocab') {
        ok.vocab.push({ bookId: book.id, word: c.word, chapterIdx: c.chapterIdx, ctx: c.ctx || '', created: c.created || Date.now(), status: c.status || 'unknown' });
        continue;
      }
      const charOffset = BF.cfi.locToOffset({ si: r.si, so: r.so }, paras);
      const loc = { si: r.si, so: r.so, text: c.text, before: c.before || '', after: c.after || '', len: c.text ? c.text.length : 0 };
      if (c.kind === 'hl') {
        const rec = { id: c.id || ('hl_' + (BF.hlc ? BF.hlc.next() : Date.now())), bookId: book.id, chapterIdx: c.chapterIdx, text: c.text, type: c.type, color: c.color, charOffset: charOffset, created: c.created || Date.now(), loc: loc };
        if (c.note) rec.note = c.note;
        ok.hl.push(rec);
      } else if (c.kind === 'bm') {
        ok.bm.push({ bookId: book.id, chapterIdx: c.chapterIdx, text: c.text, charOffset: charOffset, created: c.created || Date.now(), loc: loc });
      } else {
        ok.note.push({ id: c.id || ('n_' + Date.now() + '_' + i), bookId: book.id, chapterIdx: c.chapterIdx, text: c.text, created: c.created || Date.now() });
      }
    }
    /* 写存储（仅成功条目；失败条目只进报告，不落库） */
    /* 落库前按 id（无 id 时按 bookId+chapterIdx+charOffset+text 四元组）去重，
       重复导入 W3C 标注不再产生两份完全相同的记录。 */
    const _keyOf = function (r, kind) {
      if (r.id) return 'id:' + r.id;
      return kind + ':' + r.bookId + '|' + r.chapterIdx + '|' + (r.charOffset != null ? r.charOffset : '') + '|' + (r.text || '');
    };
    const _mergeNoDup = function (storeKey, kind, incoming, label) {
      const l = BF.store.lsGet(storeKey, []);
      const seen = new Set(l.map(function (x) { return _keyOf(x, kind); }));
      const kept = [];
      for (const r of incoming) {
        const key = _keyOf(r, kind);
        if (seen.has(key)) continue;   /* 已存在 → 跳过 */
        seen.add(key); kept.push(r);
      }
      if (kept.length) BF.store.setCritical(storeKey, l.concat(kept), label);
      return kept;
    };
    ok.hl = _mergeNoDup(K.HIGHLIGHTS, 'hl', ok.hl, '划线');
    ok.bm = _mergeNoDup(K.BOOKMARKS, 'bm', ok.bm, '书签');
    ok.note = _mergeNoDup(K.NOTES, 'note', ok.note, '便签');
    ok.vocab = _mergeNoDup(K.VOCAB, 'vocab', ok.vocab, '生词');
    return { ok: ok, okCount: ok.hl.length + ok.bm.length + ok.note.length + ok.vocab.length, failed: failed };
  }
  /* 导出驱动：当前书四类标注 → W3C JSON-LD 文件 */
  function exportAnnotations() {
    const bid = BF.appState.currentBookId;
    if (!bid) { BF.noti.warn('请先打开一本书再导出标注'); return; }
    const b = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (x) { return x && x.id === bid; });
    if (!b) { BF.noti.warn('书籍不存在'); return; }
    const K = BF.store.K;
    const recs = {
      hls: (BF.store.lsGet(K.HIGHLIGHTS, []) || []).filter(function (x) { return x && x.bookId === bid; }),
      bms: (BF.store.lsGet(K.BOOKMARKS, []) || []).filter(function (x) { return x && x.bookId === bid; }),
      notes: (BF.store.lsGet(K.NOTES, []) || []).filter(function (x) { return x && x.bookId === bid; }),
      vocs: (BF.store.lsGet(K.VOCAB, []) || []).filter(function (x) { return x && x.bookId === bid; }),
    };
    const total = recs.hls.length + recs.bms.length + recs.notes.length + recs.vocs.length;
    if (!total) { BF.noti.warn('本书还没有任何标注（划线/书签/便签/生词）'); return; }
    const doc = buildW3C(recs, b);
    const json = JSON.stringify(doc, null, 2);
    /* 按 exportBlob 返回值门控：取消保存选择器时不弹成功 */
    BF.exportBlob(b.title + '_标注_W3C.json', json, { mime: 'application/ld+json;charset=utf-8' })
      .then(function (ok2) { if (ok2) BF.noti.success('W3C 标注已导出：' + total + ' 条（JSON-LD）'); });
  }
  /* 导入驱动：选 JSON 文件 → 解析 → 定位 → 写库 → 报告。
     返回 Promise：resolve(导入报告) / resolve(null)（无书/未选文件）。
     报告走 BF.modal.alert 明列失败明细（不静默丢弃）。 */
  function importAnnotations() {
    const bid = BF.appState.currentBookId;
    if (!bid) { BF.noti.warn('请先打开一本书（标注将导入当前打开的书）'); return Promise.resolve(null); }
    const book = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (x) { return x && x.id === bid; });
    if (!book) { BF.noti.warn('书籍不存在'); return Promise.resolve(null); }
    return new Promise(function (resolve) {
      const inp = document.createElement('input');
      inp.type = 'file';
      inp.accept = '.json,application/json';
      inp.style.display = 'none';
      document.body.appendChild(inp);
      const finish = function (rep) {
        try { inp.remove(); } catch (e) {}
        showReceipt(rep, book);
        resolve(rep);
      };
      inp.addEventListener('change', function () {
        const f = inp.files && inp.files[0];
        if (!f) { finish(null); return; }
        const rd = new FileReader();
        rd.onload = function () {
          let doc;
          try { doc = JSON.parse(String(rd.result || '')); } catch (e) {
            var _jm = '导入失败：不是有效的 JSON 备份文件';
            if (BF.feedback) BF.feedback.error(_jm, { next: { label: '重新选择', run: function () { inp.click(); } } }); else if (BF.noti) { var _nfB = BF.noti.error || BF.noti.warn; if (_nfB) _nfB.call(BF.noti, _jm); }
            finish(null);
            return;
          }
          ingest(doc, book).then(finish).catch(function (err) {
            if (BF.feedback) BF.feedback.fail('导入失败', err, { next: { label: '重新选择', run: function () { inp.click(); } } }); else if (BF.noti) { var _nfC = BF.noti.error || BF.noti.warn; if (_nfC) _nfC.call(BF.noti, '导入失败：' + ((err && err.message) || String(err))); }
            finish(null);
          });
        };
        rd.onerror = function () { var _rm = '导入失败：读取失败，确认文件未损坏且未被占用'; if (BF.feedback) BF.feedback.error(_rm, { next: { label: '重新选择', run: function () { inp.click(); } } }); else if (BF.noti) { var _nfD = BF.noti.error || BF.noti.warn; if (_nfD) _nfD.call(BF.noti, _rm); } finish(null); };
        rd.readAsText(f);
      });
      inp.click();
    });
  }
  /* 报告：成功数取数据层确认值；失败逐条列明细（截断前 5 条）。
     label/reason 含动态导入文件内容
     （划线/书签/便签文本截断 20 字、生词 word 未截断、
     来源书书名/sourceBookId）——BF.modal.alert 的
     content 按 HTML 原样写入 innerHTML（仅 title 走
     BF.dom.esc），未转义即脚本注入。动态段全段
     必须 BF.dom.esc；
     lines.join('<br>') 的 '<br>' 是唯一有意 HTML，
     保留不转义。 */
  function showReceipt(rep, book) {
    if (!rep) return;
    const lines = [];
    if (rep.okCount) {
      lines.push('成功导入 ' + rep.okCount + ' 条（划线 ' + rep.ok.hl.length + ' · 书签 ' + rep.ok.bm.length + ' · 便签 ' + rep.ok.note.length + ' · 生词 ' + rep.ok.vocab.length + '）');
    }
    if (rep.failed && rep.failed.length) {
      lines.push('无法导入 ' + rep.failed.length + ' 条（未丢弃，明细）：');
      rep.failed.slice(0, 5).forEach(function (f) {
        lines.push('· ' + BF.dom.esc(f.label) + '：' + BF.dom.esc(f.reason));
      });
      if (rep.failed.length > 5) lines.push('…… 等 ' + rep.failed.length + ' 条');
      BF.modal.alert('标注导入回执《' + book.title + '》', lines.join('<br>'), { html: true });
    } else if (rep.okCount) {
      BF.noti.success('已导入 ' + rep.okCount + ' 条标注');
    } else {
      BF.noti.warn('文件不含可导入的 W3C 标注');
    }
  }
  return {
    buildW3C: buildW3C, parseW3C: parseW3C, locate: locate,
    ingest: ingest, exportAnnotations: exportAnnotations, importAnnotations: importAnnotations,
  };
})();

