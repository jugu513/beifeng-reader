/* ================= 工具面板委托 ================= */
(function () {
  document.addEventListener('click', function (e) {
    const t = e.target;
    if (t.closest('[data-focus-toggle]')) { BF.focus.toggle(); BF.focus._render(); return; }
    if (t.closest('[data-focus-reset]')) { BF.focus.reset(); return; }
    if (t.closest('[data-focus-mode]')) {
      BF.focus.mode(parseInt(t.closest('[data-focus-mode]').dataset.focusMode, 10));
      BF.focus._render();
      return;
    }
    if (t.closest('[data-noise]')) {
      const id = t.closest('[data-noise]').dataset.noise;
      const active = BF.noise.toggle(id);
      t.closest('[data-noise]').setAttribute('aria-pressed', active ? 'true' : 'false');
      return;
    }
    if (t.closest('[data-noise-vol]')) {
      BF.noise.setVolume(parseFloat(t.closest('[data-noise-vol]').value));
      return;
    }
    if (t.closest('[data-noti-clear]')) { BF.noti.clearHistory(); BF.notiCenter.render(); return; }
    /* 统计面板热力窗口切换 + CSV 导出 */
    if (t.closest('[data-stat-range]')) {
      const b = t.closest('[data-stat-range]');
      if (BF.statsPanel && BF.statsPanel.setRange) BF.statsPanel.setRange(parseInt(b.getAttribute('data-stat-range'), 10));
      return;
    }
    if (t.closest('[data-stat-csv]')) { if (BF.statsPanel && BF.statsPanel.exportCsv) BF.statsPanel.exportCsv(); return; }
  });
})();

