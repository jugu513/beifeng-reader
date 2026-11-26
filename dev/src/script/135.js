/* ================= 扩展中心（pluginCenter）：设置页「插件」节 =================
   不新建独立面板，复用 BF.settingsUI.register 注入一节；
   列出 BF.modules.list 全部插件（含 autoregister 生成的内置条目），
   核心（CORE）只读显示，功能插件可启停（状态持久化 plugins_state）。 */
BF.pluginCenter = (function () {
  function esc(s) { return BF.dom.esc(s); }
  function iconFor(id) {
    const map = {
      'reader.core': 'reader', 'tts.core': 'tts', 'stats': 'stats', 'help': 'help', 'bk': 'backup', 'diag': 'diag',
      'heal': 'heal', 'smart': 'smart', 'workerPool': 'worker', 'lz': 'lz', 'dsl': 'dsl', 'dslUI': 'dsl',
      'nav': 'nav', 'hotkeys': 'hotkey', 'commands': 'cmd', 'findInPage': 'find', 'noise': 'noise', 'goal': 'goal',
      'theme': 'theme', 'aiUI': 'ai', 'ai': 'ai', 'zip': 'zip', 'md': 'md', 'ui': 'ui', 'modal': 'modal',
      'sheet': 'sheet', 'settingsUI': 'settings', 'app': 'app', 'scene': 'scene', 'noti': 'noti',
      'notiCenter': 'noti', 'uiMenu': 'pin', 'wsUI': 'folder', 'statsPanel': 'stats', 'focus': 'focus',
      'perf': 'perf', 'enh': 'star', 'util': 'util', 'log': 'log', 'err': 'shield',
      'store': 'store', 'settings': 'settings', 'dom': 'puzzle', 'delegate': 'mouse', 'library': 'library', 'reader': 'reader',
      'download': 'download', 'timers': 'timer', 'bus': 'bus', 'core.bus': 'bus', 'core.store': 'store',
      'core.settings': 'settings', 'core.sheet': 'sheet', 'core.noti': 'noti', 'core.timers': 'timer', 'core.ui': 'ui',
      'boot': 'boot', 'base': 'store', 'workshop': 'util',
    };
    const name = map[id] || 'puzzle';
    return BF.dom && BF.dom.ic ? BF.dom.ic(name) : '';
  }
  /* 当前筛选标签（空数组 = 不筛选）。存在模块级而非 DOM 里，
     因为 setlazy 的占位分区重建时需要恢复同一筛选状态。 */
  let _filter = [];
  /* 折叠状态：null = 用默认（无筛选时折叠），true/false = 用户显式展开/收起。
     一次铺开 90+ 行时，1440px 下 plugin 分区占掉整屏，找某个模块要滚动很久，
     所以无筛选时只铺「核心 + 高频」前 DEFAULT_SHOW 个，筛选命中时自动全展开
     （用户主动在找东西，不该再挡着）。 */
  const DEFAULT_SHOW = 10;
  let _expanded = null;
  function render() {
    const all = (BF.modules.list() || []).slice().sort(function (a, b) { return (a.id || '').localeCompare(b.id || ''); });
    /* 走数据层 find：多标签取交集，与文档承诺的「按能力检索」一致 */
    const mods = _filter.length && BF.modules.find ? BF.modules.find(_filter) : all;
    /* 折叠：无筛选且未显式展开时，只显示前 DEFAULT_SHOW 个；
       有筛选时结果全部展示（且把 _expanded 归位，避免下次清筛选后仍处于展开态） */
    if (_filter.length) _expanded = true;
    const expanded = _expanded == null ? _filter.length > 0 : _expanded;
    const shown = expanded ? mods : mods.slice(0, DEFAULT_SHOW);
    const hidden = mods.length - shown.length;
    const rows = shown.map(function (m) {
      const isCore = BF.modules._isCore ? BF.modules._isCore(m.id) : ((BF.modules.CORE || new Set()).has(m.id));
      const on = BF.modules.isEnabled(m.id);
      const toggleBtn = isCore
        ? '<span style="font-size:11px;color:var(--text-weak)">核心</span>'
        : '<button class="btn btn-xs" data-plugin-toggle="' + esc(m.id) + '" style="min-width:56px">' + (on ? '禁用' : '启用') + '</button>';
      const cfg = BF.modules.getConfig(m.id);
      const cfgBtn = cfg && Object.keys(cfg).length
        ? '<span style="font-size:11px;color:var(--text-weak);margin-left:6px">已配置</span>'
        : '';
      return '<div class="setting-row" style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid var(--border)">' +
        '<span style="flex:0 0 22px;display:inline-flex;align-items:center;justify-content:center">' + iconFor(m.id) + '</span>' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + esc(m.name || m.id) + '</div>' +
          '<div style="font-size:11px;color:var(--text-weak)">' + esc(m.desc || '') + ' <span style="opacity:.6">v' + esc(m.version || '1.0') + '</span></div>' +
        '</div>' +
        '<div style="flex:0 0 auto;display:flex;align-items:center;gap:6px">' + cfgBtn + toggleBtn + '</div>' +
      '</div>';
    }).join('');
    /* 筛选控件：只列出真实存在的标签（allTags 由 BF.modules 提供） */
    const tags = (BF.modules.allTags ? BF.modules.allTags() : []).filter(function (t) { return t.count > 0; });
    const chips = tags.map(function (t) {
      const active = _filter.indexOf(t.tag) !== -1;
      return '<button class="btn btn-xs" data-pc-tag="' + BF.dom.escAttr(t.tag) + '"' +
        (active ? ' style="border-color: var(--accent);color:var(--accent-ink)"' : '') +
        ' title="' + esc(t.count + ' 个扩展') + '">' + esc(t.cn) + ' ' + t.count + '</button>';
    }).join('');
    const head = '<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px">' +
      '<button class="btn btn-xs" data-pc-tag-clear' + (_filter.length ? '' : ' disabled') + '>全部</button>' + chips + '</div>';
    const body = mods.length
      ? rows + (hidden > 0 || expanded
        ? '<div style="text-align:center;padding:10px 0 2px"><button class="btn btn-xs" data-pc-expand>' +
          (expanded && hidden > 0 ? '收起（已展开 ' + shown.length + ' 个）' : '展开全部 ' + mods.length + ' 个扩展') +
          '</button></div>'
        : '')
      : '<div class="cmdk-empty" style="padding:16px 0">没有同时具备 ' + esc(_filter.map(function (t) { return (BF.modules.TAG_CN || {})[t] || t; }).join(' + ')) + ' 的扩展</div>';
    return '<div class="settings-section" style="margin-bottom:16px"><h4 style="font-size:14px;margin-bottom:8px;color:var(--text)">插件</h4>' +
      '<div style="font-size:11px;color:var(--text-weak);margin-bottom:8px">共 ' + all.length + ' 个扩展' +
      (_filter.length ? ' · 筛选出 <b style="color:var(--accent-ink)">' + mods.length + '</b> 个（需同时具备所选标签）' : ' · 核心不可禁用 · 功能扩展可启停（立即生效）') +
      (!_filter.length && !expanded && hidden > 0 ? ' · 已折叠，仅显示常用 ' + shown.length + ' 个' : '') +
      '</div>' + head + body + '</div>';
  }
  function setFilter(tags) {
    _filter = (tags || []).map(function (t) { return String(t).trim().toLowerCase(); }).filter(Boolean);
  }
  /* 交互后刷新：优先只重建本分区（保住其它懒渲染占位），失败才全量 render */
  function _refresh() {
    if (BF.settingsUI && BF.settingsUI.rerender && BF.settingsUI.rerender('plugins')) return;
    if (BF.settingsUI && BF.settingsUI.render) BF.settingsUI.render();
  }
  function bind(root) {
    if (!root) return;
    /* 标签筛选：点一下加选，再点取消；多选取交集 */
    root.querySelectorAll('[data-pc-tag]').forEach(function (btn) {
      if (btn.__pcTagBound) return;
      btn.__pcTagBound = true;
      btn.addEventListener('click', function () {
        const tag = btn.getAttribute('data-pc-tag');
        const i = _filter.indexOf(tag);
        if (i === -1) _filter.push(tag); else _filter.splice(i, 1);
        _refresh();
      });
    });
    const clr = root.querySelector('[data-pc-tag-clear]');
    if (clr && !clr.__pcClrBound) {
      clr.__pcClrBound = true;
      clr.addEventListener('click', function () {
        if (!_filter.length) return;
        _filter = [];
        _expanded = null;   /* 清筛选后恢复默认折叠，否则会停在展开态 */
        _refresh();
      });
    }
    const ex = root.querySelector('[data-pc-expand]');
    if (ex && !ex.__pcExBound) {
      ex.__pcExBound = true;
      ex.addEventListener('click', function () {
        /* 直接翻转，不从 DOM 行数反推：rerender 会重建分区，
           反推容易在「筛选态变化后 total 变了」时判错（会卡在展开态收不起来）。
           无筛选时默认折叠（_expanded === null 视作 false），有筛选时恒展开。 */
        var curExpanded = _expanded == null ? _filter.length > 0 : _expanded;
        _expanded = !curExpanded;
        _refresh();
      });
    }
    root.querySelectorAll('[data-plugin-toggle]').forEach(function (btn) {
      if (btn.__pcBound) return;
      btn.__pcBound = true;
      btn.addEventListener('click', function () {
        const id = btn.getAttribute('data-plugin-toggle');
        try {
          if (BF.modules.isEnabled(id)) BF.modules.disable(id);
          else BF.modules.enable(id);
          BF.noti && BF.noti.success((BF.modules.isEnabled(id) ? '已启用' : '已禁用') + '：' + id);
        } catch (e) { BF.err.report('pluginCenter.toggle', e); }
        _refresh();
      });
    });
  }
  return {
    render: render, bind: bind, setFilter: setFilter, getFilter: function () { return _filter.slice(); },
    /* 展开态复位：无筛选时回到默认折叠。setFilter([]) 之外单独提供，
       因为「筛选自动展开」会把 _expanded 置 true，外部/测试需要显式回到默认。 */
    _resetExpand: function () { _expanded = null; },
    _isExpanded: function () { return _expanded == null ? _filter.length > 0 : _expanded; },
    /* 按标签直达筛选。
       打开插件分区（renderAll 强制全量，否则分区可能还是占位）→ 设置筛选 → 滚到该分区。 */
    focusTag: function (tag) {
      setFilter([tag]);
      BF.settingsUI.renderAll();
      requestAnimationFrame(function () {
        const host = document.querySelector('[data-sec-host="plugins"]');
        if (host && host.scrollIntoView) { try { host.scrollIntoView({ block: 'start' }); } catch (e) { host.scrollIntoView(); } }
      });
      return _filter.slice();
    },
  };
})();
BF.settingsUI.register('plugins', 99, function () { return BF.pluginCenter.render(); });
/* 按能力标签直达插件筛选（注册为 plugins.tag 命令）。
   标签必须「执行时」才算，不能在注册时算——脚本自上而下执行到此处时，
   autoregister 还没扫完，allTags 会返回空数组，标签按钮就全空了。 */
