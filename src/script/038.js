/* ===== 自绘下拉=====
   动机：原生 <select> 的展开面板由浏览器/系统绘制，CSS 无法主题化 ——
   Chromium 下走系统控件，选中项是系统灰蓝 #808080，与 amber 主色完全撞色，
   且三个作用域（夜墨/light/oled）在展开态下观感一致，看不出主题差异。
   「把 select 换个皮」解决不了这个问题，必须自绘。

   实现方式（刻意选择低风险路径）：
     保留原生 <select> 在 DOM 中，只做「视觉隐藏 + 尺寸归零」，
     自绘的触发器与浮层面板是它的代理面板。
     这样做的收益是全站既有链路**一行都不用改**：
       · document 'change' 委托读 t.closest('[data-set]') + t.value  —— 原生 select 仍是 e.target
       · renderBookshelf 读 sortEl.value / applyTagFilter —— 仍能读到真实值
       · 书封管理 bsel.addEventListener('change') —— 仍会触发
     代价：原生 select 仍在无障碍树里（视觉隐藏但可被辅助技术读到），
     故自绘面板同时补齐 role=listbox/option 与 aria-*，双份都可访问。

   为什么挂 BF.app：命名空间覆盖陷阱 —— BF.ui 会被整体赋值抹掉。
   BF.app 是全文件唯一一次对象字面量定义，挂这里安全（骨架屏同一理由）。 */
