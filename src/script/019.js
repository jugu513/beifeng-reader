/* ================= 7. BF.sheet 容器基类 ================= */
BF.sheet = (function () {
  const _open = new Set();
  /* 浮层栈：open 压栈、close 出栈，Esc 关栈顶。
     运维台/基地/帮助/DSL 等浮层的 Esc 关闭统一由 sheet 层兜底，
     启动区的 Escape 不必逐个点名处理。 */
  const _stack = [];
  /* 每个开着的层记住「自己是怎么开的」。这些事实必须只存在这里——
     散在调用点各自复述（硬编码类名、各自列遮罩、自带一套 Tab 陷阱）必然漂移。 */
  const _meta = {};   /* id → { cls, tier, sec, esc, lock, autofocus, onClose } */
  /* 开合状态的唯一通知源。v3Scrim 不得再用 MutationObserver 盯个别面板的
     class 变化去另建一套「谁开着」的推导——面板有十三个，盯住的只有两个。
     重入保护：通知里要读栈（dimmed → prune），不能再触发一轮通知。 */
  const _watchers = [];
  let _notifying = false;
  function _notify() {
    if (_notifying) return;
    _notifying = true;
    try { for (const f of _watchers) { try { f(); } catch (e) { BF.err.report('sheet.watch', e); } } }
    finally { _notifying = false; }
  }
  function subscribe(fn) { if (typeof fn === 'function') _watchers.push(fn); }
  let _ovLock = 0;
  function ovLock() { _ovLock++; document.body.style.overflow = 'hidden'; }
  function ovUnlock() {
    _ovLock = Math.max(0, _ovLock - 1);
    if (_ovLock === 0) document.body.style.overflow = '';
  }
  /* Tab 陷阱的「能不能聚焦」判据：不能用 offsetParent !== null，
     它和 content-visibility:auto 不兼容——懒渲染分区离屏时 offsetParent
     为 null，整段被当成不可聚焦滤掉，陷阱的末位元素算错，Tab 走到
     "假末位"后继续往后，焦点跑出面板。
     判据只认真正藏起来的（display:none，沿祖先链查）与 disabled；
     懒渲染分区获焦时才渲染，元素是可聚焦的，留在列表里。
     visibility:hidden 的元素不能获焦，一并排除。 */
  /* 焦点圈定名单：一次自上而下的遍历，遇到 display:none / visibility:hidden 就整棵子树剪掉。
     「对每个候选元素各调一次 getComputedStyle，且只看它自己」是两宗罪：
     ① 设置面板里每按一下 Tab 跑 3450 次样式读取，键盘有可感延迟；
     ② 藏在隐藏容器里的元素没被判出来，会被当成可聚焦项，于是 last 认错人，
     Tab 走到「假末位」后继续往后就逃出了面板。
     仍然不看 offsetParent：设置面板的 .settings-section 开了 content-visibility:auto
     懒渲染，离屏分区的 offsetParent 为 null，但元素本身可聚焦，必须留在名单里。 */
  const FOCUS_SEL = 'button,input,select,textarea,[tabindex]:not([tabindex="-1"])';
  function focusablesIn(root) {
    const out = [];
    const win = root.ownerDocument && root.ownerDocument.defaultView;
    (function walk(node) {
      for (let c = node.firstElementChild; c; c = c.nextElementSibling) {
        let cs = null;
        try { cs = win && win.getComputedStyle ? win.getComputedStyle(c) : null; } catch (e) {}
        if (cs && (cs.display === 'none' || cs.visibility === 'hidden')) continue;
        if (c.matches && c.matches(FOCUS_SEL) && !c.disabled && !c.hasAttribute('hidden')) out.push(c);
        walk(c);
      }
    })(root);
    return out;
  }
  /* 焦点名单缓存：陷阱每按一次 Tab 就重扫一遍整棵面板，而面板内容在两次按键之间
     基本不动。按面板 id 各存一份，内容一变（childList / class / style / hidden /
     disabled）就由 MutationObserver 置空，下次按键重扫。
     名单只由 focusablesIn 产生 —— 判据不在这儿，别往这里加第二条可见性判据。
     observer 随面板 close / prune 释放，否则只增不减。 */
  const _focusCache = new Map();
  let _focusObsCount = 0;
  function cachedFocusables(id, root) {
    let c = _focusCache.get(id);
    if (c && c.list) return c.list;
    const list = focusablesIn(root);
    if (!c) { c = { list: null, obs: null }; _focusCache.set(id, c); }
    c.list = list;
    if (!c.obs && root && root.ownerDocument) {
      const obs = new MutationObserver(function () { const e = _focusCache.get(id); if (e) e.list = null; });
      obs.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'disabled'] });
      c.obs = obs; _focusObsCount++;
    }
    return list;
  }
  function releaseFocusCache(id) {
    const c = _focusCache.get(id);
    if (c && c.obs) { try { c.obs.disconnect(); } catch (e) { BF.err.report('sheet.focusCache', e); } _focusObsCount = Math.max(0, _focusObsCount - 1); }
    _focusCache.delete(id);
  }
  /* 取证口径：当前缓存中的面板数与存活 observer 数 */
  function focusCacheStats() { return { panels: _focusCache.size, observers: _focusObsCount }; }
  function open(id, opts) {
    opts = opts || {};
    const el = document.getElementById(id); if (!el) return false;
    const cls = opts.cls || 'open';
    const wasOpen = _open.has(id);
    /* tier:'overlay'（模态 / 导入进度 / 快捷键速查）不参与互斥。
       默认 'panel' 才是「切换」语义：同一时刻只留一个面板，开新面板会关掉旧面板。
       没有这个区分就没有统一的关闭办法 —— 设置面板里那个「恢复默认」确认框
       一弹，closeAllExcept 会先把背后的设置面板关掉，用户答完发现自己被踢回书架。 */
    const tier = opts.tier || 'panel';
    if (!_open.has(id)) {
      if (tier === 'panel') closeAllExcept(id);
      el.classList.add(cls);
      /* opts.lock:false —— 导入进度这类「任务顺带浮出来的层」不锁滚动。
         它由异步流程开关，一旦某条路径缺了 close，锁了就再也解不开。 */
      if (opts.lock !== false) ovLock();
      /* 记录触发元素（打开前的活动元素），close 时归还焦点 */
      try { el.__bfOpener = document.activeElement; } catch (e) { el.__bfOpener = null; }
    }
    /* 已开也要刷新：模态套模态时 #modal-bg 一直是开着的，只是内容换了。
       这里若直接 return，meta 会留在第一个调用方的回调上，
       第二个 confirm/prompt 的 Promise 就永久悬着（且第一个的回调被叫两次）。 */
    _open.add(id);
    /* sec：面板内的栏（工作台的七栏 / 工具两栏 / 手册两页）。
       入口按钮要靠它区分「换栏」与「关面板」，这个事实只存在账本里，
       不写在面板自己的闭包里。
       焦点只在「这一层刚出现」时给。面板内换栏、模态就地换内容都算重开，
       不该把光标从用户正操作的地方抢走 —— 确实要重新聚焦的（确认框换了内容）显式声明 refocus。 */
    /* render 一并记进账本 —— 撤销恢复数据后，
       浮层重画通道（rerender）按层名取它，不抢焦点、
       不重开层；层关着时没有可重画的内容，静默返回。 */
    _meta[id] = { cls: cls, tier: tier, sec: opts.sec, esc: opts.esc !== false, lock: opts.lock !== false,
      autofocus: opts.autofocus !== false && (wasOpen ? opts.refocus === true : true),
      onClose: opts.onClose || null, render: opts.render || null };
    /* 压栈（最近打开在栈顶）。已经在账上就不动栈位 ——
       重新 open 只是刷新内容，不是「新出现的一层」。若每次都把它挪到顶上，
       压在面板上的确认框会被面板翻到下面：Esc 关掉的是背后的面板，
       那个还欠着 Promise 的模态反而留在原地。 */
    if (!wasOpen) _stack.push(id);
    if (opts.render) { try { opts.render(); } catch (e) { BF.err.report('sheet.render:' + id, e); } }
    /* opts.autofocus:false —— 抢焦点会打断用户正在打的字（导入进行中那种场景） */
    if (_meta[id].autofocus) {
      /* 取「第一个真能拿到焦点的」，不是「DOM 里第一个可聚焦标记」：
         disabled / 还没渲染出来的按钮 focus() 是静默 no-op，结果焦点留在 BODY ——
         键盘与读屏用户开了面板却进不去（设置面板就是这样）。
         面板出现要过一段过渡，首帧里候选可能全部不可聚焦，所以短间隔再试，最多三次；
         期间若焦点已被别处（非触发按钮）拿走，就不抢 —— 那是用户的意图。 */
      const _tryFocus = function (attempt) {
        if (!_open.has(id)) return;
        const cand = Array.prototype.slice.call(el.querySelectorAll('button,input,select,textarea,a[href],[tabindex]:not([tabindex="-1"])'));
        const f = cand.filter(function (n) { return !n.disabled && n.getClientRects().length > 0 && getComputedStyle(n).visibility !== 'hidden'; })[0] ||
          (el.hasAttribute('tabindex') ? el : null);
        if (f) { try { f.focus(); } catch (e) {} }
        if (f && document.activeElement === f) return;
        const ae = document.activeElement;
        /* 焦点已落在面板内部就不再抢：面板自己指定的主输入位（DSL 终端的命令行）
           和用户开窗后的第一次点按都算，否则这条重试链会把光标从用户正用的地方拽走。 */
        if (ae && el.contains(ae)) return;
        if (ae && ae !== document.body && !el.contains(ae) && ae !== el.__bfOpener) return;
        if (attempt < 3) BF.timers.timeout(function () { _tryFocus(attempt + 1); }, 60 * attempt);
      };
      /* 起头不能用 requestAnimationFrame：窗口被遮挡／最小化／节能节流时 rAF 永不回调，
         整条重试链就不会开始，焦点还是留在 BODY（面板此时已在 DOM 里，等帧没有额外意义）。 */
      BF.timers.timeout(function () { _tryFocus(1); }, 0);
    }
    if (el._trapFn) document.removeEventListener('keydown', el._trapFn);
    _open.add('_trap:' + id);
    const trap = function (e) {
      if (e.key !== 'Tab') return;
      const p = document.getElementById(id); if (!p) return;
      /* 可聚焦元素不能用 x.offsetParent !== null 滤——设置面板的
         .settings-section 开了 content-visibility:auto（懒渲染），
         离屏分区的 offsetParent 为 null，整段会被滤掉，last 就不是
         真正的末位元素，Tab 到"假 last"之后继续往后走，焦点逃出面板。
         判据见上面 focusablesIn：自上下一次遍历，剪掉真正隐藏的整棵子树。
         名单走 cachedFocusables：按一次 Tab 重扫整棵面板在设置面板那种体量上是可感的延迟。 */
      const fs = cachedFocusables(id, p);
      if (!fs.length) return;
      const first = fs[0], last = fs[fs.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    el._trapFn = trap;
    document.addEventListener('keydown', trap);
    _notify();
    return true;
  }
  function close(id, opts) {
    const el = document.getElementById(id); if (!el) return false;
    /* 幂等：对没开的层调 close 不得 ovUnlock —— 否则连点两次「关闭」
       或遮罩与按钮同时命中，就会在别的层还开着时提前放开滚动锁。 */
    if (!_open.has(id)) return false;
    /* cls 从开层时记下的 meta 取，调用点不必再手抄一遍。
       抄错的后果是「面板关了但 sheet 认为还开着」（或反过来 opacity:0 打不开），
       这套账只有 sheet 自己看得见，就不该让每个调用点去猜。 */
    const m = _meta[id] || {};
    const cls = (opts && opts.cls) || m.cls || 'open';
    el.classList.remove(cls); _open.delete(id);
    if (el._trapFn) { document.removeEventListener('keydown', el._trapFn); el._trapFn = null; }
    releaseFocusCache(id);
    _open.delete('_trap:' + id);
    /* 出栈 */
    const si = _stack.indexOf(id);
    if (si >= 0) _stack.splice(si, 1);
    if (m.lock !== false) ovUnlock();
    /* 焦点归还：打开面板时记录触发元素，关闭后还给它（若还在 DOM），
       避免关闭后焦点掉到 body、键盘用户 Tab 从头开始。 */
    if (el.__bfOpener && document.contains(el.__bfOpener)) {
      try { el.__bfOpener.focus(); } catch (e) {}
    }
    el.__bfOpener = null;
    /* 关闭通知。BF.modal 的 Promise 统一由它收尾：resolve 若只挂在 confirm
       自己的 escFn 上，①监听器每次调用漏一个，
       ②Esc 之外的任何关闭路径（程序 close、遮罩点击）会让 Promise 永久 pending。 */
    delete _meta[id];
    if (m.onClose) { try { m.onClose(); } catch (e) { BF.err.report('sheet.onClose:' + id, e); } }
    _notify();
    return true;
  }
  /* 入口按钮的语义是「切换」，不是「再开一遍」。
     判据只有一条 —— 这一层正开着、且它在栈顶（上面压着确认框时，背后面板的入口不越权关它）。
     开合判据只读账本不读 class（class 是画面，账本是状态），两套事实并存必然漂移。
     sec：面板内的栏。顶栏「白噪音」在番茄钟栏时是换栏、不是关面板，
     只有正看着白噪音那一栏，再点才收。返回切换后开没开。 */
  function closable(id, sec) {
    prune();
    if (!_open.has(id) || _stack[_stack.length - 1] !== id) return false;
    if (sec === undefined) return true;
    const m = _meta[id];
    return !m || m.sec === undefined || m.sec === sec;
  }
  /* 面板内部自己切了栏位时，把账本里记的栏位一起改掉。
     不改的话：面板开在 focus、用户点了面板内的「环境音」，S.sec 变了而 _meta.sec 还停在旧值，
     于是顶栏那个入口再点时 closable 判假 ⇒ 「该关不关」，返回 true 却不关，
     用户得到的是「毫无反应」。栏位事实只有 sheet 记得住，调用点不该各持一份。 */
  function setSec(id, sec) {
    const m = _meta[id];
    if (m) m.sec = sec;
  }
  function toggle(id, opts) {
    if (closable(id, opts && opts.sec)) { close(id); return false; }
    return open(id, opts);
  }
  function closeAllExcept(id) {
    for (const oid of [..._open]) {
      if (oid === id || oid.startsWith('_trap:')) continue;
      /* 模态/进度层压在其他面板之上，不能被背后面板的开合掀掉 */
      if (_meta[oid] && _meta[oid].tier === 'overlay') continue;
      try { close(oid); } catch (e) {}
    }
  }
  function closeAll() {
    for (const id of [..._open]) { try { close(id); } catch (e) {} }
    _open.clear();
  }
  function isOpen(id) { return _open.has(id); }
  /* 栈项残留清理：面板被 innerHTML 重建 / 卸载后，_open 与 _stack 还以为它开着。
     「谁开着」有多个读取点，每个都必须先清一次——只让 Esc 一处顺手清，
     其余就会拿着已经不存在的层去做让位决定。 */
  function prune() {
    let dirty = false;
    for (let i = _stack.length - 1; i >= 0; i--) {
      const id = _stack[i];
      const el = document.getElementById(id);
      if (el && document.body.contains(el)) continue;
      _stack.splice(i, 1);
      const had = _open.has(id);
      _open.delete(id);
      if (_meta[id]) { if (_meta[id].lock !== false) ovUnlock(); delete _meta[id]; releaseFocusCache(id); }
      else if (had) ovUnlock();
      dirty = true;
    }
    if (dirty) _notify();
  }
  /* 「有没有层开着」——读栈，不读 class。
     各处散写 getElementById + classList.contains 的复述一律走这里。 */
  function anyOpen() { prune(); return _stack.length > 0; }
  /* 「页面该不该降噪」= 有没有一层 *面板* 开着。
     自带全屏遮罩的层（确认框 / 导入进度 / 快捷键表）声明 tier:'overlay'，
     它们已经压暗过一次，不再叠第二层。 */
  function dimmed() {
    prune();
    for (const id of _stack) { const m = _meta[id]; if (m && m.tier !== 'overlay') return true; }
    return false;
  }
  /* Esc 关栈顶。返回是否消费了这次 Esc（供外层判断）。
     只关栈顶：Esc 的语义是「撤销最近一层」，不是「清空」。
     esc:false 的层（导入进度）自己解释 Esc，这里让位并如实说不消费。 */
  function escTop() {
    prune();
    if (!_stack.length) return false;
    const id = _stack[_stack.length - 1];
    const m = _meta[id];
    if (m && m.esc === false) return false;
    try { close(id); } catch (e) { BF.err.report('sheet.esc:' + id, e); }
    return true;
  }
  function stackTop() { prune(); return _stack.length ? _stack[_stack.length - 1] : null; }
  /* 撤销的刷新通道 —— undo 恢复数据后把「开着的那块面板」
     重画一遍。render 是各层 open() 时就交来的重画函数，存进
     账本按层名取用：不抢焦点、不重开层；层关着时没有可重画的
     内容，静默返回 false（下次打开时 render 自然会跑）。 */
  function rerender(id) {
    const m = _meta[id];
    if (!m || typeof m.render !== 'function') return false;
    try { m.render(); } catch (e) { BF.err.report('sheet.rerender:' + id, e); return false; }
    return true;
  }
  return { open, close, toggle, closable, setSec, closeAll, closeAllExcept, isOpen, anyOpen, dimmed, subscribe, ovLock, ovUnlock, escTop, stackTop, rerender, focusCacheStats };
})();