BF.commands.register({
  id: 'plugins.tag', label: '扩展：按标签筛选', cat: '工具',
  keywords: 'plugin 模块 标签 筛选 能力 tag',
  run: function () {
    /* 按「够窄够有用」筛：count>=2 排除孤标签；再按 count 升序——
       命中最多的（builtin/core 这类几乎人手一个的）排在最后，
       排前面的才是真正有筛选价值的类别。 */
    const tags = (BF.modules.allTags ? BF.modules.allTags() : [])
      .filter(function (t) { return t.count >= 2 && t.count < BF.modules.list().length * 0.5; })
      .sort(function (a, b) { return a.count - b.count; })
      .slice(0, 14);
    if (!tags.length) { BF.noti && BF.noti.info('暂无扩展标签'); return; }
    BF.app.go && BF.app.go('settings');
    BF.modal.alert('按标签筛选扩展（点标签直达扩展分区）',
      '<div style="display:flex;flex-wrap:wrap;gap:6px">' + tags.map(function (t) {
        return '<button class="btn btn-xs" data-plug-tag="' + BF.dom.escAttr(t.tag) + '">' + BF.dom.esc(t.cn) + ' ' + t.count + '</button>';
      }).join('') + '</div>', { html: true });
    /* alert 无 onRender 钩子，但 _show 是同步写 innerHTML 的，
       所以紧随其后绑委托是可靠的；重复执行前先解绑旧的。 */
    const box = document.getElementById('modal-box');
    if (!box) return;
    if (box.__plugTagBound) box.removeEventListener('click', box.__plugTagBound);
    box.__plugTagBound = function (e) {
      const b = e.target.closest && e.target.closest('[data-plug-tag]');
      if (!b) return;
      BF.pluginCenter.focusTag(b.getAttribute('data-plug-tag'));
      BF.modal.hide();
    };
    box.addEventListener('click', box.__plugTagBound);
  },
});

/* 分区标题表：懒渲染占位骨架用（避免为了拿标题就把重分区整个构建一遍） */
BF.settingsUI.TITLES = {
  appearance: '外观', reading: '阅读', shelf: '书架', parse: '解析', tts: '语音', ai: 'AI 服务',
  terminal: '终端',
  data: '数据', help: '帮助', hotkeys: '快捷键自定义', plugins: '扩展管理',
  /* changelog 必须在册：缺登记会把该分区标题直接渲染成英文原名，
     与同级其余中文分区不一致。 */
  changelog: '更新日志',
  /* taste / onboard 同病同修 —— 导航与概览标题会回退成英文原名。 */
  taste: '界面口味', onboard: '首启引导',
  /* 界面方案分区同病同修：黑白简约的开关住这里。 */
  experimental: '界面方案',
  readPanel: '阅读设置',
};
/* 首屏立即渲染的分区数；其余分区滚动进入前 200px 才真正构建 DOM。
   最重的 plugins 区（60+ 行）通常在最后，因此首屏不再为它买单。
   需要全量时用 BF.settingsUI.renderAll（重置 / 打印 / 自动化测试均走它）。 */
BF.settingsUI.LAZY_FROM = BF.CONFIG.SETTINGS_LAZY_FROM;
/* 数值设置的合法区间只在这一处定义（BF.settings.RANGES）：写侧（clampNum 交互时夹紧、
   clampAllNumInputs 分区构建后校正显示）与读侧（get / num / BF.prefs.resolve 生效前夹取）
   共用同一张表，两处各写一份就会出现「面板显示 32、实际生效 40」这种对不上的形态。
   HTML 上的 min/max 只管得住滑块和步进按钮，管不到「type=number 手打越界 /
   存储里的脏值 / 程序化写入」，运行时夹紧必须以本表为准。 */
BF.settingsUI.NUM_RANGES = BF.settings.RANGES;
/* 越界即夹到端点，并回写输入框显示：留「显示 99999、实际生效 140」是最坏的形态。
   夹过时给一次行内说明，不弹 toast。 */
