/* ================= 8. BF.modules 模块注册表 ================= */
BF.modules = (function () {
  const _m = new Map();
  let _started = false;
  const CORE = new Set(['core.bus', 'core.store', 'core.settings', 'core.sheet', 'core.noti', 'core.timers', 'core.ui', 'reader.core', 'boot']);
  function _isCore(id) {
    if (!id) return false;
    if (CORE.has(id)) return true;
    /* autoregister 生成的短 id（bus/store/settings/...）与 core.* 同源，视为核心 */
    if (id.indexOf('core.') !== 0 && CORE.has('core.' + id)) return true;
    return false;
  }
  const LS_STATE = 'plugins_state';
  const LS_CFG = 'plugins_cfg';
  /* 插件协议：在原有 {id,deps,hooks} 基础上，新增
     name/desc/version/enabled（描述+启停）
     commands:[{id,label,keywords,cat,run}]（自动注册进 BF.commands）
     settings:[{key,label,type,...}]（自动注入 BF.settingsUI）
     onBus:{EVENT:fn}（自动订阅 BF.bus，disable 自动摘除）
     tags:['tts']（能力标签，供 BF.modules.find(tag) 按能力检索） */
  function register(m) {
    if (!m || !m.id) return;
    m.deps = m.deps || [];
    m.enabled = m.enabled !== false;   /* 默认启用 */
    m.commands = m.commands || [];
    m.settings = m.settings || [];
    m.onBus = m.onBus || {};
    /* tags 归一化：允许字符串或数组，统一成去重小写数组
       注意：必须先过滤非字符串再 String，否则 String(undefined) === 'undefined' 会混进标签 */
    if (typeof m.tags === 'string') m.tags = m.tags.split(/[,\s]+/);
    if (!Array.isArray(m.tags)) m.tags = [];
    else m.tags = Array.from(new Set(m.tags.filter(function (t) { return typeof t === 'string'; }).map(function (t) { return t.trim().toLowerCase(); }).filter(Boolean)));
    /* 未显式声明 tags 的显式注册模块（如 reader.core / tts.core）同样按命名空间推断，
       否则它们会成为筛选 UI 里的「无标签孤岛」，用户永远筛不出来。
       推断结果必须再过一次归一化：_inferTags 里含 'AI'/'DSL' 等大写标签，
       而 tags 约定是小写（find 会 toLowerCase 后比对），不一致就永远筛不到。 */
    if (!m.tags.length) m.tags = _inferTags(m.id, m);
    m.tags = Array.from(new Set(m.tags.map(function (t) { return String(t).trim().toLowerCase(); }).filter(Boolean)));
    _m.set(m.id, m);
    if (_started && isEnabled(m.id)) _installOne(m);
    return m;
  }
  /* 按能力标签检索模块（服务定位思路）：
     find('tts') → 所有带 tts 标签的模块；find(['tts','ai']) → 同时带两个标签。
     用于诊断「某功能由谁提供」，扩展中心据此筛选。 */
  function find(tag) {
    /* 空输入（undefined / null / [] / 全空白）视为「不筛选」，返回全部。
       否则调用方每次都得自己先判空，漏判就静默返回空列表。 */
    const want = (Array.isArray(tag) ? tag : [tag]).map(function (t) { return String(t == null ? '' : t).trim().toLowerCase(); }).filter(Boolean);
    if (!want.length) return [..._m.values()];
    return [..._m.values()].filter(function (m) {
      const have = m.tags || [];
      return want.every(function (t) { return have.indexOf(t) !== -1; });
    });
  }
  /* 声明式三入口：install 时自动接线到 BF.commands / BF.settingsUI / BF.bus */
  function _wire(m) {
    if (!_started) return;
    try {
      if (m.commands && m.commands.length && BF.commands) {
        const existing = BF.commands.list ? BF.commands.list() : [];
        /* 记下当次登记的命令 id，
           供 _unwire 卸载时注销——否则插件禁用后命令残留。 */
        m.__cmdIds = m.__cmdIds || [];
        for (const c of m.commands) {
          if (c && c.id && !existing.some(function (x) { return x && x.id === c.id; })) {
            BF.commands.register(c);
            m.__cmdIds.push(c.id);
          }
        }
      }
      if (m.onBus && BF.bus) {
        m.__busOff = m.__busOff || [];
        for (const ev of Object.keys(m.onBus)) {
          const raw = m.onBus[ev];
          if (typeof raw === 'function') {
            /* 经 safe 包装并记下原始 fn，保证 __busOff 摘除时能对上（bus.off 按引用匹配） */
            const fn = BF.err.safe(raw, 'module.onBus:' + m.id + ':' + ev);
            BF.bus.on(ev, fn);
            m.__busOff.push({ ev, fn });
          }
        }
      }
    } catch (e) { BF.err.report('module.wire:' + m.id, e); }
  }
  function _unwire(m) {
    /* 先注销插件登记的命令（与 _wire
       的 commands[] 登记配对），否则插件禁用后其命令仍残留在命令注册表。 */
    try {
      if (m.__cmdIds && m.__cmdIds.length && BF.commands && BF.commands.unregister) {
        for (const cid of m.__cmdIds) BF.commands.unregister(cid);
        m.__cmdIds = [];
      }
    } catch (e) { BF.err.report('module.unwire.cmd:' + m.id, e); }
    if (!m.__busOff) return;
    try {
      if (BF.bus) for (const b of m.__busOff) BF.bus.off(b.ev, b.fn);
      m.__busOff = [];
    } catch (e) { BF.err.report('module.unwire:' + m.id, e); }
  }
  const _installed = new Set();   /* 已安装模块名：顺序依赖自检的唯一读数 */
  function _installOne(m) {
    /* 顺序依赖显式化：start() 按拓扑序装，但「启动之后才 register」的模块会当场就装，
       那条路径不看依赖装没装过 —— 依赖后装就可能拿到还不存在的地基，
       表现是「点了没反应」而不是抛错，最难查。这里如实留一条 warn，可查可改。 */
    const early = (m.deps || []).filter(function (d) { return _m.has(d) && !_installed.has(d); });
    if (early.length && BF.log && BF.log.warn) BF.log.warn('顺序依赖：' + m.id + ' 先于其依赖 [' + early.join(', ') + '] 安装');
    if (m.hooks && typeof m.hooks.install === 'function') {
      /* 经 BF.err.safe 包装：插件 hooks 是第三方代码入口，异步 rejection 也留痕 */
      try { BF.err.safe(m.hooks.install, 'module:' + m.id).call(m.hooks); } catch (e) { BF.err.report('module:' + m.id, e); }
    }
    _wire(m);
    _installed.add(m.id);
  }
  /* ---- 资源生命周期统一回收 ----
     允许模块在 install 时登记 DOM 监听/定时器/回调，uninstall 时统一摘除。
     取代各模块自己维护 _R 数组（reader.core 现状）+ 散落 addEventListener 的漏摘。 */
  const RES = new Map();   /* moduleId -> [{type, args}] */
  function resources(m, type, args) {
    if (!m || !m.id) return null;
    const arr = RES.get(m.id) || [];
    let item = null;
    if (type === 'dom') {
      /* args: [target, ev, fn, opts] */
      const t = args[0], ev = args[1], fn = args[2], opt = args[3];
      t.addEventListener(ev, fn, opt);
      item = { type: 'dom', args: args };
    } else if (type === 'timer') {
      /* args: 返回清理函数的定时器句柄（BF.timers.interval/timeout 返回的清理函数） */
      const stop = args[0];
      item = { type: 'timer', stop: stop };
    } else if (type === 'cleanup') {
      item = { type: 'cleanup', fn: args[0] };
    }
    if (item) { arr.push(item); RES.set(m.id, arr); }
    return item;
  }
  function _releaseRes(m) {
    const arr = RES.get(m && m.id) || [];
    for (const r of arr) {
      try {
        if (r.type === 'dom') r.args[0].removeEventListener(r.args[1], r.args[2], r.args[3]);
        else if (r.type === 'timer' && typeof r.stop === 'function') r.stop();
        else if (r.type === 'cleanup' && typeof r.fn === 'function') r.fn();
      } catch (e) { BF.err.report('module.res:' + m.id + ':' + r.type, e); }
    }
    RES.delete(m && m.id);
  }
  function _uninstallOne(m) {
    _unwire(m);
    _releaseRes(m);
    if (m.hooks && typeof m.hooks.uninstall === 'function') {
      try { BF.err.safe(m.hooks.uninstall, 'module.uninstall:' + m.id).call(m.hooks); } catch (e) { BF.err.report('module.uninstall:' + m.id, e); }
    }
  }
  /* ---- 启停（持久化到 LS plugins_state） ---- */
  function _loadState() {
    try {
      const st = BF.store ? BF.store.lsGet(LS_STATE, null) : null;
      if (st && typeof st === 'object') {
        for (const id of Object.keys(st)) {
          const m = _m.get(id);
          if (m && !_isCore(id)) m.enabled = !!st[id];
        }
      }
    } catch (e) { BF.err.report('plugins.state.load', e); }
  }
  function _saveState() {
    try {
      if (!BF.store) return;
      const st = {};
      for (const m of _m.values()) if (!_isCore(m.id)) st[m.id] = m.enabled;
      BF.store.lsSet(LS_STATE, st);
    } catch (e) { BF.err.report('plugins.state.save', e); }
  }
  function isEnabled(id) {
    const m = _m.get(id);
    return m ? (m.enabled !== false) : false;
  }
  function enable(id) {
    const m = _m.get(id);
    if (!m || _isCore(id)) return false;
    if (m.enabled) return true;
    m.enabled = true;
    _saveState();
    if (_started) _installOne(m);
    BF.bus && BF.bus.emit && BF.bus.emit(BF.EVENTS ? BF.EVENTS.SETTINGS : 'settings:changed', 'plugins');
    return true;
  }
  function disable(id) {
    const m = _m.get(id);
    if (!m || _isCore(id)) return false;
    if (!m.enabled) return true;
    m.enabled = false;
    if (_started) _uninstallOne(m);
    _saveState();
    BF.bus && BF.bus.emit && BF.bus.emit(BF.EVENTS ? BF.EVENTS.SETTINGS : 'settings:changed', 'plugins');
    return true;
  }
  function toggle(id) { return isEnabled(id) ? disable(id) : enable(id); }
  function getConfig(id) {
    try {
      const c = BF.store ? BF.store.lsGet(LS_CFG, {}) : {};
      return c[id] || {};
    } catch (e) { return {}; }
  }
  function setConfig(id, key, val) {
    try {
      if (!BF.store) return;
      const c = BF.store.lsGet(LS_CFG, {}) || {};
      c[id] = c[id] || {};
      c[id][key] = val;
      BF.store.lsSet(LS_CFG, c);
    } catch (e) { BF.err.report('plugins.cfg.save', e); }
  }
  function _topo() {
    const out = [], vis = new Set(), done = new Set();
    const visit = (id) => {
      if (done.has(id) || vis.has(id)) return;
      vis.add(id);
      const m = _m.get(id);
      if (m && m.deps) {
        for (const d of m.deps) {
          if (_m.has(d)) visit(d);
          else BF.log && BF.log.warn('module:' + id + ' 依赖 ' + d + ' 未注册');
        }
      }
      vis.delete(id); done.add(id); out.push(id);
    };
    for (const id of _m.keys()) visit(id);
    return out;
  }
  function start() {
    if (_started) return _m;
    _loadState();   /* 先加载用户启停持久化，再按拓扑 install */
    _started = true;
    for (const id of _topo()) {
      const m = _m.get(id);
      if (!m || !isEnabled(id)) continue;
      try { _installOne(m); } catch (e) { BF.err.report('module.install:' + id, e); }
    }
    /* D42：deps 与 modules.get 差集断言。声明了 deps 但 registry 里没有对应模块 → 启动留痕 */
    try {
      for (const m of _m.values()) {
        for (const d of (m.deps || [])) {
          if (!_m.has(d)) BF.log.warn('扩展 ' + m.id + ' 依赖缺失：' + d + '（deps 声明与注册表不一致）');
        }
      }
    } catch (e) {}
    return _m;
  }
  function disposeAll() {
    for (const m of [..._m.values()].reverse()) {
      try { _uninstallOne(m); } catch (e) { BF.err.report('module.uninstall:' + m.id, e); }
    }
    _started = false;
  }
  function get(id) { return _m.get(id) || null; }
  function has(id) { return _m.has(id); }
  function list() { return [..._m.values()]; }
  /* autoregister：启动时扫描 BF.* 顶层命名空间，为未显式注册的模块生成轻量插件条目。
     只读元数据 + 默认启用，不强制可禁用——这就是「有机结合」：插件化不新增运行机制，
     只是把已有的 BF.* 模块登记成统一清单，供扩展中心展示。 */
  /* 命名空间 → 能力标签映射：让 autoregister 生成的模块也带上可筛选的语义标签。
     若一律只打 ['builtin']，BF.modules.find('tts') 返回空——
     数据层「按能力检索」形同虚设，扩展中心也没法做有意义的筛选。
     标签统一用中文（与 UI 文案同语言），避免出现「朗读」和「tts」两个同义标签各占一半。 */
  const NS_TAGS = {
    tts: ['朗读', '音频'], ai: ['AI', '模型'], reader: ['阅读', '渲染'],
    library: ['阅读', '导入'], book: ['阅读', '书架'], store: ['存储'], settings: ['设置'],
    theme: ['外观'], scene: ['外观'], sheet: ['界面', '面板'], noti: ['通知'],
    modal: ['界面', '面板'], dialog: ['界面', '面板'], hotkeys: ['快捷键'],
    commands: ['命令'],
    dsl: ['DSL', '工具'], dslUI: ['DSL', '工具', '界面'], workshop: ['工具'], util: ['工具'],
    stats: ['统计'], statsPanel: ['统计', '界面'], diag: ['运维', '工具'], base: ['运维', '工具'],
    bk: ['数据', '备份'], backup: ['数据', '备份'], download: ['数据'], zip: ['数据'],
    lz: ['数据', '压缩'], workerPool: ['性能'], perf: ['性能'], enh: ['性能', '阅读'],
    smart: ['性能'], log: ['运维'], err: ['运维'], health: ['运维'],
    goal: ['统计', '工具'], focus: ['工具'], noise: ['工具'], timer: ['工具'],
    pluginCenter: ['扩展'], nav: ['导航'], app: ['导航'], ui: ['界面'], dom: ['界面'],
    delegate: ['界面'], timers: ['运行时'], bus: ['运行时', '事件'], icons: ['界面'],
    md: ['界面'], sanitizeFilename: ['数据', '安全'],
    cfg: ['设置'], wsUI: ['工具'], notiCenter: ['通知', '界面'], uiMenu: ['导航', '界面'],
    readKey: ['安全', 'AI'],
  };
  /* 标签中文名（筛选按钮上显示）；键为规范化后的小写标签 */
  const TAG_CN = {
    builtin: '内置', core: '核心', tts: '朗读', audio: '音频', ai: 'AI', model: '模型',
    阅读: '阅读', render: '渲染', 导入: '导入', 书架: '书架', 存储: '存储', 设置: '设置',
    外观: '外观', ui: '界面', 面板: '面板', 通知: '通知', 快捷键: '快捷键', 命令: '命令',
    dsl: 'DSL', 工具: '工具', 统计: '统计', 运维: '运维', 数据: '数据', 备份: '备份',
    性能: '性能', 插件: '扩展', 导航: '导航', runtime: '运行时', event: '事件',
    压缩: '压缩', 安全: '安全', 朗读: '朗读', 界面: '界面',
  };
  function _inferTags(k, v) {
    /* 显式声明的标签优先；否则按命名空间推断，最后兜底 builtin。
       逐段匹配是为了让 BF.reader.core 这类带后缀的也能命中 reader 的标签。 */
    const out = new Set();
    const segs = String(k).toLowerCase().split(/[.\-_]/);
    segs.forEach(function (seg) { (NS_TAGS[seg] || []).forEach(function (t) { out.add(t); }); });
    if (NS_TAGS[String(k).toLowerCase()]) NS_TAGS[String(k).toLowerCase()].forEach(function (t) { out.add(t); });
    if (typeof v === 'function' && v.commands) out.add('命令');
    if (!out.size) out.add('builtin');
    /* 统一小写：tags 约定全小写（register 与 find 都按小写比对），
       这里不转的话 'AI'/'DSL' 会与 find('ai') 永远匹配不上 */
    return Array.from(out).map(function (t) { return String(t).toLowerCase(); });
  }
  function autoregister() {
    if (typeof window === 'undefined' || !window.BF) return;
    try {
      const skip = new Set(['modules', 'EVENTS', 'SCENES', 'appState', 'boot', 'state']);
      for (const k of Object.keys(BF)) {
        if (skip.has(k) || _m.has(k)) continue;
        const v = BF[k];
        if (!v || (typeof v !== 'object' && typeof v !== 'function')) continue;
        _m.set(k, {
          id: k,
          name: k,
          desc: '内置扩展',
          version: '1.0',
          enabled: true,
          auto: true,   /* 标记：autoregister 生成，非显式注册 */
          deps: [],
          hooks: {},
          commands: [], settings: [], onBus: {},
          tags: _inferTags(k, v),   /* autoregister：按命名空间推断能力标签，兜底 builtin */
        });
      }
    } catch (e) { BF.err.report('plugins.autoregister', e); }
  }
  /* 全部标签及其中文名（扩展中心筛选 UI 用）；TAG_CN 是查不到中文时的兜底 */
  function allTags() {
    const cnt = {};
    for (const m of _m.values()) for (const t of (m.tags || [])) cnt[String(t).toLowerCase()] = (cnt[String(t).toLowerCase()] || 0) + 1;
    return Object.keys(cnt).sort(function (a, b) { return cnt[b] - cnt[a] || a.localeCompare(b, 'zh', { numeric: true }); })
      .map(function (t) { return { tag: t, count: cnt[t], cn: TAG_CN[t] || t }; });
  }
  return { register, start, disposeAll, get, has, list, enable, disable, toggle, isEnabled, getConfig, setConfig, autoregister, find, allTags, TAG_CN, _isCore, CORE, resources: resources, _releaseRes: _releaseRes };
})();
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', function () {
    /* 直接关标签页时本章进度/滚动位置不落盘，下次打开回到旧章 */
    try { if (BF.appState.currentBookId && BF.appState.currentPage === 'reader') { BF.reader.saveProgress(true); BF.reader.syncProgressToMeta(); } } catch (e) { BF.log && BF.log.warn('卸载进度同步失败：' + (e && e.message)); }
    /* 章内滚动位置的同一条兜底：saveProgress 里那笔滚动写落在 await 之后，
       关标签页时那条微任务可能来不及跑。这里趁页面还看得见，同步读、同步落盘。 */
    try {
      const _w = document.getElementById('reader-wrap');
      if (_w && BF.appState.currentBookId && _w.offsetParent !== null) {
        BF.store.lsSet(BF.store.K.SCROLL_ + BF.appState.currentBookId, _w.scrollTop);
      }
    } catch (e) { BF.log && BF.log.warn('卸载滚动兜底失败：' + (e && e.message)); }
    /* 卸载同步兜底：saveProgress 改 await BF.store.mutate 后，其写入
       发生在微任务里，页面正在卸载时该微任务可能来不及执行；而 lsSet
       是同步必落盘。此处补一条同步写。
       幂等性：此处与异步路径写的是同一个键、同一个「赋值」语义
       （rs[b.id] = {currentChapter, lastRead}），不是累加，
       故二者互为覆盖、不会双写、不会把进度翻倍。 */
    try {
      const _bk = BF.reader.state && BF.reader.state.book;
      if (_bk && _bk.id) {
        const _rs = BF.store.lsGet(BF.store.K.READING_STATE, {}) || {};
        _rs[_bk.id] = { currentChapter: BF.appState.currentChapterIdx, lastRead: Date.now() };
        if (BF.store.lsSet(BF.store.K.READING_STATE, _rs) !== true) {
          BF.log && BF.log.warn('卸载同步兜底：阅读进度未写入（配额拦截或存储异常）');
        }
      }
    } catch (e) { BF.log && BF.log.warn('卸载同步兜底：阅读进度写入异常：' + (e && e.message)); }
    try { BF.modules.disposeAll(); } catch (e) {}
    try { BF.timers.clearAll(); } catch (e) {}
    try { BF.log.flush(); } catch (e) {}
  });
  /* beforeunload 在移动端 Safari 与 bfcache 场景下不可靠，pagehide 是更可靠的关闭信号。
     阅读时长与设置防抖同样需要在此补一次落盘 —— 前者丢了统计，后者丢了设置。 */
  /* DAILY 同步落盘兜底（pagehide 与 visibilitychange 共用）。
     _flush 的 mutate 写入发生在微任务里，页面卸载时可能来不及执行；而 lsSet 同步必落盘。
     与 _flush **互斥**：此处不再调用 _flush()。
     防双写：takePendingSec() 以「取出并清零」语义扣掉 _pending，且其清零与
     _flush 内的 `const _p=_pending; _pending=0;` 同在同步段（await 之前），
     两者不可能拿到同一批秒数，故同一批时长恰好落盘一次。
     防丢失：lsSet 返回 false（配额耗尽等）时用 BF.stats.add(sec) 把这批秒数
     回补进 _pending（add 内部即 `_pending += sec`），下次 flush 仍会补写。 */
  const _flushDailySync = function (tag) {
    try {
      if (!(BF.stats && BF.stats.takePendingSec)) return;
      const _sec = BF.stats.takePendingSec();
      if (!(_sec > 0)) return;
      try {
        const _d = BF.store.lsGet(BF.store.K.DAILY, {}) || {};
        const _k = BF.stats.todayKey();
        _d[_k] = (_d[_k] || 0) + _sec;
        if (BF.store.lsSet(BF.store.K.DAILY, _d) !== true) {
          BF.log && BF.log.warn(tag + '：阅读时长未写入，已回补 ' + _sec + 's');
          BF.stats.add(_sec);
        }
      } catch (e) {
        BF.log && BF.log.warn(tag + '：阅读时长写入异常，已回补 ' + _sec + 's：' + (e && e.message));
        BF.stats.add(_sec);
      }
    } catch (e) { BF.log && BF.log.warn(tag + '：阅读时长兜底异常：' + (e && e.message)); }
  };
  window.addEventListener('pagehide', function () {
    _flushDailySync('pagehide 同步兜底');
    try { BF.settings && BF.settings.save(true); } catch (e) {}
  });
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      _flushDailySync('切后台同步兜底');
      try { BF.settings && BF.settings.save(true); } catch (e) {}
    }
  });
}

