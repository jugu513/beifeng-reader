/* ================= 场景预设 ================= */
BF.SCENES = {
  '沉浸阅读': { appearance: 'dark', fontFamily: 'serif', fontSize: 18, lineHeight: 2.2, paraSpacing: 1.2, wordSpacing: 0.5, readerMargin: 'normal', warmth: 'off' },
  '深夜护眼': { appearance: 'black', fontFamily: 'serif', fontSize: 17, lineHeight: 2.0, paraSpacing: 1, wordSpacing: 0, readerMargin: 'normal' },
  '纸感浅色': { appearance: 'light', fontFamily: 'serif', fontSize: 17, lineHeight: 1.9, paraSpacing: 1, wordSpacing: 0, readerMargin: 'normal', readerFilter: 'paper', warmth: 'warm' },
  '紧凑速读': { appearance: 'dark', fontFamily: 'sans', fontSize: 15, lineHeight: 1.6, paraSpacing: 0.6, wordSpacing: 0, readerMargin: 'narrow', warmth: 'off' },
};
BF.scene = {
  apply(name) {
    const p = BF.SCENES[name];
    if (!p) return;
    /* 切场景前先重置本场景管理的全部键为默认值，避免旧场景残留
       （如「纸感浅色」的 readerFilter=paper 切到「沉浸阅读」后仍生效）。
       场景只管理外观键；密钥/数据键不动。 */
    const _SCENE_KEYS = ['appearance', 'fontFamily', 'fontSize', 'lineHeight', 'paraSpacing', 'wordSpacing', 'readerMargin', 'warmth', 'readerFilter'];
    const _d = BF.settings.DEFAULTS || {};
    /* 批量写走 settings.patch：一次改一组外观键——
       标脏 + 一次防抖落盘 + 一次 SETTINGS 广播，
       替代逐条 set 的多次防抖与多次广播。 */
    const _batch = {};
    for (const k of _SCENE_KEYS) {
      if (p[k] === undefined && _d[k] !== undefined) _batch[k] = _d[k];
    }
    for (const k in p) _batch[k] = p[k];
    BF.settings.patch(_batch);
    BF.theme.apply();
    if (BF.appState.currentPage === 'reader') { try { BF.reader.applyStyles(); } catch (e) {} }
    BF.noti.success('已应用场景：' + name);
  },
  html() {
    return '<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">' +
      Object.keys(BF.SCENES).map(function (n) {
        return '<button class="btn btn-xs" data-scene="' + BF.dom.escAttr(n) + '">' + BF.dom.esc(n) + '</button>';
      }).join('') + '</div>';
  },
};