BF.settingsUI.clampNum = function (name, v, el) {
  var r = BF.settingsUI.NUM_RANGES[name];
  if (!r || typeof v !== 'number' || isNaN(v)) return v;
  var out = v, over = null;
  if (v < r.min) { out = r.min; over = '过小'; }
  else if (v > r.max) { out = r.max; over = '过大'; }
  if (over && el && el.isConnected) {
    el.value = out;
    BF.settingsUI._showNumHint(el, out, over);
  } else if (!over && el) {
    BF.settingsUI._clearNumHint(el);       /* 回到合法区间即撤掉说明 */
  }
  return out;
};
BF.settingsUI._showNumHint = function (el, clamped, over) {
  if (!el || !el.parentNode) return;
  var hint = el.parentNode.querySelector('[data-num-hint]');
  if (!hint) {
    hint = document.createElement('span');
    hint.setAttribute('data-num-hint', '');
    hint.style.cssText = 'font-size:11px;margin-left:6px;color:var(--warning-ink);flex:none';
    el.parentNode.appendChild(hint);
  }
  hint.textContent = '超出可用范围，已按' + over + '夹到 ' + clamped;
};
BF.settingsUI._clearNumHint = function (el) {
  if (!el || !el.parentNode) return;
  var hint = el.parentNode.querySelector('[data-num-hint]');
  if (hint && hint.parentNode) hint.parentNode.removeChild(hint);
};
/* 读侧校正：存储脏值 / 程序化越界写进的值不会经过写侧，
   分区渲染出来后按同一张表把显示值夹回去（只改显示，不动存储——用户下次交互才落盘）。 */
BF.settingsUI.clampAllNumInputs = function (root) {
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('[data-set-num],[data-set-step]').forEach(function (el) {
    var name = el.getAttribute('data-set-num') || el.getAttribute('data-set-step');
    var raw = parseFloat(el.value);
    if (isNaN(raw)) return;
    var v = BF.settingsUI.clampNum(name, raw, null);
    if (v !== raw) el.value = v;
  });
};
BF.settingsUI._io = null;
/* 按 secId 缓存已渲染分区 + 脏标记重建。
   缓存避免每次 open 全量重建 sec.render()（最重分区 60+ 行 DOM）；
   脏标记由设置变更精确驱动（key→secId 映射，构建自分区内 data-set* 属性），
   保证「从面板外改了某设置 → 再开面板」该分区被重建、绝不显示旧值。
   _cache: secId → 已构建的分区根节点（脱离文档但仍存活，可整体复用）
   _dirty: secId → true 表示需重建
   _keys:  设置键 → [secId]，由 build 扫描分区 DOM 的 data-set* 属性填充 */
BF.settingsUI._cache = BF.settingsUI._cache || {};
BF.settingsUI._dirty = BF.settingsUI._dirty || {};
BF.settingsUI._keys = BF.settingsUI._keys || {};
function _collectKeys(elm, secId) {
  if (!elm || !elm.querySelectorAll) return;
  var seenKey = {};   /* 同一次收集里每个键见到第几次：单选成组时保证 id 不撞 */
  elm.querySelectorAll('[data-set],[data-set-num],[data-set-step],[data-set-text]').forEach(function (n) {
    var k = n.getAttribute('data-set') || n.getAttribute('data-set-num') || n.getAttribute('data-set-step') || n.getAttribute('data-set-text');
    if (!k) return;
    var arr = BF.settingsUI._keys[k] || (BF.settingsUI._keys[k] = []);
    if (arr.indexOf(secId) < 0) arr.push(secId);
    /* 控件补 id、行 label 补 for：读屏念得出这一项是什么，点标签就能聚焦。
       id 按「分区 + 键 + 区内序号」生成，与构建顺序无关（重建同一分区得到同一批 id）；
       不查 document 查重 —— 分区是懒建可缓存的，节点此刻往往还没进 DOM，查了也不准。
       按设置键找控件请走 BF.settingsUI._ctl（属性选择器），别把 id 拼法当约定。 */
    if (!n.id) {
      seenKey[k] = (seenKey[k] || 0) + 1;
      n.id = 'set-' + secId + '-' + k + (seenKey[k] > 1 ? '-' + seenKey[k] : '');
    }
    if (n.id) {
      var rowEl = n.closest ? n.closest('.setting-row') : null;
      var labEl = rowEl && rowEl.querySelector('label');
      if (labEl && !labEl.getAttribute('for')) labEl.setAttribute('for', n.id);
    }
    if (_isSecretKey(k) && n.tagName === 'INPUT') _decorateSecretRow(n, k);
  });
}
/* 设置控件的唯一取法：按 data-set* 属性找，而不是按 id 拼名。
   id 只有个别行是手写在行内源码里的（如 Edge 凭据 Token），其余行没有；
   那几处写死 getElementById('set-' + 键) 的跳转因此一直抓不到东西，
   焦点落不到该填的那一项上。运行时补的 id 也不该被当成长期约定。 */
BF.settingsUI._ctl = function (k) {
  return document.querySelector('[data-set="' + k + '"],[data-set-text="' + k + '"],[data-set-num="' + k + '"],[data-set-step="' + k + '"]');
};
/* 密钥行的补充控件：显示 / 复制 / 清除，在分区构建时就地插到输入框右边。
   为什么不写进行内源码：这两行与上游基线逐字节锁定（闸门③「密钥输入行」），
   多一个字符就判漂移 —— 而闸门判据不许为了让它变绿而放宽。
   这里一律按 dataset 比对键名，不拼出带键名的锚点字面串：
   闸门取的是「第一条含该串的整行」，在这两行之前出现那串字面量，锚点就会匹配到别处。 */
function _isSecretKey(k) { return k === 'aiApiKey' || k === 'mimoApiKey'; }
function _secretInput(k) { return document.querySelector('input[data-set-text="' + k + '"]'); }
function _secretOut(k) { return document.querySelector('[data-copy-out="' + k + '"]'); }
function _secretSay(k, txt, bad) {
  var s = _secretOut(k);
  if (s && s.isConnected) { s.textContent = txt; s.style.color = bad ? 'var(--warning-ink)' : 'var(--text-weak)'; }
}
function _tail4(v) { var s = String(v || ''); return s.length > 4 ? s.slice(-4) : ''; }
/* 打码态：输入框里不留明文，值只留在存储里。
   「已设置 · 尾 4 位」够认出是哪把密钥，不够被截图或肩窥复原。 */
function _maskSecretInput(input, k) {
  var stored = BF.settings.get(k) || '';
  input.removeAttribute('value');
  input.value = '';
  input.type = 'password';
  input.setAttribute('data-secret-masked', '1');
  input.placeholder = stored ? ('已设置 · 尾 ' + _tail4(stored) + '；输入新值即替换') : '未设置；粘贴后移开焦点即保存';
}
/* 显示原文的复位：值清掉、type 回 password、眼睛复位。
   设置分区节点会被缓存复用，留下明文就等于下次打开面板直接明文可见。 */
