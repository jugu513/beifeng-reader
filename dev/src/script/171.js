/* ================= 21. BF.hotkeys 快捷键 ================= */
BF.hotkeys = (function () {
  const _map = [];
  let _capturing = null;
  /* 快捷键自定义：人类可读标签（给设置面板用） */
  const LABELS = {
    'nav.theme': '切换外观', 'nav.home': '回首页', 'nav.bookshelf': '进书架',
    'import.file': '导入文件', 'find.inpage': '页内查找', 'find.all': '全书搜索', 'read.bookmark': '添加书签',
    'read.continue': '继续阅读', 'tts.toggle': '朗读/暂停', 'read.microread': '微读排版',
    'nav.home.mac': '回首页(⌘)', 'nav.bookshelf.mac': '进书架(⌘)',
    'import.file.mac': '导入文件(⌘)', 'find.inpage.mac': '页内查找(⌘)', 'find.all.mac': '全书搜索(⌘)',
    'read.bookmark.mac': '添加书签(⌘)', 'read.continue.mac': '继续阅读(⌘)', 'tts.toggle.mac': '朗读/暂停(⌘)',
    'read.microread.mac': '微读模式(⌘)', 'read.zoomIn': '放大', 'read.zoomIn2': '放大(+)', 'read.zoomOut': '缩小', 'read.autoscroll': '自动滚动',
    'nav.back': '后退阅读位置', 'nav.forward': '前进阅读位置',
    'tools.dsl': 'DSL 终端', 'tools.dsl.mac': 'DSL 终端(⌘)',
    'edit.undo': '撤销上一步', 'edit.undo.mac': '撤销上一步(⌘)',
    'nav.settings': '打开设置', 'nav.settings.mac': '打开设置(⌘)',
  };
  function parse(combo) {
    const parts = String(combo).toLowerCase().split('+');
    let key = parts[parts.length - 1];
    /* `+` 键在 combo 里是分隔符，无法直接书写；用 plus 代指（e.key='+'）。
       minus 同理（虽可直接写 '-'，统一语义）。 */
    if (key === 'plus') key = '+';
    else if (key === 'minus') key = '-';
    return {
      ctrl: parts.includes('ctrl'), alt: parts.includes('alt'), shift: parts.includes('shift'),
      /* macOS 的 Command 键：hit 必须读 metaKey，否则 combo 里写 meta/cmd 永远匹配不上 */
      meta: parts.includes('meta') || parts.includes('cmd') || parts.includes('super'),
      key,
    };
  }
  /* combo 串 → 解析结果按串缓存：不缓存时每次 keydown 要对每个绑定
     重跑一遍 split+includes×4（约 30 绑定 × 每次按键）。combo 串即键，
     用户重绑自然产生新键，无需失效逻辑。 */
  const _parseCache = new Map();
  function parsed(combo) {
    let p = _parseCache.get(combo);
    if (!p) { p = parse(combo); _parseCache.set(combo, p); }
    return p;
  }
  function hit(e, combo) {
    /* combo 为空/null/'none' 视为「已禁用」，永不触发。
       用户在快捷键设置里可把某条快捷键改为空或 none 来禁用。 */
    if (!combo || combo === 'none') return false;
    const p = parsed(combo);
    if (e.ctrlKey !== p.ctrl) return false;
    if (e.altKey !== p.alt) return false;
    if (e.shiftKey !== p.shift) return false;
    if (!!e.metaKey !== p.meta) return false;
    const k = e.key.toLowerCase();
    return k === p.key || (p.key === 'space' && k === ' ');
  }
  function comboFromEvent(e) {
    const parts = [];
    if (e.ctrlKey) parts.push('ctrl');
    if (e.metaKey) parts.push('meta');
    if (e.altKey) parts.push('alt');
    if (e.shiftKey) parts.push('shift');
    let k = e.key.toLowerCase();
    if (k === ' ') k = 'space';
    if (['control', 'shift', 'alt', 'meta'].includes(k)) return null;   /* 纯修饰键忽略 */
    parts.push(k);
    return parts.join('+');
  }
  function bind(id, combo, action) {
    /* _default 必须在 custom 覆盖之前记录：把覆盖后的值存进 _default，
       "恢复默认"恢复的就是用户改过的值（而非出厂默认），且重开页面后
       "已改"标记（k.combo !== k._default）永不再显示。 */
    const _default = combo;
    const custom = (BF.store.lsGet(BF.store.K.HOTKEYS_CUSTOM, {}) || {})[id];
    _map.push({ id, combo: custom || _default, action, _default });
    return function () { const i = _map.findIndex(x => x.id === id); if (i >= 0) _map.splice(i, 1); };
  }
  /* 应用/清除自定义：直接改 _map 中对应条目的 combo，不重新 bind */
  function applyCustom(id, combo) {
    const cust = BF.store.lsGet(BF.store.K.HOTKEYS_CUSTOM, {}) || {};
    if (combo) cust[id] = combo; else delete cust[id];
    BF.store.lsSet(BF.store.K.HOTKEYS_CUSTOM, cust);
    const e = _map.find(x => x.id === id);
    if (e) e.combo = combo || e._default;
    return e ? (combo || e._default) : null;
  }
  /* 冲突检测：查某组合键是否已被"其他"功能占用，返回冲突项 id 或 null */
  function findConflict(id, combo) {
    const c = String(combo || '').toLowerCase();
    if (!c) return null;
    const hitEntry = _map.find(x => x.id !== id && String(x.combo).toLowerCase() === c);
    return hitEntry ? hitEntry.id : null;
  }
  function beginCapture(id) {
    if (!id) return;
    _capturing = id;
    const el = document.querySelector('[data-rebind="' + id + '"]');
    if (el) { el.textContent = '按下新键…'; el.classList.add('rec'); }
  }
  function captureKey(e) {
    e.preventDefault();
    e.stopImmediatePropagation();   /* 捕获态拦截 Esc/任意键，避免与"Esc 关闭设置面板"等全局键位冲突 */
    const id = _capturing; _capturing = null;
    document.querySelectorAll('[data-rebind]').forEach(b => b.classList.remove('rec'));
    if (e.key === 'Escape') { BF.settingsUI.render(); return; }
    /* Delete/Backspace 设为禁用（combo 存 'none'，hit 不触发） */
    if (e.key === 'Delete' || e.key === 'Backspace') {
      applyCustom(id, 'none');
      BF.noti.info((LABELS[id] || id) + ' 已禁用');
      BF.settingsUI.render();
      return;
    }
    const combo = comboFromEvent(e);
    if (!combo) { BF.settingsUI.render(); return; }
    /* 冲突检测：新键位已被其他功能占用则拒绝并提示，不静默覆盖 */
    const conflict = findConflict(id, combo);
    if (conflict) {
      BF.noti.warn('键位冲突：' + combo.toUpperCase() + ' 已用于「' + (LABELS[conflict] || conflict) + '」，请换一组键');
      BF.settingsUI.render();
      return;
    }
    applyCustom(id, combo);
    BF.noti.success('已绑定 ' + (LABELS[id] || id) + ' → ' + combo.toUpperCase());
    BF.settingsUI.render();
  }
  document.addEventListener('keydown', function (e) {
    /* IME 组合期（拼音/五笔上屏前）不触发快捷键，避免输入时误触发翻页/缩放等 */
    if (e.isComposing || e.keyCode === 229) return;
    /* 系统自动重复不算"又按了一次热键"：长按会以几十毫秒间隔重发同一个 keydown，
       开面板 / 切章 / 删除确认这类动作会被连触几十次。
       需要连发语义的动作自己管节奏（自动滚动有自己的 rAF 定时器），不靠键盘重复。
       阅读区空格连翻的舒适感走另一条处理器（BF.enh.v4 的翻页），不在这里掐。 */
    if (e.repeat) return;
    if (_capturing) { captureKey(e); return; }
    /* sheet 层开着时，无修饰键的单键热键不再下发给背后的页面——
       焦点在确认框按钮上按 a 会翻起背后的自动滚动。
       带修饰键的组合照常放行（那是显式意图）；输入框打字仍由 editable 分支屏蔽。 */
    if (!e.ctrlKey && !e.metaKey && !e.altKey && BF.sheet && BF.sheet.anyOpen()) return;
    const t = e.target;
    const editable = !!(t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable));
    for (const h of _map) {
      if (hit(e, h.combo)) {
        // 输入框内屏蔽单键快捷键（= - 空格 n 等），仅放行带修饰键的组合（Ctrl/Cmd+…），避免劫持打字
        const combo = String(h.combo).toLowerCase();
        if (editable && !/ctrl|alt|meta/.test(combo)) continue;
        e.preventDefault();
        try { h.action(e); } catch (err) { BF.err.report('hotkey:' + h.id, err); }
        return;
      }
    }
  });
  /* 组合键美化：'ctrl+shift+k' → 'Ctrl/⌘ + Shift + K'。
     三处快捷键表（使用手册 / ? 速查 / 设置帮助）
     的显示格式由此统一。 */
  function fmtCombo(combo) {
    if (!combo) return '—';
    if (combo === 'none') return '已禁用';
    const parts = String(combo).split('+');
    const names = parts.map(function (p) {
      if (p === 'ctrl') return 'Ctrl/⌘';
      if (p === 'meta' || p === 'cmd' || p === 'super') return '⌘';
      if (p === 'shift') return 'Shift';
      if (p === 'alt') return 'Alt';
      if (p === 'space') return '空格';
      if (p === 'esc') return 'Esc';
      if (p === 'left') return '←';
      if (p === 'right') return '→';
      if (p === 'plus') return '+';
      if (p === 'enter') return 'Enter';
      return p.length === 1 ? p.toUpperCase() : p;
    });
    return names.join(' + ');
  }
  /* 行为键：未登记为可重绑热键的固定键位（阅读器翻页 /
     切章 / 跳章、速查面板呼出、Esc 关面板）。与 _map 热键同一真源
     供三处快捷键表渲染——三处各写各的会互相矛盾
     （如把「空格」写成「自动滚动」——实际空格是翻页、
     自动滚动是 a 键）。 */
  const BEHAVIOR_KEYS = [
    ['阅读', '空格 / Shift+空格', '向下 / 向上翻一页'],
    ['阅读', '← / →', '滚到边界时切换上 / 下一章'],
    ['阅读', 'Ctrl/⌘ + G', '跳转到指定章节'],
    ['导航', 'Esc', '关闭面板 · 退出微读'],
    ['工具', '?', '打开快捷键速查面板'],
  ];
  return {
    bind, list: function () { return _map.slice(); }, applyCustom, beginCapture, findConflict, LABELS,
    fmt: fmtCombo, behaviorKeys: function () { return BEHAVIOR_KEYS.slice(); },
  };
})();

