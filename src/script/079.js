/* ============ R11.0b BF.hlc 轻量时钟 ============
   来源：Readest 的 HLC（Hybrid Logical Clock）。
   标注 ID 带时序：毫秒 base36 + 同毫秒 counter + deviceId，
   多标签/多设备合并时有确定的先后依据（不依赖系统时间一致）。
   北风单机场景下主要价值：标注 ID 全局唯一且可排序。 */
BF.hlc = (function () {
  var _last = 0, _counter = 0;
  /* 会话段每次加载重新生成：设备指纹跨标签共享、counter 又每页从 0 起，
     两个标签在同一毫秒各写第一条会算出同一个 id，合并写入按 id 去重就悄悄丢一条。 */
  var _session = Math.random().toString(36).slice(2, 6);
  var _device = '';
  try {
    /* 稳定的设备指纹：随机 + 时间，持久化到 LS（同浏览器跨会话稳定） */
    var _k = 'hlc_device';
    _device = BF.store ? BF.store.lsGet(_k, null) : null;
    if (!_device) { _device = Math.random().toString(36).slice(2, 8) + Date.now().toString(36).slice(-4); if (BF.store) BF.store.lsSet(_k, _device); }
  } catch (e) { _device = Math.random().toString(36).slice(2, 8); }
  function next() {
    var now = Date.now();
    if (now === _last) _counter++;
    else { _last = now; _counter = 0; }
    return _last.toString(36) + '-' + _counter.toString(36) + '-' + _device + '-' + _session;
  }
  return { next: next, device: _device };
})();

BF.reader.HL_COLORS = ['yellow', 'green', 'blue', 'pink'];
/* 写入前的最后一道校验：备份选区若指向的段落已不属于当前章（切章后状态泄漏、
   或经其他路径绕过 clearSelState），宁可拒绝写入也不落一条 text/loc 错配的脏标注。
   返回错误文案，由调用方转成提示。 */
BF.reader.__selGuard = function (text) {
  var L = BF.reader.__lastLoc;
  if (!L || typeof L.si !== 'number') return null;
  var paras = BF.reader.state.paras || [];
  if (L.si < 0 || L.si >= paras.length) return '选区所属段落已失效（可能已切换章节），请重新选中文字';
  var seg = String(paras[L.si] || '');
  if (typeof L.so === 'number' && L.so >= 0 && seg.slice(L.so, L.so + (text || '').length) !== text) {
    if (seg.indexOf(text || '') < 0) return '选区原文与当前段落不一致，请重新选中文字';
  }
  return null;
};
/* 选区起点 → 章内字符偏移，口径唯一（addNote / addBookmark 共用一份）。
   段前缀和 Σ(paras[i].length+1) 只在 BF.cfi.locToOffset 内部。
   虚拟化（>2000 段）下 wrap 内只渲染窗口段，按 data-vi 段索引累计；
   非虚拟化不得用 wrap 全文 DOM Range 测量——含 h2 标题等 wrap 内非段落文本、
   不计段间换行，与段口径分歧（同一位置会差出标题字数）。
   依次：data-vi 段 → __lastLoc（positionSel 时 BF.cfi.locOfRange 算出的精确段定位）
   → 段元素文本匹配段索引 → 全文测量（历史兼容兜底）。 */
BF.reader.__charOffsetFromRange = function (range) {
  const wrap = document.getElementById('reader-wrap');
  if (!wrap || !range) return null;
  const paras = BF.reader.state.paras || [];
  const innerOf = function (el) {
    const pre = document.createRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.startContainer, range.startOffset);
    return pre.toString().length;
  };
  const virt = wrap.querySelector('.reader-virt');
  const viEl = range.startContainer && range.startContainer.parentElement && range.startContainer.parentElement.closest
    ? range.startContainer.parentElement.closest('[data-vi]') : null;
  if (virt && viEl) {
    const vi = parseInt(viEl.getAttribute('data-vi'), 10);
    if (isNaN(vi)) return null;
    return BF.cfi.locToOffset({ si: vi, so: innerOf(viEl) }, paras);
  }
  const _L = BF.reader.__lastLoc;
  if (_L && typeof _L.si === 'number' && _L.si >= 0 && _L.si < paras.length && typeof _L.so === 'number') {
    return BF.cfi.locToOffset({ si: _L.si, so: _L.so }, paras);
  }
  const paraEl = range.startContainer && range.startContainer.parentElement && range.startContainer.parentElement.closest
    ? range.startContainer.parentElement.closest('p') : null;
  if (paraEl) {
    const inner = innerOf(paraEl);
    const paraText = paraEl.textContent;
    for (let pi = 0; pi < paras.length; pi++) {
      if (paras[pi] === paraText) return BF.cfi.locToOffset({ si: pi, so: inner }, paras);
    }
  }
  const pre = document.createRange();
  pre.selectNodeContents(wrap);
  pre.setEnd(range.startContainer, range.startOffset);
  return pre.toString().length;
};

