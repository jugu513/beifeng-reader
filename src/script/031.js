/* ============== 实验色板：夜航 ==============
   纯加成、零风险：令牌不改任何现有键名，只新增一组键值，挂在色板轴上，
   可与明暗 / 材质 / 实验界面自由组合。
   色值由对比度反推（见感觉移植方案附录 A），--accent 必须写在本套令牌里，
   否则色板注入「同元素内联后写者胜」会把强调色顶回夜墨的朱砂。
   标「· 新」提示用户这是实验档，避免「新主题不好用」被当成「产品变差了」。 */
BF.YEHANG_TOKENS = {
  /* 夜航 · 仪表感：OLED 黑 + 单一冷光，轻字重观感靠冷白与低对比边界 */
  '--bg': '#08090b', '--bg-panel': '#101114', '--bg-input': '#171a1e',
  '--text': '#e8eaee', '--text-dim': '#9aa1ab', '--text-weak': '#7f868f',
  '--border': 'rgba(255,255,255,.09)', '--border-strong': '#636b76',
  '--bg-hover': '#1d2126', '--text-ink': 'var(--text)',
  '--bg-reader': '#0a0b0d', '--reader-tint': '#121418',
  '--success': '#6fbf8f', '--success-ink': 'var(--success)', '--success-bg': 'rgba(111,191,143,.12)',
  '--warning': '#d8a44a', '--warning-ink': 'var(--warning)', '--warning-bg': 'rgba(216,164,74,.12)',
  '--danger': '#e06a5a', '--danger-ink': 'var(--danger)', '--danger-bg': 'rgba(224,106,90,.12)',
  '--info': '#7fb2ff', '--info-bg': 'rgba(127,178,255,.12)',
  '--brand-fg': '#08090b',
  '--shadow-sm': '0 1px 2px rgba(0,0,0,.55)',
  '--shadow-md': '0 6px 18px rgba(0,0,0,.60)',
  '--shadow-lg': '0 18px 48px rgba(0,0,0,.70)',
  '--accent': '#7fb2ff', '--accent-ink': '#7fb2ff', '--accent-soft': 'rgba(127,178,255,.14)',
};
BF.SKIN_TOKENS = { songyan: BF.SONGYAN_TOKENS, yan: BF.YAN_TOKENS, yehang: BF.YEHANG_TOKENS };
BF.skin = {
  /* 外观单入口（theme ∪ skin 合并后的读取面）。合法性读登记表，不在这里再列名字：
     未知值一律退回「深色 · 夜墨」。色板（SKIN_TOKENS 有账的）注入内联令牌；
     明暗档不注入，由 body 作用域供给。 */
  get() { const k = BF.settings.get('appearance'); return BF.SKIN_AXIS[k] ? k : 'dark'; },
  isPalette(k) { return !!BF.SKIN_TOKENS[k || '']; },
  axis() { const a = BF.SKIN_AXIS[BF.skin.get()]; if (a !== 'theme') return a;
    try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; } catch (e) { return 'dark'; } },
  isFixedLight() { return BF.skin.axis() === 'light' && BF.skin.isPalette(BF.skin.get()); },
  isFixedDark() { return BF.skin.axis() === 'dark' && BF.skin.isPalette(BF.skin.get()); },
  label(k) { return BF.SKIN_LABELS[k] || k; },
  /* 设置项枚举：完整设置面板与命令、快捷键循环共用同一份，不再各抄一遍名字 */
  opts() { return BF.SKIN_OPTS; },
  /* 界面显示的是中文名（label），登记表键是 ASCII：两者都要认。
     副标题现在整列为空（各档都不要副名），所以空串必须当「没认出来」，
     否则 `(SUBS[k] || '') === ''` 会命中第一档，id('') 就成了静默改外观。
     反查仍由同一张登记表算出来，不另立名字表。 */
  id(name) {
    const s = String(name == null ? '' : name).trim();
    if (!s) return null;
    if (BF.SKIN_AXIS[s]) return s;
    const hit = (BF.SKINS || []).find(function (k) { return (BF.SKIN_LABELS[k] || k) === s || (BF.SKIN_SUBS[k] || '') === s; });
    return hit || null;
  },
  /* 显式指定外观档：合法性由登记表裁决，非法返回 false 不静默写入。 */
  set(name) {
    const id = BF.skin.id(name);
    if (!id) return false;
    BF.settings.set('appearance', id);
    try { if (BF.theme && BF.theme.applyAnimated) BF.theme.applyAnimated(); else if (BF.theme) BF.theme.apply(); } catch (e) {}
    return true;
  },
  /* 快捷键循环走 BF.SKINS 全表顺序，回到表首 */
  cycle() {
    const cur = BF.skin.get();
    const i = BF.SKINS.indexOf(cur);
    const next = BF.SKINS[(i + 1) % BF.SKINS.length];
    BF.settings.set('appearance', next);
    try { if (BF.settings.get('autoTheme')) BF.settings.set('autoTheme', false); } catch (e) {}
    try { BF.theme.applyAnimated(); } catch (e) { BF.theme.apply(); }
    return next;
  },
  apply() {
    const b = document.body;
    if (!b || !b.style || !b.style.setProperty) return;
    const skin = BF.skin.get();
    try { b.setAttribute('data-skin', skin); } catch (e) {}
    /* 先把登记表里全部色板用到的键清掉，再注入当前这一套 ——
       换色板必有残留（深轴切浅轴时漏一个 --bg 就是白屏），所以清的是并集不是旧值；
       明暗档不注入，键交还给 body 作用域 */
    const map = BF.SKIN_TOKENS[skin] || null;
    /* 色板键并集首用一次算好：避免每次 apply 都遍历四套色板重建 seen；
       仍从登记表推导，不抄名字。 */
    if (!BF.SKIN_UNION_KEYS) {
      const seen = {};
      Object.keys(BF.SKIN_TOKENS).forEach(function (s) {
        Object.keys(BF.SKIN_TOKENS[s]).forEach(function (k) { seen[k] = 1; });
      });
      BF.SKIN_UNION_KEYS = Object.keys(seen);
    }
    BF.SKIN_UNION_KEYS.forEach(function (k) {
      if (map && map[k] !== undefined) b.style.setProperty(k, map[k]);
      else b.style.removeProperty(k);
    });
  },
};

