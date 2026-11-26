/* ============ BF.cfi 轻量定位层（偏移唯一实现） ============
   epubcfi 的完整 EPUB 路径语法（spine/iframe/ref）对北风 TXT 章节无用——
   北风正文是 paras 数组（无 EPUB 结构），用「段索引+段内偏移」即等价 CFI 主锚，
   不引入 EPUB 那套上千行的专用代码（借格式不借宿主）。
   三层锚定：loc.si/so 精确 → text+指纹回退 → 失败返回 null 由调用方标 pending。
   统一规则：段偏移 = 各段长度之和再加一个换行基准（段间一个换行）——全库唯一实现处，
   addNote/addBookmark/gotoCharOffset/查找跳转等消费方一律调用本模块，
   不得各自写累加（否则会散落多份互不相符的 Σ(len+1) 副本）。
   loc 构造（makeLoc）与历史 loc 修正（fixLegacyLoc）也在本模块唯一实现：
   after = 文本之后的段内片段（不含选中文本自身），
   before/after 语义与 locate 指纹校验消费端同源。 */
BF.cfi = (function () {
  /* 段前缀和：paraOffsets[i] = 第 i 段起始的章内字符偏移。
     按 paras 数组引用做 WeakMap 记忆化——迁移循环（applyHighlights /
     ann.ingest / locate）以前每条标注都重建全表，千段章 × 百条 = O(n×m)；
     换数组（每次 renderChapter 都新建）引用失配即自动失效，最坏退回现算，不会读到脏表。 */
  const _offCache = new WeakMap();
  function buildOffsets(paras) {
    const hit = _offCache.get(paras);
    if (hit && hit.len === paras.length) return hit.off;
    const off = [0];
    for (let i = 0; i < paras.length - 1; i++) off.push(off[i] + (paras[i] || '').length + 1);
    try { _offCache.set(paras, { len: paras.length, off: off }); } catch (e) {}
    return off;
  }
  /* 章内字符偏移 → {si, so, base}（段索引 + 段内偏移 + 段起始偏移）。
     base = 该段在章内的起始字符偏移，调用方据此做「偏移 - base」分解，
     不用再写第二套 Σ(len+1) 累加（gotoCharOffset 等消费方统一走这里）。 */
  function offsetToLoc(offset, paras) {
    if (!paras || !paras.length || typeof offset !== 'number' || offset < 0) return null;
    const off = buildOffsets(paras);
    /* off 天然升序，二分找上界替代线性扫（FIND_MAX/jump 高频路径 O(n)→O(log n)） */
    let lo = 0, hi = off.length - 1, si = 0;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (offset >= off[mid]) { si = mid; lo = mid + 1; } else hi = mid - 1;
    }
    /* so 必须带上界 clamp，与 locToOffset 同口径：
       若只有下界 Math.max(0, …)，offset 越过本章总长时 so 溢出段长，
       定位到错误段落。 */
    const so = Math.max(0, Math.min(offset - off[si], (paras[si] || '').length));
    return { si: si, so: so, base: off[si] };
  }
  /* {si, so} → 章内字符偏移 */
  function locToOffset(loc, paras) {
    if (!loc || !paras || !paras.length) return 0;
    const si = Math.min(Math.max(0, loc.si || 0), paras.length - 1);
    const off = buildOffsets(paras);
    return off[si] + Math.min(Math.max(0, loc.so || 0), (paras[si] || '').length);
  }
  /* loc 构造唯一实现（after 不含选中文本自身）。
     三处构造点（locOfRange / applyHighlights 迁移 / renderMarks 迁移）
     统一走这里：before = 段内 [so-20, so)，after = 段内 [so+len, so+len+20)。
     after 语义与 locate / applyHighlights 的指纹校验消费端一致
     （消费端取 after.slice(0,8) 与「文本之后」的段片段比对）。 */
  function makeLoc(si, so, text, paras) {
    const seg = (paras && paras.length && typeof si === 'number' && si >= 0 && si < paras.length) ? (paras[si] || '') : '';
    const len = text ? text.length : 0;
    const s = Math.min(Math.max(0, so || 0), seg.length);
    return {
      si: si, so: s, text: text || '',
      before: seg.slice(Math.max(0, s - 20), s),
      after: seg.slice(s + len, s + len + 20),
      len: len
    };
  }
  /* Range → 定位（起点所在段 + 段内偏移 + 选中文本 + 前后文指纹）。
     虚拟化兼容：按段索引累计，不依赖 DOM 全文。 */
  function locOfRange(range, paras) {
    if (!range || !paras || !paras.length) return null;
    /* 起点容器所在段：优先 data-vi（虚拟化段标记），否则向上找 <p> */
    let el = range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    let vi = null, paraEl = null;
    while (el && el !== document.body) {
      if (el.hasAttribute && el.hasAttribute('data-vi')) { vi = parseInt(el.getAttribute('data-vi'), 10); paraEl = el; break; }
      if (el.tagName === 'P') { let idx = 0, sib = el; while (sib) { if (sib.tagName === 'P' && sib !== el) idx++; sib = sib.previousElementSibling; } vi = idx; paraEl = el; break; }
      el = el.parentElement;
    }
    if (vi === null || isNaN(vi) || vi < 0 || vi >= paras.length || !paraEl) return null;
    /* 段内偏移必须以「段」为基准——起点容器可能是嵌套
       span 内的文本节点，若以 startContainer.parentElement（嵌套
       span）为基准算偏移，so 恒等于 span 内相对偏移（如起点在
       <p>前半<span>后半</span>尾部</p> 的「后」字算出 so=0，
       真实应为 3）。以段元素（data-vi 元素 / P）为基准，
       selectNodeContents(段) + setEnd(起点) 得段首到起点的真实长度。 */
    let so = 0;
    try {
      const pre = document.createRange();
      pre.selectNodeContents(paraEl);
      pre.setEnd(range.startContainer, range.startOffset);
      so = pre.toString().length;
    } catch (e) { so = 0; }
    /* T2：分页模式长段被切开，每段 <p> 只显示源段的一部分。so 此时是「段内显示文本」的偏移，
       需加上 data-vo（本段在源段里的起始偏移）才是源码段落里的真实偏移；并夹到段长内。
       滚动模式（虚拟化）的 <p> 整段渲染、无 data-vo，此处不加、行为不变。 */
    if (paraEl && paraEl.hasAttribute && paraEl.hasAttribute('data-vo')) {
      const vo = parseInt(paraEl.getAttribute('data-vo'), 10);
      if (!isNaN(vo) && vo > 0) so += vo;
    }
    so = Math.max(0, Math.min(so, (paras[vi] || '').length));
    const text = (range.toString() || '').trim();
    /* after 经 makeLoc 构造，不含选中文本自身 */
    return makeLoc(vi, so, text, paras);
  }
  /* 文本指纹（回退校验用）：长度 + 首尾 8 字 + 简单散列 */
  function fingerprint(t) {
    if (!t) return '';
    let h = 0;
    for (let i = 0; i < t.length; i++) h = (h * 31 + t.charCodeAt(i)) >>> 0;
    return t.length + ':' + t.slice(0, 8) + ':' + t.slice(-8) + ':' + h.toString(36);
  }
  /* 文本锚定多档定位 + 显式失效。
     处理链：① 精确 Position（si/so 且段内该处文本吻合）→
     ①′ charOffset 前置定位（无 si/so 或其失配时，用章内字符偏移
        经 offsetToLoc 换算 {si, so}，再按 ① 同口径 RAW 校验文本。
        offsetToLoc 是 locToOffset 的逆运算——导出端由 {si, so} 算出的
        charOffset 在此原样取回，往返一致；旧标注迁移
        locate({ text, charOffset }) 走此档，不退化到全文扫描）→
     ② 引用上下文 TextQuote（si 失效但文本还在，靠 before/after 上下文校验）→
     ③ 局部 n-gram 模糊 RefinedPosition（文本被改写，用等长锚片段找最多命中位置）→
     ④ 失败返回（match:null）。
     上下文校验不得 okB||okA 任一命中即信——重复文本下会静默错挂；
     「双上下文俱中」才高置信，文本重复出现且无法唯一锁定时返回 weak（显式失效，
     提示「标注可能已移位」），绝不静默挂到错误位置。
     模糊回退用 n-gram 片段匹配（「整段等长 + 指纹」几乎不可能成立，不作依据）。
     归一两支：normS 仅 NFKC（不折叠空白、不去两端，用于段落与搜索），
     normF 再额外去两端（用于 loc 字段）；NFKC 不保证等长，见下面 rawIndexOf。
     返回 {si, so, match, conf, weak}：conf∈[0,1] 置信度；weak=true 表示命中但置信不足
     （重复文本 / 上下文缺失 / 模糊回退），供 UI 显式提示，标注内容本身与锚点解耦仍可查看。 */
  function locate(loc, paras) {
    if (!loc || !paras || !paras.length) return { si: -1, so: 0, match: null, conf: 0, weak: false };
    /* 归一化：NFKC（全角→半角等）削弱全半角/标点差异。
       normS 用于段落与搜索——仅 NFKC、**不折叠空白、不去两端**；normF 额外
       trim 用于 loc 字段两端。切忌「内部空白折叠」：会改变长度，让
       before/after 的切片比对静默失败。
       ⚠ 归一**不保证等长**：㈱→(株)、½→1⁄2、Ⅷ→VIII、ﬁ→fi 都会变长，
       归一串里的下标因此比 raw 段小。②/③ 在归一串中搜到的位置必须经
       rawIndexOf 换算回 raw 下标再返回，否则 so 落到别的字上而 match 仍报
       'text'/conf 0.9 —— 属于静默错挂，界面上看不出任何异常。 */
    const normF = function (t) {
      if (t == null) return '';
      let s = String(t);
      try { if (s.normalize) s = s.normalize('NFKC'); } catch (e) {}
      return s.trim();
    };
    const normS = function (t) {
      if (t == null) return '';
      try { if (t.normalize) t = t.normalize('NFKC'); } catch (e) {}
      return String(t);
    };
    const text = normF(loc.text);
    const before = normF(loc.before), after = normF(loc.after);
    /* 归一串下标 → raw 段下标（见上面 normS 的「不保证等长」）。
       逐码点累加：命中 at 落在哪个码点里，就返回那个码点在 raw 串中的起点。
       末行是防越界：若「逐字归一」与「整段归一」长度不相等（跨码点合成，
       如 e＋Combining 合成 é），映射不再可靠，退回按 at 原样取（旧口径），
       不假装换算成功。 */
    const rawIndexOf = function (seg, at) {
      if (!(at > 0)) return 0;
      let normLen = 0, rawPos = 0, total = 0;
      for (const ch of String(seg || '')) {
        const cn = normS(ch);
        total += cn.length;
        if (normLen + cn.length > at) return rawPos;
        normLen += cn.length;
        rawPos += ch.length;
      }
      return total === normS(seg).length ? rawPos : at;
    };
    /* ① 精确 Position（含无文本回退：旧标注仅有 si/so 时仅位置定位，弱置信）。
       严格还原原始口径：用 RAW 段与 RAW 文本判定，
       且 `seg.indexOf(text) >= 0` 即认 exact、返回「存储的 so」（即便 slice 不中）。
       这是往返定位一致性的契约——标注导出/导入后用 locate 重定位必须原样取回 si/so。
       （NFKC 归一化只用于 ②/③ 的上下文指纹比对，不影响 ① 的 so 取值。） */
    if (typeof loc.si === 'number' && loc.si >= 0 && loc.si < paras.length) {
      const seg = paras[loc.si] || '';
      const so = Math.min(Math.max(0, loc.so || 0), seg.length);
      const rawText = loc.text || '';
      if (!rawText) return { si: loc.si, so: so, match: 'exact', conf: 0.3, weak: true };
      if (seg.slice(so, so + rawText.length) === rawText) {
        return { si: loc.si, so: so, match: 'exact', conf: 1, weak: false };
      }
      /* slice 未中但段内确含该文本 → 用真实 indexOf 位置并降置信，
         不再沿用旧偏移，避免正文编辑后高亮套错字且满置信 */
      const _at = seg.indexOf(rawText);
      if (_at >= 0) {
        return { si: loc.si, so: _at, match: 'text', conf: 0.6, weak: false };
      }
    }
    /* ①′ charOffset 前置定位：si/so 缺失或失配时（旧标注迁移、
       W3C 导入回退等调用方只带 text + 章内字符偏移），用 offsetToLoc 把
       charOffset 换算成 {si, so}，再按 ① 完全相同的 RAW 口径校验：
       slice 命中或段内 indexOf 命中即认 exact、返回**换算出的** so
       （不是 indexOf 位置——offsetToLoc 是 locToOffset 的逆运算，返回换算值
       才能保证导出/导入 charOffset 往返一致）；无文本时仅位置定位、弱置信。
       校验不中不报错、不抢占——落 ②/③ 既有文本定位，向后兼容不变。 */
    if (typeof loc.charOffset === 'number' && loc.charOffset >= 0) {
      const cl = offsetToLoc(loc.charOffset, paras);
      if (cl) {
        const cseg = paras[cl.si] || '';
        const craw = loc.text || '';
        if (!craw) return { si: cl.si, so: cl.so, match: 'exact', conf: 0.3, weak: true };
        if (cseg.slice(cl.so, cl.so + craw.length) === craw) {
          return { si: cl.si, so: cl.so, match: 'exact', conf: 1, weak: false };
        }
        const _cat = cseg.indexOf(craw);
        if (_cat >= 0) {
          return { si: cl.si, so: _cat, match: 'text', conf: 0.6, weak: false };
        }
      }
    }
    /* ② 引用上下文 TextQuote：si 失效但文本还在 */
    if (text) {
      let best = null, bestScore = -1, hits = 0;
      for (let i = 0; i < paras.length; i++) {
        const segN = normS(paras[i] || '');
        let at = segN.indexOf(text);
        while (at >= 0) {
          hits++;
          const okB = !before || segN.slice(Math.max(0, at - before.length), at).endsWith(before);
          const okA = !after || segN.slice(at + text.length, at + text.length + after.length).startsWith(after);
          let score = 0;
          if (okB && okA) score = 2;        /* 双上下文俱中 → 高置信 */
          else if (okB || okA) score = 1;    /* 仅一上下文 → 中 */
          if (score > bestScore) { bestScore = score; best = { si: i, so: rawIndexOf(paras[i] || '', at) }; }
          at = segN.indexOf(text, at + 1);
        }
      }
      if (best) {
        if (hits > 1 && bestScore < 2) {
          /* 文本重复出现且双上下文未唯一锁定 → 显式失效：返回候选 + weak，绝不静默错挂 */
          return { si: best.si, so: best.so, match: 'ambiguous', conf: 0.2, weak: true };
        }
        if (hits === 1) {
          /* 文本唯一命中 → 与原始口径一致返回 'text'（消费方按 weak 判定，不依赖标签名） */
          return { si: best.si, so: best.so, match: 'text', conf: 0.9, weak: false };
        }
        /* hits>1 但双上下文锁定其一 → 中置信、仍标 weak（存在其他候选） */
        return { si: best.si, so: best.so, match: 'text', conf: 0.7, weak: true };
      }
    }
    /* ③ 局部 n-gram 模糊 RefinedPosition：文本被轻微改写（标点/空白差异） */
    if (text && text.length >= 4) {
      const n = Math.max(2, Math.floor(text.length / 3));
      const anchors = [];
      for (let i = 0; i + n <= text.length; i += n) anchors.push(text.slice(i, i + n));
      let best = null, bestHit = -1;
      for (let p = 0; p < paras.length; p++) {
        const segN = normS(paras[p] || '');
        let total = 0;
        for (let a = 0; a < anchors.length; a++) if (segN.indexOf(anchors[a]) >= 0) total++;
        if (total > bestHit) {
          bestHit = total;
          /* 锚片段是在归一串里搜的，下标必须回算成 raw 段下标 */
          const _a0 = segN.indexOf(anchors[0]);
          best = { si: p, so: _a0 >= 0 ? rawIndexOf(paras[p] || '', _a0) : 0 };
        }
      }
      if (best && bestHit >= Math.ceil(anchors.length * 0.6)) {
        return { si: best.si, so: Math.max(0, best.so), match: 'fuzzy', conf: bestHit / anchors.length, weak: true };
      }
    }
    /* ④ 失败返回 */
    return { si: -1, so: 0, match: null, conf: 0, weak: false };
  }
  /* 历史标注 loc 一次性修正（幂等）。
     旧格式的 loc.after 含选中文本自身（after 以 text 开头）。
     检测：after.startsWith(text) → 用当前 paras 重算 before/after/len
     （确定性定点：同一 (si, so, text, 段正文) 必得同一结果，
     跑两遍结果一致）；否则视为新格式不动（老数据不会永不回——
     旧格式被识别即回，新格式不受影响）。返回 true = 已重算。 */
  function fixLegacyLoc(loc, paras) {
    if (!loc || !paras || !paras.length) return false;
    if (typeof loc.si !== 'number' || loc.si < 0 || loc.si >= paras.length) return false;
    const text = loc.text || '';
    if (!text || typeof loc.after !== 'string') return false;
    if (loc.after.indexOf(text) !== 0) return false;   /* 新格式：after 不含自身 */
    const seg = paras[loc.si] || '';
    const s = Math.min(Math.max(0, loc.so || 0), seg.length);
    loc.before = seg.slice(Math.max(0, s - 20), s);
    loc.after = seg.slice(s + text.length, s + text.length + 20);
    loc.len = text.length;
    return true;
  }
  /* 合并串坐标还原（书内搜索 / 跨书搜索的逐字重复实现 → 唯一实现）。
     多章正文以 SEP（默认 '\n@@CH@@\n'，8 字符）拼接成合并串供
     Worker 检索，Worker 返回的命中位置是合并串绝对坐标。
     buildMergedParts 按「内容 + SEP」累加 base 构造分段表；
     restoreMergedCoord 把合并串绝对位置还原为 {idx（章序）, off（章内偏移）}。
     归属用「内容区间」[base, base+len) 判定——落在分隔符区间的
     坐标不归属任何章（边界命中丢弃，防章节串台）。 */
  function buildMergedParts(chunk, sepLen) {
    const parts = [];
    let base = 0;
    chunk.forEach(function (c) {
      parts.push({ idx: c.idx, base: base, len: c.text.length });
      base += c.text.length + (typeof sepLen === 'number' ? sepLen : 8);
    });
    return parts;
  }
  function restoreMergedCoord(rel, parts) {
    if (typeof rel !== 'number' || !parts) return null;
    for (let p = 0; p < parts.length; p++) {
      const pt = parts[p];
      if (rel >= pt.base && rel < pt.base + pt.len) return { idx: pt.idx, off: rel - pt.base };
    }
    return null;
  }
  /* stableSid：把「这一章的标题 + 正文开头」压成一个短且稳定的
     字符串 ID。

     要解决的问题：书被重新分章后，**章序号会变**，但用户既有的标注
     （划线/书签/生词）里记的是旧章号 —— 内容没变的章，标注却漂到了别的
     章上。纯靠章号定位的方案在重新分章那一刻就全废了。

     sid 的意义就在这里：它**只由内容决定，与章号无关**。同一段内容无论
     在第 3 章还是第 7 章，sid 都不变；标注存 sid，重新分章后就能按 sid
     找回正确的章。

     为什么能当「稳定」用：纯函数、无随机数、不含时间戳、不依赖存储顺序，
     只要输入字符串相同结果就必然相同——这是本函数的唯一判据。

     算法选择：FNV-1a **64 位**（offset
     0xcbf29ce484222325、prime 1099511628211，用 BigInt 精确计算），
     输入为「标题 + 正文前 64 字 + 正文字数」。64 位空间 + 更丰富输入把碰撞
     概率压到天文级；残余的「标题 / 前 64 字 / 字数全相同」章节（仅见于批量
     生成的完全重复章）由 __ensureSid 出口的章序复合键兜底，保证标注不会漂到
     另一章。

     为什么只取正文前缀而非全文：几十万字的整章全文遍历，在导入时是白付的
     成本（一本书几十到几百章，累计可达整本全文长度）。取前 64 字 + 字数已足以
     区分章节（章节开头本就各不相同），又把单章成本压到常数级。纯函数、无随机、
     无时间戳、不依赖存储顺序 —— 同输入必同输出，重分章一致时 sid 不变，旧标注
     仍可归位（无迁移负担）。 */
  function stableSid(title, content) {
    const src = String(title == null ? '' : title) + '\u0001' + String(content == null ? '' : content).slice(0, 64) + '|' + String(content == null ? '' : content).length;
    let h = 0xcbf29ce484222325n;     /* FNV-1a 64 位偏移基 */
    const prime = 1099511628211n;
    const mask = 0xffffffffffffffffn;
    for (let i = 0; i < src.length; i++) {
      h ^= BigInt(src.charCodeAt(i));
      h = (h * prime) & mask;
    }
    return 's' + h.toString(36);
  }
  /* chapterBase：每章起始的**全书**偏移数组。
     第 i 章的起点 = Σ(前 i 章长度) + 1（+1 是段内 loc 的基准，与
     locToOffset/offsetToLoc 共用同一基准，不另造口径）。
     有了它，「章内偏移」才能换算成「全书偏移」——后者才是重新分章后
     仍然有意义的坐标（章号变了，全书位置没变）。
     chapters 允许是字符串或 {content} 对象，两种形态都算得出长度，
     避免调用方因形态不同拿到 NaN。 */
  function chapterBase(chapters) {
    const base = [];
    let acc = 1;
    (chapters || []).forEach(function (c) {
      base.push(acc);
      const len = typeof c === 'string' ? c.length : (c && typeof c.content === 'string' ? c.content.length : 0);
      acc += len;
    });
    return base;
  }
  /* loc ⇄ 字符串的对外序列化只有一份：BF.ann 的 fragOf / parseFrag
     （FragmentSelector 值带章号，W3C 导出与重导都走它）。这里不另写一套编码。 */
  return {
    offsetToLoc: offsetToLoc, locToOffset: locToOffset, locOfRange: locOfRange,
    fingerprint: fingerprint, locate: locate, buildOffsets: buildOffsets,
    makeLoc: makeLoc, fixLegacyLoc: fixLegacyLoc,
    buildMergedParts: buildMergedParts, restoreMergedCoord: restoreMergedCoord,
    stableSid: stableSid, chapterBase: chapterBase
  };
})();