BF.reader.addNote = function (type) {
  /* 优先用备份选区（__lastRange），实时选区只在没有备份时兜底。
     前置不满足给明确提示，不静默 return。 */
  const s = window.getSelection();
  const useRange = BF.reader.__lastRange || (s && s.rangeCount ? s.getRangeAt(0) : null);
  const t = BF.reader.__lastSelText || (s ? s.toString().trim() : '');
  if (!t) { BF.noti.warn('请先选中正文文字'); return; }
  if (!BF.appState.currentBookId) { BF.noti.warn('请先打开一本书'); return; }
  var _guardErr = BF.reader.__selGuard(t);
  if (_guardErr) { BF.noti.warn(_guardErr); BF.reader.clearSelState(); return; }
  /* 偏移计算统一走 __charOffsetFromRange（口径与虚拟化/非虚拟化两路同源，见该 helper 注释） */
  const charOffset = useRange ? BF.reader.__charOffsetFromRange(useRange) : null;
  var _savedColor = BF.settings.get('hlLastColor') || '';
  const color = BF.reader.HL_COLORS.indexOf(_savedColor) >= 0 ? _savedColor : BF.reader.HL_COLORS[0];
  try { BF.settings.set('hlLastColor', color); } catch(e) {}
  /* 标注 ID 用 HLC（毫秒+counter+device），全局唯一且可排序 */
  const id = 'hl_' + BF.hlc.next();
  /* 划线带上 sid 与章内偏移。
     sid 让这条划线在书被重新分章后仍能按内容找回正确的章（按 sid 重映射依赖它）。
     口径与存储侧一致：currentSid 内部取的是本章真实正文（getChapterText），
     与 __putChapters 存的 c.content 同源，故算出的 sid 与库里对得上。
     算不出时存 ''（不是 undefined）——'' 是「已知取不到」的合法空值，
     惰性补写通路会填上；undefined 会变成脏数据且让 sidIndex 键值不可预期。

     刻意**保持本函数同步**（不改 async）：currentSid 是 async，但
     ① cfi-roundtrip 基座按「各创建函数定义行的字面量」切片取源码，改 async 会
        让锚点失配、切片塌陷，基座直接破；
     ② 用户点「划线」必须**立刻看到套色**，任何 await 都会拖慢反馈。
     故这里同步落盘（sid 暂缺），再异步补写 —— 与惰性补写同一条
     通路，**不留 [object Promise]**（漏 await 的最坏后果由此被结构性规避）。 */
  const hl = {
    id, bookId: BF.appState.currentBookId,
    chapterIdx: BF.appState.currentChapterIdx,
    text: t, type: type || 'underline', color,
    charOffset, created: Date.now(),
    /* 统一定位（段索引+段内偏移+文本/前后文）。旧数据无此字段，迁移时补。 */
    loc: BF.reader.__lastLoc || null,
    sid: '',
    gOffset: (typeof charOffset === 'number' ? charOffset : null),
  };
  BF.reader.__backfillSid(BF.store.K.HIGHLIGHTS, hl);
  /* 双标签页竞态：读-改-写不得全程用同一快照——两标签页几乎同时划线时，
     后写方会全量覆盖先写方，先写方的划线静默
     丢失（localStorage 的互斥粒度是单次操作，
     读与写之间可被另一标签页的写入插入，无
     原生 CAS 指令）。故写入前重读最新态：
     按 id 合并（并集；同 id 以本条为准——同
     位置重划覆盖旧划线），另一标签页在窗口内
     新增的条目保留并明示，不静默合并、双方
     均不谎报。重读-合并-写把竞态窗口收敛到
     相邻两次同步调用之间（微秒级），为浏览器
     存储模型下的最紧界。

     「写前重读」仍漏同毫秒并发——
     两页在同一个 tick 内各自读完同一份旧值，_ext 都是空，
     各自全量覆盖对方的写入，先写方照样丢，且因为 _ext 为空
     连提示都不触发，违背不静默纪律。localStorage 没有跨页
     CAS 指令，读-改-写之间永远留一条缝，靠"读得更勤"补不上。
     因此必须写后二次校验 + 检出并发就合并重写（有界重试）：
     写完把存储重读一遍，看当次之外的条目是否比自己写进去时
     多了别的页的新增——有就是并发的另一方，把它的条目纳入
     再写一次，并明示"检测到其他标签页同时划线，已合并"。
     两条边界：① 本页自己的既有条目与本条不算并发，只有"陌生
     的新条目"才算；② 重试有上界（MAX_ATT），连续对撞就用
     最后一版落盘并如实提示，不无限循环。 */
  const _HL_MERGE_MAX = 4;
  let _hlExtCount = 0;      /* 当次划线需提示的他页条目数 */
  let _hlSaved = false;     /* 写后校验：本条是否真在库里 */
  let _hlQuotaToasted = false; /* 本次写入是否已由存储层弹过配额提示 */
  {
    let attempts = 0;
    const seen = new Set();      /* 当次划线已并入/已确认存在的条目 id */
    const commit = function () {
      const latest = BF.store.lsGetArray(BF.store.K.HIGHLIGHTS, []);
      latest.forEach(function (x) { if (x && x.id) seen.add(x.id); });
      seen.add(hl.id);
      const merged = latest.filter(function (x) { return x && x.id !== hl.id; });
      merged.push(hl);
      /* 存储层写失败且这一失败是它本条失败序列的第一次时，会弹一次配额提示；
         这里记下来，避免后面再补第二条——一次操作只许一条提示。 */
      const _qBefore = BF.store.__quotaNotified === true;
      if (!BF.store.setCritical(BF.store.K.HIGHLIGHTS, merged, '划线') && !_qBefore) _hlQuotaToasted = true;
    };
    /* 写后校验：重读存储，若除本条与已见条目外还多了陌生条目，
       说明期间有并发的另一页写入 → 合并重写一次（有界）。
       能兜住的：另一页的写入在本条落盘之后、校验之前（或校验重试
       期间）仍留在存储里的情形——这是同毫秒并发里最常见的一种，
       合并后双方条目都在，提示也随之触发，不静默。
       兜不住、如实说明的边界：另一页若在本条落盘之后又写了一次、
       把本条整份覆盖且不留痕迹，校验读到的是"只剩对方那一份"，
       此时本条的内容已无来源可捞——localStorage 跨页没有 CAS
       指令，纯前端无法在覆盖发生的同时留痕。可靠的根治要走
       后端或让两页经同一中枢串行写入（BF.store.mutate 只在
       单页内串行，跨页无效）。这里把重试次数封顶（_HL_MERGE_MAX），
       连续对撞就以最后一版落盘，不无限循环、也不谎报。 */
    /* 划线前先给已有条目拍一张快照（必须在第一次 commit 之前取，
       否则把自己刚写进去的那条也算成「他页新增」） */
    const _beforeIds = new Set(BF.store.lsGetArray(BF.store.K.HIGHLIGHTS, [])
      .map(function (x) { return x && x.id; }).filter(Boolean));
    commit();
    while (attempts < _HL_MERGE_MAX) {
      const after = BF.store.lsGetArray(BF.store.K.HIGHLIGHTS, []);
      /* 写后校验顺带确认「本条确实在库里」：setCritical 的返回值在 commit 里没接，
         配额满时它只弹底层的存储不足提示、不回滚页面上刚套上的颜色。 */
      _hlSaved = after.some(function (x) { return x && x.id === hl.id; });
      const foreign = after.filter(function (x) { return x && x.id && x.id !== hl.id && !seen.has(x.id); });
      if (!foreign.length) break;
      attempts++;
      commit();   /* 把 foreign 并进去重写；commit 内会把它们记入 seen */
    }
    /* 提示数只算「这期间冒出来的陌生条目」：先记下划线之前存储里已有的 id，
       最终存储里不在这个集合、又不是本条的，才是真的并发新增。
       原来按「除本条外全部」计数，把早就存在的本标签页条目也算成他页新增，
       一个人单机划线必现「其他标签页新增 N 条」的假提示。 */
    const after = BF.store.lsGetArray(BF.store.K.HIGHLIGHTS, []);
    _hlExtCount = after.filter(function (x) { return x && x.id && x.id !== hl.id && !_beforeIds.has(x.id); }).length;
  }
  if (_hlExtCount) BF.noti.info('其他标签页新增 ' + _hlExtCount + ' 条划线，已合并保留');
  /* 事件总线扩面：标注变更广播，供标注中心/多标签同步/AI 上下文刷新订阅 */
  try { if (BF.bus) BF.bus.emit(BF.EVENTS.ANNOTATION, { bookId: BF.appState.currentBookId, id: id, action: 'add' }); } catch (e) {}
  /* 套色结果必须验证 —— surroundContents 在选区跨
     元素边界时抛异常，若 catch 吞掉异常后仍弹「已划线」，
     就是正文无颜色却报成功。数据层（划线落库 setCritical）
     已确认，但「已划线」承诺的是可见套色，套色失败时必须
     降级文案，不谎报。 */
  let painted = false;
  try {
    if (useRange) {
      const span = document.createElement('span');
      /* 与 applyHighlights 的 clsOf 同一套映射 */
      span.className = type === 'wavy' ? 'note-wavy'
        : type === 'bg' ? ((color === 'green' || color === 'blue' || color === 'pink') ? ('pk-hl-' + color) : 'note-bg')
        : 'pk-hl-' + color;
      useRange.surroundContents(span);
      painted = true;
    }
  } catch (e) {}
  /* 不再 removeAllRanges 清空选区——同一选区可连续施加
     书签/划线/生词多个标注；划新词时 positionSel 覆盖备份。 */
  if (s && !BF.reader.__lastRange && s.rangeCount) { try { s.removeAllRanges(); } catch (e) {} }
  BF.reader.hideSel();
  BF.reader.refreshDrawer();
  /* 套色未生效时降级 —— 划线数据已落库
     （setCritical 已确认），但「已划线」承诺的可见
     套色未达成，成功文案与界面不符，不谎报。 */
  /* 「已划线」承诺两件事：落库 + 看得见的颜色。落库没成就不能报成功——
     页面上的颜色是当场套的，重开这本书会消失。
     落库失败时只许一条提示：存储层已弹过配额提示（本条失败序列的
     第一次失败）就不再补，只补存储层没说到的情形（写入被并发覆盖、
     或本轮配额提示已由更早的失败说过）。 */
  if (!_hlSaved) {
    if (!_hlQuotaToasted) BF.noti.warn('这条划线没有存进书库（存储空间不足）：页面上看到的颜色是临时的，重开这本书就没了');
  }
  else if (painted) BF.noti.success('已划线');
  else BF.noti.warn('划线已保存，但正文套色失败（选区跨元素边界），请重新划线');
  /* 标注变更广播到其他标签页（书卡/抽屉同步），单通道走 BF.sync */
  try { if (BF.sync && BF.sync.broadcast) BF.sync.broadcast(BF.EVENTS.ANNOTATION); } catch (e) {}
};
/* 当前位置的段落定位（段号 + 段内偏移），给「位置书签」用。
   锚点取阅读区顶部第一条没被滚过去的段落，偏移记 0（段首）：
   按像素折算反而不稳——换字号、重排、换设备后同一像素会落到别的段里。
   虚拟化窗口里只渲染部分段 → 按 data-vi 认段；非虚拟化按元素文本对段。 */