BF.app.sel = (function () {
  let openState = null;   // { sel, panel, trigger, opts, active }
  let uid = 0;
  const idOf = (el) => 'bf-sel-' + (++uid);

  function reduceMotion() {
    return BF.settings.get('reduceMotion') || matchMedia('(prefers-reduced-motion: reduce)').matches;
  }

  /* 选项列表：取自原生 select，保证 value/text 与业务侧完全一致 */
  function optsOf(sel) {
    return Array.prototype.map.call(sel.options, function (o) {
      return { v: o.value, t: o.textContent, dis: !!o.disabled };
    });
  }

  function panelHTML(opts, curVal, id) {
    return '<div class="bf-sel-panel" role="listbox" id="' + id + '" tabindex="-1">' +
      opts.map(function (o, i) {
        const on = String(o.v) === String(curVal);
        return '<div class="bf-sel-opt' + (o.dis ? ' is-dis' : '') +
          '" role="option" data-i="' + i + '" data-v="' + BF.dom.escAttr(o.v) + '"' +
          ' aria-selected="' + (on ? 'true' : 'false') + '">' +
          '<span class="bf-sel-opt-t">' + BF.dom.esc(o.t) + '</span>' +
          '<span class="bf-sel-tick" aria-hidden="true">✓</span>' +
          '</div>';
      }).join('') + '</div>';
  }

  /* 自绘触发器的可访问名：只凭 sel.id 存在就写 aria-labelledby="X-lb"，
     而 X-lb 这个元素全站根本没有 ⇒ 可访问名为空，
     读屏把四个下拉全读成「按钮」，分不清筛的是标签、排序还是语速。
     取真名的顺序：显式存在的 -lb 元素 → label[for] → 控件自带 aria-label → title。 */
  function accessibleName(sel) {
    if (!sel.id) return '';
    const lb = document.getElementById(sel.id + '-lb');
    /* 命中 -lb 就取它的文本，不能直接返回空串：那样等于找到了标签却把可访问名清空，
       与上面承诺的顺序（显式 -lb → label[for] → aria-label → title）正好相反。 */
    if (lb) return String(lb.textContent || '').trim();
    const lab = document.querySelector('label[for="' + sel.id + '"]');
    if (lab && lab.textContent.trim()) return lab.textContent.trim();
    const own = sel.getAttribute('aria-label');
    if (own) return own;
    return sel.title || '';
  }

  function buildTrigger(sel) {
    const tr = document.createElement('div');
    tr.className = 'bf-sel-trigger';
    /* 归属要留在节点上：清理时只认「自己那一个」。同父的兄弟触发器属于别的 select，
       它们对应的原生 select 是 opacity:0 / 1px，替兄弟清掉触发器就等于让那个控件消失。 */
    tr.__for = sel;
    if (sel.id) tr.setAttribute('data-for', sel.id);
    tr.setAttribute('role', 'combobox');
    tr.setAttribute('aria-haspopup', 'listbox');
    tr.setAttribute('aria-expanded', 'false');
    tr.setAttribute('tabindex', '0');
    if (sel.id && document.getElementById(sel.id + '-lb')) tr.setAttribute('aria-labelledby', sel.id + '-lb');
    else {
      const nm = accessibleName(sel);
      if (nm) tr.setAttribute('aria-label', nm);
    }
    tr.innerHTML = '<span class="bf-sel-val"></span>' +
      '<svg class="bf-sel-arw" viewBox="0 0 10 6" width="10" height="6" aria-hidden="true">' +
      '<path d="M0 1l5 5 5-5z" fill="currentColor"/></svg>';
    return tr;
  }

  function syncTrigger(sel, tr) {
    const o = sel.selectedOptions && sel.selectedOptions[0];
    const v = tr.querySelector('.bf-sel-val');
    if (v) v.textContent = o ? o.textContent : '';
    /* 值被省略号截断时，完整值还能在悬停与读屏里取到 */
    try { tr.title = o ? String(o.textContent) : ''; } catch (e) {}
    tr.classList.toggle('is-disabled', !!sel.disabled);
  }

  /* 宿主程序改写 sel.value 后同步自绘触发器：设置页只更新这一个框的显示，
     不重建整段分区（重建会换掉用户正对着的控件节点）。 */
  function sync(sel) {
    if (!sel) return;
    const tr = sel.__bfTrigger;
    if (tr && tr.isConnected && tr.parentNode === sel.parentNode) syncTrigger(sel, tr);
  }

  function close(restoreFocus) {
    if (!openState) return;
    const st = openState;
    openState = null;
    /* 必须移除整个 wrap（.bf-sel-pop），不是里面的 .bf-sel-panel ——
       panel 只是 wrap 的子节点，删它会让空 wrap 永久残留在 body 上，
       反复开关会线性堆积。 */
    const host = st.wrap || st.panel;
    if (host && host.parentNode) host.parentNode.removeChild(host);
    if (st.trigger) {
      st.trigger.setAttribute('aria-expanded', 'false');
      st.trigger.removeAttribute('aria-activedescendant');
      /* 焦点此刻在 panel 上，移除后浏览器会丢给 body，键盘用户就"断了线"。
         主动还回 trigger，Tab 序列才接得上。 */
      if (restoreFocus && document.activeElement === document.body) {
        try { st.trigger.focus(); } catch (e) { /* noop */ }
      }
    }
    if (st.sel) st.sel.dispatchEvent(new Event('bf:selclose'));
  }

  /* 键盘游标唯一实现：游标的画法与步进规则以 cursor / nav 两个口对外，
     宿主只提供节点、activedescendant 宿主与步进/选中/关闭动作——
     is-active 的画点全文件仍恰好一处，四套菜单复用同一把，禁第二份抄件。 */
  function cursor(nodes, i, adHost) {
    const len = nodes.length;
    if (!len) return -1;
    /* 跳过 disabled。
       步进必须 +1：n 已是合法下标时 (n + len) % len === n，
       写成那样循环会原地打转 len 次，最后停在 disabled 上。 */
    let n = ((i % len) + len) % len;
    for (let k = 0; k < len; k++) {
      if (!nodes[n].classList.contains('is-dis')) break;
      n = (n + 1) % len;
    }
    nodes.forEach((el, k) => el.classList.toggle('is-active', k === n));   /* 唯一游标绘制点 */
    const on = nodes[n];
    if (on && adHost) {
      if (on.id) adHost.setAttribute('aria-activedescendant', on.id);
      if (on.scrollIntoView) on.scrollIntoView({ block: 'nearest' });
    }
    return n;
  }
  function nav(e, ctl) {
    /* ctl: { nodes(), active(), setActive(n), pick(n), close() } —— 返回是否消费按键 */
    const k = e.key;
    if (k === 'Escape') { e.stopPropagation(); ctl.close(); return true; }
    const nodes = ctl.nodes();
    if (!nodes.length) return false;
    if (k === 'ArrowDown') { e.preventDefault(); ctl.setActive(ctl.active() + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); ctl.setActive(ctl.active() - 1); }
    else if (k === 'Home') { e.preventDefault(); ctl.setActive(0); }
    else if (k === 'End') { e.preventDefault(); ctl.setActive(nodes.length - 1); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); ctl.pick(ctl.active()); }
    else return false;
    return true;
  }
  function setActive(st, i) {
    if (!st) return;
    st.active = cursor(st.panel.querySelectorAll('.bf-sel-opt'), i, st.trigger);
  }

  function commit(st, i) {
    const opt = st.opts[i];
    if (!opt || opt.dis) return;
    const sel = st.sel;
    sel.value = opt.v;
    syncTrigger(sel, st.trigger);
    close(true);
    /* 关键：派发原生 change，让既有的 document 'change' 委托接管
       （data-set / data-sort-books / data-tag-filter / data-tts-rate 等全部无需改动） */
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function open(sel) {
    if (openState && openState.sel === sel) { close(); return; }
    close();
    if (sel.disabled || !sel.options.length) return;
    /* 复用 trigger；若已被宿主重建清掉（__bfTrigger 脱离 DOM），重建一个 */
    let tr = sel.__bfTrigger;
    if (!tr || !tr.isConnected || tr.parentNode !== sel.parentNode) {
      tr = buildTrigger(sel);
      sel.parentNode.insertBefore(tr, sel);
      sel.__bfTrigger = tr;
      /* 重建后需重新绑定交互（原 enhance 绑定已随旧 tr 丢失） */
      tr.addEventListener('mousedown', (e) => { e.preventDefault(); open(sel); });
      tr.addEventListener('keydown', (e) => onKey(e, sel));
    }
    syncTrigger(sel, tr);
    tr.setAttribute('aria-expanded', 'true');
    const pid = idOf();
    const wrap = document.createElement('div');
    wrap.className = 'bf-sel-pop';
    wrap.style.position = 'fixed';
    wrap.style.zIndex = 'calc(var(--z-popover) + 6)';
    wrap.innerHTML = panelHTML(optsOf(sel), sel.value, pid);
    wrap.querySelectorAll('.bf-sel-opt').forEach((el, i) => {
      el.id = pid + '-o' + i;
      el.addEventListener('click', () => { if (openState) commit(openState, i); });
      el.addEventListener('mouseenter', () => setActive(openState, i));
    });
    document.body.appendChild(wrap);
    // 定位：优先向下，空间不足则向上
    const r = tr.getBoundingClientRect();
    const pw = r.width, ph = wrap.offsetHeight || 0;
    const vh = innerHeight;
    let top = r.bottom + 4;
    if (top + ph > vh - 8 && r.top - ph - 4 > 8) top = r.top - ph - 4;
    wrap.style.left = Math.max(8, Math.min(r.left, innerWidth - pw - 8)) + 'px';
    wrap.style.top = top + 'px';
    wrap.style.minWidth = pw + 'px';
    const st = { sel, wrap: wrap, panel: wrap.querySelector('.bf-sel-panel'), trigger: tr, opts: optsOf(sel), active: -1 };
    openState = st;
    const cur = st.opts.findIndex(o => String(o.v) === String(sel.value));
    setActive(st, cur >= 0 ? cur : 0);
    if (!reduceMotion()) wrap.classList.add('is-in');
    /* 焦点落在 panel 上，但 keydown 必须也绑到 panel：
       trigger 与 panel 是兄弟节点，事件不会从 panel 冒泡到 trigger，
       只绑 trigger 会导致 ArrowDown/Enter 全部失灵。
       mousedown preventDefault 用于阻止浏览器把焦点抢回 body。 */
    wrap.addEventListener('mousedown', (e) => e.preventDefault());
    wrap.addEventListener('keydown', (e) => onKey(e, sel));
    st.panel.focus();
  }

  function onKey(e, sel) {
    const st = openState;
    const k = e.key;
    if (k === 'Escape') { if (st) { e.stopPropagation(); close(true); } return; }
    if (!st) {
      if (k === 'Enter' || k === ' ' || k === 'ArrowDown' || k === 'ArrowUp') { e.preventDefault(); open(sel); }
      return;
    }
    if (k === 'ArrowDown') { e.preventDefault(); setActive(st, st.active + 1); }
    else if (k === 'ArrowUp') { e.preventDefault(); setActive(st, st.active - 1); }
    else if (k === 'Home') { e.preventDefault(); setActive(st, 0); }
    else if (k === 'End') { e.preventDefault(); setActive(st, st.opts.length - 1); }
    else if (k === 'Enter' || k === ' ') { e.preventDefault(); commit(st, st.active); }
    else if (k === 'Tab') { close(); }
    /* 无障碍：读屏用户打字跳选项（type-ahead），单字母匹配首字符 */
    else if (k.length === 1 && /\S/.test(k)) {
      const q = k.toLowerCase();
      const n = st.opts.length;
      for (let d = 1; d <= n; d++) {
        const j = (st.active + d) % n;
        if (st.opts[j].dis) continue;
        if (String(st.opts[j].t).toLowerCase().indexOf(q) === 0) { setActive(st, j); break; }
      }
    }
  }

  function enhance(sel) {
    if (!sel || sel.__bf) return;
    sel.__bf = true;
    /* 视觉隐藏但保留在无障碍树与 DOM 里 —— 既有的 change 委托、.value 读取全部照常工作 */
    sel.classList.add('bf-sel-native');
    /* 防重：宿主 innerHTML 重建后，旧 trigger 若已脱离 DOM 就清掉引用；
       若 DOM 里已有同源 trigger（重复增强/补插导致），先移除再建，避免双份。
       只清自己那一个：同父兄弟的触发器属于别的 select，那些原生 select 是
       opacity:0 / 1px，替兄弟清掉触发器等于让那个筛选框当场消失。 */
    if (sel.__bfTrigger && sel.__bfTrigger.parentNode) sel.__bfTrigger.parentNode.removeChild(sel.__bfTrigger);
    /* 骨架给每个 select 预置了一个占位触发器（首屏不闪），它紧邻自己的 select；
       没有归属标记的才是占位，才接管。 */
    const _prev = sel.previousElementSibling;
    if (_prev && _prev.classList && _prev.classList.contains('bf-sel-trigger') && !_prev.__for) _prev.remove();
    const tr = buildTrigger(sel);
    sel.parentNode.insertBefore(tr, sel);
    sel.__bfTrigger = tr;
    syncTrigger(sel, tr);
    tr.addEventListener('mousedown', (e) => { e.preventDefault(); open(sel); });
    tr.addEventListener('keydown', (e) => onKey(e, sel));
    tr.addEventListener('blur', () => { setTimeout(() => { if (openState && !openState.panel.contains(document.activeElement)) close(); }, 0); });
    /* 原生 select 自身变化（如设置被程序改写）时同步触发器显示 */
    sel.addEventListener('change', () => syncTrigger(sel, tr));
  }

  function scan(root) {
    (root || document).querySelectorAll('select').forEach(enhance);
    /* 宿主被 innerHTML 重建后旧 trigger 已脱离文档，浮层会变成孤儿并残留在 body 上 */
    if (openState && openState.trigger && !openState.trigger.isConnected) close();
  }

  /* 全局：点击外部关闭 / Esc 兜底 */
  document.addEventListener('mousedown', (e) => {
    if (!openState) return;
    const st = openState;
    if (st.trigger.contains(e.target) || (st.panel && st.panel.contains(e.target))) return;
    close();
  }, true);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && openState) { e.stopPropagation(); close(); }
  }, true);
  /* 浮层是 position:fixed，宿主一旦滚动/缩放就会与 trigger 脱位。
     与 resize 一致：直接收起，而不是每帧重算坐标。
     面板自身 overflow-y:auto，滚动它属于内部交互，不能收 ——
        用 e.target 判断来源，只响应"页面/容器"级滚动。 */
  window.addEventListener('resize', () => close());
  window.addEventListener('scroll', (e) => {
    if (!openState) return;
    const t = e.target;
    if (t && t.closest && t.closest('.bf-sel-pop')) return;
    close();
  }, true);
  /* trigger 被宿主重建掉时自动收摊（懒渲染分区、主题切换、路由切页都会触发） */
  if (window.MutationObserver) {
    new MutationObserver(() => {
      if (!openState) return;   /* 空闲期（无开着的下拉）回调首行即退，阅读器逐字重渲染不再白扫 */
      if (openState.trigger && !openState.trigger.isConnected) close();
    }).observe(document.body, { childList: true, subtree: true });
  }

  return { scan: scan, enhance: enhance, close: close, open: open, cursor: cursor, nav: nav, sync: sync };
})();

