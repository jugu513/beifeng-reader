/* === BF.agent END === */

BF.boot = {
  /* 自包含离线包的数据恢复：包内 HTML 带着 window.__BF_SELFPKG__，
     本地没有任何数据时把它写回 localStorage/IDB，之后一切照常。
     刻意做成「一次性导入」而不是常驻兜底——用户之后正常用浏览器存储，
     不该每次启动都被包里的旧数据覆盖。 */
  restoreSelfPkg() {
    const p = window.__BF_SELFPKG__;
    if (!p || p.version !== 1) return false;
    try {
      const existing = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
      if (existing && existing.length) {
        BF.log.info('已有本地书籍，跳过离线包导入（不清空现有数据）');
        return false;
      }
      let _lsFail = 0;
      for (const k in (p.store || {})) { if (BF.store.lsSet(k, p.store[k]) !== true) _lsFail++; }
      /* 正文走 IDB（与 library.getChapterText 的读法一致） */
      const put = (async function () {
        for (const bid in (p.chapters || {})) {
          const list = p.chapters[bid] || [];
          const recs = [];
          for (let i = 0; i < list.length; i++) {
            if (!list[i]) continue;
            recs.push({ id: bid + '_' + i, bookId: bid, idx: i, content: await BF.lz.compress(list[i]) });
          }
          if (recs.length) await BF.store.idbPutAll(BF.store.K.CHAPTERS, recs);
        }
        for (const bid in (p.titles || {})) {
          await BF.store.idbPutAll(BF.store.K.CHAPTER_TITLES, [{ id: bid, bookId: bid, titles: p.titles[bid] || [] }]);
        }
      })();
      window.__BF_SELFPKG_RESTORE__ = put;
      put.then(function () {
        BF.log.info('离线包数据已导入：' + (p.books || []).length + ' 本书');
        var _msg = '离线包数据已就绪（' + (p.books || []).length + ' 本书）· 数据来源：自包含离线包，新增内容不会写回 zip';
        if (_lsFail) BF.noti && BF.noti.warn(_msg + '；但有 ' + _lsFail + ' 项配置没写进去（存储空间不足）');
        else BF.noti && BF.noti.success(_msg);
        try { BF.app.renderHome(); BF.app.renderBookshelf(); } catch (e) { BF.err.report('render.afterOfflineImport', e); }
      }).catch(function (e) {
        BF.err.report('selfpkg.restore', e);
        BF.noti && BF.noti.error('离线包正文导入未完成：' + ((e && e.message) || '未知错误') + '，可改用备份恢复');
      });
      BF.log.info('离线包：已写入本地存储，' + (p.books || []).length + ' 本书' + (_lsFail ? '（失败 ' + _lsFail + ' 项）' : ''));
      return true;
    } catch (e) { BF.err.report('selfpkg.restore', e); return false; }
  },
  run() {
    BF.err.hook();
    BF.boot.restoreSelfPkg();
    BF.settings.load();
    /* 主题事件启动期兜底监听：
       BF.theme.apply() 在 _enter（含 modules.start → reader.core 注册 THEME 监听）之前执行，
       启动早期那次 emit 无监听就会每次冷启动刷一条「bus.emit 无监听：theme/changed」warn。
       在 apply 之前注册一个幂等兜底监听（不做样式重绘，只消费事件消除告警）：
       reader.core 就绪后真正消费仍走 reader.core 的监听，两者不冲突。 */
    try {
      BF.bus.on(BF.EVENTS.THEME, function () { /* 启动期兜底消费，避免无监听告警 */ });
    } catch (e) {}
    /* 启动期断言 —— DEFAULTS 与 settings.get 差集。load() 已把缺省键补齐，
       此处若仍有缺失说明 load 被绕过或 DEFAULTS 新增键未同步，直接告警留痕。 */
    try {
      const _d = BF.settings.DEFAULTS || {};
      const _cur = BF.settings.all ? BF.settings.all() : {};
      const _missing = Object.keys(_d).filter(function (k) { return _cur[k] === undefined; });
      if (_missing.length) BF.log.warn('设置缺省键缺失：' + _missing.join(', ') + '（load 未补齐，检查 DEFAULTS 同步）');
    } catch (e) { BF.err.report('selfcheck.settingsDefaults', e); }
    /* 存储键一致性断言。
       K 表与调用方若对同一个键名大小写漂移（如 'autobackups' vs 'AUTOBACKUPS'），
       _snapshot 就排除不掉备份自身（体积超线性膨胀打爆配额），
       并连带 clearCache 清不掉、顶栏数据状态永远认为无备份 —— 表现多处、
       根因一个字符。断言把这类漂移挡在启动期，而不是等到配额耗尽才发现。 */
    try {
      const _k = BF.store.K || {};
      const _dup = {};
      for (const _name in _k) {
        const _v = _k[_name];
        if (typeof _v !== 'string' || !_v) continue;
        if (Object.prototype.hasOwnProperty.call(_dup, _v) && _dup[_v] !== _name) {
          BF.log.warn('存储键重复：K.' + _name + ' 与 K.' + _dup[_v] + ' 同为 "' + _v + '"（大小写漂移会导致读写错位）');
        } else _dup[_v] = _name;
      }
      /* 局部存储中若同时存在大小写两种形态的自动备份键，提示用户可用旧数据仍在但需重新生成 */
      try {
        const _upper = BF.store.PREFIX + 'AUTOBACKUPS';
        if (typeof localStorage !== 'undefined' && localStorage.getItem(_upper) != null) {
          BF.log.warn('检测到旧键名自动备份（bf_AUTOBACKUPS）。历史版本的备份会因键名统一而不可见，' +
            '如需找回可在运维台导出备份后重新导入；新备份自本次起正常生效。');
          /* 这条只在「用户以为备份丢了」时出现：只进日志等于没人看得见。每次会话提示一次。 */
          let _told = false;
          try { _told = sessionStorage.getItem('bf_oldkeys_told') === '1'; } catch (_) {}
          if (!_told) {
            try { sessionStorage.setItem('bf_oldkeys_told', '1'); } catch (_) {}
            BF.noti && BF.noti.warn('检测到旧版本备份键：历史备份暂不可见，可在运维台导入备份后恢复；新备份不受影响');
          }
        }
      } catch (_) { /* 存储被禁用时读不到旧键，仅跳过这一项提示 */ }
    } catch (e) { BF.err.report('selfcheck.keyDup', e); }
    /* 关键能力自检：这些函数一旦不存在，其调用点会静默失效或抛 TypeError。
       「写了但没接上」（声明在、零调用点）是这类单文件应用
       的真实失效模式，启动期逐项核对成本极低。 */
    try {
      const _must = [
        ['store.mutate', BF.store && BF.store.mutate, 'books_meta 原子读改写'],
        ['store.clearSelState', BF.reader && BF.reader.clearSelState, '选区状态跨章清理'],
        ['reader.applyHighlights', BF.reader && BF.reader.applyHighlights, '划线重绘'],
        ['stats._flush', BF.stats && BF.stats._flush, '阅读时长落盘'],
        ['bk._apply', BF.bk && BF.bk._apply, '备份恢复'],
        ['hub.register', BF.hub && BF.hub.register, '中枢注册'],
        ['hub.invoke', BF.hub && BF.hub.invoke, '中枢调度'],
        ['hub.adoptCommands', BF.hub && BF.hub.adoptCommands, '命令收编'],
        ['lang.transform', BF.lang && BF.lang.transform, '类型声明转换'],
        ['store.ssGet', BF.store && BF.store.ssGet, '会话级存储'],
      ];
      const _absent = _must.filter(function (x) { return typeof x[1] !== 'function'; });
      if (_absent.length) {
        /* 架构断言失败进错误通道（错误面板
           + 用户通知，按 ctx 节流），不阻断启动——
           失败用户可见，又不因误报卡死
           （BF.log.warn 只进日志，用户不可见）。 */
        BF.err.report('boot.must:absent', '关键能力缺失：' + _absent.map(function (x) { return x[0] + '（' + x[2] + '）'; }).join('、'));
      }
    } catch (e) { BF.err.report('boot.assert:absent', e); }
    /* SYNC_REMOTE 必须至少一个订阅者：广播集合宣称 12 类而接收侧零订阅时，
       「跨标签同步」只发不收且启动无感知——「承诺写在注释里、线没接上」族。
       订阅器在 BF.sync 模块加载时注册，不依赖 heal.run 与本断言的先后顺序。 */
    try {
      if (BF.bus && BF.bus.listenerCount && BF.bus.listenerCount(BF.EVENTS.SYNC_REMOTE) < 1) {
        BF.err.report('boot.must:sync', 'SYNC_REMOTE 零订阅：跨标签同步只发不收（BF.sync 统一订阅器未注册）');
      }
    } catch (e) { BF.err.report('boot.assert:sync', e); }
    /* 三条架构断言：拦住「承诺写在注释里、线没接上」族——
       ① 关键 API 至少一个调用点；② 防线在所有入口都接线；
       ③ 敏感键清单一致。启动期逐项核对，成本极低。
       断言失败走 BF.err.report：进错误面板
       + 用户通知通道，不阻断启动——「拦住」语义
       据此与实现一致（用户可见 + 启动不卡死）。 */
    /* 主脚本文本只扫一次：断言①与②共用这一份。本文件恰只有一个内联 script，
       各自扫一遍就是两次 querySelectorAll('script') 读回整段 1.7MB textContent。 */
    const _src = (function () {
      const ss = document.querySelectorAll('script');
      for (let i = 0; i < ss.length; i++) {
        const t = ss[i].textContent || '';
        if (t.indexOf('BF.cfi = (function') >= 0 || t.indexOf('BF.boot = {') >= 0) return t;
      }
      return '';
    })();
    try {
      /* ① 关键 API 至少一个调用点（静态）。主脚本为内联 <script>，
         取其文本搜调用点——「写了但没接上」（声明在、调用点为零）
         是这类项目的真实失效模式。 */
      if (_src) {
        const _apis = ['BF.cfi.locate', 'BF.cfi.offsetToLoc', 'BF.cfi.locToOffset', 'BF.cfi.locOfRange',
          'BF.cfi.makeLoc', 'BF.cfi.fixLegacyLoc', 'BF.cfi.buildMergedParts', 'BF.cfi.restoreMergedCoord',
          'BF.exportBlob', 'BF.download', 'BF.reader.applyStyles', 'BF.reader.applyHighlights'];
        const _noCall = _apis.filter(function (a) { return _src.indexOf(a + '(') < 0; });
        if (_noCall.length) BF.err.report('boot.must:api', '关键 API 无调用点：' + _noCall.join('、') + '（声明未接线）');
      }
    } catch (e) { BF.err.report('boot.assert:api', e); }
    try {
      /* ② 防线在所有入口都接线：命令执行器与全局事件委托是两大用户入口，
         执行器必须统一 try/catch + BF.err.report（run 裸抛会冒泡成
         unhandledrejection，防线接不上）。命令执行器运行时 toString
         取证；事件委托为静态源码取证（委托处理器不向外暴露）。 */
      const _runSrc = String(BF.commands && BF.commands.run);
      const _gaps = [];
      if (_runSrc.indexOf('try') < 0 || _runSrc.indexOf('BF.err') < 0) _gaps.push('命令执行器');
      if (_src.indexOf('delegate.click:') < 0 || _src.indexOf('delegate.change:') < 0) _gaps.push('全局事件委托');
      if (_gaps.length) BF.err.report('boot.must:entry', '防线未接入口：' + _gaps.join('、') + '（入口处理器无统一错误通道）');
    } catch (e) { BF.err.report('boot.assert:entry', e); }
    try {
      /* ③ 敏感键清单一致：隐私键若在 store/bk/settings 各写一份，
         就会漂移（8 键/7 键/5 键对不齐；键名大小写漂移曾打爆配额）。
         断言：① bk.PRIV_KEYS 与 store 真源键集双向
         一致（防漂移）；② 真源覆盖备份剥离核心键（aiApiKey/
         mimoApiKey/pinHash/pinSalt——缺任一，备份/导出剥离会
         明文泄露对应密钥）。settings 保留清单（aiProvider 等）
         语义不同（schema 归一化保留，非剥离对象），不纳入本断言。 */
      const _pk = BF.store && BF.store.PRIV_KEYS;
      if (_pk) {
        const _core = ['aiApiKey', 'mimoApiKey', 'pinHash', 'pinSalt'];
        const _miss = _core.filter(function (k) { return !_pk.has(k); });
        if (_miss.length) BF.err.report('boot.must:privkey', '敏感键真源缺核心键：' + _miss.join('、') + '（备份/导出剥离会明文泄露）');
        if (BF.bk && BF.bk.PRIV_KEYS) {
          const _bkSet = BF.bk.PRIV_KEYS instanceof Set ? BF.bk.PRIV_KEYS : new Set(BF.bk.PRIV_KEYS);
          const _drift = [];
          _pk.forEach(function (k) { if (!_bkSet.has(k)) _drift.push(k); });
          _bkSet.forEach(function (k) { if (!_pk.has(k)) _drift.push(k); });
          if (_drift.length) BF.err.report('boot.must:privkey-drift', 'bk.PRIV_KEYS 与 store 真源漂移：' + _drift.join('、'));
        }
      }
    } catch (e) { BF.err.report('boot.assert:privkey', e); }
    try {
      /* ④ 页面骨架同层：全部 .page 容器必须是同一个父节点的直接子级。
         少一个 </div> 时，解析器会把后面的页面全接成它的孩子——若那个容器
         默认 display:none，切过去就是整页空白，而用户只当"程序卡了一下"。
         这类错位只存在于渲染树上：node --check 看语法、CSS 配平看样式块，
         两者都不会发现 HTML 骨架少了一行。 */
      const _pg = [].slice.call(document.querySelectorAll('.page[id^="page-"]'));
      const _par = {};
      _pg.forEach(function (p) {
        const q = p.parentElement;
        _par[q ? (q.id ? '#' + q.id : q.tagName) : '(游离)'] = 1;
      });
      const _layers = Object.keys(_par);
      if (_pg.length > 1 && _layers.length !== 1) {
        BF.err.report('boot.must:pageTree', '页面容器分了 ' + _layers.length + ' 层（' + _layers.join(' / ') +
          '）：HTML 骨架有 div 没闭合，被吞进去的页面切过去只会是空白页');
      }
    } catch (e) { BF.err.report('boot.assert:pageTree', e); }
    /* 数据 schema 版本 + 显式迁移链：
       迁移器按版本号注册（MIGRATIONS[from] = fn），启动时从本地版本逐级升到当前，
       每级迁移是幂等的（可重复执行不破坏数据），迁移前自动触发一次备份快照。 */
    try {
      const _SCHEMA = 6;
      const _sk = 'schema_version';
      const _prev = BF.store.lsGet(_sk, null);
      const MIGRATIONS = {
        /* 2 → 3：标注统一模型。旧划线/书签无 loc 字段，
           由 applyHighlights 的「渲染即迁移」按需补（打开章时）。此处无需全量扫描——
           全量迁移代价高（要遍历每本书每章取正文），且渲染即迁移天然按需、幂等。 */
        2: function () { BF.log.info('迁移 v2→v3：标注统一模型（loc 字段按需补，渲染即迁移）'); },
        /* 3 → 4：`book.enc` 一身两职要拆开。它既存编码名（UTF-8/GB18030…）又存来源标签
           （clipboard/url），而 URL 通道要做编码嗅探就必须写真实编码名 —— 两个维度挤在
           一个字段里，判重的来源限定与「存疑」判定就会互相读错。
           旧记录里那两个标签迁进 src，enc 置空（旧记录确实没测编码，不假装有）。 */
        3: function () {
          const arr = BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || [];
          let n = 0;
          arr.forEach(function (b) {
            if (!b || b.src) return;
            if (b.enc === 'clipboard' || b.enc === 'url') { b.src = b.enc; b.enc = ''; }
            else b.src = 'file';
            n++;
          });
          if (n) BF.store.lsSet(BF.store.K.BOOKS_META, arr);
          BF.log.info('迁移 v3→v4：拆出书籍来源字段 src（改写 ' + n + ' 条）');
        },
        /* 4 → 5：书架分组（Collection）。两张新表首次读到 null 时按空结构处理，
           这里只把键落成空值 + 自检一次历史残留，幂等、不动任何既有数据。 */
        4: function () {
          if (BF.store.lsGet(BF.store.K.SHELF_GROUPS, null) == null) BF.store.lsSet(BF.store.K.SHELF_GROUPS, []);
          if (BF.store.lsGet(BF.store.K.SHELF_ITEMS, null) == null) BF.store.lsSet(BF.store.K.SHELF_ITEMS, {});
          const a = BF.store.lsGetArray(BF.store.K.SHELF_GROUPS, []);
          BF.log.info('迁移 v4→v5：书架分组表就位（已有 ' + (Array.isArray(a) ? a.length : 0) + ' 个分组）');
        },
        /* 5 → 6：清掉 settings 的 IDB 旧镜像。它过去按 UGC 整键复制过，
           而这份配置里装着密钥载体与 PIN 哈希——副本不在「恢复默认 / 改密钥 /
           备份剥离」任何一条删除路径上，留着就是删不掉的明文第二落点。
           幂等：这一次没删成（IDB 异常）下次启动再删。 */
        5: async function () {
          try {
            await BF.store.idbKeyDelete(BF.store.K.SETTINGS);
            BF.log.info('迁移 v5→v6：settings 的 IDB 旧镜像已清除（密钥回到只落 localStorage 一处）');
            return true;
          } catch (e) { BF.err.report('migrate.v6.settings', e); return false; }   /* false = 本次未完成，版本不前移 */
        },
      };
      if (_prev !== _SCHEMA) {
        /* 逐级迁移：同步迁移器立即执行（books_meta 等改写必须在本轮渲染之前完成）；
           异步迁移器返回 Promise，此时暂停同步链，等它落定后再升版本号并继续。
           原实现不看返回值就把版本写成 _SCHEMA：v5→v6 的 IDB 清理一旦失败，
           下次启动版本已到顶、永远不会重试，与上面「这次没删成下次再删」的承诺相反。 */
        /* 降级保护：本机 schema 比当前文件更新（用过新版后回退旧文件）时，
           迁移循环一次不跑，但结尾会无条件把版本写回 _SCHEMA —— 版本被静默改小，
           下次启动 _prev===_SCHEMA 跳过迁移，新版本的数据结构永久不兼容。
           此处保留高版本、不写回，也不尝试用旧迁移器处理更新的数据。 */
        if (_prev != null && _prev > _SCHEMA) {
          BF.log.warn('数据 schema：本机 v' + _prev + ' 高于当前程序 v' + _SCHEMA + '，保留高版本不降级（请用匹配的新版程序打开）');
        } else {
        const start = (_prev == null) ? 2 : _prev;   /* 首次初始化视为已到 v2（旧代数据形态） */
        const _done = function (from) {
          for (let v = from; v < _SCHEMA; v++) {
            try {
              if (!MIGRATIONS[v]) { BF.log.warn('迁移 v' + v + '→v' + (v + 1) + '：无迁移器，跳过（旧数据兼容读取）'); continue; }
              const r = MIGRATIONS[v]();
              if (r === false) { BF.log.warn('迁移 v' + v + '→v' + (v + 1) + '：本次未完成，版本停在 v' + v + '（下次启动重试）'); return; }
              if (r && typeof r.then === 'function') {
                r.then(function (_ok) {
                  if (_ok === false) { BF.log.warn('迁移 v' + v + '→v' + (v + 1) + '：本次未完成，版本停在 v' + v + '（下次启动重试）'); return; }
                  BF.log.info('迁移 v' + v + '→v' + (v + 1) + ' 完成');
                  _done(v + 1);
                }, function (e) { BF.err.report('migrate:' + v, e); });
                return;
              }
              BF.log.info('迁移 v' + v + '→v' + (v + 1) + ' 完成');
            } catch (e) {
              /* 同步迁移器抛错同样算「本次未完成」，必须停在这里：
                 继续往下跑并最终写 _SCHEMA，等于把失败的这一级永久跳过，
                 下次启动再也不会重试（与上面 false / 异步失败同一口径）。 */
              BF.err.report('migrate:' + v, e);
              BF.log.warn('迁移 v' + v + '→v' + (v + 1) + '：抛出异常，版本停在 v' + v + '（下次启动重试）');
              return;
            }
          }
          BF.store.lsSet(_sk, _SCHEMA);
          BF.log.info('数据 schema：' + (_prev == null ? '首次初始化' : 'v' + _prev + ' → v' + _SCHEMA) + '（迁移链执行完毕）');
        };
        _done(start);
        }
      }
    } catch (e) { BF.err.report('boot.migrate', e); }
    /* 双前缀键迁移：'bf_reading_state' / 'bf_schema_version' 这类整名传进
       lsSet/lsGet 时，叠加 PREFIX('bf_') 后落盘为 bf_bf_reading_state / bf_bf_schema_version。
       此处一次性把这类存档搬到正确键名并删除旧键；只搬一次（新键已存在则跳过，避免覆盖新数据）。 */
    try {
      const _mig = [
        { old: 'bf_reading_state', new: 'reading_state', label: '阅读进度' },
        { old: 'bf_schema_version', new: 'schema_version', label: '数据 schema 版本' },
      ];
      for (let i = 0; i < _mig.length; i++) {
        const m = _mig[i];
        const _oldVal = BF.store.lsGet(m.old, null);
        if (_oldVal !== null && BF.store.lsGet(m.new, null) === null) {
          BF.store.lsSet(m.new, _oldVal);
          BF.store.lsRemove(m.old);
          BF.log.info('双前缀键迁移：' + m.label + ' ' + m.old + ' → ' + m.new);
        } else if (_oldVal !== null) {
          BF.store.lsRemove(m.old);   /* 新键已有数据，旧键作废删除 */
          BF.log.info('双前缀键迁移：' + m.label + ' 旧键 ' + m.old + ' 已清理（新键已有数据）');
        }
      }
    } catch (e) { BF.err.report('key.migrate.doublePrefix', e); }
    BF.theme.apply();
    /* PIN 门禁：若已锁定，先解锁再进入；否则直接初始化 */
    const _enter = () => {
      /* 启动链路最外层兜底：_enter 内任一步未被内部兜住的同步错误，
         会让页面停在「有骨架、按钮没反应」的半初始化状态，
         且用户看不到任何提示。这里包一层：失败时给可见提示 + 运维台入口。 */
      try {
      if (BF.trace) BF.trace.start();
      BF.modules.start();
      if (BF.trace) BF.trace.mark('扩展启动');
      /* 中枢收编历史命令：必须放在 modules.start() 之后 —— 增强层模块在 install
         里注册的命令（如 book.notesExport）此时才存在，早一步会漏收。
         收编后这些命令才受能力判定约束；未被规则覆盖的会列入 skipped 并在日志留痕。 */
      try {
        if (BF.hub && BF.hub.adoptCommands) {
          const _ad = BF.hub.adoptCommands();
          BF.log && BF.log.info('命令表同步：' + _ad.ok + ' 项' + (_ad.skipped.length ? '，未归类 ' + _ad.skipped.length + ' 项：' + _ad.skipped.join(', ') : ''));
        }
      } catch (e) { BF.err.report('boot.adoptCommands', e); }
      if (BF.trace) BF.trace.mark('命令收编');
      BF.app.renderHome();
      /* 曲径（实验界面）：绑定 + 驿道首绘；开启时应用直接落在曲径。 */
      try { BF.qj.init(); } catch (e) { BF.err.report('qj.init', e); }
      if (BF.qj.isOn()) { try { BF.app.go('home'); } catch (e) { BF.err.report('qj.boot', e); } }
      if (BF.trace) BF.trace.mark('首页渲染');
      /* 默认激活页是书架（page-bookshelf 静态 active），必须同步渲染书架，
         否则 books-grid 空、导入卡不出现（不能只 renderHome） */
      /* 启动读回书架视图模式（grid/list），F5 后不回退到默认网格 */
      try { BF.appState.viewMode = BF.settings.get('shelfViewMode') || 'grid'; } catch (e) {}
      /* 启动渲染顶栏固定项（设置「书架」节圈选的菜单快捷按钮） */
      try { BF.uiMenu.renderPins(); } catch (e) { BF.err.report('uiMenu.renderPins', e); }
      BF.app.renderBookshelf();
      BF.library.refreshTagFilter();
      /* 自绘下拉：接管常驻DOM 里的静态 select（书架排序 / 标签筛选 / TTS 语速）。
         设置面板与便签面板是动态渲染的，各自在自己的渲染处调用 scan。 */
      try { BF.app.sel.scan(document); } catch (e) { BF.err.report('sel.scan:boot', e); }
      if (BF.trace) BF.trace.mark('控件接管');
      BF.heal.run();
      if (BF.trace) BF.trace.mark('数据自愈');
      BF.bk.startAuto();
      /* 跨标签同步单通道统一走 BF.sync（heal.run 里 start，模块加载时即注册
         SYNC_REMOTE 统一订阅器）——此处不需要重复 init 与转发。 */
      /* 设置/书架变化 → 工作区同步调度 */
      BF.bus.on(BF.EVENTS.SETTINGS, function () { try { if (BF.enh.ws && BF.enh.ws.schedule) BF.enh.ws.schedule(); } catch (e) {} });
      BF.bus.on(BF.EVENTS.BOOKSHELF, function () { try { if (BF.enh.ws && BF.enh.ws.schedule) BF.enh.ws.schedule(); } catch (e) {} });
      /* idb:up/down 与 state:change 的消费方在总线模块之后就挂好了（见 BF.log 之后一段），
         这里不再重复订阅：两处都挂 = 每次上下线刷两条日志。 */
      BF.perf.start();
      BF.enh.opfs.snapshot().then(function (r) { if (r.ok) BF.log.info('OPFS 快照已保存'); });
      /* 工作区同步：启动时尝试恢复远端数据，
         开启 wsSync 时恢复成功后重渲染。
         会话恢复（打开上次的书）延迟到 ws.restore 完成后再执行，
         避免 ws 异步重渲染覆盖刚恢复的阅读页（时序竞态）。 */
      let _wsRestored = Promise.resolve(false);
      try {
        if (BF.enh.ws && BF.enh.ws.enabled()) {
          _wsRestored = BF.enh.ws.restore().then(function (ok) {
            if (ok) { BF.log.info('工作区数据已恢复'); try { BF.app.renderHome(); BF.app.renderBookshelf(); } catch (e) { BF.err.report('render.afterWsRestore', e); } }
            return ok;
          }).catch(function (e) { BF.err.report('ws.restore', e); return false; });
        }
      } catch (e) { BF.err.report('boot.wsRestoreSetup', e); }
      if (BF.trace) BF.trace.mark('运行时');
      /* 顶栏常驻状态（番茄钟 chip + 通知角标）。放在 bindHotkeys 之前：
         两者都只是挂 DOM 与订阅事件，越早挂上，用户越早看到角标。 */
      BF.topStatus.mount();
      /* 保存失败提示条随顶栏一起挂载 */
      if (BF.topStatus.mountSaveFail) { try { BF.topStatus.mountSaveFail(); } catch (e) {} }
      BF.topStatus.bind();
      /* 首启引导：DOM 与顶栏挂好后再判断并显示，确保 bar 元素已存在 */
      try { BF.app.maybeOnboard(); } catch (e) { BF.err.report('boot.onboard', e); }
      /* 22:00 未达成提醒（一次性定时器，见 scheduleNightlyCheck） */
      try { if (BF.goal && BF.goal.scheduleNightlyCheck) BF.goal.scheduleNightlyCheck(); } catch (e) { BF.err.report('boot.nightcheck', e); }
      BF.enh.bindHotkeys();
      BF.hotkeys.bind('nav.theme', 'n', function () { BF.theme.cycle(); });
      /* DSL 终端全局热键（Ctrl+Shift+J，Mac ⌘+Shift+J） */
      BF.hotkeys.bind('tools.dsl', 'ctrl+shift+j', function () { BF.dslUI.toggle(); });
      BF.hotkeys.bind('nav.home', 'ctrl+shift+h', function () { BF.app.go('home'); });
      BF.hotkeys.bind('nav.bookshelf', 'ctrl+shift+b', function () { BF.app.go('bookshelf'); });
      BF.hotkeys.bind('import.file', 'ctrl+o', function () { BF.library.pickAndImport(); });
      BF.hotkeys.bind('find.inpage', 'ctrl+f', function () { BF.findInPage.open(); });
      BF.hotkeys.bind('find.all', 'ctrl+shift+f', function () { if (BF.appState.currentBookId) BF.reader.openDrawer('search'); });
      BF.hotkeys.bind('read.bookmark', 'ctrl+d', function () { if (BF.appState.currentPage === 'reader' && BF.appState.currentBookId) BF.reader.addBookmark(); });
      BF.hotkeys.bind('read.continue', 'ctrl+shift+r', function () { BF.app.continueRead(); });
      BF.hotkeys.bind('tts.toggle', 'ctrl+space', function () { if (BF.appState.currentPage === 'reader') BF.tts.toggle(); });
      BF.hotkeys.bind('nav.back', 'alt+left', function (e) { if (BF.appState.currentPage === 'reader') { e.preventDefault(); BF.nav && BF.nav.back(); } });
      BF.hotkeys.bind('nav.forward', 'alt+right', function (e) { if (BF.appState.currentPage === 'reader') { e.preventDefault(); BF.nav && BF.nav.forward(); } });
      BF.hotkeys.bind('read.microread', 'ctrl+shift+m', function () { if (BF.appState.currentPage === 'reader') BF.reader.toggleMicroread(); });
      /* macOS 别名：Ctrl+O / Ctrl+F 在 Safari、Chrome 里被浏览器或系统占用，
         为每条 Ctrl 组合再挂一份 Cmd 版（Mac 用户按 ⌘ 即可）；非 Mac 上按 Cmd 不会误触发 */
      [
        ['nav.home.mac', 'meta+shift+h', function () { BF.app.go('home'); }],
        ['nav.bookshelf.mac', 'meta+shift+b', function () { BF.app.go('bookshelf'); }],
        ['import.file.mac', 'meta+o', function () { BF.library.pickAndImport(); }],
        ['find.inpage.mac', 'meta+f', function () { BF.findInPage.open(); }],
        ['find.all.mac', 'meta+shift+f', function () { if (BF.appState.currentBookId) BF.reader.openDrawer('search'); }],
        ['read.bookmark.mac', 'meta+d', function () { if (BF.appState.currentPage === 'reader' && BF.appState.currentBookId) BF.reader.addBookmark(); }],
        ['read.continue.mac', 'meta+shift+r', function () { BF.app.continueRead(); }],
        ['tts.toggle.mac', 'meta+space', function () { if (BF.appState.currentPage === 'reader') BF.tts.toggle(); }],
        ['read.microread.mac', 'meta+shift+m', function () { if (BF.appState.currentPage === 'reader') BF.reader.toggleMicroread(); }],
      ].forEach(function (h) { BF.hotkeys.bind(h[0], h[1], h[2]); });
      /* DSL 终端 Mac 别名（⌘+Shift+J） */
      BF.hotkeys.bind('tools.dsl.mac', 'meta+shift+j', function () { BF.dslUI.toggle(); });
      if (BF.trace) BF.trace.mark('快捷键');
      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          const rp = document.getElementById('page-reader');
          if (rp && rp.classList.contains('microread')) { BF.reader.exitMicroread(); return; }
          /* 这里不点名任何面板：栈里只有它们自己——escTop 按栈顶关，
             close() 从 meta 拿到正确的 cls，一个入口、一份真相。 */
          /* 浮层栈兜底——运维台/基地/帮助/DSL 终端/便签/AI 中心等
             所有走 BF.sheet 的浮层都能用 Esc 关闭（栈顶优先）。 */
          if (BF.sheet.escTop()) return;
        }
      });
      BF.log.info('北风启动完成 v' + BF.version);
      /* 会话恢复（默认开，静默打开上次阅读的书，无记录则停留书架）。
         等 ws.restore 完成后再开书，串行化避免竞态。
         曲径开启时不恢复——启动落点是曲径，续读走曲径「今」站的继续卡。 */
      try {
        if (BF.settings.get('sessionRestore') !== false && !(BF.qj && BF.qj.isOn && BF.qj.isOn())) {
          const _lb = BF.store.lsGet(BF.store.K.LAST_BOOK, null);
          if (_lb) {
            /* 自包含离线包刚把书籍元数据同步写入、正文章节还在异步入库；
               不等它落定就开书，会读到「章节缺失」——用户看到导入失败，
               而实际上几毫秒后数据就齐了。 */
            const _put = window.__BF_SELFPKG_RESTORE__;
            const _pkgReady = (_put && typeof _put.then === 'function') ? Promise.resolve(_put).catch(function () {}) : null;
            Promise.resolve(_wsRestored).then(function () { return _pkgReady; })
              .then(function () { BF.app.openBook(_lb); })
              .catch(function (e) { BF.err.report('session.restore.open', e); });
          }
        }
      } catch (e) { BF.err.report('session.restore', e); }
      /* 再次回到时的落地页：会话恢复会开书时不抢屏；曲径有各自落点，也不覆盖。
         与上面的恢复判断读同一组条件，只读、不写。 */
      try {
        const _rpExp = !(BF.qj && BF.qj.isOn && BF.qj.isOn());
        const _rpRestore = _rpExp && BF.settings.get('sessionRestore') !== false && !!BF.store.lsGet(BF.store.K.LAST_BOOK, null);
        if (!_rpRestore && _rpExp && BF.settings.get('returnPage') === 'home') BF.app.go('home');
      } catch (e) { BF.err.report('session.returnPage', e); }
      if (BF.trace) BF.trace.mark('完成');
      } catch (e) {
        BF.err.report('boot.enter', e);
        BF.log.error('启动流程异常：' + (e && e.message || e));
        /* 可见提示：带「打开运维台」出口，不再停在半初始化静默状态 */
        try {
          BF.noti.error('启动过程中出现问题：' + ((e && e.message) || '未知错误'), {
            action: { label: '打开运维台', run: function () { BF.diag && BF.diag.open(); } },
            duration: 0,
          });
        } catch (e2) { BF.err.report('boot.enter.noti', e2); }
      }
    };
    if (BF.ai.store.pinLocked()) {
      BF.settingsUI.pinGate(function () { _enter(); });
    } else {
      _enter();
    }
  },
};
/* 灰阶侧栏接线：事件委托 → BF.commands 总线；data-bwcmd 全部是既有命令 id，
   侧栏不承载任何新业务。当前项只由 aria-current 承载，不再另起类名。 */
