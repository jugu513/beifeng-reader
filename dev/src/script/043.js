/* ================= L1. 编码探测 ================= */
BF.library.detectEncoding = function (buf) {
  if (buf.length >= 3 && buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) return 'UTF-8';
  if (buf.length >= 2 && buf[0] === 0xFF && buf[1] === 0xFE) return 'UTF-16LE';
  if (buf.length >= 2 && buf[0] === 0xFE && buf[1] === 0xFF) return 'UTF-16BE';
  return 'auto';
};
/* 解码质量打分：正向证据与负向证据一起算。
   只加分不扣分的写法会让错解反超正解——Big5 把 GBK 字节解成一串罕见字与部首，
   「汉字占比高」这一条它比正解还占优，而评分认不出「这些字没人写在书里」。 */
BF.library.textScore = function (s) {
  if (!s) return -Infinity;
  const sample = s.slice(0, 3000);
  let cn = 0, kana = 0, punct = 0, ascii = 0, bad = 0, rare = 0;
  for (const c of sample) {
    const cp = c.charCodeAt(0);
    if (cp === 0xFFFD) bad++;
    else if (cp >= 0x3040 && cp <= 0x30FF) kana++;   /* 平假名/片假名：日文强信号 */
    else if (cp >= 0x4E00 && cp <= 0x9FFF) cn++;
    else if (cp < 128) ascii++;
    /* 全角标点与中日韩标点（、。「」，？）：正解里成串出现，跨码表乱解几乎造不出它们 */
    else if ((cp >= 0x3000 && cp <= 0x303F) || (cp >= 0xFF01 && cp <= 0xFF5E)) punct++;
    /* 真人写的书里不会出现这些码位：CJK 部首增补与部首表意文字、兼容形式、私用区。
       错解最常落在这几片地上（Big5 解 GBK 常见「⺍」这类部首形状）。 */
    else if ((cp >= 0x2E80 && cp <= 0x2FFF) || (cp >= 0xFE30 && cp <= 0xFE4F) ||
             (cp >= 0xE000 && cp <= 0xF8FF)) rare++;
  }
  const total = sample.length;
  if (total === 0) return -Infinity;
  /* 密度按「正文字符」算：汉字 + 假名 + 标点。只数汉字时，假名与标点全被当成无效字符，
     反而输给「每个字节对都解成汉字」的跨码表乱解。本版不解日文（候选表里没有
     Shift_JIS / EUC-JP），假名这一项留着是因为它对中文仍然是负向证据： */
  let score = ((cn + kana + punct) / total) * 100 - bad * 5 + (ascii / total) * 10 - rare * 12;
  /* 以汉字为主的文本里混着零星假名 = 错解的形状（GBK 字节被 Big5 解出「お」这类字符）。
     短样本上一个假名就能过比例线，所以要同时看绝对数量再扣。 */
  if (kana > 0 && kana < 6 && cn / total > 0.3) score -= 8;
  return score;
};
/* 非致命 UTF-8 解「就此定案」的两个上限（都按解出的字符数算）：
   bad  = U+FFFD 占比。UTF-8 正文混坏字节 0.03–0.042，真 GBK/GB18030 中文 0.70–0.82。
   ctrl = 控制字符（含 NUL）占比。这条专门拦无 BOM 的 UTF-16 中文：它按 UTF-8 解
          替换符只有 0.186，单看 bad 会被当成「坏得不多的 UTF-8」放行；但控制字符占 0.203，
          而任何正常文本（含混坏字节的）这一项是 0。
   两个判据各留三到十倍余量。 */
