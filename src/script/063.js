/* ================= R2. 打开书籍 ================= */
BF.reader.openBook = async function (id) {
  /* 记下打开前的显示状态（书 + 章），供下方防闪清除判定——
     换书/换章时阅读器 DOM 里留着的是旧内容，见下方防闪说明。 */
  const _prevBook = BF.appState.currentBookId;
  const _prevCh = BF.appState.currentChapterIdx;
  const books = BF.library.mergeReadingState(BF.store.lsGetArray(BF.store.K.BOOKS_META, []));
  const b = books.find(x => x && x.id === id);
  if (!b) {
    if (BF.store.lsGet(BF.store.K.LAST_BOOK) === id) BF.store.lsSet(BF.store.K.LAST_BOOK, null);
    BF.noti.warn('书籍不存在，可能已被删除');
    return;
  }
  /* 开卷代际令牌。它必须是**独立的一条计数器**，不能借 state.gen：
     gen 是「章渲染」的世代号，loadChapter 一进门就 ++gen —— 开卷流程自己也要
     await loadChapter，若用同一个号，落地时必然与令牌不等，收尾整段（续读位置、
     「上次读到」提示、足迹记录）会被当成过期开卷跳过，每次开卷都会跳。
     openSeq 只由开卷入口自增，所以「被新的开卷取代」这条判据依然成立。 */
  const _myOpen = ++BF.reader.state.openSeq;
  BF.appState.currentBookId = id;
  /* 续读位置优先读轻量键 bf_reading_state；books_meta 旧字段作兜底（旧数据兼容） */
  const _rs = BF.store.lsGet(BF.store.K.READING_STATE, {}) || {};
  const _st = _rs[id] || {};
  BF.appState.currentChapterIdx = (typeof _st.currentChapter === 'number') ? _st.currentChapter : (b.currentChapter || 0);
  /* 伪章兜底。历史数据（导入时未剔除伪章 / 手动重置）可能停在
     第 0 章「正文」，该章内容为书名（极短无标点）。此时默认跳到第 1 章真实正文，
     避免用户打开书看到「正文/书名/本章完」误以为书是空的。
     注：章节标题在 IDB（getChapterTitles），须 await 拿到后才能判断。 */
  try {
    const _titles = (await BF.library.getChapterTitles(id)) || [];
    /* 文首信息块的缓存随书失效：不清就会把上一本的面板带到下一本
       （普通书的目录顶部凭空多出一条「文首信息块」，点开还是上一本的原文）。 */
    BF.reader.state.bookInfoText = '';
    BF.reader.state.bookInfoFor = '';
    BF.reader.state.__infoProbe = 0;
    if (_myOpen === BF.reader.state.openSeq) BF.reader.state.bookTitles = _titles;   /* 代际闸门，防并发开书书名串台 */
    const _t0 = _titles[0];
    const _isPseudo = BF.library.isPseudoHead(_t0, b && b.title);
    if (BF.appState.currentChapterIdx === 0 && _isPseudo && (b.totalChapters || _titles.length) > 1) {
      BF.appState.currentChapterIdx = 1;
    }
  } catch (e) { BF.err.report('open.pseudo', e); }
  if (_myOpen !== BF.reader.state.openSeq) return;  /* 开卷代际已更替，旧开卷退场 */
  /* 本次开卷给一次「空章自动前进」的额度：扉页/书名页这类零正文章，
     不该让用户停在一页空白上自己找按钮。只给打开这一刻，用户手动跳进空章仍走空态。 */
  BF.reader._emptySkip = id;
  /* 防闪：换书/换章先清掉阅读器里的陈旧正文。
     closeReader 不清 DOM，#reader-main 一直留着上一本书/上一章的内容；
     go('reader') 一切页它就可见（哪怕上一页是书架，DOM 也还在），
     随后要等 getChapterText 的 IDB 读回来才刷新——这几十到几百毫秒
     里用户看到的是陈旧章节（上次停在章首时即「闪首章」）。
     清除条件：阅读器确实渲染过（gen>0）且目标书/章与打开前显示的不同；
     同点重开（书目卡双击 / 续读停在原章）不清，避免无谓闪烁。
     页面不可见时同样执行（不可见、零成本）——目的是让 go('reader')
     之后的第一帧就是骨架而非陈旧内容。骨架复用书架同款 .skeleton
     shimmer（纯绘制动画，reduce-motion / prefers-reduced-motion 已降级）。 */
  try {
    const _rm0 = document.getElementById('reader-main');
    if (_rm0 && BF.reader.state.gen > 0 &&
        (_prevBook !== id || _prevCh !== BF.appState.currentChapterIdx)) {
      _rm0.innerHTML = '<h2>' + BF.dom.esc(b.title) + '</h2>' +
        '<div class="skeleton skeleton-row" style="width:94%"></div>' +
        '<div class="skeleton skeleton-row" style="width:98%"></div>' +
        '<div class="skeleton skeleton-row" style="width:88%"></div>' +
        '<div class="skeleton skeleton-row" style="width:96%"></div>' +
        '<div class="skeleton skeleton-row" style="width:52%"></div>';
      const _w0 = document.getElementById('reader-wrap');
      if (_w0) _w0.scrollTop = 0;   /* 骨架很短，旧 scrollTop 会被 clamp；显式归零更确定 */
    }
  } catch (e) { BF.err.report('openBook.clearStale', e); }
  BF.reader.clearPrefetch();   /* 换书：上一本的预取正文不驻留内存 */
  BF.store.lsSet(BF.store.K.LAST_BOOK, id);
  BF.app.go('reader');
  /* 微读模式持久化恢复：开启阅读器时按设置项恢复 microread class。
     退出阅读器不重置（class 留档）。 */
  {
    const _rp = document.getElementById('page-reader');
    if (BF.settings.get('microread') && _rp) {
      _rp.classList.add('microread');
    }
  }
  document.getElementById('reader-book-title').textContent = b.title;
  BF.reader.state.book = b;
  /* bookTitles 已在上面的伪章判定里 await 拿到并赋值，这里不再重读一次 IDB */
  /* 预取 sidIndex。
     为什么要预取：applyHighlights 是**同步渲染**，而 getSidIndex 是 async ——
     不预取就没法在同步渲染里判断「这条划线原本属于哪一章」。预取到
     state.sidIndex 后，渲染期只做一次同步查表，不引入任何 await、不拖慢划线。
     清空时机：换书时 openBook 每次都重新赋值（不跨书复用），故不会拿错书的映射。
     失败不阻断开书：catch 里留 warn 并置空表，渲染退回纯章号定位。 */
  BF.library.getSidIndex(id).then(function (m) { BF.reader.state.sidIndex = m || {}; })
    .catch(function (e) { BF.reader.state.sidIndex = {}; BF.log && BF.log.warn('章节 sid 索引预取失败，划线将按原章号定位：' + (e && e.message)); });
  await BF.reader.loadChapter(true);
  /* 这里只认「期间有没有新的开卷」：章渲染的 gen 在上面已经被 loadChapter
     自己推进过，拿它当开卷令牌会把每一次正常开卷都判成过期。 */
  if (_myOpen !== BF.reader.state.openSeq) return;
  if (!BF.reader.pageModeActive()) {
    const sv = BF.store.lsGet(BF.store.K.SCROLL_ + id, 0);
    const wrap = document.getElementById('reader-wrap');
    if (wrap) wrap.scrollTop = (typeof sv === 'number' && sv >= 0 && sv < 1e7) ? sv : 0;
  }
  /* F-08b：存取消句柄——切章时撤掉尚未触发的续读提示，
     否则开卷 400ms 内用户就切章，旧提示会在切章后才冒出来。 */
  try { if (BF.reader.state._resumeTipCancel) BF.reader.state._resumeTipCancel(); } catch (e) {}
  BF.reader.state._resumeTipCancel = BF.timers.timeout(function () {
    BF.reader.state._resumeTipCancel = null;
    BF.reader.showResumeTip(b);
  }, 400);
  if (BF.nav && BF.nav.record) BF.nav.record();
  if (BF.nav && BF.nav.updateButtons) BF.nav.updateButtons();
};

