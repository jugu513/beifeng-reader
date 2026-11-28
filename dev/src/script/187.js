/* L19. FB2 导入 —— 俄罗斯站点最常见的电子书格式，纯 XML。
   链路：.fb2.zip 先解包（复用 BF.epub._unzip）→ 按 XML 声明选解码器
   （先试严格 UTF-8，失败才信声明的 windows-1251 之类）→ 取 <book-title> 作书名
   → 第一个 <body> 里的顶层 <section> 各成一章（嵌套 section 不重复计，
     其 <p>/<line>/<subtitle> 按文档顺序并进本章）。
   取舍：只取文字——<image>、脚注链接、样式一律丢；诗体 <verse> 的 <line>
   按行保留，读得出分行，读不出缩进。 */
BF.fb2 = {
  sniff: function (buf, name) {
    if (/\.fb2(?:\.zip)?$/i.test(String(name || ''))) return true;
    if (!buf || buf.length < 16) return false;
    if (buf[0] === 0x50 && buf[1] === 0x4b) return false;   /* zip 归 .fb2.zip 扩展名认 */
    let head = '';
    for (let i = 0; i < Math.min(1024, buf.length); i++) head += String.fromCharCode(buf[i]);
    return head.indexOf('<FictionBook') >= 0;
  },

  /* 解码：严格 UTF-8 先行——FB2 的 XML 声明常写 windows-1251 但文件其实是 UTF-8，
     信声明会把西里尔文解成方块。严格解不出来才退回声明的编码，再不行就宽松 UTF-8。 */
  _decode: function (bytes) {
    let decl = '';
    for (let i = 0; i < Math.min(bytes.length, 256); i++) {
      const c = bytes[i];
      if (c === 0) break;
      decl += String.fromCharCode(c);
    }
    const em = decl.match(/encoding\s*=\s*["']([\w-]+)["']/i);
    try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) { /* 走声明 */ }
    if (em && !/^utf-?8$/i.test(em[1])) {
      try { return new TextDecoder(em[1]).decode(bytes); } catch (e2) { /* 落到宽松 UTF-8 */ }
    }
    return new TextDecoder('utf-8').decode(bytes);
  },

  _inline: function (s) {
    return BF.epub._ent(String(s).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
  },

  /* 顶层 section：深度计数，只在回到 0 时收一段，嵌套的并进父段不另起一章 */
  _topSections: function (s) {
    const out = [];
    const re = /<\/?section\b[^>]*>/g;
    let depth = 0, start = -1, m;
    while ((m = re.exec(s))) {
      if (m[0][1] === '/') {
        depth--;
        if (depth <= 0 && start >= 0) { out.push(s.slice(start, m.index)); start = -1; depth = 0; }
      } else {
        if (depth === 0) start = m.index;
        depth++;
      }
    }
    return out;
  },

  /* 一章的正文：先摘掉本章 <title>（它就是章题），再按文档顺序取 p / line / subtitle */
  _sectionText: function (sec) {
    const body = String(sec).replace(/<title[\s\S]*?<\/title>/i, '');
    const re = /<(p|line|subtitle)\b[^>]*>([\s\S]*?)<\/\1>/g;
    const lines = [];
    let m;
    while ((m = re.exec(body))) {
      const one = this._inline(m[2]);
      if (one) lines.push(one);
    }
    return lines.join('\n');
  },

  _sectionTitle: function (sec) {
    const t = String(sec).match(/<title[\s\S]*?<\/title>/i);
    if (!t) return '';
    const re = /<p\b[^>]*>([\s\S]*?)<\/p>/g;
    const parts = [];
    let m;
    while ((m = re.exec(t[0]))) { const one = this._inline(m[1]); if (one) parts.push(one); }
    return parts.join(' ');
  },

  parse: async function (bytes) {
    if (!bytes || bytes.length < 4) throw new Error('文件为空');
    let data = bytes;
    if (bytes[0] === 0x50 && bytes[1] === 0x4b) {
      const files = await BF.epub._unzip(bytes);
      const names = Object.keys(files).filter(function (k) { return /\.fb2$/i.test(k); });
      const key = names[0] || Object.keys(files)[0];
      if (!key || !files[key]) throw new Error('压缩包里没有 .fb2 文件');
      data = files[key];
    }
    const xml = this._decode(data);
    if (xml.indexOf('<FictionBook') < 0) throw new Error('不是 FB2（缺 <FictionBook> 根元素）');
    const bt = xml.match(/<book-title[^>]*>([\s\S]*?)<\/book-title>/);
    const title = bt ? this._inline(bt[1]) : '';

    const bAt = xml.search(/<body[\s>]/);
    let bodyXml = '';
    if (bAt >= 0) {
      const end = xml.indexOf('</body>', bAt);
      bodyXml = xml.slice(bAt, end < 0 ? xml.length : end);
    }
    const secs = bodyXml ? this._topSections(bodyXml) : [];
    const chapters = [];
    const self = this;
    secs.forEach(function (sec) {
      const content = self._sectionText(sec);
      if (!content) return;
      chapters.push({ title: self._sectionTitle(sec) || ('第 ' + (chapters.length + 1) + ' 章'), content: content });
    });
    if (chapters.length) return { title: title, chapters: chapters };
    /* 没有 section 的 FB2（罕见）：整篇取段落，交统一分章器 */
    const all = [];
    const re = /<(p|line)\b[^>]*>([\s\S]*?)<\/\1>/g;
    let m;
    while ((m = re.exec(xml))) { const one = this._inline(m[2]); if (one) all.push(one); }
    if (!all.length) throw new Error('没有可读正文');
    return { title: title, text: all.join('\n') };
  },
};
/* FB2 段结束 */
