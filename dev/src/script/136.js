/* ================= 分区实现 ================= */
/* 分组恢复默认：每 6 个设置项后跟一条「恢复默认」，只还原本组键。
   由 _row 收口计数（所有分区的行都过这里），按当前渲染分区换组；
   热键/插件/帮助/引导/AI 不参与 —— 重绑、密钥与自建预设不属于可还原的普通设置项。 */
BF.settingsUI._RESET_EVERY = 6;
BF.settingsUI._RESET_SKIP = { hotkeys: 1, plugins: 1, help: 1, onboard: 1, ai: 1 };
BF.settingsUI._curSec = null;    /* 由各渲染路径在 sec.render() 前后设置/清空 */
BF.settingsUI._resetBuf = { sec: null, n: 0, keys: [] };
BF.settingsUI._resetRowHtml = function (keys) {
  return '<div class="setting-reset-row">' +
    '<button type="button" class="btn btn-xs" data-reset-keys="' + BF.dom.escAttr(keys.join(',')) + '" aria-label="恢复本组默认设置">恢复默认</button></div>';
};
/* 收尾：分区末尾不足一组的余项也要有恢复入口（否则每区最后几项永远不可还原）。
   在三条渲染路径建完节点、入缓存之前调用，保证缓存节点带按钮。 */
BF.settingsUI._resetFlush = function (host, secId) {
  try {
    const buf = BF.settingsUI._resetBuf;
    if (buf.sec === secId && buf.keys.length && !BF.settingsUI._RESET_SKIP[secId]) {
      const wrap = document.createElement('div');
      wrap.innerHTML = BF.settingsUI._resetRowHtml(buf.keys.slice());
      const sec = host.querySelector('.settings-section') || host.firstElementChild;
      if (sec && wrap.firstChild) sec.appendChild(wrap.firstChild);
    }
    buf.sec = null; buf.n = 0; buf.keys = [];
  } catch (e) {}
};
BF.settingsUI._row = function (label, inner) {
  const row = '<div class="setting-row" style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">' +
    '<label style="flex:0 0 132px;font-size:13px;color:var(--text-dim);line-height:1.4">' + label + '</label>' +
    '<div style="flex:1;display:flex;align-items:center;gap:6px">' + inner + '</div></div>';
  /* 分组恢复默认：累计本行的 data-set* 键，满一组吐一条恢复按钮 */
  try {
    const sec = BF.settingsUI._curSec;
    if (sec && !BF.settingsUI._RESET_SKIP[sec]) {
      const buf = BF.settingsUI._resetBuf;
      if (buf.sec !== sec) { buf.sec = sec; buf.n = 0; buf.keys = []; }
      const ms = String(inner).match(/data-set(?:-num|-step|-text)?="[^"]+"/g);
      if (ms && ms.length) {
        ms.forEach(function (a) { const k = a.slice(a.indexOf('"') + 1, -1); if (buf.keys.indexOf(k) < 0) buf.keys.push(k); });
        if (++buf.n >= BF.settingsUI._RESET_EVERY) {
          const html = BF.settingsUI._resetRowHtml(buf.keys.slice());
          buf.n = 0; buf.keys = [];
          return row + html;
        }
      }
    }
  } catch (e) {}
  return row;
};
/* T2 强调色：四色块即点即换。仍是同一份 accent 键与四色合法值——只在外观上把
   下拉换成色块，写入/对账/热加载链路一行不改。regEnum 在这里显式登记（原先由
   _sel 顺手做，换成色块后没有原生 select 触发，故移到这里，杜绝写入侧失去校验）。 */
