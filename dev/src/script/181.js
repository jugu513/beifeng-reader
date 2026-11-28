/* L13. EPUB 导入 —— 零依赖纯文本抽取。
   链路：手解 zip（store + deflate-raw，解压用浏览器原生 DecompressionStream）
   → META-INF/container.xml 定位 OPF → manifest/spine → 目录（EPUB3 nav 优先，NCX 回退）
   → 逐章 XHTML 剥标签、解实体，产出 [{title, content}] 直接入现有入库管线。
   取舍：不保图片不保排版——EPUB 的价值在结构（目录/章节），样式交给北风自己的排版引擎，
   图片与 CSS 一律丢弃，正文是纯文本（与 TXT 导入同一条渲染路径，划线/朗读零适配）。
   兼容：DecompressionStream('deflate-raw') 需 Chrome/Edge 103+、Firefox 113+、Safari 16.4+；
   不支持时 parse 抛错，导入通道如实报「EPUB 解析失败」，不产出半成品书。 */
BF.epub = {
  sniff: function (buf, name) {
    if (/\.epub$/i.test(String(name || ''))) return true;
    return !!(buf && buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b &&
      (buf[2] === 3 || buf[2] === 5 || buf[2] === 7));
  },

  /* ── zip：从尾部找 EOCD → 遍历中央目录 → 按本地头切数据 ── */
  _unzip: async function (bytes) {
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    const floor = Math.max(0, bytes.length - 22 - 65535);
    for (let i = bytes.length - 22; i >= floor; i--) {
      if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('不是有效的 zip（找不到目录尾）');
    const count = dv.getUint16(eocd + 10, true);
    let p = dv.getUint32(eocd + 16, true);
    const td = new TextDecoder('utf-8');
    const files = {};
    for (let n = 0; n < count; n++) {
      if (p + 46 > bytes.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('zip 中央目录损坏');
      const method = dv.getUint16(p + 10, true);
      const csize = dv.getUint32(p + 20, true);
      const nameLen = dv.getUint16(p + 28, true);
      const extraLen = dv.getUint16(p + 30, true);
      const cmtLen = dv.getUint16(p + 32, true);
      const lho = dv.getUint32(p + 42, true);
      const name = td.decode(bytes.subarray(p + 46, p + 46 + nameLen));
      if (lho + 30 > bytes.length || dv.getUint32(lho, true) !== 0x04034b50) throw new Error('zip 本地头损坏：' + name);
      const start = lho + 30 + dv.getUint16(lho + 26, true) + dv.getUint16(lho + 28, true);
      const comp = bytes.subarray(start, start + csize);
      if (method === 0) files[name] = comp;
      else if (method === 8) files[name] = await this._inflateRaw(comp);
      else throw new Error('不支持的压缩方式 ' + method + '：' + name);
      p += 46 + nameLen + extraLen + cmtLen;
    }
    return files;
  },

  _inflateRaw: function (bytes) {
    const ds = new DecompressionStream('deflate-raw');
    const stream = new Blob([bytes]).stream().pipeThrough(ds);
    return new Response(stream).arrayBuffer().then(function (ab) { return new Uint8Array(ab); });
  },

  /* ── 路径归一：去 fragment、URL 解码、处理 ./ 与 ../ ── */
  _resolve: function (base, href) {
    let h = String(href || '').split('#')[0];
    try { h = decodeURIComponent(h); } catch (e) { /* 坏编码就用原样 */ }
    const out = [];
    for (const seg of (base + h).split('/')) {
      if (!seg || seg === '.') continue;
      if (seg === '..') out.pop();
      else out.push(seg);
    }
    return out.join('/');
  },

  /* ── 实体解码：命名实体 + 十进制/十六进制数字实体 ── */
  _ent: function (s) {
    const map = {
      amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
      ldquo: '“', rdquo: '”', lsquo: '‘', rsquo: '’',
      mdash: '—', ndash: '–', hellip: '…', middot: '·',
      copy: '©', reg: '®', trade: '™', times: '×', divide: '÷',
      laquo: '«', raquo: '»', bull: '•',
    };
    return String(s).replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, function (all, m) {
      if (m.charAt(0) === '#') {
        const code = (m.charAt(1) === 'x' || m.charAt(1) === 'X') ? parseInt(m.slice(2), 16) : parseInt(m.slice(1), 10);
        if (!isFinite(code) || code <= 0 || code > 0x10ffff) return all;
        try { return String.fromCodePoint(code); } catch (e) { return all; }
      }
      return Object.prototype.hasOwnProperty.call(map, m) ? map[m] : all;
    });
  },

  _clean: function (s) {
    return this._ent(String(s).replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ').trim();
  },

  _attr: function (tag, name) {
    const m = String(tag).match(new RegExp('\\b' + name + '\\s*=\\s*"([^"]*)"')) ||
      String(tag).match(new RegExp('\\b' + name + "\\s*=\\s*'([^']*)'"));
    return m ? m[1] : '';
  },

  /* ── XHTML → 纯文本（与墨栖 html.js 同思路：块/行分明，行内强调不换行）：
     ① 先摘 ruby 注音——<rt>/<rp> 丢弃，只留汉字本体，否则「字zì」满屏噪音；
     ② 去脚本/样式/注释；③ 块级标签换行；④ 剥余下标签、解实体、压空白。 */
  _html2Text: function (html) {
    let s = String(html);
    s = s.replace(/<rt[\s\S]*?<\/rt>/gi, '');
    s = s.replace(/<rp[\s\S]*?<\/rp>/gi, '');
    s = s.replace(/<\/?ruby>/gi, '');
    s = s.replace(/<script[\s\S]*?<\/script>/gi, ' ');
    s = s.replace(/<style[\s\S]*?<\/style>/gi, ' ');
    s = s.replace(/<!--[\s\S]*?-->/g, ' ');
    s = s.replace(/<\/(?:p|div|h[1-6]|li|tr|blockquote|section|article|table|ul|ol|dl|dd|dt|figure|figcaption|pre|header|footer|main|aside)>/gi, '\n');
    s = s.replace(/<br\s*\/?>/gi, '\n');
    s = s.replace(/<hr\s*\/?>/gi, '\n');
    s = s.replace(/<[^>]+>/g, ' ');
    s = this._ent(s);
    return s.replace(/\r/g, '').split('\n')
      .map(function (l) { return l.replace(/[ \t ]+/g, ' ').trim(); })
      .filter(Boolean).join('\n').trim();
  },

  /* ── 主链路 ── */
  parse: async function (bytes) {
    if (!bytes || bytes.length < 4) throw new Error('文件为空');
    const files = await this._unzip(bytes);
    const cont = files['META-INF/container.xml'];
    if (!cont) throw new Error('缺 META-INF/container.xml（不是 EPUB）');
    const td = new TextDecoder('utf-8');
    const contXml = td.decode(cont);
    const opfPath = (contXml.match(/<rootfile[^>]*full-path="([^"]+)"/) || [])[1];
    if (!opfPath || !files[opfPath]) throw new Error('缺 OPF 清单：' + (opfPath || '未声明 rootfile'));
    const opf = td.decode(files[opfPath]);
    const base = opfPath.indexOf('/') >= 0 ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
    const title = this._clean((opf.match(/<dc:title[^>]*>([\s\S]*?)<\/dc:title>/) || [])[1] || '') ||
      this._clean((opf.match(/<title[^>]*>([\s\S]*?)<\/title>/) || [])[1] || '');
    const creator = this._clean((opf.match(/<dc:creator[^>]*>([\s\S]*?)<\/dc:creator>/) || [])[1] || '');

    /* manifest：id → {href, type, props} */
    const man = {};
    const itemRe = /<item\b[^>]*\/?>/g;
    let m;
    while ((m = itemRe.exec(opf))) {
      const id = this._attr(m[0], 'id');
      const href = this._attr(m[0], 'href');
      if (id && href) man[id] = { href: href, type: this._attr(m[0], 'media-type'), props: this._attr(m[0], 'properties') };
    }
    /* spine：阅读顺序；href 为绝对 URL 的条目跳过 */
    const spine = [];
    const sr = /<itemref\b[^>]*\/?>/g;
    while ((m = sr.exec(opf))) {
      const it = man[this._attr(m[0], 'idref')];
      if (it && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(it.href)) spine.push(it);
    }
    if (!spine.length) throw new Error('OPF spine 为空');

    /* 目录映射：相对路径（去 fragment）→ 标签。EPUB3 nav 优先，EPUB2 NCX 回退。 */
    const tocMap = {};
    const manList = Object.keys(man).map(function (k) { return man[k]; });
    const navItem = manList.filter(function (i) { return /(^|\s)nav(\s|$)/.test(i.props); })[0];
    const ncxId = (opf.match(/<spine[^>]*\btoc="([^"]+)"/) || [])[1];
    const ncxItem = manList.filter(function (i) { return /dtbncx/.test(i.type); })[0] || (ncxId ? man[ncxId] : null);
    const navPath = navItem ? this._resolve(base, navItem.href) : '';
    const ncxPath = ncxItem ? this._resolve(base, ncxItem.href) : '';
    if (navPath && files[navPath]) {
      const xml = td.decode(files[navPath]);
      const tb = navPath.slice(0, navPath.lastIndexOf('/') + 1);
      const re = /<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      while ((m = re.exec(xml))) {
        const p = this._resolve(tb, m[1]);
        if (files[p] && !tocMap[p]) tocMap[p] = this._clean(m[2]);
      }
    } else if (ncxPath && files[ncxPath]) {
      const xml = td.decode(files[ncxPath]);
      const tb = ncxPath.slice(0, ncxPath.lastIndexOf('/') + 1);
      const re = /<navPoint[\s\S]*?<text>([\s\S]*?)<\/text>[\s\S]*?<content[^>]*src="([^"]+)"/g;
      while ((m = re.exec(xml))) tocMap[this._resolve(tb, m[2])] = this._clean(m[1]);
    }

    /* 逐章抽取：spine 顺序，只取 html 类型；空章过滤；标题 = 目录标签 → 首个 h1-h3 → 序号 */
    const chapters = [];
    for (const it of spine) {
      const isHtml = /html/.test(it.type) || /\.x?html$/i.test(it.href);
      if (!isHtml) continue;
      const path = this._resolve(base, it.href);
      const data = files[path];
      if (!data) continue;
      const html = td.decode(data);
      let text = this._html2Text(html);
      if (!text) continue;
      const head = (html.match(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/) || [])[1];
      const cTitle = tocMap[path] || (head ? this._clean(head) : '') || ('第 ' + (chapters.length + 1) + ' 章');
      /* 首行恰是标题（h1 抽出来的）就不在正文里留一份重复 */
      const firstLine = text.split('\n')[0];
      if (firstLine && firstLine.trim() === cTitle && text.indexOf('\n') > 0) text = text.slice(text.indexOf('\n') + 1);
      chapters.push({ title: cTitle, content: text });
    }
    if (!chapters.length) throw new Error('没有可读章节');
    return { title: title, creator: creator, chapters: chapters };
  },
};
/* EPUB 段结束 */
