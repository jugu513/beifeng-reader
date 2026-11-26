/* ================= 设置面板委托 ================= */
(function () {
  /* 热名单提为常量——每次 change 事件新建一份字面量数组是无效开销 */
  const READER_STYLE_KEYS = new Set(['readerMargin', 'fontSize', 'lineHeight', 'fontFamily', 'noIndent', 'justify', 'warmth', 'readerFilter']);
  const APPLY_NOW_KEYS = new Set(['fontSize', 'wordSpacing', 'brightness']);
  const REBUILD_TTS_ROWS = new Set(['paraSpacing', 'ttsPitch', 'ttsVolume']);
  document.addEventListener('change', function (e) {
    const t = e.target;
    const ovEl = t.closest('[data-offline-voice]');
    if (ovEl) {
      /* 离线主音色：选了就立刻生效并记住（loadVoices 下次按名字找回；找不到自动回落） */
      const name = String(ovEl.value || '');
      const vs = (BF.tts.offline.voices && BF.tts.offline.voices()) || [];
      const v = vs.find(function (x) { return x.name === name; }) || null;
      if (v) { try { BF.tts.offline.setVoice(v); } catch (er) {} BF.settings.set('ttsOfflineVoice', name); }
      return;
    }
    /* 存储分配（A）：按类别写 storageAlloc / mirrorKeys 对象表，不碰承重键主存。 */
    const allocEl = t.closest('[data-alloc]');
    if (allocEl) {
      const cat = allocEl.dataset.alloc, val = String(t.value || '');
      const tbl = BF.store.allocOf ? (function () { try { return BF.settings.get('storageAlloc') || {}; } catch (e) { return {}; } })() : {};
      const next = Object.assign({}, tbl); next[cat] = val;
      BF.settings.set('storageAlloc', next);
      const eff = BF.store.allocOf ? BF.store.allocOf(cat) : val;
      BF.noti.info('存储落点已改：' + (val === 'auto' ? '回到默认' : val) + '（当前生效 ' + eff + '），新写入落新区；旧书仍可读' + (val === eff ? '' : '；该环境不支持所选后端，已按现状生效'));
      return;
    }
    const mirEl = t.closest('[data-mirror]');
    if (mirEl) {
      const cat = mirEl.dataset.mirror, on = String(t.value) === 'true';
      let mk = {}; try { mk = BF.settings.get('mirrorKeys') || {}; } catch (e) { mk = {}; }
      const next = Object.assign({}, mk); next[cat] = on;
      BF.settings.set('mirrorKeys', next);
      BF.noti.info((on ? '已为' : '已取消') + '这一类的 IndexedDB 镜像（本地存储主存不变）');
      return;
    }
    /* 滚动条三态（S2）：一个选择映射回两个既有键，避免两个语义交叉的开关。
       always=两者皆关（滚动条全显）/ reading=仅阅读页隐藏(showScrollbarReadingOnly=true)
       / hidden=全站隐藏(hideScrollbar=true)。旧键保留，DSL 与旧存档继续可读。 */
    const sbEl = t.closest('[data-sb-mode]');
    if (sbEl) {
      const m = sbEl.value;
      BF.settings.patch({
        showScrollbarReadingOnly: m === 'reading',
        hideScrollbar: m === 'hidden'
      });
      try { BF.theme.apply(); } catch (e) {}
      return;
    }
    const setEl = t.closest('[data-set]');
    if (setEl) {
      const name = setEl.dataset.set;
      let v = t.value;
      if (v === 'true') v = true;
      else if (v === 'false') v = false;
      BF.settings.set(name, v);
      /* 桌面通知：开启时补授权链（未授权则请求） */
      if (name === 'desktopNoti' && v === true && 'Notification' in window && Notification.permission === 'default') {
        try { Notification.requestPermission(); } catch (e) {}
      }
      /* 设置页布局切换：改完立即按新模式重渲染面板（概览/分组/平铺）。 */
      if (name === 'settingsLayout' && BF.sheet && BF.sheet.isOpen && BF.sheet.isOpen('settings')) {
        try { BF.settingsUI.render(); } catch (e) {}
      }
      /* 面板里改一个值不做整屏转场（整屏淡出再淡入形同重载）；
         换肤动效只留给顶栏 / DSL 这类显式「换一套」的动作。 */
      if (name === 'appearance' || name === 'accent') BF.theme.apply();
      /* readerMode 的生效不在这里：统一由 BF.reader.reconcilePageMode 挂在
         SETTINGS 总线上处理，面板这条路径不重复实现一遍。 */
      /* 换引擎策略：停播 + 作废在途合成 + 重建这一屏的行集（都走同一个出口）。
         不这么做的话，旧引擎那条请求照样会回来并接着播，用户听到的是
         两种音色夹着播，而界面上引擎已经换了 —— 看起来就是「切档没生效」。 */
      if (name === 'ttsEngine') BF.tts.applyEnginePolicy();
      if (READER_STYLE_KEYS.has(name) && BF.appState.currentPage === 'reader') {
        BF.reader.applyStyles();
      }
      /* 互斥规则可能就地改写另一侧的值（选暖色→退出色板 / 切色板→暖色复位）。
         只把被改写的下拉框就地校正到当前值，不重渲染分区——
         重建会换掉用户正对着的控件节点。 */
      if (name === 'appearance' || name === 'warmth' || name === 'readerFilter') {
        try { BF.settingsUI.syncValues(['appearance', 'warmth', 'readerFilter']); } catch (e) {}
      }
      /* 背景氛围的真实运行态（见 appearance 分区的 ambRow）：
         改了 bgAnim 或 reduceMotion 都要就地刷新这一行。
         不整面板重渲染 —— 那会丢掉滚动位置，用户在外观区改个背景氛围
         就被弹回分区顶部，比这行状态不刷新更糟。 */
      if (name === 'bgAnim' || name === 'reduceMotion') BF.settingsUI.refreshAmbRow();
      /* invalidateCache 接线到真实失效路径：
         sanitize 缓存驻留正文净化片段（≤200 条），
         隐私模式开启后不应继续驻留内存 ——
         缓存除双上限淘汰外，还要随隐私开关立即失效。 */
      /* 清洗结果按原文缓存，而 sanitize 的输出取决于这两个开关：改完不作废就会出现
         「刚关掉外部图片，旧渲染还在照发请求」这种名实不符。privacyMode 沿用原口径（开时才变严）。 */
      if ((name === 'privacyMode' && v === true) || name === 'remoteImg') {
        try { BF.dom.invalidateCache(); } catch (e) {}
      }
      return;
    }
    const numEl = t.closest('[data-set-num]');
    if (numEl) {
      const name = numEl.dataset.setNum;
      /* 字间距滑块 step=0.5，但 parseInt("0.5")=0、parseInt("1.5")=1，
         拖动到 0.5 时 UI 与生效值不一致；含小数点的值走 parseFloat */
      let _v = /\./.test(String(t.value)) ? (parseFloat(t.value) || 0) : (parseInt(t.value, 10) || 0);
      /* 先夹到 NUM_RANGES 端点再落盘：越界值不写进存储，界面显示与实际生效始终一致 */
      _v = BF.settingsUI.clampNum(name, _v, numEl);
      BF.settings.set(name, _v);
      if (APPLY_NOW_KEYS.has(name) && BF.appState.currentPage === 'reader') BF.reader.applyStyles();
      return;
    }
    const stepEl = t.closest('[data-set-step]');
    if (stepEl) {
      const name = stepEl.dataset.setStep;
      let _v = BF.settingsUI.clampNum(name, parseFloat(t.value) || 0, stepEl);
      BF.settings.set(name, _v);
      if (REBUILD_TTS_ROWS.has(name)) {
        if (name === 'paraSpacing' && BF.appState.currentPage === 'reader') BF.reader.applyStyles();
      }
      return;
    }
    const txtEl = t.closest('[data-set-text]');
    if (txtEl) {
      const _k = txtEl.dataset.setText;
      /* 打码态下把框清空＝放弃这次修改，不等于删密钥：值本来就不在框里，
         清空只是抹掉刚粘的半截。显式删除走「清除」按钮。 */
      if (_isSecretKey(_k) && txtEl.getAttribute('data-secret-masked') === '1' && t.value === '') {
        _maskSecretInput(txtEl, _k);
        _secretSay(_k, '', false);
        return;
      }
      BF.settings.set(_k, t.value);
      /* 存完立刻收回框里的明文 —— 打码的意义就是稳态下 DOM 里没有原文。 */
      if (_isSecretKey(_k)) {
        _secretSay(_k, '已保存；点「显示」可看一眼原文', false);
        _maskSecretInput(txtEl, _k);
      }
      /* smart.override 接线：「用户
         手选模型即锁定（BF.ai.smart.override）」
         必须由 aiModel 输入框变更触发，否则 route 的 override
         分支永不触发。route key 与
         BF.ai.smart.route('aiModel', …) 调用点
         同源。 */
      if (_k === 'aiModel' && BF.ai && BF.ai.smart) {
        try { BF.ai.smart.override('aiModel', t.value); } catch (e) {}
      }
      return;
    }
  });
  document.addEventListener('click', function (e) {
    const t = e.target;
    /* T2 强调色色块：写入同一个 accent 键——下方 change/deep 总线会 theme.apply；
       就地更新四块的 aria-pressed，不重渲染面板（保住滚动位置与自绘下拉状态）。 */
    const acc = t.closest('[data-accent]');
    if (acc) {
      BF.settings.set('accent', acc.getAttribute('data-accent'));
      const sibs = acc.parentNode.querySelectorAll('[data-accent]');
      for (let i = 0; i < sibs.length; i++) sibs[i].setAttribute('aria-pressed', sibs[i] === acc ? 'true' : 'false');
      return;
    }
    /* A组口味预设：按 TASTE_PRESETS 批量写 BF.TASTE 的键，就地同步下拉与摘要。 */
    const preset = t.closest('[data-taste-preset]');
    if (preset) {
      const p = BF.settingsUI.TASTE_PRESETS[preset.getAttribute('data-taste-preset')];
      if (!p) return;
      const on = new Set(p.ids);
      const keys = [];
      (BF.TASTE || []).forEach(function (x) { keys.push(x.key); BF.settings.set(x.key, on.has(x.id)); });
      try { BF.settingsUI.syncValues(keys); } catch (e) {}
      const sum = document.getElementById('taste-summary');
      if (sum) sum.textContent = '展开细调（当前已开启 ' + p.ids.length + ' 项 · 关掉即回到原样，「减少动效」优先于动效类口味）';
      BF.noti.info('已套用「' + p.name + '」口味预设');
      return;
    }
    if (t.closest('[data-tts-show-cfg]')) {
      /* 被收起的档给一条切过去的出口：这一枚改的就是「引擎策略」本身，
         切完行集就来了——比让用户回到第一行去找那个下拉近。 */
      const e = t.closest('[data-tts-show-cfg]').getAttribute('data-tts-show-cfg');
      const v = e === 'auto' ? 'auto' : BF.tts.settingOfEng(e);
      BF.settings.set('ttsEngine', v);
      BF.noti.info('引擎策略已切到' + (e === 'auto' ? '自动' : (BF.tts.cap(e) || {}).label || e));
      BF.tts.applyEnginePolicy();
      return;
    }
    if (t.closest('[data-tts-preview]')) { BF.tts.preview(); return; }
    if (t.closest('[data-secret-eye]')) { _eyeClick(t.closest('[data-secret-eye]').getAttribute('data-secret-eye')); return; }
    if (t.closest('[data-reveal-once]')) {
      var _kOnce = t.closest('[data-reveal-once]').getAttribute('data-reveal-once');
      _secretSay(_kOnce, '', false);
      _showSecret(_kOnce);
      return;
    }
    if (t.closest('[data-reveal-always]')) {
      /* 「以后都允许」＝这次显示 + 把策略改成 allow，并就地同步那一项自己的显示。
         改原生 select 的值再派 change：既有订阅会把自绘触发器一起刷新，不必重建设置面板。 */
      var _kAlways = t.closest('[data-reveal-always]').getAttribute('data-reveal-always');
      BF.settings.set('keyReveal', 'allow');
      var _psel = document.querySelector('[data-set="keyReveal"]');
      if (_psel) { _psel.value = 'allow'; _psel.dispatchEvent(new Event('change', { bubbles: true })); }
      _secretSay(_kAlways, '', false);
      _showSecret(_kAlways);
      return;
    }
    if (t.closest('[data-secret-clear]')) { _clearSecret(t.closest('[data-secret-clear]').getAttribute('data-secret-clear')); return; }
    if (t.closest('[data-secret-copy]')) {
      /* 密钥得能拿走，但不该靠「先显示出来再手抄」或「全选输入框」——
         那两条路都把原文摊在屏幕上。这里从存储取原值直接送剪贴板：
         界面不显示、日志不留、也不经过输入框可见状态。
         输入框里有内容就先复制那串（用户可能刚粘上还没失焦落库），否则复制已存的值。 */
      const btn = t.closest('[data-secret-copy]');
      const k = btn.getAttribute('data-secret-copy');
      const out = document.querySelector('[data-copy-out="' + k + '"]');
      const put = function (txt, bad) {
        if (out && out.isConnected) { out.textContent = txt; out.style.color = bad ? 'var(--warning-ink)' : 'var(--text-weak)'; }
        else if (bad) BF.noti.warn('密钥复制失败：' + txt);
      };
      const inp = document.querySelector('input[data-set-text="' + k + '"]');
      const v = (inp && inp.value) || BF.settings.get(k) || '';
      if (!v) { put('这一项还没填密钥', true); return; }
      put('复制中…', false);
      Promise.resolve(BF.copyText(v)).then(function (r) {
        put(r.ok ? ('已复制 ' + r.n + ' 个字符') : (r.error || '复制失败'), !r.ok);
      }, function (e) { put(((e && e.message) || String(e)) , true); });
      return;
    }
    if (t.closest('[data-ai-models]')) {
      /* 拉一次模型目录填进输入框的 datalist：拿到真名单再挑，别让用户凭记忆敲名字。
         用的是当前服务商 / 端点 / 密钥（先落库再拉，跟校验 Token 同一口径）；只读不送正文。 */
      const btn = t.closest('[data-ai-models]');
      const out = document.getElementById('ai-models-out');
      const dl = document.getElementById('ai-model-list');
      const put = function (txt, bad) {
        if (out && out.isConnected) { out.textContent = txt; out.style.color = bad ? 'var(--warning-ink)' : 'var(--text-weak)'; }
        else if (bad) BF.noti.warn('拉取模型：' + txt);
        else BF.noti.info('拉取模型：' + txt);
      };
      put('拉取中…', false);
      try { btn.disabled = true; } catch (e) {}
      Promise.resolve(BF.ai.gateway.listModels()).then(function (r) {
        try { btn.disabled = false; } catch (e) {}
        if (!r || !r.ok) { put('失败：' + ((r && r.error) || '未知原因'), true); return; }
        if (dl) dl.innerHTML = r.models.map(function (m) { return '<option value="' + BF.dom.escAttr(m) + '"></option>'; }).join('');
        put('已拉取 ' + r.models.length + ' 个模型：点模型框选，或接着手打', false);
      }, function (e) {
        try { btn.disabled = false; } catch (er) {}
        put('失败：' + ((e && e.message) || e), true);
      });
      return;
    }
    if (t.closest('[data-offline-try]')) {
      /* 试听=重读一次本机语音表再念固定短句：列表异步加载时用户按它会当场刷新 */
      try { BF.tts.offline.loadVoices(); } catch (e) {}
      try { BF.tts.offline.tryVoice(); } catch (e) { BF.err.report('tts.tryOffline', e); }
      return;
    }
    if (t.closest('[data-tts-probe]')) {
      /* 显式才联网：Edge 发一次可达性请求，MiMo 发一次真合成（用当前密钥）。
         结果只进内存态 + 这一行文字，并同步顶栏三态灯。 */
      const st = document.getElementById('tts-probe-state');
      if (st) st.textContent = '探测中…';
      ['edge', 'mimo', 'offline'].forEach(function (eng) {
        BF.tts.stab.probe(eng, true).then(function () {
          if (st) st.textContent = BF.tts.stab.lampText();
        });
      });
      return;
    }
    if (t.closest('[data-tts-health-probe]') || t.closest('[data-tts-health-copy]')) {
      const h = BF.tts.health;
      const outEl = document.querySelector('[data-tts-health-text]');
      const put = function (s) { if (outEl && outEl.isConnected) outEl.textContent = s; };
      if (t.closest('[data-tts-health-copy]')) {
        const s = h.status();
        BF.copyText(s.diag + (s.detail ? ' | ' + s.detail : '')).then(function (r) {
          BF.noti[r && r.ok ? 'success' : 'warn'](r && r.ok ? '诊断已复制' : '复制失败');
        });
        return;
      }
      put('检测中…');
      Promise.resolve(h.run(true)).then(function (code) {
        const s = h.status();
        put(s.text + (code === 'OK' && s.latency ? ' · ' + s.latency + 'ms' : '') + (s.detail ? '（' + s.detail + '）' : ''));
        if (!outEl || !outEl.isConnected) BF.noti.info('在线语音：' + s.text);
      });
      return;
    }
    if (t.closest('[data-pron-add]')) {
      const syncCount = function () {
        const el = document.querySelector('[data-pron-count]');
        if (el && el.isConnected) el.textContent = BF.tts.pron.count() + ' 条';
      };
      syncCount();
      BF.modal.prompt('加纠正', '格式：词=替读。用同音字纠读法，例：单=蝉（单于）；离开=离开不纠就不填', {}).then(function (v) {
        const s = String(v || '').trim();
        if (!s) return;
        const eq = s.indexOf('=');
        if (eq < 1) { BF.noti.warn('没看懂这条：要写成「词=替读」'); return; }
        BF.tts.pron.set(s.slice(0, eq).trim(), s.slice(eq + 1).trim());
        BF.noti.success('已记住这条读法');
        syncCount();
      });
      return;
    }
    if (t.closest('[data-pron-clear]')) {
      BF.ask.confirm({ title: '清空纠正', body: '把全部读法纠正恢复为默认。正文不受影响。', confirmText: '清空', danger: 2, op: 'tts.pronClear', facts: {} }).then(function (ok) {
        if (!ok) return;
        const m = BF.tts.pron.list();
        for (const w in m) BF.tts.pron.set(w, '');
        const el = document.querySelector('[data-pron-count]');
        if (el && el.isConnected) el.textContent = '0 条';
        BF.noti.info('读法纠正已全部还原');
      });
      return;
    }
    if (t.closest('[data-edge-token-probe]')) {
      /* 令牌轮换后「填完到底通不通」不该靠猜：这里就地走一次和朗读同构造的握手。
         先落库再测——校验的必须是输入框里这串，不是上一次存的那串。
         结果写回这一行；面板若在这期间被重建（settings.set 会标脏），改走通知，不丢结果。 */
      const out = document.getElementById('edge-token-probe-out');
      const put = function (txt, bad) {
        if (out && out.isConnected) { out.textContent = txt; out.style.color = bad ? 'var(--warning-ink)' : 'var(--text-weak)'; }
        else if (bad) BF.noti.warn('Edge Token 校验：' + txt);
        else BF.noti.info('Edge Token 校验：' + txt);
      };
      const inp = document.getElementById('set-edgeToken');
      if (inp) {
        const v = String(inp.value || '').trim();
        if (v !== (BF.settings.get('edgeToken') || '')) BF.settings.set('edgeToken', v);
      }
      put('握手测试中…', false);
      const _t0 = Date.now();
      Promise.resolve(BF.tts.edge.probeConnect()).then(function (r) {
        if (r && r.ok) put('可用：握手成功（' + (Date.now() - _t0) + ' ms）', false);
        else put('被拒：' + ((r && r.reason) || '未知原因') + '（Token / 网络 / 地区都可能；换网络再测一次即可分开）', true);
      }, function (e) { put('测试失败：' + ((e && e.message) || e), true); });
      return;
    }
    if (t.closest('[data-backup-now]')) { if (BF.base) BF.base.action('backup'); return; }
    if (t.closest('[data-export-backup]')) { BF.bk.exportWithAsk(); return; }
    if (t.closest('[data-import-backup]')) { const fi = document.getElementById('backup-input'); if (fi) fi.click(); return; }
    if (t.closest('[data-reset-all]')) { BF.bk.resetAll(); return; }
    if (t.closest('[data-clear-cache]')) { if (BF.base) BF.base.action('cache'); return; }
    /* 存储分配：立即迁移此区（懒迁移，读旧写新，不删旧）。 */
    const migEl = t.closest('[data-alloc-migrate]');
    if (migEl) {
      const cat = migEl.dataset.allocMigrate;
      if (!BF.store || !BF.store.migrateCategory) return;
      const btn = migEl; const old = btn.textContent; btn.textContent = '迁移中…'; btn.disabled = true;
      Promise.resolve(BF.store.migrateCategory(cat)).then(function (r) {
        btn.textContent = old; btn.disabled = false;
        if (!r) return;
        if (r.skipped) BF.noti.info('这一类无需迁移或当前环境不支持双区');
        else BF.noti.success('已迁移 ' + r.moved + ' 项' + (r.failed ? '，失败 ' + r.failed + ' 项（详见日志）' : ''));
      }, function (e) { btn.textContent = old; btn.disabled = false; BF.noti.error('迁移失败：' + ((e && e.message) || e)); });
      return;
    }
    /* P3/Agent：让助手规划最优存储方案 → 生成方案并直接弹授权窗让用户逐项勾选。 */
    if (t.closest('[data-sp-plan]')) {
      if (!BF.store || !BF.store.planStorage) return;
      try { BF.ai.showStoragePlan(); } catch (e) { BF.noti.error('规划失败：' + ((e && e.message) || e)); }
      return;
    }
    /* P2-7：选择根目录句柄（须在用户手势里调用）。 */
    if (t.closest('[data-root-pick]')) {
      if (!BF.fsync || !BF.fsync.bindRootHandle) return;
      Promise.resolve(BF.fsync.bindRootHandle()).then(function (r) {
        if (!r) return;
        if (r.ok) { BF.noti.success(r.msg); try { if (BF.settingsUI && BF.settingsUI.render) BF.settingsUI.render(); } catch (e) {} }
        else if (r.reason !== 'cancelled') BF.noti.info(r.msg);
      });
      return;
    }
    if (t.closest('[data-root-clear]')) {
      if (!BF.fsync || !BF.fsync.clearRootHandle) return;
      Promise.resolve(BF.fsync.clearRootHandle()).then(function () {
        BF.noti.info('已恢复内置存储位置（旧数据未搬迁）');
        try { if (BF.settingsUI && BF.settingsUI.render) BF.settingsUI.render(); } catch (e) {}
      });
      return;
    }
    /* 这三枚是入口按钮（名字就是面板本身）→ 再点一次收起。
       面板层互斥，所以面板里那颗「打开基地 / 打开运维台」不冲突：
       它所在的 panel 正开着时，基地 / 运维台必然没开，切换等价于打开。
       顶栏这道门叫「工作台」，直接走 BF.workbench，不经 BF.diag 转发器 ——
       运维台 / 基地都是工作台的栏，门按合并前的窗口名命名，点进去标题却是
       「工作台」，按名字找的人就找不着这块面板。toggle() 不带栏位：回到上次
       停留的那一栏；顶栏只留这一道门，不并排第二道。
       「设置·数据」里的旧名按钮照原样保留 —— 多处报错文案写着「见运维台」，
       那两个名字必须有落点，只是不再占顶栏的门。 */
    if (t.closest('[data-open-base]')) { if (BF.base) BF.base.toggle(); return; }
    if (t.closest('[data-open-diag]')) { if (BF.diag) BF.diag.toggle(); return; }
    if (t.closest('[data-open-help]')) { if (BF.help) BF.help.toggle(); return; }
    if (t.closest('[data-onboard-reset]')) { try { BF.store.lsSet(BF.store.K.ONBOARDED, 0); BF.app.maybeOnboard(true); BF.noti.success('已重新显示首启引导'); } catch (e) { BF.err.report('onboard.reset', e); } return; }
    if (t.closest('[data-edit-prompts]')) { if (BF.ai.promptEditor) BF.ai.promptEditor.open(); return; }
    /* 可达性探测与本机转发脚本导出。探测＝从本页发 OPTIONS 预检，与真请求同一条
       判据，不带凭据也不送正文；探测结果只进内存 + 这一行文字，不落存储。 */
    if (t.closest('[data-net-probe]')) {
      const st = document.getElementById('ai-net-state');
      if (st) st.textContent = '探测中…';
      BF.net.probeAll().then(function (txt) {
        if (st) st.textContent = txt;
        BF.noti.info('服务商可达性：' + txt + (BF.net.hasProxy() ? '' : '（不可直连的那几家需先导出并启动本机转发）'));
      });
      return;
    }
    if (t.closest('[data-net-export]')) {
      BF.exportBlob('beifeng-proxy.mjs', BF.ai.proxySource(), { mime: 'text/plain;charset=utf-8' });
      /* 两个文件同时下会被浏览器拦第二个，隔一拍再发；bat 里用相对路径，放哪儿都能双击起 */
      BF.timers.timeout(function () { BF.exportBlob('启动本机转发.bat', BF.ai.proxyBat(), { mime: 'application/octet-stream' }); }, 700);
      BF.noti.info('已导出 beifeng-proxy.mjs + 启动本机转发.bat：放到同一目录，双击 bat 即启动（需本机有 Node）');
      return;
    }
    if (t.closest('[data-net-export-ps]')) {
      BF.exportBlob('beifeng-proxy.ps1', BF.ai.proxyPs1(), { mime: 'text/plain;charset=utf-8' });
      BF.timers.timeout(function () { BF.exportBlob('启动本机转发（免安装）.bat', BF.ai.proxyBatNoNode(), { mime: 'application/octet-stream' }); }, 700);
      let _h = '';
      try { _h = new URL(((BF.ai.currentProvider() || {}).id === 'custom' ? BF.settings.get('aiEndpoint') : (BF.ai.currentProvider() || {}).base) || '').host; } catch (e) {}
      BF.noti.info('已导出 beifeng-proxy.ps1 + 启动本机转发（免安装）.bat：放同一目录双击 bat（Windows 自带 PowerShell，不需 Node）' + (_h ? '，只转发到 ' + _h : ''));
      return;
    }
    if (t.closest('[data-pin-manage]')) { BF.settingsUI.openPinManage(); return; }
    if (t.closest('[data-smart-reset]')) {
      try { if (BF.ai.smart) BF.ai.smart.unlockAll(); BF.noti.success('已重置自动选择记忆'); } catch (e) { BF.err.report('smart.reset', e); }
      return;
    }
    /* 随书偏好清除入口（设置 → 阅读 →
       「随书偏好」行按钮）。清当前书全部记忆项，
       数据层确认后 toast + 面板重渲染。 */
    if (t.closest('[data-prefs-clear]')) {
      try {
        const _bid = BF.appState.currentBookId;
        if (!_bid) { BF.noti.warn('请先打开一本书'); return; }
        if (BF.prefs.purgeBook(_bid)) {
          const meta = BF.store.lsGetArray(BF.store.K.BOOKS_META, []);
          const b = meta.find(function (x) { return x && x.id === _bid; });
          BF.noti.success('已清除《' + BF.dom.esc((b && b.title) || '本书') + '》的随书偏好');
          if (BF.settingsUI && BF.settingsUI.render) BF.settingsUI.render();
        } else BF.noti.info('当前书没有随书偏好');
      } catch (e) { BF.err.report('prefs.clear', e); }
      return;
    }
    if (t.closest('[data-preset-apply]')) { if (BF.settingsUI.applyPreset) BF.settingsUI.applyPreset(); return; }
    if (t.closest('[data-preset-save]')) { if (BF.settingsUI.savePreset) BF.settingsUI.savePreset(); return; }
    if (t.closest('[data-preset-del]')) { if (BF.settingsUI.delPreset) BF.settingsUI.delPreset(); return; }
    if (t.closest('[data-backup-file]')) { BF.bk.importFile(t.closest('[data-backup-file]')); return; }
  });
})();

/* ============================================================
   北风 · diag 域：备份恢复 / 数据自愈 / 运维台
   ============================================================ */

