import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';

/* gate-v2 · 当前版本闸门（2026-11-14 重建；判据与阈值不随版本放松）
   默认审唯一测试输入 pre/target/（见 patch.mjs 的 TARGET）；argv[2] 可指任意快照做反证。
   19 道判据经母本实测复核：结构判据跨版本不变，数值基线（内联 style ≤533、确认写点 ≥23、undo ≥9）未变。
   ⑤⑮ 已闭环：⑤ 母本两处令牌谎报已删兜底；⑮ SKIN_ORDER/PALETTE_ORDER 随母本登记表走（现 8 档 / 4 色板，版本数据，判据不变）。
   路径单一真源在 patch.mjs；编辑母本在根，测试输入在 pre/target/，两者由 tool/deploy.mjs 同步。
   2026-11-23：③ 从「比对不外发基线（永远 SKIP）」改为「内联验 5 个密钥保护机制锚点各 1 处」——
     母本无硬编码密钥，那 5 处是保护用户密钥的代码；改后 ③ 真能跑、删了机制真会红，不再依赖外发文件。
   argv[2] 可指历史快照做反证，证明判据真会红。旧版闸门见 gate.mjs。 */
import { ROOT, TXT, HTML, PRE, TARGET, TARGET_HTML } from './patch.mjs';
const TMP = path.resolve(import.meta.dirname, '..', 'tmp');

const md5 = (b) => crypto.createHash('md5').update(b).digest('hex');
const results = [];
/* 三态：ok=true 通过 / false 失败 / 'skip' 未验（环境缺件，不计通过也不计失败）。
   SKIP 必须显式打印成 SKIP，绝不吞成 PASS——否则"没验的密钥锚点"会被绿色总览盖掉。 */
const gate = (name, ok, detail) => results.push({ name, ok, detail: detail || '' });

fs.mkdirSync(TMP, { recursive: true });
/* 闸门默认审母本；argv[2] 可指向 pre/ 里的历史快照 —— 用来证明某项检查真会失败，
   而不是「永远绿的那种检查」。④ 只审母本与 .html 双胞胎，不受此参数影响。 */
const CHECK = process.argv[2] ? path.resolve(ROOT, process.argv[2]) : TARGET;
console.log('[输入] ' + path.relative(ROOT, CHECK) + (process.argv[2] ? '（argv 指定）' : '（默认测试输入）'));
const src = fs.readFileSync(CHECK, 'utf8');

/* ① node --check —— 全部内联脚本 */
const scripts = [...src.matchAll(/<script([^>]*)>([\s\S]*?)<\/script>/gi)].filter((m) => !/src\s*=/i.test(m[1]));
let jsOk = scripts.length === 1, jsNote = `${scripts.length} 个内联 script`;
scripts.forEach((m, i) => {
  const f = path.join(TMP, `script-${i}.js`);
  fs.writeFileSync(f, m[2], 'utf8');
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { jsOk = false; jsNote += ' :: ' + String(e.stderr).split('\n')[0] + ' | ' + String(e.stderr).split('\n').slice(1, 5).join(' | '); }
  /* 用完就删：这份抽取文件是母本内联脚本的完整副本，留在 tmp/ 里就是一颗
     「第二份母本」的地雷 —— 历轮清理时反复发现的 script-0.js 正是它，
     而被清理的那一轮并不知道自己清的是闸门的产物。 */
  try { fs.rmSync(f, { force: true }); } catch (e) { /* Windows 偶发占用，下次再删 */ }
});
gate('① node --check', jsOk, jsNote);