BF.library.UTF8_LOOSE_LIMIT = { bad: 0.2, ctrl: 0.02 };
BF.library._utf16NoBom = function (buf) {
  /* 无 BOM 的 UTF-16 探测：偶数位是可打印 ASCII 而奇数位是 0x00 → UTF-16LE，反之 BE。
     合法 UTF-8 的中文与纯 ASCII 都几乎没有 0x00，不会误触；阈值 pairs/total > 0.5。 */
  if (buf.length < 4) return null;
  let le = 0, be = 0, total = 0;
  for (let i = 0; i + 1 < buf.length; i += 2) {
    total++;
    const a = buf[i], b = buf[i + 1];
    if (b === 0x00 && a >= 0x20 && a <= 0x7E) le++;
    if (a === 0x00 && b >= 0x20 && b <= 0x7E) be++;
  }
  if (total === 0) return null;
  if (le / total > 0.5) return 'UTF-16LE';
  if (be / total > 0.5) return 'UTF-16BE';
  return null;
};
/* 打分兜底的候选编码只有这一张表：enc = 存储与界面里的名字，label = TextDecoder 标签，
   设置页「默认编码」的选项也从这里派生。名单与解码器分两处维护时，漏配的那一项会抛
   TypeError 被循环里的 catch 当成「这个编码不适合这段文本」吞掉，该编码从此不参与评分，
   而返回值里的 bestEnc 依然报得很有把握。
   本版只做中文与英文：Shift_JIS / EUC-JP 不进表，界面上也就没有这两档。 */