/* ============================================================
   面板骨架工厂
   ------------------------------------------------------------
   各浮层面板（AI 中心 / 使用手册 / 便签 / 提示词预设 /
   跨书搜索 / 本书回顾 / 标注跨书聚合等）不得各自重复编写「创建元素 +
   pk-panel 骨架 + close 按钮 addEventListener」——
   Esc / 焦点 / 关闭行为逐面板维护必然漂移，且重绘后
   新生的关闭按钮（如工作台底栏「关闭」）会因无监听而成死
   控件。统一为一个工厂 + 一处文档级 close 委托：
   7 面板工厂生成（AI 中心 / 使用手册 / 便签 / 提示词
   预设 / 跨书搜索 / 本书回顾 / 标注跨书聚合）+ 3 面板
   （工作台 / 工具面板 / DSL 终端）手工骨架同构保留——
   行为经 BF.sheet 浮层栈 + data-panel-close 文档级委托
   统一：close 按钮
   统一带 data-panel-close 走委托，Esc / 焦点由 BF.sheet
   浮层栈提供——三处行为天然一致，不再逐面板维护。
   ============================================================ */
BF._panel = function (id, title, opts) {
  opts = opts || {};
  let el = document.getElementById(id);
  if (!el) {
    el = document.createElement('div');
    el.id = id;
    el.className = 'pk-panel' + (opts.cls ? ' ' + opts.cls : '');
    if (opts.cssText) el.style.cssText = opts.cssText;
    if (opts.role) el.setAttribute('role', opts.role);
    if (opts.label) el.setAttribute('aria-label', opts.label);
    if (opts.html) {
      /* 完全自定义形态：调用方提供完整骨架 HTML（头部 /
         主体结构各异的面板，如跨书搜索 / 提示词预设 /
         便签）。其中关闭按钮统一带 data-panel-close 属性，
         走下方文档级委托。 */
      el.innerHTML = opts.html;
    } else {
      /* 标准形态：标题（可自定义 headHTML）+ 调用方头部
         控件（actionsHTML）+ 统一关闭按钮 */
      const head = document.createElement('header');
      head.className = 'pk-panel__head';
      if (opts.headCss) head.style.cssText = opts.headCss;
      if (opts.headHTML) head.innerHTML = opts.headHTML;
      else {
        const ttl = document.createElement('span');
        ttl.className = 'pk-panel__title';
        ttl.textContent = title || '';
        head.appendChild(ttl);
      }
      const acts = document.createElement('div');
      acts.className = 'pk-panel__actions';
      if (opts.actionsHTML) acts.innerHTML = opts.actionsHTML;
      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'pk-panel__close';
      close.setAttribute('data-panel-close', '');
      close.title = '关闭';
      close.setAttribute('aria-label', '关闭');
      close.innerHTML = (BF.dom && BF.dom.ICON_CLOSE) || '×';
      acts.appendChild(close);
      head.appendChild(acts);
      el.appendChild(head);
      const body = document.createElement('div');
      body.className = 'pk-panel__body' + (opts.bodyCls ? ' ' + opts.bodyCls : '');
      if (opts.bodyId) body.id = opts.bodyId;
      if (opts.bodyCss) body.style.cssText = opts.bodyCss;
      el.appendChild(body);
    }
    document.body.appendChild(el);
  }
  return {
    el: el,
    head: el.querySelector('.pk-panel__head'),
    actions: el.querySelector('.pk-panel__actions'),
    body: el.querySelector('.pk-panel__body'),
    title: el.querySelector('.pk-panel__title'),
  };
};

