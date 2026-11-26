/* ================= R4. 排版应用 ================= */
/* 微信读书 WR 配色表（微读专属）：bg=阅读区底色 / fg=正文色 / ink=标题色。
   只在微读态由 applyStyles 消费，不进全站主题体系，避免与刚砍定的主题档重叠。 */
BF.MR_THEMES = {
  'wr-white': { bg: '#ffffff', fg: '#262626', ink: '#1a1a1a', name: '暖白' },
  'wr-sepia': { bg: '#f7f1e3', fg: '#3a3022', ink: '#2a2016', name: '羊皮纸' },
  'wr-green': { bg: '#e8f1e6', fg: '#22362a', ink: '#16271d', name: '护眼绿' },
  'wr-night': { bg: '#232323', fg: '#d4d4d6', ink: '#f0f0f2', name: '夜间' },
  'wr-mono':  { bg: '#f5f5f5', fg: '#1a1a1a', ink: '#000000', name: '黑白' }
};
BF.reader.applyStyles = function () {
  const e = document.getElementById('reader-main');
  if (!e) return;
  const s = BF.settings;
  /* 阶段4：字号随书（perBook 覆盖优先，无覆盖回退全局） */
  const fs = Number(BF.prefs.resolve(BF.appState.currentBookId, 'fontSize', s.get('fontSize'))) || 16;
  const lh = BF.settings.num('lineHeight', 1.9);
  const ws = BF.settings.num('wordSpacing', 0);
  const ps = BF.settings.num('paraSpacing', 1);
  e.style.fontSize = fs + 'px';
  e.style.lineHeight = lh;
  e.style.letterSpacing = ws + 'px';
  /* 段落样式走 CSS 变量（.reader-main p 规则消费）：大章节排版切换不再逐段内联设置。
     变量挂在 #reader-main 而不是 html：这两个是阅读器专属排版令牌，
     落在全局根上会在切回书架后继续残留，与「令牌只住自己的作用域」冲突。 */
  e.style.setProperty('--rd-pmb', ps + 'em');
  e.style.setProperty('--rd-indent', s.get('noIndent') ? '0' : '2em');
  e.style.textAlign = s.get('justify') ? 'justify' : '';
  e.style.fontFamily = s.get('fontFamily') === 'serif' ? 'var(--serif)' : s.get('fontFamily') === 'kai' ? 'var(--kai)' : 'var(--sans)';
  const w = document.getElementById('reader-wrap');
  if (w) w.style.padding = '0 ' + ({ narrow: '12px', normal: '24px', wide: '44px' }[s.get('readerMargin')] || '24px');
  const b = Number(s.get('brightness')) || 100;
  if (w) w.style.filter = b !== 100 ? 'brightness(' + (b / 100) + ')' : '';
  /* 暖光与滤镜分层：filter 控制背景纯色，warmth 用 backgroundImage 叠加，互不覆盖（修复色温与滤镜互相覆盖） */
  if (w) {
    w.style.background = '';
    w.style.backgroundImage = '';
    const filter = s.get('readerFilter') || 'none';
    if (filter === 'sepia') w.style.background = '#f4ecd8';
    else if (filter === 'night') w.style.background = '#0a0a0c';
    else if (filter === 'paper') w.style.background = '#f7f5f1';
    else if (filter === 'clean-white') w.style.background = '#ffffff';
    else if (filter === 'clean-black') w.style.background = '#121212';
    const warmth = s.get('warmth') || 'off';
    if (warmth !== 'off') {
      const ti = warmth === 'dusk' ? 'rgba(255,176,90,0.10)' : warmth === 'warm' ? 'rgba(255,190,110,0.08)' : 'rgba(255,220,150,0.06)';
      w.style.backgroundImage = 'linear-gradient(' + ti + ',' + ti + ')';
    }
  }
  /* 底色档写进 data-rf，正文配色由 CSS 按档跟上（见「底色档各自配一套正文色」） */
  const _pg = document.getElementById('page-reader');
  if (_pg) {
    /* 微读专属增强：WR 配色 + 整体缩放，仅微读态消费，不改经典模式一行。 */
    if (_pg.classList.contains('microread')) {
      const th = BF.MR_THEMES[s.get('mrTheme')] || BF.MR_THEMES['wr-white'];
      _pg.dataset.rf = 'none';           /* 绕开经典底色档的 p 配色，让正文继承 WR 前景色 */
      if (w) { w.style.background = th.bg; w.style.backgroundImage = ''; }
      e.style.color = th.fg;
      e.style.setProperty('--mr-ink', th.ink);
      e.style.setProperty('--mr-zoom', String((Number(s.get('mrZoom')) || 100) / 100));
    } else {
      _pg.dataset.rf = (s.get('readerFilter') || 'none');
      e.style.color = '';
      e.style.removeProperty('--mr-zoom');
      e.style.removeProperty('--mr-ink');
    }
  }
};