BF.library.ENC_CANDIDATES = [
  { enc: 'UTF-8', label: 'utf-8' },
  { enc: 'GB18030', label: 'gb18030' },
  { enc: 'GBK', label: 'gbk' },
  { enc: 'Big5', label: 'big5' },
  { enc: 'UTF-16LE', label: 'utf-16le' },
  { enc: 'UTF-16BE', label: 'utf-16be' }
];
BF.library.decodeBuffer = function (buf, preferred) {
  /* ① BOM 直判：有 BOM 就用它，不进后续流程 —— UTF-16 按 UTF-8 解会满屏乱码，
     靠打分猜救不回来 */
  const bom = BF.library.detectEncoding(buf);
  if (bom !== 'auto') {
    try {
      return { text: new TextDecoder(bom).decode(buf), enc: bom, confident: true };
    } catch (e) { /* 浏览器不支持该标签则落回打分 */ }
  }
  /* ② 无 BOM 的 UTF-16 必须早于严格 UTF-8 判定：UTF-16LE 的 ASCII 内容按 UTF-8 解
     会满屏 NUL，而 0x00 本身是合法 UTF-8 字节 —— fatal 试解会「通过」并解出一堆空字符。 */
  const u16 = BF.library._utf16NoBom(buf);
  if (u16) {
    try { return { text: new TextDecoder(u16.toLowerCase()).decode(buf), enc: u16, confident: true }; } catch (e) { BF.err.report('decode.utf16nobom', e); }
  }
  /* ③ 编码确定性判定：打分前先做
     UTF-8 严格（fatal）试解。UTF-8 是自同步编码——合法 UTF-8 流
     （含中文标点「」『』《》—— 等）必然通过 fatal 试解；而
     GB18030/GBK 是字节超集，非严格模式下任何字节流都「能解」，
     会把合法 UTF-8 中文标点判成 GB18030（标点密集文本误判根因：
     破折号/全角标点为主的 UTF-8 文本会被判成 GB18030）。
     试解通过即判定 UTF-8 直接返回，不再进打分，判定确定化。
     此判定必须早于任何「只解码前 8KB 探针」优化 ——
     探针会放大误判，顺序陷阱。 */
  try {
    const strict = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return { text: strict.charCodeAt(0) === 0xFEFF ? strict.slice(1) : strict, enc: 'UTF-8', confident: true };
  } catch (e) { /* 含非 UTF-8 字节 → 落回打分流程 */ }
  /* ④ 严格试解失败只证明「有坏字节」，不证明「整篇不是 UTF-8」。
     先按 UTF-8 非致命解一次，用替换符占解出字符的比例决定就此定案还是交给打分
     （阈值与其两侧距离见 UTF8_LOOSE_LIMIT）。
     不立这一支的后果：中文正文里混进几个坏字节就整篇判给 GB18030，
     解出来是一篇生僻字 —— 它一个 U+FFFD 都不产生，打分反而更高。 */
  const loose = new TextDecoder('utf-8', { fatal: false }).decode(buf);
  let _bad = 0, _ctl = 0;
  for (let i = 0; i < loose.length; i++) {
    const cp = loose.charCodeAt(i);
    if (cp === 0xFFFD) _bad++;
    else if (cp < 32 && cp !== 9 && cp !== 10 && cp !== 13) _ctl++;
  }
  const LL = BF.library.UTF8_LOOSE_LIMIT;
  if (loose.length > 0 && _bad / loose.length < LL.bad && _ctl / loose.length < LL.ctrl) {
    return { text: loose.charCodeAt(0) === 0xFEFF ? loose.slice(1) : loose, enc: 'UTF-8', confident: true };
  }
  /* ⑤ 打分兜底：双字节中文（GB18030 / GBK / Big5）+ UTF 系，取最高分。
     UTF-16 也进候选是补 ② 的短板：② 只认得「一字节 ASCII + 一字节 0x00」那种
     无 BOM 形态，全中文的 UTF-16 两个字节都高，看不出来；交给打分让 common 汉字率自己说话
     —— 真 UTF-16 中文按 GB18030 解只剩零星汉字，反过来 UTF-16LE 解出满屏正文。
     顺序排在末位，同分时仍先取双字节编码。
     首选编码（设置项 / 文件历史 / URL charset）排在最前。 */
  const labelOf = {}, nameOf = {};
  BF.library.ENC_CANDIDATES.forEach(function (c) {
    labelOf[c.enc.toUpperCase()] = c.label;
    nameOf[c.enc.toUpperCase()] = c.enc;
  });
  const order = [];
  if (preferred && preferred !== 'auto') {
    const p = nameOf[String(preferred).toUpperCase()];
    if (p) order.push(p);
    else BF.log.warn('首选编码不在候选表里，已按自动顺序尝试：' + preferred);
  }
  BF.library.ENC_CANDIDATES.forEach(function (c) { if (order.indexOf(c.enc) < 0) order.push(c.enc); });
  let best = null, bestScore = -Infinity, bestEnc = 'UTF-8', otherScore = -Infinity;
  /* 打分只看前几千字符，候选却按整本解——6 个候选 × 64MB 会产生数倍于原文件的临时字符串。
     这里只解前 256KB 用于打分（切在 UTF-8 字符边界上，避免尾部半个字符产生替换符），
     选定编码后再对整本解一次。严格/非致命 UTF-8 两遍仍走全量，判定顺序不变。 */
  const PROBE_BYTES = 256 * 1024;
  let probe = buf;
  if (buf.length > PROBE_BYTES) {
    let cut = PROBE_BYTES;
    while (cut > 0 && (buf[cut] & 0xC0) === 0x80) cut--;
    probe = buf.subarray(0, cut);
  }
  for (const enc of order) {
    let s;
    /* 标签不被当前浏览器支持 = 这个候选压根没法测，出声才能与「测过但分低」区分开 */
    try { s = new TextDecoder(labelOf[enc.toUpperCase()], { fatal: false }).decode(probe); }
    catch (e) { BF.log.warn('编码候选解码失败：' + enc); continue; }
    /* 首字符若是 BOM 残留的 U+FEFF，先剥掉再打分，否则会轻微拉低正确编码的分数 */
    const sc = BF.library.textScore(s.charCodeAt(0) === 0xFEFF ? s.slice(1) : s);
    if (best === null) { best = s; bestScore = sc; bestEnc = enc; continue; }
    /* GB18030 与 GBK 对同一份字节的解通常一字不差 —— 那是同一答案的两个别名，
       不是第二个候选。按别名算分差会让每本 GBK 书都变成「没把握」。 */
    if (s === best) continue;
    if (sc > bestScore) { otherScore = bestScore; best = s; bestScore = sc; bestEnc = enc; }
    else if (sc > otherScore) otherScore = sc;
  }
  if (best !== null && probe !== buf) {
    try { best = new TextDecoder(labelOf[bestEnc.toUpperCase()], { fatal: false }).decode(buf); }
    catch (e) {
      /* 拿 256KB 样本冒充整本会让 60MB 的书「导入成功却只有开头」：宁可拒收 */
      BF.log.warn('胜出编码的整本解码失败，已拒收：' + bestEnc);
      throw new Error('整本解码失败（' + bestEnc + '），请确认文件编码后重试');
    }
  }
  const margin = bestScore - otherScore;
  /* 置信度：分差要拉开，样本要够长（≥2000 字符），短样本只在「大比分领先」时才敢说确定。
     短篇、节选、单章 TXT 恰是最常拖进来的形态，也是打分最容易失手的形态 ——
     这时自动探测不该装作确定：错编码的代价是一本连「第X章」都认不出的乱码书。 */
  const confident = !!best && margin >= 8 && (best.length >= 2000 || margin >= 40);
  return { text: best || '', enc: bestEnc, confident: confident, margin: margin };
};
/* ③ 乱码 / 二进制识别：无此项检测时 GB18030 兜底
   解码对二进制文件「成功」解出乱码书（如 10 章 /
   49,313 字），静默成书。解码后采样检测两项：U+FFFD 比例（严格
   UTF-8 试解路径不会产生，兜底猜码路径可能
   产生）与控制字符比例（二进制的强信号——文本
   除 \t\n\r 外不含控制字符）。采样前 16K 字符
   （线性开销；乱码书全文皆乱，前段即暴露）。
   阈值：FFFD > 1% 或控制字符 > 2% 即拒收。 */