var _revealReset = new Map();
function _hideSecret(k) {
  var f = _revealReset.get(k);
  if (f) { try { f(); } catch (e) {} _revealReset.delete(k); }
  var input = _secretInput(k);
  if (!input || input.getAttribute('data-secret-masked') === '1') return;
  _maskSecretInput(input, k);
  var eye = document.querySelector('[data-secret-eye="' + k + '"]');
  if (eye) eye.setAttribute('aria-pressed', 'false');
}
function _showSecret(k) {
  var input = _secretInput(k);
  var v = BF.settings.get(k) || '';
  if (!input) return;
  if (!v) { _secretSay(k, '还没设置密钥', true); return; }
  input.removeAttribute('data-secret-masked');
  input.type = 'text';
  input.value = v;
  var eye = document.querySelector('[data-secret-eye="' + k + '"]');
  if (eye) eye.setAttribute('aria-pressed', 'true');
  _secretSay(k, '原文显示中：10 秒后自动打码，点别处或按 Esc 立即打码', false);
  var cancelT = BF.timers.timeout(function () { _hideSecret(k); }, 10000);
  /* 复位不依赖面板关闭钩子：点行外、按 Esc、超时，三条都能把明文收回去。 */
  var onDown = function (e) {
    var row = input.parentNode;
    if (row && row.contains(e.target)) return;   /* 行内操作（复制/清除）不打断显示 */
    _hideSecret(k);
  };
  var onKey = function (e) {
    if (e.key !== 'Escape') return;
    var inp = _secretInput(k);
    /* 只在确实收起了明文时截断 Esc：否则放行给启动区 escTop 关面板。
       与查找框同一约定——一次按键只处理一层。 */
    if (inp && inp.getAttribute('data-secret-masked') !== '1') {
      _hideSecret(k);
      e.stopPropagation();
    }
  };
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('keydown', onKey, true);
  _revealReset.set(k, function () {
    try { cancelT(); } catch (e) {}
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('keydown', onKey, true);
  });
}
/* 一次性小面板：两次点击，不弹模态、不重建设置面板 —— 面板一重建，眼睛刚显示的内容就没了。 */
function _askRevealInline(k) {
  var s = _secretOut(k);
  if (!s) return;
  s.innerHTML = '显示原文？' +
    '<button class="btn btn-xs" data-reveal-once="' + k + '">只看一次</button> ' +
    '<button class="btn btn-xs" data-reveal-always="' + k + '">以后都允许</button>';
  try { s.style.color = 'var(--text-weak)'; } catch (e) {}
}
function _eyeClick(k) {
  var input = _secretInput(k);
  if (input && input.getAttribute('data-secret-masked') !== '1') { _hideSecret(k); _secretSay(k, '', false); return; }
  var mode = BF.settings.get('keyReveal') || 'ask';
  if (mode === 'mask') { _secretSay(k, '已设为「永不显示」；要看得先把「密钥显示」改成别的档', true); return; }
  if (mode === 'allow') { _showSecret(k); return; }
  _askRevealInline(k);
}
function _clearSecret(k) {
  BF.ask.confirm({
    title: '清除密钥', danger: 2, op: 'key.clear', confirmText: '清除',
    body: '清除后这一项回到「未设置」，AI 对话 / 朗读要重新填。当前值不会另存到任何地方。',
  }).then(function (ok) {
    if (!ok) return;
    _hideSecret(k);
    BF.settings.set(k, '');
    var input = _secretInput(k);
    if (input) _maskSecretInput(input, k);
    _secretSay(k, '已清除', false);
  });
}
function _decorateSecretRow(input, k) {
  var p = input.parentNode;
  if (!p || p.querySelector('[data-copy-out]')) return;
  /* 控件列打上标记：加了按钮以后窄屏一行装不下（输入框有 min-width，按钮会被顶出屏幕外，
     400px 实测溢出 34px 完全点不到），这一档允许控件列内部换行。样式写在样式表里，不塞内联。 */
  try { p.classList.add('set-secret-ctl'); } catch (e) {}
  var eye = document.createElement('button');
  eye.type = 'button';
  eye.className = 'btn btn-xs';
  eye.setAttribute('data-secret-eye', k);
  eye.setAttribute('aria-pressed', 'false');
  eye.textContent = '显示';
  var copy = document.createElement('button');
  copy.type = 'button';
  copy.className = 'btn btn-xs';
  copy.setAttribute('data-secret-copy', k);
  copy.textContent = '复制';
  var clr = document.createElement('button');
  clr.type = 'button';
  clr.className = 'btn btn-xs';
  clr.setAttribute('data-secret-clear', k);
  clr.textContent = '清除';
  var out = document.createElement('span');
  out.className = 'pane-hint';
  out.setAttribute('role', 'status');
  out.setAttribute('data-copy-out', k);
  input.insertAdjacentElement('afterend', eye);
  eye.insertAdjacentElement('afterend', copy);
  copy.insertAdjacentElement('afterend', clr);
  clr.insertAdjacentElement('afterend', out);
  _maskSecretInput(input, k);
}
/* plugins 分区的内容来自 BF.pluginCenter（启用/卸载插件后会变），不是设置键的函数
   ⇒ 不参与缓存复用，否则「装了插件再开设置」看到的是上一次那份列表。 */
BF.settingsUI._cacheable = function (id) { return id !== 'plugins'; };
BF.settingsUI._putCache = function (id, node) {
  if (!BF.settingsUI._cacheable(id) || !node) return;
  BF.settingsUI._cache[id] = node;
  BF.settingsUI._dirty[id] = false;
};
BF.settingsUI.markDirty = function (key) {
  var secs = BF.settingsUI._keys[key];
  if (secs && secs.length) {
    for (var i = 0; i < secs.length; i++) BF.settingsUI._dirty[secs[i]] = true;
  } else {
    /* 未知键（如首次渲染前外部改动，或该键不在任何分区的 data-set* 上）：
       保守地把所有分区标脏，下一次全量重建，绝不残留旧值。 */
    var all = BF.settingsUI.sections || [];
    for (var j = 0; j < all.length; j++) BF.settingsUI._dirty[all[j].id] = true;
  }
};

BF.settingsUI.summary = function (id) {
  try {
    /* 摘要里只出现给人看的名字：设置里存的是 ASCII 档名（dark / serif / auto / tokenriver），
       原样贴出来就成了「外观：dark · serif · 编码 auto」这种半截英文。同名表：外观走登记表，
       字体走设置行的同一组选项，服务商走能力表。 */
    const _FF = { sans: '无衬线', serif: '衬线', kai: '楷体' };
    if (id === 'appearance') return '外观：' + BF.skin.label(BF.skin.get()) + ' · 字号 ' + (BF.settings.get('fontSize') || 17);
    if (id === 'taste') { var n = (BF.TASTE || []).filter(function (t) { return BF.settings.get(t.key) === 'true' || BF.settings.get(t.key) === true; }).length; return '已开启 ' + n + ' 项界面口味'; }
    if (id === 'experimental') { var _SK = { default: '朱砂书卷', apple: 'Apple 系', mixed: '混搭' }; return '界面风格：' + (_SK[BF.settings.get('skinStyle')] || '朱砂书卷') + ' · 黑白简约：' + (BF.settings.get('bwMode') ? '开' : '关') + ' · 曲径界面：' + (BF.settings.get('qjMode') ? '开' : '关') + ' · 阅读标尺：' + (BF.settings.get('readingRuler') ? '开' : '关') + ' · A 线重分配：' + (BF.settings.get('aLineMode') ? '开' : '关'); }
    if (id === 'reading') return '字号 ' + (BF.settings.get('fontSize') || 17) + ' · 行距 ' + (BF.settings.get('lineHeight') || 1.95) + ' · ' + (_FF[BF.settings.get('fontFamily')] || _FF.serif);
    if (id === 'shelf') return '书架快捷方式';
    if (id === 'parse') {
      const _enc = BF.settings.get('encoding');
      return '分章：' + (BF.settings.get('mergeTocBlock') ? '合并目录' : '不合并') + ' · 编码 ' + ((!_enc || _enc === 'auto') ? '自动' : _enc);
    }
    if (id === 'tts') {
      /* 显示档位名而不是设置里的原始值：'online' / 'offline' 是历史值名，
         用户在这一屏看到的是「Edge 在线」「浏览器语音」，两处该说同一种话 */
      const _f = BF.tts.forcedEngine();
      return '引擎 ' + (_f ? ((BF.tts.cap(_f) || {}).label || _f) : '自动') + ' · 语速 ' + (BF.settings.get('ttsRate') || 1);
    }
    if (id === 'ai') {
      const _pid = BF.settings.get('aiProvider') || '';
      const _p = (BF.ai && BF.ai.providers ? BF.ai.providers() : []).find(function (x) { return x.id === _pid; });
      return '服务商 ' + (_p ? _p.name : '未选') + ' · 模型 ' + (BF.settings.get('aiModel') || '默认');
    }
    if (id === 'data') return '自动备份：' + (BF.settings.get('autoBackup') ? '开' : '关');
    if (id === 'help') return '版本 ' + (BF.VERSION_DISPLAY || '');
    if (id === 'onboard') return '首启引导';
    if (id === 'hotkeys') return '快捷键重绑';
    if (id === 'plugins') return (BF.modules && BF.modules.list ? BF.modules.list().length : 0) + ' 个扩展';
  } catch (e) {}
  return '';
};
/* 概览/子页模式下的左侧导航：概览时每项是下钻入口；子页时隐藏（返回由详情页头部承担）。 */
/* 导航/概览展示层入口集：readPanel 是 reading 的统一面板下钻终点，不是独立设置主题。
   合并双轨后不再单列入导航与概览，但分区注册与 detail:'readPanel' 下钻全部保留，
   保证阅读器字体面板、设置直达按钮、verify-rp/p1/p2 的组件挂载契约不变。 */
