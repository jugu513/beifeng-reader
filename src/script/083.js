/* ================= R15. 模块注册 ================= */
BF.modules.register({
  id: 'reader.core',
  name: '阅读器核心',
  desc: '阅读区渲染/翻页/手势/选区',
  version: '1.0',
  enabled: true,
  deps: ['core.store', 'core.settings'],
  hooks: {
    install() {
      /* 监听登记表：install 挂的 DOM 监听、bus 订阅、定时器全部登记，
         uninstall 逐项回滚——不摘旧监听时模块重装（disable→enable）会让它们全部翻倍。 */
      const _R = { dom: [], bus: [], timers: [] };
      const on = function (tgt, ev, fn, opt) { tgt.addEventListener(ev, fn, opt); _R.dom.push([tgt, ev, fn, opt]); };
      const busOn = function (ev, fn) { BF.bus.on(ev, fn); _R.bus.push([ev, fn]); };
      this._R = _R;

      on(document, 'mouseup', function () {
        if (BF.appState.currentPage !== 'reader') return;
        setTimeout(function () {
          try { BF.reader.positionSel(); } catch (e) {}
        }, 10);
      });
      const wrap = document.getElementById('reader-wrap');
      if (wrap) on(wrap, 'scroll', function () { BF.reader.hideSel(); }, { passive: true });
      /* 「回到顶部」必须在 scroll 里判定：只在开章那一刻看时 scrollTop 恒为 0，按钮永远不出现 */
      if (wrap) {
        let _btRaf = false;
        on(wrap, 'scroll', function () {
          if (_btRaf) return;
          _btRaf = true;
          requestAnimationFrame(function () {
            _btRaf = false;
            const bt = document.getElementById('back-top');
            if (bt) bt.classList.toggle('show', wrap.scrollTop > wrap.clientHeight * 0.6);
            try { BF.reader.updateRemain(); } catch (e) {}
          });
        }, { passive: true });
      }
      /* 单击朗读：设置项 ttsTap 的消费点。判定「无选区 + 点在 p 上」才算单击朗读，
         避免与划词高亮的 mouseup 流程互相干扰 */
      const mainEl = document.getElementById('reader-main');
      if (mainEl) {
        on(mainEl, 'click', function (e) {
          if (!BF.settings.get('ttsTap')) return;
          if (BF.appState.currentPage !== 'reader') return;
          const sel = window.getSelection && window.getSelection();
          if (sel && String(sel.toString() || '').trim()) return;   /* 有划词 → 交给划线流程 */
          const p = e.target && e.target.closest ? e.target.closest('p') : null;
          if (!p) return;
          const t = (p.textContent || '').trim();
          if (!t) return;
          try { BF.tts.speakOnce(t); } catch (err) { BF.err.report('ttsTap', err); }
        });
      }
      /* ===== 手势三件套（触摸滑动翻页 / 双击区域翻页 / 选中右键菜单） ===== */
      /* ① 触摸滑动翻页：touchstart 记起点 → touchmove 判横向位移（>50px 且横向>纵向）→
         touchend 调 nextChapter/prevChapter。有选区（划线优先）或非横向时放弃，不劫持纵向滚动 */
      if (wrap) {
        let _tx0 = 0, _ty0 = 0, _tSwiped = null, _tSel = null;
        on(wrap, 'touchstart', function (e) {
          const t = e.touches && e.touches[0];
          if (!t) return;
          const sel = window.getSelection && window.getSelection();
          _tSel = (sel && String(sel.toString() || '').trim()) || null;   /* 有选区 → 划线优先，当次滑动放弃 */
          _tx0 = t.clientX; _ty0 = t.clientY; _tSwiped = null;
        }, { passive: true });
        on(wrap, 'touchmove', function (e) {
          if (_tSwiped !== null) return;
          const t = e.touches && e.touches[0];
          if (!t) return;
          const dx = t.clientX - _tx0, dy = t.clientY - _ty0;
          if (Math.abs(dx) < 50 || Math.abs(dx) <= Math.abs(dy) * 1.2) return;   /* 未达阈值 / 纵向滚动优先 */
          _tSwiped = dx > 0 ? 'prev' : 'next';
          if (e.cancelable) { try { e.preventDefault(); } catch (err) {} }   /* 阻止浏览器横向回弹/手势导航；cancelable=false 时浏览器已自行滚动，强阻止只会刷 "Ignored attempt to cancel a touchmove" 的 console error */
        }, { passive: false });
        on(wrap, 'touchend', function () {
          if (!_tSwiped || _tSel) { _tSwiped = null; return; }
          const dir = _tSwiped; _tSwiped = null;
          try {
            if (dir === 'next') BF.reader.nextChapter(); else BF.reader.prevChapter();
          } catch (err) { BF.err.report('gesture.swipe', err); }
        }, { passive: true });
        /* ② 双击区域翻页：左 1/3 上一章、右 1/3 下一章、中间 1/3 什么都不做；有选区（双击选词）不触发 */
        on(wrap, 'dblclick', function (e) {
          if (BF.appState.currentPage !== 'reader') return;
          const sel = window.getSelection && window.getSelection();
          if (sel && String(sel.toString() || '').trim()) return;
          const w = wrap.clientWidth || document.body.clientWidth;
          const x = e.clientX - (wrap.getBoundingClientRect().left || 0);
          try {
            if (x < w / 3) BF.reader.prevChapter();
            else if (x > w * 2 / 3) BF.reader.nextChapter();
            /* 中间 1/3：什么都不做 */
          } catch (err) { BF.err.report('gesture.dblclick', err); }
        });
        /* ③ 选中右键菜单：有选区时 contextmenu 弹自定义菜单（复制/划线/AI 提问/查词典/朗读），
           无选区放行浏览器默认菜单；点外部或 Esc 关闭 */
        let _ctxMenu = null;
        const _closeCtxMenu = function () {
          if (_ctxMenu && _ctxMenu.parentNode) _ctxMenu.parentNode.removeChild(_ctxMenu);
          _ctxMenu = null;
          /* 外部点击监听随关菜单同步摘除——自摘条件若只依赖
             menu.parentNode，菜单被 Esc/Tab/再次右键关掉后它就永不摘除，右键 N 次漏 N 个监听 */
          if (_ctxOut) { document.removeEventListener('click', _ctxOut); _ctxOut = null; }
        };
        let _ctxOut = null;
        on(wrap, 'contextmenu', function (e) {
          if (BF.appState.currentPage !== 'reader') return;
          const s = window.getSelection && window.getSelection();
          const t = s ? String(s.toString() || '').trim() : '';
          if (!t) return;   /* 无选中 → 放行浏览器默认菜单 */
          e.preventDefault();
          e.stopPropagation();
          _closeCtxMenu();
          const menu = document.createElement('div');
          menu.className = 'sel-ctx-menu';
          /* 选中右键菜单用 listbox/option + 共享游标，与其余四套菜单同一把 cursor/nav。
             条目若是原生 button，Tab 能挨个走但没有方向键游标，键盘路线各写各的。 */
          menu.setAttribute('role', 'listbox');
          menu.setAttribute('aria-label', '选中操作');
          menu.tabIndex = -1;
          const act = function (label, fn) {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = label;
            b.setAttribute('role', 'option');
            b.setAttribute('aria-selected', 'false');
            b.setAttribute('tabindex', '-1');
            b.id = 'selctx-i' + menu.children.length;
            b.addEventListener('click', function () { _closeCtxMenu(); try { fn(); } catch (err) { BF.err.report('ctx.' + label, err); } });
            menu.appendChild(b);
          };
          act('复制', function () { BF.reader.copySel(); });
          /* 新建型动作（加划线不破坏任何数据）：无可撤对象故不传 undo，失败反馈走 BF.act.run 通道 */
          act('划线', function () { BF.act.run('划线', function () { BF.reader.addNote('underline'); }); });
          act('AI 提问', function () { BF.aiUI.runExplain(t); });
          act('查词典', function () { BF.reader.addVocab(); });
          act('朗读选中', function () { BF.tts.selSpeak(t); });
          document.body.appendChild(menu);
          /* 定位：优先鼠标处，贴边自动回弹，防止溢出视口 */
          const r = menu.getBoundingClientRect();
          menu.style.left = Math.max(4, Math.min(e.clientX, window.innerWidth - r.width - 4)) + 'px';
          menu.style.top = Math.max(4, Math.min(e.clientY, window.innerHeight - r.height - 4)) + 'px';
          _ctxMenu = menu;
          /* 方向键游标 + Enter 选中；Esc 由文档捕获监听统一处理，
             此处 nav 的 Escape 分支只是备用通道（焦点在菜单内时文档捕获先到，两路不叠加）。 */
          menu.addEventListener('keydown', function (e) {
            if (e.key === 'Tab') { _closeCtxMenu(); return; }
            const nds = Array.prototype.slice.call(menu.querySelectorAll('button'));
            const ctl = {
              nodes: function () { return nds; },
              active: function () { return +(menu.dataset.act || 0); },
              setActive: function (n) { menu.dataset.act = BF.app.sel.cursor(nds, n, menu); },
              pick: function (n) { if (nds[n]) nds[n].click(); },
              close: function () { _closeCtxMenu(); },
            };
            BF.app.sel.nav(e, ctl);
          });
          try { menu.focus(); } catch (e2) {}
          menu.dataset.act = BF.app.sel.cursor(menu.querySelectorAll('button'), 0, menu);
          setTimeout(function () {
            /* 句柄存进 _ctxOut，_closeCtxMenu 统一摘除（自摘条件不再依赖 parentNode） */
            _ctxOut = function (e2) { if (menu.parentNode && !menu.contains(e2.target)) _closeCtxMenu(); };
            document.addEventListener('click', _ctxOut);
            _R.dom.push([document, 'click', _ctxOut]);
          }, 0);
        });
        /* 捕获相 + 截断 —— 右键菜单不是 sheet 层（不进账本栈），
           按普通 bubble 注册时同一个 Esc 会先被启动区的 escTop 消费，
           菜单与其底下刚被关的面板一次键连拆两层。捕获相必先到、
           stopPropagation 断后续，「Esc 只关最上面那层」在这里成立。 */
        const _ctxEsc = function (e) { if (e.key === 'Escape' && _ctxMenu) { e.stopPropagation(); _closeCtxMenu(); } };
        on(document, 'keydown', _ctxEsc, true);
      }
      /* 自动保存：设置项 autoSave 的消费点。开启后每 20 秒回写一次本章进度与滚动位置，
         只靠「切章 / 离开页面」两个时机的话，中途崩溃会丢掉整章进度 */
      const _autoSaveT = BF.timers.interval(function () {
        if (!BF.settings.get('autoSave')) return;
        if (BF.appState.currentPage !== 'reader' || !BF.appState.currentBookId) return;
        try { BF.reader.saveProgress(); } catch (e) {}
      }, 20000);
      _R.timers.push(_autoSaveT);
      /* 设置实时预览：settings.set 广播 SETTINGS 事件，跨标签同步之外阅读区也订阅它。
         在阅读页改字号/行距/滤镜/主题等即时生效，无需关闭设置面板 */
      busOn(BF.EVENTS.SETTINGS, function () {
        if (BF.appState.currentPage !== 'reader') return;
        try {
          BF.theme.apply();
          if (BF.reader.applyStyles) BF.reader.applyStyles();
          if (BF.reader.updateRemain) BF.reader.updateRemain();
        } catch (e) {}
      });
      /* 主题/场景切换（THEME 事件）也即时重绘阅读区：本模块必须订阅 THEME，
         没有订阅者时每次 apply 都刷「无监听: theme/changed」告警，阅读区只能靠 apply 末尾硬调用刷新 */
      busOn(BF.EVENTS.THEME, function () {
        if (BF.appState.currentPage !== 'reader') return;
        try { if (BF.reader.applyStyles) BF.reader.applyStyles(); } catch (e) {}
      });
      /* resize 校正（改窗口宽度/字号重排后保持阅读位置）。
         记录 resize 前 scrollTop 占 scrollHeight 的比例，resize 后按新高度恢复同比例，
         避免重排后滚动位置错位（比例不变则跳过，不打扰）。 */
      let _rsRatio = null, _rsT = null;
      const _onResize = function () {
        const wrap = document.getElementById('reader-wrap');
        if (!wrap) return;
        /* 分页态：窗口尺寸变了必须重排，否则「一页」变成一屏半、正文溢出页面底
           （手机旋转 / 地址栏收放 / 桌面拖窗口都会触发）。滚动态才走比例还原。 */
        if (BF.reader.pageModeActive()) {
          if (_rsT) clearTimeout(_rsT);
          _rsT = setTimeout(function () {
            _rsT = null;
            try { if (BF.reader.repaginate) BF.reader.repaginate(true); } catch (e) {}
          }, 180);
          return;
        }
        const total = wrap.scrollHeight - wrap.clientHeight;
        if (total <= 0) return;
        _rsRatio = total > 0 ? wrap.scrollTop / total : 0;
        if (_rsT) clearTimeout(_rsT);
        _rsT = setTimeout(function () {
          _rsT = null;
          if (_rsRatio == null) return;
          const w2 = document.getElementById('reader-wrap');
          if (!w2 || BF.reader.pageModeActive()) return;
          const t2 = w2.scrollHeight - w2.clientHeight;
          if (t2 <= 0) return;
          const target = Math.round(_rsRatio * t2);
          if (Math.abs(w2.scrollTop - target) > 2) w2.scrollTop = target;
          _rsRatio = null;
        }, 150);
      };
      window.addEventListener('resize', _onResize);
      _R.dom.push([window, 'resize', _onResize]);
      /* 朗读条的垂直锚点必须跟着底栏的真实高度走。底栏窄屏允许换行后
         （.reader-bottom 从 46px 变成三行 105px），.tts-bar 的 bottom 仍按写死的
         --bar-h 让位 —— 380px 视口下朗读条会压在底栏上，正好盖住「上一章 / 下一章」。
         按真实高度落 inline bottom（与选区工具条 style.top 同一套写法）；
         14px 是朗读条与底栏之间的间隙，与样式表里那条默认值同源。
         三个时机都刷：① 进阅读页立刻，② 窗口尺寸变化，③ ResizeObserver 补充
         （观察器回调逐帧投递，环境里可能不来，所以它不能是唯一路径）。 */
      const _rb = document.querySelector('.reader-bottom');
      const TTS_GAP = 14;
      function _syncBarAnchor() {
        const bar = document.getElementById('tts-bar');
        if (!bar || !_rb) return;
        const r = _rb.getBoundingClientRect();
        /* 阅读页没显示时量到的是 0，写进去等于把朗读条按到视口底边上 —— 只在量到真实高度时更新 */
        if (!(r.height > 0)) return;
        /* 让位量要从「底栏上沿到视口底的距离」算，不能用底栏自身高度：
           底栏下方还有安全区/内边距时，只按 height 让位会差出一截，照样压住按钮。 */
        bar.style.bottom = Math.round(innerHeight - r.top) + TTS_GAP + 'px';
      }
      BF.reader.syncBarAnchor = _syncBarAnchor;
      _syncBarAnchor();
      if (_rb && typeof ResizeObserver !== 'undefined') {
        const _roBar = new ResizeObserver(_syncBarAnchor);
        _roBar.observe(_rb);
        _R.timers.push(function () { try { _roBar.disconnect(); } catch (e) { BF.log.warn('阅读器底栏观察器断开失败：' + (e && e.message)); } });
      }
      const _onResizeAnchor = function () { _syncBarAnchor(); };
      window.addEventListener('resize', _onResizeAnchor);
      _R.dom.push([window, 'resize', _onResizeAnchor]);
      BF.stats.startReaderTimer();
      BF.log.info('reader.core ready');
    },
    uninstall() {
      /* 新增：统一回滚 install 登记的全部监听/订阅/定时器（重装不再翻倍） */
      try { BF.stats.stopReaderTimer && BF.stats.stopReaderTimer(); } catch (e) {}
      try { BF.stats._flush(); } catch (e) {}
      const R = this._R;
      if (!R) return;
      R.dom.forEach(function (x) { try { x[0].removeEventListener(x[1], x[2], x[3]); } catch (e) {} });
      R.bus.forEach(function (x) { try { BF.bus.off(x[0], x[1]); } catch (e) {} });
      R.timers.forEach(function (t) { try { if (typeof t === 'function') t(); } catch (e) {} });
      this._R = null;
    },
  },
});

/* ============================================================
   北风 · tts 域（一）：三引擎（浏览器 / MiMo / Edge）+ 路由
   ============================================================ */
BF.tts = BF.tts || {};

