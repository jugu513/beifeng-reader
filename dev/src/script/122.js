/* ================= A9. 防剧透 ================= */
/* page_limit：把「可引用范围」写成显式的数字边界注入提示词。
   模型对「第 N 章之后不得引用」这类硬边界的服从性，远好于
   「不要剧透」这类没有边界的形容词；两句话一起说，各管各的。 */
BF.ai.refBookCtx = function () {
  if (!BF.settings.get('aiRefBook')) return '';
  const b = BF.reader.state.book;
  if (!b) return '';
  const cur = (BF.appState.currentChapterIdx || 0) + 1;
  const total = b.totalChapters || 0;
  return '当前阅读《' + b.title + '》，已读到第' + cur + '章（共' + total + '章）。' +
    '【page_limit】可引用范围＝第1~' + cur + '章；第' + (cur + 1) + '章及以后你没有任何信息，回答中不得透露、暗示或据此推理。' +
    '回答时不要剧透未读内容。';
};

/* ============================================================
   北风 · ai 域（三）：研读中心面板 UI（8 卡 + 问书 + 结果区）
   ============================================================ */
BF.aiUI = (function () {
  function open() {
    /* 面板骨架统一由 BF._panel 工厂生成，
       各面板不各自编写「创建元素 + pk-panel 骨架 +
       close 按钮接线」；close 按钮带 data-panel-close 走文档级委托，
       Esc/焦点由 BF.sheet 浮层栈统一提供。 */
    BF._panel('ai-center', 'AI 研读中心', {
      cls: 'dlg-shell', cssText: '--dlg-w:min(760px,94vw)',   /* AI 研读中心：最宽的常规弹窗 */
      bodyId: 'ai-center-body',
      bodyCss: 'padding:var(--sp-4);flex:0 1 auto',
    });
    BF.sheet.open('ai-center', { render: render });
  }
  /* 顶栏 / 更多菜单 / 微读栏那三枚入口是切换；
     「问 AI」「段落解析」「选中文字问 AI」这类联动走 open()——语义是确保打开，不是切换。 */
  function toggle() {
    if (BF.sheet.closable('ai-center')) { BF.sheet.close('ai-center'); return false; }
    open(); return true;   /* 骨架由 BF._panel 现场生成，必须走 open() */
  }
  function render() {
    const body = document.getElementById('ai-center-body');
    if (!body) return;
    const b = BF.reader.state.book;
    const keyOk = BF.ai.hasKey();
    /* 状态栏三态：当前模型 / 密钥配置态（含密保锁定）/ 网关态（队列·失败·熔断） */
    const _gw = BF.ai.gateway;
    const _cw = _gw.circuitWait ? _gw.circuitWait() : 0;
    const _gwHtml = _cw > 0
      ? '<span style="color:var(--danger-ink)">暂时不可用（约 ' + _cw + 's 后自动重试，连续失败 ' + _gw.failCount() + ' 次）</span>'
      : '服务在线' + (_gw.queueLength() ? '（' + _gw.queueLength() + ' 个请求排队中）' : '') + (_gw.failCount() ? ' · 失败 ' + _gw.failCount() + ' 次' : '');
    body.innerHTML =
      /* 头部：左边是"在哪本书里问"，右边四枚入口（Agent / 历史 / 任务 / 新建）；
         任务卡是菜单里的一层，点开才出现。 */
      '<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">' +
        '<div style="flex:1;min-width:0;font-size:13px;color:var(--text-dim);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
          (b ? '《' + BF.dom.esc(b.title) + '》' : '未打开书（部分功能需先打开书）') + '</div>' +
        '<button class="btn btn-xs" data-ai-agent title="Agent 模式：可调用本地工具（按书检索、算位置等）">Agent</button>' +
        '<button class="btn btn-xs" data-ai-history aria-expanded="false" aria-controls="ai-history-wrap" title="历史对话">历史</button>' +
        '<button class="btn btn-xs" data-ai-tasks aria-expanded="false" aria-controls="ai-cards-wrap" title="章节摘要 / 角色档案 / 情感曲线等现成任务">任务</button>' +
        '<button class="btn btn-xs" data-ai-new title="开一段新对话">新建</button>' +
      '</div>' +
      /* 状态收成一行：模型 · 就绪/去填密钥 · 排队/熔断（只在这两个时候多说一句） */
      '<div style="display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:10px;font-size:12px;color:var(--text-weak)">' +
        '<span>' + BF.dom.esc(BF.settings.get('aiModel') || '默认模型') + '</span>' +
        '<span>·</span>' +
        (keyOk
          ? '<span>已就绪</span>'
          : '<button class="btn btn-xs" data-ai-goto-key>未配置密钥 · 去填</button>') +
        (BF.settings.get('aiLock') ? '<span>· 密保已启用</span>' : '') +
        (_cw > 0 || _gw.failCount() || _gw.queueLength() ? '<span>·</span><span>' + _gwHtml + '</span>' : '') +
        /* 成本估算（#151）：有回答过才出现（默认不占位），估算口径见 BF.ai.costLabel */
        (BF.ai.costLabel() ? '<span>·</span><span title="按内置价格表估算，非账单值；累计仅本次会话口径">' + BF.dom.esc(BF.ai.costLabel()) + '</span>' : '') +
      '</div>' +
      /* Agent 运行状态条：跑的时候有呼吸点与扫光，跑完留一句"已完成 · 用时"再自己收起 */
      '<div id="ai-agent-strip" hidden></div>' +
      /* 历史对话：默认收起，点头部「历史」展开（一列会话，按最后活动排序） */
      '<div id="ai-history-wrap" hidden style="margin:0 0 10px"></div>' +
      '<div id="ai-notes" style="margin:0 0 10px"></div>' +
      /* 任务面板：默认收起，点头部「任务」展开 */
      '<div id="ai-cards-wrap" hidden style="margin:0 0 10px"><div id="ai-cards"></div></div>' +
      '<div id="ai-thread"></div>' +
      /* 推理过程（深度思考模型才有）：回答上方一块默认折叠的「已深度思考 · N s · M 字」 */
      '<div id="ai-reason"></div>' +
      '<div id="ai-result"></div>' +
      /* 标注出处卡片容器（问书注入标注时，回答下方附出处） */
      '<div id="ai-ann-src" style="margin-top:8px"></div>' +
      /* AI 回答引用出处卡片容器（引用文本反查定位锚） */
      '<div id="ai-cite-src" style="margin-top:8px"></div>' +
      '<div id="ai-actions" style="margin-top:10px;display:flex;gap:8px">' +
      '<button class="btn btn-xs" data-ai-rerun style="display:none">重新生成</button></div>' +
      /* 输入区：多行、Enter 发送 / Shift+Enter 换行；「发送」与「停止」同一行 */
      '<div id="ai-ask-row" style="position:sticky;bottom:-4px;background:var(--bg-panel);padding:8px 0 2px;display:flex;gap:6px;align-items:flex-end;margin:6px 0 0">' +
      '<textarea id="ai-ask-input" class="input" rows="2" placeholder="问这本书…（Enter 发送 · Shift+Enter 换行）" style="flex:1;resize:none;min-height:44px;max-height:160px;line-height:1.6" data-ai-ask></textarea>' +
      '<button class="btn btn-sm primary" data-ai-ask-btn>发送</button></div>';
    /* 渲染 8 卡 */
    const _aiBox = document.getElementById('ai-result');
    /* Agent 与普通对话的区分：顶部状态条（跑动中带呼吸点 + 扫光，完成后留一句用时）
       + 答案左侧强调条和 AGENT 标签。动效在 reduce-motion 下由 CSS 停掉。 */
    const _agentStripEl = document.getElementById('ai-agent-strip');
    let _agentT0 = 0;
    function _agentStrip(on, txt) {
      if (!_agentStripEl) return;
      if (!on) {
        if (_agentStripEl.hasAttribute('hidden')) return;
        const secs = _agentT0 ? ((Date.now() - _agentT0) / 1000).toFixed(1) : '';
        _agentStripEl.classList.add('done');
        _agentStripEl.innerHTML = '<span class="dot"></span><span>Agent 已完成' + (secs ? ' · ' + secs + 's' : '') + '</span>';
        BF.timers.timeout(function () {
          try { _agentStripEl.setAttribute('hidden', ''); _agentStripEl.classList.remove('done'); } catch (e) {}
        }, 2600);
        return;
      }
      _agentT0 = Date.now();
      _agentStripEl.classList.remove('done');
      _agentStripEl.removeAttribute('hidden');
      _agentStripEl.innerHTML = '<span class="scan"></span><span class="dot"></span><span>' + BF.dom.esc(txt || 'Agent 运行中') + '</span>';
    }
    function _agentTag() {
      if (!_aiBox) return;
      try {
        _aiBox.classList.add('ai-agent-answer');
        if (!_aiBox.querySelector('.ai-agent-tag')) {
          _aiBox.insertAdjacentHTML('afterbegin', '<div class="ai-agent-tag"><span class="dot"></span>AGENT</div>');
        }
      } catch (e) {}
    }
    /* 便签可视化：AI「添加笔记」的列表与删除入口（缺了它笔记只写不可见） */
    function _renderNotes() {
      const box = document.getElementById('ai-notes');
      if (!box) return;
      let notes = [];
      try { notes = BF.store.lsGetArray(BF.store.K.NOTES, []) || []; } catch (e) { BF.log && BF.log.warn('storage.笔记读取失败：' + (e && e.message)); }
      const cur = BF.appState.currentBookId;
      const mine = notes.filter(function (n) { return n && (cur ? n.bookId === cur : true); }).slice(-20).reverse();
      if (!mine.length) { box.innerHTML = ''; return; }
      box.innerHTML = '<details class="bf-fold" style="border:1px solid var(--border);border-radius:var(--r-card);padding:8px 12px;font-size:12.5px">' +
        '<summary style="cursor:pointer;color:var(--text-dim)">便签（' + mine.length + ' 条' + (cur ? ' · 本书' : '') + '，最多显示最近 20 条）</summary>' +
        '<div style="margin-top:6px;display:flex;flex-direction:column;gap:6px">' +
        mine.map(function (n) {
          return '<div style="display:flex;gap:8px;align-items:flex-start;line-height:1.6">' +
            '<div style="flex:1;color:var(--text-dim)">' + BF.dom.esc(n.text || '') +
            '<span style="color:var(--text-weak);font-size:11px;margin-left:6px">' + (n.created ? new Date(n.created).toLocaleString('zh-CN') : '') + '</span></div>' +
            '<button class="btn btn-xs" data-note-del="' + BF.dom.escAttr(n.id || '') + '" aria-label="删除便签">删</button></div>';
        }).join('') + '</div></details>';
      box.querySelectorAll('[data-note-del]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const id = btn.getAttribute('data-note-del');
          /* 删除必须走 BF.notes.remove：裸 lsGet → filter → lsSet 会绕过
             store 封装（无 mutate、无 setCritical、覆盖并发写），且不经确认。
             成功吐司由撤销通道自带（「删除便签（Ctrl+Z 可撤销）」）——
             这里再弹一张就是同一动作两张卡。 */
          try { if (await BF.notes.remove(id)) { _renderNotes(); } }
          catch (e) { BF.err.report('note.del', e); }
        });
      });
    }
    _renderNotes();
    _renderSessions();
    _renderThread();
    function _setActions(state) {
      /* 发送与停止合并成一颗：生成中同一颗按钮变「停止」，不再并排两颗 */
      const ask = document.querySelector('[data-ai-ask-btn]');
      const rerun = document.querySelector('[data-ai-rerun]');
      if (ask) {
        if (state === 'running') { ask.textContent = '停止'; ask.setAttribute('data-ai-stop', ''); ask.classList.remove('primary'); }
        else { ask.textContent = '发送'; ask.removeAttribute('data-ai-stop'); ask.classList.add('primary'); }
      }
      if (rerun) rerun.style.display = state === 'done' ? 'inline-block' : 'none';
    }
    function _renderResult(text, streaming) {
      const _md = BF.dom.sanitize(BF.md ? BF.md.render(text) : BF.dom.esc(text));
      if (streaming) { _aiBox.innerHTML = _md; return; }   /* 流式期只画正文，动作栏等收尾再挂 */
      _aiBox.innerHTML = _md +
        '<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap;border-top:1px solid var(--border);padding-top:8px">' +
          '<button class="btn btn-xs" data-ai-copy title="复制这段回答（Markdown 原文）">复制</button>' +
          '<button class="btn btn-xs" data-ai-regen title="按同样的输入重跑一次">重新生成</button>' +
          '<button class="btn btn-xs" data-ai-quote title="把这段回答引用到输入框，接着追问">引用到输入框</button>' +
          '<button class="btn btn-xs" data-ai-copy-dsl title="把这段回答作为脚本填入 DSL 终端，可编辑后运行/保存">复制到 DSL</button>' +
          (BF.next && BF.next.afterAI ? '<button class="btn btn-xs" data-ai-save-note title="把这段回答存为便签">存为便签</button>' : '') +
        '</div>';
      const _plain = String(text || '');
      const cp0 = _aiBox.querySelector('[data-ai-copy]');
      if (cp0) cp0.addEventListener('click', function () {
        try {
          if (!navigator.clipboard || !navigator.clipboard.writeText) { BF.noti.warn('当前环境不支持剪贴板'); return; }
          navigator.clipboard.writeText(_plain).then(function () { BF.noti.success('已复制回答'); },
            function (e) { BF.noti.warn('复制失败：' + ((e && e.message) || e)); });
        } catch (e) { BF.noti.warn('复制失败：' + ((e && e.message) || e)); }
      });
      const rg0 = _aiBox.querySelector('[data-ai-regen]');
      if (rg0) rg0.addEventListener('click', _doRerun);
      const qt0 = _aiBox.querySelector('[data-ai-quote]');
      if (qt0) qt0.addEventListener('click', function () {
        const inp = document.getElementById('ai-ask-input');
        if (!inp) return;
        const quote = _plain.replace(/\s+/g, ' ').trim().slice(0, 400);
        inp.value = '> ' + quote + '\n\n' + inp.value;
        try { inp.dispatchEvent(new Event('input')); inp.focus(); } catch (e) {}
      });
      const sn = _aiBox.querySelector('[data-ai-save-note]');
      if (sn) sn.addEventListener('click', function () {
        /* BF.next.afterAI 接线——完成态的下一步动作长在该屏动作区里，
           不另起 toast 打断阅读。 */
        const a = BF.next.afterAI(String(text || ''));
        if (a && a.action) a.action.run();
      });
      const cpy = _aiBox.querySelector('[data-ai-copy-dsl]');
      if (cpy) cpy.addEventListener('click', function () {
        try {
          BF.dslUI.toggle();
          /* 填入的是脚本草稿 —— 无论当前是什么模式，都切到编辑器模式再落笔 */
          BF.dslUI.setMode('editor', true);
          const codeEl = document.getElementById('dsl-code');
          if (codeEl) {
            /* AI 回答正文 → 脚本草稿：去 HTML 标签，保留代码块 */
            const plain = String(text || '').replace(/<[^>]*>/g, '');
            codeEl.value = '// 来自 AI 回答，运行前请检查\n' + plain;
            codeEl.focus();
            BF.noti.success('已填入 DSL 终端，检查后运行');
          }
        } catch (e) { BF.err.report('ai.copyDsl', e); BF.noti.warn('无法打开 DSL 终端'); }
      });
    }
    /* 历史对话：一列会话（按最后活动倒序），切换只换 activeId，不动其他会话。 */
    function _renderSessions() {
      const box = document.getElementById('ai-history-wrap');
      if (!box) return;
      const bid = BF.appState.currentBookId;
      if (!bid) { box.innerHTML = '<div style="font-size:12px;color:var(--text-weak);padding:8px 2px">先打开一本书。历史对话按书归档。</div>'; return; }
      const list = BF.ai.askSessions(bid).slice().sort(function (a, b) { return (b.at || 0) - (a.at || 0); });
      const act = BF.ai.askActive(bid);
      const ago = function (ts) {
        const min = Math.round((Date.now() - (ts || 0)) / 60000);
        if (min < 1) return '刚刚';
        if (min < 60) return min + ' 分钟前';
        if (min < 1440) return Math.round(min / 60) + ' 小时前';
        try { const d = new Date(ts); return (d.getMonth() + 1) + '/' + d.getDate(); } catch (e) { return ''; }
      };
      box.innerHTML = '<div style="border:1px solid var(--border);border-radius:var(--r-card);overflow:hidden">' +
        '<div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid var(--border);font-size:12px;color:var(--text-weak)">' +
          '<span style="flex:1">历史对话 · 本书</span>' +
          '<button class="btn btn-xs" data-sess-new>+ 新对话</button>' +
        '</div>' +
        (list.length ? list.map(function (s) {
          const on = !!(act && s.id === act.id);
          const n = (s.turns || []).length;
          return '<div style="display:flex;align-items:center;gap:6px;padding:7px 10px;border-bottom:1px solid var(--border)">' +
            '<button class="btn btn-xs" data-sess="' + BF.dom.escAttr(s.id) + '"' + (on ? ' aria-current="true"' : '') +
              ' style="flex:1;min-width:0;text-align:left;border-color:' + (on ? 'var(--accent)' : 'transparent') + '" title="' + BF.dom.escAttr(s.title) + '">' +
              '<span style="display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + BF.dom.esc(s.title || '未命名') + '</span>' +
              '<span style="display:block;font-size:11px;color:var(--text-weak);font-weight:400">' + ago(s.at) + (n ? ' · ' + n + ' 问' : ' · 空') + '</span>' +
            '</button>' +
            '<button class="btn btn-xs" data-sess-del="' + BF.dom.escAttr(s.id) + '" title="删除该对话" aria-label="删除对话">×</button>' +
          '</div>';
        }).join('') : '<div style="padding:12px;font-size:12px;color:var(--text-weak)">还没有历史对话。问第一个问题就会出现在这里。</div>') +
      '</div>';
      const hBtn = document.querySelector('[data-ai-history]');
      const hWrap = document.getElementById('ai-history-wrap');
      const collapse = function () { if (hWrap) hWrap.setAttribute('hidden', ''); if (hBtn) hBtn.setAttribute('aria-expanded', 'false'); };
      box.querySelectorAll('[data-sess]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          BF.ai.askActiveSet(btn.getAttribute('data-sess'), bid);
          _renderSessions(); _renderThread();
          collapse();
        });
      });
      box.querySelectorAll('[data-sess-del]').forEach(function (btn) {
        btn.addEventListener('click', async function () {
          const sid = btn.getAttribute('data-sess-del');
          /* 成功吐司由撤销通道自带，这里再弹一张就是同一动作两张卡。 */
          if (await BF.ai.askDel(sid, bid)) { _renderSessions(); _renderThread(); }
        });
      });
      const nb = box.querySelector('[data-sess-new]');
      if (nb) nb.addEventListener('click', function () {
        BF.ai.askNew(null, bid);
        _renderSessions(); _renderThread();
        collapse();
        const inp = document.getElementById('ai-ask-input');
        if (inp) inp.focus();
      });
    }
    /* 多轮会话就地展示：把 askHistory 渲染成连续气泡（用户右、助手左） */
    function _renderThread() {
      const box = document.getElementById('ai-thread');
      if (!box) return;
      const bookId = BF.appState.currentBookId;
      const hist = bookId ? BF.ai.askHistory(bookId) : [];
      if (!hist.length) {
        /* 空态只留一个：说清"能问什么"，给三个一问就能用的例句；
           现成任务不在首屏堆着，点右上「任务」才展开。 */
        box.innerHTML = '<div style="padding:26px 8px 10px;text-align:center">' +
          '<div style="font-size:14px;color:var(--text-dim);margin-bottom:6px">' + (bookId ? '问这本书的任何事' : '先打开一本书，或直接提问') + '</div>' +
          '<div style="font-size:12px;color:var(--text-weak);margin-bottom:14px">回答会附书中出处；要现成任务点右上「任务」</div>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;justify-content:center">' +
          ['这一章讲了什么？', '梳理一下主要人物', '用三句话概括全书'].map(function (q) {
            return '<button class="btn btn-xs" data-ai-suggest="' + BF.dom.escAttr(q) + '">' + BF.dom.esc(q) + '</button>';
          }).join('') +
          '</div></div>';
        const inp0 = document.getElementById('ai-ask-input');
        box.querySelectorAll('[data-ai-suggest]').forEach(function (sb) {
          sb.addEventListener('click', function () {
            if (!inp0) return;
            inp0.value = sb.getAttribute('data-ai-suggest') || '';
            try { inp0.dispatchEvent(new Event('input')); inp0.focus(); } catch (e) {}
          });
        });
        return;
      }
      box.innerHTML = hist.map(function (m) {
        const isUser = m.role === 'user';
        return '<div style="display:flex;' + (isUser ? 'justify-content:flex-end' : 'justify-content:flex-start') + '">' +
          '<div style="max-width:82%;padding:8px 12px;border-radius:12px;font-size:13px;line-height:1.6;word-break:break-word;' +
          (isUser ? 'background:var(--accent);color:#fff' : 'background:var(--bg-input);color:var(--text-dim);border:1px solid var(--border)') + '">' +
          BF.dom.sanitize(BF.md ? BF.md.render(m.content) : BF.dom.esc(m.content)) + '</div></div>';
      }).join('');
      /* 贴底才跟随：用户往上翻历史时不要把他拽回底部 */
      if (box.dataset.stick !== '0') box.scrollTop = box.scrollHeight;
      if (!box._stickBound) {
        box._stickBound = true;
        box.addEventListener('scroll', function () {
          box.dataset.stick = (box.scrollHeight - box.scrollTop - box.clientHeight < 40) ? '1' : '0';
        });
      }
    }
    /* 标注出处卡片——回答附出处（书/章/原文引用），
       「定位原文」走偏移真源（loc 优先 → charOffset 回退
       → 生词按词定位，与标注中心「原文」同一纪律） */
    function _gotoAnn(ann) {
      if (!ann) return;
      try { BF.sheet.close('ai-center'); } catch (e) {}
      const jump = function () {
        BF.reader.gotoChapter(typeof ann.chapterIdx === 'number' ? ann.chapterIdx : 0);
        BF.timers.timeout(function () {
          const paras = BF.reader.state.paras || [];
          if (ann.loc && typeof ann.loc.si === 'number' && paras.length) {
            const L = BF.cfi.locate(ann.loc, paras);
            if (L && L.match && L.si >= 0) {
              const off = BF.cfi.locToOffset({ si: L.si, so: L.so }, paras);
              BF.reader.gotoCharOffset(off, { highlight: true, q: ann.text || undefined });
              return;
            }
          }
          if (typeof ann.charOffset === 'number') {
            BF.reader.gotoCharOffset(ann.charOffset, { highlight: true });
            return;
          }
          if (ann.kind === 'voc' && ann.text && paras.length) {
            for (let pi = 0; pi < paras.length; pi++) {
              const o = (paras[pi] || '').indexOf(ann.text);
              if (o >= 0) { BF.reader.gotoCharOffset(BF.cfi.locToOffset({ si: pi, so: o }, paras), { highlight: true, q: ann.text }); return; }
            }
          }
        }, 120);
      };
      /* 跨书出处：先打开出处书再跳（标注中心只列当前书，
         此分支为聚合/历史数据兜底） */
      if (ann.bookId && ann.bookId !== BF.appState.currentBookId) {
        const p = BF.app.openBook(ann.bookId);
        if (p && p.then) p.then(jump).catch(function (e) { BF.err.report('annGoto', e); });
        else jump();
      } else jump();
    }
    function _renderAnnSrc(ann) {
      const box = document.getElementById('ai-ann-src');
      if (!box || !ann) return;
      box.innerHTML =
        '<div style="border:1px solid var(--border);border-radius:var(--r-sm);padding:8px 10px;font-size:12px">' +
        '<div style="color:var(--text-weak);font-size:11px;margin-bottom:4px">标注出处（随本次问书注入）</div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">' +
        '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-dim)">《' + BF.dom.esc(ann.title || '') + '》第' + ((ann.chapterIdx || 0) + 1) + '章 · ' + BF.dom.esc(String(ann.text || '').slice(0, 80)) + '</span>' +
        '<button class="btn btn-xs" data-ai-ann-goto style="flex-shrink:0">定位原文</button></div></div>';
      const g = box.querySelector('[data-ai-ann-goto]');
      if (g) g.addEventListener('click', function () { _gotoAnn(ann); });
    }
    /* AI 问答引用出处卡片——回答中的引用文本反查为定位锚
       （段索引 si + 段内偏移 so，与 BF.cfi 偏移真源同一套规则），
       点击卡片跳回原文位置。引用文与原文做模糊匹配：去空白与
       标点后子串匹配；整句未命中时按省略号分段取最长段、再退
       化为前缀窗口（AI 引用可能省中段或微调首尾）。取材书：
       标注喂 AI 时取出处书（跨书引用先开出处书再跳），否则取
       问书当前书。与选中栏第九键「问 AI」互补：第九键取材于
       选中文本，此处把回答引用锚回原文。 */
    function _citeNormMap(s) {
      const raw = String(s || '');
      let n = '';
      const map = [];
      for (let i = 0; i < raw.length; i++) {
        const c = raw.charAt(i);
        if (/\s/.test(c)) continue;
        if ('，。！？、；：「」『』“”‘’（）《》【】—…·,.!?;:\'"()[]<>'.indexOf(c) >= 0) continue;
        n += c;
        map.push(i);
      }
      return { n: n, map: map };
    }
    /* 「引用太短无法定位」与「正文真没找到」必须可区分：同为 null 时调用方分不开——
       过短引用会让全书逐章空扫（最多 200 章）后才以「未找到」收场，
       文案还会把两种失败混成一句。因此过短走 LOCATE_TOO_SHORT 哨兵，
       匹配算法维持原样，只有短路点的返回值不同。 */
    const LOCATE_TOO_SHORT = { tooShort: true };
    function _locateInParas(quote, paras) {
      const q = _citeNormMap(quote);
      if (q.n.length < 6) return LOCATE_TOO_SHORT;
      /* 省略号分段表与前缀窗口只依赖引用本身——原写在段循环里，
         每段重算一遍 split+sort；提到循环外全书只算一次。匹配结果逐字不变。 */
      const ellSegs = q.n.split(/…+/).filter(function (x) { return x.length >= 8; }).sort(function (a, b) { return b.length - a.length; });
      for (let pi = 0; pi < paras.length; pi++) {
        const p = _citeNormMap(paras[pi]);
        if (!p.n.length || p.n.length < Math.min(6, q.n.length)) continue;   /* 短段连前缀窗口都容不下，先剪枝 */
        let idx = p.n.indexOf(q.n);
        if (idx < 0) {
          /* 整句未命中：按省略号分段取最长段匹配 */
          for (let k = 0; k < ellSegs.length; k++) {
            idx = p.n.indexOf(ellSegs[k]);
            if (idx >= 0) break;
          }
        }
        if (idx < 0) {
          /* 前缀窗口回退：引用首尾可能被微调 */
          for (let w = Math.min(24, q.n.length); w >= 10; w -= 2) {
            idx = p.n.indexOf(q.n.slice(0, w));
            if (idx >= 0) break;
          }
        }
        if (idx >= 0 && p.map[idx] != null) return { si: pi, so: p.map[idx] };
      }
      return null;
    }
    function _extractCitations(answer) {
      const found = [];
      const seen = {};
      const push = function (t) {
        const s = String(t || '').trim();
        if (s.length < 8 || found.length >= 5) return;
        const key = _citeNormMap(s).n;
        if (key.length < 6 || seen[key]) return;
        seen[key] = 1;
        found.push(s);
      };
      const lines = String(answer || '').split('\n');
      let bq = [];
      const flushBq = function () { if (bq.length) { push(bq.join(' ')); bq = []; } };
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        if (ln.indexOf('>') === 0) { bq.push(ln.replace(/^>\s?/, '')); continue; }
        flushBq();
        let m = /「([^」]{8,})」/g;
        let r;
        while ((r = m.exec(ln)) !== null) push(r[1]);
        m = /"([^"]{8,})"/g;
        while ((r = m.exec(ln)) !== null) push(r[1]);
      }
      flushBq();
      return found;
    }
    function _scanBookFor(quote, book, firstChapters) {
      const total = (book && book.totalChapters) || 0;
      if (!total) return Promise.resolve(null);
      /* 扫描顺序：当前章 → 回答标注的章（回答要求标注出自第几章）
         → 全书兜底（大书封顶 200 章，超出范围在答复中明示） */
      const order = [];
      const tried = {};
      const curBook = BF.reader.state.book;
      if (curBook && book && curBook.id === book.id) {
        const cur = BF.appState.currentChapterIdx || 0;
        if (cur >= 0 && cur < total) { order.push(cur); tried[cur] = 1; }
      }
      for (let i = 0; i < firstChapters.length && i < 8; i++) {
        const c = firstChapters[i];
        if (typeof c === 'number' && c >= 0 && c < total && !tried[c]) { tried[c] = 1; order.push(c); }
      }
      const cap = Math.min(total, 200);
      for (let i = 0; i < cap; i++) {
        if (!tried[i]) { order.push(i); tried[i] = 1; }
      }
      let k = 0;
      const next = function () {
        if (k >= order.length) return Promise.resolve(null);
        const ci = order[k++];
        return BF.library.getChapterText(book, ci).then(function (text) {
          const paras = String(text || '').split('\n').filter(function (x) { return x.trim(); });
          const loc = _locateInParas(quote, paras);
          if (loc && loc.si != null) return { chapterIdx: ci, si: loc.si, so: loc.so };
          /* 过短引用在任何章都不可能命中：短路放弃整本书，不再逐章空扫 */
          if (loc === LOCATE_TOO_SHORT) return LOCATE_TOO_SHORT;
          return next();
        }).catch(function () { return next(); });
      };
      return next();
    }
    function _resolveCitations(answer, book, firstChapters) {
      const quotes = _extractCitations(answer);
      if (!book || !quotes.length) return Promise.resolve({ cites: [], hadQuotes: false });
      const chNums = (firstChapters || []).slice();
      const chRe = /第\s*(\d{1,4})\s*章/g;
      let cm;
      while ((cm = chRe.exec(String(answer || ''))) !== null) {
        const n = parseInt(cm[1], 10) - 1;
        if (n >= 0 && chNums.indexOf(n) < 0) chNums.push(n);
      }
      let k = 0;
      const cites = [];
      let tooShort = 0;
      const step = function () {
        if (k >= quotes.length) return Promise.resolve({ cites: cites, hadQuotes: true, tooShort: tooShort });
        const q = quotes[k++];
        return _scanBookFor(q, book, chNums).then(function (loc) {
          if (loc && loc.si != null) cites.push({ text: q, bookId: book.id, title: book.title, chapterIdx: loc.chapterIdx, si: loc.si, so: loc.so });
          else if (loc === LOCATE_TOO_SHORT) tooShort++;
          return step();
        }).catch(function () { return step(); });
      };
      return step();
    }
    function _renderCiteSrc(res) {
      const box = document.getElementById('ai-cite-src');
      if (!box) return;
      if (!res.cites.length) {
        /* 有引用但未定位：明示未命中，不静默失败；
           过短与真没找到要分级陈述，不混成一句 */
        box.innerHTML = res.hadQuotes
          ? '<div style="color:var(--text-weak);font-size:11px;margin-top:4px">' +
            (res.tooShort ? '部分引用过短（归一化后少于 6 字）无法定位；其余引用未定位到原文（文本可能已改写或超出扫描范围）'
              : '引用未定位到原文（文本可能已改写或超出扫描范围）') + '</div>'
          : '';
        return;
      }
      box.innerHTML =
        '<div style="border:1px solid var(--border);border-radius:var(--r-sm);padding:8px 10px;font-size:12px">' +
        '<div style="color:var(--text-weak);font-size:11px;margin-bottom:4px">引用出处（反查原文定位）</div>' +
        res.cites.map(function (c, i) {
          return '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-top:4px">' +
            '<span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--text-dim)">《' + BF.dom.esc(c.title || '') + '》第' + (c.chapterIdx + 1) + '章 · ' + BF.dom.esc(String(c.text || '').slice(0, 80)) + '</span>' +
            '<button class="btn btn-xs" data-ai-cite-goto="' + i + '" style="flex-shrink:0">定位原文</button></div>';
        }).join('') + '</div>';
      box.querySelectorAll('[data-ai-cite-goto]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          const c = res.cites[parseInt(btn.getAttribute('data-ai-cite-goto'), 10)];
          if (c) _gotoCite(c);
        });
      });
    }
    function _gotoCite(c) {
      if (!c) return;
      try { BF.sheet.close('ai-center'); } catch (e) {}
      const jump = function () {
        BF.reader.gotoChapter(c.chapterIdx);
        BF.timers.timeout(function () {
          const paras = BF.reader.state.paras || [];
          if (paras.length && typeof c.si === 'number') {
            BF.reader.gotoCharOffset(BF.cfi.locToOffset({ si: c.si, so: c.so }, paras), { highlight: true, q: c.text });
          }
        }, 120);
      };
      /* 跨书引用：先打开出处书再跳（标注喂 AI 的出处可能来自他书） */
      if (c.bookId && c.bookId !== BF.appState.currentBookId) {
        const p = BF.app.openBook(c.bookId);
        if (p && p.then) p.then(jump).catch(function (e) { BF.err.report('citeGoto', e); });
        else jump();
      } else jump();
    }
    /* 统一执行入口：记录上次参数以支持「重新生成」（force 绕过摘要缓存） */
    /* 推理过程（深度思考模型）：流式累积 + 250ms 合并重画，收进默认折叠的块里。
       开关是 details 自身的展开态——重画时保留用户已经点开的决定。 */
    let _reason = '', _reasonT0 = 0, _reasonT1 = 0, _reasonT = null;
    function _paintReason() {
      const box = document.getElementById('ai-reason');
      if (!box) return;
      if (!_reason) { box.innerHTML = ''; return; }
      const secs = _reasonT0 ? Math.max(1, Math.round(((_reasonT1 || Date.now()) - _reasonT0) / 1000)) : 0;
      const keepOpen = !!box.querySelector('details[open]') ? ' open' : '';
      box.innerHTML = '<details class="bf-fold ai-reason"' + keepOpen + '>' +
        '<summary>已深度思考' + (secs ? ' · ' + secs + 's' : '') + ' · ' + _reason.length + ' 字</summary>' +
        '<div>' + BF.dom.esc(_reason) + '</div></details>';
    }
    function _feedReason(t) {
      if (!t) return;
      if (!_reasonT0) _reasonT0 = Date.now();
      _reasonT1 = Date.now();
      _reason += t;
      if (_reasonT) return;
      _reasonT = BF.timers.timeout(function () { _reasonT = null; _paintReason(); }, 250);
    }
    function _resetReason() {
      _reason = ''; _reasonT0 = 0; _reasonT1 = 0;
      if (_reasonT) { try { _reasonT(); } catch (e) {} _reasonT = null; }
      const box = document.getElementById('ai-reason');
      if (box) box.innerHTML = '';
    }
    let _lastRun = null;
    function _run(cardId, opts) {
      _lastRun = { cardId: cardId, opts: Object.assign({}, opts) };
      _resetReason();
      _setActions('running');
      /* Agent 与普通对话区分：跑起来先亮状态条（呼吸点 + 扫光），完成留用时后自动收起 */
      if (cardId === 'agent') {
        try { _aiBox.classList.remove('ai-agent-answer'); } catch (e) {}
        _agentStrip(true, 'Agent 运行中 · 会调用本地工具检索');
      }
      /* 新回答开始前清旧引用卡片（结果区整体重渲，卡片随新回答重出） */
      const _citeBox = document.getElementById('ai-cite-src');
      if (_citeBox) _citeBox.innerHTML = '';
      BF.ai.runCard(cardId, Object.assign({}, opts, {
        onReasoning: _feedReason,
        /* 流式每 token 全量 markdown 重渲 + sanitize 是 O(n²)，
           长回答掉帧主因。流中期最多 80ms 合并重画一次（永远拿最新累计文本），
           末帧（非 streaming 调用）清计时器立即全量渲染——最终呈现逐字不变。 */
        setResult: (function () {
          let _rrT = null, _pending = null;
          return function (text, streaming) {
            if (!streaming) {
              if (_rrT) { clearTimeout(_rrT); _rrT = null; }
              _pending = null;
              _renderResult(text);
              return;
            }
            _pending = text;
            if (_rrT) return;
            _rrT = setTimeout(function () {
              _rrT = null;
              const t = _pending; _pending = null;
              if (t != null) _renderResult(t, true);
            }, 80);
          };
        })(),
      })).then(function (content) {
        _setActions('done');
        _aiBusy = false;
        _paintReason();
        if (cardId === 'agent') {
          try { if (content) _agentTag(); } catch (e) {}
          _agentStrip(false);
        }
        if (cardId === 'ask' && opts.question && opts.bookId) {
          BF.ai.askHistoryPush(opts.bookId, opts.question, content);
          _renderThread();
        }
        /* 标注喂 AI 完成——回答下方附出处卡片；
           一次性注入语义：暂存清空（重新生成走
           _lastRun.opts.ann 保留出处，不依赖暂存） */
        if (cardId === 'ask' && opts.ann) {
          _renderAnnSrc(opts.ann);
          BF.ai._annCtx = null;
        }
        /* AI 回答引用出处卡片——引用文本反查为定位锚。
           取材书：标注喂 AI 时取出处书（引用可能来自他书），
           否则取问书当前书。反查为异步（逐章取正文模糊匹配），
           卡片在解析完成后挂到回答下方 */
        if (cardId === 'ask') {
          const _citeBookId = (opts.ann && opts.ann.bookId) || opts.bookId;
          const _citeBook = _citeBookId
            ? BF.store.lsGetArray(BF.store.K.BOOKS_META, []).find(function (x) { return x && x.id === _citeBookId; })
            : null;
          _resolveCitations(content, _citeBook,
            (opts.ann && typeof opts.ann.chapterIdx === 'number') ? [opts.ann.chapterIdx] : []
          ).then(function (res) { _renderCiteSrc(res); }).catch(function () {});
        }
      }).catch(function (e) {
        _setActions('idle');
        _aiBusy = false;
        if (cardId === 'agent') _agentStrip(false);
        if (e && e.name === 'AbortError') {
          _aiBox.insertAdjacentHTML('beforeend', '<div style="color:var(--text-weak);font-size:12px;margin-top:6px">（已停止）</div>');
        } else {
          _aiBox.innerHTML = '<div style="color:var(--danger-ink)">失败：' + BF.dom.esc(e.message || '') + '</div>';
        }
      });
    }
    BF.ai.renderCards(document.getElementById('ai-cards'));
    /* 卡片点击 */
    document.getElementById('ai-cards').querySelectorAll('[data-ai-card]').forEach(function (card) {
      card.addEventListener('click', function (ev) {
        /* 「提示词：X」那行是另一件事：跳到提示词面板并定位那一条，不该顺手把卡片也跑了 */
        const jump = ev.target && ev.target.closest ? ev.target.closest('[data-prompt-jump]') : null;
        if (jump) {
          ev.stopPropagation();
          BF.ai.promptEditor && BF.ai.promptEditor.open(jump.dataset.promptJump);
          return;
        }
        const id = card.dataset.aiCard;
        if (id === 'ask') { const inp = document.getElementById('ai-ask-input'); if (inp) inp.focus(); return; }
        if (id === 'gather') {
          /* 聚会的产物是一张「建议卡」而不是流式文本，所以不进 _run；
             提问入口就在这：把问书输入框当「聚会要求」的来源 */
          const inp = document.getElementById('ai-ask-input');
          const q = inp ? inp.value.trim() : '';
          if (BF.settings.get('aiImportEnhance') === false && !q) {
            BF.noti.info('可以先在输入框写下你的偏好（例：按适合睡前读来聚），再点这张卡');
          }
          BF.smart.aiGather({ question: q });
          return;
        }
        if (id === 'agent') {
          /* Agent 模式复用问书输入框：没输问题就没法跑，直接聚焦而不是静默失败 */
          const inp = document.getElementById('ai-ask-input');
          if (inp && !inp.value.trim()) { inp.focus(); BF.noti.info('先写下要交给 Agent 的问题'); return; }
          _run('agent', { question: inp.value.trim() });
          return;
        }
        _run(id, {});
      });
    });
    /* 重新生成：清缓存强制重跑上次（结果区动作栏与底部按钮共用这一个入口） */
    function _doRerun() {
      if (!_lastRun) return;
      _lastRun.opts.force = true;
      _run(_lastRun.cardId, _lastRun.opts);
    }
    const rerunBtn = document.querySelector('[data-ai-rerun]');
    if (rerunBtn) rerunBtn.addEventListener('click', _doRerun);
    /* 头部两枚入口：任务面板展开/收起、新开一段对话 */
    const tasksBtn = document.querySelector('[data-ai-tasks]');
    const cardsWrap = document.getElementById('ai-cards-wrap');
    if (tasksBtn && cardsWrap) tasksBtn.addEventListener('click', function () {
      /* 开合状态只用 aria-expanded 表达：这套界面的激活态只有一个来源，不另起自定义类名 */
      const open = cardsWrap.hasAttribute('hidden');
      if (open) { cardsWrap.removeAttribute('hidden'); } else { cardsWrap.setAttribute('hidden', ''); }
      tasksBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
    const newBtn = document.querySelector('[data-ai-new]');
    if (newBtn) newBtn.addEventListener('click', function () {
      const bid = BF.appState.currentBookId;
      if (!bid) { BF.noti.info('先打开一本书。对话按书归档'); return; }
      try {
        BF.ai.askNew(null, bid);
        _renderSessions(); _renderThread();
        const hw = document.getElementById('ai-history-wrap');
        if (hw) hw.setAttribute('hidden', '');
        const hb = document.querySelector('[data-ai-history]');
        if (hb) hb.setAttribute('aria-expanded', 'false');
        const inp = document.getElementById('ai-ask-input');
        if (inp) inp.focus();
      } catch (e) { BF.err.report('ai.newSession', e); }
    });
    /* 历史对话：展开/收起（展开时把列表重画一遍，拿到最新的标题与时间） */
    const histBtn = document.querySelector('[data-ai-history]');
    const histWrap = document.getElementById('ai-history-wrap');
    if (histBtn && histWrap) histBtn.addEventListener('click', function () {
      const willOpen = histWrap.hasAttribute('hidden');
      if (willOpen) { histWrap.removeAttribute('hidden'); _renderSessions(); }
      else { histWrap.setAttribute('hidden', ''); }
      histBtn.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    });
    /* Agent 出列：它不是"任务卡"，是一个模式入口——按输入框里的问题跑一轮 Agent */
    const agentBtn = document.querySelector('[data-ai-agent]');
    if (agentBtn) agentBtn.addEventListener('click', function () {
      const inp = document.getElementById('ai-ask-input');
      const q = inp ? inp.value.trim() : '';
      if (!q) { if (inp) inp.focus(); BF.noti.info('先在输入框写下要交给 Agent 的问题'); return; }
      if (inp) { inp.value = ''; try { inp.style.height = ''; } catch (e) {} }
      _run('agent', { question: q });
    });
    const gotoKeyBtn = document.querySelector('[data-ai-goto-key]');
    if (gotoKeyBtn) gotoKeyBtn.addEventListener('click', function () {
      try { BF.settingsUI.open(); if (BF.settingsUI._jumpToSec) BF.settingsUI._jumpToSec('ai'); } catch (e) { BF.err.report('ai.gotoKey', e); }
    });
    /* 问书 */
    const askBtn = document.querySelector('[data-ai-ask-btn]');
    const askInput = document.getElementById('ai-ask-input');
    /* 防重：AI 请求进行中禁止再发（快速双击/连按 Enter 会并发两个请求，
       额度浪费且结果互相覆盖）。_run 结束（成功/失败/停止）时解除。 */
    let _aiBusy = false;
    const doAsk = function () {
      /* 生成中同一颗按钮就是「停止」：点它中止，不再发新问题 */
      if (askBtn && askBtn.hasAttribute('data-ai-stop')) {
        if (BF.ai._abortCtrl) { try { BF.ai._abortCtrl.abort(); } catch (e) {} }
        return;
      }
      if (_aiBusy) { BF.noti.info('AI 正在生成，请稍候或点「停止」'); return; }
      const q = askInput.value.trim();
      if (!q) return;
      const bookId = BF.appState.currentBookId;
      const hist = bookId ? BF.ai.askHistory(bookId).slice(-12) : [];
      askInput.value = '';
      try { askInput.style.height = ''; } catch (e) {}
      _aiBusy = true;
      /* 标注喂 AI——暂存出处随当次问书注入
         （_annCtx 由标注中心「问 AI」写入；答完
         由 _run 的 then 回调清空，一次性语义） */
      _run('ask', { question: q, history: hist, bookId: bookId, ann: BF.ai._annCtx || null });
    };
    if (askBtn) askBtn.onclick = doAsk;
    if (askInput) {
      askInput.addEventListener('keydown', function (e) {
        /* 中文输入法组词中的 Enter 是选词，不是发送 */
        if (e.isComposing || e.keyCode === 229) return;
        if (e.key !== 'Enter') return;
        if (e.shiftKey) return;          /* Shift+Enter 换行 */
        if (e.ctrlKey || e.metaKey || !e.altKey) { e.preventDefault(); doAsk(); }
      });
      /* 多行输入自增高：2 行起步，超过 160px 内部滚动 */
      askInput.addEventListener('input', function () {
        try {
          askInput.style.height = 'auto';
          askInput.style.height = Math.min(160, askInput.scrollHeight) + 'px';
        } catch (e) {}
      });
    }
  }
  return { open, toggle, render, runExplain: function (text) {
    /* 选中文本 → 段落解析（右键菜单「AI 提问」入口）。不注入整章正文，仅解析选中片段；
       复用 aiUI 的渲染与结果区，AI 失败/无 key 时给出可见提示，不静默。 */
    try { BF.aiUI.open(); } catch (e) { BF.err.report('runExplain.open', e); }
    const box = document.getElementById('ai-result');
    if (box) box.innerHTML = '<div style="color:var(--text-weak);font-size:12px">正在解析选中内容…</div>';
    const txt = String(text || '').trim();
    if (!txt) { if (box) box.innerHTML = '<div style="color:var(--danger-ink)">没有可解析的选中文本</div>'; return; }
    BF.ai.runCard('explain', { content: txt }).then(function (content) {
      if (content == null) return;   /* 无 key 时 runCard 已 toast 提示 */
      if (box) box.innerHTML = BF.dom.sanitize(BF.md ? BF.md.render(content) : BF.dom.esc(content));
    }).catch(function (e) {
      BF.err.report('runExplain', e);
      if (box) box.innerHTML = '<div style="color:var(--danger-ink)">解析失败：' + BF.dom.esc((e && e.message) || '未知错误') + '</div>';
    });
  } };
})();