/* 文档级 close 委托：所有带 data-panel-close 的按钮
   （面板头部关闭 + 工作台底栏「关闭」等重绘后新生的关闭
   按钮）统一走这里——找最近的面板容器并经 BF.sheet 浮层
   栈关闭。逐面板 addEventListener 的绑法会在面板重绘后
   随元素丢失监听（工作台底栏关闭按钮即此类缺陷），委托不受重绘影响；
   静态头部按钮的既有监听与本委托并存，BF.sheet.close
   幂等（未打开的面板直接返回 false），双重调用无害。 */
document.addEventListener('click', function (e) {
  const btn = e.target && e.target.closest ? e.target.closest('[data-panel-close]') : null;
  if (!btn) return;
  const panel = btn.closest ? btn.closest('.pk-panel') : null;
  const id = panel && panel.id;
  if (!id || !BF.sheet || !BF.sheet.close) return;
  try { BF.sheet.close(id); } catch (err) {}
});

/* 跳转锚点委托：使用手册「DSL 手册」段的跳转按钮 ——
   直达 BF.dslUI.toggle() 打开终端，
   正文由 ctx.tools.exportManual() 导出的 .md 提供（顶栏「手册」按钮导出）。
   「更新日志」是使用手册的独立页签（BF.help.open('changelog')），
   不经此委托。 */
