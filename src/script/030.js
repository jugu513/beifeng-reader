/* ================= 13.6 外观登记表（单入口，主题 ∪ 模式合并） =================
   「主题（明暗档 light/dark/black/system，无纸鸢档）」与
   「外观模式（固定色板 墨绿/高级灰/夜航，随主题）」是同一个键 appearance、
   一张登记表、一个下拉。登记表两类成员同坐一列：
     · 明暗档由 body 作用域（body.light / body.oled / :root 夜墨）供给色板，不注入内联令牌；
     · 固定轴色板通过 body 内联令牌「重染」所在轴，不新增样式块。
   没有「墨 · 随主题」这一档——它的两个去向（跟作用域走 / 跟系统走）是独立档位。
   优先级 外观 > 强调色；色板与暖色/暖滤镜的互斥住在 BF.settings.reconcileSkin。

   落点为什么是「JS 解析器把令牌写成 body 上的内联自定义属性」，
   而不是新增一个 body.su{} 样式块 ——
   ① 硬约束：改样式必须原地改写既有规则，不许新增一层块靠层叠顺序覆盖。
      样式块之间同权重，谁赢取决于书写先后，这正是被禁的那种脆弱约定。
   ② 同一个 body 元素上，内联声明胜过任何选择器声明（包括 body.light）。
      所以「色板压过作用域」由机制保证，而不是由源码顺序保证。
   ③ 强调色档位本来就是 JS 表（ACCENTS）。令牌与强调色同一处解析、同一处落值，
      不会出现「CSS 里一套、JS 里另一套」的双源漂移。

   data-skin 只是留给「非令牌规则」（圆角阶、标题字体、描边风格）的钩子，
   当前没有 CSS 消费它 —— 令牌一律走内联，不写进样式表。

   固定色板的取值逐档过 WCAG AA（文字类 ≥4.5:1，控件边界/强调底这类非文字 ≥3:1）；
   未列在这里的令牌（书封墨色板、圆角、
   间距、控件高度、z 阶…）由所在轴的作用域继续供给 —— 色板是「重染的档」，
   不是第二套完整色板。 */
BF.SKINS = ['light', 'dark', 'black', 'system', 'songyan', 'yan', 'yehang'];
/* 外观登记表：名字、副标题、渲染轴各一处，设置枚举 / 快捷键循环 / 命令 / 互斥判定全读这里。 */
BF.SKIN_LABELS = { light: '浅色', dark: '深色', black: '纯黑', system: '系统', songyan: '墨绿', yan: '高级灰', yehang: '夜航' };
/* 副标题整列清空：各档都不要再有副名。表还留着——读者取的是四表逐键对齐，
   空的理由写在表里。显示拼接仍带「空则不拼 · 」守卫。 */
BF.SKIN_SUBS = { light: '', dark: '', black: '', system: '', songyan: '', yan: '', yehang: '' };
/* axis = 所在渲染轴；system 无固定轴（'theme' = 渲染时按系统偏好现解）。 */
BF.SKIN_AXIS = { light: 'light', dark: 'dark', black: 'dark', system: 'theme', songyan: 'dark', yan: 'dark', yehang: 'dark' };
BF.SKIN_OPTS = BF.SKINS.map(function (k) { var sub = BF.SKIN_SUBS[k]; return [k, BF.SKIN_LABELS[k] + (sub ? ' · ' + sub : '')]; });


BF.SONGYAN_TOKENS = {
  /* 墨绿（登记键 songyan）：深色拉青黑，以传统松烟墨为骨（h≈150°墨绿点缀） */
  '--bg': '#0e1311', '--bg-panel': '#151b18', '--bg-input': '#1c2420',
  '--text': '#e7ede8', '--text-dim': '#9aa69d', '--text-weak': '#84928a',
  '--border': '#28332d', '--border-strong': '#5b6960',
  '--bg-hover': '#303834', '--text-ink': 'var(--text)',
  '--bg-reader': '#0e1311', '--reader-tint': '#161d19',
  '--success': '#5aab8a', '--success-ink': 'var(--success)', '--success-bg': 'rgba(90,171,138,.13)',
  '--warning': '#d9a441', '--warning-ink': 'var(--warning)', '--warning-bg': 'rgba(217,164,65,.13)',
  '--danger': '#e0685a', '--danger-ink': 'var(--danger)', '--danger-bg': 'rgba(224,104,90,.13)',
  '--info': '#6a9fc4', '--info-bg': 'rgba(106,159,196,.13)',
  '--brand-fg': '#0e1311',
  '--shadow-sm': '0 1px 2px rgba(0,0,0,.30), 0 2px 8px rgba(8,14,10,.22)',
  '--shadow-md': '0 2px 4px rgba(0,0,0,.26), 0 8px 24px rgba(8,14,10,.30)',
  '--shadow-lg': '0 8px 16px rgba(0,0,0,.30), 0 24px 64px rgba(6,10,8,.46)',
};

/* 皮肤 → 色板只登记这一次，apply 里不再按名字分支；加一套皮肤就是加一行表。
   墨 不在表里：不注入，键交还给主题作用域。 */
/* 岩 · 高级灰：中性灰阶。深轴的墨绿（h≈150°）之外补一条中性灰。
   取 h≈205°、饱和 3~6% 的冷灰：纯 R=G=B 的灰在 OLED 上会看出色带。
   强调色不写 —— 与另四套色板同口径：换肤换纸墨，不换印章（朱砂恒定）。 */
BF.YAN_TOKENS = {
  '--bg': '#1a1b1c', '--bg-panel': '#212224', '--bg-input': '#292a2c',
  '--text': '#e8e9ea', '--text-dim': '#a2a5a8', '--text-weak': '#909397',
  '--border': '#2f3133', '--border-strong': '#666a6e',
  '--bg-hover': '#3c3d3f', '--text-ink': 'var(--text)',
  '--bg-reader': '#1a1b1c', '--reader-tint': '#212325',
  '--success': '#6fae8f', '--success-ink': 'var(--success)', '--success-bg': 'rgba(111,174,143,.14)',
  '--warning': '#d3a955', '--warning-ink': 'var(--warning)', '--warning-bg': 'rgba(211,169,85,.14)',
  '--danger': '#dd7266', '--danger-ink': 'var(--danger)', '--danger-bg': 'rgba(221,114,102,.14)',
  '--info': '#7fa3bd', '--info-bg': 'rgba(127,163,189,.14)',
  '--brand-fg': '#0e0f10',
  '--shadow-sm': '0 1px 2px rgba(0,0,0,.34), 0 2px 8px rgba(12,13,14,.24)',
  '--shadow-md': '0 2px 4px rgba(0,0,0,.30), 0 8px 24px rgba(12,13,14,.32)',
  '--shadow-lg': '0 8px 16px rgba(0,0,0,.34), 0 24px 64px rgba(10,11,12,.48)',
};
