/* L16. 导入格式注册表 —— 文件与在线两条通道共用的唯一分流点。
   以前 EPUB / MOBI / PDF 在 importFile 与 importURL 里各写一条三元嗅探链，
   再各写一份中文标签与解析分支：加一种格式要改两处，漏一处的表现是
   「拖进去没反应」或「进度条写着 PDF 其实在解 HTML」。这里把
   「认得什么（sniff）／怎么解（parse）／叫什么（label）／解出来怎么分章（chapterize）」
   收成一张表，两条通道只负责取字节与报错。 */
BF.fmt = {
  /* 顺序即优先级：扩展名能定死的排前面。EPUB 的 sniff 认 PK(zip) 魔数，
     会把所有 zip 容器都认领走，所以 DOCX / CBZ / FB2(.zip) 必须排在 epub 之前。 */
  order: ['docx', 'cbz', 'fb2', 'epub', 'mobi', 'pdf', 'html', 'markdown'],
  labels: { docx: 'DOCX', cbz: 'CBZ', fb2: 'FB2', epub: 'EPUB', mobi: 'MOBI', pdf: 'PDF', html: 'HTML', markdown: 'Markdown' },

  sniff: function (buf, name) {
    for (let i = 0; i < this.order.length; i++) {
      const f = this.order[i];
      const ns = BF[f];
      if (ns && typeof ns.sniff === 'function' && ns.sniff(buf, name)) return f;
    }
    return '';
  },

  label: function (fmt) { return this.labels[fmt] || String(fmt || '').toUpperCase(); },

  parse: function (fmt, buf) {
    const ns = BF[fmt];
    if (!ns || typeof ns.parse !== 'function') return Promise.reject(new Error('不支持的格式：' + fmt));
    try { return Promise.resolve(ns.parse(buf)); }
    catch (e) { return Promise.reject(e); }
  },

  /* 解析产物 → 章节。两条路：
     ① 结构路 —— DOCX 的标题样式、HTML 的 h1-h3、FB2 的 section、Markdown 的 #、
        CBZ 的图页，解析器自己就认得章界，直接交出去（与 EPUB 同一条待遇）；
     ② 文本路 —— 只抽出纯文本的（MOBI / PDF，以及没分出结构的那几种），
        统一交 BF.smart.chapters：与 TXT 导入同一条分章路，划线 / 朗读 / 搜索 /
        坐标换算零适配，不为新格式另造一套分章。
     乱码判据也收在这里：文本路必过（扫描件 PDF、坏编码 HTML 都靠它拦），
     结构路与 CBZ 没有「乱码」可言，不白跑一遍。 */
  chapterize: async function (fmt, parsed, what) {
    const raw = (parsed && Array.isArray(parsed.chapters)) ? parsed.chapters.filter(function (c) {
      /* 图片章没有文本正文，靠 img 字段认；文本章必须非空 */
      return c && (c.img || String(c.content || '').trim());
    }) : [];
    if (raw.length) return raw;
    const text = parsed && parsed.text;
    if (!text || !String(text).trim()) throw new Error('没有可读正文');
    const g = BF.library.garbleCheck(String(text), what || '内容');
    if (g.blocked) throw new Error(g.report);
    if (g.suspect) BF.library.garbleNotice(g.report);
    const chs = await BF.smart.chapters(text);
    if (!chs.length) throw new Error('分章结果为空');
    return chs;
  },
};
/* 导入格式注册表 段结束 */
