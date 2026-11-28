/* L17. DOCX 导入 —— 手解 zip（复用 BF.epub._unzip）→ word/document.xml → 段落抽取。
   链路：按 <w:p> 切段 → 每段读 <w:pStyle> / <w:outlineLvl> 判标题级 →
   顺次取 <w:t> 拼文本（<w:tab> 记空格、<w:br>/<w:cr> 记换行）→
   有标题级就按它分章，没有就整篇交 BF.smart.chapters 兜底。
   取舍（如实报）：只取文字——图片、批注、修订标记一律丢；表格按行抽 <w:t>，
   单元格边界不补分隔符，读得出字但读不出表格的样子。 */
BF.docx = {
  sniff: function (buf, name) { return /\.docx$/i.test(String(name || '')); },

  /* 段内文本：三种内联记号要就地还原，只取 <w:t> 会把换行与制表符全丢掉 */
  _paraText: function (inner) {
    const re = /<w:t\b[^>]*\/>|<w:t\b[^>]*>([\s\S]*?)<\/w:t>|<w:tab\b[^>]*\/>|<w:(?:br|cr)\b[^>]*\/>/g;
    let out = '', m;
    while ((m = re.exec(inner))) {
      if (m[1] != null) { out += m[1]; continue; }
      const s = m[0];
      if (s.indexOf('<w:tab') === 0) out += ' ';
      else if (s.indexOf('<w:t') === 0) { /* 空 <w:t/>：不加字符 */ }
      else out += '\n';                      /* <w:br> / <w:cr> */
    }
    return BF.epub._ent(out).replace(/[ \t\u00a0]+/g, ' ').replace(/\n{2,}/g, '\n').trim();
  },

  /* 标题级：w:val 里的数字（Heading1 / heading1 / 标题1 都认）；
     没有标题样式才看 <w:outlineLvl>（0 起算，故 +1）。0 = 不是标题。 */
  _level: function (inner) {
    const sm = inner.match(/<w:pStyle\b[^>]*?w:val\s*=\s*"([^"]*)"/) ||
      inner.match(/<w:pStyle\b[^>]*?w:val\s*=\s*'([^']*)'/);
    if (sm) {
      const v = sm[1] || '';
      const m = v.match(/(?:^|[^a-z])(?:heading|head)[\s_-]*(\d)/i) || v.match(/标题\s*(\d)/) || v.match(/^h(\d)$/i);
      if (m) return Number(m[1]);
      return 0;
    }
    const om = inner.match(/<w:outlineLvl\b[^>]*?w:val\s*=\s*"(\d+)"/);
    return om ? Number(om[1]) + 1 : 0;
  },

  _isTitleStyle: function (inner) {
    const sm = inner.match(/<w:pStyle\b[^>]*?w:val\s*=\s*"([^"]*)"/) ||
      inner.match(/<w:pStyle\b[^>]*?w:val\s*=\s*'([^']*)'/);
    return !!sm && /^(?:title|标题)$/i.test((sm[1] || '').trim());
  },

  parse: async function (bytes) {
    if (!bytes || bytes.length < 4) throw new Error('文件为空');
    const files = await BF.epub._unzip(bytes);
    const doc = files['word/document.xml'];
    if (!doc) throw new Error('缺 word/document.xml（不是 DOCX）');
    const xml = new TextDecoder('utf-8').decode(doc);

    let title = '';
    try {
      const core = files['docProps/core.xml'];
      if (core) {
        const m = new TextDecoder('utf-8').decode(core).match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/);
        if (m) title = BF.epub._clean(m[1]);
      }
    } catch (e) { title = ''; }

    const paras = [];
    const pre = /<w:p\b[^>]*?\/>|<w:p\b[^>]*?>([\s\S]*?)<\/w:p>/g;
    let m;
    while ((m = pre.exec(xml))) {
      if (m[1] == null) continue;              /* 空段 <w:p/>：不产段落 */
      const text = this._paraText(m[1]);
      const isTitleStyle = this._isTitleStyle(m[1]);
      if (!title && isTitleStyle && text) title = text;
      paras.push({ text: text, lvl: isTitleStyle ? 0 : this._level(m[1]), skip: isTitleStyle });
    }
    if (!paras.some(function (p) { return p.text; })) throw new Error('没有可读正文');

    /* 标题级：优先 1 级；只有 2 级时降级按 2 级切（Heading2 当章的文档很常见） */
    let headLvl = 0;
    for (const p of paras) if (p.lvl === 1) { headLvl = 1; break; }
    if (!headLvl) for (const p of paras) if (p.lvl === 2) { headLvl = 2; break; }

    if (headLvl) {
      const chapters = [];
      const lead = [];                          /* 第一个标题之前的段落（扉页 / 前言） */
      let cur = null;
      for (const p of paras) {
        if (p.skip) continue;
        if (p.lvl > 0 && p.lvl <= headLvl && p.text) {
          if (cur) chapters.push(cur);
          cur = { title: p.text.slice(0, 60), lines: [p.text] };
        } else if (cur) { if (p.text) cur.lines.push(p.text); }
        else if (p.text) lead.push(p.text);
      }
      if (cur) chapters.push(cur);
      if (lead.length) chapters.unshift({ title: '前言', lines: lead });
      const out = chapters.map(function (c) { return { title: c.title, content: c.lines.join('\n') }; })
        .filter(function (c) { return c.content.replace(/\s+/g, '').length > 0; });
      if (out.length) return { title: title, chapters: out };
    }
    /* 没有标题结构（或结构里没分出正文）：整篇当纯文本，交统一分章器 */
    return { title: title, text: paras.filter(function (p) { return p.text; }).map(function (p) { return p.text; }).join('\n') };
  },
};
/* DOCX 段结束 */
