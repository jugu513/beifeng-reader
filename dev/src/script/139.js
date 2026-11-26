/* ================= 快捷键自定义（重绑热键，存 hk_custom） ================= */
BF.settingsUI.register('hotkeys', 8, function () {
  const hk = BF.hotkeys.list().filter(function (h) {
    return BF.hotkeys.LABELS[h.id] && !/\.mac$/.test(h.id);
  });
  if (!hk.length) return '';
  return '<div class="settings-section" style="margin-bottom:16px"><h4 style="font-size:14px;margin-bottom:8px;color:var(--text)">快捷键自定义</h4>' +
    '<div style="font-size:12px;color:var(--text-weak)">' +
    hk.map(function (h) {
      /* 冲突可视化：若本项键位同时被另一功能占用，标黄提示（仍可重绑覆盖，但让用户知情） */
      const dup = BF.hotkeys.findConflict ? BF.hotkeys.findConflict(h.id, h.combo) : null;
      return '<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border)">' +
        '<span style="color:var(--text)">' + BF.dom.esc(BF.hotkeys.LABELS[h.id]) +
          (dup ? ' <span style="font-size:10px;color:var(--warning-ink)">（与「' + BF.dom.esc(BF.hotkeys.LABELS[dup] || dup) + '」撞键）</span>' : '') + '</span>' +
        '<button class="btn btn-xs" data-rebind="' + BF.dom.escAttr(h.id) + '"' + (dup ? ' style="border-color:var(--warning-ink)"' : '') + '>' + BF.dom.esc(h.combo === 'none' ? '已禁用' : ((h.combo || '').toUpperCase())) + '</button>' +
        '</div>';
    }).join('') +
    '<p style="margin-top:8px;line-height:1.6">点击按钮后按下新组合键即可重新绑定；按 Esc 取消；按 Delete 或 Backspace 禁用该快捷键。自定义仅对当前项生效，不影响同功能在 macOS 上的 ⌘ 组合。</p>' +
    '</div></div>';
});