/* ============================================================
   北风 · 标注跨书聚合视图
   全库四类标注聚合：按书分组（默认）/ 按时间倒序两模式；
   每条「定位」走偏移真源（loc 优先 → charOffset 回退
   → 生词按词定位），跨书先开出处书再跳——与标注中心
   「原文」按钮、AI 出处卡片同一纪律。
   ============================================================ */
BF.annAcross = (function () {
  let _mode = 'book';   /* 按书（默认）/ 按时间 */
  /* 标签过滤态。空串 = 全部（不过滤） */
  let _tagFilter = '';
  /* 命名为 _gather 而非 _collect：全库另有
     备份恢复的 _collect 真源（锚点抽取按
     _collect 函数定义定位执行），
     同名会令测试锚点漂移——本函数刻意避撞 */
  function _gather() {
    const books = BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || [];
    const titleOf = function (bid) {
      const b = books.find(function (x) { return x && x.id === bid; });
      return (b && b.title) || '（未知书）';
    };
    const items = [];
    (BF.store.lsGetArray(BF.store.K.HIGHLIGHTS, []) || []).forEach(function (x) {
      if (x) items.push({ kind: 'hl', type: '划线', text: x.text || '', ch: x.chapterIdx, off: x.charOffset, loc: x.loc || null, bookId: x.bookId, t: x.created || 0 });
    });
    (BF.store.lsGetArray(BF.store.K.BOOKMARKS, []) || []).forEach(function (x) {
      if (x) items.push({ kind: 'bm', type: '书签', text: x.text || '（位置书签）', ch: x.chapterIdx, off: x.charOffset, loc: x.loc || null, bookId: x.bookId, t: x.created || 0 });
    });
    (BF.store.lsGetArray(BF.store.K.VOCAB, []) || []).forEach(function (x) {
      if (x) items.push({ kind: 'voc', type: '生词', text: x.word || '', ch: x.chapterIdx, off: x.charOffset, loc: x.loc || null, bookId: x.bookId, t: x.created || 0 });
    });
    (BF.store.lsGetArray(BF.store.K.NOTES, []) || []).forEach(function (x) {
      /* 便签是唯一带 tags 的标注类型（BF.notes.create 建时就写 tags:[]），
         划线/书签/生词三个键没有该字段。防御性判断——历史便签可能没有
         tags，或 tags 被写成非数组（与 BF.notes.tagsOf 同口径）。 */
      if (x) items.push({ kind: 'note', id: x.id, type: '便签', text: (x.title ? x.title + '：' : '') + (x.text || ''), ch: x.chapterIdx, off: x.charOffset, loc: x.loc || null, bookId: x.bookId, t: x.created || x.updated || 0, tags: Array.isArray(x.tags) ? x.tags : [] });
    });
    items.sort(function (a, b) { return (b.t || 0) - (a.t || 0); });
    return { items: items, titleOf: titleOf };
  }
  /* 行渲染（索引 i 指向 _collect().items——定位按钮
     按下标取条目，稳定不随行内过滤漂移） */
  function _row(it, i, bookTitle) {
    const time = it.t ? new Date(it.t).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
    /* 定位按钮同标注中心「原文」门控
       （仅 typeof it.ch === 'number' 渲染）——无位置
       便签（W3C 导入 ingest 不落 chapterIdx）无定位
       入口：给缺 chapterIdx 条目渲染按钮是死胡同
       （gotoChapter(0) 后三段定位全不命中、无反馈） */
    const gotoBtn = (typeof it.ch === 'number')
      ? '<button class="btn btn-xs" data-ann-across-goto="' + i + '" style="flex-shrink:0">定位</button>' : '';
    /* 章号呈现：缺 chapterIdx 标「（未定位）」，
       不能按 (it.ch || 0) + 1 误呈「第1章」 */
    const chLabel = (typeof it.ch === 'number')
      ? '第' + (it.ch + 1) + '章' : '（未定位）';
    return '<div style="padding:6px 8px;border:1px solid var(--border);border-radius:var(--r-sm);font-size:12px;margin-bottom:4px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px">' +
      '<span style="color:var(--accent-ink);font-size:11px;flex-shrink:0">[' + it.type + ']</span>' +
      '<span style="color:var(--text);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + BF.dom.esc(it.text) + '</span>' +
      gotoBtn + '</div>' +
      '<div style="color:var(--text-weak);font-size:10px;margin-top:2px">' + chLabel +
      (bookTitle ? ' · 《' + BF.dom.esc(bookTitle) + '》' : '') +
      (time ? ' · ' + time : '') + '</div>' +
      /* 标签徽章。无标签时整段不渲染，不留空占位行 */
      ((it.tags && it.tags.length)
        ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-top:4px">' + it.tags.map(function (tg) {
            return '<span style="display:inline-block;padding:1px 6px;border-radius:999px;font-size:10px;line-height:1.6;color:var(--accent-ink);background:color-mix(in srgb, var(--accent) 14%, transparent)">' + BF.dom.esc(tg) + '</span>';
          }).join('') + '</div>'
        : '') + '</div>';
  }
  /* 定位：跨书先开出处书，章内走偏移真源 */
  function _goto(it) {
    const jump = function () {
      BF.reader.gotoChapter(typeof it.ch === 'number' ? it.ch : 0);
      BF.timers.timeout(function () {
        const paras = BF.reader.state.paras || [];
        if (it.loc && typeof it.loc.si === 'number' && paras.length) {
          const L = BF.cfi.locate(it.loc, paras);
          if (L && L.match && L.si >= 0) {
            const off = BF.cfi.locToOffset({ si: L.si, so: L.so }, paras);
            BF.reader.gotoCharOffset(off, { highlight: true, q: it.text || undefined });
            return;
          }
        }
        if (typeof it.off === 'number') {
          BF.reader.gotoCharOffset(it.off, { highlight: true });
          return;
        }
        if (it.kind === 'voc' && it.text && paras.length) {
          for (let pi = 0; pi < paras.length; pi++) {
            const o = (paras[pi] || '').indexOf(it.text);
            if (o >= 0) { BF.reader.gotoCharOffset(BF.cfi.locToOffset({ si: pi, so: o }, paras), { highlight: true, q: it.text }); return; }
          }
        }
      }, 120);
    };
    if (it.bookId && it.bookId !== BF.appState.currentBookId) {
      const p = BF.app.openBook(it.bookId);
      if (p && p.then) p.then(jump).catch(function (e) { BF.err.report('annAcross.goto', e); });
      else jump();
    } else jump();
  }
  function render() {
    const c = document.getElementById('ann-across-body');
    if (!c) return;
    const _d = _gather();
    const items = _d.items;
    /* 标签过滤条。标签集从**全部**标注聚合（不是过滤后的），
       否则一旦选中某个标签，其它标签就从条上消失、再也切不回来。
       排序按出现次数降序，与 BF.notes.allTags 同口径。 */
    const _tagCount = new Map();
    items.forEach(function (it) {
      (it.tags || []).forEach(function (tg) { if (tg) _tagCount.set(tg, (_tagCount.get(tg) || 0) + 1); });
    });
    const _tags = Array.from(_tagCount.entries()).sort(function (a, b) { return b[1] - a[1]; }).map(function (e) { return e[0]; });
    /* 过滤后的展示集合：**保留原始下标 i**，定位按钮 data-ann-across-goto
       在点击时回查的是 items[i]，若改用过滤后数组的下标，
       过滤后下标与 items 不再对应 → 点「定位」会跳到**别的标注**。
       故过滤在元素上做，索引始终取自原始 items。 */
    const _shown = items.filter(function (it) {
      if (!_tagFilter) return true;
      return !!(it.tags && it.tags.indexOf(_tagFilter) >= 0);
    });
    /* 行定位索引预建一次——逐行 items.indexOf(it) 是双份线性扫，
       大库聚合视图 O(n²)。索引仍指向原 items，定位语义逐字不变。 */
    const _idxOf = new Map();
    items.forEach(function (it, i) { _idxOf.set(it, i); });
    let listHtml;
    if (!items.length) {
      listHtml = '<div class="cmdk-empty">还没有一条标注。阅读时划下的句子，会在这里聚成你的书摘</div>';
    } else if (!_shown.length) {
      /* 空态区分：全库有标注但当前标签过滤命中 0 条 —— 与上面「全库无标注」不同，
         文案要点明是过滤造成的，并提示怎么回去，避免用户以为标注丢了。 */
      listHtml = '<div class="cmdk-empty">没有带「' + BF.dom.esc(_tagFilter) + '」标签的标注（点上方标签或「全部」查看全部 ' + items.length + ' 条）</div>';
    } else if (_mode === 'time') {
      listHtml = _shown.map(function (it) { return _row(it, _idxOf.get(it), _d.titleOf(it.bookId)); }).join('');
    } else {
      const groups = [];
      const idx = {};
      _shown.forEach(function (it) {
        const bid = it.bookId || '';
        if (!(bid in idx)) { idx[bid] = groups.length; groups.push({ bid: bid, title: _d.titleOf(bid), list: [] }); }
        groups[idx[bid]].list.push({ it: it, i: _idxOf.get(it) });
      });
      listHtml = groups.map(function (g) {
        return '<div style="margin-bottom:10px">' +
          '<div style="font-size:12px;color:var(--text-dim);margin-bottom:4px">《' + BF.dom.esc(g.title) + '》 <b style="color:var(--accent-ink)">' + g.list.length + '</b> 条</div>' +
          g.list.map(function (e) { return _row(e.it, e.i); }).join('') + '</div>';
      }).join('');
    }
    c.innerHTML = '<div style="display:flex;gap:6px;margin-bottom:10px" role="tablist">' +
      '<button class="btn btn-xs' + (_mode === 'book' ? ' primary' : '') + '" data-ann-mode="book" role="tab" aria-selected="' + (_mode === 'book') + '">按书</button>' +
      '<button class="btn btn-xs' + (_mode === 'time' ? ' primary' : '') + '" data-ann-mode="time" role="tab" aria-selected="' + (_mode === 'time') + '">按时间</button></div>' +
      /* 标签过滤条（行内 style，不新增全局 CSS）。无任何标签时整条不渲染。 */
      (_tags.length
        ? '<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px" role="group" aria-label="按标签过滤">' +
          '<button class="btn btn-xs' + (_tagFilter ? '' : ' primary') + '" data-ann-tag="" aria-pressed="' + (!_tagFilter) + '">全部 ' + items.length + '</button>' +
          _tags.map(function (tg) {
            return '<button class="btn btn-xs' + (_tagFilter === tg ? ' primary' : '') + '" data-ann-tag="' + BF.dom.esc(tg) + '" aria-pressed="' + (_tagFilter === tg) + '">' + BF.dom.esc(tg) + ' ' + _tagCount.get(tg) + '</button>';
          }).join('') + '</div>'
        : '') +
      '<div id="ann-across-list" style="max-height:calc(84vh - 150px);overflow-y:auto">' + listHtml + '</div>';
    c.querySelectorAll('[data-ann-mode]').forEach(function (btn) {
      btn.addEventListener('click', function () { _mode = btn.dataset.annMode; render(); });
    });
    /* 点标签切换过滤，再点同一标签取消回「全部」。
       用 dataset 读取而非拼接进 HTML 属性，避免标签名里的引号破版。 */
    c.querySelectorAll('[data-ann-tag]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const v = btn.dataset.annTag || '';
        _tagFilter = (_tagFilter === v) ? '' : v;
        render();
      });
    });
    c.querySelectorAll('[data-ann-across-goto]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        const i = parseInt(btn.dataset.annAcrossGoto, 10);
        const it = items[i];
        if (!it) return;
        try { BF.sheet.close('ann-across'); } catch (e) {}
        _goto(it);
      });
    });
  }
  function open() {
    BF._panel('ann-across', '标注跨书聚合', {
      cls: 'dlg-shell',   /* 标注跨书聚合：四项全用默认值 */
      bodyId: 'ann-across-body',
      bodyCss: 'padding:var(--sp-4);flex:0 1 auto',
    });
    BF.sheet.open('ann-across', { render: render });
  }
  return { open: open, render: render, _gather: _gather, goto: _goto };
})();

