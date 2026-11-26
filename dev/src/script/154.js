/* ================= 阅读器缩放（字号步进唯一实现） =================
   钳位与设置滑块 12-32 同界；delta===0 = 复位到 DEFAULTS 默认字号。
   v4 层不得另写一份 13-26/默认17 的钳位副本 —— 同一个「Ctrl+=」只有一套边界。 */
BF.enh.zoomBy = function (delta) {
  if (BF.appState.currentPage !== 'reader') {
    BF.noti.info('字号调节仅在阅读页生效');
    return;
  }
  const DEF = (BF.settings.DEFAULTS && BF.settings.DEFAULTS.fontSize) || 17;
  const cur = BF.settings.get('fontSize') || DEF;
  const next = delta === 0 ? DEF : Math.max(12, Math.min(32, cur + delta));
  if (next === cur && delta !== 0) return;
  BF.settings.set('fontSize', next);
  BF.reader.applyStyles();
  BF.noti.info('字号 ' + next + 'px');
};