BF.settingsUI._navSections = function () {
  return (BF.settingsUI.sections || []).filter(function (sec) { return sec.id !== 'readPanel'; });
};
BF.settingsUI._renderNav = function (detailId) {
  const nav = document.getElementById('settings-nav');
  if (!nav) return;
  if (nav.__navOnClick) nav.removeEventListener('click', nav.__navOnClick);
  nav.__navOnClick = null;
  nav.innerHTML = '';
  if (detailId) { nav.style.display = 'none'; return; }
  nav.style.display = '';
  const secs = BF.settingsUI._navSections();
  nav.innerHTML = secs.map(function (sec, i) {
    const t = BF.settingsUI.TITLES[sec.id] || sec.id;
    return '<button type="button" data-nav-sec="' + BF.dom.escAttr(sec.id) + '" aria-current="false">' + BF.dom.esc(t) + '</button>';
  }).join('');
  const onNavClick = function (e) {
    const btn = e.target && e.target.closest ? e.target.closest('[data-nav-sec]') : null;
    if (!btn) return;
    BF.settingsUI.render({ detail: btn.getAttribute('data-nav-sec') });
  };
  nav.addEventListener('click', onNavClick);
  nav.__navOnClick = onNavClick;
};

BF.settingsUI.render = function (opt) {
  const b = document.getElementById('settings-body');
  if (!b) return;
  const all = !!(opt && opt.all);
  let mode = (opt && opt.mode) || BF.settings.get('settingsLayout') || 'overview';
  /* 全量渲染（打印/重置/插件聚焦）不进概览——直接展平全部控件 */
  if (all) mode = (mode === 'overview' ? 'flat' : mode);
  const detail = (opt && opt.detail) || null;
  BF.settingsUI._renderMode = detail ? 'detail' : mode;
  const secs = BF.settingsUI.sections || [];
  /* 断开上一轮观察器：容器已重建，旧 target 全部失效，留着会泄漏并重复触发 */
  if (BF.settingsUI._io) { try { BF.settingsUI._io.disconnect(); } catch (e) {} BF.settingsUI._io = null; }

  const keepScroll = b.scrollTop;
  b.innerHTML = '';
  /* 重开/换布局/下钻都算「重新浏览」：搜索框与提示必须复位。
     行上的收起态在挂回缓存节点时已逐行放开，这里若不清框面，
     就会留下「框里还写着字号、41 行却全都在」这种自相矛盾的画面。 */
  try {
    const _si = document.getElementById('settings-search');
    if (_si) _si.value = '';
    const _sh = document.getElementById('settings-search-hint');
    if (_sh) _sh.textContent = '';
  } catch (e) {}
  /* 子页下钻：只渲染单分区详情 + 返回；懒渲染/滚动监听/导航高亮都不适用 */
  if (detail) {
    const sec = secs.filter(function (x) { return x.id === detail; })[0];
    if (sec) {
      const back = document.createElement('button');
      back.type = 'button'; back.className = 'settings-back'; back.setAttribute('aria-label', '返回设置');
      back.innerHTML = '← 返回设置';
      back.addEventListener('click', function () { BF.settingsUI.render({ mode: mode }); });
      b.appendChild(back);
      const host = document.createElement('div');
      try {
        try { BF.settingsUI._curSec = sec.id; host.innerHTML = sec.render(); } finally { BF.settingsUI._curSec = null; }
        const node = host.firstElementChild;
        if (node) { host.innerHTML = ''; host.appendChild(node); }
        host.setAttribute('data-sec-host', sec.id);
        try { BF.settingsUI._resetFlush(host, sec.id); } catch (e) {}
        try { BF.settingsUI._putCache(sec.id, host.firstElementChild); } catch (e) {}
        try { _collectKeys(host, sec.id); } catch (e) {}
        try { BF.pluginCenter.bind(host); } catch (e) {}
        /* 统一阅读设置面板：第三层下钻到 readPanel 分区时，把唯一组件挂进容器并绑定事件。
           只在 detail==='readPanel' 时触发，其余分区零影响。 */
        if (detail === 'readPanel') { try { const m = host.querySelector('[data-rp-mount]'); if (m) BF.readPanel.mount(m); } catch (e) {} }
        try { BF.settingsUI.clampAllNumInputs(host); } catch (e) {}
        try { BF.app.sel.scan(host); } catch (e) {}
      } catch (e) { BF.err.report('settings.detail:' + detail, e); }
      b.appendChild(host);
    }
    BF.settingsUI._renderNav(detail);
    b.scrollTop = 0;
    return;
  }
  /* 概览模式：每区一张摘要卡，点「进入」下钻单分区；不再一次性铺开全部控件 */
  if (mode === 'overview') {
    const wrap = document.createElement('div');
    wrap.className = 'settings-overview';
    BF.settingsUI._navSections().forEach(function (sec) {
      const card = document.createElement('div');
      card.className = 'settings-card';
      card.setAttribute('data-open-sec', sec.id);
      card.setAttribute('role', 'button');
      card.setAttribute('tabindex', '0');
      const title = BF.settingsUI.TITLES[sec.id] || sec.id;
      const sum = (BF.settingsUI.summary ? BF.settingsUI.summary(sec.id) : '');
      card.innerHTML = '<div class="settings-card__main"><div class="settings-card__title">' + BF.dom.esc(title) + '</div>' +
        (sum ? '<div class="settings-card__summary">' + BF.dom.esc(sum) + '</div>' : '') + '</div>' +
        '<span class="settings-card__go">进入 →</span>';
      const go = function () { BF.settingsUI.render({ detail: sec.id }); };
      card.addEventListener('click', go);
      card.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
      wrap.appendChild(card);
    });
    b.appendChild(wrap);
    BF.settingsUI._renderNav(null);
    b.scrollTop = 0;
    return;
  }
  const canIO = !all && typeof IntersectionObserver === 'function';
  /* 场景预设置于设置面板顶部（同款：一次点击改一组排版，省去逐项调参） */
  const sc = document.createElement('div');
  sc.innerHTML = BF.scene.html();
  sc.querySelectorAll('[data-scene]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      BF.scene.apply(btn.getAttribute('data-scene'));
      /* 点场景原触发十区全量重建（丢滚动）；改局部重建受影响分区，
         仿插件区 _refresh 先验：rerender 不中才回落全量。 */
      let ok = false;
      try { ok = !!(BF.settingsUI.rerender && BF.settingsUI.rerender('appearance')); } catch (e) {}
      try { BF.settingsUI.rerender && BF.settingsUI.rerender('reading'); } catch (e) {}
      if (!ok) BF.settingsUI.render();
    });
  });
  b.appendChild(sc);

  const build = function (host, sec) {
    try {
      try { BF.settingsUI._curSec = sec.id; host.innerHTML = sec.render(); } finally { BF.settingsUI._curSec = null; }
      const node = host.firstElementChild;
      if (node) { host.innerHTML = ''; host.appendChild(node); }
      /* 真实内容已就位：撤掉占位标记，否则统计与二次加载都会误判 */
      host.classList.remove('set-sec-placeholder');
      host.removeAttribute('data-sec');
      /* 保留分区身份：懒渲染构建后 data-sec 被撤掉，就地重渲染（rerender）需要靠它定位 */
      host.setAttribute('data-sec-host', sec.id);
      try { BF.settingsUI._resetFlush(host, sec.id); } catch (e) {}
      /* 缓存已渲染分区节点，下次 open 未脏则直接复用，跳过 sec.render() 重建 */
      try { BF.settingsUI._putCache(sec.id, node); } catch (e) {}
      try { _collectKeys(node, sec.id); } catch (e) {}
      try { BF.pluginCenter.bind(host); } catch (e) { BF.err.report('pluginCenter.bind', e); }
      try { BF.settingsUI.clampAllNumInputs(host); } catch (e) {}
      /* 自绘下拉：分区是懒渲染的（滚动到才 build），所以扫描必须挂在 build 里，
         否则首屏之外的 select 永远不会被接管。放在 pluginCenter.bind 之后，
         因为 bind 可能往 DOM 里追加节点。 */
      try { BF.app.sel.scan(host); } catch (e) { BF.err.report('sel.scan:' + sec.id, e); }
      if (host.querySelector('[data-alloc-usage]')) { try { BF.settingsUI._fillAllocUsage(); } catch (e) {} }
      if (host.querySelector('[data-sp-rows]')) { try { BF.settingsUI._fillStoragePanel(); } catch (e) {} }
      /* 打开数据页时静默尝试恢复上次绑定的根目录（权限已过期就自动回落内置，不打扰用户）。 */
      if (host.querySelector('[data-root-pick]') && BF.fsync && BF.fsync.restoreRootHandle) {
        Promise.resolve(BF.fsync.restoreRootHandle()).then(function (r) { if (r) { try { BF.settingsUI._fillStoragePanel(); } catch (e) {} } }).catch(function () {});
      }
    } catch (e) { BF.err.report('settings.render:' + sec.id, e); }
  };

  let io = null;
  /* 兜底扫描：IO 只在元素「进入」视口时回调，拖动滚动条一次跳过整段时
     中间分区会被永久跳过、留下空白占位。这里用几何位置补齐：
     任何落在 [视口上-1屏, 视口下+1屏] 的占位都立即构建。 */
  const sweep = function () {
    const ph = b.querySelectorAll('.set-sec-placeholder');
    if (!ph.length) return;
    const box = b.getBoundingClientRect();
    const pad = box.height * BF.CONFIG.SETTINGS_SCROLL_PAD;
    for (let k = 0; k < ph.length; k++) {
      const h = ph[k];
      const r = h.getBoundingClientRect();
      if (r.bottom < box.top - pad || r.top > box.bottom + pad) continue;
      const s = BF.settingsUI.sections.filter(function (x) { return x.id === h.getAttribute('data-sec'); })[0];
      if (s) { if (io) io.unobserve(h); build(h, s); }
    }
  };
  const onScroll = function () { BF.timers.rafFallthru(function () { return b.__secSweepRaf; }, function (v) { b.__secSweepRaf = v; }, function () { sweep(); if (BF.settingsUI._markCurrent) BF.settingsUI._markCurrent(); }); };
  /* #settings-body 是常驻节点，scroll 监听不会随 innerHTML 重建而消失；
     每次 render 都会产生新的 onScroll 闭包，必须先解掉旧的，否则监听器会线性堆积。 */
  if (b.__secOnScroll) b.removeEventListener('scroll', b.__secOnScroll);
  b.__secOnScroll = null;
  if (canIO) { b.addEventListener('scroll', onScroll, { passive: true }); b.__secOnScroll = onScroll; }

  for (let i = 0; i < secs.length; i++) {
    const sec = secs[i];
    /* 未脏的已缓存分区直接复用节点，跳过 sec.render() 重建（性能优化，正确性由脏标记保证） */
    const _cached = BF.settingsUI._cacheable(sec.id) ? BF.settingsUI._cache[sec.id] : null;
    const _dirty = !!(BF.settingsUI._dirty && BF.settingsUI._dirty[sec.id]);
    if (_cached && !_dirty) {
      const host = document.createElement('div');
      host.appendChild(_cached);
      /* 缓存节点会把上一轮的搜索收起态一起带回来（.is-filtered 是挂在行上的 class，
         面板关掉不会自己复原）⇒ 挂回时必须逐行放开，否则「搜过再开」看着像分区空了。 */
      host.querySelectorAll('.is-filtered').forEach(function (n) { n.classList.remove('is-filtered'); });
      host.classList.remove('set-sec-placeholder');
      host.removeAttribute('data-sec');
      host.setAttribute('data-sec-host', sec.id);
      b.appendChild(host);
      continue;
    }
    const host = document.createElement('div');
    if (canIO && i >= BF.settingsUI.LAZY_FROM) {
      /* 占位：只出一行标题 + 提示，真实 DOM 等滚动到附近再建 */
      const title = BF.settingsUI.TITLES[sec.id] || sec.id;
      host.className = 'set-sec-placeholder';
      host.setAttribute('data-sec', sec.id);
      host.innerHTML = '<div class="settings-section" style="margin-bottom:16px;opacity:.55">' +
        '<h4 style="font-size:14px;margin-bottom:6px;color:var(--text-dim)">' + BF.dom.esc(title) + '</h4>' +
        '<div style="font-size:11px;color:var(--text-weak)">向下滚动加载本节…</div></div>';
      b.appendChild(host);
      if (!io) {
        io = new IntersectionObserver(function (ents) {
          ents.forEach(function (en) {
            if (!en.isIntersecting) return;
            const h = en.target;
            io.unobserve(h);
            const s = BF.settingsUI.sections.filter(function (x) { return x.id === h.getAttribute('data-sec'); })[0];
            if (s) build(h, s);
          });
        /* rootMargin 用百分比（相对 root 高度）预加载上下各一屏多，
           快速滚动/锚点跳转时几乎无感；仍跳过的分区由 sweep 补齐。 */
        }, { root: b, rootMargin: (BF.CONFIG.SETTINGS_SCROLL_PAD * 100) + '% 0px' });
      }
      io.observe(host);
      continue;
    }
    build(host, sec);
    b.appendChild(host);
  }
  BF.settingsUI._io = io;
  BF.settingsUI._sweep = sweep;
  /* ===== 左侧分区导航 =====
     文案与占位符完全一致（同一份 TITLES），不另造映射。
     跳转**不另写一套 build 逻辑**：只改 scrollTop，让既有的 IO / sweep
     按原有路径把占位构建掉。若直接调 build() 绕过 IO，就会出现
     「导航点得动、但占位没被清理」以及 IO 仍在 observe 一个已建节点的双重状态。 */
  const nav = document.getElementById('settings-nav');
  if (nav) {
    /* 清掉 detail 视图 _renderNav(detail) 留下的 display:none —— 否则从子页详情切回
       flat/平铺时左侧导航会被永久隐藏（nav 是常驻节点，flat 路径的重建不碰 style.display）。 */
    nav.style.display = '';
    nav.innerHTML = BF.settingsUI._navSections().map(function (sec, i) {
      const t = BF.settingsUI.TITLES[sec.id] || sec.id;
      return '<button type="button" data-nav-sec="' + BF.dom.esc(sec.id) + '" aria-current="' + (i === 0) + '">' + BF.dom.esc(t) + '</button>';
    }).join('');
    /* #settings-nav 是**常驻节点**（不像 #settings-body 会被 innerHTML 清空），
       每轮 render 都会产生新的 onNavClick 闭包。必须先解掉旧的，否则监听器会随
       render 线性堆积：面板有 10 个分区时一次点击本应只写 10 次 aria-current，
       积了几轮 render 后会成倍触发。与下面 __secOnScroll 的处理同源。 */
    if (nav.__navOnClick) nav.removeEventListener('click', nav.__navOnClick);
    nav.__navOnClick = null;
    const onNavClick = function (e) {
      const btn = e.target && e.target.closest ? e.target.closest('[data-nav-sec]') : null;
      if (!btn) return;
      const id = btn.getAttribute('data-nav-sec');
      /* 占位未构建时它仍带 data-sec，构建后改挂 data-sec-host —— 两种都要认 */
      const host = b.querySelector('[data-sec="' + id + '"]') || b.querySelector('[data-sec-host="' + id + '"]');
      if (!host) return;
      b.scrollTop = host.offsetTop - b.offsetTop;
      markNav(id);
      /* 跳转后立刻扫一次：此刻目标已进入视口，IO 回调可能还没派发，
         由几何兜底先把占位建出来，用户不会看到「滚过去了却还是占位符」。 */
      sweep();
      /* 未被 sweep 命中的（如恰在 rootMargin 边缘）再交给 IO：重置 scrollTop
         会产生一次同位置赋值事件，浏览器通常不再触发 scroll，故这里主动补扫 +
         让 IO 的 rootMargin 预加载在下一帧继续生效。 */
      requestAnimationFrame(function () { sweep(); markCurrent(); });
    };
    nav.addEventListener('click', onNavClick);
    nav.__navOnClick = onNavClick;
  }
  /* 以视口顶判定「当前分区」：取最后一个已越过视口上沿的分区 —— 与人眼扫读一致。
     id→锚点映射只用一次 querySelectorAll 建（逐帧每分区 2 次 querySelector 太贵），
     aria-current 只在当前分区真的变了才重写，不每帧全钮回写。 */
  let _lastMark = null;
  const markCurrent = function () {
    if (!nav) return;
    const box = b.getBoundingClientRect();
    const line = box.top + 8;
    const anchors = {};
    b.querySelectorAll('[data-sec],[data-sec-host]').forEach(function (el) {
      const id = el.getAttribute('data-sec') || el.getAttribute('data-sec-host');
      if (!(id in anchors)) anchors[id] = el;
    });
    let cur = secs.length ? secs[0].id : '';
    for (let i = 0; i < secs.length; i++) {
      const h = anchors[secs[i].id];
      if (!h) continue;
      if (h.getBoundingClientRect().top <= line) cur = secs[i].id;
    }
    if (cur === _lastMark) return;
    _lastMark = cur;
    markNav(cur);
  };
  const markNav = function (id) {
    if (!nav) return;
    nav.querySelectorAll('[data-nav-sec]').forEach(function (x) {
      x.setAttribute('aria-current', x.getAttribute('data-nav-sec') === id ? 'true' : 'false');
    });
  };
  try { BF.pluginCenter.bind(b); } catch (e) { BF.err.report('pluginCenter.bind', e); }
  /* 保持滚动位置是重渲染的默认行为，不是懒渲染分支的专利：
     用户正停在某个分区里改设置，整块重渲染（重置默认、快捷键区改键）
     不能把人弹回顶部，所有重渲染路径都要还原 scrollTop。 */
  b.scrollTop = keepScroll;
  /* 首帧后再扫一次：面板刚打开时容器尺寸才稳定，此刻视口内的占位应立即成为真实内容 */
  if (canIO) requestAnimationFrame(sweep);
  /* 把 markCurrent 挂到模块上，供上面 onScroll 调用（闭包内定义、
     但 onScroll 在其之后才被执行，这里显式挂一次即可）。 */
  BF.settingsUI._markCurrent = markCurrent;
  if (markCurrent) requestAnimationFrame(function () { markCurrent(); });
};
/* 强制全量渲染（重置设置后、页面打印、自动化测试断言 DOM 时用） */
BF.settingsUI.renderAll = function () { BF.settingsUI.render({ all: true }); };
/* 就地重渲染单个分区：分区已构建过就只换这一块的 innerHTML，不动其余分区，
   因此懒渲染的其余占位不会被推回占位状态（点插件筛选标签时必需）。
   返回 true=已就地重建；false=该分区尚未构建，交给调用方决定是否全量 render。 */
