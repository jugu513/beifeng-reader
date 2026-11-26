/* ================= T2. 浏览器离线引擎 ================= */
BF.tts.offline = (function () {
  let _voices = [], _voice = null, _utterance = null;
  let _v1q = new Map();
  function available() { return 'speechSynthesis' in window; }
  function loadVoices() {
    if (!available()) return [];
    _voices = speechSynthesis.getVoices() || [];
    /* 「本机语音」和「要联网的语音」必须分开：Chromium 的 Google 普通话
       localService=false，断网就哑——离线档挑到它等于把降级做成了假象。
       localService 缺失（旧内核）按本地算，别因为字段没有就把整张表全过滤掉。 */
    const isLocal = function (v) { return v.localService !== false; };
    const saved = BF.settings.get('ttsOfflineVoice') || '';
    const savedV = saved ? _voices.find(function (v) { return v.name === saved; }) : null;
    const zhAll = _voices.filter(function (v) { return /zh|chinese/i.test(v.lang + ' ' + v.name); });
    const zhLocal = zhAll.filter(isLocal);
    const pool = zhLocal.length ? zhLocal : zhAll;
    const def = savedV || pool.find(function (v) { return /zh-CN/i.test(v.lang); }) || pool[0] ||
      _voices.find(isLocal) || _voices[0];
    _voice = def || null;
    /* 角色第二音色：按 ttsVoiceAltName 解析；未指定则取不同于主音色的另一个 zh 音色 */
    const altName = BF.settings.get('ttsVoiceAltName') || '';
    BF.tts.voiceAlt = null;
    if (altName) BF.tts.voiceAlt = _voices.find(v => v.name === altName) || null;
    if (!BF.tts.voiceAlt) {
      BF.tts.voiceAlt = pool.find(function (v) { return v !== _voice; }) || _voice;
    }
    /* 灯只有一处写入口：loadVoices 与 stab.lampRefresh 各写一次同一节点时，
       谁后写谁生效 ⇒ 正在离线朗读时可以显示「TTS 不可用」。
       stab 还没就绪的早期时刻才用本地这一份，且只给健康度、不给引擎名。 */
    if (BF.tts.stab && BF.tts.stab.lampRefresh) BF.tts.stab.lampRefresh();
    else {
      const label = document.getElementById('tts-status-label');
      if (label) label.textContent = _voices.length ? '语音就绪' : 'TTS 不可用';
    }
    BF.ui.setStatusDot(_voices.length ? '' : 'warn');
    return _voices;
  }
  function voice() { return _voice; }
  function voices() {
    /* 语音表到齐的时间点不固定：Chromium 常在启动后 2s 那次补读之后才给，
       而用户点朗读恰恰就在之后。缓存空着不等于本机没有语音——
       这一刻再读一次现值，有就顺手把表补上，别对着 79 个语音报「未检测到可用语音」。
       只在空表时读，代价是一次已缓存的属性访问；表一旦补上就不再重复。 */
    if (!_voices.length && typeof speechSynthesis !== 'undefined') {
      try { if (speechSynthesis.getVoices().length) loadVoices(); } catch (e) { BF.err.report('tts.voicesReload', e); }
    }
    return _voices;
  }
  function setVoice(v) { _voice = v; }
  /* 切句语义固定（句号/逗号/80 字阈值不变，同一批句数组），只额外记下每句的
     「起点字符偏移」，再把该偏移换算成「第几段 + 段内偏移」。

     为什么必须索引化：segment 是纯字符串函数，不感知 DOM 段落结构，
     拿 seg.slice(0,8) 去全文搜段落时，短句键 `4.`/`0.` 在编号列表、表格行、
     markdown 书里成片撞车（键 `4.` 命中 12 段、`0.` 命中 14 段），
     跨段句的键落在段外则零命中且静默。

     为什么不在段内重新切句：「整段拼接后一次切」与「逐段独立切」在同一本书上
     差 1000 余句（整章一次切 4429 句、逐段切 5445 句）——本实现允许一句跨段（约 976 句含 \n），
     逐段切会把它们拆开，等于改了切句语义且句数组整体位移
     （预合成缓存、断点续播的句号全部作废）。故保留整章一次切，
     只把「这句从哪一章内偏移开始」这个事实带出来。

     opts.indexed 为真时返回 {text, pi, po}：pi=段落索引、po=段内偏移；
     pi<0 表示无法定位（未提供 paras / 偏移落在被过滤的空白行），
     此时 BF.tts.highlight 走全文搜索兜底。 */
  function _paraSpans(text, paras) {
    /* 章内字符偏移 → 段落跨度表。DOM 的 <p> 来自 BF.reader.state.paras，
       它是 text.split('\n').filter(p => p.trim()) 再经 dropDupTitlePara
       （可能吃掉首段）得到的，所以这里按同一规则逐行推进偏移，保证 pi 与
       DOM 段落序号一一对应；对不上就返回 null，让高光走兜底。 */
    const lines = String(text).split('\n');
    let off = 0, pi = 0;
    let spans = [];
    const skip = lines.filter(l => l.trim());
    if (skip.length > paras.length) {
      /* 首段被去重：lines 比 paras 多 1 行且去掉首行后逐项相同 */
      if (skip.length !== paras.length + 1) return null;
      for (let i = 1; i < skip.length; i++) if (skip[i] !== paras[i - 1]) return null;
    } else if (skip.length < paras.length) {
      return null;
    } else {
      for (let i = 0; i < skip.length; i++) if (skip[i] !== paras[i]) return null;
    }
    const dropped = skip.length - paras.length;   /* 0 或 1 */
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim()) { if (pi >= dropped) spans.push({ start: off, end: off + line.length, pi: pi - dropped }); pi++; }
      off += line.length + 1;   /* +1 = 行尾 \n，与 BF.cfi 的 Σ(len+1) 同一算法 */
    }
    return spans;
  }
  function _locate(spans, at) {
    /* 起点偏移落在某段内 → {pi, po}；落在被过滤的空白行里（切句缓冲区
       跨过了整行空白）→ 取其后第一段、po=0，即读者视觉上看到的第一处。 */
    let lo = 0, hi = spans.length - 1, hit = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (at < spans[mid].start) hi = mid - 1;
      else if (at >= spans[mid].end) lo = mid + 1;
      else { hit = mid; break; }
    }
    if (hit >= 0) return { pi: spans[hit].pi, po: at - spans[hit].start };
    for (let i = 0; i < spans.length; i++) { if (spans[i].start >= at) return { pi: spans[i].pi, po: 0 }; }
    return { pi: -1, po: 0 };
  }
  function segment(text, opts) {
    const mode = BF.settings.get('ttsSegment');
    let indexed = !!(opts && opts.indexed && Array.isArray(opts.paras) && opts.paras.length);
    /* 段落档：句与段一一对应（DOM 同为一行一段），直接按 paras 建索引。
       另两档走下面的通用循环。 */
    if (indexed && mode === 'paragraph') {
      const out = [];
      for (let pi = 0; pi < opts.paras.length; pi++) {
        const p = String(opts.paras[pi] || '');
        if (p.trim()) out.push({ text: p, pi: pi, po: 0 });
      }
      return out;
    }
    const spans = indexed ? _paraSpans(text, opts.paras) : null;
    if (indexed && !spans) indexed = false;   /* 跨度对不上 → 静默降级为未索引，不猜 */
    /* 下面这段循环是唯一切句实现：同一段文本、同一批切点、同一个过滤。
       indexed 只是额外记住每个切点的起始偏移。
       buf 每次 push 前先 trim：切点偏移记的是「未 trim 的
       缓冲起点」，trim 去掉的前导空白会自动被 po 吸收（定位只用于选段，
       段内偏移越界会在高光侧被 clamp）。 */
    const out = [];
    const push = (buf, start) => {
      const t = buf.trim();
      if (!t) return;
      if (!indexed) { out.push(t); return; }
      const L = _locate(spans, start);
      out.push({ text: t, pi: L.pi, po: L.po });
    };
    switch (mode) {
      case 'paragraph': return String(text).split('\n').filter(s => s.trim());
      case 'wordcount': {
        const max = 120; let buf = ''; let bufStart = 0;
        for (let i = 0; i < String(text).length; i++) {
          buf += String(text)[i];
          if (buf.length >= max) { push(buf, bufStart); buf = ''; bufStart = i + 1; }
        }
        if (buf) push(buf, bufStart);
        return out;
      }
      default: {
        let buf = ''; let bufStart = 0;
        const SEG_MAX = 80;       /* 硬上限：单句超 80 字强制切（规避 Chromium 长句静默停走） */
        const COMMA_SPLIT = 36;   /* 逗号级切分阈值：逗号处且 buf≥36 字才切，既逗号级切分又避免过碎 */
        const SEG_MAX_Q = 120;    /* 引号/书名号/括号内放宽逃生阀到 120 字，避免破句拆引号 */
        const END = /[。！？；!?；]/;   /* 句末集不含 ASCII '.'，小数点/缩写点由下方单独保护 */
        const COMMA = /[，、,]/;
        const s = String(text); const len = s.length;
        let depth = 0;            /* 引号/书名号/括号深度，>0 时禁逗号级切分、放宽硬切 */
        const OPEN = '「『《（('; const CLOSE = '」』》）)';
        for (let i = 0; i < len; i++) {
          const ch = s[i];
          buf += ch;
          if (OPEN.indexOf(ch) >= 0) depth++;
          else if (CLOSE.indexOf(ch) >= 0) depth = depth > 0 ? depth - 1 : 0;
          else if (ch === '"' || ch === "'" || ch === '“' || ch === '”' || ch === '‘' || ch === '’') depth = depth ? 0 : 1;
          if (END.test(ch)) { push(buf, bufStart); buf = ''; bufStart = i + 1; }
          else if (ch === '.') {
            /* 小数点（\d.\d）与缩写点（字母.字母/空格，如 Mr. / 3.14）不当句末，避免 TTS 把 "3.14" 读成破句 */
            const p = s[i - 1] || ''; const n = s[i + 1] || '';
            const decimal = /\d/.test(p) && /\d/.test(n);
            const abbrev = /[A-Za-z]/.test(p) && /[A-Za-z\s]/.test(n);
            if (!decimal && !abbrev) { push(buf, bufStart); buf = ''; bufStart = i + 1; }
          }
          else if (depth === 0 && COMMA.test(ch) && buf.length >= COMMA_SPLIT) { push(buf, bufStart); buf = ''; bufStart = i + 1; }
          else if (buf.length >= (depth > 0 ? SEG_MAX_Q : SEG_MAX)) { push(buf, bufStart); buf = ''; bufStart = i + 1; }
        }
        if (buf.trim()) push(buf, bufStart);
        return out;
      }
    }
  }
  /* 句文本读取：segs 元素可能是字符串（selSpeak 回落等路径仍是）
   或 {text, pi, po}（索引化）。两者都吃，
   避免为了索引化去改所有消费点（utterance / boundary / 预合成 / 统计）。 */
function segText(s) {
  if (s == null) return '';
  return (typeof s === 'string') ? s : (s.text || '');
}