BF.library.garbageScore = function (text) {
  const s = String(text == null ? '' : text);
  const sample = s.slice(0, 16384);
  if (!sample) return { fffd: 0, ctrl: 0, esc: 0, nul: 0 };
  let fffd = 0, ctrl = 0, esc = 0, nul = 0;
  for (let i = 0; i < sample.length; i++) {
    const cp = sample.charCodeAt(i);
    if (cp === 0xFFFD) fffd++;
    /* 0x7F（DEL）不计入 ctrl——含转义序列的合法文本
       （ANSI 颜色码等）常伴 DEL，计入即误杀。ESC（0x1B）是
       转义序列引导符，单独统计、不进 ctrl，由调用方按放宽
       阈值判定（见 importFile）。 */
    else if (cp === 0x1B) esc++;
    else if (cp === 0x00) nul++;
    else if (cp < 32 && cp !== 9 && cp !== 10 && cp !== 13) ctrl++;
  }
  return { fffd: fffd / sample.length, ctrl: ctrl / sample.length, esc: esc / sample.length, nul: nul / sample.length };
};
/* 乱码 / 二进制的**一条判据，两条通道共用**（文件与 URL）。URL 通道少了这道判据，
   889 个 \ufffd 也照常入库，所以两边必须同一道闸。阈值与 ESC 放宽以文件通道为准：
   含转义序列的文本每条序列一个 ESC，ctrl 按 2% 会误杀合法电子书，此时放宽到 5%。
   「是否拦下来」由设置决定（默认不拦截）；不拦截时仍给一条可见提示，
   提示可单独关 —— 静默导入一本满屏替换符的书，比当场拒收更难查。 */
BF.library.GARBLE_LIMITS = { fffd: 0.01, ctrl: 0.02, ctrlWithEsc: 0.05, nul: 0.005 };
/* 提示本身可单独关（拦截默认关，但不拦也不许静默）。
   带一个「去设置」动作，看到提示的人就是想做决定的人。 */
BF.library.garbleNotice = function (report) {
  if (BF.settings.get('garbleWarn') === false) return;
  try {
    BF.noti.warn(report, { action: { label: '去设置', run: function () { try { BF.settingsUI.open('parse'); } catch (e) {} } } });
  } catch (e) { BF.err.report('garbleNotice', e); }
};
/* 打分兜底「没把握」时的如实回执。自动探测在短篇、节选、单章 TXT 上失手很常见，
   而错编码的代价是一本连「第X章」都认不出的乱码书 —— 这种情况比不猜更需要说的是「这次是猜的」。
   与乱码提示共用开关：关掉那档的人不想知道这些。 */
