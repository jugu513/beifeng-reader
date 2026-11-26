/* ================= 11. BF.settings 设置门面 ================= */


BF.settings = (function () {
  const DEFAULTS = {
    /* 外观模式（单入口）：明暗档与固定色板同坐一张登记表
       BF.SKINS，一个键 appearance 说了算——主题与外观不是两个键。
       默认「深色 · 夜墨」。 */
    appearance: 'dark', accent: 'red',
    /* 界面风格（材质轴 skinStyle）：apple=全站毛玻璃+胶囊按钮+8pt 间距；
       mixed=苹果外壳 + 北风原生阅读页；default=原始朱砂书卷风。
       落在 body 的 data-material 上，与明暗·色板那根轴（data-skin）分属性写，
       两者才不会互相覆盖。bw/qj 两套实验界面各由自己的 bwMode/qjMode
       开关决定，不归这一档。 */
    skinStyle: 'default',
    /* 曲径（实验）：多驿站式新界面，通过设置 → 实验 开关。 */
    qjMode: false,
    /* 黑白简约（实验）：全站灰度极简界面。令牌注入见 BF.theme.apply 末尾的
       BF.BW_*_TOKENS，结构层样式见 <head> 末尾「黑白简约模式」块。 */
    bwMode: false,
    /* 流体界面（实验 · appleFluid）：把当前界面套上 Apple 材质（data-material=apple，
       即「当前界面的 Apple 化副本」），再叠加流体交互优化层（body.fluid-ui）。
       默认关；开启即呈现 Apple 风格副本，关闭后由上方材质块原样还原。 */
    appleFluid: false,
    /* A 线（实验 · aLineMode）：现行主题的参数重分配——色值一个不改，只调参数分配。
       标签字距、区块标题、圆角令牌、首页呼吸、毛玻璃。开启后原样可关。 */
    aLineMode: false,
    /* 底部标签栏开关（hideTabBar）：默认显示。开启后首页/书架/笔记/我的四页的
       底部导航整体收起——只动显隐，路由（BF.app.go）、数据与各页内容不动。
       恢复路径不依赖底栏：顶栏齿轮「设置」，或 DSL 终端（Ctrl+Shift+J）
       `settings hideTabBar false`。改设置即时生效（HOT_GROUPS 的 tabbar 组）。 */
    hideTabBar: false,
    /* D2 开发者项：工作台入口默认隐藏，显式开启才显示。功能（DSL wb.open）不受影响，只藏入口。 */
    devTools: false,
    fontSize: 17, lineHeight: 1.95, wordSpacing: 0, paraSpacing: 1, brightness: 100,
    readerMargin: 'normal', noIndent: false, justify: false, warmth: 'off',
    autoTheme: false, readerFilter: 'none', readerMode: 'scroll', simpleMode: false,
    /* 阅读标尺（跟随鼠标的横线）与英文断词：都默认关。
       断词会改变拉丁段落行高，进而影响分页测量，所以只给显式打开的人。 */
    readingRuler: false, enHyphen: false,
    /* 书籍信息面板：站点导出的 TXT 开头常带一段元信息（书名/作者/字数/章节数/
       书籍 ID/更新时间……），分章把它当成第 0 章。开启后目录顶部多一条面板，
       点开看那段的原文。
       这条只做「多一个入口」：不折叠、不删行、不跳章 —— 分章只是切片，
       任何显示层改造都不许把内容吞掉或让某一章变得不可达。关掉即回到原样。 */
    bookInfoPanel: false,
    /* AI 总开关：关掉后网关不再发出任何请求（设置里明写这一点） */
    aiEnabled: true,
    /* 界面口味：一条一个开关，默认全关（关掉即回到未加口味的样子）。
       真源是 BF.TASTE 那张登记表，设置行与 data-taste 令牌都由它生成。 */
    tasteTopline: false, tastePoster: false, tasteSpring: false, tasteStagger: false,
    tasteCountUp: false, tasteSlider: false, tasteCardEdge: false, tasteCoverLight: false,
    tasteKbd: false, tasteFavicon: false, tasteScrollbar: false, tasteSelection: false,
    /* 后 4 条口味键必须进 DEFAULTS：load() 归一化只保留 schema 键，缺失会被重启抹掉；
       精致/灵动预设恰好命中 eyebrow/aline-soft/aline-glass，不补则预设重启即失效。 */
    tasteEyebrow: false, tasteAlineSoft: false, tasteAlineGlow: false, tasteAlineGlass: false,
    chapterEndContinue: true, autoSave: true, chapterStrategy: 'smart', chapterRegex: '',
    /* 目录区块伪章合并：默认开（关掉就是接受一串同名假章进目录）。只影响新导入的书。 */
    mergeTocBlock: true,
    chapterWordCount: 50000, autoDetectTitle: true, encoding: 'auto',   /* 按字数分章的阈值：章标记不足时才用它切，5 万字是长章不被切成伪章的底 */
    /* 乱码书两道开关：拦截默认关；不拦时给提示，而这条提示也能单独关。
       判据只有一处：BF.library.garbleCheck，文件与 URL 两条通道共用。 */
    garbleBlock: false, garbleWarn: true,
    /* 书卡常驻动作：卡面那一排放哪几枚，逗号分隔的 BF.BOOK_ACTIONS id。
       存字符串而不是数组 —— 这张 schema 里全是标量，归一化与写入路径不必为它开特例。
       默认「置顶 · 收藏」，菜单触发器不在这里（它不可被收起，见 BF.BOOK_ACTIONS 注）。 */
    bookCardActions: 'pin,star',
    ttsEngine: 'auto', ttsAutoOffline: true, ttsAutoOnline: true, edgeToken: '',
    ttsRate: 1.0, ttsPitch: 1.0, ttsVolume: 0.9, ttsAutoNext: true,
    ttsCache: false,   /* 跨会话朗读缓存：默认关。要不要把正文音频留在磁盘上由用户决定 */
    ttsOfflineVoice: '',   /* 离线档主音色（系统语音名）：空＝自动挑中文本地语音 */
    edgeSecVer: '',        /* Edge 协议版本号覆盖：空＝用内置 2-143.0.3650.75 */
    ttsSegment: 'sentence', ttsHideOnStop: true, ttsAutoScroll: true, ttsTap: false, ttsWordHighlight: true,
    /* 按服务端时间轴高亮（默认关）：开启后 Edge 合成带 sentenceBoundaryEnabled +
       wordBoundaryEnabled，返回的 audio.metadata 驱动逐词下划线；服务端不回就回落整句底色。
       必须进 DEFAULTS，否则每次启动被归一化抹掉。 */
    ttsSentenceBoundary: false,
    ttsRolePlay: false, ttsVoiceAltName: '', ttsMimoVoice: 'mimo_default',
    /* 已清理的死设置项：ttsMimoVoiceAlt（与 ttsMimoVoice 重复）、
       hideScrollbarReadingOnly（与 showScrollbarReadingOnly 语义冲突，已清理）。
       注意勿牵连在用的键：showScrollbarReadingOnly 在 theme.apply 落 class、
       设置面板有入口、进热更新组；aiPresets 是用户自建 AI 配置预设（保存/删除 UI、
       导出密钥剥离、reset 保留共 37 处引用）；aiEnhance / aiAutoSplit / aiAutoTag
       均已实现。称这些「从未实现/无人消费」会误导维护者删掉正在用的功能。 */
    ttsEdgeVoice: 'zh-CN-XiaoxiaoNeural', ttsSleepMin: 0, ttsMimoFormat: 'wav', mimoApiKey: '',
    fontFamily: 'serif', hideScrollbar: false,   /* V2: 中文长文默认衬线 */
    showScrollbarReadingOnly: true, chapterPrefetch: true, aiSearchPar: 6,
    aiPromptMode: true, aiConcurrency: 4, aiRetries: 2,
    aiSummaryLevel: 'standard', aiAskTurns: 6, aiContextSegs: 4,
    aiAgent: false, aiRefBook: true,
    aiProvider: 'tokenriver', aiEndpoint: '', aiModel: '', aiApiKey: '' , aiLock: false,
    /* 密钥原文在界面上怎么露：ask=每次点「显示」问一句（默认）/ allow=直接显示、10 秒后自动打码 /
       mask=永不显示（公共设备）。打码态下输入框里本来就没有明文，这一项只管「要不要显示」。 */
    keyReveal: 'ask',
    aiImportEnhance: false, aiAutoSplit: false, aiAutoTag: false,
    aiAutoDegrade: true,   /* 服务商连续失败时自动切换其内置通道（关则失败即提示，不把正文改道第三方） */
    /* 传输档与本机转发：aiTransport=auto/direct/proxy、aiProxyBase=本机转发器地址、
       aiModelMode=回复结构档（auto / tools / plain，自动＝探测到支持才用工具调用）。
       三者都可手动锁，锁了就不再自动改。 */
    aiTransport: 'auto', aiProxyBase: '', aiModelMode: 'auto',
    readGoal: 30, desktopNoti: true, privacyMode: false, remoteImg: false, captureLog: false, consoleEcho: false, notiMute: false, notiSeenAt: 0,
    captureLogDays: 7, pinLock: false, pinHash: '', pinSalt: '',
    storageBackend: 'auto',   /* 存储后端：auto=优先新层(OPFS+IDB)，任一操作失败逐操作回落原层；legacy=强制原层；next=强制新层 */
    /* 存储分配表（A 类：按内容类别选物理后端）。缺省 {} = 逐类回落到全局 storageBackend 的现状行为（零破坏 C-1）。
       合法候选见 BF.store.ALLOC_CANDIDATES；承重键不在表里作主存，只在 mirror 段留一个布尔。 */
    storageAlloc: {},
    /* 承重键的 IDB durable 镜像开关（C-2：主存恒 LS 同步读，这里只加/不加镜像，不改主存）。
       缺省 {} = 沿用旧语义（backendMode()!=='legacy' 时镜像）。 */
    mirrorKeys: {},
    reduceMotion: false, scrollSpeed: 3, autoBackup: false, bgAnim: 'none', focusAutoNoise: false,
    goalIncludeFocus: false,   /* 阅读目标是否纳入专注时长（默认关——专注与阅读两回事，不混计） */
    sessionRestore: true,     /* 启动时恢复上次阅读的书籍（关闭则按 returnPage 落地） */
    /* 再次回到时打开的页面：shelf=书架 / home=主页。会话恢复优先；
       未恢复阅读、且曲径未接管落点时，本档决定启动停在书架还是主页。 */
    returnPage: 'shelf',
    shelfDensity: 'normal',   /* 书架密度三档 compact/normal/comfortable */
    /* 书架排序也进设置：原来它只活在 DOM 里，刷新一次就回到「最近阅读」，
       而密度、视图模式都能记住——同一屏的两个开关一个持久一个不持久，说不通。 */
    shelfSort: 'recent',
    /* 书架视图模式（grid/list）进设置存档，F5 后不丢 */
    shelfViewMode: 'grid',
    /* 更多菜单形态：dropdown=按钮下方的下拉列表（默认）/ panel=宽幅平铺面板 */
    moreMenuStyle: 'dropdown',
    /* 固定到顶栏的菜单项 id，逗号分隔字符串（home/shelf 顶栏，「更多」菜单里仍保留）；
       空串 = 不固定。id 取值见 BF.uiMenu itemsFor 的条目表 */
    pinnedTop: '',
    microread: false,   /* 微读模式：进阅读器时按此恢复三栏布局（默认关，opt-in） */
    /* 微信读书移植（微读专属，仅在微读排版小面板消费，不进 DSL settings 元数据/契约面）：
       mrTheme=WR 配色 5 档、mrZoom=整体缩放百分比、mrCanvas=逐页位图翻页开关。 */
    mrTheme: 'wr-white', mrZoom: 100, mrCanvas: false,
    wsSync: false,   /* 工作区同步：本地 LS 增量同步到 OPFS */
    askOnExport: true,   /* 导出备份时弹窗询问是否加密 */
    dslMode: 'terminal',   /* DSL 终端显示形态：terminal=命令行 / editor=脚本缓冲 */
    dslPos: null,   /* DSL 终端窗口落点 {x,y}（视口左上角坐标）；null=按 CSS 居中 */
    dslMax: false,  /* DSL 终端是否占满整屏（双击标题栏切换） */
    /* 终端界面语言：en（默认）/ zh。只管终端自己说的话——外壳、回执、会话提示；
       命令实现里的输出与 help 手册文本不随它变。 */
    dslLang: 'en',
    /* chat / Agent 会话话术独立设档：en（默认）/ zh。只切会话相关的壳话术
       （提示符、开/关会话、运行中、中止/超时回执等）；终端其余外壳仍由
       dslLang 决定；AI 回答内容的语言由系统提示词与提问决定，不归此档。 */
    aiConvLang: 'en',
    settingsLayout: 'overview',  /* 设置页布局：overview=概览下钻 / grouped=分组平铺 / flat=原平铺。降噪用，默认概览 */
    ttsCompactNarrow: false,  /* 窄屏（≤420px）朗读栏：默认保留已播时间/倍速读数（压缩截断），开启才收起 */
  };
  let _s = {};
  let _saveT = null;
  let _dirty = false;   /* set 标脏，persist 消费后广播一次（避免双 emit） */

  /* load() 归一化时会保留的键（不在 DEFAULTS 但属于合法 schema）。
     set() 的「重启后会丢」告警与这里共用一份名单，不各写一套。 */
  const KEPT_KEYS = ['aiApiKey', 'mimoApiKey', 'aiProvider', 'aiEndpoint', 'aiModel', 'aiPrompts', 'aiPresets'];
  function load() {
    const _rawSaved = BF.store.lsGet(BF.store.K.SETTINGS, {});
    /* 存档若被外部写坏成 null / 数组 / 字符串（手工改 localStorage、旧版本残留），
       下面的迁移与归一化会先读 saved.appearance 而抛 TypeError。
       这条调用位于 boot.run 早段、外层没有兜底，一抛就等于整页停在半初始化。
       非普通对象一律按空存档处理（DEFAULTS 兜住一切）。 */
    const saved = (_rawSaved && typeof _rawSaved === 'object' && !Array.isArray(_rawSaved)) ? _rawSaved : {};
    /* 设置 schema 归一化。存档可能残留未知/废弃键（如
       hideScrollbarReadingOnly、aiEnhance 等清理过的假开关），累积成垃圾。
       这里只保留 DEFAULTS 已知键 + 私有密钥（aiApiKey 等 reset 也保留），
       未知键丢弃，保证 settings 只含有效 schema。 */
    /* 外观合并迁移（主题 ∪ 外观模式 → appearance 单键）：
       旧存档选了固定色板（skin 非墨哨兵）的跟色板；否则跟旧明暗档（无纸鸢存档，落回深色）。
       本模块（11）比外观登记表（13.6）先执行，迁移判据不能读 BF.SKIN_TOKENS ——
       只能认 'ink' 这个旧哨兵；色板键的合法性随后由 BF.skin.get() 对着登记表兜底。
       迁移在 schema 循环前写进 saved，旧 theme/skin 键随后被循环天然丢弃。 */
    if (saved.appearance === undefined) {
      const sk = saved.skin, th = saved.theme;
      saved.appearance = (typeof sk === 'string' && sk && sk !== 'ink') ? sk
        : (th === 'light' ? 'light' : th === 'black' ? 'black' : th === 'system' ? 'system' : 'dark');
    }
    const _out = {};
    for (const k in DEFAULTS) {
      _out[k] = saved[k] === undefined ? DEFAULTS[k] : saved[k];
    }
    /* 私有密钥即使不在 DEFAULTS 也保留（reset 语义一致） */
    KEPT_KEYS.forEach(function (k) { if (saved[k] !== undefined) _out[k] = saved[k]; });
    _s = _out;
    return _s;
  }
  let _persistFailNotified = false;   /* 落盘失败单次提示（防抖窗口内重复失败不刷屏） */
  /* 落盘前的整全检查：内存态可以缺，落盘的包不能缺。
     启动顺序里只要有一次 set() 跑在 load() 之前，_s 就是一两个键的半成品，
     跟着 200ms 防抖落盘，用户全部设置就被压成这一两个键——现象是「设置全丢了」。
     这里只填空位、不改任何已有值，所以正常路径下它什么都不做。 */
  function _ensureFull() {
    try {
      /* 这里不能按「键数够了就算齐」判断：KEPT_KEYS 会带来 schema 外的键，
         数量凑够时仍可能缺某个 DEFAULTS 键，于是持久化出去的包少键。
         逐键判 undefined 的成本只有百来次比较。 */
      for (const k in DEFAULTS) { if (_s[k] === undefined) _s[k] = DEFAULTS[k]; }
    } catch (e) { BF.err.report('settings.ensureFull', e); }
  }
  /* SETTINGS 广播不得携带明文密钥。广播面是页面内全部订阅者
     （含插件与 DSL 脚本可挂的 bus），整包 Object.assign({}, _s) 会把
     密钥与密钥载体一起带进载荷。
     隐私键只有一份真源：BF.store.PRIV_KEYS（备份剥离、导出剥离、广播剥离三处共用）。
     各处再各写一份名单就必然漂移——漏掉的就是 aiEndpoint/aiModel/pinLock/aiLock
     这一类「不叫 key 但同样能把人认出来」的键。
     实际订阅点要么忽略载荷、要么只读非密钥键（reduceMotion/bgAnim/ttsEngine），
     需要值的订阅方一律经 BF.settings.get 回读 —— 载荷只承担「通知变更」。
     密钥键变更照常触发广播（键仍在 _s），只是值不出门。 */
  function _publicSnapshot() {
    const o = Object.assign({}, _s);
    BF.store.PRIV_KEYS.forEach(function (k) { delete o[k]; });
    delete o.aiPresets;   /* 预设不在 PRIV_KEYS 里，但每条嵌着密钥 */
    return o;
  }
  function persist() {
    _ensureFull();
    _saveT = null;
    /* persist 必须检查 lsSet 返回值——
       配额耗尽时设置只停留在内存态、静默不落盘，
       用户以为已保存。失败时用户
       可见提示（单次，防抖期内重复失败不刷屏）。
       内存态为新值、SETTINGS 事件照常广播（界面
       即时反映新值），提示明示未落盘、重开失效。 */
    const saved = BF.store.lsSet(BF.store.K.SETTINGS, _s);
    if (!saved) {
      if (!_persistFailNotified) {
        _persistFailNotified = true;
        try { BF.feedback.error('设置未能保存', { next: { label: '去清理存储', run: function () { try { if (BF.workbench && BF.workbench.open) BF.workbench.open('data'); else if (BF.diag && BF.diag.open) BF.diag.open(); } catch (e) {} } }, detail: '本地存储空间不足，本次更改未落盘，重开页面后失效' }); } catch (e) {}
      }
    } else {
      _persistFailNotified = false;
    }
    /* 有变更才广播：init 时的补齐写盘不产生事件，避免开机重复触发。
       载荷走 _publicSnapshot：密钥键不进广播。 */
    if (_dirty) { _dirty = false; try { BF.bus.emit(BF.EVENTS.SETTINGS, _publicSnapshot()); } catch (e) {} }
  }
  function save(immediate) {
    if (_saveT && !immediate) return;
    if (_saveT) { clearTimeout(_saveT); _saveT = null; }
    if (immediate) { persist(); return; }
    _saveT = setTimeout(persist, 200);
  }
  /* ===== 固定轴色板 ⟷ 暖色 / 暖滤镜 互斥（外观合并后只剩这一条边） =====
     外观合并后 theme 与 skin 已是同一个键：明暗档互不冲突
     （同一条轴上的不同位置），剩下的冲突只有一种——固定色板与暖：
       · warmth !== 'off'，以及暖档滤镜 sepia（纸色 #f4ecd8）/ paper（米白 #f7f5f1）。
         night / clean-white / clean-black 是中性底色档，不与色板冲突，允许共存。
       · 墨绿/高级灰/夜航 是钉死深轴的色板——暖色暖滤镜会盖掉
         它们逐档解过的对比度，所以三张色板都与暖互斥。
     规则仍是「最后一次显式改动胜出」，两侧都不留摆设：
       · 暖色/暖滤镜显式打开时若当前是色板 → 外观让位到该色板所在轴的明暗档
         （浅轴色板落回「浅色」，深轴色板落回「深色」）；
       · 显式切进某个色板 → 冲突项就地复位（暖色归 off / 滤镜归 none）。
     开机不批量改写：迁移只把旧键拼成一个 appearance 值，暖光与色板的旧组合
     若冲突，用户一动任意一侧当场按上面的规则收敛。 */
  const WARM_FILTERS = ['sepia', 'paper'];
  /* 外观的中文名、副标题、所在轴只住在 BF.SKIN_LABELS / BF.SKIN_SUBS / BF.SKIN_AXIS
     里（与 BF.SKINS 同处登记，名字只住一处）；这两行是转发不是副本。 */
  function _skinLabel(k) { return BF.SKIN_LABELS[k] || k; }
  function _skinAxisOf(k) { return BF.SKIN_AXIS[k]; }
  function _warmOn(st) {
    const s = st || _s;
    return (s.warmth || 'off') !== 'off' || WARM_FILTERS.indexOf(s.readerFilter || 'none') >= 0;
  }
  function reconcileSkin(keys) {
    const ap = _s.appearance;
    if (!BF.SKIN_TOKENS[ap]) return '';   /* 明暗档（含系统/纯黑）与暖无冲突 */
    const axis = _skinAxisOf(ap);
    const t = {};
    (keys || []).forEach(function (k) { t[k] = 1; });
    const warm = _warmOn();
    if (t.appearance) {
      if (!warm) return '';
      _s.warmth = 'off';
      _s.readerFilter = 'none';
      return '「' + _skinLabel(ap) + '」是' + (axis === 'light' ? '浅' : '深') + '色主题，不能配暖色，已帮你关掉暖色和滤镜';
    }
    if ((t.warmth || t.readerFilter) && warm) {
      _s.appearance = (axis === 'light') ? 'light' : 'dark';
      return '暖色不能配「' + _skinLabel(ap) + '」，已帮你换成「' + _skinLabel(_s.appearance) + (BF.SKIN_SUBS[_s.appearance] ? ' · ' + BF.SKIN_SUBS[_s.appearance] : '') + '」';
    }
    return '';
  }
  /* 让位与复位之后必须把令牌重算一遍：翻转发生在数据层，而 body 上的内联令牌
     只有 BF.theme.apply() 会增删。调用方自己就要重应用的两个键不重复应用。 */
  function _skinNotice(msg, reapply) {
    try { BF.noti.info(msg); } catch (e) {}
    if (!reapply) return;
    try { if (BF.theme && BF.theme.apply) BF.theme.apply(); } catch (e) {}
  }

  /* set 只改内存并标脏，不自己广播；广播统一由 persist 在防抖结束后发出一次。
     set 与 persist 各广播一次会让监听 SETTINGS 的模块每次设置都收到两次回调。
     监听者仅 2 处（均为副作用型，不依赖同步返回值），200ms 防抖延迟无影响。 */
  /* 类型对账：DSL 命令行传进来的值一律是字符串（`settings hideScrollbar false`
     存下的是 'false'），刷新后仍是字符串 ⇒ 真值判断把语义整个翻转：用户要「不要隐藏滚动条」，
     重启后滚动条反而被隐藏。归一放在 set 这一层，设置面板 / DSL / 能力中枢同享一份。
     认不出来的取值原样返回，不静默改成 false——静默改值比类型漂移更糟。 */
  function coerce(k, v) {
    if (!(k in DEFAULTS)) return v;
    const want = typeof DEFAULTS[k];
    if (want === 'boolean') {
      if (typeof v === 'boolean') return v;
      if (typeof v === 'number') return v !== 0;
      const s = String(v == null ? '' : v).trim().toLowerCase();
      if (s === 'true' || s === '1' || s === 'yes' || s === 'on') return true;
      if (s === 'false' || s === '0' || s === 'no' || s === 'off' || s === '') return false;
      return v;
    }
    if (want === 'number') {
      if (typeof v === 'number') return v;
      const n = Number(v);
      return Number.isFinite(n) ? n : v;
    }
    if (want === 'string' && v !== null && v !== undefined && typeof v !== 'string') return String(v);
    return v;
  }
  /* 数值设置的有效区间，整库唯一一份：读侧（get / num / BF.prefs.resolve）在生效那一刻
     夹取，写侧（设置面板夹紧、AI 建议取值校验）也从这里派生。
     区间按「用了不会把界面弄坏」定，比某些滑块可拖的范围宽——字号的快捷键能到 10 与 40，
     按滑块上限夹会把用户的合法选择改掉。
     存储里的脏值不就地改写：备份与恢复要看见原样，只在生效时夹。 */
  const RANGES = {
    fontSize: { min: 10, max: 40 },
    lineHeight: { min: 1, max: 3 },
    wordSpacing: { min: 0, max: 4 },
    paraSpacing: { min: 0.5, max: 2 },
    brightness: { min: 60, max: 140 },
    chapterWordCount: { min: 1000, max: 50000 },
    readGoal: { min: 0, max: 600 },
    scrollSpeed: { min: 1, max: 10 },
    ttsRate: { min: 0.5, max: 3 },
    ttsPitch: { min: 0.5, max: 2 },
    ttsVolume: { min: 0, max: 1 },
    ttsSleepMin: { min: 0, max: 180 },
    aiSearchPar: { min: 1, max: 16 },
    aiContextSegs: { min: 1, max: 40 },
    aiAskTurns: { min: 1, max: 60 },
  };
  function clampRange(k, v) {
    const r = RANGES[k];
    if (!r) return v;
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n)) return v;      /* 非数字交给各自的 Number 兜底，这里不硬造一个值 */
    /* 区间内原样返回：存储里是 '1.9' 这种字符串形态时不改它的类型，
       下拉框按 String(cur) 匹配选项，改成数字 1.0 会让「1.0x」这档认不出来。 */
    if (n >= r.min && n <= r.max) return v;
    return n < r.min ? r.min : r.max;
  }
  /* ===== 热加载：改设置立即作用到界面 =====
     键 → 应用函数的分组表：set 时就地记账，同一帧内 0ms 合并执行一次，
     与落盘防抖完全解耦（改了立刻看到；写盘在后面自己慢慢做）。
     应用函数一律动态取模块并吞掉缺失（启动早期 set 时 BF.reader/BF.app 可能还没注册）。 */
  const HOT_GROUPS = [
    { name: 'appearance',
      keys: ['appearance', 'warmth', 'readerFilter', 'accent', 'brightness', 'bgAnim', 'reduceMotion',
        'hideScrollbar', 'simpleMode', 'showScrollbarReadingOnly', 'ttsCompactNarrow', 'bwMode', 'skinStyle', 'appleFluid', 'aLineMode'],
      run: function () { if (BF.theme && BF.theme.apply) BF.theme.apply(); } },
    { name: 'readerType',
      keys: ['fontSize', 'lineHeight', 'letterSpacing', 'wordSpacing', 'paraSpacing', 'fontFamily', 'readerMargin', 'mrZoom'],
      run: function () { if (BF.reader && BF.reader.applyStyles) BF.reader.applyStyles(); } },
    /* 密度只改网格上的布局类，书卡一张都不重画 */
    { name: 'shelfDensity',
      keys: ['shelfDensity'],
      run: function () { if (BF.app && BF.app.syncShelfLayout) BF.app.syncShelfLayout(); } },
    /* 卡面常驻动作写在卡片 HTML 里，必须整架重渲染才能换掉按钮 */
    { name: 'cardActions',
      keys: ['bookCardActions'],
      run: function () { if (BF.app && BF.app.renderBookshelf) BF.app.renderBookshelf(); } },
    /* 口味键登记在 BF.TASTE（本模块先于它加载，键名不能在这里抄第二份），按表现查 */
    { name: 'taste',
      match: function (k) {
        try { return (BF.TASTE || []).some(function (t) { return t.key === k; }); } catch (e) { return false; }
      },
      run: function () { if (BF.taste && BF.taste.apply) BF.taste.apply(); } },
    /* 曲径开关：开 → 汇入曲径；关 → 回旧首页。 */
    { name: 'qujing', keys: ['qjMode'], run: function () { if (BF.qj && BF.qj.onTgle) BF.qj.onTgle(); } },
    /* 底栏开关：就地把 TabBar 显隐重走一遍（幂等：只动 body class 与 hidden 属性）。
       当前页从 BF.appState 取，启动早期取不到按 home 兜底——sync 本身幂等。 */
    { name: 'tabbar', keys: ['hideTabBar'], run: function () { if (BF.shell && BF.shell.sync) BF.shell.sync((BF.appState && BF.appState.currentPage) || 'home'); } },
    /* D2 开发者项开关：只重走 body class（与 theme.apply 同一落点），命令/数据不动 */
    { name: 'devtools', keys: ['devTools'], run: function () { document.body.classList.toggle('devtools', !!BF.settings.get('devTools')); } },
    /* 终端语言：即时生效——只重画终端面板的静态标签与徽章，不重建面板、不动日志 */
    { name: 'dslLang',
      keys: ['dslLang'],
      run: function () { if (BF.dslUI && BF.dslUI.applyLang) BF.dslUI.applyLang(); } },
  ];
  const _hotPending = Object.create(null);
  let _hotT = null;
  function _hotSchedule(k) {
    let hit = false;
    for (const g of HOT_GROUPS) {
      if (((g.keys || []).indexOf(k) >= 0) || (g.match && g.match(k))) { _hotPending[g.name] = g; hit = true; }
    }
    if (!hit) return;
    if (_hotT) return;
    _hotT = BF.timers.timeout(function () {
      _hotT = null;
      const names = Object.keys(_hotPending);
      for (const n of names) { delete _hotPending[n]; }
      for (const n of names) {
        const g = HOT_GROUPS.find(function (x) { return x.name === n; });
        if (!g) continue;
        try { g.run(); } catch (e) { BF.err.report('settings.hot.' + n, e); }
      }
    }, 0);
  }
  /* 枚举档位的合法值表：谁渲染下拉，谁登记名单（见 BF.settingsUI._sel）。
     校验在写入侧，名单只有一份——加一档不用再来这里补一遍。 */
  const _enum = Object.create(null);
  function regEnum(k, vals) {
    /* 两种名单都要认：[值, 文案] 成（下拉的 opts）与裸值串（代码里的合法集）。
       拿 x[0] 判「这不是一成」会错在串上——'progress'[0] 是 'p' 而非 undefined，
       于是每个串都被截成一位字母，合法值反倒全被这道闸拒掉。 */
    _enum[k] = (vals || []).map(function (x) { return String(Array.isArray(x) ? x[0] : x); });
  }
  function set(k, v) {
    /* 先保证内存态是完整的 schema：任何跑在 load() 之前的 set 都不该把设置压成孤键 */
    _ensureFull();
    /* 不在 schema 里的键会被 load() 的归一化整条丢弃（这是刻意的：存档不该长垃圾），
       但写入方并不知道 ⇒ 静默失效。这里明说一次，别让人对着「改了没反应」猜半天。 */
    if (!(k in DEFAULTS) && KEPT_KEYS.indexOf(k) < 0) {
      BF.log && BF.log.warn('设置项不在 schema 中：' + k + '（本次生效，重启后会被归一化丢弃）');
      /* 静默失效要出声：只写 log 等于让使用者对着控制台找，界面层给一次提示（同键只提一次）。 */
      if (!(set._unschema = set._unschema || {})[k]) {
        set._unschema[k] = 1;
        try { BF.noti && BF.noti.warn && BF.noti.warn('「' + k + '」不是已登记的设置项：本次生效，重启后会丢'); } catch (e) {}
      }
    }
    /* 枚举档位（下拉框登记过的键）只认名单里的值：
       未知**键**有上面那条告警，未知**值**过去照收——readerMode='zzz' 能写进存档，
       界面落进谁也没定义过的状态，这个坏值还会跟着备份走，下次恢复照样坏。
       名单由 BF.settingsUI._sel 在渲染下拉时登记，一份来源，不在这里另抄。 */
    const _cv = coerce(k, v);
    const _allow = _enum[k];
    if (_allow && _allow.indexOf(String(_cv)) < 0) {
      BF.log && BF.log.warn('设置值不在该档位的可选值中：' + k + '=' + String(v));
      if (!(set._badval = set._badval || {})[k]) {
        set._badval[k] = 1;
        try { BF.noti && BF.noti.warn && BF.noti.warn('「' + k + '」没有「' + String(v) + '」这一档：已保持原值'); } catch (e) {}
      }
      return _s[k];
    }
    _s[k] = _cv;
    /* 视图类开关（隐藏滚动条 / 极简 / 仅阅读时显示 / 减少动效）的唯一落点在 BF.theme.apply，
       而那一层过去只在换肤等路径被调用 ⇒ 从非设置面板入口改这四项，class 不跟着改，
       表现为「设置改了没反应」。改这几项就把应用视图重新走一遍（幂等：全是 toggle 与属性赋值）。 */
    _hotSchedule(k);
    const msg = reconcileSkin([k]);
    _dirty = true;
    save();
    /* 设置变更精确标脏受影响的设置分区，保证面板再次打开时该分区被重建（不残留旧值） */
    if (BF.settingsUI && BF.settingsUI.markDirty) { try { BF.settingsUI.markDirty(k); } catch (e) {} }
    if (msg) _skinNotice(msg, k !== 'appearance');
    return _s[k];
  }
  function get(k) { return clampRange(k, _s[k]); }
  /* 数值设置的唯一读法。全站 27 处调用点一律走这里，禁写 `parseFloat(BF.settings.get(k)) || 默认值`：
     0 是 falsy，用户显式设的 0 会被当成「没设」——音量拉到 0 仍按 0.9 播、
     阅读目标设 0 仍按 30 分钟计、行距归 0 仍按 1.9 走。
     这里用 Number.isFinite 判定，并把空串/缺失（真的没值）与 0 分开。 */
  function num(k, dflt) {
    const raw = _s[k];
    if (raw === '' || raw === null || raw === undefined) return dflt;
    const n = Number(raw);
    if (!Number.isFinite(n)) return dflt;
    return clampRange(k, n);
  }
  function all() { return _s; }
  function reset() {
    /* 保留私有密钥：恢复默认不受影响用户已配置的 API 密钥（重置前先备份，重置后再回写）。
       否则 reset 会静默清掉用户粘贴的 aiApiKey/mimoApiKey，且无任何提示。 */
    const PRIV = ['aiApiKey', 'mimoApiKey', 'aiProvider', 'aiEndpoint', 'aiModel'];
    /* aiPresets 是用户自建的配置预设（用户数据，非密钥）：恢复默认不应把用户存的预设清空 */
    const _keep = PRIV.concat(['aiPresets', 'aiPrompts']);
    const keep = {};
    _keep.forEach(function (k) { if (_s[k] !== undefined) keep[k] = _s[k]; });
    _s = Object.assign({}, DEFAULTS);
    Object.keys(keep).forEach(function (k) { _s[k] = keep[k]; });
    save(true);
    BF.bus && BF.bus.emit(BF.EVENTS.SETTINGS, _publicSnapshot());
  }
  /* patch 标脏：patch 若只 Object.assign + save() 而漏写 _dirty，
     persist 时 _dirty 为 false，批量改设置后 SETTINGS 事件不广播，
     监听方（主题/跨页同步/工作区同步）收不到变更。
     与 set 语义对齐：改内存 + 标脏，
     广播统一由 persist 在防抖结束后发出一次。 */
  function patch(obj) {
    Object.assign(_s, obj);
    /* 批量写（场景）按「这一批显式动过哪些键」判定，
       避免键的遍历顺序左右互斥结果 */
    const msg = reconcileSkin(Object.keys(obj));
    _dirty = true;
    save();
    /* 批量写（场景等）逐键标脏受影响的设置分区，并逐键走热加载 */
    for (var _pk in obj) {
      _hotSchedule(_pk);
      if (BF.settingsUI && BF.settingsUI.markDirty) { try { BF.settingsUI.markDirty(_pk); } catch (e) {} }
    }
    if (msg) _skinNotice(msg, !('appearance' in obj));
    return _s;
  }
  /* 脚本与跨模块取设置走这份副本：get 返回的是内存里的活对象，
     拿到引用就能绕过 set() 直接改（不入库、不广播），表现是「改了没生效」。 */
  function getCopy(k) {
    const v = get(k);
    try { return v && typeof v === 'object' ? JSON.parse(JSON.stringify(v)) : v; } catch (e) { return v; }
  }
  return { DEFAULTS, load, save, persist, set, get, getCopy, num, all, reset, patch, RANGES, clampRange, regEnum };
})();