document.addEventListener('click', function (e) {
  /* 黑白模式常驻退出：强影响模式必须强可逆，不藏在设置第三层。
     走与开关同一处 settings.set + theme.apply，避免两套关法漂移。 */
  var ex = e.target.closest && e.target.closest('#bw-nav [data-bw-exit]');
  if (ex) {
    try {
      BF.settings.set('bwMode', false);
      if (BF.theme && BF.theme.apply) BF.theme.apply();
      BF.noti.success('已回到标准界面');
    } catch (err) { BF.err.report('bw.exit', err); }
    return;
  }
  var b = e.target.closest && e.target.closest('#bw-nav [data-bwcmd]');
  if (!b) return;
  var items = document.querySelectorAll('#bw-nav button');
  for (var i = 0; i < items.length; i++) items[i].removeAttribute('aria-current');
  b.setAttribute('aria-current', 'true');
  try { BF.commands.run(b.getAttribute('data-bwcmd')); } catch (err) {}
});
function _hideSplash(){ var s=document.getElementById('boot-splash'); if(!s) return; s.classList.add('hide'); setTimeout(function(){ try{s.remove();}catch(e){} }, 420); }
function _startBoot(){
  try { document.querySelectorAll('button:not([type])').forEach(function (b) { b.setAttribute('type', 'button'); }); } catch (e) {}  /* 无 type 的按钮包进 form 会误提交，统一补 type=button */
  try { if (BF.shell && BF.shell.init) BF.shell.init(); } catch (e) { /* 骨架初始化失败不阻断启动 */ }
  try { if (BF.notesTab && BF.notesTab.bind) BF.notesTab.bind(); } catch (e) {}
  try { if (BF.mineTab && BF.mineTab.bind) BF.mineTab.bind(); } catch (e) {}
  try { BF.boot.run(); } catch (e) { try { BF.err.report('boot.start', e); } catch (_) {} }   /* boot 异常不阻断遮罩收起，但必须留痕：否则表现为「有骨架、按钮没反应」且无任何提示 */
  _hideSplash();
}
/* 先让浏览器把启动遮罩 paint 出来，再跑重同步 boot：两次 rAF 后执行 */
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function(){ requestAnimationFrame(function(){ requestAnimationFrame(_startBoot); }); });
} else {
  requestAnimationFrame(function(){ requestAnimationFrame(_startBoot); });
}
/* 兜底：即使 boot 异常未走到 _hideSplash，6s 后也强制收起启动遮罩 */
setTimeout(function(){ var s=document.getElementById('boot-splash'); if(s && !s.classList.contains('hide')){ s.classList.add('hide'); setTimeout(function(){ try{s.remove();}catch(e){} }, 420);} }, 6000);