BF.settingsUI.rerender = function (secId) {
  const b = document.getElementById('settings-body');
  if (!b) return false;
  const host = b.querySelector('[data-sec-host="' + secId + '"]');
  if (!host) return false;
  const sec = (BF.settingsUI.sections || []).filter(function (x) { return x.id === secId; })[0];
  if (!sec) return false;
  try {
    try { BF.settingsUI._curSec = secId; host.innerHTML = sec.render(); } finally { BF.settingsUI._curSec = null; }
    const node = host.firstElementChild;
    if (node) { host.innerHTML = ''; host.appendChild(node); }
    /* 就地重渲染后同步更新缓存与 key 映射，避免下次 open 复用陈旧的缓存节点 */
    try { BF.settingsUI._resetFlush(host, secId); } catch (e) {}
    try { BF.settingsUI._putCache(secId, node); } catch (e) {}
    try { _collectKeys(node, secId); } catch (e) {}
    try { BF.pluginCenter.bind(host); } catch (e) { BF.err.report('pluginCenter.bind', e); }
    try { BF.settingsUI.clampAllNumInputs(host); } catch (e) {}
    /* 与 build() 对齐：innerHTML 重建出来的是全新 <select> 节点，__bf 标记随之消失。
       不重新接管 = 露出原生控件，而且 .bf-sel-native 那套隐藏样式也没了——
       切一次「外观模式」就会有 3 个下拉退回原生态（外观 / 主题 / 强调色）。 */
    try { BF.app.sel.scan(host); } catch (e) { BF.err.report('sel.scan:rerender:' + secId, e); }
  } catch (e) { BF.err.report('settings.rerender:' + secId, e); return false; }
  return true;
};
BF.settingsUI.open = function (secId) {
  BF.sheet.open('settings', { render: function () {
    BF.settingsUI.render(secId ? { detail: secId } : undefined);
  } });
  /* 健康灯刷新：不传 force ⇒ 只看本地事实与上次结论，不联网
     （联网探测改到语音区的「测一次连接」按钮上） */
  try { BF.tts.stab.probeAll(); } catch (e) {}
  BF.settingsUI._wireSearch();
  /* R3-B：每次打开都复位搜索空态——#settings-body 是常驻节点，若上次关闭时停留在「无匹配」
     空态（body.hidden=true），不复位会让重开的设置页整片空白。 */
  BF.settingsUI._clearSearchEmpty();
  /* 分区定位：传入 secId 时滚动到对应分区并闪光提示（定位实现抽进 _jumpToSec，
     与搜索框共用同一处），用户不必自己往下翻找具体项。 */
  if (secId) BF.settingsUI._jumpToSec(secId);
};
/* 分区定位：懒渲染分区（占位带 data-sec）滚到占位即由 IO/sweep 就地构建；
   已构建分区（data-sec-host）直接滚动。高亮走内联 style（不新增 CSS 规则——
   结构完整性防线承诺 CSS 逐字节未改，视觉反馈由 JS 内联样式承担，1.6s 后还原）。 */