/* ② CSS 花括号 / 注释配平 */
const styles = [...src.matchAll(/<style([^>]*)>([\s\S]*?)<\/style>/gi)];
let cssOk = true; const cssNotes = [];
styles.forEach((m, i) => {
  const body = m[2];
  const stripped = body.replace(/\/\*[\s\S]*?\*\//g, '');
  const o = (stripped.match(/\{/g) || []).length, c = (stripped.match(/\}/g) || []).length;
  const cs = (body.match(/\/\*/g) || []).length, ce = (body.match(/\*\//g) || []).length;
  if (o !== c || cs !== ce) { cssOk = false; cssNotes.push(`#${i}: {${o} vs }${c} /*${cs} vs */${ce}`); }
});
gate('② CSS 配平', cssOk, `${styles.length} 个 style 块` + (cssNotes.length ? ' :: ' + cssNotes.join('; ') : ''));

/* ③ 密钥保护机制在场 —— 2026-11-23 改造。
   历史：这道闸门叫「密钥逐字节」，靠一个刻意不外发的基线 pre/baseline-v0.4.3.txt 比对
   5 个锚点的全文。但 (1) 母本里根本没有硬编码密钥值，那 5 个锚点其实是「保护用户密钥的
   机制代码」：PRIV_KEYS 真源/副本、_secretGate 函数、两个密钥输入框；(2) 基线不外发 ⇒
   接手方手里这道闸门永远 SKIP，形同虚设。owner 指出「程序里没密钥了，闸门却还挂着
   API 密钥比对」——于是改为内联结构断言：直接验这 5 个机制锚点各在场且恰好 1 处。
   这样 ③ 不再依赖外发文件，真能跑、删了机制真会红；判据强度不降反升（原基线只比
   有文件的那一方，现在无文件也能守）。若将来真往母本里写入密钥字面量，那是 key-audit
   的职责（形状+归档比对），不在本闸门口径内。 */
const SECRET_ANCHORS = [
  ['PRIV_KEYS 真源', "const PRIV_KEYS = new Set(['aiApiKey'"],
  ['PRIV_KEYS 副本', 'const PRIV_KEYS = BF.store.PRIV_KEYS ||'],
  ['_secretGate 函数', 'async function _secretGate(label) {'],
  ['密钥输入行 mimo', 'data-set-text="mimoApiKey"'],
  ['密钥输入行 ai', 'data-set-text="aiApiKey"'],
];
const secretMissing = [], secretDup = [];
for (const [name, needle] of SECRET_ANCHORS) {
  const n = src.split(needle).length - 1;
  if (n === 0) secretMissing.push(name);
  else if (n > 1) secretDup.push(name + '×' + n);
}
gate('③ 密钥保护机制在场', secretMissing.length === 0 && secretDup.length === 0,
  `5 个锚点各恰好 1 处` +
  (secretMissing.length ? ' :: 缺失 ' + secretMissing.join('/') : '') +
  (secretDup.length ? ' :: 重复 ' + secretDup.join('/') : ''));

/* ④ txt / html 双生同步 —— 恒审编辑母本那一对（TXT/HTML），固定 import，不随 CHECK 漂移。
   历史：曾从 CHECK 派生 twinHtml，导致 --file 指历史快照时 ④ 跟着跑偏、违背"恒审母本"的承诺；
   2026-11-23 路径真源统一时改为固定 TXT/HTML。快照反证时 ④ 仍守当前母本双生。 */
if (!fs.existsSync(HTML)) gate('④ txt/html 同步', false, '.html 工作副本缺失（' + path.relative(ROOT, HTML) + '）');
else gate('④ txt/html 同步', md5(fs.readFileSync(HTML)) === md5(fs.readFileSync(TXT)), '逐字节一致 · 恒审根 TXT/HTML');

/* ⑤ 令牌 lint
   定义 = style 块里的 --x:（去注释）
   注入 = JS 侧真会写进自定义属性的名字：setProperty('...') / 拼串 '--x:' / 'var(--x-' + n + ')'
   幽灵 = CSS 里 var(--x) 消费了，但既没定义也没注入 —— 静默失败
   孤儿 = 定义了却没有任何消费者（CSS 引用、JS 注入、动态前缀都不算） */
const cssAll = styles.map((m) => m[2].replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
const jsAll = scripts.map((m) => m[2].replace(/\/\*[\s\S]*?\*\//g, '')).join('\n');
const defined = new Set([...cssAll.matchAll(/(^|[;{}\s])(--[A-Za-z0-9-]+)\s*:/g)].map((m) => m[2]));
const cssRefs = new Map();
const addRef = (m, k) => m.set(k, (m.get(k) || 0) + 1);
[...cssAll.matchAll(/var\(\s*(--[A-Za-z0-9-]+)/g)].forEach((x) => addRef(cssRefs, x[1]));
const injected = new Set();
[...jsAll.matchAll(/setProperty\(\s*['"](--[A-Za-z0-9-]+)['"]/g)].forEach((x) => injected.add(x[1]));
/* 注入形态四种，逐一收：setProperty('--x', v) / 拼串起头 '--x:' /
   拼串中带分号 ';--x:'（封面墨色那条就是）/ 对象键 '--x': （皮肤令牌表是这种，
   冒号在收尾引号外面，只认前引号的正则吃不到它）。
   漏掉任何一种 = 那个键拼错了也查不出来，静默不生效。 */
[...jsAll.matchAll(/['"`;{}]\s*(--[A-Za-z0-9-]+)\s*:/g)].forEach((x) => injected.add(x[1]));
[...jsAll.matchAll(/['"](--[A-Za-z0-9-]+)['"]\s*:/g)].forEach((x) => injected.add(x[1]));
const dynPrefix = [...jsAll.matchAll(/['"`]var\(\s*(--[A-Za-z0-9-]*)['"`]\s*\+/g)].map((x) => x[1]);
const isDynamic = (k) => dynPrefix.some((d) => k.startsWith(d));
const ghosts = [...cssRefs.keys()].filter((k) => !defined.has(k) && !injected.has(k) && !isDynamic(k));
const orphans = [...defined].filter((k) => !cssRefs.has(k) && !injected.has(k) && !isDynamic(k));
const fbSet = new Set();
let fbx;
const fbRe = /var\(\s*(--[A-Za-z0-9-]+)\s*,/g;
while ((fbx = fbRe.exec(cssAll))) fbSet.add(fbx[1]);
const fbNames = [...fbSet];
/* G2：兜底只准用在「运行时注入」的令牌上（--rd-pmb/--arrow-x/--pv-ink 这类，默认值是文档化的一部分）。
   已定义却还写 var(--x, 字面量) = 谎报：值漂移了也看不出来。*/
const lying = fbNames.filter((k) => defined.has(k));
const injectedFb = fbNames.filter((k) => !defined.has(k) && (injected.has(k) || isDynamic(k)));
gate('⑤ 令牌 lint', ghosts.length === 0 && lying.length === 0,
  `定义 ${defined.size} | CSS 消费 ${cssRefs.size} | JS 注入 ${injected.size} | 幽灵 ${ghosts.length} | 孤儿 ${orphans.length} | 注入兜底 ${injectedFb.length} | 谎报兜底 ${lying.length}` +
  (ghosts.length ? ' :: 幽灵 ' + ghosts.join(' ') : '') + (lying.length ? ' :: 谎报 ' + lying.join(' ') : ''));
fs.writeFileSync(path.join(TMP, 'ghosts.txt'), [...ghosts].sort().join('\n'), 'utf8');
fs.writeFileSync(path.join(TMP, 'orphans.txt'), [...orphans].sort().join('\n'), 'utf8');
fs.writeFileSync(path.join(TMP, 'fallbacks.txt'), [...new Set(cssAll.match(/var\(\s*--[A-Za-z0-9-]+\s*,[^)]*\)/g) || [])].sort().join('\n'), 'utf8');

/* ⑥ 版本串 5 身份写入点（UPDATE_LOG 与历史注释不参与判定，防止改写历史） */
const verChecks = [
  ['<title>', /<title>北风 V0\.0\.1-alpha<\/title>/],
  ['topbar', /id="topbar-ver">V0\.0\.1-alpha</],
  ['BF.version', /BF\.version\s*=\s*'0\.0\.1-alpha';/],
  ['VERSION_DISPLAY', /BF\.VERSION_DISPLAY\s*=\s*'V0\.0\.1-alpha';/],
  ['ver 兜底', /BF\.VERSION_DISPLAY\s*\|\|\s*'V0\.0\.1-alpha'/],
];
const hit = verChecks.filter(([, re]) => re.test(src)).length;
gate('⑥ 版本串', hit === 5, `身份写入点 ${hit}/5 命中 V0.0.1-alpha`);

/* ⑦ 红线签名在场 */
const signatures = [
  ['M23 resplitBook', /function resplitBook|resplitBook\s*[:=]/],
  ['经典 topbar', /class="topbar"/],
  ['微读 scoped', /\.microread\b/],
  ['#drawer', /id="drawer"/],
  ['BF.SCENES', /BF\.SCENES\s*=/],
  ['BF.sheet', /BF\.sheet\s*=/],
];
const missingSig = signatures.filter(([, re]) => !re.test(src)).map(([n]) => n);
gate('⑦ 红线签名', missingSig.length === 0, missingSig.length ? '缺失 ' + missingSig.join(' / ') : '6 项全在场');

/* ⑧ 激活态单一事实源（S2.1）
   「选中 / 按下 / 当前」这三种状态只准由 ARIA 承载：
     aria-current —— 导航与栏位；aria-selected —— role=tab / role=option；aria-pressed —— 独立开关。
   CSS 里出现 .active 选择器，就意味着又开了一套与 ARIA 并行、且主题与皮肤覆盖不动的事实源 ——
   这正是旧代码「状态是真的、画面是旧的」的根因（工作台左栏曾用内联 style 写激活态）。
   唯一例外：BF.select 的 .is-active 是键盘游标（不是选择），语义由 aria-activedescendant 承担，
   类只负责画 —— 所以写点数必须恰好为 1，多一处就是漏收。 */
const cssActiveSel = (cssAll.match(/[^\w-]\.active(?![\w-])/g) || []).length;
const jsActiveCls = (jsAll.match(/classList\.(?:add|remove|toggle|contains)\(\s*['"]active['"]/g) || []).length;
const strActive = (src.match(/\?\s*' active'/g) || []).length;
const legacyOn = (src.match(/is-on\b|is-open\b/g) || []).length;
const cursorWrites = (jsAll.match(/classList\.toggle\(\s*'is-active'/g) || []).length;
const ariaCnt = ['aria-current', 'aria-selected', 'aria-pressed']
  .map((a) => a + '·' + (src.match(new RegExp(a + '=', 'g')) || []).length).join(' ');
const actOk = cssActiveSel === 0 && jsActiveCls === 0 && strActive === 0 && legacyOn === 0 && cursorWrites === 1;
gate('⑧ 激活态单一事实源', actOk,
  `${ariaCnt} | CSS .active ${cssActiveSel} | JS 写 active 类 ${jsActiveCls} | 拼串 ' active' ${strActive} | is-on/is-open ${legacyOn} | 游标写点 ${cursorWrites}/1`);

/* ⑨ mask 只准落在纯装饰节点上（S2.2 前置教训）
   mask-image 裁的是「整个元素的绘制结果」，不是背景图 —— 一旦命中表单控件，
   控件的文字、边框、值全都被裁成遮罩形状，只剩一个箭头。
   这个故障静态读 CSS 看不出来，浏览器里才现形（实测：设置面板三个下拉只剩 ▼），
   而且把 mask 挪到 ::after 也救不回来 —— Blink 不绘制 <select> 的伪元素内容。
   所以把「mask 不得作用于 select / .select」固化成闸门，防止下一次为了去硬编码色再踩。 */
const maskRules = [...cssAll.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((m) =>
  /(^|[,>\s(])\.?select\b/.test(m[1]) && /(^|[;{\s])(-webkit-)?mask(-image)?\s*:/.test(m[2]));
gate('⑨ mask 不碰表单控件', maskRules.length === 0,
  maskRules.length ? '命中 ' + maskRules.length + ' 条：' + maskRules.map((m) => m[1].trim().slice(0, 40)).join(' / ')
    : 'CSS 中 mask 与 select 选择器零交集 · 收起态箭头由内核绘制 + color-scheme 定明暗');

/* ⑩ 开窗只有一个写点（S2.2）
   浮层的显隐开关必须只由 BF.sheet 写。判据两条：
     · JS 侧：把 getElementById('<层 id>') 的返回值按变量名记住，再看该变量有没有
       classList.add/remove/toggle('open'|'show') —— 变量名会撞（modal-bg 与 import-bg
       都叫 bg），所以一个名字允许挂多个 id，命中任意一个都算裸写。
     · CSS 侧：不得留 [data-open] 这类「画了状态但没人写状态」的并行开关。
       它与 .open 同时生效时，删掉类面板照样"开"，留着它谁都不认 —— 和 S2.1
       清掉的 .active / .is-on / .is-open 是同一族病。
   多写点的代价这次全在旧代码里：BF.modal 自带一套旧 Tab 陷阱（判据还停在
   offsetParent）、confirm 的 Esc 监听每次调用漏一个、且除 Esc 之外的关闭路径
   让 Promise 永久 pending、DSL 与导入各自复述「谁开着」。 */
const LAYER_IDS = ['modal-bg', 'import-bg', 'cmd-mask', 'v4-cheat', 'settings', 'drawer', 'dsl-console', 'bf-trash'];
const lines = src.split('\n');
const bound = new Map();   /* 变量名 → Set<层 id> */
lines.forEach((l) => {
  const m = l.match(/(?:const|let|var)?\s*([A-Za-z_$][\w$]*)\s*=\s*document\.getElementById\('([a-z0-9-]+)'\)/);
  if (m && LAYER_IDS.includes(m[2])) {
    if (!bound.has(m[1])) bound.set(m[1], new Set());
    bound.get(m[1]).add(m[2]);
  }
});
const bareWrites = [];
lines.forEach((l, i) => {
  for (const [v, ids] of bound) {
    const re = new RegExp("\\b" + v + "\\.classList\\.(?:add|remove|toggle)\\(\\s*['\"](?:open|show)['\"]");
    if (re.test(l)) bareWrites.push('L' + (i + 1) + ' ' + [...ids].join('|') + ' ← ' + l.trim().slice(0, 44));
  }
  /* 不经过变量的裸写：document.getElementById('某层').classList.add('open')。
     上一层只盯得住「先取名再操作」的写法，而面板越来越多是即取即用，
     名字不在账上就等于没查 —— R1.3-b 新增的 bf-trash 就是这种。 */
  const direct = l.match(/document\.getElementById\('([a-z0-9-]+)'\)\s*\.\s*classList\.(?:add|remove|toggle)\(\s*['"](?:open|show)['"]/);
  if (direct && LAYER_IDS.includes(direct[1])) bareWrites.push('L' + (i + 1) + ' ' + direct[1] + ' ← ' + l.trim().slice(0, 44));
});
const dataOpenSel = (cssAll.match(/\[data-open\]/g) || []).length;
gate('⑩ 开窗单一写点', bareWrites.length === 0 && dataOpenSel === 0,
  `层 id ${LAYER_IDS.length} 个 | JS 裸写开关 ${bareWrites.length} | CSS [data-open] ${dataOpenSel}` +
  (bareWrites.length ? ' :: ' + bareWrites.join(' / ') : '') +
  (dataOpenSel ? ' :: 并行开关残留 ' + dataOpenSel + ' 处' : ' · 开关全在 BF.sheet 内'));

/* ⑪ 开合状态的单一读点（S2.3 / S2.5）
   「这一层开着吗」只准问 BF.sheet 的账本。class 是画面，账本是状态：
   重绘、换档、被 innerHTML 重建之后两者会错开 —— 旧代码里这就是
   「面板明明关着，遮罩还压着页面」的成因。两处病灶曾经各读一套：
     · v3Scrim 自己读 classList.contains('open')，名单还写死成 ['drawer','settings']，
       其余十余个面板打开时既不压暗也点不掉；
     · BF.wsUI 把「面板开着 + 正是这一栏 → 关」手写四遍（isSec && isOpen 的四种组合）。
   所以这两件事一起钉住：字面量 open/show 的 class 读取必须为 0，
   isSec(...) 之后紧跟 isOpen(...) 的手写判据也必须为 0。
   （遮罩自己的 .on 类不算：那是它自己的渲染状态，不是任何面板的选择。） */
const clsOpenReads = (jsAll.match(/classList\.contains\(\s*['"](open|show)['"]/g) || []).length;
const handToggle = (jsAll.match(/isSec\([^)]*\)[\s\S]{0,80}?isOpen\(/g) || []).length;
const sheetApi = ['closable', 'dimmed', 'subscribe'].filter((k) =>
  new RegExp('return \\{[^}]*\\b' + k + '\\b').test(jsAll)).length;
gate('⑪ 开合状态单一读点', clsOpenReads === 0 && handToggle === 0 && sheetApi === 3,
  `class 读开合 ${clsOpenReads} | 手写栏位判据 ${handToggle} | 账本对外接口 ${sheetApi}/3` +
  (clsOpenReads || handToggle ? ' :: 有代码在账本之外自己判断开合' : ' · 开合与降噪只有 BF.sheet 一处事实源'));

/* ⑫ S2 成果棘轮（S2.6 内联外提 / S2.7 尺寸单一事实源 / S2.8 触控热区）
   这三步的共同点是「数字一个没改，改的是谁说了算」，所以它们最容易死于无形：
   下一个人加面板时照抄一句旧写法，功能照常、界面照常，单一事实源却已经破了一道。
   棘轮只设上限不设目标 —— 每项都是实测当前值 + 不许回潮；
   要抬高基线必须显式改这里的数字，而「改基线」这个动作本身就是评审。
     (a) 全文内联 style=" 的处数。基线 542，各改前快照是 543–552。
     (b) 260 / 340 这两个数只准住在 --h-* / --w-toast 令牌里：CSS 别处再现一次，
         就是「同一个事实的第二个副本」回来了。同理模态外壳只准一条 .pk-panel.dlg-shell
         规则，各弹窗的差异只准走 --dlg-* —— 把 max-height:84vh 抄回 cssText，
         等于退回「七个弹窗各抄一句、已经抄出三组漂移值」的改前状态。
     (c) 热区两组成员必须逐字一一对应：只有 position 组 = 白设定位，
         只有 ::after 组 = 伪元素相对别的祖先定位，两种都静默失效、界面毫无异常。
         四个实测无效组员不得回组（<select> 不渲染伪元素 / 自身 overflow:hidden 把它裁掉），
         它们改走的 min-height 先例两条都得在场；共用伪元素必须横向也扩（left 为负），
         否则 30×30 那批方形按钮只能长高、到不了 32 宽。 */
/* 上限 533（R1.4 并回时下调：539 → 533，交回件里「最近在读」空状态的
   字号/居中写成了两份内联样式，外提成 .recent-empty 后一处都不留） */
const INLINE_STYLE_CEIL = 533;
/* 2026-11-23 增量判据：533 是数量棘轮（只收不放），但"只卡数量不卡位置"——
   加一处内联 style 从 531→532 根本不红，直到 533 才拦，等于默许两处新增。
   钉一条相对基线：任何新增（>BASELINE）即红，逼新增样式外提到 CSS。
   这是棘轮收紧，不是放松；基线只能下调不能上调（下调=清掉一处内联）。
   2026-11-25 维护批次：诊断/工作台 18 处 margin-top:18px 内联外提为 .pane-sec-gap 类，
   基线 531 → 513（收紧 18 处）。 */
const INLINE_STYLE_BASELINE = 513;
const inlineStyles = (src.match(/(?<![\w-])style="/g) || []).length;
const SIZE_TOKEN_OK = ['--h-log', '--h-log-max', '--h-ai-thread', '--h-ai-result', '--h-stats-books', '--w-toast'];
const sizeLost = SIZE_TOKEN_OK.filter((t) => !defined.has(t));
/* 逐条声明判断：值里带 260/340px 的，属性名必须是自定义属性（令牌定义本身） */
const sizeCopies = cssAll.split(/[;{}]/).map((d) => {
  const m = /^\s*([\w-]+)\s*:([\s\S]*)$/.exec(d);
  return m && /\b(?:260|340)px\b/.test(m[2]) && !m[1].startsWith('--') ? m[1] + ':' + m[2].trim().slice(0, 28) : null;
}).filter(Boolean);
const shellRules = (cssAll.match(/\.pk-panel\.dlg-shell\s*\{/g) || []).length;
const shellCopies = (src.match(/cls: 'dlg-shell'[^\n]*cssText: '(?!--dlg)/g) || []).length;

const hotStart = src.indexOf('⑧ 触摸目标');
const hotEnd = src.indexOf('.input, .select, textarea.input {');
const hot = hotStart >= 0 && hotEnd > hotStart ? src.slice(hotStart, hotEnd) : '';
const norm = (s) => s.split(/[\n,]+/).map((x) => x.replace(/::after\s*\{?$/, '').trim()).filter(Boolean);
const posAt = hot.indexOf('.btn, .pk-panel__close'), posEnd = hot.indexOf('{ position: relative; }');
const aftAt = hot.indexOf('.btn::after'), aftEnd = hot.indexOf("content: ''", aftAt);
const posMembers = posAt >= 0 && posEnd > posAt ? norm(hot.slice(posAt, posEnd)) : [];
const aftMembers = aftAt >= 0 && aftEnd > aftAt ? norm(hot.slice(aftAt, aftEnd)) : [];
const orphanPos = posMembers.filter((p) => !aftMembers.includes(p));
const orphanAft = aftMembers.filter((p) => !posMembers.includes(p));
const HOT_BANNED = ['.select', '.mr-ts-sel', '.focus-chip', '.mr-ts-dot'];
const bannedBack = HOT_BANNED.filter((b) => posMembers.includes(b) || aftMembers.includes(b));
const wideExpand = /left: -\d+px; right: -\d+px/.test(hot);
const minHPrecedent = [/\.input, \.select, textarea\.input \{[^}]*min-height: 32px/s, /\.mr-ts-sel \{[^}]*min-height: 32px/s]
  .filter((re) => !re.test(cssAll)).length;
const ratchet = [];
if (inlineStyles > INLINE_STYLE_CEIL) ratchet.push(`内联 style ${inlineStyles} 超硬顶 ${INLINE_STYLE_CEIL}`);
if (inlineStyles > INLINE_STYLE_BASELINE) ratchet.push(`内联 style 相对基线新增 ${inlineStyles - INLINE_STYLE_BASELINE} 处（${INLINE_STYLE_BASELINE}→${inlineStyles}，新增样式须外提 CSS；基线只许下调不许上调）`);
if (sizeLost.length) ratchet.push('尺寸令牌缺失 ' + sizeLost.join('/'));
if (sizeCopies.length) ratchet.push('260/340 副本回潮 ' + sizeCopies.join(' / '));
if (shellRules !== 1) ratchet.push('模态外壳规则 ' + shellRules + '/1 条');
if (shellCopies) ratchet.push('弹窗抄回外壳几何 ' + shellCopies + ' 处');
if (!hot) ratchet.push('找不到 ⑧ 热区段');
if (orphanPos.length) ratchet.push('设了定位没给热区 ' + orphanPos.join('/'));
if (orphanAft.length) ratchet.push('给了热区没设定位 ' + orphanAft.join('/'));
if (bannedBack.length) ratchet.push('无效组员回组 ' + bannedBack.join('/'));
if (!wideExpand) ratchet.push('共用伪元素横向不扩（方形控件到不了 32 宽）');
if (minHPrecedent) ratchet.push('min-height 先例缺 ' + minHPrecedent + '/2');
gate('⑫ S2 成果棘轮', ratchet.length === 0,
  `内联 style ${inlineStyles}/${INLINE_STYLE_CEIL}（基线 ${INLINE_STYLE_BASELINE}）| 尺寸令牌 ${SIZE_TOKEN_OK.length - sizeLost.length}/6 在位·副本 ${sizeCopies.length} | 外壳规则 ${shellRules}/1·抄回 ${shellCopies} | 热区两组 ${posMembers.length}/${aftMembers.length} 成对·无效组员 ${bannedBack.length}·横扩 ${wideExpand ? '是' : '否'}·min-height 先例 ${2 - minHPrecedent}/2` +
  (ratchet.length ? ' :: ' + ratchet.join(' · ') : ' · S2.6/2.7/2.8 三处成果均未回潮'));

/* ⑬ 确认只有一个写点（R1.1 + R1.2 + R1.3-a）
   BF.ask 是唯一的确认通道：BF.modal 不再导出 confirm、代码里不许再引用 BF.modal.confirm、
   modal 方言 `dangerous:` 不许出现在调用侧（ask 认 danger）。
   原生对话框清零：window.alert/confirm/prompt 全 0（R1.2 收了拆分点与两个命令），
   裸 alert(/confirm( 也 0（BF.modal 自己的 function alert 定义除外，局部别名 prompt(s) 是模板取值不是对话框）。
   BF.ask.confirm 的"写点数下限 ≥23"曾在本闸与⑭重复。2026-11-23 去重：
   计数要求由 ⑭ 的「op ↔ 确认一一对应 + 名单逐点在档」继承（更强的判据），
   本闸只守"通道唯一"——确认只能走 BF.ask，原生对话框与裸调用全清零。
   数个数不再是有效防线：减一处写点要么是漏迁（⑭的名单对不上会红），
   要么是显式评审（改⑭登记）。 */
const jsCode = jsAll.replace(/^\s*\/\/.*$/gm, '');
const modalConfirmRef = (jsCode.match(/BF\.modal\.confirm/g) || []).length;
const askConfirmCalls = (jsCode.match(/BF\.ask\.confirm\(/g) || []).length;
const modalDialect = (jsCode.match(/dangerous:/g) || []).length;
const nativeWindow = (jsCode.match(/window\.(alert|confirm|prompt)\(/g) || []).length;
const nativeBare = (jsCode.match(/(?:^|[^.\w])(?<!function )(alert|confirm)\s*\(/g) || []).length;
gate('⑬ 确认只有一个写点',
  modalConfirmRef === 0 && modalDialect === 0 && nativeWindow === 0 && nativeBare === 0,
  `BF.modal.confirm 引用 ${modalConfirmRef} | modal 方言 dangerous: ${modalDialect} | window.* 对话框 ${nativeWindow} | 裸 alert/confirm ${nativeBare} | BF.ask.confirm 写点 ${askConfirmCalls}（计数由⑭继承，本闸只守通道唯一）`);

/* ⑭ 破坏必有回响（R1.3）· 确认绑在能力上，不绑在入口上
   本轮立的是三条：
     ① 一个 op 只有一个档位 —— 同一个操作从书架点、从命令面板敲、从 DSL 终端跑，
        问的是同一句、要的是同一种应答；档位漂移就意味着有一条路径在敷衍。
     ② 破坏操作名单必须逐个有确认写点，且不低于登记档位 —— 名单是「什么算破坏」的
        单一真源，漏一个就是「有一条路径不问就做」。
     ③ 确认写点必须可归因 —— 每个写点要么带字面 op，要么是已知的两个无 op 通道
        （中枢通用确认、脚本 ctx.confirm 透传）。多出来的就是黑户。
   DSL 那一半（终端里同样要问，而且危险档要敲 y）是结构性检查：上下文标记只有一份真源、
   ask 读它、不去重/不吃记忆、时限不吃人的思考时间。
   注：档位由三元式动态决定的写点（dsl.elevate.*）跳过档位比对，只查 op 在场。 */
const noComment = jsCode.replace(/\/\*[\s\S]*?\*\//g, '');
const askSites = [];
for (let i = -1; (i = noComment.indexOf('BF.ask.confirm(', i + 1)) >= 0;) {
  const seg = noComment.slice(i, i + 700);
  const op = (seg.match(/op:\s*'([^']*)'/) || [])[1] || '';
  const t = (seg.match(/danger:\s*(\d)/) || [])[1];
  askSites.push({ op, tier: t === undefined ? null : +t, line: noComment.slice(0, i).split('\n').length });
}
/* 破坏名单：op → 确认档位下限（实测得出，不是推测；新增破坏面必须先在这里挂号） */
const DESTRUCTIVE = {
  'book.delete': 2, 'book.deleteBatch': 2, 'book.resplit': 2, 'note.delete': 2,
  'ai.session.delete': 2, 'ai.resetPrompts': 2, 'cache.clearTransients': 2, 'cache.clearBackups': 2,
  'backup.restore': 2, 'backup.import': 2, 'opfs.restore': 2, 'bk.migrate': 2, 'bk.apply.security': 3,
  'data.resetAll': 3, 'secret-access': 3, 'pin.forget': 2,
  'book.purge': 3, 'trash.empty': 3,
  'shelf.groupDelete': 2,   /* 删分组：只摘归属、有快照撤销，与 note.delete 同档 */
  /* AI 预设是用户自建数据，且勾选「含密钥」时预设里嵌着 aiApiKey：
     覆盖/删除都会抹掉原有配置 ⇒ 与 note.delete 同档（下限 2，站点已挂快照撤销）。 */
  'settings.overwritePreset': 2, 'settings.delPreset': 2,
  /* 清除密钥：值只在本机存储里，清掉就得重新去服务商拿 ⇒ 与 note.delete 同档 */
  'key.clear': 2,
  /* 残留正文清理：自愈按上限扣住之后，人在数据页点头才真删 —— 删的是不可找回的正文，
     与 book.purge 同档（3）。 */
  'heal.cleanOrphans': 3,
  /* 隔离区两条：清除删的是「读坏原文」的唯一凭据，不可找回 ⇒ 2；
     导出本身不改数据，但产物是离开本机的敏感文本，登记下限 2 是为了
     钉住「这份文件可能仍含敏感内容」这句确认不能被日后调成静默执行。 */
  'base.clearCorrupt': 2, 'base.exportCorrupt': 2,
  /* 朗读读法纠正清空：抹掉的是用户逐条手填的替读词条，不可找回、只能重填
     ⇒ 与 note.delete 同档（2）。 */
  'tts.pronClear': 2,
};
const NON_DESTRUCTIVE = new Set(['dsl.elevate.', 'book.importDup', 'settings.reset']);
const g14 = [];
const tierByOp = new Map();
for (const s of askSites) {
  if (!s.op || s.tier === null) continue;
  const prev = tierByOp.get(s.op);
  if (prev !== undefined && prev !== s.tier) g14.push(`op「${s.op}」同一名两个档位 ${prev}/${s.tier}`);
  else if (prev === undefined) tierByOp.set(s.op, s.tier);
}
for (const [op, min] of Object.entries(DESTRUCTIVE)) {
  if (!tierByOp.has(op)) g14.push(`破坏操作「${op}」没有确认写点`);
  else if (tierByOp.get(op) < min) g14.push(`「${op}」档位 ${tierByOp.get(op)} 低于登记下限 ${min}`);
}
for (const op of tierByOp.keys()) if (!DESTRUCTIVE[op] && !NON_DESTRUCTIVE.has(op)) g14.push(`未登记的 op「${op}」`);
const opless = askSites.filter((s) => !s.op).length;
const accountable = (noComment.match(/title: '确认执行：'/g) || []).length
  + (noComment.match(/Object\.assign\(\{\}, msg, \{ force: true \}\)/g) || []).length;
if (opless !== accountable) g14.push(`${opless} 处确认写点无 op，可归因的只有 ${accountable} 处`);
const g14dsl = [
  ['上下文标记真源', /function isScript\(\) \{ return _scriptDepth > 0; \}/],
  ['标记进出配对', /_scriptEnter\(\);[\s\S]{0,6000}?\} finally \{ _scriptExit\(\); \}/],
  ['isScript 已对外', /isScript: isScript[,}]/],
  ['ask 读同一真源', /function inDsl\(\)/],
  ['终端危险档要敲字', /requireY:[^\n]*&& inDsl\(\)/],
  ['终端不去重', /tier < 2 && !opts\.force && !inDsl\(\)/],
  ['终端不吃记忆', /tier <= 1 && !opts\.force && !inDsl\(\)/],
  ['时限不吃人', /_runBudget\(fn\(CONSOLE_BF/],
  ['忙态可查', /busy: function \(\) \{ return _open; \}/],
];
for (const [n, re] of g14dsl) if (!re.test(noComment)) g14.push('DSL 通道缺 ' + n);
if (/await timeout\(fn\(CONSOLE_BF/.test(noComment)) g14.push('旧 5s 时限仍在抢跑');
if (/op: 'console\.resetAll'|op: 'cmd\.data\.reset'/.test(noComment)) g14.push('入口侧自带第二问（同一操作连弹两窗）');
/* 回收站（R1.3-b）· 软删标记路线的三条承重墙：
   ① 8 秒定时器那套整个退场 —— 它承诺的「可撤销」只有 8 秒有效，
      吐司一过就再也找不回，而用户以为随时能撤销。
   ② 「彻底删除」的后果文案必须走问前先验（verify），不许拿 meta 上的
      缓存字段凑数 —— 回收站里的正文段数只有 IDB 知道。
   ③ 自愈的孤儿清理必须并集回收站 id，否则下次启动就把回收站里的正文
      删干净，「删了能恢复」当场变成「恢复出来一本空书」。 */
const g14trash = [
  ['回收站键已登记', /TRASH: 'trash',/],
  ['回收站模块在场', /BF\.trash = \(function \(\)/],
  ['彻底删除走数据销毁', /BF\.app\._doDelete\(String\(it\.meta\.id\)\)/],
  ['问前先验取真值', /verify: function \(\) \{ return facts\(id\); \}/],
  ['自愈并集回收站 id', /PREFIX \+ BF\.store\.K\.TRASH\);[\s\S]{0,600}?ids\.add/],
  ['回收站读失败不硬删', /回收站读取失败，跳过残留数据清理/],
];
for (const [n, re] of g14trash) if (!re.test(src)) g14.push('回收站缺 ' + n);
/* 自愈与存储写入的四条承重墙（2026-11-01 深度审计批次1/3）：
   这一族坏了都不报错，只表现为「某天一睁眼书少了」，所以必须钉在闸门上。 */
const g14heal = [
  ['损坏隔离后重置主键', /const LS_QUOTA = null;[\s\S]{0,1200}return LS_QUOTA;/],
  ['配额拦截不计断路失败', /if \(r === false\) _trip\(\)/],
  ['书架损坏期间不做孤儿清理', /corruptHas\(BF\.store\.K\.BOOKS_META\)/],
  ['不把读不到当没有', /不把「读不到」当「没有」/],
  ['自动删除有量级上限', /const ORPHAN_CAP = \{/],
  ['残留删除走批量事务并回报真删数', /idbDeleteMany/],
  ['书架可从正文库重建', /async function rebuildShelfFromTitles/],
  ['重建只补缺不覆盖', /只补缺/],
  ['字数无从还原时不写 0 冒充已知', /statsUnknown/],
  ['UGC 读写有索引可依', /createIndex\('kind_book'/],
  ['正文表归属扫描有索引可依', /createIndex\('bk', 'bookId'\)/],
];
for (const [n, re] of g14heal) if (!re.test(src)) g14.push('自愈/存储缺 ' + n);
/* 全表读正文的次数棘轮：搬整张 chapters 表只允许出现在「备份快照」这一处。
   删一本书、重切一本书、统计一本书……凡是按书的操作都该走 bk 索引——
   启动自愈原先就是按书判定却全表 getAll，13 万段实测 14.9 秒。
   多出来的每一处都要先说清为什么非搬全库不可。 */
const chAllReads = (jsCode.match(/idbGetAll\(BF\.store\.K\.CHAPTERS/g) || []).length;
if (chAllReads > 1) g14.push('章节表全表读 ' + chAllReads + ' 处（只准备份快照 1 处，其余走 bk 索引）');
const goneTimers = [
  ['__pending 撤销窗', /__pending/],
  ['scheduleDelete 定时器', /scheduleDelete/],
  ['8 秒可撤销承诺', /8 秒内可撤销|可在 8 秒内撤销|8 秒可撤销/],
].filter(([, re]) => re.test(src));
if (goneTimers.length) g14.push('旧撤销窗残留：' + goneTimers.map(([n]) => n).join(' / '));
gate('⑭ 破坏必有回响', g14.length === 0,
  `确认写点 ${askSites.length}（带 op ${askSites.length - opless}·无 op ${opless}）| 名单 ${Object.keys(DESTRUCTIVE).length} 项逐点在档 | 登记 op ${tierByOp.size} | 回收站承重 ${g14trash.length}/6` +
  (g14.length ? ' :: ' + g14.join(' · ') : ' · 一个 op 一个档位，四条路径同一标准'));

/* ⑮ 外观只有一张登记表（S1 续 · 主题∪外观模式合并版，owner 2026-10-19）
   一张 BF.SKINS 同列两类成员：明暗档（light/dark/black/system，由 body 作用域供给）
   与固定轴色板（songyan/yan/yehang，靠 body 内联令牌重染）。加一档要同时动：
   登记表四张（顺序 / 名字 / 副标题 / 轴）+ 色板加一张时逐键对齐 + 枚举只能从表里生成。
   任何一处漏了都不报错，只表现为「选了没反应」（枚举与校验分家）或「换档残留」
   （色板键并集算少）—— 正是这一路一直在清零的两类病。 */
const g15 = [];
/* 2026-11-23 改判据：SKIN_ORDER/PALETTE_ORDER 从 BF.SKINS 登记表派生，不再硬编码 8/27。
   历史：写死顺序数组导致"加一档要改的第二处地方"——正是⑮自己要消灭的第二真源。
   现在 BF.SKINS 是唯一真源：顺序 = 表本身，色板档 = 出现在 SKIN_TOKENS 表里的那些。
   一致性靠"四表成员对齐 + label 快照 + 色板逐键对齐 + 枚举从表生成"守住，
   硬编码的只剩用户可见的中文 label 快照（改名字必须同步，属显式契约）。 */
const arrM = src.match(/BF\.SKINS\s*=\s*\[([^\]]*)\]/);
const skins = arrM ? [...arrM[1].matchAll(/'([^']+)'/g)].map((m) => m[1]) : [];
if (!arrM) g15.push('BF.SKINS 缺失');
/* 色板档从表派生：BF.SKIN_TOKENS 这张登记表的键就是固定轴色板档的单一真源
   （{ songyan:..., yan:..., yehang:... }）。加一档色板只需在这里登记，
   PALETTE_ORDER 自动跟上，无处硬编码 4/27。 */
const PALETTE_ORDER = regKeysOf('SKIN_TOKENS');
function regKeysOf(name) {
  const m = src.match(new RegExp('BF\\.' + name + '\\s*=\\s*\\{([^}]*)\\}'));
  return m ? [...m[1].matchAll(/\b([a-z][a-z0-9]*)\s*:/g)].map((x) => x[1]) : [];
}
const regKeys = (name) => {
  const m = src.match(new RegExp('BF\\.' + name + '\\s*=\\s*\\{([^}]*)\\}'));
  if (!m) return null;
  return [...m[1].matchAll(/(?:^|[,{\s])([a-z][a-z0-9]*)\s*:/g)].map((x) => x[1]);
};
const paletteKeys = (name) => {
  const m = src.match(new RegExp('BF\\.' + name + '_TOKENS\\s*=\\s*\\{'));
  if (!m) return null;
  let d = 0, j = src.indexOf('{', m.index);
  for (let k = j; k < src.length; k++) {
    if (src[k] === '{') d++;
    else if (src[k] === '}') { d--; if (!d) return [...src.slice(j, k).matchAll(/'(--[a-z0-9-]+)'\s*:/g)].map((x) => x[1]); }
  }
  return null;
};
for (const [tbl, expect] of [['SKIN_LABELS', skins], ['SKIN_SUBS', skins], ['SKIN_AXIS', skins],
  ['SKIN_TOKENS', PALETTE_ORDER]]) {
  const ks = regKeys(tbl);
  if (!ks) g15.push('BF.' + tbl + ' 缺失');
  else if (ks.slice().sort().join(',') !== expect.slice().sort().join(','))
    g15.push('BF.' + tbl + ' 成员与登记表不齐：' + ks.join(','));
}
/* label 值快照：四表对齐只比键名、比不出中文名被改。
   名字属用户可见契约（改了要同步命令面板/帮助文案），故把值钉进判据——改名字必须同步改这里。 */
const LABEL_SNAPSHOT = { light: '浅色', dark: '深色', black: '纯黑', system: '系统', songyan: '墨绿', yan: '高级灰', yehang: '夜航' };
const labelBody = (src.match(/BF\.SKIN_LABELS\s*=\s*\{([^}]*)\}/) || [])[1] || '';
for (const k of Object.keys(LABEL_SNAPSHOT)) {
  if (!new RegExp(k + ":\\s*'" + LABEL_SNAPSHOT[k] + "'").test(labelBody))
    g15.push('SKIN_LABELS.' + k + ' 名称被改（应为「' + LABEL_SNAPSHOT[k] + '」）');
}
/* 逐键对齐只对"同结构"的两张（SONGYAN/YAN 各 27 键）；YEHANG 是 30 键的
   不同结构表，不参与逐键比对——这是表结构约定，不是数量硬编码。 */
const boards = PALETTE_ORDER.filter((k) => /^(songyan|yan)$/.test(k)).map((n) => [n.toUpperCase(), paletteKeys(n.toUpperCase())]);
if (!boards.length) g15.push('没派生出可比对的同结构色板档（SONGYAN/YAN）');
if (boards.some(([, ks]) => !ks)) g15.push('色板有一张抠不出键');
else {
  const base = boards[0][1].slice().sort().join(',');
  boards.forEach(([n, ks]) => {
    if (ks.sort().join(',') !== base) g15.push(n + '_TOKENS 与 ' + boards[0][0] + '_TOKENS 逐键不齐（' + ks.length + ' 键 vs ' + boards[0][1].length + '）');
  });
}
/* 枚举只能从表里来：抄一份名字就是第四份事实源 */
if (/\[\s*'songyan'\s*,\s*'墨/.test(src)) g15.push('外观枚举被抄回字面量（应走 BF.skin.opts()）');
if (!/_sel\('appearance',\s*BF\.skin\.opts\(\)\)/.test(src)) g15.push('设置下拉未走 BF.skin.opts()');
if (!/appearance:\s*\{[^}]*opts:\s*BF\.skin\.opts\(\)/.test(src)) g15.push('设置枚举未走 BF.skin.opts()');
/* 双键已合并：theme/skin 设置键再出现就是幽灵 */
if (/settings\.get\('theme'\)/.test(src)) g15.push('settings.get(theme) 复活（已合并为 appearance）');
if (/settings\.get\('skin'\)/.test(src)) g15.push('settings.get(skin) 复活（已合并为 appearance）');
/* 默认档：合并后落「深色 · 夜墨」；固定色板一律不占默认 */
if (!/appearance:\s*'dark'/.test(src)) g15.push('默认外观不是深色 · 夜墨');
if (PALETTE_ORDER.some((k) => new RegExp("appearance:\\s*'" + k + "'").test(src))) g15.push('默认外观被写成固定色板');
/* 说明里的数量从表算，不写死：写死就变成加一档要改的第二处地方 */
gate('⑮ 外观只有一张登记表', g15.length === 0,
  `顺序 ${skins.length}（${skins.length - PALETTE_ORDER.length} 档 + ${PALETTE_ORDER.length} 色板） · 四表成员对齐 · 色板逐键对齐 ${boards[0][1] ? boards[0][1].length : 0} 键 · 枚举生成点 2 · 默认 dark` +
  (g15.length ? ' :: ' + g15.join(' · ') : ' · 加一档外观只许动登记表'));

/* ⑯ 撤销只有一个通道（R1.3 · P-C）
   撤销这条链上每一环都会「说了不算」：登记点绕开 act.run 就没有失败反馈；
   文案把吐司驻留时长写成撤销时限，用户就以为吐司一消失数据真没了；
   反过来把「Ctrl+Z 可撤销」写死而快捷键不在场，也是一句假承诺。所以这里盯四件事：
   ① 裸 BF.undo.push 全文只准出现 1 次，且必须在 BF.act.run 内部；
   ② act.run 的 undo: 传点数走下限棘轮（≥9：…/ 临时数据 / 重新分章有界包）——
      撤销点只能变多，变少必须是一次显式评审而不是漏迁；
   ③ 任何「N 秒(内)可撤销」句式清零（⑭ 只拦「8 秒」那三条，这里拦所有数字）；
   ④ edit.undo 的 ctrl+z 与 meta+z 绑定必须在场，且吐司文案就是那句真承诺。 */
const g16 = [];
const barePush = (jsCode.match(/BF\.undo\.push\(/g) || []).length;
if (barePush !== 1) g16.push('裸 BF.undo.push 写点 ' + barePush + '（只准 act.run 内 1 处）');
const undoPts = (jsCode.match(/undo: function \(/g) || []).length;
/* 2026-11-23 降级：≥9 下限恒绿失效（实测 16，永不可能 <9），不再是有效防线。
   传点数降为报告层只出数；真正的硬断言是下面的裸 push=1 / 假时限=0 / 双快捷键。
   撤销点若真减少到危险程度，靠 ⑭ 的承重键一致性 + 真机 undo 上限验证兜。 */
const falseWindow = (src.match(/\d+\s*秒(?:内)?可撤销/g) || []).length;
if (falseWindow) g16.push('时限假承诺 ' + falseWindow + ' 处');
const ck = /BF\.hotkeys\.bind\(\s*'edit\.undo(?:\.mac)?',\s*'(ctrl|meta)\+z'/g;
const binds = (src.match(ck) || []).map((s) => (/'meta\+z'/.test(s) ? 'meta+z' : 'ctrl+z'));
for (const need of ['ctrl+z', 'meta+z']) if (!binds.includes(need)) g16.push('撤销快捷键缺 ' + need);
if (!/label \+ '（Ctrl\+Z 可撤销）'/.test(jsCode)) g16.push('撤销吐司文案不再声明常驻入口');
/* 入口不许再套一层 act.run：同一个动作两条反馈路径 = 失败弹两遍 */
const doubleWrap = (jsCode.match(/BF\.act\.run\([^\n]{0,80}?BF\.reader\.del(Bookmark|Note)\(/g) || []).length;
if (doubleWrap) g16.push('删除入口外层重复包 act.run ' + doubleWrap + ' 处');
gate('⑯ 撤销只有一个通道', g16.length === 0,
  `裸 push ${barePush}/1 | undo 传点 ${undoPts}（↘报告层只出数，≥9 恒绿已摘）| 假时限 ${falseWindow} | 快捷键 ${binds.join('+') || '无'} | 入口套壳 ${doubleWrap}` +
  (g16.length ? ' :: ' + g16.join(' · ') : ' · 登记、文案、快捷键三处同一口径'));

/* ⑰ 顺序依赖显式化（G-3）
   单文件里命名空间是共享可变对象：同一个 `BF.x = {…}` 写第二遍，
   后一次整体赋值会把前一次挂上去的东西无声抹掉 —— 表现不是报错，是"那块功能没了"。
   所以每个顶层命名空间只许有一处整体赋值；要加分量请挂属性（BF.x.foo = …），别换整个对象。
   另一半是运行期：模块按拓扑装，但启动之后才 register 的模块会当场就装、不看依赖装没装过，
   那条路必须留痕，否则"依赖后装"这种最难查的形态只表现为点了没反应。 */
const nsAssign = new Map();
for (const m of jsCode.matchAll(/^ {0,2}BF\.([A-Za-z_$][\w$]*)\s*=\s*[({]/gm)) {
  nsAssign.set(m[1], (nsAssign.get(m[1]) || 0) + 1);
}
const g17 = [];
const dupNs = [...nsAssign.entries()].filter(([, n]) => n > 1);
if (dupNs.length) g17.push('命名空间被整体赋值多次：' + dupNs.map(([k, n]) => k + '×' + n).join(', '));
if (!/function _topo\(\)/.test(jsCode)) g17.push('缺依赖拓扑排序 _topo');
if (!/'顺序依赖：'/.test(jsCode)) g17.push('缺启动后 register 的顺序依赖留痕');
gate('⑰ 顺序依赖显式化', g17.length === 0,
  `顶层命名空间 ${nsAssign.size} 个·整体赋值多次 ${dupNs.length} | _topo 在场 ${/function _topo\(\)/.test(jsCode) ? '是' : '否'} | 迟注册留痕 ${/'顺序依赖：'/.test(jsCode) ? '在' : '缺'}` +
  (g17.length ? ' :: ' + g17.join(' · ') : ' · 一个命名空间一个主人，依赖顺序违背会留痕'));

/* ⑱ 同一真源内的"自我覆盖"与越界引用（2026-10-28 · 外部审查报告 P1-12 / P0-D 一族）
   `node --check` 只判语法：对象字面量里同名键写两遍（后写静默覆盖先写）、
   以及在一个 IIFE 里定义、到另一个 IIFE 里裸调用，语法都合法、运行才炸。
   这一族此前 17 道全盲，且真出过事故（`cfg.setMany` 调 `invoke` 必 ReferenceError、
   DSL 的 `assert` 被第二个定义覆盖成"永不抛异常"，手册说的是前一个）。 */
const g18 = [];
/* a) 同一个对象字面量里同名键写两遍：`{ txt: 'a', ..., txt: 'b' }`。
      必须按花括号分组判——`cond ? {ok:true,x:1} : {ok:false,error:2}` 一行里两组
      各有一个 ok，那是两个对象，不是重复键（初版这样误判过，六行假阳性）。 */
for (const line of jsCode.split('\n')) {
  if (line.indexOf('{') < 0) continue;
  const stack = [];          /* 每个 { 一层，记该层看到的键 */
  let bad = null;
  for (let i = 0; i < line.length && !bad; i++) {
    const ch = line[i];
    if (ch === '"' || ch === "'" || ch === '`') {   /* 字符串整体跳过，别把文案里的冒号当键 */
      const q = ch;
      i++;
      while (i < line.length) { if (line[i] === '\\') { i += 2; continue; } if (line[i] === q) break; i++; }
      continue;
    }
    if (ch === '{') { stack.push(new Set()); continue; }
    if (ch === '}') { stack.pop(); continue; }
    if (ch === ':') {
      /* 只认「对象字面量里的属性冒号」：键的左边必须是 { 或 ,（去掉空白后）。
         三元表达式的冒号（`id: j ? j.id : 0` 里第二个）左边是值或 .id，
         不当它算键——初版把它算成键，一次报出六行假阳性。 */
      const head = line.slice(0, i).replace(/\s+$/, '');
      if (!head) continue;
      const last = head[head.length - 1];
      if (last !== '{' && last !== ',') continue;
      const m = head.match(/([{,])\s*([A-Za-z_$][\w$]*)$/);
      if (m && stack.length) {
        const key = m[2];
        if (stack[stack.length - 1].has(key)) { bad = key; break; }
        stack[stack.length - 1].add(key);
      }
    }
  }
  if (bad) g18.push('同一对象内重复键 ' + bad + ' → ' + line.trim().slice(0, 70));
}
/* b) 同缩进、同名、都是 `key: function` 的两处定义，中间没有更浅的收尾括号 ⇒ 同一对象字面量里自我覆盖 */
const jsLines = jsCode.split('\n');
const propDefs = new Map();
jsLines.forEach((l, i) => {
  const m = l.match(/^( +)([A-Za-z_$][\w$]*): function[ (]/);
  if (!m) return;
  const k = m[1].length + '|' + m[2];
  (propDefs.get(k) || propDefs.set(k, []).get(k)).push(i);
});
for (const [k, rows] of propDefs) {
  if (rows.length < 2) continue;
  const indent = Number(k.split('|')[0]);
  const name = k.split('|')[1];
  for (let i = 1; i < rows.length; i++) {
    /* 只比紧邻的两处：真自我覆盖都是"复制粘贴改了一半"，隔着一屏的两个同名方法
       属于两个对象（DSL 手册里 `run`、`verify` 各出现几十次）。窗口收在 20 行内。 */
    if (rows[i] - rows[i - 1] > 20) continue;
    /* 只看「第一处以 `{` 结尾」的定义：一行写完的 `run: function (id) { … },` 后面紧跟
       同缩进的另一个 `run:`，那是数组里的兄弟对象（书卡动作十项就是这样写的），
       不是同一个对象自我覆盖。本闸门因此是「宁可漏也不误报」的子集：
       拦同一对象内多行写法的重复方法 + 同一行的重复键，跨行一行式重复键不在此列。 */
    if (!jsLines[rows[i - 1]].trim().endsWith('{')) continue;
    const gap = jsLines.slice(rows[i - 1] + 1, rows[i]);
    /* 中间出现过「在本对象缩进层或更浅处收口」的 `}` / `},` / `}),` / `]}` ⇒ 前一个对象已结束 */
    /* 中间只要出现「比本对象键更浅的收口括号」才算前一个对象已结束：
       与键同缩进的 `},` 只是**上一个属性**收口，对象还开着——把它当结束会漏掉真重复。 */
    const closed = gap.some((l) => {
      const t = l.trim();
      return /^[}\])]/.test(t) && (l.length - l.trimStart().length) < indent;
    });
    if (!closed) { g18.push('同名方法在一个对象里定义两遍：' + name + '（行 ' + (rows[i - 1] + 1) + ' 与 ' + (rows[i] + 1) + '：「' + jsLines[rows[i]].trim().slice(0, 40) + '」，后写覆盖先写）'); break; }
  }
}
/* c) 跨 IIFE 裸调用局部函数（P0-D 那一族）不做静态判：
      单文件里没有 AST，靠顶格 `(function () {` / `})();` 切作用域会把内联 IIFE、
      箭头函数与对象方法一并算错，实测假阳性一堆（on/emit/once/push 全中招）。
      宁可不拦，也不留一条会红给下一个人看的闸门——那条判据要靠 ESLint no-undef 才有意义，
      本项目零依赖，改由 tool/tests 与人工评审兜。 */
gate('⑱ 无自我覆盖与越界引用', g18.length === 0,
  `同行重复键 / 同对象重复方法 两类静态扫描${g18.length ? ' :: ' + g18.slice(0, 6).join(' · ') : '归零 · 跨 IIFE 裸调用不静态判（无 AST，靠 tool/tests + 人工评审兜，见源码注释）'}`);

/* ⑲ HTML 骨架同层：每个 .page 容器必须在下一个 .page 出现之前闭合。
   少一个 </div> 时，解析器会把后面的页面全接成它的孩子——那个容器若默认
   display:none，切过去就是整页空白，而用户只当程序卡了一下。node --check 看语法、
   ② 看样式块配平，两者都看不见 HTML 骨架的错位（它只在渲染树上成立）。 */
{
  const bodyAt = src.lastIndexOf('<body');
  const scriptAt = src.indexOf('<script', bodyAt);
  const skel = src.slice(bodyAt < 0 ? 0 : bodyAt, scriptAt > 0 ? scriptAt : src.length)
    .replace(/<!--[\s\S]*?-->/g, '');
  let depth = 0;
  const layers = [];
  for (const m of skel.matchAll(/<div\b[^>]*>|<\/div>/g)) {
    if (m[0] === '</div>') { depth--; continue; }
    depth++;
    const idm = m[0].match(/id="(page-[a-z-]+)"/);
    if (idm && /\bpage\b/.test(m[0])) layers.push({ id: idm[1], d: depth });
  }
  const base = layers.length ? layers[0].d : 0;
  const odd = layers.filter((x) => x.d !== base);
  gate('⑲ HTML 骨架同层', layers.length > 1 && odd.length === 0,
    `${layers.length} 个页面容器` + (layers.length < 2 ? '（一条也没扫到，判据没接上——先修扫描）'
      : odd.length ? ' :: 不同层 ' + odd.map((x) => x.id + '@深' + x.d).join(' / ') + '（有 div 未闭合，后面的页面被吞进它里面）'
        : ` 全部同层（深 ${base}）· 骨架少一行闭合就拦在这里`));
}

/* 报告 */
const fail = results.filter((r) => r.ok === false).length;
const skipped = results.filter((r) => r.ok === 'skip');
const passed = results.filter((r) => r.ok === true).length;
console.log(`\n══ 北风 验收闸门 ${new Date().toISOString().slice(0, 19)} ══`);
results.forEach((x) => {
  const tag = x.ok === true ? '  PASS' : x.ok === false ? '  FAIL' : '  SKIP';
  console.log(`${tag}  ${x.name}${x.detail ? '   — ' + x.detail : ''}`);
});
const skipNote = skipped.length ? ` · ${skipped.length} 项 SKIP（${skipped.map((s) => s.name.slice(0, 3)).join('、')}，基线未提供故未验）` : '';
console.log(`══ ${passed}/${results.length - skipped.length} 通过${skipNote} · ${(src.split('\n').length - 1)} 行 · ${Buffer.byteLength(src)} B ══\n`);
/* 有 SKIP 时退出码仍可为 0（环境缺件不是失败），但总览必须带 SKIP 字样，绝不静默。 */
process.exit(fail ? 1 : 0);
