/* ================= 13.5c 我的 Tab 渲染 ================= */
BF.mineTab = (function () {
  const $ = id => document.getElementById(id);
  function _cnt(key) {
    try { return (BF.store.lsGetArray(key, []) || []).length; } catch (e) { return 0; }
  }
  function _bind() {
    const body = $('mine-body');
    if (!body || body.__bound) return;
    body.__bound = true;
    body.addEventListener('click', function (e) {
      const it = e.target && e.target.closest ? e.target.closest('[data-cmd],[data-open-settings]') : null;
      if (!it) return;
      if (it.hasAttribute('data-open-settings')) {
        try { BF.commands.run && BF.commands.run('settings.open'); } catch (ex) {}
        return;
      }
      const id = it.getAttribute('data-cmd');
      if (!id) return;
      try { BF.commands.run && BF.commands.run(id); } catch (ex) { BF.err && BF.err.report('mineTab.cmd', ex); }
    });
  }
  function render() {
    const el = $('mine-stat');
    const verEl = $('mine-ver');
    if (el) {
      const books = _cnt(BF.store.K.BOOKS_META);
      const notes = BF.notes && BF.notes.all ? BF.notes.all().length : _cnt(BF.store.K.NOTES);
      /* 今日 / 连续 / 累计一律走 BF.stats。原先这里自己解析 DAILY：那张表存的是
         「每天多少秒」，代码按 {minutes} 对象去读，于是「今日 0 分」恒成立；
         日期键又用 toISOString（UTC），与 BF.stats.todayKey 的本地日差一天，
         连续天数也会算错。同一个数在统计面板和本页各算一份必然打架。 */
      let today = 0, streak = 0, totalH = 0;
      try {
        today = BF.stats.todayDisplay();
        streak = BF.stats.streak();
        totalH = BF.stats.total();
      } catch (e) { BF.err && BF.err.report('mineTab.stats', e); }
      el.textContent = '藏书 ' + books + ' · 便签 ' + notes + ' · 今日 ' + today + ' 分 · 累计 ' + totalH + ' 小时 · 连续 ' + streak + ' 天';
    }
    if (verEl) {
      const v = (typeof VERSION !== 'undefined') ? ('V' + VERSION) : 'V0.0.1-alpha';
      verEl.textContent = '北风 · ' + v;
    }
  }
  return { render: render, bind: _bind };
})();