document.addEventListener('click', function (e) {
  const t = e.target && e.target.closest ? e.target.closest('[data-help-goto-dsl]') : null;
  if (!t) return;
  if (BF.dslUI && typeof BF.dslUI.toggle === 'function') BF.dslUI.toggle();
});

/* ============================================================
   通用状态组件（三态组件化）
   ------------------------------------------------------------
   阅读器 .rd-blank 空态模式推广到全应用：空态 /
   加载 / 错误三态统一为 BF.ui.blank /
   BF.ui.loading / BF.ui.error 三个组件，不得各处内联拼 HTML（样式与语义
   role=status 会不统一）；复用 .rd-blank
   族 CSS 类（不新增 CSS 规则，视觉令牌不动）。
   三态统一带 role=status（读屏可播报）。
   ============================================================ */
BF.ui = BF.ui || {};
/* 空态：icon 可选（emoji / 内联 SVG）；msg 主文案、
   hint 副文案、act 操作区（HTML 串，如按钮）。
   compact=true 收敛间距，适配窄列表/窄栏。 */
BF.ui.blank = function (opts) {
  opts = opts || {};
  return '<div class="rd-blank" role="status"' + (opts.compact ? ' style="margin:12px auto;padding:12px 8px"' : '') + '>' +
    (opts.icon ? '<div class="rd-blank__icon">' + opts.icon + '</div>' : '') +
    (opts.msg ? '<p class="rd-blank__msg">' + BF.dom.esc(opts.msg) + '</p>' : '') +
    (opts.hint ? '<p class="rd-blank__hint">' + BF.dom.esc(opts.hint) + '</p>' : '') +
    (opts.act ? '<div class="rd-blank__act">' + opts.act + '</div>' : '') +
    '</div>';
};
/* 加载态：文案 + 省略号动效（文本级，无新增
   CSS 动画令牌——视觉令牌体系不动）。 */
