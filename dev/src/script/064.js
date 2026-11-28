/* ================= R3. 三路径渲染 ================= */

/* ④ 章标题去重
   现象：<h2>第一章 XXX</h2> 之后，正文首段往往又是同一句标题，连着出现两遍。
   做法：正文首段与章标题做归一化比对（去空白 / 去标点 / 转小写），
   完全相同、或「以标题开头且余下 ≤6 字符」（如"第一章 北风起（上）"）则跳过首段。
   必须在 paras 落库之前统一处理：快路径 / 分片渲染 / 虚拟化 / 分页模式
   四条分支都读同一个 paras，改在源头才不会漏（长文 >2000 段走虚拟化，漏一处就复现）。 */
BF.reader.normTitle = function (s) {
  return String(s == null ? '' : s)
    .replace(/[\s\u3000]/g, '')                       // 空白（含全角空格）
    .replace(/[.,;:!?'"“”‘’()（）\[\]【】《》、，。；：！？·\-—_~～]/g, '')  // 中英标点
    .toLowerCase();
};
/* BF.reader.currentSid()：算出当前章的稳定 sid。

   本函数是整套 sid 通路最容易出错的地方，规则必须讲清楚：

   存储侧写 sid 时传的是 **stableSid(章标题, 章正文全文)**；
   若这里图省事传 state.paras[0]（首段），算出的 sid 与存储的对不上，
   整套重映射**全部失效且零报错**。三种典型情形：

     情形A 首段 ≥ 24 字            → 一致（凑巧能用）
     情形B 首段不足 24 字（短句）   → **不一致**（存储取的是首行+换行+次行）
     情形C 首段与标题重复、
            dropDupTitlePara 会 slice(1) → **不一致**（存的首行被剥掉了）

   B、C 都不是罕见场景（短句开头、txt 里标题重复抄写都真实存在）。
   故这里**取本章真实正文**（getChapterText，与 splitChapters 的 c.content
   同源同形态）后再算，实参与存储侧逐字一致。

   标题同理取 state.title —— 它来自 chapterTitles[idx]，
   与 __putChapters 存入的 c.title 同源。 */
BF.reader.currentSid = async function () {
  try {
    if (!(BF.cfi && BF.cfi.stableSid)) return '';
    const st = BF.reader.state || {};
    const book = st.book;
    if (!book || !book.id) return '';
    /* 当前章索引只在 BF.appState.currentChapterIdx；reader.state 无 chapterIdx，
       传 undefined → IDB 键 id_undefined → 取不到正文 → stableSid 恒 '' → 全链失效 */
    const content = await BF.library.getChapterText(book, BF.appState.currentChapterIdx);
    if (!content) return '';
    return BF.cfi.stableSid(st.title, content);
  } catch (e) { BF.err.report('currentSid', e); return ''; }
};
/* BF.reader.currentGOffset(loc)：当前章内偏移。
   直接复用 BF.cfi.locToOffset —— 与 offsetToLoc/locate 共用同一套段落
   基准，不另造一套换算（另造必然随段落结构调整而漂移）。
   本函数是**章内**偏移；要得到全书偏移还需叠加该章在全书中的起点，
   由 BF.cfi.chapterBase 提供。 */
BF.reader.currentGOffset = function (loc) {
  try {
    const paras = (BF.reader.state && BF.reader.state.paras) || [];
    if (!Array.isArray(loc)) return null;
    return BF.cfi.locToOffset(loc, paras);
  } catch (e) { BF.err.report('currentGOffset', e); return null; }
};

/* 标注 sid 的异步补写（三处创建共用同一通路）。
     为什么不让创建处直接 await currentSid()：
     ① currentSid 是 async，会把 addNote/addBookmark/addVocab 全变成 async ——
        这三个创建函数必须保持同步形态：外部按「各自的定义行字面量」切片取源码
        （例如以「addNote = function」这几个字作为锚点），改成 async 后锚点失配、
        indexOf 返回 -1、整段切片塌陷，依赖它的检查直接变红；
     ② 用户点「划线」时**必须立刻看到套色**，任何 await 都会让反馈变慢。
     故：标注同步落库（sid 暂为 ''），随后异步补写 sid、回填内存对象。
     效果与「await 后再存」等价，但**渲染零延迟、且结构性地不可能漏 await**
     （漏 await 会把 [object Promise] 写进 sid，这里根本不存在那个写法）。
     补写用 store.mutate 串行防竞态；失败留 warn，绝不静默。 */
BF.reader.__backfillSid = function (storeKey, rec) {
  try {
    if (!rec || !rec.id) return;
    BF.reader.currentSid().then(function (sid) {
      if (!sid) return;                       /* 算不出就不写，绝不写 undefined */
      BF.store.mutate(storeKey, function (arr) {
        /* forEach 内 `return arr` 只是从 forEach
           回调返回（无效），外层若恒 `return false`，mutate 把 false
           当作「显式放弃写回」，sid 从未落库，内存 rec 也因
           ok !== true 不回填——整条补写通路空转且零报错。
           正确写法：命中并改写才返回 arr（触发写回），未命中才 return false。 */
        let hit = false;
        (arr || []).forEach(function (x) { if (x && x.id === rec.id && !x.sid) { x.sid = sid; hit = true; } });
        return hit ? arr : false;             /* 本条不在库里（已被删）→ 不写回 */
      }).then(function (ok) {
        if (ok === true) rec.sid = sid;       /* 回填内存，当前会话不再补 */
      }).catch(function (e) { BF.log && BF.log.warn('补写标注 sid 失败：' + (e && e.message)); });
    }).catch(function (e) { BF.log && BF.log.warn('取当前章 sid 失败：' + (e && e.message)); });
  } catch (e) { BF.log && BF.log.warn('补写标注 sid 启动失败：' + (e && e.message)); }
};
/* 章标题的唯一取法：目录数组 → 开书时的标题快照 → 「第N章」兜底。
   渲染与搜索换算段落坐标时用同一个取法，标题去重才可能在两边同时生效或同时不生效。 */
BF.reader.chapterTitle = function (b, idx) {
  return (b && b.chapterTitles && b.chapterTitles[idx]) ||
    ((BF.reader.state.bookTitles || [])[idx]) ||
    '第' + (idx + 1) + '章';
};
/* 章正文 → 段落数组：全库唯一派生点。阅读器渲染与搜索坐标换算都从这里走，
   派生规则各写一遍会随段落结构调整而漂移（空行、重复标题行两处最容易漏）。 */
BF.reader.toParas = function (text, title) {
  return BF.reader.dropDupTitlePara(
    String(text || '').split('\n').filter(function (p) { return p.trim(); }),
    title
  );
};
BF.reader.dropDupTitlePara = function (paras, title) {
  if (!Array.isArray(paras) || !paras.length) return paras;
  const t = BF.reader.normTitle(title);
  if (!t) return paras;
  const p0 = BF.reader.normTitle(paras[0]);
  if (!p0) return paras;
  if (p0 === t) return paras.slice(1);
  // 前缀重合：标题够长（≥4 字）且余下部分很短，视为同一句的变体
  if (t.length >= 4 && p0.indexOf(t) === 0 && p0.length - t.length <= 6) return paras.slice(1);
  return paras;
};

/* 章节元信息条（字数 / 约略阅读时长）。纯本地计算，零外部依赖。
   标注数需跨库查询，留待下一微步；此处先给「字数 + 时长」两信号。 */
BF.reader.chapMeta = function (paras) {
  try {
    const words = (paras || []).reduce(function (n, p) { return n + (p ? p.length : 0); }, 0);
    if (!words) return '';
    const mins = Math.max(1, Math.round(words / 300));
    return '<div class="chap-meta" aria-label="本章信息"><span>' + words + ' 字</span><span>约 ' + mins + ' 分钟</span></div>';
  } catch (e) { return ''; }
};
/* 章节装载收尾的唯一出口：快路径 / 分片 / 虚拟化 / 页模式四条渲染分支都必须调它。
   收尾写在函数尾部不算数——中途 return 的分支会整段跨过它，
   于是分片章（>600 段）与分页模式沿用上一章的字号行距、底栏剩余时间与阅读速度
   停在旧值、相邻章不预取。新增分支要么调这里，要么在分支内写明为什么这一章不需要收尾。 */
BF.reader._settleChapter = function (idx) {
  BF.reader.applyStyles();
  BF.reader._chapStart = Date.now();      /* 供阅读速度/剩余时间估算 */
  BF.reader._wpmStartSampler();            /* J：开启视口停留积分采样（切章重置） */
  BF.reader._chapDone = false;
  BF.reader.updateProgress();
  BF.reader.updateRemain();                /* 口径：按章剩余，不按页 */
  BF.reader.prefetch(idx + 1);
  BF.reader.prefetch(idx - 1);
};
BF.reader.loadChapter = async function (noFade) {
  if (!BF.appState.currentBookId) return;
  /* F-08：续读提示在开卷后 400ms 出现；用户一跳章它就该撤，
     否则「已到第 4 章还挂着上次读到 11 章，点击继续」压住正文。 */
  try { const _rt = document.getElementById('resume-tip'); if (_rt) _rt.classList.remove('show'); } catch (e) {}
  try { if (BF.reader.state._resumeTipCancel) { BF.reader.state._resumeTipCancel(); BF.reader.state._resumeTipCancel = null; } } catch (e) {}
  /* 稳定判据基线必须随章重置：__lastSavedScroll 若是全局单值，
     跨章/跨书沿用旧值会让新章第一次保存因「与旧基线差 ≥1px」被跳过，
     连续两本书交替读时基线互相污染 —— 表现为「章对、位置错」。
     置 null 后按「首次观察不落盘、下次起才判稳定」判定。 */
  BF.reader.__lastSavedScroll = null;
  const gen = ++BF.reader.state.gen;
  /* 换章先把上一章的虚拟化观察者与滚动监听摘掉：innerHTML 一换，它们观察的就是
     已脱离文档的节点；滚动监听还留在 wrap 上，只有下次滚动才会发现 gen 过期。 */
  try { if (BF.reader._virtOff) { BF.reader._virtOff(); BF.reader._virtOff = null; } } catch (e) {}
  const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
  const b = books.find(x => x && x.id === BF.appState.currentBookId);
  if (!b) return;
  BF.reader.state.book = b;
  const idx = BF.appState.currentChapterIdx;
  const text = await BF.library.getChapterText(b, idx);
  if (gen !== BF.reader.state.gen) return;   // 世代号
  /* 本章正文回填同一份 LRU：currentSid、标注补写、抽屉都要再读这一章，
     回填后它们命中内存（实测一次 currentSid 由 16.8ms 的 IDB 读降到 0.9ms）。 */
  BF.reader.__prefetchPut(b.id + '_' + idx, text);
  BF.reader.state.title = BF.reader.chapterTitle(b, idx);
  const rm = document.getElementById('reader-main');
  if (!rm) return;
  if (!noFade && !BF.settings.get('reduceMotion') && !matchMedia('(prefers-reduced-motion: reduce)').matches && !BF.reader.pageModeActive()) {
    rm.classList.remove('pk-flip-fade');
    void rm.offsetWidth;
    rm.classList.add('pk-flip-fade');
  }
  /* 图片章（CBZ）：取到的不是文本，是这一图片的 dataURL。单开一条渲染路——
     再往下走 toParas 会把几十万字符的 base64 当成一个段落，字数、进度、
     空章判定、搜索坐标全被它带偏。收尾仍走 _settleChapter，与文本四条分支同口径。 */
  if (b.img) {
    BF.reader.state.paras = [];
    BF.reader.state.parasChars = 0;
    const _pn = (BF.reader.state.bookTitles && BF.reader.state.bookTitles.length) || b.totalChapters || idx + 1;
    const _meta = '<div class="chap-meta" aria-label="本页信息"><span>第 ' + (idx + 1) + ' / ' + _pn + ' 页</span></div>';
    if (text) {
      rm.innerHTML = '<h2>' + BF.dom.esc(BF.reader.state.title) + '</h2>' + _meta +
        '<div class="img-chap"><img class="img-chap__img" alt="' + BF.dom.esc(BF.reader.state.title) + '"></div>';
      const _im = rm.querySelector('.img-chap__img');
      if (_im) _im.src = text;
    } else {
      rm.innerHTML = '<h2>' + BF.dom.esc(BF.reader.state.title) + '</h2>' + _meta +
        '<div class="rd-blank" role="status">' +
        '<div class="rd-blank__icon" aria-hidden="true">◇</div>' +
        '<p class="rd-blank__msg">这一图片读取失败</p>' +
        '<p class="rd-blank__hint">可尝试重新导入这本书。</p>' +
        '</div>';
    }
    BF.reader._settleChapter(idx);
    return;
  }
  const paras = BF.reader.toParas(text, BF.reader.state.title);
  BF.reader.state.paras = paras;
  /* 整章字符数开章算一次存缓存：进度/剩余时间两处若每帧 join('') 会重造数 MB 串 */
  /* 空章/异常分章会得到 paras=[]，reduce 无元素时返回初值 -1，下游 !=null 判空会采信负值。空章应为 0。 */
  BF.reader.state.parasChars = paras.length ? paras.reduce(function (n, p) { return n + p.length + 1; }, -1) : 0;
  /* 空/错状态。
     「打开书但正文取不到」若不作提示，本页只渲染 <h2> + 「本章完」，
     中间 600px 空白且零报错 —— 用户明明有这本书却看到空页，页面什么都不说。
     真实触发场景不止导入异常：
       ① 章节 IDB 读取抛错（BF.library.getChapterText 已 catch 并上报，静默返回 ''）
       ② 分章器把整章切成 0 段（标题行异常 / 正则不匹配）
       ③ 去重把首段吃掉后剩 0 段（dropDupTitlePara 的 slice(1) 极端情况）
     插在 paras 落库之后、四条渲染分支之前 —— 分页模式也会先经过这里，
     故 ①②③ 三种情况在整章滚动 / 分片 / 虚拟化 / 分页四条路径下都不会漏。
     仍按 ①/③ 与 ② 两种措辞区分：前者有章节可指，后者是全书最后一章。 */
  if (!paras.length) {
    const isLast = idx >= (b.totalChapters || 1) - 1;
    /* 空章自动前进一次（口径：只前进，不动 isPseudoHead 判据——
       放宽判据的代价是可能把真首章跳掉，B19 已经吃过一次）。
       额度在 openBook 里发，用掉即收，连续空章不会递归跳。 */
    if (!isLast && BF.reader._emptySkip === b.id) {
      BF.reader._emptySkip = null;
      BF.log.info('本章无正文（多半是扉页/书名页），已自动跳到下一章');
      try { BF.noti.info('这一章没有正文（多半是扉页），已自动跳到下一章'); } catch (e) {}
      BF.reader.gotoChapter(idx + 1);
      return;
    }
    rm.innerHTML = '<h2>' + BF.dom.esc(BF.reader.state.title) + '</h2>' +
      '<div class="rd-blank" role="status">' +
      '<div class="rd-blank__icon" aria-hidden="true">◇</div>' +
      '<p class="rd-blank__msg">' +
      (text ? '本章正文为空' : '本章内容读取失败') + '</p>' +
      '<p class="rd-blank__hint">' +
      (isLast ? '这是最后一章。' : '可尝试重新导入，或跳到下一章。') +
      '</p>' +
      (isLast ? '' : '<button class="btn btn-sm rd-blank__act" data-next-chapter>跳到下一章</button>' +
       (text ? '' : '<button class="btn btn-sm rd-blank__act" data-reimport-book style="margin-left:6px">重新导入</button>')) +
      '</div>';
    /* 空章同样要走收尾：否则底栏的剩余时间与进度还停在上一章的数字上。 */
    BF.reader._settleChapter(idx);
    return;
  }
  /* 分页模式接线：开书 / 切章也必须走 renderPageMode（只在设置项 change 时调用一次不够）,
     否则「分页」模式形同虚设且 pkPages 与当前章脱钩 */
  if (BF.reader.pageModeActive()) {
    BF.reader.applyStyles();     /* 先排版再测量：renderPageMode 按当前字号行距切页，收尾里那次是幂等重申 */
    BF.reader.renderPageMode();
    BF.reader._settleChapter(idx);
    return;
  }
  const ec = (BF.settings.get('chapterEndContinue') && idx < (b.totalChapters || 1) - 1)
    ? '<div class="chapter-end">—— 本章完 ——<span class="next-chap" data-next-chapter>下一章：' + BF.dom.esc(BF.reader.state.title === '第' + (idx + 1) + '章' ? '下一章' : BF.reader.state.bookTitles[idx + 1] || '下一章') + '</span></div>'
    : '';

  if (paras.length <= 600) {
    /* 快路径 */
    const _meta = BF.reader.chapMeta(paras);
    rm.innerHTML = '<h2>' + BF.dom.esc(BF.reader.state.title) + '</h2>' + _meta +
      paras.map(p => '<p>' + BF.dom.esc(p) + '</p>').join('') + ec;
    BF.reader.applyHighlights();
  } else if (paras.length <= 2000) {
    /* 分片渲染：300 段/批 rAF */
    /* 非虚拟化路径无真实前缀和——清 _virtTop（gotoCharOffset 回退 _estH 估算）；
       并写入 _estH 真实排版参数。_estH 必须按当前排版设置赋值，否则跳转估算
       恒回退 40px/段，与真实排版偏离。 */
    BF.reader._virtTop = null;
    BF.reader._estH = (Number(BF.prefs.resolve(BF.appState.currentBookId, 'fontSize', BF.settings.get('fontSize'))) || 16) *
      ((BF.settings.num('lineHeight', 1.9)) + (BF.settings.num('paraSpacing', 1)));
    rm.innerHTML = '<h2>' + BF.dom.esc(BF.reader.state.title) + '</h2>' + BF.reader.chapMeta(paras);
    let pi = 0;
    /* loadChapter 的承诺在「最后一批落页」才解析。若在 requestAnimationFrame(flush)
       后当即返回，DOM 里只有 <h2> + 章信息——openBook 随后的 wrap.scrollTop = 存档
       位置会被尚小的 scrollHeight 截断（clamp 到接近 0），表现为「闪一下章首、
       然后停在错误位置」：分片路径（600–2000 段）必现。把 flush 链收尾接进承诺，
       调用方 await 到内容齐再定位。
       世代过期与异常都必须解析承诺：前者（切章竞态）让调用方永久
       挂起，比不定位更糟；后者（rAF 链被异常打断）同理。 */
    let _done = null;
    const _doneP = new Promise(function (res) { _done = res; });
    let _settled = false;
    const settle = function () { if (!_settled) { _settled = true; if (_done) _done(); } };
    const flush = function () {
      if (gen !== BF.reader.state.gen) { settle(); return; }
      try {
        const frag = document.createDocumentFragment();
        for (let n = 0; n < 300 && pi < paras.length; n++, pi++) {
          const p = document.createElement('p');
          p.textContent = paras[pi];
          frag.appendChild(p);
        }
        rm.appendChild(frag);
        if (pi < paras.length) requestAnimationFrame(flush);
        else { rm.insertAdjacentHTML('beforeend', ec); BF.reader.applyHighlights(); try { BF.reader.markEnLang(rm); } catch (e0) { BF.err.report('reader.markEnLang', e0); } BF.reader._settleChapter(idx); settle(); }
      } catch (e) {
        BF.err.report('reader.flush', e);
        BF.reader._settleChapter(idx);   /* 渲染断在半路也要收尾：按已渲染出来的部分算进度与剩余时间 */
        settle();   /* 链断不挂承诺：调用方按当前已渲染内容定位 */
      }
    };
    requestAnimationFrame(flush);
    /* 安全网：标签页隐藏时 rAF 不触发，承诺挂起会让 openBook 的滚动
       恢复与 gotoChapter 的收尾永不执行。2s 远超任何真实分批（300 段/帧，
       2000 段 = 7 帧 ≈ 120ms）；超时也只放行定位，内容仍由 rAF 链自行
       补全（世代过期自然被守卫拦下）。 */
    BF.timers.timeout(settle, 2000);
    return _doneP;
  } else {
    /* 虚拟化：>2000 段 */
    rm.innerHTML = '<h2>' + BF.dom.esc(BF.reader.state.title) + '</h2>' + BF.reader.chapMeta(paras) +
      '<div class="reader-virt" style="position:relative"></div>';
    const virt = rm.querySelector('.reader-virt');
    /* ResizeObserver 虚拟化（React Virtuoso / TanStack Virtual 同款机制：
       观察条目尺寸变化，而非每帧轮询 offsetHeight）：
       滚动路径只读真实前缀和（纯 JS 计算），窗口重建命中高度缓存时零
       offsetHeight 读取，避免每帧强制重排；
       字号/行距变化 → 段高变化 → RO 在布局后通知 → 前缀和重算 + 窗口
       重渲染，末段随真实高度落位不再被裁；
       gotoCharOffset 经 BF.reader._virtTop 按真实前缀和定位（用 vi*estH
       估算时，中文段落折行 3-6 行会严重偏离）。
       overflow-anchor 不启用（与自有 pre 表可能打架，定位唯一实现保持给 RO）。 */
    /* 估算段高随真实排版设置变化（字号×行距 + 段距），仅用于未测段外推 */
    /* 虚拟化估算随书字号 */
    const _vfs = Number(BF.prefs.resolve(BF.appState.currentBookId, 'fontSize', BF.settings.get('fontSize'))) || 16;
    const _vlh = BF.settings.num('lineHeight', 1.9);
    const _vps = BF.settings.num('paraSpacing', 1);
    const estH = _vfs * (_vlh + _vps);
    /* 段间距的像素值。虚拟化路径的段是「绝对定位 + 只给 top」，
       margin-bottom 对这种盒子不产生位移，段与段的实际距离只由前缀和决定；
       而 offsetHeight 量到的是不含 margin 的盒高。所以间距必须显式折进段高，
       否则 --rd-pmb 改了而长章纹丝不动。 */
    const _vgap = _vfs * _vps;
    /* 按真实高度 + 前缀和定位：若假设「每段恰好一行」并用 i*estH 绝对定位，
       中文段落折行 3-6 行时段落会层层压字重叠、容器高度严重低估。
       高度表由 RO 通知驱动——渲染后测量一次写入 heights，此后任何
       高度变化（改字号/字体加载/窗口缩放改变折行）由 ResizeObserver 增量
       通知，不再每帧读 offsetHeight。 */
    const heights = new Float64Array(paras.length);  /* 每段真实高度（0 = 未测） */
    const pre = new Float64Array(paras.length + 1);  /* 真实前缀和（pre[i] = 第 i 段顶部偏移） */
    /* 前缀和「尚未构建」即脏——懒重建的语义要求初值为 true：若初值为 false，
       闭包内除 topOf 的懒重建外没人会先置 true，首次 renderWindow 的 findStart(0)
       会读到全零前缀和——二分判定 topOf(mid+1)=0 <= 0 恒真 → lo 收敛到
       paras.length → 起点取末 4 段，首窗渲染的是「章尾 4 段」且 top 全为 0
       层层堆叠；rebuildPrefix 要到本帧测完高度才跑，此时窗口已选错。
       表现为：打开 >2000 段的章节，阅读区一片空白（4 段被排在
       11 万 px 容器底部），直到用户第一次滚动才恢复——首屏必现。 */
    let preDirty = true;
    const rebuildPrefix = function () {              /* O(n) 纯 JS 前缀和（零 DOM 布局读取） */
      let acc = 0;
      for (let i = 0; i < paras.length; i++) {
        pre[i] = acc;
        acc += heights[i] > 0 ? heights[i] : estH;   /* 未测段按估算外推，测得真实高度后逐步收敛 */
      }
      pre[paras.length] = acc;
      preDirty = false;
    };
    const topOf = function (i) {
      if (i <= 0) return 0;
      if (i > paras.length) i = paras.length;
      if (preDirty) rebuildPrefix();
      return pre[i];
    };
    const findStart = function (y) {                  /* 二分：按真实累计高度定位窗口起点 */
      let lo = 0, hi = paras.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (topOf(mid + 1) <= y) lo = mid + 1; else hi = mid;
      }
      return Math.max(0, lo - 4);
    };
    virt.style.height = (paras.length * estH) + 'px';
    virt.innerHTML = '<div class="virt-sizer" style="position:absolute;inset:0"></div>';
    const wrap = document.getElementById('reader-wrap');
    let rafPending = false;
    const hcache = new Map();                          /* vi → {key, h} 同排版参数高度缓存 */
    let _curHk = '';                                   /* 当前排版参数指纹（缓存键） */
    let roPending = false;
    let _lastStart = -1, _lastEnd = -1;                /* 上一帧的窗口范围 */
    let _hDirty = false;                               /* 段高被 RO 改写过 ⇒ 下一帧必须重算前缀和并重落位 */
    /* ResizeObserver：段高变化由浏览器在布局后批量通知（一次排版
       变更触发的多条通知合并为一次 rAF 重渲染）。RO 回调在布局后执行，
       读 contentRect 不强制额外重排。 */
    const ro = new ResizeObserver(function (entries) {
      if (gen !== BF.reader.state.gen) { try { ro.disconnect(); } catch (e) {} return; }
      let changed = false;
      for (let i = 0; i < entries.length; i++) {
        const en = entries[i];
        const t = en.target;
        if (!t || !t.getAttribute) continue;
        const vi = parseInt(t.getAttribute('data-vi'), 10);
        if (isNaN(vi) || vi < 0 || vi >= paras.length) continue;
        const h = en.contentRect ? en.contentRect.height : t.offsetHeight;
        /* 与 heights 比的是「盒高 + 段间距」，这里量到的是盒高 ⇒ 先加间距再比，
           否则每次 RO 回调都会认定数值不同、无限重排 */
        if (h > 0 && Math.abs((h + _vgap) - heights[vi]) > 0.5) {
          heights[vi] = h + _vgap;
          hcache.set(vi, { key: _curHk, h: h });
          changed = true;
        }
      }
      if (changed && !roPending) {
        roPending = true;
        _hDirty = true;
        requestAnimationFrame(function () {
          roPending = false;
          if (gen !== BF.reader.state.gen) return;
          rebuildPrefix();
          virt.style.height = pre[paras.length] + 'px';
          renderWindow();   /* 段高变了 → 窗口范围可能变 → 重渲染当前窗口 */
        });
      }
    });
    const renderWindow = function () {
      if (gen !== BF.reader.state.gen) { try { ro.disconnect(); } catch (e) {} try { wrap && wrap.removeEventListener('scroll', onScroll); } catch (e) {} return; }
      /* 窗口段落位：高度测量仅发生在缓存未命中（首次渲染或排版参数
         变更）——命中缓存时零 offsetHeight 读取（避免每帧强制重排）；
         未命中测量是一次性建立高度表（非轮询）。 */
      const vh = wrap ? wrap.clientHeight : 600;
      const st = wrap ? wrap.scrollTop : 0;
      const start = findStart(st);
      let end = start;
      const base = topOf(start);
      while (end < paras.length && (topOf(end) - base) < vh * 1.6 + 600) end++;
      end = Math.min(paras.length, end + 8);
      const pad = { narrow: 12, normal: 24, wide: 44 }[BF.settings.get('readerMargin')] || 24;
      _curHk = _vfs + '|' + _vlh + '|' + _vps + '|' + pad + '|' + (wrap ? wrap.clientWidth : 0);
      const sizer = virt.querySelector('.virt-sizer');
      if (!sizer) return;
      /* 滚动时大部分帧落在同一个窗口里（上下各留 1.6 屏 + 8 段余量）。
         窗口没动就别重建 DOM、别重挂观察：sizer.innerHTML 一assign，
         窗口内几十段 <p> 全拆全建，浏览器要把这棵子树重新布局一遍，
         而这正是每帧都在做的事。前缀和同理 —— rebuildPrefix 遍历整章段落，
         长章里每帧白付几万次加法，只有高度真的变了才值得算。 */
      const sameWindow = (start === _lastStart && end === _lastEnd);
      if (!sameWindow) {
        /* 换窗口意味着旧窗口的 <p> 全部 detach。ResizeObserver 对 target 持强引用、
           观察集只增不减，不先整表断开就会一路攒死节点（滚动越久留得越多）。
           下面按新窗口重新 observe；高度写在 heights/hcache 里，不依赖观察关系。 */
        ro.disconnect();
        let html = '';
        for (let i = start; i < end; i++) {
          html += '<p data-vi="' + i + '" style="position:absolute;top:' + topOf(i) + 'px;left:0;right:0;margin:0;padding:0 ' + pad + 'px">' + BF.dom.esc(paras[i]) + '</p>';
        }
        sizer.innerHTML = html;
      }
      /* 窗口段落位：高度测量仅发生在缓存未命中（首次渲染或排版参数
         变更）——命中缓存时零 offsetHeight 读取（避免每帧强制重排）；
         未命中测量是一次性建立高度表（非轮询）。 */
      const ps = sizer.children;
      let measured = false;
      for (let k = 0; k < ps.length; k++) {
        const p = ps[k];
        const vi = start + k;
        const c = hcache.get(vi);
        if (c && c.key === _curHk && c.h > 0) {
          const want = c.h + _vgap;                     /* 缓存命中：直接复用，不读布局（缓存存的是盒高，间距另加） */
          if (heights[vi] !== want) { heights[vi] = want; measured = true; }
        } else {
          const h = p.offsetHeight;                     /* 缓存未命中：一次性测量 */
          if (h > 0) {
            heights[vi] = h + _vgap;
            hcache.set(vi, { key: _curHk, h: h });
            measured = true;
          }
        }
        if (!sameWindow) ro.observe(p);
      }
      /* 段高由 RO 改写过（_hDirty）时也必须重算重落位：窗口范围没变，
         但每一段的 top 都变了，跳过就会叠在一起。 */
      if (measured || _hDirty || !sameWindow) {
        rebuildPrefix();
        for (let k = 0; k < ps.length; k++) ps[k].style.top = topOf(start + k) + 'px';
        virt.style.height = pre[paras.length] + 'px';
        _hDirty = false;
      }
      _lastStart = start; _lastEnd = end;
      BF.reader.applyHighlights();
      if (!sameWindow) { try { BF.reader.markEnLang(sizer); } catch (e0) { BF.err.report('reader.markEnLang.virt', e0); } }
      rafPending = false;
    };
    const onScroll = function () {
      if (gen !== BF.reader.state.gen) { try { ro.disconnect(); } catch (e) {} wrap.removeEventListener('scroll', onScroll); return; }
      BF.timers.rafFallthru(function () { return rafPending; }, function (v) { rafPending = v; }, renderWindow);
    };
    wrap.addEventListener('scroll', onScroll);
    /* 下一章开篇时统一收一次（见 loadChapter 开头的 _virtOff），不必等滚动才发现过期 */
    BF.reader._virtOff = function () { try { ro.disconnect(); } catch (e) {} try { wrap.removeEventListener('scroll', onScroll); } catch (e) {} };
    BF.reader._virtTop = topOf;                        /* 供 gotoCharOffset 真实前缀和定位 */
    requestAnimationFrame(renderWindow);
    setTimeout(function () {
      if (gen !== BF.reader.state.gen) return;
      virt.insertAdjacentHTML('beforeend', '<div style="position:absolute;top:' + topOf(paras.length) + 'px;left:0;right:0;text-align:center">' + ec + '</div>');
    }, 50);
  }
  BF.reader._settleChapter(idx);
};