BF.settingsUI._accentSwatches = function () {
  const opts = [['red', '朱砂'], ['amber', '赭黄'], ['green', '松绿'], ['blue', '黛蓝']];
  try { BF.settings.regEnum('accent', opts); } catch (e) {}
  const cur = String(BF.settings.get('accent') || 'red');
  return '<span class="accent-dots" role="group" aria-label="强调色">' + opts.map(function (o) {
    return '<button type="button" class="accent-dot" data-accent="' + o[0] + '" title="' + o[1] + '" aria-label="强调色：' + o[1] + '" aria-pressed="' + (cur === o[0]) + '"></button>';
  }).join('') + '</span>';
};
BF.settingsUI._sel = function (name, opts) {
  /* 顺手把这一档的合法值登记给写入侧（BF.settings.set 用它拒掉名单外的值）。
     名单来自这里渲染的选项本身，不另建一份枚举表——两份列表迟早会漂。
     登记时机是「这一行被画过之后」：没打开过的分区不校验，等价于今日行为，不会误拒。 */
  try { BF.settings.regEnum(name, opts); } catch (e) {}
  const cur = BF.settings.get(name);
  return '<select class="select" data-set="' + name + '" style="flex:1">' +
    opts.map(function (o) {
      return '<option value="' + BF.dom.escAttr(o[0]) + '"' + (cur === o[0] || String(cur) === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
    }).join('') + '</select>';
};
/* 分组平铺模式（settingsLayout='grouped'）下的子分组包裹：
   仅在该模式吐出 <h5> 子标题，把同区控件归并到语义组；
   其余模式原样返回，保持「原平铺」行为不变。不改 key 名与 data-set 绑定。 */
BF.settingsUI._sub = function (title, rows) {
  if (BF.settingsUI._renderMode === 'grouped') {
    return '<div class="settings-subgroup"><div class="subgroup-title">' + BF.dom.esc(title) + '</div>' + rows + '</div>';
  }
  return rows;
};
/* TTS 折叠分组（从分支合并）：引擎专属行包一层可点击折叠卡片，
   折叠态走 hidden/aria-expanded，不重建不丢焦点；defaultOpen 默认展开「引擎与策略」。 */
BF.settingsUI._ttsCgroup = function (title, rows, opts) {
  opts = opts || {};
  var key = opts.group || '';
  var note = opts.note || '';
  var defOpen = opts.open ? 'true' : 'false';
  var defHidden = opts.open ? '' : 'hidden';
  var dataGroup = key ? ' data-tts-group="' + BF.dom.escAttr(key) + '"' : '';
  var defOpenAttr = opts.open ? ' data-tts-default-open="1"' : '';
  return '<div class="tts-cgroup"' + dataGroup + defOpenAttr + '>' +
    '<div class="tts-cgroup__head" role="button" tabindex="0" aria-expanded="' + defOpen + '">' +
    '<span class="tts-cgroup__caret">▶</span>' +
    '<span class="tts-cgroup__title">' + BF.dom.esc(title) + '</span>' +
    (note ? '<span class="tts-cgroup__note">' + BF.dom.esc(note) + '</span>' : '') +
    '</div>' +
    '<div class="tts-cgroup__body"' + (defHidden ? ' ' + defHidden : '') + '>' + rows + '</div>' +
    '</div>';
};

/* 背景氛围的真实状态行。抽成函数而不是内联进 register：
   渲染时用它生成，改设置时用它就地替换 —— 两处共用一份逻辑，
   不会出现「初次渲染显示已暂停、改完设置却显示运行中」这种漂移。 */
BF.settingsUI._ambRowHtml = function () {
  if (!BF.amb || !BF.amb.describe) return '';
  const amb = BF.amb.describe();
  if (amb.kind === 'none') {
    return '<div class="set-amb" data-amb-row style="padding:2px 0 8px calc(148px + var(--sp-4));font-size:12px;color:var(--text-weak)">背景动画已关闭</div>';
  }
  return '<div class="set-amb" data-amb-row style="display:flex;align-items:center;gap:6px;padding:2px 0 8px calc(148px + var(--sp-4));font-size:12px;color:'
    + (amb.on ? 'var(--text-weak)' : 'var(--warning-ink)') + '">' +
    '<span style="width:6px;height:6px;border-radius:50%;flex-shrink:0;background:'
    + (amb.on ? 'var(--success)' : 'var(--warning)') + '"></span>' +
    (amb.on ? '「' + BF.dom.esc(amb.label) + '」正在运行' : '「' + BF.dom.esc(amb.label) + '」已暂停 · ' + BF.dom.esc(amb.reason)) +
    '</div>';
};
/* 主题 ∪ 外观模式合并为单键：一个键不可能自相矛盾，无需跨轴让位提示。 */
BF.settingsUI.refreshAmbRow = function () {
  const old = document.querySelector('[data-amb-row]');
  if (!old) return;
  const holder = document.createElement('div');
  holder.innerHTML = BF.settingsUI._ambRowHtml();
  const fresh = holder.firstElementChild;
  if (fresh) old.parentNode.replaceChild(fresh, old);
};
/* 就地校正下拉框的显示值：设置互斥规则改了「另一个框」的值时，
   只改这个框的值并同步自绘触发器，不重建分区。 */
BF.settingsUI.syncValues = function (keys) {
  (keys || []).forEach(function (k) {
    const els = document.querySelectorAll('#settings-body select[data-set="' + k + '"]');
    for (let i = 0; i < els.length; i++) {
      const cur = String(BF.settings.get(k));
      if (els[i].value === cur) continue;
      els[i].value = cur;
      try { BF.app.sel.sync(els[i]); } catch (e) {}
    }
  });
};

BF.settingsUI.register('appearance', 1, function () {
  /* 背景氛围的真实状态。下拉框只反映「设置里选了什么」，而 BF.amb.blocked
     还有 4 个外部条件（系统减少动效 / 分页模式 / 低帧降级 / 设置里的减少动效）
     会让它静默不生效——这一行把不生效的原因直接写出来，
     避免用户误以为是自己选错了。 */
  return '<div class="settings-section" style="margin-bottom:16px"><h4 style="font-size:14px;margin-bottom:8px;color:var(--text)">外观</h4>' +
    BF.settingsUI._row('设置页布局', BF.settingsUI._sel('settingsLayout', [['overview', '概览下钻（默认 · 每区一张摘要卡，点进再改）'], ['grouped', '分组平铺（同区分组，控件仍全展开）'], ['flat', '原平铺（全部控件一次铺开）']])) +
    BF.settingsUI._row('外观模式', BF.settingsUI._sel('appearance', BF.skin.opts())) +
    BF.settingsUI._row('强调色', BF.settingsUI._accentSwatches()) +
    BF.settingsUI._row('亮度', '<span style="font-size:11px;color:var(--text-weak);flex:none">60</span><input type="range" min="60" max="140" step="5" value="' + (BF.settings.get('brightness') || 100) + '" data-set-num="brightness" style="flex:1"/><span style="font-size:11px;color:var(--text-weak);flex:none">140</span>') +
    BF.settingsUI._row('夜间自动', BF.settingsUI._sel('autoTheme', [['true', '开启（19:00–06:00 深色）'], ['false', '关闭']])) +
    BF.settingsUI._row('减少动效', BF.settingsUI._sel('reduceMotion', [['true', '开启'], ['false', '关闭']])) +
    BF.settingsUI._row('背景氛围', BF.settingsUI._sel('bgAnim', [['none', '关闭'], ['mist', '薄雾'], ['aurora', '极光'], ['ember', '余烬']])) +
    BF.settingsUI._ambRowHtml() +
    BF.settingsUI._row('书架密度', BF.settingsUI._sel('shelfDensity', [['compact', '紧凑'], ['normal', '标准'], ['comfortable', '宽松']])) +
    BF.settingsUI._row('黑白简约风格<br/><span class="taste-note">灰度令牌 + 直角硬边的极简外观，与明暗/色板叠加生效，关闭即还原。这是一档叠加风格，不是替代界面</span>',
      BF.settingsUI._sel('bwMode', [['false', '关闭'], ['true', '开启']])) +
    BF.settingsUI._row('隐藏底部标签栏<br/><span class="taste-note">关掉后首页/书架/笔记/我的四页底部导航栏收起，页面切换与数据不受影响；恢复走顶栏齿轮「设置」或终端 settings hideTabBar false</span>',
      BF.settingsUI._sel('hideTabBar', [['false', '关闭'], ['true', '开启']])) +
    '</div>';
});
/* 界面口味：一条一行，行由 BF.TASTE 生成。手抄第二份的代价是加一条口味时
   登记表、令牌、设置面板三处不同步——正是这一路一直在清零的那类病。 */
/* A组 3 口味预设：原味（全关）/ 精致 / 灵动，一键批量设一组口味开关。
   预设只写 BF.TASTE 里已登记的键，不改开关数量——fact-check 的「十六道」对账不受影响。
   点完就地同步各开关下拉与摘要数字，不重建面板（保住滚动位置）。 */
BF.settingsUI.TASTE_PRESETS = {
  'plain':   { name: '原味', ids: [] },
  'refined': { name: '精致', ids: ['cardedge', 'coverlight', 'eyebrow', 'aline-soft'] },
  'lively':  { name: '灵动', ids: ['spring', 'stagger', 'countup', 'aline-glass'] },
};
BF.settingsUI._tastePresetBar = function () {
  return '<div class="taste-presets" role="group" aria-label="界面口味预设">' +
    '<span class="taste-presets__hint">一键预设</span>' +
    Object.keys(BF.settingsUI.TASTE_PRESETS).map(function (k) {
      var p = BF.settingsUI.TASTE_PRESETS[k];
      return '<button type="button" class="btn btn-sm" data-taste-preset="' + k + '">' + p.name + '</button>';
    }).join('') + '</div>';
};
BF.settingsUI.register('taste', 1.5, function () {
  /* 16 条口味默认折叠：它们是长尾微调，平铺会占满一屏、把常用设置挤到下面。
     用现成的 .bf-fold（零新增内联样式，内联 style 棘轮只剩 1 个余量），
     展开后每一行的 data-set 绑定不变，改设置/恢复默认/自动化测试照常工作。 */
  var _on = (BF.TASTE || []).filter(function (t) { return BF.settings.get(t.key) === 'true' || BF.settings.get(t.key) === true; }).length;
  var _rows = BF.TASTE.map(function (t) {
    return BF.settingsUI._row(t.label + '<br/><span class="taste-note">' + t.note + '</span>',
      BF.settingsUI._sel(t.key, [['false', '关闭'], ['true', '开启']]));
  }).join('');
  return '<div class="settings-section" style="margin-bottom:16px"><h4 style="font-size:14px;margin-bottom:8px;color:var(--text)">界面口味</h4>' +
    BF.settingsUI._tastePresetBar() +
    '<details class="bf-fold"><summary id="taste-summary">展开细调（当前已开启 ' + _on + ' 项 · 关掉即回到原样，「减少动效」优先于动效类口味）</summary>' +
    _rows + '</details></div>';
});
/* 界面方案分区：一条一个方案开关。黑白简约 = 全站灰度极简界面——
   灰度令牌由 BF.theme.apply 末尾注入（BF.BW_*_TOKENS），结构层（圆角、
   阴影、纹理、反相件）见 <head> 末尾样式块；功能 DOM/事件零改动。 */
BF.settingsUI.register('experimental', 1.6, function () {
  return '<div class="settings-section"><h4>界面方案</h4>' +
    '<div class="settings-intro">换一套界面的呈现方式；每条独立开关，关掉即完全还原。</div>' +
    BF.settingsUI._row('界面风格<br/><span class="taste-note">材质外壳（朱砂 / Apple 毛玻璃 / 混搭）：只改视觉，不改功能。选 Apple 系即自带毛玻璃与流体交互（触控热区 / 弹簧缓动 / 焦点环 / 动效降级），无需另开开关</span>',
      BF.settingsUI._sel('skinStyle', [
        ['default', '朱砂书卷'],
        ['apple', 'Apple 系（毛玻璃 + 胶囊按钮）'],
        ['mixed', '混搭（Apple 外壳 + 原生阅读页）'],
      ])) +
    BF.settingsUI._row('曲径界面<br/><span class="taste-note">多驿站式界面：今 / 架 / 迹 / 坊 / 笺五站串成一条路，独立路由与统计图；开启后应用落在曲径，右上「出口」与本开关是唯一退路；仅由此开关开/关</span>',
      BF.settingsUI._sel('qjMode', [['false', '关闭'], ['true', '开启']])) +
    BF.settingsUI._row('A 线·现行主题重分配<br/><span class="taste-note">不改色值，只重分配参数：标签字距改 em、区块标题主次由颜色而非字重表达、圆角只给纸面向元素、首页间距重编排、加毛玻璃层；与当前外观叠加生效，关闭即完全还原</span>',
      BF.settingsUI._sel('aLineMode', [['false', '关闭（默认）'], ['true', '开启']])) +
    '</div>';
});
/* ── 统一阅读设置面板（设置第三层）：复用 BF.readPanel.html()，与微读浮层同一渲染源。
   下钻由 render({detail:'readPanel'}) 完成，事件绑定在 detail 渲染钩子处调 mount。 */
BF.settingsUI.register('readPanel', 2.2, function () {
  return '<div class="settings-section"><h4>阅读设置</h4>' +
    '<div class="taste-note rp-lead">排版 / 字号 / 行距 / 配色 / 翻页，与阅读器里的「字体」面板是同一套，改一处两边都生效。</div>' +
    '<div data-rp-mount></div></div>';
});
BF.settingsUI.register('reading', 2, function () {
  const fs = BF.settings.get('fontSize');
  return '<div class="settings-section" style="margin-bottom:16px"><h4 style="font-size:14px;margin-bottom:8px;color:var(--text)">阅读</h4>' +
    /* 统一面板入口：阅读设置面板被阅读器与设置两处引用，点这里下钻到第三层的同一组件。 */
    BF.settingsUI._row('阅读设置面板', '<button type="button" class="btn btn-sm" data-open-readpanel>打开排版 / 字号 / 配色面板 ›</button>') +
    BF.settingsUI._sub('字体与排版',
      /* 滑块区间取 RANGES：快捷键能把字号推到 10 与 40，滑块只到 12–32 就会
         出现「拖到头的 32」与「快捷键留下的 40」两套显示口径 */
      BF.settingsUI._row('字号', '<input type="range" min="' + BF.settings.RANGES.fontSize.min + '" max="' + BF.settings.RANGES.fontSize.max + '" step="1" value="' + fs + '" data-set-num="fontSize" style="flex:1"/><span style="font-size:12px;color:var(--text-weak)">' + fs + 'px</span>') +
      /* R4 口径统一：行距与阅读设置面板同用一条 1.3–2.6 滑块（原三档下拉与面板滑块、
         快捷键 ±0.1 三套口径并存，同一 key 三种显示，现已收敛为一条连续口径）。 */
      BF.settingsUI._row('行距', '<input type="range" class="set-range" min="1.3" max="2.6" step="0.1" value="' + Number(BF.settings.get('lineHeight') || 1.9) + '" data-set-num="lineHeight"/><span class="set-val">' + Number(BF.settings.get('lineHeight') || 1.9).toFixed(1) + '</span>') +
      BF.settingsUI._row('字间距', '<span style="font-size:11px;color:var(--text-weak);flex:none">0</span><input type="range" min="0" max="4" step="0.5" value="' + (BF.settings.get('wordSpacing') || 0) + '" data-set-num="wordSpacing" style="flex:1"/><span style="font-size:11px;color:var(--text-weak);flex:none">4</span>') +
      BF.settingsUI._row('段间距', '<span style="font-size:11px;color:var(--text-weak);flex:none">0.5</span><input type="range" min="0.5" max="2" step="0.1" value="' + (BF.settings.get('paraSpacing') || 1) + '" data-set-step="paraSpacing" style="flex:1"/><span style="font-size:11px;color:var(--text-weak);flex:none">2</span>') +
      BF.settingsUI._row('字体', BF.settingsUI._sel('fontFamily', [['sans', '无衬线'], ['serif', '衬线'], ['kai', '楷体']])) +
      BF.settingsUI._row('首行缩进', BF.settingsUI._sel('noIndent', [['false', '开启'], ['true', '关闭']])) +
      BF.settingsUI._row('两端对齐', BF.settingsUI._sel('justify', [['false', '关闭'], ['true', '开启']]))
    ) +
    BF.settingsUI._sub('屏幕与版式',
      BF.settingsUI._row('翻页方式', BF.settingsUI._sel('readerMode', [['scroll', '滚动'], ['page', '分页']])) +
      BF.settingsUI._row('微读排版', BF.settingsUI._sel('microread', [['false', '关闭'], ['true', '开启']])) +
      BF.settingsUI._row('页边距', BF.settingsUI._sel('readerMargin', [['narrow', '窄'], ['normal', '标准'], ['wide', '宽']])) +
      BF.settingsUI._row('色温', BF.settingsUI._sel('warmth', [['off', '关闭'], ['mild', '微暖'], ['warm', '暖'], ['dusk', '黄昏']])) +
      BF.settingsUI._row('阅读滤镜', BF.settingsUI._sel('readerFilter', [['none', '标准'], ['sepia', '纸色'], ['paper', '纸感'], ['night', '夜间'], ['clean-white', '纯白'], ['clean-black', '纯净黑']])) +
      BF.settingsUI._row('滚动条<br/><span class="taste-note">三选一：「始终显示」全站保留；「仅非阅读页」除阅读页外都显示；「全站隐藏」连阅读页一起隐藏。三者互斥，选一个即可</span>',
      (function () {
        var _sb = BF.settings.get('hideScrollbar') ? 'hidden' : (BF.settings.get('showScrollbarReadingOnly') ? 'always' : 'reading');
        return '<select class="select" data-sb-mode>' +
          '<option value="always"' + (_sb === 'always' ? ' selected' : '') + '>始终显示</option>' +
          '<option value="reading"' + (_sb === 'reading' ? ' selected' : '') + '>仅非阅读页显示</option>' +
          '<option value="hidden"' + (_sb === 'hidden' ? ' selected' : '') + '>全站隐藏</option></select>';
      })()) +
      BF.settingsUI._row('极简模式', BF.settingsUI._sel('simpleMode', [['true', '开启'], ['false', '关闭']])) +
      BF.settingsUI._row('阅读标尺（桌面）<br/><span class="taste-note">跟随鼠标的横向参考线，主要在桌面端有意义；默认关闭</span>',
        BF.settingsUI._sel('readingRuler', [['false', '关闭（默认）'], ['true', '开启（跟随鼠标的横线）']])) +
      BF.settingsUI._row('英文断词', BF.settingsUI._sel('enHyphen', [['false', '关闭（默认）'], ['true', '开启（只作用于英文段落）']])) +
      BF.settingsUI._row('文首信息块面板', BF.settingsUI._sel('bookInfoPanel', [['false', '关闭（默认，按章节显示）'], ['true', '开启（目录顶部多一条原文面板）']]))
    ) +
    BF.settingsUI._sub('阅读流程',
      BF.settingsUI._row('章末下一章', BF.settingsUI._sel('chapterEndContinue', [['true', '开启'], ['false', '关闭']])) +
      BF.settingsUI._row('章节预取', BF.settingsUI._sel('chapterPrefetch', [['true', '开启'], ['false', '关闭']])) +
      BF.settingsUI._row('自动保存进度', BF.settingsUI._sel('autoSave', [['true', '开启（每 20 秒）'], ['false', '关闭']])) +
      BF.settingsUI._row('自动滚动速度', BF.settingsUI._sel('scrollSpeed', [['1', '慢'], ['3', '标准'], ['6', '快'], ['10', '很快']])) +
      /* 随书偏好可见化——入口行：展示当前书的记忆项数（取自数据层），
         清除按钮（data-prefs-clear）走全局委托（见设置面板委托区）。 */
      (function () {
        const _bid = BF.appState.currentBookId;
        const _n = (BF.prefs && typeof BF.prefs.count === 'function') ? BF.prefs.count(_bid) : 0;
        return BF.settingsUI._row('随书偏好', '<span style="font-size:12px;color:var(--text-dim)">' + (_n ? '当前书已记忆 ' + _n + ' 项（如字号）' : '当前书无记忆项（调整字号后自动按书记忆）') + '</span> <button class="btn btn-xs" data-prefs-clear>清除当前书</button>');
      })()
    ) +
    '</div>';
});
/* 书架节：目前只有「卡面常驻哪几枚」。渲染整块来自 BF.bookActionsPickerHTML ——
   与书架顶栏就地入口是同一个函数，两处画面不必各抄一份。 */
BF.settingsUI.register('shelf', 2.5, function () {
  const S = BF.settingsUI;
  let mstyle = 'dropdown';
  try { mstyle = BF.settings.get('moreMenuStyle') || 'dropdown'; } catch (e) {}
  const pinned = BF.uiMenu.pinnedIds ? BF.uiMenu.pinnedIds() : [];
  const chips = BF.uiMenu.itemsFor('shelf').map(function (it) {
    const on = pinned.indexOf(it.id) >= 0;
    return '<button type="button" class="bf-more-item" data-pin-toggle="' + it.id + '" aria-pressed="' + on + '">' + BF.dom.esc(it.label) + '</button>';
  }).join('');
  return '<div class="settings-section"><h4 class="sec-title">书架</h4>' + BF.bookActionsPickerHTML() +
    S._row('更多菜单样式', S._sel('moreMenuStyle', [['dropdown', '下拉列表（默认）'], ['panel', '平铺面板']])) +
    S._row('固定到顶栏', '<div class="bf-pin-chips">' + chips + '</div>') +
    '<div class="bf-set-hint">「固定到顶栏」点亮的项会以文字按钮出现在首页与书架顶栏「更多」按钮左侧；「更多」菜单里仍保留全部条目。终端语言在「终端」节（默认英文，可切中文）。</div>' +
    '</div>';
});
/* 顶栏固定项圈选：点亮/取消写回 pinnedTop（逗号分隔字符串），并立即重渲染顶栏 */
(function () {
  document.addEventListener('click', function (e) {
    const b = e.target.closest('[data-pin-toggle]');
    if (!b) return;
    const id = b.getAttribute('data-pin-toggle');
    let cur = '';
    try { cur = String(BF.settings.get('pinnedTop') || ''); } catch (err) {}
    const ids = cur.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
    const i = ids.indexOf(id);
    if (i >= 0) ids.splice(i, 1); else ids.push(id);
    try { BF.settings.set('pinnedTop', ids.join(',')); } catch (err) {}
    const on = i < 0;
    b.setAttribute('aria-pressed', String(on));
    try { BF.uiMenu.renderPins(); } catch (err) {}
  });
})();
BF.settingsUI.register('parse', 3, function () {
  return '<div class="settings-section" style="margin-bottom:16px"><h4 style="font-size:14px;margin-bottom:8px;color:var(--text)">解析</h4>' +
    BF.settingsUI._row('分章策略', BF.settingsUI._sel('chapterStrategy', [['smart', '自动分章'], ['regex', '正则自定义'], ['wordcount', '按字数'], ['none', '不分章']])) +
    /* 选项由候选表派生：手写一份就会与解码器名单漂移（列出来的编码解不出来 = 假承诺） */
    BF.settingsUI._row('默认编码', BF.settingsUI._sel('encoding', [['auto', '自动']].concat(BF.library.ENC_CANDIDATES.map(function (c) { return [c.enc, c.enc]; })))) +
    BF.settingsUI._row('按字数分章阈值', '<input type="number" min="1000" max="50000" step="500" value="' + (BF.settings.get('chapterWordCount') || BF.settings.DEFAULTS.chapterWordCount) + '" data-set-num="chapterWordCount" style="flex:1"/>') +
    BF.settingsUI._row('自定义章节正则', '<input type="text" value="' + BF.dom.escAttr(BF.settings.get('chapterRegex') || '') + '" class="input" data-set-text="chapterRegex" style="flex:1" placeholder="留空用内置规则，例：^\\s*卷[一二三]"/>') +
    BF.settingsUI._row('自动识别章标题', BF.settingsUI._sel('autoDetectTitle', [['true', '开启（取首行）'], ['false', '关闭（第 N 章）']])) +
    BF.settingsUI._row('合并目录区块伪章', BF.settingsUI._sel('mergeTocBlock', [['true', '开启（书前小目录不再切成一串假章）'], ['false', '关闭（按章头逐行切）']])) +
    BF.settingsUI._row('拦截乱码书', BF.settingsUI._sel('garbleBlock', [['false', '关闭（照常导入，只给提示）'], ['true', '开启（疑似损坏或非文本拒绝导入）']])) +
    BF.settingsUI._row('乱码提示', BF.settingsUI._sel('garbleWarn', [['true', '开启（导入后提示疑似乱码）'], ['false', '关闭']])) +
    '<div style="font-size:11px;color:var(--text-dim);padding:2px 0 8px">自定义正则用于「正则自定义 / 自动分章」策略；改动不会追溯已导入的书籍。乱码判定：解码替换符 >1% 或控制字符 >2%（含转义序列的文本放宽到 5%），文件与 URL 两条导入通道同一口径。</div>' +
    '<div style="font-size:11px;color:var(--text-dim);padding:0 0 8px">自动分章的默认规则：书里章标记少于 3 处才放弃正则改按字数；「合并目录区块伪章」默认开启（只把小目录那几行并回后一章，正文一个字不动）。按字数分章默认 50000 字（5 万）。这三项都不追溯旧书，改完请对需要的书手动重新分章。</div>' +
    '</div>';
});
BF.settingsUI.register('terminal', 3.5, function () {
  return '<div class="settings-section" style="margin-bottom:16px"><h4 style="font-size:14px;margin-bottom:8px;color:var(--text)">终端</h4>' +
    BF.settingsUI._row('终端语言<br/><span class="taste-note">只影响终端自己说的话：标题、按钮、提示符、状态栏、回执与会话提示；命令自身的输出与 help 手册内容不随它变</span>',
      BF.settingsUI._sel('dslLang', [['en', '英文（默认）'], ['zh', '中文']])) +
    BF.settingsUI._row('会话语言（chat / Agent）<br/><span class="taste-note">只切 chat 与 Agent 会话的壳话术：提示符、开/关会话、运行中、中止/超时回执；终端其余外壳跟「终端语言」走，AI 回答内容的语言不归此档</span>',
      BF.settingsUI._sel('aiConvLang', [['en', '英文（默认）'], ['zh', '中文']])) +
    '</div>';
});
BF.settingsUI.register('tts', 4, function () {
  const S = BF.settingsUI;
  /* 「这一档用得到哪几行」由能力表给，面板不再按引擎名画行：
     自动档 = 阶梯上每一档都可能出声，每一档的行都画；
     显式档只画点名的那一档——选了 MiMo 还看见 Edge 的 Token 与音色，
     是因为原来把所有档的行抄进了同一个「凭据与音色」分组。 */
  const shown = BF.tts.configurableEngines();
  const hidden = BF.tts.hiddenConfigEngines();
  const anyOnline = shown.some(function (e) { const c = BF.tts.cap(e); return !!(c && c.network); });
  const _f = BF.tts.forcedEngine();
  const policyLabel = _f ? ((BF.tts.cap(_f) || {}).label || _f) : '自动';
  return '<div class="settings-section" style="margin-bottom:16px"><h4 style="font-size:14px;margin-bottom:8px;color:var(--text)">语音</h4>' +
    S._sub('引擎与策略',
      S._row('引擎策略', S._sel('ttsEngine', [['auto', '自动'], ['online', 'Edge 在线'], ['mimo', 'MiMo 在线'], ['offline', '浏览器语音']])) +
      S._row('允许在线引擎', S._sel('ttsAutoOnline', [['true', '开启'], ['false', '关闭']])) +
      S._row('在线不可用时用浏览器语音', S._sel('ttsAutoOffline', [['true', '开启'], ['false', '关闭']])) +
      S._row('多音字纠正', '<span class="pane-hint" data-pron-count></span> <button class="btn btn-xs" data-pron-add>加一条</button> <button class="btn btn-xs" data-pron-clear>清空</button>')
    ) +
    '<div class="pane-hint">有的字词念错音：给它一段同音字替读（例：单于读错就填「单=蝉」），纠正只影响朗读，不改正文。</div>' +
    /* 引擎专属组走可折叠 cgroup：标题可点，默认收起，只显示当前引擎所在那一组；
       其它组既被 data-tts-engine 隐藏也默认折叠，双保险，保证面板干净。 */
    shown.map(function (e) {
      const c = BF.tts.cap(e);
      const isCur = _f ? (_f === e) : (e === 'offline');   /* auto 时默认展开离线那一组（最常用） */
      return S._ttsCgroup(c.cfgTitle, c.cfgRows(), { group: e, note: '选这一档时显示', open: isCur });
    }).join('') +
    (hidden.length
      ? '<div class="pane-hint">' + hidden.map(function (e) { return BF.tts.cap(e).cfgTitle; }).join('、') +
        ' 的行现在用不到，已收起（策略：' + policyLabel + '）。' +
        hidden.map(function (e) { return '<button class="btn btn-xs" data-tts-show-cfg="' + e + '">切到' + BF.tts.cap(e).label + '</button>'; }).join(' ') +
        ' <button class="btn btn-xs" data-tts-show-cfg="auto">改为自动</button></div>'
      : '') +
    S._sub('朗读节奏',
      BF.settingsUI._row('语速', BF.settingsUI._sel('ttsRate', [['0.7', '0.7x'], ['0.85', '0.85x'], ['1.0', '1.0x'], ['1.2', '1.2x'], ['1.5', '1.5x'], ['2.0', '2.0x']])) +
      BF.settingsUI._row('音调', '<input type="range" min="0.5" max="2" step="0.1" value="' + (BF.settings.get('ttsPitch') || 1) + '" data-set-step="ttsPitch" style="flex:1"/>') +
      S._row('音量（对 MiMo 不生效）', '<input type="range" min="0" max="1" step="0.05" value="' + (BF.settings.get('ttsVolume') || 0.9) + '" data-set-step="ttsVolume" style="flex:1"/>') +
      S._row('自动下一章', S._sel('ttsAutoNext', [['true', '开启'], ['false', '关闭']])) +
      S._row('睡眠定时', S._sel('ttsSleepMin', BF.CONFIG.TTS_SLEEP_STEPS.map(function (m) { return [String(m), m ? m + ' 分钟' : '关闭']; }))) +
      S._row('分段粒度', S._sel('ttsSegment', [['sentence', '按句子'], ['paragraph', '按段落'], ['wordcount', '按字数']])) +
      /* 逐词高亮：默认 true，逻辑侧早已读此键。
         设置页必须有这个开关（与 DEFAULTS 默认对齐），否则用户以为能关却关不掉。
         「按服务端时间轴高亮」不在这里：那是 Edge 一档的能力，跟着它的分组走。 */
      S._row('逐词高亮', S._sel('ttsWordHighlight', [['true', '开启（默认）'], ['false', '关闭（不标当前朗读词）']])) +
      S._row('朗读时滚屏', S._sel('ttsAutoScroll', [['true', '开启'], ['false', '关闭']])) +
      S._row('单击段落朗读', S._sel('ttsTap', [['true', '开启'], ['false', '关闭']])) +
      /* 窄屏朗读栏读数：默认保留（空间不够时压缩截断），选「收起」才在 ≤420px 隐藏。
         默认不藏是功能优先——收起后用户就看不到已播时间与倍速了。 */
      S._row('窄屏读数', S._sel('ttsCompactNarrow', [['false', '保留（默认 · 空间不足时压缩）'], ['true', '收起（窄屏隐藏已播时间与倍速）']])) +
      S._row('停止时隐藏面板', S._sel('ttsHideOnStop', [['true', '开启'], ['false', '关闭']]))
    ) +
    /* 缓存与体检只对「这一屏里还有联网档」有意义：策略=浏览器语音时
       既没有音频可缓存，也没有线路可探，画出来只是三行没人按的按钮。 */
    (anyOnline ? S._sub('缓存与体检',
      BF.settingsUI._row('在线音频缓存', BF.settingsUI._sel('ttsCache', [['false', '关闭'], ['true', '开启（上限 64MB）']])) +
      '<div class="pane-hint">开启后把合成好的音频与逐词边界留在本机（上限 64MB，超出按最久未用淘汰），回听与重读零请求、命中缓存的句子照样逐词跟随；重分章或换切句方式后，那一节用不到的旧条目会顺手压掉。删除书籍或在「清空临时数据」里会一并清掉。隐私模式下不读不写。</div>' +
      BF.settingsUI._row('通道状态', '<span class="pane-hint" data-tts-health-text>' + (function () { try { const s = BF.tts.health.status(); return s.code ? s.text : '未检测'; } catch (e) { return '未检测'; } })() + '</span> ' +
        '<button class="btn btn-xs" data-tts-health-probe>测一次</button> ' +
        '<button class="btn btn-xs" data-tts-health-copy>复制诊断</button>') +
      '<div class="pane-hint">体检只在真用过在线语音之后自动做一次：不发出声音、不播任何音频，只发一个字试探线路，十分钟内最多一次。想立刻查就点「测一次」。结果只影响「在线语音能不能用」的判断与提示。</div>'
    ) : '') +
    S._sub('测试',
      '<div class="tts-test-bar"><button class="btn btn-sm" data-tts-preview>试听（只测单次连接，不走重试与降级）</button>' +
      /* 联网探测改成手动按钮：打开这一屏不再自动向微软发请求、
         也不再拿用户的 MiMo 密钥白打一次合成（配额与「未经同意的出门」都省掉）。
         策略=浏览器语音时这一枚不画：没有联网档可探。 */
      (anyOnline ? '<button class="btn btn-sm" data-tts-probe>测一次连接（会真实请求）</button>' : '') +
      '<span class="tts-probe-state" id="tts-probe-state">' + BF.dom.esc(BF.tts.stab.lampText()) + '</span></div>'
    ) +
    '</div>';
});
/* AI 预设快照白名单：只捕配置键，不含密钥（aiApiKey 由「含密钥」开关单独决定）。
   与 DEFAULTS / KEPT_KEYS 同源，改这里即改预设能存哪些项。 */
BF.settingsUI.AI_PRESET_KEYS = ['aiProvider', 'aiEndpoint', 'aiModel', 'aiTransport', 'aiProxyBase', 'aiModelMode',
  'aiSummaryLevel', 'aiAskTurns', 'aiContextSegs', 'aiRefBook', 'aiAgent', 'aiPromptMode', 'aiSearchPar',
  'aiConcurrency', 'aiRetries', 'aiAutoDegrade', 'aiImportEnhance', 'aiAutoSplit', 'aiAutoTag',
  'readGoal', 'goalIncludeFocus'];