BF.ui.loading = function (msg) {
  return '<div class="rd-blank" role="status">' +
    '<div class="rd-blank__icon" aria-hidden="true">' + BF.dom.ic('worker') + '</div>' +
    '<p class="rd-blank__msg">' + BF.dom.esc(msg || '加载中…') + '</p>' +
    '</div>';
};
/* 错误态：警示色描边与文案（复用 --danger-*
   令牌），可选 hint 与 act（重试出口）。 */
BF.ui.error = function (opts) {
  opts = opts || {};
  return '<div class="rd-blank" role="status" style="border-color:var(--danger-bg)">' +
    '<div class="rd-blank__icon" aria-hidden="true">' + BF.dom.ic('diag') + '</div>' +
    '<p class="rd-blank__msg" style="color:var(--danger-ink)">' + BF.dom.esc(opts.msg || '出错了') + '</p>' +
    (opts.hint ? '<p class="rd-blank__hint">' + BF.dom.esc(opts.hint) + '</p>' : '') +
    (opts.act ? '<div class="rd-blank__act">' + opts.act + '</div>' : '') +
    '</div>';
};

/* ============================================================
   北风 · V3 面板遮罩控制器（bf-scrim）
   ------------------------------------------------------------
   背景：右侧抽屉（640px 全高）与设置面板（860px 模态）打开时，
   若 body 下没有 scrim 元素，正文仍是全亮度——正文与面板同样亮。
   为什么用独立 DOM 而不用 body:has(#drawer.open)::after ——
   body::after 已被 V2 的「墨色渐晕」氛围层占用（两层 radial-gradient），
   借用会静默抹掉页面氛围纹理，且两条规则会互相覆盖。
   独立节点只做 dim，互不干扰。

   职责边界：只管遮罩显隐 + 点击外部关闭，不改 BF.sheet 的开关流程。
   观测方式：向 BF.sheet 订阅账本变更，
   因此对 open / close / toggle / closeAll / Esc / prune 全路径都生效，
   无需在每个调用点埋钩子。遮罩自己不再读 class、也不再盯一份面板名单。
   ============================================================ */
