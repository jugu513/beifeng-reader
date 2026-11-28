/* ================= L2. 分章规则 ================= */
BF.library.RE_CHAPTER = /^[\s＊★✦◆■▍【〔\[]*(?:第\s*[0-9一二三四五六七八九十百千万零〇两Xx]+\s*[章节回卷集部篇话幕]|(?:序章|楔子|前言|后记|尾声|番外(?:篇|章)?|终章|引子|开局|上卷|中卷|下卷|外传|第一[一二三四五六七八九十百千万]?[章节回卷集部篇话])|(?:Chapter\s*(?:\d+|[一二三四五六七八九十]+|One|Two|Three|Four|Five|Six|Seven|Eight|Nine|Ten))|(?:[卷集部][0-9一二三四五六七八九十百千万零〇两]+))\s*[：:、.。]?\s*.*$/;
/* 伪章（扉页章）判据 —— 唯一来源，openBook 与目录渲染两处共用，别处不另写一份。
   要防的形态只有一种：旧数据第 0 章装的是书名那一行（扉页），内容几个字。
   代理判据「首章标题长度 <= 4」不可靠——「第1章」「第一章」「序章」长度都
   是 2~3，于是任何不以书名开头的正常书籍：打开即跳到第 2 章、目录里第 1 章被
   抹掉，首章永远读不到。误判的代价是「读不到正文」，
   漏判的代价只是「多看一眼扉页」，两者不对称 ⇒ 只认字面，不认长度。 */
BF.library.TITLEPAGE_MARKS = ['正文', '正文开始', '全文', '目录', '书名', '内容简介'];
BF.library.isPseudoHead = function (title, bookTitle) {
  /* 归一化只剥行首 Markdown 标题记号与首尾空白（与 _buildChapters 里那处同一规则）：
     目录/阅读器显示的是剥过的标题，而书名的来源可能是文件名，两边都要在同一口径上比对。
     仍然只认字面、不认长度 —— 按长度判会把「第1章」这类正常首章吃掉（见上面注释）。 */
  const norm = function (s) { return String(s == null ? '' : s).replace(/^[#＃]{1,6}\s*/, '').trim(); };
  const t = norm(title);
  if (!t) return false;
  if (BF.library.TITLEPAGE_MARKS.indexOf(t) >= 0) return true;
  const bt = norm(bookTitle);
  return !!bt && t === bt;
};
/* 站点导出的书籍信息块：书名/原名/作者/连载状态/字数/章节数/书籍 ID/阅读量/最后更新。
   认出它只为「在目录顶部多给一个看原文的入口」，不参与分章、不参与伪章判定 ——
   切片零丢失与「每一章都可达」都不因它改变。
   判据：短块（≤800 字）且命中 ≥3 个元信息键。
   单键与双键都不作数：正文里「作者：某某」一句话、一次「书名：xxx」的引用都很常见，
   而成组的键值才像导出头；这里误判的代价是目录里多一条看不懂的面板，
   按伪章同一条不对称原则，宁可少认。 */
BF.library.isBookInfoBlock = function (text) {
  const t = String(text == null ? '' : text);
  if (!t.trim() || t.length > 800) return false;
  const KEYS = [/书名\s*[：:]/, /原名\s*[：:]/, /作者\s*[：:]/, /连载状态\s*[：:]/,
    /字数\s*[：:]/, /章节数\s*[：:]/, /书籍\s*ID\s*[：:]/i, /阅读量\s*[：:]/, /最后更新\s*[：:]/];
  let hit = 0;
  for (let i = 0; i < KEYS.length; i++) if (KEYS[i].test(t)) hit++;
  return hit >= 3;
};
/* 自定义章节正则的灾难性回溯静态检测（分章防护）。
   用户自填的 chapterRegex 会进入逐行 test：一个指数回溯模式（(a+)+ 家族）
   就能把主线程或 Worker 永久卡死——40 字符病态输入单次 test >78s 仍未结束，
   导入大书时整页无响应、Worker 路径导入永不完成。本函数在编译前拦截最常见致命家族：
   ① 源过长——正常章头正则不会超过 300 字符；
   ② 星高度≥2（safe-regex 同族判据）：量词化分组内又含量词，(a+)+ / (\d+)* /
      (x+x+)+y / (.*)+ / (\s*\S*)*；{n} 定长重复不算（固定长度分区唯一，线性）；
   ③ 量词化分组的顶层交替分支互为前缀（含空分支/完全相同）：(a|ab)* / (a|a)+
      ——分支可互相覆盖时引擎要穷举指数多种切分。
   转义序列（\+）与字符类（[+]）内的量词字符不计。这不是完备的 ReDoS 判定，
   拦掉致命家族后，残余风险由 _splitBounds 内「逐行 400 字截断 + 3s 总预算」兜底。
   单实现双调用（分章零丢失硬约束）：主线程直接调用，Worker 经 .toString() 注入同一份。 */
function _regexRisk(src) {
  src = String(src || '');
  if (src.length > 300) return '正则过长（' + src.length + ' 字符，上限 300）';
  /* 骨架化：\x 与 [...] 各缩成一个占位符，避免类/转义里的 + * { | 被当语法 */
  var sk = '', i = 0;
  while (i < src.length) {
    var c = src.charAt(i);
    if (c === '\\') { sk += '\u0001'; i += 2; continue; }
    if (c === '[') {
      var j = i + 1;
      if (src.charAt(j) === '^') j++;
      if (src.charAt(j) === ']') j++;
      while (j < src.length && src.charAt(j) !== ']') { if (src.charAt(j) === '\\') j++; j++; }
      sk += '\u0002'; i = j + 1; continue;
    }
    sk += c; i++;
  }
  /* 分组配对：记录每组 [体, 量词后缀]；后缀为 + * 或含逗号的 {n,m}/{n,}/{,m}
     （{n} 定长与 ? 有界重复不构成指数回溯，不算） */
  var groups = [], stack = [];
  for (var k = 0; k < sk.length; k++) {
    var ch = sk.charAt(k);
    if (ch === '(') stack.push(k);
    else if (ch === ')') {
      if (!stack.length) continue;
      var open = stack.pop(), q = '';
      var nc = sk.charAt(k + 1);
      if (nc === '+' || nc === '*') q = nc;
      else if (nc === '{') {
        var mm = sk.slice(k + 1).match(/^\{(\d*)(,?)(\d*)\}/);
        if (mm && mm[2]) { var hi = mm[3] ? parseInt(mm[3], 10) : Infinity; if (hi > 1 || hi === Infinity) q = mm[0]; }
      }
      groups.push({ s: open, e: k, q: q });
    }
  }
  for (var g = 0; g < groups.length; g++) {
    var gr = groups[g];
    if (!gr.q) continue;
    var body = sk.slice(gr.s + 1, gr.e);
    if (!body) return '空的量词化分组（匹配空串，退化）';
    /* 剥掉分组前缀：`(?:` / `(?<名>` / `(?i-s:` / `(?<=` 的标记会留在体首，
       直接切 | 会让第一个分支带上 `?:`，于是 (?:a|ab)+ 的「a」与「ab」
       比不出互为前缀 ⇒ 指数回溯绕过检测（`(?<x>a|ab)*` 同病）。
       字符类排除 > 与 ) 而保留 <，才能同时覆盖 ?: 与 ?<名>；
       `?=` / `?!` 这类零宽断言不以 : 或 > 收尾，不会被误剥。 */
    body = body.replace(/^\?[^>)]*[:>]/, '');
    /* ② 星高度≥2：体内又含 + * 或含逗号的 {n,m} 形态 */
    if (/[+*]/.test(body) || /\{\d*,+\d*\}/.test(body)) return '量词化分组内又含量词（星高度≥2，指数回溯家族）';
    /* ③ 顶层分支互为前缀：按骨架深度 0 切 |，再去掉各分支的一层全包裹括号后两两比对 */
    var depth = 0, branches = [], last = 0;
    for (var p = 0; p < body.length; p++) {
      var bc = body.charAt(p);
      if (bc === '(') depth++;
      else if (bc === ')') depth--;
      else if (bc === '|' && depth === 0) { branches.push(body.slice(last, p)); last = p + 1; }
    }
    branches.push(body.slice(last));
    if (branches.length > 1) {
      var bs = branches.map(function (x) { return x.replace(/^\((.*)\)$/, '$1'); });
      for (var a = 0; a < bs.length; a++) {
        for (var b2 = a + 1; b2 < bs.length; b2++) {
          if (!bs[a] || !bs[b2] || bs[a].indexOf(bs[b2]) === 0 || bs[b2].indexOf(bs[a]) === 0)
            return '量词化分组的交替分支互为前缀（指数回溯家族）';
        }
      }
    }
  }
  return '';
}
/* 自定义正则被回溯防护拒绝时向用户明示一次。
   静默回退等于「用户设了正则却不生效」的用户可见谎言，比卡死更坏；
   __regexWarned 保证一次导入只念一次。Worker 内不能引用 BF，
   回退原因由 _splitBounds 写进 opts.__regexRejected 回传后在此消费。 */
function _warnRegexRisk(o) {
  if (!o || !o.__regexRejected || BF.library.__regexWarned) return;
  BF.library.__regexWarned = true;
  BF.log.warn('自定义章节正则已忽略（' + o.__regexRejected + '），本次分章改用内置规则');
  /* 只写日志等于没说：导入者不会去控制台找原因，只会觉得"正则没生效"。
     一次导入只提一次（上面的 __regexWarned 已去重）。 */
  try { BF.noti && BF.noti.warn && BF.noti.warn('自定义章节正则本次未采用（' + o.__regexRejected + '），已改用内置规则分章'); } catch (e) {}
}
/* 零丢失分章内核（偏移切片法）。
   禁止把「被正则命中的行」从正文剥成 title 字段，更禁止用「连续标题合并」覆盖丢弃前一条 ——
   那样误判的正文行 / 段内嵌章头（"第120章 域名…正文…"）会被静默丢字。
   内核：分章只产出边界偏移 bounds=[0,b1,…,N]，第 i 章 = 原文.slice(bounds[i],bounds[i+1])。
   拼接各章必然等于原文 —— 丢字在数学上不可能；标题仅作派生展示标签，永远留在正文里。
   单实现双调用：主线程与 Worker 共用同一份源码（Worker 经 .toString() 注入，杜绝副本漂移）。 */
BF.library._splitBounds = function _splitBounds(text, opts) {
  opts = opts || {};
  const N = String(text).length;
  const strategy = opts.strategy || 'smart';
  const lines = String(text).split('\n');
  const lineStart = new Array(lines.length);          /* 每行首字符偏移（含其后换行补偿） */
  let pos = 0;
  for (let i = 0; i < lines.length; i++) { lineStart[i] = pos; pos += lines[i].length + 1; }
  /* RE_CHAPTER：主线程走 BF.library.RE_CHAPTER；Worker 经 var RE_CHAPTER 注入。
     typeof 守卫让两处都能取到且不因作用域差异抛错。 */
  let reSrc;
  const custom = (opts.chapterRegex || '').trim();
  /* 「用户给了正则」与「这条正则真被采纳」是两件事：被回溯防护拒掉或编译失败时，
     这一轮跑的是内置规则，逐行 400 字截断与反误判评分都该按内置规则那一套走。 */
  let adopted = false;
  if (custom) {
    /* 回溯防护：编译前过静态致命形状检测，命中则回退内置规则，
       原因写进 opts.__regexRejected（Worker 里借它回传，内部严禁引用 BF）。 */
    const _risk = _regexRisk(custom);
    if (_risk) { opts.__regexRejected = _risk; reSrc = null; }
    else {
      try { reSrc = new RegExp(custom, 'm'); adopted = true; }
      catch (e) { reSrc = null; opts.__regexRejected = '正则无法编译：' + (e && e.message ? e.message : String(e)); }
    }
  }
  if (!reSrc) reSrc = (typeof RE_CHAPTER !== 'undefined') ? RE_CHAPTER : (BF.library.RE_CHAPTER);
  /* 强序号词的形状判据。正文里的「第二章的晚上，他回了家」照样命中序号关键词，
     切下去就是一千个伪章；真章头的特征是「序号词在行首 + 后面挂的是标题而不是句子」。
     ① 序号词必须锚在行首；② 序号词后要么什么都没有，要么紧跟标题分隔符
     （空格 / 冒号 / 、 · — （ 《 等），直接接长串文字的当成句子；③ 标题 ≤40 字；
     ④ 标题里出现句号只放过「≤8 字且句中没有逗号」的收尾（「第4章 终局。」是标题，
     「第二章的晚上，他回了家，路上买了一份煎饼。」是句子）。
     两个方向的代价不对称：判松了造伪章（用户面对几千个空章），判紧了这一处少切
     一章而已 —— 边界法只产偏移，正文一个字都不会丢。 */
  function _strongHead(t) {
    const m = t.match(/^\s*(?:第\s*[0-9零一二两三四五六七八九十百千wkK]+\s*[章回卷节部集篇话幕]|chapter\s+\d+|section\s+\d+)/i);
    if (!m) return false;
    const rest = t.slice(m[0].length);
    if (!rest.trim()) return true;
    const sep = /^[\s:、·\-—–（(【《「『，,]/.test(rest);
    const tail = rest.replace(/^[\s:、·\-—–（(【《「『，,]+/, '');
    if (!sep && tail.length > 6) return false;
    if (tail.length > 40) return false;
    /* 句号的宽容度跟着「序号词后面有没有分隔符」走：有分隔符（空格/冒号/顿号）
       是章头的强特征，「第66章 跟你去过平平淡淡的生活。」这种 11 字标题就该认；
       没有分隔符时仍只放过 ≤8 字（「第二章的晚上他回了家。」这类正文句子不能当章头）。
       判紧的代价是真章被整章并入上一章、目录少一条；判松的代价只是目录多一条
       能跳回去的行（正文一个字都不丢，边界法只产偏移）。 */
    if (/。/.test(tail) && (tail.length > (sep ? 24 : 8) || /[，,；;]/.test(tail))) return false;
    return true;
  }
  function headerScore(t, count) {
    /* 抗误报评分（特征集）：命中内置正则的行未必是章头，过这道评分再定边界。
       强序号词走 _strongHead 的形状判据；其余弱命中若带「行尾句号 / 引号开头 /
       含 URL 水印 / 重复≥3次广告 / 过长无序号」则判误判，不作为边界（该行仍留正文，不丢内容）。 */
    if (!t) return false;
    const strong = /第\s*[0-9零一二两三四五六七八九十百千wkK]+\s*[章回卷节部集篇话幕]|chapter\s+\d+|section\s+\d+/i.test(t);
    if (strong) return _strongHead(t);
    if (count >= 3) return false;
    if (/[。！？!?…]/u.test(t.slice(-1))) return false;
    if (/^[\u201c\u201d\u2018\u2019\u0022\u300c\u300e\uff08\u3010(]/u.test(t)) return false;
    if (t.indexOf('http') >= 0 || t.indexOf('www.') >= 0 || t.indexOf('.com') >= 0 || t.indexOf('.cn') >= 0 || /域名|永久域名/.test(t)) return false;
    if (t.length > 50) return false;
    return true;
  }
  function regexBounds() {
    /* 先统计各行频次，供「重复≥3次」广告 / 水印行识别（与正则来源无关，先算一次） */
    const freq = Object.create(null);
    for (let i = 0; i < lines.length; i++) { const t = lines[i].trim(); if (t) freq[t] = (freq[t] || 0) + 1; }
    /* 单次 test 的代价已由「静态致命形状拒绝 + 逐行 400 字截断」钉死，
       但病态模式 × 海量行的乘积仍可能拖垮导入。每 1024 个文本行查一次钟，超预算
       （3s，与内置正则扫完一整本大书同量级）即放弃本套正则整体重扫：
       自定义正则超预算 → 换内置规则重扫（分章仍完整，仅规则来源不同，
       原因写进 opts.__regexRejected 由主线程明示）；内置正则超预算（线性，
       理论上不可达）→ 返回 null 由调用方退化字数策略。绝不把用户
       晾在永远不结束的导入上。 */
    function scan(re, isCustom, budget) {
      /* 评分开关跟着「这一轮用的是谁的规则」走，不跟着「用户填没填」走：
         正则被拒后回落到内置规则那一轮，防误判评分必须回来。 */
      const scoreOn = !isCustom;
      const b = [0];
      const marks = [];   /* 与 b 的内部边界一一对应：记录该边界是否由「强序号词」命中 */
      /* 上一刀所在行号与标题行内容：供「紧邻重复标题」判重（初始化为无） */
      let lastHead = -1, lastHeadTitle = '';
      const t0 = Date.now();
      for (let i = 0; i < lines.length; i++) {
        if ((i & 1023) === 0 && Date.now() - t0 > budget) return null;
        const line = lines[i];
        /* 章头是行头现象：自定义正则的逐行测试截到前 400 字（内置正则线性，
           不截断、行为逐字节不变）。 */
        if (!re.test(isCustom && line.length > 400 ? line.slice(0, 400) : line)) continue;
        const off = lineStart[i];
        const t = line.trim();
        const strong = /第\s*[0-9零一二两三四五六七八九十百千wkK]+\s*[章回卷节部集篇话幕]|chapter\s+\d+|section\s+\d+/i.test(t);
        /* 抗误报：命中内置正则的行都要过 headerScore 才作边界。
           这里以前写的是 `!strong && !headerScore(...)` —— 强序号词被短路掉，
           评分函数里针对强序号词的任何判据永远执行不到（等于没有）。
           判据仍只对内置正则生效：用户自定义正则（scoreOn=false）照他说的切。 */
        if (scoreOn && !headerScore(t, freq[t] || 0)) continue;
        /* 站点导出/OCR 常见排版：章头行的下一行（中间只隔空白）原样重复同一标题。
           第二个标题行也命中正则，落刀后每章被切成「标题空章 + 正文章」两段，
           目录翻倍、一半是空章。判据收紧到「与上一刀标题逐字相同 + 两刀之间只有空白行」，
           正常书籍没有这个形状；只减刀口、不动偏移数学，零丢失不变。 */
        if (scoreOn && lastHead >= 0 && t === lastHeadTitle) {
          let blankOnly = true;
          for (let k = lastHead + 1; k < i; k++) if (lines[k].trim()) { blankOnly = false; break; }
          if (blankOnly) continue;
        }
        /* 登记必须在刀口判定之前：首章标题在 offset 0，它自己是书的开头、不落刀，
           但它的重复行要靠这份登记才能被拦掉。 */
        lastHead = i; lastHeadTitle = t;
        if (off <= b[b.length - 1]) continue;
        b.push(off);
        marks.push({ off: off, strong: strong });
      }
      b.push(N);
      /* 全局一致性·第二阶段：孤立误报边界剔除。
         仅当「弱命中 + 切出的章极短（≤SHORT）+ 上一章明显很长（>SHORT×3）」时，
         判定该边界是夹在长正文里的零星误报，把它移除（碎片归入上一章）。
         内容永不丢失——只是少一刀；强序号词切出的短章视为真实短章，保留。 */
      if (scoreOn && marks.length) {
        const SHORT = 24;
        const keep = new Array(b.length).fill(true);
        for (let k = 1; k < b.length - 1; k++) {
          const len = b[k + 1] - b[k];
          const prevLen = b[k] - b[k - 1];
          const m = marks[k - 1];
          /* 退化双标题：弱命中且切出的章极小（≤SHORT），且上一章明显远大于它
             （prevLen > len*5，上一章至少是碎片的 5 倍 → 碎片可忽略），判定为
             夹在长正文里的零星误报，移除后把碎片归入上一章。强序号词不触动。 */
          if (m && !m.strong && len <= SHORT && prevLen > len * 5) keep[k] = false;
        }
        if (keep.indexOf(false) >= 0) {
          const nb = [0];
          for (let k = 1; k < b.length - 1; k++) if (keep[k]) nb.push(b[k]);
          nb.push(N);
          b.length = 0; for (let q = 0; q < nb.length; q++) b.push(nb[q]);
        }
      }
      return b;
    }
    let out = scan(reSrc, adopted, 3000);
    if (out === null && adopted) {
      opts.__regexRejected = opts.__regexRejected || '扫描超预算（>3s），已回退内置规则';
      out = scan((typeof RE_CHAPTER !== 'undefined') ? RE_CHAPTER : (BF.library.RE_CHAPTER), false, 3000);
    }
    return out;
  }
  function wordBounds() {
    const wc = opts.chapterWordCount || 50000;   /* 兜底阈值与默认一致 */
    const b = [0];
    let acc = 0;
    for (let i = 0; i < lines.length; i++) {
      if (acc >= wc && b[b.length - 1] < lineStart[i]) { b.push(lineStart[i]); acc = 0; }
      acc += lines[i].length + 1;
    }
    b.push(N);
    return b;
  }
  let bounds;
  if (strategy === 'none') bounds = [0, N];
  else if (strategy === 'regex') { const _r = regexBounds(); bounds = _r || wordBounds(); }
  else if (strategy === 'wordcount') bounds = wordBounds();
  else {
    /* smart：正则边界不可信（超预算/无章/均章过短）→ 退化字数策略。
       但「均章过短」这一条会吃掉短章品类：诗话、笔记、章回小品常有六七个真章头、
       每章只一两百字，平均低于 200 就整个放弃正则、按字数硬切 ——
       书自己标出来的章头在目录里全变成「第 N 段」，正是这类书最要命的读法问题。
       所以给真章头让路：强序号词（第X章/回/卷…、chapter N）命中够多就相信正则，
       它每一刀都对得上书自己的标记，比按字数瞎切准。
       只在 r 与 wordBounds() 之间做选择，边界算法本身一字未动，守恒判据照常成立。 */
    const r = regexBounds();
    const n = r ? r.length - 1 : 0;
    const avg = n > 0 ? N / n : N;
    const STRONGHEAD = /^第\s*[0-9零一二两三四五六七八九十百千wkK]+\s*[章回卷节部集篇话幕]|^chapter\s+\d+|^section\s+\d+/i;
    let strong = 0;
    if (r && avg < 200) {
      for (let i = 0; i < r.length - 1; i++) {
        if (STRONGHEAD.test(String(text.slice(r[i], r[i] + 60)).split('\n')[0].trim())) strong++;
      }
    }
    const bad = !r || (n <= 1 && N > 20000) || (n > 1 && avg < 200 && strong < 2);  /* 两处真章头即按强标题切，避免误并短书 */
    bounds = bad ? wordBounds() : r;
  }
  /* 保险：单调 + 落在 [0,N]，并把 0 与 N 钉死为首尾 */
  bounds = bounds.filter((v, idx) => v >= 0 && v <= N && (idx === 0 || v > bounds[idx - 1]));
  if (!bounds.length) bounds = [0];
  if (bounds[0] !== 0) bounds.unshift(0);
  if (bounds[bounds.length - 1] !== N) bounds.push(N);
  /* 目录区块伪章后处理（设置→解析 可关）。书前的小目录每行一条「第一章 起风」，
     章头正则会把它们各切成一章，目录里就是一串 2–7 字、彼此同名的假章。
     判据只看几何形状不看内容：连续 ≥3 段都短于 40 字 ⇒ 这一段是区块不是正文，
     把区块内部的刀口抽掉，整块归为一章（后面真正的第一章照旧单独成）。
     只删边界、不增不改，切片区间与正文一个字没动 ⇒ 零丢失与守恒判据天然成立。
     开关走 opts 传进来：本函数会被 .toString() 注入 Worker，内部引用 BF 会当场炸。
     目录区块合并补三条约束（原判据只看「连续 ≥3 段短于 40 字」，不限位置与占比）：
       ① 只认书首的区块 —— tiny[0] 为假直接放弃（中段的短章群是正文不是目录）；
       ② 区块之后必须还有非 tiny 的正文章 —— 否则这本书本来就是短章书
          （语录体/诗集，每章 10–20 字），全部满足 tiny 会被整体当成"目录"塌成 1 章；
       ③ 区块长度封顶全书章数的一半（且 ≥3 段才动刀）—— 正常书前目录远短于正文。 */
  if (opts && opts.mergeTocBlock && bounds.length > 4) {
    const tiny = [];
    for (let j = 0; j < bounds.length - 1; j++) tiny.push((bounds[j + 1] - bounds[j]) < 40);
    let drop = null;
    if (tiny[0]) {
      let end = 0;
      while (end + 1 < tiny.length && tiny[end + 1]) end++;
      let hasBody = false;
      for (let k = end + 1; k < tiny.length; k++) if (!tiny[k]) { hasBody = true; break; }
      if (hasBody && (end + 1) >= 3 && (end + 1) <= Math.max(3, Math.floor(tiny.length * 0.5))) {
        drop = new Set();
        for (let m = 1; m <= end; m++) drop.add(m);
      }
    }
    if (drop) {
      bounds = bounds.filter((v, idx) => idx === 0 || idx === bounds.length - 1 || !drop.has(idx));
    }
  }
  return bounds;
};
/* 由偏移表就地切片成章节；标题从首行派生（仅展示），标题行本身仍留在 content。
   注：每章 content 是「切片后仅剥首尾空白」的语义等价串（见下方 .replace(/^\s+|\s+$/g,'')），
   并非与原始切片逐字节相同——此处的「零丢失」指偏移表严格覆盖 [0,原文长]、无章被截短或吞并。 */
BF.library._buildChapters = function _buildChapters(text, bounds, opts) {
  opts = opts || {};
  const ch = [];
  const detect = opts.autoDetectTitle !== false;
  /* 段内嵌章头清洗：标题优先取行首的章头部分（第X章 / 序章 / 楔子…），
     即便该行黏连了正文或水印（如「第120章 域名…正文…」），TOC 也只显示干净的章头，
     而整行仍完整留在 content（零丢失不变，content 始终等于切片）。 */
  const HEADER = /^\s*(第\s*[0-9零一二三四五六七八九十百千万两]+\s*[章回卷节部集篇话幕]|[Cc]hapter\s+\d+|序[章言]|后[记序]|楔子|引子|正文|番外[章篇]?|附录|后记)/;
  /* 卷章层级：卷标（第X卷 / 上卷 / 卷X / Volume N）记为 level 0，
     其余记为 level 1（章）。parentSid 在 __ensureSid 里按「最近前置卷标」回填。 */
  /* 回溯防护：分支一的「第?」是可选量词、数字类无界——长行不命中时，
     每个起点都要把整段数字回溯一遍，整体 O(n²)（5 万字节行 3.4s，
     线性外推 100 万字节行约 23 分钟；章头「第999…9卷」即可触发）。
     数字类收成 {1,12}（真实卷号「第三卷 / 卷十二 / Volume IV」均远小于此限，
     超限只影响「卷号长到荒谬」的病理行，且仅卷标层级降级、内容零丢失）后
     每起点代价有界，整体回到线性。其余分支均为字面量前缀，天然线性。 */
  const VOLP = /第?\s*[一二三四五六七八九十百千0-9]{1,12}\s*卷|上卷|中卷|下卷|卷\s*[一二三四五六七八九十百千0-9]+|卷[一二三四五六七八九十百千]|[Vv]olume\s+[0-9IVX]+/;
  for (let i = 0; i < bounds.length - 1; i++) {
    let content = text.slice(bounds[i], bounds[i + 1]).replace(/^\s+|\s+$/g, '');  /* 仅剥首尾空白，保留内部换行与标题行 */
    const nl = content.indexOf('\n');
    /* 标题归一：剥行首 Markdown 标题记号（# / ＃，1–6 级）。分章器不把「#」算章头，
       Markdown 导出的书首行「# 书名」会原样进目录，还会让 isPseudoHead 的书名比对
       因多一个 # 而失配（打开书停在只有几个字的扉页章）。content 一字不动。
       本函数会被 toString() 注入 Worker，所以正则内联、不引用外部常量。 */
    const firstLine = (nl === -1 ? content : content.slice(0, nl)).trim().replace(/^[#＃]{1,6}\s*/, '');
    let title, level = 1;
    if (detect) {
      const hm = firstLine.match(HEADER);
      if (hm) {
        /* 章头后面那一截，多数书里就是副标题（「第1章 起风」）——只取章头会让目录每章同名、
           古文与诗集尤其难认。但下载版常把正文或水印黏在同一行（「第120章 域名…正文正文…」），
           那种行整行拿去当标题，目录就成半页正文。
           所以判据只看两件事：够不够短，以及像不像被黏进来的正文（句读密度 / 水印词）。
           content 一个字没动（仍等于切片），改的只是标题取哪一段——零丢失与守恒判据不受影响。 */
        const rest = firstLine.slice(hm[0].length).trim();
        const gluedBody = rest.length > 24 || /[。！？；…]{2,}|[，,]{4,}/.test(rest) ||
          /(https?:|www\.|域名|广告|订阅|群号|客服|唯一|首发)/i.test(rest);
        title = (!rest || gluedBody) ? hm[1] : firstLine.slice(0, 60);
        if (VOLP.test(hm[1])) level = 0;
      } else title = firstLine.slice(0, 60);
      if (!title) title = '第' + (i + 1) + '章';
    } else title = ('第' + (i + 1) + '章');
    ch.push({ title: title, content: content, level: level });
  }
  if (!ch.length) ch.push({ title: '正文', content: text.replace(/^\s+|\s+$/g, '') });
  return ch;
};
/* 零丢失兜底校验：偏移必须严格单调且恰好覆盖 [0,原文长度]，否则拼接 ≠ 原文。 */
BF.library._boundsIntegral = function _boundsIntegral(text, bounds) {
  if (!bounds || bounds.length < 2) return false;
  if (bounds[0] !== 0) return false;
  if (bounds[bounds.length - 1] !== text.length) return false;
  for (let i = 1; i < bounds.length; i++) if (bounds[i] <= bounds[i - 1]) return false;
  return true;
};
BF.library.cleanText = function (text) {
  /* 阶段4a：正文基础清洗（导入/剪贴板/URL 共用，splitChapters 前调用）。
     ① 去 BOM（EF BB BF）与零宽字符（U+FEFF/ZWNBSP/U+200B 等，会污染定位与统计）
     ② CRLF 统一为 LF（Windows 换行）
     ③ 去行尾空白（\r 残留、行尾空格/制表符）
     ④ 合并 3 个以上连续空行（保留段落分隔，避免分章/统计被空行干扰）
     不改变正文语义，只清编码与排版噪声。 */
  if (!text || typeof text !== 'string') return text || '';
  return String(text)
    .replace(/^\uFEFF/, '')                       /* BOM */
    .replace(/[\u200B\u200C\u200D\u2060\uFEFF]/g, '')  /* 零宽字符 */
    .replace(/\r\n?/g, '\n')                       /* CRLF/CR → LF */
    .replace(/[ \t]+\n/g, '\n')                    /* 行尾空白 */
    .replace(/\n{3,}/g, '\n\n');                   /* 连续空行压缩 */
};
/* sid 注入的唯一实现。
     被两处调用：① BF.library.splitChapters 的出口（主线程分章）；
     ② BF.smart.chapters 里 Worker 回传后的补齐（大书路径）。
     抽成独立函数而不是各写一遍遍历，是为了杜绝两条路径实现漂移 ——
     只要实参一样，两条路径算出的 sid 就必然相同。
     守卫：BF.cfi 不可用时跳过并 warn，不抛错中断导入（整本书导不进来的
     代价比「标注暂时无法重映射」大得多）。 */
  function __ensureSid(out) {
    try {
      if (!(BF.cfi && BF.cfi.stableSid)) {
        if (!BF.library.__sidWarned) { BF.library.__sidWarned = true; BF.log.warn('章节 sid 生成不可用（BF.cfi.stableSid 缺失）：标注将无法在重新分章后自动找回'); }
        return out;
      }
      /* 注入：stableSid 纯函数（同输入必同输出），重分章结果一致时 sid 不变，旧标注仍可归位 */
      (out || []).forEach(function (c, i) { if (c && typeof c === 'object' && !c.sid) c.sid = BF.cfi.stableSid(c.title, c.content); });
      /* sid 重复兜底。64 位哈希后仍理论存在「两章标题 / 前 64 字 / 字数完全相同」
         （批量生成的完全重复章）。扫一遍计数，对重复项用「hash + '#' + 章序」复合键强制唯一，
         保证标注不会漂到另一章；章序 i 在同一分章结果内天然唯一，且 '#' 不在 base36 字符集内不会与正哈希撞。 */
      const seen = Object.create(null);
      let dup = false;
      (out || []).forEach(function (c, i) {
        if (!c || typeof c !== 'object') return;
        const k = c.sid;
        if (seen[k]) { c.sid = k + '#' + i; seen[c.sid] = true; dup = true; }
        else seen[k] = true;
      });
      if (dup && !BF.library.__sidDupWarned) { BF.library.__sidDupWarned = true; BF.log.warn('分章检测到 sid 重复，已用章序复合键去重，标注可正确归位'); }
      /* parentSid 回填。level=0（卷）的章节作为其后章节的父节点，
         逐级把最近一个卷标 sid 赋给后续 level=1（章）章节；卷自身与卷前的章为 null。 */
      let _vol = null;
      (out || []).forEach(function (c) {
        if (!c || typeof c !== 'object') return;
        if (c.level === 0) _vol = c.sid;
        else c.parentSid = (c.level === 1) ? (_vol || null) : null;
      });
    } catch (e) { BF.log.warn('章节 sid 生成失败（标注将无法在重新分章后找回）：' + (e && e.message)); }
    return out;
  }
BF.library.__ensureSid = __ensureSid;
BF.library.splitChapters = function (text) {
  const opts = {
    strategy: BF.settings.get('chapterStrategy') || 'smart',
    chapterRegex: BF.settings.get('chapterRegex') || '',
    chapterWordCount: BF.settings.get('chapterWordCount') || BF.settings.DEFAULTS.chapterWordCount,
    autoDetectTitle: BF.settings.get('autoDetectTitle') !== false,
    mergeTocBlock: BF.settings.get('mergeTocBlock') !== false,
  };
  const cleaned = BF.library.cleanText(text);
  const bounds = BF.library._splitBounds(cleaned, opts);
  _warnRegexRisk(opts);   /* 自定义正则被回溯防护拒绝时明示一次 */
  /* 零丢失兜底：偏移不闭合则回退整本单章，绝不交付被截短的书 */
  if (!BF.library._boundsIntegral(cleaned, bounds)) {
    BF.log.warn('分章偏移不闭合，已回退为整本单章以避免内容丢失');
    return __ensureSid([{ title: '正文', content: cleaned.replace(/^\s+|\s+$/g, '') }]);
  }
  return __ensureSid(BF.library._buildChapters(cleaned, bounds, opts));
};
/* 手动微调·取当前边界：返回该书当前的偏移切片边界。
   已有手动结构（chapterBounds）直接返回；否则从存储重建全书正文后按当前策略自动分章，
   得到与导入时一致的边界（分章是纯函数，同输入同输出）。供手动合并/拆分作为编辑起点。 */
/* 全书正文重建唯一实现：逐章 getChapterText 拼回全书串，再按导入同一道 cleanText 清洗。
   坐标系必须是清洗后的串：原始文件与清洗后不等长（零宽剥离、\n{3,} 合并），
   按清洗前长度算边界会被判不闭合。
   供 getCurrentBounds / rebuildBookChapters / 手动微调 / AI 侧 _aiFullText 共用；
   getChapterTitles 不在此读：本串只含正文，标题行是调用方的事。 */
/* OPFS 第三读层（readChapter / getChapterText 共用，单一实现）：
   __putChapters 的 IDB 失败批次落点（写侧见该函数 putBatchLayers）。
   IDB 与 LS 都没这一章时才来探——正常书两次未命中不会发生；
   部分批次失败的书（回执「已存 N 章、失败 M 章」里 OPFS 层接住的那部分）
   靠这里读出正文，不必重新导入。返回 {ok,text} 形状或 null（无记录）。 */
BF.library._readOpfsChapter = async function (bookId, idx) {
  try {
    if (BF.fsync && BF.fsync.available) {
      const _CB = BF.library.CH_BATCH || 200;
      const _raw = await BF.fsync.readFile('books/' + bookId + '/parts/b' + Math.floor(idx / _CB) + '.json');
      const _part = JSON.parse(_raw);
      const _rec = _part && _part[idx % _CB];
      /* 图片书：图片随记录整份存进分批文件（img 字段），先认它再谈正文解压——
         正文槽是空串，直接解压会报「解压失败」的假警。 */
      if (_rec && _rec.img) return { ok: true, text: '', img: _rec.img };
      if (_rec && _rec.content != null) return await BF.lz.decompressSafe(_rec.content);
    }
  } catch (e) { /* OPFS 无该批次属常态（该批走了 IDB/LS 或书没分批），静默返回 null */ }
  return null;
};
/* 删掉整本书的 OPFS 分批正文（books/<id>/ 整个子树）。
   「彻底删除」和「重新分章」都要调它：分批层是正文的第三个落点，
   只清 IDB 与 LS 的话，失败批次留下的正文会永久留在磁盘上，
   而 BF.heal.repairOrphans 的孤儿清单来自 IDB 的 bk 索引 —— 纯 OPFS 的书
   在那里根本枚举不到，谁都不会来收。重新分章不调它，旧卷次正文就可能
   在新章节写失败时被第三读层当成正文读回来。
   没有分批目录是常态（正常书全走 IDB/LS），NotFoundError 不算失败。 */
BF.library._dropOpfsBook = async function (bookId) {
  try {
    if (!bookId || !BF.fsync || !BF.fsync.available) return true;
    await BF.fsync.remove('books/' + String(bookId));
    return true;
  } catch (e) {
    if (e && e.name === 'NotFoundError') return true;
    BF.err.report('dropOpfsBook:' + bookId, e);
    return false;
  }
};
/* OPFS 里现存的书 id 清单（books/ 下的一层目录名）。
   孤儿扫描要的是「磁盘上实际有哪些正文」，而 IDB 索引只能回答「IDB 里有哪些」，
   两者之差就是分批层的残留。目录不存在时返回空数组（常态）。 */
BF.library._listOpfsBookIds = async function () {
  try {
    if (!BF.fsync || !BF.fsync.available) return [];
    /* _dir() 带 create:true，拿来列目录会顺手把 books/ 建出来；
       走 _dir('') 拿根句柄再 create:false，只读不建。 */
    const root = await BF.fsync._dir('');
    const books = await root.getDirectoryHandle('books', { create: false });
    const out = [];
    /* 结构隔离加固：books/ 下只认「书 id 目录」。四类新分区（annotations/cache/backups）
       与 books 平级、本不该出现在 books/ 里；但万一将来有人误建同名子目录，这里用保留名
       再挡一道——绝不把保留目录名当成「无主的书」交给 repairOrphans 删掉（地雷①/C-6）。
       isReservedOpfsDir 缺失时（老构建）退化为不过滤，行为与改造前一致，零破坏。 */
    for await (const entry of books.entries()) {
      if (entry[1] && entry[1].kind === 'directory') {
        if (BF.fsync.isReservedOpfsDir && BF.fsync.isReservedOpfsDir(entry[0])) continue;
        out.push(entry[0]);
      }
    }
    return out;
  } catch (e) { return []; }
};
/* readChapter：与 getChapterText 走同一条读路，但把「读不到」如实报出来。
   getChapterText 面向渲染 —— 宁可显示空白也不能抛给读者；
   而装配全书的两个调用方（重分章 / 重建章节）必须知道哪一章没拿到，
   否则缺的那几章会被当成空正文重写入库，从此再也找不回来。 */
BF.library.readChapter = async function (book, idx) {
  /* 图片书：正文槽是空串，照实返回空——不走解压，免得把空串当「解压失败」刷警告 */
  if (book && book.img) return { ok: true, text: '' };
  const key = book.id + '_' + idx;
  try {
    if (BF.reader && BF.reader.__prefetched && BF.reader.__prefetched[key] != null) return { ok: true, text: BF.reader.__prefetched[key] };
    const item = await BF.store.idbGet(BF.store.K.CHAPTERS, key);
    if (item) {
      if (item.content == null) {
        BF.log && BF.log.warn('章节正文缺失 content 字段：' + key + '，尝试本地兜底');
      } else {
        const _dz = await BF.lz.decompressSafe(item.content);
        if (_dz.ok) return _dz;
        BF.log && BF.log.warn('章节正文解压失败：' + key + '，尝试本地兜底');
      }
    }
  } catch (e) { BF.err.report('readChapter.idb', e); }
  const ls = BF.store.lsGet('chap_' + key, null);
  if (ls != null) return { ok: true, text: ls };
  /* 第三读层：OPFS 分批正文（写侧见 __putChapters.putBatchLayers），实现单源 _readOpfsChapter */
  const _op = await BF.library._readOpfsChapter(book.id, idx);
  if (_op) return _op;
  return { ok: false, text: '', error: 'IDB 无记录且无本地兜底' };
};
/* opts.strict：装配全书准备写回时传 true —— 任一章读不到就抛出，
   绝不让缺章以空串混进整本书（那等于把这本书重写成缺几章的版本）。
   不传时保持旧行为（缺的当空串），因为搜索/预览这类只读路径不该因一章读不到而整体失败。 */
BF.library.rebuildCleanedText = async function (b, opts) {
  const strict = !!(opts && opts.strict);
  let full = '';
  for (let i = 0; i < (b.totalChapters || 0); i++) {
    let text = '';
    if (strict) {
      const r = await BF.library.readChapter(b, i);
      if (!r.ok) throw new Error('第 ' + (i + 1) + ' 章正文读不到（' + r.error + '），已停止装配全书');
      text = r.text;
    } else {
      text = await BF.library.getChapterText(b, i);
    }
    if (i > 0) full += '\n';
    full += (text || '');
  }
  return BF.library.cleanText(full);
};
BF.library.getCurrentBounds = async function (bookId) {
  const b = (BF.store.lsGetArray(BF.store.K.BOOKS_META, []) || []).find(function (x) { return x && x.id === bookId; });
  if (!b) return null;
  if (b.chapterBounds && b.chapterBounds.length >= 2) return b.chapterBounds.slice();
  const cleaned = await BF.library.rebuildCleanedText(b);
  const sopts = {
    strategy: BF.settings.get('chapterStrategy') || 'smart',
    chapterRegex: BF.settings.get('chapterRegex') || '',
    chapterWordCount: BF.settings.get('chapterWordCount') || BF.settings.DEFAULTS.chapterWordCount,
    autoDetectTitle: BF.settings.get('autoDetectTitle') !== false,
    mergeTocBlock: BF.settings.get('mergeTocBlock') !== false,
  };
  const _sb = BF.library._splitBounds(cleaned, sopts);
  _warnRegexRisk(sopts);   /* 自定义正则被回溯防护拒绝时明示一次 */
  return _sb;
};
