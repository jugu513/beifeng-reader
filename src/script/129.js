/* ================= DSL 终端 ================= */
/* DSL 终端 v3：终端式 REPL + 内置工具集 + 四级权限 + AI 联动
   定位声明：DSL 的定位类似于终端。DSL 执行的是用户本人的 JavaScript，权限等同浏览器
   开发者工具（DevTools）—— 它**不是**沙箱，也不假装是。脚本能碰到的
   全局（window / Function / constructor / localStorage…）与用户在控制台
   里能敲的完全一致；把「拦住几个关键词」当作安全边界既是虚假保障
   （字符串拼接等手段本就拦不住），又会破坏终端的正常用法（导出函数、
   操作 DOM、调试）。
   真正的边界是三件事，与终端定位自洽：
     ① 权限档位 read / data / full / secrets：管控**受认可的能力面**。
        受控写操作一律经 BF.hub 调度（cap.invoke），未声明能力默认拒绝；
        密钥明文只经 _secretGate（danger=3 需回复 y），与档位叠加。
     ② Self-XSS 首开横幅（BF.dslUI，见 _selfXss*）：威胁模型是「有人
        诱骗你粘贴不明脚本」，标准防御是警告横幅，而不是拦用户自己的手。
     ③ read 档网络原语静态拦 + execute 参数遮蔽替身：默认档「防误」——
        不明来历的脚本粘进来，至少不能无声无息把数据发出去；data+ 档
        放行（已授权操作面，与 DevTools 里敲 fetch 同权）。
   目标形态：
     ① 像终端一样逐行执行、历史记录、清屏；
     ② 可底层操控（导入/批量/备份/元数据/阅读器/中枢设置与密钥）；
     ③ 可编程：脚本能定义并导出函数，供 REPL 或其他脚本调用；
     ④ 可测试：assert / bench / mock，失败不中断整段，留痕到 jobs；
     ⑤ AI 联动：CONSOLE_BF.ai.ask 转发真实问书；AI 结果可复制为脚本。
   实现要点：
     ① CONSOLE_BF 注入受限代理（名字即立场：不叫 SAFE_BF），写操作经 hub；
     ② ctx.prompt/confirm 保持返回 Promise，模板与内置脚本用 await；
     ③ state 只读壳（get 深拷贝 + set 拒绝），不再直漏原始对象；
     ④ ai.ask 转发 BF.ai.runCard('ask')；
     ⑤ 死循环正则全档位拦（与权限无关：同步死循环冻死整个页面，
        包括用来取消它的 UI）；
     ⑥ 静态校验按档位：read 拦网络原语，data+ 放行（见 _DSL_FORBID）。 */
