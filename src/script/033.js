/* ============== 黑白简约模式（实验 · bwMode）灰度令牌 ==============
   一套纯中性灰（零色相，取浅轴纸灰，不随明暗档切深轴），键集 ⊆ SKIN 并集 ∪ {accent, accent-ink}：
   注入在 theme.apply 末尾（skin.apply 与强调色之后，同元素内联后写者胜），
   关闭时并集键由 skin.apply 统一清理、accent 对由强调色块回写，零残留。
   对比度按最严底面复核：正文/弱化 ≥4.5:1、控件边界 ≥3:1。 */
BF.BW_LIGHT_TOKENS = {
  '--bg': '#ffffff', '--bg-panel': '#ffffff', '--bg-input': '#f5f5f5',
  '--text': '#1a1a1a', '--text-dim': '#555555', '--text-weak': '#999999',
  '--border': '#e0e0e0', '--border-strong': '#cccccc',
  '--bg-hover': '#f0f0f0', '--text-ink': 'var(--text)',
  '--bg-reader': '#ffffff', '--reader-tint': '#fafafa',
  '--success': '#333333', '--success-ink': 'var(--success)', '--success-bg': 'rgba(0,0,0,.04)',
  '--warning': '#666666', '--warning-ink': 'var(--warning)', '--warning-bg': 'rgba(0,0,0,.04)',
  '--danger': '#1a1a1a', '--danger-ink': 'var(--danger)', '--danger-bg': 'rgba(0,0,0,.06)',
  '--info': '#666666', '--info-bg': 'rgba(0,0,0,.03)',
  '--brand-fg': '#ffffff',
  '--accent': '#1a1a1a', '--accent-ink': '#1a1a1a',
  '--shadow-sm': '0 1px 3px rgba(0,0,0,.08)',
  '--shadow-md': '0 4px 16px rgba(0,0,0,.10)',
  '--shadow-lg': '0 12px 40px rgba(0,0,0,.14)',
};
BF.theme = {
  /* 生效轴 = 'light' | 'dark'：色板取登记表的钉死轴；明暗档取自身；
     system 按系统偏好现解；夜间自动只在明暗档之间接管时段（19:00–06:00 深色）。 */
  effective() {
    const ap = BF.skin.get();
    if (BF.settings.get('autoTheme') && (ap === 'light' || ap === 'dark')) {
      const h = new Date().getHours();
      return (h >= 19 || h < 6) ? 'dark' : 'light';
    }
    return BF.skin.axis();
  },
  apply() {
    const ap = BF.skin.get();
    const t = BF.theme.effective();   // 'light' | 'dark'
    document.body.classList.toggle('light', t === 'light');
    document.body.classList.toggle('oled', ap === 'black');
    document.body.classList.remove('dark');
    /* 原生控件（滚动条、range 轨道、表单内核配色）跟的是**根元素**的 color-scheme，
       不跟 body：只切 body.light 时，浅色主题下仍会画一条深色滚动条。
       这里写内联值，与 CSS 的 :root 默认值不冲突（内联优先）。 */
    try { document.documentElement.style.colorScheme = (t === 'light') ? 'light' : 'dark'; } catch (e) {}
    /* 「减少动效」必须在 body 上落 class（转场判断之外），否则 CSS 层的降级规则无从生效。*/
    document.body.classList.toggle('reduce-motion', !!BF.settings.get('reduceMotion'));
    /* 界面风格走材质轴 data-material：apple=全站材质；mixed=外壳用苹果、阅读页保持原生。
       明暗与色板是另一根轴（body class + data-skin，见 BF.skin.apply）——
       两根轴必须各写各的属性：写进同一个属性时后写者覆盖前写者，
       苹果皮会被色板档名整个抹掉，上百条规则一条也不命中。
       bw/qj 两套界面方案走各自的 body class，不在这一档里。 */
    const _mat = BF.settings.get('skinStyle');
    document.body.classList.toggle('mat-mixed', _mat === 'mixed');
    if (_mat === 'apple' || _mat === 'mixed') document.body.setAttribute('data-material', 'apple');
    else document.body.removeAttribute('data-material');
    /* 流体界面（实验 · appleFluid）：开启时把当前界面套上 Apple 材质（即「当前界面的
       Apple 化副本」，data-material=apple），再叠加 body.fluid-ui 流体交互优化层；
       关闭后由上方材质块原样还原。仅当材质轴没自己选 apple 时才补设，避免覆盖用户选择。 */
    /* S3 合并：流体交互并入 Apple 材质轴——选 Apple/mixed 风格即自带流体层，
       appleFluid 退为兼容别名（DSL/旧存档写它仍生效），不再单独露出设置入口。 */
    const _fluid = !!BF.settings.get('appleFluid') || _mat === 'apple' || _mat === 'mixed';
    document.body.classList.toggle('fluid-ui', _fluid);
    if (_fluid && !document.body.getAttribute('data-material')) document.body.setAttribute('data-material', 'apple');
    /* 令牌层落在 class 之后：模式令牌以 body 内联属性覆盖主题作用域（见 13.6） */
    if (BF.skin && BF.skin.apply) BF.skin.apply();
    if (BF.amb && BF.amb.apply) BF.amb.apply();
    /* 视图类开关统一在这里落 class，CSS 消费：hideScrollbar / simpleMode /
       showScrollbarReadingOnly 三项必须在此绑定 class，否则 UI 上改了毫无反应 */
    document.body.classList.toggle('no-sb', !!BF.settings.get('hideScrollbar'));
    document.body.classList.toggle('simple', !!BF.settings.get('simpleMode'));
    document.body.classList.toggle('sb-reading-only', !!BF.settings.get('showScrollbarReadingOnly'));
    /* 窄屏朗读栏是否收起读数：视图开关同一落点，CSS 只在 ≤420px 里消费这个 class */
    document.body.classList.toggle('tts-compact', !!BF.settings.get('ttsCompactNarrow'));
    /* 黑白简约（实验）：结构层样式只认这个类；灰度令牌在下方强调色之后注入 */
    document.body.classList.toggle('bw', !!BF.settings.get('bwMode'));
    /* A 线（实验）：现行主题参数重分配，只认这个类；色值不动，关掉即原样还原 */
    document.body.classList.toggle('a-line', !!BF.settings.get('aLineMode'));
    /* D2：开发者项（工作台入口）默认隐藏，body.devtools 开启时显示 */
    document.body.classList.toggle('devtools', !!BF.settings.get('devTools'));
    /* 界面口味：与上面三个视图开关同一落点，令牌写在 html 上，
       所有口味规则只认 html[data-taste~="id"]，关掉一条即整条退回原样。 */
    if (BF.taste && BF.taste.apply) BF.taste.apply();
    /* 强调色应用：每色三档（夜墨 / 宣纸 / 素·霁冷瓷），无纸鸢档。
       底色与文字/边框色对明度的要求正好相反，单一 --accent 无法同时满足 ——
       浅色档下金色文字会消失。
       这里同时写两档：底色档压暗以承住 --brand-fg 文字，文字档提亮以在浅底上可读。
       四色明度接近、彩度统一（% 上限），换强调色时整屏观感稳定。
       落点必须是 body 内联：body.light 作用域自己也声明 --accent ——
       元素自身声明胜过继承值，写在 html 上浅色档下选择器一直是死的。
       与色板令牌同落点，外观 > 强调色的优先级由机制保证，不依赖书写顺序。 */
    const k = BF.settings.get('accent');
    const isPaletteLight = BF.skin.isFixedLight();   /* 素/霁：色板钉死浅轴，取冷瓷档 */
    const isLight = t === 'light';                  /* 浅色宣纸（含 system/夜间自动解出的浅） */
    const a = ACCENTS[k] || ACCENTS.red;
    document.documentElement.style.removeProperty('--accent');
    document.documentElement.style.removeProperty('--accent-ink');
    document.body.style.setProperty('--accent', isPaletteLight ? a.fillSu : isLight ? a.fillL : a.fill);
    document.body.style.setProperty('--accent-ink', isPaletteLight ? a.inkSu : isLight ? a.inkL : a.ink);
    /* 黑白简约（实验）：灰度令牌最后注入——压过色板（skin.apply）与上方强调色。
       键集 ⊆ SKIN 并集 ∪ accent 对，关闭时由 skin.apply 并集清理 + accent 回写零残留。
       简约风定档：一律取浅轴纸灰（不随明暗档切深轴）。 */
    if (BF.settings.get('bwMode')) {
      const _bw = BF.BW_LIGHT_TOKENS;
      for (const _k in _bw) document.body.style.setProperty(_k, _bw[_k]);
    }
    try { BF.bus.emit(BF.EVENTS.THEME, t); } catch (e) {}
    /* 阅读区样式重绘改由 EVENTS.THEME 事件驱动（reader.core 监听），不再在此硬调用 applyStyles，
       消除「换主题→无监听告警」并避免与 SETTINGS 监听重复刷新 */
  },
  applyAnimated() {
    /* 用户主动切换主题时走 View Transitions 淡入淡出。
       三重守卫，任一不满足即直接 apply()：浏览器不支持 / 设置项「减少动效」开启 /
       系统 prefers-reduced-motion: reduce。启动、夜间自动、系统跟随仍走 apply()，不做动画。*/
    let _vt = null;
    try { if (document && document.startViewTransition) _vt = document.startViewTransition; } catch (e) { _vt = null; }
    if (!_vt) { BF.theme.apply(); return; }
    try {
      if (matchMedia('(prefers-reduced-motion: reduce)').matches) { BF.theme.apply(); return; }
    } catch (e) {}
    if (BF.settings.get('reduceMotion')) { BF.theme.apply(); return; }
    try {
      const _t = _vt.call(document, function () { BF.theme.apply(); });
      /* 被下一次切换打断时，Chrome 拒的是 ready 而不是 finished —— 只 catch finished
         会把「Transition was skipped」留在未处理拒绝里（连点换肤必现）。
         打断是正常结果不是故障：AbortError/skipped 静默，其余才记一笔。 */
      if (_t) {
        ['ready', 'finished'].forEach(function (k) {
          try {
            if (_t[k] && _t[k].catch) {
              _t[k].catch(function (e) {
                if (e && e.name === 'AbortError' && /skipped/i.test(String(e.message))) return;
                BF.log.warn('主题切换过渡失败（已回退直切）：' + (e && e.message));
              });
            }
          } catch (e) {}
        });
      }
    } catch (e) {
      BF.log.warn('主题切换过渡不可用，已直切：' + (e && e.message));
      BF.theme.apply();
    }
  },
  cycle() {
    /* 手动切换即关闭夜间自动（显式操作优先），文案与实际显示一致。
       循环走 BF.SKINS 全登记表（顺序以登记表为准），
       关灯与 applyAnimated 都统一在 BF.skin.cycle 内完成。 */
    const autoWas = !!BF.settings.get('autoTheme');
    const next = BF.skin.cycle();
    BF.noti && BF.noti.success('外观：' + BF.SKIN_LABELS[next] + (BF.SKIN_SUBS[next] ? ' · ' + BF.SKIN_SUBS[next] : '') + (autoWas ? '（夜间自动已关闭）' : ''));
  },
  /* 指定外观档：值域 = BF.SKINS（明暗档 + 色板），非法值返回 false 而不静默写入。
     区别于 cycle 的循环切换，供脚本/命令按名直达。 */
  set(name) {
    /* 同 cycle —— 手动指定外观档即关闭夜间自动，
       否则指定值被时段规则覆盖、设置不生效 */
    try { if (BF.settings.get('autoTheme')) BF.settings.set('autoTheme', false); } catch (e) {}
    return BF.skin.set(name);
  },
  /* 当前生效外观档名（合并后档位名就是外观名） */
  name() { return BF.skin.get(); },
};
try {
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if (BF.settings.get('appearance') === 'system') BF.theme.apply();
  });
} catch (e) {}