BF.reader.__locAtScroll = function () {
  try {
    const wrap = document.getElementById('reader-wrap');
    const paras = BF.reader.state.paras || [];
    if (!wrap || !paras.length) return null;
    const padTop = parseFloat(getComputedStyle(wrap).paddingTop) || 0;
    const top = wrap.getBoundingClientRect().top + padTop;
    const els = wrap.querySelectorAll('[data-vi], p');
    let hit = null;
    for (let i = 0; i < els.length; i++) {
      if (els[i].getBoundingClientRect().bottom > top + 1) { hit = els[i]; break; }
    }
    if (!hit) return null;
    const vi = hit.getAttribute('data-vi');
    let si = vi == null ? -1 : parseInt(vi, 10);
    if (!(si >= 0 && si < paras.length)) {
      const txt = hit.textContent;
      for (let i = 0; i < paras.length; i++) { if (paras[i] === txt) { si = i; break; } }
    }
    if (!(si >= 0 && si < paras.length)) return null;
    return { si: si, so: 0 };
  } catch (e) { return null; }
};
BF.reader.addBookmark = function () {
  /* R2：只在阅读页写书签——离开阅读器后 currentBookId 不清，首页/书架按 Ctrl+D
     会把上一本书的过时选区写成脏书签，且夹在「无当前书」与「已添加」两个矛盾提示里。
     这里收口：非阅读页直接静默返回，由调用方（热键）决定是否提示。 */
  if (BF.appState.currentPage !== 'reader') return;
  /* 备份选区优先，前置不满足明确提示 */
  if (!BF.appState.currentBookId) { BF.noti.warn('请先打开一本书'); return; }
  const s = window.getSelection();
  const useRange = BF.reader.__lastRange || (s && s.rangeCount ? s.getRangeAt(0) : null);
  const t = BF.reader.__lastSelText || (s ? s.toString().trim() : '');
  /* 选区守卫三个标注入口都要有——addBookmark 若缺这道守卫，
     跨章后选区状态泄漏会把
     text/loc 错配的位置书签落到当前章。与
     addNote/addVocab 同一道守卫；空文本（位置书签）
     时守卫恒通过，不影响位置书签语义。 */
  var _guardErr = BF.reader.__selGuard(t);
  if (_guardErr) { BF.noti.warn(_guardErr); BF.reader.clearSelState(); return; }
  /* 偏移计算与 addNote 同源：__charOffsetFromRange（空文本位置书签不测） */
  const charOffset = (t && useRange) ? BF.reader.__charOffsetFromRange(useRange) : null;
  /* 走 BF.store.mergeWrite（与 addNote 同一套并发合并逻辑），获得写后校验
     + 检出并发即合并重写。keyOf 取本条 id——
     同一本书同一章同一位置可合法存在多条书签（addBookmark 无去重守卫），
     故必须分配唯一 id，不能拿 bookId|chapterIdx|charOffset 当唯一标识
     （那会把同位置的多条误判成重复而合并掉，导致数据丢失）。 */
  const _bmId = 'bm_' + (BF.hlc ? BF.hlc.next() : (Date.now() + '_' + Math.random().toString(36).slice(2, 8)));
  /* 书签带 sid / gOffset。
     刻意保持同步 + 异步补写（理由见 BF.reader.__backfillSid 注释）：
     改 async 会打断基座按各创建函数定义行字面量切片的取源方式。 */
  const bms = [];
  /* 位置书签（空选区）没有选区可换算：记下当前滚动锚点那一段。
     只记章号的书签点回去仍停在章首，与「最近阅读」没有区别。 */
  const _bmLoc = BF.reader.__lastLoc || (t ? null : BF.reader.__locAtScroll());
  const _bmOff = (typeof charOffset === 'number') ? charOffset
    : (_bmLoc ? BF.cfi.locToOffset(_bmLoc, BF.reader.state.paras || []) : null);
  bms.push({
    id: _bmId,
    bookId: BF.appState.currentBookId,
    chapterIdx: BF.appState.currentChapterIdx,
    text: t || null, charOffset: (typeof _bmOff === 'number' ? _bmOff : null), created: Date.now(),
    /* 统一定位（书签文本可为空=位置书签，loc 仍记录段位置） */
    loc: _bmLoc || null,
    sid: '',
    gOffset: (typeof _bmOff === 'number' ? _bmOff : null),
  });
  BF.reader.__backfillSid(BF.store.K.BOOKMARKS, bms[0]);
  const _bmRes = BF.store.mergeWrite(BF.store.K.BOOKMARKS, bms[0], function (x) { return x && x.id; }, '书签');
  /* 写失败到此为止：存储层已经用「存储空间不足，书签未能保存」说过一次，这里不重复提示，
     更不能接着报「已添加」——书签没进库，抽屉列表里也不会有它，两条提示互相打脸。 */
  if (!_bmRes || _bmRes.ok !== true) { BF.reader.hideSel(); return false; }
  if (_bmRes.ext > 0) BF.noti.info('检测到其他标签页同时添加书签，已合并保留');
  /* 保留选区可连续标注 */
  if (s && !BF.reader.__lastRange && s.rangeCount) { try { s.removeAllRanges(); } catch (e) {} }
  BF.reader.hideSel();
  BF.reader.refreshDrawer();
  BF.noti.success(t ? '书签已添加' : '位置书签已添加');
  /* 书签变更广播到其他标签页，单通道走 BF.sync */
  try { if (BF.sync && BF.sync.broadcast) BF.sync.broadcast(BF.EVENTS.ANNOTATION); } catch (e) {}
};
BF.reader.addVocab = function () {
  /* 备份选区优先，前置不满足明确提示 */
  const s = window.getSelection();
  const t = BF.reader.__lastSelText || (s ? s.toString().trim() : '');
  if (!t) { BF.noti.warn('请先选中正文文字'); return; }
  if (!BF.appState.currentBookId) { BF.noti.warn('请先打开一本书'); return; }
  var _guardErr = BF.reader.__selGuard(t);
  if (_guardErr) { BF.noti.warn(_guardErr); BF.reader.clearSelState(); return; }
  const vocab = BF.store.lsGetArray(BF.store.K.VOCAB, []);
  if (vocab.some(v => v.bookId === BF.appState.currentBookId && v.word === t)) {
    BF.noti.warn('该生词已收藏'); BF.reader.hideSel(); return;
  }
  /* 生词上下文：所在段落前后 40 字 */
  let ctx = '';
  try {
    const rm = document.getElementById('reader-main');
    if (rm) {
      const paras = rm.querySelectorAll('p');
      for (const p of paras) {
        const txt = p.textContent;
        const i = txt.indexOf(t);
        if (i >= 0) { ctx = txt.slice(Math.max(0, i - 40), Math.min(txt.length, i + t.length + 40)); break; }
      }
    }
  } catch (e) {}
  const _vcId = 'vc_' + (BF.hlc ? BF.hlc.next() : (Date.now() + '_' + Math.random().toString(36).slice(2, 8)));
  /* 生词必须写 charOffset 与 loc：缺了就只能按词搜段兜底 →
     同词多处时永远跳首次出现处（不是收藏处）。
     与书签/笔记同口径：用 __lastLoc 经 cfi.locToOffset 算章内偏移，并把 loc 写入。 */
  let _vcOffset = null;
  try {
    const _vcLoc = BF.reader.__lastLoc;
    if (_vcLoc && BF.cfi && typeof BF.cfi.locToOffset === 'function') {
      _vcOffset = BF.cfi.locToOffset(_vcLoc, (BF.reader.state && BF.reader.state.paras) || []);
    }
  } catch (e) {}
  /* 生词带 sid / gOffset（同步 + 异步补写，理由同 __backfillSid）。 */
  const _vcRec = {
    id: _vcId,
    bookId: BF.appState.currentBookId,
    word: t, chapterIdx: BF.appState.currentChapterIdx,
    ctx: ctx, created: Date.now(),
    sid: '',
    charOffset: _vcOffset,
    loc: BF.reader.__lastLoc || null,
    gOffset: (typeof _vcOffset === 'number' ? _vcOffset : null),
  };
  BF.reader.__backfillSid(BF.store.K.VOCAB, _vcRec);
  /* 走 mergeWrite 获得并发保护；keyOf 取 id（生词去重仍由上面的
     bookId+word 判定负责，那是既有行为，不改）。 */
  const _vcRes = BF.store.mergeWrite(BF.store.K.VOCAB, _vcRec, function (x) { return x && x.id; }, '生词');
  /* 与书签同一口径：写失败不重复提示、不报「已收藏」（见 addBookmark） */
  if (!_vcRes || _vcRes.ok !== true) { BF.reader.hideSel(); return false; }
  if (_vcRes.ext > 0) BF.noti.info('检测到其他标签页同时添加生词，已合并保留');
  /* 保留选区可连续标注 */
  if (s && !BF.reader.__lastRange && s.rangeCount) { try { s.removeAllRanges(); } catch (e) {} }
  BF.reader.hideSel();
  BF.reader.refreshDrawer();
  BF.noti.success('生词已收藏');
};
BF.reader.renderVocab = function (c) {
  const all = (BF.store.lsGetMemo(BF.store.K.VOCAB, []) || []).filter(x => x.bookId === BF.appState.currentBookId);
  if (!all.length) { c.innerHTML = '<div class="cmdk-empty">暂无生词（选中文字 → 工具条「生词」收藏）</div>'; return; }
  /* 生词记忆辅助：
     三档筛选（全部 / 只复习不认识 / 已掌握隐藏）+ 掌握状态（known/unknown/mastered）+ 复习可朗读。
     数据向后兼容：旧条目无 status 字段视为 unknown（未掌握）。 */
  let _mode = 'all';       /* all | unknown | known */
  let _idx = 0, _flipped = false;
  const wrap = document.createElement('div');
  wrap.className = 'vocab-wrap';
  const bar = document.createElement('div');
  bar.className = 'vocab-bar';
  bar.innerHTML =
    '<span style="font-size:11px;color:var(--text-weak)">复习模式：</span>' +
    '<button class="btn btn-xs" data-vm-all>全部</button>' +
    '<button class="btn btn-xs" data-vm-unknown>不认识</button>' +
    '<button class="btn btn-xs" data-vm-known>已掌握</button>' +
    '<button class="btn btn-xs" data-vm-export>导出 Anki</button>';
  const card = document.createElement('div');
  card.className = 'vocab-card';
  const info = document.createElement('div');
  info.className = 'vocab-info';
  const nav = document.createElement('div');
  nav.className = 'vocab-nav';
  function filtered() {
    const list = all.filter(function (v) {
      const st = v.status || 'unknown';
      if (_mode === 'unknown') return st === 'unknown';
      if (_mode === 'known') return st === 'known' || st === 'mastered';
      return true;
    });
    return list;
  }
  function persist(list) {
    try { BF.store.lsSet(BF.store.K.VOCAB, list); } catch (e) { BF.err.report('vocab.save', e); }
  }
  function setStatus(v, st) {
    const list = BF.store.lsGetArray(BF.store.K.VOCAB, []);
    const rec = list.find(function (x) { return x && x.bookId === v.bookId && x.word === v.word; });
    if (rec) { rec.status = st; rec.reviewedAt = Date.now(); persist(list); }
    /* 同步到当前工作数组（避免重读存储） */
    if (v) { v.status = st; v.reviewedAt = Date.now(); }
  }
  function render() {
    const list = filtered();
    if (!list.length) {
      card.innerHTML = '<div style="color:var(--text-weak);font-size:13px">该模式下暂无生词</div>';
      nav.innerHTML = '';
      info.textContent = '0 / 0';
      return;
    }
    if (_idx >= list.length) _idx = 0;
    const v = list[_idx];
    if (!v) return;
    const st = v.status || 'unknown';
    card.innerHTML = _flipped
      ? '<div style="font-size:15px;line-height:1.7;color:var(--text-dim)">「' + BF.dom.esc(v.word) + '」<br/><br/>出自 第' + ((v.chapterIdx || 0) + 1) + ' 章' + (v.ctx ? '<br/><span style="font-size:12px;color:var(--text-weak)">' + BF.dom.esc(v.ctx) + '</span>' : '') + '<br/><span style="font-size:11px;color:' + (st === 'mastered' ? 'var(--success-ink)' : 'var(--warning-ink)') + '">' + (st === 'mastered' ? '已掌握' : st === 'known' ? '认识' : '未掌握') + '</span>' + '<br/><span data-vocab-goto="' + BF.dom.escAttr(v.word) + '" data-vocab-goto-ch="' + ((v.chapterIdx || 0)) + '" style="font-size:12px;color:var(--accent-ink);cursor:pointer;text-decoration:underline">回到原文</span></div>'
      : '<div class="vocab-word" style="font-size:22px;font-weight:700;color:var(--text)">' + BF.dom.esc(v.word) + '</div><div style="font-size:12px;color:var(--text-weak);margin-top:8px">点击翻面</div>';
    info.textContent = (list.indexOf(v) + 1) + ' / ' + list.length + '（' + all.filter(function (x) { return (x.status || 'unknown') === 'unknown'; }).length + ' 未掌握）';
    nav.innerHTML = _flipped
      ? '<button class="btn btn-xs" data-vocab-known>认识</button><button class="btn btn-xs" data-vocab-unknown>不认识</button><button class="btn btn-xs" data-vocab-master>已掌握</button><button class="btn btn-xs" data-vocab-speak>朗读</button><button class="btn btn-xs danger" data-vocab-del>删除</button>'
      : '<button class="btn btn-xs" data-vocab-flip>翻面</button><button class="btn btn-xs" data-vocab-speak>朗读</button><button class="btn btn-xs danger" data-vocab-del>删除</button>';
    /* 卡片按钮以无值 data-*
       属性渲染（<button data-vocab-flip>）时，dataset.vocabFlip 为空字符串——falsy，
       若用 if (b.dataset.xxx) 门控则恒假、6 个按钮全死。
       必须用 hasAttribute 判断（属性存在即命中）。 */
    nav.querySelectorAll('button').forEach(function (b) {
      b.onclick = function () {
        if (b.hasAttribute('data-vocab-flip')) { _flipped = true; render(); return; }
        if (b.hasAttribute('data-vocab-speak')) { if (BF.tts && BF.tts.selSpeak) BF.tts.selSpeak(v.word); return; }
        if (b.hasAttribute('data-vocab-known')) { setStatus(v, 'known'); _flipped = false; _idx = (_idx + 1) % list.length; render(); return; }
        if (b.hasAttribute('data-vocab-unknown')) { setStatus(v, 'unknown'); _flipped = false; _idx = (_idx + 1) % list.length; render(); return; }
        if (b.hasAttribute('data-vocab-master')) { setStatus(v, 'mastered'); _flipped = false; _idx = (_idx + 1) % list.length; render(); return; }
        if (b.hasAttribute('data-vocab-del')) {
          /* 撤销登记走 BF.act.run（不走裸 BF.undo.push）—— 三个删除类动作
             （生词 / 划线 / 书签）共用同一条通道，失败也有人话反馈。 */
          const before = v;
          BF.act.run('删除生词', function () {
            BF.store.lsSet(BF.store.K.VOCAB, BF.store.lsGetArray(BF.store.K.VOCAB, []).filter(function (x) { return !(x.bookId === v.bookId && x.word === v.word); }));
            all.splice(all.indexOf(v), 1);
            if (!all.length) { c.innerHTML = '<div class="cmdk-empty">暂无生词。选中文字后点工具条「生词」收藏</div>'; return; }
            _idx = _idx % list.length;
            render();
          }, {
            undo: function () {
              const list = BF.store.lsGetArray(BF.store.K.VOCAB, []);
              if (!list.some(function (x) { return x && x.bookId === before.bookId && x.word === before.word; })) list.push(before);
              BF.store.lsSet(BF.store.K.VOCAB, list);
              BF.reader.refreshDrawer();
            },
          });
        }
      };
    });
  }
  /* 模式栏 4 按钮同为无值
     data-* 渲染，dataset 门控恒假会全死——与卡片
     6 键同源同修（hasAttribute）。 */
  bar.querySelectorAll('button').forEach(function (b) {
    b.onclick = function () {
      if (b.hasAttribute('data-vm-export')) { BF.reader.exportVocabAnki(); return; }
      if (b.hasAttribute('data-vm-all')) { _mode = 'all'; b.classList.add('primary'); bar.querySelector('[data-vm-unknown]').classList.remove('primary'); bar.querySelector('[data-vm-known]').classList.remove('primary'); }
      if (b.hasAttribute('data-vm-unknown')) { _mode = 'unknown'; b.classList.add('primary'); bar.querySelector('[data-vm-all]').classList.remove('primary'); bar.querySelector('[data-vm-known]').classList.remove('primary'); }
      if (b.hasAttribute('data-vm-known')) { _mode = 'known'; b.classList.add('primary'); bar.querySelector('[data-vm-all]').classList.remove('primary'); bar.querySelector('[data-vm-unknown]').classList.remove('primary'); }
      _idx = 0; _flipped = false; render();
    };
  });
  bar.querySelector('[data-vm-all]').classList.add('primary');
  wrap.appendChild(bar);
  wrap.appendChild(card);
  wrap.appendChild(info);
  wrap.appendChild(nav);
  c.innerHTML = '';
  c.appendChild(wrap);
  card.onclick = function () { _flipped = !_flipped; render(); };
  render();
};
/* 生词 Anki TSV 导出：生词是四类标注中
   唯一零出口、投入最深的一类；{word, ctx} 即
   front/back（ctx 是收藏时存的现成例句）。
   两列制表符分隔、无表头行——Anki「导入 →
   制表符分隔文本」直接吃；走 BF.exportBlob
   统一入口（TSV 不加 BOM：BOM 会污染首列 word）。
   空态：本书无生词时明确提示、不弹导出。 */
