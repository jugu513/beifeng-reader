/* L21. CBZ 导入 —— 漫画 / 画册的 zip 图片包，北风的第一种「图片书」。
   链路：解包（复用 BF.epub._unzip）→ 过滤图片条目（丢掉 __MACOSX 与点开头的垃圾）
   → 自然排序（p2 要排在 p10 前面，纯字典序会把页码排乱）→
   每张图一章，正文槽留空、图片以 dataURL 存进章节记录的 img 字段。
   为什么图片不进正文：正文槽一旦塞进 base64，搜索 / 朗读 / AI 摘要 / 导出
   全都会去啃几十万字符的图片码；留空则这些通路自动跳过，阅读器单独走
   getChapterImage 取图（见 049 / 064 两段）。
   取舍：不保原文件字节（转成 dataURL），不支持多页 PDF 与 CBZ 里的文字层。 */
BF.cbz = {
  _IMG: /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i,
  _MIME: {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif',
    webp: 'image/webp', avif: 'image/avif', bmp: 'image/bmp', svg: 'image/svg+xml',
  },

  sniff: function (buf, name) { return /\.cbz$/i.test(String(name || '')); },

  /* 自然排序：把连续数字当一个数比，页码才不会 p10 排在 p2 前面 */
  _nat: function (a, b) {
    const ra = String(a).match(/\d+|\D+/g) || [];
    const rb = String(b).match(/\d+|\D+/g) || [];
    const n = Math.min(ra.length, rb.length);
    for (let i = 0; i < n; i++) {
      if (ra[i] === rb[i]) continue;
      const na = /^\d/.test(ra[i]), nb = /^\d/.test(rb[i]);
      if (na && nb) { const d = Number(ra[i]) - Number(rb[i]); if (d) return d < 0 ? -1 : 1; }
      return ra[i] < rb[i] ? -1 : 1;
    }
    return ra.length - rb.length;
  },

  /* 字节 → dataURL：分块走 fromCharCode（一次 apply 上限约 65k 参数），再 btoa */
  _b64: function (bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 0x8000, bytes.length)));
    }
    return btoa(s);
  },

  parse: async function (bytes) {
    if (!bytes || bytes.length < 4) throw new Error('文件为空');
    const files = await BF.epub._unzip(bytes);
    const names = Object.keys(files).filter(function (n) {
      if (n.indexOf('__MACOSX/') >= 0) return false;
      const base = n.slice(n.lastIndexOf('/') + 1);
      if (!base || base.charAt(0) === '.') return false;
      return BF.cbz._IMG.test(base) && files[n] && files[n].length > 0;
    });
    if (!names.length) throw new Error('压缩包里没有图片（只支持 jpg/png/gif/webp/avif/bmp/svg）');
    names.sort(function (a, b) { return BF.cbz._nat(a, b); });

    const chapters = [];
    for (let i = 0; i < names.length; i++) {
      const nm = names[i];
      const ext = ((nm.match(/\.([a-z0-9]+)$/i) || [])[1] || 'jpg').toLowerCase();
      chapters.push({
        title: '第 ' + (i + 1) + ' 页',
        content: '',
        img: 'data:' + (BF.cbz._MIME[ext] || 'image/jpeg') + ';base64,' + BF.cbz._b64(files[nm]),
      });
    }
    const first = names[0];
    const title = decodeURIComponent(first.slice(first.lastIndexOf('/') + 1).replace(/\.[a-z0-9]+$/i, ''));
    return { title: title, chapters: chapters };
  },
};
/* CBZ 段结束 */