BF.settingsUI._jumpToSec = function (secId) {
  if (!secId) return;
  setTimeout(function () {
    try {
      const b = document.getElementById('settings-body');
      if (!b) return;
      const host = b.querySelector('[data-sec-host="' + secId + '"]') || b.querySelector('[data-sec="' + secId + '"]');
      if (!host) return;
      host.scrollIntoView({ block: 'start' });
      const _o = host.style.outline, _bg = host.style.background;
      host.style.outline = '2px solid var(--accent)';
      host.style.background = 'var(--bg-input)';
      setTimeout(function () { host.style.outline = _o; host.style.background = _bg; }, 1600);
    } catch (e) {}
  }, 60);
};
/* 设置项搜索：从各分区渲染结果抽 <label> 文本建 label→分区 id 索引（DOMParser 解码，
   构建与消费保持一致），输入即定位到首个命中的分区。索引一次构建终身复用。 */
BF.settingsUI._buildSetIndex = function () {
  if (BF.settingsUI._setIndex) return;
  const idx = [], secMap = {}, seen = new Set();
  (BF.settingsUI.sections || []).forEach(function (sec) {
    try {
      const html = sec.render ? sec.render() : '';
      const _doc = new DOMParser().parseFromString('<div>' + html + '</div>', 'text/html');
      _doc.querySelectorAll('label').forEach(function (lbl) {
        const l = (lbl.textContent || '').trim();
        if (!l) return;
        if (!seen.has(l)) { seen.add(l); idx.push(l); secMap[l] = sec.id; }
      });
    } catch (e) {}
  });
  BF.settingsUI._setIndex = idx;
  /* 小写形与索引同步预生成一次——每次按键都对全标签现算 toLowerCase 会拖慢输入 */
  BF.settingsUI._setIndexLow = idx.map(function (l) { return l.toLowerCase(); });
  BF.settingsUI._setSec = secMap;
};
/* R3-B：设置搜索无匹配时把内容区整体替换为空态卡（图标 + 文案 + 清除按钮）；
   有匹配 / 空查询时恢复内容区。设置行本体 DOM 不动，只切 #settings-body 与空态卡的 hidden
   （全局 [hidden]{display:none!important} 兜底，结构完整性防线承诺 CSS 逐字节未改）。 */