BF.reader.exportVocabAnki = function () {
  const bid = BF.appState.currentBookId;
  if (!bid) { BF.noti.warn('请先打开一本书'); return; }
  const b = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (x) { return x && x.id === bid; });
  const vocs = (BF.store.lsGetArray(BF.store.K.VOCAB, []) || []).filter(function (x) { return x && x.bookId === bid; });
  if (!vocs.length) { BF.noti.warn('本书还没有生词（选中文字 → 工具条「生词」收藏）'); return; }
  const title = b ? b.title : '生词';
  const lines = vocs.map(function (v) {
    return BF.exportBlob.tsvField(v.word) + '\t' + BF.exportBlob.tsvField(v.ctx || '');
  });
  /* 按 exportBlob 返回值门控：取消保存选择器时不弹成功 */
  BF.exportBlob(title + '_生词.tsv', lines.join('\n') + '\n', { mime: 'text/tab-separated-values;charset=utf-8' })
    .then(function (ok) { if (ok) BF.noti.success('生词已导出 Anki TSV：' + vocs.length + ' 条'); });
};
/* 标注中心（BF.marks 最小版）。
   聚合当前书的划线/书签/生词/便签为一条时间线，每条可「回到原文」/删除（删除走撤销栈）。
   不做存储结构迁移（标注模型统一是更大工程，须先有备份修复+迁移打底）。 */
