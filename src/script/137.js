/* ===== 语音分区的折叠 / 引擎联动（从分支合并，不改动其它分区） =====
   1) 折叠态挂在 DOM 上的 hidden / aria-expanded，点标题即时切换，不重建面板不丢焦点；
   2) 引擎显隐由 #settings 上的 data-tts-engine 驱动，挂 SETTINGS 总线——
      面板里改、面板外改、撤销改都能同步，且不依赖分区是否被缓存复用；
   3) 每次 render 后把折叠态复位（默认只开当前引擎对应的组 + 「引擎与策略」常开）；
   4) 事件委托挂在常驻 document 上，分区重建/缓存复用都不用重绑。 */
(function () {
  function keyOf() {
    var v;
    try { v = BF.settings.get('ttsEngine'); } catch (e) { v = 'auto'; }
    return (v === 'mimo' || v === 'online' || v === 'offline') ? v : 'auto';
  }
  function syncEngine() {
    try {
      var el = document.getElementById('settings');
      if (el) el.setAttribute('data-tts-engine', keyOf());
    } catch (e) {}
  }
  BF.settingsUI._resetTtsGroups = function () {
    var b = document.getElementById('settings-body');
    if (!b || !b.querySelectorAll) return;
    b.querySelectorAll('.tts-cgroup').forEach(function (g) {
      var head = g.querySelector('.tts-cgroup__head');
      var body = g.querySelector('.tts-cgroup__body');
      if (!head || !body) return;
      var open = g.hasAttribute('data-tts-default-open');
      head.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) body.removeAttribute('hidden'); else body.setAttribute('hidden', '');
    });
  };
  document.addEventListener('click', function (e) {
    var head = e.target && e.target.closest && e.target.closest('.tts-cgroup__head');
    if (!head) return;
    var body = head.nextElementSibling;
    if (!body || !body.classList.contains('tts-cgroup__body')) return;
    var open = head.getAttribute('aria-expanded') === 'true';
    head.setAttribute('aria-expanded', open ? 'false' : 'true');
    if (open) body.setAttribute('hidden', ''); else body.removeAttribute('hidden');
  });
  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var head = e.target && e.target.closest && e.target.closest('.tts-cgroup__head');
    if (!head) return;
    e.preventDefault();
    head.click();
  });
  /* 搜索期间放行全部分组：命中项可能落在折起的组里，得让它露出来。 */
  function bindSearch() {
    var si = document.getElementById('settings-search');
    if (!si || si._ttsBound) return;
    si._ttsBound = true;
    si.addEventListener('input', function () {
      var b = document.getElementById('settings-body');
      if (b) b.classList.toggle('set-searching', !!(si.value || '').trim());
    });
  }
  /* 引擎值同步 + 每次渲染后折叠复位 + 搜索框绑定。
     包装 render 而不改它内部逻辑，覆盖概览下钻 / 平铺 / 全量 / 撤销重画全部入口。 */
  try { if (BF.bus && BF.bus.on) BF.bus.on(BF.EVENTS.SETTINGS, syncEngine); } catch (e) {}
  syncEngine();
  var _origRender = BF.settingsUI.render;
  BF.settingsUI.render = function () {
    var _q = document.getElementById('settings-search');
    var _hadQuery = !!(_q && (_q.value || '').trim());
    var r = _origRender.apply(this, arguments);
    try {
      bindSearch();
      syncEngine();
      BF.settingsUI._resetTtsGroups();
      var _b = document.getElementById('settings-body');
      if (_b) _b.classList.toggle('set-searching', _hadQuery);
    } catch (e) {}
    return r;
  };
})();