BF.v3Scrim = (function () {
  let el = null;
  function node() {
    if (!el) el = document.getElementById('bf-scrim');
    if (!el) {
      el = document.createElement('div');
      el.id = 'bf-scrim';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }
    return el;
  }
  /* 这里不维护面板名单、不读 class（那是第二套事实源）；
     谁需要降噪由 BF.sheet 说，它自己记账。 */
  function sync() {
    const on = BF.sheet.dimmed();
    const n = node();
    if (!n) return;
    /* 冗余写保护：状态未变时不碰 class，避免无谓的样式重算 */
    if (n.classList.contains('on') !== on) n.classList.toggle('on', on);
  }
  function init() {
    node();
    /* rAF 合帧：一次「开 A」可能在同一帧里连着通知两次
       （先互斥关掉 B、再开 A），合并成一次 sync 就够。
       订阅账本是唯一观测源——自己盯 class 等于在账本之外另读一次状态。 */
    let _raf = null;
    const _syncRaf = function () {
      if (_raf) return;
      _raf = requestAnimationFrame(function () { _raf = null; sync(); });
    };
    try { BF.sheet.subscribe(_syncRaf); } catch (e) { BF.err.report('v3Scrim.subscribe', e); }
    /* 点击遮罩 = 关掉最上面那层面板。动作交给账本（stackTop + close），
       这里不自己实现关闭，也不给 settings 单开后门 ——
       BF.settingsUI.close() 与 sheet.close('settings') 是同一件事。 */
    document.addEventListener('click', function (e) {
      const n = document.getElementById('bf-scrim');
      if (!n || !n.classList.contains('on')) return;
      if (e.target !== n) return;                 /* 只响应遮罩本体本身的点击 */
      const top = BF.sheet.stackTop();
      if (!top) return;
      try { BF.sheet.close(top); } catch (err) { BF.err.report('v3Scrim.close:' + top, err); }
    }, true);
    sync();
  }
  return { init: init, sync: sync };
})();
try { BF.v3Scrim.init(); } catch (e) { BF.err.report('v3Scrim.init', e); }

/* ============================================================
   北风 · 模块系统 + 命令系统 + 全局委托 + 设置门面 + DOM 工具
   ============================================================ */