BF.dsl = (function () {
  const LS_SCRIPTS = 'dsl_scripts';
  /* 脚本启停的真实标记是 dsl_scripts 数组内的 sc.active 字段。 */
  const LS_PERM = 'dsl_perm';            /* 权限档位：见 PERM_LEVELS（会话级） */
  const LS_GRANT = 'dsl_perm_granted';   /* 授权时间戳，用于 7 天有效期判定 */
  /* 权限档位单一真源：perm 命令的 tab 补全展示与帮助文本都取这里，
     避免加档位时只改判定不改展示——展示漂移比功能错更难发现。 */
  const PERM_LEVELS = ['read', 'data', 'full', 'secrets'];
  /* ---- 脚本库：多脚本增删改、启停、持久化 ---- */
  const DEFAULT_SCRIPTS = [
    { id: 'export_backup', name: '导出备份', active: true, code: 'ctx.toast("正在导出备份...");\nBF.bk.exportWithAsk();\nreturn "已触发导出";' },
    { id: 'toggle_theme', name: '切换外观', active: true, code: 'BF.theme.cycle();\nreturn "已切换外观：" + BF.skin.get();' },
    { id: 'search_book', name: '搜索全书', active: true, code: 'const q = await ctx.prompt("输入关键词");\nif (q) { BF.reader.searchAll(q); return "已搜索：" + q; }\nreturn "已取消";' },
    { id: 'open_stats', name: '打开统计', active: true, code: 'BF.statsPanel.open();\nreturn "已打开统计";' },
    { id: 'open_help', name: '打开手册', active: true, code: 'BF.help.open();\nreturn "已打开手册";' },
  ];
  /* ---- 工具集（内置底层操作，供脚本与 REPL 调用） ---- */
  /* ---------- 命令表（唯一来源）----------
     一条命令一行：名字 / Tab 补全词 / 用法 / 说明 / 参数候选。
     help 文案、Tab 命令补全、参数候选三处全部由这两张表派生。
     若是四处各写一份（handlers 实现、help 数组、REPL_CMDS、_argCandidates），
     加一条命令要记得四处，漏一处就是「能跑但 help 里没有」或「Tab 补不出来」。 */
  const CMDS = [
    { name: 'help',     tab: 'help',     usage: 'help [caps|types|lang]', desc: '命令一览；子词看专页' },
    { name: 'manual',   tab: 'manual',   usage: 'manual',             desc: '完整手册（Markdown，可导出）' },
    { name: 'theme',    tab: 'theme ',   usage: 'theme [档名]',       desc: '切换外观；不带档名则循环', args: function () { const ks = (BF.SKINS || []); return ks.concat(ks.map(function (k) { return BF.skin.label(k); })).concat(ks.map(function (k) { return BF.SKIN_SUBS[k]; })); } },
    { name: 'go',       tab: 'go ',      usage: 'go <page>',          desc: '跳转页面（home/bookshelf/reader）', alias: ['cd'], args: function () { return ['home', 'bookshelf', 'reader']; } },
    { name: 'open',     tab: 'open ',    usage: 'open <书名>',         desc: '按书名打开书', args: function () { return (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).filter(function (b) { return b && b.title; }).map(function (b) { return String(b.title); }); } },
    { name: 'notify',   tab: 'notify ',  usage: 'notify <消息>',       desc: '发送通知' },
    { name: 'settings', tab: 'settings ',usage: 'settings <key> [v]', desc: '读/写设置（写需 data 级授权）' },
    { name: 'key',      tab: 'key ',     usage: 'key ai|mimo <值>',   desc: '写入 AI / MiMo 朗读密钥（full 级，回复 y 确认，不回显明文）', args: function () { return ['ai', 'mimo']; } },
    { name: 'ls',       tab: 'ls',       usage: 'ls',                 desc: '列出 localStorage 键', alias: ['dir'] },
    { name: 'bk',       tab: 'bk ',      usage: 'bk [now|export]',    desc: '立即备份 / 弹出导出询问（缺省 now）' },
    { name: 'stats',    tab: 'stats',    usage: 'stats',              desc: '今日分钟 · 累计小时 · 连续天数' },
    { name: 'scene',    tab: 'scene ',   usage: 'scene [名]',         desc: '列出内置场景 / 应用某场景', args: function () { return Object.keys(BF.SCENES || {}); } },
    { name: 'ask',      tab: 'ask ',     usage: 'ask <问题>',         desc: '问一句（单轮，带当前书与章节作上下文）', alias: ['ai'] },
    { name: 'chat',     tab: 'chat ',    usage: 'chat [问题|clear|stop]', desc: '多轮对话：不带参数进出会话模式' },
    { name: 'agent',    tab: 'agent ',   usage: 'agent <问题>',      desc: 'Agent 模式：可调用本地工具（检索全书 / 定位等），跑完给结论' },
    { name: 'tts',      tab: 'tts ',     usage: 'tts <动作>',         desc: 'play / pause / resume / stop / status', args: function () { return ['play', 'pause', 'resume', 'stop']; } },
    { name: 'find',     tab: 'find ',    usage: 'find <词>',          desc: '在当前章内查找' },
    { name: 'tag',      tab: 'tag',      usage: 'tag',                desc: '列出全部标签' },
    { name: 'zoom',     tab: 'zoom ',    usage: 'zoom [n]',           desc: '阅读页字号增减（缺省 +1，0 复位）' },
    { name: 'ver',      tab: 'ver',      usage: 'ver',                desc: '版本 · 外观档 · 权限档 · 当前页' },
    { name: 'where',    tab: 'where ',   usage: 'where <词>',         desc: '查一个词是不是命令（别名指向谁）' },
    { name: 'close',    tab: 'close',    usage: 'close',              desc: '关闭终端面板', alias: ['exit', 'quit'] },
    { name: 'clip',     tab: '> clip',   usage: '> clip',              desc: '输出重定向：把上一条结果送进剪贴板（>clip / > clip 均可，须单独成行）' },
    /* 工程模式不进命令一览、也不进 Tab 补全：它是给自己人用的运维入口
       （起本地预览与转发服务 + 导出可执行脚本），写在用户手册里等于把门牌挂出去。
       命令本身照常可用，help beifeng666 也照常给卡片；漂移自检仍把它算在表内。 */
    { name: 'beifeng666', tab: '', usage: 'beifeng666', hidden: 1, desc: '进入工程模式并自动导出自包含启动器 bat（预览 / 转发器分别启动，无需 tool 目录）' },
    { name: 'ops',      tab: 'ops ',     usage: 'ops bat|ping|off',   desc: '工程模式命令：重新导出 bat / 探活预览与转发器 / 退出模式', args: function () { return ['bat', 'ping', 'off']; } },
  ];
  const META_CMDS = [
    { name: 'js',    tab: 'js ',    usage: 'js <code>',      desc: '执行 JS（自动 await）' },
    { name: 'clear', tab: 'clear',  usage: 'clear',          desc: '清空输出', alias: ['cls'] },
    { name: 'perm',  tab: 'perm ',  usage: 'perm',           desc: '查看当前权限档位', args: function () { return PERM_LEVELS.slice(); } },
    { name: 'perm',  tab: null,     usage: 'perm data|full', desc: '申请授权（需确认）' },
    { name: 'perm',  tab: null,     usage: 'perm read',      desc: '回到只读' },
  ];
  /* 别名表与命令卡都从上面两张表派生 —— 别名只住 CMDS/META_CMDS 一处，
     help、Tab 补全、`where`、漂移自检自动跟上；另立一份别名表必然漂移。
     只收「cmd 用户的第一反射」且语义真有对应物的词：dir→ls、cd→go、
     cls→clear、exit/quit→close。cmd 的 type/ver 一类没有对应物的不硬凑。 */
  const ALIAS = (function () {
    const m = {};
    CMDS.concat(META_CMDS).forEach(function (c) {
      (c.alias || []).forEach(function (a) { m[a.toLowerCase()] = c.name; });
    });
    return m;
  })();
  function _cmdRows(word) {
    return CMDS.concat(META_CMDS).filter(function (c) {
      return c.name === word || (c.alias || []).indexOf(word) >= 0;
    });
  }
  const _HELP_FLAGS = { '/?': 1, '/h': 1, '-h': 1, '--help': 1 };
  function _isHelpFlag(a) { return !!_HELP_FLAGS[String(a).toLowerCase()]; }
  function _cmdNames() {
    const s = [];
    CMDS.concat(META_CMDS).forEach(function (c) { if (s.indexOf(c.name) < 0) s.push(c.name); });
    Object.keys(ALIAS).forEach(function (a) { if (s.indexOf(a) < 0) s.push(a); });
    return s;
  }
  /* 打错的词给最近邻：前缀命中优先，其次只差一个字符（增删换）——
     不引编辑距离库，命令名都短，一字符差异足够覆盖「typo 那一类」。 */
  function _nearWords(word) {
    const names = _cmdNames();
    const pre = names.filter(function (n) { return n.indexOf(word) === 0 && n !== word; });
    if (pre.length) return pre.slice(0, 4);
    const one = names.filter(function (n) {
      if (n === word || Math.abs(n.length - word.length) > 1) return false;
      let i = 0, skip = 0;
      while (i < Math.max(n.length, word.length)) {
        if (n[i + skip] !== word[i]) { if (skip) return false; skip = 1; }
        i++;
      }
      return true;
    });
    return one.slice(0, 4);
  }
  /* 单条命令卡：help <命令> 与 cmd 习惯的 `<命令> /?` 都落在这里。
     usage 只在 CMDS 写一份，卡片是读出来的，不是再抄一遍。 */
  function _cmdCard(word) {
    const rows = _cmdRows(word);
    if (!rows.length) {
      const near = _nearWords(word);
      return '不是内部或外部命令，也不是可运行的脚本：' + word +
        '（输入 help 看全部命令' + (near.length ? '；你是不是想输 ' + near.join(' / ') : '') + '）';
    }
    const out = [];
    const aliasOf = rows.filter(function (c) { return (c.alias || []).indexOf(word) >= 0; });
    if (aliasOf.length) out.push('别名：' + word + ' → ' + aliasOf[0].name);
    rows.forEach(function (c) {
      out.push('用法：' + c.usage);
      out.push('  ' + c.desc);
      if (typeof c.args === 'function') {
        let a = [];
        try { a = c.args() || []; } catch (e) { a = []; }
        if (a.length) out.push('  参数：' + a.slice(0, 14).join(' · ') + (a.length > 14 ? ' …共 ' + a.length + ' 项' : ''));
      }
    });
    return out.join('\n');
  }
  const TOOLS = {
    /* ===== 元数据 ===== */
    listBooks: function () {
      /* 与 getBook 一致，走 mergeReadingState 合并读进度 */
      return (BF.library.mergeReadingState(BF.store.lsGetArray(BF.store.K.BOOKS_META, [])) || []).map(function (b) {
        return { id: b.id, title: b.title, totalChapters: b.totalChapters, wordCount: b.wordCount, size: b.size, importedAt: b.importedAt, lastRead: b.lastRead, currentChapter: b.currentChapter, starred: b.starred, tags: b.tags || [] };
      });
    },
    getBook: function (id) {
      /* 读进度必须走合并接口 —— books_meta 里的 currentChapter/lastRead 可能是
         陈旧空值（真相在 bf_reading_state），直接读会让 DSL/命令拿到 null。 */
      const b = (BF.library.mergeReadingState(BF.store.lsGetArray(BF.store.K.BOOKS_META, [])) || []).find(function (x) { return x && x.id === id; });
      return b ? { id: b.id, title: b.title, totalChapters: b.totalChapters, wordCount: b.wordCount, size: b.size, importedAt: b.importedAt, lastRead: b.lastRead, currentChapter: b.currentChapter, starred: b.starred, tags: b.tags || [] } : null;
    },
    bookStats: function (id) {
      const b = BF.dsl.tools.getBook(id);
      if (!b) return null;
      const bms = BF.store.lsGetArray(BF.store.K.BOOKMARKS, []) || [];
      const hls = BF.store.lsGetArray(BF.store.K.HIGHLIGHTS, []) || [];
      const notes = BF.notes ? BF.notes.all() : [];
      return {
        title: b.title, totalChapters: b.totalChapters, wordCount: b.wordCount,
        bookmarks: bms.filter(function (x) { return x && x.bookId === id; }).length,
        highlights: hls.filter(function (x) { return x && x.bookId === id; }).length,
        notes: (notes || []).filter(function (x) { return x && x.bookId === id; }).length,
        importedAt: b.importedAt, lastRead: b.lastRead,
      };
    },
    getChapterText: function (id, idx) {
      const b = BF.dsl.tools.getBook(id);
      if (!b) return Promise.resolve('');
      return BF.library.getChapterText(b, idx || 0).catch(function () { return ''; });
    },
    /* ===== 导入（复用既有链路，返回元数据 + 导入时间） ===== */
    importFile: async function (file) {
      const before = Date.now();
      await BF.library.importFile(file);
      const b = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).filter(function (x) { return x && x.importedAt >= before; });
      const nb = b[b.length - 1] || null;
      return nb ? { ok: true, id: nb.id, title: nb.title, importedAt: nb.importedAt, totalChapters: nb.totalChapters, wordCount: nb.wordCount, size: nb.size } : { ok: false, error: '导入未产生新书（可能为重复导入）' };
    },
    batchImport: async function (files) {
      const list = Array.isArray(files) ? files : [files];
      const out = { ok: 0, fail: 0, items: [] };
      for (const f of list) {
        try { out.items.push(await BF.dsl.tools.importFile(f)); out.ok++; }
        catch (e) { out.fail++; out.items.push({ ok: false, name: f && f.name, error: e.message }); }
      }
      return out;
    },
    /* ===== 阅读操控 ===== */
    openBook: function (id) { return BF.app.openBook(id); },
    gotoChapter: function (i) { return BF.reader.gotoChapter(i); },
    searchInBook: function (q) { return BF.reader.searchAll(q); },
    /* ===== 备份 / 数据 ===== */
    backupNow: function () { return BF.bk.autoNow ? BF.bk.autoNow() : BF.bk.exportWithAsk(); },
    exportBackup: function () { return BF.bk.exportWithAsk(); },
    /* ===== 存储（受控：data 级只放行应用白名单键；full 级放行任意键） =====
       密钥读统一经 _secretGate 鉴权 —— 密钥键（含密钥载体
       「settings」整键）返回 Promise（脚本 await 取明文），
       未批准（含 read 档）回 null，与「键不存在」不可区分；
       普通键保持同步契约不变。 */
    lsRead: function (k) {
      if (_isSecretLSKey(k)) {
        return _secretGate('lsRead("' + k + '")').then(function (ok) {
          return ok ? BF.store.lsGet(k, null) : null;
        });
      }
      return BF.store.lsGet(k, null);
    },
    lsWrite: function (k, v) { return _permWrite(k, v); },
    /* 密钥枚举亦受统一鉴权约束 —— read 档隐藏密钥载体键名；
       键名本身不是明文，data/full 档可见（值读取仍经闸门）。 */
    lsKeys: function () {
      const all = BF.store.lsKeys();
      if (_permLevel() === 'read') {
        return all.filter(function (k) { return !_isSecretLSKey(k); });
      }
      return all;
    },
    /* ===== 设置批量操控（中枢控制） =====
       核心场景：DSL 批量改设置（主题/字号/朗读/搜索并发等）。
       data 级：白名单键（settings 本身在白名单，但敏感键除外）；
       full 级：任意设置键，含 AI 密钥（aiApiKey / mimoApiKey 等）。
       密钥设置项（PRIV_KEYS）读/改统一经 _secretGate ——
       返回 Promise（脚本 await 取明文/结果）；非密钥键保持
       同步契约。 */
    settings: {
      get: function (k) {
        /* 预设是密钥载体键（同 ctx.settings.get 那条注释）：预设里带 aiApiKey 时按
           secrets 档处理，未批准只回剥掉密钥的副本。 */
        if (k === 'aiPresets') {
          const pv = BF.settings.getCopy(k) || {};
          let hasKey = false;
          try { hasKey = Object.keys(pv).some(function (n) { return pv[n] && typeof pv[n] === 'object' && 'aiApiKey' in pv[n]; }); } catch (e) { hasKey = true; }
          if (!hasKey) return pv;
          return _secretGate('settings.get("aiPresets")（预设内含密钥）').then(function (ok) {
            if (ok) return pv;
            return BF.store.stripPresetSecrets({ aiPresets: JSON.parse(JSON.stringify(pv)) }).aiPresets;
          });
        }
        if (_isSecretSettingKey(k)) {
          return _secretGate('settings.get("' + k + '")').then(function (ok) {
            return ok ? BF.settings.get(k) : undefined;
          });
        }
        return BF.settings.getCopy(k);
      },
      /* 全量快照含全部密钥明文，统一经鉴权 —— 返回 Promise：
         批准 → 全量快照；未批准（含 read 档）→ 剥密钥快照。
         剥离集必须是 PRIV_KEYS（密钥真源），不能用 SETTING_DENY ——
         后者是「AI 禁改清单」（含 autoBackup 等非密钥项），
         按它剥离会把非敏感设置一并藏掉，隐藏范围过宽。 */
      all: function () {
        return _secretGate('settings.all()').then(function (ok) {
          const s = BF.settings.all ? BF.settings.all() : {};
          if (ok) return JSON.parse(JSON.stringify(s));
          return _stripSecretSettings(s);
        });
      },
      set: function (k, v) {
        const deny = (BF.ai && BF.ai.SETTING_DENY) || [];
        /* 写侧对称：把密钥塞进预设同样是在绕开「密钥写入需回复 y + full 档」这条规矩，
           所以带 aiApiKey 的 aiPresets 写入按密钥写入处理。 */
        if (k === 'aiPresets' && (function () {
          try { return Object.keys(v || {}).some(function (n) { return v[n] && typeof v[n] === 'object' && 'aiApiKey' in v[n]; }); } catch (e) { return true; }
        })()) {
          return _secretGate('settings.set("aiPresets")（预设内含密钥）').then(function (ok) {
            if (!ok) return { ok: false, error: '密钥写入被拒绝（需回复 y 确认）' };
            if (_permLevel() !== 'full') return { ok: false, error: '预设内含密钥，写入需 full 权限（perm full）' };
            BF.settings.set(k, v);
            if (BF.settings.save) BF.settings.save(true);
            return { ok: true };
          });
        }
        if (_isSecretSettingKey(k)) {
          /* 写密钥统一经鉴权（BF.ask danger=3 需回复 y，
             full 档亦逐次确认），且保持 full 级门槛 */
          return _secretGate('settings.set("' + k + '")').then(function (ok) {
            if (!ok) return { ok: false, error: '密钥写入被拒绝（需回复 y 确认）' };
            if (_permLevel() !== 'full') return { ok: false, error: '敏感设置（' + k + '）需 full 权限（perm full）' };
            /* 密钥写入必须走 BF.settings.set 单键（内存态 + 标脏 + 事件广播），
               不能整包 _permWrite 直写 LS：直写只落存储、不进内存态——
               BF.settings.get 仍回旧值、无 SETTINGS 广播（界面不刷新 /
               主题不重应用 / 跨页不同步），且下次 BF.settings 任一 set
               会把这次写入整包覆盖。
               写入后立即 save(true) 落盘：DSL 写入是离散操作，调用方
               按返回值同步读 LS 真值（同步直写契约保持）；
               密钥尤其不能等 200ms 防抖（防抖窗口内关页面即丢）。 */
            try {
              BF.settings.set(k, v);
              if (BF.settings.save) BF.settings.save(true);
              return { ok: true, value: v };
            }
            catch (e) { return { ok: false, error: e.message }; }
          });
        }
        if (k === 'theme') {
          /* 'theme' 在合并成单一 appearance 时就不是设置键了：照写只会留一个没人读的死键，
             换档还不重染 —— 脚本看着返回成功、其实什么都没发生。给出出口，不静默。 */
          return { ok: false, error: 'theme 已并入 appearance：换档请用 BF.theme.set("档名") / BF.theme.cycle()（走登记表裁决并负责重染）' };
        }
        if (deny.indexOf(k) !== -1) {
          /* 敏感键（安全/数据）→ 仅 full 级可写 */
          if (_permLevel() !== 'full') return { ok: false, error: '敏感设置（' + k + '）需 full 权限（perm full）' };
        }
        /* 同上：权限校验后走 BF.settings.set，
           不直写 LS（详情见上方密钥分支注释）；
           写入后立即 save(true) 落盘（离散写入
           不同步等防抖）。 */
        const g = _permCan('settings');
        if (!g.ok) return g;
        try {
          BF.settings.set(k, v);
          if (BF.settings.save) BF.settings.save(true);
          return { ok: true, value: v };
        }
        catch (e) { return { ok: false, error: e.message }; }
      },
      setMany: function (obj) {
        const keys = obj && typeof obj === 'object' ? Object.keys(obj) : [];
        const out = { ok: [], bad: [] };
        /* 密钥键经异步闸门，批量等待全部落定再结算 */
        return Promise.all(keys.map(function (k) {
          return Promise.resolve(TOOLS.settings.set(k, obj[k])).then(function (r) {
            (r.ok ? out.ok : out.bad).push({ k: k, v: obj[k], error: r.error });
          });
        })).then(function () { return out; });
      },
    },
    /* ===== 密钥批量操控（中枢控制核心场景之一） =====
       用于切换服务商时一次配好多个密钥。
       密钥键（aiApiKey/mimoApiKey 等）在 SETTING_DENY 内，必须 full 权限 + 确认。
       写密钥统一经 _secretGate（BF.ask danger=3 需回复 y，
       full 档亦逐次确认），返回 Promise。不读回密钥明文
       （只回显是否已配置）。 */
    keys: {
      /* kind 可选：'ai'（默认，写 aiApiKey）/ 'mimo'（写 mimoApiKey，MiMo 朗读密钥）。
         校验、full 档早退、_secretGate 逐次确认三件照旧，label 带上种类；
         返回仍只含 {ok, keySet}，绝不回显密钥明文。 */
      set: function (providerId, key, kind) {
        const isMimo = kind === 'mimo';
        if (kind && kind !== 'ai' && !isMimo) return { ok: false, error: '未知密钥种类：' + kind + '（可用 ai / mimo）' };
        const k = isMimo ? 'mimoApiKey' : 'aiApiKey';
        const P = BF.ai.PROVIDERS || [];
        if (!isMimo) {
          const p = P.find(function (x) { return x && x.id === providerId; });
          if (!p) return { ok: false, error: '未知服务商：' + providerId + '（可选：' + P.map(function (x) { return x.id; }).join('/') + '）' };
        }
        if (_permLevel() !== 'full') return { ok: false, error: '写密钥需 full 权限（perm full）' };
        return _secretGate('keys.set(' + (isMimo ? 'mimo' : providerId) + ')').then(function (ok) {
          if (!ok) return { ok: false, error: '密钥写入被拒绝（需回复 y 确认）' };
          try {
            BF.settings.set(k, String(key || ''));
            BF.noti && BF.noti.success(isMimo ? '已写入 MiMo 朗读密钥' : '已写入 ' + providerId + ' 密钥');
            return isMimo ? { ok: true, kind: 'mimo', keySet: !!key } : { ok: true, provider: providerId, keySet: !!key };
          }
          catch (e) { return { ok: false, error: e.message }; }
        });
      },
      setMany: function (map) {
        const out = { ok: [], bad: [] };
        return Promise.all(Object.keys(map || {}).map(function (pid) {
          return Promise.resolve(TOOLS.keys.set(pid, map[pid])).then(function (r) {
            (r.ok ? out.ok : out.bad).push({ provider: pid, ok: r.ok, error: r.error });
          });
        })).then(function () { return out; });
      },
      list: function () {
        const rows = (BF.ai.PROVIDERS || []).map(function (p) { return { id: p.id, name: p.name, configured: !!(BF.settings.get('aiApiKey') && p.id === (BF.ai.currentProvider ? (BF.ai.currentProvider().id) : '')) }; });
        /* MiMo 朗读密钥的配置状态也在这里报（布尔）；除「是否已配置」外不给任何信息 */
        rows.push({ id: 'mimo', name: 'MiMo(TTS)', configured: !!BF.settings.get('mimoApiKey') });
        return rows;
      },
    },
    /* ===== 书架批量操控（中枢控制核心场景之二） =====
       批量收藏 / 打标签 / 删除 / 改元数据。 */
    books: {
      list: function () { return TOOLS.listBooks(); },
      get: function (id) { return TOOLS.getBook(id); },
      batchTag: function (ids, tag, add) {
        const arr = BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || [];
        let n = 0;
        ids.forEach(function (id) {
          const b = arr.find(function (x) { return x && x.id === id; });
          if (!b) return;
          b.tags = b.tags || [];
          if (add === false) { const i = b.tags.indexOf(tag); if (i >= 0) { b.tags.splice(i, 1); n++; } }
          else if (b.tags.indexOf(tag) === -1) { b.tags.push(tag); n++; }
        });
        const r = _permWrite('books_meta', arr);
        if (!r.ok) return r;
        try { BF.app.renderBookshelf(); } catch (e) { BF.err.report('render.afterBatchTag', e); }
        return { ok: true, changed: n };
      },
      batchStar: function (ids, on) {
        const arr = BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || [];
        let n = 0;
        ids.forEach(function (id) {
          const b = arr.find(function (x) { return x && x.id === id; });
          if (!b) return;
          if (b.starred !== on) { b.starred = on; n++; }
        });
        const r = _permWrite('books_meta', arr);
        if (!r.ok) return r;
        try { BF.app.renderBookshelf(); } catch (e) { BF.err.report('render.afterBatchStar', e); }
        return { ok: true, changed: n };
      },
      batchDelete: function (ids) {
        /* 批量删除：走带确认的唯一入口 BF.app.deleteBooks。
           脚本不得绕过确认框清空书架，返回的 note 也不得承诺撤销得了；
           这条与界面同标准，落点是回收站。 */
        ids = (ids || []).filter(Boolean);
        if (!ids.length) return { ok: false, error: '未指定书籍 ID' };
        if (BF.app && BF.app.deleteBooks) return BF.app.deleteBooks(ids).then(function (done) {
          return done ? { ok: true, deleted: ids.length } : { ok: false, error: '已取消' };
        });
        return { ok: false, error: '批量删除入口不可用' };
      },
    },
    /* ===== 测试工具 ===== */
    assert: function (cond, msg) {
      if (!cond) { var e = new Error('断言失败：' + (msg || '条件不成立')); e.dslAssert = true; throw e; }
      return true;
    },
    bench: function (fn, n) {
      n = Math.max(1, parseInt(n, 10) || 1);
      var t0 = performance.now();
      for (var i = 0; i < n; i++) fn();
      return { runs: n, ms: +(performance.now() - t0).toFixed(2), avg: +((performance.now() - t0) / n).toFixed(3) };
    },
    /* assert 只有上面那一个定义（抛异常版，与 DSL 手册、官方自检脚本一致）。
       对象字面量里再挂一个同名的 `assert`（返回 {ok:false} 版），后写的会静默覆盖
       先写的 ⇒ 手册说「断言失败会抛」而实际不抛，脚本里的断言全成了摆设。 */
    runScript: function (id, args) { return BF.dsl.runScript(id, args); },
    /* ===== DSL 手册（教 AI / 开发者使用 DSL；可导出为 .md） ===== */
    manual: function () {
      return [
        '# 北风 DSL 手册',
        '',
        'DSL 终端是北风的命令行式操控台：可以逐行执行、编写可保存的脚本、',
        '通过内置工具集批量操控程序（导入书籍 / 批量改设置 / 批量配密钥 / 书架批量操作 / 测试）。',
        '',
        '## 一、两种执行方式',
        '',
        '1. **REPL 逐行**：面板底部提示符即当前位置（`C:\\beifeng\\书架>`、`C:\\beifeng\\《书名》\\第3章>`），回车执行；↑↓ 翻历史；`clear`（或 `cls`）清屏。',
        '2. **脚本库**：编辑器写整段代码，保存后在 DSL 脚本库点击运行，或用 `ctx.tools.runScript(id)` 调用。',
        '',
        '命令行习惯对齐：命令一律裸词（`perm` / `js` / `clear`），带 `!` 的老写法仍然等价；',
        'cmd 的 `dir`→`ls`、`cd`→`go`、`cls`→`clear`、`exit`→`close` 都做了别名；',
        '任何命令后面加 `/?` 或 `-h` 就地看它自己的用法（如 `tts /?`），`where <词>` 查一个词到底是什么。',
        '',
        '## 二、命令（REPL 直接输入）',
        '',
        '| 命令 | 作用 |',
        '| --- | --- |',
        '| `help` | 本帮助 |',
        '| `theme` | 切换外观（按外观登记表全档循环：浅色/深色/纯黑/系统/墨绿/高级灰/夜航） |',
        '| `go <page>` | 跳转页面（home/bookshelf/reader） |',
        '| `open <书名>` | 按书名打开书 |',
        '| `notify <消息>` | 发送通知 |',
        '| `settings <key> [v]` | 读/写设置 |',
        '| `ls` | 列出 localStorage 键 |',
        '| `bk [now\\|export]` | 立即备份 / 弹出导出询问（缺省 now） |',
        '| `stats` | 今日分钟 · 累计小时 · 连续天数 |',
        '| `scene [名]` | 无参列出内置场景，有参应用场景 |',
        '| `tts <动作>` | play / pause / resume / stop / status |',
        '| `find <词>` | 在当前章内查找 |',
        '| `tag` | 列出全部标签 |',
        '| `zoom [±n]` | 阅读页字号增减（缺省 +1，0 复位默认） |',
        '| `js <code>` | 执行 JS（自动 await；裸表达式自动返回） |',
        '| `clear` | 清空输出 |',
        '| `perm` | 查看权限 |',
        '| `perm data` | 申请应用数据写（弹窗确认） |',
        '| `perm full` | 申请全局写 + 密钥（弹窗确认） |',
        '| `perm read` | 回到只读 |',
        '',
        '## 三、内置工具集（ctx.tools.* / BF.tools.*）',
        '',
        '### 元数据',
        '- `listBooks()` → 全部书（id/title/章节数/字数/导入时间/收藏/标签）',
        '- `getBook(id)` → 单本书元数据',
        '- `bookStats(id)` → 书签/划线/便签统计',
        '- `getChapterText(id, idx)` → 章节正文',
        '',
        '### 导入',
        '- `importFile(file)` → 导入并返回 {id, title, importedAt, totalChapters, wordCount}',
        '- `batchImport(files[])` → 批量导入，逐本结果 + 汇总',
        '',
        '### 配置写入',
        '- `settings.set(key, value)` / `settings.setMany({k:v})` → 批量改设置（data 级）',
        '- `keys.set(providerId, key[, kind])` / `keys.setMany({pid:key})` → 批量写密钥（full 级）；kind 可选 \'ai\'（默认）/ \'mimo\'（MiMo 朗读密钥）',
        '- `keys.list()` → 各服务商（含 MiMo 朗读）是否已配置',
        '',
        '### 书架批量',
        '- `books.list()` / `books.get(id)` → 同元数据',
        '- `books.batchTag(ids, tag, add)` → 批量打/删标签（data 级）',
        '- `books.batchStar(ids, on)` → 批量收藏（data 级）',
        '- `books.batchDelete(ids)` → 批量删除（data 级，移入回收站，可恢复）',
        '',
        '### 阅读 / 备份 / 存储',
        '- `openBook(id)` / `gotoChapter(i)` / `searchInBook(q)`',
        '- `backupNow()` / `exportBackup()`',
        '- `lsRead(k)` / `lsWrite(k,v)`（受控写）/ `lsKeys()`',
        '- 密钥键（`settings` 整键 / `aiApiKey` 等）读取需 `await` 且经弹窗确认（read 档拒绝）',
        '',
        '### 测试',
        '- `assert(cond, msg)` → 断言失败抛错（红色输出）',
        '- `bench(fn, n)` → 计时跑 n 次，返回 {runs, ms, avg}',
        '',
        '## 四、脚本编写',
        '',
        '脚本是普通 JS，注入两个对象：',
        '',
        '- `BF`：脚本可用的动作清单。写操作统一走 `BF.cap.invoke(id, args)`，按当前权限档位放行；可调用清单见 `BF.cap.list()`。',
        '- `ctx`：兼容旧脚本的便捷对象。',
        '  - `ctx.tools.*` = 工具集；`ctx.ai.ask(q)` 问书；`ctx.prompt(label)` 弹输入框（返回 Promise，需 await）；',
        '  - `ctx.toast(msg)` / `ctx.noti.*` 通知；`ctx.go(page)` / `ctx.lsGet(k)` 等。',
        '',
        '脚本 `return` 的值会显示在输出区；REPL 裸表达式自动返回。',
        '',
        '### 示例',
        '',
        '```js',
        '// 批量改设置：主题 + 字号 + 行距（data 权限）',
        'const r = ctx.tools.settings.setMany({ theme: "dark", fontSize: 18, lineHeight: 2 });',
        'return r;',
        '```',
        '',
        '```js',
        '// 批量配密钥：切换服务商一次配好（先 perm full）',
        'const r = ctx.tools.keys.setMany({ zhipu: "你的密钥", nvidia: "你的密钥" });',
        'return r;',
        '```',
        '',
        '```js',
        '// 导入书籍并取时间戳',
        'const r = await ctx.tools.batchImport([file1, file2]);',
        'return r.items.map(x => x.title + " @" + new Date(x.importedAt).toLocaleString());',
        '```',
        '',
        '```js',
        '// 用 DSL 写测试',
        'ctx.tools.assert(1 + 1 === 2, "算术");',
        'const t = ctx.tools.bench(() => 1 + 1, 1000);',
        'return t; // {runs:1000, ms:…, avg:…}',
        '```',
        '',
        '## 五、安全模型（终端定位 · 四级权限）',
        '',
        'DSL 是北风的终端：脚本以**你本人的权限**运行，权限等同浏览器开发者工具（DevTools）。',
        '它不是沙箱：你能在控制台里做的，脚本同样能做（读写数据、操作 DOM、联网、导出函数）。',
        '真正的边界是下面三件事，而不是「拦住几个关键词」的黑名单：',
        '',
        '| 级别 | 可做什么 | 如何获得 |',
        '| --- | --- | --- |',
        '| read（默认） | 读数据 + 触发受控动作（翻页/通知/搜索/备份）；禁联网与动态求值 | 无需授权 |',
        '| data | 写应用白名单键（书架/便签/书签/划线/生词/设置非敏感键）；放行网络原语 | `perm data` + 确认 |',
        '| full | 任意 localStorage 键 + 设置全部键 + AI 密钥 | `perm full` + 确认 |',
        '| secrets | 读取 AI 密钥明文（独立授权；同时含 full 档全部写权限） | `perm secrets` + 确认 |',
        '',
        '权限仅本次页面会话有效，关闭页面后复位为只读。',
        '写操作统一经 BF.cap.invoke 按权限档位放行；未登记的动作一律拒绝。',
        '密钥明文每次读取都要单独确认（回复 y），与权限档位叠加。',
        '**不要粘贴任何你不理解的脚本**：首开横幅已警告，终端不防被诱骗粘贴，只防误操作。',
        '',
        '## 六、AI 联动',
        '',
        '- 脚本内问书：`await ctx.ai.ask("问题")`（走真实网关，密钥不外泄给脚本）',
        '- AI 研读结果区「复制到 DSL」：把 AI 回答填入脚本编辑器，检查后运行/保存',
        '- 模型：设置里的「模型」留空时按该服务商的推荐模型走。想知道有哪些模型，用设置里的「拉取模型」拉一份名单，或在「模型」框里手填',
        '',
        '## 七、导出与分享',
        '',
        '- 面板「导出」：全部脚本存为 JSON（导入时按当前权限档位校验：只读档拦联网/动态求值，同步死循环全档位拦）',
        '- 本手册：面板「手册」或 `ctx.tools.exportManual()` 导出 .md 文件',
        '',
        '— 北风 V' + (BF.version || '') + ' DSL 手册',
      ].join('\n');
    },
    exportManual: function () {
      const md = TOOLS.manual();
      /* 统一走 BF.exportBlob（保存选择器优先、a[download] 降级已内建于
         BF.download，无需在此手写降级分支）。 */
      /* 按 exportBlob 返回值门控（同步站点走 .then，
         对齐阅读笔记导出的门控模式；取消保存选择器不弹成功） */
      BF.exportBlob('北风DSL手册.md', md, { mime: 'text/markdown;charset=utf-8' })
        .then(function (ok) { if (ok && BF.noti) BF.noti.success('DSL 手册已导出'); });
      return { ok: true, name: '北风DSL手册.md', chars: md.length };
    },
    help: function (topic) {
      /* 一页速查就是本页；专页按子词分派。handlers.help（裸写法）与 handleMeta
         （带 ! 的老写法）都调到这里，两条路径同一份内容。 */
      const t = String(topic || '').toLowerCase();
      if (t === 'cap' || t === 'caps') return _helpCaps();
      if (t === 'type' || t === 'types') return _helpTypes();
      if (t === 'script' || t === 'lang') return _helpLang();
      if (t) return _cmdCard(t);
      const _w = CMDS.concat(META_CMDS).reduce(function (m, c) { return Math.max(m, c.usage.length); }, 0);
      const _row = function (c) {
        return '  ' + c.usage + ' '.repeat(_w - c.usage.length + 2) + c.desc +
          (c.alias && c.alias.length ? '（别名 ' + c.alias.join(' / ') + '）' : '');
      };
      return [
        'DSL 终端 · 命令一览（裸词即可；想加前缀也行，带符号的老写法等价）',
      ].concat(CMDS.filter(function (c) { return !c.hidden; }).map(_row), META_CMDS.filter(function (c) { return !c.hidden; }).map(_row), [
        '',
        '专页：help caps 可调用动作（含当前是否已授权）· help types 类型系统 · help lang 语言要点',
        '',
        '内置工具（ctx.tools.* / BF.tools.*）：',
        '  元数据：listBooks / getBook / bookStats / getChapterText',
        '  导入：importFile(file) / batchImport(files)（返回导入时间等元数据）',
        '  中枢控制：settings.set / settings.setMany / keys.set / keys.setMany（kind: ai|mimo）',
        '  书架批量：books.batchTag / books.batchStar / books.batchDelete',
        '  阅读：openBook / gotoChapter / searchInBook',
        '  备份：backupNow / exportBackup',
        '  存储：lsRead / lsWrite(需授权) / lsKeys / assert / bench / runScript',
        '',
        '中枢控制示例：',
        '  ctx.tools.settings.setMany({theme:"dark", fontSize:18})   // 批量改设置（data）',
        '  ctx.tools.keys.set("zhipu", "你的密钥")                    // 写 AI 密钥（full）',
        '  ctx.tools.keys.set("", "你的密钥", "mimo")                 // 写 MiMo 朗读密钥（full）',
        '  ctx.tools.keys.setMany({zhipu:"k1", nvidia:"k2"})          // 批量写多个密钥（full）',
        '  ctx.tools.books.batchTag([id1,id2], "科幻", true)          // 批量打标签（data）',
        '  ctx.tools.books.batchStar([id1], true)                     // 批量收藏（data）',
        '  ctx.tools.books.batchDelete([id1,id2])                     // 批量删除（data，移入回收站，可恢复）',
        '  ctx.tools.batchImport([file1,file2])                       // 批量导入并取时间戳',
        '',
        'AI：ctx.ai.ask("问题") / ctx.ai.hasKey() / ctx.ai.requireKey()',
        '权限：perm（查看）/ perm data（应用数据写）/ perm full（全局+密钥）/ perm read（回只读）· 也可以点右上角权限徽章',
        '手册：ctx.tools.manual() 查看 / ctx.tools.exportManual() 导出 .md',
        '模板：export / theme / search / stats / help / tools',
        '',
        '脚本写法：',
        '  list[str] books = ctx.tools.listBooks();   // 类型声明（可省，等价于 const）',
        '  var int n = 0;                             // 可变',
        '  return books.length;                       // 顶层 return 即输出',
        '',
        '所有写操作统一入口：BF.cap.invoke("cfg.set", ["theme", "dark"])',
      ]).join('\n');
    },
  };
  /* ---- 权限系统 ----
     权限档位用会话级存储（sessionStorage）：手册、提权弹窗、徽章等
     「仅本次会话生效，关闭面板后复位为只读」的承诺，实现必须与文案一致。
     sessionStorage 不可用时退化为进程内替身（生命周期更短，更严格）。
     授权时间戳 LS_GRANT 参与有效期判断：超期自动降回只读。 */
  const DATA_WHITELIST = new Set(['books_meta', 'bookmarks', 'highlights', 'notes', 'vocab', 'read_goal', 'daily', 'last_book', 'settings']);
  const PERM_TTL = 7 * 24 * 3600 * 1000;   /* 授权有效期：超期自动降回只读 */
  function _sGet(k, d) {
    if (BF.store.ssGet) return BF.store.ssGet(k, (BF.store.memGet ? BF.store.memGet(k, d) : d));
    return BF.store.memGet ? BF.store.memGet(k, d) : d;
  }
  function _sSet(k, v) {
    if (BF.store.ssSet) BF.store.ssSet(k, v);
    if (BF.store.memSet) BF.store.memSet(k, v);
  }
  function _permLevel() {
    try {
      var lv = _sGet(LS_PERM, 'read') || 'read';
      if (lv !== 'read') {
        var g = _sGet(LS_GRANT, 0) || 0;
        /* 无时间戳视为不可信 → 降级。
           若写成「有时间戳才检查」，「档位非只读但没有授权时间戳」就会被
           无限期保留 —— 这条路径只在授权写入失败时出现（sessionStorage 满、
           或存储被外部改动），属于异常态，不该当成有效授权长期挂着。
           fail-closed：拿不到证据就当没有授权。 */
        if (!g || Date.now() - g > PERM_TTL) { _sSet(LS_PERM, 'read'); return 'read'; }
      }
      return lv;
    } catch (e) { return 'read'; }
  }
  /* 兼容旧数据：localStorage 的 bf_dsl_perm 是跨会话持久档位的旧存档。
     首次进入时读取并清掉 —— 否则用户会带着上次会话的权限进来，
     与「仅本次会话」的承诺不符。 */
  function _migrateLegacyPerm() {
    try {
      if (!BF.store.lsGet) return;
      var legacy = BF.store.lsGet(LS_PERM, null);
      if (legacy) {
        BF.store.lsRemove(LS_PERM);
        BF.log && BF.log.info('已将 DSL 权限档位从「跨会话持久」迁移为「本次会话有效」：' + legacy);
      }
      /* 遗留授权时间戳同样在 localStorage：档位清掉而时间戳留着，
         会成为一份无主的陈旧元数据（也可能在日后的迁移逻辑里被误读为有效授权）。
         两者成对出现，一并清除。 */
      var legacyGrant = BF.store.lsGet(LS_GRANT, null);
      if (legacyGrant) {
        BF.store.lsRemove(LS_GRANT);
        BF.log && BF.log.info('已清理旧版 DSL 授权时间戳（陈旧授权元数据）');
      }
    } catch (e) { BF.err.report('dsl.legacyGrantCleanup', e); }
  }
  function _grantPerm(level) {
    if (level === 'read') { _sSet(LS_PERM, 'read'); return 'read'; }
    if (level === 'data' || level === 'full' || level === 'secrets') {
      /* 提升权限需用户确认 */
      const ok = BF.ask && BF.ask.confirm ? BF.ask.confirm({
        title: 'DSL 权限提升',
        body: '脚本请求 <b>' + (level === 'data' ? '应用数据写' : level === 'secrets' ? '读取密钥' : '全局写入') + '</b> 权限。<br/>' +
          (level === 'data' ? '可写：书架元数据 / 便签 / 书签 / 划线 / 生词本 / 普通设置项。'
            : level === 'secrets' ? '可读取 AI 密钥明文，并同时包含 full 档的全部写入与不可逆操作权限。请确认你信任当前运行的脚本。'
              : '可写：任意本地存储键 + 全部设置项 + 写入 AI 密钥。') +
          '<br/><span style="color:var(--warning-ink)">仅本次会话生效，关闭页面后复位为只读。</span>',
        confirmText: '授权',
        danger: level === 'data' ? 1 : level === 'secrets' ? 3 : 2,
        force: level === 'data', op: 'dsl.elevate.' + level, facts: {},
      }) : Promise.resolve(false);
      return ok.then(function (yes) { if (yes) { _sSet(LS_PERM, level); _sSet(LS_GRANT, Date.now()); return level; } return _permLevel(); });
    }
    return _permLevel();
  }
  /* 权限校验（纯判定、不写）—— _permWrite 与
     settings 写入路径（TOOLS.settings.set /
     REPL settings 命令）共用。 */
  function _permCan(k) {
    const lv = _permLevel();
    const isData = DATA_WHITELIST.has(k);
    if (lv === 'read') return { ok: false, error: '当前只读权限（perm data 可申请应用数据写）' };
    if (lv === 'data' && !isData) return { ok: false, error: 'data 级仅可写应用白名单键（' + k + ' 不在白名单）' };
    return { ok: true };
  }
  function _permWrite(k, v) {
    /* 整包写入 settings 会绕过 BF.settings.set 的密钥闸门与 SETTING_DENY，
       使 data 档脚本可整包覆写含明文 aiApiKey 的设置 —— 一律禁止，引导走逐项 cfg.set。 */
    if (k === 'settings') return { ok: false, error: '整包写入 settings 已禁用（密钥可被绕过）；请用 cfg.set 逐项设置' };
    const g = _permCan(k);
    if (!g.ok) return g;
    try { BF.store.lsSet(k, v); return { ok: true }; }
    catch (e) { return { ok: false, error: e.message }; }
  }
  /* ---- 密钥操作统一鉴权 ----
     一切触达密钥明文/载体的路径（TOOLS.lsRead / TOOLS.lsKeys /
     TOOLS.settings.get / CONSOLE_BF.settings.get / ctx.lsGet /
     ctx.settings.all）都必须经统一闸门，不得有旁路。闸门与现有
     三档权限叠加：
     - read 档：默认读不到任何密钥明文（直接拒绝，不弹窗）；
     - data 档：首次授权（会话级标记，本会话内不再重复问）；
     - full 档：每次确认（不记忆，逐次弹窗）；
     确认走 BF.ask danger=3 requireY（须回复 y）。
     密钥集合以 BF.store.PRIV_KEYS 为唯一来源；「settings」
     整键是密钥载体（其值含全部密钥明文），read 档枚举
     （lsKeys）同样隐藏密钥载体键名。 */
  const LS_SECRET_OK = 'dsl_secret_ok';   /* data 档首次授权标记（会话级） */
  const SECRET_SETTING_KEYS = new Set(BF.store.PRIV_KEYS);
  /* 显示策略不在 PRIV_KEYS（它本身不是密钥），但脚本能改它就等于能给自己开密钥显示权限 ——
     按密钥级设置对待：读写都过 _secretGate。 */
  SECRET_SETTING_KEYS.add('keyReveal');
  const SECRET_LS_KEYS = new Set(BF.store.PRIV_KEYS);
  SECRET_LS_KEYS.add(BF.store.K.SETTINGS);
  /* 终端留痕也是密钥载体（闸门放行后的明文回显会落进这一份缓冲），
     与 SETTINGS 同档处理：read 档不枚举、ls 读它同样要过闸门。 */
  SECRET_LS_KEYS.add(BF.store.K.DSL_LOG);
  function _isSecretSettingKey(k) { return SECRET_SETTING_KEYS.has(k); }
  function _isSecretLSKey(k) { return SECRET_LS_KEYS.has(k); }
  function _secretGranted() { try { return _sGet(LS_SECRET_OK, false); } catch (e) { return false; } }
  async function _secretGate(label) {
    var lv = _permLevel();
    if (lv === 'read') return false;
    if (lv === 'data' && _secretGranted()) return true;
    var ok = false;
    try {
      ok = await BF.ask.confirm({
        title: '密钥访问确认',
        body: '脚本请求' + (label || '读写') + '密钥明文（AI 服务凭证 / PIN 哈希等敏感设置）。',
        danger: 3,
        requireY: true,
        op: 'secret-access',
        facts: { 操作: label || '密钥读写' }
      });
    } catch (e) { ok = false; }
    if (ok && lv === 'data') { try { _sSet(LS_SECRET_OK, true); } catch (e) {} }
    return ok;
  }
  /* 未授权同步快照口只回剥掉密钥的浅拷贝（read 档默认态） */
  function _stripSecretSettings(src) {
    const out = {};
    for (const k in (src || {})) {
      if (_isSecretSettingKey(k)) continue;
      out[k] = src[k];
    }
    return BF.store.stripPresetSecrets(out);
  }
  /* ---- 脚本库 ---- */
  function _load() {
    try {
      const arr = BF.store ? BF.store.lsGet(LS_SCRIPTS, null) : null;
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) { BF.err.report('dsl.load', e); }
    try { if (BF.store) BF.store.lsSet(LS_SCRIPTS, DEFAULT_SCRIPTS); } catch (e) { BF.err.report('dsl.scriptsInit', e); }
    return DEFAULT_SCRIPTS.slice();
  }
  function _save(arr) {
    try { if (BF.store) BF.store.lsSet(LS_SCRIPTS, arr); } catch (e) { BF.err.report('dsl.save', e); }
  }
  function listScripts() { return _load(); }
  function getScript(id) { return _load().find(function (x) { return x && x.id === id; }) || null; }
  function saveScript(script) {
    const arr = _load();
    const i = arr.findIndex(function (x) { return x && x.id === script.id; });
    if (i >= 0) arr[i] = script; else arr.push(script);
    _save(arr);
    return script;
  }
  function removeScript(id) {
    const arr = _load().filter(function (x) { return !(x && x.id === id); });
    _save(arr);
    return arr;
  }
  function runScript(id, args) {
    const sc = getScript(id);
    if (!sc) { BF.noti && BF.noti.warn('脚本不存在：' + id); return null; }
    return execute(sc.code, { name: sc.name, args: args || {}, script: true });
  }
  function syncCommands() {
    if (!BF.commands) return;
    const existing = BF.commands.list ? BF.commands.list() : [];
    for (const sc of _load()) {
      if (!sc || !sc.active) continue;
      const cid = 'dsl:run:' + sc.id;
      if (!existing.some(function (x) { return x && x.id === cid; })) {
        BF.commands.register({ id: cid, label: 'DSL·' + (sc.name || sc.id), keywords: 'dsl script 脚本 ' + (sc.name || ''), cat: 'DSL', run: function () { return BF.dsl.runScript(sc.id); } });
      }
    }
  }
  /* ---- 控制台注入对象（CONSOLE_BF）----
     名字不暗示隔离：「SAFE_BF」式的 SAFE 是虚假的安全叙事——执行体是
     new Function，裸 localStorage 直接可达，本对象只靠权限档位、
     hub 调度与 _secretGate 统一把关，不存在隔离边界。
     写操作一律经 BF.hub 调度，不留直写/直调通道——
     那正是 read 档改设置、写删便签、删书、跑 data.reset 的破口。 */
  const CONSOLE_BF = {
    version: BF.version,
    /* 能力调用：脚本写操作的唯一入口，权限在 hub 内统一判定 */
    cap: {
      invoke: function (id, args) { return BF.hub.invoke(id, args); },
      list: function () { return BF.hub.describe(); }
    },
    store: {
      /* 密钥读统一经 _secretGate —— 密钥键（含密钥载体
         「settings」整键）返回 Promise（脚本 await 取明文），
         未批准（含 read 档）回默认值，与「键不存在」不可区分；
         普通键保持同步契约。 */
      lsGet: function (k, d) {
        if (_isSecretLSKey(k)) {
          return _secretGate('ctx.lsGet("' + k + '")').then(function (ok) {
            return ok ? BF.store.lsGet(k, d) : d;
          });
        }
        return BF.store.lsGet(k, d);
      },
      /* 密钥枚举受统一鉴权约束 —— read 档隐藏密钥载体键名 */
      lsKeys: function () {
        try {
          const all = BF.store.lsKeys ? BF.store.lsKeys() : [];
          if (_permLevel() === 'read') {
            return all.filter(function (k) { return !_isSecretLSKey(k); });
          }
          return all;
        } catch (e) { return []; }
      },
      /* 写存储一律走 hub 的配置能力，不得直接 _permWrite */
      lsSet: function (k, v) { return { ok: false, error: '直接写 localStorage 已收编，请使用 BF.cap.invoke("cfg.set", [key, value])' }; },
      K: BF.store.K,
    },
    settings: {
      /* 密钥明文读取统一经 _secretGate（BF.ask danger=3
         需回复 y），密钥集合以 PRIV_KEYS 全集为准——静态短清单
         必然与真源漂移（漏 aiEndpoint/aiModel 这类键）。
         批准 → 明文；未批准（含 read 档）→ 拒绝应答。 */
      get: function (k) {
        /* aiPresets 是 settings 里唯一可以嵌密钥的键（保存预设时能勾「含密钥」）。
           它本身不在 PRIV_KEYS 全集中 —— 按普通键直读就等于给 data 档脚本开了一条
           绕过 secrets 档的后门，所以按「密钥载体」处理：只有当某个预设真的带密钥时
           才走同一道 _secretGate；没带密钥时保持同步返回，不把普通读改成 Promise。 */
        if (k === 'aiPresets') {
          const pv = BF.settings.getCopy(k) || {};
          let hasKey = false;
          try { hasKey = Object.keys(pv).some(function (n) { return pv[n] && typeof pv[n] === 'object' && 'aiApiKey' in pv[n]; }); } catch (e) { hasKey = true; }
          if (!hasKey) return pv;
          return _secretGate('ctx.settings.get("aiPresets")（预设内含密钥）').then(function (ok) {
            if (!ok) return BF.store.stripPresetSecrets({ aiPresets: JSON.parse(JSON.stringify(pv)) }).aiPresets;
            return pv;
          });
        }
        if (_isSecretSettingKey(k)) {
          return _secretGate('ctx.settings.get("' + k + '")').then(function (ok) {
            if (!ok) return { ok: false, error: '密钥访问被拒绝（需回复 y 确认）' };
            const v = BF.settings.get(k);
            return v === undefined ? '' : v;
          });
        }
        return BF.settings.getCopy(k);
      },
      /* 全量快照含全部密钥明文，统一经鉴权 —— 返回
         Promise：批准 → 全量；未批准（含 read 档）→ 剥密钥快照 */
      all: function () {
        return _secretGate('ctx.settings.all()').then(function (ok) {
          const s = BF.settings.all ? BF.settings.all() : {};
          if (ok) return JSON.parse(JSON.stringify(s));
          return _stripSecretSettings(s);
        });
      },
      set: function (k, v) { return BF.hub.invoke('cfg.set', [k, v]); },
      /* 敏感设置明文读取（cap: secrets:read + A1 统一鉴权，权限在 hub 统一判定） */
      secret: function (k) { return BF.hub.invoke('cfg.secret', [k]); }
    },
    app: { go: function (p) { return BF.app.go(p); }, openBook: function (id) { return BF.app.openBook(id); }, applyReaderStyles: function () { return BF.app.applyReaderStyles(); } },
    reader: {
      gotoChapter: function (i) { return BF.hub.invoke('rd.chapter', [i]); },
      nextChapter: function () { return BF.reader.nextChapter ? BF.reader.nextChapter() : null; },
      prevChapter: function () { return BF.reader.prevChapter ? BF.reader.prevChapter() : null; },
      searchAll: function (q) { return BF.reader.searchAll(q); },
      /* 只暴露轻量阅读状态：mode / 页码 / 章节计数 / 当前章，不深拷 paras 与 book */
      state: function () {
        try {
          const st = BF.reader.state || {};
          const bid = BF.appState && BF.appState.currentBookId;
          const cur = (typeof BF.appState.currentChapterIdx === 'number') ? BF.appState.currentChapterIdx : (st.book && typeof st.book.currentChapter === 'number' ? st.book.currentChapter : 0);
          return {
            mode: st.mode || 'scroll',
            pkPageIdx: typeof st.pkPageIdx === 'number' ? st.pkPageIdx : 0,
            currentChapter: cur,
            title: st.book && st.book.title ? st.book.title : '',
            chapterCount: st.book && typeof st.book.totalChapters === 'number' ? st.book.totalChapters : 0,
            bookId: bid || '',
          };
        } catch (e) { return { mode: 'scroll', pkPageIdx: 0, currentChapter: 0, title: '', chapterCount: 0, bookId: '' }; }
      },
    },
    tts: {
      start: function () { return BF.tts.start ? BF.tts.start() : null; },
      stop: function () { return BF.tts.stop ? BF.tts.stop() : null; },
      pause: function () { return BF.tts.pause ? BF.tts.pause() : null; },
      resume: function () { return BF.tts.resume ? BF.tts.resume() : null; },
      canUse: function () { try { return !!BF.tts.edge && BF.tts.edge.canUse ? BF.tts.edge.canUse() : false; } catch (e) { return false; } },
    },
    ai: {
      ask: function (prompt, bookId) { return _dslAsk(prompt, bookId); },
      hasKey: function () { return BF.ai.hasKey(); },
      requireKey: function (where, o) { return BF.ai.requireKey(where, o); },
      providers: function () { return BF.ai.PROVIDERS.map(function (p) { return { id: p.id, name: p.name, rec: p.rec, note: p.note }; }); },
    },
    noti: {
      success: function (m) { return BF.noti.success(m); },
      warn: function (m) { return BF.noti.warn(m); },
      error: function (m) { return BF.noti.error ? BF.noti.error(m) : BF.noti.warn(m); },
    },
    state: { get: function () { return JSON.parse(JSON.stringify(BF.state.get ? BF.state.get() : {})); }, set: function () { return { ok: false, error: '控制台不允许改全局状态' }; } },
    /* 命令总线改走 hub：直连 BF.commands.run 没有鉴权（read 档就能跑 data.reset） */
    commands: {
      run: function (id) {
        if (BF.hub && BF.hub.has(id)) return BF.hub.invoke(id);
        /* 未收编进中枢的历史命令：按命令 id 前缀匹配能力，未匹配即拒绝——
           无条件转发是权限系统的缺口。前缀→能力表委托 hub.capForId 唯一实现：
           此处另养一份内联表必然与 CAP_RULES 漂移（漏规则、错映射）；
           capForId 查不到（未归类）才拒绝。 */
        var cap = null;
        try { cap = BF.hub.capForId ? BF.hub.capForId(id) : null; } catch (e) {}
        if (!cap) return { ok: false, error: '命令「' + id + '」尚未登记，按默认拒绝处理' };
        /* 「已授权」必须用 _capAllowed 实判：_resolveCap(cap) !== null 只解析
           能力名是否登记，与当前权限档位无关，等于全放行
           （read 档也能跑 settings:write / cmd:write）。
           档位不够即拒，文案带上当前档位与调整入口。 */
        var granted = false;
        try { granted = BF.hub._capAllowed(cap); } catch (e) {}
        if (!granted) return {
          ok: false,
          error: '命令「' + id + '」需要 ' + cap + ' 授权（当前权限：' + ((BF.dsl && BF.dsl.permLevel) ? BF.dsl.permLevel() : 'read') + '，perm 调整）'
        };
        var r = BF.commands.run(id);
        return (r === false) ? { ok: false, error: '命令执行失败：' + id } : { ok: true };
      },
      list: function () { return BF.commands.list(); }
    },
    /* 外观只有一条正道：cfg.setTheme（不带名循环 / 带名指定），合法与否由登记表裁决并负责重染。
       不能用 cfg.set(['theme', t])：'theme' 不是设置键（外观已合并为单个 appearance），
       写进去没人读、也不重染，脚本以为换了其实没换。 */
    theme: {
      cycle: function () { return BF.hub.invoke('cfg.setTheme'); },
      set: function (t) { return BF.hub.invoke('cfg.setTheme', [t]); },
      name: function () { return BF.skin.get(); },
      effective: function () { return BF.theme.effective(); },
      axis: function () { return BF.skin.axis(); },
    },
    skin: {
      get: function () { return BF.skin.get(); },
      label: function (k) { return BF.skin.label(k); },
      axis: function () { return BF.skin.axis(); },
      isPalette: function (k) { return BF.skin.isPalette(k === undefined ? BF.skin.get() : k); },
      opts: function () { return BF.skin.opts(); },
      set: function (t) { return BF.hub.invoke('cfg.setTheme', [t]); },
      cycle: function () { return BF.hub.invoke('cfg.setTheme'); },
    },
    help: { open: function () { return BF.help.open(); } },
    statsPanel: { open: function () { return BF.statsPanel.open(); } },
    notes: {
      all: function () { return JSON.parse(JSON.stringify(BF.notes.all())); },
      filtered: function () { return JSON.parse(JSON.stringify(BF.notes.filtered())); },
      allTags: function () { return JSON.parse(JSON.stringify(BF.notes.allTags())); },
      create: function (bookId) { return JSON.parse(JSON.stringify(BF.notes.create(bookId))); },
      /* 写与删改走 hub：直调 BF.notes.update/remove 的话 read 档即可删便签 */
      update: function (id, patch) { return BF.hub.invoke('notes.update', [id, patch || {}]); },
      remove: function (id) { return BF.hub.invoke('notes.remove', [id]); },
      open: function () { return BF.notes.open(); },
    },
    diag: {
      trace: function () { return BF.trace ? BF.trace.list() : []; },
      traceTotal: function () { return BF.trace ? BF.trace.total() : 0; },
      caps: function () { return BF.caps ? BF.caps.summary() : null; },
      jobs: function () { return BF.jobs ? BF.jobs.list() : []; },
    },
    bk: { exportFull: function () { return BF.bk.exportWithAsk(); }, exportFullRaw: function () { return BF.bk.exportFull(); } },
    err: { report: function (c, e) { return BF.err.report(c, e); }, recent: function (n) { return BF.err.recent(n); } },
    ui: { toast: function (m) { return BF.noti.success(m); } },
    /* 内置工具集（受控只读为主，写操作走 _permWrite 授权） */
    tools: TOOLS,
    perm: { level: _permLevel, grant: _grantPerm },
  };
  /* 受控 AI 问书：转发真实问书入口（BF.ai.ask/chat 并不存在，一律走 runCard） */
  function _dslAsk(prompt, bookId) {
    if (!BF.ai || !BF.ai.runCard) return Promise.resolve('AI 功能未就绪');
    /* requireKey 只调一次：它内部会弹「去填密钥 / 复制提示词」，
       写成 `requireKey().then ? requireKey() : …` 会把同一次引导并排触发两次。 */
    if (!BF.ai.hasKey()) {
      const _rk = BF.ai.requireKey('DSL 问书');
      return (_rk && typeof _rk.then === 'function') ? _rk : Promise.resolve('未配置 AI 密钥');
    }
    return BF.ai.runCard('ask', { question: String(prompt || ''), bookId: bookId || BF.appState.currentBookId }).then(function (content) {
      return content == null ? '未配置 AI 密钥（已复制提示词）' : content;
    });
  }
  /* ctx 保留给旧脚本（ctx.toast / ctx.prompt / ctx.go / ctx.lsGet 等），全部指向受限能力 */
  /* buildContext(meta) 支持 meta.print 输出汇：脚本用 ctx.log(...)
     打印到 DSL 终端输出流；无 print 汇时（如面板外直跑）降级为通知。 */
  /* 脚本体末值 = REPL 惯例：多语句脚本的最后一条裸表达式包成 return，
     否则脚本体末条表达式恒得 undefined。
     盲包「末行」会把 `print('hi'); const a=1; const b=2; a+b;` 包成
     SyntaxError——比不包时那个 undefined 更糟，故设三道保险：
     ① 先把注释与字符串抹白（串内 ; } 不当边界，长度逐字对齐）；
     ② 候选语句必须能被 new Function 当独立表达式解析通过；
     ③ 脚本以 } 收尾、或末条本就是 return/throw/声明，一律原样放行。
     任何一道不过就返回原 body——最坏只是「仍然 undefined」，绝不把能跑的脚本改坏。 */
  function _dslBlankNonCode(src) {
    let out = '', i = 0;
    while (i < src.length) {
      const c = src[i], d = src[i + 1];
      if (c === '/' && d === '/') { while (i < src.length && src[i] !== '\n') { out += ' '; i++; } continue; }
      if (c === '/' && d === '*') { out += '  '; i += 2; while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { out += (src[i] === '\n' ? '\n' : ' '); i++; } if (i < src.length) { out += '  '; i += 2; } continue; }
      if (c === '"' || c === "'" || c === '`') { const q = c; out += ' '; i++; while (i < src.length && src[i] !== q) { if (src[i] === '\\') { out += ' '; i++; } out += (src[i] === '\n' ? '\n' : ' '); i++; } if (i < src.length) { out += ' '; i++; } continue; }
      out += c; i++;
    }
    return out;
  }
  function _wrapScriptReturn(body) {
    try {
      if (!body || !body.trim()) return body;
      const masked = _dslBlankNonCode(body);
      let end = masked.length;
      while (end > 0 && /[\s;]/.test(masked[end - 1])) end--;
      if (end === 0) return body;
      if (masked[end - 1] === '}') return body;
      const head = masked.slice(0, end);
      let start = head.length;
      while (start > 0 && head[start - 1] !== ';') start--;
      const cand = body.slice(start, end);
      const candMasked = head.slice(start);
      if (!candMasked.trim()) return body;
      if (/^(?:return|throw|const|let|var|if|for|while|switch|do|try|catch|finally|function|class|import|export)\b/.test(candMasked.trim())) return body;
      try { new Function('"use strict";return (' + cand + ');'); } catch (e) { return body; }
      return body.slice(0, start) + 'return (' + cand + ');' + body.slice(end);
    } catch (e) { return body; }
  }
  function buildContext(meta) {
    const _sink = (meta && typeof meta.print === 'function') ? meta.print : null;
    function _log() {
      const parts = Array.prototype.map.call(arguments, function (v) {
        if (v === undefined) return 'undefined';
        if (v === null) return 'null';
        if (typeof v === 'object') { try { return JSON.stringify(v); } catch (e) { return String(v); } }
        return String(v);
      });
      const msg = parts.join(' ');
      if (_sink) { try { _sink(msg); } catch (e) {} }
      else if (BF.noti && BF.noti.info) BF.noti.info(msg);
    }
    return {
      store: CONSOLE_BF.store,
      settings: CONSOLE_BF.settings,
      app: CONSOLE_BF.app,
      reader: CONSOLE_BF.reader,
      tts: CONSOLE_BF.tts,
      ai: CONSOLE_BF.ai,
      noti: CONSOLE_BF.noti,
      state: CONSOLE_BF.state,
      commands: CONSOLE_BF.commands,
      tools: TOOLS,
      perm: CONSOLE_BF.perm,
      lsGet: CONSOLE_BF.store.lsGet,
      go: CONSOLE_BF.app.go,
      toast: CONSOLE_BF.noti.success,
      log: _log,
      print: _log,
      prompt: function (label, def) { return BF.modal && BF.modal.prompt ? BF.modal.prompt(label || '输入', def || '') : Promise.resolve(def || ''); },
      confirm: function (msg) {
        /* 字符串入参时 Object.assign({}, '要删吗') 会把字符拆成数字键，正文恒为空。 */
        if (!msg || typeof msg !== 'object') msg = { body: String(msg == null ? '' : msg) };
        return BF.ask && BF.ask.confirm ? BF.ask.confirm(Object.assign({}, msg, { force: true })) : Promise.resolve(false);
      },
      ask: CONSOLE_BF.ai.ask,
      /* ctx.tools 已由上面那一项挂好，这里不再重复写一遍同名键 */
    };
  }
  /* 脚本静态校验（终端定位 · 论证见模块头）。
     DSL 执行用户本人的 JS、权限等同控制台 —— 黑名单在这里只做一件事：
     **read 档拦网络原语**（fetch / XMLHttpRequest / import() / eval），
     默认档「防误」：不明来历的脚本被粘进来，至少不能无声无息把数据
     发出去。data/full/secrets 档放行 —— 那已是用户明确授权过的操作面，
     与在 DevTools 里敲 fetch 同权。
     明示「防误不防敌」：字符串拼接（"ev"+"al"）、注释切割等手段本就
     拦不住，也不打算拦 —— 拦了也只是虚假的安全感。read 档的第二道闸
     在 execute 的参数遮蔽（fetch/XMLHttpRequest 换抛错替身）；
     eval/import 是保留字/动态语法，不能作参数名，只有静态这一道。
     不做「全局对象钥匙」类拦截（constructor / globalThis / window /
     Function）：终端里它们本就该可用，拦它们既不安全（绕得过）又破坏
     合法用法，只是虚假保障；密钥的真闸门是 _secretGate
     （按档位 + 逐次确认），不靠匹配调用形态。 */
  const _DSL_FORBID = [
    /\bfetch\s*\(/,
    /\bXMLHttpRequest\b/,
    /\bimport\s*\(/,
    /\beval\s*\(/,
    /* 不经过 fetch 的出站通道：图片/脚本/iframe 的 src、Beacon、WebSocket、EventSource、
       顶层跳转。档位语义是「read 拦网络原语」，只拦 fetch/XHR 等于这一条只对老实写法生效。
       这是提高门槛，不是封死：脚本仍可换写法绕过，所以文案一律说「静态检查」，不说「禁止联网」。 */
    /\bnew\s+Image\s*\(/,
    /\bsendBeacon\s*\(/,
    /\bnew\s+WebSocket\s*\(/,
    /\bEventSource\s*\(/,
    /\bcreateElement\s*\(\s*['"](?:script|iframe|object|embed|img|audio|video|source|link|form)['"]/i,
    /* 上面这条只点名会带出站地址的标签：div/span 这类照常建，脚本写界面不受影响。
       这几样是点名的其余出口：innerHTML 系列能把字符串拼成可执行标签、
       srcdoc 给 iframe 造一个同源文档、document.write 直接改文档、
       Worker/importScripts 换一个没有档位概念的执行体。 */
    /\binsertAdjacentHTML\s*\(/,
    /\bsrcdoc\s*=/,
    /\bdocument\s*\.\s*write(?:ln)?\s*\(/,
    /\bnew\s+Worker\s*\(/,
    /\bimportScripts\s*\(/,
    /\blocation\s*\.\s*(?:href|assign|replace)\s*=/,
    /\bwindow\s*\.\s*open\s*\(/,
    /* 动态求值的另外两条后门：名单里原本只有 eval( ，而 (0,eval)('…') 拿到的
       就是原生 eval、Function('…')() 同样能把字符串跑成代码——
       拦下写法不等于拦下能力，这两条把最常见的两种写法一起堵上。
       （把名字拆成字符串再拼仍绕得过，这是提高门槛；界面文案只说「静态检查」。） */
    /\(\s*0\s*,\s*eval\s*\)/,
    /\bFunction\s*\(/,
    /* 同一类出口的第二梯队：Audio 构造器能直接发请求，RTCPeerConnection /
       WebTransport 是另一套出站栈，ServiceWorker 注册能把控制权留到下次打开。
       createElement('audio') 已被上面那条标签名单挡住，但 new Audio() 不走
       createElement，所以单列。与 new Image() 同一取舍：读不出参数是远端还是
       blob:，本地音频也会被拦 —— 要放行为自己脚本的用户请升 data/full 档。 */
    /\bnew\s+Audio\s*\(/,
    /\bnew\s+RTCPeerConnection\s*\(/,
    /\bWebTransport\b/,
    /\bserviceWorker\b/,
  ];
  /* 命中理由要说人话：正则源码给用户看等于没看。 */
  const _DSL_FORBID_WHY = {
    '\\bfetch\\s*\\(': 'fetch 请求',
    '\\bXMLHttpRequest\\b': 'XMLHttpRequest',
    '\\bimport\\s*\\(': '动态 import',
    '\\beval\\s*\\(': 'eval',
    '\\bnew\\s+Image\\s*\\(': '图片地址外发（new Image().src）',
    '\\bsendBeacon\\s*\\(': 'sendBeacon 送信',
    '\\bnew\\s+WebSocket\\s*\\(': 'WebSocket 连接',
    '\\bEventSource\\s*\\(': 'EventSource 长连接',
    '\\bcreateElement\\s*\\(\\s*[\'\"](?:script|iframe|object|embed|img|audio|video|source|link|form)[\'\"]': '动态插入能带出站地址的标签（script/iframe/img…）',
    '\\binsertAdjacentHTML\\s*\\(': 'insertAdjacentHTML 插入 HTML',
    '\\bsrcdoc\\s*=': 'iframe 的 srcdoc',
    '\\bdocument\\s*\\.\\s*write(?:ln)?\\s*\\(': 'document.write 改写页面',
    '\\bnew\\s+Worker\\s*\\(': '新建 Worker（不受本档位约束）',
    '\\bimportScripts\\s*\\(': 'Worker 内引入外部脚本',
    '\\blocation\\s*\\.\\s*(?:href|assign|replace)\\s*=': '整页跳转到外部地址',
    '\\bwindow\\s*\\.\\s*open\\s*\\(': '打开新窗口',
    '\\(\\s*0\\s*,\\s*eval\\s*\\)': '(0, eval) 取回原生 eval',
    '\\bFunction\\s*\\(': 'Function 构造器动态求值',
    '\\bnew\\s+Audio\\s*\\(': '音频地址外发（new Audio().src）',
    '\\bnew\\s+RTCPeerConnection\\s*\\(': 'RTCPeerConnection 出站通道',
    '\\bWebTransport\\b': 'WebTransport 出站通道',
    '\\bserviceWorker\\b': 'ServiceWorker 注册（留驻到下次打开）',
  };
  /* 同步死循环变体（与 execute 内预检共用）：while(true)/while(1)/while(!0)/for(;;)/for(;1;)
     全档位拦截 —— 与权限无关：同步死循环冻死整个页面，包括用来取消它的 UI，
     超时回调（Promise.race）也永远得不到执行机会。 */
  const _LOOP_RE = /(while\s*\(\s*(?:true|1|!0|\d+)\s*\)|for\s*\(\s*;\s*(?:1|true|!0|\d+)?\s*;\s*\))/;
  /* tier 不传按 read 算（保守）：不知道当前档位的调用方（如导入预检的
     默认路径）不会因为漏传而静默放行网络原语。 */
  function _dslStaticCheck(code, tier, probe) {
    let src = String(code || '');
    /* 剥掉「独立成行 / 成块」的注释后再扫 —— 注释里
       提到 fetch/eval 不该触发拦截。（\b 词边界本就拦不到 fetchSome
       这类词内子串。）只剥行首注释与块注释，不动行尾 // 与字符串内的
       ://，避免被字符串里的 :// 误剥而漏拦。
       剥完用等长空白回填（长度与换行数都不变）：probe 要拿命中的字符
       下标反推「第几行」，块注释若塌成一个空格，行号就整体前移了。 */
    /* 串与注释一并抹白（_dslBlankNonCode 已在上面定义：长度与换行数逐字对齐，
       行号仍准）：while(true) / for(;;) 出现在字符串或注释里不误判死循环，
       字符串里含 fetch/eval 也不误报联网原语。 */
    src = _dslBlankNonCode(src);
    const hits = [];
    if (probe) { probe.net = -1; probe.loop = -1; }
    if ((tier || 'read') === 'read') {
      for (const re of _DSL_FORBID) {
        /* exec 而不是 test：只有它能带回落点（这几个正则无 g 标志，
           exec 不残留 lastIndex，可以安全复用同一个 re 对象）。 */
        const m = re.exec(src);
        if (!m) continue;
        hits.push(_DSL_FORBID_WHY[re.source] || re.source);
        if (probe && (probe.net < 0 || m.index < probe.net)) probe.net = m.index;
      }
    }
    const lm = _LOOP_RE.exec(src);
    if (lm) {
      hits.push('同步死循环');
      if (probe) probe.loop = lm.index;
    }
    return hits;
  }
  function _validateScript(code, tier) {
    const probe = {};
    const hits = _dslStaticCheck(code, tier, probe);
    if (!hits.length) return { ok: true, hits: [] };
    /* 行号只在真的拿得到落点时才附上（拿不到就不加这个字段，
       状态条那边就不会渲染成能点的按钮）。 */
    const _lineOf = function (i) {
      return (typeof i === 'number' && i >= 0) ? String(code || '').slice(0, i).split('\n').length : 0;
    };
    /* 死循环全档位拦，文案与权限档位无关；网络原语只在 read 档被拦，
       文案写明授权出口，别让人以为脚本本身有问题。 */
    if (hits.indexOf('同步死循环') >= 0) {
      const ln = _lineOf(probe.loop);
      const r = { ok: false, hits: hits, msg: '脚本包含同步死循环（while(true)/for(;;) 等），会冻死整个页面（已阻止导入）' };
      if (ln) r.line = ln;
      return r;
    }
    const ln2 = _lineOf(probe.net);
    const r2 = { ok: false, hits: hits, msg: '只读档脚本包含联网/动态求值调用：' + hits.join('、') + '（data 及以上权限放行，perm data 授权后可导入）' };
    if (ln2) r2.line = ln2;
    return r2;
  }
  /* read 档网络原语替身 / data+ 档真身（execute 参数遮蔽用，见 execute 内注释）。
     替身抛错而非静默 undefined：让「被绕过的静态拦截」在调用点炸出声，
     而不是诡异地黄掉；真身 bind(globalThis) —— 浏览器里裸 fetch 引用
     直接调用会 Illegal invocation，必须绑接收者。 */
  function _netShadow(tier) {
    if (tier === 'read') {
      const deny = function (n) {
        return function () { throw new Error(n + ' 在只读档不可用：联网与动态求值需 data 及以上权限（点终端右上角的权限徽章提权，或直接输入 perm data，确认后重试即可）'); };
      };
      /* 裸 localStorage 在只读档下不是「整体禁掉」而是「挡住密钥键」：
         闸门本来只装在 BF.store.lsGet / 中枢通道上，脚本写一句
         localStorage.getItem('bf_settings') 就把同一份数据从旁边拿走了——
         AI 密钥与 PIN 盐就住在那条键里。判据复用 _isSecretLSKey（同一份名单），
         其余键照常透传，只读档读普通数据的能力不变。
         这是提高门槛，不是封死：把键名拆成两段字符串拼接仍然绕得过，
         所以界面文案只说「拦网络原语 + 密钥键」，不说「已隔离数据」。 */
      const real = (typeof localStorage !== 'undefined') ? localStorage : null;
      /* 名单里记的是裸键名（'settings'、'dsl_log'、PRIV_KEYS），而裸 localStorage
         上的真名带着 bf_ 前缀。不先剥前缀就比对，等于闸门形同不存在——
         脚本读 'bf_settings' 会一路放行到密钥明文。 */
      const _bare = function (k) {
        const s = String(k == null ? '' : k);
        const pfx = BF.store.PREFIX || '';
        return pfx && s.indexOf(pfx) === 0 ? s.slice(pfx.length) : s;
      };
      const blocked = function (k) {
        const s = String(k == null ? '' : k);
        try { return _isSecretLSKey(_bare(k)) || _isSecretLSKey(s); } catch (e) { return true; }
      };
      const _lsRead = function (k) {
        /* 报错要给一条能照抄的替代写法，只说「走受控通道」等于让人自己去翻源码。
           指针必须是真的：能力表里只有 cfg.set / cfg.setMany / cfg.secret 这些 id，
           读存储的受控入口是 tools.lsRead（脚本里裸名 lsRead，终端里 BF.tools.lsRead）。 */
        if (blocked(k)) throw new Error('只读档不能直读这条键（它装着密钥）：脚本里改走 lsRead("' + _bare(k) + '")，终端里改走 BF.tools.lsRead("' + _bare(k) + '")——需 data 及以上权限并弹确认，未批准只回 null');
        return real ? real.getItem(k) : null;
      };
      /* 拒写不只是密钥问题：裸写绕过全库最低写入漏斗，写修订计数不 bump、
         IDB 镜像不同步、缓存不作废——下一次读拿到的还是旧对象。替代写法照抄可用。 */
      const denyWrite = function (k) { throw new Error('只读档不能直写 localStorage：这样写绕过写入漏斗（修订计数与镜像都会失同步）。改设置用 BF.cap.invoke("cfg.set", [key, value])，写整条键用 BF.tools.lsWrite(key, value)——两者都要 data 及以上权限'); };
      return {
        fetch: deny('fetch'), XMLHttpRequest: deny('XMLHttpRequest'),
        localStorage: {
          getItem: _lsRead, setItem: denyWrite, removeItem: denyWrite, clear: denyWrite,
          /* 键名枚举在只读档与 lsKeys 同一口径：装着密钥的键名不报出去。
             返回 null 而不是跳过，下标不缩——否则第 i 个键会指到别的键上。 */
          key: function (i) { const n = real ? real.key(i) : null; return (n && blocked(n)) ? null : n; },
          length: real ? real.length : 0
        }
      };
    }
    const g = (typeof globalThis !== 'undefined') ? globalThis : null;
    return {
      fetch: (typeof fetch === 'function' && g) ? fetch.bind(g) : null,
      XMLHttpRequest: (typeof XMLHttpRequest === 'function') ? XMLHttpRequest : null,
      localStorage: (typeof localStorage !== 'undefined') ? localStorage : null
    };
  }
  /* ---- 终端文案（en / zh）：单一来源，dslUI 也读这张表 ----
     只管「终端自己说的话」：外壳、回执、提示符、状态栏、会话提示与错误。
     命令实现里的输出与 help 手册文本不随语言切换（那是命令的内容面）。
     设置项 dslLang 默认 en；缺键回退 en，缺值回退键名。 */
  const L10N = {
    en: {
      title: 'DSL Terminal', modeTerminal: 'Terminal', modeEditor: 'Editor',
      btnManual: 'Manual', btnRun: 'Run', btnRunning: '⏳ running…', btnSave: 'Save',
      btnManualTip: 'export the DSL manual (.md)', btnRunTip: 'run the script in the editor',
      btnSaveTip: 'save current script', closeAria: 'close',
      phScriptName: 'script name',
      replAria: 'DSL command line',
      phCode: '// script here — Ctrl+Enter to run; ctx.log(...) prints below',
      phChat: 'type a message · Enter to send · Esc to exit',
      banner: 'Northwind DSL [{ver}]\nRuns with your own privileges — same as browser DevTools. Type help.',
      selfXss: 'never paste a script you don\'t understand. Code here runs with your own privileges (it can read and write your data and keys). Only run code you wrote or trust.',
      selfXssLead: 'Warning:',
      selfXssOk: 'Got it',
      permRead: 'READ', permData: 'DATA', permSecrets: 'SECRETS', permFull: 'FULL',
      permAria: 'permission level: {lv}',
      permTipRead: 'read-only: scripts can read data, navigate, notify, switch theme; writes need elevation. Network patterns (fetch, image src, sendBeacon, WebSocket, page jumps) are blocked by static check — a speed bump, not a sandbox. Click to elevate (one confirm, this page session only).',
      permTipData: 'data: shelf metadata / notes / bookmarks / highlights / vocab / normal settings. This page session only; perm read resets.',
      permTipSecrets: 'secrets: read API keys in plaintext (separate grant). This page session only; perm read resets.',
      permTipFull: 'full: any local key + all settings + write keys. This page session only; perm read resets.',
      aiOff: 'AI off', aiReady: 'AI · {prov}', aiChat: 'chat {n}t', aiAgent: 'agent {n}t',
      aiReadyWord: 'ready',
      aiTipOff: 'No API key — ask / chat / agent are skipped. Click to open Settings → AI.',
      aiTipChat: 'Chat session (multi-turn). Click to exit.',
      aiTipAgent: 'Agent session (multi-turn, tools enabled). Click to exit.',
      aiTipReady: 'Key configured. Click for chat mode, or type ask <question> for one turn.',
      statusPos: 'ln {ln}, col {col}', statusSize: '{lines} lines · {chars} chars', statusOk: '✓ ok',
      promptChat: 'chat>', promptAgent: 'agent>',
      pathHome: 'home', pathShelf: 'shelf', pathConfig: 'config', pathFind: 'find', pathStats: 'stats',
      pathNotes: 'notes', pathMe: 'me', pathRead: 'read', pathQj: 'qujing',
      bookFallback: 'book', bookDir: 'C:\\beifeng\\{title}\\{ch}>', chapterSeg: 'ch{n}',
      outManual: 'manual exported: {name} ({chars} chars)',
      outLoaded: 'loaded: {name}{inactive}', outInactive: ' (inactive)',
      outRunSel: 'run selection ({n} lines)', outRun: 'run: {name}',
      outDone: 'done ({ms}ms) · undefined',
      errPrefix: 'error: ', youPrefix: 'you › ',
      outMoved: ' … (moved to editor)',
      outChatClosed: '(chat closed)', outAgentClosed: '(agent closed)',
      outPosReset: 'terminal position was off-screen; centered',
      keyMissing: 'no API key — Settings → AI service.',
      emptyPrompt: 'empty prompt.',
      agentLive: 'agent running… (may call local tools)',
      noAnswer: '(no text answer)',
      aborted: 'aborted', timeout: 'timeout', failed: 'failed',
      failedPrefix: 'failed: ', queue: ' · queued {n}', thinking: 'thinking · {t}',
      chatAborted: 'aborted · not counted in history', chatPartial: '({n} chars generated)',
      chatTimeout: 'timeout ({sec}s without new content), {n} chars generated',
      askUsage: 'usage: ask <question>',
      chatOn: 'chat mode on — type and press Enter, Esc to exit.',
      chatOff: 'chat mode off (history kept; type chat to resume).',
      chatClosedMsg: 'chat closed, history cleared.',
      chatCleared: 'chat history cleared.',
      agentOn: 'agent mode on — multi-turn, tools enabled; Esc or agent stop to exit.',
      agentOff: 'agent mode off (history kept; type agent to resume).',
      agentClosedMsg: 'agent closed, history cleared.',
      agentCleared: 'agent history cleared.',
    },
    zh: {
      title: 'DSL 终端', modeTerminal: '终端', modeEditor: '编辑器',
      btnManual: '手册', btnRun: '运行', btnRunning: '⏳ 运行中…', btnSave: '保存',
      btnManualTip: '导出 DSL 手册（.md）', btnRunTip: '运行编辑器中的脚本',
      btnSaveTip: '保存当前脚本', closeAria: '关闭',
      phScriptName: '脚本名称',
      replAria: 'DSL 命令行',
      phCode: '// 写一段脚本，Ctrl+Enter 运行；ctx.log(...) 打印到下方控制台',
      phChat: '直接输入要问的话，回车发送 · Esc 退出对话',
      banner: '北风 DSL 终端 [{ver}]\n脚本以你本人的权限运行，等同浏览器开发者工具。输入 help 查看全部命令。',
      selfXss: '不要粘贴任何你不理解的脚本。在此运行的脚本拥有与你本人相同的权限（可读写数据、读取密钥）。只运行你信任的来源或你自己写的代码。',
      selfXssLead: '安全警告：',
      selfXssOk: '我已知晓',
      permRead: '只读', permData: '可写·应用', permSecrets: '可读密钥', permFull: '可写·全局',
      permAria: '权限档位：{lv}',
      permTipRead: '当前只读：脚本可查数据、翻页、通知、切主题；写操作需先提权。出站写法（fetch、图片 src、sendBeacon、WebSocket、整页跳转等）会被静态拦下——这是静态检查、不是沙箱，绕过它不需要本事。点这里发起提权（需确认，仅本次页面会话有效）',
      permTipData: '可写·应用：书架元数据 / 便签 / 书签 / 划线 / 生词本 / 普通设置项。仅本次页面会话有效，perm read 复位',
      permTipSecrets: '可读密钥明文（独立授权档）。仅本次页面会话有效，perm read 复位',
      permTipFull: '可写·全局：任意本地存储键 + 全部设置 + 写密钥。仅本次页面会话有效，perm read 复位',
      aiOff: 'AI 未配置', aiReady: 'AI · {prov}', aiChat: '会话 {n} 轮', aiAgent: 'Agent {n} 轮',
      aiReadyWord: '就绪',
      aiTipOff: '还没有可用的 API 密钥，ask / chat / agent 会直接跳过。点这里去「设置 → AI 服务」填。',
      aiTipChat: '会话模式进行中（多轮带上下文）。点这里退出会话。',
      aiTipAgent: 'Agent 会话进行中（多轮 + 可调用工具）。点这里退出会话。',
      aiTipReady: '密钥已配。点这里进入会话模式，或直接敲 ask <问题> 单轮问一句。',
      statusPos: '行 {ln}，列 {col}', statusSize: '{lines} 行 · {chars} 字', statusOk: '✓ 校验通过',
      promptChat: '对话中>', promptAgent: 'agent>',
      pathHome: '首页', pathShelf: '书架', pathConfig: '设置', pathFind: '检索', pathStats: '统计',
      pathNotes: '笔记', pathMe: '我的', pathRead: '阅读', pathQj: '曲径',
      bookFallback: '阅读', bookDir: 'C:\\beifeng\\《{title}》\\{ch}>', chapterSeg: '第{n}章',
      outManual: 'DSL 手册已导出：{name}（{chars} 字符）',
      outLoaded: '加载脚本：{name}{inactive}', outInactive: '（已停用）',
      outRunSel: '运行选区 {n} 行', outRun: '运行脚本：{name}',
      outDone: '完成（{ms}ms）· 返回 undefined',
      errPrefix: '异常：', youPrefix: '你 › ',
      outMoved: ' …（已转入编辑器）',
      outChatClosed: '（已退出对话）', outAgentClosed: '（已退出 Agent 会话）',
      outPosReset: '终端上次位置已超出当前屏幕，已重置到中央',
      keyMissing: '未配置 API 密钥：设置 → AI 服务填好后重试。',
      emptyPrompt: '没听到问题。',
      agentLive: 'Agent 运行中…（会调用本地工具，可能在检索全书）',
      noAnswer: '（Agent 没给文本结论）',
      aborted: '已中止', timeout: '超时', failed: '失败',
      failedPrefix: '失败：', queue: ' · 排队 {n}', thinking: '思考 · {t}',
      chatAborted: '已中止 · 本轮不计入历史', chatPartial: '（已生成 {n} 字）',
      chatTimeout: '响应超时（{sec}s 内无新内容），已生成 {n} 字',
      askUsage: '用法：ask <问题>',
      chatOn: '对话模式已开：直接输入内容回车即发送，Esc 或 chat 退出。',
      chatOff: '对话模式已关（历史保留，再输 chat 接着聊）。',
      chatClosedMsg: '已结束对话，历史清空。',
      chatCleared: '对话历史已清空，会话继续。',
      agentOn: 'Agent 会话模式已开：直接输入内容回车即发送（多轮 + 可调用工具），Esc 或 agent stop 退出。',
      agentOff: 'Agent 会话模式已关（历史保留，再输 agent 接着聊）。',
      agentClosedMsg: 'Agent 会话已结束，历史清空。',
      agentCleared: 'Agent 对话历史已清空，会话继续。',
    },
  };
  /* chat / Agent 会话面的话术键：这些键取档用 aiConvLang，其余键仍用 dslLang。
     两张档共用同一张 L10N 表（zh 文案本来就全），只是取档入口不同。 */
  const _AI_CONV_KEYS = {
    promptChat: 1, promptAgent: 1, agentLive: 1, noAnswer: 1, aborted: 1, timeout: 1,
    failed: 1, failedPrefix: 1, queue: 1, thinking: 1, chatAborted: 1, chatPartial: 1,
    chatTimeout: 1, askUsage: 1, chatOn: 1, chatOff: 1, chatClosedMsg: 1, chatCleared: 1,
    agentOn: 1, agentOff: 1, agentClosedMsg: 1, agentCleared: 1,
    outChatClosed: 1, outAgentClosed: 1, aiChat: 1, aiAgent: 1, aiTipChat: 1, aiTipAgent: 1,
  };
  function _T(k, vars) {
    let lv = 'en';
    try { lv = BF.settings.get(_AI_CONV_KEYS[k] ? 'aiConvLang' : 'dslLang') || 'en'; } catch (e) {}
    let s = (L10N[lv] && L10N[lv][k]);
    if (s == null) s = L10N.en[k];
    if (s == null) s = k;
    if (vars) Object.keys(vars).forEach(function (n) { s = s.split('{' + n + '}').join(String(vars[n])); });
    return s;
  }

  /* ---- 终端对话（ask 单轮 / chat 多轮） ----
     走 BF.ai.gateway.call：每次调用都注册 'AI · <模型>' 的 io job，
     因此不进脚本预算、Ctrl+C 的中止链也直接管得到它。
     runCard 会改写全局停止句柄（把研读中心的「停止」抢走），这里刻意不用。 */
  const CHAT_SYS = '你是《北风》阅读器内置终端里的助手。用中文口语回答，尽量短；不要输出 Markdown 标题与代码块装饰，除非用户明确要代码。';
  const CHAT_TURNS = 12;      /* 会话只带最近 12 轮，超出即滚动丢弃 */
  let _uiSink = null;         /* dslUI 注册的输出通道；脚本里调用时为空，退回纯文本返回 */
  let _chatOn = false, _chatHist = [], _chatCtrl = null;
  /* Agent 会话态：与 _chatHist 分开存 —— 两者的系统提示词与工具协议不同，
     混在一个历史里等于把聊天的上下文喂给带工具的 Agent。 */
  let _agentOn = false, _agentHist = [];
  function _chatCtxLine() {
    try {
      /* 字段真名是 currentBookId / currentChapterIdx；写 st.bookId / st.chapterIdx
         永远取不到值，这行上下文就成了静默死代码。 */
      const st = BF.appState || {};
      if (!st.currentBookId) return '';
      const b = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (x) { return x && x.id === st.currentBookId; });
      if (!b) return '';
      return '用户当前在读《' + b.title + '》第 ' + ((st.currentChapterIdx || 0) + 1) + ' 章。';
    } catch (e) { return ''; }
  }
  async function _chatTurn(question, remember) {
    if (!BF.ai.requireKey('终端对话')) return _T('keyMissing');
    const q = String(question == null ? '' : question).trim();
    if (!q) return _T('emptyPrompt');
    const msgs = [{ role: 'system', content: CHAT_SYS + _chatCtxLine() }].concat(remember ? _chatHist : []);
    msgs.push({ role: 'user', content: q });
    const live = _uiSink && _uiSink.live ? _uiSink.live() : null;
    const ctrl = new AbortController();
    _chatCtrl = ctrl;
    const t0 = Date.now();
    let acc = '', think = '';
    const stamp = function (model) {
      return '\n· ' + (model || (BF.ai.currentProvider() || {}).id || '?') + ' · ' + ((Date.now() - t0) / 1000).toFixed(1) + 's' +
        (BF.ai.gateway.queueLength ? _T('queue', { n: BF.ai.gateway.queueLength() }) : '');
    };
    try {
      const out = await BF.ai.gateway.call(msgs, {
        stream: true, signal: ctrl.signal, timeout: 180000,
        onDelta: function (d) {
          if (!d || !d.text) return;
          if (d.type === 'reasoning') { think += d.text; if (live) live(_T('thinking', { t: think })); return; }
          acc += d.text;
          if (live) live(acc);
        }
      });
      const text = String(acc || (out && out.content) || '');
      if (remember) {
        _chatHist.push({ role: 'user', content: q }, { role: 'assistant', content: text });
        const over = _chatHist.length - CHAT_TURNS * 2;
        if (over > 0) { _chatHist = _chatHist.slice(over); }
      }
      const line = text + stamp(out && out.model);
      if (live) { live.finish(line); return ''; }
      return line;
    } catch (e) {
      const msg = String((e && e.message) || e);
      const aborted = e && e.name === 'AbortError' && !e.__bfTimeout;
      const line = aborted
        ? _T('chatAborted') + stamp() + (acc ? '\n' + _T('chatPartial', { n: acc.length }) : '')
        : (e && e.__bfTimeout
            ? _T('chatTimeout', { sec: (e.__bfTimeoutSec || '?'), n: acc.length }) + (acc ? ': \n' + acc : '') + stamp()   /* 保留已生成文本，可复制 */
            : _T('failedPrefix') + msg + stamp());
      if (live) { live.finish(line); return ''; }
      return line;
    } finally {
      _chatCtrl = null;
      if (live && live.cancel) live.cancel();
    }
  }
  /* Agent 模式（终端）：与 AI 中心那张 Agent 卡同一个 agentRun。
     提示词里的工具协议、设置建议、以及「没拿到工具结果前不许说已改好」这条底线
     必须与面板那张卡保持一致——改一边就改另一边。 */
  async function _agentTurn(question, remember) {
    if (!BF.ai.requireKey('终端 Agent')) return _T('keyMissing');
    const q = String(question == null ? '' : question).trim();
    if (!q) return _T('emptyPrompt');
    const book = BF.reader.state.book;
    const bookName = (book && book.title) || '当前书';
    const live = _uiSink && _uiSink.live ? _uiSink.live() : null;
    if (live) live(_T('agentLive'));
    const ctrl = new AbortController();
    _chatCtrl = ctrl;
    const t0 = Date.now();
    /* 多轮：系统提示词 + 历史 + 本轮提问。历史只存「用户/助手」文本轮
       （工具中间轮由 agentRun 内部循环消化，不进历史），上限 CHAT_TURNS 轮滚动丢弃。 */
    const msgs = [{ role: 'system', content: BF.ai.agentSystemPrompt(bookName) }]
      .concat(remember ? _agentHist : [])
      .concat([{ role: 'user', content: q }]);
    try {
      const text = String(await BF.ai.agentRun(msgs, { signal: ctrl.signal }) || '').trim();
      if (remember && text) {
        _agentHist.push({ role: 'user', content: q }, { role: 'assistant', content: text });
        const over = _agentHist.length - CHAT_TURNS * 2;
        if (over > 0) _agentHist = _agentHist.slice(over);
      }
      const line = (text || _T('noAnswer')) + '\n· agent · ' + ((Date.now() - t0) / 1000).toFixed(1) + 's';
      if (live) { live.finish(line); return ''; }
      return line;
    } catch (e) {
      const aborted = e && e.name === 'AbortError' && !e.__bfTimeout;
      const line = aborted ? _T('aborted') : ((e && e.__bfTimeout ? _T('timeout') : _T('failed')) + ': ' + ((e && e.message) || e));
      if (live) { live.finish(line); return ''; }
      return line;
    } finally {
      _chatCtrl = null;
      if (live && live.cancel) live.cancel();
    }
  }
  /* dslUI 启动时注册输出通道：out 追加一行，live 开一行可就地改写的流式行，
     chatMode 同步会话态到提示符。没注册时（脚本里直接调）退回纯文本返回。 */
  function setUiSink(sink) { _uiSink = sink || null; }
  /* 中止在途生成：作业的 abort 只结记录、断不掉 SSE 读流，
     必须掐传进网关的那个 signal。 */
  function chatAbort() {
    if (!_chatCtrl) return false;
    try { _chatCtrl.abort(); } catch (e) {}
    return true;
  }
  function _chatStop() {
    if (_chatCtrl) { try { _chatCtrl.abort(); } catch (e) {} }
    _chatOn = false; _chatHist = [];
    if (_uiSink && _uiSink.chatMode) _uiSink.chatMode(false);
  }
  /* Agent 会话结束：与 _chatStop 同形，作用于 _agentHist / _agentOn。两模式互斥，
     共享 _chatCtrl 作在途中止句柄（终端同一时刻只会有一个在途生成）。 */
  function _agentStop() {
    if (_chatCtrl) { try { _chatCtrl.abort(); } catch (e) {} }
    _agentOn = false; _agentHist = [];
    if (_uiSink && _uiSink.chatMode) _uiSink.chatMode(false);
  }
  /* ---- 命令解析 ---- */
  /* 终端里要敲符号的地方越少越好：这五个词裸词即命令，`!` 前缀保留为可选
     别名（历史手册、已导出 .md、以及敲惯了的手感都不作废）。判定点只有
     这一处，往下 handleMeta 收到的 raw 一律不带 `!`。 */
  const META_WORDS = { perm: 1, clear: 1, can: 1 };
  function parseLine(line) {
    line = String(line || '').trim();
    if (!line) return { type: 'empty' };
    if (line.startsWith('!')) {
      const inner = line.slice(1).trim();
      const iw = (inner.split(/\s+/)[0] || '').toLowerCase();
      /* 带符号却认不出来仍要报「未知命令」，不能因为剥了符号就静默掉进 JS 求值 */
      if (iw !== 'js' && iw !== 'help' && !META_WORDS[iw] && !ALIAS[iw]) return { type: 'meta', raw: iw || inner };
      line = inner;
    }
    /* 输出重定向 `> clip`：行首的 `>` 整行接管，不执行任何命令，只把上一条结果送剪贴板。
       `a > b` 这类表达式不以 `>` 开头，比较运算符照旧；只认单独成行的
       `> clip` / `>clip`，`> file` 与空目标显式拒绝，不静默当成没打过。 */
    if (line.startsWith('>')) {
      const rest0 = line.slice(1).trim();
      const tgt = (rest0.split(/\s+/)[0] || '').toLowerCase();
      if (tgt === 'clip') return { type: 'clip', target: 'clip' };
      return { type: 'clip-reject', target: tgt || '' };
    }
    const parts = line.split(/\s+/);
    const word = parts[0].toLowerCase();
    /* 别名 → 真动词（别名表由命令表派生，实现只住 handlers 一处） */
    const cmd = ALIAS[word] || word;
    const rest = parts.slice(1);
    const norm = cmd + (rest.length ? ' ' + rest.join(' ') : '');
    if (cmd === 'js') return { type: 'js', code: rest.join(' ') };
    if (META_WORDS[cmd]) return { type: 'meta', raw: norm };
    /* cmd 的第一反射：`命令 /?`、`-h` 就地查这一条，不必先猜 help 的子词 */
    if (rest.some(_isHelpFlag) && _cmdRows(cmd).length) return { type: 'meta', raw: 'help ' + cmd };
    const args = rest;
    const handlers = {
      ask: function () { return args.length ? _chatTurn(args.join(' '), false) : _T('askUsage'); },
      chat: function () {
        const sub = (args[0] || '').toLowerCase();
        if (sub === 'stop' || sub === 'exit') { _chatStop(); return _T('chatClosedMsg'); }
        if (sub === 'clear') { _chatHist = []; return _T('chatCleared'); }
        if (args.length) return _chatTurn(args.join(' '), true);
        _chatOn = !_chatOn;
        /* 两模式互斥（两个方向都收）：开 chat 时把 agent 会话关掉，历史保留。 */
        if (_chatOn && _agentOn) _agentOn = false;
        if (_uiSink && _uiSink.chatMode) _uiSink.chatMode(_chatOn);
        return _chatOn ? _T('chatOn') : _T('chatOff');
      },
      agent: function () {
        const sub = (args[0] || '').toLowerCase();
        if (sub === 'stop' || sub === 'exit') { _agentStop(); return _T('agentClosedMsg'); }
        if (sub === 'clear') { _agentHist = []; return _T('agentCleared'); }
        if (args.length) return _agentTurn(args.join(' '), true);
        /* 无参：进出 Agent 会话模式（多轮带上下文、可调用本地工具）。与 chat 互斥。 */
        _agentOn = !_agentOn;
        if (_agentOn && _chatOn) _chatOn = false;
        if (_uiSink && _uiSink.chatMode) _uiSink.chatMode(_agentOn);
        return _agentOn ? _T('agentOn') : _T('agentOff');
      },
      help: function () { return TOOLS.help(args[0]); },
      manual: function () { return TOOLS.manual(); },
      theme: function () {
        /* 带档名就指定，不带就循环 —— 中文名与登记表键都认（BF.skin.id 反查） */
        const want = args.join(' ').trim();
        if (want && !BF.skin.set(want)) return '没有这档外观：' + want + '（可用 ' + (BF.SKINS || []).map(function (k) { return k + '·' + BF.skin.label(k); }).join(' / ') + '）';
        if (!want) BF.theme.cycle();
        return '已切换外观：' + BF.skin.get() + '（' + BF.skin.label(BF.skin.get()) + '）';
      },
      go: function () { BF.app.go(args[0] || 'home'); return '已跳转 ' + (args[0] || 'home'); },
      open: function () {
        const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
        const b = books.find(function (x) { return x && x.title.includes(args.join(' ')); });
        if (b) { BF.app.openBook(b.id); return '已打开《' + b.title + '》'; }
        return '未找到书籍';
      },
      notify: function () { BF.noti.success(args.join(' ')); return '已通知'; },
      settings: function () {
        /* 密钥键不得裸 BF.settings.get 回显明文 —— read 档
           用户在 REPL 里 `settings aiApiKey` 就能看到密钥；与 TOOLS /
           ctx 两条读路径走同一规则：密钥键先过闸门
           （按档位 + danger=3 逐次确认），批准才回显；拒绝答复带出口。 */
        if (args.length === 1) {
          if (_isSecretSettingKey(args[0])) {
            return _secretGate('settings ' + args[0]).then(function (ok) {
              if (!ok) return '访问被拒绝：密钥明文需 secrets 档授权或逐次确认（回复 y）';
              return args[0] + ' = ' + JSON.stringify(BF.settings.get(args[0]));
            });
          }
          return args[0] + ' = ' + JSON.stringify(BF.settings.get(args[0]));
        }
        /* 同 TOOLS.settings.set：不得整包直写 LS
           （不进 BF.settings 内存态、无 SETTINGS 广播、
           下次 set 会被整包覆盖）。权限校验后走 BF.settings.set。 */
        if (args.length >= 2) {
          const g = _permCan('settings');
          if (!g.ok) return g.error;
          /* 与 TOOLS.settings.set 同口径：'theme' 是合并后遗留的死键，拦住并给出口 */
          if (args[0] === 'theme') return 'theme 已并入 appearance：换档直接敲 theme <档名>（或 theme 循环）';
          /* 单一写路径，闸门只管要不要放行 */
          const doWrite = function () {
            try {
              BF.settings.set(args[0], args[1]);
              if (BF.settings.save) BF.settings.save(true);   /* 离散写入立即落盘 */
              return '已设置 ' + args[0];
            }
            catch (e) { return '设置失败：' + ((e && e.message) || e); }
          };
          /* 写侧闸门与读侧对称（读回显逐次确认，写也走同一判据）：
             data 档一行 `settings aiApiKey <值>` 就能装密钥，`settings pinLock false` 就能拆启动锁，
             全程不出 y 确认框 —— 而同一判据在 TOOLS.settings.set 与 hub cfg.set 两条路上都在。
             把密钥塞进 aiPresets 也是同一件事。这里只补闸门，不改四级权限判定本身。 */
          const secretish = _isSecretSettingKey(args[0]) ||
            (args[0] === 'aiPresets' && /aiApiKey/.test(String(args[1] || '')));
          if (!secretish) return doWrite();
          return _secretGate('settings ' + args[0]).then(function (ok) {
            if (!ok) return '写入被拒绝：密钥类设置需回复 y 确认（配密钥建议直接敲 key ai <值>）';
            if (_permLevel() !== 'full') return '敏感设置（' + args[0] + '）需 full 权限（perm full）';
            return doWrite();
          });
        }
        return '用法：settings <key> [value]';
      },
      key: function () {
        /* key ai <值> / key mimo <值>：密钥裸词入口。
           背后就是 TOOLS.keys.set（full 档 + _secretGate 逐次确认）；
           输出只说「是否已配置」，不回显密钥值。 */
        const kind = (args[0] || '').toLowerCase();
        const val = args.slice(1).join(' ');
        if (kind !== 'ai' && kind !== 'mimo') return '用法：key ai <密钥> 或 key mimo <密钥>（mimo 是 MiMo 朗读密钥；均需 perm full，确认回复 y）';
        if (!val) return '用法：key ' + kind + ' <密钥值>（密钥不会出现在回执里）';
        const pid = kind === 'ai' ? (BF.ai.currentProvider ? BF.ai.currentProvider().id : '') : '';
        /* keys.set 的三条早退（种类不认 / 档位不够 / 服务商未知）返回的是普通对象，
           只有走完确认那一条才是 Promise，故这里包一层再挂 then。 */
        return Promise.resolve(TOOLS.keys.set(pid, val, kind)).then(function (r) {
          if (!r.ok) return '写入失败：' + (r.error || '未知原因');
          return '已写入' + (kind === 'mimo' ? ' MiMo 朗读' : ' AI') + '密钥（已配置：' + (r.keySet ? '是' : '否') + '）';
        });
      },
      ls: function () { return BF.store.lsKeys().join(', '); },
      /* ---- 常用面：备份 / 统计 / 场景 / 朗读 / 查找 / 标签 / 字号 ----
           这些命令只做「触发 + 一行中文答复」，参数缺失就把可选项列出来，
           不在 REPL 里复制一遍各功能面板的交互。 */
      bk: function () {
        const what = (args[0] || 'now').toLowerCase();
        if (what === 'now') {
          /* autoNow 是 async：答复必须排在它之后，否则「已触发」会在
             备份还没落盘时就打出来（失败也要照实说，不报成功）。 */
          return Promise.resolve(BF.bk.autoNow()).then(function () { return '已触发自动备份'; },
            function (e) { return '自动备份失败：' + ((e && e.message) || e); });
        }
        if (what === 'export') { BF.bk.exportWithAsk(); return '已弹出导出询问'; }
        return '未知动作：' + what + '（可用 now / export）';
      },
      stats: function () {
        return '今日 ' + BF.stats.todayDisplay() + ' 分钟 · 累计 ' + BF.stats.total() + ' 小时 · 连续 ' + BF.stats.streak() + ' 天';
      },
      scene: function () {
        const names = Object.keys(BF.SCENES || {});
        const want = args.join(' ').trim();
        if (!want) return names.length ? '可用场景：' + names.join('、') + '（用法：scene 场景名）' : '还没有内置场景';
        if (names.indexOf(want) < 0) return '未知场景：' + want + '（可用：' + (names.join('、') || '无') + '）';
        BF.scene.apply(want);
        return '已应用场景：' + want;
      },
      tts: function () {
        const act = (args[0] || '').toLowerCase();
        const st = BF.tts && BF.tts.state ? BF.tts.state : { playing: false, engine: '未知' };
        if (!act) return '用法：tts play|pause|resume|stop|status';
        if (act === 'status') return '朗读：' + (st.playing ? '播放中' : '未播放') + ' · 引擎 ' + (st.engine || '未知');
        if (act === 'play') { BF.tts.start(); return '已请求开始朗读'; }
        if (act === 'pause') { BF.tts.pause(); return '已请求暂停朗读'; }
        if (act === 'resume') { BF.tts.resume(); return '已请求继续朗读'; }
        if (act === 'stop') { BF.tts.stop(); return '已停止朗读'; }
        return '未知动作：' + act + '（可用 play / pause / resume / stop / status）';
      },
      find: function () {
        const q = args.join(' ').trim();
        if (!q) return '用法：find <词>（在当前章正文里查找）';
        if (BF.appState.currentPage !== 'reader') return '章内查找只在阅读页可用（当前页：' + BF.appState.currentPage + '）';
        BF.findInPage.open();
        const inp = document.getElementById('bf-find-input');
        if (!inp) return '章内查找输入框没建出来（查找条未就绪）';
        inp.value = q;
        inp.dispatchEvent(new Event('input', { bubbles: true }));
        return '已在章内查找：' + q;
      },
      tag: function () {
        const ts = (BF.library && BF.library.allTags) ? BF.library.allTags() : [];
        if (!ts.length) return '还没有标签';
        return '标签 ' + ts.length + ' 个：' + ts.join('、');
      },
      zoom: function () {
        let n = 1;
        if (args.length) {
          n = parseInt(args[0], 10);
          if (isNaN(n)) return '用法：zoom [±n]（n 为字号增减步长，缺省 +1，0 为复位默认字号）';
        }
        if (BF.appState.currentPage !== 'reader') return '字号调节只在阅读页生效（当前页：' + BF.appState.currentPage + '）';
        BF.enh.zoomBy(n);
        return '当前字号 ' + BF.settings.get('fontSize') + 'px';
      },
      ver: function () {
        const st = BF.appState || {};
        return '北风 ' + (BF.VERSION_DISPLAY || '?') + ' · 外观 ' + BF.skin.get() +
          ' · 权限 ' + _permLevel() + ' · 页面 ' + (st.currentPage || '?') +
          (st.currentPage === 'reader' ? ' 第' + (Number(st.currentChapterIdx || 0) + 1) + '章' : '');
      },
      where: function () {
        const w = String(args[0] || '').toLowerCase();
        if (!w) return '用法：where <词>　查这个词是真命令、别名（→谁），还是会被当 JS 表达式';
        return _cmdCard(w);
      },
      close: function () {
        if (BF.dsl.chatBusy && BF.dsl.chatBusy()) BF.dsl.chatStop();
        if (BF.sheet.isOpen('dsl-console')) { BF.dslUI.toggle(); return '已关闭终端'; }
        return '终端没开着';
      },
      /* 裸 `clip`（不带 `>`）落到这里：它不是命令，只是重定向的提示出口。
         登记在案还为了让 help / `where clip` / `clip /?` 查得到，不漂移。 */
      clip: function () { return '`> clip` 是输出重定向，要接在上一条结果之后、单独成行输入（例如先敲 `1+1`，下一行敲 `> clip`）。'; },
      /* ---- 工程模式（beifeng666 / ops）----
         bat 由 BF.ops.batSource 生成、BF.exportBlob 单一出口导出。
         ping 用 no-cors 探预览（opaque 响应即"服务器活着"）、探转发器健康口
         （proxy 自带 CORS，可直接读）。探活失败给的是"不在"，不是报错 ——
         本地服务没起是常态，不是故障。 */
      beifeng666: function () {
        BF.ops.active = true;
        const _m = BF.ops.exportBat();
        return '工程模式已开启（提示符切到 C:\\beifeng\\ops）。' + _m + '。' +
          'bat 自包含（不依赖 tool 目录）：放到任意位置双击即可，有 Node 用 Node、没有走内嵌 Python。本地预览 8791 / 转发器 8792。' +
          '再敲 ops ping 探活、ops off 退出模式。';
      },
      ops: function () {
        const act = String(args[0] || '').toLowerCase();
        const O = BF.ops;
        if (!O.active) return '工程模式未开启：先输入 beifeng666（会切换模式并导出配套 bat）。';
        if (!act || act === 'help') return 'ops bat 重新导出启动器 · ops ping 探活预览(8791)与转发器(8792) · ops off 退出工程模式';
        if (act === 'bat') return O.exportBat();
        if (act === 'off') { O.active = false; return '已退出工程模式。'; }
        if (act === 'ping') {
          const _probe = function (url, noCors) {
            return new Promise(function (res) {
              const ctl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
              const t = setTimeout(function () { if (ctl) ctl.abort(); res(false); }, 1500);
              fetch(url, noCors ? { mode: 'no-cors', cache: 'no-store', signal: ctl && ctl.signal } : { cache: 'no-store', signal: ctl && ctl.signal })
                .then(function () { clearTimeout(t); res(true); })
                .catch(function () { clearTimeout(t); res(false); });
            });
          };
          return Promise.all([_probe('http://127.0.0.1:' + O.SERVE_PORT + '/', true), _probe('http://127.0.0.1:' + O.PROXY_PORT + '/health', false)])
            .then(function (r) {
              return '本地预览 ' + O.SERVE_PORT + ': ' + (r[0] ? '在' : '不在') +
                ' · 转发器 ' + O.PROXY_PORT + ': ' + (r[1] ? '在' : '不在') +
                ((!r[0] || !r[1]) ? '（不在的那项：跑 beifeng-tools.bat 即可，bat 自带引擎无需其他文件）' : '（都活着）');
            });
        }
        return '未知动作：' + act + '（可用 bat / ping / off）';
      },
    };
    /* 漂移自检（每次会话首条命令跑一次）：实现与命令表必须一一对上。
       表是 help / Tab 补全 / 参数候选的真源，漏登记＝命令能跑但界面里查不到。 */
    if (!parseLine._driftChecked) {
      parseLine._driftChecked = true;
      const doc = CMDS.map(function (c) { return c.name; });
      const impl = Object.keys(handlers);
      const unlisted = impl.filter(function (k) { return doc.indexOf(k) < 0; });
      const ghost = doc.filter(function (k) { return !(k in handlers); });
      if (unlisted.length || ghost.length) {
        BF.log.warn('DSL 命令表与实现漂移：未登记 ' + (unlisted.join('/') || '无') + '、表里有但无实现 ' + (ghost.join('/') || '无'));
      }
    }
    if (handlers[cmd]) return { type: 'cmd', result: handlers[cmd]() };
    /* 打错的命令（全小写裸词且与某条命令只差一点）按 cmd 的口径作答并给最近邻；
       大小写敏感的标识符（`BF`、`ctx`）与带运算符的表达式仍走 JS 求值 —— 回车直接出值
       是这终端的看家本领，不能为了像 cmd 把它换掉。 */
    if (/^[a-z][a-z0-9_-]*$/.test(parts[0]) && !rest.length && _nearWords(word).length) {
      return { type: 'meta', raw: 'unknown ' + word };
    }
    /* 未知命令 → 尝试按 JS 表达式执行（终端惯例：默认就是 JS） */
    return { type: 'js', code: line };
  }
  /* ---- REPL 特殊命令（clear / perm / js / can）：裸词，! 前缀可选 ---- */
  function handleMeta(raw) {
    const parts = raw.split(/\s+/);
    const m = parts[0].toLowerCase();
    if (m === 'clear') return { type: 'meta-clear' };
    if (m === 'perm') {
      if (parts.length < 2) {
        var _lv = _permLevel();
        var _g = _sGet(LS_GRANT, 0) || 0;
        var _left = (_lv !== 'read' && _g) ? Math.max(0, Math.ceil((PERM_TTL - (Date.now() - _g)) / 86400000)) : 0;
        return '当前权限：' + _lv + (_left ? '（' + _left + ' 天后自动降级为只读）' : '') +
          '\n  perm data     应用数据写（书架/笔记/书签/划线/生词/普通设置）' +
          '\n  perm full     全局写入 + 写密钥' +
          '\n  perm secrets  读取密钥明文（独立授权，同时含 full 档全部写权限）' +
          '\n  perm read     立即回到只读' +
          /* 档位拦的是误操作，不是恶意代码：脚本跑在用户自己的浏览器里，
             能力等同开发者控制台。这句话放在权限帮助的最下面，是为了让人
             在提权之前就看到「只读档不是沙箱」。 */
          '\n  这些档位防的是误操作：只读档会拦常见的联网与动态求值写法，也挡住直读密钥键，' +
          '但把名字拆开再拼接的写法绕得过——别粘贴你看不懂在做什么的脚本。';
      }
      const lv = parts[1].toLowerCase();
      if (lv === 'data' || lv === 'full' || lv === 'secrets') return _grantPerm(lv).then(function (r) { return '已切换为 ' + r + ' 权限' + (r === 'read' ? '（未授权，保持只读）' : ''); });
      if (lv === 'read') { _sSet(LS_PERM, 'read'); return '已回到只读'; }
      return '未知权限：' + lv + '（可用 read / data / full / secrets）';
    }
    /* 帮助只有一页：TOOLS.help 是真源（裸 help 走 handlers，`!help` 与 `命令 /?` 从这里进来）。
       这里不另写第二份速查：加一条命令要记得两处，很快就和命令表对不上。 */
    if (m === 'help') return TOOLS.help(parts[1]);
    if (m === 'can') return TOOLS.help('caps');
    /* parseLine 认出「像是打错的命令」后送进来：按 cmd 的口径作答 + 最近邻 */
    if (m === 'unknown') return _cmdCard(parts[1] || '');
    return '未知命令：' + m + '（可用 js / clear / perm / help / can）';
  }
  /* 能力清单：带「当前是否授权」，让脚本作者不必猜 */
  function _helpCaps() {
    try {
      var caps = BF.hub && BF.hub.describe ? BF.hub.describe() : [];
      if (!caps.length) return '尚无已登记的动作。';
      var lv = _permLevel();
      var lines = ['可调用动作清单（当前权限：' + lv + '）', ''];
      var byCat = {};
      caps.forEach(function (c) {
        var cat = c.cat || '通用';
        (byCat[cat] = byCat[cat] || []).push(c);
      });
      Object.keys(byCat).forEach(function (cat) {
        lines.push('【' + cat + '】');
        byCat[cat].forEach(function (c) {
          var sig = (c.args && c.args.length)
            ? '(' + c.args.map(function (a) { return a.name + (a.required ? '' : '?'); }).join(', ') + ')'
            : '()';
          lines.push('  ' + (c.allowed ? '✓' : '✗') + ' ' + c.id + sig + '   ' + (c.cap || '未声明') + '   ' + c.label);
        });
        lines.push('');
      });
      lines.push('✓ 当前可用   ✗ 需要更高权限（perm 调整）');
      return lines.join('\n');
    } catch (e) { return '能力清单读取失败：' + e.message; }
  }
  function _helpTypes() {
    return [
      '类型系统（对齐 Python）',
      '',
      '  int / float / bool / str / null',
      '  list[T] / tuple[T] / dict[K,V] / set[T] / slice',
      '  后缀 ? 表示可为 null：  str? s = null',
      '',
      '规则：',
      '  · 声明默认不可变（相当于 const），需要修改写 var',
      '  · bool 与数字不互相转换（有意偏离 Python）',
      '  · int 接受整数字面量与整数字符串；小数请用 float',
      '  · 类型不符会在输出区给出提示，但不阻断运行',
      '  · 不提供自定义类；结构用 dict，如 {名: "三国", 章数: 120}',
    ].join('\n');
  }
  function _helpLang() {
    return [
      '语言要点',
      '',
      '  list[str] books = ctx.tools.listBooks();   // 类型声明',
      '  var int n = 0;                             // 可变变量',
      '  const x = 1;                              // 原生 JS 同样可用',
      '  function f(a, b) { return a + b; }        // 函数',
      '  return 值;                                  // 顶层 return 即输出',
      '',
      '  · 语法是 JS，上层加了权限校验',
      '  · 未登记的动作会被拒绝（默认拒绝）',
      '  · 写操作一律 BF.cap.invoke("动作id", [参数])',
      '  · 关闭类型改写：设置里把 dslTypes 设为 false',
    ].join('\n');
  }
  /* DSL 执行上下文：终端 REPL、编辑器运行全都汇到
     execute 这一条漏斗，所以标记只需在这里进出。计数而非布尔——脚本里
     再触发命令/工具会造成嵌套执行，层层进出必须配平。 */
  var _scriptDepth = 0;
  function _scriptEnter() { _scriptDepth++; }
  function _scriptExit() { if (_scriptDepth > 0) _scriptDepth--; }
  function isScript() { return _scriptDepth > 0; }
  /* 「上一条结果」槽：存的是 formatResult 的显示文本，不是原始对象 ——
     重定向到剪贴板的东西应当与屏幕上看到的一致。
     只在非空时覆盖：流式命令靠 live 直接渲染、自身返回 ''，不能把上一条抹掉；
     meta-* 是渲染层的哨兵对象（如清屏），也没有可复制的内容。
     `> clip` 之后紧跟 `> clip` 仍复制同一条：clip 分支本身不写这个槽。 */
  var _lastResultText = '';
  function _storeLast(r) {
    if (r && typeof r === 'object' && typeof r.type === 'string' && r.type.indexOf('meta-') === 0) return r;
    try {
      const t = formatResult(r);
      if (t) _lastResultText = t;
    } catch (e) { BF.err.report('dsl.storeLast', e); }
    return r;
  }
  /* 剪贴板写入失败（非安全上下文 / 权限策略拒绝）不算命令失败：
     不抛、不计入 AI 熔断，只回一句拒绝说明。 */
  async function _clipWrite(text) {
    try {
      if (!navigator.clipboard || !navigator.clipboard.writeText) throw new Error('unavailable');
      await navigator.clipboard.writeText(text);
      return { ok: true, n: text.length };
    } catch (e) { return { ok: false, err: e }; }
  }
  /* 5 秒是脚本算力的时限，不是等人的时限。确认框开着就把截止顺延——
     否则「DSL 里也要二次确认」必然翻车：用户还没敲完 y，脚本已报超时，
     而确认框仍在后台，敲完照样执行，同一次操作同时留下失败与成功两条记录。 */
  /* 预算计时：只要「在等什么」就顺延——确认框开着、或 jobs 里有在途 io 任务，
     都不算超时（否则「DSL 里也要二次确认 / 脚本在等网络」必然翻车：用户还没敲完，
     脚本已报超时，而底层请求其实可能成功）。超预算只 reject 计时侧、补一句诚实文案，
     并接现成取消能力（只对 kind==='io' 的网络任务调 BF.jobs.abort），绝不谎称已取消。 */
  function _runBudget(p, getMs) {
    return new Promise(function (resolve, reject) {
      var t0 = Date.now(), settled = false;
      p.then(function (v) { settled = true; resolve(v); }, function (e) { settled = true; reject(e); });
      var stop = function () { if (iv) { iv(); iv = null; } };
      var _ioRunning = function () {
        try {
          if (!(BF.jobs && typeof BF.jobs.list === 'function')) return false;
          var running = BF.jobs.list() || [];
          for (var i = 0; i < running.length; i++) { if (running[i] && running[i].status === 'run' && running[i].kind === 'io') return true; }
        } catch (e) {}
        return false;
      };
      var tick = function () {
        if (settled) { stop(); return; }
        /* 顺延必须真的把基准时间往前挪：只在确认框 / 在途 io 期间「跳过检查」而不重置 t0，
           等框一关、请求一开始，下一拍就会拿「等待前」的时间差当场判超时 ——
           而用户只是刚确认完，操作其实才刚开始。 */
        if (BF.ask && BF.ask.busy && BF.ask.busy()) { t0 = Date.now(); return; }
        if (_ioRunning()) { t0 = Date.now(); return; }
        var ms = (typeof getMs === 'function') ? getMs() : (typeof getMs === 'number' ? getMs : 5000);
        if (Date.now() - t0 >= ms) {
          settled = true; stop();
          reject(new Error('已超预算（默认 ' + Math.round(ms / 1000) + 's），后台任务仍在执行，可在任务面板取消'));
          /* 只取消网络类在途任务；本地脚本无法抢占，输出里不谎称「已全部中断」 */
          try {
            var list = (BF.jobs && typeof BF.jobs.list === 'function') ? (BF.jobs.list() || []) : [];
            list.forEach(function (j) { if (j && j.status === 'run' && j.kind === 'io') { try { BF.jobs.abort(j.id); } catch (e) {} } });
          } catch (e) {}
        }
      };
      var iv = (BF.timers && BF.timers.interval) ? BF.timers.interval(tick, 200) : (function () {
        var id = setInterval(tick, 200);
        return function () { clearInterval(id); };
      })();
    });
  }
  /* 工作线程：纯计算脚本在 Worker 内执行；同步循环占工作线程，主线程可计时并终止。
     引用宿主能力的脚本保留主线程执行。 */
  var _activeWorker = null, _dslWorkerFinalize = null, _dslWorkerSettled = true;
  /* 宿主能力名：命中即保留主线程。注释与字符串先抹白。 */
  var _DSL_HOST_RE = /\b(?:BF|ctx|fetch|XMLHttpRequest|localStorage|sessionStorage|indexedDB|caches|window|document|navigator|location|globalThis|self|parent|top|frames|opener|origin|history|screen|alert|confirm|prompt|open|Notification|Worker|SharedWorker|ServiceWorker|importScripts|postMessage|requestAnimationFrame|cancelAnimationFrame|getComputedStyle|Image|Audio|WebSocket|EventSource|Element|Node|HTMLElement|DOMParser|XMLSerializer|FileReader|require)\b/;
  /* 循环形态：仅含循环的脚本需要可抢占执行。 */
  var _DSL_LOOP_RE = /\b(?:while|for)\b|\bdo\s*\{/;
  function _dslToWorker(src) {
    const s = _dslBlankNonCode(src);
    return !_DSL_HOST_RE.test(s) && _DSL_LOOP_RE.test(s);
  }
  /* 能力判定：Worker / Blob / URL.createObjectURL 齐备才启用。 */
  function _canWorker() {
    try {
      if (typeof Worker === 'undefined') return false;
      if (typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return false;
      return true;
    } catch (e) { return false; }
  }
  /* 工作线程源码：自包含，不引用主线程 BF。宿主参数一律为拒绝桩；
     print/log 转发回主线程输出，budget 转发回主线程调整时限。 */
  var _dslWorkerSource = [
    "self.onmessage=function(ev){var d=ev.data;if(d&&d.type==='init')run(d);};",
    "function txt(v){if(v===undefined)return 'undefined';if(v===null)return 'null';if(typeof v==='object'){try{return JSON.stringify(v);}catch(e){return String(v);}}return String(v);}",
    "function run(d){",
    "var cap=0;",
    "function emit(){if(cap>=2000)return;cap++;var a=[];for(var i=0;i<arguments.length;i++)a.push(txt(arguments[i]));self.postMessage({type:'print',text:a.join(' ')});}",
    "function budget(ms){if(typeof ms==='number'&&ms>0)self.postMessage({type:'budget',ms:ms});}",
    "var denyFn=function(){throw new Error('宿主能力在隔离执行中不可用');};",
    "var deny=new Proxy(denyFn,{get:function(){return deny;}});",
    "try{",
    "var fn=new Function('BF','ctx','args','fetch','XMLHttpRequest','localStorage','print','log','budget','window','globalThis','self','parent','top','\"use strict\";\\nreturn (async () => {'+d.body+'\\n})();');",
    "Promise.resolve(fn(deny,deny,d.args||{},deny,deny,deny,emit,emit,budget,deny,deny,deny,deny,deny)).then(function(r){try{self.postMessage({type:'done',ok:true,value:r});}catch(e){self.postMessage({type:'done',ok:true,value:txt(r)});}}).catch(function(e){self.postMessage({type:'done',ok:false,error:(e&&e.message)||String(e),stack:(e&&e.stack)?String(e.stack).split('\\n').slice(0,3).join('\\n'):''});});",
    "}catch(e){self.postMessage({type:'done',ok:false,error:(e&&e.message)||String(e),stack:(e&&e.stack)?String(e.stack).split('\\n').slice(0,3).join('\\n'):''});}",
    "}"
  ].join('\n');
  /* 主线程侧：起工作线程、跑预算计时；超预算 terminate 终止脚本。
     print 转发到脚本输出水槽，budget 调整当次时限。 */
  function _dslRunWorker(opts) {
    return new Promise(function (resolve, reject) {
      var worker, iv, t0, settled = false, curBudget = opts.budgetMs || 5000;
      var url;
      try {
        url = URL.createObjectURL(new Blob([_dslWorkerSource], { type: 'application/javascript' }));
        worker = new Worker(url);
      } catch (e) {
        var fberr = new Error('工作线程不可用，回退主线程执行');
        fberr.__workerFallback = true;
        reject(fberr);
        return;
      }
      _activeWorker = worker; _dslWorkerSettled = false; _dslWorkerFinalize = finalize;
      var cleanup = function () { if (iv) { try { iv(); } catch (e) {} iv = null; } if (url) { try { URL.revokeObjectURL(url); } catch (e) {} } };
      function finalize(ok, val, errMsg, stack, fallback) {
        if (settled) return; settled = true; cleanup();
        try { worker.terminate(); } catch (e) {}
        _activeWorker = null; _dslWorkerFinalize = null; _dslWorkerSettled = true;
        if (ok) resolve(val);
        else { var er = new Error(errMsg || '执行失败'); if (stack) er.stack = stack; if (fallback) er.__workerFallback = true; reject(er); }
      }
      worker.onmessage = function (ev) {
        var m = ev.data;
        if (m.type === 'print') { try { opts.onPrint(m.text); } catch (e) {} return; }
        if (m.type === 'budget') { if (typeof m.ms === 'number' && m.ms > 0) curBudget = Math.min(m.ms, 60000); return; }
        if (m.type === 'done') { if (m.ok) finalize(true, m.value); else finalize(false, undefined, m.error, m.stack); }
      };
      worker.onerror = function (e) { finalize(false, undefined, (e && e.message) || '工作线程运行错误', null, true); };
      var tick = function () {
        if (settled) return;
        if (BF.ask && BF.ask.busy && BF.ask.busy()) { t0 = Date.now(); return; }
        var ioRunning = false;
        try { if (BF.jobs && typeof BF.jobs.list === 'function') { var L = BF.jobs.list() || []; for (var i = 0; i < L.length; i++) { if (L[i] && L[i].status === 'run' && L[i].kind === 'io') { ioRunning = true; break; } } } } catch (e) {}
        if (ioRunning) { t0 = Date.now(); return; }
        if (Date.now() - t0 >= curBudget) {
          finalize(false, undefined, '已超预算（' + Math.round(curBudget / 1000) + 's），脚本已终止', null, false);
          return;
        }
      };
      iv = (BF.timers && BF.timers.interval) ? BF.timers.interval(tick, 200) : (function () { var id = setInterval(tick, 200); return function () { clearInterval(id); }; })();
      t0 = Date.now();
      try { worker.postMessage({ type: 'init', body: opts.body, args: opts.args }); }
      catch (e) { finalize(false, undefined, '参数无法传入工作线程，回退主线程执行', null, true); }
    });
  }
  /* 手动中断：工作线程脚本可直接 terminate；主线程脚本无抢占点。 */
  function _abortDslWorker(reason) {
    if (!_activeWorker || _dslWorkerSettled) return false;
    var w = _activeWorker; _activeWorker = null;
    try { w.terminate(); } catch (e) {}
    if (_dslWorkerFinalize) _dslWorkerFinalize(false, undefined, reason || '已手动中断（Ctrl+C）');
    return true;
  }
  async function execute(line, meta) {
    const _src = String(line || '');
    /* 每次执行先把程序化错误标记清空；出错时再于 catch 内挂上（供渲染层判失败，而非猜文案） */
    try { BF.dsl.lastError = null; } catch (e) {}
    if (_LOOP_RE.test(_dslBlankNonCode(_src))) return '检测到常见死循环写法（while(true)/for(;;) 等），已拒绝执行';
    /* 即时执行（js / REPL 裸表达式 / 编辑器脚本）同样过静态校验，
       与导入路径同一防线 —— 状态栏「校验通过」与执行拦截保持一致 */
    const _hits = _dslStaticCheck(_src, _permLevel());
    if (_hits.length) return '脚本包含受限调用：' + _hits.join('、') + '（已阻止执行）';
    /* 5 秒时限由 _runBudget 管理：确认框占用期间顺延，不再当作等人的上限 */
    /* 执行留痕：脚本运行写入 jobs（供运维台查看）。
       begin 必须放在「空行提前返回」之后：空行分支直接 return，走不到任何
       end/fail，任务条会永远停在「运行中」；放到这里则空行根本不产任务。 */
    let jid = null;
    try {
      _scriptEnter();
      const p = parseLine(line);
      if (p.type === 'empty') return '';
      try { if (BF.jobs && BF.jobs.begin) jid = BF.jobs.begin((meta && meta.name) || 'DSL 执行', { kind: 'async', detail: String(line).slice(0, 80) }); } catch (e) {}
      /* `> clip`：不执行命令，只把上一条结果的显示文本送剪贴板。
         故意不经过 _storeLast —— `> clip` 之后紧跟一条 `> clip` 复制的还是同一条，
         复制动作本身不该变成「上一条结果」。 */
      if (p.type === 'clip') {
        if (jid) { try { BF.jobs.end(jid); } catch (e) { BF.err.report('dsl.clip.job', e); } }
        if (!_lastResultText) return '没有可复制的结果（先执行一条命令，再 > clip）';
        const wr = await _clipWrite(_lastResultText);
        if (wr.ok) return '已复制到剪贴板：' + wr.n + ' 个字符';
        return '复制失败：剪贴板被浏览器挡了（非安全上下文或权限策略拒绝）；内容未写入。';
      }
      if (p.type === 'clip-reject') {
        if (jid) { try { BF.jobs.end(jid); } catch (e) { BF.err.report('dsl.clipReject.job', e); } }
        return '只支持 clip（把上一条结果送进剪贴板），不支持 > ' + (p.target || '');
      }
      if (p.type === 'meta') { const r = handleMeta(p.raw); if (jid) { try { BF.jobs.end(jid); } catch (e) {} } return _storeLast(typeof r === 'object' && r && r.then ? await r : r); }
      if (p.type === 'js' || (meta && meta.script)) {
        const ctx = buildContext(meta);
      /* 显式预算控制：脚本内可调 budget(ms) 延长/缩短当次执行时限（注入为 ctx 上的函数 + new Function 形参） */
      let _budgetMs = 5000;
      ctx.budget = function (ms) { if (typeof ms === 'number' && ms > 0) _budgetMs = ms; };
        /* REPL 单行表达式自动返回其值（终端惯例）：不以语句关键字开头的裸表达式包 return。
           尾分号要先剥掉再判——分号是控制台带过来的最常见手势，
           留着它当判据会让 `1+1;` 回 undefined，而 `1+1` 回 2，同一个答案两种脸。 */
        let body = (p.type === 'js' ? p.code : line);
        if (!(meta && meta.script) && p.type === 'js') {
          const trimmed = body.trim().replace(/;+\s*$/, '');
          const kw = /^(return|const|let|var|if|for|while|switch|function|class|async|await|throw|try|import|export|\/\/|\/\*|\{)/;
          if (trimmed && !kw.test(trimmed)) body = 'return (' + trimmed + ');';
        }
        /* 语言层：类型声明改写（int n = 5 → const n = 5）+ 浅层类型检查。
           开关可回退 —— 转换器只做定向替换，出问题时不应让你失去已有的脚本库。
           类型错误仅作提示，不阻断运行（诊断与执行分离）。 */
        let _typeHints = [];
        try {
          if (BF.lang && BF.settings.get('dslTypes') !== false) {
            const _tr = BF.lang.transform(body);
            body = _tr.code;
            _typeHints = _tr.errors || [];
          }
        } catch (e) { BF.err.report('dsl.lang', e); }
        /* 脚本体末值包装（REPL 惯例，三道保险见 _wrapScriptReturn 处说明） */
        if (meta && meta.script) body = _wrapScriptReturn(body);
        /* 裸 print/log 汇入输出通道：new Function 形参必须带上 print/log，
          否则脚本作者按终端惯例写的 print(...) 会落到 window.print
           （浏览器打印对话框）。ctx.print/ctx.log 本就映射到同一 _log 水槽，
           这两个名字直接递进脚本作用域，与 ctx 链共用一个出口。 */
        /* 把 window / globalThis / self / parent / top 都指到同一个替身：替身的
           localStorage 在只读档下就是「密钥键挡住、其余透传」的沙箱（与裸
           localStorage 同一份），在 data+ 档下等于真身 —— 这样
           window.localStorage 这类「换前缀绕过裸标识符」的写法在运行时直接失效，
           不靠静态正则兜底。其余属性透传真实全局，不影响正常脚本。 */
        const _g = (typeof globalThis !== 'undefined') ? globalThis : (typeof window !== 'undefined' ? window : {});
        const fakeWindow = new Proxy(_g, {
          get: function (t, prop) {
            if (prop === 'localStorage') return _net.localStorage;
            return Reflect.get(t, prop);
          }
        });
        const fn = new Function('BF', 'ctx', 'args', 'fetch', 'XMLHttpRequest', 'localStorage', 'print', 'log', 'budget', 'window', 'globalThis', 'self', 'parent', 'top', '"use strict";\nreturn (async () => {' + body + '\n})();');
        const args = (meta && meta.args) || {};
        /* 网络原语参数遮蔽（终端定位）：read 档下脚本内的 fetch/XMLHttpRequest
           引用指向抛错替身（提示去 perm data 授权），data 及以上是真身。
           localStorage 同样递进来：只读档下它指向「密钥键挡住、其余透传」的替身，
           免得闸门只装在受控通道上、旁边却开着一条裸通道。
           eval 不能作严格模式形参名（SyntaxError），
           且 eval/import 已由 read 档静态正则拦截，运行时遮蔽只补这三路。 */
        const _net = _netShadow(_permLevel());
        /* 类型提示先于执行结果呈现：诊断在前，结果在后，用户一眼能对上哪行有问题。
           不阻断运行 —— 类型标注是给人看的，诊断与执行必须分离。 */
        if (_typeHints.length) {
          for (let _i = 0; _i < _typeHints.length; _i++) {
            const _h = _typeHints[_i];
            const _txt = '第 ' + _h.line + ' 行 · 类型：' + _h.msg;
            /* 归一个水槽：类型提示与脚本 print 走同一条 ctx.print → _log → _sink 通路 */
            try { if (ctx && typeof ctx.print === 'function') ctx.print(_txt); } catch (e) {}
            try { if (BF.noti && BF.noti.warn) BF.noti.warn(_txt); } catch (e) {}
          }
        }
        /* 纯计算脚本（无宿主能力引用、含循环）进工作线程，同步死循环可被 terminate 终止；
           其余脚本保留主线程执行，维持 BF/ctx 同步返回值的契约。工作线程不可用则回退。 */
        let r;
        if (_canWorker() && _dslToWorker(body)) {
          try {
            r = await _dslRunWorker({
              body: body,
              args: args,
              onPrint: function (t) { try { ctx.print(t); } catch (e) {} },
              budgetMs: _budgetMs
            });
          } catch (wfErr) {
            if (wfErr && wfErr.__workerFallback) {
              r = await _runBudget(fn(CONSOLE_BF, ctx, args, _net.fetch, _net.XMLHttpRequest, _net.localStorage, ctx.print, ctx.log, ctx.budget, fakeWindow, fakeWindow, fakeWindow, fakeWindow, fakeWindow), function () { return _budgetMs; });
            } else { throw wfErr; }
          }
        } else {
          r = await _runBudget(fn(CONSOLE_BF, ctx, args, _net.fetch, _net.XMLHttpRequest, _net.localStorage, ctx.print, ctx.log, ctx.budget, fakeWindow, fakeWindow, fakeWindow, fakeWindow, fakeWindow), function () { return _budgetMs; });
        }
        /* 返回值不拦截（终端定位）：DSL 执行用户本人的 JS，权限等同 DevTools
           控制台。全局/函数引用原样返回交给用户 —— 真正边界是权限档位
           （read/data/full/secrets 管控受认可能力面）、_secretGate 与
           Self-XSS 横幅，不是返回值黑名单。 */
        if (jid) { try { BF.jobs.end(jid); } catch (e) {} }
        return _storeLast(r);
      }
      if (p.type === 'cmd') {
        if (jid) { try { BF.jobs.end(jid); } catch (e) {} }
        /* settings 密钥读等处理器返回 Promise（_secretGate 是
           异步确认）—— 必须 await：不 await 会把 Promise 原样渲染成
           [object Promise]，用户既看不到结果也看不到拒绝信息。
           与 meta 分支同口径。 */
        return _storeLast((p.result && typeof p.result.then === 'function') ? await p.result : p.result);
      }
      return '';
    } catch (e) {
      if (jid) { try { BF.jobs.fail(jid, e.message); } catch (e2) {} }
      /* 保留字符串返回（终端语义），但同一处再挂 lastError 供程序化判定 */
      try { BF.dsl.lastError = { ok: false, message: (e && e.message) || String(e), name: (e && e.name) || 'Error' }; } catch (e2) {}
      return _storeLast((meta && meta.name ? '脚本「' + meta.name + '」错误: ' : 'js 错误: ') + e.message + (e && e.stack ? '\n' + String(e.stack).split('\n').slice(0, 3).join('\n') : ''));
    } finally { _scriptExit(); }
  }
  /* 遗留权限迁移：localStorage 里可能残留跨会话写入且无复位的权限档位。
   首次进入时读出并清除，保证用户不会带着上次会话的授权进场 ——
   这是「仅本次会话」承诺成立的前提。迁移函数必须在这里真的调用，
   定义了不调用等于没有迁移。 */
  _migrateLegacyPerm();

  /* ---- 输出格式化：对象 → 表格 / 折叠；数组 → 行列表 ---- */
  function formatResult(r) {
    if (r === undefined || r === null) return 'undefined';
    if (typeof r === 'string') return r;
    if (typeof r === 'number' || typeof r === 'boolean') return String(r);
    if (r && typeof r.then === 'function') return '[Promise（未等待，可用 await）]';
    if (Array.isArray(r)) {
      if (!r.length) return '[]';
      if (r.length === 1 && typeof r[0] === 'object' && r[0] !== null) return _fmtObject(r[0]);
      return r.map(function (x) { return typeof x === 'object' && x !== null ? _fmtObject(x) : String(x); }).join('\n');
    }
    if (typeof r === 'object') return _fmtObject(r);
    return String(r);
  }
  function _fmtObject(o) {
    try {
      const keys = Object.keys(o);
      if (!keys.length) return '{}';
      return keys.map(function (k) {
        let v = o[k];
        if (typeof v === 'object' && v !== null) { try { v = JSON.stringify(v); if (v.length > 60) v = v.slice(0, 57) + '…'; } catch (e) { v = String(v); } }
        return k + ': ' + v;
      }).join('\n');
    } catch (e) { return String(o); }
  }
  /* 渲染前对结果做「有限等待」：脚本返回的是 Promise 时，给一个短超时（2s）避免把终端挂死；
     到点仍未 settle 就如实显示 [Promise（未等待，可用 await）]。编辑器 / REPL 两条渲染路径共用。 */
  async function _fmtResult(r) {
    if (r && typeof r.then === 'function') {
      let done = false, val, err = null;
      /* 处理器先挂上再竞速：2s 到点先返回的话，Promise 之后才 reject 不能变成未捕获拒绝 */
      const tracked = r.then(function (v) { done = true; val = v; }, function (e) { done = true; err = e; });
      await Promise.race([tracked, new Promise(function (res) { BF.timers.timeout(res, 2000); })]);
      if (!done) return '[Promise（未等待，可用 await）]';
      if (err) return 'Promise 失败：' + ((err && err.message) || String(err));
      return formatResult(val);
    }
    return formatResult(r);
  }

  return { parseLine, execute, formatResult, formatResultAwaited: _fmtResult, setUiSink: setUiSink, abortWorker: _abortDslWorker, chatAsk: function (q) { return _chatTurn(q, false); }, chatSay: function (q) { return _chatTurn(q, true); }, chatStop: _chatStop, chatAbort: chatAbort, chatBusy: function () { return !!_chatCtrl; }, chatState: function () { return { on: _chatOn, turns: Math.ceil(_chatHist.length / 2) }; }, agentSay: function (q) { return _agentTurn(q, true); }, agentStop: _agentStop, agentState: function () { return { on: _agentOn, turns: Math.ceil(_agentHist.length / 2) }; }, t: _T, buildContext, listScripts, getScript, saveScript, removeScript, runScript, syncCommands, DEFAULT_SCRIPTS, validateScript: _validateScript, CONSOLE_BF: CONSOLE_BF, SAFE_BF: CONSOLE_BF, tools: TOOLS, permLevel: _permLevel, grantPerm: _grantPerm, secretGate: _secretGate, isScript: isScript, isSecretSettingKey: _isSecretSettingKey, isSecretLSKey: _isSecretLSKey, CMDS: CMDS, META_CMDS: META_CMDS };
})();

/* ============================================================
   BF.hub —— 能力中枢（能力的唯一实现）

   硬约束：本模块只做「注册 + 调度 + 权限校验」，业务逻辑一律留在各能力的
   run 里。一旦业务沉进来，hub 会变成新的「什么都往里塞」的黑洞 ——
   BF.dsl.tools 的 30+ 工具全塞在一个对象里，正是要避免的前车之鉴。

   为什么需要它：命令注册表（66 条）、DSL 工具集（30+）、权限判定三者是平行发展且
   互相不知情的 —— 同一种能力有多个入口、多套权限逻辑（commands.run 曾零鉴权，
   TOOLS.* 走 _permWrite）。收编到一处后，所有调用路径共用同一个检查点。

   能力契约：
     id     唯一标识，点分层级（'shelf.tag' / 'read.next'）
     label  人类可读名，供界面展示
     cap    能力声明，权限唯一来源。缺失一律拒绝（见 invoke）
     args   参数签名，供 UI 参数收集与 AI 生成脚本参考
     ret    返回类型，供类型标注
     scope  'single' | 'batch'，batch 类自动进入命令注册表
     run    业务实现
   ============================================================ */
BF.hub = (function () {
  var _caps = new Map();

  /* 能力目录：cap → 说明。集中在此，避免各处硬编码字符串。
     前缀通配的必要性：命令列表在运行时不可静态枚举 ——
     BF.dsl.syncCommands 会为每个启用的脚本注册 dsl:run:*，BF.modules 的
     _wire() 会自动注册插件声明的 commands[]。逐条标注在原理上无法完备。 */
  var CAPS = {
    'store:read':       '读取书架、笔记、书签、划线、生词',
    'store:write':      '写入书架元数据、笔记、书签、划线、生词',
    'settings:write':   '修改普通设置项',
    'settings:raw':     '整体覆盖设置（绕过单键粒度）',
    'secrets:write':    '写入 AI 密钥',
    'secrets:read':     '读取 AI 密钥明文',
    'cmd:navigate':     '界面导航类命令',
    'cmd:read':         '阅读控制类命令',
    'cmd:write':        '写入类命令',
    'cmd:danger':       '破坏性命令（删除、重置、覆盖）',
    'net':              '发起网络请求'
  };

  /* 能力判定：支持精确匹配与前缀通配（'cmd:read.*' 命中已注册的 cmd:read）。
     未在目录中登记的能力一律视为「未声明」—— 宁可误拒也不误放。 */
  function _resolveCap(cap) {
    if (!cap) return null;
    if (Object.prototype.hasOwnProperty.call(CAPS, cap)) return cap;
    var i = cap.indexOf('.*');
    if (i > 0) {
      var base = cap.slice(0, i);
      if (Object.prototype.hasOwnProperty.call(CAPS, base)) return base;
    }
    return null;
  }
  /* 声明该能力的脚本是否已获得授权。授权由 DSL 的三级权限体系判定，
     中枢不重复实现提权流程，只消费结论。
     分档要点：破坏性能力（cmd:danger）要求 full，data 档不够 ——
     data 的语义是「改数据」，而 delete/reset 的后果是不可逆，不是可改回来。 */
  function _capAllowed(cap) {
    if (!cap) return false;
    var base = _resolveCap(cap);
    if (!base) return false;
    try {
      if (!BF.dsl || !BF.dsl.permLevel) return true;   /* 非脚本上下文（界面 / 内部调用）不设限 */
      var lv = BF.dsl.permLevel();
      if (lv === 'secrets') return true;               /* secrets 为最高档，覆盖全部 */
      if (base === 'secrets:read') return false;       /* 独立于 full：未显式授权永不放行 */
      if (base === 'secrets:write') return lv === 'full';
      if (base === 'cmd:danger') return lv === 'full';
      if (base === 'store:write' || base === 'settings:write' || base === 'settings:raw' || base === 'cmd:write') {
        return lv === 'data' || lv === 'full';
      }
      return true;   /* 读取类与导航类：只读档即可 */
    } catch (e) { return false; }
  }

  function register(cap) {
    if (!cap || !cap.id) return null;
    /* 与 BF.commands.register 同口径拒绝覆盖（撞名由 register 直接拒）：
       重复登记若静默换掉 _caps 里的 run，注册表与命令视图就成了两处
       事实、彼此漂移。确需更新先 unregister 再注册。 */
    if (_caps.has(cap.id)) {
      BF.log && BF.log.warn('能力「' + cap.id + '」已登记，拒绝覆盖（保留先登记者；确需更新请先 unregister）');
      return null;
    }
    var c = {
      id: cap.id,
      label: cap.label || cap.id,
      keywords: cap.keywords || '',
      cat: cap.cat || '通用',
      cap: cap.cap || null,
      args: Array.isArray(cap.args) ? cap.args : [],
      ret: cap.ret || null,
      scope: cap.scope === 'batch' ? 'batch' : 'single',
      /* 契约字段走白名单拷贝：新字段必须在这里登记，否则注册时写了也会被丢掉
         （代理内核读 selfUndo 来决定「还要不要再包一条撤销」，读不到就会重复登记）。
         confirm 同理：invoke 用 c.confirm === false 判断「能力自带确认」，白名单漏了它，
         已声明 confirm:false 的四个危险能力（重置/清缓存/删备份/导入）就会在
         自身确认之外再叠一层中枢通用确认，连弹两窗——这正是注释里承诺要避免的。 */
      selfUndo: !!cap.selfUndo,
      confirm: cap.confirm === false ? false : undefined,
      run: cap.run
    };
    _caps.set(c.id, c);
    /* 同步进命令注册表 —— 命令系统是中枢的一个视图，
       而不再是独立的能力来源。 */
    try {
      if (typeof BF.commands !== 'undefined' && BF.commands.register) {
        BF.commands.register({
          id: c.id, label: c.label, keywords: c.keywords, cat: c.cat,
          run: function () {
            /* 命令视图是中枢能力的转发壳：失败必须把 error 说出来——
               若把 {ok:false,error} 吞掉只回 true/false，权限不足 /
               能力未声明 cap / 执行异常从命令视图触发时
               既不给成功也不给失败，用户只看到「点了没反应」
               （data.clearCache 在 read 档下正是这条）。
               成功仍归各能力自己报（见 data.clearCache / clearBackups 的 run），
               转发壳不越权替它们报喜；「已取消」是良性的不作为，
               文案交给能力自己，这里不当错误播报。
               invoke 可能同步返回对象、也可能返回 Promise，
               两条都归一化。 */
            var r = BF.hub.invoke(c.id);
            var settle = function (res) {
              if (res && res.ok === false && res.error && res.error !== '已取消') BF.noti.error(res.error);
              return !!(res && res.ok !== false);
            };
            return (r && typeof r.then === 'function') ? r.then(settle) : settle(r);
          }
        });
      }
    } catch (e) { BF.err.report('hub.register.cmd', e); }
    return c;
  }
  /* 取消登记。刻意不动 BF.commands —— 命令表里那条
     的所有权归原注册模块（或收编前的历史命令），中枢只收回自己
     的「能不能调」判定，不越权拆别人的视图。 */
  function unregister(id) {
    return _caps.delete(id);
  }

  /* ---- 命令批量收编 ----
     历史命令只有命令表、没有能力标注，BF.commands.run 因而零鉴权。
     这里按 id 前缀批量推导 cap 并登记到中枢，它们与手写能力走同一条调度路径。

     前缀 → 能力的推导规则（集中在此，便于审阅）：
       nav. / help. / sys. / stats. / noti. / ws. / find. / plugins. / dev.
         → cmd:navigate   纯导航或开关，不改数据
       read.* 导航子集（continue/prev/next/first/last/goto/toc/search/
         closeDrawer/remain）
         → cmd:navigate   纯导航（见 CAP_RULES 内拆档注释）
       read.* 其余（bookmark/export/fontUp/fontDown/lhUp/lhDown/
         microread）/ theme. / scene. / tts. / book.
         → settings:write 改设置或写阅读状态
       import. / data.export* / base.export / base.backup / workshop.author
         → cmd:write      新增数据或导出文件
       data.reset / data.clearCache / data.import / base.reset
         → cmd:danger     不可逆操作（另见显式危险确认）
       ai.
         → store:read     AI 相关命令读数据后交给网关
       其余无法归类者一律不登记 —— 默认拒绝优于猜测放行。 */
  var CAP_RULES = [
    [/^(nav|help|sys|stats|noti|ws|find|plugins|dev|app)\./, 'cmd:navigate'],
    /* read.* 族拆档：整族一律 settings:write 等于「翻章/跳目录/继续阅读」
       也要 data 档——这些是纯导航（开面板、切章、跳进度），不产生新的
       用户数据。导航子集定为 cmd:navigate（read 档即可调）；真正改状态的
       read.*（书签、导出、字号/行距、微读开关）仍留 settings:write。 */
    [/^read\.(?:continue|prev|next|first|last|goto|toc|search|closeDrawer|remain)$/, 'cmd:navigate'],
    [/^(read|theme|scene|tts|book)\./, 'settings:write'],
    /* data.autobackup 写入新的备份快照（会占存储配额），与导出同级；
       不在本条列出就会落到兜底之外被判「未归类」而误拒。 */
    [/^(import|data\.(export|autobackup)|base\.export|base\.backup|workshop\.author)\b/, 'cmd:write'],
    /* 加密导出 / 自包含包导出：同样是导出，落在 data.exportEnc / data.exportSelfPkg
       这两个带后缀的 id 上；上一条 data\.(export|autobackup) 因 \b 匹配不到它们，
       需要本条接住。 */
    [/^data\.export/, 'cmd:write'],
    /* 危险规则刻意独立成条：data.import / data.reset / data.clearCache 三个 id
       互不相干，不会被上一条写规则误捕（写规则只匹配 data.export / data.autobackup）。 */
    [/^(data\.reset|data\.clearCache|data\.import|base\.reset)\b/, 'cmd:danger'],
    [/^ai\./, 'store:read'],
    /* dsl: 脚本命令：run 体是任意用户 JS，与 adoptCommands 对 dsl:*
       的定级（cmd:danger）一致。adoptCommands 只在启动时收编一次，
       启动后激活的脚本命令走 CONSOLE_BF.commands.run 的回退路径
       （该路径委托 capForId），没有这条规则会被误拒。 */
    [/^dsl:/, 'cmd:danger'],
    [/^(diag|base|workshop)\./, 'cmd:navigate']   /* 面板入口：只开面板，危险动作在面板内另有确认 */
  ];
  function capForId(id) {
    for (var i = 0; i < CAP_RULES.length; i++) {
      if (CAP_RULES[i][0].test(id)) return CAP_RULES[i][1];
    }
    return null;
  }
  /* 把已注册的命令收编进中枢。返回 {ok, skipped} 便于观测。
     刻意不改动命令自身的 run —— 命令表仍是「做什么」的真相，
     中枢只接管「能不能调」的判定，两层职责不混。 */
  function adoptCommands(opt) {
    opt = opt || {};
    var res = { ok: 0, skipped: [] };
    try {
      var list = (BF.commands && BF.commands.list) ? BF.commands.list() : [];
      list.forEach(function (c) {
        if (!c || !c.id) return;
        if (_caps.has(c.id)) return;                       /* 已收编，不重复 */
        if (/^dsl:/.test(c.id)) {                          /* 脚本命令：run 体是任意用户 JS */
          _caps.set(c.id, {
            id: c.id, label: c.label || c.id, keywords: c.keywords || '',
            cat: c.cat || '脚本', cap: 'cmd:danger', args: [], ret: null,
            scope: 'single', run: c.run
          });
          res.ok++; return;
        }
        var cap = capForId(c.id);
        if (!cap) { res.skipped.push(c.id); return; }
        _caps.set(c.id, {
          id: c.id, label: c.label || c.id, keywords: c.keywords || '',
          cat: c.cat || '通用', cap: cap, args: [], ret: null,
          scope: 'single', run: c.run
        });
        res.ok++;
      });
    } catch (e) { BF.err.report('hub.adoptCommands', e); }
    return res;
  }

  /* 唯一调度出口。所有调用路径（脚本 / 命令总线）都经此，
     权限判定因此不存在「某个入口忘了查」的漏洞。 */
  function invoke(id, args, opts) {
    var c = _caps.get(id);
    if (!c) return { ok: false, error: '未登记的动作：' + id };
    if (typeof c.run !== 'function') return { ok: false, error: '动作未实现：' + id };
    /* 无 cap 声明的能力默认拒绝：动态注册的命令（dsl:run:*、插件 commands[]）
       无法逐条标注，与其漏标即放行，不如强制走显式声明。 */
    if (!c.cap) {
      return { ok: false, error: '动作「' + id + '」未声明 cap，按默认拒绝处理（请为其补充 cap）' };
    }
    if (!_capAllowed(c.cap)) {
      return { ok: false, error: '能力「' + id + '」需要 ' + c.cap + ' 授权（当前权限：' + _permName() + '）' };
    }
    /* 危险能力在执行前二次确认，且确认失败即中止，不做部分写入。
       cap 声明 confirm:false 表示能力内部自带确认
       （如 BF.ask danger=2，文案区分操作语义）——
       中枢通用确认不再叠加，避免同一操作连弹两窗。 */
    if ((opts && opts.confirm !== false) && c.confirm !== false && c.cap.indexOf('cmd:danger') === 0) {
      var label = c.label || id;
      if (typeof BF.ask !== 'undefined' && BF.ask.confirm) {
        return BF.ask.confirm({
          title: '确认执行：' + label,
          body: '该操作用于不可逆修改，请确认后继续。',
          confirmText: '确认执行', danger: 2, op: id
        }).then(function (ok) {
          if (!ok) return { ok: false, error: '已取消' };
          return _runCap(c, args);
        });
      }
    }
    return _runCap(c, args);
  }
  function _permName() {
    try { return (BF.dsl && BF.dsl.permLevel) ? BF.dsl.permLevel() : 'read'; } catch (e) { return 'read'; }
  }
  function _runCap(c, args) {
    /* 能力自己回 {ok:false,...} 时外层不能报成功：命令视图、代理与 DSL 都读外层 ok，
       一律包成 {ok:true} 就等于在转发那一刻把「中枢说失败了」抹掉。
       只认显式的 ok 字段，别的形状不猜。 */
    function wrap(v) { return (v && v.ok === false) ? v : { ok: true, value: v }; }
    try {
      var r = c.run.apply(c, Array.isArray(args) ? args : (args === undefined ? [] : [args]));
      return (r && typeof r.then === 'function')
        ? r.then(wrap,
               function (e) { BF.err.report('hub.invoke:' + c.id, e); return { ok: false, error: (e && e.message) || String(e) }; })
        : wrap(r);
    } catch (e) {
      BF.err.report('hub.invoke:' + c.id, e);
      return { ok: false, error: (e && e.message) || String(e) };
    }
  }

  function get(id) { return _caps.get(id) || null; }
  function has(id) { return _caps.has(id); }
  function list(opt) {
    var arr = Array.from(_caps.values());
    if (opt && opt.scope) arr = arr.filter(function (c) { return c.scope === opt.scope; });
    return arr;
  }
  /* 供 DSL / AI 查询「我能做什么」：把已注册能力连同其可用状态一并列出 */
  function describe(opt) {
    return list(opt).map(function (c) {
      return { id: c.id, label: c.label, cap: c.cap, args: c.args, ret: c.ret, scope: c.scope, selfUndo: !!c.selfUndo, allowed: _capAllowed(c.cap) };
    });
  }
  return { register, unregister, invoke, get, has, list, describe, CAPS: CAPS, _resolveCap: _resolveCap,
           _capAllowed: _capAllowed, adoptCommands: adoptCommands, capForId: capForId };
})();

/* ============================================================
   中枢能力收编（首批 10 项）

   选取标准：优先覆盖权限破口——read 默认档可改设置、写删便签、
   删书、跑 data.reset；收编后这四条路径不再是绕过 _permWrite 的
   独立入口，而是中枢的一个调用方，破口结构性消失（无需逐处打补丁）。

   剩余命令与 TOOLS 按同规则分批收编：一次全改 96 个端点，
   出错时无法定位影响面。
   ============================================================ */
(function () {
  var H = BF.hub;
  if (!H) return;

  /* ---- 破坏性（cap: cmd:danger，要求 full + 执行前二次确认） ---- */
  H.register({
    id: 'data.reset', label: '重置全部数据', keywords: 'reset 重置 清空 危险', cat: '数据',
    /* 能力内部自带确认（BF.bk.resetAll 的 danger 3）时，
       中枢通用确认不叠加——两条都在就会连弹两窗，
       且第一窗的文案比第二窗弱、还没有任何事实支撑。 */
    cap: 'cmd:danger', confirm: false, args: [], ret: null, scope: 'single',
    run: function () {
      /* 重置的确认与 danger 档位统一由 BF.bk.resetAll 落地 */
      return BF.bk.resetAll();
    }
  });
  H.register({
    id: 'data.clearCache', label: '清空缓存', keywords: 'cache 缓存 清理', cat: '数据',
    /* 确认由能力内部经 BF.ask danger=2 完成
       （文案区分「可重建临时数据」与「自动备份」），
       中枢通用确认（confirm:false）不再叠加。 */
    cap: 'cmd:danger', confirm: false, args: [], ret: 'dict[str,int]', scope: 'single',
    run: function () {
      /* 反馈绑在能力上：中枢的转发视图只报成败，
         成功/取消/失败的吐司文案只能住在能力 run 里，
         否则「清空缓存」做完就是静默的、失败也是静默的。 */
      return BF.store.clearTransients().then(function (r) {
        if (r && r.cancelled) { BF.noti.info('已取消'); return r; }
        BF.noti.success('已清空缓存（' + ((r && r.cleared) || 0) + ' 项临时数据）');
        return r;
      }).catch(function () { BF.noti.warn('清空失败'); });
    }
  });
  H.register({
    id: 'data.clearBackups', label: '删除自动备份', keywords: 'backup 备份 删除 清空 自动备份', cat: '数据',
    /* 自动备份不是临时数据 —— 独立入口、独立确认，
       文案明示「删除后无法找回」（能力内部 BF.ask
       danger=2），中枢通用确认不叠加。 */
    cap: 'cmd:danger', confirm: false, args: [], ret: 'dict[str,int]', scope: 'single',
    run: function () {
      /* 吐司由能力自己播报；中枢转发视图只报成败，不重复文案。 */
      return BF.store.clearBackups().then(function (r) {
        if (r && r.cancelled) { BF.noti.info('已取消'); return r; }
        BF.noti.success('已删除全部自动备份（删除后无法找回）');
        return r;
      }).catch(function () { BF.noti.warn('删除失败'); });
    }
  });
  H.register({
    id: 'data.import', label: '导入备份', keywords: 'import 备份 恢复', cat: '数据',
    /* 确认内聚于 BF.bk.importFile（同名导入 danger 1 / 覆盖当前 danger 2）——
       那里才知道文件解析结果，中枢此时连用户要选哪个文件都不知道。 */
    cap: 'cmd:danger', confirm: false, args: [], ret: null, scope: 'single',
    run: function () {
      var fi = document.createElement('input');
      fi.type = 'file'; fi.accept = '.json,application/json';
      fi.onchange = function () { if (fi.files && fi.files[0]) BF.bk.importFile(fi); };
      fi.click();
      return '已打开文件选择器';
    }
  });

  /* ---- 应用数据写（cap: store:write，要求 data） ---- */
  H.register({
    id: 'shelf.batchDelete', label: '批量删除书籍', keywords: 'delete 删除 批量 书', cat: '书架',
    cap: 'store:write', scope: 'batch',
    args: [{ name: 'ids', type: 'list[str]', required: true }],
    ret: 'dict',
    run: function (ids) {
      ids = (ids || []).filter(Boolean);
      if (!ids.length) return { ok: false, error: '未指定书籍 ID' };
      /* 批删必须走带确认的唯一入口 BF.app.deleteBooks，
         不得零确认直调删除定时器 */
      if (BF.app && BF.app.deleteBooks) return BF.app.deleteBooks(ids).then(function (done) { return { ok: !!done, deleted: done ? ids.length : 0 }; });
      return { ok: false, error: '批量删除入口不可用' };
    }
  });
  /* ---- 回收站：列出 / 恢复 / 彻底删除 / 清空 ----
     彻底删除与清空各自内聚确认（danger 3，问前先验取数据层真值），
     中枢不重复问，所以两条都带 confirm: false；档位仍要 full ——
     权限轴与确认轴是两件事，谁也不替代谁。 */
  H.register({
    id: 'trash.list', label: '列出回收站', keywords: 'trash 回收站 删除 恢复', cat: '数据',
    cap: 'store:read', args: [], ret: 'list[dict]',
    run: function () {
      return BF.trash.list().map(function (x) { return { id: String(x.meta.id), title: x.meta.title, deletedAt: x.deletedAt }; });
    }
  });
  H.register({
    id: 'trash.restore', label: '从回收站恢复书籍', keywords: 'trash restore 回收站 恢复 书', cat: '数据',
    cap: 'store:write', args: [{ name: 'id', type: 'str', required: true }], ret: 'dict', scope: 'single',
    run: function (id) { return BF.trash.restore(id).then(function (ok) { return { ok: !!ok, restored: !!ok }; }); }
  });
  H.register({
    id: 'trash.purge', label: '彻底删除回收站里的书', keywords: 'trash purge 回收站 彻底删除 不可恢复', cat: '数据',
    cap: 'cmd:danger', confirm: false, args: [{ name: 'id', type: 'str', required: true }], ret: 'dict', scope: 'single',
    run: function (id) { return BF.trash.purge(id).then(function (ok) { return { ok: !!ok, cancelled: !ok }; }); }
  });
  H.register({
    id: 'trash.empty', label: '清空回收站', keywords: 'trash empty 回收站 清空 彻底删除', cat: '数据',
    cap: 'cmd:danger', confirm: false, args: [], ret: 'dict', scope: 'batch',
    run: function () { return BF.trash.empty().then(function (n) { return { ok: n > 0, purged: n, cancelled: n === 0 }; }); }
  });
  H.register({
    id: 'notes.remove', label: '删除便签', keywords: 'note 便签 删除', cat: '便签',
    /* selfUndo：能力内部已经走 BF.act.run 登记了自己的撤销（见 BF.notes.remove），
       代理就只调用、不再挂第二条——挂两条的话第二次 Ctrl+Z 会把同一条便签再插一遍。 */
    cap: 'store:write', selfUndo: true, args: [{ name: 'id', type: 'str', required: true }], ret: null,
    run: function (id) { return BF.notes.remove(id); }
  });
  H.register({
    id: 'notes.update', label: '更新便签', keywords: 'note 便签 编辑', cat: '便签',
    cap: 'store:write',
    args: [{ name: 'id', type: 'str', required: true }, { name: 'patch', type: 'dict', required: true }], ret: null,
    run: function (id, patch) { return BF.notes.update(id, patch || {}); }
  });
  H.register({
    id: 'cfg.set', label: '修改设置', keywords: 'settings 设置 改', cat: '数据',
    cap: 'settings:write', args: [{ name: 'key', type: 'str', required: true }, { name: 'value', type: 'any', required: true }], ret: null,
    /* 写密钥（PRIV_KEYS）不能只凭 settings:write 能力（data 档即可）——
       那是密钥写入的零鉴权旁路。必须 full 档（或 secrets 档）
       + 统一鉴权（BF.ask danger=3 需回复 y），与 TOOLS.settings.set 同政策。 */
    run: function (k, v) {
      if (BF.dsl && BF.dsl.isSecretSettingKey && BF.dsl.isSecretSettingKey(k)) {
        var lv = BF.dsl.permLevel ? BF.dsl.permLevel() : 'read';
        if (lv !== 'full' && lv !== 'secrets') {
          return Promise.resolve({ ok: false, error: '敏感设置（' + k + '）需 full 权限（perm full）' });
        }
        return BF.dsl.secretGate('cfg.set("' + k + '")').then(function (ok) {
          if (!ok) return { ok: false, error: '密钥写入被拒绝（需回复 y 确认）' };
          BF.settings.set(k, v);
          /* 密钥写入的返回值不回显明文：若返回值带 BF.settings.get(k)，
             脚本侧可经返回值直接读回刚写入的密钥。返回值只确认写入
             结果，明文仍仅经 cfg.secret（secrets:read
             能力 + 统一鉴权）通道按需读取。 */
          return { ok: true, written: true };
        });
      }
      /* 'theme' 早在合并成单一 appearance 时就不是设置键：拦住别落死键，指回正道 */
      if (k === 'theme') return { ok: false, error: 'theme 已并入 appearance：换档请用 BF.theme.set("档名") / BF.theme.cycle()' };
      BF.settings.set(k, v); return BF.settings.getCopy(k);
    }
  });
  H.register({
    id: 'cfg.setMany', label: '批量修改设置', keywords: 'settings 设置 批量', cat: '数据',
    cap: 'settings:write', args: [{ name: 'obj', type: 'dict[str,any]', required: true }], ret: 'dict',
    /* 批量内含密钥键时逐键走 cfg.set 同款鉴权 */
    run: function (obj) {
      var keys = Object.keys(obj || {});
      var out = { ok: [], bad: [] };
      return Promise.all(keys.map(function (k) {
        return Promise.resolve(H.invoke('cfg.set', [k, obj[k]])).then(function (r) {
          (r.ok ? out.ok : out.bad).push(r.ok ? k : { k: k, error: r.error });
        });
      })).then(function () { return out; });
    }
  });
  H.register({
    id: 'cfg.setTheme', label: '切换外观', keywords: 'theme 主题 外观 换', cat: '外观',
    cap: 'settings:write', args: [{ name: 'name', type: 'str', required: false }], ret: 'str',
    /* 带档名 = 指定档，不带 = 循环。两条都必须走 BF.skin.*：合法与否由登记表裁决，
       并且要重染。写 settings 里的 'theme' 键是死路（合并后真键只有 appearance，
       且 settings.set 不触发重染），脚本侧照这条路走只会哑着不吭声。 */
    run: function (name) {
      if (name === undefined || name === null || name === '') { BF.theme.cycle(); return BF.skin.get(); }
      if (!BF.skin.set(String(name))) return { ok: false, error: '没有这档外观：' + name + '（可用 ' + (BF.SKINS || []).map(function (k) { return k + '·' + BF.skin.label(k); }).join(' / ') + '）' };
      return BF.skin.get();
    }
  });

  /* ---- 敏感设置读取（cap: secrets:read，独立于 full） ----
     _capAllowed 对 secrets:read 的判定优先级高于 full：
     未显式授权（perm secrets）永不放行。密钥明文通道只有
     本能力——settings.get 直连不得返回密钥明文，否则 read 档
     脚本就能读到 aiApiKey，secrets:read 档位形同虚设。
     密钥集合以 BF.store.PRIV_KEYS 为唯一来源（手写键清单
     必然漂移，aiEndpoint/aiModel 这类键最容易被漏），
     且读取经统一鉴权（BF.ask danger=3 需回复 y）。 */
  H.register({
    id: 'cfg.secret', label: '读取敏感设置明文', keywords: 'secret key 密钥 aiApiKey mimoApiKey', cat: '设置',
    cap: 'secrets:read',
    args: [{ name: 'key', type: 'str', required: true }], ret: 'str', scope: 'single',
    run: function (key) {
      /* PRIV_KEYS 是 Set（BF.store 真源）：用数组 API（indexOf/join）会抛
         TypeError（s.indexOf is not a function），run 同步段即死，
         hub.invoke _runCap 兜成 {ok:false,error:'…indexOf is not
         a function'} —— ctx.settings.secret→cfg.secret 显式明文通道失效，
         技术错误还会外泄给脚本方。必须用 Set API；双形态防御走
         instanceof 守卫（真源理论上不应是数组，守卫防漂移）。 */
      var PRIV = BF.store.PRIV_KEYS instanceof Set ? BF.store.PRIV_KEYS : new Set(BF.store.PRIV_KEYS || []);
      if (!PRIV.has(key)) {
        throw new Error('仅支持敏感键（' + Array.from(PRIV).join('/') + '），其余设置走 settings.get');
      }
      return BF.dsl.secretGate('cfg.secret("' + key + '")').then(function (ok) {
        if (!ok) throw new Error('密钥访问被拒绝（需回复 y 确认）');
        var v = BF.settings.get(key);
        return v === undefined ? '' : String(v);
      });
    }
  });

  /* ---- 读取类（只读档即可） ---- */
  H.register({
    id: 'rd.chapter', label: '跳转到章节', keywords: 'chapter 章节 跳', cat: '阅读',
    cap: 'cmd:read', args: [{ name: 'idx', type: 'int', required: true }], ret: 'promise',
    run: function (i) { return BF.reader.gotoChapter(i); }
  });
  H.register({
    id: 'bk.now', label: '立即备份', keywords: 'backup 备份 快照', cat: '数据',
    cap: 'store:read', args: [], ret: 'promise',
    run: function () { return BF.bk.autoNow(); }
  });

  BF.log && BF.log.info('能力注册：' + H.list().length + ' 项');
})();


/* ============================================================
   BF.lang —— DSL 类型声明转换（语言层）

   ============================ 硬约束 ============================
   本模块【不是 parser】。它只做一件事：把「类型名 变量 = 表达式」
   改写成等价 JS，并在改写前做一次浅层类型检查。

   为什么不做 parser：保留 JS 语法即保留 await / 箭头函数 / 闭包 /
   模板字符串等全部能力，而实现成本从数天降到数百行。语言上限不受影响。

   安全策略：宁可漏转（保持 JS 写法照常运行），绝不误转（改变语义）。
   触发条件严格 —— 必须是「行首出现已知类型名 + 标识符 + =」，
   且严格避开字符串、注释、正则、对象字面量键、属性访问等一切歧义位置。

   全部 30 条类型用例与 12 项语义安全检查随本模块配套，改动本模块必须全部复跑。
   ================================================================= */
BF.lang = (function () {
  var BASIC = {
    int:   { kind: 'number', coerce: 'int' },
    float: { kind: 'number', coerce: 'float' },
    bool:  { kind: 'bool' },
    str:   { kind: 'string' },
    null:  { kind: 'null' }
  };
  var GENERIC = { list: { kind: 'list' }, tuple: { kind: 'list' }, dict: { kind: 'dict' }, set: { kind: 'set' }, slice: { kind: 'slice' } };

  /* 泛型参数用配平括号切分，不可用 [^\]]* —— 后者会在嵌套泛型第一个右括号处截断 */
  function splitGeneric(w) {
    var i = w.indexOf('[');
    if (i < 0) return null;
    var depth = 0, p = i;
    for (; p < w.length; p++) {
      if (w[p] === '[') depth++;
      else if (w[p] === ']') { depth--; if (depth === 0) return (p === w.length - 1) ? { base: w.slice(0, i), arg: w.slice(i + 1, p) } : null; }
    }
    return null;
  }
  function isTypeName(w) {
    if (!w) return false;
    w = String(w).replace(/\s+/g, '');
    if (w.charAt(w.length - 1) === '?') w = w.slice(0, -1);
    if (Object.prototype.hasOwnProperty.call(BASIC, w)) return true;
    if (Object.prototype.hasOwnProperty.call(GENERIC, w)) return true;
    var g = splitGeneric(w);
    return !!(g && Object.prototype.hasOwnProperty.call(GENERIC, g.base));
  }
  function parseType(src) {
    src = String(src || '').trim();
    var nullable = false;
    if (src.charAt(src.length - 1) === '?') { nullable = true; src = src.slice(0, -1).trim(); }
    var g = splitGeneric(src);
    if (g && Object.prototype.hasOwnProperty.call(GENERIC, g.base)) return { name: g.base, kind: GENERIC[g.base].kind, nullable: nullable };
    if (Object.prototype.hasOwnProperty.call(BASIC, src)) {
      var b = BASIC[src];
      return { name: src, kind: b.kind, coerce: b.coerce, nullable: nullable };
    }
    return null;
  }
  function checkAndCoerce(ti, valueText) {
    var raw = String(valueText == null ? '' : valueText).trim();
    var kind = ti.kind;
    if (raw === 'null') {
      if (ti.nullable) return { ok: true, expr: 'null' };
      if (kind === 'null') return { ok: true, expr: 'null' };
      return { ok: false, error: '声明为 ' + ti.name + '（不可空），初始值不能是 null' };
    }
    if (kind === 'list' || kind === 'tuple') {
      if (raw.charAt(0) === '[') return { ok: true, expr: raw };
      return { ok: false, error: '声明为 ' + ti.name + '，但右侧不是列表字面量' };
    }
    if (kind === 'dict' || kind === 'set') {
      if (raw.charAt(0) === '{' || raw.charAt(0) === '[') return { ok: true, expr: raw };
      return { ok: false, error: '声明为 ' + ti.name + '，但右侧不是字典/集合字面量' };
    }
    if (kind === 'null') return { ok: false, error: '只能声明为 null 的变量其初始值必须是 null' };
    if (kind === 'bool') {
      if (raw === 'true' || raw === 'false') return { ok: true, expr: raw };
      return { ok: false, error: '声明为 bool，右侧应为 true / false' };
    }
    if (kind === 'string') {
      var q = raw.charAt(0);
      if (q === '"' || q === "'" || q === '`') return { ok: true, expr: raw };
      if (/^-?\d+(\.\d+)?$/.test(raw) || raw === 'true' || raw === 'false') return { ok: true, expr: 'String(' + raw + ')' };
      return { ok: false, error: '声明为 str，右侧不是字符串字面量' };
    }
    if (kind === 'number') {
      if (/^-?\d+$/.test(raw)) return { ok: true, expr: raw };
      if (/^-?\d*\.\d+$/.test(raw)) {
        if (ti.coerce === 'int') return { ok: false, error: '声明为 int，但右侧是小数字面量（会被截断，请显式改用 float）' };
        return { ok: true, expr: raw };
      }
      if (/^["'`]-?\d+(\.\d+)?["'`]$/.test(raw)) {
        if (ti.coerce === 'int' && /\./.test(raw.slice(1, -1))) return { ok: false, error: '声明为 int，但字符串内容是小数' };
        return { ok: true, expr: 'Number(' + raw + ')' };
      }
      if (raw === 'true' || raw === 'false') return { ok: false, error: 'bool 与数字不可互相转换（Python 中 bool 是 int 子类，此处刻意偏离）' };
      var c0 = raw.charAt(0);
      if (c0 === '"' || c0 === "'" || c0 === '`') return { ok: false, error: '声明为 ' + ti.name + '，右侧却是字符串字面量' };
      if (c0 === '[' || c0 === '{') return { ok: false, error: '声明为 ' + ti.name + '，右侧却是容器字面量' };
      return { ok: true, expr: raw };
    }
    return { ok: true, expr: raw };
  }
  function lineOf(src, idx) {
    var l = 1;
    for (var i = 0; i < idx && i < src.length; i++) if (src[i] === '\n') l++;
    return l;
  }
  /* 扫描行首声明。必须跳过字符串、模板串、注释、正则。 */
  function scan(src) {
    var out = [], i = 0, n = src.length, lineStart = 0;
    while (i < n) {
      var c = src[i];
      if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
      if (c === '/' && src[i + 1] === '*') { i += 2; while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++; i += 2; continue; }
      if (c === '"' || c === "'" || c === '`') {
        var qt = c; i++;
        while (i < n) { if (src[i] === '\\') { i += 2; continue; } if (src[i] === qt) { i++; break; } i++; }
        continue;
      }
      if ('ivldstfbn'.indexOf(c) >= 0) {
        var atLineStart = true;
        for (var q2 = lineStart; q2 < i; q2++) { if (!/\s/.test(src[q2])) { atLineStart = false; break; } }
        if (atLineStart) {
          var j = i; while (j < n && /\s/.test(src[j])) j++;
          var rest = src.slice(j);
          var mm = rest.match(/^(var\s+)?([A-Za-z_]\w*)/);
          if (mm) {
            var k = mm[0].length, typeFull = mm[2];
            while (k < rest.length && /[ \t]/.test(rest[k])) k++;
            if (rest.charAt(k) === '[') {
              var depth = 0, p = k;
              while (p < rest.length) {
                if (rest.charAt(p) === '[') depth++;
                else if (rest.charAt(p) === ']') { depth--; if (depth === 0) { p++; break; } }
                p++;
              }
              typeFull = rest.slice(0, p); k = p;
            }
            while (k < rest.length && /[ \t]/.test(rest[k])) k++;
            if (rest.charAt(k) === '?') { typeFull += '?'; k++; while (k < rest.length && /[ \t]/.test(rest[k])) k++; }
            var nm = rest.slice(k).match(/^([A-Za-z_$][\w$]*)\s*(=\s*)?/);
            if (nm && isTypeName(typeFull.replace(/\s+/g, ''))) {
              out.push({
                start: i, end: j + k + nm[0].length, mutable: !!mm[1],
                typeText: typeFull.replace(/\s+/g, ''), name: nm[1],
                hasInit: !!nm[2], valStart: nm[2] ? j + k + nm[0].length : -1
              });
            }
          }
        }
      }
      if (c === '\n') lineStart = i + 1;
      i++;
    }
    return out;
  }
  /* 读取初始值表达式：跳到行尾的 , ; 之前，跳过嵌套括号与字符串 */
  function readValue(src, from) {
    var depth = 0, i = from, n = src.length;
    while (i < n) {
      var c = src.charAt(i);
      if (c === '"' || c === "'" || c === '`') {
        var q = c; i++;
        while (i < n) { if (src.charAt(i) === '\\') { i += 2; continue; } if (src.charAt(i) === q) { i++; break; } i++; }
        continue;
      }
      if (c === '(' || c === '[' || c === '{') { depth++; i++; continue; }
      if (c === ')' || c === ']' || c === '}') { depth--; i++; continue; }
      if (depth === 0 && (c === ';' || c === '\n' || c === ',')) break;
      if (depth === 0 && c === '/' && (src.charAt(i + 1) === '/' || src.charAt(i + 1) === '*')) break;
      i++;
    }
    var end = i;
    if (src.charAt(end) === ';') end++;
    return { text: src.slice(from, i), end: end };
  }
  function transform(src) {
    src = String(src == null ? '' : src);
    var decls = scan(src);
    if (!decls.length) return { code: src, errors: [], count: 0 };
    var errors = [], pieces = [], cursor = 0;
    for (var d = 0; d < decls.length; d++) {
      var dec = decls[d], info = parseType(dec.typeText);
      if (!info) continue;
      if (!dec.hasInit) {
        pieces.push(src.slice(cursor, dec.start));
        errors.push({ line: lineOf(src, dec.start), msg: '声明「' + dec.name + '」没有初始值，类型未校验（已按 let 处理）' });
        pieces.push('let ' + dec.name + ' = undefined;');
        cursor = dec.end;
        continue;
      }
      var val = readValue(src, dec.valStart);
      var valueText = val.text.trim();
      pieces.push(src.slice(cursor, dec.start));
      cursor = dec.start;
      if (!valueText) {
        errors.push({ line: lineOf(src, dec.start), msg: '声明「' + dec.name + '」没有初始值，类型未校验（已按 let 处理）' });
        pieces.push('let ' + dec.name + ' = undefined;');
        cursor = val.end;
        continue;
      }
      var chk = checkAndCoerce(info, valueText);
      var needSemi = !/^\s*[;,]/.test(src.slice(val.end));
      var kw = dec.mutable ? 'let' : 'const';
      if (!chk.ok) {
        errors.push({ line: lineOf(src, dec.start), msg: '声明「' + dec.name + '」：' + chk.error });
        /* 类型不符仍输出合法 JS：类型标注是诊断，不得让脚本因语法层问题无法运行 */
        pieces.push(kw + ' ' + dec.name + ' = ' + valueText + (needSemi ? ';' : ''));
      } else {
        pieces.push(kw + ' ' + dec.name + ' = ' + chk.expr + (needSemi ? ';' : ''));
      }
      cursor = val.end;
    }
    pieces.push(src.slice(cursor));
    return { code: pieces.join(''), errors: errors, count: decls.length };
  }
  return { transform: transform, parseType: parseType, isTypeName: isTypeName, TYPES: BASIC, GENERICS: GENERIC };
})();

/* ============================================================
   工具面板（番茄钟 + 白噪音，两栏合一） =======
   「番茄钟」与「白噪音」合为「工具」小面板：专注 / 环境音 两栏，
   浮窗只此一份。计时状态机（BF.focus）与噪音合成（BF.noise）
   均在各自模块内，本面板只承载界面。 */
BF.tools = (function () {
  const PANEL_ID = 'tools-panel';
  const S = { sec: 'focus' };        /* 栏：focus=专注 | noise=环境音 */

  function ensure() {
    let el = document.getElementById(PANEL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = PANEL_ID;
    el.className = 'pk-panel';
    el.innerHTML =
      '<header class="pk-panel__head" style="height:44px;padding:0 var(--sp-4)"><span class="pk-panel__title" style="font-size:14px">工具</span><div class="pk-panel__actions"><button class="pk-panel__close" data-tools-close data-panel-close aria-label="关闭">' + BF.dom.ICON_CLOSE + '</button></div></header>' +
      '<nav class="pane-tabs" role="tablist" style="padding:0 var(--sp-3);border-bottom:1px solid var(--border)"><button class="pane-tab" role="tab" data-tools-sec="focus" aria-selected="false">专注</button><button class="pane-tab" role="tab" data-tools-sec="noise" aria-selected="false">环境音</button></nav>' +
      '<div class="pk-panel__body" id="tools-body" style="padding:var(--sp-3);overflow-y:auto"></div>';
    document.body.appendChild(el);
    el.querySelectorAll('[data-tools-close]').forEach(function (b) {
      b.addEventListener('click', function () { BF.sheet.close(PANEL_ID); });
    });
    /* 专注/环境音 tab 点击处理器：切 S.sec + render 重绘
       （render 同步 aria-selected 与 body 内容）。按钮为原生
       <button role=tab>，Tab 可聚焦、回车/空格激活，与 BF.diag /
       BF.base 的 pane-tab 委托模式同语义。 */
    el.querySelectorAll('[data-tools-sec]').forEach(function (b) {
      b.addEventListener('click', function () {
        const sec = b.dataset.toolsSec;
        if (sec) { S.sec = sec; render(); try { BF.sheet.setSec(PANEL_ID, sec); } catch (e) {} }
      });
    });
    return el;
  }

  /* 专注栏：番茄钟 */
  function viewFocus() {
    return '<div class="ws-hint" style="font-size:12px;color:var(--text-weak);line-height:1.6;margin-bottom:8px">番茄钟保持专注节奏：点「开始」计时，专注结束自动进入 5 分钟休息；可在设置里开启「专注时自动白噪音」。</div>' +
      '<div style="text-align:center;padding:10px 0">' +
      '<div class="focus-time" id="focus-time" style="font-family:var(--mono);font-size:44px;font-weight:700">25:00</div>' +
      '<div class="focus-label" id="focus-label" style="font-size:13px;color:var(--text-weak);margin:6px 0 14px">专注</div>' +
      '<div style="display:flex;gap:8px;justify-content:center;flex-wrap:wrap">' +
      '<button class="btn btn-sm primary" id="focus-toggle" data-focus-toggle>开始</button>' +
      '<button class="btn btn-sm" data-focus-reset>重置</button>' +
      '<button class="btn btn-xs" data-focus-mode="1500">专注 25</button>' +
      '<button class="btn btn-xs" data-focus-mode="3000">专注 50</button>' +
      '<button class="btn btn-xs" data-focus-mode="300">短休 5</button>' +
      '<button class="btn btn-xs" data-focus-mode="900">长休 15</button>' +
      '<button class="btn btn-xs" data-focus-noise>自动白噪音：' + (BF.settings.get('focusAutoNoise') ? '开' : '关') + '</button>' +
      '</div>' +
      /* 今日完成轮数 + 长休节奏提示（真源 FOCUS_CYCLES 日账） */
      (function () {
        let _done = 0;
        try { _done = BF.focus._cyclesToday ? BF.focus._cyclesToday() : 0; } catch (e) {}
        return '<div class="focus-cycles">今日完成 <b>' + _done + '</b> 轮专注' +
          (_done >= 4 ? ' · 已进入长休节奏' : ' · 满 4 轮自动长休 15 分钟') + '</div>';
      })() +
      '</div></div>';
  }

  /* 环境音栏：白噪音 */
  function viewNoise() {
    /* 播放态必须在渲染时就取，不能只在点击回调里补 class：
       否则重开面板、切栏、专注自动播放（BF.focus._applyAutoNoise）之后
       按钮会显示「未播放」，而声音其实在响。 */
    const playing = BF.noise.active();
    return '<div class="ws-hint" style="font-size:12px;color:var(--text-weak);line-height:1.6;margin-bottom:8px">白噪音营造安静背景：选一种环境音即可播放（首次需联网加载），拖动下方滑块调音量，再点一次停止。</div>' +
      '<div class="noise-grid" style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
      BF.noise.SOUNDS.map(function (s) {
        return '<button class="btn btn-sm" data-noise="' + s.id + '" aria-pressed="' +
          (playing.indexOf(s.id) >= 0 ? 'true' : 'false') + '">' + s.label + '</button>';
      }).join('') + '</div>' +
      '<div style="margin-top:10px"><input type="range" min="0" max="1" step="0.05" value="0.5" style="width:100%" data-noise-vol aria-label="音量"/></div>';
  }

  function render() {
    const body = document.getElementById('tools-body');
    if (!body) return;
    document.querySelectorAll('[data-tools-sec]').forEach(function (b) {
      const on = b.dataset.toolsSec === S.sec;
      /* 激活态只写 aria-selected 一个（.active / aria-current 都是多余）：
         CSS 只认它，读屏也只认它。 */
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    /* 诚实声明：工具面板含 AI 相关入口（环境音
       引擎 / 专注联动），密钥边界声明固定在
       面板顶部，随两栏重绘常驻。 */
    const notice = '<div style="font-size:11px;color:var(--warning-ink);line-height:1.6;margin:0 0 8px">程序不含任何内置 API 密钥；密钥只存本机设置，导出设置或备份即等于交出密钥。</div>';
    if (S.sec === 'noise') {
      body.innerHTML = notice + viewNoise();
    } else {
      body.innerHTML = notice + viewFocus();
      /* 计时文字 / 按钮态由 BF.focus 统一渲染（与顶栏 chip 同源） */
      BF.focus._render();
    }
  }

  /* sheet.open 对已开面板会重跑 render，这里不必再自带一层
     「已开就 render」（同一条事实写两份必漂移）。
     sec 交给账本记：入口按钮据此区分「换栏」与「关面板」。 */
  function open(sec) {
    if (sec) S.sec = sec;
    ensure();
    BF.sheet.open(PANEL_ID, { sec: S.sec, render: render });
  }
  /* 入口语义（顶栏 chip / 更多菜单 / 微读栏）：正在看这一栏才收，否则换栏。
     必须走 open()：面板骨架由 ensure() 现场生成，绕开它 sheet 找不到节点、静默失败。 */
  function toggle(sec) {
    if (BF.sheet.closable(PANEL_ID, sec || S.sec)) { BF.sheet.close(PANEL_ID); return false; }
    open(sec); return true;
  }

  function isSec(sec) { return S.sec === sec; }

  return { open: open, toggle: toggle, render: render, state: S, isSec: isSec, PANEL_ID: PANEL_ID };
})();

/* ============================================================
   工作台面板（五面板合一） ====================
   基地（数据资产）/ 运维台 / 阅读统计 / 通知中心 / 后台任务
   合为「工作台」一枚大面板：
   左侧栏导航七栏 —— 数据 / 日志 / 进程 / 诊断 / 统计 / 任务 / 通知。
   运维台的「日志」「进程」升为顶级栏，其余子页（概览 / 存储 / 工具）
   收进「诊断」栏；基地的四个子页（总览 / 备份 / 存储 / 环境）整体进
   「数据」栏。视图函数仍在 BF.base / BF.diag 内（render 改为
   栏内容函数），此处只负责骨架与栏间调度。 */
BF.workbench = (function () {
  const PANEL_ID = 'workbench-panel';
  const S = { sec: 'data' };         /* 栏：data/logs/runtime/diag/stats/tasks/noti */
  const NAV = [
    { id: 'data', label: '数据' },
    { id: 'logs', label: '日志', badge: 'logs' },
    { id: 'runtime', label: '进程' },
    { id: 'diag', label: '诊断' },
    { id: 'stats', label: '统计' },
    { id: 'tasks', label: '任务' },
    { id: 'noti', label: '通知' },
  ];
  const esc = function (s) { return BF.dom.esc(s); };

  function ensure() {
    let el = document.getElementById(PANEL_ID);
    if (el) return el;
    el = document.createElement('div');
    el.id = PANEL_ID;
    el.className = 'pk-panel';
    el.innerHTML =
      '<header class="pk-panel__head"><span class="pk-panel__title">工作台</span>' +
      /* 头部健康胶囊与版本：原运维台头部件（全局信号，随栏保留） */
      '<span class="diag-hpill" id="diag-health" data-diag-tabgo="logs" title="错误健康度（点击查看日志）" style="cursor:pointer"><i></i><span>检测中…</span></span>' +
      '<span class="diag-hpill" title="当前版本">V' + esc(BF.version || '') + '</span>' +
      '<div class="pk-panel__actions"><button class="pk-panel__close" data-wb-close data-panel-close aria-label="关闭">' + BF.dom.ICON_CLOSE + '</button></div></header>' +
      '<div style="display:flex;flex:1;min-height:0">' +
      '<nav role="navigation" aria-label="工作台栏" style="width:150px;flex:0 0 150px;border-right:1px solid var(--border);padding:var(--sp-2);overflow-y:auto">' +
      NAV.map(function (n) {
        return '<button class="wb-nav__item" data-wb-sec="' + n.id + '">' +
          '<span>' + esc(n.label) + '</span>' +
          (n.badge ? '<span class="pane-tab__n" data-diag-tabn="' + n.badge + '" hidden></span>' : '') +
          '</button>';
      }).join('') + '</nav>' +
      '<div class="pk-panel__body" id="wb-body" style="flex:1;min-width:0;padding:var(--sp-4);overflow-y:auto"></div>' +
      '</div>' +
      '<footer class="pk-panel__foot" id="wb-foot"></footer>';
    document.body.appendChild(el);
    el.querySelectorAll('[data-wb-close]').forEach(function (b) {
      b.addEventListener('click', function () { BF.sheet.close(PANEL_ID); });
    });
    /* 左栏七栏导航点击处理器：切 S.sec + render 重绘
       （render 内 paintNav/paintFoot 与各栏内容渲染，与
       data-diag-tab / data-base-tab 委托链「切状态 + 重绘」
       同语义）。按钮为原生 <button>，Tab 可聚焦、回车/空格激活。 */
    el.querySelectorAll('[data-wb-sec]').forEach(function (b) {
      b.addEventListener('click', function () {
        const sec = b.dataset.wbSec;
        if (sec) { S.sec = sec; render(); try { BF.sheet.setSec(PANEL_ID, sec); } catch (e) {} }
      });
    });
    return el;
  }

  /* 左栏激活态：只写 aria-current，配色由 .wb-nav__item[aria-current="page"] 承担。
     不直接改 style.background/color/fontWeight——内联声明的优先级高于
     一切类选择器，皮肤（素）与主题档都覆盖不动它，切档时左栏颜色会留在旧值。 */
  function paintNav() {
    document.querySelectorAll('[data-wb-sec]').forEach(function (b) {
      b.setAttribute('aria-current', b.dataset.wbSec === S.sec ? 'page' : 'false');
    });
  }

  /* 底栏随栏切换：数据栏给备份快捷动作，诊断栏给修复 / 回基地，
     其余栏只有关闭。动作按钮全部走既有事件委托（data-base-a /
     data-diag-t / data-diag-gobase），不新增绑定路径。 */
  function paintFoot() {
    const f = document.getElementById('wb-foot');
    if (!f) return;
    let acts = '';
    if (S.sec === 'data') {
      acts = '<button class="btn btn-sm primary" data-base-a="backup">立即备份</button>' +
        '<button class="btn btn-sm" data-base-a="export">导出备份</button>';
    } else if (S.sec === 'diag') {
      /* 图标与标签取自 BF.diag 导出（单源），与运维台底栏一致 */
      acts = '<button class="btn btn-sm" data-diag-t="repair">' + (BF.diag && BF.diag.ICON_FIX || '') + '数据修复</button>' +
        '<button class="btn btn-sm" data-diag-gobase="overview">' + (BF.diag && BF.diag.ICON_BASE || '') + '打开基地</button>';
    }
    /* 诚实声明 + 统一 close 委托：底栏「关闭」带 data-panel-close
       走文档级委托，innerHTML 重绘后依然可点（就地绑监听会随重绘丢失）；
       声明常驻底栏。 */
    f.innerHTML = acts + '<span class="topbar-spacer"></span>' +
      '<span style="font-size:11px;color:var(--warning-ink)">内置 API 密钥仅限本个人版本使用；导出/分享/上传即泄露</span>' +
      '<button class="btn btn-sm" data-wb-close data-panel-close>关闭</button>';
  }

  /* 统计栏：只出骨架，内容渲染由 BF.statsPanel 承担 */
  function renderStats() {
    const body = document.getElementById('wb-body');
    if (!body) return;
    body.innerHTML =
      '<div class="stats-nums" id="stats-nums" style="font-size:12px;color:var(--text-dim);margin-bottom:8px"></div>' +
      /* 热力窗口切换 + CSV 导出控件（激活态 aria-pressed，样式走 CSS 类） */
      '<div class="stat-ctrl">' +
      '<h4 style="font-size:11px;color:var(--text-weak);margin:0" id="stat-days-title">近 14 天</h4>' +
      '<div class="stat-ctrl__btns">' +
      '<button class="btn btn-xs stat-range-btn" data-stat-range="14" aria-pressed="true">14 天</button>' +
      '<button class="btn btn-xs stat-range-btn" data-stat-range="30" aria-pressed="false">30 天</button>' +
      '<button class="btn btn-xs stat-range-btn" data-stat-range="90" aria-pressed="false">90 天</button>' +
      '<button class="btn btn-xs" data-stat-csv>导出 CSV</button>' +
      '</div></div>' +
      '<div class="stat-days" id="stat-days" style="display:flex;gap:3px;align-items:flex-end;height:60px"></div>' +
      '<div id="goal-display" style="margin-top:12px;padding-top:10px;border-top:1px solid var(--border)"></div>' +
      /* 今日专注块骨架（内容由 BF.statsPanel 渲染） */
      '<div id="stat-focus" style="margin-top:10px;padding-top:8px;border-top:1px solid var(--border)"></div>' +
      '<h4 style="font-size:11px;color:var(--text-weak);margin:12px 0 6px">各书阅读时长</h4>' +
      '<div id="stats-books"></div>' +
      /* 时长口径如实写明（回收站/彻底删除后的归属） */
      '<div class="stat-scope">时长口径：书移入回收站后，历史时长仍计入总时长与按书列表；彻底删除后按书记录移除，已计入的日账与总时长不变。</div>';
    if (BF.statsPanel && BF.statsPanel.render) BF.statsPanel.render();
  }

  /* 任务栏：只出骨架，内容渲染由 BF.topStatus.paintTasksBody 承担 */
  function renderTasks() {
    const body = document.getElementById('wb-body');
    if (!body) return;
    body.innerHTML = '<div id="bf-tasks-body" style="font-size:12px;min-height:60px"></div>';
    if (BF.topStatus && BF.topStatus.paintTasksBody) BF.topStatus.paintTasksBody();
  }

  /* 通知栏：只出骨架，内容区整体滚动，渲染由 BF.notiCenter.render 承担 */
  function renderNoti() {
    const body = document.getElementById('wb-body');
    if (!body) return;
    body.innerHTML =
      '<div id="noti-center-body"></div>' +
      '<div style="display:flex;gap:6px;margin-top:8px"><button class="btn btn-xs" data-noti-clear>清空</button></div>';
    if (BF.notiCenter && BF.notiCenter.render) BF.notiCenter.render();
  }

  function render() {
    /* F-07：每栏切换都刷新健康胶囊，不再只在诊断栏更新 */
    try { if (BF.diag && BF.diag.paintHealth) BF.diag.paintHealth(); } catch (e) {}
    paintNav();
    paintFoot();
    if (S.sec === 'data') {
      if (BF.base && BF.base.render) BF.base.render();
    } else if (S.sec === 'logs' || S.sec === 'runtime') {
      if (BF.diag && BF.diag.render) {
        BF.diag.state.tab = S.sec;
        BF.diag.render();
      }
    } else if (S.sec === 'diag') {
      if (BF.diag && BF.diag.render) {
        /* 回到诊断栏：复原最后停留的子页（不落在已升格的日志 / 进程上） */
        BF.diag.state.tab = (BF.diag.sub && BF.diag.sub()) || 'overview';
        BF.diag.render();
      }
    } else if (S.sec === 'stats') {
      renderStats();
    } else if (S.sec === 'tasks') {
      renderTasks();
    } else if (S.sec === 'noti') {
      renderNoti();
    }
  }

  /* 顶栏 chip 重定向到已开面板时靠的就是「已开也重跑 render」（BF.sheet 账本承担），
     所以这里没有已开分支。open() 只收 sec：全部调用
     （顶栏 chip / wsUI 壳 / diag 路由 / base 路由）均只传 sec。 */
  function open(sec) {
    if (sec) S.sec = sec;
    ensure();
    BF.sheet.open(PANEL_ID, { sec: S.sec, render: render });
  }
  /* 入口语义：栏对得上才关（顶栏「阅读统计」停在通知栏时是切栏，不是关面板）。
     走 open() 而不是 sheet.open()：工作台骨架由 ensure() 现场生成。 */
  function toggle(sec) {
    if (BF.sheet.closable(PANEL_ID, sec || S.sec)) { BF.sheet.close(PANEL_ID); return false; }
    open(sec); return true;
  }

  function close() { BF.sheet.close(PANEL_ID); }
  function isSec(sec) { return S.sec === sec; }
  function isDiagSec() { return S.sec === 'logs' || S.sec === 'runtime' || S.sec === 'diag'; }

  return { open: open, toggle: toggle, close: close, render: render, state: S, isSec: isSec, isDiagSec: isDiagSec, PANEL_ID: PANEL_ID };
})();

/* ============================================================
   工具 / 工作台 外部契约壳 =================
   ws-* 四枚方法名转发壳：浮窗功能已收进上述两枚面板，此处只保留
   方法名契约（DSL 预置脚本、SAFE_BF 代理、顶栏
   chip 都在直接调用这些名字），转发到合并后的面板——
   既有调用点一行不改、调用不报错、入口不双份。
   转发语义：目标栏已开则关，否则开（或切到对应栏）。 */
BF.wsUI = (function () {
  /* 开关判据只在 BF.sheet 一处（账本 + 栈顶 + 栏位），
     这里不重复写一份，只留「入口 → 面板 + 栏」的映射。 */
  function entry(panel, sec) {
    if (!panel || !panel.toggle) return false;
    return panel.toggle(sec);
  }
  return {
    toggleFocus: function () { return entry(BF.tools, 'focus'); },
    toggleNoise: function () { return entry(BF.tools, 'noise'); },
    toggleStats: function () { return entry(BF.workbench, 'stats'); },
    openNotiCenter: function () { return entry(BF.workbench, 'noti'); },
  };
})();