BF.library.lowConfNotice = function (name, enc, dec) {
  if (BF.settings.get('garbleWarn') === false) return;
  const why = ((dec && dec.text ? dec.text.length : 0) < 2000) ? '这段文本太短' : '两个候选编码得分太接近';
  try {
    BF.noti.warn('《' + name + '》的编码是猜的（' + why + '，判为 ' + enc + '）：正文若看着不对，请指定编码后重新导入',
      { action: { label: '指定编码', run: function () { try { BF.settingsUI.open('parse'); } catch (e) {} } } });
  } catch (e) { BF.err.report('lowConfNotice', e); }
};
BF.library.garbleCheck = function (text, what) {
  const g = BF.library.garbageScore(text);
  const lim = BF.library.GARBLE_LIMITS;
  const ctrlLimit = g.esc > 0 ? lim.ctrlWithEsc : lim.ctrl;
  /* NUL 单独计一档：正文里出现空字符就是二进制误投或错编码，
     和「偶发控制字符」不是一回事，阈值也比 ctrl 低。 */
  const suspect = g.fffd > lim.fffd || g.ctrl > ctrlLimit || g.nul > lim.nul;
  /* 二进制（NUL > 0.1% 或控制字符 > 10% 或 ESC > 10%）无论设置如何都硬拒，
     不给出「照常导入」的出口。ESC 单独计数、不进 ctrl（见上），这里必须一并看，
     否则满屏 ESC 的终端转储会绕过硬拒。 */
  const hardBinary = g.nul > 0.001 || g.ctrl > 0.10 || g.esc > 0.10;
  const blocked = hardBinary || (suspect && BF.settings.get('garbleBlock') === true);
  const pct = function (x) { return Math.round(x * 100); };
  const _pcts = function () {
    return '乱码率 ' + pct(g.fffd) + '%、控制字符 ' + pct(g.ctrl) + '%' +
      (g.esc ? '（含转义符 ' + pct(g.esc) + '%）' : '') + '、空字符 ' + pct(g.nul) + '%';
  };
  /* 硬拒可能只由 ESC 触发（esc 不进 ctrl）：不写清是哪一项超限，用户看到「控制字符 0%」会一头雾水 */
  const _why = g.esc > 0.10 ? '转义符占比过高' : (g.nul > 0.001 ? '空字符占比过高' : (g.ctrl > 0.10 ? '控制字符占比过高' : ''));
  return {
    fffd: g.fffd, ctrl: g.ctrl, esc: g.esc, nul: g.nul, suspect: suspect, blocked: blocked,
    detail: _pcts(),
    report: (suspect || blocked)
      ? ((what || '内容') + '疑似损坏或非文本（' + _pcts() + '）' +
        (blocked ? '，已拒绝导入' + (_why ? '：' + _why : '') + '。请用记事本检查它是否为有效文本' : '，已照常导入'))
      : '',
  };
};
/* 编码历史记忆 */
BF.library.encHistGet = function (name) {
  const hist = BF.store.lsGet(BF.store.K.ENC_HIST, {});
  return hist[String(name).toLowerCase()] || 'auto';
};
BF.library.encHistSet = function (name, enc) {
  try {
    const hist = BF.store.lsGet(BF.store.K.ENC_HIST, {});
    const k = String(name).toLowerCase();
    /* 先删再写：对象键的顺序不会因重新赋值而变，直接覆盖会让这只滞留原位，
       淘汰时删掉的永远是最早那本，而不是最久没用的那本。 */
    delete hist[k];
    hist[k] = enc;
    const keys = Object.keys(hist);
    while (keys.length > 200) { const old = keys.shift(); delete hist[old]; }
    BF.store.lsSet(BF.store.K.ENC_HIST, hist);
  } catch (e) { BF.err.report('encHistSet', e); }
};