BF.reader.renderMarks = function (c) {
  const bid = BF.appState.currentBookId;
  /* 书签渲染即迁移（与划线一致）。旧书签无 loc，用文本/偏移补定位，
     让「回到原文」精确。只补无 loc 的。
     历史书签一次性修正：旧格式 loc.after 含选中文本自身
     （after 以 text 开头）→ 用当前正文经 BF.cfi.fixLegacyLoc 重算。
     幂等定点：重算结果确定，跑两遍结果一致；新格式 after 不以 text
     开头，不受影响。 */
  /* 书签读收敛：一次渲染只 lsGet 一份。迁移路径保留 lsGet——它就地改对象并写回，
     拿 lsGetMemo 的共享引用会污染缓存；纯展示 filter 复用迁移读到的同一份数组
     （迁移块抛异常致 _bms 未赋值时才回退重读）。过滤产物是新数组，不改共享引用。 */
  let _bms = null;
  try {
    _bms = BF.store.lsGetArray(BF.store.K.BOOKMARKS, []) || [];
    const _paras = BF.reader.state.paras || [];
    let _chg = false;
    /* ① 无 loc 旧书签：文本/偏移回退补 loc（loc 构造走 makeLoc 唯一实现） */
    _bms.forEach(function (m) {
      if (!m || m.bookId !== bid || m.loc || !m.text || !_paras.length) return;
      const L = BF.cfi.locate({ text: m.text, charOffset: m.charOffset }, _paras);
      if (L && L.match) {
        m.loc = BF.cfi.makeLoc(L.si, L.so, m.text, _paras);
        _chg = true;
      }
    });
    /* ② 历史书签一次性修正：旧格式 loc 按当前段落重算（幂等） */
    _bms.forEach(function (m) {
      if (!m || m.bookId !== bid || !m.loc || !_paras.length) return;
      if (BF.cfi.fixLegacyLoc(m.loc, _paras)) _chg = true;
    });
    if (_chg) BF.store.setCritical(BF.store.K.BOOKMARKS, _bms, '书签');
  } catch (e) { BF.log && BF.log.warn('旧书签迁移失败：' + (e && e.message)); }
  /* 纯展示读走 lsGetMemo：同一次渲染反复开抽屉不必反复 JSON.parse */
  const books = BF.store.lsGetMemo(BF.store.K.BOOKS_META, []) || [];
  const b = books.find(function (x) { return x && x.id === bid; });
  if (!b) { c.innerHTML = '<div class="cmdk-empty">请先打开一本书</div>'; return; }
  const hls = (BF.store.lsGetMemo(BF.store.K.HIGHLIGHTS, []) || []).filter(function (x) { return x && x.bookId === bid; });
  const bms = (Array.isArray(_bms) ? _bms : (BF.store.lsGetArray(BF.store.K.BOOKMARKS, []) || [])).filter(function (x) { return x && x.bookId === bid; });
  const vocs = (BF.store.lsGetMemo(BF.store.K.VOCAB, []) || []).filter(function (x) { return x && x.bookId === bid; });
  const notes = (BF.store.lsGetMemo(BF.store.K.NOTES, []) || []).filter(function (x) { return x && x.bookId === bid; });
  const total = hls.length + bms.length + vocs.length + notes.length;
  /* 顶部小统计 */
  const stat = '<div style="font-size:11px;color:var(--text-weak);margin-bottom:8px;display:flex;gap:10px;flex-wrap:wrap">' +
    '<span>划线 <b style="color:var(--accent-ink)">' + hls.length + '</b></span>' +
    '<span>书签 <b style="color:var(--accent-ink)">' + bms.length + '</b></span>' +
    '<span>生词 <b style="color:var(--accent-ink)">' + vocs.length + '</b></span>' +
    '<span>便签 <b style="color:var(--accent-ink)">' + notes.length + '</b></span></div>';
  if (!total) { c.innerHTML = stat + '<div class="cmdk-empty">本书还没有留下标注（选中文字可划线 / 收藏生词）</div>'; return; }
  /* 聚合时间线（按 created 倒序） */
  const items = [];
  hls.forEach(function (h) { items.push({ t: h.created || 0, type: '划线', text: h.text || '', note: h.note || '', ch: h.chapterIdx, off: h.charOffset, id: h.id, kind: 'hl', loc: h.loc || null }); });
  bms.forEach(function (m) { items.push({ t: m.created || 0, type: '书签', text: m.text || '（位置书签）', ch: m.chapterIdx, off: m.charOffset, kind: 'bm', loc: m.loc || null }); });
  vocs.forEach(function (v) { items.push({ t: v.created || 0, type: '生词', text: v.word || '', ch: v.chapterIdx, kind: 'voc', loc: v.loc || null }); });
  notes.forEach(function (n) { items.push({ t: n.created || n.updated || 0, type: '便签', text: (n.title ? n.title + '：' : '') + (n.text || '').slice(0, 50), ch: n.chapterIdx, kind: 'note', id: n.id }); });
  items.sort(function (a, b2) { return (b2.t || 0) - (a.t || 0); });
  const rows = items.map(function (it, i) {
    const time = it.t ? new Date(it.t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    /* 章标签：无位置条目（W3C 导入 ingest 不落 chapterIdx）标「（未定位）」，
       与跨书聚合 annAcross 的 chLabel 同一语义；写成 (it.ch || 0) + 1
       会把无位置条目误呈「第1章」，「原文」按钮同样按 this.ch 是否为数字门控。 */
    const chLabel = (typeof it.ch === 'number')
      ? '第' + (it.ch + 1) + '章' : '（未定位）';
    const gotoBtn = (typeof it.ch === 'number')
      ? '<button class="btn btn-xs" data-marks-goto="' + i + '">原文</button>' : '';
    const delBtn = it.kind === 'hl'
      ? '<button class="btn btn-xs" data-marks-del-hl="' + BF.dom.escAttr(it.id) + '">删除</button>'
      : it.kind === 'bm' ? ''
      : it.kind === 'note' ? '<button class="btn btn-xs" data-marks-del-note="' + BF.dom.escAttr(it.id) + '">删除</button>'
      : '';
    /* 问 AI：标注出处随问书注入研读中心取材，回答下方附出处卡片可定位原文 */
    const askBtn = '<button class="btn btn-xs" data-marks-ask="' + i + '">问 AI</button>';
    return '<div style="padding:7px 8px;border:1px solid var(--border);border-radius:var(--r-sm);font-size:12px;margin-bottom:4px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">' +
      '<span style="color:var(--accent-ink);font-size:11px;flex-shrink:0">[' + it.type + ']</span>' +
      '<span style="color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + BF.dom.esc(it.text) + '</span>' +
      '<span style="display:flex;gap:4px;flex-shrink:0">' + gotoBtn + askBtn + delBtn + '</span></div>' +
      (it.note ? '<div style="color:var(--text-dim);margin-top:3px;font-size:11px">批注：' + BF.dom.esc(it.note) + '</div>' : '') +
      '<div style="color:var(--text-weak);font-size:10px;margin-top:2px">' + chLabel + (time ? ' · ' + time : '') + '</div></div>';
  }).join('');
  c.innerHTML = stat + '<div style="display:flex;flex-direction:column">' + rows + '</div>' +
    '<div style="font-size:11px;color:var(--text-weak);margin-top:6px">共 ' + total + ' 条标注</div>';
  /* 委托：跳原文 / 删除（复用既有 delNote/delBookmark + 便签删除） */
  c.querySelectorAll('[data-marks-goto]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const it = items[parseInt(btn.dataset.marksGoto, 10)];
      if (!it) return;
      BF.reader.closeDrawer();
      BF.reader.gotoChapter(it.ch);
      /* goto 优先用 loc（段定位，精确且抗重排）；loc 不可用时回退 charOffset/文本。 */
      if (it.loc && typeof it.loc.si === 'number') {
        BF.timers.timeout(function () {
          const paras = BF.reader.state.paras || [];
          if (!paras.length) return;
          const L = BF.cfi.locate(it.loc, paras);
          if (L && L.match && L.si >= 0) {
            const off = BF.cfi.locToOffset({ si: L.si, so: L.so }, paras);
            BF.reader.gotoCharOffset(off, { highlight: true, q: it.text || undefined });
          } else if (typeof it.off === 'number') {
            BF.reader.gotoCharOffset(it.off, { highlight: true });
          }
        }, 120);
      } else if (typeof it.off === 'number') {
        BF.timers.timeout(function () { BF.reader.gotoCharOffset(it.off, { highlight: true }); }, 120);
      } else if (it.kind === 'voc' && it.text) {
        BF.timers.timeout(function () {
          const paras = BF.reader.state.paras || [];
          for (let pi = 0; pi < paras.length; pi++) {
            const o = (paras[pi] || '').indexOf(it.text);
            if (o >= 0) { BF.reader.gotoCharOffset(BF.cfi.locToOffset({ si: pi, so: o }, paras), { highlight: true, q: it.text }); return; }
          }
        }, 120);
      }
    });
  });
  /* C11 委托：问 AI——写出处上下文 → 开研读中心
     （问书输入框预填），出处随问书注入 */
  c.querySelectorAll('[data-marks-ask]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const it = items[parseInt(btn.dataset.marksAsk, 10)];
      if (!it) return;
      BF.ai._annCtx = {
        bookId: bid, title: (b && b.title) || '',
        chapterIdx: typeof it.ch === 'number' ? it.ch : 0,
        text: it.text || '', note: it.note || '',
        charOffset: typeof it.off === 'number' ? it.off : null,
        loc: it.loc || null, kind: it.kind,
      };
      BF.reader.closeDrawer();
      BF.aiUI.open();
      const inp = document.getElementById('ai-ask-input');
      if (inp) {
        inp.value = '关于我在第' + ((typeof it.ch === 'number' ? it.ch : 0) + 1) + '章的这条标注：';
        inp.focus();
      }
      BF.noti.info('标注出处已随问书注入，回答下方附出处可定位原文');
    });
  });
  c.querySelectorAll('[data-marks-del-hl]').forEach(function (btn) {
    btn.addEventListener('click', function () { BF.reader.delNote(btn.dataset.marksDelHl); BF.reader.renderMarks(c); });
  });
  c.querySelectorAll('[data-marks-del-note]').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      /* 必须走 BF.notes.remove：它内含确认与撤销登记，绕过它删了就找不回 */
      if (BF.notes && BF.notes.remove && await BF.notes.remove(btn.dataset.marksDelNote)) BF.reader.renderMarks(c);
    });
  });
};

