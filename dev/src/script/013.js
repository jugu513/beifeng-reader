/* ================= 5. BF.store 存储门面 ================= */
BF.store = (function () {
  const PREFIX = 'bf_';
  const K = {
    SETTINGS: 'settings',
    BOOKS_META: 'books_meta',
    BOOKMARKS: 'bookmarks',
    HIGHLIGHTS: 'highlights',
    NOTES: 'notes',
    VOCAB: 'vocab',
    DAILY: 'daily',
    FOCUS_DAILY: 'focus_daily',   /* 专注时长日账（秒）。读写一律经 K 表，不在代码里散写字面键名 */
    READ_GOAL: 'read_goal',
    AUTOBACKUPS: 'autobackups',
    LOG: 'log',
    TTS_SESSION: 'tts_session',
    AI_SESSIONS: 'ai_sessions',
    AI_ASK_SESSIONS: 'ai_ask_sessions',
    AI_SUMMARY_CACHE: 'ai_summary_cache',
    NOTI_HIST: 'noti_history',
    NAV_HIST: 'nav_history',
    SEARCH_HIST: 'search_hist',
    BOOK_TIME: 'book_time',
    HOTKEYS_CUSTOM: 'hk_custom',
    BASE: 'base_state',
    BASE_IMPORTED: 'base_imported',
    CORRUPT: 'corrupt',
    /* 终端输出留痕。它是密钥载体：闸门放行后的明文回显会进这一份滚动缓冲，
       所以键名进 K 表由三处共用（落盘 / 备份排除 / 打包排除），不散写字面量。 */
    DSL_LOG: 'dsl_log',
    SCROLL_: 'scroll_',
    PROGRESS_: 'progress_',
    LAST_BOOK: 'last_book',
    READING_STATE: 'reading_state',   /* 阅读进度轻量键（书级：currentChapter/lastRead）。旧键 'bf_reading_state' 经 PREFIX 叠加会成 bf_bf_reading_state 双前缀，迁移逻辑见 boot.run */
    AI_PROVIDER: 'aiProvider',
    AI_ENDPOINT: 'aiEndpoint',
    AI_MODEL: 'aiModel',
    AI_APIKEY: 'aiApiKey',
    AI_PROMPTS: 'ai_prompts',
    AI_IMPORT: 'ai_import',
    ENC_HIST: 'enc_hist',
    TRASH: 'trash',   /* 回收站：软删的书只把这条记录搬进来，正文与标注原地不动 */
    /* 书架分组（Collection 语义）：组本身一张表，「哪本书在哪组」另一张表。
       不塞进 BOOKS_META —— 改组不该重写整本元数据（那里有 87 处读取）。 */
    SHELF_GROUPS: 'shelf_groups',
    SHELF_ITEMS: 'shelf_group_items',
    ONBOARDED: 'onboarded',   /* 首启引导是否已完成（一次性标记，走 K 表不散写字面键名） */
    FOCUS_CYCLES: 'focus_cycles',  /* 番茄钟今日完成轮数（日→轮），与 focus_daily 同构 */
    /* IndexedDB store 名 */
    CHAPTERS: 'chapters',
    CHAPTER_TITLES: 'chapter_titles',
  };
  const IDB_NAMES = new Set(['chapters', 'chapter_titles', 'kv', 'ugc']);  /* 'kv' 通用键值 store，承载 UGC 的 durable 副本；'ugc' = 按书增量的 UGC 分层（划线/书签/笔记），不整键全量重写 */
  const LS_KEYS = new Set(Object.values(K).filter(k => !k.endsWith('_') && !IDB_NAMES.has(k)));
  /* K 表值集合预建一次——isUGCKey 在 setCritical 热路径每次全表 values+indexOf */
  const _K_SET = new Set(Object.values(K));

  /* ===== 写修订计数（记忆化的失效真源）=====
     每个键一个单调计数器，凡经 lsSet 成功写入即 +1、lsRemove 即清零。
     为什么挂在 lsSet 而不是 setCritical：lsSet 是全库最低写入漏斗——
     setCritical、store.mutate、store.mergeWrite、备份恢复 _apply、工作区
     同步 restore、deleteBook 级联清理全部经它落地；挂在更高层会漏掉
     直接调 lsSet 的调用点（如 BF.app._doDelete 删书级联清 highlights）。
     消费方（BF.reader.applyHighlights）凭 rev(k) 与缓存时记下的旧值比对，
     即可判断「划线数组是否被改过」，无需每帧全量 JSON.parse + filter。
     跨标签页不在覆盖范围内——本文件无 storage
     事件监听，跨页 live 同步本就未接线（工作区同步走 OPFS 快照，恢复
     时同样经 lsSet，计数器照常 bump）。 */
  const _revs = {};
  /* 每个键的「上一次读是不是盲读」：getItem 抛错时读到的默认值不代表表是空的。
     见 lsGet / lsSet 里的整表写回闸门。 */
  const _blindRead = {};
  function rev(k) { return _revs[k] || 0; }

  /* ===== localStorage ===== */
  /* 早期版本把短值原样写进盘（没走 JSON.stringify），'apple' 这类裸词按
     JSON 解析必然失败，却并不是损坏。只在解析已经失败之后判，正常读路径零开销；
     带 JSON 结构字符的一律仍算损坏——截断的大对象都从这些字符起头。 */
  function _looksLegacyBare(raw) {
    return typeof raw === 'string' && raw.trim() !== '' && raw.length <= 64 && !/[{}\[\]":,]/.test(raw);
  }
  /* 已隔离过的键：坏值每次读到都会走一遍隔离，按时间戳另起一条 ≤20KB 副本的话，
     坏键会把 corrupt 区自己撑爆（并连带把配额告警喂成假高）。每键一槽、每会话只出声一次。 */
  const _isolated = new Set();
  /* corrupt 区每键一槽存原值：整份写得下就存整份，写不下才截断。
     副本形状保持「键 → 原值字符串」，运维台与导出路径照旧读它。 */
  function _isolate(k, raw) {
    let c;
    try { c = JSON.parse(localStorage.getItem(PREFIX + K.CORRUPT) || '{}'); } catch (e) { c = {}; }
    c[k] = raw;
    try { localStorage.setItem(PREFIX + K.CORRUPT, JSON.stringify(c)); _corruptTouch(k); return true; } catch (e2) {}
    c[k] = String(raw).slice(0, 20000);
    try { localStorage.setItem(PREFIX + K.CORRUPT, JSON.stringify(c)); _corruptTouch(k); return true; } catch (e3) {}
    /* 两次都写不进：隔离区里没有这份原文的任何一个字节。
       这条必须出声——调用方据此改口径，否则提示会说「原文已备份」而实际没备份。 */
    try { BF.log && BF.log.warn('损坏隔离区写入失败：' + k + ' 原文未能留存（配额或存储不可用）'); } catch (e4) {}
    return false;
  }
  /* 损坏进入时间另存一份并行键（corrupt 主键 + '_t'），不改 c[k] 的「键 → 原值字符串」形状：
     运维台与导出路径都按这个形状读 c[k]，新增字段只能另起一份映射。 */
  function _corruptTouch(k) {
    let t;
    try { t = JSON.parse(localStorage.getItem(PREFIX + K.CORRUPT + '_t') || '{}'); } catch (e) { t = {}; }
    t[k] = Date.now();
    /* 时间戳是附属信息：写不进不影响「原文已在隔离区」这一事实，静默放弃即可——
       读侧把缺失当「未知」显示（corruptTime 返回 null，界面走 '—'）。 */
    try { localStorage.setItem(PREFIX + K.CORRUPT + '_t', JSON.stringify(t)); } catch (e2) {}
  }
  function corruptTime(k) {
    try { const t = JSON.parse(localStorage.getItem(PREFIX + K.CORRUPT + '_t') || '{}'); return t && t[k] ? t[k] : null; } catch (e) { return null; }
  }
  function corruptHas(k) {
    try { const c = JSON.parse(localStorage.getItem(PREFIX + K.CORRUPT) || '{}'); return !!(c && c[k]); } catch (e) { return false; }
  }
  /* 损坏副本是「书架刚被读坏」的唯一凭据：孤儿清理靠它把自己按住，恢复书架靠它确认来历。
     书架从正文库重建成功之后，这份垃圾原文就没有下一步用途了，清掉它 ——
     留着会让残留清理永久失效（正文只增不减）。 */
  function corruptClear(k) {
    try {
      const c = JSON.parse(localStorage.getItem(PREFIX + K.CORRUPT) || '{}');
      if (!c || !c[k]) return false;
      delete c[k];
      localStorage.setItem(PREFIX + K.CORRUPT, JSON.stringify(c));
      try {
        const t = JSON.parse(localStorage.getItem(PREFIX + K.CORRUPT + '_t') || '{}');
        if (t && t[k]) { delete t[k]; localStorage.setItem(PREFIX + K.CORRUPT + '_t', JSON.stringify(t)); }
      } catch (e2) {}
      /* 条目被用户清掉后，同键再次读坏要能重新隔离并重新出声——
         否则本次会话的「已处理」记忆会让第二次损坏静默覆盖。 */
      _isolated.delete(k);
      return true;
    } catch (e) { return false; }
  }
  /* 损坏闭环：原值先进 corrupt 区，再把主键重置成可用默认值，最后出声一次。
     「parse 失败」与「parse 成功但形状不对」两条来路共用它。
     只备份不重置：下一次 mutate 会拿「读成空」的默认值整键覆盖，损坏原文连副本都不剩。
     只重置不备份：承重键（书架 / 高亮）就此悄悄换成空数组，既无从恢复，也不会让残留清理
     按住自己 —— 那份 corrupt 凭据正是「书架刚被读坏、此刻的空不是真的空」的唯一证据。
     备份每次都做（副本留最新那份），日志与提示只在本次会话第一次：同一键反复读到坏值
     不该刷出多条吐司，但每一次的原文都得留下。 */
  function _isolateAndReset(k, raw, d) {
    const firstTime = !_isolated.has(k);
    _isolated.add(k);
    const stored = _isolate(k, raw);
    if (firstTime) {
      try { BF.log && BF.log.warn('数据损坏隔离：' + k + (stored ? ' 原文已存 corrupt 区，主键已重置为默认值' : ' 原文没能存进 corrupt 区，主键已重置为默认值')); } catch (e3) {}
      try {
        BF.noti && BF.noti.warn(stored
          ? '检测到本地数据损坏，原文已备份，这一项已重置为默认值'
          : '检测到本地数据损坏，但存储空间不够，原文没能留下副本；这一项已重置为默认值', {
          action: { label: '去数据栏处理', run: function () { try { if (BF.workbench && BF.workbench.open) BF.workbench.open('data'); } catch (e4) {} } },
        });
      } catch (e5) {}
    }
    /* 只有调用方给了默认值才重置（没给默认值时重置成 undefined 会写出第二个坏值） */
    if (d !== undefined) { try { lsSet(k, d); } catch (e6) { BF.err.report('store.corruptReset', e6); } }
    return d;
  }
  function lsGet(k, d) {
    let raw;
    /* getItem 抛错（存储被禁用 / SecurityError / 驱动异常）时这次读是「不知道」，
       不是「没有」。把默认值当真实状态交下去，调用方接着「读→合并→整表写回」，
       整张表就被顶成只剩新加的那一条 —— 书签/生词/便签/标注会整表没掉，
       而界面上一切正常。所以这里记下盲读状态，lsSet 据此拒绝整表写回。 */
    try { raw = localStorage.getItem(PREFIX + k); _blindRead[k] = false; } catch (e) { _blindRead[k] = true; return d; }
    if (raw == null) return d;
    try { return JSON.parse(raw); } catch (e) {
      if (_looksLegacyBare(raw)) return raw;
      /* 损坏隔离的闭环见 _isolateAndReset：备份 + 重置 + 出声，三者缺一不可。 */
      return _isolateAndReset(k, raw, d);
    }
  }
  /* 数组键读取的形状校验——localStorage 可能被其它来源写成非数组
     （如某次异常写入 {"a":1} 或字符串），原 lsGet 直接返回该值，下游
     .map/.filter/.find 立刻崩。这里校验"确为数组"，否则回退默认值并告警。 */
  function lsGetArray(k, d) {
    const v = lsGet(k, d);
    if (Array.isArray(v)) return v;
    if (v == null) return d;
    /* 能解析成 JSON 却不是数组，与 parse 失败是同一件事：这一键已经不是它声称的东西。
       直接覆盖成默认值会让坏原文当场蒸发且无人知情，所以走同一条隔离路，覆盖前先留副本。 */
    let raw = null;
    try { raw = localStorage.getItem(PREFIX + k); } catch (e) { return d; }
    if (typeof raw !== 'string') return d;
    return _isolateAndReset(k, raw, d);
  }
  /* 按「写修订计数」记忆解析结果：逐本读同一张大表时，每本各 parse 一遍全表
     ⇒ 50 本书的书架每次渲染就是 50 次全表 parse。
     失效判据直接复用上面的 rev(k)——lsSet 成功即 bump，它是全库最低写入漏斗，
     不另造第二套作废机制（撤销快照直写、备份恢复直写都照常 bump）。
     键不存在时显式清缓存，不让「rev 被 lsRemove 归零」和旧缓存对上号。
     代价是返回的对象必须当只读用（改了不改盘）。只给热路径用，普通读取继续走 lsGet。 */
  const _parseMemo = {};
  function lsGetMemo(k, d) {
    let raw = null;
    try { raw = localStorage.getItem(PREFIX + k); } catch (e) { return lsGet(k, d); }
    if (raw == null) { delete _parseMemo[k]; return d; }
    const r = rev(k);
    const hit = _parseMemo[k];
    if (hit && hit.rev === r) return hit.val;
    const val = lsGet(k, d);
    _parseMemo[k] = { rev: r, val: val };
    return val;
  }
  /* lsSet 三态返回：true=已写入；LS_QUOTA=被配额闸门拦下（不是后端故障）；false=真异常。
     两个非真值都表示「没写进去」，调用方按 falsy 判断即可；
     只有 === false 才是存储异常，配额拦截不许算进断路器连续失败。 */
  const LS_QUOTA = null;
  function lsSet(k, v, opts) {
    try {
      /* 盲读之后的整表写回一律拒绝：不知道旧表长什么样，就不要拿一张
         「默认值 + 新条目」的表去顶掉它——顶掉的后果是整表数据消失且无声。
         报一次写入失败比丢一整张表便宜。非数组（设置、单对象）是从内存
         整体落盘，不依赖旧值，不在此列。
         force 是给「按备份整表覆盖」与它的回滚留的正门：那两种写本来
         就是要用另一份数据替换现状，不该被本次会话的读失败挡住。 */
      if (Array.isArray(v) && _blindRead[k] && !(opts && opts.force)) {
        /* 拒绝之前先给「读不到」一次重试：抛错常常是一次性的（隐私模式、瞬时锁、
           上一次的配额异常）。现在能读到就不算盲写，照常写下去。
           判据一点没放松——仍然读不到才拒，那时候旧表是什么样子我们确实不知道。 */
        try { localStorage.getItem(PREFIX + k); _blindRead[k] = false; } catch (e2) {}
        if (_blindRead[k]) {
          /* 这两条早退不是配额失败，必须把旗标打回 false：
             留着上一次配额失败的 true，会让调用方为一次无关失败跑腾退阶梯。 */
          BF.store.__lastSetQuota = false;
          BF.err.report('store.blindWrite', new Error('上一次读「' + k + '」没读到（存储不可读），已拒绝整表写回，旧数据未被覆盖'));
          return false;
        }
      }
      if (!writeAllowed(k) && !(opts && opts.force)) {   /* 按 key 分类闸门：非关键写入（自动备份/日志/会话/损坏记录）在占满时拒绝；force 只给腾退阶梯 */
        /* 这条早退的唯一原因就是配额满：置 true，调用方才会走配额反馈/腾退 */
        BF.store.__lastSetQuota = true;
        BF.log && BF.log.warn('配额已满（≥' + QUOTA_BLOCK + '%），非关键写入被阻断：' + k);
        return LS_QUOTA;
      }
      const s = JSON.stringify(v);
      localStorage.setItem(PREFIX + k, s);
      _revs[k] = (_revs[k] || 0) + 1;   /* 写修订计数：见上方声明处说明 */
      if (LS_KEYS.has(k)) {
        const back = localStorage.getItem(PREFIX + k);
        if (back !== s) BF.log && BF.log.warn('lsSet 回读不一致：' + k);
      }
      BF.store.__lastSetQuota = false;
      return true;
    } catch (e) {
      /* 配额满是「可预期、用户能自己处置」的状态，不是内部异常：人话提示由
         BF.store.setCritical 那一条负责。两个通道同时出声，一次写失败会刷出
         「内部异常已记录 + 存储不足 + 写入失败 + 已添加」四条互相矛盾的提示。
         __lastSetQuota 记下「这一次失败到底是不是配额」，让 setCritical 只在这种情况下
         走腾退阶梯 —— 腾退是真删数据（缓存/日志/最旧备份），删了也换不来空间的那种失败
         （序列化异常、SecurityError）不该顺手删掉用户的缓存。 */
      if (e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22 || e.code === 1014)) {
        BF.store.__lastSetQuota = true;
        BF.log && BF.log.warn('存储配额已满，本次写入未落盘：' + k);
        /* 配额失败返回 LS_QUOTA(null)，与 7173 的语义约定一致：它是「没写进去」
           而不是「后端故障」，不应连累断路器把整会话降级到 legacy 拓扑，也避免日志
           把排查方向指向「后端故障」。 */
        return LS_QUOTA;
      }
      BF.store.__lastSetQuota = false;
      BF.err.report('lsSet:' + k, e);
      return false;
    }
  }
  function lsRemove(k) {
    try { localStorage.removeItem(PREFIX + k); } catch (e) { BF.err.report('lsRemove:' + k, e); }
    delete _revs[k];   /* 键没了 → 修订归零，缓存消费方自然失效 */
  }
  function lsKeys() {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) out.push(k.slice(PREFIX.length));
    }
    return out;
  }
  /* ================= 占用与配额（基地与运维台共用同一份口径） =================
     diag 逐键遍历 localStorage 并硬编码 'bf_' 前缀；base 与 diag 都调这里的单一实现，
     显示单位各自决定（base 用 MB 两位小数、diag 用自适应单位），数值只此一处计算。 */

  /* 逐键字节占用：按大小倒序。SKIP 里的键体积大但对用户无意义
     （自动备份是快照、运行日志是环形缓冲），不排进明细避免挤掉真正的数据项。
     注意：比较对象是「剥掉前缀后的落盘键名」，必须与 BF.store.K 完全一致。
     此处曾写成大写字面量 'AUTOBACKUPS'/'LOG'，而 K 表是小写 → skip 恒不命中，
     体积最大的两个键反而一直排在明细最前。 */
  /* ===== 占用量口径（三处共用一份算法）=====
     localStorage 存的是 UTF-16 码元：一个字符按 2 字节折算，键名同样计入。
     usage() / quota() / lsUsagePct() 若各算各的，同一屏上「本地数据占用」和
     「浏览器配额已用」就会互相打脸（一处算字符、一处算字节，差整整一倍）。 */
  const LS_CHAR_CAP = 5 * 1024 * 1024;   /* 约 5M 字符 */
  const LS_BYTE_CAP = LS_CHAR_CAP * 2;   /* 折算成字节对外展示 */
  const LS_SAFE = 0.9;                   /* 闸门按 90% 提前收口，不撞真正的写入失败墙 */
  function lsBytes(chars) { return chars * 2; }
  function lsCharsNow() {
    /* 两笔分开算：chars=本程序（bf_ 前缀）的字符量（含键名），other=同一来源里
       别的页面写的。5M 字符的上限是整个来源共用的，不按前缀分配——只统计自己
       那一半，来源被别的键占满时这里仍显示 3%，闸门永不拦，等写关键数据时才真失败。
       枚举中途报错时把 failed 带出去：这时算出的是下限，占用率不能冒充真实低水位。 */
    let chars = 0, other = 0, failed = false;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k) continue;
        const n = k.length + (localStorage.getItem(k) || '').length;
        if (k.indexOf(PREFIX) === 0) chars += n; else other += n;
      }
    } catch (e) { failed = true; BF.err && BF.err.report('store.quotaProxy', e); }
    return { chars: chars, other: other, all: chars + other, failed: failed };
  }
  function lsPctOf(chars) { return (chars * 2) / (LS_BYTE_CAP * LS_SAFE) * 100; }   /* 字符 → 字节 → 占安全水位的百分比 */
  function usage(opt) {
    opt = opt || {};
    const skip = new Set(opt.skip || [K.AUTOBACKUPS, K.LOG]);
    const rows = [];
    let total = 0, skippedTotal = 0;
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (!k || k.indexOf(PREFIX) !== 0) continue;
        let len = 0;
        try { len = (localStorage.getItem(k) || '').length; } catch (e) { continue; }
        const name = k.slice(PREFIX.length);
        const bytes = lsBytes(k.length + len);
        total += bytes;
        if (skip.has(name)) { skippedTotal += bytes; continue; }
        rows.push({ key: name, lsKey: k, bytes: bytes });
      }
    } catch (e) { BF.err.report('store.usage', e); return { rows: [], total: 0, skippedTotal: 0, failed: true }; }
    rows.sort(function (a, b) { return b.bytes - a.bytes; });
    return { rows: rows, total: total, skippedTotal: skippedTotal, failed: false };
  }

  /* 浏览器配额：归一化成统一结构，UI 不用各写各的百分比算法。
     探测不到不返 null 而交给下方兜底代理 —— 调用方拿到 null 只能显示「无信息」，
     写入闸门就退回到 0%；两个旗标（proxy=配额是按 5MB 估的、degraded=字节量没读完）
     把「这个数是估算的」带到界面上，不冒充真实测量。 */
  async function quota() {
    try {
      if (navigator.storage && navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        if (est && est.usage != null && est.quota) {
          const c = lsCharsNow();
          return { usage: est.usage, quota: est.quota, pct: est.usage / est.quota * 100, lsPct: lsPctOf(c.all), lsOther: lsBytes(c.other) };
        }
      }
    } catch (e) {}
    /* 配额探测不可用时的兜底代理。浏览器不提供 storage.estimate（隐私模式/旧内核）
       或 quota 返回 0 时，这里如果继续 return null，_quotaPct 会恒为 0，
       block 级阻断永远不触发 —— 一道形同不存在的闸门比没有闸门更坏，
       因为它让写路径以为自己有保护。改用 localStorage 字节量估算占用率，
       至少能在撑爆（≥95%）时给出真实阻断信号。
       IDB 容量没有标准探测 API，仍感知不到，这是结构性限制。 */
    const c = lsCharsNow();
    /* usage 报的是本程序自己占的字节（界面显示用），pct 按整个来源算（闸门判据）：
       上限是来源共用的，只显示自己那一半就会在「其实已经满了」时报出低水位。 */
    const pct = lsPctOf(c.all);
    return { usage: lsBytes(c.chars), quota: LS_BYTE_CAP, pct: pct, lsPct: pct, lsOther: lsBytes(c.other), proxy: true, degraded: c.failed };
  }
  /* 配额三级：70% 黄（轻提示）、85% 红（强提示+建议关自动备份）、95% 阻断（非关键写入拒绝）。
     diag 视觉分档、quotaCheck 日志与写入闸门共用这一份判定，不各写各的。 */
  const QUOTA_WARN = 70, QUOTA_ALERT = 85, QUOTA_BLOCK = 95;
  let _quotaPct = 0;   /* 最近一次探测的占用百分比，供 writeAllowed 闸门读取 */
  function quotaTone(pct) { return pct >= QUOTA_BLOCK ? 'is-block' : pct > QUOTA_ALERT ? 'is-bad' : pct > QUOTA_WARN ? 'is-warn' : ''; }
  /* 配额水位等级：ok / warn / alert / block，供 UI 与写入闸门统一判定 */
  function lsUsagePct() {
    /* localStorage 是真实的硬上限（约 5M 字符）；origin 配额常达 10GB，永远到不了限，
       所以闸门必须额外按 LS 实际占用判定，否则灌满 LS 后关键数据静默丢失而面板还显示"空间充足"。
       与 usage() / quota() 共用 lsPctOf —— 同一屏上的两个占用数必须同一算法。
       按 all 而不是 chars：上限是整个来源的，同来源别的页面写的键一样会把空间吃掉，
       只算自己的 bf_ 那一半会在「其实已经写不进去」时判成 ok。 */
    return lsPctOf(lsCharsNow().all);
  }
  function quotaLevel() {
    let lv = 'ok';
    if (_quotaPct >= QUOTA_BLOCK) lv = 'block';
    else if (_quotaPct > QUOTA_ALERT) lv = 'alert';
    else if (_quotaPct > QUOTA_WARN) lv = 'warn';
    const lp = lsUsagePct();
    let llv = 'ok';
    if (lp >= QUOTA_BLOCK) llv = 'block';
    else if (lp > QUOTA_ALERT) llv = 'alert';
    else if (lp > QUOTA_WARN) llv = 'warn';
    const order = { ok: 0, warn: 1, alert: 2, block: 3 };
    return order[llv] > order[lv] ? llv : lv;  /* 取 origin 与 LS 中更紧的一档 */
  }
  /* 写入闸门：仅当「非关键写入」且水位已达 block 级时拒绝，避免配额耗尽时
     自动备份/缓存等大体积写入把仅剩空间挤爆、连带丢失用户关键数据。
     关键写入（书籍/标注/设置）始终放行 —— 不静默丢弃用户数据。 */
  const NONCRITICAL_KEYS = new Set([K.AUTOBACKUPS, K.LOG, K.TTS_SESSION, K.AI_SESSIONS, K.CORRUPT]);
  function writeAllowed(k) {
    /* 按 key 分类闸门：自动备份/日志/会话/损坏记录等非关键写入在 LS 占满时被拦截，保关键数据不静默丢失 */
    if (NONCRITICAL_KEYS.has(k) && quotaLevel() === 'block') return false;
    return true;
  }

  /* ===== P4.1 / P4.2 双桶余量 + 尺寸闸门（跨介质泄洪的计量基础）================
     真实场景是介质容量不对称：IDB/OPFS 可能被配额压力驱逐或清空，而 LS 反而很空。
     两个桶分开算，谁有余量往谁导：
       LS 桶    —— 约 5M 字符的硬墙，单键装不下整本大书（UTF-16 折算）；
       origin 桶 —— storage.estimate 的 quota-usage，IDB 与 OPFS 共用这份配额。
     同步口径（lsFreeBytes / estimateCatBytes / lsFits）供 allocOf 在同步路径上做闸门；
     async mediaBudget() 供规划器/面板读两个桶的真实剩余字节。两者共用 lsCharsNow/lsPctOf，
     不另起计量（P4.2「勿另起计量」）。 */
  function lsFreeBytes() {
    const c = lsCharsNow();
    return Math.max(0, LS_BYTE_CAP * LS_SAFE - lsBytes(c.all));
  }
  /* 各类当前体量的同步估算（保守下限，仅用于尺寸闸门/规划排序，不冒充精确计量）。
     body 按单本典型 300KB×本数；摘要取 LS 实测；章节/音频/索引异步精确值由面板异步补。 */
  const _EST_PER_BOOK = 300 * 1024;
  function estimateCatBytes(cat) {
    try {
      if (cat === 'body') {
        const meta = lsGetArray(K.BOOKS_META, []);
        return (Array.isArray(meta) ? meta.length : 0) * _EST_PER_BOOK;
      }
      if (cat === 'aiSummary') {
        const u = usage({ skip: [] });
        const row = (u.rows || []).find(function (r) { return r.key === K.AI_SUMMARY_CACHE; });
        return row ? row.bytes : 0;
      }
    } catch (e) {}
    return 0;
  }
  /* 单块内容能否装进 LS：同时受「当前余量」与「单键整桶上限」约束。
     正文单本 ≤ 300KB 估，远小于 5M 字符桶——小书在 LS 空时可落 LS；大书估算超限时回落。 */
  function lsFits(bytes) {
    const b = Number(bytes) || 0;
    return b <= lsFreeBytes() && b <= LS_BYTE_CAP * LS_SAFE;
  }
  async function mediaBudget() {
    let q = null;
    try { q = await quota(); } catch (e) {}
    const c = lsCharsNow();
    const lsCap = LS_BYTE_CAP * LS_SAFE;
    const lsUsed = lsBytes(c.all);
    const lv = quotaLevel();
    return {
      ls: { capBytes: lsCap, usedBytes: lsUsed, freeBytes: Math.max(0, lsCap - lsUsed), pct: lsPctOf(c.all) },
      origin: {
        capBytes: (q && q.quota) || 0, usedBytes: (q && q.usage) || 0,
        freeBytes: Math.max(0, ((q && q.quota) || 0) - ((q && q.usage) || 0)),
        pct: (q && q.pct) || 0, proxy: !!(q && q.proxy)
      },
      opfs: !!(BF.fsync && BF.fsync.available),
      idb: !!window.indexedDB,
      level: lv, tight: (lv === 'alert' || lv === 'block')
    };
  }

  /* ===== P4c 运行时介质失衡重分配（提示式，不静默改设置）========================
     监测到某区水位高而另一区有明显余量（如 IDB/OPFS 满、LS 空，或反向），
     给出「建议重新分配」的提示事件。绝不自动写 storageAlloc——应用仍须经
     applyStoragePlan 授权弹窗（沿用已验收的边界）。节流：同一会话最多提示 2 次，
     两次间隔 ≥ 60s，不在 quotaCheck 每次调用都刷。 */
  let _rebalanceCount = 0, _rebalanceLast = 0;
  const REBALANCE_COOL = 60 * 1000;
  async function rebalanceAdvisory() {
    try {
      if (_rebalanceCount >= 2) return null;
      const now = Date.now();
      if (now - _rebalanceLast < REBALANCE_COOL) return null;
      const b = await mediaBudget();
      if (!b.tight && !(b.origin.capBytes > 0 && b.origin.freeBytes < 8 * 1024 * 1024)) return null;
      const lsRoomy = b.ls.freeBytes > 16 * 1024 * 1024;
      const originRoomy = b.origin.capBytes > 0 && b.origin.freeBytes > 128 * 1024 * 1024;
      let advice = null;
      if (b.tight && lsRoomy) advice = 'IDB/OPFS 空间紧张而本地存储仍空，建议把正文/缓存重新分配到本地存储泄洪';
      else if (b.level === 'alert' && originRoomy && b.ls.pct > 80) advice = '本地存储接近上限而 IndexedDB/OPFS 仍空，建议把可重建内容迁出本地存储';
      if (!advice) return null;
      _rebalanceCount++; _rebalanceLast = now;
      const payload = { advice: advice, level: b.level, lsFreeBytes: b.ls.freeBytes, originFreeBytes: b.origin.freeBytes };
      try { BF.bus && BF.bus.emit('storage:rebalance', payload); } catch (e) {}
      try { BF.log && BF.log.info('存储失衡提示：' + advice); } catch (e) {}
      return payload;   /* 只读建议，调用方据此提示用户；不写任何设置 */
    } catch (e) { return null; }
  }

  async function quotaCheck() {
    const q = await quota();
    if (!q) return null;
    _quotaPct = q.pct;
    const _lv = quotaLevel();   /* origin 与 LS 取更紧的一档：写入闸门用的就是这一份 */
    if (q.degraded) BF.log && BF.log.warn('存储占用率只估算到一半（浏览器拒绝继续枚举），显示值是下限，不代表真的宽裕');
    if (q.pct > QUOTA_ALERT) BF.log && BF.log.warn('存储容量告警：已用 ' + q.pct.toFixed(0) + '%（建议清理或导出备份）');
    if ((q.lsPct || 0) >= QUOTA_BLOCK) BF.log && BF.log.warn('本地存储(localStorage)已接近 5MB 上限(约 ' + Math.round(q.lsPct || 0) + '%)，非关键写入将被暂停，请清理或导出备份' +
      /* 上限是整个来源共用的：占用大头若来自同一来源的其它页面，本程序的腾退阶梯
         一个都清不掉，此时只说「请清理」是把用户指到不存在的地方。 */
      ((q.lsOther || 0) > 512 * 1024 ? '（其中约 ' + Math.round(q.lsOther / 1024) + 'KB 由同一来源的其它页面写入，本程序无法清理）' : ''));
    if (_lv === 'block') {
      try { BF.bus && BF.bus.emit(BF.EVENTS.STORAGE_QUOTA, { pct: q.pct, level: 'block' }); } catch (_) {}
    }
    /* P4c：失衡时给「建议重新分配」提示（只读、节流、不静默改设置），不阻塞本函数主返回。 */
    Promise.resolve(rebalanceAdvisory()).catch(function () {});
    /* 分档一律取 quotaLevel（origin 与 LS 中更紧的一档）：
       只看 origin pct 时，LS 已经写不进、闸门已在拦，界面仍报「空间充足」。 */
    return { pct: q.pct, warn: _lv === 'alert' || _lv === 'block', block: _lv === 'block', tone: quotaTone(q.pct) };
  }

  /* 一次性迁移：NOTES 键名 'pk_notes' 为自复制时的残留（实存 bf_pk_notes），归位为 'notes' */
  try {
    if (localStorage.getItem(PREFIX + 'pk_notes') != null) {
      if (localStorage.getItem(PREFIX + 'notes') == null) {
        localStorage.setItem(PREFIX + 'notes', localStorage.getItem(PREFIX + 'pk_notes'));
      }
      localStorage.removeItem(PREFIX + 'pk_notes');
    }
  } catch (e) { BF.err.report('store.migrateNotesKey', e); }

  /* ===== IndexedDB ===== */
  const DB_NAME = 'beifeng_db', DB_VERSION = 4;  /* 版本 2 补建 'kv'；版本 3 给 'ugc' 补索引（读写不再全表）；版本 4 给 'chapters' 补 'bk'（bookId）索引 —— 归属类扫描不再搬正文。onupgradeneeded 只补建缺失项，旧库安全升级 */
  let _dbP = null;
  function openDB() {
    if (_dbP) return _dbP;
    let _rej;
    let _timer = null;
    let _timedOut = false;
    const _clearTimer = function () { if (_timer) { try { _timer(); } catch (e) {} _timer = null; } };
    const p = new Promise(function (res, rej) {
      _rej = rej;
      try {
        const r = indexedDB.open(DB_NAME, DB_VERSION);
        r.onupgradeneeded = function (e) {
          const d = e.target.result;
          for (const s of IDB_NAMES) {
            if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
          }
          /* 'ugc' 三条索引：按(种类,书)取、按种类取、按书删。
             没有索引时每次读写都要 getAll 把整表拉进内存再 filter ——
             三万条标注就是每次写一条都要搬一遍全表。旧库升级只加索引，不动数据。 */
          if (e.target.transaction && d.objectStoreNames.contains('ugc')) {
            const us = e.target.transaction.objectStore('ugc');
            if (!us.indexNames.contains('kind_book')) us.createIndex('kind_book', ['kind', 'bk']);
            if (!us.indexNames.contains('kind')) us.createIndex('kind', 'kind');
            if (!us.indexNames.contains('bk')) us.createIndex('bk', 'bk');
          }
          /* 'chapters' 的 bookId 索引：启动自愈与按书清理要的只是「哪些段属于哪本书」，
             而一条记录揣着整段正文的压缩体。没索引时这类扫描只能 getAll 搬全表 ——
             实测 13 万段十几秒，而它就发生在启动链路上。旧库升级只加索引，不动数据。
             注意：bookId 缺失的旧记录不会进索引，也就不会被判成孤儿删掉 ——
             宁可留一点认不出主人的残留，也不拿"看不见"当"没有"去删。 */
          if (e.target.transaction && d.objectStoreNames.contains('chapters')) {
            const cs = e.target.transaction.objectStore('chapters');
            if (!cs.indexNames.contains('bk')) cs.createIndex('bk', 'bookId');
          }
        };
        r.onsuccess = function (e) {
          _clearTimer();
          const db = e.target.result;
          /* 8s 兜底已经把这个 Promise 判死了：晚到的连接必须当场关掉。
             留一条没人用的连接，下一次版本升级就会被它 block（表现成「其它标签页占用」）。 */
          if (_timedOut) { try { db.close(); } catch (_) {} return; }
          db.onversionchange = function () { try { db.close(); } catch (_) {} _dbP = null; };
          res(db);
          try { BF.bus && BF.bus.emit(BF.EVENTS.IDB_UP); } catch (_) {}
        };
        r.onerror = function (e) {
          _clearTimer();
          if (_timedOut) return;
          _dbP = null;
          rej(r.error);
          try { BF.bus && BF.bus.emit(BF.EVENTS.IDB_DOWN, r.error); } catch (_) {}
        };
        /* 旧标签页仍持有低版本连接时升级被阻塞：明确报错，而非永久转圈 */
        r.onblocked = function () {
          _clearTimer();
          if (_timedOut) return;
          _dbP = null;
          try { BF.bus && BF.bus.emit(BF.EVENTS.IDB_DOWN, new Error('blocked')); } catch (_) {}
          rej(new Error('IndexedDB 升级被其它北风标签页占用，请先关闭其它标签页再试'));
        };
      } catch (e) { _dbP = null; rej(e); }
    });
    _dbP = p;
    /* 8s 超时兜底：打开不许永久挂起。成功时必须把定时器撤掉 ——
       否则 8 秒后它会把一个已经好的连接从缓存里删掉，下一次调用又开一条，
       旧连接没人关，连接越攒越多。 */
    if (BF.timers && BF.timers.timeout) _timer = BF.timers.timeout(function () {
      _timedOut = true;
      _dbP = null;
      if (_rej) try { _rej(new Error('IndexedDB 打开超时（8s）')); } catch (_) {}
    }, 8000);
    return p;
  }
  /* 读 IDB 整表。默认把失败折成 []，但「读失败」与「这张表本来就是空的」
     是两件事：删除、重分章、备份快照都拿这个数组当依据，折成空数组等于告诉
     它们「没有旧章节」，于是不删、漏删、写出零正文的备份，回执却仍是成功。
     需要区分的地方传 {strict:true}，异常照抛出，由调用方决定怎么退。 */
  async function idbGetAll(store, opts) {
    const strict = !!(opts && opts.strict);
    try {
      const db = await openDB();
      return await new Promise(function (res, rej) {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAll();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => rej(req.error);
      });
    } catch (e) { BF.err.report('idbGetAll:' + store, e); if (strict) throw e; return []; }
  }
  /* 索引取键名：只要「这段的主键」，不要记录本体。
     注意 index.getAll() 返回的是整条记录（不是索引键），index.getAllKeys() 才是主键 ——
     归属扫描若用 getAll 就等于什么都没省，这个坑由真机功能测试抓到过。
     strict 语义与 idbGetAll 一致：默认折成 []，作为删除依据时必须传 strict。 */
  async function idbIndexKeys(store, index, range, opts) {
    const strict = !!(opts && opts.strict);
    try {
      const db = await openDB();
      return await new Promise(function (res, rej) {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).index(index).getAllKeys(range);
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => rej(req.error);
      });
    } catch (e) { BF.err.report('idbIndexKeys:' + store + '.' + index, e); if (strict) throw e; return []; }
  }
  /* 索引取记录本体：只要「这本书的那几段」，仍不碰别的书。
     重分章与 AI 分章在改边界前要把旧记录留成撤销快照，那是唯一真需要本体的场合。 */
  async function idbIndexRecords(store, index, range, opts) {
    const strict = !!(opts && opts.strict);
    try {
      const db = await openDB();
      return await new Promise(function (res, rej) {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).index(index).getAll(range);
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => rej(req.error);
      });
    } catch (e) { BF.err.report('idbIndexRecords:' + store + '.' + index, e); if (strict) throw e; return []; }
  }
  /* 索引去重取键：列出这张表里「有哪些不同的归属」，一次请求跳一个不同键。
     用 openKeyCursor(lowerBound(上一个键, exclusive)) 逐键前进 —— 请求数是**不同键的个数**
     （书的数量），不是记录数（章节的数量）；且 openKeyCursor 不取记录本体，
     所以十万段正文一次都不搬。 */
  async function idbIndexDistinct(store, index, opts) {
    const strict = !!(opts && opts.strict);
    try {
      const db = await openDB();
      const out = [];
      let lower;
      for (;;) {
        const k = await new Promise(function (res, rej) {
          const tx = db.transaction(store, 'readonly');
          const ix = tx.objectStore(store).index(index);
          const req = ix.openKeyCursor(lower === undefined ? undefined : IDBKeyRange.lowerBound(lower, true));
          req.onsuccess = () => res(req.result ? req.result.key : null);
          req.onerror = () => rej(req.error);
        });
        if (k === null || k === undefined) break;
        out.push(k);
        lower = k;
        if (out.length > 50000) break;   /* 异常形状自保：归属数不可能到这个量级，宁可停在这里 */
      }
      return out;
    } catch (e) { BF.err.report('idbIndexDistinct:' + store + '.' + index, e); if (strict) throw e; return []; }
  }
  /* 整表只取主键：比 getAll 少搬走全部值，用于"键即归属"的表（chapter_titles 以书 id 为键）。 */
  async function idbAllKeys(store, opts) {
    const strict = !!(opts && opts.strict);
    try {
      const db = await openDB();
      return await new Promise(function (res, rej) {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).getAllKeys();
        req.onsuccess = () => res(req.result || []);
        req.onerror = () => rej(req.error);
      });
    } catch (e) { BF.err.report('idbAllKeys:' + store, e); if (strict) throw e; return []; }
  }
  async function idbGet(store, key) {
    try {
      const db = await openDB();
      return await new Promise(function (res, rej) {
        const tx = db.transaction(store, 'readonly');
        const req = tx.objectStore(store).get(key);
        req.onsuccess = () => res(req.result === undefined ? null : req.result);
        req.onerror = () => rej(req.error);
      });
    } catch (e) { BF.err.report('idbGet:' + store, e); return null; }
  }
  async function idbPutAll(store, items) {
    try {
      const db = await openDB();
      return await new Promise(function (res, rej) {
        const tx = db.transaction(store, 'readwrite');
        const st = tx.objectStore(store);
        for (const d of items) st.put(d, d && d.id != null ? d.id : undefined);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error || new Error('IDB 事务失败'));
        tx.onabort = () => rej(tx.error || new Error('IDB 事务中止'));
      });
    } catch (e) { BF.err.report('idbPutAll:' + store, e); throw e; }
  }
  async function idbDelete(store, key) {
    try {
      const db = await openDB();
      return await new Promise(function (res, rej) {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).delete(key);
        tx.oncomplete = res;
        /* onabort 必须显式挂：事务被 abort 时只触发 onabort、不触发 onerror，
           缺了它 rej 永不调用 → 返回的 Promise 永久 pending → 删书与导入回滚链整体挂死。 */
        tx.onerror = () => rej(tx.error || new Error('IDB 事务失败'));
        tx.onabort = () => rej(tx.error || new Error('IDB 事务中止'));
      });
    } catch (e) { BF.err.report('idbDelete:' + store, e); throw e; }
  }
  /* 批量删除：500 键一事务。逐键一事务时一千条残留就是一千次 commit 往返
     （启动自愈正是卡在这里），整批一起提交，中途只可能丢一批。
     失败的批次报错后继续下一批，返回**已提交**的键数 —— 调用方拿到的数
     是「真删掉了多少」，不是「打算删多少」。 */
  async function idbDeleteMany(store, keys) {
    if (!keys || !keys.length) return 0;
    let db;
    try { db = await openDB(); } catch (e) { BF.err.report('idbDeleteMany.open:' + store, e); return 0; }
    let done = 0;
    for (let i = 0; i < keys.length; i += 500) {
      const part = keys.slice(i, i + 500);
      try {
        await new Promise(function (res, rej) {
          const tx = db.transaction(store, 'readwrite');
          const st = tx.objectStore(store);
          for (const k of part) st.delete(k);
          tx.oncomplete = res;
          tx.onerror = () => rej(tx.error || new Error('IDB 事务失败'));
          tx.onabort = () => rej(tx.error || new Error('IDB 事务中止'));
        });
        done += part.length;
      } catch (e) { BF.err.report('idbDeleteMany:' + store, e); }
    }
    return done;
  }
  async function idbRestore(store, items) {
    try {
      const db = await openDB();
      return await new Promise(function (res, rej) {
        const tx = db.transaction(store, 'readwrite');
        const st = tx.objectStore(store);
        st.clear();
        for (const d of items) st.put(d, d && d.id != null ? d.id : undefined);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error || new Error('IDB 事务失败'));
        tx.onabort = () => rej(tx.error || new Error('IDB 事务中止'));
      });
    } catch (e) { BF.err.report('idbRestore:' + store, e); throw e; }
  }

  /* UGC→IDB 分层 —— 通用 KV store（'kv'）单键读写封装。
     只承载 UGC 的 durable 副本，不参与主读取（主读取仍是 LS，零破坏）。
     必须用单条事务提交：拆成两条事务时，两条之间崩掉会留下「新值已落、旧值无处可寻」的半成品。 */
  async function idbKeyPut(k, v) {
    try {
      const db = await openDB();
      return await new Promise(function (res, rej) {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(v, k);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error || new Error('IDB 事务失败')); tx.onabort = () => rej(tx.error || new Error('IDB 事务中止'));
      });
    } catch (e) { BF.err.report('idbKeyPut:' + k, e); throw e; }
  }
  /* 一组 kv 写进同一条事务提交：ops=[{k,v}|{k,del:true}]。
     分几条事务时，中途崩掉会留下「新值已落、回滚源没写下」的半成品；
     一条事务里要么全落要么全不落。 */
  async function idbKeyTxn(ops) {
    const db = await openDB();
    return await new Promise(function (res, rej) {
      const tx = db.transaction('kv', 'readwrite');
      const st = tx.objectStore('kv');
      for (const o of (ops || [])) { if (o.del) st.delete(o.k); else st.put(o.v, o.k); }
      tx.oncomplete = res;
      tx.onerror = function () { rej(tx.error || new Error('IDB 事务失败')); };
      tx.onabort = function () { rej(tx.error || new Error('IDB 事务中止')); };
    });
  }
  async function idbKeyGet(k, d) {
    try {
      const db = await openDB();
      return await new Promise(function (res, rej) {
        const tx = db.transaction('kv', 'readonly');
        const req = tx.objectStore('kv').get(k);
        req.onsuccess = () => res(req.result !== undefined ? req.result : d);
        req.onerror = () => rej(req.error);
      });
    } catch (e) { BF.err.report('idbKeyGet:' + k, e); return d; }
  }
  async function idbKeyDelete(k) {
    try {
      const db = await openDB();
      return await new Promise(function (res, rej) {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').delete(k);
        tx.oncomplete = res; tx.onerror = () => rej(tx.error || new Error('IDB 事务失败')); tx.onabort = () => rej(tx.error || new Error('IDB 事务中止'));
      });
    } catch (e) { BF.err.report('idbKeyDelete:' + k, e); throw e; }
  }
  /* UGC 分层判定：仅 K 枚举内、非隐私、非瞬态、非动态前缀键参与 IDB 副本；
     动态前缀键（SCROLL_/PROGRESS_）与独立字符串键（perbook_prefs 等）不入库副本。
     SETTINGS 必须排除：它不是 UGC，而是一份装着密钥载体的配置表
     （aiApiKey / mimoApiKey / pinHash / pinSalt / pinLock / aiLock 都住在这个对象里）。
     镜像进 IDB 等于给密钥多加一个落点——恢复默认、_secretGate 写、备份剥离
     三条删除路径全都只认 localStorage 那一份，副本就成了删不掉的明文；
     而 IDB 对同源脚本可读，比 localStorage 还多一份暴露面。 */
  const _UGC_EXCLUDE = new Set([K.AI_SUMMARY_CACHE, K.CORRUPT, K.NAV_HIST, K.SEARCH_HIST, K.LOG, K.AUTOBACKUPS, K.TTS_SESSION, K.CHAPTERS, K.CHAPTER_TITLES, K.SETTINGS]);
  function isUGCKey(k) {
    if (PRIV_KEYS.has(k)) return false;
    if (_UGC_EXCLUDE.has(k)) return false;
    if (typeof k !== 'string' || k.endsWith('_')) return false;
    return _K_SET.has(k);
  }
  /* 持久化存储权限查询（storage.persist 状态），供设置/运维面板展示与自愈决策 */
  async function persistState() {
    const out = { supported: false, granted: false, state: 'unknown' };
    try {
      if (!navigator.storage || !navigator.storage.persist) return out;
      out.supported = true;
      if (navigator.storage.persisted) { try { out.granted = !!(await navigator.storage.persisted()); } catch (e) { BF.log && BF.log.warn('storage.持久化探测失败：' + (e && e.message)); } }
      if (navigator.permissions && navigator.permissions.query) {
        try { const st = await navigator.permissions.query({ name: 'persistent-storage' }); out.state = st.state || 'unknown'; } catch (e) {}
      }
    } catch (e) {}
    return out;
  }
  /* 持久化状态中文标签，供设置面板「数据」段展示 */
  function persistLabel() {
    const p = BF.store._persist;
    if (!p) return '检测中…';
    if (!p.supported) return '不支持（浏览器未提供持久化 API）';
    if (p.granted) return '已持久化（数据受保护，不易被自动清理）';
    if (p.state === 'prompt') return '未授权（浏览器可能在存储紧张时清理，建议手动授权）';
    if (p.state === 'denied') return '已拒绝（数据可能在存储紧张时被清理）';
    return '未持久化（数据可能在存储紧张时被浏览器清理）';
  }

  /* 缓存清理拆分：「可重建临时数据」与「自动备份快照」必须是
     两个独立操作——自动备份不是临时数据，随缓存一并删除等于静默销毁恢复点，
     确认文案还得明说「删除后无法找回」。确认各自内聚
     （BF.ask danger=2；「不再询问」对 danger≥2 由询问框架禁用）：
     - clearTransients()：AI 摘要缓存 / 导航历史 / 搜索历史 /
       内存预取 / 朗读音频缓存 —— 全部可重建；
     - clearBackups()：自动备份快照 —— 删除后无法找回。
     损坏隔离区不在「临时数据」里：那是书架被读坏时留下的唯一一份原文，
     同时也是残留清理把自己按住的凭据（corruptHas）。在这里顺手清掉，
     等于既销毁了恢复依据、又放开了正文被当孤儿删掉的那道闸
     （它只在「书架从正文库重建成功」之后由 corruptClear 清）。
     绝不碰书本身（IDB chapters）与用户数据
     （highlights/bookmarks/notes/books_meta/settings）。
     确认失败（含询问框架自身异常）一律 fail-closed：不清任何键。 */
  async function clearTransients() {
    var ok = false;
    try {
      ok = await BF.ask.confirm({
        title: '清空临时数据',
        body: '将清除 AI 摘要缓存、导航历史、搜索历史、内存预取与朗读音频缓存。<br/>这些数据可随时重建（朗读缓存重听一次即回）；书籍、笔记、书签、设置、<b>自动备份</b>与损坏隔离区不受影响。',
        danger: 2,
        op: 'cache.clearTransients',
        facts: { 范围: '可重建临时数据' }
      });
    } catch (e) { ok = false; }
    if (!ok) return { cleared: 0, cancelled: true };
    /* 撤销登记——清空前快照被清的键。动因是 CORRUPT
       损坏隔离区：那是一份不可重建的隔离数据，清掉就是最后
       一份没了；其余 4 键虽可重建，一并快照后「Ctrl+Z 可撤销」
       才名副其实（导航 / 搜索历史同样值得一撤）。 */
    const snap = {};
    /* CORRUPT 不在清空范围内，理由见上方注释：它既是唯一原文也是孤儿清理的闸门。 */
    const cacheKeys = [K.AI_SUMMARY_CACHE, K.NAV_HIST, K.SEARCH_HIST];
    cacheKeys.forEach(function (k) { try { const v = lsGet(k, null); if (v != null) snap[k] = v; } catch (e) { BF.log && BF.log.warn('storage.缓存快照读取失败：' + (e && e.message)); } });
    let cleared = 0;
    BF.act.run('清空临时数据', function () {
      cacheKeys.forEach(function (k) {
        try { if (lsGet(k, null) != null) { lsRemove(k); cleared++; } } catch (e) { BF.err.report('clean.cache.' + k, e); }
      });
      try { if (BF.reader && BF.reader.clearPrefetch) BF.reader.clearPrefetch(); } catch (e) {}
      /* 朗读音频缓存（IDB）一起清。它不进上面的撤销快照——重听一次即回，
         快照里塞几十 MB 音频既撑爆配额又撤不回来。 */
      try { if (BF.tts && BF.tts.cache && BF.tts.cache.clear) Promise.resolve(BF.tts.cache.clear()).catch(function (e) { BF.err.report('clean.cache.tts', e); }); } catch (e) { BF.err.report('clean.cache.tts', e); }
    }, {
      /* 清的是全局缓存键，与当前开着的书无关 ⇒ 不带书归属（否则换书后撤销被误拦） */
      bookId: null,
      undo: function () {
        Object.keys(snap).forEach(function (k) { try { lsSet(k, snap[k]); } catch (e) { BF.err.report('clean.cache.undo', e); } });
      },
    });
    return { cleared: cleared };
  }
  async function clearBackups() {
    var ok = false;
    try {
      ok = await BF.ask.confirm({
        title: '删除全部自动备份',
        body: '将删除全部自动备份快照，<b>删除后无法找回</b>。清理前先导出一份手动备份。',
        danger: 2,
        op: 'cache.clearBackups',
        facts: { 后果: '删除后无法找回' }
      });
    } catch (e) { ok = false; }
    if (!ok) return { cleared: 0, cancelled: true };
    var n = 0;
    try { if (lsGet(K.AUTOBACKUPS, null) != null) { lsRemove(K.AUTOBACKUPS); n = 1; } } catch (e) { BF.err.report('clean.autobackups', e); }
    /* 新拓扑：一并清掉 OPFS 上的自动备份文件，避免孤儿占用 */
    try {
      if (BF.snap) {
        const _fs = await BF.snap.list('auto', 'full');
        for (const _f of (_fs || [])) { try { await BF.snap.remove('auto', 'full', _f); } catch (e) {} }
      }
    } catch (e) { BF.err.report('clean.autobackups.opfs', e); }
    return { cleared: n };
  }
  /* ===== 会话级存储 =====
     用于「本次标签页有效、重开即失效」的数据 —— 当前唯一用途是 DSL 权限档位。
     权限必须存 sessionStorage 而不是 localStorage：localStorage 全库无复位代码，
     界面与手册里 9 处「仅本次会话生效」的承诺都会落空。
     注：file:// 下部分浏览器仍提供 sessionStorage；不可用时静默降级为
     「本次页面加载有效」，行为更严格而非更宽松。 */
  const SPREFIX = 'bf_s_';
  let _ssOK = true;
  try {
    const _probe = SPREFIX + '__p';
    sessionStorage.setItem(_probe, '1');
    sessionStorage.removeItem(_probe);
  } catch (e) { _ssOK = false; }
  function ssGet(k, d) {
    if (!_ssOK) return d;
    try {
      const raw = sessionStorage.getItem(SPREFIX + k);
      return raw == null ? d : JSON.parse(raw);
    } catch (e) { return d; }
  }
  function ssSet(k, v) {
    if (!_ssOK) return false;
    try { sessionStorage.setItem(SPREFIX + k, JSON.stringify(v)); return true; }
    catch (e) { return false; }
  }
  function ssRemove(k) {
    if (!_ssOK) return;
    try { sessionStorage.removeItem(SPREFIX + k); } catch (e) { BF.log && BF.log.warn('storage.会话清理失败：' + (e && e.message)); }
  }
  /* sessionStorage 不可用时的进程内替身：生命周期短于 localStorage，
     至少保证「关页面即失效」这一承诺不被违反。 */
  const _ssMem = {};
  function memGet(k, d) { return Object.prototype.hasOwnProperty.call(_ssMem, k) ? _ssMem[k] : d; }
  function memSet(k, v) { _ssMem[k] = v; return true; }
  function memRemove(k) { delete _ssMem[k]; }

  /* 隐私键唯一来源：任何「把设置/数据快照到本地或工作区」的地方都必须用它剔除。
     与 BF.bk、工作区同步 _collect 必须共用这份集合——各写一份会漂移成多个版本，
     PIN 哈希与盐就会在备份里被剔除、在工作区快照里却明文落盘。
     PIN 哈希只是单轮 SHA-256(salt+pin)，4 位码可瞬间枚举，比 API 密钥更敏感。 */
  const PRIV_KEYS = new Set(['aiApiKey', 'mimoApiKey', 'aiEndpoint', 'aiModel', 'pinHash', 'pinSalt', 'pinLock', 'aiLock', 'edgeToken', 'edgeSecVer']);

  /* ============ 双后端：v2（新拓扑）/ legacy（原层保底）============
     新拓扑：OPFS(正文 books/<id>/body.txt + 快照 snapshots/) + IDB('ugc' 按书增量) + LS(小键同步)
     模式(storageBackend 设置)：auto=优先 v2 且任一操作失败逐操作回落 legacy；
     next=强制 v2；legacy=强制原层。会话内 v2 连续失败触发断路器回落 legacy。 */
  async function idbUGCSet(kind, bookId, records) {
    try {
      const db = await openDB();
      await new Promise(function (res, rej) {
        const tx = db.transaction('ugc', 'readwrite');
        const st = tx.objectStore('ugc');
        /* 索引直接命中「该书该类」的旧键，清掉再写新 —— 不再 getAll 全表挑一遍 */
        const req = st.index('kind_book').getAllKeys(IDBKeyRange.only([kind, bookId]));
        req.onsuccess = function () {
          for (const key of (req.result || [])) st.delete(key);
          for (const r of (records || [])) { const _k = kind + ':' + bookId + ':' + (r && r.id != null ? r.id : '_'); st.put({ id: _k, bk: bookId, kind: kind, data: r }, _k); }
        };
        req.onerror = function () { rej(req.error); };
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error || new Error('IDB 事务失败')); }; tx.onabort = function () { rej(tx.error || new Error('IDB 事务中止')); };
      });
      return true;
    } catch (e) { BF.err.report('idbUGCSet:' + kind, e); return false; }
  }
  /* 跨书重建：把某类 UGC 在 IDB 里的全部记录拼回整键数组（LS 丢失时用于修复/重建） */
  async function idbUGCGetKind(kind) {
    try {
      const db = await openDB();
      const rows = await new Promise(function (res, rej) {
        const tx = db.transaction('ugc', 'readonly');
        const req = tx.objectStore('ugc').index('kind').getAll(IDBKeyRange.only(kind));
        req.onsuccess = function () { res(req.result || []); }; req.onerror = function () { rej(req.error); };
      });
      return rows.map(function (r) { return r.data; });
    } catch (e) { BF.err.report('idbUGCGetKind:' + kind, e); return null; }
  }
  async function idbUGCGet(kind, bookId) {
    try {
      const db = await openDB();
      const rows = await new Promise(function (res, rej) {
        const tx = db.transaction('ugc', 'readonly');
        const req = tx.objectStore('ugc').index('kind_book').getAll(IDBKeyRange.only([kind, bookId]));
        req.onsuccess = function () { res(req.result || []); }; req.onerror = function () { rej(req.error); };
      });
      return rows.map(function (r) { return r.data; });
    } catch (e) { BF.err.report('idbUGCGet:' + kind, e); return null; }
  }
  async function idbUGCDelBook(bookId) {
    try {
      const db = await openDB();
      await new Promise(function (res, rej) {
        const tx = db.transaction('ugc', 'readwrite');
        const st = tx.objectStore('ugc');
        const req = st.index('bk').getAllKeys(IDBKeyRange.only(bookId));
        req.onsuccess = function () {
          for (const key of (req.result || [])) st.delete(key);
        };
        req.onerror = function () { rej(req.error); };
        tx.oncomplete = res; tx.onerror = function () { rej(tx.error || new Error('IDB 事务失败')); }; tx.onabort = function () { rej(tx.error || new Error('IDB 事务中止')); };
      });
      return true;
    } catch (e) { BF.err.report('idbUGCDelBook', e); return false; }
  }

  /* v2 后端：新拓扑实现。小键走 LS（与 legacy 同，保同步读）；UGC/正文/快照走新介质。 */
  const _v2 = {
    name: 'next',
    lsGet: function (k, d) { try { return lsGet(k, d); } catch (e) { return d; } },
    lsSet: function (k, v, opts) { try { return lsSet(k, v, opts); } catch (e) { return false; } },
    lsGetArray: function (k, d) { try { return lsGetArray(k, d); } catch (e) { return d; } },
    lsRemove: function (k) { try { lsRemove(k); } catch (e) {} },
    lsKeys: function () { try { return lsKeys(); } catch (e) { return []; } },
    async ugcGet(kind, bookId) {
      let r = null; try { r = await idbUGCGet(kind, bookId); } catch (e) { r = null; }
      if (r && r.length) return r;
      const lk = K[kind] || kind; const lr = lsGet(lk, null);   /* 保底：legacy 单键，按 bookId 过滤防跨书串扰 */
      const _arr = Array.isArray(lr) ? lr : (lr ? [lr] : []);
      return _arr.filter(function (x) { return x && x.bookId === bookId; });
    },
    async ugcGetKind(kind) {
      let r = null; try { r = await idbUGCGetKind(kind); } catch (e) { r = null; }
      if (r && r.length) return r;
      const lk = K[kind] || kind; const lr = lsGet(lk, null);
      return Array.isArray(lr) ? lr : (lr ? [lr] : []);
    },
    async ugcSet(kind, bookId, records) {
      if (await idbUGCSet(kind, bookId, records)) return true;
      /* IDB 不可用时不再回退写 LS：setCritical 主路径已把整键数组写进 LS（同步真源），
         此处若把「单书数组」写回整键键会覆盖掉其它书的记录。直接返回失败，由断路器回落 legacy。 */
      return false;
    },
    async ugcDelBook(bookId) {
      try { return await idbUGCDelBook(bookId) !== false; }
      catch (e) { BF.err.report('ugcDelBook', e); return false; }   /* 真删失败不再谎报成功 */
    },
    async loadBody(bookId) {
      /* 首选层按 body 分配决定；首选读不到仍回退另一层（懒迁移的读回退，R-1 旧书可读）。
         P4（松绑 C-3）：ls → LS 层优先（小书/LS 有余量时），仍回退 OPFS→IDB；
         opfs/auto → OPFS 优先；idb → IDB 优先。任何一路异常都不外抛。 */
      const _bodyMode = allocOf('body');
      if (_bodyMode === 'ls') {
        let r = null;
        try { r = lsGet('body_ls:' + bookId, null); } catch (e) {}
        if (r != null) return r;
        if (BF.fsync && BF.fsync.available) { try { return await BF.fsync.readFile('books/' + bookId + '/body.txt'); } catch (e) {} }
        try { return await idbKeyGet('body:' + bookId, null); } catch (e) { return null; }
      }
      const idbFirst = _bodyMode === 'idb';
      let r = null;
      if (idbFirst) {
        try { r = await idbKeyGet('body:' + bookId, null); } catch (e) { r = null; }
        if (r != null) return r;
        if (BF.fsync && BF.fsync.available) { try { return await BF.fsync.readFile('books/' + bookId + '/body.txt'); } catch (e) {} }
        return null;
      }
      if (BF.fsync && BF.fsync.available) { try { r = await BF.fsync.readFile('books/' + bookId + '/body.txt'); } catch (e) { r = null; } }
      if (r != null) return r;
      try { return await idbKeyGet('body:' + bookId, null); } catch (e) { return null; }
    },
    async saveBody(bookId, text) {
      /* 新写落到分配指定的首选层；首选失败回落另一层。旧层不主动删（懒迁移：读回退负责旧书）。
         P4：ls 首选层走 LS（allocOf 已做尺寸闸门 _EST_PER_BOOK≤LS 余量的兜底），
         LS 写入走同步 lsSet（承重键语义不变——正文不是承重键），失败回落 OPFS→IDB。 */
      const _bodyMode = allocOf('body');
      if (_bodyMode === 'ls') {
        try { if (lsSet('body_ls:' + bookId, text) === true) return true; } catch (e) {}
        if (BF.fsync && BF.fsync.available) { try { await BF.fsync.writeFile('books/' + bookId + '/body.txt', text); return true; } catch (e) {} }
        try { await idbKeyPut('body:' + bookId, text); return true; } catch (e) { return false; }
      }
      const idbFirst = _bodyMode === 'idb';
      if (idbFirst) {
        try { await idbKeyPut('body:' + bookId, text); return true; } catch (e) {}
        if (BF.fsync && BF.fsync.available) { try { await BF.fsync.writeFile('books/' + bookId + '/body.txt', text); return true; } catch (e) {} }
        return false;
      }
      if (BF.fsync && BF.fsync.available) { try { await BF.fsync.writeFile('books/' + bookId + '/body.txt', text); return true; } catch (e) {} }
      try { await idbKeyPut('body:' + bookId, text); return true; } catch (e) { return false; }
    },
    async delBookFiles(bookId) {
      /* 三层各删一次，任一层真删失败 → ok=false：删书回执据此报道「部分未删」，
         不再吞异常仍 return true 谎报「已彻底删除」。 */
      let ok = true;
      if (BF.fsync && BF.fsync.available) { try { await BF.fsync.remove('books/' + bookId); } catch (e) { ok = false; BF.err.report('delBookFiles.opfs', e); } }
      try { await idbKeyDelete('body:' + bookId); } catch (e) { ok = false; BF.err.report('delBookFiles.idb', e); }
      try { lsRemove('body_ls:' + bookId); } catch (e) { ok = false; BF.err.report('delBookFiles.ls', e); }   /* P4：正文 LS 层副本一并删 */
      try { if (!(await idbUGCDelBook(bookId))) ok = false; } catch (e) { ok = false; BF.err.report('delBookFiles.ugc', e); }
      return ok;
    },
    snap: BF.snap,
  };

  /* 后端选择 + 断路器 + 逐操作保底 */
  function _legacySet() {
    return { name: 'legacy', lsGet: lsGet, lsSet: lsSet, lsGetArray: lsGetArray, lsRemove: lsRemove, lsKeys: lsKeys,
             idbGet: idbGet, idbGetAll: idbGetAll, idbIndexKeys: idbIndexKeys, idbIndexRecords: idbIndexRecords, idbIndexDistinct: idbIndexDistinct, idbAllKeys: idbAllKeys, idbPutAll: idbPutAll, idbDelete: idbDelete, idbRestore: idbRestore };
  }
  let _active = _legacySet(), _v2Tripped = false, _v2FailStreak = 0;
  function _v2Ready() { return !!(BF.fsync && BF.fsync.available) || !!(window.indexedDB); }

  /* ===== 按类别的存储分配（A）================================================
     全局 storageBackend 仍是总开关；storageAlloc 允许「正文/章节/音频/摘要/索引」
     各自挑后端。缺省整表缺失或某类缺失 → 逐类回落到全局 mode 的现状行为（C-1）。
     承重键（书签/划线/便签/生词/进度/随书偏好/设置/元数据）永不进这张表作主存：
     它们主存恒 LS 同步读（C-2），只由 mirrorKeys 决定要不要额外加 IDB 镜像。 */
  const ALLOC_CANDIDATES = {
    body: ['auto', 'idb', 'opfs', 'ls'],  /* 正文（P4 松绑 C-3→尺寸闸门）：opfs/idb/ls 三选一，ls 仅当估算字节≤LS 余量（lsFits 兜底），auto=现状(OPFS→IDB) */
    chapters: ['auto', 'idb', 'opfs'],    /* 章节缓存：IDB 主 / OPFS 分批 / LS 兜底三层的首选层 */
    audio: ['auto', 'idb', 'opfs'],       /* 朗读音频缓存：可重建，IDB/OPFS */
    aiSummary: ['auto', 'idb', 'ls'],     /* AI 摘要缓存：可重建，本就 LS，允许留 LS 或迁 IDB */
    chunkIdx: ['auto', 'idb'],            /* 问书索引：IDB（kv store），OPFS 尚无索引实现，故不列 */
    /* 承重键：候选只有镜像布尔，主存恒 LS —— 表里显式标注，UI 据此只渲染开关 */
    bookmarks: { mirror: true }, highlights: { mirror: true }, notes: { mirror: true },
    vocab: { mirror: true }, reading_state: { mirror: true }, perbook_prefs: { mirror: true },
  };
  const ALLOC_CATEGORIES = ['body', 'chapters', 'audio', 'aiSummary', 'chunkIdx'];
  const MIRROR_CATEGORIES = ['bookmarks', 'highlights', 'notes', 'vocab', 'reading_state', 'perbook_prefs'];
  function _allocTable() {
    try { const a = (BF.settings && BF.settings.get) ? BF.settings.get('storageAlloc') : null; return (a && typeof a === 'object' && !Array.isArray(a)) ? a : {}; }
    catch (e) { return {}; }
  }
  /* 逐类求解：返回该类真正生效的 mode。任何非法值/缺键 → 回落到全局现状（C-1）。 */
  function allocOf(category) {
    const globalMode = backendMode();   /* 无参 = 旧语义 */
    if (ALLOC_CATEGORIES.indexOf(category) < 0) return globalMode;
    const cand = ALLOC_CANDIDATES[category] || [];
    let v; try { v = _allocTable()[category]; } catch (e) { v = null; }
    if (cand.indexOf(v) < 0) {
      /* 缺键/非法 → 现状：全局 next 落到各类的默认首选层，legacy 保持原层。 */
      return globalMode === 'legacy' ? 'legacy' : 'auto';
    }
    /* 用户显式选了 opfs/idb/ls，但环境不支持时按类别降级：
       opfs 不可用 → idb（正文/章节/音频都已有 IDB 兜底）；idb 不可用 → 全局现状。
       P4（松绑 C-3→尺寸闸门）：正文选 ls 时，若单本估算超 LS 安全余量 → 回落 opfs/idb，
       绝不因用户误选/余量骤降而撞 QuotaExceeded 假成功（R-11 尺寸闸门边界）。 */
    if (v === 'opfs' && !(BF.fsync && BF.fsync.available)) return 'idb';
    if (v === 'idb' && !window.indexedDB) return globalMode === 'legacy' ? 'legacy' : 'auto';
    if (v === 'ls' && category === 'body') {
      if (!lsFits(_EST_PER_BOOK)) return (BF.fsync && BF.fsync.available) ? 'opfs' : (window.indexedDB ? 'idb' : (globalMode === 'legacy' ? 'legacy' : 'auto'));
    }
    return v;
  }
  /* 承重键镜像：返回是否额外写 IDB durable 副本。缺省跟旧语义（非 legacy 即镜像）。 */
  function mirrorOf(category) {
    if (MIRROR_CATEGORIES.indexOf(category) < 0) return false;
    let m; try { m = (BF.settings && BF.settings.get) ? BF.settings.get('mirrorKeys') : null; } catch (e) { m = null; }
    if (m && typeof m === 'object' && typeof m[category] === 'boolean') return m[category];
    return backendMode() !== 'legacy';
  }
  function backendMode(category) {
    if (category) return allocOf(category);   /* 传类别 = 该类有效 mode */
    let m = 'auto';
    try { m = (BF.settings && BF.settings.get) ? (BF.settings.get('storageBackend') || 'auto') : 'auto'; } catch (e) {}
    if (m !== 'legacy' && m !== 'next' && m !== 'auto') m = 'auto';
    return m;
  }
  function selectBackend(category) {
    /* 传类别：只回答「该类当前该用哪个后端」，不改全局 _active（承重键小键读写恒走 _active 的 LS 门面，
       不能按类别切到异步层）。无参：维持旧的全局选后端 + 断路器语义，向后兼容。 */
    if (category) return allocOf(category);
    const m = backendMode();
    /* 断路器只保护 auto：用户显式切 next 是「我就是要试新层」的明确意图，
       此时若仍无条件短路，data.backend 会提示切换成功却实际留在 legacy，只能刷新。
       显式 next 给一次重试机会（清断路器与失败计数）；真不可用会在下面 _v2Ready 处重新 trip。 */
    if (m === 'next' && _v2Tripped) { _v2Tripped = false; _v2FailStreak = 0; }
    if (_v2Tripped) { _active = _legacySet(); return 'legacy'; }
    if (m === 'legacy') { _active = _legacySet(); return 'legacy'; }
    if (m === 'next') { if (!_v2Ready()) { _active = _legacySet(); _v2Tripped = true; return 'legacy'; } _active = _v2; return 'next'; }
    _active = _v2Ready() ? _v2 : _legacySet();   /* auto */
    return _active === _v2 ? 'next' : 'legacy';
  }
  function _fallback(op, args, dflt) { try { return op.apply(null, args); } catch (e) { return dflt; } }
  function _trip() { _v2FailStreak++; if (_v2FailStreak >= 5) { _v2Tripped = true; _active = _legacySet(); try { if (BF.log && BF.log.warn) BF.log.warn('存储后端 v2 连续失败，已回落原层'); } catch (e) {} } }
  function _d_lsGet(k, d) { try { return _active.lsGet(k, d); } catch (e) { return _fallback(lsGet, [k, d], d); } }
  function _d_lsSet(k, v, opts) { try { const r = _active.lsSet(k, v, opts); if (r === false) _trip(); return r; } catch (e) { return _fallback(lsSet, [k, v, opts], false); } }   /* 只有 === false（真异常）才计断路失败；配额拦截返回 LS_QUOTA，不牵连整个会话的后端选择 */
  function _d_lsGetArray(k, d) { try { return _active.lsGetArray(k, d); } catch (e) { return _fallback(lsGetArray, [k, d], d); } }
  function _d_lsRemove(k) { try { _active.lsRemove(k); } catch (e) { try { lsRemove(k); } catch (_) {} } }
  function _d_lsKeys() { try { return _active.lsKeys(); } catch (e) { return _fallback(lsKeys, [], []); } }
  let _ugcMigrated = false;
  async function migrateUgcToIdb() {
    if (_ugcMigrated) return; _ugcMigrated = true;
    try {
      const kinds = ['highlights', 'bookmarks', 'notes', 'vocab'];
      for (const k of kinds) {
        let arr = []; try { arr = lsGetArray(k, []); } catch (e) { arr = []; }
        if (!Array.isArray(arr) || !arr.length) continue;
        const byBook = {};
        for (const r of arr) { const b = r && r.bookId; if (!b) continue; (byBook[b] = byBook[b] || []).push(r); }
        for (const b in byBook) { try { await idbUGCSet(k, b, byBook[b]); } catch (e) {} }
      }
      try { if (BF.log && BF.log.info) BF.log.info('存储迁移：UGC 已镜像至 IDB（' + kinds.length + ' 类）'); } catch (e) {}
    } catch (e) { BF.err.report('store.migrateUgcToIdb', e); }
  }
  /* 按类别懒迁移（C 面板「立即迁移此区」）：照 migrateUgcToIdb 形态——读旧区、写新区、
     不删旧（删除交给用户确认后的孤儿清理，一次性强搬风险不可控）。
     目前真正有双份介质、可迁移的是正文 body（OPFS <-> IDB）；其余类别走各自写路径的
     首选层，无「双区并存」的懒迁移语义，返回 {skipped:true} 让面板如实说明。 */
  async function migrateCategory(category) {
    const out = { category: category, moved: 0, failed: 0, skipped: false };
    if (category !== 'body') { out.skipped = true; return out; }
    /* P4：三目标 idb/opfs/ls（松绑 C-3 后 LS 也是合法落点，受 allocOf 尺寸闸门约束）。 */
    const target = allocOf('body');
    const toLv = target === 'ls' ? 'ls' : target === 'idb' ? 'idb' : 'opfs';
    if (toLv === 'idb' && !window.indexedDB) { out.skipped = true; return out; }
    if (toLv === 'opfs' && !(BF.fsync && BF.fsync.available)) { out.skipped = true; return out; }
    let ids = [];
    try {
      const meta = lsGetArray(BF.store.K.BOOKS_META, []);
      ids = (Array.isArray(meta) ? meta : []).map(function (b) { return b && b.id; }).filter(Boolean);
    } catch (e) { BF.err.report('migrateCategory.meta', e); return out; }
    for (const id of ids) {
      try {
        /* 读「旧区」：用 loadBody 的三层回退拿正文（它按当前 allocOf 首选，但任一层有都能读），
           这样无论旧书落在哪一层都能迁到新目标。 */
        let text = null;
        try { text = await _v2.loadBody(id); } catch (e) {}
        if (text == null) continue;   /* 三层都没有正文 → 无需迁移，不计失败 */
        /* 写「新区」：只写目标层，旧层不删（懒迁移，读回退负责旧书）。 */
        if (toLv === 'ls') { if (lsSet('body_ls:' + id, text) !== true) throw new Error('LS 写入失败'); }
        else if (toLv === 'idb') await idbKeyPut('body:' + id, text);
        else if (BF.fsync && BF.fsync.available) await BF.fsync.writeFile('books/' + id + '/body.txt', text);
        out.moved++;
      } catch (e) { out.failed++; BF.err.report('migrateCategory.body:' + id, e); }
    }
    try { if (BF.log && BF.log.info) BF.log.info('存储迁移：正文 → ' + toLv.toUpperCase() + '，迁移 ' + out.moved + ' 本，失败 ' + out.failed); } catch (e) {}
    return out;
  }

  /* ===== P3 + Agent：存储面板聚合 + 最优方案规划器 ============================
     storagePanel()：把每类的后端/条目数/占用/可否迁移/是否承重聚成一份，UI 直接渲染。
     planStorage()：纯只读规划器，读设备能力 + 配额水位 + 各类占用，按下面的硬规则算出
       每类最优落点与理由。绝不写盘、绝不改设置——应用方案由 Agent 工具 applyStoragePlan
       走授权通道（showAdvice）让用户勾选批准后才落 storageAlloc/mirrorKeys。 */
  const _CAT_LABEL = { body: '正文', chapters: '章节缓存', audio: '朗读音频缓存', aiSummary: 'AI 摘要缓存', chunkIdx: '问书索引' };
  const _MODE_LABEL = { auto: '自动（现状）', idb: 'IndexedDB', opfs: 'OPFS 文件', ls: '本地存储 LS', legacy: '原层' };
  const _MIRROR_LABEL = { bookmarks: '书签', highlights: '划线', notes: '便签', vocab: '生词', reading_state: '阅读进度', perbook_prefs: '随书偏好' };
  /* 每类条目数：能便宜拿到就拿，拿不到给 null（UI 显示「—」，不编造数字）。 */
  async function _catCount(cat) {
    try {
      if (cat === 'body') {
        const meta = lsGetArray(K.BOOKS_META, []);
        return Array.isArray(meta) ? meta.length : 0;
      }
      if (cat === 'chapters') {
        const ks = await idbIndexDistinct(K.CHAPTERS, 'bk', { strict: false }) || [];
        return ks.length;
      }
      if (cat === 'aiSummary') {
        const raw = lsGet(K.AI_SUMMARY_CACHE, null);
        if (raw == null) return 0;
        return (raw && typeof raw === 'object') ? Object.keys(raw).length : 1;
      }
      if (cat === 'audio') {
        /* 朗读缓存是 IDB 里的独立库，无统一计数 API 时如实给 null，不猜 */
        return null;
      }
      if (cat === 'chunkIdx') {
        const ks = await idbAllKeys(K.KV || 'kv', { strict: false }) || [];
        return ks.filter(function (k) { return typeof k === 'string' && k.indexOf('chunk') >= 0; }).length || null;
      }
    } catch (e) {}
    return null;
  }
  function _catBackendLabel(cat) {
    if (MIRROR_CATEGORIES.indexOf(cat) >= 0) return '本地存储 LS（主存）';
    return _MODE_LABEL[allocOf(cat)] || allocOf(cat);
  }
  function storagePanel() {
    const rows = [];
    (ALLOC_CATEGORIES || []).forEach(function (cat) {
      rows.push({
        key: cat, label: _CAT_LABEL[cat] || cat,
        backend: _catBackendLabel(cat),
        migratable: cat === 'body',                 /* 目前只有正文有双介质懒迁移 */
        critical: false,
        count: null                                  /* 异步填充，见 _fillStoragePanel */
      });
    });
    (MIRROR_CATEGORIES || []).forEach(function (cat) {
      rows.push({
        key: cat, label: _MIRROR_LABEL[cat] || cat,
        backend: mirrorOf(cat) ? 'LS + IDB 镜像' : '本地存储 LS（仅主存）',
        migratable: false, critical: true, count: null
      });
    });
    return { rows: rows, quotaLevel: quotaLevel() };
  }
  /* ===== P4.3 最优方案规划（按各区剩余容量泄洪，初心回归）====================
     决策依据从「介质可不可用」升级为「per-media 剩余字节 + 该类体量 + 耐久/同步权重」。
     IDB/OPFS 紧而 LS 空 → 把装得下的类导进 LS；LS 紧而 origin 空 → 反向导出。
     承重键主存恒 LS 同步读（C-2 不变），只决定 IDB 镜像开关；泄洪只动镜像与大/可重建内容。
     纯只读、不写盘：写盘仍只经 applyStoragePlan 授权弹窗。理由全部带人话数字（R-8/R-9/R-11）。 */
  const _kb = function (b) { return (b / 1024).toFixed(0) + ' KB'; };
  async function planStorage() {
    const budget = await mediaBudget();
    const hasOpfs = budget.opfs, hasIdb = budget.idb;
    const level = budget.level, tight = budget.tight;
    const lsFree = budget.ls.freeBytes, originFree = budget.origin.freeBytes;
    /* origin 余量是 IDB+OPFS 共用的；取不到真实 quota 时 originFree=0，不冒充宽裕。 */
    const originTight = tight || (budget.origin.capBytes > 0 && originFree < 8 * 1024 * 1024);
    const alloc = {}, reasons = {};

    /* 正文 body：大体积主战场。估算单本体量 → 谁有余量往谁导。
       - origin(IDB/OPFS) 吃紧且 LS 装得下 → 推 ls（P4 松绑 C-3，受 lsFits 尺寸闸门）；
       - 否则 OPFS 可用 → opfs（不占 IDB/LS 配额，路径 books/<id>/body.txt 不变）；
       - 再否则 IDB → idb；全不可用 → auto。 */
    const bodyBytes = estimateCatBytes('body') || _EST_PER_BOOK;
    if (originTight && lsFits(_EST_PER_BOOK) && lsFree > 0) {
      alloc.body = 'ls';
      reasons.body = '正文约 ' + _kb(bodyBytes) + '，IDB/OPFS 仅剩 ' + _kb(originFree) + '，LS 还余 ' + _kb(lsFree) + ' → 建议落 LS（单本 ' + _kb(_EST_PER_BOOK) + ' 装得下，尺寸闸门放行）';
    } else if (hasOpfs) {
      alloc.body = 'opfs';
      reasons.body = '正文约 ' + _kb(bodyBytes) + '，OPFS 不占 IDB/localStorage 配额（余 ' + _kb(originFree) + '），现有路径 books/<id>/body.txt 无需改动';
    } else if (hasIdb) {
      alloc.body = 'idb';
      reasons.body = 'OPFS 不可用、LS 余 ' + _kb(lsFree) + ' 不足以安全承载正文，正文退到 IndexedDB（余 ' + _kb(originFree) + '）';
    } else {
      alloc.body = 'auto';
      reasons.body = 'OPFS/IndexedDB 均不可用且 LS 余 ' + _kb(lsFree) + '，维持现状自动回落';
    }

    /* 章节 chapters：IDB 索引最快；IDB/OPFS 吃紧且 LS 装得下 → ls；否则按可用性。 */
    if (originTight && lsFits(_EST_PER_BOOK) && lsFree > 0) {
      alloc.chapters = 'ls';
      reasons.chapters = '章节缓存可重建，IDB/OPFS 仅剩 ' + _kb(originFree) + '、LS 余 ' + _kb(lsFree) + ' → 建议落 LS 泄洪';
    } else if (hasIdb) { alloc.chapters = 'idb'; reasons.chapters = '章节按 bookId 索引查询，IndexedDB 的 bk 索引最快且是现有主读层（origin 余 ' + _kb(originFree) + '）'; }
    else if (hasOpfs) { alloc.chapters = 'opfs'; reasons.chapters = 'IndexedDB 不可用，章节退到 OPFS 分批文件（origin 余 ' + _kb(originFree) + '）'; }
    else { alloc.chapters = 'auto'; reasons.chapters = '无可用异步后端且 LS 余 ' + _kb(lsFree) + '，维持现状'; }

    /* 音频 audio：可重建的大块缓存，优先 OPFS 释放配额；吃紧且 LS 装得下 → ls。 */
    if (originTight && lsFits(_EST_PER_BOOK) && lsFree > 0) {
      alloc.audio = 'ls';
      reasons.audio = '朗读音频可重建，IDB/OPFS 仅剩 ' + _kb(originFree) + '、LS 余 ' + _kb(lsFree) + ' → 建议落 LS 泄洪';
    } else if (hasOpfs) { alloc.audio = 'opfs'; reasons.audio = '朗读音频可重建且体积大，放 OPFS 释放配额（origin 余 ' + _kb(originFree) + '）'; }
    else if (hasIdb) { alloc.audio = 'idb'; reasons.audio = 'OPFS 不可用，音频退到 IndexedDB（余 ' + _kb(originFree) + '，可重建）'; }
    else { alloc.audio = 'auto'; reasons.audio = '无可用异步后端且 LS 余 ' + _kb(lsFree) + '，维持现状'; }

    /* AI 摘要 aiSummary：可重建、小、同步读。origin 紧就外迁 IDB 腾 LS；LS 空且 origin 空就留 LS。 */
    const sumBytes = estimateCatBytes('aiSummary') || 0;
    if (originTight && hasIdb) {
      alloc.aiSummary = 'idb';
      reasons.aiSummary = '存储水位 ' + level + '、IDB/OPFS 余 ' + _kb(originFree) + '，把约 ' + _kb(sumBytes) + ' 的可重建 AI 摘要挪出 localStorage，给关键数据腾空间';
    } else {
      alloc.aiSummary = 'ls';
      reasons.aiSummary = 'AI 摘要约 ' + _kb(sumBytes) + '、可重建且为同步读，LS 余 ' + _kb(lsFree) + '，留 localStorage 零迁移成本';
    }

    /* 问书索引 chunkIdx：只有 IDB 实现。 */
    alloc.chunkIdx = 'idb';
    reasons.chunkIdx = '问书索引目前只有 IndexedDB 实现（带淘汰，origin 余 ' + _kb(originFree) + '），无其它可选后端';

    /* 承重键镜像：IDB 余量足且水位正常才留镜像；紧张则关（主存恒 LS 不受影响）。 */
    const mirror = {};
    MIRROR_CATEGORIES.forEach(function (k) {
      mirror[k] = !tight && (!hasIdb || originFree >= 16 * 1024 * 1024);
      reasons[k] = (mirror[k]
        ? ('IDB 余 ' + _kb(originFree) + '，保留 durable 镜像更耐久')
        : ('水位 ' + level + ' 或 IDB 余 ' + _kb(originFree) + ' 不足，暂关镜像省空间'))
        + '；主存恒 localStorage 同步读，数据安全不受影响';
    });
    return {
      alloc: alloc, mirror: mirror, reasons: reasons,
      context: {
        opfs: hasOpfs, idb: hasIdb, quotaLevel: level, tight: tight,
        lsFreeBytes: lsFree, originFreeBytes: originFree,
        lsPct: budget.ls.pct, originPct: budget.origin.pct
      },
      summary: '已按各区剩余容量规划：LS 余 ' + _kb(lsFree) + '（' + budget.ls.pct.toFixed(0) + '% 已用）、IDB/OPFS 余 ' + _kb(originFree) +
        '（' + budget.origin.pct.toFixed(0) + '% 已用，水位 ' + level + '）→ 正文→' + _MODE_LABEL[alloc.body] +
        '、章节→' + _MODE_LABEL[alloc.chapters] + '、音频→' + _MODE_LABEL[alloc.audio] +
        '、AI摘要→' + _MODE_LABEL[alloc.aiSummary] + '、索引→' + _MODE_LABEL[alloc.chunkIdx] +
        '；承重键镜像' + (MIRROR_CATEGORIES.every(function (k) { return mirror[k]; }) ? '全部保留' : '部分关闭') +
        '。装不下的大内容自动回落 IDB/OPFS，承重键主存恒本地存储。'
    };
  }
  /* 遗键自愈：'kv' 里 '__buf.' 前缀的键是早期双缓冲写法留下的冗余副本，
     既不参与任何读取（主读取走 LS，UGC 镜像走 'ugc'），也永不再被写入，
     留着只占配额。游标同时限「扫描条数」与「删除条数」——只卡删除数会让大库
     每次冷启动都做一次全表遍历；扫到上限即本次收手，下次启动接着清。
     只删 '__buf.' 前缀，其它键一概不碰（清整库是 resetAll 的职责）。
     调用点在数据自愈（BF.heal.run），一个进程里只真跑一次。 */
  let _bufCleaned = false;
  async function cleanupLegacyBufferKeys() {
    if (_bufCleaned) return; _bufCleaned = true;
    if (!window.indexedDB) return;
    const DELETE_CAP = 200;   /* 单次最多删 200 个 */
    const SCAN_CAP = 2000;    /* 单次最多扫 2000 条 */
    let n = 0, scanned = 0;
    try {
      const db = await openDB();
      await new Promise(function (res, rej) {
        const tx = db.transaction('kv', 'readwrite');
        const st = tx.objectStore('kv');
        const req = st.openCursor();
        req.onsuccess = function () {
          const cur = req.result;
          if (!cur || n >= DELETE_CAP || scanned >= SCAN_CAP) { res(); return; }
          scanned++;
          if (typeof cur.key === 'string' && cur.key.indexOf('__buf.') === 0) { try { cur.delete(); n++; } catch (e) {} }
          cur.continue();
        };
        req.onerror = function () { rej(req.error); };
        tx.onerror = function () { rej(tx.error); };
      });
      if (n && BF.log && BF.log.info) BF.log.info('存储自愈：清理遗留缓冲键 ' + n + ' 个');
    } catch (e) { BF.err.report('store.cleanupLegacyBufferKeys', e); }
  }
  function initBackend() {
    return Promise.resolve().then(async function () {
      try { if (BF.fsync && BF.fsync.init) await BF.fsync.init(); } catch (e) {}
      const m = selectBackend();
      try { if (BF.log && BF.log.info) BF.log.info('存储后端：' + m + (m === 'next' ? (BF.fsync && BF.fsync.available ? '（OPFS 可用）' : '（OPFS 不可用·降级 IDB）') : '（原层 LS）')); } catch (e) {}
      /* UGC→IDB 启动回填与 '__buf.' 遗键清理都不放在这里：谁先打开 IDB，
         openDB 的 onsuccess 就发 idb:up，而消费方要到启动流程末尾才注册——
         抢在前面发事件，每次冷启动都会刷一条「bus.emit 无监听」告警。
         两件事都交给数据自愈（BF.heal.run）。 */
      return m;
    });
  }
  initBackend();

  return {
    K, PREFIX, _d_lsGet, lsGetMemo, _d_lsGetArray, _d_lsSet, _d_lsRemove, _d_lsKeys, quotaCheck, quota, quotaTone, usage,
    corruptHas, corruptClear,
    QUOTA_WARN, QUOTA_ALERT, QUOTA_BLOCK, quotaLevel, writeAllowed,
    /* P4：双桶余量 / 尺寸闸门 / 失衡提示（规划器、面板、腾退共用这一份计量） */
    mediaBudget: mediaBudget, estimateCatBytes: estimateCatBytes, lsFits: lsFits, lsFreeBytes: lsFreeBytes,
    rebalanceAdvisory: rebalanceAdvisory, relocateBeforeEvict: relocateBeforeEvict,
    idbGet, idbGetAll, idbIndexKeys, idbIndexRecords, idbIndexDistinct, idbAllKeys, idbPutAll, idbDelete, idbDeleteMany, idbRestore,
    openDB, clearTransients, clearBackups, ssGet, ssSet, ssRemove, memGet, memSet, memRemove,
    PRIV_KEYS: PRIV_KEYS,
    /* 预设（aiPresets）是 settings 里唯一可嵌密钥的嵌套对象：用户保存预设时若勾选
       「含密钥」，aiApiKey 等会进预设内部。所有落盘/导出路径在剥离顶层密钥之外，
       必须递归清掉预设内部的密钥，否则密钥会随预设一起写进备份/工作区快照/诊断包。 */
    stripPresetSecrets: function (settings) {
      if (!settings || typeof settings !== 'object' || !settings.aiPresets || typeof settings.aiPresets !== 'object') return settings;
      const PRIV = PRIV_KEYS;
      const _isPriv = function (k) { return PRIV instanceof Set ? PRIV.has(k) : (PRIV.indexOf ? PRIV.indexOf(k) >= 0 : false); };
      const cp = {};
      Object.keys(settings.aiPresets).forEach(function (name) {
        const p = settings.aiPresets[name];
        if (!p || typeof p !== 'object') { cp[name] = p; return; }
        const c2 = {};
        Object.keys(p).forEach(function (k) { if (!_isPriv(k)) c2[k] = p[k]; });
        cp[name] = c2;
      });
      settings = Object.assign({}, settings);   /* 不改写入参：调用方传进来的常是当前设置的对象图，就地删键等于悄悄改活数据 */
      settings.aiPresets = cp;
      return settings;
    },
    idbKeyPut, idbKeyTxn, idbKeyGet, idbKeyDelete, isUGCKey, persistState, persistLabel,
    /* 双后端：v2（新拓扑）/ legacy（原层保底） */
    initBackend: initBackend, selectBackend: selectBackend, backendMode: backendMode, v2: _v2, fsync: BF.fsync, snap: BF.snap,
    ALLOC_CANDIDATES: ALLOC_CANDIDATES, ALLOC_CATEGORIES: ALLOC_CATEGORIES, MIRROR_CATEGORIES: MIRROR_CATEGORIES,
    allocOf: allocOf, mirrorOf: mirrorOf, migrateCategory: migrateCategory,
    planStorage: planStorage, storagePanel: storagePanel,
    ugcGet: _v2.ugcGet, ugcGetKind: _v2.ugcGetKind, ugcSet: _v2.ugcSet, ugcDelBook: _v2.ugcDelBook, loadBody: _v2.loadBody, saveBody: _v2.saveBody, delBookFiles: _v2.delBookFiles, migrateUgcToIdb: migrateUgcToIdb,
    rev: rev,
    corruptTime: corruptTime,
    _cleanupLegacyBufferKeys: cleanupLegacyBufferKeys,   /* 由数据自愈调用，见 initBackend 里的时序说明 */
  };
})();
/* 关键数据写入：配额耗尽时 lsSet 只返回 false，调用点必须检查返回值，
   否则用户以为保存成功实则静默丢失。此处给出一次可见提示（同一会话只提示一次，避免轰炸）。
   失败态按键名记账——「任意键成功即清全局失败态」是一刀切：
   A 键保存失败后，B 键随后成功会把 A 的失败提示顶掉（谎报「保存正常」）。
   键成功只清自己的失败位，仅当全部失败键都写回成功后才熄灭
   顶栏保存失败条（全库 16 处 setCritical 调用 = 15 处业务写入 +
   store.mutate 内部封装 1 处，共享同一记账，
   不逐个改调用点）。 */
/* 兼容补挂：store v2 化后导出名为 _d_lsGet 族，而全库 245 处调用仍是 lsGet 族——
   旧名接回新实现（同一函数引用，非第二套实现）。构建若已自带则原样跳过。 */
(function () {
  const pairs = [['lsGet', '_d_lsGet'], ['lsSet', '_d_lsSet'], ['lsGetArray', '_d_lsGetArray'], ['lsRemove', '_d_lsRemove'], ['lsKeys', '_d_lsKeys']];
  pairs.forEach(function (p) {
    if (typeof BF.store[p[0]] !== 'function' && typeof BF.store[p[1]] === 'function') BF.store[p[0]] = BF.store[p[1]];
  });
})();
const _setCriticalFail = {};