/* 注册命令 */
BF.commands.register({ id: 'ai.center', label: 'AI 研读中心', keywords: 'ai 研读 阅读中心 智能', cat: 'AI', run: function () { BF.aiUI.open(); } });
BF.commands.register({ id: 'ai.exportAskMd', label: '导出问书记录（Markdown）', keywords: 'export 导出 问书 对话 记录 md markdown 聊天', cat: 'AI', run: function () { BF.ai.exportAskHistory(null, 'md'); } });
BF.commands.register({ id: 'ai.exportAskJson', label: '导出问书记录（JSON）', keywords: 'export 导出 问书 对话 记录 json 原始', cat: 'AI', run: function () { BF.ai.exportAskHistory(null, 'json'); } });

/* ============================================================
   北风 · 轻量 Markdown 渲染（AI 输出用，配合 sanitize 白名单）
   ============================================================ */
BF.md = (function () {
  /* 只转 & < >：链接 URL 在这之后才提取，引号若先转成实体，
     escAttr 会把 & 再转一遍，href 里就留下字面的 &quot;。 */
  function esc(s) {
    return String(s).replace(/[&<>]/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c];
    });
  }
  /* 内联链接的 href 必须既转义引号又过滤协议，否则
     `[x](https://a.com" onclick="alert(1))` 可注入属性，
     `[x](javascript:alert(1))` 点击即执行。统一走 _safeHref：
     先剔除控制字符与空白（浏览器导航 URL 时也会剥，故必须剥了再判），
     取 scheme 判白名单（http/https/mailto，其余一律降级为 #），
     最后经 escAttr 转义后写入属性。 */
  function escAttr(s) { return BF.dom.esc(s); }
  function _safeHref(u) {
    const v = String(u == null ? '' : u).replace(/[\u0000-\u0020]+/g, '');
    if (!v) return '#';
    const m = /^([a-z][a-z0-9+.\-]*):/i.exec(v);
    if (m) {
      const sch = m[1].toLowerCase();
      if (sch !== 'http' && sch !== 'https' && sch !== 'mailto') return '#';
    }
    return v;   /* 无 scheme：相对地址 / 锚点 / 协议相对，放行 */
  }
  function inline(s) {
    let t = esc(s);
    t = t.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
    t = t.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, function (whole, label, url) {
      return '<a href="' + escAttr(_safeHref(url)) + '" target="_blank" rel="noopener">' + label + '</a>';
    });
    return t;
  }
  function render(text) {
    if (!text) return '';
    const lines = String(text).split('\n');
    let html = '';
    let inCode = false;
    for (const line of lines) {
      if (/^```/.test(line)) {
        html += inCode ? '</pre>' : '<pre>';
        inCode = !inCode;
        continue;
      }
      if (inCode) { html += BF.dom.esc(line) + '\n'; continue; }
      const t = line.trim();
      if (!t) { html += '<br/>'; continue; }
      if (/^#{1,6}\s/.test(t)) {
        const level = t.match(/^#+/)[0].length;
        html += '<h' + Math.min(level, 4) + '>' + inline(t.replace(/^#+\s/, '')) + '</h' + Math.min(level, 4) + '>';
      } else if (/^[-*]\s/.test(t)) {
        html += '<li>' + inline(t.replace(/^[-*]\s/, '')) + '</li>';
      } else if (/^\d+\.\s/.test(t)) {
        html += '<li>' + inline(t.replace(/^\d+\.\s/, '')) + '</li>';
      } else {
        html += '<p>' + inline(t) + '</p>';
      }
    }
    if (inCode) html += '</pre>';
    return html;
  }
  return { render, esc };
})();

/* ============================================================
   北风 · workspace 域（一）：番茄钟 / 白噪音 / 阅读目标 / 统计
   ============================================================ */