BF.settingsUI._setSearchEmpty = function (q) {
  const body = document.getElementById('settings-body');
  const empty = document.getElementById('settings-search-empty');
  if (body) body.hidden = true;
  if (empty) {
    const qs = document.getElementById('settings-search-empty-q');
    if (qs) qs.textContent = q || '';
    const ic = document.getElementById('settings-search-empty-ic');
    if (ic && !ic.firstChild && BF.dom.ic) ic.innerHTML = BF.dom.ic('find') || '';
    empty.hidden = false;
  }
};
BF.settingsUI._clearSearchEmpty = function () {
  const body = document.getElementById('settings-body');
  const empty = document.getElementById('settings-search-empty');
  if (body) body.hidden = false;
  if (empty) empty.hidden = true;
};
BF.settingsUI._wireSearch = function () {
  const input = document.getElementById('settings-search');
  if (!input || input._searchWired) return;
  input._searchWired = true;
  const hint = document.getElementById('settings-search-hint');
  /* 把「按 k 过滤 + 切空态」抽成 apply：input 监听与「清除搜索」按钮共用同一份，
     避免清除走另一套逻辑导致状态不一致。 */
  const apply = function (k) {
    BF.settingsUI._buildSetIndex();
    /* 先算命中，再决定要不要跳分区：空查询也必须走完下面的还原路径，
       否则上一轮收起来的行永远回不来（早退是这条最容易犯的错）。 */
    /* 先按设置项标签命中，命不中再按分区中文名命中 */
    let secId = null;
    for (let i = 0; i < BF.settingsUI._setIndexLow.length; i++) {
      if (BF.settingsUI._setIndexLow[i].includes(k)) { secId = BF.settingsUI._setSec[BF.settingsUI._setIndex[i]]; break; }
    }
    if (!secId) {
      const T = BF.settingsUI.TITLES || {};
      (BF.settingsUI.sections || []).forEach(function (sec) { if (!secId && (T[sec.id] || '').toLowerCase().includes(k)) secId = sec.id; });
    }
    /* 概览模式下：命中即下钻到该分区详情，空查询还原（概览无 .setting-row，不走下方行过滤） */
    if (BF.settingsUI._renderMode === 'overview') {
      if (secId) BF.settingsUI.render({ detail: secId });
      /* 无匹配：内容区替为空态卡，header 小提示降为空白（不再重复报「无匹配项」）。 */
      if (k && !secId) { BF.settingsUI._setSearchEmpty(input.value.trim()); }
      else { BF.settingsUI._clearSearchEmpty(); }
      if (hint) hint.textContent = k ? (secId ? '进入：' + ((BF.settingsUI.TITLES && BF.settingsUI.TITLES[secId]) || secId) : '') : '';
      return;
    }
    /* 过滤本身：只跳不筛 = 报告「已定位」而 34 行设置一行都没少，用户只会认为搜索是坏的。
       按行的可见文本判命中，命不中的挂 class 收起（写在 CSS 里，不往行上塞内联样式）。
       空查询必须把每一行都放回来。 */
    /* F-01：命中分区必须先【同步】渲染出来，再对它的行计数。
       _jumpToSec 内部是 setTimeout(…,0)，跳转发生在下一个 tick；
       原先「先数当前屏、后跳转」在命中项位于别的分区时 hits 恒 0，
       用户就看到「没有匹配」的假空态。overview 分支早有这一步，detail 分支补上。 */
    if (secId) BF.settingsUI.render({ detail: secId });
    const rows = Array.prototype.slice.call(document.querySelectorAll('.settings-section .setting-row'));
    let hits = 0;
    rows.forEach(function (row) {
      const on = !k || String(row.textContent || '').toLowerCase().indexOf(k) >= 0;
      row.classList.toggle('is-filtered', !on);
      if (on) hits++;
    });
    if (secId) BF.settingsUI._jumpToSec(secId);
    /* R3-B：无匹配 → 内容区替为空态卡、header 小提示降空白；有匹配 → 恢复内容区并报告命中数。 */
    if (k && hits === 0) { BF.settingsUI._setSearchEmpty(input.value.trim()); if (hint) hint.textContent = ''; }
    else { BF.settingsUI._clearSearchEmpty(); if (hint) hint.textContent = k ? '命中 ' + hits + ' 项' : ''; }
  };
  input.addEventListener('input', function () {
    try { apply((input.value || '').trim().toLowerCase()); } catch (e) { if (hint) hint.textContent = ''; }
  });
  /* 「清除搜索」按钮：清空输入框并复位（程序改 value 不触发 input 事件，必须手动 apply('')）。 */
  const clr = document.getElementById('settings-search-empty-clear');
  if (clr && !clr._clearWired) {
    clr._clearWired = true;
    clr.addEventListener('click', function () {
      input.value = '';
      try { apply(''); } catch (e) {}
      try { input.focus(); } catch (e) {}
    });
  }
};
/* 顶栏齿轮 / 微读栏 / 更多菜单点「设置」是再点一次收起；
   带 secId 的调用（搜索设置项、运维台里的「直达设置开关」）是导航，仍走 open()。 */
BF.settingsUI.toggle = function () {
  if (BF.sheet.closable('settings')) { BF.sheet.close('settings'); return false; }
  BF.settingsUI.open(); return true;   /* open() 里那记按需健康探针不能绕掉 */
};
BF.settingsUI.close = function () { BF.sheet.close('settings'); };