BF.reader.delNote = function (id) {
  /* 删除前备份原条目，撤销登记走 BF.act.run（与生词 / 书签同一通道）。
     before 取不到 = 这条划线已经不在表里，什么都没删成，就不传 undo。 */
  const before = BF.store.lsGetArray(BF.store.K.HIGHLIGHTS, []).find(function (x) { return x && x.id === id; });
  /* R2：按 id 而非整表 filter-then-set 走 mergeRemove，获得并发保护
     （另一页在读-改-写窗口内删/加时，本页不会把对方的改动整表覆盖）。
     before 仍在删除前取出，undo 链路不受影响。 */
  BF.act.run('删除划线', function () {
    BF.store.mergeRemove(BF.store.K.HIGHLIGHTS, id, function (x) { return x && x.id; }, '划线');
    /* 删一条划线与书架内容无关：renderBookshelf 会重建整个书架（几百本时明显卡顿，
       还重置滚动位置与选择态），只刷新抽屉即可，与 delBookmark 一致 */
    BF.reader.refreshDrawer();
    try { BF.reader.loadChapter(true); } catch (e) {}   /* 重绘正文以去掉划线样式 */
    try { BF.bus.emit(BF.EVENTS.ANNOTATION, { kind: 'note', action: 'del', id: id }); } catch (e) {}
  }, before ? {
    undo: function () {
      const list = BF.store.lsGetArray(BF.store.K.HIGHLIGHTS, []);
      if (!list.some(function (x) { return x && x.id === id; })) list.push(before);
      BF.store.setCritical(BF.store.K.HIGHLIGHTS, list, '划线');
      BF.reader.refreshDrawer();
      try { BF.reader.loadChapter(true); } catch (e) { BF.err.report('marks.undo.reload', e); }
    },
  } : {});
};
BF.reader.delBookmark = function (bi) {
  /* 撤销登记走 BF.act.run（与划线同一通道），不再有绕过通道的登记点。
     label 既当失败标题又当撤销吐司文案，所以用动作名「删除书签」而不是结果名
     「已删除书签」：动作失败时后者会当场变成一句假话。
     before 取不到 = 这条书签已经不在表里，什么都没删成，就不传 undo。 */
  const bms = BF.store.lsGetArray(BF.store.K.BOOKMARKS, []);
  const before = bms[bi] || null;
  /* 不能按数组下标 splice 删除：另一标签页在读-改-写窗口内插入一条，
     本页的 bi 就指向别人的记录，**删错书**。先按下标定位 before，
     再按 before 的唯一 key 删除。下标已失效（before 为 null，或存储里
     已无此 key）时回退 splice 路径。 */
  BF.act.run('删除书签', function () {
    if (before && before.id) {
      BF.store.mergeRemove(BF.store.K.BOOKMARKS, before.id, function (x) { return x && x.id; }, '书签');
    } else {
      bms.splice(bi, 1);
      BF.store.setCritical(BF.store.K.BOOKMARKS, bms, '书签');
    }
    BF.reader.refreshDrawer();
    try { BF.bus.emit(BF.EVENTS.ANNOTATION, { kind: 'bookmark', action: 'del', id: bi }); } catch (e) {}
  }, before ? {
    undo: function () {
      const list = BF.store.lsGetArray(BF.store.K.BOOKMARKS, []);
      const bi2 = Math.min(bi, list.length);
      list.splice(bi2, 0, before);
      BF.store.setCritical(BF.store.K.BOOKMARKS, list, '书签');
      BF.reader.refreshDrawer();
    },
  } : {});
};

